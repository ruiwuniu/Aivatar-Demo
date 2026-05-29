import type {
  AivatarContent,
  AivatarMemory,
  AivatarNavMemory,
  AvatarRuntime,
  BehaviorName,
  CodexStatusMessage,
  FurnitureDefinition,
  PlacedItem,
  PetStats,
} from "../types";
import { getPlacedItemPlacementFootBounds } from "./interactions";

const BUILTIN_TERMINAL_PLACED_ITEM_ID = "builtin-terminal";
const TERMINAL_MONITOR_ITEM_ID = "terminal-monitor";
const GAME_CONSOLE_ITEM_ID = "game-console";
const EASEL_ITEM_ID = "oil-easel";
const TASK_CABINET_ITEM_ID = "file-cabinet";
const NAV_GRID_SIZE = 8;
const NAV_ROOM_MIN_X = 84;
const NAV_ROOM_MAX_X = 396;
const NAV_ROOM_MIN_Y = 136;
const NAV_ROOM_MAX_Y = 292;
const AVATAR_FOOTPRINT_HALF_WIDTH = 6;
const AVATAR_FOOTPRINT_TOP_OFFSET = 6;
const AVATAR_FOOTPRINT_HEIGHT = 8;
const INTERACTION_STANDPOINT_DISTANCE = 22;
const DESK_CLOSE_STANDPOINT_DISTANCE = 6;
const DESK_FRONT_STANDPOINT_DISTANCE = 6;
const FURNITURE_CLOSE_STANDPOINT_DISTANCE = 6;
const SURFACE_ITEM_CLOSE_STANDPOINT_DISTANCE = 3;
const COLLISION_EDGE_EPSILON = 0.5;
const NAV_WAYPOINT_REACHED_DISTANCE = 7;
const MIN_VISIBLE_MOVE_DISTANCE = 0.15;
const COMPLETE_VISUAL_SECONDS = 2.2;
const EXPLORE_MIN_ENERGY = 35;
const EXPLORE_MIN_MOOD = 30;
const EXPLORE_MIN_HUNGER = 25;
const EXPLORE_CHANCE = 0.12;
const NAV_TRICKY_CELL_PENALTY = 2.2;
const NAV_VISITED_CELL_PENALTY = 0.08;

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type LocalNavActionName =
  | "sidestep-left"
  | "sidestep-right"
  | "backoff"
  | "force-replan"
  | "switch-interaction-point";
type LocalNavAction = {
  action: LocalNavActionName;
  score: number;
  point?: Point;
  target?: Point;
};

const rectsOverlap = (left: Rect, right: Rect) =>
  left.x < right.x + right.width - COLLISION_EDGE_EPSILON &&
  left.x + left.width > right.x + COLLISION_EDGE_EPSILON &&
  left.y < right.y + right.height - COLLISION_EDGE_EPSILON &&
  left.y + left.height > right.y + COLLISION_EDGE_EPSILON;

let cachedNavWaypoint:
  | {
      behavior: BehaviorName;
      targetX: number;
      targetY: number;
      ignoredFurnitureId?: string;
      point: Point;
      path?: Point[];
    }
  | null = null;

const sameNavigationTarget = (
  cache: NonNullable<typeof cachedNavWaypoint>,
  behavior: BehaviorName,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  ignoredFurnitureId?: string,
) =>
  cache.behavior === behavior &&
  cache.ignoredFurnitureId === ignoredFurnitureId &&
  Math.abs(cache.targetX - target.targetX) <= 1 &&
  Math.abs(cache.targetY - target.targetY) <= 1;

const avatarFootprintBounds = (x: number, y: number): Rect => ({
  x: x - AVATAR_FOOTPRINT_HALF_WIDTH,
  y: y + AVATAR_FOOTPRINT_TOP_OFFSET,
  width: AVATAR_FOOTPRINT_HALF_WIDTH * 2,
  height: AVATAR_FOOTPRINT_HEIGHT,
});

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

export const applyPetStatEffect = (
  stats: PetStats,
  effect: Partial<PetStats> = {},
): PetStats => ({
  energy: clamp(stats.energy + (effect.energy ?? 0)),
  mood: clamp(stats.mood + (effect.mood ?? 0)),
  hunger: clamp(stats.hunger + (effect.hunger ?? 0)),
});

export const initialAvatarRuntime = (): AvatarRuntime => ({
  x: 210,
  y: 185,
  targetX: 210,
  targetY: 185,
  facing: "front",
  behavior: "idle",
  behaviorTimer: 0,
  expression: "calm",
  activityLabel: "Settling in",
});

export const applyPetTick = (stats: PetStats, elapsedSeconds: number): PetStats => ({
  energy: clamp(stats.energy - elapsedSeconds * 0.08),
  mood: clamp(stats.mood - elapsedSeconds * 0.04),
  hunger: clamp(stats.hunger - elapsedSeconds * 0.06),
});

export const deriveBehaviorFromCodex = (
  status: CodexStatusMessage,
): BehaviorName | null => {
  switch (status.status) {
    case "thinking":
      return "thinking";
    case "executing":
      return "coding";
    case "waiting_for_user":
      return "waiting";
    case "error":
      return "error";
    case "complete": {
      const completedAt = Date.parse(status.timestamp);
      if (
        Number.isNaN(completedAt) ||
        Date.now() - completedAt > COMPLETE_VISUAL_SECONDS * 1000
      ) {
        return null;
      }
      return "success";
    }
    case "idle":
      return null;
  }
};

const randomRoomPoint = () => ({
  targetX: 120 + Math.random() * 260,
  targetY: 155 + Math.random() * 86,
});

export const explorationCellKey = (point: Point) => {
  const cell = pointToCell(point);
  return `${cell.col}:${cell.row}`;
};

export const explorationTargetReached = (avatar: AvatarRuntime) =>
  Math.hypot(avatar.x - avatar.targetX, avatar.y - avatar.targetY) <= 10;

const randomExploreTarget = (content: AivatarContent): Pick<AvatarRuntime, "targetX" | "targetY"> => {
  const roll = Math.random();
  const placedItems = content.placedItems ?? [];
  const objectTargets = [
    ...content.room.furniture.map((item) => ({
      targetX: item.x + item.width / 2 + (Math.random() - 0.5) * 42,
      targetY: item.y + item.height + 18 + (Math.random() - 0.5) * 24,
    })),
    ...placedItems.map((item) => ({
      targetX: item.x + 18 + (Math.random() - 0.5) * 40,
      targetY: item.y + 18 + (Math.random() - 0.5) * 34,
    })),
  ];

  if (roll < 0.5 && objectTargets.length > 0) {
    const target = objectTargets[Math.floor(Math.random() * objectTargets.length)];
    return {
      targetX: clamp(target.targetX, NAV_ROOM_MIN_X, NAV_ROOM_MAX_X),
      targetY: clamp(target.targetY, NAV_ROOM_MIN_Y, NAV_ROOM_MAX_Y),
    };
  }

  return randomRoomPoint();
};

