#!/usr/bin/env node
// Builds and launches only a marked synthetic debug profile. It never launches
// the installed app, opens the default WebKit store, or deletes test artifacts.
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import http from "node:http";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const portArg = process.argv.slice(2);
if (portArg.length > 1 || (portArg[0] && !/^--port=\d+$/.test(portArg[0]))) {
  throw new Error("Usage: node scripts/wal-diagnostics/run-native-store-integration.mjs [--port=1447]");
}
const port = Number(portArg[0]?.split("=")[1] ?? 1447);
if (port < 1024 || port > 65535 || [38987, 38988].includes(port)) throw new Error("Invalid isolated Vite port");
const devUrl = `http://127.0.0.1:${port}/`;
const profile = JSON.parse(execFileSync(process.execPath, [path.join(here, "prepare-synthetic-profile.mjs"), "--dev-url", devUrl], { cwd: repo, encoding: "utf8" }));
const root = profile.root;
const target = path.join(repo, ".aivatar-native-storage-validation/target");
const overlay = await readFile(profile.configPath, "utf8");
const config = JSON.parse(overlay);
if (!config.identifier.startsWith("com.aivatar.synthetic.") || config.bundle.resources.length !== 0) {
  throw new Error("Synthetic config must isolate identity and omit recursive bridge resources");
}
const env = {
  ...process.env,
  DEVELOPER_DIR: "/Library/Developer/CommandLineTools",
  CARGO_TARGET_DIR: target,
  TAURI_CONFIG: overlay,
  AIVATAR_SYNTHETIC_ROOT: root,
};
const summary = { root, identifier: profile.identifier, webkitDataStoreUuid: profile.webkitDataStoreUuid,
  devUrl, productionResourcesChanged: false, startedAt: new Date().toISOString(), phases: [], passed: false };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Avoid Node 26's undici socket QoS path, which can throw setTypeOfService EINVAL
// on this macOS host before a fetch promise can reject.
const serves = url => new Promise(resolve => {
  const request = http.get(url, response => { response.resume(); resolve(response.statusCode === 200); });
  request.once("error", () => resolve(false));
  request.setTimeout(1000, () => { request.destroy(); resolve(false); });
});
let vite;
let native;
const run = (command, args, logName, extraEnv = {}) => {
  const child = spawn(command, args, { cwd: repo, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  const log = createWriteStream(path.join(root, logName), { flags: "wx" });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("close", () => log.end());
  child.done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return child;
};
const reportsFor = async phase => {
  const directory = path.join(root, "reports");
  const names = await readdir(directory).catch(error => error.code === "ENOENT" ? [] : Promise.reject(error));
  const reports = [];
  for (const name of names.filter(name => name.startsWith(`main-${phase}-`) && name.endsWith(".json")).sort()) {
    try { reports.push({ file: path.join(directory, name), ...JSON.parse(await readFile(path.join(directory, name), "utf8")) }); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  return reports;
};

// Capture exactly the source bytes used by the build and Vite run. This reads
// only repository source, never any application/user profile.
const sourcePaths = execFileSync("rg", ["--files", "src", "src-tauri/src"], { cwd: repo, encoding: "utf8" })
  .trim().split("\n").filter(file => /\.(ts|tsx|rs)$/.test(file)).sort();
summary.sourceFiles = {};
for (const relative of sourcePaths) {
  const file = path.join(repo, relative);
  summary.sourceFiles[relative] = { sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
    modifiedAt: (await stat(file)).mtime.toISOString() };
}
console.log(`Retained synthetic integration profile: ${root}`);
try {
  console.log("Building the debug application with an isolated config and non-recursive target.");
  const build = run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--offline", "--locked"], "native-build.log");
  const buildExit = await build.done;
  if (buildExit.code !== 0) throw new Error(`Native build failed; see ${path.join(root, "native-build.log")}`);
  vite = run(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], "vite.log");
  const serveDeadline = Date.now() + 30_000;
  let served = false;
  while (Date.now() < serveDeadline) {
    if (vite.exitCode !== null) throw new Error("Isolated Vite server failed to start; see vite.log");
    served = await serves(devUrl);
    if (served) break;
    await sleep(100);
  }
  if (!served) throw new Error("Isolated Vite server did not become ready");
  await sleep(250);
  if (vite.exitCode !== null) throw new Error("Port is already owned; isolated Vite exited");

  for (const phase of ["initial", "restart", "crash", "after-crash"]) {
    console.log(`Running native phase: ${phase}`);
    native = run(path.join(target, "debug", process.platform === "win32" ? "aivatar.exe" : "aivatar"), [], `native-${phase}.log`, { AIVATAR_SYNTHETIC_PHASE: phase });
    const deadline = Date.now() + 120_000;
    let result;
    while (Date.now() < deadline) {
      const reports = await reportsFor(phase);
      const failed = reports.find(report => report.stage === "failed");
      if (failed) throw new Error(`Native ${phase} failed: ${failed.error}; report ${failed.file}`);
      result = await Promise.race([native.done, sleep(150).then(() => undefined)]);
      if (result !== undefined) break;
    }
    if (result === undefined) throw new Error(`Native ${phase} timed out; synthetic window/profile are retained`);
    const reports = await reportsFor(phase);
    const passed = reports.findLast(report => report.stage === "passed");
    const expectedCode = phase === "crash" ? 74 : 0;
    if (!passed || result.code !== expectedCode) throw new Error(`Native ${phase} exited ${result.code} without its expected successful report`);
    summary.phases.push({ phase, exit: result, report: passed });
    native = undefined;
  }
  summary.passed = true;
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  // Terminate only the child processes created above. Never target an installed
  // app or delete the retained database, WebKit UUID store, report, or build tree.
  if (native?.exitCode === null) native.kill("SIGKILL");
  if (vite?.exitCode === null) vite.kill("SIGTERM");
  summary.sourceStableDuringRun = true;
  for (const [relative, evidence] of Object.entries(summary.sourceFiles)) {
    const sha256 = createHash("sha256").update(await readFile(path.join(repo, relative))).digest("hex");
    if (sha256 !== evidence.sha256) summary.sourceStableDuringRun = false;
  }
  if (!summary.sourceStableDuringRun) { summary.passed = false; process.exitCode = 1; }
  summary.finishedAt = new Date().toISOString();
  await writeFile(path.join(root, "integration-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  const { sourceFiles, ...display } = summary;
  console.log(JSON.stringify({ ...display, capturedSourceFiles: Object.keys(sourceFiles).length }, null, 2));
}
