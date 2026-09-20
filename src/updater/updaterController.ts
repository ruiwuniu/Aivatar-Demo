export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "downloaded" | "saving" | "installing" | "error" | "disabled";

export interface UpdateSnapshot {
  revision: number;
  phase: UpdatePhase;
  currentVersion: string;
  checkedAt?: number | null;
  version?: string | null;
  notes?: string | null;
  downloadedBytes: number;
  totalBytes?: number | null;
  error?: string | null;
}

export interface UpdaterBridge {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<UpdateSnapshot>;
  listen: (receive: (snapshot: UpdateSnapshot) => void) => Promise<() => void>;
}

export const updateIsBusy = (phase: UpdatePhase) =>
  phase === "checking" || phase === "downloading" || phase === "saving" || phase === "installing";

export const updateProgress = (snapshot: UpdateSnapshot): number | null =>
  typeof snapshot.totalBytes === "number" && snapshot.totalBytes > 0
    ? Math.max(0, Math.min(100, Math.round(snapshot.downloadedBytes / snapshot.totalBytes * 100)))
    : null;

// One controller per WebView, with a single shared native subscription even
// under React StrictMode. The Rust coordinator owns all update operations and
// monotonic revisions, so a slow status request cannot replace newer progress.
export const createUpdaterController = (bridge: UpdaterBridge | null, automatic = true) => {
  let snapshot: UpdateSnapshot = {
    revision: 0, phase: bridge ? "idle" : "disabled", currentVersion: "", downloadedBytes: 0,
  };
  let localError: string | null = null;
  let view = snapshot;
  const listeners = new Set<() => void>();
  let generation = 0;
  let stop: (() => void) | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let automaticRequested = false;
  let activeAction: Promise<void> | null = null;
  const publish = () => {
    view = localError ? { ...snapshot, error: localError } : snapshot;
    listeners.forEach((listener) => listener());
  };
  const receive = (next: UpdateSnapshot) => {
    if (next.revision < snapshot.revision) return;
    snapshot = next;
    localError = null;
    publish();
  };
  const run = (command: string, args?: Record<string, unknown>): Promise<void> => {
    if (!bridge || activeAction || updateIsBusy(snapshot.phase)) return activeAction ?? Promise.resolve();
    localError = null;
    publish();
    activeAction = bridge.invoke(command, args).then(receive, (error: unknown) => {
      localError = String(error).slice(0, 500);
      publish();
    }).finally(() => { activeAction = null; });
    return activeAction;
  };
  const connect = () => {
    if (started || !bridge) return;
    started = true;
    const connection = ++generation;
    void (async () => {
      try {
        const unlisten = await bridge.listen((next) => { if (generation === connection) receive(next); });
        if (generation !== connection) { unlisten(); return; }
        stop = unlisten;
        const initial = await bridge.invoke("app_update_status");
        if (generation !== connection) return;
        receive(initial);
        if (automatic && !automaticRequested && snapshot.phase !== "disabled") {
          startupTimer = setTimeout(() => {
            if (generation !== connection) return;
            automaticRequested = true;
            void run("app_update_check", { automatic: true });
          }, 8_000);
        }
      } catch (error) {
        if (generation !== connection) return;
        localError = String(error).slice(0, 500);
        publish();
      }
    })();
  };
  return {
    getSnapshot: () => view,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
        if (listeners.size !== 0) return;
        generation += 1;
        started = false;
        stop?.();
        stop = undefined;
        if (startupTimer !== undefined) clearTimeout(startupTimer);
      };
    },
    check: () => run("app_update_check"),
    download: () => run("app_update_download"),
    install: () => run("app_update_install"),
  };
};

export type UpdaterController = ReturnType<typeof createUpdaterController>;
