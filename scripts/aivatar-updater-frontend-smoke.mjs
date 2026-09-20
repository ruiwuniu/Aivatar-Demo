import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// In-memory only: no real saves, windows, update downloads or installers.
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const compile = (relative, require, globals = {}) => {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file.pathname,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require, setTimeout, clearTimeout, ...globals }, { filename: file.pathname });
  return module.exports;
};
let checks = 0;
const test = async (name, run) => { await run(); checks += 1; console.log(`PASS ${name}`); };

const nativeListeners = new Map();
const acknowledgements = [];
let closeFlag = false;
let pauses = 0;
let drainFails = false;
const frozen = () => closeFlag || pauses > 0;
const save = compile("../src/persistence/closeSave.ts", (id) => {
  if (id === "./saveStore") return {
    isStoreClosing: frozen,
    setStoreClosing: (value) => { closeFlag = value; },
    pauseStoreUpdates: () => {
      pauses += 1;
      let released = false;
      return () => { if (!released) { released = true; pauses -= 1; } };
    },
    drainStore: async () => { if (drainFails) throw new Error("Synthetic durable failure"); },
  };
  if (id === "@tauri-apps/api/core") return { invoke: async (command, payload) => { acknowledgements.push({ command, ...payload }); } };
  if (id === "@tauri-apps/api/event") return { listen: async (event, fn) => {
    const listeners = nativeListeners.get(event) ?? new Set();
    listeners.add(fn); nativeListeners.set(event, listeners);
    return () => listeners.delete(fn);
  } };
  if (id === "@tauri-apps/api/webviewWindow") return { getCurrentWebviewWindow: () => ({ label: "synthetic-room" }) };
  throw new Error(`Unexpected save dependency ${id}`);
}, { window: { __TAURI_INTERNALS__: {}, addEventListener() {}, removeEventListener() {} } });

await test("update listeners are shared while every controller is flushed", async () => {
  const order = [];
  const stopA = await save.installCloseSaveHandler(async () => { assert(frozen()); order.push("room"); return { ok: true, written: true }; });
  const stopB = await save.installCloseSaveHandler(async () => { order.push("park"); return { ok: true, written: false }; });
  assert.equal(nativeListeners.get(save.SAVE_BEFORE_UPDATE_EVENT).size, 1);
  assert.equal(nativeListeners.get(save.CANCEL_UPDATE_SAVE_EVENT).size, 1);
  const result = await save.handleUpdateSaveRequest({ requestId: 1 }, { drain: async () => { order.push("durable"); } });
  assert.deepEqual(order, ["room", "park", "durable"]);
  assert.deepEqual(plain(result), { ok: true, written: true });
  assert.equal(acknowledgements.at(-1).command, "app_update_confirm_save");
  assert.equal(acknowledgements.at(-1).ok, true);
  assert(frozen(), "success stays frozen for installation");
  save.cancelUpdateSaveRequest({ requestId: 0 });
  assert(frozen(), "stale cancellation cannot unfreeze a successful save");
  save.cancelUpdateSaveRequest({ requestId: 1 });
  assert.equal(frozen(), false);
  stopA(); await tick();
  assert.equal(nativeListeners.get(save.SAVE_BEFORE_UPDATE_EVENT).size, 1);
  stopB(); await tick();
  assert.equal(nativeListeners.get(save.SAVE_BEFORE_UPDATE_EVENT).size, 0);
});

await test("failed drafts reject installation and resume interaction", async () => {
  const stop = await save.installCloseSaveHandler(() => ({ ok: false, written: false }));
  const result = await save.handleUpdateSaveRequest({ requestId: 2 });
  assert.equal(result.ok, false);
  assert.equal(acknowledgements.at(-1).ok, false);
  assert.equal(frozen(), false);
  stop(); await tick();
});

await test("durable write failure rejects installation even after successful draft flush", async () => {
  const stop = await save.installCloseSaveHandler(() => ({ ok: true, written: true }));
  drainFails = true;
  assert.equal((await save.handleUpdateSaveRequest({ requestId: 3 })).ok, false);
  assert.equal(acknowledgements.at(-1).ok, false);
  assert.equal(frozen(), false);
  drainFails = false; stop(); await tick();
});

await test("duplicate save events share the same work and acknowledgement", async () => {
  let release;
  let calls = 0;
  const stop = await save.installCloseSaveHandler(() => { calls += 1; return new Promise((resolve) => { release = resolve; }); });
  const before = acknowledgements.length;
  const pending = save.handleUpdateSaveRequest({ requestId: 4 });
  assert.equal(save.handleUpdateSaveRequest({ requestId: 4 }), pending);
  release({ ok: true, written: true });
  await pending;
  assert.equal(calls, 1); assert.equal(acknowledgements.length, before + 1);
  save.cancelUpdateSaveRequest({ requestId: 4 }); stop(); await tick();
});

