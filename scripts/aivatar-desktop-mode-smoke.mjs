import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/desktop/desktopRuntime.ts", import.meta.url), "utf8");
const geometrySource = readFileSync(new URL("../src/desktop/desktopVendingMachine.ts", import.meta.url), "utf8");
const geometryOutput = ts.transpileModule(geometrySource, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
}).outputText;
const geometryUrl = `data:text/javascript;base64,${Buffer.from(geometryOutput).toString("base64")}`;
const vendingGeometry = await import(geometryUrl);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
});
const linkedOutput = outputText.replaceAll('"./desktopVendingMachine"', JSON.stringify(geometryUrl));
const runtime = await import(`data:text/javascript;base64,${Buffer.from(linkedOutput).toString("base64")}`);
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

const vendingScale = runtime.DESKTOP_PIXEL_SCALE;
assert.deepEqual(vendingGeometry.DESKTOP_VENDING_SPRITE.source, { x: 142, y: 65, width: 740, height: 1404 });
assert.deepEqual(vendingGeometry.desktopVendingVisualBounds({ x: 500, y: 400 }),
  { x: 500 - 30 * vendingScale, y: 400 - 114 * vendingScale, width: 60 * vendingScale, height: 114 * vendingScale });
const vendingBase = runtime.createDesktopRuntime({ ...boundedLayout, computer: { x: 800, y: 450 }, avatar: { x: 500, y: 580 } });
const placement = runtime.placeDesktopVendingMachine(vendingBase, viewport, 0, { x: 800, y: 450 });
assert(placement.ok, "an occupied preferred position moves to the nearest legal furniture position");
let vendingState = placement.runtime;
assert(runtime.isDesktopFurniturePlacementValid(vendingState, "vendingMachine", vendingState.vendingMachine, viewport));
assert(vendingGeometry.desktopFurniturePairFits(vendingState.computer, vendingState.vendingMachine));
assert.equal(runtime.placeDesktopVendingMachine(vendingState, viewport, 0).ok, false, "only one vending machine may be configured");
assertObjectInsideArea(vendingState, "vendingMachine");
const pickup = vendingGeometry.desktopVendingInteractionPoint(vendingState.vendingMachine);
closeTo(pickup.x, vendingState.vendingMachine.x - 6.1 * vendingScale);
closeTo(pickup.y, vendingState.vendingMachine.y + 28 * vendingScale);
assert.equal(runtime.desktopAvatarPointBlocked(vendingState, pickup), false, "pickup stays in front of the body");
const machineBeforeDrag = { ...vendingState.vendingMachine };
const computerBeforeDrag = { ...vendingState.computer };
vendingState = runtime.moveDesktopObject(vendingState, "vendingMachine", vendingState.computer, viewport, 0);
assert.deepEqual(vendingState.vendingMachine, machineBeforeDrag, "machine cannot be dragged onto the terminal");
vendingState = runtime.moveDesktopObject(vendingState, "computer", vendingState.vendingMachine, viewport, 0);
assert.deepEqual(vendingState.computer, computerBeforeDrag, "terminal cannot be dragged onto the machine");
const frontConflictComputer = { x: 700, y: 500 };
const frontConflictVending = { x: 700, y: 440 };
assert.equal(vendingGeometry.desktopRectsOverlap(vendingGeometry.desktopTerminalVisualBounds(frontConflictComputer),
  vendingGeometry.desktopVendingVisualBounds(frontConflictVending)), false, "fixture has separated device bodies");
assert.equal(vendingGeometry.desktopFurniturePairFits(frontConflictComputer, frontConflictVending), false,
  "a terminal cannot occupy the vending interaction reserve even without visible body overlap");

