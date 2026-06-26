import type {
  AivatarContent,
  AivatarMemory,
  AivatarNavMemory,
  AivatarRoomPresence,
  AivatarRoomVisitor,
  AivatarSaveState,
  AivatarSocialRelationship,
  AivatarSocialRoomMemory,
  AivatarVisitSession,
  AvatarAppearanceId,
  AvatarRuntime,
  BehaviorName,
  PetStats,
} from "../types";
import {
  explorationCellKey,
  getFurnitureInteractionStandpoints,
  getPlacedItemInteractionStandpoints,
  navigationLayoutFingerprint,
  tickAvatar,
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
const VISITOR_NAVIGATION_SCOPE_PREFIX = "room-visitor";
const SOCIAL_ROOM_X_MIN = 92;
const SOCIAL_ROOM_X_MAX = 388;
const SOCIAL_ROOM_Y_MIN = 148;
const SOCIAL_ROOM_Y_MAX = 292;
const SOCIAL_PAIR_DISTANCE = 44;
const SOCIAL_PAIR_Y_OFFSET = 6;
const SOCIAL_WILLINGNESS_DEFAULT = 50;
const SOCIAL_WILLINGNESS_MIN_FOR_AUTONOMY = 32;
const SOCIAL_AFFINITY_MAX = 999;
const SOCIAL_HIGH_AFFINITY_THRESHOLD = 90;
const SOCIAL_BED_CHAT_AFFINITY_THRESHOLD = 140;
export const ROOM_VISIT_BUBBLE_KEY_PREFIX = "roomVisit.bubble.";

const ROOM_VISIT_BUBBLE_KEYS: Partial<Record<BehaviorName, string[]>> = {
  play: [
    "roomVisit.bubble.play.1",
    "roomVisit.bubble.play.2",
    "roomVisit.bubble.play.3",
  ],
  coffee: [
    "roomVisit.bubble.coffee.1",
    "roomVisit.bubble.coffee.2",
    "roomVisit.bubble.coffee.3",
  ],
  interact: [
    "roomVisit.bubble.interact.1",
    "roomVisit.bubble.interact.2",
    "roomVisit.bubble.interact.3",
  ],
  relax: [
    "roomVisit.bubble.relax.1",
    "roomVisit.bubble.relax.2",
    "roomVisit.bubble.relax.3",
  ],
  admire: [
    "roomVisit.bubble.admire.1",
    "roomVisit.bubble.admire.2",
    "roomVisit.bubble.admire.3",
  ],
  wander: [
    "roomVisit.bubble.wander.1",
    "roomVisit.bubble.wander.2",
    "roomVisit.bubble.wander.3",
  ],
  music: [
    "roomVisit.bubble.dance.1",
    "roomVisit.bubble.dance.2",
    "roomVisit.bubble.dance.3",
  ],
};

export const roomVisitBubbleKeyForBehavior = (behavior: BehaviorName) => {
  const keys = ROOM_VISIT_BUBBLE_KEYS[behavior] ?? ROOM_VISIT_BUBBLE_KEYS.interact ?? [];
  return keys[Math.floor(Math.random() * keys.length)] ?? "roomVisit.bubble.interact.1";
};

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

export const roomVisitorNavigationScopeKey = (visitId: string) =>
  `${VISITOR_NAVIGATION_SCOPE_PREFIX}:${visitId}`;

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

const sortedAvatarIds = (leftAvatarId: string, rightAvatarId: string): [string, string] =>
  leftAvatarId <= rightAvatarId
    ? [leftAvatarId, rightAvatarId]
    : [rightAvatarId, leftAvatarId];

const clampAffinity = (value: number) =>
  Math.min(SOCIAL_AFFINITY_MAX, Math.max(0, Math.round(value)));

export const clampSocialWillingness = (value: unknown, fallback = SOCIAL_WILLINGNESS_DEFAULT) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(100, Math.max(0, Math.round(numericValue)));
};

export const socialRelationshipStorageKey = (
  leftAvatarId: string,
  rightAvatarId: string,
) =>
  [
    "aivatar.socialRelationship.v1",
    ...sortedAvatarIds(leftAvatarId, rightAvatarId),
  ]
    .map((part) => part.replace(/[^a-zA-Z0-9_.-]/g, "_"))
    .join(".");

