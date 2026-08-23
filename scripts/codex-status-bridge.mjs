import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const scriptDir = dirname(fileURLToPath(import.meta.url));

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
const paintingPlanPath = "/painting-plan";
const socialDialoguePath = "/social-dialogue";
const roomsPath = "/rooms";
const visitInvitePath = "/visits/invite";
const visitStatePath = "/visits/state";
const visitEndPath = "/visits/end";
const claudeHookPath = "/agent-hooks/claude-code";
const claudeStatusLineHookPath = "/agent-hooks/claude-code/status-line";
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
const maxClaudeDigestEntries = 12;
const learningScript =
  process.env.AIVATAR_LEARNING_SCRIPT ??
  join(scriptDir, "aivatar-learning-worker.mjs");
const nodeCommand = process.env.AIVATAR_NODE_COMMAND ?? process.execPath;
const paintingWorkerScript =
  process.env.AIVATAR_PAINTING_SCRIPT ??
  join(scriptDir, "aivatar-painting-worker.mjs");
const paintingPlanTimeoutMs = Math.max(
  5000,
  Number(process.env.AIVATAR_PAINTING_TIMEOUT_MS ?? 55000),
);
const socialDialogueWorkerScript =
  process.env.AIVATAR_SOCIAL_DIALOGUE_SCRIPT ??
  join(scriptDir, "aivatar-social-dialogue-worker.mjs");
const socialDialogueTimeoutMs = Math.max(
  5000,
  Number(process.env.AIVATAR_SOCIAL_DIALOGUE_TIMEOUT_MS ?? 55000),
);
const roomFinishedVisitTtlMs = 30000;
const learningEnabled = !/^(0|false|no|off)$/i.test(
  process.env.AIVATAR_LEARNING_ENABLED ?? "1",
);

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
const claudeDigests = new Map();
const claudeLastLearningKeys = new Map();
const rooms = new Map();
const visits = new Map();

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
  expiresAt:
    typeof status.expiresAt === "string" ? status.expiresAt : sessionExpiresAt(),
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
    "tokenLimit5hPercent",
    "tokenLimit5hResetAt",
    "tokenLimitWeekPercent",
    "tokenLimitWeekResetAt",
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

const socialBubbleKinds = new Set(["active", "response"]);
const socialBubbleLocales = new Set(["zh", "en", "mixed"]);
const socialBubbleRoles = new Set(["host", "guest"]);
const socialBubbleActivities = new Set([
  "interact",
  "coffee",
  "play",
  "music",
  "relax",
  "admire",
  "wander",
]);

const compactSocialBubbleText = (value, limit) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

const normalizeSocialBubbleIntent = (value, fallbackText) => {
  const intent = compactSocialBubbleText(value, 40)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return intent || `session-${safeSessionName(fallbackText || "bubble").slice(0, 16)}`;
};

const normalizeSocialBubbleCandidates = (value) => {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set();
  const candidates = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const text = compactSocialBubbleText(entry.text, 56);
    const length = Array.from(text).length;
    if (length < 2 || length > 56) continue;
    const kind = socialBubbleKinds.has(entry.kind) ? entry.kind : "active";
    const locale = socialBubbleLocales.has(entry.locale) ? entry.locale : undefined;
    const intentId = normalizeSocialBubbleIntent(entry.intentId, text);
    const signature = `${kind}:${intentId}:${text.toLowerCase()}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const replyToIntentIds = Array.isArray(entry.replyToIntentIds)
      ? [...new Set(entry.replyToIntentIds.map((item) => normalizeSocialBubbleIntent(item, text)))]
          .slice(0, 4)
      : [];
    const allowedVisitRoles = Array.isArray(entry.allowedVisitRoles)
      ? [...new Set(entry.allowedVisitRoles.filter((role) => socialBubbleRoles.has(role)))]
      : [];
    const tags = Array.isArray(entry.tags)
      ? [...new Set(entry.tags.map((tag) => compactSocialBubbleText(tag, 18)).filter(Boolean))]
          .slice(0, 4)
      : [];
    candidates.push({
      kind,
      text,
      locale,
      intentId,
      replyToIntentIds: kind === "response" ? replyToIntentIds : [],
      allowedVisitRoles: allowedVisitRoles.length ? allowedVisitRoles : ["host", "guest"],
      activity: socialBubbleActivities.has(entry.activity) ? entry.activity : undefined,
      tags,
    });
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
    socialBubbleCandidates: normalizeSocialBubbleCandidates(
      value.socialBubbleCandidates,
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

const paintingArchetypes = new Set([
  "signal_tower",
  "window_city",
  "terminal_star_map",
  "desk_still_life",
  "harbor_beacon",
  "mountain_path",
  "circuit_grid",
  "mosaic_garden",
  "color_bloom",
  "lantern_room",
]);

const paintingTraitNames = [
  "focus",
  "resilience",
  "curiosity",
  "efficiency",
  "creativity",
  "warmth",
];

const normalizedPaintingText = (value, limit) =>
  sanitizedDigestText(value ?? "", limit);

const normalizedPaintingStringArray = (value, limit, textLimit) =>
  Array.isArray(value)
    ? value
        .map((entry) => normalizedPaintingText(entry, textLimit))
        .filter(Boolean)
        .slice(0, limit)
    : [];

const normalizePaintingEvent = (event) => {
  if (!event || typeof event !== "object") return undefined;
  const output = {};
  for (const field of ["type", "agent", "status", "behavior", "itemId"]) {
    const text = normalizedPaintingText(event[field], 80);
    if (text) output[field] = text;
  }
  const summary = normalizedPaintingText(event.summary, 180);
  if (summary) output.summary = summary;
  const bits = Number(event.bits);
  if (Number.isFinite(bits) && bits > 0) output.bits = Math.round(bits);
  return Object.keys(output).length > 0 ? output : undefined;
};

const normalizePaintingPlanRequest = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("Painting plan payload must be a JSON object");
  }

  const sourceTraits = value.growth?.traits ?? value.traits ?? {};
  const traits = {};
  for (const trait of paintingTraitNames) {
    const next = Number(sourceTraits[trait]);
    traits[trait] = Number.isFinite(next) && next >= 0 ? Math.round(next) : 0;
  }

  const sortedTraits = Object.entries(traits).sort((left, right) => right[1] - left[1]);
  const dominantTrait = paintingTraitNames.includes(value.dominantTrait)
    ? value.dominantTrait
    : sortedTraits[0]?.[0] ?? "focus";
  const secondaryTrait = paintingTraitNames.includes(value.secondaryTrait)
    ? value.secondaryTrait
    : sortedTraits[1]?.[0] ?? dominantTrait;

  const preferences =
    value.preferences && typeof value.preferences === "object"
      ? value.preferences
      : {};
  const draft = value.draft && typeof value.draft === "object" ? value.draft : {};
  const growthLevel = Number(value.growthLevel ?? value.growth?.level);

  return {
    avatarId: normalizedPaintingText(value.avatarId, 80) || undefined,
    avatarName: normalizedPaintingText(value.avatarName, 40) || undefined,
    growthLevel:
      Number.isFinite(growthLevel) && growthLevel > 0
        ? Math.round(growthLevel)
        : 1,
    traits,
    dominantTrait,
    secondaryTrait,
    preferences: {
      favoriteActivity:
        normalizedPaintingText(preferences.favoriteActivity, 40) || undefined,
      favoriteRecovery:
        normalizedPaintingText(preferences.favoriteRecovery, 40) || undefined,
      idleBubbleLanguage: ["zh", "en", "mixed"].includes(
        preferences.idleBubbleLanguage,
      )
        ? preferences.idleBubbleLanguage
        : "auto",
    },
    savedBubbles: normalizedPaintingStringArray(value.savedBubbles, 8, 80),
    recentEvents: Array.isArray(value.recentEvents)
      ? value.recentEvents
          .slice(0, 8)
          .map(normalizePaintingEvent)
          .filter(Boolean)
      : [],
    draft: {
      id: normalizedPaintingText(draft.id, 100) || undefined,
      easelItemId: normalizedPaintingText(draft.easelItemId, 80) || undefined,
      createdAt: normalizedPaintingText(draft.createdAt, 80) || undefined,
      progressSeconds: Math.max(0, Math.round(Number(draft.progressSeconds) || 0)),
      targetSeconds: Math.max(1, Math.round(Number(draft.targetSeconds) || 1)),
      sourceSummary:
        normalizedPaintingText(draft.sourceSummary, 220) || undefined,
    },
    seedHint: normalizedPaintingText(value.seedHint, 160) || undefined,
  };
};

const normalizePaintingPlanResponse = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("Painting worker returned an invalid plan");
  }
  const archetype = paintingArchetypes.has(value.archetype)
    ? value.archetype
    : "color_bloom";
  const composition =
    value.composition && typeof value.composition === "object"
      ? value.composition
      : {};

  return {
    title: normalizedPaintingText(value.title, 42) || "Little Painting",
    archetype,
    mood: normalizedPaintingText(value.mood, 60) || undefined,
    paletteHint: normalizedPaintingText(value.paletteHint, 60) || undefined,
    composition: {
      background:
        normalizedPaintingText(composition.background, 60) || undefined,
      subject: normalizedPaintingText(composition.subject, 60) || undefined,
      foreground:
        normalizedPaintingText(composition.foreground, 60) || undefined,
      accent: normalizedPaintingText(composition.accent, 60) || undefined,
    },
    motifs: normalizedPaintingStringArray(value.motifs, 5, 32),
    source: value.source === "heuristic" ? "heuristic" : "llm",
  };
};

const extractJsonObject = (text) => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Painting worker returned empty output");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Painting worker output is not JSON");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
};

const paintingProvider = () =>
  process.env.AIVATAR_PAINTING_PROVIDER ??
  process.env.AIVATAR_LEARNING_PROVIDER ??
  process.env.AIVATAR_PROVIDER ??
  "claude-code";

const paintingPayloadPath = async (payload) => {
  const avatar = safeSessionName(payload.avatarId ?? payload.avatarName ?? "avatar");
  const path = join(
    tmpdir(),
    "aivatar-painting-context",
    `painting-${avatar}-${Date.now()}.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
};