await test("cancelled attempts and late flush completion cannot acknowledge success", async () => {
  let release;
  const stop = await save.installCloseSaveHandler(() => new Promise((resolve) => { release = resolve; }));
  const before = acknowledgements.length;
  const pending = save.handleUpdateSaveRequest({ requestId: 5 });
  save.cancelUpdateSaveRequest({ requestId: 5 });
  assert.equal(frozen(), false);
  release({ ok: true, written: true });
  assert.equal((await pending).ok, false);
  assert.equal(acknowledgements.length, before);
  stop(); await tick();
});

await test("a timeout restores interaction and ignores the late successful draft", async () => {
  let release;
  const stop = await save.installCloseSaveHandler(() => new Promise((resolve) => { release = resolve; }));
  const before = acknowledgements.length;
  assert.equal((await save.handleUpdateSaveRequest({ requestId: 6 }, { timeoutMs: 5 })).ok, false);
  assert.equal(frozen(), false);
  release({ ok: true, written: true }); await tick();
  assert(acknowledgements.slice(before).every((item) => item.ok === false));
  stop(); await tick();
});

await test("normal close and update preparation never clear each other's freeze", async () => {
  closeFlag = true;
  assert.equal((await save.handleUpdateSaveRequest({ requestId: 7 })).ok, false);
  assert(frozen()); closeFlag = false;
  const stop = await save.installCloseSaveHandler(() => ({ ok: true, written: true }));
  await save.handleUpdateSaveRequest({ requestId: 8 });
  let closeFlushes = 0;
  const result = await save.handleCloseSaveRequest({ requestId: 88 }, () => { closeFlushes += 1; return { ok: true, written: true }; });
  assert.equal(result.ok, false); assert.equal(closeFlushes, 0); assert(frozen());
  save.cancelUpdateSaveRequest({ requestId: 8 });
  assert.equal(frozen(), false); stop(); await tick();
});

await test("invalid request IDs cannot pause or acknowledge an update", async () => {
  const before = acknowledgements.length;
  for (const requestId of [undefined, "9", -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await save.handleUpdateSaveRequest({ requestId })).ok, false);
  }
  assert.equal(acknowledgements.length, before); assert.equal(frozen(), false);
});

await test("a lost success ACK response stays frozen until native cancellation", async () => {
  const stop = await save.installCloseSaveHandler(() => ({ ok: true, written: true }));
  assert.equal((await save.handleUpdateSaveRequest({ requestId: 10 }, {
    invokeUpdate: async () => { throw new Error("Synthetic disconnected shell"); },
  })).ok, false);
  assert(frozen(), "Rust may have accepted the ACK and started installation");
  save.cancelUpdateSaveRequest({ requestId: 10 });
  assert.equal(frozen(), false); stop(); await tick();
});

await test("late cancellation never releases a newer save attempt", async () => {
  const stop = await save.installCloseSaveHandler(() => ({ ok: true, written: false }));
  await save.handleUpdateSaveRequest({ requestId: 11 });
  save.cancelUpdateSaveRequest({ requestId: 11 });
  await save.handleUpdateSaveRequest({ requestId: 12 });
  save.cancelUpdateSaveRequest({ requestId: 11 }); assert(frozen());
  save.cancelUpdateSaveRequest({ requestId: 12 }); assert.equal(frozen(), false);
  stop(); await tick();
});

const timers = new Map();
let timerId = 0;
const controller = compile("../src/updater/updaterController.ts", () => { throw new Error("Unexpected controller dependency"); }, {
  setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
  clearTimeout: (id) => timers.delete(id),
});
const initial = { revision: 0, phase: "idle", currentVersion: "0.5.0", downloadedBytes: 0 };

await test("one state subscription serves multiple UI consumers and stale reads lose", async () => {
  let receive;
  let releaseStatus;
  let subscriptions = 0;
  let stops = 0;
  const instance = controller.createUpdaterController({
    listen: async (fn) => { receive = fn; subscriptions += 1; return () => { stops += 1; }; },
    invoke: async () => new Promise((resolve) => { releaseStatus = resolve; }),
  }, false);
  const stopA = instance.subscribe(() => {}); const stopB = instance.subscribe(() => {});
  await tick();
  receive({ ...initial, revision: 3, phase: "downloading", downloadedBytes: 10, totalBytes: 100 });
  releaseStatus(initial); await tick();
  assert.equal(instance.getSnapshot().phase, "downloading");
  assert.equal(subscriptions, 1);
  stopA(); assert.equal(stops, 0); stopB(); assert.equal(stops, 1);
});

