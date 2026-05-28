#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

const usage = `Usage:
  node scripts/aivatar-connected-run.mjs [--agent name] [--session id] -- <command> [args...]
  node scripts/aivatar-connected-run.mjs --agent codex --new-session --expected-cwd <path> --verify-desktop-listing -- codex [args...]

Examples:
  npm.cmd run codex:connected
  npm.cmd run codex:connected -- --help
  node scripts/aivatar-connected-run.mjs --agent codex -- codex
`;

const parseInvocation = (argv) => {
  const options = {
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId: process.env.AIVATAR_SESSION_ID ?? undefined,
    hasExplicitSessionId: false,
    allowNewSession: false,
    expectedCwd: undefined,
    verifyDesktopListing: false,
    promptFile: undefined,
  };
  const delimiter = argv.indexOf("--");
  const optionArgs = delimiter >= 0 ? argv.slice(0, delimiter) : [];
  const commandArgs = delimiter >= 0 ? argv.slice(delimiter + 1) : argv;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const value = optionArgs[index];
    if (value === "--agent") {
      options.agent = optionArgs[index + 1] ?? options.agent;
      index += 1;
      continue;
    }
    if (value === "--session" || value === "--session-id") {
      options.sessionId = optionArgs[index + 1];
      options.hasExplicitSessionId = Boolean(options.sessionId);
      index += 1;
      continue;
    }
    if (value === "--new-session") {
      options.allowNewSession = true;
      continue;
    }
    if (value === "--expected-cwd") {
      options.expectedCwd = optionArgs[index + 1];
      index += 1;
      continue;
    }
    if (value === "--verify-desktop-listing") {
      options.verifyDesktopListing = true;
      continue;
    }
    if (value === "--prompt-file") {
      options.promptFile = optionArgs[index + 1];
      index += 1;
    }
  }

  return {
    options,
    commandArgs: commandArgs.filter(Boolean),
  };
};

const createSessionId = (agent) =>
  `${agent}-${Date.now().toString(36)}-${process.pid}`;

const quoteForCmd = (value) => {
  if (!/[\s&()^|<>"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
};

const createSpawnSpec = (commandArgs) => {
  const [command, ...args] = commandArgs;
  const normalizedCommand = basename(command ?? "")
    .toLowerCase()
    .replace(/\.(cmd|exe|bat)$/i, "");

  if (process.platform === "win32" && normalizedCommand === "codex") {
    const npmCodexCli = join(
      process.env.APPDATA ?? "",
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (existsSync(npmCodexCli)) {
      return { file: process.execPath, args: [npmCodexCli, ...args] };
    }
  }

  if (
    process.platform !== "win32" ||
    command.includes("\\") ||
    command.includes("/") ||
    /^[a-zA-Z]:/.test(command)
  ) {
    return { file: command, args };
  }

  return {
    file: "cmd.exe",
    args: ["/d", "/c", [quoteForCmd(command), ...args.map(quoteForCmd)].join(" ")],
  };
};

async function* walkFiles(root) {
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(path);
    } else {
      yield path;
    }
  }
}

const rolloutSessionId = (filePath) => {
  const match = basename(filePath).match(
    /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
  );
  return match?.[1] ?? null;
};

const codexSessionsRoot = () =>
  join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");

const normalizePathKey = (value) => {
  if (!value) return "";
  const withoutExtendedPrefix = value.replace(/^\\\\\?\\/u, "");
  return normalize(resolve(withoutExtendedPrefix)).replace(/[\\/]+$/u, "").toLowerCase();
};

const samePath = (left, right) => normalizePathKey(left) === normalizePathKey(right);

const readRolloutMetadata = async (filePath) => {
  const text = await readFile(filePath, "utf8");
  let sessionMeta = null;
  let turnContext = null;
  let lastTimestamp = null;

  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry.timestamp === "string") {
      lastTimestamp = entry.timestamp;
    }
    if (entry.type === "session_meta" && entry.payload && typeof entry.payload === "object") {
      sessionMeta = entry.payload;
    }
    if (entry.type === "turn_context" && entry.payload && typeof entry.payload === "object") {
      turnContext = entry.payload;
    }
  }

  return {
    cwd:
      (typeof sessionMeta?.cwd === "string" && sessionMeta.cwd) ||
      (typeof turnContext?.cwd === "string" && turnContext.cwd) ||
      null,
    originator: typeof sessionMeta?.originator === "string" ? sessionMeta.originator : null,
    source: typeof sessionMeta?.source === "string" ? sessionMeta.source : null,
    lastTimestamp,
  };
};

