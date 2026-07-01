import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const pokersolverUrl = pathToFileURL(require.resolve("pokersolver")).href;
const enginePath = fileURLToPath(new URL("../src/cardRoom/holdemEngine.ts", import.meta.url));
const source = readFileSync(enginePath, "utf8");

let output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

output = output.replace(
  'import { Hand } from "pokersolver";',
  `import pokersolverPkg from ${JSON.stringify(pokersolverUrl)};\nconst { Hand } = pokersolverPkg;`,
);

const engine = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);

const traits = {
  focus: 0,
  resilience: 0,
  curiosity: 0,
  efficiency: 0,
  creativity: 0,
  warmth: 0,
};

const darkTraits = {
  greed: 0,
  foolishness: 0,
  recklessness: 0,
  cowardice: 0,
  arrogance: 0,
  coldness: 0,
};

const card = (rank, suit) => ({ rank, suit });

const makePlayer = (seatIndex, overrides = {}) => ({
  slotId: `slot-${seatIndex}`,
  slotIndex: seatIndex,
  avatarId: `p${seatIndex}`,
  avatarName: `P${seatIndex}`,
  avatarAppearanceId: "octopus",
  growthLevel: 1,
  walletBits: 0,
  pokerChips: 0,
  traits,
  darkTraits,
  seatIndex,
  isUser: false,
  stack: 1000,
  holeCards: [card("A", "s"), card("K", "s")],
  roundBet: 0,
  committed: 0,
  folded: false,
  allIn: false,
  acted: false,
  ...overrides,
});

const baseState = (players, activeSeatIndex, overrides = {}) => ({
  street: "flop",
  handNumber: 1,
  players,
  deck: [],
  burnedCards: [],
  communityCards: [card("2", "c"), card("7", "d"), card("J", "h")],
  buttonIndex: 0,
  smallBlind: 10,
  bigBlind: 20,
  currentBet: 0,
  minimumRaise: 20,
  activeSeatIndex,
  pot: players.reduce((total, player) => total + player.committed, 0),
  message: "",
  log: [],
  winners: [],
  showdownOrderSeatIndexes: [],
  actionSerial: 1,
  ...overrides,
});

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const sameCard = (actual, expected) =>
  actual?.rank === expected.rank && actual?.suit === expected.suit;

const sameOrder = (actual, expected) =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);

const testShortAllInReopenRules = () => {
  let state = baseState(
    [
      makePlayer(0, { stack: 900, roundBet: 100, committed: 100, acted: true }),
      makePlayer(1, { stack: 50, roundBet: 100, committed: 100, acted: false }),
      makePlayer(2, { stack: 500, roundBet: 100, committed: 100, acted: true }),
    ],
    1,
    { currentBet: 100, minimumRaise: 100 },
  );

  state = engine.applyHoldemAction(state, { type: "all-in" });
  assert(state.currentBet === 150, "single short all-in should raise current call amount to 150");
  assert(state.activeSeatIndex === 2, "action should move to the next player facing the short all-in");
  let legal = engine.legalActionsForActivePlayer(state);
  assert(legal.toCall === 50, "next player should face only the short all-in delta");
  assert(legal.canCall, "next player should be able to call the short all-in");
  assert(!legal.canRaise, "single incomplete all-in raise must not reopen raising");
  assert(!legal.canAllIn, "player with chips behind must not all-in raise when betting is not reopened");

  state = baseState(
    [
      makePlayer(0, { stack: 900, roundBet: 100, committed: 100, acted: true }),
      makePlayer(1, { stack: 50, roundBet: 100, committed: 100, acted: false }),
      makePlayer(2, { stack: 100, roundBet: 100, committed: 100, acted: false }),
      makePlayer(3, { stack: 500, roundBet: 100, committed: 100, acted: true }),
    ],
    1,
    { currentBet: 100, minimumRaise: 100 },
  );

  state = engine.applyHoldemAction(state, { type: "all-in" });
  assert(state.activeSeatIndex === 2, "second short stack should act next");
  legal = engine.legalActionsForActivePlayer(state);
  assert(legal.canRaise, "a player who has not acted may make an all-in raise");
  state = engine.applyHoldemAction(state, { type: "all-in" });
  assert(state.currentBet === 200, "second short all-in should move current bet to 200");
  assert(state.activeSeatIndex === 3, "action should continue to another player facing the reopened action");
  legal = engine.legalActionsForActivePlayer(state);
  assert(legal.toCall === 100, "cumulative short all-ins should create a full raise to the next player");
  assert(legal.canRaise, "cumulative full raise must reopen raising while another player can still respond");
  state = engine.applyHoldemAction(state, { type: "call" });
  assert(state.activeSeatIndex === 0, "action should return to the original bettor after the intervening call");
  legal = engine.legalActionsForActivePlayer(state);
  assert(legal.canRaise, "cumulative full raise must reopen raising");
};

