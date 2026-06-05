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

Aivatar is a Tauri 2 + React + TypeScript desktop companion for AI coding agents. It displays a retro pixel-style room where a customizable pixel octopus companion lives, wanders, sleeps, works, plays, decorates its room, and reacts to live agent status in real time.

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

If nearby worktree preview ports are already occupied, this worktree has been
previewed on:

```powershell
node .\node_modules\vite\bin\vite.js --host 127.0.0.1 --port 1424 --strictPort
```

Use `http://127.0.0.1:1425/` for the current furniture-skin preview. This
origin has separate `localStorage` from `1420`, `1421`, `1422`, `1423`, and
`1424`.

Run desktop app:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_TARGET_DIR = "$env:TEMP\aivatar-cargo-target"
cmd.exe /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && npm.cmd run tauri dev'
```

The Tauri desktop app attempts to start the local status bridge automatically during app setup. The Debug panel also includes a `Start bridge` button for manually starting it from the app. Starting the bridge from Tauri also attempts to start Codex Desktop session discovery.

Run real local status bridge:

```powershell
npm.cmd run status:bridge
```

Run Codex Desktop session discovery:

```powershell
npm.cmd run status:discover
```

Manual bridge startup is still useful for web-only previews, bridge debugging, or when running the React dev server without the Tauri shell. For web-only previews that should auto-detect Codex Desktop sessions, run both `status:bridge` and `status:discover`.

Run Aivatar session-learning worker manually:

```powershell
npm.cmd run aivatar:learn -- --provider none --agent claude-code --session test --status complete --summary "Aivatar learned a tiny memory."
npm.cmd run aivatar:learn:claude -- --agent claude-code --session test --status complete --summary "Aivatar learned from Claude Code."
npm.cmd run aivatar:learn:codex -- --agent codex --session test --status complete --summary "Aivatar learned from Codex."
```

`--provider none` uses the local heuristic fallback and is useful for bridge/UI smoke tests. `aivatar:learn:claude` uses Claude Code `--print`/JSON output when Claude Code is logged in; if Claude Code is not logged in or returns invalid JSON, the worker falls back without breaking status flow. `aivatar:learn:codex` uses `codex.cmd exec` with read-only/no-approval structured output and has been smoke-tested for English and Chinese learning payloads.

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

The plugin now separates presence from turn state. The heartbeat keeps sessions connected through presence without repeatedly stealing active/follow state, while the rollout watcher tails the current Codex Desktop JSONL from the connect-time end of file and streams ordinary turn activity into Aivatar. Multiple Codex worktree/Desktop sessions can remain connected at the same time; the single followed/active session is changed by an explicit connect/Follow action rather than by every heartbeat tick.

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

Run Codex or Claude Code through the wrapper:

```powershell
npm.cmd run codex:run
npm.cmd run codex:run -- --help
npm.cmd run claude:run
```

Run Claude Code through the connected wrapper:

```powershell
npm.cmd run claude:connected
npm.cmd run claude:connected -- --help
```

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

Current session safety expectation: Aivatar should not delete, rewrite, migrate,
or hide Codex Desktop chats. The connected wrapper reads Codex rollout JSONL
metadata, passes child-process environment variables, writes Aivatar recovery
logs under `%TEMP%`, and manages Aivatar heartbeat/watcher pid records and token
baselines. If chats disappear or a session list changes unexpectedly, first
suspect stale external plugin commands, PATH shadowing, Codex Desktop behavior,
or a mismatched wrapper invocation rather than bridge in-memory cleanup.

The desktop CLI Launcher now uses this connected wrapper through Tauri. In the
app, choose a folder, choose Codex or Claude Code, optionally add args, and click
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
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`,
`StopFailure`, and `SessionEnd` into Aivatar statuses, while statusLine updates
context-window usage and can fall back to a terminal `complete` event when output
tokens appear but a `Stop` hook was not observed. Launcher-started Claude Code
sessions connect with an initial `idle` status; real prompt/tool events drive
later `thinking`, `executing`, `waiting_for_user`, `complete`, or `error` states.
For launcher/Task Cabinet sessions, the hook prefers the injected
`AIVATAR_SESSION_ID` over Claude's own UUID so bridge status maps back to the
same Aivatar task/session row. Once a turn reaches `complete` or `error`,
late Claude `Notification`, statusLine, `SessionEnd`, or disconnect cleanup
events preserve that terminal state instead of downgrading the session to
`waiting_for_user` or `idle`.

Connected launcher sessions now also enable Aivatar session learning by default:
`scripts/aivatar-connected-run.mjs` injects `AIVATAR_LEARNING_ENABLED=1` unless
the environment already sets a value, and defaults `AIVATAR_LEARNING_PROVIDER`
to `codex` for Codex and `claude-code` for Claude Code. Claude Code terminal
`complete`/`error` hook events spawn `scripts/aivatar-learning-worker.mjs`
non-blockingly after the ordinary status update. The worker reads only a
sanitized digest/context file under `%TEMP%\aivatar-learning-context\`, posts a
`phase: "session-learning"` payload with `learning`, and falls back to heuristic
learning if the configured provider is unavailable. Existing already-running
Claude/Codex sessions must be relaunched to inherit these environment variables.

Codex Desktop and Codex CLI learning are now also wired through the external
`aivatar-watch.mjs` rollout watcher. The watcher keeps a bounded sanitized
digest of Codex `user_message` and final/final_answer `agent_message` records,
writes `%TEMP%\aivatar-learning-context\codex-*.txt`, and spawns
`scripts/aivatar-learning-worker.mjs` with `AIVATAR_LEARNING_PROVIDER=codex`.
`scripts/aivatar-cli-connect.mjs` and `scripts/codex-session-discovery.mjs` pass
`AIVATAR_LEARNING_SCRIPT` so both connected CLI sessions and auto-discovered
Desktop sessions can produce `learning` payloads, not just template
`idleBubbleCandidates`.

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

Validate frontend:

```powershell
npm.cmd run build
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
|   `-- config/
|       `-- aivatar.config.json
|-- scripts/
|   |-- aivatar-cli-connect.mjs
|   |-- aivatar-cli-disconnect.mjs
|   |-- aivatar-cli-watchdog.mjs
|   |-- aivatar-connected-run.mjs
|   |-- aivatar-learning-worker.mjs
|   |-- aivatar-run.mjs
|   |-- aivatar-session-plugin.mjs
|   |-- claude-code-aivatar-hook.mjs
|   |-- codex-session-discovery.mjs
|   |-- codex-status-bridge.mjs
|   |-- mock-codex-status.mjs
|   `-- send-codex-status.mjs
|-- src/
|   |-- components/
|   |   `-- PixelAssetEditor.tsx
|   |-- App.tsx
|   |-- main.tsx
|   |-- styles.css
|   |-- types.ts
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
    |   `-- icon.ico
    `-- src/
        |-- lib.rs
        `-- main.rs
```

## Key Files

