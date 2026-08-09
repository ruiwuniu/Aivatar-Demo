import { readParkAmbientAudioVolume } from "./parkAmbientAudio";
import type { ParkWeatherFrame } from "./parkWeather";

const PARK_RAIN_AUDIO_SOURCES = {
  fine: "/audio/weather-samples/rain-layer-fine-candidate.ogg",
  surface: "/audio/weather-samples/rain-layer-surface-candidate.ogg",
  downpour: "/audio/weather-samples/rain-layer-downpour-candidate.ogg",
} as const;

const PARK_THUNDER_AUDIO_SOURCES = {
  distant: "/audio/weather-samples/thunder-distant-candidate.wav",
  medium: "/audio/weather-samples/thunder-medium-candidate.wav",
  near: "/audio/weather-samples/thunder-near-candidate.wav",
} as const;
const PARK_THUNDER_TAIL_GUARD_MS = 7_000;
const PARK_THUNDER_BUSY_RECHECK_MS = 250;

type ParkRainAudioLayer = keyof typeof PARK_RAIN_AUDIO_SOURCES;
type ParkThunderDistance = keyof typeof PARK_THUNDER_AUDIO_SOURCES;

interface ParkLoopAudioVoice {
  audio: HTMLAudioElement;
  playPending: boolean;
}

export interface ParkWeatherAudioController {
  rainVoices: Record<ParkRainAudioLayer, ParkLoopAudioVoice>;
  thunderVoices: Record<ParkThunderDistance, HTMLAudioElement>;
  wantsPlayback: boolean;
  disposed: boolean;
  smoothedRainAmount: number;
  lastUpdateAtMs: number | null;
  stormActive: boolean;
  nextThunderAtMs: number | null;
  thunderBusyUntilMs: number | null;
  lastThunderDistance: ParkThunderDistance | null;
  randomState: number;
}

export interface ParkWeatherAudioTelemetry {
  rainAmount: number;
  fineVolume: number;
  surfaceVolume: number;
  downpourVolume: number;
  nextThunderInMs: number | null;
}

export interface ParkWeatherAudioMix {
  fine: number;
  surface: number;
  downpour: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const smoothRange = (value: number, start: number, end: number) => {
  const progress = clamp01((value - start) / (end - start));
  return progress * progress * (3 - 2 * progress);
};

export const resolveParkWeatherAudioMix = (
  rainAmount: number,
): ParkWeatherAudioMix => {
  const amount = clamp01(rainAmount);
  return {
    fine: smoothRange(amount, 0.015, 0.22) * 0.44,
    surface: smoothRange(amount, 0.08, 0.68) * 0.48,
    downpour: smoothRange(amount, 0.42, 1) * 0.62,
  };
};

const createLoopVoice = (source: string): ParkLoopAudioVoice => {
  const audio = new Audio(source);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0;
  audio.load();
  return { audio, playPending: false };
};

const createThunderVoice = (source: string) => {
  const audio = new Audio(source);
  audio.preload = "auto";
  return audio;
};

const initialRandomState = () => {
  const clock = Date.now() >>> 0;
  const monotonic = typeof performance === "undefined"
    ? 0
    : Math.floor(performance.now() * 1000) >>> 0;
  return (clock ^ monotonic ^ 0x91e1_0da5) >>> 0 || 0x6d2b_79f5;
};

export const createParkWeatherAudio = (): ParkWeatherAudioController => ({
  rainVoices: {
    fine: createLoopVoice(PARK_RAIN_AUDIO_SOURCES.fine),
    surface: createLoopVoice(PARK_RAIN_AUDIO_SOURCES.surface),
    downpour: createLoopVoice(PARK_RAIN_AUDIO_SOURCES.downpour),
  },
  thunderVoices: {
    distant: createThunderVoice(PARK_THUNDER_AUDIO_SOURCES.distant),
    medium: createThunderVoice(PARK_THUNDER_AUDIO_SOURCES.medium),
    near: createThunderVoice(PARK_THUNDER_AUDIO_SOURCES.near),
  },
  wantsPlayback: false,
  disposed: false,
  smoothedRainAmount: 0,
  lastUpdateAtMs: null,
  stormActive: false,
  nextThunderAtMs: null,
  thunderBusyUntilMs: null,
  lastThunderDistance: null,
  randomState: initialRandomState(),
});

const nextRandom = (controller: ParkWeatherAudioController) => {
  let state = controller.randomState || 0x6d2b_79f5;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  controller.randomState = state >>> 0;
  return controller.randomState / 0x1_0000_0000;
};

const visibleDocument = () =>
  typeof document === "undefined" || document.visibilityState !== "hidden";

const pauseRainVoices = (controller: ParkWeatherAudioController) => {
  Object.values(controller.rainVoices).forEach(({ audio }) => audio.pause());
};

const stopThunderVoices = (controller: ParkWeatherAudioController) => {
  Object.values(controller.thunderVoices).forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
  });
  controller.thunderBusyUntilMs = null;
};

const startRainVoice = (voice: ParkLoopAudioVoice) => {
  if (!voice.audio.paused || voice.playPending) return;
  voice.playPending = true;
  void voice.audio
    .play()
    .catch(() => undefined)
    .finally(() => {
      voice.playPending = false;
    });
};

const syncRainPlayback = (controller: ParkWeatherAudioController) => {
  if (
    controller.disposed
    || !controller.wantsPlayback
    || !visibleDocument()
    || readParkAmbientAudioVolume() <= 0
  ) {
    pauseRainVoices(controller);
    return;
  }
  Object.values(controller.rainVoices).forEach(startRainVoice);
};

export const startParkWeatherAudio = (
  controller: ParkWeatherAudioController,
) => {
  if (controller.disposed) return;
  controller.wantsPlayback = true;
  syncRainPlayback(controller);
};

