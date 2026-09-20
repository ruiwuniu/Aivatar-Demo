import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createPlatformReport, mergePlatformReports, verifyUpdaterSignature } from "./aivatar-updater-release.mjs";

// Ephemeral synthetic keys exist only in memory; no installed app, user save,
// signing secret, GitHub account or network is accessed by these checks.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const keyId = Buffer.from("0123456789abcdef", "hex");
const encodedPublicKey = Buffer.from(`untrusted comment: synthetic release QA\n${Buffer.concat([Buffer.from("Ed"), keyId, rawPublic]).toString("base64")}\n`).toString("base64");
function signatureFor(bytes, algorithm = "ED", versionFields = "\tversion:0.5.0") {
  const message = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  const signature = sign(null, message, privateKey);
  const comment = `timestamp:1\tfile:synthetic-artifact\tprehashed${versionFields}`;
  const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
  return Buffer.from(`untrusted comment: synthetic release QA\n${Buffer.concat([Buffer.from(algorithm), keyId, signature]).toString("base64")}\ntrusted comment: ${comment}\n${globalSignature.toString("base64")}\n`).toString("base64");
}
const bytes = Buffer.from("synthetic updater artifact");
assert.equal(verifyUpdaterSignature(bytes, signatureFor(bytes), encodedPublicKey, "0.5.0"), true);
assert.equal(verifyUpdaterSignature(bytes, signatureFor(bytes, "Ed"), encodedPublicKey, "0.5.0"), true);
assert.throws(() => verifyUpdaterSignature(Buffer.from("tampered"), signatureFor(bytes), encodedPublicKey, "0.5.0"), /artifact signature/);
const changedComment = Buffer.from(Buffer.from(signatureFor(bytes), "base64").toString().replace("timestamp:1", "timestamp:2")).toString("base64");
assert.throws(() => verifyUpdaterSignature(bytes, changedComment, encodedPublicKey, "0.5.0"), /comment signature/);
assert.throws(() => verifyUpdaterSignature(bytes, "not-a-signature", encodedPublicKey, "0.5.0"), /base64/);

assert.throws(() => verifyUpdaterSignature(bytes, signatureFor(bytes), encodedPublicKey), /expected app version/);
assert.throws(() => verifyUpdaterSignature(bytes, signatureFor(bytes), encodedPublicKey, "0.5.1"), /matching app version/);
assert.throws(() => verifyUpdaterSignature(bytes, signatureFor(bytes, "ED", ""), encodedPublicKey, "0.5.0"), /matching app version/);
assert.throws(() => verifyUpdaterSignature(bytes, signatureFor(bytes, "ED", "\tversion:0.5.0\tversion:0.5.0"), encodedPublicKey, "0.5.0"), /matching app version/);
const changedVersion = Buffer.from(Buffer.from(signatureFor(bytes), "base64").toString().replace("version:0.5.0", "version:0.5.1")).toString("base64");
assert.throws(() => verifyUpdaterSignature(bytes, changedVersion, encodedPublicKey, "0.5.1"), /comment signature/);

const root = mkdtempSync(join(tmpdir(), "aivatar-updater-release-qa-"));
const downloads = join(root, "downloaded");
mkdirSync(downloads);
const version = "0.5.0";
const sourceCommit = "a".repeat(40);
const repo = "synthetic-owner/synthetic-repo";
const identity = { version, sourceCommit, repo, publicKey: encodedPublicKey };
const paths = {
  macos: ["dmg/Aivatar_0.5.0_universal.dmg", "macos/Aivatar.app.tar.gz"],
  windows: ["nsis/Aivatar_0.5.0_x64-setup.exe", "msi/Aivatar_0.5.0_x64_en-US.msi"],
};
function createFixtures(platform) {
  const bundleRoot = join(root, platform);
  const assets = [];
  for (const relative of paths[platform]) {
    const path = join(bundleRoot, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    const payload = Buffer.from(`synthetic ${relative}`);
    writeFileSync(path, payload);
    copyFileSync(path, join(downloads, basename(path)));
    if (!path.endsWith(".dmg")) {
      writeFileSync(`${path}.sig`, `${signatureFor(payload)}\n`);
      copyFileSync(`${path}.sig`, join(downloads, `${basename(path)}.sig`));
    }
    if (!path.endsWith(".tar.gz")) assets.push({ name: basename(path), size: payload.length, sha256: createHash("sha256").update(payload).digest("hex") });
  }
  return createPlatformReport({ ...identity, platform, bundleRoot, checksums: { version, sourceCommit, assets, verification: { applicationLaunched: false } } });
}
const macos = createFixtures("macos");
const windows = createFixtures("windows");
const mergeOptions = { ...identity, reports: [macos, windows], assetsDir: downloads, notes: "Desktop companions and signed automatic updates.", pubDate: "2026-09-20T12:00:00Z" };
const { manifest, checksums } = mergePlatformReports(mergeOptions);
assert.equal(manifest.version, version);
assert.deepEqual(manifest.platforms["darwin-aarch64"], manifest.platforms["darwin-x86_64"]);
assert.deepEqual(manifest.platforms["windows-x86_64"], manifest.platforms["windows-x86_64-nsis"]);
assert.match(manifest.platforms["windows-x86_64-msi"].url, /\.msi$/);
assert.equal(checksums.assets.length, 7, "DMG, three updater artifacts and their three signatures all have checksums");
assert.throws(() => mergePlatformReports({ ...mergeOptions, reports: [macos] }), /Both macOS and Windows/);
assert.throws(() => mergePlatformReports({ ...mergeOptions, reports: [macos, macos] }), /Both macOS and Windows/);
assert.throws(() => mergePlatformReports({ ...mergeOptions, reports: [macos, { ...windows, sourceCommit: "b".repeat(40) }] }), /sourceCommit mismatch/);
assert.throws(() => mergePlatformReports({ ...mergeOptions, reports: [macos, { ...windows, version: "0.5.1" }] }), /version mismatch/);
const wrongUrl = structuredClone(windows);
wrongUrl.platforms["windows-x86_64-msi"].url = "https://example.com/arbitrary.msi";
assert.throws(() => mergePlatformReports({ ...mergeOptions, reports: [macos, wrongUrl] }), /Unexpected updater URL/);
const missingTarget = structuredClone(windows);
delete missingTarget.platforms["windows-x86_64-msi"];
assert.throws(() => mergePlatformReports({ ...mergeOptions, reports: [macos, missingTarget] }), /platform targets/);
const dmg = join(downloads, "Aivatar_0.5.0_universal.dmg");
writeFileSync(dmg, Buffer.concat([readFileSync(dmg), Buffer.from("tampered")]));
assert.throws(() => mergePlatformReports(mergeOptions), /Downloaded asset differs/);
console.log("Updater release smoke passed: artifact/comment/version signatures, missing/wrong/duplicate version and tamper rejection, installer-specific targets, complete checksums, immutable source, two-platform merge and URL guards.");
