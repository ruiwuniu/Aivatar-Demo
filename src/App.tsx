import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { defaultContent } from "./data/defaultContent";
import { loadContentConfig } from "./data/loadContent";
import {
  canvasPointToScene,
  attachedPlacedItemPosition,
  FILE_CABINET_COLLISION_DEPTH,
  FILE_CABINET_COLLISION_INSET_X,
  FILE_CABINET_FURNITURE_HEIGHT,
  FILE_CABINET_FURNITURE_WIDTH,
  FILE_CABINET_PLACED_ITEM_OFFSET_X,
  FILE_CABINET_PLACED_ITEM_OFFSET_Y,
  FILE_CABINET_TOP_HIT_DEPTH,
  FILE_CABINET_TOP_HIT_INSET_X,
  FILE_CABINET_TOP_HIT_Y_OFFSET,
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
  clearNavigationScope,
  explorationCellKey,
  explorationTargetReached,
  getFurnitureInteractionTarget,
  getFurnitureInteractionStandpoints,
  getPlacedItemInteractionStandpoints,
  initialAvatarRuntime,
  navigationLayoutFingerprint,
  setBehavior,
  setFurnitureBehavior,
  tickAvatar,
} from "./game/simulation";
import {
  ROOM_DOOR_INSIDE_POINT,
  ROOM_DOOR_OUTSIDE_POINT,
  ROOM_VISIT_BUBBLE_KEY_PREFIX,
  advanceRoomVisitor,
  clampSocialWillingness,
  completeSocialRelationship,
  completeSocialRoomVisit,
  createRoomDoorEntryRuntime,
  createRoomInstanceId,
  createVisitId,
  createVisitorFromVisit,
  hostLayoutFingerprint,
  isPointInRoomDoor,
  normalizeRoomPresence,
  normalizeSocialBubble,
  normalizeSocialBubbleCandidate,
  normalizeSocialBubbleSet,
  normalizeSocialRelationship,
  normalizeSocialRoomMemory,
  normalizeVisitSession,
  recordSocialRoomNavSample,
  roomPresenceFromSave,
  roomVisitSocialDurationSeconds,
  roomVisitBubbleKeyForBehavior,
  roomVisitorNavigationScopeKey,
  roomVisitExpiresAt,
  roomVisitNowIso,
  selectSocialBubbleExchange,
  shouldAttemptAutonomousVisit,
  socialBubbleLanguageForPreference,
  socialBubbleSignature,
  socialVisitRolePair,
  socialRoomMemoryStorageKey,
  socialRelationshipStorageKey,
  socialWillingnessScore,
} from "./game/roomVisits";
import {
  PAINTING_GALLERY_LIMIT,
  advancePaintingDraft,
  createPaintingDraft,
  normalizePaintingGallery,
  paintingPixelVisible,
  paintingProgressRatio,
  rewardBitsForPaintingQuality,
} from "./game/paintings";
import { useCodexStatus } from "./hooks/useCodexStatus";
import {
  agentDisplayName,
  agentSourceBadge,
  agentSourceClassName,
  isRewardAgent,
  launcherAgentDefinitions,
  type LauncherAgentId,
} from "./agentRegistry";
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
import {
  SHOP_BULK_PURCHASE_QUANTITY,
  SHOP_LONG_PRESS_CLICK_SUPPRESSION_MS,
  SHOP_LONG_PRESS_MS,
  SHOP_PURCHASE_COOLDOWN_MS,
  affordableShopPurchaseQuantity as affordableShopPurchaseQuantityBase,
  getShopItemUnlockLevel as getShopItemUnlockLevelBase,
  isBulkPurchasableShopItem as isBulkPurchasableShopItemBase,
  isFloorSurfaceItem,
  isFurnitureSkinItem,
  isSurfaceItem,
  isUniqueShopItemOwned as isUniqueShopItemOwnedBase,
  isWallSurfaceItem,
  isWindowItem,
  reserveShopPurchaseSlot as reserveShopPurchaseSlotBase,
} from "./shopPurchase";
import type {
  AivatarContent,
  AivatarGrowthTraits,
  AivatarMemory,
  AivatarMemoryEvent,
  AivatarNavMemory,
  AivatarPaintingArtwork,
  AivatarPaintingDraft,
  AivatarPaintingPlan,
  AivatarRoomPresence,
  AivatarRoomsSnapshot,
  AivatarRoomVisitor,
  AivatarSaveState,
  AivatarSocialBubble,
  AivatarSocialBubbleCandidate,
  AivatarSocialBubbleSet,
  AivatarSocialRelationship,
  AivatarSocialRoomMemory,
  AivatarVisitRole,
  AivatarVisitSession,
  AvatarAppearanceId,
  AvatarRuntime,
  BehaviorName,
  CodexStatusMessage,
  CodexStatusName,
  FurnitureDefinition,
  FurniturePlacement,
  FurnitureInteractionKind,
  FurnitureInteractionState,
  FurnitureStorageEntry,
  GrowthTrait,
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

type AgentIntegrationStatus = {
  agent: LauncherAgentId;
  label: string;
  detected: boolean;
  enabled: boolean;
  cli_available: boolean;
  needs_restart: boolean;
  detail: string;
  config_path?: string | null;
  connector_path?: string | null;
  cli_path?: string | null;
};

type SaveSlotWindowResult = {
  label: string;
};

const SAVE_KEY = "aivatar.save.v1";
const SAVE_SLOTS_KEY = "aivatar.saveSlots.v1";
const ACTIVE_SAVE_SLOT_KEY = "aivatar.activeSaveSlot.v1";
const SAVE_SLOT_KEY_PREFIX = "aivatar.saveSlot.v1.";
const DEFAULT_LAYOUT_KEY = "aivatar.defaultLayout.v1";
const TASK_CABINET_STORAGE_KEY = "aivatar.taskCabinet.v1";
const UI_THEME_KEY = "aivatar.uiTheme.v1";
const AUDIO_VOLUME_KEY = "aivatar.audioVolume.v1";
const GAME_CONSOLE_VOLUME_KEY = "aivatar.gameConsoleVolume.v1";
const STARTUP_SOUND_KEY = "aivatar.startupSound.v1";
const BGM_VOLUME_KEY = "aivatar.bgmVolume.v1";
const BGM_TRACK_KEY = "aivatar.bgmTrack.v1";
const AUTO_MUSIC_KEY = "aivatar.autoMusic.v1";
const ALWAYS_ON_TOP_KEY = "aivatar.alwaysOnTop.v1";
const AVATAR_STATE_URL = "http://127.0.0.1:38988/avatar-state";
const PAINTING_PLAN_URL = "http://127.0.0.1:38988/painting-plan";
const ROOMS_URL = "http://127.0.0.1:38988/rooms";
const VISIT_INVITE_URL = "http://127.0.0.1:38988/visits/invite";
const VISIT_STATE_URL = "http://127.0.0.1:38988/visits/state";
const VISIT_END_URL = "http://127.0.0.1:38988/visits/end";
const SAVE_LAYOUT_VERSION = 2;
const MAX_SAVE_SLOTS = 8;
const DEFAULT_AVATAR_APPEARANCE_ID = "octopus";
const SLEEP_INTERACTION_SECONDS = 12;
const SLEEP_RECOVERY_PER_TICK = 4;
const SLEEP_RECOVERY_INTERVAL_SECONDS = 2;
const INTERACTION_FEEDBACK_SECONDS = 5;
const REWARD_BUBBLE_SECONDS = 10;
const PLAY_MOOD_RECOVERY_PER_TICK = 1;
const PLAY_MOOD_RECOVERY_INTERVAL_SECONDS = 14;
const PLAY_ACTIVE_TARGET_REACH = 24;
const PAINT_MOOD_RECOVERY_PER_TICK = 1;
const PAINT_RECOVERY_INTERVAL_SECONDS = 16;
const PAINT_INTERACTION_SECONDS = 24;
const PAINTING_PROGRESS_SAVE_INTERVAL_SECONDS = 1;
const PAINTING_PLAN_REQUEST_TIMEOUT_MS = 52_000;
const MUSIC_MOOD_DECAY_MULTIPLIER = 0.35;
const BGM_AUTONOMOUS_STOP_MIN_SECONDS = 45;
const BGM_AUTONOMOUS_STOP_CHECK_SECONDS = 60;
const BGM_AUTONOMOUS_STOP_CHANCE = 0.08;
const COFFEE_MACHINE_ITEM_ID = "coffee-machine";
const EASEL_ITEM_ID = "oil-easel";
const RECORD_PLAYER_ITEM_ID = "record-player";
const COFFEE_CUP_ITEM_ID = "coffee-cup";
const PAINTING_REPLACEABLE_ITEM_IDS = new Set(["poster", "sky-sentinel-poster"]);
const COFFEE_ITEM_ID = "coffee";
const COLA_ITEM_ID = "cola";
const BENTO_ITEM_ID = "bento";
const COOKIE_ITEM_ID = "cookie";
const REPAIR_KIT_ITEM_ID = "repair-kit";
const ITEM_ARCADE_A_THUMBNAIL_CELL_SIZE = 16;
const ITEM_ARCADE_A_THUMBNAIL_INDICES: Record<string, number> = {
  [COFFEE_ITEM_ID]: 0,
  [COLA_ITEM_ID]: 1,
  [BENTO_ITEM_ID]: 2,
  [COOKIE_ITEM_ID]: 3,
  [RECORD_PLAYER_ITEM_ID]: 4,
  "game-console": 5,
  [EASEL_ITEM_ID]: 6,
  "file-cabinet": 7,
  "tiny-plant": 8,
  "cyberpunk-city-window": 9,
  "cozy-rug": 10,
  "morph-blob-rug": 11,
  "blue-persian-rug": 12,
  "desk-lamp": 13,
  [COFFEE_CUP_ITEM_ID]: 14,
  "digital-wall-clock": 15,
  "terminal-monitor": 16,
  "coffee-machine": 17,
  "poster": 18,
  "sky-sentinel-poster": 19,
  "cozy-window": 20,
  "city-night-window": 21,
  "ocean-window": 22,
  "industrial-bed-skin": 23,
  "wood-red-bed-skin": 24,
  "ivory-pink-plaid-bed-skin": 25,
  "modern-minimal-bed-skin": 26,
  "space-white-deep-gray-bed-skin": 27,
  "industrial-desk-skin": 28,
  "rococo-ivory-desk-skin": 29,
  "transparent-acrylic-desk-skin": 30,
  "rococo-ivory-table-skin": 31,
  "dark-oak-table-skin": 32,
  "white-tech-table-skin": 33,
  "ivory-fridge-skin": 34,
  "red-retro-fridge-skin": 35,
  "white-tech-fridge-skin": 36,
  [REPAIR_KIT_ITEM_ID]: 37,
};
const BED_INDUSTRIAL_SKIN_ID = "industrial-bed-skin";
const BED_WOOD_RED_SKIN_ID = "wood-red-bed-skin";
const BED_IVORY_PINK_PLAID_SKIN_ID = "ivory-pink-plaid-bed-skin";
const BED_MODERN_MINIMAL_SKIN_ID = "modern-minimal-bed-skin";
const BED_SPACE_WHITE_DEEP_GRAY_SKIN_ID = "space-white-deep-gray-bed-skin";
const DESK_INDUSTRIAL_SKIN_ID = "industrial-desk-skin";
const DESK_ROCOCO_IVORY_SKIN_ID = "rococo-ivory-desk-skin";
const DESK_TRANSPARENT_ACRYLIC_SKIN_ID = "transparent-acrylic-desk-skin";
const TERMINAL_GREEN_AMBER_SKIN_ID = "terminal-green-amber-skin";
const TERMINAL_WHITE_CYAN_SKIN_ID = "terminal-white-cyan-skin";
const TERMINAL_NEON_DARK_SKIN_ID = "terminal-neon-dark-skin";
const TERMINAL_SKIN_THUMBNAIL_CELL_SIZE = 16;
const TERMINAL_SKIN_THUMBNAIL_INDICES: Record<string, number> = {
  [TERMINAL_GREEN_AMBER_SKIN_ID]: 0,
  [TERMINAL_WHITE_CYAN_SKIN_ID]: 1,
  [TERMINAL_NEON_DARK_SKIN_ID]: 2,
};
const TABLE_ROCOCO_IVORY_SKIN_ID = "rococo-ivory-table-skin";
const TABLE_DARK_OAK_SKIN_ID = "dark-oak-table-skin";
const TABLE_WHITE_TECH_SKIN_ID = "white-tech-table-skin";
const FRIDGE_IVORY_SKIN_ID = "ivory-fridge-skin";
const FRIDGE_RED_RETRO_SKIN_ID = "red-retro-fridge-skin";
const FRIDGE_WHITE_TECH_SKIN_ID = "white-tech-fridge-skin";
const COFFEE_MAX_QUANTITY = 6;
const TABLE_FURNITURE_ID = "table";
const EMPTY_TABLE_COFFEE_CAPACITY = 0;
const COFFEE_BREW_SECONDS = 4;
const COFFEE_BREW_BIT_COST = 1;
const SURFACE_APPLY_COST = 1000;
const COFFEE_AUTONOMOUS_INTERVAL_SECONDS = 4;
const COFFEE_AUTONOMOUS_COOLDOWN_SECONDS = 90;
const WORK_BOOST_SECONDS = 120;
const WORK_BOOST_COMPLETE_BONUS = 3;
const TOKEN_REWARD_TOKEN_STEP = 1000;
const TOKEN_REWARD_DEFAULT_MAX_BITS = 100;
const TOKEN_REWARD_EXTREME_USAGE_TOKEN_THRESHOLD = 1_000_000;
const TOKEN_REWARD_EXTREME_USAGE_MAX_BITS = 1000;
const TOKEN_REWARD_CACHED_INPUT_WEIGHT = 0.1;
const INTERACTION_ARRIVAL_DISTANCE = 8;
const AVATAR_FOOTPRINT_HALF_WIDTH = 6;
const AVATAR_FOOTPRINT_TOP_OFFSET = 6;
const AVATAR_FOOTPRINT_HEIGHT = 8;
const INTERACTION_POINT_TOUCH_PADDING = 1;
const BUILTIN_TERMINAL_PLACED_ITEM_ID = "builtin-terminal";
const TERMINAL_MONITOR_ITEM_ID = "terminal-monitor";
const LEGACY_TERMINAL_FURNITURE_ID = "computer";
const SESSION_STALE_MS = 5 * 60 * 60 * 1000;
const IDLE_BUBBLE_PHRASE_MAX_LENGTH = 28;
const IDLE_BUBBLE_CANDIDATE_LIMIT = 6;
const IDLE_BUBBLE_MEMORY_CANDIDATE_TARGET = 3;
const IDLE_BUBBLE_SESSION_CANDIDATE_TARGET = 3;
const SOCIAL_BUBBLE_CANDIDATE_LIMIT = 6;
const SOCIAL_BUBBLE_SLOT_BASE = 4;
const IDLE_BUBBLE_LANGUAGE_OPTIONS: IdleBubbleLanguagePreference[] = [
  "auto",
  "zh",
  "en",
  "mixed",
];
const BUSY_RECOVERY_LOW_STAT = 24;
const BUSY_RECOVERY_LOW_MOOD = 18;
const BRIDGE_START_MESSAGE_SECONDS = 8;
const ROOM_PRESENCE_SYNC_MS = 1200;
const ROOM_VISIT_STATE_POST_MS = 650;
const ROOM_VISIT_NAV_SAMPLE_SECONDS = 2.5;
const ROOM_VISIT_CONNECTION_FAILURE_LIMIT = 3;
const ROOM_VISIT_BUSY_CANCEL_REASON = "session-busy";
const ROOM_VISIT_AUTO_CHECK_MS = 15_000;
const ROOM_VISIT_AUTO_COOLDOWN_MS = 95_000;
const ROOM_VISIT_PAIR_COOLDOWN_MS = 140_000;
const ROOM_VISIT_PAIR_COOLDOWN_PREFIX = "aivatar.roomVisitPairCooldown.v1.";
const COMPLETE_REWARD_FRESH_MS = 10000;
const APP_HORIZONTAL_PADDING = 24;
const APP_GRID_GAP = 12;
const SIDE_PANEL_WIDTH = 224;
const DEFAULT_EXPANDED_WINDOW_WIDTH = 760;
const DEFAULT_SCENE_PANEL_WIDTH =
  DEFAULT_EXPANDED_WINDOW_WIDTH - APP_HORIZONTAL_PADDING - APP_GRID_GAP - SIDE_PANEL_WIDTH;
const COLLAPSED_WINDOW_MIN_WIDTH = DEFAULT_SCENE_PANEL_WIDTH + APP_HORIZONTAL_PADDING;
const DEFAULT_WINDOW_HEIGHT = 520;
const SHOW_DEBUG_CARD = false;
const EXPANDED_WINDOW_MIN_WIDTH = 720;
const COLLAPSED_WINDOW_CLIENT_WIDTH_GUARD = 2;
const COLLAPSED_WINDOW_RESIZE_RETRY_DELAY_MS = 50;
const COLLAPSED_WINDOW_RESIZE_RETRY_LIMIT = 2;
const MEMORY_RECENT_EVENT_LIMIT = 20;
const BEHAVIOR_DEMO_SECONDS = 3;
const SIDE_PANEL_TRANSITION_MS = 80;
const TASK_CABINET_FURNITURE_ID = "file-cabinet";
const TASK_CABINET_UNLOCK_LEVEL = 25;
const TASK_CABINET_SCHEDULE_INTERVAL_MS = 5000;
const TASK_CABINET_DEFAULT_REPEAT_MINUTES = 60;
const TASK_CABINET_ENTRY_LIMIT = 100;
const TASK_CABINET_READ_HANDOFF_MS = 1200;
const NAV_MEMORY_CELL_COUNT_LIMIT = 9999;
const NAV_LEARNING_RECORD_INTERVAL_SECONDS = 2.5;
const DEFAULT_AUDIO_VOLUME = 0.45;
const DEFAULT_GAME_CONSOLE_VOLUME = 0.5;
const DEFAULT_BGM_VOLUME = 0.25;
const DEFAULT_BGM_TRACK_ID = "pixel-parlor";
const KEYBOARD_TYPING_AUDIO_SRC = "/audio/keyboard-typing-loop.wav";
const COFFEE_MACHINE_BREW_AUDIO_SRC = "/audio/coffee-machine-brew-loop.ogg";
const FRIDGE_DOOR_OPEN_AUDIO_SRC = "/audio/fridge-door-open.mp3";
const FRIDGE_DOOR_CLOSE_AUDIO_SRC = "/audio/fridge-door-close.mp3";
const AGENT_COMPLETE_AUDIO_SRC = "/audio/agent-complete-success.ogg";
const BITS_SPEND_AUDIO_SRC = "/audio/bits-spend.wav";
const COLA_CAN_OPEN_AUDIO_SRC = "/audio/cola-can-open.mp3";
const COLA_DRINK_AUDIO_SRC = "/audio/cola-drink.mp3";
const COFFEE_DRINK_AUDIO_SRC = "/audio/coffee-drink-slurping.mp3";
const BENTO_EAT_AUDIO_SRC = "/audio/bento-eat-munchin.mp3";
const SLEEP_SNORE_AUDIO_SRC = "/audio/sleep-snore.mp3";
const GAME_CONSOLE_AUDIO_SOURCES = [
  "/audio/game-console-jump.ogg",
  "/audio/game-console-invincibility.ogg",
  "/audio/game-console-victory.ogg",
  "/audio/game-console-battle.ogg",
  "/audio/game-console-get-equipped.wav",
  "/audio/game-console-curious.ogg",
];
const BGM_TRACKS = [
  {
    id: DEFAULT_BGM_TRACK_ID,
    copyKey: "audio.bgmTrack.pixelParlor",
    kind: "programmatic",
    volumeScale: 1,
    stepMs: 210,
    pattern: [
      523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46,
      493.88, 587.33, 739.99, 587.33, 523.25, 659.25, 783.99, 1046.5,
    ],
  },
  {
    id: "bach-fugue-bwv-577-the-jig",
    copyKey: "audio.bgmTrack.bachFugue577",
    kind: "audio",
    src: "/audio/bach-fugue-bwv-577-the-jig.ogg",
    volumeScale: 0.58,
  },
  {
    id: "bach-invention-4",
    copyKey: "audio.bgmTrack.bachInvention4",
    kind: "audio",
    src: "/audio/bach-invention-4.wav",
    volumeScale: 0.42,
  },
  {
    id: "nes-bach-bwv-565",
    copyKey: "audio.bgmTrack.nesBachBwv565",
    kind: "audio",
    src: "/audio/nes-bach-bwv-565.ogg",
    volumeScale: 1,
  },
  {
    id: "c64-bach-wtk2-prelude2",
    copyKey: "audio.bgmTrack.c64BachWtk2Prelude2",
    kind: "audio",
    src: "/audio/c64-bach-wtk2-prelude2.ogg",
    volumeScale: 1.6,
  },
  {
    id: "nes-chopin-op25-no2",
    copyKey: "audio.bgmTrack.nesChopinOp25No2",
    kind: "audio",
    src: "/audio/nes-chopin-op25-no2.ogg",
    volumeScale: 0.74,
  },
  {
    id: "synth-chopin-fantaisie-impromptu",
    copyKey: "audio.bgmTrack.synthChopinFantaisieImpromptu",
    kind: "audio",
    src: "/audio/synth-chopin-fantaisie-impromptu.ogg",
    volumeScale: 1.13,
  },
  {
    id: "cyberpunk-moonlight-sonata",
    copyKey: "audio.bgmTrack.cyberpunkMoonlight",
    kind: "audio",
    src: "/audio/cyberpunk-moonlight-sonata.mp3",
    volumeScale: 1,
  },
] as const;
const COFFEE_MACHINE_BREW_AUDIO_VOLUME_MULTIPLIER = 0.45;
const FRIDGE_DOOR_AUDIO_VOLUME_MULTIPLIER = 0.65;
const FRIDGE_DOOR_CLOSE_AUDIO_DELAY_MS = 3650;
const AGENT_COMPLETE_AUDIO_VOLUME_MULTIPLIER = 0.65;
const BITS_SPEND_AUDIO_VOLUME_MULTIPLIER = 0.55;
const COFFEE_BREW_SPEND_AUDIO_VOLUME_MULTIPLIER = 0.35;
const STARTUP_SOUND_AUDIO_VOLUME_MULTIPLIER = 0.28;
const COLA_CAN_OPEN_AUDIO_VOLUME_MULTIPLIER = 0.55;
const COLA_CAN_OPEN_AFTER_FRIDGE_DELAY_MS = 550;
const COLA_DRINK_AUDIO_VOLUME_MULTIPLIER = 0.45;
const COLA_DRINK_AFTER_CAN_OPEN_DELAY_MS = 1200;
const COFFEE_DRINK_AUDIO_VOLUME_MULTIPLIER = 0.42;
const BENTO_EAT_AUDIO_VOLUME_MULTIPLIER = 0.42;
const SLEEP_SNORE_AUDIO_VOLUME_MULTIPLIER = 0.18;
const AUTONOMOUS_ACTION_STUCK_SECONDS = 120;
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
  "cookie",
  "brew",
  "relax",
  "admire",
  "snack",
  "paint",
  "play",
  "music",
  "workout",
  "thinking",
  "coding",
  "waiting",
  "error",
  "success",
];

type ShopCategoryId =
  | "furniture"
  | "furniture-skins"
  | "windows"
  | "supplies"
  | "hangings";

type DecorSurfaceCategoryId = "wallpaper" | "flooring";

type UiThemeId = "classic" | "terminal" | "terminal-amber" | "arcade-cabinet" | "starship-console";
type SceneUiThemeId = UiThemeId;
type BgmTrack = (typeof BGM_TRACKS)[number];
type BgmTrackId = BgmTrack["id"];

type SaveSlotSummary = {
  id: string;
  slotIndex: number;
  avatarId: string;
  roomId: string;
  avatarName: string;
  avatarAppearanceId: AvatarAppearanceId;
  createdAt: string;
  updatedAt: string;
};

type AvatarAppearanceOption = {
  id: AvatarAppearanceId;
  copyKey: string;
  descriptionKey: string;
};

const REGISTERED_AVATAR_APPEARANCES: AvatarAppearanceOption[] = [
  {
    id: DEFAULT_AVATAR_APPEARANCE_ID,
    copyKey: "saveSlots.avatar.octopus",
    descriptionKey: "saveSlots.avatar.octopusDescription",
  },
  {
    id: "demo-spark",
    copyKey: "saveSlots.avatar.demoSpark",
    descriptionKey: "saveSlots.avatar.demoSparkDescription",
  },
  {
    id: "mood-slime",
    copyKey: "saveSlots.avatar.moodSlime",
    descriptionKey: "saveSlots.avatar.moodSlimeDescription",
  },
  {
    id: "cute-crayfish",
    copyKey: "saveSlots.avatar.cuteCrayfish",
    descriptionKey: "saveSlots.avatar.cuteCrayfishDescription",
  },
  {
    id: "cute-ghost",
    copyKey: "saveSlots.avatar.cuteGhost",
    descriptionKey: "saveSlots.avatar.cuteGhostDescription",
  },
  {
    id: "cute-penguin",
    copyKey: "saveSlots.avatar.cutePenguin",
    descriptionKey: "saveSlots.avatar.cutePenguinDescription",
  },
  // Development-only: keep the renderer/type/copy wired, but hide it from new-save creation.
  {
    id: "wave-lizard",
    copyKey: "saveSlots.avatar.waveLizard",
    descriptionKey: "saveSlots.avatar.waveLizardDescription",
  },
];

const AVATAR_APPEARANCES = REGISTERED_AVATAR_APPEARANCES.filter(
  (appearance) => appearance.id !== "wave-lizard",
);

const UI_THEME_OPTIONS: Array<{ id: UiThemeId; copyKey: string }> = [
  { id: "classic", copyKey: "theme.classic" },
  { id: "terminal", copyKey: "theme.terminal" },
  { id: "terminal-amber", copyKey: "theme.amber" },
  { id: "arcade-cabinet", copyKey: "theme.arcade" },
  { id: "starship-console", copyKey: "theme.starship" },
];

const loadInitialUiTheme = (): UiThemeId => {
  const saved = localStorage.getItem(UI_THEME_KEY);
  if (saved === "terminal-amber") return "terminal-amber";
  if (saved === "arcade-cabinet") return "arcade-cabinet";
  if (saved === "starship-console") return "starship-console";
  if (saved === "classic" || saved === "terminal") return saved;
  return "terminal";
};

const uiThemeForScene = (theme: UiThemeId): SceneUiThemeId => theme;

const loadInitialAudioVolume = () => {
  const saved = Number(localStorage.getItem(AUDIO_VOLUME_KEY));
  if (Number.isFinite(saved)) return Math.min(1, Math.max(0, saved));
  return DEFAULT_AUDIO_VOLUME;
};

const loadInitialGameConsoleVolume = () => {
  const saved = Number(localStorage.getItem(GAME_CONSOLE_VOLUME_KEY));
  if (Number.isFinite(saved)) return Math.min(1, Math.max(0, saved));
  return DEFAULT_GAME_CONSOLE_VOLUME;
};

const loadInitialStartupSoundEnabled = () =>
  localStorage.getItem(STARTUP_SOUND_KEY) === "true";

const loadInitialBgmVolume = () => {
  const saved = Number(localStorage.getItem(BGM_VOLUME_KEY));
  if (Number.isFinite(saved)) return Math.min(1, Math.max(0, saved));
  return DEFAULT_BGM_VOLUME;
};

const loadInitialBgmTrackId = (): BgmTrackId => {
  const saved = localStorage.getItem(BGM_TRACK_KEY);
  return BGM_TRACKS.some((track) => track.id === saved)
    ? (saved as BgmTrackId)
    : DEFAULT_BGM_TRACK_ID;
};

const randomBgmTrackId = (currentTrackId: BgmTrackId): BgmTrackId => {
  const candidates = BGM_TRACKS.filter((track) => track.id !== currentTrackId);
  const pool = candidates.length > 0 ? candidates : BGM_TRACKS;
  return pool[Math.floor(Math.random() * pool.length)].id;
};

const loadInitialAutoMusicEnabled = () =>
  localStorage.getItem(AUTO_MUSIC_KEY) !== "false";

const loadInitialAlwaysOnTopEnabled = () =>
  localStorage.getItem(ALWAYS_ON_TOP_KEY) === "true";

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
  { id: "furniture-skins", copyKey: "shop.furnitureSkins" },
  { id: "windows", copyKey: "shop.windows" },
  { id: "supplies", copyKey: "shop.supplies" },
  { id: "hangings", copyKey: "shop.hangings" },
];

const getShopCategoryId = (item: ItemDefinition): ShopCategoryId => {
  if (item.kind === "window") return "windows";
  if (isFurnitureSkinItem(item)) return "furniture-skins";
  if (item.kind === "food" || item.kind === "drink" || item.kind === "tool") {
    return "supplies";
  }
  if (getItemPlacementKind(item) === "wall") return "hangings";
  if (item.tags?.includes("item")) return "supplies";
  if (item.tags?.includes("furniture")) return "furniture";
  return "furniture";
};

const UNIQUE_SHOP_ITEM_IDS = new Set<string>([TASK_CABINET_FURNITURE_ID]);
const SPECIAL_SHOP_UNLOCK_LEVELS: Readonly<Record<string, number>> = {
  [TASK_CABINET_FURNITURE_ID]: TASK_CABINET_UNLOCK_LEVEL,
};

const getShopItemUnlockLevel = (item: ItemDefinition) =>
  getShopItemUnlockLevelBase(item, {
    unlockLevelsByItemId: SPECIAL_SHOP_UNLOCK_LEVELS,
  });

const isTaskCabinetPlaced = (content: AivatarContent) =>
  content.room.furniture.some((item) => item.id === TASK_CABINET_FURNITURE_ID);

const isUniqueShopItemOwned = (save: AivatarSaveState, item: ItemDefinition) =>
  isUniqueShopItemOwnedBase(save, item, {
    uniqueItemIds: UNIQUE_SHOP_ITEM_IDS,
  });

const isBulkPurchasableShopItem = (item: ItemDefinition) =>
  isBulkPurchasableShopItemBase(item, {
    uniqueItemIds: UNIQUE_SHOP_ITEM_IDS,
  });

const affordableShopPurchaseQuantity = (
  save: AivatarSaveState,
  item: ItemDefinition,
  requestedQuantity: number,
) =>
  affordableShopPurchaseQuantityBase(save, item, requestedQuantity, {
    growthLevel: normalizeMemory(save.memory).growth.level,
    uniqueItemIds: UNIQUE_SHOP_ITEM_IDS,
    unlockLevelsByItemId: SPECIAL_SHOP_UNLOCK_LEVELS,
  });

const clampQuantity = (entry: InventoryEntry): InventoryEntry => ({
  ...entry,
  quantity: Math.max(0, entry.quantity),
});

const removeDeprecatedInventoryItems = (inventory: InventoryEntry[]) =>
  inventory.filter((entry) => entry.itemId !== REPAIR_KIT_ITEM_ID);

const isStatusStale = (status: CodexStatusMessage, now = Date.now()) => {
  const updatedAt = Date.parse(status.expiresAt ?? status.timestamp);
  if (Number.isNaN(updatedAt)) return false;
  return status.expiresAt ? now > updatedAt : now - updatedAt > SESSION_STALE_MS;
};

const isPresenceStale = (status: CodexStatusMessage, now = Date.now()) => {
  const updatedAt = Date.parse(status.expiresAt ?? status.presenceTimestamp ?? status.timestamp);
  if (Number.isNaN(updatedAt)) return false;
  return status.expiresAt ? now > updatedAt : now - updatedAt > SESSION_STALE_MS;
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

const rewardUsageForBits = (usage?: TokenUsage) =>
  usage?.scope === "context-window" ? undefined : usage;

const weightedTokensForUsage = (usage?: TokenUsage) => {
  const rewardUsage = rewardUsageForBits(usage);
  if (!rewardUsage?.totalTokens || rewardUsage.totalTokens <= 0) return 0;
  const inputTokens = rewardUsage.inputTokens ?? 0;
  const cachedInputTokens = Math.min(rewardUsage.cachedInputTokens ?? 0, inputTokens);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return (
    uncachedInputTokens +
    cachedInputTokens * TOKEN_REWARD_CACHED_INPUT_WEIGHT +
    (rewardUsage.outputTokens ?? 0) +
    (rewardUsage.reasoningOutputTokens ?? 0)
  );
};

const maxRewardBitsForUsage = (usage?: TokenUsage) => {
  const totalTokens = rewardUsageForBits(usage)?.totalTokens ?? 0;
  if (totalTokens > TOKEN_REWARD_EXTREME_USAGE_TOKEN_THRESHOLD) {
    return TOKEN_REWARD_EXTREME_USAGE_MAX_BITS;
  }
  return TOKEN_REWARD_DEFAULT_MAX_BITS;
};

const rewardBitsForUsage = (usage?: TokenUsage) => {
  const rewardUsage = rewardUsageForBits(usage);
  if (!rewardUsage?.totalTokens || rewardUsage.totalTokens <= 0) return 4;
  const weightedTokens = weightedTokensForUsage(rewardUsage);

  return Math.min(
    maxRewardBitsForUsage(rewardUsage),
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
  const capped = bits >= maxRewardBitsForUsage(usage) ? " cap" : "";
  return `${formatTokenCount(usage.totalTokens)} tokens -> ${bits} bits${capped} (${formatTokenCount(weightedTokens)} weighted)`;
};

const contextWindowMeterForUsage = (usage?: TokenUsage) => {
  const contextTokens = usage?.contextTokens ?? 0;
  const modelContextWindow = usage?.modelContextWindow ?? 0;
  if (contextTokens <= 0 || modelContextWindow <= 0) return null;

  const rawPercent = (contextTokens / modelContextWindow) * 100;
  const percent = Math.max(0, Math.min(100, rawPercent));
  const level = rawPercent >= 85 ? "high" : rawPercent >= 65 ? "warm" : "calm";
  const tokenLimitMeter = (
    key: string,
    labelKey: string,
    value: number | undefined,
  ) => {
    if (value === undefined || !Number.isFinite(value) || value < 0) return null;
    const clamped = Math.max(0, Math.min(100, value));
    return {
      key,
      labelKey,
      percent: clamped,
      level: value >= 85 ? "high" : value >= 65 ? "warm" : "calm",
      percentLabel: `${Math.round(value)}%`,
    };
  };
  const optionalMeters = [
    {
      key: "context",
      labelKey: "sessions.context",
      percent,
      level,
      percentLabel: `${Math.round(rawPercent)}%`,
    },
    tokenLimitMeter("token-5h", "sessions.token5h", usage?.tokenLimit5hPercent),
    tokenLimitMeter("token-week", "sessions.tokenWeek", usage?.tokenLimitWeekPercent),
  ];
  const meters = optionalMeters.filter(
    (meter): meter is NonNullable<(typeof optionalMeters)[number]> => meter !== null,
  );

  return {
    percent,
    level,
    label: `${formatTokenCount(contextTokens)} / ${formatTokenCount(modelContextWindow)} context`,
    percentLabel: `${Math.round(rawPercent)}%`,
    meters,
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
    socialBubbles: {
      active: [],
      responses: [],
      disabledIds: [],
    },
    socialWillingness: 50,
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
  } else if (dominantTrait === "creativity") {
    add("颜色在脑袋里转", "试一笔新的", "这个角落有灵感", "Tiny spark forming");
  } else if (dominantTrait === "warmth") {
    add("房间暖暖的", "陪你慢慢来", "今天也照顾好自己", "Soft light, steady heart");
  }

  if (memory.preferences.favoriteRecovery === "coffee") {
    add("咖啡还热着", "Coffee is still warm");
  } else if (memory.preferences.favoriteRecovery === "cola") {
    add("气泡还在跳", "Fizz keeps dancing");
  } else if (memory.preferences.favoriteRecovery === "bento") {
    add("便当补一口", "Snack power ready");
  } else if (memory.preferences.favoriteRecovery === "cookie") {
    add("曲奇还香着", "Cookie crumb comfort");
  } else if (memory.preferences.favoriteRecovery === "sleep") {
    add("刚睡醒软软的", "Soft after sleep");
  } else if (memory.preferences.favoriteRecovery === "play") {
    add("手柄还在发光", "Game glow lingers");
  } else if (memory.preferences.favoriteRecovery === "paint") {
    add("画布还亮着", "Paint still drying");
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
    } else if (event.type === "session_learning") {
      add("I learned a little", "Session thoughts saved");
    } else if (event.type === "item_bought") {
      add("新东西到家", "New room treasure");
    } else if (event.behavior === "coffee" || event.itemId === COFFEE_ITEM_ID) {
      add("咖啡还热着", "Tiny coffee mood");
    } else if (event.behavior === "cola" || event.itemId === COLA_ITEM_ID) {
      add("气泡还在跳", "Fizz break");
    } else if (event.behavior === "bento" || event.itemId === BENTO_ITEM_ID) {
      add("便当补一口", "Snack power ready");
    } else if (event.behavior === "cookie" || event.itemId === COOKIE_ITEM_ID) {
      add("曲奇还香着", "Cookie crumb comfort");
    } else if (event.behavior === "sleep") {
      add("刚睡醒软软的", "Rest counts too");
    } else if (event.behavior === "play") {
      add("手柄还在发光", "Game glow lingers");
    } else if (event.behavior === "paint") {
      add("画布还亮着", "Color stayed with me");
    } else if (event.behavior === "admire") {
      add("房间变好看了", "Room feels brighter");
    }
  }

  return candidates.slice(0, IDLE_BUBBLE_CANDIDATE_LIMIT);
};

const MAX_TRAIT_POINTS = 1_000_000;

const clampTrait = (value: number) =>
  Math.max(0, Math.min(MAX_TRAIT_POINTS, Math.round(value)));

const normalizedTraitChartValue = (value: number) => {
  const clampedValue = Math.max(0, Math.min(MAX_TRAIT_POINTS, value));
  const logValue = Math.log10(clampedValue + 1);
  const logMax = Math.log10(MAX_TRAIT_POINTS + 1);
  return Math.max(0, Math.min(1, logValue / logMax));
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
      socialBubbles: normalizeSocialBubbleSet(memory?.preferences?.socialBubbles),
      socialWillingness: clampSocialWillingness(
        memory?.preferences?.socialWillingness,
        fallback.preferences.socialWillingness,
      ),
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
  walkableCells: {},
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

const normalizeWalkableCellMap = (value: unknown): Record<string, 0 | 1> => {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, 0 | 1] => entry[1] === 0 || entry[1] === 1,
    ),
  );
};

