#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { accessSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";

const endpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const activeEndpoint =
  process.env.AIVATAR_ACTIVE_ENDPOINT ?? "http://127.0.0.1:38988/agent-active";
const presenceEndpoint =
  process.env.AIVATAR_PRESENCE_ENDPOINT ?? "http://127.0.0.1:38988/agent-presence";
const defaultPluginRoot = "C:\\Users\\rniu\\plugins\\aivatar-session-bridge";
const pluginRoot = process.env.AIVATAR_SESSION_PLUGIN_ROOT ?? defaultPluginRoot;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const heartbeatScript = join(pluginRoot, "scripts", "aivatar-heartbeat.mjs");
const watcherScript = join(pluginRoot, "scripts", "aivatar-watch.mjs");
const watchdogScript = join(scriptDir, "aivatar-cli-watchdog.mjs");
const usageBaselinePath =
  process.env.AIVATAR_USAGE_BASELINE_PATH ??
  join(tmpdir(), "aivatar-usage-baselines.json");

const parseArgs = (argv) => {
  const options = {
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId:
      process.env.AIVATAR_SESSION_ID ??
      process.env.CODEX_THREAD_ID ??
      process.env.CODEX_SESSION_ID ??
      "aivatar-cli-session",
    message: "CLI connected to Aivatar",
    watch: true,
    watchParentPid: undefined,
    watchDisabledReason: undefined,
    initialStatus: "thinking",
  };
  const rest = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--agent") {
      options.agent = argv[index + 1] ?? options.agent;
      index += 1;
      continue;
    }
    if (value === "--session" || value === "--session-id") {
      options.sessionId = argv[index + 1] ?? options.sessionId;
      index += 1;
      continue;
    }
    if (value === "--no-watch") {
      options.watch = false;
      continue;
    }
    if (value === "--watch-parent-pid") {
      const pid = Number(argv[index + 1]);
      options.watchParentPid = Number.isInteger(pid) ? pid : undefined;
      index += 1;
      continue;
    }
    if (value === "--watch-disabled-reason") {
      options.watchDisabledReason = argv[index + 1] ?? options.watchDisabledReason;
      index += 1;
      continue;
    }
    if (value === "--initial-status") {
      options.initialStatus = argv[index + 1] ?? options.initialStatus;
      index += 1;
      continue;
    }
    rest.push(value);
  }

  if (rest.length > 0) options.message = rest.join(" ");
  return options;
};

const safeName = (value) => value.replace(/[^a-zA-Z0-9_.-]/g, "_");
const pidDir = () => join(tmpdir(), "aivatar-cli-session");
const pidFileFor = (options) =>
  join(pidDir(), `${safeName(options.agent)}-${safeName(options.sessionId)}.json`);

const scriptExists = (path) => {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
};

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) throw new Error(await response.text());
  const text = await response.text();
  return text ? JSON.parse(text) : {};
};

const statusPayload = (options, status, message) => ({
  agent: options.agent,
  sessionId: options.sessionId,
  status,
  phase: status,
  task: message,
  summary: message,
  progress: status === "complete" ? 100 : status === "idle" ? 0 : 50,
  message,
  severity: status === "error" ? "error" : status === "waiting_for_user" ? "warning" : "info",
  timestamp: new Date().toISOString(),
});

const sendHeartbeat = async (options) => {
  await postJson(activeEndpoint, {
    agent: options.agent,
    sessionId: options.sessionId,
  });
  await postJson(presenceEndpoint, {
    agent: options.agent,
    sessionId: options.sessionId,
    timestamp: new Date().toISOString(),
  });
};

const stopRecordedProcess = async (pidFile) => {
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    for (const pid of [record?.heartbeatPid, record?.watcherPid]) {
      if (!Number.isInteger(pid)) continue;
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already stopped.
      }
    }
    await rm(pidFile, { force: true });
  } catch {
    // No previous process for this session.
  }
};

const childEnv = (options) => ({
  ...process.env,
  AIVATAR_AGENT: options.agent,
  AIVATAR_SESSION_ID: options.sessionId,
  AIVATAR_HTTP_ENDPOINT: endpoint,
  AIVATAR_ACTIVE_ENDPOINT: activeEndpoint,
  AIVATAR_PRESENCE_ENDPOINT: presenceEndpoint,
  AIVATAR_USAGE_BASELINE_PATH: usageBaselinePath,
});

const quotePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;

const spawnDetachedWindows = (args, env) => {
  const envAssignments = Object.entries(env)
    .filter(([key]) => key.startsWith("AIVATAR_"))
    .map(([key, value]) => `$env:${key} = ${quotePowerShell(value)}`);
  const command = [
    ...envAssignments,
    `$process = Start-Process -FilePath ${quotePowerShell(process.execPath)} -ArgumentList @(${args
      .map(quotePowerShell)
      .join(", ")}) -WindowStyle Hidden -PassThru`,
    "Write-Output $process.Id",
  ].join("; ");
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8" },
  ).trim();
  const pid = Number(output.split(/\r?\n/).pop());

  if (!Number.isInteger(pid)) {
    throw new Error(`Failed to start background process: ${output}`);
  }

  return { pid };
};

const spawnDetached = (args, env) => {
  if (process.platform === "win32") {
    return spawnDetachedWindows(args, env);
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  return child;
};

const argv = process.argv.slice(2);
const options = parseArgs(argv);
const pidFile = pidFileFor(options);
await mkdir(dirname(pidFile), { recursive: true });
await stopRecordedProcess(pidFile);

if (!scriptExists(heartbeatScript)) {
  console.error(`[aivatar-cli-connect] heartbeat script not found: ${heartbeatScript}`);
  process.exit(1);
}

await postJson(endpoint, statusPayload(options, options.initialStatus, options.message));
await sendHeartbeat(options);

const env = childEnv(options);
const heartbeat = spawnDetached([
  heartbeatScript,
  "--agent",
  options.agent,
  "--session",
  options.sessionId,
], env);

let watcher = null;
if (options.watch && scriptExists(watcherScript)) {
  watcher = spawnDetached([
    watcherScript,
    "--agent",
    options.agent,
    "--session",
    options.sessionId,
  ], env);
}

let watchdog = null;
if (options.watchParentPid && scriptExists(watchdogScript)) {
  watchdog = spawnDetached([
    watchdogScript,
    "--agent",
    options.agent,
    "--session",
    options.sessionId,
    "--parent-pid",
    String(options.watchParentPid),
  ], env);
}

await writeFile(
  pidFile,
  JSON.stringify(
    {
      agent: options.agent,
      sessionId: options.sessionId,
      heartbeatPid: heartbeat.pid,
      watcherPid: watcher?.pid ?? null,
      watchdogPid: watchdog?.pid ?? null,
      heartbeatScript,
      watcherScript: watcher ? watcherScript : null,
      watchdogScript: watchdog ? watchdogScript : null,
      usageBaselinePath,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

const watcherSummary = watcher
  ? `; watcher pid ${watcher.pid}`
  : options.watch
    ? "; watcher unavailable"
    : `; watcher disabled${
        options.watchDisabledReason ? ` (${options.watchDisabledReason})` : ""
      }`;

console.log(
  `[aivatar-cli-connect] ${options.agent}/${options.sessionId} connected; heartbeat pid ${heartbeat.pid}${watcherSummary}${
    watchdog ? `; watchdog pid ${watchdog.pid}` : ""
  }; baseline ${usageBaselinePath}`,
);
