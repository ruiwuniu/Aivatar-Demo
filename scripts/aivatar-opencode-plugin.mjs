#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptName = basename(scriptPath);

const DEFAULT_STATUS_ENDPOINT = "http://127.0.0.1:38988/agent-status";
const DEFAULT_PRESENCE_ENDPOINT = "http://127.0.0.1:38988/agent-presence";
const DEFAULT_ACTIVE_ENDPOINT = "http://127.0.0.1:38988/agent-active";
const DEFAULT_DISCONNECT_ENDPOINT =
  "http://127.0.0.1:38988/agent-sessions/disconnect";
const AGENT = "opencode";
const EMBEDDED_LEARNING_SCRIPT = "__AIVATAR_LEARNING_SCRIPT__";
const EMBEDDED_NODE_COMMAND = "__AIVATAR_NODE_COMMAND__";
const DEFAULT_LEARNING_SCRIPT =
  EMBEDDED_LEARNING_SCRIPT.startsWith("__AIVATAR_")
    ? ""
    : EMBEDDED_LEARNING_SCRIPT;
const DEFAULT_NODE_COMMAND =
  EMBEDDED_NODE_COMMAND.startsWith("__AIVATAR_") ? "" : EMBEDDED_NODE_COMMAND;
const MAX_DIGEST_ENTRIES = 10;

const usage = `Usage:
  node scripts/aivatar-opencode-plugin.mjs
  node scripts/aivatar-opencode-plugin.mjs install --apply

This file is both an opencode plugin and a tiny installer helper.

Default behavior prints the target plugin path without changing files.
Pass install --apply to copy this plugin to:
  ~/.config/opencode/plugins/aivatar-opencode-plugin.js

The plugin sends low-detail opencode session lifecycle events to Aivatar's
local bridge. It does not read or upload full transcript contents.
`;

const endpointConfig = () => ({
  status:
    process.env.AIVATAR_HTTP_ENDPOINT ??
    process.env.AIVATAR_STATUS_ENDPOINT ??
    DEFAULT_STATUS_ENDPOINT,
  presence: process.env.AIVATAR_PRESENCE_ENDPOINT ?? DEFAULT_PRESENCE_ENDPOINT,
  active: process.env.AIVATAR_ACTIVE_ENDPOINT ?? DEFAULT_ACTIVE_ENDPOINT,
  disconnect:
    process.env.AIVATAR_DISCONNECT_ENDPOINT ??
    process.env.AIVATAR_DISCONNECT_SESSION_ENDPOINT ??
    DEFAULT_DISCONNECT_ENDPOINT,
  learningScript:
    process.env.AIVATAR_LEARNING_SCRIPT ??
    process.env.AIVATAR_OPENCODE_LEARNING_SCRIPT ??
    DEFAULT_LEARNING_SCRIPT,
  nodeCommand:
    process.env.AIVATAR_NODE_COMMAND ??
    process.env.NODE_COMMAND ??
    DEFAULT_NODE_COMMAND,
  learningProvider:
    process.env.AIVATAR_LEARNING_PROVIDER ??
    process.env.AIVATAR_OPENCODE_LEARNING_PROVIDER ??
    "opencode",
  setActive: !/^(0|false|no|off)$/i.test(
    process.env.AIVATAR_OPENCODE_SET_ACTIVE ?? "1",
  ),
  learningEnabled: !/^(0|false|no|off)$/i.test(
    process.env.AIVATAR_LEARNING_ENABLED ??
      process.env.AIVATAR_OPENCODE_LEARNING_ENABLED ??
      "1",
  ),
});

const postJson = async (url, payload) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
};

