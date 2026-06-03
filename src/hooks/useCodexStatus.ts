import { useEffect, useMemo, useState } from "react";
import type {
  AgentStatusSnapshot,
  CodexStatusMessage,
  CodexStatusName,
  StatusSource,
} from "../types";

const WS_URL = "ws://127.0.0.1:38987/agent-status";
const HTTP_URL = "http://127.0.0.1:38988/agent-status";
const ACTIVE_SESSION_URL = "http://127.0.0.1:38988/agent-active";
const STALE_SESSIONS_URL = "http://127.0.0.1:38988/agent-sessions/stale";
const DISCONNECT_SESSION_URL = "http://127.0.0.1:38988/agent-sessions/disconnect";

const simulatedStatuses: CodexStatusName[] = [
  "idle",
  "thinking",
  "executing",
  "waiting_for_user",
  "complete",
  "idle",
  "error",
];

const createStatus = (
  status: CodexStatusName,
  message?: string,
): CodexStatusMessage => ({
  agent: "aivatar",
  status,
  phase: status === "executing" ? "building" : status,
  task: message ?? "Aivatar local simulation",
  summary: message,
  progress: status === "complete" ? 100 : status === "idle" ? 0 : 48,
  message,
  severity: status === "error" ? "error" : status === "waiting_for_user" ? "warning" : "info",
  timestamp: new Date().toISOString(),
});

const isStatusMessage = (value: unknown): value is CodexStatusMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CodexStatusMessage>;
  return Boolean(candidate.status && candidate.timestamp);
};

const isStatusSnapshot = (value: unknown): value is AgentStatusSnapshot => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AgentStatusSnapshot>;
  return (
    candidate.type === "aivatar.status.snapshot" &&
    Boolean(candidate.currentStatus) &&
    Array.isArray(candidate.sessions)
  );
};

const fetchCurrentStatus = async () => {
  const response = await fetch(HTTP_URL);
  if (!response.ok) throw new Error(await response.text());
  const parsed: unknown = await response.json();
  return isStatusMessage(parsed) || isStatusSnapshot(parsed) ? parsed : null;
};

export const useCodexStatus = () => {
  const [source, setSource] = useState<StatusSource>("simulated");
  const [status, setStatus] = useState<CodexStatusMessage>(() =>
    createStatus("idle", "Agent is resting"),
  );
  const [sessions, setSessions] = useState<CodexStatusMessage[]>([]);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [connectedSessionKey, setConnectedSessionKey] = useState<string | null>(null);
  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(null);

  const applyStatusPayload = (payload: unknown) => {
    if (isStatusSnapshot(payload)) {
      setStatus(payload.currentStatus);
      setSessions(payload.sessions);
      setActiveSessionKey(payload.activeSessionKey ?? null);
      setConnectedSessionKey(payload.connectedSessionKey ?? null);
      setCurrentSessionKey(payload.currentSessionKey ?? null);
      return;
    }

    if (isStatusMessage(payload)) {
      setStatus(payload);
      setSessions([payload]);
      setActiveSessionKey(null);
      setConnectedSessionKey(null);
      setCurrentSessionKey(null);
    }
  };

  const postActiveSession = async (payload: unknown) => {
    const response = await fetch(ACTIVE_SESSION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(await response.text());
    const parsed: unknown = await response.json();
    applyStatusPayload(parsed);
  };

  const activateSession = async (agent: string, sessionId: string) => {
    await postActiveSession({ agent, sessionId });
  };

  const clearActiveSession = async () => {
    await postActiveSession({ clear: true });
  };

  const clearStaleSessions = async () => {
    const response = await fetch(STALE_SESSIONS_URL, {
      method: "DELETE",
    });

    if (!response.ok) throw new Error(await response.text());
    const parsed: unknown = await response.json();
    applyStatusPayload(parsed);
  };

  const disconnectSession = async (agent: string, sessionId: string) => {
    const response = await fetch(DISCONNECT_SESSION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ agent, sessionId }),
    });

    if (!response.ok) throw new Error(await response.text());
    const parsed: unknown = await response.json();
    applyStatusPayload(parsed);
  };

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        setSource("websocket");
        void fetchCurrentStatus()
          .then((next) => {
            if (next) applyStatusPayload(next);
          })
          .catch(() => {
            // WebSocket remains the primary live channel.
          });
      };

      socket.onmessage = (event) => {
        try {
          const parsed: unknown = JSON.parse(event.data);
          applyStatusPayload(parsed);
        } catch {
          setStatus(createStatus("error", "Received unreadable Codex status"));
        }
      };

      socket.onclose = () => {
        if (closed) return;
        setSource("simulated");
        reconnectTimer = window.setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    if (source !== "websocket") return;
    const timer = window.setInterval(() => {
      void fetchCurrentStatus()
        .then((next) => {
          if (next) applyStatusPayload(next);
        })
        .catch(() => {
          // Keep the last good WebSocket status if the HTTP snapshot is unavailable.
        });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [source]);

  useEffect(() => {
    if (source !== "simulated") return;
    let index = 0;
    const timer = window.setInterval(() => {
      index = (index + 1) % simulatedStatuses.length;
      const next = simulatedStatuses[index];
      const simulatedStatus = createStatus(next, `Simulated ${next.replace(/_/g, " ")}`);
      setStatus(simulatedStatus);
      setSessions([simulatedStatus]);
    }, 6500);

    return () => window.clearInterval(timer);
  }, [source]);

  return useMemo(
    () => ({
      status,
      sessions,
      source,
      endpoint: WS_URL,
      activeSessionKey,
      connectedSessionKey,
      currentSessionKey,
      activateSession,
      clearActiveSession,
      clearStaleSessions,
      disconnectSession,
    }),
    [activeSessionKey, connectedSessionKey, currentSessionKey, sessions, source, status],
  );
};