const isPointInsideRoomFloor = (point: Point) =>
  point.x >= NAV_ROOM_MIN_X &&
  point.x <= NAV_ROOM_MAX_X &&
  point.y >= NAV_ROOM_MIN_Y &&
  point.y <= NAV_ROOM_MAX_Y;

const uniquePoints = (points: Point[]) => {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const furnitureBounds = (furniture: FurnitureDefinition) =>
  furniture.collision ?? {
    x: furniture.x,
    y: furniture.y,
    width: furniture.width,
    height: furniture.height,
  };

const validStandpoints = (
  points: Point[],
  content: AivatarContent,
  ignoredFurnitureId?: string,
) =>
  uniquePoints(points)
    .map((point) => ({
      x: clamp(point.x, NAV_ROOM_MIN_X, NAV_ROOM_MAX_X),
      y: clamp(point.y, NAV_ROOM_MIN_Y, NAV_ROOM_MAX_Y),
    }))
    .filter(
      (point) =>
        isPointInsideRoomFloor(point) &&
        !pointHitsCollision(point.x, point.y, content, ignoredFurnitureId),
    );

export const getFurnitureInteractionStandpoints = (
  furniture: FurnitureDefinition,
  content: AivatarContent,
  behavior: BehaviorName | string = furniture.interaction,
): Point[] => {
  if (furniture.id === "bed" && behavior === "sleep") {
    return validStandpoints(
      [
        { x: furniture.x + furniture.width / 2, y: furniture.y + 50 },
        { x: furniture.x + furniture.width / 2, y: furniture.y + furniture.height + 14 },
      ],
      content,
      "bed",
    );
  }

  const bounds = furnitureBounds(furniture);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const distance =
    furniture.id === "desk"
      ? DESK_CLOSE_STANDPOINT_DISTANCE
      : INTERACTION_STANDPOINT_DISTANCE;
  let points = [
    { x: centerX, y: bounds.y + bounds.height + distance },
    { x: bounds.x - distance, y: centerY },
    { x: bounds.x + bounds.width + distance, y: centerY },
    { x: centerX, y: bounds.y - distance },
    { x: bounds.x - distance, y: bounds.y + bounds.height + distance },
    { x: bounds.x + bounds.width + distance, y: bounds.y + bounds.height + distance },
  ];

  if (furniture.id === "fridge") {
    points = points.filter((point) => point.y >= bounds.y);
    points.unshift(
      { x: bounds.x - distance, y: bounds.y + bounds.height * 0.75 },
      { x: centerX, y: bounds.y + bounds.height + 16 },
    );
  }

  if (furniture.id === "desk") {
    points = points.filter((point) => point.y >= bounds.y);
  }

  if (furniture.id === "table" || furniture.id === "desk") {
    const furnitureDistance =
      furniture.id === "table"
        ? FURNITURE_CLOSE_STANDPOINT_DISTANCE
        : furniture.id === "desk"
          ? DESK_FRONT_STANDPOINT_DISTANCE
        : distance;
    points.unshift(
      { x: centerX, y: bounds.y + bounds.height + furnitureDistance },
      { x: bounds.x + bounds.width * 0.25, y: bounds.y + bounds.height + furnitureDistance },
      { x: bounds.x + bounds.width * 0.75, y: bounds.y + bounds.height + furnitureDistance },
    );
  }

  return validStandpoints(points, content, furniture.id);
};

export const getPlacedItemInteractionStandpoints = (
  item: PlacedItem,
  content: AivatarContent,
): Point[] => {
  if (item.surfaceFurnitureId) {
    const surface = content.room.furniture.find(
      (furniture) => furniture.id === item.surfaceFurnitureId,
    );
    if (surface) {
      const bounds = furnitureBounds(surface);
      const itemX = clamp(item.x, bounds.x + 12, bounds.x + bounds.width - 12);
      const usesItemOnlySurfaceStandpoints =
        item.itemId === "coffee-machine" ||
        item.itemId === TERMINAL_MONITOR_ITEM_ID ||
        item.itemId === GAME_CONSOLE_ITEM_ID;
      const itemDistance =
        item.itemId === TERMINAL_MONITOR_ITEM_ID
          ? SURFACE_ITEM_CLOSE_STANDPOINT_DISTANCE
          : INTERACTION_STANDPOINT_DISTANCE;
      const surfaceStandpoints =
        usesItemOnlySurfaceStandpoints
          ? []
          : getFurnitureInteractionStandpoints(surface, content);
      return validStandpoints(
        [
          { x: itemX, y: bounds.y + bounds.height + itemDistance },
          { x: itemX - 18, y: bounds.y + bounds.height + itemDistance },
          { x: itemX + 18, y: bounds.y + bounds.height + itemDistance },
          ...surfaceStandpoints,
        ],
        content,
        surface.id,
      );
    }
  }

  return validStandpoints(
    [
      ...(item.itemId === EASEL_ITEM_ID
        ? [
            { x: item.x, y: item.y + 22 },
            { x: item.x - 18, y: item.y + 20 },
            { x: item.x + 18, y: item.y + 20 },
          ]
        : []),
      { x: item.x + 18, y: item.y + 28 },
      { x: item.x - 16, y: item.y + 14 },
      { x: item.x + 36, y: item.y + 14 },
      ...(item.itemId === "coffee-machine" ||
      item.itemId === GAME_CONSOLE_ITEM_ID ||
      item.itemId === EASEL_ITEM_ID
        ? []
        : [{ x: item.x + 18, y: item.y - 16 }]),
    ],
    content,
  );
};

const chooseNearestPoint = (from: Point, points: Point[], fallback: Point) =>
  points.length === 0
    ? fallback
    : [...points].sort(
        (left, right) =>
          Math.hypot(left.x - from.x, left.y - from.y) -
          Math.hypot(right.x - from.x, right.y - from.y),
      )[0];

const samePoint = (left: Point, right: Point) =>
  Math.abs(left.x - right.x) <= 1 && Math.abs(left.y - right.y) <= 1;

const chooseNearestOrRandom = <T>(
  from: Point,
  candidates: T[],
  pointFor: (item: T) => Point,
) => {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  if (Math.random() >= 0.7) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  return [...candidates].sort(
    (left, right) =>
      Math.hypot(pointFor(left).x - from.x, pointFor(left).y - from.y) -
      Math.hypot(pointFor(right).x - from.x, pointFor(right).y - from.y),
  )[0];
};

const targetNearFurniture = (
  furniture: FurnitureDefinition | undefined,
  fallback: Pick<AvatarRuntime, "targetX" | "targetY">,
): Pick<AvatarRuntime, "targetX" | "targetY"> => {
  if (!furniture) return fallback;
  return getFurnitureInteractionTarget(furniture);
};

export const getFurnitureInteractionTarget = (
  furniture: FurnitureDefinition,
  behavior: BehaviorName | string = furniture.interaction,
): Pick<AvatarRuntime, "targetX" | "targetY"> => {
  const content = {
    room: { furniture: [furniture] },
  } as AivatarContent;
  const fallback =
    furniture.id === "bed" && behavior === "sleep"
      ? { x: furniture.x + furniture.width / 2, y: furniture.y + 50 }
      : { x: furniture.x + furniture.width / 2, y: furniture.y + furniture.height + 18 };
  const point = chooseNearestPoint(
    fallback,
    getFurnitureInteractionStandpoints(furniture, content, behavior),
    fallback,
  );
  return { targetX: point.x, targetY: point.y };
};

const targetNearPlacedItem = (
  item: PlacedItem | undefined,
  content?: AivatarContent,
): Pick<AvatarRuntime, "targetX" | "targetY"> => {
  if (!item) return randomRoomPoint();
  if (item.surfaceFurnitureId && content) {
    const surface = content.room.furniture.find(
      (furniture) => furniture.id === item.surfaceFurnitureId,
    );
    if (surface) {
      const point = chooseNearestPoint(
        { x: item.x, y: item.y },
        getPlacedItemInteractionStandpoints(item, content),
        {
          x: clamp(item.x, surface.x + 12, surface.x + surface.width - 12),
          y: surface.y + surface.height + 18,
        },
      );
      return { targetX: point.x, targetY: point.y };
    }
  }

  return {
    targetX: item.x + 18,
    targetY: item.y + 14,
  };
};

const behaviorInteractionAlternates = (
  behavior: BehaviorName,
  content: AivatarContent,
  from: Point,
): Point[] | undefined => {
  const placedItems = content.placedItems ?? [];

  if (
    behavior === "coding" ||
    behavior === "thinking" ||
    behavior === "carry_task_file" ||
    behavior === "read_task_file"
  ) {
    const terminal = chooseNearestOrRandom(
      from,
      placedItems.filter(
        (item) =>
          item.id === BUILTIN_TERMINAL_PLACED_ITEM_ID ||
          item.itemId === TERMINAL_MONITOR_ITEM_ID,
      ),
      (item) => ({ x: item.x, y: item.y }),
    );
    return terminal ? getPlacedItemInteractionStandpoints(terminal, content) : undefined;
  }

  if (behavior === "fetch_task_file") {
    const cabinet = content.room.furniture.find(
      (item) => item.id === TASK_CABINET_ITEM_ID,
    );
    return cabinet ? getFurnitureInteractionStandpoints(cabinet, content, behavior) : undefined;
  }

  if (behavior === "interact") {
    const fridge = content.room.furniture.find((item) => item.id === "fridge");
    return fridge ? getFurnitureInteractionStandpoints(fridge, content, behavior) : undefined;
  }

  if (behavior === "coffee" || behavior === "cola") {
    const table = content.room.furniture.find((item) => item.id === "table");
    return table ? getFurnitureInteractionStandpoints(table, content, behavior) : undefined;
  }

  if (behavior === "bento") {
    const table = content.room.furniture.find((item) => item.id === "table");
    const fridge = content.room.furniture.find((item) => item.id === "fridge");
    const target = table ?? fridge;
    return target ? getFurnitureInteractionStandpoints(target, content, behavior) : undefined;
  }

  if (behavior === "snack") {
    const table = content.room.furniture.find((item) => item.id === "table");
    const fridge = content.room.furniture.find((item) => item.id === "fridge");
    const coffeeCount =
      content.inventory.find((entry) => entry.itemId === "coffee")?.quantity ?? 0;
    const wantsCoffee = content.petStats.energy < 28 && coffeeCount > 0;
    const target = wantsCoffee ? table ?? fridge : fridge ?? table;
    return target ? getFurnitureInteractionStandpoints(target, content, behavior) : undefined;
  }

  if (behavior === "brew") {
    const coffeeMachine = chooseNearestOrRandom(
      from,
      placedItems.filter((item) => item.itemId === "coffee-machine"),
      (item) => ({ x: item.x, y: item.y }),
    );
    return coffeeMachine
      ? getPlacedItemInteractionStandpoints(coffeeMachine, content)
      : undefined;
  }

  if (behavior === "relax" || behavior === "sleep") {
    const bed = content.room.furniture.find((item) => item.id === "bed");
    return bed ? getFurnitureInteractionStandpoints(bed, content, behavior) : undefined;
  }

  if (behavior === "admire") {
    return placedItems.flatMap((item) => getPlacedItemInteractionStandpoints(item, content));
  }

  if (behavior === "play") {
    const gameConsole = chooseNearestOrRandom(
      from,
      placedItems.filter((item) => item.itemId === "game-console"),
      (item) => ({ x: item.x, y: item.y }),
    );
    return gameConsole ? getPlacedItemInteractionStandpoints(gameConsole, content) : undefined;
  }

  if (behavior === "paint") {
    const easel = chooseNearestOrRandom(
      from,
      placedItems.filter((item) => item.itemId === EASEL_ITEM_ID),
      (item) => ({ x: item.x, y: item.y }),
    );
    return easel ? getPlacedItemInteractionStandpoints(easel, content) : undefined;
  }

  return undefined;
};

export const targetForBehavior = (
  behavior: BehaviorName,
  content: AivatarContent,
  from: Point = { x: 210, y: 185 },
): Pick<AvatarRuntime, "targetX" | "targetY"> => {
  if (behavior === "coding" || behavior === "thinking") {
    const terminal = chooseNearestOrRandom(
      from,
      (content.placedItems ?? []).filter(
        (item) =>
          item.id === BUILTIN_TERMINAL_PLACED_ITEM_ID ||
          item.itemId === TERMINAL_MONITOR_ITEM_ID,
      ),
      (item) => ({ x: item.x, y: item.y }),
    );
    return targetNearPlacedItem(terminal, content);
  }

  if (behavior === "wander") {
    return randomRoomPoint();
  }

  if (behavior === "explore") {
    return randomExploreTarget(content);
  }

  if (behavior === "phone") {
    return {
      targetX: 170 + Math.random() * 130,
      targetY: 172 + Math.random() * 52,
    };
  }

  if (behavior === "fetch_task_file") {
    const cabinet = content.room.furniture.find(
      (item) => item.id === TASK_CABINET_ITEM_ID,
    );
    return targetNearFurniture(cabinet, { targetX: 296, targetY: 196 });
  }

  if (behavior === "carry_task_file" || behavior === "read_task_file") {
    const terminal = chooseNearestOrRandom(
      from,
      (content.placedItems ?? []).filter(
        (item) =>
          item.id === BUILTIN_TERMINAL_PLACED_ITEM_ID ||
          item.itemId === TERMINAL_MONITOR_ITEM_ID,
      ),
      (item) => ({ x: item.x, y: item.y }),
    );
    return targetNearPlacedItem(terminal, content);
  }

  if (behavior === "sleep") {
    const bed = content.room.furniture.find((item) => item.id === "bed");
    return {
      targetX: (bed?.x ?? 80) + (bed?.width ?? 72) / 2,
      targetY: (bed?.y ?? 90) + 50,
    };
  }

  if (behavior === "interact") {
    const fridge = content.room.furniture.find((item) => item.id === "fridge");
    return { targetX: (fridge?.x ?? 380) - 12, targetY: (fridge?.y ?? 100) + 70 };
  }

  if (behavior === "coffee") {
    const table = content.room.furniture.find((item) => item.id === "table");
    return targetNearFurniture(table, { targetX: 246, targetY: 202 });
  }

  if (behavior === "cola") {
    const table = content.room.furniture.find((item) => item.id === "table");
    return targetNearFurniture(table, { targetX: 246, targetY: 202 });
  }

  if (behavior === "bento") {
    const table = content.room.furniture.find((item) => item.id === "table");
    const fridge = content.room.furniture.find((item) => item.id === "fridge");
    return targetNearFurniture(table ?? fridge, { targetX: 246, targetY: 202 });
  }

  if (behavior === "snack") {
    const table = content.room.furniture.find((item) => item.id === "table");
    const fridge = content.room.furniture.find((item) => item.id === "fridge");
    const coffeeCount =
      content.inventory.find((entry) => entry.itemId === "coffee")?.quantity ?? 0;
    const wantsCoffee = content.petStats.energy < 28 && coffeeCount > 0;
    return targetNearFurniture(
      wantsCoffee ? table ?? fridge : fridge ?? table,
      { targetX: 386, targetY: 226 },
    );
  }

  if (behavior === "brew") {
    const placedItems = content.placedItems ?? [];
    const coffeeMachine = chooseNearestOrRandom(
      from,
      placedItems.filter((item) => item.itemId === "coffee-machine"),
      (item) => ({ x: item.x, y: item.y }),
    );
    return targetNearPlacedItem(coffeeMachine, content);
  }

  if (behavior === "relax") {
    const bed = content.room.furniture.find((item) => item.id === "bed");
    return targetNearFurniture(bed, { targetX: 126, targetY: 154 });
  }

  if (behavior === "admire") {
    const placedItems = content.placedItems ?? [];
    const item = placedItems[Math.floor(Math.random() * placedItems.length)];
    return targetNearPlacedItem(item, content);
  }

  if (behavior === "play") {
    const entertainment = content.room.furniture.find((item) =>
      ["game", "console", "sofa", "bookshelf"].some((key) => item.id.includes(key)),
    );
    const placedItems = content.placedItems ?? [];
    const gameConsole = chooseNearestOrRandom(
      from,
      placedItems.filter((item) => item.itemId === "game-console"),
      (item) => ({ x: item.x, y: item.y }),
    );
    return targetNearFurniture(
      entertainment,
      targetNearPlacedItem(
        gameConsole ?? placedItems[Math.floor(Math.random() * placedItems.length)],
        content,
      ),
    );
  }

  if (behavior === "paint") {
    const placedItems = content.placedItems ?? [];
    const easel = chooseNearestOrRandom(
      from,
      placedItems.filter((item) => item.itemId === EASEL_ITEM_ID),
      (item) => ({ x: item.x, y: item.y }),
    );
    return targetNearPlacedItem(easel, content);
  }

  if (behavior === "waiting") {
    return { targetX: 222, targetY: 206 };
  }

  if (behavior === "error") {
    return { targetX: 295, targetY: 140 };
  }

  return randomRoomPoint();
};

export const expressionForBehavior = (
  behavior: BehaviorName,
): AvatarRuntime["expression"] => {
  switch (behavior) {
    case "coding":
    case "thinking":
    case "read_task_file":
      return "focused";
    case "coffee":
    case "cola":
    case "bento":
    case "fetch_task_file":
    case "carry_task_file":
      return "happy";
    case "success":
      return "sleepy";
    case "sleep":
      return "sleepy";
    case "admire":
    case "play":
    case "paint":
    case "phone":
      return "happy";
    case "error":
    case "waiting":
      return "worried";
    default:
      return "calm";
  }
};

const facingForMovement = (
  dx: number,
  dy: number,
): AvatarRuntime["facing"] => {
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy < 0 ? "back" : "front";
  }

  return dx < 0 ? "left" : "right";
};

