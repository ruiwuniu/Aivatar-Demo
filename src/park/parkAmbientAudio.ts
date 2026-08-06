export interface ParkAmbientAudioController {
  audio: HTMLAudioElement;
  playPending: boolean;
  wantsPlayback: boolean;
}

export const PARK_AMBIENT_AUDIO_VOLUME_KEY = "aivatar.parkAmbientVolume.v1";
export const DEFAULT_PARK_AMBIENT_AUDIO_VOLUME = 0.55;

const PARK_AMBIENT_AUDIO_SOURCE = "/audio/park-sea-cliff-ambience.ogg";

const readParkAmbientAudioVolume = () => {
  const stored = Number.parseFloat(
    localStorage.getItem(PARK_AMBIENT_AUDIO_VOLUME_KEY) ?? "",
  );
  return Number.isFinite(stored)
    ? Math.max(0, Math.min(1, stored))
    : DEFAULT_PARK_AMBIENT_AUDIO_VOLUME;
};

const applyParkAmbientAudioVolume = (
  controller: ParkAmbientAudioController,
) => {
  const parkAmbientVolume = readParkAmbientAudioVolume();
  controller.audio.volume = parkAmbientVolume;
  return parkAmbientVolume;
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
  const parkAmbientVolume = applyParkAmbientAudioVolume(controller);
  if (
    parkAmbientVolume <= 0 ||
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
