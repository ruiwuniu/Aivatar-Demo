import http from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer } from "ws";

const wsPort = Number(process.env.AIVATAR_WS_PORT ?? 38987);
const httpPort = Number(process.env.AIVATAR_HTTP_PORT ?? 38988);
const agentWsPath = "/agent-status";
const legacyWsPath = "/codex-status";
const agentStatusPath = "/agent-status";
const legacyStatusPath = "/codex-status";
const activeSessionPath = "/agent-active";
const staleSessionsPath = "/agent-sessions/stale";
const disconnectSessionPath = "/agent-sessions/disconnect";
const presencePath = "/agent-presence";
const avatarStatePath = "/avatar-state";
const healthPath = "/health";
const avatarStateFile =
  process.env.AIVATAR_AVATAR_STATE_PATH ??
  join(tmpdir(), "aivatar-avatar-state.json");
const sessionStaleMs = Number(
  process.env.AIVATAR_SESSION_STALE_MS ?? 5 * 60 * 60 * 1000,
);
const activityStaleMs = Number(
  process.env.AIVATAR_ACTIVITY_STALE_MS ?? 5 * 60 * 1000,
);
const disconnectedSessionTombstoneMs = Number(
  process.env.AIVATAR_DISCONNECTED_SESSION_TOMBSTONE_MS ??
    24 * 60 * 60 * 1000,
);
const disconnectedSessionTombstoneFile =
  process.env.AIVATAR_DISCONNECTED_SESSION_TOMBSTONE_PATH ??
  join(tmpdir(), "aivatar-disconnected-sessions.json");
const maxSessions = Number(process.env.AIVATAR_MAX_SESSIONS ?? 80);

const allowedStatuses = new Set([
  "idle",
  "thinking",
  "executing",
  "waiting_for_user",
  "error",
  "complete",
]);

const highPriorityStatuses = new Set([
  "thinking",
  "executing",
  "waiting_for_user",
  "error",
]);

const statusAliases = new Map([
  ["waiting", "waiting_for_user"],
  ["wait", "waiting_for_user"],
  ["waiting_for_input", "waiting_for_user"],
  ["input_required", "waiting_for_user"],
  ["needs_input", "waiting_for_user"],
  ["user_input", "waiting_for_user"],
]);

const bridgeIdleStatus = () => ({
  agent: "aivatar",
  sessionId: "bridge",
  status: "idle",
  phase: "bridge",
  task: "Waiting for agent status",
  summary: "Aivatar bridge is online",
  progress: 0,
  message: "Aivatar bridge is online",
  severity: "info",
  timestamp: new Date().toISOString(),
});

let currentStatus = bridgeIdleStatus();
let activeSessionKey = null;

const sessions = new Map();
const disconnectedSessionKeys = new Map();

const sessionKey = (status) =>
  `${status.agent ?? "codex"}:${status.sessionId ?? "default"}`;

const tombstoneSession = (key) => {
  if (
    !Number.isFinite(disconnectedSessionTombstoneMs) ||
    disconnectedSessionTombstoneMs <= 0
  ) {
    return;
  }

  disconnectedSessionKeys.set(key, Date.now() + disconnectedSessionTombstoneMs);
  void persistDisconnectedSessionTombstones().catch(() => {});
};

const pruneDisconnectedSessionTombstones = () => {
  let deleted = 0;
  const now = Date.now();
  for (const [key, expiresAt] of disconnectedSessionKeys) {
    if (now <= expiresAt) continue;
    disconnectedSessionKeys.delete(key);
    deleted += 1;
  }
  return deleted;
};

const persistDisconnectedSessionTombstones = async () => {
  pruneDisconnectedSessionTombstones();
  await mkdir(dirname(disconnectedSessionTombstoneFile), { recursive: true });
  await writeFile(
    disconnectedSessionTombstoneFile,
    JSON.stringify(
      [...disconnectedSessionKeys.entries()].map(([key, expiresAt]) => ({
        key,
        expiresAt,
      })),
      null,
      2,
    ),
    "utf8",
  );
};

const loadDisconnectedSessionTombstones = async () => {
  try {
    const parsed = JSON.parse(
      await readFile(disconnectedSessionTombstoneFile, "utf8"),
    );
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const entry of parsed) {
      if (typeof entry?.key !== "string") continue;
      const expiresAt = Number(entry.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
      disconnectedSessionKeys.set(entry.key, expiresAt);
    }
  } catch {
    // No persisted disconnect tombstones yet.
  }
};