- `src/App.tsx`
  - Main React app.
  - Owns loaded content, save state, Canvas events, categorized shop UI, inventory/shop interactions, the Decor panel for wall/floor surfaces, furniture/window interactions, placement mode, Room Edit mode, Debug controls, custom avatar name, agent status display, and the right-side Agent Sessions panel.
  - Shows a locked/disabled `Asset Studio` entry in the right side panel below the shop, with the Pixel Asset Editor kept in code but hidden from the runtime UI while the workflow is still in development.
  - Includes a saved UI skin switcher stored under `aivatar.uiTheme.v1`. Current choices are `Classic`, `Terminal`, and `Amber`; the Terminal skins are retro CRT-style themes for the app shell, side-panel UI, and canvas presentation pass.
  - Applies save-state overrides for placed items, base furniture placement, active/moved windows, active wall/floor surfaces, wallet, inventory, table coffee storage, stats, work boost, avatar runtime, stable avatar id, avatar name, lightweight memory/growth state, and navigation-learning state.
  - Manages `aivatar.save.v1`, `aivatar.defaultLayout.v1`, and `layoutVersion: 2` layout migration. New saves get a stable `avatarId`; older saves missing `avatarId` are normalized with a generated id, while clearing the save creates a new avatar id.
  - Persists `aivatar.save.v1` whenever save state changes and flushes the latest save ref on `pagehide`, `beforeunload`, hidden `visibilitychange`, and the Tauri `aivatar://save-before-close` event, so confirmed furniture/item layout, inventory, wallet, pet stats, avatar runtime, active wall/floor surfaces, window/furniture placements, furniture storage, and memory/growth state survive closing the app.
  - Canvas click priority is placed items first, then base furniture, then active windows, so large windows do not steal clicks from desk objects.
  - Uses content `tags` and `placementSurfaces` for shop grouping, placement targets, and item-vs-furniture labeling.
  - Adds a Furniture Skins shop category. Furniture skin items use `tags: ["furniture-skin"]` plus `targetFurnitureId`, ownership is stored in `purchasedItemIds`, and the currently applied skin per base furniture is stored in `activeFurnitureSkinIds`.
  - Furniture skin passes currently include bed, desk, dining-table, and fridge skins. Bed skins include Industrial Bed Skin, Wood Red Bed Skin, and Ivory Pink Plaid Bed Skin. Desk skins include Industrial Desk Skin and Rococo Ivory Desk Skin. Table skins include Rococo Ivory Table Skin and Dark Oak Table Skin. Fridge skins include Ivory Fridge Skin. Purchased skins can be applied or cleared without entering placement mode and do not affect furniture placement, collision, pathfinding, or interaction targets. Clearing an applied furniture skin removes that furniture id from `activeFurnitureSkinIds` while preserving ownership in `purchasedItemIds`.
  - When furniture or placed items are selected, the canvas shows their generated interaction standpoints and a light gray ground-projection rectangle for the selected furniture/floor item, so movement/arrival targets, placement footprints, and navigation-blocking collision can be visually tuned together. Wall hangings keep their visual selection bounds but do not show a ground projection.
  - Surface items tagged `wall-surface` or `floor-surface` are managed through the Decor panel rather than the backpack: users can buy, apply, and clear applied wallpaper/flooring without entering placement mode. First purchase-and-apply costs `item.price + 1000 bits`; applying an already purchased wallpaper/flooring option costs `1000 bits`; clearing an applied surface is currently free.
  - Window shop items are managed through `purchasedItemIds` and `activeWindowId` rather than backpack inventory: buying a window applies it immediately, purchased windows can be re-applied from the shop without spending bits again, and selected windows can be sold for half price from the window edit panel. Clicking empty room space clears selected/moving window state and window placement previews.
  - The Decor panel is collapsed behind a high-contrast `Decor` button by default. Expanding it reveals a secondary wall/floor tab menu for wallpaper and flooring options. Wall/floor option buttons now use centered pattern thumbnails only; full surface names remain available through hover titles and aria labels.
  - Decor wallpaper options now include Exposed Red Brick Wallpaper, a buyable wall surface rendered with gray mortar, small offset red bricks, per-brick texture speckles/scars, soft edge shadowing, and a lower baseboard drawn as an overlay on top of the brick wall.
  - Inventory and shop item buttons use compact pixel thumbnails for visible item identity, with names preserved in hover titles and aria labels. Shop buttons show thumbnail plus price, while inventory buttons show thumbnail plus quantity.
  - Window shop buttons keep showing their price in the visible button label even after purchase/re-apply state, so purchased window options do not replace the price text with `ready`.
  - Stores table coffee in `furnitureStorage` and shows the current table coffee count/capacity in the Debug panel.
  - Table coffee capacity is now driven by placed `coffee-cup` items on the dining table: each table Coffee Cup contributes one visible storage slot, and table coffee is clamped when cups are moved, stored, sold, or deleted.
  - Migrates and preserves the built-in Terminal as locked placed item `builtin-terminal`.
  - Prevents the built-in Terminal from being stored, sold, or deleted; it can still be moved in Room Edit Mode.
  - Left-clicking furniture or placed items now selects them only. Avatar-triggering actions such as Terminal `Interact`, Coffee Machine `Brew`, Game Console `Play`, Oil Easel `Paint`, and furniture interactions are launched from a right-click scene context menu, preventing accidental interactions during layout editing/inspection.
  - Selecting placed items, room windows, or furniture from the canvas automatically scrolls the visible right-side panel to the active Room Edit card when the side panel is open, so edit actions are easier to find.
  - The built-in Terminal is interacted with from the right-click context menu, routes through the queued placed-item interaction flow before entering the local coding animation, and no longer grants bits or work boost directly.
  - Consumes bridge snapshots with `currentStatus`, `sessions[]`, `activeSessionKey`, `connectedSessionKey`, and `currentSessionKey`; the main avatar follows `currentStatus`, while the side panel shows recent sessions, Follow/Clear controls, and Active/Connected/Current/Idle/Stale markers.
  - Agent Sessions is collapsed behind a compact side-panel button by default. The button shows live/total session count, Current/source context, and a `+`/`-` affordance; expanding it reveals Follow/Clear/Disconnect controls, CLI hints, session cards, context window meters, reward summaries, and Active/Connected/Current/Idle/Stale markers.
  - Agent Sessions includes a `Clear Stale` button that asks the bridge to prune expired/stale session rows. Session expiry is now driven by each bridge session's `expiresAt` timestamp.
  - The bridge separates long session retention from short activity freshness: sessions can remain listed for the configured `AIVATAR_SESSION_STALE_MS` window, while stale high-priority activity stops driving the avatar after `AIVATAR_ACTIVITY_STALE_MS` (default 5 minutes). This prevents a closed Claude Code CLI from leaving the avatar stuck in an old `executing` state.
  - Agent Sessions ordering now prioritizes actual status timestamps before presence heartbeat timestamps, reducing visual jumping when many connected sessions keep refreshing presence.
  - Complete rewards are transition-gated for `agent: "codex"` and `agent: "claude-code"` sessions moving from `thinking`, `executing`, `waiting_for_user`, or `error` into `complete`, and also tolerate a fresh active/connected `complete` snapshot so rewards are not missed when the first UI-visible status is already complete. Repeated Live reads of the same complete event do not reward again.
  - Complete rewards can use token usage from the status payload. When usage is present, bits are based on weighted tokens: uncached input, output, and reasoning tokens count fully, cached input counts at 10%, and the reward is capped at 40 bits before any work boost bonus. Without usage, rewards fall back to the fixed 4-bit base.
  - Codex and Claude Code `complete`, `error`, and `waiting_for_user` statuses now update lightweight memory/growth state, including XP, recent memory events, and trait changes.
  - Life events such as sleeping, playing, using Coffee/Cola/Bento, brewing Coffee, and buying items also write compact recent memory entries and small trait/preference changes.
  - Agent Sessions cards display model context window usage when `usage.contextTokens` and `usage.modelContextWindow` are present, and display token reward context as `tokens -> bits (weighted)` when a session includes reward usage. Context-only usage with `scope: "context-window"` is not shown as a reward summary.
  - Agent Sessions preserves a session's latest known usage/context payload when a later status update omits `usage`, so terminal `complete`/`final_answer` events do not erase context-window meters.
  - Busy recovery allows the avatar to briefly leave high-priority agent work to drink coffee, eat food, or play games when stats are low, then return to the current agent state. If no recovery item is available, the avatar keeps working and is visually depleted instead of sleeping.
  - `thinking` does not trigger busy recovery, so the avatar keeps its focused thinking behavior instead of immediately switching to snacks or play while the agent is thinking.
  - Consumable use now routes Coffee, Cola, and Bento into distinct avatar behaviors when those specific items are consumed.
  - Sleep restores energy while the avatar is sleeping even when an agent session remains active, and sleep completion resets the runtime behavior back to idle/calm so the sleep animation does not stick.
  - Ordinary short UI messages no longer block autonomous eating/drinking recovery; short feedback interactions such as feed, work, brew, and reward have explicit or default timeouts so they do not permanently block later behavior.
  - Timed feedback bubbles with `endsAt` are cleaned up generically, and reward bubbles use a 10-second duration.
  - Coffee Machine brewing costs `1 bit` for both manual and autonomous brewing; if bits are insufficient, brewing is blocked and no Coffee is produced.
  - Coffee Machine production fills available table Coffee Cup slots first, then falls back to inventory capacity.
  - Autonomous Coffee Machine brewing sets a `brew` active interaction against the actual placed Coffee Machine instance id, so the machine's brewing lights, stream, fill, and steam animation can trigger while the avatar brews.
  - Expired Coffee Machine `brew` interactions explicitly reset the avatar out of `brew`, clear the coffee accumulator, clear stale interaction targets/activity labels, and convert the interaction to a short non-brewing feedback state so autonomous brewing cannot immediately re-open an endless brewing animation loop. Autonomous brewing also has a short cooldown after completion or blocked brew attempts so the Coffee Machine does not repeatedly steal idle-life cycles.
  - Real avatar interactions now follow a unified "arrive first, then interact" flow for furniture, placed items, and backpack consumables. Coffee Machine brewing, Game Console play, Oil Easel painting, and consumable effects are queued as world interactions and only apply after the avatar reaches the target. Room editing, ordinary left-click selection, right-click context menu opening, and Decor surface/window application remain immediate UI operations.
  - Avatar runtime now separates movement intent from action playback with `actionIntent` and `actionActivityLabel`. Arrival-gated behaviors such as sleep, relax, brew, snack, coffee/cola/bento, play, paint, coding/thinking, task-file actions, and placed-item interactions first move as an approach/wander state, then switch into the real action only after reaching the interaction point.
  - Action execution ranges are intentionally narrow around interaction points. Most actions require the avatar to reach within `8px` of a generated standpoint; the dining table keeps its broader rectangular trigger for ergonomic eating/drinking, while bed sleep and relax use a single bed-top point so the avatar settles under the blanket/at the bed position before the action plays.
  - Desktop/tabletop placed-item interactions no longer ignore the host `desk`/`table` collision for the whole route. The app relies on generated standpoints near the furniture edge, so Coffee Machine, Terminal, and Game Console interactions should route to reachable edge points instead of walking through the host furniture. Close furniture/tabletop standpoints are currently tuned to about `7px` from the relevant furniture edge; the Terminal keeps its special closer surface standpoint.
  - Tabletop Coffee Machine interaction standpoints are intentionally limited to the three front points only: centered, left-offset, and right-offset along the host furniture's front edge. This avoids side-point selection around table/desk collision edges.
  - The built-in Terminal / `terminal-monitor` interaction standpoint is intentionally limited to one centered front point on the host desk/table. This keeps coding/thinking interactions deterministic and avoids the avatar starting Terminal work from side or offset points.
  - Interaction arrival checks now treat the avatar's small ground-footprint rectangle as arrived when it touches an interaction standpoint, with the previous center-distance check retained as a fallback. This keeps the avatar from pushing endlessly into furniture edges once its visible foot box has reached the target marker.
  - Interaction arrival now only considers the currently selected `targetX`/`targetY`; alternate interaction points are used for rerouting after stalls, but merely passing near an alternate point no longer starts the action early.
  - Game Console play sets the avatar facing toward the placed console after arrival instead of forcing a generic front-facing pose. Mood recovery and console screen animation now use the active placed Game Console target or a near-active-play-target check, so autonomous play can animate the correct console even when the avatar stands at an edge interaction point.
  - When multiple placed copies of the same autonomous interactive item exist, automatic target selection uses a `70%` nearest / `30%` random rule. This currently covers Game Console play, Coffee Machine brewing, Oil Easel painting, Terminal/coding targets, and busy-recovery Game Console selection. Manual right-click interactions still use the exact clicked object.
  - Oil Easel is a buyable Furniture-category placed object implemented as `kind: "decor"` with `tags: ["furniture", "easel"]`. Right-clicking it opens a context action that queues an arrive-then-`paint` interaction; painting restores mood over time and records compact memory with `creativity +1`. Its floor placement foot projection is now also used as a placed-item navigation collision box.
  - Idle/autonomous life uses a layered weighted-choice model: recovery layers handle low energy, hunger, mood, and mildly low energy first, while healthy idle life chooses among play, paint, brew, explore, admire, interact, wander, phone, snack, and relax by weights. Trait boosts adjust weights rather than using absolute thresholds, so later behaviors such as explore/admire/interact are no longer hidden behind earlier play/paint/brew checks. `brew` is intentionally low-weight so the Coffee Machine does not dominate idle behavior. Autonomous behavior durations are now behavior-specific rather than a uniform short random window; longer activities such as Game Console play and Oil Easel painting linger substantially longer.
  - Idle/autonomous life can choose an `explore` behavior when stats are healthy. Exploration walks toward sampled room/object-near targets and helps maintain learned navigation grid values in `navMemory.walkableCells`.
  - Navigation learning now records a lightweight local occupancy grid in `navMemory.walkableCells`, where `0` means learned walkable and `1` means learned blocked/risky. Ordinary movement, arrival success, stuck/failure events, and explicit exploration update these values. `navMemory.layoutFingerprint` invalidates learned grid values when furniture/blocking layout changes. Older `exploredCells` and `trickySpots` remain normalized for compatibility, but route costs no longer depend on tricky/visited-cell penalties.
  - Growth is now collapsed behind a compact side-panel button by default. The button shows `Growth`, current level, XP progress, and a `+`/`-` affordance; expanding it reveals a six-axis personality hex chart, recent memory, and idle bubble controls.
  - Growth traits are now six-dimensional: `focus`, `resilience`, `curiosity`, `efficiency`, `creativity`, and `warmth`. Raw trait points are capped at `1_000_000` per axis, while the enlarged, centered hex chart uses `log10(points + 1)` normalized against that cap for display; hovering the small hex node at each chart corner shows that trait name and raw point count in a larger center label.
  - Growth idle bubble controls show saved phrases, session-derived suggestions, learning-derived suggestions, memory-derived suggestions, and a language preference (`auto`, `zh`, `en`, `mixed`). Users can add suggested short phrases into `memory.preferences.idleBubblePhrases`, with saved phrase slots capped by the current avatar level, and can remove saved phrases from the same panel.
  - Idle bubble suggestions shown in Growth use an explicit source mix: target 3 memory-derived candidates and 3 session-derived candidates, with either source filling remaining slots when the other has fewer available candidates.
  - Consumes optional `status.learning` payloads from the bridge. New `learning.id` values write a `session_learning` recent memory event, apply small XP/trait changes, and add learning-derived suggested bubbles. `privacyRisk: "high"` learning payloads are ignored by the save layer.
  - `phase: "session-learning"` status updates apply learning only and do not trigger Codex/Claude complete rewards or error/waiting memory, preventing duplicate bits or duplicate task memories after the worker posts a learning result.
  - Growth suggested bubbles preserve candidate source metadata in memory only. If the same phrase arrives from multiple sources, source priority is `llm > session > memory`; `learning.source === "llm"` candidates render with an `LLM` label and highlighted styling. Session candidates also render compact source badges: Claude Code suggestions show `CC`, Codex suggestions show `Codex`, and these badges stay visible even when phrase slots are full and buttons are disabled. Accepted bubbles are still saved as plain strings, preserving the existing `localStorage` schema.
  - Posts a low-sensitivity avatar state snapshot to the bridge at `http://127.0.0.1:38988/avatar-state` whenever saved memory/avatar identity changes. The payload includes avatar id/name, growth level, trait totals, and idle bubble language preference only. It uses `fetch` first and `sendBeacon` as fallback, allowing session-learning workers to tune bubble tone from current personality without reading full browser `localStorage`.
  - The whole right-side menu can collapse into the room window through a narrow right-edge triangle handle. Collapsing locks the current room scene width, resizes the Tauri desktop window down to the room width, and keeps lightweight room HUD overlays visible over the room.
  - Collapsed room HUD overlays show pet Energy/Mood/Hunger at the upper left, Growth level/XP/dominant trait at the upper right, and a full-width context window meter near the lower edge when context usage is available.
  - Terminal UI skin currently covers the side-panel shell, status header/card, language/theme buttons, Growth, Agent Sessions, Task Cabinet, CLI Launcher, Debug, stats grid, Decor controls, Inventory/Shop text, Asset Studio locked entry, expanded submenu cards, custom context meters, collapsed room HUD overlays, and common button/input states.
  - Right-side expanded submenus use a slightly lighter nested background than their parent cards so Growth, Agent Sessions, Debug, and Decor hierarchy reads more clearly.
  - Side-panel collapse/expand uses a Rust-backed Tauri command so the main-window minimum size and size are updated together. The room stays left-aligned and scene width is temporarily locked during resize to avoid visible jumps.
  - Includes a collapsible CLI Launcher panel where users enter a working folder, choose Codex or Claude Code, optionally provide args, and start an agent CLI through the Tauri `start_agent_cli` command.
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
  - Debug is collapsed behind a compact side-panel button by default. The button shows `Debug`, the current source, Live/Override state, and a `+`/`-` affordance; expanding it reveals local status overrides, trait training, Tauri-only Start bridge, Add supplies, Demo actions, Window preview, Save layout, Clear save, bridge endpoint, boost status, and table coffee storage.
  - Debug controls include a Tauri-only Start bridge button, an Add supplies test button that grants bits/Coffee/Bento/Cola and fills currently available table Coffee Cup storage for recovery testing, six trait training buttons, and a `Demo actions` behavior cycle for inspecting every avatar behavior state, including the idle-only phone animation and task-file fetch/carry/read poses.
  - Debug includes a temporary `Nav grid` overlay for navigation QA. It draws green walkable samples, red blocked samples/collision boxes, the avatar foot ellipse, the current target, candidate interaction points, and the current A* path so stuck spots around furniture can be diagnosed visually. The overlay avoids recalculating and drawing A* target paths while the avatar is truly idle with no action intent, preventing stale idle targets from causing expensive per-frame pathfinding. The overlay may still show planner-expanded blocking samples when clearance is enabled, so distinguish those from the actual furniture collision rectangle.
  - `Window preview` accelerates the room window's time input so dynamic windows such as City Night Window and Ocean Window can be visually checked across a full day/night cycle without changing the system clock.
  - When a Debug status override is active, the status card shows `Debug override active - click Live` and the Live button is highlighted so test overrides are not mistaken for live agent state.

