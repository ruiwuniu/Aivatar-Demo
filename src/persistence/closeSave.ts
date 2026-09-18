import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SaveFlushResult } from "./savePersistence";

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
  flush: () => CloseSaveFlushResult,
  options: CloseSaveHandlerOptions = {},
): Promise<SaveFlushResult> => {
  let result: SaveFlushResult;
  let flushError: unknown;
  try {
    const flushed = flush();
    result = aggregateSaveFlushResults(flushed);
  } catch (error) {
    flushError = error;
    result = { ok: false, written: false };
  }

  // Older desktop builds emitted this event without a request id. Keep the
  // synchronous flush for compatibility, but only the acknowledged protocol
  // may tell a current Rust close coordinator to continue closing.
  if (!validRequestId(payload?.requestId)) {
    if (!result.ok) options.onFailure?.(CLOSE_SAVE_FAILURE_MESSAGE, flushError);
    return result;
  }

  let invokeError: unknown;
  try {
    await (options.invokeClose ?? invoke)(CONFIRM_CLOSE_AFTER_SAVE_COMMAND, {
      requestId: payload.requestId,
      ok: result.ok,
    });
  } catch (error) {
    invokeError = error;
  }

  // A failure acknowledgement must reach Rust before showing a blocking alert;
  // otherwise the native close timeout could expire while the alert is open.
  if (!result.ok || invokeError !== undefined) {
    options.onFailure?.(CLOSE_SAVE_FAILURE_MESSAGE, flushError ?? invokeError);
  }
  return result;
};

export const installCloseSaveHandler = (
  flush: () => CloseSaveFlushResult,
  options: CloseSaveHandlerOptions = {},
): Promise<UnlistenFn> =>
  listen<CloseSaveRequest>(SAVE_BEFORE_CLOSE_EVENT, (event) => {
    void handleCloseSaveRequest(event.payload, flush, options);
  });
