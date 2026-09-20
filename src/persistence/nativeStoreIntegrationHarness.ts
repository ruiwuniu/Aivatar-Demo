// Runs only when the debug native shell has verified a generated synthetic
// profile. This module never connects to the live status bridge.
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { appStorage, drainStore, initializeSaveStore, subscribeStore } from "./saveStore";
import { installCloseSaveHandler } from "./closeSave";

const COUNTER = "aivatar.socialRoomMemory.v1.synthetic-counter";
const MIRROR = "aivatar.socialRoomMemory.v1.synthetic-mirror";
const CHECKPOINT = "aivatar.socialRoomMemory.v1.synthetic-checkpoint";
const CLOSE = "aivatar.socialRoomMemory.v1.synthetic-close-";
type Report = { stage: string; role: string; phase: string; [key: string]: unknown };
type Status = { windows: string[]; reports: Record<string, Report> };
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const control = <T = unknown>(action: string, peer: string | null = null, report: unknown = null) =>
  invoke<T>("save_store_synthetic_control", { action, peer, report });
const until = async <T>(get: () => Promise<T> | T, accept: (value: T) => boolean, label: string, timeout = 25_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await get();
    if (accept(value)) return value;
    await sleep(50);
  }
  throw new Error(`Synthetic native integration timed out: ${label}`);
};

