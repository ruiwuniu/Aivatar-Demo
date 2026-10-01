import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Production rules and App callbacks, with synthetic fixtures and no persistence.
const root = fileURLToPath(new URL("../", import.meta.url));
const source = (relative) => readFileSync(path.join(root, relative), "utf8");
const transpile = (text, fileName = "fixture.ts") => ts.transpileModule(text, {
  fileName, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modules = new Map();
const load = (relative) => {
  if (modules.has(relative)) return modules.get(relative).exports;
  if (relative === "src/persistence/saveStore.ts") return {
    appStorage: new Proxy({}, { get() { throw new Error("Test must not access storage"); } }),
  };
  assert(relative.startsWith("src/") && !relative.includes(".."));
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
const cooking = load("src/game/pondWeedCooking.ts");
const simulation = load("src/game/simulation.ts");
const gasSprites = load("src/game/gasOvenRangeSprites.ts");
const appText = source("src/App.tsx");
const ast = ts.createSourceFile("src/App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const findNodes = (predicate) => {
  const found = [];
  const visit = (node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  return found;
};
const initializer = (name) => {
  const nodes = findNodes((node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer);
  assert.equal(nodes.length, 1, `Expected one production declaration: ${name}`);
  return nodes[0].initializer.getText(ast);
};
const evaluate = (expression, context) => new Function(
  ...Object.keys(context), `${transpile(`const result = (${expression});`)}\nreturn result;`,
)(...Object.values(context));
const bind = (name, context) => { context[name] = evaluate(initializer(name), context); };
const completionNodes = findNodes((node) => ts.isIfStatement(node)
  && /currentInteraction\?\.kind === "cook"/.test(node.expression.getText(ast))
  && /now >= currentInteraction\.endsAt/.test(node.expression.getText(ast)));
assert.equal(completionNodes.length, 1);
const completionNode = completionNodes[0];
const completionExpression = `(now: number) => {
  const currentInteraction = activeInteractionRef.current;
  if (${completionNode.expression.getText(ast)}) ${completionNode.thenStatement.getText(ast)}
}`;
const idle = { status: "idle", timestamp: new Date().toISOString() };
const busy = { status: "executing", timestamp: new Date().toISOString() };
const saladRecipe = cooking.cookingRecipeForIngredient("pond-weed");
const makeSave = (quantity = 2, meals = 0) => ({
  furnitureStorage: [{ furnitureId: "fridge", itemId: "pond-weed", quantity, capacity: 999 }],
  inventory: meals ? [{ itemId: "pond-weed-salad", quantity: meals }] : [],
  petStats: { hunger: 40, energy: 70, mood: 50 },
  memory: { recentEvents: [] },
});
const makeHarness = ({ rotation = 0, quantity = 2, meals = 0, rawFish = false } = {}) => {
  const content = JSON.parse(source("public/config/aivatar.config.json"));
  const stove = { id: "selected-stove", itemId: "gas-oven-range", x: 160, y: 240, rotation };
  content.placedItems = [stove, { id: "test-coffee", itemId: "coffee-machine", x: 345, y: 220 }];
  const save = makeSave(quantity, meals);
  if (rawFish) save.furnitureStorage.push({ furnitureId: "fridge", itemId: "raw-crucian-carp", quantity: 2, capacity: 999 });
  content.inventory = structuredClone(save.inventory);
  // Keep the fixture usable while another contributor is registering the asset.
  if (!content.itemDefinitions.some((item) => item.id === "pond-weed-salad")) content.itemDefinitions.push({
    id: "pond-weed-salad", name: "Pond Weed Salad", kind: "food", effect: cooking.POND_WEED_SALAD_EFFECT,
  });
  const context = {
    ...simulation, ...gasSprites, ...cooking,
    contentRef: { current: content }, saveRef: { current: save },
    runtimeRef: { current: { ...simulation.initialAvatarRuntime(), x: 180, y: 260 } },
    pendingWorldInteractionRef: { current: null }, activeInteractionRef: { current: null },
    statusRef: { current: { status: idle } },
    performance: { now: () => 1000 }, setAvatar() {}, setSceneContextMenu() {},
    ui: (key) => key,
    foodPreferenceScoreForConsumable: () => 0,
    traitChangesForConsumable: () => ({ warmth: 1 }),
    recordLifeMemory: (memory, event) => ({ ...memory, recentEvents: [...memory.recentEvents, event] }),
    chooseNearestOrRandomPlacedItem: (_runtime, items) => items[0],
    showPlacedItemBusy: () => { context.blockedByTask = true; },
  };
  context.setSave = (update) => { context.saveRef.current = update(context.saveRef.current); };
  context.updateActiveInteraction = (interaction) => { context.activeInteractionRef.current = interaction; };
  for (const name of [
    "RAW_FISH_ITEM_IDS", "FISH_COOK_SECONDS", "INTERACTION_FEEDBACK_SECONDS", "SESSION_STALE_MS",
    "TABLE_FURNITURE_ID", "COFFEE_ITEM_ID", "COFFEE_CUP_ITEM_ID", "COLA_ITEM_ID", "BENTO_ITEM_ID", "COOKIE_ITEM_ID", "EMPTY_TABLE_COFFEE_CAPACITY",
    "getInventoryQuantity", "firstRawFishInFridge", "defaultFurnitureStorage", "normalizeFurnitureStorage",
    "consumeFurnitureStorageItem", "getFurnitureStorageEntry", "getFurnitureStorageQuantity", "isTableCoffeeCup", "getTableCoffeeCapacity", "getTableCoffeeQuantity",
    "getPlacedItemInteractionTarget", "resetRuntimeToIdle", "runtimeActionBehavior", "isPresenceStale", "isHighPriorityStatus", "clampQuantity", "behaviorForConsumable",
    "queuePlacedItemInteraction", "startGasRangeCooking", "cancelInterruptedCooking", "requestPondWeedSalad", "startFeedInteraction",
  ]) bind(name, context);
  context.complete = evaluate(completionExpression, context);
  const point = simulation.getPlacedItemInteractionStandpoints(stove, content)[0];
  assert(point, "Fixture must have a reachable stove interaction point");
  context.runtimeRef.current = { ...context.runtimeRef.current, x: point.x, y: point.y, targetX: point.x, targetY: point.y };
  return { context, content, stove };
};
let passed = 0;
const failures = [];
const check = (name, run) => {
  try { run(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
};

check("salad recipe is cold, six seconds, and restores only hunger and mood", () => {
  assert.deepEqual(saladRecipe, { ingredientId: "pond-weed", resultItemId: "pond-weed-salad", seconds: 6, coldPreparation: true });
  assert.deepEqual(cooking.POND_WEED_SALAD_EFFECT, { hunger: 12, mood: 3 });
});
check("conversion atomically spends one fridge weed and adds one salad without mutation", () => {
  const before = makeSave();
  const snapshot = structuredClone(before);
  const after = cooking.completeCookingRecipe(before, saladRecipe);
  assert.deepEqual(before, snapshot);
  assert.equal(after.furnitureStorage[0].quantity, 1);
  assert.deepEqual(after.inventory, [{ itemId: "pond-weed-salad", quantity: 1 }]);
  assert.deepEqual(after.petStats, before.petStats);
});
check("missing ingredients and full meal stacks never consume food", () => {
  for (const save of [makeSave(0), makeSave(1, 999)]) assert.equal(cooking.completeCookingRecipe(save, saladRecipe), save);
  const save = makeSave(1, 998);
  const after = cooking.completeCookingRecipe(save, saladRecipe);
  assert.equal(after.inventory[0].quantity, 999);
  assert.equal(after.furnitureStorage[0].quantity, 0);
});
check("malformed quantities and forged output recipes are rejected", () => {
  for (const quantity of [-1, 0.5, NaN, Infinity]) {
    const save = makeSave(quantity);
    assert.equal(cooking.completeCookingRecipe(save, saladRecipe), save);
  }
  const save = makeSave();
  assert.equal(cooking.completeCookingRecipe(save, { ...saladRecipe, resultItemId: "coffee" }), save);
  const brokenOutput = makeSave(2, 1.5);
  assert.equal(cooking.completeCookingRecipe(brokenOutput, saladRecipe), brokenOutput);
});
check("split stacks spend exactly one and output capacity counts all stacks", () => {
  const save = makeSave(1);
  save.furnitureStorage.push({ ...save.furnitureStorage[0], quantity: 2 });
  const after = cooking.completeCookingRecipe(save, saladRecipe);
  assert.deepEqual(after.furnitureStorage.map((entry) => entry.quantity), [0, 2]);
  save.inventory = [{ itemId: "pond-weed-salad", quantity: 500 }, { itemId: "pond-weed-salad", quantity: 499 }];
  assert.equal(cooking.completeCookingRecipe(save, saladRecipe), save);
});
check("explicit recipe selection cannot fall back to fish", () => {
  const save = makeSave(0);
  save.furnitureStorage.push({ furnitureId: "fridge", itemId: "raw-crucian-carp", quantity: 2 });
  assert.equal(cooking.selectCookingRecipe(save.furnitureStorage, save.inventory, "pond-weed"), undefined);
  const fish = cooking.selectCookingRecipe(save.furnitureStorage, save.inventory, "raw-crucian-carp");
  assert.equal(fish.resultItemId, "cooked-crucian-carp");
  const after = cooking.completeCookingRecipe(save, fish);
  assert.equal(after.furnitureStorage[1].quantity, 1);
  assert.deepEqual(after.inventory, [{ itemId: "cooked-crucian-carp", quantity: 1 }]);
});
for (const rotation of [0, 90, 180, 270]) {
  check(`salad holds the selected stove and cooking facing: ${rotation}`, () => {
    const { context, content, stove } = makeHarness({ rotation, rawFish: true });
    const before = structuredClone(context.saveRef.current);
    const position = { x: context.runtimeRef.current.x, y: context.runtimeRef.current.y };
    context.startGasRangeCooking(stove, "pond-weed");
    assert.equal(context.activeInteractionRef.current.itemId, "pond-weed");
    assert.equal(context.activeInteractionRef.current.endsAt, 7000);
    let runtime = context.runtimeRef.current;
    for (let step = 0; step < 5 * 60; step += 1) runtime = simulation.tickAvatar(runtime, content, idle, 1 / 60);
    assert.equal(runtime.behavior, "cook");
    assert.equal(runtime.activityLabel, "Making pond weed salad");
    assert.equal(runtime.x, position.x); assert.equal(runtime.y, position.y);
    assert.equal(runtime.facing, gasSprites.gasOvenRangeCookingFacing(rotation));
    assert.deepEqual(context.saveRef.current, before);
  });
}
check("App completion converts once, at six seconds, and leaves fish intact", () => {
  const { context, stove } = makeHarness({ rawFish: true });
  context.startGasRangeCooking(stove, "pond-weed");
  context.complete(6999);
  assert.equal(context.saveRef.current.inventory.length, 0);
  context.complete(7000); context.complete(7100);
  const save = context.saveRef.current;
  assert.deepEqual(save.inventory, [{ itemId: "pond-weed-salad", quantity: 1 }]);
  assert.deepEqual(save.furnitureStorage.map((entry) => entry.quantity), [1, 2]);
  assert.equal(save.memory.recentEvents.length, 1);
  assert.equal(save.memory.recentEvents[0].itemId, "pond-weed-salad");
  assert.equal(context.runtimeRef.current.behavior, "idle");
});
check("capacity reached during preparation preserves ingredients", () => {
  const { context, stove } = makeHarness();
  context.startGasRangeCooking(stove, "pond-weed");
  context.saveRef.current.inventory = [{ itemId: "pond-weed-salad", quantity: 999 }];
  const before = structuredClone(context.saveRef.current);
  context.complete(7000);
  assert.deepEqual(context.saveRef.current, before);
  assert.equal(context.activeInteractionRef.current.message, "message.cookingNotCompleted");
});
check("task takeover cancels preparation before its deadline without a refund or reward", () => {
  const { context, content, stove } = makeHarness();
  context.startGasRangeCooking(stove, "pond-weed");
  const before = structuredClone(context.saveRef.current);
  context.cancelInterruptedCooking(busy, content);
  context.complete(9000);
  assert.equal(context.activeInteractionRef.current, null);
  assert.deepEqual(context.saveRef.current, before);
  assert.equal(context.runtimeRef.current.actionIntent, undefined);
});
check("cancellation preserves a task behavior which has already taken over", () => {
  const { context, content, stove } = makeHarness();
  context.startGasRangeCooking(stove, "pond-weed");
  context.runtimeRef.current = { ...context.runtimeRef.current, behavior: "coding", activityLabel: "Coding" };
  context.cancelInterruptedCooking(busy, content);
  assert.equal(context.runtimeRef.current.behavior, "coding");
});
check("removing the selected stove cancels without consuming ingredients", () => {
  const { context, content, stove } = makeHarness();
  context.startGasRangeCooking(stove, "pond-weed");
  const before = structuredClone(context.saveRef.current);
  context.cancelInterruptedCooking(idle, { ...content, placedItems: [] });
  context.complete(9000);
  assert.deepEqual(context.saveRef.current, before);
});
check("salad without weed cannot silently cook an available fish", () => {
  const { context, stove } = makeHarness({ quantity: 0, rawFish: true });
  context.startGasRangeCooking(stove, "pond-weed");
  assert.equal(context.activeInteractionRef.current.kind, "blocked");
  assert.equal(context.activeInteractionRef.current.message, "message.noPondWeed");
  assert.equal(context.runtimeRef.current.behavior, "idle");
});
check("manual menu and ingredient action queue salad at the selected stove", () => {
  const { context, stove } = makeHarness({ rawFish: true });
  context.requestPondWeedSalad(stove);
  assert.equal(context.pendingWorldInteractionRef.current.placedItem.id, stove.id);
  assert.equal(context.pendingWorldInteractionRef.current.preferredIngredientId, "pond-weed");
  assert.equal(context.runtimeRef.current.actionIntent, "cook");
  assert.equal(context.runtimeRef.current.actionActivityLabel, "Making pond weed salad");
  assert.equal(context.saveRef.current.furnitureStorage[0].quantity, 2);
});
check("manual salad requests respect task priority and require a stove", () => {
  const { context, content, stove } = makeHarness();
  context.statusRef.current.status = busy;
  context.requestPondWeedSalad(stove);
  assert.equal(context.blockedByTask, true);
  assert.equal(context.pendingWorldInteractionRef.current, null);
  context.statusRef.current.status = idle;
  content.placedItems = [];
  context.requestPondWeedSalad();
  assert.equal(context.activeInteractionRef.current.message, "message.saladNeedsStove");
});
check("manual eating consumes one salad, restores stats once, and resists stale UI inventory", () => {
  const { context, content } = makeHarness({ meals: 1 });
  const fridge = content.room.furniture.find((item) => item.id === "fridge");
  context.startFeedInteraction(fridge, "pond-weed-salad");
  assert.equal(context.runtimeRef.current.behavior, "salad");
  assert.deepEqual(context.saveRef.current.inventory, []);
  assert.equal(context.saveRef.current.petStats.hunger, 52);
  assert.equal(context.saveRef.current.petStats.mood, 53);
  assert.equal(context.saveRef.current.petStats.energy, 70);
  const after = structuredClone(context.saveRef.current);
  context.startFeedInteraction(fridge, "pond-weed-salad");
  assert.deepEqual(context.saveRef.current, after);
});
check("autonomous fridge feeding can select salad and never eats raw weed", () => {
  const { context, content } = makeHarness({ meals: 1 });
  const fridge = content.room.furniture.find((item) => item.id === "fridge");
  context.startFeedInteraction(fridge);
  assert.equal(context.runtimeRef.current.behavior, "salad");
  assert.equal(context.saveRef.current.furnitureStorage[0].quantity, 2);
});
check("salad uses arrival-gated meal navigation and becomes stationary at its target", () => {
  const { context, content } = makeHarness();
  const avatar = { ...context.runtimeRef.current, x: 100, y: 280 };
  const walking = simulation.setBehavior(avatar, "salad", content, 4);
  assert.equal(walking.behavior, "wander"); assert.equal(walking.actionIntent, "salad");
  const arrived = simulation.tickAvatar({ ...walking, x: walking.targetX, y: walking.targetY }, content, idle, 1 / 60);
  assert.equal(arrived.behavior, "salad"); assert.equal(arrived.facing, "front");
  const eating = simulation.tickAvatar(arrived, content, idle, 1 / 60);
  assert.equal(eating.x, arrived.x); assert.equal(eating.y, arrived.y);
});
check("cold preparation never enters the ignition, frying or shutoff audio branch", () => {
  const context = { ...cooking, activeInteraction: { kind: "cook", itemId: "pond-weed" } };
  assert.equal(evaluate(initializer("activeCookingInteraction"), context), null);
  context.activeInteraction.itemId = "raw-crucian-carp";
  assert.equal(evaluate(initializer("activeCookingInteraction"), context), context.activeInteraction);
});

console.log(`Pond weed salad smoke: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
