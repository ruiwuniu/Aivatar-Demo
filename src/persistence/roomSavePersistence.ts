import type { AivatarSaveState, AvatarRuntime } from "../types";
import {
  createSavePersistence,
  DEFAULT_SAVE_WAIT_MS,
  jsonEqual,
  mergeSaveChanges,
  type JsonReadView,
  type JsonStorage,
} from "./savePersistence";

export const REWARDED_COMPLETION_ID_LIMIT = 256;

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
  const wallet = { ...merged.wallet };
  const localRewardIds = (local.rewardedCompletionIds ?? []).filter((id) => !(base.rewardedCompletionIds ?? []).includes(id));
  const walletChanged = local.wallet.bits !== base.wallet.bits
    || local.wallet.pokerChips !== base.wallet.pokerChips;
  if (walletChanged && localRewardIds.some((id) => (remote.rewardedCompletionIds ?? []).includes(id))) {
    throw new Error("A reward was already saved by another window. Reload the authoritative save before retrying this economic change.");
  }
  for (const field of ["bits", "pokerChips"] as const) {
    const delta = (local.wallet[field] ?? 0) - (base.wallet[field] ?? 0);
    const balance = (remote.wallet[field] ?? 0) + delta;
    // Bits can already contain valid Card Room debt. A debit may not create
    // more debt than its original local operation authorized; passive/credit
    // changes must not reject or erase existing debt.
    const minimum = field === "pokerChips" ? 0 : Math.min(0, local.wallet.bits);
    if (!Number.isFinite(balance) || (field === "pokerChips" || delta < 0) && balance < minimum) {
      throw new Error(`Concurrent ${field} spending exceeds the current balance.`);
    }
    wallet[field] = balance;
  }
  const stat = (key: keyof AivatarSaveState["petStats"]) => Math.max(0, Math.min(
    100, mergeCounter(base.petStats[key], local.petStats[key], remote.petStats[key]),
  ));
  return {
    ...merged,
    wallet,
    rewardedCompletionIds: [...new Set([...(remote.rewardedCompletionIds ?? []), ...localRewardIds])]
      .slice(-REWARDED_COMPLETION_ID_LIMIT),
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
  generation: number;
}

