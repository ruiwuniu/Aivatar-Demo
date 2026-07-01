import { Hand, type SolvedPokerHand } from "pokersolver";
import type {
  AivatarDarkTraits,
  AivatarGrowthTraits,
  AvatarAppearanceId,
} from "../types";

export type CardRank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";

export type CardSuit = "c" | "d" | "h" | "s";

export interface PlayingCard {
  rank: CardRank;
  suit: CardSuit;
}

export type HoldemStreet =
  | "waiting"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "handComplete";

export type HoldemAction =
  | { type: "fold" | "check" | "call" }
  | { type: "timeout" }
  | { type: "bet" | "raise" | "all-in"; amount?: number };

export interface CardRoomCharacter {
  slotId: string;
  slotIndex: number;
  avatarId: string;
  avatarName: string;
  avatarAppearanceId: AvatarAppearanceId;
  growthLevel: number;
  walletBits: number;
  pokerChips: number;
  traits: AivatarGrowthTraits;
  darkTraits: AivatarDarkTraits;
}

export interface HoldemPlayer extends CardRoomCharacter {
  seatIndex: number;
  roomSeatIndex?: number;
  isUser: boolean;
  stack: number;
  holeCards: PlayingCard[];
  roundBet: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  lastAction?: string;
}

export interface HoldemWinner {
  seatIndex: number;
  avatarName: string;
  amount: number;
  handName?: string;
  handDescription?: string;
}

export interface HoldemTableState {
  street: HoldemStreet;
  handNumber: number;
  players: HoldemPlayer[];
  deck: PlayingCard[];
  burnedCards: PlayingCard[];
  communityCards: PlayingCard[];
  buttonIndex: number;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  minimumRaise: number;
  activeSeatIndex: number | null;
  pot: number;
  lastAggressorSeatIndex?: number;
  message: string;
  log: string[];
  winners: HoldemWinner[];
  showdownOrderSeatIndexes: number[];
  actionSerial: number;
}

const ranks: CardRank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const suits: CardSuit[] = ["c", "d", "h", "s"];

export const cardToSolverCode = (card: PlayingCard) => `${card.rank}${card.suit}`;

export const cardLabel = (card: PlayingCard) =>
  `${card.rank === "T" ? "10" : card.rank}${card.suit.toUpperCase()}`;

const freshDeck = (): PlayingCard[] =>
  suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));

