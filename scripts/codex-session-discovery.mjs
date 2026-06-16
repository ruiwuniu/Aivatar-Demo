import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const sessionsRoot = process.env.CODEX_SESSIONS_ROOT ?? join(codexHome, "sessions");
const pluginRoot =
  process.env.AIVATAR_SESSION_PLUGIN_ROOT ??
  join(repoRoot, "plugins", "aivatar-session-bridge");
const heartbeatScript = join(pluginRoot, "scripts", "aivatar-heartbeat.mjs");
const watcherScript = join(pluginRoot, "scripts", "aivatar-watch.mjs");
const presenceEndpoint =
  process.env.AIVATAR_PRESENCE_ENDPOINT ?? "http://127.0.0.1:38988/agent-presence";
const statusEndpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const disconnectSessionEndpoint =
  process.env.AIVATAR_DISCONNECT_SESSION_ENDPOINT ??
  "http://127.0.0.1:38988/agent-sessions/disconnect";
const usageBaselinePath =
  process.env.AIVATAR_USAGE_BASELINE_PATH ??
  join(tmpdir(), "aivatar-usage-baselines.json");
const learningScript =
  process.env.AIVATAR_LEARNING_SCRIPT ??
  join(scriptDir, "aivatar-learning-worker.mjs");
const discoveryIntervalMs = Math.max(
  1000,
  Number(process.env.AIVATAR_DISCOVERY_INTERVAL_MS ?? 3000),
);
const sessionStaleMs = Number(
  process.env.AIVATAR_SESSION_STALE_MS ?? 5 * 60 * 60 * 1000,
);
const activeWindowMs = Math.max(
  discoveryIntervalMs,
  Number(process.env.AIVATAR_DISCOVERY_ACTIVE_MS ?? sessionStaleMs),
);
const pidDir = join(tmpdir(), "aivatar-session-discovery");
const pidFile = join(pidDir, "discovery.json");
const helperDir = join(pidDir, "helpers");
const claudeDesktopInventoryMaxSessions = Math.max(
  1,
  Number(process.env.AIVATAR_CLAUDE_DESKTOP_INVENTORY_MAX ?? 30),
);
const claudeDesktopInventoryRepostMs = Math.max(
  discoveryIntervalMs,
  Number(process.env.AIVATAR_CLAUDE_DESKTOP_INVENTORY_REPOST_MS ?? 60_000),
);
const claudeLevelDbMaxBytes = Math.max(
  1024 * 1024,
  Number(process.env.AIVATAR_CLAUDE_DESKTOP_LEVELDB_MAX_BYTES ?? 25 * 1024 * 1024),
);
const claudeDesktopActivityWindowMs = Math.max(
  discoveryIntervalMs,
  Number(
    process.env.AIVATAR_CLAUDE_DESKTOP_ACTIVITY_WINDOW_MS ??
      Math.min(activeWindowMs, 30 * 60 * 1000),
  ),
);
const claudeLogInitialTailBytes = Math.max(
  16 * 1024,
  Number(process.env.AIVATAR_CLAUDE_DESKTOP_LOG_TAIL_BYTES ?? 256 * 1024),
);
const claudeInventoryPostCache = new Map();
const claudeDesktopSessionIndex = new Map();
const claudeChatActivityCache = new Map();
const claudeLogOffsets = new Map();
const claudeLogEventCache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const safeName = (value) => String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");

const helperFileFor = (sessionId) =>
  join(helperDir, `codex-${safeName(sessionId)}.json`);

const pathExists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const firstString = (value, fields) => {
  if (!value || typeof value !== "object") return undefined;
  for (const field of fields) {
    const text = value[field];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return undefined;
};

const normalizeTitle = (title, fallback) => {
  if (typeof title !== "string") return fallback;
  const clean = title.trim().replace(/\s+/g, " ");
  return clean || fallback;
};

const compactText = (value, limit = 140) => {
  if (typeof value !== "string") return "";
  const clean = value
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return Array.from(clean).slice(0, limit).join("");
};

const flattenText = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(flattenText).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    return flattenText(
      value.text ??
        value.delta ??
        value.value ??
        value.content ??
        value.message?.content ??
        value.message,
    );
  }
  return "";
};

const timestampMsFromValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 10_000_000_000 ? Math.round(value) : Math.round(value * 1000);
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return timestampMsFromValue(numeric);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
};

const timestampIsoFromMs = (timestampMs) =>
  new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now()).toISOString();

const expiresIsoFromMs = (timestampMs) =>
  new Date(
    (Number.isFinite(timestampMs) ? timestampMs : Date.now()) + sessionStaleMs,
  ).toISOString();

const isInActiveWindowMs = (timestampMs) => {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false;
  const now = Date.now();
  if (timestampMs > now + 60_000) return true;
  return now - timestampMs <= activeWindowMs;
};

const isInActivityWindowMs = (timestampMs) => {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false;
  const now = Date.now();
  if (timestampMs > now + 60_000) return true;
  return now - timestampMs <= claudeDesktopActivityWindowMs;
};

const parseClaudeLogTimestampMs = (line) => {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(line);
  if (!match) return Date.now();
  const parsed = Date.parse(`${match[1]}T${match[2]}`);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const processIsRunning = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const stopProcess = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
};

const rolloutIsInActiveWindow = async (rolloutPath) => {
  if (typeof rolloutPath !== "string" || !rolloutPath) return false;
  try {
    const info = await stat(rolloutPath);
    return Date.now() - info.mtimeMs <= activeWindowMs;
  } catch {
    return false;
  }
};

const cleanupInactiveHelpers = async () => {
  let entries = [];
  try {
    entries = await readdir(helperDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let stoppedHelpers = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const helperFile = join(helperDir, entry.name);
    let record = null;
    try {
      record = JSON.parse(await readFile(helperFile, "utf8"));
    } catch {
      continue;
    }

    if (await rolloutIsInActiveWindow(record?.rolloutPath)) continue;

    let stoppedProcesses = 0;
    for (const pid of [record?.heartbeatPid, record?.watcherPid]) {
      if (stopProcess(pid)) stoppedProcesses += 1;
    }

    if (stoppedProcesses > 0) stoppedHelpers += 1;
    if (typeof record?.agent === "string" && typeof record?.sessionId === "string") {
      try {
        await postDisconnectSession(record);
      } catch {
        // Bridge cleanup is best-effort; helper processes were already stopped.
      }
    }
    try {
      await writeFile(
        helperFile,
        JSON.stringify(
          {
            ...record,
            heartbeatPid: null,
            watcherPid: null,
            stoppedAt: new Date().toISOString(),
            staleReason: "rollout-outside-active-window",
          },
          null,
          2,
        ),
      );
    } catch {
      // Helper cleanup is best-effort.
    }
  }

  return stoppedHelpers;
};

const ensureSingleInstance = async () => {
  await mkdir(pidDir, { recursive: true });
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    if (processIsRunning(record?.pid)) {
      process.exit(0);
    }
  } catch {
    // No live discovery process is recorded.
  }

  await writeFile(
    pidFile,
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        sessionsRoot,
      },
      null,
      2,
    ),
  );
};

const walkJsonl = async function* (directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonl(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield entryPath;
    }
  }
};

const walkFiles = async function* (directory, matches) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath, matches);
    } else if (entry.isFile() && matches(entryPath, entry.name)) {
      yield entryPath;
    }
  }
};

const claudeDesktopRoots = async () => {
  const roots = [];
  const addRoot = (value) => {
    if (typeof value !== "string" || !value.trim()) return;
    for (const rawPath of value.split(delimiter)) {
      const clean = rawPath.trim();
      if (clean && !roots.includes(clean)) roots.push(clean);
    }
  };

  addRoot(process.env.AIVATAR_CLAUDE_DESKTOP_ROOT);
  if (process.env.LOCALAPPDATA) {
    addRoot(
      join(
        process.env.LOCALAPPDATA,
        "Packages",
        "Claude_pzs8sxrjxfjjc",
        "LocalCache",
        "Roaming",
        "Claude",
      ),
    );
  }
  if (process.env.APPDATA) addRoot(join(process.env.APPDATA, "Claude"));

  const existing = [];
  for (const root of roots) {
    if ((await pathExists(root)) && !existing.includes(root)) existing.push(root);
  }
  return existing;
};