const shouldFaceFrontAtTarget = (behavior: BehaviorName) =>
  [
    "interact",
    "coffee",
    "cola",
    "bento",
    "snack",
    "brew",
    "paint",
    "phone",
    "fetch_task_file",
    "carry_task_file",
    "read_task_file",
    "admire",
    "relax",
    "sleep",
  ].includes(behavior);

const collisionRectsForContent = (
  content: AivatarContent,
  ignoredId?: string,
): Rect[] => [
  ...content.room.furniture
    .filter((item) => item.id !== ignoredId && item.collision)
    .map((item) => item.collision!),
  ...(content.placedItems ?? [])
    .filter(
      (item) =>
        item.id !== ignoredId &&
        item.itemId === EASEL_ITEM_ID &&
        !item.surfaceFurnitureId,
    )
    .map(getPlacedItemPlacementFootBounds),
];

const pointHitsCollision = (
  x: number,
  y: number,
  content: AivatarContent,
  ignoredFurnitureId?: string,
  from?: Pick<AvatarRuntime, "x" | "y">,
) => {
  const nextFootprint = avatarFootprintBounds(x, y);

  return collisionRectsForContent(content, ignoredFurnitureId).some((collision) => {
    const hitsNext = rectsOverlap(nextFootprint, collision);
    if (!hitsNext) return false;
    if (!from) return true;

    const hitsCurrent = rectsOverlap(avatarFootprintBounds(from.x, from.y), collision);
    if (!hitsCurrent) return true;

    const centerX = collision.x + collision.width / 2;
    const centerY = collision.y + collision.height / 2;
    const currentDistance = Math.hypot(from.x - centerX, from.y - centerY);
    const nextDistance = Math.hypot(x - centerX, y - centerY);

    return nextDistance <= currentDistance;
  });
};

