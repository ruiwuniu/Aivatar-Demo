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
  let deck = state.deck;
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
  return livePlayers.length > 1 && livePlayers.every((player) => player.allIn || creditAvailable(player) <= 0);
};

const solvePlayerHand = (
  player: HoldemPlayer,
  communityCards: PlayingCard[],
): SolvedPokerHand =>
  Hand.solve([...player.holeCards, ...communityCards].map(cardToSolverCode));

const awardSingleRemainingPlayer = (state: HoldemTableState) => {
  const winner = state.players.find((player) => !player.folded);
  if (!winner) return state;
  const pot = potSize(state.players);
  const players = state.players.map((player) =>
    player.seatIndex === winner.seatIndex
      ? { ...player, stack: player.stack + pot }
      : player,
  );

  return pushLog(
    {
      ...state,
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
      message: `${winner.avatarName} wins ${pot} chips.`,
      actionSerial: state.actionSerial + 1,
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

const settleShowdown = (state: HoldemTableState) => {
  const livePlayers = state.players.filter((player) => !player.folded);
  if (livePlayers.length <= 1) return awardSingleRemainingPlayer(state);

  const solvedHands = new Map<number, SolvedPokerHand>();
  livePlayers.forEach((player) => {
    solvedHands.set(player.seatIndex, solvePlayerHand(player, state.communityCards));
  });

  let players = state.players;
  const winners: HoldemWinner[] = [];

  buildSidePots(players).forEach((sidePot) => {
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

    players = players.map((player) => {
      if (!winningSeatIndexes.includes(player.seatIndex)) return player;
      const bonus = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
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
        amount: share,
        handName: hand.name,
        handDescription: hand.descr,
      });
    });
  });

  const summary = winners
    .map((winner) => `${winner.avatarName} wins ${winner.amount}`)
    .join(", ");
  const best = winners[0];
  return pushLog(
    {
      ...state,
      street: "handComplete",
      players,
      pot: 0,
      activeSeatIndex: null,
      winners,
      message: best?.handDescription
        ? `${summary}. Best hand: ${best.handDescription}.`
        : summary,
      actionSerial: state.actionSerial + 1,
    },
    best?.handDescription ? `Showdown: ${best.handDescription}.` : "Showdown settled.",
  );
};

const advanceStreet = (state: HoldemTableState): HoldemTableState => {
  if (countContenders(state.players) <= 1) return awardSingleRemainingPlayer(state);

  if (allRemainingAllIn(state)) {
    let next = state;
    if (next.communityCards.length < 3) next = revealCommunityCards(next, "flop");
    if (next.communityCards.length < 4) next = revealCommunityCards(next, "turn");
    if (next.communityCards.length < 5) next = revealCommunityCards(next, "river");
    return settleShowdown({ ...next, street: "showdown" });
  }

  if (state.street === "preflop") {
    const next = revealCommunityCards(state, "flop");
    return {
      ...pushLog(next, "The dealer reveals the flop."),
      activeSeatIndex: firstPostflopSeat(next.players, next.buttonIndex),
      message: "Flop betting round.",
    };
  }
  if (state.street === "flop") {
    const next = revealCommunityCards(state, "turn");
    return {
      ...pushLog(next, "The dealer reveals the turn."),
      activeSeatIndex: firstPostflopSeat(next.players, next.buttonIndex),
      message: "Turn betting round.",
    };
  }
  if (state.street === "turn") {
    const next = revealCommunityCards(state, "river");
    return {
      ...pushLog(next, "The dealer reveals the river."),
      activeSeatIndex: firstPostflopSeat(next.players, next.buttonIndex),
      message: "River betting round.",
    };
  }

  return settleShowdown({ ...state, street: "showdown" });
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
    };
  }

  const toCall = Math.max(0, state.currentBet - activePlayer.roundBet);
  const minRaiseTo =
    state.currentBet === 0
      ? state.bigBlind
      : state.currentBet + Math.max(state.minimumRaise, state.bigBlind);

  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0 && creditAvailable(activePlayer) > 0,
    canBet: toCall === 0 && state.currentBet === 0 && creditAvailable(activePlayer) > 0,
    canRaise: state.currentBet > 0 && creditAvailable(activePlayer) > toCall,
    canAllIn: creditAvailable(activePlayer) > 0,
    toCall,
    minRaiseTo,
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
    const oldCurrentBet = state.currentBet;
    const desiredRoundBet = Math.max(
      action.type === "bet" ? state.bigBlind : legal.minRaiseTo,
      Math.round(action.amount ?? legal.minRaiseTo),
    );
    const cappedRoundBet = Math.min(
      activePlayer.roundBet + creditAvailable(activePlayer),
      desiredRoundBet,
    );
    const paymentNeeded = Math.max(0, cappedRoundBet - activePlayer.roundBet);
    const paid = payChips(activePlayer, paymentNeeded);
    const raisedTo = paid.player.roundBet;
    if (raisedTo <= oldCurrentBet && !paid.player.allIn) return state;

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
      return {
        ...candidate,
        acted: false,
      };
    });

    const nextCurrentBet = Math.max(oldCurrentBet, raisedTo);
    const raiseSize = Math.max(state.minimumRaise, nextCurrentBet - oldCurrentBet);
    return proceedAfterAction(
      pushLog(
        {
          ...state,
          players,
          currentBet: nextCurrentBet,
          minimumRaise: raiseSize,
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
) => player.isUser || table.street === "handComplete" ? player.holeCards : [];
