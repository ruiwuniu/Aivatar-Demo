# Automatic updates / 自动更新

Aivatar 0.5.0 introduces in-app updates for macOS and Windows. Older releases and the earlier local 0.5.0 preview packages do not contain an updater: install this release manually once to receive future updates inside the app.

0.5.0 正式版开始支持 macOS 和 Windows 应用内更新。更早的版本及此前的本地 0.5.0 测试包没有更新模块，需要手动安装本次正式版一次，之后即可在软件中获取新版。

## Using updates / 使用方法

- The installed app checks for releases once after startup. Open the room's **Settings** to check manually and read update notes.
- Downloading an update does not install it immediately. Choose **Install and restart** when you are ready.
- Before installation, every open persistent room must finish saving. If saving fails or times out, installation stops and the app remains available for retry.
- An unavailable network does not prevent normal room use. Checks and downloads can be retried later.
- In desktop companion mode, return to the room to access Settings.

- 安装后的软件每次启动后会自动检查一次新版，也可在房间的「设置」中手动检查并查看更新说明。
- 下载完成不会立即安装；准备好后点击「安装并重启」。
- 安装前，所有已打开且包含存档的窗口都必须完成保存。保存失败或超时会中止安装，保留当前软件供重试。
- 网络不可用时仍可正常使用房间，稍后再检查或下载即可。
- 在桌面伙伴模式下，先回到房间，再进入设置。

## Platform behavior / 平台行为

macOS uses a universal update archive for Apple Silicon and Intel Macs. Windows selects an update matching the NSIS or MSI installation type. Keep the application in a writable installation location and allow the operating system's ordinary installer prompts when needed. Aivatar does not disable operating-system security checks.

macOS 的更新包同时支持 Apple Silicon 和 Intel；Windows 会选择与 NSIS 或 MSI 安装方式匹配的更新包。安装位置需要具有相应写入权限，必要时由用户处理系统安装提示。Aivatar 不会关闭系统安全检查。

Update signatures authenticate packages using the public key embedded in Aivatar. These signatures are separate from Apple code signing/notarization and Windows code-signing certificates. This release includes update signatures; platform signing and notarization remain unconfigured.

更新专用签名用于确认更新包来源，与 Apple 代码签名/公证、Windows 代码签名证书是不同机制。本版本提供更新签名，系统级签名和 Apple 公证仍未配置。

## Release maintenance and signing isolation

These controls describe the hardened source workflow. Ordinary releases use a new version and an unpublished draft. An explicitly authorized same-version repair can instead prepare replacement assets while the existing release remains available; the separate completion procedure below is required to replace it. Original `v0.5.0` signatures lack a signed version, so the new validator rejects them: a repaired release must contain newly built packages and signatures bound to that version.

The updater reads the latest published stable release's `latest.json` over HTTPS. Both platforms' packages and signatures must be complete before the final manifest is uploaded and the draft is published. New signatures bind the package to the exact app version, and `requireSignedVersion` makes the updated client reject missing or mismatched signed versions.

### Separate build and signing jobs

- Each build job has `contents: read`, checks out with `persist-credentials: false`, and receives no signing secret. Third-party actions are pinned to full commit SHAs. A temporary config disables updater signing for this build only; npm hooks, Cargo build scripts and application code cannot access the signing key.
- The source SHA, dispatched `main` SHA and workflow-definition SHA must be identical. Normally, a pre-created version tag and an existing stable draft release must resolve to that commit. Explicit replacement instead requires the published stable release and its tag to remain at the supplied `previous_source` full SHA, different from the new source. The signer rechecks the current `main` head, tag and release before signing and again before exporting or uploading. Do not advance `main` until both platform workflows have completed.
- Signing runs on a fresh Ubuntu runner behind the `updater-signing` environment. It performs no checkout, dependency installation or execution of repository scripts or installer payloads. The job uses inline isolated Python, OpenSSL, GitHub CLI and the official standalone Tauri CLI **2.11.5**, downloaded from a fixed release URL and checked against a fixed SHA256.
- The signer fetches one exact artifact from its own workflow run and attempt, verifies GitHub's artifact digest, enforces a flat file allowlist, rejects links and extra files, and compares every file with the build report. Downloads and extraction are bounded; updater packages are limited to **512 MiB**, matching the client's limit. The DMG has a separate 2 GB bound because it is for manual installation.
- Only the short `signer sign --app-version VERSION` step receives the private key. It passes no GitHub token or project environment to the standalone signer and suppresses signer output. The subsequent verification and upload steps do not receive the key.
- Post-signing verification checks the package signature, the signature over the trusted comment, and exactly one `version:` field matching the release version. The platform reports carry artifact/run provenance and file hashes. Final merging repeats signature and version validation and rejects incomplete platforms, mismatched commits, unexpected URLs and modified files. Normal uploads do not overwrite existing release assets or publish the draft. Replacement exports only the signed asset allowlist through a pinned `upload-artifact` action after verification; it never uploads to the public release or changes its tag.

Artifact digests establish which bytes were transferred from a given GitHub run. They do **not** prove that the executable faithfully implements its source or that a dependency is benign. Source inspection, branch policy and the environment approval are separate controls; build reports are treated as data, not as independent attestations of code safety.

### Environment setup must be completed before signing

The workflow requires the environment-only secret **`AIVATAR_RELEASE_SIGNING_PRIVATE_KEY`**, mapped to Tauri's `TAURI_SIGNING_PRIVATE_KEY` variable for the signer process. It deliberately never references the old repository secret named `TAURI_SIGNING_PRIVATE_KEY`.

Before enabling a release:

