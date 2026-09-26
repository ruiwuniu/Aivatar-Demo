import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the production renderer's actual function bodies with synthetic scene
// data and a recording canvas. No application, agent bridge, or save is opened.
const source = readFileSync(new URL("../src/game/renderScene.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("renderScene.ts", source, ts.ScriptTarget.Latest, true);
const macintoshSource = readFileSync(new URL("../src/game/macintoshTerminal.ts", import.meta.url), "utf8");
const macintoshCode = ts.transpileModule(macintoshSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2020 },
}).outputText;
const macintosh = await import(`data:text/javascript;base64,${Buffer.from(macintoshCode).toString("base64")}`);
const initializer = (name) => {
  const declarations = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === name && node.initializer) declarations.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(declarations.length, 1, `One production declaration is required: ${name}`);
  return declarations[0].getText(ast);
};
const bind = (name, context) => {
  const code = ts.transpileModule(`const result = (${initializer(name)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  context[name] = new Function(...Object.keys(context), `${code}\nreturn result;`)(...Object.values(context));
};
const noop = () => {};
const drawCalls = [];
const legacyCalls = [];
const occlusion = { inFront: true, previewPlacement: "floor" };
let drawActualMacintosh = false;
const context = {
  MACINTOSH_TERMINAL_SKIN_ID: "terminal-macintosh-skin",
  drawMacintoshTerminal: (ctx, options) => {
    drawCalls.push(structuredClone(options));
    if (drawActualMacintosh) macintosh.drawMacintoshTerminal(ctx, { ...options, image: {} });
  },
  TERMINAL_MONITOR_SPRITE_X_OFFSET: -21,
  TERMINAL_MONITOR_SPRITE_Y_OFFSET: -35,
  terminalMonitorSkinId: (skinId) => skinId ?? "classic",
  terminalMonitorSpriteForSkinId: () => ({ palette: {}, rows: ["x"] }),
  terminalMonitorAnimationPalette: () => new Proxy({}, { get: (_target, key) => String(key) }),
  drawTableSprite: (...args) => legacyCalls.push(["sprite", ...args.slice(1)]),
  drawPixelRect: (...args) => legacyCalls.push(["rect", ...args.slice(1)]),
  normalizePaintingGallery: () => ({}),
  paintingArtworkById: () => undefined,
  paintingProgressRatio: () => 1,
  isAvatarPlayingGameConsole: () => false,
  GAS_OVEN_RANGE_ITEM_ID: "gas-oven-range",
  isWallPlacedItem: () => false,
  isFloorUnderlayItem: () => false,
  placedItemDepthY: (item) => item.y,
  isPlacedItemInFrontOfAvatar: () => occlusion.inFront,
  getItemPlacementKind: () => occlusion.previewPlacement,
  placedItemFurnitureOverlayClipRects: () => [{ x: 0, y: 0, width: 800, height: 600 }],
  drawPlacedItemHighlight: noop,
  avatarOcclusionClipBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
  furnitureByDepth: (furniture) => furniture,
  isFurnitureInFrontOfAvatar: () => true,
  drawFurniture: noop,
  sceneSize: { width: 800, height: 600 },
  resolveSurface: () => ({}),
  fallbackFloorPalette: {},
  drawRoom: (...args) => { args[10](); args[11](); },
  createAvatarRenderLayers: (avatar, visitors, visible) => [
    ...(visible ? [{ kind: "primary", runtime: avatar }] : []),
    ...visitors.map((visitor) => ({ kind: "visitor", runtime: visitor.runtime, visitor })),
  ],
  drawAvatarRenderLayer: noop,
  drawFloorLightOverlay: noop,
  drawCodexThinkingBubble: noop,
  drawAvatarBubble: noop,
  drawActivityBubble: noop,
  drawVisitorBubble: noop,
  drawSelectedInteractionPoints: noop,
  drawComputerStatusBubble: noop,
  drawStatusLights: noop,
  visibleRoomStatus: (status) => status,
  BUILTIN_TERMINAL_PLACED_ITEM_ID: "builtin-terminal-monitor",
  TERMINAL_MONITOR_ITEM_ID: "terminal-monitor",
  drawDesktopVendingMachine: noop,
  drawAvatar: noop,
  deriveBehaviorFromCodex: () => "coding",
};
for (const name of ["drawTerminalMonitor", "drawPlaceableItem", "drawMacintoshPlacementPreview", "isRecordPlayerActive", "drawPlacedItem",
  "placedItemYSort", "placedItemDepthSort", "tableCoffeeCupFillSet", "createPlacedItemRenderCache",
  "drawPlacedItems", "clipToRects", "isPreviewOnSurface", "drawPlacedItemsInFrontOfForegroundFurniture",
  "drawWallPlacedItems", "drawPlacedItemsForSurface", "drawFloorUnderlayItems",
  "drawAvatarForegroundOcclusion", "renderScene", "renderDesktopScene"]) bind(name, context);
const canvasContext = new Proxy({}, {
  get(target, key) { return key in target ? target[key] : noop; },
  set(target, key, value) { target[key] = value; return true; },
});
const canvas = { width: 800, height: 600, getContext: () => canvasContext };
const terminal = {
  id: "builtin-terminal-monitor", itemId: "terminal-monitor", skinId: "terminal-macintosh-skin",
  x: 300, y: 220, surfaceFurnitureId: "desk",
};
const content = {
  room: { furniture: [{ id: "desk", x: 200, y: 180, width: 180, height: 90 }] },
  itemDefinitions: [{ id: "terminal-monitor", kind: "decor" }],
  placedItems: [terminal], petStats: {},
};
const operator = { x: 300, y: 238, targetX: 300, targetY: 238, behavior: "coding", facing: "back" };
const visitor = { runtime: { ...operator, x: 750, y: 550, behavior: "idle" } };
const renderRoom = (avatar, status, rotation = 0) => {
  drawCalls.length = 0;
  context.renderScene(canvas, { ...content, placedItems: [{ ...terminal, rotation }] }, avatar, { status }, 24,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    0, undefined, 0, 0, 0, "classic", false, undefined, undefined, "octopus", [visitor]);
  assert(drawCalls.length >= 6, "The fixture exercises foreground, furniture-surface, and both visitor/host occlusion passes");
  return [...drawCalls];
};

for (const inFront of [false, true]) {
  occlusion.inFront = inFront;
  for (const phase of ["idle", "thinking", "executing", "waiting_for_user", "complete", "error"]) {
    const calls = renderRoom(operator, phase);
    assert(calls.every((call) => call.phase === phase), `Every room pass retains ${phase}`);
    assert(calls.every((call) => call.active), "A visitor redraw must use the working host as operator");
  }
}
assert(renderRoom({ ...operator, behavior: "wander" }, "executing").every((call) => !call.active),
  "A task in progress cannot start screen typing while its operator is walking");
assert(renderRoom({ ...operator, x: 700 }, "thinking").every((call) => !call.active),
  "A remote operator cannot animate the terminal as actively working");
for (const rotation of [90, 180, 270]) {
  assert(renderRoom(operator, "executing", rotation).every((call) => call.active),
    `Rotating the terminal ${rotation} degrees preserves world-coordinate operator detection`);
}

// Direct pass tests also cover the cache routes which normally contain other
// kinds of items, protecting future terminal placements without changing data.
const cache = context.createPlacedItemRenderCache(content, 0, operator, { status: "error" });
assert.strictEqual(cache.terminalState.avatar, operator);
cache.wallPlacedItems = [terminal];
cache.floorUnderlayItems = [terminal];
drawCalls.length = 0;
context.drawWallPlacedItems(canvasContext, content, 24, visitor.runtime, null, null, undefined, cache);
context.drawFloorUnderlayItems(canvasContext, content, 24, visitor.runtime, null, cache);
assert.equal(drawCalls.length, 2);
assert(drawCalls.every((call) => call.phase === "error" && call.active), "Wall/floor pass forwarding retains host state");

drawCalls.length = 0;
const scale = 4 / 3;
context.renderDesktopScene(canvas, {
  width: 1200, height: 800, scaleFactor: 2, pixelScale: scale,
  avatar: { ...operator, x: operator.x * scale, y: operator.y * scale,
    targetX: operator.targetX * scale, targetY: operator.targetY * scale },
  computer: { x: terminal.x * scale, y: terminal.y * scale },
  content, status: { status: "thinking" }, frame: 48, appearanceId: "octopus",
});
assert.equal(drawCalls.length, 1);
assert.equal(drawCalls[0].phase, "thinking");
assert.equal(drawCalls[0].active, true);
assert.equal(drawCalls[0].x, terminal.x);
assert.equal(drawCalls[0].y, terminal.y);

for (const skin of [undefined, "terminal-green-amber-skin", "terminal-white-cyan-skin", "terminal-neon-dark-skin"]) {
  drawCalls.length = 0;
  legacyCalls.length = 0;
  context.drawTerminalMonitor(canvasContext, 300, 220, "none", 24, operator, skin);
  const baseline = structuredClone(legacyCalls);
  legacyCalls.length = 0;
  context.drawTerminalMonitor(canvasContext, 300, 220, "none", 24, operator, skin,
    { avatar: visitor.runtime, status: { status: "error" } });
  assert.deepEqual(legacyCalls, baseline, "New state forwarding must not change existing terminal skins");
  assert.equal(drawCalls.length, 0, "Only the Macintosh skin dispatches to the new renderer");
}
for (const ghost of ["valid", "invalid"]) {
  drawCalls.length = 0;
  context.drawTerminalMonitor(canvasContext, 300, 220, ghost, 24, operator, "terminal-macintosh-skin",
    { avatar: operator, status: { status: "executing" } });
  assert.equal(drawCalls[0].ghost, ghost, "Placement validity reaches the Macintosh renderer");
}

// Exercise all five real preview entry points with the actual Macintosh module.
// Pixel-operation equality across distant frames proves static ghosts through
// the integration chain, rather than just testing the animation-state helper.
const recordingCanvas = () => {
  const operations = [];
  const stack = [];
  let state = { globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, imageSmoothingEnabled: false };
  const ctx = new Proxy({
    save() { stack.push({ ...state }); operations.push(["save"]); },
    restore() { assert(stack.length); state = stack.pop(); operations.push(["restore"]); },
    createLinearGradient(...args) {
      operations.push(["gradient", ...args]);
      return { addColorStop: (...stop) => operations.push(["colorStop", ...stop]) };
    },
    drawImage(_image, ...args) { operations.push(["image", ...args]); },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key in state) return state[key];
      return (...args) => operations.push([String(key), ...args]);
    },
    set(_target, key, value) {
      state[key] = value;
      operations.push([String(key), typeof value === "object" ? "gradient" : value]);
      return true;
    },
  });
  return { ctx, operations, assertRestored: () => {
    assert.equal(stack.length, 0, "The preview path balances canvas transforms");
    assert.equal(state.globalAlpha, 1, "Preview opacity cannot leak outside its pass");
  } };
};
const emptyContent = { ...content, placedItems: [] };
const previewPasses = [
  { name: "placed-items", surface: false, run: (ctx, preview, frame) =>
    context.drawPlacedItems(ctx, emptyContent, frame, operator, null, preview) },
  { name: "foreground-overlay", surface: false, run: (ctx, preview, frame) =>
    context.drawPlacedItemsInFrontOfForegroundFurniture(ctx, emptyContent, content.room.furniture,
      frame, operator, null, preview) },
  { name: "wall-preview", surface: false, wall: true, run: (ctx, preview, frame) =>
    context.drawWallPlacedItems(ctx, emptyContent, frame, operator, null, preview) },
  { name: "visitor-surface", surface: true, run: (ctx, preview, frame) =>
    context.drawAvatarForegroundOcclusion(ctx, emptyContent, { kind: "visitor", runtime: visitor.runtime },
      frame, undefined, undefined, undefined, preview) },
  { name: "room-surface", surface: true, run: (ctx, preview, frame) =>
    context.renderScene({ ...canvas, getContext: () => ctx }, emptyContent, operator, { status: "executing" }, frame,
      undefined, undefined, undefined, preview) },
];
drawActualMacintosh = true;
for (const pass of previewPasses) {
  occlusion.previewPlacement = pass.wall ? "wall" : "floor";
  for (const valid of [false, true]) {
    for (const rotation of [0, 90, 180, 270]) {
      const preview = { item: content.itemDefinitions[0], skinId: "terminal-macintosh-skin",
        x: pass.surface ? 300 : 500, y: pass.surface ? 200 : 350, valid, rotation };
      let firstFrame;
      for (const frame of [0, 777]) {
        drawCalls.length = 0;
        const recording = recordingCanvas();
        pass.run(recording.ctx, preview, frame);
        assert.equal(drawCalls.length, pass.name === "room-surface" ? 2 : 1,
          `${pass.name} dispatches every selected Macintosh preview pass`);
        assert(drawCalls.every((call) => call.ghost === (valid ? "valid" : "invalid")), pass.name);
        assert(recording.operations.some(([name, angle]) => name === "rotate" && angle === rotation * Math.PI / 180),
          `${pass.name} rotates the actual ghost with its placed item`);
        assert(recording.operations.some(([name, x, y]) => name === "translate" && x === preview.x && y === preview.y),
          `${pass.name} preserves the preview's world anchor`);
        assert(recording.operations.some(([name, alpha]) => name === "globalAlpha" && alpha === 0.62),
          `${pass.name} renders a translucent ghost`);
        assert(recording.operations.some(([name, color]) => name === "strokeStyle"
          && color === (valid ? "#ffe66d" : "#ff5c7a")), `${pass.name} keeps placement validity visible`);
        recording.assertRestored();
        if (firstFrame) assert.deepEqual(recording.operations, firstFrame, `${pass.name} ghost is frame-independent`);
        else firstFrame = recording.operations;
      }
    }
  }
  for (const skinId of [undefined, "terminal-green-amber-skin", "terminal-white-cyan-skin", "terminal-neon-dark-skin"]) {
    const preview = { item: content.itemDefinitions[0], skinId,
      x: pass.surface ? 300 : 500, y: pass.surface ? 200 : 350, valid: true, rotation: 90 };
    drawCalls.length = 0;
    legacyCalls.length = 0;
    pass.run(recordingCanvas().ctx, preview, 24);
    assert.equal(drawCalls.length, 0, `${pass.name} retains the old dispatch for non-Macintosh previews`);
    const legacyWithSkin = structuredClone(legacyCalls);
    assert(legacyWithSkin.some(([kind]) => kind === "sprite"), `${pass.name} still draws an existing skin preview`);
    legacyCalls.length = 0;
    pass.run(recordingCanvas().ctx, { ...preview, skinId: undefined }, 24);
    assert.deepEqual(legacyCalls, legacyWithSkin, `${pass.name} leaves existing preview behavior unchanged`);
  }
}

console.log("Macintosh renderer integration passed: room layers, visitor occlusion, rotations, world/desktop coordinates, task phases, five static ghost preview paths, and unchanged legacy skins/previews.");