const untombstoneSession = (key) => {
  if (!disconnectedSessionKeys.delete(key)) return;
  void persistDisconnectedSessionTombstones().catch(() => {});
};

const isSessionTombstoned = (key) => {
  const expiresAt = disconnectedSessionKeys.get(key);
  if (!expiresAt) return false;
  if (Date.now() <= expiresAt) return true;
  disconnectedSessionKeys.delete(key);
  void persistDisconnectedSessionTombstones().catch(() => {});
  return false;
};

const safeName = (value) => String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");

const pluginPidFileFor = ({ agent, sessionId }, kind) =>
  join(
    tmpdir(),
    "aivatar-session-bridge",
    `${safeName(agent)}-${safeName(sessionId)}.${kind}.json`,
  );

const cliPidFileFor = ({ agent, sessionId }) =>
  join(
    tmpdir(),
    "aivatar-cli-session",
    `${safeName(agent)}-${safeName(sessionId)}.json`,
  );

const discoveryHelperFileFor = ({ agent, sessionId }) =>
  agent === "codex"
    ? join(
        tmpdir(),
        "aivatar-session-discovery",
        "helpers",
        `codex-${safeName(sessionId)}.json`,
      )
    : null;

const stopPid = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
};

const stopPluginPidFile = async (pidFile) => {
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    const stopped = stopPid(record?.pid) ? 1 : 0;
    await rm(pidFile, { force: true });
    return stopped;
  } catch {
    return 0;
  }
};

const stopCliPidFile = async (pidFile) => {
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    let stopped = 0;
    for (const pid of [record?.heartbeatPid, record?.watcherPid, record?.watchdogPid]) {
      if (stopPid(pid)) stopped += 1;
    }
    await rm(pidFile, { force: true });
    return stopped;
  } catch {
    return 0;
  }
};

const stopDiscoveryHelperFile = async (pidFile) => {
  if (!pidFile) return 0;
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    let stopped = 0;
    for (const pid of [record?.heartbeatPid, record?.watcherPid]) {
      if (stopPid(pid)) stopped += 1;
    }
    await rm(pidFile, { force: true });
    return stopped;
  } catch {
    return 0;
  }
};

const stopRecordedSessionProcesses = async (session) => {
  let stoppedProcesses = 0;
  stoppedProcesses += await stopPluginPidFile(pluginPidFileFor(session, "heartbeat"));
  stoppedProcesses += await stopPluginPidFile(pluginPidFileFor(session, "watcher"));
  stoppedProcesses += await stopCliPidFile(cliPidFileFor(session));
  stoppedProcesses += await stopDiscoveryHelperFile(discoveryHelperFileFor(session));
  return stoppedProcesses;
};

const sessionExpiresAt = () =>
  new Date(Date.now() + sessionStaleMs).toISOString();

const withSessionExpiry = (status) => ({
  ...status,
  expiresAt: sessionExpiresAt(),
});

const isSessionExpired = (status) => {
  const expiresAt = Date.parse(
    status.expiresAt ?? status.presenceTimestamp ?? status.timestamp,
  );
  if (Number.isNaN(expiresAt)) return false;
  return Date.now() > expiresAt;
};

const parsedTime = (value) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortedSessions = () =>
  [...sessions.values()]
    .map((status) => ({
      ...status,
      connected: !isSessionExpired(status),
    }))
    .sort(
      (a, b) =>
        parsedTime(b.timestamp) - parsedTime(a.timestamp) ||
        parsedTime(b.presenceTimestamp ?? b.timestamp) -
          parsedTime(a.presenceTimestamp ?? a.timestamp),
    );

const isActivityStale = (status) => {
  if (isSessionExpired(status)) return true;
  const updatedAt = Date.parse(status.timestamp);
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt > activityStaleMs;
};

const isPresenceStale = (status) => {
  if (isSessionExpired(status)) return true;
  const updatedAt = Date.parse(status.presenceTimestamp ?? status.timestamp);
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt > sessionStaleMs;
};

const chooseCurrentStatus = () => {
  const candidates = sortedSessions();
  const activeSession = activeSessionKey ? sessions.get(activeSessionKey) : null;
  const activeCandidate =
    activeSession && !isActivityStale(activeSession) ? activeSession : null;
  const highPriorityCandidate = candidates.find(
    (status) =>
      highPriorityStatuses.has(status.status) && !isActivityStale(status),
  );

  if (activeCandidate && activeCandidate.status !== "idle") return activeCandidate;
  if (highPriorityCandidate) return highPriorityCandidate;

  return (
    candidates.find(
      (status) => status.status !== "idle" && !isActivityStale(status),
    ) ??
    bridgeIdleStatus()
  );
};