1. Keep `updater-signing` restricted to the `main` branch, with a required reviewer and administrator bypass disabled.
2. With the owner's explicit authorization, place the dedicated key in that environment's `AIVATAR_RELEASE_SIGNING_PRIVATE_KEY` secret. Keep the signing public key compatible with installed clients and retain the offline backup. Never print the private key or add it to Git/artifacts.
3. Verify that **neither** signing-secret name is present at repository or organization scope, and remove the legacy repository copy after migration. Otherwise an older workflow can still refer to the old broadly available secret, or an environment-secret name could fall back to a repository value.
4. Only after verifying the environment, secret scope and branch/tag protections, set the environment variable `AIVATAR_RELEASE_SIGNING_READY=environment-only-v1`. This is a setup acknowledgement, **not** proof of those protections. Missing readiness or a missing environment key causes signing to stop.

The repository settings were verified on 2026-09-20: `main` rejects force pushes and deletion and applies its protection to administrators; it does not require a pull-request review. The `v*` tag ruleset prevents tag updates/deletion without a bypass. `updater-signing` permits only `main`, requires the owner `ruiwuniu` to approve deployment and disables administrator bypass. Self-approval is allowed because the repository currently has one owner/collaborator. With the owner's authorization, the dedicated key was migrated to the environment-only `AIVATAR_RELEASE_SIGNING_PRIVATE_KEY` secret, the legacy repository secret was removed, and `AIVATAR_RELEASE_SIGNING_READY=environment-only-v1` was set. GitHub metadata confirmed the environment secret exists and neither signing-secret name remains at repository scope; the local key backup was retained. Recheck these settings before each release.

These settings isolate ordinary dependency/build execution from the key. They **do not** protect against compromise of the same owner identity that can edit workflows and approve its own deployment. Resisting that threat requires an independent reviewer/account or an external signing system with a separate trust boundary; this repository does not claim to provide it.

### Prepare and finish a release

Set `VERSION`, `SOURCE_SHA` (the full current `main` commit) and a new empty `ASSETS` directory. Create the matching tag at that commit and an unpublished stable draft with its target set to the same full SHA. Dispatch both workflows from `main`, passing that same `ref` and `tag`, then review and approve their signing jobs in `updater-signing`.

After both workflows succeed:

```sh
gh release download "v$VERSION" --repo ruiwuniu/Aivatar-Demo --dir "$ASSETS"
node scripts/aivatar-updater-release.mjs merge \
  --macos "$ASSETS/updater-macos.json" --windows "$ASSETS/updater-windows.json" \
  --assets-dir "$ASSETS" --version "$VERSION" --source "$SOURCE_SHA" \
  --repo ruiwuniu/Aivatar-Demo --config src-tauri/tauri.conf.json \
  --notes-file "docs/releases/v$VERSION.md" --output "$ASSETS/latest.json" \
  --checksums-output "$ASSETS/updater-release-checksums.json"
gh release upload "v$VERSION" "$ASSETS/latest.json" "$ASSETS/updater-release-checksums.json" --repo ruiwuniu/Aivatar-Demo
```

Review the merged manifest/checksums and the run provenance, then publish the draft as the latest stable release. The new validation requires version-bound signatures.

### Explicit same-version replacement

Use this only when the owner has authorized replacing an already published stable release. Dispatch both workflows from the new current `main` commit with the existing `tag`, the new full `ref`, **`replace_release=true`**, and **`previous_source` set to the exact existing release/tag commit**. The default is `false`; a previous source without explicit replacement, a missing or equal previous source, a draft/prerelease, or a moved tag/release target is rejected. For the original `v0.5.0` repair, the previous source is `90d287fa2c139345fd1c285403d40f2a7ea6924d`.

The workflows leave the public release available throughout building and signing. Each successful platform produces an immutable Actions artifact named `signed-macos-SOURCE_SHA-RUN_ATTEMPT` or `signed-windows-SOURCE_SHA-RUN_ATTEMPT`, retained for seven days. These artifacts contain only the signed installer/update packages, their `.sig` files, `updater-PLATFORM.json`, and the platform checksum report. The reports' `replacement` evidence records the previous source, release ID, and publication/update timestamps; the final guard rejects changes to this context during signing. Download the artifacts from the exact successful run IDs and attempts, verify their GitHub artifact digests and provenance, and require both reports to name the same new source and previous release before using the normal merge command above. The manifest URLs retain the existing version tag.

Only after both platforms and the merged manifest pass verification should the authorized operator back up the original release metadata, assets and tag, then coordinate replacing the assets and retargeting that exact tag/release to the new full source SHA. Any tag-protection exception must be limited to that exact tag and restored immediately afterward; no workflow here changes tag protection or performs the replacement. Upload the verified `latest.json` after its referenced packages and signatures, then verify public downloads and restore the normal protections. Until that final operator step, the existing public release remains unchanged.

A same-version repair does not appear as a newer version to already installed clients. Users of the earlier `0.5.0` package must reinstall the repaired `0.5.0` installer manually to receive its security fixes; a future higher version can be delivered through the updater.

### Local security regression checks

```sh
node scripts/aivatar-updater-release-smoke.mjs
python -m pip install PyYAML==6.0.3
python scripts/security/updater-workflow-smoke.py
```

The workflow smoke uses the actual inline guards, verifier and final routing code, mocked GitHub responses, and synthetic Ed25519 keys held in memory. It covers the normal draft-only path and explicit replacement, including previous-source/tag/release drift and the absence of public uploads in replacement mode. It does not read a real signing key, contact GitHub, run a build or publish anything. It requires OpenSSL 3; use `--openssl /path/to/openssl` if it is not on `PATH`. The nested test directory is excluded from the app's top-level script resource glob.

See [Tauri's updater documentation](https://v2.tauri.app/plugin/updater/) and [Tauri CLI signer options](https://v2.tauri.app/reference/cli/#signer-sign) for the underlying format and version binding.
