import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Source-only fixtures: no app launch, real save, bridge, or user data access.
const root = fileURLToPath(new URL("../", import.meta.url));
const source = (relative) => readFileSync(path.join(root, relative), "utf8");
const transpile = (text, fileName = "fixture.ts") => ts.transpileModule(text, {
  fileName, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modules = new Map();
const load = (relative) => {
  if (modules.has(relative)) return modules.get(relative).exports;
  if (relative === "src/persistence/saveStore.ts") {
    return { appStorage: new Proxy({}, { get() { throw new Error("Test must not access storage"); } }) };
  }
  assert(relative.startsWith("src/") && !relative.includes(".."), "Unexpected module path");
  const module = { exports: {} };
  modules.set(relative, module);
  new Function("require", "module", "exports", transpile(source(relative), relative))(
    (specifier) => {
      assert(specifier.startsWith("."), `Unexpected external module: ${specifier}`);
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${specifier}.ts`)));
    }, module, module.exports,
  );
  return module.exports;
};
const transactions = load("src/desktop/desktopVendingTransactions.ts");
const shop = load("src/shopPurchase.ts");
const roomVisits = load("src/game/roomVisits.ts");
const appText = source("src/App.tsx");
const appAst = ts.createSourceFile("src/App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializer = (name) => {
  const found = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === name && node.initializer) found.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(appAst);
  assert.equal(found.length, 1, `Expected one production declaration: ${name}`);
  return found[0].getText(appAst);
};
const bind = (name, context) => {
  context[name] = new Function(...Object.keys(context),
    `${transpile(`const result = (${initializer(name)});`)}\nreturn result;`,
  )(...Object.values(context));
  return context[name];
};
const memoryContext = { ...roomVisits };
for (const name of ["MAX_TRAIT_POINTS", "MEMORY_RECENT_EVENT_LIMIT", "IDLE_BUBBLE_LANGUAGE_OPTIONS",
  "IDLE_BUBBLE_PHRASE_MAX_LENGTH", "COFFEE_ITEM_ID", "COLA_ITEM_ID", "BENTO_ITEM_ID", "COOKIE_ITEM_ID",
  "defaultGrowthTraits", "defaultDarkTraits", "defaultMemory", "clampTrait", "normalizeDarkTraits",
  "normalizeIdleBubblePhrase", "normalizeIdleBubbleLanguage", "normalizeMemory", "applyTraitChanges",
  "appendMemoryEvent", "memoryEventRecentlyRecorded", "recordLifeMemory",
  "traitChangesForConsumable", "behaviorForConsumable", "traitChangesForPurchase"]) bind(name, memoryContext);

const makeHarness = () => {
  const content = JSON.parse(source("public/config/aivatar.config.json"));
  const initial = {
    avatarId: "synthetic-vending-avatar", wallet: { bits: 100, pokerChips: 37 },
    petStats: { energy: 20, mood: 30, hunger: 40 },
    inventory: [{ itemId: "cookie", quantity: 3 }, { itemId: "coffee", quantity: 2 }],
    furnitureStorage: [{ furnitureId: "table", itemId: "coffee", quantity: 2 }],
    placedItems: [], purchasedItemIds: [], memory: memoryContext.defaultMemory(),
  };
  const flags = { closing: false, busy: false };
  let updates = 0;
  let memoryCalls = 0;
  const context = {
    ...memoryContext,
    desktopVendingTransactionsRef: { current: transactions.createDesktopVendingTransactions() },
    saveRef: { current: structuredClone(initial) }, contentRef: { current: content },
    desktopPurchaseSlotId: "fixture-slot-a", activeSaveSlotIdRef: { current: "fixture-slot-a" },
    desktopPurchaseEpoch: 1, desktopEpochRef: { current: 1 },
    desktopModeRef: { current: true }, desktopTransitionRef: { current: false },
    slotActionRef: { current: null }, effectiveStatus: { status: "idle" },
    statusRef: { current: { status: { status: "idle" } } },
    isStoreClosing: () => flags.closing,
    isHighPriorityStatus: (status) => flags.busy || ["thinking", "executing", "waiting_for_user", "error"].includes(status.status),
    affordableShopPurchaseQuantity: (save, item, quantity) => shop.affordableShopPurchaseQuantity(save, item, quantity,
      { growthLevel: memoryContext.normalizeMemory(save.memory).growth.level }),
    recordLifeMemory: (...args) => { memoryCalls += 1; return memoryContext.recordLifeMemory(...args); },
  };
  context.setSave = (value) => { updates += 1; context.saveRef.current = value; };
  const purchase = bind("purchaseDesktopConsumable", context);
  return { initial, content, context, flags, purchase,
    get save() { return context.saveRef.current; },
    get updates() { return updates; }, get memoryCalls() { return memoryCalls; } };
};

for (const [productId, price, stats, traits] of [
  ["cookie", 6, { energy: 24, mood: 42, hunger: 50 }, { creativity: 1, warmth: 1, efficiency: 1 }],
  ["cola", 10, { energy: 28, mood: 38, hunger: 46 }, { efficiency: 2, warmth: 1 }],
  ["coffee", 8, { energy: 38, mood: 34, hunger: 44 }, { focus: 1, warmth: 1, efficiency: 1 }],
]) {
  const h = makeHarness();
  const request = { requestId: `fixture-${productId}`, productId };
  const inventory = h.save.inventory;
  const storage = h.save.furnitureStorage;
  const receipt = h.purchase(request);
  assert.deepEqual(receipt, { ...request, ok: true, price });
  assert.equal(h.save.wallet.bits, 100 - price);
  assert.equal(h.save.wallet.pokerChips, 37, "other currency remains intact");
  assert.deepEqual(h.save.petStats, stats);
  assert.equal(h.save.inventory, inventory, "purchase is consumed directly without touching inventory");
  assert.equal(h.save.furnitureStorage, storage);
  assert.deepEqual(h.save.purchasedItemIds, [productId]);
  assert.deepEqual(h.save.memory.recentEvents.map((event) => event.type), ["item_used", "item_bought"]);
  assert.equal(h.save.memory.preferences.favoriteRecovery, productId);
  assert.equal(h.save.memory.preferences.itemAffinities[productId], 2);
  assert.equal(h.save.memory.preferences.activityWeights[productId], 1);
  for (const [trait, points] of Object.entries(traits)) assert.equal(h.save.memory.growth.traits[trait], points);
  assert.equal(h.save.memory.growth.xp, 0, "no task XP is invented by vending");
  const saved = h.save;
  for (let index = 0; index < 30; index += 1) assert.equal(h.purchase(request), receipt);
  assert.equal(h.save, saved);
  assert.equal(h.updates, 1, "duplicate callbacks cannot debit or apply effects twice");
  assert.equal(h.memoryCalls, 2, "deduplication happens before either memory helper");
  assert.equal(h.purchase({ ...request, productId: productId === "cola" ? "coffee" : "cola" }).reason, "invalid-request");
  assert.equal(h.updates, 1);
}

for (const [reason, configure] of [
  ["insufficient-funds", (h) => { h.context.saveRef.current.wallet.bits = 5; }],
  ["busy", (h) => { h.flags.busy = true; }],
  ["busy", (h) => { h.context.statusRef.current.status = { status: "executing" }; }],
  ["closing", (h) => { h.flags.closing = true; }],
  ["closing", (h) => { h.context.slotActionRef.current = Promise.resolve(); }],
  ["slot-changed", (h) => { h.context.activeSaveSlotIdRef.current = "fixture-slot-b"; }],
  ["slot-changed", (h) => { h.context.activeSaveSlotIdRef.current = null; }],
  ["desktop-inactive", (h) => { h.context.desktopModeRef.current = false; }],
  ["desktop-inactive", (h) => { h.context.desktopEpochRef.current = 2; }],
  ["desktop-inactive", (h) => { h.context.desktopTransitionRef.current = true; }],
  ["unavailable", (h) => { h.content.shop.items.find((item) => item.id === "cookie").price = 0; }],
  ["unavailable", (h) => { h.content.shop.items.find((item) => item.id === "cookie").price = NaN; }],
  ["unavailable", (h) => { h.content.shop.items.find((item) => item.id === "cookie").price = -1; }],
  ["unavailable", (h) => { h.content.shop.items.find((item) => item.id === "cookie").unlockLevel = 99; }],
  ["unavailable", (h) => { h.content.itemDefinitions = h.content.itemDefinitions.filter((item) => item.id !== "cookie"); }],
  ["unavailable", (h) => { h.content.itemDefinitions.find((item) => item.id === "cookie").effect.energy = NaN; }],
  ["unavailable", (h) => { h.content.itemDefinitions.find((item) => item.id === "cookie").effect.hunger = -5; }],
  ["unavailable", (h) => { h.content.itemDefinitions.find((item) => item.id === "cookie").effect = undefined; }],
]) {
  const h = makeHarness();
  configure(h);
  const save = h.save;
  assert.equal(h.purchase({ requestId: `reject-${reason}`, productId: "cookie" }).reason, reason);
  assert.equal(h.save, save);
  assert.equal(h.updates, 0);
  assert.equal(h.memoryCalls, 0);
}
{
  const h = makeHarness();
  assert.equal(h.purchase({ requestId: "", productId: "cookie" }).reason, "invalid-request");
  assert.equal(h.purchase({ requestId: "x".repeat(129), productId: "cookie" }).reason, "invalid-request");
  assert.equal(h.purchase({ requestId: "invalid-product", productId: "bento" }).reason, "invalid-product");
  assert.equal(h.updates, 0);
  h.context.saveRef.current.wallet.bits = 6;
  assert.equal(h.purchase({ requestId: "last-six", productId: "cookie" }).ok, true);
  assert.equal(h.purchase({ requestId: "next-six", productId: "cookie" }).reason, "insufficient-funds");
  assert.equal(h.save.wallet.bits, 0, "rapid distinct requests cannot overspend");
  h.context.saveRef.current.wallet.bits = 50;
  assert.equal(h.purchase({ requestId: "next-six", productId: "cookie" }).reason, "insufficient-funds",
    "a failed order needs a new ID even after the balance changes");
}
{
  const h = makeHarness();
  h.content.shop.items.find((item) => item.id === "coffee").price = 13;
  h.content.itemDefinitions.find((item) => item.id === "coffee").effect.energy = 95;
  assert.equal(transactions.desktopVendingProducts(h.content).find((item) => item.id === "coffee").price, 13);
  assert.equal(h.purchase({ requestId: "live-config", productId: "coffee" }).price, 13);
  assert.equal(h.save.wallet.bits, 87);
  assert.equal(h.save.petStats.energy, 100, "live effects use existing stat caps");
  assert.deepEqual(h.initial.inventory, h.save.inventory);
}
{
  const h = makeHarness();
  const first = { requestId: "earlier-order", productId: "cookie" };
  const receipt = h.purchase(first);
  h.purchase({ requestId: "later-order", productId: "cola" });
  const afterBoth = h.save;
  assert.equal(h.purchase(first), receipt);
  assert.equal(h.save, afterBoth, "a replay cannot restore an earlier snapshot over later consumption");
  assert.equal(h.save.wallet.bits, 84);
  assert.equal(h.updates, 2);
  assert.equal(h.memoryCalls, 4);
}
{
  const h = makeHarness();
  h.context.saveRef.current.wallet.bits = 1000;
  const oldRequest = { requestId: "receipt-outlives-memory", productId: "cookie" };
  const receipt = h.purchase(oldRequest);
  for (let index = 0; index < 25; index += 1) h.purchase({ requestId: `later-${index}`, productId: "cookie" });
  assert(!h.save.memory.recentEvents.some((event) => event.id.includes(oldRequest.requestId)));
  const newestSave = h.save;
  assert.equal(h.purchase(oldRequest), receipt);
  assert.equal(h.save, newestSave, "receipt deduplication outlives the short recent-memory list");
  assert.equal(h.updates, 26);
  h.context.activeSaveSlotIdRef.current = "fixture-slot-b";
  assert.equal(h.purchase(oldRequest).reason, "slot-changed", "old success cannot be replayed into another owner");
  assert.equal(h.updates, 26);
}

// Exercise the App's actual audio handlers with synthetic Audio/timer objects.
const timers = new Map();
let timerId = 0;
const audioContext = {
  desktopVendingAudioRef: { current: {} }, desktopVendingAudioTimerRef: { current: null },
  desktopVendingAudioGenerationRef: { current: 0 }, desktopVendingAudioVolumeRef: { current: 0.5 },
  audioUnlockedRef: { current: true }, desktopModeRef: { current: true },
  desktopTransitionRef: { current: false }, isStoreClosing: () => false,
  window: { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id) },
};
for (const name of ["COLA_CAN_OPEN_AUDIO_SRC", "COLA_DRINK_AUDIO_SRC", "COFFEE_DRINK_AUDIO_SRC",
  "DESKTOP_VENDING_AUDIO", "COLA_DRINK_AFTER_CAN_OPEN_DELAY_MS"]) bind(name, audioContext);
for (const key of Object.keys(audioContext.DESKTOP_VENDING_AUDIO)) {
  audioContext.desktopVendingAudioRef.current[key] = {
    played: 0, paused: 0, currentTime: 0, volume: 0,
    play() { this.played += 1; return Promise.resolve(); }, pause() { this.paused += 1; },
  };
}
bind("stopDesktopVendingAudio", audioContext);
const sound = bind("playDesktopVendingSound", audioContext);
const audios = audioContext.desktopVendingAudioRef.current;
const runTimer = (ms) => {
  const entry = [...timers].find(([, timer]) => timer.ms === ms);
  assert(entry, `Expected pending ${ms}ms audio timer`);
  timers.delete(entry[0]); entry[1].fn();
};
sound("pickup");
const pickupPauses = audios.pickup.paused;
sound("consume_cookie");
assert.equal(audios.pickup.paused, pickupPauses, "cookie consumption must not cut off pickup");
sound("pickup");
const pickupPausesBeforeCoffee = audios.pickup.paused;
sound("consume_coffee");
assert.equal(audios.pickup.paused, pickupPausesBeforeCoffee);
assert.equal(audios.coffeeDrink.played, 0);
runTimer(400);
assert.equal(audios.coffeeDrink.played, 1);
sound("pickup"); sound("consume_cola"); runTimer(400);
assert.equal(audios.colaOpen.played, 1);
assert.equal(audios.colaDrink.played, 0);
sound("stop");
assert.equal(timers.size, 0, "stop cancels delayed drinking");
sound("pickup"); sound("consume_cola"); sound("stop");
assert.equal(timers.size, 0, "stop also cancels pickup-to-consume delay");
audioContext.desktopVendingAudioVolumeRef.current = 0;
sound("press");
assert.equal(audios.press.played, 0, "mute is respected");
audioContext.desktopVendingAudioVolumeRef.current = 0.5;
audioContext.audioUnlockedRef.current = false;
sound("press");
assert.equal(audios.press.played, 0, "audio requires an actual unlocked interaction");
console.log("Desktop vending smoke passed: live prices/effects, atomic debit and consumption, unchanged stock, exactly-once memory, replay/owner/close/busy guards, and cancellable pickup/drink audio.");
