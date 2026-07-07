# Aivatar Project Notes

## Agent Operating Rules

This repository uses a strict file-safety workflow:

- Default to limited read-only mode: inspect directories, read files, search text, and propose edits.
- Do not modify, rename, move, format, refactor, overwrite, or delete existing files without explicit user approval for the exact patch or edit list.
- Before editing an existing file, describe the affected files and show the proposed patch/diff or a clear edit list, then wait for explicit confirmation.
- Creating new files and folders is allowed when requested; files created by the agent may be modified by the agent.
- Before deleting anything, list every file or directory, explain why it can be safely removed, and wait for explicit confirmation.
- Bulk deletion is not allowed. If cleanup would affect many files, propose a plan for the user to execute or adjust manually.
- Treat raw/original/source data as strictly read-only. Any processing should operate on clearly labeled copies or derived files.

## Project Goal

Aivatar is a Tauri 2 + React + TypeScript desktop companion for AI coding agents. It displays a retro pixel-style room where a customizable pixel companion lives, wanders, sleeps, works, plays, decorates its room, and reacts to live agent status in real time. The original/default companion is the pixel octopus, with additional appearance-only characters sharing the same runtime behavior model.

The product direction is a mix of:

- Desktop pet / electronic companion.
- Pixel room simulator with a cozy retro game feel.
- Live visual state monitor for Codex, Claude Code, and other AI apps/CLIs that can post status events.
- Extensible pet system with feeding, inventory, shop, placeable decor/furniture, room editing, autonomous activities, future room upgrades, skins, and content packs.

The MVP should prioritize the feeling that the avatar is alive, while still letting agent status strongly drive avatar behavior.

## Current Stack

- Desktop shell: Tauri 2
- Frontend: React 18 + TypeScript + Vite
- Rendering: HTML Canvas with pixel-art styling
- Runtime content: JSON config loaded from `public/config/aivatar.config.json`
- Local status integration:
  - WebSocket for Aivatar UI updates
  - HTTP bridge for external scripts/tools to POST generic AI agent status

PowerShell may block `npm.ps1`; use `npm.cmd` in this environment.

## Important Commands

Install dependencies:

```powershell
npm.cmd install
```

Run web UI:

```powershell
npm.cmd run dev
```

The web UI dev server and Tauri dev URL are currently unified on:

```text
http://localhost:1420/
```

Keep using `localhost` for development previews unless intentionally testing a separate origin. Browser `localStorage` is origin-scoped, so `http://127.0.0.1:1420/` and `http://localhost:1420/` have separate saves.

When the main OneDrive checkout already owns port `1420`, a Codex worktree
preview can be run on a separate port:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 1421 --strictPort
```

Use `http://127.0.0.1:1421/` for that worktree preview. This origin has its
own `localStorage`, including save state and UI theme choice.
If `1421` is also occupied by another checkout or preview, use the next free
strict port, for example `1422`, and remember that this creates another
origin-scoped `localStorage` save/theme context.

If nearby worktree preview ports are already occupied, this worktree has been
previewed on:

```powershell
node .\node_modules\vite\bin\vite.js --host 127.0.0.1 --port 1427 --strictPort
```

Use `http://127.0.0.1:1427/` for the current Gray Tech Floor and Blue Persian
Rug shop preview. This origin has separate `localStorage` from `1420`, `1421`,
`1422`, `1423`, `1424`, `1425`, and `1426`.

Run desktop app:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_TARGET_DIR = "$env:TEMP\aivatar-cargo-target"
cmd.exe /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && npm.cmd run tauri dev'
```

The Tauri desktop app attempts to start the local status bridge automatically during app setup. The Debug panel also includes a `Start bridge` button for manually starting it from the app. Starting the bridge from Tauri also attempts to start Codex Desktop session discovery.

The desktop shell registers the Tauri single-instance plugin before other plugins. A second app launch should focus/show the existing main window instead of keeping another full WebView process alive.

Run real local status bridge:

```powershell
npm.cmd run status:bridge
```

Run the bridge Origin/CORS smoke test:

```powershell
npm.cmd run status:bridge:smoke
```

Run the shop purchase pressure smoke test:

```powershell
npm.cmd run shop:purchase:smoke
```

Run the DOM-level shop UI smoke test:

```powershell
npm.cmd run shop:ui:smoke
```

Run Codex Desktop session discovery:

```powershell
npm.cmd run status:discover
```

`status:discover` also starts the Workbuddy session discovery helper when
`scripts/workbuddy-session-discovery.mjs` is present. The helper reads only
Workbuddy metadata under `~\.workbuddy-ai`: `workbuddy.db` tables `sessions`
and `session_usage`, plus sidecar heartbeat JSON files under `sessions\`. It
does not read Workbuddy chat transcripts, local storage payloads, bearer tokens,
or full logs. Workbuddy's `sessions.source_mode` distinguishes the `working`
and `coding` UI areas; both are posted as `workbuddy` sessions to Aivatar.

Run Workbuddy discovery by itself:

```powershell
npm.cmd run status:discover:workbuddy
```

Run the Workbuddy discovery smoke test against a derived temporary SQLite
fixture:

```powershell
npm.cmd run status:discover:workbuddy:smoke
```

Workbuddy `session_usage.used` / `size` are treated as context-window usage.
Active Workbuddy rows send `scope: "context-window"` for meters only. Completed
rows can send `scope: "since-baseline"` with the observed `used` delta from the
current watcher process so normal Aivatar bits settlement applies. If no live
baseline is available, old completed Workbuddy rows should not be over-rewarded
from their full context window.

Manual bridge startup is still useful for web-only previews, bridge debugging, or when running the React dev server without the Tauri shell. For web-only previews that should auto-detect Codex Desktop and Workbuddy sessions, run both `status:bridge` and `status:discover`.

Run Aivatar session-learning worker manually:

```powershell
npm.cmd run aivatar:learn -- --provider none --agent claude-code --session test --status complete --summary "Aivatar learned a tiny memory."
npm.cmd run aivatar:learn:claude -- --agent claude-code --session test --status complete --summary "Aivatar learned from Claude Code."
npm.cmd run aivatar:learn:codex -- --agent codex --session test --status complete --summary "Aivatar learned from Codex."
npm.cmd run aivatar:learn:opencode -- --agent opencode --session test --status complete --summary "Aivatar learned from opencode."
```

`--provider none` uses the local heuristic fallback and is useful for bridge/UI smoke tests. `aivatar:learn:claude` uses Claude Code `--print`/JSON output when Claude Code is logged in; if Claude Code is not logged in or returns invalid JSON, the worker falls back without breaking status flow. `aivatar:learn:codex` uses Codex `exec` with read-only/no-approval structured output and has been smoke-tested for English and Chinese learning payloads. `aivatar:learn:opencode` uses `opencode run --format json` and falls back heuristically if the provider is unavailable or returns invalid JSON. The provider command can be overridden with `AIVATAR_CODEX_COMMAND`, `CODEX_COMMAND`, `AIVATAR_CLAUDE_COMMAND`, `AIVATAR_OPENCODE_COMMAND`, or `OPENCODE_COMMAND`; on Windows the worker prefers the npm-installed `@openai/codex/bin/codex.js` path when available so it can avoid the `codex.cmd` shim.

Run Aivatar painting-plan worker manually:

```powershell
npm.cmd run aivatar:paint -- --provider none --payload-file path\to\painting-payload.json
```

`--provider none` uses the local heuristic painting-plan fallback. The bridge normally writes derived painting payloads under `%TEMP%\aivatar-painting-context` and calls this worker through `POST /painting-plan`.

Run Aivatar social-dialogue worker manually:

```powershell
npm.cmd run aivatar:social-dialogue -- --provider none --payload-file path\to\social-dialogue-payload.json
```

`--provider none` uses the local heuristic social-dialogue fallback. The bridge normally writes derived Room Visit dialogue payloads under `%TEMP%\aivatar-social-dialogue-context` and calls this worker through `POST /social-dialogue`.

Send a generic agent status manually:

```powershell
npm.cmd run agent:send -- --agent codex thinking "Reading project files"
npm.cmd run agent:send -- --agent claude-code executing "Applying patch"
npm.cmd run agent:send -- --agent codex waiting_for_user "Need approval"
npm.cmd run agent:send -- --agent codex complete "Task finished"
npm.cmd run agent:send -- --agent codex error "Build failed"
```

Send a legacy Codex status manually:

```powershell
npm.cmd run status:send -- thinking "Reading project files"
npm.cmd run status:send -- executing "Applying patch"
npm.cmd run status:send -- waiting_for_user "Need approval"
npm.cmd run status:send -- complete "Task finished"
npm.cmd run status:send -- error "Build failed"
```

Connect the current Codex session through the local Aivatar session plugin:

```powershell
npm.cmd run aivatar:session:setup
npm.cmd run aivatar:connect
npm.cmd run aivatar:disconnect
```

Setup adds the plugin command directory to the user's PATH. Connect marks the current session active, sends a visible `thinking` status, and starts a background heartbeat. Disconnect stops the heartbeat, sends `idle`, clears the active session, and clears token baseline state without granting a reward. See `docs/aivatar-session-plugin.md` for details.

After setup, the shorter commands are also available from the shell:

```powershell
aivatar-connect
aivatar-disconnect
```

The Agent Sessions panel displays these two commands as the recommended manual connection flow. `aivatar-connect` should be run once per Codex Desktop session that should drive Aivatar; `aivatar-disconnect` should be run before leaving or replacing that session.

The local session plugin can also read Codex Desktop token usage from the current session's local rollout JSONL. For Codex Desktop sessions, `thinking` creates or resets a token baseline, `executing` and `waiting_for_user` preserve or create the baseline, `complete` and `error` send token delta usage and clear the baseline, and `idle` or `--clear-active` clears the baseline without reward usage. Baselines expire after `AIVATAR_USAGE_BASELINE_TTL_MS`, defaulting to six hours.

The plugin now separates presence from turn state. The heartbeat keeps sessions connected through presence without repeatedly stealing active/follow state, while the rollout watcher tails the current Codex Desktop JSONL from the connect-time end of file and streams ordinary turn activity into Aivatar. Codex `agent_message` records with `phase: "commentary"` are streamed as live `thinking` / `commentary` updates so the avatar thinking bubble can show Codex Desktop or CLI commentary before the final answer. Multiple Codex worktree/Desktop sessions can remain connected at the same time; the single followed/active session is changed by an explicit connect/Follow action rather than by every heartbeat tick.

Connect a CLI-launched session through the repo-local Aivatar CLI connector:

```powershell
npm.cmd run aivatar:cli:connect
npm.cmd run aivatar:cli:disconnect
```

The CLI connector starts the same local heartbeat/watcher flow but stores token reward baselines at `%TEMP%\aivatar-usage-baselines.json` by default, avoiding `.codex\tmp` write-permission issues in restricted launch contexts.

Wrap any command so Aivatar follows its lifecycle:

```powershell
npm.cmd run agent:run -- --agent codex -- npm.cmd run build
npm.cmd run agent:run -- --agent claude-code -- claude
npm.cmd run aivatar:run -- npm.cmd run build
npm.cmd run aivatar:run -- node -e "console.log('hello')"
```

Run Codex, Claude Code, or opencode through the wrapper:

```powershell
npm.cmd run codex:run
npm.cmd run codex:run -- --help
npm.cmd run claude:run
npm.cmd run opencode:run
```

Run Claude Code through the connected wrapper:

```powershell
npm.cmd run claude:connected
npm.cmd run claude:connected -- --help
```

Link Claude Desktop/Code sessions to Aivatar hooks/statusLine:

```powershell
npm.cmd run claude:desktop:link
npm.cmd run claude:desktop:link -- --apply
```

The first command is a dry run that prints the settings merge target and
generated hook/statusLine configuration. Passing `--apply` merges Aivatar's
Claude Code hooks into the selected Claude settings file and writes the Windows
statusLine wrapper when needed. Existing Claude sessions must be restarted to
load the settings.

`codex:run` is the older generic lifecycle wrapper. It can still be useful for
simple command status tracking, but it is not the preferred Codex Desktop
session connection path because it does not perform explicit Codex session
discovery or Desktop listing verification.

Run Codex through the connected wrapper:

```powershell
npm.cmd run codex:connected
npm.cmd run codex:connected -- --help
npm.cmd run codex:connected -- resume <session-id>
npm.cmd run codex:connected -- --new-session
```

`codex:connected` runs `connect -> codex -> disconnect` with explicit session
semantics. A bare `codex` command is rejected unless the user passes
`--new-session`; use `codex resume <session-id>` to connect Aivatar to an
existing Codex session. When `--new-session` is explicit, the wrapper snapshots
existing rollout JSONL files, launches Codex without inherited
`CODEX_THREAD_ID`/`CODEX_SESSION_ID`, discovers the newly created rollout JSONL,
checks that the rollout cwd matches the requested launcher cwd when provided,
optionally verifies that Codex Desktop `thread/list` can see the new session for
that cwd, then switches Aivatar from the provisional session id to the real
Codex session id and starts watcher/token reward tracking. Verification failures
are reported in the terminal and written to a recovery log under `%TEMP%`.

Run opencode through the connected wrapper:

```powershell
npm.cmd run opencode:connected
npm.cmd run opencode:connected -- --help
```

Install or inspect the opencode Desktop/TUI plugin adapter:

```powershell
npm.cmd run opencode:plugin:install
npm.cmd run opencode:plugin:install -- --apply
```

The first command is a dry run that prints the user plugin target under
`~/.config/opencode/plugins` (`%USERPROFILE%\.config\opencode\plugins` on
Windows), plus the learning worker and Node command that will be embedded.
Passing `--apply` writes `aivatar-opencode-plugin.js` there with the local
`scripts/aivatar-learning-worker.mjs` and Node command embedded, matching the
in-app Enable/Repair behavior; restart opencode Desktop/TUI after installing so
it can load the plugin. The plugin posts low-detail lifecycle events to the
Aivatar bridge and does not upload full transcript content.

For normal desktop users, prefer the in-app `Desktop Agents` side-panel card
over manual commands. Aivatar Desktop can check and Enable/Repair Claude Code
and opencode integrations from inside the app. Claude Code integration writes
Aivatar hook/statusLine wrappers under `~/.claude` and merges those wrappers into
`~/.claude/settings.json`; on Windows the generated statusLine command uses a
PowerShell-safe quoted forward-slash script path so Claude can run it through a
shell command. opencode integration writes the bundled plugin to
`~/.config/opencode/plugins/aivatar-opencode-plugin.js`. Existing Claude Code
or opencode Desktop/TUI sessions must be restarted after enabling so they load
the new hook/plugin configuration.

Current session safety expectation: Aivatar should not delete, rewrite, migrate,
or hide Codex Desktop chats. The connected wrapper reads Codex rollout JSONL
metadata, passes child-process environment variables, writes Aivatar recovery
logs under `%TEMP%`, and manages Aivatar heartbeat/watcher pid records and token
baselines. If chats disappear or a session list changes unexpectedly, first
suspect stale external plugin commands, PATH shadowing, Codex Desktop behavior,
or a mismatched wrapper invocation rather than bridge in-memory cleanup.

The desktop CLI Launcher now uses this connected wrapper through Tauri. In the
app, choose a folder, choose Codex, Claude Code, or opencode, optionally add args, and click
`Start CLI`; Aivatar starts the local bridge if needed, opens the CLI in that
folder, connects the session, and cleans up on CLI exit. For Codex, the launcher
checkbox is labeled `Create and follow new Codex session`; only that explicit
choice requests a new Codex session and enables cwd/Desktop listing
verification. For Claude Code, `scripts/aivatar-connected-run.mjs` now injects a
temporary `%TEMP%\aivatar-claude-code-settings\<session>.json` settings file
with Aivatar hooks and a statusLine command. Claude hook handlers use Claude
Code's exec-form command configuration (`command: node.exe`, `args:
[hookScript]`) so turn events bypass Git Bash on Windows. The statusLine command
uses a generated PowerShell wrapper under the same temp settings directory,
which forwards stdin JSON to the Node hook in `--status-line` mode and avoids
Git Bash hangs. The hook script maps Claude Code events such as
`UserPromptSubmit`, `MessageDisplay`, `PreToolUse`, `PostToolUse`,
`PermissionRequest`, `Stop`, `StopFailure`, and `SessionEnd` into Aivatar
statuses, while statusLine updates context-window usage and can fall back to a
terminal `complete` event when output tokens appear but a `Stop` hook was not
observed. For `MessageDisplay`, the hook prefers visible assistant
`delta`/`message`/`text`/`content` fields, compacting and sanitizing them into
`thinking` / `message-display` summaries for the avatar bubble instead of only
showing a generic responding label. Launcher-started Claude Code
sessions connect with an initial `idle` status; real prompt/tool events drive
later `thinking`, `executing`, `waiting_for_user`, `complete`, or `error` states.
For launcher/Task Cabinet sessions, the hook prefers the injected
`AIVATAR_SESSION_ID` over Claude's own UUID so bridge status maps back to the
same Aivatar task/session row. Once a turn reaches `complete` or `error`,
late Claude `Notification`, statusLine, or disconnect cleanup events preserve
that terminal state instead of downgrading the session to `waiting_for_user` or
`idle`. Claude `SessionEnd` also preserves the final terminal status while
calling the bridge disconnect endpoint, so closing the Claude Code CLI window
stops the session from remaining connected/current.
For opencode, the connected wrapper starts with an `idle` placeholder and does
not attach the Codex rollout watcher. Real desktop/TUI turn state is expected
from `scripts/aivatar-opencode-plugin.mjs`, which maps opencode plugin events
such as `session.status`, `permission.asked`, and `session.idle` into the same
Aivatar statuses used by Codex and Claude Code. The plugin also forwards
`experimental.text.complete` assistant text as live `thinking` /
`message-display` updates, so opencode Desktop/TUI and CLI sessions can surface
streamed assistant copy in the avatar bubble while still keeping only bounded
sanitized digest text for learning.

Connected launcher sessions now also enable Aivatar session learning by default:
`scripts/aivatar-connected-run.mjs` injects `AIVATAR_LEARNING_ENABLED=1` unless
the environment already sets a value, and defaults `AIVATAR_LEARNING_PROVIDER`
to `codex` for Codex, `claude-code` for Claude Code, and `opencode` for
opencode, while still honoring explicit user overrides. Claude Code terminal
`complete`/`error` hook events spawn `scripts/aivatar-learning-worker.mjs`
non-blockingly after the ordinary status update. The opencode plugin keeps a
bounded sanitized digest from plugin chat/text events and, when the app-installed
plugin has a Node/worker path embedded, spawns the same learning worker with
`AIVATAR_LEARNING_PROVIDER=opencode`; otherwise it posts a low-risk heuristic
learning payload so Growth suggestions still update. The worker reads only a
sanitized digest/context file under `%TEMP%\aivatar-learning-context\`, posts a
`phase: "session-learning"` payload with `learning`, and falls back to heuristic
learning if the configured provider is unavailable. Existing already-running
Claude/Codex/opencode sessions must be relaunched to inherit these environment
variables or plugin settings.

Codex Desktop and Codex CLI learning are now also wired through the external
`aivatar-watch.mjs` rollout watcher. The watcher keeps a bounded sanitized
digest of Codex `user_message` and final/final_answer `agent_message` records,
writes `%TEMP%\aivatar-learning-context\codex-*.txt`, and spawns
`scripts/aivatar-learning-worker.mjs` with `AIVATAR_LEARNING_PROVIDER=codex`.
`scripts/aivatar-cli-connect.mjs` and `scripts/codex-session-discovery.mjs` pass
`AIVATAR_LEARNING_SCRIPT` so both connected CLI sessions and auto-discovered
Desktop sessions can produce `learning` payloads, not just template
`idleBubbleCandidates`.
In packaged Tauri builds, native `src-tauri/src/codex_discovery.rs` can also
spawn the same worker after Codex Desktop `final` / `final_answer` events. It
resolves `node` and provider commands without modifying Codex session files,
supports macOS Homebrew and user-bin PATH fallbacks, and hides Windows command
lookup / worker processes so automatic learning does not flash terminal windows
at turn completion.
The native bridge also accepts Claude Code hook/statusLine JSON on
`/agent-hooks/claude-code` and `/agent-hooks/claude-code/status-line`, mapping it
to generic `claude-code` statuses and context-window usage without requiring the
Node hook script. StatusLine updates are treated as context-only usage/presence
updates when a Claude session row already exists, so they do not downgrade an
in-progress or terminal turn state to `idle`. The JS `status:bridge` mirrors
these endpoints for web-only development. Both the native bridge and JS bridge
extract Claude `MessageDisplay` assistant text from `delta`, `message`, `text`,
`content`, and related fields, compacting it into live `thinking` /
`message-display` summaries for the avatar bubble. Native Claude desktop hooks
keep a bounded sanitized digest from `UserPromptSubmit.prompt`,
`MessageDisplay.delta`, and low-detail tool/event summaries. On `Stop`,
`TaskCompleted`, or
`StopFailure`, the native bridge starts `scripts/aivatar-learning-worker.mjs`
with provider `claude-code` when the bundled worker path is available, and falls
back to a heuristic `phase: "session-learning"` payload if the worker cannot be
started.
Claude Desktop's Chat and Cowork sidebar recents are also discovered from local
desktop inventory metadata. The JS discovery script and native packaged
discovery scan Claude's user data roots, including Windows Store
`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude` and
`%APPDATA%\Claude`: Code sessions come from
`claude-code-sessions\**\local_*.json`, Cowork sessions from
`local-agent-mode-sessions\**\local_*.json`, and Chat recents from Claude
Chromium Local Storage LevelDB conversation-list objects. This inventory scan
only reads session ids, titles, cwd, and timestamps; it does not read full chat
transcripts. Inventory statuses use `phase: "desktop-chat-session"`,
`"desktop-cowork-session"`, or `"desktop-code-session"` and are treated as idle
metadata, so they can create visible session rows but cannot downgrade an active
or terminal Claude hook session. Activity tracking is separate from inventory:
the discovery paths also tail Claude `logs\main.log` for Cowork/Code lifecycle
signals such as `initializing -> running`, `Turn succeeded`, and `Stop hook`
completion, mapping those into non-idle `claude-code` statuses so the Terminal
and avatar can react. For ordinary Claude Chat, discovery watches local
conversation cache updates and posts only a short current/leaf message summary
when available; it does not retain or upload full chat transcripts. Claude Chat
assistant-message changes are first posted as `executing` /
`desktop-chat-responding`, then only become `complete` /
`desktop-chat-complete` after the current leaf message stays unchanged for
`AIVATAR_CLAUDE_DESKTOP_CHAT_SETTLE_MS`, defaulting to 5 seconds. This avoids
the avatar flashing complete/idle while Claude is still streaming a reply.
Cowork/Code activity can arrive under both Claude Desktop `local_*` internal ids
and CLI UUIDs; the JS and native bridges merge rows with the same
`desktopSessionId`, so a `local_*` running row is replaced by the CLI UUID
`complete`/`error` row instead of leaving duplicate or stuck executing sessions.

The app also publishes a low-sensitivity avatar state snapshot to the bridge via
`POST /avatar-state`. The bridge writes `%TEMP%\aivatar-avatar-state.json`,
containing only avatar id/name, growth level, six trait point totals, idle bubble
language preference, and update time. The learning worker reads this snapshot by
default or through `--avatar-state-file`, and uses dominant/secondary traits to
shape suggested bubble tone: focus is concise, resilience steady, curiosity
observant, efficiency crisp, creativity playful, and warmth gentle. The snapshot
does not include raw chat text, full memory events, inventory, wallet, or room
layout.

Run old mock status cycler:

```powershell
npm.cmd run status:mock
```

Run desktop agent adapter smoke test:

```powershell
node scripts\aivatar-desktop-agent-adapters-smoke.mjs
```

This mocks bridge `fetch` calls and verifies the opencode plugin event mapping
plus Claude Desktop settings generation/merge behavior without touching user
settings or starting real desktop apps.

Validate frontend:

```powershell
npm.cmd run build
```

Run Card Room Hold'em rule smoke checks:

```powershell
npm.cmd run test:card-room-rules
```

Validate Tauri/Rust:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_TARGET_DIR = "$env:TEMP\aivatar-cargo-target"
cmd.exe /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && cargo check'
```

## Project Structure

```text
.
|-- AGENTS.md
|-- README.md
|-- docs/
|   `-- aivatar-session-plugin.md
|-- package.json
|-- vite.config.ts
|-- index.html
|-- public/
|   |-- audio/
|   |   |-- README.md
|   |   |-- keyboard-typing-loop.wav
|   |   |-- coffee-machine-brew-loop.ogg
|   |   |-- fridge-door-open.mp3
|   |   |-- fridge-door-close.mp3
|   |   |-- agent-complete-success.ogg
|   |   |-- cola-can-open.mp3
|   |   |-- cola-drink.mp3
|   |   |-- coffee-drink-slurping.mp3
|   |   |-- bento-eat-munchin.mp3
|   |   |-- game-console-jump.ogg
|   |   |-- game-console-invincibility.ogg
|   |   |-- game-console-victory.ogg
|   |   |-- game-console-battle.ogg
|   |   |-- game-console-get-equipped.wav
|   |   |-- game-console-curious.ogg
|   |   |-- bach-fugue-bwv-577-the-jig.ogg
|   |   |-- bach-invention-4.wav
|   |   |-- nes-bach-bwv-565.ogg
|   |   |-- cyberpunk-moonlight-sonata.mp3
|   |   |-- c64-bach-wtk2-prelude2.ogg
|   |   |-- nes-chopin-op25-no2.ogg
|   |   |-- synth-chopin-fantaisie-impromptu.ogg
|   |   `-- game-console-loop.wav
|   `-- config/
|       `-- aivatar.config.json
|-- scripts/
|   |-- aivatar-cli-connect.mjs
|   |-- aivatar-cli-disconnect.mjs
|   |-- aivatar-cli-watchdog.mjs
|   |-- aivatar-claude-desktop-link.mjs
|   |-- aivatar-connected-run.mjs
|   |-- aivatar-desktop-agent-adapters-smoke.mjs
|   |-- aivatar-bridge-security-smoke.mjs
|   |-- aivatar-shop-ui-smoke.mjs
|   |-- aivatar-learning-worker.mjs
|   |-- aivatar-opencode-plugin.mjs
|   |-- aivatar-run.mjs
|   |-- aivatar-session-plugin.mjs
|   |-- aivatar-social-dialogue-worker.mjs
|   |-- claude-code-aivatar-hook.mjs
|   |-- codex-session-discovery.mjs
|   |-- codex-status-bridge.mjs
|   |-- mock-codex-status.mjs
|   `-- send-codex-status.mjs
|-- src/
|   |-- cardRoom/
|   |   |-- CardRoomApp.tsx
|   |   |-- cardRoomContent.ts
|   |   |-- cardRoomRenderer.ts
|   |   |-- cardRoomRuntime.ts
|   |   |-- chipEconomy.ts
|   |   |-- holdemEngine.ts
|   |   |-- pokerAi.ts
|   |   `-- saveRoster.ts
|   |-- components/
|   |   `-- PixelAssetEditor.tsx
|   |-- App.tsx
|   |-- main.tsx
|   |-- styles.css
|   |-- types.ts
|   |-- agentRegistry.ts
|   |-- data/
|   |   |-- defaultContent.ts
|   |   `-- loadContent.ts
|   |-- game/
|   |   |-- interactions.ts
|   |   |-- renderScene.ts
|   |   `-- simulation.ts
|   `-- hooks/
|       `-- useCodexStatus.ts
`-- src-tauri/
    |-- Cargo.toml
    |-- tauri.conf.json
    |-- build.rs
    |-- capabilities/
    |   `-- default.json
    |-- icons/
    |   |-- icon.ico
    |   `-- icon.png
    `-- src/
        |-- lib.rs
        `-- main.rs
```

## Key Files

- `src/main.tsx`
  - Wraps `App` in a small React error boundary. If a render-time React error escapes the app, the fallback keeps the desktop/web window usable with a reload button instead of leaving a blank crashed surface.

