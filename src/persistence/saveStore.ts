import { collectLegacyEntries, isAppStorageKey, prepareLegacyMigration } from "./legacySaveMigration";

export interface StorageView { getItem(key: string): string | null }
export interface StoreSnapshot {
  revision: number;
  entries: Record<string, { value: string | null; revision: number }>;
}
export interface StoreChange {
  key: string;
  oldValue: string | null;
  newValue: string | null;
  source: "local" | "remote";
}
export type TransactionBuilder<T> = (view: StorageView) => {
  changes: Record<string, string | null>;
  result: T;
};
type InvokeStore = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type CommitResult = { ok: true; snapshot: StoreSnapshot }
  | { ok: false; kind: "conflict"; snapshot: StoreSnapshot }
  | { ok: false; kind: "error" | "uncertain"; message: string; snapshot?: StoreSnapshot };
type StoreEvent = StoreSnapshot & { originSessionId?: string };
type StoreOptions = {
  native: boolean;
  storage: () => Storage;
  invoke: InvokeStore;
  listen: (callback: (snapshot: StoreEvent) => void) => Promise<() => void>;
  reportError?: (error: unknown) => void;
  retryDelay?: () => Promise<void>;
};

// Exposed as a factory so protocol faults can be tested without Tauri/user data.
export const createSaveStore = (options: StoreOptions) => {
  let snapshot: StoreSnapshot = { revision: -1, entries: Object.create(null) };
  let sessionId = "";
  let sequence = 0;
  let initialized = false;
  let initializing: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(event: StoreChange) => void>();
  const pendingValues = new Map<string, { value: string | null; generation: number }>();
  let valueGeneration = 0;
  const reportError = (error: unknown) => {
    try { options.reportError?.(error); } catch { /* Reporting cannot change commit results. */ }
  };
  const emit = (event: StoreChange) => {
    for (const listener of listeners) {
      try { listener(event); } catch (error) { reportError(error); }
    }
  };
  const apply = (next: StoreSnapshot, source: "local" | "remote") => {
    if (next.revision <= snapshot.revision) return;
    const previous = snapshot;
    snapshot = next;
    for (const key of new Set([...Object.keys(previous.entries), ...Object.keys(next.entries)])) {
      const oldValue = previous.entries[key]?.value ?? null;
      const newValue = next.entries[key]?.value ?? null;
      if (oldValue !== newValue) emit({ key, oldValue, newValue, source });
    }
  };
  const assertKey = (key: string) => {
    if (!isAppStorageKey(key)) throw new Error(`Unknown application storage key: ${key}`);
  };
  const getItem = (key: string): string | null => {
    assertKey(key);
    if (!options.native) return options.storage().getItem(key);
    if (!initialized) throw new Error("Application storage is not initialized.");
    return snapshot.entries[key]?.value ?? null;
  };
  const refresh = async () => {
    if (!options.native || !initialized) return;
    const next = await options.invoke("save_store_read", { sessionId }) as StoreSnapshot;
    apply(next, "remote");
  };
  const initialize = () => {
    if (initializing) return initializing;
    initializing = (async () => {
      if (!options.native) {
        const storage = options.storage();
        const migrated = prepareLegacyMigration(collectLegacyEntries(storage));
        for (const [key, value] of Object.entries(migrated.entries)) {
          if (storage.getItem(key) !== value) storage.setItem(key, value);
        }
        initialized = true;
        return;
      }
      const buffered: StoreEvent[] = [];
      const unlisten = await options.listen((event) => {
        if (!initialized) buffered.push(event);
        else apply(event, event.originSessionId === sessionId ? "local" : "remote");
      });
      try {
        const bootstrap = await options.invoke("save_store_bootstrap") as {
          sessionId: string; initialized: boolean; snapshot: StoreSnapshot;
        };
        sessionId = bootstrap.sessionId;
        let next = bootstrap.snapshot;
        if (!bootstrap.initialized) {
          const migration = prepareLegacyMigration(collectLegacyEntries(options.storage()));
          next = await options.invoke("save_store_migrate", {
            sessionId, ...migration,
            origin: typeof location === "undefined" ? "synthetic" : location.origin,
          }) as StoreSnapshot;
        }
        // Validate critical native values too. A read error is never a default save.
        prepareLegacyMigration(Object.fromEntries(Object.entries(next.entries)
          .filter(([, entry]) => entry.value !== null)
          .map(([key, entry]) => [key, entry.value as string])));
        initialized = true;
        apply(next, "remote");
        for (const event of buffered) apply(event, event.originSessionId === sessionId ? "local" : "remote");
      } catch (error) {
        unlisten();
        initializing = undefined;
        throw error;
      }
    })().catch((error) => {
      initializing = undefined;
      throw error;
    });
    return initializing;
  };
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const result = tail.catch(() => undefined).then(run);
    tail = result;
    // Effects may intentionally fire a write and rely on drain for persistence.
    // Install rejection reporting without altering the returned Promise.
    void result.catch(reportError);
    return result;
  };
  const transact = <T>(build: TransactionBuilder<T>): Promise<T> => {
    const acceptedGeneration = valueGeneration;
    const retireValues = (keys: string[]) => {
      for (const key of keys) {
        const pending = pendingValues.get(key);
        if (pending && pending.generation <= acceptedGeneration) pendingValues.delete(key);
      }
    };
    return enqueue(async () => {
    if (options.native && !initialized) throw new Error("Application storage is not initialized.");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await refresh();
      const expected: Record<string, number> = Object.create(null);
      const view: StorageView = { getItem(key) {
        assertKey(key);
        expected[key] = snapshot.entries[key]?.revision ?? 0;
        return getItem(key);
      } };
      const built = build(view);
      const changes: Record<string, string | null> = Object.create(null);
      for (const [key, value] of Object.entries(built.changes)) {
        assertKey(key);
        if (typeof value !== "string" && value !== null) throw new TypeError("Stored values must be strings or null.");
        const before = view.getItem(key);
        if (before !== value) changes[key] = value;
      }
      if (!Object.keys(changes).length) { retireValues(Object.keys(built.changes)); return built.result; }
      if (!options.native) {
        // Browser preview deliberately keeps its existing origin-scoped backend.
        // It does not promise SQLite multi-key atomicity across tabs.
        const storage = options.storage();
        for (const [key, value] of Object.entries(changes)) {
          const oldValue = storage.getItem(key);
          if (value === null) storage.removeItem(key); else storage.setItem(key, value);
          emit({ key, oldValue, newValue: value, source: "local" });
        }
        retireValues(Object.keys(built.changes));
        return built.result;
      }
      const request = { sessionId, operationId: ++sequence, expected, changes };
      let reply: CommitResult;
      for (;;) {
        try {
          reply = await options.invoke("save_store_commit", request) as CommitResult;
          if (!reply.ok && reply.kind === "uncertain") {
            // COMMIT may have taken effect before a final filesystem sync failed.
            // Keep the same receipt; a new business operation could apply twice.
            reportError(new Error(reply.message));
            await (options.retryDelay?.() ?? new Promise((resolve) => setTimeout(resolve, 1000)));
            continue;
          }
          break;
        } catch (error) {
          // Transport loss does not prove rollback. Keep this operation's Promise
          // and ID alive until its receipt is known; never rerun its business delta.
          reportError(error);
          await (options.retryDelay?.() ?? new Promise((resolve) => setTimeout(resolve, 1000)));
        }
      }
      if (reply.snapshot) apply(reply.snapshot, reply.ok ? "local" : "remote");
      if (reply.ok) { retireValues(Object.keys(built.changes)); return built.result; }
      if (reply.kind === "error") throw new Error(reply.message);
      // Conflict: build against the new committed state, including all read keys.
    }
    throw new Error("The save changed repeatedly in another window. Please retry.");
    });
  };
  const writeValue = (key: string, value: string | null): Promise<void> => {
    assertKey(key);
    const pending = { value, generation: ++valueGeneration };
    pendingValues.set(key, pending);
    const result = transact(() => ({ changes: { [key]: value }, result: undefined })).then(() => {
      if (pendingValues.get(key) === pending) pendingValues.delete(key);
    });
    void result.catch(reportError);
    return result;
  };
  const drain = async () => {
    await tail.catch(() => undefined);
    // Plain preferences retain their intended value on I/O failure. Business
    // transactions are retried by their owners with their original operation IDs.
    for (const [key, pending] of [...pendingValues]) {
      // Retrying is not a new user intent. A transaction already queued before
      // this retry may supersede the old value, so check its identity when the
      // retry actually executes, and keep the original generation.
      await transact(() => ({
        changes: pendingValues.get(key) === pending ? { [key]: pending.value } : {},
        result: undefined,
      }));
    }
    while (true) {
      const current = tail;
      await current;
      if (tail === current) return;
    }
  };
  return {
    initialize, refresh, getItem, transact, drain,
    setItem: (key: string, value: string) => writeValue(key, value),
    removeItem: (key: string) => writeValue(key, null),
    subscribe: (listener: (event: StoreChange) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    receiveBrowserEvent: (event: Pick<StorageEvent, "key" | "oldValue" | "newValue">) => {
      if (!options.native && event.key && isAppStorageKey(event.key)) emit({
        key: event.key, oldValue: event.oldValue, newValue: event.newValue, source: "remote",
      });
    },
  };
};

