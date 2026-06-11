#!/usr/bin/env node
import { ensureUsageBaseline } from "./codex-usage.mjs";

const endpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";

const agent = process.env.AIVATAR_AGENT ?? "codex";
const sessionId =
  process.env.AIVATAR_SESSION_ID ??
  process.env.CODEX_THREAD_ID ??
  process.env.CODEX_SESSION_ID;

if (!sessionId) {
  process.exit(0);
}

const payload = {
  agent,
  sessionId,
  status: "thinking",
  phase: "tool-result",
  task: "Reading tool results",
  summary: "Reading tool results",
  progress: 65,
  message: "Reading tool results",
  severity: "info",
  timestamp: new Date().toISOString(),
};

try {
  await ensureUsageBaseline(sessionId, { status: "thinking" });
  await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
} catch {
  // Hooks should never break Codex work if Aivatar is not running.
}