const readClaudeDesktopJsonSession = async (filePath, surface) => {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const desktopSessionId = firstString(parsed, ["sessionId", "id"]);
  const sessionId = firstString(parsed, ["cliSessionId"]) ?? desktopSessionId;
  if (!sessionId) return null;

  const timestampMs =
    timestampMsFromValue(parsed.lastActivityAt) ??
    timestampMsFromValue(parsed.updatedAt) ??
    timestampMsFromValue(parsed.createdAt);
  if (!isInActiveWindowMs(timestampMs)) return null;

  return {
    surface,
    sessionId,
    desktopSessionId,
    title: normalizeTitle(
      firstString(parsed, ["title", "name", "summary"]),
      surface === "cowork" ? "Cowork session" : "Code session",
    ),
    cwd: firstString(parsed, ["cwd", "originCwd"]),
    initialMessage: compactText(firstString(parsed, ["initialMessage"]), 140),
    timestampMs,
  };
};

const discoverClaudeDesktopJsonSessions = async (root, relativeDir, surface) => {
  const sessions = [];
  for await (const filePath of walkFiles(
    join(root, relativeDir),
    (_filePath, name) => /^local_.*\.json$/i.test(name),
  )) {
    const session = await readClaudeDesktopJsonSession(filePath, surface);
    if (session) sessions.push(session);
  }
  return sessions;
};

const extractClaudeChatObjectsAt = (text, marker) => {
  const conversations = [];
  let index = 0;
  while ((index = text.indexOf(marker, index)) >= 0) {
    let start = index;
    while (start > 0 && text[start] !== "{") start -= 1;
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;

    for (let cursor = start; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      if (escape) {
        escape = false;
        continue;
      }
      if (character === "\\") {
        escape = true;
        continue;
      }
      if (character === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (character === "{") depth += 1;
      if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          end = cursor + 1;
          break;
        }
      }
    }

    if (end < 0) {
      index += marker.length;
      continue;
    }

    try {
      const parsed = JSON.parse(text.slice(start, end));
      const conversation = parsed?.state?.data ?? parsed?.data ?? parsed;
      if (typeof conversation?.uuid !== "string" || typeof conversation?.name !== "string") {
        index = end;
        continue;
      }
      if (conversation.platform && conversation.platform !== "CLAUDE_AI") {
        index = end;
        continue;
      }
      conversations.push(conversation);
    } catch {
      // LevelDB log chunks can contain partial objects.
    }
    index = end;
  }
  return conversations;
};

const extractClaudeChatObjects = (text) => [
  ...extractClaudeChatObjectsAt(text, '{"uuid":"'),
  ...extractClaudeChatObjectsAt(text, '{"state":{"data":{"uuid":"'),
  ...extractClaudeChatObjectsAt(text, '"data":{"uuid":"'),
];

const claudeChatMessageDetails = (conversation) => {
  const messages =
    conversation.chat_messages ??
    conversation.chatMessages ??
    conversation.messages ??
    [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      messageId:
        firstString(conversation, ["current_leaf_message_uuid", "currentLeafMessageUuid"]) ??
        undefined,
      role: undefined,
      text: "",
      messageCount: 0,
    };
  }

  const leafId = firstString(conversation, [
    "current_leaf_message_uuid",
    "currentLeafMessageUuid",
  ]);
  const message =
    messages.find((entry) => firstString(entry, ["uuid", "id"]) === leafId) ??
    messages[messages.length - 1];
  const role =
    firstString(message, ["sender", "type", "role"]) ??
    firstString(message?.message, ["role"]);
  return {
    messageId: firstString(message, ["uuid", "id"]) ?? leafId,
    role,
    text: compactText(flattenText(message), 180),
    messageCount: messages.length,
  };
};

