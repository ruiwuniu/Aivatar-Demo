#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const hookScript = resolve(scriptDir, "claude-code-aivatar-hook.mjs");
const nodeCommand = process.execPath;

const usage = `Usage:
  node scripts/aivatar-claude-desktop-link.mjs
  node scripts/aivatar-claude-desktop-link.mjs install --scope user --apply
  node scripts/aivatar-claude-desktop-link.mjs install --settings .claude/settings.local.json --apply

Default behavior prints the Claude Code settings fragment without changing files.
Pass install --apply to merge Aivatar hooks/statusLine/env into a settings file.

Scopes:
  user     ~/.claude/settings.json
  project  ./.claude/settings.local.json
`;

const EVENT_GROUPS = [
  ["SessionStart"],
  ["UserPromptSubmit"],
  ["MessageDisplay"],
  ["PreToolUse", "*"],
  ["PermissionRequest", "*"],
  ["PermissionDenied", "*"],
  ["Notification"],
  ["PostToolUse", "*"],
  ["PostToolUseFailure", "*"],
  ["PostToolBatch"],
  ["Stop"],
  ["SubagentStop"],
  ["TeammateIdle"],
  ["StopFailure"],
  ["TaskCompleted"],
  ["SessionEnd"],
];

const powershellSingleQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const windowsShellPathQuote = (value) =>
  `"${String(value).replace(/\\/g, "/").replace(/"/g, "")}"`;

const statusLineWrapperPath = () =>
  join(homedir(), ".claude", "aivatar-statusline.ps1");

const statusLineCommand = () => {
  if (process.platform === "win32") {
    return `powershell -NoProfile -ExecutionPolicy Bypass -File ${windowsShellPathQuote(
      statusLineWrapperPath(),
    )}`;
  }
  return `${JSON.stringify(nodeCommand)} ${JSON.stringify(hookScript)} --status-line`;
};

const statusLineWrapperContent = () =>
  [
    "$ErrorActionPreference = 'Stop'",
    "if (-not $env:AIVATAR_LEARNING_ENABLED) { $env:AIVATAR_LEARNING_ENABLED = '1' }",
    "if (-not $env:AIVATAR_LEARNING_PROVIDER) { $env:AIVATAR_LEARNING_PROVIDER = 'claude-code' }",
    "$inputText = [Console]::In.ReadToEnd()",
    `$inputText | & ${powershellSingleQuote(nodeCommand)} ${powershellSingleQuote(
      hookScript,
    )} --status-line`,
    "",
  ].join("\r\n");

const commandHook = () => ({
  type: "command",
  command: nodeCommand,
  args: [hookScript],
  timeout: 10,
});

const settingsFragment = () => {
  const handler = commandHook();
  const hooks = {};
  for (const [eventName, matcher] of EVENT_GROUPS) {
    hooks[eventName] = [
      {
        ...(matcher ? { matcher } : {}),
        hooks: [handler],
      },
    ];
  }

  return {
    env: {
      AIVATAR_LEARNING_ENABLED: "1",
      AIVATAR_LEARNING_PROVIDER: "claude-code",
    },
    hooks,
    statusLine: {
      type: "command",
      command: statusLineCommand(),
      refreshInterval: 5,
    },
  };
};

const parseArgs = (argv) => {
  const options = {
    mode: argv.includes("install") ? "install" : "print",
    scope: "user",
    settingsPath: undefined,
    apply: argv.includes("--apply"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scope") {
      options.scope = argv[index + 1] ?? options.scope;
      index += 1;
      continue;
    }
    if (arg === "--settings") {
      options.settingsPath = argv[index + 1];
      index += 1;
    }
  }

  return options;
};

const defaultSettingsPath = (scope) => {
  if (scope === "project") {
    return resolve(process.cwd(), ".claude", "settings.local.json");
  }
  return join(homedir(), ".claude", "settings.json");
};

const readJsonFile = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
};

const sameHook = (left, right) =>
  left?.type === right?.type &&
  left?.command === right?.command &&
  JSON.stringify(left?.args ?? []) === JSON.stringify(right?.args ?? []);

const mergeHooks = (existingHooks = {}, nextHooks = {}) => {
  const merged = { ...existingHooks };
  for (const [eventName, groups] of Object.entries(nextHooks)) {
    const currentGroups = Array.isArray(merged[eventName])
      ? [...merged[eventName]]
      : [];
    for (const group of groups) {
      const matcher = group.matcher ?? "";
      const currentIndex = currentGroups.findIndex(
        (candidate) => (candidate.matcher ?? "") === matcher,
      );
      if (currentIndex < 0) {
        currentGroups.push(group);
        continue;
      }
      const currentGroup = currentGroups[currentIndex];
      const currentHandlers = Array.isArray(currentGroup.hooks)
        ? [...currentGroup.hooks]
        : [];
      for (const handler of group.hooks ?? []) {
        if (!currentHandlers.some((candidate) => sameHook(candidate, handler))) {
          currentHandlers.push(handler);
        }
      }
      currentGroups[currentIndex] = {
        ...currentGroup,
        hooks: currentHandlers,
      };
    }
    merged[eventName] = currentGroups;
  }
  return merged;
};

const mergeSettings = (existing, fragment) => ({
  ...existing,
  env: {
    ...(existing.env ?? {}),
    ...fragment.env,
  },
  hooks: mergeHooks(existing.hooks, fragment.hooks),
  statusLine: fragment.statusLine,
});

export const createClaudeDesktopSettingsFragment = settingsFragment;
export const mergeClaudeDesktopSettings = mergeSettings;
export const createClaudeStatusLineWrapperContent = statusLineWrapperContent;

const install = async (settingsPath, apply) => {
  const fragment = settingsFragment();
  const existing = await readJsonFile(settingsPath);
  const merged = mergeSettings(existing, fragment);

  if (!apply) {
    console.log(`Dry run: would merge Aivatar Claude hooks into ${settingsPath}`);
    if (process.platform === "win32") {
      console.log(`Dry run: would write statusLine wrapper to ${statusLineWrapperPath()}`);
    }
    console.log(JSON.stringify(merged, null, 2));
    return;
  }

  await mkdir(dirname(settingsPath), { recursive: true });
  if (process.platform === "win32") {
    await mkdir(dirname(statusLineWrapperPath()), { recursive: true });
    await writeFile(statusLineWrapperPath(), statusLineWrapperContent(), "utf8");
  }
  await writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`Updated ${settingsPath}`);
  if (process.platform === "win32") {
    console.log(`Updated ${statusLineWrapperPath()}`);
  }
  console.log("Restart Claude Desktop/Code sessions so they reload settings.");
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const settingsPath = resolve(
    options.settingsPath ?? defaultSettingsPath(options.scope),
  );

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage);
    return;
  }

  if (options.mode === "print") {
    console.log(usage);
    console.log("Settings fragment:");
    console.log(JSON.stringify(settingsFragment(), null, 2));
    if (process.platform === "win32") {
      console.log("Windows statusLine wrapper:");
      console.log(statusLineWrapperContent());
    }
    return;
  }

  await install(settingsPath, options.apply);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
