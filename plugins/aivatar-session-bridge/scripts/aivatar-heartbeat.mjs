#!/usr/bin/env node
const presenceEndpoint =
  process.env.AIVATAR_PRESENCE_ENDPOINT ?? "http://127.0.0.1:38988/agent-presence";
const activeEndpoint =
  process.env.AIVATAR_ACTIVE_ENDPOINT ?? "http://127.0.0.1:38988/agent-active";

const parseArgs = (argv) => {
  const envSessionId =
    process.env.AIVATAR_SESSION_ID ??
    process.env.CODEX_THREAD_ID ??
    process.env.CODEX_SESSION_ID ??
    "";
  const options = {
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId: envSessionId,
    hasExplicitSessionId: Boolean(envSessionId),
    intervalMs: Number(process.env.AIVATAR_HEARTBEAT_MS ?? 30000),
    active: false,
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
      options.hasExplicitSessionId = Boolean(options.sessionId);
      index += 1;
      continue;
    }
    if (value === "--interval-ms") {
      const intervalMs = Number(argv[index + 1]);
      options.intervalMs = Number.isFinite(intervalMs) ? intervalMs : options.intervalMs;
      index += 1;
      continue;
    }
    if (value === "--active") {
      options.active = true;
    }
    if (value === "--no-active") {
      options.active = false;
    }
  }

  options.intervalMs = Math.max(5000, options.intervalMs);
  return options;
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

  const text = await response.text();
  return text ? JSON.parse(text) : {};
};

const options = parseArgs(process.argv.slice(2));
if (!options.hasExplicitSessionId) {
  console.error(
    "[aivatar-heartbeat] Refusing to start without a session id. Use aivatar-connect, or pass --session SESSION_ID.",
  );
  process.exit(1);
}

let stopped = false;
let warned = false;

const payload = () => ({
  agent: options.agent,
  sessionId: options.sessionId,
  timestamp: new Date().toISOString(),
});

const sendHeartbeat = async () => {
  try {
    if (options.active) {
      await postJson(activeEndpoint, {
        agent: options.agent,
        sessionId: options.sessionId,
      });
    }
    await postJson(presenceEndpoint, payload());
    warned = false;
  } catch (error) {
    if (!warned) {
      warned = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[aivatar-heartbeat] Aivatar bridge unavailable: ${message}`);
    }
  }
};

process.on("SIGINT", () => {
  stopped = true;
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopped = true;
  process.exit(143);
});

console.log(
  `[aivatar-heartbeat] ${options.agent}/${options.sessionId} every ${options.intervalMs}ms`,
);
await sendHeartbeat();

while (!stopped) {
  await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  await sendHeartbeat();
}
