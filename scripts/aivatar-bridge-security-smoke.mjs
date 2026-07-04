import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import WebSocket from "ws";

const bridgeScript = fileURLToPath(new URL("./codex-status-bridge.mjs", import.meta.url));

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stopProcess = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let exited = false;
  const exitPromise = new Promise((resolve) => {
    child.once("exit", resolve);
  }).then(() => {
    exited = true;
  });
  child.kill("SIGTERM");
  await Promise.race([exitPromise, sleep(1000)]);
  if (exited || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await Promise.race([exitPromise, sleep(1000)]);
};

const waitForBridge = async (httpPort, output) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${httpPort}/health`, {
        headers: { Origin: "http://localhost:1420" },
      });
      if (response.ok) return;
    } catch {
      // Wait for the child process to bind both ports.
    }
    await sleep(100);
  }
  throw new Error(`Bridge did not become healthy.\n${output()}`);
};

const httpCheck = async (httpPort, origin) => {
  const response = await fetch(`http://127.0.0.1:${httpPort}/health`, {
    headers: origin ? { Origin: origin } : {},
  });
  return {
    allowOrigin: response.headers.get("access-control-allow-origin"),
    origin,
    status: response.status,
  };
};

const wsCheck = (wsPort, origin, path = "/agent-status") =>
  new Promise((resolve, reject) => {
    const websocket = new WebSocket(`ws://127.0.0.1:${wsPort}${path}`, {
      headers: origin ? { Origin: origin } : {},
    });
    const timeout = setTimeout(() => {
      websocket.terminate();
      reject(new Error(`WebSocket check timed out for ${origin ?? "no-origin"} ${path}`));
    }, 3000);

    websocket.on("open", () => {
      clearTimeout(timeout);
      websocket.close();
      resolve({ opened: true, origin, path, status: 101 });
    });
    websocket.on("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      resolve({ opened: false, origin, path, status: response.statusCode });
    });
    websocket.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ error: error.message, opened: false, origin, path });
    });
  });

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const httpPort = await freePort();
const wsPort = await freePort();
let stdout = "";
let stderr = "";

const bridge = spawn(process.execPath, [bridgeScript], {
  env: {
    ...process.env,
    AIVATAR_HTTP_PORT: String(httpPort),
    AIVATAR_WS_PORT: String(wsPort),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

bridge.stdout.on("data", (chunk) => {
  stdout += chunk;
});
bridge.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await waitForBridge(httpPort, () => `${stdout}\n${stderr}`);

  const checks = {
    allowedHttp: await httpCheck(httpPort, "http://localhost:1420"),
    cliHttp: await httpCheck(httpPort, undefined),
    evilHttp: await httpCheck(httpPort, "https://evil.example"),
    malformedHttp: await httpCheck(httpPort, "http://localhost/path"),
    allowedWs: await wsCheck(wsPort, "http://localhost:1420"),
    cliWs: await wsCheck(wsPort, undefined),
    evilWs: await wsCheck(wsPort, "https://evil.example"),
    malformedWs: await wsCheck(wsPort, "http://localhost/path"),
    wrongPathWs: await wsCheck(wsPort, "http://localhost:1420", "/not-found"),
  };

  assert(checks.allowedHttp.status === 200, "Allowed HTTP Origin should pass.");
  assert(
    checks.allowedHttp.allowOrigin === "http://localhost:1420",
    "Allowed HTTP Origin should be reflected exactly.",
  );
  assert(checks.cliHttp.status === 200, "No-Origin CLI HTTP request should pass.");
  assert(checks.cliHttp.allowOrigin === null, "No-Origin CLI HTTP should not emit ACAO.");
  assert(checks.evilHttp.status === 403, "Untrusted HTTP Origin should be forbidden.");
  assert(checks.malformedHttp.status === 403, "Malformed HTTP Origin should be forbidden.");
  assert(checks.allowedWs.opened, "Allowed WebSocket Origin should connect.");
  assert(checks.cliWs.opened, "No-Origin CLI WebSocket request should connect.");
  assert(
    !checks.evilWs.opened && checks.evilWs.status === 403,
    "Untrusted WebSocket Origin should be forbidden.",
  );
  assert(
    !checks.malformedWs.opened && checks.malformedWs.status === 403,
    "Malformed WebSocket Origin should be forbidden.",
  );
  assert(
    !checks.wrongPathWs.opened,
    "Unexpected WebSocket path should be rejected.",
  );

  console.log(JSON.stringify({ ok: true, httpPort, wsPort, checks }, null, 2));
} finally {
  await stopProcess(bridge);
}
