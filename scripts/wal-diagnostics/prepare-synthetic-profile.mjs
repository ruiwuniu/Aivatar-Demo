#!/usr/bin/env node
// Create an isolated, retained profile. This script never launches an app,
// reads an existing user profile, changes production configuration, or cleans up.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
let devUrl;
if (args.length) {
  if (args.length !== 2 || args[0] !== "--dev-url") {
    throw new Error("Usage: node scripts/wal-diagnostics/prepare-synthetic-profile.mjs [--dev-url http://127.0.0.1:PORT]");
  }
  const parsed = new URL(args[1]);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !parsed.port || ["38987", "38988"].includes(parsed.port)) {
    throw new Error("Use an explicit, separate local Vite port; live bridge ports are forbidden.");
  }
  devUrl = parsed.href;
}

const uuid = randomUUID();
const dataStoreIdentifier = [...Buffer.from(uuid.replaceAll("-", ""), "hex")];
const identifier = `com.aivatar.synthetic.run${uuid.replaceAll("-", "")}`;
const root = path.join(here, "synthetic-native-runs", `run-${Date.now()}-${uuid}`);
await mkdir(root, { recursive: true });
const marker = { format: "aivatar-synthetic-profile-v1", identifier, dataStoreIdentifier };
await writeFile(path.join(root, "synthetic-profile.json"), `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });

const baseConfig = JSON.parse(await readFile(path.join(repo, "src-tauri/tauri.conf.json"), "utf8"));
const config = {
  identifier,
  // Tauri's production resources include scripts/. Never copy test artifacts or
  // compiler targets recursively; this profile disables all bridge resources.
  bundle: { resources: [] },
  ...(devUrl ? { build: { beforeDevCommand: "", devUrl } } : {}),
  app: {
    windows: baseConfig.app.windows.map(window => ({
      ...window,
      title: `${window.title ?? "Aivatar"} — synthetic persistence profile`,
      // Set the UUID in Rust before Builder::build: this installed Tauri
      // config codegen emits Vec<u8> for an Option<[u8; 16]> configuration field.
    })),
  },
};
const configPath = path.join(root, "tauri.synthetic.conf.json");
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
await writeFile(path.join(root, "README.txt"), [
  "Generated synthetic persistence profile. Retain all artifacts; no cleanup is automatic.",
  "Launch only a debug build with AIVATAR_SYNTHETIC_ROOT set to this directory.",
  "Use the adjacent tauri.synthetic.conf.json as the CLI --config overlay.",
  "This test overlay omits bundled bridge resources. Use a Cargo target outside scripts/.",
  "Native storage/social data is restricted to this directory's app-data child.",
  "The separate bundle identifier isolates the single-instance lock.",
  `WebKit persistent data-store UUID: ${uuid}. macOS 14+ is required.`,
  "WebKit controls the on-disk location of this separate UUID store; it is not the default store.",
  "All windows share this synthetic UUID and block live bridge ports 38987/38988.",
  "Native discovery, agent integration scanning, bridge startup and agent launches are disabled.",
  "Reusing this marker/root tests restart readback. A new invocation creates a new profile.",
  "No production identifier, configuration, storage, installed app or lockfile is changed.",
  "",
].join("\n"), { flag: "wx" });

console.log(JSON.stringify({ root, identifier, webkitDataStoreUuid: uuid, configPath, environment: { AIVATAR_SYNTHETIC_ROOT: root }, ...(devUrl ? { devUrl } : {}) }, null, 2));
