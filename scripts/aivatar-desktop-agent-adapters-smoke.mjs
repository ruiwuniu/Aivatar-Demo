#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const realFetch = globalThis.fetch;

const posted = [];
globalThis.fetch = async (url, init = {}) => {
  posted.push({
    url: String(url),
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  });
  return {
    ok: true,
    text: async () => '{"ok":true}',
  };
};

const opencodeModule = await import("./aivatar-opencode-plugin.mjs");
const claudeModule = await import("./aivatar-claude-desktop-link.mjs");

const logs = [];
const opencodePlugin = await opencodeModule.AivatarOpencodePlugin({
  directory: "C:/example/project",
  client: {
    app: {
      log: async (entry) => logs.push(entry),
    },
  },
});

await opencodePlugin.event({
  event: {
    type: "session.status",
    sessionID: "ses_aivatar",
    status: "running",
    title: "Building feature",
  },
});
await opencodePlugin.event({
  event: {
    type: "permission.asked",
    sessionID: "ses_aivatar",
    message: "Need approval",
  },
});
await opencodePlugin.event({
  event: {
    type: "session.idle",
    sessionID: "ses_aivatar",
    title: "Finished",
  },
});

const statusPosts = posted.filter((entry) =>
  entry.url.endsWith("/agent-status"),
);
assert.equal(statusPosts.length, 4);
assert.deepEqual(
  statusPosts.slice(0, 3).map((entry) => entry.body.status),
  ["executing", "waiting_for_user", "complete"],
);
assert.deepEqual(
  statusPosts.slice(0, 3).map((entry) => entry.body.agent),
  ["opencode", "opencode", "opencode"],
);
assert.equal(statusPosts[1].body.severity, "warning");
assert.equal(statusPosts[3].body.phase, "session-learning");
assert.equal(statusPosts[3].body.learning.source, "heuristic");
assert.ok(statusPosts[3].body.learning.idleBubbleCandidates.length > 0);
assert.ok(posted.some((entry) => entry.url.endsWith("/agent-presence")));
assert.ok(posted.some((entry) => entry.url.endsWith("/agent-active")));
assert.equal(logs[0]?.body?.message, "Aivatar opencode plugin initialized");

const fragment = claudeModule.createClaudeDesktopSettingsFragment();
assert.equal(fragment.env.AIVATAR_LEARNING_ENABLED, "1");
assert.equal(fragment.env.AIVATAR_LEARNING_PROVIDER, "claude-code");
assert.equal(fragment.statusLine.type, "command");
assert.ok(fragment.hooks.SessionStart);
assert.ok(fragment.hooks.UserPromptSubmit);
assert.ok(fragment.hooks.PreToolUse[0].matcher);

const merged = claudeModule.mergeClaudeDesktopSettings(
  {
    env: { KEEP_ME: "1" },
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: "existing",
            },
          ],
        },
      ],
    },
  },
  fragment,
);
assert.equal(merged.env.KEEP_ME, "1");
assert.equal(merged.env.AIVATAR_LEARNING_PROVIDER, "claude-code");
assert.ok(merged.hooks.UserPromptSubmit[0].hooks.length >= 2);
assert.ok(merged.hooks.MessageDisplay);

globalThis.fetch = realFetch;

const waitForBridge = async (port) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Bridge is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for test bridge");
};

const httpPort = 48988 + Math.floor(Math.random() * 2000);
const wsPort = httpPort - 1;
const bridge = spawn(process.execPath, ["scripts/codex-status-bridge.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AIVATAR_HTTP_PORT: String(httpPort),
    AIVATAR_WS_PORT: String(wsPort),
    AIVATAR_LEARNING_SCRIPT: "__missing_learning_worker__.mjs",
    AIVATAR_DISCONNECTED_SESSION_TOMBSTONE_PATH: "",
  },
  stdio: "ignore",
  windowsHide: true,
});

try {
  await waitForBridge(httpPort);
  const postHook = async (payload, path = "/agent-hooks/claude-code") => {
    const response = await fetch(`http://127.0.0.1:${httpPort}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.ok, true);
    return response.json();
  };

  await postHook({
    hook_event_name: "UserPromptSubmit",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
    prompt: "Please polish the Desktop Agents integration.",
  });
  const statusLineResponse = await postHook(
    {
      session_id: "claude_native_smoke",
      context_window: {
        current_usage: {
          input_tokens: 1200,
          cache_read_input_tokens: 100,
          output_tokens: 50,
        },
        context_window_size: 2000,
      },
    },
    "/agent-hooks/claude-code/status-line",
  );
  assert.match(statusLineResponse.label, /^Aivatar \d+% ctx$/);
  let snapshot = await fetch(`http://127.0.0.1:${httpPort}/agent-status`).then(
    (response) => response.json(),
  );
  let claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.status, "thinking");
  assert.equal(claudeSession.phase, "user-prompt");
  assert.equal(claudeSession.usage.contextTokens, 1300);

  await postHook({
    hook_event_name: "MessageDisplay",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
    delta: "The Desktop Agents card now feels more consistent.",
  });
  await postHook({
    hook_event_name: "Stop",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
  });
  snapshot = await fetch(`http://127.0.0.1:${httpPort}/agent-status`).then(
    (response) => response.json(),
  );
  claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.phase, "session-learning");
  assert.equal(claudeSession.learning.source, "heuristic");
  assert.ok(claudeSession.learning.idleBubbleCandidates.length > 0);
  const firstLearningId = claudeSession.learning.id;

  await postHook({
    hook_event_name: "Stop",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
  });
  snapshot = await fetch(`http://127.0.0.1:${httpPort}/agent-status`).then(
    (response) => response.json(),
  );
  claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.learning.id, firstLearningId);
} finally {
  bridge.kill();
}

console.log("Aivatar desktop agent adapter smoke test passed.");