- `src/types.ts`
  - Defines runtime status, content, save-state, placement, inventory, furniture, room surface/window, pixel asset types, and avatar behavior names including the local-only `phone` idle animation behavior, the idle-learning `explore` behavior, the Oil Easel `paint` behavior, and task-file visual behaviors (`fetch_task_file`, `carry_task_file`, `read_task_file`).
  - `RoomWindowDefinition.kind` currently supports `cozy-window`, `city-night-window`, and `ocean-window`.
  - Includes the `file-cabinet` content tag used by the buyable unique File Cabinet furniture/task-cabinet visual MVP, plus the `easel` tag used by the Oil Easel placed-object painting interaction.
  - Defines Task Cabinet task metadata types: `TaskCabinetStatus` and `TaskCabinetEntry`. Task entries store the source `.md` path and execution metadata such as status, agent, cwd, session id, timestamps, and error text, but not the `.md` file content.
  - Defines lightweight Memory & Growth types: `AivatarMemory`, `AivatarGrowth`, six-axis `AivatarGrowthTraits`, `AivatarMemoryEvent`, `AivatarPreferences`, and `AivatarMilestone`.
  - Defines `AivatarNavMemory`, which stores exploration/navigation-learning counters plus learned `walkableCells` occupancy values, `layoutFingerprint`, success/failure counts, and the latest exploration timestamp.
  - `AvatarRuntime` includes `actionIntent` and `actionActivityLabel` for arrival-gated actions. `behavior` can represent the current approach/movement state while `actionIntent` records the real action to start after arrival. It also includes optional `navigationFailure` metadata so the App layer can clear pending interactions and show blocked feedback when a target cannot be reached.
  - `CodexStatusMessage` can carry optional `idleBubbleCandidates?: string[]` from the local bridge, and `AivatarPreferences` can store accepted `idleBubblePhrases?: string[]` plus `idleBubbleLanguage?: "auto" | "zh" | "en" | "mixed"`.
  - Defines `AivatarLearningResult`, carried by `CodexStatusMessage.learning`, for LLM/heuristic session-learning output: stable `id`, `source`, summary, optional idle bubble candidates, small trait changes, optional XP/confidence, and `privacyRisk`. `AivatarMemoryEventType` includes `session_learning`.
  - `TokenUsage` can carry `contextTokens?: number` and `modelContextWindow?: number` for Agent Sessions context window meters, in addition to reward-oriented token fields.
  - `AivatarSaveState` includes optional `avatarId`, `memory`, and `navMemory`, normalized on load for older saves. Missing `avatarId` values are generated during save normalization; missing trait axes and nav-memory maps are filled from defaults.

- `src/components/PixelAssetEditor.tsx`
  - In-app pixel asset and animation editor MVP.
  - Supports custom canvas sizes, presets, pencil/erase tools, color palette, multi-frame animation, FPS playback, frame copy/delete/add, localStorage save, and room-reference preview.
  - Saves editor drafts to `aivatar.assetEditor.v1`.
  - Shows the current `480 x 320` scene reference, wall area, floor area, and an adjustable asset anchor box.

- `src/game/renderScene.ts`
  - Draws the pixel room, configurable floor/wall surfaces, configurable windows, furniture, four-direction octopus avatar, placed decor/furniture, placement previews, Room Edit highlights, avatar bubbles/progress, and status light.
  - Accepts the current UI theme so the canvas presentation can harmonize with Classic, Terminal, and Amber app-shell skins.
  - Renders the current programmatic pixel art pass, including the Stardew-inspired bed with optional skins, retro drawer desk with optional Industrial and Rococo Ivory skins, placed CRT-style Terminal with animated keyboard, dining table with optional Rococo Ivory and Dark Oak skins, retro two-door fridge with optional Ivory skin and deeper top clutter, buyable File Cabinet, premium black/gray Coffee Machine, Coffee Cup, Switch-style Game Console, Oil Easel, Digital Wall Clock, rainbow Cozy Rug, purple morph-blob rug, fridge door open/hold/close animation, and blanket overlay used when the avatar sleeps under the covers.
  - The bed renderer supports `skinId`. The default bed keeps the warm wood frame, blue star blanket, pillows, sheet, and plush toy. `industrial-bed-skin` swaps in a metal industrial frame, light gray pillows/sheet, and a deeper dark-gray blanket with smoother horizontal pixel shading while preserving the plush toy. `wood-red-bed-skin` uses a wooden frame with a red blanket. `ivory-pink-plaid-bed-skin` uses a refined ivory frame with warm highlights/gold details and a denser pink plaid blanket; the sleep blanket overlay reads the same palette and plaid pattern.
  - The desk renderer supports `skinId`. The default desk keeps the retro drawer/writing-pad look and now uses a semi-transparent base shadow matching the dining-table shadow opacity. Its underside includes a smooth black oval shadow silhouette with a subtle low-frequency pair of yellow eyes that open briefly and then close. `industrial-desk-skin` preserves the base desk dimensions, placement, collision, and interaction geometry while swapping in a smoother dark oak desktop, no desk pad, black metal four-corner legs, thicker/aligned front legs with highlighted feet, tabletop-over-leg occlusion, semi-transparent underside shadows, and a tiny black-cat silhouette in the desk shadow. `rococo-ivory-desk-skin` keeps the same geometry while rendering an ivory desk with gold trim, carved panel details, curved legs, and segmented foot highlights.
  - The table renderer supports `skinId`. The default table keeps the reflective metal dining-table pass and the standard table shadow. `rococo-ivory-table-skin` keeps the same placement, collision, coffee storage, and interaction geometry while rendering an ivory tabletop with warm gold trim, curved legs, and four symmetric iris motifs on the tabletop. `dark-oak-table-skin` renders a dark oak tabletop with warm brown wood grain, a dark edge, and thicker wooden legs.
  - The fridge renderer supports `skinId`. The default fridge keeps the retro green two-door body and top clutter. `ivory-fridge-skin` keeps the same dimensions, collision, clutter, interaction, and door animation while swapping the body and animated door panel to ivory/cream colors with warm-gold handles.
  - The sleep blanket overlay reads the same bed palette as the visible bed so sleeping does not snap back to the default blue blanket after a furniture skin is applied.
  - Renders the File Cabinet as a narrower front-facing metal cabinet with a deeper top plane, right-side shading, front drawers, and visible stacked task-file papers. Visible papers are driven by the real Task Cabinet queue: `Ready + Failed` tasks appear in the cabinet, `Running` tasks are treated as taken out, and `Completed` tasks disappear.
  - Failed Task Cabinet papers render with a small red `X` and remain visible until the task is successfully rerun or removed. Papers are drawn behind the drawer front so the drawer lip occludes them like real files.
  - Renders floor rug underlay items, currently a doubled-size rainbow Cozy Rug with shallow shadow/light woven edge and Morph Blob Rug, immediately after the floor and before all furniture, ordinary placed items, and the avatar, so furniture and objects can visibly cover rugs.
  - Renders wall-only placed items such as Poster and Digital Wall Clock on the wall layer after the wall/window and before furniture, so furniture naturally occludes wall hangings instead of wall hangings drawing over furniture.
  - Renders floor placed items in avatar-aware layers: floor items behind the avatar are drawn before the avatar, while floor items in front are redrawn after the avatar so placed objects such as the Oil Easel can occlude the avatar when the avatar stands behind them.
  - Renders furniture in visual-depth order rather than raw content order, so bed/desk/table/fridge/File Cabinet layering is less dependent on config array order.
  - Renders the bed as a split layer: the main bed body is always drawn in the behind-avatar furniture pass, while the bed footboard can be redrawn in the foreground pass to cover only the avatar's feet instead of covering the whole character.
  - Renders the Purple Bubble Wallpaper wall surface with a purple base, larger rounder bubble motifs, highlights, and light texture, Pink Sakura Wallpaper with denser stable pseudo-random blossoms and petals, Warm Ivory Wallpaper with subtle off-white paper grain and soft seams, and Exposed Red Brick Wallpaper with gray mortar, smaller offset bricks, per-brick speckles/scars, and a textured low baseboard overlay.
  - Renders Checker Tile Floor with black/white tile checks, Polished Cement Floor with fine smooth concrete texture and gloss, Industrial Metal Floor with shaded plates/rivets and a top-to-bottom brightness gradient, and Tatami Mat Floor with green binding and softened woven straw texture.
  - Renders the City Night Window as a dynamic city view: sky colors smoothly transition through day, dusk, night, and dawn; the sun rises from the left and sets to the right; the moon crosses the night sky; drifting clouds and building silhouettes occlude the sun/moon; the glass area is clipped to the window bounds.
  - City Night Window building windows distinguish daytime natural-light panes from nighttime interior lights. Evening lights warm up gradually, late-night lights turn off by stable per-window seed so only a few remain lit, and dawn transitions remaining lit windows into daylight panes rather than simply fading them to black.
  - City Night Window high-rises include small red aircraft warning beacons that breathe at dusk/night and stay off in daylight and dawn.
  - Renders the Ocean Window as a wider, taller sea view near the wall/floor line: real-time sky and ocean color changes, softened horizon transition, sunrise/sunset glow, dawn/dusk color bands, moon at night, drifting clouds, dense breathing wave sparkles/reflections that follow the sun/moon position, and three slow-moving ships with depth: a modern cargo ship, a cruise ship, and a smaller distant cargo ship. Ship X positions use subpixel movement to avoid low-speed stutter, and ship lights turn on at night/deep dusk.
  - Animates Coffee Machine brewing when the active interaction is `brew`, including pulsing indicator lights, status strip flashes, coffee stream pixels, cup fill pixels, and small steam pixels.
  - Renders placed Coffee Cup as a small transparent glass tabletop cup-and-saucer item with a right handle, rounded elliptical rim/lower rim, stronger base shadow, and visible coffee volume/slow dynamic rising steam when that cup represents one stored table Coffee. Empty cups show a pale transparent glass interior.
  - Renders a larger Game Console screen and adds animated screen pixels only when the avatar is in `play` behavior near the active/targeted placed Game Console, so autonomous and manual play animate the intended console without lighting up distant consoles.
  - Renders the Oil Easel as a more detailed programmatic pixel-art wooden easel with support legs, richer shadowing, brass/crossbar accents, a paint tray, and a canvas carrying a permanent half-finished landscape sketch. The avatar has a `paint` pose based on the front-facing octopus proportions, with a beret, paintbrush, palette, and small brush motion; active painting adds animated color strokes on top of the half-finished canvas. The shop/backpack thumbnail has matching extra canvas and paint details.
  - Renders a dedicated `admire` pose: the avatar lifts its tentacles and shows small sparkle/observation pixels while admiring decor. `admire` activity bubbles now prefer the behavior-specific trait phrase over generic idle bubble text so the action reads more clearly.
  - Renders the Digital Wall Clock as a wall hanging that reads the local system time as `HH:MM` each frame.
  - Draws Codex-session notification bubbles over the Terminal and rounded thinking bubbles over the avatar. Session bubbles wrap by measured pixel width, can use two lines where needed, and use a small pixel-font renderer for ASCII text so English status/tool text stays sharp inside the scaled canvas. Bubble width measurement and pixel-text drawing now use the same width model to reduce text overflow.
  - Canvas avatar/interaction bubbles, rounded thinking bubbles, and built-in Terminal/Codex status bubbles accept the current UI theme from `App.tsx`. Classic keeps the original beige/blue bubble styling; Terminal uses black-green bubble fills, neon green borders, green text, and green progress bars.
  - CJK fallback text in avatar and Terminal bubbles uses a clearer Chinese-oriented canvas font stack (`Microsoft YaHei UI`, `Microsoft YaHei`, `Microsoft JhengHei`, `PingFang`, `Noto Sans CJK`) at a slightly larger size, while ASCII text still uses the custom pixel font.
  - Terminal bubbles only show `agent: "codex"` session notifications; `thinking` is shown over the avatar instead of over the Terminal.
  - Renders the placed Terminal monitor with a keyboard; during coding/thinking proximity, the screen and keyboard animate.
  - Renders dedicated consumable poses for Coffee, Cola, and Bento while keeping the main octopus body shape consistent with the existing front/side avatar art.
  - Coffee uses a cup/steam sip pose, Cola uses a red can with straw and fizz pixels, and Bento uses a lunch box with food pixels, holding tentacles, and a small eating/chewing motion.
  - Renders an idle-only phone pose in the current avatar proportions: the octopus holds a small phone and taps it with animated tentacles. When facing the viewer, the phone back faces outward; side-facing poses show a thinner glowing screen. This animation is purely visual and does not reply to or emit agent status.
  - Renders task-file poses for the future task-cabinet workflow: fetching a file from the cabinet, carrying a task file, and reading an open task file near the Terminal.
  - Renders a `complete`/`success` yawn animation using the existing front/side avatar proportions: closed eyes, open yawning mouth, small lifted tentacles, and subtle breath pixels. The room status light falls back to idle after the short complete visual window expires.
  - Renders trait-driven avatar visual themes from memory/growth: Focus uses cool blue/cyan, Resilience uses warm coral/gold, Curiosity uses mint/yellow/pink accents, Efficiency uses electric cyan/white/green accents, Creativity uses vivid violet/magenta/gold accents, and Warmth uses soft orange/cream/gold accents.
  - Trait themes affect body color, highlights, eye shape, screen glow, success/error/thinking motifs, and low-mood/depleted color bands.
  - Thinking, activity, error, and success bubbles can use short trait-specific ASCII phrases such as `Tracing it`, `We recover`, `What broke?`, `Done clean`, `New angle`, and `With you`.
  - Idle/autonomous states can occasionally show short stable-random avatar bubbles, giving the pet small ambient thoughts while it wanders, relaxes, admires, or idles. Accepted session-derived idle bubble phrases are mixed into the idle/autonomous bubble candidate pool.
  - Renders low-stat busy depletion by progressively darkening the avatar while preserving eye/highlight readability.
  - Shows short thought bubbles during interactions, such as going to a target, needing rest, drinking coffee, eating food, brewing coffee, or finding no snacks.
  - When furniture is selected, renders its configured `collision` footprint as a translucent red rectangle so the actual navigation-blocking ground projection can be visually inspected in Room Edit/testing flows.
  - When furniture or floor placed items are selected, renders their placement ground projection as a light gray rectangle, matching the footprint used by placement overlap checks.
  - When furniture or placed items are selected, renders their generated interaction standpoints as small crosshair markers so target placement can be visually QA'd. The Oil Easel no longer shows or uses the generic above-object standpoint, and the Terminal is constrained to front surface standpoints.
  - Renders the temporary `Nav grid` debug overlay when enabled from the Debug panel: walkable/blocked navigation samples, collision boxes, avatar foot bounds, target line, A* path, and interaction candidates.
  - Avatar and furniture art remain programmatic canvas drawing; editor-created assets are not yet wired into runtime rendering.

