import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Synthetic records only. Retry the real transaction builder against a refreshed
// snapshot; failed/discarded attempts never apply any part of their changes.
const records = new Map();
let failReads = false, failWrites = false, conflict = null, beforeCommit = null;
let batches = [];
const appStorage = { getItem(key) {
  if (failReads) throw new Error("synthetic read failure");
  return records.get(key) ?? null;
} };
const transactStore = async (builder) => {
  let attempt = builder(appStorage);
  if (conflict) { const refresh = conflict; conflict = null; refresh(); attempt = builder(appStorage); }
  if (beforeCommit) await beforeCommit;
  if (failWrites) throw new Error("synthetic commit failure");
  const changes = Object.entries(attempt.changes).filter(([k, v]) => appStorage.getItem(k) !== v);
  changes.forEach(([k, v]) => v === null ? records.delete(k) : records.set(k, v));
  batches.push(changes.map(([k]) => k));
  return attempt.result;
};
const compile = (relative, dependencies = {}) => {
  const path = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require(id) {
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency: ${id}`);
  } }, { filename: path.pathname });
  return module.exports;
};
const api = compile("../src/cardRoom/saveRoster.ts", {
  "../persistence/saveStore": { appStorage, transactStore },
  "./chipEconomy": compile("../src/cardRoom/chipEconomy.ts"),
});
const plain = (v) => JSON.parse(JSON.stringify(v));
const key = (id) => `aivatar.saveSlot.v1.${id}`;
const bankKey = api.CARD_ROOM_HOUSE_BANK_KEY, walletKey = api.CARD_ROOM_PLAYER_WALLET_KEY;
const set = (k, v) => records.set(k, JSON.stringify(v));
const get = (k) => JSON.parse(records.get(k));
const seed = () => {
  records.clear(); batches = []; failReads = false; failWrites = false; conflict = null; beforeCommit = null;
  set(key("pet"), { avatarId: "pet", wallet: { bits: 100, pokerChips: 1000 }, unrelated: "keep" });
  set(bankKey, { vaultBits: 100, ownerBits: 40, payoutDebtBits: 0 });
};
let checks = 0;
const test = async (name, run) => { seed(); await run(); checks++; console.log(`PASS ${name}`); };

await test("deleted slots are skipped and never recreated", async () => {
  assert.deepEqual(plain(await api.writeCardRoomSaveSlotPokerChipsResult("deleted", 321)),
    { ok: true, written: false, skipped: true, pokerChips: null });
  assert.equal(await api.writeCardRoomSaveSlotPokerChips("deleted", 321), null);
  assert.equal(records.has(key("deleted")), false);
});
await test("valid saves report actual changes after commit", async () => {
  assert.deepEqual(plain(await api.writeCardRoomSaveSlotPokerChipsResult("pet", 321)),
    { ok: true, written: true, skipped: false, pokerChips: 321 });
  assert.deepEqual(plain(await api.writeCardRoomSaveSlotPokerChipsResult("pet", 321)),
    { ok: true, written: false, skipped: false, pokerChips: 321 });
  assert.equal(get(key("pet")).unrelated, "keep");
});
await test("malformed saves and read/write errors fail closed", async () => {
  records.set(key("bad"), "{not-json");
  assert.equal((await api.writeCardRoomSaveSlotPokerChipsResult("bad", 100)).ok, false);
  assert.equal(records.get(key("bad")), "{not-json");
  failReads = true;
  assert.equal((await api.writeCardRoomSaveSlotPokerChipsResult("pet", 100)).ok, false);
  failReads = false; failWrites = true;
  assert.equal((await api.writeCardRoomSaveSlotPokerChipsResult("pet", 100)).ok, false);
  assert.equal(get(key("pet")).wallet.pokerChips, 1000);
});
await test("close caller cannot receive success before commit completes", async () => {
  let release, finished = false;
  beforeCommit = new Promise((resolve) => { release = resolve; });
  const pending = api.writeCardRoomSaveSlotPokerChipsResult("pet", 321).then((r) => { finished = true; return r; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false); assert.equal(get(key("pet")).wallet.pokerChips, 1000);
  release(); assert.equal((await pending).ok, true); assert.equal(finished, true);
});
await test("gift spends owner bits and credits character in one transaction", async () => {
  assert.equal((await api.giftCardRoomSaveSlotPokerChips("pet")).pokerChips, 2000);
  assert.equal(get(bankKey).ownerBits, 20);
  assert.deepEqual(batches[0].sort(), [bankKey, key("pet")].sort());
});
await test("failed gift cannot mint chips without owner debit", async () => {
  failWrites = true;
  await assert.rejects(api.giftCardRoomSaveSlotPokerChips("pet"), /commit failure/);
  assert.equal(get(key("pet")).wallet.pokerChips, 1000); assert.equal(get(bankKey).ownerBits, 40);
  assert.equal(batches.length, 0);
});
await test("gift CAS retry rechecks latest funds", async () => {
  conflict = () => set(bankKey, { vaultBits: 100, ownerBits: 0, payoutDebtBits: 0 });
  assert.equal(await api.giftCardRoomSaveSlotPokerChips("pet"), null);
  assert.equal(get(key("pet")).wallet.pokerChips, 1000); assert.equal(get(bankKey).ownerBits, 0);
});
await test("exchange retry preserves remote values and credits house bank", async () => {
  conflict = () => set(key("pet"), { wallet: { bits: 150, pokerChips: 1250 }, remote: true });
  const result = await api.exchangeCardRoomSaveSlotPokerChips("pet");
  assert.equal(result.bits, 130); assert.equal(result.pokerChips, 2250);
  assert.equal(get(bankKey).vaultBits, 120); assert.equal(get(key("pet")).remote, true);
});
await test("redeem and cash-out atomically debit bank with slot credit", async () => {
  await api.redeemCardRoomSaveSlotPokerChipsForBits("pet");
  assert.equal(get(key("pet")).wallet.bits, 120); assert.equal(get(key("pet")).wallet.pokerChips, 0);
  assert.equal(get(bankKey).vaultBits, 80);
  set(key("pet"), { wallet: { bits: 0, pokerChips: 1000 } });
  const result = await api.cashOutCardRoomSaveSlotPokerChips("pet");
  assert.equal(result.redeemedBits, 16); assert.equal(result.pokerChips, 200);
  assert.equal(get(bankKey).vaultBits, 64);
  for (const batch of batches) assert.deepEqual(batch.sort(), [bankKey, key("pet")].sort());
});
const player = (isUser, stack) => ({ isUser, stack, pokerChips: 1000, avatarId: isUser ? "user" : "pet", slotId: isUser ? "user" : "pet" });
const before = [player(true, 1000), player(false, 1000)];
const after = [player(true, 900), player(false, 1100)];
await test("one table delta transaction preserves concurrent credits", async () => {
  set(walletKey, { pokerChips: 1000, chipDebt: 10 });
  conflict = () => set(key("pet"), { wallet: { bits: 200, pokerChips: 1200 }, remote: true });
  await api.settleCardRoomTable(after, before);
  assert.equal(get(walletKey).pokerChips, 900); assert.equal(get(walletKey).chipDebt, 10);
  assert.equal(get(key("pet")).wallet.pokerChips, 1300); assert.equal(get(key("pet")).wallet.bits, 200);
  assert.equal(get(key("pet")).remote, true);
  assert.deepEqual(batches[0].sort(), [walletKey, key("pet")].sort());
});
await test("deleted participant or commit failure leaves every table balance intact", async () => {
  set(walletKey, { pokerChips: 1000, chipDebt: 0 }); records.delete(key("pet"));
  await assert.rejects(api.settleCardRoomTable(after, before), /deleted/);
  assert.equal(get(walletKey).pokerChips, 1000); assert.equal(records.has(key("pet")), false);
  seed(); set(walletKey, { pokerChips: 1000, chipDebt: 0 }); failWrites = true;
  await assert.rejects(api.settleCardRoomTable(after, before), /commit failure/);
  assert.equal(get(walletKey).pokerChips, 1000); assert.equal(get(key("pet")).wallet.pokerChips, 1000);
});
await test("wallet-only remote changes refresh idle stacks while live hands stay frozen", () => {
  // Execute the production effect with its real dependency expression. The
  // roster identity stays unchanged, as it does for a wallet-only store event.
  const path = new URL("../src/cardRoom/CardRoomApp.tsx", import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const helpers = [];
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
      && node.arguments[0]?.getText(source).includes("handInProgressForStacks")) effect = node.getText(source);
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["mergeDefaultStacks", "stacksFromTable"].includes(declaration.name.getText(source)))) helpers.push(node.getText(source));
    ts.forEachChild(node, walk);
  };
  walk(source);
  assert.ok(effect, "production stack reconciliation effect must exist");
  assert.equal(helpers.length, 2);
  const { outputText } = ts.transpileModule(`${helpers.join("\n")}\n${effect}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  });
  for (const street of ["waiting", "handComplete", "flop"]) {
    let dependencies, stacks;
    const roster = [{ avatarId: "pet", pokerChips: 1200 }];
    const table = { street, players: [{ avatarId: "card-room-user", stack: 800 }, { avatarId: "pet", stack: 1100 }] };
    const render = (chips) => vm.runInNewContext(outputText, {
      roster, playerWallet: { pokerChips: chips }, playerWalletRef: { current: { pokerChips: chips } },
      tableRef: { current: table }, USER_PLAYER_AVATAR_ID: "card-room-user",
      normalizePokerChips: compile("../src/cardRoom/chipEconomy.ts").normalizePokerChips,
      setStacks: (next) => { stacks = next; },
      useEffect: (callback, next) => {
        if (!dependencies || next.some((value, index) => !Object.is(value, dependencies[index]))) callback();
        dependencies = next;
      },
    });
    render(1000);
    render(2500);
    assert.equal(stacks["card-room-user"], street === "flop" ? 800 : 2500, street);
    assert.equal(stacks.pet, street === "flop" ? 1100 : 1200, street);
  }
});
console.log(`Card-room persistence smoke passed: ${checks} checks; synthetic records only.`);