const discoverClaudeDesktopChatSessions = async (root) => {
  const sessions = new Map();
  for await (const filePath of walkFiles(
    join(root, "Local Storage", "leveldb"),
    (_filePath, name) => /\.(log|ldb)$/i.test(name),
  )) {
    let info;
    try {
      info = await stat(filePath);
    } catch {
      continue;
    }
    if (info.size > claudeLevelDbMaxBytes) continue;

    let buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      continue;
    }

    for (const encoding of ["utf16le", "utf8"]) {
      for (const conversation of extractClaudeChatObjects(
        buffer.toString(encoding),
      )) {
        const timestampMs =
          timestampMsFromValue(conversation.updated_at) ??
          timestampMsFromValue(conversation.created_at);
        if (!isInActiveWindowMs(timestampMs)) continue;
        const existing = sessions.get(conversation.uuid);
        const message = claudeChatMessageDetails(conversation);
        if (
          existing &&
          existing.timestampMs >= timestampMs &&
          (existing.messageCount ?? 0) >= message.messageCount
        ) {
          continue;
        }
        sessions.set(conversation.uuid, {
          surface: "chat",
          sessionId: conversation.uuid,
          desktopSessionId: conversation.uuid,
          title: normalizeTitle(conversation.name, "Chat session"),
          lastMessageId: message.messageId,
          lastMessageRole: message.role,
          lastMessageText: message.text,
          messageCount: message.messageCount,
          timestampMs,
        });
      }
    }
  }
  return [...sessions.values()];
};

