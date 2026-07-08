import type {
  AivatarContent,
  AvatarRuntime,
  CodexStatusMessage,
} from "../types";
import { initialAvatarRuntime } from "../game/simulation";
import type { CardRoomCharacter, HoldemPlayer, HoldemTableState } from "./holdemEngine";

type SeatTarget = Pick<AvatarRuntime, "targetX" | "targetY" | "facing">;
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type CardRoomRoamPlan = {
  target: Point;
  behavior: AvatarRuntime["behavior"];
  timer: number;
  expression: AvatarRuntime["expression"];
  activityLabel: string;
  bubbleText?: string;
  facing?: AvatarRuntime["facing"];
};

export type CardRoomCopy = (
  key: string,
  params?: Record<string, string | number>,
) => string;

const WALK_MIN_X = 72;
const WALK_MAX_X = 888;
const WALK_MIN_Y = 272;
const WALK_MAX_Y = 594;
const POKER_TABLE_X = 160;
const POKER_TABLE_Y = 320;
const POKER_TABLE_WIDTH = 640;
const POKER_TABLE_HEIGHT = 220;
const TOP_OPPONENT_SEAT_COUNT = 6;
const SIDE_OPPONENT_VERTICAL_CARD_WIDTH = 26;
const SIDE_OPPONENT_SEAT_Y_OFFSET = 64 - SIDE_OPPONENT_VERTICAL_CARD_WIDTH;
const NAV_GRID_SIZE = 8;
const NAV_WAYPOINT_REACHED_DISTANCE = 7;
const NAV_PLANNING_CLEARANCE = 4;
const NAV_CORRIDOR_CLEARANCE = NAV_PLANNING_CLEARANCE;
const COLLISION_EDGE_EPSILON = 0.5;
const AVATAR_FOOTPRINT_HALF_WIDTH = 6;
const AVATAR_FOOTPRINT_TOP_OFFSET = 6;
const AVATAR_FOOTPRINT_HEIGHT = 8;
const MIN_VISIBLE_MOVE_DISTANCE = 0.2;
const SEAT_ARRIVAL_DISTANCE = 4;
const TARGET_FACING_DISTANCE = 0.5;
const CARD_ROOM_ENTRY_POINT: Point = { x: WALK_MIN_X - 34, y: WALK_MAX_Y - 18 };
const CARD_ROOM_ENTRY_TARGET: Point = { x: WALK_MIN_X + 58, y: WALK_MAX_Y - 28 };
const CARD_ROOM_BUBBLE_DURATION_MS = 2600;
const CARD_ROOM_ENTRY_DELAY_MS = 5000;