const isInsideRoomFloor = (point: Pick<AvatarRuntime, "x" | "y">) =>
  point.x >= 84 && point.x <= 396 && point.y >= 136 && point.y <= 292;

const segmentIntersectsRect = (
  from: Pick<AvatarRuntime, "x" | "y">,
  to: Pick<AvatarRuntime, "x" | "y">,
  rect: { x: number; y: number; width: number; height: number },
) => {
  const steps = Math.max(
    8,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 8),
  );

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;

    if (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    ) {
      return true;
    }
  }

  return false;
};

const pathHitsCollision = (
  from: Pick<AvatarRuntime, "x" | "y">,
  to: Pick<AvatarRuntime, "x" | "y">,
  content: AivatarContent,
  ignoredFurnitureId?: string,
) => {
  const steps = Math.max(
    8,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4),
  );

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    if (pointHitsCollision(x, y, content, ignoredFurnitureId, from)) return true;
  }

  return false;
};

const findBlockingCollision = (
  from: Pick<AvatarRuntime, "x" | "y">,
  to: Pick<AvatarRuntime, "x" | "y">,
  content: AivatarContent,
  ignoredFurnitureId?: string,
) =>
  collisionRectsForContent(content, ignoredFurnitureId)
    .filter((collision) =>
      pathHitsCollision(
        from,
        to,
        {
          room: {
            furniture: [{ id: "blocking", collision }],
          },
        } as AivatarContent,
      ),
    )
    .sort(
      (left, right) =>
        Math.hypot(from.x - (left.x + left.width / 2), from.y - (left.y + left.height / 2)) -
        Math.hypot(from.x - (right.x + right.width / 2), from.y - (right.y + right.height / 2)),
    )[0];

