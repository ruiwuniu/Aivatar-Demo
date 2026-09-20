// This is the only desktop path allowed to inspect legacy browser storage.
// It runs before any view mounts, only when the native store is uninitialized.
export const LEGACY_KEYS = [
  "aivatar.save.v1", "aivatar.saveSlots.v1", "aivatar.activeSaveSlot.v1",
  "aivatar.defaultLayout.v1", "aivatar.taskCabinet.v1", "aivatar.uiTheme.v1",
  "aivatar.audioVolume.v1", "aivatar.gameConsoleVolume.v1", "aivatar.startupSound.v1",
  "aivatar.bgmVolume.v1", "aivatar.bgmTrack.v1", "aivatar.autoMusic.v1",
  "aivatar.alwaysOnTop.v1", "aivatar.locale.v1", "aivatar.parkAmbientVolume.v1",
  "aivatar.park.layout.v2", "aivatar.assetEditor.v1", "aivatar.cardRoom.playerWallet.v1",
  "aivatar.cardRoom.houseBank.v1", "aivatar.cardRoom.decor.v1",
] as const;
export const LEGACY_PREFIXES = [
  "aivatar.saveSlot.v1.", "aivatar.roomVisitPairCooldown.v1.",
  "aivatar.socialRelationship.v1.", "aivatar.socialRoomMemory.v1.",
  "aivatar.cardRoom.playerName.v1.", "aivatar.cardRoom.navMemory.v1.",
] as const;
export const isAppStorageKey = (key: string) =>
  (LEGACY_KEYS as readonly string[]).includes(key)
  || LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix) && key.length > prefix.length);

const SLOTS = "aivatar.saveSlots.v1";
const SLOT = "aivatar.saveSlot.v1.";
const ACTIVE = "aivatar.activeSaveSlot.v1";
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = (key: string, detail: string): never => {
  throw new Error(`Cannot migrate ${key}: ${detail}. The original data has been retained.`);
};
const parse = (raw: string, key: string): unknown => {
  try { return JSON.parse(raw); } catch { return invalid(key, "invalid JSON"); }
};
const amount = (value: unknown, key: string, field: string, signed = false) => {
  if (value !== undefined && (!Number.isSafeInteger(value)
    || (!signed && (value as number) < 0))) invalid(key, `invalid ${field}`);
};
const objectField = (value: unknown, key: string, field: string) => {
  if (value === undefined) return undefined;
  if (!record(value)) return invalid(key, `invalid ${field}`);
  return value;
};
const stringList = (value: unknown, key: string, field: string) => {
  if (value !== undefined && (!Array.isArray(value)
    || value.some((item) => typeof item !== "string"))) invalid(key, `invalid ${field}`);
};
const finiteNumber = (value: unknown, key: string, field: string) => {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) invalid(key, `invalid ${field}`);
};
export const validateSaveValue = (value: unknown, key: string) => {
  if (!record(value) || !["avatarId", "roomId", "petStats", "inventory", "wallet", "memory"]
    .some((field) => field in value)) return invalid(key, "unrecognized save");
  for (const field of ["avatarId", "roomId"]) {
    if (value[field] !== undefined && (typeof value[field] !== "string"
      || !(value[field] as string).trim())) invalid(key, `invalid ${field}`);
  }
  if (value.wallet !== undefined) {
    if (!record(value.wallet)) return invalid(key, "invalid wallet");
    // The existing card economy permits bits debt. Preserve it without clamping.
    amount(value.wallet.bits, key, "wallet.bits", true);
    amount(value.wallet.pokerChips, key, "wallet.pokerChips");
  }
  for (const field of ["inventory", "placedItems"]) {
    if (value[field] !== undefined && !Array.isArray(value[field])) invalid(key, `invalid ${field}`);
  }
  for (const field of ["purchasedItemIds", "rewardedCompletionIds"]) stringList(value[field], key, field);
  const memory = objectField(value.memory, key, "memory");
  if (memory) {
    const growth = objectField(memory.growth, key, "memory.growth");
    const traits = objectField(growth?.traits, key, "memory.growth.traits");
    const darkTraits = objectField(memory.darkTraits, key, "memory.darkTraits");
    const preferences = objectField(memory.preferences, key, "memory.preferences");
    for (const field of ["level", "xp", "totalXp", "completedTurns", "errorCount", "errorRecoveries", "waitingTurns", "weightedTokensLearned"]) {
      finiteNumber(growth?.[field], key, `memory.growth.${field}`);
    }
    for (const [field, values] of [["growth.traits", traits], ["darkTraits", darkTraits],
      ["preferences.activityWeights", objectField(preferences?.activityWeights, key, "memory.preferences.activityWeights")],
      ["preferences.itemAffinities", objectField(preferences?.itemAffinities, key, "memory.preferences.itemAffinities")]] as const) {
      for (const [name, number] of Object.entries(values ?? {})) finiteNumber(number, key, `memory.${field}.${name}`);
    }
    stringList(preferences?.idleBubblePhrases, key, "memory.preferences.idleBubblePhrases");
    for (const field of ["recentEvents", "milestones"]) {
      const list = memory[field];
      if (list === undefined) continue;
      if (!Array.isArray(list)) return invalid(key, `invalid memory.${field}`);
      for (const entry of list) {
        if (!record(entry) || typeof entry.id !== "string") return invalid(key, `invalid memory.${field} entry`);
        for (const name of ["type", "timestamp", "summary", "label", "unlockedAt"]) {
          if (entry[name] !== undefined && typeof entry[name] !== "string") invalid(key, `invalid memory.${field}.${name}`);
        }
      }
    }
  }
  if (value.petStats !== undefined) {
    if (!record(value.petStats)) return invalid(key, "invalid petStats");
    for (const field of ["energy", "mood", "hunger"]) {
      const stat = value.petStats[field];
      if (stat !== undefined && (typeof stat !== "number" || !Number.isFinite(stat)
        || stat < 0 || stat > 100)) invalid(key, `invalid petStats.${field}`);
    }
  }
  if (Array.isArray(value.inventory)) {
    for (const item of value.inventory) {
      if (!record(item) || typeof item.itemId !== "string" || !item.itemId
        || !Number.isSafeInteger(item.quantity) || (item.quantity as number) < 0) invalid(key, "invalid inventory entry");
    }
  }
  if (Array.isArray(value.placedItems)) {
    for (const item of value.placedItems) {
      if (!record(item) || typeof item.id !== "string" || typeof item.itemId !== "string"
        || typeof item.x !== "number" || !Number.isFinite(item.x)
        || typeof item.y !== "number" || !Number.isFinite(item.y)) invalid(key, "invalid placed item");
    }
  }
  return value;
};

