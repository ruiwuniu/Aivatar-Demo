#!/usr/bin/env node
import { access } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const defaultPluginRoot = "C:\\Users\\rniu\\plugins\\aivatar-session-bridge";
const pluginRoot = process.env.AIVATAR_SESSION_PLUGIN_ROOT ?? defaultPluginRoot;

const commands = {
  setup: {
    script: join("scripts", "setup-path.ps1"),
  },
  connect: {
    script: join("scripts", "aivatar-connect.mjs"),
  },
  disconnect: {
    script: join("scripts", "aivatar-disconnect.mjs"),
  },
};

const usage = () => {
  console.log(`Usage: node scripts/aivatar-session-plugin.mjs <setup|connect|disconnect> [args...]

Environment:
  AIVATAR_SESSION_PLUGIN_ROOT  Override plugin path.

Default plugin path:
  ${defaultPluginRoot}`);
};

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: pluginRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Aivatar session plugin command exited with code ${code}`));
    });
  });

const [commandName, ...args] = process.argv.slice(2);

if (!commandName || commandName === "--help" || commandName === "-h") {
  usage();
  process.exit(commandName ? 0 : 1);
}

const command = commands[commandName];
if (!command) {
  console.error(`Unknown Aivatar session plugin command: ${commandName}`);
  usage();
  process.exit(1);
}

const scriptEntry = join(pluginRoot, command.script);
if (!(await exists(scriptEntry))) {
  console.error(`Aivatar session plugin command not found: ${scriptEntry}`);
  console.error("");
  console.error("Install or locate the plugin, then rerun with:");
  console.error('  $env:AIVATAR_SESSION_PLUGIN_ROOT = "C:\\path\\to\\aivatar-session-bridge"');
  process.exit(1);
}

if (commandName === "setup") {
  await run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptEntry,
    ...args,
  ]);
} else {
  await run(process.execPath, [scriptEntry, ...args]);
}