await test("startup checks once and never downloads or installs automatically", async () => {
  const commands = [];
  const instance = controller.createUpdaterController({
    listen: async () => () => {},
    invoke: async (command, args) => { commands.push({ command, args }); return initial; },
  });
  let stop = instance.subscribe(() => {}); await tick();
  assert.equal(timers.size, 1);
  const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); await tick();
  stop(); stop = instance.subscribe(() => {}); await tick();
  assert.equal(timers.size, 0);
  assert.deepEqual(plain(commands.filter((item) => item.command !== "app_update_status")), [{ command: "app_update_check", args: { automatic: true } }]);
  stop();
});

await test("development and disabled native states never schedule checks", async () => {
  for (const [phase, automatic] of [["disabled", true], ["idle", false]]) {
    const instance = controller.createUpdaterController({
      listen: async () => () => {}, invoke: async () => ({ ...initial, phase }),
    }, automatic);
    const stop = instance.subscribe(() => {}); await tick(); assert.equal(timers.size, 0); stop();
  }
  const web = controller.createUpdaterController(null);
  const stop = web.subscribe(() => {}); await web.check(); assert.equal(web.getSnapshot().phase, "disabled"); stop();
});

await test("concurrent button presses share one native operation", async () => {
  let release;
  const calls = [];
  const instance = controller.createUpdaterController({
    listen: async () => () => {},
    invoke: async (command) => {
      calls.push(command);
      if (command === "app_update_status") return initial;
      return new Promise((resolve) => { release = resolve; });
    },
  }, false);
  const stop = instance.subscribe(() => {}); await tick();
  const pending = instance.check(); instance.check(); instance.download();
  assert.deepEqual(calls, ["app_update_status", "app_update_check"]);
  release({ ...initial, revision: 1, phase: "available", version: "0.6.0" }); await pending;
  assert.equal(instance.getSnapshot().version, "0.6.0"); stop();
});

await test("install failures retain downloaded state and can retry", async () => {
  let installs = 0;
  const ready = { ...initial, revision: 4, phase: "downloaded", version: "0.6.0" };
  const instance = controller.createUpdaterController({
    listen: async () => () => {},
    invoke: async (command) => {
      if (command === "app_update_install") { installs += 1; throw new Error("Synthetic save gate blocked"); }
      return ready;
    },
  }, false);
  const stop = instance.subscribe(() => {}); await tick();
  await instance.install(); assert.equal(instance.getSnapshot().phase, "downloaded");
  assert.match(instance.getSnapshot().error, /save gate/);
  await instance.install(); assert.equal(installs, 2); stop();
});

await test("cleanup also detaches an asynchronously registered subscription", async () => {
  let finish;
  let stops = 0;
  const instance = controller.createUpdaterController({
    listen: () => new Promise((resolve) => { finish = () => resolve(() => { stops += 1; }); }),
    invoke: async () => initial,
  }, false);
  const stop = instance.subscribe(() => {}); stop(); finish(); await tick(); assert.equal(stops, 1);
});

await test("download progress handles unknown totals and clamps overshoot", () => {
  assert.equal(controller.updateProgress({ downloadedBytes: 12 }), null);
  assert.equal(controller.updateProgress({ downloadedBytes: 12, totalBytes: 0 }), null);
  assert.equal(controller.updateProgress({ downloadedBytes: 12, totalBytes: 100 }), 12);
  assert.equal(controller.updateProgress({ downloadedBytes: 120, totalBytes: 100 }), 100);
});

const ReactJsx = await import("react/jsx-runtime");
const ui = compile("../src/updater/UpdateSettings.tsx", (id) => {
  if (id === "react/jsx-runtime") return ReactJsx;
  if (id === "../i18n") return { t: (_locale, key, params) => `${key}${params?.version ? ` ${params.version}` : ""}` };
  if (id === "./updaterController") return controller;
  if (id === "./updater.css") return {};
  throw new Error(`Unexpected UI dependency ${id}`);
});
const render = (state) => renderToStaticMarkup(React.createElement(ui.UpdateSettings, {
  locale: "en", updater: { state: { ...initial, ...state }, check() {}, download() {}, install() {} },
}));

await test("release notes render as text and installation appears only after verified download", () => {
  const available = render({ phase: "available", version: "0.6.0", notes: "<script>bad()</script>\n## News" });
  assert.match(available, /&lt;script&gt;/); assert.doesNotMatch(available, /<script>/);
  assert.match(available, /update.download 0.6.0/); assert.doesNotMatch(available, /update.install/);
  const downloaded = render({ phase: "downloaded", version: "0.6.0" });
  assert.match(downloaded, /update.install/);
});

await test("busy phases disable controls and show progress or save status", () => {
  const downloading = render({ phase: "downloading", downloadedBytes: 40, totalBytes: 100 });
  assert.match(downloading, /<progress[^>]+value="40"/); assert.match(downloading, /disabled=""/);
  assert.match(render({ phase: "saving" }), /update.phase.saving/);
  assert.match(render({ phase: "idle", checkedAt: 123 }), /update.latest/);
});

console.log(`Updater frontend smoke passed: ${checks} checks; synthetic state only.`);