const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const reportStorageError = (error: unknown) => {
  console.error("Aivatar could not finish saving.", error);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aivatar:storage-error", {
    detail: error instanceof Error ? error.message : String(error),
  }));
};
// Options are evaluated lazily: importing this module does not touch legacy data.
let shared: ReturnType<typeof createSaveStore> | undefined;
const store = () => shared ??= createSaveStore({
  native: isDesktop(),
  storage: () => globalThis.localStorage,
  invoke: async (command, args) => (await import("@tauri-apps/api/core")).invoke(command, args),
  listen: async (callback) => (await import("@tauri-apps/api/event"))
    .listen<StoreEvent>("aivatar://store-changed", (event) => callback(event.payload)),
  reportError: reportStorageError,
});
export const appStorage = {
  getItem: (key: string) => store().getItem(key),
  setItem: (key: string, value: string) => store().setItem(key, value),
  removeItem: (key: string) => store().removeItem(key),
  transact: <T>(build: TransactionBuilder<T>) => store().transact(build),
};
export const transactStore = appStorage.transact;
export const subscribeStore = (listener: (event: StoreChange) => void) => store().subscribe(listener);
export const drainStore = () => store().drain();
let windowEventsRegistered = false;
export const initializeSaveStore = async () => {
  await store().initialize();
  if (typeof window !== "undefined" && !windowEventsRegistered) {
    windowEventsRegistered = true;
    window.addEventListener("storage", (event) => store().receiveBrowserEvent(event));
    window.addEventListener("focus", () => { void store().refresh().catch(reportStorageError); });
  }
};
let closing = false;
let pausedOperations = 0;
let lastPaused = false;
const pauseListeners = new Set<(paused: boolean) => void>();
export const isStoreClosing = () => closing || pausedOperations > 0;
export const subscribeStorePause = (listener: (paused: boolean) => void) => {
  pauseListeners.add(listener);
  listener(isStoreClosing());
  return () => { pauseListeners.delete(listener); };
};
const updateInteractionBarrier = () => {
  if (typeof document !== "undefined") {
    const root = document.getElementById("root");
    if (root) root.inert = isStoreClosing();
  }
  if (lastPaused !== isStoreClosing()) {
    lastPaused = isStoreClosing();
    for (const listener of pauseListeners) {
      try { listener(lastPaused); } catch (error) { reportStorageError(error); }
    }
  }
};
export const setStoreClosing = (value: boolean) => { closing = value; updateInteractionBarrier(); };
export const pauseStoreUpdates = () => {
  pausedOperations += 1;
  updateInteractionBarrier();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pausedOperations -= 1;
    updateInteractionBarrier();
  };
};
export const reportSaveError = reportStorageError;