const discoverClaudeDesktopInventory = async () => {
  const sessions = [];
  for (const root of await claudeDesktopRoots()) {
    sessions.push(
      ...(await discoverClaudeDesktopJsonSessions(
        root,
        "claude-code-sessions",
        "code",
      )),
    );
    sessions.push(
      ...(await discoverClaudeDesktopJsonSessions(
        root,
        "local-agent-mode-sessions",
        "cowork",
      )),
    );
    sessions.push(...(await discoverClaudeDesktopChatSessions(root)));
  }

  const deduped = new Map();
  for (const session of sessions) {
    const key = `${session.surface}:${session.sessionId}`;
    const existing = deduped.get(key);
    if (!existing || existing.timestampMs < session.timestampMs) {
      deduped.set(key, session);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => right.timestampMs - left.timestampMs)
    .slice(0, claudeDesktopInventoryMaxSessions);
};

const claudeDesktopInventoryStatus = (session) => {
  const label =
    session.surface === "chat"
      ? "Claude Chat"
      : session.surface === "cowork"
        ? "Claude Cowork"
        : "Claude Code";
  const timestamp = timestampIsoFromMs(session.timestampMs);
  return {
    agent: "claude-code",
    sessionId: session.sessionId,
    status: "idle",
    phase: `desktop-${session.surface}-session`,
    task: `${label} session discovered`,
    summary: `${label}: ${session.title}`,
    detail: session.cwd,
    progress: 0,
    message: session.title,
    severity: "info",
    timestamp,
    presenceTimestamp: timestamp,
    expiresAt: expiresIsoFromMs(session.timestampMs),
    source: "claude-desktop-inventory",
    surface: session.surface,
    desktopSessionId: session.desktopSessionId,
  };
};

const rememberClaudeDesktopSession = (session) => {
  for (const key of [session.desktopSessionId, session.sessionId].filter(Boolean)) {
    claudeDesktopSessionIndex.set(key, session);
  }
};

const claudeDesktopSessionLabel = (session) =>
  session?.surface === "chat"
    ? "Claude Chat"
    : session?.surface === "cowork"
      ? "Claude Cowork"
      : "Claude Code";

const resolveClaudeDesktopSession = (desktopSessionId, cliSessionId) => {
  const known =
    claudeDesktopSessionIndex.get(desktopSessionId) ??
    claudeDesktopSessionIndex.get(cliSessionId);
  if (known) {
    const merged = {
      ...known,
      sessionId: cliSessionId ?? known.sessionId,
      desktopSessionId: desktopSessionId ?? known.desktopSessionId,
    };
    rememberClaudeDesktopSession(merged);
    return merged;
  }
  const fallback = {
    surface: "code",
    sessionId: cliSessionId ?? desktopSessionId,
    desktopSessionId,
    title: "Session",
    timestampMs: Date.now(),
  };
  rememberClaudeDesktopSession(fallback);
  return fallback;
};

const claudeDesktopActivityStatus = (session, status, phase, message, timestampMs) => {
  const label = claudeDesktopSessionLabel(session);
  const title = session?.title ? `: ${session.title}` : "";
  return {
    agent: "claude-code",
    sessionId: session.sessionId,
    status,
    phase,
    task: `${label} activity`,
    summary: `${label}${title}`,
    detail: session.cwd,
    progress: status === "complete" ? 100 : status === "error" ? 100 : 55,
    message,
    severity: status === "error" ? "error" : "info",
    timestamp: timestampIsoFromMs(timestampMs),
    presenceTimestamp: timestampIsoFromMs(timestampMs),
    expiresAt: expiresIsoFromMs(timestampMs),
    source: "claude-desktop-activity",
    surface: session.surface,
    desktopSessionId: session.desktopSessionId,
  };
};

const claudeDesktopChatActivityStatus = (session) => {
  const role = String(session.lastMessageRole ?? "").toLowerCase();
  const userLike = role.includes("human") || role.includes("user");
  const text = compactText(session.lastMessageText, 120);
  const message = text || session.title;
  return claudeDesktopActivityStatus(
    session,
    userLike ? "thinking" : "complete",
    userLike ? "desktop-chat-user-message" : "desktop-chat-complete",
    userLike ? `Claude Chat is thinking: ${message}` : message,
    session.timestampMs,
  );
};

const postClaudeDesktopChatActivity = async (sessions) => {
  let posted = 0;
  for (const session of sessions.filter((entry) => entry.surface === "chat")) {
    if (!isInActivityWindowMs(session.timestampMs)) continue;
    const signature = [
      session.timestampMs,
      session.lastMessageId ?? "",
      session.lastMessageRole ?? "",
      session.lastMessageText ?? "",
      session.messageCount ?? 0,
    ].join("|");
    const cached = claudeChatActivityCache.get(session.sessionId);
    if (cached === signature) continue;
    claudeChatActivityCache.set(session.sessionId, signature);
    await postJson(statusEndpoint, claudeDesktopChatActivityStatus(session));
    posted += 1;
  }
  return posted;
};

const claudeDesktopActivityEvent = (line) => {
  const timestampMs = parseClaudeLogTimestampMs(line);
  if (!isInActivityWindowMs(timestampMs)) return null;

  let match = /Mapping internal session (local_[a-zA-Z0-9-]+) to CLI session ([a-zA-Z0-9-]+)/.exec(line);
  if (match) {
    const session = resolveClaudeDesktopSession(match[1], match[2]);
    rememberClaudeDesktopSession(session);
    return null;
  }

  match = /\[Lifecycle\] Session (local_[a-zA-Z0-9-]+): .*?(?:→|->) running/.exec(line);
  if (match) {
    const session = resolveClaudeDesktopSession(match[1]);
    const label = claudeDesktopSessionLabel(session);
    return claudeDesktopActivityStatus(
      session,
      "executing",
      `desktop-${session.surface}-running`,
      `${label} is running${session.title ? `: ${session.title}` : ""}`,
      timestampMs,
    );
  }

  match = /\[Result\] Turn succeeded for session (local_[a-zA-Z0-9-]+)/.exec(line);
  if (match) {
    const session = resolveClaudeDesktopSession(match[1]);
    return claudeDesktopActivityStatus(
      session,
      "complete",
      `desktop-${session.surface}-complete`,
      `${claudeDesktopSessionLabel(session)} turn complete`,
      timestampMs,
    );
  }

  match = /\[Stop hook\] Query completed for session (local_[a-zA-Z0-9-]+)/.exec(line);
  if (match) {
    const session = resolveClaudeDesktopSession(match[1]);
    return claudeDesktopActivityStatus(
      session,
      "complete",
      `desktop-${session.surface}-complete`,
      `${claudeDesktopSessionLabel(session)} turn complete`,
      timestampMs,
    );
  }

  match = /(?:Turn failed|StopFailure|failed for session) (local_[a-zA-Z0-9-]+)/i.exec(line);
  if (match) {
    const session = resolveClaudeDesktopSession(match[1]);
    return claudeDesktopActivityStatus(
      session,
      "error",
      `desktop-${session.surface}-error`,
      `${claudeDesktopSessionLabel(session)} turn failed`,
      timestampMs,
    );
  }

  return null;
};

const tailClaudeDesktopActivityLogs = async () => {
  let posted = 0;
  for (const root of await claudeDesktopRoots()) {
    const logPath = join(root, "logs", "main.log");
    let info;
    try {
      info = await stat(logPath);
    } catch {
      continue;
    }

    let offset = claudeLogOffsets.get(logPath);
    if (!Number.isFinite(offset)) {
      offset = Math.max(0, info.size - claudeLogInitialTailBytes);
    }
    if (info.size < offset) offset = 0;
    if (info.size === offset) continue;

    let buffer;
    try {
      buffer = await readFile(logPath);
    } catch {
      continue;
    }
    claudeLogOffsets.set(logPath, info.size);

    for (const line of buffer.subarray(offset).toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const event = claudeDesktopActivityEvent(line);
      if (!event) continue;
      const eventKey = [
        event.sessionId,
        event.phase,
        event.status,
        event.message,
        event.timestamp,
      ].join("|");
      if (claudeLogEventCache.get(event.sessionId) === eventKey) continue;
      claudeLogEventCache.set(event.sessionId, eventKey);
      await postJson(statusEndpoint, event);
      posted += 1;
    }
  }
  return posted;
};

const postClaudeDesktopInventory = async () => {
  const sessions = await discoverClaudeDesktopInventory();
  const liveKeys = new Set();
  let posted = 0;
  for (const session of sessions) {
    rememberClaudeDesktopSession(session);
    const key = `${session.surface}:${session.sessionId}`;
    liveKeys.add(key);
    const signature = [
      session.timestampMs,
      session.title,
      session.cwd ?? "",
      session.desktopSessionId ?? "",
    ].join("|");
    const cached = claudeInventoryPostCache.get(key);
    if (
      cached?.signature === signature &&
      Date.now() - cached.postedAt < claudeDesktopInventoryRepostMs
    ) {
      continue;
    }
    await postJson(statusEndpoint, claudeDesktopInventoryStatus(session));
    claudeInventoryPostCache.set(key, {
      signature,
      postedAt: Date.now(),
    });
    posted += 1;
  }

  for (const key of claudeInventoryPostCache.keys()) {
    if (!liveKeys.has(key)) claudeInventoryPostCache.delete(key);
  }

  posted += await postClaudeDesktopChatActivity(sessions);
  return posted;
};

const readSessionMeta = async (filePath) => {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  for (const line of content.split(/\r?\n/, 20)) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record?.type !== "session_meta") continue;
    const payload = record.payload ?? {};
    if (typeof payload.id !== "string" || !payload.id.trim()) return null;
    return {
      sessionId: payload.id,
      cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
      originator:
        typeof payload.originator === "string" ? payload.originator : undefined,
      source: typeof payload.source === "string" ? payload.source : undefined,
      timestamp:
        typeof payload.timestamp === "string" ? payload.timestamp : record.timestamp,
      rolloutPath: filePath,
    };
  }

  return null;
};

