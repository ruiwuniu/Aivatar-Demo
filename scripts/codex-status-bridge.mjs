import http from "node:http";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
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
const healthPath = "/health";
const sessionStaleMs = Number(
  process.env.AIVATAR_SESSION_STALE_MS ?? 30 * 60 * 1000,
);
const activityStaleMs = Number(
  process.env.AIVATAR_ACTIVITY_STALE_MS ?? 5 * 60 * 1000,
);
const disconnectedSessionTombstoneMs = Number(
  process.env.AIVATAR_DISCONNECTED_SESSION_TOMBSTONE_MS ??
    24 * 60 * 60 * 1000,
);
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
};

const isSessionTombstoned = (key) => {
  const expiresAt = disconnectedSessionKeys.get(key);
  if (!expiresAt) return false;
  if (Date.now() <= expiresAt) return true;
  disconnectedSessionKeys.delete(key);
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

const stopRecordedSessionProcesses = async (session) => {
  let stoppedProcesses = 0;
  stoppedProcesses += await stopPluginPidFile(pluginPidFileFor(session, "heartbeat"));
  stoppedProcesses += await stopPluginPidFile(pluginPidFileFor(session, "watcher"));
  stoppedProcesses += await stopCliPidFile(cliPidFileFor(session));
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
    });
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
      if (activeSessionKey) disconnectedSessionKeys.delete(activeSessionKey);
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
        sendJson(response, 202, makeSnapshot());
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
        sendJson(response, 202, makeSnapshot());
        return;
      }
      const existing = sessions.get(key);
      currentStatus = {
        ...nextStatus,
        presenceTimestamp: nextStatus.presenceTimestamp ?? existing?.presenceTimestamp,
        usage: nextStatus.usage ?? existing?.usage,
        idleBubbleCandidates:
          nextStatus.idleBubbleCandidates ?? existing?.idleBubbleCandidates,
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
