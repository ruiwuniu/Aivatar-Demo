import type { AivatarSaveState, AvatarRuntime } from "../types";
import {
  createSavePersistence,
  DEFAULT_SAVE_WAIT_MS,
  jsonEqual,
  mergeSaveChanges,
} from "./savePersistence";

const mergeCounter = (base: number, local: number, remote: number) =>
  local === base ? remote
    : remote === base || local === remote ? local
      : remote + local - base;

const mergeStock = <T extends { quantity: number; capacity?: number }>(
  base: T[], local: T[], remote: T[], key: (entry: T) => string,
): T[] => {
  const before = new Map(base.map((entry) => [key(entry), entry]));
  const ours = new Map(local.map((entry) => [key(entry), entry]));
  const theirs = new Map(remote.map((entry) => [key(entry), entry]));
  const result: T[] = [];
  for (const id of new Set([...theirs.keys(), ...ours.keys()])) {
    const original = before.get(id);
    const left = ours.get(id);
    const right = theirs.get(id);
    if (jsonEqual(left, original)) {
      if (right) result.push(right);
    } else if (jsonEqual(right, original) || jsonEqual(left, right)) {
      if (left) result.push(left);
    } else {
      const entry = mergeSaveChanges(original, left, right) ?? left ?? right;
      if (!entry) continue;
      const quantity = Math.max(0, Math.min(
        entry.capacity ?? Number.MAX_SAFE_INTEGER,
        mergeCounter(original?.quantity ?? 0, left?.quantity ?? 0, right?.quantity ?? 0),
      ));
      if (quantity > 0 || (left && right)) result.push({ ...entry, quantity });
    }
  }
  return result;
};

// A passive main-room tick must not erase a park recovery, and consuming one
// item must not replace another window's entire updated inventory array.
const mergeRoomChanges = (
  base: AivatarSaveState, local: AivatarSaveState, remote: AivatarSaveState,
): AivatarSaveState => {
  const merged = mergeSaveChanges(base, local, remote);
  const stat = (key: keyof AivatarSaveState["petStats"]) => Math.max(0, Math.min(
    100, mergeCounter(base.petStats[key], local.petStats[key], remote.petStats[key]),
  ));
  return {
    ...merged,
    petStats: { energy: stat("energy"), mood: stat("mood"), hunger: stat("hunger") },
    inventory: mergeStock(base.inventory, local.inventory, remote.inventory, (entry) => entry.itemId),
    furnitureStorage: mergeStock(
      base.furnitureStorage ?? [], local.furnitureStorage ?? [], remote.furnitureStorage ?? [],
      (entry) => `${entry.furnitureId}:${entry.itemId}`,
    ),
  };
};

// Movement, passive stats and painting progress can be batched. Purchases,
// rewards, room edits and user preferences must survive immediately.
const durableState = (save: AivatarSaveState) => {
  const {
    avatarRuntime, parkRuntime, navMemory, parkNavMemory, petStats,
    memory, paintingGallery, ...durable
  } = save;
  return {
    ...durable,
    completedTurns: memory?.growth.completedTurns,
    errorCount: memory?.growth.errorCount,
    idleBubbleLanguage: memory?.preferences.idleBubbleLanguage,
    idleBubblePhrases: memory?.preferences.idleBubblePhrases,
    socialBubbles: memory?.preferences.socialBubbles,
    artworks: paintingGallery?.artworks,
    activeDraftId: paintingGallery?.activeDraft?.id,
  };
};

interface RoomSaveDraft {
  base: AivatarSaveState;
  local: AivatarSaveState;
  prepared?: AivatarSaveState;
  syncState: boolean;
}