const currentSessionKey = () => {
  const status = chooseCurrentStatus();
  return status.agent === "aivatar" && status.sessionId === "bridge"
    ? null
    : sessionKey(status);
};

const connectedSessionKey = () =>
  activeSessionKey && sessions.has(activeSessionKey) ? activeSessionKey : null;

const pruneStaleSessions = () => {
  let deletedSessions = 0;

  for (const [key, status] of sessions) {
    if (!isSessionExpired(status)) continue;
    sessions.delete(key);
    if (key === activeSessionKey) activeSessionKey = null;
    deletedSessions += 1;
  }

  return deletedSessions;
};

const pruneSessionOverflow = () => {
  if (!Number.isFinite(maxSessions) || maxSessions <= 0) return 0;
  if (sessions.size <= maxSessions) return 0;

  let deletedSessions = 0;
  const removable = [...sessions.entries()]
    .filter(([key]) => key !== activeSessionKey)
    .sort(([, left], [, right]) => {
      const leftTime = Date.parse(left.presenceTimestamp ?? left.timestamp);
      const rightTime = Date.parse(right.presenceTimestamp ?? right.timestamp);
      return (
        (Number.isNaN(leftTime) ? 0 : leftTime) -
        (Number.isNaN(rightTime) ? 0 : rightTime)
      );
    });

  for (const [key] of removable) {
    if (sessions.size <= maxSessions) break;
    sessions.delete(key);
    deletedSessions += 1;
  }

  return deletedSessions;
};

const pruneSessions = () => pruneStaleSessions() + pruneSessionOverflow();

const normalizeUsage = (value) => {
  if (!value || typeof value !== "object") return undefined;

  const totalTokens = Number(value.totalTokens);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return undefined;

  const usage = { totalTokens };
  const optionalNumberFields = [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "contextTokens",
    "modelContextWindow",
  ];

  for (const field of optionalNumberFields) {
    const next = Number(value[field]);
    if (Number.isFinite(next) && next >= 0) usage[field] = next;
  }

  if (typeof value.source === "string") usage.source = value.source;
  if (typeof value.scope === "string") usage.scope = value.scope;

  return usage;
};

const normalizeIdleBubbleCandidates = (value) => {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set();
  const candidates = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const phrase = entry.trim().replace(/\s+/g, " ");
    const length = Array.from(phrase).length;
    if (length < 2 || length > 28 || seen.has(phrase)) continue;
    seen.add(phrase);
    candidates.push(phrase);
    if (candidates.length >= 12) break;
  }

  return candidates.length > 0 ? candidates : undefined;
};

const normalizeTraitChanges = (value) => {
  if (!value || typeof value !== "object") return undefined;
  const traitNames = [
    "focus",
    "resilience",
    "curiosity",
    "efficiency",
    "creativity",
    "warmth",
  ];
  const changes = {};

  for (const trait of traitNames) {
    const next = Number(value[trait]);
    if (!Number.isFinite(next) || next === 0) continue;
    changes[trait] = Math.max(-20, Math.min(20, Math.round(next)));
  }

  return Object.keys(changes).length > 0 ? changes : undefined;
};

const normalizeLearning = (value) => {
  if (!value || typeof value !== "object") return undefined;

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const summary = typeof value.summary === "string"
    ? value.summary.trim().replace(/\s+/g, " ")
    : "";
  if (!id || !summary) return undefined;

  const source = value.source === "heuristic" ? "heuristic" : "llm";
  const privacyRisk =
    value.privacyRisk === "medium" || value.privacyRisk === "high"
      ? value.privacyRisk
      : "low";
  const xp = Number(value.xp);
  const confidence = Number(value.confidence);

  return {
    id,
    source,
    summary: summary.length > 180 ? `${summary.slice(0, 177)}...` : summary,
    idleBubbleCandidates: normalizeIdleBubbleCandidates(
      value.idleBubbleCandidates,
    ),
    traitChanges: normalizeTraitChanges(value.traitChanges),
    xp: Number.isFinite(xp) && xp > 0 ? Math.min(12, Math.round(xp)) : undefined,
    confidence:
      Number.isFinite(confidence) && confidence >= 0
        ? Math.min(1, confidence)
        : undefined,
    privacyRisk,
  };
};

