import type {
  AivatarContent,
  FurnitureDefinition,
  ItemDefinition,
  PetStats,
  RoomSurfaceDefinition,
  RoomWindowDefinition,
} from "../types";

export const cardRoomDefaultPetStats: PetStats = {
  energy: 86,
  mood: 76,
  hunger: 82,
};

export type CardRoomDecorCategory = "wall" | "floor" | "window" | "furniture";

export interface CardRoomShopItem extends ItemDefinition {
  cardRoomCategory: CardRoomDecorCategory;
  description: string;
  targetSurfaceId?: string;
  targetWindowId?: string;
  targetFurnitureId?: string;
}

export interface CardRoomDecorState {
  purchasedItemIds: string[];
  wallSurfaceId: string;
  floorSurfaceId: string;
  windowId: string;
  furnitureItemIds: string[];
}

export const CARD_ROOM_DEFAULT_WALL_SURFACE_ID = "card-room-wall";
export const CARD_ROOM_DEFAULT_FLOOR_SURFACE_ID = "card-room-floor";
export const CARD_ROOM_DEFAULT_WINDOW_ID = "card-room-window";
export const CARD_ROOM_DECOR_STORAGE_KEY = "aivatar.cardRoom.decor.v1";

export const cardRoomDefaultDecorState: CardRoomDecorState = {
  purchasedItemIds: [
    "cr-wall-default",
    "cr-floor-default",
    "cr-window-default",
  ],
  wallSurfaceId: CARD_ROOM_DEFAULT_WALL_SURFACE_ID,
  floorSurfaceId: CARD_ROOM_DEFAULT_FLOOR_SURFACE_ID,
  windowId: CARD_ROOM_DEFAULT_WINDOW_ID,
  furnitureItemIds: [],
};

const cardRoomWallSurfaces: RoomSurfaceDefinition[] = [
  {
    id: CARD_ROOM_DEFAULT_WALL_SURFACE_ID,
    name: "Card Room Panel Wall",
    palette: {
      base: "#2d1812",
      border: "#140b09",
      plankA: "#3a2018",
      plankB: "#43261c",
      plankC: "#26130f",
      plankD: "#5b3525",
      seam: "#1b0d0a",
      highlight: "#8a5636",
      grainDark: "#160907",
      grainLight: "#70442e",
    },
  },
  {
    id: "card-room-green-felt-wall",
    name: "Green Felt Wall",
    palette: {
      base: "#102e24",
      border: "#071714",
      plankA: "#164033",
      plankB: "#1d4f40",
      plankC: "#0b241e",
      plankD: "#28624f",
      seam: "#061512",
      highlight: "#6ee7b7",
      grainDark: "#05201a",
      grainLight: "#34d399",
    },
  },
  {
    id: "card-room-burgundy-wall",
    name: "Burgundy Velvet Wall",
    palette: {
      base: "#3b111c",
      border: "#16060a",
      plankA: "#521628",
      plankB: "#611b30",
      plankC: "#280b13",
      plankD: "#7a253d",
      seam: "#1c0710",
      highlight: "#f0abfc",
      grainDark: "#260711",
      grainLight: "#fb7185",
    },
  },
];

const cardRoomFloorSurfaces: RoomSurfaceDefinition[] = [
  {
    id: CARD_ROOM_DEFAULT_FLOOR_SURFACE_ID,
    name: "Card Room Walnut Floor",
    palette: {
      base: "#2b1712",
      border: "#130b0a",
      plankA: "#3b2119",
      plankB: "#4a2a1f",
      plankC: "#24130f",
      plankD: "#5a3426",
      seam: "#1a0e0b",
      highlight: "#7c4a31",
      grainDark: "#190c09",
      grainLight: "#6d4431",
    },
  },
  {
    id: "card-room-checker-floor",
    name: "Black Marble Checker Floor",
    palette: {
      base: "#111827",
      border: "#030712",
      plankA: "#1f2937",
      plankB: "#e5e7eb",
      plankC: "#020617",
      plankD: "#94a3b8",
      seam: "#0f172a",
      highlight: "#f8fafc",
      grainDark: "#020617",
      grainLight: "#cbd5e1",
    },
  },
  {
    id: "card-room-emerald-carpet-floor",
    name: "Emerald Poker Carpet",
    palette: {
      base: "#052e2b",
      border: "#021817",
      plankA: "#064e45",
      plankB: "#0f766e",
      plankC: "#042f2e",
      plankD: "#14b8a6",
      seam: "#03201f",
      highlight: "#99f6e4",
      grainDark: "#04201f",
      grainLight: "#5eead4",
    },
  },
];

