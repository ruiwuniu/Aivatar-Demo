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
verification. Claude Code currently gets launcher lifecycle/heartbeat
connection; fine-grained watcher/token usage still needs a Claude-specific
source or hook.

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
|   |-- aivatar-run.mjs
|   |-- aivatar-session-plugin.mjs
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
  - When furniture or placed items are selected, the canvas shows their generated interaction standpoints and a light gray ground-projection rectangle for the selected furniture/floor item, so movement/arrival targets, placement footprints, and navigation-blocking collision can be visually tuned together. Wall hangings keep their visual selection bounds but do not show a ground projection.
  - Surface items tagged `wall-surface` or `floor-surface` are managed through the Decor panel rather than the backpack: users can buy, apply, and clear applied wallpaper/flooring without entering placement mode. First purchase-and-apply costs `item.price + 1000 bits`; applying an already purchased wallpaper/flooring option costs `1000 bits`; clearing an applied surface is currently free.
  - Window shop items are managed through `purchasedItemIds` and `activeWindowId` rather than backpack inventory: buying a window applies it immediately, purchased windows can be re-applied from the shop without spending bits again, and selected windows can be sold for half price from the window edit panel. Clicking empty room space clears selected/moving window state and window placement previews.
  - The Decor panel is collapsed behind a high-contrast `Decor` button by default. Expanding it reveals a secondary wall/floor tab menu for wallpaper and flooring options. Wall/floor option buttons now use centered pattern thumbnails only; full surface names remain available through hover titles and aria labels.
  - Inventory and shop item buttons use compact pixel thumbnails for visible item identity, with names preserved in hover titles and aria labels. Shop buttons show thumbnail plus price, while inventory buttons show thumbnail plus quantity.
  - Window shop buttons keep showing their price in the visible button label even after purchase/re-apply state, so purchased window options do not replace the price text with `ready`.
  - Stores table coffee in `furnitureStorage` and shows the current table coffee count/capacity in the Debug panel.
  - Table coffee capacity is now driven by placed `coffee-cup` items on the dining table: each table Coffee Cup contributes one visible storage slot, and table coffee is clamped when cups are moved, stored, sold, or deleted.
  - Migrates and preserves the built-in Terminal as locked placed item `builtin-terminal`.
  - Prevents the built-in Terminal from being stored, sold, or deleted; it can still be moved in Room Edit Mode.
  - Left-clicking furniture or placed items now selects them only. Avatar-triggering actions such as Terminal `Interact`, Coffee Machine `Brew`, Game Console `Play`, Oil Easel `Paint`, and furniture interactions are launched from a right-click scene context menu, preventing accidental interactions during layout editing/inspection.
  - The built-in Terminal is interacted with from the right-click context menu, routes through the queued placed-item interaction flow before entering the local coding animation, and no longer grants bits or work boost directly.
  - Consumes bridge snapshots with `currentStatus`, `sessions[]`, `activeSessionKey`, `connectedSessionKey`, and `currentSessionKey`; the main avatar follows `currentStatus`, while the side panel shows recent sessions, Follow/Clear controls, and Active/Connected/Current/Idle/Stale markers.
  - Agent Sessions is collapsed behind a compact side-panel button by default. The button shows live/total session count, Current/source context, and a `+`/`-` affordance; expanding it reveals Follow/Clear controls, CLI hints, session cards, context window meters, reward summaries, and Active/Connected/Current/Idle/Stale markers.
  - Agent Sessions includes a `Clear Stale` button that calls the bridge to manually remove stale session history while preserving the current followed/active session.
  - Complete rewards are transition-gated for `agent: "codex"` sessions moving from `thinking`, `executing`, `waiting_for_user`, or `error` into `complete`, and also tolerate a fresh active/connected `complete` snapshot so rewards are not missed when the first UI-visible status is already complete. Repeated Live reads of the same complete event do not reward again.
  - Complete rewards can use token usage from the status payload. When usage is present, bits are based on weighted tokens: uncached input, output, and reasoning tokens count fully, cached input counts at 10%, and the reward is capped at 40 bits before any work boost bonus. Without usage, rewards fall back to the fixed 4-bit base.
  - Codex `complete`, `error`, and `waiting_for_user` statuses now update lightweight memory/growth state, including XP, recent memory events, and trait changes.
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
  - Real avatar interactions now follow a unified "arrive first, then interact" flow for furniture, placed items, and backpack consumables. Coffee Machine brewing, Game Console play, Oil Easel painting, and consumable effects are queued as world interactions and only apply after the avatar reaches the target. Room editing, ordinary left-click selection, right-click context menu opening, and Decor surface/window application remain immediate UI operations.
  - Pending world interactions can temporarily ignore the target furniture collision while the avatar walks to the interaction target. For placed items on `desk` or `table` surfaces, the movement pass ignores the surface furniture collision during the queued approach so the avatar is not pushed away by the table/desk while trying to interact.
  - Interaction arrival checks now treat the avatar's small ground-footprint rectangle as arrived when it touches an interaction standpoint, with the previous center-distance check retained as a fallback. This keeps the avatar from pushing endlessly into furniture edges once its visible foot box has reached the target marker.
  - Game Console play sets the avatar facing toward the placed console after arrival instead of forcing a generic front-facing pose. Mood recovery now uses a near-active-play-target check so recovery can tick while the avatar is actively playing near the placed Game Console even if recalculated interaction standpoints differ slightly.
  - When multiple placed copies of the same autonomous interactive item exist, automatic target selection uses a `70%` nearest / `30%` random rule. This currently covers Game Console play, Coffee Machine brewing, Oil Easel painting, Terminal/coding targets, and busy-recovery Game Console selection. Manual right-click interactions still use the exact clicked object.
  - Oil Easel is a buyable Furniture-category placed object implemented as `kind: "decor"` with `tags: ["furniture", "easel"]`. Right-clicking it opens a context action that queues an arrive-then-`paint` interaction; painting restores mood over time and records compact memory with `creativity +1`.
  - Idle/autonomous life can choose an `explore` behavior when stats are healthy. Exploration walks toward sampled room/object-near targets, records visited nav-grid cells, tracks success/failure, and stores tricky spots in `navMemory`.
  - Navigation learning now also records all real non-idle/non-explore movement: traversed cells, stuck/failure cells, and successful arrivals for ordinary movement, pending world interactions, snack targets, and autonomous brewing. Learned `navMemory` influences local action scoring for `sidestep-left`, `sidestep-right`, `backoff`, `force-replan`, and `switch-interaction-point`. Per-cell counters are capped at `9999`, and ordinary movement recording is throttled to reduce `localStorage` churn.
  - Growth is now collapsed behind a compact side-panel button by default. The button shows `Growth`, current level, XP progress, and a `+`/`-` affordance; expanding it reveals a six-axis personality hex chart, recent memory, and idle bubble controls.
  - Growth traits are now six-dimensional: `focus`, `resilience`, `curiosity`, `efficiency`, `creativity`, and `warmth`. Raw trait points are capped at `1_000_000` per axis, while the enlarged, centered hex chart uses `log10(points + 1)` normalized against that cap for display; hovering the small hex node at each chart corner shows that trait name and raw point count in a larger center label.
  - Growth idle bubble controls show saved phrases, session-derived suggestions, memory-derived suggestions, and a language preference (`auto`, `zh`, `en`, `mixed`). Users can add suggested short phrases into `memory.preferences.idleBubblePhrases`, with saved phrase slots capped by the current avatar level, and can remove saved phrases from the same panel.
  - Idle bubble suggestions shown in Growth use an explicit source mix: target 3 memory-derived candidates and 3 session-derived candidates, with either source filling remaining slots when the other has fewer available candidates.
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
  - Task Cabinet maps bridge sessions back to tasks by `agent + sessionId`: `complete` marks a running task `Completed`, `error` marks it `Failed`, and an `idle` disconnect without completion marks it failed with `Agent exited before reporting completion.`
  - Task Cabinet has desktop Browse buttons for selecting `.md` task files and the CLI Launcher folder through Tauri commands, avoiding manual path entry.
  - Task Cabinet entries are capped at 100 saved task paths to keep `aivatar.taskCabinet.v1` bounded.
  - Task Cabinet `Profile` currently supports `Default` and `Fast`. `Fast` appends `--bare` for Claude Code. Codex `Fast` is a reserved UI entry until a verified MCP-skip flag is available, so it does not pass unknown Codex CLI flags.
  - Debug is collapsed behind a compact side-panel button by default. The button shows `Debug`, the current source, Live/Override state, and a `+`/`-` affordance; expanding it reveals local status overrides, trait training, Tauri-only Start bridge, Add supplies, Demo actions, Window preview, Save layout, Clear save, bridge endpoint, boost status, and table coffee storage.
  - Debug controls include a Tauri-only Start bridge button, an Add supplies test button that grants bits/Coffee/Bento/Cola and fills currently available table Coffee Cup storage for recovery testing, six trait training buttons, and a `Demo actions` behavior cycle for inspecting every avatar behavior state, including the idle-only phone animation and task-file fetch/carry/read poses.
  - `Window preview` accelerates the room window's time input so dynamic windows such as City Night Window and Ocean Window can be visually checked across a full day/night cycle without changing the system clock.
  - When a Debug status override is active, the status card shows `Debug override active - click Live` and the Live button is highlighted so test overrides are not mistaken for live agent state.

