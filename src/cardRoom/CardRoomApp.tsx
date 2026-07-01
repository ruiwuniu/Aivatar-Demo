import { useEffect, useMemo, useRef, useState } from "react";
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
  exchangeCardRoomSaveSlotPokerChips,
  readActiveSaveSlotId,
  readCardRoomRoster,
  redeemCardRoomSaveSlotPokerChipsForBits,
  writeCardRoomSaveSlotDarkTraitChanges,
  writeCardRoomSaveSlotPokerChips,
} from "./saveRoster";
import {
  CARD_ROOM_BITS_DEBT_LIMIT,
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
  cardRoomShopItems,
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

const stackLabel = (value: number) =>
  value >= 0 ? `${value} chips` : `debt ${Math.abs(value)}`;

const actionCueText: Record<CardRoomActionCue["type"], string> = {
  think: "Thinking...",
  hesitate: "Hmm...",
  pressure: "Push.",
  snap: "Now.",
  fold: "Fold.",
  check: "Check.",
  call: "Call.",
  bet: "Bet.",
  raise: "Raise.",
  "all-in": "All-in!",
};

const actionCueFromLastAction = (
  lastAction: string | undefined,
  now: number,
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
    text: actionCueText[type],
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
  const currentCardRoomContent = useMemo(
    () => buildCardRoomContentWithDecor(cardRoomDecor),
    [cardRoomDecor],
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
  const actionCuesRef = useRef<Record<string, CardRoomActionCue>>({});
  const playerActionSnapshotsRef = useRef<Record<string, string>>({});
  const hostHandDarkStatsRef = useRef<CardRoomHandDarkStats | null>(null);
  const previousHostHandNetRef = useRef(0);
  const processedDarkTraitHandRef = useRef<number | null>(null);
  const victoryDemoPlayedRef = useRef(false);
  const roomKey = hostSlotId ?? "preview";

  const currentCardRoomPresence = () =>
    createCardRoomPresence(cardRoomInstanceIdRef.current, hostSlotId);

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
          .map((character) => ({
            avatarId: character.avatarId,
            avatarName: character.avatarName,
            runtime: visitorStateMap[character.avatarId]?.runtime,
          }))
          .filter((entry): entry is {
            avatarId: string;
            avatarName: string;
            runtime: AvatarRuntime;
          } => Boolean(entry.runtime && entry.avatarId !== host?.avatarId));
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
            const cue = actionCueFromLastAction(player.lastAction, now);
            if (cue) nextActionCues[player.avatarId] = cue;
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
            createInitialCardRoomVisitorState(character, index, isUser, now);
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
            },
          );
          nextVisitorStateMap[character.avatarId] = nextState;
          nextRuntimeMap[character.avatarId] = nextState.runtime;
          if (nextState.bubbleText && typeof nextState.bubbleStartedAt === "number") {
            bubbleMap[character.avatarId] = {
              text: nextState.bubbleText,
              startedAt: nextState.bubbleStartedAt,
            };
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
        renderCardRoom(canvasRef.current, {
          content,
          table: currentTable,
          characters,
          runtimes: nextRuntimeMap,
          bubbles: bubbleMap,
          actionCues: nextActionCues,
          motion: tableMotionRef.current,
          frame: animationFrame,
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
          : nextTable.message,
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
    const aiMove = choosePokerAiMove(table, activePlayer);
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
    ? `${activePlayer.avatarName} ${stackLabel(activePlayer.stack)}`
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
    : "--";
  const userCards = userHandCardsReady ? userPlayer?.holeCards ?? [] : [];
  const tablePlayers = table.players.length > 0 ? table.players : [];
  const chipShopCharacters = hostDisplayCharacter
    ? [hostDisplayCharacter, ...availableCompanions]
    : availableCompanions;
  const decorShopItems = cardRoomShopItems.filter(
    (item) => item.cardRoomCategory === activeDecorCategory,
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
      : table.message ||
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
            const hand = winner.handDescription ?? winner.handName ?? "uncontested";
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
            <span>JACKPOT</span>
            <strong>WINNER</strong>
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
          <section className="card-room-hud card-room-hud-top" aria-label="Card room table state">
            <div className="card-room-hud-block">
              <span>Street</span>
              <strong>{table.street}</strong>
            </div>
            <div className="card-room-hud-block card-room-hud-wide">
              <span>Community</span>
              <strong>{communityCardsLabel}</strong>
            </div>
            <div className="card-room-hud-block">
              <span>Pot</span>
              <strong>{table.pot}</strong>
            </div>
            <div className="card-room-hud-block card-room-hud-result">
              <span>Result</span>
              <strong>{roundResultLabel}</strong>
            </div>
          </section>

          <div className="card-room-stage">
            <canvas ref={canvasRef} className="card-room-canvas" />
          </div>

          <section className="card-room-hud card-room-hud-bottom" aria-label="Card room player state">
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
              <span>Status</span>
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

          <section className="card-room-control-group card-room-chip-shop">
            <div className="card-room-control-heading">
              <span>{ui("cardRoom.chipShop")}</span>
              <strong>
                {ui("cardRoom.chipShopRate", {
                  bits: CARD_ROOM_CHIP_BUNDLE_BITS,
                  chips: CARD_ROOM_CHIP_BUNDLE_CHIPS,
                })}
              </strong>
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
            </div>
            <div className="card-room-chip-shop-list">
              {chipShopCharacters.map((character) => {
                const isUser = character.avatarId === USER_PLAYER_AVATAR_ID;
                const chips = stacks[character.avatarId] ?? character.pokerChips;
                const ownerCanExchangeChips =
                  isUser && normalizeOwnerBits(houseBank.ownerBits) >= CARD_ROOM_CHIP_BUNDLE_BITS;
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
                          : `${character.walletBits} bits / ${stackLabel(chips)}`}
                      </span>
                    </div>
                    <div className="card-room-chip-shop-actions">
                      <button
                        type="button"
                        className="pixel-button"
                        disabled={!exchangeEnabled}
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
                          disabled={!redeemEnabled}
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
          </section>

          <section className="card-room-control-group card-room-decor-shop">
            <div className="card-room-control-heading">
              <span>{ui("cardRoom.decorShop")}</span>
              <strong>
                {ui("cardRoom.decorBalance", {
                  bits: normalizeOwnerBits(houseBank.ownerBits),
                })}
              </strong>
            </div>
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
                onClick={withdrawHouseBits}
              >
                {ui("cardRoom.withdrawHouseBits")}
              </button>
            </div>
            <div className="card-room-decor-tabs" aria-label={ui("cardRoom.decorShop")}>
              {cardRoomShopCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={activeDecorCategory === category.id ? "active" : ""}
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
                      onClick={() => buyOrApplyDecorItem(item)}
                    >
                      {actionLabel}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="card-room-control-group">
            <div className="card-room-control-heading">
              <span>{ui("cardRoom.companions")}</span>
              <strong>
                {selectedCompanions.length}/{MAX_COMPANIONS}
              </strong>
            </div>
            {availableCompanions.length > 0 ? (
              <div className="card-room-roster">
                {availableCompanions.map((character) => (
                  <button
                    key={character.slotId}
                    type="button"
                    className={selectedSlotIds.includes(character.slotId) ? "active" : ""}
                    onClick={() => toggleCompanion(character.slotId)}
                  >
                    <span>{character.avatarName}</span>
                    <small>
                      {ui("growth.level", { value: character.growthLevel })} /{" "}
                      {describePokerTemperament(character.traits, character.darkTraits)}
                    </small>
                    <small>{stackLabel(stacks[character.avatarId] ?? character.pokerChips)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="card-room-message">{ui("cardRoom.noCompanions")}</p>
            )}
          </section>

          <section className="card-room-control-group">
            <div className="card-room-control-heading">
              <span>{ui("cardRoom.log")}</span>
              <strong>{table.street}</strong>
            </div>
            <div className="card-room-log">
              {table.log.length > 0 ? (
                table.log.map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>)
              ) : (
                <p>{ui("cardRoom.noLog")}</p>
              )}
            </div>
            {table.winners.length > 0 ? (
              <div className="card-room-winners">
                {table.winners.map((winner, index) => (
                  <p key={`${winner.seatIndex}-${index}`}>
                    <strong>{winner.avatarName}</strong> +{winner.amount}
                    {winner.handDescription ? ` / ${winner.handDescription}` : ""}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        </aside>
      </section>
    </main>
  );
};