export const normalizeSocialRelationship = (
  value: Partial<AivatarSocialRelationship> | undefined,
  leftAvatarId: string,
  rightAvatarId: string,
): AivatarSocialRelationship => {
  const avatarIds = sortedAvatarIds(leftAvatarId, rightAvatarId);
  const favoriteActivities =
    value?.favoriteActivities && typeof value.favoriteActivities === "object"
      ? value.favoriteActivities
      : {};

  return {
    version: 1,
    avatarIds,
    affinity: clampAffinity(value?.affinity ?? 0),
    visits: Math.max(0, Math.round(value?.visits ?? 0)),
    lastVisitId:
      typeof value?.lastVisitId === "string" && value.lastVisitId.trim()
        ? value.lastVisitId
        : undefined,
    lastVisitAt:
      typeof value?.lastVisitAt === "string" && Number.isFinite(Date.parse(value.lastVisitAt))
        ? value.lastVisitAt
        : undefined,
    lastDialogueSummary:
      typeof value?.lastDialogueSummary === "string" && value.lastDialogueSummary.trim()
        ? value.lastDialogueSummary.slice(0, 160)
        : undefined,
    lastDialogueSource:
      value?.lastDialogueSource === "llm" || value?.lastDialogueSource === "heuristic"
        ? value.lastDialogueSource
        : undefined,
    favoriteActivities,
    unlockedActivities: Array.isArray(value?.unlockedActivities)
      ? value.unlockedActivities
          .filter((activity): activity is string => typeof activity === "string")
          .slice(0, 12)
      : [],
  };
};

const traitScale = (value: number | undefined) =>
  Math.max(0, Math.min(1, Math.log10(Math.max(0, value ?? 0) + 1) / Math.log10(1_000_001)));

const dominantTrait = (traits: AivatarRoomPresence["traits"]) =>
  (Object.entries(traits) as Array<[keyof AivatarRoomPresence["traits"], number]>)
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? "warmth";

export const socialTraitCompatibilityScore = (
  leftTraits: AivatarRoomPresence["traits"],
  rightTraits: AivatarRoomPresence["traits"],
) => {
  const leftDominant = dominantTrait(leftTraits);
  const rightDominant = dominantTrait(rightTraits);
  const complementPairs = new Set([
    "curiosity:creativity",
    "creativity:curiosity",
    "focus:efficiency",
    "efficiency:focus",
    "warmth:resilience",
    "resilience:warmth",
  ]);
  const complementKey = `${leftDominant}:${rightDominant}`;
  const dominantBonus =
    leftDominant === rightDominant ? 10 : complementPairs.has(complementKey) ? 8 : 0;
  const warmthBlend =
    (traitScale(leftTraits.warmth) + traitScale(rightTraits.warmth)) * 4;
  const curiosityBlend =
    (traitScale(leftTraits.curiosity) + traitScale(rightTraits.curiosity)) * 2;

  return Math.round(Math.min(18, dominantBonus + warmthBlend + curiosityBlend));
};

export const socialWillingnessScore = (
  presence: Pick<AivatarRoomPresence, "traits" | "petStats">,
  options: {
    base?: number;
    affinity?: number;
    lastVisitAt?: string;
    nowMs?: number;
  } = {},
) => {
  const base = clampSocialWillingness(options.base);
  const stats = presence.petStats;
  if (stats.energy < 22 || stats.hunger < 22) return 0;

  const traits = presence.traits;
  const affinity = clampAffinity(options.affinity ?? 0);
  const nowMs = options.nowMs ?? Date.now();
  const lastVisitMs = options.lastVisitAt ? Date.parse(options.lastVisitAt) : Number.NaN;
  const recentVisitPenalty =
    Number.isFinite(lastVisitMs) && nowMs - lastVisitMs < 6 * 60 * 1000 ? 18 : 0;
  const score =
    base * 0.58 +
    traitScale(traits.warmth) * 18 +
    traitScale(traits.curiosity) * 10 +
    traitScale(traits.creativity) * 8 +
    (affinity / SOCIAL_AFFINITY_MAX) * 18 +
    (stats.mood - 50) * 0.16 +
    (stats.energy - 45) * 0.1 -
    Math.max(0, 38 - stats.hunger) * 0.28 -
    recentVisitPenalty;

  return Math.max(0, Math.min(100, Math.round(score)));
};

export const shouldAttemptAutonomousVisit = (
  willingnessScore: number,
  roll = Math.random(),
) => {
  if (willingnessScore < SOCIAL_WILLINGNESS_MIN_FOR_AUTONOMY) return false;
  const chance = Math.min(0.2, Math.max(0.025, willingnessScore / 900));
  return roll < chance;
};

