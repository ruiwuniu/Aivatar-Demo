import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Execute production functions in memory with synthetic room/save fixtures only.
// --baseline reads tracked HEAD sources without changing the working tree.
const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = process.argv.includes("--baseline");
assert(process.argv.slice(2).every((arg) => arg === "--baseline"), "Unknown argument");
const source = (relative) => baseline
  ? execFileSync("git", ["show", `HEAD:${relative}`], { cwd: root, encoding: "utf8" })
  : readFileSync(path.join(root, relative), "utf8");
const transpile = (text, fileName = "fixture.ts") => ts.transpileModule(text, {
  fileName,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modules = new Map();
const load = (relative) => {
  if (modules.has(relative)) return modules.get(relative).exports;
  if (relative === "src/persistence/saveStore.ts") {
    return { appStorage: new Proxy({}, { get() { throw new Error("Test must not access storage"); } }) };
  }
  assert(relative.startsWith("src/") && !relative.includes(".."), "Unexpected module path");
  const module = { exports: {} };
  modules.set(relative, module);
  new Function("require", "module", "exports", transpile(source(relative), relative))(
    (specifier) => {
      assert(specifier.startsWith("."), `Unexpected external module: ${specifier}`);
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${specifier}.ts`)));
    }, module, module.exports,
  );
  return module.exports;
};
const simulation = load("src/game/simulation.ts");
const gasSprites = load("src/game/gasOvenRangeSprites.ts");
const i18n = load("src/i18n.ts");
const appText = source("src/App.tsx");
const appAst = ts.createSourceFile("src/App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const findNodes = (predicate) => {
  const found = [];
  const visit = (node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(appAst);
  return found;
};
const initializer = (name) => {
  const matches = findNodes((node) => ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name) && node.name.text === name && node.initializer);
  assert.equal(matches.length, 1, `Expected exactly one production declaration: ${name}`);
  return matches[0].initializer.getText(appAst);
};
const evaluate = (expression, context) => new Function(
  ...Object.keys(context),
  `${transpile(`const result = (${expression});`)}\nreturn result;`,
)(...Object.values(context));
const bindProduction = (name, context) => {
  context[name] = evaluate(initializer(name), context);
  return context[name];
};
const completionNodes = findNodes((node) => ts.isIfStatement(node)
  && /currentInteraction\?\.kind === "cook"/.test(node.expression.getText(appAst))
  && /now >= currentInteraction\.endsAt/.test(node.expression.getText(appAst)));
assert.equal(completionNodes.length, 1, "Expected the actual cooking completion branch");
const completion = completionNodes[0];
const completionExpression = `(now: number) => {
  const currentInteraction = activeInteractionRef.current;
  if (${completion.expression.getText(appAst)}) ${completion.thenStatement.getText(appAst)}
}`;

const makeHarness = ({ rotation = 0, coffee = true, extraRange = false, rawFish = true } = {}) => {
  const content = JSON.parse(source("public/config/aivatar.config.json"));
  content.room.furniture = [];
  const selected = { id: "selected-range", itemId: "gas-oven-range", x: 150, y: 235, rotation };
  const otherRange = { id: "nearer-range", itemId: "gas-oven-range", x: 245, y: 235, rotation: 0 };
  const coffeeMachine = { id: "test-coffee", itemId: "coffee-machine", x: 345, y: 220, rotation: 0 };
  content.placedItems = [selected, ...(extraRange ? [otherRange] : []), ...(coffee ? [coffeeMachine] : [])];
  const context = {
    ...simulation,
    ...gasSprites,
    contentRef: { current: content },
    saveRef: { current: {
      furnitureStorage: rawFish
        ? [{ furnitureId: "fridge", itemId: "raw-crucian-carp", quantity: 2 }]
        : [],
      inventory: [{ itemId: "coffee", quantity: 3 }],
      memory: { recentEvents: [] },
    } },
    runtimeRef: { current: { ...simulation.initialAvatarRuntime(), x: 260, y: 265 } },
    pendingWorldInteractionRef: { current: null },
    activeInteractionRef: { current: null },
    performance: { now: () => 1000 },
    setAvatar() {},
    ui: (key, params) => i18n.t("zh-Hans", key, params),
    // Capture the event submitted by the real settlement branch, without persistence.
    recordLifeMemory: (memory, event) => ({ ...memory, recentEvents: [...memory.recentEvents, event] }),
  };
  context.updateActiveInteraction = (interaction) => { context.activeInteractionRef.current = interaction; };
  context.setSave = (update) => { context.saveRef.current = update(context.saveRef.current); };
  for (const name of [
    "RAW_FISH_ITEM_IDS", "COOKED_FISH_BY_RAW_ID", "FISH_COOK_SECONDS", "INTERACTION_FEEDBACK_SECONDS",
    "TABLE_FURNITURE_ID", "COFFEE_ITEM_ID", "EMPTY_TABLE_COFFEE_CAPACITY",
    "getInventoryQuantity", "firstRawFishInFridge", "defaultFurnitureStorage", "normalizeFurnitureStorage",
    "consumeFurnitureStorageItem", "addInventoryItem", "getPlacedItemInteractionTarget", "resetRuntimeToIdle",
    "queuePlacedItemInteraction", "startGasRangeCooking",
  ]) bindProduction(name, context);
  context.completeCooking = evaluate(completionExpression, context);
  const definition = content.itemDefinitions.find((item) => item.id === selected.itemId);
  assert(definition);
  return { context, content, selected, otherRange, coffeeMachine, definition };
};
const placeAtSelectedRange = ({ context, content, selected }) => {
  const points = simulation.getPlacedItemInteractionStandpoints(selected, content);
  assert.equal(points.length, 1, "Fixture must have a reachable selected stove point");
  const point = points[0];
  // Arrival permits a small distance from the ideal point. Starting must not snap it.
  const actual = { x: point.x + 3, y: point.y };
  context.runtimeRef.current = {
    ...context.runtimeRef.current, ...actual, targetX: point.x, targetY: point.y,
    interactionTargetAlternates: [{ x: 300, y: 250 }],
    navigationFailure: { behavior: "wander", targetX: 300, targetY: 250, reason: "blocked" },
  };
  return actual;
};

let passed = 0;
const failures = [];
const check = (name, run) => {
  try { run(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
};
const idleStatus = { status: "idle", timestamp: "2000-01-01T00:00:00.000Z" };

for (const rotation of [0, 90, 180, 270]) {
  for (const coffee of [false, true]) {
    check(`selected stove and stationary cooking: rotation=${rotation}, coffee=${coffee}`, () => {
      const harness = makeHarness({ rotation, coffee, extraRange: true });
      const { context, content, selected, otherRange, definition } = harness;
      const initial = context.runtimeRef.current;
      assert(Math.hypot(initial.x - otherRange.x, initial.y - otherRange.y)
        < Math.hypot(initial.x - selected.x, initial.y - selected.y), "Other stove must initially be closer");
      context.queuePlacedItemInteraction(selected, definition, "cook");
      const selectedPoint = simulation.getPlacedItemInteractionStandpoints(selected, content)[0];
      assert.equal(context.runtimeRef.current.actionIntent, "cook");
      assert.equal(context.pendingWorldInteractionRef.current.placedItem.id, selected.id);
      assert.equal(context.runtimeRef.current.targetX, selectedPoint.x);
      assert.equal(context.runtimeRef.current.targetY, selectedPoint.y);
      const actual = placeAtSelectedRange(harness);
      context.startGasRangeCooking(selected);
      let runtime = context.runtimeRef.current;
      assert.equal(runtime.behavior, "cook");
      assert.equal(runtime.activityLabel, "Cooking fish");
      assert.equal(runtime.targetX, actual.x);
      assert.equal(runtime.targetY, actual.y);
      assert.equal(runtime.actionIntent, undefined);
      assert.equal(runtime.actionActivityLabel, undefined);
      assert.equal(runtime.interactionTargetAlternates, undefined);
      assert.equal(runtime.navigationFailure, undefined);
      assert.equal(context.activeInteractionRef.current.furnitureId, selected.id);
      assert.equal(context.activeInteractionRef.current.kind, "cook");
      assert.equal(runtime.facing, gasSprites.gasOvenRangeCookingFacing(rotation));
      const initialInventory = structuredClone(context.saveRef.current.inventory);
      for (let frame = 0; frame < 8 * 60; frame += 1) {
        runtime = simulation.tickAvatar(runtime, content, idleStatus, 1 / 60, undefined, {
          navigationScopeKey: `cooking-${rotation}-${coffee}`,
        });
        assert.equal(runtime.behavior, "cook");
        assert.equal(runtime.x, actual.x);
        assert.equal(runtime.y, actual.y);
        assert.equal(runtime.facing, gasSprites.gasOvenRangeCookingFacing(rotation));
      }
      assert.deepEqual(context.saveRef.current.inventory, initialInventory);
    });
  }
}

check("arrival gate starts cooking only at a stove", () => {
  const { context, content, selected } = makeHarness();
  const cooking = simulation.setBehavior(context.runtimeRef.current, "cook", content, 8);
  assert.equal(cooking.behavior, "wander");
  assert.equal(cooking.actionIntent, "cook");
  const point = simulation.getPlacedItemInteractionStandpoints(selected, content)[0];
  assert.equal(cooking.targetX, point.x);
  assert.equal(cooking.targetY, point.y);
  const arrived = simulation.tickAvatar({ ...cooking, x: point.x + 6, y: point.y }, content, idleStatus, 1 / 60);
  assert.equal(arrived.behavior, "cook");
  assert.equal(arrived.actionIntent, undefined);
  assert.equal(arrived.activityLabel, "Cooking fish");
});

check("missing fish cancels queued cooking without leaving a cook intent", () => {
  const harness = makeHarness({ rawFish: false });
  const { context, selected, definition } = harness;
  context.queuePlacedItemInteraction(selected, definition, "cook");
  placeAtSelectedRange(harness);
  context.startGasRangeCooking(selected);
  const runtime = context.runtimeRef.current;
  assert.equal(context.activeInteractionRef.current.kind, "blocked");
  assert.equal(runtime.behavior, "idle");
  assert.equal(runtime.actionIntent, undefined);
  assert.equal(runtime.targetX, runtime.x);
  assert.equal(runtime.targetY, runtime.y);
  assert.equal(runtime.navigationFailure, undefined);
});

check("cooking settles one fish exactly once and records cook instead of brew", () => {
  const harness = makeHarness();
  const { context, selected } = harness;
  placeAtSelectedRange(harness);
  context.startGasRangeCooking(selected);
  const deadline = context.activeInteractionRef.current.endsAt;
  context.completeCooking(deadline - 1);
  assert.equal(context.getInventoryQuantity(context.saveRef.current.inventory, "cooked-crucian-carp"), 0);
  context.completeCooking(deadline);
  context.completeCooking(deadline + 1);
  const save = context.saveRef.current;
  assert.equal(save.furnitureStorage.find((entry) => entry.itemId === "raw-crucian-carp").quantity, 1);
  assert.equal(context.getInventoryQuantity(save.inventory, "cooked-crucian-carp"), 1);
  assert.equal(context.getInventoryQuantity(save.inventory, "coffee"), 3);
  assert.equal(save.memory.recentEvents.length, 1);
  assert.equal(save.memory.recentEvents[0].behavior, "cook");
  assert.equal(save.memory.recentEvents[0].itemId, "cooked-crucian-carp");
  assert.equal(context.runtimeRef.current.behavior, "idle");
  assert.equal(context.activeInteractionRef.current.kind, "none");
});

check("coffee brewing retains its own target and arrival behavior", () => {
  const { context, content, coffeeMachine } = makeHarness();
  const runtime = simulation.setBehavior(context.runtimeRef.current, "brew", content, 8);
  assert.equal(runtime.actionIntent, "brew");
  assert(simulation.getPlacedItemInteractionStandpoints(coffeeMachine, content)
    .some((point) => point.x === runtime.targetX && point.y === runtime.targetY));
  const arrived = simulation.tickAvatar({ ...runtime, x: runtime.targetX, y: runtime.targetY }, content, idleStatus, 1 / 60);
  assert.equal(arrived.behavior, "brew");
  assert.equal(arrived.activityLabel, "Brewing coffee");
});

for (const locale of ["zh-Hans", "zh-Hant", "en"]) {
  check(`cooking status and activity have distinct translated labels: ${locale}`, () => {
    for (const label of [i18n.behaviorLabel(locale, "cook"), i18n.activityLabel(locale, "Cooking fish")]) {
      assert(!/^(behavior|activity)\./.test(label), "Translation key must resolve");
      assert(!/coffee|咖啡/i.test(label), "Cooking must not be labeled as coffee brewing");
      assert(/cook|烹|煎/i.test(label), "Cooking label must describe cooking");
    }
    assert(/coffee|咖啡|brew/i.test(i18n.behaviorLabel(locale, "brew")));
  });
}

console.log(`Cooking smoke${baseline ? " (HEAD baseline)" : ""}: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
