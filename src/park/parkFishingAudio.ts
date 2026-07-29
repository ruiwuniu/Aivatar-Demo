import type { ParkFishingPose } from "./parkRuntime";

type ParkFishingSoundPose = Extract<
  ParkFishingPose,
  "cast" | "bite" | "reel" | "display"
>;

export type ParkFishingAudioBank = Record<
  ParkFishingSoundPose,
  HTMLAudioElement
>;

const AUDIO_VOLUME_KEY = "aivatar.audioVolume.v1";
const DEFAULT_AUDIO_VOLUME = 0.65;
const FISHING_AUDIO_SOURCES: Record<ParkFishingSoundPose, string> = {
  cast: "/audio/fishing-cast.wav",
  bite: "/audio/fishing-bite.wav",
  reel: "/audio/fishing-reel.wav",
  display: "/audio/fishing-display.wav",
};
const FISHING_AUDIO_VOLUME_MULTIPLIERS: Record<ParkFishingSoundPose, number> = {
  cast: 0.5,
  bite: 0.52,
  reel: 0.42,
  display: 0.48,
};

const isFishingSoundPose = (
  pose: ParkFishingPose,
): pose is ParkFishingSoundPose =>
  pose === "cast" ||
  pose === "bite" ||
  pose === "reel" ||
  pose === "display";

const readGlobalAudioVolume = () => {
  const stored = Number.parseFloat(localStorage.getItem(AUDIO_VOLUME_KEY) ?? "");
  return Number.isFinite(stored)
    ? Math.max(0, Math.min(1, stored))
    : DEFAULT_AUDIO_VOLUME;
};

export const createParkFishingAudioBank = (): ParkFishingAudioBank => {
  const entries = Object.entries(FISHING_AUDIO_SOURCES).map(([pose, source]) => {
    const audio = new Audio(source);
    audio.preload = "auto";
    return [pose, audio];
  });
  return Object.fromEntries(entries) as ParkFishingAudioBank;
};

export const playParkFishingSound = (
  bank: ParkFishingAudioBank | null,
  pose: ParkFishingPose,
) => {
  if (!bank || !isFishingSoundPose(pose)) return;
  const globalVolume = readGlobalAudioVolume();
  if (globalVolume <= 0) return;
  const audio = bank[pose];
  audio.pause();
  audio.currentTime = 0;
  audio.volume = Math.min(
    1,
    globalVolume * FISHING_AUDIO_VOLUME_MULTIPLIERS[pose],
  );
  void audio.play().catch(() => undefined);
};

export const disposeParkFishingAudioBank = (
  bank: ParkFishingAudioBank | null,
) => {
  if (!bank) return;
  Object.values(bank).forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
  });
};
