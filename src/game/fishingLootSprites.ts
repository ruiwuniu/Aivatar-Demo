// Imagegen originals remain untouched. Source rectangles omit transparent padding.
const LOOT_SPRITES = {
  "fishing-trophy-bronze": { file: "bronze-fish", source: [220, 410, 679, 673], width: 28, height: 28 },
  "fishing-trophy-silver": { file: "silver-wave", source: [253, 160, 681, 1051], width: 24, height: 37 },
  "fishing-trophy-gold": { file: "golden-koi", source: [278, 76, 634, 1231], width: 22, height: 43 },
  "fishing-trophy-crystal": { file: "starlight-crystal", source: [329, 102, 464, 1196], width: 18, height: 46 },
  "pond-weed": { file: "pond-weed", source: [228, 206, 693, 1047], width: 22, height: 33 },
} as const;

type SpriteId = keyof typeof LOOT_SPRITES;
const sprites = new Map<string, HTMLImageElement>();
export const isFishingLootSprite = (itemId: string): itemId is SpriteId =>
  Object.prototype.hasOwnProperty.call(LOOT_SPRITES, itemId);

export const fishingLootIconPath = (itemId: string): string | undefined => {
  const file = itemId === "pond-weed-salad" ? "pond-weed-salad"
    : isFishingLootSprite(itemId) ? LOOT_SPRITES[itemId].file : undefined;
  return file ? `/icons/fishing-loot/${file}.png` : undefined;
};

export const fishingLootVisualBounds = (item: { itemId: string; x: number; y: number }) => {
  const sprite = isFishingLootSprite(item.itemId) ? LOOT_SPRITES[item.itemId] : undefined;
  const width = sprite?.width ?? 28;
  const height = sprite?.height ?? 28;
  return { x: item.x - width / 2, y: item.y + 4 - height, width, height };
};

export const drawFishingLootSprite = (
  ctx: CanvasRenderingContext2D,
  itemId: string,
  x: number,
  y: number,
  options: { height?: number; ghost?: "none" | "valid" | "invalid" } = {},
): boolean => {
  if (!isFishingLootSprite(itemId)) return false;
  const definition = LOOT_SPRITES[itemId];
  let sprite = sprites.get(itemId);
  if (!sprite && typeof Image !== "undefined") {
    sprite = new Image();
    sprite.src = `/assets/fishing-loot/${definition.file}.png`;
    sprites.set(itemId, sprite);
  }
  if (!sprite?.complete || !sprite.naturalWidth) return true;
  const height = Math.max(1, Math.round(options.height ?? definition.height));
  const width = Math.max(1, Math.round(definition.width * height / definition.height));
  const [sx, sy, sw, sh] = definition.source;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (options.ghost && options.ghost !== "none") ctx.globalAlpha *= 0.55;
  ctx.drawImage(sprite, sx, sy, sw, sh, Math.round(x - width / 2), Math.round(y + 4 - height), width, height);
  if (options.ghost === "invalid") {
    ctx.strokeStyle = "#ed7468";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x - width / 2), Math.round(y + 4 - height), width, height);
  }
  ctx.restore();
  return true;
};
