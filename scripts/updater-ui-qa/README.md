# Isolated updater UI preview

Run Vite on an unused local port, for example:

```sh
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1468 --strictPort
```

Open `http://127.0.0.1:1468/scripts/updater-ui-qa/index.html`.
The preview uses the production update components and theme CSS, with only
in-memory synthetic snapshots. It does not mount the main app, initialize its
save store, connect to a status bridge, import the native updater hook, or
request/install a real update. It is restricted to Vite development mode on a
loopback hostname and is not included in the production build entry points.

Review available, downloading, downloaded and save-failure states in the three
supported UI languages. Expand release notes to confirm plain-text rendering.
The synthetic Download button briefly shows progress; Install briefly shows
saving and then a retryable synthetic error. Neither action performs I/O.

Run the in-memory controller, rendering and save-barrier regression checks:

```sh
node scripts/aivatar-updater-frontend-smoke.mjs
node scripts/aivatar-close-save-smoke.mjs
```
