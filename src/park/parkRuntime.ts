import type { AivatarGrowthTraits, AivatarNavMemory, AvatarRuntime } from "../types";
import {
  PARK_BENCH_RELAX_SPOT,
  PARK_ENTRY_POINT,
  PARK_FISHING_SPOTS,
  PARK_REFERENCE_COLLIDERS,
  isParkGrassPoint,
  parkObjectDefinition,
  type ParkObjectPlacement,
} from "./parkContent";
import {
  canLandFishingCatch,
  fishingBiteDelaySeconds,
  shouldFishBite,
  fishingHookStruggleDurationSeconds,
  fishingSessionDurationSeconds,
  randomFishingCatch,
  shouldChooseParkReading,
  type ParkRawFishId,
  type ParkRandomSource,
} from "./parkProbability";
import { defaultParkNavMemory, normalizeParkNavMemory } from "./parkStorage";

export type ParkActivity =
  | "wander"
  | "to-fishing"
  | "to-bench"
  | "bench-relax"
  | "bench-read"
  | "cast"
  | "wait"
  | "bite"
  | "reel"
  | "display";
export type ParkFishingPose = "none" | "cast" | "yawn" | "focus" | "whistle" | "bite" | "reel" | "display";
export type ParkBenchPose = "none" | "relax" | "read";

type Point = { x: number; y: number };

export interface ParkSimulationState {
  avatar: AvatarRuntime;
  navMemory: AivatarNavMemory;
  activity: ParkActivity;
  fishingPose: ParkFishingPose;
  benchPose: ParkBenchPose;
  benchIntent?: Exclude<ParkBenchPose, "none">;
  path: Point[];
  activityStartedAt: number;
  activityEndsAt: number;
  fishingStartedAt: number;
  fishingSessionEndsAt: number;
  nextBiteAt: number;
  nextDecisionAt: number;
  fishingSpotId?: string;
  pendingFish?: ParkRawFishId;
}

export interface ParkSimulationEvent {
  type: "catch";
  fishId: ParkRawFishId;
}

const GRID = 24;
const cellKey = (x: number, y: number) => `${x},${y}`;
const pointToCell = (point: Point) => ({
  x: Math.round(point.x / GRID),
  y: Math.round(point.y / GRID),
});
const cellToPoint = (cell: Point) => ({ x: cell.x * GRID, y: cell.y * GRID });

const objectBlocksPoint = (point: Point, objects: ParkObjectPlacement[]) =>
  PARK_REFERENCE_COLLIDERS.some(
    (collider) => Math.hypot(point.x - collider.x, point.y - collider.y) < collider.radius + 12,
  ) ||
  objects.some((object) => {
    const radius = parkObjectDefinition(object.kind).radius;
    return Math.hypot(point.x - object.x, point.y - object.y) < radius + 12;
  });

const walkable = (point: Point, objects: ParkObjectPlacement[]) =>
  isParkGrassPoint(point.x, point.y) && !objectBlocksPoint(point, objects);

const reconstructPath = (
  cameFrom: Map<string, string>,
  endKey: string,
  cells: Map<string, Point>,
) => {
  const path: Point[] = [];
  let current: string | undefined = endKey;
  while (current) {
    const cell = cells.get(current);
    if (cell) path.push(cellToPoint(cell));
    current = cameFrom.get(current);
  }
  return path.reverse().slice(1);
};