const machineLayout = runtime.desktopLayoutFromRuntime(vendingState, viewport);
assert.deepEqual(runtime.normalizeDesktopLayout(machineLayout, viewport), machineLayout, "machine anchors round-trip exactly");
assert(!("vendingInteraction" in machineLayout), "orders and phases never enter the persisted layout");
const doubledMachine = runtime.normalizeDesktopLayout(machineLayout, { ...viewport, width: 2880, height: 1800 });
closeTo(doubledMachine.vendingMachine.x, machineLayout.vendingMachine.x * 2);
closeTo(doubledMachine.vendingMachine.y, machineLayout.vendingMachine.y * 2);
const tinyScreen = { ...viewport, width: 100, height: 100 };
const parkedLayout = runtime.normalizeDesktopLayout(machineLayout, tinyScreen);
assert.equal(parkedLayout.vendingMachine, null, "an impossible forced monitor resize parks the machine");
assert(parkedLayout.vendingMachineParked, "parking retains its placement for a larger screen");
const parkedState = runtime.createDesktopRuntime(parkedLayout);
assert.equal(runtime.placeDesktopVendingMachine(parkedState, tinyScreen, 0).ok, false, "parking does not allow duplicate placement");
const restoredMachine = runtime.normalizeDesktopLayout(runtime.desktopLayoutFromRuntime(parkedState, tinyScreen), viewport);
assert(restoredMachine.vendingMachine && !restoredMachine.vendingMachineParked, "larger monitor restores the parked configuration");
const removedParked = runtime.removeDesktopVendingMachine(parkedState, 0);
assert.equal(removedParked.vendingMachine, null);
assert.equal(removedParked.vendingMachineParked, null);
assert.equal(runtime.canApplyDesktopActivityArea(vendingState, wholeScreen, tinyScreen), false);
assert.equal(runtime.applyDesktopActivityArea(vendingState, wholeScreen, tinyScreen, 0), vendingState,
  "manual activity changes refuse impossible packing and preserve the edit snapshot");
for (const preferred of [{ x: -1e6, y: -1e6 }, { x: 1e6, y: 1e6 }, { x: 1e6, y: -1e6 }, { x: -1e6, y: 1e6 }]) {
  const moved = runtime.moveDesktopObject(vendingState, "vendingMachine", preferred, viewport, 0);
  assert(runtime.isDesktopFurniturePlacementValid(moved, "vendingMachine", moved.vendingMachine, viewport));
  const resizedMachine = runtime.applyDesktopActivityArea(moved, minimumArea, viewport, 0);
  assert.deepEqual(resizedMachine.activityArea, minimumArea);
  assert(runtime.isDesktopFurniturePlacementValid(resizedMachine, "vendingMachine", resizedMachine.vendingMachine, viewport));
}

assert.deepEqual(vendingGeometry.DESKTOP_VENDING_SKIN_IDS, ["original", "red", "dark-green"]);
assert.equal(vendingGeometry.getDesktopVendingSprite("original"), vendingGeometry.DESKTOP_VENDING_SPRITE,
  "the original asset remains the default public sprite");
assert.deepEqual(vendingGeometry.getDesktopVendingSprite("red").source, { x: 142, y: 63, width: 740, height: 1407 });
assert.deepEqual(vendingGeometry.getDesktopVendingSprite("dark-green").source, { x: 142, y: 65, width: 740, height: 1406 });
assert.equal(vendingBase.vendingMachineSkinId, "original", "old v1 layouts need no skin migration");
assert(!("vendingMachineSkinId" in machineLayout), "original skin omits the optional field for unchanged v1 round-trips");
for (const invalidSkin of [undefined, null, "", "unknown", "RED", "__proto__", "constructor", 1, false, [], {}, Object.create(null)]) {
  assert.equal(vendingGeometry.normalizeDesktopVendingSkinId(invalidSkin), "original");
  assert.equal(vendingGeometry.getDesktopVendingSprite(invalidSkin), vendingGeometry.DESKTOP_VENDING_SPRITE,
    "untrusted skin values cannot index inherited registry properties");
  const normalized = runtime.normalizeDesktopLayout({ ...machineLayout, vendingMachineSkinId: invalidSkin }, viewport);
  assert(!("vendingMachineSkinId" in normalized));
  assert.equal(runtime.createDesktopRuntime(normalized).vendingMachineSkinId, "original");
}
assert.equal(runtime.createDesktopRuntime({ ...machineLayout, version: 2, vendingMachineSkinId: "red" }).vendingMachineSkinId,
  "original", "unrecognized layout versions cannot introduce an unvalidated skin");
