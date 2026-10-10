#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import * as provider from "./aivatar-learning-provider.mjs";

const raw = {
  summary: "We finished a small UI check",
  idleBubbleCandidates: ["Tiny details glow", "A quiet little victory"],
  socialBubbleCandidates: [],
  traitChanges: { focus: 1, resilience: 0, curiosity: 0, efficiency: 0, creativity: 0, warmth: 0 },
  xp: 2, confidence: 0.8, privacyRisk: "low",
};
let checks = 0;
const test = async (name, fn) => { await fn(); checks += 1; console.log(`PASS ${name}`); };
const json = JSON.stringify(raw);

await test("Claude structured output wins over empty/prose result", () => {
  assert.deepEqual(provider.parseClaudeOutput(JSON.stringify({ type: "result", result: "", structured_output: raw })), raw);
  assert.deepEqual(provider.parseClaudeOutput(JSON.stringify({ result: "finished", structured_output: raw })), raw);
});
await test("Claude direct/result object/result string/content variants", () => {
  for (const value of [raw, { result: raw }, { result: json }, { response: json }, { content: [{ type: "text", text: json }] }]) {
    assert.deepEqual(provider.parseClaudeOutput(JSON.stringify(value)), raw);
  }
});
await test("Malformed Claude and error envelopes cannot masquerade as success", () => {
  assert.throws(() => provider.parseClaudeOutput('{"result":"bad"}'), { reason: "invalid-output" });
  assert.throws(() => provider.parseClaudeOutput(JSON.stringify({ is_error: true, result: "Not logged in: secret=hidden", structured_output: raw })), { reason: "authentication" });
});
await test("OpenCode part.text and preceding lifecycle events", () => {
  assert.deepEqual(provider.parseOpencodeOutput([
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({ type: "text", part: { type: "text", text: json } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish" } }),
  ].join("\n")), raw);
});
await test("OpenCode legacy text and partial text streams", () => {
  assert.deepEqual(provider.parseOpencodeOutput(JSON.stringify({ text: json })), raw);
  const split = Math.floor(json.length / 2);
  assert.deepEqual(provider.parseOpencodeOutput([json.slice(0, split), json.slice(split)].map((text) => JSON.stringify({ type: "text", part: { text } })).join("\n")), raw);
});
await test("OpenCode excludes reasoning/tools and surfaces API errors", () => {
  const fake = JSON.stringify({ ...raw, summary: "Wrong reasoning" });
  assert.deepEqual(provider.parseOpencodeOutput([
    JSON.stringify({ type: "reasoning", part: { text: fake } }),
    JSON.stringify({ type: "tool_use", part: { text: fake } }),
    JSON.stringify({ type: "text", part: { text: json } }),
  ].join("\n")), raw);
  assert.throws(() => provider.parseOpencodeOutput(JSON.stringify({ type: "error", error: { name: "AuthenticationError", data: { message: "secret hidden" } } })), { reason: "authentication" });
});
await test("Diagnostics contain only bounded enums and an ISO date", () => {
  assert.equal(provider.classifyProviderFailure({ code: "ENOENT", message: "/private/key" }), "unavailable");
  assert.equal(provider.classifyProviderFailure({ code: "ETIMEDOUT" }), "timeout");
  assert.equal(provider.classifyProviderFailure(new Error("unknown option --safe-mode")), "provider-error");
  const value = provider.learningDiagnostic("claude-code", "fallback", "secret=hidden");
  assert.deepEqual(Object.keys(value).sort(), ["provider", "reason", "status", "timestamp"]);
  assert.equal(value.reason, "provider-error");
  assert.equal(new Date(value.timestamp).toISOString(), value.timestamp);
});

// Run the actual worker with its imports supplied as dependencies. All files,
// child processes and network requests are synthetic; no user data or CLI runs.
const source = (await readFile(new URL("./aivatar-learning-worker.mjs", import.meta.url), "utf8"))
  .replace(/^#![^\n]*\n/u, "")
  .replace(/^import [\s\S]*? from ["'][^"']+["'];\n/gmu, "")
  .replace("main().catch(() => {", "await main().catch(() => {");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runWorker = async (scenario = {}) => {
  const calls = []; const posts = []; const warnings = []; const output = [];
  const timers = new Set();
  const selectedProvider = scenario.provider ?? "claude-code";
  let stdin = "";
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.kill = () => { queueMicrotask(() => child.emit("close", null)); return true; };
    calls.push({ command, args, options });
    child.stdin.end = (text) => {
      stdin = text;
      queueMicrotask(() => {
        if (scenario.timeout) {
          for (const timer of [...timers]) timer();
          return;
        }
        if (scenario.spawnError) { child.emit("error", Object.assign(new Error("/private/token"), { code: scenario.spawnError })); return; }
        if (scenario.stderr) child.stderr.emit("data", Buffer.from(scenario.stderr));
        child.stdout.emit("data", Buffer.from(scenario.stdout ?? JSON.stringify({ structured_output: raw })));
        child.emit("close", scenario.code ?? 0);
      });
    };
    return child;
  };
  const dependencies = {
    createHash, randomUUID, spawn, ...provider, delimiter, dirname, join,
    access: async (path) => { if (scenario.existingPaths && !scenario.existingPaths.includes(path)) throw new Error("missing synthetic path"); },
    mkdir: async () => {}, writeFile: async () => {},
    readFile: async (path) => {
      if (String(path).endsWith(".output.json")) return scenario.stdout ?? json;
      assert.equal(path, "/synthetic/avatar.json");
      return JSON.stringify({ avatarName: "Test", traits: { warmth: 4 } });
    },
    tmpdir: () => "/synthetic/temp",
    process: {
      env: { AIVATAR_HTTP_ENDPOINT: "http://synthetic.invalid/status", AIVATAR_CLAUDE_COMMAND: "/synthetic/claude", AIVATAR_OPENCODE_COMMAND: "/synthetic/opencode", AIVATAR_CODEX_COMMAND: "/synthetic/codex", AIVATAR_LEARNING_ENABLED: "1", AIVATAR_OPENCODE_SET_ACTIVE: "1", ...scenario.env },
      argv: ["node", "worker", "--provider", selectedProvider, "--session", "synthetic", "--summary", "UI check done", "--avatar-state-file", "/synthetic/avatar.json", ...(scenario.dryRun ? ["--dry-run"] : [])],
      platform: "darwin", pid: 123, execPath: "/synthetic/node",
    },
    console: { warn: (value) => warnings.push(value), log: (value) => output.push(value) },
    setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn),
    fetch: async (url, options) => {
      posts.push({ url, payload: JSON.parse(options.body) });
      return { ok: !scenario.postFailure, text: async () => "secret=bridge-private" };
    },
  };
  await new AsyncFunction("deps", `const {${Object.keys(dependencies).join(",")}} = deps;\n${source}`)(dependencies);
  return { calls, posts, warnings, output, stdin, learning: posts[0]?.payload.learning ?? (output[0] ? JSON.parse(output[0]) : undefined) };
};

await test("Worker Claude keeps subscription-safe isolation and supplies schema", async () => {
  const value = await runWorker();
  assert.equal(value.learning.source, "llm");
  assert.equal(value.learning.diagnostic.status, "success");
  const args = value.calls[0].args;
  assert.ok(args.includes("--safe-mode")); assert.ok(!args.includes("--bare"));
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(JSON.parse(args[args.indexOf("--settings") + 1]).disableAllHooks, true);
  assert.ok(value.stdin.includes('"socialBubbleCandidates"'));
  assert.ok(value.stdin.includes("2 to 28 characters"));
  assert.equal(value.posts[0].url, "http://synthetic.invalid/status");
});
await test("Worker OpenCode accepts official events and isolates nested integration", async () => {
  const value = await runWorker({ provider: "opencode", stdout: JSON.stringify({ type: "text", part: { type: "text", text: json } }) });
  assert.equal(value.learning.source, "llm");
  const env = value.calls[0].options.env;
  assert.equal(env.AIVATAR_LEARNING_ENABLED, "0");
  assert.equal(env.AIVATAR_OPENCODE_LEARNING_ENABLED, "0");
  assert.equal(env.AIVATAR_OPENCODE_SET_ACTIVE, "0");
  assert.equal(env.OPENCODE_PURE, "true");
  assert.equal(env.OPENCODE_AUTO_SHARE, "false");
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  const args = value.calls[0].args;
  const agentName = args[args.indexOf("--agent") + 1];
  assert.equal(config.share, "disabled");
  assert.equal(config.permission, "deny");
  assert.equal(config.agent[agentName].permission, "deny");
  assert.equal(config.agent[agentName].tools["*"], false);
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, "true");
  assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, "true");
  assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE, "true");
  for (const key of ["AIVATAR_HTTP_ENDPOINT", "AIVATAR_STATUS_ENDPOINT", "AIVATAR_PRESENCE_ENDPOINT", "AIVATAR_ACTIVE_ENDPOINT", "AIVATAR_DISCONNECT_ENDPOINT"]) assert.equal(env[key], "aivatar-learning-disabled:");
  assert.ok(value.stdin.includes('"traitChanges"'));
});
await test("OpenCode inline provider/model settings survive no-share and no-tools overrides", async () => {
  const inherited = { model: "synthetic/model", provider: { synthetic: { options: { baseURL: "https://provider.invalid" } } }, share: "auto", permission: "allow", agent: { build: { permission: "allow" } } };
  const value = await runWorker({ provider: "opencode", stdout: JSON.stringify({ type: "text", part: { text: json } }), env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(inherited) } });
  const config = JSON.parse(value.calls[0].options.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.model, inherited.model);
  assert.deepEqual(config.provider, inherited.provider);
  assert.equal(config.share, "disabled");
  assert.equal(config.permission, "deny");
  assert.equal(value.learning.source, "llm");
  assert.equal(inherited.share, "auto");
  const invalid = await runWorker({ provider: "opencode", env: { OPENCODE_CONFIG_CONTENT: "invalid custom config" } });
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.learning.diagnostic.reason, "provider-error");
});
await test("OpenCode official home installation resolves without a shell PATH", async () => {
  const value = await runWorker({ provider: "opencode", env: { HOME: "/synthetic/home", AIVATAR_OPENCODE_COMMAND: undefined }, existingPaths: ["/synthetic/home/.opencode/bin/opencode"], stdout: JSON.stringify({ type: "text", part: { text: json } }) });
  assert.equal(value.calls[0].command, "/synthetic/home/.opencode/bin/opencode");
  assert.equal(value.learning.source, "llm");
});
await test("Worker Codex structured output remains compatible", async () => {
  const value = await runWorker({ provider: "codex", stdout: json });
  assert.equal(value.learning.source, "llm");
  assert.equal(value.learning.diagnostic.provider, "codex");
  assert.ok(value.calls[0].args.includes("--sandbox"));
});
await test("Worker classifies all provider failures without leaking raw errors", async () => {
  for (const [scenario, reason] of [
    [{ spawnError: "ENOENT" }, "unavailable"],
    [{ timeout: true }, "timeout"],
    [{ code: 1, stderr: "Not logged in secret=hidden /private/token" }, "authentication"],
    [{ stdout: "garbled private output" }, "invalid-output"],
    [{ stdout: JSON.stringify({ structured_output: { ...raw, idleBubbleCandidates: ["https://secret.invalid/token"] } }) }, "empty-candidates"],
    [{ code: 1, stderr: "unknown option --safe-mode /private/token" }, "provider-error"],
  ]) {
    const value = await runWorker(scenario);
    assert.equal(value.learning.source, "heuristic");
    assert.equal(value.learning.diagnostic.status, "fallback");
    assert.equal(value.learning.diagnostic.reason, reason);
    assert.equal(value.posts.length, 1);
    assert.ok(!JSON.stringify(value.posts).includes("private"));
    assert.ok(!value.warnings.join("").includes("hidden"));
    assert.ok(!value.warnings.join("").includes("/private"));
  }
});
await test("Explicit heuristic mode is not a provider failure", async () => {
  const value = await runWorker({ provider: "none" });
  assert.equal(value.learning.source, "heuristic");
  assert.equal(value.learning.diagnostic, undefined);
  assert.equal(value.calls.length, 0);
});
await test("Delivery failure does not fabricate a second learning result", async () => {
  const value = await runWorker({ postFailure: true });
  assert.equal(value.posts.length, 1);
  assert.equal(value.learning.source, "llm");
  assert.ok(!value.warnings.join("").includes("bridge-private"));
});
await test("Dry run returns safe diagnostics without posting", async () => {
  const value = await runWorker({ dryRun: true, spawnError: "ENOENT" });
  assert.equal(value.posts.length, 0);
  assert.equal(value.learning.diagnostic.reason, "unavailable");
});
console.log(`Learning provider smoke passed (${checks} checks).`);