const cardRoomWindows: RoomWindowDefinition[] = [
  {
    id: CARD_ROOM_DEFAULT_WINDOW_ID,
    name: "Card Room City Window",
    kind: "city-night-window",
    x: 264,
    y: 2,
    width: 432,
    height: 96,
  },
  {
    id: "card-room-neon-window",
    name: "Neon Casino Window",
    kind: "city-night-window",
    x: 264,
    y: 2,
    width: 432,
    height: 96,
  },
  {
    id: "card-room-private-window",
    name: "Private Lounge Window",
    kind: "cozy-window",
    x: 264,
    y: 2,
    width: 432,
    height: 96,
  },
];

const pokerTableFurniture: FurnitureDefinition = {
  id: "poker-table",
  name: "Poker Table",
  tags: ["furniture", "table"],
  placementSurfaces: ["floor"],
  zone: "kitchen",
  x: 160,
  y: 320,
  width: 640,
  height: 220,
  color: "#0f766e",
  interaction: "interact",
  collision: { x: 160, y: 320, width: 640, height: 220 },
};

const cardRoomFurnitureByShopItemId: Record<string, FurnitureDefinition> = {
  "cr-furniture-chip-cabinet": {
    id: "card-room-chip-cabinet",
    name: "Chip Cabinet",
    tags: ["furniture"],
    placementSurfaces: ["floor"],
    zone: "office",
    x: 54,
    y: 244,
    width: 104,
    height: 86,
    color: "#713f12",
    interaction: "admire",
    collision: { x: 62, y: 294, width: 88, height: 28 },
  },
  "cr-furniture-card-shelf": {
    id: "card-room-card-shelf",
    name: "Card Shelf",
    tags: ["furniture", "hanging"],
    placementSurfaces: ["wall"],
    zone: "office",
    x: 326,
    y: 86,
    width: 300,
    height: 70,
    color: "#4b2a1f",
    interaction: "admire",
  },
  "cr-furniture-floor-lamp": {
    id: "card-room-floor-lamp",
    name: "Amber Floor Lamp",
    tags: ["furniture", "lamp"],
    placementSurfaces: ["floor"],
    zone: "office",
    x: 840,
    y: 222,
    width: 52,
    height: 118,
    color: "#f59e0b",
    interaction: "admire",
    collision: { x: 850, y: 305, width: 28, height: 22 },
  },
  "cr-furniture-sideboard": {
    id: "card-room-sideboard",
    name: "Dealer Sideboard",
    tags: ["furniture"],
    placementSurfaces: ["floor"],
    zone: "office",
    x: 774,
    y: 266,
    width: 120,
    height: 72,
    color: "#5b3525",
    interaction: "admire",
    collision: { x: 782, y: 306, width: 104, height: 30 },
  },
};

