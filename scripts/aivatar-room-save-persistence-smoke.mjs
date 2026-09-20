import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (relative) => ts.transpileModule(
  readFileSync(new URL(relative, import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText;
const sharedCode = compile("../src/persistence/savePersistence.ts");
const roomCode = compile("../src/persistence/roomSavePersistence.ts");
const PASSIVE_CHECKPOINT_MS = 5 * 60_000;
const RETRY_WAIT_MS = 20_000;
const clone = (value) => JSON.parse(JSON.stringify(value));
const runtime = (x) => ({
  x, y: 10, targetX: x, targetY: 10, facing: "front", behavior: "idle",
  behaviorTimer: 3, expression: "calm",
});
const initialSave = () => ({
  avatarId: "synthetic-avatar", roomId: "synthetic-room", avatarName: "Test",
  avatarAppearanceId: "octopus", avatarRuntime: runtime(1),
  petStats: { energy: 50, mood: 50, hunger: 50 },
  wallet: { bits: 100, pokerChips: 5 }, inventory: [], placedItems: [],
  purchasedItemIds: [], rewardedCompletionIds: [], furnitureStorage: [],
  memory: {
    growth: { completedTurns: 0, errorCount: 0 },
    preferences: { idleBubbleLanguage: "auto", idleBubblePhrases: [], socialBubbles: { active: [], responses: [] } },
  },
  navMemory: { exploredCells: { test: 1 }, walkableCells: { test: 0 }, successes: 0, failures: 0 },
  paintingGallery: { artworks: [] },
});

const fixture = () => {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const values = new Map(["a", "b"].map((slot) => [`slot-${slot}`, JSON.stringify(initialSave())]));
  const writes = [];
  const notifications = [];
  const errors = [];
  const failedKeys = new Set();
  const live = { slot: "a", runtime: runtime(1) };
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failedKeys.has(key)) throw new Error(`Synthetic write failure for ${key}`);
      writes.push({ key, snapshot: JSON.parse(value), at: now });
      values.set(key, value);
    },
  };
  const context = {
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const load = (code, dependencies = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(code, { ...context, module, exports: module.exports, require: (id) => dependencies[id] });
    return module.exports;
  };
  const shared = load(sharedCode);
  const { createRoomSavePersistence } = load(roomCode, { "./savePersistence": shared });
  const makeController = (getRuntime = (slot) => slot === live.slot ? live.runtime : undefined, extra = {}) =>
    createRoomSavePersistence({
      storage,
      storageKey: (slot) => `slot-${slot}`,
      normalize: (value) => value,
      runtime: getRuntime,
      onPersisted: (slot, snapshot, syncState) => notifications.push({ slot, snapshot: clone(snapshot), syncState }),
      onError: (error) => errors.push(error),
      ...extra,
    });
  const advanceTo = async (target) => {
    assert.ok(target >= now);
    let count = 0;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > target) break;
      assert.ok(++count < 1000, "timer processing must stay bounded");
      timers.delete(next[0]);
      now = next[1].at;
      next[1].callback();
      await new Promise(setImmediate);
    }
    now = target;
  };
  return { controller: makeController(), makeController, storage, live, values, writes, notifications, failedKeys, errors, advanceTo };
};

let checks = 0;
const test = async (name, run) => {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
};

await test("passive changes have a five-minute upper bound and coalesce into one checkpoint", async () => {
  const f = fixture();
  let local = initialSave();
  f.controller.activate("a", local);
  for (let update = 1; update <= 600; update += 1) {
    await f.advanceTo((update - 1) * 500);
    local = { ...local, navMemory: { ...local.navMemory, exploredCells: { test: update + 1 } } };
    await f.controller.update("a", local);
  }
  await f.advanceTo(PASSIVE_CHECKPOINT_MS - 1);
  assert.equal(f.writes.length, 0);
  await f.advanceTo(PASSIVE_CHECKPOINT_MS);
  assert.equal(f.writes.length, 1);
  assert.equal(f.notifications.length, 1);
  assert.equal(JSON.parse(f.values.get("slot-a")).navMemory.exploredCells.test, 601);
});