const findPathWaypoint = (
  from: Pick<AvatarRuntime, "x" | "y">,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  content: AivatarContent,
  ignoredFurnitureId?: string,
) => {
  const targetPoint = { x: target.targetX, y: target.targetY };
  const blocking = findBlockingCollision(from, targetPoint, content, ignoredFurnitureId);
  if (!blocking) return null;

  const margin = 20;
  const candidatePoints = [
    { x: blocking.x - margin, y: from.y },
    { x: blocking.x + blocking.width + margin, y: from.y },
    { x: from.x, y: blocking.y - margin },
    { x: from.x, y: blocking.y + blocking.height + margin },
    { x: blocking.x - margin, y: blocking.y - margin },
    { x: blocking.x + blocking.width + margin, y: blocking.y - margin },
    { x: blocking.x - margin, y: blocking.y + blocking.height + margin },
    { x: blocking.x + blocking.width + margin, y: blocking.y + blocking.height + margin },
  ].filter(
    (point) =>
      isInsideRoomFloor(point) &&
      !pointHitsCollision(point.x, point.y, content, ignoredFurnitureId) &&
      !pathHitsCollision(from, point, content, ignoredFurnitureId),
  );

  return candidatePoints.sort(
    (left, right) =>
      Math.hypot(left.x - targetPoint.x, left.y - targetPoint.y) +
      Math.hypot(left.x - from.x, left.y - from.y) * 0.35 -
      (Math.hypot(right.x - targetPoint.x, right.y - targetPoint.y) +
      Math.hypot(right.x - from.x, right.y - from.y) * 0.35),
  )[0] ?? null;
};

const gridColumns = Math.floor((NAV_ROOM_MAX_X - NAV_ROOM_MIN_X) / NAV_GRID_SIZE) + 1;
const gridRows = Math.floor((NAV_ROOM_MAX_Y - NAV_ROOM_MIN_Y) / NAV_GRID_SIZE) + 1;

const pointToCell = (point: Point) => ({
  col: clamp(
    Math.round((point.x - NAV_ROOM_MIN_X) / NAV_GRID_SIZE),
    0,
    gridColumns - 1,
  ),
  row: clamp(
    Math.round((point.y - NAV_ROOM_MIN_Y) / NAV_GRID_SIZE),
    0,
    gridRows - 1,
  ),
});

const cellKey = (cell: { col: number; row: number }) => `${cell.col}:${cell.row}`;

const navMemoryPointPenalty = (
  point: Point,
  navMemory?: AivatarNavMemory,
  includeVisited = false,
) => {
  if (!navMemory) return 0;
  const key = cellKey(pointToCell(point));
  return (
    Math.min(8, navMemory.trickySpots[key] ?? 0) * NAV_TRICKY_CELL_PENALTY +
    (includeVisited
      ? Math.min(20, navMemory.exploredCells[key] ?? 0) * NAV_VISITED_CELL_PENALTY
      : 0)
  );
};

const cellToPoint = (cell: { col: number; row: number }): Point => ({
  x: NAV_ROOM_MIN_X + cell.col * NAV_GRID_SIZE,
  y: NAV_ROOM_MIN_Y + cell.row * NAV_GRID_SIZE,
});

const isWalkableCell = (
  cell: { col: number; row: number },
  content: AivatarContent,
  ignoredFurnitureId?: string,
) => {
  if (
    cell.col < 0 ||
    cell.col >= gridColumns ||
    cell.row < 0 ||
    cell.row >= gridRows
  ) {
    return false;
  }

  const point = cellToPoint(cell);
  return (
    isPointInsideRoomFloor(point) &&
    !pointHitsCollision(point.x, point.y, content, ignoredFurnitureId)
  );
};

const nearestWalkableCell = (
  point: Point,
  content: AivatarContent,
  ignoredFurnitureId?: string,
) => {
  const origin = pointToCell(point);
  if (isWalkableCell(origin, content, ignoredFurnitureId)) return origin;

  for (let radius = 1; radius <= 8; radius += 1) {
    const candidates: Array<{ col: number; row: number }> = [];
    for (let dx = -radius; dx <= radius; dx += 1) {
      candidates.push({ col: origin.col + dx, row: origin.row - radius });
      candidates.push({ col: origin.col + dx, row: origin.row + radius });
    }
    for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
      candidates.push({ col: origin.col - radius, row: origin.row + dy });
      candidates.push({ col: origin.col + radius, row: origin.row + dy });
    }

    const walkable = candidates
      .filter((cell) => isWalkableCell(cell, content, ignoredFurnitureId))
      .sort(
        (left, right) =>
          Math.hypot(cellToPoint(left).x - point.x, cellToPoint(left).y - point.y) -
          Math.hypot(cellToPoint(right).x - point.x, cellToPoint(right).y - point.y),
      )[0];
    if (walkable) return walkable;
  }

  return null;
};

