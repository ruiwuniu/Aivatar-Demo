import type {
  AivatarContent,
  FurnitureDefinition,
  ItemDefinition,
  PlacedItem,
  RoomWindowDefinition,
} from "../types";

export const sceneSize = {
  width: 480,
  height: 320,
};

export const canvasPointToScene = (
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
) => {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / sceneSize.width, rect.height / sceneSize.height);
  const drawnWidth = sceneSize.width * scale;
  const drawnHeight = sceneSize.height * scale;
  const offsetX = (rect.width - drawnWidth) / 2;
  const offsetY = (rect.height - drawnHeight) / 2;
  const x = (clientX - rect.left - offsetX) / scale;
  const y = (clientY - rect.top - offsetY) / scale;

  if (x < 0 || y < 0 || x > sceneSize.width || y > sceneSize.height) {
    return null;
  }

  return { x, y };
};

export const findFurnitureAt = (
  content: AivatarContent,
  x: number,
  y: number,
): FurnitureDefinition | null => {
  for (const item of [...content.room.furniture].reverse()) {
    const bounds = getFurnitureVisualBounds(item);
    const withinX = x >= bounds.x && x <= bounds.x + bounds.width;
    const withinY = y >= bounds.y && y <= bounds.y + bounds.height;

    if (withinX && withinY) {
      return item;
    }
  }

  return null;
};

export const getFurnitureVisualBounds = (item: FurnitureDefinition) =>
  item.id === "bed"
    ? {
        x: item.x - 6,
        y: item.y - 15,
        width: item.width + 12,
        height: item.height + 26,
      }
    : item.id === "desk"
      ? {
          x: item.x - 2,
          y: item.y - 2,
          width: item.width + 8,
          height: item.height + 52,
        }
    : item.id === "computer"
      ? {
          x: item.x - 6,
          y: item.y + 2,
          width: 46,
          height: 51,
        }
    : item.id === "fridge"
      ? {
          x: item.x - 8,
          y: item.y - 31,
          width: item.width + 16,
          height: item.height + 40,
        }
    : item.id === "table"
      ? {
          x: item.x - 4,
          y: item.y - 5,
          width: item.width + 8,
          height: 58,
        }
    : item.id === "file-cabinet"
      ? {
          x: item.x - 5,
          y: item.y - 8,
          width: item.width + 10,
          height: item.height + 16,
        }
    : {
        x: item.x - 2,
        y: item.y - 2,
        width: item.width + 8,
        height: item.height + 10,
      };

export const isPointInPlacementArea = (x: number, y: number) =>
  x >= 78 && x <= 404 && y >= 132 && y <= 306;

const GRID_SIZE = 8;
const WALL_AREA = { x: 76, y: 20, width: 328, height: 106 };
const FLOOR_AREA = { x: 76, y: 126, width: 328, height: 180 };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedItemPlacement {
  x: number;
  y: number;
  surfaceFurnitureId?: string;
  surfaceOffsetX?: number;
  surfaceOffsetY?: number;
}

const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

const clamp = (min: number, max: number, value: number) =>
  Math.min(max, Math.max(min, value));

const snapWithin = (min: number, max: number, value: number) =>
  clamp(min, max, snap(value));

const rectsOverlap = (left: Rect, right: Rect) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

const isRectInside = (rect: Rect, area: Rect) =>
  rect.x >= area.x &&
  rect.x + rect.width <= area.x + area.width &&
  rect.y >= area.y &&
  rect.y + rect.height <= area.y + area.height;

const placedItemDefinition = (content: AivatarContent, itemId: string) =>
  content.itemDefinitions.find((item) => item.id === itemId);

const itemPlacementSurfaces = (item: ItemDefinition | undefined) => {
  if (item?.placementSurfaces?.length) return item.placementSurfaces;
  if (item?.placement === "wall" || item?.id === "poster") return ["wall"];
  if (item?.placement === "desktop" || item?.id === "terminal-monitor") {
    return ["furnitureTop"];
  }
  return ["floor"];
};