const writeRecoveryLog = async (details) => {
  const path = join(tmpdir(), `aivatar-new-session-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(details, null, 2), "utf8");
  return path;
};

const sendAppServerRequest = async (child, request) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out waiting for app-server response to ${request.id}`));
    }, 15000);

    const onData = (chunk) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/u)) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== request.id) continue;
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        if (settled) return;
        settled = true;
        if (message.error) {
          reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        } else {
          resolve(message.result);
        }
      }
    };

    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(request)}\n`);
  });

const verifyDesktopListing = async ({ sessionId, expectedCwd }) => {
  const child = spawn("codex.cmd", ["app-server"], {
    cwd: process.cwd(),
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stderr.resume();

  try {
    await sendAppServerRequest(child, {
      method: "initialize",
      id: "aivatar-initialize",
      params: {
        clientInfo: { name: "aivatar-new-session-verify", version: "0" },
        capabilities: null,
      },
    });
    const response = await sendAppServerRequest(child, {
      method: "thread/list",
      id: "aivatar-thread-list-cwd",
      params: {
        limit: 50,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        sourceKinds: [],
        cwd: expectedCwd,
      },
    });
    const data = Array.isArray(response?.data) ? response.data : [];
    const match = data.find((thread) => thread.id === sessionId);
    return {
      ok: Boolean(match),
      count: data.length,
      matchedThread: match
        ? {
            id: match.id,
            cwd: match.cwd,
            updatedAt: match.updatedAt,
            source: match.source,
          }
        : null,
      returnedThreadIds: data.map((thread) => thread.id).slice(0, 10),
    };
  } finally {
    child.kill();
  }
};

const waitForDesktopListing = async ({ sessionId, expectedCwd, timeoutMs = 30000 }) => {
  const deadline = Date.now() + timeoutMs;
  let lastResult = null;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      lastResult = await verifyDesktopListing({ sessionId, expectedCwd });
      lastError = null;
      if (lastResult.ok) return lastResult;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (lastError) throw lastError;
  return lastResult ?? { ok: false, count: 0, matchedThread: null, returnedThreadIds: [] };
};

const buildRecoveryDetails = ({ options, commandArgs, discovered, rolloutMetadata, checks }) => ({
  createdAt: new Date().toISOString(),
  command: commandArgs,
  expectedCwd: options.expectedCwd ?? null,
  oldEnv: {
    CODEX_THREAD_ID: process.env.CODEX_THREAD_ID ?? null,
    CODEX_SESSION_ID: process.env.CODEX_SESSION_ID ?? null,
    AIVATAR_SESSION_ID: process.env.AIVATAR_SESSION_ID ?? null,
  },
  discovered: discovered
    ? {
        sessionId: discovered.sessionId,
        rolloutPath: discovered.filePath,
        mtimeMs: discovered.mtimeMs,
      }
    : null,
  rolloutMetadata,
  checks,
});

const snapshotRolloutFiles = async () => {
  const files = new Set();
  for await (const filePath of walkFiles(codexSessionsRoot())) {
    if (filePath.endsWith(".jsonl") && rolloutSessionId(filePath)) {
      files.add(filePath);
    }
  }
  return files;
};

const findNewCodexRolloutSession = async (knownFiles, startedAtMs) => {
  let newest = null;

  for await (const filePath of walkFiles(codexSessionsRoot())) {
    const sessionId = rolloutSessionId(filePath);
    if (!sessionId || knownFiles.has(filePath)) continue;

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      continue;
    }
    if (fileStat.mtimeMs < startedAtMs - 2000) continue;
    if (!newest || fileStat.mtimeMs > newest.mtimeMs) {
      newest = { sessionId, mtimeMs: fileStat.mtimeMs, filePath };
    }
  }

  return newest;
};

const waitForNewCodexSession = async (knownFiles, startedAtMs, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await findNewCodexRolloutSession(knownFiles, startedAtMs);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
};

const commandName = (commandArgs) =>
  basename(commandArgs[0] ?? "").toLowerCase().replace(/\.(cmd|exe|bat)$/i, "");

const codexResumeSessionId = (commandArgs) => {
  if (commandName(commandArgs) !== "codex") return null;
  const resumeIndex = commandArgs.findIndex((arg) => arg === "resume");
  if (resumeIndex < 0) return null;
  const sessionId = commandArgs[resumeIndex + 1];
  return sessionId && !sessionId.startsWith("-") ? sessionId : null;
};

const shouldDiscoverCodexSession = (options, commandArgs) =>
  options.agent === "codex" &&
  options.allowNewSession &&
  !options.hasExplicitSessionId &&
  commandName(commandArgs) === "codex";

const commandEnv = (options) => {
  const env = {
    ...process.env,
    AIVATAR_AGENT: options.agent,
    AIVATAR_SESSION_ID: options.sessionId,
  };

  if (options.allowNewSession && !options.hasExplicitSessionId) {
    delete env.CODEX_THREAD_ID;
    delete env.CODEX_SESSION_ID;
  }

  return env;
};

const spawnCommand = (commandArgs, env = process.env) => {
  const spec = createSpawnSpec(commandArgs);
  return spawn(spec.file, spec.args, {
    cwd: process.cwd(),
    env,
    shell: false,
    stdio: "inherit",
  });
};

const waitForChild = (child) =>
  new Promise((resolve) => {
    child.on("error", (error) => {
      console.error(`[aivatar-connected-run] ${error.message}`);
      resolve(1);
    });

    child.on("close", (code, signal) => {
      if (signal) {
        resolve(signal === "SIGINT" ? 130 : 143);
        return;
      }
      resolve(code ?? 0);
    });
  });

const run = (commandArgs, env = process.env) => waitForChild(spawnCommand(commandArgs, env));

const runNodeScript = async (script, options, message, overrides = {}) => {
  const scriptPath = isAbsolute(script) ? script : join(scriptDir, basename(script));
  const args = [
    process.execPath,
    scriptPath,
    "--agent",
    options.agent,
    "--session",
    options.sessionId,
  ];
  if (script.endsWith("aivatar-cli-connect.mjs") && overrides.noWatch) {
    args.push("--no-watch");
  }
  if (script.endsWith("aivatar-cli-connect.mjs") && overrides.watchParentPid) {
    args.push("--watch-parent-pid", String(overrides.watchParentPid));
  }
  if (message) args.push(message);
  return run(args, {
    ...process.env,
    AIVATAR_AGENT: options.agent,
    AIVATAR_SESSION_ID: options.sessionId,
  });
};

const { options, commandArgs } = parseInvocation(process.argv.slice(2));

if (options.promptFile) {
  try {
    const prompt = await readFile(options.promptFile, "utf8");
    if (commandName(commandArgs) === "claude") {
      commandArgs.push("--", prompt);
    } else {
      commandArgs.push(prompt);
    }
  } catch (error) {
    console.error(
      `[aivatar-connected-run] Could not read prompt file ${options.promptFile}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

