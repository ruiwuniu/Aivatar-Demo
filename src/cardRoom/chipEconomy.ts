export const CARD_ROOM_CHIP_BUNDLE_BITS = 20;
export const CARD_ROOM_CHIP_BUNDLE_CHIPS = 1000;
export const CARD_ROOM_BITS_DEBT_LIMIT = 500;
export const CARD_ROOM_PLAYER_CHIP_DEBT_LIMIT = 5000;
export const CARD_ROOM_DEFAULT_POKER_CHIPS = 0;

export type PokerChipWallet = {
  bits: number;
  pokerChips?: number;
};

export type PlayerChipWallet = {
  pokerChips: number;
  chipDebt?: number;
};

export type CardRoomHouseBank = {
  vaultBits: number;
  ownerBits: number;
  payoutDebtBits: number;
};

const roundFinite = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;

export const normalizePokerChips = (value: unknown) =>
  Math.max(0, roundFinite(value, CARD_ROOM_DEFAULT_POKER_CHIPS));

export const normalizeWalletBits = (value: unknown, fallback = 0) =>
  roundFinite(value, fallback);

export const normalizeHouseBits = (value: unknown, fallback = 0) =>
  roundFinite(value, fallback);

export const normalizeOwnerBits = (value: unknown) =>
  Math.max(0, normalizeHouseBits(value));

export const normalizePayoutDebtBits = (value: unknown) =>
  Math.max(0, normalizeHouseBits(value));

export const normalizeHouseBank = (value: unknown): CardRoomHouseBank => {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<CardRoomHouseBank>)
      : {};
  const rawVaultBits = normalizeHouseBits(source.vaultBits);
  return {
    vaultBits: Math.max(0, rawVaultBits),
    ownerBits: normalizeOwnerBits(source.ownerBits),
    payoutDebtBits:
      normalizePayoutDebtBits(source.payoutDebtBits) + Math.max(0, -rawVaultBits),
  };
};

export const normalizeChipDebt = (value: unknown) =>
  Math.max(0, roundFinite(value));

export const canExchangePokerChips = (wallet: PokerChipWallet, bundleCount = 1) =>
  wallet.bits - CARD_ROOM_CHIP_BUNDLE_BITS * bundleCount >= -CARD_ROOM_BITS_DEBT_LIMIT;

export const exchangePokerChips = (
  wallet: PokerChipWallet,
  bundleCount = 1,
): PokerChipWallet => {
  const count = Math.max(1, Math.round(bundleCount));
  if (!canExchangePokerChips(wallet, count)) return wallet;

  return {
    ...wallet,
    bits: wallet.bits - CARD_ROOM_CHIP_BUNDLE_BITS * count,
    pokerChips: normalizePokerChips(wallet.pokerChips) + CARD_ROOM_CHIP_BUNDLE_CHIPS * count,
  };
};

export const canRedeemPokerChipsForBits = (
  wallet: Pick<PokerChipWallet, "pokerChips">,
  bundleCount = 1,
) =>
  normalizePokerChips(wallet.pokerChips) >=
  CARD_ROOM_CHIP_BUNDLE_CHIPS * Math.max(1, Math.round(bundleCount));

export const redeemPokerChipsForBits = (
  wallet: PokerChipWallet,
  bundleCount = 1,
): PokerChipWallet => {
  const count = Math.max(1, Math.round(bundleCount));
  if (!canRedeemPokerChipsForBits(wallet, count)) return wallet;

  return {
    ...wallet,
    bits: normalizeWalletBits(wallet.bits) + CARD_ROOM_CHIP_BUNDLE_BITS * count,
    pokerChips: normalizePokerChips(wallet.pokerChips) - CARD_ROOM_CHIP_BUNDLE_CHIPS * count,
  };
};

export const addHouseVaultBits = (
  bank: CardRoomHouseBank,
  bits: number,
): CardRoomHouseBank => {
  const current = normalizeHouseBank(bank);
  const amount = normalizeHouseBits(bits);
  if (amount >= 0) {
    return {
      ...current,
      vaultBits: current.vaultBits + amount,
    };
  }

  const payout = Math.abs(amount);
  const coveredByVault = Math.min(current.vaultBits, payout);
  return {
    ...current,
    vaultBits: current.vaultBits - coveredByVault,
    payoutDebtBits: current.payoutDebtBits + (payout - coveredByVault),
  };
};

export const withdrawHouseVaultBits = (bank: CardRoomHouseBank): CardRoomHouseBank => {
  const current = normalizeHouseBank(bank);
  const withdrawable = Math.max(0, normalizeHouseBits(current.vaultBits));
  return {
    vaultBits: current.vaultBits - withdrawable,
    ownerBits: current.ownerBits + withdrawable,
    payoutDebtBits: current.payoutDebtBits,
  };
};

export const spendOwnerBits = (
  bank: CardRoomHouseBank,
  bits: number,
): CardRoomHouseBank | null => {
  const current = normalizeHouseBank(bank);
  const cost = Math.max(0, normalizeHouseBits(bits));
  if (current.ownerBits < cost) return null;
  return {
    vaultBits: current.vaultBits,
    ownerBits: current.ownerBits - cost,
    payoutDebtBits: current.payoutDebtBits,
  };
};

export const canBorrowPlayerPokerChips = (
  wallet: PlayerChipWallet,
  bundleCount = 1,
) =>
  normalizeChipDebt(wallet.chipDebt) + CARD_ROOM_CHIP_BUNDLE_CHIPS * bundleCount <=
  CARD_ROOM_PLAYER_CHIP_DEBT_LIMIT;

export const borrowPlayerPokerChips = (
  wallet: PlayerChipWallet,
  bundleCount = 1,
): PlayerChipWallet => {
  const count = Math.max(1, Math.round(bundleCount));
  if (!canBorrowPlayerPokerChips(wallet, count)) return wallet;

  return {
    pokerChips: normalizePokerChips(wallet.pokerChips) + CARD_ROOM_CHIP_BUNDLE_CHIPS * count,
    chipDebt: normalizeChipDebt(wallet.chipDebt) + CARD_ROOM_CHIP_BUNDLE_CHIPS * count,
  };
};
