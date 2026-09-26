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

const closeTo = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-8, message);
const wholeScreen = { x: 0, y: 0, width: viewport.width, height: viewport.height };
const area = { x: 200, y: 150, width: 1000, height: 600 };
const areaBefore = JSON.stringify(area);
const areaResults = {
  n: { x: 200, y: 180, width: 1000, height: 570 },
  s: { x: 200, y: 150, width: 1000, height: 630 },
  e: { x: 200, y: 150, width: 1040, height: 600 },
  w: { x: 240, y: 150, width: 960, height: 600 },
  ne: { x: 200, y: 180, width: 1040, height: 570 },
  nw: { x: 240, y: 180, width: 960, height: 570 },
  se: { x: 200, y: 150, width: 1040, height: 630 },
  sw: { x: 240, y: 150, width: 960, height: 630 },
};
const assertArea = (actual, screen = viewport) => {
  assert(actual.width >= Math.min(760, screen.width), "activity width respects the room minimum");
  assert(actual.height >= Math.min(520, screen.height), "activity height respects the room minimum");
  assert(actual.x >= 0 && actual.y >= 0);
  assert(actual.x + actual.width <= screen.width + 1e-8);
  assert(actual.y + actual.height <= screen.height + 1e-8);
};
for (const [handle, expected] of Object.entries(areaResults)) {
  assert.deepEqual(runtime.resizeDesktopActivityArea(area, handle, { x: 40, y: 30 }, viewport), expected,
    `${handle} changes only its selected edges`);
  const shrinkDelta = {
    x: handle.includes("w") ? 1e6 : -1e6,
    y: handle.includes("n") ? 1e6 : -1e6,
  };
  const shrunk = runtime.resizeDesktopActivityArea(area, handle, shrinkDelta, viewport);
  assertArea(shrunk);
  if (handle.includes("w")) {
    assert.equal(shrunk.width, 760);
    assert.equal(shrunk.x + shrunk.width, area.x + area.width, "west resize preserves its opposite edge");
  }
  if (handle.includes("e")) { assert.equal(shrunk.width, 760); assert.equal(shrunk.x, area.x); }
  if (handle.includes("n")) {
    assert.equal(shrunk.height, 520);
    assert.equal(shrunk.y + shrunk.height, area.y + area.height, "north resize preserves its opposite edge");
  }
  if (handle.includes("s")) { assert.equal(shrunk.height, 520); assert.equal(shrunk.y, area.y); }
  const expanded = runtime.resizeDesktopActivityArea(area, handle,
    { x: -shrinkDelta.x, y: -shrinkDelta.y }, viewport);
  assertArea(expanded);
  if (handle.includes("w")) assert.equal(expanded.x, 0);
  if (handle.includes("e")) assert.equal(expanded.x + expanded.width, viewport.width);
  if (handle.includes("n")) assert.equal(expanded.y, 0);
  if (handle.includes("s")) assert.equal(expanded.y + expanded.height, viewport.height);
}
assert.equal(JSON.stringify(area), areaBefore, "area resizing cannot mutate the edit-start snapshot");
assert.deepEqual(runtime.resizeDesktopActivityArea(area, "move", { x: -1e6, y: -1e6 }, viewport),
  { ...area, x: 0, y: 0 });
assert.deepEqual(runtime.resizeDesktopActivityArea(area, "move", { x: 1e6, y: 1e6 }, viewport),
  { ...area, x: 440, y: 300 });
assert.deepEqual(runtime.resizeDesktopActivityArea(area, "se", { x: NaN, y: Infinity }, viewport), area,
  "malformed pointer deltas cannot corrupt the activity area");
assert.deepEqual(runtime.normalizeDesktopActivityArea(undefined, viewport), wholeScreen);
assert.deepEqual(runtime.normalizeDesktopActivityArea({ x: NaN, y: Infinity, width: "invalid", height: null }, viewport),
  wholeScreen);
assert.deepEqual(runtime.normalizeDesktopActivityArea({ x: 1e6, y: -100, width: -1, height: 0 }, viewport),
  { x: 680, y: 0, width: 760, height: 520 });
const smallScreen = { ...viewport, width: 600, height: 400 };
assert.deepEqual(runtime.normalizeDesktopActivityArea(area, smallScreen), { x: 0, y: 0, width: 600, height: 400 });
for (const handle of ["move", ...Object.keys(areaResults)]) {
  assert.deepEqual(runtime.resizeDesktopActivityArea(area, handle, { x: 1e6, y: -1e6 }, smallScreen),
    { x: 0, y: 0, width: 600, height: 400 }, "a screen smaller than the minimum uses its full available area");
}

const { activityArea: ignoredLegacyArea, ...legacyLayout } = saved;
assert.deepEqual(runtime.normalizeDesktopLayout(legacyLayout, viewport).activityArea, wholeScreen,
  "existing v1 layouts keep the whole desktop without a migration");
assert.deepEqual(runtime.createDesktopRuntime(legacyLayout).activityArea, wholeScreen,
  "direct legacy runtime construction also receives bounds");
const boundedLayout = { version: 1, monitorId: viewport.monitorId,
  viewport: { width: viewport.width, height: viewport.height }, activityArea: area,
  avatar: { x: 500, y: 500 }, computer: { x: 800, y: 400 } };