export const cardRoomShopItems: CardRoomShopItem[] = [
  {
    id: "cr-wall-default",
    name: "Panel Wall",
    kind: "decor",
    tags: ["wall-surface"],
    price: 0,
    cardRoomCategory: "wall",
    targetSurfaceId: CARD_ROOM_DEFAULT_WALL_SURFACE_ID,
    description: "Original dark wood card-room wall.",
  },
  {
    id: "cr-wall-green-felt",
    name: "Green Felt Wall",
    kind: "decor",
    tags: ["wall-surface"],
    price: 8,
    cardRoomCategory: "wall",
    targetSurfaceId: "card-room-green-felt-wall",
    description: "Muted casino felt panels for a quieter poker room.",
  },
  {
    id: "cr-wall-burgundy",
    name: "Burgundy Velvet Wall",
    kind: "decor",
    tags: ["wall-surface"],
    price: 12,
    cardRoomCategory: "wall",
    targetSurfaceId: "card-room-burgundy-wall",
    description: "Deep red velvet panels with gold room highlights.",
  },
  {
    id: "cr-floor-default",
    name: "Walnut Floor",
    kind: "decor",
    tags: ["floor-surface"],
    price: 0,
    cardRoomCategory: "floor",
    targetSurfaceId: CARD_ROOM_DEFAULT_FLOOR_SURFACE_ID,
    description: "Original wide walnut floor.",
  },
  {
    id: "cr-floor-checker",
    name: "Black Marble Checker Floor",
    kind: "decor",
    tags: ["floor-surface"],
    price: 10,
    cardRoomCategory: "floor",
    targetSurfaceId: "card-room-checker-floor",
    description: "High-contrast black marble checker flooring.",
  },
  {
    id: "cr-floor-emerald-carpet",
    name: "Emerald Poker Carpet",
    kind: "decor",
    tags: ["floor-surface"],
    price: 14,
    cardRoomCategory: "floor",
    targetSurfaceId: "card-room-emerald-carpet-floor",
    description: "Emerald carpet with subtle card-table stripes.",
  },
  {
    id: "cr-window-default",
    name: "City Window",
    kind: "window",
    tags: ["window"],
    price: 0,
    cardRoomCategory: "window",
    targetWindowId: CARD_ROOM_DEFAULT_WINDOW_ID,
    description: "The original wide city-view window.",
  },
  {
    id: "cr-window-neon",
    name: "Neon Casino Window",
    kind: "window",
    tags: ["window"],
    price: 12,
    cardRoomCategory: "window",
    targetWindowId: "card-room-neon-window",
    description: "A bright street-facing neon casino window.",
  },
  {
    id: "cr-window-private",
    name: "Private Lounge Window",
    kind: "window",
    tags: ["window"],
    price: 9,
    cardRoomCategory: "window",
    targetWindowId: "card-room-private-window",
    description: "A smaller private lounge window with warm glass.",
  },
  {
    id: "cr-furniture-chip-cabinet",
    name: "Chip Cabinet",
    kind: "furniture",
    tags: ["furniture"],
    price: 18,
    cardRoomCategory: "furniture",
    targetFurnitureId: "card-room-chip-cabinet",
    description: "A left-side cabinet for chip trays and spare decks.",
  },
  {
    id: "cr-furniture-card-shelf",
    name: "Card Shelf",
    kind: "furniture",
    tags: ["furniture", "hanging"],
    price: 14,
    cardRoomCategory: "furniture",
    targetFurnitureId: "card-room-card-shelf",
    description: "A wall shelf showing boxed decks and table trophies.",
  },
  {
    id: "cr-furniture-floor-lamp",
    name: "Amber Floor Lamp",
    kind: "furniture",
    tags: ["furniture", "lamp"],
    price: 8,
    cardRoomCategory: "furniture",
    targetFurnitureId: "card-room-floor-lamp",
    description: "A warm lamp for the right side of the poker room.",
  },
  {
    id: "cr-furniture-sideboard",
    name: "Dealer Sideboard",
    kind: "furniture",
    tags: ["furniture"],
    price: 16,
    cardRoomCategory: "furniture",
    targetFurnitureId: "card-room-sideboard",
    description: "A sideboard for dealer tools and sealed card boxes.",
  },
];

export const cardRoomShopCategories: Array<{
  id: CardRoomDecorCategory;
  copyKey: string;
}> = [
  { id: "wall", copyKey: "cardRoom.decorWall" },
  { id: "floor", copyKey: "cardRoom.decorFloor" },
  { id: "window", copyKey: "cardRoom.decorWindow" },
  { id: "furniture", copyKey: "cardRoom.decorFurniture" },
];