export const getItemPlacementKind = (
  item: ItemDefinition | undefined,
): "floor" | "desktop" | "wall" => {
  const surfaces = itemPlacementSurfaces(item);
  if (surfaces.includes("wall")) return "wall";
  if (surfaces.includes("floor")) return "floor";
  if (surfaces.includes("furnitureTop")) return "desktop";
  if (item?.placement) return item.placement;
  if (item?.id === "poster") return "wall";
  if (item?.id === "terminal-monitor") return "desktop";
  return "floor";
};

const getItemPlacementKindById = (content: AivatarContent, itemId: string) =>
  getItemPlacementKind(placedItemDefinition(content, itemId));

const itemSupportsPlacementSurface = (
  content: AivatarContent,
  itemId: string,
  surface: "floor" | "furnitureTop" | "wall",
) => itemPlacementSurfaces(placedItemDefinition(content, itemId)).includes(surface);

export const isFurnitureInPlacementArea = (
  x: number,
  y: number,
  width: number,
  height: number,
) => x >= 76 && x + width <= 404 && y >= 126 && y + height <= 306;

const BED_WALL_ALIGNED_Y = 128;
const DESK_WALL_ALIGNED_Y = 100;
const TABLE_WALL_ALIGNED_Y = 100;
const FRIDGE_WALL_ALIGNED_Y = 96;
const FILE_CABINET_WALL_ALIGNED_Y = 110;

const isDesktopSurfaceFurniture = (furniture: FurnitureDefinition) =>
  furniture.id === "desk" || furniture.id === "table";

const isPointOnFurnitureDesktopSurface = (
  surface: FurnitureDefinition,
  x: number,
  y: number,
) =>
  surface.id === "table"
    ? x >= surface.x + 8 &&
      x <= surface.x + surface.width - 8 &&
      y >= surface.y - 2 &&
      y <= surface.y + 26
    : x >= surface.x + 10 &&
      x <= surface.x + surface.width - 10 &&
      y >= surface.y - 2 &&
      y <= surface.y + 22;

const findClosestFurnitureDesktopSurface = (
  content: AivatarContent,
  x: number,
  y: number,
) => {
  const surfaces = content.room.furniture.filter(isDesktopSurfaceFurniture);
  const containingSurface = surfaces.find((surface) =>
    isPointOnFurnitureDesktopSurface(surface, x, y),
  );
  if (containingSurface) return containingSurface;

  return surfaces
    .slice()
    .sort((left, right) => {
      const leftDistance = Math.hypot(x - (left.x + left.width / 2), y - left.y);
      const rightDistance = Math.hypot(x - (right.x + right.width / 2), y - right.y);
      return leftDistance - rightDistance;
    })[0];
};

const getComputerDesktopPlacement = (
  computer: FurnitureDefinition,
  surface: FurnitureDefinition,
  x: number,
) => {
  const minX = surface.x + 10;
  const maxX = surface.x + surface.width - computer.width - 8;
  const placedX = snapWithin(minX, maxX, x);
  const placedY = surface.y - computer.height;

  return {
    x: placedX,
    y: snap(placedY),
  };
};

