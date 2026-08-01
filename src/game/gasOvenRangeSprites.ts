import type { PlacedItem } from "../types";

export const GAS_OVEN_RANGE_ITEM_ID = "gas-oven-range";

export type GasOvenRangeDirection = "down" | "left" | "up" | "right";

export interface GasOvenRangeSpriteDefinition {
  direction: GasOvenRangeDirection;
  source: string;
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  burnerCenters: readonly { x: number; y: number }[];
  activeBurnerIndex: number;
}

export interface GasOvenRangeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FRONT_BACK_WIDTH = 43;
const FRONT_BACK_HEIGHT = 73;
const SIDE_WIDTH = 36;
const SIDE_HEIGHT = 78;
const FRONT_BACK_FOOT_DEPTH = 36;
const SIDE_FOOT_DEPTH = 43;

const FRONT_BACK_BURNERS = [
  { x: 12, y: 9 },
  { x: 31, y: 9 },
  { x: 12, y: 24 },
  { x: 31, y: 24 },
] as const;

const SIDE_RIGHT_BURNERS = [
  { x: 9, y: 10 },
  { x: 27, y: 10 },
  { x: 9, y: 27 },
  { x: 27, y: 27 },
] as const;

const SIDE_LEFT_BURNERS = SIDE_RIGHT_BURNERS.map(({ x, y }) => ({
  x: SIDE_WIDTH - 1 - x,
  y,
}));

export const GAS_OVEN_RANGE_SPRITES: Record<
  GasOvenRangeDirection,
  GasOvenRangeSpriteDefinition
> = {
  down: {
    direction: "down",
    source: "/assets/furniture/gas-oven-range/front.png",
    width: FRONT_BACK_WIDTH,
    height: FRONT_BACK_HEIGHT,
    xOffset: -21,
    yOffset: -73,
    burnerCenters: FRONT_BACK_BURNERS,
    activeBurnerIndex: 2,
  },
  left: {
    direction: "left",
    source: "/assets/furniture/gas-oven-range/side-left.png",
    width: SIDE_WIDTH,
    height: SIDE_HEIGHT,
    xOffset: -18,
    yOffset: -78,
    burnerCenters: SIDE_LEFT_BURNERS,
    activeBurnerIndex: 2,
  },
  up: {
    direction: "up",
    source: "/assets/furniture/gas-oven-range/back.png",
    width: FRONT_BACK_WIDTH,
    height: FRONT_BACK_HEIGHT,
    xOffset: -21,
    yOffset: -73,
    burnerCenters: FRONT_BACK_BURNERS,
    activeBurnerIndex: 0,
  },
  right: {
    direction: "right",
    source: "/assets/furniture/gas-oven-range/side-right.png",
    width: SIDE_WIDTH,
    height: SIDE_HEIGHT,
    xOffset: -18,
    yOffset: -78,
    burnerCenters: SIDE_RIGHT_BURNERS,
    activeBurnerIndex: 3,
  },
};

export const normalizeGasOvenRangeRotation = (rotation = 0) => {
  const quarterTurns = Math.round(rotation / 90);
  return ((quarterTurns % 4) + 4) % 4;
};

export const gasOvenRangeDirection = (
  rotation = 0,
): GasOvenRangeDirection =>
  (["down", "left", "up", "right"] as const)[
    normalizeGasOvenRangeRotation(rotation)
  ];

export const gasOvenRangeSprite = (rotation = 0) =>
  GAS_OVEN_RANGE_SPRITES[gasOvenRangeDirection(rotation)];

export const gasOvenRangeVisualBounds = (
  item: Pick<PlacedItem, "x" | "y" | "rotation">,
): GasOvenRangeRect => {
  const sprite = gasOvenRangeSprite(item.rotation);
  return {
    x: item.x + sprite.xOffset,
    y: item.y + sprite.yOffset,
    width: sprite.width,
    height: sprite.height,
  };
};

export const gasOvenRangeFootBounds = (
  item: Pick<PlacedItem, "x" | "y" | "rotation">,
): GasOvenRangeRect => {
  const direction = gasOvenRangeDirection(item.rotation);
  const sideFacing = direction === "left" || direction === "right";
  const width = sideFacing ? SIDE_WIDTH : FRONT_BACK_WIDTH;
  const height = sideFacing ? SIDE_FOOT_DEPTH : FRONT_BACK_FOOT_DEPTH;

  return {
    x: Math.round(item.x - width / 2),
    y: Math.round(item.y - height),
    width,
    height,
  };
};

export const gasOvenRangeInteractionPoint = (
  item: Pick<PlacedItem, "x" | "y" | "rotation">,
) => {
  const direction = gasOvenRangeDirection(item.rotation);
  const foot = gasOvenRangeFootBounds(item);
  const centerX = foot.x + foot.width / 2;
  const centerY = foot.y + foot.height / 2;

  switch (direction) {
    case "up":
      return { x: centerX, y: foot.y - 15 };
    case "left":
      return { x: foot.x - 8, y: centerY };
    case "right":
      return { x: foot.x + foot.width + 8, y: centerY };
    case "down":
    default:
      return { x: centerX, y: foot.y + foot.height + 2 };
  }
};

export const gasOvenRangeCookingFacing = (
  rotation = 0,
): "front" | "back" | "left" | "right" => {
  switch (gasOvenRangeDirection(rotation)) {
    case "up":
      return "front";
    case "left":
      return "right";
    case "right":
      return "left";
    case "down":
    default:
      return "back";
  }
};
