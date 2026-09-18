import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = new URL("../src/cardRoom/saveRoster.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
});

const records = new Map();
let failReads = false;
let failWrites = false;
const localStorage = {
  getItem(key) {
    if (failReads) throw new Error("synthetic read failure");
    return records.get(key) ?? null;
  },
  setItem(key, value) {
    if (failWrites) throw new Error("synthetic write failure");
    records.set(key, String(value));
  },
};

const normalizeInteger = (value) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
const module = { exports: {} };
vm.runInNewContext(
  outputText,
  {
    module,
    exports: module.exports,
    localStorage,
    require(id) {
      if (id === "../persistence/savePersistence") {
        return {
          writeJsonIfChanged(storage, key, value) {
            const next = JSON.stringify(value);
            if (storage.getItem(key) === next) return false;
            storage.setItem(key, next);
            return true;
          },
        };
      }
      if (id === "./chipEconomy") {
        return {
          normalizePokerChips: normalizeInteger,
          normalizeWalletBits: normalizeInteger,
        };
      }
      throw new Error(`Unexpected dependency: ${id}`);
    },
  },
  { filename: sourcePath.pathname },
);

const api = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const slotKey = (slotId) => `aivatar.saveSlot.v1.${slotId}`;
let checks = 0;
const test = (name, run) => {
  run();
  checks += 1;
  console.log(`PASS ${name}`);
};

test("deleted companion slots are safely skipped during close", () => {
  assert.deepEqual(
    plain(api.writeCardRoomSaveSlotPokerChipsResult("deleted-slot", 321)),
    { ok: true, written: false, skipped: true, pokerChips: null },
  );
  assert.equal(api.writeCardRoomSaveSlotPokerChips("deleted-slot", 321), null);
});

test("valid companion slots report whether close changed storage", () => {
  records.set(slotKey("companion"), JSON.stringify({ wallet: { bits: 7, pokerChips: 10 } }));
  assert.deepEqual(
    plain(api.writeCardRoomSaveSlotPokerChipsResult("companion", 321)),
    { ok: true, written: true, skipped: false, pokerChips: 321 },
  );
  assert.deepEqual(
    plain(api.writeCardRoomSaveSlotPokerChipsResult("companion", 321)),
    { ok: true, written: false, skipped: false, pokerChips: 321 },
  );
});

test("malformed saves fail closed instead of being overwritten", () => {
  records.set(slotKey("malformed"), "{not-json");
  assert.deepEqual(
    plain(api.writeCardRoomSaveSlotPokerChipsResult("malformed", 100)),
    { ok: false, written: false, skipped: false, pokerChips: null },
  );
  assert.equal(records.get(slotKey("malformed")), "{not-json");
});

test("storage read and write failures fail closed", () => {
  failReads = true;
  assert.equal(api.writeCardRoomSaveSlotPokerChipsResult("companion", 100).ok, false);
  failReads = false;
  failWrites = true;
  assert.equal(api.writeCardRoomSaveSlotPokerChipsResult("companion", 100).ok, false);
  failWrites = false;
});

console.log(`Card-room close-save smoke passed: ${checks} checks; no application files were used.`);