const assertSavedSkin = (layout, skinId) => {
  assert.equal(layout.vendingMachineSkinId ?? "original", skinId);
  if (skinId === "original") assert(!("vendingMachineSkinId" in layout));
};
for (const skinId of vendingGeometry.DESKTOP_VENDING_SKIN_IDS) {
  const sprite = vendingGeometry.getDesktopVendingSprite(skinId);
  assert.equal(sprite.width, 60);
  assert.equal(sprite.height, 114, "every skin shares collision and interaction geometry");
  assert(readFileSync(new URL(`../public${sprite.src}`, import.meta.url)).length > 8, "registered skin assets exist");
  const changed = runtime.setDesktopVendingSkin(vendingState, skinId);
  assert.equal(runtime.setDesktopVendingSkin(changed, skinId), changed, "selecting the same skin is a no-op");
  assert.deepEqual(changed, { ...vendingState, vendingMachineSkinId: skinId }, "skin setter changes no placement, timers or movement");
  const skinLayout = runtime.desktopLayoutFromRuntime(changed, viewport);
  assertSavedSkin(skinLayout, skinId);
  assert.deepEqual(runtime.normalizeDesktopLayout(JSON.parse(JSON.stringify(skinLayout)), viewport), skinLayout,
    "each selected skin survives serialized layout round-trip");
  const packed = runtime.removeDesktopVendingMachine(changed, 0);
  assert.equal(packed.vendingMachine, null);
  assert.equal(packed.vendingMachineParked, null);
  assert.equal(packed.vendingMachineSkinId, skinId);
  const packedLayout = runtime.desktopLayoutFromRuntime(packed, viewport);
  assertSavedSkin(packedLayout, skinId);
  const reentered = runtime.createDesktopRuntime(runtime.normalizeDesktopLayout(JSON.parse(JSON.stringify(packedLayout)), viewport));
  assert.equal(reentered.vendingMachine, null);
  const replaced = runtime.placeDesktopVendingMachine(reentered, viewport, 0);
  assert(replaced.ok);
  assert.equal(replaced.runtime.vendingMachineSkinId, skinId, "packing, leaving, returning and placing preserve color");
  const skinParked = runtime.normalizeDesktopLayout(skinLayout, tinyScreen);
  assert.equal(skinParked.vendingMachine, null);
  assert(skinParked.vendingMachineParked);
  assertSavedSkin(skinParked, skinId);
  const parkedRoundTrip = runtime.desktopLayoutFromRuntime(runtime.createDesktopRuntime(skinParked), tinyScreen);
  assertSavedSkin(parkedRoundTrip, skinId);
  const restored = runtime.createDesktopRuntime(runtime.normalizeDesktopLayout(parkedRoundTrip, viewport));
  assert(restored.vendingMachine && !restored.vendingMachineParked);
  assert.equal(restored.vendingMachineSkinId, skinId, "restoring a larger monitor restores the selected color");
  const resizedColor = runtime.createDesktopRuntime(runtime.normalizeDesktopLayout(skinLayout, largerScreen));
  assert.equal(resizedColor.vendingMachineSkinId, skinId);
  const editSnapshot = JSON.stringify(changed);
  const acceptedArea = runtime.applyDesktopActivityArea(changed, minimumArea, viewport, 0);
  assert.equal(acceptedArea.vendingMachineSkinId, skinId);
  assert.equal(JSON.stringify(changed), editSnapshot, "activity preview preserves the committed color snapshot");
  assert.equal(runtime.applyDesktopActivityArea(changed, wholeScreen, tinyScreen, 0), changed,
    "rejected activity edit preserves the color and original runtime");
  assert.equal(runtime.moveDesktopObject(changed, "vendingMachine", { x: 500, y: 550 }, viewport, 0).vendingMachineSkinId, skinId);
}
console.log("Desktop vending skin smoke passed: original/red/dark-green registry, malformed defaults, v1 compatibility, pack/reentry/re-place, monitor parking and activity changes.");

