import type { AivatarSaveState, FurnitureStorageEntry, InventoryEntry } from "../types";

export const POND_WEED_ITEM_ID = "pond-weed";
export const POND_WEED_SALAD_ITEM_ID = "pond-weed-salad";
export const POND_WEED_SALAD_SECONDS = 6;
export const POND_WEED_SALAD_EFFECT = { hunger: 12, mood: 3 } as const;
export const COOKED_MEAL_MAX_QUANTITY = 999;

export interface CookingRecipe {
  ingredientId: string;
  resultItemId: string;
  seconds: number;
  coldPreparation: boolean;
}

const recipes: readonly CookingRecipe[] = [
  ...["crucian-carp", "bluegill", "black-bass", "yellow-perch", "weather-loach", "rainbow-trout"].map(
    (fish) => ({ ingredientId: `raw-${fish}`, resultItemId: `cooked-${fish}`, seconds: 8, coldPreparation: false }),
  ),
  { ingredientId: POND_WEED_ITEM_ID, resultItemId: POND_WEED_SALAD_ITEM_ID, seconds: POND_WEED_SALAD_SECONDS, coldPreparation: true },
];

export const cookingRecipeForIngredient = (itemId: string | undefined): CookingRecipe | undefined =>
  recipes.find((recipe) => recipe.ingredientId === itemId);

// Only ordinary, bounded integer stacks may participate in a conversion. Reject
// malformed fixtures/saves rather than manufacturing food from NaN or fractions.
const stackTotal = (entries: readonly { quantity: number }[]) => {
  if (entries.some((entry) => !Number.isSafeInteger(entry.quantity) || entry.quantity < 0)) return null;
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  return Number.isSafeInteger(total) ? total : null;
};

export const cookingIngredientQuantity = (
  storage: FurnitureStorageEntry[] | undefined,
  itemId: string,
) => stackTotal((storage ?? []).filter((entry) => entry.furnitureId === "fridge" && entry.itemId === itemId));

export const canPrepareCookingRecipe = (
  storage: FurnitureStorageEntry[] | undefined,
  inventory: InventoryEntry[],
  recipe: CookingRecipe,
) => {
  const ingredientQuantity = cookingIngredientQuantity(storage, recipe.ingredientId);
  const resultQuantity = stackTotal(inventory.filter((entry) => entry.itemId === recipe.resultItemId));
  return ingredientQuantity !== null && ingredientQuantity > 0 &&
    resultQuantity !== null && resultQuantity < COOKED_MEAL_MAX_QUANTITY;
};

export const availableCookingRecipes = (
  storage: FurnitureStorageEntry[] | undefined,
  inventory: InventoryEntry[],
) => recipes.filter((recipe) => canPrepareCookingRecipe(storage, inventory, recipe));

// An explicit request never silently changes from salad to fish (or vice versa).
export const selectCookingRecipe = (
  storage: FurnitureStorageEntry[] | undefined,
  inventory: InventoryEntry[],
  preferredIngredientId?: string,
) => availableCookingRecipes(storage, inventory).find(
  (recipe) => preferredIngredientId === undefined || recipe.ingredientId === preferredIngredientId,
);

type CookingSave = Pick<AivatarSaveState, "inventory" | "furnitureStorage">;

// The caller owns the transient interaction and clears it once. This pure update
// atomically spends one ingredient and adds one meal, so interruption before this
// point needs no refund and a full output stack cannot lose ingredients.
export const completeCookingRecipe = <T extends CookingSave>(save: T, recipe: CookingRecipe): T => {
  const canonical = cookingRecipeForIngredient(recipe.ingredientId);
  if (!canonical || canonical.resultItemId !== recipe.resultItemId ||
    !canPrepareCookingRecipe(save.furnitureStorage, save.inventory, canonical)) return save;

  let consumed = false;
  const furnitureStorage = (save.furnitureStorage ?? []).map((entry) => {
    if (consumed || entry.furnitureId !== "fridge" || entry.itemId !== canonical.ingredientId || entry.quantity <= 0) return entry;
    consumed = true;
    return { ...entry, quantity: entry.quantity - 1 };
  });
  let added = false;
  const inventory = save.inventory.map((entry) => {
    if (added || entry.itemId !== canonical.resultItemId) return entry;
    added = true;
    return { ...entry, quantity: entry.quantity + 1 };
  });
  if (!added) inventory.push({ itemId: canonical.resultItemId, quantity: 1 });
  return { ...save, furnitureStorage, inventory };
};