const testWagerTargets = () => {
  let state = baseState(
    [
      makePlayer(0, { roundBet: 100, committed: 100, acted: true }),
      makePlayer(1, { roundBet: 100, committed: 100, acted: false, stack: 1000 }),
      makePlayer(2, { roundBet: 100, committed: 100, acted: true }),
    ],
    1,
    { currentBet: 100, minimumRaise: 40 },
  );

  let legal = engine.legalActionsForActivePlayer(state);
  assert(legal.minRaiseTo === 140, "min raise target should be current bet plus last full raise");
  assert(legal.maxRaiseTo === 1100, "max raise target should include current round bet plus stack");
  state = engine.applyHoldemAction(state, { type: "raise", amount: 175 });
  assert(state.currentBet === 175, "custom raise target should be accepted");
  assert(state.minimumRaise === 75, "next minimum raise should track the custom full raise size");

  state = baseState(
    [
      makePlayer(0, { roundBet: 100, committed: 100, acted: true }),
      makePlayer(1, { roundBet: 100, committed: 100, acted: false, stack: 1000 }),
      makePlayer(2, { roundBet: 100, committed: 100, acted: true }),
    ],
    1,
    { currentBet: 100, minimumRaise: 40 },
  );
  state = engine.applyHoldemAction(state, { type: "raise", amount: 120 });
  assert(state.currentBet === 140, "below-min raise target should be rounded up to the minimum full raise");

  state = baseState(
    [
      makePlayer(0, { roundBet: 100, committed: 100, acted: true }),
      makePlayer(1, { roundBet: 100, committed: 100, acted: false, stack: 60 }),
      makePlayer(2, { roundBet: 100, committed: 100, acted: true }),
    ],
    1,
    { currentBet: 100, minimumRaise: 40 },
  );
  state = engine.applyHoldemAction(state, { type: "raise", amount: 1000 });
  assert(state.currentBet === 160, "oversized target should cap at the player all-in maximum");
  assert(state.players[1].allIn, "capped oversized target should mark the player all-in");

  state = baseState(
    [
      makePlayer(0, { stack: 15 }),
      makePlayer(1, { stack: 100 }),
      makePlayer(2, { stack: 100 }),
    ],
    0,
    { currentBet: 0 },
  );
  state = engine.applyHoldemAction(state, { type: "all-in" });
  assert(state.currentBet === 15, "opening all-in under the big blind should set the short current bet");
  assert(state.minimumRaise === 20, "short opening all-in should preserve the big-blind full bet size");
  legal = engine.legalActionsForActivePlayer(state);
  assert(legal.minRaiseTo === 20, "next player should be able to complete to the big blind");
  state = engine.applyHoldemAction(state, { type: "raise", amount: 20 });
  assert(state.currentBet === 20, "completing a short opening all-in to the big blind should be accepted");
  assert(state.minimumRaise === 20, "completion to the big blind should keep the next full raise size at the big blind");
};

