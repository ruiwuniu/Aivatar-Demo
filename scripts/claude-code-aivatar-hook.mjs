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

const hookEventName = (input, statusLine = false) => {
  const event =
    firstString(
      input?.hook_event_name,
      input?.hookEventName,
      input?.event_name,
      input?.eventName,
      typeof input?.event === "string" ? input.event : undefined,
      input?.type,
      input?.name,
      input?.kind,
      input?.phase,
      input?.status,
    ) ??
    firstString(
      input?.event?.hook_event_name,
      input?.event?.hookEventName,
      input?.event?.event_name,
      input?.event?.eventName,
      input?.event?.type,
      input?.event?.name,
      input?.event?.kind,
      input?.event?.phase,
      input?.payload?.hook_event_name,
      input?.payload?.type,
      input?.payload?.name,
      input?.data?.hook_event_name,
      input?.data?.type,
      input?.data?.name,
    );
  return event ?? (statusLine || input?.context_window ? "StatusLine" : "Unknown");
};

const claudeSurfaceLabel = (input) => {
  const text = [
    input?.mode,
    input?.surface,
    input?.channel,
    input?.client_mode,
    input?.clientMode,
    input?.app_mode,
    input?.appMode,
    input?.source,
    hookEventName(input),
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/\bcowork\b|co-work|teammate|subagent/u.test(text)) return "Claude Cowork";
  if (/\bchat\b|conversation/u.test(text)) return "Claude Chat";
  return "Claude Code";
};

const numberField = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const hashString = (value) => {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const safeName = (value) => String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");
const sessionIdForInput = (input) => {
  const explicit = firstString(
    process.env.AIVATAR_SESSION_ID,
    input?.session_id,
    input?.sessionId,
    input?.sessionID,
    input?.conversation_id,
    input?.conversationId,
    input?.thread_id,
    input?.threadId,
    input?.chat_id,
    input?.chatId,
    input?.cowork_session_id,
    input?.coworkSessionId,
    input?.session?.id,
    input?.conversation?.id,
    input?.thread?.id,
    input?.chat?.id,
    input?.cowork?.id,
    process.env.CLAUDE_SESSION_ID,
  );
  if (explicit) return explicit;

  const basis = firstString(
    input?.session_name,
    input?.conversation_title,
    input?.conversationTitle,
    input?.title,
    input?.workspace?.repo?.name,
    input?.workspace?.path,
    input?.cwd,
  );
  if (!basis) return "claude-code-session";
  return `claude-${safeName(`${claudeSurfaceLabel(input)}-${basis}`).slice(
    0,
    48,
  )}-${hashString(basis)}`;
};

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
      event: hookEventName(input, mode === "statusLine"),
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
    const turnUsages = [];
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const role = firstString(entry?.message?.role, entry?.role);
      if (scope === "turn" && role === "user") break;
      const usage = entry?.message?.usage;
      const parsed = usageFromClaudeUsage(usage, "claude-code-transcript", scope);
      if (!parsed) continue;
      if (scope !== "turn") return parsed;
      turnUsages.push(parsed);
    }
    if (turnUsages.length === 0) return undefined;
    return {
      inputTokens: turnUsages.reduce((sum, usage) => sum + usage.inputTokens, 0),
      cachedInputTokens: turnUsages.reduce(
        (sum, usage) => sum + usage.cachedInputTokens,
        0,
      ),
      outputTokens: turnUsages.reduce((sum, usage) => sum + usage.outputTokens, 0),
      totalTokens: turnUsages.reduce((sum, usage) => sum + usage.totalTokens, 0),
      contextTokens: turnUsages.reduce((sum, usage) => sum + usage.inputTokens, 0),
      modelContextWindow: turnUsages[0].modelContextWindow,
      source: "claude-code-transcript-turn",
      scope: "turn",
    };
  } catch {
    return undefined;
  }

  return undefined;
};

const toolName = (input) =>
  firstString(input?.tool_name, input?.tool?.name, input?.tool_use?.name);

const notificationNeedsUser = (input) => {
  const text = firstString(
    input?.message,
    input?.reason,
    input?.notification?.message,
    input?.notification_type,
  );
  return /permission|approval|approve|confirm|input|required|waiting|elicitation/i.test(
    text ?? "",
  );
};

const displayTextFromValue = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        displayTextFromValue(
          entry?.text ?? entry?.content ?? entry?.message ?? entry,
        ),
      )
      .filter(Boolean)
      .join(" ");
  }
  if (!value || typeof value !== "object") return "";
  for (const key of ["text", "delta", "message", "summary", "content"]) {
    const text = displayTextFromValue(value[key]);
    if (text.trim()) return text;
  }
  return "";
};

const displayTextFromInput = (...values) => {
  const text = values
    .map(displayTextFromValue)
    .find((value) => typeof value === "string" && value.trim());
  return text ? compactLearningText(text, 180) : undefined;
};