const cardRoomCopy = (
  copy: CardRoomCopy | undefined,
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => {
  const value = copy?.(key, params);
  return value && value !== key ? value : fallback;
};

const cardRoomActionActivityLabel = (
  lastAction: string | undefined,
  copy: CardRoomCopy | undefined,
) => {
  if (!lastAction) {
    return cardRoomCopy(copy, "cardRoom.activity.atTable", "At table");
  }
  if (lastAction.includes("all-in")) {
    return cardRoomCopy(copy, "cardRoom.actionCue.allIn", "All-in!");
  }
  if (lastAction.includes("raise")) {
    return cardRoomCopy(copy, "cardRoom.actionCue.raise", "Raise.");
  }
  if (lastAction.includes("bet")) {
    return cardRoomCopy(copy, "cardRoom.actionCue.bet", "Bet.");
  }
  if (lastAction.includes("call")) {
    return cardRoomCopy(copy, "cardRoom.actionCue.call", "Call.");
  }
  if (lastAction.includes("check")) {
    return cardRoomCopy(copy, "cardRoom.actionCue.check", "Check.");
  }
  if (lastAction.includes("fold")) {
    return cardRoomCopy(copy, "cardRoom.actionCue.fold", "Fold.");
  }
  return lastAction;
};

export type CardRoomVisitorPhase = "pending" | "entering" | "free" | "seating" | "seated";

export type CardRoomActionType =
  | "think"
  | "hesitate"
  | "pressure"
  | "snap"
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all-in";

export interface CardRoomActionCue {
  type: CardRoomActionType;
  text: string;
  startedAt: number;
  durationMs: number;
  intensity: "small" | "medium" | "large";
}

export interface CardRoomVisitorState {
  runtime: AvatarRuntime;
  phase: CardRoomVisitorPhase;
  bubbleText?: string;
  bubbleStartedAt?: number;
  enterAt?: number;
}

export interface CardRoomNavigationMemory {
  version: 1;
  roomKey: string;
  layoutFingerprint: string;
  exploredCells: Record<string, number>;
  successes: number;
  failures: number;
  lastExploredAt?: string;
}

type CardRoomNavigationCache = {
  targetX: number;
  targetY: number;
  point: Point;
  path?: Point[];
};

const pokerTableCollision: Rect = {
  x: POKER_TABLE_X,
  y: POKER_TABLE_Y,
  width: POKER_TABLE_WIDTH,
  height: POKER_TABLE_HEIGHT,
};

let activeCollisionRects: Rect[] = [pokerTableCollision];

const collisionRectsForContent = (content: AivatarContent): Rect[] => {
  const rects = content.room.furniture
    .map((item) => item.collision)
    .filter((rect): rect is Rect => Boolean(rect));
  return rects.length > 0 ? rects : [pokerTableCollision];
};

const useContentCollisionRects = (content: AivatarContent) => {
  activeCollisionRects = collisionRectsForContent(content);
};

const cardRoomNavigationCaches = new Map<string, CardRoomNavigationCache>();

const cardRoomLayoutFingerprint = (content: AivatarContent) =>
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
    placedItems: (content.placedItems ?? [])
      .map((item) => ({
        id: item.id,
        itemId: item.itemId,
        x: item.x,
        y: item.y,
        surfaceFurnitureId: item.surfaceFurnitureId,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    windows: (content.room.windows ?? [])
      .map((window) => ({
        id: window.id,
        x: window.x,
        y: window.y,
        width: window.width,
        height: window.height,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });

export const cardRoomNavigationMemoryStorageKey = (roomKey: string) =>
  `aivatar.cardRoom.navMemory.v1.${roomKey}`;

export const createCardRoomNavigationMemory = (
  roomKey: string,
  content: AivatarContent,
): CardRoomNavigationMemory => ({
  version: 1,
  roomKey,
  layoutFingerprint: cardRoomLayoutFingerprint(content),
  exploredCells: {},
  successes: 0,
  failures: 0,
});

const distance = (
  left: Pick<AvatarRuntime, "x" | "y">,
  right: { x: number; y: number },
) => Math.hypot(left.x - right.x, left.y - right.y);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const clampNavigationPoint = (point: Point): Point => ({
  x: clamp(point.x, WALK_MIN_X, WALK_MAX_X),
  y: clamp(point.y, WALK_MIN_Y, WALK_MAX_Y),
});

const isPointInsideRoomFloor = (point: Point) =>
  point.x >= WALK_MIN_X &&
  point.x <= WALK_MAX_X &&
  point.y >= WALK_MIN_Y &&
  point.y <= WALK_MAX_Y;

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

const pointHitsCollision = (x: number, y: number, clearance = 0) => {
  const point = avatarCollisionPoint(x, y);
  return activeCollisionRects.some((rect) =>
    pointInsideRect(point, inflatedCollisionRect(rect, clearance)),
  );
};

const collisionPenetrationDepth = (x: number, y: number) => {
  const point = avatarCollisionPoint(x, y);
  const depths = activeCollisionRects
    .map((rect) => {
      const inflated = inflatedCollisionRect(rect);
      if (!pointInsideRect(point, inflated)) return 0;
      return Math.min(
        point.x - inflated.x,
        inflated.x + inflated.width - point.x,
        point.y - inflated.y,
        inflated.y + inflated.height - point.y,
      );
    })
    .filter((depth) => depth > 0);

  return depths.length > 0 ? Math.min(...depths) : 0;
};

const pointCanSlideAlongCollisionEdge = (from: Point, to: Point) => {
  if (!isPointInsideRoomFloor(to)) return false;

  const currentDepth = collisionPenetrationDepth(from.x, from.y);
  const nextDepth = collisionPenetrationDepth(to.x, to.y);
  if (currentDepth <= 0) return !pointHitsCollision(to.x, to.y);

  return nextDepth <= currentDepth + 0.75;
};

const pathHitsCollision = (from: Point, to: Point, clearance = 0) => {
  const steps = Math.max(
    8,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4),
  );

  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    if (pointHitsCollision(x, y, clearance)) return true;
  }

  return false;
};

const gridColumns = Math.floor((WALK_MAX_X - WALK_MIN_X) / NAV_GRID_SIZE) + 1;
const gridRows = Math.floor((WALK_MAX_Y - WALK_MIN_Y) / NAV_GRID_SIZE) + 1;

const pointToCell = (point: Point) => ({
  col: clamp(
    Math.round((point.x - WALK_MIN_X) / NAV_GRID_SIZE),
    0,
    gridColumns - 1,
  ),
  row: clamp(
    Math.round((point.y - WALK_MIN_Y) / NAV_GRID_SIZE),
    0,
    gridRows - 1,
  ),
});

const cellToPoint = (cell: { col: number; row: number }): Point => ({
  x: WALK_MIN_X + cell.col * NAV_GRID_SIZE,
  y: WALK_MIN_Y + cell.row * NAV_GRID_SIZE,
});

const cellKey = (cell: { col: number; row: number }) => `${cell.col}:${cell.row}`;

const recordCardRoomNavigationMemory = (
  memory: CardRoomNavigationMemory | undefined,
  runtime: AvatarRuntime,
  content: AivatarContent,
) => {
  if (!memory) return;
  const layoutFingerprint = cardRoomLayoutFingerprint(content);
  if (memory.layoutFingerprint !== layoutFingerprint) {
    memory.layoutFingerprint = layoutFingerprint;
    memory.exploredCells = {};
    memory.successes = 0;
    memory.failures = 0;
  }
  const key = cellKey(pointToCell({ x: runtime.x, y: runtime.y }));
  memory.exploredCells[key] = (memory.exploredCells[key] ?? 0) + 1;
  memory.lastExploredAt = new Date().toISOString();
};

const isWalkableCell = (
  cell: { col: number; row: number },
  clearance = 0,
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
  return isPointInsideRoomFloor(point) && !pointHitsCollision(point.x, point.y, clearance);
};

const nearestWalkableCell = (point: Point, clearance = 0) => {
  const origin = pointToCell(point);
  if (isWalkableCell(origin, clearance)) return origin;

  const maxRadius = Math.max(gridColumns, gridRows);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
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
      .filter((cell) => isWalkableCell(cell, clearance))
      .sort(
        (left, right) =>
          Math.hypot(cellToPoint(left).x - point.x, cellToPoint(left).y - point.y) -
          Math.hypot(cellToPoint(right).x - point.x, cellToPoint(right).y - point.y),
      )[0];
    if (walkable) return walkable;
  }

  return null;
};

const nearestWalkablePoint = (point: Point, clearance = 0) => {
  const cell = nearestWalkableCell(point, clearance);
  return cell ? cellToPoint(cell) : null;
};

const safeNavigationTarget = (target: Point) => {
  const clamped = clampNavigationPoint(target);
  if (!pointHitsCollision(clamped.x, clamped.y, NAV_PLANNING_CLEARANCE)) return clamped;
  return nearestWalkablePoint(clamped, NAV_PLANNING_CLEARANCE) ?? clamped;
};

const findNavGridPath = (from: Point, to: Point) => {
  const start = nearestWalkableCell(from, NAV_PLANNING_CLEARANCE);
  const goal = nearestWalkableCell(to, NAV_PLANNING_CLEARANCE);
  if (!start || !goal) return null;

  const goalKey = cellKey(goal);
  const open = [start];
  const cameFrom = new Map<string, string>();
  const cells = new Map<string, { col: number; row: number }>([[cellKey(start), start]]);
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
    for (const offset of neighbors) {
      const neighbor = { col: current.col + offset.col, row: current.row + offset.row };
      if (!isWalkableCell(neighbor, NAV_PLANNING_CLEARANCE)) continue;
      const neighborKey = cellKey(neighbor);
      if (closed.has(neighborKey)) continue;
      if (
        offset.col !== 0 &&
        offset.row !== 0 &&
        (!isWalkableCell(
          { col: current.col + offset.col, row: current.row },
          NAV_PLANNING_CLEARANCE,
        ) ||
          !isWalkableCell(
            { col: current.col, row: current.row + offset.row },
            NAV_PLANNING_CLEARANCE,
          ))
      ) {
        continue;
      }
      if (
        pathHitsCollision(
          cellToPoint(current),
          cellToPoint(neighbor),
          NAV_PLANNING_CLEARANCE,
        )
      ) {
        continue;
      }

      const currentScore = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY;
      const tentativeScore = currentScore + offset.cost;
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

const sameNavigationTarget = (
  cache: CardRoomNavigationCache,
  target: Point,
) =>
  Math.abs(cache.targetX - target.x) <= 1 &&
  Math.abs(cache.targetY - target.y) <= 1;

const stableCardRoomWaypoint = (cacheKey: string, from: Point, target: Point) => {
  if (!pathHitsCollision(from, target, NAV_CORRIDOR_CLEARANCE)) {
    cardRoomNavigationCaches.delete(cacheKey);
    return null;
  }

  const cache = cardRoomNavigationCaches.get(cacheKey);
  if (cache && sameNavigationTarget(cache, target) && cache.path) {
    const point = nextPathPoint(from, cache.path);
    if (
      point &&
      Math.hypot(point.x - from.x, point.y - from.y) > NAV_WAYPOINT_REACHED_DISTANCE &&
      !pathHitsCollision(from, point, NAV_CORRIDOR_CLEARANCE)
    ) {
      return point;
    }
    cardRoomNavigationCaches.delete(cacheKey);
  }

  if (
    cache &&
    sameNavigationTarget(cache, target) &&
    Math.hypot(cache.point.x - from.x, cache.point.y - from.y) >
      NAV_WAYPOINT_REACHED_DISTANCE &&
    !pathHitsCollision(from, cache.point, NAV_CORRIDOR_CLEARANCE)
  ) {
    return cache.point;
  }

  const path = findNavGridPath(from, target);
  if (!path || path.length < 2) {
    cardRoomNavigationCaches.delete(cacheKey);
    return null;
  }

  const point = nextPathPoint(from, path) ?? path[1];
  cardRoomNavigationCaches.set(cacheKey, {
    targetX: target.x,
    targetY: target.y,
    point,
    path,
  });
  return point;
};

const randomWaitingTarget = () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const x = WALK_MIN_X + Math.random() * (WALK_MAX_X - WALK_MIN_X);
    const y = WALK_MIN_Y + Math.random() * (WALK_MAX_Y - WALK_MIN_Y);
    if (!pointHitsCollision(x, y, NAV_PLANNING_CLEARANCE)) return { x, y };
  }

  return Math.random() > 0.5
    ? { x: WALK_MIN_X + 48 + Math.random() * (WALK_MAX_X - WALK_MIN_X - 96), y: WALK_MIN_Y + 16 }
    : { x: WALK_MIN_X + 48 + Math.random() * (WALK_MAX_X - WALK_MIN_X - 96), y: WALK_MAX_Y - 16 };
};

const randomRange = (min: number, max: number) => min + Math.random() * (max - min);

const darkTraitValue = (
  character: CardRoomCharacter,
  trait: keyof CardRoomCharacter["darkTraits"],
) => character.darkTraits[trait] ?? 0;

const pickWeightedPlan = (
  choices: Array<CardRoomRoamPlan & { weight: number }>,
  copy?: CardRoomCopy,
): CardRoomRoamPlan => {
  const viable = choices.filter((choice) => choice.weight > 0);
  const totalWeight = viable.reduce((total, choice) => total + choice.weight, 0);
  if (totalWeight <= 0) {
    return {
      target: randomWaitingTarget(),
      behavior: "wander",
      timer: randomRange(4, 8),
      expression: "calm",
      activityLabel: cardRoomCopy(copy, "cardRoom.activity.exploring", "Exploring card room"),
      bubbleText: cardRoomCopy(
        copy,
        "cardRoom.bubble.justLookingAround",
        "Just looking around.",
      ),
    };
  }

  let roll = Math.random() * totalWeight;
  for (const choice of viable) {
    roll -= choice.weight;
    if (roll <= 0) return choice;
  }

  return viable[viable.length - 1]!;
};

const pointNearRect = (rect: Rect, side: "top" | "bottom" | "left" | "right"): Point => {
  if (side === "top") {
    return safeNavigationTarget({
      x: rect.x + randomRange(rect.width * 0.18, rect.width * 0.82),
      y: rect.y - 30,
    });
  }
  if (side === "bottom") {
    return safeNavigationTarget({
      x: rect.x + randomRange(rect.width * 0.18, rect.width * 0.82),
      y: rect.y + rect.height + 28,
    });
  }
  if (side === "left") {
    return safeNavigationTarget({
      x: rect.x - 30,
      y: rect.y + randomRange(rect.height * 0.25, rect.height * 0.78),
    });
  }
  return safeNavigationTarget({
    x: rect.x + rect.width + 30,
    y: rect.y + randomRange(rect.height * 0.25, rect.height * 0.78),
  });
};

const pokerTableRoamTarget = (): Point => {
  const sides: Array<"top" | "left" | "right"> = ["top", "left", "right"];
  return pointNearRect(pokerTableCollision, sides[Math.floor(Math.random() * sides.length)]);
};

const windowRoamTarget = (content: AivatarContent): Point | null => {
  const window = content.room.windows?.[0];
  if (!window) return null;
  return safeNavigationTarget({
    x: window.x + window.width / 2 + randomRange(-36, 36),
    y: Math.max(WALK_MIN_Y + 6, POKER_TABLE_Y - 56),
  });
};

const placedItemRoamTarget = (content: AivatarContent): Point | null => {
  const placedItems = content.placedItems ?? [];
  if (placedItems.length === 0) return null;
  const item = placedItems[Math.floor(Math.random() * placedItems.length)];
  return safeNavigationTarget({
    x: item.x + 18 + randomRange(-24, 24),
    y: item.y + 28 + randomRange(-12, 20),
  });
};

const socialRoamTarget = (
  runtime: AvatarRuntime,
  partners: Array<{ avatarId: string; avatarName: string; runtime: AvatarRuntime }>,
): { target: Point; partnerName: string } | null => {
  const candidates = partners.filter((partner) => distance(runtime, partner.runtime) > 28);
  if (candidates.length === 0) return null;
  const partner = candidates[Math.floor(Math.random() * candidates.length)];
  const offsetX = runtime.x <= partner.runtime.x ? -28 : 28;
  return {
    target: safeNavigationTarget({
      x: partner.runtime.x + offsetX,
      y: partner.runtime.y + randomRange(-8, 10),
    }),
    partnerName: partner.avatarName,
  };
};

const chooseFreeRoamPlan = (
  character: CardRoomCharacter,
  runtime: AvatarRuntime,
  content: AivatarContent,
  partners: Array<{ avatarId: string; avatarName: string; runtime: AvatarRuntime }>,
  copy?: CardRoomCopy,
): CardRoomRoamPlan => {
  const social = socialRoamTarget(runtime, partners);
  const windowTarget = windowRoamTarget(content);
  const placedTarget = placedItemRoamTarget(content);
  const greed = darkTraitValue(character, "greed");
  const arrogance = darkTraitValue(character, "arrogance");
  const recklessness = darkTraitValue(character, "recklessness");
  const cowardice = darkTraitValue(character, "cowardice");
  const coldness = darkTraitValue(character, "coldness");

  return pickWeightedPlan([
    {
      target: pokerTableRoamTarget(),
      behavior: "interact",
      timer: randomRange(5, 9),
      expression: greed + arrogance > 80 ? "focused" : "calm",
      activityLabel: cardRoomCopy(
        copy,
        "cardRoom.activity.studyingTable",
        "Studying the poker table",
      ),
      bubbleText:
        greed + recklessness > 90
          ? cardRoomCopy(copy, "cardRoom.bubble.bigPotSoon", "Big pot soon.")
          : arrogance > 80
            ? cardRoomCopy(
                copy,
                "cardRoom.bubble.seatMine",
                "This seat should be mine.",
              )
            : cardRoomCopy(copy, "cardRoom.bubble.goodTable", "Good table."),
      weight: 7 + greed / 18 + arrogance / 24 + recklessness / 28,
    },
    {
      target: windowTarget ?? randomWaitingTarget(),
      behavior: "admire",
      timer: randomRange(5, 10),
      expression: "calm",
      activityLabel: cardRoomCopy(copy, "cardRoom.activity.watchingCity", "Watching the city"),
      bubbleText: cardRoomCopy(copy, "cardRoom.bubble.cityLights", "City lights."),
      weight: windowTarget ? 4 + character.traits.curiosity / 95 + cowardice / 45 : 0,
    },
    {
      target: placedTarget ?? randomWaitingTarget(),
      behavior: "admire",
      timer: randomRange(5, 9),
      expression: "happy",
      activityLabel: cardRoomCopy(copy, "cardRoom.activity.checkingRoom", "Checking the room"),
      bubbleText: cardRoomCopy(copy, "cardRoom.bubble.whatsThis", "What's this?"),
      weight: placedTarget ? 6 + character.traits.curiosity / 80 : 0,
    },
    {
      target: social?.target ?? randomWaitingTarget(),
      behavior: "interact",
      timer: randomRange(6, 10),
      expression: coldness > 80 ? "calm" : "happy",
      activityLabel: social
        ? cardRoomCopy(copy, "cardRoom.activity.chattingWith", `Chatting with ${social.partnerName}`, {
            name: social.partnerName,
          })
        : cardRoomCopy(copy, "cardRoom.activity.chatting", "Chatting"),
      bubbleText: social
        ? coldness > 80
          ? cardRoomCopy(copy, "cardRoom.bubble.watchTells", "Watch the tells.")
          : cardRoomCopy(copy, "cardRoom.bubble.readyForHand", "Ready for a hand?")
        : cardRoomCopy(copy, "cardRoom.bubble.anyonePlaying", "Anyone playing?"),
      weight: social ? 6 + character.traits.warmth / 75 + Math.max(0, 100 - coldness) / 30 : 0,
    },
    {
      target: randomWaitingTarget(),
      behavior: "wander",
      timer: randomRange(4, 8),
      expression: "calm",
      activityLabel: cardRoomCopy(copy, "cardRoom.activity.exploring", "Exploring card room"),
      bubbleText:
        cowardice > 90
          ? cardRoomCopy(copy, "cardRoom.bubble.keepDistance", "I'll keep distance.")
          : darkTraitValue(character, "foolishness") > 90
            ? cardRoomCopy(copy, "cardRoom.bubble.whichWay", "Which way?")
            : cardRoomCopy(copy, "cardRoom.bubble.lookingAround", "Looking around."),
      weight: 8 + character.traits.curiosity / 90 + cowardice / 38,
    },
    {
      target: safeNavigationTarget({
        x: runtime.x < POKER_TABLE_X + POKER_TABLE_WIDTH / 2 ? WALK_MIN_X + 42 : WALK_MAX_X - 42,
        y: randomRange(WALK_MIN_Y + 16, WALK_MAX_Y - 18),
      }),
      behavior: "relax",
      timer: randomRange(6, 12),
      expression: "calm",
      activityLabel: cardRoomCopy(copy, "cardRoom.activity.keepSide", "Keeping to the side"),
      bubbleText: cardRoomCopy(copy, "cardRoom.bubble.watchFirst", "I'll watch first."),
      weight: 2 + cowardice / 25 + coldness / 45,
    },
  ], copy);
};

const facingForDelta = (dx: number, dy: number): AvatarRuntime["facing"] => {
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "front" : "back";
};

const moveRuntimeTowardNavigating = (
  runtime: AvatarRuntime,
  target: { x: number; y: number; facing?: AvatarRuntime["facing"] },
  elapsedSeconds: number,
  speed = 72,
  cacheKey = "card-room",
) => {
  const finalTarget = safeNavigationTarget({ x: target.x, y: target.y });
  const waypoint = stableCardRoomWaypoint(
    cacheKey,
    { x: runtime.x, y: runtime.y },
    finalTarget,
  );
  const movementTarget = waypoint ?? finalTarget;
  const dx = movementTarget.x - runtime.x;
  const dy = movementTarget.y - runtime.y;
  const remaining = Math.hypot(dx, dy);
  if (remaining <= 0.5) {
    return {
      ...runtime,
      x: finalTarget.x,
      y: finalTarget.y,
      targetX: finalTarget.x,
      targetY: finalTarget.y,
      facing: target.facing ?? runtime.facing,
    };
  }

  const step = Math.min(remaining, speed * elapsedSeconds);
  const nextX = runtime.x + (dx / remaining) * step;
  const nextY = runtime.y + (dy / remaining) * step;
  const currentPoint = { x: runtime.x, y: runtime.y };
  const currentInsideCollision = pointHitsCollision(runtime.x, runtime.y);
  let movedX = runtime.x;
  let movedY = runtime.y;

  if (currentInsideCollision) {
    const slidePoint = [
      { x: nextX, y: runtime.y },
      { x: runtime.x, y: nextY },
    ]
      .filter((point) => pointCanSlideAlongCollisionEdge(currentPoint, point))
      .sort(
        (left, right) =>
          Math.hypot(left.x - finalTarget.x, left.y - finalTarget.y) -
          Math.hypot(right.x - finalTarget.x, right.y - finalTarget.y),
      )[0];

    if (slidePoint) {
      movedX = slidePoint.x;
      movedY = slidePoint.y;
    } else {
      const escapePoint = nearestWalkablePoint(currentPoint);
      if (escapePoint) {
        const escapeDx = escapePoint.x - runtime.x;
        const escapeDy = escapePoint.y - runtime.y;
        const escapeDistance = Math.hypot(escapeDx, escapeDy);
        const escapeStep = Math.min(escapeDistance, speed * elapsedSeconds);
        movedX =
          escapeDistance > 0
            ? runtime.x + (escapeDx / escapeDistance) * escapeStep
            : runtime.x;
        movedY =
          escapeDistance > 0
            ? runtime.y + (escapeDy / escapeDistance) * escapeStep
            : runtime.y;
      }
    }
  } else {
    const directPoint = { x: nextX, y: nextY };
    const slideXPoint = { x: nextX, y: runtime.y };
    const slideYPoint = { x: runtime.x, y: nextY };
    const canMoveDirectly =
      !pointHitsCollision(nextX, nextY) &&
      !pathHitsCollision(currentPoint, directPoint);
    const canSlideX =
      !pointHitsCollision(nextX, runtime.y) &&
      !pathHitsCollision(currentPoint, slideXPoint);
    const canSlideY =
      !pointHitsCollision(runtime.x, nextY) &&
      !pathHitsCollision(currentPoint, slideYPoint);

    movedX = canMoveDirectly || canSlideX ? nextX : runtime.x;
    movedY = canMoveDirectly || (!canSlideX && canSlideY) ? nextY : runtime.y;
    if (!canMoveDirectly && Math.hypot(movedX - runtime.x, movedY - runtime.y) >= step * 0.25) {
      cardRoomNavigationCaches.delete(cacheKey);
    }
  }

  const actualMoveDistance = Math.hypot(movedX - runtime.x, movedY - runtime.y);
  const nextFacing =
    actualMoveDistance >= MIN_VISIBLE_MOVE_DISTANCE
      ? facingForDelta(movedX - runtime.x, movedY - runtime.y)
      : runtime.facing;

  return {
    ...runtime,
    x: movedX,
    y: movedY,
    targetX: finalTarget.x,
    targetY: finalTarget.y,
    facing:
      !waypoint && distance({ x: movedX, y: movedY }, finalTarget) <= TARGET_FACING_DISTANCE && target.facing
        ? target.facing
        : nextFacing,
  };
};

export const cardRoomStatus = (sessionId: string): CodexStatusMessage => ({
  agent: "aivatar",
  sessionId,
  status: "idle",
  phase: "card-room",
  task: "Card room",
  timestamp: new Date().toISOString(),
});

export const cardRoomNavigationScopeKey = (roomKey: string, avatarId: string) =>
  `card-room:${roomKey}:${avatarId}`;

export const createInitialCardRoomRuntime = (
  character: CardRoomCharacter,
  index: number,
  isUser: boolean,
  copy?: CardRoomCopy,
): AvatarRuntime => {
  const base = initialAvatarRuntime();
  const x = isUser ? 480 : 132 + (index % 8) * 96;
  const y = isUser
    ? POKER_TABLE_Y + POKER_TABLE_HEIGHT + 18
    : 284 + Math.floor(index / 8) * 58;
  return {
    ...base,
    x,
    y,
    targetX: x,
    targetY: y,
    facing: isUser ? "back" : "front",
    behavior: "idle",
    expression: "calm",
    activityLabel: cardRoomCopy(
      copy,
      "cardRoom.activity.arrived",
      `${character.avatarName} arrived`,
      { name: character.avatarName },
    ),
  };
};

export const createInitialCardRoomVisitorState = (
  character: CardRoomCharacter,
  index: number,
  isUser: boolean,
  now = performance.now(),
  copy?: CardRoomCopy,
): CardRoomVisitorState => {
  if (isUser) {
    return {
      runtime: createInitialCardRoomRuntime(character, index, true, copy),
      phase: "seated",
    };
  }

  const base = initialAvatarRuntime();
  const entryIndex = Math.max(0, index - 1);
  const yOffset = (entryIndex % 4) * 32;
  const xOffset = Math.floor(entryIndex / 4) * 18;
  return {
    runtime: {
      ...base,
      x: CARD_ROOM_ENTRY_POINT.x - xOffset,
      y: CARD_ROOM_ENTRY_POINT.y - yOffset,
      targetX: CARD_ROOM_ENTRY_TARGET.x + (entryIndex % 4) * 28,
      targetY: CARD_ROOM_ENTRY_TARGET.y - yOffset,
      facing: "right",
      behavior: "wander",
      behaviorTimer: 1,
      expression: "happy",
      activityLabel: cardRoomCopy(
        copy,
        "cardRoom.activity.entering",
        `${character.avatarName} entering`,
        { name: character.avatarName },
      ),
      navigationFailure: undefined,
    },
    phase: "pending",
    enterAt: now + CARD_ROOM_ENTRY_DELAY_MS,
  };
};

const opponentSeatTarget = (
  opponentIndex: number,
  opponentCount: number,
): SeatTarget => {
  if (opponentIndex >= TOP_OPPONENT_SEAT_COUNT) {
    const y = POKER_TABLE_Y + POKER_TABLE_HEIGHT / 2 + SIDE_OPPONENT_SEAT_Y_OFFSET;
    return opponentIndex === TOP_OPPONENT_SEAT_COUNT
      ? {
          targetX: POKER_TABLE_X - 24,
          targetY: y,
          facing: "right",
        }
      : {
          targetX: POKER_TABLE_X + POKER_TABLE_WIDTH + 24,
          targetY: y,
          facing: "left",
        };
  }

  const span = POKER_TABLE_WIDTH - 140;
  const x =
    POKER_TABLE_X +
    70 +
    (span / Math.max(1, TOP_OPPONENT_SEAT_COUNT - 1)) * opponentIndex;
  return {
    targetX: Math.round(x),
    targetY: POKER_TABLE_Y - 24,
    facing: "front",
  };
};

export const seatTargetForPlayer = (
  player: HoldemPlayer,
  opponentIndex: number,
  opponentCount: number,
): SeatTarget => {
  if (player.isUser) {
    return {
      targetX: POKER_TABLE_X + POKER_TABLE_WIDTH / 2,
      targetY: POKER_TABLE_Y + POKER_TABLE_HEIGHT + 18,
      facing: "back",
    };
  }
  return opponentSeatTarget(opponentIndex, opponentCount);
};

export const expressionForPokerPlayer = (
  player: HoldemPlayer | undefined,
): AvatarRuntime["expression"] => {
  if (!player) return "calm";
  if (player.folded) return "worried";
  if (player.lastAction?.includes("all-in")) return "focused";
  if (player.lastAction === "raise" || player.lastAction === "bet") return "happy";
  if (player.lastAction === "call") return "focused";
  return "calm";
};

const activeActionCue = (
  cue: CardRoomActionCue | undefined,
  now: number,
) => (cue && now - cue.startedAt <= cue.durationMs ? cue : undefined);

const expressionForActionCue = (
  cue: CardRoomActionCue,
): AvatarRuntime["expression"] => {
  if (cue.type === "think" || cue.type === "pressure") return "focused";
  if (cue.type === "hesitate") return "worried";
  if (cue.type === "snap") return "happy";
  if (cue.type === "fold") return "worried";
  if (cue.type === "check") return "calm";
  if (cue.type === "call" || cue.type === "all-in") return "focused";
  return "happy";
};

const activeBubbleText = (
  bubbleText: string | undefined,
  bubbleStartedAt: number | undefined,
  now: number,
) =>
  bubbleText && typeof bubbleStartedAt === "number" &&
  now - bubbleStartedAt <= CARD_ROOM_BUBBLE_DURATION_MS
    ? bubbleText
    : undefined;

const nextBubbleStartedAt = (
  currentText: string | undefined,
  currentStartedAt: number | undefined,
  nextText: string | undefined,
  now: number,
) => {
  if (!nextText) return undefined;
  if (nextText !== currentText) return now;
  if (typeof currentStartedAt !== "number") return now;
  if (now - currentStartedAt > CARD_ROOM_BUBBLE_DURATION_MS) return now;
  return currentStartedAt ?? now;
};

export const advanceCardRoomRuntime = (
  runtime: AvatarRuntime,
  elapsedSeconds: number,
  options: {
    player?: HoldemPlayer;
    opponentIndex?: number;
    opponentCount?: number;
    navigationKey?: string;
    table: HoldemTableState;
    copy?: CardRoomCopy;
  },
): AvatarRuntime => {
  const tableActive = options.table.street !== "waiting" && options.table.players.length > 0;
  const navigationKey = options.navigationKey ?? options.player?.avatarId ?? "card-room";
  if (!tableActive || !options.player) {
    const shouldChooseNewTarget =
      runtime.behaviorTimer <= 0 || distance(runtime, { x: runtime.targetX, y: runtime.targetY }) <= 4;
    const target = shouldChooseNewTarget
      ? randomWaitingTarget()
      : { x: runtime.targetX, y: runtime.targetY };
    const moved = moveRuntimeTowardNavigating(
      runtime,
      target,
      elapsedSeconds,
      46,
      navigationKey,
    );
    const arrived = distance(moved, { x: moved.targetX, y: moved.targetY }) <= 4;
    return {
      ...moved,
      behavior: arrived ? "idle" : "wander",
      behaviorTimer: shouldChooseNewTarget
        ? 3.5 + Math.random() * 4
        : Math.max(0, runtime.behaviorTimer - elapsedSeconds),
      expression: "calm",
      activityLabel: arrived
        ? cardRoomCopy(options.copy, "cardRoom.activity.inRoom", "In card room")
        : cardRoomCopy(options.copy, "cardRoom.activity.exploring", "Exploring card room"),
      navigationFailure: undefined,
    };
  }

  const target = seatTargetForPlayer(
    options.player,
    options.opponentIndex ?? 0,
    options.opponentCount ?? 0,
  );
  const targetPoint = { x: target.targetX, y: target.targetY };
  const seated = distance(runtime, targetPoint) <= SEAT_ARRIVAL_DISTANCE;
  const expression = expressionForPokerPlayer(options.player);
  const next = moveRuntimeTowardNavigating(
    {
      ...runtime,
      behavior: seated ? "idle" : "wander",
      expression,
      activityLabel: seated
        ? cardRoomActionActivityLabel(options.player.lastAction, options.copy)
        : cardRoomCopy(options.copy, "cardRoom.activity.takingSeat", "Taking seat"),
      navigationFailure: undefined,
    },
    { x: target.targetX, y: target.targetY, facing: target.facing },
    elapsedSeconds,
    82,
    navigationKey,
  );
  const arrived = distance(next, { x: next.targetX, y: next.targetY }) <= SEAT_ARRIVAL_DISTANCE;
  const settledRuntime = arrived
    ? {
        ...next,
        x: target.targetX,
        y: target.targetY,
        targetX: target.targetX,
        targetY: target.targetY,
        facing: target.facing,
      }
    : next;

  return {
    ...settledRuntime,
    expression,
    behavior: arrived ? "idle" : "wander",
    behaviorTimer: 1,
    activityLabel: arrived
      ? cardRoomActionActivityLabel(options.player.lastAction, options.copy)
      : cardRoomCopy(options.copy, "cardRoom.activity.takingSeat", "Taking seat"),
  };
};

export const advanceCardRoomVisitorState = (
  state: CardRoomVisitorState,
  elapsedSeconds: number,
  options: {
    character: CardRoomCharacter;
    isUser: boolean;
    player?: HoldemPlayer;
    opponentIndex?: number;
    opponentCount?: number;
    navigationKey?: string;
    table: HoldemTableState;
    content: AivatarContent;
    freeRoam: boolean;
    now: number;
    navMemory?: CardRoomNavigationMemory;
    partners?: Array<{ avatarId: string; avatarName: string; runtime: AvatarRuntime }>;
    actionCue?: CardRoomActionCue;
    copy?: CardRoomCopy;
  },
): CardRoomVisitorState => {
  useContentCollisionRects(options.content);
  const navigationKey = options.navigationKey ?? options.character.avatarId;
  if (state.phase === "pending") {
    if (options.now < (state.enterAt ?? options.now)) {
      return state;
    }

    return {
      ...state,
      phase: "entering",
      bubbleText: cardRoomCopy(options.copy, "cardRoom.bubble.imHere", "I'm here."),
      bubbleStartedAt: options.now,
      enterAt: undefined,
    };
  }

  const tablePlaying =
    options.table.street !== "waiting" &&
    options.table.street !== "handComplete" &&
    options.table.players.length > 0;
  const shouldRemainSeated =
    options.isUser ||
    Boolean(options.player && (tablePlaying || !options.freeRoam));

  if (shouldRemainSeated) {
    const runtime =
      options.player
        ? advanceCardRoomRuntime(state.runtime, elapsedSeconds, {
            player: options.player,
            opponentIndex: options.opponentIndex,
            opponentCount: options.opponentCount,
            navigationKey,
            table: options.table,
            copy: options.copy,
          })
        : createInitialCardRoomRuntime(options.character, 0, options.isUser, options.copy);
    const target = options.player
      ? seatTargetForPlayer(
          options.player,
          options.opponentIndex ?? 0,
          options.opponentCount ?? 0,
        )
      : null;
    const arrived = target
      ? distance(runtime, { x: target.targetX, y: target.targetY }) <= 4
      : true;
    const cue = arrived ? activeActionCue(options.actionCue, options.now) : undefined;
    const nextRuntime = cue
      ? {
          ...runtime,
          behavior:
            cue.type === "think" || cue.type === "hesitate"
              ? ("thinking" as const)
              : cue.type === "fold"
                ? ("relax" as const)
                : ("interact" as const),
          expression: expressionForActionCue(cue),
          activityLabel: cue.text,
        }
      : runtime;
    recordCardRoomNavigationMemory(options.navMemory, runtime, options.content);
    return {
      runtime: nextRuntime,
      phase: arrived ? "seated" : "seating",
      bubbleText: cue?.text,
      bubbleStartedAt: cue?.startedAt,
    };
  }

  const currentBubble = activeBubbleText(
    state.bubbleText,
    state.bubbleStartedAt,
    options.now,
  );
  const withBubble = (
    nextState: CardRoomVisitorState,
    bubbleText: string | undefined,
  ): CardRoomVisitorState => ({
    ...nextState,
    bubbleText,
    bubbleStartedAt: nextBubbleStartedAt(
      state.bubbleText,
      state.bubbleStartedAt,
      bubbleText,
      options.now,
    ),
  });

  if (state.phase === "entering") {
    const target = {
      x: state.runtime.targetX || CARD_ROOM_ENTRY_TARGET.x,
      y: state.runtime.targetY || CARD_ROOM_ENTRY_TARGET.y,
      facing: "right" as const,
    };
    const moved = moveRuntimeTowardNavigating(
      {
        ...state.runtime,
        targetX: target.x,
        targetY: target.y,
        behavior: "wander",
        expression: "happy",
        activityLabel: cardRoomCopy(
          options.copy,
          "cardRoom.activity.enteringRoom",
          "Entering card room",
        ),
        navigationFailure: undefined,
      },
      target,
      elapsedSeconds,
      54,
      navigationKey,
    );
    const arrived = distance(moved, { x: moved.targetX, y: moved.targetY }) <= 4;
    const runtime = arrived
      ? {
          ...moved,
          behavior: "idle" as const,
          behaviorTimer: 0,
          activityLabel: cardRoomCopy(options.copy, "cardRoom.activity.inRoom", "In card room"),
        }
      : moved;
    recordCardRoomNavigationMemory(options.navMemory, runtime, options.content);
    if (arrived) {
      options.navMemory && (options.navMemory.successes += 1);
      return withBubble(
        {
          runtime,
          phase: "free",
        },
        cardRoomCopy(
          options.copy,
          "cardRoom.bubble.readyLookAround",
          "Ready to look around.",
        ),
      );
    }
    return withBubble(
      {
        runtime,
        phase: "entering",
      },
      currentBubble ?? cardRoomCopy(options.copy, "cardRoom.bubble.imHere", "I'm here."),
    );
  }

  const justLeftSeat = state.phase === "seated" || state.phase === "seating";
  let runtime = justLeftSeat
    ? {
        ...state.runtime,
        behaviorTimer: 0,
        behavior: "wander" as const,
        expression: "calm" as const,
        activityLabel: cardRoomCopy(
          options.copy,
          "cardRoom.activity.leavingTable",
          "Leaving the table",
        ),
      }
    : state.runtime;
  let bubbleText = justLeftSeat
    ? cardRoomCopy(options.copy, "cardRoom.bubble.stretchingLegs", "Stretching my legs.")
    : currentBubble;

  const atTarget = distance(runtime, { x: runtime.targetX, y: runtime.targetY }) <= 4;
  if (runtime.behaviorTimer <= 0 || runtime.navigationFailure) {
    const plan = chooseFreeRoamPlan(
      options.character,
      runtime,
      options.content,
      options.partners ?? [],
      options.copy,
    );
    runtime = {
      ...runtime,
      targetX: plan.target.x,
      targetY: plan.target.y,
      facing: plan.facing ?? runtime.facing,
      behavior: plan.behavior,
      behaviorTimer: plan.timer,
      expression: plan.expression,
      activityLabel: plan.activityLabel,
      navigationFailure: undefined,
    };
    bubbleText = plan.bubbleText;
  } else if (atTarget) {
    runtime = {
      ...runtime,
      behaviorTimer: Math.max(0, runtime.behaviorTimer - elapsedSeconds),
      behavior: runtime.behavior === "wander" ? "idle" : runtime.behavior,
    };
  }

  const moved = moveRuntimeTowardNavigating(
    runtime,
    { x: runtime.targetX, y: runtime.targetY, facing: runtime.facing },
    elapsedSeconds,
    48,
    navigationKey,
  );
  const arrived = distance(moved, { x: moved.targetX, y: moved.targetY }) <= 4;
  const nextRuntime = {
    ...moved,
    behavior: arrived && moved.behavior === "wander" ? "idle" : moved.behavior,
    behaviorTimer: arrived
      ? Math.max(0, runtime.behaviorTimer - elapsedSeconds)
      : runtime.behaviorTimer,
    activityLabel: arrived
      ? runtime.activityLabel
      : cardRoomCopy(
          options.copy,
          "cardRoom.activity.movingThroughRoom",
          "Moving through card room",
        ),
  };
  if (arrived && !atTarget) {
    options.navMemory && (options.navMemory.successes += 1);
  }
  recordCardRoomNavigationMemory(options.navMemory, nextRuntime, options.content);

  return withBubble(
    {
      runtime: nextRuntime,
      phase: "free",
    },
    bubbleText,
  );
};
