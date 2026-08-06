export const PARK_GLOBAL_SFX_VOLUME_KEY = "aivatar.audioVolume.v1";
export const DEFAULT_PARK_GLOBAL_SFX_VOLUME = 0.45;

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

export const applyParkSfxPerceptualCurve = (rawVolume: number) => {
  const normalized = Number.isFinite(rawVolume) ? clampUnit(rawVolume) : 0;
  return normalized === 0 ? 0 : Math.sqrt(normalized);
};

export const readParkSfxVolume = () => {
  let rawVolume = DEFAULT_PARK_GLOBAL_SFX_VOLUME;
  try {
    const stored = localStorage.getItem(PARK_GLOBAL_SFX_VOLUME_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) rawVolume = clampUnit(parsed);
    }
  } catch {
    // Sandboxed previews can deny localStorage; retain the normal app default.
  }
  return applyParkSfxPerceptualCurve(rawVolume);
};

const parkSfxAudioContextConstructor = () =>
  typeof window === "undefined"
    ? undefined
    : window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

export const createParkSfxAudioContext = () => {
  const AudioContextConstructor = parkSfxAudioContextConstructor();
  if (!AudioContextConstructor) return null;
  try {
    return new AudioContextConstructor({ latencyHint: "interactive" });
  } catch {
    try {
      return new AudioContextConstructor();
    } catch {
      return null;
    }
  }
};
