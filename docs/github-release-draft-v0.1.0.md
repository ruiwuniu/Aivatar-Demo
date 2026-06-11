# Aivatar v0.1.0 Windows Preview

This is the first Windows preview build of Aivatar, a Tauri desktop companion for AI coding agents.

Aivatar renders a cozy pixel room where a small companion reacts to local agent activity, keeps local save state, and can follow Codex Desktop sessions through a local-only bridge.

## Highlights

- Windows desktop preview build.
- Pixel-room companion with save slots, inventory, shop, decor, room editing, audio, and local persistence.
- Native Rust/Tauri local status bridge listening on `127.0.0.1`.
- Basic Codex Desktop session discovery from local rollout JSONL files.
- Basic Codex activity watching for thinking, tool use, completion, token usage, and local heuristic learning.
- Codex CLI and Claude Code CLI connection paths for live companion status.
- In-app connected CLI launcher for Codex and Claude Code sessions.
- Task Cabinet support for one-off and scheduled Codex or Claude Code CLI tasks from markdown prompts.
- Token-usage rewards that can grant avatar `bits` for shop purchases after eligible completed sessions.
- Bundled Aivatar Codex session connector under `plugins/aivatar-session-bridge`.
- Bundled connected runner scripts for Start CLI and Task Cabinet flows.
- Local-first privacy boundary: status bridge and session reading are intended for same-machine use.

## Downloads

Attach one or both Windows bundles:

- `Aivatar_0.1.0_x64-setup.exe`
- `Aivatar_0.1.0_x64_en-US.msi`

The local build produced:

- NSIS setup: about 52.66 MB.
- MSI setup: about 53.16 MB.

## Install

1. Download the Windows setup file.
2. Run the installer.
3. Launch Aivatar from the installed shortcut.

Codex and Claude Code are optional. The room and pet systems should work without either tool installed.

## Agent Integration Notes

Codex Desktop integration can work automatically through the native local bridge when Codex Desktop rollout files are available on the same machine.

Start CLI and Task Cabinet connected-launch flows currently require:

- Node.js available on `PATH`.
- The selected agent CLI available on `PATH`, such as `codex` or `claude`.

If Node.js or the selected CLI is missing, Aivatar should show a clear missing-dependency message instead of blocking the app.

When dependencies are available, Aivatar can launch connected Codex or Claude Code CLI sessions from the app. Task Cabinet can also run selected markdown prompts as one-off or scheduled agent tasks. Completed sessions that report token usage can reward the avatar with `bits`, which are spendable in the in-app shop.

## Privacy

Aivatar is local-first. The bridge binds to `127.0.0.1` and is intended for same-machine integrations.

Depending on enabled integrations, Aivatar may read local Codex Desktop session metadata, local rollout JSONL activity, selected markdown task files, and local save data. Do not share raw session files, save files, or temporary learning context files publicly.

See `SECURITY.md` before reporting issues that involve private sessions, local transcripts, or filesystem paths.

## Known Limitations

- This is a preview release.
- The Windows installer has been built locally, but still needs clean-machine or clean-profile installation testing before broad distribution.
- Windows Sandbox testing found that builds using the online WebView2 bootstrapper can stall or launch with `Could not find the WebView2 Runtime`; the current bundle uses the WebView2 offline installer and the offline-installer MSI passed a Sandbox smoke test. This increases installer size.
- Connected CLI launch still depends on Node.js.
- Provider-backed session learning is not hardened for release; the native release path currently uses local heuristic learning.
- A fully Rust-native connected runner is future work.
- GitHub Actions release builds, code signing, notarization, and auto-update support are not configured yet.
- Bundled generated artwork and third-party media have attribution notes, but broad redistribution should review `ATTRIBUTIONS.md`, `public/audio/README.md`, and `public/assets/art/README.md`.

## Local Verification

Verified during release prep on 2026-06-11:

- `npm.cmd run build` passed.
- `cargo check --manifest-path src-tauri\Cargo.toml` passed.
- `npm.cmd run tauri build` completed successfully.
- MSI and NSIS bundles were produced.
- Release output included bundled `scripts` and `aivatar-session-bridge` resources.
- Release exe smoke test confirmed `GET http://127.0.0.1:38988/health` returned `native: true`.
- Port `38988` was confirmed to be owned by the release exe during smoke test.
- Rebuilt WebView2 offline-installer MSI passed Windows Sandbox smoke testing: install exit code `0`, app launched from `C:\Program Files\Aivatar\aivatar.exe`, and `/health` returned `native: true`.

## License

Source code is licensed under the MIT License. Bundled third-party assets may use different terms; see the attribution files for details.
