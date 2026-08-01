export interface ParkAmbientAudioController {
  audio: HTMLAudioElement;
  playPending: boolean;
  wantsPlayback: boolean;
}

export const PARK_AMBIENT_AUDIO_VOLUME_KEY = "aivatar.audioVolume.v1";

const PARK_AMBIENT_AUDIO_SOURCE = "/audio/park-sea-cliff-ambience.ogg";
const DEFAULT_AUDIO_VOLUME = 0.65;
const PARK_AMBIENT_AUDIO_VOLUME_MULTIPLIER = 0.22;

const readGlobalAudioVolume = () => {
  const stored = Number.parseFloat(
    localStorage.getItem(PARK_AMBIENT_AUDIO_VOLUME_KEY) ?? "",
  );
  return Number.isFinite(stored)
    ? Math.max(0, Math.min(1, stored))
    : DEFAULT_AUDIO_VOLUME;
};

const applyParkAmbientAudioVolume = (
  controller: ParkAmbientAudioController,
) => {
  const globalVolume = readGlobalAudioVolume();
  controller.audio.volume = Math.min(
    1,
    globalVolume * PARK_AMBIENT_AUDIO_VOLUME_MULTIPLIER,
  );
  return globalVolume;
};

export const createParkAmbientAudio = (): ParkAmbientAudioController => {
  const audio = new Audio(PARK_AMBIENT_AUDIO_SOURCE);
  audio.loop = true;
  audio.preload = "auto";

  const controller = {
    audio,
    playPending: false,
    wantsPlayback: false,
  };
  applyParkAmbientAudioVolume(controller);
  return controller;
};

export const startParkAmbientAudio = (
  controller: ParkAmbientAudioController,
) => {
  controller.wantsPlayback = true;
  const globalVolume = applyParkAmbientAudioVolume(controller);
  if (
    globalVolume <= 0 ||
    (typeof document !== "undefined" &&
      document.visibilityState === "hidden")
  ) {
    controller.audio.pause();
    return;
  }
  if (!controller.audio.paused || controller.playPending) return;

  controller.playPending = true;
  void controller.audio
    .play()
    .catch(() => undefined)
    .finally(() => {
      controller.playPending = false;
    });
};

export const pauseParkAmbientAudio = (
  controller: ParkAmbientAudioController,
) => {
  controller.audio.pause();
};

export const disposeParkAmbientAudio = (
  controller: ParkAmbientAudioController,
) => {
  controller.wantsPlayback = false;
  controller.audio.pause();
  controller.audio.currentTime = 0;
  controller.audio.removeAttribute("src");
  controller.audio.load();
};