- `src/App.tsx`
  - Main React app.
  - Owns loaded content, save state, Canvas events, categorized shop UI, inventory/shop interactions, the Decor panel for wall/floor surfaces, furniture/window interactions, placement mode, Room Edit mode, Debug controls, custom avatar name, agent status display, the right-side Agent Sessions panel, and the Desktop Agents integration panel.
  - Shows a locked/disabled `Asset Studio` entry in the right side panel below the shop, with the Pixel Asset Editor kept in code but hidden from the runtime UI while the workflow is still in development.
  - Includes a saved UI skin switcher stored under `aivatar.uiTheme.v1`. Current choices are `Classic`, `Terminal`, `Amber`, `Arcade Cabinet`, and `Starship`; fresh installs/default first launch use `Terminal`, including the startup save-slot menu, and later launches reuse the saved setting. `Classic` is now a Windows 98-style shell with gray 3D controls, teal desktop backdrop, blue title bars, thin range sliders, native checkbox controls, and clearer small Chinese UI typography. The Terminal skins remain retro CRT-style themes for the app shell, side-panel UI, and canvas presentation pass. `Arcade Cabinet` is a black/charcoal arcade-cabinet shell with a CRT scene frame, scanline texture, cyan/magenta neon trim, amber coin/status accents, and raised arcade-button controls. `Starship` is an original 1990s optimistic starship-console shell with matte black panels, amber/apricot primary controls, lavender and pale-cyan segmented accents, asymmetric rounded panel strips, and matching canvas bubble/status colors. The UI theme buttons now live inside the collapsible Settings side-panel card.
  - Includes a saved global SFX volume slider stored under `aivatar.audioVolume.v1`. The slider controls current app sound effects, with per-effect multipliers for louder/softer room sounds. The compact Settings card header shows the current global SFX volume with a theme-adaptive CSS speaker icon and intentionally does not show the current BGM track.
  - Includes a collapsible Settings side-panel card for avatar name, language, UI theme, global SFX volume, optional startup sound, Game Console volume, BGM track, BGM volume, autonomous music, and optional desktop always-on-top. `aivatar.startupSound.v1` controls whether the first user interaction after app load plays a quiet startup chime, `aivatar.gameConsoleVolume.v1` stores the independent Game Console volume, `aivatar.bgmTrack.v1` stores the selected Record Player track, `aivatar.bgmVolume.v1` stores the independent BGM volume, `aivatar.autoMusic.v1` controls whether idle life may autonomously choose music playback, and `aivatar.alwaysOnTop.v1` stores whether desktop builds should call Tauri `setAlwaysOnTop`. Web-only previews persist the always-on-top choice but have no native window to update. The expanded BGM track control includes a compact helper note that a Record Player must be placed in the room before music can play.
  - Owns runtime audio playback for animation-synchronized SFX: the built-in Terminal keyboard loop follows the placed Terminal monitor's real `coding`/`thinking` screen-and-keyboard animation after arrival, Coffee Machine brew audio loops only during real `brew` behavior, fridge door open/close one-shots follow the fridge feed animation phases, reward-eligible agent `complete` events play a short success one-shot, consumable `coffee`/`cola`/`bento`/`cookie` actions play action-specific drink/eat one-shots only after real action playback begins, and Game Console play audio starts only once the avatar is in real `play` behavior and the targeted console animation is active. Game Console audio randomly chooses one track per play-animation session from the `public/audio/game-console-*` pool, does not switch tracks mid-play, and is scaled by the independent Game Console volume on top of the global SFX volume. Record Player BGM can use either the built-in programmatic Web Audio chiptune or bundled 8-bit/classical audio tracks with explicit source/license notes.
  - Sleep snore audio uses `sleep-snore.mp3` and loops quietly only during true post-arrival `sleep`, stopping and resetting when sleep ends.
  - Audio unlock now happens on first app-level user interaction (`pointerdown`, `keydown`, or `touchstart`) and only records that a user gesture has occurred; it no longer muted-plays and pauses the shared runtime `Audio` objects, so the Terminal keyboard loop is not accidentally stopped by the unlock flow. The startup chime reuses the complete-success one-shot at reduced volume and only plays after this user gesture when enabled.
  - Owns the Record Player BGM MVP. The current track list includes the programmatic Web Audio `Pixel Parlor` loop plus bundled tracks `Bach BWV 577`, `Bach Invention 4`, `NES Bach BWV 565`, `C64 Bach BWV 871`, `NES Chopin Op. 25 No. 2`, `Synth Chopin Fantaisie-Impromptu`, and `Cyberpunk Moonlight`. Record Player playback is driven by an independent `activeRecordPlayerId` rather than by keeping the avatar in `music` behavior: after the avatar reaches and starts the Record Player, it returns to `idle` and can continue other activities while the selected Record Player keeps playing. BGM tracks carry per-track `volumeScale` values that are applied to both bundled `Audio` playback and the programmatic Web Audio gain so the library stays closer to a consistent perceived loudness. BGM stops when the playing Record Player id is cleared, the placed Record Player disappears, BGM volume is muted, audio is not unlocked, the avatar completes a queued Record Player `Stop music` interaction, or no active placed Record Player can be found during stop cleanup. Manual `Stop music` and autonomous stop checks queue a `stop-music` placed-item interaction, so the avatar must reach the active Record Player before music turns off. When the avatar starts music autonomously, it chooses a track itself, preferring a different track from the current one.
  - Applies save-state overrides for placed items, base furniture placement, active/moved windows, active wall/floor surfaces, wallet, inventory, table coffee storage, stats, work boost, avatar runtime, stable avatar id, avatar name, lightweight memory/growth state, and navigation-learning state.
  - Shows a startup save-slot menu on every app load before entering the room. The menu supports eight slots, shows existing save summaries including current bits, and includes a top-right language selector using the existing locale preference. Empty slots can create a new save with a user-entered character name or import a local save JSON/folder; the current create flow offers `octopus`, `demo-spark`, `mood-slime`, `cute-crayfish`, `cute-ghost`, and `cute-penguin` avatar appearances through the character selector. `wave-lizard` remains registered for development/old-save compatibility but is hidden from the new-save character selector until its art pass is ready to resume.
  - Manages multi-slot save state with `aivatar.saveSlots.v1`, `aivatar.activeSaveSlot.v1`, per-slot save keys `aivatar.saveSlot.v1.<slotId>`, `aivatar.defaultLayout.v1`, and `layoutVersion: 2` layout migration. New saves get stable `avatarId`, `roomId`, and `avatarAppearanceId` values; older saves missing these fields are normalized with generated ids/default appearance. If no slot registry exists, the legacy `aivatar.save.v1` save is copied into the first slot for migration without deleting the legacy key.
  - Each save slot owns its own character continuity state. `memory`, `memory.growth`, and `navMemory` are stored inside the per-slot `AivatarSaveState`, so character memories, Growth XP/traits/preferences, and learned path/navigation cells must stay tied to that slot during save/load, import, migration, clear-save, and future export work rather than becoming global app state.
  - Room Visit MVP uses the red bottom doorway to invite another simultaneously open save-slot room through the local bridge. The host room renders the guest as an `AivatarRoomVisitor`, while the guest room enters an away state until the visit ends or either room expires. Guest departure is two-stage: the guest first walks out through its own room door, then the host room renders that guest entering from the host door. Visit runtime payloads use `guestRuntimeRoomInstanceId` to record which room coordinate space the guest runtime belongs to, so the host does not render the visitor until the payload switches into the host room. While a guest is leaving its own room, the guest runtime must keep the doorway target locked and must not be overridden by autonomous behavior, busy recovery, or ordinary status mapping. Host-side visitor movement reuses `tickAvatar` collision/navigation through a visit-scoped navigation cache, and `guestSocialNavMemory` carries the guest's host-room nav memory into that simulation without mixing it with the host avatar's ordinary route cache. During host-side socializing, the visitor can choose shared activities such as Game Console play, chat, coffee, admiring decor, relaxing, or wandering; the host avatar mirrors the selected social activity when no high-priority agent status or blocking local interaction is active. Social targets should keep the two avatars visibly separated, and visit bubbles use a short turn-taking rhythm where one avatar plays an active social bubble and the other answers after a small delay. Social coffee is a visual/audio room-visit activity and must not consume inventory coffee or table storage. Autonomous Room Visit is limited to currently open bridge-visible save-slot rooms; it must not synthesize visitors from closed/offline save slots. Each avatar has a hidden per-save `socialWillingness` preference that combines with traits, stats, pair affinity, and cooldowns to decide whether to invite or actively visit another open room. Pair relationship affinity is stored separately from room navigation memory, increases after visits with a small personality-compatibility bonus, lengthens future visits, and unlocks extra social choices such as Record Player dancing and bed-side chatting before dedicated custom poses exist. Host-side socializing now uses a local structured social-bubble library instead of LLM-generated dialogue: each bubble is active or response, carries an `intentId`, optional `replyToIntentIds`, language, activity tags, and host/guest role limits. Active bubbles are matched to one of several compatible response bubbles, host-only and guest-only lines prevent role-inappropriate phrasing, and bubble selection follows the saved idle-bubble language setting (`auto`, `zh`, `en`, or `mixed`). Session learning can provide structured `socialBubbleCandidates`; the Growth panel shows them with social-specific labels, and user-approved candidates are saved under `memory.preferences.socialBubbles` without mixing them into ordinary idle bubbles. Room Visit bubble payloads still support stable `roomVisit.bubble.*` keys in `bubbleText`; App localizes those keys at render time using the current locale so Simplified Chinese, Traditional Chinese, and English switch automatically without rewriting visit state. Room Visit must not interrupt high-priority session mapping: rooms publish `busy` instead of `home` while the local avatar is mapping fresh `thinking`, `executing`, `waiting_for_user`, or `error` states, and busy rooms cannot invite or accept visits until that status clears. Guest navigation learning for a host room must stay in separate social-room-memory storage keyed by guest avatar, host room, and host layout fingerprint, not in the guest's ordinary per-slot `navMemory`.
  - Persists the current active slot whenever save state changes and flushes the latest save ref on `pagehide`, `beforeunload`, hidden `visibilitychange`, and the Tauri `aivatar://save-before-close` event, so confirmed furniture/item layout, inventory, wallet, pet stats, avatar runtime, active wall/floor surfaces, window/furniture placements, furniture storage, and memory/growth state survive closing the app. Clear-save/debug reset behavior resets the current active slot rather than all save slots.
  - Existing startup save slots support `Enter` and `Remove`. `Remove` opens a warning dialog and only removes/unlinks the save from the startup menu/local slot registry; it does not delete any original local save JSON or imported folder, so the user can load that save again later. Local import currently reads a selected `.json` file directly or scans a selected folder for `aivatar-save.json`/`save.json`, then normalizes missing legacy fields into the slot copy.
  - Canvas click priority is placed items first, then base furniture, then active windows, so large windows do not steal clicks from desk objects.
  - Uses content `tags` and `placementSurfaces` for shop grouping, placement targets, and item-vs-furniture labeling.
  - Shop item buttons have a short per-item purchase cooldown to avoid rapid-click state churn. Repeatable non-surface, non-window, non-furniture-skin, non-unique items also support long press: holding a buy button buys up to 10 units, clamped by available bits and current unlock/ownership state. Long-press follow-up click suppression is item-scoped so a completed hold cannot swallow an unrelated later shop click.
  - Adds a Furniture Skins shop category. Furniture skin items use `tags: ["furniture-skin"]` plus `targetFurnitureId`, ownership is stored in `purchasedItemIds`, and the currently applied skin per supported furniture or placed skin target is stored in `activeFurnitureSkinIds`.
  - Furniture skin passes currently include bed, desk, dining-table, fridge, and built-in Terminal skins. Bed skins include Industrial Bed Skin, Wood Red Bed Skin, Ivory Pink Plaid Bed Skin, Modern Minimal Bed Skin, and Space White Deep Gray Bed Skin. Desk skins include Industrial Desk Skin, Rococo Ivory Desk Skin, and Transparent Acrylic Desk Skin. Table skins include Rococo Ivory Table Skin, Dark Oak Table Skin, and White Tech Table Skin. Fridge skins include Ivory Fridge Skin, Red Retro Fridge Skin, and White Tech Fridge Skin. Terminal skins include Green Amber Terminal Skin, White Cyan Terminal Skin, and Neon Dark Terminal Skin, all targeting the locked placed item `builtin-terminal`. Purchased skins can be applied or cleared without entering placement mode and do not affect furniture/item placement, collision, pathfinding, or interaction targets. Clearing an applied furniture skin removes that target id from `activeFurnitureSkinIds` while preserving ownership in `purchasedItemIds`.
  - Furniture and placed-object art should be understood as orthographic / parallel projection: front and back edges do not narrow, there is no vanishing point, and near/far spans remain equal width. Preserve this rule when redesigning desks, tables, beds, cabinets, rugs, windows, and tabletop objects.
  - When furniture or placed items are selected, the canvas shows their generated interaction standpoints and a light gray ground-projection rectangle for the selected furniture/floor item, so movement/arrival targets, placement footprints, and navigation-blocking collision can be visually tuned together. Wall hangings keep their visual selection bounds but do not show a ground projection.
  - Surface items tagged `wall-surface` or `floor-surface` are managed through the Decor panel rather than the backpack: users can buy, apply, and clear applied wallpaper/flooring without entering placement mode. First purchase-and-apply costs `item.price + 1000 bits`; applying an already purchased wallpaper/flooring option costs `1000 bits`; clearing an applied surface is currently free.
  - Window shop items are managed through `purchasedItemIds` and `activeWindowId` rather than backpack inventory: buying a window applies it immediately, purchased windows can be re-applied from the shop without spending bits again, and selected windows can be sold for half price from the window edit panel. Clicking empty room space clears selected/moving window state and window placement previews.
  - The Decor panel is collapsed behind a high-contrast `Decor` button by default. Expanding it reveals a secondary wall/floor tab menu for wallpaper and flooring options. Wall/floor option buttons now use centered pattern thumbnails only; full surface names remain available through hover titles and aria labels.
  - Decor wallpaper options now include Exposed Red Brick Wallpaper, a buyable wall surface rendered with gray mortar, small offset red bricks, per-brick texture speckles/scars, soft edge shadowing, and a lower baseboard drawn as an overlay on top of the brick wall.
  - Inventory and shop item buttons use compact `16 x 16` pixel thumbnails for visible item identity, with names preserved in hover titles and aria labels. Shop buttons show thumbnail plus price, while inventory buttons show thumbnail plus quantity; the thumbnail and number are spaced to opposite sides inside the button for cleaner scanning.
  - The current mapped thumbnail set uses `public/icons/item-icons-arcade-a.png`, a 38-cell (`608 x 16`) RGBA sprite positioned by `ITEM_ARCADE_A_THUMBNAIL_INDICES` in `src/App.tsx` and `.item-thumbnail-arcade-a` in `src/styles.css`. The first 10 cells preserve the confirmed imagegen Scheme A icons for Coffee, Cola, Bento, Cookie, Record Player, Game Console, Oil Easel, File Cabinet, Tiny Plant, and Cyberpunk City Window; later cells cover Cozy Rug, Morph Blob Rug, Blue Persian Rug, Desk Lamp, empty Coffee Cup, Digital Wall Clock, Terminal Monitor, Coffee Machine, Poster, Sky Sentinel Poster, Cozy/City Night/Ocean windows, current bed/desk/table/fridge furniture skins, and Repair Kit. Terminal skin shop thumbnails use the separate `public/icons/terminal-skin-icons.png` 3-cell (`48 x 16`) RGBA sprite, positioned by `TERMINAL_SKIN_THUMBNAIL_INDICES` in `src/App.tsx` and `.item-thumbnail-terminal-skin` in `src/styles.css`, so they match the compact item-button thumbnail style without bloating the older arcade icon sheet. Mapped item ids use sprites; unmapped ids still fall back to their existing lightweight DOM/CSS thumbnail branches. These are UI thumbnails only and do not change canvas room art, behavior, placement, collision, or Decor wall/floor surface pattern previews.
  - Window shop buttons keep showing their price in the visible button label even after purchase/re-apply state, so purchased window options do not replace the price text with `ready`.
  - Stores table coffee in `furnitureStorage` and shows the current table coffee count/capacity in the Debug panel.
  - Table coffee capacity is now driven by placed `coffee-cup` items on the dining table: each table Coffee Cup contributes one visible storage slot, and table coffee is clamped when cups are moved, stored, sold, or deleted.
  - Migrates and preserves the built-in Terminal as locked placed item `builtin-terminal`.
  - Prevents the built-in Terminal from being stored, sold, or deleted; it can still be moved in Room Edit Mode and can receive visual-only Terminal skins through the Furniture Skins shop.
  - Left-clicking furniture or placed items now selects them only. Avatar-triggering actions such as Terminal `Interact`, Coffee Machine `Brew`, Game Console `Play`, Record Player `Play music`, Oil Easel `Paint`, and furniture interactions are launched from a right-click scene context menu, preventing accidental interactions during layout editing/inspection.
  - Selecting placed items, room windows, or furniture from the canvas automatically scrolls the visible right-side panel to the active Room Edit card when the side panel is open, so edit actions are easier to find.
  - The built-in Terminal is interacted with from the right-click context menu, routes through the queued placed-item interaction flow before entering the local coding animation, and no longer grants bits or work boost directly.
  - Consumes bridge snapshots with `currentStatus`, `sessions[]`, `activeSessionKey`, `connectedSessionKey`, and `currentSessionKey`; the main avatar follows `currentStatus`, while the side panel shows recent sessions, Follow/Clear controls, and Active/Connected/Current/Idle/Stale markers.
  - Agent Sessions is collapsed behind a compact side-panel button by default. The button shows live/total session count, Current/source context, and a `+`/`-` affordance; expanding it reveals Follow/Clear/Disconnect controls, CLI hints, session cards, context window meters, reward summaries, and Active/Connected/Current/Idle/Stale markers.
  - Agent Sessions includes a `Clear Stale` button that asks the bridge to prune expired/stale session rows. Session expiry is now driven by each bridge session's `expiresAt` timestamp.
  - Desktop Agents is collapsed behind a compact side-panel button by default. It calls Tauri `get_agent_integrations` to show Claude Code and opencode detection/enabled status, CLI availability, connector paths, and restart-needed hints, and calls `enable_agent_integration` from the Enable/Repair buttons. In web-only previews the card shows a desktop-only message instead of trying to write user agent config.
  - The bridge separates long session retention from short activity freshness: sessions can remain listed for the configured `AIVATAR_SESSION_STALE_MS` window, while stale high-priority activity stops driving the avatar after `AIVATAR_ACTIVITY_STALE_MS` (default 5 minutes). This prevents a closed Claude Code CLI from leaving the avatar stuck in an old `executing` state.
  - Agent Sessions ordering now prioritizes actual status timestamps before presence heartbeat timestamps, reducing visual jumping when many connected sessions keep refreshing presence.
  - Complete rewards are transition-gated for reward-eligible agent sessions defined in `src/agentRegistry.ts` (`codex`, `claude-code`, and `opencode`) moving from `thinking`, `executing`, `waiting_for_user`, or `error` into `complete`, and also tolerate a fresh active/connected `complete` snapshot so rewards are not missed when the first UI-visible status is already complete. Repeated Live reads of the same complete event do not reward again.
  - Reward-eligible `complete` events now also play `agent-complete-success.ogg` once after the existing complete-event de-duplication, so repeated bridge reads do not replay the success sound.
  - Complete rewards can use turn token usage from the status payload. Context-window-only usage with `scope: "context-window"` is used for meters but ignored by bits rewards. When turn usage is present, bits are based on weighted tokens: uncached input, output, and reasoning tokens count fully, cached input counts at 10%. The reward is capped at 100 bits by default and 1000 bits when total token usage is greater than 1,000,000, before any work boost bonus. Without reward-eligible turn usage, rewards fall back to the fixed 4-bit base.
  - Reward-eligible agent `complete`, `error`, and `waiting_for_user` statuses now update lightweight memory/growth state, including XP, recent memory events, and trait changes.
  - Life events such as sleeping, playing, using Coffee/Cola/Bento/Cookie, brewing Coffee, and buying items also write compact recent memory entries and small trait/preference changes.
  - Agent Sessions cards display model context window usage when `usage.contextTokens` and `usage.modelContextWindow` are present, and display token reward context as `tokens -> bits (weighted)` when a session includes reward usage. Context-only usage with `scope: "context-window"` is not shown as a reward summary.
  - Agent Sessions preserves a session's latest known usage/context payload when a later status update omits `usage`, so terminal `complete`/`final_answer` events do not erase context-window meters.
  - Busy recovery allows the avatar to briefly leave high-priority agent work to drink coffee, eat food, or play games when stats are low, then return to the current agent state. If no recovery item is available, the avatar keeps working and is visually depleted instead of sleeping.
  - `thinking` does not trigger busy recovery, so the avatar keeps its focused thinking behavior instead of immediately switching to snacks or play while the agent is thinking.
  - Consumable use now routes Coffee, Cola, Bento, and Cookie into distinct avatar behaviors when those specific items are consumed. Manual backpack clicks preserve the selected item, while automatic `snack` behavior chooses between Bento and Cookie from personality and affinity: creativity/curiosity lean Cookie, resilience/focus/efficiency lean Bento, and prior item affinity can break ties.
  - Consumable SFX are synchronized to real action playback rather than approach movement: Cola plays a can-opening fizz after fridge-door opening when applicable, then a short drink sound; Coffee plays `coffee-drink-slurping.mp3`; Bento and Cookie reuse `bento-eat-munchin.mp3`. Longer Coffee/food clips are stopped and reset when the corresponding action ends so they do not continue over later behaviors.
  - Sleep restores energy while the avatar is sleeping even when an agent session remains active, and sleep completion resets the runtime behavior back to idle/calm so the sleep animation does not stick.
  - Ordinary short UI messages no longer block autonomous eating/drinking recovery; short feedback interactions such as feed, work, brew, and reward have explicit or default timeouts so they do not permanently block later behavior.
  - Timed feedback bubbles with `endsAt` are cleaned up generically, and reward bubbles use a 10-second duration.
  - Coffee Machine brewing costs `1 bit` for both manual and autonomous brewing; if bits are insufficient, brewing is blocked and no Coffee is produced.
  - Coffee Machine production fills available table Coffee Cup slots first, then falls back to inventory capacity.
  - Autonomous Coffee Machine brewing sets a `brew` active interaction against the actual placed Coffee Machine instance id, so the machine's brewing lights, stream, fill, and steam animation can trigger while the avatar brews.
  - Coffee Machine brewing now plays `coffee-machine-brew-loop.ogg` while the avatar is in real `brew` behavior and the active interaction is the placed Coffee Machine target. The loop uses a reduced volume multiplier so it stays behind other room feedback.
  - Expired Coffee Machine `brew` interactions explicitly reset the avatar out of `brew`, clear the coffee accumulator, clear stale interaction targets/activity labels, and convert the interaction to a short non-brewing feedback state so autonomous brewing cannot immediately re-open an endless brewing animation loop. Autonomous brewing also has a short cooldown after completion or blocked brew attempts so the Coffee Machine does not repeatedly steal idle-life cycles.
  - Real avatar interactions now follow a unified "arrive first, then interact" flow for furniture, placed items, and backpack consumables. Coffee Machine brewing, Game Console play, Record Player music playback, Oil Easel painting, and consumable effects are queued as world interactions and only apply after the avatar reaches the target. Room editing, ordinary left-click selection, right-click context menu opening, and Decor surface/window application remain immediate UI operations.
  - Avatar runtime now separates movement intent from action playback with `actionIntent` and `actionActivityLabel`. Arrival-gated behaviors such as sleep, relax, brew, snack, coffee/cola/bento, play, music, paint, coding/thinking, task-file actions, and placed-item interactions first move as an approach/wander state, then switch into the real action only after reaching the interaction point.
  - Action execution ranges are intentionally narrow around interaction points. Most actions require the avatar to reach within `8px` of a generated standpoint; the dining table keeps its broader rectangular trigger for ergonomic eating/drinking, while bed sleep and relax use a single bed-top point so the avatar settles under the blanket/at the bed position before the action plays.
  - Desktop/tabletop placed-item interactions no longer ignore the host `desk`/`table` collision for the whole route. The app relies on generated standpoints near the furniture edge, so Coffee Machine, Terminal, and Game Console interactions should route to reachable edge points instead of walking through the host furniture. Close furniture/tabletop standpoints are currently tuned to about `7px` from the relevant furniture edge; the Terminal keeps its special closer surface standpoint.
  - Tabletop Coffee Machine interaction standpoints are intentionally limited to the three front points only: centered, left-offset, and right-offset along the host furniture's front edge. This avoids side-point selection around table/desk collision edges.
  - The built-in Terminal / `terminal-monitor` interaction standpoint is intentionally limited to one centered front point on the host desk/table. This keeps coding/thinking interactions deterministic and avoids the avatar starting Terminal work from side or offset points.
  - Interaction arrival checks now treat the avatar's small ground-footprint rectangle as arrived when it touches an interaction standpoint, with the previous center-distance check retained as a fallback. This keeps the avatar from pushing endlessly into furniture edges once its visible foot box has reached the target marker.
  - Interaction arrival now only considers the currently selected `targetX`/`targetY`; alternate interaction points are used for rerouting after stalls, but merely passing near an alternate point no longer starts the action early.
  - Game Console play sets the avatar facing toward the placed console after arrival instead of forcing a generic front-facing pose. Mood recovery and console screen animation now use the active placed Game Console target or a near-active-play-target check, so autonomous play can animate the correct console even when the avatar stands at an edge interaction point.
  - Game Console sound follows the same active play target logic as the screen animation after real `play` behavior begins. Manual right-click `Play` and autonomous play recovery both trigger sound, while the walk-to-console `actionIntent` phase does not.
  - Record Player is a buyable placed object with `tags: ["item", "record-player"]`. Manual right-click `Play music` queues an arrive-then-start interaction against the exact clicked Record Player, while autonomous music uses the same placed-item targeting flow after `autoMusicEnabled` allows the behavior. Starting playback sets `activeRecordPlayerId`; the avatar then returns to `idle` so it can do other things while the record continues. Room Visit social music treats an already-active target Record Player as a shared dance/interact target instead of re-triggering playback, so visitor music activities do not repeatedly switch tracks. Right-clicking a Record Player exposes BGM volume control and a `Stop music` action. Playback slows natural Mood decay to `35%` of the ordinary rate instead of granting periodic Mood recovery. Personality trait changes happen only when the avatar autonomously starts music: `creativity +1`, `warmth +1`, and an extra `resilience +1` when Mood is low. Manual playback does not add personality points.
  - When multiple placed copies of the same autonomous interactive item exist, automatic target selection uses a `70%` nearest / `30%` random rule. This currently covers Game Console play, Coffee Machine brewing, Oil Easel painting, Terminal/coding targets, and busy-recovery Game Console selection. Manual right-click interactions still use the exact clicked object.
  - Oil Easel is a buyable Furniture-category placed object implemented as `kind: "decor"` with `tags: ["furniture", "easel"]`. Right-clicking it opens a context action that queues an arrive-then-`paint` interaction; painting restores mood over time, records compact memory with `creativity +1`, and advances the current save-slot painting draft toward a 3-hour cumulative completion target. New drafts render immediately from a local heuristic plan, then asynchronously ask the local bridge `POST /painting-plan` for an LLM-style painting plan based on low-sensitivity personality traits, recent memory summaries, preferences, and saved idle bubbles. If the bridge/provider is unavailable, the heuristic draft remains valid. Completed paintings move into a collapsible save-slot gallery with a quality-based sale value; selling the finished work grants the bits, while applying it to selected wall poster hangings does not. A selected hanging with applied gallery art can clear its `artworkId` from the same gallery panel without deleting the artwork. Its floor placement foot projection is now also used as a placed-item navigation collision box.
  - Idle/autonomous life uses a layered weighted-choice model: recovery layers handle low energy, hunger, mood, and mildly low energy first, while healthy idle life chooses among play, paint, brew, explore, admire, interact, wander, phone, snack, relax, and appearance-gated specials by weights. The current appearance-gated special is `workout`, which only `cute-crayfish` can choose when stats are healthy and Energy is high enough. Trait boosts adjust weights rather than using absolute thresholds, so later behaviors such as explore/admire/interact are no longer hidden behind earlier play/paint/brew checks. `brew` is intentionally low-weight so the Coffee Machine does not dominate idle behavior. Autonomous behavior durations are now behavior-specific rather than a uniform short random window; longer activities such as Game Console play and Oil Easel painting linger substantially longer.
  - Idle/autonomous life can choose an `explore` behavior when stats are healthy. Exploration walks toward sampled room/object-near targets and helps maintain learned navigation grid values in `navMemory.walkableCells`.
  - Navigation learning now records a lightweight local occupancy grid in `navMemory.walkableCells`, where `0` means learned walkable and `1` means learned blocked/risky. Ordinary movement, arrival success, stuck/failure events, and explicit exploration update these values. `navMemory.layoutFingerprint` invalidates learned grid values when furniture/blocking layout changes. Older `exploredCells` and `trickySpots` remain normalized for compatibility, but route costs no longer depend on tricky/visited-cell penalties.
  - Growth is now collapsed behind a compact side-panel button by default. The button shows `Growth`, current level, XP progress, and a `+`/`-` affordance; expanding it reveals a six-axis personality hex chart, recent memory, and idle bubble controls.
  - Growth traits are now six-dimensional: `focus`, `resilience`, `curiosity`, `efficiency`, `creativity`, and `warmth`. Raw trait points are capped at `1_000_000` per axis, while the enlarged, centered hex chart uses `log10(points + 1)` normalized against that cap for display; hovering the small hex node at each chart corner shows that trait name and raw point count in a larger center label. Growth labels, level/XP text, recent memory heading, trait chart labels, and collapsed room HUD trait text are localized through `growth.*` i18n keys.
  - Growth idle bubble controls show saved phrases, session-derived suggestions, learning-derived suggestions, memory-derived suggestions, and a language preference (`auto`, `zh`, `en`, `mixed`). Users can add suggested short phrases into `memory.preferences.idleBubblePhrases`, with saved phrase slots capped by the current avatar level, and can remove saved phrases from the same panel.
  - Idle bubble suggestions shown in Growth use an explicit source mix: target 3 memory-derived candidates and 3 session-derived candidates, with either source filling remaining slots when the other has fewer available candidates.
  - Consumes optional `status.learning` payloads from the bridge. New `learning.id` values write a `session_learning` recent memory event, apply small XP/trait changes, and add learning-derived suggested bubbles. `privacyRisk: "high"` learning payloads are ignored by the save layer.
  - `phase: "session-learning"` status updates apply learning only and do not trigger Codex/Claude complete rewards or error/waiting memory, preventing duplicate bits or duplicate task memories after the worker posts a learning result.
  - Growth suggested bubbles preserve candidate source metadata in memory only. If the same phrase arrives from multiple sources, source priority is `llm > session > memory`; `learning.source === "llm"` candidates render with an `LLM` label and highlighted styling. Session candidates also render compact source badges from `src/agentRegistry.ts`: Claude Code suggestions show `CC`, Codex suggestions show `Codex`, and opencode suggestions show `OC`; these badges stay visible even when phrase slots are full and buttons are disabled. Accepted bubbles are still saved as plain strings, preserving the existing `localStorage` schema.
  - Posts a low-sensitivity avatar state snapshot to the bridge at `http://127.0.0.1:38988/avatar-state` whenever saved memory/avatar identity changes. The payload includes avatar id/name, growth level, trait totals, and idle bubble language preference only. It uses `fetch` first and `sendBeacon` as fallback, allowing session-learning workers to tune bubble tone from current personality without reading full browser `localStorage`.
  - The whole right-side menu can collapse into the room window through a narrow right-edge triangle handle. Collapsing locks the current room scene width, resizes the Tauri desktop window down to the room width, and keeps lightweight room HUD overlays visible over the room.
  - Collapsed room HUD overlays show pet Energy/Mood/Hunger at the upper left, Growth level/XP/dominant trait at the upper right, and a full-width token HUD near the lower edge when context usage is available. The token HUD keeps the same compact footprint while showing up to three rows: context-window usage, Codex 5-hour token-limit usage, and Codex weekly token-limit usage.
  - Classic UI skin currently covers the app shell, side panel, status header/card, Settings, Growth, Agent Sessions, Desktop Agents, Task Cabinet, CLI Launcher, Debug, stats grid, Decor controls, Inventory/Shop text, Asset Studio locked entry, expanded submenu cards, scene right-click context menus, custom context meters, collapsed room HUD overlays, Decor surface thumbnails, and common button/input states with Windows 98-style raised/sunken borders.
  - Terminal UI skin currently covers the side-panel shell, status header/card, Settings, Growth, Agent Sessions, Desktop Agents, Task Cabinet, CLI Launcher, Debug, stats grid, Decor controls, Inventory/Shop text, Asset Studio locked entry, expanded submenu cards, scene right-click context menus, custom context meters, collapsed room HUD overlays, and common button/input states. Settings has explicit compact and expanded theme coverage, including the speaker volume icon, nested name editor, language/theme buttons, sound sliders, checkboxes, and selects.
  - Arcade Cabinet UI skin currently covers the app shell, CRT-like scene panel, side panel, status header/card, Settings, Growth, Agent Sessions, Task Cabinet, CLI Launcher, Debug, Decor controls, startup save-slot dialog/cards, expanded submenu cards, scene right-click context menus, session/task status variants, custom context meters, collapsed room HUD overlays, common buttons, inputs, range sliders, meters, disabled states, and save/avatar-choice cards. Its visual language uses a matte black arcade body, cyan/magenta trim, scanline overlays, amber coin/status accents, and raised plastic arcade-button highlights while keeping the existing dense operational layout. The scene panel owns an Arcade-specific top bright strip in both HUD/collapsed and expanded layouts, and the canvas receives an Arcade-specific bubble/backdrop palette instead of falling back to generic Terminal colors.
  - Starship UI skin currently covers the app shell, starship-console scene frame, side panel, status header/card, Settings, Growth, Agent Sessions, Desktop Agents, Task Cabinet, CLI Launcher, Debug, Decor controls, startup save-slot dialog/cards, expanded submenu cards, scene right-click context menus, session/task status variants, custom context meters, collapsed room HUD overlays, common buttons, inputs, range sliders, meters, disabled states, save/avatar-choice cards, and canvas bubbles/status overlays. Its visual language uses original black/apricot/lavender/pale-cyan segmented controls and asymmetric rounded strips while keeping the dense Aivatar operational layout. English Starship UI self-hosts the OFL-licensed Antonio variable font under `public/fonts/antonio`; Simplified Chinese Starship UI uses Antonio for Latin glyphs and the OFL-licensed Smiley Sans under `public/fonts/smiley-sans` for CJK glyphs, while Traditional Chinese continues to use the existing CJK fallback stack.
  - Chinese UI typography has a local CSS font-face alias, `Aivatar CJK Serif`, that uses local `Noto Serif TC`, `Noto Serif SC`, or `Noto Serif HK` only for CJK unicode ranges. Classic overrides the general serif CJK look with a readability-first Windows UI stack: `Tahoma`, `Microsoft YaHei UI`, `Microsoft JhengHei UI`, then legacy CJK fallbacks. Classic also raises small helper/status text to about `11px` and avoids overly heavy weights so Chinese labels do not blacken at small sizes.
  - The right-side card header UI has been visually tuned for Chinese readability: compact card titles are larger and bolder, helper/status text is slightly larger, `+`/`-` expand buttons are smaller and use centered monospace symbols, and title text is nudged down by 1px to align visually with the expand buttons.
  - The pet stats grid (`Energy`/`Mood`/`Hunger`, localized as `精力`/`心情`/`饱足`) now sits above the Growth card so core pet condition is visible before deeper growth/session controls.
  - Right-side expanded submenus use a slightly lighter nested background than their parent cards so Growth, Agent Sessions, Debug, and Decor hierarchy reads more clearly.
  - Side-panel collapse/expand uses a Rust-backed Tauri command so the main-window minimum size and size are updated together. The room stays left-aligned and scene width is temporarily locked during resize to avoid visible jumps.
  - Includes a collapsible CLI Launcher panel where users enter a working folder, choose Codex, Claude Code, or opencode, optionally provide args, and start an agent CLI through the Tauri `start_agent_cli` command. Agent labels, source badges, reward eligibility, terminal-bubble eligibility, and launcher availability are centralized in `src/agentRegistry.ts`.
  - Makes the File Cabinet a buyable unique furniture item in the shop, unlocked at Growth level 25. The save layer records cabinet ownership/placement as a `placedItems` entry, while runtime content converts a placed cabinet into a `FurnitureDefinition` so it reuses base furniture rendering, hit testing, movement, collision, and avatar occlusion.
  - Includes a Task Cabinet side-panel MVP for local `.md` task paths. Task metadata is stored in `localStorage` key `aivatar.taskCabinet.v1`; source `.md` files remain read-only and the app stores paths/status/schedule metadata rather than file contents.
  - Task Cabinet supports `Ready`, `Running`, `Completed`, and `Failed` states; `Run Next`; per-task `Schedule`; per-task `Profile`; and `Rerun` for failed tasks. The older global `Auto Run` control was removed so automatic execution only comes from explicit per-task schedules.
  - Task Cabinet per-task schedules support `Once` and `Repeat`, `Run at`, repeat interval in minutes, and conditions (`Always`, `Only idle`, `After success`). Schedule checks run while the app is open, use a 5-second polling interval, and display `Due now` when the next scheduled time has passed.
  - Task Cabinet uses the current CLI Launcher agent, cwd, and args when starting tasks. Running tasks record `agent`, `cwd`, `sessionId`, timestamps, and error text when startup or agent status fails. If a scheduled task is due but the CLI Launcher folder is missing, the task remains `Ready` and records a visible diagnostic rather than silently doing nothing.
  - Task Cabinet maps bridge sessions back to tasks by `agent + sessionId`: `complete` marks a task `Completed`, `error` marks it `Failed`, and only a real exit/disconnect-style `idle` without a prior terminal status marks it failed with `Agent exited before reporting completion.` Startup `idle`, presence `idle`, and `Running ...` placeholder statuses are ignored so Claude Code's initial hook/statusLine idle does not fail a task before the prompt begins. The UI remembers same-session terminal `complete`/`error` states so late `idle` snapshots cannot downgrade an already completed task.
  - Task Cabinet starts a visual task-file flow when a task launches: the avatar heads to the File Cabinet with `fetch_task_file`, plays the file-taking pose, carries the paper to the built-in Terminal with `carry_task_file`, then reads/executes near the Terminal with `read_task_file`. Fast tasks such as hello-world prompts keep the visual flow alive long enough to reach and read at the Terminal before ordinary agent status takes over again.
  - Task Cabinet has desktop Browse buttons for selecting `.md` task files and the CLI Launcher folder through Tauri commands, avoiding manual path entry.
  - Task Cabinet entries are capped at 100 saved task paths to keep `aivatar.taskCabinet.v1` bounded.
  - Task Cabinet `Profile` currently supports `Default` and `Fast`. `Fast` appends `--bare` for Claude Code. Codex `Fast` is a reserved UI entry until a verified MCP-skip flag is available, so it does not pass unknown Codex CLI flags.
  - Debug is collapsed behind a compact side-panel button by default. The button shows `Debug`, the current source, Live/Override state, and a `+`/`-` affordance; expanding it reveals local status overrides, trait training, Tauri-only Start bridge, Add supplies, Demo actions, Window preview, fixed Window time controls, Save layout, Clear save, bridge endpoint, boost status, and table coffee storage.
  - Debug controls include a Tauri-only Start bridge button, an Add supplies test button that grants bits/Coffee/Bento/Cookie/Cola and fills currently available table Coffee Cup storage for recovery testing, six trait training buttons, and a `Demo actions` behavior cycle for inspecting every avatar behavior state, including the idle-only phone animation and task-file fetch/carry/read poses.
  - Current character-preview worktree has the Debug card temporarily enabled with `SHOW_DEBUG_CARD = true` in `src/App.tsx` for visual QA. Decide whether to restore the default hidden/collapsed behavior before packaging or merging this work.
  - Debug includes a temporary `Nav grid` overlay for navigation QA. It draws green walkable samples, red blocked samples/collision boxes, the avatar foot ellipse, the current target, candidate interaction points, and the current A* path so stuck spots around furniture can be diagnosed visually. The overlay avoids recalculating and drawing A* target paths while the avatar is truly idle with no action intent, preventing stale idle targets from causing expensive per-frame pathfinding. The overlay may still show planner-expanded blocking samples when clearance is enabled, so distinguish those from the actual furniture collision rectangle.
  - `Window preview` accelerates the room window's time input so dynamic windows such as City Night Window, Ocean Window, and Cyberpunk City Window can be visually checked across a full day/night cycle without changing the system clock. The fixed `Window time` slider and `06:00`/`12:00`/`18:00`/`22:00` presets override the dynamic window time until `Real time` is selected.
  - When a Debug status override is active, the status card shows `Debug override active - click Live` and the Live button is highlighted so test overrides are not mistaken for live agent state.