- `src/game/simulation.ts`
  - Avatar state machine and behavior logic.
  - Maps agent status to avatar behavior.
  - Provides visual-only task-file behavior targets: `fetch_task_file` moves toward the File Cabinet, while `carry_task_file` and `read_task_file` move toward the placed Terminal area.
  - Handles autonomous sleep, wander, explore, relax, snack, admire, brew, paint, and play activities through a layered weighted-choice system rather than a single absolute-threshold roll. Autonomous behavior durations are tuned per behavior: play and paint are long activities, explore/relax/admire/phone are medium-length activities, and snack/brew remain shorter utility actions.
  - `idle` leaves the avatar to its autonomous life behavior, including sleeping, eating/drinking, wandering, exploring, relaxing, playing, admiring decor, and brewing coffee.
  - `thinking` now routes the avatar to the desk/Terminal area for focused thought instead of random wandering; `executing`/coding targets the placed Terminal and routes the avatar to the Terminal-facing side of the desk/table.
  - `coffee`, `cola`, and `bento` are distinct consumable behaviors with happy expression and front-facing interaction poses at the table/fridge area.
  - Coding arrival faces the avatar toward the Terminal for a direct interaction pose.
  - Low-energy busy behavior can send the avatar to the table for coffee when coffee is available.
  - Prioritizes placed decor, Coffee Machine, Game Console, and Oil Easel for autonomous activities by adding behavior weights when those objects exist; recovery needs still choose from their own weighted layer before ordinary idle-life choices.
  - `explore` is a low-priority idle-learning behavior. It only triggers when Energy/Mood/Hunger are healthy, targets either a random floor point or a sampled point near furniture/placed items, and runs longer than ordinary wander so it can collect route experience.
  - `tickAvatar` accepts optional memory/growth state, and autonomous behavior choices are lightly biased by traits through weights: curiosity favors exploring/admiring/interacting, efficiency favors brewing and quick recovery, focus favors recentering/relaxing, resilience favors mood recovery/continuing activity, creativity favors painting at the Oil Easel, and warmth is available for visual themes, bubbles, and future richer behavior weighting.
  - Idle/autonomous behavior can randomly choose `phone`, a local-only visual animation that does not update memory/growth, does not post bridge status, and does not represent agent activity.
  - Autonomous behavior durations are tuned per action instead of using one short range: play is roughly 28-42 seconds, paint roughly 32-48 seconds, relax/explore/admire/phone are medium-length, and snack/brew remain short.
  - Updates four-direction facing from movement, supports collision-aware movement, arrival-gated action promotion, and delays furniture interaction effects until the avatar reaches the target.
  - Avatar navigation uses a foot-center pathing model. Collision checks evaluate the avatar foot center against furniture/item collision rectangles inflated by the avatar foot radius and planning clearance; this keeps planning, runtime movement, and interaction-point filtering aligned while the visible foot remains an ellipse.
  - Navigation progress watches the final interaction target as well as intermediate waypoints. If movement becomes blocked or stalls, the avatar now pauses immediately for a short replan instead of continuing same-frame micro-moves, target switching, or backoff motions that previously caused high-frequency jitter.
  - Uses a lightweight 8px nav-grid A* pathfinding pass with cached full-path waypoints. Cached path following now chooses the next point after the path node nearest to the avatar, preventing old path nodes behind the avatar from pulling it backward and causing high-frequency vibration. Ordinary path selection avoids cells marked `1` in `navMemory.walkableCells`, with static collision checks as fallback for unknown cells.
  - Interaction standpoints have been retuned around common obstacles. Furniture and desktop-item close standpoints use a `CLOSE_INTERACTION_STANDPOINT_DISTANCE` of half the foot/planning safe gap, currently about `7px`, so table/desk/Coffee Machine/Game Console interactions stand nearer the furniture edge. The Terminal keeps a special closer surface standpoint so coding/thinking poses stand nearer the desk edge.
  - Queued interactions prefer the object's default/main interaction target rather than the avatar-nearest point, reducing side-point selection and collision-edge jitter near desks, tables, fridges, terminals, Coffee Machines, Game Consoles, and Oil Easels.
  - Autonomous desktop placed-item behaviors such as `brew`, `play`, `coding`, and `thinking` target generated placed-item standpoints without using the host furniture as a route-wide collision-ignore id. Narrow collision-ignore handling is reserved for true furniture exceptions such as bed sleep.
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

- `public/config/aivatar.config.json`
  - Runtime-editable content manifest.
  - Defines avatar, room furniture, furniture collision boxes where used, configurable floor/wall surface palettes, configurable windows, starter inventory, item definitions, shop items, pet stats, wallet, decor, utility items, desktop/floor items, unique File Cabinet shop content, and window shop content.
  - Furniture collision boxes represent the furniture's ground-projection/footprint rather than the full visual sprite. Default collision footprints are tuned to visible lower/base areas in both `src/data/defaultContent.ts` and `public/config/aivatar.config.json`, including Desk `{ x: 178, y: 138, width: 86, height: 25 }`, Fridge `{ x: 346, y: 143, width: 38, height: 31 }`, and Table `{ x: 310, y: 258, width: 82, height: 28 }` in the default layout.
  - Uses `tags` and `placementSurfaces` to distinguish furniture, items, hangings, consumables, windows, and room surfaces.
  - Furniture skin shop content currently includes Industrial Bed Skin (`240` bits), Wood Red Bed Skin (`260` bits), Ivory Pink Plaid Bed Skin (`280` bits), Industrial Desk Skin (`280` bits), Rococo Ivory Desk Skin (`340` bits), Rococo Ivory Table Skin (`320` bits), Dark Oak Table Skin (`260` bits), and Ivory Fridge Skin (`300` bits). Furniture skin items use `tags: ["furniture-skin", ...]` plus `targetFurnitureId` for the base furniture. Runtime content is duplicated in `public/config/aivatar.config.json` and the `src/data/defaultContent.ts` fallback.
  - Includes surface definitions for Purple Bubble Wallpaper, Exposed Red Brick Wallpaper, Pink Sakura Wallpaper, Warm Ivory Wallpaper, Checker Tile Floor, Polished Cement Floor, Industrial Metal Floor, and Tatami Mat Floor. Matching `wall-surface` and `floor-surface` shop/item definitions provide pricing and purchased-state metadata for the Decor panel, but these surface items are filtered out of the backpack and are not placed as room objects.
  - Current runtime default layout uses City Night Window, moved base furniture, locked placed item `builtin-terminal` on the desk, and a default Desk Lamp on the desk.
  - `terminal-monitor` remains in item definitions for rendering the built-in Terminal, but it is no longer sold in the shop.
  - File Cabinet is present in item definitions and shop content as a unique Growth level 25 furniture item. It is hidden from the shop while one is in inventory or placed in the room, and becomes buyable again after being sold or deleted.
  - Window shop content currently includes City Night Window and Ocean Window. Ocean Window is present in `room.windows`, `itemDefinitions`, and `shop.items`, with a `188 x 96` default wall placement intended to sit closer to the floor than the city window.
  - Shop/content manifest now includes Digital Wall Clock as a wall-only hanging, Morph Blob Rug as a floor-only rug item, Coffee Cup as a tabletop coffee-storage item, and Oil Easel as a Furniture-category placed object that still uses the placed-item rendering and interaction path.
  - Current major shop prices are intentionally high for economy balancing: Cozy Rug `180`, Morph Blob Rug `360`, Game Console `3000`, Coffee Machine `5600`, Oil Easel `640`, File Cabinet `1200`, and Ocean Window `8888`.
  - Current runtime default layout includes one Coffee Cup on the dining table for new/no-save sessions.

