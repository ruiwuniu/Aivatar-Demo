import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createUpdaterController, type UpdateSnapshot } from "./updaterController";

const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const synthetic = typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>).__AIVATAR_SYNTHETIC_NETWORK_ISOLATED__ === true;
const development = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

const updater = createUpdaterController(native && !synthetic ? {
  invoke: (command, args) => invoke<UpdateSnapshot>(command, args),
  listen: async (receive) => listen<UpdateSnapshot>("aivatar://updater-state", (event) => receive(event.payload)),
} : null, !development && !synthetic);

export const useAppUpdater = () => {
  const state = useSyncExternalStore(updater.subscribe, updater.getSnapshot, updater.getSnapshot);
  return { state, check: updater.check, download: updater.download, install: updater.install };
};

export type AppUpdater = ReturnType<typeof useAppUpdater>;