export const roomVisitSocialDurationSeconds = (affinity = 0) =>
  34 + Math.round(Math.min(26, Math.sqrt(clampAffinity(affinity) / SOCIAL_AFFINITY_MAX) * 26));

export const completeSocialRelationship = (
  relationship: AivatarSocialRelationship,
  visitId: string,
  leftTraits: AivatarRoomPresence["traits"],
  rightTraits: AivatarRoomPresence["traits"],
  activity?: BehaviorName,
) => {
  if (relationship.lastVisitId === visitId) return relationship;
  const favoriteActivities = { ...(relationship.favoriteActivities ?? {}) };
  if (activity) {
    favoriteActivities[activity] = (favoriteActivities[activity] ?? 0) + 1;
  }
  const compatibilityScore = socialTraitCompatibilityScore(leftTraits, rightTraits);
  const activityBonus =
    activity === "music" || activity === "play" || activity === "coffee"
      ? 3
      : activity === "interact" || activity === "relax"
        ? 2
        : 1;
  const nextAffinity = clampAffinity(
    relationship.affinity + 2 + activityBonus + Math.round(compatibilityScore / 6),
  );
  const unlockedActivities = new Set(relationship.unlockedActivities ?? []);
  if (nextAffinity >= SOCIAL_HIGH_AFFINITY_THRESHOLD) unlockedActivities.add("dance");
  if (nextAffinity >= SOCIAL_BED_CHAT_AFFINITY_THRESHOLD) unlockedActivities.add("bed-chat");

  return {
    ...relationship,
    affinity: nextAffinity,
    visits: relationship.visits + 1,
    lastVisitId: visitId,
    lastVisitAt: roomVisitNowIso(),
    favoriteActivities,
    unlockedActivities: [...unlockedActivities],
  };
};

const clampSocialRoomPoint = (point: { x: number; y: number }) => ({
  x: clamp(point.x, SOCIAL_ROOM_X_MIN, SOCIAL_ROOM_X_MAX),
  y: clamp(point.y, SOCIAL_ROOM_Y_MIN, SOCIAL_ROOM_Y_MAX),
});

const socialTargetNearHost = (hostRuntime: AvatarRuntime) => {
  const midpoint = (SOCIAL_ROOM_X_MIN + SOCIAL_ROOM_X_MAX) / 2;
  const side = hostRuntime.x <= midpoint ? 1 : -1;
  return clampSocialRoomPoint({
    x: hostRuntime.x + side * SOCIAL_PAIR_DISTANCE,
    y: hostRuntime.y + SOCIAL_PAIR_Y_OFFSET,
  });
};

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
    affinity: Math.min(
      999,
      memory.affinity +
        (activity === "play" || activity === "coffee"
          ? 3
          : activity === "interact" || activity === "relax"
            ? 2
            : 1),
    ),
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
  const guestSocialNavMemory =
    value.guestSocialNavMemory &&
    typeof value.guestSocialNavMemory === "object" &&
    !Array.isArray(value.guestSocialNavMemory)
      ? normalizeSocialRoomMemory(
          { navMemory: value.guestSocialNavMemory },
          guest.avatarId,
          host.avatarId,
          value.hostRoomId,
          value.hostLayoutFingerprint,
        ).navMemory
      : undefined;

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
    guestSocialNavMemory,
    activity: value.activity,
    bubbleText:
      typeof value.bubbleText === "string" ? value.bubbleText.slice(0, 64) : undefined,
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

const navigateVisitorRuntime = (
  visitor: AivatarRoomVisitor,
  runtime: AvatarRuntime,
  content: AivatarContent,
  elapsedSeconds: number,
  navMemory?: AivatarNavMemory,
) =>
  tickAvatar(
    runtime,
    content,
    {
      agent: "aivatar",
      sessionId: visitor.visitId,
      status: "idle",
      phase: "room-visit-navigation",
      task: `${visitor.avatarName} is visiting`,
      timestamp: roomVisitNowIso(),
    },
    elapsedSeconds,
    visitor.memory,
    {
      navMemory,
      navigationScopeKey: roomVisitorNavigationScopeKey(visitor.visitId),
      suppressAutonomousBehavior: true,
    },
  );

