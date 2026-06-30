import type {
  AivatarDarkTraits,
  AivatarGrowthTraits,
  AvatarAppearanceId,
} from "../types";
import type { CardRoomCharacter } from "./holdemEngine";
import {
  canExchangePokerChips,
  canRedeemPokerChipsForBits,
  exchangePokerChips,
  normalizePokerChips,
  normalizeWalletBits,
  redeemPokerChipsForBits,
} from "./chipEconomy";

const SAVE_SLOTS_KEY = "aivatar.saveSlots.v1";
const ACTIVE_SAVE_SLOT_KEY = "aivatar.activeSaveSlot.v1";
const SAVE_SLOT_KEY_PREFIX = "aivatar.saveSlot.v1.";

type SaveSlotSummary = {
  id: string;
  slotIndex: number;
  avatarId?: string;
  roomId?: string;
  avatarName?: string;
  avatarAppearanceId?: string;
};

const appearanceIds: AvatarAppearanceId[] = [
  "octopus",
  "demo-spark",
  "mood-slime",
  "cute-crayfish",
  "cute-ghost",
  "cute-penguin",
  "wave-lizard",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isAppearanceId = (value: unknown): value is AvatarAppearanceId =>
  typeof value === "string" && appearanceIds.includes(value as AvatarAppearanceId);

const numberValue = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clampTrait = (value: unknown, max = 1_000_000) =>
  Math.max(0, Math.min(max, Math.round(numberValue(value))));

const normalizeGrowthTraits = (value: unknown): AivatarGrowthTraits => {
  const source = isRecord(value) ? value : {};
  return {
    focus: clampTrait(source.focus),
    resilience: clampTrait(source.resilience),
    curiosity: clampTrait(source.curiosity),
    efficiency: clampTrait(source.efficiency),
    creativity: clampTrait(source.creativity),
    warmth: clampTrait(source.warmth),
  };
};

const normalizeDarkTraits = (value: unknown): AivatarDarkTraits | null => {
  if (!isRecord(value)) return null;
  return {
    greed: clampTrait(value.greed, 100),
    foolishness: clampTrait(value.foolishness, 100),
    recklessness: clampTrait(value.recklessness, 100),
    cowardice: clampTrait(value.cowardice, 100),
    arrogance: clampTrait(value.arrogance, 100),
    coldness: clampTrait(value.coldness, 100),
  };
};

const defaultDarkTraits = (): AivatarDarkTraits => ({
  greed: 0,
  foolishness: 0,
  recklessness: 0,
  cowardice: 0,
  arrogance: 0,
  coldness: 0,
});

const applyDarkTraitChanges = (
  traits: AivatarDarkTraits,
  changes: Partial<AivatarDarkTraits>,
): AivatarDarkTraits => ({
  greed: clampTrait(traits.greed + (changes.greed ?? 0), 100),
  foolishness: clampTrait(traits.foolishness + (changes.foolishness ?? 0), 100),
  recklessness: clampTrait(traits.recklessness + (changes.recklessness ?? 0), 100),
  cowardice: clampTrait(traits.cowardice + (changes.cowardice ?? 0), 100),
  arrogance: clampTrait(traits.arrogance + (changes.arrogance ?? 0), 100),
  coldness: clampTrait(traits.coldness + (changes.coldness ?? 0), 100),
});

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const traitScale = (value: number) =>
  Math.log10(Math.max(0, value) + 1) / Math.log10(1_000_001);

const mixedPercent = (base: number, seed: number, offset: number) => {
  const jitter = ((seed >> (offset % 20)) & 31) - 15;
  return Math.max(0, Math.min(100, Math.round(base * 100 + jitter)));
};

export const deriveDarkTraits = (
  traits: AivatarGrowthTraits,
  seedText: string,
): AivatarDarkTraits => {
  const seed = hashString(seedText);
  const focus = traitScale(traits.focus);
  const resilience = traitScale(traits.resilience);
  const curiosity = traitScale(traits.curiosity);
  const efficiency = traitScale(traits.efficiency);
  const creativity = traitScale(traits.creativity);
  const warmth = traitScale(traits.warmth);

  return {
    greed: mixedPercent(0.18 + efficiency * 0.34 + curiosity * 0.18, seed, 0),
    foolishness: mixedPercent(0.18 + (1 - focus) * 0.36 + creativity * 0.1, seed, 5),
    recklessness: mixedPercent(0.14 + creativity * 0.24 + curiosity * 0.22 - resilience * 0.1, seed, 10),
    cowardice: mixedPercent(0.2 + (1 - resilience) * 0.32 + (1 - focus) * 0.08, seed, 15),
    arrogance: mixedPercent(0.16 + focus * 0.16 + creativity * 0.18 + efficiency * 0.1, seed, 3),
    coldness: mixedPercent(0.16 + (1 - warmth) * 0.34 + efficiency * 0.12, seed, 8),
  };
};

const readJson = (storageKey: string): unknown => {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const readActiveSaveSlotId = () => {
  try {
    return localStorage.getItem(ACTIVE_SAVE_SLOT_KEY);
  } catch {
    return null;
  }
};

export const readCardRoomRoster = (): CardRoomCharacter[] => {
  const rawSlots = readJson(SAVE_SLOTS_KEY);
  const slots = Array.isArray(rawSlots)
    ? rawSlots.filter(isRecord).map((slot) => slot as SaveSlotSummary)
    : [];

  return slots
    .map((slot, fallbackIndex) => {
      if (typeof slot.id !== "string" || !slot.id.trim()) return null;
      const save = readJson(`${SAVE_SLOT_KEY_PREFIX}${slot.id}`);
      const saveRecord = isRecord(save) ? save : {};
      const memory = isRecord(saveRecord.memory) ? saveRecord.memory : {};
      const wallet = isRecord(saveRecord.wallet) ? saveRecord.wallet : {};
      const growth = isRecord(memory.growth) ? memory.growth : {};
      const traits = normalizeGrowthTraits(growth.traits);
      const darkTraits =
        normalizeDarkTraits(memory.darkTraits) ??
        deriveDarkTraits(traits, `${slot.id}:${saveRecord.avatarId ?? slot.avatarId ?? ""}`);
      const avatarId =
        typeof saveRecord.avatarId === "string" && saveRecord.avatarId.trim()
          ? saveRecord.avatarId
          : typeof slot.avatarId === "string" && slot.avatarId.trim()
            ? slot.avatarId
            : `avatar-${slot.id}`;
      const avatarName =
        typeof saveRecord.avatarName === "string" && saveRecord.avatarName.trim()
          ? saveRecord.avatarName.trim()
          : typeof slot.avatarName === "string" && slot.avatarName.trim()
            ? slot.avatarName.trim()
            : `Aivatar ${fallbackIndex + 1}`;
      const appearance = isAppearanceId(saveRecord.avatarAppearanceId)
        ? saveRecord.avatarAppearanceId
        : isAppearanceId(slot.avatarAppearanceId)
          ? slot.avatarAppearanceId
          : "octopus";

      return {
        slotId: slot.id,
        slotIndex: Number.isInteger(slot.slotIndex) ? slot.slotIndex : fallbackIndex,
        avatarId,
        avatarName,
        avatarAppearanceId: appearance,
        growthLevel: Math.max(1, Math.round(numberValue(growth.level, 1))),
        walletBits: normalizeWalletBits(wallet.bits),
        pokerChips: normalizePokerChips(wallet.pokerChips),
        traits,
        darkTraits,
      } satisfies CardRoomCharacter;
    })
    .filter((entry): entry is CardRoomCharacter => Boolean(entry))
    .sort((left, right) => left.slotIndex - right.slotIndex);
};

export const writeCardRoomSaveSlotDarkTraitChanges = (
  slotId: string | null,
  changes: Partial<AivatarDarkTraits>,
) => {
  if (!slotId) return null;
  const hasChanges = Object.values(changes).some(
    (value) => typeof value === "number" && value !== 0,
  );
  if (!hasChanges) return null;

  const save = readJson(`${SAVE_SLOT_KEY_PREFIX}${slotId}`);
  if (!isRecord(save)) return null;

  const memory = isRecord(save.memory) ? save.memory : {};
  const growth = isRecord(memory.growth) ? memory.growth : {};
  const traits = normalizeGrowthTraits(growth.traits);
  const currentDarkTraits =
    normalizeDarkTraits(memory.darkTraits) ??
    deriveDarkTraits(traits, `${slotId}:${save.avatarId ?? ""}`) ??
    defaultDarkTraits();
  const nextDarkTraits = applyDarkTraitChanges(currentDarkTraits, changes);

  try {
    localStorage.setItem(
      `${SAVE_SLOT_KEY_PREFIX}${slotId}`,
      JSON.stringify({
        ...save,
        memory: {
          ...memory,
          darkTraits: nextDarkTraits,
        },
      }),
    );
    return nextDarkTraits;
  } catch {
    return null;
  }
};

export const exchangeCardRoomSaveSlotPokerChips = (
  slotId: string | null,
  pokerChipsOverride?: number,
) => {
  if (!slotId) return null;
  const save = readJson(`${SAVE_SLOT_KEY_PREFIX}${slotId}`);
  if (!isRecord(save)) return null;

  const wallet = isRecord(save.wallet) ? save.wallet : {};
  const currentWallet = {
    ...wallet,
    bits: normalizeWalletBits(wallet.bits),
    pokerChips: normalizePokerChips(pokerChipsOverride ?? wallet.pokerChips),
  };
  if (!canExchangePokerChips(currentWallet)) return null;

  const nextWallet = exchangePokerChips(currentWallet);
  const nextBits = normalizeWalletBits(nextWallet.bits);
  const nextPokerChips = normalizePokerChips(nextWallet.pokerChips);
  const spentBits = normalizeWalletBits(currentWallet.bits) - nextBits;

  try {
    localStorage.setItem(
      `${SAVE_SLOT_KEY_PREFIX}${slotId}`,
      JSON.stringify({
        ...save,
        wallet: {
          ...wallet,
          bits: nextBits,
          pokerChips: nextPokerChips,
        },
      }),
    );
    return {
      bits: nextBits,
      pokerChips: nextPokerChips,
      spentBits,
    };
  } catch {
    return null;
  }
};

export const redeemCardRoomSaveSlotPokerChipsForBits = (
  slotId: string | null,
  pokerChipsOverride?: number,
) => {
  if (!slotId) return null;
  const save = readJson(`${SAVE_SLOT_KEY_PREFIX}${slotId}`);
  if (!isRecord(save)) return null;

  const wallet = isRecord(save.wallet) ? save.wallet : {};
  const currentWallet = {
    ...wallet,
    bits: normalizeWalletBits(wallet.bits),
    pokerChips: normalizePokerChips(pokerChipsOverride ?? wallet.pokerChips),
  };
  if (!canRedeemPokerChipsForBits(currentWallet)) return null;

  const nextWallet = redeemPokerChipsForBits(currentWallet);
  const nextBits = normalizeWalletBits(nextWallet.bits);
  const nextPokerChips = normalizePokerChips(nextWallet.pokerChips);
  const redeemedBits = nextBits - normalizeWalletBits(currentWallet.bits);

  try {
    localStorage.setItem(
      `${SAVE_SLOT_KEY_PREFIX}${slotId}`,
      JSON.stringify({
        ...save,
        wallet: {
          ...wallet,
          bits: nextBits,
          pokerChips: nextPokerChips,
        },
      }),
    );
    return {
      bits: nextBits,
      pokerChips: nextPokerChips,
      redeemedBits,
    };
  } catch {
    return null;
  }
};

export const writeCardRoomSaveSlotPokerChips = (
  slotId: string | null,
  pokerChips: number,
) => {
  if (!slotId) return null;
  const save = readJson(`${SAVE_SLOT_KEY_PREFIX}${slotId}`);
  if (!isRecord(save)) return null;

  const wallet = isRecord(save.wallet) ? save.wallet : {};
  const nextPokerChips = normalizePokerChips(pokerChips);

  try {
    localStorage.setItem(
      `${SAVE_SLOT_KEY_PREFIX}${slotId}`,
      JSON.stringify({
        ...save,
        wallet: {
          ...wallet,
          bits: normalizeWalletBits(wallet.bits),
          pokerChips: nextPokerChips,
        },
      }),
    );
    return nextPokerChips;
  } catch {
    return null;
  }
};