const recentRollouts = async () => {
  const now = Date.now();
  const rollouts = [];
  for await (const filePath of walkJsonl(sessionsRoot)) {
    let info;
    try {
      info = await stat(filePath);
    } catch {
      continue;
    }
    if (now - info.mtimeMs > activeWindowMs) continue;
    rollouts.push({ filePath, mtimeMs: info.mtimeMs });
  }

  return rollouts.sort((left, right) => right.mtimeMs - left.mtimeMs);
};

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

const postPresence = async (session) => {
  return postJson(presenceEndpoint, {
    agent: "codex",
    sessionId: session.sessionId,
    timestamp: new Date().toISOString(),
  });
};

const postDetectedStatus = async (session) => {
  return postJson(statusEndpoint, {
    agent: "codex",
    sessionId: session.sessionId,
    status: "thinking",
    phase: "discovered",
    task: "Codex Desktop session detected",
    summary: session.cwd
      ? `Detected Codex session in ${session.cwd}`
      : "Detected Codex Desktop session",
    progress: 20,
    message: "Codex Desktop session detected",
    severity: "info",
    timestamp: new Date().toISOString(),
  });
};

const postDisconnectSession = async (session) => {
  return postJson(disconnectSessionEndpoint, {
    agent: session.agent,
    sessionId: session.sessionId,
  });
};

