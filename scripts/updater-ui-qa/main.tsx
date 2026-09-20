import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { UpdateSettings, UpdateNotice } from "../../src/updater/UpdateSettings";
import type { UpdateSnapshot } from "../../src/updater/updaterController";
import type { Locale } from "../../src/i18n";
import "../../src/styles.css";

// This page never mounts App, initializes persistence, opens bridge sockets,
// imports the native updater hook, downloads updates or runs an installer.
if (!import.meta.env.DEV || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  throw new Error("Updater UI QA is only available on a local development server.");
}

const base: UpdateSnapshot = {
  revision: 1,
  currentVersion: "0.5.0",
  version: "0.6.0",
  notes: "Aivatar 0.6.0\n\n• New companion animations\n• Smoother desktop wandering\n• Improved save recovery\n\n<script>This must remain plain text.</script>",
  phase: "available",
  downloadedBytes: 0,
};
const fixtures: UpdateSnapshot[] = [
  base,
  { ...base, phase: "downloading", downloadedBytes: 46, totalBytes: 100 },
  { ...base, phase: "downloaded", downloadedBytes: 100, totalBytes: 100 },
  { ...base, phase: "downloaded", error: "A room could not finish saving. Your rooms remain open; retry when saving is available." },
];

const PreviewCard = ({ initial, locale }: { initial: UpdateSnapshot; locale: Locale }) => {
  const [state, setState] = useState(initial);
  const [opened, setOpened] = useState(true);
  const updater = {
    state,
    check: async () => { setState({ ...state, phase: "idle", checkedAt: Date.now(), version: null, notes: null, error: null }); },
    download: async () => {
      setState({ ...state, phase: "downloading", downloadedBytes: 30, totalBytes: 100 });
      window.setTimeout(() => setState({ ...state, phase: "downloaded", downloadedBytes: 100, totalBytes: 100 }), 1_200);
    },
    install: async () => {
      setState({ ...state, phase: "saving", error: null });
      window.setTimeout(() => setState({ ...state, phase: "downloaded", error: "Synthetic save failure: interaction resumed; retry is available." }), 1_200);
    },
  };
  return <aside className="side-panel" style={{ width: "auto", height: "auto", minHeight: 0, overflow: "visible" }}>
    <p style={{ marginTop: 0 }}>Fixture: {initial.phase}{initial.error ? " / retry" : ""}</p>
    <UpdateNotice updater={updater} locale={locale} onOpen={() => setOpened(true)} />
    {opened ? <UpdateSettings updater={updater} locale={locale} /> : null}
    <button className="pixel-button" style={{ marginTop: 12 }} onClick={() => { setState(initial); setOpened(true); }}>Reset fixture</button>
  </aside>;
};

const Preview = () => {
  const [locale, setLocale] = useState<Locale>("zh-Hans");
  const [theme, setTheme] = useState("terminal");
  return <main className={`app-shell theme-${theme}`} style={{ width: "100%", maxWidth: 1100, margin: "0 auto", height: "auto", minHeight: "100vh", overflow: "visible", display: "block", padding: 20 }}>
    <h1 style={{ fontSize: 20 }}>Updater UI · isolated preview</h1>
    <p>No network requests, persistence or real installers.</p>
    <label>Language <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
      <option value="zh-Hans">简体中文</option><option value="zh-Hant">繁體中文</option><option value="en">English</option>
    </select></label>{" "}
    <label>Theme <select value={theme} onChange={(event) => setTheme(event.target.value)}>
      <option value="terminal">Terminal</option><option value="classic">Classic</option><option value="starship">Starship</option><option value="arcade">Arcade</option>
    </select></label>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 16, marginTop: 20 }}>
      {fixtures.map((fixture, index) => <PreviewCard key={index} initial={fixture} locale={locale} />)}
    </div>
  </main>;
};

document.body.style.overflow = "auto";
createRoot(document.getElementById("root")!).render(<Preview />);
