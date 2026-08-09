export type ParkRainLevel =
  | "clear"
  | "sprinkle"
  | "light"
  | "moderate"
  | "heavy"
  | "storm";

export type ParkWeatherPhase =
  | "clear"
  | "gathering"
  | "raining"
  | "tapering"
  | "clearing";

export type ParkWeatherDebugMode =
  | "automatic"
  | "accelerated-cycle"
  | "clear"
  | "gathering"
  | "sprinkle"
  | "light"
  | "moderate"
  | "heavy"
  | "storm"
  | "tapering"
  | "clearing";

export interface ParkWeatherFrame {
  phase: ParkWeatherPhase;
  rainLevel: ParkRainLevel;
  rainAmount: number;
  cloudCover: number;
  seaVisibility: number;
  pondImpact: number;
  grassSplash: number;
  label: string;
  remainingMs: number;
  eventId: string | null;
  isScheduledRainDay: boolean;
  debugMode: ParkWeatherDebugMode;
}

interface ParkRainIntensityKeyframe {
  offsetMs: number;
  amount: number;
}

export interface ParkRainEvent {
  id: string;
  localDayIndex: number;
  dayStartMs: number;
  gatheringStartMs: number;
  rainStartMs: number;
  rainEndMs: number;
  clearingEndMs: number;
  rainDurationMs: number;
  intensityKeyframes: ParkRainIntensityKeyframe[];
}

export interface ParkWeeklyWeatherSchedule {
  weekKey: string;
  weekStartMs: number;
  events: ParkRainEvent[];
}

export interface ParkWeatherRuntime {
  seedKey: string;
  debugMode: ParkWeatherDebugMode;
  debugStartedAtMs: number;
  scheduleCache: Map<string, ParkWeeklyWeatherSchedule>;
}

export const PARK_WEATHER_RAINY_DAYS_PER_WEEK = 2;
export const PARK_WEATHER_MIN_RAIN_DURATION_MS = 10 * 60 * 1000;
export const PARK_WEATHER_MAX_RAIN_DURATION_MS = 6 * 60 * 60 * 1000;
export const PARK_WEATHER_MIN_MODERATE_DURATION_MS = 10 * 60 * 1000;
export const PARK_WEATHER_MIN_HEAVY_DURATION_MS = 10 * 60 * 1000;
export const PARK_WEATHER_MIN_STORM_DURATION_MS = 5 * 60 * 1000;
export const PARK_WEATHER_MIN_CLEAR_GAP_MS = 10 * 60 * 1000;
export const PARK_WEATHER_ACCELERATED_CYCLE_MS = 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const smoothstep = (value: number) => {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
};

const lerp = (left: number, right: number, amount: number) =>
  left + (right - left) * amount;

const hashString = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return hash >>> 0;
};

const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};

const localWeekStart = (nowMs: number) => {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  const daysFromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  return date.getTime();
};

