import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Execute the actual TypeScript modules with memory-only storage and a fake
// clock. No user save, WebKit profile, browser, or local bridge is opened.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const slotKey = (slot = "synthetic") => `aivatar.saveSlot.v1.${slot}`;
const baseSave = () => ({
  avatarId: "synthetic-avatar",
  inventory: [],
  wallet: { bits: 100, pokerChips: 25 },
  petStats: { mood: 40, energy: 80, hunger: 60 },
  furnitureStorage: [],
  memory: { growth: { traits: { curiosity: 0 } }, recentEvents: [] },
});
const runtime = (x) => ({ x, y: 48, behavior: "wander", behaviorTime: x });

const createHarness = () => {
  let now = 0;
  let nextTimer = 1;
  let failWrites = false;
  let failReads = false;
  const timers = new Map();
  const values = new Map([[slotKey(), JSON.stringify(baseSave())]]);
  const writes = [];
  const modules = new Map();
  const context = vm.createContext({
    console,
    localStorage: {
      getItem: (key) => {
        if (failReads) throw new Error("synthetic read failure");
        return values.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (failWrites) throw new Error("synthetic write failure");
        values.set(key, value);
        writes.push({ key, value, at: now });
      },
    },
    setTimeout: (callback, delay) => {
      const timer = nextTimer++;
      timers.set(timer, { at: now + delay, callback });
      return timer;
    },
    clearTimeout: (timer) => timers.delete(timer),
    window: { dispatchEvent: () => {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
  });
  const load = (file) => {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const source = fs.readFileSync(file, "utf8");
    const javascript = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const evaluate = vm.runInContext(`(function(require,module,exports){${javascript}\n})`, context, { filename: file });
    evaluate((specifier) => {
      assert(specifier.startsWith("."), `Unexpected external import ${specifier}`);
      return load(path.resolve(path.dirname(file), `${specifier}.ts`));
    }, module, module.exports);
    return module.exports;
  };
  const api = load(path.join(root, "src/park/parkStorage.ts"));
  const advanceTo = (target) => {
    assert(target >= now);
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = target;
  };
  return {
    api, values, writes, advanceTo,
    setFailWrites: (value) => { failWrites = value; },
    setFailReads: (value) => { failReads = value; },
    stored: (slot = "synthetic") => JSON.parse(values.get(slotKey(slot))),
    queue: (x, slot = "synthetic") => api.persistParkRuntime(slot, runtime(x), api.defaultParkNavMemory()),
  };
};

let checks = 0;
const check = (name, run) => {
  run();
  checks += 1;
  console.log(`[park-persistence] PASS ${name}`);
};

check("continuous runtime changes coalesce at the first 20-second deadline", () => {
  const h = createHarness();
  h.queue(0);
  for (let second = 2; second <= 18; second += 2) {
    h.advanceTo(second * 1000);
    h.queue(second);
    assert.equal(h.writes.length, 0);
  }
  assert.equal(h.api.readParkSaveSlot("synthetic").parkRuntime.x, 18);
  h.advanceTo(19_999);
  assert.equal(h.writes.length, 0);
  h.advanceTo(20_000);
  assert.equal(h.writes.length, 1);
  assert.equal(h.stored().parkRuntime.x, 18);
  h.advanceTo(22_000);
  h.queue(22);
  h.advanceTo(41_999);
  assert.equal(h.writes.length, 1);
  h.advanceTo(42_000);
  assert.equal(h.writes.length, 2);
});

check("pending mood and runtime merge with another window's current wallet", () => {
  const h = createHarness();
  h.queue(10);
  h.advanceTo(18_000);
  const visible = h.api.recordParkMoodRecovery("synthetic", 3);
  assert.equal(visible.petStats.mood, 43);
  assert.equal(visible.parkRuntime.x, 10);
  assert.equal(h.writes.length, 0);
  const remote = h.stored();
  remote.wallet.bits = 777;
  remote.petStats.energy = 72;
  h.values.set(slotKey(), JSON.stringify(remote));
  h.advanceTo(20_000);
  assert.equal(h.writes.length, 1);
  assert.equal(h.stored().wallet.bits, 777);
  assert.equal(h.stored().petStats.energy, 72);
  assert.equal(h.stored().petStats.mood, 43);
});

check("catch commits rewards and the current pending runtime immediately once", () => {
  const h = createHarness();
  h.queue(25);
  h.api.recordParkMoodRecovery("synthetic", 1);
  const saved = h.api.recordParkCatch("synthetic", "raw-crucian-carp");
  assert(saved);
  assert.equal(h.writes.length, 1);
  assert.equal(saved.parkRuntime.x, 25);
  assert.equal(saved.furnitureStorage[0].quantity, 1);
  assert.equal(saved.memory.recentEvents.length, 1);
  assert(saved.petStats.mood > 41);
  h.advanceTo(60_000);
  assert.equal(h.writes.length, 1);
});

check("failed critical save retains its patch and retries against fresh storage", () => {
  const h = createHarness();
  h.queue(30);
  h.setFailWrites(true);
  assert.equal(h.api.recordParkCatch("synthetic", "raw-bluegill"), null);
  assert.equal(h.writes.length, 0);
  assert.equal(h.api.readParkSaveSlot("synthetic").furnitureStorage[0].quantity, 1);
  h.queue(31);
  const remote = h.stored();
  remote.wallet.bits = 999;
  h.values.set(slotKey(), JSON.stringify(remote));
  h.setFailWrites(false);
  h.advanceTo(20_000);
  assert.equal(h.writes.length, 1);
  assert.equal(h.stored().wallet.bits, 999);
  assert.equal(h.stored().parkRuntime.x, 31);
  assert.equal(h.stored().furnitureStorage[0].quantity, 1);
  assert.equal(h.stored().memory.recentEvents.length, 1);
  h.advanceTo(60_000);
  assert.equal(h.writes.length, 1);
});

check("read errors preserve pending data for a later successful retry", () => {
  const h = createHarness();
  h.queue(40);
  h.setFailReads(true);
  h.advanceTo(20_000);
  assert.equal(h.writes.length, 0);
  h.setFailReads(false);
  h.advanceTo(40_000);
  assert.equal(h.writes.length, 1);
  assert.equal(h.stored().parkRuntime.x, 40);
});

check("a catch observed during a read failure is not discarded", () => {
  const h = createHarness();
  h.queue(41);
  h.setFailReads(true);
  assert.equal(h.api.recordParkCatch("synthetic", "raw-black-bass"), null);
  h.setFailReads(false);
  h.advanceTo(20_000);
  assert.equal(h.writes.length, 1);
  assert.equal(h.stored().furnitureStorage[0].itemId, "raw-black-bass");
  assert.equal(h.stored().furnitureStorage[0].quantity, 1);
});

check("a deleted slot is not recreated and its pending patch is discarded", () => {
  const h = createHarness();
  h.queue(50);
  h.values.delete(slotKey());
  h.advanceTo(20_000);
  assert.equal(h.values.has(slotKey()), false);
  assert.equal(h.writes.length, 0);
  h.values.set(slotKey(), JSON.stringify(baseSave()));
  h.api.flushParkSaveSlot("synthetic");
  assert.equal(h.stored().parkRuntime, undefined);
  h.advanceTo(60_000);
  assert.equal(h.writes.length, 0);
});

check("exit flush writes the latest snapshot immediately and repeated flush is a no-op", () => {
  const h = createHarness();
  h.queue(60);
  h.advanceTo(1000);
  h.queue(61);
  assert.equal(h.api.flushParkSaveSlot("synthetic").parkRuntime.x, 61);
  assert.equal(h.writes.length, 1);
  h.api.flushParkSaveSlot("synthetic");
  h.queue(61);
  h.api.flushParkSaveSlot("synthetic");
  h.advanceTo(60_000);
  assert.equal(h.writes.length, 1);
});

check("a failed old-slot exit flush retries without taking the new slot's runtime", () => {
  const h = createHarness();
  h.values.set(slotKey("other"), JSON.stringify(baseSave()));
  h.queue(62);
  h.setFailWrites(true);
  assert.equal(h.api.flushParkSaveSlot("synthetic"), null);
  h.queue(92, "other");
  h.setFailWrites(false);
  h.api.flushParkSaveSlot("other");
  h.advanceTo(20_000);
  assert.equal(h.stored().parkRuntime.x, 62);
  assert.equal(h.stored("other").parkRuntime.x, 92);
  assert.equal(h.writes.length, 2);
});

check("queued runtime and navigation values do not retain mutable input references", () => {
  const h = createHarness();
  const movement = {
    ...runtime(63),
    interactionTargetAlternates: [{ x: 1, y: 2 }],
    navigationFailure: { behavior: "wander", targetX: 3, targetY: 4, reason: "blocked" },
  };
  const nav = h.api.defaultParkNavMemory();
  nav.exploredCells["1,2"] = 3;
  h.api.persistParkRuntime("synthetic", movement, nav);
  movement.x = 999;
  movement.interactionTargetAlternates[0].x = 999;
  movement.navigationFailure.targetX = 999;
  nav.exploredCells["1,2"] = 999;
  h.api.flushParkSaveSlot("synthetic");
  const saved = h.stored();
  assert.equal(saved.parkRuntime.x, 63);
  assert.equal(saved.parkRuntime.interactionTargetAlternates[0].x, 1);
  assert.equal(saved.parkRuntime.navigationFailure.targetX, 3);
  assert.equal(saved.parkNavMemory.exploredCells["1,2"], 3);
});

check("independent slots and identical layout/runtime values avoid extra writes", () => {
  const h = createHarness();
  h.values.set(slotKey("other"), JSON.stringify(baseSave()));
  h.queue(70);
  h.queue(80, "other");
  h.api.flushParkSaveSlot("other");
  assert.equal(h.writes.length, 1);
  assert.equal(h.stored("other").parkRuntime.x, 80);
  assert.equal(h.stored().parkRuntime, undefined);
  h.advanceTo(20_000);
  assert.equal(h.writes.length, 2);
  h.queue(70);
  h.advanceTo(40_000);
  assert.equal(h.writes.length, 2);
  h.api.writeParkLayout([]);
  h.api.writeParkLayout([]);
  assert.equal(h.writes.length, 3);
});

console.log(`[park-persistence] ${checks} scenarios passed; synthetic storage only.`);
