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
const NAV_ROOM_MAX_Y = 300;
const AVATAR_FOOTPRINT_HALF_WIDTH = 6;
const AVATAR_FOOTPRINT_TOP_OFFSET = 6;
const AVATAR_FOOTPRINT_HEIGHT = 8;
const INTERACTION_STANDPOINT_DISTANCE = 22;
const ACTION_EXECUTION_DISTANCE = 8;
const COLLISION_EDGE_EPSILON = 0.5;
const NAV_WAYPOINT_REACHED_DISTANCE = 7;
const MIN_VISIBLE_MOVE_DISTANCE = 1.25;
const REPLAN_PAUSE_SECONDS = 0.35;
const BLOCKED_TARGET_ABANDON_SECONDS = 2.4;
const COMPLETE_VISUAL_SECONDS = 2.2;
const EXPLORE_MIN_ENERGY = 35;
const EXPLORE_MIN_MOOD = 30;
const EXPLORE_MIN_HUNGER = 25;
const EXPLORE_CHANCE = 0.12;
const NAV_TRICKY_CELL_PENALTY = 2.2;
const NAV_VISITED_CELL_PENALTY = 0.08;
const NAV_PLANNING_CLEARANCE = 4;
const NAV_CORRIDOR_CLEARANCE = NAV_PLANNING_CLEARANCE;
const INTERACTION_SAFE_GAP = AVATAR_FOOTPRINT_HALF_WIDTH + NAV_PLANNING_CLEARANCE + 4;
const CLOSE_INTERACTION_STANDPOINT_DISTANCE = INTERACTION_SAFE_GAP / 2;
const TERMINAL_SURFACE_STANDPOINT_DISTANCE =
  Math.max(0, AVATAR_FOOTPRINT_HALF_WIDTH + NAV_PLANNING_CLEARANCE + 1 - NAV_GRID_SIZE);
const DESK_CLOSE_STANDPOINT_DISTANCE = CLOSE_INTERACTION_STANDPOINT_DISTANCE;
const DESK_FRONT_STANDPOINT_DISTANCE = CLOSE_INTERACTION_STANDPOINT_DISTANCE;
const FURNITURE_CLOSE_STANDPOINT_DISTANCE = CLOSE_INTERACTION_STANDPOINT_DISTANCE;
const SURFACE_ITEM_CLOSE_STANDPOINT_DISTANCE = CLOSE_INTERACTION_STANDPOINT_DISTANCE;
const SOFT_COLLISION_BACKOFF_DISTANCE = 5;
const SOFT_COLLISION_REPLAN_PAUSE_SECONDS = 0.28;
const NAV_STALL_SECONDS = BLOCKED_TARGET_ABANDON_SECONDS;
const NAV_STALL_MIN_PROGRESS = 0.8;
const NAV_ACTION_STALL_FAILSAFE_LIMIT = 3;
const ARRIVAL_GATED_BEHAVIORS: BehaviorName[] = [
  "sleep",
  "interact",
  "coffee",
  "cola",
  "bento",
  "brew",
  "relax",
  "admire",
  "snack",
  "paint",
  "play",
  "thinking",
  "coding",
  "fetch_task_file",
  "carry_task_file",
  "read_task_file",
];

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

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

let cachedReplanPause:
  | {
      behavior: BehaviorName;
      targetX: number;
      targetY: number;
      ignoredFurnitureId?: string;
      remainingSeconds: number;
    }
  | null = null;

let cachedBlockedTarget:
  | {
      behavior: BehaviorName;
      targetX: number;
      targetY: number;
      ignoredFurnitureId?: string;
      elapsedSeconds: number;
    }
  | null = null;

let cachedNavigationProgress:
  | {
      behavior: BehaviorName;
      targetX: number;
      targetY: number;
      ignoredFurnitureId?: string;
      bestDistance: number;
      stalledSeconds: number;
    }
  | null = null;

