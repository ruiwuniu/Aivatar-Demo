#!/usr/bin/env node
// Synthetic bridge-only checks. No discovery, provider invocation, or user data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = await mkdtemp(join(tmpdir(), "aivatar-learning-bridge-smoke-"));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const unusedPort = async () => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
};

async function withBridge(name, overrides, verify) {
  const httpPort = await unusedPort();
  let wsPort = await unusedPort();
  while (wsPort === httpPort) wsPort = await unusedPort();
  const child = spawn(process.execPath, ["scripts/codex-status-bridge.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      AIVATAR_HTTP_PORT: String(httpPort),
      AIVATAR_WS_PORT: String(wsPort),
      AIVATAR_AVATAR_STATE_PATH: join(fixture, "synthetic-avatar.json"),
      AIVATAR_DISCONNECTED_SESSION_TOMBSTONE_PATH: "",
      AIVATAR_LEARNING_SCRIPT: join(fixture, "missing-worker.mjs"),
      AIVATAR_LEARNING_ENABLED: "1",
      AIVATAR_LEARNING_PROVIDER: "claude-code",
      AIVATAR_NODE_COMMAND: join(fixture, "missing-node"),
      TMPDIR: fixture,
      TMP: fixture,
      TEMP: fixture,
      ...overrides,
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const url = `http://127.0.0.1:${httpPort}`;
  const post = async (path, payload) => {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert(response.ok, `${path} must succeed`);
    return response.json();
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      assert.equal(child.exitCode, null, `test bridge exited: ${stderr}`);
      try {
        ready = (await fetch(`${url}/health`)).ok;
        if (ready) break;
      } catch { /* Start-up only; isolated port has no listener yet. */ }
      await delay(25);
    }
    assert(ready, "isolated bridge must become ready");
    await verify({ post, url });
    assert.equal(child.exitCode, null, `bridge must stay alive: ${stderr}`);
    console.log(`PASS ${name}`);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
}

const sessionFrom = (snapshot, sessionId) => snapshot.sessions.find((session) => session.sessionId === sessionId);
const validDiagnostic = { provider: "opencode", status: "fallback", reason: "invalid-output", timestamp: "2026-10-10T00:00:00Z" };
const learningStatus = (sessionId, diagnostic) => ({
  agent: "opencode", sessionId, status: "complete", phase: "session-learning", rewardId: "synthetic-reward",
  learning: { id: `learning-${sessionId}`, source: "heuristic", summary: "Synthetic lesson", idleBubbleCandidates: ["A small discovery"], diagnostic },
});

await withBridge("diagnostic allowlist, compatibility, and reward identity", {}, async ({ post }) => {
  let snapshot = await post("/agent-status", learningStatus("valid", { ...validDiagnostic, stderr: "private raw output", command: "/private/path" }));
  let session = sessionFrom(snapshot, "valid");
  assert.deepEqual(session.learning.diagnostic, { ...validDiagnostic, timestamp: "2026-10-10T00:00:00.000Z" });
  assert.equal(session.rewardId, "synthetic-reward");
  for (const [key, value] of [["provider", "unknown"], ["status", "arbitrary"], ["reason", "secret error"], ["timestamp", "invalid"]]) {
    snapshot = await post("/agent-status", learningStatus(`invalid-${key}`, { ...validDiagnostic, [key]: value }));
    session = sessionFrom(snapshot, `invalid-${key}`);
    assert.equal(session.learning.diagnostic, undefined);
    assert.equal(session.learning.summary, "Synthetic lesson");
  }
  snapshot = await post("/agent-status", learningStatus("success", { ...validDiagnostic, status: "success" }));
  assert.equal(sessionFrom(snapshot, "success").learning.diagnostic.reason, undefined);
  snapshot = await post("/agent-status", learningStatus("legacy", undefined));
  assert.equal(sessionFrom(snapshot, "legacy").learning.diagnostic, undefined);
});

async function stopHook(post, sessionId) {
  await post("/agent-hooks/claude-code", { hook_event_name: "UserPromptSubmit", session_id: sessionId, prompt: "Synthetic test task" });
  return post("/agent-hooks/claude-code", { hook_event_name: "Stop", session_id: sessionId, turn_id: "synthetic-turn" });
}

await withBridge("missing worker reports fallback once", {}, async ({ post }) => {
  let snapshot = await stopHook(post, "missing-worker");
  const learning = sessionFrom(snapshot, "missing-worker").learning;
  assert.equal(learning.diagnostic.reason, "unavailable");
  assert.equal(learning.diagnostic.provider, "claude-code");
  snapshot = await post("/agent-hooks/claude-code", { hook_event_name: "Stop", session_id: "missing-worker", turn_id: "synthetic-turn" });
  assert.equal(sessionFrom(snapshot, "missing-worker").learning.id, learning.id);
});

await withBridge("missing node emits safe fallback and bridge stays alive", {
  AIVATAR_LEARNING_SCRIPT: join(root, "scripts/aivatar-learning-worker.mjs"),
}, async ({ post, url }) => {
  const snapshot = await stopHook(post, "missing-node");
  assert.equal(sessionFrom(snapshot, "missing-node").learning.diagnostic.reason, "unavailable");
  assert((await fetch(`${url}/health`)).ok);
});

await withBridge("intentional heuristic mode has no LLM failure", {
  AIVATAR_LEARNING_PROVIDER: "none",
}, async ({ post }) => {
  const snapshot = await stopHook(post, "heuristic-only");
  const learning = sessionFrom(snapshot, "heuristic-only").learning;
  assert.equal(learning.source, "heuristic");
  assert.equal(learning.diagnostic, undefined);
});

await withBridge("disabled learning has no candidate or false failure", {
  AIVATAR_LEARNING_ENABLED: "0",
}, async ({ post }) => {
  const snapshot = await stopHook(post, "disabled");
  assert.equal(sessionFrom(snapshot, "disabled").learning, undefined);
});

console.log(`Learning bridge regression checks passed. Synthetic fixtures retained: ${fixture}`);
