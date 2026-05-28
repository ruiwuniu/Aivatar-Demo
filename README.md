# Aivatar

Aivatar is a small Tauri desktop companion for AI coding agents. It renders a retro pixel room, lets an avatar live inside it, and maps live Codex, Claude Code, or other agent session status messages to avatar behavior.

## MVP Features

- Tauri 2 + React + TypeScript + Vite project structure.
- Pixel-style Canvas room with bedroom, office, kitchen, and placeholder furniture.
- Avatar behavior state machine for idle living, sleeping, interacting, thinking, coding, waiting, errors, and success.
- WebSocket agent status bridge at `ws://127.0.0.1:38987/agent-status`.
- Multi-session status tracking keyed by `agent + sessionId`.
- Simulated status fallback when no bridge is available.
- Clickable furniture interactions in the room canvas.
- Local pet-system foundations: stats, inventory, consumables, shop items, virtual `bits`, and local save state.
- Config/content extension point in `public/config/aivatar.config.json`.

## Run

Install dependencies first:

```powershell
npm install
```

If PowerShell blocks `npm.ps1` because script execution is disabled, use `npm.cmd` for the same commands, for example `npm.cmd install`.

Run the web UI:

```powershell
npm run dev
```

Run as a desktop app:

```powershell
npm run tauri dev
```

Optional mock Codex status server:

```powershell
npm run status:mock
```

Run the local bridge for real integrations:

```powershell
npm run status:bridge
```

Connect the current Codex Desktop session through the local Aivatar session plugin:

```powershell
npm.cmd run aivatar:session:setup
npm.cmd run aivatar:connect
npm.cmd run aivatar:disconnect
```

See [docs/aivatar-session-plugin.md](docs/aivatar-session-plugin.md) for setup, disconnecting old sessions, and troubleshooting.

Send a status into the bridge:

```powershell
npm.cmd run agent:send -- --agent codex --session codex-demo thinking "Reading project files"
npm.cmd run agent:send -- --agent codex --session codex-demo executing "Applying patch"
npm.cmd run agent:send -- --agent codex --session codex-demo waiting_for_user "Need approval"
npm.cmd run agent:send -- --agent codex --session codex-demo complete "Task finished"
```

Wrap a command so Aivatar follows its lifecycle:

```powershell
npm.cmd run aivatar:run -- npm.cmd run build
npm.cmd run aivatar:run -- codex
npm.cmd run agent:run -- --agent claude-code -- claude
```

For convenience, `codex:run` and `claude:run` start those tools through the same wrapper. If no `--session` is provided, the wrapper creates a session id automatically.

```powershell
npm.cmd run codex:run
npm.cmd run claude:run
```

## Agent Status Messages

Aivatar listens for WebSocket updates at:

```text
ws://127.0.0.1:38987/agent-status
ws://127.0.0.1:38987/codex-status  legacy compatibility
```

The local bridge accepts status updates at:

```text
POST http://127.0.0.1:38988/agent-status
GET  http://127.0.0.1:38988/agent-status
POST http://127.0.0.1:38988/codex-status  legacy compatibility
GET  http://127.0.0.1:38988/codex-status   legacy compatibility
GET  http://127.0.0.1:38988/health
```

```json
{
  "agent": "codex | claude-code | aider | cursor | custom",
  "sessionId": "optional session id",
  "status": "idle | thinking | executing | waiting_for_user | error | complete",
  "phase": "optional short phase name",
  "task": "optional current task summary",
  "summary": "optional short bubble text",
  "detail": "optional longer detail",
  "progress": 0,
  "message": "optional display text",
  "severity": "info | warning | error",
  "timestamp": "ISO-8601"
}
```

The bridge stores one latest status per `agent + sessionId` and broadcasts snapshots shaped like:

```json
{
  "type": "aivatar.status.snapshot",
  "currentStatus": {},
  "sessions": [],
  "timestamp": "ISO-8601"
}
```

The app still accepts old single-status messages for compatibility.

## Content Config

The app loads runtime content from:

```text
public/config/aivatar.config.json
```

This file controls the avatar name, room furniture, starter inventory, item definitions, shop inventory, starter pet stats, and wallet. If the config cannot be loaded, the app falls back to the built-in defaults in `src/data/defaultContent.ts`.

## Notes

This workspace currently does not expose `npm` or `rustc` on PATH, so dependency installation and Tauri compilation need a local Node/npm and Rust setup available in the shell.
