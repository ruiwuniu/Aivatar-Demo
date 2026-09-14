import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import WebSocket from "ws";

// Exercises the actual mounted App and its persistence effects. The animation
// and fast simulation loops are paused; synthetic navigation changes drive a
// deterministic clock.
// A fresh Chrome profile and two layers of bridge interception isolate saves.
const repo = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aivatar-persistence-ui-smoke-"));
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
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installHarness})(${JSON.stringify({ origin, epoch, slotA, slotB })})` });
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

try {
  console.log(`Synthetic browser profile, Vite cache and report retained at: ${temporary}`);
  const executable = [process.env.AIVATAR_SMOKE_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((entry) => fs.existsSync(entry));
  assert.ok(executable, "Chrome/Edge is required; this smoke must not silently skip");
  vite = await createServer({ configFile: false, root: repo, envDir: temporary, cacheDir: path.join(temporary, "vite-cache"),
    optimizeDeps: { entries: [path.join(repo, "index.html")] },
    plugins: [react()], logLevel: "warn", clearScreen: false, server: { host: "127.0.0.1", port: await freePort(), strictPort: true, hmr: false } });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const debugPort = await freePort();
  console.log(`Isolated Vite: ${origin}; Chrome debug port: ${debugPort}`);
  browser = spawn(executable, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(temporary, "chrome-profile")}`,
    "--no-first-run", "--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-sync",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--headless=new", "--window-size=1000,800", "about:blank"], { stdio: "ignore" });
  const first = await addPage(debugPort, null, origin);
  await first.evaluate("__persistenceSmoke.advance(21000)");

  for (const [duration, marker] of [[120000, 0], [300000, 1000]]) {
    const result = await telemetry(first, duration, marker);
    const expected = duration / 20000;
    reports.push({ case: "continuous-navigation", ...result, savedCharacters: result.writes.reduce((sum, entry) => sum + entry.characters, 0) });
    console.log(`Navigation ${duration}ms: ${result.writes.length} writes, latest marker ${result.marker}`);
    assert.ok(result.writes.length >= expected - 1, `Continuous navigation starved ${duration}ms save deadline`);
    assert.ok(result.writes.length <= expected + 2, `Excessive slot writes: ${result.writes.length} for ${duration}ms`);
    assert.ok(result.marker >= marker + duration / 500 - 40, "Persisted navigation is more than one interval stale");
  }

  const purchase = await first.evaluate(`(async () => {
    const h = __persistenceSmoke;
    [...document.querySelectorAll('.shop-category-tab')][3].click(); await h.drain();
    const button = [...document.querySelectorAll('button.shop-button')].find((entry) => /Cookie/.test(entry.title || entry.textContent || ''));
    if (!button) throw new Error('Cookie purchase control missing');
    const before = h.read().wallet.bits;
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })); await h.drain();
    return { before, after: h.read().wallet.bits, quantity: h.read().inventory.find((entry) => entry.itemId === 'cookie')?.quantity ?? 0 };
  })()`);
  assert.equal(purchase.before - purchase.after, 6, "Purchase was not persisted without a 20-second wait");
  assert.equal(purchase.quantity, 1);
  reports.push({ case: "immediate-purchase", ...purchase });

  const reward = await first.evaluate(`(async () => {
    const h = __persistenceSmoke, before = h.read().wallet.bits;
    await h.emitStatus({ agent: 'codex', sessionId: 'synthetic-reward', status: 'thinking', phase: 'user-message' });
    await h.emitStatus({ agent: 'codex', sessionId: 'synthetic-reward', status: 'complete', phase: 'final', rewardId: 'persistence-smoke-reward' });
    return { before, after: h.read().wallet.bits, ids: h.read().rewardedCompletionIds };
  })()`);
  assert.equal(reward.after - reward.before, 4, "Completion reward was not immediately persisted");
  assert.ok(reward.ids.includes("persistence-smoke-reward"));
  reports.push({ case: "immediate-reward", ...reward });

  const created = await first.send("Target.createTarget", { url: "about:blank", background: true });
  const second = await addPage(debugPort, created.targetId, origin);
  await first.evaluate("__persistenceSmoke.advance(21000)");
  await second.evaluate("__persistenceSmoke.advance(21000)");
  await first.evaluate("__persistenceSmoke.changeNavigation(9001)");
  await second.evaluate(`(async () => {
    const park = await import('/src/park/parkStorage.ts');
    const cards = await import('/src/cardRoom/saveRoster.ts');
    park.recordParkCatch(${JSON.stringify(slotA)}, 'raw-rainbow-trout');
    park.mutateParkSaveSlot(${JSON.stringify(slotA)}, (save) => ({ ...save, inventory: [...save.inventory, { itemId: 'fishing-rod', quantity: 1 }] }));
    cards.writeCardRoomSaveSlotPokerChips(${JSON.stringify(slotA)}, 321);
    await __persistenceSmoke.drain();
  })()`);
  await first.evaluate("__persistenceSmoke.drain()");
  await first.evaluate("__persistenceSmoke.advance(21000)");
  await second.evaluate("__persistenceSmoke.advance(21000)");
  const external = await first.evaluate("__persistenceSmoke.read()");
  assert.equal(external.wallet.pokerChips, 321, "Old main-room draft overwrote external chips");
  assert.ok(external.inventory.some((entry) => entry.itemId === "fishing-rod" && entry.quantity === 1), "External inventory was overwritten");
  assert.ok(external.furnitureStorage.some((entry) => entry.itemId === "raw-rainbow-trout" && entry.quantity === 1), "Park catch was overwritten");
  assert.equal(external.navMemory.exploredCells["persistence-smoke"], 9001, "External merge discarded pending navigation");
  reports.push({ case: "external-park-and-card-merge", pokerChips: external.wallet.pokerChips, marker: 9001 });

  const beforeEcho = await Promise.all(clients.map((client) => client.evaluate(`__persistenceSmoke.writes.filter((entry) => entry.key === ${JSON.stringify(keyA)}).length`)));
  for (let step = 0; step < 3; step++) {
    await first.evaluate("__persistenceSmoke.advance(21000)");
    await second.evaluate("__persistenceSmoke.advance(21000)");
  }
  const afterEcho = await Promise.all(clients.map((client) => client.evaluate(`__persistenceSmoke.writes.filter((entry) => entry.key === ${JSON.stringify(keyA)}).length`)));
  const echoedWrites = afterEcho.reduce((sum, count, index) => sum + count - beforeEcho[index], 0);
  assert.equal(echoedWrites, 0, "Two idle windows echoed storage updates back into localStorage");
  reports.push({ case: "two-window-storage-echo", millisecondsPerWindow: 63000, writes: echoedWrites });

  const switchResult = await first.evaluate(`(async () => {
    const h = __persistenceSmoke;
    document.querySelector('button.settings-toggle').click(); await h.drain();
    const manager = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Saves');
    if (!manager) throw new Error('Save management control missing');
    manager.click(); await h.drain(); await h.changeNavigation(9002);
    const card = [...document.querySelectorAll('.save-slot-card')].find((entry) => entry.textContent.includes('Persistence B'));
    card?.querySelector('.save-slot-enter-button')?.click(); await h.drain();
    return { active: localStorage.getItem('aivatar.activeSaveSlot.v1'), marker: h.read().navMemory.exploredCells['persistence-smoke'], second: h.read(${JSON.stringify(slotB)}).avatarName };
  })()`);
  assert.equal(switchResult.active, slotB, "Save switch did not select the second slot");
  assert.equal(switchResult.marker, 9002, "Save switch did not flush pending navigation immediately");
  assert.equal(switchResult.second, "Persistence B");
  reports.push({ case: "immediate-slot-switch", ...switchResult });

  await second.evaluate("__persistenceSmoke.changeNavigation(9003)");
  await second.send("Page.navigate", { url: "about:blank" });
  await delay(100);
  const closedMarker = await first.evaluate("__persistenceSmoke.read().navMemory.exploredCells['persistence-smoke']");
  assert.equal(closedMarker, 9003, "Document unload did not flush pending navigation");
  reports.push({ case: "document-unload-flush", marker: closedMarker });
  for (const client of clients) assert.equal(client.networkBridgeRequests.length, 0, "Bridge URL reached the browser network stack despite the synthetic adapter");
  const output = { ok: true, temporary, scope: "Mounted React App; controlled navigation/timers; paused Canvas animation; synthetic bridge and saves", reports };
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
