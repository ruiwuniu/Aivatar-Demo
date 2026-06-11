# Aivatar Session Plugin Workflow

The local Aivatar session plugin connects the current Codex Desktop session to the Aivatar status bridge. It marks the current session active, keeps presence alive through a heartbeat, watches the current Codex Desktop rollout JSONL for per-turn activity, and can report token usage deltas when a Codex session completes.

## Connector Location

The Aivatar session connector is bundled in this repo:

```text
plugins\aivatar-session-bridge
```

Project npm scripts use this path by default. Developers can override it with:

```powershell
$env:AIVATAR_SESSION_PLUGIN_ROOT = "C:\path\to\aivatar-session-bridge"
```

## First-Time Setup

Run this once to add the plugin command directory to your user PATH:

```powershell
npm.cmd run aivatar:session:setup
```

Open a new terminal after setup. You can then run these commands directly:

```powershell
aivatar-connect
aivatar-disconnect
```

The npm scripts below work even if PATH has not been refreshed.

## Connect The Current Session

Start or open Aivatar first. The Tauri app usually starts the local bridge automatically. For a web-only preview, start it manually:

```powershell
npm.cmd run status:bridge
```

Connect the current Codex session:

```powershell
npm.cmd run aivatar:connect
```

This sends `thinking "Connected to Aivatar" --active` and starts two background helpers for the current session:

- `aivatar-heartbeat.mjs` keeps Aivatar's Agent Sessions panel showing the session as connected.
- `aivatar-watch.mjs` tails the current Codex Desktop rollout JSONL from the current end of file, so old events are not replayed when a session connects.

Optional custom message:

```powershell
npm.cmd run aivatar:connect -- "Reading project context"
```

## Disconnect Or Switch Sessions

Disconnect the current session:

```powershell
npm.cmd run aivatar:disconnect
```

This stops the background heartbeat and rollout watcher started by `aivatar-connect`, sends `idle`, clears the active session, and clears the token baseline without granting a completion reward.

Disconnect a known old session:

```powershell
npm.cmd run aivatar:disconnect -- --session OLD_SESSION_ID
```

## Status Lifecycle

For normal Codex Desktop work, use the session plugin for connection and disconnection. The rollout watcher should drive ordinary turn state automatically:

- `event_msg` with `payload.type === "user_message"` sends `thinking` and resets the token baseline.
- `response_item` with `payload.type === "function_call"` sends `executing` and preserves or creates the token baseline.
- `event_msg` with `payload.type === "agent_message"` and `phase === "commentary"` does not complete the task.
- `event_msg` with `payload.type === "agent_message"` and `phase === "final"` or `phase === "final_answer"` sends `complete`, reports token delta usage, and clears the token baseline.

Manual status updates are still useful for explicit milestones, errors, or older clients:

```powershell
node .\plugins\aivatar-session-bridge\scripts\aivatar-status.mjs executing "Applying changes"
node .\plugins\aivatar-session-bridge\scripts\aivatar-status.mjs waiting_for_user "Need confirmation"
node .\plugins\aivatar-session-bridge\scripts\aivatar-status.mjs complete "Task finished"
node .\plugins\aivatar-session-bridge\scripts\aivatar-status.mjs error "Task failed"
```

Token baseline behavior:

- `thinking` resets the baseline.
- `executing` and `waiting_for_user` preserve or create the baseline.
- `complete` and `error` send usage delta and clear the baseline.
- `idle` and `--clear-active` clear without reward usage.

The existing PostToolUse hook remains installed as a fallback activity signal, but the watcher is the primary path for real-time Codex Desktop turn tracking.

## Troubleshooting

- `aivatar-connect` is not recognized: run `npm.cmd run aivatar:session:setup`, then open a new terminal. Or use `npm.cmd run aivatar:connect`.
- Aivatar does not show the session: make sure the bridge is running with the Tauri app or `npm.cmd run status:bridge`.
- Old session still appears connected: run `npm.cmd run aivatar:disconnect -- --session OLD_SESSION_ID`. If an old heartbeat terminal is still open, stop it with `Ctrl+C`.
- Connector path changed: set `AIVATAR_SESSION_PLUGIN_ROOT` before running the npm command.
