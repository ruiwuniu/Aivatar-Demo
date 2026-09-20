# Runtime native store tests

This independent crate imports the actual new `src-tauri/src/save_store.rs` module
and runs its unit tests without Tauri, a WebView, agent discovery or the status
bridge. It does not modify production manifests or lockfiles. All SQLite files
are newly generated synthetic fixtures under `synthetic-test-data/`; fixtures remain on disk and are ignored locally. Build output uses the separate repository-root
`.aivatar-native-storage-validation/target` directory. There is no cleanup command.

```sh
# Run from the repository root. Keep compiler output outside scripts/.
DEVELOPER_DIR=/Library/Developer/CommandLineTools \
  CARGO_TARGET_DIR="$PWD/.aivatar-native-storage-validation/target" \
  cargo test --manifest-path scripts/wal-diagnostics/save-store-rust-tests/Cargo.toml \
  --offline --locked -- --nocapture
```

The pre-release core suite passed **21 tests** (20 substantive scenarios and one
subprocess worker entry). Run the command above to reproduce the checks on the
current platform; timings and reports are produced locally and are not shipped
as installer resources.
Bundled SQLite is 3.46.0.
The tests cover the production module's DELETE/EXTRA configuration, exact raw
migration text, restart readback, 16-window CAS contention, atomic preconditions,
SQL failure rollback, tombstones, bounded receipts, replay of success/conflict/error,
window binding/session expiry, unchanged-value no-op, eight concurrent initializers,
retryable failed/pending migration, missing database with activation marker,
corruption, missing activation marker, initial schema interruption, allowlist/size
limits and abrupt process loss during writes and migration. Additional cases
verify post-COMMIT uncertainty for both normal writes and migration, delayed old
window cleanup after a same-label reopen, and separate development/release
storage namespaces.

The synthetic overwrite workload ran 1,000 updates of a 20,007-byte value. The database grew from 40,960 to 57,344 bytes, and the peak sampled
after each commit was also 57,344 bytes. One latest receipt remained for the one
live session. Final exact string readback passed after reopening. Each overwrite
fixture retains `metrics.json`. These measurements are one short workload, not a
throughput guarantee or an instantaneous rollback-journal size bound.

Crash workers deliberately exit without Rust/SQLite destructors after forcing
cache spill. Before recovery the parent verifies journal size, magic and a
nonzero record count. Pending migration then has no imported/raw rows and can
retry; a previously committed state survives the write interruption. This tests
process interruption, not power failure or torn device writes.

A COMMIT-phase error cannot reliably mean rollback under DELETE/EXTRA: directory
synchronization may fail after the commit becomes visible. The store returns an
uncertain receipt and freezes all new writes/read/bootstrap until process restart.
Tests inject a failure after a real successful commit and verify no duplicate
retry is allowed; they do not inject an actual filesystem fsync failure. Migration
uses the same conservative rule. An explicit restart reads the committed state.

Window authorization uses a creation generation; delayed cleanup only expires
that generation. A bootstrap already queued when a window dies cannot register a
new authorized session. Non-synthetic debug builds use `storage-v2-development`
so localhost's legacy source cannot activate the release `storage-v2` database.

The activation marker is established before migration starts. Its existence with
a missing database fails closed. Pending migrations retain the database/marker
and are retryable; invalid activation bytes or a complete database without a marker
require explicit recovery. macOS/POSIX directory synchronization is requested;
Windows filesystem durability and macOS `fullfsync` are separate deployment tests.

Actual Tauri application checks should use the separate
`../prepare-synthetic-profile.mjs` generator and its explicit marker/environment.
The Rust unit-test results do not establish frontend integration, the complete
shutdown handshake, installed-app behavior or a 24–48-hour run.