export const findParkPath = (
  start: Point,
  target: Point,
  objects: ParkObjectPlacement[],
) => {
  const startCell = pointToCell(start);
  const targetCell = pointToCell(target);
  const startKey = cellKey(startCell.x, startCell.y);
  const targetKey = cellKey(targetCell.x, targetCell.y);
  const open = new Set([startKey]);
  const cells = new Map<string, Point>([
    [startKey, startCell],
    [targetKey, targetCell],
  ]);
  const cameFrom = new Map<string, string>();
  const g = new Map<string, number>([[startKey, 0]]);
  const f = new Map<string, number>([
    [startKey, Math.hypot(targetCell.x - startCell.x, targetCell.y - startCell.y)],
  ]);

  for (let iteration = 0; iteration < 4500 && open.size > 0; iteration += 1) {
    const currentKey = [...open].reduce((best, key) =>
      (f.get(key) ?? Infinity) < (f.get(best) ?? Infinity) ? key : best,
    );
    if (currentKey === targetKey) return reconstructPath(cameFrom, currentKey, cells);
    open.delete(currentKey);
    const current = cells.get(currentKey)!;
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
      { x: current.x + 1, y: current.y + 1 },
      { x: current.x - 1, y: current.y + 1 },
      { x: current.x + 1, y: current.y - 1 },
      { x: current.x - 1, y: current.y - 1 },
    ];
    for (const neighbor of neighbors) {
      const point = cellToPoint(neighbor);
      if (!walkable(point, objects) && cellKey(neighbor.x, neighbor.y) !== targetKey) continue;
      const key = cellKey(neighbor.x, neighbor.y);
      cells.set(key, neighbor);
      const diagonal = neighbor.x !== current.x && neighbor.y !== current.y;
      const tentative = (g.get(currentKey) ?? Infinity) + (diagonal ? 1.414 : 1);
      if (tentative >= (g.get(key) ?? Infinity)) continue;
      cameFrom.set(key, currentKey);
      g.set(key, tentative);
      f.set(
        key,
        tentative + Math.hypot(targetCell.x - neighbor.x, targetCell.y - neighbor.y),
      );
      open.add(key);
    }
  }
  return [];
};

const randomGrassPoint = (
  objects: ParkObjectPlacement[],
  random: ParkRandomSource,
) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const point = { x: 180 + random() * 700, y: 360 + random() * 430 };
    const snapped = cellToPoint(pointToCell(point));
    if (walkable(snapped, objects)) return snapped;
  }
  return PARK_ENTRY_POINT;
};

const validRuntime = (runtime: AvatarRuntime | undefined) =>
  Boolean(
    runtime &&
      [runtime.x, runtime.y, runtime.targetX, runtime.targetY].every(Number.isFinite) &&
      isParkGrassPoint(runtime!.x, runtime!.y),
  );

export const initialParkSimulation = (
  savedRuntime?: AvatarRuntime,
  savedMemory?: AivatarNavMemory,
): ParkSimulationState => {
  const point = validRuntime(savedRuntime) ? savedRuntime! : undefined;
  const avatar: AvatarRuntime = point
    ? { ...point, behavior: "idle", behaviorTimer: 1, activityLabel: "In the park" }
    : {
        x: PARK_ENTRY_POINT.x,
        y: PARK_ENTRY_POINT.y,
        targetX: PARK_ENTRY_POINT.x,
        targetY: PARK_ENTRY_POINT.y,
        facing: "back",
        behavior: "idle",
        behaviorTimer: 1,
        expression: "happy",
        activityLabel: "Arriving at the park",
      };
  return {
    avatar,
    navMemory: savedMemory ? normalizeParkNavMemory(savedMemory) : defaultParkNavMemory(),
    activity: "wander",
    fishingPose: "none",
    benchPose: "none",
    path: [],
    activityStartedAt: performance.now(),
    activityEndsAt: 0,
    fishingStartedAt: 0,
    fishingSessionEndsAt: 0,
    nextBiteAt: 0,
    nextDecisionAt: performance.now() + 3500,
  };
};

const rememberPath = (memory: AivatarNavMemory, path: Point[], success: boolean) => {
  const next = normalizeParkNavMemory(memory);
  const walkableCells = { ...next.walkableCells };
  const exploredCells = { ...next.exploredCells };
  path.forEach((point) => {
    const cell = pointToCell(point);
    const key = cellKey(cell.x, cell.y);
    walkableCells[key] = 0;
    exploredCells[key] = Math.min(9999, (exploredCells[key] ?? 0) + 1);
  });
  return {
    ...next,
    walkableCells,
    exploredCells,
    successes: next.successes + (success ? 1 : 0),
    failures: next.failures + (success ? 0 : 1),
    lastExploredAt: new Date().toISOString(),
  };
};

const faceToward = (from: Point, to: Point): AvatarRuntime["facing"] => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "back" : "front";
};

