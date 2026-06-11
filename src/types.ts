export type CodexStatusName =
  | "idle"
  | "thinking"
  | "executing"
  | "waiting_for_user"
  | "error"
  | "complete";

export type StatusSeverity = "info" | "warning" | "error";

export interface TokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens: number;
  contextTokens?: number;
  modelContextWindow?: number;
  source?: string;
  scope?: string;
}

export interface AivatarLearningResult {
  id: string;
  source: "llm" | "heuristic";
  summary: string;
  idleBubbleCandidates?: string[];
  traitChanges?: Partial<AivatarGrowthTraits>;
  xp?: number;
  confidence?: number;
  privacyRisk: "low" | "medium" | "high";
}

export interface CodexStatusMessage {
  agent?: string;
  sessionId?: string;
  status: CodexStatusName;
  phase?: string;
  task?: string;
  summary?: string;
  detail?: string;
  progress?: number;
  message?: string;
  severity?: StatusSeverity;
  timestamp: string;
  presenceTimestamp?: string;
  expiresAt?: string;
  connected?: boolean;
  usage?: TokenUsage;
  idleBubbleCandidates?: string[];
  learning?: AivatarLearningResult;
}

export interface AgentStatusSnapshot {
  type: "aivatar.status.snapshot";
  currentStatus: CodexStatusMessage;
  sessions: CodexStatusMessage[];
  activeSessionKey?: string | null;
  connectedSessionKey?: string | null;
  currentSessionKey?: string | null;
  timestamp: string;
}

export type StatusSource = "websocket" | "simulated";

export type BehaviorName =
  | "idle"
  | "explore"
  | "phone"
  | "fetch_task_file"
  | "carry_task_file"
  | "read_task_file"
  | "wander"
  | "sleep"
  | "interact"
  | "coffee"
  | "cola"
  | "bento"
  | "cookie"
  | "brew"
  | "relax"
  | "admire"
  | "snack"
  | "paint"
  | "play"
  | "music"
  | "thinking"
  | "coding"
  | "waiting"
  | "error"
  | "success";

export interface PetStats {
  energy: number;
  mood: number;
  hunger: number;
}

export type GrowthTrait =
  | "focus"
  | "resilience"
  | "curiosity"
  | "efficiency"
  | "creativity"
  | "warmth";

export interface AivatarGrowthTraits {
  focus: number;
  resilience: number;
  curiosity: number;
  efficiency: number;
  creativity: number;
  warmth: number;
}

export type AivatarMemoryEventType =
  | "task_complete"
  | "task_error"
  | "error_recovered"
  | "waited_for_user"
  | "session_learning"
  | "recovery_used"
  | "item_bought"
  | "item_used"
  | "level_up";

export interface AivatarMemoryEvent {
  id: string;
  type: AivatarMemoryEventType;
  timestamp: string;
  summary: string;
  agent?: string;
  sessionId?: string;
  status?: CodexStatusName;
  xp?: number;
  bits?: number;
  weightedTokens?: number;
  traitChanges?: Partial<AivatarGrowthTraits>;
  itemId?: string;
  behavior?: BehaviorName;
}

export interface AivatarGrowth {
  level: number;
  xp: number;
  totalXp: number;
  completedTurns: number;
  errorCount: number;
  errorRecoveries: number;
  waitingTurns: number;
  weightedTokensLearned: number;
  traits: AivatarGrowthTraits;
}

export type IdleBubbleLanguagePreference = "auto" | "zh" | "en" | "mixed";

export interface AivatarPreferences {
  favoriteRecovery?: "coffee" | "cola" | "bento" | "cookie" | "sleep" | "play" | "paint";
  favoriteActivity?: BehaviorName;
  idleBubbleLanguage?: IdleBubbleLanguagePreference;
  idleBubblePhrases?: string[];
  activityWeights: Partial<Record<BehaviorName, number>>;
  itemAffinities: Record<string, number>;
}

export interface AivatarMilestone {
  id: string;
  label: string;
  unlockedAt: string;
}

export interface AivatarMemory {
  recentEvents: AivatarMemoryEvent[];
  growth: AivatarGrowth;
  preferences: AivatarPreferences;
  milestones: AivatarMilestone[];
}

export interface ConsumableEffect {
  energy?: number;
  mood?: number;
  hunger?: number;
}

export type ContentTag =
  | "furniture"
  | "item"
  | "hanging"
  | "consumable"
  | "window"
  | "wall-surface"
  | "floor-surface"
  | "bed"
  | "desk"
  | "table"
  | "fridge"
  | "computer"
  | "lamp"
  | "plant"
  | "rug"
  | "game-console"
  | "coffee-machine"
  | "record-player"
  | "easel"
  | "coffee-cup"
  | "coffee-storage"
  | "file-cabinet";

export type PlacementSurface = "floor" | "furnitureTop" | "wall";

export interface ItemDefinition {
  id: string;
  name: string;
  kind: "food" | "drink" | "tool" | "decor" | "furniture" | "window";
  price: number;
  unlockLevel?: number;
  tags?: ContentTag[];
  placementSurfaces?: PlacementSurface[];
  effect?: ConsumableEffect;
  placement?: "floor" | "desktop" | "wall";
  rotatable?: boolean;
}

export interface InventoryEntry {
  itemId: string;
  quantity: number;
}

