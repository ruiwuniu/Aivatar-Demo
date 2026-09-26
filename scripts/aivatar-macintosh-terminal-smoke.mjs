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

const capture = (phase, active, frame = 0, ghost = "none", image = {}) => {
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
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: (...args) => calls.push(["fill", clipped, typeof fillStyle === "string" ? fillStyle : "gradient", ...args]),
    strokeRect: (...args) => calls.push(["outline", ...args]),
    set fillStyle(value) { fillStyle = value; },
    get fillStyle() { return fillStyle; },
    set globalAlpha(value) { alpha = value; },
    get globalAlpha() { return alpha; },
  };
  skin.drawMacintoshTerminal(context, { x: 100.3, y: 200.2, frame, phase, active, ghost, image });
  assert.equal(saved.length, 0, "renderer balances canvas save/restore");
  assert.equal(alpha, 1, "ghost opacity cannot leak to other sprites");
  const imageCall = calls.find((call) => call[0] === "image");
  if (image) assert.deepEqual(imageCall.slice(2), [117, 103, 927, 1188,
    geometry.image.x, geometry.image.y, geometry.image.width, geometry.image.height]);
  assert(calls.some((call) => call[0] === "clip"), "screen is always clipped inside the CRT");
  for (const call of calls.filter((call) => call[0] === "path")) {
    inside({ x: call[1], y: call[2], width: 0, height: 0 }, geometry.screen);
  }
  for (const call of calls.filter((call) => call[0] === "fill" && call[2] === "#273126")) {
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
console.log("Macintosh terminal smoke passed: preserved geometry/aspect/keyboard baseline, calibrated key caps, all status phases, arrival gates, CRT clipping, static ghosts and canvas isolation.");
