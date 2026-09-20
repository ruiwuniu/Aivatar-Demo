import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import WebSocket from "ws";

// Exercises the mounted App while a synthetic native commit is held/rejected.
// Virtual time and paused simulation isolate deferred rewards, learning and
// asynchronous producers. Chrome's fresh profile and bridge interception keep
// all saves and native calls inside this synthetic fixture.
const repo = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aivatar-pause-ui-smoke-"));
const epoch = Date.now();
const slotA = `persistence-smoke-a-${epoch}`;
const slotB = `persistence-smoke-b-${epoch}`;
const keyA = `aivatar.saveSlot.v1.${slotA}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reports = [];
const clients = [];
let vite;
let browser;

async function waitFor(fn, label, timeout = 30_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(50);
  }
  throw new Error(`${label} timed out${last ? `: ${last.message}` : ""}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

class CdpClient {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.networkBridgeRequests = [];
    this.exceptions = [];
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.method === "Network.requestWillBeSent" && /:3898[78](?:\/|$)/.test(message.params.request.url)) {
        this.networkBridgeRequests.push(message.params.request.url);
      }
      if (message.method === "Runtime.exceptionThrown") this.exceptions.push(message.params.exceptionDetails);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  async send(method, params = {}) {
    await this.opened;
    const id = ++this.id;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }
  async evaluate(expression) {
    const output = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (output.exceptionDetails) throw new Error(output.exceptionDetails.exception?.description ?? output.exceptionDetails.text);
    return output.result?.value;
  }
}

