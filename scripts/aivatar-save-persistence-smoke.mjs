import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = new URL("../src/persistence/savePersistence.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
});
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports }, { filename: sourcePath.pathname });
const {
  createSavePersistence,
  writeJsonIfChanged,
  mergeSaveChanges,
  jsonEqual,
  DEFAULT_SAVE_WAIT_MS,
  DEFAULT_SAVE_RETRY_MS,
} = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const fakeClock = () => {
  let now = 0;
  let nextId = 0;
  const tasks = new Map();
  return {
    setTimer(callback, delayMs) {
      const id = ++nextId;
      tasks.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimer(id) { tasks.delete(id); },
    advanceTo(target) {
      assert.ok(target >= now);
      let executed = 0;
      while (true) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next || next[1].at > target) break;
        assert.ok(++executed <= 1000, "fake timer execution must remain bounded");
        tasks.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
    },
    get size() { return tasks.size; },
  };
};

const fakeStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  const writes = [];
  const storage = {
    failRead: false,
    failWrite: false,
    getItem(key) {
      if (storage.failRead) throw new Error("synthetic read failure");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (storage.failWrite) throw new Error("synthetic write failure");
      writes.push({ key, value });
      values.set(key, value);
    },
  };
  return { storage, values, writes };
};

const fixture = (initial = {}) => {
  const memory = fakeStorage(initial);
  const clock = fakeClock();
  const errors = [];
  const writer = createSavePersistence({
    storage: memory.storage,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onError: (error, key) => errors.push({ error, key }),
  });
  return { ...memory, clock, writer, errors };
};

let checks = 0;
const test = (name, run) => {
  run();
  checks += 1;
  console.log(`PASS ${name}`);
};