const normalizeAvatarState = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("Avatar state payload must be a JSON object");
  }

  const traitNames = [
    "focus",
    "resilience",
    "curiosity",
    "efficiency",
    "creativity",
    "warmth",
  ];
  const sourceTraits = value.growth?.traits ?? value.traits ?? {};
  const traits = {};
  for (const trait of traitNames) {
    const next = Number(sourceTraits[trait]);
    traits[trait] = Number.isFinite(next) && next >= 0 ? Math.round(next) : 0;
  }

  const level = Number(value.growth?.level ?? value.level);
  const idleBubbleLanguage =
    value.preferences?.idleBubbleLanguage === "zh" ||
    value.preferences?.idleBubbleLanguage === "en" ||
    value.preferences?.idleBubbleLanguage === "mixed"
      ? value.preferences.idleBubbleLanguage
      : "auto";

  return {
    avatarId:
      typeof value.avatarId === "string"
        ? value.avatarId.trim().slice(0, 80)
        : undefined,
    avatarName:
      typeof value.avatarName === "string"
        ? value.avatarName.trim().replace(/\s+/g, " ").slice(0, 40)
        : undefined,
    growth: {
      level: Number.isFinite(level) && level > 0 ? Math.round(level) : 1,
      traits,
    },
    preferences: {
      idleBubbleLanguage,
    },
    updatedAt: new Date().toISOString(),
  };
};

const persistAvatarState = async (state) => {
  await mkdir(dirname(avatarStateFile), { recursive: true });
  await writeFile(avatarStateFile, JSON.stringify(state, null, 2), "utf8");
};

const makeSnapshot = () => ({
  type: "aivatar.status.snapshot",
  currentStatus: chooseCurrentStatus(),
  sessions: sortedSessions(),
  activeSessionKey,
  connectedSessionKey: connectedSessionKey(),
  currentSessionKey: currentSessionKey(),
  timestamp: new Date().toISOString(),
});

const normalizeStatus = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("Status payload must be a JSON object");
  }

  const status = statusAliases.get(value.status) ?? value.status;

  if (!allowedStatuses.has(status)) {
    throw new Error(`Unsupported status: ${value.status}`);
  }

  return {
    agent: typeof value.agent === "string" ? value.agent : "codex",
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    status,
    phase: typeof value.phase === "string" ? value.phase : status,
    task: typeof value.task === "string" ? value.task : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    detail: typeof value.detail === "string" ? value.detail : undefined,
    progress: typeof value.progress === "number" ? value.progress : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
    severity:
      value.severity === "warning" || value.severity === "error"
        ? value.severity
        : "info",
    timestamp:
      typeof value.timestamp === "string"
        ? value.timestamp
        : new Date().toISOString(),
    presenceTimestamp:
      typeof value.presenceTimestamp === "string"
        ? value.presenceTimestamp
        : typeof value.timestamp === "string"
          ? value.timestamp
          : new Date().toISOString(),
    usage: normalizeUsage(value.usage),
    idleBubbleCandidates: normalizeIdleBubbleCandidates(value.idleBubbleCandidates),
    learning: normalizeLearning(value.learning),
  };
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(payload));
};

const readActiveSessionBody = async (request) => {
  const body = await readBody(request);
  if (!body.trim()) {
    throw new Error("Active session payload must be a JSON object");
  }

  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Active session payload must be a JSON object");
  }

  if (parsed.clear === true) {
    const agent = typeof parsed.agent === "string" ? parsed.agent.trim() : "";
    const sessionId =
      typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "";

    if (agent && sessionId) {
      const requestedKey = `${agent}:${sessionId}`;
      return activeSessionKey === requestedKey ? null : activeSessionKey;
    }

    return null;
  }

  const agent = typeof parsed.agent === "string" ? parsed.agent.trim() : "";
  const sessionId =
    typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "";

  if (!agent || !sessionId) {
    throw new Error("Active session payload requires agent and sessionId");
  }

  return `${agent}:${sessionId}`;
};

const readPresenceBody = async (request) => {
  const body = await readBody(request);
  if (!body.trim()) {
    throw new Error("Presence payload must be a JSON object");
  }

  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Presence payload must be a JSON object");
  }

  const agent = typeof parsed.agent === "string" ? parsed.agent.trim() : "";
  const sessionId =
    typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "";

  if (!agent || !sessionId) {
    throw new Error("Presence payload requires agent and sessionId");
  }

  return {
    agent,
    sessionId,
    timestamp:
      typeof parsed.timestamp === "string"
        ? parsed.timestamp
        : new Date().toISOString(),
  };
};