export const normalizeFurniturePlacement = (
  furniture: FurnitureDefinition,
  x: number,
  y: number,
  content?: AivatarContent,
) => {
  if (furniture.id === "computer" && content) {
    const pointerX = x + furniture.width / 2;
    const pointerY = y + furniture.height / 2;
    const surface = findClosestFurnitureDesktopSurface(content, pointerX, pointerY);

    if (surface && isPointOnFurnitureDesktopSurface(surface, pointerX, pointerY)) {
      return getComputerDesktopPlacement(furniture, surface, pointerX - furniture.width / 2);
    }
  }

  return {
    x: snap(x),
    y:
      furniture.id === "bed" && Math.abs(y - BED_WALL_ALIGNED_Y) <= 12
        ? BED_WALL_ALIGNED_Y
        : furniture.id === "desk" && Math.abs(y - DESK_WALL_ALIGNED_Y) <= 12
          ? DESK_WALL_ALIGNED_Y
          : furniture.id === "table" && Math.abs(y - TABLE_WALL_ALIGNED_Y) <= 12
            ? TABLE_WALL_ALIGNED_Y
            : furniture.id === "fridge" && Math.abs(y - FRIDGE_WALL_ALIGNED_Y) <= 12
              ? FRIDGE_WALL_ALIGNED_Y
              : furniture.id === "file-cabinet" &&
                  Math.abs(y - FILE_CABINET_WALL_ALIGNED_Y) <= 12
                ? FILE_CABINET_WALL_ALIGNED_Y
                : snap(y),
  };
};

export const getFurniturePlacementFootBounds = (
  furniture: FurnitureDefinition,
  x: number,
  y: number,
) => {
  if (furniture.id === "bed") {
    return {
      x: x - 3,
      y: y + 24,
      width: furniture.width + 6,
      height: furniture.height - 24,
    };
  }

  if (furniture.id === "desk") {
    return {
      x: x - 4,
      y: y + 30,
      width: furniture.width + 8,
      height: 41,
    };
  }

  if (furniture.id === "table") {
    return {
      x: x + 1,
      y: y + 31,
      width: furniture.width - 2,
      height: 29,
    };
  }

  if (furniture.id === "fridge") {
    return {
      x: x + 2,
      y: y + 47,
      width: furniture.width - 4,
      height: furniture.height - 43,
    };
  }

  if (furniture.id === "file-cabinet") {
    return {
      x: x + 5,
      y: y + furniture.height - 8,
      width: furniture.width - 10,
      height: 18,
    };
  }

  return { x, y, width: furniture.width, height: furniture.height };
};

export const isFurniturePlacementValid = (
  furniture: FurnitureDefinition,
  x: number,
  y: number,
  content?: AivatarContent,
) => {
  if (furniture.id === "computer") {
    const pointerX = x + furniture.width / 2;
    const pointerY = y + furniture.height;
    const surface = content
      ? findClosestFurnitureDesktopSurface(content, pointerX, pointerY)
      : undefined;

    return Boolean(
      content &&
      surface &&
        isPointOnFurnitureDesktopSurface(surface, pointerX, pointerY) &&
        !doesFurnitureOverlapRoom(content, furniture, x, y),
    );
  }

  const feet = getFurniturePlacementFootBounds(furniture, x, y);
  return (
    feet.x >= 76 &&
    feet.x + feet.width <= 404 &&
    feet.y >= 126 &&
    feet.y + feet.height <= 306 &&
    (!content || !doesFurnitureOverlapRoom(content, furniture, x, y))
  );
};

const doesFurnitureOverlapRoom = (
  content: AivatarContent,
  furniture: FurnitureDefinition,
  x: number,
  y: number,
) => {
  const bounds = getFurniturePlacementFootBounds(furniture, x, y);
  const overlapsFurniture = content.room.furniture.some((candidate) => {
    if (candidate.id === furniture.id) return false;
    if (
      (candidate.id === "desk" && furniture.id === "computer") ||
      (candidate.id === "computer" && furniture.id === "desk")
    ) {
      return false;
    }
    return rectsOverlap(
      bounds,
      getFurniturePlacementFootBounds(candidate, candidate.x, candidate.y),
    );
  });

  if (overlapsFurniture) return true;

  return (content.placedItems ?? []).some((item) => {
    if (item.surfaceFurnitureId === furniture.id) return false;
    if (item.surfaceFurnitureId || isFloorUnderlayItem(item.itemId)) return false;
    if (getItemPlacementKindById(content, item.itemId) !== "floor") return false;
    return rectsOverlap(bounds, getPlacedItemPlacementFootBounds(item));
  });
};