const localDateKey = (nowMs: number) => {
  const date = new Date(nowMs);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

const localDayStart = (nowMs: number) => {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const localDayOffset = (weekStartMs: number, dayIndex: number) => {
  const date = new Date(weekStartMs);
  date.setDate(date.getDate() + dayIndex);
  return date.getTime();
};

const weightedRainDuration = (random: () => number) => {
  const roll = random();
  let minimumMinutes: number;
  let maximumMinutes: number;
  if (roll < 0.4) {
    minimumMinutes = 10;
    maximumMinutes = 60;
  } else if (roll < 0.72) {
    minimumMinutes = 60;
    maximumMinutes = 120;
  } else if (roll < 0.92) {
    minimumMinutes = 120;
    maximumMinutes = 240;
  } else {
    minimumMinutes = 240;
    maximumMinutes = 360;
  }
  const minutes = minimumMinutes + random() * (maximumMinutes - minimumMinutes);
  return Math.max(
    PARK_WEATHER_MIN_RAIN_DURATION_MS,
    Math.min(PARK_WEATHER_MAX_RAIN_DURATION_MS, Math.round(minutes * MINUTE_MS)),
  );
};

const intensityAmount = (level: number) => [0, 0.09, 0.28, 0.52, 0.76, 1][level] ?? 0;

const PARK_WEATHER_MIN_LOW_STAGE_DURATION_MS = 60 * 1000;

const minimumStageDurationMs = (level: number) => {
  if (level === 3) return PARK_WEATHER_MIN_MODERATE_DURATION_MS;
  if (level === 4) return PARK_WEATHER_MIN_HEAVY_DURATION_MS;
  if (level === 5) return PARK_WEATHER_MIN_STORM_DURATION_MS;
  return PARK_WEATHER_MIN_LOW_STAGE_DURATION_MS;
};

const stagePathForPeak = (peakLevel: number) => {
  const ascending = Array.from({ length: peakLevel }, (_, index) => index + 1);
  const descending = Array.from(
    { length: Math.max(0, peakLevel - 1) },
    (_, index) => peakLevel - index - 1,
  );
  return [...ascending, ...descending];
};

const transitionDurationMsForEvent = (rainDurationMs: number) =>
  Math.round(Math.max(45_000, Math.min(150_000, rainDurationMs * 0.025)));

const minimumTimelineDurationMs = (
  peakLevel: number,
  rainDurationMs: number,
) => {
  const path = stagePathForPeak(peakLevel);
  const transitionDurationMs = transitionDurationMsForEvent(rainDurationMs);
  return path.reduce(
    (total, level) => total + minimumStageDurationMs(level),
    transitionDurationMs * (path.length + 1),
  );
};

const eligiblePeakLevel = (
  desiredPeakLevel: number,
  rainDurationMs: number,
) => {
  let peakLevel = Math.max(2, Math.min(5, desiredPeakLevel));
  while (
    peakLevel > 2
    && minimumTimelineDurationMs(peakLevel, rainDurationMs) > rainDurationMs
  ) {
    peakLevel -= 1;
  }
  return peakLevel;
};

const makeIntensityKeyframes = (
  random: () => number,
  rainDurationMs: number,
) => {
  const peakRoll = random();
  const desiredPeakLevel = peakRoll < 0.22 ? 2 : peakRoll < 0.62 ? 3 : peakRoll < 0.88 ? 4 : 5;
  const peakLevel = eligiblePeakLevel(desiredPeakLevel, rainDurationMs);
  const stages = stagePathForPeak(peakLevel);
  const transitionDurationMs = transitionDurationMsForEvent(rainDurationMs);
  const minimumHoldTotalMs = stages.reduce(
    (total, level) => total + minimumStageDurationMs(level),
    0,
  );
  const transitionTotalMs = transitionDurationMs * (stages.length + 1);
  const flexibleDurationMs = Math.max(
    0,
    rainDurationMs - minimumHoldTotalMs - transitionTotalMs,
  );
  const weights = stages.map(() => 0.72 + random() * 0.9);
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);
  const keyframes: ParkRainIntensityKeyframe[] = [{ offsetMs: 0, amount: 0 }];
  let elapsed = 0;

  stages.forEach((level, index) => {
    elapsed += transitionDurationMs;
    keyframes.push({
      offsetMs: Math.round(elapsed),
      amount: intensityAmount(level),
    });
    elapsed += minimumStageDurationMs(level)
      + flexibleDurationMs * (weights[index] ?? 0) / Math.max(0.001, weightTotal);
    keyframes.push({
      offsetMs: Math.round(elapsed),
      amount: intensityAmount(level),
    });
  });

  keyframes.push({ offsetMs: rainDurationMs, amount: 0 });
  return keyframes;
};

const makeRainEvent = (
  seedKey: string,
  weekKey: string,
  weekStartMs: number,
  localDayIndex: number,
) => {
  const random = seededRandom(hashString(`${seedKey}/${weekKey}/day-${localDayIndex}`));
  const dayStartMs = localDayOffset(weekStartMs, localDayIndex);
  const nextDayStartMs = localDayOffset(weekStartMs, localDayIndex + 1);
  const rainDurationMs = weightedRainDuration(random);
  const gatheringDurationMs = Math.round((5 + random() * 15) * MINUTE_MS);
  const clearingDurationMs = Math.round((5 + random() * 25) * MINUTE_MS);
  const earliestGatheringStartMs = dayStartMs + PARK_WEATHER_MIN_CLEAR_GAP_MS;
  const availableStartWindow = Math.max(
    0,
    nextDayStartMs
      - earliestGatheringStartMs
      - rainDurationMs
      - gatheringDurationMs
      - clearingDurationMs,
  );
  const gatheringStartMs = earliestGatheringStartMs
    + Math.round(random() * availableStartWindow);
  const rainStartMs = gatheringStartMs + gatheringDurationMs;
  const rainEndMs = rainStartMs + rainDurationMs;
  const clearingEndMs = Math.min(nextDayStartMs - 1, rainEndMs + clearingDurationMs);
  return {
    id: `${weekKey}/day-${localDayIndex}`,
    localDayIndex,
    dayStartMs,
    gatheringStartMs,
    rainStartMs,
    rainEndMs,
    clearingEndMs,
    rainDurationMs,
    intensityKeyframes: makeIntensityKeyframes(random, rainDurationMs),
  } satisfies ParkRainEvent;
};

export const createParkWeeklyWeatherSchedule = (
  seedKey: string,
  nowMs: number,
): ParkWeeklyWeatherSchedule => {
  const weekStartMs = localWeekStart(nowMs);
  const weekKey = localDateKey(weekStartMs);
  const random = seededRandom(hashString(`${seedKey}/${weekKey}/rain-days`));
  const availableDays = [0, 1, 2, 3, 4, 5, 6];
  const selectedDays: number[] = [];
  while (selectedDays.length < PARK_WEATHER_RAINY_DAYS_PER_WEEK) {
    const selectedIndex = Math.floor(random() * availableDays.length);
    selectedDays.push(availableDays.splice(selectedIndex, 1)[0]!);
  }
  selectedDays.sort((left, right) => left - right);
  return {
    weekKey,
    weekStartMs,
    events: selectedDays.map((dayIndex) =>
      makeRainEvent(seedKey, weekKey, weekStartMs, dayIndex)),
  };
};

const scheduleForTimestamp = (runtime: ParkWeatherRuntime, timestampMs: number) => {
  const weekStartMs = localWeekStart(timestampMs);
  const key = localDateKey(weekStartMs);
  const cached = runtime.scheduleCache.get(key);
  if (cached) return cached;
  const schedule = createParkWeeklyWeatherSchedule(runtime.seedKey, timestampMs);
  runtime.scheduleCache.set(key, schedule);
  return schedule;
};

const rainLevelForAmount = (amount: number): ParkRainLevel => {
  if (amount < 0.035) return "clear";
  if (amount < 0.18) return "sprinkle";
  if (amount < 0.4) return "light";
  if (amount < 0.64) return "moderate";
  if (amount < 0.88) return "heavy";
  return "storm";
};

const labelForWeather = (phase: ParkWeatherPhase, rainLevel: ParkRainLevel) => {
  if (phase === "gathering") return "乌云聚集";
  if (phase === "clearing") return "雨后放晴";
  if (phase === "tapering") return "雨势减弱";
  return {
    clear: "晴天",
    sprinkle: "零星雨滴",
    light: "小雨",
    moderate: "中雨",
    heavy: "大雨",
    storm: "暴雨",
  }[rainLevel];
};

const frameFromValues = (
  phase: ParkWeatherPhase,
  rainAmount: number,
  cloudCover: number,
  remainingMs: number,
  eventId: string | null,
  isScheduledRainDay: boolean,
  debugMode: ParkWeatherDebugMode,
): ParkWeatherFrame => {
  const normalizedRain = clamp01(rainAmount);
  const normalizedCloud = clamp01(cloudCover);
  const rainLevel = rainLevelForAmount(normalizedRain);
  return {
    phase,
    rainLevel,
    rainAmount: normalizedRain,
    cloudCover: normalizedCloud,
    seaVisibility: Math.max(0.18, 1 - normalizedCloud * 0.18 - normalizedRain * 0.64),
    pondImpact: normalizedRain,
    grassSplash: normalizedRain,
    label: labelForWeather(phase, rainLevel),
    remainingMs: Math.max(0, remainingMs),
    eventId,
    isScheduledRainDay,
    debugMode,
  };
};

const intensityAt = (event: ParkRainEvent, nowMs: number) => {
  const elapsed = Math.max(0, Math.min(event.rainDurationMs, nowMs - event.rainStartMs));
  const keyframes = event.intensityKeyframes;
  const rightIndex = Math.max(
    1,
    keyframes.findIndex((keyframe) => elapsed <= keyframe.offsetMs),
  );
  const left = keyframes[rightIndex - 1] ?? keyframes[0]!;
  const right = keyframes[rightIndex] ?? keyframes[keyframes.length - 1]!;
  const span = Math.max(1, right.offsetMs - left.offsetMs);
  return lerp(left.amount, right.amount, smoothstep((elapsed - left.offsetMs) / span));
};

const taperingAt = (event: ParkRainEvent, nowMs: number) => {
  const taperWindowMs = Math.min(24 * MINUTE_MS, event.rainDurationMs * 0.18);
  return nowMs >= event.rainEndMs - taperWindowMs;
};

const automaticWeather = (runtime: ParkWeatherRuntime, nowMs: number) => {
  const schedules = [
    scheduleForTimestamp(runtime, nowMs - 7 * DAY_MS),
    scheduleForTimestamp(runtime, nowMs),
    scheduleForTimestamp(runtime, nowMs + 7 * DAY_MS),
  ];
  const events = schedules
    .flatMap((schedule) => schedule.events)
    .sort((left, right) => left.gatheringStartMs - right.gatheringStartMs);
  const todayStart = localDayStart(nowMs);
  const isScheduledRainDay = events.some((event) => event.dayStartMs === todayStart);
  const active = events.find((event) =>
    nowMs >= event.gatheringStartMs && nowMs < event.clearingEndMs);
  if (!active) {
    const nextEvent = events.find((event) => event.gatheringStartMs > nowMs);
    return frameFromValues(
      "clear",
      0,
      0,
      nextEvent ? nextEvent.gatheringStartMs - nowMs : 0,
      nextEvent?.id ?? null,
      isScheduledRainDay,
      "automatic",
    );
  }
  if (nowMs < active.rainStartMs) {
    const amount = smoothstep(
      (nowMs - active.gatheringStartMs)
      / Math.max(1, active.rainStartMs - active.gatheringStartMs),
    );
    return frameFromValues(
      "gathering",
      0,
      amount * 0.94,
      active.rainStartMs - nowMs,
      active.id,
      true,
      "automatic",
    );
  }
  if (nowMs < active.rainEndMs) {
    const rainAmount = intensityAt(active, nowMs);
    const phase = taperingAt(active, nowMs) ? "tapering" : "raining";
    return frameFromValues(
      phase,
      rainAmount,
      0.9 + rainAmount * 0.1,
      active.rainEndMs - nowMs,
      active.id,
      true,
      "automatic",
    );
  }
  const clearing = 1 - smoothstep(
    (nowMs - active.rainEndMs)
    / Math.max(1, active.clearingEndMs - active.rainEndMs),
  );
  return frameFromValues(
    "clearing",
    0,
    clearing * 0.92,
    active.clearingEndMs - nowMs,
    active.id,
    true,
    "automatic",
  );
};

const STATIC_DEBUG_WEATHER: Record<
  Exclude<ParkWeatherDebugMode, "automatic" | "accelerated-cycle">,
  { phase: ParkWeatherPhase; rainAmount: number; cloudCover: number }
> = {
  clear: { phase: "clear", rainAmount: 0, cloudCover: 0 },
  gathering: { phase: "gathering", rainAmount: 0, cloudCover: 0.88 },
  sprinkle: { phase: "raining", rainAmount: 0.09, cloudCover: 0.9 },
  light: { phase: "raining", rainAmount: 0.28, cloudCover: 0.93 },
  moderate: { phase: "raining", rainAmount: 0.52, cloudCover: 0.96 },
  heavy: { phase: "raining", rainAmount: 0.76, cloudCover: 0.98 },
  storm: { phase: "raining", rainAmount: 1, cloudCover: 1 },
  tapering: { phase: "tapering", rainAmount: 0.24, cloudCover: 0.9 },
  clearing: { phase: "clearing", rainAmount: 0, cloudCover: 0.45 },
};

const ACCELERATED_KEYFRAMES = [
  { atMs: 0, phase: "clear" as ParkWeatherPhase, amount: 0, cloud: 0 },
  { atMs: 3_000, phase: "gathering" as ParkWeatherPhase, amount: 0, cloud: 0.12 },
  { atMs: 10_000, phase: "raining" as ParkWeatherPhase, amount: 0, cloud: 0.94 },
  { atMs: 14_000, phase: "raining" as ParkWeatherPhase, amount: 0.09, cloud: 0.94 },
  { atMs: 20_000, phase: "raining" as ParkWeatherPhase, amount: 0.28, cloud: 0.95 },
  { atMs: 27_000, phase: "raining" as ParkWeatherPhase, amount: 0.52, cloud: 0.97 },
  { atMs: 34_000, phase: "raining" as ParkWeatherPhase, amount: 0.76, cloud: 0.99 },
  { atMs: 42_000, phase: "raining" as ParkWeatherPhase, amount: 1, cloud: 1 },
  { atMs: 48_000, phase: "tapering" as ParkWeatherPhase, amount: 0.76, cloud: 0.98 },
  { atMs: 52_000, phase: "tapering" as ParkWeatherPhase, amount: 0.28, cloud: 0.92 },
  { atMs: 55_000, phase: "tapering" as ParkWeatherPhase, amount: 0.09, cloud: 0.78 },
  { atMs: 58_000, phase: "clearing" as ParkWeatherPhase, amount: 0, cloud: 0.45 },
  { atMs: 60_000, phase: "clear" as ParkWeatherPhase, amount: 0, cloud: 0 },
] as const;

const acceleratedWeather = (runtime: ParkWeatherRuntime, nowMs: number) => {
  const elapsed = ((nowMs - runtime.debugStartedAtMs) % PARK_WEATHER_ACCELERATED_CYCLE_MS
    + PARK_WEATHER_ACCELERATED_CYCLE_MS) % PARK_WEATHER_ACCELERATED_CYCLE_MS;
  const rightIndex = Math.max(
    1,
    ACCELERATED_KEYFRAMES.findIndex((keyframe) => elapsed <= keyframe.atMs),
  );
  const left = ACCELERATED_KEYFRAMES[rightIndex - 1]!;
  const right = ACCELERATED_KEYFRAMES[rightIndex]!;
  const amount = smoothstep((elapsed - left.atMs) / Math.max(1, right.atMs - left.atMs));
  return frameFromValues(
    left.phase,
    lerp(left.amount, right.amount, amount),
    lerp(left.cloud, right.cloud, amount),
    right.atMs - elapsed,
    "debug/accelerated-cycle",
    false,
    "accelerated-cycle",
  );
};

export const createParkWeatherRuntime = (
  seedKey: string,
  nowMs: number,
): ParkWeatherRuntime => ({
  seedKey: seedKey.trim() || "park-preview",
  debugMode: "automatic",
  debugStartedAtMs: nowMs,
  scheduleCache: new Map(),
});

export const setParkWeatherDebugMode = (
  runtime: ParkWeatherRuntime,
  mode: ParkWeatherDebugMode,
  nowMs: number,
) => {
  runtime.debugMode = mode;
  runtime.debugStartedAtMs = nowMs;
};

export const resolveParkWeather = (
  runtime: ParkWeatherRuntime,
  nowMs: number,
): ParkWeatherFrame => {
  if (runtime.debugMode === "automatic") return automaticWeather(runtime, nowMs);
  if (runtime.debugMode === "accelerated-cycle") return acceleratedWeather(runtime, nowMs);
  const preview = STATIC_DEBUG_WEATHER[runtime.debugMode];
  return frameFromValues(
    preview.phase,
    preview.rainAmount,
    preview.cloudCover,
    0,
    `debug/${runtime.debugMode}`,
    false,
    runtime.debugMode,
  );
};

export const CLEAR_PARK_WEATHER_FRAME: ParkWeatherFrame = frameFromValues(
  "clear",
  0,
  0,
  0,
  null,
  false,
  "automatic",
);