const readDisconnectSessionBody = async (request) => {
  const body = await readBody(request);
  if (!body.trim()) {
    throw new Error("Disconnect session payload must be a JSON object");
  }

  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Disconnect session payload must be a JSON object");
  }

  const agent = typeof parsed.agent === "string" ? parsed.agent.trim() : "";
  const sessionId =
    typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "";

  if (!agent || !sessionId) {
    throw new Error("Disconnect session payload requires agent and sessionId");
  }

  return { agent, sessionId };
};

const wsHttpServer = http.createServer();
const wsServer = new WebSocketServer({ noServer: true });

const broadcast = (payload) => {
  const encoded = JSON.stringify(payload);

  for (const client of wsServer.clients) {
    if (client.readyState === client.OPEN) {
      client.send(encoded);
    }
  }
};

await loadDisconnectedSessionTombstones();

wsServer.on("connection", (socket) => {
  socket.send(JSON.stringify(makeSnapshot()));
});

wsHttpServer.on("upgrade", (request, socket, head) => {
  const path = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;
  if (path !== agentWsPath && path !== legacyWsPath) {
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(request, socket, head, (websocket) => {
    wsServer.emit("connection", websocket, request);
  });
});

const httpServer = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.url === healthPath && request.method === "GET") {
    const snapshot = makeSnapshot();
    sendJson(response, 200, {
      ok: true,
      websocket: `ws://127.0.0.1:${wsPort}${agentWsPath}`,
      legacyWebsocket: `ws://127.0.0.1:${wsPort}${legacyWsPath}`,
      http: `http://127.0.0.1:${httpPort}${agentStatusPath}`,
      legacyHttp: `http://127.0.0.1:${httpPort}${legacyStatusPath}`,
      activeSessionHttp: `http://127.0.0.1:${httpPort}${activeSessionPath}`,
      staleSessionsHttp: `http://127.0.0.1:${httpPort}${staleSessionsPath}`,
      disconnectSessionHttp: `http://127.0.0.1:${httpPort}${disconnectSessionPath}`,
      presenceHttp: `http://127.0.0.1:${httpPort}${presencePath}`,
      avatarStateHttp: `http://127.0.0.1:${httpPort}${avatarStatePath}`,
      clients: wsServer.clients.size,
      agentStatus: snapshot.currentStatus,
      codexStatus: snapshot.currentStatus,
      currentStatus: snapshot.currentStatus,
      sessions: snapshot.sessions,
      activeSessionKey: snapshot.activeSessionKey,
      connectedSessionKey: snapshot.connectedSessionKey,
      currentSessionKey: snapshot.currentSessionKey,
      sessionStaleMs,
      activityStaleMs,
      disconnectedSessionTombstoneMs,
      disconnectedSessionTombstoneFile,
      disconnectedSessionTombstoneCount: disconnectedSessionKeys.size,
    });
    return;
  }

  if (request.url === avatarStatePath && request.method === "POST") {
    try {
      const body = await readBody(request);
      const avatarState = normalizeAvatarState(JSON.parse(body));
      await persistAvatarState(avatarState);
      sendJson(response, 202, {
        ok: true,
        avatarStateFile,
        updatedAt: avatarState.updatedAt,
      });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid avatar state payload",
      });
    }
    return;
  }

  if (
    (request.url === agentStatusPath || request.url === legacyStatusPath) &&
    request.method === "GET"
  ) {
    sendJson(response, 200, makeSnapshot());
    return;
  }

  if (request.url === activeSessionPath && request.method === "GET") {
    sendJson(response, 200, {
      activeSessionKey,
      connectedSessionKey: connectedSessionKey(),
      currentSessionKey: currentSessionKey(),
    });
    return;
  }

  if (request.url === activeSessionPath && request.method === "POST") {
    try {
      activeSessionKey = await readActiveSessionBody(request);
      if (activeSessionKey) untombstoneSession(activeSessionKey);
      const snapshot = makeSnapshot();
      broadcast(snapshot);
      sendJson(response, 202, snapshot);
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid active session payload",
      });
    }
    return;
  }

  if (request.url === staleSessionsPath && request.method === "DELETE") {
    const deletedSessions = pruneStaleSessions();
    const snapshot = makeSnapshot();
    broadcast(snapshot);
    sendJson(response, 202, {
      ...snapshot,
      deletedSessions,
    });
    return;
  }

  if (request.url === disconnectSessionPath && request.method === "POST") {
    try {
      const session = await readDisconnectSessionBody(request);
      const key = `${session.agent}:${session.sessionId}`;
      const deletedSessions = sessions.delete(key) ? 1 : 0;
      if (key === activeSessionKey) activeSessionKey = null;
      tombstoneSession(key);
      const stoppedProcesses = await stopRecordedSessionProcesses(session);
      const snapshot = makeSnapshot();
      broadcast(snapshot);
      sendJson(response, 202, {
        ...snapshot,
        deletedSessions,
        stoppedProcesses,
      });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid disconnect session payload",
      });
    }
    return;
  }

  if (request.url === presencePath && request.method === "POST") {
    try {
      const presence = await readPresenceBody(request);
      const key = `${presence.agent}:${presence.sessionId}`;
      if (isSessionTombstoned(key)) {
        sendJson(response, 202, {
          ...makeSnapshot(),
          ignored: true,
          disconnectedSessionKey: key,
        });
        return;
      }
      const existing = sessions.get(key);
      sessions.set(key, withSessionExpiry({
        ...(existing ?? {
          agent: presence.agent,
          sessionId: presence.sessionId,
          status: "idle",
          phase: "presence",
          task: "Session online",
          summary: "Session online",
          progress: 0,
          message: "Session online",
          severity: "info",
          timestamp: presence.timestamp,
        }),
        presenceTimestamp: presence.timestamp,
      }));
      pruneSessionOverflow();
      const snapshot = makeSnapshot();
      broadcast(snapshot);
      sendJson(response, 202, snapshot);
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid presence payload",
      });
    }
    return;
  }

  if (
    (request.url === agentStatusPath || request.url === legacyStatusPath) &&
    request.method === "POST"
  ) {
    try {
      const body = await readBody(request);
      const nextStatus = normalizeStatus(JSON.parse(body));
      const key = sessionKey(nextStatus);
      if (isSessionTombstoned(key)) {
        sendJson(response, 202, {
          ...makeSnapshot(),
          ignored: true,
          disconnectedSessionKey: key,
        });
        return;
      }
      const existing = sessions.get(key);
      currentStatus = {
        ...nextStatus,
        presenceTimestamp: nextStatus.presenceTimestamp ?? existing?.presenceTimestamp,
        usage: nextStatus.usage ?? existing?.usage,
        idleBubbleCandidates:
          nextStatus.idleBubbleCandidates ?? existing?.idleBubbleCandidates,
        learning: nextStatus.learning ?? existing?.learning,
      };
      currentStatus = withSessionExpiry(currentStatus);
      sessions.set(key, currentStatus);
      pruneSessionOverflow();
      const snapshot = makeSnapshot();
      broadcast(snapshot);
      sendJson(response, 202, snapshot);
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid status payload",
      });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

