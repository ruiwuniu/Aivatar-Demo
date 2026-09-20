import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Compile the actual modules in memory. All stores and IPC endpoints below are
// synthetic; this test never starts Tauri or opens an installed-app data path.
const modules = new Map();
function load(relative) {
  const filename = path.resolve(relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const require = (name) => {
    if (!name.startsWith('.')) throw new Error(`Unexpected external module: ${name}`);
    return load(path.resolve(path.dirname(filename), `${name}.ts`));
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(require, module, module.exports);
  return module.exports;
}
const { createSaveStore } = load('src/persistence/saveStore.ts');
const { prepareLegacyMigration, collectLegacyEntries } = load('src/persistence/legacySaveMigration.ts');
const KEY = 'aivatar.saveSlot.v1.synthetic';
const THEME = 'aivatar.uiTheme.v1';
const clone = (value) => structuredClone(value);
function memory(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key) };
}
const initial = () => ({ revision: 1, entries: { [KEY]: { revision: 1, value: JSON.stringify({ wallet: { bits: 10 } }) } } });
function backend() {
  let state = initial(), callback, receipt, commits = 0, conflict = false, loseReply = false, ioFail = false, uncertain = false;
  let hold;
  const calls = [];
  const invoke = async (command, request) => {
    calls.push({ command, request: clone(request) });
    if (command === 'save_store_bootstrap') return { sessionId: 'test-session', initialized: true, snapshot: clone(state) };
    if (command === 'save_store_read') return clone(state);
    assert.equal(command, 'save_store_commit');
    if (receipt?.id === request.operationId) return clone(receipt.result);
    if (hold) await hold;
    if (conflict) {
      conflict = false;
      state = { revision: 2, entries: { [KEY]: { revision: 2, value: JSON.stringify({ wallet: { bits: 20 } }) } } };
    }
    let result;
    if (ioFail) { ioFail = false; result = { ok: false, kind: 'error', message: 'synthetic disk full', snapshot: clone(state) }; }
    else if (Object.entries(request.expected).some(([key, version]) => (state.entries[key]?.revision ?? 0) !== version)) {
      result = { ok: false, kind: 'conflict', snapshot: clone(state) };
    } else {
      commits++;
      state.revision++;
      for (const [key, value] of Object.entries(request.changes)) state.entries[key] = { value, revision: state.revision };
      result = { ok: true, snapshot: clone(state) };
      callback?.({ ...clone(state), originSessionId: 'test-session' });
    }
    receipt = { id: request.operationId, result };
    if (loseReply) { loseReply = false; throw new Error('synthetic lost response after COMMIT'); }
    if (uncertain) { uncertain = false; return { ok: false, kind: 'uncertain', message: 'synthetic commit outcome unresolved' }; }
    return result;
  };
  const client = createSaveStore({ native: true, storage: () => { throw new Error('Legacy must not be read after activation'); },
    invoke, listen: async (fn) => { callback = fn; return () => {}; }, retryDelay: async () => {} });
  return { client, calls, get commits() { return commits; }, conflict: () => { conflict = true; },
    loseReply: () => { loseReply = true; }, uncertain: () => { uncertain = true; }, failIo: () => { ioFail = true; },
    hold: (promise) => { hold = promise; }, state: () => clone(state),
    event: (event) => callback(event) };
}
let passed = 0;
async function test(name, run) { await run(); console.log(`PASS ${name}`); passed++; }
const addOne = (view) => { const value = JSON.parse(view.getItem(KEY)); value.wallet.bits++;
  return { changes: { [KEY]: JSON.stringify(value) }, result: value.wallet.bits }; };