if (commandArgs.length === 0 || commandArgs[0] === "--help" || commandArgs[0] === "-h") {
  console.log(usage);
  process.exit(commandArgs.length === 0 ? 1 : 0);
}

const resumeSessionId = codexResumeSessionId(commandArgs);
if (!options.sessionId && resumeSessionId) {
  options.sessionId = resumeSessionId;
  options.hasExplicitSessionId = true;
}

if (
  options.agent === "codex" &&
  commandName(commandArgs) === "codex" &&
  !options.hasExplicitSessionId &&
  !options.allowNewSession
) {
  console.error(
    "[aivatar-connected-run] Refusing to start a detached Codex session. Use `codex resume <session-id>` or pass `--new-session` explicitly.",
  );
  process.exit(1);
}

options.sessionId = options.sessionId ?? createSessionId(options.agent);

let childExitCode = 1;
let disconnecting = false;
let connectedSessionId = options.sessionId;

const disconnect = async () => {
  if (disconnecting) return;
  disconnecting = true;
  await runNodeScript(
    "scripts/aivatar-cli-disconnect.mjs",
    { ...options, sessionId: connectedSessionId },
    "CLI disconnected",
  );
};

process.on("SIGINT", () => {
  void disconnect().finally(() => process.exit(130));
});

process.on("SIGTERM", () => {
  void disconnect().finally(() => process.exit(143));
});

