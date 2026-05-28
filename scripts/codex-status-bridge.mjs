import http from "node:http";
import { WebSocketServer } from "ws";

const wsPort = Number(process.env.AIVATAR_WS_PORT ?? 38987);
const httpPort = Number(process.env.AIVATAR_HTTP_PORT ?? 38988);
const agentWsPath = "/agent-status";
const legacyWsPath = "/codex-status";
const agentStatusPath = "/agent-status";
const legacyStatusPath = "/codex-status";
const activeSessionPath = "/agent-active";
const staleSessionsPath = "/agent-sessions/stale";
const presencePath = "/agent-presence";
const healthPath = "/health";
const sessionStaleMs = Number(process.env.AIVATAR_SESSION_STALE_MS ?? 60000);

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

const sessionKey = (status) =>
  `${status.agent ?? "codex"}:${status.sessionId ?? "default"}`;

const sortedSessions = () =>
  [...sessions.values()]
    .map((status) => ({
      ...status,
      connected: !isPresenceStale(status),
    }))
    .sort(
      (a, b) =>
        Date.parse(b.presenceTimestamp ?? b.timestamp) -
        Date.parse(a.presenceTimestamp ?? a.timestamp),
    );

const isSessionStale = (status) => {
  const updatedAt = Date.parse(status.timestamp);
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt > sessionStaleMs;
};

const isPresenceStale = (status) => {
  const updatedAt = Date.parse(status.presenceTimestamp ?? status.timestamp);
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt > sessionStaleMs;
};

const chooseCurrentStatus = () => {
  const candidates = sortedSessions();
  const activeSession = activeSessionKey ? sessions.get(activeSessionKey) : null;

  if (activeSession && !isSessionStale(activeSession)) {
    return activeSession;
  }

  return (
    candidates.find(
      (status) =>
        highPriorityStatuses.has(status.status) && !isSessionStale(status),
    ) ??
    candidates.find(
      (status) => status.status !== "idle" && !isSessionStale(status),
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
    if (key === activeSessionKey || !isPresenceStale(status)) continue;
    sessions.delete(key);
    deletedSessions += 1;
  }

  return deletedSessions;
};

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

  if (request.url === presencePath && request.method === "POST") {
    try {
      const presence = await readPresenceBody(request);
      const key = `${presence.agent}:${presence.sessionId}`;
      const existing = sessions.get(key);
      sessions.set(key, {
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
      });
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
      const existing = sessions.get(sessionKey(nextStatus));
      currentStatus = {
        ...nextStatus,
        idleBubbleCandidates:
          nextStatus.idleBubbleCandidates ?? existing?.idleBubbleCandidates,
      };
      sessions.set(sessionKey(currentStatus), currentStatus);
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
  console.log(`Aivatar presence: http://127.0.0.1:${httpPort}${presencePath}`);
  console.log(`Aivatar health: http://127.0.0.1:${httpPort}${healthPath}`);
});

const shutdown = () => {
  httpServer.close();
  wsHttpServer.close();
  wsServer.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
