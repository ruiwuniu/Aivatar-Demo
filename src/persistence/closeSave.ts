import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { SaveFlushResult } from "./savePersistence";
import { drainStore, isStoreClosing, pauseStoreUpdates, setStoreClosing } from "./saveStore";

export const SAVE_BEFORE_CLOSE_EVENT = "aivatar://save-before-close";
export const CONFIRM_CLOSE_AFTER_SAVE_COMMAND = "confirm_close_after_save";
export const SAVE_BEFORE_UPDATE_EVENT = "aivatar://save-before-update";
export const CANCEL_UPDATE_SAVE_EVENT = "aivatar://update-save-cancelled";
export const CONFIRM_UPDATE_SAVE_COMMAND = "app_update_confirm_save";
export const UPDATE_SAVE_STATUS_COMMAND = "app_update_save_status";
export const CLOSE_SAVE_FAILURE_MESSAGE =
  "Aivatar could not finish saving. This window will stay open; please try closing it again.";

export interface CloseSaveRequest {
  requestId?: unknown;
}

export type CloseSaveFlushResult =
  | SaveFlushResult
  | readonly SaveFlushResult[];

export interface CloseSaveHandlerOptions {
  onFailure?: (message: string, error?: unknown) => void;
  invokeClose?: (
    command: string,
    payload: { requestId: number; ok: boolean },
  ) => Promise<unknown>;
  drain?: () => Promise<void>;
  timeoutMs?: number;
}

const validRequestId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export const aggregateSaveFlushResults = (
  ...groups: Array<SaveFlushResult | readonly SaveFlushResult[] | undefined>
): SaveFlushResult => {
  const results = groups.flatMap((group) =>
    group === undefined ? [] : Array.isArray(group) ? group : [group],
  ) as SaveFlushResult[];
  return {
    ok: results.every((result) => result.ok),
    written: results.some((result) => result.written),
  };
};

export const handleCloseSaveRequest = async (
  payload: CloseSaveRequest | null | undefined,
  flush: () => CloseSaveFlushResult | Promise<CloseSaveFlushResult>,
  options: CloseSaveHandlerOptions = {},
): Promise<SaveFlushResult> => {
  // The native coordinator rejects close while an update owns the barrier.
  // Keep the same guarantee if an already-queued close event arrives later.
  if (activeUpdateSave) {
    if (validRequestId(payload?.requestId)) {
      await (options.invokeClose ?? invoke)(CONFIRM_CLOSE_AFTER_SAVE_COMMAND, {
        requestId: payload.requestId, ok: false,
      }).catch(() => undefined);
    }
    return { ok: false, written: false };
  }
  let result: SaveFlushResult = { ok: false, written: false };
  let flushError: unknown;
  const attempt = ++closeAttempt;
  setStoreClosing(true);
  const deadline = Date.now() + (options.timeoutMs ?? 14_000);
  const withinDeadline = async <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Saving before close timed out.")), Math.max(0, deadline - Date.now()));
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const unfreeze = () => { if (closeAttempt === attempt) setStoreClosing(false); };
  try {
    const flushed = await withinDeadline(Promise.resolve(flush()));
    result = aggregateSaveFlushResults(flushed);
    if (result.ok) await withinDeadline((options.drain ?? drainStore)());
  } catch (error) {
    flushError = error;
    result = { ok: false, written: false };
  }

  // Older desktop builds emitted this event without a request id. Keep the
  // flush for compatibility, but only the acknowledged protocol
  // may tell a current Rust close coordinator to continue closing.
  if (!validRequestId(payload?.requestId)) {
    unfreeze();
    if (!result.ok) options.onFailure?.(CLOSE_SAVE_FAILURE_MESSAGE, flushError);
    return result;
  }

  let invokeError: unknown;
  try {
    await withinDeadline((options.invokeClose ?? invoke)(CONFIRM_CLOSE_AFTER_SAVE_COMMAND, {
      requestId: payload.requestId,
      ok: result.ok,
    }));
  } catch (error) {
    invokeError = error;
  }

  // A failure acknowledgement must reach Rust before showing a blocking alert;
  // otherwise the native close timeout could expire while the alert is open.
  if (!result.ok || invokeError !== undefined) {
    unfreeze();
    options.onFailure?.(CLOSE_SAVE_FAILURE_MESSAGE, flushError ?? invokeError);
  }
  return invokeError === undefined ? result : { ...result, ok: false };
};

let closeAttempt = 0;
type SaveFlusher = () => CloseSaveFlushResult | Promise<CloseSaveFlushResult>;
const registeredFlushers = new Set<SaveFlusher>();

export interface UpdateSaveStatus {
  requestId: number;
  active: boolean;
  phase: "saving" | "installing" | "inactive";
}