- `src/types.ts`
  - Defines runtime status, content, save-state, placement, inventory, furniture, room surface/window, pixel asset types, and avatar behavior names including the local-only `phone` idle animation behavior, the idle-learning `explore` behavior, the Oil Easel `paint` behavior, and task-file visual behaviors (`fetch_task_file`, `carry_task_file`, `read_task_file`).
  - `RoomWindowDefinition.kind` currently supports `cozy-window`, `city-night-window`, and `ocean-window`.
  - Includes the `file-cabinet` content tag used by the buyable unique File Cabinet furniture/task-cabinet visual MVP, plus the `easel` tag used by the Oil Easel placed-object painting interaction.
  - Defines Task Cabinet task metadata types: `TaskCabinetStatus` and `TaskCabinetEntry`. Task entries store the source `.md` path and execution metadata such as status, agent, cwd, session id, timestamps, and error text, but not the `.md` file content.
  - Defines lightweight Memory & Growth types: `AivatarMemory`, `AivatarGrowth`, six-axis `AivatarGrowthTraits`, `AivatarMemoryEvent`, `AivatarPreferences`, and `AivatarMilestone`.
  - Defines `AivatarNavMemory`, which stores exploration/navigation-learning counters: visited nav cells, tricky spots, success/failure counts, and the latest exploration timestamp.
  - `CodexStatusMessage` can carry optional `idleBubbleCandidates?: string[]` from the local bridge, and `AivatarPreferences` can store accepted `idleBubblePhrases?: string[]` plus `idleBubbleLanguage?: "auto" | "zh" | "en" | "mixed"`.
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
  - Renders the current programmatic pixel art pass, including the Stardew-inspired bed, retro drawer desk, placed CRT-style Terminal with animated keyboard, metal reflective dining table, retro green two-door fridge with deeper top clutter, buyable File Cabinet, premium black/gray Coffee Machine, Coffee Cup, Switch-style Game Console, Oil Easel, Digital Wall Clock, rainbow Cozy Rug, purple morph-blob rug, fridge door open/hold/close animation, and blanket overlay used when the avatar sleeps under the covers.
  - Renders the File Cabinet as a narrower front-facing metal cabinet with a deeper top plane, right-side shading, front drawers, and visible stacked task-file papers. Visible papers are driven by the real Task Cabinet queue: `Ready + Failed` tasks appear in the cabinet, `Running` tasks are treated as taken out, and `Completed` tasks disappear.
  - Failed Task Cabinet papers render with a small red `X` and remain visible until the task is successfully rerun or removed. Papers are drawn behind the drawer front so the drawer lip occludes them like real files.
  - Renders floor rug underlay items, currently a doubled-size rainbow Cozy Rug with shallow shadow/light woven edge and Morph Blob Rug, immediately after the floor and before all furniture, ordinary placed items, and the avatar, so furniture and objects can visibly cover rugs.
  - Renders wall-only placed items such as Poster and Digital Wall Clock on the wall layer after the wall/window and before furniture, so furniture naturally occludes wall hangings instead of wall hangings drawing over furniture.
  - Renders floor placed items in avatar-aware layers: floor items behind the avatar are drawn before the avatar, while floor items in front are redrawn after the avatar so placed objects such as the Oil Easel can occlude the avatar when the avatar stands behind them.
  - Renders furniture in visual-depth order rather than raw content order, so bed/desk/table/fridge/File Cabinet layering is less dependent on config array order.
  - Renders the bed as a split layer: the main bed body is always drawn in the behind-avatar furniture pass, while the bed footboard can be redrawn in the foreground pass to cover only the avatar's feet instead of covering the whole character.
  - Renders the Purple Bubble Wallpaper wall surface with a purple base, larger rounder bubble motifs, highlights, and light texture, Pink Sakura Wallpaper with denser stable pseudo-random blossoms and petals, and Warm Ivory Wallpaper with subtle off-white paper grain and soft seams.
  - Renders Checker Tile Floor with black/white tile checks, Polished Cement Floor with fine smooth concrete texture and gloss, Industrial Metal Floor with shaded plates/rivets and a top-to-bottom brightness gradient, and Tatami Mat Floor with green binding and softened woven straw texture.
  - Renders the City Night Window as a dynamic city view: sky colors smoothly transition through day, dusk, night, and dawn; the sun rises from the left and sets to the right; the moon crosses the night sky; drifting clouds and building silhouettes occlude the sun/moon; the glass area is clipped to the window bounds.
  - City Night Window building windows distinguish daytime natural-light panes from nighttime interior lights. Evening lights warm up gradually, late-night lights turn off by stable per-window seed so only a few remain lit, and dawn transitions remaining lit windows into daylight panes rather than simply fading them to black.
  - City Night Window high-rises include small red aircraft warning beacons that breathe at dusk/night and stay off in daylight and dawn.
  - Renders the Ocean Window as a wider, taller sea view near the wall/floor line: real-time sky and ocean color changes, softened horizon transition, sunrise/sunset glow, dawn/dusk color bands, moon at night, drifting clouds, dense breathing wave sparkles/reflections that follow the sun/moon position, and three slow-moving ships with depth: a modern cargo ship, a cruise ship, and a smaller distant cargo ship. Ship X positions use subpixel movement to avoid low-speed stutter, and ship lights turn on at night/deep dusk.
  - Animates Coffee Machine brewing when the active interaction is `brew`, including pulsing indicator lights, status strip flashes, coffee stream pixels, cup fill pixels, and small steam pixels.
  - Renders placed Coffee Cup as a small transparent glass tabletop cup-and-saucer item with a right handle, rounded elliptical rim/lower rim, stronger base shadow, and visible coffee volume/slow dynamic rising steam when that cup represents one stored table Coffee. Empty cups show a pale transparent glass interior.
  - Renders a larger Game Console screen and adds animated screen pixels only when the avatar is in `play` behavior near a placed Game Console, so the screen does not animate from across the room.
  - Renders the Oil Easel as a programmatic pixel-art wooden easel with slimmer support legs, a canvas carrying a permanent half-finished landscape sketch, top clamp, crossbars, and subtle canvas shading. The avatar has a `paint` pose based on the front-facing octopus proportions, with a beret, paintbrush, palette, and small brush motion; active painting adds animated color strokes on top of the half-finished canvas.
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
  - Avatar and furniture art remain programmatic canvas drawing; editor-created assets are not yet wired into runtime rendering.