const testOddChipOrder = () => {
  let state = {
    ...baseState(
      [
        makePlayer(0, {
          stack: 0,
          roundBet: 5,
          committed: 5,
          acted: true,
          holeCards: [card("A", "s"), card("K", "d")],
        }),
        makePlayer(1, {
          stack: 0,
          roundBet: 5,
          committed: 5,
          acted: true,
          holeCards: [card("A", "h"), card("Q", "d")],
        }),
        makePlayer(2, {
          stack: 1,
          roundBet: 5,
          committed: 5,
          acted: false,
          holeCards: [card("K", "c"), card("Q", "s")],
        }),
      ],
      2,
      {
        street: "river",
        currentBet: 5,
        minimumRaise: 20,
        communityCards: [
          card("2", "c"),
          card("3", "d"),
          card("4", "h"),
          card("5", "s"),
          card("9", "c"),
        ],
        pot: 15,
      },
    ),
  };

  state = engine.applyHoldemAction(state, { type: "check" });
  const p0 = state.players.find((player) => player.seatIndex === 0);
  const p1 = state.players.find((player) => player.seatIndex === 1);
  const p2 = state.players.find((player) => player.seatIndex === 2);
  assert(state.street === "handComplete", "river check should settle showdown");
  assert(p0.stack === 7, "seat 0 should receive the lower split share");
  assert(p1.stack === 8, "seat 1, first left of the button among tied winners, should receive the odd chip");
  assert(p2.stack === 1, "losing seat should keep only its uncommitted stack");
};

const checkThroughStreet = (state, targetStreet) => {
  let next = state;
  let guard = 0;
  while (next.street === targetStreet && guard < 12) {
    assert(next.activeSeatIndex !== null, `expected active player while checking through ${targetStreet}`);
    next = engine.applyHoldemAction(next, { type: "check" });
    guard += 1;
  }
  assert(guard < 12, `check-through loop exceeded guard on ${targetStreet}`);
  return next;
};

const testBurnCards = () => {
  let state = baseState(
    [
      makePlayer(0, { acted: false }),
      makePlayer(1, { acted: true }),
    ],
    0,
    {
      street: "preflop",
      deck: [
        card("2", "c"),
        card("3", "c"),
        card("4", "c"),
        card("5", "c"),
        card("6", "c"),
        card("7", "c"),
        card("8", "c"),
        card("9", "c"),
      ],
      communityCards: [],
      currentBet: 0,
      minimumRaise: 20,
    },
  );

  state = engine.applyHoldemAction(state, { type: "check" });
  assert(state.street === "flop", "checking through preflop should reveal the flop");
  assert(state.burnedCards.length === 1, "flop reveal should burn one card");
  assert(sameCard(state.burnedCards[0], card("2", "c")), "first deck card should be burned before the flop");
  assert(
    sameCard(state.communityCards[0], card("3", "c")) &&
      sameCard(state.communityCards[1], card("4", "c")) &&
      sameCard(state.communityCards[2], card("5", "c")),
    "flop should use the three cards after the burn card",
  );

  state = checkThroughStreet(state, "flop");
  assert(state.street === "turn", "checking through flop should reveal the turn");
  assert(state.burnedCards.length === 2, "turn reveal should burn a second card");
  assert(sameCard(state.burnedCards[1], card("6", "c")), "turn burn card should come before the turn card");
  assert(sameCard(state.communityCards[3], card("7", "c")), "turn should use the card after the turn burn card");

  state = checkThroughStreet(state, "turn");
  assert(state.street === "river", "checking through turn should reveal the river");
  assert(state.burnedCards.length === 3, "river reveal should burn a third card");
  assert(sameCard(state.burnedCards[2], card("8", "c")), "river burn card should come before the river card");
  assert(sameCard(state.communityCards[4], card("9", "c")), "river should use the card after the river burn card");
};