const reachPress = (productId = "cookie", requestId = `order-${productId}`) => {
  let current = runtime.beginDesktopVendingInteraction(vendingState, productId, requestId, viewport, 0);
  assert.equal(current.vendingInteraction.phase, "approach");
  assert.equal(runtime.takeDesktopVendingPurchaseRequest(current).request, null, "walking cannot charge an order");
  for (let frame = 1; frame <= 900 && current.vendingInteraction.phase === "approach"; frame += 1) {
    current = runtime.tickDesktopRuntime(current, null, viewport, 1 / 30, frame * 1000 / 30);
    assert.equal(runtime.desktopAvatarPointBlocked(current, current.avatar), false, "vending approach routes around bodies");
  }
  assert.equal(current.vendingInteraction.phase, "press", "avatar reaches the front pickup point");
  closeTo(current.avatar.x, pickup.x);
  closeTo(current.avatar.y, pickup.y);
  assert.equal(current.avatar.facing, "back");
  return current;
};
const reachAwaiting = (productId = "cookie", requestId = `order-${productId}`) => {
  let current = reachPress(productId, requestId);
  const pressedAt = current.vendingInteraction.phaseStartedAt;
  current = runtime.tickDesktopRuntime(current, null, viewport, 0, pressedAt + 449);
  assert.equal(current.vendingInteraction.phase, "press");
  current = runtime.tickDesktopRuntime(current, null, viewport, 0, pressedAt + 450);
  assert.equal(current.vendingInteraction.phase, "awaitingPurchase");
  return current;
};
for (const productId of ["cookie", "cola", "coffee"]) {
  const requestId = `order-${productId}`;
  let current = reachAwaiting(productId, requestId);
  const now = current.vendingInteraction.phaseStartedAt;
  assert.equal(runtime.settleDesktopVendingPurchase(current, requestId, true, now), current, "no receipt before request delivery");
  const taken = runtime.takeDesktopVendingPurchaseRequest(current);
  current = taken.runtime;
  assert.deepEqual(taken.request, { requestId, productId });
  assert.equal(runtime.takeDesktopVendingPurchaseRequest(current).request, null, "each request is delivered exactly once");
  assert.equal(runtime.settleDesktopVendingPurchase(current, "stale-order", true, now), current, "stale receipt is ignored");
  current = runtime.settleDesktopVendingPurchase(current, requestId, true, now);
  assert.equal(current.vendingInteraction.phase, "dispense");
  assert.equal(runtime.settleDesktopVendingPurchase(current, requestId, true, now + 10), current, "duplicate receipt cannot restart dispensing");
  current = runtime.tickDesktopRuntime(current, null, viewport, 0, now + 999);
  assert.equal(current.vendingInteraction.phase, "dispense", "full dispense sound completes before pickup");
  current = runtime.tickDesktopRuntime(current, null, viewport, 0, now + 1000);
  assert.equal(current.vendingInteraction.phase, "consume");
  assert.equal(current.avatar.behavior, productId, "consumption uses the existing food animation");
  assert.equal(current.avatar.facing, "front");
  assert.equal(current.avatar.behaviorTimer, 4);
  current = runtime.tickDesktopRuntime(current, null, viewport, 0, now + 4999);
  assert.equal(current.vendingInteraction.phase, "consume");
  current = runtime.tickDesktopRuntime(current, null, viewport, 0, now + 5000);
  assert.equal(current.vendingInteraction, null);
  assert.equal(current.avatar.behavior, "idle");
  assert.equal(runtime.takeDesktopVendingPurchaseRequest(current).request, null);
}
const unpaid = runtime.takeDesktopVendingPurchaseRequest(reachAwaiting("coffee", "rejected")).runtime;
const rejected = runtime.settleDesktopVendingPurchase(unpaid, "rejected", false, 50000);
assert.equal(rejected.vendingInteraction, null, "failed purchase ends without dispensing");
const phases = [
  runtime.beginDesktopVendingInteraction(vendingState, "cookie", "phase-order", viewport, 0),
  reachPress("cookie", "phase-order"),
  runtime.takeDesktopVendingPurchaseRequest(reachAwaiting("cookie", "phase-order")).runtime,
];
phases.push(runtime.settleDesktopVendingPurchase(phases[2], "phase-order", true, 20000));
phases.push(runtime.tickDesktopRuntime(phases[3], null, viewport, 0, 21000));
for (const phaseState of phases) {
  for (const skinId of vendingGeometry.DESKTOP_VENDING_SKIN_IDS) {
    const changed = runtime.setDesktopVendingSkin(phaseState, skinId);
    assert.equal(changed.vendingInteraction, phaseState.vendingInteraction,
      `changing color leaves ${phaseState.vendingInteraction.phase} and its order untouched`);
    assert.deepEqual(changed, { ...phaseState, vendingMachineSkinId: skinId },
      "appearance does not settle purchases, restart phases or alter task behavior");
  }
  for (const task of ["thinking", "coding", "waiting", "error", "success"]) {
    const preempted = runtime.tickDesktopRuntime(phaseState, task, viewport, 1 / 30, 25000);
    assert.equal(preempted.vendingInteraction, null, `${task} preempts ${phaseState.vendingInteraction.phase}`);
    assert.equal(runtime.settleDesktopVendingPurchase(preempted, "phase-order", true, 25001), preempted,
      "a late receipt cannot resurrect a preempted interaction");
  }
  for (const target of ["avatar", "computer", "vendingMachine"]) {
    const moved = runtime.moveDesktopObject(phaseState, target, { x: 500, y: 500 }, viewport, 25000);
    assert.equal(moved.vendingInteraction, null, `${target} drag cancels ${phaseState.vendingInteraction.phase}`);
  }
  assert.equal(runtime.moveDesktopObject(phaseState, "computer", phaseState.vendingMachine, viewport, 25000).vendingInteraction,
    null, "even a rejected collision drag cancels pending purchase");
  assert.equal(runtime.removeDesktopVendingMachine(phaseState, 25000).vendingInteraction, null);
  assert.equal(runtime.applyDesktopActivityArea(phaseState, minimumArea, viewport, 25000).vendingInteraction, null);
}

