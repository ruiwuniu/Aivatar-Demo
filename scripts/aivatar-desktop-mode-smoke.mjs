import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/desktop/desktopRuntime.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
});
const runtime = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const viewport = { width: 1440, height: 900, scaleFactor: 2, monitorId: "test-monitor" };
const layout = runtime.normalizeDesktopLayout(null, viewport);
let state = runtime.createDesktopRuntime(layout);
const start = { ...state.avatar };

for (let frame = 0; frame < 900; frame += 1) {
  state = runtime.tickDesktopRuntime(state, "coding", viewport, 1 / 60, frame * 1000 / 60);
  if (frame === 0) {
    assert.equal(state.avatar.behavior, "wander", "task begins by walking to the computer");
    assert.equal(state.avatar.actionIntent, "coding", "typing is arrival-gated");
    assert(Math.hypot(state.avatar.x - start.x, state.avatar.y - start.y) <= 80 / 60 + 0.001);
  }
}
assert.equal(state.avatar.behavior, "coding");
assert.equal(state.avatar.facing, "back");
assert.deepEqual({ x: state.avatar.x, y: state.avatar.y }, runtime.desktopWorkPoint(state.computer, viewport));
assert.equal(state.avatar.actionIntent, undefined);

const saved = runtime.desktopLayoutFromRuntime(state, viewport);
assert.deepEqual(runtime.normalizeDesktopLayout(saved, viewport), saved, "same screen restores exact anchors");
assert(!("wallet" in saved) && !("memory" in saved), "layout is independent of gameplay state");

state = runtime.moveDesktopObject(state, "avatar", { x: 300, y: 500 }, viewport, 20000);
const draggedAvatar = { ...state.avatar };
state = runtime.tickDesktopRuntime(state, "coding", viewport, 0.1, 23000);
assert.deepEqual(state.avatar, draggedAvatar, "user placement takes priority for the drag grace period");
assert.equal(state.avatar.behavior, "idle");
state = runtime.tickDesktopRuntime(state, "coding", viewport, 0.1, 24001);
assert.equal(state.avatar.behavior, "wander", "active task resumes after drag grace period");

const avatarBeforeComputerDrag = { x: state.avatar.x, y: state.avatar.y };
state = runtime.moveDesktopObject(state, "computer", { x: 400, y: 600 }, viewport, 25000);
assert.deepEqual({ x: state.avatar.x, y: state.avatar.y }, avatarBeforeComputerDrag, "computer drag cannot teleport avatar");
state = runtime.tickDesktopRuntime(state, "thinking", viewport, 0.1, 29001);
assert.deepEqual({ x: state.avatar.targetX, y: state.avatar.targetY }, runtime.desktopWorkPoint(state.computer, viewport));

state = runtime.tickDesktopRuntime(state, "success", viewport, 0.1, 30000);
assert.equal(state.avatar.behavior, "success");
const completedPoint = { x: state.avatar.x, y: state.avatar.y };
state = runtime.tickDesktopRuntime(state, null, viewport, 0.1, 33000, () => 1);
assert.equal(state.avatar.behavior, "idle");
assert.deepEqual({ x: state.avatar.x, y: state.avatar.y }, completedPoint, "completion ends with a short idle pause");
state = runtime.tickDesktopRuntime(state, null, viewport, 0.1, 36000, () => 1);
assert.equal(state.avatar.behavior, "wander", "wandering resumes after task completion");

const resized = runtime.normalizeDesktopLayout(saved, { ...viewport, width: 800, height: 600, monitorId: "replacement" });
assert.equal(resized.monitorId, "replacement");
for (const target of ["avatar", "computer"]) {
  assert(resized[target].x >= 0 && resized[target].x <= 800);
  assert(resized[target].y >= 0 && resized[target].y <= 600);
}
const malformed = runtime.normalizeDesktopLayout({ version: 1, viewport: { width: 0, height: -1 },
  avatar: { x: NaN, y: Infinity }, computer: { x: -1000, y: 1e9 } }, viewport);
assert(Number.isFinite(malformed.avatar.x) && Number.isFinite(malformed.avatar.y));
assert(malformed.computer.x >= 0 && malformed.computer.y < viewport.height);

const overlap = runtime.createDesktopRuntime({ ...layout, avatar: { x: 500, y: 500 }, computer: { x: 500, y: 500 } });
assert.equal(runtime.desktopObjectAtPoint(overlap, { x: 500, y: 480 }), "avatar", "avatar wins overlap hit testing");
assert.equal(runtime.desktopObjectAtPoint(overlap, { x: 20, y: 20 }), null, "empty desktop stays outside hit regions");
const tiny = runtime.normalizeDesktopLayout(null, { ...viewport, width: 120, height: 100 });
assert(tiny.avatar.x >= 0 && tiny.avatar.x <= 120 && tiny.avatar.y >= 0 && tiny.avatar.y <= 100);
console.log("Desktop mode smoke passed: arrival-gated work, drag priority, independent placement, task completion, wandering, saved positions, screen changes and hit order.");

const animationSource = readFileSync(new URL("../src/desktop/desktopAnimation.ts", import.meta.url), "utf8");
const animationOutput = ts.transpileModule(animationSource, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { startDesktopAnimation } = await import(`data:text/javascript;base64,${Buffer.from(animationOutput).toString("base64")}`);
let fakeNow = 0;
let nextId = 0;
const frames = new Map();
const timers = new Map();
const seen = [];
const errors = [];
const clock = {
  now: () => fakeNow,
  requestFrame: (callback) => { const id = ++nextId; frames.set(id, callback); return id; },
  cancelFrame: (id) => frames.delete(id),
  setTimer: (callback) => { const id = ++nextId; timers.set(id, callback); return id; },
  clearTimer: (id) => timers.delete(id),
};
const timerAt = (now) => { fakeNow = now; for (const callback of timers.values()) callback(); };
const frameAt = (now) => {
  fakeNow = now;
  const [id, callback] = frames.entries().next().value;
  frames.delete(id);
  callback(now);
};
const stopAnimation = startDesktopAnimation(clock, (now, elapsed, initial) => seen.push({ now, elapsed, initial }),
  (error) => errors.push(error));
assert.deepEqual(seen, [{ now: 0, elapsed: 0, initial: true }], "first desktop paint cannot depend on rAF");
timerAt(50);
assert.equal(seen.length, 1, "fallback stays quiet while rAF can still arrive normally");
timerAt(100);
timerAt(133);
assert.equal(seen.length, 3, "occluded WebView still advances and renders through timer fallback");
frameAt(133);
assert.equal(seen.at(-1).elapsed, 0, "resumed rAF never advances time already consumed by the fallback");
frameAt(166);
timerAt(166);
assert.equal(seen.length, 5, "live rAF suppresses fallback frames");
assert(Math.abs(seen.reduce((total, step) => total + step.elapsed, 0) - 0.166) < 1e-8);
stopAnimation();
assert.equal(frames.size, 0);
assert.equal(timers.size, 0);
assert.equal(errors.length, 0);
const expectedError = new Error("test renderer failure");
const stopFailing = startDesktopAnimation(clock, () => { throw expectedError; }, (error) => errors.push(error));
assert.equal(errors[0], expectedError, "renderer exceptions reach the visible recovery path");
stopFailing();
console.log("Desktop scheduler smoke passed: synchronous first paint, no-rAF fallback, shared clock, cleanup and renderer error reporting.");