- `src/game/simulation.ts`
  - Avatar state machine and behavior logic.
  - Maps agent status to avatar behavior.
  - Provides visual-only task-file behavior targets: `fetch_task_file` moves toward the File Cabinet, while `carry_task_file` and `read_task_file` move toward the placed Terminal area.
  - Handles autonomous sleep, wander, relax, snack, admire, brew, paint, and play activities.
  - Handles autonomous sleep, wander, explore, relax, snack, admire, brew, paint, and play activities.
  - `idle` leaves the avatar to its autonomous life behavior, including sleeping, eating/drinking, wandering, exploring, relaxing, playing, admiring decor, and brewing coffee.
  - `thinking` now routes the avatar to the desk/Terminal area for focused thought instead of random wandering; `executing`/coding targets the placed Terminal and routes the avatar to the Terminal-facing side of the desk/table.
  - `coffee`, `cola`, and `bento` are distinct consumable behaviors with happy expression and front-facing interaction poses at the table/fridge area.
  - Coding arrival faces the avatar toward the Terminal for a direct interaction pose.
  - Low-energy busy behavior can send the avatar to the table for coffee when coffee is available.
  - Prioritizes placed decor, Coffee Machine, Game Console, and Oil Easel for autonomous activities.
  - `explore` is a low-priority idle-learning behavior. It only triggers when Energy/Mood/Hunger are healthy, targets either a random floor point or a sampled point near furniture/placed items, and runs longer than ordinary wander so it can collect route experience.
  - `tickAvatar` accepts optional memory/growth state, and autonomous behavior choices are lightly biased by traits: curiosity favors exploring/admiring/interacting, efficiency favors brewing and quick recovery, focus favors recentering/relaxing, resilience favors mood recovery/continuing activity, creativity favors painting at the Oil Easel, and warmth is available for visual themes, bubbles, and future richer behavior weighting.
  - Idle/autonomous behavior can randomly choose `phone`, a local-only visual animation that does not update memory/growth, does not post bridge status, and does not represent agent activity.
  - Updates four-direction facing from movement, supports collision-aware movement, and delays furniture interaction effects until the avatar reaches the target.
  - Avatar collision now uses a small ground-footprint rectangle rather than a large circular body radius, so tall sprite pixels do not over-block movement.
  - Uses a lightweight 8px nav-grid A* pathfinding pass with cached full-path waypoints before falling back to older waypoint avoidance and collision sliding. Interactive furniture and placed items expose generated interaction standpoints so the avatar targets reachable positions near desks, tables, fridges, file cabinets, Coffee Machines, terminals, and other interactable objects rather than trying to stand on the object itself.
  - Interaction standpoints have been manually tuned around common obstacles: Coffee Machine, Terminal, Game Console, and Oil Easel remove or prioritize points so the avatar approaches from reachable front/side positions; desktop Coffee Machine/Terminal/Game Console use only three front standpoints; Fridge and Desk remove above-furniture points; Desk/Table/Terminal points sit closer to collision boxes for more natural arrival.
  - Queued interactions prefer the object's default/main interaction target rather than the avatar-nearest point, reducing side-point selection and collision-edge jitter near desks, tables, fridges, terminals, Coffee Machines, Game Consoles, and Oil Easels.
  - `complete` maps to `success` only for a short visual window of about 2.2 seconds so the avatar plays the yawn animation briefly and then returns to ordinary autonomous life even if the bridge's latest status remains `complete`.
  - `success` uses a sleepy/yawn expression rather than a long celebration pose.
  - `play` no longer forces front-facing on arrival, allowing App-level Game Console interactions to face the avatar toward the console.
  - Pathfinding now avoids diagonal corner-cutting, applies a small collision-edge epsilon to reduce border flicker, and caches short-lived nav paths/waypoints for the same target so the avatar does not constantly swap between direct target and route waypoint near furniture edges. If a movement step collides or becomes ineffective, the avatar can clear the cached path, lightly back away from the collision direction, and replan on the next tick. When no meaningful movement happens, facing is preserved to reduce visual jitter.
  - `tickAvatar` accepts an optional `ignoredFurnitureId`, used by queued interactions so the avatar can enter normal interaction state with the target furniture or a desktop item's host surface instead of being bounced away by that same collision box.
  - Provides shared furniture interaction targets so avatar movement and arrival checks stay aligned. App-level arrival checks now also count an interaction point as reached when it touches the avatar's ground-footprint rectangle, with distance-based reach retained as fallback.
  - Keeps the sleep target near the bed head so the real avatar body is covered by the blanket instead of using a separately drawn sleep head.

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
  - Furniture collision boxes represent the furniture's ground-projection/footprint rather than the full visual sprite. Default collision footprints are currently tuned to visible lower/base areas, including Desk `{ x: 170, y: 130, width: 102, height: 41 }`, Fridge `{ x: 346, y: 143, width: 38, height: 31 }`, and Table `{ x: 306, y: 256, width: 90, height: 27 }` in the default layout.
  - Uses `tags` and `placementSurfaces` to distinguish furniture, items, hangings, consumables, windows, and room surfaces.
  - Includes surface definitions for Purple Bubble Wallpaper, Pink Sakura Wallpaper, Warm Ivory Wallpaper, Checker Tile Floor, Polished Cement Floor, Industrial Metal Floor, and Tatami Mat Floor. Matching `wall-surface` and `floor-surface` shop/item definitions provide pricing and purchased-state metadata for the Decor panel, but these surface items are filtered out of the backpack and are not placed as room objects.
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
  - Supports `DELETE /agent-sessions/stale` for manually pruning stale session history while preserving the current active session.
  - Maintains one latest status per `agent + sessionId` and broadcasts snapshots containing `currentStatus`, `sessions[]`, `activeSessionKey`, `connectedSessionKey`, `currentSessionKey`, and a snapshot timestamp.
  - Normalizes and preserves optional `usage` fields, including `contextTokens` and `modelContextWindow`, so token usage can flow from status clients into the Agent Sessions panel, context window meters, and Codex reward logic.
  - When a newer status update for the same session omits `usage`, the bridge preserves the previous usage payload so final/terminal status events do not erase context-window meters.
  - Normalizes and preserves optional `idleBubbleCandidates` arrays in status payloads so session-derived short phrase suggestions can flow into the Growth panel. These suggestions are bridge-memory only and are not persisted by the bridge. The bridge filters candidates outside the 2-28 character range instead of truncating overlong text into partial phrases.
  - When a newer status update for the same session omits `idleBubbleCandidates`, the bridge preserves the previous candidates so tool-use/executing updates do not erase suggestions generated from user or final agent messages.
  - Selects `currentStatus` by preferring a fresh active session, then fresh high-priority sessions, then fresh non-idle sessions, then bridge idle. Presence heartbeats keep a session visibly connected but do not keep stale high-priority statuses such as `executing` driving the main avatar.
  - Treats sessions as stale after `AIVATAR_SESSION_STALE_MS` milliseconds, defaulting to `60000`; stale sessions stay visible in the list but no longer block interaction or drive the main avatar state.
  - Prunes stale sessions and caps the in-memory session map with `AIVATAR_MAX_SESSIONS`, defaulting to `80`, so long-running bridge processes do not grow unbounded.

