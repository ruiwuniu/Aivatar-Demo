import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import WebSocket from "ws";

// Exercises learning in the mounted App with a fresh browser profile and
// synthetic bridge events. No production bridge, user data or LLM is accessed.
// The retained profile also proves persistence across real page reloads.
// Optionally verify an already-generated model response from a synthetic task:
// node scripts/aivatar-learning-ui-smoke.mjs --learning-result-file /tmp/result.json
// This never invokes a provider itself or connects to the production bridge.
const repo = process.cwd();
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--learning-result-file"),
  "Usage: node scripts/aivatar-learning-ui-smoke.mjs [--learning-result-file /absolute/path.json]");
const learningResultFile = args.length ? path.resolve(args[1]) : undefined;
let providedLearning;
let providedAgent;
if (learningResultFile) {
  assert.ok(fs.statSync(learningResultFile).size <= 1024 * 1024, "Learning result must be at most 1 MiB");
  const input = JSON.parse(fs.readFileSync(learningResultFile, "utf8"));
  providedLearning = input.learning ?? input;
  providedAgent = input.agent ?? providedLearning.diagnostic?.provider;
  assert.ok(["codex", "claude-code", "opencode", "codebuddy", "workbuddy"].includes(providedAgent));
  assert.equal(providedLearning.source, "llm", "Provided result must come from the LLM, not heuristic fallback");
  assert.ok(typeof providedLearning.id === "string" && providedLearning.id, "Provided learning requires its original receipt id");
  assert.equal(providedLearning.diagnostic?.status, "success", "Provided result must include a successful provider diagnostic");
  assert.ok(["codex", "claude-code", "opencode", "codebuddy"].includes(providedLearning.diagnostic.provider));
  assert.ok(Number.isFinite(Date.parse(providedLearning.diagnostic.timestamp)));
  assert.ok(["low", "medium"].includes(providedLearning.privacyRisk), "High-risk provider output must not enter the UI test");
  assert.ok(Array.isArray(providedLearning.idleBubbleCandidates)
    && providedLearning.idleBubbleCandidates.length >= 1 && providedLearning.idleBubbleCandidates.length <= 6);
  assert.ok(providedLearning.idleBubbleCandidates.every((phrase) => typeof phrase === "string"
    && Array.from(phrase).length >= 2 && Array.from(phrase).length <= 28 && phrase === phrase.trim()));
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aivatar-learning-ui-smoke-"));
// Leave synthetic history before the supplied provider timestamp so diagnostic
// ordering can be checked without rewriting any part of the real response.
const epoch = providedLearning ? Date.parse(providedLearning.diagnostic.timestamp) - 60_000 : Date.now();
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
  const frames = new Map();
  window.requestAnimationFrame = (callback) => { const id = nextTimer++; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => frames.delete(id);

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
    async paint() {
      for (let pass = 0; pass < 2; pass++) {
        const batch = [...frames.values()]; frames.clear();
        for (const callback of batch) callback(now - epoch);
        await drain();
      }
    },
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

const llmPhrases = ["A tiny idea blooms", "One kind step at a time", "We made a little progress"];
const makeLearning = (id, source, phrases, provider = "codex", reason) => ({
  id, source, summary: "Synthetic learning for regression", privacyRisk: "low", xp: 1,
  idleBubbleCandidates: phrases,
  diagnostic: { provider, status: reason ? "fallback" : "success", ...(reason ? { reason } : {}), timestamp: new Date(epoch).toISOString() },
});
const status = (sessionId, learning, agent = "codex") => ({
  agent, sessionId, status: "complete", phase: "session-learning", timestamp: new Date(epoch).toISOString(), learning,
});
const displayed = (client) => client.evaluate(`Array.from(document.querySelectorAll('.idle-bubble-editor:not(.social-bubble-editor) .idle-bubble-candidate.llm > span')).map(e => e.textContent)`);
const emit = (client, payload) => client.evaluate(`__persistenceSmoke.emitStatus(${JSON.stringify(payload)})`);
async function mounted(client) {
  await waitFor(() => client.evaluate("Boolean(window.__persistenceSmoke && document.querySelector('.shop-category-tab') && !document.querySelector('.save-slot-overlay'))"), "Mounted learning App");
  await client.evaluate("(async () => { if (document.querySelector('.growth-toggle')?.getAttribute('aria-expanded') !== 'true') document.querySelector('.growth-toggle')?.click(); await __persistenceSmoke.drain(); })()");
  await client.evaluate("__persistenceSmoke.paint()");
  await waitFor(() => client.evaluate("document.querySelector('.growth-submenu').parentElement.getBoundingClientRect().height > 100"), "expanded Growth panel");
}
try {
  console.log(`Synthetic learning UI profile and report retained at: ${temporary}`);
  const executable = [process.env.AIVATAR_SMOKE_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((entry) => fs.existsSync(entry));
  assert.ok(executable, "Chrome/Edge is required");
  vite = await createServer({ configFile: false, root: repo, envDir: temporary, cacheDir: path.join(temporary, "vite-cache"),
    optimizeDeps: { entries: [path.join(repo, "index.html")] }, plugins: [react()], logLevel: "warn", clearScreen: false,
    server: { host: "127.0.0.1", port: await freePort(), strictPort: true, hmr: false } });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const debugPort = await freePort();
  browser = spawn(executable, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(temporary, "chrome-profile")}`,
    "--no-first-run", "--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-sync",
    "--headless=new", "--window-size=1100,1000", "about:blank"], { stdio: "ignore" });
  const client = await addPage(debugPort, null, origin);
  await mounted(client);
  const ordinary = status("ordinary", makeLearning("ordinary-1", "heuristic", ["Tea time is here", "Take a cozy break", "A quiet little moment"]));
  delete ordinary.learning.diagnostic;
  const generated = status("generated", makeLearning("llm-1", "llm", llmPhrases, "opencode"), "opencode");
  const snapshot = { type: "aivatar.status.snapshot", currentStatus: ordinary, sessions: [ordinary, generated] };
  await emit(client, snapshot);
  await waitFor(async () => (await displayed(client)).length === 3, "LLM candidates ahead of ordinary candidates");
  assert.deepEqual(new Set(await displayed(client)), new Set(llmPhrases));
  await waitFor(() => client.evaluate("__persistenceSmoke.read().learningRecommendations?.idleCandidates?.length >= 6"), "durable candidates written immediately");
  const xp = await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp");
  await emit(client, snapshot);
  assert.equal(await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp"), xp);
  reports.push({ case: "multiple-sources-llm-visible-and-deduplicated", llmDisplayed: 3 });

  const failure = status("failure", makeLearning("failed-1", "heuristic", [], "claude-code", "timeout"), "claude-code");
  await emit(client, failure);
  await waitFor(() => client.evaluate("document.querySelector('.growth-card').textContent.toLowerCase().includes('timed out')"), "visible timeout hint");
  await client.evaluate("__persistenceSmoke.paint()");
  await delay(350);
  const panelClip = await client.evaluate(`(() => {
    const panel = document.querySelector('.side-panel');
    const editor = document.querySelector('.idle-bubble-editor:not(.social-bubble-editor)');
    panel.scrollTop += editor.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
    const box = panel.getBoundingClientRect();
    return { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: Math.min(box.height, innerHeight - Math.max(0, box.y)), scale: 1 };
  })()`);
  await delay(250);
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", clip: panelClip });
  fs.writeFileSync(path.join(temporary, "learning-panel.png"), Buffer.from(screenshot.data, "base64"));
  reports.push({ case: "failure-hint-visible", passed: true });
  const privateLearning = status("private", { ...makeLearning("private-1", "llm", ["Do not retain this phrase"]), privacyRisk: "high" });
  await emit(client, privateLearning);
  assert(!await client.evaluate("JSON.stringify(__persistenceSmoke.read().learningRecommendations).includes('Do not retain this phrase')"));
  reports.push({ case: "high-risk-learning-rejected", passed: true });

  const xpBeforeReload = await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp");
  await client.evaluate("window.__learningBeforeReload = true");
  await client.send("Page.reload");
  await waitFor(() => client.evaluate("!window.__learningBeforeReload && Boolean(window.__persistenceSmoke && document.querySelector('.growth-toggle'))"), "new page after reload");
  await mounted(client);
  assert.deepEqual(new Set(await displayed(client)), new Set(llmPhrases));
  assert(await client.evaluate("document.querySelector('.growth-card').textContent.toLowerCase().includes('timed out')"));
  await emit(client, snapshot);
  assert.equal(await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp"), xpBeforeReload);
  reports.push({ case: "page-reload-retains-candidates-and-failure-without-duplicate-xp", passed: true });

  await client.evaluate("__persistenceSmoke.advance(1000)");
  const recovered = status("failure", makeLearning("recovered-1", "llm", ["A fresh start feels good"], "claude-code"), "claude-code");
  recovered.learning.diagnostic.timestamp = new Date(epoch + 1000).toISOString();
  recovered.timestamp = recovered.learning.diagnostic.timestamp;
  await emit(client, recovered);
  await waitFor(() => client.evaluate("!document.querySelector('.growth-card').textContent.toLowerCase().includes('timed out')"), "success clears old failure");
  reports.push({ case: "new-success-replaces-failure", passed: true });

  await client.evaluate("(async () => { document.querySelector('.idle-bubble-editor:not(.social-bubble-editor) .idle-bubble-candidate.llm').click(); await __persistenceSmoke.drain(); })()");
  assert.equal(await client.evaluate("__persistenceSmoke.state().memory.preferences.idleBubblePhrases.length"), 1);
  assert(!(await displayed(client)).includes("A fresh start feels good"));
  reports.push({ case: "accepted-phrase-removed-from-candidates", passed: true });

  await client.evaluate("(async () => { document.querySelector('button.settings-toggle').click(); await __persistenceSmoke.drain(); [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Saves').click(); await __persistenceSmoke.drain(); [...document.querySelectorAll('.save-slot-card')].find(e => e.textContent.includes('Persistence B')).querySelector('.save-slot-enter-button').click(); await __persistenceSmoke.drain(); })()");
  await waitFor(() => client.evaluate("__persistenceSmoke.state().avatarName === 'Persistence B'"), "switch to second character");
  assert.equal((await displayed(client)).length, 0);
  assert.equal(await client.evaluate(`__persistenceSmoke.read(${JSON.stringify(slotB)}).learningRecommendations?.idleCandidates?.length ?? 0`), 0);
  // Replaying an unchanged already-observed session cannot transfer A's learning to B.
  await emit(client, recovered);
  assert.equal((await displayed(client)).length, 0);
  reports.push({ case: "switch-slot-does-not-import-existing-session-learning", passed: true });

  await client.evaluate("window.__learningBeforeReload = true");
  await client.send("Page.navigate", { url: `${origin}/?slotId=${slotB}` });
  await waitFor(() => client.evaluate("!window.__learningBeforeReload && Boolean(window.__persistenceSmoke && document.querySelector('.growth-toggle'))"), "restarted second character");
  await mounted(client);
  assert.equal(await client.evaluate("__persistenceSmoke.state().avatarName"), "Persistence B");
  const secondXp = await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp");
  await emit(client, snapshot);
  await emit(client, recovered);
  assert.equal((await displayed(client)).length, 0, "a replay from the first character cannot migrate after restart");
  assert.equal(await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp"), secondXp);
  reports.push({ case: "restarted-slot-rejects-learning-owned-by-another-character", passed: true });
  const freshForB = status("generated", makeLearning("fresh-for-b", "llm", ["慢慢来就很好"], "opencode"), "opencode");
  await emit(client, freshForB);
  await waitFor(() => client.evaluate("Boolean(document.querySelector('.learning-language-action'))"), "language-filter hint");
  await client.evaluate("(async () => { document.querySelector('.learning-language-action').click(); await __persistenceSmoke.drain(); await __persistenceSmoke.paint(); })()");
  assert.deepEqual(await displayed(client), ["慢慢来就很好"]);
  assert.equal(await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp"), secondXp + 1);
  reports.push({ case: "fresh-learning-in-same-session-belongs-to-new-slot-and-language-hint-restores-visibility", passed: true });

  const wbFailure = status("workbuddy-new", makeLearning("wb-failure", "heuristic", [], "codebuddy", "unavailable"), "workbuddy");
  wbFailure.learning.diagnostic.timestamp = new Date(epoch + 2000).toISOString();
  await emit(client, wbFailure);
  await waitFor(() => client.evaluate("document.querySelector('.learning-status-notices')?.textContent.includes('Workbuddy / CodeBuddy')"), "Workbuddy provider failure label");
  reports.push({ case: "workbuddy-codebuddy-failure-visible", passed: true });
  const wbSuccess = status("workbuddy-new", makeLearning("wb-success", "llm", ["A small task well done"], "codebuddy"), "workbuddy");
  wbSuccess.learning.diagnostic.timestamp = new Date(epoch + 3000).toISOString();
  await emit(client, wbSuccess);
  await waitFor(async () => (await displayed(client)).includes("A small task well done"), "Workbuddy generated candidate");
  assert(!await client.evaluate("Boolean(document.querySelector('.learning-status-notices')?.textContent.includes('Workbuddy / CodeBuddy'))"));
  await waitFor(() => client.evaluate(`__persistenceSmoke.read(${JSON.stringify(slotB)}).learningRecommendations?.diagnostics?.some(d=>d.provider==='codebuddy' && d.status==='success')`), "Workbuddy result persisted");
  reports.push({ case: "workbuddy-llm-candidate-visible-persisted-and-failure-cleared", passed: true });

  if (providedLearning) {
    const provider = providedLearning.diagnostic.provider;
    const phrases = [...new Set(providedLearning.idleBubbleCandidates)];
    const session = `provided-model-response-${epoch}`;
    const failed = status(session, makeLearning(`provided-pre-failure-${epoch}`, "heuristic", [], provider, "provider-error"), providedAgent);
    failed.learning.diagnostic.timestamp = new Date(Date.parse(providedLearning.diagnostic.timestamp) - 1).toISOString();
    await emit(client, failed);
    await waitFor(() => client.evaluate("document.querySelectorAll('.learning-status-notice').length === 1"), "failure hint before supplied response");
    reports.push({ case: "provided-response-prior-failure-visible", provider, passed: true });

    await client.evaluate("__persistenceSmoke.advance(60000)");
    const received = status(session, providedLearning, providedAgent);
    const providedXpBefore = await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp");
    await emit(client, received);
    await waitFor(async () => {
      const shown = await displayed(client);
      return phrases.every((phrase) => shown.includes(phrase));
    }, "provided LLM candidates visible");
    const badges = await client.evaluate(`Array.from(document.querySelectorAll('.idle-bubble-editor:not(.social-bubble-editor) .idle-bubble-candidate.llm'))
      .filter(element => ${JSON.stringify(phrases)}.includes(element.querySelector('span').textContent))
      .map(element => ({ phrase: element.querySelector('span').textContent, badge: element.querySelector('b').textContent }))`);
    assert.equal(badges.length, phrases.length);
    assert.ok(badges.every((entry) => entry.badge === "LLM"), "Every supplied phrase must carry the actual LLM badge");
    assert.equal(await client.evaluate("document.querySelectorAll('.learning-status-notice').length"), 0);
    const providedXp = await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp");
    assert.equal(providedXp, providedXpBefore + providedLearning.xp);
    await waitFor(() => client.evaluate(`(() => {
      const saved = __persistenceSmoke.read(${JSON.stringify(slotB)}).learningRecommendations;
      return ${JSON.stringify(phrases)}.every(phrase => saved?.idleCandidates?.some(candidate => candidate.phrase === phrase
        && candidate.source === 'llm' && candidate.learningId === ${JSON.stringify(providedLearning.id)}))
        && saved?.diagnostics?.some(diagnostic => diagnostic.provider === ${JSON.stringify(provider)} && diagnostic.status === 'success');
    })()`), "provided candidates and success persisted");
    reports.push({ case: "provided-response-llm-badges-visible-and-failure-cleared", provider, candidates: badges, passed: true });

    await client.evaluate("__persistenceSmoke.paint()");
    const suppliedClip = await client.evaluate(`(() => {
      const panel = document.querySelector('.side-panel');
      const editor = document.querySelector('.idle-bubble-editor:not(.social-bubble-editor)');
      panel.scrollTop += editor.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
      const box = panel.getBoundingClientRect();
      return { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: Math.min(box.height, innerHeight - Math.max(0, box.y)), scale: 1 };
    })()`);
    await delay(250);
    const suppliedScreenshot = await client.send("Page.captureScreenshot", { format: "png", clip: suppliedClip });
    fs.writeFileSync(path.join(temporary, "provided-learning-panel.png"), Buffer.from(suppliedScreenshot.data, "base64"));

    await client.evaluate("window.__learningBeforeReload = true");
    await client.send("Page.reload");
    await waitFor(() => client.evaluate("!window.__learningBeforeReload && Boolean(window.__persistenceSmoke && document.querySelector('.growth-toggle'))"), "reload with provided model response");
    await mounted(client);
    const reloadedPhrases = await displayed(client);
    assert.ok(phrases.every((phrase) => reloadedPhrases.includes(phrase)));
    assert.equal(await client.evaluate("document.querySelectorAll('.learning-status-notice').length"), 0);
    await emit(client, received);
    assert.equal(await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp"), providedXp);
    reports.push({ case: "provided-response-reload-persists-and-replay-does-not-duplicate-xp", passed: true });

    const acceptedPhrase = phrases[0];
    await client.evaluate(`(async () => {
      const button = Array.from(document.querySelectorAll('.idle-bubble-editor:not(.social-bubble-editor) .idle-bubble-candidate.llm'))
        .find(element => element.querySelector('span').textContent === ${JSON.stringify(acceptedPhrase)});
      if (!button || button.disabled) throw new Error('Provided LLM candidate cannot be accepted');
      button.click(); await __persistenceSmoke.drain();
    })()`);
    assert.ok(await client.evaluate(`__persistenceSmoke.state().memory.preferences.idleBubblePhrases.includes(${JSON.stringify(acceptedPhrase)})`));
    assert.ok(!(await displayed(client)).includes(acceptedPhrase));
    await waitFor(() => client.evaluate(`(() => {
      const saved = __persistenceSmoke.read(${JSON.stringify(slotB)});
      return saved.memory.preferences.idleBubblePhrases.includes(${JSON.stringify(acceptedPhrase)})
        && !saved.learningRecommendations.idleCandidates.some(candidate => candidate.phrase === ${JSON.stringify(acceptedPhrase)});
    })()`), "accepted model phrase written to preference and removed from saved candidates");
    reports.push({ case: "provided-response-acceptance-removes-candidate-and-saves-phrase", phrase: acceptedPhrase, passed: true });

    await client.evaluate("window.__learningBeforeReload = true");
    await client.send("Page.reload");
    await waitFor(() => client.evaluate("!window.__learningBeforeReload && Boolean(window.__persistenceSmoke && document.querySelector('.growth-toggle'))"), "reload after accepting model phrase");
    await mounted(client);
    await emit(client, received);
    assert.ok(await client.evaluate(`__persistenceSmoke.state().memory.preferences.idleBubblePhrases.includes(${JSON.stringify(acceptedPhrase)})`));
    assert.ok(!(await displayed(client)).includes(acceptedPhrase));
    assert.equal(await client.evaluate("__persistenceSmoke.state().memory.growth.totalXp"), providedXp);
    reports.push({ case: "provided-response-accepted-phrase-remains-accepted-after-reload-and-replay", passed: true });
  }
  assert.equal(client.networkBridgeRequests.length, 0);
  assert.equal(client.exceptions.length, 0);
  const output = { ok: true, temporary,
    scope: "Mounted App, fresh browser profile, mocked bridge, no real user data or live provider invocation by this harness",
    ...(providedLearning ? { learningResultFile, provider: providedLearning.diagnostic.provider,
      learningId: providedLearning.id, screenshot: path.join(temporary, "provided-learning-panel.png") } : {}), reports };
  fs.writeFileSync(path.join(temporary, "report.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  const output = { ok: false, temporary, error: error.stack, reports, exceptions: clients.flatMap(c => c.exceptions) };
  fs.writeFileSync(path.join(temporary, "report.json"), JSON.stringify(output, null, 2));
  console.error(JSON.stringify(output, null, 2));
  process.exitCode = 1;
} finally {
  for (const client of clients) client.socket.close();
  if (browser && !browser.killed) browser.kill();
  if (vite) await vite.close();
}
