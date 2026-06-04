import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const sessionsRoot = process.env.CODEX_SESSIONS_ROOT ?? join(codexHome, "sessions");
const pluginRoot =
  process.env.AIVATAR_SESSION_PLUGIN_ROOT ??
  "C:\\Users\\rniu\\plugins\\aivatar-session-bridge";
const heartbeatScript = join(pluginRoot, "scripts", "aivatar-heartbeat.mjs");
const watcherScript = join(pluginRoot, "scripts", "aivatar-watch.mjs");
const presenceEndpoint =
  process.env.AIVATAR_PRESENCE_ENDPOINT ?? "http://127.0.0.1:38988/agent-presence";
const statusEndpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
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
const activeWindowMs = Math.max(
  discoveryIntervalMs,
  Number(process.env.AIVATAR_DISCOVERY_ACTIVE_MS ?? 48 * 60 * 60 * 1000),
);
const pidDir = join(tmpdir(), "aivatar-session-discovery");
const pidFile = join(pidDir, "discovery.json");
const helperDir = join(pidDir, "helpers");

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

const processIsRunning = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
};

const postPresence = async (session) => {
  await postJson(presenceEndpoint, {
    agent: "codex",
    sessionId: session.sessionId,
    timestamp: new Date().toISOString(),
  });
};

const postDetectedStatus = async (session) => {
  await postJson(statusEndpoint, {
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

const spawnHelper = (script, session, extraEnv = {}) => {
  const child = spawn(
    process.execPath,
    [script, "--agent", "codex", "--session", session.sessionId],
    {
      detached: true,
      stdio: "ignore",
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
      for (const rollout of rollouts) {
        const session = await readSessionMeta(rollout.filePath);
        if (!session) continue;
        await postPresence(session);
        const startedHelpers = await ensureHelpers(session);
        if (startedHelpers) {
          await postDetectedStatus(session);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[codex-session-discovery] ${message}`);
    }
    await sleep(discoveryIntervalMs);
  }
} finally {
  await cleanup();
}