const obstacleLayout = { ...boundedLayout, computer: { x: 1000, y: 390 }, vendingMachine: { x: 700, y: 520 },
  avatar: { x: 430, y: 450 } };
const obstacleState = runtime.createDesktopRuntime(obstacleLayout);
const destination = { x: 920, y: 450 };
const route = runtime.findDesktopPath(obstacleState, destination, viewport);
assert(route.length > 1, "cross-machine movement needs a detour");
assert.deepEqual(route.at(-1), destination);
let navigating = { ...obstacleState, avatar: { ...obstacleState.avatar, targetX: destination.x, targetY: destination.y }, nextDecisionAt: 1e9 };
for (let frame = 0; frame < 900; frame += 1) {
  navigating = runtime.tickDesktopRuntime(navigating, null, viewport, 1 / 30, frame * 1000 / 30);
  assert.equal(runtime.desktopAvatarPointBlocked(navigating, navigating.avatar), false, "walking never crosses an expanded device body");
}
closeTo(navigating.avatar.x, destination.x);
closeTo(navigating.avatar.y, destination.y);
let trapped = runtime.moveDesktopObject(obstacleState, "avatar", { x: 700, y: 450 }, viewport, 0);
assert.equal(runtime.desktopAvatarPointBlocked(trapped, trapped.avatar), true, "fixture manually drops the avatar inside the machine");
let escaped = false;
for (let frame = 0; frame < 900; frame += 1) {
  trapped = runtime.tickDesktopRuntime(trapped, "coding", viewport, 1 / 30, 4001 + frame * 1000 / 30);
  const blocked = runtime.desktopAvatarPointBlocked(trapped, trapped.avatar);
  if (escaped) assert.equal(blocked, false, "after escaping a manual drop the avatar never reenters a body");
  if (!blocked) escaped = true;
}
assert(escaped, "manual drop inside furniture can escape");
assert.equal(trapped.avatar.behavior, "coding");
assert.deepEqual({ x: trapped.avatar.x, y: trapped.avatar.y }, runtime.desktopWorkPoint(trapped.computer, viewport, trapped.activityArea));
console.log("Desktop vending smoke passed: geometry, two-way collision, front reserves, persistence/parking, placement/area resizing, all products, single request settlement, phase timing, interruption and obstacle escape.");

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
