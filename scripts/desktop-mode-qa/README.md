# Native desktop-mode QA

These helpers are only for a freshly generated synthetic native profile. They do not read installed Aivatar saves, real agent sessions, or personal data; they never launch the installed application or remove files. Native profile validation gives each run a separate bundle identifier, WebKit data-store UUID, app-data directory, and single-instance lock. Native integrations/discovery and bridge ports 38987/38988 are disabled by the existing synthetic isolation code.

From the repository root:

```sh
node scripts/desktop-mode-qa/prepare-native-profile.mjs --port=1457
```

Use the printed `/tmp/aivatar-desktop-qa-XXXXXX` path in the three commands below. The first builds the actual Tauri debug executable. Keep the second running and start the third separately:

```sh
node /tmp/aivatar-desktop-qa-XXXXXX/run.mjs build
node /tmp/aivatar-desktop-qa-XXXXXX/run.mjs vite
node /tmp/aivatar-desktop-qa-XXXXXX/run.mjs launch
```

The default Cargo target is inside the new synthetic root. To reuse a known **QA-only** compilation cache, set `AIVATAR_QA_CARGO_TARGET` to the same absolute path for build and launch. Do not use the installed app. Do not set `AIVATAR_SYNTHETIC_PHASE`, which would activate a different persistence harness instead of the real App. macOS 14 or later is required by the existing native WebKit isolation check.

For native UI automation that requires a macOS bundle, create a fresh `.app` from the finished synthetic debug build:

```sh
node scripts/desktop-mode-qa/bundle-native-profile.mjs --profile /tmp/aivatar-desktop-qa-XXXXXX --binary /absolute/qa-target/debug/aivatar
```

This prints a new absolute `.app` path named `Aivatar Desktop QA ...app`, with the profile's exact synthetic bundle identifier and a launcher that supplies its mandatory profile environment. It does not launch or stop anything. After the coordinating task stops its own previous QA child, target this exact `.app` path in the native automation tool. Keep the isolated Vite server running. Every packaging invocation creates a new bundle rather than replacing an earlier one.

Create a fresh character through the app UI. The native app now uses the real React App, renderer, persistence implementation, desktop native commands, and status hook; only external agent events are synthetic. Change the generated `control.json` with a new numeric `revision` to inject a status without running or contacting a bridge:

```json
{ "revision": 2, "status": "executing", "message": "Synthetic QA: implementing desktop mode" }
```

Supported statuses: `idle`, `thinking`, `executing`, `waiting_for_user`, `complete`, `error`. A new revision writes a bounded DOM/canvas/status report under the generated profile's `reports/` directory. These diagnostics supplement native screenshots and UI interaction; they do not replace visual acceptance.

Check real native transparency and click-through, independent character/computer dragging, computer depth, idle wandering/bubbles, task approach/typing/status bubbles, right-click room return, repeated toggles, persisted positions after restart, visible-area clamping, and no duplicate reward settlement. Restart with the **same** runner/profile for persistence QA. Retain all profiles/artifacts; terminate only the specific test child processes you created.