export const createRoomSavePersistence = (options: {
  storage: JsonStorage;
  storageKey: (slotId: string) => string;
  normalize: (value: Partial<AivatarSaveState>) => AivatarSaveState;
  runtime: (slotId: string) => AvatarRuntime | undefined;
  onPersisted: (slotId: string, save: AivatarSaveState, syncState: boolean) => void;
  onError?: (error: unknown) => void;
  onMerged?: (slotId: string, save: AivatarSaveState) => void;
  updateRegistry?: (slotId: string, save: AivatarSaveState, registryRaw: string | null) => string | null | undefined;
}) => {
  const drafts = new Map<string, RoomSaveDraft>();
  const slotsByKey = new Map<string, string>();
  const deferredExternal = new Set<string>();
  const resetCaptures = new Map<string, () => void>();
  const persistence = createSavePersistence({
    storage: options.storage,
    waitMs: DEFAULT_SAVE_WAIT_MS,
    onError: (error, key) => {
      const slotId = slotsByKey.get(key);
      if (slotId) resetCaptures.get(slotId)?.();
      options.onError?.(error);
    },
    additionalChanges: (key, snapshot, view): Record<string, string> => {
      const slotId = slotsByKey.get(key);
      if (!slotId || !options.updateRegistry) return {};
      const registryKey = "aivatar.saveSlots.v1";
      const value = options.updateRegistry(slotId, snapshot as AivatarSaveState, view.getItem(registryKey));
      return typeof value === "string" ? { [registryKey]: value } : {};
    },
  });

  const prepare = (slotId: string, draft: RoomSaveDraft, view: JsonReadView) => {
    const raw = view.getItem(options.storageKey(slotId));
    // Another window may have deleted this slot while a timer was pending.
    if (raw === null) return undefined;
    const remote = options.normalize(JSON.parse(raw) as Partial<AivatarSaveState>);
    return mergeRoomChanges(draft.base, draft.local, remote);
  };

  const persisted = (
    slotId: string,
    draft: RoomSaveDraft,
    captured: RoomSaveDraft,
    snapshot: AivatarSaveState | undefined,
    written: boolean,
  ) => {
    if (drafts.get(slotId) !== draft) return;
    if (!snapshot) {
      drafts.delete(slotId);
      return;
    }
    // Track what this window supplied, rather than treating remote additions
    // absent from React state as local deletions on the next save.
    const hasNewerChanges = draft.generation !== captured.generation;
    draft.base = captured.local;
    if (deferredExternal.delete(slotId)) {
      const raw = options.storage.getItem(options.storageKey(slotId));
      if (raw === null) {
        drafts.delete(slotId);
        persistence.cancel(options.storageKey(slotId));
        return;
      }
      const remote = options.normalize(JSON.parse(raw) as Partial<AivatarSaveState>);
      remote.avatarRuntime = captured.local.avatarRuntime;
      const merged = mergeRoomChanges(captured.local, draft.local, remote);
      draft.base = remote;
      draft.local = merged;
      options.onMerged?.(slotId, merged);
    }
    if (written) options.onPersisted(slotId, snapshot, captured.syncState && !hasNewerChanges);
  };

  const queue = (slotId: string, draft: RoomSaveDraft, immediate: boolean) => {
    const key = options.storageKey(slotId);
    slotsByKey.set(key, slotId);
    let captured: RoomSaveDraft | undefined;
    resetCaptures.set(slotId, () => { captured = undefined; });
    const snapshot = (view: JsonReadView) => {
      // Freeze once for this submission. CAS retries may read a newer remote,
      // but must never include edits that arrived after this batch began.
      captured ??= JSON.parse(JSON.stringify({
        ...draft,
        local: { ...draft.local, avatarRuntime: options.runtime(slotId) ?? draft.local.avatarRuntime },
      })) as RoomSaveDraft;
      return prepare(slotId, captured, view);
    };
    const onPersisted = (value: AivatarSaveState | undefined, written: boolean) =>
      captured && persisted(slotId, draft, captured, value, written);
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
        drafts.set(slotId, { base: saved, local, syncState: true, generation: 0 });
      }
      return local;
    },
    update(slotId: string, saved: AivatarSaveState, urgent = false) {
      const draft = drafts.get(slotId);
      if (!draft) {
        drafts.set(slotId, { base: saved, local: saved, syncState: true, generation: 0 });
        return;
      }
      if (jsonEqual(draft.local, saved)) return;
      const immediate = urgent || !jsonEqual(durableState(draft.local), durableState(saved));
      draft.local = saved;
      draft.generation += 1;
      draft.syncState = true;
      return queue(slotId, draft, immediate);
    },
    mergeExternal(slotId: string, current: AivatarSaveState) {
      if (persistence.isInFlight(options.storageKey(slotId))) {
        deferredExternal.add(slotId);
        return current;
      }
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
      draft.generation += 1;
      return jsonEqual(current, merged) ? current : merged;
    },
    flush(slotId: string, saved: AivatarSaveState, syncState = true) {
      let draft = drafts.get(slotId);
      if (!draft) {
        draft = { base: saved, local: saved, syncState, generation: 0 };
        drafts.set(slotId, draft);
      }
      draft.local = {
        ...saved,
        avatarRuntime: options.runtime(slotId) ?? saved.avatarRuntime,
      };
      draft.syncState = syncState;
      draft.generation += 1;
      return queue(slotId, draft, true)!;
    },
    flushAll() {
      return persistence.flushAll();
    },
    drain() {
      return persistence.drain();
    },
    forget(slotId: string) {
      persistence.cancel(options.storageKey(slotId));
      drafts.delete(slotId);
      deferredExternal.delete(slotId);
      resetCaptures.delete(slotId);
    },
  };
};
