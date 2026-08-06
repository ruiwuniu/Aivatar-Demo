import type { ParkFishingPose } from "./parkRuntime";
import {
  createParkSfxAudioContext,
  readParkSfxVolume,
} from "./parkSfxVolume";

type ParkFishingSoundPose = Extract<
  ParkFishingPose,
  "cast" | "bite" | "reel" | "display"
>;

export type ParkFishingAudioLoadState =
  | "loading"
  | "ready"
  | "partial"
  | "error"
  | "disposed";

export interface ParkFishingAudioBank {
  context: AudioContext | null;
  buffers: Partial<Record<ParkFishingSoundPose, AudioBuffer>>;
  activeVoices: Map<AudioBufferSourceNode, GainNode>;
  loadPromise: Promise<void> | null;
  abortController: AbortController | null;
  loadState: ParkFishingAudioLoadState;
  loadErrors: Partial<Record<ParkFishingSoundPose, string>>;
  lastError: string | null;
  lastPlayedPose: ParkFishingSoundPose | null;
  pendingPose: ParkFishingSoundPose | null;
  playCount: number;
  disposed: boolean;
}

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

const FISHING_AUDIO_ENTRIES = Object.entries(FISHING_AUDIO_SOURCES) as Array<
  [ParkFishingSoundPose, string]
>;

const isFishingSoundPose = (
  pose: ParkFishingPose,
): pose is ParkFishingSoundPose =>
  pose === "cast" ||
  pose === "bite" ||
  pose === "reel" ||
  pose === "display";

const audioErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const disconnectFishingVoice = (
  bank: ParkFishingAudioBank,
  source: AudioBufferSourceNode,
  gain: GainNode,
) => {
  if (!bank.activeVoices.delete(source)) return;
  source.onended = null;
  source.disconnect();
  gain.disconnect();
};

export const createParkFishingAudioBank = (): ParkFishingAudioBank => {
  const context = createParkSfxAudioContext();
  const abortController = context ? new AbortController() : null;
  const bank: ParkFishingAudioBank = {
    context,
    buffers: {},
    activeVoices: new Map(),
    loadPromise: null,
    abortController,
    loadState: context ? "loading" : "error",
    loadErrors: {},
    lastError: context ? null : "Web Audio is unavailable for park fishing SFX.",
    lastPlayedPose: null,
    pendingPose: null,
    playCount: 0,
    disposed: false,
  };
  if (!context || !abortController) return bank;

  bank.loadPromise = Promise.allSettled(
    FISHING_AUDIO_ENTRIES.map(async ([pose, source]) => {
      const response = await fetch(source, { signal: abortController.signal });
      if (!response.ok) throw new Error(`Could not load park fishing SFX: ${source}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      return { pose, buffer };
    }),
  )
    .then((results) => {
      if (bank.disposed || context.state === "closed") return;
      results.forEach((result, index) => {
        const pose = FISHING_AUDIO_ENTRIES[index][0];
        if (result.status === "fulfilled") {
          bank.buffers[result.value.pose] = result.value.buffer;
          return;
        }
        bank.loadErrors[pose] = audioErrorMessage(result.reason);
      });
      const loadedCount = Object.keys(bank.buffers).length;
      bank.loadState = loadedCount === FISHING_AUDIO_ENTRIES.length
        ? "ready"
        : loadedCount > 0
          ? "partial"
          : "error";
      if (bank.loadState === "ready") {
        bank.lastError = null;
      } else {
        bank.lastError = Object.entries(bank.loadErrors)
          .map(([pose, error]) => `${pose}: ${error}`)
          .join("; ") || "No park fishing SFX could be decoded.";
      }
      flushPendingParkFishingSound(bank);
    })
    .catch((error: unknown) => {
      if (bank.disposed) return;
      bank.loadState = "error";
      bank.lastError = audioErrorMessage(error);
    })
    .finally(() => {
      bank.loadPromise = null;
    });
  return bank;
};

export const resumeParkFishingAudioBank = (
  bank: ParkFishingAudioBank | null,
): Promise<boolean> => {
  const context = bank?.context;
  if (!bank || !context || bank.disposed || context.state === "closed") {
    if (bank && !bank.disposed) bank.lastError = "Park fishing AudioContext is unavailable.";
    return Promise.resolve(false);
  }
  if (context.state === "running") {
    flushPendingParkFishingSound(bank);
    return Promise.resolve(true);
  }

  return context
    .resume()
    .then(() => {
      const running = context.state === "running";
      if (!running) bank.lastError = `Park fishing AudioContext remained ${context.state}.`;
      if (running) flushPendingParkFishingSound(bank);
      return running;
    })
    .catch((error: unknown) => {
      bank.lastError = audioErrorMessage(error);
      return false;
    });
};

const playDecodedParkFishingSound = (
  bank: ParkFishingAudioBank,
  pose: ParkFishingSoundPose,
) => {
  const context = bank.context;
  if (!context || context.state !== "running" || bank.disposed) return;
  const buffer = bank.buffers[pose];
  if (!buffer) {
    bank.lastError = `Park fishing SFX is not decoded: ${pose}.`;
    return;
  }
  const sfxVolume = readParkSfxVolume();
  if (sfxVolume === 0) return;

  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = Math.min(
    1,
    sfxVolume * FISHING_AUDIO_VOLUME_MULTIPLIERS[pose],
  );
  source.connect(gain);
  gain.connect(context.destination);
  source.onended = () => disconnectFishingVoice(bank, source, gain);
  bank.activeVoices.set(source, gain);
  try {
    source.start();
    bank.lastError = null;
    bank.lastPlayedPose = pose;
    bank.playCount += 1;
  } catch (error: unknown) {
    bank.lastError = audioErrorMessage(error);
    disconnectFishingVoice(bank, source, gain);
  }
};

function flushPendingParkFishingSound(bank: ParkFishingAudioBank) {
  const context = bank.context;
  const pose = bank.pendingPose;
  if (
    !context
    || context.state !== "running"
    || bank.disposed
    || !pose
    || !bank.buffers[pose]
  ) return;
  bank.pendingPose = null;
  playDecodedParkFishingSound(bank, pose);
}

export const playParkFishingSound = (
  bank: ParkFishingAudioBank | null,
  pose: ParkFishingPose,
) => {
  if (!bank || bank.disposed || !isFishingSoundPose(pose)) return;
  const context = bank.context;
  if (!context || context.state === "closed") {
    bank.lastError = "Park fishing AudioContext is unavailable.";
    return;
  }
  if (readParkSfxVolume() === 0) return;
  if (context.state !== "running") {
    bank.pendingPose = pose;
    void resumeParkFishingAudioBank(bank);
    return;
  }
  bank.pendingPose = null;
  playDecodedParkFishingSound(bank, pose);
};

export const disposeParkFishingAudioBank = (
  bank: ParkFishingAudioBank | null,
) => {
  if (!bank || bank.disposed) return;
  bank.disposed = true;
  bank.activeVoices.forEach((gain, source) => {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // A source that has already ended needs no further cleanup.
    }
    source.disconnect();
    gain.disconnect();
  });
  bank.activeVoices.clear();
  bank.abortController?.abort();
  bank.abortController = null;
  bank.buffers = {};
  bank.pendingPose = null;
  bank.loadState = "disposed";
  const context = bank.context;
  bank.context = null;
  if (context && context.state !== "closed") {
    void context.close().catch((error: unknown) => {
      bank.lastError = audioErrorMessage(error);
    });
  }
};