await test('activated native bootstrap never touches legacy storage', async () => {
  const { client } = backend(); assert.throws(() => client.getItem(KEY), /not initialized/);
  await client.initialize(); assert.equal(JSON.parse(client.getItem(KEY)).wallet.bits, 10);
});
await test('a transient event subscription failure can be retried at startup', async () => {
  let attempts = 0;
  const client = createSaveStore({ native: true, storage: () => { throw new Error('legacy forbidden'); },
    invoke: async () => ({ sessionId: 'retry-session', initialized: true, snapshot: initial() }),
    listen: async () => { if (++attempts === 1) throw new Error('temporary listener failure'); return () => {}; } });
  await assert.rejects(client.initialize(), /temporary/); await client.initialize();
  assert.equal(attempts, 2); assert.equal(JSON.parse(client.getItem(KEY)).wallet.bits, 10);
});
await test('a transient browser storage denial can be retried at startup', async () => {
  let attempts = 0; const storage = memory();
  const client = createSaveStore({ native: false, storage: () => { if (++attempts === 1) throw new Error('temporary denied'); return storage; },
    invoke: async () => {}, listen: async () => () => {} });
  await assert.rejects(client.initialize(), /denied/); await client.initialize();
  assert.equal(attempts, 2);
});
await test('CAS conflict recomputes the business delta against the latest record', async () => {
  const b = backend(); await b.client.initialize(); b.conflict();
  assert.equal(await b.client.transact(addOne), 21); assert.equal(b.commits, 1);
});
await test('lost response retries the same receipt without rebuilding or awarding twice', async () => {
  const b = backend(); await b.client.initialize(); b.loseReply(); let builds = 0;
  assert.equal(await b.client.transact((view) => { builds++; return addOne(view); }), 11);
  assert.equal(builds, 1); assert.equal(b.commits, 1);
  const writes = b.calls.filter((c) => c.command === 'save_store_commit');
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].request, writes[1].request);
});
await test('an uncertain commit cannot become a new business operation', async () => {
  const b = backend(); await b.client.initialize(); b.uncertain(); let builds = 0;
  assert.equal(await b.client.transact((view) => { builds++; return addOne(view); }), 11);
  assert.equal(builds, 1); assert.equal(b.commits, 1);
  const requests = b.calls.filter((call) => call.command === 'save_store_commit').map((call) => call.request);
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
});
await test('own events update cache before notifying and are never remote echoes', async () => {
  const b = backend(); await b.client.initialize(); const seen = [];
  b.client.subscribe((event) => seen.push({ ...event, cached: b.client.getItem(event.key) }));
  await b.client.transact(addOne); assert.equal(seen.length, 1);
  assert.equal(seen[0].source, 'local'); assert.equal(seen[0].cached, seen[0].newValue);
  b.event(initial()); assert.equal(seen.length, 1, 'obsolete event ignored');
});
await test('drain waits for a real receipt and queued transactions retain order', async () => {
  const b = backend(); await b.client.initialize(); let release;
  b.hold(new Promise((r) => { release = r; }));
  const first = b.client.transact(addOne), second = b.client.transact(addOne);
  let drained = false; const drain = b.client.drain().then(() => { drained = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(drained, false);
  release(); assert.deepEqual(await Promise.all([first, second]), [11, 12]); await drain;
  assert.equal(b.commits, 2);
});
await test('I/O failure retains a setting for close drain retry', async () => {
  const b = backend(); await b.client.initialize(); b.failIo();
  await assert.rejects(b.client.setItem(THEME, 'warm'), /disk full/);
  assert.equal(b.client.getItem(THEME), null); await b.client.drain();
  assert.equal(b.client.getItem(THEME), 'warm'); assert.equal(b.commits, 1);
});
await test('a later business transaction supersedes a failed plain setting intent', async () => {
  const b = backend(); await b.client.initialize(); b.failIo();
  await assert.rejects(b.client.setItem(THEME, 'old'), /disk full/);
  await b.client.transact(() => ({ changes: { [THEME]: 'new' }, result: undefined }));
  await b.client.drain(); assert.equal(b.client.getItem(THEME), 'new'); assert.equal(b.commits, 1);
});
await test('concurrent drain cannot promote an old retry above a newer business transaction', async () => {
  const b = backend(); await b.client.initialize(); b.failIo();
  await assert.rejects(b.client.setItem(THEME, 'old'), /disk full/);
  const draining = b.client.drain();
  const newer = b.client.transact(() => ({ changes: { [THEME]: 'new' }, result: undefined }));
  await Promise.all([draining, newer]);
  assert.equal(b.client.getItem(THEME), 'new'); assert.equal(b.commits, 1);
});
await test('concurrent drain preserves a newer plain setting intent', async () => {
  const b = backend(); await b.client.initialize(); b.failIo();
  await assert.rejects(b.client.setItem(THEME, 'old'), /disk full/);
  const draining = b.client.drain();
  const newer = b.client.setItem(THEME, 'new');
  await Promise.all([draining, newer]);
  assert.equal(b.client.getItem(THEME), 'new'); assert.equal(b.commits, 1);
});
await test('identical values do not create a native transaction', async () => {
  const b = backend(); await b.client.initialize(); await b.client.setItem(KEY, b.client.getItem(KEY));
  assert.equal(b.commits, 0);
});
await test('legacy-only migration creates its registry before React and preserves raw bytes', () => {
  const raw = '{ "wallet": { "bits": -20 }, "avatarName": "Legacy" }'; let id = 0;
  const result = prepareLegacyMigration({ 'aivatar.save.v1': raw }, (prefix) => `${prefix}-${++id}`, '2026-09-20');
  assert.equal(result.rawEntries['aivatar.save.v1'], raw);
  const [slot] = JSON.parse(result.entries['aivatar.saveSlots.v1']);
  assert.equal(result.entries['aivatar.activeSaveSlot.v1'], slot.id);
  assert.equal(JSON.parse(result.entries[`aivatar.saveSlot.v1.${slot.id}`]).wallet.bits, -20);
});
await test('orphan recognized slots retained; unrelated origin keys never read', () => {
  const source = memory({ [KEY]: '{"wallet":{"bits":3}}', secret: 'not app data' });
  const get = source.getItem;
  source.getItem = (key) => { assert.notEqual(key, 'secret'); return get(key); };
  const entries = collectLegacyEntries(source); assert.equal(Object.keys(entries).length, 1);
  assert.deepEqual(prepareLegacyMigration(entries).entries, { ...entries });
});
await test('invalid save, economy, registry and throwing legacy getter block migration', () => {
  for (const entries of [
    { [KEY]: '{broken' }, { [KEY]: '{"petStats":"broken"}' }, { [KEY]: '{"inventory":[null]}' }, { [KEY]: '{"wallet":{"bits":"oops"}}' },
    { 'aivatar.cardRoom.houseBank.v1': 'null' }, { 'aivatar.saveSlots.v1': '{}' },
    { 'aivatar.activeSaveSlot.v1': 'missing' },
  ]) assert.throws(() => prepareLegacyMigration(entries), /Cannot migrate/);
  assert.throws(() => collectLegacyEntries({ get length() { throw new Error('denied'); } }), /denied/);
});
await test('malformed progress is rejected while partial historical memory is preserved', () => {
  for (const memory of ['broken', null, { growth: [] }, { growth: { traits: 'broken' } },
    { growth: { xp: '12' } }, { darkTraits: false }, { preferences: [] },
    { preferences: { itemAffinities: 'broken' } }, { recentEvents: 'broken' },
    { recentEvents: [null] }, { milestones: {} }]) {
    assert.throws(() => prepareLegacyMigration({ [KEY]: JSON.stringify({ memory }) }), /Cannot migrate/);
  }
  for (const extra of [{ purchasedItemIds: 'cookie' }, { rewardedCompletionIds: [null] }]) {
    assert.throws(() => prepareLegacyMigration({ [KEY]: JSON.stringify({ wallet: { bits: 10 }, ...extra }) }), /Cannot migrate/);
  }
  const raw = JSON.stringify({ memory: { growth: { xp: 12 }, recentEvents: [{ id: 'old-event', summary: 'retained' }] } });
  assert.equal(prepareLegacyMigration({ [KEY]: raw }).entries[KEY], raw);
});
await test('browser preview remains usable with synchronous reads and awaited writes', async () => {
  const storage = memory();
  const client = createSaveStore({ native: false, storage: () => storage, invoke: async () => { throw new Error('native forbidden'); }, listen: async () => { throw new Error('native forbidden'); } });
  await client.initialize(); await client.setItem(THEME, 'preview'); assert.equal(client.getItem(THEME), 'preview');
  await client.removeItem(THEME); assert.equal(client.getItem(THEME), null);
});
console.log(`${passed} save-store and migration scenarios passed.`);