- Card Room / poker side room
  - `src/main.tsx` routes `?view=card-room` to `CardRoomApp`. The main room should only open or link to this dedicated room; Card Room play, chip exchange, poker controls, and poker HUD state belong in `src/cardRoom/CardRoomApp.tsx`.
  - `src/cardRoom/cardRoomContent.ts` defines a separate wide poker room, not a stretched copy of the main room. It uses its own wall/floor/furniture layout, contains the large poker table as real room furniture, owns Card Room decor/shop categories, and persists Card Room decor state under `aivatar.cardRoom.decor.v1`. It should not import or mirror the active main-room placed items. The current Card Room furniture shop has no active sellable furniture entries; keep `cardRoomFurnitureByShopItemId` as compatibility definitions, and normalize saved purchased/placed furniture through active `cardRoomShopItems` so downlisted furniture does not keep rendering from old saves.
  - `src/cardRoom/CardRoomApp.tsx` owns the Card Room React shell, canvas loop, save-slot roster selection, invited companions, Card Room visit invitations/away-state cleanup, player name editing, Card Room-local player wallet, dedicated chip shop, compact target-wager controls, called-clock UI/timing, poker controls, top/bottom HUD, AI action timing, hand result persistence, one-shot deal/reveal/winner motion timing, and dark-trait writes. Keep the Card Room shop here rather than adding poker-chip exchange to the main room shop. Decor shop tabs should be derived from categories with active shop items, so an empty furniture category is hidden until future Card Room furniture items are reintroduced.
  - Card Room visible copy, including shop names/descriptions, HUD labels, table logs, action cues, visitor bubbles, and hand/result summaries, should stay locale-derived for `zh-Hant`, `zh-Hans`, and `en`. Compatibility furniture definitions may be localized while remaining inactive/hidden until future Card Room furniture shop items are reintroduced.
  - `src/cardRoom/cardRoomRenderer.ts` draws the dedicated room canvas: lower wall height, floor, city window, wall sconces, poker table, red sofa seats, real avatar occupants, hidden/user-only bottom seat, community cards, table-positioned hole cards, per-seat chip stacks, per-seat bet chips, card/action text, bet-to-pot and pot-to-winner chip flights, winner burst effects, and top-down table collision visualization. Do not render the user's avatar in the room; the user's hand is shown in the lower floating hand area.
  - Card Room sound effects are presentation-layer behavior owned by `CardRoomApp.tsx`. They reuse the main room global SFX volume from `aivatar.audioVolume.v1` and the same first-user-interaction unlock model rather than adding a separate Card Room volume setting. Current cues include per-card dealing, ordinary bet/call/raise/blind chip pushes, all-in chip pushes, pot collection/payout settlement, user victory, and softer randomized non-user character victory.
  - Card Room audio asset provenance belongs in `public/audio/README.md`. Current Card Room SFX assets live under `public/audio/card-room-*.mp3`; `cardRoomRenderer.ts` may expose narrow animation metadata such as `CardRoomChipFlight.actionType` for cue selection, but poker truth and settlement math must stay in `holdemEngine.ts`.
  - `src/cardRoom/cardRoomRuntime.ts` owns Card Room visitors and movement. Before a hand, save-slot characters enter as visitors, can free-roam, reuse furniture/placed-object interaction style, show short Card Room social bubbles, and maintain Card Room navigation memory separately from ordinary per-slot `navMemory`. When a hand starts, characters walk to seats and enter `seated`; already seated characters should keep their assigned seat across later hands until explicitly released to free roam. Do not apply a seat target's final facing direction until the character has effectively reached the seat; on arrival, snap to the exact seat target and facing so characters do not appear to walk backward into place.
  - Card Room table collision must be real navigation collision. Characters should route around the table footprint and never walk on top of the visual poker table except for deliberate seated/table-edge presentation positions.
  - Seat assignment should remain character-driven rather than fixed by roster order where practical. The bottom seat is reserved for the user and must stay visually empty; other seats can be used by characters around the top, left, and right sides of the table. Cards in front of side/top players should face that player's side, while chip-stack icons stay visually upright.
  - Side sofas use directional red-sofa sprites plus a foreground armrest mask. For free-roam depth, characters in front of a sofa should cover the sofa, characters behind it should be covered by the sofa, and side sofa armrests should remain visually integral to the seat rather than separate hollow overlay pieces.
  - Static Card Room image assets live under `public/assets/card-room/`. The current fixed PNG assets are `city-window-wide.png`, `wall-sconce.png`, and card-face/back reference files under `public/assets/card-room/cards/`; Card Room floor, wall, table, and sofa art are still code-embedded palette/row matrix sprites in `src/cardRoom/cardRoomFloorSprites.ts`, `cardRoomWallSprites.ts`, `cardRoomTableSprites.ts`, and `cardRoomSeatSprites.ts`. `city-window-wide.png` relies on transparent rounded corners; if the PNG changes, verify its alpha on a checkerboard background and bump the renderer query string if browser cache would hide the update.
  - The current table art is a `640 x 220` sprite with public-card frame guides baked into `cardRoomTableSprites.ts`. Keep the public-card frame and shallow guide line in the table asset rather than reintroducing runtime overlay patches. Runtime community cards should stay aligned to `COMMUNITY_CARD_FRAME_CENTERS_X` and `COMMUNITY_CARD_FRAME_CENTER_Y`.
  - Playing-card faces are procedurally drawn by `drawPlayingCard`: rank text is mirrored in opposite corners, suit art is a centered vector glyph, and all card-face art must stay clipped inside the card rectangle. Table cards and the bottom user hand should share this drawing style, with hand-card scale adjusted through the hand-card canvas constants rather than a separate DOM card face.
  - Seat, hand, stack, and bet anchors belong in `opponentSeatSpot`, `userSeatSpot`, and `stackChipsBesideSeatCards`. The user seat is a bottom table position aligned opposite the second top seat; its committed bet label should sit close to the hand but remain above the hand cards, and side-seat bet anchors can be adjusted independently when crowding appears.
  - Chip-stack drawing stays compact and capped: `0 chips` shows only the numeric label, positive stacks use a `10`-row cap with `350 chips` per visual row, and positive chip piles use ten value-tier palettes from warm colors toward cool colors, ending in black/gray for the highest tier. Negative/debt-like stacks stay red warning colors instead of value-tier colors.
  - Pot visuals are phase-specific. During normal betting streets, the Pot area shows the numeric `POT` value only. At settlement, committed bet piles fly from each seat to the Pot, then Pot chips fly to winners; the Pot clears quickly after payout takeoff, and the payout flight count is based on the visible Pot stack count to make large wins feel substantial without changing payout math.
  - `src/cardRoom/holdemEngine.ts` is the Texas Hold'em rules engine: deck/deal, blinds, legal actions, betting streets, folds/checks/calls/bets/raises/all-ins, called-clock timeout actions, showdown, winner/rank labels, and pot distribution. It owns short all-in/full-raise reopening behavior, uncalled-chip refunds, side-pot/odd-chip settlement, and showdown reveal order. Table stacks use poker chips only; do not make table-side credit a hidden stack source.
  - Dealing, blind rotation, active-player flow, and presentation animation should follow the same clockwise seat order. Keep the user/bottom seat, left side seat, top seats, and right side seat ordering consistent across `CardRoomApp.tsx`, `holdemEngine.ts`, and `cardRoomRenderer.ts`.
  - `src/cardRoom/pokerAi.ts` derives poker action choice from public table state, private hole cards, normal Growth traits, and hidden `memory.darkTraits`. `choosePokerAiMove` returns the action plus a non-fixed `delayMs` and a pre-action cue such as `think`, `hesitate`, `pressure`, or `snap`; `CardRoomApp` should render that pre-action cue before applying the final fold/check/call/bet/raise/all-in cue.
  - `src/cardRoom/saveRoster.ts` reads the local save-slot registry, derives Card Room characters from real saved avatars, normalizes `memory.darkTraits`, persists `wallet.pokerChips`, and writes dark-trait changes back through each character's save slot. Keep gambling memory scoped to `memory.darkTraits`; do not mutate unrelated main-room memory structures.
  - `src/cardRoom/chipEconomy.ts` defines the Card Room chip economy. Saved characters exchange their own `wallet.bits` into `wallet.pokerChips` and can borrow bits up to `CARD_ROOM_BITS_DEBT_LIMIT`. The user/player is not a saved character and has no bits account; the user has a separate Card Room-local `pokerChips` / `chipDebt` wallet with its own borrowing limit.
  - Top HUD result text should describe the completed hand in reader-facing terms: winner name, payout delta, and winning hand rank. Bottom HUD should show the user's real card faces as poker cards, current chips/debt, status, and action buttons beside the hand without covering the room canvas.
  - User victory has two visual layers: Canvas winner bursts are derived from real `table.winners` / `motion.completionStartedAt`, and the React overlay uses `.card-room-victory-overlay` for spotlight, rings, medallion, and confetti. `?victoryDemo=1` is a development-only preview switch that plays the user victory overlay once without changing table state, settlement, or saves.
  - Verify Card Room behavior in the live preview at `http://127.0.0.1:1427/?view=card-room`, in addition to `npm run build` and `git diff --check`, because most Card Room regressions are visual/runtime issues rather than TypeScript-only issues.

- `src/agentRegistry.ts`
  - Central registry for first-class agent integrations shown in the app. It currently defines Codex, Claude Code, and opencode labels, short source badges, launcher command names, complete-reward eligibility, Terminal bubble eligibility, and Launcher availability.
  - `src/App.tsx` uses this registry for CLI Launcher buttons, Growth suggestion source badges, display names, and reward gating. `src/game/renderScene.ts` uses it to decide which agent statuses can show Terminal notification bubbles.

- `src/types.ts`
  - Defines runtime status, content, save-state, placement, inventory, furniture, room surface/window, pixel asset types, and avatar behavior names including the local-only `phone` idle animation behavior, the idle-learning `explore` behavior, the Oil Easel `paint` behavior, and task-file visual behaviors (`fetch_task_file`, `carry_task_file`, `read_task_file`).
  - `RoomWindowDefinition.kind` currently supports `cozy-window`, `city-night-window`, `ocean-window`, and `cyberpunk-city-window`.
  - Includes the `file-cabinet` content tag used by the buyable unique File Cabinet furniture/task-cabinet visual MVP, plus the `easel` tag used by the Oil Easel placed-object painting interaction.
  - Defines Task Cabinet task metadata types: `TaskCabinetStatus` and `TaskCabinetEntry`. Task entries store the source `.md` path and execution metadata such as status, agent, cwd, session id, timestamps, and error text, but not the `.md` file content.
  - Defines lightweight Memory & Growth types: `AivatarMemory`, `AivatarGrowth`, six-axis `AivatarGrowthTraits`, `AivatarMemoryEvent`, `AivatarPreferences`, and `AivatarMilestone`.
  - Defines hidden Card Room dark-trait support through `AivatarDarkTrait`, `AivatarDarkTraits`, and `AivatarMemory.darkTraits`. The dark traits are `greed`, `foolishness`, `recklessness`, `cowardice`, `arrogance`, and `coldness`; they should affect poker behavior together with normal Growth traits without replacing main-room personality.
  - `AivatarContent.defaultSave.wallet` and `AivatarSaveState.wallet` include optional `pokerChips` alongside `bits`. Only saved characters have `bits`; the Card Room user/player wallet is local to Card Room state and should not be modeled as a normal save-slot bits account.
  - Defines `AivatarNavMemory`, which stores exploration/navigation-learning counters plus learned `walkableCells` occupancy values, `layoutFingerprint`, success/failure counts, and the latest exploration timestamp.
  - `AvatarRuntime` includes `actionIntent` and `actionActivityLabel` for arrival-gated actions. `behavior` can represent the current approach/movement state while `actionIntent` records the real action to start after arrival. It also includes optional `navigationFailure` metadata so the App layer can clear pending interactions and show blocked feedback when a target cannot be reached.
  - `CodexStatusMessage` can carry optional `idleBubbleCandidates?: string[]` from the local bridge, and `AivatarPreferences` can store accepted `idleBubblePhrases?: string[]` plus `idleBubbleLanguage?: "auto" | "zh" | "en" | "mixed"`.
  - Defines `AivatarLearningResult`, carried by `CodexStatusMessage.learning`, for LLM/heuristic session-learning output: stable `id`, `source`, summary, optional idle bubble candidates, small trait changes, optional XP/confidence, and `privacyRisk`. `AivatarMemoryEventType` includes `session_learning`.
  - `TokenUsage` can carry `contextTokens?: number` and `modelContextWindow?: number` for Agent Sessions context window meters, in addition to reward-oriented token fields. Codex JSONL `rate_limits` can also populate `tokenLimit5hPercent`, `tokenLimit5hResetAt`, `tokenLimitWeekPercent`, and `tokenLimitWeekResetAt`; the collapsed HUD renders the two percentage fields as 5-hour and weekly token progress when available.
  - `AivatarSaveState` includes optional `avatarId`, `roomId`, `avatarAppearanceId`, `memory`, and `navMemory`, normalized on load for older saves. Missing identity/appearance values are generated or defaulted during save normalization; missing trait axes and nav-memory maps are filled from defaults.

- `src/components/PixelAssetEditor.tsx`
  - In-app pixel asset and animation editor MVP.
  - Supports custom canvas sizes, presets, pencil/erase tools, color palette, multi-frame animation, FPS playback, frame copy/delete/add, localStorage save, and room-reference preview.
  - Saves editor drafts to `aivatar.assetEditor.v1`.
  - Shows the current `480 x 320` scene reference, wall area, floor area, and an adjustable asset anchor box.

- `src/game/renderScene.ts`
  - Draws the pixel room, configurable floor/wall surfaces, configurable windows, furniture, appearance-aware four-direction avatar, placed decor/furniture, placement previews, Room Edit highlights, avatar bubbles/progress, and status light.
  - Accepts the current UI theme so the canvas presentation can harmonize with Classic, Terminal, Amber, Arcade Cabinet, and Starship app-shell skins. `App.tsx` passes `arcade-cabinet` and `starship-console` through `uiThemeForScene()` so the canvas room backdrop, scanline/status colors, progress bars, and bubbles can use theme-specific palettes while CSS carries the shell/frame skin.
  - Matrix sprites rendered through `drawTableSprite` are cached by `palette + rows` into an offscreen canvas on first use, then drawn each frame with `drawImage`. This keeps high-detail floor, wall, desk, dining-table, fridge, File Cabinet, and Terminal monitor matrix assets visually identical while avoiding repeated per-frame row/run `fillRect` work.
  - `renderScene` keeps the canvas backing store size stable between frames, clearing with `setTransform(...); clearRect(...)` unless the scene size changes. It also builds one per-frame placed-item render cache for coffee-cup fill state, wall items, rug underlays, furniture-surface items, and depth-sorted placed items so repeated draw passes do not each re-filter and re-sort the same arrays.
  - Renders the current mixed pixel art pass, including the Stardew-inspired bed with optional skins, matrix-backed retro drawer desk with optional Industrial, Rococo Ivory, and Transparent Acrylic skins, placed CRT-style Terminal with optional Green Amber, White Cyan, and Neon Dark skins plus animated keyboard, matrix-backed dining table with optional Rococo Ivory, Dark Oak, and White Tech skins, matrix-backed retro two-door fridge with optional Ivory, Red Retro, and White Tech skins and deeper top clutter, matrix-backed buyable File Cabinet, premium black/gray Coffee Machine, Coffee Cup, Switch-style Game Console, Oil Easel, Digital Wall Clock, rainbow Cozy Rug, purple morph-blob rug, Blue Persian Rug, Sky Sentinel Poster, fridge door open/hold/close animation, and blanket overlay used when the avatar sleeps under the covers.
  - The bed renderer supports `skinId`. The default bed keeps the warm wood frame, blue star blanket, pillows, sheet, and plush toy. `industrial-bed-skin` swaps in a metal industrial frame, light gray pillows/sheet, and a deeper dark-gray blanket with smoother horizontal pixel shading while preserving the plush toy. `wood-red-bed-skin` uses a wooden frame with a red blanket. `ivory-pink-plaid-bed-skin` uses a refined ivory frame with warm highlights/gold details and a denser pink plaid blanket; the sleep blanket overlay reads the same palette and plaid pattern. `modern-minimal-bed-skin` is a modern low-platform bed pass with a single clean wood headboard, no traditional bed posts or footboard, wider bedding aligned to the headboard, an extended muted-sage blanket, a thin visible white mattress front edge, a matching-width blanket dark edge over that mattress edge, a thin wood tray/platform edge below the mattress, and slim dark legs. Its mattress front edge also has 2px blanket-colored side strips moved outward to visually connect the blanket down to the wood tray edge. `space-white-deep-gray-bed-skin` reuses the modern low-platform geometry with a space-white headboard/platform, cold pale-gray trim, a plain deep-space-gray blanket, and subtle gray highlights. It is visual-only and preserves bed placement, collision, pathfinding, sleep targets, and interaction geometry.
  - The desk renderer supports `skinId`. The default desk body is a reference-derived `108 x 84` palette-plus-row-matrix sprite in `src/game/deskSprites.ts`, rendered through `drawTableSprite` with `CLASSIC_DESK_SPRITE_*` rather than approximated with broad rectangle drawing. Its accepted reference is split into desk-top and front sections before resizing so the app keeps the original room proportion: about `42px` desk-top height and `42px` front/drawer height. The default desk keeps the retro drawer/writing-pad look, placement, collision, interaction geometry, and semi-transparent base shadow matching the dining-table shadow opacity. Its underside includes a sleeping black-cat/oval shadow silhouette: while the cat is asleep no eyes are drawn, and a subtle pair of yellow eyes opens briefly on a low-frequency cycle. `industrial-desk-skin` preserves the base desk dimensions, placement, collision, and interaction geometry while swapping in a smoother dark oak desktop, no desk pad, black metal four-corner legs, thicker/aligned front legs with highlighted feet, tabletop-over-leg occlusion, semi-transparent underside shadows, and a tiny sleeping black-cat silhouette in the desk shadow that uses the same brief eyes-open animation. `transparent-acrylic-desk-skin` reuses the Industrial Desk `108 x 84` structure while rendering a genuinely semi-transparent ice-blue acrylic tabletop through `rgba` palette entries, visible tabletop support pieces under the back and side edges, rear legs that are as thick as the front legs and aligned to the lower exposed rear-leg columns, shallower under-desk shadowing so transparent layers stay readable, optical-shaft/glass highlights, tabletop-over-leg occlusion, and the same sleeping black-cat silhouette, placement, collision, pathfinding, and interaction geometry. `rococo-ivory-desk-skin` keeps the same geometry while rendering an ivory desk with gold trim, carved panel details, curved legs, and segmented foot highlights.
  - The table renderer supports `skinId`. The default table and the Rococo Ivory, Dark Oak, and White Tech table skins are now reference-derived `102 x 68` palette-plus-row-matrix sprites rendered through `drawTableSprite` with `CLASSIC_TABLE_SPRITE_*`, `ROCOCO_TABLE_SPRITE_*`, `DARK_OAK_TABLE_SPRITE_*`, and `WHITE_TECH_TABLE_SPRITE_*`. The default table keeps the reflective metal dining-table pass and the standard table shadow. `rococo-ivory-table-skin` keeps the same placement, collision, coffee storage, and interaction geometry while rendering an ivory tabletop with warm gold trim, curved legs, and four symmetric iris motifs on the tabletop. `dark-oak-table-skin` renders a polished dark oak tabletop with warm brown wood grain and lacquer-like reflections. `white-tech-table-skin` keeps the same geometry while rendering a white/ice-gray futuristic tabletop, subtle cyan circuit traces and nodes, dark slim legs, and a cool sci-fi trim.
  - The fridge renderer supports `skinId`. The fridge body and skins are `46 x 114` palette-plus-row matrix sprites in `src/game/fridgeSprites.ts`, rendered at `item.x - 2`, `item.y - 30`; the sprite layout reserves `30px` for the top plane/clutter and `74px` for the front body, with lower rows for feet and transparent cleanup. Treat the top plane as orthographic/parallel projection: top front/back edges stay equal width, no vanishing point, and all fridge skins keep the same dimensions, collision, interaction geometry, and door timing. The accepted top silhouette extends one pixel beyond the front body on both sides for every skin. Preserve one subtle seam between the top and upper door; avoid both the earlier double dark line and a fully erased seam. Bottom feet must have clean transparent cutouts, and the floor shadow is drawn separately in `renderScene.ts`. Door-opening overlays must reuse the current skin sprite material so the open door does not detach, mismatch color, or reveal stale default-door pixels. The default fridge keeps the retro green two-door body and top clutter. `ivory-fridge-skin` swaps the body and animated door panel to ivory/cream colors with warm-gold handles. `red-retro-fridge-skin` renders a glossy cherry-red retro body, stepped rounded pixel corners, cream highlights, deep red shadowing, and left-side chrome handles aligned with the current door opening direction. `white-tech-fridge-skin` renders a white/ice-gray futuristic fridge body with cyan LED seams/nodes, dark touch strips, an embedded glowing control display, circuit/data-line details, top/bottom cyan light bars, cool white handles, and white modular top clutter.
  - The placed Terminal renderer supports `skinId`. The default Terminal and three Terminal skins are `42 x 50` palette-plus-row matrix sprites in `src/game/terminalSprites.ts`, rendered with origin `item.x - 21`, `item.y - 35`. `terminal-monitor` keeps the default beige CRT and blue screen, while `terminal-green-amber-skin`, `terminal-white-cyan-skin`, and `terminal-neon-dark-skin` swap only the visual matrix and matching active-animation palette. The Codex status bubble uses `TERMINAL_MONITOR_STATUS_BUBBLE_Y_OFFSET = -67` to sit above the taller sprite. Keep Terminal skins visual-only: do not change the `terminal-monitor` item definition, `builtin-terminal` placement, hit bounds, interaction standpoints, keyboard audio trigger, pathing, right-click workflow, or save/migration semantics.
  - The sleep blanket overlay reads the same bed palette as the visible bed so sleeping does not snap back to the default blue blanket after a furniture skin is applied.
  - The File Cabinet renderer uses `src/game/fileCabinetSprites.ts`, a `56 x 87` code-embedded palette/row matrix sprite rendered at `item.x - 6`, `item.y - 21`. It preserves the front-facing orthographic cabinet rule: the top plane is rectangular with equal-width front/back edges, visibly doubled top depth, right-side shading, clean feet, and a tidy bottom contact shadow. Highlight bounds, foreground overlay bounds, and glow blockers use the same sprite envelope. Runtime File Cabinet geometry keeps the saved placed-item anchor at the cabinet top center, exposes a doubled-depth top hit/placement surface for objects, and uses a doubled-depth lower foot/collision area so placement previews, furniture movement, and avatar pathing stay aligned.
  - File Cabinet state is selected from the real Task Cabinet queue as `empty`, `few`, `several`, `failed`, or `full`: `Ready + Failed` tasks appear in the cabinet, failed papers show a red `X`, `Running` tasks are treated as taken out, and `Completed` tasks disappear.
  - Renders floor rug underlay items, currently a doubled-size rainbow Cozy Rug with shallow shadow/light woven edge, Morph Blob Rug, and Blue Persian Rug, immediately after the floor and before all furniture, ordinary placed items, and the avatar, so furniture and objects can visibly cover rugs. Blue Persian Rug is a `104 x 72` blue/white Persian-style underlay rug with centered, symmetric medallion/border motifs and is now a normal repeatable shop purchase rather than a `one-time` item.
  - Renders wall-only placed items such as Poster, Sky Sentinel Poster, and Digital Wall Clock on the wall layer after the wall/window and before furniture, so furniture naturally occludes wall hangings instead of wall hangings drawing over furniture. Sky Sentinel Poster is an original superhero-inspired wall poster with a blue/gold sunrise, red cape, city skyline, and small robot dog motif; it intentionally avoids official Superman logos, actor likenesses, and copyrighted poster replication.
  - Renders floor placed items in avatar-aware layers: floor items behind the avatar are drawn before the avatar, while floor items in front are redrawn after the avatar so placed objects such as the Oil Easel can occlude the avatar when the avatar stands behind them.
  - Renders furniture in visual-depth order rather than raw content order, so bed/desk/table/fridge/File Cabinet layering is less dependent on config array order.
  - Renders the bed as a split layer: the main bed body is always drawn in the behind-avatar furniture pass, while the bed footboard foreground redraw is clipped to the avatar-foot vicinity through `drawBedFootboardAvatarOcclusion`. This preserves foot occlusion without letting the full footboard cover nearby placed floor items such as Coffee Machine or Oil Easel.
  - Renders the Purple Bubble Wallpaper wall surface with a purple base, larger rounder bubble motifs, highlights, and light texture, Pink Sakura Wallpaper with denser stable pseudo-random blossoms and petals, Warm Ivory Wallpaper with subtle off-white paper grain and soft seams, Exposed Red Brick Wallpaper with gray mortar, smaller offset bricks, per-brick speckles/scars, and a textured low baseboard overlay, and White Tech Wallpaper with clean white sci-fi panels, pale blue circuit traces, small glowing nodes, seams, and a lower technical base strip.
  - Renders floor surfaces through two paths: surfaces present in `FLOOR_SURFACE_SPRITE_DATA` use full `328 x 174` palette-plus-row matrix sprites from `src/game/floorSurfaceSprites.ts`, while remaining surfaces use procedural Canvas drawing. Current matrix floor sprites are Honey Plank, Checker Tile Floor, Polished Cement Floor, Industrial Metal Floor, Gray Tech Floor, and Tatami Mat Floor.
  - Checker Tile Floor uses a clean black/white tile sprite with grout seams, beveled highlights, and sparse scuffs instead of heavy cracks. Polished Cement Floor uses a seamless single-slab smooth cement sprite with subtle clouding, sparse low-contrast pores, and soft gloss highlights. Industrial Metal Floor uses a four-row metal plate matrix sprite with top-down highlights and less repetitive upper-light reflections. Gray Tech Floor uses a minimal futuristic matrix sprite instead of the old procedural LED-strip surface. Tatami Mat Floor uses a green-bound woven straw matrix sprite.
  - The old Gray Tech Floor LED glow overlay is fallback-only when `gray-tech-floor` has no `FLOOR_SURFACE_SPRITE_DATA` entry. With the current sprite-backed Gray Tech Floor, `drawFloorLightOverlay` skips that legacy glow so the accepted matrix sprite remains the single source of truth.
  - Renders the City Night Window as a dynamic city view: sky colors smoothly transition through day, dusk, night, and dawn; the sun rises from the left and sets to the right; the moon crosses the night sky; drifting clouds and building silhouettes occlude the sun/moon; the glass area is clipped to the window bounds.
  - City Night Window building windows distinguish daytime natural-light panes from nighttime interior lights. Evening lights warm up gradually, late-night lights turn off by stable per-window seed so only a few remain lit, and dawn transitions remaining lit windows into daylight panes rather than simply fading them to black.
  - City Night Window high-rises include small red aircraft warning beacons that breathe at dusk/night and stay off in daylight and dawn.
  - Renders the Ocean Window as a wider, taller sea view near the wall/floor line: real-time sky and ocean color changes, softened horizon transition, sunrise/sunset glow, dawn/dusk color bands, moon at night, drifting clouds, dense breathing wave sparkles/reflections that follow the sun/moon position, and three slow-moving ships with depth: a modern cargo ship, a cruise ship, and a smaller distant cargo ship. Ship X positions use subpixel movement to avoid low-speed stutter. At night/deep dusk, ship hull colors shift to darker night palettes while small cabin/deck lights gain visible warm cores, halos, and short reflections so the ships remain readable without becoming bright daytime objects.
  - Renders the Cyberpunk City Window with the same `188 x 96` size as Ocean Window: a silver-gray rounded metal frame, distant Coruscant-like high-rise skyline, complex tower structure lines, real-time day/night lighting, morning gold building edges, daytime dark-metal towers, dusk rose-gold tinting, dense orange nighttime window lights using the existing city-night lighting rhythm, left-to-right looping clouds near the tower tops, seven flying-car traffic lanes with doubled speed, subpixel X movement plus pixel-aligned Y positions for smoother non-worming motion, and an animated vertical neon billboard near the center-right skyline. The billboard flicker is intentionally slow and uses a smoother pulse/scan cadence. Rooftop aircraft warning beacons appear on more tall or visually prominent towers at dusk/night; each beacon uses a phase-offset breathing rhythm so tower lights glow naturally and do not blink in sync.
  - Animates Coffee Machine brewing when the active interaction is `brew`, including pulsing indicator lights, status strip flashes, coffee stream pixels, cup fill pixels, and small steam pixels.
  - Renders placed Coffee Cup as a small transparent glass tabletop cup-and-saucer item with a right handle, rounded elliptical rim/lower rim, stronger base shadow, and visible coffee volume/slow dynamic rising steam when that cup represents one stored table Coffee. Empty cups show a pale transparent glass interior.
  - Renders a larger Game Console screen and adds animated screen pixels only when the avatar is in `play` behavior near the active/targeted placed Game Console, so autonomous and manual play animate the intended console without lighting up distant consoles.
  - Renders the Oil Easel as a more detailed programmatic pixel-art wooden easel with support legs, richer shadowing, brass/crossbar accents, a paint tray, and a canvas that shows the current `24 x 35` generated painting draft when one exists, revealing pixels by cumulative painting progress. The avatar has a `paint` pose based on the front-facing octopus proportions, with a beret, paintbrush, palette, and small brush motion; active painting adds animated color strokes on top of the canvas. The shop/backpack thumbnail has matching extra canvas and paint details.
  - Renders a dedicated `admire` pose: the avatar lifts its tentacles and shows small sparkle/observation pixels while admiring decor. `admire` activity bubbles now prefer the behavior-specific trait phrase over generic idle bubble text so the action reads more clearly.
  - Renders the Digital Wall Clock as a wall hanging that reads the local system time as `HH:MM` each frame.
  - Draws Codex-session notification bubbles over the Terminal and rounded thinking bubbles over the avatar. Session bubbles wrap by measured pixel width, can use two lines where needed, and use a small pixel-font renderer for ASCII text so English status/tool text stays sharp inside the scaled canvas. Bubble width measurement and pixel-text drawing now use the same width model to reduce text overflow.
  - Canvas avatar/interaction bubbles, rounded thinking bubbles, and built-in Terminal/Codex status bubbles accept the current UI theme from `App.tsx`. Classic now uses a Windows 98-like tooltip/status palette with pale yellow bubbles, black borders, navy text/progress, and a gray raised status-light panel; Terminal uses black-green bubble fills, neon green borders, green text, and green progress bars; Arcade Cabinet uses a black/cyan/magenta/amber arcade palette; Starship uses black/apricot/lavender/pale-cyan console colors so bubbles match the shell instead of looking like the generic Terminal skin.
  - CJK fallback text in avatar and Terminal bubbles uses a clearer Chinese-oriented canvas font stack (`Noto Sans TC`, `Noto Sans SC`, `Noto Sans HK`, then Microsoft JhengHei/YaHei fallbacks), while ASCII text still uses the custom pixel font.
  - Terminal bubbles show notifications for agents marked `terminalBubble: true` in `src/agentRegistry.ts` (`codex`, `claude-code`, and `opencode`); `thinking` is shown over the avatar instead of over the Terminal. Codex `commentary` and Claude/opencode `message-display` live text intentionally use `thinking` so the avatar bubble, not the Terminal bubble, can show the current assistant wording.
  - Renders the placed Terminal monitor with a keyboard; during coding/thinking proximity, the screen, cursor, scanline, status lights, and keyboard animate on top of the static matrix using the skin-matched `terminalMonitorAnimationPalette`.
  - Renders dedicated consumable poses for Coffee, Cola, Bento, and Cookie through shared pose helpers. Appearance renderers can reuse those helpers or adapt them with their own body shape, as `mood-slime` does by growing temporary soft pseudopods rather than permanent hands/feet.
  - Coffee uses a cup/steam sip pose, Cola uses a red can with straw and fizz pixels, Bento uses a lunch box with food pixels, and Cookie uses a bitten cookie with chocolate-chip pixels, holding appendages, crumbs, and a small chewing motion.
  - Renders an idle-only phone pose in the current avatar proportions: the avatar holds a small phone and taps it with visible appendages/pseudopods. When facing the viewer, the phone back faces outward; side-facing poses show a thinner glowing screen. This animation is purely visual and does not reply to or emit agent status.
  - Renders task-file poses for the future task-cabinet workflow: fetching a file from the cabinet, carrying a task file, and reading an open task file near the Terminal.
  - Renders a `complete`/`success` yawn animation using the existing front/side avatar proportions: closed eyes, open yawning mouth, small lifted tentacles, and subtle breath pixels. The room status light falls back to idle after the short complete visual window expires.
  - Renders trait-driven avatar visual themes from memory/growth: Focus uses cool blue/cyan, Resilience uses warm coral/gold, Curiosity uses mint/yellow/pink accents, Efficiency uses electric cyan/white/green accents, Creativity uses vivid violet/magenta/gold accents, and Warmth uses soft orange/cream/gold accents.
  - Trait themes affect body color, highlights, eye shape, screen glow, success/error/thinking motifs, low-mood/depleted color bands, and small dominant-trait micro-expressions: Focus scan glints, Resilience fist pumps, Curiosity question pixels, Efficiency check marks, Creativity sparkles, and Warmth blush/heart pixels.
  - Thinking, activity, error, and success bubbles can use short trait-specific ASCII phrases such as `Tracing it`, `We recover`, `What broke?`, `Done clean`, `New angle`, and `With you`.
  - Idle/autonomous states can occasionally show short stable-random avatar bubbles, giving the pet small ambient thoughts while it wanders, relaxes, admires, or idles. Accepted session-derived idle bubble phrases are mixed into the idle/autonomous bubble candidate pool.
  - Renders low-stat busy depletion by progressively darkening the avatar while preserving eye/highlight readability.
  - Supports avatar appearances via `avatarAppearanceId` passed from `App.tsx` into `renderScene`: `octopus` remains the default programmatic avatar, while `demo-spark`, `mood-slime`, `cute-crayfish`, `cute-ghost`, `cute-penguin`, and the development-only `wave-lizard` share the same simulation/runtime behavior and differ mostly in visual rendering and animation treatment. `wave-lizard` should stay in validation/rendering/i18n/CSS paths for existing saves and future development, but it should not appear in the create-save picker unless deliberately re-enabled.
  - `demo-spark` is a demo electronic-looking character that reuses the octopus behavior surface, has its own pixel body/face rendering, and carries a red/white backpack when facing away. Its create-save description is `Spark是个急性子`.
  - `mood-slime` is a rounded, single-body slime appearance. It has no permanent separate hands or feet; it moves by slow ground-contact squish/crawl animation, stays visually attached to the floor, and only grows soft pseudopods from the body for interaction-like states such as `interact`, `brew`, `play`, and `music`.
  - `mood-slime` color and details are mood-band driven: high mood is pink with light sparkle accents, normal mood is green, low mood is dark blue with subdued/tired details, and depleted mood is purple-gray with heavier tired details. Preserve the current simple face design and keep mood decorations subtle so they do not read as stripes or clothing.
  - `cute-crayfish` is a red cute crayfish appearance with large claw-hands attached close to the body, a rounded head/top shell, a segmented cone-like shell that narrows toward the bottom, antennae, a tail fan, small walking feet under the body, and a simple cute face. Its lower body should read as a slight inverted trapezoid rather than a plain rectangle across front/side/back views; keep the taper subtle so it still matches the existing compact body mass. Its claws are the interaction hands: eating, drinking, phone/file/paint, and typing poses should attach props and tap motion to the claws rather than drawing generic small arms. Preserve the arm logic as body shoulder connection -> bendable joint -> claw end; the default pose raises both claws beside the head without covering the face. Most behavior remains shared with other appearances, and appearance-specific behavior rules should stay explicit and localized.
  - The `cute-crayfish` save-slot/avatar-choice logo is a simplified CSS pixel icon in `src/styles.css`: rounded head/body, small antennae, clear cute face, two side claws, and a compact tail/feet silhouette. Keep it visually aligned with the other save-slot logos and avoid reintroducing dense overlapping shadow stacks that make the small icon read as noisy.
  - `cute-crayfish` has the current dedicated appearance-specific `workout` behavior. It is rendered as a claw-and-dumbbell exercise pose with front and side variants, uses the existing bendable claw-arm structure, and is intended to appear occasionally during healthy idle/autonomous life rather than as an agent status.
  - `cute-crayfish` suppresses the generic Efficiency trait check-mark micro-expression on the body. When the dominant trait is `efficiency` and the crayfish is in `coding` or `thinking`, the same green/white pixels are rendered as a small control device near the keyboard-tapping claw so they read as an interaction prop instead of body markings.
  - `cute-crayfish` uses a narrower dedicated ground shadow than the octopus/default avatar. The current shadow is `37px` wide at `x - 18`, `y + 10`, keeping it under the shell/feet without spanning as far as the raised claws.
  - `cute-ghost` is a semi-transparent cute ghost appearance with a rounded one-piece head/body, soft blue edge, bean eyes, a thin mouth, blush pixels, occasional cute open-mouth laughter, and a drifting curtain-like lower hem. Its lower body is a short, continuous curtain/hem shape rather than a separated skirt: the body-to-hem transition stays vertical and smooth, the bottom edge uses dense narrow `2px` W-shaped strips for subtle wave motion, idle motion stays quiet, horizontal movement drags the hem opposite the travel direction, and the shorter body plus softer lower shadow gives the character a floating feel. Its terminal-facing `coding`/`thinking` pose draws the keyboard/tapping hands behind the ghost body so the back view occludes the action naturally. It adapts Coffee, Cola, Bento, Cookie, phone, admire, paint, and task-file poses with translucent ghost arms rather than octopus tentacles; the phone case is a vertical rainbow stripe design with a small camera. Its dominant-trait visuals currently use the shared trait motif/micro-expression overlays, not six ghost-specific facial expression sets.
  - The `cute-ghost` save-slot/avatar-choice logo is a simplified CSS pixel icon in `src/styles.css`: rounded translucent body, bean face, blush, and a short clean curtain hem. Keep the logo CSS-side; avoid reintroducing long external shadow trails or noisy tail pixels that make the small icon look dirty.
  - `cute-penguin` is a cute penguin appearance based on the selected E concept: a very round plush-like black body, large white face/belly area, tiny orange beak, shy blush pixels, short flipper wings, a small head tuft, and oversized orange feet in idle/front preview. Its walking/side poses intentionally shrink and reorient the feet under the body so the original sitting-ground reference does not look like it is sliding; movement uses a subtle waddling body sway and alternating small foot steps. It adapts the existing shared behavior surface and props with black flippers rather than adding penguin-only runtime behavior.
  - The `cute-penguin` save-slot/avatar-choice logo is a simplified CSS pixel icon in `src/styles.css`: round black body, white face/belly patch, orange beak, oversized orange idle feet, short side flippers, and a tiny head tuft. Keep the logo readable at startup-slot size and do not add complex feather texture.
  - Shows short thought bubbles during interactions, such as going to a target, needing rest, drinking coffee, eating food, brewing coffee, or finding no snacks.
  - Renders the placed Record Player as a compact pixel object with a centered base, slightly lowered front face, symmetric front feet/shadow, flattened pixel-ellipse record, tonearm, playback-only colorful rotating record highlights, center glint, floating music notes, and a red front indicator light. Record Player playback visuals are driven by the `activeRecordPlayerId` passed from `App.tsx`, so the record keeps spinning and the red light stays on after the avatar walks away.
  - When furniture is selected, renders its configured `collision` footprint as a translucent red rectangle so the actual navigation-blocking ground projection can be visually inspected in Room Edit/testing flows.
  - When furniture or floor placed items are selected, renders their placement ground projection as a light gray rectangle, matching the footprint used by placement overlap checks.
  - When furniture or placed items are selected, renders their generated interaction standpoints as small crosshair markers so target placement can be visually QA'd. The Oil Easel no longer shows or uses the generic above-object standpoint, and the Terminal is constrained to front surface standpoints.
  - Renders the temporary `Nav grid` debug overlay when enabled from the Debug panel: walkable/blocked navigation samples, collision boxes, avatar foot bounds, target line, A* path, and interaction candidates.
  - Avatar and furniture art remain programmatic canvas drawing; editor-created assets are not yet wired into runtime rendering.

