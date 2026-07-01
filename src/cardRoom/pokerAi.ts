import { Hand } from "pokersolver";
import type { AivatarDarkTraits, AivatarGrowthTraits } from "../types";
import {
  cardToSolverCode,
  creditAvailable,
  legalActionsForActivePlayer,
  type HoldemAction,
  type HoldemPlayer,
  type HoldemTableState,
  type PlayingCard,
} from "./holdemEngine";
import type { CardRoomActionType } from "./cardRoomRuntime";

const rankValues: Record<string, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

const traitScale = (value: number | undefined) =>
  clamp(Math.log10(Math.max(0, value ?? 0) + 1) / Math.log10(1_000_001));

const darkScale = (value: number | undefined) =>
  clamp(Math.max(0, value ?? 0) / 100);

export const preflopStrength = (cards: PlayingCard[]) => {
  const [left, right] = cards;
  if (!left || !right) return 0.25;
  const high = Math.max(rankValues[left.rank], rankValues[right.rank]);
  const low = Math.min(rankValues[left.rank], rankValues[right.rank]);
  const pair = left.rank === right.rank;
  const suited = left.suit === right.suit;
  const connected = Math.abs(high - low) <= 1;
  const oneGap = Math.abs(high - low) === 2;

  let score = high / 18 + low / 42;
  if (pair) score += high >= 11 ? 0.36 : 0.24;
  if (suited) score += 0.06;
  if (connected) score += 0.05;
  if (oneGap) score += 0.025;
  if (high === 14) score += 0.07;
  if (high <= 9 && low <= 6 && !suited && !connected && !pair) score -= 0.16;

  return clamp(score, 0.08, 0.96);
};

const madeHandStrength = (player: HoldemPlayer, communityCards: PlayingCard[]) => {
  if (communityCards.length < 3) return preflopStrength(player.holeCards);
  const solved = Hand.solve([...player.holeCards, ...communityCards].map(cardToSolverCode));
  const rankScore = solved.rank / 9;
  const highCards = player.holeCards
    .map((card) => rankValues[card.rank])
    .sort((left, right) => right - left);
  const kickerScore = ((highCards[0] ?? 2) + (highCards[1] ?? 2)) / 56;
  return clamp(rankScore * 0.76 + kickerScore * 0.24, 0.05, 0.99);
};

const styleFromTraits = (traits: AivatarGrowthTraits, darkTraits: AivatarDarkTraits) => {
  const focus = traitScale(traits.focus);
  const resilience = traitScale(traits.resilience);
  const curiosity = traitScale(traits.curiosity);
  const efficiency = traitScale(traits.efficiency);
  const creativity = traitScale(traits.creativity);
  const warmth = traitScale(traits.warmth);
  const greed = darkScale(darkTraits.greed);
  const foolishness = darkScale(darkTraits.foolishness);
  const recklessness = darkScale(darkTraits.recklessness);
  const cowardice = darkScale(darkTraits.cowardice);
  const arrogance = darkScale(darkTraits.arrogance);
  const coldness = darkScale(darkTraits.coldness);

  return {
    discipline: clamp(0.36 + focus * 0.26 + efficiency * 0.18 - foolishness * 0.28),
    risk: clamp(0.28 + recklessness * 0.3 + curiosity * 0.1 + resilience * 0.12 - cowardice * 0.26),
    pressure: clamp(0.25 + greed * 0.24 + arrogance * 0.22 + coldness * 0.16 + creativity * 0.08),
    caution: clamp(0.18 + cowardice * 0.32 + warmth * 0.08 + focus * 0.08 - recklessness * 0.16),
    confusion: clamp(foolishness * 0.42 + arrogance * 0.08 - focus * 0.12),
  };
};

export const describePokerTemperament = (
  traits: AivatarGrowthTraits,
  darkTraits: AivatarDarkTraits,
) => {
  const style = styleFromTraits(traits, darkTraits);
  if (style.pressure > 0.62 && style.risk > 0.5) return "pressure-heavy";
  if (style.caution > 0.52) return "tight";
  if (style.discipline > 0.58) return "disciplined";
  if (style.confusion > 0.35) return "erratic";
  return "balanced";
};