- `scripts/codex-session-discovery.mjs`
  - Aivatar-side Codex Desktop session discovery service.
  - Runs as a single background process recorded under `%TEMP%\aivatar-session-discovery\discovery.json`.
  - Read-only scans `CODEX_HOME\sessions\**\*.jsonl`, defaulting to `%USERPROFILE%\.codex\sessions`, and parses `session_meta.payload.id`, `cwd`, `originator`, and `source` from recent rollout files.
  - Only considers rollout files modified within `AIVATAR_DISCOVERY_ACTIVE_MS`, defaulting to 30 minutes, so old chat history is not eagerly connected.
  - Posts `/agent-presence` for detected Codex sessions, starts the external plugin `aivatar-heartbeat.mjs` and `aivatar-watch.mjs` when helpers are missing or dead, and records helper pids under `%TEMP%\aivatar-session-discovery\helpers`.
  - Passes `CODEX_ROLLOUT_PATH` to each watcher so it tails the exact discovered rollout JSONL instead of searching by session id.
  - Defaults token reward baselines to `%TEMP%\aivatar-usage-baselines.json` to avoid restricted `.codex\tmp` write contexts.
  - Sends a one-time `thinking` / `discovered` status when it first starts helpers for a session, then leaves real turn state to the watcher. Discovery does not repeatedly overwrite active turn status.
  - Does not modify, rename, delete, migrate, or hide Codex Desktop session/chat files.
  - Does not set `/agent-active` by default; manual `aivatar-connect`, Agent Sessions Follow, and launcher flows remain the explicit ways to choose the followed session.

- `C:\Users\rniu\plugins\aivatar-session-bridge`
  - External local session plugin, currently outside this repo.
  - `aivatar-connect` now stops only the same session's previous heartbeat/watcher rather than stopping all Aivatar session background processes.
  - `aivatar-heartbeat` defaults to presence-only updates; it does not repeatedly post active/follow state unless explicitly launched with `--active`.
  - `aivatar-watch` falls back to context-window usage for `complete`/`error` events when token-delta usage is unavailable, so worktree sessions can continue showing context after final answers.

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
  - Passes a wrapper parent pid to the CLI connector so a watchdog can clean up heartbeat/watcher helpers if the user directly closes the terminal window.
  - Supports `--prompt-file <path>` for Task Cabinet automation. The wrapper reads the prompt file with Node and appends the file contents as a single prompt argument. On Windows, Codex launches through the npm-installed `@openai/codex/bin/codex.js` with `node` so the full `.md` prompt is passed as an argv argument without `cmd.exe` string re-parsing or the broken `codex -- <prompt>` form that made leading words look like subcommands.

