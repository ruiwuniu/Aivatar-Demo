#!/usr/bin/env node
// Packages only a caller-selected synthetic debug executable. Does not launch,
// sign, install, replace, or stop applications, and never reads user profiles.
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--profile" || args[2] !== "--binary") {
  throw new Error("Usage: node scripts/desktop-mode-qa/bundle-native-profile.mjs --profile /tmp/aivatar-desktop-qa-XXXXXX --binary /absolute/qa-target/debug/aivatar");
}
const root = path.resolve(args[1]);
const binary = path.resolve(args[3]);
if (!root.startsWith("/tmp/aivatar-desktop-qa-") || !path.isAbsolute(args[3])) throw new Error("Use a generated /tmp profile and an explicit absolute QA binary path");
if (process.platform !== "darwin") throw new Error("This visual-QA bundle helper is for macOS");
const marker = JSON.parse(await readFile(path.join(root, "synthetic-profile.json"), "utf8"));
const config = JSON.parse(await readFile(path.join(root, "tauri.synthetic.conf.json"), "utf8"));
if (marker.format !== "aivatar-synthetic-profile-v1" || !marker.identifier.startsWith("com.aivatar.synthetic.")
  || marker.identifier !== config.identifier || config.bundle.resources.length !== 0) throw new Error("Synthetic profile and build overlay must agree");
if (!(await stat(binary)).isFile()) throw new Error("The selected debug binary is not a regular file");
const appPath = path.join(root, `Aivatar Desktop QA ${Date.now()}.app`);
// mkdir without recursive prevents overwriting an existing bundle.
await mkdir(appPath);
const contents = path.join(appPath, "Contents");
const macos = path.join(contents, "MacOS");
const resources = path.join(contents, "Resources");
await mkdir(macos, { recursive: true });
await mkdir(resources);
await copyFile(binary, path.join(macos, "aivatar-native"));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const wrapper = `#!/bin/sh\n# Generated isolated QA launcher; never launch without this profile.\nexport AIVATAR_SYNTHETIC_ROOT=${quote(root)}\nunset AIVATAR_SYNTHETIC_PHASE\nexec ${quote(path.join(macos, "aivatar-native"))} "$@"\n`;
await writeFile(path.join(macos, "aivatar-desktop-qa"), wrapper, { flag: "wx", mode: 0o755 });
const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
await writeFile(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${xml(marker.identifier)}</string>
<key>CFBundleName</key><string>Aivatar Desktop QA</string>
<key>CFBundleDisplayName</key><string>Aivatar Desktop QA</string>
<key>CFBundleExecutable</key><string>aivatar-desktop-qa</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.0.1</string>
<key>CFBundleIconFile</key><string>AivatarQA.icns</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>\n`, { flag: "wx" });
await writeFile(path.join(contents, "PkgInfo"), "APPL????", { flag: "wx" });
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await copyFile(path.join(repo, "src-tauri/icons/icon.icns"), path.join(resources, "AivatarQA.icns"));
console.log(JSON.stringify({ appPath, identifier: marker.identifier, displayName: "Aivatar Desktop QA", binary,
  note: "Bundle created only. Root coordinates stopping its previous QA child and launching this .app. Keep the isolated Vite server running. Retain all bundles; each invocation creates a new path." }, null, 2));
