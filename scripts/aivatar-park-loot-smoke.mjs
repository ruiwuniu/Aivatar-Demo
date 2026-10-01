import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// All state is synthetic; neither native storage nor a real save is imported.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const slotKey = "aivatar.saveSlot.v1.synthetic-loot";
const baseSave = () => ({ inventory: [], placedItems: [], furnitureStorage: [], petStats: { mood: 0 }, memory: { recentEvents: [], growth: { traits: { curiosity: 0 } } }, wallet: { bits: 10 } });
const harness = () => {
  const values = new Map([[slotKey, JSON.stringify(baseSave())]]);
  const timers = new Map();
  let fail = false;
  let beforeTransaction;
  let writes = 0;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { if (fail) throw Error("synthetic failure"); values.set(key, value); writes++; },
    transact: async (build) => {
      beforeTransaction?.(); beforeTransaction = undefined;
      const { changes, result } = build(storage);
      if (fail) throw Error("synthetic failure");
      for (const [key, value] of Object.entries(changes)) { values.set(key, value); writes++; }
      return result;
    },
  };
  const context = vm.createContext({ console, performance: { now: () => 1000 },
    setTimeout: (fn) => { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout: (id) => timers.delete(id),
  });
  const modules = new Map();
  const load = (relative) => {
    if (relative === "src/persistence/saveStore.ts") return { appStorage: storage };
    if (modules.has(relative)) return modules.get(relative).exports;
    assert(relative.startsWith("src/") && !relative.includes(".."));
    const module = { exports: {} }; modules.set(relative, module);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context)((specifier) => {
      assert(specifier.startsWith("."));
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${specifier}.ts`)));
    }, module, module.exports);
    return module.exports;
  };
  return { load, values, api: load("src/park/parkStorage.ts"), loot: load("src/park/parkLoot.ts"), runtime: load("src/park/parkRuntime.ts"),
    read: () => JSON.parse(values.get(slotKey)), write: (save) => values.set(slotKey, JSON.stringify(save)),
    fail: (value) => { fail = value; }, before: (fn) => { beforeTransaction = fn; }, writes: () => writes,
  };
};
let checks = 0;
const check = async (name, run) => { await run(); checks++; console.log(`[park-loot] PASS ${name}`); };
const receipt = (catchId, itemId = "fishing-trophy-bronze") => ({ catchId, itemId, fallbackFishId: "raw-bluegill" });

await check("every exact probability bucket matches both fishing modes", () => {
  const { loot } = harness();
  for (const manual of [false, true]) {
    const counts = new Map();
    for (let i = 0; i < 100_000; i++) {
      const item = loot.rollParkCatch(manual, [], () => (i + 0.5) / 100_000, "raw-bluegill");
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    assert.equal(counts.get("fishing-trophy-bronze"), 100);
    assert.equal(counts.get("fishing-trophy-silver"), 35);
    assert.equal(counts.get("fishing-trophy-gold"), 12);
    assert.equal(counts.get("fishing-trophy-crystal"), 3);
    assert.equal(counts.get("pond-weed"), manual ? 35_000 : 55_000);
    assert.equal(counts.get("raw-bluegill"), manual ? 64_850 : 44_850);
  }
});
await check("ownership sees inventory and placed trophies, never rerolls a duplicate", () => {
  const { loot } = harness();
  const owned = loot.ownedFishingTrophies({ inventory: [{ itemId: "fishing-trophy-bronze", quantity: 1 }], placedItems: [{ itemId: "fishing-trophy-silver" }] });
  assert.equal(owned.length, 2);
  let draws = 0;
  assert.equal(loot.rollParkCatch(false, owned, () => { draws++; return 0; }, "raw-bluegill"), "raw-bluegill");
  assert.equal(draws, 1);
  assert.equal(loot.rollParkCatch(false, owned, () => .0014, "raw-bluegill"), "fishing-trophy-gold");
});
await check("invalid random values and 10000 IDs remain finite and collision free", () => {
  const { loot } = harness();
  for (const value of [NaN, Infinity, -Infinity, -5, 5]) assert(loot.PARK_CATCH_NAMES[loot.rollParkCatch(false, [], () => value, "raw-bluegill")]);
  const ids = new Set(Array.from({ length: 10000 }, () => loot.createParkCatchReceipt(false, [], () => .8).catchId));
  assert.equal(ids.size, 10000);
});
await check("water weed enters the fridge, trophies enter inventory, once per receipt", async () => {
  const h = harness();
  await h.api.recordParkCatch("synthetic-loot", receipt("weed", "pond-weed"));
  await h.api.recordParkCatch("synthetic-loot", receipt("bronze"));
  const before = h.read();
  await h.api.recordParkCatch("synthetic-loot", receipt("bronze"));
  await h.api.recordParkCatch("synthetic-loot", receipt("weed", "pond-weed"));
  assert.deepEqual(h.read(), before);
  assert.equal(h.read().inventory[0].quantity, 1);
  assert.equal(h.read().furnitureStorage[0].itemId, "pond-weed");
  assert.equal(h.read().furnitureStorage[0].quantity, 1);
  assert.equal(h.read().memory.recentEvents.length, 2);
});
await check("failed saves retain pending unique ownership and retries never duplicate rewards", async () => {
  const h = harness(); h.fail(true);
  assert.equal(await h.api.recordParkCatch("synthetic-loot", receipt("pending")), null);
  assert(h.loot.ownedFishingTrophies(h.api.readParkSaveSlot("synthetic-loot")).includes("fishing-trophy-bronze"));
  assert.equal(h.api.readCommittedParkCatchItem("synthetic-loot", receipt("pending")), undefined);
  await h.api.recordParkCatch("synthetic-loot", receipt("pending"));
  const remote = h.read(); remote.wallet.bits = 900; h.write(remote); h.fail(false);
  const saved = await h.api.flushParkSaveSlot("synthetic-loot");
  assert.equal(saved.wallet.bits, 900);
  assert.equal(saved.inventory[0].quantity, 1);
  assert.equal(saved.memory.recentEvents.length, 1);
  assert.equal(h.api.readCommittedParkCatchItem("synthetic-loot", receipt("pending")), "fishing-trophy-bronze");
});
await check("transaction-time ownership conflict returns the exact saved ordinary fish", async () => {
  const h = harness();
  h.before(() => { const remote = h.read(); remote.placedItems.push({ id: "placed", itemId: "fishing-trophy-bronze" }); h.write(remote); });
  const result = receipt("conflict");
  const saved = await h.api.recordParkCatch("synthetic-loot", result);
  assert.equal(h.api.savedParkCatchItem(saved, result), "raw-bluegill");
  assert.equal(saved.inventory.length, 0);
  assert.equal(saved.furnitureStorage[0].itemId, "raw-bluegill");
  await h.api.recordParkCatch("synthetic-loot", result);
  assert.equal(h.read().furnitureStorage[0].quantity, 1);
});
await check("sale restores future eligibility but replaying a sold receipt cannot restore its trophy", async () => {
  const h = harness(); const first = receipt("original");
  await h.api.recordParkCatch("synthetic-loot", first);
  const sold = h.read(); sold.inventory = []; sold.wallet.bits += 100; h.write(sold);
  await h.api.recordParkCatch("synthetic-loot", first);
  assert.equal(h.read().inventory.length, 0);
  assert.equal(h.loot.ownedFishingTrophies(h.read()).length, 0);
  await h.api.recordParkCatch("synthetic-loot", receipt("fresh"));
  assert.equal(h.read().inventory[0].quantity, 1);
  assert.equal(h.read().parkCatchReceipts.length, 2);
});
await check("reset stores placed trophies once and retains ordinary reset semantics", () => {
  const h = harness();
  const { recoverFishingTrophiesOnLayoutReset } = h.load("src/game/fishingTrophyInventory.ts");
  const save = { inventory: [{ itemId: "fishing-trophy-silver", quantity: 1 }, { itemId: "cookie", quantity: 3 }], placedItems: [
    { itemId: "fishing-trophy-bronze" }, { itemId: "fishing-trophy-silver" }, { itemId: "fishing-trophy-bronze" }, { itemId: "plant" },
  ] };
  const result = recoverFishingTrophiesOnLayoutReset(save);
  assert.equal(result.filter((item) => item.itemId === "fishing-trophy-bronze").length, 1);
  assert.equal(result.find((item) => item.itemId === "fishing-trophy-silver").quantity, 1);
  assert.equal(result.find((item) => item.itemId === "cookie").quantity, 3);
  assert.equal(result.some((item) => item.itemId === "plant"), false);
});
await check("saving pauses runtime, close settles automatic catches with the same stable receipt", () => {
  const h = harness();
  const landed = { ...h.runtime.initialParkSimulation(), activity: "reel", fishingPose: "reel", pendingFish: "fishing-trophy-bronze", pendingCatch: receipt("auto-close"), catchSavePending: true };
  const result = h.runtime.advanceParkSimulation(landed, .08, 999999, { objects: [], traits: {}, hasRod: true, random: () => { throw Error("must not draw while saving"); } });
  assert.equal(result.state, landed); assert.equal(result.events.length, 0);
  const closed = h.runtime.finishParkFishingGameOnExit(landed, 999999);
  assert.equal(closed.events[0].receipt.catchId, "auto-close");
  assert.equal(closed.state.pendingCatch, undefined);
  assert.equal(h.runtime.finishParkFishingGameOnExit(closed.state, 999999).events.length, 0);
});
await check("runtime only samples loot after landing and keeps ordinary fish proportions", () => {
  const h = harness();
  const biting = { ...h.runtime.initialParkSimulation(), activity: "bite", fishingPose: "bite", pendingFish: "raw-bluegill", activityEndsAt: 100, fishingSessionEndsAt: 100000 };
  const failed = h.runtime.advanceParkSimulation(biting, 0, 101, { objects: [], traits: { focus: 0 }, hasRod: true, random: () => .99 });
  assert.equal(failed.state.pendingCatch, undefined);
  const rolls = [0, .5, .3];
  const won = h.runtime.advanceParkSimulation(biting, 0, 101, { objects: [], traits: {}, hasRod: true, random: () => rolls.shift() });
  assert.equal(won.state.pendingCatch.itemId, "pond-weed");
  assert.equal(won.state.pendingFish, won.state.pendingCatch.itemId);
  assert.equal(rolls.length, 0);
  const probability = h.load("src/park/parkProbability.ts");
  const counts = {};
  for (let i = 0; i < 100; i++) { const item = probability.randomFishingCatch(() => (i + .5) / 100); counts[item] = (counts[item] ?? 0) + 1; }
  assert.deepEqual(Object.values(counts), [26, 22, 18, 15, 11, 8]);
});
const appSource = fs.readFileSync(path.join(root, "src/park/ParkApp.tsx"), "utf8");
const appAst = ts.createSourceFile("ParkApp.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const appCallback = (name, bindings) => {
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(appAst); assert(initializer, name);
  const js = ts.transpileModule(`const operation = ${initializer.getText(appAst)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${js};return operation;`)(...Object.values(bindings));
};
await check("App waits for a committed receipt, then reveals its exact item and plays one reel sound", async () => {
  const h = harness(); const sounds = []; const snapshots = [];
  const landed = { ...h.runtime.initialParkSimulation(), activity: "reel", fishingPose: "reel", pendingFish: "fishing-trophy-bronze", pendingCatch: receipt("app-conflict"), activityStartedAt: 10 };
  let now = 1000;
  const bindings = {
    simulationRef: { current: landed }, hostSlotId: "synthetic-loot", visitRef: { current: {} }, debugPreviewRef: { current: false },
    saveRef: { current: h.read() }, setSave: () => {}, setSaveError: () => {},
    performance: { now: () => now }, readCommittedParkCatchItem: h.api.readCommittedParkCatchItem,
    fishingAudioBankRef: { current: {} }, playParkFishingSound: (_bank, pose) => sounds.push(pose),
    publishFishingOverlay: (state) => snapshots.push(state), recordParkCatch: h.api.recordParkCatch,
  };
  bindings.resumeSavedCatch = appCallback("resumeSavedCatch", bindings);
  const persist = appCallback("persistLandedCatch", bindings);
  h.before(() => { const other = h.read(); other.inventory.push({ itemId: "fishing-trophy-bronze", quantity: 1 }); h.write(other); });
  persist(landed);
  assert.equal(bindings.simulationRef.current.catchSavePending, true);
  bindings.resumeSavedCatch(h.api.readParkSaveSlot("synthetic-loot"));
  assert.equal(bindings.simulationRef.current.catchSavePending, true, "pending merged preview must not reveal before durable write");
  assert.equal(sounds.length, 0);
  now = 7000;
  await new Promise(setImmediate);
  assert.equal(bindings.simulationRef.current.catchSavePending, false);
  assert.equal(bindings.simulationRef.current.pendingFish, "raw-bluegill");
  assert.equal(bindings.simulationRef.current.activityStartedAt, 7000);
  assert.equal(bindings.simulationRef.current.activityEndsAt, 8450);
  assert.deepEqual(sounds, ["reel"]);
  bindings.resumeSavedCatch(h.read()); assert.equal(sounds.length, 1);
  const previewBindings = { ...bindings, simulationRef: { current: landed }, debugPreviewRef: { current: true }, recordParkCatch: () => { throw Error("preview awarded loot"); } };
  appCallback("persistLandedCatch", previewBindings)(landed);
  assert.equal(previewBindings.simulationRef.current, landed);
});
const roomAppSource = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const roomAppAst = ts.createSourceFile("App.tsx", roomAppSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const roomCallback = (name, bindings) => {
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(roomAppAst); assert(initializer, name);
  const js = ts.transpileModule(`const operation = ${initializer.getText(roomAppAst)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${js};return operation;`)(...Object.values(bindings));
};
const roomHarness = (initial = baseSave()) => {
  const h = harness();
  let state = initial;
  const values = new Map();
  const recover = h.load("src/game/fishingTrophyInventory.ts").recoverFishingTrophiesOnLayoutReset;
  const content = { room: { furniture: [], windows: [], windowId: "default-window" }, placedItems: [], inventory: [], avatar: { name: "Fixture" }, petStats: {}, wallet: { bits: 0 } };
  const bindings = {
    isFishingTrophy: h.loot.isFishingTrophy, recoverFishingTrophiesOnLayoutReset: recover,
    withBuiltinTerminalPlacedItem: (_content, placed) => placed,
    withoutLegacyTerminalFurniturePlacements: (placed) => placed,
    DEFAULT_LAYOUT_KEY: "synthetic-default-layout", SAVE_LAYOUT_VERSION: 5,
    DEFAULT_AVATAR_APPEARANCE_ID: "octopus", createAvatarId: () => "avatar", createRoomId: () => "room",
    normalizeAvatarId: (id) => id ?? "avatar", normalizeRoomId: (id) => id ?? "room", normalizeAvatarAppearanceId: (id) => id ?? "octopus",
    defaultMemory: () => ({}), defaultNavMemory: () => ({}), defaultFurnitureStorage: () => [],
    normalizePaintingGallery: (value) => value ?? {}, normalizeSaveWallet: (value) => value ?? {},
    normalizeFurnitureStorage: (value) => value ?? [], normalizeMemory: (value) => value ?? {}, normalizeNavMemory: (value) => value ?? {},
    normalizeFurnitureSkinIds: (value) => value ?? {}, normalizeRewardedCompletionIds: (value) => value ?? [],
    removeDeprecatedInventoryItems: (value) => value,
    appStorage: { getItem: (key) => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value) },
    setSave: (update) => { state = update(state); },
    contentBase: content, contentRef: { current: content },
    save: state,
    selectedPlacedItem: { id: "bronze-placed", itemId: "fishing-trophy-bronze", x: 100, y: 100 },
    selectedPlacedItemDefinition: { id: "fishing-trophy-bronze", name: "Bronze", sellPrice: 100 },
    isBuiltinTerminalPlacedItem: () => false, itemSellValue: (item) => item.sellPrice,
    isPlacedItemPlacementValid: () => true, normalizePlacedItemPoint: (_content, _id, x, y) => ({ x, y }),
    clampQuantity: (entry) => ({ ...entry, quantity: Math.max(0, entry.quantity) }), clampTableCoffeeStorage: (storage) => storage,
    updateSelectedPlacedItem: () => {}, updateMovingPlacedItem: () => {}, updatePlacingItem: () => {}, updatePlacementPreview: () => {},
    updateActiveInteraction: () => {}, ui: (key) => key, performance: { now: () => 1 },
    cancelRoomEdit: () => {}, clearPendingFurnitureInteraction: () => {}, runtimeRef: { current: {} }, initialAvatarRuntime: () => ({}), setAvatar: () => {},
  };
  bindings.defaultLayoutFromContent = roomCallback("defaultLayoutFromContent", bindings);
  bindings.loadDefaultLayout = roomCallback("loadDefaultLayout", bindings);
  bindings.saveFromContent = roomCallback("saveFromContent", bindings);
  return { bindings, content, values, read: () => state, callback: (name) => roomCallback(name, bindings) };
};
await check("App default-layout producers and legacy templates cannot copy trophies into new saves", async () => {
  const h = roomHarness();
  const trophy = { id: "bronze-placed", itemId: "fishing-trophy-bronze", x: 100, y: 100 };
  const ordinary = { id: "plant-placed", itemId: "plant", x: 120, y: 120 };
  h.content.placedItems = [trophy, ordinary];
  assert.deepEqual(h.bindings.defaultLayoutFromContent(h.content).placedItems, [ordinary]);
  h.values.set("synthetic-default-layout", JSON.stringify({ placedItems: [trophy, ordinary] }));
  assert.deepEqual(h.bindings.loadDefaultLayout(h.content).placedItems, [ordinary]);
  assert.deepEqual(h.bindings.saveFromContent(h.content).placedItems, [ordinary]);
  h.bindings.save = { ...baseSave(), placedItems: [trophy, ordinary] };
  await h.callback("saveCurrentLayoutAsDefault")();
  assert.deepEqual(JSON.parse(h.values.get("synthetic-default-layout")).placedItems, [ordinary]);
});
await check("App layout migration preserves existing trophies in inventory and remains idempotent", () => {
  const h = roomHarness();
  const trophy = { id: "bronze-placed", itemId: "fishing-trophy-bronze", x: 100, y: 100 };
  h.values.set("synthetic-default-layout", JSON.stringify({ placedItems: [{ id: "old-template-trophy", itemId: "fishing-trophy-gold" }, { id: "plant", itemId: "plant" }] }));
  const normalize = h.callback("normalizeSavePayload");
  const old = { ...baseSave(), layoutVersion: 1, placedItems: [trophy], inventory: [{ itemId: "cookie", quantity: 2 }] };
  const result = normalize(h.content, old);
  assert.equal(result.inventory.find((entry) => entry.itemId === trophy.itemId).quantity, 1);
  assert.equal(result.inventory.find((entry) => entry.itemId === "cookie").quantity, 2);
  assert.equal(result.placedItems.some((item) => h.bindings.isFishingTrophy(item.itemId)), false);
  assert.equal(result.inventory.some((item) => item.itemId === "fishing-trophy-gold"), false);
  assert.deepEqual(normalize(h.content, result), result);
});
await check("App reset recovers owned trophies but cannot restore a sold trophy from a legacy template", () => {
  const trophy = { id: "bronze-placed", itemId: "fishing-trophy-bronze", x: 100, y: 100 };
  const h = roomHarness({ ...baseSave(), placedItems: [trophy] });
  h.values.set("synthetic-default-layout", JSON.stringify({ placedItems: [trophy, { id: "plant", itemId: "plant" }] }));
  const reset = h.callback("resetDefaultLayout"); reset(); reset();
  assert.equal(h.read().inventory.find((item) => item.itemId === trophy.itemId).quantity, 1);
  assert.equal(h.read().placedItems.some((item) => item.itemId === trophy.itemId), false);
  const sold = roomHarness({ ...baseSave(), placedItems: [trophy] });
  sold.values.set("synthetic-default-layout", JSON.stringify({ placedItems: [trophy] }));
  sold.callback("sellPlacedItem")(); sold.callback("resetDefaultLayout")();
  assert.equal(sold.read().inventory.length, 0);
  assert.equal(sold.read().placedItems.length, 0);
  assert.equal(sold.read().wallet.bits, 110);
});
await check("App trophy placement, storage and sale reject stale repeated callbacks", () => {
  const trophy = { id: "bronze-placed", itemId: "fishing-trophy-bronze", x: 100, y: 100 };
  const item = { id: trophy.itemId, name: "Bronze", kind: "decor" };
  const placed = roomHarness({ ...baseSave(), inventory: [{ itemId: trophy.itemId, quantity: 1 }] });
  const place = placed.callback("placeInventoryItem"); place(item, 100, 100); place(item, 200, 100);
  assert.equal(placed.read().placedItems.length, 1); assert.equal(placed.read().inventory.length, 0);
  const stored = roomHarness({ ...baseSave(), placedItems: [trophy] });
  const store = stored.callback("storePlacedItem"); store(); store();
  assert.equal(stored.read().inventory[0].quantity, 1); assert.equal(stored.read().placedItems.length, 0);
  const sold = roomHarness({ ...baseSave(), placedItems: [trophy] });
  const sell = sold.callback("sellPlacedItem"); sell(); sell();
  assert.equal(sold.read().wallet.bits, 110); assert.equal(sold.read().placedItems.length, 0);
  const emptied = roomHarness(); emptied.callback("placeInventoryItem")(item, 100, 100);
  assert.equal(emptied.read().placedItems.length, 0);
});
await check("App trophy deletion is blocked in both handler and rendered menu condition", () => {
  const trophy = { id: "bronze-placed", itemId: "fishing-trophy-bronze", x: 100, y: 100 };
  const h = roomHarness({ ...baseSave(), placedItems: [trophy] });
  const before = h.read(); h.callback("deletePlacedItem")(); assert.equal(h.read(), before);
  const deletionButton = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(roomAppAst) === "button"
      && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(roomAppAst) === "onClick" && attribute.initializer?.getText(roomAppAst) === "{deletePlacedItem}")) deletionButton.push(node);
    ts.forEachChild(node, visit);
  };
  visit(roomAppAst); assert.equal(deletionButton.length, 1);
  const parent = deletionButton[0].parent;
  assert(ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken);
  const predicate = ts.transpileModule(`const visible = ${parent.left.getText(roomAppAst)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const visible = new Function("isFishingTrophy", "selectedPlacedItem", `${predicate};return visible;`);
  assert.equal(visible(h.bindings.isFishingTrophy, trophy), false);
  assert.equal(visible(h.bindings.isFishingTrophy, { itemId: "plant" }), true);
});
console.log(`Park loot smoke passed: ${checks} synthetic runtime/persistence/probability checks.`);
