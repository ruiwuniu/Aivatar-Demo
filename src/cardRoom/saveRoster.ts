import type {
  AivatarDarkTraits,
  AivatarGrowthTraits,
  AvatarAppearanceId,
} from "../types";
import type { CardRoomCharacter, HoldemPlayer } from "./holdemEngine";
import { appStorage, transactStore } from "../persistence/saveStore";
import {
  CARD_ROOM_CHIP_BUNDLE_CHIPS,
  CARD_ROOM_CHIP_BUNDLE_BITS,
  addHouseVaultBits,
  normalizeHouseBank,
  spendOwnerBits,
  normalizeChipDebt,
  type CardRoomHouseBank,
  type PlayerChipWallet,
  cashOutPokerChipsForBits,
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
    const raw = appStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const readActiveSaveSlotId = () => {
  try {
    return appStorage.getItem(ACTIVE_SAVE_SLOT_KEY);
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

export const CARD_ROOM_PLAYER_WALLET_KEY = "aivatar.cardRoom.playerWallet.v1";
export const CARD_ROOM_HOUSE_BANK_KEY = "aivatar.cardRoom.houseBank.v1";

type StoreView = { getItem(key: string): string | null };
const readRecord = (view: StoreView, key: string): Record<string, unknown> | null => {
  const raw = view.getItem(key);
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error(`Invalid Card Room record: ${key}`);
  return parsed;
};

// The builder is deliberately pure: every CAS retry recomputes both sides from
// the latest snapshot, so a wallet transfer cannot commit only its first half.
const transactSlot = async <T>(
  slotId: string | null,
  update: (save: Record<string, unknown>, bank: CardRoomHouseBank) => {
    save: Record<string, unknown>; bank?: CardRoomHouseBank; result: T;
  } | null,
): Promise<T | null> => {
  if (!slotId) return null;
  return transactStore<T | null>((view) => {
    const key = `${SAVE_SLOT_KEY_PREFIX}${slotId}`;
    const save = readRecord(view, key);
    if (!save) return { changes: {}, result: null };
    const bank = normalizeHouseBank(readRecord(view, CARD_ROOM_HOUSE_BANK_KEY));
    const next = update(save, bank);
    if (!next) return { changes: {}, result: null };
    const changes: Record<string, string | null> = { [key]: JSON.stringify(next.save) };
    if (next.bank) changes[CARD_ROOM_HOUSE_BANK_KEY] = JSON.stringify(next.bank);
    return { changes, result: next.result };
  });
};

export const writeCardRoomSaveSlotDarkTraitChanges = async (
  slotId: string | null,
  changes: Partial<AivatarDarkTraits>,
): Promise<AivatarDarkTraits | null> => {
  if (!Object.values(changes).some((value) => typeof value === "number" && value !== 0)) return null;
  return transactSlot(slotId, (save) => {
    const memory = isRecord(save.memory) ? save.memory : {};
    const growth = isRecord(memory.growth) ? memory.growth : {};
    const traits = normalizeGrowthTraits(growth.traits);
    const current = normalizeDarkTraits(memory.darkTraits)
      ?? deriveDarkTraits(traits, `${slotId}:${save.avatarId ?? ""}`)
      ?? defaultDarkTraits();
    const next = applyDarkTraitChanges(current, changes);
    return { save: { ...save, memory: { ...memory, darkTraits: next } }, result: next };
  });
};

const walletForSave = (save: Record<string, unknown>) => {
  const wallet = isRecord(save.wallet) ? save.wallet : {};
  return { ...wallet, bits: normalizeWalletBits(wallet.bits), pokerChips: normalizePokerChips(wallet.pokerChips) };
};

export const exchangeCardRoomSaveSlotPokerChips = async (slotId: string | null) =>
  transactSlot(slotId, (save, bank) => {
    const wallet = walletForSave(save);
    if (!canExchangePokerChips(wallet)) return null;
    const next = exchangePokerChips(wallet);
    const spentBits = wallet.bits - next.bits;
    const nextBank = addHouseVaultBits(bank, spentBits);
    return {
      save: { ...save, wallet: next }, bank: nextBank,
      result: { bits: next.bits, pokerChips: normalizePokerChips(next.pokerChips), spentBits, bank: nextBank },
    };
  });

export const redeemCardRoomSaveSlotPokerChipsForBits = async (slotId: string | null) =>
  transactSlot(slotId, (save, bank) => {
    const wallet = walletForSave(save);
    if (!canRedeemPokerChipsForBits(wallet)) return null;
    const next = redeemPokerChipsForBits(wallet);
    const redeemedBits = next.bits - wallet.bits;
    const nextBank = addHouseVaultBits(bank, -redeemedBits);
    return {
      save: { ...save, wallet: next }, bank: nextBank,
      result: { bits: next.bits, pokerChips: normalizePokerChips(next.pokerChips), redeemedBits, bank: nextBank },
    };
  });

export const giftCardRoomSaveSlotPokerChips = async (
  slotId: string | null,
  chips = CARD_ROOM_CHIP_BUNDLE_CHIPS,
) => transactSlot(slotId, (save, bank) => {
  const giftedChips = normalizePokerChips(chips);
  if (giftedChips <= 0) return null;
  const nextBank = spendOwnerBits(bank, CARD_ROOM_CHIP_BUNDLE_BITS);
  if (!nextBank) return null;
  const wallet = walletForSave(save);
  const next = { ...wallet, pokerChips: wallet.pokerChips + giftedChips };
  return {
    save: { ...save, wallet: next }, bank: nextBank,
    result: { ...next, giftedChips, bank: nextBank },
  };
});

export const cashOutCardRoomSaveSlotPokerChips = async (slotId: string | null) =>
  transactSlot(slotId, (save, bank) => {
    const wallet = walletForSave(save);
    const next = cashOutPokerChipsForBits(wallet);
    if (next.redeemedBits <= 0 || next.cashedOutChips <= 0) return null;
    const nextBank = addHouseVaultBits(bank, -next.redeemedBits);
    return {
      save: { ...save, wallet: { ...wallet, bits: next.bits, pokerChips: next.pokerChips } },
      bank: nextBank, result: { ...next, bank: nextBank },
    };
  });

export type CardRoomSaveSlotPokerChipsWriteResult = {
  ok: boolean; written: boolean; skipped: boolean; pokerChips: number | null;
};

// Explicit stack assignment retained for callers that intentionally set a value.
// Live table settlement uses deltas below, never this absolute-value operation.
export const writeCardRoomSaveSlotPokerChipsResult = async (
  slotId: string | null, pokerChips: number,
): Promise<CardRoomSaveSlotPokerChipsWriteResult> => {
  if (!slotId) return { ok: true, written: false, skipped: true, pokerChips: null };
  try {
    const result = await transactSlot(slotId, (save) => {
      const nextPokerChips = normalizePokerChips(pokerChips);
      const next = { ...save, wallet: { ...walletForSave(save), pokerChips: nextPokerChips } };
      return { save: next, result: {
        ok: true, written: JSON.stringify(save) !== JSON.stringify(next),
        skipped: false, pokerChips: nextPokerChips,
      } };
    });
    return result ?? { ok: true, written: false, skipped: true, pokerChips: null };
  } catch {
    return { ok: false, written: false, skipped: false, pokerChips: null };
  }
};

export const writeCardRoomSaveSlotPokerChips = async (slotId: string | null, pokerChips: number) => {
  const result = await writeCardRoomSaveSlotPokerChipsResult(slotId, pokerChips);
  return result.ok && !result.skipped ? result.pokerChips : null;
};

export const settleCardRoomTable = async (
  players: readonly HoldemPlayer[], before: readonly HoldemPlayer[],
): Promise<void> => {
  const previous = new Map(before.map((player) => [player.avatarId, player.stack]));
  // Freeze the submitted delta outside the retry callback. Remote updates are
  // added to, while this table's change is applied exactly once on commit.
  const deltas = players.map((player) => ({
    player, delta: player.stack - (previous.get(player.avatarId) ?? player.pokerChips),
  })).filter(({ delta }) => delta !== 0);
  if (!deltas.length) return;
  await transactStore((view) => {
    const changes: Record<string, string | null> = {};
    for (const { player, delta } of deltas) {
      const key = player.isUser ? CARD_ROOM_PLAYER_WALLET_KEY : `${SAVE_SLOT_KEY_PREFIX}${player.slotId}`;
      const save = readRecord(view, key);
      if (!player.isUser && !save) throw new Error("A table participant's save was deleted. Settlement was not committed.");
      const wallet = player.isUser ? (save ?? {}) : walletForSave(save!);
      const pokerChips = normalizePokerChips(wallet.pokerChips) + delta;
      if (pokerChips < 0) throw new Error("Chips changed in another window. Settlement was not committed.");
      const nextWallet = { ...wallet, pokerChips };
      changes[key] = JSON.stringify(player.isUser
        ? { ...nextWallet, chipDebt: normalizeChipDebt((wallet as Record<string, unknown>).chipDebt) } satisfies PlayerChipWallet
        : { ...save, wallet: nextWallet });
    }
    return { changes, result: undefined };
  });
};
