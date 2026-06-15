# Proposed Desktop Agent Support Edits

This is an approval artifact only. It does not change runtime behavior.

## Existing files to edit after approval

### `package.json`

Add scripts:

```json
"claude:desktop:link": "node scripts/aivatar-claude-desktop-link.mjs install",
"opencode:run": "node scripts/aivatar-run.mjs --agent opencode -- opencode",
"opencode:connected": "node scripts/aivatar-connected-run.mjs --agent opencode -- opencode",
"opencode:plugin:install": "node scripts/aivatar-opencode-plugin.mjs install"
```

### `src/App.tsx`

- Import `agentDisplayName`, `agentSourceBadge`, `agentSourceClassName`,
  `isRewardAgent`, `launcherAgentDefinitions`, and `LauncherAgentId` from
  `src/agentRegistry.ts`.
- Remove the local hard-coded `LauncherAgentId`, `agentDisplayName`, and
  `isRewardAgent` definitions.
- Render Launcher agent buttons from `launcherAgentDefinitions()`.
- Show the Launcher compact label through `agentDisplayName({ agent:
  launcherAgent })`.
- Use `agentSourceBadge(candidate.agent)` and
  `agentSourceClassName(candidate.agent)` for Growth suggestion source badges.
- For Task Cabinet fast profile hints:
  - Claude Code -> `profile.fastClaude`
  - Codex -> `profile.fastCodex`
  - opencode -> `profile.fastOpencode`

### `src/game/renderScene.ts`

- Import `isTerminalBubbleAgent` from `src/agentRegistry.ts`.
- Replace the hard-coded Codex/Claude guard in `drawComputerStatusBubble` with
  `if (!isTerminalBubbleAgent(status)) return;`.

### `src/styles.css`

- Add `.idle-bubble-candidate.agent-opencode:not(.llm)` styling.
- Add `.idle-bubble-source.agent-opencode` styling.
- Include opencode in disabled source badge styling.
- Include opencode in Classic theme Growth suggestion compatibility selectors.

### `src/i18n.ts`

- Update `launcher.directoryHint` in Traditional Chinese, Simplified Chinese,
  and English from `Codex / Claude Code` to `Codex / Claude Code / opencode`.
- Add `profile.fastOpencode` in all three locale sections.

### `src-tauri/src/lib.rs`

- Add `"opencode" => ("opencode", "opencode")` to both `start_agent_cli` and
  `start_task_agent`.

### `scripts/aivatar-connected-run.mjs`

- For `--prompt-file`, pass opencode task prompts as `--prompt <content>`.
- Set opencode initial connected status to `idle`.
- Disable Codex watcher for opencode with reason `opencode uses plugin events`.
- Default opencode session learning provider to `none` until a reliable
  opencode transcript-learning path is implemented.

### `scripts/aivatar-run.mjs`

- Treat `opencode` as an interactive agent so its TUI inherits stdio like Codex
  and Claude Code.

### `AGENTS.md`

Update after implementation and verification to document:

- Claude Desktop/Code link script and dry-run/apply behavior.
- opencode plugin adapter and install dry-run/apply behavior.
- opencode Launcher and Task Cabinet support.
- Remaining verification caveats for real desktop app event streams.