const statusForEvent = (input) => {
  const event = hookEventName(input);
  const lowerEvent = event.toLowerCase();
  const label = claudeSurfaceLabel(input);

  switch (event) {
    case "SessionStart":
      return {
        status: "idle",
        phase: "session-start",
        message: `${label} session connected`,
      };
    case "Setup":
      return {
        status: "idle",
        phase: "setup",
        message: `${label} setup loaded`,
      };
    case "InstructionsLoaded":
      return {
        status: "idle",
        phase: "instructions-loaded",
        message: `${label} instructions loaded`,
      };
    case "ConfigChange":
      return {
        status: "idle",
        phase: "config-change",
        message: `${label} configuration changed`,
      };
    case "CwdChanged":
      return {
        status: "idle",
        phase: "cwd-changed",
        message: `${label} workspace changed`,
      };
    case "UserPromptSubmit":
      return {
        status: "thinking",
        phase: "user-prompt",
        message: `${label} is thinking`,
      };
    case "UserPromptExpansion":
      return {
        status: "thinking",
        phase: "user-prompt-expansion",
        message: `${label} is expanding the prompt`,
      };
    case "PreCompact":
      return {
        status: "thinking",
        phase: "pre-compact",
        message: `${label} is preparing context compaction`,
      };
    case "PostCompact":
      return {
        status: "thinking",
        phase: "post-compact",
        message: `${label} is reviewing compacted context`,
      };
    case "ElicitationResult":
      return {
        status: "thinking",
        phase: "elicitation-result",
        message: `${label} received your response`,
      };
    case "MessageDisplay":
      return {
        status: "thinking",
        phase: "message-display",
        message:
          displayTextFromInput(
            input?.delta,
            input?.message,
            input?.text,
            input?.content,
            input?.last_assistant_message,
            input?.assistant_message,
          ) ?? `${label} is responding`,
      };
    case "PostToolBatch":
      return {
        status: "thinking",
        phase: "tool-batch-complete",
        message: `${label} is reading tool results`,
      };
    case "PostToolUse": {
      const name = toolName(input);
      return {
        status: "thinking",
        phase: name ? `tool-result:${name}` : "tool-result",
        message: name ? `${label} read ${name} result` : `${label} is reading tool results`,
      };
    }
    case "PreToolUse": {
      const name = toolName(input);
      return {
        status: "executing",
        phase: name ? `tool:${name}` : "tool",
        message: name ? `${label} is using ${name}` : `${label} is using a tool`,
      };
    }
    case "SubagentStart":
      return {
        status: "executing",
        phase: "subagent-start",
        message: `${label} started a subagent`,
      };
    case "TaskCreated":
      return {
        status: "executing",
        phase: "task-created",
        message: `${label} created a task`,
      };
    case "SubagentStop":
      return {
        status: "thinking",
        phase: "subagent-result",
        message: `${label} is reviewing subagent results`,
      };
    case "TaskCompleted":
      return {
        status: "thinking",
        phase: "task-result",
        message: `${label} is reviewing task results`,
      };
    case "PermissionRequest":
      return {
        status: "waiting_for_user",
        phase: "permission",
        message: `${label} is waiting for permission`,
      };
    case "Elicitation":
      return {
        status: "waiting_for_user",
        phase: "elicitation",
        message: `${label} is waiting for input`,
      };
    case "PermissionDenied":
      return {
        status: "error",
        phase: "permission-denied",
        message: `${label} permission was denied`,
      };
    case "PostToolUseFailure": {
      const name = toolName(input);
      return {
        status: "thinking",
        phase: name ? `tool-result-failed:${name}` : "tool-result-failed",
        message: name
          ? `${label} is reading ${name} failure`
          : `${label} is reading failed tool results`,
      };
    }
    case "Notification": {
      const message = firstString(input?.message, input?.notification?.message);
      const waiting = notificationNeedsUser(input);
      return {
        status: waiting ? "waiting_for_user" : "thinking",
        phase: "notification",
        message: message ?? `${label} notification`,
      };
    }
    case "Stop":
    case "TeammateIdle":
      return {
        status: "complete",
        phase: event,
        message: firstString(input?.last_assistant_message, `${label} turn complete`),
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
        message: `${label} session ended`,
      };
    default:
      if (/permission|approval|waiting|input_required|elicitation/u.test(lowerEvent)) {
        return {
          status: "waiting_for_user",
          phase: event,
          message: `${label} is waiting for input`,
        };
      }
      if (/fail|failed|error|exception/u.test(lowerEvent)) {
        return {
          status: "error",
          phase: event,
          message: `${label} reported an error`,
        };
      }
      if (/stop|complete|completed|done|idle/u.test(lowerEvent)) {
        return {
          status: "complete",
          phase: event,
          message: `${label} turn complete`,
        };
      }
      if (/tool|command|execute|executing|running|task|subagent/u.test(lowerEvent)) {
        return {
          status: "executing",
          phase: event,
          message: `${label} is using a tool`,
        };
      }
      return {
        status: "thinking",
        phase: event,
        message: `${label} activity`,
      };
  }
};

