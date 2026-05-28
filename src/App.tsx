import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { defaultContent } from "./data/defaultContent";
import { loadContentConfig } from "./data/loadContent";
import {
  canvasPointToScene,
  attachedPlacedItemPosition,
  findFurnitureAt,
  findPlacedItemAt,
  findWindowAt,
  getItemPlacementKind,
  isFurniturePlacementValid,
  isPlacedItemPlacementValid,
  isWindowPlacementValid,
  normalizeFurniturePlacement,
  normalizePlacedItemPoint,
} from "./game/interactions";
import { renderScene } from "./game/renderScene";
import {
  applyConsumableEffect,
  applyPetTick,
  applyPetStatEffect,
  explorationCellKey,
  explorationTargetReached,
  getFurnitureInteractionTarget,
  getFurnitureInteractionStandpoints,
  getPlacedItemInteractionStandpoints,
  initialAvatarRuntime,
  setBehavior,
  setFurnitureBehavior,
  tickAvatar,
} from "./game/simulation";
import { useCodexStatus } from "./hooks/useCodexStatus";
import {
  LOCALE_KEY,
  activityLabel,
  behaviorLabel,
  localizeContent,
  localeOptions,
  resolveInitialLocale,
  statLabel,
  statusLabel,
  t,
  type Locale,
} from "./i18n";
import type {
  AivatarContent,
  AivatarGrowthTraits,
  AivatarMemory,
  AivatarMemoryEvent,
  AivatarNavMemory,
  AivatarSaveState,
  AvatarRuntime,
  BehaviorName,
  CodexStatusMessage,
  CodexStatusName,
  FurnitureDefinition,
  FurniturePlacement,
  FurnitureInteractionKind,
  FurnitureInteractionState,
  FurnitureStorageEntry,
  IdleBubbleLanguagePreference,
  InventoryEntry,
  ItemDefinition,
  PetStats,
  PlacedItem,
  RoomWindowDefinition,
  TaskCabinetEntry,
  TaskCabinetRunProfile,
  TaskCabinetSchedule,
  TaskCabinetScheduleCondition,
  TaskCabinetScheduleMode,
  TaskCabinetStatus,
  TokenUsage,
} from "./types";

const SAVE_KEY = "aivatar.save.v1";
const DEFAULT_LAYOUT_KEY = "aivatar.defaultLayout.v1";
const TASK_CABINET_STORAGE_KEY = "aivatar.taskCabinet.v1";
const SAVE_LAYOUT_VERSION = 2;
const SLEEP_INTERACTION_SECONDS = 12;
const SLEEP_RECOVERY_PER_TICK = 4;
const SLEEP_RECOVERY_INTERVAL_SECONDS = 2;
const INTERACTION_FEEDBACK_SECONDS = 5;
const REWARD_BUBBLE_SECONDS = 10;
const PLAY_MOOD_RECOVERY_PER_TICK = 1;
const PLAY_MOOD_RECOVERY_INTERVAL_SECONDS = 2;
const PLAY_ACTIVE_TARGET_REACH = 24;
const PAINT_MOOD_RECOVERY_PER_TICK = 1;
const PAINT_RECOVERY_INTERVAL_SECONDS = 3;
const COFFEE_MACHINE_ITEM_ID = "coffee-machine";
const EASEL_ITEM_ID = "oil-easel";
const COFFEE_CUP_ITEM_ID = "coffee-cup";
const COFFEE_ITEM_ID = "coffee";
const COLA_ITEM_ID = "cola";
const BENTO_ITEM_ID = "bento";
const COFFEE_MAX_QUANTITY = 6;
const TABLE_FURNITURE_ID = "table";
const EMPTY_TABLE_COFFEE_CAPACITY = 0;
const COFFEE_BREW_SECONDS = 4;
const COFFEE_BREW_BIT_COST = 1;
const SURFACE_APPLY_COST = 1000;
const COFFEE_AUTONOMOUS_INTERVAL_SECONDS = 4;
const WORK_BOOST_SECONDS = 120;
const WORK_BOOST_COMPLETE_BONUS = 3;
const TOKEN_REWARD_TOKEN_STEP = 1000;
const TOKEN_REWARD_MAX_BITS = 40;
const TOKEN_REWARD_CACHED_INPUT_WEIGHT = 0.1;
const INTERACTION_ARRIVAL_DISTANCE = 8;
const AVATAR_FOOTPRINT_HALF_WIDTH = 6;
const AVATAR_FOOTPRINT_TOP_OFFSET = 6;
const AVATAR_FOOTPRINT_HEIGHT = 8;
const INTERACTION_POINT_TOUCH_PADDING = 1;
const BUILTIN_TERMINAL_PLACED_ITEM_ID = "builtin-terminal";
const TERMINAL_MONITOR_ITEM_ID = "terminal-monitor";
const LEGACY_TERMINAL_FURNITURE_ID = "computer";
const SESSION_STALE_MS = 60000;
const IDLE_BUBBLE_PHRASE_MAX_LENGTH = 28;
const IDLE_BUBBLE_CANDIDATE_LIMIT = 6;
const IDLE_BUBBLE_MEMORY_CANDIDATE_TARGET = 3;
const IDLE_BUBBLE_SESSION_CANDIDATE_TARGET = 3;
const IDLE_BUBBLE_LANGUAGE_OPTIONS: IdleBubbleLanguagePreference[] = [
  "auto",
  "zh",
  "en",
  "mixed",
];
const BUSY_RECOVERY_LOW_STAT = 24;
const BUSY_RECOVERY_LOW_MOOD = 18;
const BRIDGE_START_MESSAGE_SECONDS = 8;
const COMPLETE_REWARD_FRESH_MS = 10000;
const APP_HORIZONTAL_PADDING = 24;
const COLLAPSED_WINDOW_MIN_WIDTH = 504;
const DEFAULT_EXPANDED_WINDOW_WIDTH = 760;
const EXPANDED_WINDOW_MIN_WIDTH = 720;
const MEMORY_RECENT_EVENT_LIMIT = 20;
const BEHAVIOR_DEMO_SECONDS = 3;
const SIDE_PANEL_TRANSITION_MS = 80;
const TASK_CABINET_FURNITURE_ID = "file-cabinet";
const TASK_CABINET_UNLOCK_LEVEL = 25;
const TASK_CABINET_SCHEDULE_INTERVAL_MS = 5000;
const TASK_CABINET_DEFAULT_REPEAT_MINUTES = 60;
const TASK_CABINET_ENTRY_LIMIT = 100;
const NAV_MEMORY_CELL_COUNT_LIMIT = 9999;
const NAV_LEARNING_RECORD_INTERVAL_SECONDS = 2.5;
const DEMO_BEHAVIORS: BehaviorName[] = [
  "idle",
  "phone",
  "fetch_task_file",
  "carry_task_file",
  "read_task_file",
  "wander",
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
  "waiting",
  "error",
  "success",
];

type ShopCategoryId =
  | "furniture"
  | "windows"
  | "supplies"
  | "hangings";

type DecorSurfaceCategoryId = "wallpaper" | "flooring";

type LauncherAgentId = "codex" | "claude-code";

const TASK_CABINET_STATUSES: TaskCabinetStatus[] = [
  "ready",
  "running",
  "completed",
  "failed",
];
const TASK_CABINET_RUN_PROFILES: TaskCabinetRunProfile[] = ["default", "fast"];
const TASK_CABINET_SCHEDULE_MODES: TaskCabinetScheduleMode[] = [
  "once",
  "repeat",
];
const TASK_CABINET_SCHEDULE_CONDITIONS: TaskCabinetScheduleCondition[] = [
  "always",
  "only_idle",
  "after_success",
];

const DECOR_SURFACE_CATEGORIES: Array<{ id: DecorSurfaceCategoryId; copyKey: string }> = [
  { id: "wallpaper", copyKey: "decor.wallpaper" },
  { id: "flooring", copyKey: "decor.flooring" },
];

const SHOP_CATEGORIES: Array<{ id: ShopCategoryId; copyKey: string }> = [
  { id: "furniture", copyKey: "shop.furniture" },
  { id: "windows", copyKey: "shop.windows" },
  { id: "supplies", copyKey: "shop.supplies" },
  { id: "hangings", copyKey: "shop.hangings" },
];

const isWallSurfaceItem = (item: ItemDefinition) =>
  item.tags?.includes("wall-surface") ?? false;

const isFloorSurfaceItem = (item: ItemDefinition) =>
  item.tags?.includes("floor-surface") ?? false;

const isSurfaceItem = (item: ItemDefinition) =>
  isWallSurfaceItem(item) || isFloorSurfaceItem(item);

const isWindowItem = (item: ItemDefinition) => item.kind === "window";

const getShopCategoryId = (item: ItemDefinition): ShopCategoryId => {
  if (item.kind === "window") return "windows";
  if (item.kind === "food" || item.kind === "drink" || item.kind === "tool") {
    return "supplies";
  }
  if (getItemPlacementKind(item) === "wall") return "hangings";
  if (item.tags?.includes("item")) return "supplies";
  if (item.tags?.includes("furniture")) return "furniture";
  return "furniture";
};

const getShopItemUnlockLevel = (item: ItemDefinition) =>
  item.unlockLevel ??
  (item.id === TASK_CABINET_FURNITURE_ID ? TASK_CABINET_UNLOCK_LEVEL : 0);

const isTaskCabinetPlaced = (content: AivatarContent) =>
  content.room.furniture.some((item) => item.id === TASK_CABINET_FURNITURE_ID);

const isUniqueShopItemOwned = (save: AivatarSaveState, item: ItemDefinition) =>
  item.id === TASK_CABINET_FURNITURE_ID
    ? save.inventory.some((entry) => entry.itemId === item.id && entry.quantity > 0) ||
      save.placedItems.some((placedItem) => placedItem.itemId === item.id)
    : false;

const clampQuantity = (entry: InventoryEntry): InventoryEntry => ({
  ...entry,
  quantity: Math.max(0, entry.quantity),
});

const isStatusStale = (status: CodexStatusMessage, now = Date.now()) => {
  const updatedAt = Date.parse(status.timestamp);
  if (Number.isNaN(updatedAt)) return false;
  return now - updatedAt > SESSION_STALE_MS;
};

const isPresenceStale = (status: CodexStatusMessage, now = Date.now()) => {
  const updatedAt = Date.parse(status.presenceTimestamp ?? status.timestamp);
  if (Number.isNaN(updatedAt)) return false;
  return now - updatedAt > SESSION_STALE_MS;
};

const isHighPriorityStatus = (status: CodexStatusMessage, now = Date.now()) =>
  !isPresenceStale(status, now) &&
  (status.status === "thinking" ||
    status.status === "executing" ||
    status.status === "waiting_for_user" ||
    status.status === "error");

const isRewardEligiblePreviousStatus = (status: CodexStatusMessage["status"]) =>
  status === "thinking" ||
  status === "executing" ||
  status === "waiting_for_user" ||
  status === "error";

const statusSessionKey = (
  status: Pick<CodexStatusMessage, "agent" | "sessionId">,
) => `${status.agent ?? "agent"}:${status.sessionId ?? "default"}`;

const explicitStatusSessionKey = (
  status: Pick<CodexStatusMessage, "agent" | "sessionId">,
) =>
  status.agent && status.sessionId ? `${status.agent}:${status.sessionId}` : null;

const weightedTokensForUsage = (usage?: TokenUsage) => {
  if (!usage?.totalTokens || usage.totalTokens <= 0) return 0;
  const inputTokens = usage.inputTokens ?? 0;
  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, inputTokens);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return (
    uncachedInputTokens +
    cachedInputTokens * TOKEN_REWARD_CACHED_INPUT_WEIGHT +
    (usage.outputTokens ?? 0) +
    (usage.reasoningOutputTokens ?? 0)
  );
};

const rewardBitsForUsage = (usage?: TokenUsage) => {
  if (!usage?.totalTokens || usage.totalTokens <= 0) return 4;
  const weightedTokens = weightedTokensForUsage(usage);

  return Math.min(
    TOKEN_REWARD_MAX_BITS,
    4 + Math.floor(weightedTokens / TOKEN_REWARD_TOKEN_STEP),
  );
};

const formatTokenCount = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  return Math.round(value).toLocaleString("en-US");
};

const rewardSummaryForUsage = (usage?: TokenUsage) => {
  if (!usage?.totalTokens || usage.totalTokens <= 0) return null;
  if (usage.scope === "context-window") return null;
  const weightedTokens = weightedTokensForUsage(usage);
  const bits = rewardBitsForUsage(usage);
  const capped = bits >= TOKEN_REWARD_MAX_BITS ? " cap" : "";
  return `${formatTokenCount(usage.totalTokens)} tokens -> ${bits} bits${capped} (${formatTokenCount(weightedTokens)} weighted)`;
};

const contextWindowMeterForUsage = (usage?: TokenUsage) => {
  const contextTokens = usage?.contextTokens ?? 0;
  const modelContextWindow = usage?.modelContextWindow ?? 0;
  if (contextTokens <= 0 || modelContextWindow <= 0) return null;

  const rawPercent = (contextTokens / modelContextWindow) * 100;
  const percent = Math.max(0, Math.min(100, rawPercent));
  const level = rawPercent >= 85 ? "high" : rawPercent >= 65 ? "warm" : "calm";

  return {
    percent,
    level,
    label: `${formatTokenCount(contextTokens)} / ${formatTokenCount(modelContextWindow)} context`,
    percentLabel: `${Math.round(rawPercent)}%`,
  };
};

const defaultGrowthTraits = (): AivatarGrowthTraits => ({
  focus: 0,
  resilience: 0,
  curiosity: 0,
  efficiency: 0,
  creativity: 0,
  warmth: 0,
});

const defaultMemory = (): AivatarMemory => ({
  recentEvents: [],
  growth: {
    level: 1,
    xp: 0,
    totalXp: 0,
    completedTurns: 0,
    errorCount: 0,
    errorRecoveries: 0,
    waitingTurns: 0,
    weightedTokensLearned: 0,
    traits: defaultGrowthTraits(),
  },
  preferences: {
    idleBubbleLanguage: "auto",
    activityWeights: {},
    itemAffinities: {},
  },
  milestones: [],
});

const normalizeIdleBubblePhrase = (value: string) =>
  Array.from(value.trim().replace(/\s+/g, " "))
    .slice(0, IDLE_BUBBLE_PHRASE_MAX_LENGTH)
    .join("");

const normalizeIdleBubbleLanguage = (
  value?: AivatarMemory["preferences"]["idleBubbleLanguage"],
): IdleBubbleLanguagePreference =>
  value && IDLE_BUBBLE_LANGUAGE_OPTIONS.includes(value) ? value : "auto";

const hasHanText = (value: string) => /[\u3400-\u9fff]/u.test(value);

const shouldShowIdleBubbleCandidate = (
  phrase: string,
  preference: IdleBubbleLanguagePreference,
  locale: Locale,
) => {
  const resolvedPreference =
    preference === "auto" ? (locale.startsWith("zh") ? "zh" : "en") : preference;
  if (resolvedPreference === "mixed") return true;
  return resolvedPreference === "zh" ? hasHanText(phrase) : !hasHanText(phrase);
};

const uniqueIdleBubbleCandidates = (phrases: string[]) =>
  Array.from(new Set(phrases.map(normalizeIdleBubblePhrase).filter(Boolean)));

const memoryIdleBubbleCandidates = (memory: AivatarMemory): string[] => {
  const candidates: string[] = [];
  const add = (...phrases: string[]) => {
    phrases.forEach((phrase) => {
      const normalized = normalizeIdleBubblePhrase(phrase);
      if (normalized && !candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    });
  };

  const traitEntries = Object.entries(memory.growth.traits) as Array<
    [keyof AivatarGrowthTraits, number]
  >;
  const [dominantTrait] = traitEntries.sort((left, right) => right[1] - left[1])[0];

  if (dominantTrait === "focus") {
    add("先把线捋直", "稳稳来", "一点点推进", "Steady little steps");
  } else if (dominantTrait === "resilience") {
    add("摔一下也没事", "还能补回来", "我恢复得很快", "We bounce back");
  } else if (dominantTrait === "curiosity") {
    add("这里有新东西", "让我探个头", "想看看里面", "Tiny curiosity ping");
  } else if (dominantTrait === "efficiency") {
    add("路线短一点", "省点力气", "快快收好", "Clean and quick");
  }

  if (memory.preferences.favoriteRecovery === "coffee") {
    add("咖啡还热着", "Coffee is still warm");
  } else if (memory.preferences.favoriteRecovery === "cola") {
    add("气泡还在跳", "Fizz keeps dancing");
  } else if (memory.preferences.favoriteRecovery === "bento") {
    add("便当补一口", "Snack power ready");
  } else if (memory.preferences.favoriteRecovery === "sleep") {
    add("刚睡醒软软的", "Soft after sleep");
  } else if (memory.preferences.favoriteRecovery === "play") {
    add("手柄还在发光", "Game glow lingers");
  }

  for (const event of memory.recentEvents.slice(0, 6)) {
    if (event.type === "task_complete") {
      add("完成味道不错", "Another tidy win");
    } else if (event.type === "task_error") {
      add("先稳住现场", "We can patch this");
    } else if (event.type === "error_recovered") {
      add("补回来了", "Recovered cleanly");
    } else if (event.type === "waited_for_user") {
      add("我有乖乖等", "Waiting nicely");
    } else if (event.type === "item_bought") {
      add("新东西到家", "New room treasure");
    } else if (event.behavior === "coffee" || event.itemId === COFFEE_ITEM_ID) {
      add("咖啡还热着", "Tiny coffee mood");
    } else if (event.behavior === "cola" || event.itemId === COLA_ITEM_ID) {
      add("气泡还在跳", "Fizz break");
    } else if (event.behavior === "bento" || event.itemId === BENTO_ITEM_ID) {
      add("便当补一口", "Snack power ready");
    } else if (event.behavior === "sleep") {
      add("刚睡醒软软的", "Rest counts too");
    } else if (event.behavior === "play") {
      add("手柄还在发光", "Game glow lingers");
    } else if (event.behavior === "admire") {
      add("房间变好看了", "Room feels brighter");
    }
  }

  return candidates.slice(0, IDLE_BUBBLE_CANDIDATE_LIMIT);
};

const MAX_TRAIT_POINTS = 1_000_000;
const TRAIT_CHART_MIDPOINT = 80;
const TRAIT_CHART_CURVE = 24;

const clampTrait = (value: number) =>
  Math.max(0, Math.min(MAX_TRAIT_POINTS, Math.round(value)));

const sigmoidTraitValue = (value: number) =>
  1 / (1 + Math.exp(-(Math.max(0, value) - TRAIT_CHART_MIDPOINT) / TRAIT_CHART_CURVE));

const normalizedTraitChartValue = (value: number) => {
  const min = sigmoidTraitValue(0);
  return Math.max(0, Math.min(1, (sigmoidTraitValue(value) - min) / (1 - min)));
};

const applyTraitChanges = (
  traits: AivatarGrowthTraits,
  changes: Partial<AivatarGrowthTraits> = {},
): AivatarGrowthTraits => ({
  focus: clampTrait(traits.focus + (changes.focus ?? 0)),
  resilience: clampTrait(traits.resilience + (changes.resilience ?? 0)),
  curiosity: clampTrait(traits.curiosity + (changes.curiosity ?? 0)),
  efficiency: clampTrait(traits.efficiency + (changes.efficiency ?? 0)),
  creativity: clampTrait(traits.creativity + (changes.creativity ?? 0)),
  warmth: clampTrait(traits.warmth + (changes.warmth ?? 0)),
});

const normalizeMemory = (memory?: Partial<AivatarMemory>): AivatarMemory => {
  const fallback = defaultMemory();
  const growth = memory?.growth;
  const traits = growth?.traits;

  return {
    recentEvents: Array.isArray(memory?.recentEvents)
      ? memory.recentEvents.slice(0, MEMORY_RECENT_EVENT_LIMIT)
      : fallback.recentEvents,
    growth: {
      ...fallback.growth,
      ...growth,
      traits: {
        ...fallback.growth.traits,
        ...traits,
      },
    },
    preferences: {
      ...fallback.preferences,
      ...memory?.preferences,
      idleBubbleLanguage: normalizeIdleBubbleLanguage(
        memory?.preferences?.idleBubbleLanguage,
      ),
      idleBubblePhrases: Array.isArray(memory?.preferences?.idleBubblePhrases)
        ? memory.preferences.idleBubblePhrases
            .map(normalizeIdleBubblePhrase)
            .filter(Boolean)
            .slice(0, Math.max(1, growth?.level ?? fallback.growth.level))
        : fallback.preferences.idleBubblePhrases,
      activityWeights: {
        ...fallback.preferences.activityWeights,
        ...memory?.preferences?.activityWeights,
      },
      itemAffinities: {
        ...fallback.preferences.itemAffinities,
        ...memory?.preferences?.itemAffinities,
      },
    },
    milestones: Array.isArray(memory?.milestones)
      ? memory.milestones
      : fallback.milestones,
  };
};

const defaultNavMemory = (): AivatarNavMemory => ({
  exploredCells: {},
  trickySpots: {},
  successes: 0,
  failures: 0,
});

const normalizeCountMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .map(([key, count]) => [
        key,
        Math.min(NAV_MEMORY_CELL_COUNT_LIMIT, Math.max(0, Math.round(count))),
      ]),
  );
};

const normalizeNavMemory = (
  navMemory?: Partial<AivatarNavMemory>,
): AivatarNavMemory => {
  const fallback = defaultNavMemory();
  return {
    exploredCells: normalizeCountMap(navMemory?.exploredCells),
    trickySpots: normalizeCountMap(navMemory?.trickySpots),
    successes: Math.max(0, Math.round(navMemory?.successes ?? fallback.successes)),
    failures: Math.max(0, Math.round(navMemory?.failures ?? fallback.failures)),
    lastExploredAt:
      typeof navMemory?.lastExploredAt === "string"
        ? navMemory.lastExploredAt
        : fallback.lastExploredAt,
  };
};

const recordExploredCell = (
  navMemory: AivatarNavMemory | undefined,
  cellKey: string,
): AivatarNavMemory => {
  const normalized = normalizeNavMemory(navMemory);
  return {
    ...normalized,
    exploredCells: {
      ...normalized.exploredCells,
      [cellKey]: Math.min(
        NAV_MEMORY_CELL_COUNT_LIMIT,
        (normalized.exploredCells[cellKey] ?? 0) + 1,
      ),
    },
    lastExploredAt: new Date().toISOString(),
  };
};

const recordExploreResult = (
  navMemory: AivatarNavMemory | undefined,
  result: "success" | "failure",
  cellKey: string,
): AivatarNavMemory => {
  const normalized = recordExploredCell(navMemory, cellKey);
  return {
    ...normalized,
    successes: normalized.successes + (result === "success" ? 1 : 0),
    failures: normalized.failures + (result === "failure" ? 1 : 0),
    trickySpots:
      result === "failure"
        ? {
            ...normalized.trickySpots,
            [cellKey]: Math.min(
              NAV_MEMORY_CELL_COUNT_LIMIT,
              (normalized.trickySpots[cellKey] ?? 0) + 1,
            ),
          }
        : normalized.trickySpots,
  };
};

const xpNeededForLevel = (level: number) => 40 + Math.max(1, level) * 20;

const applyGrowthXp = (
  memory: AivatarMemory,
  xp: number,
): { memory: AivatarMemory; leveledUp: boolean } => {
  let nextLevel = memory.growth.level;
  let nextXp = memory.growth.xp + xp;
  let leveledUp = false;

  while (nextXp >= xpNeededForLevel(nextLevel)) {
    nextXp -= xpNeededForLevel(nextLevel);
    nextLevel += 1;
    leveledUp = true;
  }

  return {
    memory: {
      ...memory,
      growth: {
        ...memory.growth,
        level: nextLevel,
        xp: nextXp,
        totalXp: memory.growth.totalXp + xp,
      },
    },
    leveledUp,
  };
};

const appendMemoryEvent = (
  memory: AivatarMemory | undefined,
  event: AivatarMemoryEvent,
) => {
  const normalized = normalizeMemory(memory);
  const recentEvents = [
    event,
    ...normalized.recentEvents.filter((item) => item.id !== event.id),
  ].slice(0, MEMORY_RECENT_EVENT_LIMIT);

  return {
    ...normalized,
    recentEvents,
  };
};

const recordTaskCompleteMemory = (
  memory: AivatarMemory | undefined,
  status: CodexStatusMessage,
  previousStatus: CodexStatusMessage["status"] | undefined,
  rewardBits: number,
) => {
  const normalized = normalizeMemory(memory);
  const weightedTokens = weightedTokensForUsage(status.usage);
  const recoveredFromError = previousStatus === "error";
  const completedAfterWait = previousStatus === "waiting_for_user";
  const xp =
    8 +
    Math.min(20, Math.floor(weightedTokens / 2000)) +
    (recoveredFromError ? 8 : 0) +
    (completedAfterWait ? 2 : 0);
  const traitChanges: Partial<AivatarGrowthTraits> = {
    focus: weightedTokens >= 4000 ? 2 : 1,
    efficiency: rewardBits >= 8 ? 2 : 1,
    ...(recoveredFromError ? { resilience: 3 } : {}),
  };
  const { memory: withXp, leveledUp } = applyGrowthXp(normalized, xp);
  const traits = withXp.growth.traits;
  const completedMemory: AivatarMemory = {
    ...withXp,
    growth: {
      ...withXp.growth,
      completedTurns: withXp.growth.completedTurns + 1,
      errorRecoveries: withXp.growth.errorRecoveries + (recoveredFromError ? 1 : 0),
      weightedTokensLearned:
        withXp.growth.weightedTokensLearned + Math.round(weightedTokens),
      traits: applyTraitChanges(traits, traitChanges),
    },
  };
  const completeEvent = {
    id: `complete:${status.agent ?? "agent"}:${status.sessionId ?? "default"}:${status.timestamp}`,
    type: recoveredFromError ? "error_recovered" : "task_complete",
    timestamp: status.timestamp,
    summary: recoveredFromError
      ? "Recovered from a failed Codex turn"
      : `Completed a ${formatTokenCount(weightedTokens)} weighted-token turn`,
    agent: status.agent,
    sessionId: status.sessionId,
    status: status.status,
    xp,
    bits: rewardBits,
    weightedTokens: Math.round(weightedTokens),
    traitChanges,
  } satisfies AivatarMemoryEvent;
  const nextMemory = appendMemoryEvent(completedMemory, completeEvent);

  if (!leveledUp) return nextMemory;

  return appendMemoryEvent(nextMemory, {
    id: `level:${status.agent ?? "agent"}:${status.sessionId ?? "default"}:${status.timestamp}:${completedMemory.growth.level}`,
    type: "level_up",
    timestamp: status.timestamp,
    summary: `Reached level ${completedMemory.growth.level}`,
    agent: status.agent,
    sessionId: status.sessionId,
  });
};

const recordStatusMemory = (
  memory: AivatarMemory | undefined,
  status: CodexStatusMessage,
) => {
  const normalized = normalizeMemory(memory);
  if (status.status !== "error" && status.status !== "waiting_for_user") {
    return normalized;
  }

  const eventId = `${status.status}:${status.agent ?? "agent"}:${status.sessionId ?? "default"}:${status.timestamp}`;
  if (normalized.recentEvents.some((event) => event.id === eventId)) {
    return normalized;
  }

  const traits = normalized.growth.traits;
  const eventType =
    status.status === "error" ? "task_error" : "waited_for_user";
  const nextMemory: AivatarMemory = {
    ...normalized,
    growth: {
      ...normalized.growth,
      errorCount:
        normalized.growth.errorCount + (status.status === "error" ? 1 : 0),
      waitingTurns:
        normalized.growth.waitingTurns +
        (status.status === "waiting_for_user" ? 1 : 0),
      traits: {
        ...traits,
        resilience: clampTrait(
          traits.resilience + (status.status === "error" ? 1 : 0),
        ),
        focus: clampTrait(
          traits.focus + (status.status === "waiting_for_user" ? 1 : 0),
        ),
      },
    },
  };

  return appendMemoryEvent(nextMemory, {
    id: eventId,
    type: eventType,
    timestamp: status.timestamp,
    summary:
      status.status === "error"
        ? "Hit an error during a Codex turn"
        : "Waited for user input during a Codex turn",
    agent: status.agent,
    sessionId: status.sessionId,
    status: status.status,
    traitChanges:
      status.status === "error" ? { resilience: 1 } : { focus: 1 },
  });
};