- `src/game/simulation.ts`
  - Avatar state machine and behavior logic.
  - Maps agent status to avatar behavior.
  - Provides visual-only task-file behavior targets: `fetch_task_file` moves toward the File Cabinet, while `carry_task_file` and `read_task_file` move toward the placed Terminal area.
  - Handles autonomous sleep, wander, explore, relax, snack, admire, brew, music, paint, play, and appearance-gated `workout` activities through a layered weighted-choice system rather than a single absolute-threshold roll. Autonomous behavior durations are tuned per behavior: play, music, and paint are long activities, explore/relax/admire/phone/workout are medium-length activities, and snack/brew remain shorter utility actions. Autonomous `music` is now best understood as "go start the Record Player": after arrival, the App layer starts the independent BGM state and returns the avatar to ordinary autonomous life.
  - `idle` leaves the avatar to its autonomous life behavior, including sleeping, eating/drinking, wandering, exploring, relaxing, playing music, playing games, admiring decor, and brewing coffee.
  - `thinking` now routes the avatar to the desk/Terminal area for focused thought instead of random wandering; `executing`/coding targets the placed Terminal and routes the avatar to the Terminal-facing side of the desk/table.
  - `coffee`, `cola`, `bento`, and `cookie` are distinct consumable behaviors with happy expression and front-facing interaction poses at the table/fridge area.
  - Coding arrival faces the avatar toward the Terminal for a direct interaction pose.
  - Low-energy busy behavior can send the avatar to the table for coffee when coffee is available.
  - Prioritizes placed decor, Coffee Machine, Record Player, Game Console, and Oil Easel for autonomous activities by adding behavior weights when those objects exist; recovery needs still choose from their own weighted layer before ordinary idle-life choices.
  - `explore` is a low-priority idle-learning behavior. It only triggers when Energy/Mood/Hunger are healthy, targets either a random floor point or a sampled point near furniture/placed items, and runs longer than ordinary wander so it can collect route experience.
  - `tickAvatar` accepts optional memory/growth state, and autonomous behavior choices are lightly biased by traits through weights: curiosity favors exploring/admiring/interacting and slightly increases music variety, efficiency favors brewing and quick recovery, focus favors recentering/relaxing and modestly supports music, resilience favors mood recovery/continuing activity, creativity favors painting at the Oil Easel and music, and warmth strongly favors Record Player music. The App layer also uses memory/growth traits to choose between Bento and Cookie when an automatic snack has no explicitly selected item. `tickAvatar` also accepts `autoMusicEnabled`; when it is false, idle-life autonomous selection will not choose `music`, though manual Record Player interaction still works. It also accepts `avatarAppearanceId` so the autonomous selector can gate `workout` to `cute-crayfish`.
  - `workout` is arrival-gated like other action behaviors: the avatar first walks to a sampled open floor point, then faces front and starts the focused exercise pose. It currently uses a roughly 12-20 second autonomous duration and does not write memory/growth events or post bridge status.
  - `applyPetTick` accepts an optional `moodDecayMultiplier`; `App.tsx` uses this to slow Mood decay while Record Player BGM is active without changing Energy or Hunger decay.
  - Idle/autonomous behavior can randomly choose `phone`, a local-only visual animation that does not update memory/growth, does not post bridge status, and does not represent agent activity.
  - Autonomous behavior durations are tuned per action instead of using one short range: play is roughly 28-42 seconds, music roughly 36-58 seconds, paint roughly 32-48 seconds, relax/explore/admire/phone are medium-length, and snack/brew remain short.
  - Updates four-direction facing from movement, supports collision-aware movement, arrival-gated action promotion, and delays furniture interaction effects until the avatar reaches the target.
  - Avatar navigation uses a foot-center pathing model. Collision checks evaluate the avatar foot center against furniture/item collision rectangles inflated by the avatar foot radius and planning clearance; this keeps planning, runtime movement, and interaction-point filtering aligned while the visible foot remains an ellipse.
  - Navigation progress watches the final interaction target as well as intermediate waypoints. If movement becomes blocked or stalls, the avatar now pauses immediately for a short replan instead of continuing same-frame micro-moves, target switching, or backoff motions that previously caused high-frequency jitter.
  - Uses a lightweight 8px nav-grid A* pathfinding pass with cached full-path waypoints. Cached path following now chooses the next point after the path node nearest to the avatar, preventing old path nodes behind the avatar from pulling it backward and causing high-frequency vibration. Ordinary path selection avoids cells marked `1` in `navMemory.walkableCells`, with static collision checks as fallback for unknown cells.
  - Interaction standpoints have been retuned around common obstacles. Furniture and desktop-item close standpoints use a `CLOSE_INTERACTION_STANDPOINT_DISTANCE` of half the foot/planning safe gap, currently about `7px`, so table/desk/Coffee Machine/Game Console interactions stand nearer the furniture edge. The Terminal keeps a special closer surface standpoint so coding/thinking poses stand nearer the desk edge.
  - Queued interactions prefer the object's default/main interaction target rather than the avatar-nearest point, reducing side-point selection and collision-edge jitter near desks, tables, fridges, terminals, Coffee Machines, Game Consoles, and Oil Easels.
  - Autonomous desktop placed-item behaviors such as `brew`, `music`, `play`, `coding`, and `thinking` target generated placed-item standpoints without using the host furniture as a route-wide collision-ignore id. Narrow collision-ignore handling is reserved for true furniture exceptions such as bed sleep.
  - `complete` maps to `success` only for a short visual window of about 2.2 seconds so the avatar plays the yawn animation briefly and then returns to ordinary autonomous life even if the bridge's latest status remains `complete`.
  - `success` uses a sleepy/yawn expression rather than a long celebration pose.
  - `play` no longer forces front-facing on arrival, allowing App-level Game Console interactions to face the avatar toward the console.
  - Pathfinding avoids diagonal corner-cutting, applies a collision-edge epsilon to reduce border flicker, and caches short-lived nav paths/waypoints for the same target. Direct shortcuts and waypoint reuse use the same inflated-obstacle corridor checks as grid planning.
  - When movement is blocked, ineffective, or fails to make sustained progress, the avatar pauses briefly, clears stale waypoint/progress state, and replans. Soft backoff was removed from the main blocked path because small back-and-forth corrections looked like jitter.
  - Interaction-range arrival now short-circuits movement for behaviors such as coffee, snack, brew, paint, play, sleep, relax, admire, and task-file interactions. Once the avatar is close enough to the target or any generated interaction standpoint, it stops chasing the exact coordinate and settles into the interaction-facing pose. Most actions use an 8px execution range around interaction points; table eating/drinking keeps a wider rectangular App-level trigger.
  - `actionIntent` and `actionActivityLabel` let movement and action playback stay separate: the avatar approaches as a movement state, then promotes the intent into the real behavior only after arrival. Sleep and relax share a single bed-top point and snap to the bed target on arrival so bed/blanket poses do not jitter.
  - Strict collision and escape collision now share the inflated-obstacle point model. The escape path still allows motion only when it moves the avatar's foot-center away from the collision center after the avatar is already inside an inflated blocker.
  - `success` now holds the avatar at its current position during the short complete/yawn visual window instead of falling through to a random room target. Furniture behavior transitions choose the nearest interaction standpoint from the avatar's current position so post-arrival actions such as drinking coffee do not pull the avatar across the furniture.
  - `tickAvatar` accepts an optional `ignoredFurnitureId`, currently reserved for narrow true-furniture exceptions such as sleep/bed handling. Desktop placed items should not ignore their host furniture for the whole route.
  - Navigation collision combines configured furniture collision rectangles with selected placed-item collision rectangles. Currently the Oil Easel contributes its floor placement foot projection as a placed-item collision rect, so pathfinding avoids walking through the easel base while still allowing desktop/tabletop items and rugs to remain non-blocking.
  - Provides shared furniture interaction targets so avatar movement and arrival checks stay aligned. App-level arrival checks now also count an interaction point as reached when it touches the avatar's ground-footprint rectangle, with distance-based reach retained as fallback.
  - Keeps the sleep target near the bed head so the real avatar body is covered by the blanket instead of using a separately drawn sleep head.
  - Exports `getNavigationDebugPath` for the debug overlay so the visible cyan path reflects the same A* planner used by runtime movement.

- `src/game/interactions.ts`
  - Converts browser Canvas coordinates into virtual scene coordinates.
  - Detects clicked/hovered furniture, placed items, active windows, valid wall/window placement areas, and valid floor/furniture placement areas.
  - Keeps furniture/item hit testing tied to actual visual bounds.
  - Handles placement rules from `placementSurfaces`, including items that can go on either the floor or furniture tops.
  - Handles special placement rules such as desktop items on desk/table surfaces and ground-projection-based bed/desk/table/fridge/file-cabinet placement near walls.
  - Furniture placement validity and floor-item overlap checks use furniture/floor-item ground projections rather than full visual bounds. Rugs remain underlay items and do not block or get blocked by furniture and ordinary floor objects.
  - Terminal Monitor hit bounds include the rendered keyboard.
  - Coffee Cup hit bounds match its compact tabletop cup-and-saucer visual size.
  - Record Player hit bounds match its compact tabletop/floor visual footprint so selection, placement, and right-click music interaction use the visible object area.
  - Gives underlay rugs floor-only bounds and lets them overlap floor furniture/ordinary floor items, while click hit testing skips covered rug regions so furniture above a rug keeps interaction priority.
  - Gives the File Cabinet custom visual bounds and floor placement checks while it is being placed from inventory; once placed, it is converted into runtime furniture and uses the base furniture hit testing, movement, collision, and occlusion paths.

- `src/hooks/useCodexStatus.ts`
  - Connects to `ws://127.0.0.1:38987/agent-status`.
  - Accepts both legacy single-status messages and modern `aivatar.status.snapshot` payloads with `currentStatus`, `sessions[]`, `activeSessionKey`, `connectedSessionKey`, and `currentSessionKey`.
  - Pulls the HTTP bridge snapshot on WebSocket open and periodically while live so the UI can recover missed status updates.
  - Can POST/DELETE `/agent-active` so the app can Follow or Clear the current active session from the Agent Sessions panel.
  - Falls back to simulated status cycling when WebSocket is unavailable.

- `src/data/loadContent.ts`
  - Loads and merges runtime config from `/config/aivatar.config.json`.
  - Falls back to built-in defaults.
  - Runtime config array fields replace the fallback arrays when present, so new item definitions, shop entries, or furniture/placed-item skin entries must be duplicated in both `public/config/aivatar.config.json` and `src/data/defaultContent.ts`. Updating only the TypeScript fallback will not show the new content in the running app when the public config is loaded.

- `public/config/aivatar.config.json`
  - Runtime-editable content manifest.
  - Defines avatar, room furniture, furniture collision boxes where used, configurable floor/wall surface palettes, configurable windows, starter inventory, item definitions, shop items, pet stats, wallet, decor, utility items, desktop/floor items, unique File Cabinet shop content, and window shop content.
  - Furniture collision boxes represent the furniture's ground-projection/footprint rather than the full visual sprite. Default collision footprints are tuned to visible lower/base areas in both `src/data/defaultContent.ts` and `public/config/aivatar.config.json`, including Desk `{ x: 178, y: 138, width: 86, height: 25 }`, Fridge `{ x: 346, y: 143, width: 38, height: 31 }`, and Table `{ x: 310, y: 258, width: 82, height: 28 }` in the default layout.
  - Uses `tags` and `placementSurfaces` to distinguish furniture, items, hangings, consumables, windows, and room surfaces.
  - Supports `one-time` item tags for shop entries that should only be purchasable once. `one-time` ownership is tracked through `purchasedItemIds`; after purchase the shop button shows owned/disabled state instead of allowing repeat purchase.
  - Furniture skin shop content currently includes Industrial Bed Skin (`240` bits), Wood Red Bed Skin (`260` bits), Ivory Pink Plaid Bed Skin (`280` bits), Modern Minimal Bed Skin (`300` bits), Space White Deep Gray Bed Skin (`300` bits), Industrial Desk Skin (`280` bits), Rococo Ivory Desk Skin (`340` bits), Transparent Acrylic Desk Skin (`340` bits), Rococo Ivory Table Skin (`320` bits), Dark Oak Table Skin (`260` bits), White Tech Table Skin (`340` bits), Ivory Fridge Skin (`300` bits), Red Retro Fridge Skin (`340` bits), White Tech Fridge Skin (`340` bits), Green Amber Terminal Skin (`220` bits), White Cyan Terminal Skin (`260` bits), and Neon Dark Terminal Skin (`300` bits). Furniture skin items use `tags: ["furniture-skin", ...]` plus `targetFurnitureId`; ordinary furniture skins target base furniture ids, while Terminal skins target the locked placed item `builtin-terminal`. Runtime content is duplicated in `public/config/aivatar.config.json` and the `src/data/defaultContent.ts` fallback.
  - Includes surface definitions for Purple Bubble Wallpaper, Exposed Red Brick Wallpaper, Pink Sakura Wallpaper, Warm Ivory Wallpaper, White Tech Wallpaper, Checker Tile Floor, Polished Cement Floor, Industrial Metal Floor, Gray Tech Floor, and Tatami Mat Floor. Matching `wall-surface` and `floor-surface` shop/item definitions provide pricing and purchased-state metadata for the Decor panel, but these surface items are filtered out of the backpack and are not placed as room objects. White Tech Wallpaper is a buyable wall surface priced at `88` bits with `mood +5` and `energy +2`; Gray Tech Floor is a buyable floor surface priced at `88` bits with `mood +4` and `energy +3`.
  - Current runtime default layout uses City Night Window, moved base furniture, locked placed item `builtin-terminal` on the desk, and a default Desk Lamp on the desk.
  - `terminal-monitor` remains in item definitions for rendering the built-in Terminal, but it is no longer sold in the shop.
  - File Cabinet is present in item definitions and shop content as a unique Growth level 25 furniture item. It is hidden from the shop while one is in inventory or placed in the room, and becomes buyable again after being sold or deleted.
  - Window shop content currently includes City Night Window, Ocean Window, and Cyberpunk City Window. Ocean Window and Cyberpunk City Window are present in `room.windows`, `itemDefinitions`, and `shop.items`; both use a `188 x 96` default wall placement intended to sit closer to the floor than the original city window.
  - Shop/content manifest now includes Digital Wall Clock and Sky Sentinel Poster as wall-only hangings, Morph Blob Rug and repeatable Blue Persian Rug as floor-only rug items, Coffee Cup as a tabletop coffee-storage item, Record Player as a floor-or-tabletop placed item, Gray Tech Floor as a Decor-managed floor surface, and Oil Easel as a Furniture-category placed object that still uses the placed-item rendering and interaction path.
  - `record-player` is present in both item definitions and shop content with `tags: ["item", "record-player"]`, `placementSurfaces: ["floor", "furnitureTop"]`, `placement: "floor"`, `effect: { mood: 9 }`, and price `2400`.
  - Current major shop prices are intentionally high for economy balancing: Cozy Rug `180`, Morph Blob Rug `360`, Blue Persian Rug `520`, Sky Sentinel Poster `88`, Record Player `2400`, Game Console `3000`, Coffee Machine `5600`, Oil Easel `640`, File Cabinet `1200`, Ocean Window `8888`, and Cyberpunk City Window `12000`.
  - Current runtime default layout includes one Coffee Cup on the dining table for new/no-save sessions.