export const cardRoomShopItemById = (itemId: string) =>
  cardRoomShopItems.find((item) => item.id === itemId);

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

export const normalizeCardRoomDecorState = (
  value: Partial<CardRoomDecorState> | null | undefined,
): CardRoomDecorState => {
  const purchasedItemIds = Array.from(
    new Set([
      ...cardRoomDefaultDecorState.purchasedItemIds,
      ...normalizeStringArray(value?.purchasedItemIds),
    ]),
  );
  const furnitureItemIds = normalizeStringArray(value?.furnitureItemIds).filter(
    (itemId) => Boolean(cardRoomFurnitureByShopItemId[itemId]),
  );
  const wallSurfaceId = cardRoomWallSurfaces.some(
    (surface) => surface.id === value?.wallSurfaceId,
  )
    ? String(value?.wallSurfaceId)
    : CARD_ROOM_DEFAULT_WALL_SURFACE_ID;
  const floorSurfaceId = cardRoomFloorSurfaces.some(
    (surface) => surface.id === value?.floorSurfaceId,
  )
    ? String(value?.floorSurfaceId)
    : CARD_ROOM_DEFAULT_FLOOR_SURFACE_ID;
  const windowId = cardRoomWindows.some((window) => window.id === value?.windowId)
    ? String(value?.windowId)
    : CARD_ROOM_DEFAULT_WINDOW_ID;

  return {
    purchasedItemIds,
    wallSurfaceId,
    floorSurfaceId,
    windowId,
    furnitureItemIds,
  };
};

export const buildCardRoomContentWithDecor = (
  decor: CardRoomDecorState,
): AivatarContent => {
  const normalizedDecor = normalizeCardRoomDecorState(decor);
  const furniture = [
    pokerTableFurniture,
    ...normalizedDecor.furnitureItemIds
      .map((itemId) => cardRoomFurnitureByShopItemId[itemId])
      .filter((item): item is FurnitureDefinition => Boolean(item)),
  ];

  return {
    ...cardRoomContent,
    room: {
      ...cardRoomContent.room,
      floorSurfaceId: normalizedDecor.floorSurfaceId,
      wallSurfaceId: normalizedDecor.wallSurfaceId,
      windowId: normalizedDecor.windowId,
      floorSurfaces: cardRoomFloorSurfaces,
      wallSurfaces: cardRoomWallSurfaces,
      windows: cardRoomWindows,
      furniture,
    },
    placedItems: normalizedDecor.furnitureItemIds.map((itemId) => {
      const furnitureItem = cardRoomFurnitureByShopItemId[itemId];
      return {
        id: `${itemId}-placed`,
        itemId,
        x: furnitureItem.x,
        y: furnitureItem.y,
      };
    }),
    itemDefinitions: cardRoomShopItems,
    shop: {
      currency: "chips",
      items: cardRoomShopItems,
    },
  };
};

export const cardRoomContent: AivatarContent = {
  avatar: {
    name: "Card Room Host",
    sprite: "pixel-avatar",
  },
  room: {
    theme: "card-room",
    zones: ["office", "kitchen"],
    floorSurfaceId: CARD_ROOM_DEFAULT_FLOOR_SURFACE_ID,
    wallSurfaceId: CARD_ROOM_DEFAULT_WALL_SURFACE_ID,
    windowId: CARD_ROOM_DEFAULT_WINDOW_ID,
    floorSurfaces: cardRoomFloorSurfaces,
    wallSurfaces: cardRoomWallSurfaces,
    windows: cardRoomWindows,
    furniture: [pokerTableFurniture],
  },
  inventory: [],
  placedItems: [],
  itemDefinitions: cardRoomShopItems,
  shop: {
    currency: "chips",
    items: cardRoomShopItems,
  },
  petStats: cardRoomDefaultPetStats,
  wallet: {
    bits: 0,
    pokerChips: 0,
  },
};