const memoryEventRecentlyRecorded = (
  memory: AivatarMemory,
  type: AivatarMemoryEvent["type"],
  key: string,
  withinMs: number,
  now = Date.now(),
) =>
  memory.recentEvents.some((event) => {
    if (event.type !== type) return false;
    const eventKey = event.itemId ?? event.behavior ?? event.summary;
    if (eventKey !== key) return false;
    const recordedAt = Date.parse(event.timestamp);
    return !Number.isNaN(recordedAt) && now - recordedAt <= withinMs;
  });

const recordLifeMemory = (
  memory: AivatarMemory | undefined,
  event: Omit<AivatarMemoryEvent, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
  },
  traitChanges: Partial<AivatarGrowthTraits> = {},
  options: { throttleMs?: number; throttleKey?: string } = {},
) => {
  const normalized = normalizeMemory(memory);
  const timestamp = event.timestamp ?? new Date().toISOString();
  const throttleKey = options.throttleKey ?? event.itemId ?? event.behavior ?? event.summary;

  if (
    options.throttleMs &&
    memoryEventRecentlyRecorded(
      normalized,
      event.type,
      throttleKey,
      options.throttleMs,
      Date.parse(timestamp),
    )
  ) {
    return normalized;
  }

  const traits = normalized.growth.traits;
  const nextMemory: AivatarMemory = {
    ...normalized,
    growth: {
      ...normalized.growth,
      traits: applyTraitChanges(traits, traitChanges),
    },
    preferences: {
      ...normalized.preferences,
      favoriteActivity: event.behavior ?? normalized.preferences.favoriteActivity,
      favoriteRecovery:
        event.behavior === "coffee" ||
        event.behavior === "cola" ||
        event.behavior === "bento" ||
        event.behavior === "sleep" ||
        event.behavior === "play" ||
        event.behavior === "paint"
          ? event.behavior
          : normalized.preferences.favoriteRecovery,
      activityWeights: event.behavior
        ? {
            ...normalized.preferences.activityWeights,
            [event.behavior]:
              (normalized.preferences.activityWeights[event.behavior] ?? 0) + 1,
          }
        : normalized.preferences.activityWeights,
      itemAffinities: event.itemId
        ? {
            ...normalized.preferences.itemAffinities,
            [event.itemId]:
              (normalized.preferences.itemAffinities[event.itemId] ?? 0) + 1,
          }
        : normalized.preferences.itemAffinities,
    },
  };

  return appendMemoryEvent(nextMemory, {
    ...event,
    id: event.id ?? `${event.type}:${throttleKey}:${timestamp}`,
    timestamp,
    traitChanges,
  });
};

const recordTraitTrainingMemory = (
  memory: AivatarMemory | undefined,
  trait: keyof AivatarGrowthTraits,
) => {
  const normalized = normalizeMemory(memory);
  const { memory: withXp, leveledUp } = applyGrowthXp(normalized, 4);
  const traits = withXp.growth.traits;
  const trainedMemory: AivatarMemory = {
    ...withXp,
    growth: {
      ...withXp.growth,
      traits: {
        ...traits,
        [trait]: clampTrait(traits[trait] + 8),
      },
    },
  };
  const timestamp = new Date().toISOString();
  const label = trait.charAt(0).toUpperCase() + trait.slice(1);
  const nextMemory = appendMemoryEvent(trainedMemory, {
    id: `training:${trait}:${timestamp}`,
    type: "level_up",
    timestamp,
    summary: `Trained ${label}`,
    xp: 4,
    traitChanges: { [trait]: 8 },
  });

  if (!leveledUp) return nextMemory;

  return appendMemoryEvent(nextMemory, {
    id: `training-level:${trait}:${timestamp}:${trainedMemory.growth.level}`,
    type: "level_up",
    timestamp,
    summary: `Reached level ${trainedMemory.growth.level}`,
  });
};

const traitChangesForConsumable = (
  item: Pick<ItemDefinition, "id">,
): Partial<AivatarGrowthTraits> => {
  if (item.id === COFFEE_ITEM_ID) return { focus: 1, warmth: 1 };
  if (item.id === COLA_ITEM_ID) return { efficiency: 1, warmth: 1 };
  if (item.id === BENTO_ITEM_ID) return { resilience: 1, warmth: 1 };
  return { resilience: 1, warmth: 1 };
};

const behaviorForConsumable = (item: Pick<ItemDefinition, "id">): BehaviorName =>
  item.id === COFFEE_ITEM_ID
    ? "coffee"
    : item.id === COLA_ITEM_ID
      ? "cola"
      : item.id === BENTO_ITEM_ID
        ? "bento"
        : "interact";

const traitChangesForPurchase = (
  item: Pick<ItemDefinition, "kind" | "tags">,
): Partial<AivatarGrowthTraits> =>
  item.kind === "food" || item.kind === "drink" || item.kind === "tool"
    ? { efficiency: 1 }
    : { curiosity: 1, creativity: 1 };

const agentDisplayName = (status: Pick<CodexStatusMessage, "agent">) =>
  status.agent?.trim() || "agent";

type BusyRecoveryNeed =
  | { behavior: "snack"; targetFurnitureId: string }
  | { behavior: "play"; placedItemId: string }
  | null;

const hasInventoryKind = (
  content: AivatarContent,
  kind: ItemDefinition["kind"],
) =>
  content.inventory.some((entry) => {
    if (entry.quantity <= 0) return false;
    const item = content.itemDefinitions.find(
      (candidate) => candidate.id === entry.itemId,
    );
    return item?.kind === kind;
  });

const hasPlacedItem = (content: AivatarContent, itemId: string) =>
  content.placedItems?.some((item) => item.itemId === itemId) ?? false;

const chooseNearestOrRandomPlacedItem = (
  avatar: Pick<AvatarRuntime, "x" | "y">,
  candidates: PlacedItem[],
) => {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  if (Math.random() >= 0.7) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  return [...candidates].sort(
    (left, right) =>
      Math.hypot(left.x - avatar.x, left.y - avatar.y) -
      Math.hypot(right.x - avatar.x, right.y - avatar.y),
  )[0];
};

const isTableCoffeeCup = (item: Pick<PlacedItem, "itemId" | "surfaceFurnitureId">) =>
  item.itemId === COFFEE_CUP_ITEM_ID && item.surfaceFurnitureId === TABLE_FURNITURE_ID;

const getTableCoffeeCapacity = (placedItems: PlacedItem[] | undefined) =>
  (placedItems ?? []).filter(isTableCoffeeCup).length;

const getTableCoffeeQuantity = (
  storage: FurnitureStorageEntry[] | undefined,
  placedItems: PlacedItem[] | undefined,
) =>
  Math.min(
    getFurnitureStorageQuantity(storage, TABLE_FURNITURE_ID, COFFEE_ITEM_ID),
    getTableCoffeeCapacity(placedItems),
  );

const getBusyRecoveryNeed = (
  status: CodexStatusMessage,
  content: AivatarContent,
  furnitureStorage: FurnitureStorageEntry[] | undefined,
  memory: AivatarMemory | undefined,
): BusyRecoveryNeed => {
  if (!isHighPriorityStatus(status)) return null;
  if (status.status === "thinking") return null;

  const focus = memory?.growth.traits.focus ?? 0;
  const resilience = memory?.growth.traits.resilience ?? 0;
  const lowStatThreshold = Math.max(
    16,
    BUSY_RECOVERY_LOW_STAT - Math.floor(focus / 12),
  );
  const lowMoodThreshold = Math.max(
    12,
    BUSY_RECOVERY_LOW_MOOD - Math.floor(resilience / 14),
  );
  const hasTableCoffee =
    getTableCoffeeQuantity(furnitureStorage, content.placedItems) > 0;
  const hasCoffee = getInventoryQuantity(content.inventory, COFFEE_ITEM_ID) > 0;
  const hasDrink = hasInventoryKind(content, "drink");
  const hasFood = hasInventoryKind(content, "food");
  const hasGameConsole = hasPlacedItem(content, "game-console");

  if (
    content.petStats.energy < lowStatThreshold &&
    (hasTableCoffee || hasCoffee || hasDrink)
  ) {
    return { behavior: "snack", targetFurnitureId: TABLE_FURNITURE_ID };
  }

  if (content.petStats.hunger < lowStatThreshold && hasFood) {
    return { behavior: "snack", targetFurnitureId: "fridge" };
  }

  if (
    content.petStats.mood < lowMoodThreshold &&
    hasGameConsole &&
    status.status !== "error"
  ) {
    return { behavior: "play", placedItemId: "game-console" };
  }

  return null;
};

const resolveFurnitureInteractionKind = (
  furniture: FurnitureDefinition,
): FurnitureInteractionKind => {
  if (furniture.id === "bed" || furniture.interaction === "sleep") return "sleep";
  if (furniture.id === "fridge" || furniture.id === "table") return "feed";
  if (furniture.id === "computer") return "work";
  return "none";
};

const workBehaviorForFurniture = (furniture: FurnitureDefinition): BehaviorName =>
  furniture.id === "computer" || furniture.interaction === "thinking"
    ? "thinking"
    : "coding";

const behaviorForFurnitureInteraction = (
  furniture: FurnitureDefinition,
  kind: FurnitureInteractionKind,
): BehaviorName => {
  if (kind === "sleep") return "sleep";
  if (kind === "feed") return "interact";
  if (kind === "work") return workBehaviorForFurniture(furniture);
  return furniture.interaction;
};

const isBlockingInteraction = (
  interaction: FurnitureInteractionState | null,
) => {
  if (!interaction) return false;
  if (
    interaction.kind !== "sleep" &&
    interaction.kind !== "feed" &&
    interaction.kind !== "work" &&
    interaction.kind !== "brew"
  ) {
    return false;
  }

  const now = performance.now();
  if (interaction.endsAt) return now < interaction.endsAt;
  return now - interaction.startedAt < INTERACTION_FEEDBACK_SECONDS * 1000;
};

const getInventoryQuantity = (inventory: InventoryEntry[], itemId: string) =>
  inventory.find((entry) => entry.itemId === itemId)?.quantity ?? 0;

const defaultFurnitureStorage = (): FurnitureStorageEntry[] => [
  {
    furnitureId: TABLE_FURNITURE_ID,
    itemId: COFFEE_ITEM_ID,
    quantity: 0,
    capacity: EMPTY_TABLE_COFFEE_CAPACITY,
  },
];

const normalizeFurnitureStorage = (
  storage: FurnitureStorageEntry[] | undefined,
): FurnitureStorageEntry[] => {
  const existing = Array.isArray(storage) ? storage : [];
  const hasTableCoffee = existing.some(
    (entry) =>
      entry.furnitureId === TABLE_FURNITURE_ID && entry.itemId === COFFEE_ITEM_ID,
  );

  return hasTableCoffee ? existing : [...existing, ...defaultFurnitureStorage()];
};

const getFurnitureStorageEntry = (
  storage: FurnitureStorageEntry[] | undefined,
  furnitureId: string,
  itemId: string,
) =>
  normalizeFurnitureStorage(storage).find(
    (entry) => entry.furnitureId === furnitureId && entry.itemId === itemId,
  );

const getFurnitureStorageQuantity = (
  storage: FurnitureStorageEntry[] | undefined,
  furnitureId: string,
  itemId: string,
) => getFurnitureStorageEntry(storage, furnitureId, itemId)?.quantity ?? 0;

const addFurnitureStorageItem = (
  storage: FurnitureStorageEntry[] | undefined,
  furnitureId: string,
  itemId: string,
  quantity = 1,
  capacity = EMPTY_TABLE_COFFEE_CAPACITY,
) =>
  normalizeFurnitureStorage(storage).map((entry) =>
    entry.furnitureId === furnitureId && entry.itemId === itemId
      ? {
          ...entry,
          capacity,
          quantity: Math.min(capacity, entry.quantity + quantity),
        }
      : entry,
  );

const clampTableCoffeeStorage = (
  storage: FurnitureStorageEntry[] | undefined,
  placedItems: PlacedItem[] | undefined,
) => {
  const capacity = getTableCoffeeCapacity(placedItems);
  return normalizeFurnitureStorage(storage).map((entry) =>
    entry.furnitureId === TABLE_FURNITURE_ID && entry.itemId === COFFEE_ITEM_ID
      ? {
          ...entry,
          capacity,
          quantity: Math.min(capacity, entry.quantity),
        }
      : entry,
  );
};

const consumeFurnitureStorageItem = (
  storage: FurnitureStorageEntry[] | undefined,
  furnitureId: string,
  itemId: string,
  quantity = 1,
) =>
  normalizeFurnitureStorage(storage).map((entry) =>
    entry.furnitureId === furnitureId && entry.itemId === itemId
      ? {
          ...entry,
          quantity: Math.max(0, entry.quantity - quantity),
        }
      : entry,
  );

const getPlacedItemInteractionTarget = (
  item: PlacedItem,
  content: AivatarContent,
): Pick<AvatarRuntime, "targetX" | "targetY"> => {
  const standpoints = getPlacedItemInteractionStandpoints(item, content);
  if (standpoints.length > 0) {
    return { targetX: standpoints[0].x, targetY: standpoints[0].y };
  }

  if (item.surfaceFurnitureId) {
    const surface = content.room.furniture.find(
      (furniture) => furniture.id === item.surfaceFurnitureId,
    );
    if (surface) {
      return {
        targetX: Math.min(
          surface.x + surface.width - 12,
          Math.max(surface.x + 12, item.x),
        ),
        targetY: surface.y + surface.height + 18,
      };
    }
  }

  return {
    targetX: item.x + 18,
    targetY: item.y + 14,
  };
};

const avatarFootprintTouchesPoint = (
  avatar: AvatarRuntime,
  point: { x: number; y: number },
) =>
  point.x >= avatar.x - AVATAR_FOOTPRINT_HALF_WIDTH - INTERACTION_POINT_TOUCH_PADDING &&
  point.x <= avatar.x + AVATAR_FOOTPRINT_HALF_WIDTH + INTERACTION_POINT_TOUCH_PADDING &&
  point.y >= avatar.y + AVATAR_FOOTPRINT_TOP_OFFSET - INTERACTION_POINT_TOUCH_PADDING &&
  point.y <=
    avatar.y +
      AVATAR_FOOTPRINT_TOP_OFFSET +
      AVATAR_FOOTPRINT_HEIGHT +
      INTERACTION_POINT_TOUCH_PADDING;

const isNearPlacedItemInteractionTarget = (
  avatar: AvatarRuntime,
  item: PlacedItem,
  content: AivatarContent,
) => {
  const standpoints = getPlacedItemInteractionStandpoints(item, content);
  const reach = item.itemId === COFFEE_MACHINE_ITEM_ID ? 18 : INTERACTION_ARRIVAL_DISTANCE;
  if (standpoints.length > 0) {
    return standpoints.some(
      (point) =>
        avatarFootprintTouchesPoint(avatar, point) ||
        Math.hypot(avatar.x - point.x, avatar.y - point.y) <= reach,
    );
  }

  const { targetX, targetY } = getPlacedItemInteractionTarget(item, content);
  return (
    avatarFootprintTouchesPoint(avatar, { x: targetX, y: targetY }) ||
    Math.hypot(avatar.x - targetX, avatar.y - targetY) <= reach
  );
};

const isNearActivePlayTarget = (
  avatar: AvatarRuntime,
  item: PlacedItem,
  content: AivatarContent,
) => {
  if (isNearPlacedItemInteractionTarget(avatar, item, content)) return true;

  const avatarNearCurrentTarget =
    Math.hypot(avatar.x - avatar.targetX, avatar.y - avatar.targetY) <=
    PLAY_ACTIVE_TARGET_REACH;
  if (!avatarNearCurrentTarget) return false;

  const standpoints = getPlacedItemInteractionStandpoints(item, content);
  if (standpoints.length > 0) {
    return standpoints.some(
      (point) =>
        Math.hypot(avatar.targetX - point.x, avatar.targetY - point.y) <=
        PLAY_ACTIVE_TARGET_REACH,
    );
  }

  const { targetX, targetY } = getPlacedItemInteractionTarget(item, content);
  return (
    Math.hypot(avatar.targetX - targetX, avatar.targetY - targetY) <=
    PLAY_ACTIVE_TARGET_REACH
  );
};

const isNearFurnitureInteractionTarget = (
  avatar: AvatarRuntime,
  furniture: FurnitureDefinition,
  content: AivatarContent,
) => {
  if (furniture.id === TABLE_FURNITURE_ID) {
    const reach = 24;
    const left = furniture.x - 8;
    const right = furniture.x + furniture.width + 8;
    const top = furniture.y - 10;
    const bottom = furniture.y + 58;
    const withinVerticalBand = avatar.y >= top - reach && avatar.y <= bottom + reach;
    const withinHorizontalBand = avatar.x >= left - reach && avatar.x <= right + reach;
    const nearLeft = Math.abs(avatar.x - left) <= reach && withinVerticalBand;
    const nearRight = Math.abs(avatar.x - right) <= reach && withinVerticalBand;
    const nearTop = Math.abs(avatar.y - top) <= reach && withinHorizontalBand;
    const nearBottom = Math.abs(avatar.y - bottom) <= reach && withinHorizontalBand;

    return nearLeft || nearRight || nearTop || nearBottom;
  }

  const standpoints = getFurnitureInteractionStandpoints(
    furniture,
    content,
  );
  if (standpoints.length > 0) {
    return standpoints.some(
      (point) =>
        avatarFootprintTouchesPoint(avatar, point) ||
        Math.hypot(avatar.x - point.x, avatar.y - point.y) <=
        INTERACTION_ARRIVAL_DISTANCE,
    );
  }

  const { targetX, targetY } = getFurnitureInteractionTarget(furniture);
  return (
    avatarFootprintTouchesPoint(avatar, { x: targetX, y: targetY }) ||
    Math.hypot(avatar.x - targetX, avatar.y - targetY) <= INTERACTION_ARRIVAL_DISTANCE
  );
};

const ignoredFurnitureIdForPendingInteraction = (
  interaction: PendingWorldInteraction | null,
) => {
  if (!interaction) return undefined;
  if (interaction.target === "furniture") return interaction.furniture.id;
  return interaction.placedItem.surfaceFurnitureId;
};

const facingTowardPlacedItem = (
  avatar: AvatarRuntime,
  item: PlacedItem,
): AvatarRuntime["facing"] => {
  const itemCenterX = item.x + 18;
  const itemCenterY = item.y + 14;
  const dx = itemCenterX - avatar.x;
  const dy = itemCenterY - avatar.y;

  if (Math.abs(dy) > Math.abs(dx)) {
    return dy < 0 ? "back" : "front";
  }

  return dx < 0 ? "left" : "right";
};

const addInventoryItem = (
  inventory: InventoryEntry[],
  itemId: string,
  quantity = 1,
  maxQuantity = Number.POSITIVE_INFINITY,
) => {
  const currentQuantity = getInventoryQuantity(inventory, itemId);
  if (currentQuantity >= maxQuantity) return inventory;

  const nextQuantity = Math.min(maxQuantity, currentQuantity + quantity);
  const existing = inventory.some((entry) => entry.itemId === itemId);

  return existing
    ? inventory.map((entry) =>
        entry.itemId === itemId ? { ...entry, quantity: nextQuantity } : entry,
      )
    : [...inventory, { itemId, quantity: nextQuantity }];
};

const windowTopLeftFromPoint = (
  windowDefinition: RoomWindowDefinition,
  x: number,
  y: number,
) => ({
  x: Math.round(x - windowDefinition.width / 2),
  y: Math.round(y - windowDefinition.height / 2),
});

const moveFurnitureDefinition = (
  furniture: FurnitureDefinition,
  placement: FurniturePlacement,
): FurnitureDefinition => {
  const dx = placement.x - furniture.x;
  const dy = placement.y - furniture.y;

  return {
    ...furniture,
    x: placement.x,
    y: placement.y,
    collision: furniture.collision
      ? {
          ...furniture.collision,
          x: furniture.collision.x + dx,
          y: furniture.collision.y + dy,
        }
      : undefined,
  };
};

const upsertFurniturePlacements = (
  existing: FurniturePlacement[],
  placements: FurniturePlacement[],
) => {
  const next = existing.filter(
    (item) =>
      !placements.some((placement) => placement.furnitureId === item.furnitureId),
  );
  return [...next, ...placements];
};

const isLegacyDefaultFurniturePlacement = (
  furniture: FurnitureDefinition,
  placement: FurniturePlacement,
) => furniture.id === "bed" && placement.x === 94 && placement.y === 154;

type PendingWorldInteraction =
  | {
      target: "furniture";
      furniture: FurnitureDefinition;
      kind: FurnitureInteractionKind;
      preferredItemId?: string;
    }
  | {
      target: "placed-item";
      placedItem: PlacedItem;
      item: ItemDefinition;
      kind: "brew" | "paint" | "play" | "interact";
    };

type SceneContextMenuState = {
  x: number;
  y: number;
  target:
    | {
        kind: "placed-item";
        placedItem: PlacedItem;
        item: ItemDefinition;
        action: "brew" | "paint" | "play" | "interact";
      }
    | {
        kind: "furniture";
        furniture: FurnitureDefinition;
        action: FurnitureInteractionKind;
      };
};

type DefaultLayoutState = Pick<
  AivatarSaveState,
  "placedItems" | "activeWindowId" | "windowPlacements" | "furniturePlacements"
>;

const getWorkBoostRemainingSeconds = (boostUntil: string | undefined, now: number) => {
  if (!boostUntil) return 0;
  const endsAt = Date.parse(boostUntil);
  if (Number.isNaN(endsAt)) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
};

const placementTargetLabel = (
  locale: Locale,
  item: ItemDefinition | null | undefined,
) => {
  const kind = getItemPlacementKind(item ?? undefined);
  if (kind === "desktop") return t(locale, "target.desktop");
  if (kind === "wall") return t(locale, "target.wall");
  return t(locale, "target.floor");
};

const itemSellValue = (item: ItemDefinition | null | undefined) =>
  item ? Math.max(1, Math.floor(item.price / 2)) : 0;

const findItemDefinition = (content: AivatarContent, itemId: string) =>
  content.itemDefinitions.find((item) => item.id === itemId) ??
  content.shop.items.find((item) => item.id === itemId);

const furnitureEditorTitle = (locale: Locale, furniture: FurnitureDefinition) =>
  furniture.tags?.includes("item")
    ? t(locale, "shop.supplies")
    : t(locale, "furniture.title");

const createDebugStatus = (
  statusName: CodexStatusName,
  locale: Locale,
): CodexStatusMessage => ({
  status: statusName,
  phase: "debug",
  message: t(locale, "message.debugStatus", { status: statusLabel(locale, statusName) }),
  severity: statusName === "error" ? "error" : "info",
  timestamp: new Date().toISOString(),
});

const isBuiltinTerminalPlacedItem = (item: PlacedItem | null | undefined) =>
  item?.id === BUILTIN_TERMINAL_PLACED_ITEM_ID;

const withoutLegacyTerminalFurniturePlacements = (
  placements: FurniturePlacement[] | undefined,
) =>
  (placements ?? []).filter(
    (placement) => placement.furnitureId !== LEGACY_TERMINAL_FURNITURE_ID,
  );

const furnitureWithPlacements = (
  content: AivatarContent,
  placements: FurniturePlacement[] | undefined,
) =>
  content.room.furniture.map((item) => {
    const placement = withoutLegacyTerminalFurniturePlacements(placements).find(
      (candidate) => candidate.furnitureId === item.id,
    );

    return placement && !isLegacyDefaultFurniturePlacement(item, placement)
      ? moveFurnitureDefinition(item, placement)
      : item;
  });

const taskCabinetFurnitureFromPlacedItem = (
  placedItem: PlacedItem,
  definition: ItemDefinition | null | undefined,
): FurnitureDefinition => {
  const x = placedItem.x - 22;
  const y = placedItem.y - 58;

  return {
    id: TASK_CABINET_FURNITURE_ID,
    name: definition?.name ?? "File Cabinet",
    tags: ["furniture", "file-cabinet"],
    placementSurfaces: ["floor"],
    zone: "office",
    x,
    y,
    width: 44,
    height: 58,
    color: "#54606f",
    interaction: "interact",
    collision: { x: x + 7, y: y + 46, width: 30, height: 12 },
  };
};

const isTerminalOnDesktopSurface = (
  terminal: Pick<PlacedItem, "x" | "y">,
  surface: FurnitureDefinition,
) =>
  (surface.id === "desk" || surface.id === "table") &&
  terminal.x >= surface.x + 8 &&
  terminal.x <= surface.x + surface.width - 8 &&
  terminal.y >= surface.y - 2 &&
  terminal.y <= surface.y + 28;

const builtinTerminalFromContent = (
  content: AivatarContent,
  furniturePlacements?: FurniturePlacement[],
): PlacedItem => {
  const defaultTerminal = content.placedItems?.find(isBuiltinTerminalPlacedItem);
  const base: PlacedItem = defaultTerminal ?? {
    id: BUILTIN_TERMINAL_PLACED_ITEM_ID,
    itemId: TERMINAL_MONITOR_ITEM_ID,
    x: 217,
    y: 104,
    surfaceFurnitureId: "desk",
    surfaceOffsetX: 43,
    surfaceOffsetY: 4,
  };
  const legacyPlacement = furniturePlacements?.find(
    (placement) => placement.furnitureId === LEGACY_TERMINAL_FURNITURE_ID,
  );

  if (!legacyPlacement) return base;

  const legacyTerminal = {
    ...base,
    x: legacyPlacement.x + 17,
    y: legacyPlacement.y + 32,
  };
  const surface = furnitureWithPlacements(content, furniturePlacements).find((item) =>
    isTerminalOnDesktopSurface(legacyTerminal, item),
  );

  if (!surface) {
    return {
      ...legacyTerminal,
      surfaceFurnitureId: undefined,
      surfaceOffsetX: undefined,
      surfaceOffsetY: undefined,
    };
  }

  return {
    ...legacyTerminal,
    surfaceFurnitureId: surface.id,
    surfaceOffsetX: legacyTerminal.x - surface.x,
    surfaceOffsetY: legacyTerminal.y - surface.y,
  };
};

const withBuiltinTerminalPlacedItem = (
  content: AivatarContent,
  placedItems: PlacedItem[] | undefined,
  furniturePlacements?: FurniturePlacement[],
): PlacedItem[] => {
  const existingItems = placedItems ?? [];
  const existingTerminal = existingItems.find(isBuiltinTerminalPlacedItem);
  const terminal = existingTerminal
    ? { ...existingTerminal, itemId: TERMINAL_MONITOR_ITEM_ID }
    : builtinTerminalFromContent(content, furniturePlacements);
  const otherItems = existingItems.filter((item) => !isBuiltinTerminalPlacedItem(item));

  return [terminal, ...otherItems];
};

const builtinTerminalAsFurniture = (
  placedItem: PlacedItem,
  definition: ItemDefinition | null | undefined,
): FurnitureDefinition => ({
  id: LEGACY_TERMINAL_FURNITURE_ID,
  name: definition?.name ?? "Terminal",
  tags: ["item", "computer"],
  placementSurfaces: ["furnitureTop"],
  zone: "office",
  x: placedItem.x - 17,
  y: placedItem.y - 32,
  width: 34,
  height: 30,
  color: "#5b677a",
  interaction: "thinking",
});

const defaultLayoutFromContent = (content: AivatarContent): DefaultLayoutState => ({
  placedItems: withBuiltinTerminalPlacedItem(
    content,
    content.placedItems ?? [],
    content.room.furniture.map((item) => ({
      furnitureId: item.id,
      x: item.x,
      y: item.y,
    })),
  ),
  activeWindowId: content.room.windowId,
  windowPlacements: content.room.windows?.map((item) => ({
    windowId: item.id,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  })),
  furniturePlacements: withoutLegacyTerminalFurniturePlacements(
    content.room.furniture.map((item) => ({
      furnitureId: item.id,
      x: item.x,
      y: item.y,
    })),
  ),
});