export const isDesktopItem = (contentOrItemId: AivatarContent | string, itemId?: string) => {
  if (typeof contentOrItemId === "string") {
    return contentOrItemId === "terminal-monitor";
  }

  return itemId
    ? getItemPlacementKindById(contentOrItemId, itemId) === "desktop"
    : false;
};

export const isWallItem = (content: AivatarContent, itemId: string) =>
  getItemPlacementKindById(content, itemId) === "wall";

const isFloorUnderlayItem = (itemId: string) =>
  itemId === "cozy-rug" ||
  itemId === "morph-blob-rug" ||
  itemId === "blue-persian-rug";

export const getPlacedItemPlacementFootBounds = (item: PlacedItem) => {
  const bounds = placedItemBounds(item);
  const height = Math.min(14, Math.max(6, bounds.height * 0.24));
  const inset = Math.min(8, Math.max(0, bounds.width * 0.16));

  return {
    x: bounds.x + inset,
    y: bounds.y + bounds.height - height,
    width: Math.max(4, bounds.width - inset * 2),
    height,
  };
};

const findDesktopSurfaces = (content: AivatarContent) =>
  content.room.furniture.filter((item) => item.id === "desk" || item.id === "table");

const getDesktopSurfacePlacement = (
  surface: FurnitureDefinition,
  x: number,
  y: number,
) => {
  if (surface.id === "table") {
    const minX = surface.x + 10;
    const maxX = surface.x + surface.width - 10;
    const minY = surface.y;
    const maxY = surface.y + 24;
    const placedX = snapWithin(minX, maxX, x);
    const placedY = snapWithin(minY, maxY, y);
    return {
      x: placedX,
      y: placedY,
      surfaceFurnitureId: surface.id,
      surfaceOffsetX: placedX - surface.x,
      surfaceOffsetY: placedY - surface.y,
    };
  }

  const minX = surface.x + 12;
  const maxX = surface.x + surface.width - 12;
  const minY = surface.y;
  const maxY = surface.y + 20;
  const placedX = snapWithin(minX, maxX, x);
  const placedY = snapWithin(minY, maxY, y);
  return {
    x: placedX,
    y: placedY,
    surfaceFurnitureId: surface.id,
    surfaceOffsetX: placedX - surface.x,
    surfaceOffsetY: placedY - surface.y,
  };
};

const isPointOnDesktopSurface = (
  surface: FurnitureDefinition,
  x: number,
  y: number,
) =>
  surface.id === "table"
    ? x >= surface.x + 8 &&
      x <= surface.x + surface.width - 8 &&
      y >= surface.y - 2 &&
      y <= surface.y + 26
    : x >= surface.x + 10 &&
      x <= surface.x + surface.width - 10 &&
      y >= surface.y - 2 &&
      y <= surface.y + 22;

const findClosestDesktopSurface = (
  content: AivatarContent,
  x: number,
  y: number,
) => {
  const surfaces = findDesktopSurfaces(content);
  const containingSurface = surfaces.find((surface) =>
    isPointOnDesktopSurface(surface, x, y),
  );
  if (containingSurface) return containingSurface;

  return surfaces
    .slice()
    .sort((left, right) => {
      const leftDistance = Math.hypot(x - (left.x + left.width / 2), y - left.y);
      const rightDistance = Math.hypot(x - (right.x + right.width / 2), y - right.y);
      return leftDistance - rightDistance;
    })[0];
};

export const normalizePlacedItemPoint = (
  content: AivatarContent,
  itemId: string,
  x: number,
  y: number,
): PlacedItemPlacement => {
  const supportsWall = itemSupportsPlacementSurface(content, itemId, "wall");
  const supportsFurnitureTop = itemSupportsPlacementSurface(
    content,
    itemId,
    "furnitureTop",
  );
  const supportsFloor = itemSupportsPlacementSurface(content, itemId, "floor");

  if (supportsWall && !supportsFloor && !supportsFurnitureTop) {
    return { x: snap(x), y: snap(y) };
  }

  if (supportsFurnitureTop) {
    const surface = findClosestDesktopSurface(content, x, y);
    if (surface && isPointOnDesktopSurface(surface, x, y)) {
      return getDesktopSurfacePlacement(surface, x, y);
    }
  }

  if (supportsFloor) return { x: snap(x), y: snap(y) };

  return { x: snap(x), y: snap(y) };
};

