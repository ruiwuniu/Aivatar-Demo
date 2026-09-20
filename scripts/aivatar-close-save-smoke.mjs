import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = new URL("../src/persistence/closeSave.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const rustSource = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
});

const defaultInvocations = [];
let registeredEvent = null;
let registeredListener = null;
let registeredOptions = null;
let unlistenCount = 0;
let closing = false;
let drainFailure;
const module = { exports: {} };
vm.runInNewContext(
  outputText,
  {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id === "./saveStore") return {
        isStoreClosing: () => closing,
        setStoreClosing: (value) => { closing = value; },
        pauseStoreUpdates: () => { const previous = closing; closing = true; return () => { closing = previous; }; },
        drainStore: async () => { if (drainFailure) throw drainFailure; },
      };
      if (id === "@tauri-apps/api/core") {
        return {
          invoke: async (command, payload) => {
            defaultInvocations.push({ command, payload });
          },
        };
      }
      if (id === "@tauri-apps/api/event") {
        return {
          listen: async (eventName, listener, options) => {
            registeredEvent = eventName;
            registeredListener = listener;
            registeredOptions = options;
            return () => { unlistenCount += 1; };
          },
        };
      }
      if (id === "@tauri-apps/api/webviewWindow") return {
        getCurrentWebviewWindow: () => ({ label: "synthetic-room" }),
      };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  },
  { filename: sourcePath.pathname },
);

const api = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
let checks = 0;
const test = async (name, run) => {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
};

await test("close remains frozen until both asynchronous flush and store drain complete", async () => {
  let releaseFlush;
  let releaseDrain;
  const acknowledgements = [];
  const pending = api.handleCloseSaveRequest({ requestId: 100 }, () =>
    new Promise((resolve) => { releaseFlush = () => resolve({ ok: true, written: true }); }), {
      drain: () => new Promise((resolve) => { releaseDrain = resolve; }),
      invokeClose: async (_command, payload) => acknowledgements.push(payload),
    });
  assert.equal(closing, true);
  assert.equal(acknowledgements.length, 0);
  releaseFlush();
  await new Promise(setImmediate);
  assert.equal(acknowledgements.length, 0);
  releaseDrain();
  assert.equal((await pending).ok, true);
  assert.equal(acknowledgements[0].ok, true);
});

await test("a rejected drain fails closed and restores interaction", async () => {
  drainFailure = new Error("synthetic queued settings write failed");
  const acknowledgements = [];
  const result = await api.handleCloseSaveRequest({ requestId: 101 }, async () => ({ ok: true, written: true }), {
    invokeClose: async (_command, payload) => acknowledgements.push(payload),
  });
  drainFailure = undefined;
  assert.equal(result.ok, false);
  assert.equal(acknowledgements[0].ok, false);
  assert.equal(closing, false);
});

await test("timeout restores interaction and late flush cannot acknowledge success", async () => {
  let release;
  const acknowledgements = [];
  const result = await api.handleCloseSaveRequest({ requestId: 102 }, () => new Promise((resolve) => { release = resolve; }), {
    timeoutMs: 5,
    invokeClose: async (_command, payload) => acknowledgements.push(payload),
  });
  assert.equal(result.ok, false);
  assert.equal(closing, false);
  release({ ok: true, written: true });
  await new Promise(setImmediate);
  assert(acknowledgements.every((payload) => payload.ok === false));
});

await test("manual retry flushes registered controller drafts before clearing errors", async () => {
  let failed = true;
  let flushes = 0;
  closing = false;
  const stop = await api.installCloseSaveHandler(async () => {
    flushes += 1;
    assert.equal(closing, true);
    return { ok: !failed, written: !failed };
  });
  await assert.rejects(api.retryPendingSaves(), /pending changes/);
  assert.equal(closing, false);
  failed = false;
  await api.retryPendingSaves();
  assert.equal(flushes, 2);
  assert.equal(closing, false);
  stop();
  await api.retryPendingSaves();
  assert.equal(flushes, 2, "unmounted controller must not remain in the retry registry");
  unlistenCount = 0;
});

