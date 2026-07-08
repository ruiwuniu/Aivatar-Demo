import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LOCALE_KEY, localeOptions, resolveInitialLocale, t, type Locale } from "../i18n";
import type {
  AivatarDarkTraits,
  AivatarRoomPresence,
  AivatarRoomsSnapshot,
  AivatarVisitSession,
  AvatarRuntime,
} from "../types";
import {
  createVisitId,
  normalizeRoomPresence,
  normalizeVisitSession,
  roomVisitExpiresAt,
  roomVisitNowIso,
} from "../game/roomVisits";
import type {
  CardRoomCharacter,
  HoldemPlayer,
  HoldemTableState,
  PlayingCard,
} from "./holdemEngine";
import {
  applyHoldemAction,
  createHoldemPlayers,
  creditAvailable,
  emptyHoldemTable,
  legalActionsForActivePlayer,
  startHoldemHand,
} from "./holdemEngine";
import { choosePokerAiMove, describePokerTemperament } from "./pokerAi";
import {
  cashOutCardRoomSaveSlotPokerChips,
  exchangeCardRoomSaveSlotPokerChips,
  giftCardRoomSaveSlotPokerChips,
  readActiveSaveSlotId,
  readCardRoomRoster,
  redeemCardRoomSaveSlotPokerChipsForBits,
  writeCardRoomSaveSlotDarkTraitChanges,
  writeCardRoomSaveSlotPokerChips,
} from "./saveRoster";
import {
  CARD_ROOM_BITS_DEBT_LIMIT,
  CARD_ROOM_AUTO_CASH_OUT_RATE,
  CARD_ROOM_CHIP_BUNDLE_BITS,
  CARD_ROOM_CHIP_BUNDLE_CHIPS,
  CARD_ROOM_DEFAULT_POKER_CHIPS,
  CARD_ROOM_PLAYER_CHIP_DEBT_LIMIT,
  addHouseVaultBits,
  borrowPlayerPokerChips,
  canBorrowPlayerPokerChips,
  canExchangePokerChips,
  canRedeemPokerChipsForBits,
  normalizeHouseBank,
  normalizeChipDebt,
  normalizeHouseBits,
  normalizeOwnerBits,
  normalizePayoutDebtBits,
  normalizePokerChips,
  settleHouseBankDebt,
  spendOwnerBits,
  withdrawHouseVaultBits,
  type CardRoomHouseBank,
  type PlayerChipWallet,
} from "./chipEconomy";
import {
  compactCards,
  drawPlayingCard,
  renderCardRoom,
  type CardRoomTableMotion,
} from "./cardRoomRenderer";
import {
  CARD_ROOM_DECOR_STORAGE_KEY,
  buildCardRoomContentWithDecor,
  cardRoomDefaultDecorState,
  cardRoomShopCategories,
  cardRoomShopItemsForLocale,
  normalizeCardRoomDecorState,
  type CardRoomDecorCategory,
  type CardRoomDecorState,
  type CardRoomShopItem,
} from "./cardRoomContent";
import {
  advanceCardRoomVisitorState,
  cardRoomNavigationScopeKey,
  createCardRoomNavigationMemory,
  createInitialCardRoomVisitorState,
  type CardRoomActionCue,
  type CardRoomCopy,
  type CardRoomVisitorState,
} from "./cardRoomRuntime";

const MAX_COMPANIONS = 7;
const ROOM_SEAT_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7];
const USER_PLAYER_SLOT_ID = "card-room-user";
const USER_PLAYER_AVATAR_ID = "card-room-user";
const PLAYER_WALLET_STORAGE_KEY = "aivatar.cardRoom.playerWallet.v1";
const HOUSE_BANK_STORAGE_KEY = "aivatar.cardRoom.houseBank.v1";
const USER_HAND_CARD_SCALE = 1.2;
const USER_HAND_CARD_FACE_SCALE = 0.86;
const USER_HAND_CARD_CANVAS_WIDTH = Math.ceil(42 * USER_HAND_CARD_SCALE + 5 * USER_HAND_CARD_SCALE);
const USER_HAND_CARD_CANVAS_HEIGHT = Math.ceil(58 * USER_HAND_CARD_SCALE + 6 * USER_HAND_CARD_SCALE);
const USER_HAND_CARD_OFFSET_X = 1.5 * USER_HAND_CARD_SCALE;
const USER_HAND_CARD_OFFSET_Y = 1.5 * USER_HAND_CARD_SCALE;
const MIN_WAGER_TARGET = 1;
const CARD_ROOM_ROOMS_URL = "http://127.0.0.1:38988/rooms";
const CARD_ROOM_VISIT_INVITE_URL = "http://127.0.0.1:38988/visits/invite";
const CARD_ROOM_VISIT_STATE_URL = "http://127.0.0.1:38988/visits/state";
const CARD_ROOM_VISIT_END_URL = "http://127.0.0.1:38988/visits/end";
const CARD_ROOM_PRESENCE_SYNC_MS = 1500;
const CARD_ROOM_VISIT_TTL_MS = 8000;
const CARD_ROOM_CHIP_FLIGHT_KEEPALIVE_MS = 1400;
const CARD_ROOM_POT_COLLECTION_FLIGHT_KEEPALIVE_MS = 4600;
const CARD_ROOM_POT_COLLECTION_FLIGHT_START_DELAY_MS = 120;
const CARD_ROOM_POT_COLLECTION_TO_PAYOUT_DELAY_MS = 1500;
const CARD_ROOM_PAYOUT_FLIGHT_KEEPALIVE_MS = 2600;
const CARD_ROOM_CLOCK_MAIN_MS = 25000;
const CARD_ROOM_CLOCK_COUNTDOWN_MS = 5000;
const CARD_ROOM_CLOCK_TOTAL_MS = CARD_ROOM_CLOCK_MAIN_MS + CARD_ROOM_CLOCK_COUNTDOWN_MS;
const CARD_ROOM_CLOCK_TICK_MS = 250;
const CARD_ROOM_HAND_DEAL_INITIAL_DELAY_MS = 480;
const CARD_ROOM_HAND_DEAL_STAGGER_MS = 90;
const CARD_ROOM_HAND_DEAL_TRAVEL_MS = 360;
const CARD_ROOM_HAND_DEAL_FACE_REVEAL_PROGRESS = 0.82;
const CARD_ROOM_AUDIO_VOLUME_KEY = "aivatar.audioVolume.v1";
const CARD_ROOM_DEFAULT_AUDIO_VOLUME = 0.45;
const CARD_ROOM_DEAL_CARD_AUDIO_SRC = "/audio/card-room-card-deal.mp3";
const CARD_ROOM_DEAL_CARD_AUDIO_VOLUME_MULTIPLIER = 0.55;
const CARD_ROOM_DEAL_CARD_AUDIO_LATE_WINDOW_MS = 260;
const CARD_ROOM_FOLD_AUDIO_SRC = "/audio/card-room-fold.mp3";
const CARD_ROOM_FOLD_AUDIO_POOL_SIZE = 4;
const CARD_ROOM_FOLD_AUDIO_VOLUME_MULTIPLIER = 0.5;
const CARD_ROOM_CHECK_AUDIO_SRC = "/audio/card-room-check.wav";
const CARD_ROOM_CHECK_AUDIO_POOL_SIZE = 4;
const CARD_ROOM_CHECK_AUDIO_VOLUME_MULTIPLIER = 0.42;
const CARD_ROOM_CHIP_BET_AUDIO_SRCS = [
  "/audio/card-room-chip-bet-1.mp3",
  "/audio/card-room-chip-bet-2.mp3",
  "/audio/card-room-chip-bet-3.mp3",
] as const;
const CARD_ROOM_CHIP_BET_AUDIO_POOL_SIZE = 9;
const CARD_ROOM_CHIP_BET_AUDIO_VOLUME_MULTIPLIER = 0.5;
const CARD_ROOM_CHIP_ALL_IN_AUDIO_SRC = "/audio/card-room-chip-all-in.mp3";
const CARD_ROOM_CHIP_ALL_IN_AUDIO_POOL_SIZE = 3;
const CARD_ROOM_CHIP_ALL_IN_AUDIO_VOLUME_MULTIPLIER = 0.68;
const CARD_ROOM_CHIP_PAYOUT_AUDIO_SRC = "/audio/card-room-chip-payout.mp3";
const CARD_ROOM_CHIP_PAYOUT_AUDIO_POOL_SIZE = 4;
const CARD_ROOM_CHIP_PAYOUT_AUDIO_VOLUME_MULTIPLIER = 0.62;
const CARD_ROOM_CHIP_AUDIO_LATE_WINDOW_MS = 320;
const CARD_ROOM_CHIP_SETTLEMENT_AUDIO_LATE_WINDOW_MS = 500;
const CARD_ROOM_USER_WIN_AUDIO_SRC = "/audio/card-room-user-win.mp3";
const CARD_ROOM_USER_WIN_AUDIO_POOL_SIZE = 2;
const CARD_ROOM_USER_WIN_AUDIO_VOLUME_MULTIPLIER = 0.72;
const CARD_ROOM_USER_WIN_AUDIO_LATE_WINDOW_MS = 900;
const CARD_ROOM_CHARACTER_WIN_AUDIO_SRCS = [
  "/audio/card-room-character-win-1.mp3",
  "/audio/card-room-character-win-2.mp3",
  "/audio/card-room-character-win-3.mp3",
] as const;
const CARD_ROOM_CHARACTER_WIN_AUDIO_VOLUME_MULTIPLIER = 0.56;
const CARD_ROOM_CHARACTER_WIN_AUDIO_LATE_WINDOW_MS = 900;
const CARD_ROOM_COMMUNITY_CARD_REVEAL_STAGGER_MS = 130;

type CardRoomChipActionType = NonNullable<
  CardRoomTableMotion["chipFlights"][number]["actionType"]
>;

type CardRoomHandDarkStats = {
  handNumber: number;
  avatarId: string;
  startStack: number;
  startedAfterLoss: boolean;
  bets: number;
  raises: number;
  allIns: number;
  calls: number;
  folds: number;
  chaseActions: number;
  largePressureActions: number;
};

type CardRoomCalledClock = {
  handNumber: number;
  actionSerial: number;
  seatIndex: number;
  avatarName: string;
  startedAt: number;
  deadlineAt: number;
};

const queryValue = (key: string) => {
  try {
    return new URLSearchParams(window.location.search).get(key)?.trim() ?? null;
  } catch {
    return null;
  }
};

const initialHostSlotId = () => queryValue("hostSlotId") ?? readActiveSaveSlotId();

const initialVictoryDemoEnabled = () => queryValue("victoryDemo") === "1";

const playerNameStorageKey = (slotId: string | null) =>
  `aivatar.cardRoom.playerName.v1.${slotId ?? "preview"}`;

const readPlayerChipWallet = (): PlayerChipWallet => {
  try {
    const raw = localStorage.getItem(PLAYER_WALLET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const source =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Partial<PlayerChipWallet>)
        : {};
    return {
      pokerChips: normalizePokerChips(source.pokerChips),
      chipDebt: normalizeChipDebt(source.chipDebt),
    };
  } catch {
    return {
      pokerChips: CARD_ROOM_DEFAULT_POKER_CHIPS,
      chipDebt: 0,
    };
  }
};

const writePlayerChipWallet = (wallet: PlayerChipWallet) => {
  const nextWallet = {
    pokerChips: normalizePokerChips(wallet.pokerChips),
    chipDebt: normalizeChipDebt(wallet.chipDebt),
  };
  try {
    localStorage.setItem(PLAYER_WALLET_STORAGE_KEY, JSON.stringify(nextWallet));
  } catch {
    // Ignore storage failures in webviews with restricted persistence.
  }
  return nextWallet;
};

