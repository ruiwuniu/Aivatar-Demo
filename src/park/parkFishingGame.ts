import type { ParkRandomSource } from "./parkProbability";

export const PARK_FISHING_INVITE_CHANCE = 0.35;
export const PARK_FISHING_INVITE_COOLDOWN_MS = 60_000;
export const PARK_FISHING_INVITE_DURATION_MS = 12_000;
export const PARK_FISHING_HITS_TO_WIN = 3;
export const PARK_FISHING_MISSES_TO_LOSE = 2;
export const PARK_FISHING_MIN_ROUND_DURATION_MS = 2200;
export const PARK_FISHING_MAX_ROUND_DURATION_MS = 3400;
export const PARK_FISHING_MIN_TARGET_WIDTH = 0.2;
export const PARK_FISHING_MAX_TARGET_WIDTH = 0.32;
const TARGET_EDGE_MARGIN = 0.2;
export const PARK_FISHING_ROUND_FEEDBACK_MS = 350;
export const PARK_FISHING_ESCAPE_FEEDBACK_MS = 1200;

export interface ParkFishingGame {
  id: number;
  phase: "invite" | "waiting" | "qte" | "success" | "escaped";
  expiresAt: number;
  biteAt: number;
  round: number;
  roundStartedAt: number;
  roundEndsAt: number;
  hits: number;
  misses: number;
  targetStart: number;
  targetEnd: number;
  direction: "forward" | "reverse";
  nextInputAt: number;
  lastOutcome?: "hit" | "miss";
}

export type ParkFishingInput = {
  type: "accept" | "decline" | "reel" | "cancel";
  id: number;
  round?: number;
};

const unitRandom = (random: ParkRandomSource) => {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
};

export const createParkFishingInvite = (id: number, now: number): ParkFishingGame => ({
  id,
  phase: "invite",
  expiresAt: now + PARK_FISHING_INVITE_DURATION_MS,
  biteAt: 0,
  round: 0,
  roundStartedAt: 0,
  roundEndsAt: 0,
  hits: 0,
  misses: 0,
  targetStart: 0,
  targetEnd: 0,
  direction: "forward",
  nextInputAt: 0,
});

export const acceptParkFishingInvite = (
  game: ParkFishingGame,
  now: number,
  random: ParkRandomSource,
): ParkFishingGame => ({
  ...game,
  phase: "waiting",
  expiresAt: 0,
  biteAt: now + 4000 + unitRandom(random) * 6000,
});

export const startParkFishingRound = (
  game: ParkFishingGame,
  now: number,
  random: ParkRandomSource,
  feedback = false,
): ParkFishingGame => {
  const roundStartedAt = now + (feedback ? PARK_FISHING_ROUND_FEEDBACK_MS : 0);
  // Sample once per round: varying speed, target and direction must not make
  // the marker jump or move the target while the user is judging a hit.
  const durationMs = PARK_FISHING_MIN_ROUND_DURATION_MS
    + unitRandom(random) * (PARK_FISHING_MAX_ROUND_DURATION_MS - PARK_FISHING_MIN_ROUND_DURATION_MS);
  const targetWidth = PARK_FISHING_MIN_TARGET_WIDTH
    + unitRandom(random) * (PARK_FISHING_MAX_TARGET_WIDTH - PARK_FISHING_MIN_TARGET_WIDTH);
  // Symmetric margins leave at least 440 ms to react from either direction,
  // and the narrowest target remains hittable for at least 440 ms.
  const targetStart = TARGET_EDGE_MARGIN
    + unitRandom(random) * (1 - targetWidth - TARGET_EDGE_MARGIN * 2);
  const direction = unitRandom(random) < 0.5 ? "forward" : "reverse";
  return {
    ...game,
    phase: "qte",
    round: game.round + 1,
    roundStartedAt,
    roundEndsAt: roundStartedAt + durationMs,
    targetStart,
    targetEnd: targetStart + targetWidth,
    direction,
    nextInputAt: roundStartedAt,
    lastOutcome: feedback ? game.lastOutcome : undefined,
  };
};

export const parkFishingCursor = (game: ParkFishingGame, now: number) => {
  const duration = game.roundEndsAt - game.roundStartedAt;
  const startsFromRight = game.direction === "reverse";
  if (duration <= 0 || !Number.isFinite(now)) return startsFromRight ? 1 : 0;
  const progress = Math.max(0, Math.min(1, (now - game.roundStartedAt) / duration));
  return startsFromRight ? 1 - progress : progress;
};

export const finishParkFishingRound = (
  game: ParkFishingGame,
  hit: boolean,
  now: number,
  random: ParkRandomSource,
): ParkFishingGame => {
  const next: ParkFishingGame = {
    ...game,
    hits: game.hits + (hit ? 1 : 0),
    misses: game.misses + (hit ? 0 : 1),
    lastOutcome: hit ? "hit" : "miss",
  };
  if (next.hits >= PARK_FISHING_HITS_TO_WIN) return { ...next, phase: "success" };
  if (next.misses >= PARK_FISHING_MISSES_TO_LOSE) {
    return { ...next, phase: "escaped", expiresAt: now + PARK_FISHING_ESCAPE_FEEDBACK_MS };
  }
  return startParkFishingRound(next, now, random, true);
};
