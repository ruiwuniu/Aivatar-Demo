#!/usr/bin/env node
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

export const WORKBUDDY_AGENT = "workbuddy";
export const WORKBUDDY_USAGE_SOURCE = "workbuddy-sqlite";

const statusEndpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const presenceEndpoint =
  process.env.AIVATAR_PRESENCE_ENDPOINT ?? "http://127.0.0.1:38988/agent-presence";
const discoveryIntervalMs = Math.max(
  1000,
  Number(process.env.AIVATAR_WORKBUDDY_DISCOVERY_INTERVAL_MS ?? 3000),
);
const sessionStaleMs = Number(
  process.env.AIVATAR_SESSION_STALE_MS ?? 5 * 60 * 60 * 1000,
);
const liveActivityWindowMs = Math.max(
  discoveryIntervalMs,
  Number(process.env.AIVATAR_WORKBUDDY_LIVE_ACTIVITY_MS ?? 30_000),
);
const maxSessions = Math.max(
  1,
  Number(process.env.AIVATAR_WORKBUDDY_MAX_SESSIONS ?? 40),
);
const pidDir = join(tmpdir(), "aivatar-workbuddy-discovery");
const pidFile = join(pidDir, "discovery.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pathExists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
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

const workbuddyHome = () => {
  const configured =
    process.env.AIVATAR_WORKBUDDY_HOME ??
    process.env.WORKBUDDY_HOME ??
    process.env.WORKBUDDY_CONFIG_DIR;
  return configured && configured.trim()
    ? configured.trim()
    : join(homedir(), ".workbuddy-ai");
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

const compactText = (value, limit = 120) => {
  if (typeof value !== "string") return "";
  const clean = value
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return Array.from(clean).slice(0, limit).join("");
};

const nonNegativeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

const normalizeSurfaceMode = (value) => {
  const clean = compactText(value, 30).toLowerCase();
  if (clean === "working" || clean === "coding" || clean === "design") return clean;
  return clean || "session";
};

const surfaceLabel = (surface) => {
  if (surface === "working") return "Working";
  if (surface === "coding") return "Coding";
  if (surface === "design") return "Design";
  return "Session";
};

export const normalizeWorkbuddyTaskStatus = (rawStatus) => {
  const normalized = compactText(rawStatus, 60).toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "planning":
    case "preparing":
    case "connecting":
      return "planning";
    case "working":
    case "running":
    case "tool_start":
    case "tool_end":
    case "handoff":
    case "summarizing":
    case "waiting_team_members":
    case "model_requesting":
    case "model_streaming":
    case "model_done":
    case "tool_executing":
      return "working";
    case "pending":
    case "idle":
    case "await_input":
    case "awaitinput":
    case "waiting_input":
    case "waiting_user_input":
    case "connected":
      return "pending";
    case "completed":
    case "done":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "failed":
      return "failed";
    case "error":
      return "error";
    case "terminated":
      return "terminated";
    case "archived":
      return "archived";
    default:
      return normalized ? "pending" : "pending";
  }
};

const rowActivityMs = (row) =>
  Math.max(
    0,
    timestampMsFromValue(row.updatedAt) ?? 0,
    timestampMsFromValue(row.lastActivityAt) ?? 0,
    timestampMsFromValue(row.usageUpdatedAt) ?? 0,
    timestampMsFromValue(row.createdAt) ?? 0,
  );

const latestActivityMs = (row, sidecar) =>
  Math.max(
    rowActivityMs(row),
    timestampMsFromValue(sidecar?.updatedAt) ?? 0,
  );

const hasFreshWorkbuddyActivity = (row, sidecar, now = Date.now()) => {
  const latest = latestActivityMs(row, sidecar);
  if (!latest) return false;
  if (latest > now + 60_000) return true;
  return now - latest <= liveActivityWindowMs;
};

export const classifyWorkbuddyStatus = (row, sidecar, now = Date.now()) => {
  const taskStatus = normalizeWorkbuddyTaskStatus(row.status);
  const surface = normalizeSurfaceMode(row.sourceMode);
  const surfacePhase = `workbuddy-${surface}`;

  switch (taskStatus) {
    case "planning":
      return {
        status: "thinking",
        phase: `${surfacePhase}-planning`,
        progress: 25,
        severity: "info",
        active: true,
        rewardTerminal: false,
      };
    case "working":
      return {
        status: "executing",
        phase: `${surfacePhase}-working`,
        progress: 65,
        severity: "info",
        active: true,
        rewardTerminal: false,
      };
    case "pending":
      return {
        status: "waiting_for_user",
        phase: `${surfacePhase}-awaiting-input`,
        progress: 75,
        severity: "warning",
        active: true,
        rewardTerminal: false,
      };
    case "completed":
      return {
        status: "complete",
        phase: `${surfacePhase}-complete`,
        progress: 100,
        severity: "info",
        active: false,
        rewardTerminal: true,
      };
    case "failed":
    case "error":
    case "cancelled":
      return {
        status: "error",
        phase: `${surfacePhase}-${taskStatus}`,
        progress: 100,
        severity: "error",
        active: false,
        rewardTerminal: false,
      };
    case "terminated":
      if (hasFreshWorkbuddyActivity(row, sidecar, now)) {
        return {
          status: "thinking",
          phase: `${surfacePhase}-live`,
          progress: 40,
          severity: "info",
          active: true,
          rewardTerminal: false,
        };
      }
      return {
        status: "idle",
        phase: `${surfacePhase}-ended`,
        progress: 0,
        severity: "info",
        active: false,
        rewardTerminal: false,
      };
    case "archived":
    default:
      return {
        status: "idle",
        phase: `${surfacePhase}-archived`,
        progress: 0,
        severity: "info",
        active: false,
        rewardTerminal: false,
      };
  }
};

const workbuddyUsage = (row, scope, totalTokens) => {
  const used = nonNegativeNumber(row.used);
  const size = nonNegativeNumber(row.size);
  const total = nonNegativeNumber(totalTokens ?? used);
  if (!total || total <= 0) return undefined;
  const usage = {
    totalTokens: Math.round(total),
    source: WORKBUDDY_USAGE_SOURCE,
    scope,
  };
  if (scope !== "context-window") {
    usage.inputTokens = Math.round(total);
    usage.cachedInputTokens = 0;
    usage.outputTokens = 0;
    usage.reasoningOutputTokens = 0;
  }
  if (used && size && used > 0 && size > 0) {
    usage.contextTokens = Math.round(used);
    usage.modelContextWindow = Math.round(size);
  }
  return usage;
};

const titleForRow = (row) =>
  compactText(row.customTitle, 90) ||
  compactText(row.title, 90) ||
  compactText(row.cwd, 90) ||
  "Workbuddy session";

export const buildWorkbuddyStatusPayload = (
  row,
  sidecar,
  state = {},
  now = Date.now(),
) => {
  const classification = classifyWorkbuddyStatus(row, sidecar, now);
  const surface = normalizeSurfaceMode(row.sourceMode);
  const label = surfaceLabel(surface);
  const title = titleForRow(row);
  const rawStatus = compactText(row.status, 40) || "pending";
  const timestampMs = rowActivityMs(row) || Date.now();
  const used = nonNegativeNumber(row.used);
  const usage = (() => {
    if (classification.rewardTerminal) {
      const baseline = nonNegativeNumber(state.baselineUsed);
      if (baseline !== undefined && used !== undefined && used > baseline) {
        return workbuddyUsage(row, "since-baseline", used - baseline);
      }
    }
    return workbuddyUsage(row, "context-window");
  })();

  const model = compactText(row.model, 40);
  const detailParts = [
    `${label} area`,
    `Workbuddy ${rawStatus}`,
    model ? `model ${model}` : "",
    compactText(row.cwd, 90),
  ].filter(Boolean);

  return {
    agent: WORKBUDDY_AGENT,
    sessionId: row.id,
    status: classification.status,
    phase: classification.phase,
    task: `${label}: ${title}`,
    summary: `${label}: ${title}`,
    detail: detailParts.join(" | "),
    progress: classification.progress,
    message: `${label}: ${title}`,
    severity: classification.severity,
    timestamp: timestampIsoFromMs(timestampMs),
    presenceTimestamp: timestampIsoFromMs(
      timestampMsFromValue(sidecar?.updatedAt) ?? timestampMs,
    ),
    expiresAt: expiresIsoFromMs(timestampMs),
    source: WORKBUDDY_USAGE_SOURCE,
    surface,
    ...(usage ? { usage } : {}),
  };
};

export const updateWorkbuddySessionState = (row, payload, state = {}) => {
  const used = nonNegativeNumber(row.used);
  if (
    payload.status === "thinking" ||
    payload.status === "executing" ||
    payload.status === "waiting_for_user"
  ) {
    if (used !== undefined && state.baselineUsed === undefined) {
      state.baselineUsed = used;
    }
  } else if (payload.status === "complete" || payload.status === "error") {
    state.baselineUsed = undefined;
  } else if (payload.status === "idle") {
    state.baselineUsed = undefined;
  }
  state.lastUsed = used;
  state.lastStatus = payload.status;
  return state;
};

const rowFromSqlite = (row) => ({
  id: String(row.id ?? ""),
  cwd: row.cwd == null ? undefined : String(row.cwd),
  title: row.title == null ? undefined : String(row.title),
  customTitle: row.custom_title == null ? undefined : String(row.custom_title),
  status: row.status == null ? undefined : String(row.status),
  createdAt: timestampMsFromValue(row.created_at),
  updatedAt: timestampMsFromValue(row.updated_at),
  lastActivityAt: timestampMsFromValue(row.last_activity_at),
  sourceMode: row.source_mode == null ? undefined : String(row.source_mode),
  mode: row.mode == null ? undefined : String(row.mode),
  model: row.model == null ? undefined : String(row.model),
  permissionMode:
    row.permission_mode == null ? undefined : String(row.permission_mode),
  used: nonNegativeNumber(row.used),
  size: nonNegativeNumber(row.size),
  usageUpdatedAt: timestampMsFromValue(row.usage_updated_at),
});

export const readWorkbuddyRows = (DatabaseSync, configDir = workbuddyHome()) => {
  const dbPath = join(configDir, "workbuddy.db");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    const rows = db
      .prepare(
        `
        SELECT
          s.id,
          s.cwd,
          s.title,
          s.custom_title,
          s.status,
          s.created_at,
          s.updated_at,
          s.last_activity_at,
          s.source_mode,
          s.mode,
          s.model,
          s.permission_mode,
          u.used,
          u.size,
          u.updated_at AS usage_updated_at
        FROM sessions s
        LEFT JOIN session_usage u ON u.session_id = s.id
        WHERE s.id IS NOT NULL
          AND (s.deleted_at IS NULL OR s.deleted_at = 0)
          AND lower(coalesce(s.status, '')) != 'archived'
        ORDER BY coalesce(s.last_activity_at, s.updated_at, s.created_at, 0) DESC
        LIMIT ?
      `,
      )
      .all(maxSessions);
    return rows.map(rowFromSqlite).filter((row) => row.id);
  } finally {
    db.close();
  }
};