await test("close/manual flush writes the latest passive room state before its checkpoint", async () => {
  const f = fixture();
  let local = initialSave();
  f.controller.activate("a", local);
  local = { ...local, navMemory: { ...local.navMemory, exploredCells: { test: 2 } } };
  await f.controller.update("a", local);
  await f.advanceTo(42_000);
  local = { ...local, navMemory: { ...local.navMemory, exploredCells: { test: 3 } } };
  await f.controller.update("a", local);
  assert.equal((await f.controller.flush("a", local)).ok, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].at, 42_000);
  assert.equal(JSON.parse(f.values.get("slot-a")).navMemory.exploredCells.test, 3);
  await f.advanceTo(PASSIVE_CHECKPOINT_MS * 2);
  assert.equal(f.writes.length, 1, "close flush must cancel the pending checkpoint");
});

await test("wallet, inventory, completed turns, and saved bubble preferences write immediately", async () => {
  const f = fixture();
  let local = initialSave();
  f.controller.activate("a", local);
  const changes = [
    (save) => ({ ...save, wallet: { ...save.wallet, bits: 90 } }),
    (save) => ({ ...save, inventory: [{ itemId: "test-food", quantity: 1 }] }),
    (save) => ({ ...save, memory: { ...save.memory, growth: { ...save.memory.growth, completedTurns: 1 } } }),
    (save) => ({ ...save, memory: { ...save.memory, preferences: { ...save.memory.preferences, idleBubblePhrases: ["Test phrase"] } } }),
    (save) => ({ ...save, memory: { ...save.memory, preferences: { ...save.memory.preferences, socialBubbles: { active: [{ id: "test" }], responses: [] } } } }),
  ];
  for (const [index, change] of changes.entries()) {
    local = change(local);
    await f.controller.update("a", local);
    assert.equal(f.writes.length, index + 1);
    assert.equal(f.writes.at(-1).at, 0);
  }
  await f.advanceTo(100_000);
  assert.equal(f.writes.length, changes.length);
});

await test("external state imports do not schedule a write-back", async () => {
  const f = fixture();
  let current = initialSave();
  f.controller.activate("a", current);
  const external = { ...current, wallet: { bits: 333, pokerChips: 5 }, parkRuntime: runtime(70), avatarRuntime: runtime(90) };
  f.values.set("slot-a", JSON.stringify(external));
  current = f.controller.mergeExternal("a", current);
  assert.equal(current.wallet.bits, 333);
  assert.equal(current.parkRuntime.x, 70);
  assert.equal(current.avatarRuntime.x, 1);
  await f.controller.update("a", current);
  await f.advanceTo(100_000);
  assert.equal(f.writes.length, 0);
});

await test("two remote imports preserve an already pending local navigation change", async () => {
  const f = fixture();
  let current = initialSave();
  f.controller.activate("a", current);
  current = { ...current, navMemory: { ...current.navMemory, exploredCells: { test: 8 } } };
  await f.controller.update("a", current);
  let external = initialSave();
  external.wallet.bits = 200;
  f.values.set("slot-a", JSON.stringify(external));
  current = f.controller.mergeExternal("a", current);
  await f.controller.update("a", current);
  external = { ...external, wallet: { bits: 300, pokerChips: 15 }, inventory: [{ itemId: "fish", quantity: 2 }] };
  f.values.set("slot-a", JSON.stringify(external));
  current = f.controller.mergeExternal("a", current);
  await f.controller.update("a", current);
  assert.equal(f.writes.length, 0);
  await f.advanceTo(PASSIVE_CHECKPOINT_MS);
  const saved = JSON.parse(f.values.get("slot-a"));
  assert.equal(saved.navMemory.exploredCells.test, 8);
  assert.equal(saved.wallet.bits, 300);
  assert.equal(saved.wallet.pokerChips, 15);
  assert.deepEqual(saved.inventory, [{ itemId: "fish", quantity: 2 }]);
});

