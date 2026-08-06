import type { AvatarAppearanceId } from "../types";
import {
  createParkSfxAudioContext,
  readParkSfxVolume,
} from "./parkSfxVolume";

export interface ParkFootstepAudioController {
  context: AudioContext | null;
  buffers: AudioBuffer[];
  activeVoices: Map<AudioBufferSourceNode, GainNode>;
  loadPromise: Promise<void> | null;
  abortController: AbortController | null;
  disposed: boolean;
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

const PARK_FOOTSTEP_VOLUME_MIN = 0.22;
export const PARK_FOOTSTEP_VOLUME_MAX = 0.28;
const PARK_FOOTSTEP_DISTANCE_MIN = 18;
const PARK_FOOTSTEP_DISTANCE_VARIANCE = 4;
const PARK_FOOTSTEP_SOURCES = [
  "/audio/park-grass-step-1.wav",
  "/audio/park-grass-step-2.wav",
  "/audio/park-grass-step-3.wav",
  "/audio/park-grass-step-4.wav",
] as const;

const nextStepDistance = () =>
  PARK_FOOTSTEP_DISTANCE_MIN + Math.random() * PARK_FOOTSTEP_DISTANCE_VARIANCE;

export const createParkFootstepAudio = (): ParkFootstepAudioController => {
  const context = createParkSfxAudioContext();
  const abortController = context ? new AbortController() : null;
  const controller: ParkFootstepAudioController = {
    context,
    buffers: [],
    activeVoices: new Map(),
    loadPromise: null,
    abortController,
    disposed: false,
    distanceSinceStep: 0,
    nextStepDistance: nextStepDistance(),
    voiceIndex: -1,
  };
  if (!context || !abortController) return controller;

  controller.loadPromise = Promise.allSettled(
    PARK_FOOTSTEP_SOURCES.map(async (source) => {
      const response = await fetch(source, { signal: abortController.signal });
      if (!response.ok) throw new Error(`Could not load park footstep: ${source}`);
      return context.decodeAudioData(await response.arrayBuffer());
    }),
  )
    .then((results) => {
      if (!controller.disposed && context.state !== "closed") {
        controller.buffers = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : []
        );
      }
    })
    .catch(() => undefined)
    .finally(() => {
      controller.loadPromise = null;
    });
  return controller;
};

export const stopParkFootstepAudio = (
  controller: ParkFootstepAudioController | null,
  resetDistance = true,
) => {
  if (!controller) return;
  const hasActiveAudio = controller.activeVoices.size > 0;
  if (resetDistance && controller.distanceSinceStep <= 0 && !hasActiveAudio) {
    return;
  }
  if (resetDistance) {
    controller.distanceSinceStep = 0;
    controller.nextStepDistance = nextStepDistance();
  }
  controller.activeVoices.forEach((gain, source) => {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // A source that has already ended needs no further cleanup.
    }
    source.disconnect();
    gain.disconnect();
  });
  controller.activeVoices.clear();
};

const playDecodedParkFootstep = (
  controller: ParkFootstepAudioController,
  globalVolume: number,
) => {
  const context = controller.context;
  if (
    !context
    || context.state !== "running"
    || controller.disposed
    || controller.buffers.length === 0
  ) return;

  const offset = 1 + Math.floor(Math.random() * (controller.buffers.length - 1));
  controller.voiceIndex =
    (controller.voiceIndex + offset) % controller.buffers.length;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = controller.buffers[controller.voiceIndex];
  source.playbackRate.value = 0.97 + Math.random() * 0.07;
  const volumeMultiplier =
    PARK_FOOTSTEP_VOLUME_MIN
    + Math.random() * (PARK_FOOTSTEP_VOLUME_MAX - PARK_FOOTSTEP_VOLUME_MIN);
  gain.gain.value = Math.min(1, globalVolume * volumeMultiplier);
  source.connect(gain);
  gain.connect(context.destination);
  source.onended = () => {
    if (!controller.activeVoices.delete(source)) return;
    source.disconnect();
    gain.disconnect();
  };
  controller.activeVoices.set(source, gain);
  try {
    source.start();
  } catch {
    controller.activeVoices.delete(source);
    source.disconnect();
    gain.disconnect();
  }
};

export const resumeParkFootstepAudio = (
  controller: ParkFootstepAudioController | null,
) => {
  const context = controller?.context;
  if (
    !controller
    || !context
    || context.state === "running"
    || context.state === "closed"
    || controller.disposed
  ) return;
  void context.resume().catch(() => undefined);
};

const playNextParkFootstep = (controller: ParkFootstepAudioController) => {
  const sfxVolume = readParkSfxVolume();
  if (sfxVolume === 0) return;
  const context = controller.context;
  if (!context || context.state === "closed" || controller.disposed) return;
  if (context.state !== "running") {
    resumeParkFootstepAudio(controller);
    return;
  }
  playDecodedParkFootstep(controller, sfxVolume);
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
  controller.disposed = true;
  stopParkFootstepAudio(controller);
  controller.abortController?.abort();
  controller.abortController = null;
  controller.buffers = [];
  const context = controller.context;
  controller.context = null;
  if (context && context.state !== "closed") {
    void context.close().catch(() => undefined);
  }
};
