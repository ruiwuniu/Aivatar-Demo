# Aivatar updater network bounds

This directory vendors `tauri-plugin-updater` **2.12.0** from crates.io. Original
MIT and Apache-2.0 license files are retained. `UPSTREAM.json` records the original
crate SHA-256 and each copied upstream file's original SHA-256, before these changes.

The application needs stream limits before an untrusted manifest or download can
grow an unbounded allocation. The upstream `Update` context is private, so this
small patch retains upstream manifest selection, cryptographic verification,
signed-version verification, extraction and native installation rather than
reimplementing them in the application.

Changes:

- `src/network_limits.rs`: optional exact HTTPS host/redirect restrictions and a
  shared streamed response reader; Content-Length is an early rejection only.
  Every chunk is checked before allocation, append and progress notification.
  `try_reserve_exact` avoids geometric Vec growth past the logical limit.
- `src/updater.rs`: new optional `UpdaterBuilder::network_limits`; use bounded
  reads for manifest JSON and artifact bytes when configured. Original signature
  and signed-version verification run after the bounded download unchanged.
- `src/lib.rs`: re-export `NetworkLimits`.
- Tests cover real loopback HTTP responses without Content-Length, chunked data,
  truncated/deceptive lengths, exact boundaries and separately delivered chunks;
  tests also verify a public-only synthetic Minisign fixture, altered payloads,
  forged version comments and missing/mismatched signed versions.

The optional API preserves upstream behavior for other callers. Aivatar's native
updater always configures **256 KiB manifest / 512 MiB artifact** limits, at most
five redirects, and exact hosts `github.com` and
`release-assets.githubusercontent.com`. HTTP, credentials, unexpected ports and
other redirect hosts are rejected. Transparent decompression is disabled; Tauri's
archive extraction happens only after signature and signed-version checks.

To verify (no live update endpoint or installer is used):

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-updater --lib
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib app_updater
```

When upgrading upstream, compare against the recorded source, reapply the small
patch, retain the regression tests, and review upstream verification/installer
changes. Do not silently switch back to the unbounded upstream dependency.
