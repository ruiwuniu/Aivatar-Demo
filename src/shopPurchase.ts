import type { AivatarSaveState, ItemDefinition } from "./types";

export const SHOP_BULK_PURCHASE_QUANTITY = 10;
export const SHOP_LONG_PRESS_MS = 550;
export const SHOP_LONG_PRESS_CLICK_SUPPRESSION_MS = 750;
export const SHOP_PURCHASE_COOLDOWN_MS = 160;

type IdCollection = ReadonlySet<string> | readonly string[];

export type ShopPurchaseOptions = {
  growthLevel?: number;
  uniqueItemIds?: IdCollection;
  unlockLevelsByItemId?: Readonly<Record<string, number>>;
};

export type ShopPurchaseCooldowns = Readonly<Record<string, number>>;

const isReadonlySet = (collection: IdCollection): collection is ReadonlySet<string> =>
  typeof (collection as ReadonlySet<string>).has === "function";

const collectionHas = (collection: IdCollection | undefined, id: string) =>
  collection ? (isReadonlySet(collection) ? collection.has(id) : collection.includes(id)) : false;

export const isWallSurfaceItem = (item: ItemDefinition) =>
  item.tags?.includes("wall-surface") ?? false;

export const isFloorSurfaceItem = (item: ItemDefinition) =>
  item.tags?.includes("floor-surface") ?? false;

export const isSurfaceItem = (item: ItemDefinition) =>
  isWallSurfaceItem(item) || isFloorSurfaceItem(item);

export const isWindowItem = (item: ItemDefinition) => item.kind === "window";

export const isFurnitureSkinItem = (item: ItemDefinition) =>
  item.tags?.includes("furniture-skin") ?? false;

export const getShopItemUnlockLevel = (
  item: ItemDefinition,
  options: Pick<ShopPurchaseOptions, "unlockLevelsByItemId"> = {},
) => item.unlockLevel ?? options.unlockLevelsByItemId?.[item.id] ?? 0;

export const isUniqueShopItemOwned = (
  save: Pick<AivatarSaveState, "inventory" | "placedItems" | "purchasedItemIds">,
  item: ItemDefinition,
  options: Pick<ShopPurchaseOptions, "uniqueItemIds"> = {},
) => {
  if (collectionHas(options.uniqueItemIds, item.id)) {
    return (
      save.inventory.some((entry) => entry.itemId === item.id && entry.quantity > 0) ||
      save.placedItems.some((placedItem) => placedItem.itemId === item.id)
    );
  }
  return item.tags?.includes("one-time")
    ? save.purchasedItemIds.includes(item.id)
    : false;
};

export const isBulkPurchasableShopItem = (
  item: ItemDefinition,
  options: Pick<ShopPurchaseOptions, "uniqueItemIds"> = {},
) =>
  !isWindowItem(item) &&
  !isFurnitureSkinItem(item) &&
  !isSurfaceItem(item) &&
  !collectionHas(options.uniqueItemIds, item.id) &&
  !item.tags?.includes("one-time");

export const affordableShopPurchaseQuantity = (
  save: Pick<
    AivatarSaveState,
    "inventory" | "placedItems" | "purchasedItemIds" | "wallet"
  >,
  item: ItemDefinition,
  requestedQuantity: number,
  options: ShopPurchaseOptions = {},
) => {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return 0;
  if (isUniqueShopItemOwned(save, item, options)) return 0;
  if ((options.growthLevel ?? 0) < getShopItemUnlockLevel(item, options)) return 0;

  const normalizedQuantity = Math.max(1, Math.floor(requestedQuantity));
  if (item.price <= 0) return normalizedQuantity;
  if (save.wallet.bits < item.price) return 0;
  return Math.min(normalizedQuantity, Math.floor(save.wallet.bits / item.price));
};

export const reserveShopPurchaseSlot = (
  cooldowns: ShopPurchaseCooldowns,
  itemId: string,
  now: number,
  cooldownMs = SHOP_PURCHASE_COOLDOWN_MS,
) => {
  const lockedUntil = cooldowns[itemId] ?? 0;
  if (lockedUntil > now) {
    return { reserved: false, cooldowns };
  }
  return {
    reserved: true,
    cooldowns: {
      ...cooldowns,
      [itemId]: now + cooldownMs,
    },
  };
};
