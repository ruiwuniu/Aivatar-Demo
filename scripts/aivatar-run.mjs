import { spawn } from "node:child_process";
import process from "node:process";

const endpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const activeEndpoint =
  process.env.AIVATAR_ACTIVE_ENDPOINT ?? "http://127.0.0.1:38988/agent-active";
const presenceEndpoint =
  process.env.AIVATAR_PRESENCE_ENDPOINT ?? "http://127.0.0.1:38988/agent-presence";
const heartbeatIntervalMs = Math.max(
  5000,
  Number(process.env.AIVATAR_HEARTBEAT_MS ?? 30000),
);

const waitingPattern =
  /(waiting (for|on) (user|input|response)|awaiting (user|input|response)|input required|needs? (your )?(input|approval|confirmation)|approval required|approve|confirm|permission|do you want to|proceed\?|continue\?|press .+ to continue|yes\/no|y\/n|\[y\/n\]|\(y\/n\)|select .+ option|choose .+ option)/i;

const usage = `Usage:
  node scripts/aivatar-run.mjs [--agent name] [--session id] -- <command> [args...]
  npm.cmd run aivatar:run -- <command> [args...]

Examples:
  npm.cmd run aivatar:run -- codex
  npm.cmd run agent:run -- --agent claude-code -- claude
  npm.cmd run aivatar:run -- npm.cmd run build
  npm.cmd run aivatar:run -- node -e "console.log('hello')"
`;

const parseInvocation = (argv) => {
  const options = {
    agent: "command",
    sessionId:
      process.env.AIVATAR_SESSION_ID ??
      process.env.CODEX_THREAD_ID ??
      process.env.CODEX_SESSION_ID ??
      undefined,
    active: false,
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
      index += 1;
      continue;
    }
    if (value === "--active") {
      options.active = true;
    }
  }

  return {
    options,
    commandArgs: commandArgs.filter(Boolean),
  };
};

const { options, commandArgs } = parseInvocation(process.argv.slice(2));

const createSessionId = (agent) =>
  `${agent}-${Date.now().toString(36)}-${process.pid}`;

options.sessionId = options.sessionId ?? createSessionId(options.agent);

if (commandArgs.length === 0 || commandArgs[0] === "--help" || commandArgs[0] === "-h") {
  console.log(usage);
  process.exit(commandArgs.length === 0 ? 1 : 0);
}

const [command, ...args] = commandArgs;
const commandLabel = commandArgs.join(" ");
let warnedBridge = false;
let child = null;
let sentWaiting = false;
let heartbeatTimer = null;

const postStatus = async (status, message, overrides = {}) => {
  const payload = {
    agent: overrides.agent ?? options.agent,
    sessionId: overrides.sessionId ?? options.sessionId,
    status,
    phase: overrides.phase ?? status,
    task: commandLabel,
    summary: message,
    progress: overrides.progress,
    message,
    severity:
      overrides.severity ??
      (status === "error" ? "error" : status === "waiting_for_user" ? "warning" : "info"),
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
  } catch (error) {
    if (!warnedBridge) {
      warnedBridge = true;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[aivatar-run] status bridge unavailable: ${detail}`);
    }
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

  if (!response.ok) {
    throw new Error(await response.text());
  }
};

const sendPresence = async () => {
  try {
    if (options.active) {
      await postJson(activeEndpoint, {
        agent: options.agent,
        sessionId: options.sessionId,
      });
    }

    await postJson(presenceEndpoint, {
      agent: options.agent,
      sessionId: options.sessionId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (!warnedBridge) {
      warnedBridge = true;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[aivatar-run] status bridge unavailable: ${detail}`);
    }
  }
};

const startHeartbeat = async () => {
  await sendPresence();
  heartbeatTimer = setInterval(() => {
    void sendPresence();
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();
};

const stopHeartbeat = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

const watchOutput = (stream, target) => {
  stream.on("data", (chunk) => {
    target.write(chunk);

    if (!sentWaiting && waitingPattern.test(chunk.toString("utf8"))) {
      sentWaiting = true;
      void postStatus("waiting_for_user", `Waiting for user input: ${commandLabel}`, {
        progress: 50,
      });
    }
  });
};

const quoteForCmd = (value) => {
  if (!/[\s&()^|<>"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
};

const createSpawnSpec = () => {
  const needsCmd = process.platform === "win32";

  if (!needsCmd) {
    return {
      file: command,
      args,
    };
  }

  return {
    file: "cmd.exe",
    args: ["/d", "/c", [quoteForCmd(command), ...args.map(quoteForCmd)].join(" ")],
  };
};

const shutdown = async (signal) => {
  stopHeartbeat();
  await postStatus("error", `Interrupted by ${signal}: ${commandLabel}`, {
    severity: "error",
  });

  if (child && !child.killed) {
    child.kill(signal);
  }

  process.exit(signal === "SIGINT" ? 130 : 143);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await postStatus("thinking", `Preparing: ${commandLabel}`, { progress: 5 });
await startHeartbeat();

try {
  const spawnSpec = createSpawnSpec();
  const interactiveAgent =
    options.agent === "codex" || options.agent === "claude-code";
  child = spawn(spawnSpec.file, spawnSpec.args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: interactiveAgent ? "inherit" : ["inherit", "pipe", "pipe"],
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await postStatus("error", `Failed to start: ${message}`, {
    severity: "error",
  });
  console.error(`[aivatar-run] ${message}`);
  process.exit(1);
}

await postStatus("executing", `Running: ${commandLabel}`, { progress: 40 });

if (child.stdout) watchOutput(child.stdout, process.stdout);
if (child.stderr) watchOutput(child.stderr, process.stderr);

const exitCode = await new Promise((resolve) => {
  child.on("error", async (error) => {
    stopHeartbeat();
    await postStatus("error", `Failed to start: ${error.message}`, {
      severity: "error",
    });
    resolve(1);
  });

  child.on("close", async (code, signal) => {
    stopHeartbeat();

    if (signal) {
      await postStatus("error", `Stopped by ${signal}: ${commandLabel}`, {
        severity: "error",
      });
      resolve(1);
      return;
    }

    if (code === 0) {
      await postStatus("complete", `Finished: ${commandLabel}`, { progress: 100 });
      resolve(0);
      return;
    }

    await postStatus("error", `Exited with code ${code}: ${commandLabel}`, {
      severity: "error",
    });
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