export const readWorkbuddySidecars = async (configDir = workbuddyHome()) => {
  const sessionsDir = join(configDir, "sessions");
  const sidecars = new Map();
  let entries;
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return sidecars;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = join(sessionsDir, entry.name);
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      const sessionId = compactText(value.sessionId, 120);
      if (!sessionId) continue;
      sidecars.set(sessionId, {
        sessionId,
        pid: Number.isInteger(value.pid) ? value.pid : undefined,
        cwd: compactText(value.cwd, 260),
        startedAt: timestampMsFromValue(value.startedAt),
        updatedAt: timestampMsFromValue(value.updatedAt),
        kind: compactText(value.kind, 40),
        mode: compactText(value.mode, 40),
        version: compactText(value.version, 40),
        file: basename(path),
      });
    } catch {
      // Ignore malformed sidecar records; Workbuddy recreates them.
    }
  }

  return sidecars;
};

const payloadKey = (payload) =>
  [
    payload.sessionId,
    payload.status,
    payload.phase,
    payload.timestamp,
    payload.usage?.scope,
    payload.usage?.totalTokens,
    payload.usage?.contextTokens,
  ].join("|");

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json().catch(() => ({}));
};

const postPresence = async (row, sidecar) => {
  const timestampMs =
    timestampMsFromValue(sidecar?.updatedAt) ||
    latestActivityMs(row, sidecar) ||
    Date.now();
  return postJson(presenceEndpoint, {
    agent: WORKBUDDY_AGENT,
    sessionId: row.id,
    timestamp: timestampIsoFromMs(timestampMs),
  });
};