const normalizeNavMemory = (
  navMemory?: Partial<AivatarNavMemory>,
): AivatarNavMemory => {
  const fallback = defaultNavMemory();
  return {
    exploredCells: normalizeCountMap(navMemory?.exploredCells),
    trickySpots: normalizeCountMap(navMemory?.trickySpots),
    walkableCells: normalizeWalkableCellMap(navMemory?.walkableCells),
    layoutFingerprint:
      typeof navMemory?.layoutFingerprint === "string"
        ? navMemory.layoutFingerprint
        : fallback.layoutFingerprint,
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
  layoutFingerprint?: string,
): AivatarNavMemory => {
  const normalized = normalizeNavMemory(navMemory);
  const walkableCells =
    layoutFingerprint &&
    normalized.layoutFingerprint &&
    normalized.layoutFingerprint !== layoutFingerprint
      ? {}
      : normalized.walkableCells;
  return {
    ...normalized,
    layoutFingerprint: layoutFingerprint ?? normalized.layoutFingerprint,
    walkableCells: {
      ...walkableCells,
      [cellKey]: 0,
    },
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
  layoutFingerprint?: string,
): AivatarNavMemory => {
  const normalized = recordExploredCell(navMemory, cellKey, layoutFingerprint);
  return {
    ...normalized,
    walkableCells: {
      ...normalized.walkableCells,
      [cellKey]: result === "failure" ? 1 : 0,
    },
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
  const agentName = agentDisplayName(status);
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
      ? `Recovered from a failed ${agentName} turn`
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
  const agentName = agentDisplayName(status);
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
        ? `Hit an error during a ${agentName} turn`
        : `Waited for user input during a ${agentName} turn`,
    agent: status.agent,
    sessionId: status.sessionId,
    status: status.status,
    traitChanges:
      status.status === "error" ? { resilience: 1 } : { focus: 1 },
  });
};

const recordSessionLearningMemory = (
  memory: AivatarMemory | undefined,
  status: CodexStatusMessage,
) => {
  const learning = status.learning;
  if (!learning || learning.privacyRisk === "high") return normalizeMemory(memory);

  const normalized = normalizeMemory(memory);
  const eventId = `learning:${status.agent ?? "agent"}:${status.sessionId ?? "default"}:${learning.id}`;
  if (normalized.recentEvents.some((event) => event.id === eventId)) {
    return normalized;
  }

  const traitChanges = learning.traitChanges ?? {};
  const xp = Math.max(1, Math.min(12, Math.round(learning.xp ?? 3)));
  const { memory: withXp, leveledUp } = applyGrowthXp(normalized, xp);
  const learnedMemory: AivatarMemory = {
    ...withXp,
    growth: {
      ...withXp.growth,
      traits: applyTraitChanges(withXp.growth.traits, traitChanges),
    },
  };
  const nextMemory = appendMemoryEvent(learnedMemory, {
    id: eventId,
    type: "session_learning",
    timestamp: status.timestamp,
    summary: learning.summary,
    agent: status.agent,
    sessionId: status.sessionId,
    status: status.status,
    xp,
    traitChanges,
  });

  if (!leveledUp) return nextMemory;

  return appendMemoryEvent(nextMemory, {
    id: `learning-level:${status.agent ?? "agent"}:${status.sessionId ?? "default"}:${learning.id}:${learnedMemory.growth.level}`,
    type: "level_up",
    timestamp: status.timestamp,
    summary: `Reached level ${learnedMemory.growth.level}`,
    agent: status.agent,
    sessionId: status.sessionId,
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
        event.behavior === "cookie" ||
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
  if (item.id === COOKIE_ITEM_ID) return { creativity: 1, warmth: 1 };
  return { resilience: 1, warmth: 1 };
};

const behaviorForConsumable = (item: Pick<ItemDefinition, "id">): BehaviorName =>
  item.id === COFFEE_ITEM_ID
    ? "coffee"
    : item.id === COLA_ITEM_ID
      ? "cola"
      : item.id === BENTO_ITEM_ID
        ? "bento"
        : item.id === COOKIE_ITEM_ID
          ? "cookie"
        : "interact";

const foodPreferenceScoreForConsumable = (
  item: Pick<ItemDefinition, "id" | "kind">,
  memory: AivatarMemory | undefined,
) => {
  if (item.kind !== "food") return 0;

  const normalized = memory ? normalizeMemory(memory) : undefined;
  const traits = normalized?.growth.traits;
  const affinity = normalized?.preferences.itemAffinities[item.id] ?? 0;

  if (item.id === COOKIE_ITEM_ID) {
    return (
      (traits?.creativity ?? 0) +
      (traits?.curiosity ?? 0) * 0.85 +
      (traits?.warmth ?? 0) * 0.25 +
      affinity * 8 +
      1
    );
  }

  if (item.id === BENTO_ITEM_ID) {
    return (
      (traits?.resilience ?? 0) +
      (traits?.focus ?? 0) * 0.65 +
      (traits?.efficiency ?? 0) * 0.5 +
      (traits?.warmth ?? 0) * 0.15 +
      affinity * 8 +
      2
    );
  }

  return affinity * 8;
};

const traitChangesForPurchase = (
  item: Pick<ItemDefinition, "kind" | "tags">,
): Partial<AivatarGrowthTraits> =>
  item.kind === "food" || item.kind === "drink" || item.kind === "tool"
    ? { efficiency: 1 }
    : { curiosity: 1, creativity: 1 };

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
  const reach = INTERACTION_ARRIVAL_DISTANCE;
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

type RoomVisitHostActivitySync = {
  visitId: string;
  behavior: BehaviorName;
  targetKey: string;
};

type RoomVisitHostSocialTarget = {
  behavior: BehaviorName;
  targetX: number;
  targetY: number;
  alternates?: { x: number; y: number }[];
  activityLabel: string;
  bubbleText: string;
};

type RoomVisitSocialLine = {
  speaker: AivatarVisitRole;
  bubble: AivatarSocialBubble;
  startedAt: number;
  endsAt: number;
};

type RoomVisitSocialExchangePlayback = {
  visitId: string;
  active: RoomVisitSocialLine;
  response: RoomVisitSocialLine;
  appliedLineIndex: number;
  completed: boolean;
};

const ROOM_VISIT_SOCIAL_SPACING = 44;
const ROOM_VISIT_TOO_CLOSE_DISTANCE = 18;
const ROOM_VISIT_HOST_REPLY_DELAY_MS = 2200;
const ROOM_VISIT_EXCHANGE_START_DELAY_MS = 700;
const ROOM_VISIT_EXCHANGE_LINE_DURATION_MS = 2600;
const ROOM_VISIT_EXCHANGE_LINE_GAP_MS = 360;
const ROOM_VISIT_EXCHANGE_COOLDOWN_MS = 2400;

const localizeRoomVisitBubbleText = (
  bubbleText: string | undefined,
  locale: Locale,
) =>
  bubbleText?.startsWith(ROOM_VISIT_BUBBLE_KEY_PREFIX)
    ? t(locale, bubbleText)
    : bubbleText;

const localizedInteractionBubble = (
  interaction: FurnitureInteractionState | null,
  locale: Locale,
): FurnitureInteractionState | null => {
  if (!interaction?.bubbleText) return interaction;
  const bubbleText = localizeRoomVisitBubbleText(interaction.bubbleText, locale);
  return bubbleText === interaction.bubbleText
    ? interaction
    : { ...interaction, bubbleText };
};

const localizedRoomVisitors = (
  visitors: AivatarRoomVisitor[],
  locale: Locale,
): AivatarRoomVisitor[] =>
  visitors.map((visitor) => {
    const bubbleText = localizeRoomVisitBubbleText(visitor.bubbleText, locale);
    return bubbleText === visitor.bubbleText ? visitor : { ...visitor, bubbleText };
  });

const ROOM_VISIT_SOCIAL_BEHAVIORS = new Set<BehaviorName>([
  "play",
  "coffee",
  "interact",
  "music",
  "relax",
  "admire",
  "wander",
]);

const clampRoomVisitPoint = (
  point: { x: number; y: number },
): { x: number; y: number } => ({
  x: Math.min(388, Math.max(92, point.x)),
  y: Math.min(292, Math.max(148, point.y)),
});

const nearestPlacedItemToPoint = (
  point: { x: number; y: number },
  candidates: PlacedItem[],
) =>
  [...candidates].sort(
    (left, right) =>
      Math.hypot(left.x - point.x, left.y - point.y) -
      Math.hypot(right.x - point.x, right.y - point.y),
  )[0];

const chooseCompanionStandpoint = (
  standpoints: { x: number; y: number }[],
  companionTarget: { x: number; y: number },
  fallback: { x: number; y: number },
) => {
  const points = standpoints.length > 0 ? standpoints : [fallback];
  return [...points].sort((left, right) => {
    const leftDistance = Math.hypot(
      left.x - companionTarget.x,
      left.y - companionTarget.y,
    );
    const rightDistance = Math.hypot(
      right.x - companionTarget.x,
      right.y - companionTarget.y,
    );
    const leftScore =
      Math.abs(leftDistance - ROOM_VISIT_SOCIAL_SPACING) +
      (leftDistance < ROOM_VISIT_TOO_CLOSE_DISTANCE ? 100 : 0);
    const rightScore =
      Math.abs(rightDistance - ROOM_VISIT_SOCIAL_SPACING) +
      (rightDistance < ROOM_VISIT_TOO_CLOSE_DISTANCE ? 100 : 0);
    return leftScore - rightScore;
  })[0];
};

const roomVisitBehaviorForVisitor = (visitor: AivatarRoomVisitor): BehaviorName =>
  visitor.runtime.actionIntent ?? visitor.runtime.behavior;

const roomVisitHostSocialTarget = (
  visitor: AivatarRoomVisitor,
  content: AivatarContent,
  hostRuntime: AvatarRuntime,
  activeRecordPlayerId?: string | null,
): RoomVisitHostSocialTarget | null => {
  const behavior = roomVisitBehaviorForVisitor(visitor);
  if (!ROOM_VISIT_SOCIAL_BEHAVIORS.has(behavior)) return null;

  const companionTarget = {
    x: visitor.runtime.targetX,
    y: visitor.runtime.targetY,
  };
  const fallbackNearVisitor = clampRoomVisitPoint({
    x:
      companionTarget.x +
      (hostRuntime.x <= companionTarget.x
        ? -ROOM_VISIT_SOCIAL_SPACING
        : ROOM_VISIT_SOCIAL_SPACING),
    y: companionTarget.y + 6,
  });

  if (behavior === "play") {
    const gameConsole = nearestPlacedItemToPoint(
      companionTarget,
      (content.placedItems ?? []).filter((item) => item.itemId === "game-console"),
    );
    if (gameConsole) {
      const standpoints = getPlacedItemInteractionStandpoints(gameConsole, content);
      const fallbackTarget = getPlacedItemInteractionTarget(gameConsole, content);
      const point = chooseCompanionStandpoint(standpoints, companionTarget, {
        x: fallbackTarget.targetX,
        y: fallbackTarget.targetY,
      });
      return {
        behavior,
        targetX: point.x,
        targetY: point.y,
        alternates: standpoints,
        activityLabel: "Playing together",
        bubbleText: roomVisitBubbleKeyForBehavior(behavior),
      };
    }
  }

  if (behavior === "coffee") {
    const table = content.room.furniture.find((item) => item.id === TABLE_FURNITURE_ID);
    if (table) {
      const standpoints = getFurnitureInteractionStandpoints(table, content, "coffee");
      const fallbackTarget = getFurnitureInteractionTarget(table, "coffee");
      const point = chooseCompanionStandpoint(standpoints, companionTarget, {
        x: fallbackTarget.targetX,
        y: fallbackTarget.targetY,
      });
      return {
        behavior,
        targetX: point.x,
        targetY: point.y,
        alternates: standpoints,
        activityLabel: "Coffee together",
        bubbleText: roomVisitBubbleKeyForBehavior(behavior),
      };
    }

    const coffeeSpot = nearestPlacedItemToPoint(
      companionTarget,
      (content.placedItems ?? []).filter(
        (item) =>
          item.itemId === COFFEE_CUP_ITEM_ID || item.itemId === COFFEE_MACHINE_ITEM_ID,
      ),
    );
    if (coffeeSpot) {
      const standpoints = getPlacedItemInteractionStandpoints(coffeeSpot, content);
      const fallbackTarget = getPlacedItemInteractionTarget(coffeeSpot, content);
      const point = chooseCompanionStandpoint(standpoints, companionTarget, {
        x: fallbackTarget.targetX,
        y: fallbackTarget.targetY,
      });
      return {
        behavior,
        targetX: point.x,
        targetY: point.y,
        alternates: standpoints,
        activityLabel: "Coffee together",
        bubbleText: roomVisitBubbleKeyForBehavior(behavior),
      };
    }
  }

  if (behavior === "music") {
    const recordPlayer = nearestPlacedItemToPoint(
      companionTarget,
      (content.placedItems ?? []).filter((item) => item.itemId === RECORD_PLAYER_ITEM_ID),
    );
    if (recordPlayer) {
      const standpoints = getPlacedItemInteractionStandpoints(recordPlayer, content);
      const fallbackTarget = getPlacedItemInteractionTarget(recordPlayer, content);
      const point = chooseCompanionStandpoint(standpoints, companionTarget, {
        x: fallbackTarget.targetX,
        y: fallbackTarget.targetY,
      });
      const hostBehavior = activeRecordPlayerId === recordPlayer.id ? "interact" : behavior;
      return {
        behavior: hostBehavior,
        targetX: point.x,
        targetY: point.y,
        alternates: standpoints,
        activityLabel: visitor.runtime.activityLabel ?? "Dancing together",
        bubbleText: roomVisitBubbleKeyForBehavior(behavior),
      };
    }
  }

  return {
    behavior,
    targetX: fallbackNearVisitor.x,
    targetY: fallbackNearVisitor.y,
    activityLabel:
      visitor.runtime.activityLabel ??
      (behavior === "interact"
        ? "Chatting"
        : behavior === "admire"
          ? "Looking around"
          : behavior === "relax"
            ? "Hanging out"
            : "Wandering together"),
    bubbleText:
      roomVisitBubbleKeyForBehavior(behavior),
  };
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
  const arrivalDistance = INTERACTION_ARRIVAL_DISTANCE;
  if (standpoints.length > 0) {
    return standpoints.some(
      (point) =>
        avatarFootprintTouchesPoint(avatar, point) ||
        Math.hypot(avatar.x - point.x, avatar.y - point.y) <=
          arrivalDistance,
    );
  }

  const { targetX, targetY } = getFurnitureInteractionTarget(furniture);
  return (
    avatarFootprintTouchesPoint(avatar, { x: targetX, y: targetY }) ||
    Math.hypot(avatar.x - targetX, avatar.y - targetY) <= arrivalDistance
  );
};

const ignoredFurnitureIdForPendingInteraction = (
  interaction: PendingWorldInteraction | null,
) => {
  if (!interaction) return undefined;
  if (interaction.target === "furniture") {
    return interaction.kind === "sleep" ? interaction.furniture.id : undefined;
  }
  return undefined;
};

const ignoredFurnitureIdForRuntimeInteraction = (
  avatar: AvatarRuntime,
  content: AivatarContent,
  pendingInteraction: PendingWorldInteraction | null,
) => {
  const pendingIgnoredId = ignoredFurnitureIdForPendingInteraction(pendingInteraction);
  if (pendingIgnoredId) return pendingIgnoredId;
  void avatar;
  void content;
  return undefined;
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

type PlacedItemInteractionKind =
  | "brew"
  | "paint"
  | "play"
  | "music"
  | "stop-music"
  | "interact";

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
      kind: PlacedItemInteractionKind;
    };

const runtimeActionBehavior = (avatar: AvatarRuntime): BehaviorName =>
  avatar.actionIntent ?? avatar.behavior;

const hasPlacedRecordPlayer = (content: AivatarContent) =>
  Boolean(content.placedItems?.some((item) => item.itemId === RECORD_PLAYER_ITEM_ID));

const avatarRuntimeHasFiniteNavigation = (avatar: AvatarRuntime) =>
  [
    avatar.x,
    avatar.y,
    avatar.targetX,
    avatar.targetY,
    avatar.behaviorTimer,
  ].every(Number.isFinite);

const resetRuntimeToIdle = (avatar: AvatarRuntime): AvatarRuntime => ({
  ...avatar,
  targetX: avatar.x,
  targetY: avatar.y,
  behavior: "idle",
  behaviorTimer: 0,
  expression: "calm",
  activityLabel: undefined,
  actionIntent: undefined,
  actionActivityLabel: undefined,
  interactionTargetAlternates: undefined,
  navigationFailure: undefined,
});

type SceneContextMenuState = {
  x: number;
  y: number;
  target:
    | {
        kind: "placed-item";
        placedItem: PlacedItem;
        item: ItemDefinition;
        action: PlacedItemInteractionKind;
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

const skinTargetFromContent = (
  content: AivatarContent,
  targetId: string | undefined,
) => {
  if (!targetId) return null;

  const furniture = content.room.furniture.find((candidate) => candidate.id === targetId);
  if (furniture) {
    return { id: furniture.id, name: furniture.name };
  }

  const placedItem = content.placedItems?.find((candidate) => candidate.id === targetId);
  if (!placedItem) return null;

  const definition = findItemDefinition(content, placedItem.itemId);
  return {
    id: placedItem.id,
    name: definition?.name ?? placedItem.itemId,
  };
};

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
  const x = placedItem.x - FILE_CABINET_PLACED_ITEM_OFFSET_X;
  const y = placedItem.y - FILE_CABINET_PLACED_ITEM_OFFSET_Y;

  return {
    id: TASK_CABINET_FURNITURE_ID,
    name: definition?.name ?? "File Cabinet",
    tags: ["furniture", "file-cabinet"],
    placementSurfaces: ["floor"],
    zone: "office",
    x,
    y,
    width: FILE_CABINET_FURNITURE_WIDTH,
    height: FILE_CABINET_FURNITURE_HEIGHT,
    color: "#54606f",
    interaction: "interact",
    collision: {
      x: x + FILE_CABINET_COLLISION_INSET_X,
      y: y + FILE_CABINET_FURNITURE_HEIGHT - FILE_CABINET_COLLISION_DEPTH,
      width: FILE_CABINET_FURNITURE_WIDTH - FILE_CABINET_COLLISION_INSET_X * 2,
      height: FILE_CABINET_COLLISION_DEPTH,
    },
  };
};

const isTerminalOnDesktopSurface = (
  terminal: Pick<PlacedItem, "x" | "y">,
  surface: FurnitureDefinition,
) =>
  surface.id === "file-cabinet"
    ? terminal.x >= surface.x + FILE_CABINET_TOP_HIT_INSET_X &&
      terminal.x <= surface.x + surface.width - FILE_CABINET_TOP_HIT_INSET_X &&
      terminal.y >= surface.y + FILE_CABINET_TOP_HIT_Y_OFFSET &&
      terminal.y <= surface.y + FILE_CABINET_TOP_HIT_Y_OFFSET + FILE_CABINET_TOP_HIT_DEPTH
    : (surface.id === "desk" || surface.id === "table") &&
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

const createEntityId = (prefix: string) => {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `${prefix}-${randomId}`;

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const createAvatarId = () => createEntityId("avatar");
const createRoomId = () => createEntityId("room");
const createSaveSlotId = () => createEntityId("slot");

const normalizeAvatarId = (avatarId: unknown) =>
  typeof avatarId === "string" && avatarId.trim().length > 0
    ? avatarId
    : createAvatarId();

const normalizeRoomId = (roomId: unknown) =>
  typeof roomId === "string" && roomId.trim().length > 0 ? roomId : createRoomId();

const isAvatarAppearanceId = (value: unknown): value is AvatarAppearanceId =>
  REGISTERED_AVATAR_APPEARANCES.some((appearance) => appearance.id === value);

const normalizeAvatarAppearanceId = (appearanceId: unknown): AvatarAppearanceId =>
  isAvatarAppearanceId(appearanceId) ? appearanceId : DEFAULT_AVATAR_APPEARANCE_ID;

const saveSlotStorageKey = (slotId: string) => `${SAVE_SLOT_KEY_PREFIX}${slotId}`;

const normalizeFurnitureSkinIds = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        entry[0].trim().length > 0 &&
        typeof entry[1] === "string" &&
        entry[1].trim().length > 0,
    ),
  );
};

const saveFromContent = (
  content: AivatarContent,
  options: {
    avatarId?: string;
    roomId?: string;
    avatarAppearanceId?: AvatarAppearanceId;
    avatarName?: string;
  } = {},
): AivatarSaveState => ({
  layoutVersion: SAVE_LAYOUT_VERSION,
  avatarId: options.avatarId ?? createAvatarId(),
  roomId: options.roomId ?? createRoomId(),
  avatarAppearanceId: options.avatarAppearanceId ?? DEFAULT_AVATAR_APPEARANCE_ID,
  avatarName: options.avatarName?.trim() || content.avatar.name,
  memory: defaultMemory(),
  navMemory: defaultNavMemory(),
  paintingGallery: normalizePaintingGallery(),
  petStats: content.petStats,
  inventory: removeDeprecatedInventoryItems(content.inventory),
  furnitureStorage: defaultFurnitureStorage(),
  ...loadDefaultLayout(content),
  wallet: content.wallet,
  purchasedItemIds: [],
  activeFurnitureSkinIds: {},
});

const normalizeSavePayload = (
  content: AivatarContent,
  parsed: Partial<AivatarSaveState>,
): AivatarSaveState => {
  const fallback: AivatarSaveState = {
    ...saveFromContent(content),
    purchasedItemIds: [],
  };
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
    roomId: normalizeRoomId(parsed.roomId),
    avatarAppearanceId: normalizeAvatarAppearanceId(parsed.avatarAppearanceId),
    furnitureStorage: normalizeFurnitureStorage(parsed.furnitureStorage),
    memory: normalizeMemory(parsed.memory),
    navMemory: normalizeNavMemory(parsed.navMemory),
    paintingGallery: normalizePaintingGallery(parsed.paintingGallery),
    activeFurnitureSkinIds: normalizeFurnitureSkinIds(parsed.activeFurnitureSkinIds),
    inventory: removeDeprecatedInventoryItems(
      parsed.inventory ?? fallback.inventory,
    ),
    placedItems,
    furniturePlacements,
    layoutVersion: SAVE_LAYOUT_VERSION,
  };
};

const loadSave = (content: AivatarContent, storageKey = SAVE_KEY): AivatarSaveState => {
  const fallback: AivatarSaveState = {
    ...saveFromContent(content),
    purchasedItemIds: [],
  };

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<AivatarSaveState>;
    return normalizeSavePayload(content, parsed);
  } catch {
    return fallback;
  }
};

const persistSave = (save: AivatarSaveState, storageKey = SAVE_KEY) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(save));
  } catch (error) {
    console.warn("Could not persist Aivatar save.", error);
  }
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseImportedSave = (content: AivatarContent, raw: string): AivatarSaveState | null => {
  const parsed = JSON.parse(raw);
  if (!isPlainRecord(parsed)) return null;

  const recognizableKeys = [
    "avatarId",
    "roomId",
    "avatarName",
    "petStats",
    "inventory",
    "placedItems",
    "wallet",
    "memory",
    "paintingGallery",
  ];
  if (!recognizableKeys.some((key) => key in parsed)) return null;

  return normalizeSavePayload(content, parsed as Partial<AivatarSaveState>);
};

const normalizeSaveSlotIndex = (value: unknown, fallback: number) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < MAX_SAVE_SLOTS
    ? value
    : fallback;

const normalizeSaveSlotDate = (value: unknown, fallback: string) =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback;

const normalizeSaveSlotSummary = (
  value: unknown,
  fallbackIndex: number,
): SaveSlotSummary | null => {
  if (!isPlainRecord(value)) return null;

  const now = new Date().toISOString();
  const id = typeof value.id === "string" && value.id.trim() ? value.id : null;
  const avatarId =
    typeof value.avatarId === "string" && value.avatarId.trim() ? value.avatarId : null;
  const roomId =
    typeof value.roomId === "string" && value.roomId.trim() ? value.roomId : null;
  if (!id || !avatarId || !roomId) return null;

  const avatarName =
    typeof value.avatarName === "string" && value.avatarName.trim()
      ? value.avatarName.trim()
      : "Codex";

  return {
    id,
    slotIndex: normalizeSaveSlotIndex(value.slotIndex, fallbackIndex),
    avatarId,
    roomId,
    avatarName,
    avatarAppearanceId: normalizeAvatarAppearanceId(value.avatarAppearanceId),
    createdAt: normalizeSaveSlotDate(value.createdAt, now),
    updatedAt: normalizeSaveSlotDate(value.updatedAt, now),
  };
};

const readSaveSlots = () => {
  try {
    const raw = localStorage.getItem(SAVE_SLOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const byIndex = new Map<number, SaveSlotSummary>();
    parsed
      .map((entry, index) => normalizeSaveSlotSummary(entry, index))
      .filter((entry): entry is SaveSlotSummary => Boolean(entry))
      .forEach((entry) => {
        if (!byIndex.has(entry.slotIndex)) byIndex.set(entry.slotIndex, entry);
      });

    return [...byIndex.values()].sort((a, b) => a.slotIndex - b.slotIndex);
  } catch {
    return [];
  }
};

const writeSaveSlots = (slots: SaveSlotSummary[]) => {
  const sortedSlots = slots
    .filter((slot) => slot.slotIndex >= 0 && slot.slotIndex < MAX_SAVE_SLOTS)
    .sort((a, b) => a.slotIndex - b.slotIndex);

  try {
    localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(sortedSlots));
  } catch (error) {
    console.warn("Could not persist Aivatar save slots.", error);
  }
};

const createSaveSlotSummary = (
  id: string,
  slotIndex: number,
  save: AivatarSaveState,
  timestamp: string,
): SaveSlotSummary => ({
  id,
  slotIndex,
  avatarId: normalizeAvatarId(save.avatarId),
  roomId: normalizeRoomId(save.roomId),
  avatarName: save.avatarName?.trim() || "Codex",
  avatarAppearanceId: normalizeAvatarAppearanceId(save.avatarAppearanceId),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const updateSaveSlotSummaryFromSave = (
  slot: SaveSlotSummary,
  save: AivatarSaveState,
  timestamp: string,
): SaveSlotSummary => ({
  ...slot,
  avatarId: normalizeAvatarId(save.avatarId),
  roomId: normalizeRoomId(save.roomId),
  avatarName: save.avatarName?.trim() || slot.avatarName,
  avatarAppearanceId: normalizeAvatarAppearanceId(save.avatarAppearanceId),
  updatedAt: timestamp,
});

const resolveActiveSaveSlotId = (slots: SaveSlotSummary[]) => {
  const activeSlotId = localStorage.getItem(ACTIVE_SAVE_SLOT_KEY);
  if (activeSlotId && slots.some((slot) => slot.id === activeSlotId)) {
    return activeSlotId;
  }

  return slots[0]?.id ?? null;
};

const resolveRequestedSaveSlotId = (slots: SaveSlotSummary[]) => {
  try {
    const requestedSlotId = new URLSearchParams(window.location.search)
      .get("slotId")
      ?.trim();
    if (requestedSlotId && slots.some((slot) => slot.id === requestedSlotId)) {
      return requestedSlotId;
    }
  } catch {
    // Web or test environments without a normal location fall back to the default slot.
  }

  return null;
};

const persistActiveSaveSlotId = (slotId: string | null) => {
  try {
    if (slotId) {
      localStorage.setItem(ACTIVE_SAVE_SLOT_KEY, slotId);
    } else {
      localStorage.removeItem(ACTIVE_SAVE_SLOT_KEY);
    }
  } catch (error) {
    console.warn("Could not persist active Aivatar save slot.", error);
  }
};

const ensureSaveSlotRegistry = (content: AivatarContent) => {
  const existingSlots = readSaveSlots();
  if (existingSlots.length > 0) return existingSlots;

  const legacyRaw = localStorage.getItem(SAVE_KEY);
  if (!legacyRaw) return [];

  const slotId = createSaveSlotId();
  const migratedSave = loadSave(content, SAVE_KEY);
  const timestamp = new Date().toISOString();
  const migratedSlot = createSaveSlotSummary(slotId, 0, migratedSave, timestamp);

  persistSave(migratedSave, saveSlotStorageKey(slotId));
  writeSaveSlots([migratedSlot]);
  persistActiveSaveSlotId(slotId);

  return [migratedSlot];
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
  const normalizedValue = taskScheduleRunAtToDatetimeLocal(value);
  if (!normalizedValue) return undefined;
  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const isoToDatetimeLocal = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
};

type TaskScheduleRunAtPart = "date" | "hour" | "minute";

type TaskScheduleRunAtParts = {
  date: string;
  hour: string;
  minute: string;
};

const emptyTaskScheduleRunAtParts = (): TaskScheduleRunAtParts => ({
  date: "",
  hour: "",
  minute: "",
});

const taskScheduleRunAtParts = (value?: string): TaskScheduleRunAtParts => {
  if (!value) return emptyTaskScheduleRunAtParts();
  const partialMatch = value.match(
    /^(\d{0,4}(?:-\d{0,2}(?:-\d{0,2})?)?)(?:T(\d{0,2})(?::(\d{0,2})?)?)?$/,
  );
  if (partialMatch) {
    return {
      date: partialMatch[1] ?? "",
      hour: partialMatch[2] ?? "",
      minute: partialMatch[3] ?? "",
    };
  }

  const datetimeLocal = isoToDatetimeLocal(value);
  if (!datetimeLocal) return emptyTaskScheduleRunAtParts();
  const [date = "", time = ""] = datetimeLocal.split("T");
  const [hour = "", minute = ""] = time.split(":");
  return { date, hour, minute };
};

const taskScheduleRunAtFromParts = ({
  date,
  hour,
  minute,
}: TaskScheduleRunAtParts) => {
  if (!date && !hour && !minute) return undefined;
  return `${date}${
    hour || minute ? `T${hour}${minute ? `:${minute}` : ""}` : ""
  }`;
};

const taskScheduleRunAtToDatetimeLocal = (value: string) => {
  const { date, hour, minute } = taskScheduleRunAtParts(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}$/.test(hour) ||
    !/^\d{2}$/.test(minute)
  ) {
    return undefined;
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hourNumber > 23 ||
    minuteNumber > 59
  ) {
    return undefined;
  }
  const localDate = new Date(year, month - 1, day, hourNumber, minuteNumber);
  if (
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day
  ) {
    return undefined;
  }
  return `${date}T${hour}:${minute}`;
};

const formatTaskScheduleDateInput = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
};

const formatTaskScheduleTimeInput = (value: string) =>
  value.replace(/\D/g, "").slice(0, 2);

