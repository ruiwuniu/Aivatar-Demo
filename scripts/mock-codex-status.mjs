import { WebSocketServer } from "ws";

const port = 38987;
const path = "/codex-status";
const statuses = [
  "idle",
  "thinking",
  "executing",
  "waiting_for_user",
  "complete",
  "idle",
  "error",
];

const server = new WebSocketServer({ port, path });
let index = 0;

const buildMessage = () => {
  const status = statuses[index % statuses.length];
  index += 1;

  return {
    status,
    phase: status === "executing" ? "editing" : status,
    task: `Mock Codex state: ${status}`,
    progress: status === "complete" ? 100 : status === "idle" ? 0 : 48,
    message: `Mock ${status.replaceAll("_", " ")}`,
    severity: status === "error" ? "error" : status === "waiting_for_user" ? "warning" : "info",
    timestamp: new Date().toISOString(),
  };
};

server.on("connection", (socket) => {
  socket.send(JSON.stringify(buildMessage()));
  const timer = setInterval(() => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(buildMessage()));
    }
  }, 5000);

  socket.on("close", () => clearInterval(timer));
});

console.log(`Mock Codex status server: ws://127.0.0.1:${port}${path}`);
