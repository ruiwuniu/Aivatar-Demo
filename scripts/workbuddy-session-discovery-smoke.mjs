#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import {
  buildWorkbuddyStatusPayload,
  discoverWorkbuddyOnce,
  normalizeWorkbuddyTaskStatus,
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

  console.log("[workbuddy-session-discovery-smoke] ok");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
