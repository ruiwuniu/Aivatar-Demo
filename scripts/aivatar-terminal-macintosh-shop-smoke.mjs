import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Run source functions against synthetic data, without opening real saves.
const root = fileURLToPath(new URL("../", import.meta.url));
const source = (relative) => readFileSync(path.join(root, relative), "utf8");
const transpile = (text, fileName = "fixture.ts") => ts.transpileModule(text, {
  fileName, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const load = (relative) => {
  const module = { exports: {} };
  new Function("require", "module", "exports", transpile(source(relative), relative))(
    (specifier) => {
      assert.equal(specifier, "./persistence/saveStore", "Unexpected runtime dependency");
      return { appStorage: new Proxy({}, { get() { throw new Error("Test must not access storage"); } }) };
    }, module, module.exports,
  );
  return module.exports;
};
const { defaultContent } = load("src/data/defaultContent.ts");
const config = JSON.parse(source("public/config/aivatar.config.json"));
const shop = load("src/shopPurchase.ts");
const i18n = load("src/i18n.ts");
const macintosh = load("src/game/macintoshTerminal.ts");
const skinFixtures = [
  { id: "terminal-macintosh-skin", name: "Macintosh Terminal Skin", hans: "麦金塔终端皮肤", hant: "麥金塔終端外觀" },
  { id: "terminal-macintosh-forest-orange-skin", name: "Forest Green Macintosh Terminal Skin", hans: "墨绿麦金塔终端皮肤", hant: "墨綠麥金塔終端外觀" },
  { id: "terminal-macintosh-orange-green-skin", name: "Orange Macintosh Terminal Skin", hans: "橙色麦金塔终端皮肤", hant: "橙色麥金塔終端外觀" },
];
const expectedSkin = ({ id, name }) => ({
  id, name, kind: "decor",
  tags: ["furniture-skin", "computer"], targetFurnitureId: "builtin-terminal",
  price: 2600, effect: { mood: 4, energy: 2 },
});
for (const fixture of skinFixtures) {
  const itemId = fixture.id;
  const expected = expectedSkin(fixture);
  for (const content of [defaultContent, config]) {
    for (const entries of [content.itemDefinitions, content.shop.items]) {
      const matches = entries.filter((item) => item.id === itemId);
      assert.equal(matches.length, 1, "each runtime/fallback collection contains exactly one new skin");
      assert.deepEqual(matches[0], expected);
    }
  }
  assert.equal(shop.isFurnitureSkinItem(expected), true);
  assert.equal(shop.isBulkPurchasableShopItem(expected), false, "skin cannot be bulk-purchased as inventory");
  for (const [locale, name] of [["en", expected.name], ["zh-Hans", fixture.hans], ["zh-Hant", fixture.hant]]) {
    const localized = i18n.localizeContent(config, locale);
    assert.equal(localized.itemDefinitions.find((item) => item.id === itemId).name, name);
    assert.equal(localized.shop.items.find((item) => item.id === itemId).name, name);
  }
}

const appText = source("src/App.tsx");
const appAst = ts.createSourceFile("src/App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializer = (name) => {
  const found = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === name && node.initializer) found.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(appAst);
  assert.equal(found.length, 1, `Expected one production declaration: ${name}`);
  return found[0].getText(appAst);
};
const bind = (name, context) => {
  context[name] = new Function(...Object.keys(context),
    `${transpile(`const result = (${initializer(name)});`)}\nreturn result;`,
  )(...Object.values(context));
  return context[name];
};
const makeHarness = (bits = 2600) => {
  const content = structuredClone(config);
  content.placedItems = [{ id: "builtin-terminal", itemId: "terminal-monitor", x: 200, y: 170 }];
  const events = [];
  const context = {
    ...shop, contentRef: { current: content },
    saveRef: { current: {
      wallet: { bits, pokerChips: 25 }, purchasedItemIds: [],
      activeFurnitureSkinIds: { bed: "industrial-bed-skin" },
      inventory: [{ itemId: "cookie", quantity: 3 }], petStats: { mood: 50, energy: 40, hunger: 60 },
      memory: { recentEvents: [] },
    } },
    reserveShopPurchaseSlot: () => true,
    recordLifeMemory: (memory, event, traits) => {
      events.push({ event, traits });
      return { ...memory, recentEvents: [...memory.recentEvents, event] };
    },
    ui: (key) => key, performance: { now: () => 1000 }, updateActiveInteraction() {},
    getItemPlacementKind: () => { throw new Error("Furniture skin must route before placement"); },
  };
  context.setSave = (update) => { context.saveRef.current = update(context.saveRef.current); };
  for (const name of ["findItemDefinition", "skinTargetFromContent", "traitChangesForPurchase",
    "getShopCategoryId", "normalizeFurnitureSkinIds", "buyOrApplyFurnitureSkin", "clearAppliedFurnitureSkin"]) bind(name, context);
  return { context, events, get save() { return context.saveRef.current; } };
};
for (const fixture of skinFixtures) {
  const itemId = fixture.id;
  const expected = expectedSkin(fixture);
  {
    const h = makeHarness();
    const inventory = h.save.inventory;
    const stats = h.save.petStats;
    assert.equal(h.context.getShopCategoryId(expected), "furniture-skins");
    h.context.buyOrApplyFurnitureSkin(expected);
    assert.deepEqual(h.save.wallet, { bits: 0, pokerChips: 25 }, "first purchase charges exactly 2600 bits");
    assert.equal(h.save.activeFurnitureSkinIds["builtin-terminal"], itemId);
    assert.equal(h.save.activeFurnitureSkinIds.bed, "industrial-bed-skin");
    assert.deepEqual(h.save.purchasedItemIds, [itemId]);
    assert.equal(h.save.inventory, inventory, "skin goes directly onto the terminal");
    assert.equal(h.save.petStats, stats, "cosmetic equip preserves existing skin semantics");
    assert.equal(h.events.length, 1);
    h.context.buyOrApplyFurnitureSkin(expected);
    assert.equal(h.events.length, 1, "clicking the applied skin cannot charge again");
    h.context.clearAppliedFurnitureSkin(expected);
    assert.equal(h.save.activeFurnitureSkinIds["builtin-terminal"], undefined);
    assert.deepEqual(h.save.purchasedItemIds, [itemId], "unequip retains ownership");
    h.context.buyOrApplyFurnitureSkin(expected);
    assert.equal(h.save.wallet.bits, 0, "owned skin can be reapplied with zero bits");
    assert.equal(h.events.length, 1, "reapplying cannot farm purchase memory");
    const roundTrip = JSON.parse(JSON.stringify(h.save));
    assert.deepEqual(h.context.normalizeFurnitureSkinIds(roundTrip.activeFurnitureSkinIds), h.save.activeFurnitureSkinIds,
      "existing save normalization preserves the new skin mapping");
  }
  {
    const h = makeHarness(2599);
    const before = h.save;
    h.context.buyOrApplyFurnitureSkin(expected);
    assert.equal(h.save, before, "insufficient funds leave the save untouched");
    assert.equal(h.events.length, 0);
  }
  {
    const h = makeHarness(4000);
    h.context.contentRef.current.placedItems = [];
    const before = h.save;
    h.context.buyOrApplyFurnitureSkin(expected);
    assert.equal(h.save, before, "missing terminal cannot consume currency");
  }
}

// Independently purchased variants keep separate ownership while sharing a target.
{
  const h = makeHarness(2600 * skinFixtures.length);
  for (const fixture of skinFixtures) h.context.buyOrApplyFurnitureSkin(expectedSkin(fixture));
  assert.equal(h.save.wallet.bits, 0);
  assert.deepEqual(h.save.purchasedItemIds, skinFixtures.map(({ id }) => id));
  assert.equal(h.save.activeFurnitureSkinIds["builtin-terminal"], skinFixtures.at(-1).id);
  h.context.buyOrApplyFurnitureSkin(expectedSkin(skinFixtures[0]));
  assert.equal(h.save.wallet.bits, 0, "switching back to an owned original variant is free");
  assert.equal(h.save.activeFurnitureSkinIds["builtin-terminal"], skinFixtures[0].id);
}

// Exercise both App render paths' actual moving-item preview objects.
const movingPreviews = [];
const findMovingPreviews = (node) => {
  if (ts.isObjectLiteralExpression(node) && node.properties.some((property) =>
    ts.isPropertyAssignment(property) && property.name.getText(appAst) === "rotation"
    && /^movingPlacedItem(?:Ref)?\./.test(property.initializer.getText(appAst)))) movingPreviews.push(node);
  ts.forEachChild(node, findMovingPreviews);
};
findMovingPreviews(appAst);
assert.equal(movingPreviews.length, 2, "check the React and animation-frame preview paths");
for (const skinId of [...skinFixtures.map(({ id }) => id), "terminal-green-amber-skin", undefined]) {
  const moving = { id: "builtin-terminal", itemId: "terminal-monitor", rotation: 0, skinId };
  const preview = { x: 245, y: 185, valid: true };
  const context = {
    content: config, currentContent: config,
    movingPlacedItem: moving, movingPlacedItemRef: { current: moving },
    placementPreview: preview, placementPreviewRef: { current: preview },
    isMacintoshTerminalSkin: macintosh.isMacintoshTerminalSkin,
  };
  for (const node of movingPreviews) {
    const actual = new Function(...Object.keys(context),
      `${transpile(`const result = (${node.getText(appAst)});`)}\nreturn result;`,
    )(...Object.values(context));
    assert.equal(actual.skinId, skinFixtures.some(({ id }) => id === skinId) ? skinId : undefined,
      "Macintosh previews retain their skin without changing other skin preview behavior");
    assert.equal(actual.item.id, "terminal-monitor");
    assert.deepEqual({ x: actual.x, y: actual.y, valid: actual.valid }, preview);
  }
}
console.log("Macintosh terminal shop smoke passed: all color variants, matching definitions, localized names, independent ownership/free re-equip, save compatibility, failure guards, and both moving-preview skin paths.");
