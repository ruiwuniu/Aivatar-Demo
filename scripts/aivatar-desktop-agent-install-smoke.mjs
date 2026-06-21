#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const tempHome = await mkdtemp(join(tmpdir(), "aivatar-agent-install-smoke-"));
const env = {
  ...process.env,
  HOME: tempHome,
  USERPROFILE: tempHome,
};

const run = (args) => {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
};

const escapeForJsString = (value) => JSON.stringify(value).slice(1, -1);

try {
  run(["scripts/aivatar-opencode-plugin.mjs", "install", "--apply"]);
  const opencodePluginPath = join(
    tempHome,
    ".config",
    "opencode",
    "plugins",
    "aivatar-opencode-plugin.js",
  );
  const opencodePlugin = await readFile(opencodePluginPath, "utf8");
  assert.match(opencodePlugin, /AivatarOpencodePlugin/);
  assert.match(opencodePlugin, /export default AivatarOpencodePlugin/);
  assert.match(opencodePlugin, /session-learning/);
  assert.ok(
    opencodePlugin.includes(
      escapeForJsString(join(root, "scripts", "aivatar-learning-worker.mjs")),
    ),
  );
  assert.ok(opencodePlugin.includes(escapeForJsString(process.execPath)));
  assert.doesNotMatch(
    opencodePlugin,
    /const EMBEDDED_LEARNING_SCRIPT = "__AIVATAR_LEARNING_SCRIPT__"/,
  );
  assert.doesNotMatch(
    opencodePlugin,
    /const EMBEDDED_NODE_COMMAND = "__AIVATAR_NODE_COMMAND__"/,
  );

  run(["scripts/aivatar-claude-desktop-link.mjs", "install", "--apply"]);
  const claudeSettingsPath = join(tempHome, ".claude", "settings.json");
  const statusLinePath = join(tempHome, ".claude", "aivatar-statusline.ps1");
  const claudeSettings = JSON.parse(await readFile(claudeSettingsPath, "utf8"));
  const statusLine = await readFile(statusLinePath, "utf8");

  assert.equal(claudeSettings.env.AIVATAR_LEARNING_ENABLED, "1");
  assert.equal(claudeSettings.env.AIVATAR_LEARNING_PROVIDER, "claude-code");
  assert.ok(claudeSettings.hooks.UserPromptSubmit);
  assert.ok(claudeSettings.hooks.MessageDisplay);
  assert.ok(claudeSettings.hooks.SubagentStop);
  assert.ok(claudeSettings.hooks.TeammateIdle);
  assert.ok(claudeSettings.hooks.Stop);
  assert.equal(claudeSettings.statusLine.type, "command");
  assert.match(claudeSettings.statusLine.command, /aivatar-statusline\.ps1/);
  assert.match(statusLine, /AIVATAR_LEARNING_ENABLED/);
  assert.match(statusLine, /claude-code-aivatar-hook\.mjs/);

  await stat(opencodePluginPath);
  await stat(claudeSettingsPath);
  await stat(statusLinePath);

  console.log("Aivatar desktop agent install smoke test passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
