#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import {
  buildWorkbuddyStatusPayload,
  discoverWorkbuddyOnce,
  normalizeWorkbuddyTaskStatus,
  takeWorkbuddyLearningRequest,
  workbuddyLearningProvider,
} from "./workbuddy-session-discovery.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "aivatar-workbuddy-smoke-"));

try {
  await mkdir(join(tempDir, "sessions"), { recursive: true });
  const db = new DatabaseSync(join(tempDir, "workbuddy.db"));
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      title TEXT,
      custom_title TEXT,
      status TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER,
      source_mode TEXT,
      mode TEXT,
      model TEXT,
      permission_mode TEXT,
      last_activity_at INTEGER
    );
    CREATE TABLE session_usage (
      session_id TEXT PRIMARY KEY,
      used INTEGER NOT NULL,
      size INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      credit_json TEXT
    );
  `);
  const now = Date.now();
  const insertSession = db.prepare(`
    INSERT INTO sessions (
      id, cwd, title, custom_title, status, created_at, updated_at,
      deleted_at, source_mode, mode, model, permission_mode, last_activity_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'craft', 'fast-model', 'bypassPermissions', ?)
  `);
  insertSession.run(
    "working-session",
    "C:/Workbuddy/working",
    "Working task",
    null,
    "running",
    now - 5000,
    now - 2000,
    "working",
    now - 2000,
  );
  insertSession.run(
    "coding-session",
    "C:/Workbuddy/coding",
    "Coding task",
    null,
    "completed",
    now - 4000,
    now - 1000,
    "coding",
    now - 1000,
  );
  db.prepare(
    "INSERT INTO session_usage (session_id, used, size, updated_at, credit_json) VALUES (?, ?, ?, ?, ?)",
  ).run("working-session", 1200, 200000, now - 2000, null);
  db.prepare(
    "INSERT INTO session_usage (session_id, used, size, updated_at, credit_json) VALUES (?, ?, ?, ?, ?)",
  ).run("coding-session", 4500, 200000, now - 1000, null);
  db.close();

  const internationalHome = join(tempDir, "workbuddy-ai-home");
  await mkdir(internationalHome, { recursive: true });
  const internationalDb = new DatabaseSync(join(internationalHome, "workbuddy.db"));
  internationalDb.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      title TEXT,
      custom_title TEXT,
      status TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER,
      source_mode TEXT,
      mode TEXT,
      model TEXT,
      permission_mode TEXT,
      last_activity_at INTEGER
    );
    CREATE TABLE session_usage (
      session_id TEXT PRIMARY KEY,
      used INTEGER NOT NULL,
      size INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      credit_json TEXT
    );
  `);
  internationalDb
    .prepare(
      `
      INSERT INTO sessions (
        id, cwd, title, custom_title, status, created_at, updated_at,
        deleted_at, source_mode, mode, model, permission_mode, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'craft', 'fast-model', 'bypassPermissions', ?)
    `,
    )
    .run(
      "international-session",
      "C:/Workbuddy/international",
      "International task",
      null,
      "running",
      now - 3000,
      now - 500,
      "coding",
      now - 500,
    );
  internationalDb
    .prepare(
      "INSERT INTO session_usage (session_id, used, size, updated_at, credit_json) VALUES (?, ?, ?, ?, ?)",
    )
    .run("international-session", 2200, 168000, now - 500, null);
  internationalDb.close();

  await writeFile(
    join(tempDir, "sessions", "coding-session.json"),
    JSON.stringify({
      pid: 123,
      sessionId: "coding-session",
      cwd: "C:/Workbuddy/coding",
      startedAt: now - 4000,
      updatedAt: now - 1000,
      kind: "interactive",
    }),
  );

  assert.equal(normalizeWorkbuddyTaskStatus("model-streaming"), "working");
  assert.equal(normalizeWorkbuddyTaskStatus("await_input"), "pending");
  assert.equal(normalizeWorkbuddyTaskStatus("done"), "completed");

  const states = new Map([
    ["coding-session", { baselineUsed: 1000 }],
  ]);
  const payloads = await discoverWorkbuddyOnce({
    DatabaseSync,
    configDir: tempDir,
    states,
    now,
    post: false,
  });

  const working = payloads.find((payload) => payload.sessionId === "working-session");
  assert.equal(working.status, "executing");
  assert.equal(working.surface, "working");
  assert.equal(working.usage.scope, "context-window");
  assert.equal(working.usage.contextTokens, 1200);
  assert.equal(working.usage.modelContextWindow, 200000);

  const coding = payloads.find((payload) => payload.sessionId === "coding-session");
  assert.equal(coding.status, "complete");
  assert.equal(coding.surface, "coding");
  assert.equal(coding.usage.scope, "since-baseline");
  assert.equal(coding.usage.totalTokens, 3500);
  assert.equal(coding.usage.inputTokens, 3500);
  assert.equal(coding.usage.contextTokens, 4500);
  assert.match(coding.rewardId, /^workbuddy:coding-session:/);

  const repeatedPayloads = await discoverWorkbuddyOnce({
    DatabaseSync,
    configDir: tempDir,
    states,
    now: now + 1000,
    post: false,
  });
  assert.equal(
    repeatedPayloads.some((payload) => payload.sessionId === "coding-session"),
    false,
    "an unchanged terminal row must not emit a second rewardable completion",
  );
  const lockedCodingState = states.get("coding-session");
  assert.equal(lockedCodingState.terminalReward.rewardId, coding.rewardId);
  assert.equal(lockedCodingState.terminalReward.usage.scope, "since-baseline");
  assert.equal(lockedCodingState.terminalReward.usage.totalTokens, 3500);

  const restartedCoding = buildWorkbuddyStatusPayload(
    {
      id: "coding-session",
      title: "Coding task",
      status: "completed",
      sourceMode: "coding",
      createdAt: now - 4000,
      updatedAt: now - 1000,
      lastActivityAt: now - 1000,
      usageUpdatedAt: now + 5000,
      used: 5000,
      size: 200000,
    },
    undefined,
    { baselineUsed: 1000 },
    now + 5000,
  );
  assert.equal(
    restartedCoding.rewardId,
    coding.rewardId,
    "usage-only updates after a restart must keep the same completion identity",
  );

  const terminatedLive = buildWorkbuddyStatusPayload(
    {
      id: "live-session",
      title: "Live terminated row",
      status: "Terminated",
      sourceMode: "working",
      updatedAt: now,
      used: 10,
      size: 200000,
    },
    { sessionId: "live-session", updatedAt: now },
    {},
    now,
  );
  assert.equal(terminatedLive.status, "thinking");

  const combinedPayloads = await discoverWorkbuddyOnce({
    DatabaseSync,
    configDirs: [join(tempDir, "missing-home"), tempDir, internationalHome],
    states: new Map(),
    now,
    post: false,
  });
  assert.ok(
    combinedPayloads.some((payload) => payload.sessionId === "working-session"),
    "mainland-style WorkBuddy home should be scanned",
  );
  assert.ok(
    combinedPayloads.some((payload) => payload.sessionId === "international-session"),
    "international WorkBuddy home should be scanned",
  );

  const learningRow = {
    id: "learning-session", status: "completed", sourceMode: "coding",
    createdAt: now - 3000, updatedAt: now, lastActivityAt: now,
    title: "SECRET-TITLE", cwd: "/private/SECRET-PATH", model: "SECRET-MODEL",
  };
  const metadataState = {};
  const request = (status, options = {}) => takeWorkbuddyLearningRequest(
    learningRow, { status }, metadataState, "/synthetic/home:learning-session", options,
  );
  assert.equal(request("complete"), undefined, "startup must not replay an old completion");
  assert.equal(request("error"), undefined, "startup must not replay an old failure");
  assert.equal(request("executing"), undefined);
  const firstLearning = request("complete");
  assert.equal(firstLearning.provider, "codebuddy");
  assert.equal(firstLearning.agent, "workbuddy");
  assert.match(firstLearning.learningId, /^workbuddy-[a-f0-9]{16}$/u);
  assert.equal(firstLearning.summary, "WorkBuddy coding task completed.");
  assert.doesNotMatch(JSON.stringify(firstLearning), /SECRET-|\/synthetic\//u);
  assert.equal(request("complete"), undefined, "one completion produces one job");
  learningRow.usageUpdatedAt = now + 1000;
  assert.equal(request("complete"), undefined, "usage-only updates never re-arm learning");
  request("thinking");
  assert.equal(request("complete"), undefined, "the same terminal identity remains deduplicated");
  request("waiting_for_user");
  learningRow.updatedAt = now + 2000;
  const nextLearning = request("complete");
  assert.notEqual(nextLearning.learningId, firstLearning.learningId, "a new turn with identical text gets a new learning id");
  request("executing");
  request("idle");
  learningRow.updatedAt = now + 3000;
  assert.equal(request("complete"), undefined, "idle cancels a pending learning edge");
  request("executing");
  assert.equal(request("error", { AIVATAR_LEARNING_ENABLED: "off" }), undefined);
  request("executing");
  assert.equal(request("error", { AIVATAR_WORKBUDDY_LEARNING_PROVIDER: "none" }), undefined);
  request("executing");
  learningRow.updatedAt = now + 4000;
  const failedLearning = request("error", { AIVATAR_WORKBUDDY_LEARNING_PROVIDER: "codex" });
  assert.equal(failedLearning.provider, "codex");
  assert.equal(failedLearning.summary, "WorkBuddy coding task ended with an error.");
  assert.equal(workbuddyLearningProvider({}), "codebuddy");
  assert.equal(workbuddyLearningProvider({ AIVATAR_LEARNING_PROVIDER: "opencode" }), "codebuddy", "other source overrides must not silently reroute WorkBuddy");
  assert.equal(workbuddyLearningProvider({ AIVATAR_WORKBUDDY_LEARNING_PROVIDER: "", AIVATAR_LEARNING_PROVIDER: "codex" }), "");
  assert.equal(workbuddyLearningProvider({ AIVATAR_WORKBUDDY_LEARNING_PROVIDER: "claude-code", AIVATAR_LEARNING_PROVIDER: "codex" }), "claude-code");
  const otherHomeLearning = takeWorkbuddyLearningRequest(learningRow, { status: "error" },
    { learningArmed: true }, "/synthetic/international:learning-session", {});
  assert.notEqual(otherHomeLearning.learningId, failedLearning.learningId, "same ids in two homes must not collide");
  const nativeParity = takeWorkbuddyLearningRequest({
    ...learningRow, createdAt: 1_699_999_997_000, updatedAt: 1_700_000_000_000,
    lastActivityAt: 1_700_000_000_000,
  }, { status: "complete" }, { learningArmed: true }, "/synthetic/home:learning-session", {});
  assert.equal(nativeParity.learningId, "workbuddy-aee40ca796d199a7", "JS and native discovery share a stable completion identity");

  const observedJobs = [];
  const learningStates = new Map();
  const scanLearning = () => discoverWorkbuddyOnce({
    DatabaseSync, configDirs: [tempDir, internationalHome], states: learningStates,
    now: now + 10_000, post: false, onLearning: (job) => observedJobs.push(job),
    learningEnvironment: {},
  });
  await scanLearning();
  assert.equal(observedJobs.length, 0, "existing completed SQLite inventory must not trigger learning");
  for (const [home, sessionId] of [[tempDir, "working-session"], [internationalHome, "international-session"]]) {
    const updateDb = new DatabaseSync(join(home, "workbuddy.db"));
    updateDb.prepare("UPDATE sessions SET status = 'completed', updated_at = ?, last_activity_at = ? WHERE id = ?")
      .run(now + 1000, now + 1000, sessionId);
    updateDb.close();
  }
  await scanLearning();
  assert.equal(observedJobs.length, 2, "each live home triggers one learning job when its task completes");
  await scanLearning();
  assert.equal(observedJobs.length, 2, "repeated SQLite scans must not duplicate learning");
  const nextDb = new DatabaseSync(join(tempDir, "workbuddy.db"));
  nextDb.prepare("UPDATE sessions SET status = 'running', updated_at = ? WHERE id = 'working-session'").run(now + 2000);
  await scanLearning();
  nextDb.prepare("UPDATE sessions SET status = 'failed', updated_at = ? WHERE id = 'working-session'").run(now + 3000);
  nextDb.close();
  await scanLearning();
  assert.equal(observedJobs.length, 3, "the next observed failed turn also learns");
  assert.equal(observedJobs.at(-1).status, "error");

  console.log("[workbuddy-session-discovery-smoke] ok");
} finally {
  console.log(`[workbuddy-session-discovery-smoke] synthetic fixture retained: ${tempDir}`);
}