export const discoverWorkbuddyOnce = async ({
  DatabaseSync,
  configDir = workbuddyHome(),
  states = new Map(),
  now = Date.now(),
  post = false,
} = {}) => {
  const rows = readWorkbuddyRows(DatabaseSync, configDir);
  const sidecars = await readWorkbuddySidecars(configDir);
  const payloads = [];

  for (const row of rows) {
    const state = states.get(row.id) ?? {};
    const sidecar = sidecars.get(row.id);
    const payload = buildWorkbuddyStatusPayload(row, sidecar, state, now);
    updateWorkbuddySessionState(row, payload, state);
    states.set(row.id, state);

    const key = payloadKey(payload);
    if (state.lastPayloadKey === key) continue;
    state.lastPayloadKey = key;

    if (post) {
      const presence = await postPresence(row, sidecar).catch((error) => ({
        error,
      }));
      if (!presence?.ignored) {
        await postJson(statusEndpoint, payload);
      }
    }
    payloads.push(payload);
  }

  return payloads;
};

const ensureSingleInstance = async () => {
  await mkdir(pidDir, { recursive: true });
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    if (processIsRunning(record?.pid)) {
      process.exit(0);
    }
  } catch {
    // No live Workbuddy discovery process is recorded.
  }

  await writeFile(
    pidFile,
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        workbuddyHome: workbuddyHome(),
      },
      null,
      2,
    ),
  );
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