const findNavGridPath = (
  from: Point,
  to: Point,
  content: AivatarContent,
  ignoredFurnitureId?: string,
  navMemory?: AivatarNavMemory,
) => {
  const start = nearestWalkableCell(from, content, ignoredFurnitureId);
  const goal = nearestWalkableCell(to, content, ignoredFurnitureId);
  if (!start || !goal) return null;

  const goalKey = cellKey(goal);
  const open = [start];
  const cameFrom = new Map<string, string>();
  const cells = new Map<string, { col: number; row: number }>([
    [cellKey(start), start],
  ]);
  const gScore = new Map<string, number>([[cellKey(start), 0]]);
  const fScore = new Map<string, number>([
    [cellKey(start), Math.hypot(goal.col - start.col, goal.row - start.row)],
  ]);
  const closed = new Set<string>();

  const neighbors = [
    { col: -1, row: 0, cost: 1 },
    { col: 1, row: 0, cost: 1 },
    { col: 0, row: -1, cost: 1 },
    { col: 0, row: 1, cost: 1 },
    { col: -1, row: -1, cost: 1.4 },
    { col: 1, row: -1, cost: 1.4 },
    { col: -1, row: 1, cost: 1.4 },
    { col: 1, row: 1, cost: 1.4 },
  ];

  while (open.length > 0) {
    open.sort(
      (left, right) =>
        (fScore.get(cellKey(left)) ?? Number.POSITIVE_INFINITY) -
        (fScore.get(cellKey(right)) ?? Number.POSITIVE_INFINITY),
    );
    const current = open.shift()!;
    const currentKey = cellKey(current);
    if (currentKey === goalKey) {
      const path = [current];
      let cursor = currentKey;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        path.unshift(cells.get(cursor)!);
      }
      return path.map(cellToPoint);
    }

    closed.add(currentKey);
    for (const neighborOffset of neighbors) {
      const neighbor = {
        col: current.col + neighborOffset.col,
        row: current.row + neighborOffset.row,
      };
      if (!isWalkableCell(neighbor, content, ignoredFurnitureId)) continue;
      const neighborKey = cellKey(neighbor);
      if (closed.has(neighborKey)) continue;
      if (
        neighborOffset.col !== 0 &&
        neighborOffset.row !== 0 &&
        (!isWalkableCell(
          { col: current.col + neighborOffset.col, row: current.row },
          content,
          ignoredFurnitureId,
        ) ||
          !isWalkableCell(
            { col: current.col, row: current.row + neighborOffset.row },
            content,
            ignoredFurnitureId,
          ))
      ) {
        continue;
      }

      const currentScore = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY;
      const tentativeScore =
        currentScore +
        neighborOffset.cost +
        navMemoryPointPenalty(cellToPoint(neighbor), navMemory);
      if (tentativeScore >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, currentKey);
      cells.set(neighborKey, neighbor);
      gScore.set(neighborKey, tentativeScore);
      fScore.set(
        neighborKey,
        tentativeScore + Math.hypot(goal.col - neighbor.col, goal.row - neighbor.row),
      );
      if (!open.some((cell) => cellKey(cell) === neighborKey)) {
        open.push(neighbor);
      }
    }
  }

  return null;
};

const findNavGridWaypoint = (
  from: Point,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  content: AivatarContent,
  ignoredFurnitureId?: string,
  navMemory?: AivatarNavMemory,
) => {
  const targetPoint = { x: target.targetX, y: target.targetY };
  const path = findNavGridPath(
    from,
    targetPoint,
    content,
    ignoredFurnitureId,
    navMemory,
  );
  if (!path || path.length < 2) return null;

  return path.find((point) => Math.hypot(point.x - from.x, point.y - from.y) > 5) ?? path[1];
};

const nextPathPoint = (from: Point, path: Point[]) =>
  path.find((point) => Math.hypot(point.x - from.x, point.y - from.y) > 5) ?? null;

const findStableNavWaypoint = (
  from: Point,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  content: AivatarContent,
  behavior: BehaviorName,
  ignoredFurnitureId?: string,
  navMemory?: AivatarNavMemory,
) => {
  if (
    cachedNavWaypoint &&
    sameNavigationTarget(cachedNavWaypoint, behavior, target, ignoredFurnitureId) &&
    cachedNavWaypoint.path
  ) {
    const point = nextPathPoint(from, cachedNavWaypoint.path);
    if (
      point &&
      Math.hypot(point.x - from.x, point.y - from.y) > NAV_WAYPOINT_REACHED_DISTANCE &&
      !pathHitsCollision(from, point, content, ignoredFurnitureId)
    ) {
      return point;
    }
    cachedNavWaypoint = null;
  }

  if (
    cachedNavWaypoint &&
    sameNavigationTarget(cachedNavWaypoint, behavior, target, ignoredFurnitureId) &&
    Math.hypot(cachedNavWaypoint.point.x - from.x, cachedNavWaypoint.point.y - from.y) >
      NAV_WAYPOINT_REACHED_DISTANCE &&
    !pathHitsCollision(from, cachedNavWaypoint.point, content, ignoredFurnitureId)
  ) {
    return cachedNavWaypoint.point;
  }

  const targetPoint = { x: target.targetX, y: target.targetY };
  const path = findNavGridPath(
    from,
    targetPoint,
    content,
    ignoredFurnitureId,
    navMemory,
  );
  if (path && path.length >= 2) {
    const point = nextPathPoint(from, path) ?? path[1];
    cachedNavWaypoint = {
      behavior,
      targetX: target.targetX,
      targetY: target.targetY,
      ignoredFurnitureId,
      point,
      path,
    };
    return point;
  }

  const point =
    findNavGridWaypoint(from, target, content, ignoredFurnitureId, navMemory) ??
    findPathWaypoint(from, target, content, ignoredFurnitureId);

  cachedNavWaypoint = point
    ? {
        behavior,
        targetX: target.targetX,
        targetY: target.targetY,
        ignoredFurnitureId,
        point,
        path: undefined,
      }
    : null;

  return point;
};

const scoreLocalPoint = (
  from: Point,
  point: Point,
  target: Point,
  content: AivatarContent,
  ignoredFurnitureId?: string,
  navMemory?: AivatarNavMemory,
  actionBias = 0,
) => {
  const currentDistance = Math.hypot(target.x - from.x, target.y - from.y);
  const nextDistance = Math.hypot(target.x - point.x, target.y - point.y);
  const progress = currentDistance - nextDistance;
  const directPathBlocked = pathHitsCollision(point, target, content, ignoredFurnitureId);

  return (
    progress * 1.8 +
    actionBias +
    (directPathBlocked ? -3 : 2) -
    navMemoryPointPenalty(point, navMemory, true)
  );
};

const chooseLocalNavAction = (
  from: Point,
  movement: Point,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  alternates: Point[] | undefined,
  content: AivatarContent,
  ignoredFurnitureId?: string,
  navMemory?: AivatarNavMemory,
): LocalNavAction | null => {
  const length = Math.hypot(movement.x, movement.y);
  if (length <= 0.001) return null;

  const unitX = movement.x / length;
  const unitY = movement.y / length;
  const targetPoint = { x: target.targetX, y: target.targetY };
  const candidates: LocalNavAction[] = [];

  const addPointAction = (
    action: LocalNavActionName,
    point: Point,
    actionBias = 0,
  ) => {
    if (
      !isPointInsideRoomFloor(point) ||
      pointHitsCollision(point.x, point.y, content, ignoredFurnitureId)
    ) {
      return;
    }

    candidates.push({
      action,
      point,
      score: scoreLocalPoint(
        from,
        point,
        targetPoint,
        content,
        ignoredFurnitureId,
        navMemory,
        actionBias,
      ),
    });
  };

  for (const distance of [6, 10, 14]) {
    addPointAction(
      "sidestep-left",
      {
        x: from.x - unitY * distance,
        y: from.y + unitX * distance,
      },
      0.5,
    );
    addPointAction(
      "sidestep-right",
      {
        x: from.x + unitY * distance,
        y: from.y - unitX * distance,
      },
      0.5,
    );
  }

  for (const distance of [8, 12, 16]) {
    addPointAction(
      "backoff",
      {
        x: from.x - unitX * distance,
        y: from.y - unitY * distance,
      },
      -0.4,
    );
  }

  const replanPoint =
    findNavGridWaypoint(from, target, content, ignoredFurnitureId, navMemory) ??
    findPathWaypoint(from, target, content, ignoredFurnitureId);
  if (replanPoint) {
    candidates.push({
      action: "force-replan",
      point: replanPoint,
      score: scoreLocalPoint(
        from,
        replanPoint,
        targetPoint,
        content,
        ignoredFurnitureId,
        navMemory,
        3,
      ),
    });
  }

  const alternativeTarget = chooseAlternativeInteractionTarget(
    from,
    target,
    alternates,
    content,
    ignoredFurnitureId,
    navMemory,
  );
  if (alternativeTarget) {
    candidates.push({
      action: "switch-interaction-point",
      target: alternativeTarget,
      score:
        4 +
        scoreLocalPoint(
          from,
          alternativeTarget,
          alternativeTarget,
          content,
          ignoredFurnitureId,
          navMemory,
        ),
    });
  }

  return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
};