const testSingleActionablePlayerRunsOutBoard = () => {
  let state = baseState(
    [
      makePlayer(0, {
        stack: 100,
        roundBet: 20,
        committed: 20,
        acted: false,
        holeCards: [card("A", "s"), card("K", "d")],
      }),
      makePlayer(1, {
        stack: 0,
        roundBet: 20,
        committed: 20,
        allIn: true,
        acted: true,
        holeCards: [card("Q", "c"), card("Q", "d")],
      }),
    ],
    0,
    {
      street: "preflop",
      deck: [
        card("2", "c"),
        card("3", "c"),
        card("4", "c"),
        card("5", "c"),
        card("6", "c"),
        card("7", "c"),
        card("8", "c"),
        card("9", "c"),
      ],
      communityCards: [],
      buttonIndex: 0,
      currentBet: 20,
      minimumRaise: 20,
      pot: 40,
    },
  );

  state = engine.applyHoldemAction(state, { type: "check" });
  assert(
    state.street === "handComplete",
    "when only one live player can still act against all-in opponents, the board should run out",
  );
  assert(state.activeSeatIndex === null, "all-in runout should leave no active player");
  assert(state.communityCards.length === 5, "all-in runout should reveal all five board cards");
  assert(state.burnedCards.length === 3, "all-in runout should still burn before flop, turn, and river");
  assert(
    sameOrder(state.showdownOrderSeatIndexes, [1, 0]),
    "all-in runout should produce a real showdown order",
  );

  state = baseState(
    [
      makePlayer(0, {
        stack: 100,
        roundBet: 20,
        committed: 20,
        acted: true,
        holeCards: [card("A", "s"), card("K", "d")],
      }),
      makePlayer(1, {
        stack: 0,
        roundBet: 80,
        committed: 80,
        allIn: true,
        acted: true,
        holeCards: [card("Q", "c"), card("Q", "d")],
      }),
    ],
    0,
    {
      street: "flop",
      deck: [],
      currentBet: 80,
      minimumRaise: 60,
      pot: 100,
    },
  );

  const legal = engine.legalActionsForActivePlayer(state);
  assert(legal.canCall, "sole actionable player must be allowed to call an unmatched all-in");
  assert(!legal.canRaise, "sole actionable player must not raise when no opponent can call");
  assert(!legal.canAllIn, "sole actionable player must not all-in raise when no opponent can call");
  state = engine.applyHoldemAction(state, { type: "raise", amount: 140 });
  assert(state.currentBet === 80, "raise over all-in opponents should be ignored when nobody can call");
};

const testShortBigBlindAllInDoesNotForceNominalCall = () => {
  const previousMathRandom = Math.random;
  Math.random = () => 0;
  try {
    const state = engine.startHoldemHand(engine.emptyHoldemTable(), [
      makePlayer(0, { stack: 100 }),
      makePlayer(1, { stack: 5 }),
    ]);
    const totalStacks = state.players.reduce((total, player) => total + player.stack, 0);
    const totalPayout = state.winners.reduce((total, winner) => total + winner.amount, 0);
    assert(state.street === "handComplete", "short all-in big blind heads-up should run out immediately");
    assert(state.activeSeatIndex === null, "short all-in big blind should not leave the small blind facing a nominal call");
    assert(state.communityCards.length === 5, "short all-in big blind should reveal a full board");
    assert(state.burnedCards.length === 3, "short all-in big blind runout should burn before each board street");
    assert(
      state.players.every((player) => player.committed === 5),
      "small blind excess above the short big blind should be returned before settlement",
    );
    assert(totalPayout === 10, "only matched chips should be awarded from the short-blind main pot");
    assert(totalStacks === 105, "short-blind settlement should preserve total table chips");
  } finally {
    Math.random = previousMathRandom;
  }
};