test("JSON equality ignores object key order and absent undefined fields", () => {
  assert.equal(jsonEqual({ b: [1, { x: 2 }], a: 3 }, { a: 3, b: [1, { x: 2 }] }), true);
  assert.equal(jsonEqual({ a: undefined }, {}), true);
  assert.equal(jsonEqual({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(jsonEqual({ a: null }, {}), false);
});

test("equal JSON skips writes but rechecks external storage every time", () => {
  const { storage, values, writes } = fakeStorage({ slot: '{"b":2,"a":1}' });
  assert.equal(writeJsonIfChanged(storage, "slot", { a: 1, b: 2 }), false);
  assert.equal(writes.length, 0);
  values.set("slot", '{"a":8,"b":2}');
  assert.equal(writeJsonIfChanged(storage, "slot", { a: 1, b: 2 }), true);
  assert.equal(writes.length, 1);
  assert.equal(writeJsonIfChanged(storage, "slot", { b: 2, a: 1 }), false);
  values.set("slot", "not JSON");
  assert.equal(writeJsonIfChanged(storage, "slot", { a: 1, b: 2 }), true);
  assert.throws(() => writeJsonIfChanged(storage, "slot", undefined), /JSON serializable/);
});

test("continuous changes flush at the original five-minute deadline with the latest snapshot", () => {
  const { writer, clock, values, writes } = fixture();
  assert.equal(DEFAULT_SAVE_WAIT_MS, 300_000);
  let latest = 0;
  let snapshots = 0;
  for (let update = 0; update < 600; update += 1) {
    clock.advanceTo(update * 500);
    latest = update;
    writer.schedule("slot", () => { snapshots += 1; return { nav: latest }; });
  }
  latest = 600;
  assert.equal(snapshots, 0);
  clock.advanceTo(299_999);
  assert.equal(writes.length, 0);
  clock.advanceTo(300_000);
  assert.equal(snapshots, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(values.get("slot")), { nav: 600 });
  assert.equal(writer.hasPending(), false);
});

test("ten minutes of 500ms changes produce one checkpoint per five-minute window", () => {
  const { writer, clock, writes } = fixture();
  for (let update = 0; update < 1200; update += 1) {
    clock.advanceTo(update * 500);
    writer.schedule("slot", () => ({ update }));
  }
  clock.advanceTo(600_000);
  assert.equal(writes.length, 2);
  assert.equal(writer.hasPending(), false);
});

test("keys have independent deadlines and flush without dirty work is a no-op", () => {
  const { writer, clock, writes } = fixture();
  assert.deepEqual(plain(writer.flush("absent")), { ok: true, written: false });
  writer.schedule("a", () => ({ value: 1 }));
  clock.advanceTo(5000);
  writer.schedule("b", () => ({ value: 2 }));
  clock.advanceTo(300_000);
  assert.deepEqual(writes.map(({ key }) => key), ["a"]);
  assert.equal(writer.hasPending("b"), true);
  clock.advanceTo(305_000);
  assert.deepEqual(writes.map(({ key }) => key), ["a", "b"]);
});

test("critical flush writes immediately and also notifies on an equal-content skip", () => {
  const { writer, clock, writes } = fixture();
  const saved = [];
  const onPersisted = (snapshot, written) => saved.push({ snapshot, written });
  assert.deepEqual(plain(writer.flush("slot", () => ({ bits: 42 }), onPersisted)), { ok: true, written: true });
  writer.schedule("slot", () => ({ bits: 42 }), onPersisted);
  assert.deepEqual(plain(writer.flush("slot")), { ok: true, written: false });
  clock.advanceTo(600_000);
  assert.equal(writes.length, 1);
  assert.deepEqual(saved.map(({ written }) => written), [true, false]);
  assert.equal(writer.hasPending(), false);
});

test("close/manual flush commits the latest passive snapshot before five minutes", () => {
  const { writer, clock, values, writes } = fixture();
  let latest = 1;
  writer.schedule("slot", () => ({ nav: latest }));
  clock.advanceTo(42_000);
  latest = 2;
  writer.schedule("slot", () => ({ nav: latest }));
  assert.deepEqual(plain(writer.flush("slot")), { ok: true, written: true });
  assert.deepEqual(JSON.parse(values.get("slot")), { nav: 2 });
  assert.equal(writes.length, 1);
  clock.advanceTo(600_000);
  assert.equal(writes.length, 1, "the cancelled checkpoint must not replay after close flush");
});

test("write failures retain pending work and retry the newest snapshot without extending the retry deadline", () => {
  const { writer, clock, storage, values, errors } = fixture();
  assert.equal(DEFAULT_SAVE_RETRY_MS, 20_000);
  const saved = [];
  storage.failWrite = true;
  writer.schedule("slot", () => ({ bits: 1 }), (snapshot) => saved.push(snapshot));
  clock.advanceTo(300_000);
  assert.equal(writer.hasPending("slot"), true);
  assert.equal(errors.length, 1);
  assert.equal(saved.length, 0);
  clock.advanceTo(310_000);
  writer.schedule("slot", () => ({ bits: 2 }), (snapshot) => saved.push(snapshot));
  storage.failWrite = false;
  clock.advanceTo(319_999);
  assert.equal(writer.hasPending("slot"), true);
  assert.equal(values.has("slot"), false);
  clock.advanceTo(320_000);
  assert.deepEqual(JSON.parse(values.get("slot")), { bits: 2 });
  assert.equal(saved.length, 1);
  assert.equal(writer.hasPending(), false);
});

test("snapshot, serialization, and read errors keep a retryable pending save", () => {
  for (const mode of ["snapshot", "serialization", "read"]) {
    const { writer, clock, storage, writes } = fixture();
    let broken = true;
    if (mode === "read") storage.failRead = true;
    writer.schedule("slot", () => {
      if (broken && mode === "snapshot") throw new Error("synthetic invalid remote JSON");
      return broken && mode === "serialization" ? { value: 1n } : { value: 1 };
    });
    assert.equal(writer.flush("slot").ok, false);
    assert.equal(writer.hasPending(), true);
    broken = false;
    storage.failRead = false;
    clock.advanceTo(20_000);
    assert.equal(writes.length, 1);
    assert.equal(writer.hasPending(), false);
  }
});

test("a deleted destination can skip the snapshot without recreating the slot", () => {
  const { writer, clock, writes } = fixture();
  const saved = [];
  writer.schedule("deleted-slot", () => undefined, (snapshot, written) => saved.push({ snapshot, written }));
  clock.advanceTo(300_000);
  assert.equal(writes.length, 0);
  assert.deepEqual(saved, [{ snapshot: undefined, written: false }]);
  assert.equal(writer.hasPending(), false);
});

test("completion callback failure never requeues an already committed write", () => {
  const { writer, clock, writes, errors } = fixture();
  assert.equal(writer.flush("slot", () => ({ bits: 1 }), () => { throw new Error("callback failure"); }).ok, true);
  assert.equal(errors.length, 1);
  assert.equal(writer.hasPending(), false);
  clock.advanceTo(600_000);
  assert.equal(writes.length, 1);
});

test("cancel removes only its key and flushAll reports each remaining result", () => {
  const { writer, clock, writes } = fixture();
  writer.schedule("leave-slot", () => ({ value: 1 }));
  writer.schedule("keep-slot", () => ({ value: 2 }));
  writer.cancel("leave-slot");
  assert.deepEqual(plain(writer.flushAll()), [{ key: "keep-slot", ok: true, written: true }]);
  clock.advanceTo(600_000);
  assert.deepEqual(writes.map(({ key }) => key), ["keep-slot"]);
  assert.equal(clock.size, 0);
});

test("new work scheduled during a flush survives the older flush", () => {
  const { writer, clock, writes, values } = fixture();
  writer.schedule("slot", () => {
    writer.schedule("slot", () => ({ value: 2 }));
    return { value: 1 };
  });
  assert.equal(writer.flush("slot").ok, true);
  assert.equal(writer.hasPending("slot"), true);
  clock.advanceTo(300_000);
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(values.get("slot")), { value: 2 });
});

test("three-way merge preserves unrelated external fields and recursively combines independent edits", () => {
  const base = { nav: { visits: 1 }, wallet: { bits: 10, chips: 2 }, pet: { energy: 50, mood: 50 } };
  const local = { nav: { visits: 2 }, wallet: { bits: 10, chips: 2 }, pet: { energy: 49, mood: 50 } };
  const remote = { nav: { visits: 1 }, wallet: { bits: 20, chips: 3 }, pet: { energy: 50, mood: 60 }, parkRuntime: { x: 7 } };
  const before = JSON.stringify([base, local, remote]);
  assert.deepEqual(plain(mergeSaveChanges(base, local, remote)), {
    nav: { visits: 2 }, wallet: { bits: 20, chips: 3 }, pet: { energy: 49, mood: 60 }, parkRuntime: { x: 7 },
  });
  assert.equal(JSON.stringify([base, local, remote]), before, "merging must not mutate its inputs");
});

test("three-way merge handles deletions, external additions, and atomic array conflicts", () => {
  const base = { keep: 1, localDelete: 1, remoteDelete: 1, unchangedArray: [1], changedArray: [1], optional: undefined };
  const local = { keep: 2, remoteDelete: 1, unchangedArray: [1], changedArray: [2] };
  const remote = { keep: 3, localDelete: 2, unchangedArray: [3], changedArray: [3], added: true };
  assert.deepEqual(plain(mergeSaveChanges(base, local, remote)), {
    keep: 2, unchangedArray: [3], changedArray: [2], added: true,
  });
  assert.deepEqual(plain(mergeSaveChanges({}, { nested: { local: 1 } }, { nested: { remote: 2 } })), {
    nested: { remote: 2, local: 1 },
  });
});

test("delayed saves merge against storage at flush time and advance their baseline only after success", () => {
  const { writer, clock, storage, values } = fixture({ slot: '{"nav":{"visits":1},"wallet":{"bits":10}}' });
  let base = JSON.parse(values.get("slot"));
  const local = { nav: { visits: 2 }, wallet: { bits: 10 } };
  writer.schedule("slot", () => mergeSaveChanges(base, local, JSON.parse(storage.getItem("slot"))), (snapshot) => { base = snapshot; });
  values.set("slot", '{"nav":{"visits":1},"wallet":{"bits":99}}');
  clock.advanceTo(300_000);
  assert.deepEqual(JSON.parse(values.get("slot")), { nav: { visits: 2 }, wallet: { bits: 99 } });
  assert.deepEqual(plain(base), { nav: { visits: 2 }, wallet: { bits: 99 } });
});

console.log(`Save persistence smoke passed: ${checks} checks; only in-memory storage and fake timers were used.`);