const chooseAlternativeInteractionTarget = (
  from: Point,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  alternates: Point[] | undefined,
  content: AivatarContent,
  ignoredFurnitureId?: string,
  navMemory?: AivatarNavMemory,
) => {
  const currentTarget = { x: target.targetX, y: target.targetY };
  const candidates = uniquePoints(alternates ?? []).filter(
    (point) =>
      !samePoint(point, currentTarget) &&
      isPointInsideRoomFloor(point) &&
      !pointHitsCollision(point.x, point.y, content, ignoredFurnitureId),
  );
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((point) => {
      const directPathBlocked = pathHitsCollision(from, point, content, ignoredFurnitureId);
      const hasWaypoint =
        !directPathBlocked ||
        Boolean(
          findNavGridWaypoint(
            from,
            { targetX: point.x, targetY: point.y },
            content,
            ignoredFurnitureId,
            navMemory,
          ) ??
            findPathWaypoint(
              from,
              { targetX: point.x, targetY: point.y },
              content,
              ignoredFurnitureId,
            ),
        );

      return {
        point,
        directPathBlocked,
        hasWaypoint,
        score:
          Math.hypot(point.x - from.x, point.y - from.y) +
          navMemoryPointPenalty(point, navMemory, true),
      };
    })
    .filter((candidate) => candidate.hasWaypoint)
    .sort((left, right) => {
      if (left.directPathBlocked !== right.directPathBlocked) {
        return left.directPathBlocked ? 1 : -1;
      }
      return left.score - right.score;
    });

  return scored[0]?.point ?? null;
};

export const setBehavior = (
  avatar: AvatarRuntime,
  behavior: BehaviorName,
  content: AivatarContent,
  timer = 5,
  activityLabel?: string,
): AvatarRuntime => {
  const from = { x: avatar.x, y: avatar.y };
  const target = targetForBehavior(behavior, content, from);
  const alternates = behaviorInteractionAlternates(behavior, content, from);

  return {
    ...avatar,
    ...target,
    behavior,
    behaviorTimer: timer,
    facing: shouldFaceFrontAtTarget(behavior) ? "front" : avatar.facing,
    expression: expressionForBehavior(behavior),
    activityLabel,
    interactionTargetAlternates: alternates && alternates.length > 1 ? alternates : undefined,
  };
};

export const setFurnitureBehavior = (
  avatar: AvatarRuntime,
  furniture: FurnitureDefinition,
  timer = 5,
  options?: {
    behavior?: BehaviorName;
    facing?: AvatarRuntime["facing"];
    content?: AivatarContent;
  },
): AvatarRuntime => {
  const behavior = options?.behavior ?? furniture.interaction;
  const fallback = getFurnitureInteractionTarget(furniture, behavior);
  const standpoints = options?.content
    ? getFurnitureInteractionStandpoints(furniture, options.content, behavior)
    : [];
  const point = options?.content
    ? chooseNearestPoint(
        { x: fallback.targetX, y: fallback.targetY },
        standpoints,
        { x: fallback.targetX, y: fallback.targetY },
      )
    : { x: fallback.targetX, y: fallback.targetY };

  return {
    ...avatar,
    targetX: point.x,
    targetY: point.y,
    facing: options?.facing ?? "front",
    behavior,
    behaviorTimer: timer,
    expression: expressionForBehavior(behavior),
    activityLabel: undefined,
    interactionTargetAlternates: standpoints.length > 1 ? standpoints : undefined,
  };
};

const activityLabelForBehavior = (behavior: BehaviorName): string => {
  switch (behavior) {
    case "sleep":
      return "Taking a nap";
    case "snack":
      return "Checking snacks";
    case "brew":
      return "Brewing coffee";
    case "coffee":
      return "Drinking coffee";
    case "cola":
      return "Drinking cola";
    case "bento":
      return "Eating bento";
    case "admire":
      return "Admiring decor";
    case "relax":
      return "Relaxing";
    case "play":
      return "Playing games";
    case "paint":
      return "Painting";
    case "phone":
      return "Checking phone";
    case "explore":
      return "Exploring";
    case "wander":
      return "Wandering";
    case "interact":
      return "Looking around";
    default:
      return "Idle";
  }
};

const traitInfluence = (value: number | undefined, max: number, divisor: number) =>
  Math.min(max, Math.max(0, (value ?? 0) / divisor));