export interface PlacedItem {
  id: string;
  itemId: string;
  x: number;
  y: number;
  rotation?: number;
  surfaceFurnitureId?: string;
  surfaceOffsetX?: number;
  surfaceOffsetY?: number;
}

export interface FurniturePlacement {
  furnitureId: string;
  x: number;
  y: number;
}

export interface FurnitureStorageEntry {
  furnitureId: string;
  itemId: string;
  quantity: number;
  capacity: number;
}

export interface FurnitureDefinition {
  id: string;
  name: string;
  tags?: ContentTag[];
  placementSurfaces?: PlacementSurface[];
  zone: "bedroom" | "office" | "kitchen";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  interaction: BehaviorName;
  collision?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface RoomSurfacePalette {
  border: string;
  base: string;
  plankA: string;
  plankB: string;
  plankC: string;
  plankD: string;
  seam: string;
  highlight: string;
  grainDark: string;
  grainLight: string;
}

export interface RoomSurfaceDefinition {
  id: string;
  name: string;
  palette: RoomSurfacePalette;
}

export interface RoomWindowDefinition {
  id: string;
  name: string;
  kind: "cozy-window" | "city-night-window" | "ocean-window";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomWindowPlacement {
  windowId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export type FurnitureInteractionKind =
  | "sleep"
  | "feed"
  | "work"
  | "brew"
  | "blocked"
  | "none";

export interface FurnitureInteractionState {
  kind: FurnitureInteractionKind;
  furnitureId: string;
  furnitureName: string;
  message: string;
  startedAt: number;
  endsAt?: number;
  bubbleText?: string;
  progress?: number;
  rewardBits?: number;
}

export interface RoomDefinition {
  theme: string;
  zones: Array<"bedroom" | "office" | "kitchen">;
  furniture: FurnitureDefinition[];
  floorSurfaceId?: string;
  wallSurfaceId?: string;
  windowId?: string;
  floorSurfaces?: RoomSurfaceDefinition[];
  wallSurfaces?: RoomSurfaceDefinition[];
  windows?: RoomWindowDefinition[];
}

export interface ShopDefinition {
  currency: string;
  items: ItemDefinition[];
}

export interface AvatarDefinition {
  name: string;
  sprite: string;
}

export interface AivatarContent {
  avatar: AvatarDefinition;
  room: RoomDefinition;
  inventory: InventoryEntry[];
  placedItems?: PlacedItem[];
  itemDefinitions: ItemDefinition[];
  shop: ShopDefinition;
  petStats: PetStats;
  wallet: {
    bits: number;
  };
}

export interface AvatarRuntime {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  facing: "front" | "back" | "left" | "right";
  behavior: BehaviorName;
  behaviorTimer: number;
  expression: "calm" | "focused" | "happy" | "sleepy" | "worried";
  activityLabel?: string;
  interactionTargetAlternates?: { x: number; y: number }[];
  actionIntent?: BehaviorName;
  actionActivityLabel?: string;
  navigationFailure?: {
    behavior: BehaviorName;
    targetX: number;
    targetY: number;
    reason: "blocked" | "stalled";
  };
}

export interface AivatarNavMemory {
  exploredCells: Record<string, number>;
  trickySpots: Record<string, number>;
  walkableCells: Record<string, 0 | 1>;
  layoutFingerprint?: string;
  successes: number;
  failures: number;
  lastExploredAt?: string;
}

export interface AivatarSaveState {
  layoutVersion?: number;
  avatarId?: string;
  roomId?: string;
  avatarAppearanceId?: string;
  avatarName?: string;
  avatarRuntime?: AvatarRuntime;
  memory?: AivatarMemory;
  navMemory?: AivatarNavMemory;
  petStats: PetStats;
  inventory: InventoryEntry[];
  placedItems: PlacedItem[];
  wallet: {
    bits: number;
  };
  purchasedItemIds: string[];
  furnitureStorage?: FurnitureStorageEntry[];
  workBoostUntil?: string;
  activeWindowId?: string;
  floorSurfaceId?: string;
  wallSurfaceId?: string;
  windowPlacements?: RoomWindowPlacement[];
  furniturePlacements?: FurniturePlacement[];
}

export type TaskCabinetStatus = "ready" | "running" | "completed" | "failed";
export type TaskCabinetRunProfile = "default" | "fast";
export type TaskCabinetScheduleMode = "once" | "repeat";
export type TaskCabinetScheduleCondition =
  | "always"
  | "only_idle"
  | "after_success";

export interface TaskCabinetSchedule {
  enabled: boolean;
  mode: TaskCabinetScheduleMode;
  runAt?: string;
  intervalMinutes?: number;
  condition: TaskCabinetScheduleCondition;
  nextRunAt?: string;
  lastRunAt?: string;
}

export interface TaskCabinetEntry {
  id: string;
  path: string;
  status: TaskCabinetStatus;
  createdAt: string;
  updatedAt: string;
  agent?: string;
  cwd?: string;
  sessionId?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  runProfile?: TaskCabinetRunProfile;
  schedule?: TaskCabinetSchedule;
}

export interface PixelCell {
  x: number;
  y: number;
  color: string;
}

export interface PixelAssetFrame {
  id: string;
  pixels: PixelCell[];
}

export interface PixelAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  frames: PixelAssetFrame[];
}