export const collectLegacyEntries = (storage: Pick<Storage, "length" | "key" | "getItem">) => {
  const entries: Record<string, string> = Object.create(null);
  // Enumerate names to retain orphaned slots as well as the visible registry.
  // A throwing storage getter is an error, never an empty new installation.
  const keys = new Set<string>(LEGACY_KEYS);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isAppStorageKey(key)) keys.add(key);
  }
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (raw !== null) entries[key] = raw;
  }
  return entries;
};

export const prepareLegacyMigration = (
  rawEntries: Record<string, string>,
  newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`,
  now = new Date().toISOString(),
) => {
  const entries = { ...rawEntries };
  for (const [key, raw] of Object.entries(entries)) {
    if (!isAppStorageKey(key)) invalid(key, "unknown key");
    if (key === "aivatar.save.v1" || key.startsWith(SLOT)) validateSaveValue(parse(raw, key), key);
    if (key === "aivatar.cardRoom.playerWallet.v1" || key === "aivatar.cardRoom.houseBank.v1") {
      const value = parse(raw, key);
      if (!record(value)) invalid(key, "invalid economy state");
      const fields = key.includes("playerWallet") ? ["pokerChips", "chipDebt"]
        : ["vaultBits", "ownerBits", "payoutDebtBits"];
      for (const field of fields) amount((value as Record<string, unknown>)[field], key, field, field === "vaultBits");
    }
  }
  const parsedSlots = entries[SLOTS] === undefined ? [] : parse(entries[SLOTS], SLOTS);
  if (!Array.isArray(parsedSlots)) return invalid(SLOTS, "expected slot list");
  const slots = parsedSlots as Record<string, unknown>[];
  const ids = new Set<string>();
  const indexes = new Set<number>();
  for (const slot of slots) {
    if (!record(slot) || typeof slot.id !== "string" || !slot.id.trim()
      || typeof slot.avatarId !== "string" || !slot.avatarId.trim()
      || typeof slot.roomId !== "string" || !slot.roomId.trim()
      || !Number.isInteger(slot.slotIndex) || (slot.slotIndex as number) < 0
      || (slot.slotIndex as number) >= 8 || indexes.has(slot.slotIndex as number)
      || ids.has(slot.id)) invalid(SLOTS, "invalid or duplicate slot");
    const id = slot.id as string;
    if (entries[SLOT + id] === undefined) invalid(SLOTS, `missing slot ${id}`);
    const saved = parse(entries[SLOT + id], SLOT + id) as Record<string, unknown>;
    for (const field of ["avatarId", "roomId"]) {
      if (saved[field] !== undefined && saved[field] !== slot[field]) invalid(SLOTS, `slot ${id} has mismatched ${field}`);
    }
    ids.add(id);
    indexes.add(slot.slotIndex as number);
  }
  if (!slots.length && entries["aivatar.save.v1"] !== undefined) {
    const save = { ...validateSaveValue(parse(entries["aivatar.save.v1"], "aivatar.save.v1"), "aivatar.save.v1") };
    const id = newId("slot");
    save.avatarId = typeof save.avatarId === "string" && save.avatarId ? save.avatarId : newId("avatar");
    save.roomId = typeof save.roomId === "string" && save.roomId ? save.roomId : newId("room");
    entries[SLOT + id] = JSON.stringify(save);
    slots.push({ id, slotIndex: 0, avatarId: save.avatarId, roomId: save.roomId,
      avatarName: typeof save.avatarName === "string" && save.avatarName.trim() ? save.avatarName.trim() : "Codex",
      avatarAppearanceId: save.avatarAppearanceId ?? "octopus", createdAt: now, updatedAt: now });
    entries[ACTIVE] = id;
  }
  if (slots.length || entries[SLOTS] !== undefined) entries[SLOTS] = JSON.stringify(slots);
  if (entries[ACTIVE] !== undefined && !slots.some((slot) => slot.id === entries[ACTIVE])) {
    invalid(ACTIVE, "active slot is not in the registry");
  }
  return { entries, rawEntries: { ...rawEntries } };
};
