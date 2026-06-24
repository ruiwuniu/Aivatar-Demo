import type {
  AivatarContent,
  AivatarMemory,
  AivatarNavMemory,
  AivatarRoomPresence,
  AivatarRoomVisitor,
  AivatarSaveState,
  AivatarSocialRoomMemory,
  AivatarVisitSession,
  AvatarAppearanceId,
  AvatarRuntime,
  BehaviorName,
  PetStats,
} from "../types";
import {
  explorationCellKey,
  getPlacedItemInteractionStandpoints,
  navigationLayoutFingerprint,
} from "./simulation";

export const ROOM_DOOR_RECT = {
  x: 188,
  y: 296,
  width: 104,
  height: 24,
};

export const ROOM_DOOR_INSIDE_POINT = {
  x: 240,
  y: 288,
};

export const ROOM_DOOR_OUTSIDE_POINT = {
  x: 240,
  y: 322,
};

const SOCIAL_NAV_MEMORY_CELL_COUNT_LIMIT = 9999;
const VISIT_RUNTIME_SPEED = 42;

export const createRoomDoorEntryRuntime = (): AvatarRuntime => ({
  x: ROOM_DOOR_OUTSIDE_POINT.x,
  y: ROOM_DOOR_OUTSIDE_POINT.y,
  targetX: ROOM_DOOR_INSIDE_POINT.x,
  targetY: ROOM_DOOR_INSIDE_POINT.y,
  facing: "back",
  behavior: "wander",
  behaviorTimer: 4,
  expression: "happy",
  activityLabel: "Visiting",
});

export const createRoomInstanceId = () =>
  `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export const createVisitId = () =>
  `visit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export const roomVisitNowIso = () => new Date().toISOString();

export const roomVisitExpiresAt = (ttlMs = 6500) =>
  new Date(Date.now() + ttlMs).toISOString();

export const isPointInRoomDoor = (point: { x: number; y: number }) =>
  point.x >= ROOM_DOOR_RECT.x &&
  point.x <= ROOM_DOOR_RECT.x + ROOM_DOOR_RECT.width &&
  point.y >= ROOM_DOOR_RECT.y &&
  point.y <= ROOM_DOOR_RECT.y + ROOM_DOOR_RECT.height;

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const defaultNavMemory = (): AivatarNavMemory => ({
  exploredCells: {},
  trickySpots: {},
  walkableCells: {},
  successes: 0,
  failures: 0,
});

const normalizeCountMap = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>(
    (result, [key, count]) => {
      const normalizedCount = Math.max(0, Math.round(Number(count)));
      if (key.length > 0 && Number.isFinite(normalizedCount)) {
        result[key] = normalizedCount;
      }
      return result;
    },
    {},
  );
};

const normalizeWalkableCells = (value: unknown): Record<string, 0 | 1> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key.length > 0)
      .map(([key, cell]) => [key, cell === 1 ? 1 : 0]),
  );
};

export const normalizeSocialRoomMemory = (
  value: Partial<AivatarSocialRoomMemory> | undefined,
  ownerAvatarId: string,
  hostAvatarId: string,
  hostRoomId: string,
  hostLayoutFingerprint: string,
): AivatarSocialRoomMemory => ({
  version: 1,
  ownerAvatarId,
  hostAvatarId,
  hostRoomId,
  hostLayoutFingerprint,
  navMemory: {
    ...defaultNavMemory(),
    ...(value?.navMemory ?? {}),
    exploredCells: normalizeCountMap(value?.navMemory?.exploredCells),
    trickySpots: normalizeCountMap(value?.navMemory?.trickySpots),
    walkableCells: normalizeWalkableCells(value?.navMemory?.walkableCells),
    layoutFingerprint: hostLayoutFingerprint,
    successes: Math.max(0, Math.round(value?.navMemory?.successes ?? 0)),
    failures: Math.max(0, Math.round(value?.navMemory?.failures ?? 0)),
  },
  visits: Math.max(0, Math.round(value?.visits ?? 0)),
  affinity: Math.max(0, Math.round(value?.affinity ?? 0)),
  lastVisitAt:
    typeof value?.lastVisitAt === "string" ? value.lastVisitAt : undefined,
  favoriteActivities:
    value?.favoriteActivities && typeof value.favoriteActivities === "object"
      ? value.favoriteActivities
      : {},
  learnedBubblePhrases: Array.isArray(value?.learnedBubblePhrases)
    ? value.learnedBubblePhrases.filter(
        (phrase): phrase is string =>
          typeof phrase === "string" && phrase.trim().length > 0,
      )
    : [],
});

