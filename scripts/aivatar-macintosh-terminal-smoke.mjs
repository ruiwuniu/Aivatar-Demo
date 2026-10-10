import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/game/macintoshTerminal.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
}).outputText;
const skin = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const geometry = skin.MACINTOSH_TERMINAL_GEOMETRY;
const inside = (inner, outer, extraBottom = 0) => {
  assert(inner.x >= outer.x && inner.y >= outer.y);
  assert(inner.x + inner.width <= outer.x + outer.width + 1e-8);
  assert(inner.y + inner.height + extraBottom <= outer.y + outer.height + 1e-8);
};
assert.deepEqual(geometry.bounds, { x: -21, y: -35, width: 42, height: 50 });
assert.deepEqual(geometry.source, { x: 117, y: 103, width: 927, height: 1188 });
inside(geometry.image, geometry.bounds);
assert.equal(geometry.image.y + geometry.image.height, 15, "keyboard baseline stays on the original terminal footprint");
assert(Math.abs(geometry.image.width / geometry.image.height - 927 / 1188) < 1e-12, "sample aspect ratio is preserved");
inside(geometry.screen, geometry.image);
inside(geometry.indicator, geometry.image);
for (const key of geometry.keys) inside(key, geometry.image, 0.6);
assert(geometry.keys.every((key) => key.y > 3), "all calibrated key caps lie on the front keyboard");
assert.equal(skin.macintoshTerminalAnimationState(0, "executing", true).pressedKeyIndex, 2);
assert.notEqual(skin.macintoshTerminalAnimationState(4, "executing", true).pressedKeyIndex, 2);
assert.equal(skin.macintoshTerminalAnimationState(16, "idle").cursorVisible, false);
assert.equal(skin.macintoshTerminalAnimationState(32, "idle").cursorVisible, true);
assert.equal(skin.macintoshTerminalAnimationState(23, "waiting_for_user").cursorVisible, true);
assert.equal(skin.macintoshTerminalAnimationState(24, "waiting_for_user").cursorVisible, false);
const phases = ["idle", "thinking", "executing", "waiting_for_user", "complete", "error"];
for (const phase of phases) {
  const distant = skin.macintoshTerminalAnimationState(0, phase, false);
  assert.equal(distant.phase, phase, "screen maps task status even while avatar is away");
  assert.equal(distant.pressedKeyIndex, null, "arrival gates physical key presses");
  if (!["thinking", "executing"].includes(phase)) {
    assert.equal(skin.macintoshTerminalAnimationState(0, phase, true).pressedKeyIndex, null,
      "waiting, terminal and idle states never type");
  }
  for (const ghost of ["valid", "invalid"]) {
    assert.deepEqual(skin.macintoshTerminalAnimationState(0, phase, true, ghost),
      skin.macintoshTerminalAnimationState(99999, phase, true, ghost), "placement ghosts are completely static");
  }
}
for (const badFrame of [-1, NaN, Infinity]) {
  assert.deepEqual(skin.macintoshTerminalAnimationState(badFrame, "executing", true),
    skin.macintoshTerminalAnimationState(0, "executing", true), "invalid clocks normalize to a deterministic first frame");
}

const capture = (phase, active, frame = 0, ghost = "none", image = {}, skinId = skin.MACINTOSH_TERMINAL_SKIN_ID) => {
  const calls = [];
  let clipped = false;
  let fillStyle;
  let saved = [];
  let alpha = 1;
  const context = {
    save: () => { saved.push({ clipped, fillStyle, alpha }); calls.push(["save"]); },
    restore: () => { ({ clipped, fillStyle, alpha } = saved.pop()); calls.push(["restore"]); },
    translate: (...args) => calls.push(["translate", ...args]),
    drawImage: (...args) => calls.push(["image", ...args]),
    beginPath: () => calls.push(["beginPath"]),
    moveTo: (...args) => calls.push(["path", ...args]),
    lineTo: (...args) => calls.push(["path", ...args]),
    closePath: () => calls.push(["closePath"]),
    clip: () => { clipped = true; calls.push(["clip"]); },
    createLinearGradient: (...args) => {
      calls.push(["gradient", ...args]);
      return { addColorStop: (...stop) => calls.push(["color-stop", ...stop]) };
    },
    fillRect: (...args) => calls.push(["fill", clipped, typeof fillStyle === "string" ? fillStyle : "gradient", ...args]),
    strokeRect: (...args) => calls.push(["outline", ...args]),
    set fillStyle(value) { fillStyle = value; },
    get fillStyle() { return fillStyle; },
    set globalAlpha(value) { alpha = value; },
    get globalAlpha() { return alpha; },
  };
  skin.drawMacintoshTerminal(context, { x: 100.3, y: 200.2, frame, phase, active, ghost, image, skinId });
  assert.equal(saved.length, 0, "renderer balances canvas save/restore");
  assert.equal(alpha, 1, "ghost opacity cannot leak to other sprites");
  const imageCall = calls.find((call) => call[0] === "image");
  if (image) assert.deepEqual(imageCall.slice(2), [117, 103, 927, 1188,
    geometry.image.x, geometry.image.y, geometry.image.width, geometry.image.height]);
  assert(calls.some((call) => call[0] === "clip"), "screen is always clipped inside the CRT");
  for (const call of calls.filter((call) => call[0] === "path")) {
    inside({ x: call[1], y: call[2], width: 0, height: 0 }, geometry.screen);
  }
  for (const call of calls.filter((call) => call[0] === "fill" && ["#273126", "#172018", "#16331b"].includes(call[2]))) {
    assert.equal(call[1], true, "all status glyphs and cursors render under the CRT clip");
    inside({ x: call[3], y: call[4], width: call[5], height: call[6] }, geometry.screen);
  }
  return calls;
};
const idle = capture("idle", false);
for (const phase of phases.slice(1)) assert.notDeepEqual(capture(phase, false), idle, `${phase} has its own visible monochrome feedback`);
assert.notDeepEqual(capture("executing", false), capture("executing", true), "typing adds the calibrated pressed key");
for (const phase of phases) {
  assert.deepEqual(capture(phase, true, 0, "valid"), capture(phase, true, 400, "valid"), "ghost drawing has no time-dependent operations");
}
capture("executing", true, 0, "none", null);
const geometryCalls = (calls) => calls.filter((call) => call[0] !== "color-stop")
  .map((call) => call[0] === "fill" ? [call[0], call[1], "palette", ...call.slice(3)] : call);