let cachedActionNavigationFailsafe:
  | {
      behavior: BehaviorName;
      ignoredFurnitureId?: string;
      stalls: number;
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

const sameReplanPauseTarget = (
  cache: NonNullable<typeof cachedReplanPause>,
  behavior: BehaviorName,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  ignoredFurnitureId?: string,
) =>
  cache.behavior === behavior &&
  cache.ignoredFurnitureId === ignoredFurnitureId &&
  Math.abs(cache.targetX - target.targetX) <= 1 &&
  Math.abs(cache.targetY - target.targetY) <= 1;

const sameBlockedTarget = (
  cache: NonNullable<typeof cachedBlockedTarget>,
  behavior: BehaviorName,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  ignoredFurnitureId?: string,
) =>
  cache.behavior === behavior &&
  cache.ignoredFurnitureId === ignoredFurnitureId &&
  Math.abs(cache.targetX - target.targetX) <= 1 &&
  Math.abs(cache.targetY - target.targetY) <= 1;

const recordBlockedTarget = (
  behavior: BehaviorName,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  ignoredFurnitureId: string | undefined,
  elapsedSeconds: number,
) => {
  if (
    cachedBlockedTarget &&
    sameBlockedTarget(cachedBlockedTarget, behavior, target, ignoredFurnitureId)
  ) {
    cachedBlockedTarget.elapsedSeconds += elapsedSeconds;
  } else {
    cachedBlockedTarget = {
      behavior,
      targetX: target.targetX,
      targetY: target.targetY,
      ignoredFurnitureId,
      elapsedSeconds,
    };
  }

  return cachedBlockedTarget.elapsedSeconds >= BLOCKED_TARGET_ABANDON_SECONDS;
};

const clearBlockedTarget = () => {
  cachedBlockedTarget = null;
};

const clearNavigationProgress = () => {
  cachedNavigationProgress = null;
};

const clearActionNavigationFailsafe = () => {
  cachedActionNavigationFailsafe = null;
};

const recordActionNavigationStall = (
  behavior: BehaviorName,
  ignoredFurnitureId: string | undefined,
) => {
  if (
    cachedActionNavigationFailsafe &&
    cachedActionNavigationFailsafe.behavior === behavior &&
    cachedActionNavigationFailsafe.ignoredFurnitureId === ignoredFurnitureId
  ) {
    cachedActionNavigationFailsafe.stalls += 1;
  } else {
    cachedActionNavigationFailsafe = {
      behavior,
      ignoredFurnitureId,
      stalls: 1,
    };
  }

  return cachedActionNavigationFailsafe.stalls >= NAV_ACTION_STALL_FAILSAFE_LIMIT;
};

const pauseForNavigationReplan = (
  avatar: AvatarRuntime,
  behavior: BehaviorName,
  ignoredFurnitureId: string | undefined,
  elapsedSeconds: number,
): AvatarRuntime => {
  cachedNavWaypoint = null;
  cachedReplanPause = {
    behavior,
    targetX: avatar.targetX,
    targetY: avatar.targetY,
    ignoredFurnitureId,
    remainingSeconds: SOFT_COLLISION_REPLAN_PAUSE_SECONDS,
  };

  return {
    ...avatar,
    expression: "focused",
    activityLabel: "Planning route",
    behaviorTimer: avatar.actionIntent
      ? avatar.behaviorTimer
      : avatar.behaviorTimer - elapsedSeconds,
  };
};

const fallbackBehaviorAfterBlockedTarget = (behavior: BehaviorName): BehaviorName =>
  behavior === "wander" ? "phone" : "wander";

const activeBehaviorForRuntime = (avatar: AvatarRuntime): BehaviorName =>
  avatar.actionIntent ?? avatar.behavior;

const behaviorWaitsForArrival = (behavior: BehaviorName) =>
  ARRIVAL_GATED_BEHAVIORS.includes(behavior);

const clearNavigationFailure = (avatar: AvatarRuntime): AvatarRuntime => ({
  ...avatar,
  navigationFailure: undefined,
});

const recordNavigationProgress = (
  behavior: BehaviorName,
  target: Point,
  current: Point,
  ignoredFurnitureId: string | undefined,
  elapsedSeconds: number,
) => {
  const distance = Math.hypot(target.x - current.x, target.y - current.y);
  const progress = cachedNavigationProgress;
  const sameTarget =
    progress &&
    progress.behavior === behavior &&
    progress.ignoredFurnitureId === ignoredFurnitureId &&
    Math.abs(progress.targetX - target.x) <= 1 &&
    Math.abs(progress.targetY - target.y) <= 1;

  if (!sameTarget || !progress) {
    cachedNavigationProgress = {
      behavior,
      targetX: target.x,
      targetY: target.y,
      ignoredFurnitureId,
      bestDistance: distance,
      stalledSeconds: 0,
    };
    return false;
  }

  if (distance < progress.bestDistance - NAV_STALL_MIN_PROGRESS) {
    progress.bestDistance = distance;
    progress.stalledSeconds = 0;
    return false;
  }

  progress.stalledSeconds += elapsedSeconds;
  return progress.stalledSeconds >= NAV_STALL_SECONDS;
};

const avatarCollisionPoint = (x: number, y: number): Point => ({
  x,
  y: y + AVATAR_FOOTPRINT_TOP_OFFSET + AVATAR_FOOTPRINT_HEIGHT / 2,
});

const inflatedCollisionRect = (rect: Rect, clearance = 0): Rect => {
  const insetX = AVATAR_FOOTPRINT_HALF_WIDTH + clearance;
  const insetY = AVATAR_FOOTPRINT_HEIGHT / 2 + clearance;

  return {
    x: rect.x - insetX,
    y: rect.y - insetY,
    width: rect.width + insetX * 2,
    height: rect.height + insetY * 2,
  };
};

const pointInsideRect = (point: Point, rect: Rect) =>
  point.x > rect.x + COLLISION_EDGE_EPSILON &&
  point.x < rect.x + rect.width - COLLISION_EDGE_EPSILON &&
  point.y > rect.y + COLLISION_EDGE_EPSILON &&
  point.y < rect.y + rect.height - COLLISION_EDGE_EPSILON;

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

const clampNavigationPoint = (point: Point): Point => ({
  x: clamp(point.x, NAV_ROOM_MIN_X, NAV_ROOM_MAX_X),
  y: clamp(point.y, NAV_ROOM_MIN_Y, NAV_ROOM_MAX_Y),
});

export const explorationCellKey = (point: Point) => {
  const cell = pointToCell(point);
  return `${cell.col}:${cell.row}`;
};

export const navigationLayoutFingerprint = (content: AivatarContent) =>
  JSON.stringify({
    furniture: content.room.furniture
      .map((item) => ({
        id: item.id,
        collision: item.collision,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    blockers: (content.placedItems ?? [])
      .filter((item) => item.itemId === EASEL_ITEM_ID && !item.surfaceFurnitureId)
      .map((item) => ({
        id: item.id,
        itemId: item.itemId,
        bounds: getPlacedItemPlacementFootBounds(item),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });

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
  clearance = 0,
) =>
  uniquePoints(points)
    .map((point) => ({
      x: clamp(point.x, NAV_ROOM_MIN_X, NAV_ROOM_MAX_X),
      y: clamp(point.y, NAV_ROOM_MIN_Y, NAV_ROOM_MAX_Y),
    }))
    .filter(
      (point) =>
        isPointInsideRoomFloor(point) &&
        !pointHitsCollision(point.x, point.y, content, ignoredFurnitureId, clearance),
    );

export const getFurnitureInteractionStandpoints = (
  furniture: FurnitureDefinition,
  content: AivatarContent,
  behavior: BehaviorName | string = furniture.interaction,
): Point[] => {
  if (furniture.id === "bed" && (behavior === "sleep" || behavior === "relax")) {
    return validStandpoints(
      [
        { x: furniture.x + furniture.width / 2, y: furniture.y + 50 },
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
          ? TERMINAL_SURFACE_STANDPOINT_DISTANCE
          : SURFACE_ITEM_CLOSE_STANDPOINT_DISTANCE;
      const surfaceStandpoints =
        usesItemOnlySurfaceStandpoints
          ? []
          : getFurnitureInteractionStandpoints(surface, content);
      const frontStandpoints = [
        { x: itemX, y: bounds.y + bounds.height + itemDistance },
        ...(item.itemId === TERMINAL_MONITOR_ITEM_ID
          ? []
          : [
              { x: itemX - 22, y: bounds.y + bounds.height + itemDistance },
              { x: itemX + 22, y: bounds.y + bounds.height + itemDistance },
            ]),
      ];
      const sideStandpoints =
        item.itemId === "coffee-machine" || item.itemId === TERMINAL_MONITOR_ITEM_ID
          ? []
          : [
              { x: bounds.x - itemDistance, y: bounds.y + bounds.height * 0.72 },
              { x: bounds.x + bounds.width + itemDistance, y: bounds.y + bounds.height * 0.72 },
            ];
      return validStandpoints(
        [
          ...frontStandpoints,
          ...sideStandpoints,
          ...surfaceStandpoints,
        ],
        content,
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
  from?: Point,
): Pick<AvatarRuntime, "targetX" | "targetY"> => {
  if (!item) return randomRoomPoint();
  const fallback = clampNavigationPoint({ x: item.x + 18, y: item.y + 14 });

  if (content) {
    const standpoints = getPlacedItemInteractionStandpoints(item, content);
    if (standpoints.length > 0) {
      const point = chooseNearestPoint(
        from ?? { x: item.x, y: item.y },
        standpoints,
        fallback,
      );
      return { targetX: point.x, targetY: point.y };
    }
  }

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

  return { targetX: fallback.x, targetY: fallback.y };
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
  if (behavior === "success") {
    return { targetX: from.x, targetY: from.y };
  }

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
    return targetNearPlacedItem(terminal, content, from);
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
    return targetNearPlacedItem(terminal, content, from);
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
    return targetNearPlacedItem(coffeeMachine, content, from);
  }

  if (behavior === "relax") {
    const bed = content.room.furniture.find((item) => item.id === "bed");
    return targetNearFurniture(bed, { targetX: 126, targetY: 154 });
  }

  if (behavior === "admire") {
    const placedItems = content.placedItems ?? [];
    const item = placedItems[Math.floor(Math.random() * placedItems.length)];
    return targetNearPlacedItem(item, content, from);
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
        from,
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
    return targetNearPlacedItem(easel, content, from);
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

const failNavigationTarget = (
  avatar: AvatarRuntime,
  content: AivatarContent,
  behavior: BehaviorName,
  forcedBehavior: BehaviorName | null,
  reason: "blocked" | "stalled",
): AvatarRuntime => {
  cachedNavWaypoint = null;
  cachedReplanPause = null;
  clearNavigationProgress();
  clearBlockedTarget();
  clearActionNavigationFailsafe();

  const failure = {
    behavior,
    targetX: avatar.targetX,
    targetY: avatar.targetY,
    reason,
  };

  if (forcedBehavior) {
    return {
      ...avatar,
      targetX: avatar.x,
      targetY: avatar.y,
      behavior: forcedBehavior,
      behaviorTimer: Math.max(avatar.behaviorTimer, 4),
      facing:
        forcedBehavior === "coding" || forcedBehavior === "thinking"
          ? "back"
          : avatar.facing,
      expression: expressionForBehavior(forcedBehavior),
      activityLabel: activityLabelForBehavior(forcedBehavior),
      actionIntent: undefined,
      actionActivityLabel: undefined,
      interactionTargetAlternates: undefined,
      navigationFailure: failure,
    };
  }

  return {
    ...setBehavior(
      avatar,
      fallbackBehaviorAfterBlockedTarget(avatar.behavior),
      content,
      4,
      "Trying something else",
    ),
    navigationFailure: failure,
  };
};

const interactionStopDistanceForBehavior = (behavior: BehaviorName) => {
  if (
    [
      "interact",
      "coffee",
      "cola",
      "bento",
      "snack",
      "brew",
      "paint",
      "play",
      "relax",
      "sleep",
      "admire",
      "fetch_task_file",
      "carry_task_file",
      "read_task_file",
    ].includes(behavior)
  ) {
    return ACTION_EXECUTION_DISTANCE;
  }

  if (behavior === "coding" || behavior === "thinking") return 8;
  return 0;
};

const isAtInteractionRange = (avatar: AvatarRuntime) => {
  const stopDistance = interactionStopDistanceForBehavior(activeBehaviorForRuntime(avatar));
  if (stopDistance <= 0) return false;

  return Math.hypot(avatar.x - avatar.targetX, avatar.y - avatar.targetY) <= stopDistance;
};

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
  clearance = 0,
) => {
  const point = avatarCollisionPoint(x, y);

  return collisionRectsForContent(content, ignoredFurnitureId).some((collision) =>
    pointInsideRect(point, inflatedCollisionRect(collision, clearance)),
  );
};

const pointCanEscapeCollision = (
  x: number,
  y: number,
  content: AivatarContent,
  ignoredFurnitureId: string | undefined,
  from: Pick<AvatarRuntime, "x" | "y">,
) => {
  const nextPoint = avatarCollisionPoint(x, y);
  const currentPoint = avatarCollisionPoint(from.x, from.y);

  return !collisionRectsForContent(content, ignoredFurnitureId).some((collision) => {
    const inflated = inflatedCollisionRect(collision);
    const hitsNext = pointInsideRect(nextPoint, inflated);
    if (!hitsNext) return false;

    const hitsCurrent = pointInsideRect(currentPoint, inflated);
    if (!hitsCurrent) return true;

    const centerX = collision.x + collision.width / 2;
    const centerY = collision.y + collision.height / 2;
    const currentDistance = Math.hypot(currentPoint.x - centerX, currentPoint.y - centerY);
    const nextDistance = Math.hypot(nextPoint.x - centerX, nextPoint.y - centerY);

    return nextDistance <= currentDistance;
  });
};

const collisionPenetrationDepth = (
  x: number,
  y: number,
  content: AivatarContent,
  ignoredFurnitureId?: string,
) => {
  const point = avatarCollisionPoint(x, y);

  return collisionRectsForContent(content, ignoredFurnitureId).reduce(
    (deepest, collision) => {
      const inflated = inflatedCollisionRect(collision);
      if (!pointInsideRect(point, inflated)) return deepest;

      const depth = Math.min(
        point.x - inflated.x,
        inflated.x + inflated.width - point.x,
        point.y - inflated.y,
        inflated.y + inflated.height - point.y,
      );

      return Math.max(deepest, depth);
    },
    0,
  );
};

const pointCanSlideAlongCollisionEdge = (
  from: Point,
  to: Point,
  content: AivatarContent,
  ignoredFurnitureId?: string,
) => {
  if (!isPointInsideRoomFloor(to)) return false;

  const currentDepth = collisionPenetrationDepth(
    from.x,
    from.y,
    content,
    ignoredFurnitureId,
  );
  const nextDepth = collisionPenetrationDepth(
    to.x,
    to.y,
    content,
    ignoredFurnitureId,
  );

  if (currentDepth <= 0) {
    return !pointHitsCollision(to.x, to.y, content, ignoredFurnitureId);
  }

  return nextDepth <= currentDepth + 0.75;
};

const softCollisionBackoffPoint = (
  from: Point,
  movement: Point,
  content: AivatarContent,
  ignoredFurnitureId?: string,
) => {
  const distance = Math.hypot(movement.x, movement.y);
  if (distance <= 0.001) return null;

  const unitX = movement.x / distance;
  const unitY = movement.y / distance;
  const candidates = [
    {
      x: from.x - unitX * SOFT_COLLISION_BACKOFF_DISTANCE,
      y: from.y - unitY * SOFT_COLLISION_BACKOFF_DISTANCE,
    },
    {
      x: from.x - unitX * SOFT_COLLISION_BACKOFF_DISTANCE - unitY * 3,
      y: from.y - unitY * SOFT_COLLISION_BACKOFF_DISTANCE + unitX * 3,
    },
    {
      x: from.x - unitX * SOFT_COLLISION_BACKOFF_DISTANCE + unitY * 3,
      y: from.y - unitY * SOFT_COLLISION_BACKOFF_DISTANCE - unitX * 3,
    },
  ];

  return (
    candidates.find(
      (point) =>
        isPointInsideRoomFloor(point) &&
        !pointHitsCollision(point.x, point.y, content, ignoredFurnitureId),
    ) ?? null
  );
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
  clearance = 0,
) => {
  const steps = Math.max(
    8,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4),
  );

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    if (pointHitsCollision(x, y, content, ignoredFurnitureId, clearance)) return true;
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
      !pathHitsCollision(
        from,
        point,
        content,
        ignoredFurnitureId,
        NAV_CORRIDOR_CLEARANCE,
      ),
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

const learnedCellValue = (
  cell: { col: number; row: number },
  content: AivatarContent,
  navMemory?: AivatarNavMemory,
) => {
  if (!navMemory?.walkableCells) return undefined;
  if (navMemory.layoutFingerprint !== navigationLayoutFingerprint(content)) return undefined;
  return navMemory.walkableCells[cellKey(cell)];
};

const navMemoryPointPenalty = (
  point: Point,
  navMemory?: AivatarNavMemory,
  includeVisited = false,
) => {
  void point;
  void navMemory;
  void includeVisited;
  return 0;
};

const cellToPoint = (cell: { col: number; row: number }): Point => ({
  x: NAV_ROOM_MIN_X + cell.col * NAV_GRID_SIZE,
  y: NAV_ROOM_MIN_Y + cell.row * NAV_GRID_SIZE,
});

const isWalkableCell = (
  cell: { col: number; row: number },
  content: AivatarContent,
  ignoredFurnitureId?: string,
  clearance = 0,
  navMemory?: AivatarNavMemory,
  ignoreLearnedGrid = false,
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
  if (!ignoreLearnedGrid && learnedCellValue(cell, content, navMemory) === 1) {
    return false;
  }

  return (
    isPointInsideRoomFloor(point) &&
    !pointHitsCollision(point.x, point.y, content, ignoredFurnitureId, clearance)
  );
};

const nearestWalkableCell = (
  point: Point,
  content: AivatarContent,
  ignoredFurnitureId?: string,
  clearance = 0,
  navMemory?: AivatarNavMemory,
  ignoreLearnedGrid = false,
) => {
  const origin = pointToCell(point);
  if (
    isWalkableCell(
      origin,
      content,
      ignoredFurnitureId,
      clearance,
      navMemory,
      ignoreLearnedGrid,
    )
  ) {
    return origin;
  }

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
      .filter((cell) =>
        isWalkableCell(
          cell,
          content,
          ignoredFurnitureId,
          clearance,
          navMemory,
          ignoreLearnedGrid,
        ),
      )
      .sort(
        (left, right) =>
          Math.hypot(cellToPoint(left).x - point.x, cellToPoint(left).y - point.y) -
          Math.hypot(cellToPoint(right).x - point.x, cellToPoint(right).y - point.y),
      )[0];
    if (walkable) return walkable;
  }

  return null;
};

const nearestWalkablePoint = (
  point: Point,
  content: AivatarContent,
  ignoredFurnitureId?: string,
) => {
  const cell = nearestWalkableCell(point, content, ignoredFurnitureId);
  return cell ? cellToPoint(cell) : null;
};

const findNavGridPath = (
  from: Point,
  to: Point,
  content: AivatarContent,
  ignoredFurnitureId?: string,
  navMemory?: AivatarNavMemory,
  ignoreLearnedGrid = false,
) => {
  const start = nearestWalkableCell(
    from,
    content,
    ignoredFurnitureId,
    NAV_PLANNING_CLEARANCE,
    navMemory,
    ignoreLearnedGrid,
  );
  const goal = nearestWalkableCell(
    to,
    content,
    ignoredFurnitureId,
    NAV_PLANNING_CLEARANCE,
    navMemory,
    ignoreLearnedGrid,
  );
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
      if (
        !isWalkableCell(
          neighbor,
          content,
          ignoredFurnitureId,
          NAV_PLANNING_CLEARANCE,
          navMemory,
          ignoreLearnedGrid,
        )
      ) continue;
      const neighborKey = cellKey(neighbor);
      if (closed.has(neighborKey)) continue;
      if (
        neighborOffset.col !== 0 &&
        neighborOffset.row !== 0 &&
        (!isWalkableCell(
          { col: current.col + neighborOffset.col, row: current.row },
          content,
          ignoredFurnitureId,
          NAV_PLANNING_CLEARANCE,
          navMemory,
          ignoreLearnedGrid,
        ) ||
          !isWalkableCell(
            { col: current.col, row: current.row + neighborOffset.row },
            content,
            ignoredFurnitureId,
            NAV_PLANNING_CLEARANCE,
            navMemory,
            ignoreLearnedGrid,
          ))
      ) {
        continue;
      }
      if (
        pathHitsCollision(
          cellToPoint(current),
          cellToPoint(neighbor),
          content,
          ignoredFurnitureId,
          NAV_PLANNING_CLEARANCE,
        )
      ) {
        continue;
      }

      const currentScore = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY;
      const tentativeScore =
        currentScore +
        neighborOffset.cost;
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

export const getNavigationDebugPath = (
  avatar: AvatarRuntime,
  content: AivatarContent,
  ignoredFurnitureId?: string,
) =>
  findNavGridPath(
    { x: avatar.x, y: avatar.y },
    { x: avatar.targetX, y: avatar.targetY },
    content,
    ignoredFurnitureId ?? (activeBehaviorForRuntime(avatar) === "sleep" ? "bed" : undefined),
  ) ?? [];

const findNavGridWaypoint = (
  from: Point,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  content: AivatarContent,
  ignoredFurnitureId?: string,
  navMemory?: AivatarNavMemory,
  ignoreLearnedGrid = false,
) => {
  const targetPoint = { x: target.targetX, y: target.targetY };
  const path = findNavGridPath(
    from,
    targetPoint,
    content,
    ignoredFurnitureId,
    navMemory,
    ignoreLearnedGrid,
  );
  if (!path || path.length < 2) return null;

  return path.find((point) => Math.hypot(point.x - from.x, point.y - from.y) > 5) ?? path[1];
};

const nextPathPoint = (from: Point, path: Point[]) => {
  if (path.length === 0) return null;

  const nearestIndex = path.reduce((bestIndex, point, index) => {
    const bestPoint = path[bestIndex];
    return Math.hypot(point.x - from.x, point.y - from.y) <
      Math.hypot(bestPoint.x - from.x, bestPoint.y - from.y)
      ? index
      : bestIndex;
  }, 0);

  for (let index = nearestIndex + 1; index < path.length; index += 1) {
    const point = path[index];
    if (Math.hypot(point.x - from.x, point.y - from.y) > NAV_WAYPOINT_REACHED_DISTANCE) {
      return point;
    }
  }

  const finalPoint = path[path.length - 1];
  return Math.hypot(finalPoint.x - from.x, finalPoint.y - from.y) >
    NAV_WAYPOINT_REACHED_DISTANCE
    ? finalPoint
    : null;
};

const findStableNavWaypoint = (
  from: Point,
  target: Pick<AvatarRuntime, "targetX" | "targetY">,
  content: AivatarContent,
  behavior: BehaviorName,
  ignoredFurnitureId?: string,
  navMemory?: AivatarNavMemory,
) => {
  const ignoreLearnedGrid = behavior === "explore";
  const targetPoint = { x: target.targetX, y: target.targetY };
  if (
    !pathHitsCollision(
      from,
      targetPoint,
      content,
      ignoredFurnitureId,
      NAV_CORRIDOR_CLEARANCE,
    )
  ) {
    cachedNavWaypoint = null;
    return null;
  }

  if (
    cachedNavWaypoint &&
    sameNavigationTarget(cachedNavWaypoint, behavior, target, ignoredFurnitureId) &&
    cachedNavWaypoint.path
  ) {
    const point = nextPathPoint(from, cachedNavWaypoint.path);
    if (
      point &&
      Math.hypot(point.x - from.x, point.y - from.y) > NAV_WAYPOINT_REACHED_DISTANCE &&
      !pathHitsCollision(
        from,
        point,
        content,
        ignoredFurnitureId,
        NAV_CORRIDOR_CLEARANCE,
      )
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
    !pathHitsCollision(
      from,
      cachedNavWaypoint.point,
      content,
      ignoredFurnitureId,
      NAV_CORRIDOR_CLEARANCE,
    )
  ) {
    return cachedNavWaypoint.point;
  }

  const path = findNavGridPath(
    from,
    targetPoint,
    content,
    ignoredFurnitureId,
    navMemory,
    ignoreLearnedGrid,
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
    findNavGridWaypoint(
      from,
      target,
      content,
      ignoredFurnitureId,
      navMemory,
      ignoreLearnedGrid,
    ) ??
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
      const directPathBlocked = pathHitsCollision(
        from,
        point,
        content,
        ignoredFurnitureId,
        NAV_CORRIDOR_CLEARANCE,
      );
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
  options?: {
    startImmediately?: boolean;
  },
): AvatarRuntime => {
  const from = { x: avatar.x, y: avatar.y };
  const target = targetForBehavior(behavior, content, from);
  const alternates = behaviorInteractionAlternates(behavior, content, from);
  const shouldWaitForArrival =
    behaviorWaitsForArrival(behavior) && !options?.startImmediately;
  const runtimeBehavior = shouldWaitForArrival ? "wander" : behavior;

  return {
    ...clearNavigationFailure(avatar),
    ...target,
    behavior: runtimeBehavior,
    behaviorTimer: timer,
    facing: !shouldWaitForArrival && shouldFaceFrontAtTarget(behavior) ? "front" : avatar.facing,
    expression: expressionForBehavior(runtimeBehavior),
    activityLabel,
    interactionTargetAlternates: alternates && alternates.length > 1 ? alternates : undefined,
    actionIntent: shouldWaitForArrival ? behavior : undefined,
    actionActivityLabel: shouldWaitForArrival ? activityLabel : undefined,
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
    startImmediately?: boolean;
  },
): AvatarRuntime => {
  const behavior = options?.behavior ?? furniture.interaction;
  const fallback = getFurnitureInteractionTarget(furniture, behavior);
  const standpoints = options?.content
    ? getFurnitureInteractionStandpoints(furniture, options.content, behavior)
    : [];
  const point = options?.content
    ? chooseNearestPoint(
        { x: avatar.x, y: avatar.y },
        standpoints,
        { x: fallback.targetX, y: fallback.targetY },
      )
    : { x: fallback.targetX, y: fallback.targetY };
  const shouldWaitForArrival =
    behaviorWaitsForArrival(behavior) && !options?.startImmediately;
  const runtimeBehavior = shouldWaitForArrival ? "wander" : behavior;

  return {
    ...clearNavigationFailure(avatar),
    targetX: point.x,
    targetY: point.y,
    facing: options?.facing ?? "front",
    behavior: runtimeBehavior,
    behaviorTimer: timer,
    expression: expressionForBehavior(runtimeBehavior),
    activityLabel: undefined,
    interactionTargetAlternates: standpoints.length > 1 ? standpoints : undefined,
    actionIntent: shouldWaitForArrival ? behavior : undefined,
    actionActivityLabel: undefined,
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

const randomRange = (min: number, max: number) =>
  min + Math.random() * (max - min);

const autonomousBehaviorDurationSeconds = (behavior: BehaviorName) => {
  switch (behavior) {
    case "play":
      return randomRange(28, 42);
    case "paint":
      return randomRange(32, 48);
    case "relax":
      return randomRange(16, 26);
    case "admire":
      return randomRange(12, 20);
    case "phone":
      return randomRange(10, 18);
    case "explore":
      return randomRange(16, 24);
    case "wander":
      return randomRange(8, 14);
    case "interact":
      return randomRange(10, 16);
    case "brew":
      return randomRange(7, 11);
    case "snack":
      return randomRange(6, 10);
    case "sleep":
      return randomRange(14, 22);
    default:
      return randomRange(6, 12);
  }
};

const traitInfluence = (value: number | undefined, max: number, divisor: number) =>
  Math.min(max, Math.max(0, (value ?? 0) / divisor));

type WeightedBehaviorChoice = {
  behavior: BehaviorName;
  weight: number;
};

const weightedPick = (
  choices: WeightedBehaviorChoice[],
  fallback: BehaviorName,
): BehaviorName => {
  const viableChoices = choices.filter((choice) => choice.weight > 0);
  const totalWeight = viableChoices.reduce(
    (total, choice) => total + choice.weight,
    0,
  );
  if (totalWeight <= 0) return fallback;

  let roll = Math.random() * totalWeight;
  for (const choice of viableChoices) {
    roll -= choice.weight;
    if (roll <= 0) return choice.behavior;
  }

  return viableChoices[viableChoices.length - 1]?.behavior ?? fallback;
};

const chooseAutonomousBehavior = (
  content: AivatarContent,
  memory?: AivatarMemory,
): BehaviorName => {
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

  if (content.petStats.energy < 24) {
    return weightedPick(
      [
        { behavior: "snack", weight: coffeeCount > 0 ? 8 : 0 },
        { behavior: "sleep", weight: 8 + resilienceBoost * 20 },
        { behavior: "relax", weight: 2 + focusBoost * 10 },
      ],
      coffeeCount > 0 ? "snack" : "sleep",
    );
  }

  if (content.petStats.hunger < 24) {
    return weightedPick(
      [
        { behavior: "snack", weight: 12 },
        { behavior: "wander", weight: 1 },
        { behavior: "relax", weight: 1 },
      ],
      "snack",
    );
  }

  if (content.petStats.mood < 50) {
    return weightedPick(
      [
        {
          behavior: "play",
          weight: hasGameConsole
            ? 10 + resilienceBoost * 20 + efficiencyBoost * 12
            : 0,
        },
        {
          behavior: "paint",
          weight: hasEasel ? 8 + creativityBoost * 20 : 0,
        },
        {
          behavior: "admire",
          weight: hasDecor ? 5 + curiosityBoost * 12 : 0,
        },
        { behavior: "relax", weight: 3 + focusBoost * 10 },
        { behavior: "wander", weight: 2 },
      ],
      "relax",
    );
  }

  if (content.petStats.energy < 42) {
    return weightedPick(
      [
        { behavior: "relax", weight: 10 + focusBoost * 20 },
        { behavior: "snack", weight: coffeeCount > 0 ? 4 : 0 },
        { behavior: "wander", weight: 2 },
        { behavior: "phone", weight: 1 },
      ],
      "relax",
    );
  }

  return weightedPick(
    [
      {
        behavior: "play",
        weight: hasGameConsole
          ? 14 + resilienceBoost * 16 + efficiencyBoost * 20
          : 0,
      },
      {
        behavior: "paint",
        weight: hasEasel ? 8 + creativityBoost * 20 : 0,
      },
      {
        behavior: "brew",
        weight: hasCoffeeMachine && coffeeCount < 5 ? 3 + efficiencyBoost * 12 : 0,
      },
      {
        behavior: "explore",
        weight: canExplore ? 8 + curiosityBoost * 18 : 0,
      },
      {
        behavior: "admire",
        weight: hasDecor ? 7 + curiosityBoost * 16 : 0,
      },
      { behavior: "interact", weight: 7 + curiosityBoost * 10 },
      { behavior: "wander", weight: 10 },
      { behavior: "phone", weight: 6 },
      { behavior: "snack", weight: Math.max(1, 5 - focusBoost * 10) },
      { behavior: "relax", weight: 10 + focusBoost * 20 },
    ],
    "wander",
  );
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
  const activeBehavior = activeBehaviorForRuntime(avatar);

  if (
    forcedBehavior &&
    (activeBehavior !== forcedBehavior ||
      (forcedBehavior === "wander" && avatar.behaviorTimer <= 0))
  ) {
    next = setBehavior(
      avatar,
      forcedBehavior,
      content,
      forcedBehavior === "success" ? 3 : 8,
      undefined,
    );
  } else if (!forcedBehavior && !avatar.actionIntent && avatar.behaviorTimer <= 0) {
    const autonomous = chooseAutonomousBehavior(content, memory);
    next = setBehavior(
      avatar,
      autonomous,
      content,
      autonomousBehaviorDurationSeconds(autonomous),
      activityLabelForBehavior(autonomous),
    );
  }

  if (!forcedBehavior && next.behavior === "idle" && !next.actionIntent) {
    cachedNavWaypoint = null;
    cachedReplanPause = null;
    clearNavigationProgress();
    clearBlockedTarget();
    clearActionNavigationFailsafe();
    return {
      ...next,
      targetX: next.x,
      targetY: next.y,
      activityLabel: next.activityLabel === "Idle" ? undefined : next.activityLabel,
      behaviorTimer: Math.max(0, next.behaviorTimer - elapsedSeconds),
    };
  }

  const movementBehavior = activeBehaviorForRuntime(next);
  const ignoredFurnitureId =
    options?.ignoredFurnitureId ?? (movementBehavior === "sleep" ? "bed" : undefined);

  if (isAtInteractionRange(next)) {
    cachedNavWaypoint = null;
    cachedReplanPause = null;
    clearNavigationProgress();
    clearBlockedTarget();
    if (next.actionIntent) {
      const intent = next.actionIntent;
      const snapToTarget = intent === "sleep" || intent === "relax";
      return {
        ...next,
        x: snapToTarget ? next.targetX : next.x,
        y: snapToTarget ? next.targetY : next.y,
        behavior: intent,
        facing:
          intent === "coding" || intent === "thinking"
            ? "back"
            : shouldFaceFrontAtTarget(intent)
              ? "front"
              : next.facing,
        expression: expressionForBehavior(intent),
        activityLabel: next.actionActivityLabel ?? activityLabelForBehavior(intent),
        actionIntent: undefined,
        actionActivityLabel: undefined,
        interactionTargetAlternates: undefined,
      };
    }
    return {
      ...next,
      facing:
        movementBehavior === "coding" || movementBehavior === "thinking"
          ? "back"
          : shouldFaceFrontAtTarget(movementBehavior)
            ? "front"
            : next.facing,
      behaviorTimer: next.behaviorTimer - elapsedSeconds,
    };
  }

  const waypoint = findStableNavWaypoint(
    { x: next.x, y: next.y },
    { targetX: next.targetX, targetY: next.targetY },
    content,
    movementBehavior,
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
    movementBehavior === "sleep" || movementBehavior === "coding" || movementBehavior === "admire"
      ? 28
      : 48;
  const step = Math.min(distance, speed * elapsedSeconds);
  const navigationTarget = { targetX: next.targetX, targetY: next.targetY };

  if (cachedReplanPause) {
    if (
      sameReplanPauseTarget(
        cachedReplanPause,
        movementBehavior,
        navigationTarget,
        ignoredFurnitureId,
      )
    ) {
      cachedReplanPause.remainingSeconds -= elapsedSeconds;
      if (cachedReplanPause.remainingSeconds > 0) {
        return {
          ...next,
          behaviorTimer: next.actionIntent ? next.behaviorTimer : next.behaviorTimer - elapsedSeconds,
        };
      }
    }

    cachedReplanPause = null;
  }

  if (distance > 0.5) {
    const nextX = next.x + (dx / distance) * step;
    const nextY = next.y + (dy / distance) * step;
    const currentInsideCollision = pointHitsCollision(
      next.x,
      next.y,
      content,
      ignoredFurnitureId,
    );

    if (currentInsideCollision) {
      const edgeSlidePoint = [
        { x: nextX, y: next.y },
        { x: next.x, y: nextY },
      ]
        .filter((point) =>
          pointCanSlideAlongCollisionEdge(
            { x: next.x, y: next.y },
            point,
            content,
            ignoredFurnitureId,
          ),
        )
        .sort(
          (left, right) =>
            Math.hypot(left.x - movementTarget.targetX, left.y - movementTarget.targetY) -
            Math.hypot(right.x - movementTarget.targetX, right.y - movementTarget.targetY),
        )[0];

      if (edgeSlidePoint) {
        const edgeSlideDistance = Math.hypot(
          edgeSlidePoint.x - next.x,
          edgeSlidePoint.y - next.y,
        );
        next = {
          ...next,
          x: edgeSlidePoint.x,
          y: edgeSlidePoint.y,
          facing:
            edgeSlideDistance >= MIN_VISIBLE_MOVE_DISTANCE
              ? facingForMovement(edgeSlidePoint.x - next.x, edgeSlidePoint.y - next.y)
              : next.facing,
        };
      } else {
        const escapePoint = nearestWalkablePoint(
          { x: next.x, y: next.y },
          content,
          ignoredFurnitureId,
        );

        if (escapePoint) {
          const escapeDx = escapePoint.x - next.x;
          const escapeDy = escapePoint.y - next.y;
          const escapeDistance = Math.hypot(escapeDx, escapeDy);
          const escapeStep = Math.min(escapeDistance, speed * elapsedSeconds);
          const escapeX =
            escapeDistance > 0
              ? next.x + (escapeDx / escapeDistance) * escapeStep
              : next.x;
          const escapeY =
            escapeDistance > 0
              ? next.y + (escapeDy / escapeDistance) * escapeStep
              : next.y;
          const canEscape = pointCanEscapeCollision(
            escapeX,
            escapeY,
            content,
            ignoredFurnitureId,
            next,
          );

          cachedNavWaypoint = {
            behavior: movementBehavior,
            targetX: next.targetX,
            targetY: next.targetY,
            ignoredFurnitureId,
            point: escapePoint,
          };

          if (canEscape) {
            const escapeMoveDistance = Math.hypot(escapeX - next.x, escapeY - next.y);
            next = {
              ...next,
              x: escapeX,
              y: escapeY,
              facing:
                escapeMoveDistance >= MIN_VISIBLE_MOVE_DISTANCE
                  ? facingForMovement(escapeX - next.x, escapeY - next.y)
                  : next.facing,
            };
          }
        } else {
          cachedNavWaypoint = null;
          cachedReplanPause = null;
        }
      }
    } else {
      const currentPoint = { x: next.x, y: next.y };
      const directPoint = { x: nextX, y: nextY };
      const slideXPoint = { x: nextX, y: next.y };
      const slideYPoint = { x: next.x, y: nextY };
      const canMoveDirectly =
        !pointHitsCollision(nextX, nextY, content, ignoredFurnitureId) &&
        !pathHitsCollision(currentPoint, directPoint, content, ignoredFurnitureId);
      const canSlideX =
        !pointHitsCollision(nextX, next.y, content, ignoredFurnitureId) &&
        !pathHitsCollision(currentPoint, slideXPoint, content, ignoredFurnitureId);
      const canSlideY =
        !pointHitsCollision(next.x, nextY, content, ignoredFurnitureId) &&
        !pathHitsCollision(currentPoint, slideYPoint, content, ignoredFurnitureId);
      const movedX = canMoveDirectly || canSlideX ? nextX : next.x;
      const movedY = canMoveDirectly || (!canSlideX && canSlideY) ? nextY : next.y;
      const actualMoveDistance = Math.hypot(movedX - next.x, movedY - next.y);
      const ineffectiveMove = distance > 4 && actualMoveDistance < step * 0.25;
      const slidAlongCollision = !canMoveDirectly && actualMoveDistance >= step * 0.25;
      const blockedOrIneffective = ineffectiveMove;

      if (blockedOrIneffective) {
        const shouldAbandonTarget = recordBlockedTarget(
          movementBehavior,
          { targetX: next.targetX, targetY: next.targetY },
          ignoredFurnitureId,
          elapsedSeconds,
        );

        if (shouldAbandonTarget) {
          next = failNavigationTarget(
            next,
            content,
            movementBehavior,
            forcedBehavior,
            "blocked",
          );
        } else {
          return pauseForNavigationReplan(
            next,
            movementBehavior,
            ignoredFurnitureId,
            elapsedSeconds,
          );
        }
      } else {
        clearBlockedTarget();
        if (slidAlongCollision) {
          cachedNavWaypoint = null;
          cachedReplanPause = null;
        }
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

    const stillFollowingSameTarget =
      activeBehaviorForRuntime(next) === movementBehavior &&
      Math.abs(next.targetX - navigationTarget.targetX) <= 1 &&
      Math.abs(next.targetY - navigationTarget.targetY) <= 1;

    if (stillFollowingSameTarget) {
      const stalled = recordNavigationProgress(
        movementBehavior,
        { x: navigationTarget.targetX, y: navigationTarget.targetY },
        { x: next.x, y: next.y },
        ignoredFurnitureId,
        elapsedSeconds,
      );

      if (stalled) {
        const alternative = chooseAlternativeInteractionTarget(
          { x: next.x, y: next.y },
          { targetX: navigationTarget.targetX, targetY: navigationTarget.targetY },
          next.interactionTargetAlternates,
          content,
          ignoredFurnitureId,
          options?.navMemory,
        );
        const shouldFailAction =
          Boolean(next.actionIntent) &&
          recordActionNavigationStall(movementBehavior, ignoredFurnitureId);
        clearNavigationProgress();
        clearBlockedTarget();
        cachedNavWaypoint = null;
        cachedReplanPause = null;

        if (alternative && !shouldFailAction) {
          return {
            ...next,
            targetX: alternative.x,
            targetY: alternative.y,
            expression: "focused",
            activityLabel: "Planning route",
            behaviorTimer: next.actionIntent
              ? next.behaviorTimer
              : next.behaviorTimer - elapsedSeconds,
          };
        }

        next = failNavigationTarget(
          next,
          content,
          movementBehavior,
          forcedBehavior,
          "stalled",
        );
      }
    } else {
      clearNavigationProgress();
    }
  }

  return {
    ...next,
    facing:
      distance <= 8 && movementBehavior === "coding"
        ? "back"
        : distance <= 1 && shouldFaceFrontAtTarget(movementBehavior)
          ? "front"
          : next.facing,
    behaviorTimer: next.actionIntent ? next.behaviorTimer : next.behaviorTimer - elapsedSeconds,
  };
};

export const applyConsumableEffect = (
  stats: PetStats,
  effect: Partial<PetStats> = {},
): PetStats => applyPetStatEffect(stats, effect);