export const socialRoomMemoryStorageKey = (
  ownerAvatarId: string,
  hostRoomId: string,
  hostLayoutFingerprint: string,
) =>
  [
    "aivatar.socialRoomMemory.v1",
    ownerAvatarId,
    hostRoomId,
    hostLayoutFingerprint,
  ]
    .map((part) => part.replace(/[^a-zA-Z0-9_.-]/g, "_"))
    .join(".");

export const recordSocialRoomNavSample = (
  memory: AivatarSocialRoomMemory,
  runtime: AvatarRuntime,
  result: "success" | "failure" = "success",
): AivatarSocialRoomMemory => {
  const cellKey = explorationCellKey(runtime);
  const navMemory = memory.navMemory ?? defaultNavMemory();
  const exploredCount = navMemory.exploredCells[cellKey] ?? 0;
  const trickyCount = navMemory.trickySpots[cellKey] ?? 0;
  const walkableValue: 0 | 1 = result === "failure" ? 1 : 0;

  return {
    ...memory,
    navMemory: {
      ...navMemory,
      layoutFingerprint: memory.hostLayoutFingerprint,
      exploredCells: {
        ...navMemory.exploredCells,
        [cellKey]: Math.min(SOCIAL_NAV_MEMORY_CELL_COUNT_LIMIT, exploredCount + 1),
      },
      walkableCells: {
        ...navMemory.walkableCells,
        [cellKey]: walkableValue,
      },
      trickySpots:
        result === "failure"
          ? {
              ...navMemory.trickySpots,
              [cellKey]: Math.min(SOCIAL_NAV_MEMORY_CELL_COUNT_LIMIT, trickyCount + 1),
            }
          : navMemory.trickySpots,
      successes: navMemory.successes + (result === "success" ? 1 : 0),
      failures: navMemory.failures + (result === "failure" ? 1 : 0),
      lastExploredAt: roomVisitNowIso(),
    },
  };
};

export const completeSocialRoomVisit = (
  memory: AivatarSocialRoomMemory,
  activity?: BehaviorName,
  learnedPhrase?: string | null,
) => {
  const favoriteActivities = { ...(memory.favoriteActivities ?? {}) };
  if (activity) {
    favoriteActivities[activity] = (favoriteActivities[activity] ?? 0) + 1;
  }
  const learnedBubblePhrases = learnedPhrase
    ? Array.from(new Set([...(memory.learnedBubblePhrases ?? []), learnedPhrase])).slice(0, 12)
    : memory.learnedBubblePhrases ?? [];

  return {
    ...memory,
    visits: memory.visits + 1,
    affinity: Math.min(999, memory.affinity + (activity === "play" ? 3 : 2)),
    lastVisitAt: roomVisitNowIso(),
    favoriteActivities,
    learnedBubblePhrases,
  };
};

const isAvatarAppearanceId = (value: string): value is AvatarAppearanceId =>
  [
    "octopus",
    "demo-spark",
    "mood-slime",
    "cute-crayfish",
    "cute-ghost",
    "cute-penguin",
    "wave-lizard",
  ].includes(value);