function installHarness({ origin, epoch, slotA, slotB }) {
  if (location.origin !== origin) return;
  const nativeDate = Date;
  const nativeSet = Storage.prototype.setItem;
  let now = epoch;
  let nextTimer = 1;
  const timers = new Map();
  const writes = [];
  const bridge = [];
  const sockets = new Set();
  // MessageChannel drains React work without hidden-window timer throttling.
  const taskChannel = new MessageChannel();
  const taskQueue = [];
  taskChannel.port1.onmessage = () => taskQueue.shift()?.();
  const tick = () => new Promise((resolve) => { taskQueue.push(resolve); taskChannel.port2.postMessage(null); });
  const drain = async () => { await tick(); await tick(); await tick(); };
  window.Date = class extends nativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  Object.defineProperty(performance, "now", { configurable: true, value: () => now - epoch });
  const addTimer = (callback, wait, interval, args) => {
    const id = nextTimer++;
    timers.set(id, { callback, at: now + Math.max(1, Number(wait) || 0), interval, args });
    return id;
  };
  window.setTimeout = (callback, wait = 0, ...args) => addTimer(callback, wait, 0, args);
  window.setInterval = (callback, wait = 0, ...args) => Number(wait) < 100
    ? nextTimer++
    : addTimer(callback, wait, Math.max(1, Number(wait) || 0), args);
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = () => nextTimer++;
  window.cancelAnimationFrame = () => {};

  const isBridge = (input) => {
    try { return ["38987", "38988"].includes(new URL(typeof input === "string" ? input : input.url, location.href).port); }
    catch { return false; }
  };
  const idle = () => ({ agent: "aivatar", sessionId: "isolated-smoke", status: "idle", phase: "smoke", timestamp: new Date().toISOString() });
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (!isBridge(input)) return realFetch(input, init);
    const url = String(typeof input === "string" ? input : input.url);
    bridge.push({ transport: "fetch", url });
    const body = url.includes("/rooms") ? { rooms: [], visits: [] } : url.includes("/agent-status") ? idle() : { ok: true };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  };
  const realBeacon = navigator.sendBeacon?.bind(navigator);
  navigator.sendBeacon = (url, body) => {
    if (isBridge(url)) { bridge.push({ transport: "beacon", url: String(url) }); return true; }
    return realBeacon ? realBeacon(url, body) : false;
  };
  const realXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (isBridge(url)) { bridge.push({ transport: "xhr-blocked", url: String(url) }); throw new Error("Synthetic smoke blocks real bridge XHR"); }
    return realXhrOpen.call(this, method, url, ...args);
  };
  const RealSocket = window.WebSocket;
  class FakeSocket extends EventTarget {
    constructor(url) {
      super(); this.url = String(url); this.readyState = 0; sockets.add(this);
      bridge.push({ transport: "websocket", url: this.url });
      queueMicrotask(() => { this.readyState = 1; this.onopen?.(new Event("open")); });
    }
    send() {}
    close() { this.readyState = 3; sockets.delete(this); this.onclose?.(new Event("close")); }
  }
  window.WebSocket = new Proxy(RealSocket, { construct(target, args) { return isBridge(args[0]) ? new FakeSocket(args[0]) : new target(...args); } });

  if (!localStorage.getItem("aivatar.persistenceSmokeSeed")) {
    const slots = [slotA, slotB].map((id, index) => ({
      id, slotIndex: index, avatarId: `avatar-${id}`, roomId: `room-${id}`,
      avatarName: index ? "Persistence B" : "Persistence A", avatarAppearanceId: "octopus",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
    for (const slot of slots) nativeSet.call(localStorage, `aivatar.saveSlot.v1.${slot.id}`, JSON.stringify({
      avatarId: slot.avatarId, roomId: slot.roomId, avatarName: slot.avatarName, avatarAppearanceId: "octopus",
      wallet: { bits: 200, pokerChips: 10 }, inventory: [], placedItems: [], purchasedItemIds: [],
      petStats: { energy: 80, mood: 80, hunger: 80 },
    }));
    nativeSet.call(localStorage, "aivatar.saveSlots.v1", JSON.stringify(slots));
    nativeSet.call(localStorage, "aivatar.activeSaveSlot.v1", slotA);
    nativeSet.call(localStorage, "aivatar.locale.v1", "en");
    nativeSet.call(localStorage, "aivatar.audioVolume.v1", "0");
    nativeSet.call(localStorage, "aivatar.persistenceSmokeSeed", "synthetic");
  }
  Storage.prototype.setItem = function(key, value) {
    let parsed;
    try { parsed = JSON.parse(String(value)); } catch {}
    writes.push({ key: String(key), characters: String(value).length, at: now, marker: parsed?.navMemory?.exploredCells?.["persistence-smoke"] });
    return nativeSet.call(this, key, value);
  };
  function appFiber() {
    const root = document.getElementById("root");
    const container = root?.[Object.keys(root).find((key) => key.startsWith("__reactContainer$"))];
    const stack = [container?.stateNode?.current ?? container];
    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber) continue;
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.type?.name !== "App") continue;
      return fiber;
    }
    throw new Error("Mounted App fiber was not found");
  }
  function appHooks() {
    const hooks = [];
    for (let hook = appFiber().memoizedState; hook; hook = hook.next) hooks.push(hook);
    return hooks;
  }
  function saveHook() {
    const candidates = appHooks().filter((hook) => hook.queue?.dispatch && hook.memoizedState?.wallet && hook.memoizedState?.petStats && Array.isArray(hook.memoizedState.inventory) && Array.isArray(hook.memoizedState.purchasedItemIds) && !hook.memoizedState.room);
    if (candidates.length !== 1) throw new Error(`Expected one App save state, found ${candidates.length}`);
    return candidates[0];
  }
  window.__persistenceSmoke = {
    writes, bridge, drain,
    read: (id = slotA) => JSON.parse(localStorage.getItem(`aivatar.saveSlot.v1.${id}`)),
    state: () => saveHook().memoizedState,
    async changeNavigation(marker) {
      saveHook().queue.dispatch((current) => ({ ...current, navMemory: {
        ...current.navMemory,
        exploredCells: { ...current.navMemory?.exploredCells, "persistence-smoke": marker },
        successes: marker, lastExploredAt: new Date().toISOString(),
      } }));
      await drain();
    },
    async advance(milliseconds) {
      const target = now + milliseconds;
      let steps = 0;
      while (true) {
        let next;
        for (const [id, timer] of timers) if (timer.at <= target && (!next || timer.at < next[1].at)) next = [id, timer];
        if (!next) break;
        if (++steps > 50000) throw new Error("Synthetic timer starvation guard reached");
        const [id, timer] = next;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
        if (typeof timer.callback !== "function") throw new Error("Unexpected string timer in application");
        timer.callback(...timer.args);
        await drain();
      }
      now = target;
      await drain();
    },
    async emitStatus(payload) {
      for (const socket of sockets) socket.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ ...payload, timestamp: new Date().toISOString() }) }));
      await drain();
    },
  };
}

