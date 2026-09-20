import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformTargets = {
  macos: ["darwin-aarch64", "darwin-x86_64"],
  windows: ["windows-x86_64", "windows-x86_64-nsis", "windows-x86_64-msi"],
};

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeBase64(value, label) {
  requireCondition(typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value), `${label} must be base64`);
  const bytes = Buffer.from(value, "base64");
  requireCondition(bytes.toString("base64") === value, `${label} has invalid base64 encoding`);
  return bytes;
}

// Tauri uses a base64-encoded Minisign public-key/signature box. Verify both
// the artifact and the trusted comment using Node's Ed25519 implementation.
// This is release QA only; the app also verifies downloads with its updater plugin.
export function verifyUpdaterSignature(bytes, encodedSignature, encodedPublicKey) {
  const keyLines = decodeBase64(encodedPublicKey.trim(), "Updater public key").toString("utf8").trimEnd().split(/\r?\n/);
  requireCondition(keyLines.length === 2 && keyLines[0].startsWith("untrusted comment: "), "Invalid Minisign public key box");
  const key = decodeBase64(keyLines[1], "Minisign public key");
  requireCondition(key.length === 42 && key.subarray(0, 2).toString() === "Ed", "Invalid Minisign public key");
  const lines = decodeBase64(encodedSignature.trim(), "Updater signature").toString("utf8").trimEnd().split(/\r?\n/);
  requireCondition(lines.length === 4 && lines[0].startsWith("untrusted comment: ") && lines[2].startsWith("trusted comment: "), "Invalid Minisign signature box");
  const signature = decodeBase64(lines[1], "Minisign signature");
  const globalSignature = decodeBase64(lines[3], "Minisign comment signature");
  requireCondition(signature.length === 74 && globalSignature.length === 64, "Invalid Minisign signature size");
  const algorithm = signature.subarray(0, 2).toString();
  requireCondition(algorithm === "ED" || algorithm === "Ed", "Unsupported Minisign signature algorithm");
  requireCondition(signature.subarray(2, 10).equals(key.subarray(2, 10)), "Updater signature key ID differs from configured public key");
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    format: "der", type: "spki",
  });
  const payload = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  requireCondition(verify(null, payload, publicKey, signature.subarray(10)), "Updater artifact signature verification failed");
  const comment = lines[2].slice("trusted comment: ".length).trim();
  requireCondition(verify(null, Buffer.concat([signature.subarray(10), Buffer.from(comment)]), publicKey, globalSignature), "Updater trusted comment signature verification failed");
  return true;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(path, data) {
  // Release tooling never replaces a previous report/manifest silently.
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readAsset(path) {
  const bytes = readFileSync(path);
  requireCondition(bytes.length > 0 && statSync(path).isFile(), `Empty or invalid artifact: ${path}`);
  return { bytes, metadata: { name: basename(path), size: bytes.length, sha256: digest(bytes) } };
}

function validateIdentity({ version, sourceCommit, repo, tag }) {
  requireCondition(typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), "A stable semantic version is required");
  requireCondition(tag === `v${version}`, "Release tag must match its version");
  requireCondition(typeof sourceCommit === "string" && /^[0-9a-f]{40}$/.test(sourceCommit), "Source must be an immutable full lowercase commit SHA");
  requireCondition(typeof repo === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo), "Invalid GitHub repository");
}

function assetUrl(identity, name) {
  return `https://github.com/${identity.repo}/releases/download/${identity.tag}/${encodeURIComponent(name)}`;
}

function expectedArtifacts(platform, version) {
  return platform === "macos"
    ? [{ file: "macos/Aivatar.app.tar.gz", targets: platformTargets.macos }]
    : [
      { file: `nsis/Aivatar_${version}_x64-setup.exe`, targets: ["windows-x86_64", "windows-x86_64-nsis"] },
      { file: `msi/Aivatar_${version}_x64_en-US.msi`, targets: ["windows-x86_64-msi"] },
    ];
}

function expectedInstallerNames(platform, version) {
  return platform === "macos" ? [`Aivatar_${version}_universal.dmg`]
    : [`Aivatar_${version}_x64-setup.exe`, `Aivatar_${version}_x64_en-US.msi`];
}