export const normalizeRoomPresence = (
  value: Partial<AivatarRoomPresence>,
): AivatarRoomPresence | null => {
  if (
    !value ||
    typeof value.roomInstanceId !== "string" ||
    typeof value.slotId !== "string" ||
    typeof value.avatarId !== "string" ||
    typeof value.roomId !== "string" ||
    !value.avatarAppearanceId ||
    !isAvatarAppearanceId(value.avatarAppearanceId)
  ) {
    return null;
  }

  return {
    type: "aivatar.room.presence",
    roomInstanceId: value.roomInstanceId,
    slotId: value.slotId,
    slotIndex: Math.max(0, Math.round(value.slotIndex ?? 0)),
    avatarId: value.avatarId,
    avatarName:
      typeof value.avatarName === "string" && value.avatarName.trim()
        ? value.avatarName.trim()
        : "Aivatar",
    avatarAppearanceId: value.avatarAppearanceId,
    roomId: value.roomId,
    status:
      value.status === "away" ||
      value.status === "hosting" ||
      value.status === "busy"
        ? value.status
        : "home",
    currentVisitId:
      typeof value.currentVisitId === "string" ? value.currentVisitId : null,
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : roomVisitNowIso(),
    expiresAt:
      typeof value.expiresAt === "string" ? value.expiresAt : roomVisitExpiresAt(),
    growthLevel: Math.max(1, Math.round(value.growthLevel ?? 1)),
    traits: {
      focus: clamp(value.traits?.focus ?? 0, 0, 999),
      resilience: clamp(value.traits?.resilience ?? 0, 0, 999),
      curiosity: clamp(value.traits?.curiosity ?? 0, 0, 999),
      efficiency: clamp(value.traits?.efficiency ?? 0, 0, 999),
      creativity: clamp(value.traits?.creativity ?? 0, 0, 999),
      warmth: clamp(value.traits?.warmth ?? 0, 0, 999),
    },
    idleBubblePhrases: Array.isArray(value.idleBubblePhrases)
      ? value.idleBubblePhrases
          .filter((phrase): phrase is string => typeof phrase === "string")
          .map((phrase) => phrase.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [],
    petStats: {
      energy: clamp(value.petStats?.energy ?? 70),
      mood: clamp(value.petStats?.mood ?? 70),
      hunger: clamp(value.petStats?.hunger ?? 50),
    },
  };
};

export const roomPresenceFromSave = (
  roomInstanceId: string,
  slotId: string,
  slotIndex: number,
  save: AivatarSaveState,
  memory: AivatarMemory,
  status: AivatarRoomPresence["status"],
  currentVisitId?: string | null,
): AivatarRoomPresence => ({
  type: "aivatar.room.presence",
  roomInstanceId,
  slotId,
  slotIndex,
  avatarId: save.avatarId ?? "avatar",
  avatarName: save.avatarName?.trim() || "Aivatar",
  avatarAppearanceId: isAvatarAppearanceId(String(save.avatarAppearanceId))
    ? (save.avatarAppearanceId as AvatarAppearanceId)
    : "octopus",
  roomId: save.roomId ?? "room",
  status,
  currentVisitId: currentVisitId ?? null,
  updatedAt: roomVisitNowIso(),
  expiresAt: roomVisitExpiresAt(),
  growthLevel: memory.growth.level,
  traits: memory.growth.traits,
  idleBubblePhrases: (memory.preferences.idleBubblePhrases ?? []).slice(0, 8),
  petStats: save.petStats,
});

export const normalizeVisitSession = (
  value: Partial<AivatarVisitSession>,
): AivatarVisitSession | null => {
  const host = value.host ? normalizeRoomPresence(value.host) : null;
  const guest = value.guest ? normalizeRoomPresence(value.guest) : null;
  if (
    !host ||
    !guest ||
    typeof value.visitId !== "string" ||
    typeof value.hostLayoutFingerprint !== "string" ||
    typeof value.hostRoomId !== "string"
  ) {
    return null;
  }

  const phase = [
    "invited",
    "accepted",
    "active",
    "returning",
    "ended",
    "cancelled",
  ].includes(String(value.phase))
    ? value.phase!
    : "invited";

  return {
    type: "aivatar.room.visit",
    visitId: value.visitId,
    phase,
    host,
    guest,
    hostLayoutFingerprint: value.hostLayoutFingerprint,
    hostRoomId: value.hostRoomId,
    guestRuntime: value.guestRuntime,
    guestRuntimeRoomInstanceId:
      typeof value.guestRuntimeRoomInstanceId === "string"
        ? value.guestRuntimeRoomInstanceId
        : undefined,
    activity: value.activity,
    bubbleText:
      typeof value.bubbleText === "string" ? value.bubbleText.slice(0, 24) : undefined,
    cancelReason:
      typeof value.cancelReason === "string" ? value.cancelReason.slice(0, 120) : undefined,
    createdAt:
      typeof value.createdAt === "string" ? value.createdAt : roomVisitNowIso(),
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : roomVisitNowIso(),
    expiresAt:
      typeof value.expiresAt === "string" ? value.expiresAt : roomVisitExpiresAt(),
  };
};

export const hostLayoutFingerprint = (content: AivatarContent) =>
  navigationLayoutFingerprint(content);

export const createVisitorFromVisit = (
  visit: AivatarVisitSession,
  memory?: AivatarMemory,
): AivatarRoomVisitor => {
  const guestRuntimeInHostRoom =
    visit.guestRuntimeRoomInstanceId === visit.host.roomInstanceId
      ? visit.guestRuntime
      : undefined;

  return {
    visitId: visit.visitId,
    avatarId: visit.guest.avatarId,
    avatarName: visit.guest.avatarName,
    avatarAppearanceId: visit.guest.avatarAppearanceId,
    runtime: guestRuntimeInHostRoom ?? createRoomDoorEntryRuntime(),
    petStats: visit.guest.petStats,
    memory,
    bubbleText: visit.bubbleText,
    phase:
      visit.phase === "returning"
        ? "leaving"
        : visit.phase === "active" && guestRuntimeInHostRoom
          ? "socializing"
          : "entering",
  };
};

const distance = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.hypot(left.x - right.x, left.y - right.y);

const moveToward = (
  runtime: AvatarRuntime,
  target: { x: number; y: number },
  elapsedSeconds: number,
): AvatarRuntime => {
  const dx = target.x - runtime.x;
  const dy = target.y - runtime.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1) {
    return {
      ...runtime,
      x: target.x,
      y: target.y,
      targetX: target.x,
      targetY: target.y,
    };
  }

  const step = Math.min(dist, VISIT_RUNTIME_SPEED * elapsedSeconds);
  const nextX = runtime.x + (dx / dist) * step;
  const nextY = runtime.y + (dy / dist) * step;
  const facing =
    Math.abs(dx) > Math.abs(dy)
      ? dx < 0
        ? "left"
        : "right"
      : dy < 0
        ? "back"
        : "front";

  return {
    ...runtime,
    x: nextX,
    y: nextY,
    targetX: target.x,
    targetY: target.y,
    facing,
  };
};

