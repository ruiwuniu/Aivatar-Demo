#!/usr/bin/env node
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const statusScript = join(scriptDir, "aivatar-status.mjs");
const heartbeatScript = join(scriptDir, "aivatar-heartbeat.mjs");
const watcherScript = join(scriptDir, "aivatar-watch.mjs");
const execFileAsync = promisify(execFile);

const parseArgs = (argv) => {
  const options = {
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId:
      process.env.AIVATAR_SESSION_ID ??
      process.env.CODEX_THREAD_ID ??
      process.env.CODEX_SESSION_ID ??
      "codex-session",
    message: "Connected to Aivatar",
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
    rest.push(value);
  }

  if (rest.length > 0) {
    options.message = rest.join(" ");
  }

  return options;
};

const safeName = (value) => value.replace(/[^a-zA-Z0-9_.-]/g, "_");

const pidFileFor = (options, kind) =>
  join(
    tmpdir(),
    "aivatar-session-bridge",
    `${safeName(options.agent)}-${safeName(options.sessionId)}.${kind}.json`,
  );

const pidDirFor = () => join(tmpdir(), "aivatar-session-bridge");

const stopExistingProcess = async (pidFile) => {
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    if (record?.pid) {
      try {
        process.kill(record.pid, "SIGTERM");
      } catch {
        // Already stopped.
      }
    }
    await rm(pidFile, { force: true });
  } catch {
    // No recorded background process for this session.
  }
};

const parseBackgroundProcessLine = (line) => {
  const firstComma = line.indexOf(",");
  if (firstComma <= 0) return null;
  const pid = Number(line.slice(0, firstComma).trim());
  const commandLine = line.slice(firstComma + 1).trim();
  if (
    !Number.isInteger(pid) ||
    (!commandLine.includes("aivatar-heartbeat.mjs") &&
      !commandLine.includes("aivatar-watch.mjs"))
  ) {
    return null;
  }

  return { pid, commandLine };
};

const shellToken = (value) => `"${String(value).replaceAll('"', '\\"')}"`;

const commandLineMatchesSession = (commandLine, options) => {
  const commandLineLower = commandLine.toLowerCase();
  const agentNeedles = [
    `--agent ${options.agent}`,
    `--agent=${options.agent}`,
    `--agent ${shellToken(options.agent)}`,
  ].map((value) => value.toLowerCase());
  const sessionNeedles = [
    `--session ${options.sessionId}`,
    `--session-id ${options.sessionId}`,
    `--session=${options.sessionId}`,
    `--session-id=${options.sessionId}`,
    `--session ${shellToken(options.sessionId)}`,
    `--session-id ${shellToken(options.sessionId)}`,
  ].map((value) => value.toLowerCase());

  return (
    agentNeedles.some((needle) => commandLineLower.includes(needle)) &&
    sessionNeedles.some((needle) => commandLineLower.includes(needle))
  );
};

const stopOrphanBackgroundProcesses = async (options) => {
  if (process.platform !== "win32") return;

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("wmic", [
      "process",
      "where",
      "name='node.exe'",
      "get",
      "ProcessId,CommandLine",
      "/format:csv",
    ]));
  } catch {
    return;
  }

  const processes = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseBackgroundProcessLine)
    .filter(Boolean);

  for (const processInfo of processes) {
    if (processInfo.pid === process.pid) continue;
    if (!commandLineMatchesSession(processInfo.commandLine, options)) continue;

    try {
      process.kill(processInfo.pid, "SIGTERM");
      console.log(`[aivatar-connect] stopped old background pid ${processInfo.pid}`);
    } catch {
      // Already stopped.
    }
  }
};

const runNode = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command exited with code ${code}`));
    });
  });

const options = parseArgs(process.argv.slice(2));
const heartbeatPidFile = pidFileFor(options, "heartbeat");
const watcherPidFile = pidFileFor(options, "watcher");
const pidDir = pidDirFor();

await mkdir(pidDir, { recursive: true });
await stopExistingProcess(heartbeatPidFile);
await stopExistingProcess(watcherPidFile);
await stopOrphanBackgroundProcesses(options);

await runNode([
  statusScript,
  "--agent",
  options.agent,
  "--session",
  options.sessionId,
  "thinking",
  options.message,
  "--active",
]);

const heartbeat = spawn(
  process.execPath,
  [
    heartbeatScript,
    "--agent",
    options.agent,
    "--session",
    options.sessionId,
    "--no-active",
  ],
  {
    detached: true,
    stdio: "ignore",
    env: process.env,
  },
);
heartbeat.unref();

const watcher = spawn(
  process.execPath,
  [
    watcherScript,
    "--agent",
    options.agent,
    "--session",
    options.sessionId,
  ],
  {
    detached: true,
    stdio: "ignore",
    env: process.env,
  },
);
watcher.unref();

await writeFile(
  heartbeatPidFile,
  JSON.stringify(
    {
      pid: heartbeat.pid,
      kind: "heartbeat",
      agent: options.agent,
      sessionId: options.sessionId,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

await writeFile(
  watcherPidFile,
  JSON.stringify(
    {
      pid: watcher.pid,
      kind: "watcher",
      agent: options.agent,
      sessionId: options.sessionId,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log(
  `[aivatar-connect] ${options.agent}/${options.sessionId} connected; heartbeat pid ${heartbeat.pid}; watcher pid ${watcher.pid}`,
);