wsHttpServer.listen(wsPort, "127.0.0.1", () => {
  console.log(`Aivatar WebSocket: ws://127.0.0.1:${wsPort}${agentWsPath}`);
  console.log(`Aivatar legacy WebSocket: ws://127.0.0.1:${wsPort}${legacyWsPath}`);
});

httpServer.listen(httpPort, "127.0.0.1", () => {
  console.log(`Aivatar HTTP bridge: http://127.0.0.1:${httpPort}${agentStatusPath}`);
  console.log(`Aivatar legacy HTTP bridge: http://127.0.0.1:${httpPort}${legacyStatusPath}`);
  console.log(`Aivatar active session: http://127.0.0.1:${httpPort}${activeSessionPath}`);
  console.log(`Aivatar stale sessions: http://127.0.0.1:${httpPort}${staleSessionsPath}`);
  console.log(`Aivatar disconnect session: http://127.0.0.1:${httpPort}${disconnectSessionPath}`);
  console.log(`Aivatar presence: http://127.0.0.1:${httpPort}${presencePath}`);
  console.log(`Aivatar avatar state: http://127.0.0.1:${httpPort}${avatarStatePath}`);
  console.log(`Aivatar health: http://127.0.0.1:${httpPort}${healthPath}`);
});

setInterval(() => {
  if (pruneSessions() > 0) {
    broadcast(makeSnapshot());
  }
}, Math.max(10_000, sessionStaleMs));

const shutdown = () => {
  httpServer.close();
  wsHttpServer.close();
  wsServer.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
