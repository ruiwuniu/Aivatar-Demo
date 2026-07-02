#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";

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
assert.ok(fragment.hooks.Setup);
assert.ok(fragment.hooks.InstructionsLoaded);
assert.ok(fragment.hooks.UserPromptSubmit);
assert.ok(fragment.hooks.UserPromptExpansion);
assert.ok(fragment.hooks.PreToolUse[0].matcher);
assert.ok(fragment.hooks.SubagentStart);
assert.ok(fragment.hooks.TaskCreated);
assert.ok(fragment.hooks.TaskCompleted);
assert.ok(fragment.hooks.Elicitation);

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
  const hookSmokeSuffix = `${Date.now().toString(36)}-${process.pid}`;
  const desktopHookSessionId = `claude_desktop_hook_smoke_${hookSmokeSuffix}`;
  const managedHookSessionId = `claude_managed_hook_smoke_${hookSmokeSuffix}`;
  const desktopHookLifecycleSessionId =
    `claude_desktop_hook_lifecycle_smoke_${hookSmokeSuffix}`;
  const nativeLifecycleSessionId = `claude_native_lifecycle_smoke_${hookSmokeSuffix}`;
  const coworkHookSessionId = `claude_cowork_hook_smoke_${hookSmokeSuffix}`;
  const inventorySessionId = `claude_inventory_smoke_${hookSmokeSuffix}`;
  const postHook = async (payload, path = "/agent-hooks/claude-code") => {
    const response = await fetch(`http://127.0.0.1:${httpPort}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.ok, true);
    return response.json();
  };
  const postStatus = async (payload) => {
    const response = await fetch(`http://127.0.0.1:${httpPort}/agent-status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.ok, true);
    return response.json();
  };
  const runNodeHook = (payload, extraEnv = {}) => {
    const result = spawnSync(
      process.execPath,
      ["scripts/claude-code-aivatar-hook.mjs"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          AIVATAR_HTTP_ENDPOINT: `http://127.0.0.1:${httpPort}/agent-status`,
          AIVATAR_ACTIVE_ENDPOINT: `http://127.0.0.1:${httpPort}/agent-active`,
          AIVATAR_PRESENCE_ENDPOINT: `http://127.0.0.1:${httpPort}/agent-presence`,
          AIVATAR_DISCONNECT_ENDPOINT: `http://127.0.0.1:${httpPort}/agent-sessions/disconnect`,
          AIVATAR_LEARNING_ENABLED: "0",
          ...extraEnv,
        },
        input: JSON.stringify(payload),
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  const readSnapshot = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${httpPort}/agent-status`);
        assert.equal(response.ok, true);
        return await response.json();
      } catch (error) {
        if (attempt >= 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error("Could not read bridge snapshot");
  };

  await postHook({
    hook_event_name: "SessionStart",
    session_id: nativeLifecycleSessionId,
  });
  await postHook({
    hook_event_name: "SessionEnd",
    session_id: nativeLifecycleSessionId,
    reason: "other",
  });
  let snapshot = await readSnapshot();
  assert.equal(
    snapshot.sessions.some(
      (session) =>
        session.agent === "claude-code" &&
        session.sessionId === nativeLifecycleSessionId,
    ),
    false,
  );

  const inventoryPayload = {
    agent: "claude-code",
    sessionId: inventorySessionId,
    status: "idle",
    phase: "desktop-chat-session",
    task: "Claude Chat session discovered",
    summary: "Claude Chat: Inventory smoke",
    message: "Inventory smoke",
    progress: 0,
    severity: "info",
    timestamp: new Date().toISOString(),
    source: "claude-desktop-inventory",
    surface: "chat",
    desktopSessionId: "local_inventory_smoke",
  };
  await postStatus(inventoryPayload);
  snapshot = await readSnapshot();
  let inventorySession = snapshot.sessions.find(
    (session) =>
      session.agent === "claude-code" &&
      session.sessionId === inventorySessionId,
  );
  assert.ok(inventorySession);
  assert.equal(inventorySession.status, "idle");
  assert.equal(inventorySession.phase, "desktop-chat-session");

  await postStatus({
    agent: "claude-code",
    sessionId: inventorySessionId,
    status: "executing",
    phase: "tool-use",
    summary: "Claude Code is using a tool",
    message: "Claude Code is using a tool",
    progress: 50,
    severity: "info",
    timestamp: new Date().toISOString(),
  });
  await postStatus({
    ...inventoryPayload,
    timestamp: new Date().toISOString(),
  });
  snapshot = await readSnapshot();
  inventorySession = snapshot.sessions.find(
    (session) =>
      session.agent === "claude-code" &&
      session.sessionId === inventorySessionId,
  );
  assert.ok(inventorySession);
  assert.equal(inventorySession.status, "executing");
  assert.equal(inventorySession.phase, "tool-use");

  await postStatus({
    agent: "claude-code",
    sessionId: inventorySessionId,
    status: "complete",
    phase: "desktop-chat-complete",
    summary: "Claude Chat: Inventory smoke",
    message: "A short Claude Chat reply",
    progress: 100,
    severity: "info",
    timestamp: new Date().toISOString(),
    source: "claude-desktop-activity",
    surface: "chat",
    desktopSessionId: "local_inventory_smoke",
  });
  await postStatus({
    ...inventoryPayload,
    timestamp: new Date().toISOString(),
  });
  snapshot = await readSnapshot();
  inventorySession = snapshot.sessions.find(
    (session) =>
      session.agent === "claude-code" &&
      session.sessionId === inventorySessionId,
  );
  assert.ok(inventorySession);
  assert.equal(inventorySession.status, "complete");
  assert.equal(inventorySession.phase, "desktop-chat-complete");

  const aliasDesktopSessionId = `local_alias_smoke_${hookSmokeSuffix}`;
  const aliasLocalSessionId = `local_alias_session_${hookSmokeSuffix}`;
  const aliasCliSessionId = `cli_alias_session_${hookSmokeSuffix}`;
  await postStatus({
    agent: "claude-code",
    sessionId: aliasLocalSessionId,
    status: "executing",
    phase: "desktop-cowork-running",
    summary: "Claude Cowork: Alias smoke",
    message: "Claude Cowork is running: Alias smoke",
    progress: 55,
    severity: "info",
    timestamp: new Date().toISOString(),
    source: "claude-desktop-activity",
    surface: "cowork",
    desktopSessionId: aliasDesktopSessionId,
  });
  await postStatus({
    agent: "claude-code",
    sessionId: aliasCliSessionId,
    status: "complete",
    phase: "desktop-cowork-complete",
    summary: "Claude Cowork: Alias smoke",
    message: "Claude Cowork turn complete",
    progress: 100,
    severity: "info",
    timestamp: new Date().toISOString(),
    source: "claude-desktop-activity",
    surface: "cowork",
    desktopSessionId: aliasDesktopSessionId,
  });
  snapshot = await readSnapshot();
  const aliasSessions = snapshot.sessions.filter(
    (session) =>
      session.agent === "claude-code" &&
      session.desktopSessionId === aliasDesktopSessionId,
  );
  assert.equal(aliasSessions.length, 1);
  assert.equal(aliasSessions[0].sessionId, aliasCliSessionId);
  assert.equal(aliasSessions[0].status, "complete");
  assert.equal(aliasSessions[0].phase, "desktop-cowork-complete");

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
  snapshot = await readSnapshot();
  let claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.status, "thinking");
  assert.equal(claudeSession.phase, "user-prompt");
  assert.equal(claudeSession.usage.contextTokens, 1300);

  await postHook({
    hook_event_name: "PreToolUse",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
    tool_name: "Bash",
    tool_input: { description: "Read a missing file" },
  });
  await postHook({
    hook_event_name: "PostToolUseFailure",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
    tool_name: "Bash",
    error: "exit code 1",
  });
  snapshot = await readSnapshot();
  claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.status, "thinking");
  assert.equal(claudeSession.phase, "tool-result-failed");

  await postHook({
    hook_event_name: "MessageDisplay",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
    delta: "The Desktop Agents card now feels more consistent.",
  });
  snapshot = await readSnapshot();
  claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.status, "executing");
  assert.equal(claudeSession.phase, "message-display");
  await postHook({
    hook_event_name: "PostToolUse",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
    tool_name: "Read",
  });
  snapshot = await readSnapshot();
  claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.status, "thinking");
  assert.equal(claudeSession.phase, "tool-result");
  await postHook({
    hook_event_name: "TaskCompleted",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
  });
  snapshot = await readSnapshot();
  claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.status, "thinking");
  await postHook({
    hook_event_name: "Stop",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
  });
  snapshot = await readSnapshot();
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
  snapshot = await readSnapshot();
  claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.learning.id, firstLearningId);

  await postHook({
    hook_event_name: "SessionEnd",
    session_id: "claude_native_smoke",
    turn_id: "turn-smoke-1",
    reason: "closed",
  });
  snapshot = await readSnapshot();
  claudeSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_native_smoke",
  );
  assert.ok(claudeSession);
  assert.equal(claudeSession.status, "complete");
  assert.equal(claudeSession.learning.id, firstLearningId);

  await postHook({
    eventName: "chat.message",
    conversationId: "claude_chat_smoke",
    mode: "chat",
    message: "Chat mode should be visible to Aivatar.",
  });
  snapshot = await readSnapshot();
  const chatSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_chat_smoke",
  );
  assert.ok(chatSession);
  assert.equal(chatSession.status, "thinking");
  assert.match(chatSession.summary, /Claude Chat/);

  await postHook({
    type: "cowork.idle",
    coworkSessionId: "claude_cowork_smoke",
    mode: "cowork",
    message: "Cowork turn finished.",
  });
  snapshot = await readSnapshot();
  const coworkSession = snapshot.sessions.find(
    (session) => session.agent === "claude-code" && session.sessionId === "claude_cowork_smoke",
  );
  assert.ok(coworkSession);
  assert.equal(coworkSession.status, "complete");
  assert.match(coworkSession.summary, /Claude Cowork/);

  runNodeHook({
    hook_event_name: "UserPromptSubmit",
    session_id: desktopHookSessionId,
    mode: "chat",
    prompt: "Track this desktop Chat session.",
  });
  runNodeHook({
    hook_event_name: "PreToolUse",
    session_id: desktopHookSessionId,
    mode: "chat",
    tool_name: "Bash",
    tool_input: { description: "Read a missing file" },
  });
  runNodeHook({
    hook_event_name: "PostToolUseFailure",
    session_id: desktopHookSessionId,
    mode: "chat",
    tool_name: "Bash",
    error: "exit code 1",
  });
  runNodeHook({
    hook_event_name: "MessageDisplay",
    session_id: desktopHookSessionId,
    mode: "chat",
    delta: "I saw the command fail and will recover.",
  });
  snapshot = await readSnapshot();
  let desktopHookSession = snapshot.sessions.find(
    (session) =>
      session.agent === "claude-code" &&
      session.sessionId === desktopHookSessionId,
  );
  assert.ok(desktopHookSession);
  assert.equal(desktopHookSession.status, "thinking");
  runNodeHook({
    hook_event_name: "Stop",
    session_id: desktopHookSessionId,
    mode: "chat",
    last_assistant_message: "Desktop Chat turn complete.",
  });
  runNodeHook({
    hook_event_name: "SessionEnd",
    session_id: desktopHookSessionId,
    mode: "chat",
    reason: "closed",
  });
  snapshot = await readSnapshot();
  desktopHookSession = snapshot.sessions.find(
    (session) =>
      session.agent === "claude-code" &&
      session.sessionId === desktopHookSessionId,
  );
  assert.ok(desktopHookSession);
  assert.equal(desktopHookSession.status, "complete");

  runNodeHook({
    hook_event_name: "SessionStart",
    session_id: desktopHookLifecycleSessionId,
  });
  runNodeHook({
    hook_event_name: "SessionEnd",
    session_id: desktopHookLifecycleSessionId,
    reason: "other",
  });
  snapshot = await readSnapshot();
  assert.equal(
    snapshot.sessions.some(
      (session) =>
        session.agent === "claude-code" &&
        session.sessionId === desktopHookLifecycleSessionId,
    ),
    false,
  );

  runNodeHook({
    hook_event_name: "TeammateIdle",
    session_id: coworkHookSessionId,
    mode: "cowork",
    last_assistant_message: "Cowork helper finished.",
  });
  snapshot = await readSnapshot();
  const coworkHookSession = snapshot.sessions.find(
    (session) =>
      session.agent === "claude-code" &&
      session.sessionId === coworkHookSessionId,
  );
  assert.ok(coworkHookSession);
  assert.equal(coworkHookSession.status, "complete");
  assert.match(coworkHookSession.summary, /Cowork helper finished/);

  runNodeHook(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "Managed launcher session.",
    },
    { AIVATAR_SESSION_ID: managedHookSessionId },
  );
  runNodeHook(
    {
      hook_event_name: "Stop",
      last_assistant_message: "Managed launcher turn complete.",
    },
    { AIVATAR_SESSION_ID: managedHookSessionId },
  );
  runNodeHook(
    {
      hook_event_name: "SessionEnd",
      reason: "closed",
    },
    { AIVATAR_SESSION_ID: managedHookSessionId },
  );
  snapshot = await readSnapshot();
  assert.equal(
    snapshot.sessions.some(
      (session) =>
        session.agent === "claude-code" &&
        session.sessionId === managedHookSessionId,
    ),
    false,
  );
} finally {
  if (bridge.exitCode === null && bridge.signalCode === null) {
    bridge.kill();
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1000);
      bridge.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

console.log("Aivatar desktop agent adapter smoke test passed.");