interface UpdateSaveOptions extends Pick<CloseSaveHandlerOptions, "drain" | "timeoutMs"> {
  invokeUpdate?: CloseSaveHandlerOptions["invokeClose"];
  queryStatus?: (requestId: number) => Promise<UpdateSaveStatus>;
}

interface UpdateSaveAttempt {
  requestId: number;
  release: () => void;
  cancelled: boolean;
  promise: Promise<SaveFlushResult>;
  queryStatus: UpdateSaveOptions["queryStatus"];
  recoveryTimer?: ReturnType<typeof setTimeout>;
  verification?: Promise<void>;
}
let activeUpdateSave: UpdateSaveAttempt | null = null;
const pendingUpdateValidation = new Map<number, Promise<SaveFlushResult>>();

const queryUpdateSaveStatus = async (
  requestId: number,
  query: UpdateSaveOptions["queryStatus"],
): Promise<UpdateSaveStatus> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const status = await Promise.race([
      query ? query(requestId) : invoke<UpdateSaveStatus>(UPDATE_SAVE_STATUS_COMMAND, { requestId }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Update save status timed out.")), 3_000);
      }),
    ]);
    if (status?.requestId !== requestId ||
      !(status.active === false && status.phase === "inactive" ||
        status.active === true && (status.phase === "saving" || status.phase === "installing"))) {
      throw new Error("Invalid update save status.");
    }
    return status;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const releaseUpdateSaveAttempt = (attempt: UpdateSaveAttempt) => {
  if (activeUpdateSave !== attempt) return;
  activeUpdateSave = null;
  attempt.cancelled = true;
  if (attempt.recoveryTimer !== undefined) clearTimeout(attempt.recoveryTimer);
  attempt.release();
};

// Events are notifications, not authority: another local WebView can emit the
// same event name. Only a caller-bound Rust query may authorize thawing. On
// uncertain IPC failure keep the lease and retry; never time out installation.
const recoverInactiveUpdateSave = (attempt: UpdateSaveAttempt): Promise<void> => {
  if (activeUpdateSave !== attempt) return Promise.resolve();
  if (attempt.verification) return attempt.verification;
  attempt.verification = (async () => {
    try {
      const status = await queryUpdateSaveStatus(attempt.requestId, attempt.queryStatus);
      if (!status.active) releaseUpdateSaveAttempt(attempt);
    } catch {
      // A missing response is not permission to resume save producers.
    } finally {
      // Retry active replies too: a real cancellation may arrive while this
      // query is in flight, after Rust already captured its older active state.
      // Coalescing those notifications must not lose the eventual inactive state.
      if (activeUpdateSave === attempt && attempt.recoveryTimer === undefined) {
        attempt.recoveryTimer = setTimeout(() => {
          attempt.recoveryTimer = undefined;
          void recoverInactiveUpdateSave(attempt);
        }, 1_000);
      }
    }
  })().finally(() => { attempt.verification = undefined; });
  return attempt.verification;
};

export const cancelUpdateSaveRequest = async (payload: CloseSaveRequest | null | undefined): Promise<void> => {
  if (!validRequestId(payload?.requestId) || activeUpdateSave?.requestId !== payload.requestId) return;
  await recoverInactiveUpdateSave(activeUpdateSave);
};

// Validate request, calling window and native phase before pausing. Updating
// then saves every registered room/park/card controller in this WebView. The
// separate lease cannot clear normal-close or another writer's pause.
export const handleUpdateSaveRequest = (
  payload: CloseSaveRequest | null | undefined,
  options: UpdateSaveOptions = {},
): Promise<SaveFlushResult> => {
  if (!validRequestId(payload?.requestId)) return Promise.resolve({ ok: false, written: false });
  const requestId = payload.requestId;
  const pending = pendingUpdateValidation.get(requestId);
  if (pending) return pending;
  if (activeUpdateSave?.requestId === requestId) return activeUpdateSave.promise;
  const acknowledge = (ok: boolean) => (options.invokeUpdate ?? invoke)(CONFIRM_UPDATE_SAVE_COMMAND, { requestId, ok });
  const work = (async (): Promise<SaveFlushResult> => {
    let status: UpdateSaveStatus;
    try { status = await queryUpdateSaveStatus(requestId, options.queryStatus); }
    catch { return { ok: false, written: false }; }
    if (!status.active || status.phase !== "saving") return { ok: false, written: false };
    if (activeUpdateSave || isStoreClosing()) {
      void acknowledge(false).catch(() => undefined);
      return { ok: false, written: false };
    }
    const attempt: UpdateSaveAttempt = {
      requestId,
      release: pauseStoreUpdates(),
      cancelled: false,
      queryStatus: options.queryStatus,
      promise: Promise.resolve({ ok: false, written: false }),
    };
    activeUpdateSave = attempt;
    attempt.promise = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: SaveFlushResult = { ok: false, written: false };
      let successAcknowledgementStarted = false;
      try {
        result = await Promise.race([
          (async () => {
            const results: SaveFlushResult[] = [];
            for (const flush of [...registeredFlushers]) {
              if (attempt.cancelled) return { ok: false, written: false };
              results.push(aggregateSaveFlushResults(await flush()));
              if (!results[results.length - 1].ok) return aggregateSaveFlushResults(results);
            }
            await (options.drain ?? drainStore)();
            return aggregateSaveFlushResults(results);
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Saving before update timed out.")), options.timeoutMs ?? 14_000);
          }),
        ]);
        if (attempt.cancelled) return { ok: false, written: result.written };
        successAcknowledgementStarted = result.ok;
        await acknowledge(result.ok);
        return result;
      } catch {
        if (!attempt.cancelled) void acknowledge(false).catch(() => undefined);
        result = { ok: false, written: false };
        if (successAcknowledgementStarted) await recoverInactiveUpdateSave(attempt);
        return result;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        // A successful ACK may have reached Rust despite a lost response.
        // Only an authoritative inactive status may then release this lease.
        if (!result.ok && !successAcknowledgementStarted) releaseUpdateSaveAttempt(attempt);
      }
    })();
    return attempt.promise;
  })().finally(() => { pendingUpdateValidation.delete(requestId); });
  pendingUpdateValidation.set(requestId, work);
  return work;
};