assert.deepEqual(runtime.normalizeDesktopLayout(boundedLayout, viewport), boundedLayout,
  "activity bounds and anchors round-trip at the same resolution");
const largerScreen = { ...viewport, width: 2160, height: 1350, monitorId: "larger" };
const scaledLayout = runtime.normalizeDesktopLayout(boundedLayout, largerScreen);
assert.deepEqual(scaledLayout.activityArea, { x: 300, y: 225, width: 1500, height: 900 });
assert.deepEqual(scaledLayout.avatar, { x: 750, y: 750 });
assert.deepEqual(scaledLayout.computer, { x: 1200, y: 600 });
assert.equal(scaledLayout.monitorId, "larger");
const smallerScreen = { ...viewport, width: 800, height: 600 };
const smallerLayout = runtime.normalizeDesktopLayout(boundedLayout, smallerScreen);
assertArea(smallerLayout.activityArea, smallerScreen);
assert.equal(smallerLayout.activityArea.width, 760);
assert.equal(smallerLayout.activityArea.height, 520);
const malformedAreaLayout = runtime.normalizeDesktopLayout({ ...boundedLayout,
  activityArea: { x: NaN, y: Infinity, width: -1, height: "bad" } }, viewport);
assertArea(malformedAreaLayout.activityArea);

const activeBeforeResize = runtime.createDesktopRuntime(layout);
activeBeforeResize.avatar.actionIntent = "coding";
activeBeforeResize.avatar.targetX = 1e6;
activeBeforeResize.avatar.targetY = -1e6;
activeBeforeResize.avatar.navigationFailure = { behavior: "coding", targetX: 1e6, targetY: -1e6, reason: "blocked" };
const beforeResizeCopy = JSON.stringify(activeBeforeResize);
const minimumArea = { x: 100, y: 100, width: 760, height: 520 };
let boundedState = runtime.applyDesktopActivityArea(activeBeforeResize, minimumArea, viewport, 40000);
assert.equal(JSON.stringify(activeBeforeResize), beforeResizeCopy, "area preview leaves the cancel snapshot intact");
assert.deepEqual(boundedState.activityArea, minimumArea);
assert.equal(boundedState.avatar.behavior, "idle");
assert.equal(boundedState.avatar.actionIntent, undefined);
assert.equal(boundedState.avatar.navigationFailure, undefined);
assert.equal(boundedState.avatar.targetX, boundedState.avatar.x);
assert.equal(boundedState.avatar.targetY, boundedState.avatar.y);
const boundedSaved = runtime.desktopLayoutFromRuntime(boundedState, viewport);
assert.deepEqual(runtime.normalizeDesktopLayout(JSON.parse(JSON.stringify(boundedSaved)), viewport), boundedSaved,
  "activity bounds persist together with both adjusted anchors in the existing v1 layout");
boundedSaved.activityArea.x = 999;
assert.equal(boundedState.activityArea.x, 100, "saved layouts cannot mutate live bounds");
const assertObjectInsideArea = (state, target) => {
  const bounds = runtime.desktopObjectBounds(state, target);
  const permitted = state.activityArea;
  assert(bounds.x >= permitted.x - 1e-8 && bounds.y >= permitted.y - 1e-8);
  assert(bounds.x + bounds.width <= permitted.x + permitted.width + 1e-8);
  assert(bounds.y + bounds.height <= permitted.y + permitted.height + 1e-8);
};
for (const point of [{ x: -1e6, y: -1e6 }, { x: 1e6, y: 1e6 }, { x: -1e6, y: 1e6 }, { x: 1e6, y: -1e6 }]) {
  for (const target of ["computer", "avatar"]) {
    boundedState = runtime.moveDesktopObject(boundedState, target, point, viewport, 45000);
    assertObjectInsideArea(boundedState, target);
  }
  const work = runtime.desktopWorkPoint(boundedState.computer, viewport, boundedState.activityArea);
  closeTo(work.x, boundedState.computer.x, "edge work target stays centered on the computer");
  closeTo(work.y - boundedState.computer.y, 40 * runtime.DESKTOP_PIXEL_SCALE,
    "computer bottom clearance reserves the full work offset");
  for (let frame = 0; frame < 1000; frame += 1) {
    boundedState = runtime.tickDesktopRuntime(boundedState, "coding", viewport, 1 / 30, 50000 + frame * 1000 / 30);
    assertObjectInsideArea(boundedState, "avatar");
  }
  assert.equal(boundedState.avatar.behavior, "coding");
  closeTo(boundedState.avatar.x, work.x);
  closeTo(boundedState.avatar.y, work.y);
}
for (let frame = 0; frame < 1200; frame += 1) {
  boundedState = runtime.tickDesktopRuntime(boundedState, null, viewport, 1 / 30, 100000 + frame * 1000 / 30,
    () => frame % 2);
  assertObjectInsideArea(boundedState, "avatar");
  assertObjectInsideArea(boundedState, "computer");
}
console.log("Desktop activity area smoke passed: eight resize handles, moving, size limits, screen edges, v1 compatibility, monitor scaling, cancellation snapshots, persisted bounds, dragging and bounded task/wander paths.");

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