export const choosePokerAiAction = (
  table: HoldemTableState,
  player: HoldemPlayer,
): HoldemAction => {
  const toCall = Math.max(0, table.currentBet - player.roundBet);
  const availableCredit = creditAvailable(player);
  const strength = madeHandStrength(player, table.communityCards);
  const style = styleFromTraits(player.traits, player.darkTraits);
  const legal = legalActionsForActivePlayer(table);
  const noise = (Math.random() - 0.5) * (0.12 + style.confusion * 0.2);
  const confidence = clamp(
    strength + style.risk * 0.12 + style.pressure * 0.1 - style.caution * 0.12 + noise,
  );
  const potOdds = toCall > 0 ? toCall / Math.max(1, table.pot + toCall) : 0;
  const stackPressure = toCall > 0 ? toCall / Math.max(1, availableCredit + toCall) : 0;
  const targetRaise =
    table.currentBet === 0
      ? table.bigBlind * (2 + Math.round(style.pressure * 3))
      : legal.minRaiseTo + table.minimumRaise * Math.round(style.pressure * 2);

  if (availableCredit <= 0) return { type: "check" };

  if (toCall === 0) {
    const betThreshold = 0.58 - style.pressure * 0.18 - style.risk * 0.1;
    if (confidence > betThreshold && (legal.canBet || legal.canRaise)) {
      if (confidence > 0.88 && style.risk > 0.55) return { type: "all-in" };
      return {
        type: table.currentBet === 0 ? "bet" : "raise",
        amount: Math.min(player.roundBet + availableCredit, targetRaise),
      };
    }
    return { type: "check" };
  }

  const callThreshold =
    potOdds * (0.88 + style.caution * 0.7) + stackPressure * 0.16 - style.discipline * 0.08;
  const pressureRaiseThreshold = 0.72 - style.pressure * 0.18 - style.risk * 0.08;

  if (confidence + style.confusion * 0.14 < callThreshold) return { type: "fold" };
  if (legal.canRaise && confidence > pressureRaiseThreshold) {
    if (confidence > 0.92 && style.risk > 0.54) return { type: "all-in" };
    return {
      type: "raise",
      amount: Math.min(player.roundBet + availableCredit, targetRaise),
    };
  }
  return availableCredit <= toCall ? { type: "all-in" } : { type: "call" };
};

const timingScales = (traits: AivatarGrowthTraits, darkTraits: AivatarDarkTraits) => ({
  focus: traitScale(traits.focus),
  resilience: traitScale(traits.resilience),
  curiosity: traitScale(traits.curiosity),
  efficiency: traitScale(traits.efficiency),
  creativity: traitScale(traits.creativity),
  warmth: traitScale(traits.warmth),
  greed: darkScale(darkTraits.greed),
  foolishness: darkScale(darkTraits.foolishness),
  recklessness: darkScale(darkTraits.recklessness),
  cowardice: darkScale(darkTraits.cowardice),
  arrogance: darkScale(darkTraits.arrogance),
  coldness: darkScale(darkTraits.coldness),
});