- `public/audio/`
  - Stores bundled audio assets used by the frontend. Most existing game/keyboard assets are CC0; the fridge door clips use the Pixabay Content License and are documented separately.
  - `keyboard-typing-loop.wav` comes from OpenGameArt Keyboard Soundpack #1 and loops while the Terminal monitor's real `coding`/`thinking` animation is active.
  - `coffee-machine-brew-loop.ogg` is the Coffee Machine brew loop, sourced from Wikimedia Commons `Espresso machine.ogg` under Public Domain terms.
  - `fridge-door-open.mp3` and `fridge-door-close.mp3` are split one-shot clips from Pixabay `Fridge` / `audio_e2d0ffffa2.mp3`; the close clip is preserved as the strong closing sound, and the open clip has been trimmed so it starts closer to the visual door-opening animation.
  - `agent-complete-success.ogg` is a short CC0 success one-shot used for reward-eligible agent `complete` events.
  - `cola-can-open.mp3` and `cola-drink.mp3` are Cola action one-shots. The can-opening sound is sourced from the user-selected Pixabay/Freesound fizzy drink can opening clip, and the drink sound is a CC0 Freesound short drinking clip.
  - `coffee-drink-slurping.mp3` is the current Coffee action sound, sourced from the user-selected Pixabay `Drinking & Slurping` clip. The older `coffee-drink.mp3` file may still exist locally as a cache-bypass predecessor but runtime code now points at `coffee-drink-slurping.mp3`.
  - `bento-eat-munchin.mp3` is the current Bento/Cookie action sound, sourced from the user-selected Pixabay `munchin` clip.
  - The Game Console random pool currently includes `game-console-jump.ogg`, `game-console-invincibility.ogg`, `game-console-victory.ogg`, `game-console-battle.ogg`, `game-console-get-equipped.wav`, and `game-console-curious.ogg`.
  - `game-console-loop.wav` is an older single-track Game Console asset retained for now but not used by the random playback pool.
  - `bach-fugue-bwv-577-the-jig.ogg` is a CC0 OpenGameArt 8-bit/classical Record Player track from TheOuterLinux's `Bach - Fugue BWV 577 "The Jig"` pack.
  - `bach-invention-4.wav` is an OpenGameArt 8-bit/classical Record Player track from Haley Halcyon's `NES baroque music (Bach's Invention 4)` pack, licensed under CC-BY 4.0 and requiring attribution.
  - `nes-bach-bwv-565.ogg` is a CC0 OpenGameArt 8-bit/classical Record Player track from TheOuterLinux's `NES - Bach - BWV 565` pack.
  - `c64-bach-wtk2-prelude2.ogg` is a CC0 OpenGameArt C64-style Record Player track from TheOuterLinux's `C64 - Bach - wtk2-prelude2` pack.
  - `nes-chopin-op25-no2.ogg` is a CC0 OpenGameArt NES-style Record Player track from TheOuterLinux's `NES - Chopin - Op. 25 No. 2 - 140BPM` pack.
  - `synth-chopin-fantaisie-impromptu.ogg` is a CC0 OpenGameArt synth-style Record Player track from TheOuterLinux's `Synth - Chopin - Fantaisie-impromptu - 120BPM` pack.
  - `cyberpunk-moonlight-sonata.mp3` is a CC0 OpenGameArt Record Player track from Joth's `Cyberpunk Moonlight Sonata`.
  - Record Player BGM also includes the built-in programmatic Web Audio `Pixel Parlor` loop synthesized in `src/App.tsx`. BGM tracks use per-track volume scaling so the Record Player library stays closer to a consistent perceived loudness. Each future bundled BGM file needs explicit license/source documentation here and in `public/audio/README.md`.
  - `README.md` should record source URLs, authors, original filenames, and license notes whenever bundled audio files are added or replaced.

- `scripts/codex-status-bridge.mjs`
  - Real local agent status bridge.
  - Accepts generic agent HTTP status updates and broadcasts them to Aivatar over WebSocket.
  - Supports both `/agent-status` and legacy `/codex-status` HTTP/WebSocket paths.
  - Supports `/agent-active` for choosing the session the app should follow and `/agent-presence` for keeping the active session visibly connected even when no new status event has arrived.
  - Supports `POST /avatar-state` for receiving the frontend's low-sensitivity avatar personality snapshot and writing it to `%TEMP%\aivatar-avatar-state.json` by default. This file is consumed by session-learning workers for trait-aware bubble tone.
  - Supports `POST /painting-plan` for receiving the frontend's low-sensitivity active painting context, spawning `scripts/aivatar-painting-worker.mjs`, and returning a bounded `paintingPlan` JSON object. The JS bridge and native Tauri bridge expose the same route. The worker writes only temporary derived context under `%TEMP%\aivatar-painting-context` and falls back to heuristic plans when the configured provider fails.
  - Supports `POST /social-dialogue` for receiving the frontend's low-sensitivity Room Visit dialogue context, spawning `scripts/aivatar-social-dialogue-worker.mjs`, and returning a bounded guest/host `dialogue` JSON object. The JS bridge and native Tauri bridge expose the same route. The worker writes only temporary derived context under `%TEMP%\aivatar-social-dialogue-context` and falls back to heuristic dialogue when the configured provider fails.
  - Supports `DELETE /agent-sessions/stale` for manually pruning expired/stale session history.
  - Maintains one latest status per `agent + sessionId` and broadcasts snapshots containing `currentStatus`, `sessions[]`, `activeSessionKey`, `connectedSessionKey`, `currentSessionKey`, and a snapshot timestamp.
  - Adds `expiresAt` to session status/presence records. Fresh status or presence updates extend expiry; expired active/followed sessions are cleared during pruning.
  - Normalizes and preserves optional `usage` fields, including `contextTokens` and `modelContextWindow`, so token usage can flow from status clients into the Agent Sessions panel, context window meters, and Codex reward logic.
  - When a newer status update for the same session omits `usage`, the bridge preserves the previous usage payload so final/terminal status events do not erase context-window meters.
  - Normalizes optional `idleBubbleCandidates` arrays in status payloads so session-derived short phrase suggestions can flow into the Growth panel. These suggestions are bridge-memory only and are not persisted by the bridge. The bridge filters candidates outside the 2-28 character range instead of truncating overlong text into partial phrases.
  - Normalizes optional `learning` payloads in status updates. Learning payloads are bridge-memory only and include `id`, `source`, short summary, filtered 2-28 character idle bubble candidates, bounded trait changes, bounded XP/confidence, and `privacyRisk`.
  - Newer status updates that omit `idleBubbleCandidates` or `learning` no longer inherit the previous same-session values. This prevents old LLM/heuristic session summaries from sticking to later tool-use/executing states.
  - Selects `currentStatus` by preferring a fresh active session, then fresh high-priority sessions, then fresh non-idle sessions, then bridge idle. Presence heartbeats keep a session visibly connected but do not keep stale high-priority statuses such as `executing` driving the main avatar.
  - Treats sessions as stale/expired after `AIVATAR_SESSION_STALE_MS` milliseconds, defaulting to 5 hours. Expired sessions no longer block interaction or drive the main avatar state, and bridge pruning removes them from the session list.
  - Prunes stale sessions and caps the in-memory session map with `AIVATAR_MAX_SESSIONS`, defaulting to `80`, so long-running bridge processes do not grow unbounded.
  - Persists disconnect tombstones under `%TEMP%\aivatar-disconnected-sessions.json` by default, so sessions explicitly disconnected by the UI are not immediately resurrected by discovery after a bridge restart.

- `scripts/codex-session-discovery.mjs`
  - Aivatar-side Codex Desktop session discovery service.
  - Runs as a single background process recorded under `%TEMP%\aivatar-session-discovery\discovery.json`.
  - Read-only scans `CODEX_HOME\sessions\**\*.jsonl`, defaulting to `%USERPROFILE%\.codex\sessions`, and parses `session_meta.payload.id`, `cwd`, `originator`, and `source` from recent rollout files.
  - Only considers rollout files modified within `AIVATAR_DISCOVERY_ACTIVE_MS`, defaulting to `AIVATAR_SESSION_STALE_MS` (5 hours by default), so older chat history is not eagerly connected.
  - Posts `/agent-presence` for detected Codex sessions, starts the external plugin `aivatar-heartbeat.mjs` and `aivatar-watch.mjs` when helpers are missing or dead, records helper pids under `%TEMP%\aivatar-session-discovery\helpers`, and stops helper processes whose rollout files fall outside the active window.
  - When discovery stops an inactive helper, it also posts `/agent-sessions/disconnect` so the bridge immediately removes the stale session row and writes a disconnect tombstone. This prevents old auto-discovered Codex sessions from lingering in Agent Sessions until normal expiry.
  - Also scans Claude Desktop local inventory metadata for recent Chat, Cowork, and Code sidebar sessions. It reads only ids, titles, cwd, and timestamps from Claude JSON/LevelDB metadata and posts idle `claude-code` inventory rows without setting `/agent-active`.
  - Tails Claude Desktop `logs\main.log` for Cowork/Code lifecycle activity and scans recent Chat conversation cache updates for short current-message summaries, posting `source: "claude-desktop-activity"` statuses so inventory-discovered sessions can drive the main avatar instead of remaining idle-only rows. Chat assistant updates settle through `desktop-chat-responding` before `desktop-chat-complete`; tune the debounce with `AIVATAR_CLAUDE_DESKTOP_CHAT_SETTLE_MS`.
  - Passes `CODEX_ROLLOUT_PATH` to each watcher so it tails the exact discovered rollout JSONL instead of searching by session id.
  - Defaults token reward baselines to `%TEMP%\aivatar-usage-baselines.json` to avoid restricted `.codex\tmp` write contexts.
  - Passes `AIVATAR_LEARNING_ENABLED`, `AIVATAR_LEARNING_PROVIDER=codex`, and `AIVATAR_LEARNING_SCRIPT` into spawned Codex watcher helpers, so auto-discovered Desktop sessions can produce `phase: "session-learning"` payloads from sanitized rollout digests.
  - Spawns detached watcher helpers with `windowsHide: true`, preventing helper startup from briefly flashing console windows on Windows.
  - Sends a one-time `thinking` / `discovered` status when it first starts helpers for a session, then leaves real turn state to the watcher. Discovery does not repeatedly overwrite active turn status.
  - Does not modify, rename, delete, migrate, or hide Codex Desktop session/chat files.
  - Does not set `/agent-active` by default; manual `aivatar-connect`, Agent Sessions Follow, and launcher flows remain the explicit ways to choose the followed session.

- `src-tauri/src/codex_discovery.rs`
  - Native packaged-app Codex Desktop discovery path used when Tauri starts the bridge/discovery flow.
  - Watches local Codex rollout JSONL events read-only, emits ordinary turn status, writes sanitized learning context files, and starts `scripts/aivatar-learning-worker.mjs` after `final` / `final_answer` events when a provider command is available.
  - Mirrors the JS discovery path for Claude Desktop local inventory, so packaged Windows builds can show recent Chat/Cowork/Code sidebar sessions even when those sessions only emitted lifecycle-only hook events.
  - Mirrors the JS Claude Desktop activity tracking path by tailing `logs\main.log` for Cowork/Code lifecycle events and posting short Chat cache update summaries when available. It uses the same Chat settle window and `desktopSessionId` alias behavior as the JS bridge/discovery path, so packaged builds do not split Cowork `local_*` running rows from CLI UUID completion rows.
  - Resolves `node`, `codex`, and `claude` through PATH, Windows command variants, and macOS Homebrew/user-bin fallback paths. It passes the resolved provider path to the worker via `AIVATAR_CODEX_COMMAND` or `AIVATAR_CLAUDE_COMMAND`.
  - On Windows, wraps `where.exe` command lookup and worker spawning with `CREATE_NO_WINDOW`, fixing the two quick terminal flashes that could appear after each Codex Desktop turn.

- `C:\Users\rniu\plugins\aivatar-session-bridge`
  - External local session plugin, currently outside this repo.
  - `aivatar-connect` now stops only the same session's previous heartbeat/watcher rather than stopping all Aivatar session background processes.
  - `aivatar-heartbeat` defaults to presence-only updates; it does not repeatedly post active/follow state unless explicitly launched with `--active`.
  - `aivatar-watch` falls back to context-window usage for `complete`/`error` events when token-delta usage is unavailable, so worktree sessions can continue showing context after final answers. It also reads Codex JSONL `rate_limits.primary/secondary` windows (`300` and `10080` minutes) into Aivatar token-limit usage percentages for the collapsed HUD.
  - `aivatar-watch` streams Codex rollout `agent_message` records with `phase: "commentary"` as live `thinking` / `commentary` statuses, preserving the token baseline and keeping the turn in progress so Codex Desktop and CLI commentary can appear in the avatar bubble before `final` / `final_answer`.
  - `aivatar-watch` now keeps a bounded sanitized Codex conversation digest from rollout `user_message` and final/final_answer `agent_message` events, writes `%TEMP%\aivatar-learning-context\codex-*.txt`, and spawns the repo `scripts/aivatar-learning-worker.mjs` on terminal completion when learning is enabled. It passes the avatar state snapshot path so Codex-derived learning bubbles can use current trait-aware tone.

- `src-tauri/src/lib.rs`
  - Owns the Tauri command that starts the Node status bridge from the desktop app.
  - Starts the native bridge/discovery path and passes the bundled `scripts/aivatar-learning-worker.mjs` path into both `src-tauri/src/codex_discovery.rs` and `src-tauri/src/local_bridge.rs`, so installed Windows builds can request Codex and Claude Code LLM session-learning from sanitized digests.
  - Packaged-app script and connector resolution prefers bundled Tauri resources when an `AppHandle` is available, including macOS resource layouts such as `Contents/Resources/_up_/scripts` and `Contents/Resources/_up_/plugins/aivatar-session-bridge`. Environment and development-checkout fallbacks are limited to debug/no-app contexts, so an installed macOS app should not spawn scripts from `/Users/.../Documents/Aivatar-0.2/scripts` unless explicitly launched in a development/override mode.
  - On Windows, command resolution for launcher paths hides `where.exe` with `CREATE_NO_WINDOW`, matching the discovery-side no-flash behavior. opencode resolution also checks `%LOCALAPPDATA%\opencode\opencode-cli.exe`; macOS/Linux command lookup includes ordinary PATH plus Homebrew and user-bin fallbacks through the wrapper scripts.
  - Attempts to start the bridge automatically during Tauri app setup and also starts `status:discover` for Aivatar-side Codex Desktop session discovery.
  - Exposes the same bridge/discovery start flow to the React Debug panel through `start_status_bridge`.
  - If the bridge is already running, `start_status_bridge` still attempts to start discovery; the discovery script exits when another discovery instance is already alive.
  - Exposes `get_agent_integrations` and `enable_agent_integration`, used by the Desktop Agents panel. `get_agent_integrations` reports Claude Code and opencode detection/enabled/CLI/restart status; `enable_agent_integration` writes Claude Code hook/statusLine wrappers plus `~/.claude/settings.json` entries, or writes the bundled opencode plugin to `~/.config/opencode/plugins`.
  - Exposes `start_agent_cli`, used by the CLI Launcher. It validates the selected working directory, starts the status bridge if needed, opens PowerShell in that folder, and runs `scripts/aivatar-connected-run.mjs --agent <agent> -- <codex|claude|opencode> <args>` so launcher-started CLIs auto-connect to Aivatar and disconnect on exit.
  - Exposes `start_task_agent`, used by Task Cabinet automation. It validates the selected working directory, validates that the task path is an existing `.md` file, reads the source `.md` file without modifying it, rejects prompts over 24,000 characters, writes a derived prompt copy under `%TEMP%\aivatar-task-prompts\`, starts the bridge if needed, and launches Codex, Claude Code, or opencode through `scripts/aivatar-connected-run.mjs --prompt-file <tempPrompt>`.
  - Exposes `pick_markdown_task_file` and `pick_launcher_directory`, used by desktop Browse buttons for Task Cabinet and CLI Launcher path selection.
  - Exposes `resize_main_window_for_side_panel`, used by the React side-panel collapse flow to update the main window minimum size and size together, reducing WebView flicker during menu collapse/expand.
  - Intercepts main-window close requests, emits `aivatar://save-before-close` to the frontend, waits briefly, then closes the window so the latest avatar runtime, room surface choices, layout, inventory, wallet, and stats have a chance to flush to localStorage.

- `src-tauri/tauri.conf.json`
  - Tauri bundle configuration now points at `icons/icon.ico`, so desktop builds use Aivatar's app icon instead of relying on an empty icon list.
  - The main window no longer starts as always-on-top by config. `alwaysOnTop` defaults to `false`; the user-facing Settings toggle in `src/App.tsx` controls Tauri `setAlwaysOnTop` at runtime.
  - Current desktop preview package metadata is `0.1.1` across `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. The Windows NSIS installer `Aivatar_0.1.1_x64-setup.exe` has been uploaded to the GitHub release tag `v0.1.1-desktop-preview`.

- `src-tauri/capabilities/default.json`
  - Includes `core:window:allow-set-always-on-top` so the React Settings toggle can update the native desktop window's always-on-top state. Keep this permission narrow unless another frontend window API is actually needed.

- `src-tauri/icons/`
  - Contains the desktop app icon: `icon.ico` for Tauri/Windows bundle usage and `icon.png` as the editable source/reference image. The current icon is a simplified high-contrast pixel octopus mark optimized for small Windows taskbar/title-bar sizes.
  - The Windows ICO is generated from `icon.png` with explicit `16`, `24`, `32`, `48`, `64`, `128`, and `256` pixel layers so small shell surfaces do not depend only on OS downscaling.
  - The current icon is a static build-time app icon based on the original octopus mark. It does not dynamically change the running EXE/window icon when users switch save slots or choose non-octopus avatar appearances.

- `scripts/aivatar-run.mjs`
  - Generic lifecycle wrapper for commands and AI agent CLIs.
  - Sends `thinking`, `executing`, `waiting_for_user`, `complete`, and `error` updates to the bridge while the wrapped process runs.
  - Supports `--agent <name>` and `--session <id>`; if no session id is provided, it generates one automatically so concurrent agent runs do not overwrite each other.
  - Treats Codex, Claude Code, and opencode as interactive TUI agents so their stdin/stdout/stderr stay inherited instead of being piped through wrapper output watchers.
  - Resolves a bare `opencode` command through platform fallbacks before spawning, including `%LOCALAPPDATA%\opencode\opencode-cli.exe` on Windows and Homebrew/user-bin paths on macOS/Linux.
  - This remains useful for simple command lifecycle tracking, but the desktop CLI Launcher now uses `scripts/aivatar-connected-run.mjs` for seamless connect/watch/disconnect behavior.

- `scripts/aivatar-connected-run.mjs`
  - Connected CLI wrapper used by `codex:connected`, `claude:connected`, `opencode:connected`, and the desktop CLI Launcher.
  - Runs `aivatar-cli-connect -> target CLI -> aivatar-cli-disconnect`, forwarding the target CLI exit code.
  - Uses absolute paths to repo scripts so it works when launched from any selected project folder.
  - For Codex without an explicit session id, it avoids inheriting stale `CODEX_THREAD_ID`/`CODEX_SESSION_ID`, snapshots existing rollout JSONL files, launches Codex, detects the new rollout file, extracts the real Codex session id, disconnects the provisional session, and reconnects Aivatar to the real session.
  - For Claude Code, writes a temporary settings file under `%TEMP%\aivatar-claude-code-settings\`, passes it via `claude --settings <file>`, and registers Aivatar command hooks plus statusLine for the current launched session. Hook handlers use exec form (`command` plus `args`) so Windows Git Bash is bypassed for turn events. StatusLine uses a generated PowerShell wrapper `<session>.statusline.ps1` that forwards stdin to the Node hook script. If the user explicitly passes `--settings`, automatic injection is skipped so user settings are not overwritten.
  - For opencode, connects with an initial `idle` placeholder, disables the Codex rollout watcher with the reason `opencode uses plugin events`, and expects real status to arrive from `scripts/aivatar-opencode-plugin.mjs`. Task Cabinet prompt files are passed to opencode as `--prompt <content>`.
  - Resolves a bare `opencode` command through platform fallbacks before spawning, including `%LOCALAPPDATA%\opencode\opencode-cli.exe` on Windows and Homebrew/user-bin paths on macOS/Linux.
  - Passes `AIVATAR_HTTP_ENDPOINT`, `AIVATAR_ACTIVE_ENDPOINT`, and `AIVATAR_PRESENCE_ENDPOINT` into launched agent environments so hook/statusLine subprocesses post to the same bridge endpoints as the launcher.
  - Automatically enables Aivatar session learning for connected CLI sessions by passing `AIVATAR_LEARNING_ENABLED=1` unless the environment already sets a value. It defaults `AIVATAR_LEARNING_PROVIDER` to `codex` for Codex sessions, `claude-code` for Claude Code sessions, and `opencode` for opencode sessions, while still honoring explicit user overrides.
  - Passes a wrapper parent pid to the CLI connector so a watchdog can clean up heartbeat/watcher helpers if the user directly closes the terminal window.
  - Supports `--prompt-file <path>` for Task Cabinet automation. The wrapper reads the prompt file with Node and passes the file contents in the form expected by each CLI: Claude Code gets `-- <prompt>`, opencode gets `--prompt <prompt>`, and Codex gets a single prompt argument. On Windows, Codex launches through the npm-installed `@openai/codex/bin/codex.js` with `node` and Claude Code launches by directly spawning `claude.exe`, so full `.md` prompts with spaces/newlines are passed as argv arguments without `cmd.exe` string re-parsing or the broken `codex -- <prompt>` form that made leading words look like subcommands.

- `scripts/aivatar-claude-desktop-link.mjs`
  - Dry-run/apply helper for linking Claude Desktop/Code sessions to Aivatar's existing Claude Code hook/statusLine bridge.
  - By default, prints the target Claude settings path and merged hook/statusLine configuration without changing files. Passing `install --apply` merges Aivatar env/hooks/statusLine into the selected Claude settings file and writes a Windows PowerShell statusLine wrapper when needed.
  - Exports settings-fragment and merge helpers so `scripts/aivatar-desktop-agent-adapters-smoke.mjs` can verify the generated config without touching user settings.

- `scripts/aivatar-opencode-plugin.mjs`
  - opencode Desktop/TUI plugin adapter plus dry-run/apply installer helper.
  - The dry-run installer prints the user plugin target under `%USERPROFILE%\.config\opencode\plugins`; passing `install --apply` copies the plugin there. Restart opencode after installing so it can load the plugin.
  - Maps low-detail opencode plugin events into generic Aivatar statuses without reading or uploading full transcript content: `session.status` / `message.updated` become work states, `permission.asked` becomes `waiting_for_user`, `session.idle` becomes `complete`, and `session.deleted` disconnects the session.
  - Posts opencode `experimental.text.complete` assistant text as live `thinking` / `message-display` status so current assistant wording can appear in the avatar bubble during Desktop/TUI and CLI sessions.
  - Collects a bounded sanitized digest from opencode `chat.message`, `experimental.text.complete`, and event summaries. On `complete`/`error`, it spawns `scripts/aivatar-learning-worker.mjs` with provider `opencode` when an app-installed plugin has embedded worker/node paths; otherwise it posts a heuristic `phase: "session-learning"` payload so Growth bubble recommendations still update.

- `scripts/aivatar-desktop-agent-adapters-smoke.mjs`
  - Local smoke test for the desktop-agent adapter layer. It mocks `fetch`, exercises the opencode plugin event mapping including `experimental.text.complete` live `thinking` / `message-display` posts, verifies Claude Desktop settings generation/merge behavior, and starts a temporary JS bridge to verify Claude native hook `UserPromptSubmit` / `MessageDisplay` / `Stop` events produce a `phase: "session-learning"` fallback payload when the worker path is unavailable. It also verifies Claude `MessageDisplay` summaries carry the visible assistant text, Claude statusLine context updates do not downgrade an active `thinking` turn to `idle`, repeated `Stop` events preserve the existing learning id rather than creating duplicate learning, and Claude Desktop `local_*`/CLI UUID rows with the same `desktopSessionId` merge into one terminal session.

- `scripts/aivatar-learning-worker.mjs`
  - Session-learning worker that can be run manually or spawned by Claude Code hooks and Codex rollout watchers. It accepts provider, agent, session, status, summary, optional `--context-file`, and optional `--avatar-state-file`, creates a sanitized digest prompt, calls a provider, normalizes the result, and posts a `phase: "session-learning"` status containing `learning`.
  - Supports `--provider claude-code`, `--provider codex`, `--provider opencode`, and `--provider none`. Claude Code uses `claude --bare --print --output-format json --json-schema --tools "" --no-session-persistence`; Codex uses `codex exec` in read-only/no-approval/ephemeral mode with a JSON schema and stdin prompt; opencode uses `opencode run --format json <prompt>`; `none` uses local heuristic fallback for smoke tests.
  - Honors `AIVATAR_CLAUDE_COMMAND`, `AIVATAR_CODEX_COMMAND`, `CODEX_COMMAND`, `AIVATAR_OPENCODE_COMMAND`, and `OPENCODE_COMMAND` provider command overrides. On Windows, if no explicit Codex JS path is provided, it searches PATH for `codex.cmd` and the adjacent npm global `node_modules/@openai/codex/bin/codex.js`; when found, it launches that JS entry through `process.execPath` instead of the `.cmd` shim to avoid visible console flashes. opencode provider resolution also checks `%LOCALAPPDATA%\opencode\opencode-cli.exe`, `opencode.cmd`, `opencode.exe`, and macOS/Homebrew user-bin paths before falling back to `opencode`.
  - Learning output is strict, bounded, and low sensitivity: short summary, 2-28 character idle bubble candidates, small trait changes, XP/confidence bounds, and privacy risk. Idle bubble candidates should be one complete short sentence rather than keywords, labels, slogans, or clipped fragments; they should sound like something a gentle human companion might say in one breath. The worker prompt allows natural emoji or tiny decorative symbols, while still avoiding markdown, file paths, commands, logs, and technical wording. Provider errors, invalid JSON, timeouts, missing Claude login, or unavailable Codex exec fall back to heuristic learning and must not break bridge status flow.
  - Reads `%TEMP%\aivatar-avatar-state.json` by default, or the path passed with `--avatar-state-file`, to tune bubble voice from the current avatar personality. The prompt includes trait totals, dominant trait, and secondary trait, but instructs providers not to mention trait names, levels, or point totals inside bubbles. The heuristic fallback also prepends a dominant-trait-specific phrase so tone changes remain visible when LLM providers are unavailable.
  - Sanitizes code blocks, inline code, URLs, Windows/Unix paths, email addresses, and common secret/token patterns before prompting providers. It does not modify source session/transcript files.
  - Detects Chinese text in the digest/summary. Chinese sessions instruct providers to generate natural Simplified Chinese idle bubble candidates. The heuristic fallback now repairs likely mojibake, parses sanitized `user:` / `assistant:` transcript snippets when available, and generates topic-aware pet phrases from the conversation instead of only returning generic fallback bubbles. For example, a Chinese discussion about a historically weighty date can produce candidates such as `今天有点重量`, `把这天记住`, `希望还在闪`, and `陪你想一会`.

- `scripts/aivatar-painting-worker.mjs`
  - Painting-plan worker used by the Oil Easel through bridge `POST /painting-plan`, and available manually through `npm.cmd run aivatar:paint -- --provider none --payload-file <path>`.
  - Accepts `--provider claude-code`, `--provider codex`, `--provider opencode`, or `--provider none`, plus `--payload-file`. Provider resolution follows the session-learning worker environment conventions, including `AIVATAR_PAINTING_PROVIDER`, `AIVATAR_LEARNING_PROVIDER`, `AIVATAR_CLAUDE_COMMAND`, `AIVATAR_CODEX_COMMAND`, `CODEX_COMMAND`, `AIVATAR_OPENCODE_COMMAND`, and `OPENCODE_COMMAND`.
  - Returns a strict, bounded JSON painting plan: short title, one archetype, mood, palette hint, composition slots, motifs, and source. The allowed archetypes are `signal_tower`, `window_city`, `terminal_star_map`, `desk_still_life`, `harbor_beacon`, `mountain_path`, `circuit_grid`, `mosaic_garden`, `color_bloom`, and `lantern_room`.
  - Treats the provider as a tiny art director rather than the pixel renderer. The frontend still renders all final 24x35 pixel art locally in `src/game/paintings.ts`, so provider failures, invalid JSON, unavailable login, or timeout fall back to a local heuristic plan without blocking painting progress.
  - The prompt uses only the sanitized low-sensitivity painting payload supplied by the app: avatar id/name, growth level, trait totals, dominant/secondary trait labels, recent memory summaries, saved idle bubbles, preferences, and draft progress metadata. It instructs providers not to include paths, code, URLs, logs, secrets, private identifiers, or trait point totals in the plan.

- `scripts/aivatar-social-dialogue-worker.mjs`
  - Social-dialogue worker used by Room Visit host-side socializing through bridge `POST /social-dialogue`, and available manually through `npm.cmd run aivatar:social-dialogue -- --provider none --payload-file <path>`.
  - Accepts `--provider claude-code`, `--provider codex`, `--provider opencode`, or `--provider none`, plus `--payload-file`. Provider resolution follows the session-learning worker environment conventions, including `AIVATAR_SOCIAL_DIALOGUE_PROVIDER`, `AIVATAR_LEARNING_PROVIDER`, `AIVATAR_CLAUDE_COMMAND`, `AIVATAR_CODEX_COMMAND`, `CODEX_COMMAND`, `AIVATAR_OPENCODE_COMMAND`, and `OPENCODE_COMMAND`.
  - Returns a bounded JSON dialogue with 3-6 short ordered lines, each line owned by `guest` or `host`, plus a short summary, relationship delta, source, and generated timestamp. The frontend plays those lines in order instead of letting both bubbles speak at once.
  - The prompt uses only sanitized low-sensitivity Room Visit context: visit id, locale, current social activity, host/guest names, growth level, trait totals, pet stats, accepted idle bubbles, room feature tags, affinity, visits, unlocked activities, and the last dialogue summary. It must not include raw agent chats, full localStorage, source code, paths, logs, URLs, secrets, private identifiers, or trait point totals in visible dialogue.

- `scripts/claude-code-aivatar-hook.mjs`
  - Claude Code hook/statusLine bridge used by `claude:connected` and launcher-started Claude Code sessions.
  - Reads Claude Code hook JSON from stdin and posts generic `claude-code` status updates to the Aivatar bridge.
  - Maps Claude lifecycle/setup events such as `SessionStart`, `Setup`, `InstructionsLoaded`, `ConfigChange`, and `CwdChanged` to `idle` without stealing current work. `UserPromptSubmit`, `UserPromptExpansion`, compacting, elicitation result events, and `MessageDisplay` map to `thinking`; `PreToolUse`, `SubagentStart`, and task creation map to `executing`; `PostToolUse`, `PostToolBatch`, `PostToolUseFailure`, `SubagentStop`, and `TaskCompleted` map back to `thinking` because they are intermediate result-review signals rather than full turn completion. Permission and elicitation prompts map to `waiting_for_user`; `Stop` and `TeammateIdle` are terminal `complete`; `StopFailure` and denied permissions are `error`; `SessionEnd` stays `idle` unless a prior `complete`/`error` should be preserved.
  - For `MessageDisplay` / response display events, prefers visible assistant `delta`, `message`, `text`, `content`, `last_assistant_message`, or `assistant_message` values, compacting and sanitizing them into the posted `thinking` / `message-display` summary for the avatar bubble. Recoverable tool failures use `thinking` / `tool-result-failed` summaries so a failed Bash/tool command does not force the whole Claude turn into terminal `error` while Claude can still continue.
  - Prefers `AIVATAR_SESSION_ID` over Claude's native `input.session_id`, which keeps Task Cabinet and launcher status mapped to the session id Aivatar created. After a session reaches `complete` or `error`, late non-terminal hook/statusLine events preserve the terminal status until a new `UserPromptSubmit` begins another turn.
  - Reads statusLine `context_window` payloads to populate `usage.contextTokens`, `usage.modelContextWindow`, token totals, and reward/context scope. When statusLine sees output tokens after an active turn but no terminal hook has been observed, it emits a fallback `complete` status so the avatar does not stay stuck in `thinking`.
  - When `AIVATAR_LEARNING_ENABLED=1`, terminal `complete`/`error` statuses spawn `scripts/aivatar-learning-worker.mjs` in the background after the ordinary bridge status/presence/active updates. The hook writes sanitized digest files under `%TEMP%\aivatar-learning-context\` from the current hook payload plus recent Claude transcript `user`/`assistant` snippets, and records `lastLearningKey` in session state so repeated terminal/statusLine observations of the same turn do not repeatedly trigger learning. Preserved terminal statuses from late `Notification`, statusLine, or `SessionEnd` updates do not retrigger learning; a new `UserPromptSubmit` clears the prior learning key for the next turn.
  - Stores lightweight per-session state under `%TEMP%\aivatar-claude-code-state\` and diagnostic event logs under `%TEMP%\aivatar-claude-code-events\*.jsonl`. If Claude Code reports `hook_cancelled` in its transcript, inspect these files first; missing event logs usually mean the hook command did not finish or was not invoked.
  - The hook avoids blocking Claude Code by settling stdin after a short idle delay and using short HTTP timeouts when posting to the bridge.

- `scripts/aivatar-cli-connect.mjs`
  - Repo-local CLI session connector.
  - Sends an initial status, sets the session active, posts presence, starts the external plugin heartbeat, starts the external plugin watcher when available, and records helper pids under `%TEMP%\aivatar-cli-session`.
  - Supports `--initial-status`, allowing Claude Code sessions to connect as `idle` until a real hook event arrives, while Codex and generic wrappers can still default to `thinking`.
  - Supports `--watch-disabled-reason`, so Claude Code sessions report `watcher disabled (Claude Code uses hooks/statusLine)` instead of the misleading `watcher unavailable`; Codex rollout watching remains the watcher path.
  - Defaults `AIVATAR_USAGE_BASELINE_PATH` to `%TEMP%\aivatar-usage-baselines.json`, preserving token reward support without requiring write access to `.codex\tmp`.
  - Supports `--no-watch` for non-Codex or provisional sessions and `--watch-parent-pid` to start watchdog cleanup.

- `scripts/aivatar-cli-disconnect.mjs`
  - Stops recorded heartbeat/watcher/watchdog helpers and clears active/follow state when a connected CLI exits.
  - Before sending an `idle` disconnect status, checks the bridge's current session row. If the session is already `complete` or `error`, disconnect cleanup preserves that terminal status and only clears active state, preventing Task Cabinet tasks from flipping from `Completed` back to `Failed`.

- `scripts/aivatar-cli-disconnect.mjs`
  - Repo-local CLI session disconnect helper.
  - Stops recorded heartbeat, watcher, and watchdog pids; sends an `idle` status; and clears active follow state for the requested session.

- `scripts/aivatar-cli-watchdog.mjs`
  - Watches the connected wrapper parent pid.
  - If the terminal/window is closed before the wrapper can run its normal `finally` cleanup, the watchdog runs `aivatar-cli-disconnect.mjs` for that session to avoid stale connected sessions in Aivatar.

- `scripts/send-codex-status.mjs`
  - Convenience CLI for manually pushing one generic agent status update to the bridge.
  - Kept under the old filename for compatibility with `status:send`.

- `C:\Users\rniu\plugins\aivatar-session-bridge`
  - Local Codex plugin used during development to connect the current Codex session to Aivatar.
  - Provides `aivatar-connect.cmd` and `aivatar-disconnect.cmd` for simple session lifecycle commands, `aivatar-setup.cmd` for PATH setup, `aivatar-status.mjs` for explicit status posts, `aivatar-heartbeat.mjs` for active session presence, `aivatar-watch.mjs` for Codex Desktop rollout watching, `aivatar-status-hook.mjs` for PostToolUse fallback activity, and `codex-usage.mjs` for Codex Desktop token usage baseline/delta extraction.
  - `aivatar-connect` starts the current session heartbeat and rollout watcher, marks the session active, sends an initial visible `thinking` status, and cleans up stale background processes from older plugin sessions so multiple sessions do not fight for the active Aivatar connection.
  - `aivatar-disconnect` stops the recorded heartbeat and watcher, sends `idle`, clears the active session only when it still matches the disconnecting session, and clears the token baseline without granting a reward.
  - Token usage integration reads the current Codex Desktop rollout JSONL through the local `CODEX_THREAD_ID`/session id path. `thinking` resets the reward baseline, `executing` and `waiting_for_user` preserve it, `complete` and `error` calculate usage delta and clear it, and `idle` or `--clear-active` clear it without usage reward.
  - Context window integration reads `model_context_window` and `last_token_usage.total_tokens` from Codex Desktop `token_count` events, sends `usage.contextTokens` and `usage.modelContextWindow`, and can send context-only usage with `scope: "context-window"` even when reward delta is zero.
  - `aivatar-watch.mjs` handles Codex Desktop `custom_tool_call` and `custom_tool_call_output` events as well as the older `function_call` and `function_call_output` shapes. Tool use sends `executing`; tool output sends `thinking` with `phase: "tool-result"` and message `Reading tool results`, so the avatar does not remain stuck in `executing` after a completed tool call.
  - `aivatar-watch.mjs` maps Codex `agent_message` records with `phase: "commentary"` to live `thinking` / `commentary` status, preserves the token baseline, and does not trigger completion. This is the path that lets the avatar bubble show Codex Desktop and CLI commentary while a turn is still running.
  - `aivatar-status-hook.mjs` is now treated as a PostToolUse fallback and sends `thinking`/`tool-result` activity rather than forcing `executing` after the tool already completed.
  - `aivatar-watch.mjs` also generates local-rule idle bubble phrase candidates from current-session user messages and final agent messages. Rather than mainly slicing transcript text, it detects session themes and emits session-inspired pet thoughts from a bilingual template library, while still allowing a small number of natural conversational snippets. It filters URLs, commands, paths, code/log-like text, keeps short 2-28 character phrases, and sends up to 12 recent candidates through `idleBubbleCandidates` without storing full conversation text.
  - `aivatar-watch.mjs` keeps a bounded sanitized Codex conversation digest from rollout `user_message` and final/final_answer `agent_message` events, writes `%TEMP%\aivatar-learning-context\codex-*.txt`, and spawns the repo `scripts/aivatar-learning-worker.mjs` on terminal completion when `AIVATAR_LEARNING_ENABLED=1`. It passes the avatar state snapshot file so Codex-derived learning bubbles can use current trait-aware tone.
  - The watcher idle bubble template library currently has 8 categories (`fix`, `reading`, `waiting`, `polish`, `success`, `thinking`, `cozy`, `daily`) with 16 Chinese and 16 English phrases per category, for 256 built-in template phrases. The `daily` category covers more life-like, casual, and routine moments.
  - Baselines are stored under the Codex home temp area by default, expire after `AIVATAR_USAGE_BASELINE_TTL_MS` (defaulting to six hours), and are pruned automatically when the baseline file is read.
  - Lives outside the repo for now; this repo provides npm wrappers through `scripts/aivatar-session-plugin.mjs` and documents the workflow in `docs/aivatar-session-plugin.md`.

## Current Session Plugin Design

The session plugin now uses a Codex Pet-style split between connection presence and turn state:

- `aivatar-heartbeat.mjs` is the presence layer. It keeps the selected session active/connected in Aivatar even when no new conversation events arrive.
- `aivatar-watch.mjs` is the turn-state layer. It tails only the current session rollout JSONL from the connect-time end of file, so old events are not replayed when a session connects.
- `aivatar-connect` starts both helpers and stores separate `.heartbeat.json` and `.watcher.json` PID records under the system temp `aivatar-session-bridge` directory.
- `aivatar-disconnect` stops both helpers, sends `idle`, clears active follow state, and clears token baselines without reward usage.

Watcher event mapping:

- `event_msg` with `payload.type === "user_message"` -> `thinking`, reset token baseline.
- `response_item` with `payload.type === "function_call"` or `"custom_tool_call"` -> `executing`, preserve or create token baseline.
- `response_item` with `payload.type === "function_call_output"` or `"custom_tool_call_output"` -> `thinking` with `phase: "tool-result"`, preserve token baseline, and keep context usage visible when available.
- `event_msg` with `payload.type === "agent_message"` and `phase === "commentary"` -> `thinking` with `phase: "commentary"`, preserve the token baseline, and keep the turn in progress so the avatar bubble can show live Codex commentary.
- `event_msg` with `payload.type === "agent_message"` and `phase === "final"` or `phase === "final_answer"` -> `complete`, send token delta usage and clear baseline.
- `event_msg` with `payload.type === "token_count"` can update the latest live state with context window usage derived from `last_token_usage.total_tokens / model_context_window`; after `complete`, `error`, or `idle`, the watcher clears the live-state cache so token-count events do not overwrite terminal states.

The PostToolUse hook remains as a fallback activity signal, but the watcher is now the preferred real-time path for ordinary Codex Desktop chat turns.

## Scene And Asset Size References

- Virtual scene canvas size: `480 x 320`.
- Wall area used by placement/editor references: `x=76, y=20, width=328, height=106`.
- Floor area used by placement/editor references: `x=76, y=126, width=328, height=180`.
- Ordinary avatar visual footprint is roughly `37 x 53` pixels around the runtime avatar anchor.
- Recommended editor presets:
  - Avatar S: `48 x 56`, for ordinary avatar frames.
  - Avatar Act: `64 x 64`, for larger actions, tools, or expressive poses.
  - Desktop: `32 x 32`, for desktop/tabletop items.
  - Furniture: `64 x 64`, for small furniture or decor.
  - Room Ref: `480 x 320`, for full-scene reference work.
- Card Room reference sizes:
  - Card Room canvas: `960 x 640`.
  - Poker table sprite: `640 x 220`, positioned around `x=160, y=320` in Card Room logical coordinates.
  - Table card scale: `0.62` of the base `42 x 58` card.
  - Public-card frame centers in table-local coordinates: `x=[224.5, 272, 319.5, 367.5, 414.5]`, `y=125`.
  - Wide city window PNG: `480 x 154`; outer corners are transparent rounded PNG pixels, and glass rect is `x=34, y=37, width=412, height=84`.
  - Wall sconce PNG: `24 x 36`; renderer draws a separate circular warm glow behind it.
  - Chip-stack rows: `350 chips` per visual row, `10` row cap, three visible chip columns per row.
  - Payout animation: Pot-to-winner flights clear the visible Pot in about `240ms`; flying chip count is based on the visible Pot stack count, not on the raw payout amount.

## Agent Status Bridge

Aivatar listens here:

```text
ws://127.0.0.1:38987/agent-status
ws://127.0.0.1:38987/codex-status  legacy compatibility
```

The bridge accepts status updates here:

```text
POST http://127.0.0.1:38988/agent-status
GET  http://127.0.0.1:38988/agent-status
POST http://127.0.0.1:38988/agent-active
DELETE http://127.0.0.1:38988/agent-active
POST http://127.0.0.1:38988/agent-presence
POST http://127.0.0.1:38988/painting-plan
POST http://127.0.0.1:38988/agent-hooks/claude-code
POST http://127.0.0.1:38988/agent-hooks/claude-code/status-line
POST http://127.0.0.1:38988/codex-status  legacy compatibility
GET  http://127.0.0.1:38988/codex-status   legacy compatibility
GET  http://127.0.0.1:38988/health
```

Status payload shape:

```json
{
  "agent": "codex | claude-code | opencode | aider | cursor | custom",
  "sessionId": "optional session id",
  "status": "idle | thinking | executing | waiting_for_user | error | complete",
  "phase": "optional short phase name",
  "task": "optional current task summary",
  "summary": "optional short bubble text",
  "detail": "optional longer detail",
  "progress": 0,
  "message": "optional display text",
  "severity": "info | warning | error",
  "idleBubbleCandidates": ["optional short session-derived phrase"],
  "usage": {
    "inputTokens": 0,
    "cachedInputTokens": 0,
    "outputTokens": 0,
    "reasoningOutputTokens": 0,
    "totalTokens": 0,
    "source": "codex-desktop-jsonl | custom",
    "scope": "since-baseline | last-turn | synthetic"
  },
  "learning": {
    "id": "stable session-learning id",
    "source": "llm | heuristic",
    "summary": "bounded memory summary",
    "idleBubbleCandidates": ["short complete phrase"],
    "traitChanges": {
      "focus": 1,
      "resilience": 0,
      "curiosity": 0,
      "efficiency": 0,
      "creativity": 0,
      "warmth": 0
    },
    "xp": 2,
    "confidence": 0.5,
    "privacyRisk": "low | medium | high"
  },
  "timestamp": "ISO-8601"
}
```

Bridge snapshot shape:

```json
{
  "type": "aivatar.status.snapshot",
  "currentStatus": {},
  "sessions": [],
  "activeSessionKey": "codex:session-id",
  "connectedSessionKey": "codex:session-id",
  "currentSessionKey": "codex:session-id",
  "timestamp": "ISO-8601"
}
```

Session identity and freshness:

- Sessions are keyed by `agent + sessionId`.
- The bridge keeps the latest status for each session and broadcasts the sorted session list.
- `activeSessionKey` is the session explicitly selected by the app or an external status client.
- `connectedSessionKey` is the active session that the bridge still recognizes as connected through status or presence events. It may remain set when that session is stale, so the UI can show that Aivatar is linked to the user's chosen session but idle.
- `currentSessionKey` is the fresh session currently driving the main avatar behavior. It becomes null when no fresh session should drive the avatar.
- `currentStatus` prefers a fresh active session, then fresh high-priority sessions, then fresh non-idle sessions, then bridge idle.
- Stale sessions remain visible in the Agent Sessions panel but no longer block interactions or drive the avatar.
- Session payloads can include `expiresAt`; when present, the UI uses it as the source of truth for stale/expired display.
- Stale timeout defaults to 5 hours and can be changed with `AIVATAR_SESSION_STALE_MS`.

Behavior mapping:

  - `idle`: autonomous life behavior. When truly idle with no action intent, stale navigation targets are reset to the avatar's current position so old interaction targets do not keep driving pathfinding.
- `thinking`: avatar goes to the desk/Terminal area for focused thought while the avatar thinking bubble shows the current agent summary.
- `executing`: avatar codes/works directly in front of the placed Terminal.
- `waiting_for_user`: avatar pauses and waits.
- `error`: avatar shows worried/error behavior.
- `complete`: avatar celebrates and earns bits.
  - If work boost is active, `complete` earns bonus bits.
  - Rewards only apply to reward-eligible agents in `src/agentRegistry.ts` (`codex`, `claude-code`, and `opencode`) that transition from an active state into `complete`, or to a fresh active/connected complete event when the UI did not observe the earlier active state.
  - Active reward-eligible previous states are `thinking`, `executing`, `waiting_for_user`, and `error`.
  - If `usage.totalTokens` is present, token rewards use weighted tokens:
    - `weightedTokens = uncachedInputTokens + cachedInputTokens * 0.1 + outputTokens + reasoningOutputTokens`.
    - `bits = min(100, 4 + floor(weightedTokens / 1000))`, before any work boost bonus.
    - If `usage.totalTokens > 1,000,000`, the cap is `1000` instead of `100`.
    - If usage is absent, invalid, or `scope: "context-window"`, the reward falls back to the fixed 4-bit base.

Per-turn status protocol:

- Active work should eventually be pushed to `complete`, `idle`, or `error` instead of being left in `thinking` or `executing`.
- Use `complete` when the task finished and should be eligible for agent reward logic.
- Use `idle` when the agent is simply no longer doing work and should not trigger a reward.

Terminal notification rules:

- Terminal bubbles only show notifications from agents marked `terminalBubble: true` in `src/agentRegistry.ts`; this currently includes Codex, Claude Code, and opencode.
- `thinking` does not display a Terminal bubble; it displays as the avatar thinking bubble.
- Debug and simulated statuses do not display Terminal bubbles.

Agent Sessions panel:

- The side panel shows recent sessions with agent, session id, status, summary, and Active/Connected/Current/Idle/Stale state.
- `Follow` posts to `/agent-active` and makes that session the preferred active session.
- `Clear` deletes `/agent-active` and returns selection to bridge priority rules.
- The main avatar still follows only `currentStatus`; `sessions[]` is currently display context rather than a multi-avatar controller.

High-priority agent states should not be interrupted by right-click context-menu interaction actions:

- `thinking`
- `executing`
- `waiting_for_user`
- `error`

## Current Implemented Features

- Tauri desktop app shell with a small window; always-on-top is user-controlled from Settings and defaults off.
- Tauri desktop app attempts to auto-start the local status bridge at launch.
- Local bridge supports the Room Visit MVP through `/rooms`, `/visits/invite`, `/visits/state`, and `/visits/end`; room presence and visit sessions are short-lived in-memory coordination state only.
- React/Vite frontend.
- Dev preview and Tauri dev URL are unified on `http://localhost:1420/` to reduce save-state origin splits between `localhost` and `127.0.0.1`.
- Canvas-rendered pixel room.
- Settings live in a collapsible Settings side-panel card. Avatar name, language, UI theme, global SFX volume, startup sound, Game Console volume, BGM track, BGM volume, autonomous music, and desktop always-on-top controls are grouped there. The compact Settings header only summarizes the current SFX volume with a theme-adaptive speaker icon; the current BGM track is configured only in the expanded menu. The BGM track control includes a small helper note that music playback requires a placed Record Player. Global SFX volume persists per browser/Tauri origin under `aivatar.audioVolume.v1`, while the independent Game Console volume persists under `aivatar.gameConsoleVolume.v1`.
- First app-level user interaction unlocks audio. Optional startup chime is persisted under `aivatar.startupSound.v1`, independent Game Console volume under `aivatar.gameConsoleVolume.v1`, Record Player track choice under `aivatar.bgmTrack.v1`, independent BGM volume under `aivatar.bgmVolume.v1`, autonomous music under `aivatar.autoMusic.v1`, and desktop always-on-top under `aivatar.alwaysOnTop.v1`.
- Animation-synchronized audio MVP:
  - Terminal keyboard typing loop plays with the placed Terminal monitor's real coding/thinking animation and no longer starts during the walk-to-Terminal `actionIntent` phase.
  - Coffee Machine brew audio loops while manual or autonomous brewing is actively animating.
  - Fridge feed interactions play distinct open and close one-shot sounds matched to the open/hold/close door animation.
  - Agent complete rewards play a short success one-shot once per de-duplicated complete reward event.
  - Cola interactions play the can-opening sound after fridge open timing when applicable, followed by a short drink sound. Coffee, Bento, and Cookie interactions play their selected action one-shots and stop longer food/drink clips when the action exits.
  - Game Console play audio uses a six-track CC0 random pool and starts when the manual or autonomous Game Console play animation is active.
  - Game Console audio is governed by the global SFX volume plus an independent Game Console volume persisted under `aivatar.gameConsoleVolume.v1`, defaulting to `50%` to preserve the previous effective loudness.
  - Record Player BGM supports a small track list: the programmatic Web Audio `Pixel Parlor` loop and bundled audio tracks `Bach BWV 577`, `Bach Invention 4`, `NES Bach BWV 565`, `C64 Bach BWV 871`, `NES Chopin Op. 25 No. 2`, `Synth Chopin Fantaisie-Impromptu`, and `Cyberpunk Moonlight`. Playback follows the independent `activeRecordPlayerId` state, so it can continue after the avatar starts the Record Player and leaves to do other activities. It is governed by the separate BGM volume plus per-track volume scaling, can be stopped through a queued Record Player interaction from the right-click menu, and can be autonomously stopped by the avatar after it has played for a while.
