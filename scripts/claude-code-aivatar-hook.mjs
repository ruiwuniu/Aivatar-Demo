#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const endpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const activeEndpoint =
  process.env.AIVATAR_ACTIVE_ENDPOINT ?? "http://127.0.0.1:38988/agent-active";
const presenceEndpoint =
  process.env.AIVATAR_PRESENCE_ENDPOINT ?? "http://127.0.0.1:38988/agent-presence";
const disconnectEndpoint =
  process.env.AIVATAR_DISCONNECT_ENDPOINT ??
  "http://127.0.0.1:38988/agent-sessions/disconnect";
const claudeDefaultModelContextWindow = Number(
  process.env.AIVATAR_CLAUDE_MODEL_CONTEXT_WINDOW ?? 200000,
);
const learningEnabled = /^(1|true|yes|on)$/i.test(
  process.env.AIVATAR_LEARNING_ENABLED ?? "",
);
const learningProvider =
  process.env.AIVATAR_LEARNING_PROVIDER ??
  process.env.AIVATAR_PROVIDER ??
  "claude-code";

const readStdin = async () => {
  let input = "";

  return new Promise((resolve) => {
    let settled = false;
    let idleTimer = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      resolve(input);
    };

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(settle, 50);
    });
    process.stdin.on("end", settle);
    process.stdin.on("error", settle);
    setTimeout(settle, 1000);
  });
};

const postJson = async (url, payload) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) throw new Error(await response.text());
  const text = await response.text();
  return text ? JSON.parse(text) : {};
};

const firstString = (...values) =>
  values.find((value) => typeof value === "string" && value.trim())?.trim();

const numberField = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const safeName = (value) => String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");
const statePathFor = (sessionId) =>
  join(tmpdir(), "aivatar-claude-code-state", `${safeName(sessionId)}.json`);
const eventLogPathFor = (sessionId) =>
  join(tmpdir(), "aivatar-claude-code-events", `${safeName(sessionId)}.jsonl`);

const readSessionState = async (sessionId) => {
  try {
    return JSON.parse(await readFile(statePathFor(sessionId), "utf8"));
  } catch {
    return {};
  }
};

const writeSessionState = async (sessionId, state) => {
  const path = statePathFor(sessionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
};

const appendEventLog = async (sessionId, input, payload, mode) => {
  const path = eventLogPathFor(sessionId);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(
    path,
    `${JSON.stringify({
      loggedAt: new Date().toISOString(),
      mode,
      event: input?.hook_event_name ?? (input?.context_window ? "StatusLine" : "Unknown"),
      tool: input?.tool_name,
      hasContextWindow: Boolean(input?.context_window),
      payload,
    })}\n`,
    "utf8",
  );
};

const usageFromClaudeInput = (input, scope = "context-window") => {
  const contextWindow = input?.context_window;
  if (!contextWindow || typeof contextWindow !== "object") return undefined;

  const currentUsage =
    contextWindow.current_usage && typeof contextWindow.current_usage === "object"
      ? contextWindow.current_usage
      : {};
  const freshInputTokens = numberField(currentUsage.input_tokens) ?? 0;
  const cacheCreationInputTokens =
    numberField(currentUsage.cache_creation_input_tokens) ?? 0;
  const cachedInputTokens = numberField(currentUsage.cache_read_input_tokens) ?? 0;
  const outputTokens =
    numberField(currentUsage.output_tokens) ??
    numberField(contextWindow.total_output_tokens) ??
    0;
  const totalInputTokens =
    numberField(contextWindow.total_input_tokens) ??
    freshInputTokens + cacheCreationInputTokens + cachedInputTokens;
  const modelContextWindow = numberField(contextWindow.context_window_size);
  const totalTokens = totalInputTokens + outputTokens;

  if (totalTokens <= 0) return undefined;

  return {
    inputTokens: totalInputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    contextTokens: totalInputTokens,
    modelContextWindow,
    source: "claude-code-statusline",
    scope,
  };
};

const usageFromClaudeUsage = (usage, source, scope = "context-window") => {
  if (!usage || typeof usage !== "object") return undefined;
  const freshInputTokens = numberField(usage.input_tokens) ?? 0;
  const cacheCreationInputTokens =
    numberField(usage.cache_creation_input_tokens) ?? 0;
  const cachedInputTokens = numberField(usage.cache_read_input_tokens) ?? 0;
  const outputTokens = numberField(usage.output_tokens) ?? 0;
  const inputTokens =
    freshInputTokens + cacheCreationInputTokens + cachedInputTokens;
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens <= 0) return undefined;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    contextTokens: inputTokens,
    modelContextWindow: Number.isFinite(claudeDefaultModelContextWindow)
      ? claudeDefaultModelContextWindow
      : 200000,
    source,
    scope,
  };
};

