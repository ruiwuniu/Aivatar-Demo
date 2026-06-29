import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

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
            The room UI hit an unexpected error. Your local save remains in
            browser storage.
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