const loadDatabaseSync = async () => {
  try {
    const sqlite = await import("node:sqlite");
    return sqlite.DatabaseSync;
  } catch (error) {
    throw new Error(
      `node:sqlite is unavailable in this Node.js runtime (${error.code ?? error.message}).`,
    );
  }
};

const main = async () => {
  const DatabaseSync = await loadDatabaseSync();
  const configDir = workbuddyHome();
  if (!(await pathExists(join(configDir, "workbuddy.db")))) {
    console.warn(`[workbuddy-session-discovery] Workbuddy DB not found under ${configDir}`);
  }
  await ensureSingleInstance();
  const states = new Map();
  let stopped = false;
  process.on("SIGINT", () => {
    stopped = true;
  });
  process.on("SIGTERM", () => {
    stopped = true;
  });

  console.log(
    `[workbuddy-session-discovery] watching ${configDir} every ${discoveryIntervalMs}ms`,
  );

  try {
    while (!stopped) {
      try {
        await discoverWorkbuddyOnce({ DatabaseSync, configDir, states, post: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[workbuddy-session-discovery] ${message}`);
      }
      await sleep(discoveryIntervalMs);
    }
  } finally {
    await cleanup();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workbuddy-session-discovery] ${message}`);
    process.exitCode = 1;
  });
}