const readHouseBank = (): CardRoomHouseBank => {
  try {
    const raw = localStorage.getItem(HOUSE_BANK_STORAGE_KEY);
    return normalizeHouseBank(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeHouseBank(null);
  }
};

const writeHouseBank = (bank: CardRoomHouseBank) => {
  const nextBank = normalizeHouseBank(bank);
  try {
    localStorage.setItem(HOUSE_BANK_STORAGE_KEY, JSON.stringify(nextBank));
  } catch {
    // Ignore storage failures in webviews with restricted persistence.
  }
  return nextBank;
};

const createCardRoomInstanceId = () =>
  `card-room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const createCardRoomPresence = (
  roomInstanceId: string,
  hostSlotId: string | null,
): AivatarRoomPresence => ({
  type: "aivatar.room.presence",
  roomInstanceId,
  slotId: `card-room-${hostSlotId ?? "preview"}`,
  slotIndex: 0,
  avatarId: `card-room-${hostSlotId ?? "preview"}`,
  avatarName: "Card Room",
  avatarAppearanceId: "octopus",
  roomId: "card-room",
  status: "hosting",
  currentVisitId: null,
  updatedAt: roomVisitNowIso(),
  expiresAt: roomVisitExpiresAt(CARD_ROOM_VISIT_TTL_MS),
  growthLevel: 1,
  traits: {
    focus: 0,
    resilience: 0,
    curiosity: 0,
    efficiency: 0,
    creativity: 0,
    warmth: 0,
  },
  idleBubblePhrases: [],
  petStats: {
    energy: 100,
    mood: 100,
    hunger: 100,
  },
});

const postCardRoomJson = async (
  url: string,
  payload: unknown,
  options: { keepalive?: boolean } = {},
) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: options.keepalive,
  });
  if (!response.ok) {
    throw new Error(`Card room bridge request failed: ${response.status}`);
  }
  return response.json() as Promise<unknown>;
};

const normalizeCardRoomSnapshot = (value: unknown): AivatarRoomsSnapshot => {
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

const readCardRoomDecorState = (): CardRoomDecorState => {
  try {
    const raw = localStorage.getItem(CARD_ROOM_DECOR_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeCardRoomDecorState(
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Partial<CardRoomDecorState>)
        : null,
    );
  } catch {
    return normalizeCardRoomDecorState(cardRoomDefaultDecorState);
  }
};

const writeCardRoomDecorState = (decor: CardRoomDecorState) => {
  const nextDecor = normalizeCardRoomDecorState(decor);
  try {
    localStorage.setItem(CARD_ROOM_DECOR_STORAGE_KEY, JSON.stringify(nextDecor));
  } catch {
    // Ignore storage failures in webviews with restricted persistence.
  }
  return nextDecor;
};

const stacksFromTable = (table: HoldemTableState) =>
  Object.fromEntries(table.players.map((player) => [player.avatarId, player.stack]));

const winnerAvatarIdsForTable = (table: HoldemTableState) =>
  table.winners
    .map((winner) => table.players[winner.seatIndex]?.avatarId)
    .filter((avatarId): avatarId is string => Boolean(avatarId));

const userWonTable = (table: HoldemTableState) =>
  table.winners.some((winner) => Boolean(table.players[winner.seatIndex]?.isUser));

const characterWonTable = (table: HoldemTableState) =>
  table.winners.some((winner) => {
    const player = table.players[winner.seatIndex];
    return Boolean(player && !player.isUser);
  });

const wholeTableCharacterWinner = (table: HoldemTableState) => {
  if (table.street !== "handComplete" || table.winners.length === 0) return null;
  const playersWithChips = table.players.filter(
    (player) => normalizePokerChips(player.stack) > 0,
  );
  if (playersWithChips.length !== 1) return null;
  const winner = playersWithChips[0];
  if (winner.isUser) return null;
  const winnerSeatIndexes = new Set(table.winners.map((entry) => entry.seatIndex));
  return winnerSeatIndexes.has(winner.seatIndex) ? winner : null;
};

const chipFlightActionTypeFromLastAction = (
  lastAction: string | undefined,
): CardRoomChipActionType | undefined => {
  const normalized = lastAction?.toLowerCase() ?? "";
  if (normalized.includes("all-in")) return "all-in";
  if (normalized.includes("raise")) return "raise";
  if (normalized.includes("call")) return "call";
  if (normalized.includes("bet")) return "bet";
  return undefined;
};

const chipFlightsForTableTransition = (
  previousTable: HoldemTableState,
  nextTable: HoldemTableState,
  startedAt: number,
): CardRoomTableMotion["chipFlights"] => {
  if (nextTable.actionSerial === previousTable.actionSerial) return [];
  const previousCommittedByAvatarId = new Map(
    previousTable.players.map((player) => [player.avatarId, player.committed]),
  );
  return nextTable.players.flatMap((player) => {
    const fromCommitted = previousCommittedByAvatarId.get(player.avatarId) ?? 0;
    const toCommitted = player.committed;
    const amount = toCommitted - fromCommitted;
    if (amount <= 0) return [];
    return [
      {
        avatarId: player.avatarId,
        handNumber: nextTable.handNumber,
        actionSerial: nextTable.actionSerial,
        actionType: chipFlightActionTypeFromLastAction(player.lastAction),
        amount,
        fromCommitted,
        toCommitted,
        startedAt,
      },
    ];
  });
};

const potCollectionFlightsForTableTransition = (
  previousTable: HoldemTableState,
  nextTable: HoldemTableState,
  startedAt: number,
): CardRoomTableMotion["potCollectionFlights"] => {
  if (nextTable.street !== "handComplete") return [];
  if (nextTable.winners.length === 0) return [];
  if (
    previousTable.street === "handComplete" &&
    previousTable.handNumber === nextTable.handNumber
  ) {
    return [];
  }

  return nextTable.players.flatMap((player, index) => {
    const amount = Math.max(0, Math.round(player.committed));
    if (amount <= 0) return [];
    return [
      {
        avatarId: player.avatarId,
        handNumber: nextTable.handNumber,
        actionSerial: nextTable.actionSerial,
        amount,
        startedAt: startedAt + index * 70,
      },
    ];
  });
};

const payoutFlightsForTableTransition = (
  previousTable: HoldemTableState,
  nextTable: HoldemTableState,
  startedAt: number,
): CardRoomTableMotion["payoutFlights"] => {
  if (nextTable.street !== "handComplete") return [];
  if (nextTable.winners.length === 0) return [];
  if (
    previousTable.street === "handComplete" &&
    previousTable.handNumber === nextTable.handNumber
  ) {
    return [];
  }

  const payoutByAvatarId = new Map<string, { avatarId: string; amount: number }>();
  nextTable.winners.forEach((winner) => {
    const player = nextTable.players[winner.seatIndex];
    const amount = Math.max(0, Math.round(winner.amount));
    if (!player || amount <= 0) return;
    const current = payoutByAvatarId.get(player.avatarId);
    payoutByAvatarId.set(player.avatarId, {
      avatarId: player.avatarId,
      amount: (current?.amount ?? 0) + amount,
    });
  });

  return Array.from(payoutByAvatarId.values()).map((payout, index) => ({
    avatarId: payout.avatarId,
    handNumber: nextTable.handNumber,
    actionSerial: nextTable.actionSerial,
    amount: payout.amount,
    startedAt: startedAt + index * 90,
  }));
};

const createInitialCardRoomMotion = (): CardRoomTableMotion => ({
  handNumber: 0,
  handStartedAt: 0,
  street: "waiting",
  streetStartedAt: 0,
  actionSerial: 0,
  actionStartedAt: 0,
  chipFlights: [],
  potCollectionFlights: [],
  payoutFlights: [],
  communityRevealFrom: 0,
  communityRevealCount: 0,
  communityRevealStartedAt: 0,
  completionStartedAt: null,
  winningAvatarIds: [],
  userVictoryStartedAt: null,
});

const dealStartingSeatIndexForTable = (table: HoldemTableState) => {
  const playerCount = table.players.length;
  if (playerCount <= 1) return 0;
  const buttonIndex = ((table.buttonIndex % playerCount) + playerCount) % playerCount;
  return playerCount === 2 ? buttonIndex : (buttonIndex + 1) % playerCount;
};

const handHudCardsReadyForPlayer = (
  table: HoldemTableState,
  player: HoldemPlayer | undefined,
  motion: CardRoomTableMotion,
  now: number,
) => {
  if (!player || player.holeCards.length === 0) return false;
  if (table.street === "waiting") return false;
  if (table.street === "handComplete") return true;
  if (motion.handNumber !== table.handNumber) return false;
  if (!Number.isFinite(motion.handStartedAt)) return false;

  const playerCount = Math.max(1, table.players.length);
  const dealStartSeatIndex = dealStartingSeatIndexForTable(table);
  const seatDealOffset = (player.seatIndex - dealStartSeatIndex + playerCount) % playerCount;
  const lastCardIndex = Math.max(0, Math.min(2, player.holeCards.length) - 1);
  const lastDealIndex = lastCardIndex * playerCount + seatDealOffset;
  const revealAt =
    motion.handStartedAt +
    CARD_ROOM_HAND_DEAL_INITIAL_DELAY_MS +
    lastDealIndex * CARD_ROOM_HAND_DEAL_STAGGER_MS +
    CARD_ROOM_HAND_DEAL_TRAVEL_MS * CARD_ROOM_HAND_DEAL_FACE_REVEAL_PROGRESS;
  return now >= revealAt;
};

const normalizeCardRoomAudioVolume = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : CARD_ROOM_DEFAULT_AUDIO_VOLUME;

const readCardRoomAudioVolume = () => {
  try {
    const saved = localStorage.getItem(CARD_ROOM_AUDIO_VOLUME_KEY);
    return saved === null
      ? CARD_ROOM_DEFAULT_AUDIO_VOLUME
      : normalizeCardRoomAudioVolume(Number(saved));
  } catch {
    return CARD_ROOM_DEFAULT_AUDIO_VOLUME;
  }
};

const cardRoomAudioContextConstructor = () =>
  window.AudioContext ??
  (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

const createCardRoomAudioPool = (sources: readonly string[], poolSize: number) => {
  if (sources.length === 0 || poolSize <= 0) return [];
  return Array.from({ length: poolSize }, (_, index) => {
    const audio = new Audio(sources[index % sources.length]);
    audio.preload = "auto";
    return audio;
  });
};

const pauseCardRoomAudioPool = (pool: HTMLAudioElement[]) => {
  pool.forEach((audio) => {
    audio.pause();
  });
};

const mergeDefaultStacks = (
  characters: CardRoomCharacter[],
  current: Record<string, number>,
) => ({
  ...Object.fromEntries(
    characters.map((character) => [
      character.avatarId,
      normalizePokerChips(character.pokerChips),
    ]),
  ),
  ...current,
});

const stacksForNextHand = (
  characters: CardRoomCharacter[],
  current: Record<string, number>,
  currentTable: HoldemTableState,
) => {
  const handInProgress =
    currentTable.street !== "waiting" && currentTable.street !== "handComplete";
  return {
    ...mergeDefaultStacks(characters, current),
    ...(handInProgress ? stacksFromTable(currentTable) : {}),
  };
};

const fallbackRuntimeCharacter: CardRoomCharacter = {
  slotId: "card-room-preview",
  slotIndex: 0,
  avatarId: "card-room-preview",
  avatarName: "Codex",
  avatarAppearanceId: "octopus",
  growthLevel: 1,
  walletBits: 0,
  pokerChips: CARD_ROOM_DEFAULT_POKER_CHIPS,
  traits: {
    focus: 0,
    resilience: 0,
    curiosity: 0,
    efficiency: 0,
    creativity: 0,
    warmth: 0,
  },
  darkTraits: {
    greed: 0,
    foolishness: 0,
    recklessness: 0,
    cowardice: 0,
    arrogance: 0,
    coldness: 0,
  },
};

const cardRoomCopy = (
  copy: CardRoomCopy,
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => {
  const value = copy(key, params);
  return value && value !== key ? value : fallback;
};

const stackLabel = (value: number, copy: CardRoomCopy) =>
  value >= 0
    ? cardRoomCopy(copy, "cardRoom.stackChips", `${value} chips`, { value })
    : cardRoomCopy(copy, "cardRoom.stackDebt", `debt ${Math.abs(value)}`, {
        value: Math.abs(value),
      });

const actionCueCopy: Record<
  CardRoomActionCue["type"],
  { key: string; fallback: string }
> = {
  think: { key: "cardRoom.actionCue.think", fallback: "Thinking..." },
  hesitate: { key: "cardRoom.actionCue.hesitate", fallback: "Hmm..." },
  pressure: { key: "cardRoom.actionCue.pressure", fallback: "Push." },
  snap: { key: "cardRoom.actionCue.snap", fallback: "Now." },
  fold: { key: "cardRoom.actionCue.fold", fallback: "Fold." },
  check: { key: "cardRoom.actionCue.check", fallback: "Check." },
  call: { key: "cardRoom.actionCue.call", fallback: "Call." },
  bet: { key: "cardRoom.actionCue.bet", fallback: "Bet." },
  raise: { key: "cardRoom.actionCue.raise", fallback: "Raise." },
  "all-in": { key: "cardRoom.actionCue.allIn", fallback: "All-in!" },
};

const actionCueFromLastAction = (
  lastAction: string | undefined,
  now: number,
  copy: CardRoomCopy,
): CardRoomActionCue | undefined => {
  if (!lastAction) return undefined;
  const type: CardRoomActionCue["type"] = lastAction.includes("all-in")
    ? "all-in"
    : lastAction.includes("raise")
      ? "raise"
      : lastAction.includes("bet")
        ? "bet"
        : lastAction.includes("call")
          ? "call"
          : lastAction.includes("check")
            ? "check"
            : lastAction.includes("fold")
              ? "fold"
              : "check";
  return {
    type,
    text: cardRoomCopy(copy, actionCueCopy[type].key, actionCueCopy[type].fallback),
    startedAt: now,
    durationMs:
      type === "all-in"
        ? 1700
        : type === "raise"
          ? 1300
          : type === "bet" || type === "fold"
            ? 1200
            : type === "call"
              ? 1100
              : 900,
    intensity:
      type === "all-in" || type === "raise"
        ? "large"
        : type === "bet" || type === "call"
          ? "medium"
          : "small",
  };
};

const streetLabel = (street: string, copy: CardRoomCopy) =>
  cardRoomCopy(copy, `cardRoom.street.${street}`, street);

const pokerHandNameCopy: Record<string, { key: string; fallback: string }> = {
  "High Card": { key: "cardRoom.hand.highCard", fallback: "High Card" },
  Pair: { key: "cardRoom.hand.pair", fallback: "Pair" },
  "Two Pair": { key: "cardRoom.hand.twoPair", fallback: "Two Pair" },
  "Three of a Kind": { key: "cardRoom.hand.threeKind", fallback: "Three of a Kind" },
  Straight: { key: "cardRoom.hand.straight", fallback: "Straight" },
  Flush: { key: "cardRoom.hand.flush", fallback: "Flush" },
  "Full House": { key: "cardRoom.hand.fullHouse", fallback: "Full House" },
  "Four of a Kind": { key: "cardRoom.hand.fourKind", fallback: "Four of a Kind" },
  "Straight Flush": { key: "cardRoom.hand.straightFlush", fallback: "Straight Flush" },
  "Royal Flush": { key: "cardRoom.hand.royalFlush", fallback: "Royal Flush" },
};

const rankText = (value: string, copy: CardRoomCopy) => {
  const normalized = value
    .trim()
    .replace(/'s\b/i, "")
    .replace(/\s+High\b/i, "")
    .replace(/[cdhs]$/i, "")
    .trim();
  const rank = normalized === "10" ? "T" : normalized.toUpperCase();
  return cardRoomCopy(copy, `cardRoom.rank.${rank}`, normalized);
};

const localizePokerHandName = (handName: string | undefined, copy: CardRoomCopy) => {
  if (!handName) return "";
  const entry = pokerHandNameCopy[handName];
  return entry ? cardRoomCopy(copy, entry.key, entry.fallback) : handName;
};

const localizePokerHandDescription = (
  description: string | undefined,
  handName: string | undefined,
  copy: CardRoomCopy,
) => {
  if (!description) {
    return handName
      ? localizePokerHandName(handName, copy)
      : cardRoomCopy(copy, "cardRoom.hand.uncontested", "uncontested");
  }

  let match = description.match(/^High Card, (.+)$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.handDescription.highCard", description, {
      rank: rankText(match[1], copy),
    });
  }
  match = description.match(/^Pair, (.+)$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.handDescription.pair", description, {
      rank: rankText(match[1], copy),
    });
  }
  match = description.match(/^Two Pair, (.+) & (.+)$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.handDescription.twoPair", description, {
      high: rankText(match[1], copy),
      low: rankText(match[2], copy),
    });
  }
  match = description.match(/^Three of a Kind, (.+)$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.handDescription.threeKind", description, {
      rank: rankText(match[1], copy),
    });
  }
  match = description.match(/^Straight, (.+) High$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.handDescription.straightHigh", description, {
      rank: rankText(match[1], copy),
    });
  }
  match = description.match(/^Flush, (.+) High$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.handDescription.flushHigh", description, {
      rank: rankText(match[1], copy),
    });
  }
  match = description.match(/^Full House, (.+) over (.+)$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.handDescription.fullHouse", description, {
      three: rankText(match[1], copy),
      pair: rankText(match[2], copy),
    });
  }
  match = description.match(/^Four of a Kind, (.+)$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.handDescription.fourKind", description, {
      rank: rankText(match[1], copy),
    });
  }
  match = description.match(/^Straight Flush, (.+) High$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.handDescription.straightFlushHigh", description, {
      rank: rankText(match[1], copy),
    });
  }
  if (description === "Royal Flush") {
    return cardRoomCopy(copy, "cardRoom.hand.royalFlush", description);
  }
  return handName ? localizePokerHandName(handName, copy) : description;
};

const localizeWinnerSummary = (summary: string, copy: CardRoomCopy) =>
  summary
    .split(", ")
    .map((entry) => {
      const match = entry.match(/^(.+) wins (-?\d+)$/);
      return match
        ? cardRoomCopy(copy, "cardRoom.log.summaryWins", entry, {
            name: match[1],
            chips: Number(match[2]),
          })
        : entry;
    })
    .join(cardRoomCopy(copy, "cardRoom.log.listSeparator", ", "));

const translateCardRoomTableText = (text: string, copy: CardRoomCopy) => {
  if (!text) return text;
  const exact: Record<string, string> = {
    "Showdown.": "cardRoom.log.showdown",
    "Settled.": "cardRoom.log.settled",
    "The dealer reveals the flop.": "cardRoom.log.dealerFlop",
    "The dealer reveals the turn.": "cardRoom.log.dealerTurn",
    "The dealer reveals the river.": "cardRoom.log.dealerRiver",
    "Flop betting round.": "cardRoom.log.flopRound",
    "Turn betting round.": "cardRoom.log.turnRound",
    "River betting round.": "cardRoom.log.riverRound",
    "Preflop betting round.": "cardRoom.log.preflopRound",
    "Summon at least one companion to start a hand.": "cardRoom.log.needCompanion",
    "At least two players with chips are required.": "cardRoom.log.needChippedPlayers",
  };
  if (exact[text]) return cardRoomCopy(copy, exact[text], text);

  let match = text.match(/^Showdown order: (.+)\. Best hand: (.+)\.$/);
  if (match) {
    const names = match[1].split(", ").join(cardRoomCopy(copy, "cardRoom.log.listSeparator", ", "));
    const hand = localizePokerHandDescription(match[2], undefined, copy);
    return `${cardRoomCopy(copy, "cardRoom.log.showdownOrder", `Showdown order: ${names}.`, {
      names,
    })} ${cardRoomCopy(copy, "cardRoom.log.bestHand", `Best hand: ${hand}.`, {
      hand,
    })}`;
  }
  match = text.match(/^Showdown\. Best hand: (.+)\.$/);
  if (match) {
    const hand = localizePokerHandDescription(match[1], undefined, copy);
    return `${cardRoomCopy(copy, "cardRoom.log.showdown", "Showdown.")} ${cardRoomCopy(
      copy,
      "cardRoom.log.bestHand",
      `Best hand: ${hand}.`,
      { hand },
    )}`;
  }
  match = text.match(/^Showdown order: (.+)\. Settled\.$/);
  if (match) {
    const names = match[1].split(", ").join(cardRoomCopy(copy, "cardRoom.log.listSeparator", ", "));
    return `${cardRoomCopy(copy, "cardRoom.log.showdownOrder", `Showdown order: ${names}.`, {
      names,
    })} ${cardRoomCopy(copy, "cardRoom.log.settled", "Settled.")}`;
  }
  if (text === "Showdown. Settled.") {
    return `${cardRoomCopy(copy, "cardRoom.log.showdown", "Showdown.")} ${cardRoomCopy(
      copy,
      "cardRoom.log.settled",
      "Settled.",
    )}`;
  }
  match = text.match(/^(.+)\. Best hand: (.+)\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.bestHandStatus", text, {
      summary: localizeWinnerSummary(match[1], copy),
      hand: localizePokerHandDescription(match[2], undefined, copy),
    });
  }
  match = text.match(/^(.+) gets (-?\d+) uncalled chips back\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.uncalledBack", text, {
      name: match[1],
      chips: Number(match[2]),
    });
  }
  match = text.match(/^(.+) wins (-?\d+) chips\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.winsChips", text, {
      name: match[1],
      chips: Number(match[2]),
    });
  }
  match = text.match(/^(.+) wins the pot uncontested\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.winsUncontested", text, { name: match[1] });
  }
  match = text.match(/^(.+) posts (-?\d+)\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.posts", text, {
      name: match[1],
      chips: Number(match[2]),
    });
  }
  match = text.match(/^Hand (\d+) begins\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.handBegins", text, { number: Number(match[1]) });
  }
  match = text.match(/^(.+) folds\.$/);
  if (match) return cardRoomCopy(copy, "cardRoom.log.folds", text, { name: match[1] });
  match = text.match(/^(.+) checks\.$/);
  if (match) return cardRoomCopy(copy, "cardRoom.log.checks", text, { name: match[1] });
  match = text.match(/^(.+) times out and checks\.$/);
  if (match) return cardRoomCopy(copy, "cardRoom.log.timeoutChecks", text, { name: match[1] });
  match = text.match(/^(.+) times out\. Hand is dead\.$/);
  if (match) return cardRoomCopy(copy, "cardRoom.log.timeoutDead", text, { name: match[1] });
  match = text.match(/^(.+) calls (-?\d+)\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.calls", text, {
      name: match[1],
      chips: Number(match[2]),
    });
  }
  match = text.match(/^(.+) bets (-?\d+)\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.bets", text, {
      name: match[1],
      chips: Number(match[2]),
    });
  }
  match = text.match(/^(.+) raises to (-?\d+)\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.raisesTo", text, {
      name: match[1],
      chips: Number(match[2]),
    });
  }
  match = text.match(/^(.+) moves all-in for (-?\d+)\.$/);
  if (match) {
    return cardRoomCopy(copy, "cardRoom.log.allInFor", text, {
      name: match[1],
      chips: Number(match[2]),
    });
  }
  return text;
};

const playerActionSnapshot = (player: HoldemPlayer) =>
  [
    player.lastAction ?? "",
    player.committed,
    player.roundBet,
    player.folded ? 1 : 0,
    player.allIn ? 1 : 0,
  ].join(":");

const addDarkTraitChange = (
  changes: Partial<AivatarDarkTraits>,
  trait: keyof AivatarDarkTraits,
  value: number,
) => {
  changes[trait] = (changes[trait] ?? 0) + value;
};

const createHandDarkStats = (
  table: HoldemTableState,
  player: HoldemPlayer,
  previousHandNet: number,
): CardRoomHandDarkStats => ({
  handNumber: table.handNumber,
  avatarId: player.avatarId,
  startStack: player.stack,
  startedAfterLoss: previousHandNet < 0,
  bets: 0,
  raises: 0,
  allIns: 0,
  calls: 0,
  folds: 0,
  chaseActions: 0,
  largePressureActions: 0,
});

const recordHandDarkAction = (
  stats: CardRoomHandDarkStats,
  table: HoldemTableState,
  player: HoldemPlayer,
  action: Parameters<typeof applyHoldemAction>[1],
) => {
  const legal = legalActionsForActivePlayer(table);
  const credit = creditAvailable(player);
  const maxRoundBet = player.roundBet + credit;
  const targetRoundBet =
    action.type === "all-in"
      ? maxRoundBet
      : action.type === "bet"
        ? Math.min(maxRoundBet, Math.max(table.bigBlind * 2, Math.round(action.amount ?? table.bigBlind)))
        : action.type === "raise"
          ? Math.min(maxRoundBet, Math.round(action.amount ?? legal.minRaiseTo))
          : player.roundBet;
  const paymentNeeded =
    action.type === "call"
      ? legal.toCall
      : action.type === "bet" || action.type === "raise" || action.type === "all-in"
        ? Math.max(0, targetRoundBet - player.roundBet)
        : 0;

  if (action.type === "fold") stats.folds += 1;
  if (action.type === "call") stats.calls += 1;
  if (action.type === "bet") stats.bets += 1;
  if (action.type === "raise") stats.raises += 1;
  if (action.type === "all-in") stats.allIns += 1;

  const isChasing =
    action.type === "call" ||
    action.type === "raise" ||
    action.type === "all-in";
  const alreadyDownThisHand = player.stack < stats.startStack - table.bigBlind;
  if (isChasing && paymentNeeded > 0 && (stats.startedAfterLoss || alreadyDownThisHand)) {
    stats.chaseActions += 1;
  }

  const hasOpponentToPressure = table.players.some(
    (candidate) =>
      !candidate.isUser &&
      !candidate.folded &&
      !candidate.allIn &&
      creditAvailable(candidate) > 0,
  );
  const isLargePressure =
    action.type === "all-in" ||
    ((action.type === "bet" || action.type === "raise") &&
      (paymentNeeded >= table.bigBlind * 4 || targetRoundBet >= table.bigBlind * 6));
  if (hasOpponentToPressure && isLargePressure) {
    stats.largePressureActions += 1;
  }
};

const darkTraitChangesForCompletedHand = (
  stats: CardRoomHandDarkStats,
  table: HoldemTableState,
  finalPlayer: HoldemPlayer,
): Partial<AivatarDarkTraits> => {
  const changes: Partial<AivatarDarkTraits> = {};
  const net = finalPlayer.stack - stats.startStack;
  const aggressiveMoves = stats.raises + stats.allIns;
  const wonChips = net > 0;
  const opponentsFolded = table.players.some(
    (player) => !player.isUser && player.folded,
  );

  if (aggressiveMoves >= 2) {
    addDarkTraitChange(changes, "recklessness", aggressiveMoves);
    addDarkTraitChange(changes, "arrogance", 1 + stats.allIns);
  } else if (stats.allIns > 0) {
    addDarkTraitChange(changes, "recklessness", 2);
    addDarkTraitChange(changes, "arrogance", 1);
  }

  if (stats.chaseActions > 0 && (stats.startedAfterLoss || net < 0)) {
    addDarkTraitChange(changes, "greed", stats.chaseActions);
    addDarkTraitChange(changes, "foolishness", net < 0 ? stats.chaseActions : 1);
  }

  if (stats.folds > 0) {
    addDarkTraitChange(changes, "cowardice", 1);
  }

  if (stats.largePressureActions > 0) {
    addDarkTraitChange(
      changes,
      "coldness",
      stats.largePressureActions + (wonChips && opponentsFolded ? 1 : 0),
    );
  }

  return changes;
};

const cardRankText = (card: PlayingCard) => (card.rank === "T" ? "10" : card.rank);

const cardSuitSymbol = (card: PlayingCard) =>
  ({
    h: "♥",
    d: "♦",
    c: "♣",
    s: "♠",
  })[card.suit];

const cardTone = (card: PlayingCard) =>
  card.suit === "h" || card.suit === "d" ? "red" : "black";

const recommendedWagerTarget = (legal: ReturnType<typeof legalActionsForActivePlayer>) => {
  if (legal.maxRaiseTo <= 0) return 0;
  return Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, MIN_WAGER_TARGET));
};

const clampWagerTarget = (
  rawValue: string | number,
  legal: ReturnType<typeof legalActionsForActivePlayer>,
) => {
  if (legal.maxRaiseTo <= 0) return 0;
  const parsed =
    typeof rawValue === "number"
      ? rawValue
      : Number.parseInt(rawValue.replace(/[^\d-]/g, ""), 10);
  const target = Number.isFinite(parsed) ? Math.round(parsed) : recommendedWagerTarget(legal);
  return Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, target));
};

const useCardRoomCollapsibleHeight = () => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState(0);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;

    const measure = () => {
      const nextHeight = body.scrollHeight;
      setBodyHeight((height) => (height === nextHeight ? height : nextHeight));
    };

    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(body);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return { bodyHeight, bodyRef };
};

const CardRoomHandCard = ({ card }: { card: PlayingCard }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.ceil(USER_HAND_CARD_CANVAS_WIDTH * dpr);
    canvas.height = Math.ceil(USER_HAND_CARD_CANVAS_HEIGHT * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, USER_HAND_CARD_CANVAS_WIDTH, USER_HAND_CARD_CANVAS_HEIGHT);
    drawPlayingCard(ctx, card, USER_HAND_CARD_OFFSET_X, USER_HAND_CARD_OFFSET_Y, {
      faceScale: USER_HAND_CARD_FACE_SCALE,
      scale: USER_HAND_CARD_SCALE,
    });
  }, [card.rank, card.suit]);

  const label = `${cardRankText(card)}${cardSuitSymbol(card)}`;
  return (
    <canvas
      ref={canvasRef}
      className={`card-room-hand-card ${cardTone(card)}`}
      width={USER_HAND_CARD_CANVAS_WIDTH}
      height={USER_HAND_CARD_CANVAS_HEIGHT}
      aria-label={label}
      title={label}
    />
  );
};

const darkTraitValue = (player: HoldemPlayer, trait: keyof HoldemPlayer["darkTraits"]) =>
  player.darkTraits[trait] ?? 0;

const seatPreferenceScore = (player: HoldemPlayer, roomSeatIndex: number) => {
  const centerBias = 1 - Math.min(1, Math.abs(roomSeatIndex - 2.5) / 2.5);
  const sideBias = roomSeatIndex >= 6 ? 1 : 0;
  const leftBias = roomSeatIndex === 6 ? 1 : 0;
  const rightBias = roomSeatIndex === 7 ? 1 : 0;
  const edgeBias = roomSeatIndex === 0 || roomSeatIndex === 5 ? 0.45 : 0;
  return (
    Math.random() * 24 +
    centerBias *
      (darkTraitValue(player, "arrogance") * 0.55 +
        darkTraitValue(player, "greed") * 0.35 +
        darkTraitValue(player, "recklessness") * 0.25) +
    sideBias *
      (darkTraitValue(player, "cowardice") * 0.7 +
        darkTraitValue(player, "coldness") * 0.28) +
    edgeBias * (darkTraitValue(player, "foolishness") * 0.3 + player.traits.curiosity * 0.001) +
    leftBias * player.traits.warmth * 0.0007 +
    rightBias * player.traits.focus * 0.0007
  );
};

const roomSeatClaimPriority = (player: HoldemPlayer) =>
  darkTraitValue(player, "arrogance") +
  darkTraitValue(player, "greed") +
  darkTraitValue(player, "recklessness") * 0.7 +
  Math.random() * 40;

const assignRoomSeats = (
  players: HoldemPlayer[],
  previousPlayers: HoldemPlayer[] = [],
) => {
  const assignments = new Map<string, number>();
  const available = [...ROOM_SEAT_INDEXES];
  const currentPlayerIds = new Set(players.map((player) => player.avatarId));

  previousPlayers
    .filter((player) => !player.isUser && currentPlayerIds.has(player.avatarId))
    .forEach((player) => {
      if (
        typeof player.roomSeatIndex !== "number" ||
        !available.includes(player.roomSeatIndex)
      ) {
        return;
      }
      assignments.set(player.avatarId, player.roomSeatIndex);
      available.splice(available.indexOf(player.roomSeatIndex), 1);
    });

  players
    .filter((player) => !player.isUser && !assignments.has(player.avatarId))
    .map((player) => ({
      player,
      priority: roomSeatClaimPriority(player),
    }))
    .sort((left, right) => right.priority - left.priority)
    .forEach((player) => {
      const contender = player.player;
      const chosen = available
        .map((roomSeatIndex) => ({
          roomSeatIndex,
          score: seatPreferenceScore(contender, roomSeatIndex),
        }))
        .sort((left, right) => right.score - left.score)[0]?.roomSeatIndex;
      if (chosen === undefined) return;
      assignments.set(contender.avatarId, chosen);
      available.splice(available.indexOf(chosen), 1);
    });

  return players.map((player) =>
    player.isUser
      ? { ...player, roomSeatIndex: undefined }
      : { ...player, roomSeatIndex: assignments.get(player.avatarId) ?? 0 },
  );
};

const clockwiseSeatOrder = (player: HoldemPlayer) => {
  if (player.isUser) return 0;
  if (player.roomSeatIndex === 6) return 1;
  if (
    typeof player.roomSeatIndex === "number" &&
    player.roomSeatIndex >= 0 &&
    player.roomSeatIndex <= 5
  ) {
    return 2 + player.roomSeatIndex;
  }
  if (player.roomSeatIndex === 7) return 8;
  return 20 + player.seatIndex;
};

const orderPlayersClockwise = (players: HoldemPlayer[]) =>
  [...players]
    .sort(
      (left, right) =>
        clockwiseSeatOrder(left) - clockwiseSeatOrder(right) ||
        left.seatIndex - right.seatIndex,
    )
    .map((player, seatIndex) => ({
      ...player,
      seatIndex,
    }));

export const CardRoomApp = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale());
  const ui = (key: string, params?: Record<string, string | number>) =>
    t(locale, key, params);
  const cardRoomCopyRef = useRef<CardRoomCopy>(ui);
  cardRoomCopyRef.current = ui;
  const [roster, setRoster] = useState<CardRoomCharacter[]>(() => readCardRoomRoster());
  const [hostSlotId] = useState<string | null>(() => initialHostSlotId());
  const cardRoomInstanceIdRef = useRef(createCardRoomInstanceId());
  const [roomSnapshot, setRoomSnapshot] = useState<AivatarRoomsSnapshot | null>(null);
  const roomSnapshotRef = useRef<AivatarRoomsSnapshot | null>(null);
  const activeCardRoomVisitsRef = useRef(new Map<string, AivatarVisitSession>());
  const [playerWallet, setPlayerWallet] = useState<PlayerChipWallet>(() =>
    readPlayerChipWallet(),
  );
  const [houseBank, setHouseBank] = useState<CardRoomHouseBank>(() => readHouseBank());
  const [cardRoomDecor, setCardRoomDecor] = useState<CardRoomDecorState>(() =>
    readCardRoomDecorState(),
  );
  const [activeDecorCategory, setActiveDecorCategory] =
    useState<CardRoomDecorCategory>("wall");
  const localizedCardRoomShopItems = useMemo(
    () => cardRoomShopItemsForLocale(locale),
    [locale],
  );
  const currentCardRoomContent = useMemo(
    () => buildCardRoomContentWithDecor(cardRoomDecor, locale),
    [cardRoomDecor, locale],
  );
  const [playerNameOverrides, setPlayerNameOverrides] = useState<Record<string, string>>({});
  const playerNameKey = USER_PLAYER_SLOT_ID;
  const savedPlayerName = useMemo(() => {
    try {
      return localStorage.getItem(playerNameStorageKey(null))?.trim() ?? "";
    } catch {
      return "";
    }
  }, []);
  const playerNameInput = playerNameOverrides[playerNameKey] ?? savedPlayerName;
  const playerDisplayName = playerNameInput.trim() || ui("cardRoom.host");
  const hostDisplayCharacter = useMemo(
    () => ({
      ...fallbackRuntimeCharacter,
      slotId: USER_PLAYER_SLOT_ID,
      slotIndex: -1,
      avatarId: USER_PLAYER_AVATAR_ID,
      avatarName: playerDisplayName,
      walletBits: 0,
      pokerChips: normalizePokerChips(playerWallet.pokerChips),
    }),
    [playerDisplayName, playerWallet.pokerChips],
  );
  const availableCompanions = useMemo(
    () => roster.slice(0, MAX_COMPANIONS),
    [roster],
  );
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>(() => {
    const initialRoster = readCardRoomRoster();
    return initialRoster
      .slice(0, MAX_COMPANIONS)
      .map((character) => character.slotId);
  });
  const selectedCompanions = availableCompanions.filter((character) =>
    selectedSlotIds.includes(character.slotId),
  );
  const seatedCharacters = [hostDisplayCharacter, ...selectedCompanions].slice(0, MAX_COMPANIONS + 1);
  const [stacks, setStacks] = useState<Record<string, number>>(() =>
    ({
      [USER_PLAYER_AVATAR_ID]: normalizePokerChips(playerWallet.pokerChips),
      ...mergeDefaultStacks(readCardRoomRoster().slice(0, MAX_COMPANIONS), {}),
    }),
  );
  const [table, setTable] = useState<HoldemTableState>(() => emptyHoldemTable());
  const [statusMessage, setStatusMessage] = useState("");
  const [wagerTargetInput, setWagerTargetInput] = useState("");
  const [calledClock, setCalledClock] = useState<CardRoomCalledClock | null>(null);
  const [clockNow, setClockNow] = useState(() => performance.now());
  const [userVictoryEffect, setUserVictoryEffect] = useState<{
    handNumber: number;
    startedAt: number;
  } | null>(null);
  const userVictoryEffectRef = useRef(userVictoryEffect);
  const tableRef = useRef(table);
  const tableMotionRef = useRef<CardRoomTableMotion>(createInitialCardRoomMotion());
  const playerWalletRef = useRef(playerWallet);
  const houseBankRef = useRef(houseBank);
  const hostCharacterRef = useRef<CardRoomCharacter>(hostDisplayCharacter);
  const seatedCharactersRef = useRef(seatedCharacters);
  const visitorStatesRef = useRef<Record<string, CardRoomVisitorState>>({});
  const currentCardRoomContentRef = useRef(currentCardRoomContent);
  const cardRoomNavMemoryRef = useRef(
    createCardRoomNavigationMemory(hostSlotId ?? "preview", currentCardRoomContent),
  );
  const [freeRoamEnabled, setFreeRoamEnabled] = useState(true);
  const freeRoamEnabledRef = useRef(freeRoamEnabled);
  const [playersSeatedReady, setPlayersSeatedReady] = useState(false);
  const playersSeatedReadyRef = useRef(false);
  const [userHandCardsReady, setUserHandCardsReady] = useState(false);
  const userHandCardsReadyRef = useRef(false);
  const [companionsPanelCollapsed, setCompanionsPanelCollapsed] = useState(false);
  const companionsPanel = useCardRoomCollapsibleHeight();
  const [chipShopPanelCollapsed, setChipShopPanelCollapsed] = useState(false);
  const chipShopPanel = useCardRoomCollapsibleHeight();
  const [decorShopPanelCollapsed, setDecorShopPanelCollapsed] = useState(false);
  const decorShopPanel = useCardRoomCollapsibleHeight();
  const actionCuesRef = useRef<Record<string, CardRoomActionCue>>({});
  const playerActionSnapshotsRef = useRef<Record<string, string>>({});
  const hostHandDarkStatsRef = useRef<CardRoomHandDarkStats | null>(null);
  const previousHostHandNetRef = useRef(0);
  const processedDarkTraitHandRef = useRef<number | null>(null);
  const processedAutoCashOutHandRef = useRef<number | null>(null);
  const victoryDemoPlayedRef = useRef(false);
  const cardRoomAudioUnlockedRef = useRef(false);
  const dealCardAudioContextRef = useRef<AudioContext | null>(null);
  const dealCardAudioBufferRef = useRef<AudioBuffer | null>(null);
  const dealCardAudioBufferLoadingRef = useRef<Promise<AudioBuffer | null> | null>(null);
  const foldAudioPoolRef = useRef<HTMLAudioElement[]>([]);
  const foldAudioPoolIndexRef = useRef(0);
  const checkAudioPoolRef = useRef<HTMLAudioElement[]>([]);
  const checkAudioPoolIndexRef = useRef(0);
  const chipBetAudioPoolRef = useRef<HTMLAudioElement[]>([]);
  const chipBetAudioPoolIndexRef = useRef(0);
  const chipAllInAudioPoolRef = useRef<HTMLAudioElement[]>([]);
  const chipAllInAudioPoolIndexRef = useRef(0);
  const chipPayoutAudioPoolRef = useRef<HTMLAudioElement[]>([]);
  const chipPayoutAudioPoolIndexRef = useRef(0);
  const userWinAudioPoolRef = useRef<HTMLAudioElement[]>([]);
  const userWinAudioPoolIndexRef = useRef(0);
  const characterWinAudioPoolRef = useRef<HTMLAudioElement[]>([]);
  const cardRoomAudioVolumeRef = useRef(readCardRoomAudioVolume());
  const dealCardAudioHandNumberRef = useRef<number | null>(null);
  const playedDealCardAudioKeysRef = useRef<Set<string>>(new Set());
  const foldAudioHandNumberRef = useRef<number | null>(null);
  const playedFoldAudioKeysRef = useRef<Set<string>>(new Set());
  const checkAudioHandNumberRef = useRef<number | null>(null);
  const playedCheckAudioKeysRef = useRef<Set<string>>(new Set());
  const chipAudioHandNumberRef = useRef<number | null>(null);
  const playedChipAudioKeysRef = useRef<Set<string>>(new Set());

  const playedUserWinAudioKeysRef = useRef<Set<string>>(new Set());
  const playedCharacterWinAudioKeysRef = useRef<Set<string>>(new Set());
  const roomKey = hostSlotId ?? "preview";

  const currentCardRoomPresence = () =>
    createCardRoomPresence(cardRoomInstanceIdRef.current, hostSlotId);

  const applyCardRoomAudioPoolVolume = (
    pool: HTMLAudioElement[],
    volumeMultiplier: number,
    volume = cardRoomAudioVolumeRef.current,
  ) => {
    pool.forEach((audio) => {
      audio.volume = Math.min(1, Math.max(0, volume * volumeMultiplier));
    });
  };

  const applyCardRoomAudioVolume = (volume = cardRoomAudioVolumeRef.current) => {
    applyCardRoomAudioPoolVolume(
      foldAudioPoolRef.current,
      CARD_ROOM_FOLD_AUDIO_VOLUME_MULTIPLIER,
      volume,
    );
    applyCardRoomAudioPoolVolume(
      checkAudioPoolRef.current,
      CARD_ROOM_CHECK_AUDIO_VOLUME_MULTIPLIER,
      volume,
    );
    applyCardRoomAudioPoolVolume(
      chipBetAudioPoolRef.current,
      CARD_ROOM_CHIP_BET_AUDIO_VOLUME_MULTIPLIER,
      volume,
    );
    applyCardRoomAudioPoolVolume(
      chipAllInAudioPoolRef.current,
      CARD_ROOM_CHIP_ALL_IN_AUDIO_VOLUME_MULTIPLIER,
      volume,
    );
    applyCardRoomAudioPoolVolume(
      chipPayoutAudioPoolRef.current,
      CARD_ROOM_CHIP_PAYOUT_AUDIO_VOLUME_MULTIPLIER,
      volume,
    );
    applyCardRoomAudioPoolVolume(
      userWinAudioPoolRef.current,
      CARD_ROOM_USER_WIN_AUDIO_VOLUME_MULTIPLIER,
      volume,
    );
    applyCardRoomAudioPoolVolume(
      characterWinAudioPoolRef.current,
      CARD_ROOM_CHARACTER_WIN_AUDIO_VOLUME_MULTIPLIER,
      volume,
    );
  };

  const playCardRoomAudioFromPool = (
    pool: HTMLAudioElement[],
    poolIndexRef: { current: number },
    volumeMultiplier: number,
  ) => {
    if (
      !cardRoomAudioUnlockedRef.current ||
      cardRoomAudioVolumeRef.current <= 0 ||
      pool.length === 0
    ) {
      return;
    }

    const audio = pool[poolIndexRef.current % pool.length];
    poolIndexRef.current += 1;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = Math.min(1, Math.max(0, cardRoomAudioVolumeRef.current * volumeMultiplier));
    void audio.play().catch(() => undefined);
  };

  const playRandomCardRoomAudioFromPool = (
    pool: HTMLAudioElement[],
    volumeMultiplier: number,
  ) => {
    if (
      !cardRoomAudioUnlockedRef.current ||
      cardRoomAudioVolumeRef.current <= 0 ||
      pool.length === 0
    ) {
      return;
    }

    const audio = pool[Math.floor(Math.random() * pool.length)];
    audio.pause();
    audio.currentTime = 0;
    audio.volume = Math.min(1, Math.max(0, cardRoomAudioVolumeRef.current * volumeMultiplier));
    void audio.play().catch(() => undefined);
  };

  const ensureDealCardAudioContext = () => {
    if (dealCardAudioContextRef.current) return dealCardAudioContextRef.current;
    const AudioContextConstructor = cardRoomAudioContextConstructor();
    if (!AudioContextConstructor) return null;
    const context = new AudioContextConstructor();
    dealCardAudioContextRef.current = context;
    return context;
  };

  const loadDealCardAudioBuffer = () => {
    if (dealCardAudioBufferRef.current) {
      return Promise.resolve(dealCardAudioBufferRef.current);
    }
    if (dealCardAudioBufferLoadingRef.current) {
      return dealCardAudioBufferLoadingRef.current;
    }
    const context = ensureDealCardAudioContext();
    if (!context) return Promise.resolve(null);

    const loading = fetch(CARD_ROOM_DEAL_CARD_AUDIO_SRC)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject()))
      .then((audioData) => context.decodeAudioData(audioData))
      .then((buffer) => {
        dealCardAudioBufferRef.current = buffer;
        return buffer;
      })
      .catch(() => {
        dealCardAudioBufferLoadingRef.current = null;
        return null;
      });
    dealCardAudioBufferLoadingRef.current = loading;
    return loading;
  };

  const playDealCardAudio = () => {
    if (!cardRoomAudioUnlockedRef.current || cardRoomAudioVolumeRef.current <= 0) return;
    const context = ensureDealCardAudioContext();
    const buffer = dealCardAudioBufferRef.current;
    if (!context || !buffer) {
      void loadDealCardAudioBuffer();
      return;
    }
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
      return;
    }
    if (context.state === "closed") return;

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.min(
      1,
      Math.max(0, cardRoomAudioVolumeRef.current * CARD_ROOM_DEAL_CARD_AUDIO_VOLUME_MULTIPLIER),
    );
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  };

  const playFoldAudio = () => {
    playCardRoomAudioFromPool(
      foldAudioPoolRef.current,
      foldAudioPoolIndexRef,
      CARD_ROOM_FOLD_AUDIO_VOLUME_MULTIPLIER,
    );
  };

  const playCheckAudio = () => {
    playCardRoomAudioFromPool(
      checkAudioPoolRef.current,
      checkAudioPoolIndexRef,
      CARD_ROOM_CHECK_AUDIO_VOLUME_MULTIPLIER,
    );
  };

  const playChipBetAudio = () => {
    playCardRoomAudioFromPool(
      chipBetAudioPoolRef.current,
      chipBetAudioPoolIndexRef,
      CARD_ROOM_CHIP_BET_AUDIO_VOLUME_MULTIPLIER,
    );
  };

  const playChipAllInAudio = () => {
    playCardRoomAudioFromPool(
      chipAllInAudioPoolRef.current,
      chipAllInAudioPoolIndexRef,
      CARD_ROOM_CHIP_ALL_IN_AUDIO_VOLUME_MULTIPLIER,
    );
  };

  const playChipPayoutAudio = () => {
    playCardRoomAudioFromPool(
      chipPayoutAudioPoolRef.current,
      chipPayoutAudioPoolIndexRef,
      CARD_ROOM_CHIP_PAYOUT_AUDIO_VOLUME_MULTIPLIER,
    );
  };

  const playUserWinAudio = () => {
    playCardRoomAudioFromPool(
      userWinAudioPoolRef.current,
      userWinAudioPoolIndexRef,
      CARD_ROOM_USER_WIN_AUDIO_VOLUME_MULTIPLIER,
    );
  };

  const playCharacterWinAudio = () => {
    playRandomCardRoomAudioFromPool(
      characterWinAudioPoolRef.current,
      CARD_ROOM_CHARACTER_WIN_AUDIO_VOLUME_MULTIPLIER,
    );
  };

  const playTimedCardRoomAudioIfDue = (
    playedKeys: Set<string>,
    key: string,
    playAt: number,
    now: number,
    playAudio: () => void,
    lateWindowMs: number,
  ) => {
    if (!Number.isFinite(playAt) || now < playAt) return;
    if (playedKeys.has(key)) return;
    playedKeys.add(key);
    if (now - playAt <= lateWindowMs) {
      playAudio();
    }
  };

  const playDealCardAudioForFrame = (
    currentTable: HoldemTableState,
    motion: CardRoomTableMotion,
    now: number,
  ) => {
    if (motion.handNumber !== currentTable.handNumber) return;
    if (dealCardAudioHandNumberRef.current !== currentTable.handNumber) {
      dealCardAudioHandNumberRef.current = currentTable.handNumber;
      playedDealCardAudioKeysRef.current.clear();
    }

    if (currentTable.street !== "waiting" && Number.isFinite(motion.handStartedAt)) {
      const playerCount = Math.max(1, currentTable.players.length);
      const dealStartSeatIndex = dealStartingSeatIndexForTable(currentTable);
      currentTable.players.forEach((player) => {
        const seatDealOffset =
          (player.seatIndex - dealStartSeatIndex + playerCount) % playerCount;
        player.holeCards.slice(0, 2).forEach((_, cardIndex) => {
          const dealIndex = cardIndex * playerCount + seatDealOffset;
          const dealAt =
            motion.handStartedAt +
            CARD_ROOM_HAND_DEAL_INITIAL_DELAY_MS +
            dealIndex * CARD_ROOM_HAND_DEAL_STAGGER_MS;
          playTimedCardRoomAudioIfDue(
            playedDealCardAudioKeysRef.current,
            `hand:${currentTable.handNumber}:${player.seatIndex}:${cardIndex}`,
            dealAt,
            now,
            playDealCardAudio,
            CARD_ROOM_DEAL_CARD_AUDIO_LATE_WINDOW_MS,
          );
        });
      });
    }

    if (motion.communityRevealCount > 0 && Number.isFinite(motion.communityRevealStartedAt)) {
      const revealEnd = motion.communityRevealFrom + motion.communityRevealCount;
      for (let index = motion.communityRevealFrom; index < revealEnd; index += 1) {
        if (!currentTable.communityCards[index]) continue;
        const dealAt =
          motion.communityRevealStartedAt +
          (index - motion.communityRevealFrom) * CARD_ROOM_COMMUNITY_CARD_REVEAL_STAGGER_MS;
        playTimedCardRoomAudioIfDue(
          playedDealCardAudioKeysRef.current,
          `community:${currentTable.handNumber}:${index}`,
          dealAt,
          now,
          playDealCardAudio,
          CARD_ROOM_DEAL_CARD_AUDIO_LATE_WINDOW_MS,
        );
      }
    }
  };

  const playFoldAudioForAction = (
    currentTable: HoldemTableState,
    player: HoldemPlayer,
    snapshot: string,
  ) => {
    if (!player.lastAction?.includes("fold")) return;
    if (foldAudioHandNumberRef.current !== currentTable.handNumber) {
      foldAudioHandNumberRef.current = currentTable.handNumber;
      playedFoldAudioKeysRef.current.clear();
    }

    const key = `fold:${currentTable.handNumber}:${player.avatarId}:${snapshot}`;
    if (playedFoldAudioKeysRef.current.has(key)) return;
    playedFoldAudioKeysRef.current.add(key);
    playFoldAudio();
  };

  const playCheckAudioForAction = (
    currentTable: HoldemTableState,
    player: HoldemPlayer,
    snapshot: string,
  ) => {
    if (!player.lastAction?.includes("check")) return;
    if (checkAudioHandNumberRef.current !== currentTable.handNumber) {
      checkAudioHandNumberRef.current = currentTable.handNumber;
      playedCheckAudioKeysRef.current.clear();
    }

    const key = `check:${currentTable.handNumber}:${player.avatarId}:${snapshot}`;
    if (playedCheckAudioKeysRef.current.has(key)) return;
    playedCheckAudioKeysRef.current.add(key);
    playCheckAudio();
  };

  const playChipAudioForFrame = (
    currentTable: HoldemTableState,
    motion: CardRoomTableMotion,
    now: number,
  ) => {
    if (motion.handNumber !== currentTable.handNumber) return;
    if (chipAudioHandNumberRef.current !== currentTable.handNumber) {
      chipAudioHandNumberRef.current = currentTable.handNumber;
      playedChipAudioKeysRef.current.clear();
    }

    motion.chipFlights.forEach((flight) => {
      const playAudio =
        flight.actionType === "all-in" ? playChipAllInAudio : playChipBetAudio;
      playTimedCardRoomAudioIfDue(
        playedChipAudioKeysRef.current,
        `chip:${flight.handNumber}:${flight.actionSerial}:${flight.avatarId}:${flight.fromCommitted}:${flight.toCommitted}`,
        flight.startedAt,
        now,
        playAudio,
        CARD_ROOM_CHIP_AUDIO_LATE_WINDOW_MS,
      );
    });

    let collectionStartedAt = Number.POSITIVE_INFINITY;
    let collectionActionSerial = motion.actionSerial;
    motion.potCollectionFlights.forEach((flight) => {
      if (flight.startedAt < collectionStartedAt) {
        collectionStartedAt = flight.startedAt;
        collectionActionSerial = flight.actionSerial;
      }
    });
    playTimedCardRoomAudioIfDue(
      playedChipAudioKeysRef.current,
      `collect:${motion.handNumber}:${collectionActionSerial}`,
      collectionStartedAt,
      now,
      playChipPayoutAudio,
      CARD_ROOM_CHIP_SETTLEMENT_AUDIO_LATE_WINDOW_MS,
    );

    let payoutStartedAt = Number.POSITIVE_INFINITY;
    let payoutActionSerial = motion.actionSerial;
    motion.payoutFlights.forEach((flight) => {
      if (flight.startedAt < payoutStartedAt) {
        payoutStartedAt = flight.startedAt;
        payoutActionSerial = flight.actionSerial;
      }
    });
    playTimedCardRoomAudioIfDue(
      playedChipAudioKeysRef.current,
      `payout:${motion.handNumber}:${payoutActionSerial}`,
      payoutStartedAt,
      now,
      playChipPayoutAudio,
      CARD_ROOM_CHIP_SETTLEMENT_AUDIO_LATE_WINDOW_MS,
    );
  };

  const playUserWinAudioForFrame = (
    effect: { handNumber: number; startedAt: number } | null,
    now: number,
  ) => {
    if (!effect) return;
    playTimedCardRoomAudioIfDue(
      playedUserWinAudioKeysRef.current,
      `user-win:${effect.handNumber}:${Math.round(effect.startedAt)}`,
      effect.startedAt,
      now,
      playUserWinAudio,
      CARD_ROOM_USER_WIN_AUDIO_LATE_WINDOW_MS,
    );
  };

  const playCharacterWinAudioForFrame = (
    currentTable: HoldemTableState,
    motion: CardRoomTableMotion,
    now: number,
  ) => {
    if (motion.handNumber !== currentTable.handNumber) return;
    if (currentTable.street !== "handComplete") return;
    if (currentTable.winners.length === 0) return;
    if (userWonTable(currentTable) || !characterWonTable(currentTable)) return;

    const winAt = motion.completionStartedAt ?? motion.streetStartedAt;
    const winnerSeatKey = currentTable.winners
      .map((winner) => winner.seatIndex)
      .sort((left, right) => left - right)
      .join("-");
    playTimedCardRoomAudioIfDue(
      playedCharacterWinAudioKeysRef.current,
      `character-win:${currentTable.handNumber}:${winnerSeatKey}`,
      winAt,
      now,
      playCharacterWinAudio,
      CARD_ROOM_CHARACTER_WIN_AUDIO_LATE_WINDOW_MS,
    );
  };

  const endCardRoomVisit = (slotId: string, keepalive = false) => {
    const visit = activeCardRoomVisitsRef.current.get(slotId);
    if (!visit) return;

    activeCardRoomVisitsRef.current.delete(slotId);
    const endedVisit = normalizeVisitSession({
      ...visit,
      host: currentCardRoomPresence(),
      phase: "ended",
      updatedAt: roomVisitNowIso(),
      expiresAt: roomVisitExpiresAt(30000),
    });
    if (!endedVisit) return;
    void postCardRoomJson(CARD_ROOM_VISIT_END_URL, endedVisit, { keepalive }).catch(() => {
      console.warn("Could not end card room visit.");
    });
  };

  const endAllCardRoomVisits = (keepalive = false) => {
    Array.from(activeCardRoomVisitsRef.current.keys()).forEach((slotId) =>
      endCardRoomVisit(slotId, keepalive),
    );
  };

  const keepCardRoomVisitAlive = (
    slotId: string,
    visit: AivatarVisitSession,
    guestRoom: AivatarRoomPresence | undefined,
  ) => {
    if (visit.phase === "ended" || visit.phase === "cancelled") return;
    const nextVisit = normalizeVisitSession({
      ...visit,
      host: currentCardRoomPresence(),
      guest: guestRoom ?? visit.guest,
      updatedAt: roomVisitNowIso(),
      expiresAt: roomVisitExpiresAt(CARD_ROOM_VISIT_TTL_MS),
    });
    if (!nextVisit) return;
    activeCardRoomVisitsRef.current.set(slotId, nextVisit);
    void postCardRoomJson(CARD_ROOM_VISIT_STATE_URL, nextVisit).catch(() => {
      console.warn("Could not keep card room visit alive.");
    });
  };

  const inviteRoomToCardRoom = (room: AivatarRoomPresence) => {
    if (activeCardRoomVisitsRef.current.has(room.slotId)) return;
    const visit = normalizeVisitSession({
      type: "aivatar.room.visit",
      visitKind: "card-room",
      visitId: createVisitId(),
      phase: "invited",
      host: currentCardRoomPresence(),
      guest: room,
      hostLayoutFingerprint: "card-room",
      hostRoomId: "card-room",
      createdAt: roomVisitNowIso(),
      updatedAt: roomVisitNowIso(),
      expiresAt: roomVisitExpiresAt(CARD_ROOM_VISIT_TTL_MS),
    });
    if (!visit) return;

    activeCardRoomVisitsRef.current.set(room.slotId, visit);
    setStatusMessage(ui("cardRoom.invitedToPlay", { name: room.avatarName }));
    void postCardRoomJson(CARD_ROOM_VISIT_INVITE_URL, visit).catch(() => {
      activeCardRoomVisitsRef.current.delete(room.slotId);
      console.warn("Could not invite room to card room.");
    });
  };

  const syncCardRoomInvites = (snapshot: AivatarRoomsSnapshot) => {
    const selectedSlots = new Set(selectedSlotIds);
    const roomForSlot = (slotId: string) => {
      const candidates = snapshot.rooms.filter(
        (room) =>
          room.slotId === slotId &&
          room.roomId !== "card-room" &&
          room.roomInstanceId !== cardRoomInstanceIdRef.current,
      );
      return candidates.find((room) => room.status === "home") ?? candidates[0];
    };

    activeCardRoomVisitsRef.current.forEach((visit, slotId) => {
      const latestVisit = snapshot.visits.find(
        (candidate) => candidate.visitId === visit.visitId,
      );
      if (
        latestVisit &&
        (latestVisit.phase === "ended" || latestVisit.phase === "cancelled")
      ) {
        activeCardRoomVisitsRef.current.delete(slotId);
        return;
      }
      if (latestVisit) {
        activeCardRoomVisitsRef.current.set(slotId, latestVisit);
      }
    });

    activeCardRoomVisitsRef.current.forEach((_visit, slotId) => {
      if (!selectedSlots.has(slotId)) {
        endCardRoomVisit(slotId);
      }
    });

    selectedSlotIds.forEach((slotId) => {
      if (!availableCompanions.some((character) => character.slotId === slotId)) return;
      const guestRoom = roomForSlot(slotId);
      const currentVisit = activeCardRoomVisitsRef.current.get(slotId);
      if (currentVisit) {
        keepCardRoomVisitAlive(slotId, currentVisit, guestRoom);
        return;
      }
      if (guestRoom?.status === "home") {
        inviteRoomToCardRoom(guestRoom);
      }
    });
  };

  useEffect(() => {
    localStorage.setItem(LOCALE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    let stopped = false;

    const syncRooms = async () => {
      try {
        await postCardRoomJson(CARD_ROOM_ROOMS_URL, currentCardRoomPresence());
        const response = await fetch(CARD_ROOM_ROOMS_URL);
        if (!response.ok) {
          throw new Error(`Card room rooms snapshot failed: ${response.status}`);
        }
        const snapshot = normalizeCardRoomSnapshot(await response.json());
        if (stopped) return;
        roomSnapshotRef.current = snapshot;
        setRoomSnapshot(snapshot);
      } catch {
        // The Card Room still works without the local bridge; open save windows just cannot leave.
      }
    };

    void syncRooms();
    const timer = window.setInterval(syncRooms, CARD_ROOM_PRESENCE_SYNC_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [hostSlotId]);

  useEffect(() => {
    if (!roomSnapshot) return;
    roomSnapshotRef.current = roomSnapshot;
    syncCardRoomInvites(roomSnapshot);
  }, [availableCompanions, roomSnapshot, selectedSlotIds]);

  useEffect(() => {
    const handlePageHide = () => endAllCardRoomVisits(true);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      endAllCardRoomVisits(true);
    };
  }, []);

  useEffect(() => {
    const currentTable = tableRef.current;
    const handInProgressForStacks =
      currentTable.street !== "waiting" && currentTable.street !== "handComplete";
    setStacks({
      [USER_PLAYER_AVATAR_ID]: normalizePokerChips(playerWalletRef.current.pokerChips),
      ...mergeDefaultStacks(roster, {}),
      ...(handInProgressForStacks ? stacksFromTable(currentTable) : {}),
    });
  }, [roster]);

  useEffect(() => {
    tableRef.current = table;
  }, [table]);

  useEffect(() => {
    userVictoryEffectRef.current = userVictoryEffect;
  }, [userVictoryEffect]);

  useEffect(() => {
    if (!userVictoryEffect) return undefined;
    const timer = window.setTimeout(() => {
      setUserVictoryEffect(null);
    }, 5600);
    return () => window.clearTimeout(timer);
  }, [userVictoryEffect?.handNumber, userVictoryEffect?.startedAt]);

  useEffect(() => {
    if (!initialVictoryDemoEnabled() || victoryDemoPlayedRef.current) return;
    victoryDemoPlayedRef.current = true;
    setUserVictoryEffect({
      handNumber: -1,
      startedAt: performance.now(),
    });
  }, []);

  useEffect(() => {
    const foldAudioPool = createCardRoomAudioPool(
      [CARD_ROOM_FOLD_AUDIO_SRC],
      CARD_ROOM_FOLD_AUDIO_POOL_SIZE,
    );
    const checkAudioPool = createCardRoomAudioPool(
      [CARD_ROOM_CHECK_AUDIO_SRC],
      CARD_ROOM_CHECK_AUDIO_POOL_SIZE,
    );
    const chipBetAudioPool = createCardRoomAudioPool(
      CARD_ROOM_CHIP_BET_AUDIO_SRCS,
      CARD_ROOM_CHIP_BET_AUDIO_POOL_SIZE,
    );
    const chipAllInAudioPool = createCardRoomAudioPool(
      [CARD_ROOM_CHIP_ALL_IN_AUDIO_SRC],
      CARD_ROOM_CHIP_ALL_IN_AUDIO_POOL_SIZE,
    );
    const chipPayoutAudioPool = createCardRoomAudioPool(
      [CARD_ROOM_CHIP_PAYOUT_AUDIO_SRC],
      CARD_ROOM_CHIP_PAYOUT_AUDIO_POOL_SIZE,
    );
    const userWinAudioPool = createCardRoomAudioPool(
      [CARD_ROOM_USER_WIN_AUDIO_SRC],
      CARD_ROOM_USER_WIN_AUDIO_POOL_SIZE,
    );
    const characterWinAudioPool = createCardRoomAudioPool(
      CARD_ROOM_CHARACTER_WIN_AUDIO_SRCS,
      CARD_ROOM_CHARACTER_WIN_AUDIO_SRCS.length,
    );
    foldAudioPoolRef.current = foldAudioPool;
    checkAudioPoolRef.current = checkAudioPool;
    chipBetAudioPoolRef.current = chipBetAudioPool;
    chipAllInAudioPoolRef.current = chipAllInAudioPool;
    chipPayoutAudioPoolRef.current = chipPayoutAudioPool;
    userWinAudioPoolRef.current = userWinAudioPool;
    characterWinAudioPoolRef.current = characterWinAudioPool;
    applyCardRoomAudioVolume();

    return () => {
      pauseCardRoomAudioPool(foldAudioPool);
      pauseCardRoomAudioPool(checkAudioPool);
      pauseCardRoomAudioPool(chipBetAudioPool);
      pauseCardRoomAudioPool(chipAllInAudioPool);
      pauseCardRoomAudioPool(chipPayoutAudioPool);
      pauseCardRoomAudioPool(userWinAudioPool);
      pauseCardRoomAudioPool(characterWinAudioPool);
      const dealAudioContext = dealCardAudioContextRef.current;
      if (dealAudioContext && dealAudioContext.state !== "closed") {
        void dealAudioContext.close().catch(() => undefined);
      }
      dealCardAudioContextRef.current = null;
      dealCardAudioBufferRef.current = null;
      dealCardAudioBufferLoadingRef.current = null;
      foldAudioPoolRef.current = [];
      checkAudioPoolRef.current = [];
      chipBetAudioPoolRef.current = [];
      chipAllInAudioPoolRef.current = [];
      chipPayoutAudioPoolRef.current = [];
      userWinAudioPoolRef.current = [];
      characterWinAudioPoolRef.current = [];
    };
  }, []);

  useEffect(() => {
    const unlockCardRoomAudio = () => {
      cardRoomAudioUnlockedRef.current = true;
      const context = ensureDealCardAudioContext();
      if (context?.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
      void loadDealCardAudioBuffer();
    };

    window.addEventListener("pointerdown", unlockCardRoomAudio);
    window.addEventListener("keydown", unlockCardRoomAudio);
    window.addEventListener("touchstart", unlockCardRoomAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockCardRoomAudio);
      window.removeEventListener("keydown", unlockCardRoomAudio);
      window.removeEventListener("touchstart", unlockCardRoomAudio);
    };
  }, []);

  useEffect(() => {
    const refreshCardRoomAudioVolume = () => {
      cardRoomAudioVolumeRef.current = readCardRoomAudioVolume();
      applyCardRoomAudioVolume();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CARD_ROOM_AUDIO_VOLUME_KEY) {
        refreshCardRoomAudioVolume();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", refreshCardRoomAudioVolume);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", refreshCardRoomAudioVolume);
    };
  }, []);

  useEffect(() => {
    currentCardRoomContentRef.current = currentCardRoomContent;
  }, [currentCardRoomContent]);

  useEffect(() => {
    playerWalletRef.current = playerWallet;
  }, [playerWallet]);

  useEffect(() => {
    houseBankRef.current = houseBank;
  }, [houseBank]);

  useEffect(() => {
    freeRoamEnabledRef.current = freeRoamEnabled;
  }, [freeRoamEnabled]);

  useEffect(() => {
    hostCharacterRef.current = hostDisplayCharacter;
    seatedCharactersRef.current = seatedCharacters;
  }, [hostDisplayCharacter, seatedCharacters]);

  useEffect(() => {
    if (!hostDisplayCharacter) return;
    setTable((current) => {
      if (
        !current.players.some(
          (player) =>
            player.avatarId === hostDisplayCharacter.avatarId &&
            player.avatarName !== hostDisplayCharacter.avatarName,
        )
      ) {
        return current;
      }
      return {
        ...current,
        players: current.players.map((player) =>
          player.avatarId === hostDisplayCharacter.avatarId
            ? { ...player, avatarName: hostDisplayCharacter.avatarName }
            : player,
        ),
        winners: current.winners.map((winner) =>
          current.players[winner.seatIndex]?.avatarId === hostDisplayCharacter.avatarId
            ? { ...winner, avatarName: hostDisplayCharacter.avatarName }
            : winner,
        ),
      };
    });
  }, [hostDisplayCharacter?.avatarId, hostDisplayCharacter?.avatarName]);

  useEffect(() => {
    let animationFrame = 0;
    let animationFrameId = 0;
    let previous = performance.now();
    let stopped = false;

    const draw = (now: number) => {
      if (stopped) return;
      const elapsedSeconds = Math.min(0.05, Math.max(0.001, (now - previous) / 1000));
      previous = now;
      if (canvasRef.current) {
        const currentTable = tableRef.current;
        const content = currentCardRoomContentRef.current;
        const copy = cardRoomCopyRef.current;
        const host = hostCharacterRef.current;
        const characters =
          seatedCharactersRef.current.length > 0
            ? seatedCharactersRef.current
            : [fallbackRuntimeCharacter];
        const playerByAvatarId = new Map(
          currentTable.players.map((player) => [player.avatarId, player]),
        );
        const opponents = currentTable.players.filter((player) => !player.isUser);
        const visitorStateMap = visitorStatesRef.current;
        const tablePlaying =
          currentTable.street !== "waiting" &&
          currentTable.street !== "handComplete" &&
          currentTable.players.length > 0;
        const freeRoam =
          !tablePlaying && (freeRoamEnabledRef.current || currentTable.street === "waiting");
        const previousPartners = characters
          .map((character) => {
            const visitorState = visitorStateMap[character.avatarId];
            return {
              avatarId: character.avatarId,
              avatarName: character.avatarName,
              runtime: visitorState?.runtime,
              phase: visitorState?.phase,
            };
          })
          .filter((entry): entry is {
            avatarId: string;
            avatarName: string;
            runtime: AvatarRuntime;
            phase: CardRoomVisitorState["phase"];
          } => Boolean(entry.runtime && entry.phase !== "pending" && entry.avatarId !== host?.avatarId));
        const nextVisitorStateMap: Record<string, CardRoomVisitorState> = {};
        const nextRuntimeMap: Record<string, AvatarRuntime> = {};
        const bubbleMap: Record<string, { text: string; startedAt: number }> = {};
        const previousSnapshots = playerActionSnapshotsRef.current;
        const nextSnapshots: Record<string, string> = {};
        const nextActionCues: Record<string, CardRoomActionCue> = {};
        currentTable.players.forEach((player) => {
          const snapshot = playerActionSnapshot(player);
          nextSnapshots[player.avatarId] = snapshot;
          const currentCue = actionCuesRef.current[player.avatarId];
          if (currentCue && now - currentCue.startedAt <= currentCue.durationMs) {
            nextActionCues[player.avatarId] = currentCue;
          }
          if (player.lastAction && previousSnapshots[player.avatarId] !== snapshot) {
            const cue = actionCueFromLastAction(player.lastAction, now, copy);
            if (cue) nextActionCues[player.avatarId] = cue;
            if (previousSnapshots[player.avatarId] !== undefined) {
              playFoldAudioForAction(currentTable, player, snapshot);
              playCheckAudioForAction(currentTable, player, snapshot);
            }
          }
        });
        playerActionSnapshotsRef.current = nextSnapshots;
        actionCuesRef.current = nextActionCues;
        characters.forEach((character, index) => {
          const isUser = character.avatarId === host?.avatarId;
          const player = playerByAvatarId.get(character.avatarId);
          const opponentIndex = player
            ? player.roomSeatIndex ??
              opponents.findIndex((opponent) => opponent.avatarId === player.avatarId)
            : Math.max(0, index - 1);
          const state =
            visitorStateMap[character.avatarId] ??
            createInitialCardRoomVisitorState(character, index, isUser, now, copy);
          const nextState = advanceCardRoomVisitorState(
            state,
            elapsedSeconds,
            {
              character,
              isUser,
              player,
              opponentIndex,
              opponentCount: opponents.length,
              navigationKey: cardRoomNavigationScopeKey(roomKey, character.avatarId),
              table: currentTable,
              content,
              freeRoam,
              now,
              navMemory: cardRoomNavMemoryRef.current,
              partners: previousPartners.filter((partner) => partner.avatarId !== character.avatarId),
              actionCue: nextActionCues[character.avatarId],
              copy,
            },
          );
          nextVisitorStateMap[character.avatarId] = nextState;
          if (nextState.phase !== "pending") {
            nextRuntimeMap[character.avatarId] = nextState.runtime;
            if (nextState.bubbleText && typeof nextState.bubbleStartedAt === "number") {
              bubbleMap[character.avatarId] = {
                text: nextState.bubbleText,
                startedAt: nextState.bubbleStartedAt,
              };
            }
          }
        });
        visitorStatesRef.current = nextVisitorStateMap;
        const wasPlayersSeatedReady = playersSeatedReadyRef.current;
        const nextPlayersSeatedReady =
          !tablePlaying ||
          currentTable.players.every((player) => {
            if (player.isUser) return true;
            return nextVisitorStateMap[player.avatarId]?.phase === "seated";
          });
        if (wasPlayersSeatedReady !== nextPlayersSeatedReady) {
          playersSeatedReadyRef.current = nextPlayersSeatedReady;
          setPlayersSeatedReady(nextPlayersSeatedReady);
        }
        if (!wasPlayersSeatedReady && nextPlayersSeatedReady && tablePlaying) {
          const currentMotion = tableMotionRef.current;
          if (
            currentMotion.handNumber === currentTable.handNumber &&
            !Number.isFinite(currentMotion.handStartedAt)
          ) {
            tableMotionRef.current = {
              ...currentMotion,
              handStartedAt: now,
              actionStartedAt: now,
            };
          }
        }
        const nextUserHandCardsReady = handHudCardsReadyForPlayer(
          currentTable,
          currentTable.players.find((player) => player.isUser),
          tableMotionRef.current,
          now,
        );
        if (userHandCardsReadyRef.current !== nextUserHandCardsReady) {
          userHandCardsReadyRef.current = nextUserHandCardsReady;
          setUserHandCardsReady(nextUserHandCardsReady);
        }
        playDealCardAudioForFrame(currentTable, tableMotionRef.current, now);
        playChipAudioForFrame(currentTable, tableMotionRef.current, now);
        playUserWinAudioForFrame(userVictoryEffectRef.current, now);
        playCharacterWinAudioForFrame(currentTable, tableMotionRef.current, now);
        renderCardRoom(canvasRef.current, {
          content,
          table: currentTable,
          characters,
          runtimes: nextRuntimeMap,
          bubbles: bubbleMap,
          actionCues: nextActionCues,
          motion: tableMotionRef.current,
          frame: animationFrame,
          now,
          userAvatarId: host?.avatarId,
        });
        animationFrame += elapsedSeconds * 30;
      }
      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrameId);
    };
  }, [roomKey]);

  const persistTablePokerChips = (players: HoldemPlayer[]) => {
    const updates = new Map<string, number>();
    let nextPlayerWallet: PlayerChipWallet | null = null;
    players.forEach((player) => {
      if (player.isUser) {
        nextPlayerWallet = writePlayerChipWallet({
          ...playerWalletRef.current,
          pokerChips: player.stack,
        });
        return;
      }

      const nextPokerChips = writeCardRoomSaveSlotPokerChips(player.slotId, player.stack);
      if (nextPokerChips !== null) {
        updates.set(player.slotId, nextPokerChips);
      }
    });
    if (nextPlayerWallet) {
      playerWalletRef.current = nextPlayerWallet;
      setPlayerWallet(nextPlayerWallet);
    }
    if (updates.size === 0) {
      return;
    }

    setRoster((current) =>
      current.map((character) =>
        updates.has(character.slotId)
          ? {
              ...character,
              pokerChips: updates.get(character.slotId) ?? character.pokerChips,
            }
          : character,
      ),
    );
  };

  const commitTable = (nextTable: HoldemTableState) => {
    const previousTable = tableRef.current;
    const now = performance.now();
    const previousMotion = tableMotionRef.current;
    const communityRevealCount = Math.max(
      0,
      nextTable.communityCards.length - previousTable.communityCards.length,
    );
    const winningAvatarIds = winnerAvatarIdsForTable(nextTable);
    const handChanged =
      nextTable.handNumber !== previousTable.handNumber ||
      (previousTable.street === "waiting" && nextTable.street !== "waiting");
    const streetChanged = nextTable.street !== previousTable.street;
    const actionChanged = nextTable.actionSerial !== previousTable.actionSerial;
    const nextChipFlights = chipFlightsForTableTransition(previousTable, nextTable, now);
    const continuingChipFlights = handChanged
      ? []
      : previousMotion.chipFlights.filter(
          (flight) => now - flight.startedAt <= CARD_ROOM_CHIP_FLIGHT_KEEPALIVE_MS,
        );
    const completionStartedAt =
      nextTable.street === "handComplete" && nextTable.winners.length > 0
        ? previousTable.street === "handComplete" &&
          previousTable.handNumber === nextTable.handNumber
          ? previousMotion.completionStartedAt
          : now + communityRevealCount * 130 + (communityRevealCount > 0 ? 440 : 0)
        : null;
    const collectionStartedAt =
      (completionStartedAt ?? now) + CARD_ROOM_POT_COLLECTION_FLIGHT_START_DELAY_MS;
    const nextPotCollectionFlights = potCollectionFlightsForTableTransition(
      previousTable,
      nextTable,
      collectionStartedAt,
    );
    const nextPayoutFlights = payoutFlightsForTableTransition(
      previousTable,
      nextTable,
      nextPotCollectionFlights.length > 0
        ? collectionStartedAt +
          CARD_ROOM_POT_COLLECTION_TO_PAYOUT_DELAY_MS +
          nextPotCollectionFlights.length * 70
        : (completionStartedAt ?? now) + 160,
    );
    const continuingPotCollectionFlights = handChanged
      ? []
      : previousMotion.potCollectionFlights.filter(
          (flight) => now - flight.startedAt <= CARD_ROOM_POT_COLLECTION_FLIGHT_KEEPALIVE_MS,
        );
    const continuingPayoutFlights = handChanged
      ? []
      : previousMotion.payoutFlights.filter(
          (flight) => now - flight.startedAt <= CARD_ROOM_PAYOUT_FLIGHT_KEEPALIVE_MS,
        );

    tableMotionRef.current = {
      ...previousMotion,
      handNumber: nextTable.handNumber,
      handStartedAt: handChanged ? Number.POSITIVE_INFINITY : previousMotion.handStartedAt,
      street: nextTable.street,
      streetStartedAt: streetChanged || handChanged ? now : previousMotion.streetStartedAt,
      actionSerial: nextTable.actionSerial,
      actionStartedAt: actionChanged || handChanged ? now : previousMotion.actionStartedAt,
      chipFlights: [...continuingChipFlights, ...nextChipFlights].slice(-32),
      potCollectionFlights: [
        ...continuingPotCollectionFlights,
        ...nextPotCollectionFlights,
      ].slice(-16),
      payoutFlights: [...continuingPayoutFlights, ...nextPayoutFlights].slice(-16),
      communityRevealFrom:
        communityRevealCount > 0
          ? previousTable.communityCards.length
          : handChanged
            ? 0
            : previousMotion.communityRevealFrom,
      communityRevealCount:
        communityRevealCount > 0 ? communityRevealCount : handChanged ? 0 : previousMotion.communityRevealCount,
      communityRevealStartedAt:
        communityRevealCount > 0 ? now : handChanged ? 0 : previousMotion.communityRevealStartedAt,
      completionStartedAt,
      winningAvatarIds,
      userVictoryStartedAt:
        nextTable.street === "handComplete" && userWonTable(nextTable)
          ? completionStartedAt ?? now
          : null,
    };
    if (handChanged) {
      userHandCardsReadyRef.current = false;
      setUserHandCardsReady(false);
    }

    if (nextTable.street === "handComplete" && userWonTable(nextTable)) {
      setUserVictoryEffect({
        handNumber: nextTable.handNumber,
        startedAt: now,
      });
    }

    tableRef.current = nextTable;
    setTable(nextTable);
    setCalledClock((current) => {
      if (!current) return current;
      const clockStillApplies =
        nextTable.handNumber === current.handNumber &&
        nextTable.actionSerial === current.actionSerial &&
        nextTable.activeSeatIndex === current.seatIndex &&
        nextTable.street !== "waiting" &&
        nextTable.street !== "handComplete";
      return clockStillApplies ? current : null;
    });
    if (nextTable.players.length > 0) {
      setStacks((current) => ({
        ...current,
        ...stacksFromTable(nextTable),
      }));
      persistTablePokerChips(nextTable.players);
    }
  };

  const refreshRoster = () => {
    const nextRoster = readCardRoomRoster();
    setRoster(nextRoster);
    setStatusMessage(ui("cardRoom.rosterRefreshed", { value: nextRoster.length }));
  };

  const summonAllCompanions = () => {
    setSelectedSlotIds(availableCompanions.map((character) => character.slotId));
    setFreeRoamEnabled(true);
  };

  const toggleCompanion = (slotId: string) => {
    setSelectedSlotIds((current) =>
      current.includes(slotId)
        ? current.filter((value) => value !== slotId)
        : [...current, slotId].slice(0, MAX_COMPANIONS),
    );
    setFreeRoamEnabled(true);
  };

  const updatePlayerName = (value: string) => {
    setPlayerNameOverrides((current) => ({
      ...current,
      [playerNameKey]: value,
    }));
    try {
      const trimmed = value.trim();
      if (trimmed) {
        localStorage.setItem(playerNameStorageKey(null), trimmed);
      } else {
        localStorage.removeItem(playerNameStorageKey(null));
      }
    } catch {
      // Ignore storage failures in webviews with restricted persistence.
    }
  };

  const startHand = () => {
    if (table.street !== "waiting" && table.street !== "handComplete") return;
    if (seatedCharacters.length < 2) {
      setStatusMessage(ui("cardRoom.needPlayers"));
      return;
    }
    const currentStacks = stacksForNextHand(seatedCharacters, stacks, table);
    const players = orderPlayersClockwise(
      assignRoomSeats(
        createHoldemPlayers(seatedCharacters, currentStacks, hostDisplayCharacter.avatarId),
        table.players,
      ),
    );
    const hostStartingPlayer = players.find((player) => player.isUser);
    const nextTable = startHoldemHand(table, players);
    const handStarted =
      nextTable.handNumber !== table.handNumber || nextTable.street !== table.street;
    if (!handStarted) {
      commitTable(nextTable);
      setStatusMessage(
        players.filter((player) => creditAvailable(player) > 0).length < 2
          ? ui("cardRoom.needChips")
          : translateCardRoomTableText(nextTable.message, ui),
      );
      return;
    }

    setFreeRoamEnabled(false);
    setUserVictoryEffect(null);
    setCalledClock(null);
    playersSeatedReadyRef.current = false;
    setPlayersSeatedReady(false);
    actionCuesRef.current = {};
    playerActionSnapshotsRef.current = {};
    hostHandDarkStatsRef.current =
      hostStartingPlayer && nextTable.players.some((player) => player.isUser)
        ? createHandDarkStats(nextTable, hostStartingPlayer, previousHostHandNetRef.current)
        : null;
    processedDarkTraitHandRef.current = null;
    commitTable(nextTable);
    setStatusMessage("");
  };

  const releaseCompanionsFromTable = () => {
    if (table.street !== "waiting" && table.street !== "handComplete") return;
    setFreeRoamEnabled(true);
    setStatusMessage(ui("cardRoom.freeRoamStarted"));
  };

  const updateHouseBank = (
    updater: (current: CardRoomHouseBank) => CardRoomHouseBank | null,
  ) => {
    const next = updater(houseBankRef.current);
    if (!next) return null;
    const normalized = writeHouseBank(next);
    houseBankRef.current = normalized;
    setHouseBank(normalized);
    return normalized;
  };

  const withdrawHouseBits = () => {
    const available = Math.max(0, normalizeHouseBits(houseBankRef.current.vaultBits));
    if (available <= 0) {
      setStatusMessage(ui("cardRoom.houseBankEmpty"));
      return;
    }

    updateHouseBank(withdrawHouseVaultBits);
    setStatusMessage(ui("cardRoom.houseBankWithdrawn", { bits: available }));
  };

  const settleHouseDebt = () => {
    const currentBank = houseBankRef.current;
    const payment = Math.min(
      normalizeHouseBits(currentBank.vaultBits),
      normalizePayoutDebtBits(currentBank.payoutDebtBits),
    );
    if (payment <= 0) {
      setStatusMessage(ui("cardRoom.houseDebtNoSettlement"));
      return;
    }

    const nextBank = updateHouseBank(settleHouseBankDebt);
    setStatusMessage(
      ui("cardRoom.houseDebtSettled", {
        bits: payment,
        vault: nextBank?.vaultBits ?? houseBankRef.current.vaultBits,
        debt: nextBank?.payoutDebtBits ?? houseBankRef.current.payoutDebtBits,
      }),
    );
  };

  const giftCharacterChips = (character: CardRoomCharacter) => {
    if (character.avatarId === USER_PLAYER_AVATAR_ID) return;
    const handIsRunning = table.street !== "waiting" && table.street !== "handComplete";
    if (handIsRunning) {
      setStatusMessage(ui("cardRoom.chipShopLocked"));
      return;
    }
    if (normalizeOwnerBits(houseBankRef.current.ownerBits) < CARD_ROOM_CHIP_BUNDLE_BITS) {
      setStatusMessage(ui("cardRoom.giftChipsOwnerBitsInsufficient"));
      return;
    }

    const currentPokerChips = stacks[character.avatarId] ?? character.pokerChips;
    const nextWallet = giftCardRoomSaveSlotPokerChips(
      character.slotId,
      currentPokerChips,
      CARD_ROOM_CHIP_BUNDLE_CHIPS,
    );
    if (!nextWallet) {
      setStatusMessage(ui("cardRoom.giftChipsFailed", { name: character.avatarName }));
      return;
    }

    const nextBank = updateHouseBank((current) =>
      spendOwnerBits(current, CARD_ROOM_CHIP_BUNDLE_BITS),
    );
    if (!nextBank) {
      setStatusMessage(ui("cardRoom.giftChipsOwnerBitsInsufficient"));
      return;
    }

    setRoster((current) =>
      current.map((candidate) =>
        candidate.slotId === character.slotId
          ? {
              ...candidate,
              walletBits: nextWallet.bits,
              pokerChips: nextWallet.pokerChips,
            }
          : candidate,
      ),
    );
    setStacks((current) => ({
      ...current,
      [character.avatarId]: nextWallet.pokerChips,
    }));
    setStatusMessage(
      ui("cardRoom.giftChipsComplete", {
        name: character.avatarName,
        bits: CARD_ROOM_CHIP_BUNDLE_BITS,
        chips: nextWallet.giftedChips,
      }),
    );
  };

  const exchangeCharacterChips = (character: CardRoomCharacter) => {
    const handIsRunning = table.street !== "waiting" && table.street !== "handComplete";
    if (handIsRunning) {
      setStatusMessage(ui("cardRoom.chipShopLocked"));
      return;
    }

    const currentPokerChips = stacks[character.avatarId] ?? character.pokerChips;
    if (character.avatarId === USER_PLAYER_AVATAR_ID) {
      const currentWallet = {
        ...playerWalletRef.current,
        pokerChips: currentPokerChips,
      };
      if (normalizeOwnerBits(houseBankRef.current.ownerBits) >= CARD_ROOM_CHIP_BUNDLE_BITS) {
        const nextBank = updateHouseBank((current) =>
          spendOwnerBits(current, CARD_ROOM_CHIP_BUNDLE_BITS),
        );
        if (!nextBank) {
          setStatusMessage(ui("cardRoom.playerOwnerBitsInsufficient"));
          return;
        }

        const nextWallet = writePlayerChipWallet({
          ...currentWallet,
          pokerChips: normalizePokerChips(currentWallet.pokerChips) + CARD_ROOM_CHIP_BUNDLE_CHIPS,
        });
        playerWalletRef.current = nextWallet;
        setPlayerWallet(nextWallet);
        setStacks((current) => ({
          ...current,
          [USER_PLAYER_AVATAR_ID]: nextWallet.pokerChips,
        }));
        setStatusMessage(
          ui("cardRoom.playerOwnerExchangedChips", {
            bits: CARD_ROOM_CHIP_BUNDLE_BITS,
            chips: CARD_ROOM_CHIP_BUNDLE_CHIPS,
          }),
        );
        return;
      }

      if (!canBorrowPlayerPokerChips(currentWallet)) {
        setStatusMessage(ui("cardRoom.playerChipDebtLimit"));
        return;
      }

      const nextWallet = writePlayerChipWallet(borrowPlayerPokerChips(currentWallet));
      playerWalletRef.current = nextWallet;
      setPlayerWallet(nextWallet);
      setStacks((current) => ({
        ...current,
        [USER_PLAYER_AVATAR_ID]: nextWallet.pokerChips,
      }));
      setStatusMessage(
        ui("cardRoom.playerBorrowedChips", {
          chips: CARD_ROOM_CHIP_BUNDLE_CHIPS,
        }),
      );
      return;
    }

    const nextWallet = exchangeCardRoomSaveSlotPokerChips(
      character.slotId,
      currentPokerChips,
    );
    if (!nextWallet) {
      setStatusMessage(ui("cardRoom.chipShopDebtLimit"));
      return;
    }

    const spentBits = normalizeHouseBits(nextWallet.spentBits, CARD_ROOM_CHIP_BUNDLE_BITS);
    const nextBank = updateHouseBank((current) => addHouseVaultBits(current, spentBits));
    setRoster((current) =>
      current.map((candidate) =>
        candidate.slotId === character.slotId
          ? {
              ...candidate,
              walletBits: nextWallet.bits,
              pokerChips: nextWallet.pokerChips,
            }
          : candidate,
      ),
    );
    setStacks((current) => ({
      ...current,
      [character.avatarId]: nextWallet.pokerChips,
    }));
    setStatusMessage(
      ui("cardRoom.chipShopExchanged", {
        name: character.avatarName,
        chips: CARD_ROOM_CHIP_BUNDLE_CHIPS,
        bits: spentBits,
        vault: nextBank?.vaultBits ?? houseBankRef.current.vaultBits,
      }),
    );
  };

  const redeemCharacterBits = (character: CardRoomCharacter) => {
    if (character.avatarId === USER_PLAYER_AVATAR_ID) return;
    const handIsRunning = table.street !== "waiting" && table.street !== "handComplete";
    if (handIsRunning) {
      setStatusMessage(ui("cardRoom.chipShopLocked"));
      return;
    }

    const currentPokerChips = stacks[character.avatarId] ?? character.pokerChips;
    if (!canRedeemPokerChipsForBits({ pokerChips: currentPokerChips })) {
      setStatusMessage(ui("cardRoom.chipShopNeedChipsForBits"));
      return;
    }

    const nextWallet = redeemCardRoomSaveSlotPokerChipsForBits(
      character.slotId,
      currentPokerChips,
    );
    if (!nextWallet) {
      setStatusMessage(ui("cardRoom.chipShopNeedChipsForBits"));
      return;
    }

    const redeemedBits = normalizeHouseBits(nextWallet.redeemedBits, CARD_ROOM_CHIP_BUNDLE_BITS);
    const nextBank = updateHouseBank((current) => addHouseVaultBits(current, -redeemedBits));
    setRoster((current) =>
      current.map((candidate) =>
        candidate.slotId === character.slotId
          ? {
              ...candidate,
              walletBits: nextWallet.bits,
              pokerChips: nextWallet.pokerChips,
            }
          : candidate,
      ),
    );
    setStacks((current) => ({
      ...current,
      [character.avatarId]: nextWallet.pokerChips,
    }));
    setStatusMessage(
      ui("cardRoom.chipShopRedeemed", {
        name: character.avatarName,
        bits: redeemedBits,
        vault: nextBank?.vaultBits ?? houseBankRef.current.vaultBits,
      }),
    );
  };

  const spendOwnerDecorBits = (price: number): CardRoomHouseBank | null => {
    if (price <= 0) return houseBankRef.current;
    return updateHouseBank((current) => spendOwnerBits(current, price));
  };

  const isDecorItemActive = (item: CardRoomShopItem, decor = cardRoomDecor) => {
    if (item.cardRoomCategory === "wall") {
      return item.targetSurfaceId === decor.wallSurfaceId;
    }
    if (item.cardRoomCategory === "floor") {
      return item.targetSurfaceId === decor.floorSurfaceId;
    }
    if (item.cardRoomCategory === "window") {
      return item.targetWindowId === decor.windowId;
    }
    return decor.furnitureItemIds.includes(item.id);
  };

  const buyOrApplyDecorItem = (item: CardRoomShopItem) => {
    if (handInProgress) {
      setStatusMessage(ui("cardRoom.decorShopLocked"));
      return;
    }
    if (isDecorItemActive(item)) return;

    const purchased = cardRoomDecor.purchasedItemIds.includes(item.id);
    const purchaseCost = purchased ? 0 : item.price;
    if (!spendOwnerDecorBits(purchaseCost)) {
      setStatusMessage(ui("cardRoom.decorNotEnoughBits", { price: purchaseCost }));
      return;
    }

    const nextDecor: CardRoomDecorState = {
      ...cardRoomDecor,
      purchasedItemIds: purchased
        ? cardRoomDecor.purchasedItemIds
        : Array.from(new Set([...cardRoomDecor.purchasedItemIds, item.id])),
      furnitureItemIds: cardRoomDecor.furnitureItemIds,
    };
    if (item.cardRoomCategory === "wall" && item.targetSurfaceId) {
      nextDecor.wallSurfaceId = item.targetSurfaceId;
    } else if (item.cardRoomCategory === "floor" && item.targetSurfaceId) {
      nextDecor.floorSurfaceId = item.targetSurfaceId;
    } else if (item.cardRoomCategory === "window" && item.targetWindowId) {
      nextDecor.windowId = item.targetWindowId;
    } else if (item.cardRoomCategory === "furniture") {
      nextDecor.furnitureItemIds = Array.from(
        new Set([...cardRoomDecor.furnitureItemIds, item.id]),
      );
    }

    const normalizedDecor = writeCardRoomDecorState(nextDecor);
    setCardRoomDecor(normalizedDecor);
    setStatusMessage(
      ui(purchased ? "cardRoom.decorAppliedMessage" : "cardRoom.decorPurchasedMessage", {
        name: item.name,
        price: purchaseCost,
      }),
    );
  };

  const applyUserAction = (
    type: "fold" | "check" | "call" | "bet" | "raise" | "all-in",
    targetRoundBet?: number,
  ) => {
    const activePlayer =
      table.activeSeatIndex === null ? null : table.players[table.activeSeatIndex];
    if (!activePlayer?.isUser) return;
    if (!playersSeatedReadyRef.current) return;
    const legal = legalActionsForActivePlayer(table);
    const amount =
      type === "bet" || type === "raise"
        ? clampWagerTarget(targetRoundBet ?? wagerTargetInput, legal)
        : undefined;
    const action = { type, amount } as Parameters<typeof applyHoldemAction>[1];
    const stats = hostHandDarkStatsRef.current;
    if (stats && stats.handNumber === table.handNumber) {
      recordHandDarkAction(stats, table, activePlayer, action);
    }
    commitTable(applyHoldemAction(table, action));
  };

  const callClockForActivePlayer = () => {
    const activePlayer =
      table.activeSeatIndex === null ? null : table.players[table.activeSeatIndex];
    if (!activePlayer || activePlayer.isUser) return;
    if (!playersSeatedReadyRef.current) return;
    if (table.street === "waiting" || table.street === "handComplete") return;
    const now = performance.now();
    setClockNow(now);
    setCalledClock({
      handNumber: table.handNumber,
      actionSerial: table.actionSerial,
      seatIndex: activePlayer.seatIndex,
      avatarName: activePlayer.avatarName,
      startedAt: now,
      deadlineAt: now + CARD_ROOM_CLOCK_TOTAL_MS,
    });
    setStatusMessage(ui("cardRoom.clockCalledStatus", { name: activePlayer.avatarName }));
  };

  useEffect(() => {
    const activePlayer =
      table.activeSeatIndex === null ? null : table.players[table.activeSeatIndex];
    if (!activePlayer || activePlayer.isUser || table.street === "handComplete") return;
    if (!playersSeatedReady) return;
    const aiMove = choosePokerAiMove(table, activePlayer, cardRoomCopyRef.current);
    actionCuesRef.current = {
      ...actionCuesRef.current,
      [activePlayer.avatarId]: {
        type: aiMove.thinkingCue.type,
        text: aiMove.thinkingCue.text,
        startedAt: performance.now(),
        durationMs: Math.max(420, aiMove.delayMs),
        intensity: aiMove.thinkingCue.intensity,
      },
    };
    const timer = window.setTimeout(() => {
      commitTable(applyHoldemAction(table, aiMove.action));
    }, aiMove.delayMs);
    return () => window.clearTimeout(timer);
  }, [playersSeatedReady, table.actionSerial, table.activeSeatIndex, table.street]);

  useEffect(() => {
    if (!calledClock) return undefined;
    const timer = window.setInterval(() => {
      setClockNow(performance.now());
    }, CARD_ROOM_CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [calledClock?.deadlineAt]);

  useEffect(() => {
    if (!calledClock) return;
    const clockStillApplies =
      table.handNumber === calledClock.handNumber &&
      table.actionSerial === calledClock.actionSerial &&
      table.activeSeatIndex === calledClock.seatIndex &&
      table.street !== "waiting" &&
      table.street !== "handComplete";
    if (!clockStillApplies) setCalledClock(null);
  }, [
    calledClock,
    table.actionSerial,
    table.activeSeatIndex,
    table.handNumber,
    table.street,
  ]);

  useEffect(() => {
    if (!calledClock) return undefined;
    const remainingMs = Math.max(0, calledClock.deadlineAt - performance.now());
    const timer = window.setTimeout(() => {
      const currentTable = tableRef.current;
      const clockStillApplies =
        currentTable.handNumber === calledClock.handNumber &&
        currentTable.actionSerial === calledClock.actionSerial &&
        currentTable.activeSeatIndex === calledClock.seatIndex &&
        currentTable.street !== "waiting" &&
        currentTable.street !== "handComplete";
      if (!clockStillApplies) {
        setCalledClock(null);
        return;
      }
      commitTable(applyHoldemAction(currentTable, { type: "timeout" }));
      setCalledClock(null);
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [
    calledClock?.actionSerial,
    calledClock?.deadlineAt,
    calledClock?.handNumber,
    calledClock?.seatIndex,
  ]);

  useEffect(() => {
    if (table.street !== "handComplete") return;
    if (processedAutoCashOutHandRef.current === table.handNumber) return;
    const winner = wholeTableCharacterWinner(table);
    if (!winner) return;

    const cashOut = cashOutCardRoomSaveSlotPokerChips(winner.slotId, winner.stack);
    if (!cashOut) return;

    processedAutoCashOutHandRef.current = table.handNumber;
    const nextBank = updateHouseBank((current) =>
      addHouseVaultBits(current, -cashOut.redeemedBits),
    );
    const nextTable: HoldemTableState = {
      ...table,
      players: table.players.map((player) =>
        player.seatIndex === winner.seatIndex
          ? {
              ...player,
              walletBits: cashOut.bits,
              pokerChips: cashOut.pokerChips,
              stack: cashOut.pokerChips,
            }
          : player,
      ),
      log: [
        ...table.log,
        ui("cardRoom.autoCashOutLog", {
          name: winner.avatarName,
          chips: cashOut.cashedOutChips,
          bits: cashOut.redeemedBits,
        }),
      ],
    };
    tableRef.current = nextTable;
    setTable(nextTable);
    setRoster((current) =>
      current.map((character) =>
        character.slotId === winner.slotId
          ? {
              ...character,
              walletBits: cashOut.bits,
              pokerChips: cashOut.pokerChips,
            }
          : character,
      ),
    );
    setStacks((current) => ({
      ...current,
      [winner.avatarId]: cashOut.pokerChips,
    }));
    setStatusMessage(
      ui("cardRoom.autoCashOutComplete", {
        name: winner.avatarName,
        chips: cashOut.cashedOutChips,
        bits: cashOut.redeemedBits,
        rate: Math.round(CARD_ROOM_AUTO_CASH_OUT_RATE * 100),
        vault: nextBank?.vaultBits ?? houseBankRef.current.vaultBits,
        debt: nextBank?.payoutDebtBits ?? houseBankRef.current.payoutDebtBits,
      }),
    );
  }, [table.actionSerial, table.handNumber, table.players, table.street]);

  useEffect(() => {
    if (table.street !== "handComplete") return;
    if (processedDarkTraitHandRef.current === table.handNumber) return;
    const stats = hostHandDarkStatsRef.current;
    const finalPlayer = table.players.find((player) => player.isUser);
    if (!stats || !finalPlayer || stats.handNumber !== table.handNumber) return;

    processedDarkTraitHandRef.current = table.handNumber;
    previousHostHandNetRef.current = finalPlayer.stack - stats.startStack;
    const changes = darkTraitChangesForCompletedHand(stats, table, finalPlayer);
    const nextDarkTraits = writeCardRoomSaveSlotDarkTraitChanges(hostSlotId, changes);
    if (!nextDarkTraits) return;

    setRoster((current) =>
      current.map((character) =>
        character.slotId === hostSlotId
          ? {
              ...character,
              darkTraits: nextDarkTraits,
            }
          : character,
      ),
    );
  }, [hostSlotId, table.actionSerial, table.handNumber, table.players, table.street]);

  const activePlayer =
    table.activeSeatIndex === null ? null : table.players[table.activeSeatIndex];
  const legal = legalActionsForActivePlayer(table);
  const userTurn = Boolean(activePlayer?.isUser);
  const canActNow = userTurn && playersSeatedReady;
  const userPlayer = table.players.find((player) => player.isUser);
  const activeActionLabel = activePlayer
    ? `${activePlayer.avatarName} ${stackLabel(activePlayer.stack, ui)}`
    : "-";
  const handInProgress =
    table.street !== "waiting" && table.street !== "handComplete" && table.players.length > 0;
  const activeCalledClock =
    calledClock &&
    calledClock.handNumber === table.handNumber &&
    calledClock.actionSerial === table.actionSerial &&
    calledClock.seatIndex === table.activeSeatIndex &&
    handInProgress
      ? calledClock
      : null;
  const clockRemainingMs = activeCalledClock
    ? Math.max(0, activeCalledClock.deadlineAt - clockNow)
    : 0;
  const clockSecondsRemaining = Math.max(0, Math.ceil(clockRemainingMs / 1000));
  const clockMainSecondsRemaining = Math.max(
    0,
    Math.ceil((clockRemainingMs - CARD_ROOM_CLOCK_COUNTDOWN_MS) / 1000),
  );
  const clockCountdownActive =
    activeCalledClock !== null && clockRemainingMs <= CARD_ROOM_CLOCK_COUNTDOWN_MS;
  const activeClockStatusText = activeCalledClock
    ? clockCountdownActive
      ? ui("cardRoom.clockCountdownStatus", {
          name: activeCalledClock.avatarName,
          seconds: clockSecondsRemaining,
        })
      : ui("cardRoom.clockRunningStatus", {
          name: activeCalledClock.avatarName,
          seconds: clockMainSecondsRemaining,
        })
    : null;
  const canStartHand =
    seatedCharacters.length >= 2 &&
    (table.street === "waiting" || table.street === "handComplete");
  const communityCardsLabel = table.communityCards.length
    ? compactCards(table.communityCards)
    : ui("cardRoom.noCommunity");
  const userCards = userHandCardsReady ? userPlayer?.holeCards ?? [] : [];
  const tablePlayers = table.players.length > 0 ? table.players : [];
  const chipShopCharacters = hostDisplayCharacter
    ? [hostDisplayCharacter, ...availableCompanions]
    : availableCompanions;
  const visibleDecorCategories = cardRoomShopCategories.filter((category) =>
    localizedCardRoomShopItems.some((item) => item.cardRoomCategory === category.id),
  );
  const resolvedActiveDecorCategory = visibleDecorCategories.some(
    (category) => category.id === activeDecorCategory,
  )
    ? activeDecorCategory
    : visibleDecorCategories[0]?.id ?? activeDecorCategory;
  const decorShopItems = localizedCardRoomShopItems.filter(
    (item) => item.cardRoomCategory === resolvedActiveDecorCategory,
  );
  const canReleaseCompanions =
    !handInProgress && seatedCharacters.length >= 2 && !freeRoamEnabled;
  const canCallClock =
    handInProgress &&
    playersSeatedReady &&
    Boolean(activePlayer && !activePlayer.isUser) &&
    !activeCalledClock;
  const statusText =
    activeClockStatusText ??
    (handInProgress && !playersSeatedReady
      ? ui("cardRoom.takingSeats")
      : translateCardRoomTableText(table.message, ui) ||
        (!handInProgress
          ? table.street === "handComplete"
            ? ui("cardRoom.handComplete")
            : ui("cardRoom.readyHint")
          : userTurn
            ? ui("cardRoom.yourTurn")
            : ui("cardRoom.waitingFor", { name: activePlayer?.avatarName ?? "-" })));
  const roundResultLabel =
    table.winners.length > 0
      ? table.winners
          .map((winner) => {
            const hand =
              winner.handDescription || winner.handName
                ? localizePokerHandDescription(winner.handDescription, winner.handName, ui)
                : ui("cardRoom.resultUncontested");
            return `${winner.avatarName} +${winner.amount} / ${hand}`;
          })
          .join(", ")
      : "-";
  const selectedWagerTarget = clampWagerTarget(wagerTargetInput, legal);
  const canTargetWager =
    canActNow &&
    (legal.canBet || legal.canRaise) &&
    legal.maxRaiseTo >= legal.minRaiseTo;

  useEffect(() => {
    if (!activePlayer?.isUser || !(legal.canBet || legal.canRaise)) {
      setWagerTargetInput("");
      return;
    }
    setWagerTargetInput(String(recommendedWagerTarget(legal)));
  }, [
    activePlayer?.avatarId,
    activePlayer?.isUser,
    legal.canBet,
    legal.canRaise,
    legal.maxRaiseTo,
    legal.minRaiseTo,
    table.actionSerial,
    table.handNumber,
    table.street,
  ]);

  const actionButtons = (
    <>
      {userTurn && (legal.canBet || legal.canRaise) ? (
        <div className="card-room-wager-control">
          <label>
            <span>
              {ui("cardRoom.wagerTarget")}
              <small>
                {ui("cardRoom.wagerRange", {
                  min: legal.minRaiseTo,
                  max: legal.maxRaiseTo,
                })}
              </small>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={legal.minRaiseTo || MIN_WAGER_TARGET}
              max={legal.maxRaiseTo || MIN_WAGER_TARGET}
              step={1}
              value={wagerTargetInput}
              disabled={!canTargetWager}
              onChange={(event) => setWagerTargetInput(event.currentTarget.value)}
            />
          </label>
        </div>
      ) : null}
      {!userTurn && activePlayer && handInProgress ? (
        <div className={`card-room-clock-control${activeCalledClock ? " active" : ""}`}>
          <span>{ui("cardRoom.clockRule")}</span>
          {activeCalledClock ? (
            <strong>
              {clockCountdownActive
                ? ui("cardRoom.clockCountdown", { seconds: clockSecondsRemaining })
                : ui("cardRoom.clockRunning", { seconds: clockMainSecondsRemaining })}
            </strong>
          ) : (
            <button
              type="button"
              className="pixel-button"
              disabled={!canCallClock}
              onClick={callClockForActivePlayer}
            >
              {ui("cardRoom.callClock")}
            </button>
          )}
        </div>
      ) : null}
      <div className="card-room-actions">
        <button
          type="button"
          className="pixel-button"
          disabled={!canActNow || !legal.canFold}
          onClick={() => applyUserAction("fold")}
        >
          {ui("cardRoom.fold")}
        </button>
        <button
          type="button"
          className="pixel-button"
          disabled={!canActNow || !(legal.canCheck || legal.canCall)}
          onClick={() => applyUserAction(legal.canCheck ? "check" : "call")}
        >
          {legal.canCheck
            ? ui("cardRoom.check")
            : ui("cardRoom.call", { value: legal.toCall })}
        </button>
        <button
          type="button"
          className="pixel-button"
          disabled={!canTargetWager}
          onClick={() =>
            applyUserAction(legal.canBet ? "bet" : "raise", selectedWagerTarget)
          }
        >
          {legal.canBet
            ? ui("cardRoom.betTo", { value: selectedWagerTarget })
            : ui("cardRoom.raise", { value: selectedWagerTarget })}
        </button>
        <button
          type="button"
          className="pixel-button danger-button"
          disabled={!canActNow || !legal.canAllIn}
          onClick={() => applyUserAction("all-in")}
        >
          {ui("cardRoom.allIn")}
        </button>
      </div>
    </>
  );

  return (
    <main
      className={`card-room-app${userVictoryEffect ? " card-room-user-victory" : ""}`}
      lang={locale}
    >
      {userVictoryEffect ? (
        <div
          key={`${userVictoryEffect.handNumber}-${Math.round(userVictoryEffect.startedAt)}`}
          className="card-room-victory-overlay"
          aria-hidden="true"
        >
          <div className="card-room-victory-spotlight" />
          <div className="card-room-victory-rings" />
          <div className="card-room-victory-medallion">
            <span>{ui("cardRoom.victoryJackpot")}</span>
            <strong>{ui("cardRoom.victoryWinner")}</strong>
          </div>
          <div className="card-room-victory-confetti" />
        </div>
      ) : null}
      <header className="card-room-header">
        <div>
          <span>{ui("cardRoom.eyebrow")}</span>
          <h1>{ui("cardRoom.title")}</h1>
        </div>
        <div className="card-room-language" aria-label={ui("app.language")}>
          {localeOptions.map((option) => (
            <button
              key={option.locale}
              type="button"
              className={locale === option.locale ? "active" : ""}
              onClick={() => setLocale(option.locale)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <section className="card-room-layout">
        <div className="card-room-play-area">
          <section className="card-room-hud card-room-hud-top" aria-label={ui("cardRoom.tableStateAria")}>
            <div className="card-room-hud-block">
              <span>{ui("cardRoom.street")}</span>
              <strong>{streetLabel(table.street, ui)}</strong>
            </div>
            <div className="card-room-hud-block card-room-hud-wide">
              <span>{ui("cardRoom.community")}</span>
              <strong>{communityCardsLabel}</strong>
            </div>
            <div className="card-room-hud-block">
              <span>{ui("cardRoom.pot")}</span>
              <strong>{table.pot}</strong>
            </div>
            <div className="card-room-hud-block card-room-hud-result">
              <span>{ui("cardRoom.result")}</span>
              <strong>{roundResultLabel}</strong>
            </div>
          </section>

          <div className="card-room-stage">
            <canvas ref={canvasRef} className="card-room-canvas" />
          </div>

          <section className="card-room-hud card-room-hud-bottom" aria-label={ui("cardRoom.playerStateAria")}>
            <div className="card-room-user-hand">
              <span>{ui("cardRoom.yourHand")}</span>
              <div className="card-room-hand-cards" aria-label={ui("cardRoom.yourHand")}>
                {userCards.length > 0 ? (
                  userCards.map((card) => (
                    <CardRoomHandCard
                      key={`${card.rank}${card.suit}`}
                      card={card}
                    />
                  ))
                ) : (
                  <strong>--</strong>
                )}
              </div>
            </div>
            <div className="card-room-hand-action-panel">
              <div className="card-room-action-heading">
                <span>{ui("cardRoom.action")}</span>
                <strong>{activeActionLabel}</strong>
              </div>
              {actionButtons}
            </div>
            <div className="card-room-hud-block card-room-hud-message">
              <span>{ui("cardRoom.status")}</span>
              <strong>{statusText}</strong>
            </div>
          </section>
        </div>

        <aside className="card-room-panel">
          <section className="card-room-control-group">
            <div className="card-room-control-heading">
              <span>{ui("cardRoom.host")}</span>
              <strong>{playerDisplayName || ui("cardRoom.noHost")}</strong>
            </div>
            <label className="card-room-player-name-field">
              <span>{ui("cardRoom.playerName")}</span>
              <input
                type="text"
                value={playerNameInput}
                maxLength={18}
                placeholder={ui("cardRoom.playerNamePlaceholder")}
                onChange={(event) => updatePlayerName(event.target.value)}
              />
            </label>
            <button type="button" className="pixel-button" onClick={refreshRoster}>
              {ui("cardRoom.refresh")}
            </button>
            <button
              type="button"
              className="pixel-button"
              onClick={summonAllCompanions}
              disabled={availableCompanions.length === 0}
            >
              {ui("cardRoom.summonAll")}
            </button>
            <button
              type="button"
              className="pixel-button card-room-start"
              onClick={startHand}
              disabled={!canStartHand}
            >
              {table.street === "handComplete" ? ui("cardRoom.nextHand") : ui("cardRoom.startHand")}
            </button>
            <button
              type="button"
              className="pixel-button"
              onClick={releaseCompanionsFromTable}
              disabled={!canReleaseCompanions}
            >
              {ui("cardRoom.freeRoam")}
            </button>
            {statusMessage ? <p className="card-room-message">{statusMessage}</p> : null}
          </section>

          <section className="card-room-control-group">
            <div className="card-room-control-heading">
              <span>{ui("cardRoom.log")}</span>
              <strong>{streetLabel(table.street, ui)}</strong>
            </div>
            <div className="card-room-log">
              {table.log.length > 0 ? (
                table.log.map((entry, index) => (
                  <p key={`${entry}-${index}`}>{translateCardRoomTableText(entry, ui)}</p>
                ))
              ) : (
                <p>{ui("cardRoom.noLog")}</p>
              )}
            </div>
            {table.winners.length > 0 ? (
              <div className="card-room-winners">
                {table.winners.map((winner, index) => (
                  <p key={`${winner.seatIndex}-${index}`}>
                    <strong>{winner.avatarName}</strong> +{winner.amount}
                    {winner.handDescription || winner.handName
                      ? ` / ${localizePokerHandDescription(winner.handDescription, winner.handName, ui)}`
                      : ""}
                  </p>
                ))}
              </div>
            ) : null}
          </section>

          <section
            className={`card-room-control-group${companionsPanelCollapsed ? " card-room-control-group-collapsed" : ""}`}
          >
            <div className="card-room-control-heading card-room-control-heading-toggle">
              <button
                type="button"
                className="card-room-card-toggle"
                aria-expanded={!companionsPanelCollapsed}
                aria-controls="card-room-companion-list"
                aria-label={ui(companionsPanelCollapsed ? "cardRoom.expandPanel" : "cardRoom.collapsePanel", {
                  panel: ui("cardRoom.companions"),
                })}
                onClick={() => setCompanionsPanelCollapsed((collapsed) => !collapsed)}
              >
                <span>{ui("cardRoom.companions")}</span>
                <strong>
                  {selectedCompanions.length}/{MAX_COMPANIONS}
                </strong>
                <i className="card-room-card-toggle-icon" aria-hidden="true" />
              </button>
            </div>
            <div
              id="card-room-companion-list"
              className="card-room-collapsible-body"
              aria-hidden={companionsPanelCollapsed}
              style={{ maxHeight: companionsPanelCollapsed ? 0 : companionsPanel.bodyHeight }}
            >
              <div ref={companionsPanel.bodyRef} className="card-room-collapsible-body-inner">
                {availableCompanions.length > 0 ? (
                  <div className="card-room-roster">
                    {availableCompanions.map((character) => (
                      <button
                        key={character.slotId}
                        type="button"
                        className={selectedSlotIds.includes(character.slotId) ? "active" : ""}
                        tabIndex={companionsPanelCollapsed ? -1 : undefined}
                        onClick={() => toggleCompanion(character.slotId)}
                      >
                        <span>{character.avatarName}</span>
                        <small>
                          {ui("growth.level", { value: character.growthLevel })} /{" "}
                          {describePokerTemperament(character.traits, character.darkTraits, ui)}
                        </small>
                        <small>{stackLabel(stacks[character.avatarId] ?? character.pokerChips, ui)}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="card-room-message">{ui("cardRoom.noCompanions")}</p>
                )}
              </div>
            </div>
          </section>

          <section
            className={`card-room-control-group card-room-chip-shop${chipShopPanelCollapsed ? " card-room-control-group-collapsed" : ""}`}
          >
            <div className="card-room-control-heading card-room-control-heading-toggle">
              <button
                type="button"
                className="card-room-card-toggle"
                aria-expanded={!chipShopPanelCollapsed}
                aria-controls="card-room-chip-shop-list-panel"
                aria-label={ui(chipShopPanelCollapsed ? "cardRoom.expandPanel" : "cardRoom.collapsePanel", {
                  panel: ui("cardRoom.chipShop"),
                })}
                onClick={() => setChipShopPanelCollapsed((collapsed) => !collapsed)}
              >
                <span>{ui("cardRoom.chipShop")}</span>
                <strong>
                  {ui("cardRoom.chipShopRate", {
                    bits: CARD_ROOM_CHIP_BUNDLE_BITS,
                    chips: CARD_ROOM_CHIP_BUNDLE_CHIPS,
                  })}
                </strong>
                <i className="card-room-card-toggle-icon" aria-hidden="true" />
              </button>
            </div>
            <p className="card-room-message">
              {ui("cardRoom.chipShopHint", {
                bits: CARD_ROOM_BITS_DEBT_LIMIT,
                chips: CARD_ROOM_PLAYER_CHIP_DEBT_LIMIT,
              })}
            </p>
            <div className="card-room-house-bank card-room-house-bank-compact">
              <div>
                <span>{ui("cardRoom.houseVault")}</span>
                <strong>{normalizeHouseBits(houseBank.vaultBits)} bits</strong>
              </div>
              <div>
                <span>{ui("cardRoom.houseDebt")}</span>
                <strong>{normalizePayoutDebtBits(houseBank.payoutDebtBits)} bits</strong>
              </div>
              <div>
                <span>{ui("cardRoom.ownerPocket")}</span>
                <strong>{normalizeOwnerBits(houseBank.ownerBits)} bits</strong>
              </div>
              <button
                type="button"
                className="pixel-button"
                disabled={
                  normalizeHouseBits(houseBank.vaultBits) <= 0 ||
                  normalizePayoutDebtBits(houseBank.payoutDebtBits) <= 0
                }
                onClick={settleHouseDebt}
              >
                {ui("cardRoom.settleHouseDebt")}
              </button>
            </div>
            <div
              id="card-room-chip-shop-list-panel"
              className="card-room-collapsible-body"
              aria-hidden={chipShopPanelCollapsed}
              style={{ maxHeight: chipShopPanelCollapsed ? 0 : chipShopPanel.bodyHeight }}
            >
              <div ref={chipShopPanel.bodyRef} className="card-room-collapsible-body-inner">
                <div className="card-room-chip-shop-list">
                  {chipShopCharacters.map((character) => {
                    const isUser = character.avatarId === USER_PLAYER_AVATAR_ID;
                    const chips = stacks[character.avatarId] ?? character.pokerChips;
                    const ownerCanExchangeChips =
                      isUser && normalizeOwnerBits(houseBank.ownerBits) >= CARD_ROOM_CHIP_BUNDLE_BITS;
                    const ownerCanGiftChips =
                      !isUser && normalizeOwnerBits(houseBank.ownerBits) >= CARD_ROOM_CHIP_BUNDLE_BITS;
                    const exchangeEnabled =
                      !handInProgress &&
                      (isUser
                        ? ownerCanExchangeChips ||
                          canBorrowPlayerPokerChips({
                            ...playerWallet,
                            pokerChips: chips,
                          })
                        : canExchangePokerChips({
                            bits: character.walletBits,
                            pokerChips: chips,
                          }));
                    const redeemEnabled =
                      !handInProgress && !isUser && canRedeemPokerChipsForBits({ pokerChips: chips });
                    return (
                      <article key={character.slotId} className="card-room-chip-shop-row">
                        <div>
                          <strong>{character.avatarName}</strong>
                          <span>
                            {isUser
                              ? ui("cardRoom.playerChipAccount", {
                                  debt: normalizeChipDebt(playerWallet.chipDebt),
                                  chips,
                                })
                              : `${character.walletBits} bits / ${stackLabel(chips, ui)}`}
                          </span>
                        </div>
                        <div className="card-room-chip-shop-actions">
                          <button
                            type="button"
                            className="pixel-button"
                            disabled={!exchangeEnabled}
                            tabIndex={chipShopPanelCollapsed ? -1 : undefined}
                            onClick={() => exchangeCharacterChips(character)}
                          >
                            {ui(
                              isUser && ownerCanExchangeChips
                                ? "cardRoom.ownerExchangeChips"
                                : isUser
                                  ? "cardRoom.borrowChips"
                                  : "cardRoom.exchangeChips",
                              {
                                bits: CARD_ROOM_CHIP_BUNDLE_BITS,
                                chips: CARD_ROOM_CHIP_BUNDLE_CHIPS,
                              },
                            )}
                          </button>
                          {!isUser ? (
                            <button
                              type="button"
                              className="pixel-button"
                              disabled={!ownerCanGiftChips || handInProgress}
                              tabIndex={chipShopPanelCollapsed ? -1 : undefined}
                              onClick={() => giftCharacterChips(character)}
                            >
                              {ui("cardRoom.giftChips", {
                                chips: CARD_ROOM_CHIP_BUNDLE_CHIPS,
                              })}
                            </button>
                          ) : null}
                          {!isUser ? (
                            <button
                              type="button"
                              className="pixel-button"
                              disabled={!redeemEnabled}
                              tabIndex={chipShopPanelCollapsed ? -1 : undefined}
                              onClick={() => redeemCharacterBits(character)}
                            >
                              {ui("cardRoom.redeemBits", {
                                bits: CARD_ROOM_CHIP_BUNDLE_BITS,
                              })}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section
            className={`card-room-control-group card-room-decor-shop${decorShopPanelCollapsed ? " card-room-control-group-collapsed" : ""}`}
          >
            <div className="card-room-control-heading card-room-control-heading-toggle">
              <button
                type="button"
                className="card-room-card-toggle"
                aria-expanded={!decorShopPanelCollapsed}
                aria-controls="card-room-decor-shop-panel"
                aria-label={ui(decorShopPanelCollapsed ? "cardRoom.expandPanel" : "cardRoom.collapsePanel", {
                  panel: ui("cardRoom.decorShop"),
                })}
                onClick={() => setDecorShopPanelCollapsed((collapsed) => !collapsed)}
              >
                <span>{ui("cardRoom.decorShop")}</span>
                <strong>
                  {ui("cardRoom.decorBalance", {
                    bits: normalizeOwnerBits(houseBank.ownerBits),
                  })}
                </strong>
                <i className="card-room-card-toggle-icon" aria-hidden="true" />
              </button>
            </div>
            <div
              id="card-room-decor-shop-panel"
              className="card-room-collapsible-body"
              aria-hidden={decorShopPanelCollapsed}
              style={{ maxHeight: decorShopPanelCollapsed ? 0 : decorShopPanel.bodyHeight }}
            >
              <div ref={decorShopPanel.bodyRef} className="card-room-collapsible-body-inner">
                <p className="card-room-message">{ui("cardRoom.decorShopHint")}</p>
                <div className="card-room-house-bank">
                  <div>
                    <span>{ui("cardRoom.houseVault")}</span>
                    <strong>{normalizeHouseBits(houseBank.vaultBits)} bits</strong>
                  </div>
                  <div>
                    <span>{ui("cardRoom.houseDebt")}</span>
                    <strong>{normalizePayoutDebtBits(houseBank.payoutDebtBits)} bits</strong>
                  </div>
                  <div>
                    <span>{ui("cardRoom.ownerPocket")}</span>
                    <strong>{normalizeOwnerBits(houseBank.ownerBits)} bits</strong>
                  </div>
                  <button
                    type="button"
                    className="pixel-button"
                    disabled={normalizeHouseBits(houseBank.vaultBits) <= 0}
                    tabIndex={decorShopPanelCollapsed ? -1 : undefined}
                    onClick={withdrawHouseBits}
                  >
                    {ui("cardRoom.withdrawHouseBits")}
                  </button>
                  <button
                    type="button"
                    className="pixel-button"
                    disabled={
                      normalizeHouseBits(houseBank.vaultBits) <= 0 ||
                      normalizePayoutDebtBits(houseBank.payoutDebtBits) <= 0
                    }
                    tabIndex={decorShopPanelCollapsed ? -1 : undefined}
                    onClick={settleHouseDebt}
                  >
                    {ui("cardRoom.settleHouseDebt")}
                  </button>
                </div>
                <div className="card-room-decor-tabs" aria-label={ui("cardRoom.decorShop")}>
                  {visibleDecorCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={resolvedActiveDecorCategory === category.id ? "active" : ""}
                      tabIndex={decorShopPanelCollapsed ? -1 : undefined}
                      onClick={() => setActiveDecorCategory(category.id)}
                    >
                      {ui(category.copyKey)}
                    </button>
                  ))}
                </div>
                <div className="card-room-decor-shop-list">
                  {decorShopItems.map((item) => {
                    const purchased = cardRoomDecor.purchasedItemIds.includes(item.id);
                    const active = isDecorItemActive(item);
                    const canAfford =
                      purchased || normalizeOwnerBits(houseBank.ownerBits) >= item.price;
                    const actionLabel = active
                      ? ui("cardRoom.decorApplied")
                      : purchased
                        ? ui(
                            item.cardRoomCategory === "furniture"
                              ? "cardRoom.decorPlace"
                              : "cardRoom.decorApply",
                          )
                        : ui("cardRoom.decorBuy", { price: item.price });
                    return (
                      <article key={item.id} className="card-room-decor-shop-row">
                        <div
                          className={`card-room-decor-swatch card-room-decor-swatch-${item.cardRoomCategory}`}
                          data-item={item.id}
                          aria-hidden="true"
                        />
                        <div className="card-room-decor-shop-copy">
                          <strong>{item.name}</strong>
                          <span>{item.description}</span>
                          <small>
                            {purchased
                              ? ui("cardRoom.decorOwned")
                              : ui("cardRoom.decorPrice", { price: item.price })}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="pixel-button"
                          disabled={handInProgress || active || !canAfford}
                          tabIndex={decorShopPanelCollapsed ? -1 : undefined}
                          onClick={() => buyOrApplyDecorItem(item)}
                        >
                          {actionLabel}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

        </aside>
      </section>
    </main>
  );
};
