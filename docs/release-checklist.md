# Aivatar Release Checklist

Use this checklist before publishing a GitHub Release.

## Scope

- First target: Windows preview build.
- Expected user path: install Aivatar, launch it, and use the desktop pet without cloning the repo.
- Agent integrations are optional. Missing Codex or Claude Code installs should produce clear UI messages instead of blocking the room experience.
- Source code is licensed under the MIT license. Bundled third-party assets keep their own documented license terms.
- The Aivatar session connector is bundled under `plugins/aivatar-session-bridge` and packaged as a Tauri resource.
- Current limitation: release builds can start the native Rust/Tauri bridge, detect the bundled connector and script resources, follow basic Codex Desktop session activity, token usage, and local heuristic learning from local rollout JSONL files, and launch the connected runner when Node.js plus the requested agent CLI are installed. Provider-backed session learning and a fully Rust-native connected runner still need release-mode hardening.

## Repository Readiness

- Confirm the top-level license is present and matches the intended code license.
- Confirm asset attribution is complete in `ATTRIBUTIONS.md`, `public/audio/README.md`, and `public/assets/art/README.md`.
- Confirm no personal paths, local save files, API keys, tokens, private transcripts, or raw session logs are committed.
- Decide whether tracked `drafts/` and `screenshots/` files are release documentation assets or should be removed in a separate reviewed change.
- Check that `.gitignore` covers local build output, generated installers, logs, and temporary screenshots.

## Build Verification

- Run `npm.cmd install` on a clean checkout.
- Run `npm.cmd run build`.
- Run the Tauri desktop app in dev mode and verify startup, save slots, room rendering, audio unlock, and local save persistence.
- Build the Windows bundle with Tauri.
- Install the bundle on a machine or Windows profile without the source checkout on PATH.
- Verify the bundled `aivatar-session-bridge` resource exists inside the installed app resources.
- Verify the bundled `scripts` resource exists inside the installed app resources.
- Verify installed-app startup reports that the native bridge started.
- Verify CLI launcher errors are clear when Codex or Claude Code are missing from PATH.
- Verify CLI launcher errors are clear when Node.js is missing from PATH.
- Verify Start CLI can launch a connected Codex or Claude Code session when Node.js and the selected CLI are installed.

### Latest Local Verification

Verified on 2026-06-11:

- `npm.cmd run tauri build` completed successfully.
- Windows MSI bundle was created at `<temp-target>\release\bundle\msi\Aivatar_0.1.0_x64_en-US.msi` at about 53.16 MB.
- Windows NSIS setup bundle was created at `<temp-target>\release\bundle\nsis\Aivatar_0.1.0_x64-setup.exe` at about 52.66 MB.
- Release output includes bundled scripts at `_up_\scripts\`, including `_up_\scripts\aivatar-connected-run.mjs`.
- Release output includes the bundled connector at `_up_\plugins\aivatar-session-bridge\`, including `_up_\plugins\aivatar-session-bridge\scripts\aivatar-heartbeat.mjs`.
- Release exe smoke test stopped the old Node bridge process `17972`, launched `aivatar.exe` as process `30780`, confirmed `GET http://127.0.0.1:38988/health` returned `native: true`, confirmed port `38988` was owned by process `30780`, then stopped process `30780`.
- Windows Sandbox smoke testing found that the earlier NSIS silent install exited with code `2`, and the MSI created the desktop shortcut but stalled while trying to download WebView2 online. Launching Aivatar in Sandbox showed `Could not find the WebView2 Runtime.` The Windows bundle is now configured to use the WebView2 offline installer instead of the online bootstrapper.
- The rebuilt WebView2 offline-installer MSI was verified in Windows Sandbox. The MSI exited with code `0`, installed Aivatar at `C:\Program Files\Aivatar\aivatar.exe`, launched successfully, returned `native: true` from `GET http://127.0.0.1:38988/health`, and owned port `38988` during the smoke test.

Still not verified:

- Installing the MSI or NSIS setup bundle into a clean Windows user profile or VM.
- Launching Aivatar from the installed app shortcut.
- Verifying installed-app save-slot creation, room interaction, theme persistence, and restart persistence.
- Verifying installed-app Start CLI behavior when Node.js is missing from PATH.
- Verifying installed-app Start CLI behavior when Codex or Claude Code is missing from PATH.
- Verifying installed-app connected Codex or Claude Code launch when Node.js and the selected CLI are installed.

## Manual Smoke Test

- Launch Aivatar from the installed app shortcut.
- Create a new save slot.
- Place, move, store, and sell at least one item.
- Change UI theme and restart the app.
- Verify that missing agent integrations do not prevent startup.
- If Codex or Claude Code is installed, launch a simple connected session and verify session status updates.
- Close the app and verify the save is persisted on next launch.

## Release Notes

- Include the release type, for example `Windows preview`.
- List known limitations, especially local bridge and agent integration limitations.
- Link to `SECURITY.md` for sensitive local data reporting guidance.
- Link to attribution files for bundled audio and generated artwork.

## Future Release Work

- Finish release-mode provider-backed session learning and a Rust-native connected runner so users do not need Node/npm for the full Codex Desktop integration.
- Add GitHub Actions for signed or unsigned Windows preview bundles.
- Add code signing and notarization before mainstream Windows/macOS distribution.
- Add automatic update support after the installer format is stable.
