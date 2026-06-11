---
name: aivatar-session-bridge
description: Report the current Codex session status to the local Aivatar bridge, mark the current session active, and keep Aivatar aligned with Codex task lifecycle.
---

# Aivatar Session Bridge

Use this skill when the user asks to connect Codex to Aivatar, show the current session in Aivatar, report current work status, or make Aivatar follow this Codex session.

## Status Protocol

The plugin reports to the local Aivatar bridge:

```text
POST http://127.0.0.1:38988/agent-status
POST http://127.0.0.1:38988/agent-active
```

The default session id is `CODEX_THREAD_ID`. Override it with `AIVATAR_SESSION_ID` when needed.

## Commands

From the plugin root:

```powershell
.\aivatar-connect.cmd
.\aivatar-disconnect.cmd

.\aivatar-connect.cmd "Connected to Aivatar"
.\aivatar-disconnect.cmd "Disconnected from Aivatar"
.\aivatar-disconnect.cmd --session OLD_SESSION_ID

node ./scripts/aivatar-status.mjs thinking "Reading project context" --active
node ./scripts/aivatar-status.mjs executing "Applying changes"
node ./scripts/aivatar-status.mjs waiting_for_user "Need confirmation"
node ./scripts/aivatar-status.mjs complete "Task finished"
node ./scripts/aivatar-status.mjs error "Task failed"
node ./scripts/aivatar-status.mjs --clear-active
node ./scripts/aivatar-heartbeat.mjs
```

## Workflow

1. At the start of a user task, run `.\aivatar-connect.cmd`. It sends `thinking` with `--active` and starts a background heartbeat for the current session.
2. While making tool-backed changes, the plugin hook sends an `executing` heartbeat after tool use.
3. When ending or switching sessions, run `.\aivatar-disconnect.cmd`. It stops the background heartbeat, sends `idle`, and clears the active session.
4. If the user must decide or approve something, send `waiting_for_user`.
5. Before final response after successful work, send `complete`.
6. If the task fails or is interrupted, send `error`.

## Notes

- If Aivatar bridge is not running, do not block the user task.
- Keep messages short because they appear in Aivatar's session panel and bubbles.
- This plugin does not inspect private Codex Desktop internals; it reports the current session through documented environment and hook behavior.