- Record Player MVP:
  - Buyable shop item priced at `2400 bits`, valid on floor or furniture tops.
  - Right-click `Play music` follows the unified arrive-then-interact flow, then releases the avatar back to `idle` while the chosen Record Player remains active.
  - Right-clicking the Record Player exposes in-context BGM track selection, BGM volume, and a `Stop music` button when that specific Record Player is playing. `Stop music` queues the same arrive-then-interact flow and only turns BGM off after the avatar reaches the active Record Player. Right-clicking a Game Console exposes the independent Game Console volume control.
  - Autonomous `music` behavior is weighted by personality traits and can be disabled with `Auto music`.
  - When the avatar autonomously starts Record Player music, it selects a track itself and prefers a different track from the current selection. Manual menu selection still preserves user control.
  - Active music slows natural Mood decay to `35%` of the ordinary rate rather than periodically restoring Mood.
  - Autonomous music start records compact memory/growth feedback for creativity, warmth, and low-mood resilience only once at startup; manual Record Player playback does not add personality points.
  - After at least 45 seconds of playback, the avatar can autonomously queue a BGM stop on a 60-second check with an 8% chance per check, as long as no high-priority agent state, blocking interaction, or Task Cabinet visual flow is active.
- Bedroom, office, kitchen zones.
- Config-driven furniture.
- Content tagging and placement metadata:
  - `tags` identify furniture, items, hangings, consumables, windows, room surfaces, computer, coffee machine, table coffee storage, and related roles.
  - `placementSurfaces` identifies valid surfaces such as `floor`, `furnitureTop`, and `wall`.
  - Items can be valid on both floor and furniture tops; furniture is floor-only.
- Configurable wall/floor surfaces:
  - Honey Plank uses the accepted honey wood plank matrix sprite; Dark Plank remains a palette/procedural wood floor.
  - Checker Tile Floor with a clean black/white tiled matrix sprite, grout seams, beveled tile highlights, and only sparse scuffs rather than heavy cracks.
  - Polished Cement Floor with a seamless one-piece smooth cement matrix sprite, low-contrast clouding, sparse pores, and soft gloss highlights, with no floor seams.
  - Industrial Metal Floor with shaded metal plates, rivets, glossy plate highlights, and a top-to-bottom light-to-dark gradient.
  - Gray Tech Floor with a smooth matte gray composite surface, low-contrast texture, offset horizontal/vertical blue LED strips, four uneven floor regions, and a glow layer ordered above semi-transparent shadows but below furniture/avatar silhouettes.
  - Tatami Mat Floor with a matrix sprite using woven straw texture, softened straw shadow lines, and green binding.
  - Hermes Green Latex Wall, Honey Panel, and Dark Panel wall palettes.
  - Purple Bubble Wallpaper with larger, rounder bubble motifs and purple textured wall paint.
  - Pink Sakura Wallpaper with a pink base, denser stable pseudo-random blossoms, petals, and buds.
  - Warm Ivory Wallpaper with off-white paper texture, soft seams, and subtle fiber marks.
  - White Tech Wallpaper with white/ice-blue paneling, circuit traces, glowing nodes, small light bars, and a lower technical base strip.
  - Wall/floor surfaces are managed in the right-side Decor panel rather than as backpack placement items.
- Configurable windows:
  - Cozy Window.
  - City Night Window with a dynamic pixel city skyline: smooth day/dusk/night/dawn sky colors, moving sun/moon, drifting clouds, building occlusion, warm evening lights, sparse deep-night lights, daylight window panes, and dusk/night red aircraft warning beacons.
  - Ocean Window with a wide sea view: real-time sky/ocean color changes, softened horizon, sunrise/sunset glow, moon at night, drifting clouds, breathing sparkle/reflection bands that follow the sun/moon, and three depth-scaled slow ships: modern cargo ship, cruise ship, and distant cargo ship. Ship lights appear at night/deep dusk.
  - Cyberpunk City Window with an Ocean-sized silver rounded frame, distant high-rise skyline, real-time morning/day/dusk/night building materials, dense nighttime orange lights, left-to-right clouds, seven smooth flying-car traffic lanes, and an animated vertical neon billboard.
  - Windows can be bought, applied, selected, moved on the wall, sold for half price, and saved.
- Current initial default room layout:
  - Uses City Night Window.
  - Bed, desk, fridge, and dining table are moved into the latest saved cozy layout.
  - Built-in Terminal is the locked placed item `builtin-terminal` on the desk.
  - Desk Lamp is placed on the desk by default.
  - Old saves with legacy `computer` furniture placement are migrated into the placed Terminal model.
- Customizable pixel avatar with behavior-specific expressions and four-direction facing:
  - Front, back, left, and right views.
  - Movement updates facing direction.
  - Rest/relax interactions settle to front-facing behavior.
  - Work interactions can face the computer/desk and show a keyboard-tapping animation.
- Current selectable avatar appearances are `octopus`, `demo-spark`, `mood-slime`, `cute-crayfish`, `cute-ghost`, and `cute-penguin`. New appearances should keep behavior compatibility with `AvatarRuntime` unless a future feature explicitly introduces appearance-specific behavior rules.
- Consumable-specific poses are implemented for Coffee, Cola, Bento, and Cookie through shared pose helpers; new appearances should adapt those helpers where needed without changing the underlying behavior names.
- Autonomous avatar behavior, including sleep, wander, relax, snack, admire decor, brew Coffee, paint, explore, phone, interact, and play games. Healthy idle choices now use layered weighted random selection rather than absolute threshold checks.
- Sleep now restores energy continuously while sleeping and returns the runtime avatar behavior to idle/calm when sleep finishes.
- Autonomous sleep also restores energy after the avatar reaches the bed sleep target, not only when sleep was started by clicking the bed.
- Agent status driven behavior:
  - `thinking` now sends the avatar to the desk/Terminal area for focused thought instead of random wandering.
  - `thinking` is protected from busy recovery overrides, so the avatar keeps its thinking behavior even when low stats would otherwise send it to snacks or play.
  - `executing`/coding targets the placed Terminal, sends the avatar to the Terminal-facing side of the desk/table, and faces the avatar toward the screen.
  - Busy low-energy behavior can route the avatar to the dining table for coffee or drink recovery if available.
  - Busy low-hunger behavior can route the avatar to food recovery.
  - Busy low-mood behavior can route the avatar to Game Console play recovery when available; mood recovery ticks while the avatar is actively playing near the placed console, even if exact recalculated standpoints differ slightly.
  - Busy recovery never sends the avatar to sleep; if no recovery item/activity is available, the avatar keeps working and gradually darkens as stats drop.
- Inventory and consumable effects.
- Consumables include Coffee, Bento, Cookie, Repair Kit, and Cola.
  - Coffee triggers a cup-and-steam sip pose.
  - Cola triggers a red-can-and-straw drinking pose.
  - Bento triggers a lunch-box eating pose with food pixels and a small chewing motion.
  - Cookie triggers a small bitten-cookie eating pose with chocolate-chip pixels, crumbs, and a small chewing motion. The hand-held Cookie was visually tuned down to about one quarter of the original Cookie pose area so it reads as a snack rather than an oversized prop.
  - Automatic `snack` behavior chooses between Bento and Cookie using memory/growth traits and item affinity: creativity/curiosity lean Cookie, resilience/focus/efficiency lean Bento, and explicit backpack clicks still keep the selected food.
- Table coffee storage:
  - The dining table stores coffee separately from inventory through `furnitureStorage`.
  - Table coffee capacity is visible and item-driven: each placed Coffee Cup on the dining table contributes one storage slot.
  - A filled Coffee Cup renders as a transparent glass cup with visible coffee volume, liquid surface, and slow dynamic rising steam; an empty Coffee Cup renders as pale transparent glass with an empty interior.
  - New/no-save sessions place one Coffee Cup on the dining table by default, so table storage starts as a visible `0/1` capacity.
  - Coffee Machine production fills table Coffee Cup storage first, then falls back to inventory capacity if all placed cups are full.
  - Table interactions consume stored table coffee before inventory consumables unless a backpack click explicitly selected a non-Coffee food such as Bento or Cookie.
- Local shop and virtual `bits` economy.
- Categorized shop tabs:
  - 家具
  - Furniture Skins
  - 窗户
  - [OBSOLETE] 墙纸
  - [OBSOLETE] 地板
  - 道具物品
  - 挂饰
- Utility items:
  - Coffee Cup shop item.
  - Buy and place Coffee Cup on furniture tops; cups on the dining table determine table coffee capacity.
  - Coffee Machine shop item.
  - Buy, place, and use Coffee Machine.
  - Coffee Machine can generate Coffee manually or via autonomous behavior, one cup at a time, after the avatar reaches the placed machine. Autonomous brewing clears stale targets after completion/blocked attempts and waits through a short cooldown before another autonomous brew can start.
  - Brewing Coffee costs `1 bit`; if the wallet has insufficient bits, no Coffee is produced and the UI shows a bits warning.
  - Coffee generation persists through localStorage save state through table coffee storage and inventory fallback.
  - Coffee Machine art has been redesigned as a black/gray pixel appliance with screen, buttons, side tank, portafilter-style handle, cup, tray, and brewing animation for lights, coffee stream, cup fill, and steam.
  - File Cabinet shop item.
  - File Cabinet unlocks at Growth level 25, costs bits, and is unique: the shop hides it while one exists in inventory or in the room.
  - Placing File Cabinet records ownership in save `placedItems`, but runtime content converts it into base furniture so collision, movement, click hit testing, and avatar layer occlusion match other furniture.
  - Selling or deleting the placed File Cabinet removes the saved placement and makes it available in the shop again.
- Furniture Skin shop category:
  - Implemented skins currently cover the base bed, desk, dining table, and fridge. Bed skins: Industrial Bed Skin, Wood Red Bed Skin, Ivory Pink Plaid Bed Skin, Modern Minimal Bed Skin, and Space White Deep Gray Bed Skin. Desk skins: Industrial Desk Skin, Rococo Ivory Desk Skin, and Transparent Acrylic Desk Skin. Table skins: Rococo Ivory Table Skin, Dark Oak Table Skin, and White Tech Table Skin. Fridge skins: Ivory Fridge Skin, Red Retro Fridge Skin, and White Tech Fridge Skin.
  - Red Retro Fridge Skin is a visual-only cherry-red rounded retro fridge pass with a matching rounded shop thumbnail, left-side chrome handles, a fitted top cover/clutter silhouette, and matching red animated door panel colors.
  - Modern Minimal Bed Skin was tuned from an imagegen reference into programmatic Canvas drawing. It keeps the original bed perspective and interaction geometry, but visually removes the old posts/footboard, uses a clean wood headboard, wider aligned bedding, a long muted-sage blanket, a thin white mattress front edge with the blanket dark edge aligned across it, two outward 2px blanket-colored side strips that stop at the wood tray edge, a thin wood tray edge, and visible slim legs.
  - Space White Deep Gray Bed Skin reuses the Modern Minimal Bed Skin low-platform structure while swapping in a space-white headboard/platform, pale cold-gray trim, a deep-space-gray blanket, and subtle gray blanket highlights. It shares the same sleep blanket overlay path and keeps bed collision, placement, pathfinding, sleep target, and interaction geometry unchanged.
  - Space White Deep Gray Bed Skin was preview-QAed on `http://127.0.0.1:1427/` after purchase/apply; the final pass removed the earlier blue blanket accent pixels, leaving a plain deep-gray blanket with gray highlights.
  - Transparent Acrylic Desk Skin is a visual-only desk pass that references Industrial Desk Skin's black metal legs, tabletop-over-leg occlusion, and sleeping black-cat silhouette while replacing the desktop with translucent ice-blue acrylic and white/cyan refraction highlights. It keeps desk placement, collision, pathfinding, and interaction geometry unchanged.
  - Transparent Acrylic Desk Skin was preview-QAed on `http://127.0.0.1:1427/` by buying/applying it from the Furniture Skins shop; the desk rendered with the expected translucent ice-blue acrylic tabletop, black industrial legs, tabletop-over-leg occlusion, and desk shadow/black-cat silhouette.
  - White Tech Table Skin is a visual-only white/ice-gray futuristic dining-table pass with cyan circuit traces/nodes, dark slim legs, and matching shop thumbnail. It keeps dining-table placement, collision, coffee storage, table Coffee Cup layering, and interaction geometry unchanged.
  - White Tech Table Skin was preview-QAed on `http://127.0.0.1:1427/` by buying/applying it from the Furniture Skins shop; the table rendered with the expected white tabletop, cyan detail, dark legs, and Coffee Cup layering.
  - White Tech Fridge Skin is a visual-only white/ice-gray futuristic fridge pass with cyan LED seams/nodes, dark touch-grip strips, an embedded glowing control display, circuit/data-line details, top/bottom cyan light bars, cool white handles, and white modular top clutter. It keeps fridge placement, collision, interaction geometry, and door open/hold/close animation unchanged.
  - White Tech Fridge Skin was preview-QAed on `http://127.0.0.1:1427/` by buying/applying it from the Furniture Skins shop; the fridge rendered with the expected white/ice-gray body, cyan LED details, dark smart-control panel, and modular top clutter.
  - Furniture skin ownership uses `purchasedItemIds`.
  - Active furniture skin selection uses `activeFurnitureSkinIds`.
  - Applied furniture skins can be cleared from the Furniture Skins shop. The clear action removes only the active furniture-to-skin mapping and does not refund or remove the purchased skin.
  - Skins are visual-only for now and do not change placement, pathfinding, collision, or interaction geometry.
- Decor panel:
  - Lists wall and floor surface options separately from the backpack.
  - Surface options can be bought, applied, and cleared back to the configured default surface.
  - Purchased surface state uses `purchasedItemIds`; active overrides are saved as `wallSurfaceId` and `floorSurfaceId`.
  - Surface items are filtered out of the regular backpack even if older test saves previously stored them in inventory.
  - Includes Exposed Red Brick Wallpaper as a buyable wall surface with gray mortar, small offset red bricks, per-brick texture speckles/scars, and a lower baseboard overlay that sits visually on top of the brick wall.
  - Includes White Tech Wallpaper as a buyable wall surface with a white futuristic panel/circuit motif, matching Decor thumbnail, Traditional/Simplified Chinese names, and `mood +5` / `energy +2` effect metadata.
- Desktop/floor items:
  - Terminal Monitor exists as an item definition for the built-in Terminal but is no longer sold in the shop.
  - Desk Lamp, Tiny Plant, Coffee Cup, Switch-style Game Console, Coffee Machine, File Cabinet, Cozy Rug, Morph Blob Rug, and Blue Persian Rug are tagged as items.
  - Items can be placed on furniture tops or on the floor when their `placementSurfaces` allow it.
  - Floor rugs use a dedicated underlay render layer below all furniture, ordinary placed items, and the avatar.
  - Cozy Rug is now a doubled-size rainbow striped rug with woven fringe/texture, a light edge instead of a black outline, and a small soft shadow.
  - Blue Persian Rug is a floor-only underlay rug, wider than the desk, with a compressed rectangular room-view shape, centered symmetric blue/white Persian motifs, and `tags: ["item", "rug"]` so it can be bought repeatedly like other rugs.
- Wall hangings:
  - Poster, Sky Sentinel Poster, and Digital Wall Clock are wall-only Hangings shop items.
  - Sky Sentinel Poster is an original superhero-inspired poster based on an `imagegen` reference, then translated into Canvas pixel art. It has a blue/gold sky, city skyline, original caped hero, robot dog detail, and right-drifting cape kept inside the poster frame.
  - Digital Wall Clock displays the local system time in `HH:MM` on the room canvas.
- Built-in Terminal:
  - Stored as locked placed item `builtin-terminal` with `itemId: "terminal-monitor"`.
  - Can be selected and moved in Room Edit Mode.
  - Cannot be stored, sold, or deleted.
  - Uses desk/table surface placement and follows its surface via offsets.
  - Clicking it no longer grants bits or work boost directly.
  - Displays animated screen and keyboard during coding/thinking proximity.
- Work boost is no longer awarded by clicking Terminal directly.
- `complete` rewards with optional boost bonus only when a Codex session transitions from an active state into `complete`, or when a fresh active/connected Codex complete event arrives before the UI saw the previous active state; repeated reads of the same complete event do not reward again.
- Codex `complete` rewards can use token usage from `status.usage`. Cached input tokens count at 10% weight, uncached input/output/reasoning tokens count fully, token-derived rewards cap at 40 bits before boost, and missing usage falls back to the fixed 4-bit base.
- Agent Sessions is a collapsible side-panel menu. Collapsed state shows live/total sessions and Current/source context; expanded state shows Follow/Clear/Disconnect controls, CLI hints, session cards, context window meters, reward summaries, and status chips.
- The Agent Sessions collapsed entry includes a mini current-session context progress bar when context usage is available, so context pressure is visible without opening the session list.
- Agent Sessions cards show model context window usage when available, such as `198K / 258K context`, and token reward context when reward usage is present, such as `542K tokens -> 40 bits cap (58K weighted)`.
- Agent Sessions includes `Clear Stale`, which removes stale bridge session rows without clearing the current followed/active session.
- Whole side-panel collapse:
  - The right-side menu can collapse into the room through a slim pixel-style triangle handle on the room's right edge.
  - Expanded state points left to indicate collapse; collapsed state points right to indicate expansion.
  - Collapsing resizes the desktop window to the room width instead of expanding the room to fill the old window.
  - The room scene width is locked during resize, the collapsed layout stays left-aligned, and a Rust Tauri command updates min size and size together to reduce flicker.
  - Collapsed side-panel mode keeps a compact current-session context meter visible in the room overlay near the lower-left corner.
- Local save state in browser localStorage.
  - Save state now includes `avatarRuntime`, `wallSurfaceId`, and `floorSurfaceId` so the current avatar position/behavior and active room surfaces survive app close/reopen.
  - Tauri desktop close requests trigger a frontend save flush through `aivatar://save-before-close` before the window closes.
- Saved default layout:
  - `Save layout` stores the current room layout in `aivatar.defaultLayout.v1`.
  - New/no-save sessions use the configured default layout.
  - Existing `layoutVersion: 2` saves restore the user's last saved layout on restart.
  - Older missing-version saves migrate once to the current default layout while preserving non-layout save data.
  - Existing saves missing `furnitureStorage` are normalized with a dining-table coffee store, but visible capacity depends on Coffee Cups currently placed on the table.
- Runtime content config loading.
- World interaction flow:
  - Furniture, placed items, and backpack consumables that trigger avatar actions queue a world interaction.
  - Avatar must walk to the relevant furniture or placed-item interaction target before sleep/feed/work/brew/play/consumable effects trigger.
  - Bed starts sleep and restores energy over time only after arrival.
  - Fridge consumes food or drink from inventory only after arrival.
  - Table consumes stored table coffee first for automatic/default recovery, then falls back to inventory food/drink; explicit backpack food choices keep the selected item.
  - Backpack consumables route the avatar to an appropriate table/fridge target before inventory is consumed and stats/memory are updated.
  - Coffee Machine right-click context actions and autonomous brew behavior wait for the avatar to reach the placed machine before spending bits, producing Coffee, or playing the brew animation.
  - Game Console right-click context actions and autonomous play recovery wait for the avatar to reach the placed console before mood recovery or console play-screen animation starts.
  - Room Edit, placement, wall/floor Decor application, and window application are still immediate UI operations and do not require avatar travel.
  - Fridge interactions show a short open-door animation with a cold interior and food pixels.
  - Terminal selection/coding preview does not grant bits directly.
  - Built-in Terminal right-click context actions queue a placed-item `interact` action and enter `coding` only after arrival, so desk/table-hosted item interactions use the same reachable-standpoint approach as other queued placed-item interactions.
  - Desk is ordinary furniture interaction and no longer triggers coding/work reward.
  - Click hit testing follows visual furniture bounds rather than only config rectangles.
  - Placed items and base furniture have click priority over active windows, preventing large windows from stealing clicks from desk objects.
  - Non-high-priority Codex states do not override an in-progress furniture interaction.
  - Short feedback interactions such as feed, work, brew, and reward now expire after their intended duration or a default short timeout so they do not permanently block later behavior.
  - Reward bubbles stay visible for 10 seconds and then automatically disappear.
  - Timed feedback bubbles with `endsAt` are cleaned up regardless of interaction kind, so reward and rest feedback cannot stick indefinitely.
  - Interaction thought bubbles show short current-intent text such as `Going...`, `Need rest`, `Coffee first`, `Fuel time`, `Sip first`, `No snacks`, and `Brewing`.
- Furniture collision:
  - Desk, fridge, table, and runtime File Cabinet have collision boxes interpreted as ground-projection footprints rather than full visual bounds.
  - Avatar movement uses a foot-center point against inflated furniture/item collision footprints, with narrow ignore exceptions reserved for true target-furniture cases such as bed sleep.
  - Lightweight nav-grid A* routing helps the avatar move around desk/table/fridge/file-cabinet obstacles. If a route is blocked, the avatar pauses, replans, and only changes interaction points when the current point cannot be connected.
  - Selected furniture shows its collision footprint as a red translucent rectangle, making collision tuning easier during manual visual QA.
- Redesigned Stardew-inspired vertical bed:
  - Bed is viewed from foot toward head, with narrow warm wood frame, soft pillows, blue star blanket, blanket texture, foot details, and plush toy.
  - Sleeping avatar uses the real avatar position near the pillow and appears tucked under the blanket via render overlay.
  - Bed sheet fill has been expanded to avoid gaps between pillows and blanket.
  - Bed no longer has a collision volume.
  - Bed placement uses bed-foot/leg bounds, allowing the headboard to overlap the wall while the feet remain on the floor.
