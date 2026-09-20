export interface JsonReadView {
  getItem(key: string): string | null;
}

export interface JsonStorage extends JsonReadView {
  setItem(key: string, value: string): void | Promise<void>;
  transact?<T>(builder: (view: JsonReadView) => {
    changes: Record<string, string | null>;
    result: T;
  }): Promise<T>;
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
  additionalChanges?: (key: string, snapshot: unknown, view: JsonReadView) => Record<string, string>;
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
export const writeJsonIfChanged = async (
  storage: JsonStorage,
  key: string,
  value: unknown,
): Promise<boolean> => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("A save snapshot must be JSON serializable.");
  }
  if (storage.transact) return storage.transact((view) => {
    const written = jsonChanged(view.getItem(key), serialized);
    return { changes: written ? { [key]: serialized } : {}, result: written };
  });
  const previous = storage.getItem(key);
  if (!jsonChanged(previous, serialized)) return false;
  await storage.setItem(key, serialized);
  return true;
};

const jsonChanged = (previous: string | null, serialized: string): boolean => {
  if (previous === serialized) return false;
  if (previous !== null) {
    try {
      if (jsonEqual(JSON.parse(previous), JSON.parse(serialized))) return false;
    } catch {
      // A malformed old value must not prevent writing a valid snapshot.
    }
  }
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
  getSnapshot: (view: JsonReadView) => unknown;
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
  const inFlight = new Map<string, Promise<SaveFlushResult>>();

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
      void flush(key);
    }, delayMs);
    entry.timer = timer;
  };

  const schedule = <T>(
    key: string,
    getSnapshot: (view: JsonReadView) => T | undefined,
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

  const flush = async <T>(
    key: string,
    getSnapshot?: (view: JsonReadView) => T | undefined,
    onPersisted?: (snapshot: T | undefined, written: boolean) => void,
  ): Promise<SaveFlushResult> => {
    if (getSnapshot) schedule(key, getSnapshot, onPersisted);
    const running = inFlight.get(key);
    if (running) {
      const result = await running;
      if (!result.ok || !pending.has(key)) return result;
      const next = await flush(key);
      return { ok: next.ok, written: result.written || next.written };
    }
    const entry = pending.get(key);
    if (!entry) return { ok: true, written: false };
    if (entry.timer !== undefined) clearTimer(entry.timer);
    entry.timer = undefined;

    // Install the in-flight barrier before calling any user getter. A getter
    // or an acknowledgement may schedule another generation synchronously.
    const operation = Promise.resolve().then(async (): Promise<SaveFlushResult> => {
      let snapshot: unknown;
      let written = false;
      try {
        const storage = typeof options.storage === "function" ? options.storage() : options.storage;
        const build = (view: JsonReadView) => {
          const value = entry.getSnapshot(view);
          const changes: Record<string, string> = {};
          if (value === undefined) return { changes, result: { snapshot: undefined, written: false } };
          const serialized = JSON.stringify(value);
          if (serialized === undefined) throw new TypeError("A save snapshot must be JSON serializable.");
          const snapshot = JSON.parse(serialized) as unknown;
          const written = jsonChanged(view.getItem(key), serialized);
          if (written) {
            changes[key] = serialized;
            for (const [extraKey, extraValue] of Object.entries(options.additionalChanges?.(key, snapshot, view) ?? {})) {
              if (jsonChanged(view.getItem(extraKey), extraValue)) changes[extraKey] = extraValue;
            }
          }
          return { changes, result: { snapshot, written } };
        };
        if (storage.transact) {
          ({ snapshot, written } = await storage.transact(build));
        } else {
          const built = build(storage);
          for (const [target, serialized] of Object.entries(built.changes)) await storage.setItem(target, serialized);
          ({ snapshot, written } = built.result);
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

      if (pending.get(key) === entry) pending.delete(key);
      try {
        entry.onPersisted?.(snapshot, written);
      } catch (error) {
        // A consumer callback must not replay an already committed operation.
        reportError(error, key);
      }
      return { ok: true, written };
    });
    inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      if (inFlight.get(key) === operation) inFlight.delete(key);
    }
  };

  const cancel = (key: string) => {
    const entry = pending.get(key);
    if (entry?.timer !== undefined) clearTimer(entry.timer);
    pending.delete(key);
  };

  const flushAll = async () => {
    const results: Array<SaveFlushResult & { key: string }> = [];
    while (pending.size || inFlight.size) {
      const keys = [...new Set([...pending.keys(), ...inFlight.keys()])];
      for (const key of keys) results.push({ key, ...await flush(key) });
      if (results.some((result) => !result.ok)) break;
    }
    return results;
  };

  return {
    schedule,
    flush,
    flushAll,
    drain: flushAll,
    cancel,
    isInFlight: (key: string) => inFlight.has(key),
    hasPending: (key?: string) => key === undefined
      ? pending.size > 0 || inFlight.size > 0
      : pending.has(key) || inFlight.has(key),
  };
};
