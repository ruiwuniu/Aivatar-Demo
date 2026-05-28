const endpoint =
  process.env.AIVATAR_HTTP_ENDPOINT ?? "http://127.0.0.1:38988/agent-status";
const activeEndpoint =
  process.env.AIVATAR_ACTIVE_ENDPOINT ?? "http://127.0.0.1:38988/agent-active";

const parseArgs = (argv) => {
  const options = {
    agent: "codex",
    sessionId:
      process.env.AIVATAR_SESSION_ID ??
      process.env.CODEX_THREAD_ID ??
      process.env.CODEX_SESSION_ID ??
      undefined,
    active: false,
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
      options.sessionId = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--active") {
      options.active = true;
      continue;
    }
    rest.push(value);
  }

  return { options, rest };
};

const { options, rest } = parseArgs(process.argv.slice(2));
const status = rest[0] ?? "idle";
const message = rest.slice(1).join(" ");
const isWaitingStatus = [
  "waiting",
  "wait",
  "waiting_for_user",
  "waiting_for_input",
  "input_required",
  "needs_input",
  "user_input",
].includes(status);

const payload = {
  agent: options.agent,
  sessionId: options.sessionId,
  status,
  phase: status,
  task: message || `Manual ${status}`,
  summary: message || `Manual ${status}`,
  progress: status === "complete" ? 100 : status === "idle" ? 0 : 50,
  message: message || `Manual ${status}`,
  severity: status === "error" ? "error" : isWaitingStatus ? "warning" : "info",
  timestamp: new Date().toISOString(),
};

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify(payload),
});

const body = await response.text();

if (!response.ok) {
  console.error(body);
  process.exit(1);
}

if (options.active) {
  if (!options.sessionId) {
    console.error("--active requires a session id or AIVATAR_SESSION_ID/CODEX_THREAD_ID");
    process.exit(1);
  }

  const activeResponse = await fetch(activeEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      agent: options.agent,
      sessionId: options.sessionId,
    }),
  });
  const activeBody = await activeResponse.text();

  if (!activeResponse.ok) {
    console.error(activeBody);
    process.exit(1);
  }

  console.log(activeBody);
} else {
  console.log(body);
}