export const isPlacedItemPlacementValid = (
  content: AivatarContent,
  itemId: string,
  x: number,
  y: number,
  ignorePlacedItemId?: string,
) => {
  const supportsWall = itemSupportsPlacementSurface(content, itemId, "wall");
  const supportsFurnitureTop = itemSupportsPlacementSurface(
    content,
    itemId,
    "furnitureTop",
  );
  const supportsFloor = itemSupportsPlacementSurface(content, itemId, "floor");
  const normalized = normalizePlacedItemPoint(content, itemId, x, y);
  const candidate = { id: "candidate", itemId, ...normalized };
  const candidateBounds = placedItemBounds(candidate);
  const placementKind = normalized.surfaceFurnitureId
    ? "desktop"
    : supportsWall && !supportsFloor && !supportsFurnitureTop
      ? "wall"
      : "floor";
  const candidateOverlapBounds =
    placementKind === "floor"
      ? getPlacedItemPlacementFootBounds(candidate)
      : candidateBounds;

  if (placementKind === "desktop") {
    if (
      !findDesktopSurfaces(content).some((surface) =>
        isPointOnDesktopSurface(surface, x, y),
      )
    ) {
      return false;
    }
  } else if (placementKind === "wall") {
    if (!isRectInside(candidateBounds, WALL_AREA)) return false;
    if (findActiveWindow(content) && rectsOverlap(candidateBounds, findActiveWindow(content)!)) {
      return false;
    }
    if (content.room.furniture.some((item) => rectsOverlap(candidateBounds, getFurnitureVisualBounds(item)))) {
      return false;
    }
  } else if (!supportsFloor || !isRectInside(candidateOverlapBounds, FLOOR_AREA)) {
    return false;
  }

  if (
    placementKind === "floor" &&
    !isFloorUnderlayItem(itemId) &&
    content.room.furniture.some((item) =>
      rectsOverlap(
        candidateOverlapBounds,
        getFurniturePlacementFootBounds(item, item.x, item.y),
      ),
    )
  ) {
    return false;
  }

  return !(content.placedItems ?? []).some((item) => {
    if (item.id === ignorePlacedItemId) return false;
    if (
      placementKind === "floor" &&
      (isFloorUnderlayItem(itemId) || isFloorUnderlayItem(item.itemId))
    ) {
      return false;
    }
    const itemKind = item.surfaceFurnitureId
      ? "desktop"
      : getItemPlacementKindById(content, item.itemId);
    if (itemKind !== placementKind) return false;
    const itemOverlapBounds =
      placementKind === "floor"
        ? getPlacedItemPlacementFootBounds(item)
        : placedItemBounds(item);
    return rectsOverlap(candidateOverlapBounds, itemOverlapBounds);
  });
};

export const isWindowInWallArea = (x: number, y: number, width: number, height: number) =>
  x >= 76 && x + width <= 404 && y >= 20 && y + height <= 126;

export const isWindowPlacementValid = (
  content: AivatarContent,
  windowDefinition: RoomWindowDefinition,
  x: number,
  y: number,
) => {
  if (!isWindowInWallArea(x, y, windowDefinition.width, windowDefinition.height)) {
    return false;
  }

  const windowBounds = {
    x,
    y,
    width: windowDefinition.width,
    height: windowDefinition.height,
  };

  return !(content.placedItems ?? []).some((item) => {
    if (!isWallItem(content, item.itemId)) return false;
    return rectsOverlap(windowBounds, placedItemBounds(item));
  });
};