const normalizeTaskScheduleTimeInput = (value: string, max: number) => {
  const digits = formatTaskScheduleTimeInput(value);
  if (!digits) return "";
  return String(Math.min(max, Number(digits))).padStart(2, "0");
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

const settleTaskScheduleAfterAttempt = (
  schedule: TaskCabinetSchedule | undefined,
  attemptedAtMs = Date.now(),
): TaskCabinetSchedule | undefined => {
  if (!schedule) return undefined;
  const attemptedAt = new Date(attemptedAtMs).toISOString();
  if (schedule.mode === "repeat" && schedule.enabled) {
    const intervalMs =
      normalizeTaskCabinetIntervalMinutes(schedule.intervalMinutes) * 60000;
    return {
      ...schedule,
      enabled: true,
      lastRunAt: attemptedAt,
      nextRunAt: new Date(attemptedAtMs + intervalMs).toISOString(),
    };
  }
  return {
    ...schedule,
    enabled: false,
    lastRunAt: attemptedAt,
    nextRunAt: undefined,
  };
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
  formatCopy: (key: string, params?: Record<string, string | number>) => string,
) => {
  if (!schedule?.enabled) return formatCopy("schedule.off");
  if (!schedule.nextRunAt) return formatCopy("schedule.nextNotSet");
  const nextMs = Date.parse(schedule.nextRunAt);
  if (Number.isNaN(nextMs)) return formatCopy("schedule.nextNotSet");
  if (nextMs <= nowMs) return formatCopy("schedule.dueNow");
  return formatCopy("schedule.next", {
    value: new Date(schedule.nextRunAt).toLocaleString(),
  });
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

const taskCabinetSceneCounts = (entries: TaskCabinetEntry[]) => {
  let activeFileCount = 0;
  let failedFileCount = 0;
  let readyCount = 0;
  let runningCount = 0;

  entries.forEach((entry) => {
    if (entry.status === "ready") {
      activeFileCount += 1;
      readyCount += 1;
    } else if (entry.status === "failed") {
      activeFileCount += 1;
      failedFileCount += 1;
    } else if (entry.status === "running") {
      runningCount += 1;
    }
  });

  return {
    activeFileCount,
    failedFileCount,
    readyCount,
    runningCount,
  };
};

const taskCabinetFileName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const isTaskCabinetExitIdle = (session: CodexStatusMessage | undefined) => {
  if (!session || session.status !== "idle") return false;
  const message = session.message ?? session.summary ?? session.task ?? "";
  if (/^Running\s+/i.test(message)) return false;
  if (session.phase === "session-start" || session.phase === "presence") return false;
  return (
    session.phase === "idle" ||
    session.phase === "other" ||
    /disconnected|session ended|exited/i.test(message)
  );
};

const isClaudeLifecycleOnlyIdleSession = (session: CodexStatusMessage) => {
  if (session.agent !== "claude-code" || session.status !== "idle") return false;
  if (session.usage || session.learning) return false;
  const phase = session.phase ?? "";
  const message = session.message ?? session.summary ?? session.task ?? "";
  return (
    phase === "session-start" ||
    phase === "session-end" ||
    phase === "other" ||
    /Claude Code session (connected|ended)/i.test(message)
  );
};

const isTaskCabinetLiveWorkStatus = (status: CodexStatusMessage) =>
  status.status === "thinking" ||
  status.status === "executing" ||
  status.status === "waiting_for_user";

const fallbackActiveWindowIdAfterRemoving = (
  content: AivatarContent,
  removedWindowId: string,
  inventory: InventoryEntry[],
  purchasedItemIds: string[],
) =>
  content.room.windows?.find(
    (windowDefinition) =>
      windowDefinition.id !== removedWindowId &&
      purchasedItemIds.includes(windowDefinition.id) &&
      getInventoryQuantity(inventory, windowDefinition.id) <= 0,
  )?.id ??
  content.room.windows?.find(
    (windowDefinition) => windowDefinition.id !== removedWindowId,
  )?.id ??
  content.room.windows?.[0]?.id;

type TaskCabinetVisualFlow = {
  sessionId: string;
  taskName: string;
  phase: "fetch" | "carry" | "read";
  phaseStartedAt: number;
  actionStartedAt?: number;
  terminalStatus?: "complete" | "error";
  terminalAt?: number;
};

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scenePanelRef = useRef<HTMLElement | null>(null);
  const roomEditPanelRef = useRef<HTMLElement | null>(null);
  const initialSaveSlotsRef = useRef<SaveSlotSummary[] | null>(null);
  const initialActiveSaveSlotIdRef = useRef<string | null>(null);
  const initialRequestedSaveSlotIdRef = useRef<string | null>(null);
  const initialSaveRef = useRef<AivatarSaveState | null>(null);
  const loadInitialSaveSlots = () => {
    if (!initialSaveSlotsRef.current) {
      initialSaveSlotsRef.current = ensureSaveSlotRegistry(defaultContent);
      initialRequestedSaveSlotIdRef.current = resolveRequestedSaveSlotId(
        initialSaveSlotsRef.current,
      );
      initialActiveSaveSlotIdRef.current = resolveActiveSaveSlotId(
        initialSaveSlotsRef.current,
      );
      initialActiveSaveSlotIdRef.current =
        initialRequestedSaveSlotIdRef.current ?? initialActiveSaveSlotIdRef.current;
    }
    return initialSaveSlotsRef.current;
  };
  const loadInitialSave = () => {
    if (!initialSaveRef.current) {
      loadInitialSaveSlots();
      initialSaveRef.current = initialActiveSaveSlotIdRef.current
        ? loadSave(
            defaultContent,
            saveSlotStorageKey(initialActiveSaveSlotIdRef.current),
          )
        : saveFromContent(defaultContent);
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
  const [activeRecordPlayerId, setActiveRecordPlayerId] = useState<string | null>(null);
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
  const activeRecordPlayerIdRef = useRef<string | null>(null);
  const activeRecordPlayerStartedAtRef = useRef<number | null>(null);
  const autonomousCoffeeCooldownUntilRef = useRef(0);
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
  const activeSaveSlotIdRef = useRef<string | null>(initialActiveSaveSlotIdRef.current);
  const hadSavedStateRef = useRef(initialActiveSaveSlotIdRef.current !== null);
  const [saveSlots, setSaveSlots] = useState<SaveSlotSummary[]>(() =>
    loadInitialSaveSlots(),
  );
  const saveSlotsRef = useRef(saveSlots);
  const [activeSaveSlotId, setActiveSaveSlotId] = useState<string | null>(
    () => initialActiveSaveSlotIdRef.current,
  );
  const [saveMenuOpen, setSaveMenuOpen] = useState(
    () => !initialRequestedSaveSlotIdRef.current,
  );
  const saveMenuOpenRef = useRef(!initialRequestedSaveSlotIdRef.current);
  const [saveMenuOpenedFromRoom, setSaveMenuOpenedFromRoom] = useState(false);
  const [creatingSaveSlotIndex, setCreatingSaveSlotIndex] = useState<number | null>(
    saveSlots.length === 0 ? 0 : null,
  );
  const [selectedAvatarAppearanceId, setSelectedAvatarAppearanceId] =
    useState<AvatarAppearanceId>(DEFAULT_AVATAR_APPEARANCE_ID);
  const [newSaveAvatarName, setNewSaveAvatarName] = useState(defaultContent.avatar.name);
  const [deleteSaveSlot, setDeleteSaveSlot] = useState<SaveSlotSummary | null>(null);
  const [saveSlotMessage, setSaveSlotMessage] = useState("");
  const [contentBase, setContentBase] = useState(defaultContent);
  const [configState, setConfigState] = useState<"builtin" | "config" | "fallback">(
    "builtin",
  );
  const [activeShopCategory, setActiveShopCategory] =
    useState<ShopCategoryId>("furniture");
  const [activeDecorSurfaceCategory, setActiveDecorSurfaceCategory] =
    useState<DecorSurfaceCategoryId>("wallpaper");
  const [decorPanelOpen, setDecorPanelOpen] = useState(false);
  const [paintingGalleryPanelOpen, setPaintingGalleryPanelOpen] = useState(false);
  const [soundPanelOpen, setSoundPanelOpen] = useState(false);
  const [growthPanelOpen, setGrowthPanelOpen] = useState(false);
  const [sessionsPanelOpen, setSessionsPanelOpen] = useState(false);
  const [integrationsPanelOpen, setIntegrationsPanelOpen] = useState(false);
  const [taskCabinetPanelOpen, setTaskCabinetPanelOpen] = useState(false);
  const [launcherPanelOpen, setLauncherPanelOpen] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [navDebugOverlay, setNavDebugOverlay] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [sidePanelAnimating, setSidePanelAnimating] = useState(false);
  const [scenePanelWidth, setScenePanelWidth] = useState<number | null>(null);
  const previousExpandedWindowWidthRef = useRef(DEFAULT_EXPANDED_WINDOW_WIDTH);
  const sidePanelTimerRef = useRef<number | null>(null);
  const [save, setSave] = useState<AivatarSaveState>(() => loadInitialSave());
  const saveRef = useRef(save);
  const updateSaveSlotSummary = (
    slotId: string,
    savedState: AivatarSaveState,
    syncState = true,
  ) => {
    const timestamp = new Date().toISOString();
    const nextSlots = saveSlotsRef.current.map((slot) =>
      slot.id === slotId ? updateSaveSlotSummaryFromSave(slot, savedState, timestamp) : slot,
    );

    saveSlotsRef.current = nextSlots;
    writeSaveSlots(nextSlots);
    if (syncState) setSaveSlots(nextSlots);
  };
  const persistCurrentSaveSlot = (syncState = true) => {
    const slotId = activeSaveSlotIdRef.current;
    if (!slotId) return;

    const savedState = {
      ...saveRef.current,
      avatarRuntime: runtimeRef.current,
    };
    persistSave(savedState, saveSlotStorageKey(slotId));
    updateSaveSlotSummary(slotId, savedState, syncState);
  };
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale());
  const [uiTheme, setUiTheme] = useState<UiThemeId>(() => loadInitialUiTheme());
  const [audioVolume, setAudioVolume] = useState(() => loadInitialAudioVolume());
  const [gameConsoleVolume, setGameConsoleVolume] = useState(() =>
    loadInitialGameConsoleVolume(),
  );
  const [startupSoundEnabled, setStartupSoundEnabled] = useState(() =>
    loadInitialStartupSoundEnabled(),
  );
  const [bgmVolume, setBgmVolume] = useState(() => loadInitialBgmVolume());
  const [bgmTrackId, setBgmTrackId] = useState<BgmTrackId>(() =>
    loadInitialBgmTrackId(),
  );
  const [autoMusicEnabled, setAutoMusicEnabled] = useState(() =>
    loadInitialAutoMusicEnabled(),
  );
  const [alwaysOnTopEnabled, setAlwaysOnTopEnabled] = useState(() =>
    loadInitialAlwaysOnTopEnabled(),
  );
  const localeRef = useRef(locale);
  const uiThemeRef = useRef(uiTheme);
  const autoMusicEnabledRef = useRef(autoMusicEnabled);
  const keyboardTypingAudioRef = useRef<HTMLAudioElement | null>(null);
  const coffeeMachineBrewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fridgeDoorOpenAudioRef = useRef<HTMLAudioElement | null>(null);
  const fridgeDoorCloseAudioRef = useRef<HTMLAudioElement | null>(null);
  const fridgeDoorAudioInteractionRef = useRef<{
    key: string;
    closePlayed: boolean;
  } | null>(null);
  const agentCompleteAudioRef = useRef<HTMLAudioElement | null>(null);
  const bitsSpendAudioRef = useRef<HTMLAudioElement | null>(null);
  const shopPurchaseCooldownUntilRef = useRef<Record<string, number>>({});
  const shopLongPressTimerRef = useRef<number | null>(null);
  const shopLongPressTriggeredRef = useRef(false);
  const shopLongPressTriggeredItemIdRef = useRef<string | null>(null);
  const gameConsoleAudioRef = useRef<HTMLAudioElement | null>(null);
  const gameConsoleAudioSourceRef = useRef(GAME_CONSOLE_AUDIO_SOURCES[0]);
  const gameConsoleAnimatingRef = useRef(false);
  const colaCanOpenAudioRef = useRef<HTMLAudioElement | null>(null);
  const colaSippingAudioRef = useRef(false);
  const colaDrinkAudioRef = useRef<HTMLAudioElement | null>(null);
  const colaDrinkAudioTimeoutRef = useRef<number | null>(null);
  const coffeeDrinkAudioRef = useRef<HTMLAudioElement | null>(null);
  const coffeeSippingAudioRef = useRef(false);
  const bentoEatAudioRef = useRef<HTMLAudioElement | null>(null);
  const bentoEatingAudioRef = useRef(false);
  const sleepSnoreAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const startupSoundPlayedRef = useRef(false);
  const bgmAudioContextRef = useRef<AudioContext | null>(null);
  const bgmGainRef = useRef<GainNode | null>(null);
  const bgmOscillatorRef = useRef<OscillatorNode | null>(null);
  const bgmStepTimeoutRef = useRef<number | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgmTrackIdRef = useRef<BgmTrackId>(bgmTrackId);
  const bgmPlayingRef = useRef(false);
  const bgmStepRef = useRef(0);
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
    disconnectSession,
  } = useCodexStatus();
  const [debugStatus, setDebugStatus] = useState<CodexStatusMessage | null>(null);
  const [windowTimePreview, setWindowTimePreview] = useState(false);
  const [windowPreviewHour, setWindowPreviewHour] = useState<number | null>(null);
  const windowTimePreviewRef = useRef(false);
  const windowPreviewHourRef = useRef<number | null>(null);
  const navDebugOverlayRef = useRef(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [bridgeStartMessage, setBridgeStartMessage] = useState("");
  const [taskCabinetEntries, setTaskCabinetEntries] = useState<TaskCabinetEntry[]>(
    () => loadTaskCabinetEntries(),
  );
  const taskCabinetCounts = useMemo(
    () => taskCabinetSceneCounts(taskCabinetEntries),
    [taskCabinetEntries],
  );
  const [taskCabinetPathInput, setTaskCabinetPathInput] = useState("");
  const [taskCabinetMessage, setTaskCabinetMessage] = useState("");
  const [launcherDirectory, setLauncherDirectory] = useState("");
  const [launcherAgent, setLauncherAgent] = useState<LauncherAgentId>("codex");
  const [launcherArgs, setLauncherArgs] = useState("");
  const [launcherAllowNewSession, setLauncherAllowNewSession] = useState(false);
  const [launcherMessage, setLauncherMessage] = useState("");
  const [agentIntegrations, setAgentIntegrations] = useState<AgentIntegrationStatus[]>([]);
  const [agentIntegrationsChecked, setAgentIntegrationsChecked] = useState(false);
  const [agentIntegrationMessage, setAgentIntegrationMessage] = useState("");
  const effectiveStatus = debugStatus ?? status;
  const effectiveSource = debugStatus ? "debug" : source;
  const statusRef = useRef({ status: effectiveStatus, source: effectiveSource, endpoint });
  const taskCabinetEntriesRef = useRef(taskCabinetEntries);
  const taskCabinetSceneCountsRef = useRef(taskCabinetCounts);
  const taskCabinetLaunchingRef = useRef(false);
  const taskCabinetTerminalStatusRef = useRef(
    new Map<string, "complete" | "error">(),
  );
  const taskCabinetVisualFlowRef = useRef<TaskCabinetVisualFlow | null>(null);
  const rewardedCompleteKeysRef = useRef(new Set<string>());
  const appliedLearningIdsRef = useRef(new Set<string>());
  const paintingPlanRequestsRef = useRef(new Set<string>());
  const behaviorDemoTimerRef = useRef<number | null>(null);
  const previousSessionStatusRef = useRef(
    new Map<string, CodexStatusMessage["status"]>(),
  );
  const roomInstanceIdRef = useRef(createRoomInstanceId());
  const [roomSnapshot, setRoomSnapshot] = useState<AivatarRoomsSnapshot | null>(null);
  const roomSnapshotRef = useRef<AivatarRoomsSnapshot | null>(null);
  const [roomVisitMenuOpen, setRoomVisitMenuOpen] = useState(false);
  const roomVisitMenuOpenRef = useRef(false);
  const [roomVisitMessage, setRoomVisitMessage] = useState("");
  const [activeVisit, setActiveVisit] = useState<AivatarVisitSession | null>(null);
  const activeVisitRef = useRef<AivatarVisitSession | null>(null);
  const [roomVisitor, setRoomVisitor] = useState<AivatarRoomVisitor | null>(null);
  const roomVisitorRef = useRef<AivatarRoomVisitor | null>(null);
  const [avatarAway, setAvatarAway] = useState(false);
  const avatarAwayRef = useRef(false);
  const handledVisitIdsRef = useRef(new Set<string>());
  const completedVisitIdsRef = useRef(new Set<string>());
  const socialRoomMemoryRef = useRef<AivatarSocialRoomMemory | null>(null);
  const activeVisitRelationshipRef = useRef<AivatarSocialRelationship | null>(null);
  const socialRoomMemoryWriteAtRef = useRef(0);
  const roomVisitHostActivityRef = useRef<RoomVisitHostActivitySync | null>(null);
  const visitStatePostedAtRef = useRef(0);
  const visitHostStartedAtRef = useRef(0);
  const autonomousRoomVisitCooldownUntilRef = useRef(0);
  const roomVisitSocialExchangeRef = useRef<RoomVisitSocialExchangePlayback | null>(null);
  const roomVisitNextExchangeAtRef = useRef(0);
  const roomVisitRecentIntentIdsRef = useRef<string[]>([]);
  const roomSnapshotFailuresRef = useRef(0);

  const content = useMemo(
    () => {
      const windowPlacements = save.windowPlacements ?? [];
      const furniturePlacements = withoutLegacyTerminalFurniturePlacements(
        save.furniturePlacements,
      );
      const activeFurnitureSkinIds = save.activeFurnitureSkinIds ?? {};
      const baseFurniture = furnitureWithPlacements(contentBase, furniturePlacements).map(
        (item) => {
          const skinId = activeFurnitureSkinIds[item.id];
          return skinId ? { ...item, skinId } : item;
        },
      );
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
        const attachedItem = attachedPlacedItemPosition(item, surface);
        const skinId = activeFurnitureSkinIds[attachedItem.id];

        return skinId ? { ...attachedItem, skinId } : attachedItem;
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
  const configStateLabel = ui(`config.${configState}`);
  const taskCabinetStatusLabel = (status: TaskCabinetStatus) =>
    ui(`taskCabinet.status.${status}`);
  const taskCabinetRunProfileLabel = (profile: TaskCabinetRunProfile) =>
    ui(`profile.${profile}`);
  const taskCabinetScheduleModeLabel = (mode: TaskCabinetScheduleMode) =>
    ui(`schedule.${mode}`);
  const taskCabinetScheduleConditionLabel = (
    condition: TaskCabinetScheduleCondition,
  ) =>
    condition === "only_idle"
      ? ui("schedule.onlyIdle")
      : condition === "after_success"
        ? ui("schedule.afterSuccess")
        : ui("schedule.always");
  const sourceLabel =
    effectiveSource === "websocket"
      ? ui("source.websocket")
      : effectiveSource === "debug"
        ? ui("source.debug")
        : ui("source.simulated");
  const visibleSessions = sessions.filter(
    (session) => !isClaudeLifecycleOnlyIdleSession(session),
  );
  const sessionRows = visibleSessions.slice(0, 6).map((session) => ({
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
  const enabledIntegrationCount = agentIntegrations.filter(
    (integration) => integration.enabled,
  ).length;
  const detectedIntegrationCount = agentIntegrations.filter(
    (integration) => integration.detected,
  ).length;
  const integrationToggleStatus =
    !agentIntegrationsChecked
      ? ui("integrations.checking")
      : agentIntegrations.length === 0
        ? ui("integrations.desktopOnlyShort")
        : `${enabledIntegrationCount}/${agentIntegrations.length} ${ui("integrations.enabledShort")}`;
  const currentSessionContextMeter =
    sessionRows.find((session) => session.sessionKey === currentSessionKey)
      ?.contextMeter ??
    sessionRows.find((session) => session.sessionKey === connectedSessionKey)
      ?.contextMeter ??
    sessionRows.find((session) => session.sessionKey === activeSessionKey)
      ?.contextMeter ??
    contextWindowMeterForUsage(effectiveStatus.usage);
  const clearableStaleSessionCount = visibleSessions.filter((session) => {
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

  const disconnectSessionRow = (session: CodexStatusMessage) => {
    if (!session.agent || !session.sessionId) return;
    void disconnectSession(session.agent, session.sessionId).catch(() => {
      console.warn("Could not disconnect session.");
    });
  };

  const postRoomJson = async (url: string, payload: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Room bridge request failed: ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  };

  const normalizeRoomsSnapshotValue = (value: unknown): AivatarRoomsSnapshot => {
    const raw = value && typeof value === "object" ? value as {
      rooms?: unknown;
      visits?: unknown;
      timestamp?: unknown;
    } : {};
    const rooms = Array.isArray(raw.rooms)
      ? raw.rooms
          .map((room) => normalizeRoomPresence(room as Partial<AivatarRoomPresence>))
          .filter((room): room is AivatarRoomPresence => Boolean(room))
      : [];
    const visits = Array.isArray(raw.visits)
      ? raw.visits
          .map((visit) => normalizeVisitSession(visit as Partial<AivatarVisitSession>))
          .filter((visit): visit is AivatarVisitSession => Boolean(visit))
      : [];

    return {
      type: "aivatar.rooms.snapshot",
      rooms,
      visits,
      timestamp:
        typeof raw.timestamp === "string" ? raw.timestamp : roomVisitNowIso(),
    };
  };

  const currentRoomPresence = (
    status: AivatarRoomPresence["status"] = "home",
    visitId = activeVisitRef.current?.visitId ?? null,
  ) => {
    const slotId = activeSaveSlotIdRef.current;
    if (!slotId) return null;
    const slotIndex = saveSlotsRef.current.find((slot) => slot.id === slotId)?.slotIndex ?? 0;

    return roomPresenceFromSave(
      roomInstanceIdRef.current,
      slotId,
      slotIndex,
      saveRef.current,
      normalizeMemory(saveRef.current.memory),
      status,
      visitId,
    );
  };

  const socialMemoryStorageForVisit = (visit: AivatarVisitSession) =>
    socialRoomMemoryStorageKey(
      visit.guest.avatarId,
      visit.hostRoomId,
      visit.hostLayoutFingerprint,
    );

  const readSocialRoomMemory = async (visit: AivatarVisitSession) => {
    const key = socialMemoryStorageForVisit(visit);
    let parsed: unknown = null;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const payload = await invoke<string | null>("read_social_room_memory", { key });
      parsed = payload ? JSON.parse(payload) : null;
    } catch {
      try {
        const payload = localStorage.getItem(key);
        parsed = payload ? JSON.parse(payload) : null;
      } catch {
        parsed = null;
      }
    }

    return normalizeSocialRoomMemory(
      parsed && typeof parsed === "object"
        ? parsed as Partial<AivatarSocialRoomMemory>
        : undefined,
      visit.guest.avatarId,
      visit.host.avatarId,
      visit.hostRoomId,
      visit.hostLayoutFingerprint,
    );
  };

  const writeSocialRoomMemory = async (memory: AivatarSocialRoomMemory) => {
    const key = socialRoomMemoryStorageKey(
      memory.ownerAvatarId,
      memory.hostRoomId,
      memory.hostLayoutFingerprint,
    );
    const payload = JSON.stringify(memory);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_social_room_memory", { key, payload });
      return;
    } catch {
      try {
        localStorage.setItem(key, payload);
      } catch {
        console.warn("Could not persist social room memory.");
      }
    }
  };

  const readSocialRelationship = (
    leftAvatarId: string,
    rightAvatarId: string,
  ): AivatarSocialRelationship => {
    const key = socialRelationshipStorageKey(leftAvatarId, rightAvatarId);
    try {
      const payload = localStorage.getItem(key);
      return normalizeSocialRelationship(
        payload ? JSON.parse(payload) as Partial<AivatarSocialRelationship> : undefined,
        leftAvatarId,
        rightAvatarId,
      );
    } catch {
      return normalizeSocialRelationship(undefined, leftAvatarId, rightAvatarId);
    }
  };

  const writeSocialRelationship = (relationship: AivatarSocialRelationship) => {
    const [leftAvatarId, rightAvatarId] = relationship.avatarIds;
    const key = socialRelationshipStorageKey(leftAvatarId, rightAvatarId);
    try {
      localStorage.setItem(key, JSON.stringify(relationship));
    } catch {
      console.warn("Could not persist social relationship.");
    }
  };

  const relationshipForVisit = (visit: AivatarVisitSession) =>
    readSocialRelationship(visit.host.avatarId, visit.guest.avatarId);

  const syncActiveVisitRelationship = (visit: AivatarVisitSession) => {
    activeVisitRelationshipRef.current = relationshipForVisit(visit);
  };

  const pairCooldownKey = (leftAvatarId: string, rightAvatarId: string) =>
    `${ROOM_VISIT_PAIR_COOLDOWN_PREFIX}${[leftAvatarId, rightAvatarId]
      .sort()
      .map((part) => part.replace(/[^a-zA-Z0-9_.-]/g, "_"))
      .join(".")}`;

  const readPairCooldownUntil = (leftAvatarId: string, rightAvatarId: string) => {
    try {
      const raw = localStorage.getItem(pairCooldownKey(leftAvatarId, rightAvatarId));
      const value = raw ? Number(raw) : 0;
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };

  const writePairCooldownUntil = (
    leftAvatarId: string,
    rightAvatarId: string,
    untilMs: number,
  ) => {
    try {
      localStorage.setItem(pairCooldownKey(leftAvatarId, rightAvatarId), String(untilMs));
    } catch {
      console.warn("Could not persist room visit cooldown.");
    }
  };

  const startRoomVisitSocialExchange = (
    visit: AivatarVisitSession,
    visitor: AivatarRoomVisitor,
    now: number,
  ) => {
    const current = roomVisitSocialExchangeRef.current;
    if (current?.visitId === visit.visitId && !current.completed) return;
    if (now < roomVisitNextExchangeAtRef.current) return;

    const behavior = roomVisitBehaviorForVisitor(visitor);
    const speakerRole: AivatarVisitRole =
      behavior === "admire" || behavior === "wander"
        ? "guest"
        : Math.random() < 0.6
          ? "guest"
          : "host";
    const exchange = selectSocialBubbleExchange({
      hostBubbles: visit.host.socialBubbles,
      guestBubbles: visit.guest.socialBubbles,
      speakerRole,
      activity: behavior,
      idleBubbleLanguage: normalizeIdleBubbleLanguage(
        saveRef.current.memory?.preferences?.idleBubbleLanguage,
      ),
      uiLocale: localeRef.current,
      recentIntentIds: roomVisitRecentIntentIdsRef.current,
    });
    if (!exchange) return;

    const startedAt = now + ROOM_VISIT_EXCHANGE_START_DELAY_MS;
    const activeEndsAt = startedAt + ROOM_VISIT_EXCHANGE_LINE_DURATION_MS;
    const responseStartedAt = activeEndsAt + ROOM_VISIT_EXCHANGE_LINE_GAP_MS;
    const responseEndsAt = responseStartedAt + ROOM_VISIT_EXCHANGE_LINE_DURATION_MS;
    roomVisitSocialExchangeRef.current = {
      visitId: visit.visitId,
      active: {
        speaker: speakerRole,
        bubble: exchange.active,
        startedAt,
        endsAt: activeEndsAt,
      },
      response: {
        speaker: socialVisitRolePair(speakerRole),
        bubble: exchange.response,
        startedAt: responseStartedAt,
        endsAt: responseEndsAt,
      },
      appliedLineIndex: -1,
      completed: false,
    };
    roomVisitRecentIntentIdsRef.current = [
      exchange.active.intentId,
      ...roomVisitRecentIntentIdsRef.current.filter(
        (intentId) => intentId !== exchange.active.intentId,
      ),
    ].slice(0, 4);
  };

  const applyRoomVisitSocialExchangePlayback = (
    visitor: AivatarRoomVisitor,
    now: number,
  ): AivatarRoomVisitor => {
    const playback = roomVisitSocialExchangeRef.current;
    if (!playback || playback.visitId !== visitor.visitId || playback.completed) {
      return visitor;
    }

    const line =
      now >= playback.active.startedAt && now < playback.active.endsAt
        ? { index: 0, ...playback.active }
        : now >= playback.response.startedAt && now < playback.response.endsAt
          ? { index: 1, ...playback.response }
          : null;

    if (!line) {
      if (now >= playback.response.endsAt) {
        playback.completed = true;
        roomVisitNextExchangeAtRef.current = now + ROOM_VISIT_EXCHANGE_COOLDOWN_MS;
        roomVisitSocialExchangeRef.current = null;
        if (
          activeInteractionRef.current?.furnitureId === "room-visit-dialogue" ||
          activeInteractionRef.current?.furnitureId === "room-visit-social"
        ) {
          updateActiveInteraction(null);
        }
      }
      return {
        ...visitor,
        bubbleText: undefined,
        bubbleStartedAt: undefined,
        bubbleEndsAt: undefined,
      };
    }

    if (line.speaker === "host") {
      if (playback.appliedLineIndex !== line.index) {
        playback.appliedLineIndex = line.index;
        updateActiveInteraction({
          kind: "none",
          furnitureId: "room-visit-dialogue",
          furnitureName: ui("roomVisit.title"),
          message: line.bubble.text,
          startedAt: line.startedAt,
          endsAt: line.endsAt,
          bubbleText: line.bubble.text,
        });
      }
      return {
        ...visitor,
        bubbleText: undefined,
        bubbleStartedAt: undefined,
        bubbleEndsAt: undefined,
      };
    }

    if (
      playback.appliedLineIndex !== line.index &&
      (activeInteractionRef.current?.furnitureId === "room-visit-dialogue" ||
        activeInteractionRef.current?.furnitureId === "room-visit-social")
    ) {
      updateActiveInteraction(null);
    }
    playback.appliedLineIndex = line.index;
    return {
      ...visitor,
      bubbleText: line.bubble.text,
      bubbleStartedAt: line.startedAt,
      bubbleEndsAt: line.endsAt,
      runtime: {
        ...visitor.runtime,
        expression: "happy",
      },
    };
  };

  const clearLocalVisitState = (returnHome: boolean) => {
    const visitId = activeVisitRef.current?.visitId ?? roomVisitorRef.current?.visitId;
    if (visitId) {
      clearNavigationScope(roomVisitorNavigationScopeKey(visitId));
    }

    setActiveVisit(null);
    activeVisitRef.current = null;
    setRoomVisitor(null);
    roomVisitorRef.current = null;
    setAvatarAway(false);
    avatarAwayRef.current = false;
    socialRoomMemoryRef.current = null;
    activeVisitRelationshipRef.current = null;
    roomVisitHostActivityRef.current = null;
    roomVisitSocialExchangeRef.current = null;
    roomVisitNextExchangeAtRef.current = 0;
    roomVisitRecentIntentIdsRef.current = [];
    visitHostStartedAtRef.current = 0;
    visitStatePostedAtRef.current = 0;

    if (returnHome) {
      runtimeRef.current = {
        ...runtimeRef.current,
        x: ROOM_DOOR_INSIDE_POINT.x,
        y: ROOM_DOOR_INSIDE_POINT.y,
        targetX: ROOM_DOOR_INSIDE_POINT.x,
        targetY: ROOM_DOOR_INSIDE_POINT.y,
        behavior: "idle",
        behaviorTimer: 2,
        expression: "calm",
        activityLabel: undefined,
        actionIntent: undefined,
        actionActivityLabel: undefined,
        interactionTargetAlternates: undefined,
        navigationFailure: undefined,
      };
      setAvatar(runtimeRef.current);
    }
  };

  const settleVisitRewards = (
    visit: AivatarVisitSession,
    role: "host" | "guest",
  ) => {
    const rewardKey = `${role}:${visit.visitId}`;
    if (completedVisitIdsRef.current.has(rewardKey)) return;
    completedVisitIdsRef.current.add(rewardKey);

    const learnedPhrase =
      role === "host"
        ? visit.guest.idleBubblePhrases?.[0]
        : visit.host.idleBubblePhrases?.[0];
    const partnerName = role === "host" ? visit.guest.avatarName : visit.host.avatarName;
    const behavior = visit.activity ?? "interact";
    const relationship = relationshipForVisit(visit);
    const nextRelationship = completeSocialRelationship(
      relationship,
      visit.visitId,
      visit.host.traits,
      visit.guest.traits,
      behavior,
    );
    activeVisitRelationshipRef.current = nextRelationship;
    writeSocialRelationship(nextRelationship);

    if (role === "guest") {
      const completedMemory = completeSocialRoomVisit(
        normalizeSocialRoomMemory(
          socialRoomMemoryRef.current ?? undefined,
          visit.guest.avatarId,
          visit.host.avatarId,
          visit.hostRoomId,
          visit.hostLayoutFingerprint,
        ),
        behavior,
        learnedPhrase,
      );
      socialRoomMemoryRef.current = completedMemory;
      void writeSocialRoomMemory(completedMemory);
    }

    setSave((current) => {
      const recordedMemory = recordLifeMemory(
        current.memory,
        {
          type: "recovery_used",
          summary:
            role === "host"
              ? `Hosted ${partnerName} for a room visit`
              : `Visited ${partnerName}'s room`,
          behavior,
        },
        {
          warmth: role === "host" ? 2 : 1,
          curiosity: role === "guest" ? 2 : 1,
        },
        { throttleMs: 1000, throttleKey: rewardKey },
      );
      const normalizedMemory = normalizeMemory(recordedMemory);
      const trimmedPhrase = learnedPhrase?.trim();
      const idleBubblePhrases =
        trimmedPhrase &&
        !normalizedMemory.preferences.idleBubblePhrases?.some(
          (phrase) => phrase.toLowerCase() === trimmedPhrase.toLowerCase(),
        )
          ? [
              ...(normalizedMemory.preferences.idleBubblePhrases ?? []),
              trimmedPhrase,
            ].slice(-12)
          : normalizedMemory.preferences.idleBubblePhrases ?? [];

      return {
        ...current,
        petStats: applyPetStatEffect(current.petStats, {
          mood: role === "host" ? 5 : 4,
        }),
        memory: {
          ...normalizedMemory,
          preferences: {
            ...normalizedMemory.preferences,
            idleBubblePhrases,
          },
        },
      };
    });
  };

  const publishVisitState = (
    visit: AivatarVisitSession,
    patch: Partial<AivatarVisitSession>,
  ) => {
    const nextVisit = normalizeVisitSession({
      ...visit,
      ...patch,
      updatedAt: roomVisitNowIso(),
      expiresAt: roomVisitExpiresAt(),
    });
    if (!nextVisit) return visit;

    activeVisitRef.current = nextVisit;
    setActiveVisit(nextVisit);
    void postRoomJson(VISIT_STATE_URL, nextVisit).catch(() => {
      console.warn("Could not publish room visit state.");
    });
    return nextVisit;
  };

  const publishVisitEnd = (
    visit: AivatarVisitSession,
    phase: "ended" | "cancelled",
    cancelReason?: string,
  ) => {
    const nextVisit = normalizeVisitSession({
      ...visit,
      phase,
      cancelReason,
      updatedAt: roomVisitNowIso(),
      expiresAt: roomVisitExpiresAt(30000),
    });
    if (!nextVisit) return;
    void postRoomJson(VISIT_END_URL, nextVisit).catch(() => {
      console.warn("Could not publish room visit end.");
    });
  };

  const finishVisitLocally = (
    visit: AivatarVisitSession,
    options: {
      returnHome?: boolean;
      reward?: boolean;
      cancelled?: boolean;
      message?: string;
      publishCancel?: boolean;
    } = {},
  ) => {
    const role =
      visit.host.roomInstanceId === roomInstanceIdRef.current
        ? "host"
        : visit.guest.roomInstanceId === roomInstanceIdRef.current
          ? "guest"
          : null;
    if (role && options.reward && !options.cancelled) {
      settleVisitRewards(visit, role);
    }
    if (options.publishCancel) {
      publishVisitEnd(visit, "cancelled", options.message ?? "local return");
    }

    clearLocalVisitState(Boolean(options.returnHome));
    setRoomVisitMenuOpen(false);
    if (options.message) {
      setRoomVisitMessage(options.message);
    }
  };

  const isRoomVisitSessionBusy = () => isHighPriorityStatus(statusRef.current.status);

  const syncHostAvatarWithRoomVisitor = (
    visitor: AivatarRoomVisitor,
    currentContent: AivatarContent,
    currentStatus: CodexStatusMessage,
    now: number,
    options: {
      pendingWorldInteraction: PendingWorldInteraction | null;
      blockingInteraction: boolean;
      busyRecoveryActive: boolean;
      taskCabinetVisualFlowActive: boolean;
    },
  ) => {
    const socialTarget = roomVisitHostSocialTarget(
      visitor,
      currentContent,
      runtimeRef.current,
      activeRecordPlayerIdRef.current,
    );
    const canSync =
      visitor.phase === "socializing" &&
      socialTarget &&
      !isHighPriorityStatus(currentStatus) &&
      !options.pendingWorldInteraction &&
      !options.blockingInteraction &&
      !options.busyRecoveryActive &&
      !options.taskCabinetVisualFlowActive;

    if (!canSync || !socialTarget) {
      roomVisitHostActivityRef.current = null;
      return;
    }

    const targetKey = [
      visitor.visitId,
      socialTarget.behavior,
      Math.round(socialTarget.targetX),
      Math.round(socialTarget.targetY),
    ].join(":");
    const activeBehavior = runtimeActionBehavior(runtimeRef.current);
    const alignedWithActivity =
      activeBehavior === socialTarget.behavior &&
      Math.abs(runtimeRef.current.targetX - socialTarget.targetX) <= 1 &&
      Math.abs(runtimeRef.current.targetY - socialTarget.targetY) <= 1;
    const currentSync = roomVisitHostActivityRef.current;
    const needsSync =
      !currentSync ||
      currentSync.visitId !== visitor.visitId ||
      currentSync.behavior !== socialTarget.behavior ||
      currentSync.targetKey !== targetKey ||
      !alignedWithActivity ||
      Boolean(runtimeRef.current.navigationFailure);

    if (!needsSync) return;

    const arrivalGated = socialTarget.behavior !== "wander";
    runtimeRef.current = {
      ...runtimeRef.current,
      targetX: socialTarget.targetX,
      targetY: socialTarget.targetY,
      behavior: "wander",
      behaviorTimer:
        socialTarget.behavior === "play"
          ? 12
          : socialTarget.behavior === "coffee"
            ? 10
            : socialTarget.behavior === "interact"
              ? 8
              : 9,
      expression:
        socialTarget.behavior === "play" ||
        socialTarget.behavior === "coffee" ||
        socialTarget.behavior === "interact"
          ? "happy"
          : "calm",
      activityLabel: socialTarget.activityLabel,
      interactionTargetAlternates:
        socialTarget.alternates && socialTarget.alternates.length > 1
          ? socialTarget.alternates
          : undefined,
      actionIntent: arrivalGated ? socialTarget.behavior : undefined,
      actionActivityLabel: arrivalGated ? socialTarget.activityLabel : undefined,
      navigationFailure: undefined,
    };
    roomVisitHostActivityRef.current = {
      visitId: visitor.visitId,
      behavior: socialTarget.behavior,
      targetKey,
    };
    setAvatar(runtimeRef.current);
    const bubbleStartedAt = now + ROOM_VISIT_HOST_REPLY_DELAY_MS;
    updateActiveInteraction({
      kind: "none",
      furnitureId: "room-visit-social",
      furnitureName: ui("roomVisit.title"),
      message: socialTarget.activityLabel,
      startedAt: bubbleStartedAt,
      endsAt: bubbleStartedAt + INTERACTION_FEEDBACK_SECONDS * 1000,
      bubbleText: socialTarget.bubbleText,
    });
  };

  const sampleGuestVisitMemory = (visit: AivatarVisitSession) => {
    if (
      visit.guest.roomInstanceId !== roomInstanceIdRef.current ||
      !visit.guestRuntime ||
      visit.guestRuntimeRoomInstanceId !== visit.host.roomInstanceId
    ) {
      return;
    }
    const nextMemory = recordSocialRoomNavSample(
      normalizeSocialRoomMemory(
        socialRoomMemoryRef.current ?? undefined,
        visit.guest.avatarId,
        visit.host.avatarId,
        visit.hostRoomId,
        visit.hostLayoutFingerprint,
      ),
      visit.guestRuntime,
      visit.guestRuntime.navigationFailure ? "failure" : "success",
    );
    socialRoomMemoryRef.current = nextMemory;

    const now = performance.now();
    if (
      now - socialRoomMemoryWriteAtRef.current >=
      ROOM_VISIT_NAV_SAMPLE_SECONDS * 1000
    ) {
      socialRoomMemoryWriteAtRef.current = now;
      void writeSocialRoomMemory(nextMemory);
    }
  };

  const acceptIncomingVisit = (visit: AivatarVisitSession) => {
    if (handledVisitIdsRef.current.has(visit.visitId)) return;
    handledVisitIdsRef.current.add(visit.visitId);

    if (isRoomVisitSessionBusy()) {
      publishVisitEnd(visit, "cancelled", ROOM_VISIT_BUSY_CANCEL_REASON);
      setRoomVisitMessage(ui("roomVisit.busySelf"));
      return;
    }

    void readSocialRoomMemory(visit).then((memory) => {
      if (activeVisitRef.current?.visitId === visit.visitId) {
        socialRoomMemoryRef.current = memory;
        publishVisitState(activeVisitRef.current, {
          guestSocialNavMemory: memory.navMemory,
        });
      }
    });

    clearPendingFurnitureInteraction();

    const accepted = normalizeVisitSession({
      ...visit,
      phase: "accepted",
      guestRuntime: {
        ...runtimeRef.current,
        targetX: ROOM_DOOR_OUTSIDE_POINT.x,
        targetY: ROOM_DOOR_OUTSIDE_POINT.y,
        behavior: "wander",
        behaviorTimer: 2,
        expression: "happy",
        activityLabel: "Visiting",
      },
      guestRuntimeRoomInstanceId: roomInstanceIdRef.current,
      guestSocialNavMemory: socialRoomMemoryRef.current?.navMemory,
      updatedAt: roomVisitNowIso(),
      expiresAt: roomVisitExpiresAt(),
    });
    if (!accepted) return;

    activeVisitRef.current = accepted;
    setActiveVisit(accepted);
    syncActiveVisitRelationship(accepted);
    runtimeRef.current = {
      ...runtimeRef.current,
      targetX: ROOM_DOOR_OUTSIDE_POINT.x,
      targetY: ROOM_DOOR_OUTSIDE_POINT.y,
      behavior: "wander",
      behaviorTimer: 2,
      expression: "happy",
      activityLabel: "Visiting",
      actionIntent: undefined,
      actionActivityLabel: undefined,
      interactionTargetAlternates: undefined,
    };
    setAvatar(runtimeRef.current);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "room-door",
      furnitureName: ui("roomVisit.title"),
      message: ui("roomVisit.accepted", { name: visit.host.avatarName }),
      startedAt: performance.now(),
      endsAt: performance.now() + INTERACTION_FEEDBACK_SECONDS * 1000,
      bubbleText: "roomVisit.bubble.enter.1",
    });
    void postRoomJson(VISIT_STATE_URL, accepted).catch(() => {
      console.warn("Could not accept room visit.");
    });
  };

  const handleRoomSnapshot = (snapshot: AivatarRoomsSnapshot) => {
    const ownRoomInstanceId = roomInstanceIdRef.current;
    const currentVisit = activeVisitRef.current;

    if (!currentVisit) {
      const incomingVisit = snapshot.visits.find(
        (visit) =>
          visit.phase === "invited" &&
          visit.guest.roomInstanceId === ownRoomInstanceId &&
          !handledVisitIdsRef.current.has(visit.visitId),
      );
      if (incomingVisit && !saveMenuOpen) {
        acceptIncomingVisit(incomingVisit);
      }
      const hostedVisit = snapshot.visits.find(
        (visit) =>
          visit.host.roomInstanceId === ownRoomInstanceId &&
          visit.phase !== "invited" &&
          visit.phase !== "cancelled" &&
          visit.phase !== "ended",
      );
      if (hostedVisit && !saveMenuOpen) {
        if (isRoomVisitSessionBusy()) {
          publishVisitEnd(hostedVisit, "cancelled", ROOM_VISIT_BUSY_CANCEL_REASON);
          setRoomVisitMessage(ui("roomVisit.busySelf"));
          return;
        }
        const hostPresence = currentRoomPresence("hosting", hostedVisit.visitId);
        const adoptedVisit = normalizeVisitSession({
          ...hostedVisit,
          host: hostPresence ?? hostedVisit.host,
          hostLayoutFingerprint: hostLayoutFingerprint(contentRef.current),
          hostRoomId: saveRef.current.roomId ?? "room",
          updatedAt: roomVisitNowIso(),
          expiresAt: roomVisitExpiresAt(),
        });
        if (!adoptedVisit) return;
        activeVisitRef.current = adoptedVisit;
        setActiveVisit(adoptedVisit);
        syncActiveVisitRelationship(adoptedVisit);
        setRoomVisitMessage(ui("roomVisit.waiting", { name: adoptedVisit.guest.avatarName }));
        publishVisitState(adoptedVisit, {});
      }
      return;
    }

    const latestVisit = snapshot.visits.find(
      (visit) => visit.visitId === currentVisit.visitId,
    );
    if (!latestVisit) {
      finishVisitLocally(currentVisit, {
        returnHome: avatarAwayRef.current,
        cancelled: true,
        message: ui("roomVisit.connectionLost"),
      });
      return;
    }

    if (latestVisit.phase === "cancelled") {
      finishVisitLocally(latestVisit, {
        returnHome: latestVisit.guest.roomInstanceId === ownRoomInstanceId,
        cancelled: true,
        message:
          latestVisit.cancelReason === ROOM_VISIT_BUSY_CANCEL_REASON
            ? ui("roomVisit.busyOther", { name: latestVisit.guest.avatarName })
            : ui("roomVisit.cancelled"),
      });
      return;
    }

    if (latestVisit.phase === "ended") {
      finishVisitLocally(latestVisit, {
        returnHome: latestVisit.guest.roomInstanceId === ownRoomInstanceId,
        reward: true,
        message: ui("roomVisit.ended"),
      });
      return;
    }

    activeVisitRef.current = latestVisit;
    setActiveVisit(latestVisit);
    syncActiveVisitRelationship(latestVisit);

    if (latestVisit.guest.roomInstanceId === ownRoomInstanceId) {
      sampleGuestVisitMemory(latestVisit);
      return;
    }

    if (
      latestVisit.host.roomInstanceId === ownRoomInstanceId &&
      latestVisit.phase !== "invited" &&
      (latestVisit.guestRuntimeRoomInstanceId === ownRoomInstanceId ||
        (!latestVisit.guestRuntimeRoomInstanceId && latestVisit.phase !== "accepted"))
    ) {
      const existingVisitor = roomVisitorRef.current;
      if (!existingVisitor || existingVisitor.visitId !== latestVisit.visitId) {
        const visitor = {
          ...createVisitorFromVisit(latestVisit),
          bubbleStartedAt: performance.now(),
        };
        roomVisitorRef.current = visitor;
        setRoomVisitor(visitor);
        visitHostStartedAtRef.current = performance.now();
      }
    }
  };

  const inviteRoom = (room: AivatarRoomPresence) => {
    if (isRoomVisitSessionBusy()) {
      setRoomVisitMenuOpen(false);
      setRoomVisitMessage(ui("roomVisit.busySelf"));
      return;
    }
    if (room.status === "busy") {
      setRoomVisitMessage(ui("roomVisit.busyOther", { name: room.avatarName }));
      return;
    }

    const visitId = createVisitId();
    const host = currentRoomPresence("hosting", visitId);
    if (!host) {
      setRoomVisitMessage(ui("roomVisit.noActiveSlot"));
      return;
    }

    const visit = normalizeVisitSession({
      type: "aivatar.room.visit",
      visitId,
      phase: "invited",
      host,
      guest: room,
      hostLayoutFingerprint: hostLayoutFingerprint(contentRef.current),
      hostRoomId: saveRef.current.roomId ?? "room",
      createdAt: roomVisitNowIso(),
      updatedAt: roomVisitNowIso(),
      expiresAt: roomVisitExpiresAt(),
    });
    if (!visit) return;

    activeVisitRef.current = visit;
    setActiveVisit(visit);
    syncActiveVisitRelationship(visit);
    setRoomVisitor(null);
    roomVisitorRef.current = null;
    setRoomVisitMenuOpen(false);
    setRoomVisitMessage(ui("roomVisit.invited", { name: room.avatarName }));
    visitHostStartedAtRef.current = 0;
    runtimeRef.current = {
      ...runtimeRef.current,
      targetX: ROOM_DOOR_INSIDE_POINT.x,
      targetY: ROOM_DOOR_INSIDE_POINT.y,
      behavior: "wander",
      behaviorTimer: 4,
      expression: "happy",
      activityLabel: "Waiting",
      actionIntent: undefined,
      actionActivityLabel: undefined,
      interactionTargetAlternates: undefined,
    };
    setAvatar(runtimeRef.current);
    updateActiveInteraction({
      kind: "none",
      furnitureId: "room-door",
      furnitureName: ui("roomVisit.title"),
      message: ui("roomVisit.invited", { name: room.avatarName }),
      startedAt: performance.now(),
      endsAt: performance.now() + INTERACTION_FEEDBACK_SECONDS * 1000,
      bubbleText: roomVisitBubbleKeyForBehavior("interact"),
    });

    void postRoomJson(VISIT_INVITE_URL, visit).catch(() => {
      finishVisitLocally(visit, {
        cancelled: true,
        message: ui("roomVisit.connectionLost"),
      });
    });
  };

  const visitRoom = (room: AivatarRoomPresence) => {
    if (isRoomVisitSessionBusy()) {
      setRoomVisitMenuOpen(false);
      setRoomVisitMessage(ui("roomVisit.busySelf"));
      return;
    }
    if (room.status !== "home") {
      setRoomVisitMessage(ui("roomVisit.busyOther", { name: room.avatarName }));
      return;
    }

    const visitId = createVisitId();
    const guest = currentRoomPresence("away", visitId);
    if (!guest) {
      setRoomVisitMessage(ui("roomVisit.noActiveSlot"));
      return;
    }

    const visit = normalizeVisitSession({
      type: "aivatar.room.visit",
      visitId,
      phase: "invited",
      host: room,
      guest,
      hostLayoutFingerprint: room.roomId,
      hostRoomId: room.roomId,
      createdAt: roomVisitNowIso(),
      updatedAt: roomVisitNowIso(),
      expiresAt: roomVisitExpiresAt(),
    });
    if (!visit) return;

    setRoomVisitMenuOpen(false);
    setRoomVisitMessage(ui("roomVisit.accepted", { name: room.avatarName }));
    syncActiveVisitRelationship(visit);
    acceptIncomingVisit(visit);
  };

  const onlineRoomsForAutonomousVisit = (nowMs: number) =>
    (roomSnapshotRef.current?.rooms ?? []).filter((room) => {
      if (room.roomInstanceId === roomInstanceIdRef.current) return false;
      if (room.slotId === activeSaveSlotIdRef.current) return false;
      if (room.status !== "home") return false;
      const expiresAt = Date.parse(room.expiresAt);
      return Number.isNaN(expiresAt) || expiresAt > nowMs;
    });

  const canStartAutonomousRoomVisit = (nowMs: number) => {
    if (!activeSaveSlotIdRef.current || saveMenuOpenRef.current) return false;
    if (roomVisitMenuOpenRef.current || activeVisitRef.current || avatarAwayRef.current) return false;
    if (nowMs < autonomousRoomVisitCooldownUntilRef.current) return false;
    if (isRoomVisitSessionBusy()) return false;
    if (pendingWorldInteractionRef.current) return false;
    if (isBlockingInteraction(activeInteractionRef.current)) return false;
    return onlineRoomsForAutonomousVisit(nowMs).length > 0;
  };

  const pickAutonomousRoomVisitTarget = (
    rooms: AivatarRoomPresence[],
    ownPresence: AivatarRoomPresence,
    nowMs: number,
  ) => {
    const ownMemory = normalizeMemory(saveRef.current.memory);
    const candidates = rooms
      .map((room) => {
        const relationship = readSocialRelationship(ownPresence.avatarId, room.avatarId);
        const pairCooldownUntil = readPairCooldownUntil(ownPresence.avatarId, room.avatarId);
        if (pairCooldownUntil > nowMs) return null;
        const willingness = socialWillingnessScore(ownPresence, {
          base: ownMemory.preferences.socialWillingness,
          affinity: relationship.affinity,
          lastVisitAt: relationship.lastVisitAt,
          nowMs,
        });
        return {
          room,
          relationship,
          willingness,
          weight: willingness + relationship.affinity / 35,
        };
      })
      .filter(
        (candidate): candidate is {
          room: AivatarRoomPresence;
          relationship: AivatarSocialRelationship;
          willingness: number;
          weight: number;
        } => candidate !== null && candidate.weight > 0,
      )
      .sort((left, right) => right.weight - left.weight);

    const topCandidate = candidates[0];
    if (!topCandidate || !shouldAttemptAutonomousVisit(topCandidate.willingness)) {
      return null;
    }
    return topCandidate;
  };

  const startAutonomousRoomVisit = (nowMs = Date.now()) => {
    if (!canStartAutonomousRoomVisit(nowMs)) return;
    const ownPresence = currentRoomPresence("home");
    if (!ownPresence) return;
    const rooms = onlineRoomsForAutonomousVisit(nowMs);
    const target = pickAutonomousRoomVisitTarget(rooms, ownPresence, nowMs);
    if (!target) return;

    autonomousRoomVisitCooldownUntilRef.current = nowMs + ROOM_VISIT_AUTO_COOLDOWN_MS;
    writePairCooldownUntil(
      ownPresence.avatarId,
      target.room.avatarId,
      nowMs + ROOM_VISIT_PAIR_COOLDOWN_MS,
    );

    const traits = ownPresence.traits;
    const curiosity = traits.curiosity;
    const warmth = traits.warmth;
    const visitBias = Math.min(
      0.68,
      Math.max(
        0.28,
        0.44 + (curiosity - warmth) / 4000 + target.relationship.affinity / 9000,
      ),
    );
    if (Math.random() < visitBias) {
      visitRoom(target.room);
    } else {
      inviteRoom(target.room);
    }
  };

  const openRoomVisitMenu = () => {
    clearPendingFurnitureInteraction();
    updateSelectedPlacedItem(null);
    updateSelectedWindow(null);
    updateMovingFurniture(null);
    selectedFurnitureRef.current = null;
    setSelectedFurniture(null);
    setSceneContextMenu(null);

    if (!activeSaveSlotIdRef.current) {
      setRoomVisitMessage(ui("roomVisit.noActiveSlot"));
      return;
    }
    if (isRoomVisitSessionBusy()) {
      setRoomVisitMessage(ui("roomVisit.busySelf"));
      return;
    }
    setRoomVisitMenuOpen(true);
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
      let requestedWidth = nextWidth;
      await invoke("resize_main_window_for_side_panel", {
        width: requestedWidth,
        minWidth,
        height: DEFAULT_WINDOW_HEIGHT,
      });

      if (!open) {
        for (let attempt = 0; attempt < COLLAPSED_WINDOW_RESIZE_RETRY_LIMIT; attempt += 1) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, COLLAPSED_WINDOW_RESIZE_RETRY_DELAY_MS);
          });

          const widthDeficit = Math.ceil(collapsedWidth - window.innerWidth);
          if (widthDeficit <= 0) break;

          requestedWidth += widthDeficit + COLLAPSED_WINDOW_CLIENT_WIDTH_GUARD;
          await invoke("resize_main_window_for_side_panel", {
            width: requestedWidth,
            minWidth: requestedWidth,
            height: DEFAULT_WINDOW_HEIGHT,
          });
        }
      }
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
    const sceneWidth =
      scenePanelRef.current?.getBoundingClientRect().width ?? DEFAULT_SCENE_PANEL_WIDTH;
    const lockedSceneWidth = Math.max(Math.ceil(sceneWidth), DEFAULT_SCENE_PANEL_WIDTH);
    const collapsedWidth = lockedSceneWidth + APP_HORIZONTAL_PADDING;

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

  const refreshAgentIntegrations = async () => {
    setAgentIntegrationsChecked(false);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<AgentIntegrationStatus[]>("get_agent_integrations");
      setAgentIntegrations(result);
      setAgentIntegrationMessage("");
      return result;
    } catch {
      setAgentIntegrations([]);
      setAgentIntegrationMessage(ui("message.integrationsDesktopOnly"));
      return [];
    } finally {
      setAgentIntegrationsChecked(true);
    }
  };

  const enableAgentIntegration = async (agent: LauncherAgentId) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<AgentIntegrationStatus>("enable_agent_integration", {
        request: { agent },
      });
      setAgentIntegrations((current) => {
        const rest = current.filter((item) => item.agent !== result.agent);
        return [...rest, result].sort((left, right) =>
          left.label.localeCompare(right.label),
        );
      });
      setAgentIntegrationMessage(
        result.enabled
          ? ui("message.integrationEnabled", { agent: result.label })
          : ui("message.integrationChecked", { agent: result.label }),
      );
      void refreshAgentIntegrations();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAgentIntegrationMessage(detail || ui("message.integrationFailed"));
    }
  };

  useEffect(() => {
    void refreshAgentIntegrations();
  }, []);

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
        setLauncherMessage(ui("message.launcherFolderSelected"));
      }
    } catch {
      setLauncherMessage(ui("message.filePickerDesktopOnly"));
    }
  };

  const updateActiveInteraction = (interaction: FurnitureInteractionState | null) => {
    activeInteractionRef.current = interaction;
    setActiveInteraction(interaction);
  };

  const unlockAppAudio = () => {
    audioUnlockedRef.current = true;
  };

  const playStartupSound = () => {
    if (!startupSoundEnabled || startupSoundPlayedRef.current) return;
    startupSoundPlayedRef.current = true;
    playOneShotAudio(
      agentCompleteAudioRef.current,
      STARTUP_SOUND_AUDIO_VOLUME_MULTIPLIER,
    );
  };

  const playOneShotAudio = (
    audio: HTMLAudioElement | null,
    volumeMultiplier = 1,
  ) => {
    if (!audio || audioVolume <= 0 || !audioUnlockedRef.current) return;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = Math.min(1, Math.max(0, audioVolume * volumeMultiplier));
    void audio.play().catch(() => undefined);
  };

  const playBitsSpendSound = (
    volumeMultiplier = BITS_SPEND_AUDIO_VOLUME_MULTIPLIER,
  ) => {
    playOneShotAudio(bitsSpendAudioRef.current, volumeMultiplier);
  };

  const pauseAudio = (audio: HTMLAudioElement | null) => {
    if (!audio || audio.paused) return;
    audio.pause();
    audio.currentTime = 0;
  };

  const setAudioPlaying = (
    audio: HTMLAudioElement | null,
    shouldPlay: boolean,
    volumeMultiplier = 1,
  ) => {
    if (!audio) return;
    audio.volume = Math.min(1, Math.max(0, audioVolume * volumeMultiplier));
    if (shouldPlay) {
      if (audio.paused) {
        void audio.play().catch(() => undefined);
      }
    } else {
      pauseAudio(audio);
    }
  };

  const currentBgmTrack = () =>
    BGM_TRACKS.find((track) => track.id === bgmTrackIdRef.current) ??
    BGM_TRACKS[0];

  const scaledBgmAudioVolume = (track: BgmTrack) =>
    Math.min(1, Math.max(0, bgmVolume * track.volumeScale));

  const scaledBgmGainValue = (track: BgmTrack) =>
    Math.min(0.22, Math.max(0, bgmVolume * 0.22 * track.volumeScale));

  const ensureBgmAudioContext = () => {
    if (bgmAudioContextRef.current && bgmGainRef.current) {
      return {
        context: bgmAudioContextRef.current,
        gain: bgmGainRef.current,
      };
    }
    const AudioContextConstructor = window.AudioContext;
    const context = new AudioContextConstructor();
    const gain = context.createGain();
    gain.gain.value = scaledBgmGainValue(currentBgmTrack());
    gain.connect(context.destination);
    bgmAudioContextRef.current = context;
    bgmGainRef.current = gain;
    return { context, gain };
  };

  const stopCurrentBgmNote = () => {
    const oscillator = bgmOscillatorRef.current;
    if (!oscillator) return;
    oscillator.onended = null;
    try {
      oscillator.stop();
    } catch {
      // Oscillators can only be stopped once.
    }
    bgmOscillatorRef.current = null;
  };

  const stopProgrammaticBgm = () => {
    bgmPlayingRef.current = false;
    if (bgmStepTimeoutRef.current !== null) {
      window.clearTimeout(bgmStepTimeoutRef.current);
      bgmStepTimeoutRef.current = null;
    }
    stopCurrentBgmNote();
  };

  const stopAudioBgm = () => {
    const audio = bgmAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  };

  const stopRecordPlayerBgm = () => {
    stopProgrammaticBgm();
    stopAudioBgm();
  };

  const playNextBgmStep = () => {
    if (!bgmPlayingRef.current) return;
    const track = currentBgmTrack();
    if (track.kind !== "programmatic") return;
    const { context, gain } = ensureBgmAudioContext();
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    const step = bgmStepRef.current % track.pattern.length;
    bgmStepRef.current += 1;
    const oscillator = context.createOscillator();
    const noteGain = context.createGain();
    const now = context.currentTime;
    const durationSeconds = step % 4 === 3 ? 0.34 : 0.18;
    oscillator.type = "square";
    oscillator.frequency.value = track.pattern[step];
    noteGain.gain.setValueAtTime(0.0001, now);
    noteGain.gain.exponentialRampToValueAtTime(0.42, now + 0.012);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
    oscillator.connect(noteGain);
    noteGain.connect(gain);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.02);
    bgmOscillatorRef.current = oscillator;

    bgmStepTimeoutRef.current = window.setTimeout(playNextBgmStep, track.stepMs);
  };

  const setRecordPlayerBgmPlaying = (shouldPlay: boolean) => {
    if (!shouldPlay || bgmVolume <= 0 || !audioUnlockedRef.current) {
      stopRecordPlayerBgm();
      return;
    }
    const track = currentBgmTrack();
    if (track.kind === "audio") {
      stopProgrammaticBgm();
      const audio = bgmAudioRef.current;
      if (!audio) return;
      if (audio.getAttribute("src") !== track.src) {
        audio.src = track.src;
        audio.load();
      }
      audio.loop = true;
      audio.volume = scaledBgmAudioVolume(track);
      if (audio.paused) {
        void audio.play().catch(() => undefined);
      }
      return;
    }
    stopAudioBgm();
    const { gain } = ensureBgmAudioContext();
    gain.gain.value = scaledBgmGainValue(track);
    if (bgmPlayingRef.current) return;
    bgmPlayingRef.current = true;
    playNextBgmStep();
  };

  const randomGameConsoleAudioSource = () =>
    GAME_CONSOLE_AUDIO_SOURCES[
      Math.floor(Math.random() * GAME_CONSOLE_AUDIO_SOURCES.length)
    ];

  const isGameConsoleAnimatingForAudio = () => {
    if (avatar.behavior !== "play") return false;
    return Boolean(
      contentRef.current.placedItems?.some((item) => {
        if (item.itemId !== "game-console") return false;
        if (activeInteraction?.furnitureId === item.id) return true;
        return isNearActivePlayTarget(avatar, item, contentRef.current);
      }),
    );
  };

  const isRecordPlayerAnimatingForAudio = () =>
    Boolean(
      activeRecordPlayerIdRef.current &&
        contentRef.current.placedItems?.some(
          (item) =>
            item.id === activeRecordPlayerIdRef.current &&
            item.itemId === RECORD_PLAYER_ITEM_ID,
        ),
    );

  const prepareGameConsoleAudioForNewPlay = () => {
    const audio = gameConsoleAudioRef.current;
    if (!audio) return;
    const source = randomGameConsoleAudioSource();
    gameConsoleAudioSourceRef.current = source;
    if (audio.getAttribute("src") !== source) {
      audio.src = source;
      audio.load();
    }
    audio.currentTime = 0;
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
    kind: PlacedItemInteractionKind,
  ) => {
    pendingWorldInteractionRef.current = {
      target: "placed-item",
      placedItem,
      item,
      kind,
    };
    const standpoints = getPlacedItemInteractionStandpoints(placedItem, contentRef.current);
    const target = getPlacedItemInteractionTarget(placedItem, contentRef.current);
    const behavior =
      kind === "brew"
        ? "brew"
        : kind === "paint"
          ? "paint"
          : kind === "play"
            ? "play"
            : kind === "music"
              ? "music"
              : kind === "stop-music"
                ? "music"
              : "interact";
    const activity =
      kind === "brew"
        ? "Brewing coffee"
        : kind === "paint"
          ? "Painting"
          : kind === "play"
            ? "Playing games"
            : kind === "music"
              ? "Playing music"
              : kind === "stop-music"
                ? "Stopping music"
              : "Heading over";
    runtimeRef.current = {
      ...runtimeRef.current,
      ...target,
      behavior: "wander",
      behaviorTimer: 20,
      expression: "calm",
      activityLabel: activity,
      interactionTargetAlternates: standpoints.length > 1 ? standpoints : undefined,
      actionIntent: behavior,
      actionActivityLabel: activity,
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

  const ensurePaintingDraftForEasel = (placedItem: PlacedItem) => {
    let nextProgress = 0;

    setSave((current) => {
      const gallery = normalizePaintingGallery(current.paintingGallery);
      const activeDraft = gallery.activeDraft
        ? {
            ...gallery.activeDraft,
            easelItemId: placedItem.id,
            updatedAt: new Date().toISOString(),
          }
        : createPaintingDraft(normalizeMemory(current.memory), {
            avatarId: current.avatarId,
            easelItemId: placedItem.id,
          });

      nextProgress = paintingProgressRatio(activeDraft);

      return {
        ...current,
        paintingGallery: {
          ...gallery,
          activeDraft,
        },
      };
    });

    return nextProgress;
  };

  const placedItemContextAction = (
    placedItem: PlacedItem,
  ): PlacedItemInteractionKind | null => {
    if (isBuiltinTerminalPlacedItem(placedItem)) return "interact";
    if (placedItem.itemId === COFFEE_MACHINE_ITEM_ID) return "brew";
    if (placedItem.itemId === "game-console") return "play";
    if (placedItem.itemId === RECORD_PLAYER_ITEM_ID) return "music";
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
      if (
        (isBuiltinTerminalPlacedItem(placedItem) && action === "interact") ||
        (placedItem.itemId === "game-console" && action === "play") ||
        (placedItem.itemId === RECORD_PLAYER_ITEM_ID &&
          (action === "music" || action === "stop-music"))
      ) {
        unlockAppAudio();
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

  const scrollRoomEditPanelIntoView = () => {
    if (!sidePanelOpen) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        roomEditPanelRef.current?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
      });
    });
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

  const applySaveSlotState = (slotId: string, nextSave: AivatarSaveState) => {
    activeSaveSlotIdRef.current = slotId;
    hadSavedStateRef.current = true;
    setActiveSaveSlotId(slotId);
    setSaveMenuOpen(false);
    setSaveMenuOpenedFromRoom(false);
    setCreatingSaveSlotIndex(null);
    clearSelectedRoomObject();
    updatePlacingItem(null);
    updatePlacementPreview(null);
    updateFurniturePlacementPreview(null);
    clearPendingFurnitureInteraction();
    updateActiveInteraction(null);
    setActiveRecordPlayerId(null);
    runtimeRef.current = nextSave.avatarRuntime ?? initialAvatarRuntime();
    setAvatar(runtimeRef.current);
    setSave(nextSave);
  };

  const selectSaveSlot = (slotId: string) => {
    const slot = saveSlotsRef.current.find((entry) => entry.id === slotId);
    if (!slot) return;

    setSaveSlotMessage("");
    persistCurrentSaveSlot();
    const nextSave = loadSave(contentBase, saveSlotStorageKey(slot.id));
    applySaveSlotState(slot.id, nextSave);
  };

  const openSaveSlotManager = () => {
    setSaveSlotMessage("");
    setDeleteSaveSlot(null);
    setCreatingSaveSlotIndex(null);
    persistCurrentSaveSlot();
    setSaveMenuOpenedFromRoom(true);
    setSaveMenuOpen(true);
  };

  const openSaveSlotWindow = async (slot: SaveSlotSummary) => {
    setSaveSlotMessage("");
    if (slot.id === activeSaveSlotIdRef.current) {
      setSaveSlotMessage(ui("saveSlots.windowAlreadyOpen"));
      return;
    }

    persistCurrentSaveSlot();

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<SaveSlotWindowResult>("open_save_slot_window", {
        request: {
          slot_id: slot.id,
          avatar_name: slot.avatarName,
        },
      });
      setSaveSlotMessage(ui("saveSlots.windowOpened", { name: slot.avatarName }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSaveSlotMessage(detail || ui("saveSlots.windowDesktopOnly"));
    }
  };

  const startCreateSaveSlot = (slotIndex: number) => {
    setSaveSlotMessage("");
    setDeleteSaveSlot(null);
    setCreatingSaveSlotIndex(slotIndex);
    setSelectedAvatarAppearanceId(DEFAULT_AVATAR_APPEARANCE_ID);
    setNewSaveAvatarName(contentBase.avatar.name);
  };

  const installSaveIntoSlot = (slotIndex: number, nextSave: AivatarSaveState) => {
    if (saveSlotsRef.current.some((slot) => slot.slotIndex === slotIndex)) return;
    persistCurrentSaveSlot();

    const slotId = createSaveSlotId();
    const timestamp = new Date().toISOString();
    const nextSlot = createSaveSlotSummary(slotId, slotIndex, nextSave, timestamp);
    const nextSlots = [...saveSlotsRef.current, nextSlot].sort(
      (a, b) => a.slotIndex - b.slotIndex,
    );

    persistSave(nextSave, saveSlotStorageKey(slotId));
    saveSlotsRef.current = nextSlots;
    writeSaveSlots(nextSlots);
    setSaveSlots(nextSlots);
    applySaveSlotState(slotId, nextSave);
  };

  const createSaveSlot = () => {
    if (creatingSaveSlotIndex === null) return;

    const creatableAppearanceId = AVATAR_APPEARANCES.some(
      (appearance) => appearance.id === selectedAvatarAppearanceId,
    )
      ? selectedAvatarAppearanceId
      : DEFAULT_AVATAR_APPEARANCE_ID;
    const nextSave = saveFromContent(contentBase, {
      avatarAppearanceId: creatableAppearanceId,
      avatarName: newSaveAvatarName,
    });
    installSaveIntoSlot(creatingSaveSlotIndex, nextSave);
  };

  const readLocalSaveFromFiles = async (files: File[], fromFolder: boolean) => {
    if (creatingSaveSlotIndex === null) return;
    if (files.length === 0) {
      setSaveSlotMessage(ui("saveSlots.importNoFile"));
      return;
    }

    const saveFile = fromFolder
      ? files.find((file) => file.name.toLowerCase() === "aivatar-save.json") ??
        files.find((file) => file.name.toLowerCase() === "save.json")
      : files[0];

    if (!saveFile) {
      setSaveSlotMessage(ui("saveSlots.importNoSaveFile"));
      return;
    }

    try {
      const importedSave = parseImportedSave(contentBase, await saveFile.text());
      if (!importedSave) {
        setSaveSlotMessage(ui("saveSlots.importInvalid"));
        return;
      }

      installSaveIntoSlot(creatingSaveSlotIndex, importedSave);
    } catch (error) {
      console.warn("Could not import Aivatar save.", error);
      setSaveSlotMessage(ui("saveSlots.importFailed"));
    }
  };

  const openLocalSavePicker = (fromFolder: boolean) => {
    if (creatingSaveSlotIndex === null) return;
    if (saveSlotsRef.current.some((slot) => slot.slotIndex === creatingSaveSlotIndex)) {
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.multiple = fromFolder;
    if (fromFolder) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
    input.addEventListener("change", () => {
      void readLocalSaveFromFiles(Array.from(input.files ?? []), fromFolder);
    });
    input.click();
  };

  const requestDeleteSaveSlot = (slot: SaveSlotSummary) => {
    setSaveSlotMessage("");
    setCreatingSaveSlotIndex(null);
    setDeleteSaveSlot(slot);
  };

  const confirmDeleteSaveSlot = () => {
    if (!deleteSaveSlot) return;

    try {
      localStorage.removeItem(saveSlotStorageKey(deleteSaveSlot.id));
    } catch (error) {
      console.warn("Could not delete Aivatar save slot.", error);
    }

    const nextSlots = saveSlotsRef.current.filter((slot) => slot.id !== deleteSaveSlot.id);
    saveSlotsRef.current = nextSlots;
    writeSaveSlots(nextSlots);
    setSaveSlots(nextSlots);
    setSaveSlotMessage(
      ui("saveSlots.deleted", {
        name: deleteSaveSlot.avatarName,
      }),
    );

    if (activeSaveSlotIdRef.current === deleteSaveSlot.id) {
      activeSaveSlotIdRef.current = null;
      hadSavedStateRef.current = false;
      persistActiveSaveSlotId(null);
      setActiveSaveSlotId(null);
      runtimeRef.current = initialAvatarRuntime();
      setAvatar(runtimeRef.current);
      setSave(saveFromContent(contentBase));
      setSaveMenuOpenedFromRoom(false);
      setSaveMenuOpen(true);
      setCreatingSaveSlotIndex(nextSlots.length === 0 ? 0 : null);
    }

    setDeleteSaveSlot(null);
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
    activeRecordPlayerIdRef.current = activeRecordPlayerId;
    activeRecordPlayerStartedAtRef.current = activeRecordPlayerId
      ? performance.now()
      : null;
  }, [activeRecordPlayerId]);

  useEffect(() => {
    if (
      activeRecordPlayerId &&
      !content.placedItems?.some((item) => item.id === activeRecordPlayerId)
    ) {
      setActiveRecordPlayerId(null);
    }
  }, [activeRecordPlayerId, content.placedItems]);

  useEffect(() => {
    windowTimePreviewRef.current = windowTimePreview;
  }, [windowTimePreview]);

  useEffect(() => {
    windowPreviewHourRef.current = windowPreviewHour;
  }, [windowPreviewHour]);

  useEffect(() => {
    navDebugOverlayRef.current = navDebugOverlay;
  }, [navDebugOverlay]);

  useEffect(() => {
    persistTaskCabinetEntries(taskCabinetEntries);
    taskCabinetEntriesRef.current = taskCabinetEntries;
    taskCabinetSceneCountsRef.current = taskCabinetCounts;
  }, [taskCabinetEntries, taskCabinetCounts]);

  const getWindowTimeMs = (frame: number) => {
    const previewHour = windowPreviewHourRef.current;
    if (previewHour !== null) {
      const previewDate = new Date(Date.now());
      previewDate.setHours(previewHour, 0, 0, 0);
      return previewDate.getTime();
    }

    return windowTimePreviewRef.current ? Date.now() + frame * 60000 : Date.now();
  };

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
        localizedInteractionBubble(activeInteraction, locale),
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
        taskCabinetCounts.activeFileCount,
        taskCabinetCounts.failedFileCount,
        uiThemeForScene(uiTheme),
        navDebugOverlay,
        save.paintingGallery,
        activeRecordPlayerId,
        normalizeAvatarAppearanceId(save.avatarAppearanceId),
        localizedRoomVisitors(roomVisitor ? [roomVisitor] : [], locale),
        !avatarAway,
      );
    }
  }, [
    activeInteraction,
    activeRecordPlayerId,
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
    save.avatarAppearanceId,
    save.memory,
    save.paintingGallery,
    taskCabinetCounts,
    uiTheme,
    locale,
    navDebugOverlay,
    roomVisitor,
    avatarAway,
  ]);

  useEffect(() => {
    statusRef.current = { status: effectiveStatus, source: effectiveSource, endpoint };
  }, [effectiveSource, effectiveStatus, endpoint]);

  useEffect(() => {
    saveSlotsRef.current = saveSlots;
  }, [saveSlots]);

  useEffect(() => {
    activeSaveSlotIdRef.current = activeSaveSlotId;
    persistActiveSaveSlotId(activeSaveSlotId);
  }, [activeSaveSlotId]);

  useEffect(() => {
    saveMenuOpenRef.current = saveMenuOpen;
  }, [saveMenuOpen]);

  useEffect(() => {
    roomVisitMenuOpenRef.current = roomVisitMenuOpen;
  }, [roomVisitMenuOpen]);

  useEffect(() => {
    saveRef.current = save;
    if (!activeSaveSlotId) return;

    const savedState = {
      ...save,
      avatarRuntime: runtimeRef.current,
    };
    persistSave(savedState, saveSlotStorageKey(activeSaveSlotId));
    updateSaveSlotSummary(activeSaveSlotId, savedState);
  }, [activeSaveSlotId, save]);

  useEffect(() => {
    roomSnapshotRef.current = roomSnapshot;
  }, [roomSnapshot]);

  useEffect(() => {
    activeVisitRef.current = activeVisit;
  }, [activeVisit]);

  useEffect(() => {
    roomVisitorRef.current = roomVisitor;
  }, [roomVisitor]);

  useEffect(() => {
    avatarAwayRef.current = avatarAway;
  }, [avatarAway]);

  useEffect(() => {
    if (!roomVisitMessage) return;
    const timer = window.setTimeout(() => setRoomVisitMessage(""), 4500);
    return () => window.clearTimeout(timer);
  }, [roomVisitMessage]);

  useEffect(() => {
    if (!activeSaveSlotId || saveMenuOpen) return;

    let stopped = false;

    const syncRooms = async () => {
      const currentVisit = activeVisitRef.current;
      const isHosting =
        currentVisit?.host.roomInstanceId === roomInstanceIdRef.current &&
        currentVisit.phase !== "cancelled" &&
        currentVisit.phase !== "ended";
      const isBusyForRoomVisit = !currentVisit && isHighPriorityStatus(statusRef.current.status);
      const presence = currentRoomPresence(
        avatarAwayRef.current
          ? "away"
          : isHosting
            ? "hosting"
            : isBusyForRoomVisit
              ? "busy"
              : "home",
        currentVisit?.visitId ?? null,
      );

      try {
        if (presence) {
          await postRoomJson(ROOMS_URL, presence);
        }
        const response = await fetch(ROOMS_URL);
        if (!response.ok) {
          throw new Error(`Room snapshot failed: ${response.status}`);
        }
        const snapshot = normalizeRoomsSnapshotValue(await response.json());
        roomSnapshotFailuresRef.current = 0;
        if (stopped) return;
        roomSnapshotRef.current = snapshot;
        setRoomSnapshot(snapshot);
        handleRoomSnapshot(snapshot);
      } catch {
        roomSnapshotFailuresRef.current += 1;
        const activeRoomVisit = activeVisitRef.current;
        if (
          activeRoomVisit &&
          roomSnapshotFailuresRef.current >= ROOM_VISIT_CONNECTION_FAILURE_LIMIT
        ) {
          finishVisitLocally(activeRoomVisit, {
            returnHome: avatarAwayRef.current,
            cancelled: true,
            message: ui("roomVisit.connectionLost"),
            publishCancel: true,
          });
        }
      }
    };

    void syncRooms();
    const timer = window.setInterval(syncRooms, ROOM_PRESENCE_SYNC_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      const activeRoomVisit = activeVisitRef.current;
      if (activeRoomVisit) {
        publishVisitEnd(activeRoomVisit, "cancelled", "room closed");
      }
    };
  }, [activeSaveSlotId, saveMenuOpen]);

  useEffect(() => {
    if (!activeSaveSlotId || saveMenuOpen) return;
    const timer = window.setInterval(
      () => startAutonomousRoomVisit(Date.now()),
      ROOM_VISIT_AUTO_CHECK_MS,
    );
    return () => window.clearInterval(timer);
  }, [activeSaveSlotId, saveMenuOpen]);

  const compactPaintingPlanText = (value: unknown, maxLength: number) =>
    Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
      .slice(0, maxLength)
      .join("");

  const paintingPlanPayloadForDraft = (draft: AivatarPaintingDraft) => {
    const current = saveRef.current;
    const currentMemory = normalizeMemory(current.memory);
    const sortedTraits = (
      Object.entries(currentMemory.growth.traits) as Array<[GrowthTrait, number]>
    ).sort((left, right) => right[1] - left[1]);
    const dominantTrait = sortedTraits[0]?.[0] ?? "focus";
    const secondaryTrait = sortedTraits[1]?.[0] ?? dominantTrait;

    return {
      avatarId: compactPaintingPlanText(current.avatarId, 80),
      avatarName: compactPaintingPlanText(
        current.avatarName ?? contentBase.avatar.name,
        40,
      ),
      growthLevel: currentMemory.growth.level,
      traits: currentMemory.growth.traits,
      dominantTrait,
      secondaryTrait,
      preferences: {
        favoriteActivity: currentMemory.preferences.favoriteActivity,
        favoriteRecovery: currentMemory.preferences.favoriteRecovery,
        idleBubbleLanguage:
          currentMemory.preferences.idleBubbleLanguage ?? "auto",
      },
      savedBubbles: (currentMemory.preferences.idleBubblePhrases ?? [])
        .slice(0, 6)
        .map((phrase) => compactPaintingPlanText(phrase, 80))
        .filter(Boolean),
      recentEvents: currentMemory.recentEvents.slice(0, 8).map((event) => ({
        type: event.type,
        summary: compactPaintingPlanText(event.summary, 180),
        agent: compactPaintingPlanText(event.agent, 40) || undefined,
        status: event.status,
        behavior: event.behavior,
        itemId: compactPaintingPlanText(event.itemId, 80) || undefined,
        bits: event.bits,
      })),
      draft: {
        id: draft.id,
        easelItemId: draft.easelItemId,
        createdAt: draft.artwork.createdAt,
        progressSeconds: Math.round(draft.progressSeconds),
        targetSeconds: Math.round(draft.targetSeconds),
        sourceSummary: compactPaintingPlanText(draft.artwork.sourceSummary, 220),
      },
      seedHint: `${current.avatarId}:${draft.id}:${draft.artwork.seed}:${Date.now()}`,
    };
  };

  const requestPaintingPlanForDraft = async (draft: AivatarPaintingDraft) => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      PAINTING_PLAN_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(PAINTING_PLAN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(paintingPlanPayloadForDraft(draft)),
        signal: controller.signal,
      });
      if (!response.ok) return;

      const parsed = (await response.json()) as {
        paintingPlan?: Partial<AivatarPaintingPlan>;
        plan?: Partial<AivatarPaintingPlan>;
      };
      const paintingPlan = parsed.paintingPlan ?? parsed.plan;
      if (!paintingPlan || typeof paintingPlan !== "object") return;

      setSave((current) => {
        const gallery = normalizePaintingGallery(current.paintingGallery);
        const activeDraft = gallery.activeDraft;
        if (!activeDraft || activeDraft.id !== draft.id) return current;
        if (
          draft.easelItemId &&
          activeDraft.easelItemId &&
          activeDraft.easelItemId !== draft.easelItemId
        ) {
          return current;
        }
        if (activeDraft.artwork.paintingPlan?.source === "llm") return current;

        const replacementDraft = createPaintingDraft(normalizeMemory(current.memory), {
          avatarId: current.avatarId,
          easelItemId: activeDraft.easelItemId,
          nowIso: activeDraft.artwork.createdAt,
          paintingPlan,
        });

        return {
          ...current,
          paintingGallery: {
            ...gallery,
            activeDraft: {
              ...activeDraft,
              artwork: replacementDraft.artwork,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });
    } finally {
      window.clearTimeout(timer);
    }
  };

  useEffect(() => {
    const activeDraft = normalizePaintingGallery(save.paintingGallery).activeDraft;
    if (!activeDraft || activeDraft.artwork.paintingPlan?.source === "llm") return;
    if (paintingPlanRequestsRef.current.has(activeDraft.id)) return;
    paintingPlanRequestsRef.current.add(activeDraft.id);
    void requestPaintingPlanForDraft(activeDraft).catch(() => undefined);
  }, [save.paintingGallery]);

  useEffect(() => {
    const currentMemory = normalizeMemory(save.memory);
    const payload = {
      avatarId: save.avatarId,
      avatarName: save.avatarName ?? contentBase.avatar.name,
      growth: {
        level: currentMemory.growth.level,
        traits: currentMemory.growth.traits,
      },
      preferences: {
        idleBubbleLanguage: currentMemory.preferences.idleBubbleLanguage ?? "auto",
      },
    };
    const body = JSON.stringify(payload);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    void fetch(AVATAR_STATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    })
      .catch(() => {
        if (!navigator.sendBeacon) return undefined;
        navigator.sendBeacon(
          AVATAR_STATE_URL,
          new Blob([body], { type: "application/json" }),
        );
        return undefined;
      })
      .finally(() => window.clearTimeout(timer));
  }, [contentBase.avatar.name, save.avatarId, save.avatarName, save.memory]);

  useEffect(() => {
    const flushSave = () => {
      persistCurrentSaveSlot(false);
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
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => {
    localStorage.setItem(UI_THEME_KEY, uiTheme);
    uiThemeRef.current = uiTheme;
  }, [uiTheme]);

  useEffect(() => {
    const keyboardAudio = new Audio(KEYBOARD_TYPING_AUDIO_SRC);
    keyboardAudio.loop = true;
    keyboardAudio.preload = "auto";
    keyboardAudio.volume = audioVolume;
    keyboardTypingAudioRef.current = keyboardAudio;

    const coffeeMachineAudio = new Audio(COFFEE_MACHINE_BREW_AUDIO_SRC);
    coffeeMachineAudio.loop = true;
    coffeeMachineAudio.preload = "auto";
    coffeeMachineAudio.volume = audioVolume;
    coffeeMachineBrewAudioRef.current = coffeeMachineAudio;

    const fridgeDoorOpenAudio = new Audio(FRIDGE_DOOR_OPEN_AUDIO_SRC);
    fridgeDoorOpenAudio.preload = "auto";
    fridgeDoorOpenAudio.volume = audioVolume;
    fridgeDoorOpenAudioRef.current = fridgeDoorOpenAudio;

    const fridgeDoorCloseAudio = new Audio(FRIDGE_DOOR_CLOSE_AUDIO_SRC);
    fridgeDoorCloseAudio.preload = "auto";
    fridgeDoorCloseAudio.volume = audioVolume;
    fridgeDoorCloseAudioRef.current = fridgeDoorCloseAudio;

    const agentCompleteAudio = new Audio(AGENT_COMPLETE_AUDIO_SRC);
    agentCompleteAudio.preload = "auto";
    agentCompleteAudio.volume = audioVolume;
    agentCompleteAudioRef.current = agentCompleteAudio;

    const bitsSpendAudio = new Audio(BITS_SPEND_AUDIO_SRC);
    bitsSpendAudio.preload = "auto";
    bitsSpendAudio.volume = audioVolume;
    bitsSpendAudioRef.current = bitsSpendAudio;

    const colaCanOpenAudio = new Audio(COLA_CAN_OPEN_AUDIO_SRC);
    colaCanOpenAudio.preload = "auto";
    colaCanOpenAudio.volume = audioVolume;
    colaCanOpenAudioRef.current = colaCanOpenAudio;

    const colaDrinkAudio = new Audio(COLA_DRINK_AUDIO_SRC);
    colaDrinkAudio.preload = "auto";
    colaDrinkAudio.volume = audioVolume;
    colaDrinkAudioRef.current = colaDrinkAudio;

    const coffeeDrinkAudio = new Audio(COFFEE_DRINK_AUDIO_SRC);
    coffeeDrinkAudio.preload = "auto";
    coffeeDrinkAudio.volume = audioVolume;
    coffeeDrinkAudioRef.current = coffeeDrinkAudio;

    const bentoEatAudio = new Audio(BENTO_EAT_AUDIO_SRC);
    bentoEatAudio.preload = "auto";
    bentoEatAudio.volume = audioVolume;
    bentoEatAudioRef.current = bentoEatAudio;

    const sleepSnoreAudio = new Audio(SLEEP_SNORE_AUDIO_SRC);
    sleepSnoreAudio.loop = true;
    sleepSnoreAudio.preload = "auto";
    sleepSnoreAudio.volume = audioVolume;
    sleepSnoreAudioRef.current = sleepSnoreAudio;

    const gameAudio = new Audio(gameConsoleAudioSourceRef.current);
    gameAudio.loop = true;
    gameAudio.preload = "auto";
    gameAudio.volume = Math.min(1, Math.max(0, audioVolume * gameConsoleVolume));
    gameConsoleAudioRef.current = gameAudio;

    const bgmAudio = new Audio();
    bgmAudio.loop = true;
    bgmAudio.preload = "auto";
    bgmAudio.volume = bgmVolume;
    bgmAudioRef.current = bgmAudio;

    return () => {
      keyboardAudio.pause();
      coffeeMachineAudio.pause();
      fridgeDoorOpenAudio.pause();
      fridgeDoorCloseAudio.pause();
      agentCompleteAudio.pause();
      bitsSpendAudio.pause();
      clearShopLongPressTimer();
      colaCanOpenAudio.pause();
      colaDrinkAudio.pause();
      coffeeDrinkAudio.pause();
      bentoEatAudio.pause();
      sleepSnoreAudio.pause();
      if (colaDrinkAudioTimeoutRef.current !== null) {
        window.clearTimeout(colaDrinkAudioTimeoutRef.current);
        colaDrinkAudioTimeoutRef.current = null;
      }
      gameAudio.pause();
      stopRecordPlayerBgm();
      bgmAudio.pause();
      void bgmAudioContextRef.current?.close().catch(() => undefined);
      bgmAudioContextRef.current = null;
      bgmGainRef.current = null;
      keyboardTypingAudioRef.current = null;
      coffeeMachineBrewAudioRef.current = null;
      fridgeDoorOpenAudioRef.current = null;
      fridgeDoorCloseAudioRef.current = null;
      agentCompleteAudioRef.current = null;
      bitsSpendAudioRef.current = null;
      colaCanOpenAudioRef.current = null;
      colaDrinkAudioRef.current = null;
      coffeeDrinkAudioRef.current = null;
      bentoEatAudioRef.current = null;
      sleepSnoreAudioRef.current = null;
      gameConsoleAudioRef.current = null;
      bgmAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(AUDIO_VOLUME_KEY, String(audioVolume));
    [
      keyboardTypingAudioRef.current,
      coffeeMachineBrewAudioRef.current,
      fridgeDoorOpenAudioRef.current,
      fridgeDoorCloseAudioRef.current,
      agentCompleteAudioRef.current,
      bitsSpendAudioRef.current,
      colaCanOpenAudioRef.current,
      colaDrinkAudioRef.current,
      coffeeDrinkAudioRef.current,
      bentoEatAudioRef.current,
      sleepSnoreAudioRef.current,
      gameConsoleAudioRef.current,
    ].forEach((audio) => {
      if (!audio) return;
      audio.volume = audioVolume;
      if (audioVolume <= 0) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  }, [audioVolume]);

  useEffect(() => {
    localStorage.setItem(GAME_CONSOLE_VOLUME_KEY, String(gameConsoleVolume));
    const audio = gameConsoleAudioRef.current;
    if (!audio) return;
    audio.volume = Math.min(1, Math.max(0, audioVolume * gameConsoleVolume));
    if (audioVolume <= 0 || gameConsoleVolume <= 0) {
      pauseAudio(audio);
    }
  }, [audioVolume, gameConsoleVolume]);

  useEffect(() => {
    localStorage.setItem(STARTUP_SOUND_KEY, String(startupSoundEnabled));
  }, [startupSoundEnabled]);

  useEffect(() => {
    localStorage.setItem(BGM_VOLUME_KEY, String(bgmVolume));
    if (bgmGainRef.current) {
      bgmGainRef.current.gain.value = scaledBgmGainValue(currentBgmTrack());
    }
    if (bgmAudioRef.current) {
      bgmAudioRef.current.volume = scaledBgmAudioVolume(currentBgmTrack());
    }
    if (bgmVolume <= 0) stopRecordPlayerBgm();
  }, [bgmVolume]);

  useEffect(() => {
    localStorage.setItem(BGM_TRACK_KEY, bgmTrackId);
    bgmTrackIdRef.current = bgmTrackId;
    bgmStepRef.current = 0;
    if (activeRecordPlayerIdRef.current) {
      stopRecordPlayerBgm();
      setRecordPlayerBgmPlaying(isRecordPlayerAnimatingForAudio());
    }
  }, [bgmTrackId]);

  useEffect(() => {
    localStorage.setItem(AUTO_MUSIC_KEY, String(autoMusicEnabled));
    autoMusicEnabledRef.current = autoMusicEnabled;
  }, [autoMusicEnabled]);

  useEffect(() => {
    localStorage.setItem(ALWAYS_ON_TOP_KEY, String(alwaysOnTopEnabled));
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().setAlwaysOnTop(alwaysOnTopEnabled),
      )
      .catch(() => {
        // Web preview has no native window to update.
      });
  }, [alwaysOnTopEnabled]);

  useEffect(() => {
    const unlockOnFirstInteraction = () => {
      unlockAppAudio();
      playStartupSound();
    };

    window.addEventListener("pointerdown", unlockOnFirstInteraction, { once: true });
    window.addEventListener("keydown", unlockOnFirstInteraction, { once: true });
    window.addEventListener("touchstart", unlockOnFirstInteraction, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockOnFirstInteraction);
      window.removeEventListener("keydown", unlockOnFirstInteraction);
      window.removeEventListener("touchstart", unlockOnFirstInteraction);
    };
  }, [startupSoundEnabled, audioVolume]);

  useEffect(() => {
    const activeBehavior = runtimeActionBehavior(avatar);
    const terminal = contentRef.current.placedItems?.find(
      (item) =>
        item.id === BUILTIN_TERMINAL_PLACED_ITEM_ID ||
        item.itemId === TERMINAL_MONITOR_ITEM_ID,
    );
    const isTerminalAnimating =
      Boolean(terminal) &&
      (avatar.behavior === "coding" || avatar.behavior === "thinking") &&
      Math.hypot(avatar.x - terminal!.x, avatar.y - (terminal!.y + 18)) < 92;
    const canPlayAudio = audioVolume > 0 && audioUnlockedRef.current;
    const isCoffeeMachineBrewing =
      activeInteraction?.kind === "brew" && activeBehavior === "brew";
    const activeFridgeFeedInteraction =
      activeInteraction?.kind === "feed" && activeInteraction.furnitureId === "fridge"
        ? activeInteraction
        : null;
    const isGameConsoleAnimating = isGameConsoleAnimatingForAudio();
    const isRecordPlayerAnimating = isRecordPlayerAnimatingForAudio();
    const isColaSipping = activeBehavior === "cola";
    const isCoffeeSipping = activeBehavior === "coffee";
    const isFoodEating = activeBehavior === "bento" || activeBehavior === "cookie";
    const isSleepingForAudio = avatar.behavior === "sleep" && !avatar.actionIntent;

    if (isGameConsoleAnimating && !gameConsoleAnimatingRef.current) {
      prepareGameConsoleAudioForNewPlay();
    }
    gameConsoleAnimatingRef.current = isGameConsoleAnimating;

    if (activeFridgeFeedInteraction && canPlayAudio) {
      const interactionKey = `${activeFridgeFeedInteraction.furnitureId}:${activeFridgeFeedInteraction.startedAt}`;
      const elapsedMs = performance.now() - activeFridgeFeedInteraction.startedAt;
      if (fridgeDoorAudioInteractionRef.current?.key !== interactionKey) {
        fridgeDoorAudioInteractionRef.current = {
          key: interactionKey,
          closePlayed: false,
        };
        playOneShotAudio(
          fridgeDoorOpenAudioRef.current,
          FRIDGE_DOOR_AUDIO_VOLUME_MULTIPLIER,
        );
      }
      if (
        elapsedMs >= FRIDGE_DOOR_CLOSE_AUDIO_DELAY_MS &&
        !fridgeDoorAudioInteractionRef.current.closePlayed
      ) {
        fridgeDoorAudioInteractionRef.current.closePlayed = true;
        playOneShotAudio(
          fridgeDoorCloseAudioRef.current,
          FRIDGE_DOOR_AUDIO_VOLUME_MULTIPLIER,
        );
      }
    } else if (!activeFridgeFeedInteraction) {
      fridgeDoorAudioInteractionRef.current = null;
    }

    if (!isColaSipping) {
      colaSippingAudioRef.current = false;
      if (colaDrinkAudioTimeoutRef.current !== null) {
        window.clearTimeout(colaDrinkAudioTimeoutRef.current);
        colaDrinkAudioTimeoutRef.current = null;
      }
    } else if (canPlayAudio && !colaSippingAudioRef.current) {
      const colaCanOpenDelayElapsed =
        !activeFridgeFeedInteraction ||
        performance.now() - activeFridgeFeedInteraction.startedAt >=
          COLA_CAN_OPEN_AFTER_FRIDGE_DELAY_MS;
      if (colaCanOpenDelayElapsed) {
        colaSippingAudioRef.current = true;
        playOneShotAudio(
          colaCanOpenAudioRef.current,
          COLA_CAN_OPEN_AUDIO_VOLUME_MULTIPLIER,
        );
        colaDrinkAudioTimeoutRef.current = window.setTimeout(() => {
          colaDrinkAudioTimeoutRef.current = null;
          playOneShotAudio(
            colaDrinkAudioRef.current,
            COLA_DRINK_AUDIO_VOLUME_MULTIPLIER,
          );
        }, COLA_DRINK_AFTER_CAN_OPEN_DELAY_MS);
      }
    }

    if (!isCoffeeSipping) {
      coffeeSippingAudioRef.current = false;
      pauseAudio(coffeeDrinkAudioRef.current);
    } else if (canPlayAudio && !coffeeSippingAudioRef.current) {
      coffeeSippingAudioRef.current = true;
      playOneShotAudio(
        coffeeDrinkAudioRef.current,
        COFFEE_DRINK_AUDIO_VOLUME_MULTIPLIER,
      );
    }

    if (!isFoodEating) {
      bentoEatingAudioRef.current = false;
      pauseAudio(bentoEatAudioRef.current);
    } else if (canPlayAudio && !bentoEatingAudioRef.current) {
      bentoEatingAudioRef.current = true;
      playOneShotAudio(
        bentoEatAudioRef.current,
        BENTO_EAT_AUDIO_VOLUME_MULTIPLIER,
      );
    }

    setAudioPlaying(keyboardTypingAudioRef.current, isTerminalAnimating && canPlayAudio);
    setAudioPlaying(
      coffeeMachineBrewAudioRef.current,
      isCoffeeMachineBrewing && canPlayAudio,
      COFFEE_MACHINE_BREW_AUDIO_VOLUME_MULTIPLIER,
    );
    setAudioPlaying(
      gameConsoleAudioRef.current,
      isGameConsoleAnimating && canPlayAudio && gameConsoleVolume > 0,
      gameConsoleVolume,
    );
    setAudioPlaying(
      sleepSnoreAudioRef.current,
      isSleepingForAudio && canPlayAudio,
      SLEEP_SNORE_AUDIO_VOLUME_MULTIPLIER,
    );
    setRecordPlayerBgmPlaying(isRecordPlayerAnimating && canPlayAudio);
  }, [
    activeInteraction,
    activeRecordPlayerId,
    audioVolume,
    bgmTrackId,
    bgmVolume,
    gameConsoleVolume,
    avatar,
  ]);

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
    let paintingProgressAccumulator = 0;
    let coffeeAccumulator = 0;
    let bgmAutonomousStopAccumulator = 0;
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
    let autonomousActionWatchKey = "";
    let autonomousActionWatchSeconds = 0;
    let stopped = false;

    const loop = (now: number) => {
      if (stopped) return;
      const rawElapsedSeconds = (now - previous) / 1000;
      const elapsedSeconds = Number.isFinite(rawElapsedSeconds)
        ? Math.min(Math.max(rawElapsedSeconds, 0), 0.08)
        : 0;
      previous = now;
      frame += 1;
      statAccumulator += elapsedSeconds;
      uiAccumulator += elapsedSeconds;
      const currentContent = contentRef.current;
      const currentTableCoffeeQuantity = getTableCoffeeQuantity(
        saveRef.current.furnitureStorage,
        currentContent.placedItems,
      );
      const navLayoutFingerprint = navigationLayoutFingerprint(currentContent);
      const currentStatus = statusRef.current.status;
      const currentInteraction = activeInteractionRef.current;
      const pendingWorldInteraction = pendingWorldInteractionRef.current;
      const activeRoomVisit = activeVisitRef.current;
      const guestLeavingForVisit = Boolean(
        activeRoomVisit &&
          activeRoomVisit.guest.roomInstanceId === roomInstanceIdRef.current &&
          !avatarAwayRef.current,
      );
      const taskCabinetVisualFlow = taskCabinetVisualFlowRef.current;
      const taskCabinetVisualFlowActive = Boolean(taskCabinetVisualFlow);
      const blockingInteraction = isBlockingInteraction(currentInteraction);
      const furnitureInteractionActive =
        pendingWorldInteraction ||
        blockingInteraction;
      const busyRecoveryNeed = !guestLeavingForVisit &&
        !furnitureInteractionActive &&
        !taskCabinetVisualFlowActive
        ? getBusyRecoveryNeed(
            currentStatus,
            currentContent,
            saveRef.current.furnitureStorage,
            saveRef.current.memory,
          )
        : null;
      const busyRecoveryActive = Boolean(busyRecoveryNeed);
      const currentRuntimeAction = runtimeActionBehavior(runtimeRef.current);
      const avatarStatus =
        guestLeavingForVisit ||
        busyRecoveryActive ||
        taskCabinetVisualFlowActive ||
        (furnitureInteractionActive && !isHighPriorityStatus(currentStatus))
          ? {
              ...currentStatus,
              status: "idle" as const,
            }
          : currentStatus;

      if (avatarAwayRef.current) {
        if (uiAccumulator >= 0.2) {
          uiAccumulator = 0;
          setNowMs(Date.now());
          setAvatar(runtimeRef.current);
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
            localizedInteractionBubble(activeInteractionRef.current, localeRef.current),
            null,
            selectedPlacedItemRef.current?.id,
            selectedWindowRef.current?.id,
            null,
            null,
            currentTableCoffeeQuantity,
            saveRef.current.memory,
            getWindowTimeMs(frame),
            taskCabinetSceneCountsRef.current.activeFileCount,
            taskCabinetSceneCountsRef.current.failedFileCount,
            uiThemeForScene(uiThemeRef.current),
            navDebugOverlayRef.current,
            saveRef.current.paintingGallery,
            activeRecordPlayerIdRef.current,
            normalizeAvatarAppearanceId(saveRef.current.avatarAppearanceId),
            localizedRoomVisitors(
              roomVisitorRef.current ? [roomVisitorRef.current] : [],
              localeRef.current,
            ),
            false,
          );
        }

        requestAnimationFrame(loop);
        return;
      }

      const recordPlayerPlayingForSeconds = activeRecordPlayerStartedAtRef.current
        ? (now - activeRecordPlayerStartedAtRef.current) / 1000
        : 0;
      const hostRoomVisitSocialActive = Boolean(roomVisitHostActivityRef.current);
      const canAutonomouslyStopBgm =
        Boolean(activeRecordPlayerIdRef.current) &&
        recordPlayerPlayingForSeconds >= BGM_AUTONOMOUS_STOP_MIN_SECONDS &&
        !isHighPriorityStatus(currentStatus) &&
        !guestLeavingForVisit &&
        !hostRoomVisitSocialActive &&
        !pendingWorldInteractionRef.current &&
        !blockingInteraction &&
        !taskCabinetVisualFlowActive;

      if (canAutonomouslyStopBgm) {
        bgmAutonomousStopAccumulator += elapsedSeconds;
        if (bgmAutonomousStopAccumulator >= BGM_AUTONOMOUS_STOP_CHECK_SECONDS) {
          bgmAutonomousStopAccumulator = 0;
          if (Math.random() < BGM_AUTONOMOUS_STOP_CHANCE) {
            const recordPlayerDefinition = currentContent.itemDefinitions.find(
              (item) => item.id === RECORD_PLAYER_ITEM_ID,
            );
            const activeRecordPlayer = currentContent.placedItems?.find(
              (item) => item.id === activeRecordPlayerIdRef.current,
            );
            if (activeRecordPlayer && recordPlayerDefinition) {
              queuePlacedItemInteraction(
                activeRecordPlayer,
                recordPlayerDefinition,
                "stop-music",
              );
            } else {
              const recordPlayerName = recordPlayerDefinition?.name ?? "Record Player";
              activeRecordPlayerIdRef.current = null;
              activeRecordPlayerStartedAtRef.current = null;
              setActiveRecordPlayerId(null);
              stopRecordPlayerBgm();
              updateActiveInteraction({
                kind: "none",
                furnitureId: activeRecordPlayer?.id ?? RECORD_PLAYER_ITEM_ID,
                furnitureName: recordPlayerName,
                message: ui("message.musicStopped", { name: recordPlayerName }),
                startedAt: now,
                endsAt: now + INTERACTION_FEEDBACK_SECONDS * 1000,
                bubbleText: ui("thought.stopMusic"),
              });
            }
          }
        }
      } else {
        bgmAutonomousStopAccumulator = 0;
      }

      if (
        busyRecoveryNeed &&
        currentRuntimeAction !== busyRecoveryNeed.behavior
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
                behavior: "wander",
                behaviorTimer: 6,
                expression: "calm",
                activityLabel: "Playing games",
                interactionTargetAlternates:
                  gameConsoleStandpoints.length > 1 ? gameConsoleStandpoints : undefined,
                actionIntent: "play",
                actionActivityLabel: "Playing games",
              }
            : setBehavior(runtimeRef.current, "play", currentContent, 6, "Playing games");
        }
      }

      if (guestLeavingForVisit) {
        runtimeRef.current = {
          ...runtimeRef.current,
          targetX: ROOM_DOOR_OUTSIDE_POINT.x,
          targetY: ROOM_DOOR_OUTSIDE_POINT.y,
          behavior: "wander",
          behaviorTimer: Math.max(runtimeRef.current.behaviorTimer, 2),
          expression: "happy",
          activityLabel: "Visiting",
          actionIntent: undefined,
          actionActivityLabel: undefined,
          interactionTargetAlternates: undefined,
          navigationFailure: undefined,
        };
      }

      runtimeRef.current = tickAvatar(
        runtimeRef.current,
        currentContent,
        avatarStatus,
        elapsedSeconds,
        saveRef.current.memory,
        {
          ignoredFurnitureId:
            ignoredFurnitureIdForRuntimeInteraction(
              runtimeRef.current,
              currentContent,
              pendingWorldInteraction,
            ),
          navMemory: saveRef.current.navMemory,
          autoMusicEnabled: autoMusicEnabledRef.current,
          avatarAppearanceId: normalizeAvatarAppearanceId(saveRef.current.avatarAppearanceId),
        },
      );

      if (
        runtimeActionBehavior(runtimeRef.current) === "music" &&
        !hasPlacedRecordPlayer(currentContent)
      ) {
        runtimeRef.current = resetRuntimeToIdle(runtimeRef.current);
        setAvatar(runtimeRef.current);
      }

      if (
        activeRoomVisit &&
        activeRoomVisit.guest.roomInstanceId === roomInstanceIdRef.current &&
        !avatarAwayRef.current
      ) {
        const guestDistanceToDoor = Math.hypot(
          runtimeRef.current.x - ROOM_DOOR_OUTSIDE_POINT.x,
          runtimeRef.current.y - ROOM_DOOR_OUTSIDE_POINT.y,
        );

        if (guestDistanceToDoor <= 4) {
          const entryRuntime = createRoomDoorEntryRuntime();
          avatarAwayRef.current = true;
          setAvatarAway(true);
          runtimeRef.current = {
            ...runtimeRef.current,
            x: ROOM_DOOR_OUTSIDE_POINT.x,
            y: ROOM_DOOR_OUTSIDE_POINT.y,
            targetX: ROOM_DOOR_OUTSIDE_POINT.x,
            targetY: ROOM_DOOR_OUTSIDE_POINT.y,
            behavior: "idle",
            behaviorTimer: 2,
            expression: "happy",
            activityLabel: "Visiting",
            actionIntent: undefined,
            actionActivityLabel: undefined,
            interactionTargetAlternates: undefined,
            navigationFailure: undefined,
          };
          setAvatar(runtimeRef.current);
          visitStatePostedAtRef.current = now;
          publishVisitState(activeRoomVisit, {
            phase: "accepted",
            guestRuntime: entryRuntime,
            guestRuntimeRoomInstanceId: activeRoomVisit.host.roomInstanceId,
            guestSocialNavMemory: socialRoomMemoryRef.current?.navMemory,
            activity: entryRuntime.behavior,
            bubbleText: "roomVisit.bubble.enter.1",
          });
        } else if (now - visitStatePostedAtRef.current >= ROOM_VISIT_STATE_POST_MS) {
          visitStatePostedAtRef.current = now;
          publishVisitState(activeRoomVisit, {
            phase: "accepted",
            guestRuntime: runtimeRef.current,
            guestRuntimeRoomInstanceId: roomInstanceIdRef.current,
            guestSocialNavMemory: socialRoomMemoryRef.current?.navMemory,
            activity: runtimeRef.current.behavior,
            bubbleText: "roomVisit.bubble.enter.1",
          });
        }
      }

      const visitor = roomVisitorRef.current;
      if (
        activeRoomVisit &&
        visitor &&
        activeRoomVisit.host.roomInstanceId === roomInstanceIdRef.current
      ) {
        if (!visitHostStartedAtRef.current) {
          visitHostStartedAtRef.current = now;
        }

        let nextVisitor: AivatarRoomVisitor = advanceRoomVisitor(
          visitor,
          currentContent,
          runtimeRef.current,
          activeRoomVisit.guest.traits,
          elapsedSeconds,
          now,
          activeRoomVisit.guestSocialNavMemory,
          activeVisitRelationshipRef.current?.affinity ?? 0,
        );
        const socialSeconds = (now - visitHostStartedAtRef.current) / 1000;
        const socialDurationSeconds = roomVisitSocialDurationSeconds(
          activeVisitRelationshipRef.current?.affinity ?? 0,
        );
        let nextVisitPhase: AivatarVisitSession["phase"] =
          nextVisitor.phase === "socializing" ? "active" : activeRoomVisit.phase;

        if (nextVisitor.phase === "socializing") {
          startRoomVisitSocialExchange(activeRoomVisit, nextVisitor, now);
        }

        if (
          socialSeconds >= socialDurationSeconds &&
          nextVisitor.phase !== "leaving"
        ) {
          roomVisitHostActivityRef.current = null;
          nextVisitor = {
            ...nextVisitor,
            phase: "leaving",
            runtime: {
              ...nextVisitor.runtime,
              targetX: ROOM_DOOR_OUTSIDE_POINT.x,
              targetY: ROOM_DOOR_OUTSIDE_POINT.y,
              behavior: "wander",
              behaviorTimer: 3,
              activityLabel: "Heading home",
            },
            bubbleText: "roomVisit.bubble.leave.1",
            bubbleStartedAt: now,
          };
          nextVisitPhase = "returning";
        }

        if (nextVisitor.phase === "leaving") {
          nextVisitPhase = "returning";
          roomVisitHostActivityRef.current = null;
        } else {
          syncHostAvatarWithRoomVisitor(nextVisitor, currentContent, currentStatus, now, {
            pendingWorldInteraction,
            blockingInteraction,
            busyRecoveryActive,
            taskCabinetVisualFlowActive,
          });
          nextVisitor = applyRoomVisitSocialExchangePlayback(nextVisitor, now);
        }

        roomVisitorRef.current = nextVisitor;

        const visitorDistanceToDoor = Math.hypot(
          nextVisitor.runtime.x - ROOM_DOOR_OUTSIDE_POINT.x,
          nextVisitor.runtime.y - ROOM_DOOR_OUTSIDE_POINT.y,
        );

        if (nextVisitor.phase === "leaving" && visitorDistanceToDoor <= 3) {
          const endedVisit = normalizeVisitSession({
            ...activeRoomVisit,
            phase: "ended",
            guestRuntime: nextVisitor.runtime,
            guestRuntimeRoomInstanceId: roomInstanceIdRef.current,
            activity: nextVisitor.runtime.behavior,
            bubbleText: nextVisitor.bubbleText,
            updatedAt: roomVisitNowIso(),
            expiresAt: roomVisitExpiresAt(30000),
          });
          if (endedVisit) {
            publishVisitEnd(endedVisit, "ended");
            finishVisitLocally(endedVisit, {
              reward: true,
              message: ui("roomVisit.ended"),
            });
          }
        } else if (now - visitStatePostedAtRef.current >= ROOM_VISIT_STATE_POST_MS) {
          visitStatePostedAtRef.current = now;
          setRoomVisitor(nextVisitor);
          publishVisitState(activeRoomVisit, {
            phase: nextVisitPhase,
            guestRuntime: nextVisitor.runtime,
            guestRuntimeRoomInstanceId: roomInstanceIdRef.current,
            activity: nextVisitor.runtime.behavior,
            bubbleText: nextVisitor.bubbleText,
          });
        }
      }

      const autonomousActionWatchActive =
        !isHighPriorityStatus(currentStatus) &&
        !busyRecoveryActive &&
        !taskCabinetVisualFlowActive &&
        !pendingWorldInteractionRef.current &&
        !isBlockingInteraction(activeInteractionRef.current) &&
        Boolean(runtimeRef.current.actionIntent);

      if (!autonomousActionWatchActive) {
        autonomousActionWatchKey = "";
        autonomousActionWatchSeconds = 0;
      } else {
        const watchKey = `${runtimeRef.current.behavior}:${runtimeRef.current.actionIntent}`;
        if (watchKey !== autonomousActionWatchKey) {
          autonomousActionWatchKey = watchKey;
          autonomousActionWatchSeconds = 0;
        }
        autonomousActionWatchSeconds += elapsedSeconds;

        if (
          !avatarRuntimeHasFiniteNavigation(runtimeRef.current) ||
          autonomousActionWatchSeconds >= AUTONOMOUS_ACTION_STUCK_SECONDS
        ) {
          autonomousActionWatchKey = "";
          autonomousActionWatchSeconds = 0;
          runtimeRef.current = resetRuntimeToIdle(runtimeRef.current);
          setAvatar(runtimeRef.current);
        }
      }

      if (runtimeRef.current.navigationFailure) {
        const failedInteraction = pendingWorldInteractionRef.current;
        if (failedInteraction) {
          pendingWorldInteractionRef.current = null;
          const failedId =
            failedInteraction.target === "furniture"
              ? failedInteraction.furniture.id
              : failedInteraction.placedItem.id;
          const failedName =
            failedInteraction.target === "furniture"
              ? failedInteraction.furniture.name
              : failedInteraction.item.name;
          updateActiveInteraction({
            kind: "blocked",
            furnitureId: failedId,
            furnitureName: failedName,
            message: ui("message.unreachable", { name: failedName }),
            startedAt: performance.now(),
            bubbleText: ui("bubble.busy"),
          });
        }

        runtimeRef.current = {
          ...runtimeRef.current,
          navigationFailure: undefined,
        };
      }

      const navLearningTargetKey = [
        runtimeActionBehavior(runtimeRef.current),
        Math.round(runtimeRef.current.targetX),
        Math.round(runtimeRef.current.targetY),
      ].join(":");
      const navLearningDistance = Math.hypot(
        runtimeRef.current.x - runtimeRef.current.targetX,
        runtimeRef.current.y - runtimeRef.current.targetY,
      );
      const navLearningBehaviorActive =
        runtimeActionBehavior(runtimeRef.current) !== "idle" &&
        runtimeActionBehavior(runtimeRef.current) !== "explore";
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
          navMemory: recordExploreResult(
            current.navMemory,
            result,
            cellKey,
            navLayoutFingerprint,
          ),
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
            navMemory: recordExploredCell(
              current.navMemory,
              cellKey,
              navLayoutFingerprint,
            ),
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
            navMemory: recordExploredCell(
              current.navMemory,
              cellKey,
              navLayoutFingerprint,
            ),
          }));
        }

        if (explorationTargetReached(runtimeRef.current)) {
          const cellKey = explorationCellKey(runtimeRef.current);
          setSave((current) => ({
            ...current,
            navMemory: recordExploreResult(
              current.navMemory,
              "success",
              cellKey,
              navLayoutFingerprint,
            ),
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
            navMemory: recordExploreResult(
              current.navMemory,
              "failure",
              cellKey,
              navLayoutFingerprint,
            ),
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

      const visualFlow = taskCabinetVisualFlowRef.current;
      if (visualFlow) {
        const activeTaskBehavior = runtimeActionBehavior(runtimeRef.current);
        if (
          visualFlow.phase === "fetch" &&
          runtimeRef.current.behavior === "fetch_task_file" &&
          !runtimeRef.current.actionIntent
        ) {
          if (!visualFlow.actionStartedAt) {
            taskCabinetVisualFlowRef.current = {
              ...visualFlow,
              actionStartedAt: now,
            };
          } else if (now - visualFlow.actionStartedAt >= 1000) {
            taskCabinetVisualFlowRef.current = {
              ...visualFlow,
              phase: "carry",
              phaseStartedAt: now,
              actionStartedAt: undefined,
            };
            runtimeRef.current = setBehavior(
              runtimeRef.current,
              "carry_task_file",
              currentContent,
              10,
              `Carrying ${visualFlow.taskName}`,
              { startImmediately: true },
            );
            setAvatar(runtimeRef.current);
          }
        } else if (visualFlow.phase === "carry") {
          const carryDistance = Math.hypot(
            runtimeRef.current.x - runtimeRef.current.targetX,
            runtimeRef.current.y - runtimeRef.current.targetY,
          );
          if (carryDistance <= INTERACTION_ARRIVAL_DISTANCE) {
            taskCabinetVisualFlowRef.current = {
              ...visualFlow,
              phase: "read",
              phaseStartedAt: now,
              actionStartedAt: now,
            };
            runtimeRef.current = setBehavior(
              runtimeRef.current,
              "read_task_file",
              currentContent,
              30,
              `Reading ${visualFlow.taskName}`,
              { startImmediately: true },
            );
            setAvatar(runtimeRef.current);
          } else if (activeTaskBehavior !== "carry_task_file") {
            runtimeRef.current = setBehavior(
              runtimeRef.current,
              "carry_task_file",
              currentContent,
              10,
              `Carrying ${visualFlow.taskName}`,
              { startImmediately: true },
            );
            setAvatar(runtimeRef.current);
          }
        } else if (visualFlow.phase === "read") {
          const readElapsedMs = visualFlow.actionStartedAt
            ? now - visualFlow.actionStartedAt
            : now - visualFlow.phaseStartedAt;
          if (
            readElapsedMs >= TASK_CABINET_READ_HANDOFF_MS &&
            (visualFlow.terminalStatus ||
              isTaskCabinetLiveWorkStatus(currentStatus))
          ) {
            taskCabinetVisualFlowRef.current = null;
          } else if (activeTaskBehavior !== "read_task_file") {
            runtimeRef.current = setBehavior(
              runtimeRef.current,
              "read_task_file",
              currentContent,
              30,
              `Reading ${visualFlow.taskName}`,
              { startImmediately: true },
            );
            setAvatar(runtimeRef.current);
          }
        }
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
              const progress = ensurePaintingDraftForEasel(
                pendingWorldInteraction.placedItem,
              );
              runtimeRef.current = {
                ...runtimeRef.current,
                behavior: "paint",
                behaviorTimer: PAINT_INTERACTION_SECONDS,
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
                progress,
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
            } else if (pendingWorldInteraction.kind === "music") {
              const startedAt = performance.now();
              setBgmTrackId(randomBgmTrackId(bgmTrackIdRef.current));
              setActiveRecordPlayerId(pendingWorldInteraction.placedItem.id);
              runtimeRef.current = {
                ...runtimeRef.current,
                targetX: runtimeRef.current.x,
                targetY: runtimeRef.current.y,
                behavior: "idle",
                behaviorTimer: 2,
                expression: "happy",
                facing: facingTowardPlacedItem(
                  runtimeRef.current,
                  pendingWorldInteraction.placedItem,
                ),
                activityLabel: "Idle",
                actionIntent: undefined,
                actionActivityLabel: undefined,
                interactionTargetAlternates: undefined,
              };
              setAvatar(runtimeRef.current);
              updateActiveInteraction({
                kind: "none",
                furnitureId: pendingWorldInteraction.placedItem.id,
                furnitureName: pendingWorldInteraction.item.name,
                message: ui("message.selected", { name: pendingWorldInteraction.item.name }),
                startedAt,
                endsAt: startedAt + INTERACTION_FEEDBACK_SECONDS * 1000,
                bubbleText: ui("thought.music"),
              });
            } else if (pendingWorldInteraction.kind === "stop-music") {
              const startedAt = performance.now();
              const isActiveRecordPlayer =
                activeRecordPlayerIdRef.current === pendingWorldInteraction.placedItem.id;
              if (isActiveRecordPlayer) {
                activeRecordPlayerIdRef.current = null;
                activeRecordPlayerStartedAtRef.current = null;
                setActiveRecordPlayerId(null);
                stopRecordPlayerBgm();
              }
              runtimeRef.current = {
                ...runtimeRef.current,
                targetX: runtimeRef.current.x,
                targetY: runtimeRef.current.y,
                behavior: "idle",
                behaviorTimer: 2,
                expression: "calm",
                facing: facingTowardPlacedItem(
                  runtimeRef.current,
                  pendingWorldInteraction.placedItem,
                ),
                activityLabel: "Idle",
                actionIntent: undefined,
                actionActivityLabel: undefined,
                interactionTargetAlternates: undefined,
              };
              setAvatar(runtimeRef.current);
              updateActiveInteraction({
                kind: "none",
                furnitureId: pendingWorldInteraction.placedItem.id,
                furnitureName: pendingWorldInteraction.item.name,
                message: isActiveRecordPlayer
                  ? ui("message.musicStopped", {
                      name: pendingWorldInteraction.item.name,
                    })
                  : ui("message.selected", { name: pendingWorldInteraction.item.name }),
                startedAt,
                endsAt: startedAt + INTERACTION_FEEDBACK_SECONDS * 1000,
                bubbleText: ui("thought.stopMusic"),
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
      } else if (
        currentInteraction?.kind === "brew" &&
        currentInteraction.endsAt &&
        now >= currentInteraction.endsAt
      ) {
        coffeeAccumulator = 0;
        if (runtimeActionBehavior(runtimeRef.current) === "brew") {
          runtimeRef.current = {
            ...runtimeRef.current,
            targetX: runtimeRef.current.x,
            targetY: runtimeRef.current.y,
            behavior: "idle",
            behaviorTimer: 2,
            expression: "calm",
            activityLabel: undefined,
            actionIntent: undefined,
            actionActivityLabel: undefined,
            interactionTargetAlternates: undefined,
          };
          setAvatar(runtimeRef.current);
        }
        updateActiveInteraction({
          ...currentInteraction,
          kind: "none",
          startedAt: now,
          endsAt: now + INTERACTION_FEEDBACK_SECONDS * 1000,
          progress: 1,
        });
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

      if (runtimeRef.current.behavior === "music" && !isHighPriorityStatus(currentStatus)) {
        const recordPlayer = currentContent.placedItems?.find(
          (item) =>
            item.itemId === RECORD_PLAYER_ITEM_ID &&
            isNearPlacedItemInteractionTarget(runtimeRef.current, item, currentContent),
        );

        if (recordPlayer) {
          setBgmTrackId(randomBgmTrackId(bgmTrackIdRef.current));
          setActiveRecordPlayerId(recordPlayer.id);
          runtimeRef.current = {
            ...runtimeRef.current,
            targetX: runtimeRef.current.x,
            targetY: runtimeRef.current.y,
            behavior: "idle",
            behaviorTimer: 2,
            expression: "happy",
            activityLabel: "Idle",
            actionIntent: undefined,
            actionActivityLabel: undefined,
            interactionTargetAlternates: undefined,
          };
          setAvatar(runtimeRef.current);
          updateActiveInteraction({
            kind: "none",
            furnitureId: recordPlayer.id,
            furnitureName:
              currentContent.itemDefinitions.find(
                (item) => item.id === RECORD_PLAYER_ITEM_ID,
              )?.name ?? "Record Player",
            message: ui("message.selected", {
              name:
                currentContent.itemDefinitions.find(
                  (item) => item.id === RECORD_PLAYER_ITEM_ID,
                )?.name ?? "Record Player",
            }),
            startedAt: now,
            endsAt: now + INTERACTION_FEEDBACK_SECONDS * 1000,
            bubbleText: ui("thought.music"),
          });
          setSave((current) => ({
            ...current,
            memory: recordLifeMemory(
              current.memory,
              {
                type: "recovery_used",
                summary: "Started 8-bit music",
                behavior: "music",
                itemId: RECORD_PLAYER_ITEM_ID,
              },
              {
                creativity: 1,
                warmth: 1,
                ...(current.petStats.mood < 45 ? { resilience: 1 } : {}),
              },
              { throttleMs: 60000, throttleKey: "music-start" },
            ),
          }));
        }
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
          paintingProgressAccumulator += elapsedSeconds;

          if (paintingProgressAccumulator >= PAINTING_PROGRESS_SAVE_INTERVAL_SECONDS) {
            const progressElapsed = paintingProgressAccumulator;
            paintingProgressAccumulator = 0;
            let nextProgress: number | null = null;
            const completionFeedbackRef: {
              current: AivatarPaintingArtwork | null;
            } = { current: null };

            setSave((current) => {
              const nowIso = new Date().toISOString();
              const gallery = normalizePaintingGallery(current.paintingGallery);
              const draft = gallery.activeDraft
                ? {
                    ...gallery.activeDraft,
                    easelItemId: easel.id,
                  }
                : createPaintingDraft(normalizeMemory(current.memory), {
                    avatarId: current.avatarId,
                    easelItemId: easel.id,
                    nowIso,
                  });
              const advancedDraft = advancePaintingDraft(
                draft,
                progressElapsed,
                nowIso,
              );
              nextProgress = paintingProgressRatio(advancedDraft);

              if (nextProgress < 1) {
                return {
                  ...current,
                  paintingGallery: {
                    ...gallery,
                    activeDraft: advancedDraft,
                  },
                };
              }

              const saleBits = rewardBitsForPaintingQuality(
                advancedDraft.artwork.quality,
              );
              const completedArtwork = {
                ...advancedDraft.artwork,
                completedAt: nowIso,
                saleBits,
              };
              completionFeedbackRef.current = completedArtwork;

              return {
                ...current,
                paintingGallery: {
                  artworks: [
                    completedArtwork,
                    ...gallery.artworks.filter(
                      (artwork) => artwork.id !== completedArtwork.id,
                    ),
                  ].slice(0, PAINTING_GALLERY_LIMIT),
                },
                memory: recordLifeMemory(
                  current.memory,
                  {
                    type: "painting_complete",
                    summary: `Finished painting ${completedArtwork.title}`,
                    behavior: "paint",
                    itemId: EASEL_ITEM_ID,
                  },
                  {
                    creativity: completedArtwork.quality,
                    ...(completedArtwork.quality >= 4 ? { warmth: 1 } : {}),
                  },
                ),
              };
            });

            const completionFeedback = completionFeedbackRef.current;
            if (completionFeedback) {
              runtimeRef.current = {
                ...runtimeRef.current,
                targetX: runtimeRef.current.x,
                targetY: runtimeRef.current.y,
                behavior: "idle",
                behaviorTimer: 2,
                expression: "happy",
                activityLabel: "Idle",
                actionIntent: undefined,
                actionActivityLabel: undefined,
                interactionTargetAlternates: undefined,
              };
              setAvatar(runtimeRef.current);
              updateActiveInteraction({
                kind: "none",
                furnitureId: easel.id,
                furnitureName:
                  currentContent.itemDefinitions.find(
                    (item) => item.id === EASEL_ITEM_ID,
                  )?.name ?? "Oil Easel",
                message: ui("message.paintingComplete", {
                  name: completionFeedback.title,
                }),
                startedAt: now,
                endsAt: now + REWARD_BUBBLE_SECONDS * 1000,
                bubbleText: ui("bubble.painting"),
                progress: 1,
              });
            } else if (
              nextProgress !== null &&
              activeInteractionRef.current?.furnitureId === easel.id
            ) {
              updateActiveInteraction({
                ...activeInteractionRef.current,
                startedAt: now,
                bubbleText: ui("thought.paint"),
                progress: nextProgress,
              });
            }
          }

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
          paintingProgressAccumulator = 0;
        }
      } else {
        paintAccumulator = 0;
        paintingProgressAccumulator = 0;
      }

      if (
        runtimeActionBehavior(runtimeRef.current) === "snack" &&
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
        runtimeActionBehavior(runtimeRef.current) === "brew" &&
        now >= autonomousCoffeeCooldownUntilRef.current &&
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
            autonomousCoffeeCooldownUntilRef.current =
              now + COFFEE_AUTONOMOUS_COOLDOWN_SECONDS * 1000;
            runtimeRef.current = {
              ...runtimeRef.current,
              targetX: runtimeRef.current.x,
              targetY: runtimeRef.current.y,
              behavior: "idle",
              behaviorTimer: 2,
              expression: "calm",
              activityLabel: undefined,
              actionIntent: undefined,
              actionActivityLabel: undefined,
              interactionTargetAlternates: undefined,
            };
            setAvatar(runtimeRef.current);
            updateActiveInteraction({
              kind: "blocked",
              furnitureId: coffeeMachine?.id ?? COFFEE_MACHINE_ITEM_ID,
              furnitureName: coffeeMachineName,
              message: ui("message.notEnoughBits", {
                name: coffeeMachineName,
                bits: COFFEE_BREW_BIT_COST,
              }),
              startedAt: now,
              endsAt: now + INTERACTION_FEEDBACK_SECONDS * 1000,
              bubbleText: ui("bubble.bits"),
            });
          } else {
            playBitsSpendSound(COFFEE_BREW_SPEND_AUDIO_VOLUME_MULTIPLIER);
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
            autonomousCoffeeCooldownUntilRef.current =
              now + COFFEE_AUTONOMOUS_COOLDOWN_SECONDS * 1000;
            runtimeRef.current = {
              ...runtimeRef.current,
              targetX: runtimeRef.current.x,
              targetY: runtimeRef.current.y,
              behavior: "idle",
              behaviorTimer: 2,
              expression: "calm",
              activityLabel: undefined,
              actionIntent: undefined,
              actionActivityLabel: undefined,
              interactionTargetAlternates: undefined,
            };
            setAvatar(runtimeRef.current);
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
          petStats: applyPetTick(current.petStats, elapsedStats, {
            moodDecayMultiplier: activeRecordPlayerIdRef.current
              ? MUSIC_MOOD_DECAY_MULTIPLIER
              : 1,
          }),
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
          localizedInteractionBubble(activeInteractionRef.current, localeRef.current),
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
            currentTableCoffeeQuantity,
            saveRef.current.memory,
            getWindowTimeMs(frame),
            taskCabinetSceneCountsRef.current.activeFileCount,
            taskCabinetSceneCountsRef.current.failedFileCount,
            uiThemeForScene(uiThemeRef.current),
            navDebugOverlayRef.current,
            saveRef.current.paintingGallery,
            activeRecordPlayerIdRef.current,
            normalizeAvatarAppearanceId(saveRef.current.avatarAppearanceId),
            localizedRoomVisitors(
              roomVisitorRef.current ? [roomVisitorRef.current] : [],
              localeRef.current,
            ),
            !avatarAwayRef.current,
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
    const statusCandidatesBySession = new Map<string, CodexStatusMessage>();
    [effectiveStatus, ...sessions].forEach((candidate) => {
      statusCandidatesBySession.set(statusSessionKey(candidate), candidate);
    });

    const previousStatusesBySession = new Map<
      string,
      CodexStatusMessage["status"] | undefined
    >();
    statusCandidatesBySession.forEach((candidate, candidateSessionKey) => {
      previousStatusesBySession.set(
        candidateSessionKey,
        previousSessionStatusRef.current.get(candidateSessionKey),
      );
      previousSessionStatusRef.current.set(candidateSessionKey, candidate.status);
    });

    const learning = effectiveStatus.learning;
    if (learning) {
      const learningKey = [
        effectiveStatus.agent ?? "agent",
        effectiveStatus.sessionId ?? "default",
        learning.id,
      ].join(":");
      if (!appliedLearningIdsRef.current.has(learningKey)) {
        appliedLearningIdsRef.current.add(learningKey);
        setSave((current) => ({
          ...current,
          memory: recordSessionLearningMemory(current.memory, effectiveStatus),
        }));
      }
    }

    const isSessionLearningStatus = effectiveStatus.phase === "session-learning";
    if (
      !isSessionLearningStatus &&
      isRewardAgent(effectiveStatus) &&
      (effectiveStatus.status === "error" ||
        effectiveStatus.status === "waiting_for_user")
    ) {
      setSave((current) => ({
        ...current,
        memory: recordStatusMemory(current.memory, effectiveStatus),
      }));
    }

    statusCandidatesBySession.forEach((candidate, candidateSessionKey) => {
      if (candidate.status !== "complete") return;
      if (candidate.phase === "session-learning") return;
      if (!isRewardAgent(candidate)) return;

      const previousStatus = previousStatusesBySession.get(candidateSessionKey);
      const activeTransition =
        previousStatus && isRewardEligiblePreviousStatus(previousStatus);
      const completedAt = Date.parse(candidate.timestamp);
      const freshComplete =
        !Number.isNaN(completedAt) &&
        Date.now() - completedAt <= COMPLETE_REWARD_FRESH_MS;
      if (!activeTransition && !freshComplete) return;

      const completeKey = [
        candidate.agent,
        candidate.sessionId ?? "default",
        candidate.timestamp,
      ].join(":");
      if (rewardedCompleteKeysRef.current.has(completeKey)) return;
      rewardedCompleteKeysRef.current.add(completeKey);

      const workBoostBits =
        getWorkBoostRemainingSeconds(save.workBoostUntil, Date.now()) > 0
          ? WORK_BOOST_COMPLETE_BONUS
          : 0;
      const rewardBits = Math.min(
        maxRewardBitsForUsage(candidate.usage),
        rewardBitsForUsage(candidate.usage) + workBoostBits,
      );

      setSave((current) => ({
        ...current,
        wallet: { bits: current.wallet.bits + rewardBits },
        memory: recordTaskCompleteMemory(
          current.memory,
          candidate,
          previousStatus,
          rewardBits,
        ),
      }));
      playOneShotAudio(
        agentCompleteAudioRef.current,
        AGENT_COMPLETE_AUDIO_VOLUME_MULTIPLIER,
      );
      const now = performance.now();
      const rewardAgentName = agentDisplayName(candidate);
      updateActiveInteraction({
        kind: "none",
        furnitureId: candidate.agent ?? "agent",
        furnitureName: rewardAgentName,
        message: `${rewardAgentName} complete: +${rewardBits} ${ui("currency.bits")}${
          workBoostBits > 0 ? ui("message.withBoost") : ""
        }.`,
        startedAt: now,
        endsAt: now + REWARD_BUBBLE_SECONDS * 1000,
        bubbleText: `+${rewardBits} ${ui("currency.bits")}`,
        rewardBits,
      });
    });
  }, [
    activeSessionKey,
    connectedSessionKey,
    effectiveStatus.agent,
    effectiveStatus.sessionId,
    effectiveStatus.learning?.id,
    effectiveStatus.timestamp,
    effectiveStatus.status,
    locale,
    save.workBoostUntil,
    sessions,
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

      setSave((current) => {
        const inventory = current.inventory
          .map((entry) =>
            entry.itemId === item.id
              ? clampQuantity({ ...entry, quantity: entry.quantity - 1 })
              : entry,
          )
          .filter((entry) => entry.quantity > 0);

        return {
          ...current,
          inventory,
          purchasedItemIds: Array.from(
            new Set([...current.purchasedItemIds, item.id]),
          ),
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
        };
      });
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
      setTaskCabinetMessage(ui("message.taskCabinetAddPath"));
      return;
    }
    if (!path.toLowerCase().endsWith(".md")) {
      setTaskCabinetMessage(ui("message.taskCabinetMdOnly"));
      return;
    }
    if (
      taskCabinetEntries.some(
        (entry) => entry.path.toLowerCase() === path.toLowerCase(),
      )
    ) {
      setTaskCabinetMessage(ui("message.taskCabinetDuplicate"));
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
      setTaskCabinetMessage(ui("message.taskCabinetSaved"));
    } else {
      setTaskCabinetMessage(
        ui("message.taskCabinetLimit", { value: TASK_CABINET_ENTRY_LIMIT }),
      );
    }
  };

  const browseTaskCabinetPath = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("pick_markdown_task_file");
      if (path) {
        setTaskCabinetPathInput(path);
        setTaskCabinetMessage(ui("message.taskCabinetSelected"));
      }
    } catch {
      setTaskCabinetMessage(ui("message.filePickerDesktopOnly"));
    }
  };

  const removeTaskCabinetEntry = (taskId: string) => {
    setTaskCabinetEntries((current) =>
      current.filter((entry) => entry.id !== taskId),
    );
    setTaskCabinetMessage(ui("message.taskCabinetRemoved"));
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
        nextSchedule.nextRunAt = calculateTaskScheduleNextRunAt(nextSchedule);
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

  const setTaskCabinetScheduleRunAtPart = (
    taskId: string,
    part: TaskScheduleRunAtPart,
    value: string,
    options: { normalize?: boolean } = {},
  ) => {
    updateTaskCabinetSchedule(taskId, (schedule) => {
      const parts = taskScheduleRunAtParts(schedule?.runAt);
      if (part === "date") {
        parts.date = formatTaskScheduleDateInput(value);
      } else if (options.normalize) {
        parts[part] = normalizeTaskScheduleTimeInput(
          value,
          part === "hour" ? 23 : 59,
        );
      } else {
        parts[part] = formatTaskScheduleTimeInput(value);
      }
      const nextSchedule: TaskCabinetSchedule = {
        enabled: schedule?.enabled ?? false,
        mode: schedule?.mode ?? "once",
        runAt: taskScheduleRunAtFromParts(parts),
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

  const startTaskCabinetVisualFlow = (sessionId: string, taskName: string) => {
    taskCabinetVisualFlowRef.current = {
      sessionId,
      taskName,
      phase: "fetch",
      phaseStartedAt: performance.now(),
    };
    runtimeRef.current = setBehavior(
      runtimeRef.current,
      "fetch_task_file",
      contentRef.current,
      4,
      "Fetching task file",
    );
    setAvatar(runtimeRef.current);
  };

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

    const markScheduledAttemptFailed = (message: string) => {
      if (!options.scheduled) return;
      const failedAtMs = Date.now();
      const failedAt = new Date(failedAtMs).toISOString();
      setTaskCabinetEntries((current) =>
        current.map((entry) =>
          entry.id === task.id
            ? {
                ...entry,
                status: "failed",
                startedAt: entry.startedAt ?? failedAt,
                updatedAt: failedAt,
                finishedAt: failedAt,
                error: message,
                schedule: settleTaskScheduleAfterAttempt(
                  entry.schedule,
                  failedAtMs,
                ),
              }
            : entry,
        ),
      );
    };

    if (!isTaskCabinetPlaced(contentRef.current)) {
      if (!options.scheduled) {
        setTaskCabinetMessage(ui("message.taskCabinetMissingCabinet"));
      }
      return;
    }

    const cwd = launcherDirectory.trim();
    if (!cwd) {
      const message = options.scheduled
        ? ui("message.taskCabinetScheduleMissingLauncher")
        : ui("message.taskCabinetMissingLauncher");
      setTaskCabinetMessage(message);
      markScheduledAttemptFailed(message);
      return;
    }

    taskCabinetLaunchingRef.current = true;
    const now = new Date().toISOString();
    const sessionId = createTaskCabinetSessionId(launcherAgent, task.id);
    startTaskCabinetVisualFlow(sessionId, taskCabinetFileName(task.path));
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
    setTaskCabinetMessage(
      ui("message.taskCabinetStarting", {
        name: taskCabinetFileName(task.path),
      }),
    );

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const taskArgs = launcherArgs.trim();
      let launchArgs = taskArgs || null;
      if (task.runProfile === "fast" && launcherAgent === "claude-code") {
        launchArgs = taskArgs ? `${taskArgs} --bare` : "--bare";
      }
      if (task.runProfile === "fast" && launcherAgent === "codex") {
        setTaskCabinetMessage(ui("message.taskCabinetCodexFastPending"));
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
      setTaskCabinetMessage(result.message ?? ui("message.taskCabinetStarted"));
    } catch (error) {
      if (taskCabinetVisualFlowRef.current?.sessionId === sessionId) {
        taskCabinetVisualFlowRef.current = null;
      }
      const detail = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      const failedAtMs = Date.parse(failedAt);
      setTaskCabinetEntries((current) =>
        current.map((entry) =>
          entry.id === task.id
            ? {
                ...entry,
                status: "failed",
                updatedAt: failedAt,
                finishedAt: failedAt,
                error: detail,
                schedule: options.scheduled
                  ? settleTaskScheduleAfterAttempt(entry.schedule, failedAtMs)
                  : entry.schedule,
              }
            : entry,
        ),
      );
      setTaskCabinetMessage(detail || ui("message.taskCabinetStartFailed"));
    } finally {
      taskCabinetLaunchingRef.current = false;
    }
  };

  const runNextTaskCabinetEntry = () => {
    if (taskCabinetEntriesRef.current.some((entry) => entry.status === "running")) {
      setTaskCabinetMessage(ui("message.taskCabinetAlreadyRunning"));
      return;
    }
    const nextTask = nextReadyTaskCabinetEntry(taskCabinetEntriesRef.current);
    if (!nextTask) {
      setTaskCabinetMessage(ui("message.taskCabinetNoReady"));
      return;
    }
    void startTaskCabinetEntry(nextTask.id);
  };

  useEffect(() => {
    const taskSessions = new Map(
      sessions
        .filter((session) => session.agent && session.sessionId)
        .map((session) => [
          `${session.agent}:${session.sessionId}`,
          session,
        ]),
    );

    sessions.forEach((session) => {
      if (!session.agent || !session.sessionId) return;
      if (session.status === "complete" || session.status === "error") {
        taskCabinetTerminalStatusRef.current.set(
          `${session.agent}:${session.sessionId}`,
          session.status,
        );
      }
    });

    if (taskSessions.size === 0) return;

    setTaskCabinetEntries((current) => {
      let changed = false;
      const finishedAt = new Date().toISOString();
      const next = current.map((entry) => {
        if (
          !["running", "failed"].includes(entry.status) ||
          !entry.agent ||
          !entry.sessionId
        ) {
          return entry;
        }

        const sessionKey = `${entry.agent}:${entry.sessionId}`;
        const session = taskSessions.get(sessionKey);
        const sessionStatus =
          taskCabinetTerminalStatusRef.current.get(sessionKey) ??
          session?.status;
        if (sessionStatus === "complete") {
          if (taskCabinetVisualFlowRef.current?.sessionId === entry.sessionId) {
            taskCabinetVisualFlowRef.current = {
              ...taskCabinetVisualFlowRef.current,
              terminalStatus: "complete",
              terminalAt: performance.now(),
            };
          }
          changed = true;
          const schedule = settleTaskScheduleAfterAttempt(
            entry.schedule,
            Date.parse(finishedAt),
          );
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
          if (taskCabinetVisualFlowRef.current?.sessionId === entry.sessionId) {
            taskCabinetVisualFlowRef.current = null;
          }
          changed = true;
          const schedule = settleTaskScheduleAfterAttempt(
            entry.schedule,
            Date.parse(finishedAt),
          );
          return {
            ...entry,
            status: "failed" as const,
            updatedAt: finishedAt,
            finishedAt,
            error: "Agent reported an error.",
            schedule,
          };
        }
        if (sessionStatus === "idle" && isTaskCabinetExitIdle(session)) {
          if (taskCabinetVisualFlowRef.current?.sessionId === entry.sessionId) {
            taskCabinetVisualFlowRef.current = null;
          }
          changed = true;
          const schedule = settleTaskScheduleAfterAttempt(
            entry.schedule,
            Date.parse(finishedAt),
          );
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
      if (!isTaskCabinetPlaced(contentRef.current)) return;

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

  const addSocialBubbleCandidate = (
    candidate: AivatarSocialBubbleCandidate & {
      agent?: string;
      sessionId?: string;
    },
  ) => {
    setSave((current) => {
      const currentMemory = normalizeMemory(current.memory);
      const currentSet = normalizeSocialBubbleSet(
        currentMemory.preferences.socialBubbles,
      );
      const saved = [...currentSet.active, ...currentSet.responses];
      const slotCount =
        SOCIAL_BUBBLE_SLOT_BASE + Math.max(0, currentMemory.growth.level - 1) * 2;
      if (saved.length >= slotCount) return current;
      const bubble = normalizeSocialBubble(
        {
          ...candidate,
          source: "session",
        },
        {
          source: "session",
          learnedFromAgent: candidate.agent,
          learnedFromSessionId: candidate.sessionId,
          learnedAt: new Date().toISOString(),
        },
      );
      if (!bubble) return current;
      const signature = socialBubbleSignature(bubble);
      if (saved.some((item) => socialBubbleSignature(item) === signature)) {
        return current;
      }

      const nextSet: AivatarSocialBubbleSet =
        bubble.kind === "response"
          ? {
              ...currentSet,
              responses: [...currentSet.responses, bubble].slice(0, slotCount),
            }
          : {
              ...currentSet,
              active: [...currentSet.active, bubble].slice(0, slotCount),
            };

      return {
        ...current,
        memory: {
          ...currentMemory,
          preferences: {
            ...currentMemory.preferences,
            socialBubbles: nextSet,
          },
        },
      };
    });
  };

  const removeSocialBubble = (bubbleId: string) => {
    setSave((current) => {
      const currentMemory = normalizeMemory(current.memory);
      const currentSet = normalizeSocialBubbleSet(
        currentMemory.preferences.socialBubbles,
      );
      return {
        ...current,
        memory: {
          ...currentMemory,
          preferences: {
            ...currentMemory.preferences,
            socialBubbles: {
              ...currentSet,
              active: currentSet.active.filter((bubble) => bubble.id !== bubbleId),
              responses: currentSet.responses.filter((bubble) => bubble.id !== bubbleId),
            },
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
          addInventoryItem(
            addInventoryItem(current.inventory, COFFEE_ITEM_ID, 6, 24),
            COOKIE_ITEM_ID,
            6,
            24,
          ),
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
    const activeSlotId = activeSaveSlotIdRef.current;
    if (!activeSlotId) {
      setSaveMenuOpenedFromRoom(false);
      setSaveMenuOpen(true);
      setCreatingSaveSlotIndex(0);
      return;
    }

    const freshSave = saveFromContent(contentBase, {
      avatarAppearanceId: normalizeAvatarAppearanceId(saveRef.current.avatarAppearanceId),
    });
    hadSavedStateRef.current = true;
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
    persistSave(freshSave, saveSlotStorageKey(activeSlotId));
    updateSaveSlotSummary(activeSlotId, freshSave);
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
  const selectedPlacedItemCanShowPainting = Boolean(
    selectedPlacedItem &&
      selectedPlacedItemDefinition &&
      PAINTING_REPLACEABLE_ITEM_IDS.has(selectedPlacedItemDefinition.id) &&
      getItemPlacementKind(selectedPlacedItemDefinition) === "wall",
  );
  const selectedWindowDefinition = selectedWindow
    ? findItemDefinition(content, selectedWindow.id)
    : null;
  const selectedFurnitureSellDefinition =
    selectedFurniture?.id === TASK_CABINET_FURNITURE_ID
      ? findItemDefinition(content, TASK_CABINET_FURNITURE_ID)
      : null;

  const applyPaintingToSelectedHanging = (artwork: AivatarPaintingArtwork) => {
    if (!selectedPlacedItem || !selectedPlacedItemCanShowPainting) return;

    const updatedPlacedItem = {
      ...selectedPlacedItem,
      artworkId: artwork.id,
    };

    setSave((current) => ({
      ...current,
      placedItems: current.placedItems.map((item) =>
        item.id === selectedPlacedItem.id ? updatedPlacedItem : item,
      ),
    }));
    updateSelectedPlacedItem(updatedPlacedItem);
    updateActiveInteraction({
      kind: "none",
      furnitureId: selectedPlacedItem.id,
      furnitureName: selectedPlacedItemDefinition?.name ?? ui("roomEdit.title"),
      message: ui("message.paintingApplied", { name: artwork.title }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.painting"),
    });
  };

  const clearPaintingFromSelectedHanging = () => {
    if (
      !selectedPlacedItem ||
      !selectedPlacedItemCanShowPainting ||
      !selectedPlacedItem.artworkId
    ) {
      return;
    }

    const updatedPlacedItem = {
      ...selectedPlacedItem,
      artworkId: undefined,
    };

    setSave((current) => ({
      ...current,
      placedItems: current.placedItems.map((item) =>
        item.id === selectedPlacedItem.id ? updatedPlacedItem : item,
      ),
    }));
    updateSelectedPlacedItem(updatedPlacedItem);
    updateActiveInteraction({
      kind: "none",
      furnitureId: selectedPlacedItem.id,
      furnitureName: selectedPlacedItemDefinition?.name ?? ui("roomEdit.title"),
      message: ui("message.paintingCleared"),
      startedAt: performance.now(),
      bubbleText: ui("bubble.painting"),
    });
  };

  const sellPaintingArtwork = (artwork: AivatarPaintingArtwork) => {
    const savedArtwork = normalizePaintingGallery(
      saveRef.current.paintingGallery,
    ).artworks.find((entry) => entry.id === artwork.id);
    const saleBits = Math.max(0, Math.round(savedArtwork?.saleBits ?? 0));
    if (!savedArtwork || saleBits <= 0) return;

    setSave((current) => {
      const gallery = normalizePaintingGallery(current.paintingGallery);
      const currentArtwork = gallery.artworks.find(
        (entry) => entry.id === savedArtwork.id,
      );
      const currentSaleBits = Math.max(0, Math.round(currentArtwork?.saleBits ?? 0));
      if (!currentArtwork || currentSaleBits <= 0) return current;

      return {
        ...current,
        wallet: { bits: current.wallet.bits + currentSaleBits },
        placedItems: current.placedItems.map((item) =>
          item.artworkId === currentArtwork.id
            ? { ...item, artworkId: undefined }
            : item,
        ),
        paintingGallery: {
          ...gallery,
          artworks: gallery.artworks.filter((entry) => entry.id !== currentArtwork.id),
        },
        memory: recordLifeMemory(
          current.memory,
          {
            type: "painting_sold",
            summary: `Sold painting ${currentArtwork.title}`,
            behavior: "paint",
            itemId: EASEL_ITEM_ID,
            bits: currentSaleBits,
          },
          { efficiency: 1 },
        ),
      };
    });

    if (selectedPlacedItem?.artworkId === savedArtwork.id) {
      updateSelectedPlacedItem({
        ...selectedPlacedItem,
        artworkId: undefined,
      });
    }

    const now = performance.now();
    updateActiveInteraction({
      kind: "none",
      furnitureId: "painting-gallery",
      furnitureName: ui("paintingGallery.title"),
      message: ui("message.paintingSold", {
        name: savedArtwork.title,
        bits: saleBits,
      }),
      startedAt: now,
      endsAt: now + REWARD_BUBBLE_SECONDS * 1000,
      bubbleText: `+${saleBits} ${ui("currency.bits")}`,
      rewardBits: saleBits,
    });
  };

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

  const storeSelectedWindow = () => {
    if (!selectedWindow || !selectedWindowDefinition) return;
    const storedWindowId = selectedWindow.id;

    setSave((current) => {
      const inventory = addInventoryItem(current.inventory, storedWindowId, 1);
      const purchasedItemIds = Array.from(
        new Set([...current.purchasedItemIds, storedWindowId]),
      );

      return {
        ...current,
        inventory,
        purchasedItemIds,
        activeWindowId:
          current.activeWindowId === storedWindowId
            ? fallbackActiveWindowIdAfterRemoving(
                contentRef.current,
                storedWindowId,
                inventory,
                purchasedItemIds,
              )
            : current.activeWindowId,
        windowPlacements: current.windowPlacements?.filter(
          (placement) => placement.windowId !== storedWindowId,
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
      message: ui("message.windowStored", { name: selectedWindow.name }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.stored"),
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
            ? {
                ...item,
                x: next.x + FILE_CABINET_PLACED_ITEM_OFFSET_X,
                y: next.y + FILE_CABINET_PLACED_ITEM_OFFSET_Y,
              }
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
      startImmediately: true,
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

    if (
      furniture.id === TABLE_FURNITURE_ID &&
      (!preferredItemId || preferredItemId === COFFEE_ITEM_ID) &&
      coffeeDefinition &&
      tableCoffeeCount > 0
    ) {
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
        startImmediately: true,
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
        if (left.item.kind === "food" && right.item.kind === "food") {
          const leftScore = foodPreferenceScoreForConsumable(
            left.item,
            saveRef.current.memory,
          );
          const rightScore = foodPreferenceScoreForConsumable(
            right.item,
            saveRef.current.memory,
          );
          if (leftScore !== rightScore) return rightScore - leftScore;
          if (left.item.id === BENTO_ITEM_ID && right.item.id === COOKIE_ITEM_ID) {
            return -1;
          }
          if (left.item.id === COOKIE_ITEM_ID && right.item.id === BENTO_ITEM_ID) {
            return 1;
          }
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
      behavior: behaviorForConsumable(consumable.item),
      content: contentRef.current,
      startImmediately: true,
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
        consumable.item.id === COOKIE_ITEM_ID
          ? ui("thought.cookie")
          : consumable.item.kind === "food"
            ? ui("thought.food")
            : ui("thought.drink"),
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

    runtimeRef.current = setBehavior(runtimeRef.current, behavior, contentRef.current, 6, undefined, {
      startImmediately: true,
    });
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
    playBitsSpendSound(COFFEE_BREW_SPEND_AUDIO_VOLUME_MULTIPLIER);

    runtimeRef.current = setBehavior(
      runtimeRef.current,
      "brew",
      contentRef.current,
      COFFEE_BREW_SECONDS,
      "Brewing coffee",
      { startImmediately: true },
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

    if (isPointInRoomDoor(scenePoint)) {
      openRoomVisitMenu();
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
      scrollRoomEditPanelIntoView();

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
        scrollRoomEditPanelIntoView();
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
    scrollRoomEditPanelIntoView();

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
      scrollRoomEditPanelIntoView();

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
    scrollRoomEditPanelIntoView();
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

  const clearShopLongPressTimer = () => {
    if (shopLongPressTimerRef.current === null) return;
    window.clearTimeout(shopLongPressTimerRef.current);
    shopLongPressTimerRef.current = null;
  };

  const clearShopLongPressTrigger = () => {
    shopLongPressTriggeredRef.current = false;
    shopLongPressTriggeredItemIdRef.current = null;
  };

  const reserveShopPurchaseSlot = (
    itemId: string,
    cooldownMs = SHOP_PURCHASE_COOLDOWN_MS,
  ) => {
    const result = reserveShopPurchaseSlotBase(
      shopPurchaseCooldownUntilRef.current,
      itemId,
      performance.now(),
      cooldownMs,
    );
    shopPurchaseCooldownUntilRef.current = result.cooldowns;
    return result.reserved;
  };

  const buyItem = (
    item: ItemDefinition,
    requestedQuantity = 1,
    options: { bypassCooldown?: boolean } = {},
  ) => {
    const currentSave = saveRef.current;
    const optimisticQuantity = isSurfaceItem(item)
      ? Math.min(1, affordableShopPurchaseQuantity(currentSave, item, 1))
      : affordableShopPurchaseQuantity(currentSave, item, requestedQuantity);
    if (optimisticQuantity <= 0) return false;
    if (!options.bypassCooldown && !reserveShopPurchaseSlot(item.id)) return false;

    setSave((current) => {
      const purchaseQuantity = isSurfaceItem(item)
        ? Math.min(1, affordableShopPurchaseQuantity(current, item, 1))
        : affordableShopPurchaseQuantity(current, item, requestedQuantity);
      if (purchaseQuantity <= 0) return current;
      const purchaseCost = Math.max(0, item.price * purchaseQuantity);
      const memorySummary =
        purchaseQuantity > 1
          ? `Bought ${purchaseQuantity} ${item.name}`
          : `Bought ${item.name}`;
      if (isSurfaceItem(item)) {
        return {
          ...current,
          wallet: { bits: current.wallet.bits - purchaseCost },
          purchasedItemIds: Array.from(new Set([...current.purchasedItemIds, item.id])),
          memory: recordLifeMemory(
            current.memory,
            {
              type: "item_bought",
              summary: memorySummary,
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
              ? { ...entry, quantity: entry.quantity + purchaseQuantity }
              : entry,
          )
        : [...current.inventory, { itemId: item.id, quantity: purchaseQuantity }];

      return {
        ...current,
        wallet: { bits: current.wallet.bits - purchaseCost },
        inventory,
        purchasedItemIds: Array.from(new Set([...current.purchasedItemIds, item.id])),
        memory: recordLifeMemory(
          current.memory,
          {
            type: "item_bought",
            summary: memorySummary,
            itemId: item.id,
          },
          traitChangesForPurchase(item),
        ),
      };
    });
    playBitsSpendSound();
    return true;
  };

  const startShopBulkPurchasePress = (
    event: React.PointerEvent<HTMLButtonElement>,
    item: ItemDefinition,
  ) => {
    unlockAppAudio();
    if (event.button !== 0 || !isBulkPurchasableShopItem(item)) return;
    clearShopLongPressTimer();
    clearShopLongPressTrigger();
    shopLongPressTimerRef.current = window.setTimeout(() => {
      shopLongPressTimerRef.current = null;
      const bought = buyItem(item, SHOP_BULK_PURCHASE_QUANTITY, { bypassCooldown: true });
      if (!bought) return;
      shopLongPressTriggeredRef.current = true;
      shopLongPressTriggeredItemIdRef.current = item.id;
      reserveShopPurchaseSlot(item.id, SHOP_PURCHASE_COOLDOWN_MS * 2);
    }, SHOP_LONG_PRESS_MS);
  };

  const cancelShopBulkPurchasePress = () => {
    clearShopLongPressTimer();
    const triggeredItemId = shopLongPressTriggeredItemIdRef.current;
    if (!shopLongPressTriggeredRef.current || triggeredItemId === null) return;
    window.setTimeout(() => {
      if (shopLongPressTriggeredItemIdRef.current === triggeredItemId) {
        clearShopLongPressTrigger();
      }
    }, SHOP_LONG_PRESS_CLICK_SUPPRESSION_MS);
  };

  const clickShopItem = (
    event: React.MouseEvent<HTMLButtonElement>,
    item: ItemDefinition,
  ) => {
    if (
      shopLongPressTriggeredRef.current &&
      shopLongPressTriggeredItemIdRef.current === item.id
    ) {
      clearShopLongPressTrigger();
      event.preventDefault();
      return;
    }
    if (shopLongPressTriggeredRef.current) clearShopLongPressTrigger();
    buyItem(item);
  };

  const buyOrApplyWindow = (item: ItemDefinition) => {
    if (saveRef.current.purchasedItemIds.includes(item.id)) return;

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
    if (saveRef.current.wallet.bits < item.price) return;

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
    playBitsSpendSound();

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

  const buyOrApplyFurnitureSkin = (item: ItemDefinition) => {
    const targetFurnitureId = item.targetFurnitureId;
    const skinTarget = skinTargetFromContent(contentRef.current, targetFurnitureId);

    if (!targetFurnitureId || !skinTarget) {
      updateActiveInteraction({
        kind: "blocked",
        furnitureId: "furniture-skin",
        furnitureName: item.name,
        message: ui("message.windowMissing", { name: item.name }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.missing"),
      });
      return;
    }

    setSave((current) => {
      const purchased = current.purchasedItemIds.includes(item.id);
      const alreadyApplied = current.activeFurnitureSkinIds?.[targetFurnitureId] === item.id;
      if (alreadyApplied) return current;
      if (!purchased && current.wallet.bits < item.price) return current;

      return {
        ...current,
        wallet: purchased ? current.wallet : { bits: current.wallet.bits - item.price },
        purchasedItemIds: purchased
          ? current.purchasedItemIds
          : Array.from(new Set([...current.purchasedItemIds, item.id])),
        activeFurnitureSkinIds: {
          ...(current.activeFurnitureSkinIds ?? {}),
          [targetFurnitureId]: item.id,
        },
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

    updateActiveInteraction({
      kind: "none",
      furnitureId: targetFurnitureId,
      furnitureName: skinTarget.name,
      message: ui("message.furnitureSkinApplied", {
        name: item.name,
        furniture: skinTarget.name,
      }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.skin"),
    });
  };

  const clearAppliedFurnitureSkin = (item: ItemDefinition) => {
    const targetFurnitureId = item.targetFurnitureId;
    const skinTarget = skinTargetFromContent(contentRef.current, targetFurnitureId);

    if (!targetFurnitureId || !skinTarget) {
      updateActiveInteraction({
        kind: "blocked",
        furnitureId: "furniture-skin",
        furnitureName: item.name,
        message: ui("message.windowMissing", { name: item.name }),
        startedAt: performance.now(),
        bubbleText: ui("bubble.missing"),
      });
      return;
    }

    setSave((current) => {
      if (current.activeFurnitureSkinIds?.[targetFurnitureId] !== item.id) return current;
      const nextActiveFurnitureSkinIds = { ...(current.activeFurnitureSkinIds ?? {}) };
      delete nextActiveFurnitureSkinIds[targetFurnitureId];
      return {
        ...current,
        activeFurnitureSkinIds: nextActiveFurnitureSkinIds,
      };
    });

    updateActiveInteraction({
      kind: "none",
      furnitureId: targetFurnitureId,
      furnitureName: skinTarget.name,
      message: ui("message.furnitureSkinCleared", {
        furniture: skinTarget.name,
      }),
      startedAt: performance.now(),
      bubbleText: ui("bubble.skin"),
    });
  };

  const buyOrApplySurface = (item: ItemDefinition) => {
    const isWallSurface = isWallSurfaceItem(item);
    const surface = isWallSurface
      ? contentRef.current.room.wallSurfaces?.find((candidate) => candidate.id === item.id)
      : contentRef.current.room.floorSurfaces?.find((candidate) => candidate.id === item.id);
    if (!surface) return;

    const currentSave = saveRef.current;
    const currentlyPurchased = currentSave.purchasedItemIds.includes(item.id);
    const currentlyApplied = isWallSurface
      ? (currentSave.wallSurfaceId ?? contentRef.current.room.wallSurfaceId) === surface.id
      : (currentSave.floorSurfaceId ?? contentRef.current.room.floorSurfaceId) === surface.id;
    const currentSpendCost =
      (currentlyPurchased ? 0 : item.price) +
      (currentlyApplied ? 0 : SURFACE_APPLY_COST);
    if (currentSpendCost <= 0 || currentSave.wallet.bits < currentSpendCost) return;

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
    playBitsSpendSound();

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
  const paintingGallery = normalizePaintingGallery(save.paintingGallery);
  const growth = memory.growth;
  const canDispatchTasks = isTaskCabinetPlaced(content);
  const taskCabinetReadyCount = taskCabinetCounts.readyCount;
  const taskCabinetRunningCount = taskCabinetCounts.runningCount;
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
  const socialBubbleSet = normalizeSocialBubbleSet(memory.preferences.socialBubbles);
  const savedSocialBubbles = [
    ...socialBubbleSet.active,
    ...socialBubbleSet.responses,
  ];
  const savedSocialBubbleSignatures = new Set(
    savedSocialBubbles.map(socialBubbleSignature),
  );
  const preferredSocialBubbleLocale = socialBubbleLanguageForPreference(
    idleBubbleLanguage,
    locale,
  );
  const onlineVisitRooms = (roomSnapshot?.rooms ?? []).filter((room) => {
    if (room.roomInstanceId === roomInstanceIdRef.current) return false;
    if (room.slotId === activeSaveSlotId) return false;
    if (room.status !== "home" && room.status !== "busy") return false;
    const expiresAt = Date.parse(room.expiresAt);
    return Number.isNaN(expiresAt) || expiresAt > nowMs;
  });
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
  type IdleBubbleCandidateSource = "memory" | "session" | "llm";
  type IdleBubbleCandidateOption = {
    phrase: string;
    source: IdleBubbleCandidateSource;
    agent?: string;
  };
  const idleBubbleCandidateOptions = (
    options: IdleBubbleCandidateOption[],
  ): IdleBubbleCandidateOption[] => {
    const priority: Record<IdleBubbleCandidateSource, number> = {
      memory: 0,
      session: 1,
      llm: 2,
    };
    const byPhrase = new Map<string, IdleBubbleCandidateOption>();
    options
      .map((option) => ({
        ...option,
        phrase: normalizeIdleBubblePhrase(option.phrase),
      }))
      .filter((option) => {
        if (!option.phrase) return false;
        if (!shouldShowIdleBubbleCandidate(
          option.phrase,
          idleBubbleLanguage,
          locale,
        )) {
          return false;
        }
        return !idleBubblePhrases.includes(option.phrase);
      })
      .forEach((option) => {
        const existing = byPhrase.get(option.phrase);
        if (!existing || priority[option.source] > priority[existing.source]) {
          byPhrase.set(option.phrase, option);
        }
      });

    return [...byPhrase.values()];
  };
  const memoryCandidateOptions = idleBubbleCandidateOptions(
    memoryCandidates.map((phrase) => ({ phrase, source: "memory" })),
  );
  const idleBubbleCandidateBadge = (candidate: IdleBubbleCandidateOption) => {
    if (candidate.source === "llm") return "LLM";
    return agentSourceBadge(candidate.agent);
  };
  const idleBubbleCandidateBadgeClass = (candidate: IdleBubbleCandidateOption) => {
    if (candidate.source === "llm") return "llm";
    return agentSourceClassName(candidate.agent);
  };
  const sessionCandidateOptions = idleBubbleCandidateOptions([
    ...(effectiveStatus.learning?.idleBubbleCandidates ?? []).map((phrase) => ({
      phrase,
      source:
        effectiveStatus.learning?.source === "llm"
          ? ("llm" as const)
          : ("session" as const),
      agent: effectiveStatus.agent,
    })),
    ...(effectiveStatus.idleBubbleCandidates ?? []).map((phrase) => ({
      phrase,
      source: "session" as const,
      agent: effectiveStatus.agent,
    })),
    ...sessions.flatMap((session) =>
      (session.learning?.idleBubbleCandidates ?? []).map((phrase) => ({
        phrase,
        source:
          session.learning?.source === "llm"
            ? ("llm" as const)
            : ("session" as const),
        agent: session.agent,
      })),
    ),
    ...sessions.flatMap((session) =>
      (session.idleBubbleCandidates ?? []).map((phrase) => ({
        phrase,
        source: "session" as const,
        agent: session.agent,
      })),
    ),
  ]);
  const primaryMemoryCandidateOptions = memoryCandidateOptions.slice(
    0,
    IDLE_BUBBLE_MEMORY_CANDIDATE_TARGET,
  );
  const primarySessionCandidateOptions = sessionCandidateOptions
    .filter(
      (candidate) =>
        !primaryMemoryCandidateOptions.some(
          (memoryCandidate) => memoryCandidate.phrase === candidate.phrase,
        ),
    )
    .slice(0, IDLE_BUBBLE_SESSION_CANDIDATE_TARGET);
  const idleBubbleCandidates = idleBubbleCandidateOptions([
    ...primaryMemoryCandidateOptions,
    ...primarySessionCandidateOptions,
    ...memoryCandidateOptions,
    ...sessionCandidateOptions,
  ]).slice(0, IDLE_BUBBLE_CANDIDATE_LIMIT);
  type SocialBubbleCandidateSource = "session" | "llm";
  type SocialBubbleCandidateOption = AivatarSocialBubbleCandidate & {
    source: SocialBubbleCandidateSource;
    agent?: string;
    sessionId?: string;
  };
  const socialBubbleSlotCount = SOCIAL_BUBBLE_SLOT_BASE + Math.max(0, growth.level - 1) * 2;
  const socialBubbleSlotsAvailable = savedSocialBubbles.length < socialBubbleSlotCount;
  const socialBubbleCandidateOptions = (
    options: SocialBubbleCandidateOption[],
  ): SocialBubbleCandidateOption[] => {
    const priority: Record<SocialBubbleCandidateSource, number> = {
      session: 1,
      llm: 2,
    };
    const bySignature = new Map<string, SocialBubbleCandidateOption>();
    const normalizedOptions: SocialBubbleCandidateOption[] = [];
    options.forEach((option) => {
      const normalized = normalizeSocialBubbleCandidate(option);
      if (!normalized) return;
      normalizedOptions.push({
        ...normalized,
        source: option.source,
        agent: option.agent,
        sessionId: option.sessionId,
      });
    });
    normalizedOptions
      .filter((option) =>
        preferredSocialBubbleLocale === "mixed" ||
        option.locale === "mixed" ||
        option.locale === preferredSocialBubbleLocale
      )
      .filter((option) => !savedSocialBubbleSignatures.has(socialBubbleSignature(option)))
      .forEach((option) => {
        const signature = socialBubbleSignature(option);
        const existing = bySignature.get(signature);
        if (!existing || priority[option.source] > priority[existing.source]) {
          bySignature.set(signature, option);
        }
      });
    return [...bySignature.values()].slice(0, SOCIAL_BUBBLE_CANDIDATE_LIMIT);
  };
  const socialBubbleCandidateBadge = (candidate: SocialBubbleCandidateOption) => {
    if (candidate.source === "llm") return "LLM";
    return agentSourceBadge(candidate.agent);
  };
  const socialBubbleCandidateBadgeClass = (candidate: SocialBubbleCandidateOption) => {
    if (candidate.source === "llm") return "llm";
    return agentSourceClassName(candidate.agent);
  };
  const socialBubbleCandidates = socialBubbleCandidateOptions([
    ...(effectiveStatus.learning?.socialBubbleCandidates ?? []).map((candidate) => ({
      ...candidate,
      source:
        effectiveStatus.learning?.source === "llm"
          ? ("llm" as const)
          : ("session" as const),
      agent: effectiveStatus.agent,
      sessionId: effectiveStatus.sessionId,
    })),
    ...sessions.flatMap((session) =>
      (session.learning?.socialBubbleCandidates ?? []).map((candidate) => ({
        ...candidate,
        source:
          session.learning?.source === "llm"
            ? ("llm" as const)
            : ("session" as const),
        agent: session.agent,
        sessionId: session.sessionId,
      })),
    ),
  ]);
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
  const sceneContextRecordPlayer =
    sceneContextMenu?.target.kind === "placed-item" &&
    sceneContextMenu.target.placedItem.itemId === RECORD_PLAYER_ITEM_ID
      ? sceneContextMenu.target.placedItem
      : null;
  const sceneContextGameConsole =
    sceneContextMenu?.target.kind === "placed-item" &&
    sceneContextMenu.target.placedItem.itemId === "game-console"
      ? sceneContextMenu.target.placedItem
      : null;
  const stopSceneContextRecordPlayer = () => {
    if (
      !sceneContextRecordPlayer ||
      !sceneContextMenu ||
      sceneContextMenu.target.kind !== "placed-item"
    ) {
      return;
    }
    const { placedItem, item } = sceneContextMenu.target;
    setSceneContextMenu(null);
    if (activeRecordPlayerId !== sceneContextRecordPlayer.id) return;
    if (isHighPriorityStatus(statusRef.current.status)) {
      showPlacedItemBusy(placedItem, item);
      return;
    }
    queuePlacedItemInteraction(placedItem, item, "stop-music");
  };
  const selectedBgmTrackLabel = ui(
    (BGM_TRACKS.find((track) => track.id === bgmTrackId) ?? BGM_TRACKS[0]).copyKey,
  );
  const activeSaveSlot = activeSaveSlotId
    ? saveSlots.find((slot) => slot.id === activeSaveSlotId)
    : null;
  const saveSlotCells = Array.from({ length: MAX_SAVE_SLOTS }, (_, index) => ({
    index,
    slot: saveSlots.find((entry) => entry.slotIndex === index) ?? null,
  }));
  const formatSaveSlotTimestamp = (timestamp: string) => {
    const value = Date.parse(timestamp);
    if (!Number.isFinite(value)) return "";

    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);
  };
  const sceneContextActionLabel =
    sceneContextMenu?.target.kind === "placed-item"
      ? sceneContextMenu.target.action === "brew"
        ? ui("scene.action.brew")
        : sceneContextMenu.target.action === "paint"
          ? ui("scene.action.paint")
          : sceneContextMenu.target.action === "play"
            ? ui("scene.action.play")
            : sceneContextMenu.target.action === "music"
              ? ui("scene.action.music")
              : sceneContextMenu.target.action === "stop-music"
                ? ui("scene.action.stopMusic")
                : ui("scene.action.interact")
      : sceneContextMenu
        ? behaviorLabel(locale, sceneContextMenu.target.furniture.interaction)
        : "";
  const PaintingThumbnail = ({
    artwork,
    progress = 1,
  }: {
    artwork: AivatarPaintingArtwork;
    progress?: number;
  }) => (
    <svg
      className="painting-thumbnail"
      viewBox={`0 0 ${artwork.width} ${artwork.height}`}
      preserveAspectRatio="none"
      aria-label={artwork.title}
      role="img"
    >
      <rect width={artwork.width} height={artwork.height} fill="#fff8df" />
      {artwork.pixels.flatMap((row, y) =>
        [...row].map((pixel, x) => {
          if (!paintingPixelVisible(artwork, x, y, progress)) return null;
          const colorIndex = Number.parseInt(pixel, 36);
          const fill = artwork.palette[colorIndex] ?? artwork.palette[0] ?? "#111624";
          return <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />;
        }),
      )}
    </svg>
  );
  const ItemThumbnail = ({ itemId }: { itemId: string }) => {
    const arcadeThumbnailIndex = ITEM_ARCADE_A_THUMBNAIL_INDICES[itemId];
    const terminalSkinThumbnailIndex = TERMINAL_SKIN_THUMBNAIL_INDICES[itemId];

    if (arcadeThumbnailIndex !== undefined) {
      return (
        <span
          className="item-button-thumbnail item-thumbnail-arcade-a"
          style={
            {
              "--item-thumbnail-x": `-${arcadeThumbnailIndex * ITEM_ARCADE_A_THUMBNAIL_CELL_SIZE}px`,
            } as React.CSSProperties
          }
          aria-hidden="true"
        />
      );
    }

    if (terminalSkinThumbnailIndex !== undefined) {
      return (
        <span
          className="item-button-thumbnail item-thumbnail-terminal-skin"
          style={
            {
              "--terminal-thumbnail-x": `-${terminalSkinThumbnailIndex * TERMINAL_SKIN_THUMBNAIL_CELL_SIZE}px`,
            } as React.CSSProperties
          }
          aria-hidden="true"
        />
      );
    }

    if (itemId === BED_INDUSTRIAL_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 2,
              top: 5,
              width: 14,
              height: 10,
              background: "#2f343b",
              border: "2px solid #222933",
              boxShadow: "inset 0 3px 0 #4a5058",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 1,
              top: 3,
              width: 3,
              height: 14,
              background: "#8d98a6",
              boxShadow: "13px 0 0 #8d98a6",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 4,
              width: 8,
              height: 3,
              background: "#d7dce0",
            }}
          />
        </span>
      );
    }

    if (itemId === BED_WOOD_RED_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 2,
              top: 5,
              width: 14,
              height: 10,
              background: "#9d1f2f",
              border: "2px solid #4d2614",
              boxShadow: "inset 0 3px 0 #d6454b",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 1,
              top: 3,
              width: 3,
              height: 14,
              background: "#c47a3c",
              boxShadow: "13px 0 0 #c47a3c",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 4,
              width: 8,
              height: 3,
              background: "#f5e6d0",
            }}
          />
        </span>
      );
    }

    if (itemId === BED_IVORY_PINK_PLAID_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 2,
              top: 5,
              width: 14,
              height: 10,
              background: "#f4a1bd",
              border: "2px solid #efe2c7",
              boxShadow: "inset 0 3px 0 #ffd2df",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 1,
              top: 3,
              width: 3,
              height: 14,
              background: "#fff7df",
              boxShadow: "13px 0 0 #fff7df",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 4,
              width: 8,
              height: 3,
              background: "#fff0f4",
              boxShadow: "0 5px 0 #bd4d78, 4px 3px 0 #ffd2df",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 8,
              top: 8,
              width: 2,
              height: 8,
              background: "#bd4d78",
            }}
          />
        </span>
      );
    }

    if (itemId === BED_MODERN_MINIMAL_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 2,
              top: 5,
              width: 14,
              height: 10,
              background: "#7c998b",
              border: "2px solid #b9824d",
              boxShadow: "inset 0 3px 0 #a7bdaf",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 1,
              top: 4,
              width: 3,
              height: 13,
              background: "#2e3335",
              boxShadow: "13px 0 0 #2e3335",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 4,
              width: 8,
              height: 3,
              background: "#f4efe5",
              boxShadow: "0 7px 0 #d8b46a",
            }}
          />
        </span>
      );
    }

    if (itemId === BED_SPACE_WHITE_DEEP_GRAY_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 2,
              top: 5,
              width: 14,
              height: 10,
              background: "#252b34",
              border: "2px solid #e8eef2",
              boxShadow: "inset 0 3px 0 #414a56",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 1,
              top: 4,
              width: 3,
              height: 13,
              background: "#fbfdfd",
              boxShadow: "13px 0 0 #fbfdfd",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 4,
              width: 8,
              height: 3,
              background: "#f5f8f8",
              boxShadow: "0 7px 0 #414a56",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 13,
              top: 8,
              width: 2,
              height: 2,
              background: "#ffffff",
              boxShadow: "-7px 5px 0 #303844",
            }}
          />
        </span>
      );
    }

    if (itemId === DESK_INDUSTRIAL_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 1,
              top: 5,
              width: 16,
              height: 5,
              background: "#3f4650",
              border: "2px solid #171b22",
              boxShadow: "inset 0 2px 0 #68717d",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 4,
              top: 11,
              width: 3,
              height: 7,
              background: "#171b22",
              boxShadow: "9px 0 0 #171b22",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 6,
              top: 14,
              width: 8,
              height: 2,
              background: "#68717d",
              boxShadow: "0 -8px 0 #a8b0ba",
            }}
          />
        </span>
      );
    }

    if (itemId === DESK_TRANSPARENT_ACRYLIC_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 1,
              top: 5,
              width: 16,
              height: 5,
              background: "rgba(218, 248, 255, 0.62)",
              border: "2px solid #88dff0",
              boxShadow: "inset 0 2px 0 #ffffff, 0 2px 0 #27333b",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 4,
              top: 11,
              width: 3,
              height: 7,
              background: "#171b22",
              boxShadow: "9px 0 0 #171b22",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 6,
              width: 10,
              height: 1,
              background: "#ffffff",
              boxShadow: "2px 3px 0 #88dff0, 4px 8px 0 #b7d8e3",
            }}
          />
        </span>
      );
    }

    if (itemId === DESK_ROCOCO_IVORY_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 1,
              top: 5,
              width: 16,
              height: 5,
              background: "#eadbbd",
              border: "2px solid #aa9777",
              boxShadow: "inset 0 2px 0 #fff4d8",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 3,
              top: 11,
              width: 3,
              height: 7,
              background: "#d8c59b",
              boxShadow: "10px 0 0 #d8c59b, 2px 5px 0 #a88442, 8px 5px 0 #a88442",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 6,
              width: 9,
              height: 2,
              background: "#ffe8a4",
              boxShadow: "2px 7px 0 #fff6df",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 8,
              top: 13,
              width: 2,
              height: 2,
              background: "#a88442",
            }}
          />
        </span>
      );
    }

    if (itemId === TABLE_ROCOCO_IVORY_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 1,
              top: 5,
              width: 16,
              height: 6,
              background: "#eadbbd",
              border: "2px solid #aa9777",
              boxShadow: "inset 0 2px 0 #fff4d8",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 4,
              top: 12,
              width: 3,
              height: 6,
              background: "#d8c59b",
              boxShadow: "8px 0 0 #d8c59b, 2px 4px 0 #a88442, 6px 4px 0 #a88442",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 7,
              width: 9,
              height: 1,
              background: "#ffe8a4",
              boxShadow: "2px 4px 0 #fff6df",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 8,
              top: 10,
              width: 3,
              height: 1,
              background: "#a88442",
            }}
          />
        </span>
      );
    }

    if (itemId === TABLE_DARK_OAK_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 1,
              top: 5,
              width: 16,
              height: 6,
              background: "#5d3321",
              border: "2px solid #2a1710",
              boxShadow: "inset 0 2px 0 #815136",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 4,
              top: 12,
              width: 3,
              height: 6,
              background: "#4a2618",
              boxShadow: "8px 0 0 #4a2618, 2px 4px 0 #1b0f0a, 6px 4px 0 #1b0f0a",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 7,
              width: 9,
              height: 1,
              background: "#a66c4a",
              boxShadow: "2px 4px 0 #815136",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 8,
              top: 10,
              width: 3,
              height: 1,
              background: "#2a1710",
            }}
          />
        </span>
      );
    }

    if (itemId === TABLE_WHITE_TECH_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 1,
              top: 5,
              width: 16,
              height: 6,
              background: "#f6fbfd",
              border: "2px solid #8fa0aa",
              boxShadow: "inset 0 2px 0 #ffffff",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 4,
              top: 12,
              width: 3,
              height: 6,
              background: "#3d4a55",
              boxShadow: "8px 0 0 #3d4a55, 2px 4px 0 #151b23, 6px 4px 0 #151b23",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 5,
              top: 7,
              width: 9,
              height: 1,
              background: "#88dfff",
              boxShadow: "2px 4px 0 #d5f7ff",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 13,
              top: 9,
              width: 2,
              height: 2,
              background: "#bdf1ff",
              boxShadow: "-8px 3px 0 #bdf1ff",
            }}
          />
        </span>
      );
    }

    if (itemId === FRIDGE_IVORY_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 5,
              top: 2,
              width: 10,
              height: 16,
              background: "#eadbbd",
              border: "2px solid #9f8b67",
              boxShadow: "inset 2px 2px 0 #f1e4c9",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 7,
              top: 8,
              width: 6,
              height: 1,
              background: "#9f8b67",
              boxShadow: "0 5px 0 #9f8b67",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 7,
              top: 5,
              width: 4,
              height: 1,
              background: "#ffe8a4",
              boxShadow: "0 6px 0 #ffe8a4",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 13,
              top: 4,
              width: 1,
              height: 12,
              background: "#cdb58a",
            }}
          />
        </span>
      );
    }

    if (itemId === FRIDGE_RED_RETRO_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 6,
              top: 1,
              width: 8,
              height: 18,
              background: "#4a1119",
              boxShadow: "-2px 2px 0 #4a1119, 2px 2px 0 #4a1119, -3px 6px 0 #4a1119, 3px 6px 0 #4a1119",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 6,
              top: 3,
              width: 8,
              height: 14,
              background: "#c81724",
              boxShadow: "-1px 2px 0 #e1262f, 1px 2px 0 #bd1420, -2px 6px 0 #e1262f, 2px 6px 0 #bd1420",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 7,
              top: 5,
              width: 4,
              height: 1,
              background: "#f7fbff",
              boxShadow: "0 6px 0 #f7fbff",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 13,
              top: 5,
              width: 1,
              height: 10,
              background: "#8d111b",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 8,
              top: 8,
              width: 5,
              height: 1,
              background: "#4a1119",
              boxShadow: "0 5px 0 #4a1119",
            }}
          />
        </span>
      );
    }

    if (itemId === FRIDGE_WHITE_TECH_SKIN_ID) {
      return (
        <span className="item-button-thumbnail" aria-hidden="true">
          <span
            className="item-thumb-shape"
            style={{
              left: 5,
              top: 2,
              width: 10,
              height: 16,
              background: "#f7fbff",
              border: "2px solid #aebdc8",
              boxShadow: "inset 2px 2px 0 #ffffff, inset -2px 0 0 #d4e4ec",
            }}
          />
          <span
            className="item-thumb-accent"
            style={{
              left: 7,
              top: 8,
              width: 6,
              height: 1,
              background: "#7fe6ff",
              boxShadow: "0 5px 0 #7fe6ff",
            }}
          />
          <span
            className="item-thumb-detail"
            style={{
              left: 12,
              top: 5,
              width: 2,
              height: 5,
              background: "#314252",
              boxShadow: "0 7px 0 #dff7ff",
            }}
          />
          <span
            className="item-thumb-detail-two"
            style={{
              left: 8,
              top: 4,
              width: 4,
              height: 1,
              background: "#ffffff",
              boxShadow: "0 11px 0 #ffffff",
            }}
          />
        </span>
      );
    }

    return (
      <span className={`item-button-thumbnail item-thumb-${itemId}`} aria-hidden="true">
        <span className="item-thumb-steam steam-left" />
        <span className="item-thumb-steam steam-right" />
        <span className="item-thumb-shape" />
        <span className="item-thumb-accent" />
        <span className="item-thumb-detail" />
        <span className="item-thumb-detail-two" />
      </span>
    );
  };

  const windowPreviewDisplayHour = windowPreviewHour ?? new Date(nowMs).getHours();
  const windowPreviewTimeLabel = `${String(windowPreviewDisplayHour).padStart(2, "0")}:00`;

  return (
    <main
      lang={locale}
      className={`app-shell ${
        uiTheme === "terminal-amber" ? "theme-terminal theme-terminal-amber" : `theme-${uiTheme}`
      }${sidePanelOpen ? "" : " side-panel-collapsed"}${
        sidePanelAnimating ? " side-panel-animating" : ""
      }`}
      style={
        scenePanelWidth
          ? ({ "--scene-panel-width": `${scenePanelWidth}px` } as React.CSSProperties)
          : undefined
      }
    >
      {saveMenuOpen ? (
        <section
          className="save-slot-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={ui("saveSlots.title")}
        >
          <div className="save-slot-dialog">
            <div className="save-slot-heading">
              <div className="save-slot-heading-main">
                <span>{ui("saveSlots.eyebrow")}</span>
                <h1>{ui("saveSlots.title")}</h1>
                <p>{ui("saveSlots.subtitle")}</p>
              </div>
              <div className="save-slot-language" aria-label={ui("app.language")}>
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
            </div>

            <div className="save-slot-grid">
              {saveSlotCells.map(({ index, slot }) => {
                const slotSave = slot
                  ? slot.id === activeSaveSlotId
                    ? save
                    : loadSave(contentBase, saveSlotStorageKey(slot.id))
                  : null;

                return slot ? (
                  <article
                    key={slot.id}
                    className={`save-slot-card${slot.id === activeSaveSlotId ? " active" : ""}`}
                  >
                    <span className="save-slot-card-kicker">
                      {ui("saveSlots.slot", { value: index + 1 })}
                    </span>
                    <span className={`save-avatar-preview avatar-preview-${slot.avatarAppearanceId}`}>
                      <span aria-hidden="true" />
                    </span>
                    <strong>{slot.avatarName}</strong>
                    <small>
                      {ui("saveSlots.level", {
                        value: slotSave?.memory?.growth.level ?? 1,
                      })}
                    </small>
                    <small>
                      {ui("saveSlots.bits", {
                        value: slotSave?.wallet.bits ?? 0,
                      })}
                    </small>
                    <small>{formatSaveSlotTimestamp(slot.updatedAt)}</small>
                    <span className="save-slot-actions">
                      <button
                        type="button"
                        className="pixel-button save-slot-enter-button"
                        onClick={() => selectSaveSlot(slot.id)}
                      >
                        {ui("saveSlots.enter")}
                      </button>
                      {saveMenuOpenedFromRoom && slot.id !== activeSaveSlotId ? (
                        <button
                          type="button"
                          className="pixel-button save-slot-window-button"
                          onClick={() => void openSaveSlotWindow(slot)}
                        >
                          {ui("saveSlots.openWindow")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="pixel-button danger-button save-slot-delete-button"
                        onClick={() => requestDeleteSaveSlot(slot)}
                      >
                        {ui("saveSlots.remove")}
                      </button>
                    </span>
                  </article>
                ) : (
                  <button
                    key={`empty-${index}`}
                    type="button"
                    className={`save-slot-card empty${
                      creatingSaveSlotIndex === index ? " active" : ""
                    }`}
                    onClick={() => startCreateSaveSlot(index)}
                  >
                    <span className="save-slot-card-kicker">
                      {ui("saveSlots.slot", { value: index + 1 })}
                    </span>
                    <span className="save-slot-empty-icon" aria-hidden="true">
                      +
                    </span>
                    <strong>{ui("saveSlots.empty")}</strong>
                    <small>{ui("saveSlots.newRoom")}</small>
                  </button>
                );
              })}
            </div>

            {creatingSaveSlotIndex !== null ? (
              <div className="save-create-panel">
                <div className="save-create-heading">
                  <h2>
                    {ui("saveSlots.createTitle", { value: creatingSaveSlotIndex + 1 })}
                  </h2>
                  <span>{ui("saveSlots.character")}</span>
                </div>
                <label className="name-editor save-create-name-editor">
                  <span>{ui("saveSlots.nameLabel")}</span>
                  <input
                    value={newSaveAvatarName}
                    onChange={(event) => setNewSaveAvatarName(event.target.value)}
                    placeholder={ui("saveSlots.namePlaceholder")}
                    maxLength={32}
                  />
                </label>
                <div className="avatar-choice-grid">
                  {AVATAR_APPEARANCES.map((appearance) => (
                    <button
                      key={appearance.id}
                      type="button"
                      className={`avatar-choice-card${
                        selectedAvatarAppearanceId === appearance.id ? " active" : ""
                      }`}
                      onClick={() => setSelectedAvatarAppearanceId(appearance.id)}
                    >
                      <span className={`save-avatar-preview avatar-preview-${appearance.id}`}>
                        <span aria-hidden="true" />
                      </span>
                      <strong>{ui(appearance.copyKey)}</strong>
                      <small>{ui(appearance.descriptionKey)}</small>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="pixel-button save-create-button"
                  onClick={createSaveSlot}
                >
                  {ui("saveSlots.create")}
                </button>
                <div className="save-import-actions">
                  <button
                    type="button"
                    className="pixel-button"
                    onClick={() => openLocalSavePicker(false)}
                  >
                    {ui("saveSlots.importJson")}
                  </button>
                  <button
                    type="button"
                    className="pixel-button"
                    onClick={() => openLocalSavePicker(true)}
                  >
                    {ui("saveSlots.importFolder")}
                  </button>
                </div>
                <p className="save-slot-hint">{ui("saveSlots.importHint")}</p>
              </div>
            ) : activeSaveSlot ? (
              <p className="save-slot-hint">
                {ui("saveSlots.currentHint", {
                  name: activeSaveSlot.avatarName,
                })}
              </p>
            ) : null}
            {saveSlotMessage ? <p className="save-slot-message">{saveSlotMessage}</p> : null}
          </div>
          {deleteSaveSlot ? (
            <div
              className="save-delete-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label={ui("saveSlots.deleteTitle")}
            >
              <h2>{ui("saveSlots.deleteTitle")}</h2>
              <p>
                {ui("saveSlots.deleteWarning", {
                  name: deleteSaveSlot.avatarName,
                })}
              </p>
              <div className="save-delete-actions">
                <button
                  type="button"
                  className="pixel-button"
                  onClick={() => setDeleteSaveSlot(null)}
                >
                  {ui("action.cancel")}
                </button>
                <button
                  type="button"
                  className="pixel-button danger-button"
                  onClick={confirmDeleteSaveSlot}
                >
                  {ui("saveSlots.confirmDelete")}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

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
            aria-label={currentSessionContextMeter.meters
              .map((meter) => `${ui(meter.labelKey)} ${meter.percentLabel}`)
              .join(", ")}
          >
            {currentSessionContextMeter.meters.map((meter) => (
              <div key={meter.key} className={`room-context-row ${meter.level}`}>
                <span>{ui(meter.labelKey)}</span>
                <div className="room-context-bar">
                  <div
                    className="room-context-fill"
                    style={{ width: `${meter.percent}%` }}
                  />
                </div>
                <strong>{meter.percentLabel}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {!sidePanelOpen && !sidePanelAnimating ? (
          <>
            <div className="room-stats-overlay" aria-label={ui("app.roomAria")}>
              {statRows.map((key) => (
                <div key={key} className="room-stat-mini">
                  <span>{statLabel(locale, key)}</span>
                  <meter min="0" max="100" value={save.petStats[key]} />
                  <b>{Math.round(save.petStats[key])}</b>
                </div>
              ))}
            </div>
            <div className="room-growth-overlay" aria-label={ui("growth.title")}>
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
              <div className="room-growth-footer">
                <span className="room-growth-trait">
                  {ui(`growth.trait.${dominantTrait}`)} {growth.traits[dominantTrait]}
                </span>
                <b className="room-growth-bits">
                  {save.wallet.bits} {ui("currency.bits")}
                </b>
              </div>
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
        {avatarAway ? (
          <div className="room-away-overlay" aria-live="polite">
            <span>{ui("roomVisit.away")}</span>
          </div>
        ) : null}
        {roomVisitMessage && !roomVisitMenuOpen ? (
          <div className="room-visit-toast" aria-live="polite">
            {roomVisitMessage}
          </div>
        ) : null}
        {roomVisitMenuOpen ? (
          <div
            className="room-visit-dialog"
            role="dialog"
            aria-modal="false"
            aria-label={ui("roomVisit.title")}
          >
            <header>
              <h2>{ui("roomVisit.title")}</h2>
              <button
                type="button"
                className="room-visit-close"
                onClick={() => setRoomVisitMenuOpen(false)}
                aria-label={ui("action.cancel")}
              >
                x
              </button>
            </header>
            {onlineVisitRooms.length ? (
              <div className="room-visit-list">
                {onlineVisitRooms.map((room) => (
                  <button
                    key={room.roomInstanceId}
                    type="button"
                    className="room-visit-row"
                    onClick={() => inviteRoom(room)}
                    disabled={Boolean(activeVisit) || room.status !== "home"}
                  >
                    <span>
                      <strong>{room.avatarName}</strong>
                      <small>
                        {ui("saveSlots.slot", { value: room.slotIndex + 1 })} /
                        {ui("growth.level", { value: room.growthLevel })}
                      </small>
                    </span>
                    <b>
                      {room.status === "busy"
                        ? ui("roomVisit.busy")
                        : ui("roomVisit.invite")}
                    </b>
                  </button>
                ))}
              </div>
            ) : (
              <p>{ui("roomVisit.empty")}</p>
            )}
            {activeVisit ? (
              <p className="room-visit-active">
                {activeVisit.host.roomInstanceId === roomInstanceIdRef.current
                  ? ui(
                      activeVisit.guestRuntimeRoomInstanceId ===
                        activeVisit.host.roomInstanceId
                        ? "roomVisit.hosting"
                        : "roomVisit.waiting",
                      { name: activeVisit.guest.avatarName },
                    )
                  : ui("roomVisit.away")}
              </p>
            ) : null}
          </div>
        ) : null}
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
            {sceneContextRecordPlayer ? (
              <label className="scene-context-control">
                <span>
                  {ui("audio.bgmTrack")}
                  <b>{selectedBgmTrackLabel}</b>
                </span>
                <select
                  value={bgmTrackId}
                  onPointerDown={unlockAppAudio}
                  onKeyDown={unlockAppAudio}
                  onChange={(event) => setBgmTrackId(event.target.value as BgmTrackId)}
                  aria-label={ui("audio.bgmTrack")}
                >
                  {BGM_TRACKS.map((track) => (
                    <option key={track.id} value={track.id}>
                      {ui(track.copyKey)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {sceneContextRecordPlayer ? (
              <label className="scene-context-control">
                <span>
                  {ui("audio.bgmVolume")}
                  <b>
                    {bgmVolume <= 0
                      ? ui("audio.muted")
                      : `${Math.round(bgmVolume * 100)}%`}
                  </b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(bgmVolume * 100)}
                  onPointerDown={unlockAppAudio}
                  onKeyDown={unlockAppAudio}
                  onChange={(event) => setBgmVolume(Number(event.target.value) / 100)}
                  aria-label={ui("audio.bgmVolume")}
                />
              </label>
            ) : null}
            {sceneContextGameConsole ? (
              <label className="scene-context-control">
                <span>
                  {ui("audio.gameConsoleVolume")}
                  <b>
                    {gameConsoleVolume <= 0
                      ? ui("audio.muted")
                      : `${Math.round(gameConsoleVolume * 100)}%`}
                  </b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(gameConsoleVolume * 100)}
                  onPointerDown={unlockAppAudio}
                  onKeyDown={unlockAppAudio}
                  onChange={(event) =>
                    setGameConsoleVolume(Number(event.target.value) / 100)
                  }
                  aria-label={ui("audio.gameConsoleVolume")}
                />
              </label>
            ) : null}
            {sceneContextRecordPlayer &&
            activeRecordPlayerId === sceneContextRecordPlayer.id ? (
              <button
                type="button"
                className="scene-context-button scene-context-stop-button"
                onClick={stopSceneContextRecordPlayer}
              >
                {ui("scene.action.stopMusic")}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <aside className="side-panel" aria-hidden={!sidePanelOpen}>
        <header className="status-header">
          <div>
            <p className="eyebrow">
              {sourceLabel} / {configStateLabel}
            </p>
            <h1>{content.avatar.name}</h1>
          </div>
          <span className={`status-dot status-${effectiveStatus.status}`} />
        </header>

        <section className="settings-card" aria-label={ui("settings.title")}>
          <button
            type="button"
            className={`settings-toggle${soundPanelOpen ? " active" : ""}`}
            onClick={() => setSoundPanelOpen((current) => !current)}
            aria-expanded={soundPanelOpen}
          >
            <span className="settings-toggle-main">
              <span>{ui("settings.title")}</span>
              <b>
                <svg
                  className="settings-volume-icon"
                  aria-hidden="true"
                  focusable="false"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="currentColor"
                    d="M3 8.25C3 7.56 3.56 7 4.25 7h4.1l6.15-4.4c.67-.48 1.6 0 1.6.82v17.16c0 .82-.93 1.3-1.6.82L8.35 17h-4.1C3.56 17 3 16.44 3 15.75v-7.5Z"
                  />
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2.7"
                    d="M18.1 9.1a4.8 4.8 0 0 1 0 5.8"
                  />
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2.7"
                    d="M20.35 5.9a9 9 0 0 1 0 12.2"
                  />
                </svg>
                <span>
                  {audioVolume <= 0 ? ui("audio.muted") : `${Math.round(audioVolume * 100)}%`}
                </span>
              </b>
            </span>
            <span className="settings-toggle-chevron" aria-hidden="true">
              {soundPanelOpen ? "-" : "+"}
            </span>
          </button>

          {soundPanelOpen ? (
            <div className="settings-submenu">
              <label className="name-editor settings-name-editor">
                <span>{ui("avatar.name")}</span>
                <input
                  type="text"
                  maxLength={16}
                  value={save.avatarName ?? contentBase.avatar.name}
                  onChange={(event) => updateAvatarName(event.target.value)}
                />
              </label>

              <button
                type="button"
                className="pixel-button"
                onClick={openSaveSlotManager}
              >
                {ui("saveSlots.manage")}
              </button>

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

              <div className="theme-switch" aria-label={ui("theme.title")}>
                {UI_THEME_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`theme-button${uiTheme === option.id ? " active" : ""}`}
                    onClick={() => setUiTheme(option.id)}
                  >
                    {ui(option.copyKey)}
                  </button>
                ))}
              </div>

              <label className="audio-control">
                <span>
                  {ui("audio.volume")}
                  <b>
                    {audioVolume <= 0
                      ? ui("audio.muted")
                      : `${Math.round(audioVolume * 100)}%`}
                  </b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(audioVolume * 100)}
                  onPointerDown={unlockAppAudio}
                  onKeyDown={unlockAppAudio}
                  onChange={(event) => setAudioVolume(Number(event.target.value) / 100)}
                  aria-label={ui("audio.title")}
                />
              </label>

              <label className="audio-control">
                <span>
                  {ui("audio.startupSound")}
                  <b>{startupSoundEnabled ? ui("common.on") : ui("common.off")}</b>
                </span>
                <input
                  type="checkbox"
                  checked={startupSoundEnabled}
                  onPointerDown={unlockAppAudio}
                  onKeyDown={unlockAppAudio}
                  onChange={(event) => setStartupSoundEnabled(event.target.checked)}
                  aria-label={ui("audio.startupSound")}
                  style={{ width: "auto", justifySelf: "start" }}
                />
              </label>

              <label className="audio-control">
                <span>
                  {ui("audio.gameConsoleVolume")}
                  <b>
                    {gameConsoleVolume <= 0
                      ? ui("audio.muted")
                      : `${Math.round(gameConsoleVolume * 100)}%`}
                  </b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(gameConsoleVolume * 100)}
                  onPointerDown={unlockAppAudio}
                  onKeyDown={unlockAppAudio}
                  onChange={(event) =>
                    setGameConsoleVolume(Number(event.target.value) / 100)
                  }
                  aria-label={ui("audio.gameConsoleVolume")}
                />
              </label>

              <label className="audio-control">
                <span>
                  {ui("audio.bgmTrack")}
                  <b>{selectedBgmTrackLabel}</b>
                </span>
                <select
                  value={bgmTrackId}
                  onPointerDown={unlockAppAudio}
                  onKeyDown={unlockAppAudio}
                  onChange={(event) => setBgmTrackId(event.target.value as BgmTrackId)}
                  aria-label={ui("audio.bgmTrack")}
                >
                  {BGM_TRACKS.map((track) => (
                    <option key={track.id} value={track.id}>
                      {ui(track.copyKey)}
                    </option>
                  ))}
                </select>
                <small className="audio-control-hint">
                  {ui("audio.bgmRequiresRecordPlayer")}
                </small>
              </label>

              <label className="audio-control">
                <span>
                  {ui("audio.bgmVolume")}
                  <b>
                    {bgmVolume <= 0
                      ? ui("audio.muted")
                      : `${Math.round(bgmVolume * 100)}%`}
                  </b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(bgmVolume * 100)}
                  onPointerDown={unlockAppAudio}
                  onKeyDown={unlockAppAudio}
                  onChange={(event) => setBgmVolume(Number(event.target.value) / 100)}
                  aria-label={ui("audio.bgmVolume")}
                />
              </label>

              <label className="audio-control">
                <span>
                  {ui("audio.autoMusic")}
                  <b>{autoMusicEnabled ? ui("common.on") : ui("common.off")}</b>
                </span>
                <input
                  type="checkbox"
                  checked={autoMusicEnabled}
                  onPointerDown={unlockAppAudio}
                  onKeyDown={unlockAppAudio}
                  onChange={(event) => setAutoMusicEnabled(event.target.checked)}
                  aria-label={ui("audio.autoMusic")}
                  style={{ width: "auto", justifySelf: "start" }}
                />
              </label>

              <label className="audio-control">
                <span>
                  {ui("app.alwaysOnTop")}
                  <b>{alwaysOnTopEnabled ? ui("common.on") : ui("common.off")}</b>
                </span>
                <input
                  type="checkbox"
                  checked={alwaysOnTopEnabled}
                  onChange={(event) => setAlwaysOnTopEnabled(event.target.checked)}
                  aria-label={ui("app.alwaysOnTop")}
                  style={{ width: "auto", justifySelf: "start" }}
                />
              </label>
            </div>
          ) : null}
        </section>

        <div className="status-card">
          <span>{statusLabel(locale, effectiveStatus.status)}</span>
          <strong>{behaviorLabel(locale, avatar.behavior)}</strong>
          {debugStatus ? (
            <p className="debug-override-warning">
              {ui("debug.debugOverrideWarning")}
            </p>
          ) : null}
          <p>{currentStatusMessage()}</p>
        </div>

        <div className="stats-grid">
          {statRows.map((key) => (
            <label key={key} className="stat-row">
              <span>{statLabel(locale, key)}</span>
              <meter min="0" max="100" value={save.petStats[key]} />
              <b>{Math.round(save.petStats[key])}</b>
            </label>
          ))}
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
                    {idleBubbleCandidates.map((candidate) => {
                      const badge = idleBubbleCandidateBadge(candidate);
                      const badgeClass = idleBubbleCandidateBadgeClass(candidate);
                      return (
                        <button
                          key={`${candidate.source}:${candidate.agent ?? "local"}:${candidate.phrase}`}
                          type="button"
                          className={`pixel-button idle-bubble-candidate${
                            candidate.source === "llm" ? " llm" : ""
                          }${candidate.agent ? ` ${badgeClass}` : ""}`}
                          disabled={!idleBubbleSlotsAvailable}
                          onClick={() => addIdleBubblePhrase(candidate.phrase)}
                          title={
                            badge
                              ? `${badge} suggested`
                              : undefined
                          }
                        >
                          <span>{candidate.phrase}</span>
                          {badge ? (
                            <b className={`idle-bubble-source ${badgeClass}`}>
                              {badge}
                            </b>
                          ) : (
                            <b>{ui("action.add")}</b>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="idle-bubble-empty">{ui("idleBubble.noSuggestions")}</p>
                )}
              </div>
              <div className="idle-bubble-editor social-bubble-editor">
                <div className="idle-bubble-heading">
                  <span>{ui("socialBubble.title")}</span>
                  <b>
                    {savedSocialBubbles.length}/{socialBubbleSlotCount}
                  </b>
                </div>
                {savedSocialBubbles.length > 0 ? (
                  <div className="idle-bubble-list social-bubble-list">
                    {savedSocialBubbles.map((bubble) => (
                      <button
                        key={bubble.id}
                        type="button"
                        className="idle-bubble-pill social-bubble-pill"
                        onClick={() => removeSocialBubble(bubble.id)}
                        title={ui("action.remove")}
                      >
                        <span>{bubble.text}</span>
                        <b>
                          {ui(`socialBubble.kind.${bubble.kind}`)}
                        </b>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="idle-bubble-empty">{ui("socialBubble.empty")}</p>
                )}
                <div className="idle-bubble-heading">
                  <span>{ui("socialBubble.suggested")}</span>
                  <b>{ui("idleBubble.limit", { value: socialBubbleSlotCount })}</b>
                </div>
                {socialBubbleCandidates.length > 0 ? (
                  <div className="idle-bubble-candidates social-bubble-candidates">
                    {socialBubbleCandidates.map((candidate) => {
                      const badge = socialBubbleCandidateBadge(candidate);
                      const badgeClass = socialBubbleCandidateBadgeClass(candidate);
                      const roleLabel = (candidate.allowedVisitRoles ?? [])
                        .map((role) => ui(`socialBubble.role.${role}`))
                        .join("/");
                      const meta = [
                        ui(`socialBubble.kind.${candidate.kind}`),
                        roleLabel,
                        candidate.activity
                          ? behaviorLabel(locale, candidate.activity)
                          : "",
                      ].filter(Boolean).join(" · ");
                      return (
                        <button
                          key={`${candidate.source}:${candidate.agent ?? "local"}:${socialBubbleSignature(candidate)}`}
                          type="button"
                          className={`pixel-button idle-bubble-candidate social-bubble-candidate${
                            candidate.source === "llm" ? " llm" : ""
                          }${candidate.agent ? ` ${badgeClass}` : ""}`}
                          disabled={!socialBubbleSlotsAvailable}
                          onClick={() => addSocialBubbleCandidate(candidate)}
                          title={badge ? `${badge} suggested` : undefined}
                        >
                          <span>
                            {candidate.text}
                            <small>{meta}</small>
                          </span>
                          {badge ? (
                            <b className={`idle-bubble-source ${badgeClass}`}>
                              {badge}
                            </b>
                          ) : (
                            <b>{ui("action.add")}</b>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="idle-bubble-empty">{ui("socialBubble.noSuggestions")}</p>
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
              {currentSessionKey ? ui("sessions.current") : sourceLabel}
            </span>
            {currentSessionContextMeter ? (
              <span className={`sessions-toggle-context ${currentSessionContextMeter.level}`}>
                <span className="sessions-toggle-context-label">
                  <span>{ui("sessions.context")}</span>
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
                  {ui("sessions.clearFollow")}
                </button>
              ) : null}
              <button
                type="button"
                className="session-clear-button"
                onClick={clearStaleSessionRows}
                disabled={clearableStaleSessionCount === 0}
              >
                {ui("sessions.clearStale")} ({clearableStaleSessionCount})
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
                          aria-label={`${ui("sessions.context")} ${session.contextMeter.percentLabel}`}
                        >
                          <div>
                            <span>{ui("sessions.context")}</span>
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
                      <small>{session.sessionId ?? ui("sessions.defaultSession")}</small>
                      <div className="session-meta-row">
                        {session.sessionKey === currentSessionKey ? (
                          <span className="session-chip">{ui("sessions.current")}</span>
                        ) : null}
                        {session.sessionKey === activeSessionKey ? (
                          <span className="session-chip">{ui("sessions.followed")}</span>
                        ) : null}
                        {session.sessionKey === connectedSessionKey ? (
                          <span className="session-chip">{ui("sessions.connected")}</span>
                        ) : null}
                        {session.stale && session.sessionKey === connectedSessionKey ? (
                          <span className="session-chip">{ui("sessions.idle")}</span>
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
                          {ui("sessions.follow")}
                        </button>
                        <button
                          type="button"
                          className="session-disconnect-button"
                          onClick={() => disconnectSessionRow(session)}
                          disabled={!session.agent || !session.sessionId}
                        >
                          {ui("sessions.disconnect")}
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

        <section className="integrations-card" aria-label={ui("integrations.title")}>
          <button
            type="button"
            className={`integrations-toggle${integrationsPanelOpen ? " active" : ""}`}
            onClick={() => setIntegrationsPanelOpen((current) => !current)}
            aria-expanded={integrationsPanelOpen}
          >
            <span className="integrations-toggle-main">
              <span>{ui("integrations.title")}</span>
              <b>
                {detectedIntegrationCount}/
                {agentIntegrations.length || (agentIntegrationsChecked ? 0 : 2)}
              </b>
            </span>
            <span className="integrations-toggle-status">
              {integrationToggleStatus}
            </span>
            <span className="integrations-toggle-chevron" aria-hidden="true">
              {integrationsPanelOpen ? "-" : "+"}
            </span>
          </button>

          {integrationsPanelOpen ? (
            <div className="integrations-submenu">
              <div className="integrations-actions">
                <button
                  type="button"
                  className="pixel-button"
                  onClick={() => void refreshAgentIntegrations()}
                >
                  {ui("integrations.refresh")}
                </button>
              </div>
              {agentIntegrations.length > 0 ? (
                <div className="integrations-list">
                  {agentIntegrations.map((integration) => (
                    <article
                      key={integration.agent}
                      className={`integration-card${
                        integration.enabled ? " enabled" : ""
                      }${integration.detected ? " detected" : ""}`}
                    >
                      <div className="integration-heading">
                        <strong>{integration.label}</strong>
                        <span>
                          {integration.enabled
                            ? ui("integrations.enabled")
                            : integration.detected
                              ? ui("integrations.detected")
                              : ui("integrations.notFound")}
                        </span>
                      </div>
                      <p>{integration.detail}</p>
                      <div className="integration-chips">
                        <span>
                          {integration.cli_available
                            ? ui("integrations.cliReady")
                            : ui("integrations.cliMissing")}
                        </span>
                        {integration.needs_restart ? (
                          <span>{ui("integrations.restart")}</span>
                        ) : null}
                      </div>
                      {integration.connector_path ? (
                        <small title={integration.connector_path}>
                          {integration.connector_path}
                        </small>
                      ) : null}
                      <button
                        type="button"
                        className="pixel-button integration-enable"
                        onClick={() => enableAgentIntegration(integration.agent)}
                      >
                        {integration.enabled
                          ? ui("integrations.repair")
                          : integration.needs_restart
                            ? ui("integrations.repair")
                            : ui("integrations.enable")}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="integrations-empty">{ui("integrations.empty")}</p>
              )}
              {agentIntegrationMessage ? (
                <p className="integrations-message">{agentIntegrationMessage}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="task-cabinet-card" aria-label={ui("taskCabinet.title")}>
          <button
            type="button"
            className={`task-cabinet-toggle${taskCabinetPanelOpen ? " active" : ""}`}
            onClick={() => setTaskCabinetPanelOpen((current) => !current)}
            aria-expanded={taskCabinetPanelOpen}
          >
            <span className="task-cabinet-toggle-main">
              <span>{ui("taskCabinet.title")}</span>
              <b>{taskCabinetReadyCount}/{taskCabinetEntries.length}</b>
            </span>
            <span className="task-cabinet-toggle-status">
              {taskCabinetRunningCount > 0
                ? ui("taskCabinet.running")
                : canDispatchTasks
                    ? ui("taskCabinet.placed")
                    : ui("taskCabinet.placeToDispatch")}
            </span>
            <span className="task-cabinet-toggle-chevron" aria-hidden="true">
              {taskCabinetPanelOpen ? "-" : "+"}
            </span>
          </button>

          {taskCabinetPanelOpen ? (
            <div className="task-cabinet-submenu">
              <label className="task-cabinet-field">
                <span>{ui("taskCabinet.path")}</span>
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
                    {ui("launcher.browse")}
                  </button>
                </span>
              </label>
              <button
                type="button"
                className="pixel-button task-cabinet-add"
                onClick={addTaskCabinetEntry}
              >
                {ui("taskCabinet.add")}
              </button>
              <p className="task-cabinet-hint">
                {ui("taskCabinet.promptHint")}
              </p>
              <div className="task-cabinet-controls task-cabinet-controls-single">
                <button
                  type="button"
                  className="pixel-button task-cabinet-run-next"
                  disabled={
                    !canDispatchTasks ||
                    taskCabinetReadyCount === 0 ||
                    taskCabinetRunningCount > 0
                  }
                  onClick={runNextTaskCabinetEntry}
                >
                  {ui("taskCabinet.runNext")}
                </button>
              </div>
              <p className="task-cabinet-empty">
                {ui("taskCabinet.sourceHint")}
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
                        <span>{taskCabinetStatusLabel(entry.status)}</span>
                      </div>
                      <small className="task-cabinet-path" title={entry.path}>
                        {entry.path}
                      </small>
                      <label className="task-cabinet-field">
                        <span>{ui("profile.title")}</span>
                        <select
                          value={entry.runProfile ?? "default"}
                          onChange={(event) =>
                            setTaskCabinetRunProfile(
                              entry.id,
                              event.currentTarget.value as TaskCabinetRunProfile,
                            )
                          }
                        >
                          <option value="default">
                            {taskCabinetRunProfileLabel("default")}
                          </option>
                          <option value="fast">
                            {taskCabinetRunProfileLabel("fast")}
                          </option>
                        </select>
                      </label>
                      {entry.runProfile === "fast" ? (
                        <small className="task-cabinet-schedule-next">
                          {launcherAgent === "claude-code"
                            ? ui("profile.fastClaude")
                            : launcherAgent === "codex"
                              ? ui("profile.fastCodex")
                              : ui("profile.fastOpencode")}
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
                          <span>{ui("schedule.title")}</span>
                        </label>
                        <div className="task-cabinet-schedule-grid">
                          <label className="task-cabinet-field">
                            <span>{ui("schedule.mode")}</span>
                            <select
                              value={entry.schedule?.mode ?? "once"}
                              onChange={(event) =>
                                setTaskCabinetScheduleMode(
                                  entry.id,
                                  event.currentTarget.value as TaskCabinetScheduleMode,
                                )
                              }
                            >
                              <option value="once">
                                {taskCabinetScheduleModeLabel("once")}
                              </option>
                              <option value="repeat">
                                {taskCabinetScheduleModeLabel("repeat")}
                              </option>
                            </select>
                          </label>
                          <label className="task-cabinet-field task-cabinet-run-at-field">
                            <span>{ui("schedule.runAt")}</span>
                            <span className="task-cabinet-run-at-control">
                              <input
                                type="date"
                                aria-label={ui("schedule.date")}
                                className="task-cabinet-date-input"
                                value={
                                  /^\d{4}-\d{2}-\d{2}$/.test(
                                    taskScheduleRunAtParts(entry.schedule?.runAt)
                                      .date,
                                  )
                                    ? taskScheduleRunAtParts(entry.schedule?.runAt)
                                        .date
                                    : ""
                                }
                                onChange={(event) =>
                                  setTaskCabinetScheduleRunAtPart(
                                    entry.id,
                                    "date",
                                    event.currentTarget.value,
                                  )
                                }
                              />
                              <select
                                aria-label={ui("schedule.hour")}
                                className="task-cabinet-time-input"
                                value={
                                  taskScheduleRunAtParts(entry.schedule?.runAt)
                                    .hour
                                }
                                onChange={(event) =>
                                  setTaskCabinetScheduleRunAtPart(
                                    entry.id,
                                    "hour",
                                    event.currentTarget.value,
                                  )
                                }
                              >
                                <option value="">HH</option>
                                {Array.from({ length: 24 }, (_, hour) => {
                                  const value = String(hour).padStart(2, "0");
                                  return (
                                    <option key={value} value={value}>
                                      {value}
                                    </option>
                                  );
                                })}
                              </select>
                              <select
                                aria-label={ui("schedule.minute")}
                                className="task-cabinet-time-input"
                                value={
                                  taskScheduleRunAtParts(entry.schedule?.runAt)
                                    .minute
                                }
                                onChange={(event) =>
                                  setTaskCabinetScheduleRunAtPart(
                                    entry.id,
                                    "minute",
                                    event.currentTarget.value,
                                  )
                                }
                              >
                                <option value="">MM</option>
                                {Array.from({ length: 60 }, (_, minute) => {
                                  const value = String(minute).padStart(2, "0");
                                  return (
                                    <option key={value} value={value}>
                                      {value}
                                    </option>
                                  );
                                })}
                              </select>
                            </span>
                          </label>
                          <label className="task-cabinet-field">
                            <span>{ui("schedule.everyMin")}</span>
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
                            <span>{ui("schedule.condition")}</span>
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
                              <option value="always">
                                {taskCabinetScheduleConditionLabel("always")}
                              </option>
                              <option value="only_idle">
                                {taskCabinetScheduleConditionLabel("only_idle")}
                              </option>
                              <option value="after_success">
                                {taskCabinetScheduleConditionLabel("after_success")}
                              </option>
                            </select>
                          </label>
                        </div>
                        <small className="task-cabinet-schedule-next">
                          {entry.schedule?.enabled
                            ? taskScheduleNextLabel(entry.schedule, nowMs, ui)
                            : ui("schedule.off")}
                        </small>
                      </div>
                      <div className="task-cabinet-entry-footer">
                        <small>
                          {ui("taskCabinet.updated", {
                            value: new Date(entry.updatedAt).toLocaleDateString(),
                          })}
                        </small>
                        {entry.status === "ready" || entry.status === "failed" ? (
                          <button
                            type="button"
                            className="task-cabinet-remove"
                            disabled={!canDispatchTasks || taskCabinetRunningCount > 0}
                            onClick={() => startTaskCabinetEntry(entry.id)}
                          >
                            {entry.status === "failed"
                              ? ui("taskCabinet.rerun")
                              : ui("taskCabinet.run")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="task-cabinet-remove"
                          onClick={() => removeTaskCabinetEntry(entry.id)}
                        >
                          {ui("taskCabinet.remove")}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="task-cabinet-empty">
                  {ui("taskCabinet.empty")}
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
              <b>{agentDisplayName({ agent: launcherAgent })}</b>
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
                    placeholder={ui("launcher.directoryPlaceholder")}
                  />
                  <button
                    type="button"
                    className="path-picker-button"
                    onClick={browseLauncherDirectory}
                  >
                    {ui("launcher.browse")}
                  </button>
                </span>
                <small className="launcher-field-hint">
                  {ui("launcher.directoryHint")}
                </small>
              </label>
              <div className="launcher-agent-choice" aria-label={ui("launcher.agent")}>
                {launcherAgentDefinitions().map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    className={launcherAgent === agent.id ? "active" : ""}
                    onClick={() => setLauncherAgent(agent.id)}
                  >
                    {agent.label}
                  </button>
                ))}
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

        {SHOW_DEBUG_CARD ? (
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
                {debugStatus ? ui("debug.override") : ui("debug.live")}
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
                  onClick={() => {
                    windowPreviewHourRef.current = null;
                    setWindowPreviewHour(null);
                    setWindowTimePreview((current) => !current);
                  }}
                >
                  {ui("debug.windowPreview")}
                </button>
                <label className="window-time-control">
                  <span>
                    {ui("debug.windowTime")} {windowPreviewTimeLabel}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="23"
                    step="1"
                    value={windowPreviewDisplayHour}
                    onChange={(event) => {
                      const hour = Number(event.currentTarget.value);
                      windowPreviewHourRef.current = hour;
                      windowTimePreviewRef.current = false;
                      setWindowPreviewHour(hour);
                      setWindowTimePreview(false);
                    }}
                  />
                </label>
                <div className="window-time-presets" aria-label={ui("debug.windowTime")}>
                  {[6, 12, 18, 22].map((hour) => (
                    <button
                      key={hour}
                      type="button"
                      className={`pixel-button${windowPreviewHour === hour ? " debug-live-active" : ""}`}
                      onClick={() => {
                        windowPreviewHourRef.current = hour;
                        windowTimePreviewRef.current = false;
                        setWindowPreviewHour(hour);
                        setWindowTimePreview(false);
                      }}
                    >
                      {String(hour).padStart(2, "0")}:00
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`pixel-button${windowPreviewHour === null && !windowTimePreview ? " debug-live-active" : ""}`}
                  onClick={() => {
                    windowPreviewHourRef.current = null;
                    windowTimePreviewRef.current = false;
                    setWindowPreviewHour(null);
                    setWindowTimePreview(false);
                  }}
                >
                  {ui("debug.windowRealTime")}
                </button>
                <button
                  type="button"
                  className={`pixel-button${navDebugOverlay ? " debug-live-active" : ""}`}
                  onClick={() => setNavDebugOverlay((current) => !current)}
                >
                  {ui("debug.navGrid")}
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
        ) : null}

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
          <section ref={roomEditPanelRef} className="control-section edit-panel">
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
          <section ref={roomEditPanelRef} className="control-section edit-panel">
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
                onClick={storeSelectedWindow}
                disabled={!selectedWindowDefinition}
              >
                {ui("action.store")}
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
          <section ref={roomEditPanelRef} className="control-section edit-panel">
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
                    const surfacePurchaseCostLabel = purchased
                      ? null
                      : ui("decor.surfacePurchaseCost", { value: item.price });
                    const surfaceChangeCostLabel = ui("decor.surfaceChangeCost", {
                      value: SURFACE_APPLY_COST,
                    });
                    const surfaceCostLabel = surfacePurchaseCostLabel
                      ? `${surfacePurchaseCostLabel} ${surfaceChangeCostLabel}`
                      : surfaceChangeCostLabel;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`pixel-button decor-surface-button${applied ? " active" : ""}`}
                        disabled={applied || save.wallet.bits < surfaceActionCost}
                        title={item.name}
                        aria-label={`${item.name} ${surfaceActionLabel} ${surfaceCostLabel}`}
                        onClick={() => buyOrApplySurface(item)}
                      >
                        <span
                          className={`decor-surface-preview surface-preview-${item.id}`}
                          aria-hidden="true"
                        />
                        <span className="decor-surface-name">{item.name}</span>
                        {surfacePurchaseCostLabel ? (
                          <span className="decor-surface-cost">
                            {surfacePurchaseCostLabel}
                          </span>
                        ) : null}
                        <span className="decor-surface-cost">
                          {surfaceChangeCostLabel}
                        </span>
                        {applied || purchased ? (
                          <span className="decor-surface-state">
                            {surfaceActionLabel}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </section>

        <section className="control-section painting-gallery-panel">
          <button
            type="button"
            className="pixel-button decor-toggle-button painting-gallery-toggle-button"
            aria-expanded={paintingGalleryPanelOpen}
            onClick={() => setPaintingGalleryPanelOpen((open) => !open)}
          >
            <span>{ui("paintingGallery.title")}</span>
            <span>
              {ui("paintingGallery.count", {
                value: paintingGallery.artworks.length,
              })}
            </span>
            <span aria-hidden="true">{paintingGalleryPanelOpen ? "-" : "+"}</span>
          </button>
          {paintingGalleryPanelOpen ? (
            <>
              {paintingGallery.activeDraft ? (
                <div className="painting-draft-card">
                  <PaintingThumbnail
                    artwork={paintingGallery.activeDraft.artwork}
                    progress={paintingProgressRatio(paintingGallery.activeDraft)}
                  />
                  <div>
                    <strong>{ui("paintingGallery.inProgress")}</strong>
                    <span>
                      {Math.round(paintingProgressRatio(paintingGallery.activeDraft) * 100)}%
                    </span>
                    <meter
                      min={0}
                      max={1}
                      value={paintingProgressRatio(paintingGallery.activeDraft)}
                    />
                  </div>
                </div>
              ) : (
                <p className="painting-gallery-empty">
                  {ui("paintingGallery.noDraft")}
                </p>
              )}
              {paintingGallery.artworks.length > 0 ? (
                <div className="painting-gallery-list">
                  {paintingGallery.artworks.map((artwork) => {
                    const saleBits = Math.max(0, Math.round(artwork.saleBits ?? 0));
                    return (
                      <article
                        key={artwork.id}
                        className="painting-gallery-artwork"
                        title={artwork.title}
                        aria-label={`${artwork.title} ${ui("paintingGallery.quality", {
                          value: artwork.quality,
                        })}`}
                      >
                        <PaintingThumbnail artwork={artwork} />
                        <div className="painting-gallery-artwork-copy">
                          <span>{artwork.title}</span>
                          <small>
                            {ui("paintingGallery.quality", { value: artwork.quality })}
                          </small>
                          <small>
                            {saleBits > 0
                              ? ui("paintingGallery.saleValue", { value: saleBits })
                              : ui("paintingGallery.noSaleValue")}
                          </small>
                        </div>
                        <div className="painting-gallery-actions">
                          <button
                            type="button"
                            className="pixel-button painting-gallery-action"
                            disabled={!selectedPlacedItemCanShowPainting}
                            onClick={() => applyPaintingToSelectedHanging(artwork)}
                          >
                            {ui("action.apply")}
                          </button>
                          <button
                            type="button"
                            className="pixel-button painting-gallery-action"
                            disabled={saleBits <= 0}
                            onClick={() => sellPaintingArtwork(artwork)}
                          >
                            {saleBits > 0
                              ? ui("action.sell", { value: saleBits })
                              : ui("paintingGallery.noSaleValue")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="painting-gallery-empty">
                  {ui("paintingGallery.empty")}
                </p>
              )}
              <span className="painting-gallery-state">
                {selectedPlacedItemCanShowPainting
                  ? ui("paintingGallery.targetReady")
                  : ui("paintingGallery.targetMissing")}
              </span>
              {selectedPlacedItemCanShowPainting && selectedPlacedItem?.artworkId ? (
                <button
                  type="button"
                  className="pixel-button painting-gallery-clear"
                  onClick={clearPaintingFromSelectedHanging}
                >
                  {ui("action.clearApplied")}
                </button>
              ) : null}
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
              const furnitureSkin = isFurnitureSkinItem(item);
              const furnitureSkinTargetId = item.targetFurnitureId ?? "";
              const purchasedFurnitureSkin =
                furnitureSkin && save.purchasedItemIds.includes(item.id);
              const appliedFurnitureSkin =
                furnitureSkin &&
                save.activeFurnitureSkinIds?.[furnitureSkinTargetId] === item.id;
              const uniqueShopItemOwned = isUniqueShopItemOwned(save, item);
              const label = levelLocked
                ? `${item.name} ${ui("growth.level", { value: unlockLevel })}`
                : appliedFurnitureSkin
                  ? `${item.name} ${ui("action.clearApplied")}`
                  : purchasedFurnitureSkin
                    ? `${item.name} ${ui("action.apply")}`
                    : purchasedWindow
                      ? `${item.name} ${ui("state.owned")}`
                      : uniqueShopItemOwned
                        ? `${item.name} ${ui("state.owned")}`
                      : `${item.name} ${item.price}`;
              const buttonLabel =
                isBulkPurchasableShopItem(item) && !levelLocked && !uniqueShopItemOwned
                  ? `${label} (hold to buy up to ${SHOP_BULK_PURCHASE_QUANTITY})`
                  : label;

              return (
                <button
                  key={item.id}
                  type="button"
                  className="pixel-button shop-button"
                  disabled={
                    levelLocked ||
                    purchasedWindow ||
                    uniqueShopItemOwned ||
                    (!purchasedFurnitureSkin && save.wallet.bits < item.price)
                  }
                  aria-label={buttonLabel}
                  title={buttonLabel}
                  onPointerDown={(event) => startShopBulkPurchasePress(event, item)}
                  onPointerUp={cancelShopBulkPurchasePress}
                  onPointerLeave={cancelShopBulkPurchasePress}
                  onPointerCancel={cancelShopBulkPurchasePress}
                  onBlur={cancelShopBulkPurchasePress}
                  onClick={(event) =>
                    isWindowItem(item)
                      ? buyOrApplyWindow(item)
                      : isFurnitureSkinItem(item)
                        ? appliedFurnitureSkin
                          ? clearAppliedFurnitureSkin(item)
                          : buyOrApplyFurnitureSkin(item)
                        : clickShopItem(event, item)
                  }
                >
                  <span className="item-button-content">
                    <ItemThumbnail itemId={item.id} />
                    <span>
                      {levelLocked
                        ? ui("growth.level", { value: unlockLevel })
                        : appliedFurnitureSkin
                          ? ui("action.clearApplied")
                          : purchasedFurnitureSkin
                            ? ui("action.apply")
                            : uniqueShopItemOwned
                              ? ui("state.owned")
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
            <h2>{ui("assetStudio.title")}</h2>
            <span>{ui("assetStudio.locked")}</span>
          </div>
          <button
            type="button"
            className="pixel-button asset-editor-locked-button"
            disabled
            title={ui("assetStudio.lockedTitle")}
          >
            <span aria-hidden="true">🔒</span>
            {ui("assetStudio.inDevelopment")}
          </button>
        </section>
      </aside>
    </main>
  );
};