- `scripts/aivatar-cli-connect.mjs`
  - Repo-local CLI session connector.
  - Sends an initial `thinking` status, sets the session active, posts presence, starts the external plugin heartbeat, starts the external plugin watcher when available, and records helper pids under `%TEMP%\aivatar-cli-session`.
  - Defaults `AIVATAR_USAGE_BASELINE_PATH` to `%TEMP%\aivatar-usage-baselines.json`, preserving token reward support without requiring write access to `.codex\tmp`.
  - Supports `--no-watch` for non-Codex or provisional sessions and `--watch-parent-pid` to start watchdog cleanup.

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
- Stale timeout defaults to `60000ms` and can be changed with `AIVATAR_SESSION_STALE_MS`.

Behavior mapping:

- `idle`: autonomous life behavior.
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
- Autonomous avatar behavior, including sleep, wander, relax, snack, admire decor, brew Coffee, and play games.
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
  - Coffee Machine can generate Coffee manually or via autonomous behavior, one cup at a time, after the avatar reaches the placed machine.
  - Brewing Coffee costs `1 bit`; if the wallet has insufficient bits, no Coffee is produced and the UI shows a bits warning.
  - Coffee generation persists through localStorage save state through table coffee storage and inventory fallback.
  - Coffee Machine art has been redesigned as a black/gray pixel appliance with screen, buttons, side tank, portafilter-style handle, cup, tray, and brewing animation for lights, coffee stream, cup fill, and steam.
  - File Cabinet shop item.
  - File Cabinet unlocks at Growth level 25, costs bits, and is unique: the shop hides it while one exists in inventory or in the room.
  - Placing File Cabinet records ownership in save `placedItems`, but runtime content converts it into base furniture so collision, movement, click hit testing, and avatar layer occlusion match other furniture.
  - Selling or deleting the placed File Cabinet removes the saved placement and makes it available in the shop again.
- Decor panel:
  - Lists wall and floor surface options separately from the backpack.
  - Surface options can be bought, applied, and cleared back to the configured default surface.
  - Purchased surface state uses `purchasedItemIds`; active overrides are saved as `wallSurfaceId` and `floorSurfaceId`.
  - Surface items are filtered out of the regular backpack even if older test saves previously stored them in inventory.
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
- Agent Sessions is a collapsible side-panel menu. Collapsed state shows live/total sessions and Current/source context; expanded state shows Follow/Clear controls, CLI hints, session cards, context window meters, reward summaries, and status chips.
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
  - Built-in Terminal right-click context actions queue a placed-item `interact` action and enter `coding` only after arrival, so desk/table-hosted item interactions use the same surface-collision-ignore approach as other queued placed-item interactions.
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
  - Avatar movement uses a small ground-footprint rectangle and tries to avoid furniture footprints while allowing explicitly targeted interaction furniture/surfaces to be ignored during queued approach.
  - Lightweight nav-grid A* routing helps the avatar move around desk/table/fridge/file-cabinet obstacles before falling back to waypoint avoidance and collision sliding.
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
  - Playing games slowly restores mood only while the avatar is near the placed Game Console.
  - Game Console art is now a small Switch-style handheld with blue/red side controls sized for floor/table placement.
- Agent session display:
  - The right panel shows Agent Sessions as a collapsible menu. Collapsed state shows live/total sessions and Current/source context; expanded state lists recent bridge sessions with agent name, session id, status, summary, and Active/Connected/Current/Idle/Stale markers.
  - Sessions with context usage show a context window meter based on `usage.contextTokens / usage.modelContextWindow`.
  - Sessions with reward usage show a compact reward summary using total tokens, weighted tokens, reward bits, and the cap indicator when relevant. Context-only usage does not display as a reward summary.
  - Sessions can be followed or cleared from the app through `/agent-active`.
  - Presence updates through `/agent-presence` keep the selected active session visibly connected even when no new status event has arrived.
  - Stale sessions remain visible for context but no longer drive `currentStatus` or block room interactions.