async function addPage(debugPort, targetId, origin) {
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json())
    .find((entry) => entry.type === "page" && (!targetId || entry.id === targetId)), "Chrome target");
  const client = new CdpClient(target.webSocketDebuggerUrl);
  clients.push(client);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await client.send("Network.enable");
  await client.send("Network.setBlockedURLs", { urls: ["*:38987/*", "*:38988/*"] });
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installHarness})(${JSON.stringify({ origin, epoch, slotA, slotB })}); (${installNativeMock})(${JSON.stringify({ slotA, slotB })})` });
  await client.send("Page.navigate", { url: `${origin}/?slotId=${slotA}` });
  await waitFor(() => client.evaluate("Boolean(window.__persistenceSmoke && document.querySelector('.shop-category-tab') && !document.querySelector('.save-slot-overlay'))"), "Mounted synthetic App");
  await client.evaluate("__persistenceSmoke.drain()");
  return client;
}

async function telemetry(client, duration, startMarker) {
  return client.evaluate(`(async () => {
    const h = __persistenceSmoke;
    const start = h.writes.length;
    for (let i = 1; i <= ${duration / 500}; i++) {
      await h.changeNavigation(${startMarker} + i);
      await h.advance(500);
    }
    const writes = h.writes.slice(start).filter((entry) => entry.key === ${JSON.stringify(keyA)});
    return { milliseconds: ${duration}, updates: ${duration / 500}, writes, marker: h.read().navMemory?.exploredCells?.['persistence-smoke'] };
  })()`);
}

// All native commands below terminate in this memory-only mock. The mounted
// React App and its real native saveStore branch are used unchanged, apart from
// exposing its state updater to inject one asynchronous producer in the test.
function installNativeMock({ slotA }) {
  if (!window.__persistenceSmoke) return;
  const entries = {};
  let revision = 1;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("aivatar.") && key !== "aivatar.persistenceSmokeSeed") entries[key] = { value: localStorage.getItem(key), revision };
  }
  const callbacks = new Map(), listeners = new Map();
  let nextId = 1, heldResolve, heldArgs, holdKey;
  const acknowledgements = [];
  const snapshot = () => structuredClone({ revision, entries });
  const slotKey = `aivatar.saveSlot.v1.${slotA}`;
  const commands = [];
  const commit = (args) => {
    if (Object.entries(args.expected).some(([key, expected]) => (entries[key]?.revision ?? 0) !== expected)) {
      return { ok: false, kind: "conflict", snapshot: snapshot() };
    }
    revision += 1;
    for (const [key, value] of Object.entries(args.changes)) {
      entries[key] = { value, revision };
      window.__persistenceSmoke.writes.push({ key, value, at: Date.now() });
    }
    return { ok: true, snapshot: snapshot() };
  };
  window.__nativePauseSmoke = {
    acknowledgements, commands,
    holdNextCommit(key = slotKey) { holdKey = key; },
    held: () => Boolean(heldResolve),
    commitHeld() {
      const resolve = heldResolve, args = heldArgs;
      heldResolve = undefined; heldArgs = undefined;
      resolve(commit(args));
    },
    failHeld() {
      const resolve = heldResolve; heldResolve = undefined; heldArgs = undefined;
      resolve({ ok: false, kind: "error", message: "synthetic commit failure", snapshot: snapshot() });
    },
    emitClose(requestId) {
      for (const [id, entry] of listeners) if (entry.event === "aivatar://save-before-close") {
        callbacks.get(entry.handler)?.({ event: entry.event, id, payload: { requestId } });
      }
    },
  };
  window.__persistenceSmoke.read = (id = slotA) => JSON.parse(entries[`aivatar.saveSlot.v1.${id}`]?.value ?? "null");
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { listeners.delete(id); } };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback) { const id = nextId++; callbacks.set(id, callback); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc(path) { return path; },
    async invoke(command, args = {}) {
      commands.push(command);
      if (command === "save_store_bootstrap") return { initialized: true, sessionId: "synthetic-pause", snapshot: snapshot() };
      if (command === "save_store_read") return snapshot();
      if (command === "save_store_commit") {
        if (holdKey && args.changes[holdKey] !== undefined) {
          holdKey = undefined;
          heldArgs = args;
          return new Promise((resolve) => { heldResolve = resolve; });
        }
        return commit(args);
      }
      if (command === "plugin:event|listen") { const id = nextId++; listeners.set(id, args); return id; }
      if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return; }
      if (command === "confirm_close_after_save") { acknowledgements.push(args); return; }
      if (command.includes("scale_factor")) return 1;
      if (command.includes("size")) return { width: 1000, height: 800 };
      if (command.includes("position")) return { x: 0, y: 0 };
      if (command.includes("monitor")) return null;
      if (command.includes("is_")) return false;
      if (command === "read_social_room_memory") return null;
      if (command.includes("integration")) return [];
      return {};
    },
  };
  window.alert = () => undefined;
}

try {
  console.log(`Synthetic pause UI profile and report retained at: ${temporary}`);
  const executable = [process.env.AIVATAR_SMOKE_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((entry) => fs.existsSync(entry));
  assert.ok(executable, "Chrome/Edge is required");
  vite = await createServer({ configFile: false, root: repo, envDir: temporary, cacheDir: path.join(temporary, "vite-cache"),
    optimizeDeps: { entries: [path.join(repo, "index.html")] },
    plugins: [{ name: "synthetic-pause-producer", enforce: "pre", transform(code, id) {
      if (!id.endsWith("/src/App.tsx")) return;
      const marker = "  const urgentSaveRef = useRef(false);";
      assert(code.includes(marker));
      return code.replace(marker, "  (window as any).__pauseAppSetSave = setSave;\n  (window as any).__pauseAppSetSaveForSlot = setSaveForSlot;\n  (window as any).__pauseParseImportedSave = (raw: string) => parseImportedSave(contentBase, raw);\n" + marker);
    } }, react()], logLevel: "warn", clearScreen: false,
    server: { host: "127.0.0.1", port: await freePort(), strictPort: true, hmr: false } });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const debugPort = await freePort();
  browser = spawn(executable, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(temporary, "chrome-profile")}`,
    "--no-first-run", "--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-sync",
    "--headless=new", "--window-size=1000,800", "about:blank"], { stdio: "ignore" });
  const client = await addPage(debugPort, null, origin);
  await client.evaluate("(async () => { await (await import('/src/persistence/saveStore.ts')).drainStore(); await __persistenceSmoke.drain(); })()");
  const before = await client.evaluate("__persistenceSmoke.read().wallet.bits");
  await client.evaluate("__persistenceSmoke.changeNavigation(9901)");
  await client.evaluate("__nativePauseSmoke.holdNextCommit(); __nativePauseSmoke.emitClose(101)");
  await waitFor(() => client.evaluate("__nativePauseSmoke.held()"), "held native save commit");
  await client.evaluate(`(async () => {
    await __persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'pause-reward', status: 'thinking', phase: 'user-message' });
    await __persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'pause-reward', status: 'complete', phase: 'final', rewardId: 'pause-reward-once' });
    await __persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'pause-reward', status: 'idle', phase: 'idle' });
    await __persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'pause-fresh-only', status: 'complete', phase: 'final', rewardId: 'pause-fresh-only' });
    for (const id of ['pause-learning-one', 'pause-learning-two']) {
      await __persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'pause-learning', status: 'complete', phase: 'session-learning', learning: {
        id, source: 'heuristic', summary: 'Synthetic paused learning', privacyRisk: 'low', xp: 1,
      } });
    }
    await __persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'pause-learning', status: 'idle', phase: 'idle' });
    await Promise.resolve();
    __pauseAppSetSave((current) => ({ ...current, avatarName: 'Deferred response retained' }));
    await __persistenceSmoke.drain();
  })()`);
  const frozen = await client.evaluate("({ bits: __persistenceSmoke.state().wallet.bits, ids: __persistenceSmoke.state().rewardedCompletionIds ?? [], acks: __nativePauseSmoke.acknowledgements.length })");
  assert.equal(frozen.bits, before);
  assert(!frozen.ids.includes("pause-reward-once"));
  assert.equal(frozen.acks, 0);
  await client.evaluate("__persistenceSmoke.advance(12001)");
  await client.evaluate("__nativePauseSmoke.failHeld()");
  await waitFor(() => client.evaluate("__nativePauseSmoke.acknowledgements.length === 1 && __persistenceSmoke.read().rewardedCompletionIds?.includes('pause-reward-once')"), "failed close resumes queued completion");
  const after = await client.evaluate("({ save: __persistenceSmoke.read(), acks: __nativePauseSmoke.acknowledgements, inert: document.getElementById('root').inert })");
  assert.equal(after.acks[0].ok, false);
  assert.equal(after.inert, false);
  assert.equal(after.save.wallet.bits, before + 8);
  assert(after.save.rewardedCompletionIds.includes('pause-fresh-only'), "arrival-time freshness must survive the 12 second wait without a thinking transition");
  assert.equal(after.save.memory.recentEvents.filter((event) => event.id.startsWith('learning:codex:pause-learning:pause-learning-')).length, 2);
  assert.equal(after.save.avatarName, "Deferred response retained");
  assert.equal(after.save.navMemory.exploredCells["persistence-smoke"], 9901);
  await client.evaluate("__persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'pause-reward', status: 'complete', phase: 'final', rewardId: 'pause-reward-once' })");
  await client.evaluate("(async () => { await (await import('/src/persistence/closeSave.ts')).retryPendingSaves(); await __persistenceSmoke.drain(); })()");
  assert.equal(await client.evaluate("__persistenceSmoke.read().wallet.bits"), before + 8);
  const invalidImport = await client.evaluate(`(() => {
    try { __pauseParseImportedSave(JSON.stringify({ avatarName: 'Invalid import', wallet: { bits: 'bad' } })); return false; }
    catch { return true; }
  })()`);
  assert.equal(invalidImport, true, "explicit import must not turn an invalid economy record into defaults");
  await client.evaluate(`(async () => {
    document.querySelector('button.settings-toggle').click(); await __persistenceSmoke.drain();
    [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Saves').click();
    await __persistenceSmoke.drain();
    __nativePauseSmoke.holdNextCommit('aivatar.activeSaveSlot.v1');
    const card = [...document.querySelectorAll('.save-slot-card')].find((entry) => entry.textContent.includes('Persistence B'));
    card.querySelector('.save-slot-enter-button').click(); await __persistenceSmoke.drain();
  })()`);
  await waitFor(() => client.evaluate("__nativePauseSmoke.held()"), "held A to B switch transaction");
  const beforeSwitch = await client.evaluate(`({ a: __persistenceSmoke.read(), b: __persistenceSmoke.read(${JSON.stringify(slotB)}) })`);
  await client.evaluate(`(async () => {
    await __persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'switch-source-a', status: 'thinking', phase: 'user-message' });
    await __persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'switch-learning-source-a', status: 'complete', phase: 'session-learning', learning: {
      id: 'switch-learning-source-a', source: 'heuristic', summary: 'Synthetic learning belongs to A', privacyRisk: 'low', xp: 1,
    } });
    await __persistenceSmoke.emitStatus({ agent: 'codex', sessionId: 'switch-source-a', status: 'complete', phase: 'final', rewardId: 'switch-reward-source-a' });
  })()`);
  assert.equal(await client.evaluate("__persistenceSmoke.state().wallet.bits"), beforeSwitch.a.wallet.bits);
  assert.equal(await client.evaluate(`__persistenceSmoke.read(${JSON.stringify(slotB)}).wallet.bits`), beforeSwitch.b.wallet.bits);
  await client.evaluate("__nativePauseSmoke.commitHeld()");
  await waitFor(() => client.evaluate("__persistenceSmoke.state().avatarName === 'Persistence B' && __persistenceSmoke.read().rewardedCompletionIds?.includes('switch-reward-source-a')"), "source A receives queued events after committed switch to B");
  await client.evaluate("(async () => { await (await import('/src/persistence/closeSave.ts')).retryPendingSaves(); await __persistenceSmoke.drain(); })()");
  const afterSwitch = await client.evaluate(`({ a: __persistenceSmoke.read(), b: __persistenceSmoke.read(${JSON.stringify(slotB)}), ui: __persistenceSmoke.state() })`);
  assert.equal(afterSwitch.a.wallet.bits, beforeSwitch.a.wallet.bits + 4);
  assert.equal(afterSwitch.a.rewardedCompletionIds.filter((id) => id === 'switch-reward-source-a').length, 1);
  assert.equal(afterSwitch.a.memory.recentEvents.filter((event) => event.id === 'learning:codex:switch-learning-source-a:switch-learning-source-a').length, 1);
  assert.equal(afterSwitch.b.wallet.bits, beforeSwitch.b.wallet.bits, "resume must not synthesize a new complete arrival for B");
  assert(!afterSwitch.b.rewardedCompletionIds?.includes('switch-reward-source-a'));
  assert(!afterSwitch.b.memory.recentEvents.some((event) => event.sessionId === 'switch-source-a'));
  assert.equal(afterSwitch.ui.wallet.bits, beforeSwitch.b.wallet.bits);
  reports.push({ case: "status-arrival-retains-source-slot-through-switch", sourceRewardOnce: true, sourceLearningOnce: true, destinationWalletUnchanged: true, resumeCreatedNoArrival: true });
  await client.evaluate(`(async () => {
    const timestamp = new Date().toISOString();
    const oldComplete = { agent: 'codex', sessionId: 'switch-source-a', status: 'complete', phase: 'final', rewardId: 'switch-reward-source-a', timestamp };
    const oldLearning = { agent: 'codex', sessionId: 'switch-learning-source-a', status: 'complete', phase: 'session-learning', timestamp, learning: {
      id: 'switch-learning-source-a', source: 'heuristic', summary: 'Synthetic learning belongs to A', privacyRisk: 'low', xp: 1,
    } };
    const newThinking = { agent: 'codex', sessionId: 'snapshot-changed-session', status: 'thinking', phase: 'user-message', timestamp };
    await __persistenceSmoke.emitStatus({ type: 'aivatar.status.snapshot', currentStatus: newThinking, sessions: [oldComplete, oldLearning, newThinking] });
    await __persistenceSmoke.emitStatus({ type: 'aivatar.status.snapshot', currentStatus: oldLearning, sessions: [oldComplete, oldLearning, { ...newThinking, status: 'idle' }] });
    await (await import('/src/persistence/closeSave.ts')).retryPendingSaves();
    await __persistenceSmoke.drain();
  })()`);
  const afterSnapshots = await client.evaluate(`({ a: __persistenceSmoke.read(), b: __persistenceSmoke.read(${JSON.stringify(slotB)}) })`);
  assert.equal(afterSnapshots.a.wallet.bits, afterSwitch.a.wallet.bits);
  assert.equal(afterSnapshots.b.wallet.bits, beforeSwitch.b.wallet.bits, "unchanged snapshot members must keep their original arrival ownership");
  assert(!afterSnapshots.b.memory.recentEvents.some((event) => ['switch-source-a', 'switch-learning-source-a'].includes(event.sessionId)));
  reports.push({ case: "unchanged-snapshot-members-are-not-new-arrivals", sourceRewardOnce: true, destinationRewardAndLearningAbsent: true });
  await client.evaluate(`(async () => {
    const timestamp = new Date().toISOString();
    const learning = { agent: 'codex', sessionId: 'snapshot-learning-b', status: 'complete', phase: 'session-learning', timestamp, learning: {
      id: 'first-seen-in-sessions', source: 'heuristic', summary: 'Synthetic non-current learning belongs to B', privacyRisk: 'low', xp: 1,
    } };
    const current = { agent: 'codex', sessionId: 'snapshot-changed-session', status: 'idle', phase: 'user-message', timestamp };
    await __persistenceSmoke.emitStatus({ type: 'aivatar.status.snapshot', currentStatus: current, sessions: [current, learning] });
    await (await import('/src/persistence/closeSave.ts')).retryPendingSaves();
    await __persistenceSmoke.drain();
    window.__candidateLearningBeforeFollow = __persistenceSmoke.read(${JSON.stringify(slotB)}).memory.recentEvents.filter((event) => event.id === 'learning:codex:snapshot-learning-b:first-seen-in-sessions').length;
    await __persistenceSmoke.emitStatus({ type: 'aivatar.status.snapshot', currentStatus: learning, sessions: [current, learning] });
    await (await import('/src/persistence/closeSave.ts')).retryPendingSaves();
    await __persistenceSmoke.drain();
  })()`);
  assert.equal(await client.evaluate("__candidateLearningBeforeFollow"), 1, "first sessions-only learning must be applied when observed");
  assert.equal(await client.evaluate(`__persistenceSmoke.read(${JSON.stringify(slotB)}).memory.recentEvents.filter((event) => event.id === 'learning:codex:snapshot-learning-b:first-seen-in-sessions').length`), 1);
  assert(!await client.evaluate("__persistenceSmoke.read().memory.recentEvents.some((event) => event.sessionId === 'snapshot-learning-b')"));
  reports.push({ case: "sessions-only-learning-applied-on-arrival", destinationLearningOnceBeforeFollow: true, noDuplicateAfterFollow: true });
  const statusPolicy = await client.evaluate(`(async () => {
    const count = () => __persistenceSmoke.state().memory.growth.errorCount;
    const before = count();
    const timestamp = new Date().toISOString();
    const error = { agent: 'codex', sessionId: 'background-error-policy', status: 'error', phase: 'error', timestamp };
    const idle = { agent: 'codex', sessionId: 'current-idle-policy', status: 'idle', phase: 'idle', timestamp };
    await __persistenceSmoke.emitStatus({ type: 'aivatar.status.snapshot', currentStatus: idle, sessions: [idle, error] });
    const background = count();
    await __persistenceSmoke.emitStatus({ type: 'aivatar.status.snapshot', currentStatus: error, sessions: [idle, error] });
    const followed = count();
    await (await import('/src/persistence/closeSave.ts')).retryPendingSaves();
    return { before, background, followed };
  })()`);
  assert.equal(statusPolicy.background, statusPolicy.before, "background non-learning error must keep the existing effective-only policy");
  assert.equal(statusPolicy.followed, statusPolicy.before + 1);
  reports.push({ case: "non-learning-status-retains-effective-only-policy", backgroundIgnored: true, followedErrorRecordedOnce: true });
  await client.evaluate(`(async () => {
    __pauseAppSetSaveForSlot(${JSON.stringify(slotA)}, (current) => ({ ...current, avatarName: 'Late response for source A' }));
    await __persistenceSmoke.drain();
    await (await import('/src/persistence/closeSave.ts')).retryPendingSaves();
  })()`);
  assert.equal(await client.evaluate("__persistenceSmoke.read().avatarName"), "Late response for source A");
  assert.equal(await client.evaluate(`__persistenceSmoke.read(${JSON.stringify(slotB)}).avatarName`), "Persistence B");
  assert.equal(await client.evaluate("__persistenceSmoke.state().avatarName"), "Persistence B");
  assert.equal(client.networkBridgeRequests.length, 0);
  reports.push({ case: "completion-and-async-producer-during-native-commit", before, after: before + 8, delayedMilliseconds: 12001, rewards: 2, learningEvents: 2, failedAck: true, duplicateReward: false });
  reports.push({ case: "late-response-retains-source-slot-after-committed-switch", sourceSlotUpdated: true, activeSlotUnchanged: true });
  reports.push({ case: "invalid-explicit-import-rejected", passed: true });
  const output = { ok: true, temporary, scope: "Real mounted React App and native adapter with memory-only Tauri mock; controlled rejected commit; no real user data or bridge", reports };
  fs.writeFileSync(path.join(temporary, "report.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  const output = { ok: false, temporary, error: error.stack, reports, exceptions: clients.flatMap((client) => client.exceptions) };
  fs.writeFileSync(path.join(temporary, "report.json"), JSON.stringify(output, null, 2));
  console.error(JSON.stringify(output, null, 2));
  process.exitCode = 1;
} finally {
  for (const client of clients) client.socket.close();
  if (browser && !browser.killed) browser.kill();
  if (vite) await vite.close();
}
