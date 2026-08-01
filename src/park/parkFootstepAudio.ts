import type { AvatarAppearanceId } from "../types";

export interface ParkFootstepAudioController {
  voices: HTMLAudioElement[];
  distanceSinceStep: number;
  nextStepDistance: number;
  voiceIndex: number;
}

export interface ParkFootstepUpdate {
  appearanceId: AvatarAppearanceId;
  distancePx: number;
  onGrass: boolean;
}

export const PARK_FOOTSTEP_MUTED_APPEARANCE_ID: AvatarAppearanceId =
  "cute-ghost";

const AUDIO_VOLUME_KEY = "aivatar.audioVolume.v1";
const DEFAULT_AUDIO_VOLUME = 0.65;
const PARK_FOOTSTEP_VOLUME_MIN = 0.055;
export const PARK_FOOTSTEP_VOLUME_MAX = 0.07;
const PARK_FOOTSTEP_DISTANCE_MIN = 18;
const PARK_FOOTSTEP_DISTANCE_VARIANCE = 4;
const PARK_FOOTSTEP_SOURCES = [
  "/audio/park-grass-step-1.wav",
  "/audio/park-grass-step-2.wav",
  "/audio/park-grass-step-3.wav",
  "/audio/park-grass-step-4.wav",
] as const;

const readGlobalAudioVolume = () => {
  const stored = Number.parseFloat(localStorage.getItem(AUDIO_VOLUME_KEY) ?? "");
  return Number.isFinite(stored)
    ? Math.max(0, Math.min(1, stored))
    : DEFAULT_AUDIO_VOLUME;
};

const nextStepDistance = () =>
  PARK_FOOTSTEP_DISTANCE_MIN + Math.random() * PARK_FOOTSTEP_DISTANCE_VARIANCE;

export const createParkFootstepAudio = (): ParkFootstepAudioController => ({
  voices: PARK_FOOTSTEP_SOURCES.map((source) => {
    const audio = new Audio(source);
    audio.preload = "auto";
    return audio;
  }),
  distanceSinceStep: 0,
  nextStepDistance: nextStepDistance(),
  voiceIndex: -1,
});

export const stopParkFootstepAudio = (
  controller: ParkFootstepAudioController | null,
  resetDistance = true,
) => {
  if (!controller) return;
  const hasActiveAudio = controller.voices.some((audio) => !audio.paused);
  if (resetDistance && controller.distanceSinceStep <= 0 && !hasActiveAudio) {
    return;
  }
  if (resetDistance) {
    controller.distanceSinceStep = 0;
    controller.nextStepDistance = nextStepDistance();
  }
  controller.voices.forEach((audio) => {
    if (!audio.paused) audio.pause();
    audio.currentTime = 0;
  });
};

const playNextParkFootstep = (controller: ParkFootstepAudioController) => {
  const globalVolume = readGlobalAudioVolume();
  if (globalVolume <= 0) return;

  const offset = 1 + Math.floor(Math.random() * (controller.voices.length - 1));
  controller.voiceIndex =
    (controller.voiceIndex + offset) % controller.voices.length;
  const audio = controller.voices[controller.voiceIndex];
  audio.pause();
  audio.currentTime = 0;
  audio.playbackRate = 0.97 + Math.random() * 0.07;
  const volumeMultiplier =
    PARK_FOOTSTEP_VOLUME_MIN +
    Math.random() * (PARK_FOOTSTEP_VOLUME_MAX - PARK_FOOTSTEP_VOLUME_MIN);
  audio.volume = Math.min(1, globalVolume * volumeMultiplier);
  void audio.play().catch(() => undefined);
};

export const updateParkFootstepAudio = (
  controller: ParkFootstepAudioController | null,
  update: ParkFootstepUpdate,
) => {
  if (!controller) return;
  if (
    update.appearanceId === PARK_FOOTSTEP_MUTED_APPEARANCE_ID ||
    !update.onGrass ||
    (typeof document !== "undefined" && document.visibilityState === "hidden")
  ) {
    stopParkFootstepAudio(controller);
    return;
  }

  if (!Number.isFinite(update.distancePx) || update.distancePx <= 0.05) return;
  controller.distanceSinceStep += update.distancePx;
  if (controller.distanceSinceStep < controller.nextStepDistance) return;

  controller.distanceSinceStep %= controller.nextStepDistance;
  controller.nextStepDistance = nextStepDistance();
  playNextParkFootstep(controller);
};

export const disposeParkFootstepAudio = (
  controller: ParkFootstepAudioController | null,
) => {
  if (!controller) return;
  stopParkFootstepAudio(controller);
  controller.voices.forEach((audio) => {
    audio.removeAttribute("src");
    audio.load();
  });
};