const weightedBehavior = (
  traits: AivatarRoomPresence["traits"],
  hasGameConsole: boolean,
  hasCoffeeSpot: boolean,
  hasRecordPlayer: boolean,
  hasBed: boolean,
  relationshipAffinity = 0,
): BehaviorName => {
  const highAffinity = relationshipAffinity >= SOCIAL_HIGH_AFFINITY_THRESHOLD;
  const choices: Array<{ behavior: BehaviorName; weight: number }> = [
    { behavior: "play", weight: hasGameConsole ? 8 + traits.efficiency / 70 : 0 },
    { behavior: "coffee", weight: hasCoffeeSpot ? 7 + traits.focus / 90 : 0 },
    {
      behavior: "music",
      weight: hasRecordPlayer && highAffinity ? 5 + relationshipAffinity / 70 : 0,
    },
    { behavior: "wander", weight: 6 + traits.curiosity / 80 },
    { behavior: "admire", weight: 4 + traits.creativity / 90 },
    {
      behavior: "relax",
      weight:
        5 +
        traits.warmth / 80 +
        (hasBed && relationshipAffinity >= SOCIAL_BED_CHAT_AFFINITY_THRESHOLD ? 6 : 0),
    },
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

type RoomVisitSocialTarget = {
  x: number;
  y: number;
  socialActivity?: "dance" | "bed-chat";
};

const randomSocialTarget = (
  content: AivatarContent,
  behavior: BehaviorName,
  hostRuntime: AvatarRuntime,
  relationshipAffinity = 0,
): RoomVisitSocialTarget => {
  if (behavior === "music") {
    const recordPlayer = content.placedItems?.find((item) => item.itemId === "record-player");
    if (recordPlayer) {
      const standpoints = getPlacedItemInteractionStandpoints(recordPlayer, content);
      const point = standpoints[standpoints.length > 1 ? 1 : 0];
      if (point) return { ...point, socialActivity: "dance" as const };
      return {
        x: recordPlayer.x + 18,
        y: recordPlayer.y + 24,
        socialActivity: "dance" as const,
      };
    }
  }

  if (behavior === "play") {
    const gameConsole = content.placedItems?.find((item) => item.itemId === "game-console");
    if (gameConsole) {
      const standpoints = getPlacedItemInteractionStandpoints(gameConsole, content);
      const point = standpoints[standpoints.length > 1 ? 1 : 0];
      if (point) return point;
      return { x: gameConsole.x + 28, y: gameConsole.y + 30 };
    }
  }

  if (behavior === "coffee") {
    const table = content.room.furniture.find((item) => item.id === "table");
    if (table) {
      const standpoints = getFurnitureInteractionStandpoints(table, content, "coffee");
      const point = standpoints[standpoints.length > 1 ? 1 : 0];
      if (point) return point;
      return { x: table.x + table.width / 2, y: table.y + table.height + 14 };
    }

    const coffeeSpot = content.placedItems?.find(
      (item) => item.itemId === "coffee-cup" || item.itemId === "coffee-machine",
    );
    if (coffeeSpot) {
      const standpoints = getPlacedItemInteractionStandpoints(coffeeSpot, content);
      const point = standpoints[standpoints.length > 1 ? 1 : 0];
      if (point) return point;
      return { x: coffeeSpot.x + 18, y: coffeeSpot.y + 24 };
    }
  }

  if (behavior === "admire" && content.placedItems?.length) {
    const item = content.placedItems[Math.floor(Math.random() * content.placedItems.length)];
    return clampSocialRoomPoint({
      x: item.x + 16 + (Math.random() - 0.5) * 42,
      y: item.y + 30 + (Math.random() - 0.5) * 32,
    });
  }

  if (
    behavior === "relax" &&
    relationshipAffinity >= SOCIAL_BED_CHAT_AFFINITY_THRESHOLD
  ) {
    const bed = content.room.furniture.find((item) => item.id === "bed");
    if (bed) {
      const standpoints = getFurnitureInteractionStandpoints(bed, content, "sleep");
      const point = standpoints[standpoints.length > 1 ? 1 : 0];
      if (point) return { ...point, socialActivity: "bed-chat" as const };
      return {
        x: bed.x + bed.width / 2,
        y: bed.y + bed.height + 10,
        socialActivity: "bed-chat" as const,
      };
    }
  }

  if (behavior === "interact" || behavior === "relax") {
    return socialTargetNearHost(hostRuntime);
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
  now: number,
  navMemory?: AivatarNavMemory,
  relationshipAffinity = 0,
) => {
  const hasGameConsole = Boolean(content.placedItems?.some((item) => item.itemId === "game-console"));
  const hasCoffeeSpot = Boolean(
    content.room.furniture.some((item) => item.id === "table") ||
      content.placedItems?.some(
        (item) => item.itemId === "coffee-cup" || item.itemId === "coffee-machine",
      ),
  );
  const hasRecordPlayer = Boolean(content.placedItems?.some((item) => item.itemId === "record-player"));
  const hasBed = content.room.furniture.some((item) => item.id === "bed");
  let runtime = visitor.runtime;
  let phase = visitor.phase ?? "entering";
  let bubbleText = visitor.bubbleText;
  let bubbleStartedAt = visitor.bubbleStartedAt;
  const setBubbleText = (nextBubbleText: string | undefined) => {
    if (nextBubbleText !== bubbleText) {
      bubbleStartedAt = nextBubbleText ? now : undefined;
    } else if (nextBubbleText && typeof bubbleStartedAt !== "number") {
      bubbleStartedAt = now;
    }
    bubbleText = nextBubbleText;
  };

  if (phase === "entering") {
    runtime = navigateVisitorRuntime(
      visitor,
      {
        ...runtime,
        targetX: ROOM_DOOR_INSIDE_POINT.x,
        targetY: ROOM_DOOR_INSIDE_POINT.y,
        behavior: "wander",
        expression: "happy",
        activityLabel: "Visiting",
        navigationFailure: undefined,
      },
      content,
      elapsedSeconds,
      navMemory,
    );
    runtime = {
      ...runtime,
      behavior: "wander",
      expression: runtime.activityLabel === "Planning route" ? "focused" : "happy",
      activityLabel:
        runtime.activityLabel === "Planning route" ? runtime.activityLabel : "Visiting",
    };
    setBubbleText("roomVisit.bubble.enter.1");
    if (distance(runtime, ROOM_DOOR_INSIDE_POINT) <= 2) {
      const socialTarget = socialTargetNearHost(hostRuntime);
      phase = "socializing";
      runtime = {
        ...runtime,
        targetX: socialTarget.x,
        targetY: socialTarget.y,
        behavior: "interact",
        behaviorTimer: 3,
        activityLabel: "Chatting",
      };
      setBubbleText(roomVisitBubbleKeyForBehavior("interact"));
    }
  } else if (phase === "leaving") {
    runtime = navigateVisitorRuntime(
      visitor,
      {
        ...runtime,
        targetX: ROOM_DOOR_OUTSIDE_POINT.x,
        targetY: ROOM_DOOR_OUTSIDE_POINT.y,
        behavior: "wander",
        expression: "happy",
        activityLabel: "Heading home",
        navigationFailure: undefined,
      },
      content,
      elapsedSeconds,
      navMemory,
    );
    runtime = {
      ...runtime,
      behavior: "wander",
      expression: runtime.activityLabel === "Planning route" ? "focused" : "happy",
      activityLabel:
        runtime.activityLabel === "Planning route" ? runtime.activityLabel : "Heading home",
    };
    setBubbleText("roomVisit.bubble.leave.1");
  } else {
    if (
      runtime.behaviorTimer <= 0 ||
      runtime.navigationFailure
    ) {
      const behavior = weightedBehavior(
        hostTraits,
        hasGameConsole,
        hasCoffeeSpot,
        hasRecordPlayer,
        hasBed,
        relationshipAffinity,
      );
      const target = randomSocialTarget(content, behavior, hostRuntime, relationshipAffinity);
      runtime = {
        ...runtime,
        targetX: target.x,
        targetY: target.y,
        behavior,
        behaviorTimer:
          behavior === "play"
            ? 12
            : behavior === "coffee"
              ? 10
              : behavior === "interact"
                ? 8
                : 9,
        expression:
          behavior === "interact" || behavior === "play" || behavior === "coffee"
            ? "happy"
            : "calm",
        navigationFailure: undefined,
        activityLabel:
          target.socialActivity === "dance"
            ? "Dancing together"
            : target.socialActivity === "bed-chat"
              ? "Bedside chat"
              : behavior === "play"
            ? "Playing together"
            : behavior === "coffee"
              ? "Coffee together"
              : behavior === "interact"
                ? "Chatting"
                : behavior === "admire"
                  ? "Looking around"
                  : behavior === "relax"
                    ? "Hanging out"
                    : "Wandering together",
      };
      setBubbleText(roomVisitBubbleKeyForBehavior(behavior));
    }

    runtime = navigateVisitorRuntime(
      visitor,
      runtime,
      content,
      elapsedSeconds,
      navMemory,
    );
  }

  return {
    ...visitor,
    runtime,
    phase,
    bubbleText,
    bubbleStartedAt,
  };
};
