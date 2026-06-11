#!/usr/bin/env node
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const statusScript = join(scriptDir, "aivatar-status.mjs");

const parseArgs = (argv) => {
  const options = {
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId:
      process.env.AIVATAR_SESSION_ID ??
      process.env.CODEX_THREAD_ID ??
      process.env.CODEX_SESSION_ID ??
      "codex-session",
    message: "Disconnected from Aivatar",
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

const stopBackgroundProcess = async (pidFile, kind) => {
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    if (record?.pid) {
      try {
        process.kill(record.pid, "SIGTERM");
        console.log(`[aivatar-disconnect] stopped ${kind} pid ${record.pid}`);
      } catch {
        console.log(`[aivatar-disconnect] ${kind} was already stopped`);
      }
    }
    await rm(pidFile, { force: true });
  } catch {
    console.log(`[aivatar-disconnect] no recorded ${kind} for this session`);
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

await stopBackgroundProcess(heartbeatPidFile, "heartbeat");
await stopBackgroundProcess(watcherPidFile, "watcher");

await runNode([
  statusScript,
  "--agent",
  options.agent,
  "--session",
  options.sessionId,
  "idle",
  options.message,
]);

await runNode([
  statusScript,
  "--agent",
  options.agent,
  "--session",
  options.sessionId,
  "--clear-active",
]);

console.log(`[aivatar-disconnect] ${options.agent}/${options.sessionId} disconnected`);
