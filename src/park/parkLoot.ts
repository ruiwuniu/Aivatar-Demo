import type { AivatarSaveState } from "../types";
import { randomFishingCatch, type ParkRandomSource, type ParkRawFishId } from "./parkProbability";

export const PARK_TROPHY_IDS = [
  "fishing-trophy-bronze", "fishing-trophy-silver", "fishing-trophy-gold", "fishing-trophy-crystal",
] as const;
export type ParkTrophyId = (typeof PARK_TROPHY_IDS)[number];
export type ParkCatchItemId = ParkRawFishId | ParkTrophyId | "pond-weed";
export interface ParkCatchReceipt {
  catchId: string;
  itemId: ParkCatchItemId;
  /** Sampled once, so transaction conflicts/retries never roll new rewards. */
  fallbackFishId: ParkRawFishId;
}
export const isFishingTrophy = (id: string): id is ParkTrophyId =>
  (PARK_TROPHY_IDS as readonly string[]).includes(id);
export const ownedFishingTrophies = (save: Pick<AivatarSaveState, "inventory" | "placedItems"> | null | undefined): ParkTrophyId[] =>
  PARK_TROPHY_IDS.filter((id) => save?.inventory?.some((entry) => entry.itemId === id && entry.quantity > 0)
    || save?.placedItems?.some((entry) => entry.itemId === id));

// Integer buckets make the exact rare rates explicit: 100 + 35 + 12 + 3 / 100000.
export const PARK_TROPHY_WEIGHTS = [100, 35, 12, 3] as const;
const safeRoll = (random: ParkRandomSource) => {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0.999999;
};
export const rollParkCatch = (
  manual: boolean,
  ownedIds: readonly string[] = [],
  random: ParkRandomSource = Math.random,
  fallbackFishId: ParkRawFishId = randomFishingCatch(random),
): ParkCatchItemId => {
  const roll = safeRoll(random) * 100_000;
  let boundary = 0;
  for (let index = 0; index < PARK_TROPHY_IDS.length; index += 1) {
    boundary += PARK_TROPHY_WEIGHTS[index]!;
    if (roll < boundary) {
      const trophy = PARK_TROPHY_IDS[index]!;
      return ownedIds.includes(trophy) ? fallbackFishId : trophy;
    }
  }
  return roll < boundary + (manual ? 35_000 : 55_000) ? "pond-weed" : fallbackFishId;
};

let catchSequence = 0;
const catchSession = globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const createParkCatchReceipt = (
  manual: boolean,
  ownedIds: readonly string[] = [],
  random: ParkRandomSource = Math.random,
): ParkCatchReceipt => {
  const fallbackFishId = randomFishingCatch(random);
  return {
    catchId: `park-catch-${catchSession}-${++catchSequence}`,
    itemId: rollParkCatch(manual, ownedIds, random, fallbackFishId),
    fallbackFishId,
  };
};

export const PARK_CATCH_NAMES: Record<ParkCatchItemId, string> = {
  "raw-crucian-carp": "Crucian Carp", "raw-bluegill": "Bluegill", "raw-black-bass": "Black Bass",
  "raw-yellow-perch": "Yellow Perch", "raw-weather-loach": "Weather Loach", "raw-rainbow-trout": "Rainbow Trout",
  "pond-weed": "Pond Weed", "fishing-trophy-bronze": "Bronze Fish Trophy",
  "fishing-trophy-silver": "Silver Wave Trophy", "fishing-trophy-gold": "Golden Koi Trophy",
  "fishing-trophy-crystal": "Starlight Crystal Trophy",
};
