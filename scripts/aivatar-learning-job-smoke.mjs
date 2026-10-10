#!/usr/bin/env node
// Real subprocesses and an isolated production bridge, using only generated
// synthetic workers. No installed provider, real chats, saves or keys are read.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { failedLearning, learningJobId, learningStatus, runLearningJob, terminateWindowsLearningTree } from "./aivatar-learning-job.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = await mkdtemp(join(tmpdir(), "aivatar-learning-job-smoke-"));
const worker = join(fixture, "synthetic-worker.mjs");
const argvLog = join(fixture, "worker-argv.jsonl");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = async (name, run) => {
  try { await run(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
};
await writeFile(worker, `
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const mode = process.env.AIVATAR_SMOKE_CASE ?? "success";
appendFileSync(process.env.AIVATAR_SMOKE_ARGV_LOG, JSON.stringify({ pid: process.pid, mode, args }) + "\\n");
if (!args.includes("--dry-run") || !args.includes("--learning-id")) process.exit(88);
const output = {
  id: "model-generated-id-must-be-replaced", source: "llm", summary: "小花喝好水啦",
  idleBubbleCandidates: ["小花喝好水啦", "我们一起歇一会儿吧"], socialBubbleCandidates: [],
  traitChanges: { warmth: 1 }, xp: 2, confidence: 0.8, privacyRisk: "low",
  diagnostic: { provider: value("--provider"), status: "success", stderr: "PRIVATE-ERROR", command: "/private/command" },
};
if (mode === "exit") { process.stderr.write("PRIVATE-ERROR token=secret"); process.exit(1); }
else if (mode === "invalid") { process.stdout.write("PRIVATE-INVALID-JSON"); }
else if (mode === "wrong-provider") { output.diagnostic.provider = "unknown"; process.stdout.write(JSON.stringify(output)); }
else if (mode === "extra-fields") {
  output.rawError = "PRIVATE-ERROR";
  output.socialBubbleCandidates = [{kind:"active",text:"Hello",locale:"en",intentId:"greeting",rawError:"PRIVATE-ERROR",tags:["x".repeat(200)],replyToIntentIds:["r".repeat(200)]}];
  process.stdout.write(JSON.stringify(output));
}
else if (mode === "oversized") { process.stdout.write("x".repeat(1024 * 1024 + 50)); }
else if (mode === "timeout" || mode === "ignore-term") {
  if (mode === "ignore-term") process.on("SIGTERM", () => {});
  if (process.env.AIVATAR_SMOKE_PID_FILE) writeFileSync(process.env.AIVATAR_SMOKE_PID_FILE, String(process.pid));
  setInterval(() => {}, 1000);
}
else if (mode === "inherited-pipe") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", process.stdout, "ignore"] });
  writeFileSync(process.env.AIVATAR_SMOKE_PID_FILE, String(child.pid));
  process.stdout.write(JSON.stringify(output)); child.unref();
}
else if (mode === "fallback") {
  output.source = "heuristic"; output.diagnostic.status = "fallback"; output.diagnostic.reason = "authentication";
  process.stdout.write(JSON.stringify(output));
}
else if (mode === "split-utf8") {
  const bytes = Buffer.from(JSON.stringify(output)); const end = bytes.indexOf(Buffer.from("小")) + 1;
  process.stdout.write(bytes.subarray(0, end)); setTimeout(() => process.stdout.write(bytes.subarray(end)), 60);
}
else process.stdout.write(JSON.stringify(output));
`, { mode: 0o600 });

const options = (mode, overrides = {}) => ({
  learningScript: worker, provider: "codebuddy", agent: "workbuddy",
  sessionId: "synthetic-session", status: "complete", summary: "Synthetic task complete",
  digest: "Only fixed synthetic task metadata.", learningId: "synthetic-round-1", timeoutMs: 3000,
  env: { AIVATAR_SMOKE_CASE: mode, AIVATAR_SMOKE_ARGV_LOG: argvLog }, ...overrides,
});
const fallback = (result, reason) => {
  assert.equal(result.source, "heuristic");
  assert.equal(result.id, "synthetic-round-1");
  assert.equal(result.diagnostic.provider, "codebuddy");
  assert.equal(result.diagnostic.status, "fallback");
  assert.equal(result.diagnostic.reason, reason);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-|token=secret|\/private\//u);
};

await check("missing node and missing worker classify as unavailable", async () => {
  fallback(await runLearningJob(options("success", { nodeCommand: join(fixture, "missing-node") })), "unavailable");
  fallback(await runLearningJob(options("success", { learningScript: join(fixture, "missing-worker.mjs") })), "unavailable");
  fallback(await runLearningJob(options("success", { learningScript: fixture })), "unavailable");
});
await check("nonzero worker exit has one safe fallback", async () => {
  let delivered = 0;
  fallback(await runLearningJob(options("exit")).then((result) => { delivered++; return result; }), "provider-error");
  await sleep(40); assert.equal(delivered, 1);
});
await check("invalid, oversized and wrong-provider output cannot be success", async () => {
  for (const mode of ["invalid", "oversized", "wrong-provider"]) fallback(await runLearningJob(options(mode)), "invalid-output");
});
await check("success preserves exact Chinese split across stdout chunks", async () => {
  const result = await runLearningJob(options("split-utf8"));
  assert.equal(result.source, "llm"); assert.equal(result.summary, "小花喝好水啦");
  assert.deepEqual(result.idleBubbleCandidates, ["小花喝好水啦", "我们一起歇一会儿吧"]);
  assert.equal(result.id, "synthetic-round-1");
  assert.deepEqual(Object.keys(result.diagnostic).sort(), ["provider", "status", "timestamp"]);
});
await check("provider fallback strips raw diagnostic fields", async () => {
  fallback(await runLearningJob(options("fallback")), "authentication");
});
await check("success keeps only bounded learning and social fields", async () => {
  const result = await runLearningJob(options("extra-fields"));
  assert.equal(result.source, "llm");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-ERROR|rawError/);
  assert.equal(result.socialBubbleCandidates[0].tags[0].length, 18);
  assert.equal(result.socialBubbleCandidates[0].replyToIntentIds[0].length, 40);
});
await check("unknown WorkBuddy provider gets a visible safe diagnostic", async () => {
  fallback(await runLearningJob(options("success", { provider: "PRIVATE-INVALID-PROVIDER" })), "unavailable");
  assert.equal(failedLearning(options("success", { provider: "none" })).diagnostic, undefined);
});
await check("learning status and repeated round identity stay stable", async () => {
  const first = await runLearningJob(options("success"));
  const second = await runLearningJob(options("success"));
  assert.equal(first.id, second.id);
  assert.equal(learningJobId(options("success")), first.id);
  const status = learningStatus(options("success", { status: "error" }), first);
  assert.equal(status.phase, "session-learning"); assert.equal(status.agent, "workbuddy");
  assert.equal(status.status, "error"); assert.equal(status.severity, "error");
  assert.equal(status.usage, undefined); assert.equal(status.rewardId, undefined);
});
await check("timeout force-stops an uncooperative worker", async () => {
  const pidPath = join(fixture, "timeout-pid.txt");
  const started = Date.now();
  fallback(await runLearningJob(options("ignore-term", { timeoutMs: 300,
    env: { AIVATAR_SMOKE_CASE: "ignore-term", AIVATAR_SMOKE_ARGV_LOG: argvLog, AIVATAR_SMOKE_PID_FILE: pidPath },
  })), "timeout");
  assert(Date.now() - started < 2500);
  const pid = Number(await readFile(pidPath, "utf8"));
  let alive = true;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { process.kill(pid, 0); } catch { alive = false; break; }
    await sleep(50);
  }
  if (alive) process.kill(pid, "SIGKILL"); // Only this test's recorded child.
  assert.equal(alive, false, "a timed-out child must not remain alive");
});
await check("injected fake process IDs never reach the OS kill API", async () => {
  const child = new EventEmitter(); child.pid = 12345;
  child.stdout = new EventEmitter();
  const signals = []; child.kill = (signal) => { signals.push(signal); return true; };
  const originalKill = process.kill;
  let osKillCalls = 0;
  process.kill = () => { osKillCalls++; throw new Error("An injected PID must never reach process.kill"); };
  try {
    fallback(await runLearningJob(options("timeout", { timeoutMs: 20 }), { spawnImpl: () => child }), "timeout");
    assert.equal(osKillCalls, 0); assert.deepEqual(signals, ["SIGKILL"]);
  } finally { process.kill = originalKill; }
});
await check("Windows termination uses a hidden bounded taskkill for the owned tree", async () => {
  const signals = [];
  const child = { pid: 45678, kill: (signal) => signals.push(signal) };
  const calls = [];
  await terminateWindowsLearningTree(child, {
    ownedChild: true, systemRoot: "C:\\Windows",
    spawnTaskkill: (command, args, settings) => {
      calls.push({ command, args, settings });
      const killer = new EventEmitter(); queueMicrotask(() => killer.emit("close", 0)); return killer;
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "C:\\Windows\\System32\\taskkill.exe");
  assert.deepEqual(calls[0].args, ["/PID", "45678", "/T", "/F"]);
  assert.deepEqual(calls[0].settings, {
    shell: false, windowsHide: true, stdio: "ignore", timeout: 1500, killSignal: "SIGKILL",
  });
  assert.deepEqual(signals, [], "successful tree cleanup needs no second termination");
});
await check("Windows taskkill errors and timeout fall back safely to the child", async () => {
  for (const mode of ["throw", "error", "timeout"]) {
    const signals = [];
    await terminateWindowsLearningTree({ pid: 45678, kill: (signal) => signals.push(signal) }, {
      ownedChild: true,
      spawnTaskkill: () => {
        if (mode === "throw") throw new Error("PRIVATE-STARTUP-ERROR");
        const killer = new EventEmitter();
        queueMicrotask(() => {
          if (mode === "error") killer.emit("error", new Error("PRIVATE-TASKKILL-ERROR"));
          killer.emit("close", null, "SIGKILL");
        });
        return killer;
      },
    });
    assert.deepEqual(signals, ["SIGKILL"], `fallback must happen once for ${mode}`);
  }
});
await check("Windows fake or invalid process IDs cannot launch taskkill", async () => {
  let taskkillCalls = 0;
  for (const [ownedChild, pid] of [[false, 45678], [true, undefined], [true, 0], [true, -4]]) {
    const signals = [];
    await terminateWindowsLearningTree({ pid, kill: (signal) => signals.push(signal) }, {
      ownedChild, spawnTaskkill: () => { taskkillCalls++; throw new Error("must not spawn"); },
    });
    assert.deepEqual(signals, ["SIGKILL"]);
  }
  assert.equal(taskkillCalls, 0);
});
if (process.platform !== "win32") await check("timeout closes descendant pipes from the owned process group", async () => {
  const pidPath = join(fixture, "descendant-pid.txt");
  fallback(await runLearningJob(options("inherited-pipe", { timeoutMs: 350,
    env: { AIVATAR_SMOKE_CASE: "inherited-pipe", AIVATAR_SMOKE_ARGV_LOG: argvLog, AIVATAR_SMOKE_PID_FILE: pidPath },
  })), "timeout");
  await sleep(120);
  const pid = Number(await readFile(pidPath, "utf8"));
  let alive = false; try { process.kill(pid, 0); alive = true; } catch { /* Expected. */ }
  if (alive) process.kill(pid, "SIGKILL");
  assert.equal(alive, false, "a descendant holding stdout must be terminated");
});

const unusedPort = async () => {
  const server = net.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const { port } = server.address(); await new Promise((resolve) => server.close(resolve)); return port;
};
await check("isolated bridge receives asynchronous Claude result once per turn", async () => {
  const httpPort = await unusedPort(); let wsPort = await unusedPort();
  while (httpPort === wsPort) wsPort = await unusedPort();
  const bridgeLog = join(fixture, "bridge-worker-argv.jsonl");
  const bridge = spawn(process.execPath, [join(root, "scripts/codex-status-bridge.mjs")], {
    cwd: root, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, AIVATAR_HTTP_PORT: String(httpPort), AIVATAR_WS_PORT: String(wsPort),
      AIVATAR_AVATAR_STATE_PATH: join(fixture, "avatar.json"), AIVATAR_DISCONNECTED_SESSION_TOMBSTONE_PATH: "",
      AIVATAR_LEARNING_SCRIPT: worker, AIVATAR_NODE_COMMAND: process.execPath,
      AIVATAR_LEARNING_ENABLED: "1", AIVATAR_LEARNING_PROVIDER: "claude-code",
      AIVATAR_SMOKE_CASE: "success", AIVATAR_SMOKE_ARGV_LOG: bridgeLog, TMPDIR: fixture, TMP: fixture, TEMP: fixture },
  });
  let stderr = ""; bridge.stderr.on("data", (chunk) => { stderr += chunk; });
  const url = `http://127.0.0.1:${httpPort}`;
  const post = async (path, payload) => {
    const response = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert(response.ok); return response.json();
  };
  let proxy;
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      assert.equal(bridge.exitCode, null, stderr);
      try { ready = (await fetch(`${url}/health`)).ok; } catch { /* Startup. */ }
      if (ready) break; await sleep(25);
    }
    assert(ready);
    const session = "synthetic-bridge-session";
    await post("/agent-hooks/claude-code", { hook_event_name: "UserPromptSubmit", session_id: session, prompt: "Synthetic garden task" });
    await post("/agent-hooks/claude-code", { hook_event_name: "Stop", session_id: session, turn_id: "synthetic-turn-1" });
    let learned;
    for (let n = 0; n < 100; n++) {
      const snapshot = await (await fetch(`${url}/health`)).json();
      learned = snapshot.sessions.find((item) => item.sessionId === session)?.learning;
      if (learned) break; await sleep(25);
    }
    assert.equal(learned?.source, "llm"); assert.equal(learned.diagnostic.provider, "claude-code");
    assert.deepEqual(learned.idleBubbleCandidates, ["小花喝好水啦", "我们一起歇一会儿吧"]);
    const repeated = await post("/agent-hooks/claude-code", { hook_event_name: "Stop", session_id: session, turn_id: "synthetic-turn-1" });
    assert.equal(repeated.sessions.find((item) => item.sessionId === session).learning.id, learned.id);
    await sleep(100);
    const calls = (await readFile(bridgeLog, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(calls.length, 1); assert(calls[0].args.includes("--dry-run"));

    // A short-lived hook supervisor owns the single HTTP publication. The
    // generated worker asserts --dry-run and cannot publish anything itself.
    const delivered = [];
    proxy = http.createServer(async (request, response) => {
      let body = ""; for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body); delivered.push(payload);
      const forwarded = await post("/agent-status", payload);
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(forwarded));
    });
    proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
    const jobFile = join(fixture, "detached-hook-job.json");
    await writeFile(jobFile, JSON.stringify({ ...options("success"), digest: undefined,
      sessionId: "synthetic-detached-job", endpoint: `http://127.0.0.1:${proxy.address().port}/agent-status`,
    }), { mode: 0o600 });
    const child = spawn(process.execPath, [join(root, "scripts/aivatar-learning-job.mjs"), "--job-file", jobFile], { stdio: "ignore" });
    const [code] = await once(child, "exit"); assert.equal(code, 0); assert.equal(delivered.length, 1);
    assert.equal(delivered[0].phase, "session-learning"); assert.equal(delivered[0].learning.id, "synthetic-round-1");
    assert.equal(delivered[0].learning.source, "llm");

    // Exercise the real hook source with a generated sibling worker, so no
    // installed Claude executable or user transcript can be touched.
    const hookDir = join(fixture, "derived-hook"); await mkdir(hookDir);
    for (const name of ["claude-code-aivatar-hook.mjs", "aivatar-learning-job.mjs"]) {
      await writeFile(join(hookDir, name), await readFile(join(root, "scripts", name)));
    }
    await writeFile(join(hookDir, "aivatar-learning-worker.mjs"), await readFile(worker));
    const hookLog = join(fixture, "hook-worker-argv.jsonl");
    const hookSession = "synthetic-real-hook";
    const invokeHook = async (event) => {
      const hook = spawn(process.execPath, [join(hookDir, "claude-code-aivatar-hook.mjs")], {
        stdio: ["pipe", "ignore", "pipe"], env: { ...process.env,
          AIVATAR_LEARNING_ENABLED: "1", AIVATAR_LEARNING_PROVIDER: "claude-code",
          AIVATAR_HTTP_ENDPOINT: `${url}/agent-status`, AIVATAR_PRESENCE_ENDPOINT: `${url}/agent-presence`,
          AIVATAR_ACTIVE_ENDPOINT: `${url}/agent-active`, AIVATAR_DISCONNECT_ENDPOINT: `${url}/agent-sessions/disconnect`,
          AIVATAR_SESSION_ID: hookSession, AIVATAR_SMOKE_CASE: "success", AIVATAR_SMOKE_ARGV_LOG: hookLog,
          TMPDIR: fixture, TMP: fixture, TEMP: fixture },
      });
      let error = ""; hook.stderr.on("data", (chunk) => { error += chunk; });
      hook.stdin.end(JSON.stringify({ hook_event_name: event, session_id: hookSession, turn_id: "hook-turn-1", prompt: "Synthetic task" }));
      const [code] = await once(hook, "exit"); assert.equal(code, 0, error); assert.equal(error, "");
    };
    await invokeHook("UserPromptSubmit"); await invokeHook("Stop");
    let hookLearning;
    for (let n = 0; n < 100; n++) {
      const snapshot = await (await fetch(`${url}/health`)).json();
      hookLearning = snapshot.sessions.find((item) => item.sessionId === hookSession)?.learning;
      if (hookLearning) break; await sleep(25);
    }
    assert.equal(hookLearning?.source, "llm"); assert.equal(hookLearning.diagnostic.provider, "claude-code");
    await invokeHook("Stop"); await sleep(100);
    const hookCalls = (await readFile(hookLog, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(hookCalls.length, 1, "duplicate Stop must not spawn a second detached learning job");
    assert(hookCalls[0].args.includes("--dry-run"));
  } finally {
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
    if (bridge.exitCode === null) { const done = once(bridge, "exit"); bridge.kill("SIGKILL"); await done; }
  }
});

await writeFile(join(fixture, "report.json"), JSON.stringify({ results, realProviderUsed: false, realUserDataRead: false }, null, 2));
console.log(`Learning job checks: ${results.filter((item) => item.pass).length}/${results.length}. Synthetic fixtures retained: ${fixture}`);
if (results.some((item) => !item.pass)) process.exitCode = 1;