const spawnHelper = (script, session, extraEnv = {}) => {
  const child = spawn(
    process.execPath,
    [script, "--agent", "codex", "--session", session.sessionId],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        ...extraEnv,
        AIVATAR_AGENT: "codex",
        AIVATAR_SESSION_ID: session.sessionId,
        AIVATAR_PRESENCE_ENDPOINT: presenceEndpoint,
        AIVATAR_HTTP_ENDPOINT: statusEndpoint,
        AIVATAR_USAGE_BASELINE_PATH: usageBaselinePath,
        AIVATAR_LEARNING_ENABLED: process.env.AIVATAR_LEARNING_ENABLED ?? "1",
        AIVATAR_LEARNING_PROVIDER:
          process.env.AIVATAR_LEARNING_PROVIDER ?? "codex",
        AIVATAR_LEARNING_SCRIPT: learningScript,
      },
    },
  );
  child.unref();
  return child.pid;
};

const ensureHelpers = async (session) => {
  await mkdir(helperDir, { recursive: true });
  const helperFile = helperFileFor(session.sessionId);
  let record = null;
  try {
    record = JSON.parse(await readFile(helperFile, "utf8"));
  } catch {
    record = null;
  }

  const heartbeatAlive = processIsRunning(record?.heartbeatPid);
  const watcherAlive = processIsRunning(record?.watcherPid);

  if (heartbeatAlive && watcherAlive && record?.rolloutPath === session.rolloutPath) {
    return false;
  }

  const heartbeatPid =
    heartbeatAlive && record?.heartbeatPid
      ? record.heartbeatPid
      : spawnHelper(heartbeatScript, session, {});
  const watcherPid =
    watcherAlive && record?.watcherPid && record?.rolloutPath === session.rolloutPath
      ? record.watcherPid
      : spawnHelper(watcherScript, session, {
          CODEX_ROLLOUT_PATH: session.rolloutPath,
        });

  await writeFile(
    helperFile,
    JSON.stringify(
      {
        agent: "codex",
        sessionId: session.sessionId,
        cwd: session.cwd,
        originator: session.originator,
        source: session.source,
        rolloutPath: session.rolloutPath,
        heartbeatPid,
        watcherPid,
        heartbeatScript,
        watcherScript,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  return true;
};

const cleanup = async () => {
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    if (record?.pid === process.pid) {
      await rm(pidFile, { force: true });
    }
  } catch {
    // Nothing to clean up.
  }
};

let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});

await ensureSingleInstance();
await cleanupInactiveHelpers();

if (!(await pathExists(heartbeatScript)) || !(await pathExists(watcherScript))) {
  console.warn(
    `[codex-session-discovery] Aivatar plugin helpers not found under ${pluginRoot}`,
  );
}

console.log(
  `[codex-session-discovery] watching ${sessionsRoot} every ${discoveryIntervalMs}ms`,
);

try {
  while (!stopped) {
    try {
      const rollouts = await recentRollouts();
      await cleanupInactiveHelpers();
      for (const rollout of rollouts) {
        const session = await readSessionMeta(rollout.filePath);
        if (!session) continue;
        const presenceResult = await postPresence(session);
        if (presenceResult?.ignored) continue;
        const startedHelpers = await ensureHelpers(session);
        if (startedHelpers) {
          await postDetectedStatus(session);
        }
      }
      await postClaudeDesktopInventory();
      await tailClaudeDesktopActivityLogs();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[codex-session-discovery] ${message}`);
    }
    await sleep(discoveryIntervalMs);
  }
} finally {
  await cleanup();
}