await test("multiple unseen external changes survive subsequent local saves without React importing them", async () => {
  const f = fixture();
  let local = initialSave();
  f.controller.activate("a", local);
  for (let step = 1; step <= 3; step += 1) {
    local = { ...local, navMemory: { ...local.navMemory, exploredCells: { test: step + 1 } } };
    await f.controller.update("a", local);
    const remote = JSON.parse(f.values.get("slot-a"));
    remote.wallet.bits = step * 500;
    remote.parkRuntime = runtime(step * 10);
    f.values.set("slot-a", JSON.stringify(remote));
    await f.advanceTo(step * PASSIVE_CHECKPOINT_MS);
    const saved = JSON.parse(f.values.get("slot-a"));
    assert.equal(saved.wallet.bits, step * 500);
    assert.equal(saved.parkRuntime.x, step * 10);
    assert.equal(saved.navMemory.exploredCells.test, step + 1);
  }
});

await test("failed flush freezes the old slot runtime and retries only that slot after switching", async () => {
  const f = fixture();
  let local = initialSave();
  f.controller.activate("a", local);
  local = { ...local, wallet: { ...local.wallet, bits: 88 } };
  f.live.runtime = runtime(9);
  f.failedKeys.add("slot-a");
  assert.equal((await f.controller.flush("a", local)).ok, false);
  f.live.slot = "b";
  f.live.runtime = runtime(77);
  f.controller.activate("b", initialSave());
  f.failedKeys.delete("slot-a");
  await f.advanceTo(RETRY_WAIT_MS);
  assert.deepEqual(f.writes.map(({ key }) => key), ["slot-a"]);
  const saved = JSON.parse(f.values.get("slot-a"));
  assert.equal(saved.wallet.bits, 88);
  assert.equal(saved.avatarRuntime.x, 9);
  assert.equal(JSON.parse(f.values.get("slot-b")).avatarRuntime.x, 1);
});

await test("reactivating a slot preserves its failed pending changes and external additions", async () => {
  const f = fixture();
  const original = initialSave();
  f.controller.activate("a", original);
  const local = { ...original, wallet: { ...original.wallet, bits: 80 } };
  f.failedKeys.add("slot-a");
  assert.equal((await f.controller.flush("a", local)).ok, false);
  const external = { ...original, inventory: [{ itemId: "fish", quantity: 1 }] };
  f.values.set("slot-a", JSON.stringify(external));
  const restored = f.controller.activate("a", external);
  assert.equal(restored.wallet.bits, 80);
  assert.deepEqual(clone(restored.inventory), external.inventory);
  f.failedKeys.delete("slot-a");
  await f.advanceTo(RETRY_WAIT_MS);
  assert.equal(JSON.parse(f.values.get("slot-a")).wallet.bits, 80);
  assert.deepEqual(JSON.parse(f.values.get("slot-a")).inventory, external.inventory);
});

await test("read or parse failure keeps the local draft until a later retry succeeds", async () => {
  const f = fixture();
  const original = initialSave();
  f.controller.activate("a", original);
  const local = { ...original, navMemory: { ...original.navMemory, exploredCells: { test: 99 } } };
  await f.controller.update("a", local);
  f.values.set("slot-a", "incomplete JSON");
  await f.advanceTo(PASSIVE_CHECKPOINT_MS);
  assert.equal(f.writes.length, 0);
  assert.equal(f.notifications.length, 0);
  assert.equal(f.errors.length, 1);
  f.values.set("slot-a", JSON.stringify(original));
  await f.advanceTo(PASSIVE_CHECKPOINT_MS + RETRY_WAIT_MS);
  assert.equal(JSON.parse(f.values.get("slot-a")).navMemory.exploredCells.test, 99);
  assert.equal(f.notifications.length, 1);
});

await test("deletion and forget never recreate a pending slot", async () => {
  for (const forget of [false, true]) {
    const f = fixture();
    const original = initialSave();
    f.controller.activate("a", original);
    await f.controller.update("a", { ...original, petStats: { ...original.petStats, energy: 49 } });
    f.values.delete("slot-a");
    if (forget) f.controller.forget("a");
    await f.advanceTo(PASSIVE_CHECKPOINT_MS * 2);
    assert.equal(f.values.has("slot-a"), false);
    assert.equal(f.writes.length, 0);
    assert.equal(f.notifications.length, 0);
  }
});