export const runNativeStoreHarness = async ({ mountApplication }: { mountApplication: () => Promise<void> }) => {
  assert((window as unknown as Record<string, unknown>).__AIVATAR_SYNTHETIC_NETWORK_ISOLATED__ === true,
    "The marked debug native profile is required");
  const params = new URLSearchParams(location.search);
  const role = params.get("role") ?? "main";
  const phase = params.get("phase") ?? "initial";
  const audit = { localStorageAccessesAfterMigration: 0, localEvents: 0, remoteEvents: 0 };
  const report = (stage: string, extra: Record<string, unknown> = {}) =>
    control("report", null, { stage, role, phase, audit: { ...audit }, ...extra });
  let legacyBlocked = false;
  const blockLegacy = () => {
    if (legacyBlocked) return;
    legacyBlocked = true;
    const deny = () => {
      audit.localStorageAccessesAfterMigration += 1;
      throw new Error("Synthetic check caught localStorage access after native activation");
    };
    Object.defineProperty(window, "localStorage", { configurable: true, get: deny });
    for (const method of ["getItem", "setItem", "removeItem", "clear", "key"] as const) {
      Object.defineProperty(Storage.prototype, method, { configurable: true, value: deny });
    }
    Object.defineProperty(Storage.prototype, "length", { configurable: true, get: deny });
  };
  const readFresh = async (key: string) => appStorage.transact(view => ({ changes: {}, result: view.getItem(key) }));

  try {
    if (role === "main" && phase === "initial") {
      // The first phase uses a legacy-only save so the real migration adapter
      // must atomically derive the slot, registry and active-slot reference.
      localStorage.setItem("aivatar.save.v1", JSON.stringify({
        avatarId: "avatar-native-synthetic", roomId: "room-native-synthetic",
        avatarName: "Native Synthetic", avatarAppearanceId: "octopus",
        wallet: { bits: 200, pokerChips: 10 }, inventory: [], placedItems: [], purchasedItemIds: [],
        petStats: { energy: 80, mood: 80, hunger: 80 },
      }));
      localStorage.setItem("aivatar.locale.v1", "en");
      localStorage.setItem("aivatar.audioVolume.v1", "0");
    } else {
      // Peers and every restarted process must initialize from native storage
      // without even requesting a localStorage object.
      blockLegacy();
    }
    await initializeSaveStore();
    blockLegacy();
    subscribeStore(event => {
      if (event.source === "local") audit.localEvents += 1;
      else audit.remoteEvents += 1;
    });

    if (["card-room", "park", "park-developer"].includes(role)) {
      assert(params.get("hostSlotId") === appStorage.getItem("aivatar.activeSaveSlot.v1"),
        `${role} did not receive the migrated active slot`);
      await mountApplication();
      const selector = role === "card-room" ? ".card-room-app" : role === "park" ? ".park-app" : ".park-developer-app";
      await until(() => document.querySelector(selector), element => element !== null, `real ${role} mounted`);
      await sleep(1200);
      await drainStore();
      assert(!document.querySelector(".app-error-boundary"), `${role} rendered an error boundary`);
      assert(audit.localStorageAccessesAfterMigration === 0, `${role} touched legacy localStorage`);
      await report("view-passed", { view: role, hostSlotId: params.get("hostSlotId"), uiMounted: true });
      await control("request-close");
      return;
    }

    if (role !== "main") {
      let closeAttempts = 0;
      await installCloseSaveHandler(async () => {
        closeAttempts += 1;
        if (role === "beta" && closeAttempts === 1) {
          await report("close-rejected", { closeAttempts });
          return { ok: false, written: false };
        }
        await appStorage.setItem(CLOSE + role, JSON.stringify({ role, closeAttempts, persisted: true }));
        await drainStore();
        await report("close-saved", { closeAttempts });
        return { ok: true, written: true };
      }, { onFailure: () => undefined });
      let running = false;
      await getCurrentWebviewWindow().listen("aivatar://synthetic-work", () => {
        if (running) return;
        running = true;
        void (async () => {
          const commitMilliseconds: number[] = [];
          for (let index = 0; index < 8; index += 1) {
            const started = performance.now();
            await appStorage.transact(view => {
              const current = Number(view.getItem(COUNTER) ?? "0");
              assert(Number(view.getItem(MIRROR) ?? "0") === current, "Atomic counter/mirror diverged");
              return { changes: { [COUNTER]: String(current + 1), [MIRROR]: String(current + 1) }, result: null };
            });
            commitMilliseconds.push(performance.now() - started);
          }
          await report("work-complete", { commitMilliseconds });
        })().catch(error => report("failed", { error: String(error) }));
      });
      document.body.textContent = `Synthetic native peer ${role}: ready`;
      await report("ready");
      return;
    }

    const slotId = appStorage.getItem("aivatar.activeSaveSlot.v1");
    assert(slotId, "Migration did not create an active save slot");
    const slotKey = `aivatar.saveSlot.v1.${slotId}`;
    const save = () => JSON.parse(appStorage.getItem(slotKey) ?? "null") as {
      wallet: { bits: number }; inventory: { itemId: string; quantity: number }[];
    };
    const checkpointRaw = appStorage.getItem(CHECKPOINT);
    if (phase !== "initial") {
      assert(checkpointRaw, "Committed checkpoint did not survive restart");
      const checkpoint = JSON.parse(checkpointRaw) as Record<string, unknown>;
      assert(appStorage.getItem("aivatar.uiTheme.v1") === checkpoint.theme, "UI theme did not survive restart");
      assert(save().wallet.bits === checkpoint.bits, "Purchased wallet value did not survive restart");
      assert(save().inventory.find(item => item.itemId === "cookie")?.quantity === checkpoint.cookies,
        "Purchased inventory did not survive restart");
      assert(Number(appStorage.getItem(COUNTER)) === 16, "Multiwindow commits did not survive restart");
      if (phase === "after-crash") assert(checkpoint.crashCommitted === true, "Crash checkpoint was lost");
    }

    if (phase === "initial") {
      await appStorage.transact(() => ({ changes: { [COUNTER]: "0", [MIRROR]: "0" }, result: null }));
      await Promise.all([control("open-peer", "alpha"), control("open-peer", "beta")]);
      await until(() => control<Status>("status"), state => ["alpha", "beta"].every(peer => state.reports[`save-slot-synthetic-${peer}`]?.stage === "ready"), "two native peers ready");
      await Promise.all([control("start-work", "alpha"), control("start-work", "beta")]);
      const worked = await until(() => control<Status>("status"), state => ["alpha", "beta"].every(peer => state.reports[`save-slot-synthetic-${peer}`]?.stage === "work-complete"), "two native writers complete");
      assert(Number(await readFresh(COUNTER)) === 16 && Number(await readFresh(MIRROR)) === 16,
        "Concurrent native transactions lost an update or a batch member");
      await report("multiwindow-passed", { peers: worked.reports });

      await control("request-close", "alpha");
      await until(() => control<Status>("status"), state => !state.windows.includes("save-slot-synthetic-alpha"), "saved peer closes");
      assert(await readFresh(CLOSE + "alpha"), "Peer closed before its final save persisted");
      await control("request-close", "beta");
      const rejected = await until(() => control<Status>("status"), state => state.reports["save-slot-synthetic-beta"]?.stage === "close-rejected", "failed close rejected");
      assert(rejected.windows.includes("save-slot-synthetic-beta"), "Failed save incorrectly closed the window");
      await sleep(150);
      await control("request-close", "beta");
      await until(() => control<Status>("status"), state => !state.windows.includes("save-slot-synthetic-beta"), "retry close succeeds");
      assert(await readFresh(CLOSE + "beta"), "Retry close did not persist its final save");
      for (const [view, command] of [["card-room", "open_card_room_window"], ["park", "open_park_window"], ["park-developer", "open_park_developer_window"]]) {
        const { label } = await invoke<{ label: string }>(command, { request: { host_slot_id: slotId } });
        const mounted = await until(() => control<Status>("status"), state => {
          const result = state.reports[label];
          if (result?.stage === "failed") throw new Error(`${view}: ${String(result.error)}`);
          return result?.stage === "view-passed" && !state.windows.includes(label);
        }, `real ${view} mounted and closed`);
        assert((mounted.reports[label].audit as typeof audit).localStorageAccessesAfterMigration === 0,
          `${view} accessed localStorage`);
      }
    }

    const url = new URL(location.href);
    url.searchParams.set("slotId", slotId);
    history.replaceState(null, "", url);
    await mountApplication();
    await until(() => document.querySelector<HTMLButtonElement>("button.settings-toggle:not(.entertainment-toggle)"), button => button !== null, "real application mounted");

    if (phase === "initial") {
      const beforeTheme = appStorage.getItem("aivatar.uiTheme.v1");
      document.querySelector<HTMLButtonElement>("button.settings-toggle:not(.entertainment-toggle)")!.click();
      const theme = await until(() => document.querySelector<HTMLButtonElement>("button.theme-button:not(.active)"), button => button !== null, "theme controls");
      theme!.click();
      await until(() => appStorage.getItem("aivatar.uiTheme.v1"), value => value !== beforeTheme && value !== null, "theme committed from UI");
      await drainStore();

      await until(() => document.querySelectorAll<HTMLButtonElement>(".shop-category-tab"), tabs => tabs.length > 3, "shop controls");
      document.querySelectorAll<HTMLButtonElement>(".shop-category-tab")[3].click();
      const cookie = await until(() => [...document.querySelectorAll<HTMLButtonElement>("button.shop-button")].find(button => /Cookie/.test(button.title || button.textContent || "")), button => Boolean(button), "Cookie purchase");
      assert(cookie && !cookie.disabled, "Cookie purchase is unavailable");
      const before = save();
      const quantity = before.inventory.find(item => item.itemId === "cookie")?.quantity ?? 0;
      cookie.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      cookie.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      cookie.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      await until(() => save(), next => next.wallet.bits === before.wallet.bits - 6 && next.inventory.some(item => item.itemId === "cookie" && item.quantity === quantity + 1), "purchase committed from real UI");
      await drainStore();
      await appStorage.setItem(CHECKPOINT, JSON.stringify({ slotId, theme: appStorage.getItem("aivatar.uiTheme.v1"), bits: save().wallet.bits, cookies: quantity + 1, crashCommitted: false }));
    }
    if (phase === "crash") {
      const checkpoint = JSON.parse(appStorage.getItem(CHECKPOINT)!);
      await appStorage.setItem(CHECKPOINT, JSON.stringify({ ...checkpoint, crashCommitted: true }));
    }
    await drainStore();
    await sleep(500);
    assert(audit.localStorageAccessesAfterMigration === 0, "Mounted application touched legacy localStorage");
    const nativeDiagnostics = await control<{ journalMode: string; synchronous: number }>("diagnostics");
    assert(nativeDiagnostics.journalMode === "delete" && nativeDiagnostics.synchronous === 3,
      "Live native writer is not configured as DELETE/EXTRA");
    await report("passed", { nativeDiagnostics, slotId, theme: appStorage.getItem("aivatar.uiTheme.v1"), bits: save().wallet.bits,
      cookies: save().inventory.find(item => item.itemId === "cookie")?.quantity, counter: Number(appStorage.getItem(COUNTER)),
      uiMounted: true, realUiPurchase: phase === "initial", realUiTheme: phase === "initial" });
    await control(phase === "crash" ? "crash" : "request-close");
  } catch (error) {
    await report("failed", { error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error) });
    console.error("Synthetic native persistence integration failed", error);
    document.body.insertAdjacentText("afterbegin", `Synthetic persistence test failed: ${String(error)}`);
  }
};