const weightedBehavior = (
  traits: AivatarRoomPresence["traits"],
  hasGameConsole: boolean,
): BehaviorName => {
  const choices: Array<{ behavior: BehaviorName; weight: number }> = [
    { behavior: "play", weight: hasGameConsole ? 8 + traits.efficiency / 70 : 0 },
    { behavior: "wander", weight: 6 + traits.curiosity / 80 },
    { behavior: "admire", weight: 4 + traits.creativity / 90 },
    { behavior: "relax", weight: 5 + traits.warmth / 80 },
    { behavior: "interact", weight: 8 + traits.warmth / 60 },
  ];
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  let roll = Math.random() * total;
  for (const choice of choices) {
    roll -= choice.weight;
    if (roll <= 0) return choice.behavior;
  }
  return "interact";
};

const randomSocialTarget = (
  content: AivatarContent,
  behavior: BehaviorName,
  hostRuntime: AvatarRuntime,
) => {
  if (behavior === "play") {
    const gameConsole = content.placedItems?.find((item) => item.itemId === "game-console");
    if (gameConsole) {
      const standpoints = getPlacedItemInteractionStandpoints(gameConsole, content);
      const point = standpoints[standpoints.length > 1 ? 1 : 0];
      if (point) return point;
      return { x: gameConsole.x + 28, y: gameConsole.y + 30 };
    }
  }

  if (behavior === "admire" && content.placedItems?.length) {
    const item = content.placedItems[Math.floor(Math.random() * content.placedItems.length)];
    return {
      x: clamp(item.x + 16 + (Math.random() - 0.5) * 42, 92, 388),
      y: clamp(item.y + 30 + (Math.random() - 0.5) * 32, 148, 292),
    };
  }

  if (behavior === "interact" || behavior === "relax") {
    return {
      x: clamp(hostRuntime.x + (Math.random() > 0.5 ? 24 : -24), 92, 388),
      y: clamp(hostRuntime.y + 8 + (Math.random() - 0.5) * 20, 148, 292),
    };
  }

  return {
    x: Math.round(104 + Math.random() * 272),
    y: Math.round(154 + Math.random() * 132),
  };
};