await test("two windows with different runtimes do not echo external storage updates", async () => {
  const f = fixture();
  const a = f.makeController(() => runtime(10));
  const b = f.makeController(() => runtime(20));
  let stateA = initialSave();
  let stateB = initialSave();
  a.activate("a", stateA);
  b.activate("a", stateB);
  await a.flush("a", stateA);
  stateB = b.mergeExternal("a", stateB);
  await b.update("a", stateB);
  assert.equal(f.writes.length, 1);
  await b.flush("a", stateB);
  stateA = a.mergeExternal("a", stateA);
  await a.update("a", stateA);
  await f.advanceTo(PASSIVE_CHECKPOINT_MS * 2);
  assert.equal(f.writes.length, 2);
});

await test("equal snapshots and flushAll without pending work do not rewrite slot metadata", async () => {
  const f = fixture();
  const original = initialSave();
  f.controller.activate("a", original);
  assert.equal((await f.controller.flush("a", original)).written, false);
  await f.controller.flushAll();
  await f.advanceTo(PASSIVE_CHECKPOINT_MS * 2);
  assert.equal(f.writes.length, 0);
  assert.equal(f.notifications.length, 0);
});

await test("concurrent pet stat deltas preserve external rewards without replaying local decay", async () => {
  const f = fixture();
  const original = initialSave();
  original.petStats.mood = 40;
  f.values.set("slot-a", JSON.stringify(original));
  f.controller.activate("a", original);
  let local = { ...original, petStats: { ...original.petStats, mood: 39 } };
  await f.controller.update("a", local);
  const external = { ...original, petStats: { ...original.petStats, mood: 44 } };
  f.values.set("slot-a", JSON.stringify(external));
  await f.advanceTo(PASSIVE_CHECKPOINT_MS);
  assert.equal(JSON.parse(f.values.get("slot-a")).petStats.mood, 43);

  local = { ...local, navMemory: { ...local.navMemory, exploredCells: { test: 2 } } };
  await f.controller.update("a", local);
  await f.advanceTo(PASSIVE_CHECKPOINT_MS * 2);
  assert.equal(JSON.parse(f.values.get("slot-a")).petStats.mood, 43, "unchanged local mood must not decay twice");

  local = { ...local, petStats: { ...local.petStats, mood: 38 } };
  await f.controller.update("a", local);
  await f.advanceTo(PASSIVE_CHECKPOINT_MS * 3);
  assert.equal(JSON.parse(f.values.get("slot-a")).petStats.mood, 42, "next local decay is applied once");
});

await test("consuming one inventory item preserves a different item newly added by another window", async () => {
  const f = fixture();
  const original = initialSave();
  original.inventory = [{ itemId: "fish-a", quantity: 1 }];
  f.values.set("slot-a", JSON.stringify(original));
  f.controller.activate("a", original);
  const local = { ...original, inventory: [] };
  const external = { ...original, inventory: [...original.inventory, { itemId: "fish-b", quantity: 1 }] };
  f.values.set("slot-a", JSON.stringify(external));
  await f.controller.update("a", local);
  assert.deepEqual(JSON.parse(f.values.get("slot-a")).inventory, [{ itemId: "fish-b", quantity: 1 }]);
  await f.controller.flush("a", local);
  assert.deepEqual(JSON.parse(f.values.get("slot-a")).inventory, [{ itemId: "fish-b", quantity: 1 }]);
});

await test("conflicting quantities apply inventory and furniture deltas once per local change", async () => {
  const f = fixture();
  const original = initialSave();
  original.inventory = [{ itemId: "fish-a", quantity: 2 }];
  original.furnitureStorage = [
    { furnitureId: "fridge-a", itemId: "fish-a", quantity: 2, capacity: 20 },
    { furnitureId: "fridge-b", itemId: "fish-a", quantity: 8, capacity: 20 },
  ];
  f.values.set("slot-a", JSON.stringify(original));
  f.controller.activate("a", original);
  const local = {
    ...original,
    inventory: [{ itemId: "fish-a", quantity: 1 }],
    furnitureStorage: [
      { furnitureId: "fridge-a", itemId: "fish-a", quantity: 1, capacity: 20 },
      original.furnitureStorage[1],
    ],
  };
  const external = {
    ...original,
    inventory: [{ itemId: "fish-a", quantity: 5 }],
    furnitureStorage: [
      { furnitureId: "fridge-a", itemId: "fish-a", quantity: 4, capacity: 20 },
      { furnitureId: "fridge-b", itemId: "fish-a", quantity: 9, capacity: 20 },
    ],
  };
  f.values.set("slot-a", JSON.stringify(external));
  await f.controller.update("a", local);
  const assertQuantities = () => {
    const saved = JSON.parse(f.values.get("slot-a"));
    assert.equal(saved.inventory.find((entry) => entry.itemId === "fish-a").quantity, 4);
    assert.equal(saved.furnitureStorage.find((entry) => entry.furnitureId === "fridge-a").quantity, 3);
    assert.equal(saved.furnitureStorage.find((entry) => entry.furnitureId === "fridge-b").quantity, 9);
  };
  assertQuantities();
  await f.controller.flush("a", local);
  assertQuantities();
  await f.controller.flush("a", local);
  assertQuantities();
});

