#!/usr/bin/env node
// Creates a fresh retained /tmp profile. Never opens real application data or launches an app.
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !/^--port=\d+$/.test(args[0]))) {
  throw new Error("Usage: node scripts/desktop-mode-qa/prepare-native-profile.mjs [--port=1457]");
}
const port = Number(args[0]?.split("=")[1] ?? 1457);
if (port < 1024 || port > 65535 || [1420, 38987, 38988].includes(port)) throw new Error("Use a separate non-bridge local port");
const root = await mkdtemp("/tmp/aivatar-desktop-qa-");
const uuid = randomUUID();
const identifier = `com.aivatar.synthetic.desktop${uuid.replaceAll("-", "")}`;
const marker = { format: "aivatar-synthetic-profile-v1", identifier,
  dataStoreIdentifier: [...Buffer.from(uuid.replaceAll("-", ""), "hex")] };
const base = JSON.parse(await readFile(path.join(repo, "src-tauri/tauri.conf.json"), "utf8"));
const devUrl = `http://127.0.0.1:${port}/`;
const overlay = { identifier, bundle: { resources: [] },
  build: { beforeDevCommand: "", devUrl },
  app: { windows: base.app.windows.map(window => ({ ...window, title: "Aivatar — isolated desktop QA" })) } };
const configPath = path.join(root, "tauri.synthetic.conf.json");
await writeFile(path.join(root, "synthetic-profile.json"), `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
await writeFile(configPath, `${JSON.stringify(overlay, null, 2)}\n`, { flag: "wx" });
await writeFile(path.join(root, "control.json"), `${JSON.stringify({ revision: 1, status: "idle", message: "Synthetic desktop QA: idle" }, null, 2)}\n`, { flag: "wx" });
const runner = `// Generated for this isolated profile only. No cleanup or installed-app launch.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const root = ${JSON.stringify(root)};
const repo = ${JSON.stringify(repo)};
const target = process.env.AIVATAR_QA_CARGO_TARGET ?? root + '/target';
const env = { ...process.env, AIVATAR_SYNTHETIC_ROOT: root, CARGO_TARGET_DIR: target,
  TAURI_CONFIG: await readFile(root + '/tauri.synthetic.conf.json', 'utf8'),
  AIVATAR_DESKTOP_QA_PORT: ${JSON.stringify(String(port))}, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' };
delete env.AIVATAR_SYNTHETIC_PHASE;
const commands = {
  build: ['cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--offline', '--locked']],
  vite: [process.execPath, [repo + '/node_modules/vite/bin/vite.js', '--config', repo + '/scripts/desktop-mode-qa/vite.config.mjs']],
  launch: [target + '/debug/' + (process.platform === 'win32' ? 'aivatar.exe' : 'aivatar'), []],
};
const command = commands[process.argv[2]];
if (!command) throw new Error('Usage: node ' + root + '/run.mjs build|vite|launch');
const child = spawn(command[0], command[1], { cwd: repo, env, stdio: 'inherit' });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
`;
await writeFile(path.join(root, "run.mjs"), runner, { flag: "wx" });
console.log(JSON.stringify({ root, identifier, webkitDataStoreUuid: uuid, configPath, devUrl,
  build: `node ${root}/run.mjs build`, vite: `node ${root}/run.mjs vite`, launch: `node ${root}/run.mjs launch`,
  note: "Run build, then keep vite running, then launch. Set AIVATAR_QA_CARGO_TARGET consistently to reuse an existing QA-only Cargo target. Do not set AIVATAR_SYNTHETIC_PHASE. All generated artifacts are retained." }, null, 2));
