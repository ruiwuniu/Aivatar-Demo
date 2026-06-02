#!/usr/bin/env node
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const endpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const activeEndpoint =
  process.env.AIVATAR_ACTIVE_ENDPOINT ?? "http://127.0.0.1:38988/agent-active";

const parseArgs = (argv) => {
  const options = {
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId:
      process.env.AIVATAR_SESSION_ID ??
      process.env.CODEX_THREAD_ID ??
      process.env.CODEX_SESSION_ID ??
      "aivatar-cli-session",
    message: "CLI disconnected from Aivatar",
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

  if (rest.length > 0) options.message = rest.join(" ");
  return options;
};

const safeName = (value) => value.replace(/[^a-zA-Z0-9_.-]/g, "_");
const pidFileFor = (options) =>
  join(
    tmpdir(),
    "aivatar-cli-session",
    `${safeName(options.agent)}-${safeName(options.sessionId)}.json`,
  );

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

const readExistingSessionStatus = async (url, options) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const snapshot = await response.json();
    const key = `${options.agent}:${options.sessionId}`;
    const session = Array.isArray(snapshot?.sessions)
      ? snapshot.sessions.find(
          (candidate) =>
            `${candidate?.agent ?? "agent"}:${candidate?.sessionId ?? "default"}` === key,
        )
      : undefined;
    return typeof session?.status === "string" ? session.status : undefined;
  } catch {
    return undefined;
  }
};

const stopRecordedProcess = async (pidFile) => {
  try {
    const record = JSON.parse(await readFile(pidFile, "utf8"));
    for (const pid of [record?.heartbeatPid, record?.watcherPid, record?.watchdogPid]) {
      if (!Number.isInteger(pid)) continue;
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already stopped.
      }
    }
    await rm(pidFile, { force: true });
    return record;
  } catch {
    return null;
  }
};

const options = parseArgs(process.argv.slice(2));
const pidFile = pidFileFor(options);
const record = await stopRecordedProcess(pidFile);
const existingStatus = await readExistingSessionStatus(endpoint, options);
const preserveTerminal =
  existingStatus === "complete" || existingStatus === "error";

try {
  if (!preserveTerminal) {
    await postJson(endpoint, {
      agent: options.agent,
      sessionId: options.sessionId,
      status: "idle",
      phase: "idle",
      task: options.message,
      summary: options.message,
      progress: 0,
      message: options.message,
      severity: "info",
      timestamp: new Date().toISOString(),
    });
  }
  await postJson(activeEndpoint, {
    clear: true,
    agent: options.agent,
    sessionId: options.sessionId,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[aivatar-cli-disconnect] Aivatar bridge unavailable: ${message}`);
}

console.log(
  `[aivatar-cli-disconnect] ${options.agent}/${options.sessionId} disconnected${
    record ? "" : " (no recorded background process)"
  }`,
);