export const findActiveWindow = (
  content: AivatarContent,
): RoomWindowDefinition | null =>
  content.room.windows?.find((item) => item.id === content.room.windowId) ??
  content.room.windows?.[0] ??
  null;

export const findWindowAt = (
  content: AivatarContent,
  x: number,
  y: number,
): RoomWindowDefinition | null => {
  const windowDefinition = findActiveWindow(content);
  if (!windowDefinition) return null;

  const withinX =
    x >= windowDefinition.x && x <= windowDefinition.x + windowDefinition.width;
  const withinY =
    y >= windowDefinition.y && y <= windowDefinition.y + windowDefinition.height;

  return withinX && withinY ? windowDefinition : null;
};

export const placedItemBounds = (item: PlacedItem) => {
  switch (item.itemId) {
    case "cozy-rug":
      return { x: item.x - 44, y: item.y - 24, width: 88, height: 48 };
    case "morph-blob-rug":
      return { x: item.x - 40, y: item.y - 44, width: 88, height: 62 };
    case "blue-persian-rug":
      return { x: item.x - 52, y: item.y - 36, width: 104, height: 72 };
    case "game-console":
      return { x: item.x - 22, y: item.y - 28, width: 44, height: 38 };
    case "oil-easel":
      return { x: item.x - 26, y: item.y - 68, width: 54, height: 76 };
    case "coffee-machine":
      return { x: item.x - 31, y: item.y - 48, width: 58, height: 63 };
    case "coffee-cup":
      return { x: item.x - 11, y: item.y - 24, width: 28, height: 28 };
    case "terminal-monitor":
      return { x: item.x - 21, y: item.y - 35, width: 42, height: 50 };
    case "file-cabinet":
      return { x: item.x - 27, y: item.y - 66, width: 54, height: 74 };
    case "digital-wall-clock":
      return { x: item.x - 20, y: item.y - 19, width: 40, height: 24 };
    case "poster":
    case "sky-sentinel-poster":
      return { x: item.x - 18, y: item.y - 46, width: 36, height: 54 };
    case "desk-lamp":
      return { x: item.x - 14, y: item.y - 32, width: 28, height: 36 };
    default:
      return { x: item.x - 14, y: item.y - 32, width: 28, height: 36 };
  }
};

export const attachedPlacedItemPosition = (
  item: PlacedItem,
  surface: FurnitureDefinition | undefined,
): PlacedItem => {
  if (!surface || !item.surfaceFurnitureId) return item;
  return {
    ...item,
    x: surface.x + (item.surfaceOffsetX ?? item.x - surface.x),
    y: surface.y + (item.surfaceOffsetY ?? item.y - surface.y),
  };
};

export const findPlacedItemAt = (
  content: AivatarContent,
  x: number,
  y: number,
): PlacedItem | null => {
  for (const item of [...(content.placedItems ?? [])].reverse()) {
    if (isFloorUnderlayItem(item.itemId)) continue;
    const bounds = placedItemBounds(item);
    const withinX = x >= bounds.x && x <= bounds.x + bounds.width;
    const withinY = y >= bounds.y && y <= bounds.y + bounds.height;

    if (withinX && withinY) {
      return item;
    }
  }

  for (const item of [...(content.placedItems ?? [])].reverse()) {
    if (!isFloorUnderlayItem(item.itemId)) continue;
    const bounds = placedItemBounds(item);
    const withinX = x >= bounds.x && x <= bounds.x + bounds.width;
    const withinY = y >= bounds.y && y <= bounds.y + bounds.height;
    if (!withinX || !withinY) continue;

    const coveredByFurniture = content.room.furniture.some((furniture) => {
      const furnitureBounds = getFurnitureVisualBounds(furniture);
      return (
        x >= furnitureBounds.x &&
        x <= furnitureBounds.x + furnitureBounds.width &&
        y >= furnitureBounds.y &&
        y <= furnitureBounds.y + furnitureBounds.height
      );
    });
    if (!coveredByFurniture) return item;
  }

  return null;
};