await test("already identical concurrent snapshots do not apply a second stat or inventory delta", async () => {
  const f = fixture();
  const original = initialSave();
  original.inventory = [{ itemId: "fish-a", quantity: 2 }];
  f.values.set("slot-a", JSON.stringify(original));
  f.controller.activate("a", original);
  const local = {
    ...original,
    petStats: { ...original.petStats, mood: 45 },
    inventory: [{ itemId: "fish-a", quantity: 1 }],
  };
  f.values.set("slot-a", JSON.stringify(local));
  await f.controller.update("a", local);
  assert.equal(f.writes.length, 0);
  assert.equal(JSON.parse(f.values.get("slot-a")).petStats.mood, 45);
  assert.equal(JSON.parse(f.values.get("slot-a")).inventory[0].quantity, 1);
});

await test("an older ACK cannot clear edits that arrived during its commit", async () => {
  const f = fixture();
  const originalWrite = f.storage.setItem;
  let release;
  let first = true;
  f.storage.setItem = async (key, value) => {
    if (first) { first = false; await new Promise((resolve) => { release = resolve; }); }
    originalWrite(key, value);
  };
  const original = initialSave();
  f.controller.activate("a", original);
  const firstSave = { ...original, wallet: { ...original.wallet, bits: 110 } };
  const firstCommit = f.controller.update("a", firstSave);
  await new Promise(setImmediate);
  const secondSave = { ...firstSave, wallet: { ...firstSave.wallet, bits: 120 } };
  const secondCommit = f.controller.update("a", secondSave);
  release();
  await Promise.all([firstCommit, secondCommit]);
  assert.equal(JSON.parse(f.values.get("slot-a")).wallet.bits, 120);
  assert.deepEqual(f.notifications.map((entry) => entry.syncState), [false, true]);
  assert.equal((await f.controller.drain()).length, 0);
});

await test("slot and registry are computed from each CAS view and committed together", async () => {
  const f = fixture();
  f.values.set("aivatar.saveSlots.v1", JSON.stringify([{ id: "a", bits: 100 }]));
  let attempts = 0;
  f.storage.transact = async (builder) => {
    attempts += 1;
    builder(f.storage);
    const remote = initialSave(); remote.wallet.bits = 200;
    f.values.set("slot-a", JSON.stringify(remote));
    const built = builder(f.storage);
    assert.deepEqual(Object.keys(built.changes).sort(), ["aivatar.saveSlots.v1", "slot-a"]);
    assert.equal(JSON.parse(built.changes["slot-a"]).wallet.bits, 190);
    assert.equal(JSON.parse(built.changes["aivatar.saveSlots.v1"])[0].bits, 190);
    for (const [key, value] of Object.entries(built.changes)) f.storage.setItem(key, value);
    return built.result;
  };
  const controller = f.makeController(undefined, {
    updateRegistry: (slotId, save, raw) => JSON.stringify(JSON.parse(raw).map((slot) => slot.id === slotId ? { ...slot, bits: save.wallet.bits } : slot)),
  });
  const initial = initialSave();
  controller.activate("a", initial);
  assert.equal((await controller.update("a", { ...initial, wallet: { ...initial.wallet, bits: 90 } })).ok, true);
  assert.equal(attempts, 1);
  assert.equal(f.notifications.length, 1);
});

