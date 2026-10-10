#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join, win32 } from "node:path";
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
  assert.equal(provider.classifyProviderFailure(new Error("unknown option --safe-mode")), "incompatible-client");
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
  const calls = []; const probes = []; const posts = []; const warnings = []; const output = []; const accessedPaths = [];
  const writtenFiles = new Map();
  const timers = new Set();
  const selectedProvider = scenario.provider ?? "claude-code";
  let stdin = "";
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.kill = () => { queueMicrotask(() => child.emit("close", null)); return true; };
    const probe = args.includes("--version") || args.includes("--help");
    (probe ? probes : calls).push({ command, args, options });
    child.stdin.end = (text) => {
      if (!probe) stdin = text;
      queueMicrotask(() => {
        if (probe) {
          const configured = scenario.probes?.[command];
          if (configured?.error || scenario.probeError) { child.emit("error", Object.assign(new Error("private probe"), { code: configured?.error ?? scenario.probeError })); return; }
          const version = configured?.version ?? scenario.version ?? (selectedProvider === "claude-code" ? "2.1.200 (Claude Code)" : selectedProvider === "codebuddy" ? "2.164.0" : "1.2.0");
          const help = configured?.help ?? scenario.help ?? (selectedProvider === "codebuddy" ? provider.codebuddyRequiredFlags.join(" ") : "--safe-mode --format --agent --standalone");
          child.stdout.emit("data", Buffer.from(args.includes("--version") ? version : help));
          child.emit("close", 0); return;
        }
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
    createHash, randomUUID, spawn, ...provider,
    ...(scenario.platform === "win32" ? { delimiter: win32.delimiter, dirname: win32.dirname, join: win32.join } : { delimiter, dirname, join }),
    access: async (path) => { accessedPaths.push(path); if (scenario.existingPaths && !scenario.existingPaths.includes(path)) throw new Error("missing synthetic path"); },
    mkdir: async () => {}, writeFile: async (file, text) => { writtenFiles.set(file, text); },
    readFile: async (path) => {
      if (String(path).endsWith(".output.json")) return scenario.stdout ?? json;
      assert.equal(path, "/synthetic/avatar.json");
      return JSON.stringify({ avatarName: "Test", traits: { warmth: 4 } });
    },
    tmpdir: () => "/synthetic/temp",
    process: {
      env: { AIVATAR_HTTP_ENDPOINT: "http://synthetic.invalid/status", AIVATAR_CLAUDE_COMMAND: "/synthetic/claude", AIVATAR_OPENCODE_COMMAND: "/synthetic/opencode", AIVATAR_CODEBUDDY_COMMAND: "/synthetic/codebuddy", AIVATAR_CODEX_COMMAND: "/synthetic/codex", AIVATAR_LEARNING_ENABLED: "1", AIVATAR_OPENCODE_SET_ACTIVE: "1", ...scenario.env },
      argv: ["node", "worker", "--provider", selectedProvider, "--session", "synthetic", "--summary", "UI check done", "--avatar-state-file", "/synthetic/avatar.json", ...(scenario.dryRun ? ["--dry-run"] : []), ...(scenario.learningId !== undefined ? ["--learning-id", scenario.learningId] : [])],
      platform: scenario.platform ?? "darwin", pid: 123, execPath: "/synthetic/node",
    },
    console: { warn: (value) => warnings.push(value), log: (value) => output.push(value) },
    setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn),
    fetch: async (url, options) => {
      posts.push({ url, payload: JSON.parse(options.body) });
      return { ok: !scenario.postFailure, text: async () => "secret=bridge-private" };
    },
  };
  await new AsyncFunction("deps", `const {${Object.keys(dependencies).join(",")}} = deps;\n${source}`)(dependencies);
  return { calls, probes, posts, warnings, output, stdin, writtenFiles, accessedPaths, exitCode: dependencies.process.exitCode, learning: posts[0]?.payload.learning ?? (output[0] ? JSON.parse(output[0]) : undefined) };
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

await test("Windows GUI discovery prefers USERPROFILE native bins when PATH is stale", async () => {
  const windowsHome = "C:\\Users\\DesktopUser";
  const gitHome = "C:\\Git\\AlternateHome";
  for (const bin of [[".local", "bin"], ["bin"]]) {
    const command = win32.join(windowsHome, ...bin, "claude.exe");
    const gitCommand = win32.join(gitHome, ...bin, "claude.exe");
    const value = await runWorker({
      provider: "claude-code", platform: "win32",
      env: { AIVATAR_CLAUDE_COMMAND: undefined, PATH: "", USERPROFILE: windowsHome, HOME: gitHome },
      existingPaths: [command, gitCommand],
    });
    assert.equal(value.learning.source, "llm");
    assert.equal(value.calls[0].command, command);
    assert(!value.probes.some((probe) => probe.command === gitCommand));
    assert(!value.accessedPaths.some((path) => path.includes("homebrew") || path.includes("usr\\local")));
  }
  const fallbackHome = win32.join(gitHome, ".local", "bin", "claude.exe");
  const fallback = await runWorker({ provider: "claude-code", platform: "win32",
    env: { AIVATAR_CLAUDE_COMMAND: undefined, PATH: "", USERPROFILE: undefined, HOME: gitHome },
    existingPaths: [fallbackHome] });
  assert.equal(fallback.calls[0].command, fallbackHome);
});

await test("Windows OpenCode official home bin is found without a shell PATH", async () => {
  const windowsHome = "C:\\Users\\DesktopUser";
  const command = win32.join(windowsHome, ".opencode", "bin", "opencode.exe");
  const value = await runWorker({ provider: "opencode", platform: "win32",
    env: { AIVATAR_OPENCODE_COMMAND: undefined, PATH: "", USERPROFILE: windowsHome, HOME: "C:\\Git\\AlternateHome" },
    existingPaths: [command], stdout: JSON.stringify({ type: "text", part: { text: json } }) });
  assert.equal(value.learning.source, "llm");
  assert.equal(value.calls[0].command, command);
});

await test("Windows explicit provider command never falls back to discovered native bins", async () => {
  const explicit = "C:\\Configured\\claude.exe";
  const discovered = "C:\\Users\\DesktopUser\\.local\\bin\\claude.exe";
  const value = await runWorker({ provider: "claude-code", platform: "win32",
    env: { AIVATAR_CLAUDE_COMMAND: explicit, PATH: "", USERPROFILE: "C:\\Users\\DesktopUser" },
    existingPaths: [discovered], probes: { [explicit]: { error: "ENOENT" } } });
  assert.equal(value.learning.source, "heuristic");
  assert.equal(value.learning.diagnostic.reason, "unavailable");
  assert.equal(value.calls.length, 0);
  assert(value.probes.every((probe) => probe.command === explicit));
  assert.equal(value.accessedPaths.length, 0, "an explicit override excludes every automatic path search");
});
await test("Worker Codex structured output remains compatible", async () => {
  const value = await runWorker({ provider: "codex", stdout: json });
  assert.equal(value.learning.source, "llm");
  assert.equal(value.learning.diagnostic.provider, "codex");
  assert.ok(value.calls[0].args.includes("--sandbox"));
});
await test("Codex one-shot learning retains auth but excludes work-session tools and configuration", async () => {
  const value = await runWorker({ provider: "codex", stdout: json });
  const args = value.calls[0].args;
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ephemeral"));
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args[args.indexOf("--ask-for-approval") + 1], "never");
  for (const setting of ["features.plugins=false", "features.hooks=false", "features.apps=false", "features.memories=false", "features.shell_tool=false", "features.unified_exec=false", "features.multi_agent=false", "project_doc_max_bytes=0", 'web_search="disabled"']) {
    assert.ok(args.some((arg, index) => arg === "--config" && args[index + 1] === setting), setting);
  }
  assert.equal(value.calls[0].options.env.CODEX_HOME, undefined, "do not relocate normal sign-in storage");
});
await test("Codex's actual written response schema meets strict object, array and enum constraints", async () => {
  const value = await runWorker({ provider: "codex", stdout: json });
  const args = value.calls[0].args;
  const schema = JSON.parse(value.writtenFiles.get(args[args.indexOf("--output-schema") + 1]));
  let enumCount = 0;
  const visit = (node) => {
    assert.ok(["object", "array", "string", "integer", "number", "boolean"].includes(node.type), JSON.stringify(node));
    if (node.enum) { enumCount += 1; assert.ok(node.enum.every((item) => typeof item === node.type)); }
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(visit);
    }
    if (node.type === "array") { assert.ok(node.items); visit(node.items); }
  };
  visit(schema);
  assert.equal(enumCount, 5);
});
await test("Codex automatic discovery prefers desktop bundles over an older PATH CLI", async () => {
  const cases = [
    "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    "/synthetic/home/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
  ];
  for (const command of cases) {
    const value = await runWorker({ provider: "codex", env: { AIVATAR_CODEX_COMMAND: undefined, CODEX_COMMAND: undefined, HOME: "/synthetic/home" }, existingPaths: [command], stdout: json });
    assert.equal(value.calls[0].command, command);
    assert.equal(value.learning.source, "llm");
  }
  const fallback = await runWorker({ provider: "codex", env: { AIVATAR_CODEX_COMMAND: undefined, CODEX_COMMAND: undefined }, existingPaths: [], stdout: json });
  assert.equal(fallback.calls[0].command, "codex");
});
await test("Explicit Codex overrides retain priority without a silent desktop substitution", async () => {
  const value = await runWorker({ provider: "codex", existingPaths: ["/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"], spawnError: "ENOENT" });
  assert.equal(value.calls.length, 1);
  assert.equal(value.calls[0].command, "/synthetic/codex");
  assert.equal(value.learning.diagnostic.reason, "unavailable");
  const empty = await runWorker({ provider: "codex", env: { AIVATAR_CODEX_COMMAND: "" }, spawnError: "ENOENT" });
  assert.equal(empty.calls.length, 1);
  assert.equal(empty.calls[0].command, "", "an explicit empty override must not silently select a different executable");
  assert.equal(empty.learning.diagnostic.reason, "unavailable");
});
await test("Worker classifies all provider failures without leaking raw errors", async () => {
  for (const [scenario, reason] of [
    [{ spawnError: "ENOENT" }, "unavailable"],
    [{ timeout: true }, "timeout"],
    [{ code: 1, stderr: "Not logged in secret=hidden /private/token" }, "authentication"],
    [{ stdout: "garbled private output" }, "invalid-output"],
    [{ stdout: JSON.stringify({ structured_output: { ...raw, idleBubbleCandidates: ["https://secret.invalid/token"] } }) }, "empty-candidates"],
    [{ code: 1, stderr: "unknown option --safe-mode /private/token" }, "incompatible-client"],
    [{ code: 1, stderr: "MCP 401 unauthorized\nThe 'synthetic-model' model requires a newer version of Codex. Please upgrade. /private/token" }, "incompatible-client"],
    [{ code: 1, stderr: "invalid_json_schema: Invalid schema for response_format at /private/token" }, "invalid-schema"],
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
  assert.equal(value.exitCode, 1);
});
await test("Dry run returns safe diagnostics without posting", async () => {
  const value = await runWorker({ dryRun: true, spawnError: "ENOENT" });
  assert.equal(value.posts.length, 0);
  assert.equal(value.learning.diagnostic.reason, "unavailable");
});
await test("Claude rejects an old CLI without sending a generation prompt", async () => {
  const old = await runWorker({ version: "2.1.168 (Claude Code)" });
  assert.equal(old.learning.diagnostic.reason, "incompatible-client");
  assert.equal(old.calls.length, 0);
  assert.equal(old.probes.length, 1);
  const current = await runWorker({ version: "2.1.169 (Claude Code)", help: "short help omits safe-mode" });
  assert.equal(current.learning.source, "llm");
  const unknown = await runWorker({ version: "development", help: "--print" });
  assert.equal(unknown.learning.diagnostic.reason, "incompatible-client");
  assert.equal(unknown.calls.length, 0);
});
await test("Automatic Claude discovery selects the newest compatible installation", async () => {
  const paths = ["/synthetic/old/claude", "/synthetic/new/claude", "/synthetic/home/.local/bin/claude"];
  const value = await runWorker({
    env: { AIVATAR_CLAUDE_COMMAND: undefined, PATH: `/synthetic/old${delimiter}/synthetic/new`, HOME: "/synthetic/home" },
    existingPaths: paths,
    probes: {
      [paths[0]]: { version: "2.1.150" },
      [paths[1]]: { version: "2.1.200" },
      [paths[2]]: { version: "2.1.250" },
    },
  });
  assert.equal(value.calls[0].command, paths[2]);
  assert.equal(value.learning.source, "llm");
});
await test("Explicit provider overrides never silently switch executable", async () => {
  for (const name of ["claude-code", "opencode", "codebuddy"]) {
    const key = { "claude-code": "AIVATAR_CLAUDE_COMMAND", opencode: "AIVATAR_OPENCODE_COMMAND", codebuddy: "AIVATAR_CODEBUDDY_COMMAND" }[name];
    const empty = await runWorker({ provider: name, env: { [key]: "" } });
    assert.equal(empty.learning.diagnostic.reason, "unavailable");
    assert.equal(empty.calls.length + empty.probes.length, 0);
    const absent = await runWorker({ provider: name, probeError: "ENOENT" });
    assert.equal(absent.learning.diagnostic.reason, "unavailable");
    assert.equal(absent.probes.length, 1);
    assert.equal(absent.calls.length, 0);
  }
});
await test("OpenCode V2 starts an isolated private server using canonical no-tool config", async () => {
  const inherited = { model: "synthetic/model", providers: { synthetic: { settings: { transport: "http" } } }, plugins: ["untrusted-plugin"], agents: { build: { permissions: [{ action: "*", resource: "*", effect: "allow" }] } } };
  const value = await runWorker({ provider: "opencode", version: "2.0.26", stdout: JSON.stringify({ type: "text", part: { type: "text", text: json } }), env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(inherited), OPENCODE_CONFIG: "/private/work-config" } });
  assert.equal(value.learning.source, "llm");
  const call = value.calls[0];
  assert.ok(call.args.includes("--standalone"));
  const env = call.options.env;
  assert.ok(env.OPENCODE_CONFIG_DIR.startsWith("/synthetic/temp/aivatar-learning-worker/"));
  assert.equal(env.OPENCODE_CONFIG, "");
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, "true");
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.model, inherited.model);
  assert.deepEqual(config.providers, inherited.providers);
  assert.equal(config.permission, undefined);
  assert.equal(config.agent, undefined);
  assert.deepEqual(config.permissions, [{ action: "*", resource: "*", effect: "deny" }]);
  const agentName = call.args[call.args.indexOf("--agent") + 1];
  assert.deepEqual(Object.keys(config.agents), [agentName]);
  assert.deepEqual(config.agents[agentName].permissions, config.permissions);
  assert.ok(config.agents[agentName].system.includes("Do not use tools"));
  assert.ok(!JSON.stringify(config).includes("untrusted-plugin"));
  assert.ok(config.plugins.includes("-opencode.config.mcp"));
  assert.equal(config.share, "disabled");
});
await test("OpenCode chooses V2 over stale V1 and refuses missing standalone capability", async () => {
  const paths = ["/synthetic/bin/opencode", "/synthetic/bin/opencode2"];
  const value = await runWorker({ provider: "opencode", env: { AIVATAR_OPENCODE_COMMAND: undefined, PATH: "/synthetic/bin" }, existingPaths: paths, probes: { [paths[0]]: { version: "1.2.0" }, [paths[1]]: { version: "2.0.26" } }, stdout: JSON.stringify({ type: "text", part: { text: json } }) });
  assert.equal(value.calls[0].command, paths[1]);
  assert.ok(value.calls[0].args.includes("--standalone"));
  const incompatible = await runWorker({ provider: "opencode", version: "2.0.26", help: "--format --agent" });
  assert.equal(incompatible.learning.diagnostic.reason, "incompatible-client");
  assert.equal(incompatible.calls.length, 0);
});
await test("OpenCode macOS desktop sidecar participates in version selection", async () => {
  for (const desktop of ["/Applications/OpenCode.app/Contents/MacOS/opencode-cli", "/synthetic/home/Applications/opencode.app/Contents/MacOS/opencode-cli"]) {
    const value = await runWorker({ provider: "opencode", env: { AIVATAR_OPENCODE_COMMAND: undefined, PATH: "/synthetic/bin", HOME: "/synthetic/home" }, existingPaths: [desktop, "/synthetic/bin/opencode"], probes: { [desktop]: { version: "2.0.26" }, "/synthetic/bin/opencode": { version: "1.2.0" } }, stdout: JSON.stringify({ type: "text", part: { text: json } }) });
    assert.equal(value.calls[0].command, desktop);
  }
});
await test("CodeBuddy generates structured learning with actual safe isolation flags", async () => {
  const value = await runWorker({ provider: "codebuddy", stdout: JSON.stringify({ type: "result", structured_output: raw }) });
  assert.equal(value.learning.source, "llm");
  assert.equal(value.learning.diagnostic.provider, "codebuddy");
  const { args, options } = value.calls[0];
  assert.equal(args[args.indexOf("--setting-sources") + 1], "none");
  assert.equal(args[args.indexOf("--tools") + 1], "StructuredOutput");
  assert.equal(args[args.indexOf("--disallowedTools") + 1], "mcp__*");
  assert.deepEqual(JSON.parse(args[args.indexOf("--mcp-config") + 1]), { mcpServers: {} });
  assert.equal(JSON.parse(args[args.indexOf("--settings") + 1]).disableAllHooks, true);
  assert.equal(options.env.CODEBUDDY_DISABLE_AUTO_MEMORY, "1");
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(!args.includes("--dangerously-skip-permissions"));
  assert.ok(!args.includes("--safe-mode"));
});
await test("CodeBuddy's upstream tool whitelist permits only its in-memory output encoder", () => {
  const args = provider.codebuddyLearningArgs({ type: "object" });
  // Upstream 2.164.0 agent_manager.wrapToolIsEnabled applies `--tools` to
  // StructuredOutput as well as regular tools. Reproduce that boundary, not
  // a fake provider that ignores permissions and always returns valid JSON.
  const enabled = args[args.indexOf("--tools") + 1].split(",").map((name) => name.trim()).filter(Boolean);
  const denied = args[args.indexOf("--disallowedTools") + 1];
  const available = (name) => enabled.includes(name) && denied !== "*" && !(denied === "mcp__*" && name.startsWith("mcp__"));
  assert.equal(available("StructuredOutput"), true);
  for (const name of ["Read", "Write", "Edit", "Bash", "PowerShell", "Agent", "WebFetch", "Skill", "mcp__example__read"]) assert.equal(available(name), false);
});
await test("Claude print-only learning removes the hook nesting marker while preserving auth", async () => {
  const inherited = { CLAUDECODE: "1", CLAUDE_CODE_OAUTH_TOKEN: "synthetic-auth-only", ANTHROPIC_API_KEY: "synthetic-key-only", CODEX_HOME: "/synthetic/auth-home" };
  const value = await runWorker({ env: inherited });
  const env = value.calls[0].options.env;
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, inherited.CLAUDE_CODE_OAUTH_TOKEN);
  assert.equal(env.ANTHROPIC_API_KEY, inherited.ANTHROPIC_API_KEY);
  assert.equal(env.CODEX_HOME, inherited.CODEX_HOME);
  assert.equal(inherited.CLAUDECODE, "1");
  assert.equal(value.learning.source, "llm");
});
await test("CodeBuddy requires all isolation capabilities and supports its cbc alias", async () => {
  for (const missing of ["--tools", "--setting-sources", "--strict-mcp-config", "--no-session-persistence"]) {
    const value = await runWorker({ provider: "codebuddy", help: provider.codebuddyRequiredFlags.filter((flag) => flag !== missing).join(" ") });
    assert.equal(value.learning.diagnostic.reason, "incompatible-client");
    assert.equal(value.calls.length, 0);
  }
  const value = await runWorker({ provider: "codebuddy", env: { AIVATAR_CODEBUDDY_COMMAND: undefined, PATH: "/synthetic/bin" }, existingPaths: ["/synthetic/bin/cbc"] });
  assert.equal(value.calls[0].command, "/synthetic/bin/cbc");
});
await test("Stable caller learning IDs survive LLM and fallback without duplicate identities", async () => {
  const learningId = "turn-0123456789abcdef";
  const success = await runWorker({ learningId, dryRun: true });
  const fallback = await runWorker({ learningId, dryRun: true, spawnError: "ENOENT" });
  assert.equal(success.learning.id, learningId);
  assert.equal(fallback.learning.id, learningId);
  assert.equal(success.posts.length + fallback.posts.length, 0);
  for (const bad of ["", "x".repeat(129), "../../private", "has space"]) {
    const result = await runWorker({ learningId: bad });
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.length + result.probes.length + result.posts.length, 0);
  }
});
await test("Unknown command flags are compatible-client failures across vendors", () => {
  for (const text of ["Unknown argument: standalone", "error: unrecognized option '--tools'", "unsupported flag --safe-mode", "unexpected argument '--json-schema' found"]) assert.equal(provider.classifyProviderFailure(new Error(text)), "incompatible-client");
});
console.log(`Learning provider smoke passed (${checks} checks).`);
