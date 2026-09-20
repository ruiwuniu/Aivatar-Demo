# Desktop storage in Aivatar 0.4.5

Desktop saves and settings use application-owned SQLite instead of WebView
localStorage. The database is `storage-v2/app-state.sqlite3` under Tauri's app-data
directory. Development builds use `storage-v2-development` so a localhost preview
cannot activate the release database with an unrelated or empty legacy origin.
Browser-only previews continue to use their own origin's localStorage.

## Upgrade and recovery

On the first desktop launch, Aivatar validates recognized legacy saves and imports
them in one transaction before opening the UI. It retains the original strings
and leaves the old localStorage keys and WebKit files in place. After migration,
desktop application code uses the new store without reading or writing
localStorage. The upgrade does not truncate or delete an existing WebKit WAL.

Unreadable or malformed critical saves stop migration with an error. A missing
or corrupt database after activation also fails closed: it does not silently
reimport an older legacy copy or start a blank save.

The new store uses SQLite `journal_mode=DELETE` and `synchronous=EXTRA`. A shared
native writer, per-key revisions and atomic multi-key transactions protect slot
registries and economic changes across windows. Responses lost after commit are
retried with the same operation ID. An uncertain commit freezes further writes
until restart instead of rebuilding a potentially duplicated business operation.

Closing waits for controller drafts and queued writes to commit. Failure keeps
the window open and preserves retryable progress. Events received while saving
or switching characters remain associated with the character that received them.

Use **Export current character save** after saving to obtain a compatible JSON
copy. Older versions only see the pre-migration legacy state; returning to an old
version does not automatically transfer new progress. Character export is not a
backup of all global settings, the house bank or the task cabinet.

## Validation and reproducible checks

Before the 0.4.5 release, synthetic macOS tests passed for migration, concurrent
transactions, close failure/retry, real main-room purchases and settings,
Card Room/Park/Developer windows, normal restart and abrupt process exit followed
by restart. The tested windows made zero legacy localStorage calls after
migration. The live native connection reported SQLite 3.46.0, DELETE and EXTRA.

The TypeScript/JavaScript persistence checks cover 98 scenarios. The standalone
Rust crate covers 20 substantive scenarios plus its subprocess worker entry,
including rollback, tombstones, bounded receipts, interrupted migration,
uncertain commit, corruption and window-session lifetime. A fixed 20,007-byte
value overwritten 1,000 times grew the test database from 40,960 to 57,344 bytes;
the final value survived reopening. This is a bounded synthetic workload, not a
long-term storage-size guarantee.

```sh
npm ci
npm run build
node scripts/aivatar-save-store-smoke.mjs
node scripts/aivatar-save-persistence-smoke.mjs
node scripts/aivatar-room-save-persistence-smoke.mjs
node scripts/aivatar-park-persistence-smoke.mjs
node scripts/aivatar-close-save-smoke.mjs
node scripts/aivatar-card-room-close-save-smoke.mjs
```

Native core commands are in the [test crate README](../scripts/wal-diagnostics/save-store-rust-tests/README.md).
On macOS, `node scripts/wal-diagnostics/run-native-store-integration.mjs --port=1447`
builds a separately identified synthetic profile, blocks agent integrations and
retains its reports and test data. It does not open the installed application's
data. Mounted UI checks are also available in the persistence, pause and shop UI
smoke scripts and require Chrome.

Release installers are built from the same pinned source commit. Installer
construction and checksum checks are separate from clean-machine installation.
These tests do not establish 24–48-hour continuous operation, actual power-loss
behavior or all production user-data migrations. Existing WAL files should not
be manually deleted while the application is running.