- `scripts/codex-status-bridge.mjs`
  - Real local agent status bridge.
  - Accepts generic agent HTTP status updates and broadcasts them to Aivatar over WebSocket.
  - Supports both `/agent-status` and legacy `/codex-status` HTTP/WebSocket paths.
  - Supports `/agent-active` for choosing the session the app should follow and `/agent-presence` for keeping the active session visibly connected even when no new status event has arrived.
  - Supports `POST /avatar-state` for receiving the frontend's low-sensitivity avatar personality snapshot and writing it to `%TEMP%\aivatar-avatar-state.json` by default. This file is consumed by session-learning workers for trait-aware bubble tone.
  - Supports `DELETE /agent-sessions/stale` for manually pruning expired/stale session history.
  - Maintains one latest status per `agent + sessionId` and broadcasts snapshots containing `currentStatus`, `sessions[]`, `activeSessionKey`, `connectedSessionKey`, `currentSessionKey`, and a snapshot timestamp.
  - Adds `expiresAt` to session status/presence records. Fresh status or presence updates extend expiry; expired active/followed sessions are cleared during pruning.
  - Normalizes and preserves optional `usage` fields, including `contextTokens` and `modelContextWindow`, so token usage can flow from status clients into the Agent Sessions panel, context window meters, and Codex reward logic.
  - When a newer status update for the same session omits `usage`, the bridge preserves the previous usage payload so final/terminal status events do not erase context-window meters.
  - Normalizes and preserves optional `idleBubbleCandidates` arrays in status payloads so session-derived short phrase suggestions can flow into the Growth panel. These suggestions are bridge-memory only and are not persisted by the bridge. The bridge filters candidates outside the 2-28 character range instead of truncating overlong text into partial phrases.
  - When a newer status update for the same session omits `idleBubbleCandidates`, the bridge preserves the previous candidates so tool-use/executing updates do not erase suggestions generated from user or final agent messages.
  - Normalizes and preserves optional `learning` payloads in status updates. Learning payloads are bridge-memory only and include `id`, `source`, short summary, filtered 2-28 character idle bubble candidates, bounded trait changes, bounded XP/confidence, and `privacyRisk`. When a newer status update for the same session omits learning, the bridge preserves the previous learning payload.
  - Selects `currentStatus` by preferring a fresh active session, then fresh high-priority sessions, then fresh non-idle sessions, then bridge idle. Presence heartbeats keep a session visibly connected but do not keep stale high-priority statuses such as `executing` driving the main avatar.
  - Treats sessions as stale/expired after `AIVATAR_SESSION_STALE_MS` milliseconds, defaulting to 30 minutes. Expired sessions no longer block interaction or drive the main avatar state, and bridge pruning removes them from the session list.
  - Prunes stale sessions and caps the in-memory session map with `AIVATAR_MAX_SESSIONS`, defaulting to `80`, so long-running bridge processes do not grow unbounded.
  - Persists disconnect tombstones under `%TEMP%\aivatar-disconnected-sessions.json` by default, so sessions explicitly disconnected by the UI are not immediately resurrected by discovery after a bridge restart.

- `scripts/codex-session-discovery.mjs`
  - Aivatar-side Codex Desktop session discovery service.
  - Runs as a single background process recorded under `%TEMP%\aivatar-session-discovery\discovery.json`.
  - Read-only scans `CODEX_HOME\sessions\**\*.jsonl`, defaulting to `%USERPROFILE%\.codex\sessions`, and parses `session_meta.payload.id`, `cwd`, `originator`, and `source` from recent rollout files.
  - Only considers rollout files modified within `AIVATAR_DISCOVERY_ACTIVE_MS`, defaulting to `AIVATAR_SESSION_STALE_MS` (30 minutes by default), so older chat history is not eagerly connected.
  - Posts `/agent-presence` for detected Codex sessions, starts the external plugin `aivatar-heartbeat.mjs` and `aivatar-watch.mjs` when helpers are missing or dead, records helper pids under `%TEMP%\aivatar-session-discovery\helpers`, and stops helper processes whose rollout files fall outside the active window.
  - When discovery stops an inactive helper, it also posts `/agent-sessions/disconnect` so the bridge immediately removes the stale session row and writes a disconnect tombstone. This prevents old auto-discovered Codex sessions from lingering in Agent Sessions until normal expiry.
  - Passes `CODEX_ROLLOUT_PATH` to each watcher so it tails the exact discovered rollout JSONL instead of searching by session id.
  - Defaults token reward baselines to `%TEMP%\aivatar-usage-baselines.json` to avoid restricted `.codex\tmp` write contexts.
  - Passes `AIVATAR_LEARNING_ENABLED`, `AIVATAR_LEARNING_PROVIDER=codex`, and `AIVATAR_LEARNING_SCRIPT` into spawned Codex watcher helpers, so auto-discovered Desktop sessions can produce `phase: "session-learning"` payloads from sanitized rollout digests.
  - Sends a one-time `thinking` / `discovered` status when it first starts helpers for a session, then leaves real turn state to the watcher. Discovery does not repeatedly overwrite active turn status.
  - Does not modify, rename, delete, migrate, or hide Codex Desktop session/chat files.
  - Does not set `/agent-active` by default; manual `aivatar-connect`, Agent Sessions Follow, and launcher flows remain the explicit ways to choose the followed session.

- `C:\Users\rniu\plugins\aivatar-session-bridge`
  - External local session plugin, currently outside this repo.
  - `aivatar-connect` now stops only the same session's previous heartbeat/watcher rather than stopping all Aivatar session background processes.
  - `aivatar-heartbeat` defaults to presence-only updates; it does not repeatedly post active/follow state unless explicitly launched with `--active`.
  - `aivatar-watch` falls back to context-window usage for `complete`/`error` events when token-delta usage is unavailable, so worktree sessions can continue showing context after final answers.
  - `aivatar-watch` now keeps a bounded sanitized Codex conversation digest from rollout `user_message` and final/final_answer `agent_message` events, writes `%TEMP%\aivatar-learning-context\codex-*.txt`, and spawns the repo `scripts/aivatar-learning-worker.mjs` on terminal completion when learning is enabled. It passes the avatar state snapshot path so Codex-derived learning bubbles can use current trait-aware tone.

- `src-tauri/src/lib.rs`
  - Owns the Tauri command that starts the Node status bridge from the desktop app.
  - Attempts to start the bridge automatically during Tauri app setup and also starts `status:discover` for Aivatar-side Codex Desktop session discovery.
  - Exposes the same bridge/discovery start flow to the React Debug panel through `start_status_bridge`.
  - If the bridge is already running, `start_status_bridge` still attempts to start discovery; the discovery script exits when another discovery instance is already alive.
  - Exposes `start_agent_cli`, used by the CLI Launcher. It validates the selected working directory, starts the status bridge if needed, opens PowerShell in that folder, and runs `scripts/aivatar-connected-run.mjs --agent <agent> -- <codex|claude> <args>` so launcher-started CLIs auto-connect to Aivatar and disconnect on exit.
  - Exposes `start_task_agent`, used by Task Cabinet automation. It validates the selected working directory, validates that the task path is an existing `.md` file, reads the source `.md` file without modifying it, rejects prompts over 24,000 characters, writes a derived prompt copy under `%TEMP%\aivatar-task-prompts\`, starts the bridge if needed, and launches Codex/Claude through `scripts/aivatar-connected-run.mjs --prompt-file <tempPrompt>`.
  - Exposes `pick_markdown_task_file` and `pick_launcher_directory`, used by desktop Browse buttons for Task Cabinet and CLI Launcher path selection.
  - Exposes `resize_main_window_for_side_panel`, used by the React side-panel collapse flow to update the main window minimum size and size together, reducing WebView flicker during menu collapse/expand.
  - Intercepts main-window close requests, emits `aivatar://save-before-close` to the frontend, waits briefly, then closes the window so the latest avatar runtime, room surface choices, layout, inventory, wallet, and stats have a chance to flush to localStorage.

- `scripts/aivatar-run.mjs`
  - Generic lifecycle wrapper for commands and AI agent CLIs.
  - Sends `thinking`, `executing`, `waiting_for_user`, `complete`, and `error` updates to the bridge while the wrapped process runs.
  - Supports `--agent <name>` and `--session <id>`; if no session id is provided, it generates one automatically so concurrent agent runs do not overwrite each other.
  - This remains useful for simple command lifecycle tracking, but the desktop CLI Launcher now uses `scripts/aivatar-connected-run.mjs` for seamless connect/watch/disconnect behavior.

- `scripts/aivatar-connected-run.mjs`
  - Connected CLI wrapper used by `codex:connected` and the desktop CLI Launcher.
  - Runs `aivatar-cli-connect -> target CLI -> aivatar-cli-disconnect`, forwarding the target CLI exit code.
  - Uses absolute paths to repo scripts so it works when launched from any selected project folder.
  - For Codex without an explicit session id, it avoids inheriting stale `CODEX_THREAD_ID`/`CODEX_SESSION_ID`, snapshots existing rollout JSONL files, launches Codex, detects the new rollout file, extracts the real Codex session id, disconnects the provisional session, and reconnects Aivatar to the real session.
  - For Claude Code, writes a temporary settings file under `%TEMP%\aivatar-claude-code-settings\`, passes it via `claude --settings <file>`, and registers Aivatar command hooks plus statusLine for the current launched session. Hook handlers use exec form (`command` plus `args`) so Windows Git Bash is bypassed for turn events. StatusLine uses a generated PowerShell wrapper `<session>.statusline.ps1` that forwards stdin to the Node hook script. If the user explicitly passes `--settings`, automatic injection is skipped so user settings are not overwritten.
  - Passes `AIVATAR_HTTP_ENDPOINT`, `AIVATAR_ACTIVE_ENDPOINT`, and `AIVATAR_PRESENCE_ENDPOINT` into launched agent environments so hook/statusLine subprocesses post to the same bridge endpoints as the launcher.
  - Automatically enables Aivatar session learning for connected CLI sessions by passing `AIVATAR_LEARNING_ENABLED=1` unless the environment already sets a value. It defaults `AIVATAR_LEARNING_PROVIDER` to `codex` for Codex sessions and `claude-code` for Claude Code sessions, while still honoring explicit user overrides such as `none`.
  - Passes a wrapper parent pid to the CLI connector so a watchdog can clean up heartbeat/watcher helpers if the user directly closes the terminal window.
  - Supports `--prompt-file <path>` for Task Cabinet automation. The wrapper reads the prompt file with Node and appends the file contents as a single prompt argument. On Windows, Codex launches through the npm-installed `@openai/codex/bin/codex.js` with `node` and Claude Code launches by directly spawning `claude.exe`, so full `.md` prompts with spaces/newlines are passed as argv arguments without `cmd.exe` string re-parsing or the broken `codex -- <prompt>` form that made leading words look like subcommands.

- `scripts/aivatar-learning-worker.mjs`
  - Session-learning worker that can be run manually or spawned by Claude Code hooks and Codex rollout watchers. It accepts provider, agent, session, status, summary, optional `--context-file`, and optional `--avatar-state-file`, creates a sanitized digest prompt, calls a provider, normalizes the result, and posts a `phase: "session-learning"` status containing `learning`.
  - Supports `--provider claude-code`, `--provider codex`, and `--provider none`. Claude Code uses `claude --bare --print --output-format json --json-schema --tools "" --no-session-persistence`; Codex uses `codex.cmd exec` in read-only/no-approval/ephemeral mode with a JSON schema and stdin prompt; `none` uses local heuristic fallback for smoke tests.
  - Learning output is strict, bounded, and low sensitivity: short summary, 2-28 character idle bubble candidates, small trait changes, XP/confidence bounds, and privacy risk. Provider errors, invalid JSON, timeouts, missing Claude login, or unavailable Codex exec fall back to heuristic learning and must not break bridge status flow.
  - Reads `%TEMP%\aivatar-avatar-state.json` by default, or the path passed with `--avatar-state-file`, to tune bubble voice from the current avatar personality. The prompt includes trait totals, dominant trait, and secondary trait, but instructs providers not to mention trait names, levels, or point totals inside bubbles. The heuristic fallback also prepends a dominant-trait-specific phrase so tone changes remain visible when LLM providers are unavailable.
  - Sanitizes code blocks, inline code, URLs, Windows/Unix paths, email addresses, and common secret/token patterns before prompting providers. It does not modify source session/transcript files.
  - Detects Chinese text in the digest/summary. Chinese sessions instruct providers to generate natural Simplified Chinese idle bubble candidates. The heuristic fallback now repairs likely mojibake, parses sanitized `user:` / `assistant:` transcript snippets when available, and generates topic-aware pet phrases from the conversation instead of only returning generic fallback bubbles. For example, a Chinese discussion about a historically weighty date can produce candidates such as `今天有点重量`, `把这天记住`, `希望还在闪`, and `陪你想一会`.

- `scripts/claude-code-aivatar-hook.mjs`
  - Claude Code hook/statusLine bridge used by `claude:connected` and launcher-started Claude Code sessions.
  - Reads Claude Code hook JSON from stdin and posts generic `claude-code` status updates to the Aivatar bridge.
  - Maps `SessionStart` and empty statusLine updates to `idle`, `UserPromptSubmit` and response display events to `thinking`, `PreToolUse` to `executing`, `PostToolUse` / `PostToolBatch` back to `thinking`, permission prompts to `waiting_for_user`, `Stop` / `TaskCompleted` to `complete`, `StopFailure` / failed tools to `error`, and `SessionEnd` to `idle` unless a prior `complete`/`error` should be preserved.
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
- `event_msg` with `payload.type === "agent_message"` and `phase === "final"` or `phase === "final_answer"` -> `complete`, send token delta usage and clear baseline.
- `event_msg` with `payload.type === "agent_message"` and `phase === "commentary"` does not trigger `complete`, because commentary updates happen while a turn is still in progress.
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
POST http://127.0.0.1:38988/codex-status  legacy compatibility
GET  http://127.0.0.1:38988/codex-status   legacy compatibility
GET  http://127.0.0.1:38988/health
```

