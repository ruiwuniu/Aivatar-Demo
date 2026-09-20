import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { SaveFlushResult } from "./savePersistence";
import { drainStore, isStoreClosing, pauseStoreUpdates, setStoreClosing } from "./saveStore";

export const SAVE_BEFORE_CLOSE_EVENT = "aivatar://save-before-close";
export const CONFIRM_CLOSE_AFTER_SAVE_COMMAND = "confirm_close_after_save";
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
  return listen<CloseSaveRequest>(SAVE_BEFORE_CLOSE_EVENT, (event) => {
    void handleCloseSaveRequest(event.payload, flush, options);
  }, { target: { kind: "WebviewWindow", label: getCurrentWebviewWindow().label } }).then((unlisten) => () => {
    unlisten();
    cleanup();
  }, (error: unknown) => {
    cleanup();
    throw error;
  });
};