const usageFromClaudeTranscript = async (input, scope = "context-window") => {
  const transcriptPath = firstString(input?.transcript_path);
  if (!transcriptPath) return undefined;

  try {
    const text = await readFile(transcriptPath, "utf8");
    const lines = text.split(/\r?\n/u).filter(Boolean).reverse();
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = entry?.message?.usage;
      const parsed = usageFromClaudeUsage(usage, "claude-code-transcript", scope);
      if (parsed) return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const toolName = (input) =>
  firstString(input?.tool_name, input?.tool?.name, input?.tool_use?.name);

const statusForEvent = (input) => {
  const event = input?.hook_event_name ?? (input?.context_window ? "StatusLine" : "Unknown");

  switch (event) {
    case "SessionStart":
      return {
        status: "idle",
        phase: "session-start",
        message: "Claude Code session connected",
      };
    case "UserPromptSubmit":
      return {
        status: "thinking",
        phase: "user-prompt",
        message: "Claude Code is thinking",
      };
    case "MessageDisplay":
      return {
        status: "thinking",
        phase: "message-display",
        message: "Claude Code is responding",
      };
    case "PostToolBatch":
      return {
        status: "thinking",
        phase: "tool-batch-complete",
        message: "Claude Code is reading tool results",
      };
    case "PostToolUse": {
      const name = toolName(input);
      return {
        status: "thinking",
        phase: name ? `tool-result:${name}` : "tool-result",
        message: name ? `Claude Code read ${name} result` : "Claude Code is reading tool results",
      };
    }
    case "PreToolUse": {
      const name = toolName(input);
      return {
        status: "executing",
        phase: name ? `tool:${name}` : "tool",
        message: name ? `Claude Code is using ${name}` : "Claude Code is using a tool",
      };
    }
    case "PermissionRequest":
      return {
        status: "waiting_for_user",
        phase: "permission",
        message: "Claude Code is waiting for permission",
      };
    case "PermissionDenied":
      return {
        status: "error",
        phase: "permission-denied",
        message: "Claude Code permission was denied",
      };
    case "PostToolUseFailure": {
      const name = toolName(input);
      return {
        status: "error",
        phase: name ? `tool-failed:${name}` : "tool-failed",
        message: name ? `Claude Code tool failed: ${name}` : "Claude Code tool failed",
      };
    }
    case "Notification": {
      const message = firstString(input?.message, input?.notification?.message);
      const waiting = /permission|input|waiting|idle/i.test(message ?? "");
      return {
        status: waiting ? "waiting_for_user" : "thinking",
        phase: "notification",
        message: message ?? "Claude Code notification",
      };
    }
    case "Stop":
    case "SubagentStop":
    case "TeammateIdle":
    case "TaskCompleted":
      return {
        status: "complete",
        phase: event,
        message: firstString(input?.last_assistant_message, "Claude Code turn complete"),
      };
    case "StopFailure":
      return {
        status: "error",
        phase: firstString(input?.error, "StopFailure"),
        message: firstString(input?.last_assistant_message, input?.error_details, input?.error),
      };
    case "SessionEnd":
      return {
        status: "idle",
        phase: firstString(input?.reason, "SessionEnd"),
        message: "Claude Code session ended",
      };
    default:
      return {
        status: "thinking",
        phase: event,
        message: "Claude Code activity",
      };
  }
};

const preserveTerminalStatusAfterTurnEnd = (input, status, previousState) => {
  const event = input?.hook_event_name ?? (input?.context_window ? "StatusLine" : "Unknown");
  if (previousState.status !== "complete" && previousState.status !== "error") return status;
  if (event === "UserPromptSubmit") return status;
  if (status.status === "complete" || status.status === "error") return status;
  return {
    status: previousState.status,
    phase: previousState.phase,
    message: previousState.message,
    preservedTerminal: true,
  };
};

const isTerminalStatusName = (status) => status === "complete" || status === "error";

const shouldStatusLineComplete = (previousState, usage) => {
  if (!usage?.outputTokens || usage.outputTokens <= 0) return false;
  if (previousState.status === "complete" || previousState.status === "error") return false;
  return ["thinking", "executing", "waiting_for_user"].includes(previousState.status);
};

const statusForStatusLine = (input, previousState, usage) => {
  if (shouldStatusLineComplete(previousState, usage)) {
    return {
      status: "complete",
      phase: "statusline-complete",
      message: "Claude Code turn complete",
    };
  }

  if (previousState.status) {
    return {
      status: previousState.status,
      phase: previousState.phase,
      message: previousState.message,
    };
  }

  return {
    status: "idle",
    phase: "context-window",
    message: "Claude Code context updated",
  };
};

const idleBubbleCandidatesFromInput = (input) => {
  const candidates = [];
  const add = (value) => {
    const phrase = firstString(value)?.replace(/\s+/g, " ");
    if (!phrase) return;
    if (Array.from(phrase).length < 2 || Array.from(phrase).length > 28) return;
    if (!candidates.includes(phrase)) candidates.push(phrase);
  };

  add(input?.session_name);
  add(input?.workspace?.repo?.name);
  add(input?.agent?.name);

  return candidates.length > 0 ? candidates.slice(0, 6) : undefined;
};

const compactLearningText = (value, limit = 700) =>
  String(value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[path]")
    .replace(/(?:[./]|\\\\)[^\s"'<>]*[\\/][^\s"'<>]+/g, "[path]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

const transcriptMessageText = (entry) => {
  const content = entry?.message?.content ?? entry?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        typeof item === "string"
          ? item
          : typeof item?.text === "string"
            ? item.text
            : "",
      )
      .filter(Boolean)
      .join(" ");
  }
  return firstString(entry?.message?.text, entry?.text, entry?.summary) ?? "";
};

const learningDigestFromTranscript = async (input) => {
  const transcriptPath = firstString(input?.transcript_path);
  if (!transcriptPath) return "";

  try {
    const text = await readFile(transcriptPath, "utf8");
    const snippets = [];
    const lines = text.split(/\r?\n/u).filter(Boolean).slice(-20);
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const role = firstString(entry?.message?.role, entry?.role, entry?.type);
      const snippet = compactLearningText(transcriptMessageText(entry), 260);
      if (!snippet) continue;
      snippets.push(`${role ?? "message"}: ${snippet}`);
      if (snippets.length >= 6) break;
    }
    return snippets.join("\n");
  } catch {
    return "";
  }
};

const learningDigestFromInput = async (input, payload) => {
  const directSnippets = [
    firstString(input?.session_name) ? `session: ${input.session_name}` : "",
    firstString(input?.hook_event_name)
      ? `event: ${input.hook_event_name}`
      : input?.context_window
        ? "event: StatusLine"
        : "",
    firstString(input?.tool_name) ? `tool: ${input.tool_name}` : "",
    firstString(input?.message) ? `message: ${input.message}` : "",
    firstString(input?.last_assistant_message)
      ? `assistant: ${input.last_assistant_message}`
      : "",
    firstString(payload?.summary) ? `status: ${payload.summary}` : "",
  ]
    .map((snippet) => compactLearningText(snippet, 360))
    .filter(Boolean);
  const transcriptDigest = await learningDigestFromTranscript(input);
  return [...directSnippets, transcriptDigest].filter(Boolean).join("\n");
};

const writeLearningContext = async (sessionId, digest) => {
  const path = join(
    tmpdir(),
    "aivatar-learning-context",
    `${safeName(sessionId)}-${Date.now()}.txt`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, compactLearningText(digest, 2000), "utf8");
  return path;
};

const spawnLearningWorker = async (sessionId, input, payload) => {
  if (!learningEnabled) return null;
  if (payload.status !== "complete" && payload.status !== "error") return null;

  const digest = await learningDigestFromInput(input, payload);
  const contextPath = await writeLearningContext(sessionId, digest || payload.summary);
  const workerPath = join(scriptDir, "aivatar-learning-worker.mjs");
  const child = spawn(
    process.execPath,
    [
      workerPath,
      "--provider",
      learningProvider,
      "--agent",
      payload.agent,
      "--session",
      sessionId,
      "--status",
      payload.status,
      "--summary",
      payload.summary ?? payload.message ?? "Claude Code turn complete",
      "--context-file",
      contextPath,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        AIVATAR_AGENT: payload.agent,
        AIVATAR_SESSION_ID: sessionId,
        AIVATAR_LEARNING_PROVIDER: learningProvider,
      },
    },
  );
  child.unref();

  return {
    key: [
      payload.status,
      payload.phase,
      payload.timestamp,
      payload.usage?.totalTokens ?? 0,
      payload.summary,
    ].join(":"),
    provider: learningProvider,
    contextPath,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  };
};

try {
  const statusLineMode = process.argv.includes("--status-line");
  const rawInput = await readStdin();
  const input = rawInput.trim() ? JSON.parse(rawInput) : {};
  const hookEvent = input?.hook_event_name ?? (input?.context_window ? "StatusLine" : "Unknown");
  const isSessionEnd = !statusLineMode && hookEvent === "SessionEnd";
  const sessionId =
    firstString(
      process.env.AIVATAR_SESSION_ID,
      input.session_id,
      process.env.CLAUDE_SESSION_ID,
    ) ?? "claude-code-session";
  const previousState = await readSessionState(sessionId);
  const usage =
    usageFromClaudeInput(input, "context-window") ??
    (await usageFromClaudeTranscript(input, "context-window")) ??
    previousState.latestUsage;
  const status = statusLineMode
    ? statusForStatusLine(input, previousState, usage)
    : preserveTerminalStatusAfterTurnEnd(input, statusForEvent(input), previousState);
  const preservedTerminalStatus = Boolean(status.preservedTerminal);
  const isTerminalStatus = isTerminalStatusName(status.status);
  const timestamp =
    (statusLineMode || preservedTerminalStatus) &&
    previousState.status === status.status &&
    previousState.timestamp
      ? previousState.timestamp
      : new Date().toISOString();
  const payload = {
    agent: "claude-code",
    sessionId,
    status: status.status,
    phase: status.phase,
    task: status.message,
    summary: status.message,
    progress:
      status.status === "complete" ? 100 : status.status === "idle" ? 0 : 50,
    message: status.message,
    severity:
      status.status === "error"
        ? "error"
        : status.status === "waiting_for_user"
          ? "warning"
          : "info",
    timestamp,
    usage: usage
      ? {
          ...usage,
          scope: isTerminalStatus ? "turn" : usage.scope ?? "context-window",
        }
      : undefined,
    idleBubbleCandidates: idleBubbleCandidatesFromInput(input),
  };
  const learningTriggerKey = [
    payload.status,
    payload.phase,
    payload.timestamp,
    payload.usage?.totalTokens ?? 0,
    payload.summary,
  ].join(":");

  await writeSessionState(sessionId, {
    status: payload.status,
    phase: payload.phase,
    message: payload.message,
    timestamp: payload.timestamp,
    latestUsage: payload.usage ?? previousState.latestUsage,
    lastLearningKey: isTerminalStatus
      ? previousState.lastLearningKey
      : undefined,
  });
  await appendEventLog(sessionId, input, payload, statusLineMode ? "statusLine" : "hook");

  await postJson(endpoint, payload);
  if (isSessionEnd) {
    await postJson(disconnectEndpoint, {
      agent: payload.agent,
      sessionId,
    });
  } else {
    await postJson(presenceEndpoint, {
      agent: payload.agent,
      sessionId,
      timestamp,
    });

    if (status.status === "idle") {
      await postJson(activeEndpoint, {
        clear: true,
        agent: payload.agent,
        sessionId,
      });
    } else {
      await postJson(activeEndpoint, {
        agent: payload.agent,
        sessionId,
      });
    }
  }

  if (statusLineMode) {
    const pct = numberField(input?.context_window?.used_percentage);
    const label = pct === undefined ? "Aivatar linked" : `Aivatar ${Math.round(pct)}% ctx`;
    process.stdout.write(label);
  }

  if (
    learningEnabled &&
    isTerminalStatus &&
    !preservedTerminalStatus &&
    learningTriggerKey !== previousState.lastLearningKey
  ) {
    await writeSessionState(sessionId, {
      status: payload.status,
      phase: payload.phase,
      message: payload.message,
      timestamp: payload.timestamp,
      latestUsage: payload.usage ?? previousState.latestUsage,
      lastLearningKey: learningTriggerKey,
    });
    void spawnLearningWorker(sessionId, input, payload).catch(() => {
      // Learning is best-effort and must not break Claude Code hooks.
    });
  }
} catch (error) {
  if (process.argv.includes("--status-line")) {
    process.stdout.write("Aivatar offline");
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[claude-code-aivatar-hook] ${message}`);
  }
}