export const pauseParkWeatherAudio = (
  controller: ParkWeatherAudioController,
) => {
  pauseRainVoices(controller);
  stopThunderVoices(controller);
  controller.stormActive = false;
  controller.nextThunderAtMs = null;
};

const thunderIntervalMs = (
  controller: ParkWeatherAudioController,
  debugMode: ParkWeatherFrame["debugMode"],
  firstInStorm: boolean,
) => {
  const random = nextRandom(controller);
  if (debugMode !== "automatic") {
    return firstInStorm
      ? 2000 + random * 2000
      : 10_000 + random * 8000;
  }
  return 18_000 + random * 37_000;
};

const chooseThunderDistance = (
  controller: ParkWeatherAudioController,
): ParkThunderDistance => {
  const choose = () => {
    const random = nextRandom(controller);
    if (random < 0.55) return "distant" as const;
    if (random < 0.87) return "medium" as const;
    return "near" as const;
  };
  const first = choose();
  if (first !== controller.lastThunderDistance) return first;
  return choose();
};

const playThunder = (
  controller: ParkWeatherAudioController,
  ambientVolume: number,
  nowMs: number,
) => {
  const distance = chooseThunderDistance(controller);
  const audio = controller.thunderVoices[distance];
  const distanceGain = {
    distant: 0.42,
    medium: 0.62,
    near: 0.78,
  }[distance];
  Object.values(controller.thunderVoices).forEach((voice) => {
    if (voice === audio) return;
    voice.pause();
    voice.currentTime = 0;
  });
  audio.pause();
  audio.currentTime = 0;
  audio.volume = clamp01(ambientVolume * distanceGain);
  controller.lastThunderDistance = distance;
  controller.thunderBusyUntilMs = nowMs + PARK_THUNDER_TAIL_GUARD_MS;
  void audio.play().catch(() => undefined);
};

const thunderVoicePlaying = (controller: ParkWeatherAudioController) =>
  Object.values(controller.thunderVoices).some((audio) => !audio.paused && !audio.ended);

const updateRainSmoothing = (
  controller: ParkWeatherAudioController,
  target: number,
  nowMs: number,
) => {
  if (controller.lastUpdateAtMs === null) {
    controller.lastUpdateAtMs = nowMs;
    return;
  }
  const elapsedMs = Math.max(0, Math.min(250, nowMs - controller.lastUpdateAtMs));
  controller.lastUpdateAtMs = nowMs;
  const timeConstantMs = target >= controller.smoothedRainAmount ? 2500 : 4000;
  const response = 1 - Math.exp(-elapsedMs / timeConstantMs);
  controller.smoothedRainAmount += (target - controller.smoothedRainAmount) * response;
};

export const updateParkWeatherAudio = (
  controller: ParkWeatherAudioController | null,
  weather: ParkWeatherFrame,
  nowMs: number,
): ParkWeatherAudioTelemetry => {
  if (!controller || controller.disposed) {
    return {
      rainAmount: 0,
      fineVolume: 0,
      surfaceVolume: 0,
      downpourVolume: 0,
      nextThunderInMs: null,
    };
  }

  updateRainSmoothing(controller, clamp01(weather.rainAmount), nowMs);
  const ambientVolume = readParkAmbientAudioVolume();
  if (ambientVolume <= 0) stopThunderVoices(controller);
  const mix = resolveParkWeatherAudioMix(controller.smoothedRainAmount);
  controller.rainVoices.fine.audio.volume = clamp01(ambientVolume * mix.fine);
  controller.rainVoices.surface.audio.volume = clamp01(ambientVolume * mix.surface);
  controller.rainVoices.downpour.audio.volume = clamp01(ambientVolume * mix.downpour);
  syncRainPlayback(controller);

  const stormNow = weather.rainLevel === "storm" && weather.rainAmount >= 0.86;
  if (!stormNow) {
    controller.stormActive = false;
    controller.nextThunderAtMs = null;
  } else if (!controller.stormActive) {
    controller.stormActive = true;
    const availableAtMs = Math.max(
      nowMs,
      controller.thunderBusyUntilMs ?? nowMs,
    );
    controller.nextThunderAtMs = availableAtMs
      + thunderIntervalMs(controller, weather.debugMode, true);
  } else if (
    controller.nextThunderAtMs !== null
    && nowMs >= controller.nextThunderAtMs
    && controller.wantsPlayback
    && visibleDocument()
    && ambientVolume > 0
  ) {
    if (thunderVoicePlaying(controller)) {
      controller.nextThunderAtMs = nowMs + PARK_THUNDER_BUSY_RECHECK_MS;
    } else {
      playThunder(controller, ambientVolume, nowMs);
      controller.nextThunderAtMs = (controller.thunderBusyUntilMs ?? nowMs)
        + thunderIntervalMs(controller, weather.debugMode, false);
    }
  }

  return {
    rainAmount: controller.smoothedRainAmount,
    fineVolume: controller.rainVoices.fine.audio.volume,
    surfaceVolume: controller.rainVoices.surface.audio.volume,
    downpourVolume: controller.rainVoices.downpour.audio.volume,
    nextThunderInMs: controller.nextThunderAtMs === null
      ? null
      : Math.max(0, controller.nextThunderAtMs - nowMs),
  };
};

export const disposeParkWeatherAudio = (
  controller: ParkWeatherAudioController,
) => {
  controller.disposed = true;
  controller.wantsPlayback = false;
  pauseParkWeatherAudio(controller);
  const allAudio = [
    ...Object.values(controller.rainVoices).map(({ audio }) => audio),
    ...Object.values(controller.thunderVoices),
  ];
  allAudio.forEach((audio) => {
    audio.removeAttribute("src");
    audio.load();
  });
};