function expectedReleaseNames(platform, version) {
  return [...new Set([...expectedInstallerNames(platform, version), ...expectedArtifacts(platform, version).flatMap(({ file }) => [basename(file), `${basename(file)}.sig`])])].sort();
}

export function createPlatformReport({ platform, bundleRoot, version, sourceCommit, repo, tag = `v${version}`, publicKey, checksums }) {
  requireCondition(Object.hasOwn(platformTargets, platform), "Platform must be macos or windows");
  const identity = { version, sourceCommit, repo, tag };
  validateIdentity(identity);
  requireCondition(checksums.version === version && checksums.sourceCommit === sourceCommit, "Installer checksums do not match this release source/version");
  requireCondition(Array.isArray(checksums.assets) && JSON.stringify(checksums.assets.map((asset) => asset.name).sort()) === JSON.stringify(expectedInstallerNames(platform, version).sort()), "Installer checksum report is missing or duplicating an expected installer");
  const assets = new Map();
  for (const artifact of checksums.assets) {
    const file = platform === "macos" ? `dmg/${artifact.name}`
      : `${artifact.name.endsWith(".msi") ? "msi" : "nsis"}/${artifact.name}`;
    requireCondition(basename(artifact.name) === artifact.name, "Invalid installer asset name");
    const { metadata } = readAsset(resolve(bundleRoot, file));
    requireCondition(metadata.size === artifact.size && metadata.sha256 === artifact.sha256, `Installer changed after verification: ${artifact.name}`);
    assets.set(metadata.name, metadata);
  }
  const platforms = {};
  for (const artifact of expectedArtifacts(platform, version)) {
    const path = resolve(bundleRoot, artifact.file);
    const { bytes, metadata } = readAsset(path);
    const signatureAsset = readAsset(`${path}.sig`);
    const signature = signatureAsset.bytes.toString("utf8").trim();
    verifyUpdaterSignature(bytes, signature, publicKey);
    assets.set(metadata.name, metadata);
    assets.set(signatureAsset.metadata.name, signatureAsset.metadata);
    for (const target of artifact.targets) platforms[target] = { url: assetUrl(identity, metadata.name), signature };
  }
  return {
    schemaVersion: 1, platform, ...identity, publicKeySha256: digest(Buffer.from(publicKey.trim())),
    platforms, assets: [...assets.values()].sort((a, b) => a.name.localeCompare(b.name)),
    verification: { ...checksums.verification, updaterArtifactSignaturesValid: true, updaterTrustedCommentSignaturesValid: true },
  };
}