- WebSocket agent status client with simulated fallback.
- HTTP-to-WebSocket local bridge for generic AI agent status, active session selection, and presence heartbeats.
- Bridge snapshots include `currentStatus`, `sessions[]`, `activeSessionKey`, `connectedSessionKey`, and `currentSessionKey`, preserve optional token `usage`, and are also fetched over HTTP as a live-mode fallback.
- Manual generic agent status sender CLI with legacy Codex command compatibility.
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
- Task Cabinet automation launches Codex/Claude through the same connected wrapper used by the CLI Launcher, with the task prompt passed through a derived `%TEMP%\aivatar-task-prompts\*.md` file and `--prompt-file`. Status still depends on external Codex/Claude CLI behavior and bridge/wrapper session updates.
- File Cabinet visible papers now reflect real Task Cabinet state: `Ready + Failed` tasks appear in the cabinet, failed papers show a red `X`, running tasks are visually treated as taken out, and completed tasks disappear. Removing a task from Aivatar removes it only from localStorage and never deletes the source `.md`.
- Development saves remain browser-origin scoped. Saves from `http://127.0.0.1:1420/` do not automatically migrate to `http://localhost:1420/`.
- UI theme preference is also browser-origin scoped under `aivatar.uiTheme.v1`. A Terminal skin choice made at `http://127.0.0.1:1421/` will not automatically apply to `http://localhost:1420/`.
- Runtime save state can preserve old inventory/stats even after config changes. For testing fresh config, clear `localStorage` key `aivatar.save.v1`.
- Runtime save state includes `layoutVersion`, `avatarId`, `avatarName`, `avatarRuntime`, `memory`, `navMemory`, `petStats`, `inventory`, `placedItems`, `wallet`, `purchasedItemIds`, `furnitureStorage`, `workBoostUntil`, `activeWindowId`, `wallSurfaceId`, `floorSurfaceId`, `windowPlacements`, and `furniturePlacements`. `avatarId` is generated for new saves and normalized into older saves; `navMemory` is normalized for older saves. File Cabinet ownership/placement is saved in `placedItems`, then converted into runtime furniture during content assembly.
- Memory/Growth v1 is rule-driven local state. It does not store full chat transcripts, does not use a vector database, and does not call an LLM.
- Navigation-learning v1 is local and lightweight: idle exploration writes visited cells, tricky spots, successes, failures, and latest exploration time into `navMemory`. It currently accumulates experience only; it does not yet change the local `backoff`/`sidestep`/`replan`/`switch-interaction-point` policy.
- Session-derived idle bubble suggestions are generated by local rules from the current Codex session's user/final-agent messages. The current watcher uses a bilingual theme/template approach, including a `daily` life category, so suggestions feel more like pet thoughts than transcript snippets. Suggestions are not automatically used: users must add them in the Growth panel, and saved phrase slots are capped by avatar level. The bridge preserves existing suggestions across same-session status updates that omit candidates.
- Growth also generates memory-derived idle bubble suggestions locally from current traits, recent memory events, and favorite recovery/activity preferences. The Growth panel aims for 3 memory-derived and 3 session-derived visible candidates, with fallback fill if one source has too few candidates.
- The idle bubble suggestion pipeline requires the updated bridge and watcher to be running. Existing old `scripts/codex-status-bridge.mjs` or `aivatar-watch.mjs` processes will drop or omit `idleBubbleCandidates` until the bridge/watcher are restarted or `aivatar-connect` is rerun.
- Growth traits affect visuals and small behavior probabilities, but they are not yet a full personality/strategy engine. The Growth hex chart is a normalized `log10(points + 1)` visualization of raw trait points capped at `1_000_000`; it should not be treated as the underlying trait storage.
- Wall/floor surface shop entries are Decor panel options, not backpack items. Older test saves may still contain surface ids in `inventory`; the UI filters those entries out while preserving `purchasedItemIds` so they remain available in the Decor panel.
- Window shop entries are also not backpack items. Their purchase state is stored in `purchasedItemIds`, active selection is stored in `activeWindowId`, and per-window placement is stored in `windowPlacements`. Selling a selected window removes its purchased state and placement and falls back to another available window.
- `aivatar.defaultLayout.v1` stores the default layout used for new/no-save sessions and Room Edit `Reset default`.
- Existing saves with `layoutVersion: 2` restore the user's last saved layout on restart. Missing-version saves migrate once to the current default layout while preserving non-layout data.
- Store in Room Edit Mode returns an item to inventory but does not refund bits.
- Placement/editing MVP now has visual-bound hit testing, ground-projection-based bed/desk/table/fridge/file-cabinet placement, floor-item overlap checks based on ground projections, item placement on floor, wall, or desk/table surfaces, locked built-in Terminal placed item migration, basic furniture collision and movement, buyable File Cabinet runtime furniture conversion, File Cabinet footprint-based placement overlap, and special rug-underlay overlap behavior. It still needs stronger snapping, placement previews, and special-case QA across all non-rug room objects.
- Desktop/floor item placement includes placeable items. The built-in Terminal has been migrated to `placedItems`, but save migration still preserves legacy `computer` furniture placement when encountered.
- Fridge open/hold/close behavior is still a programmatic canvas animation rather than a sprite/atlas animation.
- Digital Wall Clock, transparent glass Coffee Cup with slow animated steam, Cozy Rug, Morph Blob Rug, Switch-style Game Console, Coffee Machine, Oil Easel, File Cabinet, dynamic City Night Window, Ocean Window, Purple Bubble Wallpaper, Pink Sakura Wallpaper, Warm Ivory Wallpaper, Checker Tile Floor, Polished Cement Floor, Industrial Metal Floor, Tatami Mat Floor, and recent fridge/coffee-machine/file-cabinet/easel art are still programmatic canvas assets rather than spritesheet/atlas assets.
- Coffee, Cola, Bento, paint, phone idle, and task-file fetch/carry/read poses are still programmatic canvas overlays rather than spritesheet/atlas animations. The phone pose uses a thinner handset; front-facing avatar poses show the phone back toward the viewer, while side-facing poses show the glowing screen.
- Shop, inventory, and Decor surface thumbnails are CSS/DOM previews rather than shared runtime sprite assets. They are intentionally lightweight UI affordances and can drift from canvas art until the asset pipeline is unified.
- The Terminal skin is currently a CSS/canvas theme layer rather than a full design-token system. New UI components need explicit Terminal-theme QA so Classic-only colors do not leak into expanded panels, custom progress bars, disabled states, or canvas overlays.
- ASCII text inside status/session bubbles uses a pixel-font renderer with matching measurement/draw widths to reduce overflow. CJK fallback now uses a Chinese UI font stack and is clearer than the old monospace fallback, but arbitrary non-ASCII text is still rendered inside the low-resolution canvas and can look softer than DOM text when scaled.
- Side-panel collapse/expand depends on Tauri desktop window resizing in the desktop app. Web-only previews keep the React layout behavior but cannot resize the native window.
- The side-panel collapse flow preserves the room's left edge and locks the scene panel width while resizing. In collapsed mode, top-left stats, top-right growth summary, and bottom context HUD overlays stay borderless over the room. If future flicker returns, inspect native window position/size behavior before adding more CSS animation.
- Existing saves may preserve older furniture positions, purchased state, inventory, or placed File Cabinet state after config or art changes; clear `aivatar.save.v1` for a fully fresh layout and Growth/shop test.
- Game Console mood recovery is intentionally slow, does not produce bits, and now ticks while the avatar is actively playing near the placed Game Console using a near-active-play-target check rather than relying only on recalculated exact standpoints.
- Oil Easel painting is intentionally a mood/creativity recovery activity and does not produce bits. The easel is categorized in the Furniture shop tab through `tags: ["furniture", "easel"]`, but remains `kind: "decor"` so it uses placed-item rendering/placement rather than File Cabinet's runtime-furniture conversion path.
- Oil Easel currently has visual/click/placement bounds and participates in floor-item ground-projection placement overlap checks, but placed-item navigation collision is not yet wired into `simulation.ts`; adding a small foot-level easel collision box remains a pending follow-up.
- Coffee Machine brewing is now a small economy sink: manual and autonomous brewing each cost `1 bit` and only complete after the avatar reaches the placed Coffee Machine; broader bits balancing is deferred until closer to 1.0.
- Bed collision was intentionally removed so the avatar can move naturally around the wall-aligned bed.
- High-priority agent states still block right-click context-menu interaction actions: `thinking`, `executing`, `waiting_for_user`, and `error`. Left-click selection remains available for inspection/editing.
- `thinking` intentionally does not trigger busy recovery, so focused thought remains visually clear even when stats are low. Busy recovery still applies to other high-priority states when resources are available.
- High-priority stale sessions stop blocking interactions after the configured bridge stale timeout.
- A connected stale active session can remain visibly linked in the Agent Sessions panel, but stale statuses do not keep driving `currentStatus` merely because presence remains fresh.
- Complete rewards are intentionally limited to `agent: "codex"` sessions.
- Token usage rewards and context window meters currently work for Codex sessions that can be matched to local Codex rollout JSONL files, including the Codex Desktop session plugin path and the desktop CLI Launcher connected path after it discovers the real Codex rollout session id.
- Claude Code launcher sessions currently get lifecycle connection and heartbeat presence, but fine-grained watcher events and token/context usage need a Claude-specific usage source or hook.
- Codex token usage and context window usage are read from local Codex rollout JSONL files using the current session id. This is a local development integration and should not be assumed stable across all Codex versions or platforms without verification.
- Token reward baselines are stored outside the repo. The session plugin stores them under the Codex home temp area by default; the repo-local CLI connector defaults to `%TEMP%\aivatar-usage-baselines.json` to avoid `.codex\tmp` write-permission issues when launched from restricted contexts. Baselines are cleared by `complete`, `error`, `idle`, or `--clear-active`, and expire after the configured TTL.
- Test sessions such as usage smoke tests live in the bridge's in-memory sessions map. Restarting the bridge clears them, and the Agent Sessions panel can manually clear stale entries through `Clear Stale`.
- Busy recovery depends on available inventory, table coffee storage, or placed entertainment; without recovery resources the avatar remains busy and visually depletes rather than sleeping. Recovery effects still require arrival at the chosen table/fridge/placed item target.
- Avatar movement now uses a lightweight 8px nav-grid A* route toward generated interaction standpoints, caches full route waypoints, then falls back to learned local action scoring when movement is blocked or ineffective. Local policy candidates include `sidestep-left`, `sidestep-right`, `backoff`, `force-replan`, and `switch-interaction-point`; scoring uses progress toward the target, collision/path reachability, and `navMemory` penalties for tricky or heavily visited cells.
- `navMemory` is now learned from all real non-idle/non-explore movement, not only explicit `explore`: the app records traversed cells, marks stuck cells as failures/tricky spots, and records successful arrivals for ordinary movement, pending world interactions, snack targets, and autonomous brewing. Per-cell counts are capped at `9999`, and ordinary movement recording is throttled to reduce `localStorage` churn.
- `navMemory` still does not decay or reset automatically when furniture layouts change, so old tricky-cell penalties may remain conservative after room edits until future layout-aware decay is added.
- Terminal/desktop placed-item interaction near the desk is still being tuned. Pending approach now ignores the host desk/table collision, Terminal interactions are launched from the right-click context menu, Terminal standpoints are constrained to front points, and arrival can complete when the avatar's foot rectangle touches the target marker. Post-arrival stability should still be watched in visual QA.
- The Agent Sessions panel displays recent sessions but the room still has one avatar driven by `currentStatus`.
- `Demo actions` is a Debug-only visual QA helper. It cycles runtime avatar behaviors and displays demo bubbles, but it does not represent real agent status or grant rewards. If a Debug status override is active, use the highlighted `Live` button to return the avatar to real bridge status.
- The `phone` behavior is intentionally not an agent status and should not trigger bridge sends, memory rewards, task summaries, or status replies. It is only an idle-life animation.
- Interactive Codex/Claude TUI automatic waiting detection is still limited. The generic bridge supports external status posts, but desktop app automatic status requires a client-side hook, plugin, wrapper, or API.
- Current Codex Desktop conversations can be discovered automatically by Aivatar when the desktop app or `status:discover` is running. The local Aivatar session plugin remains useful for explicitly following/activating a specific session, reconnecting a session, or manual recovery. Explicit status posts remain useful for smoke tests and older clients. For command lifecycle tracking, use `codex:run`, `claude:run`, or `agent:run`; for the smoother launcher/CLI flow, use the desktop CLI Launcher or `codex:connected`.
- Chat/session safety depends on keeping the Aivatar integration read-oriented toward Codex data. Scripts may read rollout JSONL, inspect `thread/list`, and clear Aivatar bridge state, but should not remove or rewrite Codex session files or Desktop chat metadata.
- If Codex chats appear to disappear, preserve the current `%TEMP%` Aivatar recovery logs, check whether old `aivatar-connect`/watcher/heartbeat processes are still running, verify which plugin command directory is first on PATH, and confirm whether the action used `codex resume <session-id>` or explicit `--new-session`.
- If automatic Codex session discovery does not show a session, check `%TEMP%\aivatar-session-discovery\discovery.json`, `%TEMP%\aivatar-session-discovery\helpers\*.json`, whether `CODEX_HOME\sessions` contains a recent rollout JSONL with `session_meta`, whether the external plugin path exists, and whether the bridge is reachable on `127.0.0.1:38988`.
- If a desktop CLI Launcher Codex session does not stream real-time updates, first check whether a new rollout JSONL was created under `.codex\sessions` and whether `aivatar-connected-run.mjs` switched from the provisional session to that real Codex session id.
- If a Launcher-started session remains connected after the CLI window is closed, check `%TEMP%\aivatar-cli-session\*.json` and the recorded heartbeat/watcher/watchdog pids before changing bridge priority logic.
- Current git state may show the whole repository as untracked in this workspace, so `git diff`/`git diff --stat` can be empty even after file edits. Use targeted file reads or `rg` to verify edits when needed.
- If a browser preview does not show recent worktree changes, check which checkout owns the port. In the current workflow, the OneDrive checkout may own `localhost:1420`, while the Codex worktree preview runs at `http://127.0.0.1:1421/`.
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

