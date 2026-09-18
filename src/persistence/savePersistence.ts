export interface JsonStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SaveFlushResult {
  ok: boolean;
  written: boolean;
}

export interface SavePersistenceOptions {
  storage: JsonStorage | (() => JsonStorage);
  waitMs?: number;
  retryWaitMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  onError?: (error: unknown, key: string) => void;
}

// Passive movement/runtime state is crash-safety checkpointed at most once per
// five-minute window. Explicit durable actions and close/manual flushes bypass
// this delay through flush/flushAll.
export const DEFAULT_SAVE_WAIT_MS = 5 * 60_000;
export const DEFAULT_SAVE_RETRY_MS = 20_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const definedKeys = (value: Record<string, unknown>) =>
  Object.keys(value).filter((key) => value[key] !== undefined);

export const jsonEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((value, index) => jsonEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = definedKeys(left);
  const rightKeys = definedKeys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && jsonEqual(left[key], right[key]));
};

// Always compare with storage itself: another window may have changed this key
// since our last write. Object key order alone is not a meaningful save change.
export const writeJsonIfChanged = (
  storage: JsonStorage,
  key: string,
  value: unknown,
): boolean => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("A save snapshot must be JSON serializable.");
  }
  const previous = storage.getItem(key);
  if (previous === serialized) return false;
  if (previous !== null) {
    try {
      if (jsonEqual(JSON.parse(previous), JSON.parse(serialized))) return false;
    } catch {
      // A malformed old value must not prevent writing a valid snapshot.
    }
  }
  storage.setItem(key, serialized);
  return true;
};

const missing = Symbol("missing save field");
const fieldValue = (value: unknown, key: string): unknown =>
  isRecord(value)
    && Object.prototype.hasOwnProperty.call(value, key)
    && value[key] !== undefined
    ? value[key]
    : missing;

const mergeValue = (base: unknown, local: unknown, remote: unknown): unknown => {
  if (jsonEqual(local, base)) return remote;
  if (jsonEqual(remote, base) || jsonEqual(local, remote)) return local;
  if (isRecord(local) && isRecord(remote) && (isRecord(base) || base === missing)) {
    const keys = new Set([
      ...Object.keys(remote),
      ...Object.keys(local),
      ...(isRecord(base) ? Object.keys(base) : []),
    ]);
    const entries: [string, unknown][] = [];
    for (const key of keys) {
      const value = mergeValue(fieldValue(base, key), fieldValue(local, key), fieldValue(remote, key));
      if (value !== missing) entries.push([key, value]);
    }
    return Object.fromEntries(entries);
  }
  // Arrays are atomic. Conflicting edits to the same field prefer local;
  // unchanged local fields, including deletions, follow the remote snapshot.
  return local;
};

export const mergeSaveChanges = <T>(base: T, local: T, remote: T): T =>
  mergeValue(base, local, remote) as T;

type PendingSave = {
  getSnapshot: () => unknown;
  onPersisted?: (snapshot: unknown, written: boolean) => void;
  timer?: unknown;
};

export const createSavePersistence = (options: SavePersistenceOptions) => {
  const waitMs = Number.isFinite(options.waitMs) && (options.waitMs ?? 0) > 0
    ? options.waitMs as number
    : DEFAULT_SAVE_WAIT_MS;
  const retryWaitMs = Number.isFinite(options.retryWaitMs) && (options.retryWaitMs ?? 0) > 0
    ? options.retryWaitMs as number
    : DEFAULT_SAVE_RETRY_MS;
  const setTimer = options.setTimer
    ?? ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer
    ?? ((timer: unknown) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>));
  const pending = new Map<string, PendingSave>();

  const reportError = (error: unknown, key: string) => {
    try {
      options.onError?.(error, key);
    } catch {
      // Error reporting must not discard the pending save or break retries.
    }
  };

  const armTimer = (key: string, entry: PendingSave, delayMs = waitMs) => {
    if (entry.timer !== undefined) return;
    const timer = setTimer(() => {
      const current = pending.get(key);
      if (current && current.timer === timer) current.timer = undefined;
      flush(key);
    }, delayMs);
    entry.timer = timer;
  };

  const schedule = <T>(
    key: string,
    getSnapshot: () => T | undefined,
    onPersisted?: (snapshot: T | undefined, written: boolean) => void,
  ) => {
    const entry: PendingSave = {
      getSnapshot,
      onPersisted: onPersisted
        ? (snapshot, written) => onPersisted(snapshot as T | undefined, written)
        : undefined,
      timer: pending.get(key)?.timer,
    };
    pending.set(key, entry);
    // Replacing the getter does not extend the first update's deadline.
    armTimer(key, entry);
  };

  const flush = <T>(
    key: string,
    getSnapshot?: () => T | undefined,
    onPersisted?: (snapshot: T | undefined, written: boolean) => void,
  ): SaveFlushResult => {
    if (getSnapshot) schedule(key, getSnapshot, onPersisted);
    const entry = pending.get(key);
    if (!entry) return { ok: true, written: false };
    if (entry.timer !== undefined) clearTimer(entry.timer);
    entry.timer = undefined;

    let snapshot: unknown;
    let written = false;
    try {
      snapshot = entry.getSnapshot();
      // Undefined explicitly means the destination no longer exists. Do not
      // recreate a deleted slot or store the non-JSON string "undefined".
      if (snapshot !== undefined) {
        const storage = typeof options.storage === "function" ? options.storage() : options.storage;
        written = writeJsonIfChanged(storage, key, snapshot);
      }
    } catch (error) {
      const current = pending.get(key);
      if (current) {
        if (current.timer !== undefined) clearTimer(current.timer);
        current.timer = undefined;
        armTimer(key, current, retryWaitMs);
      }
      reportError(error, key);
      return { ok: false, written: false };
    }

    // A snapshot callback may have scheduled newer work for this same key.
    if (pending.get(key) === entry) pending.delete(key);
    try {
      entry.onPersisted?.(snapshot, written);
    } catch (error) {
      // The storage write already succeeded. Do not replay a committed change
      // merely because a consumer's completion callback failed.
      reportError(error, key);
    }
    return { ok: true, written };
  };

  const cancel = (key: string) => {
    const entry = pending.get(key);
    if (entry?.timer !== undefined) clearTimer(entry.timer);
    pending.delete(key);
  };

  return {
    schedule,
    flush,
    flushAll: () => [...pending.keys()].map((key) => ({ key, ...flush(key) })),
    cancel,
    hasPending: (key?: string) => key === undefined ? pending.size > 0 : pending.has(key),
  };
};