const variants = [
  { id: skin.MACINTOSH_FOREST_ORANGE_SKIN_ID, phosphor: "#ff991f", shell: "#205b49" },
  { id: skin.MACINTOSH_ORANGE_GREEN_SKIN_ID, phosphor: "#46c844", shell: "#e87521" },
];
for (const variant of variants) {
for (const phase of phases) for (const active of [true, false]) for (const ghost of ["none", "valid", "invalid"]) {
  for (const frame of [0, 4, 16, 24, 48, 777]) {
    const original = capture(phase, active, frame, ghost);
    const colored = capture(phase, active, frame, ghost, {}, variant.id);
    assert.deepEqual(geometryCalls(colored), geometryCalls(original), "All skins keep identical animation timing and pixel geometry");
    assert(colored.some((call) => call[0] === "color-stop" && call[2] === variant.phosphor), "The animated screen retains its selected phosphor");
    assert(!colored.some((call) => call[0] === "fill" && ["#d6c5a5", "#eee0c3", "#948973"].includes(call[2])),
      "Key presses and the activity light cannot flash back to the original palette");
  }
}
const loading = capture("executing", true, 0, "none", null, variant.id);
assert(loading.some((call) => call[0] === "fill" && call[2] === variant.shell), "Loading silhouette uses the selected shell color");
assert(skin.isMacintoshTerminalSkin(variant.id));
}
assert(skin.isMacintoshTerminalSkin(skin.MACINTOSH_TERMINAL_SKIN_ID));
assert(!skin.isMacintoshTerminalSkin("terminal-green-amber-skin"));
const requestedAssets = [];
globalThis.Image = class {
  complete = true;
  naturalWidth = 1161;
  set src(value) { requestedAssets.push(value); }
};
capture("idle", false, 0, "none", null);
capture("idle", false, 0, "none", null, skin.MACINTOSH_FOREST_ORANGE_SKIN_ID);
capture("idle", false, 0, "none", null, skin.MACINTOSH_ORANGE_GREEN_SKIN_ID);
capture("idle", false, 0, "none", null);
capture("idle", false, 0, "none", null, skin.MACINTOSH_FOREST_ORANGE_SKIN_ID);
assert.deepEqual(requestedAssets, [skin.MACINTOSH_TERMINAL_ASSET, skin.MACINTOSH_FOREST_ORANGE_ASSET, skin.MACINTOSH_ORANGE_GREEN_ASSET],
  "Switching skins selects separate cached images without reloading");
delete globalThis.Image;
for (const file of ["terminal-macintosh.png", "terminal-macintosh-forest-orange.png", "terminal-macintosh-orange-green.png"]) {
  const png = readFileSync(new URL(`../public/assets/furniture/${file}`, import.meta.url));
  assert(png.readUInt32BE(16) >= geometry.source.x + geometry.source.width, "All assets cover the unchanged crop width");
  assert(png.readUInt32BE(20) >= geometry.source.y + geometry.source.height, "All assets cover the unchanged crop height");
  assert.equal(png[25], 6, "Sprites retain RGBA transparency");
}
console.log("Macintosh terminal smoke passed: all three palettes share geometry/timing, CRT and key/loading colors persist, independent image caches, all status phases, static ghosts and canvas isolation.");