export function mergePlatformReports({ reports, assetsDir, version, sourceCommit, repo, tag = `v${version}`, publicKey, notes, pubDate }) {
  const identity = { version, sourceCommit, repo, tag };
  validateIdentity(identity);
  requireCondition(typeof notes === "string" && notes.trim().length > 0, "Release notes are required");
  requireCondition(typeof pubDate === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(pubDate) && Number.isFinite(Date.parse(pubDate)), "Publication date must be UTC RFC3339");
  requireCondition(reports.length === 2 && new Set(reports.map((report) => report.platform)).size === 2, "Both macOS and Windows reports are required exactly once");
  const platforms = {};
  const assets = new Map();
  for (const report of reports) {
    requireCondition(report.schemaVersion === 1 && Object.hasOwn(platformTargets, report.platform), "Invalid platform report");
    for (const field of Object.keys(identity)) requireCondition(report[field] === identity[field], `Platform report ${field} mismatch`);
    requireCondition(report.publicKeySha256 === digest(Buffer.from(publicKey.trim())), "Platform report uses a different updater public key");
    requireCondition(report.verification.updaterArtifactSignaturesValid === true && report.verification.updaterTrustedCommentSignaturesValid === true, "Platform report is missing signature verification");
    requireCondition(JSON.stringify(Object.keys(report.platforms).sort()) === JSON.stringify([...platformTargets[report.platform]].sort()), "Unexpected or missing updater platform targets");
    requireCondition(Array.isArray(report.assets) && JSON.stringify(report.assets.map((asset) => asset.name).sort()) === JSON.stringify(expectedReleaseNames(report.platform, version)), "Unexpected or missing release assets in platform report");
    for (const asset of report.assets) {
      requireCondition(typeof asset.name === "string" && basename(asset.name) === asset.name && !/[\\/]/.test(asset.name), "Invalid release asset name");
      requireCondition(!assets.has(asset.name), `Duplicate release asset: ${asset.name}`);
      const { metadata } = readAsset(resolve(assetsDir, asset.name));
      requireCondition(metadata.size === asset.size && metadata.sha256 === asset.sha256, `Downloaded asset differs from CI report: ${asset.name}`);
      assets.set(asset.name, metadata);
    }
    for (const artifact of expectedArtifacts(report.platform, version)) {
      const name = basename(artifact.file);
      requireCondition(assets.has(name) && assets.has(`${name}.sig`), `Missing signed updater artifact: ${name}`);
      const signature = readFileSync(resolve(assetsDir, `${name}.sig`), "utf8").trim();
      verifyUpdaterSignature(readFileSync(resolve(assetsDir, name)), signature, publicKey);
      for (const target of artifact.targets) {
        const entry = report.platforms[target];
        requireCondition(entry.url === assetUrl(identity, name) && entry.signature === signature, `Unexpected updater URL or signature for ${target}`);
        platforms[target] = entry;
      }
    }
  }
  const manifest = { version, notes: notes.trim(), pub_date: pubDate, platforms };
  const checksums = { ...identity, assets: [...assets.values()].sort((a, b) => a.name.localeCompare(b.name)), verification: { bothPlatformsPresent: true, sourceCommitMatches: true, downloadedAssetsMatchCI: true, updaterSignaturesValid: true } };
  return { manifest, checksums };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    requireCondition(args[index]?.startsWith("--") && args[index + 1] && !args[index + 1].startsWith("--"), "Arguments must be --name value pairs");
    const key = args[index].slice(2);
    requireCondition(!Object.hasOwn(options, key), `Duplicate argument --${key}`);
    options[key] = args[index + 1];
  }
  return options;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  requireCondition(command === "platform" || command === "merge", "Usage: aivatar-updater-release.mjs platform|merge --config src-tauri/tauri.conf.json --version VERSION --source SHA --repo OWNER/REPO ...");
  const options = parseArgs(args);
  for (const name of ["config", "version", "source", "repo", "output"]) requireCondition(options[name], `Missing --${name}`);
  const config = readJson(options.config);
  requireCondition(config.version === options.version && config.bundle?.createUpdaterArtifacts === true, "Tauri configuration version/updater artifacts must match this release");
  const common = { version: options.version, sourceCommit: options.source, repo: options.repo, publicKey: config.plugins?.updater?.pubkey };
  requireCondition(typeof common.publicKey === "string" && common.publicKey.trim(), "Updater public key is missing from Tauri config");
  if (command === "platform") {
    for (const name of ["platform", "bundle-root", "checksums"]) requireCondition(options[name], `Missing --${name}`);
    const report = createPlatformReport({ ...common, platform: options.platform, bundleRoot: options["bundle-root"], checksums: readJson(options.checksums) });
    writeJson(options.output, report);
    console.log(`Verified ${report.assets.length} ${report.platform} release assets and wrote ${options.output}.`);
  } else {
    for (const name of ["macos", "windows", "assets-dir", "notes-file", "checksums-output"]) requireCondition(options[name], `Missing --${name}`);
    const { manifest, checksums } = mergePlatformReports({ ...common, reports: [readJson(options.macos), readJson(options.windows)], assetsDir: options["assets-dir"], notes: readFileSync(options["notes-file"], "utf8"), pubDate: options["pub-date"] ?? new Date().toISOString() });
    writeJson(options.output, manifest);
    writeJson(options["checksums-output"], checksums);
    console.log(`Verified both platforms at ${common.sourceCommit}; wrote ${options.output} and ${options["checksums-output"]}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