const beginPath = (
  state: ParkSimulationState,
  target: Point,
  activity: ParkActivity,
  objects: ParkObjectPlacement[],
) => {
  const gridPath = findParkPath(state.avatar, target, objects);
  const startCell = pointToCell(state.avatar);
  const targetCell = pointToCell(target);
  const benchTargetReachable =
    gridPath.length > 0
    || (startCell.x === targetCell.x && startCell.y === targetCell.y);
  const path = activity === "to-bench" && benchTargetReachable
    ? [...gridPath, target].filter(
        (point, index, points) =>
          index === 0
          || Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) > 0.5,
      )
    : gridPath;
  return {
    ...state,
    activity,
    path,
    navMemory: rememberPath(state.navMemory, path, path.length > 0),
    avatar: {
      ...state.avatar,
      targetX: target.x,
      targetY: target.y,
      behavior: "wander" as const,
      expression: "happy" as const,
      activityLabel:
        activity === "to-fishing"
          ? "Going fishing"
          : activity === "to-bench"
            ? "Going to the hilltop bench"
            : "Exploring the park",
    },
  };
};

export const forceParkFishingPreview = (
  input: ParkSimulationState,
  objects: ParkObjectPlacement[],
  now: number,
) => {
  const spot = PARK_FISHING_SPOTS.reduce((closest, candidate) =>
    Math.hypot(candidate.x - input.avatar.x, candidate.y - input.avatar.y) <
    Math.hypot(closest.x - input.avatar.x, closest.y - input.avatar.y)
      ? candidate
      : closest,
  );
  const state = beginPath(
    {
      ...input,
      activity: "wander",
      fishingPose: "none",
      benchPose: "none",
      benchIntent: undefined,
      path: [],
      fishingSpotId: spot.id,
      pendingFish: undefined,
      activityStartedAt: now,
      activityEndsAt: 0,
      fishingStartedAt: 0,
      fishingSessionEndsAt: 0,
      nextBiteAt: 0,
      nextDecisionAt: now,
    },
    spot,
    "to-fishing",
    objects,
  );
  return {
    ...state,
    avatar: {
      ...state.avatar,
      expression: "focused" as const,
      activityLabel: "Going fishing (Debug)",
    },
  };
};

export const forceParkBenchPreview = (
  input: ParkSimulationState,
  objects: ParkObjectPlacement[],
  now: number,
  intent: Exclude<ParkBenchPose, "none">,
) => {
  const state = beginPath(
    {
      ...input,
      activity: "wander",
      fishingPose: "none",
      benchPose: "none",
      benchIntent: intent,
      fishingSpotId: undefined,
      pendingFish: undefined,
      path: [],
      activityStartedAt: now,
      activityEndsAt: 0,
      fishingStartedAt: 0,
      fishingSessionEndsAt: 0,
      nextBiteAt: 0,
      nextDecisionAt: now,
    },
    { x: PARK_BENCH_RELAX_SPOT.x, y: PARK_BENCH_RELAX_SPOT.y },
    "to-bench",
    objects,
  );
  return {
    ...state,
    avatar: {
      ...state.avatar,
      expression: intent === "read" ? ("focused" as const) : ("calm" as const),
      activityLabel:
        intent === "read" ? "Going to read on the hilltop bench (Debug)" : "Going to relax on the hilltop bench (Debug)",
    },
  };
};

const moveAlongPath = (
  state: ParkSimulationState,
  elapsedSeconds: number,
) => {
  let remaining = Math.max(0, elapsedSeconds) * 68;
  let x = state.avatar.x;
  let y = state.avatar.y;
  const path = [...state.path];
  while (remaining > 0 && path.length > 0) {
    const target = path[0];
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance <= remaining || distance < 1) {
      x = target.x;
      y = target.y;
      remaining -= distance;
      path.shift();
    } else {
      x += ((target.x - x) / distance) * remaining;
      y += ((target.y - y) / distance) * remaining;
      remaining = 0;
    }
  }
  const nextTarget = path[0] ?? { x, y };
  return {
    ...state,
    path,
    avatar: {
      ...state.avatar,
      x,
      y,
      facing: faceToward({ x, y }, nextTarget),
      targetX: nextTarget.x,
      targetY: nextTarget.y,
      behavior: path.length > 0 ? ("wander" as const) : state.avatar.behavior,
    },
  };
};

const fishingWaitPose = (now: number): ParkFishingPose => {
  const phase = Math.floor(now / 3200) % 6;
  if (phase === 1) return "yawn";
  if (phase === 3) return "whistle";
  return "focus";
};