let updateListeners: { users: number; ready: Promise<UnlistenFn> } | null = null;
const retainUpdateSaveListeners = async (): Promise<UnlistenFn> => {
  if (!updateListeners) {
    const target = { target: { kind: "WebviewWindow" as const, label: getCurrentWebviewWindow().label } };
    updateListeners = {
      users: 0,
      ready: (async () => {
        const cancel = await listen<CloseSaveRequest>(CANCEL_UPDATE_SAVE_EVENT, (event) => {
          void cancelUpdateSaveRequest(event.payload);
        }, target);
        try {
          const save = await listen<CloseSaveRequest>(SAVE_BEFORE_UPDATE_EVENT, (event) => {
            void handleUpdateSaveRequest(event.payload);
          }, target);
          return () => { save(); cancel(); };
        } catch (error) { cancel(); throw error; }
      })(),
    };
  }
  const listeners = updateListeners;
  listeners.users += 1;
  const release = () => {
    listeners.users -= 1;
    if (listeners.users === 0) {
      if (updateListeners === listeners) updateListeners = null;
      void listeners.ready.then((stop) => stop(), () => undefined);
      // A controller unmount is not proof that native installation ended.
      // Retain the barrier across a replacement owner and keep polling after
      // event listeners are detached until Rust confirms inactivity.
      if (activeUpdateSave) void recoverInactiveUpdateSave(activeUpdateSave);
    }
  };
  try { await listeners.ready; return release; }
  catch (error) { release(); throw error; }
};

// Retrying the adapter alone cannot save a room/park controller's retained
// draft. Register the same barriers used by close, including in web previews.
export const retryPendingSaves = async (timeoutMs = 14_000): Promise<void> => {
  const resume = pauseStoreUpdates();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        for (const flush of [...registeredFlushers]) {
          const result = aggregateSaveFlushResults(await flush());
          if (!result.ok) throw new Error("Could not save all pending changes. Your changes remain queued.");
        }
        await drainStore();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Retrying pending saves timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    resume();
  }
};

export const installCloseSaveHandler = (
  flush: SaveFlusher,
  options: CloseSaveHandlerOptions = {},
): Promise<UnlistenFn> => {
  registeredFlushers.add(flush);
  const blockInteraction = (event: Event) => {
    if (!isStoreClosing()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const events = ["pointerdown", "click", "keydown", "submit"];
  if (typeof window !== "undefined") for (const event of events) window.addEventListener(event, blockInteraction, true);
  const cleanup = () => {
    registeredFlushers.delete(flush);
    if (typeof window !== "undefined") for (const event of events) window.removeEventListener(event, blockInteraction, true);
  };
  if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
    return Promise.resolve(cleanup);
  }
  return (async () => {
    let releaseUpdate: UnlistenFn | undefined;
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) releaseUpdate = await retainUpdateSaveListeners();
      const unlisten = await listen<CloseSaveRequest>(SAVE_BEFORE_CLOSE_EVENT, (event) => {
        void handleCloseSaveRequest(event.payload, flush, options);
      }, { target: { kind: "WebviewWindow", label: getCurrentWebviewWindow().label } });
      return () => { unlisten(); releaseUpdate?.(); cleanup(); };
    } catch (error) { releaseUpdate?.(); cleanup(); throw error; }
  })();
};