const testUncalledBetsReturn = () => {
  let state = baseState(
    [
      makePlayer(0, {
        stack: 900,
        roundBet: 100,
        committed: 100,
        acted: true,
        holeCards: [card("A", "s"), card("A", "d")],
      }),
      makePlayer(1, {
        stack: 40,
        roundBet: 0,
        committed: 0,
        acted: false,
        holeCards: [card("K", "c"), card("K", "d")],
      }),
    ],
    1,
    {
      street: "flop",
      deck: [card("3", "c"), card("4", "c"), card("5", "c"), card("6", "c")],
      currentBet: 100,
      minimumRaise: 100,
      pot: 100,
    },
  );

  state = engine.applyHoldemAction(state, { type: "call" });
  const p0 = state.players.find((player) => player.seatIndex === 0);
  const p1 = state.players.find((player) => player.seatIndex === 1);
  assert(state.street === "handComplete", "short all-in call should run out to showdown");
  assert(p0.stack === 1040, "bettor should get uncalled 60 back, then win the 80 contested pot");
  assert(p0.committed === 40, "bettor committed amount should exclude returned uncalled chips");
  assert(p1.stack === 0, "short caller should be all-in");
  assert(state.winners[0]?.amount === 80, "showdown winner amount should exclude uncalled chips");
  assert(
    state.log.some((entry) => entry === "P0 gets 60 uncalled chips back."),
    "showdown log should record the uncalled chip return",
  );

  state = baseState(
    [
      makePlayer(0, {
        stack: 900,
        roundBet: 100,
        committed: 100,
        acted: true,
      }),
      makePlayer(1, {
        stack: 980,
        roundBet: 20,
        committed: 20,
        acted: false,
      }),
    ],
    1,
    {
      currentBet: 100,
      minimumRaise: 100,
      pot: 120,
    },
  );

  state = engine.applyHoldemAction(state, { type: "fold" });
  const winner = state.players.find((player) => player.seatIndex === 0);
  assert(state.street === "handComplete", "fold should award an uncontested pot");
  assert(winner.stack === 1020, "uncontested winner should get 80 back, then win the 40-chip pot");
  assert(state.winners[0]?.amount === 40, "uncontested winner amount should exclude uncalled chips");
  assert(
    state.log.some((entry) => entry === "P0 gets 80 uncalled chips back."),
    "uncontested log should record the uncalled chip return",
  );
};

const testClockTimeoutRules = () => {
  let state = baseState(
    [
      makePlayer(0, {
        stack: 900,
        roundBet: 100,
        committed: 100,
        acted: true,
      }),
      makePlayer(1, {
        stack: 980,
        roundBet: 20,
        committed: 20,
        acted: false,
      }),
    ],
    1,
    {
      currentBet: 100,
      minimumRaise: 100,
      pot: 120,
    },
  );

  state = engine.applyHoldemAction(state, { type: "timeout" });
  const timedOutCaller = state.players.find((player) => player.seatIndex === 1);
  assert(timedOutCaller.folded, "a player facing a bet should have a dead hand after clock timeout");
  assert(timedOutCaller.lastAction === "timeout fold", "clock timeout facing a bet should be recorded as a timeout fold");
  assert(state.street === "handComplete", "heads-up timeout fold should award an uncontested pot");
  assert(
    state.log.some((entry) => entry === "P1 times out. Hand is dead."),
    "timeout fold should be recorded in the hand log",
  );

  state = baseState(
    [
      makePlayer(0, {
        roundBet: 0,
        committed: 10,
        acted: true,
        holeCards: [card("A", "s"), card("K", "d")],
      }),
      makePlayer(1, {
        roundBet: 0,
        committed: 10,
        acted: true,
        holeCards: [card("A", "h"), card("Q", "d")],
      }),
      makePlayer(2, {
        roundBet: 0,
        committed: 10,
        acted: false,
        holeCards: [card("K", "c"), card("Q", "s")],
      }),
    ],
    2,
    {
      street: "river",
      buttonIndex: 0,
      currentBet: 0,
      communityCards: [
        card("2", "c"),
        card("3", "d"),
        card("4", "h"),
        card("5", "s"),
        card("9", "c"),
      ],
      pot: 30,
    },
  );

  state = engine.applyHoldemAction(state, { type: "timeout" });
  const timedOutChecker = state.players.find((player) => player.seatIndex === 2);
  assert(!timedOutChecker.folded, "a player not facing a bet should not fold after clock timeout");
  assert(timedOutChecker.lastAction === "timeout check", "clock timeout with no bet should be recorded as a timeout check");
  assert(state.street === "handComplete", "timeout check should continue normal street completion");
  assert(
    state.log.some((entry) => entry === "P2 times out and checks."),
    "timeout check should be recorded in the hand log",
  );
};