Status payload shape:

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
- Stale timeout defaults to 30 minutes and can be changed with `AIVATAR_SESSION_STALE_MS`.

Behavior mapping:

  - `idle`: autonomous life behavior. When truly idle with no action intent, stale navigation targets are reset to the avatar's current position so old interaction targets do not keep driving pathfinding.
- `thinking`: avatar goes to the desk/Terminal area for focused thought while the avatar thinking bubble shows the current agent summary.
- `executing`: avatar codes/works directly in front of the placed Terminal.
- `waiting_for_user`: avatar pauses and waits.
- `error`: avatar shows worried/error behavior.
- `complete`: avatar celebrates and earns bits.
  - If work boost is active, `complete` earns bonus bits.
  - Rewards only apply to `agent: "codex"` sessions that transition from an active state into `complete`, or to a fresh active/connected Codex `complete` event when the UI did not observe the earlier active state.
  - Active reward-eligible previous states are `thinking`, `executing`, `waiting_for_user`, and `error`.
  - If `usage.totalTokens` is present, token rewards use weighted tokens:
    - `weightedTokens = uncachedInputTokens + cachedInputTokens * 0.1 + outputTokens + reasoningOutputTokens`.
    - `bits = min(40, 4 + floor(weightedTokens / 1000))`, before any work boost bonus.
    - If usage is absent or invalid, the reward falls back to the fixed 4-bit base.

Per-turn status protocol:

- Active work should eventually be pushed to `complete`, `idle`, or `error` instead of being left in `thinking` or `executing`.
- Use `complete` when the task finished and should be eligible for Codex reward logic.
- Use `idle` when the agent is simply no longer doing work and should not trigger a reward.

Terminal notification rules:

- Terminal bubbles only show notifications from Codex sessions where `agent` is exactly `"codex"`.
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

- Tauri desktop app shell with always-on-top small window.
- Tauri desktop app attempts to auto-start the local status bridge at launch.
- React/Vite frontend.
- Dev preview and Tauri dev URL are unified on `http://localhost:1420/` to reduce save-state origin splits between `localhost` and `127.0.0.1`.
- Canvas-rendered pixel room.
- Bedroom, office, kitchen zones.
- Config-driven furniture.
- Content tagging and placement metadata:
  - `tags` identify furniture, items, hangings, consumables, windows, room surfaces, computer, coffee machine, table coffee storage, and related roles.
  - `placementSurfaces` identifies valid surfaces such as `floor`, `furnitureTop`, and `wall`.
  - Items can be valid on both floor and furniture tops; furniture is floor-only.
- Configurable wall/floor surfaces:
  - Honey Plank and Dark Plank floor palettes.
  - Checker Tile Floor with black/white tiled checker pattern, grout seams, clean tile faces, and highlights.
  - Polished Cement Floor with fine low-contrast cement grain, subtle flow marks, and gloss highlights.
  - Industrial Metal Floor with shaded metal plates, rivets, glossy plate highlights, and a top-to-bottom light-to-dark gradient.
  - Tatami Mat Floor with woven straw texture, softened straw shadow lines, and green binding.
  - Hermes Green Latex Wall, Honey Panel, and Dark Panel wall palettes.
  - Purple Bubble Wallpaper with larger, rounder bubble motifs and purple textured wall paint.
  - Pink Sakura Wallpaper with a pink base, denser stable pseudo-random blossoms, petals, and buds.
  - Warm Ivory Wallpaper with off-white paper texture, soft seams, and subtle fiber marks.
  - Wall/floor surfaces are managed in the right-side Decor panel rather than as backpack placement items.
- Configurable windows:
  - Cozy Window.
  - City Night Window with a dynamic pixel city skyline: smooth day/dusk/night/dawn sky colors, moving sun/moon, drifting clouds, building occlusion, warm evening lights, sparse deep-night lights, daylight window panes, and dusk/night red aircraft warning beacons.
  - Ocean Window with a wide sea view: real-time sky/ocean color changes, softened horizon, sunrise/sunset glow, moon at night, drifting clouds, breathing sparkle/reflection bands that follow the sun/moon, and three depth-scaled slow ships: modern cargo ship, cruise ship, and distant cargo ship. Ship lights appear at night/deep dusk.
  - Windows can be bought, applied, selected, moved on the wall, sold for half price, and saved.
- Current initial default room layout:
  - Uses City Night Window.
  - Bed, desk, fridge, and dining table are moved into the latest saved cozy layout.
  - Built-in Terminal is the locked placed item `builtin-terminal` on the desk.
  - Desk Lamp is placed on the desk by default.
  - Old saves with legacy `computer` furniture placement are migrated into the placed Terminal model.
- Customizable pixel octopus avatar with behavior-specific expressions and four-direction facing:
  - Front, back, left, and right views.
  - Movement updates facing direction.
  - Rest/relax interactions settle to front-facing behavior.
  - Work interactions can face the computer/desk and show a keyboard-tapping animation.
  - Consumable-specific poses are implemented for Coffee, Cola, and Bento while preserving the same base octopus silhouette and front/side identity.
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
- Consumables include Coffee, Bento, Repair Kit, and Cola.
  - Coffee triggers a cup-and-steam sip pose.
  - Cola triggers a red-can-and-straw drinking pose.
  - Bento triggers a lunch-box eating pose with food pixels and a small chewing motion.
- Table coffee storage:
  - The dining table stores coffee separately from inventory through `furnitureStorage`.
  - Table coffee capacity is visible and item-driven: each placed Coffee Cup on the dining table contributes one storage slot.
  - A filled Coffee Cup renders as a transparent glass cup with visible coffee volume, liquid surface, and slow dynamic rising steam; an empty Coffee Cup renders as pale transparent glass with an empty interior.
  - New/no-save sessions place one Coffee Cup on the dining table by default, so table storage starts as a visible `0/1` capacity.
  - Coffee Machine production fills table Coffee Cup storage first, then falls back to inventory capacity if all placed cups are full.
  - Table interactions consume stored table coffee before inventory consumables.
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
  - Implemented skins currently cover the base bed, desk, dining table, and fridge. Bed skins: Industrial Bed Skin, Wood Red Bed Skin, and Ivory Pink Plaid Bed Skin. Desk skins: Industrial Desk Skin and Rococo Ivory Desk Skin. Table skins: Rococo Ivory Table Skin and Dark Oak Table Skin. Fridge skins: Ivory Fridge Skin.
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
- Desktop/floor items:
  - Terminal Monitor exists as an item definition for the built-in Terminal but is no longer sold in the shop.
  - Desk Lamp, Tiny Plant, Coffee Cup, Switch-style Game Console, Coffee Machine, File Cabinet, Cozy Rug, and Morph Blob Rug are tagged as items.
  - Items can be placed on furniture tops or on the floor when their `placementSurfaces` allow it.
  - Floor rugs use a dedicated underlay render layer below all furniture, ordinary placed items, and the avatar.
  - Cozy Rug is now a doubled-size rainbow striped rug with woven fringe/texture, a light edge instead of a black outline, and a small soft shadow.
- Wall hangings:
  - Poster and Digital Wall Clock are wall-only Hangings shop items.
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
  - Table consumes stored table coffee first, then falls back to inventory food/drink.
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
  - Desk has a thick wood desktop, inset dark writing pad, left/right drawer stacks, center drawer, brass handles, small feet, and desk-leg placement rules.
  - Desk placement uses feet/legs rather than the whole visual body, allowing the desktop to overlap the wall while the legs remain on the floor.
- Retro CRT computer:
  - Terminal is rendered as a beige CRT-style placed item with blue screen and keyboard.
  - During coding/thinking proximity, the Terminal screen, cursor, scanline, and keyboard animate, and the avatar performs a tapping motion.
  - The built-in Terminal is independently movable in Room Edit Mode and can be placed on desk/table surfaces.
- Redesigned dining table:
  - Table is rendered as a wide reflective metal dining table close to desk width.
  - The tabletop has increased visual depth with thin metal edge highlights and subtle brushed reflections.
  - Table placement uses foot/leg bounds so the tabletop can overlap the wall while the legs remain on the floor.
  - Desktop items can be placed on either the desk or the dining table.
- Redesigned retro fridge:
  - Fridge is rendered as a green two-door retro appliance with dark outlines, deeper top clutter, handle details, scuffs/stickers, and feet.
  - Fridge can be moved against the wall using foot-based placement, allowing the body/top objects to overlap the wall while the base remains on the floor.
  - Feed interactions with the fridge animate the door opening, holding open, then closing, and reveal a cold interior with shelves and food pixels.