const shuffleDeck = (deck: PlayingCard[]) => {
  const next = [...deck];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const nextOccupiedSeat = (
  players: HoldemPlayer[],
  fromSeatIndex: number,
  predicate: (player: HoldemPlayer) => boolean,
) => {
  if (players.length === 0) return null;
  for (let offset = 1; offset <= players.length; offset += 1) {
    const index = (fromSeatIndex + offset) % players.length;
    const player = players[index];
    if (player && predicate(player)) return index;
  }
  return null;
};

const countContenders = (players: HoldemPlayer[]) =>
  players.filter((player) => !player.folded && (creditAvailable(player) > 0 || player.committed > 0)).length;

const canAct = (player: HoldemPlayer, currentBet: number) =>
  !player.folded &&
  !player.allIn &&
  creditAvailable(player) > 0 &&
  (player.roundBet < currentBet || !player.acted);

const minimumFullRaiseTo = (state: HoldemTableState) => {
  if (state.currentBet === 0) return state.bigBlind;
  if (state.currentBet < state.bigBlind) return state.bigBlind;
  return state.currentBet + state.minimumRaise;
};

const canOpenOrRaise = (
  state: HoldemTableState,
  player: HoldemPlayer,
  toCall: number,
) => {
  const hasCallableOpponent = state.players.some(
    (candidate) =>
      candidate.seatIndex !== player.seatIndex &&
      !candidate.folded &&
      !candidate.allIn &&
      creditAvailable(candidate) > 0,
  );
  if (!hasCallableOpponent) return false;
  if (state.currentBet === 0) return toCall === 0 && creditAvailable(player) > 0;
  if (creditAvailable(player) <= toCall) return false;
  if (!player.acted) return true;
  return toCall >= state.minimumRaise;
};

const potSize = (players: HoldemPlayer[]) =>
  players.reduce((total, player) => total + player.committed, 0);

const pushLog = (state: HoldemTableState, entry: string) => ({
  ...state,
  log: [entry, ...state.log].slice(0, 12),
});

const drawCard = (deck: PlayingCard[]) => {
  const card = deck[0];
  if (!card) throw new Error("The deck is empty.");
  return {
    card,
    deck: deck.slice(1),
  };
};

const burnCard = (deck: PlayingCard[]) => drawCard(deck);

export const creditAvailable = (player: Pick<HoldemPlayer, "stack">) =>
  Math.max(0, Math.round(player.stack));

const payChips = (player: HoldemPlayer, amount: number) => {
  const availableCredit = creditAvailable(player);
  const payment = Math.max(0, Math.min(availableCredit, Math.round(amount)));
  return {
    payment,
    player: {
      ...player,
      stack: player.stack - payment,
      roundBet: player.roundBet + payment,
      committed: player.committed + payment,
      allIn: payment >= availableCredit,
    },
  };
};

const returnUncalledBets = (state: HoldemTableState) => {
  const committedLevels = Array.from(
    new Set(state.players.map((player) => player.committed).filter((value) => value > 0)),
  ).sort((left, right) => right - left);
  const highestCommitted = committedLevels[0] ?? 0;
  const secondHighestCommitted = committedLevels[1] ?? 0;
  const highestPlayers = state.players.filter(
    (player) => player.committed === highestCommitted,
  );
  if (
    highestCommitted <= 0 ||
    highestPlayers.length !== 1 ||
    highestCommitted <= secondHighestCommitted
  ) {
    return state;
  }

  const refund = highestCommitted - secondHighestCommitted;
  const refundedPlayer = highestPlayers[0];
  const players = state.players.map((player) => {
    if (player.seatIndex !== refundedPlayer.seatIndex) return player;
    const roundRefund = Math.min(refund, player.roundBet);
    return {
      ...player,
      stack: player.stack + refund,
      roundBet: player.roundBet - roundRefund,
      committed: player.committed - refund,
    };
  });
  const currentBet = Math.min(
    state.currentBet,
    Math.max(0, ...players.map((player) => player.roundBet)),
  );

  return pushLog(
    {
      ...state,
      players,
      currentBet,
      pot: potSize(players),
    },
    `${refundedPlayer.avatarName} gets ${refund} uncalled chips back.`,
  );
};

const dealHoleCards = (
  players: HoldemPlayer[],
  deck: PlayingCard[],
  startingSeatIndex = 0,
) => {
  let nextDeck = deck;
  let nextPlayers: HoldemPlayer[] = players.map((player) => ({
    ...player,
    holeCards: [],
  }));

  for (let cardNumber = 0; cardNumber < 2; cardNumber += 1) {
    for (let offset = 0; offset < nextPlayers.length; offset += 1) {
      const seatIndex = (startingSeatIndex + offset) % nextPlayers.length;
      const drawn = drawCard(nextDeck);
      nextDeck = drawn.deck;
      const player = nextPlayers[seatIndex];
      nextPlayers[seatIndex] = {
        ...player,
        holeCards: [...player.holeCards, drawn.card],
      };
    }
  }

  return { players: nextPlayers, deck: nextDeck };
};

const revealCommunityCards = (
  state: HoldemTableState,
  street: Exclude<HoldemStreet, "waiting" | "preflop" | "showdown" | "handComplete">,
) => {
  const cardCount = street === "flop" ? 3 : 1;
  const burned = burnCard(state.deck);
  let deck = burned.deck;
  const nextCards = [...state.communityCards];
  for (let index = 0; index < cardCount; index += 1) {
    const drawn = drawCard(deck);
    deck = drawn.deck;
    nextCards.push(drawn.card);
  }
  return {
    ...state,
    street,
    deck,
    burnedCards: [...state.burnedCards, burned.card],
    communityCards: nextCards,
    currentBet: 0,
    minimumRaise: state.bigBlind,
    lastAggressorSeatIndex: undefined,
    players: state.players.map((player) => ({
      ...player,
      roundBet: 0,
      acted: player.folded || player.allIn,
      lastAction: player.folded ? player.lastAction : undefined,
    })),
  };
};

const firstPostflopSeat = (players: HoldemPlayer[], buttonIndex: number) =>
  nextOccupiedSeat(players, buttonIndex, (player) => !player.folded && !player.allIn && creditAvailable(player) > 0);

const nextActor = (state: HoldemTableState, fromSeatIndex: number | null) => {
  if (fromSeatIndex === null) return null;
  return nextOccupiedSeat(state.players, fromSeatIndex, (player) =>
    canAct(player, state.currentBet),
  );
};

const bettingRoundComplete = (state: HoldemTableState) => {
  const livePlayers = state.players.filter((player) => !player.folded);
  if (livePlayers.length <= 1) return true;
  return livePlayers
    .filter((player) => !player.allIn && creditAvailable(player) > 0)
    .every((player) => player.acted && player.roundBet === state.currentBet);
};

const allRemainingAllIn = (state: HoldemTableState) => {
  const livePlayers = state.players.filter((player) => !player.folded);
  const actionablePlayers = livePlayers.filter(
    (player) => !player.allIn && creditAvailable(player) > 0,
  );
  if (livePlayers.length <= 1) return false;
  if (actionablePlayers.length === 0) return true;
  if (actionablePlayers.length > 1) return false;
  const highestLiveRoundBet = Math.max(...livePlayers.map((player) => player.roundBet));
  return actionablePlayers[0].roundBet >= highestLiveRoundBet;
};

const solvePlayerHand = (
  player: HoldemPlayer,
  communityCards: PlayingCard[],
): SolvedPokerHand =>
  Hand.solve([...player.holeCards, ...communityCards].map(cardToSolverCode));

const awardSingleRemainingPlayer = (state: HoldemTableState) => {
  const settledState = returnUncalledBets(state);
  const winner = settledState.players.find((player) => !player.folded);
  if (!winner) return settledState;
  const pot = potSize(settledState.players);
  const players = settledState.players.map((player) =>
    player.seatIndex === winner.seatIndex
      ? { ...player, stack: player.stack + pot }
      : player,
  );

  return pushLog(
    {
      ...settledState,
      street: "handComplete",
      players,
      pot: 0,
      activeSeatIndex: null,
      winners: [
        {
          seatIndex: winner.seatIndex,
          avatarName: winner.avatarName,
          amount: pot,
        },
      ],
      showdownOrderSeatIndexes: [],
      message: `${winner.avatarName} wins ${pot} chips.`,
      actionSerial: settledState.actionSerial + 1,
    },
    `${winner.avatarName} wins the pot uncontested.`,
  );
};

const buildSidePots = (players: HoldemPlayer[]) => {
  const levels = Array.from(
    new Set(players.map((player) => player.committed).filter((value) => value > 0)),
  ).sort((left, right) => left - right);
  let previous = 0;

  return levels
    .map((level) => {
      const participants = players.filter((player) => player.committed >= level);
      const amount = (level - previous) * participants.length;
      previous = level;
      return {
        amount,
        eligibleSeatIndexes: participants
          .filter((player) => !player.folded)
          .map((player) => player.seatIndex),
      };
    })
    .filter((pot) => pot.amount > 0 && pot.eligibleSeatIndexes.length > 0);
};

const oddChipOrder = (
  seatIndexes: number[],
  buttonIndex: number,
  playerCount: number,
) =>
  [...seatIndexes].sort((left, right) => {
    const leftDistance = (left - buttonIndex + playerCount) % playerCount || playerCount;
    const rightDistance = (right - buttonIndex + playerCount) % playerCount || playerCount;
    return leftDistance - rightDistance;
  });

const baseShowdownOrderSeatIndexes = (state: HoldemTableState) => {
  const liveSeatIndexes = state.players
    .filter((player) => !player.folded)
    .map((player) => player.seatIndex);
  const startSeatIndex =
    typeof state.lastAggressorSeatIndex === "number" &&
    liveSeatIndexes.includes(state.lastAggressorSeatIndex)
      ? state.lastAggressorSeatIndex
      : null;
  if (startSeatIndex === null) {
    return oddChipOrder(liveSeatIndexes, state.buttonIndex, state.players.length);
  }
  return [...liveSeatIndexes].sort((left, right) => {
    const leftDistance = (left - startSeatIndex + state.players.length) % state.players.length;
    const rightDistance = (right - startSeatIndex + state.players.length) % state.players.length;
    return leftDistance - rightDistance;
  });
};

const showdownOrderSeatIndexes = (state: HoldemTableState) => {
  const baseOrder = baseShowdownOrderSeatIndexes(state);
  const sidePots = buildSidePots(state.players).slice(1);
  if (sidePots.length === 0) return baseOrder;

  const prioritizedSidePotSeats: number[] = [];
  const prioritizedSidePotSeatSet = new Set<number>();
  sidePots
    .slice()
    .reverse()
    .forEach((sidePot) => {
      baseOrder.forEach((seatIndex) => {
        if (
          sidePot.eligibleSeatIndexes.includes(seatIndex) &&
          !prioritizedSidePotSeatSet.has(seatIndex)
        ) {
          prioritizedSidePotSeats.push(seatIndex);
          prioritizedSidePotSeatSet.add(seatIndex);
        }
      });
    });

  return [
    ...prioritizedSidePotSeats,
    ...baseOrder.filter((seatIndex) => !prioritizedSidePotSeatSet.has(seatIndex)),
  ];
};

const settleShowdown = (state: HoldemTableState) => {
  const settledState = returnUncalledBets(state);
  const livePlayers = settledState.players.filter((player) => !player.folded);
  if (livePlayers.length <= 1) return awardSingleRemainingPlayer(settledState);

  const solvedHands = new Map<number, SolvedPokerHand>();
  livePlayers.forEach((player) => {
    solvedHands.set(player.seatIndex, solvePlayerHand(player, settledState.communityCards));
  });

  let players = settledState.players;
  const winners: HoldemWinner[] = [];

  buildSidePots(players).reverse().forEach((sidePot) => {
    const candidates = sidePot.eligibleSeatIndexes
      .map((seatIndex) => ({
        seatIndex,
        hand: solvedHands.get(seatIndex),
      }))
      .filter((entry): entry is { seatIndex: number; hand: SolvedPokerHand } =>
        Boolean(entry.hand),
      );
    const winningHands = Hand.winners(candidates.map((candidate) => candidate.hand));
    const winningSeatIndexes = candidates
      .filter((candidate) => winningHands.includes(candidate.hand))
      .map((candidate) => candidate.seatIndex);
    const share = Math.floor(sidePot.amount / winningSeatIndexes.length);
    let remainder = sidePot.amount - share * winningSeatIndexes.length;
    const payouts = new Map(winningSeatIndexes.map((seatIndex) => [seatIndex, share]));
    oddChipOrder(winningSeatIndexes, state.buttonIndex, players.length).forEach((seatIndex) => {
      if (remainder <= 0) return;
      payouts.set(seatIndex, (payouts.get(seatIndex) ?? 0) + 1);
      remainder -= 1;
    });

    players = players.map((player) => {
      const bonus = payouts.get(player.seatIndex) ?? 0;
      if (bonus <= 0) return player;
      return {
        ...player,
        stack: player.stack + bonus,
      };
    });

    winningSeatIndexes.forEach((seatIndex) => {
      const player = players.find((candidate) => candidate.seatIndex === seatIndex);
      const hand = solvedHands.get(seatIndex);
      if (!player || !hand) return;
      winners.push({
        seatIndex,
        avatarName: player.avatarName,
        amount: payouts.get(seatIndex) ?? share,
        handName: hand.name,
        handDescription: hand.descr,
      });
    });
  });

  const summary = winners
    .map((winner) => `${winner.avatarName} wins ${winner.amount}`)
    .join(", ");
  const bestHand = Hand.winners(Array.from(solvedHands.values()))[0];
  const showdownOrder = showdownOrderSeatIndexes(settledState);
  const showdownOrderNames = showdownOrder
    .map((seatIndex) => settledState.players[seatIndex]?.avatarName)
    .filter((name): name is string => Boolean(name));
  const showdownLog = [
    showdownOrderNames.length > 0
      ? `Showdown order: ${showdownOrderNames.join(", ")}.`
      : "Showdown.",
    bestHand?.descr ? `Best hand: ${bestHand.descr}.` : "Settled.",
  ].join(" ");
  return pushLog(
    {
      ...settledState,
      street: "handComplete",
      players,
      pot: 0,
      activeSeatIndex: null,
      winners,
      showdownOrderSeatIndexes: showdownOrder,
      message: bestHand?.descr
        ? `${summary}. Best hand: ${bestHand.descr}.`
        : summary,
      actionSerial: settledState.actionSerial + 1,
    },
    showdownLog,
  );
};

const advanceStreet = (state: HoldemTableState): HoldemTableState => {
  const settledState = returnUncalledBets(state);
  if (countContenders(settledState.players) <= 1) return awardSingleRemainingPlayer(settledState);

  if (allRemainingAllIn(settledState)) {
    let next = settledState;
    if (next.communityCards.length < 3) next = revealCommunityCards(next, "flop");
    if (next.communityCards.length < 4) next = revealCommunityCards(next, "turn");
    if (next.communityCards.length < 5) next = revealCommunityCards(next, "river");
    return settleShowdown({ ...next, street: "showdown" });
  }

  if (settledState.street === "preflop") {
    const next = revealCommunityCards(settledState, "flop");
    return {
      ...pushLog(next, "The dealer reveals the flop."),
      activeSeatIndex: firstPostflopSeat(next.players, next.buttonIndex),
      message: "Flop betting round.",
    };
  }
  if (settledState.street === "flop") {
    const next = revealCommunityCards(settledState, "turn");
    return {
      ...pushLog(next, "The dealer reveals the turn."),
      activeSeatIndex: firstPostflopSeat(next.players, next.buttonIndex),
      message: "Turn betting round.",
    };
  }
  if (settledState.street === "turn") {
    const next = revealCommunityCards(settledState, "river");
    return {
      ...pushLog(next, "The dealer reveals the river."),
      activeSeatIndex: firstPostflopSeat(next.players, next.buttonIndex),
      message: "River betting round.",
    };
  }

  return settleShowdown({ ...settledState, street: "showdown" });
};

const proceedAfterAction = (
  state: HoldemTableState,
  actedSeatIndex: number,
): HoldemTableState => {
  const withPot = {
    ...state,
    pot: potSize(state.players),
  };

  if (countContenders(withPot.players) <= 1) return awardSingleRemainingPlayer(withPot);
  if (bettingRoundComplete(withPot) || allRemainingAllIn(withPot)) {
    return advanceStreet(withPot);
  }

  return {
    ...withPot,
    activeSeatIndex: nextActor(withPot, actedSeatIndex),
    actionSerial: withPot.actionSerial + 1,
  };
};

export const emptyHoldemTable = (): HoldemTableState => ({
  street: "waiting",
  handNumber: 0,
  players: [],
  deck: [],
  burnedCards: [],
  communityCards: [],
  buttonIndex: 0,
  smallBlind: 10,
  bigBlind: 20,
  currentBet: 0,
  minimumRaise: 20,
  activeSeatIndex: null,
  pot: 0,
  message: "Summon at least one companion to start a hand.",
  log: [],
  winners: [],
  showdownOrderSeatIndexes: [],
  actionSerial: 0,
});

export const createHoldemPlayers = (
  characters: CardRoomCharacter[],
  stacks: Record<string, number>,
  userAvatarId: string,
): HoldemPlayer[] =>
  characters.map((character, index) => ({
    ...character,
    seatIndex: index,
    isUser: character.avatarId === userAvatarId,
    stack: Math.max(0, Math.round(stacks[character.avatarId] ?? character.pokerChips ?? 0)),
    holeCards: [],
    roundBet: 0,
    committed: 0,
    folded: false,
    allIn: false,
    acted: false,
  }));

const previousButtonAnchorIndex = (
  previousState: HoldemTableState,
  players: HoldemPlayer[],
) => {
  if (previousState.street === "waiting") return -1;
  const previousButtonPlayer = previousState.players[previousState.buttonIndex];
  if (previousButtonPlayer) {
    const matchingIndex = players.findIndex(
      (player) => player.avatarId === previousButtonPlayer.avatarId,
    );
    if (matchingIndex >= 0) return matchingIndex;
  }
  return Math.max(-1, Math.min(previousState.buttonIndex, players.length - 1));
};

export const startHoldemHand = (
  previousState: HoldemTableState,
  players: HoldemPlayer[],
): HoldemTableState => {
  const seatedPlayers = players.filter((player) => creditAvailable(player) > 0);
  if (seatedPlayers.length < 2) {
    return {
      ...previousState,
      players,
      message: "At least two players with chips are required.",
    };
  }

  const buttonAnchorIndex = previousButtonAnchorIndex(previousState, seatedPlayers);
  const buttonIndex =
    previousState.street === "waiting"
      ? 0
      : nextOccupiedSeat(
          seatedPlayers,
          buttonAnchorIndex,
          (player) => creditAvailable(player) > 0,
        ) ?? 0;
  const deck = shuffleDeck(freshDeck());
  const resetPlayers: HoldemPlayer[] = seatedPlayers.map((player, seatIndex) => ({
    ...player,
    seatIndex,
    holeCards: [],
    roundBet: 0,
    committed: 0,
    folded: false,
    allIn: false,
    acted: false,
    lastAction: undefined,
  }));
  const smallBlindSeat =
    resetPlayers.length === 2
      ? buttonIndex
      : nextOccupiedSeat(resetPlayers, buttonIndex, () => true) ?? buttonIndex;
  const bigBlindSeat =
    nextOccupiedSeat(resetPlayers, smallBlindSeat, () => true) ?? smallBlindSeat;
  const { players: dealtPlayers, deck: deckAfterDeal } = dealHoleCards(
    resetPlayers,
    deck,
    smallBlindSeat,
  );

  let nextPlayers = dealtPlayers;
  const smallBlindPayment = payChips(nextPlayers[smallBlindSeat], previousState.smallBlind);
  nextPlayers = nextPlayers.map((player, index) =>
    index === smallBlindSeat ? smallBlindPayment.player : player,
  );
  const bigBlindPayment = payChips(nextPlayers[bigBlindSeat], previousState.bigBlind);
  nextPlayers = nextPlayers.map((player, index) =>
    index === bigBlindSeat ? bigBlindPayment.player : player,
  );

  const firstActor =
    nextOccupiedSeat(
      nextPlayers,
      bigBlindSeat,
      (player) => !player.folded && !player.allIn && creditAvailable(player) > 0,
    ) ?? null;
  const state: HoldemTableState = {
    street: "preflop",
    handNumber: previousState.handNumber + 1,
    players: nextPlayers,
    deck: deckAfterDeal,
    burnedCards: [],
    communityCards: [],
    buttonIndex,
    smallBlind: previousState.smallBlind,
    bigBlind: previousState.bigBlind,
    currentBet: previousState.bigBlind,
    minimumRaise: previousState.bigBlind,
    activeSeatIndex: firstActor,
    pot: potSize(nextPlayers),
    message: "Preflop betting round.",
    log: [
      `${nextPlayers[smallBlindSeat].avatarName} posts ${smallBlindPayment.payment}.`,
      `${nextPlayers[bigBlindSeat].avatarName} posts ${bigBlindPayment.payment}.`,
      `Hand ${previousState.handNumber + 1} begins.`,
    ],
    winners: [],
    showdownOrderSeatIndexes: [],
    actionSerial: previousState.actionSerial + 1,
  };

  if (firstActor === null || allRemainingAllIn(state)) return advanceStreet(state);
  return state;
};

export const legalActionsForActivePlayer = (state: HoldemTableState) => {
  const activePlayer =
    state.activeSeatIndex === null ? null : state.players[state.activeSeatIndex];
  if (!activePlayer || state.street === "waiting" || state.street === "handComplete") {
    return {
      canFold: false,
      canCheck: false,
      canCall: false,
      canBet: false,
      canRaise: false,
      canAllIn: false,
      toCall: 0,
      minRaiseTo: 0,
      maxRaiseTo: 0,
    };
  }

  const toCall = Math.max(0, state.currentBet - activePlayer.roundBet);
  const minRaiseTo = minimumFullRaiseTo(state);
  const maxRaiseTo = activePlayer.roundBet + creditAvailable(activePlayer);
  const canOpenOrRaiseAction = canOpenOrRaise(state, activePlayer, toCall);
  const canAllIn =
    creditAvailable(activePlayer) > 0 &&
    ((toCall > 0 && creditAvailable(activePlayer) <= toCall) ||
      canOpenOrRaiseAction);

  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0 && creditAvailable(activePlayer) > 0,
    canBet: state.currentBet === 0 && canOpenOrRaiseAction,
    canRaise: state.currentBet > 0 && canOpenOrRaiseAction,
    canAllIn,
    toCall,
    minRaiseTo,
    maxRaiseTo,
  };
};