export const createRoomSavePersistence = (options: {
  storage: Pick<Storage, "getItem" | "setItem">;
  storageKey: (slotId: string) => string;
  normalize: (value: Partial<AivatarSaveState>) => AivatarSaveState;
  runtime: (slotId: string) => AvatarRuntime | undefined;
  onPersisted: (slotId: string, save: AivatarSaveState, syncState: boolean) => void;
  onError?: (error: unknown) => void;
}) => {
  const drafts = new Map<string, RoomSaveDraft>();
  const persistence = createSavePersistence({
    storage: options.storage,
    waitMs: DEFAULT_SAVE_WAIT_MS,
    onError: options.onError,
  });

  const prepare = (slotId: string, draft: RoomSaveDraft) => {
    const raw = options.storage.getItem(options.storageKey(slotId));
    // Another window may have deleted this slot while a timer was pending.
    if (raw === null) return undefined;
    const remote = options.normalize(JSON.parse(raw) as Partial<AivatarSaveState>);
    const local = {
      ...draft.local,
      avatarRuntime: options.runtime(slotId) ?? draft.local.avatarRuntime,
    };
    draft.prepared = local;
    return mergeRoomChanges(draft.base, local, remote);
  };

  const persisted = (
    slotId: string,
    draft: RoomSaveDraft,
    snapshot: AivatarSaveState | undefined,
    written: boolean,
  ) => {
    if (!snapshot) {
      drafts.delete(slotId);
      return;
    }
    // Track what this window supplied, rather than treating remote additions
    // absent from React state as local deletions on the next save.
    draft.base = draft.prepared ?? draft.local;
    if (written) options.onPersisted(slotId, snapshot, draft.syncState);
  };

  const queue = (slotId: string, draft: RoomSaveDraft, immediate: boolean) => {
    const key = options.storageKey(slotId);
    const snapshot = () => prepare(slotId, draft);
    const onPersisted = (value: AivatarSaveState | undefined, written: boolean) =>
      persisted(slotId, draft, value, written);
    if (immediate) return persistence.flush(key, snapshot, onPersisted);
    persistence.schedule(key, snapshot, onPersisted);
  };

  return {
    activate(slotId: string, saved: AivatarSaveState) {
      const previous = drafts.get(slotId);
      const local = previous && persistence.hasPending(options.storageKey(slotId))
        ? mergeRoomChanges(previous.base, previous.local, saved)
        : saved;
      if (previous) {
        previous.base = saved;
        previous.local = local;
      } else {
        drafts.set(slotId, { base: saved, local, syncState: true });
      }
      return local;
    },
    update(slotId: string, saved: AivatarSaveState, urgent = false) {
      const draft = drafts.get(slotId);
      if (!draft) {
        drafts.set(slotId, { base: saved, local: saved, syncState: true });
        return;
      }
      if (jsonEqual(draft.local, saved)) return;
      const immediate = urgent || !jsonEqual(durableState(draft.local), durableState(saved));
      draft.local = saved;
      draft.syncState = true;
      queue(slotId, draft, immediate);
    },
    mergeExternal(slotId: string, current: AivatarSaveState) {
      const draft = drafts.get(slotId);
      const raw = options.storage.getItem(options.storageKey(slotId));
      if (raw === null) {
        persistence.cancel(options.storageKey(slotId));
        drafts.delete(slotId);
        return current;
      }
      if (!draft) return current;
      const remote = options.normalize(JSON.parse(raw) as Partial<AivatarSaveState>);
      // Each room owns its live movement. Importing another room's runtime
      // would teleport this avatar and create needless write-back traffic.
      remote.avatarRuntime = draft.base.avatarRuntime;
      const merged = mergeRoomChanges(draft.base, current, remote);
      draft.base = remote;
      draft.local = merged;
      return jsonEqual(current, merged) ? current : merged;
    },
    flush(slotId: string, saved: AivatarSaveState, syncState = true) {
      let draft = drafts.get(slotId);
      if (!draft) {
        draft = { base: saved, local: saved, syncState };
        drafts.set(slotId, draft);
      }
      draft.local = {
        ...saved,
        avatarRuntime: options.runtime(slotId) ?? saved.avatarRuntime,
      };
      draft.syncState = syncState;
      return queue(slotId, draft, true);
    },
    flushAll() {
      return persistence.flushAll();
    },
    forget(slotId: string) {
      persistence.cancel(options.storageKey(slotId));
      drafts.delete(slotId);
    },
  };
};
