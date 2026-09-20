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

interface UpdateSaveAttempt {
  requestId: number;
  release: () => void;
  cancelled: boolean;
  promise: Promise<SaveFlushResult>;
}
let activeUpdateSave: UpdateSaveAttempt | null = null;

export const cancelUpdateSaveRequest = (payload: CloseSaveRequest | null | undefined) => {
  if (!validRequestId(payload?.requestId) || activeUpdateSave?.requestId !== payload.requestId) return;
  const attempt = activeUpdateSave;
  activeUpdateSave = null;
  attempt.cancelled = true;
  attempt.release();
};

// Updating saves every mounted controller in this WebView, including room,
// park and card-room drafts. A separate pause lease cannot clear a close or
// another writer's pause when installation fails and the native shell resumes.
export const handleUpdateSaveRequest = (
  payload: CloseSaveRequest | null | undefined,
  options: Pick<CloseSaveHandlerOptions, "drain" | "timeoutMs"> & {
    invokeUpdate?: CloseSaveHandlerOptions["invokeClose"];
  } = {},
): Promise<SaveFlushResult> => {
  if (!validRequestId(payload?.requestId)) return Promise.resolve({ ok: false, written: false });
  const requestId = payload.requestId;
  const acknowledge = (ok: boolean) => (options.invokeUpdate ?? invoke)(CONFIRM_UPDATE_SAVE_COMMAND, { requestId, ok });
  if (activeUpdateSave?.requestId === requestId) return activeUpdateSave.promise;
  if (activeUpdateSave || isStoreClosing()) {
    return acknowledge(false).catch(() => undefined).then(() => ({ ok: false, written: false }));
  }
  const attempt: UpdateSaveAttempt = {
    requestId,
    release: pauseStoreUpdates(),
    cancelled: false,
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
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // A success ACK may have reached Rust even when its response was lost.
      // Installation could already be underway, so only native cancellation
      // may release that lease. Rust cancels an unacknowledged barrier after
      // its own deadline; acknowledged barriers remain frozen through install.
      if (!result.ok && !successAcknowledgementStarted && activeUpdateSave === attempt) cancelUpdateSaveRequest({ requestId });
    }
  })();
  return attempt.promise;
};

let updateListeners: { users: number; ready: Promise<UnlistenFn> } | null = null;
const retainUpdateSaveListeners = async (): Promise<UnlistenFn> => {
  if (!updateListeners) {
    const target = { target: { kind: "WebviewWindow" as const, label: getCurrentWebviewWindow().label } };
    updateListeners = {
      users: 0,
      ready: (async () => {
        const cancel = await listen<CloseSaveRequest>(CANCEL_UPDATE_SAVE_EVENT, (event) => {
          cancelUpdateSaveRequest(event.payload);
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
      if (activeUpdateSave) cancelUpdateSaveRequest({ requestId: activeUpdateSave.requestId });
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