const runPaintingWorker = async (payload) => {
  if (!existsSync(paintingWorkerScript)) {
    throw new Error("Painting worker script is unavailable");
  }
  const payloadFile = await paintingPayloadPath(payload);
  return new Promise((resolve, reject) => {
    const child = spawn(
      nodeCommand,
      [
        paintingWorkerScript,
        "--provider",
        paintingProvider(),
        "--payload-file",
        payloadFile,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Painting worker timed out"));
    }, paintingPlanTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Painting worker exited ${code}: ${
              sanitizedDigestText(stderr || stdout, 240) || "no output"
            }`,
          ),
        );
        return;
      }
      try {
        resolve(normalizePaintingPlanResponse(extractJsonObject(stdout)));
      } catch (error) {
        reject(error);
      }
    });
  });
};

const socialDialogueActivities = new Set([
  "interact",
  "coffee",
  "play",
  "music",
  "relax",
  "admire",
  "wander",
]);

const socialDialogueExpressions = new Set([
  "calm",
  "focused",
  "happy",
  "sleepy",
  "worried",
]);

const normalizeSocialDialogueTraits = (value) => {
  const sourceTraits = value && typeof value === "object" ? value : {};
  const traits = {};
  for (const trait of paintingTraitNames) {
    const next = Number(sourceTraits[trait]);
    traits[trait] = Number.isFinite(next) && next >= 0 ? Math.round(next) : 0;
  }
  return traits;
};

const normalizeSocialDialogueCharacter = (value) => {
  const character = value && typeof value === "object" ? value : {};
  const petStats = character.petStats && typeof character.petStats === "object"
    ? character.petStats
    : {};
  return {
    id: normalizedPaintingText(character.id, 80) || undefined,
    name: normalizedPaintingText(character.name, 40) || undefined,
    growthLevel: Math.max(1, Math.round(Number(character.growthLevel) || 1)),
    traits: normalizeSocialDialogueTraits(character.traits),
    petStats: {
      energy: Math.max(0, Math.min(100, Math.round(Number(petStats.energy) || 0))),
      mood: Math.max(0, Math.min(100, Math.round(Number(petStats.mood) || 0))),
      hunger: Math.max(0, Math.min(100, Math.round(Number(petStats.hunger) || 0))),
    },
    idleBubblePhrases: normalizedPaintingStringArray(
      character.idleBubblePhrases,
      6,
      56,
    ),
  };
};

const normalizeSocialDialogueRequest = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("Social dialogue payload must be a JSON object");
  }
  const relationship =
    value.relationship && typeof value.relationship === "object"
      ? value.relationship
      : {};
  const activity = socialDialogueActivities.has(value.activity)
    ? value.activity
    : "interact";
  const maxTurns = Math.round(Number(value.maxTurns) || 4);
  return {
    visitId: normalizedPaintingText(value.visitId, 100) || undefined,
    locale: normalizedPaintingText(value.locale, 16) || "en",
    activity,
    activityLabel: normalizedPaintingText(value.activityLabel, 60) || undefined,
    host: normalizeSocialDialogueCharacter(value.host),
    guest: normalizeSocialDialogueCharacter(value.guest),
    relationship: {
      affinity: Math.max(0, Math.min(999, Math.round(Number(relationship.affinity) || 0))),
      visits: Math.max(0, Math.round(Number(relationship.visits) || 0)),
      unlockedActivities: normalizedPaintingStringArray(
        relationship.unlockedActivities,
        8,
        40,
      ),
      lastDialogueSummary:
        normalizedPaintingText(relationship.lastDialogueSummary, 160) || undefined,
    },
    roomFeatures: normalizedPaintingStringArray(value.roomFeatures, 10, 40),
    maxTurns: Math.max(3, Math.min(6, maxTurns)),
    seedHint: normalizedPaintingText(value.seedHint, 160) || undefined,
  };
};

const normalizeSocialDialogueLine = (line, index) => {
  if (!line || typeof line !== "object") return null;
  const text = normalizedPaintingText(line.text, 56);
  if (!text) return null;
  const durationMs = Math.round(Number(line.durationMs) || 2300);
  return {
    speaker:
      line.speaker === "host" || line.speaker === "guest"
        ? line.speaker
        : index % 2 === 0
          ? "guest"
          : "host",
    text,
    expression: socialDialogueExpressions.has(line.expression)
      ? line.expression
      : "happy",
    durationMs: Math.max(1600, Math.min(3200, durationMs)),
  };
};

const normalizeSocialDialogueResponse = (value) => {
  if (!value || typeof value !== "object") {
    throw new Error("Social dialogue worker returned an invalid dialogue");
  }
  const lines = Array.isArray(value.lines)
    ? value.lines.map(normalizeSocialDialogueLine).filter(Boolean).slice(0, 6)
    : [];
  if (lines.length < 2) {
    throw new Error("Social dialogue worker returned too few lines");
  }
  return {
    lines,
    summary: normalizedPaintingText(value.summary, 160) || undefined,
    relationshipDelta: Math.max(
      0,
      Math.min(6, Math.round(Number(value.relationshipDelta) || 0)),
    ),
    source: value.source === "heuristic" ? "heuristic" : "llm",
    generatedAt:
      typeof value.generatedAt === "string"
        ? value.generatedAt.slice(0, 80)
        : new Date().toISOString(),
  };
};

const socialDialogueProvider = () =>
  process.env.AIVATAR_SOCIAL_DIALOGUE_PROVIDER ??
  process.env.AIVATAR_LEARNING_PROVIDER ??
  process.env.AIVATAR_PROVIDER ??
  "claude-code";

const socialDialoguePayloadPath = async (payload) => {
  const visit = safeSessionName(payload.visitId ?? "visit");
  const path = join(
    tmpdir(),
    "aivatar-social-dialogue-context",
    `dialogue-${visit}-${Date.now()}.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
};

const runSocialDialogueWorker = async (payload) => {
  if (!existsSync(socialDialogueWorkerScript)) {
    throw new Error("Social dialogue worker script is unavailable");
  }
  const payloadFile = await socialDialoguePayloadPath(payload);
  return new Promise((resolve, reject) => {
    const child = spawn(
      nodeCommand,
      [
        socialDialogueWorkerScript,
        "--provider",
        socialDialogueProvider(),
        "--payload-file",
        payloadFile,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Social dialogue worker timed out"));
    }, socialDialogueTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Social dialogue worker exited ${code}: ${
              sanitizedDigestText(stderr || stdout, 240) || "no output"
            }`,
          ),
        );
        return;
      }
      try {
        resolve(normalizeSocialDialogueResponse(extractJsonObject(stdout)));
      } catch (error) {
        reject(error);
      }
    });
  });
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
    rewardId: typeof value.rewardId === "string" ? value.rewardId : undefined,
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
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : undefined,
    source: typeof value.source === "string" ? value.source : undefined,
    surface: typeof value.surface === "string" ? value.surface : undefined,
    desktopSessionId:
      typeof value.desktopSessionId === "string" ? value.desktopSessionId : undefined,
  };
};

const firstObjectString = (value, keys) => {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const text = value[key];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return undefined;
};

const claudeEventName = (input, statusLine = false) => {
  const event =
    firstObjectString(input, [
      "hook_event_name",
      "hookEventName",
      "event_name",
      "eventName",
      "type",
      "name",
      "kind",
      "phase",
      "status",
    ]) ??
    (typeof input?.event === "string" ? input.event.trim() : undefined) ??
    firstObjectString(input?.event, [
      "hook_event_name",
      "hookEventName",
      "event_name",
      "eventName",
      "type",
      "name",
      "kind",
      "phase",
    ]) ??
    firstObjectString(input?.payload, [
      "hook_event_name",
      "type",
      "name",
      "kind",
      "phase",
    ]) ??
    firstObjectString(input?.data, ["hook_event_name", "type", "name", "kind", "phase"]);
  return event ?? (statusLine || input?.context_window ? "StatusLine" : "Unknown");
};

const claudeSurfaceLabel = (input) => {
  const text = [
    firstObjectString(input, [
      "mode",
      "surface",
      "channel",
      "client_mode",
      "clientMode",
      "app_mode",
      "appMode",
      "source",
    ]),
    claudeEventName(input),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\bcowork\b|co-work|teammate|subagent/u.test(text)) return "Claude Cowork";
  if (/\bchat\b|conversation/u.test(text)) return "Claude Chat";
  return "Claude Code";
};

const compactHookText = (value, limit = 120) => {
  let text = String(value ?? "")
    .replace(/\r|\n/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[path]")
    .replace(/(?:[./]|\\\\)[^\s"'<>]*[\\/][^\s"'<>]+/g, "[path]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[secret]")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).slice(0, limit).join("");
};

const sanitizedDigestText = (value, limit = 520) =>
  compactHookText(value, limit)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[path]")
    .replace(/(?:[./]|\\\\)[^\s"'<>]*[\\/][^\s"'<>]+/g, "[path]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[secret]")
    .replace(/\s+/g, " ")
    .trim();

const hookDisplayTextFromValue = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        hookDisplayTextFromValue(
          entry?.text ?? entry?.content ?? entry?.message ?? entry,
        ),
      )
      .filter(Boolean)
      .join(" ");
  }
  if (!value || typeof value !== "object") return "";
  for (const key of ["text", "delta", "message", "summary", "content"]) {
    const text = hookDisplayTextFromValue(value[key]);
    if (text.trim()) return text;
  }
  return "";
};

const claudeMessageDisplayText = (input) => {
  const text = [
    input?.delta,
    input?.message,
    input?.text,
    input?.content,
    input?.last_assistant_message,
    input?.assistant_message,
  ]
    .map(hookDisplayTextFromValue)
    .find((value) => typeof value === "string" && value.trim());
  return text ? compactHookText(text, 180) : undefined;
};

const safeSessionName = (value) =>
  String(value || "session").replace(/[^a-zA-Z0-9_.-]/g, "_") || "session";

const hashString = (value) => {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const claudeSessionId = (input) => {
  const explicit = firstObjectString(input, [
    "session_id",
    "sessionId",
    "sessionID",
    "conversation_id",
    "conversationId",
    "thread_id",
    "threadId",
    "chat_id",
    "chatId",
    "cowork_session_id",
    "coworkSessionId",
  ]);
  if (explicit) return explicit;
  const nested =
    firstObjectString(input?.session, ["id"]) ??
    firstObjectString(input?.conversation, ["id"]) ??
    firstObjectString(input?.thread, ["id"]) ??
    firstObjectString(input?.chat, ["id"]) ??
    firstObjectString(input?.cowork, ["id"]);
  if (nested) return nested;
  const basis = firstObjectString(input, [
    "session_name",
    "conversation_title",
    "conversationTitle",
    "title",
    "cwd",
  ]);
  if (!basis) return "claude-code-desktop";
  return `claude-${safeSessionName(`${claudeSurfaceLabel(input)}-${basis}`).slice(
    0,
    48,
  )}-${hashString(basis)}`;
};

const claudeDigestEntry = (input) => {
  const event = claudeEventName(input);
  if (event === "UserPromptSubmit" && typeof input.prompt === "string") {
    return `user: ${sanitizedDigestText(input.prompt, 520)}`;
  }
  if (event === "MessageDisplay" && typeof input.delta === "string") {
    return `assistant: ${sanitizedDigestText(input.delta, 520)}`;
  }
  if (
    event === "PreToolUse" ||
    event === "PostToolUse" ||
    event === "PostToolUseFailure"
  ) {
    const tool = firstObjectString(input, ["tool_name"]) ?? "tool";
    const detail =
      input.tool_input && typeof input.tool_input === "object"
        ? firstObjectString(input.tool_input, ["description", "query", "prompt"])
        : undefined;
    return detail
      ? `tool ${tool}: ${sanitizedDigestText(detail, 220)}`
      : `tool ${tool}`;
  }
  if (
    event === "PermissionRequest" ||
    event === "PermissionDenied" ||
    event === "Notification"
  ) {
    const detail = firstObjectString(input, [
      "message",
      "reason",
      "notification_type",
    ]);
    return detail ? `${event}: ${sanitizedDigestText(detail, 220)}` : undefined;
  }
  if (event === "Stop" || event === "TeammateIdle") {
    return "turn: Claude Code completed the turn";
  }
  if (event === "TaskCompleted" || event === "SubagentStop") {
    return "turn: Claude Code completed delegated work";
  }
  if (event === "StopFailure") return "turn: Claude Code reported an error";
  return undefined;
};

const addClaudeDigest = (sessionId, entry) => {
  const text = sanitizedDigestText(entry, 760);
  if (!text) return;
  const digest = claudeDigests.get(sessionId) ?? [];
  digest.push(text);
  while (digest.length > maxClaudeDigestEntries) digest.shift();
  claudeDigests.set(sessionId, digest);
};

const takeClaudeDigest = (sessionId) => {
  const digest = claudeDigests.get(sessionId) ?? [];
  claudeDigests.delete(sessionId);
  return digest;
};

const markClaudeLearningKey = (sessionId, key) => {
  if (claudeLastLearningKeys.get(sessionId) === key) return false;
  claudeLastLearningKeys.set(sessionId, key);
  return true;
};

const learningContextPath = async (sessionId, digest, summary) => {
  const path = join(
    tmpdir(),
    "aivatar-learning-context",
    `claude-native-${safeSessionName(sessionId)}-${Date.now()}.txt`,
  );
  await mkdir(dirname(path), { recursive: true });
  const content = [
    summary ? `summary: ${sanitizedDigestText(summary, 220)}` : "",
    ...digest,
  ]
    .filter(Boolean)
    .join("\n");
  await writeFile(path, `${content || "Claude Code turn completed."}\n`, "utf8");
  return path;
};

const spawnClaudeLearningWorker = async (status, digest) => {
  if (!existsSync(learningScript)) return false;
  try {
    const sessionId = status.sessionId ?? "claude-code-desktop";
    const summary =
      status.summary ?? status.message ?? "Claude Code turn complete";
    const contextPath = await learningContextPath(sessionId, digest, summary);
    const child = spawn(
      nodeCommand,
      [
        learningScript,
        "--provider",
        "claude-code",
        "--agent",
        "claude-code",
        "--session",
        sessionId,
        "--status",
        status.status === "error" ? "error" : "complete",
        "--summary",
        summary,
        "--context-file",
        contextPath,
        "--avatar-state-file",
        avatarStateFile,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          AIVATAR_AGENT: "claude-code",
          AIVATAR_SESSION_ID: sessionId,
          AIVATAR_LEARNING_PROVIDER: "claude-code",
        },
      },
    );
    child.unref();
    return true;
  } catch {
    return false;
  }
};

const sessionLearningStatus = (status, learning) => ({
  agent: "claude-code",
  sessionId: status.sessionId ?? "claude-code-desktop",
  rewardId: status.rewardId,
  status: status.status === "error" ? "error" : "complete",
  phase: "session-learning",
  task: status.summary ?? status.message ?? "Claude Code turn complete",
  summary: status.summary ?? status.message ?? "Claude Code turn complete",
  progress: status.status === "complete" ? 100 : 50,
  message: "Claude Code session learning updated",
  severity: status.status === "error" ? "error" : "info",
  timestamp: new Date().toISOString(),
  learning,
});

const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const claudeUsageFromInput = (input, terminal) => {
  const context = input?.context_window;
  if (!context || typeof context !== "object") return undefined;

  const current =
    context.current_usage && typeof context.current_usage === "object"
      ? context.current_usage
      : {};
  const inputTokens =
    positiveNumber(current.input_tokens) +
    positiveNumber(current.cache_creation_input_tokens) +
    positiveNumber(current.cache_read_input_tokens);
  const outputTokens = Math.max(
    positiveNumber(current.output_tokens),
    positiveNumber(context.total_output_tokens),
  );
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens <= 0) return undefined;

  return {
    inputTokens: Math.round(inputTokens),
    cachedInputTokens: Math.round(positiveNumber(current.cache_read_input_tokens)),
    outputTokens: Math.round(outputTokens),
    totalTokens: Math.round(totalTokens),
    contextTokens: Math.round(inputTokens),
    modelContextWindow: Math.round(
      positiveNumber(context.context_window_size) || 200000,
    ),
    source: "claude-code-js-statusline",
    scope: terminal ? "turn" : "context-window",
  };
};

const claudeNotificationNeedsUser = (input) => {
  const text =
    firstObjectString(input, ["message", "reason", "notification_type"]) ??
    firstObjectString(input?.notification, ["message", "type"]);
  return /permission|approval|approve|confirm|input|required|waiting|elicitation/u.test(
    String(text ?? "").toLowerCase(),
  );
};

const claudeStatusForEvent = (event, statusLine, hasUsage) => {
  if (statusLine) {
    return ["idle", "context-window"];
  }
  switch (event) {
    case "SessionStart":
      return ["idle", "session-start"];
    case "Setup":
      return ["idle", "setup"];
    case "InstructionsLoaded":
      return ["idle", "instructions-loaded"];
    case "ConfigChange":
      return ["idle", "config-change"];
    case "CwdChanged":
      return ["idle", "cwd-changed"];
    case "UserPromptSubmit":
      return ["thinking", "user-prompt"];
    case "UserPromptExpansion":
      return ["thinking", "user-prompt-expansion"];
    case "PreCompact":
      return ["thinking", "pre-compact"];
    case "PostCompact":
      return ["thinking", "post-compact"];
    case "ElicitationResult":
      return ["thinking", "elicitation-result"];
    case "PreToolUse":
    case "SubagentStart":
    case "TaskCreated":
      return ["executing", "tool-use"];
    case "PostToolUse":
    case "PostToolBatch":
    case "SubagentStop":
    case "TaskCompleted":
      return ["thinking", "tool-result"];
    case "MessageDisplay":
      return ["thinking", "message-display"];
    case "PermissionRequest":
    case "Elicitation":
      return ["waiting_for_user", "permission"];
    case "PermissionDenied":
    case "StopFailure":
      return ["error", "error"];
    case "PostToolUseFailure":
      return ["thinking", "tool-result-failed"];
    case "Stop":
    case "TeammateIdle":
      return ["complete", "turn-complete"];
    case "SessionEnd":
      return ["idle", "session-end"];
    case "Notification":
      return ["thinking", "notification"];
    default:
      if (/permission|approval|waiting|input_required|elicitation/u.test(event.toLowerCase())) {
        return ["waiting_for_user", event];
      }
      if (/fail|failed|error|exception/u.test(event.toLowerCase())) {
        return ["error", event];
      }
      if (/stop|complete|completed|done|idle/u.test(event.toLowerCase())) {
        return ["complete", event];
      }
      if (/tool|command|execute|executing|running|task|subagent/u.test(event.toLowerCase())) {
        return ["executing", event];
      }
      return ["thinking", "hook"];
  }
};

const claudeIdleBubbles = (input) => {
  const candidates = [];
  for (const key of ["session_name", "conversation_title", "conversationTitle", "message"]) {
    const phrase = compactHookText(input?.[key], 28);
    const length = Array.from(phrase).length;
    if (length >= 2 && length <= 28 && !candidates.includes(phrase)) {
      candidates.push(phrase);
    }
  }
  return candidates.length > 0 ? candidates : undefined;
};

const claudeLearningForStatus = (status, input) => {
  if (status.status !== "complete" && status.status !== "error") return undefined;
  const summary = status.summary ?? "Claude Code turn complete";
  const text = `${summary} ${firstObjectString(input, [
    "tool_name",
    "hook_event_name",
    "eventName",
    "type",
  ]) ?? ""} ${firstObjectString(input, ["message", "session_name"]) ?? ""}`.toLowerCase();
  const traitChanges = {};
  if (/error|fail|fix|repair/u.test(text)) traitChanges.resilience = 1;
  if (/test|build|check|verify/u.test(text)) traitChanges.focus = 1;
  if (/ui|design|visual|bubble/u.test(text)) traitChanges.creativity = 1;
  if (/complete|done|success|finish/u.test(text)) traitChanges.efficiency = 1;
  if (/why|explore|idea|learn/u.test(text)) traitChanges.curiosity = 1;
  return {
    id: `js-claude-${status.sessionId ?? "session"}-${Date.now()}`,
    source: "heuristic",
    summary: compactHookText(summary, 160),
    idleBubbleCandidates:
      claudeIdleBubbles(input) ?? ["I learned a little", "Session thoughts saved"],
    traitChanges,
    xp: 2,
    confidence: 0.35,
    privacyRisk: "low",
  };
};

const isTerminalSessionStatus = (status) =>
  status?.status === "complete" || status?.status === "error";

const isClaudeLifecycleOnlyIdleStatus = (status) =>
  status?.agent === "claude-code" &&
  status?.status === "idle" &&
  [
    "session-start",
    "setup",
    "instructions-loaded",
    "config-change",
    "cwd-changed",
    "session-end",
    "other",
  ].includes(status?.phase) &&
  !status?.usage &&
  !status?.learning;

const isClaudeDesktopInventoryStatus = (status) =>
  status?.agent === "claude-code" &&
  status?.status === "idle" &&
  [
    "desktop-chat-session",
    "desktop-cowork-session",
    "desktop-code-session",
  ].includes(status?.phase);

const isClaudeDesktopAliasedStatus = (status) =>
  status?.agent === "claude-code" &&
  typeof status?.desktopSessionId === "string" &&
  status.desktopSessionId.trim().length > 0;

const statusMergeRank = (status) => {
  if (!status) return 0;
  if (highPriorityStatuses.has(status.status)) return 4;
  if (isTerminalSessionStatus(status)) return 3;
  if (status.status && status.status !== "idle") return 2;
  return 1;
};

const claudeDesktopAliasKey = (status, preferredKey) => {
  if (!isClaudeDesktopAliasedStatus(status)) return undefined;
  const desktopSessionId = status.desktopSessionId.trim().toLowerCase();
  let bestKey;
  let bestRank = -1;
  for (const [candidateKey, candidate] of sessions) {
    if (candidateKey === preferredKey) continue;
    if (candidate?.agent !== "claude-code") continue;
    if (
      String(candidate.desktopSessionId ?? "").trim().toLowerCase() !==
      desktopSessionId
    ) {
      continue;
    }
    const rank = statusMergeRank(candidate);
    if (rank > bestRank) {
      bestKey = candidateKey;
      bestRank = rank;
    }
  }
  return bestKey;
};

const bestExistingStatus = (exact, alias) => {
  if (!alias) return exact;
  if (!exact) return alias;
  if (exact.status === "idle" && alias.status !== "idle") return alias;
  return exact;
};

const canonicalizeClaudeDesktopAliasStatus = (status, incoming) => {
  if (!isClaudeDesktopAliasedStatus(incoming)) return status;
  return {
    ...status,
    agent: incoming.agent ?? status.agent,
    sessionId: incoming.sessionId ?? status.sessionId,
    desktopSessionId: incoming.desktopSessionId ?? status.desktopSessionId,
    surface: incoming.surface ?? status.surface,
  };
};

const mergeClaudeDesktopInventoryStatus = (nextStatus, existing) => {
  if (!existing || existing.status === "idle") return nextStatus;

  return {
    ...existing,
    presenceTimestamp:
      nextStatus.presenceTimestamp ?? existing.presenceTimestamp,
    expiresAt: nextStatus.expiresAt ?? existing.expiresAt,
    surface: nextStatus.surface ?? existing.surface,
    desktopSessionId: nextStatus.desktopSessionId ?? existing.desktopSessionId,
  };
};

const preserveClaudeSessionEndStatus = (event, nextStatus, existing) => {
  if (event !== "SessionEnd" || !existing || !isTerminalSessionStatus(existing)) {
    return nextStatus;
  }

  return {
    ...existing,
    timestamp: nextStatus.timestamp ?? existing.timestamp,
    expiresAt: nextStatus.expiresAt ?? existing.expiresAt,
    presenceTimestamp: nextStatus.presenceTimestamp ?? existing.presenceTimestamp,
    usage: nextStatus.usage ?? existing.usage,
    idleBubbleCandidates:
      nextStatus.idleBubbleCandidates ?? existing.idleBubbleCandidates,
    learning: nextStatus.learning ?? existing.learning,
  };
};

const normalizeClaudeHookStatus = (input, statusLine) => {
  if (!input || typeof input !== "object") {
    throw new Error("Claude hook payload must be a JSON object");
  }

  const event = claudeEventName(input, statusLine);
  const usage = claudeUsageFromInput(
    input,
    ["Stop", "TeammateIdle", "StopFailure"].includes(event),
  );
  let [status, phase] = claudeStatusForEvent(event, statusLine, Boolean(usage));
  if (event === "Notification" && claudeNotificationNeedsUser(input)) {
    status = "waiting_for_user";
    phase = "notification";
  }
  const sessionId = claudeSessionId(input);
  const timestamp = new Date().toISOString();
  const terminal = status === "complete" || status === "error";
  const turnId = firstObjectString(input, ["turn_id", "message_id"]);
  const label = claudeSurfaceLabel(input);
  const tool = firstObjectString(input, ["tool_name"]);
  const message =
    event === "UserPromptSubmit"
      ? `${label} is thinking`
      : event === "UserPromptExpansion"
        ? `${label} is expanding the prompt`
      : event === "MessageDisplay"
        ? claudeMessageDisplayText(input) ?? `${label} is responding`
      : event === "PreToolUse"
        ? tool
          ? `${label} is using ${tool}`
          : `${label} is using a tool`
      : event === "PostToolUse" || event === "PostToolBatch"
        ? `${label} is reviewing tool results`
      : event === "SubagentStart"
        ? `${label} started a subagent`
      : event === "SubagentStop"
        ? `${label} is reviewing subagent results`
      : event === "TaskCreated"
        ? `${label} created a task`
      : event === "TaskCompleted"
        ? `${label} is reviewing task results`
      : event === "PermissionRequest"
        ? `${label} needs approval`
      : event === "Elicitation"
        ? `${label} needs input`
      : event === "Stop" || event === "TeammateIdle"
        ? `${label} turn complete`
      : event === "PostToolUseFailure"
        ? tool
          ? `${label} is reading ${tool} failure`
          : `${label} is reading failed tool results`
      : event === "StopFailure"
        ? `${label} turn failed`
      : event === "SessionEnd"
        ? `${label} session ended`
      : `${label} ${event}`;
  const payload = {
    agent: "claude-code",
    sessionId,
    rewardId: terminal
      ? `claude-code:${sessionId}:${turnId ?? timestamp}`
      : undefined,
    status,
    phase,
    task: message,
    summary: message,
    progress: status === "complete" ? 100 : status === "idle" ? 0 : 50,
    message,
    severity:
      status === "error" ? "error" : status === "waiting_for_user" ? "warning" : "info",
    timestamp,
    usage,
    idleBubbleCandidates: claudeIdleBubbles(input),
  };
  return normalizeStatus(payload);
};

const statusLineLabel = (status) => {
  const total = Number(status?.usage?.totalTokens);
  const window = Number(status?.usage?.modelContextWindow);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(window) && window > 0) {
    return `Aivatar ${Math.round((total / window) * 100)}% ctx`;
  }
  return "Aivatar linked";
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

const allowedCorsOrigin = (origin) => {
  if (typeof origin !== "string" || !origin.trim()) return "";
  try {
    const parsed = new URL(origin);
    const hasOriginOnlyPath =
      (parsed.pathname === "" || parsed.pathname === "/") &&
      parsed.search === "" &&
      parsed.hash === "";
    if (parsed.protocol === "tauri:" && parsed.hostname === "localhost" && hasOriginOnlyPath) {
      return "tauri://localhost";
    }
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      hasOriginOnlyPath &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "tauri.localhost")
    ) {
      return parsed.origin;
    }
  } catch {
    return "";
  }
  return "";
};

const sendJson = (response, statusCode, payload) => {
  const corsOrigin = response.aivatarCorsOrigin;
  const corsHeaders = corsOrigin
    ? {
        "access-control-allow-origin": corsOrigin,
        vary: "Origin",
      }
    : {};
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    ...corsHeaders,
  });
  response.end(statusCode === 204 ? "" : JSON.stringify(payload));
};

const roomTimestampMs = (value) => {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const roomVisitNowIso = () => new Date().toISOString();

const roomVisitSnapshot = () => {
  pruneRoomsAndVisits();
  return {
    type: "aivatar.rooms.snapshot",
    rooms: [...rooms.values()].sort((left, right) => {
      const leftIndex = Number(left.slotIndex ?? 0);
      const rightIndex = Number(right.slotIndex ?? 0);
      return leftIndex - rightIndex || String(left.avatarName ?? "").localeCompare(String(right.avatarName ?? ""));
    }),
    visits: [...visits.values()],
    timestamp: roomVisitNowIso(),
  };
};

const normalizeRoomBody = async (request, requiredKey) => {
  const body = await readBody(request);
  if (!body.trim()) {
    throw new Error("Room payload must be a JSON object");
  }

  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Room payload must be a JSON object");
  }
  if (requiredKey && typeof parsed[requiredKey] !== "string") {
    throw new Error(`Room payload requires ${requiredKey}`);
  }
  return parsed;
};

const finishVisitForMissingRoom = (visit, missingRoomInstanceId) => ({
  ...visit,
  phase: "cancelled",
  cancelReason: "room expired",
  updatedAt: roomVisitNowIso(),
  expiresAt: new Date(Date.now() + roomFinishedVisitTtlMs).toISOString(),
  missingRoomInstanceId,
});

function pruneRoomsAndVisits() {
  const now = Date.now();
  const missingRooms = new Set();

  for (const [key, room] of rooms) {
    const expiresAt = roomTimestampMs(room.expiresAt);
    if (expiresAt > 0 && expiresAt <= now) {
      rooms.delete(key);
      missingRooms.add(key);
    }
  }

  for (const [key, visit] of visits) {
    const phase = String(visit.phase ?? "");
    const expiresAt = roomTimestampMs(visit.expiresAt);
    const hostRoomId = visit.host?.roomInstanceId;
    const guestRoomId = visit.guest?.roomInstanceId;
    const relatedRoomExpired =
      missingRooms.has(hostRoomId) || missingRooms.has(guestRoomId);

    if (
      phase !== "ended" &&
      phase !== "cancelled" &&
      (relatedRoomExpired || (expiresAt > 0 && expiresAt <= now))
    ) {
      visits.set(
        key,
        finishVisitForMissingRoom(
          visit,
          relatedRoomExpired
            ? missingRooms.has(hostRoomId)
              ? hostRoomId
              : guestRoomId
            : undefined,
        ),
      );
      continue;
    }

    if (
      (phase === "ended" || phase === "cancelled") &&
      expiresAt > 0 &&
      expiresAt + roomFinishedVisitTtlMs <= now
    ) {
      visits.delete(key);
    }
  }
}

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
  const requestOrigin = request.headers.origin;
  if (requestOrigin && !allowedCorsOrigin(requestOrigin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(request, socket, head, (websocket) => {
    wsServer.emit("connection", websocket, request);
  });
});

const httpServer = http.createServer(async (request, response) => {
  const requestOrigin = request.headers.origin;
  const corsOrigin = allowedCorsOrigin(requestOrigin);
  response.aivatarCorsOrigin = corsOrigin;
  if (requestOrigin && !corsOrigin) {
    sendJson(response, 403, { error: "Origin not allowed" });
    return;
  }

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
      paintingPlanHttp: `http://127.0.0.1:${httpPort}${paintingPlanPath}`,
      socialDialogueHttp: `http://127.0.0.1:${httpPort}${socialDialoguePath}`,
      roomsHttp: `http://127.0.0.1:${httpPort}${roomsPath}`,
      visitInviteHttp: `http://127.0.0.1:${httpPort}${visitInvitePath}`,
      visitStateHttp: `http://127.0.0.1:${httpPort}${visitStatePath}`,
      visitEndHttp: `http://127.0.0.1:${httpPort}${visitEndPath}`,
      claudeHookHttp: `http://127.0.0.1:${httpPort}${claudeHookPath}`,
      claudeStatusLineHookHttp: `http://127.0.0.1:${httpPort}${claudeStatusLineHookPath}`,
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

  if (request.url === roomsPath && request.method === "GET") {
    sendJson(response, 200, roomVisitSnapshot());
    return;
  }

  if (request.url === roomsPath && request.method === "POST") {
    try {
      const room = await normalizeRoomBody(request, "roomInstanceId");
      rooms.set(room.roomInstanceId, {
        ...room,
        type: "aivatar.room.presence",
        updatedAt:
          typeof room.updatedAt === "string" ? room.updatedAt : roomVisitNowIso(),
      });
      sendJson(response, 202, roomVisitSnapshot());
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid room payload",
      });
    }
    return;
  }

  if (request.url === visitInvitePath && request.method === "POST") {
    try {
      const visit = await normalizeRoomBody(request, "visitId");
      visits.set(visit.visitId, {
        ...visit,
        type: "aivatar.room.visit",
        phase: "invited",
        updatedAt:
          typeof visit.updatedAt === "string" ? visit.updatedAt : roomVisitNowIso(),
      });
      sendJson(response, 202, roomVisitSnapshot());
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid visit invite payload",
      });
    }
    return;
  }

  if (request.url === visitStatePath && request.method === "POST") {
    try {
      const visit = await normalizeRoomBody(request, "visitId");
      const existing = visits.get(visit.visitId) ?? {};
      visits.set(visit.visitId, {
        ...existing,
        ...visit,
        type: "aivatar.room.visit",
        updatedAt:
          typeof visit.updatedAt === "string" ? visit.updatedAt : roomVisitNowIso(),
      });
      sendJson(response, 202, roomVisitSnapshot());
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid visit state payload",
      });
    }
    return;
  }

  if (request.url === visitEndPath && request.method === "POST") {
    try {
      const visit = await normalizeRoomBody(request, "visitId");
      const existing = visits.get(visit.visitId) ?? {};
      visits.set(visit.visitId, {
        ...existing,
        ...visit,
        type: "aivatar.room.visit",
        phase:
          visit.phase === "cancelled" || visit.phase === "ended"
            ? visit.phase
            : "ended",
        updatedAt:
          typeof visit.updatedAt === "string" ? visit.updatedAt : roomVisitNowIso(),
        expiresAt:
          typeof visit.expiresAt === "string"
            ? visit.expiresAt
            : new Date(Date.now() + roomFinishedVisitTtlMs).toISOString(),
      });
      sendJson(response, 202, roomVisitSnapshot());
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid visit end payload",
      });
    }
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

  if (request.url === paintingPlanPath && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = normalizePaintingPlanRequest(JSON.parse(body));
      const paintingPlan = await runPaintingWorker(payload);
      sendJson(response, 200, {
        ok: true,
        paintingPlan,
      });
    } catch (error) {
      sendJson(response, 400, {
        error:
          error instanceof Error ? error.message : "Invalid painting plan payload",
      });
    }
    return;
  }

  if (request.url === socialDialoguePath && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = normalizeSocialDialogueRequest(JSON.parse(body));
      const dialogue = await runSocialDialogueWorker(payload);
      sendJson(response, 200, {
        ok: true,
        dialogue,
      });
    } catch (error) {
      sendJson(response, 400, {
        error:
          error instanceof Error ? error.message : "Invalid social dialogue payload",
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
    (request.url === claudeHookPath ||
      request.url === claudeStatusLineHookPath) &&
    request.method === "POST"
  ) {
    try {
      const body = await readBody(request);
      const input = JSON.parse(body);
      const nextStatus = normalizeClaudeHookStatus(
        input,
        request.url === claudeStatusLineHookPath,
      );
      const key = sessionKey(nextStatus);
      if (isSessionTombstoned(key)) {
        sendJson(response, 202, {
          ...makeSnapshot(),
          ignored: true,
          disconnectedSessionKey: key,
        });
        return;
      }
      const statusLine = request.url === claudeStatusLineHookPath;
      const event = claudeEventName(input, statusLine);
      if (event === "UserPromptSubmit") {
        claudeLastLearningKeys.delete(nextStatus.sessionId);
      }
      if (!statusLine) {
        const entry = claudeDigestEntry(input);
        if (entry) addClaudeDigest(nextStatus.sessionId, entry);
      }
      const existing = sessions.get(key);
      if (!existing && isClaudeLifecycleOnlyIdleStatus(nextStatus)) {
        sendJson(response, 202, {
          ...makeSnapshot(),
          ignored: true,
          ignoredLifecycleOnly: true,
          ignoredSessionKey: key,
        });
        return;
      }
      let effectiveStatus = preserveClaudeSessionEndStatus(
        event,
        nextStatus,
        existing,
      );
      if (
        existing &&
        isTerminalSessionStatus(existing) &&
        isTerminalSessionStatus(effectiveStatus) &&
        event !== "UserPromptSubmit"
      ) {
        effectiveStatus = {
          ...existing,
          presenceTimestamp:
            effectiveStatus.presenceTimestamp ?? existing.presenceTimestamp,
          idleBubbleCandidates:
            effectiveStatus.idleBubbleCandidates ?? existing.idleBubbleCandidates,
          learning: effectiveStatus.learning ?? existing.learning,
        };
      }
      const terminal =
        event !== "SessionEnd" &&
        (effectiveStatus.status === "complete" ||
          effectiveStatus.status === "error");
      const digest = terminal ? takeClaudeDigest(effectiveStatus.sessionId) : [];
      const learningKey =
        firstObjectString(input, ["turn_id", "message_id"]) ??
        `${effectiveStatus.sessionId}:${event}`;
      const fallbackLearning = terminal
        ? claudeLearningForStatus(effectiveStatus, input)
        : undefined;
      currentStatus =
        effectiveStatus.phase === "context-window" && existing
          ? {
              ...existing,
              presenceTimestamp:
                effectiveStatus.presenceTimestamp ?? existing.presenceTimestamp,
              usage: effectiveStatus.usage ?? existing.usage,
              idleBubbleCandidates:
                effectiveStatus.idleBubbleCandidates ?? existing.idleBubbleCandidates,
              learning: effectiveStatus.learning ?? existing.learning,
            }
          : {
              ...effectiveStatus,
              presenceTimestamp:
                effectiveStatus.presenceTimestamp ?? existing?.presenceTimestamp,
              usage: effectiveStatus.usage ?? existing?.usage,
              idleBubbleCandidates:
                effectiveStatus.idleBubbleCandidates ?? existing?.idleBubbleCandidates,
              learning: effectiveStatus.learning ?? existing?.learning,
            };
      currentStatus = withSessionExpiry(currentStatus);
      sessions.set(key, currentStatus);
      pruneSessionOverflow();
      let snapshot = makeSnapshot();
      if (
        terminal &&
        learningEnabled &&
        markClaudeLearningKey(effectiveStatus.sessionId, learningKey) &&
        !(await spawnClaudeLearningWorker(effectiveStatus, digest)) &&
        fallbackLearning
      ) {
        const learningStatus = normalizeStatus(
          sessionLearningStatus(effectiveStatus, fallbackLearning),
        );
        currentStatus = withSessionExpiry({
          ...currentStatus,
          presenceTimestamp:
            learningStatus.presenceTimestamp ?? currentStatus.presenceTimestamp,
          idleBubbleCandidates:
            learningStatus.idleBubbleCandidates ?? currentStatus.idleBubbleCandidates,
          learning: learningStatus.learning ?? currentStatus.learning,
        });
        sessions.set(sessionKey(currentStatus), currentStatus);
        pruneSessionOverflow();
        snapshot = makeSnapshot();
      }
      broadcast(snapshot);
      sendJson(response, 200, {
        ...snapshot,
        ...(request.url === claudeStatusLineHookPath
          ? { label: statusLineLabel(currentStatus) }
          : {}),
      });
    } catch (error) {
      sendJson(response, 400, {
        error:
          error instanceof Error ? error.message : "Invalid Claude hook payload",
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
      const aliasKey = claudeDesktopAliasKey(nextStatus, key);
      const existing = bestExistingStatus(
        sessions.get(key),
        aliasKey ? sessions.get(aliasKey) : undefined,
      );
      if (!existing && isClaudeLifecycleOnlyIdleStatus(nextStatus)) {
        sendJson(response, 202, {
          ...makeSnapshot(),
          ignored: true,
          ignoredLifecycleOnly: true,
          ignoredSessionKey: key,
        });
        return;
      }
      currentStatus = nextStatus.phase === "session-learning" && existing
        ? {
            ...existing,
            presenceTimestamp:
              nextStatus.presenceTimestamp ?? existing.presenceTimestamp,
            idleBubbleCandidates:
              nextStatus.idleBubbleCandidates ?? existing.idleBubbleCandidates,
            learning: nextStatus.learning ?? existing.learning,
          }
        : isClaudeDesktopInventoryStatus(nextStatus)
        ? mergeClaudeDesktopInventoryStatus(nextStatus, existing)
        : {
            ...nextStatus,
            presenceTimestamp:
              nextStatus.presenceTimestamp ?? existing?.presenceTimestamp,
            usage: nextStatus.usage ?? existing?.usage,
            idleBubbleCandidates:
              nextStatus.idleBubbleCandidates ?? existing?.idleBubbleCandidates,
            learning: nextStatus.learning ?? existing?.learning,
          };
      if (aliasKey && aliasKey !== key) {
        currentStatus = canonicalizeClaudeDesktopAliasStatus(
          currentStatus,
          nextStatus,
        );
        sessions.delete(aliasKey);
        if (activeSessionKey === aliasKey) activeSessionKey = key;
      }
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
  console.log(`Aivatar painting plan: http://127.0.0.1:${httpPort}${paintingPlanPath}`);
  console.log(`Aivatar social dialogue: http://127.0.0.1:${httpPort}${socialDialoguePath}`);
  console.log(`Aivatar rooms: http://127.0.0.1:${httpPort}${roomsPath}`);
  console.log(`Aivatar visits invite: http://127.0.0.1:${httpPort}${visitInvitePath}`);
  console.log(`Aivatar visits state: http://127.0.0.1:${httpPort}${visitStatePath}`);
  console.log(`Aivatar visits end: http://127.0.0.1:${httpPort}${visitEndPath}`);
  console.log(`Aivatar Claude hook: http://127.0.0.1:${httpPort}${claudeHookPath}`);
  console.log(
    `Aivatar Claude statusLine hook: http://127.0.0.1:${httpPort}${claudeStatusLineHookPath}`,
  );
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