export const pokerAiActionDelayMs = (
  table: HoldemTableState,
  player: HoldemPlayer,
  action: HoldemAction,
) => {
  const traits = timingScales(player.traits, player.darkTraits);
  const toCall = Math.max(0, table.currentBet - player.roundBet);
  const availableCredit = creditAvailable(player);
  const strength = madeHandStrength(player, table.communityCards);
  const potPressure = clamp(table.pot / Math.max(table.bigBlind * 20, 1));
  const callPressure = clamp(toCall / Math.max(table.bigBlind * 8, 1));
  const stackPressure =
    toCall > 0 ? clamp(toCall / Math.max(availableCredit + toCall, 1)) : 0;
  const marginalDecision =
    toCall > 0
      ? 1 - clamp(Math.abs(strength - 0.52) / 0.34)
      : 1 - clamp(Math.abs(strength - 0.62) / 0.38);

  const actionBase =
    action.type === "check"
      ? 720
      : action.type === "fold"
        ? 960
        : action.type === "call"
          ? 1180
          : action.type === "bet"
            ? 1380
            : action.type === "raise"
              ? 1580
              : 2100;

  const pressurePause =
    (callPressure * 620 + stackPressure * 720 + potPressure * 360) *
    (0.65 + traits.cowardice * 0.5 + traits.greed * 0.35);
  const marginalPause =
    marginalDecision *
    (520 + traits.focus * 220 + traits.curiosity * 180 + traits.cowardice * 380);
  const socialPause = traits.warmth * 120 + traits.creativity * 160;
  const hesitation =
    traits.cowardice * (action.type === "fold" || action.type === "call" ? 520 : 180) +
    traits.greed * (action.type === "call" || action.type === "all-in" ? 360 : 120) +
    traits.foolishness * 280;
  const decisiveness =
    traits.efficiency * 300 +
    traits.recklessness * (action.type === "raise" || action.type === "all-in" ? 620 : 260) +
    traits.arrogance * (action.type === "bet" || action.type === "raise" ? 360 : 180) +
    traits.coldness * 300 +
    traits.resilience * 120;
  const jitter =
    (Math.random() - 0.5) *
    (520 + traits.foolishness * 900 + traits.creativity * 260 + traits.curiosity * 220);
  const snapChance =
    traits.recklessness * 0.22 +
    traits.arrogance * 0.12 +
    traits.foolishness * 0.08 -
    traits.cowardice * 0.12;
  const snapAdjustment = Math.random() < clamp(snapChance) ? -520 - traits.recklessness * 620 : 0;

  return Math.round(
    clamp(
      actionBase + pressurePause + marginalPause + socialPause + hesitation - decisiveness + jitter + snapAdjustment,
      420,
      5600,
    ),
  );
};

const pokerAiThinkingCue = (
  table: HoldemTableState,
  player: HoldemPlayer,
  action: HoldemAction,
): { type: CardRoomActionType; text: string; intensity: "small" | "medium" | "large" } => {
  const traits = timingScales(player.traits, player.darkTraits);
  const toCall = Math.max(0, table.currentBet - player.roundBet);
  const pressure = clamp(
    toCall / Math.max(table.bigBlind * 8, 1) +
      table.pot / Math.max(table.bigBlind * 36, 1),
  );
  const aggressiveAction =
    action.type === "bet" || action.type === "raise" || action.type === "all-in";
  const snapScore = traits.recklessness + traits.arrogance * 0.7 + traits.efficiency * 0.35;
  const hesitationScore =
    traits.cowardice + pressure * 0.7 + traits.greed * 0.28 + traits.foolishness * 0.25;
  const pressureScore = traits.coldness + traits.greed * 0.6 + traits.arrogance * 0.35;
  const focusScore = traits.focus + traits.curiosity * 0.45 + traits.resilience * 0.3;

  if (aggressiveAction && snapScore > 1.05 && hesitationScore < 1.1) {
    return {
      type: "snap",
      text: action.type === "all-in" ? "Now." : "I know.",
      intensity: "medium",
    };
  }

  if (hesitationScore > 1.05 && !aggressiveAction) {
    return {
      type: "hesitate",
      text: action.type === "fold" ? "Too much..." : "Hmm...",
      intensity: pressure > 0.55 ? "medium" : "small",
    };
  }

  if (aggressiveAction && pressureScore > 0.85) {
    return {
      type: "pressure",
      text: traits.coldness > 0.5 ? "Make them pay." : "Push.",
      intensity: action.type === "all-in" ? "large" : "medium",
    };
  }

  if (traits.foolishness > 0.55 && Math.random() < 0.45) {
    return {
      type: "hesitate",
      text: "Wait...",
      intensity: "small",
    };
  }

  return {
    type: "think",
    text: focusScore > 0.85 ? "Counting odds." : "Thinking...",
    intensity: pressure > 0.6 ? "medium" : "small",
  };
};

export const choosePokerAiMove = (table: HoldemTableState, player: HoldemPlayer) => {
  const action = choosePokerAiAction(table, player);
  return {
    action,
    delayMs: pokerAiActionDelayMs(table, player, action),
    thinkingCue: pokerAiThinkingCue(table, player, action),
  };
};