const loadDefaultLayout = (content: AivatarContent): DefaultLayoutState => {
  const fallback = defaultLayoutFromContent(content);

  try {
    const raw = localStorage.getItem(DEFAULT_LAYOUT_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<DefaultLayoutState>;

    const furniturePlacements = Array.isArray(parsed.furniturePlacements)
      ? withoutLegacyTerminalFurniturePlacements(parsed.furniturePlacements)
      : fallback.furniturePlacements;

    return {
      placedItems: withBuiltinTerminalPlacedItem(
        content,
        Array.isArray(parsed.placedItems) ? parsed.placedItems : fallback.placedItems,
        Array.isArray(parsed.furniturePlacements) ? parsed.furniturePlacements : furniturePlacements,
      ),
      activeWindowId: parsed.activeWindowId ?? fallback.activeWindowId,
      windowPlacements: Array.isArray(parsed.windowPlacements)
        ? parsed.windowPlacements
        : fallback.windowPlacements,
      furniturePlacements,
    };
  } catch {
    return fallback;
  }
};

const createAvatarId = () => {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `avatar-${randomId}`;

  return `avatar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeAvatarId = (avatarId: unknown) =>
  typeof avatarId === "string" && avatarId.trim().length > 0
    ? avatarId
    : createAvatarId();

const saveFromContent = (content: AivatarContent): AivatarSaveState => ({
  layoutVersion: SAVE_LAYOUT_VERSION,
  avatarId: createAvatarId(),
  avatarName: content.avatar.name,
  memory: defaultMemory(),
  navMemory: defaultNavMemory(),
  petStats: content.petStats,
  inventory: content.inventory,
  furnitureStorage: defaultFurnitureStorage(),
  ...loadDefaultLayout(content),
  wallet: content.wallet,
  purchasedItemIds: [],
});

const loadSave = (content: AivatarContent): AivatarSaveState => {
  const fallback: AivatarSaveState = {
    ...saveFromContent(content),
    purchasedItemIds: [],
  };

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<AivatarSaveState>;
    const migratedLayout: Partial<DefaultLayoutState> =
      parsed.layoutVersion === SAVE_LAYOUT_VERSION ? {} : loadDefaultLayout(content);
    const layoutFurniturePlacements =
      migratedLayout.furniturePlacements ?? parsed.furniturePlacements;

    const furniturePlacements = withoutLegacyTerminalFurniturePlacements(
      layoutFurniturePlacements ?? fallback.furniturePlacements,
    );
    const placedItems = withBuiltinTerminalPlacedItem(
      content,
      migratedLayout.placedItems ?? parsed.placedItems ?? fallback.placedItems,
      layoutFurniturePlacements ?? furniturePlacements,
    );

    return {
      ...fallback,
      ...parsed,
      ...migratedLayout,
      avatarId: normalizeAvatarId(parsed.avatarId),
      furnitureStorage: normalizeFurnitureStorage(parsed.furnitureStorage),
      memory: normalizeMemory(parsed.memory),
      navMemory: normalizeNavMemory(parsed.navMemory),
      placedItems,
      furniturePlacements,
      layoutVersion: SAVE_LAYOUT_VERSION,
    };
  } catch {
    return fallback;
  }
};

const persistSave = (save: AivatarSaveState) => {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (error) {
    console.warn("Could not persist Aivatar save.", error);
  }
};

const isTaskCabinetStatus = (value: unknown): value is TaskCabinetStatus =>
  typeof value === "string" &&
  TASK_CABINET_STATUSES.includes(value as TaskCabinetStatus);

const normalizeTaskCabinetStatus = (value: unknown): TaskCabinetStatus =>
  value === "done"
    ? "completed"
    : isTaskCabinetStatus(value)
      ? value
      : "ready";

const isTaskCabinetRunProfile = (
  value: unknown,
): value is TaskCabinetRunProfile =>
  typeof value === "string" &&
  TASK_CABINET_RUN_PROFILES.includes(value as TaskCabinetRunProfile);

const isTaskCabinetScheduleMode = (
  value: unknown,
): value is TaskCabinetScheduleMode =>
  typeof value === "string" &&
  TASK_CABINET_SCHEDULE_MODES.includes(value as TaskCabinetScheduleMode);

const isTaskCabinetScheduleCondition = (
  value: unknown,
): value is TaskCabinetScheduleCondition =>
  typeof value === "string" &&
  TASK_CABINET_SCHEDULE_CONDITIONS.includes(
    value as TaskCabinetScheduleCondition,
  );

const normalizeTaskCabinetIntervalMinutes = (value: unknown) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : TASK_CABINET_DEFAULT_REPEAT_MINUTES;
  if (!Number.isFinite(parsed)) return TASK_CABINET_DEFAULT_REPEAT_MINUTES;
  return Math.max(1, Math.min(10080, Math.round(parsed)));
};

const isValidDateString = (value: unknown) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

const normalizeTaskCabinetSchedule = (
  value: unknown,
): TaskCabinetSchedule | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<TaskCabinetSchedule>;
  const mode = isTaskCabinetScheduleMode(candidate.mode)
    ? candidate.mode
    : "once";
  const runAt = typeof candidate.runAt === "string" ? candidate.runAt : undefined;
  const nextRunAt = isValidDateString(candidate.nextRunAt)
    ? candidate.nextRunAt
    : undefined;
  const lastRunAt = isValidDateString(candidate.lastRunAt)
    ? candidate.lastRunAt
    : undefined;

  return {
    enabled: Boolean(candidate.enabled),
    mode,
    runAt,
    intervalMinutes: normalizeTaskCabinetIntervalMinutes(
      candidate.intervalMinutes,
    ),
    condition: isTaskCabinetScheduleCondition(candidate.condition)
      ? candidate.condition
      : "always",
    nextRunAt,
    lastRunAt,
  };
};

const datetimeLocalToIso = (value: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const isoToDatetimeLocal = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
};

const calculateTaskScheduleNextRunAt = (
  schedule: TaskCabinetSchedule,
  fromMs = Date.now(),
) => {
  if (schedule.mode === "once") {
    return datetimeLocalToIso(schedule.runAt ?? "");
  }

  const firstRunAt = datetimeLocalToIso(schedule.runAt ?? "");
  if (!schedule.lastRunAt && firstRunAt) {
    return firstRunAt;
  }

  const intervalMs =
    normalizeTaskCabinetIntervalMinutes(schedule.intervalMinutes) * 60000;
  return new Date(fromMs + intervalMs).toISOString();
};

const hasTaskScheduleDue = (entry: TaskCabinetEntry, nowMs: number) => {
  const schedule = entry.schedule;
  if (!schedule?.enabled) return false;
  const nextRunAt =
    schedule.nextRunAt ?? calculateTaskScheduleNextRunAt(schedule, nowMs);
  if (!nextRunAt) return false;
  return Date.parse(nextRunAt) <= nowMs;
};

const taskScheduleNextLabel = (
  schedule: TaskCabinetSchedule | undefined,
  nowMs: number,
) => {
  if (!schedule?.enabled) return "Schedule off";
  if (!schedule.nextRunAt) return "Next not set";
  const nextMs = Date.parse(schedule.nextRunAt);
  if (Number.isNaN(nextMs)) return "Next not set";
  if (nextMs <= nowMs) return "Due now";
  return `Next ${new Date(schedule.nextRunAt).toLocaleString()}`;
};

const taskScheduleConditionMet = (
  entry: TaskCabinetEntry,
  hasRunningTask: boolean,
) => {
  const condition = entry.schedule?.condition ?? "always";
  if (condition === "only_idle") return !hasRunningTask;
  if (condition === "after_success") {
    return entry.status === "completed" || !entry.startedAt;
  }
  return true;
};

const normalizeTaskCabinetEntry = (value: unknown): TaskCabinetEntry | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TaskCabinetEntry>;
  const path = typeof candidate.path === "string" ? candidate.path.trim() : "";
  if (!path) return null;
  const createdAt =
    typeof candidate.createdAt === "string"
      ? candidate.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof candidate.updatedAt === "string" ? candidate.updatedAt : createdAt;

  return {
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : `task-${createdAt}-${path}`,
    path,
    status: normalizeTaskCabinetStatus(candidate.status),
    createdAt,
    updatedAt,
    agent: typeof candidate.agent === "string" ? candidate.agent : undefined,
    cwd: typeof candidate.cwd === "string" ? candidate.cwd : undefined,
    sessionId:
      typeof candidate.sessionId === "string" ? candidate.sessionId : undefined,
    startedAt:
      typeof candidate.startedAt === "string" ? candidate.startedAt : undefined,
    finishedAt:
      typeof candidate.finishedAt === "string" ? candidate.finishedAt : undefined,
    error: typeof candidate.error === "string" ? candidate.error : undefined,
    runProfile: isTaskCabinetRunProfile(candidate.runProfile)
      ? candidate.runProfile
      : "default",
    schedule: normalizeTaskCabinetSchedule(candidate.schedule),
  };
};

const loadTaskCabinetEntries = (): TaskCabinetEntry[] => {
  try {
    const raw = localStorage.getItem(TASK_CABINET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeTaskCabinetEntry)
      .filter((entry): entry is TaskCabinetEntry => entry !== null);
  } catch (error) {
    console.warn("Could not load task cabinet entries.", error);
    return [];
  }
};

const persistTaskCabinetEntries = (entries: TaskCabinetEntry[]) => {
  try {
    localStorage.setItem(TASK_CABINET_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn("Could not persist Task Cabinet entries.", error);
  }
};

const taskCabinetFileName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scenePanelRef = useRef<HTMLElement | null>(null);
  const initialSaveRef = useRef<AivatarSaveState | null>(null);
  const loadInitialSave = () => {
    if (!initialSaveRef.current) {
      initialSaveRef.current = loadSave(defaultContent);
    }
    return initialSaveRef.current;
  };
  const runtimeRef = useRef<AvatarRuntime>(
    loadInitialSave().avatarRuntime ?? initialAvatarRuntime(),
  );
  const [avatar, setAvatar] = useState<AvatarRuntime>(() => runtimeRef.current);
  const [hoveredFurniture, setHoveredFurniture] = useState<FurnitureDefinition | null>(
    null,
  );
  const [selectedFurniture, setSelectedFurniture] = useState<FurnitureDefinition | null>(
    null,
  );
  const [activeInteraction, setActiveInteraction] =
    useState<FurnitureInteractionState | null>(null);
  const pendingWorldInteractionRef = useRef<PendingWorldInteraction | null>(
    null,
  );
  const [placingItem, setPlacingItem] = useState<ItemDefinition | null>(null);
  const [placementPreview, setPlacementPreview] = useState<{
    x: number;
    y: number;
    valid: boolean;
  } | null>(null);
  const [selectedPlacedItem, setSelectedPlacedItem] = useState<PlacedItem | null>(null);
  const [movingPlacedItem, setMovingPlacedItem] = useState<PlacedItem | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<RoomWindowDefinition | null>(null);
  const [movingWindow, setMovingWindow] = useState<RoomWindowDefinition | null>(null);
  const [movingFurniture, setMovingFurniture] = useState<FurnitureDefinition | null>(null);
  const [sceneContextMenu, setSceneContextMenu] =
    useState<SceneContextMenuState | null>(null);
  const [windowPlacementPreview, setWindowPlacementPreview] = useState<{
    x: number;
    y: number;
    valid: boolean;
  } | null>(null);
  const [furniturePlacementPreview, setFurniturePlacementPreview] = useState<{
    x: number;
    y: number;
    valid: boolean;
  } | null>(null);
  const selectedFurnitureRef = useRef<FurnitureDefinition | null>(null);
  const hoveredFurnitureRef = useRef<FurnitureDefinition | null>(null);
  const activeInteractionRef = useRef<FurnitureInteractionState | null>(null);
  const placingItemRef = useRef<ItemDefinition | null>(null);
  const placementPreviewRef = useRef<{
    x: number;
    y: number;
    valid: boolean;
  } | null>(null);
  const selectedPlacedItemRef = useRef<PlacedItem | null>(null);
  const movingPlacedItemRef = useRef<PlacedItem | null>(null);
  const selectedWindowRef = useRef<RoomWindowDefinition | null>(null);
  const movingWindowRef = useRef<RoomWindowDefinition | null>(null);
  const movingFurnitureRef = useRef<FurnitureDefinition | null>(null);
  const windowPlacementPreviewRef = useRef<{
    x: number;
    y: number;
    valid: boolean;
  } | null>(null);
  const furniturePlacementPreviewRef = useRef<{
    x: number;
    y: number;
    valid: boolean;
  } | null>(null);
  const hadSavedStateRef = useRef(localStorage.getItem(SAVE_KEY) !== null);
  const [contentBase, setContentBase] = useState(defaultContent);
  const [configState, setConfigState] = useState<"builtin" | "config" | "fallback">(
    "builtin",
  );
  const [activeShopCategory, setActiveShopCategory] =
    useState<ShopCategoryId>("furniture");
  const [activeDecorSurfaceCategory, setActiveDecorSurfaceCategory] =
    useState<DecorSurfaceCategoryId>("wallpaper");
  const [decorPanelOpen, setDecorPanelOpen] = useState(false);
  const [growthPanelOpen, setGrowthPanelOpen] = useState(false);
  const [sessionsPanelOpen, setSessionsPanelOpen] = useState(false);
  const [taskCabinetPanelOpen, setTaskCabinetPanelOpen] = useState(false);
  const [launcherPanelOpen, setLauncherPanelOpen] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [sidePanelAnimating, setSidePanelAnimating] = useState(false);
  const [scenePanelWidth, setScenePanelWidth] = useState<number | null>(null);
  const previousExpandedWindowWidthRef = useRef(DEFAULT_EXPANDED_WINDOW_WIDTH);
  const sidePanelTimerRef = useRef<number | null>(null);
  const [save, setSave] = useState<AivatarSaveState>(() => loadInitialSave());
  const saveRef = useRef(save);
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale());
  const {
    status,
    sessions,
    source,
    endpoint,
    activeSessionKey,
    connectedSessionKey,
    currentSessionKey,
    activateSession,
    clearActiveSession,
    clearStaleSessions,
  } = useCodexStatus();
  const [debugStatus, setDebugStatus] = useState<CodexStatusMessage | null>(null);
  const [windowTimePreview, setWindowTimePreview] = useState(false);
  const windowTimePreviewRef = useRef(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [bridgeStartMessage, setBridgeStartMessage] = useState("");
  const [taskCabinetEntries, setTaskCabinetEntries] = useState<TaskCabinetEntry[]>(
    () => loadTaskCabinetEntries(),
  );
  const [taskCabinetPathInput, setTaskCabinetPathInput] = useState("");
  const [taskCabinetMessage, setTaskCabinetMessage] = useState("");
  const [launcherDirectory, setLauncherDirectory] = useState("");
  const [launcherAgent, setLauncherAgent] = useState<LauncherAgentId>("codex");
  const [launcherArgs, setLauncherArgs] = useState("");
  const [launcherAllowNewSession, setLauncherAllowNewSession] = useState(false);
  const [launcherMessage, setLauncherMessage] = useState("");
  const effectiveStatus = debugStatus ?? status;
  const effectiveSource = debugStatus ? "debug" : source;
  const statusRef = useRef({ status: effectiveStatus, source: effectiveSource, endpoint });
  const taskCabinetEntriesRef = useRef(taskCabinetEntries);
  const taskCabinetLaunchingRef = useRef(false);
  const lastRewardedCompleteKeyRef = useRef<string | null>(null);
  const behaviorDemoTimerRef = useRef<number | null>(null);
  const previousSessionStatusRef = useRef(
    new Map<string, CodexStatusMessage["status"]>(),
  );

  const content = useMemo(
    () => {
      const windowPlacements = save.windowPlacements ?? [];
      const furniturePlacements = withoutLegacyTerminalFurniturePlacements(
        save.furniturePlacements,
      );
      const baseFurniture = furnitureWithPlacements(contentBase, furniturePlacements);
      const taskCabinetPlacedItem = save.placedItems.find(
        (item) => item.itemId === TASK_CABINET_FURNITURE_ID,
      );
      const taskCabinetFurniture = taskCabinetPlacedItem
        ? taskCabinetFurnitureFromPlacedItem(
            taskCabinetPlacedItem,
            findItemDefinition(contentBase, TASK_CABINET_FURNITURE_ID),
          )
        : null;
      const furniture = taskCabinetFurniture
        ? [...baseFurniture, taskCabinetFurniture]
        : baseFurniture;
      const windows = contentBase.room.windows?.map((windowDefinition) => {
        const placement = windowPlacements.find(
          (item) => item.windowId === windowDefinition.id,
        );

        return placement
          ? {
              ...windowDefinition,
              x: placement.x,
              y: placement.y,
              width: placement.width ?? windowDefinition.width,
              height: placement.height ?? windowDefinition.height,
            }
          : windowDefinition;
      });

      const placedItems = withBuiltinTerminalPlacedItem(
        contentBase,
        save.placedItems.filter(
          (item) => item.itemId !== TASK_CABINET_FURNITURE_ID,
        ),
        save.furniturePlacements,
      ).map((item) => {
        const surface = item.surfaceFurnitureId
          ? furniture.find(
              (candidate) => candidate.id === item.surfaceFurnitureId,
            )
          : undefined;

        return attachedPlacedItemPosition(item, surface);
      });

      const resolvedContent = {
        ...contentBase,
        avatar: {
          ...contentBase.avatar,
          name: save.avatarName?.trim() || contentBase.avatar.name,
        },
        room: {
          ...contentBase.room,
          furniture,
          floorSurfaceId: save.floorSurfaceId ?? contentBase.room.floorSurfaceId,
          wallSurfaceId: save.wallSurfaceId ?? contentBase.room.wallSurfaceId,
          windowId: save.activeWindowId ?? contentBase.room.windowId,
          windows,
        },
        petStats: save.petStats,
        inventory: save.inventory,
        placedItems,
        wallet: save.wallet,
      };

      return localizeContent(resolvedContent, locale);
    },
    [contentBase, locale, save],
  );
  const contentRef = useRef(content);
  const boostRemainingSeconds = getWorkBoostRemainingSeconds(save.workBoostUntil, nowMs);
  const boostActive = boostRemainingSeconds > 0;
  const tableCoffeeCapacity = getTableCoffeeCapacity(content.placedItems);
  const rawTableCoffeeStorage =
    getFurnitureStorageEntry(save.furnitureStorage, TABLE_FURNITURE_ID, COFFEE_ITEM_ID) ??
    defaultFurnitureStorage()[0];
  const tableCoffeeStorage = {
    ...rawTableCoffeeStorage,
    capacity: tableCoffeeCapacity,
    quantity: Math.min(rawTableCoffeeStorage.quantity, tableCoffeeCapacity),
  };
  const ui = (key: string, params?: Record<string, string | number>) =>
    t(locale, key, params);
  const sourceLabel =
    effectiveSource === "websocket"
      ? ui("source.websocket")
      : effectiveSource === "debug"
        ? ui("source.debug")
        : ui("source.simulated");
  const sessionRows = sessions.slice(0, 6).map((session) => ({
    ...session,
    sessionKey: explicitStatusSessionKey(session),
    stale: isPresenceStale(session, nowMs),
    label: agentDisplayName(session),
    detail: session.summary ?? session.message ?? session.task ?? session.phase ?? endpoint,
    rewardSummary: rewardSummaryForUsage(session.usage),
    contextMeter: contextWindowMeterForUsage(session.usage),
  }));
  const liveSessionCount = sessionRows.filter(
    (session) => !session.stale || session.sessionKey === connectedSessionKey,
  ).length;
  const currentSessionContextMeter =
    sessionRows.find((session) => session.sessionKey === currentSessionKey)
      ?.contextMeter ??
    sessionRows.find((session) => session.sessionKey === connectedSessionKey)
      ?.contextMeter ??
    sessionRows.find((session) => session.sessionKey === activeSessionKey)
      ?.contextMeter ??
    contextWindowMeterForUsage(effectiveStatus.usage);
  const clearableStaleSessionCount = sessions.filter((session) => {
    const sessionKey = explicitStatusSessionKey(session);
    return sessionKey !== activeSessionKey && isPresenceStale(session, nowMs);
  }).length;
  const followSession = (session: CodexStatusMessage) => {
    if (!session.agent || !session.sessionId) return;
    void activateSession(session.agent, session.sessionId).catch(() => {
      console.warn("Could not follow session.");
    });
  };

  const clearFollowedSession = () => {
    void clearActiveSession().catch(() => {
      console.warn("Could not clear followed session.");
    });
  };

  const clearStaleSessionRows = () => {
    void clearStaleSessions().catch(() => {
      console.warn("Could not clear stale sessions.");
    });
  };

  const resizeDesktopWindowForSidePanel = async (
    open: boolean,
    collapsedWidth = COLLAPSED_WINDOW_MIN_WIDTH,
  ) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const minWidth = open ? EXPANDED_WINDOW_MIN_WIDTH : collapsedWidth;
      const nextWidth = open
        ? Math.max(previousExpandedWindowWidthRef.current, DEFAULT_EXPANDED_WINDOW_WIDTH)
        : collapsedWidth;
      await invoke("resize_main_window_for_side_panel", {
        width: nextWidth,
        minWidth,
        height: window.innerHeight,
      });
    } catch {
      // Web preview has no native window to resize.
    }
  };

  const toggleSidePanel = () => {
    if (sidePanelAnimating) return;

    const nextOpen = !sidePanelOpen;
    if (!nextOpen) {
      previousExpandedWindowWidthRef.current = Math.max(
        window.innerWidth,
        DEFAULT_EXPANDED_WINDOW_WIDTH,
      );
    }
    const sceneWidth = scenePanelRef.current?.getBoundingClientRect().width ?? 480;
    const lockedSceneWidth = Math.round(sceneWidth);
    const collapsedWidth = Math.max(
      COLLAPSED_WINDOW_MIN_WIDTH,
      lockedSceneWidth + APP_HORIZONTAL_PADDING,
    );

    if (sidePanelTimerRef.current) {
      window.clearTimeout(sidePanelTimerRef.current);
      sidePanelTimerRef.current = null;
    }

    setScenePanelWidth(lockedSceneWidth);
    setSidePanelAnimating(true);

    if (nextOpen) {
      void resizeDesktopWindowForSidePanel(true, collapsedWidth).finally(() => {
        setSidePanelOpen(true);
        sidePanelTimerRef.current = window.setTimeout(() => {
          setScenePanelWidth(null);
          setSidePanelAnimating(false);
          sidePanelTimerRef.current = null;
        }, SIDE_PANEL_TRANSITION_MS);
      });
      return;
    }

    setSidePanelOpen(false);
    void resizeDesktopWindowForSidePanel(false, collapsedWidth).finally(() => {
      sidePanelTimerRef.current = window.setTimeout(() => {
        setSidePanelAnimating(false);
        sidePanelTimerRef.current = null;
      }, SIDE_PANEL_TRANSITION_MS);
    });
  };

  const currentStatusMessage = () => {
    if (activeInteraction) return activeInteraction.message;
    if (selectedFurniture) {
      return ui("message.furnitureInteraction", {
        name: selectedFurniture.name,
        behavior: behaviorLabel(locale, selectedFurniture.interaction),
      });
    }
    if (avatar.activityLabel) return activityLabel(locale, avatar.activityLabel);
    if (effectiveSource === "simulated") return statusLabel(locale, effectiveStatus.status);
    return effectiveStatus.message ?? effectiveStatus.task ?? endpoint;
  };

  const startBridge = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ message?: string }>("start_status_bridge");
      setBridgeStartMessage(result.message ?? ui("message.bridgeStarted"));
    } catch {
      setBridgeStartMessage(ui("message.bridgeDesktopOnly"));
    }
  };

  const startAgentCliFromLauncher = async () => {
    const cwd = launcherDirectory.trim();
    if (!cwd) {
      setLauncherMessage(ui("message.launcherMissingDirectory"));
      return;
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ message?: string }>("start_agent_cli", {
        request: {
          agent: launcherAgent,
          cwd,
          args: launcherArgs.trim() || null,
          allow_new_session: launcherAllowNewSession,
        },
      });
      setLauncherMessage(result.message ?? ui("message.launcherStarted"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setLauncherMessage(detail || ui("message.launcherDesktopOnly"));
    }
  };

  const browseLauncherDirectory = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("pick_launcher_directory");
      if (path) {
        setLauncherDirectory(path);
        setLauncherMessage("Launcher folder selected.");
      }
    } catch {
      setLauncherMessage("File picker is desktop-only.");
    }
  };

  const updateActiveInteraction = (interaction: FurnitureInteractionState | null) => {
    activeInteractionRef.current = interaction;
    setActiveInteraction(interaction);
  };

  const clearPendingFurnitureInteraction = () => {
    pendingWorldInteractionRef.current = null;
  };

  const queueFurnitureInteraction = (
    furniture: FurnitureDefinition,
    kind: FurnitureInteractionKind,
    preferredItemId?: string,
  ) => {
    pendingWorldInteractionRef.current = {
      target: "furniture",
      furniture,
      kind,
      preferredItemId,
    };
    runtimeRef.current = setFurnitureBehavior(runtimeRef.current, furniture, 20, {
      behavior: behaviorForFurnitureInteraction(furniture, kind),
      facing: runtimeRef.current.facing,
      content: contentRef.current,
    });
    setAvatar(runtimeRef.current);
    updateActiveInteraction({
      kind: "none",
      furnitureId: furniture.id,
      furnitureName: furniture.name,
      message: ui("message.headingOver", { name: furniture.name }),
      startedAt: performance.now(),
      bubbleText: ui("thought.going"),
    });
  };

  const queuePlacedItemInteraction = (
    placedItem: PlacedItem,
    item: ItemDefinition,
    kind: "brew" | "paint" | "play" | "interact",
  ) => {
    pendingWorldInteractionRef.current = {
      target: "placed-item",
      placedItem,
      item,
      kind,
    };
    const standpoints = getPlacedItemInteractionStandpoints(placedItem, contentRef.current);
    const target = getPlacedItemInteractionTarget(placedItem, contentRef.current);
    runtimeRef.current = {
      ...runtimeRef.current,
      ...target,
      behavior:
        kind === "brew"
          ? "brew"
          : kind === "paint"
            ? "paint"
            : kind === "play"
              ? "play"
              : "interact",
      behaviorTimer: 20,
      expression: kind === "play" || kind === "paint" ? "happy" : "focused",
      activityLabel:
        kind === "brew"
          ? "Brewing coffee"
          : kind === "paint"
            ? "Painting"
          : kind === "play"
            ? "Playing games"
            : "Heading over",
      interactionTargetAlternates: standpoints.length > 1 ? standpoints : undefined,
    };
    setAvatar(runtimeRef.current);
    updateActiveInteraction({
      kind: "none",
      furnitureId: placedItem.id,
      furnitureName: item.name,
      message: ui("message.headingOver", { name: item.name }),
      startedAt: performance.now(),
      bubbleText: ui("thought.going"),
    });
  };

  const placedItemContextAction = (
    placedItem: PlacedItem,
  ): "brew" | "paint" | "play" | "interact" | null => {
    if (isBuiltinTerminalPlacedItem(placedItem)) return "interact";
    if (placedItem.itemId === COFFEE_MACHINE_ITEM_ID) return "brew";
    if (placedItem.itemId === "game-console") return "play";
    if (placedItem.itemId === EASEL_ITEM_ID) return "paint";
    return null;
  };

  const showPlacedItemBusy = (
    placedItem: PlacedItem,
    item: ItemDefinition,
  ) => {
    updateActiveInteraction({
      kind: "blocked",
      furnitureId: placedItem.id,
      furnitureName: item.name,
      message: ui("message.agentBusy", {
        name: item.name,
        agent: agentDisplayName(statusRef.current.status),
      }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.busy"),
    });
  };

  const showFurnitureBusy = (furniture: FurnitureDefinition) => {
    updateActiveInteraction({
      kind: "blocked",
      furnitureId: furniture.id,
      furnitureName: furniture.name,
      message: ui("message.agentBusy", {
        name: furniture.name,
        agent: agentDisplayName(statusRef.current.status),
      }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.busy"),
    });
  };

  const runSceneContextAction = () => {
    if (!sceneContextMenu) return;
    setSceneContextMenu(null);

    if (sceneContextMenu.target.kind === "placed-item") {
      const { placedItem, item, action } = sceneContextMenu.target;
      if (isHighPriorityStatus(statusRef.current.status)) {
        showPlacedItemBusy(placedItem, item);
        return;
      }
      queuePlacedItemInteraction(placedItem, item, action);
      return;
    }

    const { furniture, action } = sceneContextMenu.target;
    if (isHighPriorityStatus(statusRef.current.status)) {
      showFurnitureBusy(furniture);
      return;
    }

    if (action !== "none") {
      queueFurnitureInteraction(furniture, action);
      return;
    }

    clearPendingFurnitureInteraction();
    runtimeRef.current = setFurnitureBehavior(runtimeRef.current, furniture, 5, {
      content: contentRef.current,
    });
    setAvatar(runtimeRef.current);
    updateActiveInteraction({
      kind: "none",
      furnitureId: furniture.id,
      furnitureName: furniture.name,
      message: ui("message.furnitureInteraction", {
        name: furniture.name,
        behavior: behaviorLabel(locale, furniture.interaction),
      }),
      startedAt: performance.now(),
      bubbleText: behaviorLabel(locale, furniture.interaction),
    });
  };

  const updatePlacingItem = (item: ItemDefinition | null) => {
    placingItemRef.current = item;
    setPlacingItem(item);
  };

  const updatePlacementPreview = (
    preview: { x: number; y: number; valid: boolean } | null,
  ) => {
    placementPreviewRef.current = preview;
    setPlacementPreview(preview);
  };

  const updateSelectedPlacedItem = (item: PlacedItem | null) => {
    selectedPlacedItemRef.current = item;
    setSelectedPlacedItem(item);
  };

  const updateMovingPlacedItem = (item: PlacedItem | null) => {
    movingPlacedItemRef.current = item;
    setMovingPlacedItem(item);
  };

  const updateSelectedWindow = (windowDefinition: RoomWindowDefinition | null) => {
    selectedWindowRef.current = windowDefinition;
    setSelectedWindow(windowDefinition);
  };

  const updateMovingWindow = (windowDefinition: RoomWindowDefinition | null) => {
    movingWindowRef.current = windowDefinition;
    setMovingWindow(windowDefinition);
  };

  const updateMovingFurniture = (furniture: FurnitureDefinition | null) => {
    movingFurnitureRef.current = furniture;
    setMovingFurniture(furniture);
  };

  const updateWindowPlacementPreview = (
    preview: { x: number; y: number; valid: boolean } | null,
  ) => {
    windowPlacementPreviewRef.current = preview;
    setWindowPlacementPreview(preview);
  };

  const updateFurniturePlacementPreview = (
    preview: { x: number; y: number; valid: boolean } | null,
  ) => {
    furniturePlacementPreviewRef.current = preview;
    setFurniturePlacementPreview(preview);
  };

  const clearSelectedRoomObject = () => {
    setSceneContextMenu(null);
    selectedFurnitureRef.current = null;
    setSelectedFurniture(null);
    updateSelectedPlacedItem(null);
    updateMovingPlacedItem(null);
    updateSelectedWindow(null);
    updateMovingWindow(null);
    updateWindowPlacementPreview(null);
    updateMovingFurniture(null);
  };

  useEffect(() => {
    let cancelled = false;

    loadContentConfig()
      .then((loadedContent) => {
        if (cancelled) return;
        setContentBase(loadedContent);
        setConfigState("config");

        if (!hadSavedStateRef.current) {
          setSave(saveFromContent(loadedContent));
        }
      })
      .catch((error: unknown) => {
        console.warn("Aivatar config fallback:", error);
        if (!cancelled) setConfigState("fallback");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    windowTimePreviewRef.current = windowTimePreview;
  }, [windowTimePreview]);

  useEffect(() => {
    persistTaskCabinetEntries(taskCabinetEntries);
    taskCabinetEntriesRef.current = taskCabinetEntries;
  }, [taskCabinetEntries]);

  const getWindowTimeMs = (frame: number) =>
    windowTimePreviewRef.current ? Date.now() + frame * 60000 : Date.now();

  useLayoutEffect(() => {
    if (canvasRef.current) {
      renderScene(
        canvasRef.current,
        content,
        runtimeRef.current,
        effectiveStatus,
        0,
        hoveredFurniture?.id,
        selectedFurniture?.id,
        activeInteraction,
        placementPreview && placingItem
          ? { item: placingItem, ...placementPreview }
          : placementPreview && movingPlacedItem
            ? {
                item:
                  content.itemDefinitions.find(
                    (item) => item.id === movingPlacedItem.itemId,
                  ) ?? content.itemDefinitions[0],
                ...placementPreview,
              }
          : null,
        selectedPlacedItem?.id,
        selectedWindow?.id,
        windowPlacementPreview && movingWindow
          ? { window: movingWindow, ...windowPlacementPreview }
          : null,
        furniturePlacementPreview && movingFurniture
          ? { furniture: movingFurniture, ...furniturePlacementPreview }
        : null,
        tableCoffeeStorage.quantity,
        save.memory,
        getWindowTimeMs(0),
        taskCabinetEntries.filter(
          (entry) => entry.status === "ready" || entry.status === "failed",
        ).length,
        taskCabinetEntries.filter((entry) => entry.status === "failed").length,
      );
    }
  }, [
    activeInteraction,
    content,
    effectiveStatus,
    hoveredFurniture,
    placingItem,
    placementPreview,
    selectedFurniture,
    selectedPlacedItem,
    movingPlacedItem,
    selectedWindow,
    movingWindow,
    windowPlacementPreview,
    furniturePlacementPreview,
    movingFurniture,
    save.memory,
    taskCabinetEntries,
  ]);

  useEffect(() => {
    statusRef.current = { status: effectiveStatus, source: effectiveSource, endpoint };
  }, [effectiveSource, effectiveStatus, endpoint]);

  useEffect(() => {
    saveRef.current = save;
    persistSave({
      ...save,
      avatarRuntime: runtimeRef.current,
    });
  }, [save]);

  useEffect(() => {
    const flushSave = () => {
      persistSave({
        ...saveRef.current,
        avatarRuntime: runtimeRef.current,
      });
    };
    const flushOnVisibilityHidden = () => {
      if (document.visibilityState === "hidden") flushSave();
    };

    window.addEventListener("pagehide", flushSave);
    window.addEventListener("beforeunload", flushSave);
    document.addEventListener("visibilitychange", flushOnVisibilityHidden);
    const unlistenPromise = listen("aivatar://save-before-close", flushSave).catch(
      () => undefined,
    );

    return () => {
      stopBehaviorDemo();
      flushSave();
      window.removeEventListener("pagehide", flushSave);
      window.removeEventListener("beforeunload", flushSave);
      document.removeEventListener("visibilitychange", flushOnVisibilityHidden);
      void unlistenPromise.then((unlisten) => unlisten?.());
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCALE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    if (!bridgeStartMessage) return;
    const timer = window.setTimeout(
      () => setBridgeStartMessage(""),
      BRIDGE_START_MESSAGE_SECONDS * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [bridgeStartMessage]);

  useEffect(
    () => () => {
      if (sidePanelTimerRef.current) {
        window.clearTimeout(sidePanelTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    let statAccumulator = 0;
    let sleepAccumulator = 0;
    let playAccumulator = 0;
    let paintAccumulator = 0;
    let coffeeAccumulator = 0;
    let uiAccumulator = 0;
    let exploreAccumulator = 0;
    let exploreStuckAccumulator = 0;
    let lastExploreDistance = Number.POSITIVE_INFINITY;
    let navLearningAccumulator = 0;
    let navLearningStuckAccumulator = 0;
    let lastNavLearningDistance = Number.POSITIVE_INFINITY;
    let lastNavLearningTargetKey = "";
    let lastNavLearningSuccessKey = "";
    let lastNavLearningFailureKey = "";
    let stopped = false;

    const loop = (now: number) => {
      if (stopped) return;
      const elapsedSeconds = Math.min((now - previous) / 1000, 0.08);
      previous = now;
      frame += 1;
      statAccumulator += elapsedSeconds;
      uiAccumulator += elapsedSeconds;
      const currentContent = contentRef.current;
      const currentStatus = statusRef.current.status;
      const currentInteraction = activeInteractionRef.current;
      const pendingWorldInteraction = pendingWorldInteractionRef.current;
      const blockingInteraction = isBlockingInteraction(currentInteraction);
      const furnitureInteractionActive =
        pendingWorldInteraction ||
        blockingInteraction;
      const busyRecoveryNeed = !furnitureInteractionActive
        ? getBusyRecoveryNeed(
            currentStatus,
            currentContent,
            saveRef.current.furnitureStorage,
            saveRef.current.memory,
          )
        : null;
      const busyRecoveryActive = Boolean(busyRecoveryNeed);
      const avatarStatus =
        busyRecoveryActive ||
        (furnitureInteractionActive && !isHighPriorityStatus(currentStatus))
          ? {
              ...currentStatus,
              status: "idle" as const,
            }
          : currentStatus;

      if (
        busyRecoveryNeed &&
        runtimeRef.current.behavior !== busyRecoveryNeed.behavior
      ) {
        if (busyRecoveryNeed.behavior === "snack") {
          const targetFurniture = currentContent.room.furniture.find(
            (item) => item.id === busyRecoveryNeed.targetFurnitureId,
          );
          runtimeRef.current = targetFurniture
            ? setFurnitureBehavior(runtimeRef.current, targetFurniture, 6, {
                behavior: "snack",
                facing: runtimeRef.current.facing,
                content: currentContent,
              })
            : setBehavior(runtimeRef.current, "snack", currentContent, 6, "Checking snacks");
        } else {
          const gameConsole = chooseNearestOrRandomPlacedItem(
            runtimeRef.current,
            (currentContent.placedItems ?? []).filter(
              (item) => item.itemId === busyRecoveryNeed.placedItemId,
            ),
          );
          const gameConsoleTarget = gameConsole
            ? getPlacedItemInteractionTarget(gameConsole, currentContent)
            : null;
          const gameConsoleStandpoints = gameConsole
            ? getPlacedItemInteractionStandpoints(gameConsole, currentContent)
            : [];
          runtimeRef.current = gameConsole
            ? {
                ...runtimeRef.current,
                targetX: gameConsoleTarget?.targetX ?? gameConsole.x + 18,
                targetY: gameConsoleTarget?.targetY ?? gameConsole.y + 14,
                behavior: "play",
                behaviorTimer: 6,
                expression: "happy",
                activityLabel: "Playing games",
                interactionTargetAlternates:
                  gameConsoleStandpoints.length > 1 ? gameConsoleStandpoints : undefined,
              }
            : setBehavior(runtimeRef.current, "play", currentContent, 6, "Playing games");
        }
      }

      runtimeRef.current = tickAvatar(
        runtimeRef.current,
        currentContent,
        avatarStatus,
        elapsedSeconds,
        saveRef.current.memory,
        {
          ignoredFurnitureId:
            ignoredFurnitureIdForPendingInteraction(pendingWorldInteraction),
          navMemory: saveRef.current.navMemory,
        },
      );

      const navLearningTargetKey = [
        runtimeRef.current.behavior,
        Math.round(runtimeRef.current.targetX),
        Math.round(runtimeRef.current.targetY),
      ].join(":");
      const navLearningDistance = Math.hypot(
        runtimeRef.current.x - runtimeRef.current.targetX,
        runtimeRef.current.y - runtimeRef.current.targetY,
      );
      const navLearningBehaviorActive =
        runtimeRef.current.behavior !== "idle" &&
        runtimeRef.current.behavior !== "explore";
      const recordNavLearningResult = (
        result: "success" | "failure",
        cellKey = explorationCellKey(runtimeRef.current),
      ) => {
        const resultKey = `${navLearningTargetKey}:${cellKey}`;
        if (result === "success") {
          if (resultKey === lastNavLearningSuccessKey) return;
          lastNavLearningSuccessKey = resultKey;
        } else {
          if (resultKey === lastNavLearningFailureKey) return;
          lastNavLearningFailureKey = resultKey;
        }

        setSave((current) => ({
          ...current,
          navMemory: recordExploreResult(current.navMemory, result, cellKey),
        }));
      };

      if (navLearningTargetKey !== lastNavLearningTargetKey) {
        navLearningAccumulator = 0;
        navLearningStuckAccumulator = 0;
        lastNavLearningDistance = Number.POSITIVE_INFINITY;
        lastNavLearningTargetKey = navLearningTargetKey;
        lastNavLearningSuccessKey = "";
        lastNavLearningFailureKey = "";
      }

      if (navLearningBehaviorActive) {
        navLearningAccumulator += elapsedSeconds;
        navLearningStuckAccumulator =
          navLearningDistance < lastNavLearningDistance - 0.2
            ? 0
            : navLearningStuckAccumulator + elapsedSeconds;
        lastNavLearningDistance = navLearningDistance;

        if (navLearningAccumulator >= NAV_LEARNING_RECORD_INTERVAL_SECONDS) {
          navLearningAccumulator = 0;
          const cellKey = explorationCellKey(runtimeRef.current);
          setSave((current) => ({
            ...current,
            navMemory: recordExploredCell(current.navMemory, cellKey),
          }));
        }

        if (navLearningStuckAccumulator >= 2.8) {
          recordNavLearningResult("failure");
          navLearningStuckAccumulator = 0;
        }

        if (navLearningDistance <= INTERACTION_ARRIVAL_DISTANCE) {
          recordNavLearningResult("success");
        }
      } else {
        navLearningAccumulator = 0;
        navLearningStuckAccumulator = 0;
        lastNavLearningDistance = Number.POSITIVE_INFINITY;
      }

      if (runtimeRef.current.behavior === "explore") {
        const exploreDistance = Math.hypot(
          runtimeRef.current.x - runtimeRef.current.targetX,
          runtimeRef.current.y - runtimeRef.current.targetY,
        );
        exploreAccumulator += elapsedSeconds;
        exploreStuckAccumulator =
          exploreDistance < lastExploreDistance - 0.2
            ? 0
            : exploreStuckAccumulator + elapsedSeconds;
        lastExploreDistance = exploreDistance;

        if (exploreAccumulator >= 0.8) {
          exploreAccumulator = 0;
          const cellKey = explorationCellKey(runtimeRef.current);
          setSave((current) => ({
            ...current,
            navMemory: recordExploredCell(current.navMemory, cellKey),
          }));
        }

        if (explorationTargetReached(runtimeRef.current)) {
          const cellKey = explorationCellKey(runtimeRef.current);
          setSave((current) => ({
            ...current,
            navMemory: recordExploreResult(current.navMemory, "success", cellKey),
            memory: recordLifeMemory(
              current.memory,
              {
                type: "recovery_used",
                summary: "Explored the room and learned a route",
                behavior: "explore",
              },
              { curiosity: 1 },
              { throttleMs: 60000, throttleKey: "explore" },
            ),
          }));
          runtimeRef.current = {
            ...runtimeRef.current,
            behaviorTimer: 0,
            behavior: "idle",
            expression: "calm",
            activityLabel: undefined,
          };
        } else if (runtimeRef.current.behaviorTimer <= 0 || exploreStuckAccumulator >= 3) {
          const cellKey = explorationCellKey(runtimeRef.current);
          setSave((current) => ({
            ...current,
            navMemory: recordExploreResult(current.navMemory, "failure", cellKey),
          }));
          exploreStuckAccumulator = 0;
          runtimeRef.current = {
            ...runtimeRef.current,
            behaviorTimer: 0,
            behavior: "idle",
            expression: "calm",
            activityLabel: undefined,
          };
        }
      } else {
        exploreAccumulator = 0;
        exploreStuckAccumulator = 0;
        lastExploreDistance = Number.POSITIVE_INFINITY;
      }
      const sleepTargetDistance =
        runtimeRef.current.behavior === "sleep"
          ? Math.hypot(
              runtimeRef.current.x - runtimeRef.current.targetX,
              runtimeRef.current.y - runtimeRef.current.targetY,
            )
          : Number.POSITIVE_INFINITY;
      const autonomousSleepActive =
        runtimeRef.current.behavior === "sleep" &&
        sleepTargetDistance <= INTERACTION_ARRIVAL_DISTANCE;

      if (pendingWorldInteraction) {
        if (isHighPriorityStatus(currentStatus)) {
          pendingWorldInteractionRef.current = null;
          const blockedId =
            pendingWorldInteraction.target === "furniture"
              ? pendingWorldInteraction.furniture.id
              : pendingWorldInteraction.placedItem.id;
          const blockedName =
            pendingWorldInteraction.target === "furniture"
              ? pendingWorldInteraction.furniture.name
              : pendingWorldInteraction.item.name;
          updateActiveInteraction({
            kind: "blocked",
            furnitureId: blockedId,
            furnitureName: blockedName,
            message: ui("message.agentBusy", {
              name: blockedName,
              agent: agentDisplayName(currentStatus),
            }),
            startedAt: performance.now(),
            bubbleText: ui("bubble.busy"),
          });
        } else {
          const arrived =
            pendingWorldInteraction.target === "furniture"
              ? isNearFurnitureInteractionTarget(
                  runtimeRef.current,
                  pendingWorldInteraction.furniture,
                  currentContent,
                )
              : isNearPlacedItemInteractionTarget(
                  runtimeRef.current,
                  pendingWorldInteraction.placedItem,
                  currentContent,
                );

          if (arrived) {
            recordNavLearningResult("success");
            pendingWorldInteractionRef.current = null;

            if (pendingWorldInteraction.target === "furniture") {
              if (pendingWorldInteraction.kind === "sleep") {
                startSleepInteraction(pendingWorldInteraction.furniture);
              } else if (pendingWorldInteraction.kind === "feed") {
                startFeedInteraction(
                  pendingWorldInteraction.furniture,
                  pendingWorldInteraction.preferredItemId,
                );
              } else if (pendingWorldInteraction.kind === "work") {
                startWorkInteraction(pendingWorldInteraction.furniture);
              }
            } else if (pendingWorldInteraction.kind === "brew") {
              startCoffeeMachineInteraction(pendingWorldInteraction.placedItem);
            } else if (pendingWorldInteraction.kind === "paint") {
              runtimeRef.current = {
                ...runtimeRef.current,
                behavior: "paint",
                behaviorTimer: 8,
                expression: "happy",
                facing: "front",
                activityLabel: "Painting",
              };
              setAvatar(runtimeRef.current);
              updateActiveInteraction({
                kind: "none",
                furnitureId: pendingWorldInteraction.placedItem.id,
                furnitureName: pendingWorldInteraction.item.name,
                message: ui("message.selected", { name: pendingWorldInteraction.item.name }),
                startedAt: performance.now(),
                bubbleText: ui("thought.paint"),
              });
            } else if (pendingWorldInteraction.kind === "play") {
              runtimeRef.current = {
                ...runtimeRef.current,
                behavior: "play",
                behaviorTimer: 6,
                expression: "happy",
                facing: facingTowardPlacedItem(
                  runtimeRef.current,
                  pendingWorldInteraction.placedItem,
                ),
                activityLabel: "Playing games",
              };
              setAvatar(runtimeRef.current);
              updateActiveInteraction({
                kind: "none",
                furnitureId: pendingWorldInteraction.placedItem.id,
                furnitureName: pendingWorldInteraction.item.name,
                message: ui("message.selected", { name: pendingWorldInteraction.item.name }),
                startedAt: performance.now(),
                bubbleText: ui("thought.play"),
              });
            } else if (pendingWorldInteraction.kind === "interact") {
              runtimeRef.current = {
                ...runtimeRef.current,
                behavior: "coding",
                behaviorTimer: 6,
                expression: "focused",
                activityLabel: "Coding",
              };
              setAvatar(runtimeRef.current);
              updateActiveInteraction({
                kind: "none",
                furnitureId: pendingWorldInteraction.placedItem.id,
                furnitureName: pendingWorldInteraction.item.name,
                message: ui("message.selected", {
                  name: pendingWorldInteraction.item.name,
                }),
                startedAt: performance.now(),
              });
            }
          }
        }
      }

      if (currentInteraction?.kind === "sleep") {
        if (currentInteraction.endsAt && now >= currentInteraction.endsAt) {
          sleepAccumulator = 0;
          runtimeRef.current = {
            ...runtimeRef.current,
            behavior: "idle",
            behaviorTimer: 2,
            expression: "calm",
            activityLabel: "Idle",
          };
          setAvatar(runtimeRef.current);
          updateActiveInteraction({
            ...currentInteraction,
            kind: "none",
            message: ui("message.rested", { name: currentInteraction.furnitureName }),
            bubbleText: ui("bubble.energy"),
            startedAt: now,
            endsAt: now + INTERACTION_FEEDBACK_SECONDS * 1000,
            progress: 1,
          });
        } else {
          sleepAccumulator += elapsedSeconds;

          if (sleepAccumulator >= SLEEP_RECOVERY_INTERVAL_SECONDS) {
            sleepAccumulator = 0;
            setSave((current) => ({
              ...current,
              petStats: applyPetStatEffect(current.petStats, {
                energy: SLEEP_RECOVERY_PER_TICK,
              }),
              memory: recordLifeMemory(
                current.memory,
                {
                  type: "recovery_used",
                  summary: "Rested to recover energy",
                  behavior: "sleep",
                },
                { resilience: 1 },
                { throttleMs: 60000, throttleKey: "sleep" },
              ),
            }));
          }
        }
      } else if (autonomousSleepActive) {
        sleepAccumulator += elapsedSeconds;

        if (sleepAccumulator >= SLEEP_RECOVERY_INTERVAL_SECONDS) {
          sleepAccumulator = 0;
          setSave((current) => ({
            ...current,
            petStats: applyPetStatEffect(current.petStats, {
              energy: SLEEP_RECOVERY_PER_TICK,
            }),
            memory: recordLifeMemory(
              current.memory,
              {
                type: "recovery_used",
                summary: "Rested to recover energy",
                behavior: "sleep",
              },
              { resilience: 1 },
              { throttleMs: 60000, throttleKey: "sleep" },
            ),
          }));
        }
      } else if (currentInteraction?.endsAt && now >= currentInteraction.endsAt) {
        updateActiveInteraction(null);
      } else if (
        currentInteraction &&
        !currentInteraction.endsAt &&
        currentInteraction.kind !== "none" &&
        now - currentInteraction.startedAt >= INTERACTION_FEEDBACK_SECONDS * 1000
      ) {
        updateActiveInteraction(null);
      } else {
        sleepAccumulator = 0;
      }

      if (
        runtimeRef.current.behavior === "play" &&
        (!isHighPriorityStatus(currentStatus) || busyRecoveryNeed?.behavior === "play")
      ) {
        const gameConsole = currentContent.placedItems?.find(
          (item) =>
            item.itemId === "game-console" &&
            isNearActivePlayTarget(runtimeRef.current, item, currentContent),
        );
        const nearGameConsole =
          gameConsole &&
          isNearActivePlayTarget(runtimeRef.current, gameConsole, currentContent);

        if (nearGameConsole) {
          playAccumulator += elapsedSeconds;

          if (playAccumulator >= PLAY_MOOD_RECOVERY_INTERVAL_SECONDS) {
            playAccumulator = 0;
            setSave((current) => ({
              ...current,
              petStats: applyPetStatEffect(current.petStats, {
                mood: PLAY_MOOD_RECOVERY_PER_TICK,
              }),
              memory: recordLifeMemory(
                current.memory,
                {
                  type: "recovery_used",
                  summary: "Played games to recover mood",
                  behavior: "play",
                },
                { curiosity: 1, resilience: 1 },
                { throttleMs: 60000, throttleKey: "play" },
              ),
            }));
          }
        } else {
          playAccumulator = 0;
        }
      } else {
        playAccumulator = 0;
      }

      if (runtimeRef.current.behavior === "paint" && !isHighPriorityStatus(currentStatus)) {
        const easel = currentContent.placedItems?.find(
          (item) =>
            item.itemId === EASEL_ITEM_ID &&
            isNearPlacedItemInteractionTarget(runtimeRef.current, item, currentContent),
        );

        if (
          easel &&
          isNearPlacedItemInteractionTarget(runtimeRef.current, easel, currentContent)
        ) {
          paintAccumulator += elapsedSeconds;

          if (paintAccumulator >= PAINT_RECOVERY_INTERVAL_SECONDS) {
            paintAccumulator = 0;
            setSave((current) => ({
              ...current,
              petStats: applyPetStatEffect(current.petStats, {
                mood: PAINT_MOOD_RECOVERY_PER_TICK,
              }),
              memory: recordLifeMemory(
                current.memory,
                {
                  type: "recovery_used",
                  summary: "Painted at the easel",
                  behavior: "paint",
                  itemId: EASEL_ITEM_ID,
                },
                { creativity: 1 },
                { throttleMs: 60000, throttleKey: "paint" },
              ),
            }));
          }
        } else {
          paintAccumulator = 0;
        }
      } else {
        paintAccumulator = 0;
      }

      if (
        runtimeRef.current.behavior === "snack" &&
        (!isHighPriorityStatus(currentStatus) || busyRecoveryNeed?.behavior === "snack") &&
        !isBlockingInteraction(activeInteractionRef.current) &&
        !pendingWorldInteractionRef.current
      ) {
        const targetFurnitureId =
          busyRecoveryNeed?.behavior === "snack"
            ? busyRecoveryNeed.targetFurnitureId
            : currentContent.petStats.energy < 28 &&
                (getTableCoffeeQuantity(
                  saveRef.current.furnitureStorage,
                  currentContent.placedItems,
                ) > 0 ||
                  getInventoryQuantity(currentContent.inventory, COFFEE_ITEM_ID) > 0)
              ? TABLE_FURNITURE_ID
              : "fridge";
        const targetFurniture = currentContent.room.furniture.find((item) =>
          item.id === targetFurnitureId,
        );

        if (
          targetFurniture &&
          isNearFurnitureInteractionTarget(
            runtimeRef.current,
            targetFurniture,
            currentContent,
          )
        ) {
          recordNavLearningResult("success");
          startFeedInteraction(targetFurniture);
        }
      }

      if (
        runtimeRef.current.behavior === "brew" &&
        !isHighPriorityStatus(currentStatus) &&
        currentContent.placedItems?.some((item) => item.itemId === COFFEE_MACHINE_ITEM_ID)
      ) {
        const coffeeMachine = currentContent.placedItems?.find(
          (item) =>
            item.itemId === COFFEE_MACHINE_ITEM_ID &&
            isNearPlacedItemInteractionTarget(runtimeRef.current, item, currentContent),
        );
        const coffeeMachineName =
          currentContent.itemDefinitions.find((item) => item.id === COFFEE_MACHINE_ITEM_ID)
            ?.name ?? "Coffee Machine";
        const nearCoffeeMachine =
          coffeeMachine &&
          isNearPlacedItemInteractionTarget(runtimeRef.current, coffeeMachine, currentContent);

        if (coffeeMachine && nearCoffeeMachine && activeInteractionRef.current?.kind !== "brew") {
          recordNavLearningResult("success");
          const now = performance.now();
          updateActiveInteraction({
            kind: "brew",
            furnitureId: coffeeMachine.id,
            furnitureName: coffeeMachineName,
            message: ui("message.coffeeBrewedLater", { name: coffeeMachineName }),
            startedAt: now,
            endsAt: now + COFFEE_AUTONOMOUS_INTERVAL_SECONDS * 1000,
            bubbleText: ui("thought.brew"),
            progress: 0,
          });
        }

        if (nearCoffeeMachine) {
          coffeeAccumulator += elapsedSeconds;
        } else {
          coffeeAccumulator = 0;
        }

        if (nearCoffeeMachine && coffeeAccumulator >= COFFEE_AUTONOMOUS_INTERVAL_SECONDS) {
          coffeeAccumulator = 0;
          if (currentContent.wallet.bits < COFFEE_BREW_BIT_COST) {
            updateActiveInteraction({
              kind: "blocked",
              furnitureId: coffeeMachine?.id ?? COFFEE_MACHINE_ITEM_ID,
              furnitureName: coffeeMachineName,
              message: ui("message.notEnoughBits", {
                name: coffeeMachineName,
                bits: COFFEE_BREW_BIT_COST,
              }),
              startedAt: performance.now(),
              bubbleText: ui("bubble.bits"),
            });
            return;
          }
          setSave((current) => {
            const coffeeCount = getInventoryQuantity(current.inventory, COFFEE_ITEM_ID);
            const tableCoffeeCapacity = getTableCoffeeCapacity(current.placedItems);
            const tableCoffeeCount = getTableCoffeeQuantity(
              current.furnitureStorage,
              current.placedItems,
            );
            if (tableCoffeeCount >= tableCoffeeCapacity && coffeeCount >= COFFEE_MAX_QUANTITY) {
              return current;
            }
            if (current.wallet.bits < COFFEE_BREW_BIT_COST) {
              return current;
            }

            if (tableCoffeeCount < tableCoffeeCapacity) {
              return {
                ...current,
                wallet: { bits: current.wallet.bits - COFFEE_BREW_BIT_COST },
                furnitureStorage: addFurnitureStorageItem(
                  current.furnitureStorage,
                  TABLE_FURNITURE_ID,
                  COFFEE_ITEM_ID,
                  1,
                  tableCoffeeCapacity,
                ),
                memory: recordLifeMemory(
                  current.memory,
                  {
                    type: "recovery_used",
                    summary: "Brewed Coffee for later",
                    behavior: "brew",
                    itemId: COFFEE_ITEM_ID,
                  },
                  { efficiency: 1 },
                ),
              };
            }

            return {
              ...current,
              wallet: { bits: current.wallet.bits - COFFEE_BREW_BIT_COST },
              inventory: addInventoryItem(
                current.inventory,
                COFFEE_ITEM_ID,
                1,
                COFFEE_MAX_QUANTITY,
              ),
              memory: recordLifeMemory(
                current.memory,
                {
                  type: "recovery_used",
                  summary: "Brewed Coffee for later",
                  behavior: "brew",
                  itemId: COFFEE_ITEM_ID,
                },
                { efficiency: 1 },
              ),
            };
          });
          const now = performance.now();
          updateActiveInteraction({
            kind: "brew",
            furnitureId: coffeeMachine?.id ?? COFFEE_MACHINE_ITEM_ID,
            furnitureName: coffeeMachineName,
            message: ui("message.coffeeBrewedLater", { name: coffeeMachineName }),
            startedAt: now,
            endsAt: now + INTERACTION_FEEDBACK_SECONDS * 1000,
            bubbleText: ui("thought.brew"),
          });
        }
      } else {
        coffeeAccumulator = 0;
      }

      if (uiAccumulator >= 0.2) {
        uiAccumulator = 0;
        setNowMs(Date.now());
        setAvatar(runtimeRef.current);
      }

      if (statAccumulator >= 2) {
        const elapsedStats = statAccumulator;
        statAccumulator = 0;
        setSave((current) => ({
          ...current,
          petStats: applyPetTick(current.petStats, elapsedStats),
        }));
      }

      if (canvasRef.current) {
        renderScene(
          canvasRef.current,
          currentContent,
          runtimeRef.current,
          currentStatus,
          frame,
          hoveredFurnitureRef.current?.id,
          selectedFurnitureRef.current?.id,
          activeInteractionRef.current,
          placementPreviewRef.current && placingItemRef.current
            ? { item: placingItemRef.current, ...placementPreviewRef.current }
            : placementPreviewRef.current && movingPlacedItemRef.current
              ? {
                  item:
                    currentContent.itemDefinitions.find(
                      (item) => item.id === movingPlacedItemRef.current?.itemId,
                    ) ?? currentContent.itemDefinitions[0],
                  ...placementPreviewRef.current,
                }
            : null,
          selectedPlacedItemRef.current?.id,
          selectedWindowRef.current?.id,
          windowPlacementPreviewRef.current && movingWindowRef.current
            ? {
                window: movingWindowRef.current,
                ...windowPlacementPreviewRef.current,
              }
            : null,
            furniturePlacementPreviewRef.current && movingFurnitureRef.current
              ? {
                  furniture: movingFurnitureRef.current,
                  ...furniturePlacementPreviewRef.current,
                }
              : null,
            tableCoffeeStorage.quantity,
            saveRef.current.memory,
            getWindowTimeMs(frame),
            taskCabinetEntriesRef.current.filter(
              (entry) => entry.status === "ready" || entry.status === "failed",
            ).length,
            taskCabinetEntriesRef.current.filter(
              (entry) => entry.status === "failed",
            ).length,
          );
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);

    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    const sessionKey = statusSessionKey(effectiveStatus);
    const previousStatus = previousSessionStatusRef.current.get(sessionKey);
    previousSessionStatusRef.current.set(sessionKey, effectiveStatus.status);

    if (
      effectiveStatus.agent === "codex" &&
      (effectiveStatus.status === "error" ||
        effectiveStatus.status === "waiting_for_user")
    ) {
      setSave((current) => ({
        ...current,
        memory: recordStatusMemory(current.memory, effectiveStatus),
      }));
    }

    if (effectiveStatus.status !== "complete") return;
    if (effectiveStatus.agent !== "codex") return;
    const completedAt = Date.parse(effectiveStatus.timestamp);
    const freshComplete =
      !Number.isNaN(completedAt) &&
      Date.now() - completedAt <= COMPLETE_REWARD_FRESH_MS;
    const followedSession =
      sessionKey === activeSessionKey || sessionKey === connectedSessionKey;
    const activeTransition =
      previousStatus && isRewardEligiblePreviousStatus(previousStatus);
    if (!activeTransition && !(freshComplete && followedSession)) return;

    const completeKey = [
      effectiveStatus.agent,
      effectiveStatus.sessionId ?? "default",
      effectiveStatus.timestamp,
    ].join(":");
    if (lastRewardedCompleteKeyRef.current === completeKey) return;
    lastRewardedCompleteKeyRef.current = completeKey;

    const rewardBits =
      rewardBitsForUsage(effectiveStatus.usage) +
      (getWorkBoostRemainingSeconds(save.workBoostUntil, Date.now()) > 0
        ? WORK_BOOST_COMPLETE_BONUS
        : 0);

    setSave((current) => ({
      ...current,
      wallet: { bits: current.wallet.bits + rewardBits },
      memory: recordTaskCompleteMemory(
        current.memory,
        effectiveStatus,
        previousStatus,
        rewardBits,
      ),
    }));
    const now = performance.now();
    updateActiveInteraction({
      kind: "none",
      furnitureId: "codex",
      furnitureName: "Codex",
      message: ui("message.codexComplete", {
        bits: rewardBits,
        boost: rewardBits > 4 ? ui("message.withBoost") : "",
      }),
      startedAt: now,
      endsAt: now + REWARD_BUBBLE_SECONDS * 1000,
      bubbleText: `+${rewardBits} ${ui("currency.bits")}`,
      rewardBits,
    });
  }, [
    activeSessionKey,
    connectedSessionKey,
    effectiveStatus.agent,
    effectiveStatus.sessionId,
    effectiveStatus.timestamp,
    effectiveStatus.status,
    locale,
    save.workBoostUntil,
  ]);

  const inventoryItems = save.inventory
    .filter((entry) => {
      const item =
        content.itemDefinitions.find((candidate) => candidate.id === entry.itemId) ??
        content.shop.items.find((candidate) => candidate.id === entry.itemId);
      return item ? !isSurfaceItem(item) : true;
    })
    .map((entry) => ({
      ...entry,
      item:
        content.itemDefinitions.find((item) => item.id === entry.itemId) ??
        content.shop.items.find((item) => item.id === entry.itemId),
    }))
    .filter((entry): entry is InventoryEntry & { item: ItemDefinition } =>
      Boolean(entry.item),
    );

  const applyItem = (item: ItemDefinition) => {
    if (item.tags?.includes("wall-surface")) {
      const wallSurface = contentRef.current.room.wallSurfaces?.find(
        (candidate) => candidate.id === item.id,
      );
      if (!wallSurface) return;

      setSave((current) => ({
        ...current,
        wallSurfaceId: wallSurface.id,
      }));
      updateActiveInteraction({
        kind: "none",
        furnitureId: "wall-surface",
        furnitureName: wallSurface.name,
        message: ui("message.windowApplied", { name: wallSurface.name }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.wall"),
      });
      return;
    }

    if (item.tags?.includes("floor-surface")) {
      const floorSurface = contentRef.current.room.floorSurfaces?.find(
        (candidate) => candidate.id === item.id,
      );
      if (!floorSurface) return;

      setSave((current) => ({
        ...current,
        floorSurfaceId: floorSurface.id,
      }));
      updateActiveInteraction({
        kind: "none",
        furnitureId: "floor-surface",
        furnitureName: floorSurface.name,
        message: ui("message.windowApplied", { name: floorSurface.name }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.floor"),
      });
      return;
    }

    if (item.kind === "window") {
      const windowDefinition = contentRef.current.room.windows?.find(
        (candidate) => candidate.id === item.id,
      );

      if (!windowDefinition) {
        updateActiveInteraction({
          kind: "blocked",
          furnitureId: "window",
          furnitureName: item.name,
          message: ui("message.windowMissing", { name: item.name }),
          startedAt: performance.now(),
          bubbleText: ui("bubble.missing"),
        });
        return;
      }

      setSave((current) => ({
        ...current,
        activeWindowId: windowDefinition.id,
        windowPlacements: current.windowPlacements?.some(
          (placement) => placement.windowId === windowDefinition.id,
        )
          ? current.windowPlacements
          : [
              ...(current.windowPlacements ?? []),
              {
                windowId: windowDefinition.id,
                x: windowDefinition.x,
                y: windowDefinition.y,
                width: windowDefinition.width,
                height: windowDefinition.height,
              },
            ],
      }));
      updateSelectedWindow(windowDefinition);
      updateSelectedPlacedItem(null);
      updateMovingPlacedItem(null);
      updateActiveInteraction({
        kind: "none",
        furnitureId: "window",
        furnitureName: windowDefinition.name,
        message: ui("message.windowApplied", { name: windowDefinition.name }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.window"),
      });
      return;
    }

    if (item.kind === "decor" || item.kind === "furniture") {
      updatePlacingItem(item);
      updateSelectedPlacedItem(null);
      updateMovingPlacedItem(null);
      updateSelectedWindow(null);
      updateMovingWindow(null);
      updateWindowPlacementPreview(null);
      updateActiveInteraction({
        kind: "none",
        furnitureId: "placement",
        furnitureName: item.name,
        message: ui("message.placing", {
          name: item.name,
          nameTarget: placementTargetLabel(locale, item),
        }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.place"),
      });
      return;
    }

    const highPriorityStatus = isHighPriorityStatus(effectiveStatus);

    if (item.id === COFFEE_ITEM_ID) {
      const table = contentRef.current.room.furniture.find(
        (furniture) => furniture.id === TABLE_FURNITURE_ID,
      );

      if (!table) {
        updateActiveInteraction({
          kind: "feed",
          furnitureId: TABLE_FURNITURE_ID,
          furnitureName: item.name,
          message: ui("message.noFood", { name: item.name }),
          startedAt: performance.now(),
          bubbleText: ui("thought.noFood"),
        });
        return;
      }

      if (highPriorityStatus) {
        updateActiveInteraction({
          kind: "blocked",
          furnitureId: table.id,
          furnitureName: table.name,
          message: ui("message.agentBusy", {
            name: item.name,
            agent: agentDisplayName(effectiveStatus),
          }),
          startedAt: performance.now(),
          bubbleText: ui("bubble.busy"),
        });
        return;
      }

      queueFurnitureInteraction(table, "feed", COFFEE_ITEM_ID);
      return;
    }

    const targetFurniture =
      item.kind === "food"
        ? contentRef.current.room.furniture.find((furniture) => furniture.id === "fridge") ??
          contentRef.current.room.furniture.find((furniture) => furniture.id === TABLE_FURNITURE_ID)
        : contentRef.current.room.furniture.find(
            (furniture) => furniture.id === TABLE_FURNITURE_ID,
          );

    if (!targetFurniture) {
      updateActiveInteraction({
        kind: "feed",
        furnitureId: "consumable",
        furnitureName: item.name,
        message: ui("message.noFood", { name: item.name }),
        startedAt: performance.now(),
        bubbleText: ui("thought.noFood"),
      });
      return;
    }

    if (highPriorityStatus) {
      updateActiveInteraction({
        kind: "blocked",
        furnitureId: targetFurniture.id,
        furnitureName: targetFurniture.name,
        message: ui("message.agentBusy", {
          name: item.name,
          agent: agentDisplayName(effectiveStatus),
        }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.busy"),
      });
      return;
    }

    queueFurnitureInteraction(targetFurniture, "feed", item.id);
  };

  const setDebugStatusName = (statusName: CodexStatusName) => {
    setDebugStatus(createDebugStatus(statusName, locale));
  };

  const clearDebugStatus = () => {
    setDebugStatus(null);
  };

  const addTaskCabinetEntry = () => {
    const path = taskCabinetPathInput.trim();
    if (!path) {
      setTaskCabinetMessage("Add a .md file path first.");
      return;
    }
    if (!path.toLowerCase().endsWith(".md")) {
      setTaskCabinetMessage("Task Cabinet only accepts .md file paths.");
      return;
    }
    if (
      taskCabinetEntries.some(
        (entry) => entry.path.toLowerCase() === path.toLowerCase(),
      )
    ) {
      setTaskCabinetMessage("That task file is already in the cabinet.");
      return;
    }

    const now = new Date().toISOString();
    let added = false;
    setTaskCabinetEntries((current) => {
      if (current.length >= TASK_CABINET_ENTRY_LIMIT) {
        return current;
      }
      added = true;
      return [
        {
          id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          path,
          status: "ready",
          createdAt: now,
          updatedAt: now,
          runProfile: "default",
        },
        ...current,
      ];
    });
    if (added) {
      setTaskCabinetPathInput("");
      setTaskCabinetMessage("Task path saved locally.");
    } else {
      setTaskCabinetMessage(
        `Task Cabinet is limited to ${TASK_CABINET_ENTRY_LIMIT} tasks.`,
      );
    }
  };

  const browseTaskCabinetPath = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("pick_markdown_task_file");
      if (path) {
        setTaskCabinetPathInput(path);
        setTaskCabinetMessage("Task file selected.");
      }
    } catch {
      setTaskCabinetMessage("File picker is desktop-only.");
    }
  };

  const removeTaskCabinetEntry = (taskId: string) => {
    setTaskCabinetEntries((current) =>
      current.filter((entry) => entry.id !== taskId),
    );
    setTaskCabinetMessage("Task removed from Aivatar only.");
  };

  const setTaskCabinetRunProfile = (
    taskId: string,
    runProfile: TaskCabinetRunProfile,
  ) => {
    setTaskCabinetEntries((current) =>
      current.map((entry) =>
        entry.id === taskId
          ? {
              ...entry,
              runProfile,
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    );
  };

  const updateTaskCabinetSchedule = (
    taskId: string,
    updater: (
      schedule: TaskCabinetSchedule | undefined,
    ) => TaskCabinetSchedule | undefined,
  ) => {
    setTaskCabinetEntries((current) =>
      current.map((entry) => {
        if (entry.id !== taskId) return entry;
        const schedule = updater(entry.schedule);
        return {
          ...entry,
          schedule,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  };

  const setTaskCabinetScheduleEnabled = (taskId: string, enabled: boolean) => {
    updateTaskCabinetSchedule(taskId, (schedule) => {
      const nextSchedule: TaskCabinetSchedule = {
        enabled,
        mode: schedule?.mode ?? "once",
        runAt: schedule?.runAt,
        intervalMinutes:
          schedule?.intervalMinutes ?? TASK_CABINET_DEFAULT_REPEAT_MINUTES,
        condition: schedule?.condition ?? "always",
        nextRunAt: schedule?.nextRunAt,
        lastRunAt: schedule?.lastRunAt,
      };
      if (enabled) {
        nextSchedule.nextRunAt =
          calculateTaskScheduleNextRunAt(nextSchedule) ??
          new Date().toISOString();
      }
      return nextSchedule;
    });
  };

  const setTaskCabinetScheduleMode = (
    taskId: string,
    mode: TaskCabinetScheduleMode,
  ) => {
    updateTaskCabinetSchedule(taskId, (schedule) => {
      const nextSchedule: TaskCabinetSchedule = {
        enabled: schedule?.enabled ?? false,
        mode,
        runAt: schedule?.runAt,
        intervalMinutes:
          schedule?.intervalMinutes ?? TASK_CABINET_DEFAULT_REPEAT_MINUTES,
        condition: schedule?.condition ?? "always",
        lastRunAt: schedule?.lastRunAt,
      };
      nextSchedule.nextRunAt = calculateTaskScheduleNextRunAt(nextSchedule);
      return nextSchedule;
    });
  };

  const setTaskCabinetScheduleRunAt = (taskId: string, runAt: string) => {
    updateTaskCabinetSchedule(taskId, (schedule) => {
      const nextSchedule: TaskCabinetSchedule = {
        enabled: schedule?.enabled ?? false,
        mode: schedule?.mode ?? "once",
        runAt,
        intervalMinutes:
          schedule?.intervalMinutes ?? TASK_CABINET_DEFAULT_REPEAT_MINUTES,
        condition: schedule?.condition ?? "always",
        lastRunAt: schedule?.lastRunAt,
      };
      nextSchedule.nextRunAt = calculateTaskScheduleNextRunAt(nextSchedule);
      return nextSchedule;
    });
  };

  const setTaskCabinetScheduleInterval = (
    taskId: string,
    intervalMinutes: number,
  ) => {
    updateTaskCabinetSchedule(taskId, (schedule) => {
      const nextSchedule: TaskCabinetSchedule = {
        enabled: schedule?.enabled ?? false,
        mode: schedule?.mode ?? "repeat",
        runAt: schedule?.runAt,
        intervalMinutes: normalizeTaskCabinetIntervalMinutes(intervalMinutes),
        condition: schedule?.condition ?? "always",
        lastRunAt: schedule?.lastRunAt,
      };
      nextSchedule.nextRunAt = calculateTaskScheduleNextRunAt(nextSchedule);
      return nextSchedule;
    });
  };

  const setTaskCabinetScheduleCondition = (
    taskId: string,
    condition: TaskCabinetScheduleCondition,
  ) => {
    updateTaskCabinetSchedule(taskId, (schedule) => ({
      enabled: schedule?.enabled ?? false,
      mode: schedule?.mode ?? "once",
      runAt: schedule?.runAt,
      intervalMinutes:
        schedule?.intervalMinutes ?? TASK_CABINET_DEFAULT_REPEAT_MINUTES,
      condition,
      nextRunAt: schedule?.nextRunAt,
      lastRunAt: schedule?.lastRunAt,
    }));
  };

  const createTaskCabinetSessionId = (agent: LauncherAgentId, taskId: string) =>
    `task-${agent}-${Date.now().toString(36)}-${taskId.slice(0, 8)}`;

  const nextReadyTaskCabinetEntry = (entries: TaskCabinetEntry[]) =>
    [...entries]
      .filter((entry) => entry.status === "ready")
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt),
      )[0] ?? null;

  const startTaskCabinetEntry = async (
    taskId: string,
    options: { scheduled?: boolean } = {},
  ) => {
    if (taskCabinetLaunchingRef.current) return;
    const task = taskCabinetEntriesRef.current.find((entry) => entry.id === taskId);
    const runnableStatuses: TaskCabinetStatus[] = options.scheduled
      ? ["ready", "failed", "completed"]
      : ["ready", "failed"];
    if (!task || !runnableStatuses.includes(task.status)) return;

    const cwd = launcherDirectory.trim();
    if (!cwd) {
      const message = options.scheduled
        ? "Schedule is due, but CLI Launcher folder is missing."
        : "Set a CLI Launcher folder before running tasks.";
      setTaskCabinetMessage(message);
      if (options.scheduled) {
        setTaskCabinetEntries((current) =>
          current.map((entry) =>
            entry.id === task.id
              ? {
                  ...entry,
                  updatedAt: new Date().toISOString(),
                  error: message,
                }
              : entry,
          ),
        );
      }
      return;
    }

    taskCabinetLaunchingRef.current = true;
    const now = new Date().toISOString();
    const sessionId = createTaskCabinetSessionId(launcherAgent, task.id);
    setTaskCabinetEntries((current) =>
      current.map((entry) =>
        entry.id === task.id
          ? {
              ...entry,
              status: "running",
              agent: launcherAgent,
              cwd,
              sessionId,
              startedAt: now,
              updatedAt: now,
              finishedAt: undefined,
              error: undefined,
            }
          : entry,
      ),
    );
    setTaskCabinetMessage(`Starting ${taskCabinetFileName(task.path)}.`);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const taskArgs = launcherArgs.trim();
      let launchArgs = taskArgs || null;
      if (task.runProfile === "fast" && launcherAgent === "claude-code") {
        launchArgs = taskArgs ? `${taskArgs} --bare` : "--bare";
      }
      if (task.runProfile === "fast" && launcherAgent === "codex") {
        setTaskCabinetMessage(
          "Starting task. Codex fast profile is pending a verified MCP-skip flag.",
        );
      }
      const result = await invoke<{ message?: string; session_id?: string }>(
        "start_task_agent",
        {
          request: {
            agent: launcherAgent,
            cwd,
            args: launchArgs,
            task_path: task.path,
            session_id: sessionId,
          },
        },
      );
      setTaskCabinetMessage(result.message ?? "Task started.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      setTaskCabinetEntries((current) =>
        current.map((entry) =>
          entry.id === task.id
            ? {
                ...entry,
                status: "failed",
                updatedAt: failedAt,
                finishedAt: failedAt,
                error: detail,
              }
            : entry,
        ),
      );
      setTaskCabinetMessage(detail || "Could not start task.");
    } finally {
      taskCabinetLaunchingRef.current = false;
    }
  };

  const runNextTaskCabinetEntry = () => {
    if (taskCabinetEntriesRef.current.some((entry) => entry.status === "running")) {
      setTaskCabinetMessage("A task is already running.");
      return;
    }
    const nextTask = nextReadyTaskCabinetEntry(taskCabinetEntriesRef.current);
    if (!nextTask) {
      setTaskCabinetMessage("No Ready tasks.");
      return;
    }
    void startTaskCabinetEntry(nextTask.id);
  };

  useEffect(() => {
    const taskStatuses = new Map(
      sessions
        .filter((session) => session.agent && session.sessionId)
        .map((session) => [
          `${session.agent}:${session.sessionId}`,
          session.status,
        ]),
    );
    if (taskStatuses.size === 0) return;

    setTaskCabinetEntries((current) => {
      let changed = false;
      const finishedAt = new Date().toISOString();
      const next = current.map((entry) => {
        if (
          entry.status !== "running" ||
          !entry.agent ||
          !entry.sessionId
        ) {
          return entry;
        }

        const sessionStatus = taskStatuses.get(`${entry.agent}:${entry.sessionId}`);
        if (sessionStatus === "complete") {
          changed = true;
          const schedule = entry.schedule
            ? {
                ...entry.schedule,
                enabled:
                  entry.schedule.mode === "repeat"
                    ? entry.schedule.enabled
                    : false,
                lastRunAt: finishedAt,
                nextRunAt:
                  entry.schedule.mode === "repeat"
                    ? calculateTaskScheduleNextRunAt(
                        entry.schedule,
                        Date.parse(finishedAt),
                      )
                    : undefined,
              }
            : undefined;
          return {
            ...entry,
            status: "completed" as const,
            updatedAt: finishedAt,
            finishedAt,
            error: undefined,
            schedule,
          };
        }
        if (sessionStatus === "error") {
          changed = true;
          const schedule = entry.schedule
            ? {
                ...entry.schedule,
                enabled:
                  entry.schedule.mode === "repeat"
                    ? entry.schedule.enabled
                    : false,
                lastRunAt: finishedAt,
                nextRunAt:
                  entry.schedule.mode === "repeat"
                    ? calculateTaskScheduleNextRunAt(
                        entry.schedule,
                        Date.parse(finishedAt),
                      )
                    : undefined,
              }
            : undefined;
          return {
            ...entry,
            status: "failed" as const,
            updatedAt: finishedAt,
            finishedAt,
            error: "Agent reported an error.",
            schedule,
          };
        }
        if (sessionStatus === "idle") {
          changed = true;
          const schedule = entry.schedule
            ? {
                ...entry.schedule,
                enabled:
                  entry.schedule.mode === "repeat"
                    ? entry.schedule.enabled
                    : false,
                lastRunAt: finishedAt,
                nextRunAt:
                  entry.schedule.mode === "repeat"
                    ? calculateTaskScheduleNextRunAt(
                        entry.schedule,
                        Date.parse(finishedAt),
                      )
                    : undefined,
              }
            : undefined;
          return {
            ...entry,
            status: "failed" as const,
            updatedAt: finishedAt,
            finishedAt,
            error: "Agent exited before reporting completion.",
            schedule,
          };
        }

        return entry;
      });

      return changed ? next : current;
    });
  }, [sessions]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (taskCabinetLaunchingRef.current) return;
      const entries = taskCabinetEntriesRef.current;
      const hasRunningTask = entries.some((entry) => entry.status === "running");
      if (hasRunningTask) return;

      const now = Date.now();
      const scheduledTask =
        [...entries]
          .filter((entry) => hasTaskScheduleDue(entry, now))
          .filter((entry) => taskScheduleConditionMet(entry, hasRunningTask))
          .sort((left, right) => {
            const leftTime = Date.parse(left.schedule?.nextRunAt ?? "");
            const rightTime = Date.parse(right.schedule?.nextRunAt ?? "");
            return (
              (Number.isNaN(leftTime) ? now : leftTime) -
              (Number.isNaN(rightTime) ? now : rightTime)
            );
          })[0] ?? null;

      if (scheduledTask) {
        void startTaskCabinetEntry(scheduledTask.id, { scheduled: true });
      }
    }, TASK_CABINET_SCHEDULE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [launcherAgent, launcherArgs, launcherDirectory]);

  const stopBehaviorDemo = () => {
    if (behaviorDemoTimerRef.current === null) return;
    window.clearInterval(behaviorDemoTimerRef.current);
    behaviorDemoTimerRef.current = null;
  };

  const startBehaviorDemo = () => {
    stopBehaviorDemo();
    setDebugStatus(createDebugStatus("idle", locale));
    const demoBehaviors = isTaskCabinetPlaced(contentRef.current)
      ? DEMO_BEHAVIORS
      : DEMO_BEHAVIORS.filter(
          (behavior) =>
            behavior !== "fetch_task_file" &&
            behavior !== "carry_task_file" &&
            behavior !== "read_task_file",
        );

    let index = 0;
    const showNextBehavior = () => {
      const behavior = demoBehaviors[index];
      runtimeRef.current = setBehavior(
        runtimeRef.current,
        behavior,
        contentRef.current,
        BEHAVIOR_DEMO_SECONDS + 0.8,
        `Demo: ${behavior}`,
      );
      setAvatar(runtimeRef.current);
      const now = performance.now();
      updateActiveInteraction({
        kind: "none",
        furnitureId: "behavior-demo",
        furnitureName: ui("debug.demoActions"),
        message: `Demo: ${behavior}`,
        startedAt: now,
        endsAt: now + BEHAVIOR_DEMO_SECONDS * 1000,
        bubbleText: `Demo: ${behavior}`,
      });

      index += 1;
      if (index >= demoBehaviors.length) {
        stopBehaviorDemo();
      }
    };

    showNextBehavior();
    behaviorDemoTimerRef.current = window.setInterval(
      showNextBehavior,
      BEHAVIOR_DEMO_SECONDS * 1000,
    );
  };

  const trainGrowthTrait = (trait: keyof AivatarGrowthTraits) => {
    const label = ui(`growth.trait.${trait}`);
    setSave((current) => ({
      ...current,
      memory: recordTraitTrainingMemory(current.memory, trait),
    }));
    const now = performance.now();
    updateActiveInteraction({
      kind: "none",
      furnitureId: "growth",
      furnitureName: ui("growth.title"),
      message: `${label} +8`,
      startedAt: now,
      endsAt: now + INTERACTION_FEEDBACK_SECONDS * 1000,
      bubbleText: `${label} +8`,
    });
  };

  const addIdleBubblePhrase = (phrase: string) => {
    const normalizedPhrase = normalizeIdleBubblePhrase(phrase);
    if (!normalizedPhrase) return;

    setSave((current) => {
      const currentMemory = normalizeMemory(current.memory);
      const phrases = currentMemory.preferences.idleBubblePhrases ?? [];
      const slotCount = Math.max(1, currentMemory.growth.level);
      if (phrases.includes(normalizedPhrase) || phrases.length >= slotCount) {
        return current;
      }

      return {
        ...current,
        memory: {
          ...currentMemory,
          preferences: {
            ...currentMemory.preferences,
            idleBubblePhrases: [...phrases, normalizedPhrase].slice(0, slotCount),
          },
        },
      };
    });
  };

  const removeIdleBubblePhrase = (phrase: string) => {
    setSave((current) => {
      const currentMemory = normalizeMemory(current.memory);
      const phrases = currentMemory.preferences.idleBubblePhrases ?? [];

      return {
        ...current,
        memory: {
          ...currentMemory,
          preferences: {
            ...currentMemory.preferences,
            idleBubblePhrases: phrases.filter((candidate) => candidate !== phrase),
          },
        },
      };
    });
  };

  const updateIdleBubbleLanguagePreference = (
    preference: IdleBubbleLanguagePreference,
  ) => {
    setSave((current) => {
      const currentMemory = normalizeMemory(current.memory);

      return {
        ...current,
        memory: {
          ...currentMemory,
          preferences: {
            ...currentMemory.preferences,
            idleBubbleLanguage: preference,
          },
        },
      };
    });
  };

  const addTestSupplies = () => {
    setSave((current) => ({
      ...current,
      wallet: { bits: current.wallet.bits + 500 },
      inventory: addInventoryItem(
        addInventoryItem(
          addInventoryItem(current.inventory, COFFEE_ITEM_ID, 6, 24),
          "bento",
          6,
          24,
        ),
        "cola",
        6,
        24,
      ),
      furnitureStorage: addFurnitureStorageItem(
        current.furnitureStorage,
        TABLE_FURNITURE_ID,
        COFFEE_ITEM_ID,
        getTableCoffeeCapacity(current.placedItems),
        getTableCoffeeCapacity(current.placedItems),
      ),
    }));
    updateActiveInteraction({
      kind: "none",
      furnitureId: "debug",
      furnitureName: ui("debug.title"),
      message: ui("message.testSuppliesAdded"),
      startedAt: performance.now(),
      bubbleText: ui("bubble.saved"),
    });
  };

  const clearSaveState = () => {
    const freshSave = saveFromContent(contentBase);
    localStorage.removeItem(SAVE_KEY);
    hadSavedStateRef.current = false;
    selectedFurnitureRef.current = null;
    setSelectedFurniture(null);
    updatePlacingItem(null);
    updatePlacementPreview(null);
    updateSelectedPlacedItem(null);
    updateMovingPlacedItem(null);
    updateSelectedWindow(null);
    updateMovingWindow(null);
    updateWindowPlacementPreview(null);
    updateMovingFurniture(null);
    updateFurniturePlacementPreview(null);
    clearPendingFurnitureInteraction();
    updateActiveInteraction(null);
    runtimeRef.current = initialAvatarRuntime();
    setAvatar(runtimeRef.current);
    setSave(freshSave);
  };

  const saveCurrentLayoutAsDefault = () => {
    const layout: DefaultLayoutState = {
      placedItems: save.placedItems,
      activeWindowId: save.activeWindowId,
      windowPlacements: save.windowPlacements,
      furniturePlacements: save.furniturePlacements,
    };

    localStorage.setItem(DEFAULT_LAYOUT_KEY, JSON.stringify(layout));
    updateActiveInteraction({
      kind: "none",
      furnitureId: "room-edit",
      furnitureName: ui("roomEdit.title"),
      message: ui("message.layoutSaved"),
      startedAt: performance.now(),
      bubbleText: ui("bubble.saved"),
    });
  };

  const updateAvatarName = (name: string) => {
    setSave((current) => ({
      ...current,
      avatarName: name,
    }));
  };

  const updateHoveredFurniture = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scenePoint = canvasPointToScene(canvas, event.clientX, event.clientY);
    const furniture = scenePoint
      ? findFurnitureAt(contentRef.current, scenePoint.x, scenePoint.y)
      : null;
    const placing = placingItemRef.current;
    const moving = movingPlacedItemRef.current;
    const movingWindowDefinition = movingWindowRef.current;
    const movingFurnitureDefinition = movingFurnitureRef.current;

    if (scenePoint) {
      if (placing || moving) {
        const itemId = placing?.id ?? moving?.itemId;
        const normalizedPoint = itemId
          ? normalizePlacedItemPoint(
              contentRef.current,
              itemId,
              scenePoint.x,
              scenePoint.y,
            )
          : { x: Math.round(scenePoint.x), y: Math.round(scenePoint.y) };
        updatePlacementPreview({
          ...normalizedPoint,
          valid: itemId
            ? isPlacedItemPlacementValid(
                contentRef.current,
                itemId,
                scenePoint.x,
                scenePoint.y,
                moving?.id,
              )
            : false,
        });
      }

      if (movingWindowDefinition) {
        const topLeft = windowTopLeftFromPoint(
          movingWindowDefinition,
          scenePoint.x,
          scenePoint.y,
        );
        updateWindowPlacementPreview({
          ...topLeft,
          valid: isWindowPlacementValid(
            contentRef.current,
            movingWindowDefinition,
            topLeft.x,
            topLeft.y,
          ),
        });
      }

      if (movingFurnitureDefinition) {
        const next = normalizeFurniturePlacement(
          movingFurnitureDefinition,
          Math.round(scenePoint.x - movingFurnitureDefinition.width / 2),
          Math.round(scenePoint.y - movingFurnitureDefinition.height / 2),
          contentRef.current,
        );
        updateFurniturePlacementPreview({
          ...next,
          valid: isFurniturePlacementValid(
            movingFurnitureDefinition,
            next.x,
            next.y,
            contentRef.current,
          ),
        });
      }
    }

    hoveredFurnitureRef.current =
      placing || moving || movingWindowDefinition || movingFurnitureDefinition
        ? null
        : furniture;
    setHoveredFurniture(
      placing || moving || movingWindowDefinition || movingFurnitureDefinition
        ? null
        : furniture,
    );
  };

  const clearHoveredFurniture = () => {
    hoveredFurnitureRef.current = null;
    setHoveredFurniture(null);
    updatePlacementPreview(null);
    updateWindowPlacementPreview(null);
    updateFurniturePlacementPreview(null);
  };

  const cancelPlacement = () => {
    updatePlacingItem(null);
    updateMovingPlacedItem(null);
    updateMovingWindow(null);
    updateMovingFurniture(null);
    updatePlacementPreview(null);
    updateWindowPlacementPreview(null);
    updateFurniturePlacementPreview(null);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "placement",
      furnitureName: ui("placement.title"),
      message: ui("message.placementCancelled"),
      startedAt: performance.now(),
    });
  };

  const selectedPlacedItemDefinition = selectedPlacedItem
    ? findItemDefinition(content, selectedPlacedItem.itemId)
    : null;
  const selectedPlacedItemLocked = isBuiltinTerminalPlacedItem(selectedPlacedItem);
  const selectedWindowDefinition = selectedWindow
    ? findItemDefinition(content, selectedWindow.id)
    : null;
  const selectedFurnitureSellDefinition =
    selectedFurniture?.id === TASK_CABINET_FURNITURE_ID
      ? findItemDefinition(content, TASK_CABINET_FURNITURE_ID)
      : null;

  const placeInventoryItem = (item: ItemDefinition, x: number, y: number) => {
    if (!isPlacedItemPlacementValid(contentRef.current, item.id, x, y)) {
      updateActiveInteraction({
        kind: "blocked",
        furnitureId: "placement",
        furnitureName: item.name,
        message: ui("message.chooseTarget", {
          name: item.name,
          nameTarget: placementTargetLabel(locale, item),
        }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.nope"),
      });
      return;
    }

    const placementPoint = normalizePlacedItemPoint(contentRef.current, item.id, x, y);
    const placedItem: PlacedItem = {
      id: `${item.id}-${Date.now()}`,
      itemId: item.id,
      x: placementPoint.x,
      y: placementPoint.y,
      surfaceFurnitureId: placementPoint.surfaceFurnitureId,
      surfaceOffsetX: placementPoint.surfaceOffsetX,
      surfaceOffsetY: placementPoint.surfaceOffsetY,
    };

    setSave((current) => {
      const inventory = current.inventory
        .map((entry) =>
          entry.itemId === item.id
            ? clampQuantity({ ...entry, quantity: entry.quantity - 1 })
            : entry,
        )
        .filter((entry) => entry.quantity > 0);

      const placedItems = [...current.placedItems, placedItem];

      return {
        ...current,
        inventory,
        placedItems,
        furnitureStorage: clampTableCoffeeStorage(current.furnitureStorage, placedItems),
      };
    });

    updatePlacingItem(null);
    updatePlacementPreview(null);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "placement",
      furnitureName: item.name,
      message: ui("message.itemPlaced", { name: item.name }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.placed"),
    });
  };

  const movePlacedItem = (item: PlacedItem, x: number, y: number) => {
    if (!isPlacedItemPlacementValid(contentRef.current, item.itemId, x, y, item.id)) {
      const itemDefinition = contentRef.current.itemDefinitions.find(
        (candidate) => candidate.id === item.itemId,
      );
      updateActiveInteraction({
        kind: "blocked",
        furnitureId: "placement",
        furnitureName: ui("action.move"),
        message: ui("message.chooseMoveTarget", {
          nameTarget: placementTargetLabel(locale, itemDefinition),
        }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.nope"),
      });
      return;
    }

    const placementPoint = normalizePlacedItemPoint(contentRef.current, item.itemId, x, y);
    const movedItem = {
      ...item,
      x: placementPoint.x,
      y: placementPoint.y,
      surfaceFurnitureId: placementPoint.surfaceFurnitureId,
      surfaceOffsetX: placementPoint.surfaceOffsetX,
      surfaceOffsetY: placementPoint.surfaceOffsetY,
    };

    setSave((current) => {
      const placedItems = current.placedItems.map((placedItem) =>
        placedItem.id === item.id ? movedItem : placedItem,
      );

      return {
        ...current,
        placedItems,
        furnitureStorage: clampTableCoffeeStorage(current.furnitureStorage, placedItems),
      };
    });

    updateMovingPlacedItem(null);
    updatePlacementPreview(null);
    updateSelectedPlacedItem(movedItem);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "placement",
      furnitureName: ui("action.move"),
      message: ui("message.itemMoved", {
        name: selectedPlacedItemDefinition?.name ?? ui("furniture.title"),
      }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.moved"),
    });
  };

  const startMovePlacedItem = () => {
    if (!selectedPlacedItem) return;
    updateMovingPlacedItem(selectedPlacedItem);
    updatePlacementPreview({
      x: selectedPlacedItem.x,
      y: selectedPlacedItem.y,
      valid: true,
    });
    updateActiveInteraction({
      kind: "none",
      furnitureId: "placement",
      furnitureName: ui("action.move"),
      message: ui("message.movingItem", {
        name: selectedPlacedItemDefinition?.name ?? ui("furniture.title"),
        nameTarget: placementTargetLabel(locale, selectedPlacedItemDefinition),
      }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.move"),
    });
  };

  const storePlacedItem = () => {
    if (!selectedPlacedItem) return;
    if (isBuiltinTerminalPlacedItem(selectedPlacedItem)) return;
    const itemName = selectedPlacedItemDefinition?.name ?? "Item";

    setSave((current) => {
      const existing = current.inventory.find(
        (entry) => entry.itemId === selectedPlacedItem.itemId,
      );
      const inventory = existing
        ? current.inventory.map((entry) =>
            entry.itemId === selectedPlacedItem.itemId
              ? { ...entry, quantity: entry.quantity + 1 }
              : entry,
          )
        : [...current.inventory, { itemId: selectedPlacedItem.itemId, quantity: 1 }];

      const placedItems = current.placedItems.filter(
        (item) => item.id !== selectedPlacedItem.id,
      );

      return {
        ...current,
        inventory,
        placedItems,
        furnitureStorage: clampTableCoffeeStorage(current.furnitureStorage, placedItems),
      };
    });

    updateSelectedPlacedItem(null);
    updateMovingPlacedItem(null);
    updatePlacementPreview(null);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "placement",
      furnitureName: ui("action.store"),
      message: ui("message.itemStored", { name: itemName }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.stored"),
    });
  };

  const deletePlacedItem = () => {
    if (!selectedPlacedItem) return;
    if (isBuiltinTerminalPlacedItem(selectedPlacedItem)) return;
    const itemName = selectedPlacedItemDefinition?.name ?? "Item";

    setSave((current) => {
      const placedItems = current.placedItems.filter(
        (item) => item.id !== selectedPlacedItem.id,
      );

      return {
        ...current,
        placedItems,
        furnitureStorage: clampTableCoffeeStorage(current.furnitureStorage, placedItems),
      };
    });

    updateSelectedPlacedItem(null);
    updateMovingPlacedItem(null);
    updatePlacementPreview(null);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "placement",
      furnitureName: ui("action.delete"),
      message: ui("message.itemDeleted", { name: itemName }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.deleted"),
    });
  };

  const sellPlacedItem = () => {
    if (!selectedPlacedItem) return;
    if (isBuiltinTerminalPlacedItem(selectedPlacedItem)) return;
    const itemName = selectedPlacedItemDefinition?.name ?? "Item";
    const bitsEarned = itemSellValue(selectedPlacedItemDefinition);

    setSave((current) => {
      const placedItems = current.placedItems.filter(
        (item) => item.id !== selectedPlacedItem.id,
      );

      return {
        ...current,
        wallet: { bits: current.wallet.bits + bitsEarned },
        placedItems,
        furnitureStorage: clampTableCoffeeStorage(current.furnitureStorage, placedItems),
      };
    });

    updateSelectedPlacedItem(null);
    updateMovingPlacedItem(null);
    updatePlacementPreview(null);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "placement",
      furnitureName: ui("action.sell", { value: bitsEarned }),
      message: ui("message.itemSold", { name: itemName, bits: bitsEarned }),
      startedAt: performance.now(),
      bubbleText: `+${bitsEarned}`,
    });
  };

  const sellSelectedFurniture = () => {
    if (!selectedFurniture || selectedFurniture.id !== TASK_CABINET_FURNITURE_ID) return;
    const itemDefinition = findItemDefinition(contentRef.current, TASK_CABINET_FURNITURE_ID);
    const bitsEarned = itemSellValue(itemDefinition);

    setSave((current) => ({
      ...current,
      wallet: { bits: current.wallet.bits + bitsEarned },
      placedItems: current.placedItems.filter(
        (item) => item.itemId !== TASK_CABINET_FURNITURE_ID,
      ),
    }));

    selectedFurnitureRef.current = null;
    setSelectedFurniture(null);
    updateMovingFurniture(null);
    updateFurniturePlacementPreview(null);
    clearPendingFurnitureInteraction();
    updateActiveInteraction({
      kind: "none",
      furnitureId: TASK_CABINET_FURNITURE_ID,
      furnitureName: ui("action.sell", { value: bitsEarned }),
      message: ui("message.itemSold", {
        name: itemDefinition?.name ?? selectedFurniture.name,
        bits: bitsEarned,
      }),
      startedAt: performance.now(),
      bubbleText: `+${bitsEarned}`,
    });
  };

  const rotatePlacedItem = () => {
    if (!selectedPlacedItem || selectedPlacedItemDefinition?.rotatable === false) return;
    const rotatedItem = {
      ...selectedPlacedItem,
      rotation: ((selectedPlacedItem.rotation ?? 0) + 90) % 360,
    };

    setSave((current) => ({
      ...current,
      placedItems: current.placedItems.map((item) =>
        item.id === selectedPlacedItem.id ? rotatedItem : item,
      ),
    }));

    updateSelectedPlacedItem(rotatedItem);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "placement",
      furnitureName: ui("action.rotate"),
      message: ui("message.itemRotated", {
        name: selectedPlacedItemDefinition?.name ?? ui("furniture.title"),
      }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.rotate"),
    });
  };

  const resetDefaultLayout = () => {
    const defaultLayout = loadDefaultLayout(contentBase);

    setSave((current) => ({
      ...current,
      ...defaultLayout,
    }));

    cancelRoomEdit();
    clearPendingFurnitureInteraction();
    runtimeRef.current = initialAvatarRuntime();
    setAvatar(runtimeRef.current);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "room-edit",
      furnitureName: ui("roomEdit.title"),
      message: ui("message.defaultLayoutRestored"),
      startedAt: performance.now(),
      bubbleText: ui("bubble.reset"),
    });
  };

  const cancelRoomEdit = () => {
    selectedFurnitureRef.current = null;
    setSelectedFurniture(null);
    updateSelectedPlacedItem(null);
    updateMovingPlacedItem(null);
    updateSelectedWindow(null);
    updateMovingWindow(null);
    updateMovingFurniture(null);
    updatePlacementPreview(null);
    updateWindowPlacementPreview(null);
    updateFurniturePlacementPreview(null);
  };

  const moveWindow = (windowDefinition: RoomWindowDefinition, x: number, y: number) => {
    const topLeft = windowTopLeftFromPoint(windowDefinition, x, y);

    if (!isWindowPlacementValid(contentRef.current, windowDefinition, topLeft.x, topLeft.y)) {
      updateActiveInteraction({
        kind: "blocked",
        furnitureId: "window",
        furnitureName: windowDefinition.name,
        message: ui("message.windowChooseWall", { name: windowDefinition.name }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.wall"),
      });
      return;
    }

    const movedWindow = {
      ...windowDefinition,
      ...topLeft,
    };

    setSave((current) => {
      const placement = {
        windowId: windowDefinition.id,
        x: topLeft.x,
        y: topLeft.y,
        width: windowDefinition.width,
        height: windowDefinition.height,
      };
      const existing = current.windowPlacements ?? [];

      return {
        ...current,
        activeWindowId: windowDefinition.id,
        windowPlacements: existing.some(
          (item) => item.windowId === windowDefinition.id,
        )
          ? existing.map((item) =>
              item.windowId === windowDefinition.id ? placement : item,
            )
          : [...existing, placement],
      };
    });

    updateMovingWindow(null);
    updateWindowPlacementPreview(null);
    updateSelectedWindow(movedWindow);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "window",
      furnitureName: windowDefinition.name,
      message: ui("message.windowMoved", { name: windowDefinition.name }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.moved"),
    });
  };

  const startMoveWindow = () => {
    if (!selectedWindow) return;
    updateMovingWindow(selectedWindow);
    updateSelectedPlacedItem(null);
    updateMovingPlacedItem(null);
    updateWindowPlacementPreview({
      x: selectedWindow.x,
      y: selectedWindow.y,
      valid: true,
    });
    updateActiveInteraction({
      kind: "none",
      furnitureId: "window",
      furnitureName: selectedWindow.name,
      message: ui("message.movingWindow", { name: selectedWindow.name }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.move"),
    });
  };

  const sellSelectedWindow = () => {
    if (!selectedWindow || !selectedWindowDefinition) return;
    const soldWindowId = selectedWindow.id;
    const refundBits = itemSellValue(selectedWindowDefinition);

    setSave((current) => {
      const purchasedItemIds = current.purchasedItemIds.filter(
        (id) => id !== soldWindowId,
      );
      const fallbackWindow =
        contentRef.current.room.windows?.find(
          (windowDefinition) =>
            windowDefinition.id !== soldWindowId &&
            purchasedItemIds.includes(windowDefinition.id),
        ) ??
        contentRef.current.room.windows?.find(
          (windowDefinition) => windowDefinition.id !== soldWindowId,
        ) ??
        contentRef.current.room.windows?.[0];

      return {
        ...current,
        wallet: { bits: current.wallet.bits + refundBits },
        purchasedItemIds,
        activeWindowId:
          current.activeWindowId === soldWindowId
            ? fallbackWindow?.id
            : current.activeWindowId,
        windowPlacements: current.windowPlacements?.filter(
          (placement) => placement.windowId !== soldWindowId,
        ),
      };
    });

    updateSelectedWindow(null);
    updateMovingWindow(null);
    updateWindowPlacementPreview(null);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "window",
      furnitureName: selectedWindow.name,
      message: ui("action.sell", { value: refundBits }),
      startedAt: performance.now(),
      bubbleText: `+${refundBits}`,
    });
  };

  const moveFurniture = (furniture: FurnitureDefinition, x: number, y: number) => {
    const next = normalizeFurniturePlacement(
      furniture,
      Math.round(x - furniture.width / 2),
      Math.round(y - furniture.height / 2),
      contentRef.current,
    );

    if (!isFurniturePlacementValid(furniture, next.x, next.y, contentRef.current)) {
      updateActiveInteraction({
        kind: "blocked",
        furnitureId: furniture.id,
        furnitureName: furniture.name,
        message: ui("message.furnitureChoose", {
          name: furniture.name,
          nameTarget:
            furniture.id === "computer"
              ? ui("target.desktop")
              : ui("target.floorPosition"),
        }),
        startedAt: performance.now(),
        bubbleText: furniture.id === "computer" ? ui("bubble.desk") : ui("bubble.floor"),
      });
      return;
    }

    const movedFurniture = moveFurnitureDefinition(furniture, {
      furnitureId: furniture.id,
      x: next.x,
      y: next.y,
    });

    setSave((current) => {
      if (furniture.id === TASK_CABINET_FURNITURE_ID) {
        const placedItems = current.placedItems.map((item) =>
          item.itemId === TASK_CABINET_FURNITURE_ID
            ? { ...item, x: next.x + 22, y: next.y + 58 }
            : item,
        );

        return {
          ...current,
          placedItems,
        };
      }

      const placement = {
        furnitureId: furniture.id,
        x: next.x,
        y: next.y,
      };
      const existing = current.furniturePlacements ?? [];

      return {
        ...current,
        furniturePlacements: upsertFurniturePlacements(existing, [placement]),
      };
    });

    clearPendingFurnitureInteraction();
    updateMovingFurniture(null);
    updateFurniturePlacementPreview(null);
    runtimeRef.current = {
      ...runtimeRef.current,
      behavior: "idle",
      behaviorTimer: 0,
      expression: "calm",
      activityLabel: "Furniture moved",
    };
    setAvatar(runtimeRef.current);
    selectedFurnitureRef.current = movedFurniture;
    setSelectedFurniture(movedFurniture);
    updateActiveInteraction({
      kind: "none",
      furnitureId: furniture.id,
      furnitureName: furniture.name,
      message: ui("message.furnitureMoved", { name: furniture.name }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.moved"),
    });
  };

  const startMoveFurniture = () => {
    if (!selectedFurniture) return;
    clearPendingFurnitureInteraction();
    runtimeRef.current = {
      ...runtimeRef.current,
      behavior: "idle",
      behaviorTimer: 0,
      expression: "calm",
      activityLabel: "Editing furniture",
    };
    setAvatar(runtimeRef.current);
    updateMovingFurniture(selectedFurniture);
    updateSelectedPlacedItem(null);
    updateMovingPlacedItem(null);
    updateSelectedWindow(null);
    updateMovingWindow(null);
    updateFurniturePlacementPreview({
      x: selectedFurniture.x,
      y: selectedFurniture.y,
      valid: true,
    });
    updateActiveInteraction({
      kind: "none",
      furnitureId: selectedFurniture.id,
      furnitureName: selectedFurniture.name,
      message: ui("message.movingFurniture", {
        name: selectedFurniture.name,
        nameTarget:
          selectedFurniture.id === "computer"
            ? ui("target.desktop")
            : ui("target.floorPosition"),
      }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.move"),
    });
  };

  const startSleepInteraction = (furniture: FurnitureDefinition) => {
    const now = performance.now();
    runtimeRef.current = setFurnitureBehavior(runtimeRef.current, furniture, SLEEP_INTERACTION_SECONDS, {
      content: contentRef.current,
    });
    setAvatar(runtimeRef.current);
    updateActiveInteraction({
      kind: "sleep",
      furnitureId: furniture.id,
      furnitureName: furniture.name,
      message: ui("message.sleeping", { name: furniture.name }),
      startedAt: now,
      endsAt: now + SLEEP_INTERACTION_SECONDS * 1000,
      bubbleText: ui("thought.sleep"),
      progress: 0,
    });
  };

  const startFeedInteraction = (
    furniture: FurnitureDefinition,
    preferredItemId?: string,
  ) => {
    const currentContent = contentRef.current;
    const coffeeDefinition = currentContent.itemDefinitions.find(
      (item) => item.id === COFFEE_ITEM_ID,
    );
    const tableCoffeeCount = getTableCoffeeQuantity(
      saveRef.current.furnitureStorage,
      currentContent.placedItems,
    );

    if (furniture.id === TABLE_FURNITURE_ID && coffeeDefinition && tableCoffeeCount > 0) {
      setSave((current) => ({
        ...current,
        furnitureStorage: consumeFurnitureStorageItem(
          current.furnitureStorage,
          TABLE_FURNITURE_ID,
          COFFEE_ITEM_ID,
        ),
        petStats: applyConsumableEffect(
          current.petStats,
          coffeeDefinition.effect as Partial<PetStats>,
        ),
        memory: recordLifeMemory(
          current.memory,
          {
            type: "item_used",
            summary: `Used ${coffeeDefinition.name}`,
            itemId: coffeeDefinition.id,
            behavior: "coffee",
          },
          traitChangesForConsumable(coffeeDefinition),
        ),
      }));

      runtimeRef.current = setFurnitureBehavior(runtimeRef.current, furniture, 4, {
        behavior: "coffee",
        content: contentRef.current,
      });
      setAvatar(runtimeRef.current);
      updateActiveInteraction({
        kind: "feed",
        furnitureId: furniture.id,
        furnitureName: furniture.name,
        message: ui("message.usedConsumable", {
          name: furniture.name,
          item: coffeeDefinition.name,
        }),
        startedAt: performance.now(),
        bubbleText: ui("thought.coffee"),
      });
      return;
    }

    const consumable = currentContent.inventory
      .filter((entry) => entry.quantity > 0)
      .map((entry) => ({
        entry,
        item: currentContent.itemDefinitions.find((item) => item.id === entry.itemId),
      }))
      .filter(
        (candidate): candidate is { entry: InventoryEntry; item: ItemDefinition } => {
          if (!candidate.item) return false;
          if (
            candidate.item.id === COFFEE_ITEM_ID &&
            furniture.id !== TABLE_FURNITURE_ID
          ) {
            return false;
          }
          return candidate.item.kind === "food" || candidate.item.kind === "drink";
        },
      )
      .sort((left, right) => {
        if (preferredItemId) {
          if (left.item.id === preferredItemId) return -1;
          if (right.item.id === preferredItemId) return 1;
        }
        if (furniture.id === "table") {
          if (left.item.id === COFFEE_ITEM_ID) return -1;
          if (right.item.id === COFFEE_ITEM_ID) return 1;
        }
        if (left.item.kind === right.item.kind) return 0;
        return left.item.kind === "food" ? -1 : 1;
      })[0];

    if (!consumable) {
      updateActiveInteraction({
        kind: "feed",
        furnitureId: furniture.id,
        furnitureName: furniture.name,
        message: ui("message.noFood", { name: furniture.name }),
        startedAt: performance.now(),
        bubbleText: ui("thought.noFood"),
      });
      return;
    }

    setSave((current) => {
      const inventory = current.inventory
        .map((entry) =>
          entry.itemId === consumable.item.id
            ? clampQuantity({ ...entry, quantity: entry.quantity - 1 })
            : entry,
        )
        .filter((entry) => entry.quantity > 0);

      return {
        ...current,
        inventory,
        petStats: applyConsumableEffect(
          current.petStats,
          consumable.item.effect as Partial<PetStats>,
        ),
        memory: recordLifeMemory(
          current.memory,
          {
            type: "item_used",
            summary: `Used ${consumable.item.name}`,
            itemId: consumable.item.id,
            behavior: behaviorForConsumable(consumable.item),
          },
          traitChangesForConsumable(consumable.item),
        ),
      };
    });

    runtimeRef.current = setFurnitureBehavior(runtimeRef.current, furniture, 4, {
      behavior:
        consumable.item.id === COFFEE_ITEM_ID
          ? "coffee"
          : consumable.item.id === COLA_ITEM_ID
            ? "cola"
            : consumable.item.id === BENTO_ITEM_ID
              ? "bento"
              : "interact",
      content: contentRef.current,
    });
    setAvatar(runtimeRef.current);
    updateActiveInteraction({
      kind: "feed",
      furnitureId: furniture.id,
      furnitureName: furniture.name,
      message: ui("message.usedConsumable", {
        name: furniture.name,
        item: consumable.item.name,
      }),
      startedAt: performance.now(),
      endsAt: performance.now() + INTERACTION_FEEDBACK_SECONDS * 1000,
      bubbleText:
        consumable.item.kind === "food" ? ui("thought.food") : ui("thought.drink"),
    });
  };

  const startWorkInteraction = (furniture: FurnitureDefinition) => {
    const behavior = workBehaviorForFurniture(furniture);
    const bitsEarned = furniture.id === "computer" ? 3 : 2;
    const boostUntil = new Date(Date.now() + WORK_BOOST_SECONDS * 1000).toISOString();

    setSave((current) => ({
      ...current,
      wallet: { bits: current.wallet.bits + bitsEarned },
      workBoostUntil: boostUntil,
    }));

    runtimeRef.current = setBehavior(runtimeRef.current, behavior, contentRef.current, 6);
    setAvatar(runtimeRef.current);
    const now = performance.now();
    updateActiveInteraction({
      kind: "work",
      furnitureId: furniture.id,
      furnitureName: furniture.name,
      message: ui("message.workBoost", { name: furniture.name, bits: bitsEarned }),
      startedAt: now,
      endsAt: now + INTERACTION_FEEDBACK_SECONDS * 1000,
      bubbleText: `+${bitsEarned} ${ui("currency.bits")}`,
      rewardBits: bitsEarned,
    });
  };

  const startCoffeeMachineInteraction = (placedItem: PlacedItem) => {
    const coffeeMachineName =
      contentRef.current.itemDefinitions.find(
        (item) => item.id === COFFEE_MACHINE_ITEM_ID,
      )?.name ?? "Coffee Machine";
    const coffeeCount = getInventoryQuantity(
      contentRef.current.inventory,
      COFFEE_ITEM_ID,
    );
    const tableCoffeeCapacity = getTableCoffeeCapacity(contentRef.current.placedItems);
    const tableCoffeeCount = getTableCoffeeQuantity(
      saveRef.current.furnitureStorage,
      contentRef.current.placedItems,
    );

    if (tableCoffeeCount >= tableCoffeeCapacity && coffeeCount >= COFFEE_MAX_QUANTITY) {
      updateActiveInteraction({
        kind: "none",
        furnitureId: placedItem.id,
        furnitureName: coffeeMachineName,
      message: ui("message.coffeeFull", { name: coffeeMachineName }),
      startedAt: performance.now(),
      bubbleText: ui("thought.full"),
    });
    return;
    }

    if (saveRef.current.wallet.bits < COFFEE_BREW_BIT_COST) {
      updateActiveInteraction({
        kind: "blocked",
        furnitureId: placedItem.id,
        furnitureName: coffeeMachineName,
        message: ui("message.notEnoughBits", {
          name: coffeeMachineName,
          bits: COFFEE_BREW_BIT_COST,
        }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.bits"),
      });
      return;
    }

    setSave((current) => ({
      ...current,
      wallet: { bits: current.wallet.bits - COFFEE_BREW_BIT_COST },
      furnitureStorage:
        getTableCoffeeQuantity(current.furnitureStorage, current.placedItems) <
        getTableCoffeeCapacity(current.placedItems)
          ? addFurnitureStorageItem(
              current.furnitureStorage,
              TABLE_FURNITURE_ID,
              COFFEE_ITEM_ID,
              1,
              getTableCoffeeCapacity(current.placedItems),
            )
          : current.furnitureStorage,
      inventory:
        getTableCoffeeQuantity(current.furnitureStorage, current.placedItems) <
        getTableCoffeeCapacity(current.placedItems)
          ? current.inventory
          : addInventoryItem(
              current.inventory,
              COFFEE_ITEM_ID,
              1,
              COFFEE_MAX_QUANTITY,
            ),
      memory: recordLifeMemory(
        current.memory,
        {
          type: "recovery_used",
          summary: "Brewed Coffee for later",
          behavior: "brew",
          itemId: COFFEE_ITEM_ID,
        },
        { efficiency: 1 },
      ),
    }));

    runtimeRef.current = setBehavior(
      runtimeRef.current,
      "brew",
      contentRef.current,
      COFFEE_BREW_SECONDS,
      "Brewing coffee",
    );
    setAvatar(runtimeRef.current);
    const now = performance.now();
    updateActiveInteraction({
      kind: "brew",
      furnitureId: placedItem.id,
      furnitureName: coffeeMachineName,
      message: ui("message.coffeeBrewed", { name: coffeeMachineName }),
      startedAt: now,
      endsAt: now + COFFEE_BREW_SECONDS * 1000,
      bubbleText: ui("thought.brew"),
      progress: 0,
    });
  };

  const interactWithFurniture = (event: React.MouseEvent<HTMLCanvasElement>) => {
    setSceneContextMenu(null);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scenePoint = canvasPointToScene(canvas, event.clientX, event.clientY);
    if (!scenePoint) return;

    if (placingItemRef.current) {
      clearPendingFurnitureInteraction();
      placeInventoryItem(placingItemRef.current, scenePoint.x, scenePoint.y);
      return;
    }

    if (movingPlacedItemRef.current) {
      clearPendingFurnitureInteraction();
      movePlacedItem(movingPlacedItemRef.current, scenePoint.x, scenePoint.y);
      return;
    }

    if (movingWindowRef.current) {
      clearPendingFurnitureInteraction();
      moveWindow(movingWindowRef.current, scenePoint.x, scenePoint.y);
      return;
    }

    if (movingFurnitureRef.current) {
      moveFurniture(movingFurnitureRef.current, scenePoint.x, scenePoint.y);
      return;
    }

    const placedItem = findPlacedItemAt(contentRef.current, scenePoint.x, scenePoint.y);
    if (placedItem) {
      const placedItemDefinition = contentRef.current.itemDefinitions.find(
        (item) => item.id === placedItem.itemId,
      );

      selectedFurnitureRef.current = null;
      setSelectedFurniture(null);
      updateSelectedPlacedItem(placedItem);
      updateSelectedWindow(null);
      updateMovingFurniture(null);
      clearPendingFurnitureInteraction();

      updateActiveInteraction({
        kind: "none",
        furnitureId: "room-edit",
        furnitureName: ui("roomEdit.title"),
        message: ui("message.selected", {
          name: placedItemDefinition?.name ?? ui("furniture.title"),
        }),
        startedAt: performance.now(),
        bubbleText: ui("roomEdit.title"),
      });
      return;
    }

    const furniture = findFurnitureAt(contentRef.current, scenePoint.x, scenePoint.y);
    if (!furniture) {
      const roomWindow = findWindowAt(contentRef.current, scenePoint.x, scenePoint.y);
      if (roomWindow) {
        selectedFurnitureRef.current = null;
        setSelectedFurniture(null);
        updateSelectedPlacedItem(null);
        updateMovingPlacedItem(null);
        updateSelectedWindow(roomWindow);
        updateMovingFurniture(null);
        clearPendingFurnitureInteraction();
        updateActiveInteraction({
          kind: "none",
          furnitureId: "window",
          furnitureName: roomWindow.name,
          message: ui("message.selected", { name: roomWindow.name }),
          startedAt: performance.now(),
          bubbleText: ui("roomEdit.title"),
        });
      } else {
        clearSelectedRoomObject();
      }
      return;
    }

    updateSelectedPlacedItem(null);
    updateSelectedWindow(null);
    updateMovingFurniture(null);
    selectedFurnitureRef.current = furniture;
    setSelectedFurniture(furniture);

    updateActiveInteraction({
      kind: "none",
      furnitureId: furniture.id,
      furnitureName: furniture.name,
      message: ui("message.selected", { name: furniture.name }),
      startedAt: performance.now(),
      bubbleText: ui("roomEdit.title"),
    });
  };

  const openSceneContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    const panel = scenePanelRef.current;
    if (!canvas || !panel) return;

    setSceneContextMenu(null);

    if (
      placingItemRef.current ||
      movingPlacedItemRef.current ||
      movingWindowRef.current ||
      movingFurnitureRef.current
    ) {
      return;
    }

    const scenePoint = canvasPointToScene(canvas, event.clientX, event.clientY);
    if (!scenePoint) return;

    const panelRect = panel.getBoundingClientRect();
    const menuX = Math.min(
      Math.max(8, event.clientX - panelRect.left),
      Math.max(8, panelRect.width - 156),
    );
    const menuY = Math.min(
      Math.max(8, event.clientY - panelRect.top),
      Math.max(8, panelRect.height - 74),
    );

    const placedItem = findPlacedItemAt(contentRef.current, scenePoint.x, scenePoint.y);
    if (placedItem) {
      const placedItemDefinition = contentRef.current.itemDefinitions.find(
        (item) => item.id === placedItem.itemId,
      );
      const action = placedItemContextAction(placedItem);

      selectedFurnitureRef.current = null;
      setSelectedFurniture(null);
      updateSelectedPlacedItem(placedItem);
      updateSelectedWindow(null);
      updateMovingFurniture(null);
      clearPendingFurnitureInteraction();

      if (placedItemDefinition && action) {
        setSceneContextMenu({
          x: menuX,
          y: menuY,
          target: {
            kind: "placed-item",
            placedItem,
            item: placedItemDefinition,
            action,
          },
        });
      }
      return;
    }

    const furniture = findFurnitureAt(contentRef.current, scenePoint.x, scenePoint.y);
    if (!furniture) return;

    updateSelectedPlacedItem(null);
    updateSelectedWindow(null);
    updateMovingFurniture(null);
    selectedFurnitureRef.current = furniture;
    setSelectedFurniture(furniture);
    clearPendingFurnitureInteraction();
    setSceneContextMenu({
      x: menuX,
      y: menuY,
      target: {
        kind: "furniture",
        furniture,
        action: resolveFurnitureInteractionKind(furniture),
      },
    });
  };

  const buyItem = (item: ItemDefinition) => {
    setSave((current) => {
      if (isUniqueShopItemOwned(current, item)) return current;
      if (normalizeMemory(current.memory).growth.level < getShopItemUnlockLevel(item)) {
        return current;
      }
      if (current.wallet.bits < item.price) return current;
      if (isSurfaceItem(item)) {
        return {
          ...current,
          wallet: { bits: current.wallet.bits - item.price },
          purchasedItemIds: Array.from(new Set([...current.purchasedItemIds, item.id])),
          memory: recordLifeMemory(
            current.memory,
            {
              type: "item_bought",
              summary: `Bought ${item.name}`,
              itemId: item.id,
            },
            traitChangesForPurchase(item),
          ),
        };
      }

      const existing = current.inventory.find((entry) => entry.itemId === item.id);
      const inventory = existing
        ? current.inventory.map((entry) =>
            entry.itemId === item.id
              ? { ...entry, quantity: entry.quantity + 1 }
              : entry,
          )
        : [...current.inventory, { itemId: item.id, quantity: 1 }];

      return {
        ...current,
        wallet: { bits: current.wallet.bits - item.price },
        inventory,
        purchasedItemIds: Array.from(new Set([...current.purchasedItemIds, item.id])),
        memory: recordLifeMemory(
          current.memory,
          {
            type: "item_bought",
            summary: `Bought ${item.name}`,
            itemId: item.id,
          },
          traitChangesForPurchase(item),
        ),
      };
    });
  };

  const buyOrApplyWindow = (item: ItemDefinition) => {
    const windowDefinition = contentRef.current.room.windows?.find(
      (candidate) => candidate.id === item.id,
    );

    if (!windowDefinition) {
      updateActiveInteraction({
        kind: "blocked",
        furnitureId: "window",
        furnitureName: item.name,
        message: ui("message.windowMissing", { name: item.name }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.missing"),
      });
      return;
    }

    setSave((current) => {
      const purchased = current.purchasedItemIds.includes(item.id);
      if (!purchased && current.wallet.bits < item.price) return current;

      const windowPlacements = current.windowPlacements?.some(
        (placement) => placement.windowId === windowDefinition.id,
      )
        ? current.windowPlacements
        : [
            ...(current.windowPlacements ?? []),
            {
              windowId: windowDefinition.id,
              x: windowDefinition.x,
              y: windowDefinition.y,
              width: windowDefinition.width,
              height: windowDefinition.height,
            },
          ];

      return {
        ...current,
        wallet: purchased
          ? current.wallet
          : { bits: current.wallet.bits - item.price },
        purchasedItemIds: purchased
          ? current.purchasedItemIds
          : Array.from(new Set([...current.purchasedItemIds, item.id])),
        activeWindowId: windowDefinition.id,
        windowPlacements,
        memory: purchased
          ? current.memory
          : recordLifeMemory(
              current.memory,
              {
                type: "item_bought",
                summary: `Bought ${item.name}`,
                itemId: item.id,
              },
              traitChangesForPurchase(item),
            ),
      };
    });

    updateSelectedWindow(windowDefinition);
    updateMovingWindow(null);
    updateWindowPlacementPreview(null);
    updateSelectedPlacedItem(null);
    updateMovingPlacedItem(null);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "window",
      furnitureName: windowDefinition.name,
      message: ui("message.windowApplied", { name: windowDefinition.name }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.window"),
    });
  };

  const buyOrApplySurface = (item: ItemDefinition) => {
    const isWallSurface = isWallSurfaceItem(item);
    const surface = isWallSurface
      ? contentRef.current.room.wallSurfaces?.find((candidate) => candidate.id === item.id)
      : contentRef.current.room.floorSurfaces?.find((candidate) => candidate.id === item.id);
    if (!surface) return;

    setSave((current) => {
      const purchased = current.purchasedItemIds.includes(item.id);
      const alreadyApplied = isWallSurface
        ? (current.wallSurfaceId ?? contentRef.current.room.wallSurfaceId) === surface.id
        : (current.floorSurfaceId ?? contentRef.current.room.floorSurfaceId) === surface.id;
      const purchaseCost = purchased ? 0 : item.price;
      const applyCost = alreadyApplied ? 0 : SURFACE_APPLY_COST;
      if (current.wallet.bits < purchaseCost + applyCost) return current;

      return {
        ...current,
        wallet: { bits: current.wallet.bits - purchaseCost - applyCost },
        purchasedItemIds: purchased
          ? current.purchasedItemIds
          : Array.from(new Set([...current.purchasedItemIds, item.id])),
        memory: purchased
          ? current.memory
          : recordLifeMemory(
              current.memory,
              {
                type: "item_bought",
                summary: `Bought ${item.name}`,
                itemId: item.id,
              },
              traitChangesForPurchase(item),
            ),
        ...(isWallSurface
          ? { wallSurfaceId: surface.id }
          : { floorSurfaceId: surface.id }),
      };
    });

    updateActiveInteraction({
      kind: "none",
      furnitureId: isWallSurface ? "wall-surface" : "floor-surface",
      furnitureName: surface.name,
      message: ui("message.windowApplied", { name: surface.name }),
      startedAt: performance.now(),
      bubbleText: isWallSurface ? ui("bubble.wall") : ui("bubble.floor"),
    });
  };

  const clearAppliedSurface = (surfaceKind: "wall" | "floor") => {
    setSave((current) => ({
      ...current,
      ...(surfaceKind === "wall"
        ? { wallSurfaceId: undefined }
        : { floorSurfaceId: undefined }),
    }));
  };

  const statRows: Array<keyof PetStats> = ["energy", "mood", "hunger"];
  const debugStatuses: CodexStatusName[] = [
    "idle",
    "thinking",
    "executing",
    "waiting_for_user",
    "error",
    "complete",
  ];
  const activeShopItems = content.shop.items.filter(
    (item) =>
      item.id !== TERMINAL_MONITOR_ITEM_ID &&
      !isUniqueShopItemOwned(save, item) &&
      !isSurfaceItem(item) &&
      getShopCategoryId(item) === activeShopCategory,
  );
  const wallpaperItems = content.shop.items.filter(isWallSurfaceItem);
  const flooringItems = content.shop.items.filter(isFloorSurfaceItem);
  const activeDecorSurfaceItems =
    activeDecorSurfaceCategory === "wallpaper" ? wallpaperItems : flooringItems;
  const activeDecorSurfaceKind =
    activeDecorSurfaceCategory === "wallpaper" ? "wall" : "floor";
  const activeDecorSurfaceLabel =
    DECOR_SURFACE_CATEGORIES.find(
      (category) => category.id === activeDecorSurfaceCategory,
    )?.copyKey ?? "decor.wallpaper";
  const memory = normalizeMemory(save.memory);
  const growth = memory.growth;
  const canDispatchTasks = isTaskCabinetPlaced(content);
  const taskCabinetReadyCount = taskCabinetEntries.filter(
    (entry) => entry.status === "ready",
  ).length;
  const taskCabinetRunningCount = taskCabinetEntries.filter(
    (entry) => entry.status === "running",
  ).length;
  const xpToNextLevel = xpNeededForLevel(growth.level);
  const traitRows: Array<keyof AivatarGrowthTraits> = [
    "focus",
    "resilience",
    "curiosity",
    "efficiency",
    "creativity",
    "warmth",
  ];
  const recentMemoryEvents = memory.recentEvents.slice(0, 3);
  const idleBubblePhrases = memory.preferences.idleBubblePhrases ?? [];
  const idleBubbleLanguage = normalizeIdleBubbleLanguage(
    memory.preferences.idleBubbleLanguage,
  );
  const idleBubbleSlotCount = Math.max(1, growth.level);
  const idleBubbleSlotsAvailable = idleBubblePhrases.length < idleBubbleSlotCount;
  const filterIdleBubbleCandidates = (phrases: string[]) =>
    uniqueIdleBubbleCandidates(phrases)
      .filter((phrase) =>
        shouldShowIdleBubbleCandidate(phrase, idleBubbleLanguage, locale),
      )
      .filter((phrase) => !idleBubblePhrases.includes(phrase));
  const memoryCandidates = filterIdleBubbleCandidates(
    memoryIdleBubbleCandidates(memory),
  );
  const sessionCandidates = filterIdleBubbleCandidates([
    ...(effectiveStatus.idleBubbleCandidates ?? []),
    ...sessions.flatMap((session) => session.idleBubbleCandidates ?? []),
  ]);
  const primaryMemoryCandidates = memoryCandidates.slice(
    0,
    IDLE_BUBBLE_MEMORY_CANDIDATE_TARGET,
  );
  const primarySessionCandidates = sessionCandidates
    .filter((phrase) => !primaryMemoryCandidates.includes(phrase))
    .slice(0, IDLE_BUBBLE_SESSION_CANDIDATE_TARGET);
  const idleBubbleCandidates = uniqueIdleBubbleCandidates([
    ...primaryMemoryCandidates,
    ...primarySessionCandidates,
    ...memoryCandidates,
    ...sessionCandidates,
  ])
    .filter((phrase) =>
      shouldShowIdleBubbleCandidate(phrase, idleBubbleLanguage, locale),
    )
    .filter((phrase) => !idleBubblePhrases.includes(phrase))
    .slice(0, IDLE_BUBBLE_CANDIDATE_LIMIT);
  const dominantTrait = traitRows.reduce(
    (best, trait) => (growth.traits[trait] > growth.traits[best] ? trait : best),
    traitRows[0],
  );
  const traitChartSize = 188;
  const traitChartCenter = traitChartSize / 2;
  const traitChartRadius = 76;
  const traitChartAngle = (index: number) =>
    -Math.PI / 2 + (index * Math.PI * 2) / traitRows.length;
  const traitChartPoint = (index: number, radius: number) => {
    const angle = traitChartAngle(index);
    return {
      x: traitChartCenter + Math.cos(angle) * radius,
      y: traitChartCenter + Math.sin(angle) * radius,
    };
  };
  const traitChartPolygon = traitRows
    .map((trait, index) => {
      const value = normalizedTraitChartValue(growth.traits[trait]);
      const point = traitChartPoint(index, traitChartRadius * value);
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    })
    .join(" ");
  const traitChartGrid = [1, 0.66, 0.33].map((scale) =>
    traitRows
      .map((_, index) => {
        const point = traitChartPoint(index, traitChartRadius * scale);
        return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      })
      .join(" "),
  );
  const traitNodeHex = (centerX: number, centerY: number, radius = 5) =>
    Array.from({ length: 6 }, (_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / 6;
      return `${(centerX + Math.cos(angle) * radius).toFixed(1)},${(
        centerY + Math.sin(angle) * radius
      ).toFixed(1)}`;
    }).join(" ");
  const sceneContextTitle =
    sceneContextMenu?.target.kind === "placed-item"
      ? sceneContextMenu.target.item.name
      : sceneContextMenu?.target.furniture.name;
  const sceneContextActionLabel =
    sceneContextMenu?.target.kind === "placed-item"
      ? sceneContextMenu.target.action === "brew"
        ? "Brew"
        : sceneContextMenu.target.action === "paint"
          ? "Paint"
          : sceneContextMenu.target.action === "play"
            ? "Play"
            : "Interact"
      : sceneContextMenu
        ? behaviorLabel(locale, sceneContextMenu.target.furniture.interaction)
        : "";
  const ItemThumbnail = ({ itemId }: { itemId: string }) => (
    <span className={`item-button-thumbnail item-thumb-${itemId}`} aria-hidden="true">
      <span className="item-thumb-steam steam-left" />
      <span className="item-thumb-steam steam-right" />
      <span className="item-thumb-shape" />
      <span className="item-thumb-accent" />
      <span className="item-thumb-detail" />
      <span className="item-thumb-detail-two" />
    </span>
  );

  return (
    <main
      className={`app-shell${sidePanelOpen ? "" : " side-panel-collapsed"}${
        sidePanelAnimating ? " side-panel-animating" : ""
      }`}
      style={
        scenePanelWidth
          ? ({ "--scene-panel-width": `${scenePanelWidth}px` } as React.CSSProperties)
          : undefined
      }
    >
      <section ref={scenePanelRef} className="scene-panel" aria-label={ui("app.roomAria")}>
        <button
          type="button"
          className={`side-panel-edge-toggle${sidePanelOpen ? " expanded" : " collapsed"}`}
          onClick={toggleSidePanel}
          disabled={sidePanelAnimating}
          aria-label={sidePanelOpen ? ui("sidePanel.close") : ui("sidePanel.open")}
        >
          <span className="side-panel-edge-icon" aria-hidden="true" />
        </button>
        {!sidePanelOpen && !sidePanelAnimating && currentSessionContextMeter ? (
          <div
            className={`room-context-overlay ${currentSessionContextMeter.level}`}
            aria-label={`Context window ${currentSessionContextMeter.percentLabel}`}
          >
            <div>
              <span>Context</span>
              <strong>{currentSessionContextMeter.percentLabel}</strong>
            </div>
            <div className="room-context-bar">
              <div
                className="room-context-fill"
                style={{ width: `${currentSessionContextMeter.percent}%` }}
              />
            </div>
          </div>
        ) : null}
        {!sidePanelOpen && !sidePanelAnimating ? (
          <>
            <div className="room-stats-overlay" aria-label="Pet stats">
              {statRows.map((key) => (
                <div key={key} className="room-stat-mini">
                  <span>{statLabel(locale, key)}</span>
                  <meter min="0" max="100" value={save.petStats[key]} />
                  <b>{Math.round(save.petStats[key])}</b>
                </div>
              ))}
            </div>
            <div className="room-growth-overlay" aria-label="Growth summary">
              <div>
                <span>{ui("growth.title")}</span>
                <strong>{ui("growth.level", { value: growth.level })}</strong>
              </div>
              <div className="room-growth-xp">
                <meter min="0" max={xpToNextLevel} value={growth.xp} />
                <b>
                  {Math.round(growth.xp)}/{xpToNextLevel} {ui("growth.xp")}
                </b>
              </div>
              <span className="room-growth-trait">
                {ui(`growth.trait.${dominantTrait}`)} {growth.traits[dominantTrait]}
              </span>
            </div>
          </>
        ) : null}
        <canvas
          ref={canvasRef}
          className="room-canvas"
          onClick={interactWithFurniture}
          onContextMenu={openSceneContextMenu}
          onMouseLeave={clearHoveredFurniture}
          onMouseMove={updateHoveredFurniture}
        />
        {sceneContextMenu ? (
          <div
            className="scene-context-menu"
            style={{
              left: `${sceneContextMenu.x}px`,
              top: `${sceneContextMenu.y}px`,
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span>{sceneContextTitle}</span>
            <button
              type="button"
              className="scene-context-button"
              onClick={runSceneContextAction}
            >
              {sceneContextActionLabel}
            </button>
          </div>
        ) : null}
      </section>

      <aside className="side-panel" aria-hidden={!sidePanelOpen}>
        <header className="status-header">
          <div>
            <p className="eyebrow">
              {sourceLabel} / {configState}
            </p>
            <h1>{content.avatar.name}</h1>
          </div>
          <span className={`status-dot status-${effectiveStatus.status}`} />
        </header>

        <label className="name-editor">
          <span>{ui("avatar.name")}</span>
          <input
            type="text"
            maxLength={16}
            value={save.avatarName ?? contentBase.avatar.name}
            onChange={(event) => updateAvatarName(event.target.value)}
          />
        </label>

        <div className="language-switch" aria-label={ui("app.language")}>
          {localeOptions.map((option) => (
            <button
              key={option.locale}
              type="button"
              className={`language-button${locale === option.locale ? " active" : ""}`}
              onClick={() => setLocale(option.locale)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="status-card">
          <span>{statusLabel(locale, effectiveStatus.status)}</span>
          <strong>{behaviorLabel(locale, avatar.behavior)}</strong>
          {debugStatus ? (
            <p className="debug-override-warning">
              Debug override active - click Live
            </p>
          ) : null}
          <p>{currentStatusMessage()}</p>
        </div>

        <section className="growth-card" aria-label={ui("growth.title")}>
          <button
            type="button"
            className={`growth-toggle${growthPanelOpen ? " active" : ""}`}
            onClick={() => setGrowthPanelOpen((current) => !current)}
            aria-expanded={growthPanelOpen}
          >
            <span className="growth-toggle-main">
              <span>{ui("growth.title")}</span>
              <b>{ui("growth.level", { value: growth.level })}</b>
            </span>
            <span className="growth-toggle-progress">
              <meter min="0" max={xpToNextLevel} value={growth.xp} />
              <b>
                {Math.round(growth.xp)}/{xpToNextLevel} {ui("growth.xp")}
              </b>
            </span>
            <span className="growth-toggle-chevron" aria-hidden="true">
              {growthPanelOpen ? "-" : "+"}
            </span>
          </button>

          {growthPanelOpen ? (
            <div className="growth-submenu">
              <div className="growth-trait-hex">
                <svg
                  className="growth-trait-chart"
                  viewBox={`0 0 ${traitChartSize} ${traitChartSize}`}
                  role="img"
                  aria-label={ui("growth.traits")}
                >
                  {traitChartGrid.map((points, index) => (
                    <polygon
                      key={points}
                      className={`growth-trait-grid grid-${index}`}
                      points={points}
                    />
                  ))}
                  {traitRows.map((_, index) => {
                    const point = traitChartPoint(index, traitChartRadius);
                    return (
                      <line
                        key={`axis-${index}`}
                        className="growth-trait-axis"
                        x1={traitChartCenter}
                        y1={traitChartCenter}
                        x2={point.x}
                        y2={point.y}
                      />
                    );
                  })}
                  <polygon className="growth-trait-fill" points={traitChartPolygon} />
                  <polygon className="growth-trait-outline" points={traitChartPolygon} />
                  {traitRows.map((trait, index) => {
                      const point = traitChartPoint(index, traitChartRadius);
                      return (
                        <g key={`trait-hover-${trait}`} className="growth-trait-hover">
                        <polygon
                          className="growth-trait-dot"
                          points={traitNodeHex(point.x, point.y)}
                        />
                        <text
                          className="growth-trait-svg-label"
                          x={traitChartCenter}
                          y={traitChartCenter - 5}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          <tspan x={traitChartCenter}>{ui(`growth.trait.${trait}`)}</tspan>
                          <tspan x={traitChartCenter} dy="15">
                            {growth.traits[trait]}
                          </tspan>
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              {recentMemoryEvents.length > 0 ? (
                <div className="memory-list">
                  <span>{ui("growth.recent")}</span>
                  {recentMemoryEvents.map((event) => (
                    <p key={event.id}>{event.summary}</p>
                  ))}
                </div>
              ) : null}
              <div className="idle-bubble-editor">
                <div className="idle-bubble-heading">
                  <span>{ui("idleBubble.title")}</span>
                  <b>
                    {idleBubblePhrases.length}/{idleBubbleSlotCount}
                  </b>
                </div>
                <div className="idle-bubble-language">
                  <span>{ui("idleBubble.language")}</span>
                  <div>
                    {IDLE_BUBBLE_LANGUAGE_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`idle-bubble-language-button${
                          idleBubbleLanguage === option ? " active" : ""
                        }`}
                        onClick={() => updateIdleBubbleLanguagePreference(option)}
                      >
                        {ui(`idleBubble.language.${option}`)}
                      </button>
                    ))}
                  </div>
                </div>
                {idleBubblePhrases.length > 0 ? (
                  <div className="idle-bubble-list">
                    {idleBubblePhrases.map((phrase) => (
                      <button
                        key={phrase}
                        type="button"
                        className="idle-bubble-pill"
                        onClick={() => removeIdleBubblePhrase(phrase)}
                        title={ui("action.remove")}
                      >
                        <span>{phrase}</span>
                        <b aria-hidden="true">x</b>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="idle-bubble-empty">{ui("idleBubble.empty")}</p>
                )}
                <div className="idle-bubble-heading">
                  <span>{ui("idleBubble.suggested")}</span>
                  <b>{ui("idleBubble.limit", { value: idleBubbleSlotCount })}</b>
                </div>
                {idleBubbleCandidates.length > 0 ? (
                  <div className="idle-bubble-candidates">
                    {idleBubbleCandidates.map((phrase) => (
                      <button
                        key={phrase}
                        type="button"
                        className="pixel-button idle-bubble-candidate"
                        disabled={!idleBubbleSlotsAvailable}
                        onClick={() => addIdleBubblePhrase(phrase)}
                      >
                        <span>{phrase}</span>
                        <b>{ui("action.add")}</b>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="idle-bubble-empty">{ui("idleBubble.noSuggestions")}</p>
                )}
              </div>
            </div>
          ) : null}
        </section>

        <section className="sessions-card" aria-label={ui("sessions.title")}>
          <button
            type="button"
            className={`sessions-toggle${sessionsPanelOpen ? " active" : ""}`}
            onClick={() => setSessionsPanelOpen((current) => !current)}
            aria-expanded={sessionsPanelOpen}
          >
            <span className="sessions-toggle-main">
              <span>{ui("sessions.title")}</span>
              <b>{liveSessionCount}/{sessions.length}</b>
            </span>
            <span className="sessions-toggle-status">
              {currentSessionKey ? "Current" : sourceLabel}
            </span>
            {currentSessionContextMeter ? (
              <span className={`sessions-toggle-context ${currentSessionContextMeter.level}`}>
                <span className="sessions-toggle-context-label">
                  <span>Context</span>
                  <b>{currentSessionContextMeter.percentLabel}</b>
                </span>
                <span className="sessions-toggle-context-bar">
                  <span
                    className="sessions-toggle-context-fill"
                    style={{ width: `${currentSessionContextMeter.percent}%` }}
                  />
                </span>
              </span>
            ) : null}
            <span className="sessions-toggle-chevron" aria-hidden="true">
              {sessionsPanelOpen ? "-" : "+"}
            </span>
          </button>

          {sessionsPanelOpen ? (
            <div className="sessions-submenu">
              {activeSessionKey ? (
                <button
                  type="button"
                  className="session-clear-button"
                  onClick={clearFollowedSession}
                >
                  Clear Follow
                </button>
              ) : null}
              <button
                type="button"
                className="session-clear-button"
                onClick={clearStaleSessionRows}
                disabled={clearableStaleSessionCount === 0}
              >
                Clear Stale ({clearableStaleSessionCount})
              </button>
              <div className="session-command-hint" aria-label="Aivatar session commands">
                <span>CLI</span>
                <code>aivatar-connect</code>
                <code>aivatar-disconnect</code>
              </div>
              {sessionRows.length > 0 ? (
                <div className="session-list">
                  {sessionRows.map((session) => (
                    <article
                      key={`${session.agent ?? "agent"}-${session.sessionId ?? "default"}`}
                      className={`session-card status-${session.status}${
                        session.stale && session.sessionKey !== connectedSessionKey
                          ? " stale"
                          : ""
                      }${session.sessionKey === activeSessionKey ? " active" : ""}${
                        session.sessionKey === connectedSessionKey ? " connected" : ""
                      }${
                        session.sessionKey === currentSessionKey ? " current" : ""
                      }`}
                    >
                      <div>
                        <strong>{session.label}</strong>
                        <span>{statusLabel(locale, session.status)}</span>
                      </div>
                      <p>{session.detail}</p>
                      {session.contextMeter ? (
                        <div
                          className={`session-context-meter ${session.contextMeter.level}`}
                          aria-label={`Context window ${session.contextMeter.percentLabel}`}
                        >
                          <div>
                            <span>Context</span>
                            <strong>{session.contextMeter.percentLabel}</strong>
                          </div>
                          <div className="session-context-bar">
                            <div
                              className="session-context-fill"
                              style={{ width: `${session.contextMeter.percent}%` }}
                            />
                          </div>
                          <small>{session.contextMeter.label}</small>
                        </div>
                      ) : null}
                      {session.rewardSummary ? (
                        <p className="session-usage">{session.rewardSummary}</p>
                      ) : null}
                      <small>{session.sessionId ?? "default"}</small>
                      <div className="session-meta-row">
                        {session.sessionKey === currentSessionKey ? (
                          <span className="session-chip">Current</span>
                        ) : null}
                        {session.sessionKey === activeSessionKey ? (
                          <span className="session-chip">Followed</span>
                        ) : null}
                        {session.sessionKey === connectedSessionKey ? (
                          <span className="session-chip">Connected</span>
                        ) : null}
                        {session.stale && session.sessionKey === connectedSessionKey ? (
                          <span className="session-chip">Idle</span>
                        ) : session.stale ? (
                          <span className="session-chip">{ui("sessions.stale")}</span>
                        ) : null}
                      </div>
                      <div className="session-actions">
                        <button
                          type="button"
                          className="session-follow-button"
                          onClick={() => followSession(session)}
                          disabled={
                            !session.agent ||
                            !session.sessionId ||
                            session.sessionKey === activeSessionKey
                          }
                        >
                          Follow
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="session-empty">{ui("sessions.empty")}</p>
              )}
            </div>
          ) : null}
        </section>

        <section className="task-cabinet-card" aria-label="Task Cabinet">
          <button
            type="button"
            className={`task-cabinet-toggle${taskCabinetPanelOpen ? " active" : ""}`}
            onClick={() => setTaskCabinetPanelOpen((current) => !current)}
            aria-expanded={taskCabinetPanelOpen}
          >
            <span className="task-cabinet-toggle-main">
              <span>Task Cabinet</span>
              <b>{taskCabinetReadyCount}/{taskCabinetEntries.length}</b>
            </span>
            <span className="task-cabinet-toggle-status">
              {taskCabinetRunningCount > 0
                ? "Running"
                : canDispatchTasks
                    ? "Cabinet placed"
                    : "Place File Cabinet to dispatch"}
            </span>
            <span className="task-cabinet-toggle-chevron" aria-hidden="true">
              {taskCabinetPanelOpen ? "-" : "+"}
            </span>
          </button>

          {taskCabinetPanelOpen ? (
            <div className="task-cabinet-submenu">
              <label className="task-cabinet-field">
                <span>Markdown task path</span>
                <span className="path-picker-row">
                  <input
                    type="text"
                    value={taskCabinetPathInput}
                    onChange={(event) => setTaskCabinetPathInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        addTaskCabinetEntry();
                      }
                    }}
                    placeholder="C:\\path\\to\\task.md"
                  />
                  <button
                    type="button"
                    className="path-picker-button"
                    onClick={browseTaskCabinetPath}
                  >
                    Browse
                  </button>
                </span>
              </label>
              <button
                type="button"
                className="pixel-button task-cabinet-add"
                onClick={addTaskCabinetEntry}
              >
                Add Task
              </button>
              <p className="task-cabinet-hint">
                Task prompts are passed to the CLI as one startup prompt. Keep each
                .md file at or below 24,000 characters.
              </p>
              <div className="task-cabinet-controls task-cabinet-controls-single">
                <button
                  type="button"
                  className="pixel-button task-cabinet-run-next"
                  disabled={taskCabinetReadyCount === 0 || taskCabinetRunningCount > 0}
                  onClick={runNextTaskCabinetEntry}
                >
                  Run Next
                </button>
              </div>
              <p className="task-cabinet-empty">
                Uses CLI Launcher agent, args, and folder. Aivatar reads the md file
                once and sends a temp copy to the agent.
              </p>
              {taskCabinetMessage ? (
                <p className="task-cabinet-message">{taskCabinetMessage}</p>
              ) : null}
              {taskCabinetEntries.length > 0 ? (
                <div className="task-cabinet-list">
                  {taskCabinetEntries.map((entry) => (
                    <article
                      key={entry.id}
                      className={`task-cabinet-entry task-${entry.status}`}
                    >
                      <div className="task-cabinet-entry-heading">
                        <strong title={entry.path}>
                          {taskCabinetFileName(entry.path)}
                        </strong>
                        <span>{entry.status}</span>
                      </div>
                      <small className="task-cabinet-path" title={entry.path}>
                        {entry.path}
                      </small>
                      <label className="task-cabinet-field">
                        <span>Profile</span>
                        <select
                          value={entry.runProfile ?? "default"}
                          onChange={(event) =>
                            setTaskCabinetRunProfile(
                              entry.id,
                              event.currentTarget.value as TaskCabinetRunProfile,
                            )
                          }
                        >
                          <option value="default">Default</option>
                          <option value="fast">Fast</option>
                        </select>
                      </label>
                      {entry.runProfile === "fast" ? (
                        <small className="task-cabinet-schedule-next">
                          {launcherAgent === "claude-code"
                            ? "Fast adds --bare for Claude Code."
                            : "Codex fast profile waits for a verified MCP-skip flag."}
                        </small>
                      ) : null}
                      {entry.cwd || entry.sessionId || entry.error ? (
                        <small
                          className={`task-cabinet-path${
                            entry.error ? " task-cabinet-error" : ""
                          }`}
                          title={entry.error ?? entry.cwd ?? entry.sessionId}
                        >
                          {entry.error ??
                            [
                              entry.agent,
                              entry.cwd ? `cwd ${entry.cwd}` : null,
                              entry.sessionId ? `session ${entry.sessionId}` : null,
                            ]
                              .filter(Boolean)
                              .join(" / ")}
                        </small>
                      ) : null}
                      <div className="task-cabinet-schedule">
                        <label className="task-cabinet-auto">
                          <input
                            type="checkbox"
                            checked={entry.schedule?.enabled ?? false}
                            onChange={(event) =>
                              setTaskCabinetScheduleEnabled(
                                entry.id,
                                event.currentTarget.checked,
                              )
                            }
                          />
                          <span>Schedule</span>
                        </label>
                        <div className="task-cabinet-schedule-grid">
                          <label className="task-cabinet-field">
                            <span>Mode</span>
                            <select
                              value={entry.schedule?.mode ?? "once"}
                              onChange={(event) =>
                                setTaskCabinetScheduleMode(
                                  entry.id,
                                  event.currentTarget.value as TaskCabinetScheduleMode,
                                )
                              }
                            >
                              <option value="once">Once</option>
                              <option value="repeat">Repeat</option>
                            </select>
                          </label>
                          <label className="task-cabinet-field">
                            <span>Run at</span>
                            <input
                              type="datetime-local"
                              value={isoToDatetimeLocal(entry.schedule?.runAt)}
                              onChange={(event) =>
                                setTaskCabinetScheduleRunAt(
                                  entry.id,
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </label>
                          <label className="task-cabinet-field">
                            <span>Every min</span>
                            <input
                              type="number"
                              min="1"
                              max="10080"
                              value={
                                entry.schedule?.intervalMinutes ??
                                TASK_CABINET_DEFAULT_REPEAT_MINUTES
                              }
                              onChange={(event) =>
                                setTaskCabinetScheduleInterval(
                                  entry.id,
                                  Number(event.currentTarget.value),
                                )
                              }
                            />
                          </label>
                          <label className="task-cabinet-field">
                            <span>Condition</span>
                            <select
                              value={entry.schedule?.condition ?? "always"}
                              onChange={(event) =>
                                setTaskCabinetScheduleCondition(
                                  entry.id,
                                  event.currentTarget
                                    .value as TaskCabinetScheduleCondition,
                                )
                              }
                            >
                              <option value="always">Always</option>
                              <option value="only_idle">Only idle</option>
                              <option value="after_success">After success</option>
                            </select>
                          </label>
                        </div>
                        <small className="task-cabinet-schedule-next">
                          {entry.schedule?.enabled
                            ? taskScheduleNextLabel(entry.schedule, nowMs)
                            : "Schedule off"}
                        </small>
                      </div>
                      <div className="task-cabinet-entry-footer">
                        <small>
                          Updated {new Date(entry.updatedAt).toLocaleDateString()}
                        </small>
                        {entry.status === "ready" || entry.status === "failed" ? (
                          <button
                            type="button"
                            className="task-cabinet-remove"
                            disabled={taskCabinetRunningCount > 0}
                            onClick={() => startTaskCabinetEntry(entry.id)}
                          >
                            {entry.status === "failed" ? "Rerun" : "Run"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="task-cabinet-remove"
                          onClick={() => removeTaskCabinetEntry(entry.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="task-cabinet-empty">
                  Add markdown file paths here. Aivatar stores the list locally and
                  leaves the files untouched.
                </p>
              )}
            </div>
          ) : null}
        </section>

        <section className="launcher-card" aria-label={ui("launcher.title")}>
          <button
            type="button"
            className={`launcher-toggle${launcherPanelOpen ? " active" : ""}`}
            onClick={() => setLauncherPanelOpen((current) => !current)}
            aria-expanded={launcherPanelOpen}
          >
            <span className="launcher-toggle-main">
              <span>{ui("launcher.title")}</span>
              <b>{launcherAgent === "codex" ? "Codex" : "Claude"}</b>
            </span>
            <span className="launcher-toggle-status">
              {launcherDirectory.trim() || ui("launcher.directoryPlaceholder")}
            </span>
            <span className="launcher-toggle-chevron" aria-hidden="true">
              {launcherPanelOpen ? "-" : "+"}
            </span>
          </button>

          {launcherPanelOpen ? (
            <div className="launcher-submenu">
              <label className="launcher-field">
                <span>{ui("launcher.directory")}</span>
                <span className="path-picker-row">
                  <input
                    type="text"
                    value={launcherDirectory}
                    onChange={(event) => setLauncherDirectory(event.target.value)}
                    placeholder="C:\\path\\to\\project"
                  />
                  <button
                    type="button"
                    className="path-picker-button"
                    onClick={browseLauncherDirectory}
                  >
                    Browse
                  </button>
                </span>
              </label>
              <div className="launcher-agent-choice" aria-label={ui("launcher.agent")}>
                <button
                  type="button"
                  className={launcherAgent === "codex" ? "active" : ""}
                  onClick={() => setLauncherAgent("codex")}
                >
                  Codex
                </button>
                <button
                  type="button"
                  className={launcherAgent === "claude-code" ? "active" : ""}
                  onClick={() => setLauncherAgent("claude-code")}
                >
                  Claude Code
                </button>
              </div>
              {launcherAgent === "codex" ? (
                <label className="launcher-option">
                  <input
                    type="checkbox"
                    checked={launcherAllowNewSession}
                    onChange={(event) =>
                      setLauncherAllowNewSession(event.currentTarget.checked)
                    }
                  />
                  <span>{ui("launcher.newSession")}</span>
                </label>
              ) : null}
              <label className="launcher-field">
                <span>{ui("launcher.args")}</span>
                <input
                  type="text"
                  value={launcherArgs}
                  onChange={(event) => setLauncherArgs(event.target.value)}
                  placeholder={ui("launcher.argsPlaceholder")}
                />
              </label>
              <button
                type="button"
                className="pixel-button launcher-start"
                onClick={startAgentCliFromLauncher}
                disabled={!launcherDirectory.trim()}
              >
                {ui("launcher.start")}
              </button>
              {launcherMessage ? (
                <p className="launcher-message">{launcherMessage}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="debug-card" aria-label={ui("debug.title")}>
          <button
            type="button"
            className={`debug-toggle${debugPanelOpen ? " active" : ""}`}
            onClick={() => setDebugPanelOpen((current) => !current)}
            aria-expanded={debugPanelOpen}
          >
            <span className="debug-toggle-main">
              <span>{ui("debug.title")}</span>
              <b>{sourceLabel}</b>
            </span>
            <span className="debug-toggle-status">
              {debugStatus ? "Override" : "Live"}
            </span>
            <span className="debug-toggle-chevron" aria-hidden="true">
              {debugPanelOpen ? "-" : "+"}
            </span>
          </button>

          {debugPanelOpen ? (
            <div className="debug-submenu">
              <div className="debug-grid">
                {debugStatuses.map((statusName) => (
                  <button
                    key={statusName}
                    type="button"
                    className="debug-button"
                    onClick={() => setDebugStatusName(statusName)}
                  >
                    {statusLabel(locale, statusName)}
                  </button>
                ))}
              </div>
              <div className="debug-grid">
                {traitRows.map((trait) => (
                  <button
                    key={trait}
                    type="button"
                    className="debug-button"
                    onClick={() => trainGrowthTrait(trait)}
                  >
                    +{ui(`growth.trait.${trait}`)}
                  </button>
                ))}
              </div>
              <div className="debug-actions">
                <button
                  type="button"
                  className={`pixel-button${debugStatus ? " debug-live-active" : ""}`}
                  onClick={clearDebugStatus}
                >
                  {ui("debug.live")}
                </button>
                <button type="button" className="pixel-button" onClick={startBridge}>
                  {ui("debug.startBridge")}
                </button>
                <button type="button" className="pixel-button" onClick={addTestSupplies}>
                  {ui("debug.addSupplies")}
                </button>
                <button type="button" className="pixel-button" onClick={startBehaviorDemo}>
                  {ui("debug.demoActions")}
                </button>
                <button
                  type="button"
                  className={`pixel-button${windowTimePreview ? " debug-live-active" : ""}`}
                  onClick={() => setWindowTimePreview((current) => !current)}
                >
                  {ui("debug.windowPreview")}
                </button>
                <button type="button" className="pixel-button" onClick={saveCurrentLayoutAsDefault}>
                  {ui("debug.saveLayout")}
                </button>
                <button type="button" className="pixel-button danger-button" onClick={clearSaveState}>
                  {ui("debug.clearSave")}
                </button>
              </div>
              {bridgeStartMessage ? (
                <p className="debug-message">{bridgeStartMessage}</p>
              ) : null}
              <dl className="meta-list">
                <div>
                  <dt>{ui("debug.bridge")}</dt>
                  <dd>{endpoint}</dd>
                </div>
                <div>
                  <dt>{ui("debug.boost")}</dt>
                  <dd className={boostActive ? "boost-active" : undefined}>
                    {boostActive ? `${boostRemainingSeconds}s` : ui("status.inactive")}
                  </dd>
                </div>
                <div>
                  <dt>{ui("debug.tableCoffee")}</dt>
                  <dd>
                    {tableCoffeeStorage.quantity}/{tableCoffeeStorage.capacity}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}
        </section>

        <div className="stats-grid">
          {statRows.map((key) => (
            <label key={key} className="stat-row">
              <span>{statLabel(locale, key)}</span>
              <meter min="0" max="100" value={save.petStats[key]} />
              <b>{Math.round(save.petStats[key])}</b>
            </label>
          ))}
        </div>

        {placingItem ? (
          <section className="control-section placement-panel">
            <div className="section-heading">
              <h2>{ui("placement.title")}</h2>
              <span>
                {placementPreview?.valid
                  ? ui("state.ready")
                  : placementTargetLabel(locale, placingItem)}
              </span>
            </div>
            <p>{ui("message.placing", { name: placingItem.name, nameTarget: placementTargetLabel(locale, placingItem) })}</p>
            <button type="button" className="pixel-button danger-button" onClick={cancelPlacement}>
              {ui("action.cancel")}
            </button>
          </section>
        ) : null}

        {movingWindow ? (
          <section className="control-section placement-panel">
            <div className="section-heading">
              <h2>{ui("window.title")}</h2>
              <span>{windowPlacementPreview?.valid ? ui("state.ready") : ui("state.chooseWall")}</span>
            </div>
            <p>{ui("message.movingWindow", { name: movingWindow.name })}</p>
            <button type="button" className="pixel-button danger-button" onClick={cancelPlacement}>
              {ui("action.cancel")}
            </button>
          </section>
        ) : null}

        {movingFurniture ? (
          <section className="control-section placement-panel">
            <div className="section-heading">
              <h2>{furnitureEditorTitle(locale, movingFurniture)}</h2>
              <span>
                {furniturePlacementPreview?.valid
                  ? ui("state.ready")
                  : movingFurniture.id === "computer"
                    ? ui("state.chooseDesk")
                    : ui("state.chooseFloor")}
              </span>
            </div>
            <p>
              {ui("message.movingFurniture", {
                name: movingFurniture.name,
                nameTarget:
                  movingFurniture.id === "computer"
                    ? ui("target.desktop")
                    : ui("target.floorPosition"),
              })}
            </p>
            <button type="button" className="pixel-button danger-button" onClick={cancelPlacement}>
              {ui("action.cancel")}
            </button>
          </section>
        ) : null}

        {selectedPlacedItem && selectedPlacedItemDefinition ? (
          <section className="control-section edit-panel">
            <div className="section-heading">
              <h2>{ui("roomEdit.title")}</h2>
              <span>{movingPlacedItem ? ui("state.moving") : ui("state.selected")}</span>
            </div>
            <p>{selectedPlacedItemDefinition.name}</p>
            <div className="edit-actions">
              <button type="button" className="pixel-button" onClick={startMovePlacedItem}>
                {ui("action.move")}
              </button>
              <button
                type="button"
                className="pixel-button"
                onClick={storePlacedItem}
                disabled={selectedPlacedItemLocked}
              >
                {ui("action.store")}
              </button>
              <button
                type="button"
                className="pixel-button"
                onClick={rotatePlacedItem}
                disabled={selectedPlacedItemDefinition.rotatable === false}
              >
                {ui("action.rotate")}
              </button>
              <button
                type="button"
                className="pixel-button"
                onClick={sellPlacedItem}
                disabled={selectedPlacedItemLocked}
              >
                {ui("action.sell", { value: itemSellValue(selectedPlacedItemDefinition) })}
              </button>
              <button
                type="button"
                className="pixel-button danger-button"
                onClick={deletePlacedItem}
                disabled={selectedPlacedItemLocked}
              >
                {ui("action.delete")}
              </button>
              <button type="button" className="pixel-button" onClick={resetDefaultLayout}>
                {ui("action.resetLayout")}
              </button>
            </div>
            <button type="button" className="pixel-button danger-button" onClick={cancelRoomEdit}>
              {ui("action.cancel")}
            </button>
          </section>
        ) : null}

        {selectedWindow ? (
          <section className="control-section edit-panel">
            <div className="section-heading">
              <h2>{ui("roomEdit.title")}</h2>
              <span>{movingWindow ? ui("state.moving") : ui("state.selected")}</span>
            </div>
            <p>{selectedWindow.name}</p>
            <div className="edit-actions">
              <button type="button" className="pixel-button" onClick={startMoveWindow}>
                {ui("action.move")}
              </button>
              <button
                type="button"
                className="pixel-button"
                onClick={sellSelectedWindow}
                disabled={!selectedWindowDefinition}
              >
                {ui("action.sell", { value: itemSellValue(selectedWindowDefinition) })}
              </button>
              <button type="button" className="pixel-button" onClick={resetDefaultLayout}>
                {ui("action.resetLayout")}
              </button>
            </div>
            <button type="button" className="pixel-button danger-button" onClick={cancelRoomEdit}>
              {ui("action.cancel")}
            </button>
          </section>
        ) : null}

        {selectedFurniture ? (
          <section className="control-section edit-panel">
            <div className="section-heading">
              <h2>{furnitureEditorTitle(locale, selectedFurniture)}</h2>
              <span>{movingFurniture ? ui("state.moving") : ui("state.selected")}</span>
            </div>
            <p>{selectedFurniture.name}</p>
            <div className="edit-actions">
              <button type="button" className="pixel-button" onClick={startMoveFurniture}>
                {ui("action.move")}
              </button>
              {selectedFurnitureSellDefinition ? (
                <button type="button" className="pixel-button" onClick={sellSelectedFurniture}>
                  {ui("action.sell", {
                    value: itemSellValue(selectedFurnitureSellDefinition),
                  })}
                </button>
              ) : null}
              <button type="button" className="pixel-button" onClick={resetDefaultLayout}>
                {ui("action.resetLayout")}
              </button>
            </div>
            <button type="button" className="pixel-button danger-button" onClick={cancelRoomEdit}>
              {ui("action.cancel")}
            </button>
          </section>
        ) : null}

        <section className="control-section decor-panel">
          <button
            type="button"
            className="pixel-button decor-toggle-button"
            aria-expanded={decorPanelOpen}
            onClick={() => setDecorPanelOpen((open) => !open)}
          >
            <span>{ui("decor.title")}</span>
            <span>
              {save.wallet.bits} {ui("currency.bits")}
            </span>
            <span aria-hidden="true">{decorPanelOpen ? "-" : "+"}</span>
          </button>
          {decorPanelOpen ? (
            <>
              <div className="decor-surface-tabs" aria-label={ui("decor.title")}>
                {DECOR_SURFACE_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`decor-surface-tab${
                      activeDecorSurfaceCategory === category.id ? " active" : ""
                    }`}
                    onClick={() => setActiveDecorSurfaceCategory(category.id)}
                  >
                    {ui(category.copyKey)}
                  </button>
                ))}
              </div>
              <div className="decor-surface-group">
                <p>{ui(activeDecorSurfaceLabel)}</p>
                <button
                  type="button"
                  className="pixel-button decor-clear-button"
                  disabled={
                    activeDecorSurfaceKind === "wall"
                      ? !save.wallSurfaceId
                      : !save.floorSurfaceId
                  }
                  onClick={() => clearAppliedSurface(activeDecorSurfaceKind)}
                >
                  {ui("action.clearApplied")}
                </button>
                <div className="button-grid">
                  {activeDecorSurfaceItems.map((item) => {
                    const purchased = save.purchasedItemIds.includes(item.id);
                    const applied =
                      activeDecorSurfaceKind === "wall"
                        ? (save.wallSurfaceId ?? content.room.wallSurfaceId) === item.id
                        : (save.floorSurfaceId ?? content.room.floorSurfaceId) === item.id;
                    const surfaceActionLabel = applied
                      ? ui("state.applied")
                      : purchased
                        ? ui("action.apply")
                        : ui("action.buy", { value: item.price });
                    const surfaceActionCost = purchased
                      ? SURFACE_APPLY_COST
                      : item.price + SURFACE_APPLY_COST;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`pixel-button decor-surface-button${applied ? " active" : ""}`}
                        disabled={applied || save.wallet.bits < surfaceActionCost}
                        title={item.name}
                        aria-label={`${item.name} ${surfaceActionLabel}`}
                        onClick={() => buyOrApplySurface(item)}
                      >
                        <span
                          className={`decor-surface-preview surface-preview-${item.id}`}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </section>

        <section className="control-section">
          <div className="section-heading">
            <h2>{ui("inventory.title")}</h2>
            <span>
              {save.wallet.bits} {ui("currency.bits")}
            </span>
          </div>
          <div className="button-grid">
            {inventoryItems.map(({ item, quantity }) => (
              <button
                key={item.id}
                type="button"
                className="pixel-button"
                aria-label={`${item.name} x${quantity}`}
                title={`${item.name} x${quantity}`}
                onClick={() => applyItem(item)}
              >
                <span className="item-button-content">
                  <ItemThumbnail itemId={item.id} />
                  <span>x{quantity}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="control-section">
          <div className="section-heading">
            <h2>{ui("shop.title")}</h2>
            <span>
              {SHOP_CATEGORIES.find((category) => category.id === activeShopCategory)
                ? ui(
                    SHOP_CATEGORIES.find((category) => category.id === activeShopCategory)!
                      .copyKey,
                  )
                : content.shop.currency}
            </span>
          </div>
          <div className="shop-category-tabs" aria-label={ui("shop.categories")}>
            {SHOP_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`shop-category-tab${
                  activeShopCategory === category.id ? " active" : ""
                }`}
                onClick={() => setActiveShopCategory(category.id)}
              >
                {ui(category.copyKey)}
              </button>
            ))}
          </div>
          <div className="button-grid">
            {activeShopItems.map((item) => {
              const unlockLevel = getShopItemUnlockLevel(item);
              const levelLocked = growth.level < unlockLevel;
              const purchasedWindow =
                isWindowItem(item) && save.purchasedItemIds.includes(item.id);
              const label = levelLocked
                ? `${item.name} ${ui("growth.level", { value: unlockLevel })}`
                : purchasedWindow
                  ? `${item.name} ${ui("state.ready")}`
                  : `${item.name} ${item.price}`;

              return (
                <button
                  key={item.id}
                  type="button"
                  className="pixel-button shop-button"
                  disabled={
                    levelLocked || (!purchasedWindow && save.wallet.bits < item.price)
                  }
                  aria-label={label}
                  title={label}
                  onClick={() =>
                    isWindowItem(item) ? buyOrApplyWindow(item) : buyItem(item)
                  }
                >
                  <span className="item-button-content">
                    <ItemThumbnail itemId={item.id} />
                    <span>
                      {levelLocked
                        ? ui("growth.level", { value: unlockLevel })
                        : item.price}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {activeShopItems.length === 0 ? (
            <p className="empty-shop-category">{ui("shop.emptyCategory")}</p>
          ) : null}
        </section>

        <section className="control-section asset-editor-entry">
          <div className="section-heading">
            <h2>Asset Studio</h2>
            <span>Locked</span>
          </div>
          <button
            type="button"
            className="pixel-button asset-editor-locked-button"
            disabled
            title="Asset Studio is still in development"
          >
            <span aria-hidden="true">🔒</span>
            Asset Studio in development
          </button>
        </section>
      </aside>
    </main>
  );
};