const bestEffort = async (task, timeoutMs = 500) => {
  try {
    await Promise.race([
      task,
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Optional plugin diagnostics must not block opencode startup.
  }
};

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const safeText = (value, maxLength = 120) =>
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
    .slice(0, maxLength);

const firstString = (...values) =>
  values.find((value) => typeof value === "string" && value.trim())?.trim();

const findStringByKey = (value, keys, depth = 0, seen = new Set()) => {
  if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  for (const key of keys) {
    const direct = value[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  for (const nested of Object.values(value)) {
    const result = findStringByKey(nested, keys, depth + 1, seen);
    if (result) return result;
  }
  return undefined;
};

const messageText = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(messageText).filter(Boolean).join(" ");
  }
  if (!value || typeof value !== "object") return "";
  return firstString(
    value.text,
    value.content,
    value.message,
    value.summary,
    value.title,
  ) ?? "";
};

const eventType = (event) =>
  firstString(event?.type, event?.name, event?.event, event?.kind) ?? "unknown";

const sessionIdForEvent = (event, context) => {
  const explicit = findStringByKey(event, [
    "sessionID",
    "sessionId",
    "session_id",
    "session",
  ]);
  if (explicit && explicit !== eventType(event)) return explicit;

  const basis = firstString(
    context?.worktree,
    context?.directory,
    context?.project?.path,
    context?.project?.id,
    "opencode-session",
  );
  return `opencode-${hashString(basis)}`;
};

const statusFromEvent = (event) => {
  const type = eventType(event).toLowerCase();
  const rawStatus =
    findStringByKey(event, ["status", "state", "phase"])?.toLowerCase() ?? "";

  if (type === "session.deleted") return "idle";
  if (type === "session.error" || /error|fail|failed|exception/u.test(rawStatus)) {
    return "error";
  }
  if (type === "session.idle" || /complete|completed|done|success|idle/u.test(rawStatus)) {
    return "complete";
  }
  if (type === "permission.asked" || /permission|waiting|ask/u.test(rawStatus)) {
    return "waiting_for_user";
  }
  if (type === "tool.execute.before" || /tool|execute|executing|running/u.test(rawStatus)) {
    return "executing";
  }
  if (
    type === "message.updated" ||
    type === "session.status" ||
    type === "session.updated" ||
    /think|thinking|busy|process|processing/u.test(rawStatus)
  ) {
    return "thinking";
  }
  return "idle";
};

const summaryFromEvent = (event, status) => {
  const type = eventType(event);
  const candidate = safeText(
    firstString(
      findStringByKey(event, ["title", "summary", "message", "text", "content"]),
      type,
    ),
  );
  if (candidate && candidate !== "unknown") return candidate;
  if (status === "complete") return "opencode session completed";
  if (status === "error") return "opencode session error";
  if (status === "waiting_for_user") return "opencode is waiting for input";
  if (status === "executing") return "opencode is using a tool";
  if (status === "thinking") return "opencode is working";
  return "opencode session online";
};

const opencodeMessageInfo = (event) =>
  event?.properties?.info ?? event?.info ?? event?.message ?? {};

const opencodeUsageFromInfo = (info) => {
  const tokens = info?.tokens;
  if (!tokens || typeof tokens !== "object") return undefined;
  const number = (value) =>
    Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  const freshInputTokens = number(tokens.input);
  const cacheReadTokens = number(tokens.cache?.read);
  const cacheWriteTokens = number(tokens.cache?.write);
  const inputTokens = freshInputTokens + cacheReadTokens + cacheWriteTokens;
  const outputTokens = number(tokens.output);
  const reasoningOutputTokens = number(tokens.reasoning);
  const totalTokens = inputTokens + outputTokens + reasoningOutputTokens;
  if (totalTokens <= 0) return undefined;
  return {
    inputTokens,
    cachedInputTokens: cacheReadTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    source: "opencode-message-updated",
    scope: "turn",
  };
};

const newOpencodeTurn = (turnId) => ({
  turnId,
  turnStartedAt: new Date().toISOString(),
  terminal: false,
  assistantUsageByMessage: new Map(),
});

const aggregateOpencodeUsage = (state) => {
  const usages = [...state.assistantUsageByMessage.values()];
  if (usages.length === 0) return undefined;
  return {
    inputTokens: usages.reduce((sum, usage) => sum + usage.inputTokens, 0),
    cachedInputTokens: usages.reduce(
      (sum, usage) => sum + usage.cachedInputTokens,
      0,
    ),
    outputTokens: usages.reduce((sum, usage) => sum + usage.outputTokens, 0),
    reasoningOutputTokens: usages.reduce(
      (sum, usage) => sum + usage.reasoningOutputTokens,
      0,
    ),
    totalTokens: usages.reduce((sum, usage) => sum + usage.totalTokens, 0),
    source: "opencode-message-updated",
    scope: "turn",
  };
};

const updateOpencodeTurn = (states, sessionId, event, status) => {
  const type = eventType(event).toLowerCase();
  const info = opencodeMessageInfo(event);
  const role = firstString(info?.role)?.toLowerCase();
  const messageId = firstString(info?.id, info?.messageID, info?.messageId);
  let state = states.get(sessionId);
  const startsTurn =
    (type === "message.updated" && role === "user") ||
    (type === "session.status" && status === "thinking" && state?.terminal);
  if (!state || startsTurn) {
    state = newOpencodeTurn(messageId ?? `${sessionId}:${Date.now()}`);
    states.set(sessionId, state);
  }
  if (type === "message.updated" && role === "assistant" && !state.terminal) {
    const usage = opencodeUsageFromInfo(info);
    if (usage) {
      state.assistantUsageByMessage.set(
        messageId ?? `assistant-${state.assistantUsageByMessage.size}`,
        usage,
      );
    }
  }
  if (status !== "complete" && status !== "error") {
    return { state, usage: aggregateOpencodeUsage(state) };
  }
  if (state.terminal) return { state, suppress: true };
  state.terminal = true;
  state.terminalTimestamp = new Date().toISOString();
  state.rewardId = `opencode:${sessionId}:${state.turnId}`;
  return {
    state,
    usage: aggregateOpencodeUsage(state),
    rewardId: state.rewardId,
    timestamp: state.terminalTimestamp,
  };
};

const bubbleCandidatesFromEvent = (event) => {
  const text = safeText(
    firstString(
      findStringByKey(event, ["title", "summary", "message"]),
      undefined,
    ),
    28,
  );
  return text.length >= 2 && text.length <= 28 ? [text] : undefined;
};

const digestEntryFromEvent = (event) => {
  const type = eventType(event);
  const text = safeText(
    firstString(
      findStringByKey(event, ["summary", "message", "text", "content", "title"]),
      type,
    ),
    280,
  );
  return text ? `${type}: ${text}` : "";
};

const digestEntryFromChatMessage = (input, output) => {
  const session = safeText(input?.sessionID, 80);
  const agent = safeText(input?.agent, 40);
  const model = safeText(
    [input?.model?.providerID, input?.model?.modelID].filter(Boolean).join("/"),
    80,
  );
  const text = safeText(
    [messageText(output?.message), messageText(output?.parts)]
      .filter(Boolean)
      .join(" "),
    420,
  );
  return text
    ? `user${agent ? `/${agent}` : ""}${model ? ` ${model}` : ""}${
        session ? ` ${session}` : ""
      }: ${text}`
    : "";
};

const digestEntryFromTextComplete = (input, output) => {
  const session = safeText(input?.sessionID, 80);
  const text = safeText(output?.text, 520);
  return text ? `assistant${session ? ` ${session}` : ""}: ${text}` : "";
};

const addDigestEntry = (digests, sessionId, entry) => {
  const safeEntry = safeText(entry, 700);
  if (!safeEntry) return;
  const current = digests.get(sessionId) ?? [];
  current.push(safeEntry);
  while (current.length > MAX_DIGEST_ENTRIES) current.shift();
  digests.set(sessionId, current);
};


const heuristicLearning = (payload, digest) => {
  const text = `${payload.summary ?? ""} ${digest}`.toLowerCase();
  const traitChanges = {};
  if (/debug|bug|error|fail|fix|repair/u.test(text)) traitChanges.resilience = 1;
  if (/ui|design|visual|style|bubble|creative/u.test(text)) {
    traitChanges.creativity = 1;
  }
  if (/test|build|verify|check|review/u.test(text)) traitChanges.focus = 1;
  if (/done|complete|success|finish/u.test(text)) traitChanges.efficiency = 1;
  if (/why|explore|idea|maybe|learn/u.test(text)) traitChanges.curiosity = 1;
  return {
    id: `opencode-learning:${payload.rewardId ?? payload.sessionId}`,
    source: "heuristic",
    summary: safeText(payload.summary || "Aivatar noticed an opencode turn.", 160),
    idleBubbleCandidates:
      payload.idleBubbleCandidates?.length > 0
        ? payload.idleBubbleCandidates
        : ["I learned a little", "Session thoughts saved"],
    traitChanges,
    xp: 2,
    confidence: 0.35,
    privacyRisk: "low",
  };
};

const postHeuristicLearning = async (payload, digest, config) => {
  if (!config.learningEnabled) return;
  await postJson(config.status, {
    agent: payload.agent,
    sessionId: payload.sessionId,
    status: payload.status === "error" ? "error" : "complete",
    phase: "session-learning",
    task: payload.summary,
    summary: payload.summary,
    progress: payload.status === "complete" ? 100 : 50,
    message: payload.summary,
    severity: payload.status === "error" ? "error" : "info",
    timestamp: new Date().toISOString(),
    learning: {
      ...heuristicLearning(payload, digest),
      diagnostic: { provider: config.learningProvider, status: "fallback", reason: "unavailable", timestamp: new Date().toISOString() },
    },
  });
};

const spawnLearningWorker = async (payload, digest, config) => {
  if (!config.learningEnabled || !config.learningScript || !config.nodeCommand) return false;
  try {
    // The installed plugin stays a standalone file. The supervised job lives
    // beside the bundled worker, so moving/replacing Aivatar is repairable.
    const job = await import(pathToFileURL(join(dirname(config.learningScript), "aivatar-learning-job.mjs")).href);
    const options = {
      learningScript: config.learningScript,
      nodeCommand: config.nodeCommand,
      provider: config.learningProvider,
      agent: payload.agent,
      sessionId: payload.sessionId,
      status: payload.status === "error" ? "error" : "complete",
      summary: payload.summary ?? "opencode turn complete",
      digest,
      learningId: `opencode-learning:${payload.rewardId ?? payload.sessionId}`,
    };
    // Do not hold up OpenCode's hook/event loop while a model is responding.
    // runLearningJob turns spawn/exit/timeout failures into visible diagnostics.
    void job.runLearningJob(options)
      .then((learning) => postJson(config.status, job.learningStatus(options, learning)),
        () => postHeuristicLearning(payload, digest, config))
      .catch(() => {}); // A stopped bridge must not break the user's OpenCode turn.
    return true;
  } catch {
    return false;
  }
};

const payloadForEvent = (event, context, turnUpdate = {}) => {
  const status = statusFromEvent(event);
  const summary = summaryFromEvent(event, status);
  return {
    agent: AGENT,
    sessionId: sessionIdForEvent(event, context),
    rewardId: turnUpdate.rewardId,
    status,
    phase: eventType(event),
    task: summary,
    summary,
    progress: status === "complete" ? 100 : status === "idle" ? 0 : 50,
    message: summary,
    severity:
      status === "error" ? "error" : status === "waiting_for_user" ? "warning" : "info",
    timestamp: turnUpdate.timestamp ?? new Date().toISOString(),
    usage: turnUpdate.usage,
    idleBubbleCandidates: bubbleCandidatesFromEvent(event),
  };
};

const payloadForAssistantText = (sessionId, text) => {
  const summary = safeText(text, 120);
  if (!summary) return null;
  return {
    agent: AGENT,
    sessionId,
    status: "thinking",
    phase: "message-display",
    task: summary,
    summary,
    progress: 70,
    message: summary,
    severity: "info",
    timestamp: new Date().toISOString(),
  };
};

const sendPayload = async (payload, config) => {
  await postJson(config.status, payload);
  if (payload.status === "idle" && payload.phase === "session.deleted") {
    await postJson(config.disconnect, {
      agent: payload.agent,
      sessionId: payload.sessionId,
    });
    return;
  }

  await postJson(config.presence, {
    agent: payload.agent,
    sessionId: payload.sessionId,
    timestamp: payload.timestamp,
  });

  if (!config.setActive) return;
  if (payload.status === "idle") {
    await postJson(config.active, {
      clear: true,
      agent: payload.agent,
      sessionId: payload.sessionId,
    });
    return;
  }
  await postJson(config.active, {
    agent: payload.agent,
    sessionId: payload.sessionId,
  });
};

export const AivatarOpencodePlugin = async (context) => {
  const config = endpointConfig();
  const digests = new Map();
  const sessionTurns = new Map();
  await bestEffort(context?.client?.app?.log?.({
    body: {
      service: "aivatar-opencode",
      level: "info",
      message: "Aivatar opencode plugin initialized",
    },
  }));

  return {
    "chat.message": async (input, output) => {
      const sessionId = input?.sessionID ?? sessionIdForEvent({}, context);
      const turnId = firstString(
        input?.message?.id,
        input?.messageID,
        input?.messageId,
        `${sessionId}:${Date.now()}`,
      );
      if (!input?.aivatarAppend) sessionTurns.set(sessionId, newOpencodeTurn(turnId));
      addDigestEntry(digests, sessionId, digestEntryFromChatMessage(input, output));
    },
    "experimental.text.complete": async (input, output) => {
      const sessionId = input?.sessionID ?? sessionIdForEvent({}, context);
      addDigestEntry(digests, sessionId, digestEntryFromTextComplete(input, output));
      const payload = payloadForAssistantText(sessionId, output?.text);
      if (!payload) return;
      try {
        await sendPayload(payload, config);
      } catch (error) {
        await context?.client?.app?.log?.({
          body: {
            service: "aivatar-opencode",
            level: "warn",
            message: error instanceof Error ? error.message : String(error),
            extra: {
              event: payload.phase,
              sessionId: payload.sessionId,
            },
          },
        });
      }
    },
    event: async ({ event }) => {
      const sessionId = sessionIdForEvent(event, context);
      const status = statusFromEvent(event);
      const turnUpdate = updateOpencodeTurn(
        sessionTurns,
        sessionId,
        event,
        status,
      );
      if (turnUpdate.suppress) return;
      const payload = payloadForEvent(event, context, turnUpdate);
      addDigestEntry(digests, payload.sessionId, digestEntryFromEvent(event));
      try {
        await sendPayload(payload, config);
        if (payload.status === "complete" || payload.status === "error") {
          const digest = (digests.get(payload.sessionId) ?? []).join("\n");
          const workerStarted = await spawnLearningWorker(payload, digest, config);
          if (!workerStarted) {
            await postHeuristicLearning(payload, digest, config);
          }
        }
        if (payload.status === "complete" || payload.status === "error") {
          digests.delete(payload.sessionId);
        }
      } catch (error) {
        await context?.client?.app?.log?.({
          body: {
            service: "aivatar-opencode",
            level: "warn",
            message: error instanceof Error ? error.message : String(error),
            extra: {
              event: payload.phase,
              sessionId: payload.sessionId,
            },
          },
        });
      }
    },
  };
};

// V2 public events use `data`; only consume observed lifecycle/user/text
// events, never reasoning, tool input/output, or a transcript query. Keep the
// V1 function export unchanged: pre-1.18.29 loaders do not accept objects.
const AivatarOpencodeV2Plugin = {
  id: "aivatar",
  async setup(context) {
    const hooks = await AivatarOpencodePlugin({ directory: context?.location?.directory });
    const controller = new AbortController();
    const pendingPrompts = new Map();
    const turns = new Map();
    const seen = new Set();
    const boundedSet = (map, key, value, limit = 256) => {
      map.set(key, value);
      while (map.size > limit) map.delete(map.keys().next().value);
    };
    await context.session.hook("prompt", (event) => {
      if (!event?.sessionID || !event?.messageID) return;
      boundedSet(pendingPrompts, `${event.sessionID}:${event.messageID}`, safeText(event.prompt?.text, 420));
    });
    const forward = (sessionID, type, properties = {}) => hooks.event({ event: { type, sessionID, ...properties } });
    const begin = async (sessionID, id, text) => {
      const current = turns.get(sessionID);
      if (current && !current.terminal) {
        if (text !== undefined) {
          await hooks["chat.message"]({ sessionID, messageID: id, aivatarAppend: current.hasPrompt }, { message: text });
          current.hasPrompt = true;
        }
        return;
      }
      boundedSet(turns, sessionID, { terminal: false, hasPrompt: text !== undefined });
      await hooks["chat.message"]({ sessionID, messageID: id }, { message: text ?? "" });
    };
    const consume = async (event) => {
      const data = event?.data;
      const sessionID = data?.sessionID;
      if (typeof sessionID !== "string" || !sessionID) return;
      // A subscription sees the entire server. Every location gets a plugin
      // instance, so let only the owning location forward that session.
      if (event.location?.directory && event.location.directory !== context.location?.directory) return;
      if (event.location?.workspaceID && event.location.workspaceID !== context.location?.workspaceID) return;
      if (!event.location && !turns.has(sessionID) && ![...pendingPrompts.keys()].some((key) => key.startsWith(`${sessionID}:`))) return;
      if (event.id) {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        while (seen.size > 2048) seen.delete(seen.values().next().value);
      }
      const type = event.type;
      if (type === "session.inbox.enqueued" && data.item?.type === "user") {
        boundedSet(pendingPrompts, `${sessionID}:${data.inboxID}`, safeText(data.item.payload?.text, 420));
        return;
      }
      if (type === "session.inbox.cancelled") {
        pendingPrompts.delete(`${sessionID}:${data.inboxID}`);
        return;
      }
      if (type === "session.inbox.delivered") {
        const key = `${sessionID}:${data.inboxID}`;
        const text = pendingPrompts.get(key);
        if (text !== undefined) await begin(sessionID, data.inboxID, text);
        pendingPrompts.delete(key);
        return;
      }
      if (type === "session.execution.started") {
        await begin(sessionID, event.id ?? `${sessionID}:${event.created}`);
        await forward(sessionID, "session.status", { status: "busy", title: "OpenCode is working" });
        return;
      }
      if (type === "session.deleted") {
        await forward(sessionID, "session.deleted");
        turns.delete(sessionID);
        for (const key of pendingPrompts.keys()) if (key.startsWith(`${sessionID}:`)) pendingPrompts.delete(key);
        return;
      }
      if (!turns.has(sessionID) || turns.get(sessionID).terminal) return;
      if (type === "session.text.ended") {
        await hooks["experimental.text.complete"]({ sessionID }, { text: safeText(data.text, 520) });
      } else if (type === "session.step.ended" || type === "session.step.failed") {
        // Stable assistant IDs replace repeats instead of double-counting usage.
        await forward(sessionID, "message.updated", { properties: { info: { id: data.assistantMessageID, sessionID, role: "assistant", tokens: data.tokens } } });
      } else if (type === "session.tool.called") {
        await forward(sessionID, "tool.execute.before", { title: "OpenCode is using a tool" });
      } else if (type === "permission.asked") {
        await forward(sessionID, "permission.asked", { title: "OpenCode is waiting for permission" });
      } else if (type === "permission.replied" || (type === "session.status" && data.status?.type !== "idle")) {
        await forward(sessionID, "session.status", { status: "busy", title: "OpenCode is working" });
      } else if (["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"].includes(type)) {
        turns.get(sessionID).terminal = true;
        const success = type === "session.execution.succeeded";
        await forward(sessionID, success ? "session.status" : "session.error", {
          status: success ? "idle" : "error",
          title: success ? "OpenCode turn complete" : type.endsWith("interrupted") ? "OpenCode turn interrupted" : "OpenCode turn failed",
        });
      }
      // session.idle/status.idle carry no outcome in V2. Wait for execution.*
      // so a failure or cancellation can never become a successful reward.
    };
    void (async () => {
      try {
        for await (const event of context.event.subscribe({ signal: controller.signal })) {
          if (controller.signal.aborted) break;
          await consume(event);
        }
      } catch {
        // Stream shutdown/reload is normal; no private event/error is logged.
      }
    })();
    return () => { controller.abort(); pendingPrompts.clear(); turns.clear(); seen.clear(); };
  },
};

export const AivatarPlugin = AivatarOpencodePlugin;
export default AivatarOpencodePlugin;

const userPluginPath = () =>
  join(homedir(), ".config", "opencode", "plugins", "aivatar-opencode-plugin.js");

const escapeForJsString = (value) => JSON.stringify(value).slice(1, -1);

const installDefaults = () => ({
  learningScript:
    process.env.AIVATAR_LEARNING_SCRIPT ??
    join(dirname(scriptPath), "aivatar-learning-worker.mjs"),
  nodeCommand: process.env.AIVATAR_NODE_COMMAND ?? process.execPath,
});

const opencodeApiMajor = (output) => {
  const match = String(output ?? "").trim().match(/^(?:opencode(?:2)?(?:[ \t]+version)?[ \t]+)?v?(\d+)\.\d+\.\d+(?:[-+][\w.-]+)?(?:[ \t]*\r?\n|$)/i);
  const major = match ? Number(match[1]) : 0;
  return major === 1 || major === 2 ? major : null;
};

const detectOpencodeMajor = () => {
  const explicit = process.env.AIVATAR_OPENCODE_COMMAND ?? process.env.OPENCODE_COMMAND;
  const commands = explicit !== undefined ? [explicit] : ["opencode", "opencode2"];
  for (const command of commands) {
    if (!command) continue;
    const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const result = spawnSync(shim ? "cmd.exe" : command, shim ? ["/d", "/c", command, "--version"] : ["--version"], { encoding: "utf8", timeout: 3000, maxBuffer: 8192, windowsHide: true });
    if (result.status !== 0 || result.error) continue;
    const major = opencodeApiMajor(result.stdout);
    if (major) return major;
  }
  return null;
};

const buildInstalledPluginSource = async (major) => {
  const { learningScript, nodeCommand } = installDefaults();
  const source = await readFile(scriptPath, "utf8");
  return {
    learningScript,
    nodeCommand,
    source: source
      .replace("export default AivatarOpencodePlugin;", major === 2
        ? "// AIVATAR_OPENCODE_API: 2\nexport default AivatarOpencodeV2Plugin;"
        : "// AIVATAR_OPENCODE_API: 1\nexport default AivatarOpencodePlugin;")
      .replace(
        '"__AIVATAR_LEARNING_SCRIPT__"',
        `"${escapeForJsString(learningScript)}"`,
      )
      .replace(
        '"__AIVATAR_NODE_COMMAND__"',
        `"${escapeForJsString(nodeCommand)}"`,
      ),
  };
};

const runCli = async () => {
  const args = process.argv.slice(2);
  const target = userPluginPath();
  const wantsInstall = args.includes("install");
  const apply = args.includes("--apply");

  if (!wantsInstall) {
    console.log(usage);
    console.log(`Target plugin path: ${target}`);
    return;
  }

  if (!apply) {
    const { learningScript, nodeCommand } = installDefaults();
    console.log(`Dry run: would install ${scriptPath} to ${target}`);
    console.log(`Embedded learning script: ${learningScript}`);
    console.log(`Embedded node command: ${nodeCommand}`);
    console.log("Re-run with install --apply to install.");
    return;
  }

  const major = detectOpencodeMajor();
  if (!major) throw new Error("Could not determine the OpenCode API version. Install/update OpenCode or set AIVATAR_OPENCODE_COMMAND, then retry Enable/Repair.");
  const installed = await buildInstalledPluginSource(major);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, installed.source, "utf8");
  console.log(`Installed ${scriptName} to ${target}`);
  console.log(`Embedded learning script: ${installed.learningScript}`);
  console.log("Restart opencode Desktop/TUI so it can load the plugin.");
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runCli();
}