- Avatar head bubbles and simple progress bars for visible feedback.
- Debug is a collapsible side-panel menu for local status override, live mode, save reset, endpoint display, boost status, trait training, and visual QA controls.
  - Desktop builds include a Start bridge button backed by the Tauri `start_status_bridge` command.
  - Also displays table coffee storage as `current/capacity`.
  - Includes an Add supplies test button that grants bits, Coffee, Bento, Cola, and fills table coffee for recovery testing.
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
- Manual session-learning worker CLI with `npm.cmd run aivatar:learn`, `aivatar:learn:claude`, and `aivatar:learn:codex`. It can smoke-test UI learning with `--provider none`, test Claude Code provider output when Claude is logged in, or test Codex structured output with `codex.cmd exec`.
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
  - Life events such as sleeping, playing games, painting at the Oil Easel, using Coffee/Cola/Bento, brewing Coffee, and buying items add compact memory entries and small trait/preference changes.
  - Painting at the Oil Easel records a compact recovery memory event, restores mood slowly, and adds `creativity +1` on the throttled memory tick.
  - Growth traits are `focus`, `resilience`, `curiosity`, `efficiency`, `creativity`, and `warmth`.
  - Traits lightly affect autonomous behavior choices, visual themes, bubbles, and busy-recovery thresholds. Raw trait points are long-running counters; UI presentation uses normalized values rather than treating raw points as percentages.
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
- The current pixel art is still programmatic, but has received a first-pass unified pixel style and octopus avatar polish. It is not final spritesheet/atlas art.
- The Pixel Asset Editor is currently an authoring MVP only and its UI entry is locked/disabled. The component can draw, preview, animate, and save draft pixel assets locally, but edited assets are not yet used by `renderScene.ts` to replace avatar or furniture rendering.
- Pixel Asset Editor drafts are localStorage-origin scoped under `aivatar.assetEditor.v1`, just like other browser-local development state.
- The current virtual scene size is `480 x 320`; editor room-reference overlays use the same coordinate system as Canvas hit testing and placement.
- Recent furniture and placed item art is still programmatic canvas drawing, but the bed, desk, placed Terminal, dining table, fridge, and File Cabinet have been iterated toward a cozy retro/Stardew-like style.
- The File Cabinet is now config/shop content and is buyable at Growth level 25. It is unique, sellable, and removable; while inventory/save ownership is represented through `placedItems`, the runtime room converts a placed cabinet into `room.furniture` so it uses the same rendering, click hit testing, movement, collision, and avatar occlusion logic as base furniture.
- Task Cabinet is now a real local MVP rather than debug-only. It maintains a local task list of `.md` paths in `localStorage` key `aivatar.taskCabinet.v1`, reads source `.md` files only through the Tauri task-launch command, and never writes back to the original `.md` files.
- Task Cabinet automation launches Codex/Claude through the same connected wrapper used by the CLI Launcher, with the task prompt passed through a derived `%TEMP%\aivatar-task-prompts\*.md` file and `--prompt-file`. Status still depends on external Codex/Claude CLI behavior and bridge/wrapper session updates, but the app now ignores startup/presence idle placeholders, remembers same-session terminal status, and preserves `complete`/`error` through late Claude `Notification`, `SessionEnd`, statusLine, or disconnect cleanup events.
- Task Cabinet launch now has a visual file workflow: the avatar fetches a paper from the File Cabinet, carries it to the Terminal, and reads/executes there. The flow intentionally masks high-priority agent status during the brief fetch/carry/read handoff and lets very fast tasks finish visually before releasing back to ordinary status-driven behavior.
- File Cabinet visible papers now reflect real Task Cabinet state: `Ready + Failed` tasks appear in the cabinet, failed papers show a red `X`, running tasks are visually treated as taken out, and completed tasks disappear. Removing a task from Aivatar removes it only from localStorage and never deletes the source `.md`.
- Development saves remain browser-origin scoped. Saves from `http://127.0.0.1:1420/` do not automatically migrate to `http://localhost:1420/`.
- UI theme preference is also browser-origin scoped under `aivatar.uiTheme.v1`. A Terminal skin choice made at `http://127.0.0.1:1421/` will not automatically apply to `http://localhost:1420/`. Task Cabinet cards, schedules, buttons, paths, and status text now have explicit Terminal and Amber overrides, but the skin system is still selector-based rather than token-driven.
- Runtime save state can preserve old inventory/stats even after config changes. For testing fresh config, clear `localStorage` key `aivatar.save.v1`.
- Runtime save state includes `layoutVersion`, `avatarId`, `avatarName`, `avatarRuntime`, `memory`, `navMemory`, `petStats`, `inventory`, `placedItems`, `wallet`, `purchasedItemIds`, `activeFurnitureSkinIds`, `furnitureStorage`, `workBoostUntil`, `activeWindowId`, `wallSurfaceId`, `floorSurfaceId`, `windowPlacements`, and `furniturePlacements`. `avatarId` is generated for new saves and normalized into older saves; `navMemory` is normalized for older saves. File Cabinet ownership/placement is saved in `placedItems`, then converted into runtime furniture during content assembly.
- Default new saves start with too few bits to buy most furniture skins. Use an existing save with enough bits or Debug/Add supplies before testing the purchase and apply flow.
- Memory/Growth v1 stores local lightweight state and still does not store full chat transcripts or use a vector database. It can now consume optional session-learning payloads produced by `scripts/aivatar-learning-worker.mjs`, which may call Codex or Claude Code on a sanitized digest and then stores only bounded summaries, candidate bubbles, XP, and trait deltas.
- Navigation-learning v1 is local and lightweight: idle exploration and ordinary movement write visited cells, learned `walkableCells`, successes, failures, and latest exploration time into `navMemory`. `walkableCells` stores `0` for learned walkable and `1` for learned blocked/risky cells, scoped by `layoutFingerprint`. Ordinary A* avoids cells marked `1`; `explore` can ignore learned blocked values to retest cells after layout changes or previous false negatives. Older `trickySpots` remain in the save schema for compatibility but no longer drive route-cost penalties.
- Session-derived idle bubble suggestions are generated by local rules from Codex watcher user/final-agent messages and by Claude Code session-learning from sanitized transcript digests. The Codex watcher currently uses a bilingual theme/template approach, including a `daily` life category, so suggestions feel more like pet thoughts than transcript snippets. Claude Code learning digests include low-sensitivity `user:` / `assistant:` snippets and can produce topic-aware heuristic bubbles when the LLM provider is unavailable. Suggestions are not automatically used: users must add them in the Growth panel, and saved phrase slots are capped by avatar level. The bridge preserves existing suggestions across same-session status updates that omit candidates.
- LLM-derived idle bubble suggestions are generated from sanitized session-learning digests. They are displayed in Growth with an `LLM` badge/highlight when `learning.source === "llm"`. Non-LLM session candidates display source badges (`CC` for Claude Code, `Codex` for Codex). Chinese digests are instructed to produce natural Simplified Chinese candidates; heuristic fallback can also generate topic-aware Chinese candidates for Chinese sessions. If LLM candidates do not appear, first check whether the provider is logged in/available and whether the bridge snapshot contains `learning.source`.
- LLM and heuristic learning bubbles are now trait-aware when `%TEMP%\aivatar-avatar-state.json` is fresh. Dominant and secondary traits guide voice without exposing trait names or point totals in the bubble text. If trait-aware tone does not appear, first check that the desktop app has posted `/avatar-state`, the bridge is the updated process, and the worker was launched with the current avatar state file.
- Growth also generates memory-derived idle bubble suggestions locally from current traits, recent memory events, and favorite recovery/activity preferences. The Growth panel aims for 3 memory-derived and 3 session-derived visible candidates, with fallback fill if one source has too few candidates.
- The idle bubble suggestion and session-learning pipelines require the updated bridge and watcher/hook processes to be running. Existing old `scripts/codex-status-bridge.mjs`, `aivatar-watch.mjs`, or Claude hook processes may drop or omit `idleBubbleCandidates` or `learning` until the bridge is restarted, the desktop app is restarted, and connected sessions are relaunched.
- Session/discovery fixes from the June 4, 2026 merge regression require both `status:bridge` and `status:discover` to be restarted. A stale already-running bridge/discovery pair can continue showing old behavior even after code has been patched.
- Growth traits affect visuals and small behavior probabilities, but they are not yet a full personality/strategy engine. The Growth hex chart is a normalized `log10(points + 1)` visualization of raw trait points capped at `1_000_000`; it should not be treated as the underlying trait storage.
- Wall/floor surface shop entries are Decor panel options, not backpack items. Older test saves may still contain surface ids in `inventory`; the UI filters those entries out while preserving `purchasedItemIds` so they remain available in the Decor panel.
- Window shop entries are also not backpack items. Their purchase state is stored in `purchasedItemIds`, active selection is stored in `activeWindowId`, and per-window placement is stored in `windowPlacements`. Selling a selected window removes its purchased state and placement and falls back to another available window.
- `aivatar.defaultLayout.v1` stores the default layout used for new/no-save sessions and Room Edit `Reset default`.
- Existing saves with `layoutVersion: 2` restore the user's last saved layout on restart. Missing-version saves migrate once to the current default layout while preserving non-layout data.
- Store in Room Edit Mode returns an item to inventory but does not refund bits.
- Placement/editing MVP now has visual-bound hit testing, ground-projection-based bed/desk/table/fridge/file-cabinet placement, floor-item overlap checks based on ground projections, item placement on floor, wall, or desk/table surfaces, locked built-in Terminal placed item migration, basic furniture collision and movement, buyable File Cabinet runtime furniture conversion, File Cabinet footprint-based placement overlap, and special rug-underlay overlap behavior. It still needs stronger snapping, placement previews, and special-case QA across all non-rug room objects.
- Desktop/floor item placement includes placeable items. The built-in Terminal has been migrated to `placedItems`, but save migration still preserves legacy `computer` furniture placement when encountered.
- Fridge open/hold/close behavior is still a programmatic canvas animation rather than a sprite/atlas animation.
- Digital Wall Clock, transparent glass Coffee Cup with slow animated steam, Cozy Rug, Morph Blob Rug, Switch-style Game Console, Coffee Machine, Oil Easel, File Cabinet, dynamic City Night Window, Ocean Window, Purple Bubble Wallpaper, Exposed Red Brick Wallpaper, Pink Sakura Wallpaper, Warm Ivory Wallpaper, Checker Tile Floor, Polished Cement Floor, Industrial Metal Floor, Tatami Mat Floor, and recent fridge/coffee-machine/file-cabinet/easel art are still programmatic canvas assets rather than spritesheet/atlas assets.
- Coffee, Cola, Bento, paint, phone idle, and task-file fetch/carry/read poses are still programmatic canvas overlays rather than spritesheet/atlas animations. The phone pose uses a thinner handset; front-facing avatar poses show the phone back toward the viewer, while side-facing poses show the glowing screen. The Task Cabinet fetch/carry/read workflow still needs visual QA for path smoothness, timing, occlusion near the File Cabinet and Terminal, and behavior when a task completes before the avatar reaches the Terminal.
- Shop, inventory, and Decor surface thumbnails are CSS/DOM previews rather than shared runtime sprite assets. They are intentionally lightweight UI affordances and can drift from canvas art until the asset pipeline is unified.
- The Terminal skin is currently a CSS/canvas theme layer rather than a full design-token system. New UI components need explicit Terminal-theme QA so Classic-only colors do not leak into expanded panels, custom progress bars, disabled states, or canvas overlays.
- ASCII text inside status/session bubbles uses a pixel-font renderer with matching measurement/draw widths to reduce overflow. CJK fallback now uses a Chinese UI font stack and is clearer than the old monospace fallback, but arbitrary non-ASCII text is still rendered inside the low-resolution canvas and can look softer than DOM text when scaled.
- Side-panel collapse/expand depends on Tauri desktop window resizing in the desktop app. Web-only previews keep the React layout behavior but cannot resize the native window.
- The side-panel collapse flow preserves the room's left edge and locks the scene panel width while resizing. In collapsed mode, top-left stats, top-right growth summary, and bottom context HUD overlays stay borderless over the room. If future flicker returns, inspect native window position/size behavior before adding more CSS animation.
- Existing saves may preserve older furniture positions, purchased state, inventory, or placed File Cabinet state after config or art changes; clear `aivatar.save.v1` for a fully fresh layout and Growth/shop test.
- Existing saves may also preserve furniture skin purchase/application state. If a furniture skin does not appear, verify that the active preview port points to the intended worktree and that the save at that origin has purchased and applied the skin. If the default furniture should be restored, clear the applied skin from the Furniture Skins shop rather than editing save data manually.
- Game Console mood recovery is intentionally slow, does not produce bits, and now ticks while the avatar is actively playing near the placed Game Console using a near-active-play-target check rather than relying only on recalculated exact standpoints. Game Console play-screen animation uses the same targeted/near-active logic so autonomous play visually activates the correct console.
- Oil Easel painting mood recovery is also intentionally slow and runs as a longer autonomous activity rather than a quick mood refill.
- Oil Easel painting is intentionally a mood/creativity recovery activity and does not produce bits. The easel is categorized in the Furniture shop tab through `tags: ["furniture", "easel"]`, but remains `kind: "decor"` so it uses placed-item rendering/placement rather than File Cabinet's runtime-furniture conversion path.
- Oil Easel currently has visual/click/placement bounds, participates in floor-item ground-projection placement overlap checks, and contributes its foot-level projection to navigation collision. Broader placed-item collision is still intentionally narrow; other placed objects such as rugs, tabletop items, and wall hangings remain non-blocking unless future behavior needs them.
  - Coffee Machine brewing is now a small economy sink: manual and autonomous brewing each cost `1 bit` and only complete after the avatar reaches the placed Coffee Machine; broader bits balancing is deferred until closer to 1.0. Autonomous brewing is intentionally cooldown-gated so repeated brew animations do not dominate idle life.
