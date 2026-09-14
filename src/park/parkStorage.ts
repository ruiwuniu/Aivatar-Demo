import type {
  AivatarMemory,
  AivatarNavMemory,
  AivatarSaveState,
  AvatarRuntime,
  FurnitureStorageEntry,
} from "../types";
import { DEFAULT_PARK_OBJECTS, type ParkObjectPlacement } from "./parkContent";
import { fishingRewards, type ParkRawFishId } from "./parkProbability";
import { createSavePersistence } from "../persistence/savePersistence";

export const PARK_LAYOUT_STORAGE_KEY = "aivatar.park.layout.v2";
export const PARK_LAYOUT_EVENT = "aivatar:park-layout";
export const SAVE_SLOT_KEY_PREFIX = "aivatar.saveSlot.v1.";
const FRIDGE_FISH_CAPACITY = 999;
const PARK_FISH_NAMES: Record<ParkRawFishId, string> = {
  "raw-crucian-carp": "Crucian Carp",
  "raw-bluegill": "Bluegill",
  "raw-black-bass": "Black Bass",
  "raw-yellow-perch": "Yellow Perch",
  "raw-weather-loach": "Weather Loach",
  "raw-rainbow-trout": "Rainbow Trout",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    const serialized = JSON.stringify(value);
    if (localStorage.getItem(key) !== serialized) localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
};

export const parkSaveStorageKey = (slotId: string) => `${SAVE_SLOT_KEY_PREFIX}${slotId}`;

export const defaultParkNavMemory = (): AivatarNavMemory => ({
  exploredCells: {},
  trickySpots: {},
  walkableCells: {},
  layoutFingerprint: "park-reference-v2",
  successes: 0,
  failures: 0,
});

const numberMap = (value: unknown): Record<string, number> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" && Number.isFinite(entry[1]),
        ),
      )
    : {};

const walkableMap = (value: unknown): Record<string, 0 | 1> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, 0 | 1] => entry[1] === 0 || entry[1] === 1,
        ),
      )
    : {};

export const normalizeParkNavMemory = (value: unknown): AivatarNavMemory => {
  const raw = isRecord(value) ? value : {};
  return {
    exploredCells: numberMap(raw.exploredCells),
    trickySpots: numberMap(raw.trickySpots),
    walkableCells: walkableMap(raw.walkableCells),
    layoutFingerprint: "park-reference-v2",
    successes: Math.max(0, Math.round(Number(raw.successes) || 0)),
    failures: Math.max(0, Math.round(Number(raw.failures) || 0)),
    lastExploredAt: typeof raw.lastExploredAt === "string" ? raw.lastExploredAt : undefined,
  };
};

type PendingParkSave = {
  runtime?: AvatarRuntime;
  navMemory?: AivatarNavMemory;
  moodRecovery: number;
  mutations: Array<(save: AivatarSaveState) => AivatarSaveState>;
};

const pendingParkSaves = new Map<string, PendingParkSave>();
const parkPersistence = createSavePersistence({
  storage: () => localStorage,
  waitMs: 20_000,
});

const pendingParkSave = (slotId: string) => {
  let pending = pendingParkSaves.get(slotId);
  if (!pending) {
    pending = { moodRecovery: 0, mutations: [] };
    pendingParkSaves.set(slotId, pending);
  }
  return pending;
};

// Read the current shared save at commit time. Only park-owned fields and
// queued rewards are applied, so another window's wallet edits are retained.
const mergedParkSave = (slotId: string): AivatarSaveState | undefined => {
  const raw = localStorage.getItem(parkSaveStorageKey(slotId));
  if (raw === null) return undefined;
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error("Invalid park save slot");
  let save = value as unknown as AivatarSaveState;
  const pending = pendingParkSaves.get(slotId);
  if (!pending) return save;
  if (pending.runtime) save = { ...save, parkRuntime: pending.runtime };
  if (pending.navMemory) save = { ...save, parkNavMemory: pending.navMemory };
  if (pending.moodRecovery > 0) {
    save = {
      ...save,
      petStats: {
        ...save.petStats,
        mood: Math.min(100, save.petStats.mood + pending.moodRecovery),
      },
    };
  }
  for (const mutate of pending.mutations) save = mutate(save);
  return save;
};

const queueParkSave = (slotId: string) => {
  parkPersistence.schedule(
    parkSaveStorageKey(slotId),
    () => mergedParkSave(slotId),
    () => pendingParkSaves.delete(slotId),
  );
};

export const readParkSaveSlot = (slotId: string): AivatarSaveState | null => {
  try {
    return mergedParkSave(slotId) ?? null;
  } catch {
    return null;
  }
};

