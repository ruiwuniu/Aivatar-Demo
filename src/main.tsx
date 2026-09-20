import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CardRoomApp } from "./cardRoom/CardRoomApp";
import { ParkApp } from "./park/ParkApp";
import { ParkAnimationPreviewApp } from "./park/ParkAnimationPreviewApp";
import { ParkDeveloperApp } from "./park/ParkDeveloperApp";
import "./styles.css";
import "./park/park.css";
import { initializeSaveStore } from "./persistence/saveStore";
import { retryPendingSaves } from "./persistence/closeSave";

interface AppErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Aivatar render error", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-error-boundary" role="alert">
        <section className="app-error-panel">
          <p className="app-error-kicker">Aivatar</p>
          <h1>Rendering Error</h1>
          <p>
            The room UI hit an unexpected error. Previously committed saves
            remain in local application storage.
          </p>
          <pre>{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}

const view = new URLSearchParams(window.location.search).get("view");
const RootApp =
  view === "card-room"
    ? CardRoomApp
    : view === "park"
      ? ParkApp
      : view === "park-animation-preview"
        ? ParkAnimationPreviewApp
      : view === "park-developer"
        ? ParkDeveloperApp
        : App;

const StorageStatus = () => {
  const [error, setError] = React.useState("");
  const [retrying, setRetrying] = React.useState(false);
  React.useEffect(() => {
    const onError = (event: Event) => setError(String((event as CustomEvent).detail));
    window.addEventListener("aivatar:storage-error", onError);
    return () => window.removeEventListener("aivatar:storage-error", onError);
  }, []);
  if (!error) return null;
  return <aside role="alert" style={{ position: "fixed", zIndex: 100000, inset: "0 0 auto", padding: 12, background: "#422", color: "white" }}>
    Saving failed. Your window will stay open if saving cannot finish. {error}
    <button disabled={retrying} onClick={async () => {
      setRetrying(true);
      try { await retryPendingSaves(); setError(""); }
      catch (failure) { setError(String(failure)); }
      finally { setRetrying(false); }
    }}>{retrying ? "Saving…" : "Retry save"}</button>
  </aside>;
};

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const mountApplication = async () => {
  await initializeSaveStore();
  root.render(<React.StrictMode><AppErrorBoundary><StorageStatus /><RootApp /></AppErrorBoundary></React.StrictMode>);
};
const start = async () => {
  root.render(<main role="status">Opening local saves…</main>);
  try {
    if ((window as unknown as Record<string, unknown>).__AIVATAR_SYNTHETIC_NETWORK_ISOLATED__ === true
      && new URLSearchParams(location.search).has("nativeStoreHarness")) {
      const { runNativeStoreHarness } = await import("./persistence/nativeStoreIntegrationHarness");
      await runNativeStoreHarness({ mountApplication });
    } else {
      await mountApplication();
    }
  } catch (error) {
    root.render(<main role="alert" className="app-error-boundary"><section className="app-error-panel">
      <h1>Could not open local saves</h1>
      <p>Your existing data has been retained. No empty save was created.</p>
      <pre>{String(error)}</pre>
      <button onClick={() => void start()}>Retry</button>
    </section></main>);
  }
};
void start();
