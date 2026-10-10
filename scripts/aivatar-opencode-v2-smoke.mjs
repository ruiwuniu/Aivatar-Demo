#!/usr/bin/env node
// Synthetic OpenCode contracts. No user plugin, account, bridge or transcript is opened.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "aivatar-opencode-v2-smoke-"));
const source = await readFile(join(root, "scripts/aivatar-opencode-plugin.mjs"), "utf8");
const v2Path = join(temporary, "v2.mjs");
await writeFile(v2Path, source.replace("export default AivatarOpencodePlugin;", "export default AivatarOpencodeV2Plugin;"));
const savedEnv = { ...process.env };
for (const key of Object.keys(process.env)) if (key.startsWith("AIVATAR_") || key === "NODE_COMMAND") delete process.env[key];
const posted = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { posted.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, text: async () => '{"ok":true}' }; };
const statuses = () => posted.filter((entry) => entry.url.endsWith("/agent-status")).map((entry) => entry.body);
let checks = 0;
const check = (label, fn) => { fn(); checks += 1; console.log(`PASS ${label}`); };
const waitUntil = async (fn) => { for (let n = 0; n < 100; n++) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error("Timed out waiting for synthetic event"); };
try {
  const legacy = await import(pathToFileURL(join(root, "scripts/aivatar-opencode-plugin.mjs")));
  check("legacy default remains callable for older V1", () => assert.equal(typeof legacy.default, "function"));
  const plugin = (await import(pathToFileURL(v2Path))).default;
  check("V2 loader accepts stable object definition", () => { assert.equal(typeof plugin, "object"); assert.equal(plugin.id, "aivatar"); assert.equal(typeof plugin.setup, "function"); });
  let iteratorSignal;
  let wake;
  const queue = [];
  let consumed = 0;
  const hooks = new Map();
  const cleanup = await plugin.setup({
    location: { directory: "/synthetic/project" },
    session: { hook: async (name, callback) => { hooks.set(name, callback); return { dispose: async () => {} }; } },
    event: { subscribe: ({ signal }) => {
      iteratorSignal = signal;
      signal.addEventListener("abort", () => wake?.({ done: true }));
      return { [Symbol.asyncIterator]() { return this; }, next() {
        consumed++;
        if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
        if (signal.aborted) return Promise.resolve({ done: true });
        return new Promise((resolveNext) => { wake = resolveNext; });
      } };
    } },
  });
  const publish = async (type, data = {}, more = {}) => {
    const event = { id: `evt_${consumed}_${queue.length}`, type, created: Date.now(), data: { sessionID: "ses_v2", ...data }, location: { directory: "/synthetic/project" }, ...more };
    const baseline = consumed;
    if (wake) { const resolveNext = wake; wake = undefined; resolveNext({ value: event, done: false }); } else queue.push(event);
    await waitUntil(() => consumed > baseline);
    return event;
  };
  check("registers prompt hook and abortable event subscription", () => { assert.ok(hooks.has("prompt")); assert.equal(iteratorSignal.aborted, false); });
  await publish("provider.changed", { sessionID: undefined });
  await publish("session.execution.started", {}, { location: { directory: "/another/project" } });
  check("ignores server-wide unrelated and foreign-location events", () => assert.equal(statuses().length, 0));
  const prompt = { sessionID: "ses_v2", messageID: "msg_user_1", prompt: { text: "Please water the flowers token=private123" } };
  const snapshot = JSON.stringify(prompt);
  await hooks.get("prompt")(prompt);
  check("prompt observation never mutates admitted input", () => assert.equal(JSON.stringify(prompt), snapshot));
  // The execution event may precede inbox delivery; the prompt must still own the turn identity.
  await publish("session.execution.started");
  await publish("session.inbox.delivered", { inboxID: "msg_user_1" });
  const textEvent = await publish("session.text.ended", { assistantMessageID: "msg_assistant_1", ordinal: 0, text: "Flowers are happy today." });
  await publish(textEvent.type, textEvent.data, { id: textEvent.id });
  check("forwards assistant text once with V2 data envelope", () => assert.equal(statuses().filter((s) => s.phase === "message-display").length, 1));
  await publish("session.reasoning.ended", { text: "PRIVATE_REASONING" });
  await publish("session.tool.success", { content: "PRIVATE_TOOL_RESULT" });
  await publish("session.tool.called", { name: "read", input: "PRIVATE_TOOL_ARGUMENTS" });
  await publish("permission.asked", { resources: ["/private/location"], message: "PRIVATE_PERMISSION_TEXT" });
  const tokens = { input: 30, output: 10, reasoning: 3, cache: { read: 5, write: 2 } };
  await publish("session.step.ended", { assistantMessageID: "msg_assistant_1", tokens });
  await publish("session.step.ended", { assistantMessageID: "msg_assistant_1", tokens });
  await publish("session.status", { status: { type: "idle" } });
  await publish("session.idle");
  check("V2 idle notification cannot prematurely award success", () => assert.equal(statuses().some((s) => s.status === "complete"), false));
  await publish("session.execution.succeeded");
  await publish("session.execution.succeeded");
  check("settles once with stable prompt reward ID and deduplicated tokens", () => {
    const completed = statuses().filter((s) => s.status === "complete" && s.phase !== "session-learning");
    assert.equal(completed.length, 1); assert.equal(completed[0].rewardId, "opencode:ses_v2:msg_user_1"); assert.equal(completed[0].usage.totalTokens, 50);
  });
  check("missing learning worker gives visible fixed diagnostic", () => {
    const learning = statuses().find((s) => s.phase === "session-learning").learning;
    assert.equal(learning.source, "heuristic");
    assert.equal(learning.diagnostic.provider, "opencode"); assert.equal(learning.diagnostic.status, "fallback"); assert.equal(learning.diagnostic.reason, "unavailable");
    assert.ok(Number.isFinite(Date.parse(learning.diagnostic.timestamp)));
  });
  check("excludes reasoning, tool contents, paths and secrets", () => assert.doesNotMatch(JSON.stringify(posted), /PRIVATE_|private123|\/private\/location/));
  await publish("session.inbox.enqueued", { inboxID: "msg_user_2", item: { type: "user", payload: { text: "Try again" } } });
  await publish("session.inbox.delivered", { inboxID: "msg_user_2" });
  await publish("session.execution.started");
  await publish("session.execution.failed", { error: { message: "PRIVATE_FAILURE_DETAIL" } });
  await publish("session.status", { status: { type: "idle" } });
  check("failed V2 execution remains error after idle", () => {
    const terminal = statuses().filter((s) => s.phase !== "session-learning" && ["complete", "error"].includes(s.status));
    assert.equal(terminal.at(-1).status, "error"); assert.equal(terminal.at(-1).rewardId, "opencode:ses_v2:msg_user_2");
    assert.doesNotMatch(JSON.stringify(posted), /PRIVATE_FAILURE_DETAIL/);
  });
  await publish("session.execution.started");
  await publish("session.execution.interrupted", { reason: "user" });
  check("interrupted execution is never reported successful", () => assert.equal(statuses().filter((s) => s.phase !== "session-learning").at(-1).status, "error"));
  cleanup();
  check("plugin cleanup aborts the public event stream", () => assert.equal(iteratorSignal.aborted, true));

  process.env.AIVATAR_LEARNING_SCRIPT = join(root, "scripts/aivatar-learning-worker.mjs");
  process.env.AIVATAR_NODE_COMMAND = join(temporary, "missing-node-command");
  const failedWorkerPlugin = await legacy.default({ directory: "/synthetic/worker-failure" });
  await failedWorkerPlugin["chat.message"]({ sessionID: "ses_worker_failure", messageID: "msg_failure" }, { message: "A short synthetic task" });
  await failedWorkerPlugin.event({ event: { type: "session.idle", sessionID: "ses_worker_failure" } });
  await failedWorkerPlugin.event({ event: { type: "session.idle", sessionID: "ses_worker_failure" } });
  await waitUntil(() => statuses().some((s) => s.sessionId === "ses_worker_failure" && s.phase === "session-learning"));
  check("async ENOENT reaches the bridge once without crashing OpenCode", () => {
    const failure = statuses().filter((s) => s.sessionId === "ses_worker_failure" && s.phase === "session-learning");
    assert.equal(failure.length, 1);
    assert.equal(failure[0].learning.diagnostic.reason, "unavailable");
    assert.equal(failure[0].learning.source, "heuristic");
    assert.match(failure[0].learning.id, /msg_failure/);
  });
  delete process.env.AIVATAR_LEARNING_SCRIPT;
  delete process.env.AIVATAR_NODE_COMMAND;

  // Test both install entrypoints using fake executable output in derived homes.
  // Keep every generated fixture for inspection; no original files are changed.
  for (const version of ["1.18.28", "2.0.26", "3.0.0", "unexpected"]) {
    const home = join(temporary, `install-${version}`);
    await mkdir(home, { recursive: true });
    const command = join(home, process.platform === "win32" ? "opencode.cmd" : "opencode");
    const body = process.platform === "win32" ? `@echo ${version}\r\n` : `#!/bin/sh\nprintf '%s\\n' '${version}'\n`;
    await writeFile(command, body, { mode: 0o700 });
    const result = spawnSync(process.execPath, ["scripts/aivatar-opencode-plugin.mjs", "install", "--apply"], { cwd: root, env: { ...process.env, HOME: home, USERPROFILE: home, AIVATAR_OPENCODE_COMMAND: command }, encoding: "utf8", windowsHide: true });
    const major = Number(version[0]);
    if ([1, 2].includes(major)) {
      assert.equal(result.status, 0, result.stderr);
      const installed = await readFile(join(home, ".config", "opencode", "plugins", "aivatar-opencode-plugin.js"), "utf8");
      check(`installer preserves V${major} API and embeds worker`, () => {
        assert.ok(installed.includes(`// AIVATAR_OPENCODE_API: ${major}\n`));
        assert.ok(installed.includes(major === 2 ? "export default AivatarOpencodeV2Plugin;" : "export default AivatarOpencodePlugin;"));
        assert.ok(installed.includes(resolve(root, "scripts/aivatar-learning-worker.mjs")));
      });
      const syntax = spawnSync(process.execPath, ["--check", join(home, ".config", "opencode", "plugins", "aivatar-opencode-plugin.js")], { encoding: "utf8" });
      assert.equal(syntax.status, 0, syntax.stderr);
    } else {
      check(`installer refuses unknown API ${version}`, () => { assert.notEqual(result.status, 0); assert.match(result.stderr, /Could not determine the OpenCode API version/); });
    }
  }
  console.log(JSON.stringify({ ok: true, checks, temporary }, null, 2));
} finally {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