export const advanceParkSimulation = (
  input: ParkSimulationState,
  elapsedSeconds: number,
  now: number,
  options: {
    objects: ParkObjectPlacement[];
    traits: Partial<AivatarGrowthTraits>;
    hasRod: boolean;
    random?: ParkRandomSource;
  },
): { state: ParkSimulationState; events: ParkSimulationEvent[] } => {
  const random = options.random ?? Math.random;
  const events: ParkSimulationEvent[] = [];
  let state = moveAlongPath(input, elapsedSeconds);

  if (state.path.length > 0) return { state, events };

  if (state.activity === "to-bench") {
    const reading = state.benchIntent === "read";
    const durationSeconds = reading
      ? 18 + random() * 8
      : 12 + random() * 6;
    state = {
      ...state,
      activity: reading ? "bench-read" : "bench-relax",
      benchPose: reading ? "read" : "relax",
      activityStartedAt: now,
      activityEndsAt: now + durationSeconds * 1000,
      avatar: {
        ...state.avatar,
        facing: PARK_BENCH_RELAX_SPOT.facing,
        behavior: reading ? "read_book" : "relax",
        behaviorTimer: durationSeconds,
        expression: reading ? "focused" : "calm",
        activityLabel: reading ? "Reading on the hilltop bench" : "Relaxing on the hilltop bench",
      },
    };
    return { state, events };
  }

  if (
    (state.activity === "bench-relax" || state.activity === "bench-read")
    && now >= state.activityEndsAt
  ) {
    state = {
      ...state,
      activity: "wander",
      benchPose: "none",
      benchIntent: undefined,
      activityStartedAt: now,
      activityEndsAt: 0,
      nextDecisionAt: now + 3000 + random() * 2000,
      avatar: {
        ...state.avatar,
        behavior: "idle",
        behaviorTimer: 1,
        expression: "happy",
        activityLabel: "Enjoying the park",
      },
    };
    return { state, events };
  }

  if (state.activity === "to-fishing") {
    state = {
      ...state,
      activity: "cast",
      fishingPose: "cast",
      activityStartedAt: now,
      activityEndsAt: now + 1200,
      fishingStartedAt: now,
      fishingSessionEndsAt:
        now + fishingSessionDurationSeconds(options.traits.resilience, random) * 1000,
      avatar: {
        ...state.avatar,
        facing: "front",
        behavior: "interact",
        expression: "focused",
        activityLabel: "Casting a line",
      },
    };
    return { state, events };
  }

  if (state.activity === "cast" && now >= state.activityEndsAt) {
    state = {
      ...state,
      activity: "wait",
      fishingPose: "focus",
      activityStartedAt: now,
      nextBiteAt: now + fishingBiteDelaySeconds(random) * 1000,
      avatar: {
        ...state.avatar,
        facing: "right",
        behavior: "admire",
        expression: "calm",
        activityLabel: "Fishing",
      },
    };
    return { state, events };
  }

  if (state.activity === "wait") {
    if (now >= state.fishingSessionEndsAt) {
      state = {
        ...state,
        activity: "wander",
        fishingPose: "none",
        fishingStartedAt: 0,
        fishingSpotId: undefined,
        nextDecisionAt: now + 3000,
      };
    } else if (now >= state.nextBiteAt) {
      const elapsedFishingSeconds = Math.max(0, (now - state.fishingStartedAt) / 1000);
      if (shouldFishBite(elapsedFishingSeconds, random)) {
        state = {
          ...state,
          activity: "bite",
          fishingPose: "bite",
          pendingFish: randomFishingCatch(random),
          activityStartedAt: now,
          activityEndsAt: now + fishingHookStruggleDurationSeconds(random) * 1000,
          avatar: {
            ...state.avatar,
            behavior: "interact",
            expression: "focused",
            activityLabel: "A fish is fighting on the line",
          },
        };
      } else {
        state = {
          ...state,
          fishingPose: "focus",
          activityStartedAt: now,
          nextBiteAt: now + fishingBiteDelaySeconds(random) * 1000,
          avatar: {
            ...state.avatar,
            behavior: "admire",
            expression: "calm",
            activityLabel: "Waiting for a bite",
          },
        };
      }
    } else {
      const pose = fishingWaitPose(now);
      state = {
        ...state,
        fishingPose: pose,
        activityStartedAt: pose === state.fishingPose ? state.activityStartedAt : now,
        avatar: {
          ...state.avatar,
          behavior: pose === "yawn" ? "sleep" : "admire",
          expression: pose === "yawn" ? "sleepy" : pose === "focus" ? "focused" : "happy",
          activityLabel: pose === "whistle" ? "Whistling while fishing" : "Fishing",
        },
      };
    }
    return { state, events };
  }

  if (state.activity === "bite" && now >= state.activityEndsAt && state.pendingFish) {
    if (canLandFishingCatch(options.traits.focus, random)) {
      state = {
        ...state,
        activity: "reel",
        fishingPose: "reel",
        activityStartedAt: now,
        activityEndsAt: now + 1450,
        avatar: {
          ...state.avatar,
          behavior: "interact",
          expression: "focused",
          activityLabel: "Reeling in",
        },
      };
    } else {
      state = {
        ...state,
        activity: "wait",
        fishingPose: "focus",
        pendingFish: undefined,
        activityStartedAt: now,
        activityEndsAt: 0,
        nextBiteAt: now + fishingBiteDelaySeconds(random) * 1000,
        avatar: {
          ...state.avatar,
          behavior: "admire",
          expression: "worried",
          activityLabel: "The fish slipped off the hook",
        },
      };
    }
    return { state, events };
  }

  if (state.activity === "reel" && now >= state.activityEndsAt && state.pendingFish) {
    state = {
      ...state,
      activity: "display",
      fishingPose: "display",
      activityStartedAt: now,
      activityEndsAt: now + 2800,
      avatar: { ...state.avatar, facing: "front", behavior: "success", expression: "happy", activityLabel: "Showing the catch" },
    };
    return { state, events };
  }

  if (state.activity === "display" && now >= state.activityEndsAt && state.pendingFish) {
    events.push({ type: "catch", fishId: state.pendingFish });
    if (now < state.fishingSessionEndsAt) {
      state = {
        ...state,
        activity: "cast",
        fishingPose: "cast",
        pendingFish: undefined,
        activityStartedAt: now,
        activityEndsAt: now + 1200,
        avatar: {
          ...state.avatar,
          facing: "front",
          behavior: "interact",
          expression: "focused",
          activityLabel: "Casting again",
        },
      };
    } else {
      state = {
        ...state,
        activity: "wander",
        fishingPose: "none",
        fishingStartedAt: 0,
        fishingSpotId: undefined,
        pendingFish: undefined,
        nextDecisionAt: now + 3500,
      };
    }
    return { state, events };
  }

  if (state.activity === "wander" && now >= state.nextDecisionAt) {
    const decision = random();
    const fishingChance = options.hasRod ? 0.38 : 0;
    const benchChance = options.hasRod ? 0.27 : 0.32;
    if (decision < fishingChance) {
      const spot = PARK_FISHING_SPOTS[Math.floor(random() * PARK_FISHING_SPOTS.length)]!;
      state = beginPath(
        { ...state, benchPose: "none", benchIntent: undefined, fishingSpotId: spot.id },
        spot,
        "to-fishing",
        options.objects,
      );
    } else if (decision < fishingChance + benchChance) {
      const intent = shouldChooseParkReading(
        options.traits.focus,
        options.traits.curiosity,
        random,
      )
        ? "read"
        : "relax";
      state = beginPath(
        {
          ...state,
          benchPose: "none",
          benchIntent: intent,
          fishingPose: "none",
          fishingSpotId: undefined,
        },
        { x: PARK_BENCH_RELAX_SPOT.x, y: PARK_BENCH_RELAX_SPOT.y },
        "to-bench",
        options.objects,
      );
    } else {
      state = beginPath(
        {
          ...state,
          benchPose: "none",
          benchIntent: undefined,
          nextDecisionAt: now + 4500 + random() * 5500,
        },
        randomGrassPoint(options.objects, random),
        "wander",
        options.objects,
      );
    }
  }

  if (state.activity === "wander" && state.path.length === 0) {
    state = {
      ...state,
      avatar: { ...state.avatar, behavior: "idle", expression: "happy", activityLabel: "Enjoying the park" },
    };
  }

  return { state, events };
};
