// Loaded only by the separate QA Vite config. The native synthetic marker is mandatory.
export {};
const globals = window as unknown as Record<string, any>;
if (globals.__AIVATAR_SYNTHETIC_NETWORK_ISOLATED__ !== true) {
  throw new Error("Desktop QA requires native synthetic network isolation");
}
const errors: Array<{ at: number; kind: string; message: string; source?: string }> = [];
const recordError = (kind: string, reason: unknown, source?: string) => {
  const message = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason);
  errors.push({ at: performance.now(), kind, message: message.slice(0, 2000), ...(source ? { source: source.slice(0, 500) } : {}) });
  if (errors.length > 16) errors.splice(0, errors.length - 16);
};
window.addEventListener("error", event => recordError("error", event.error ?? event.message,
  `${event.filename}:${event.lineno}:${event.colno}`));
window.addEventListener("unhandledrejection", event => recordError("unhandledrejection", event.reason));
const frameProbe = { count: 0, firstAt: null as number | null, lastAt: null as number | null };
const sampleFrame = (now: number) => {
  frameProbe.count += 1;
  frameProbe.firstAt ??= now;
  frameProbe.lastAt = now;
  window.requestAnimationFrame(sampleFrame);
};
window.requestAnimationFrame(sampleFrame);
let pollCount = 0;
const statuses = new Set(["idle", "thinking", "executing", "waiting_for_user", "complete", "error"]);
const sockets = new Set<WebSocket>();
let snapshot: Record<string, unknown> | null = null;
let revision: unknown;
const OriginalSocket = window.WebSocket;
window.WebSocket = new Proxy(OriginalSocket, {
  construct(Target, args, NewTarget) {
    const socket = Reflect.construct(Target, args, NewTarget) as WebSocket;
    if (String(args[0]).includes(":38987/")) sockets.add(socket);
    return socket;
  },
});
const isolatedFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.port === "38988" && url.pathname === "/agent-status" && snapshot) {
    return Promise.resolve(new Response(JSON.stringify(snapshot), { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  return isolatedFetch(input, options);
};
const sampleCanvasAlpha = (canvas: HTMLCanvasElement) => {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height || width * height > 16_777_216) return { skipped: "outside bounded QA sample size" };
  try {
    const context = canvas.getContext("2d");
    if (!context) return { skipped: "no 2d context" };
    const pixels = context.getImageData(0, 0, width, height).data;
    let sampledPixels = 0;
    let nonzeroSamples = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 8) {
      for (let x = 0; x < width; x += 8) {
        sampledPixels += 1;
        if (pixels[(y * width + x) * 4 + 3] === 0) continue;
        nonzeroSamples += 1;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    return { stride: 8, sampledPixels, nonzeroSamples,
      sampledBounds: nonzeroSamples ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
  } catch (error) { return { error: String(error).slice(0, 300) }; }
};
const report = async (control: Record<string, any>) => {
  const internal = globals.__TAURI_INTERNALS__;
  if (!internal?.invoke) return;
  // Read only the already-initialized, native synthetic store. Do not inspect
  // browser localStorage or use any filesystem/user-profile fallback.
  const { appStorage } = await import("../../src/persistence/saveStore");
  const activeSlotId = appStorage.getItem("aivatar.activeSaveSlot.v1");
  const saved = activeSlotId ? JSON.parse(appStorage.getItem(`aivatar.saveSlot.v1.${activeSlotId}`) ?? "null") : null;
  const desktopLayout = activeSlotId ? JSON.parse(appStorage.getItem(`aivatar.desktopLayout.v1.${activeSlotId}`) ?? "null") : null;
  await internal.invoke("save_store_synthetic_control", { action: "report", report: {
    kind: "desktop-mode-qa", revision: control.revision, status: control.status,
    viewport: { width: innerWidth, height: innerHeight },
    bodyClass: document.body.className,
    diagnostics: { at: performance.now(), visibilityState: document.visibilityState, hasFocus: document.hasFocus(),
      pollCount, frameProbe: { ...frameProbe, ageMs: frameProbe.lastAt === null ? null : performance.now() - frameProbe.lastAt }, errors: [...errors] },
    text: document.body.innerText.slice(0, 12_000),
    canvas: Array.from(document.querySelectorAll("canvas")).slice(0, 3).map(canvas => ({ width: canvas.width, height: canvas.height,
      rect: { x: canvas.getBoundingClientRect().x, y: canvas.getBoundingClientRect().y, width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height },
      alpha: sampleCanvasAlpha(canvas) })),
    bridgeAudit: globals.__AIVATAR_SYNTHETIC_NETWORK_AUDIT__,
    persistence: { activeSlotId, wallet: saved?.wallet ?? null,
      rewardedCompletionIds: saved?.rewardedCompletionIds?.slice(-10) ?? [], desktopLayout },
  } });
};
const poll = async () => {
  pollCount += 1;
  try {
    const control = await isolatedFetch("/__desktop_qa_control").then(response => response.json());
    if (control.revision === revision || !statuses.has(control.status)) return;
    revision = control.revision;
    const status = { agent: "codex", sessionId: "synthetic-desktop-qa", connected: true,
      status: control.status, phase: "synthetic-desktop-qa", message: String(control.message ?? `Synthetic ${control.status}`),
      summary: String(control.message ?? `Synthetic ${control.status}`), timestamp: new Date().toISOString(),
      ...(control.status === "complete" ? { rewardId: String(control.rewardId ?? `synthetic-desktop-qa:${control.revision}`) } : {}) };
    snapshot = { type: "aivatar.status.snapshot", currentStatus: status, sessions: [status],
      activeSessionKey: "codex:synthetic-desktop-qa", currentSessionKey: "codex:synthetic-desktop-qa", connectedSessionKey: "codex:synthetic-desktop-qa" };
    for (const socket of sockets) {
      if (socket.readyState === 3) { sockets.delete(socket); continue; }
      socket.onmessage?.call(socket, new MessageEvent("message", { data: JSON.stringify(snapshot) }));
    }
    window.setTimeout(() => void report(control).catch(console.error), 1500);
  } catch (error) { console.error("Synthetic desktop QA control:", error); }
};
window.setInterval(() => void poll(), 500);
void poll();