const chooseAutonomousBehavior = (
  content: AivatarContent,
  memory?: AivatarMemory,
): BehaviorName => {
  const roll = Math.random();
  const placedItems = content.placedItems ?? [];
  const hasDecor = placedItems.length > 0;
  const hasGameConsole = placedItems.some((item) => item.itemId === "game-console");
  const hasCoffeeMachine = placedItems.some((item) => item.itemId === "coffee-machine");
  const hasEasel = placedItems.some((item) => item.itemId === EASEL_ITEM_ID);
  const coffeeCount =
    content.inventory.find((entry) => entry.itemId === "coffee")?.quantity ?? 0;
  const traits = memory?.growth.traits;
  const curiosityBoost = traitInfluence(traits?.curiosity, 0.18, 500);
  const efficiencyBoost = traitInfluence(traits?.efficiency, 0.14, 600);
  const focusBoost = traitInfluence(traits?.focus, 0.12, 700);
  const resilienceBoost = traitInfluence(traits?.resilience, 0.12, 700);
  const creativityBoost = traitInfluence(traits?.creativity, 0.16, 500);
  const canExplore =
    content.petStats.energy > EXPLORE_MIN_ENERGY &&
    content.petStats.mood > EXPLORE_MIN_MOOD &&
    content.petStats.hunger > EXPLORE_MIN_HUNGER;

  if (content.petStats.energy < 24 && coffeeCount > 0) return "snack";
  if (content.petStats.energy < 24) return "sleep";
  if (hasCoffeeMachine && coffeeCount < 2 && roll < 0.72 + efficiencyBoost) return "brew";
  if (content.petStats.hunger < 24 && roll < 0.7) return "snack";
  if (content.petStats.mood < 50 && hasGameConsole && roll < 0.78 + resilienceBoost + efficiencyBoost) return "play";
  if (content.petStats.mood < 50 && hasEasel && roll < 0.72 + creativityBoost) return "paint";
  if (content.petStats.mood < 34 && hasDecor && roll < 0.72 + curiosityBoost) return "admire";
  if (content.petStats.mood < 34 && roll < 0.72 + resilienceBoost) return "play";
  if (content.petStats.energy < 42 && roll < 0.6 + focusBoost) return "relax";

  if (hasGameConsole && roll < 0.28 + efficiencyBoost) return "play";
  if (hasEasel && roll < 0.32 + creativityBoost) return "paint";
  if (hasCoffeeMachine && coffeeCount < 5 && roll < 0.34 + efficiencyBoost) return "brew";
  if (canExplore && roll < EXPLORE_CHANCE + curiosityBoost * 0.3) return "explore";
  if (hasDecor && roll < 0.24 + curiosityBoost) return "admire";
  if (roll < 0.3 + curiosityBoost) return "interact";
  if (roll < 0.42) return "wander";
  if (roll < 0.5) return "phone";
  if (roll < 0.6 - focusBoost * 0.5) return "snack";
  if (roll < 0.78 + focusBoost) return "relax";
  if (roll < 0.9 + resilienceBoost) return "play";
  return "interact";
};

export const tickAvatar = (
  avatar: AvatarRuntime,
  content: AivatarContent,
  codexStatus: CodexStatusMessage,
  elapsedSeconds: number,
  memory?: AivatarMemory,
  options?: {
    ignoredFurnitureId?: string;
    navMemory?: AivatarNavMemory;
  },
): AvatarRuntime => {
  const forcedBehavior = deriveBehaviorFromCodex(codexStatus);
  let next = avatar;

  if (
    forcedBehavior &&
    (avatar.behavior !== forcedBehavior ||
      (forcedBehavior === "wander" && avatar.behaviorTimer <= 0))
  ) {
    next = setBehavior(
      avatar,
      forcedBehavior,
      content,
      forcedBehavior === "success" ? 3 : 8,
      undefined,
    );
  } else if (!forcedBehavior && avatar.behaviorTimer <= 0) {
    const autonomous = chooseAutonomousBehavior(content, memory);
    next = setBehavior(
      avatar,
      autonomous,
      content,
      autonomous === "explore" ? 12 + Math.random() * 6 : 4 + Math.random() * 5,
      activityLabelForBehavior(autonomous),
    );
  }

  const ignoredFurnitureId =
    options?.ignoredFurnitureId ?? (next.behavior === "sleep" ? "bed" : undefined);
  const waypoint = findStableNavWaypoint(
    { x: next.x, y: next.y },
    { targetX: next.targetX, targetY: next.targetY },
    content,
    next.behavior,
    ignoredFurnitureId,
    options?.navMemory,
  );
  const movementTarget = waypoint
    ? { targetX: waypoint.x, targetY: waypoint.y }
    : { targetX: next.targetX, targetY: next.targetY };
  const dx = movementTarget.targetX - next.x;
  const dy = movementTarget.targetY - next.y;
  const distance = Math.hypot(dx, dy);
  const speed =
    next.behavior === "sleep" || next.behavior === "coding" || next.behavior === "admire"
      ? 28
      : 48;
  const step = Math.min(distance, speed * elapsedSeconds);

  if (distance > 0.5) {
    const nextX = next.x + (dx / distance) * step;
    const nextY = next.y + (dy / distance) * step;
    const canMoveDirectly = !pointHitsCollision(
      nextX,
      nextY,
      content,
      ignoredFurnitureId,
      next,
    );
    const canSlideX = !pointHitsCollision(
      nextX,
      next.y,
      content,
      ignoredFurnitureId,
      next,
    );
    const canSlideY = !pointHitsCollision(
      next.x,
      nextY,
      content,
      ignoredFurnitureId,
      next,
    );
    const movedX = canMoveDirectly || canSlideX ? nextX : next.x;
    const movedY = canMoveDirectly || (!canSlideX && canSlideY) ? nextY : next.y;
    const actualMoveDistance = Math.hypot(movedX - next.x, movedY - next.y);
    const ineffectiveMove = distance > 4 && actualMoveDistance < step * 0.25;
    const localAction =
      !canMoveDirectly || ineffectiveMove
        ? chooseLocalNavAction(
            { x: next.x, y: next.y },
            { x: dx, y: dy },
            { targetX: next.targetX, targetY: next.targetY },
            next.interactionTargetAlternates,
            content,
            ignoredFurnitureId,
            options?.navMemory,
          )
        : null;

    if (localAction?.action === "switch-interaction-point" && localAction.target) {
      cachedNavWaypoint = null;
      const failedTarget = { x: next.targetX, y: next.targetY };
      next = {
        ...next,
        targetX: localAction.target.x,
        targetY: localAction.target.y,
        facing: facingForMovement(dx, dy),
        interactionTargetAlternates: next.interactionTargetAlternates?.filter(
          (point) => !samePoint(point, failedTarget),
        ),
      };
    } else if (localAction?.action === "force-replan" && localAction.point) {
      cachedNavWaypoint = {
        behavior: next.behavior,
        targetX: next.targetX,
        targetY: next.targetY,
        ignoredFurnitureId,
        point: localAction.point,
      };
      next = {
        ...next,
        facing: facingForMovement(dx, dy),
      };
    } else if (localAction?.point) {
      cachedNavWaypoint = null;
      next = {
        ...next,
        x: localAction.point.x,
        y: localAction.point.y,
        facing: facingForMovement(
          localAction.point.x - next.x,
          localAction.point.y - next.y,
        ),
      };
    } else {
      const movedEnoughToFace = actualMoveDistance >= MIN_VISIBLE_MOVE_DISTANCE;
      next = {
        ...next,
        x: movedX,
        y: movedY,
        facing: movedEnoughToFace
          ? facingForMovement(movedX - next.x, movedY - next.y)
          : next.facing,
      };
    }
  }

  return {
    ...next,
    facing:
      distance <= 8 && next.behavior === "coding"
        ? "back"
        : distance <= 1 && shouldFaceFrontAtTarget(next.behavior)
          ? "front"
          : next.facing,
    behaviorTimer: next.behaviorTimer - elapsedSeconds,
  };
};

export const applyConsumableEffect = (
  stats: PetStats,
  effect: Partial<PetStats> = {},
): PetStats => applyPetStatEffect(stats, effect);
