import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Source-only module loading and synthetic in-memory storage: never reads saves,
// provider configuration, conversation files or a running bridge.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modules = new Map();
const context = vm.createContext({ console, setTimeout, clearTimeout });
const load = (relative) => {
  if (modules.has(relative)) return modules.get(relative).exports;
  assert(relative.startsWith("src/") && !relative.includes(".."));
  const module = { exports: {} };
  modules.set(relative, module);
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative,
  }).outputText;
  const evaluate = vm.runInContext(`(function(require,module,exports){${javascript}\n})`, context, { filename: relative });
  evaluate((specifier) => {
    assert(specifier.startsWith("."), `Unexpected external import ${specifier}`);
    return load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${specifier}.ts`)));
  }, module, module.exports);
  return module.exports;
};
const api = load("src/game/learningCandidates.ts");
const { createRoomSavePersistence } = load("src/persistence/roomSavePersistence.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const iso = (n) => new Date(Date.UTC(2026, 9, 10, 8, 0, n)).toISOString();
const memory = () => ({
  recentEvents: [], preferences: { idleBubblePhrases: [], socialBubbles: { active: [], responses: [] } },
  growth: { level: 8, xp: 0, totalXp: 0, completedTurns: 0, errorCount: 0 },
});
const status = (n = 1, extra = {}) => ({
  agent: "codex", sessionId: `synthetic-${n}`, status: "complete", phase: "session-learning", timestamp: iso(n),
  learning: {
    id: `result-${n}`, source: "llm", summary: "Synthetic result", privacyRisk: "low",
    idleBubbleCandidates: [`Fresh thought ${n}`],
    socialBubbleCandidates: [{ kind: "active", text: `Hello ${n}`, intentId: "greeting", locale: "en" }],
    ...extra,
  },
});
let checks = 0;
const check = async (name, run) => {
  await run();
  checks += 1;
  console.log(`[learning-candidates] PASS ${name}`);
};

await check("LLM suggestions from other sessions outrank followed-session and memory templates", () => {
  const selections = api.selectIdleLearningCandidates([
    ...[1, 2, 3].map((n) => ({ phrase: `Memory ${n}`, source: "memory" })),
    ...[1, 2, 3].map((n) => ({ phrase: `Followed ${n}`, source: "session", timestamp: iso(10) })),
    ...[1, 2, 3].map((n) => ({ phrase: `LLM ${n}`, source: "llm", timestamp: iso(n), agent: "opencode" })),
  ], [], "mixed", "en");
  assert.deepEqual(plain(selections.candidates.slice(0, 3).map((value) => value.phrase)), ["LLM 3", "LLM 2", "LLM 1"]);
  assert.equal(selections.candidates.length, 6);
});
await check("duplicate text keeps the best source and freshest provenance", () => {
  const result = api.selectIdleLearningCandidates([
    { phrase: "Shared phrase", source: "session", timestamp: iso(5) },
    { phrase: "Shared phrase", source: "llm", timestamp: iso(1), agent: "codex" },
    { phrase: "Shared phrase", source: "llm", timestamp: iso(2), agent: "opencode" },
  ], [], "mixed", "en");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].agent, "opencode");
});
await check("language-filtered candidates remain stored and become visible in mixed mode", () => {
  const stored = api.receiveLearningRecommendations(undefined, status(1, { idleBubbleCandidates: ["Hello there", "今天也很棒"] }));
  const zh = api.selectIdleLearningCandidates(stored.idleCandidates, [], "auto", "zh-Hans");
  assert.equal(zh.hiddenByLanguage, 1);
  assert.equal(zh.candidates[0].phrase, "今天也很棒");
  assert.equal(api.selectIdleLearningCandidates(stored.idleCandidates, [], "mixed", "zh-Hans").candidates.length, 2);
  assert.equal(stored.idleCandidates.length, 2);
});
await check("pending idle and social candidates survive serialization and empty snapshots", () => {
  const stored = api.receiveLearningRecommendations(undefined, status());
  const reopened = api.normalizeLearningRecommendations(plain(stored));
  const refreshed = api.receiveLearningRecommendations(reopened, { agent: "codex", status: "idle", timestamp: iso(3) });
  assert.deepEqual(plain(refreshed), plain(stored));
  assert.equal(reopened.idleCandidates[0].learningId, "result-1");
  assert.equal(reopened.socialCandidates[0].sessionId, "synthetic-1");
});
await check("legacy saves migrate safely and recent learning receipts prevent replayed XP", () => {
  const oldMemory = memory();
  const receipt = api.learningReceiptId(status());
  oldMemory.recentEvents.push({ id: receipt, type: "session_learning" });
  const restored = api.normalizeLearningRecommendations(undefined, oldMemory);
  assert.equal(restored.idleCandidates.length, 0);
  assert(restored.appliedLearningIds.includes(receipt));
  const newer = api.receiveLearningRecommendations(restored, status(), oldMemory);
  assert.equal(newer.appliedLearningIds.length, 1);
  assert.equal(api.receiveLearningRecommendations(newer, status(), oldMemory).appliedLearningIds.length, 1);
});
await check("high-privacy learning cannot enter idle, social, diagnostic or receipt storage", () => {
  const privateResult = status(1, { privacyRisk: "high", diagnostic: { provider: "codex", status: "fallback", reason: "invalid-output", timestamp: iso(1) } });
  assert.deepEqual(plain(api.receiveLearningRecommendations(undefined, privateResult)), plain(api.normalizeLearningRecommendations()));
  const malformedStored = api.normalizeLearningRecommendations({
    idleCandidates: [{ phrase: "Private phrase", source: "llm", privacyRisk: "high" }],
    socialCandidates: [{ text: "Private social", source: "llm", privacyRisk: "high", kind: "active" }],
  });
  assert.equal(malformedStored.idleCandidates.length + malformedStored.socialCandidates.length, 0);
});
await check("accepted phrases are removed from stored and rendered suggestions", () => {
  const stored = api.receiveLearningRecommendations(undefined, status());
  const accepted = memory();
  accepted.preferences.idleBubblePhrases = ["Fresh thought 1"];
  accepted.preferences.socialBubbles.active = [{ kind: "active", text: "Hello 1", intentId: "greeting" }];
  const after = api.normalizeLearningRecommendations(stored, accepted);
  assert.equal(after.idleCandidates.length + after.socialCandidates.length, 0);
  assert.equal(api.receiveLearningRecommendations(after, status(), accepted).idleCandidates.length, 0);
  assert.equal(api.selectIdleLearningCandidates(stored.idleCandidates, accepted.preferences.idleBubblePhrases, "mixed", "en").candidates.length, 0);
});
await check("latest diagnostic is per provider and success clears only its older failure", () => {
  let stored = api.receiveLearningRecommendations(undefined, status(1, { diagnostic: { provider: "codex", status: "fallback", reason: "timeout", timestamp: iso(1) } }));
  stored = api.receiveLearningRecommendations(stored, status(2, { diagnostic: { provider: "opencode", status: "fallback", reason: "authentication", timestamp: iso(2) } }));
  stored = api.receiveLearningRecommendations(stored, status(3, { diagnostic: { provider: "codex", status: "success", timestamp: iso(3) } }));
  stored = api.receiveLearningRecommendations(stored, status(1, { diagnostic: { provider: "codex", status: "fallback", reason: "timeout", timestamp: iso(1) } }));
  assert.equal(stored.diagnostics.length, 2);
  assert.equal(stored.diagnostics.find((value) => value.provider === "codex").status, "success");
  assert.equal(stored.diagnostics.find((value) => value.provider === "opencode").reason, "authentication");
});
await check("diagnostics keep only whitelisted metadata, never raw errors", () => {
  const diagnostic = api.normalizeLearningDiagnostic({ provider: "codex", status: "fallback", reason: "private raw message", error: "private raw error", timestamp: iso(2) });
  assert.equal(diagnostic.reason, "provider-error");
  assert(!JSON.stringify(diagnostic).includes("private"));
  assert.equal(api.normalizeLearningDiagnostic({ provider: "other", status: "fallback", timestamp: iso(2) }), undefined);
});
await check("candidate and receipt collections remain bounded and prioritize recent LLM results", () => {
  let stored;
  for (let n = 1; n <= 280; n += 1) stored = api.receiveLearningRecommendations(stored, status(n));
  assert.equal(stored.idleCandidates.length, api.LEARNING_CANDIDATE_LIMIT);
  assert.equal(stored.socialCandidates.length, api.LEARNING_CANDIDATE_LIMIT);
  assert.equal(stored.appliedLearningIds.length, api.APPLIED_LEARNING_ID_LIMIT);
  assert.equal(stored.idleCandidates[0].phrase, "Fresh thought 280");
  assert(stored.appliedLearningIds.includes(api.learningReceiptId(status(280))));
});
await check("slot-owned recommendation states do not share mutable arrays", () => {
  const first = api.receiveLearningRecommendations(undefined, status(1));
  const second = api.receiveLearningRecommendations(undefined, status(2));
  assert.equal(second.idleCandidates.some((value) => value.phrase === "Fresh thought 1"), false);
  const third = api.receiveLearningRecommendations(first, status(3));
  assert.equal(first.idleCandidates.length, 1);
  assert.equal(third.idleCandidates.length, 2);
});
await check("receipt ownership can be restored from new and legacy saves without reading candidate text", () => {
  const original = status(1);
  const receipt = api.learningReceiptId(original);
  const saved = { learningRecommendations: plain(api.receiveLearningRecommendations(undefined, original)) };
  assert.equal(api.saveHasLearningReceipt(saved, receipt), true);
  assert.equal(api.saveHasLearningReceipt({ memory: { recentEvents: [{ type: "session_learning", id: receipt }] } }, receipt), true);
  assert.equal(api.saveHasLearningReceipt({}, receipt), false);
  assert.equal(api.saveHasLearningReceipt(saved, api.learningReceiptId({ ...original, learning: { ...original.learning, id: "next-turn" } })), false);
  assert.equal(api.saveHasLearningReceipt({ memory: { recentEvents: [null, { type: "task_complete", id: receipt }] } }, receipt), false);
});
await check("concurrent merges preserve both windows and drop remotely accepted suggestions", () => {
  const local = api.receiveLearningRecommendations(undefined, status(1));
  const remote = api.receiveLearningRecommendations(undefined, status(2));
  const accepted = memory();
  accepted.preferences.idleBubblePhrases = ["Fresh thought 1"];
  const merged = api.mergeLearningRecommendations(local, remote, accepted);
  assert.deepEqual(plain(merged.idleCandidates.map((value) => value.phrase)), ["Fresh thought 2"]);
  assert.equal(merged.socialCandidates.length, 2);
  assert.equal(merged.appliedLearningIds.length, 2);
});
await check("real room persistence durably unions stale windows without overwriting another slot", async () => {
  const baseline = {
    memory: memory(), wallet: { bits: 100, pokerChips: 0 }, petStats: { energy: 80, mood: 80, hunger: 80 },
    inventory: [], purchasedItemIds: [], placedItems: [], furnitureStorage: [],
    learningRecommendations: api.normalizeLearningRecommendations(),
  };
  const store = new Map([["slot:a", JSON.stringify(baseline)], ["slot:b", JSON.stringify(baseline)]]);
  let writes = 0;
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { writes += 1; store.set(key, value); },
  };
  const options = {
    storage, storageKey: (id) => `slot:${id}`,
    normalize: (save) => ({ ...save, learningRecommendations: api.normalizeLearningRecommendations(save.learningRecommendations, save.memory) }),
    runtime: () => undefined, onPersisted: () => {},
  };
  const first = createRoomSavePersistence(options);
  const second = createRoomSavePersistence(options);
  first.activate("a", plain(baseline));
  second.activate("a", plain(baseline));
  await first.update("a", { ...baseline, learningRecommendations: api.receiveLearningRecommendations(undefined, status(1)) });
  await first.drain();
  assert.equal(writes, 1, "recommendations must trigger durable save without a five-minute wait");
  await second.update("a", { ...baseline, learningRecommendations: api.receiveLearningRecommendations(undefined, status(2)) });
  await second.drain();
  const saved = JSON.parse(store.get("slot:a"));
  assert.equal(saved.learningRecommendations.idleCandidates.length, 2);
  assert.equal(saved.learningRecommendations.appliedLearningIds.length, 2);
  assert.equal(JSON.parse(store.get("slot:b")).learningRecommendations.idleCandidates.length, 0);
  assert.equal(saved.wallet.bits, 100);
});
console.log(`[learning-candidates] ${checks} checks passed`);
