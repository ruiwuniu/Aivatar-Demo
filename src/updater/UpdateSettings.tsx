import { t, type Locale } from "../i18n";
import { updateIsBusy, updateProgress } from "./updaterController";
import type { AppUpdater } from "./useAppUpdater";
import "./updater.css";

export const UpdateSettings = ({ updater, locale }: { updater: AppUpdater; locale: Locale }) => {
  const { state } = updater;
  const copy = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const percent = updateProgress(state);
  const busy = updateIsBusy(state.phase);
  return <section className="app-update-settings" aria-label={copy("update.title")}>
    <div className="app-update-heading">
      <strong>{copy("update.title")}</strong>
      {state.currentVersion ? <small>v{state.currentVersion}</small> : null}
    </div>
    <p role="status" aria-live="polite">
      {copy(state.phase === "idle" && state.checkedAt ? "update.latest" : `update.phase.${state.phase}`, { version: state.version ?? "" })}
    </p>
    {state.version && state.notes ? <details className="app-update-notes">
      <summary>{copy("update.notes")}</summary>
      <pre>{state.notes}</pre>
    </details> : null}
    {state.phase === "downloading" ? <div className="app-update-progress">
      <progress max={100} value={percent ?? undefined} aria-label={copy("update.downloading")} />
      <small>{percent === null ? copy("update.downloading") : `${percent}%`}</small>
    </div> : null}
    {state.error ? <p className="app-update-error" role="alert">{copy("update.error")} {state.error}</p> : null}
    <div className="app-update-actions">
      <button type="button" className="pixel-button" disabled={busy || state.phase === "disabled"} onClick={() => void updater.check()}>
        {copy("update.check")}
      </button>
      {state.phase === "available" ? <button type="button" className="pixel-button" onClick={() => void updater.download()}>
        {copy("update.download", { version: state.version ?? "" })}
      </button> : null}
      {state.phase === "downloaded" ? <button type="button" className="pixel-button" onClick={() => void updater.install()}>
        {copy("update.install")}
      </button> : null}
    </div>
    {state.phase !== "disabled" ? <small className="app-update-hint">{copy("update.hint")}</small> : null}
  </section>;
};

export const UpdateNotice = ({ updater, locale, onOpen }: {
  updater: AppUpdater; locale: Locale; onOpen: () => void;
}) => {
  if (!["available", "downloading", "downloaded", "saving", "installing"].includes(updater.state.phase)) return null;
  return <button type="button" className="pixel-button app-update-notice" onClick={onOpen}>
    {t(locale, "update.notice", { version: updater.state.version ?? "" })}
  </button>;
};
