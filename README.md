# Aivatar

Aivatar is a small Tauri desktop companion for AI coding agents. It renders a retro pixel room, lets an avatar live inside it, and maps live Codex, Claude Code, or other agent session status messages to avatar behavior.

## Release Status

Aivatar is preparing for a Windows preview release. The app can be built from source today, but the downloadable installer path is still being hardened.

The release goal is:

- Install and launch Aivatar without cloning the repository.
- Use the room, avatar, save slots, inventory, shop, decor, and built-in assets without Codex or Claude Code installed.
- Treat Codex and Claude Code integrations as optional add-ons with clear missing-dependency messages.
- Keep local status, session, and learning data on the user's machine unless a configured external agent/provider is explicitly invoked.

Current release-prep limitation: the local status bridge, basic Codex Desktop session discovery, rollout watching, token-usage rewards, and local heuristic session learning have native Rust/Tauri preview implementations. The Codex Desktop connector and connected CLI runner scripts are bundled as Tauri resources. Connected CLI launch still requires Node.js and the requested agent CLI on PATH; a fully Rust-native runner and LLM/provider-backed session learning remain future hardening work.

## MVP Features

- Tauri 2 + React + TypeScript + Vite project structure.
- Pixel-style Canvas room with bedroom, office, kitchen, and placeholder furniture.
- Avatar behavior state machine for idle living, sleeping, interacting, thinking, coding, waiting, errors, and success.
- WebSocket agent status bridge at `ws://127.0.0.1:38987/agent-status`.
- Multi-session status tracking keyed by `agent + sessionId`.
- Codex Desktop, Codex CLI, and Claude Code CLI connection paths for live companion status.
- In-app CLI launcher for connected Codex and Claude Code sessions.
- Task Cabinet for launching one-off or scheduled Codex and Claude Code CLI tasks from selected markdown prompts.
- Token-usage rewards: completed Codex and Claude Code sessions can grant avatar `bits` based on reported token usage, which can be spent on shop items.
- Simulated status fallback when no bridge is available.
- Clickable furniture interactions in the room canvas.
- Local pet-system foundations: stats, inventory, consumables, shop items, virtual `bits`, and local save state.
- Config/content extension point in `public/config/aivatar.config.json`.

## Download And Use

Downloadable desktop builds will be published through GitHub Releases once the release checklist is complete. See [docs/release-checklist.md](docs/release-checklist.md).

The first supported release target is Windows. macOS and Linux packaging are planned after the Windows preview path is stable.

## Developer Setup

Install dependencies first:

```powershell
npm.cmd install
```

If PowerShell blocks `npm.ps1` because script execution is disabled, use `npm.cmd` for the same commands, for example `npm.cmd install`.

Run the web UI:

```powershell
npm.cmd run dev
```

Run as a desktop app:

```powershell
npm.cmd run tauri dev
```

Optional mock Codex status server:

```powershell
npm.cmd run status:mock
```

Run the local bridge for real integrations:

```powershell
npm.cmd run status:bridge
```

Connect the current Codex Desktop session through the bundled Aivatar session connector:

```powershell
npm.cmd run aivatar:session:setup
npm.cmd run aivatar:connect
npm.cmd run aivatar:disconnect
```

See [docs/aivatar-session-plugin.md](docs/aivatar-session-plugin.md) for setup, disconnecting old sessions, and troubleshooting.

Agent session helper scripts use the bundled `plugins/aivatar-session-bridge` connector by default. Developers can set `AIVATAR_SESSION_PLUGIN_ROOT` or `AIVATAR_SCRIPTS_ROOT` to test a different connector or script checkout. Packaged builds can detect the bundled connector and script resources, follow basic Codex Desktop session activity, token usage, and local heuristic learning through the native bridge, and launch the connected runner when Node.js plus the requested agent CLI are installed. The in-app Start CLI and Task Cabinet flows can launch connected Codex or Claude Code CLI sessions, including scheduled markdown-prompt tasks. Completed Codex and Claude Code sessions can report token usage back to Aivatar; the avatar earns `bits` from eligible completions and can spend them in the shop. Full release-mode Codex connection still has provider-backed learning and Rust-native runner work tracked in [docs/release-checklist.md](docs/release-checklist.md).

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

## Privacy And Local Data

Aivatar's bridge listens on `127.0.0.1` by default. It is intended for same-machine communication between the desktop app and local agent tools.

Depending on which integrations you enable, Aivatar may read local Codex Desktop session metadata, Claude Code hook/status payloads, markdown task files selected by the user, and local save data. Task Cabinet reads selected markdown files into temporary prompt copies and does not write back to the source markdown files.

Aivatar may write operational files under the system temp directory, including bridge state, session helper records, avatar state snapshots, task prompt copies, and learning context digests. Do not share these files publicly without reviewing them.

Session learning can invoke configured local agent/provider commands. Disable learning with:

```powershell
$env:AIVATAR_LEARNING_ENABLED = "0"
```

See [SECURITY.md](SECURITY.md) before reporting issues that involve private sessions, local transcripts, or filesystem paths.

## Assets And Attribution

Bundled asset provenance is tracked in [ATTRIBUTIONS.md](ATTRIBUTIONS.md), [public/audio/README.md](public/audio/README.md), and [public/assets/art/README.md](public/assets/art/README.md).

## Content Config

The app loads runtime content from:

```text
public/config/aivatar.config.json
```

This file controls the avatar name, room furniture, starter inventory, item definitions, shop inventory, starter pet stats, and wallet. If the config cannot be loaded, the app falls back to the built-in defaults in `src/data/defaultContent.ts`.

## Notes

This workspace currently does not expose `npm` or `rustc` on PATH, so dependency installation and Tauri compilation need a local Node/npm and Rust setup available in the shell.
