#!/usr/bin/env node
// Exercise the actual worker/process boundary with synthetic local CLIs only.
// All fixtures stay in the printed temp directory; no logins, user configs,
// real conversations, bridge endpoints or installed providers are accessed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codebuddyRequiredFlags } from "./aivatar-learning-provider.mjs";

const directory = await mkdtemp(join(tmpdir(), "aivatar-learning-cli-smoke-"));
const worker = fileURLToPath(new URL("./aivatar-learning-worker.mjs", import.meta.url));
const avatar = join(directory, "avatar.json");
const executable = join(directory, process.platform === "win32" ? "provider.cmd" : "provider.mjs");
const script = join(directory, "provider.mjs");
const capture = join(directory, "captured.json");
// Keep installed providers off PATH while retaining the Windows command
// processor needed to execute our synthetic .cmd shim.
const fixturePath = [dirname(process.execPath),
  ...(process.platform === "win32" && process.env.SystemRoot
    ? [join(process.env.SystemRoot, "System32")] : []),
].join(delimiter);
await writeFile(avatar, JSON.stringify({ avatarName: "Fixture", traits: { warmth: 3 }, idleBubbleLanguagePreference: "en" }));
await writeFile(script, `#!${process.execPath}
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log(process.env.AIVATAR_SYNTHETIC_VERSION); process.exit(0); }
if (args.includes("--help")) { console.log(${JSON.stringify([...codebuddyRequiredFlags, "--safe-mode", "--format", "--agent", "--standalone"].join(" "))}); process.exit(0); }
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(process.env.AIVATAR_SYNTHETIC_CAPTURE, JSON.stringify({ args, suppliedPrompt: prompt.includes("synthetic garden"), config: process.env.OPENCODE_CONFIG_CONTENT }));
if (process.env.AIVATAR_SYNTHETIC_FAILURE) { console.error("unknown option --synthetic /private/token=secret"); process.exit(2); }
if (process.env.AIVATAR_SYNTHETIC_PROVIDER === "claude-code" && process.env.CLAUDECODE) { console.error("Nested Claude session"); process.exit(3); }
if (process.env.AIVATAR_SYNTHETIC_PROVIDER === "codebuddy") {
  // Match the published CodeBuddy 2.164.0 whitelist/deny gate. Its schema
  // encoder must survive while all tools with external effects remain absent.
  const allowed = args[args.indexOf("--tools") + 1]?.split(",");
  if (allowed?.length !== 1 || allowed[0] !== "StructuredOutput" || args[args.indexOf("--disallowedTools") + 1] !== "mcp__*") { console.error("StructuredOutput unavailable"); process.exit(4); }
}
const result = { summary: "We tended a synthetic garden", idleBubbleCandidates: ["A little garden victory"], socialBubbleCandidates: [], traitChanges: { warmth: 1 }, xp: 2, confidence: .8, privacyRisk: "low" };
if (process.env.AIVATAR_SYNTHETIC_UTF8_SPLIT) {
  result.summary = "小花喝好水啦";
  result.idleBubbleCandidates = ["小花喝好水啦", "我们一起歇一会儿吧"];
}
const encoded = JSON.stringify(process.env.AIVATAR_SYNTHETIC_PROVIDER === "opencode" ? { type: "text", part: { type: "text", text: JSON.stringify(result) } } : { type: "result", structured_output: result });
if (process.env.AIVATAR_SYNTHETIC_UTF8_SPLIT) {
  const bytes = Buffer.from(encoded);
  const boundary = bytes.indexOf(Buffer.from("小")) + 1;
  process.stdout.write(bytes.subarray(0, boundary));
  setTimeout(() => process.stdout.write(bytes.subarray(boundary)), 60);
} else console.log(encoded);
`);
await chmod(script, 0o700);
if (process.platform === "win32") await writeFile(executable, `@"${process.execPath}" "%~dp0provider.mjs" %*\r\n`);

let checks = 0;
for (const [provider, version] of [["claude-code", "2.1.200"], ["opencode", "1.2.0"], ["opencode", "2.0.26"], ["codebuddy", "2.164.0"]]) {
  const key = { "claude-code": "AIVATAR_CLAUDE_COMMAND", opencode: "AIVATAR_OPENCODE_COMMAND", codebuddy: "AIVATAR_CODEBUDDY_COMMAND" }[provider];
  const env = {
    PATH: fixturePath, HOME: directory, USERPROFILE: directory,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    [key]: executable,
    AIVATAR_SYNTHETIC_PROVIDER: provider, AIVATAR_SYNTHETIC_VERSION: version,
    AIVATAR_SYNTHETIC_CAPTURE: capture,
    CLAUDECODE: "1",
    AIVATAR_HTTP_ENDPOINT: "aivatar-synthetic-do-not-send:",
  };
  const learningId = `fixture-${provider}-${version.replaceAll(".", "-")}`;
  const args = [worker, "--provider", provider, "--agent", provider === "codebuddy" ? "workbuddy" : provider,
    "--session", "synthetic-cli", "--summary", "A synthetic garden finished", "--avatar-state-file", avatar,
    "--learning-id", learningId, "--dry-run"];
  const run = (extra = {}) => spawnSync(process.execPath, args, { cwd: directory, env: { ...env, ...extra }, encoding: "utf8", timeout: 15000 });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const learning = JSON.parse(result.stdout);
  assert.equal(learning.source, "llm", `${provider} ${version}: ${JSON.stringify(learning.diagnostic)}`);
  assert.equal(learning.diagnostic.provider, provider);
  assert.equal(learning.id, learningId);
  assert.deepEqual(learning.idleBubbleCandidates, ["A little garden victory"]);
  const invocation = JSON.parse(await readFile(capture, "utf8"));
  assert.equal(invocation.suppliedPrompt, true);
  if (provider === "claude-code" || provider === "codebuddy") assert.equal(invocation.args[invocation.args.indexOf("--tools") + 1], provider === "codebuddy" ? "StructuredOutput" : "");
  if (provider === "opencode") assert.equal(invocation.args.includes("--standalone"), version.startsWith("2."));
  const failure = run({ AIVATAR_SYNTHETIC_FAILURE: "1" });
  assert.equal(failure.status, 0);
  const fallback = JSON.parse(failure.stdout);
  assert.equal(fallback.id, learning.id);
  assert.equal(fallback.diagnostic.reason, "incompatible-client");
  assert.ok(!`${failure.stderr}${failure.stdout}`.includes("private"));
  const splitUtf8 = run({ AIVATAR_SYNTHETIC_UTF8_SPLIT: "1" });
  assert.equal(splitUtf8.status, 0, splitUtf8.stderr);
  const chineseLearning = JSON.parse(splitUtf8.stdout);
  assert.equal(chineseLearning.source, "llm");
  assert.equal(chineseLearning.summary, "小花喝好水啦");
  assert.deepEqual(chineseLearning.idleBubbleCandidates, ["小花喝好水啦", "我们一起歇一会儿吧"]);
  assert(!splitUtf8.stdout.includes("\uFFFD"), "provider UTF-8 chunks must not corrupt Chinese text");
  checks += 1;
  console.log(`PASS actual worker with synthetic ${provider} ${version}, including split UTF-8 output`);
}
console.log(`Learning CLI smoke passed (${checks} provider variants). Retained fixtures: ${directory}`);