const testShowdownOrder = () => {
  let state = baseState(
    [
      makePlayer(0, {
        roundBet: 0,
        committed: 10,
        acted: true,
        holeCards: [card("A", "s"), card("K", "d")],
      }),
      makePlayer(1, {
        roundBet: 0,
        committed: 10,
        acted: true,
        holeCards: [card("A", "h"), card("Q", "d")],
      }),
      makePlayer(2, {
        roundBet: 0,
        committed: 10,
        acted: false,
        holeCards: [card("K", "c"), card("Q", "s")],
      }),
    ],
    2,
    {
      street: "river",
      buttonIndex: 0,
      currentBet: 0,
      communityCards: [
        card("2", "c"),
        card("3", "d"),
        card("4", "h"),
        card("5", "s"),
        card("9", "c"),
      ],
      pot: 30,
    },
  );
  state = engine.applyHoldemAction(state, { type: "check" });
  assert(state.street === "handComplete", "river check should settle showdown");
  assert(
    sameOrder(state.showdownOrderSeatIndexes, [1, 2, 0]),
    "without a river wager, showdown should start left of the button",
  );
  assert(
    state.log[0]?.startsWith("Showdown order: P1, P2, P0."),
    "showdown log should expose the no-wager order from the engine state",
  );

  state = baseState(
    [
      makePlayer(0, {
        roundBet: 20,
        committed: 20,
        acted: true,
        holeCards: [card("A", "s"), card("K", "d")],
      }),
      makePlayer(1, {
        roundBet: 20,
        committed: 20,
        acted: true,
        holeCards: [card("A", "h"), card("Q", "d")],
      }),
      makePlayer(2, {
        roundBet: 0,
        committed: 0,
        stack: 100,
        acted: false,
        holeCards: [card("K", "c"), card("Q", "s")],
      }),
    ],
    2,
    {
      street: "river",
      buttonIndex: 0,
      currentBet: 20,
      minimumRaise: 20,
      lastAggressorSeatIndex: 1,
      communityCards: [
        card("2", "c"),
        card("3", "d"),
        card("4", "h"),
        card("5", "s"),
        card("9", "c"),
      ],
      pot: 40,
    },
  );
  state = engine.applyHoldemAction(state, { type: "call" });
  assert(state.street === "handComplete", "river call should settle showdown");
  assert(
    sameOrder(state.showdownOrderSeatIndexes, [1, 2, 0]),
    "with a river wager, the last aggressor should show first",
  );
  assert(
    state.log[0]?.startsWith("Showdown order: P1, P2, P0."),
    "showdown log should expose the last-aggressor order from the engine state",
  );

  state = baseState(
    [
      makePlayer(0, {
        stack: 0,
        committed: 40,
        allIn: true,
        acted: true,
        holeCards: [card("A", "s"), card("A", "d")],
      }),
      makePlayer(1, {
        stack: 900,
        committed: 100,
        acted: true,
        holeCards: [card("K", "c"), card("K", "d")],
      }),
      makePlayer(2, {
        stack: 900,
        committed: 100,
        acted: false,
        holeCards: [card("Q", "c"), card("Q", "d")],
      }),
    ],
    2,
    {
      street: "river",
      buttonIndex: 2,
      currentBet: 0,
      communityCards: [
        card("2", "c"),
        card("3", "d"),
        card("4", "h"),
        card("5", "s"),
        card("9", "c"),
      ],
      pot: 240,
    },
  );
  state = engine.applyHoldemAction(state, { type: "check" });
  assert(state.street === "handComplete", "single side-pot river check should settle showdown");
  assert(
    sameOrder(state.showdownOrderSeatIndexes, [1, 2, 0]),
    "side-pot participants should show before the main-pot-only all-in player",
  );
  assert(
    state.log[0]?.startsWith("Showdown order: P1, P2, P0."),
    "showdown log should expose side-pot participants before main-pot-only all-in",
  );
  assert(
    state.winners[0]?.seatIndex === 1 && state.winners[1]?.seatIndex === 0,
    "side-pot winner should be listed before the main-pot winner",
  );
  assert(
    state.message.includes("Best hand: Straight, 5 High."),
    "best-hand summary should still use the strongest tabled hand, not the first side-pot winner",
  );

  state = baseState(
    [
      makePlayer(0, {
        stack: 0,
        committed: 20,
        allIn: true,
        acted: true,
        holeCards: [card("A", "s"), card("Q", "d")],
      }),
      makePlayer(1, {
        stack: 0,
        committed: 50,
        allIn: true,
        acted: true,
        holeCards: [card("K", "c"), card("Q", "s")],
      }),
      makePlayer(2, {
        stack: 900,
        committed: 100,
        acted: true,
        holeCards: [card("J", "c"), card("J", "d")],
      }),
      makePlayer(3, {
        stack: 900,
        committed: 100,
        acted: false,
        holeCards: [card("T", "c"), card("T", "d")],
      }),
    ],
    3,
    {
      street: "river",
      buttonIndex: 3,
      currentBet: 0,
      communityCards: [
        card("2", "c"),
        card("3", "d"),
        card("4", "h"),
        card("5", "s"),
        card("9", "c"),
      ],
      pot: 270,
    },
  );
  state = engine.applyHoldemAction(state, { type: "check" });
  assert(state.street === "handComplete", "multi side-pot river check should settle showdown");
  assert(
    sameOrder(state.showdownOrderSeatIndexes, [2, 3, 1, 0]),
    "highest side-pot participants should show first, then lower side pots, then main-pot-only all-ins",
  );
};

