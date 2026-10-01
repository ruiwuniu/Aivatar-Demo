import type { AivatarSaveState, InventoryEntry } from "../types";
import { isFishingTrophy } from "../park/parkLoot";

// Resetting the room is a move into storage, never an implicit trophy sale.
export const recoverFishingTrophiesOnLayoutReset = (
  save: Pick<AivatarSaveState, "inventory" | "placedItems">,
): InventoryEntry[] => {
  let inventory = save.inventory;
  for (const placed of save.placedItems) {
    if (!isFishingTrophy(placed.itemId)) continue;
    if (inventory.some((entry) => entry.itemId === placed.itemId && entry.quantity > 0)) continue;
    inventory = [...inventory.filter((entry) => entry.itemId !== placed.itemId), { itemId: placed.itemId, quantity: 1 }];
  }
  return inventory;
};