const preserveTerminalStatusAfterTurnEnd = (input, status, previousState) => {
  const event = hookEventName(input);
  if (previousState.status !== "complete" && previousState.status !== "error") return status;
  if (
    previousState.status === "error" &&
    typeof previousState.phase === "string" &&
    previousState.phase.startsWith("tool-failed")
  ) {
    return status;
  }
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

const isLifecycleOnlyEvent = (event) =>
  [
    "SessionStart",
    "Setup",
    "InstructionsLoaded",
    "ConfigChange",
    "CwdChanged",
    "SessionEnd",
  ].includes(event);

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
  add(input?.conversation_title);
  add(input?.conversationTitle);
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
    firstString(hookEventName(input))
      ? `event: ${hookEventName(input)}`
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
  const inputText = rawInput.replace(/^\uFEFF/u, "").trim();
  const input = inputText ? JSON.parse(inputText) : {};
  const hookEvent = hookEventName(input, statusLineMode);
  const isSessionEnd = !statusLineMode && hookEvent === "SessionEnd";
  const managedSessionId = firstString(process.env.AIVATAR_SESSION_ID);
  const sessionId = sessionIdForInput(input);
  const previousState = await readSessionState(sessionId);
  const eventShowsRealActivity =
    !statusLineMode && !isLifecycleOnlyEvent(hookEvent);
  const realActivitySeen =
    Boolean(previousState.realActivitySeen) || eventShowsRealActivity;
  const liveUsage =
    usageFromClaudeInput(input, "context-window") ??
    (await usageFromClaudeTranscript(input, "context-window")) ??
    (hookEvent === "UserPromptSubmit" ? undefined : previousState.latestUsage);
  const status = statusLineMode
    ? statusForStatusLine(input, previousState, liveUsage)
    : preserveTerminalStatusAfterTurnEnd(input, statusForEvent(input), previousState);
  const preservedTerminalStatus = Boolean(status.preservedTerminal);
  const isTerminalStatus = isTerminalStatusName(status.status);
  const repeatedTerminalStatus =
    isTerminalStatus &&
    isTerminalStatusName(previousState.status) &&
    hookEvent !== "UserPromptSubmit";
  const terminalUsage = isTerminalStatus
    ? repeatedTerminalStatus
      ? previousState.terminalUsage
      : (await usageFromClaudeTranscript(input, "turn")) ??
        usageFromClaudeInput(input, "turn")
    : undefined;
  const usage = isTerminalStatus ? terminalUsage : liveUsage;
  const eventTurnId = firstString(input?.turn_id, input?.message_id);
  const turnStartedAt =
    hookEvent === "UserPromptSubmit"
      ? new Date().toISOString()
      : previousState.turnStartedAt ?? new Date().toISOString();
  const turnId =
    hookEvent === "UserPromptSubmit"
      ? eventTurnId ?? turnStartedAt
      : previousState.turnId ?? eventTurnId ?? turnStartedAt;
  const timestamp =
    (statusLineMode || preservedTerminalStatus || repeatedTerminalStatus) &&
    previousState.status === status.status &&
    previousState.timestamp
      ? previousState.timestamp
      : new Date().toISOString();
  const payload = {
    agent: "claude-code",
    sessionId,
    rewardId: isTerminalStatus
      ? previousState.rewardId ?? `claude-code:${sessionId}:${turnId}`
      : undefined,
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
    usage,
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
    realActivitySeen,
    latestUsage:
      hookEvent === "UserPromptSubmit"
        ? payload.usage
        : payload.usage ?? previousState.latestUsage,
    terminalUsage: isTerminalStatus ? payload.usage : undefined,
    rewardId: isTerminalStatus ? payload.rewardId : undefined,
    turnId,
    turnStartedAt,
    lastLearningKey: isTerminalStatus
      ? previousState.lastLearningKey
      : undefined,
  });
  await appendEventLog(sessionId, input, payload, statusLineMode ? "statusLine" : "hook");

  const shouldIgnoreLifecycleOnly =
    !managedSessionId && !realActivitySeen && isLifecycleOnlyEvent(hookEvent);

  if (!shouldIgnoreLifecycleOnly) {
    await postJson(endpoint, payload);
    if (isSessionEnd && managedSessionId) {
      await postJson(disconnectEndpoint, {
        agent: payload.agent,
        sessionId,
      });
    } else {
      if (!isSessionEnd) {
        await postJson(presenceEndpoint, {
          agent: payload.agent,
          sessionId,
          timestamp,
        });
      }

      if (status.status === "idle" || isSessionEnd) {
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
  }

  if (statusLineMode) {
    const pct = numberField(input?.context_window?.used_percentage);
    const label = pct === undefined ? "Aivatar linked" : `Aivatar ${Math.round(pct)}% ctx`;
    process.stdout.write(label);
  }

  if (
    learningEnabled &&
    !shouldIgnoreLifecycleOnly &&
    isTerminalStatus &&
    !preservedTerminalStatus &&
    learningTriggerKey !== previousState.lastLearningKey
  ) {
    await writeSessionState(sessionId, {
      status: payload.status,
      phase: payload.phase,
      message: payload.message,
      timestamp: payload.timestamp,
      realActivitySeen,
      latestUsage: payload.usage ?? previousState.latestUsage,
      terminalUsage: payload.usage,
      rewardId: payload.rewardId,
      turnId,
      turnStartedAt,
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