export const advanceRoomVisitor = (
  visitor: AivatarRoomVisitor,
  content: AivatarContent,
  hostRuntime: AvatarRuntime,
  hostTraits: AivatarRoomPresence["traits"],
  elapsedSeconds: number,
) => {
  const hasGameConsole = Boolean(content.placedItems?.some((item) => item.itemId === "game-console"));
  let runtime = visitor.runtime;
  let phase = visitor.phase ?? "entering";
  let bubbleText = visitor.bubbleText;

  if (phase === "entering") {
    runtime = moveToward(runtime, ROOM_DOOR_INSIDE_POINT, elapsedSeconds);
    runtime = {
      ...runtime,
      behavior: "wander",
      expression: "happy",
      activityLabel: "Visiting",
      behaviorTimer: Math.max(0, runtime.behaviorTimer - elapsedSeconds),
    };
    bubbleText = "!";
    if (distance(runtime, ROOM_DOOR_INSIDE_POINT) <= 2) {
      phase = "socializing";
      runtime = {
        ...runtime,
        targetX: hostRuntime.x + 22,
        targetY: hostRuntime.y,
        behavior: "interact",
        behaviorTimer: 3,
        activityLabel: "Chatting",
      };
      bubbleText = "...";
    }
  } else if (phase === "leaving") {
    runtime = moveToward(runtime, ROOM_DOOR_OUTSIDE_POINT, elapsedSeconds);
    runtime = {
      ...runtime,
      behavior: "wander",
      expression: "happy",
      activityLabel: "Heading home",
      behaviorTimer: Math.max(0, runtime.behaviorTimer - elapsedSeconds),
    };
    bubbleText = "bye";
  } else {
    runtime = {
      ...runtime,
      behaviorTimer: runtime.behaviorTimer - elapsedSeconds,
    };

    if (runtime.behaviorTimer <= 0 || distance(runtime, { x: runtime.targetX, y: runtime.targetY }) <= 4) {
      const behavior = weightedBehavior(hostTraits, hasGameConsole);
      const target = randomSocialTarget(content, behavior, hostRuntime);
      runtime = {
        ...runtime,
        targetX: target.x,
        targetY: target.y,
        behavior,
        behaviorTimer: behavior === "play" ? 9 : behavior === "interact" ? 6 : 8,
        expression: behavior === "interact" || behavior === "play" ? "happy" : "calm",
        activityLabel:
          behavior === "play"
            ? "Playing together"
            : behavior === "interact"
              ? "Chatting"
              : behavior === "admire"
                ? "Looking around"
                : behavior === "relax"
                  ? "Hanging out"
                  : "Wandering",
      };
      bubbleText =
        behavior === "play"
          ? "++"
          : behavior === "interact"
            ? "..."
            : behavior === "admire"
              ? "*"
              : behavior === "relax"
                ? "<3"
                : "?";
    }

    runtime = moveToward(runtime, { x: runtime.targetX, y: runtime.targetY }, elapsedSeconds);
  }

  return {
    ...visitor,
    runtime,
    phase,
    bubbleText,
  };
};
