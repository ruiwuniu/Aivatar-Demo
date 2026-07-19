import type { AivatarGrowthTraits } from "../types";

export type ParkRandomSource = () => number;

const MAX_TRAIT_POINTS = 1_000_000;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const normalizedParkTrait = (points: number | undefined) =>
  clamp01(
    Math.log10(Math.max(0, Number.isFinite(points) ? points ?? 0 : 0) + 1) /
      Math.log10(MAX_TRAIT_POINTS + 1),
  );

export const fishingCatchProbability = (focusPoints: number | undefined) =>
  0.2 + normalizedParkTrait(focusPoints) * 0.6;

export const canLandFishingCatch = (
  focusPoints: number | undefined,
  random: ParkRandomSource = Math.random,
) => clamp01(random()) < fishingCatchProbability(focusPoints);

export const fishingSessionDurationSeconds = (
  resiliencePoints: number | undefined,
  random: ParkRandomSource = Math.random,
) => {
  const baseSeconds = 25 + normalizedParkTrait(resiliencePoints) * 95;
  const jitter = 0.85 + clamp01(random()) * 0.3;
  return baseSeconds * jitter;
};

export const fishingBiteDelaySeconds = (random: ParkRandomSource = Math.random) =>
  6 + clamp01(random()) * 6;

export const cookingChoiceProbability = (warmthPoints: number | undefined) =>
  0.1 + normalizedParkTrait(warmthPoints) * 0.65;

export const shouldChooseCooking = (
  warmthPoints: number | undefined,
  random: ParkRandomSource = Math.random,
) => clamp01(random()) < cookingChoiceProbability(warmthPoints);

export const PARK_FISH_IDS = ["raw-black-bass", "raw-crucian-carp"] as const;
export type ParkRawFishId = (typeof PARK_FISH_IDS)[number];

export const randomFishingCatch = (
  random: ParkRandomSource = Math.random,
): ParkRawFishId => PARK_FISH_IDS[clamp01(random()) < 0.5 ? 0 : 1];

export const fishingRewards = () => ({ mood: 10, curiosity: 1 });

export const traitsForParkDecision = (
  traits: Partial<AivatarGrowthTraits> | null | undefined,
) => ({
  focus: Math.max(0, traits?.focus ?? 0),
  resilience: Math.max(0, traits?.resilience ?? 0),
  warmth: Math.max(0, traits?.warmth ?? 0),
});