export const applyHoldemAction = (
  state: HoldemTableState,
  action: HoldemAction,
): HoldemTableState => {
  if (state.activeSeatIndex === null) return state;
  const activePlayer = state.players[state.activeSeatIndex];
  if (!activePlayer || activePlayer.folded || activePlayer.allIn) return state;

  const legal = legalActionsForActivePlayer(state);
  let players = state.players;
  const updateActive = (player: HoldemPlayer) => {
    players = players.map((candidate) =>
      candidate.seatIndex === player.seatIndex ? player : candidate,
    );
  };

  if (action.type === "fold" && legal.canFold) {
    updateActive({
      ...activePlayer,
      folded: true,
      acted: true,
      lastAction: "fold",
    });
    return proceedAfterAction(
      pushLog(
        {
          ...state,
          players,
          message: `${activePlayer.avatarName} folds.`,
        },
        `${activePlayer.avatarName} folds.`,
      ),
      activePlayer.seatIndex,
    );
  }

  if (action.type === "check" && legal.canCheck) {
    updateActive({
      ...activePlayer,
      acted: true,
      lastAction: "check",
    });
    return proceedAfterAction(
      pushLog(
        {
          ...state,
          players,
          message: `${activePlayer.avatarName} checks.`,
        },
        `${activePlayer.avatarName} checks.`,
      ),
      activePlayer.seatIndex,
    );
  }

  if (action.type === "timeout") {
    if (legal.canCheck) {
      updateActive({
        ...activePlayer,
        acted: true,
        lastAction: "timeout check",
      });
      return proceedAfterAction(
        pushLog(
          {
            ...state,
            players,
            message: `${activePlayer.avatarName} times out and checks.`,
          },
          `${activePlayer.avatarName} times out and checks.`,
        ),
        activePlayer.seatIndex,
      );
    }

    if (legal.canFold) {
      updateActive({
        ...activePlayer,
        folded: true,
        acted: true,
        lastAction: "timeout fold",
      });
      return proceedAfterAction(
        pushLog(
          {
            ...state,
            players,
            message: `${activePlayer.avatarName} times out. Hand is dead.`,
          },
          `${activePlayer.avatarName} times out. Hand is dead.`,
        ),
        activePlayer.seatIndex,
      );
    }

    return state;
  }

  if (action.type === "call" && legal.canCall) {
    const paid = payChips(activePlayer, legal.toCall);
    updateActive({
      ...paid.player,
      acted: true,
      lastAction: paid.player.allIn ? "all-in call" : "call",
    });
    return proceedAfterAction(
      pushLog(
        {
          ...state,
          players,
          message: `${activePlayer.avatarName} calls ${paid.payment}.`,
        },
        `${activePlayer.avatarName} calls ${paid.payment}.`,
      ),
      activePlayer.seatIndex,
    );
  }

  if (action.type === "bet" || action.type === "raise") {
    if (action.type === "bet" && !legal.canBet) return state;
    if (action.type === "raise" && !legal.canRaise) return state;

    const oldCurrentBet = state.currentBet;
    const defaultRoundBet = action.type === "bet" ? state.bigBlind : legal.minRaiseTo;
    const desiredRoundBet = Math.max(
      defaultRoundBet,
      Math.round(action.amount ?? defaultRoundBet),
    );
    const cappedRoundBet = Math.min(
      activePlayer.roundBet + creditAvailable(activePlayer),
      desiredRoundBet,
    );
    const paymentNeeded = Math.max(0, cappedRoundBet - activePlayer.roundBet);
    const paid = payChips(activePlayer, paymentNeeded);
    const raisedTo = paid.player.roundBet;
    if (raisedTo <= oldCurrentBet) return state;

    const raiseAmount = oldCurrentBet === 0 ? raisedTo : raisedTo - oldCurrentBet;
    const requiredFullRaiseTo = oldCurrentBet < state.bigBlind
      ? state.bigBlind
      : oldCurrentBet + state.minimumRaise;
    const isFullRaise = raisedTo >= requiredFullRaiseTo;
    if (!isFullRaise && !paid.player.allIn) return state;
    const nextMinimumRaise =
      oldCurrentBet < state.bigBlind ? state.bigBlind : raiseAmount;

    players = players.map((candidate) => {
      if (candidate.seatIndex === activePlayer.seatIndex) {
        return {
          ...paid.player,
          acted: true,
          lastAction:
            paid.player.allIn && raisedTo > oldCurrentBet
              ? "all-in raise"
              : action.type,
        };
      }
      if (candidate.folded || candidate.allIn) return candidate;
      return isFullRaise ? { ...candidate, acted: false } : candidate;
    });

    const nextCurrentBet = Math.max(oldCurrentBet, raisedTo);
    return proceedAfterAction(
      pushLog(
        {
          ...state,
          players,
          currentBet: nextCurrentBet,
          minimumRaise: isFullRaise ? nextMinimumRaise : state.minimumRaise,
          lastAggressorSeatIndex: activePlayer.seatIndex,
          message: `${activePlayer.avatarName} ${oldCurrentBet === 0 ? "bets" : "raises to"} ${raisedTo}.`,
        },
        `${activePlayer.avatarName} ${oldCurrentBet === 0 ? "bets" : "raises to"} ${raisedTo}.`,
      ),
      activePlayer.seatIndex,
    );
  }

  if (action.type === "all-in" && legal.canAllIn) {
    const targetRoundBet = activePlayer.roundBet + creditAvailable(activePlayer);
    if (targetRoundBet <= state.currentBet) {
      const paid = payChips(activePlayer, creditAvailable(activePlayer));
      updateActive({
        ...paid.player,
        acted: true,
        lastAction: "all-in call",
      });
      return proceedAfterAction(
        pushLog(
          {
            ...state,
            players,
            message: `${activePlayer.avatarName} moves all-in for ${paid.payment}.`,
          },
          `${activePlayer.avatarName} moves all-in for ${paid.payment}.`,
        ),
        activePlayer.seatIndex,
      );
    }

    return applyHoldemAction(state, {
      type: state.currentBet > 0 ? "raise" : "bet",
      amount: targetRoundBet,
    });
  }

  return state;
};

export const visibleHoleCardsForPlayer = (
  table: HoldemTableState,
  player: HoldemPlayer,
) =>
  player.isUser ||
  (table.street === "handComplete" &&
    table.showdownOrderSeatIndexes.includes(player.seatIndex))
    ? player.holeCards
    : [];