await test("web preview registers and unregisters retry barriers without native event APIs", async () => {
  const webModule = { exports: {} };
  let flushes = 0;
  let nativeCalls = 0;
  vm.runInNewContext(outputText, {
    module: webModule, exports: webModule.exports, setTimeout, clearTimeout,
    window: { addEventListener() {}, removeEventListener() {} },
    require(id) {
      if (id === "./saveStore") return {
        drainStore: async () => undefined,
        isStoreClosing: () => false,
        setStoreClosing() {},
        pauseStoreUpdates: () => () => undefined,
      };
      if (id === "@tauri-apps/api/event") return { listen: async () => { nativeCalls += 1; throw new Error("no Tauri"); } };
      if (id === "@tauri-apps/api/core") return { invoke: async () => undefined };
      if (id === "@tauri-apps/api/webviewWindow") return { getCurrentWebviewWindow: () => { nativeCalls += 1; throw new Error("no Tauri"); } };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  const stop = await webModule.exports.installCloseSaveHandler(() => { flushes += 1; return { ok: true, written: false }; });
  await webModule.exports.retryPendingSaves();
  stop();
  await webModule.exports.retryPendingSaves();
  assert.equal(flushes, 1);
  assert.equal(nativeCalls, 0);
});

await test("aggregate reports any write and every flush must succeed", () => {
  assert.deepEqual(
    plain(api.aggregateSaveFlushResults(
      { ok: true, written: false },
      [{ ok: true, written: true }, { ok: true, written: false }],
    )),
    { ok: true, written: true },
  );
  assert.deepEqual(
    plain(api.aggregateSaveFlushResults({ ok: true, written: true }, { ok: false, written: false })),
    { ok: false, written: true },
  );
  assert.deepEqual(plain(api.aggregateSaveFlushResults(undefined)), { ok: true, written: false });
});

await test("safe integer request id acknowledges a successful aggregate flush", async () => {
  const invocations = [];
  const result = await api.handleCloseSaveRequest(
    { requestId: 42 },
    () => [{ ok: true, written: false }, { ok: true, written: true }],
    { invokeClose: async (command, payload) => invocations.push({ command, payload }) },
  );
  assert.deepEqual(plain(result), { ok: true, written: true });
  assert.deepEqual(plain(invocations), [{
    command: "confirm_close_after_save",
    payload: { requestId: 42, ok: true },
  }]);
});

await test("failed flush acknowledges false, reports the failure, and keeps close blocked", async () => {
  const invocations = [];
  const failures = [];
  const order = [];
  const result = await api.handleCloseSaveRequest(
    { requestId: 43 },
    () => ({ ok: false, written: false }),
    {
      invokeClose: async (command, payload) => {
        order.push("invoke");
        invocations.push({ command, payload });
      },
      onFailure: (message, error) => {
        order.push("failure");
        failures.push({ message, error });
      },
    },
  );
  assert.deepEqual(plain(result), { ok: false, written: false });
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /stay open/i);
  assert.deepEqual(plain(invocations), [{
    command: "confirm_close_after_save",
    payload: { requestId: 43, ok: false },
  }]);
  assert.deepEqual(order, ["invoke", "failure"]);
});

await test("thrown flush becomes an explicit failed close acknowledgement", async () => {
  const syntheticError = new Error("synthetic flush failure");
  const invocations = [];
  const failures = [];
  const result = await api.handleCloseSaveRequest(
    { requestId: 44 },
    () => { throw syntheticError; },
    {
      invokeClose: async (command, payload) => invocations.push({ command, payload }),
      onFailure: (message, error) => failures.push({ message, error }),
    },
  );
  assert.deepEqual(plain(result), { ok: false, written: false });
  assert.equal(failures[0].error, syntheticError);
  assert.equal(invocations[0].payload.ok, false);
});

await test("legacy or unsafe request ids flush but never acknowledge the Rust coordinator", async () => {
  const invocations = [];
  let flushes = 0;
  for (const requestId of [undefined, "45", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await api.handleCloseSaveRequest(
      { requestId },
      () => {
        flushes += 1;
        return { ok: true, written: false };
      },
      { invokeClose: async (command, payload) => invocations.push({ command, payload }) },
    );
  }
  assert.equal(flushes, 6);
  assert.equal(invocations.length, 0);
});

await test("command failure is surfaced instead of silently claiming close success", async () => {
  const commandError = new Error("synthetic invoke failure");
  const failures = [];
  const result = await api.handleCloseSaveRequest(
    { requestId: 46 },
    () => ({ ok: true, written: false }),
    {
      invokeClose: async () => { throw commandError; },
      onFailure: (message, error) => failures.push({ message, error }),
    },
  );
  assert.deepEqual(plain(result), { ok: false, written: false });
  assert.equal(closing, false);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error, commandError);
});

await test("installed listener handles the numbered desktop event and can unlisten", async () => {
  const before = defaultInvocations.length;
  const unlisten = await api.installCloseSaveHandler(() => ({ ok: true, written: false }));
  assert.equal(registeredEvent, "aivatar://save-before-close");
  assert.deepEqual(plain(registeredOptions), { target: { kind: "WebviewWindow", label: "synthetic-room" } });
  assert.equal(typeof registeredListener, "function");
  registeredListener({ payload: { requestId: 47 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(plain(defaultInvocations.slice(before)), [{
    command: "confirm_close_after_save",
    payload: { requestId: 47, ok: true },
  }]);
  unlisten();
  assert.equal(unlistenCount, 1);
});

await test("native close coordination fails closed and routes app quit through window saves", () => {
  const timeoutStart = rustSource.indexOf("let app_for_timeout = app.clone();");
  const timeoutEnd = rustSource.indexOf("tauri::WindowEvent::Destroyed", timeoutStart);
  assert.notEqual(timeoutStart, -1);
  assert.notEqual(timeoutEnd, -1);
  const timeoutBlock = rustSource.slice(timeoutStart, timeoutEnd);
  assert.match(timeoutBlock, /windows\.pending\.remove\(&label_for_timeout\)/);
  assert.doesNotMatch(timeoutBlock, /approved\.insert|window_for_timeout|\.close\(\)/);
  assert.match(timeoutBlock, /pending_exit_code = None/);
  assert.match(rustSource, /const CLOSE_SAVE_TIMEOUT_MS: u64 = 15_000/);
  assert.match(
    rustSource,
    /RunEvent::ExitRequested[\s\S]*api\.prevent_exit\(\)[\s\S]*window\.close\(\)/,
  );
  assert.match(rustSource, /pending_exit_code: Option<Option<i32>>/);
  assert.match(
    rustSource,
    /pending_exit_code\.take\(\)[\s\S]*replaying_exit = true[\s\S]*app_handle\.exit/,
  );
});

console.log(`Close-save smoke passed: ${checks} checks; no application files or real windows were used.`);