- Bed collision was intentionally removed so the avatar can move naturally around the wall-aligned bed.
- High-priority agent states still block right-click context-menu interaction actions: `thinking`, `executing`, `waiting_for_user`, and `error`. Left-click selection remains available for inspection/editing.
- `thinking` intentionally does not trigger busy recovery, so focused thought remains visually clear even when stats are low. Busy recovery still applies to other high-priority states when resources are available.
- High-priority stale sessions stop blocking interactions after the configured bridge stale timeout.
- A connected stale active session can remain visibly linked in the Agent Sessions panel, but stale statuses do not keep driving `currentStatus` merely because presence remains fresh.
- Complete rewards apply to connected `agent: "codex"` and `agent: "claude-code"` sessions when they transition from an active state into `complete`, or when a fresh active/connected `complete` snapshot is first observed.
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
- Interactive Codex/Claude TUI automatic waiting detection is still limited to available event sources. Codex Desktop uses rollout watching; launcher-started Claude Code uses hook/statusLine injection with exec-form hooks, a PowerShell statusLine wrapper, and transcript usage fallback. The generic bridge still supports external status posts for smoke tests and older clients.
- Current Codex Desktop conversations can be discovered automatically by Aivatar when the desktop app or `status:discover` is running. The local Aivatar session plugin remains useful for explicitly following/activating a specific session, reconnecting a session, or manual recovery. Explicit status posts remain useful for smoke tests and older clients. For command lifecycle tracking, use `codex:run`, `claude:run`, or `agent:run`; for smoother launcher/CLI flow, use the desktop CLI Launcher, `codex:connected`, or `claude:connected`.
- Discovery can still reconnect any rollout touched within the active window, which defaults to `AIVATAR_SESSION_STALE_MS` (30 minutes). If old sessions unexpectedly reappear, check whether `status:discover` is running, whether `AIVATAR_DISCOVERY_ACTIVE_MS` has been overridden, and whether helper records under `%TEMP%\aivatar-session-discovery\helpers` are restarting old heartbeat/watch processes.
- Current discovery freshness still uses rollout file `mtime`. If an older rollout file is touched recently, discovery can treat it as active even when its last real event is older. Future hardening should parse the latest rollout event timestamp and prefer that over filesystem `mtime`.
- Disconnect safety now covers three sources: manual plugin pid files under `%TEMP%\aivatar-session-bridge`, repo-local CLI pid files under `%TEMP%\aivatar-cli-session`, and auto-discovery helper pid files under `%TEMP%\aivatar-session-discovery\helpers`.
- Chat/session safety depends on keeping the Aivatar integration read-oriented toward Codex data. Scripts may read rollout JSONL, inspect `thread/list`, and clear Aivatar bridge state, but should not remove or rewrite Codex session files or Desktop chat metadata.
- If Codex chats appear to disappear, preserve the current `%TEMP%` Aivatar recovery logs, check whether old `aivatar-connect`/watcher/heartbeat processes are still running, verify which plugin command directory is first on PATH, and confirm whether the action used `codex resume <session-id>` or explicit `--new-session`.
- If automatic Codex session discovery does not show a session, check `%TEMP%\aivatar-session-discovery\discovery.json`, `%TEMP%\aivatar-session-discovery\helpers\*.json`, whether `CODEX_HOME\sessions` contains a recent rollout JSONL with `session_meta`, whether the external plugin path exists, and whether the bridge is reachable on `127.0.0.1:38988`.
- If a desktop CLI Launcher Codex session does not stream real-time updates, first check whether a new rollout JSONL was created under `.codex\sessions` and whether `aivatar-connected-run.mjs` switched from the provisional session to that real Codex session id.
- If a Launcher-started session remains connected after the CLI window is closed, check `%TEMP%\aivatar-cli-session\*.json` and the recorded heartbeat/watcher/watchdog pids before changing bridge priority logic.
- Current git state may show the whole repository as untracked in this workspace, so `git diff`/`git diff --stat` can be empty even after file edits. Use targeted file reads or `rg` to verify edits when needed.
- If a browser preview does not show recent worktree changes, check which checkout owns the port. In the current workflow, the OneDrive checkout may own `localhost:1420`; other worktrees may own `1421`, `1422`, or `1423`; this worktree's current preview has used `http://127.0.0.1:1424/`.
- Save state is written on every confirmed state change and flushed on page hide/unload and Tauri close. In-progress placement or movement previews are UI-only and are not saved until the item, furniture, or window move is confirmed.
- The local Aivatar session plugin currently lives under `C:\Users\rniu\plugins\aivatar-session-bridge` rather than inside this repo. The repo now documents and wraps the plugin workflow; future work should decide whether to vendor the plugin source.
- The current session plugin connection uses explicit connect/disconnect, presence-only heartbeat, and the rollout watcher for real-time Codex Desktop turn tracking.
- Multiple worktree sessions can stay connected simultaneously. If one session stops showing context, first check whether its watcher is still running, whether the rollout JSONL contains `token_count` events, and whether the bridge preserved the last `usage` payload after final status updates.
- `furnitureStorage` currently only implements dining-table coffee storage; its capacity is derived from Coffee Cups placed on the dining table.
- Project is under OneDrive; Rust builds should use `$env:CARGO_TARGET_DIR = "$env:TEMP\aivatar-cargo-target"` to avoid target directory write issues.
- Avoid `cmd.exe` `set CARGO_TARGET_DIR=... && ...` with a trailing space before `&&`; it can create a bad path such as `aivatar-cargo-target `.
- `src-tauri/icons/icon.ico` is a simple placeholder icon required by Tauri.
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

## Merge / Worktree Safety

To reduce semantic regressions from parallel worktrees:

- Keep changes to central lifecycle files small and isolated. In this project, `scripts/codex-status-bridge.mjs`, `scripts/codex-session-discovery.mjs`, `scripts/aivatar-connected-run.mjs`, `src/App.tsx`, and `AGENTS.md` are high-conflict files.
- Before starting or finishing work in a worktree, update from `main` with `git fetch` plus either `git merge main` or `git rebase main`, depending on the branch workflow.
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

1. Continue regression-testing Codex chat/session safety with `codex resume <session-id>`, explicit `--new-session`, automatic discovery, the desktop CLI Launcher, disconnect cleanup, 30-minute expiry behavior, stale-process cleanup, PATH/plugin shadowing checks, recovery-log inspection, and bridge/discovery restart behavior after code changes.
2. Harden automatic Codex Desktop session discovery by replacing rollout `mtime` freshness with parsed latest-event timestamps, then validate that only genuinely recent/active sessions remain connected and stale helper heartbeat/watch processes are stopped and tombstoned. Also validate the real-time rollout watcher over ordinary chat turns, especially multiple projects/worktrees, app restart, already-running bridge, repeated `final_answer` events, token-based rewards, context-window updates, and the session-inspired idle bubble candidate flow.
3. Add focused tests or smoke scripts for session discovery regressions: 30-minute default active window, explicit `AIVATAR_DISCOVERY_ACTIVE_MS` override, disconnect tombstone persistence across bridge restart, discovery helper cleanup calling `/agent-sessions/disconnect`, and stale helper pid records not resurrecting old sessions.
4. After the watcher and session-safety flow prove stable, decide whether to vendor `C:\Users\rniu\plugins\aivatar-session-bridge` into this repo now that the workflow is documented and wrapped by npm scripts.
5. Validate and polish the desktop CLI Launcher connected path over real Codex and Claude Code CLI turns, including provisional-to-real Codex session switching, Claude exec-form hook events, Claude PowerShell statusLine wrapper behavior, watchdog cleanup when users close terminal windows, repeated launcher starts, stale pid cleanup, token/context usage, reward baselines, automatic `AIVATAR_LEARNING_*` environment injection, session-learning worker startup, and Agent Sessions display behavior.
6. Continue expanding and QA'ing the furniture skin system, especially File Cabinet skins and regression coverage for existing bed, desk, table, and fridge skins. Keep skins visual-only unless a future skin explicitly changes dimensions/collision. Add screenshot/runtime QA for Furniture Skins: shop category visibility, purchased/apply/clear states, `activeFurnitureSkinIds` save/load, default furniture fallback, Industrial Bed Skin, Wood Red Bed Skin, Ivory Pink Plaid Bed Skin and sleep blanket overlay, Industrial Desk Skin including table-leg perspective and black-cat shadow silhouette, Rococo Ivory Desk Skin, Rococo Ivory Table Skin with iris motifs, Dark Oak Table Skin, and Ivory Fridge Skin including open-door animation.
7. Visually QA the recent Ocean Window, Growth, Oil Easel, Exposed Red Brick Wallpaper, bed layering, table collision, and exploration-learning changes in the running app: slow subpixel ship movement, distant ship scale, night ship lights, breathing wave sparkles, softened horizon, Coffee Cup slow steam, Growth hex chart hover/log-scale normalization behavior, Oil Easel scale/perspective, avatar beret/brush/palette paint pose, easel foot-collision avoidance, red brick wall scale/mortar/baseboard texture, bed body/footboard occlusion, dedicated `admire` pose readability, and idle `explore` route collection.
8. Add focused UI/runtime tests or screenshot regression checks for sleep recovery, token-based complete rewards, context window meters, Memory/Growth updates, `session_learning` memory events, LLM-highlighted idle bubble candidates, `CC`/`Codex` source-badged idle bubble candidates, Chinese/English learning candidate language filtering, heuristic fallback transcript parsing, `phase: "session-learning"` not granting duplicate rewards, `navMemory` save/load normalization, Growth hex chart `log10(points + 1)` normalization and hover labels, whole-side-panel collapse/expand and Tauri window resize behavior, collapsed HUD overlay positioning, Agent Sessions mini context meter, Growth/Agent Sessions/Debug submenu collapse/expand behavior, Terminal skin coverage across collapsed/expanded cards and canvas bubbles, idle bubble language filtering, memory/session suggestion balance, accepted phrase display, trait-driven avatar visuals, the `Demo actions` behavior cycle, placement, Room Edit, shop/inventory/Decor/window thumbnails, collision and interaction-point overlays, autonomous activity, idle exploration, agent status, work/fridge/table/coffee/cola/bento/paint/phone animation flows, unified arrive-then-interact behavior for furniture/placed items/consumables, autonomous and manual Coffee Machine brew animation, transparent Coffee Cup empty/full rendering, Game Console play-screen animation and mood recovery, Oil Easel painting and creativity growth, dynamic City Night Window and Ocean Window day/night preview states, Digital Wall Clock rendering, Decor panel collapse/tabs, and rug-underlay layering.
9. Continue hardening avatar pathfinding after the `walkableCells` core pass, especially with the Debug `Nav grid` overlay around bed/desk/fridge/table choke points, learned blocked-cell false positives, exploration retesting, post-arrival desktop-item stability around the Terminal/desk/tabletop Coffee Machine, target-object locking when multiple Coffee Machines/Game Consoles/Oil Easels exist, navigation-cache scoping by layout/target/furniture-ignore fingerprint, and regression cases around dense bed/desk/table/fridge/Coffee Machine/Game Console/Oil Easel layouts. Re-test final-target stall abandonment: stalled arrival-gated actions should try another interaction point, then fail/clear after repeated stalls instead of sliding or planning forever. Re-check the bottom floor strip after the navigation max-Y expansion, Terminal single-front-point behavior, and Coffee Machine front-only tabletop standpoints across multiple table/desk placements.
10. Polish busy recovery UX with clearer recovery-source feedback, no-supply warnings, and balanced depletion/recovery rates.
11. Expand Memory/Growth beyond v1 with richer milestones, preference-driven behavior, memory reset/export controls, better UI explanations for how traits are learned, and user controls for LLM learning scope/provider/fallback behavior.
12. Expand navigation-grid tooling with learned `walkableCells` visualization, manual reset/decay controls, partial recomputation after furniture/item placement changes, and clearer QA diagnostics for why a cell is treated as blocked.
13. Add robust overlap prevention and snapping for non-rug floor items, furniture-top items, wall items, windows, moved base furniture, and the locked built-in Terminal, while preserving intentional underlay rug overlap behavior.
14. Continue Agent Sessions UX polish with filtering, pinning, expiry/stale-clear feedback, context/reward usage explanations, multi-worktree connection diagnostics, and clearer priority controls for `currentStatus`.
15. Continue refining the UI skin system toward reusable theme tokens so future panels inherit Classic/Terminal/Amber colors without one-off selector patches.
16. Finish the unified content model for furniture, items, hangings, consumables, windows, wall surfaces, and floor surfaces.
17. Add a simple layering editor so wall-overlap furniture, desktop objects, non-rug floor items, rugs, avatar occlusion, and open furniture doors can be controlled predictably beyond the current fixed rug-underlay layer.
18. Polish table coffee storage UX, including explicit deposit/withdraw actions, clearer coffee source feedback, better feedback when brewing cannot afford the `1 bit` cost, and clearer guidance that Coffee Cups placed on the dining table define storage capacity.
19. Continue hardening the unified world-interaction flow so future furniture, placed items, and consumables automatically follow the intended sequence: avatar decides an action, walks to the relevant item/furniture, starts the item/avatar animation only after arrival, then applies the effect when the action completes.
20. Improve surface placement rules for desk/table items, including overlap checks and clearer visual previews for valid tabletop positions.
21. Create a small unified furniture/item/consumable interaction animation model instead of handling door/opening/progress/Terminal/Coffee/Cola/Bento animation as one-off render conditions.
22. Expand save-state versioning beyond the current layout migration so old `localStorage` layouts can adapt to new furniture dimensions, content tags, memory fields, storage fields, and origin changes more robustly.
23. Add stronger delete/sell/rotation confirmation and polish in Room Edit Mode.
24. Polish the Decor panel with clearer purchased/unpurchased thumbnail states, more wall/floor surface content, and screenshot checks for Purple Bubble Wallpaper, Exposed Red Brick Wallpaper, and Checker Tile Floor.
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