export const flushParkSaveSlot = (slotId: string): AivatarSaveState | null => {
  if (!pendingParkSaves.has(slotId)) return readParkSaveSlot(slotId);
  let saved: AivatarSaveState | undefined;
  const result = parkPersistence.flush(
    parkSaveStorageKey(slotId),
    () => {
      saved = mergedParkSave(slotId);
      return saved;
    },
    () => pendingParkSaves.delete(slotId),
  );
  return result.ok ? saved ?? null : null;
};

export const mutateParkSaveSlot = (
  slotId: string,
  mutate: (save: AivatarSaveState) => AivatarSaveState,
) => {
  try {
    if (!mergedParkSave(slotId)) return null;
  } catch {
    // Keep critical rewards queued if the shared storage is temporarily
    // unreadable. A later commit will apply them to the recovered save.
  }
  pendingParkSave(slotId).mutations.push(mutate);
  return flushParkSaveSlot(slotId);
};

export const hasFishingRod = (save: AivatarSaveState | null) =>
  Boolean(save?.inventory?.some((entry) => entry.itemId === "fishing-rod" && entry.quantity > 0));

const addFridgeFish = (
  storage: FurnitureStorageEntry[] | undefined,
  fishId: ParkRawFishId,
) => {
  const existing = Array.isArray(storage) ? storage : [];
  const found = existing.find(
    (entry) => entry.furnitureId === "fridge" && entry.itemId === fishId,
  );
  if (found) {
    return existing.map((entry) =>
      entry === found
        ? { ...entry, quantity: Math.min(FRIDGE_FISH_CAPACITY, entry.quantity + 1) }
        : entry,
    );
  }
  return [
    ...existing,
    { furnitureId: "fridge", itemId: fishId, quantity: 1, capacity: FRIDGE_FISH_CAPACITY },
  ];
};

const recordCatchMemory = (
  memory: AivatarMemory | undefined,
  fishId: ParkRawFishId,
): AivatarMemory | undefined => {
  if (!memory) return memory;
  const rewards = fishingRewards();
  const now = new Date().toISOString();
  return {
    ...memory,
    recentEvents: [
      ...(memory.recentEvents ?? []),
      {
        id: `park-catch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        type: "recovery_used" as const,
        timestamp: now,
        summary: `Caught ${PARK_FISH_NAMES[fishId]} at the park`,
        itemId: fishId,
        behavior: "relax" as const,
      },
    ].slice(-80),
    growth: {
      ...memory.growth,
      traits: {
        ...memory.growth.traits,
        curiosity: Math.min(1_000_000, memory.growth.traits.curiosity + rewards.curiosity),
      },
    },
  };
};

export const recordParkCatch = (slotId: string, fishId: ParkRawFishId) =>
  mutateParkSaveSlot(slotId, (save) => {
    const rewards = fishingRewards();
    return {
      ...save,
      petStats: {
        ...save.petStats,
        mood: Math.min(100, save.petStats.mood + rewards.mood),
      },
      furnitureStorage: addFridgeFish(save.furnitureStorage, fishId),
      memory: recordCatchMemory(save.memory, fishId),
    };
  });

export const recordParkMoodRecovery = (slotId: string, mood = 1) => {
  if (!readParkSaveSlot(slotId) || !Number.isFinite(mood) || mood <= 0) return null;
  pendingParkSave(slotId).moodRecovery += mood;
  queueParkSave(slotId);
  return readParkSaveSlot(slotId);
};

export const persistParkRuntime = (
  slotId: string,
  runtime: AvatarRuntime,
  navMemory: AivatarNavMemory,
) => {
  const pending = pendingParkSave(slotId);
  pending.runtime = {
    ...runtime,
    interactionTargetAlternates: runtime.interactionTargetAlternates?.map((point) => ({ ...point })),
    navigationFailure: runtime.navigationFailure ? { ...runtime.navigationFailure } : undefined,
  };
  pending.navMemory = normalizeParkNavMemory(navMemory);
  queueParkSave(slotId);
};

const normalizePlacement = (value: unknown): ParkObjectPlacement | null => {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    !["tree", "flowers", "shrub", "rock", "bench", "lamp"].includes(String(value.kind)) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number"
  ) {
    return null;
  }
  return value as unknown as ParkObjectPlacement;
};

export const readParkLayout = (): ParkObjectPlacement[] => {
  const value = readJson(PARK_LAYOUT_STORAGE_KEY);
  if (!Array.isArray(value)) return DEFAULT_PARK_OBJECTS.map((object) => ({ ...object }));
  const placements = value
    .map(normalizePlacement)
    .filter((entry): entry is ParkObjectPlacement => Boolean(entry));
  return placements;
};

export const writeParkLayout = (placements: ParkObjectPlacement[]) => {
  const written = writeJson(PARK_LAYOUT_STORAGE_KEY, placements);
  if (written) window.dispatchEvent(new CustomEvent(PARK_LAYOUT_EVENT));
  return written;
};
