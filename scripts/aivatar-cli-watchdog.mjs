#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const parseArgs = (argv) => {
  const options = {
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId:
      process.env.AIVATAR_SESSION_ID ??
      process.env.CODEX_THREAD_ID ??
      process.env.CODEX_SESSION_ID ??
      "aivatar-cli-session",
    parentPid: undefined,
    intervalMs: 5000,
  };

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
    if (value === "--parent-pid") {
      const pid = Number(argv[index + 1]);
      options.parentPid = Number.isInteger(pid) ? pid : undefined;
      index += 1;
      continue;
    }
    if (value === "--interval-ms") {
      const intervalMs = Number(argv[index + 1]);
      options.intervalMs = Number.isFinite(intervalMs)
        ? Math.max(1000, intervalMs)
        : options.intervalMs;
      index += 1;
    }
  }

  return options;
};

const isProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const runDisconnect = (options) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        join(scriptDir, "aivatar-cli-disconnect.mjs"),
        "--agent",
        options.agent,
        "--session",
        options.sessionId,
        "CLI window closed",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "ignore",
      },
    );
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });

const options = parseArgs(process.argv.slice(2));

if (!options.parentPid) {
  console.error("[aivatar-cli-watchdog] --parent-pid is required");
  process.exit(1);
}

while (isProcessAlive(options.parentPid)) {
  await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
}

await runDisconnect(options);
