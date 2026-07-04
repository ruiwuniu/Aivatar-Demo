import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = process.cwd();
const sourcePath = path.join(repoRoot, "src", "shopPurchase.ts");
const source = await fs.readFile(sourcePath, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText;

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aivatar-shop-purchase-"));
const modulePath = path.join(tempDir, "shopPurchase.mjs");
await fs.writeFile(modulePath, output, "utf8");

const {
  SHOP_BULK_PURCHASE_QUANTITY,
  SHOP_LONG_PRESS_CLICK_SUPPRESSION_MS,
  SHOP_PURCHASE_COOLDOWN_MS,
  affordableShopPurchaseQuantity,
  isBulkPurchasableShopItem,
  reserveShopPurchaseSlot,
} = await import(pathToFileURL(modulePath).href);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const baseSave = {
  inventory: [],
  placedItems: [],
  purchasedItemIds: [],
  wallet: { bits: 120 },
};

const uniqueItemIds = ["file-cabinet"];
const unlockLevelsByItemId = { "file-cabinet": 25 };
const shopOptions = { growthLevel: 30, uniqueItemIds, unlockLevelsByItemId };
const cookie = {
  id: "cookie",
  name: "Cookie",
  kind: "food",
  price: 6,
  tags: ["item", "consumable"],
};
const windowItem = { id: "city-window", name: "City Window", kind: "window", price: 90 };
const furnitureSkin = {
  id: "white-fridge-skin",
  name: "White Fridge Skin",
  kind: "decor",
  price: 80,
  tags: ["furniture-skin"],
};
const wallSurface = {
  id: "gray-wall",
  name: "Gray Wall",
  kind: "decor",
  price: 50,
  tags: ["wall-surface"],
};
const taskCabinet = {
  id: "file-cabinet",
  name: "Task Cabinet",
  kind: "furniture",
  price: 500,
  tags: ["furniture"],
};
const oneTime = {
  id: "starter-license",
  name: "Starter License",
  kind: "tool",
  price: 40,
  tags: ["one-time"],
};

const applyInventoryPurchase = (save, item, requestedQuantity, options = shopOptions) => {
  const quantity = affordableShopPurchaseQuantity(save, item, requestedQuantity, options);
  if (quantity <= 0) return { save, quantity };
  const existing = save.inventory.find((entry) => entry.itemId === item.id);
  const inventory = existing
    ? save.inventory.map((entry) =>
        entry.itemId === item.id
          ? { ...entry, quantity: entry.quantity + quantity }
          : entry,
      )
    : [...save.inventory, { itemId: item.id, quantity }];
  return {
    save: {
      ...save,
      wallet: { bits: save.wallet.bits - item.price * quantity },
      inventory,
      purchasedItemIds: Array.from(new Set([...save.purchasedItemIds, item.id])),
    },
    quantity,
  };
};

assert(isBulkPurchasableShopItem(cookie, { uniqueItemIds }), "cookie should be bulk purchasable");
assert(!isBulkPurchasableShopItem(windowItem, { uniqueItemIds }), "windows should not bulk purchase");
assert(!isBulkPurchasableShopItem(furnitureSkin, { uniqueItemIds }), "skins should not bulk purchase");
assert(!isBulkPurchasableShopItem(wallSurface, { uniqueItemIds }), "surfaces should not bulk purchase");
assert(!isBulkPurchasableShopItem(taskCabinet, { uniqueItemIds }), "unique furniture should not bulk purchase");
assert(!isBulkPurchasableShopItem(oneTime, { uniqueItemIds }), "one-time items should not bulk purchase");

assert(
  affordableShopPurchaseQuantity(baseSave, cookie, SHOP_BULK_PURCHASE_QUANTITY, shopOptions) ===
    SHOP_BULK_PURCHASE_QUANTITY,
  "bulk purchase should buy requested quantity when affordable",
);
assert(
  affordableShopPurchaseQuantity(
    { ...baseSave, wallet: { bits: 25 } },
    cookie,
    SHOP_BULK_PURCHASE_QUANTITY,
    shopOptions,
  ) === 4,
  "bulk purchase should clamp to affordable quantity",
);
assert(
  affordableShopPurchaseQuantity(baseSave, taskCabinet, 1, {
    growthLevel: 24,
    uniqueItemIds,
    unlockLevelsByItemId,
  }) === 0,
  "locked unique furniture should not be affordable below unlock level",
);
assert(
  affordableShopPurchaseQuantity(
    { ...baseSave, inventory: [{ itemId: "file-cabinet", quantity: 1 }] },
    taskCabinet,
    1,
    shopOptions,
  ) === 0,
  "owned unique furniture should not be affordable",
);

let cooldowns = {};
let save = { ...baseSave };
let acceptedClicks = 0;
for (let index = 0; index < 12; index += 1) {
  const reservation = reserveShopPurchaseSlot(
    cooldowns,
    cookie.id,
    100 + index * 10,
    SHOP_PURCHASE_COOLDOWN_MS,
  );
  cooldowns = reservation.cooldowns;
  if (!reservation.reserved) continue;
  const result = applyInventoryPurchase(save, cookie, 1);
  save = result.save;
  acceptedClicks += result.quantity > 0 ? 1 : 0;
}
assert(acceptedClicks === 1, "rapid clicks inside cooldown should accept one purchase");
assert(save.inventory.find((entry) => entry.itemId === cookie.id)?.quantity === 1, "rapid click quantity mismatch");
assert(save.wallet.bits === 114, "rapid click wallet mismatch");

const bulk = applyInventoryPurchase(save, cookie, SHOP_BULK_PURCHASE_QUANTITY);
assert(bulk.quantity === SHOP_BULK_PURCHASE_QUANTITY, "long press should buy ten when affordable");
assert(
  bulk.save.inventory.find((entry) => entry.itemId === cookie.id)?.quantity === 11,
  "long press inventory quantity mismatch",
);
assert(bulk.save.wallet.bits === 54, "long press wallet mismatch");
assert(
  SHOP_LONG_PRESS_CLICK_SUPPRESSION_MS > SHOP_PURCHASE_COOLDOWN_MS,
  "long-press click suppression window should outlast the ordinary purchase cooldown",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      rapidClickAccepted: acceptedClicks,
      longPressQuantity: bulk.quantity,
      remainingBits: bulk.save.wallet.bits,
    },
    null,
    2,
  ),
);