const discoverCodexSession = shouldDiscoverCodexSession(options, commandArgs);
const knownRollouts = discoverCodexSession
  ? await snapshotRolloutFiles()
  : new Set();
const startedAtMs = Date.now();

const connectCode = await runNodeScript(
  "scripts/aivatar-cli-connect.mjs",
  options,
  `Running ${commandArgs.join(" ")}`,
  {
    noWatch: discoverCodexSession || options.agent !== "codex",
    watchParentPid: process.pid,
  },
);

if (connectCode !== 0) {
  process.exit(connectCode);
}

try {
  const child = spawnCommand(commandArgs, commandEnv(options));
  const childResult = waitForChild(child);

  if (discoverCodexSession) {
    const discovered = await waitForNewCodexSession(knownRollouts, startedAtMs);
    let rolloutMetadata = null;
    const checks = {
      rolloutDetected: Boolean(discovered),
      cwdMatched: null,
      desktopListingVerified: null,
    };

    if (!discovered) {
      const logPath = await writeRecoveryLog(
        buildRecoveryDetails({ options, commandArgs, discovered, rolloutMetadata, checks }),
      );
      console.error(
        `[aivatar-connected-run] Codex started, but no new rollout JSONL was detected. Recovery log: ${logPath}`,
      );
    } else {
      try {
        rolloutMetadata = await readRolloutMetadata(discovered.filePath);
      } catch (error) {
        rolloutMetadata = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (options.expectedCwd) {
        checks.cwdMatched = samePath(rolloutMetadata?.cwd, options.expectedCwd);
        if (!checks.cwdMatched) {
          const logPath = await writeRecoveryLog(
            buildRecoveryDetails({ options, commandArgs, discovered, rolloutMetadata, checks }),
          );
          console.error(
            `[aivatar-connected-run] New Codex rollout cwd did not match launcher cwd. Expected ${options.expectedCwd}; found ${rolloutMetadata?.cwd ?? "unknown"}. Not switching Aivatar to the suspicious session. Recovery log: ${logPath}`,
          );
        }
      }

      if (discovered.sessionId !== connectedSessionId && checks.cwdMatched !== false) {
        if (options.verifyDesktopListing && options.expectedCwd) {
          try {
            checks.desktopListingVerified = await waitForDesktopListing({
              sessionId: discovered.sessionId,
              expectedCwd: options.expectedCwd,
            });
            if (!checks.desktopListingVerified.ok) {
              const logPath = await writeRecoveryLog(
                buildRecoveryDetails({ options, commandArgs, discovered, rolloutMetadata, checks }),
              );
              console.warn(
                `[aivatar-connected-run] New Codex session was detected, but Desktop listing did not return it for ${options.expectedCwd}. Aivatar will still follow ${discovered.sessionId}. Recovery log: ${logPath}`,
              );
            }
          } catch (error) {
            checks.desktopListingVerified = {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
            const logPath = await writeRecoveryLog(
              buildRecoveryDetails({ options, commandArgs, discovered, rolloutMetadata, checks }),
            );
            console.warn(
              `[aivatar-connected-run] Could not verify Desktop listing for ${discovered.sessionId}. Aivatar will still follow it. Recovery log: ${logPath}`,
            );
          }
        }

        await runNodeScript(
          "scripts/aivatar-cli-disconnect.mjs",
          { ...options, sessionId: connectedSessionId },
          "Switching to Codex session",
        );
        connectedSessionId = discovered.sessionId;
        await runNodeScript(
          "scripts/aivatar-cli-connect.mjs",
          { ...options, sessionId: connectedSessionId },
          `Running ${commandArgs.join(" ")}`,
          { watchParentPid: process.pid },
        );
        console.log(
          `[aivatar-connected-run] Aivatar is following new Codex session ${connectedSessionId}.`,
        );
      }
    }
  }

  childExitCode = await childResult;
} finally {
  await disconnect();
}

process.exitCode = childExitCode;