const testHoleCardVisibility = () => {
  let state = baseState(
    [
      makePlayer(0, {
        roundBet: 20,
        committed: 20,
        acted: true,
      }),
      makePlayer(1, {
        roundBet: 10,
        committed: 10,
        acted: false,
      }),
    ],
    1,
    {
      currentBet: 20,
      minimumRaise: 20,
    },
  );
  state = engine.applyHoldemAction(state, { type: "fold" });
  assert(state.street === "handComplete", "folding heads-up should award an uncontested pot");
  assert(
    state.showdownOrderSeatIndexes.length === 0,
    "uncontested pots should not produce a showdown order",
  );
  assert(
    engine.visibleHoleCardsForPlayer(state, state.players[0]).length === 0,
    "non-user winner should not reveal hole cards after an uncontested pot",
  );

  state = baseState(
    [
      makePlayer(0, {
        roundBet: 0,
        committed: 10,
        acted: true,
        isUser: true,
      }),
      makePlayer(1, {
        roundBet: 0,
        committed: 10,
        acted: true,
      }),
      makePlayer(2, {
        roundBet: 0,
        committed: 10,
        acted: false,
      }),
    ],
    2,
    {
      street: "river",
      buttonIndex: 0,
      currentBet: 0,
      communityCards: [
        card("2", "c"),
        card("3", "d"),
        card("4", "h"),
        card("5", "s"),
        card("9", "c"),
      ],
      pot: 30,
    },
  );
  state = engine.applyHoldemAction(state, { type: "check" });
  assert(state.street === "handComplete", "river check should settle a visible showdown");
  assert(
    engine.visibleHoleCardsForPlayer(state, state.players[0]).length === 2,
    "user hole cards should remain visible",
  );
  assert(
    engine.visibleHoleCardsForPlayer(state, state.players[1]).length === 2,
    "showdown participant should reveal hole cards",
  );
};

testShortAllInReopenRules();
testWagerTargets();
testOddChipOrder();
testBurnCards();
testSingleActionablePlayerRunsOutBoard();
testShortBigBlindAllInDoesNotForceNominalCall();
testUncalledBetsReturn();
testClockTimeoutRules();
testShowdownOrder();
testHoleCardVisibility();

console.log("card room Hold'em WSOP smoke checks passed");