await test("a remote event during commit does not become another local wallet reward", async () => {
  const f = fixture();
  let release;
  let ui = initialSave();
  const controller = f.makeController(undefined, { onMerged: (_slot, save) => { ui = save; } });
  controller.activate("a", ui);
  f.storage.transact = async (builder) => {
    builder(f.storage);
    await new Promise((resolve) => { release = resolve; });
    const built = builder(f.storage);
    for (const [key, value] of Object.entries(built.changes)) f.storage.setItem(key, value);
    return built.result;
  };
  ui = { ...ui, wallet: { ...ui.wallet, bits: 110 } };
  const commit = controller.update("a", ui);
  await new Promise(setImmediate);
  const remote = initialSave(); remote.wallet.bits = 200;
  f.values.set("slot-a", JSON.stringify(remote));
  assert.equal(controller.mergeExternal("a", ui), ui);
  release();
  await commit;
  assert.equal(ui.wallet.bits, 210);
  delete f.storage.transact;
  ui = { ...ui, petStats: { ...ui.petStats, mood: 49 } };
  controller.update("a", ui);
  await controller.flush("a", ui);
  assert.equal(JSON.parse(f.values.get("slot-a")).wallet.bits, 210);
});

await test("concurrent wallet debits accumulate but cannot exceed the operation's available balance", async () => {
  const f = fixture();
  const original = initialSave();
  f.controller.activate("a", original);
  const sameDebit = { ...original, wallet: { ...original.wallet, bits: 90 } };
  f.values.set("slot-a", JSON.stringify(sameDebit));
  assert.equal((await f.controller.update("a", sameDebit)).ok, true);
  assert.equal(JSON.parse(f.values.get("slot-a")).wallet.bits, 80);
  const next = { ...sameDebit, wallet: { ...sameDebit.wallet, bits: 0 } };
  assert.equal((await f.controller.update("a", next)).ok, false);
  assert.equal(JSON.parse(f.values.get("slot-a")).wallet.bits, 80);
  assert.match(f.errors.at(-1).message, /balance/);
});

await test("passive saves retain legitimate existing bits debt", async () => {
  const f = fixture();
  const original = initialSave(); original.wallet.bits = -100;
  f.values.set("slot-a", JSON.stringify(original));
  f.controller.activate("a", original);
  const local = { ...original, petStats: { ...original.petStats, mood: 49 } };
  assert.equal((await f.controller.flush("a", local)).ok, true);
  assert.equal(JSON.parse(f.values.get("slot-a")).wallet.bits, -100);
});

await test("an overlapping rewarded id refuses an ambiguous duplicate economic delta", async () => {
  const f = fixture();
  const original = initialSave();
  f.controller.activate("a", original);
  const reward = { ...original, rewardedCompletionIds: ["reward-one"], wallet: { ...original.wallet, bits: 110 } };
  f.values.set("slot-a", JSON.stringify(reward));
  assert.equal((await f.controller.update("a", reward)).ok, false);
  assert.equal(JSON.parse(f.values.get("slot-a")).wallet.bits, 110);
  assert.match(f.errors.at(-1).message, /reward was already saved/);
});

await test("reward id merging retains the existing bounded history without reviving pruned ids", async () => {
  const f = fixture();
  const original = initialSave();
  original.rewardedCompletionIds = Array.from({ length: 256 }, (_, index) => `old-${index}`);
  f.values.set("slot-a", JSON.stringify(original));
  f.controller.activate("a", original);
  const remote = { ...original, rewardedCompletionIds: [...original.rewardedCompletionIds.slice(1), "remote-new"] };
  f.values.set("slot-a", JSON.stringify(remote));
  const local = { ...original, rewardedCompletionIds: [...original.rewardedCompletionIds.slice(1), "local-new"] };
  assert.equal((await f.controller.update("a", local)).ok, true);
  const ids = JSON.parse(f.values.get("slot-a")).rewardedCompletionIds;
  assert.equal(ids.length, 256);
  assert(ids.includes("remote-new") && ids.includes("local-new"));
  assert(!ids.includes("old-0"));
});

console.log(`Room save persistence smoke passed: ${checks} checks; only in-memory storage and fake timers were used.`);