- Redesigned retro drawer desk:
  - Desk has a thick wood desktop, inset dark writing pad, left/right drawer stacks, center drawer, brass handles, small feet, and desk-leg placement rules. The default desk body now comes from the `CLASSIC_DESK_SPRITE_*` matrix in `src/game/deskSprites.ts`, with the accepted reference compressed into the `108 x 84` runtime envelope while preserving the original room's roughly equal desk-top/front vertical balance.
  - Desk placement uses feet/legs rather than the whole visual body, allowing the desktop to overlap the wall while the legs remain on the floor.
- Retro CRT computer:
  - Terminal is rendered as a `42 x 50` palette-plus-row matrix placed item. The default A version is a beige CRT-style monitor with blue screen and keyboard; Green Amber, White Cyan, and Neon Dark skins swap the matrix while preserving the same envelope.
  - During coding/thinking proximity, the Terminal screen, cursor, scanline, status lights, and keyboard animate, and the avatar performs a tapping motion. Animation overlays are skin-palette aware and should not be baked into the static matrix rows.
  - The built-in Terminal is independently movable in Room Edit Mode, can be placed on desk/table surfaces, and can receive visual-only skins through the Furniture Skins shop while remaining locked against storing, selling, or deletion.
- Redesigned dining table:
  - Table is rendered as a wide reflective metal dining table close to desk width.
  - The tabletop has increased visual depth with thin metal edge highlights and subtle brushed reflections.
  - Table placement uses foot/leg bounds so the tabletop can overlap the wall while the legs remain on the floor.
  - Desktop items can be placed on either the desk or the dining table.
- Redesigned retro fridge:
  - Fridge is rendered as a green two-door retro appliance with dark outlines, deeper top clutter, handle details, scuffs/stickers, and feet.
  - Fridge can be moved against the wall using foot-based placement, allowing the body/top objects to overlap the wall while the base remains on the floor.
  - Feed interactions with the fridge animate the door opening, holding open, then closing, and reveal a cold interior with shelves and food pixels.
  - Feed interactions also play separate fridge door open/close audio cues; the open cue has been trimmed to avoid lagging behind the first door-opening frames.
- Avatar head bubbles and simple progress bars for visible feedback.
- Debug is a collapsible side-panel menu for local status override, live mode, save reset, endpoint display, boost status, trait training, and visual QA controls.
  - Desktop builds include a Start bridge button backed by the Tauri `start_status_bridge` command.
  - Also displays table coffee storage as `current/capacity`.
  - Includes an Add supplies test button that grants bits, Coffee, Bento, Cookie, Cola, and fills table coffee for recovery testing.
- Custom avatar name saved in localStorage.
- Placeable decor/furniture system:
  - Buy items from shop.
  - Click decor/furniture inventory items to enter placement mode.
  - File Cabinet is a unique buyable furniture item unlocked at Growth level 25. It is stored in save state as a placed item for economy/ownership, then converted into runtime furniture after placement so it behaves like base furniture.
  - Place floor items on valid floor tiles.
  - [OBSOLETE] Place desktop items, currently Terminal Monitor, on the desk or dining table.
  - Save placed items in localStorage.
- Room Edit Mode:
  - Click built-in furniture to select it.
  - Move built-in furniture to a new floor position.
  - Save moved built-in furniture in localStorage.
  - Moved furniture affects rendering, clicking, collision, and interaction targets.
  - Click placed items to select them.
  - Move placed items to a new floor tile.
  - Store placed items back into inventory.
  - Sell the placed File Cabinet from the furniture edit panel; this refunds half price and makes the cabinet buyable again.
  - Click active windows to select them.
  - Move active windows to a new wall position.
  - Sell selected active windows for half price; the app falls back to another available window if the sold window was active.
  - Save the current layout as the default layout.
- Placeable shop content:
  - Tiny Plant
  - Cozy Rug
  - Morph Blob Rug
  - Desk Lamp
  - Poster
  - Digital Wall Clock
  - Game Console
  - Coffee Machine
  - File Cabinet
  - City Night Window
  - Ocean Window
  - Cyberpunk City Window
  - Cola
- Game Console entertainment behavior:
  - Autonomous `play` targets Game Console when present.
  - Playing games restores mood slowly only while the avatar is near the placed Game Console; the recovery interval is intentionally much slower than early prototypes.
  - Game Console art is now a small Switch-style handheld with blue/red side controls sized for floor/table placement.
  - The Game Console screen animation follows the active placed console target, so autonomous play triggers the console animation after arrival rather than relying only on center-distance proximity.
- Agent session display:
  - The right panel shows Agent Sessions as a collapsible menu. Collapsed state shows live/total sessions and Current/source context; expanded state lists recent bridge sessions with agent name, session id, status, summary, Follow/Clear/Disconnect controls, and Active/Connected/Current/Idle/Stale markers.
  - Sessions with context usage show a context window meter based on `usage.contextTokens / usage.modelContextWindow`.
  - Sessions with reward usage show a compact reward summary using total tokens, weighted tokens, reward bits, and the cap indicator when relevant. Context-only usage does not display as a reward summary.
  - Sessions can be followed or cleared from the app through `/agent-active`.
  - Presence updates through `/agent-presence` keep the selected active session visibly connected even when no new status event has arrived.
  - Stale sessions remain visible for context but no longer drive `currentStatus` or block room interactions.
- WebSocket agent status client with simulated fallback.
- HTTP-to-WebSocket local bridge for generic AI agent status, active session selection, and presence heartbeats.
- Bridge snapshots include `currentStatus`, `sessions[]`, `activeSessionKey`, `connectedSessionKey`, and `currentSessionKey`, preserve optional token `usage`, session `idleBubbleCandidates`, and optional `learning` payloads, and are also fetched over HTTP as a live-mode fallback.
- The bridge also accepts low-sensitivity avatar personality snapshots through `/avatar-state` and writes `%TEMP%\aivatar-avatar-state.json`; this is the current handoff from frontend memory/growth state to background session-learning workers.
- Manual generic agent status sender CLI with legacy Codex command compatibility.
- Manual session-learning worker CLI with `npm.cmd run aivatar:learn`, `aivatar:learn:claude`, `aivatar:learn:codex`, and `aivatar:learn:opencode`. It can smoke-test UI learning with `--provider none`, test Claude Code provider output when Claude is logged in, test Codex structured output with `codex.cmd exec`, or test opencode provider output with `opencode run --format json`.
- Local development Codex plugin at `C:\Users\rniu\plugins\aivatar-session-bridge` can post active status and heartbeat presence for the current Codex Desktop session.
  - Project-level npm wrappers are available as `npm.cmd run aivatar:session:setup`, `npm.cmd run aivatar:connect`, and `npm.cmd run aivatar:disconnect`.
  - `aivatar-connect` now starts both heartbeat presence and the rollout watcher, so ordinary Codex Desktop turns can drive `thinking`, tool `executing`, and final `complete` transitions.
  - The plugin can read Codex Desktop local rollout JSONL token usage for the active session and send usage deltas on `complete`/`error`.
  - The plugin can read `model_context_window` and `last_token_usage.total_tokens` from `token_count` events and stream model context window usage while a turn is in progress.
  - The watcher handles both `function_call`/`function_call_output` and Codex Desktop `custom_tool_call`/`custom_tool_call_output`; tool output returns the avatar to `thinking`/`tool-result` so token-count updates do not keep the avatar stuck in `executing`.
  - The PostToolUse fallback hook sends `thinking`/`tool-result` rather than `executing`, because it fires after a tool completes.
  - Token baseline lifecycle is explicit: `thinking` resets, `executing`/`waiting_for_user` preserve or create, `complete`/`error` calculate and clear, and `idle`/`--clear-active` clear without reward usage.
  - Token baselines have a six-hour default TTL through `AIVATAR_USAGE_BASELINE_TTL_MS`.
- Generic command wrapper for Codex, Claude Code, or any shell command.
  - The wrapper auto-generates session ids when one is not provided.
- Short-lived status bubbles:
  - Terminal bubble shows Codex-session notifications only, excluding `thinking`.
  - Avatar thinking bubble uses a rounded rectangle, supports two lines, and has priority during `thinking`.
  - Session bubbles wrap text using measured canvas pixel width to keep long session messages inside their frames.
  - ASCII status and session-bubble text is rendered with a tiny pixel-font helper so scaled canvas text stays sharper than browser-antialiased `fillText`.
  - High-priority status bubbles stay visible while the status remains active; non-priority bubbles expire after roughly 6 seconds.
  - Interaction thought bubbles are shown over the avatar for furniture/item interactions and recovery actions.
  - Trait-specific thought bubbles now give the avatar different short reactions for thinking, error, success, and autonomous activities depending on the dominant growth trait.
  - Idle/autonomous behavior can show occasional stable-random ambient bubbles, separate from live agent `thinking` bubbles.
- Memory & Growth v1:
  - Save state now includes lightweight `memory` with recent events, growth stats, preferences, and milestones.
  - Recent memory is intentionally compact and local-only; it records summarized events rather than full chat content.
  - Codex `complete` awards XP and trait changes based on weighted token usage, previous error/waiting state, and reward context.
  - Codex `error` and `waiting_for_user` are recorded once per status event and update resilience/focus.
  - Life events such as sleeping, playing games, painting at the Oil Easel, using Coffee/Cola/Bento/Cookie, brewing Coffee, and buying items add compact memory entries and small trait/preference changes.
  - Painting at the Oil Easel records compact recovery memory, restores mood slowly, adds `creativity +1` on the throttled memory tick, and advances a per-save-slot painting draft generated from recent memory events plus saved idle bubbles. Each draft uses a 3-hour cumulative painting target; older active drafts are normalized to that target when loaded. Completing the draft records a `painting_complete` memory event and adds the finished work to the save-slot gallery with a quality-based sale value; selling it later records `painting_sold` and grants the bits. Autonomous Record Player startup records music preference/trait feedback once, while ongoing BGM now slows Mood decay instead of producing periodic recovery ticks.
  - Growth traits are `focus`, `resilience`, `curiosity`, `efficiency`, `creativity`, and `warmth`.
  - Traits lightly affect autonomous behavior choices, visual themes, bubbles, dominant-trait micro-expressions, and busy-recovery thresholds. Raw trait points are long-running counters; UI presentation uses normalized values rather than treating raw points as percentages.
  - Dominant-trait micro-expressions are visual-only Canvas overlays in `src/game/renderScene.ts`: Focus scan glints, Resilience fist pumps, Curiosity question pixels, Efficiency check marks, Creativity sparkles, and Warmth blush/heart pixels. They read the current dominant Growth trait and do not modify memory, rewards, pathing, or save state. `cute-crayfish` is the current exception for Efficiency: its generic body check marks are suppressed, and the effect appears as a small keyboard-side control device during `coding`/`thinking`.
  - The side panel shows a compact collapsible Growth entry with level and XP progress. Expanding it reveals a six-sided personality hex chart, recent memory, idle bubble language preference, saved idle bubbles, and mixed memory/session suggestions. Hovering each small hex node on the chart shows the trait name and raw point count in the chart center.
  - Idle bubble suggestions combine memory-derived and session-derived candidates. Memory-derived suggestions use traits, recent life/task events, and favorite recovery/activity signals; session-derived suggestions come from the watcher template pipeline.
  - Debug is also a compact collapsible side-panel entry. Expanding it reveals six trait training buttons that add test XP/trait growth and recent memory entries.
  - Debug controls include `Demo actions`, which cycles through all avatar behavior states for visual QA.
- In-app Pixel Asset Editor MVP:
  - The editor component remains in the repo, but the right-side `Asset Studio` entry is currently locked/disabled and marked as in development.
  - Uses a canvas-based pixel editor rather than per-pixel DOM buttons.
  - Supports Pencil, Erase, color picker, preset palette, frame add/copy/delete, Play/Pause animation playback, FPS control, and Save/Clear Frame actions.
  - Supports custom asset canvas sizes from `8..480` wide and `8..320` high.
  - Includes size presets:
    - Avatar S: `48 x 56`.
    - Avatar Act: `64 x 64`.
    - Desktop: `32 x 32`.
    - Furniture: `64 x 64`.
    - Room Ref: `480 x 320`.
  - Saves editor data in browser localStorage key `aivatar.assetEditor.v1`.
  - Includes room-reference preview for the current virtual scene:
    - Scene size: `480 x 320`.
    - Wall area: `x=76, y=20, width=328, height=106`.
    - Floor area: `x=76, y=126, width=328, height=180`.
    - Adjustable asset anchor preview with `X/Y` inputs.
- Pixel asset data types exist in `src/types.ts`:
  - `PixelCell`.
  - `PixelAssetFrame`.
  - `PixelAsset`.

## Known Constraints / Notes

- The app is early MVP code; keep changes small and behavior-focused.
- Avoid over-abstracting until there are at least two real content packs or more complex interactions.
- Tauri desktop builds attempt to auto-start the bridge and Codex session discovery; web-only previews still need `npm.cmd run status:bridge` or another manually started bridge process, plus `npm.cmd run status:discover` when automatic Codex Desktop session discovery is desired.
- The current pixel art is still programmatic, but has received a first-pass unified pixel style, octopus avatar polish, and initial `demo-spark`, `mood-slime`, `cute-crayfish`, `cute-ghost`, `cute-penguin`, and development-only `wave-lizard` appearance passes. It is not final spritesheet/atlas art.
- The Pixel Asset Editor is currently an authoring MVP only and its UI entry is locked/disabled. The component can draw, preview, animate, and save draft pixel assets locally, but edited assets are not yet used by `renderScene.ts` to replace avatar or furniture rendering.
- Pixel Asset Editor drafts are localStorage-origin scoped under `aivatar.assetEditor.v1`, just like other browser-local development state.
- The current virtual scene size is `480 x 320`; editor room-reference overlays use the same coordinate system as Canvas hit testing and placement.
- Recent furniture and placed item art is a mix of programmatic canvas drawing and code-embedded matrix sprites. The bed, desk, placed Terminal, dining table, fridge, and File Cabinet have been iterated toward a cozy retro/Stardew-like style; desk, table, fridge, Terminal, floor/wall surfaces, and File Cabinet art now use palette/row matrix sprites where noted.
- The File Cabinet is now config/shop content and is buyable at Growth level 25. It is unique, sellable, and removable; while inventory/save ownership is represented through `placedItems`, the runtime room converts a placed cabinet into `room.furniture` so it uses the same rendering, click hit testing, movement, collision, and avatar occlusion logic as base furniture.
- Task Cabinet is now a real local MVP rather than debug-only. It maintains a local task list of `.md` paths in `localStorage` key `aivatar.taskCabinet.v1`, reads source `.md` files only through the Tauri task-launch command, and never writes back to the original `.md` files.
- Task Cabinet automation launches Codex, Claude Code, or opencode through the same connected wrapper used by the CLI Launcher, with the task prompt passed through a derived `%TEMP%\aivatar-task-prompts\*.md` file and `--prompt-file`. The wrapper passes prompts in each CLI's expected form: Codex receives a prompt argument, Claude Code receives `-- <prompt>`, and opencode receives `--prompt <prompt>`. Status still depends on each external CLI's event source and bridge/wrapper session updates, but the app now ignores startup/presence idle placeholders, remembers same-session terminal status, and preserves `complete`/`error` through late Claude `Notification`, `SessionEnd`, statusLine, or disconnect cleanup events.
- Task Cabinet launch now has a visual file workflow: the avatar fetches a paper from the File Cabinet, carries it to the Terminal, and reads/executes there. The flow intentionally masks high-priority agent status during the brief fetch/carry/read handoff and lets very fast tasks finish visually before releasing back to ordinary status-driven behavior.
- File Cabinet visible papers now reflect real Task Cabinet state through the `src/game/fileCabinetSprites.ts` state sprites: `Ready + Failed` tasks appear in the cabinet, failed papers show a red `X`, running tasks are visually treated as taken out, and completed tasks disappear. Removing a task from Aivatar removes it only from localStorage and never deletes the source `.md`.
- Development saves remain browser-origin scoped. Save-slot registries and per-slot saves from `http://127.0.0.1:1420/` do not automatically migrate to `http://localhost:1420/`.
- UI theme preference is also browser-origin scoped under `aivatar.uiTheme.v1`. Fresh origins default to the Terminal skin, including the startup save-slot menu, then reuse any saved Classic/Terminal/Amber/Arcade Cabinet/Starship choice. A Classic/Terminal/Amber/Arcade Cabinet/Starship skin choice made at `http://127.0.0.1:1421/` will not automatically apply to `http://localhost:1420/`. Classic now has explicit Windows 98-style coverage for the app shell, cards, Settings sound controls, range sliders, checkboxes, Decor thumbnails, scene context menus, and canvas bubbles. Terminal and Amber also cover Task Cabinet cards, schedules, buttons, paths, status text, and other nested panels where needed. Arcade Cabinet has been browser-verified on `http://127.0.0.1:1428/` for both the main room UI and startup save-slot menu after `npm run build` passed; its current canvas path also receives Arcade-specific scene/bubble colors and a restored scene-panel top bright strip. Starship is wired as a selector-based CSS/canvas theme and still needs browser screenshot QA after the first implementation. The skin system is still selector-based rather than token-driven.
- The Settings card is a flex child in the right side panel. Keep `.settings-card` from being compressed by the side-panel layout, and constrain `.settings-submenu` children so expanded controls do not overflow the panel boundary.
- Runtime save state can preserve old inventory/stats even after config changes. For testing fresh config in the current multi-slot system, clear `aivatar.saveSlots.v1`, `aivatar.activeSaveSlot.v1`, and any `aivatar.saveSlot.v1.<slotId>` keys for the current browser origin; clear legacy `aivatar.save.v1` too if testing first-run migration behavior.
- Runtime save state includes `layoutVersion`, `avatarId`, `roomId`, `avatarAppearanceId`, `avatarName`, `avatarRuntime`, `memory`, `navMemory`, `petStats`, `inventory`, `placedItems`, `wallet`, `purchasedItemIds`, `activeFurnitureSkinIds`, `furnitureStorage`, `workBoostUntil`, `activeWindowId`, `wallSurfaceId`, `floorSurfaceId`, `windowPlacements`, and `furniturePlacements`. `avatarId` and `roomId` are generated for new saves and normalized into older saves; `avatarAppearanceId` is selected during save creation from the visible create-save list (`octopus`, `demo-spark`, `mood-slime`, `cute-crayfish`, `cute-ghost`, or `cute-penguin`) and normalized against all registered appearances, including development-only `wave-lizard`, defaulting to `octopus` for unsupported older saves; `avatarName` can be set from the startup create-save form and still falls back to the content default when blank; `memory`, Growth fields, and `navMemory` are per-slot character state and must not be shared globally; `navMemory` and `activeFurnitureSkinIds` are normalized for older saves. File Cabinet ownership/placement is saved in `placedItems`, then converted into runtime furniture during content assembly.
- Startup local save import is read-only toward the selected source file/folder: the app copies the parsed save into the active slot storage and does not write changes back to the imported path. Removing a startup save slot removes the slot association from Aivatar's local menu, not the original imported file or folder.
- Default new saves start with too few bits to buy most furniture skins. Use an existing save with enough bits or Debug/Add supplies before testing the purchase and apply flow.
- Shop bulk-purchase QA should use a low-cost repeatable item such as Cookie or Coffee before testing expensive furniture. Ordinary rapid clicks should leave the app responsive, while long press should buy at most 10 units and never exceed the wallet's affordable quantity.
- Memory/Growth v1 stores local lightweight state and still does not store full chat transcripts or use a vector database. It can now consume optional session-learning payloads produced by `scripts/aivatar-learning-worker.mjs`, which may call Codex or Claude Code on a sanitized digest and then stores only bounded summaries, candidate bubbles, XP, and trait deltas.
- Navigation-learning v1 is local and lightweight: idle exploration and ordinary movement write visited cells, learned `walkableCells`, successes, failures, and latest exploration time into `navMemory`. `walkableCells` stores `0` for learned walkable and `1` for learned blocked/risky cells, scoped by `layoutFingerprint`. Ordinary A* avoids cells marked `1`; `explore` can ignore learned blocked values to retest cells after layout changes or previous false negatives. Older `trickySpots` remain in the save schema for compatibility but no longer drive route-cost penalties.
- Session-derived idle bubble suggestions are generated by local rules from Codex watcher user/final-agent messages and by session-learning workers from sanitized transcript digests. The Codex watcher currently uses a bilingual theme/template approach, including a `daily` life category, so suggestions feel more like pet thoughts than transcript snippets. Claude Code and native Codex discovery learning digests include low-sensitivity `user:` / `assistant:` snippets and can produce topic-aware heuristic bubbles when the LLM provider is unavailable. Suggestions are not automatically used: users must add them in the Growth panel, and saved phrase slots are capped by avatar level.
- LLM-derived idle bubble suggestions are generated from sanitized session-learning digests. They are displayed in Growth with an `LLM` badge/highlight when `learning.source === "llm"`. Non-LLM session candidates display source badges (`CC` for Claude Code, `Codex` for Codex). Chinese digests are instructed to produce natural Simplified Chinese candidates; heuristic fallback can also generate topic-aware Chinese candidates for Chinese sessions. LLM and heuristic learning candidates are normalized into one complete short sentence, with natural emoji or tiny decorative symbols allowed; existing saved phrases remain plain strings and are not rewritten retroactively. If LLM candidates do not appear, first check whether the provider is logged in/available and whether the bridge snapshot contains `learning.source`.
- LLM and heuristic learning bubbles are now trait-aware when `%TEMP%\aivatar-avatar-state.json` is fresh. Dominant and secondary traits guide voice without exposing trait names or point totals in the bubble text. If trait-aware tone does not appear, first check that the desktop app has posted `/avatar-state`, the bridge is the updated process, and the worker was launched with the current avatar state file.
- Growth also generates memory-derived idle bubble suggestions locally from current traits, recent memory events, and favorite recovery/activity preferences. The Growth panel aims for 3 memory-derived and 3 session-derived visible candidates, with fallback fill if one source has too few candidates.
- The idle bubble suggestion and session-learning pipelines require the updated bridge and watcher/hook processes to be running. Existing old `scripts/codex-status-bridge.mjs`, `aivatar-watch.mjs`, or Claude hook processes may drop or omit `idleBubbleCandidates` or `learning` until the bridge is restarted, the desktop app is restarted, and connected sessions are relaunched.
- Session/discovery fixes from the June 4, 2026 merge regression require both `status:bridge` and `status:discover` to be restarted. A stale already-running bridge/discovery pair can continue showing old behavior even after code has been patched.
- Growth traits affect visuals, dominant-trait micro-expressions, and small behavior probabilities, but they are not yet a full personality/strategy engine. The Growth hex chart is a normalized `log10(points + 1)` visualization of raw trait points capped at `1_000_000`; it should not be treated as the underlying trait storage.
- Wall/floor surface shop entries are Decor panel options, not backpack items. Older test saves may still contain surface ids in `inventory`; the UI filters those entries out while preserving `purchasedItemIds` so they remain available in the Decor panel.
- Window shop entries are also not backpack items. Their purchase state is stored in `purchasedItemIds`, active selection is stored in `activeWindowId`, and per-window placement is stored in `windowPlacements`. Selling a selected window removes its purchased state and placement and falls back to another available window.
- `aivatar.defaultLayout.v1` stores the default layout used for new/no-save sessions and Room Edit `Reset default`.
- Existing saves with `layoutVersion: 2` restore the user's last saved layout on restart. Missing-version saves migrate once to the current default layout while preserving non-layout data.
- Store in Room Edit Mode returns an item to inventory but does not refund bits.
- Placement/editing MVP now has visual-bound hit testing, ground-projection-based bed/desk/table/fridge/file-cabinet placement, floor-item overlap checks based on ground projections, item placement on floor, wall, or desk/table surfaces, locked built-in Terminal placed item migration, basic furniture collision and movement, buyable File Cabinet runtime furniture conversion, File Cabinet footprint-based placement overlap, and special rug-underlay overlap behavior. It still needs stronger snapping, placement previews, and special-case QA across all non-rug room objects.
- Desktop/floor item placement includes placeable items. The built-in Terminal has been migrated to `placedItems`, but save migration still preserves legacy `computer` furniture placement when encountered.
- Fridge body art and furniture skins are now code-embedded palette/row matrix sprites in `src/game/fridgeSprites.ts`; the open/hold/close door behavior is still a programmatic canvas overlay that clips/reuses the current skin's upper-door sprite pixels rather than a separate atlas animation.
- Floor surface sprites in `src/game/floorSurfaceSprites.ts` are code-embedded palette/row matrices, not external spritesheet/atlas assets. Current matrix floor surfaces are Honey Plank, Checker Tile Floor, Polished Cement Floor, Industrial Metal Floor, Gray Tech Floor, and Tatami Mat Floor; they keep the same Decor surface ids, pricing, save-state fields, and floor interaction behavior as the content definitions.
- Digital Wall Clock, Sky Sentinel Poster, transparent glass Coffee Cup with slow animated steam, Cozy Rug, Morph Blob Rug, Blue Persian Rug, Switch-style Game Console, Coffee Machine, Oil Easel, dynamic City Night Window, Ocean Window, Cyberpunk City Window, and recent coffee-machine/easel art are still programmatic canvas assets rather than spritesheet/atlas assets. Purple Bubble Wallpaper, Exposed Red Brick Wallpaper, Pink Sakura Wallpaper, Warm Ivory Wallpaper, White Tech Wallpaper, Industrial Metal Floor, Gray Tech Floor, fridge body/skin art, and File Cabinet state art are now code-embedded palette/row matrix sprites rather than broad rectangle drawing.
- Coffee, Cola, Bento, Cookie, paint, phone idle, and task-file fetch/carry/read poses are still programmatic canvas overlays rather than spritesheet/atlas animations. The phone pose uses a thinner handset; front-facing avatar poses show the phone back toward the viewer, while side-facing poses show the glowing screen. The Task Cabinet fetch/carry/read workflow still needs visual QA for path smoothness, timing, occlusion near the File Cabinet and Terminal, and behavior when a task completes before the avatar reaches the Terminal.
- Shop and inventory item thumbnails now prefer the `public/icons/item-icons-arcade-a.png` `16 x 16` sprite for mapped item ids, while Terminal skin thumbnails use `public/icons/terminal-skin-icons.png` with three dedicated `16 x 16` cells. Unmapped items and Decor wall/floor surface thumbnails remain lightweight CSS/DOM previews. These UI affordances can still drift from canvas art until the asset pipeline is unified; current item buttons align the thumbnail and quantity/price to opposite sides.
- The UI skins are currently CSS/canvas theme layers rather than a full design-token system. New UI components need explicit Classic/Terminal/Amber/Arcade Cabinet/Starship theme QA so Classic Windows 98 controls, Terminal/Amber colors, Arcade cabinet/CRT framing, Starship console framing, the Arcade and Starship scene-panel top strips, expanded panels, custom progress bars, disabled states, Decor thumbnails, checkboxes, range sliders, Room Visit toast/dialog/list controls, and canvas overlays/bubbles stay coherent.
- ASCII text inside status/session bubbles uses a pixel-font renderer with matching measurement/draw widths to reduce overflow. CJK fallback now prioritizes Noto Sans TC/SC/HK for clearer Chinese bubble text, but arbitrary non-ASCII text is still rendered inside the low-resolution canvas and can look softer than DOM text when scaled.
- Side-panel collapse/expand depends on Tauri desktop window resizing in the desktop app. Web-only previews keep the React layout behavior but cannot resize the native window or apply the native always-on-top setting.
- The side-panel collapse flow preserves the room's left edge and locks the scene panel width while resizing. In collapsed mode, top-left stats, top-right growth summary, and bottom context HUD overlays stay borderless over the room. If future flicker returns, inspect native window position/size behavior before adding more CSS animation.
- Existing saves may preserve older furniture positions, purchased state, inventory, or placed File Cabinet state after config or art changes; clear the current origin's save-slot registry/per-slot keys for a fully fresh layout and Growth/shop test. Also clear legacy `aivatar.save.v1` when testing first-run migration from the old single-save key.
- Existing saves may also preserve furniture skin purchase/application state. If a furniture skin does not appear, verify that the active preview port points to the intended worktree and that the save at that origin has purchased and applied the skin. If the default furniture should be restored, clear the applied skin from the Furniture Skins shop rather than editing save data manually.
- Game Console mood recovery is intentionally slow, does not produce bits, and now ticks while the avatar is actively playing near the placed Game Console using a near-active-play-target check rather than relying only on recalculated exact standpoints. Game Console play-screen animation uses the same targeted/near-active logic so autonomous play visually activates the correct console.
- Oil Easel painting mood recovery is also intentionally slow and runs as a longer autonomous activity rather than a quick mood refill. Separate from recovery ticks, cumulative Oil Easel painting now completes generated gallery artworks; the finished painting only awards quality-based random bits after the user sells it from the gallery.
- Oil Easel is categorized in the Furniture shop tab through `tags: ["furniture", "easel"]`, but remains `kind: "decor"` so it uses placed-item rendering/placement rather than File Cabinet's runtime-furniture conversion path.
- Oil Easel currently has visual/click/placement bounds, participates in floor-item ground-projection placement overlap checks, and contributes its foot-level projection to navigation collision. Broader placed-item collision is still intentionally narrow; other placed objects such as rugs, tabletop items, and wall hangings remain non-blocking unless future behavior needs them.
  - Coffee Machine brewing is now a small economy sink: manual and autonomous brewing each cost `1 bit` and only complete after the avatar reaches the placed Coffee Machine; broader bits balancing is deferred until closer to 1.0. Autonomous brewing is intentionally cooldown-gated so repeated brew animations do not dominate idle life.
