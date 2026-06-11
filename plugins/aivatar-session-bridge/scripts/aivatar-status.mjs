#!/usr/bin/env node
import {
  clearUsageBaseline,
  ensureUsageBaseline,
  getUsageDelta,
  toAivatarUsage,
} from "./codex-usage.mjs";

const endpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const activeEndpoint =
  process.env.AIVATAR_ACTIVE_ENDPOINT ?? "http://127.0.0.1:38988/agent-active";

const allowedStatuses = new Set([
  "idle",
  "thinking",
  "executing",
  "waiting_for_user",
  "error",
  "complete",
]);

const parseArgs = (argv) => {
  const options = {
    agent: process.env.AIVATAR_AGENT ?? "codex",
    sessionId:
      process.env.AIVATAR_SESSION_ID ??
      process.env.CODEX_THREAD_ID ??
      process.env.CODEX_SESSION_ID ??
      "codex-session",
    active: false,
    clearActive: false,
    progress: undefined,
    status: "idle",
    message: "",
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
    if (value === "--active") {
      options.active = true;
      continue;
    }
    if (value === "--clear-active") {
      options.clearActive = true;
      continue;
    }
    if (value === "--progress") {
      const progress = Number(argv[index + 1]);
      options.progress = Number.isFinite(progress) ? progress : undefined;
      index += 1;
      continue;
    }
    rest.push(value);
  }

  if (rest[0]) {
    options.status = rest[0];
    options.message = rest.slice(1).join(" ");
  }

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

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }

  return text ? JSON.parse(text) : {};
};

const options = parseArgs(process.argv.slice(2));

try {
  if (options.clearActive) {
    if (options.agent === "codex") {
      await clearUsageBaseline(options.sessionId);
    }
    const result = await postJson(activeEndpoint, {
      clear: true,
      agent: options.agent,
      sessionId: options.sessionId,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (!allowedStatuses.has(options.status)) {
    console.error(`Unsupported status: ${options.status}`);
    process.exit(1);
  }

  const isWaitingStatus = options.status === "waiting_for_user";
  const message =
    options.message ||
    `${options.agent}/${options.sessionId} ${options.status.replace(/_/g, " ")}`;
  let usage = null;

  if (options.agent === "codex") {
    if (options.status === "complete" || options.status === "error") {
      usage = toAivatarUsage(
        await getUsageDelta(options.sessionId, { clearBaseline: true }),
      );
    } else if (options.status === "idle") {
      await clearUsageBaseline(options.sessionId);
    } else {
      await ensureUsageBaseline(options.sessionId, {
        reset: options.status === "thinking",
        status: options.status,
      });
      usage = toAivatarUsage(await getUsageDelta(options.sessionId));
    }
  }

  const payload = {
    agent: options.agent,
    sessionId: options.sessionId,
    status: options.status,
    phase: options.status,
    task: message,
    summary: message,
    progress:
      options.progress ??
      (options.status === "complete" ? 100 : options.status === "idle" ? 0 : 50),
    message,
    severity:
      options.status === "error" ? "error" : isWaitingStatus ? "warning" : "info",
    timestamp: new Date().toISOString(),
    ...(usage ? { usage } : {}),
  };

  let result = await postJson(endpoint, payload);

  if (options.active) {
    result = await postJson(activeEndpoint, {
      agent: options.agent,
      sessionId: options.sessionId,
    });
  }

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[aivatar-session-bridge] Aivatar bridge unavailable: ${message}`);
}