## Recommended Next Steps

1. Continue regression-testing Codex chat/session safety with `codex resume <session-id>`, explicit `--new-session`, automatic discovery, the desktop CLI Launcher, disconnect cleanup, stale-process cleanup, PATH/plugin shadowing checks, and recovery-log inspection.
2. Continue validating automatic Codex Desktop session discovery and the real-time rollout watcher over ordinary chat turns, especially multiple projects/worktrees, app restart, already-running bridge, repeated `final_answer` events, token-based rewards, context-window updates, and the session-inspired idle bubble candidate flow.
3. After the watcher and session-safety flow prove stable, decide whether to vendor `C:\Users\rniu\plugins\aivatar-session-bridge` into this repo now that the workflow is documented and wrapped by npm scripts.
4. Validate and polish the desktop CLI Launcher connected path over real Codex CLI turns, including provisional-to-real session switching, watchdog cleanup when users close terminal windows, repeated launcher starts, stale pid cleanup, token reward baselines, and Agent Sessions display behavior.
5. Visually QA the recent Ocean Window, Growth, Oil Easel, bed layering, table collision, and exploration-learning changes in the running app: slow subpixel ship movement, distant ship scale, night ship lights, breathing wave sparkles, softened horizon, Coffee Cup slow steam, Growth hex chart hover/log-scale normalization behavior, Oil Easel scale/perspective, avatar beret/brush/palette paint pose, bed body/footboard occlusion, and idle `explore` route collection.
6. Add focused UI/runtime tests or screenshot regression checks for sleep recovery, token-based complete rewards, context window meters, Memory/Growth updates, `navMemory` save/load normalization, Growth hex chart `log10(points + 1)` normalization and hover labels, whole-side-panel collapse/expand and Tauri window resize behavior, collapsed HUD overlay positioning, Agent Sessions mini context meter, Growth/Agent Sessions/Debug submenu collapse/expand behavior, Terminal skin coverage across collapsed/expanded cards and canvas bubbles, idle bubble language filtering, memory/session suggestion balance, accepted phrase display, trait-driven avatar visuals, the `Demo actions` behavior cycle, placement, Room Edit, shop/inventory/Decor/window thumbnails, collision and interaction-point overlays, autonomous activity, idle exploration, agent status, work/fridge/table/coffee/cola/bento/paint/phone animation flows, unified arrive-then-interact behavior for furniture/placed items/consumables, autonomous and manual Coffee Machine brew animation, transparent Coffee Cup empty/full rendering, Game Console play-screen animation and mood recovery, Oil Easel painting and creativity growth, dynamic City Night Window and Ocean Window day/night preview states, Digital Wall Clock rendering, Decor panel collapse/tabs, and rug-underlay layering.
7. Continue hardening avatar pathfinding after the nav-grid/interaction-standpoint/action-scoring pass, especially post-arrival desktop-item stability around the Terminal/desk, layout-change decay for old `trickySpots`, per-action outcome memory, placed-item collision for Oil Easel, and regression cases around dense bed/desk/table/fridge/Coffee Machine/Game Console/Oil Easel layouts.
8. Polish busy recovery UX with clearer recovery-source feedback, no-supply warnings, and balanced depletion/recovery rates.
9. Expand Memory/Growth beyond v1 with richer milestones, preference-driven behavior, memory reset/export controls, and better UI explanations for how traits are learned.
10. Add layout-aware `navMemory` decay or fingerprinting so old tricky spots are discounted when furniture/item placement changes.
11. Add robust overlap prevention and snapping for non-rug floor items, furniture-top items, wall items, windows, moved base furniture, and the locked built-in Terminal, while preserving intentional underlay rug overlap behavior.
12. Continue Agent Sessions UX polish with filtering, pinning, stale-clear feedback, context/reward usage explanations, multi-worktree connection diagnostics, and clearer priority controls for `currentStatus`.
13. Continue refining the UI skin system toward reusable theme tokens so future panels inherit Classic/Terminal colors without one-off selector patches.
14. Finish the unified content model for furniture, items, hangings, consumables, windows, wall surfaces, and floor surfaces.
15. Add a simple layering editor so wall-overlap furniture, desktop objects, non-rug floor items, rugs, avatar occlusion, and open furniture doors can be controlled predictably beyond the current fixed rug-underlay layer.
16. Polish table coffee storage UX, including explicit deposit/withdraw actions, clearer coffee source feedback, better feedback when brewing cannot afford the `1 bit` cost, and clearer guidance that Coffee Cups placed on the dining table define storage capacity.
17. Continue hardening the unified world-interaction flow so future furniture, placed items, and consumables automatically follow the intended sequence: avatar decides an action, walks to the relevant item/furniture, starts the item/avatar animation only after arrival, then applies the effect when the action completes.
18. Improve surface placement rules for desk/table items, including overlap checks and clearer visual previews for valid tabletop positions.
19. Create a small unified furniture/item/consumable interaction animation model instead of handling door/opening/progress/Terminal/Coffee/Cola/Bento animation as one-off render conditions.
20. Expand save-state versioning beyond the current layout migration so old `localStorage` layouts can adapt to new furniture dimensions, content tags, memory fields, storage fields, and origin changes more robustly.
21. Add stronger delete/sell/rotation confirmation and polish in Room Edit Mode.
22. Polish the Decor panel with clearer purchased/unpurchased thumbnail states, more wall/floor surface content, and screenshot checks for Purple Bubble Wallpaper and Checker Tile Floor.
23. Add a room comfort system where decor, furniture, windows, and floor/wall choices affect mood/energy recovery.
24. Add content-pack manifest support under `public/content-packs/`.
25. Before unlocking Asset Studio, connect Pixel Asset Editor output to runtime rendering for a selected draft asset, starting with preview-only avatar frame replacement.
26. Add import/export for Pixel Asset Editor drafts as JSON and later PNG atlas/spritesheet output.
27. Add an asset library/content-pack layer under `public/content-packs/` so edited avatar animations, decor, furniture, and tools can be packaged.
28. Replace selected programmatic avatar/object art with spritesheet/atlas assets once the editor workflow is stable, starting with consumable action poses and high-value room objects like the Coffee Machine, Morph Blob Rug, Game Console, and Digital Wall Clock.
29. Add automated tests for bridge `usage` payload normalization and token reward formula edge cases, including cached-heavy turns, missing usage, cap behavior, and work boost interaction.
30. Add a Claude Code watcher/hook/token usage source so Claude launcher sessions can provide fine-grained tool/final/status updates and reward context comparable to Codex rollout watching.
31. Design and implement the future embedded terminal path with a real PTY backend and xterm.js-style frontend, so Aivatar can launch and display Codex/Claude sessions in-app rather than opening an external PowerShell window.
32. Revisit the full bits economy before 1.0, including Codex reward pacing, shop prices, recurring sinks, debug-only rewards, and Coffee brewing costs.
33. Consider a DOM overlay bubble renderer if Chinese/Japanese/Korean bubble clarity needs to become fully crisp at all zoom levels.
34. Regression-test Task Cabinet over real Codex and Claude Code task runs, including Chinese/English prompt text, spaces/newlines in `.md` content, failed-session recovery, Rerun, per-task Schedule, Repeat/Once timing, Browse path selection, prompt length limits, and status synchronization through Agent Sessions.
35. Polish Task Cabinet task metadata and UX with title/frontmatter parsing, per-task agent/cwd defaults, clearer schedule diagnostics, task history/export, and safer handling of stale `Running` entries after app restart.
36. Strengthen Task Cabinet execution safety before broad automation: preserve the existing file-safety approval workflow before any agent modifies existing project files, make source `.md` tasks explicitly read-only, and consider an explicit review step for high-impact commands.