- Bed collision was intentionally removed so the avatar can move naturally around the wall-aligned bed.
- High-priority agent states still block right-click context-menu interaction actions: `thinking`, `executing`, `waiting_for_user`, and `error`. Left-click selection remains available for inspection/editing.
- `thinking` intentionally does not trigger busy recovery, so focused thought remains visually clear even when stats are low. Busy recovery still applies to other high-priority states when resources are available.
- High-priority stale sessions stop blocking interactions after the configured bridge stale timeout.
- A connected stale active session can remain visibly linked in the Agent Sessions panel, but stale statuses do not keep driving `currentStatus` merely because presence remains fresh.
- Complete rewards apply to connected reward-eligible agents in `src/agentRegistry.ts` (`codex`, `claude-code`, and `opencode`) when they transition from an active state into `complete`, or when a fresh active/connected `complete` snapshot is first observed.
- Token usage rewards and context window meters work for Codex sessions that can be matched to local Codex rollout JSONL files, including the Codex Desktop session plugin path and the desktop CLI Launcher connected path after it discovers the real Codex rollout session id.
- Claude Code launcher sessions now use temporary hook/statusLine settings for fine-grained status and context usage. Hook events use exec-form Node commands and statusLine uses a PowerShell wrapper to avoid Windows Git Bash hangs. Basic Task Cabinet hello-world prompt/status flow has been validated, including preserving `complete` through `SessionEnd`; this is still newer than the Codex rollout watcher and needs real-CLI regression testing across tool calls, permission prompts, Stop/StopFailure, `/clear`, `/resume`, app restart, and `--bare`/user-provided `--settings` paths.
- Claude Code session-learning currently works end-to-end through hook-triggered learning payloads, with heuristic fallback verified when `claude --print` reports `Not logged in`. To use true Claude LLM learning and show `LLM` badges for Claude-derived bubbles, the Claude CLI must be logged in for the environment running the worker.
- Codex token usage and context window usage are read from local Codex rollout JSONL files using the current session id. This is a local development integration and should not be assumed stable across all Codex versions or platforms without verification.
- Token reward baselines are stored outside the repo. The session plugin stores them under the Codex home temp area by default; the repo-local CLI connector defaults to `%TEMP%\aivatar-usage-baselines.json` to avoid `.codex\tmp` write-permission issues when launched from restricted contexts. Baselines are cleared by `complete`, `error`, `idle`, or `--clear-active`, and expire after the configured TTL.
- Test sessions such as usage smoke tests live in the bridge's in-memory sessions map. Restarting the bridge clears them, and the Agent Sessions panel can manually ask the bridge to clear expired/stale entries through `Clear Stale`.
- Busy recovery depends on available inventory, table coffee storage, or placed entertainment; without recovery resources the avatar remains busy and visually depletes rather than sleeping. Recovery effects still require arrival at the chosen table/fridge/placed item target.
- Avatar movement uses a lightweight 8px nav-grid A* route toward generated interaction standpoints, with ordinary path selection avoiding `navMemory.walkableCells[key] === 1` and static collision checks as fallback for unknown cells. The planner checks neighbor-to-neighbor collision segments, uses a 4px planning clearance, caches route waypoints, and pauses/replans on blocked or stalled movement. Cached waypoint selection now advances from the nearest path node rather than reusing old behind-avatar nodes.
- Placed-item behavior targets now prefer generated legal interaction standpoints for both tabletop and floor items, with fallback targets clamped into the navigation bounds. This prevents object-near behaviors from setting blue debug targets outside the walkable floor when items sit near room edges.
- Stalled arrival-gated actions now try an alternate legal interaction point first. If the same action continues to stall repeatedly, an action-level failsafe triggers `navigationFailure` after three stalls so the app can clear the pending interaction instead of leaving the avatar in an endless `Planning route` loop.
- `navMemory` is now learned from all real non-idle/non-explore movement, not only explicit `explore`: the app records traversed cells as `walkableCells[key] = 0`, stuck/failure cells as `walkableCells[key] = 1`, and successful arrivals for ordinary movement, pending world interactions, snack targets, and autonomous brewing. Per-cell legacy counters are capped at `9999`, and ordinary movement recording is throttled to reduce `localStorage` churn.
- `navMemory.layoutFingerprint` invalidates learned `walkableCells` when blocking furniture/item layout changes, so old learned blocked cells do not keep steering the avatar after room edits. Future work should still consider local/partial grid recomputation and stronger debug tools for viewing learned values.
- Remaining movement QA risks include autonomous target instance randomness when multiple copies of the same interactive item exist, module-level navigation caches that are only partially scoped by target/furniture ignore state, false-positive learned blocked cells from temporary stalls, and narrow furniture corridors that need visual QA with the `Nav grid` overlay. Recent tuning expanded the navigation floor lower bound to include the bottom floor strip and reduced common close interaction standpoints to about `7px`, but dense table/desk/Coffee Machine layouts still need visual regression checks.
- Terminal/desktop placed-item interaction near the desk has been tightened: desktop-item interactions rely on reachable generated standpoints rather than route-wide host collision ignores, and Terminal now has one centered front standpoint. Post-arrival stability and dense desk/table layouts should still be watched in visual QA.
- The Agent Sessions panel displays recent sessions but the room still has one avatar driven by `currentStatus`.
- `Demo actions` is a Debug-only visual QA helper. It cycles runtime avatar behaviors and displays demo bubbles, but it does not represent real agent status or grant rewards. If a Debug status override is active, use the highlighted `Live` button to return the avatar to real bridge status.
- The `phone` behavior is intentionally not an agent status and should not trigger bridge sends, memory rewards, task summaries, or status replies. It is only an idle-life animation.
- Interactive Codex/Claude/opencode TUI automatic waiting detection is still limited to available event sources. Codex Desktop uses rollout watching; launcher-started Claude Code uses hook/statusLine injection with exec-form hooks, a PowerShell statusLine wrapper, and transcript usage fallback; opencode uses the installable plugin event adapter. The generic bridge still supports external status posts for smoke tests and older clients.
- Current Codex Desktop conversations can be discovered automatically by Aivatar when the desktop app or `status:discover` is running. The local Aivatar session plugin remains useful for explicitly following/activating a specific session, reconnecting a session, or manual recovery. Explicit status posts remain useful for smoke tests and older clients. For command lifecycle tracking, use `codex:run`, `claude:run`, `opencode:run`, or `agent:run`; for smoother launcher/CLI flow, use the desktop CLI Launcher, `codex:connected`, `claude:connected`, or `opencode:connected`.
- Discovery can still reconnect any rollout touched within the active window, which defaults to `AIVATAR_SESSION_STALE_MS` (5 hours). If old sessions unexpectedly reappear, check whether `status:discover` is running, whether `AIVATAR_DISCOVERY_ACTIVE_MS` has been overridden, and whether helper records under `%TEMP%\aivatar-session-discovery\helpers` are restarting old heartbeat/watch processes.
- Current discovery freshness still uses rollout file `mtime`. If an older rollout file is touched recently, discovery can treat it as active even when its last real event is older. Future hardening should parse the latest rollout event timestamp and prefer that over filesystem `mtime`.
- Disconnect safety now covers three sources: manual plugin pid files under `%TEMP%\aivatar-session-bridge`, repo-local CLI pid files under `%TEMP%\aivatar-cli-session`, and auto-discovery helper pid files under `%TEMP%\aivatar-session-discovery\helpers`.
- Chat/session safety depends on keeping the Aivatar integration read-oriented toward Codex data. Scripts may read rollout JSONL, inspect `thread/list`, and clear Aivatar bridge state, but should not remove or rewrite Codex session files or Desktop chat metadata.
- If Codex chats appear to disappear, preserve the current `%TEMP%` Aivatar recovery logs, check whether old `aivatar-connect`/watcher/heartbeat processes are still running, verify which plugin command directory is first on PATH, and confirm whether the action used `codex resume <session-id>` or explicit `--new-session`.
- If automatic Codex session discovery does not show a session, check `%TEMP%\aivatar-session-discovery\discovery.json`, `%TEMP%\aivatar-session-discovery\helpers\*.json`, whether `CODEX_HOME\sessions` contains a recent rollout JSONL with `session_meta`, whether the external plugin path exists, and whether the bridge is reachable on `127.0.0.1:38988`.
- If a desktop CLI Launcher Codex session does not stream real-time updates, first check whether a new rollout JSONL was created under `.codex\sessions` and whether `aivatar-connected-run.mjs` switched from the provisional session to that real Codex session id.
- If a Launcher-started session remains connected after the CLI window is closed, check `%TEMP%\aivatar-cli-session\*.json` and the recorded heartbeat/watcher/watchdog pids before changing bridge priority logic.
- Current git state may show the whole repository as untracked in this workspace, so `git diff`/`git diff --stat` can be empty even after file edits. Use targeted file reads or `rg` to verify edits when needed.
- If a browser preview or desktop window does not show recent worktree changes, check which checkout owns the port. In the current workflow, the OneDrive checkout may own `localhost:1420`, while the Codex worktree preview usually runs at `http://127.0.0.1:1421/` or the next free strict port such as `1422`. Restart or reload the desktop window after CSS/UI changes, and avoid confusing the OneDrive checkout with a still-running worktree preview.
- If in-app Browser visual QA cannot attach to a local preview, keep the limitation explicit: `npm.cmd run build` plus an HTTP 200/root check verifies build and serving, but it is not a substitute for screenshot-level Canvas QA.
- If newly added files under `public/audio/` return Vite's HTML fallback instead of audio bytes, restart the relevant Vite/Tauri dev process. Existing running `Audio` objects may also keep old decoded assets until the desktop window is reloaded or restarted.
- Save state is written on every confirmed state change and flushed on page hide/unload and Tauri close. In-progress placement or movement previews are UI-only and are not saved until the item, furniture, or window move is confirmed.
- The local Aivatar session plugin currently lives under `C:\Users\rniu\plugins\aivatar-session-bridge` rather than inside this repo. The repo now documents and wraps the plugin workflow; future work should decide whether to vendor the plugin source.
- The current session plugin connection uses explicit connect/disconnect, presence-only heartbeat, and the rollout watcher for real-time Codex Desktop turn tracking.
- Multiple worktree sessions can stay connected simultaneously. If one session stops showing context, first check whether its watcher is still running, whether the rollout JSONL contains `token_count` events, and whether the bridge preserved the last `usage` payload after final status updates.
- `furnitureStorage` currently only implements dining-table coffee storage; its capacity is derived from Coffee Cups placed on the dining table.
- Project is under OneDrive; Rust builds should use `$env:CARGO_TARGET_DIR = "$env:TEMP\aivatar-cargo-target"` to avoid target directory write issues.
- Avoid `cmd.exe` `set CARGO_TARGET_DIR=... && ...` with a trailing space before `&&`; it can create a bad path such as `aivatar-cargo-target `.
- `src-tauri/icons/icon.ico` is now the configured Tauri bundle icon, generated from the simplified high-contrast pixel octopus source in `src-tauri/icons/icon.png` with explicit Windows shell sizes from `16px` through `256px`.
- Screenshots named `aivatar-screenshot*.png` are ignored by git.

## Collaboration / File Safety

The user has requested strict file safety:

- Read/search freely.
- Do not modify existing files without clearly describing planned edits when the user has not already requested implementation.
- Creating new files is allowed when requested.
- Do not delete files or folders without explicit confirmation.
- Do not bulk delete.
- Treat raw/original/source data as read-only.

For this project, prefer:

- Focused patches.
- `apply_patch` for manual edits.
- `rg` for search.
- `npm.cmd run build` and `cargo check` after code changes.
- Runtime screenshots after meaningful UI changes.

## Art Design Workflow

For Aivatar visual design work, prefer this workflow by default:

1. Use `imagegen` to generate visual reference images or concept previews for pixel-room assets, furniture skins, wallpapers, floors, windows, avatar poses, room themes, and content-pack ideas.
2. Translate selected references into an implementation plan that fits the current runtime rendering model, usually Canvas drawing code in `src/game/renderScene.ts` or content/config changes rather than directly dropping generated images into the app.
3. Implement the approved Canvas/content changes only after following the file-safety approval workflow for existing files.
4. Verify the result in the running web/Tauri preview with screenshots or visual QA, checking pixel clarity, scale, layering, occlusion, animation states, interaction targets, and responsive layout.

Until the Asset Studio and spritesheet/content-pack pipeline are fully unlocked, treat generated images primarily as references for programmatic Canvas rendering. Once that pipeline is stable, generated images can also guide or produce spritesheet/atlas assets for import.

Pixel-grid asset replication workflow:

- When the user wants an accepted reference replicated rather than loosely redrawn, treat the reference as the visual source of truth.
- First determine the runtime logical pixel envelope from the existing renderer or selection bounds, for example Coffee Machine `58 x 63`, instead of using the generated image's native resolution.
- Crop the reference to the object, resize/quantize it into the exact logical grid, and inspect a nearest-neighbor zoom preview before coding.
- Translate the grid into a palette plus fixed row matrix in `src/game/renderScene.ts` or a dedicated `src/game/*Sprites.ts` file, then render contiguous same-color runs with `drawPixelRect` or an existing row-matrix helper such as `drawTableSprite`. Use `.` or an equivalent token for transparent pixels.
- Shared row-matrix renderers may cache static matrices into offscreen canvases for runtime performance; keep the palette/row matrix as the canonical source and treat the cache as a rendering optimization only.
- Do not manually approximate the reference with broad rectangle drawing when the requested result is pixel-by-pixel replication.
- Keep the static pixel matrix as the canonical base sprite. Add interaction animation as small overlays on semantic zones such as lights, screens, coffee streams, steam, moving beans, or status indicators, so animation does not distort the base art.
- Preserve existing selection bounds, placement footprint, collision, and interaction standpoints unless the user explicitly approves a geometry change.
- Verify by checking the matrix dimensions, running `git diff --check`, running the build when code changes, and inspecting a running preview screenshot at room scale against the reference.

Floor surface matrix asset notes:

- Full-room floor sprites use a fixed logical matrix size of `328 x 174` and are drawn at `76,132` inside the floor border `70,128,340,184`.
- `FLOOR_SURFACE_SPRITE_DATA` is checked at the top of `drawFloor`; if a surface id exists there, the matrix sprite wins over the older procedural floor branch.
- For floor upgrades, create or approve a complete `328 x 174` floor reference first, plus a nearest-neighbor zoom preview and room-context preview. Do not stretch a small texture patch over the whole floor; plank, tile, straw, or slab scale must be drawn for the room size.
- Convert the accepted reference into a palette plus fixed row matrix in `src/game/floorSurfaceSprites.ts`. Avoid `.` as a color token because the shared matrix renderer treats it as transparent.
- Validate each floor sprite by checking `174` rows, `328` characters per row, palette-token coverage, decoded sprite pixel match against the quantized reference, `git diff --check`, and `npm run build`.
- Floor sprite upgrades should stay visual-only unless explicitly approved: do not change Decor item ids, prices, purchased-state behavior, save-state fields, collision, placement, pathfinding, or interaction targets.

Dining-table matrix asset notes:

- The current default dining table and its three skins use a `102 x 68` logical matrix with sprite origin `item.x - 4`, `item.y - 5`, matching the current selected visual bounds.
- Preserve the original runtime table shadow as a separate layer before drawing any table sprite: `item.x + 5`, `item.y + 10`, `item.width`, `50`, `rgba(21, 19, 33, 0.9)`.
- Table skin matrices should not bake in a central under-table shadow from generated references. Keep tabletop, apron, legs, and feet in the matrix, but leave the central under-table shadow transparent so the shared original shadow remains visible.
- Future table skin upgrades must remain visual-only unless explicitly approved: do not change dining-table collision, coffee storage, interaction standpoints, selection bounds, shop ownership, or save-state behavior.
- If a table skin appears unchanged in the browser preview after a matrix edit, first verify the active preview port/worktree and hard refresh or restart the `1427` Vite server before treating it as an art-code failure.

Desk matrix asset notes:

- Current desk matrix sprites use a `108 x 84` logical envelope with sprite origin `item.x - 7`, `item.y - 7`, matching the accepted room-scale visual bounds for the default, industrial, and transparent acrylic desk passes.
- Keep the desk-top/top-plane area and the front/leg area close to a `42px / 42px` vertical split. This preserves the original room proportion and avoids generated references that make the desktop too shallow or the legs too tall.
- Desk skins should remain visual-only unless explicitly approved: do not change desk placement, collision, pathfinding, interaction standpoints, shop ownership, save-state behavior, Terminal routing, or tabletop item placement.
- Runtime desk overlays are separate from the static matrix: preserve the sleeping black-cat silhouette/brief eyes animation and the under-desk shadow behavior in `renderScene.ts` rather than baking them into the matrix rows.
- `industrial-desk-skin` and `transparent-acrylic-desk-skin` share the same base structure and leg envelope, but transparent acrylic needs a distinct layering pass. The acrylic tabletop must be genuinely semi-transparent, not just a pale opaque blue fill.
- For transparent acrylic desk revisions, the tabletop support frame sits directly under the acrylic tabletop: the back support follows the top green guide position, and the left/right side supports also stay at the green guide positions near the outer side edges.
- The red guide positions are rear legs, not side supports. Rear legs must be the same visual thickness as the front legs and align vertically with the lower exposed rear-leg columns.
- The transparent acrylic desk uses a much lighter under-desk shadow than the industrial desk so the support frame, rear legs, floor, and black-cat silhouette remain readable through the clear tabletop.
- If a transparent acrylic desk change looks wrong in the browser, first check whether the issue is sprite matrix opacity, acrylic-specific support/leg overlays in `renderScene.ts`, or the shared runtime shadow/cat overlay before repainting the whole desk.

Terminal monitor matrix asset notes:

- Current Terminal monitor matrix sprites use a `42 x 50` logical envelope with sprite origin `item.x - 21`, `item.y - 35`, matching the taller accepted room-scale visual bounds for the default A pass and B/C/D skins.
- Default and skin matrices live in `src/game/terminalSprites.ts`. `TERMINAL_MONITOR_SPRITE_DATA` is the default beige/blue A terminal; `TERMINAL_MONITOR_SKIN_SPRITE_DATA` contains `terminal-green-amber-skin`, `terminal-white-cyan-skin`, and `terminal-neon-dark-skin`.
- Terminal skins are applied through the existing Furniture Skins flow by targeting the locked placed item `builtin-terminal`; the active mapping is still stored in `activeFurnitureSkinIds`.
- Keep Terminal skin upgrades visual-only unless explicitly approved: do not change `terminal-monitor` item id, `builtin-terminal` locked behavior, placement, hit bounds, collision, pathfinding, interaction standpoints, keyboard audio synchronization, right-click interaction flow, or save migration.
- Active coding/thinking animation stays as runtime overlays in `renderScene.ts`. Retune `terminalMonitorAnimationPalette` for each skin when needed, but do not bake cursor/text/scanline/key flashes into the static sprite matrix.
- The Terminal/Codex status bubble is anchored with `TERMINAL_MONITOR_STATUS_BUBBLE_Y_OFFSET = -67`; update this only when the sprite envelope or visible top changes.
- Terminal skin shop thumbnails use `public/icons/terminal-skin-icons.png`, a 3-cell `48 x 16` RGBA spritesheet. Update `TERMINAL_SKIN_THUMBNAIL_INDICES`, `.item-thumbnail-terminal-skin`, and the cache-busting URL if more Terminal skins are added.
- Because the running app loads `/config/aivatar.config.json`, Terminal skin item definitions and shop entries must be present in both `public/config/aivatar.config.json` and `src/data/defaultContent.ts`.

Room perspective / asset drawing rules:

- The room uses a front-facing cutaway 2.5D dollhouse perspective, not strict isometric projection and not full one-point perspective.
- The back wall is a flat frontal plane for windows, posters, wall clocks, wallpaper, and other wall-mounted items.
- The floor is a frontal lower rectangle; depth is expressed through item foot placement, ground projections, shadows, occlusion, and visual-depth / y-order layering.
- Furniture should read as mostly front-facing pixel art with limited top and side thickness: use tabletop/top-plane strips, side shading, base shadows, feet, drawer lips, and occluding edges to imply volume.
- Do not draw future room assets as 45-degree isometric objects or with strong converging perspective unless the whole room perspective is deliberately redesigned.
- Keep runtime geometry aligned with the visual style: collision, placement, interaction standpoints, and selected ground-projection rectangles should continue to represent the object's floor contact area rather than its full visual bounds.

## Merge / Worktree Safety

To reduce semantic regressions from parallel worktrees:

- Keep changes to central lifecycle files small and isolated. In this project, `scripts/codex-status-bridge.mjs`, `scripts/codex-session-discovery.mjs`, `scripts/aivatar-connected-run.mjs`, `src/App.tsx`, and `AGENTS.md` are high-conflict files.
- Before starting or finishing work in a worktree, update from `main` with `git fetch` plus either `git merge main` or `git rebase main`, depending on the branch workflow.
- For this worktree, default GitHub pushes should go to `https://github.com/ruiwuniu/Aivatar-Demo.git` `main` (remote `origin`). When the current branch is not `main`, push the intended reviewed commit with an explicit refspec such as `git push origin HEAD:main` rather than pushing the current branch by default.
- When a merge conflict touches bridge/discovery/session files, resolve text conflicts and then do a semantic checklist:
  - New or changed endpoints appear in `/health`.
  - Session keys are normalized consistently.
  - Disconnect covers manual plugin pid files, repo-local CLI pid files, and auto-discovery helper pid files.
  - Bridge restart preserves expected persisted state such as disconnect tombstones.
  - Discovery does not resurrect a just-disconnected session.
  - Stale/active-window defaults match across bridge, discovery, frontend fallback constants, and documentation.
- After changing bridge/discovery code, restart both `status:bridge` and `status:discover`; already-running Node processes do not hot-reload patched files.
- Prefer adding focused smoke tests for lifecycle behavior after merge-prone changes: post presence, disconnect, post presence again, restart bridge, post presence again, and verify the session does not reappear while tombstoned.
- Avoid mixing unrelated lifecycle changes with learning/UI/documentation edits in the same commit when possible. If a merge combines those areas, explicitly re-check cross-feature behavior rather than relying only on build success.

## Recommended Next Steps

1. Continue regression-testing Codex chat/session safety with `codex resume <session-id>`, explicit `--new-session`, automatic discovery, the desktop CLI Launcher, disconnect cleanup, 5-hour expiry behavior, stale-process cleanup, PATH/plugin shadowing checks, recovery-log inspection, and bridge/discovery restart behavior after code changes.
2. Harden automatic Codex Desktop session discovery by replacing rollout `mtime` freshness with parsed latest-event timestamps, then validate that only genuinely recent/active sessions remain connected and stale helper heartbeat/watch processes are stopped and tombstoned. Also validate the real-time rollout watcher over ordinary chat turns, especially multiple projects/worktrees, app restart, already-running bridge, repeated `final_answer` events, token-based rewards, context-window updates, and the session-inspired idle bubble candidate flow.
3. Add focused tests or smoke scripts for session discovery regressions: 5-hour default active window, explicit `AIVATAR_DISCOVERY_ACTIVE_MS` override, disconnect tombstone persistence across bridge restart, discovery helper cleanup calling `/agent-sessions/disconnect`, and stale helper pid records not resurrecting old sessions.
4. After the watcher and session-safety flow prove stable, decide whether to vendor `C:\Users\rniu\plugins\aivatar-session-bridge` into this repo now that the workflow is documented and wrapped by npm scripts.
5. Validate and polish the desktop CLI Launcher connected path over real Codex and Claude Code CLI turns, including provisional-to-real Codex session switching, Claude exec-form hook events, Claude PowerShell statusLine wrapper behavior, watchdog cleanup when users close terminal windows, repeated launcher starts, stale pid cleanup, token/context usage, reward baselines, automatic `AIVATAR_LEARNING_*` environment injection, session-learning worker startup, and Agent Sessions display behavior.
6. Continue expanding and QA'ing the furniture skin system, especially File Cabinet skins and regression coverage for existing bed, desk, table, fridge, and built-in Terminal skins. Keep skins visual-only unless a future skin explicitly changes dimensions/collision. Space White Deep Gray Bed Skin, White Tech Table Skin, Transparent Acrylic Desk Skin, White Tech Fridge Skin, and the three Terminal skins have each had at least one browser-preview purchase/apply pass on `http://127.0.0.1:1427/`; continue broader regression checks for shop category visibility, purchased/apply/clear states, `activeFurnitureSkinIds` save/load in save slots/imports, default furniture fallback, all existing bed/desk/table/fridge/Terminal skins, Terminal coding/thinking animation palette overlays, sleep blanket overlays, avatar layering, table Coffee Cup layering, fridge door animation, desk/Gray Tech Floor glow masking, `item-icons-arcade-a.png` thumbnails, and `terminal-skin-icons.png` thumbnails.
7. Visually QA the recent Ocean Window, Cyberpunk City Window, White Tech Wallpaper, Gray Tech Floor, Growth, dominant-trait micro-expressions, Oil Easel, Record Player, Cookie, Blue Persian Rug, Sky Sentinel Poster, Settings card, themed scene context menus, Exposed Red Brick Wallpaper, bed layering, table collision, exploration-learning changes, and desktop icon clarity in the running app: Ocean Window slow subpixel ship movement, distant ship scale, night ship lights, breathing wave sparkles, softened horizon, Cyberpunk City Window fixed-time preview states, night light density, building structure variation, silver rounded frame, neon billboard animation, cloud looping, seven-lane doubled-speed traffic, smooth non-worming flying-car motion, White Tech Wallpaper panel/circuit readability, Gray Tech Floor matte composite texture/offset blue LED four-region split/glow layer above semi-transparent shadows and below avatar, desk, black-cat, and desk-skin silhouettes/Decor thumbnail/purchase/apply/clear state, Chinese labels, Coffee Cup slow steam, Cookie eating pose quarter-size readability, Cookie shop/inventory thumbnail readability, trait-driven Bento/Cookie snack choice, Growth hex chart hover/log-scale normalization behavior, Growth Chinese localization in the collapsed HUD and expanded panel, all six dominant-trait micro-expressions across front/side/back-facing avatar states, Oil Easel scale/perspective, avatar beret/brush/palette paint pose, easel foot-collision avoidance, Record Player flattened pixel record placement, tonearm alignment, symmetric base/feet/shadow, playback notes/highlights, Record Player shop/inventory thumbnail readability, Settings card compact/expanded layout, BGM helper note, compact BGM select typography, theme-adaptive volume icon, Game Console volume slider placement, Record Player right-click menu theme coverage, Blue Persian Rug symmetry/detail density/underlay layering/repeatable shop purchase state, Sky Sentinel Poster frame containment/cape direction/robot dog readability/wall placement, red brick wall scale/mortar/baseboard texture, bed body/footboard occlusion regression including Coffee Machine or Oil Easel placed near the bed footboard, dedicated `admire` pose readability, and idle `explore` route collection.
8. Add focused UI/runtime tests or screenshot/audio regression checks for sleep recovery, token-based complete rewards, complete success one-shot de-duplication, context window meters, Memory/Growth updates, `session_learning` memory events, LLM-highlighted idle bubble candidates, LLM/heuristic complete-sentence bubble normalization without punctuation, `CC`/`Codex` source-badged idle bubble candidates, Chinese/English learning candidate language filtering, heuristic fallback transcript parsing, `phase: "session-learning"` not granting duplicate rewards, `navMemory` save/load normalization, Growth hex chart `log10(points + 1)` normalization, hover labels, and Chinese `growth.*` localization, whole-side-panel collapse/expand and Tauri window resize behavior, collapsed HUD overlay positioning, Agent Sessions mini context meter, Settings/Growth/Agent Sessions/Debug submenu collapse/expand behavior, Terminal and Amber skin coverage across collapsed/expanded cards, scene context menus, and canvas bubbles, Chinese DOM typography fallback, Chinese canvas bubble clarity, compact card title/helper-text sizing, expand-button alignment, stats-grid placement above Growth, SFX volume persistence, Game Console volume persistence and right-click control, BGM track persistence, BGM helper placement, new BGM asset loading, BGM volume persistence, startup chime preference, first-interaction audio unlock, Auto music preference, Terminal keyboard audio synchronization after arrival, Coffee Machine brew-loop synchronization, Record Player BGM synchronization after arrival, Record Player manual/autonomous music playback, avatar autonomous BGM track selection, manual music not granting personality points, autonomous music granting personality points only at startup, active BGM slowing Mood decay without periodic Mood recovery, Record Player right-click BGM track/volume/stop controls, manual and autonomous `stop-music` arrival-before-stop behavior, autonomous 60-second BGM stop checks, multiple Record Players only animating the active playback target, fridge door open/close one-shot timing, Cola can-open/drink sequencing after fridge open, Coffee and food long-clip stop-on-action-end behavior, Cookie pose sizing/readability, trait-driven Bento/Cookie snack selection, Game Console random audio synchronization for manual and autonomous play, idle bubble language filtering, memory/session suggestion balance, accepted phrase display, trait-driven avatar visuals, dominant-trait micro-expressions across all six Growth traits, the `Demo actions` behavior cycle, placement, Room Edit, shop/inventory/Decor/window thumbnails, Record Player thumbnail rendering, item-button thumbnail/number alignment, collision and interaction-point overlays, autonomous activity, idle exploration/music behavior, agent status, work/fridge/table/coffee/cola/bento/cookie/music/paint/phone animation flows, unified arrive-then-interact behavior for furniture/placed items/consumables, autonomous and manual Coffee Machine brew animation, transparent Coffee Cup empty/full rendering, Game Console play-screen animation and mood recovery, Record Player BGM and pixel playback animation, Oil Easel painting and creativity growth, dynamic City Night Window, Ocean Window, and Cyberpunk City Window day/night preview states, Debug fixed Window time controls, Digital Wall Clock rendering, Decor panel collapse/tabs, and rug-underlay layering.
9. Continue hardening avatar pathfinding after the `walkableCells` core pass, especially with the Debug `Nav grid` overlay around bed/desk/fridge/table choke points, learned blocked-cell false positives, exploration retesting, post-arrival desktop-item stability around the Terminal/desk/tabletop Coffee Machine, target-object locking when multiple Coffee Machines/Game Consoles/Oil Easels exist, navigation-cache scoping by layout/target/furniture-ignore fingerprint, and regression cases around dense bed/desk/table/fridge/Coffee Machine/Game Console/Oil Easel layouts. Re-test final-target stall abandonment: stalled arrival-gated actions should try another interaction point, then fail/clear after repeated stalls instead of sliding or planning forever. Re-check the bottom floor strip after the navigation max-Y expansion, Terminal single-front-point behavior, and Coffee Machine front-only tabletop standpoints across multiple table/desk placements.
10. Polish busy recovery UX with clearer recovery-source feedback, no-supply warnings, and balanced depletion/recovery rates.
11. Expand Memory/Growth beyond v1 with richer milestones, preference-driven behavior, memory reset/export controls, better UI explanations for how traits are learned, and user controls for LLM learning scope/provider/fallback behavior.
12. Expand navigation-grid tooling with learned `walkableCells` visualization, manual reset/decay controls, partial recomputation after furniture/item placement changes, and clearer QA diagnostics for why a cell is treated as blocked.
13. Add robust overlap prevention and snapping for non-rug floor items, furniture-top items, wall items, windows, moved base furniture, and the locked built-in Terminal, while preserving intentional underlay rug overlap behavior.
14. Continue Agent Sessions UX polish with filtering, pinning, expiry/stale-clear feedback, context/reward usage explanations, multi-worktree connection diagnostics, and clearer priority controls for `currentStatus`.
15. Continue refining the UI skin system toward reusable theme tokens so future panels inherit Classic Windows 98, Terminal, and Amber colors/controls without one-off selector patches.
16. Finish the unified content model for furniture, items, hangings, consumables, windows, wall surfaces, and floor surfaces.
17. Add a simple layering editor so wall-overlap furniture, desktop objects, non-rug floor items, rugs, avatar occlusion, and open furniture doors can be controlled predictably beyond the current fixed rug-underlay layer.
18. Polish table coffee storage UX, including explicit deposit/withdraw actions, clearer coffee source feedback, better feedback when brewing cannot afford the `1 bit` cost, and clearer guidance that Coffee Cups placed on the dining table define storage capacity.
19. Continue hardening the unified world-interaction flow so future furniture, placed items, and consumables automatically follow the intended sequence: avatar decides an action, walks to the relevant item/furniture, starts the item/avatar animation only after arrival, then applies the effect when the action completes.
20. Improve surface placement rules for desk/table items, including overlap checks and clearer visual previews for valid tabletop positions.
21. Create a small unified furniture/item/consumable interaction animation model instead of handling door/opening/progress/Terminal/Coffee/Cola/Bento/Cookie animation as one-off render conditions.
22. Expand save-state versioning beyond the current layout migration and keep testing the startup save-slot system: legacy `aivatar.save.v1` migration, per-slot persistence, create-save avatar naming, save-card bits display, local JSON/folder import round-trips, Remove/unlink wording and warning behavior, language selector persistence, cross-origin behavior, furniture skin state, and a future explicit save export flow.
23. Add stronger delete/sell/rotation confirmation and polish in Room Edit Mode.
24. Polish the Decor panel with clearer purchased/unpurchased thumbnail states, more wall/floor surface content, and screenshot checks for Purple Bubble Wallpaper, Exposed Red Brick Wallpaper, White Tech Wallpaper, Gray Tech Floor, and Checker Tile Floor.
25. Add a room comfort system where decor, furniture, windows, and floor/wall choices affect mood/energy recovery.
26. Add content-pack manifest support under `public/content-packs/`.
27. Before unlocking Asset Studio, connect Pixel Asset Editor output to runtime rendering for a selected draft asset, starting with preview-only avatar frame replacement.
28. Add import/export for Pixel Asset Editor drafts as JSON and later PNG atlas/spritesheet output.
29. Add an asset library/content-pack layer under `public/content-packs/` so edited avatar animations, decor, furniture, and tools can be packaged.
30. Replace selected programmatic avatar/object art with spritesheet/atlas assets once the editor workflow is stable, starting with consumable action poses and high-value room objects like the Coffee Machine, Morph Blob Rug, Game Console, and Digital Wall Clock.
31. Add automated tests for bridge `usage` payload normalization and token reward formula edge cases, including cached-heavy turns, missing usage, cap behavior, and work boost interaction.
32. Regression-test and polish Codex Desktop and Codex CLI session learning now that rollout digest learning is implemented: verify connected CLI sessions, auto-discovered Desktop sessions, repeated final/final_answer events, provider fallback, Chinese/English chat digests, `%TEMP%\aivatar-learning-context\codex-*.txt` cleanup expectations, `learning.source` display, and trait-aware bubble tone from `%TEMP%\aivatar-avatar-state.json`.
33. Harden the Claude Code hook/statusLine integration until it is comparable to Codex rollout watching: verify real CLI events create `%TEMP%\aivatar-claude-code-events\*.jsonl`, confirm exec-form hooks bypass Git Bash on Windows, confirm the generated PowerShell statusLine wrapper receives stdin and updates context meters, investigate any Claude transcript `hook_cancelled` attachments, confirm terminal `complete` after Stop/statusLine fallback, validate `AIVATAR_LEARNING_PROVIDER=claude-code` with a logged-in Claude Code account plus fallback behavior when not logged in, and decide whether a transcript watcher is still needed for richer final/tool/token details.
34. Design and implement the future embedded terminal path with a real PTY backend and xterm.js-style frontend, so Aivatar can launch and display Codex/Claude sessions in-app rather than opening an external PowerShell window.
35. Revisit the full bits economy before 1.0, including Codex reward pacing, shop prices, recurring sinks, debug-only rewards, and Coffee brewing costs.
36. Consider a DOM overlay bubble renderer if Chinese/Japanese/Korean bubble clarity needs to become fully crisp at all zoom levels.
37. Regression-test Task Cabinet over real Codex and Claude Code task runs, including Chinese/English prompt text, spaces/newlines in `.md` content, failed-session recovery, Rerun, per-task Schedule, Repeat/Once timing, Browse path selection, prompt length limits, status synchronization through Agent Sessions, fast-completing tasks that finish before the avatar reaches the Terminal, late idle/SessionEnd events that should not downgrade completed tasks, and Terminal/Amber task-card skin coverage.
38. Polish Task Cabinet task metadata and UX with title/frontmatter parsing, per-task agent/cwd defaults, clearer schedule diagnostics, task history/export, and safer handling of stale `Running` entries after app restart.
39. Strengthen Task Cabinet execution safety before broad automation: preserve the existing file-safety approval workflow before any agent modifies existing project files, make source `.md` tasks explicitly read-only, and consider an explicit review step for high-impact commands.
