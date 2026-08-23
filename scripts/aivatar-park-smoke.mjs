import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const readBinary = (path) => readFile(new URL(path, root));
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const normalizedTrait = (points) =>
  clamp01(Math.log10(Math.max(0, points) + 1) / Math.log10(1_000_001));
const catchProbability = (focus) => 0.2 + normalizedTrait(focus) * 0.6;
const hookStruggleDuration = (randomValue) => 1.4 + clamp01(randomValue) * 1.4;
const biteProbability = (elapsedSeconds) =>
  0.25 * (1 - Math.cos(elapsedSeconds / 20 * Math.PI * 2));
const cookingProbability = (warmth) => 0.1 + normalizedTrait(warmth) * 0.65;
const readingProbability = (focus, curiosity) =>
  0.45 + (normalizedTrait(focus) + normalizedTrait(curiosity)) * 0.15;
const sunPosition = (hour) => {
  const progress = clamp01((hour - 5.6) / 13.7);
  return {
    x: -45 + progress * 1270,
    elevation: Math.max(0, Math.sin(progress * Math.PI)),
  };
};
const smootherstep = (value) => {
  const clamped = clamp01(value);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
};
const foamMotionSample = (nowMs, periodMs, phase, inhaleRatio, amplitudePx) => {
  const cycle = (nowMs / periodMs + phase / (Math.PI * 2)) % 1;
  const riseAndFall = cycle < inhaleRatio
    ? cycle / inhaleRatio
    : (1 - cycle) / (1 - inhaleRatio);
  const breath = smootherstep(riseAndFall);
  const distance = amplitudePx * breath;
  const lower = Math.floor(distance);
  const mix = distance - lower;
  return { breath, lower, upper: lower + 1, mix, centroid: lower + mix };
};
const foamFringeSample = (breath, distanceSteps) => {
  const fringeBreath = smootherstep((breath - 0.28) / 0.72);
  const alpha = fringeBreath * 0.3;
  const distance = distanceSteps + fringeBreath * 0.75;
  const lower = Math.floor(distance);
  const mix = distance - lower;
  return { fringeBreath, alpha, distance, lower, upper: lower + 1, mix };
};
const parkRenderTimesForTimestamps = (timestamps) => {
  const renderIntervalMs = 1000 / 30;
  const deadlineToleranceMs = 1;
  let nextRenderAt = 0;
  const renderedAt = [];
  for (const now of timestamps) {
    if (now + deadlineToleranceMs < nextRenderAt) continue;
    renderedAt.push(now);
    nextRenderAt = now + renderIntervalMs;
  }
  return renderedAt;
};
const parkRenderIntervalsForRafStep = (rafStepMs, rafFrames = 10_000) => {
  const renderedAt = parkRenderTimesForTimestamps(
    Array.from({ length: rafFrames }, (_, frameIndex) =>
      (frameIndex + 1) * rafStepMs
    ),
  );
  const intervals = renderedAt
    .slice(1)
    .map((timestamp, index) => timestamp - renderedAt[index]);
  return intervals.slice(1);
};
const mainRoomLogicStepsForPumps = (timestamps, maxStepsPerPump = 75) => {
  const stepMs = 1000 / 60;
  const maxStoredBacklogMs = 30_000;
  let lastPumpAt = timestamps[0] ?? 0;
  let accumulatorMs = 0;
  let totalSteps = 0;
  for (const now of timestamps.slice(1)) {
    const elapsedMs = Math.max(now - lastPumpAt, 0);
    lastPumpAt = now;
    accumulatorMs = Math.min(maxStoredBacklogMs, accumulatorMs + elapsedMs);
    let pumpSteps = 0;
    while (
      accumulatorMs + 0.001 >= stepMs
      && pumpSteps < maxStepsPerPump
    ) {
      accumulatorMs = Math.max(0, accumulatorMs - stepMs);
      pumpSteps += 1;
      totalSteps += 1;
    }
  }
  return totalSteps;
};
const isGrass = (x, y) => {
  const left = 110 + Math.max(0, y - 235) * 0.055;
  const right = 1080 - Math.max(0, y - 235) * 0.025;
  if (y < 235 || y > 842 || x < left || x > right) return false;
  const pondDx = (x - 1110) / 285;
  const pondDy = (y - 650) / 235;
  return pondDx * pondDx + pondDy * pondDy > 1.08;
};

assert.equal(catchProbability(0), 0.2);
assert.equal(catchProbability(1_000_000), 0.8);
assert.equal(hookStruggleDuration(0), 1.4);
assert.equal(hookStruggleDuration(1), 2.8);
for (const [elapsedSeconds, expected] of [
  [0, 0],
  [5, 0.25],
  [10, 0.5],
  [15, 0.25],
  [20, 0],
]) {
  assert(
    Math.abs(biteProbability(elapsedSeconds) - expected) < 1e-12,
    `bite probability at ${elapsedSeconds}s must be ${expected}`,
  );
}
assert.equal(cookingProbability(0), 0.1);
assert.equal(cookingProbability(1_000_000), 0.75);
assert.equal(readingProbability(0, 0), 0.45);
assert.equal(readingProbability(1_000_000, 1_000_000), 0.75);
assert.equal(isGrass(420, 650), true);
assert.equal(isGrass(1080, 650), false, "pond must remain non-walkable");
assert.equal(isGrass(80, 700), false, "cliff must remain non-walkable");
for (const [x, y] of [[937, 574], [916, 660], [943, 756]]) {
  assert.equal(isGrass(x, y), false, `fishing bobber target ${x},${y} must be off grass`);
}
const morningSun = sunPosition(6.5);
const noonSun = sunPosition(12.2);
const duskSun = sunPosition(18.3);
assert(morningSun.x < noonSun.x && noonSun.x < duskSun.x, "sun must travel left to right");
assert(noonSun.elevation > morningSun.elevation, "noon sun must be higher than morning sun");
assert(noonSun.elevation > duskSun.elevation, "noon sun must be higher than dusk sun");
assert.equal(smootherstep(0), 0);
assert.equal(smootherstep(1), 1);
assert.deepEqual(foamFringeSample(0, 0), {
  fringeBreath: 0,
  alpha: 0,
  distance: 0,
  lower: 0,
  upper: 1,
  mix: 0,
});
const foamFringePeak = foamFringeSample(1, 2.25);
assert.equal(foamFringePeak.alpha, 0.3);
assert.equal(foamFringePeak.distance, 3);
for (const nowMs of [0, 340, 850, 1700, 2550, 3399]) {
  const sample = foamMotionSample(nowMs, 3400, 0, 0.57, 2.25);
  assert.equal(Number.isInteger(sample.lower), true);
  assert.equal(Number.isInteger(sample.upper), true);
  assert(Math.abs((1 - sample.mix) + sample.mix - 1) < 1e-12);
}
let previousFoamCentroid = foamMotionSample(0, 3400, 0, 0.57, 2.25).centroid;
for (let nowMs = 1000 / 60; nowMs <= 3400; nowMs += 1000 / 60) {
  const sample = foamMotionSample(nowMs, 3400, 0, 0.57, 2.25);
  assert(
    Math.abs(sample.centroid - previousFoamCentroid) < 0.05,
    "foam centroid must not jump between integer pixel positions",
  );
  previousFoamCentroid = sample.centroid;
}
const cloudDrawWidth = 630;
const cloudTravelWidth = 760;
const cloudTrackLength = 1180 + cloudTravelWidth + 520;
const cloudBeforeWrapX = cloudTrackLength - 0.001 - cloudTravelWidth - 520 / 2
  + (cloudTravelWidth - cloudDrawWidth) / 2;
const cloudAfterWrapX = -cloudTravelWidth - 520 / 2
  + (cloudTravelWidth - cloudDrawWidth) / 2;
assert(cloudBeforeWrapX > 1180, "cloud must be fully beyond the right edge before wrapping");
assert(cloudAfterWrapX + cloudDrawWidth < 0, "cloud must restart fully beyond the left edge");
const downwardRipplePeriodMs = Math.PI * 2 * 680;
const downwardCrestY = (nowMs) => nowMs / 680 / 0.049;
assert(Math.abs(downwardRipplePeriodMs - 4272.566) < 0.001);
assert(
  downwardCrestY(1000) > downwardCrestY(0),
  "shared pond/grass highlight crest must travel from top to bottom",
);
const smoothFeatherSample = (value) => {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
};
assert.deepEqual(
  [1, 2, 3, 4].map((distance) => Math.round(smoothFeatherSample(distance / 4) * 255)),
  [40, 128, 215, 255],
);
const cliffFogOffsetSample = (nowMs, periodMs, phase, amplitudeX, amplitudeY, index) => {
  const cycle = nowMs / periodMs * Math.PI * 2 + phase;
  return {
    x: -(Math.sin(cycle) * 0.5 + 0.5) * amplitudeX,
    y: Math.sin(cycle * 0.73 + index * 1.37) * amplitudeY,
  };
};
for (const [periodMs, phase, amplitudeX, amplitudeY, index] of [
  [46_000, 0.35, 12, 1.25, 0],
  [58_000, 2.2, 9, 1, 1],
  [52_000, 4.1, 5, 1.5, 2],
]) {
  let previous = cliffFogOffsetSample(0, periodMs, phase, amplitudeX, amplitudeY, index);
  for (let nowMs = 1000 / 60; nowMs <= periodMs; nowMs += 1000 / 60) {
    const current = cliffFogOffsetSample(
      nowMs,
      periodMs,
      phase,
      amplitudeX,
      amplitudeY,
      index,
    );
    assert(current.x <= 1e-9 && current.x >= -amplitudeX - 1e-9);
    assert(Math.abs(current.y) <= amplitudeY + 1e-9);
    assert(Math.hypot(current.x - previous.x, current.y - previous.y) < 0.04);
    previous = current;
  }
}

const [
  configText,
  defaultContentText,
  appText,
  mainText,
  parkText,
  parkCssText,
  parkContentText,
  probabilityText,
  storageText,
  runtimeText,
  rendererText,
  weatherText,
  weatherRendererText,
  pondAtlasText,
  ambientAudioText,
  weatherAudioText,
  canvasSnapshotsText,
  avatarRendererText,
  performanceText,
  fishingAnimationText,
  animationPreviewText,
  layersText,
  cloudAtlasText,
  typesText,
  tauriText,
  tauriConfigText,
  groundImage,
  referenceImage,
  weatherBackdropMaskImage,
  cloudAtlasImage,
  pondAtlasImage,
  blackBassImage,
  crucianCarpImage,
  bluegillImage,
  yellowPerchImage,
  weatherLoachImage,
  rainbowTroutImage,
  fishManifestText,
  fishGeneratorText,
  pondGeneratorText,
  footstepAudioText,
  fishingAudioText,
  parkSfxVolumeText,
  grassStep1Audio,
  grassStep2Audio,
  grassStep3Audio,
  grassStep4Audio,
  fishingCastAudio,
  fishingBiteAudio,
  fishingReelAudio,
  fishingDisplayAudio,
  rainFineAudio,
  rainSurfaceAudio,
  rainDownpourAudio,
  thunderDistantAudio,
  thunderMediumAudio,
  thunderNearAudio,
] = await Promise.all([
  read("public/config/aivatar.config.json"),
  read("src/data/defaultContent.ts"),
  read("src/App.tsx"),
  read("src/main.tsx"),
  read("src/park/ParkApp.tsx"),
  read("src/park/park.css"),
  read("src/park/parkContent.ts"),
  read("src/park/parkProbability.ts"),
  read("src/park/parkStorage.ts"),
  read("src/park/parkRuntime.ts"),
  read("src/park/parkRenderer.ts"),
  read("src/park/parkWeather.ts"),
  read("src/park/parkWeatherRenderer.ts"),
  read("src/park/parkPondAtlas.ts"),
  read("src/park/parkAmbientAudio.ts"),
  read("src/park/parkWeatherAudio.ts"),
  read("src/park/parkCanvasSnapshots.ts"),
  read("src/game/renderScene.ts"),
  read("src/park/parkPerformance.ts"),
  read("src/park/parkFishingAnimation.ts"),
  read("src/park/ParkAnimationPreviewApp.tsx"),
  read("src/park/parkReferenceLayers.ts"),
  read("src/park/parkCloudAtlas.ts"),
  read("src/types.ts"),
  read("src-tauri/src/lib.rs"),
  read("src-tauri/tauri.conf.json"),
  readBinary("public/park/hilltop-park-midday-ground.png"),
  readBinary("public/park/hilltop-park-reference.png"),
  readBinary("public/park/hilltop-park-weather-backdrop-mask.png"),
  readBinary("public/park/cumulonimbus-cloud-time-atlas.png"),
  readBinary("public/park/hilltop-pond-motion-v1.png"),
  readBinary("public/park/fish/raw-black-bass-v1.png"),
  readBinary("public/park/fish/raw-crucian-carp-v1.png"),
  readBinary("public/park/fish/raw-bluegill-v1.png"),
  readBinary("public/park/fish/raw-yellow-perch-v1.png"),
  readBinary("public/park/fish/raw-weather-loach-v1.png"),
  readBinary("public/park/fish/raw-rainbow-trout-v1.png"),
  read("public/park/fish/fish-sprite-manifest.json"),
  read("scripts/generate-park-fish-sprites.py"),
  read("scripts/generate-park-pond-atlas.py"),
  read("src/park/parkFootstepAudio.ts"),
  read("src/park/parkFishingAudio.ts"),
  read("src/park/parkSfxVolume.ts"),
  readBinary("public/audio/park-grass-step-1.wav"),
  readBinary("public/audio/park-grass-step-2.wav"),
  readBinary("public/audio/park-grass-step-3.wav"),
  readBinary("public/audio/park-grass-step-4.wav"),
  readBinary("public/audio/fishing-cast.wav"),
  readBinary("public/audio/fishing-bite.wav"),
  readBinary("public/audio/fishing-reel.wav"),
  readBinary("public/audio/fishing-display.wav"),
  readBinary("public/audio/weather-samples/rain-layer-fine-candidate.ogg"),
  readBinary("public/audio/weather-samples/rain-layer-surface-candidate.ogg"),
  readBinary("public/audio/weather-samples/rain-layer-downpour-candidate.ogg"),
  readBinary("public/audio/weather-samples/thunder-distant-candidate.wav"),
  readBinary("public/audio/weather-samples/thunder-medium-candidate.wav"),
  readBinary("public/audio/weather-samples/thunder-near-candidate.wav"),
]);
const seaLightingText = rendererText.slice(
  rendererText.indexOf("const drawSeaLighting"),
  rendererText.indexOf("const drawShoreFoamBreath"),
);
const weatherSeaHazeText = weatherRendererText.slice(
  weatherRendererText.indexOf("export const drawParkWeatherSeaHaze"),
  weatherRendererText.indexOf("const drawRainField"),
);
const weatherStormCloudText = weatherRendererText.slice(
  weatherRendererText.indexOf("const stormCloudSprite"),
  weatherRendererText.indexOf("export const drawParkWeatherSky"),
);
const weatherSkyText = weatherRendererText.slice(
  weatherRendererText.indexOf("export const drawParkWeatherSky"),
  weatherRendererText.indexOf("export const drawParkWeatherSeaHaze"),
);
const weatherRainFieldText = weatherRendererText.slice(
  weatherRendererText.indexOf("const drawRainField"),
  weatherRendererText.indexOf("export const drawParkRainBack"),
);
const pondSurfaceText = rendererText.slice(
  rendererText.indexOf("const drawPondSurface"),
  rendererText.indexOf("const PARK_SEA_FINE_GLINT_COUNT"),
);
const shoreFoamMotionText = rendererText.slice(
  rendererText.indexOf("const drawShoreFoamBreath"),
  rendererText.indexOf("const drawReferenceObject"),
);
const cliffFogMotionText = rendererText.slice(
  rendererText.indexOf("const drawMovingCliffFog"),
  rendererText.indexOf("const drawTerrainMotion"),
);
const terrainMotionText = rendererText.slice(
  rendererText.indexOf("const drawTerrainMotion"),
  rendererText.indexOf("const objectShadowCaster"),
);
const nativeParkOpenerText = tauriText.slice(
  tauriText.indexOf("async fn open_park_window"),
  tauriText.indexOf("async fn open_park_developer_window"),
);
const nightSkyText = rendererText.slice(
  rendererText.indexOf("type ParkNightStar"),
  rendererText.indexOf("type ParkCloudVariantBlend"),
);
const weatherJavaScript = ts.transpileModule(weatherText, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const weatherModule = await import(
  `data:text/javascript;base64,${Buffer.from(weatherJavaScript).toString("base64")}`
);
const {
  PARK_WEATHER_ACCELERATED_CYCLE_MS,
  PARK_WEATHER_MAX_RAIN_DURATION_MS,
  PARK_WEATHER_MIN_CLEAR_GAP_MS,
  PARK_WEATHER_MIN_HEAVY_DURATION_MS,
  PARK_WEATHER_MIN_MODERATE_DURATION_MS,
  PARK_WEATHER_MIN_RAIN_DURATION_MS,
  PARK_WEATHER_MIN_STORM_DURATION_MS,
  createParkWeeklyWeatherSchedule,
  createParkWeatherRuntime,
  resolveParkWeather,
  setParkWeatherDebugMode,
} = weatherModule;
const weatherSeed = "park-smoke-slot";
const firstWeatherWeek = new Date(2026, 0, 5, 12, 0, 0, 0);
const scheduledEventsForWeatherSmoke = [];
for (let weekIndex = 0; weekIndex < 16; weekIndex += 1) {
  const timestamp = new Date(firstWeatherWeek);
  timestamp.setDate(timestamp.getDate() + weekIndex * 7);
  const schedule = createParkWeeklyWeatherSchedule(weatherSeed, timestamp.getTime());
  const repeatedSchedule = createParkWeeklyWeatherSchedule(weatherSeed, timestamp.getTime());
  assert.deepEqual(schedule, repeatedSchedule, "weekly rain schedule must survive reloads");
  assert.equal(schedule.events.length, 2, "every local week must choose exactly two rain days");
  assert.equal(
    new Set(schedule.events.map((event) => event.localDayIndex)).size,
    2,
    "weekly rainy days must be unique",
  );
  scheduledEventsForWeatherSmoke.push(...schedule.events);
  for (const event of schedule.events) {
    assert(event.rainDurationMs >= PARK_WEATHER_MIN_RAIN_DURATION_MS);
    assert(event.rainDurationMs <= PARK_WEATHER_MAX_RAIN_DURATION_MS);
    assert.equal(event.rainEndMs - event.rainStartMs, event.rainDurationMs);
    const localDay = new Date(event.dayStartMs).toDateString();
    assert.equal(new Date(event.gatheringStartMs).toDateString(), localDay);
    assert.equal(new Date(event.rainStartMs).toDateString(), localDay);
    assert.equal(new Date(event.rainEndMs - 1).toDateString(), localDay);
    assert.equal(new Date(event.clearingEndMs).toDateString(), localDay);
    assert(
      event.gatheringStartMs - event.dayStartMs >= PARK_WEATHER_MIN_CLEAR_GAP_MS,
      "each rainy day must reserve the cross-day clear-weather gap before clouds gather",
    );
    assert(event.gatheringStartMs < event.rainStartMs);
    assert(event.rainStartMs < event.rainEndMs);
    assert(event.rainEndMs < event.clearingEndMs);
  }
}
scheduledEventsForWeatherSmoke.sort(
  (left, right) => left.gatheringStartMs - right.gatheringStartMs,
);
for (let index = 1; index < scheduledEventsForWeatherSmoke.length; index += 1) {
  const previous = scheduledEventsForWeatherSmoke[index - 1];
  const current = scheduledEventsForWeatherSmoke[index];
  assert(
    current.gatheringStartMs - previous.clearingEndMs >= PARK_WEATHER_MIN_CLEAR_GAP_MS,
    "consecutive weather events must retain at least ten clear minutes",
  );
}
const rainLevelForWeatherSmoke = (amount) => {
  if (amount < 0.035) return "clear";
  if (amount < 0.18) return "sprinkle";
  if (amount < 0.4) return "light";
  if (amount < 0.64) return "moderate";
  if (amount < 0.88) return "heavy";
  return "storm";
};
const rainAmountForWeatherSmoke = (event, offsetMs) => {
  const keyframes = event.intensityKeyframes;
  const elapsed = Math.max(0, Math.min(event.rainDurationMs, offsetMs));
  const rightIndex = Math.max(
    1,
    keyframes.findIndex((keyframe) => elapsed <= keyframe.offsetMs),
  );
  const left = keyframes[rightIndex - 1] ?? keyframes[0];
  const right = keyframes[rightIndex] ?? keyframes[keyframes.length - 1];
  const progress = clamp01(
    (elapsed - left.offsetMs) / Math.max(1, right.offsetMs - left.offsetMs),
  );
  const eased = progress * progress * (3 - 2 * progress);
  return left.amount + (right.amount - left.amount) * eased;
};
const minimumWeatherRunMs = new Map([
  ["moderate", PARK_WEATHER_MIN_MODERATE_DURATION_MS],
  ["heavy", PARK_WEATHER_MIN_HEAVY_DURATION_MS],
  ["storm", PARK_WEATHER_MIN_STORM_DURATION_MS],
]);
const validatedWeatherRuns = new Map([
  ["moderate", 0],
  ["heavy", 0],
  ["storm", 0],
]);
for (const event of scheduledEventsForWeatherSmoke) {
  let activeLevel = rainLevelForWeatherSmoke(rainAmountForWeatherSmoke(event, 0));
  let activeRunStartedAtMs = 0;
  const offsets = [];
  for (let offsetMs = 1000; offsetMs < event.rainDurationMs; offsetMs += 1000) {
    offsets.push(offsetMs);
  }
  offsets.push(event.rainDurationMs);
  for (const offsetMs of offsets) {
    const nextLevel = rainLevelForWeatherSmoke(
      rainAmountForWeatherSmoke(event, offsetMs),
    );
    if (nextLevel === activeLevel) continue;
    const minimumDurationMs = minimumWeatherRunMs.get(activeLevel);
    if (minimumDurationMs !== undefined) {
      assert(
        offsetMs - activeRunStartedAtMs >= minimumDurationMs,
        `${activeLevel} rain runs must satisfy their minimum duration`,
      );
      validatedWeatherRuns.set(activeLevel, validatedWeatherRuns.get(activeLevel) + 1);
    }
    activeLevel = nextLevel;
    activeRunStartedAtMs = offsetMs;
  }
}
for (const [level, count] of validatedWeatherRuns) {
  assert(count > 0, `weather schedule smoke must exercise ${level} rain`);
}
const automaticRuntime = createParkWeatherRuntime(weatherSeed, firstWeatherWeek.getTime());
const automaticSchedule = createParkWeeklyWeatherSchedule(
  weatherSeed,
  firstWeatherWeek.getTime(),
);
const automaticEvent = automaticSchedule.events[0];
assert.equal(
  resolveParkWeather(automaticRuntime, automaticEvent.gatheringStartMs - 1).phase,
  "clear",
);
assert.equal(
  resolveParkWeather(
    automaticRuntime,
    Math.round((automaticEvent.gatheringStartMs + automaticEvent.rainStartMs) / 2),
  ).phase,
  "gathering",
);
assert.equal(
  resolveParkWeather(automaticRuntime, automaticEvent.rainStartMs + 1).phase,
  "raining",
);
assert.equal(
  resolveParkWeather(automaticRuntime, automaticEvent.rainEndMs - 1).phase,
  "tapering",
);
assert.equal(
  resolveParkWeather(
    automaticRuntime,
    Math.round((automaticEvent.rainEndMs + automaticEvent.clearingEndMs) / 2),
  ).phase,
  "clearing",
);
assert.equal(
  resolveParkWeather(automaticRuntime, automaticEvent.clearingEndMs).phase,
  "clear",
);
const staticWeatherExpectations = new Map([
  ["clear", ["clear", "clear"]],
  ["gathering", ["gathering", "clear"]],
  ["sprinkle", ["raining", "sprinkle"]],
  ["light", ["raining", "light"]],
  ["moderate", ["raining", "moderate"]],
  ["heavy", ["raining", "heavy"]],
  ["storm", ["raining", "storm"]],
  ["tapering", ["tapering", "light"]],
  ["clearing", ["clearing", "clear"]],
]);
for (const [mode, [expectedPhase, expectedLevel]] of staticWeatherExpectations) {
  const runtime = createParkWeatherRuntime(weatherSeed, 0);
  setParkWeatherDebugMode(runtime, mode, 0);
  const frame = resolveParkWeather(runtime, 1234);
  assert.equal(frame.phase, expectedPhase);
  assert.equal(frame.rainLevel, expectedLevel);
  assert.equal(frame.debugMode, mode);
}
const acceleratedRuntime = createParkWeatherRuntime(weatherSeed, 0);
setParkWeatherDebugMode(acceleratedRuntime, "accelerated-cycle", 0);
for (const [atMs, expectedPhase, expectedLevel] of [
  [0, "clear", "clear"],
  [3001, "gathering", "clear"],
  [14_001, "raining", "sprinkle"],
  [20_001, "raining", "light"],
  [27_001, "raining", "moderate"],
  [34_001, "raining", "heavy"],
  [42_001, "raining", "storm"],
  [48_001, "tapering", "heavy"],
  [58_001, "clearing", "clear"],
  [PARK_WEATHER_ACCELERATED_CYCLE_MS, "clear", "clear"],
]) {
  const frame = resolveParkWeather(acceleratedRuntime, atMs);
  assert.equal(frame.phase, expectedPhase, `accelerated weather phase at ${atMs}ms`);
  assert.equal(frame.rainLevel, expectedLevel, `accelerated rain level at ${atMs}ms`);
}
assert.doesNotMatch(weatherText, /Math\.random\(\)/);
assert.doesNotMatch(weatherRendererText, /Math\.random\(\)/);
assert.match(weatherRendererText, /getParkCloudAtlasStyles\(\)\.slice\(0, 3\)/);
assert.equal(
  weatherStormCloudText.match(/globalCompositeOperation = "source-atop"/g)?.length,
  2,
  "both storm-cloud tint passes must stay inside the cloud alpha silhouette",
);
assert.doesNotMatch(
  weatherStormCloudText,
  /globalCompositeOperation = "screen"/,
  "storm-cloud highlights must not paint a rectangular screen-blend backdrop",
);
assert.match(weatherRendererText, /const PARK_STORM_CLOUD_FADE_RANGES =/);
assert.match(weatherSkyText, /const lanePresence = smoothstepRange\(cover,/);
assert.match(weatherSkyText, /\* lanePresence/);
assert.doesNotMatch(
  weatherSkyText,
  /const laneCount = cover/,
  "storm-cloud lanes must fade continuously instead of switching at cover thresholds",
);
assert.match(weatherRendererText, /const resolveParkRainColor =/);
assert.match(
  weatherRendererText,
  /const nightColor = foreground \? \[112, 135, 158\] : \[88, 108, 132\]/,
);
assert.match(weatherRendererText, /\* \(1 - night \* 0\.25\)/);
assert.match(weatherRendererText, /const PARK_WEATHER_HAZE_TOP_Y = 0/);
assert.match(weatherSeaHazeText, /parkCanvasSnapshotSource\(layers\.weatherBackdropMask\)/);
assert.match(weatherSeaHazeText, /PARK_SCENE_HEIGHT - PARK_WEATHER_HAZE_TOP_Y/);
assert.match(weatherSeaHazeText, /haze\.drawImage\(backdropMask, 0, 0\)/);
assert.doesNotMatch(
  weatherRendererText,
  /PARK_WEATHER_FOREGROUND_CLIFF_POLYGON|PARK_WEATHER_HAZE_MASK_SCALE|mask\.lineTo/,
  "weather haze must use the audited full-resolution raster mask",
);
assert.match(weatherRendererText, /layers\.pondInteriorMask/);
assert.match(weatherRendererText, /layers\.grassRippleMask/);
assert.match(weatherRendererText, /WEATHER_SURFACE_UPDATE_INTERVAL_MS = 1000 \/ 20/);
assert.match(weatherRendererText, /MAX_POND_RIPPLES = 68/);
assert.match(weatherRendererText, /MAX_POND_RIPPLES \* weather\.pondImpact/);
assert.match(weatherRendererText, /MAX_GRASS_SPLASHES = 172/);
assert.match(weatherRendererText, /MAX_GRASS_SPLASHES \* weather\.grassSplash/);
assert.match(weatherRendererText, /const PARK_RAIN_SPRITE_PHASE_COUNT = 25/);
assert.match(weatherRendererText, /const PARK_RAIN_BACK_SEEDS = makeRainParticleSeeds/);
assert.match(weatherRendererText, /const PARK_RAIN_FRONT_SEEDS = makeRainParticleSeeds/);
assert.match(weatherRainFieldText, /const sprite = rainLineSprite\(/);
assert.match(weatherRainFieldText, /ctx\.drawImage\(/);
assert.doesNotMatch(
  weatherRainFieldText,
  /for \(let step = 0; step < length; step \+= 2\)/,
  "per-frame rain drawing must reuse cached line sprites instead of repainting every segment",
);
assert.match(weatherRendererText, /const PARK_GRASS_SPLASH_MIN_X = 109/);
assert.match(weatherRendererText, /const PARK_GRASS_SPLASH_MIN_Y = 225/);
assert.match(weatherRendererText, /const PARK_GRASS_SPLASH_MAX_X = 1075/);
assert.match(weatherRendererText, /const PARK_GRASS_SPLASH_MAX_Y = 842/);
assert.match(
  weatherRendererText,
  /makeCanvas\(PARK_GRASS_SPLASH_WIDTH, PARK_GRASS_SPLASH_HEIGHT\)/,
);
assert.match(
  weatherRendererText,
  /ctx\.drawImage\(grassSplashCanvas, PARK_GRASS_SPLASH_MIN_X, PARK_GRASS_SPLASH_MIN_Y\)/,
);
assert.match(weatherRendererText, /if \(cycle > 0\.55\) continue/);
assert.match(weatherRendererText, /0\.32 \+ weather\.grassSplash \* 0\.58/);
assert.match(weatherRendererText, /rise \* \(3 \+ weather\.grassSplash \* 5\)/);
assert.match(weatherRendererText, /grass\.fillRect\(drawX - 3, drawY, 3, 2\)/);
assert.match(weatherRendererText, /grass\.fillRect\(drawX \+ 2, drawY - 1, 3, 2\)/);
assert.match(weatherRendererText, /weather\.grassSplash > 0\.38/);
assert.match(weatherRendererText, /weather\.seaVisibility/);
assert.match(
  weatherRendererText,
  /const progress = clamp01\(\(amount - 0\.52\) \/ \(0\.76 - 0\.52\)\)/,
);
assert.match(
  weatherRendererText,
  /\{ amount: 0\.52, multiplier: 2 \}/,
);
assert.match(
  weatherRendererText,
  /\{ amount: 0\.76, multiplier: 4 \}/,
);
assert.match(
  weatherRendererText,
  /\{ amount: 1, multiplier: 10 \}/,
);
assert.match(
  weatherRendererText,
  /leftLength \+ \(rightLength - leftLength\) \* eased/,
);
const smoothRainProgressForSmoke = (amount, start, end) => {
  const progress = clamp01((amount - start) / (end - start));
  return progress * progress * (3 - 2 * progress);
};
const rainLengthAnchorsForSmoke = [
  { amount: 0, multiplier: 1 },
  { amount: 0.09, multiplier: 1 },
  { amount: 0.28, multiplier: 1 },
  { amount: 0.52, multiplier: 2 },
  { amount: 0.76, multiplier: 4 },
  { amount: 1, multiplier: 10 },
];
const rainDensityMultiplierForSmoke = (amount) =>
  1 + smoothRainProgressForSmoke(amount, 0.52, 0.76);
const rainLengthForSmoke = (amount, foreground) => {
  const normalizedAmount = clamp01(amount);
  const rightIndex = Math.max(
    1,
    rainLengthAnchorsForSmoke.findIndex((anchor) => normalizedAmount <= anchor.amount),
  );
  const left = rainLengthAnchorsForSmoke[rightIndex - 1];
  const right = rainLengthAnchorsForSmoke[rightIndex];
  const eased = smoothRainProgressForSmoke(normalizedAmount, left.amount, right.amount);
  const baseLengthAt = (anchor) => Math.round(
    (foreground ? 7 : 4) + anchor.amount * (foreground ? 10 : 7),
  ) * anchor.multiplier;
  return Math.round(baseLengthAt(left) + (baseLengthAt(right) - baseLengthAt(left)) * eased);
};
const rainMetricsForSmoke = (amount) => {
  const densityMultiplier = rainDensityMultiplierForSmoke(amount);
  return {
    backDrops: Math.round(280 * amount * densityMultiplier),
    frontDrops: Math.round(170 * amount * densityMultiplier),
    backLength: rainLengthForSmoke(amount, false),
    frontLength: rainLengthForSmoke(amount, true),
  };
};
assert.deepEqual(rainMetricsForSmoke(0.52), {
  backDrops: 146,
  frontDrops: 88,
  backLength: 16,
  frontLength: 24,
});
assert.deepEqual(rainMetricsForSmoke(0.76), {
  backDrops: 426,
  frontDrops: 258,
  backLength: 36,
  frontLength: 60,
});
assert.deepEqual(rainMetricsForSmoke(1), {
  backDrops: 560,
  frontDrops: 340,
  backLength: 110,
  frontLength: 170,
});
const rainSpritePhaseKeyForSmoke = (x) => Math.round(
  (x - Math.floor(x)) * 25 + 1e-12,
);
for (let sample = -5000; sample <= 5000; sample += 1) {
  const x = sample / 1000;
  const phaseKey = rainSpritePhaseKeyForSmoke(x);
  for (let step = 0; step < 170; step += 2) {
    const cachedX = Math.floor(x) + Math.round(phaseKey / 25 + step * 0.34);
    const originalX = Math.round(x + step * 0.34);
    assert.equal(
      Math.abs(cachedX - originalX),
      0,
      `cached rain sprite must preserve segment x at ${x}/${step}`,
    );
  }
}
for (const threshold of [0.09, 0.28, 0.52, 0.76]) {
  const before = rainDensityMultiplierForSmoke(threshold - 1e-7);
  const after = rainDensityMultiplierForSmoke(threshold + 1e-7);
  assert(Math.abs(after - before) < 1e-5, `rain density must be continuous at ${threshold}`);
}
let previousRainMetrics = rainMetricsForSmoke(0);
for (let step = 1; step <= 1000; step += 1) {
  const currentRainMetrics = rainMetricsForSmoke(step / 1000);
  assert(currentRainMetrics.backDrops >= previousRainMetrics.backDrops);
  assert(currentRainMetrics.frontDrops >= previousRainMetrics.frontDrops);
  assert(currentRainMetrics.backLength >= previousRainMetrics.backLength);
  assert(currentRainMetrics.frontLength >= previousRainMetrics.frontLength);
  previousRainMetrics = currentRainMetrics;
}
const layerInterfaceText = layersText.slice(
  layersText.indexOf("export interface ParkReferenceLayers"),
  layersText.indexOf("export interface ParkReferenceShadowCaster"),
);
const config = JSON.parse(configText);
const itemIds = new Set(config.itemDefinitions.map((item) => item.id));
for (const itemId of [
  "fishing-rod",
  "raw-crucian-carp",
  "raw-bluegill",
  "raw-black-bass",
  "raw-yellow-perch",
  "raw-weather-loach",
  "raw-rainbow-trout",
  "cooked-crucian-carp",
  "cooked-bluegill",
  "cooked-black-bass",
  "cooked-yellow-perch",
  "cooked-weather-loach",
  "cooked-rainbow-trout",
  "gas-oven-range",
]) {
  assert(itemIds.has(itemId), `missing ${itemId} definition`);
  assert.match(
    defaultContentText,
    new RegExp(`id: "${itemId}"`),
    `missing ${itemId} fallback definition`,
  );
}
const expectedFishWeights = new Map([
  ["raw-crucian-carp", 26],
  ["raw-bluegill", 22],
  ["raw-black-bass", 18],
  ["raw-yellow-perch", 15],
  ["raw-weather-loach", 11],
  ["raw-rainbow-trout", 8],
]);
const expectedFishSellPrices = new Map([
  ["raw-crucian-carp", 6],
  ["raw-bluegill", 8],
  ["raw-black-bass", 10],
  ["raw-yellow-perch", 12],
  ["raw-weather-loach", 16],
  ["raw-rainbow-trout", 24],
]);
for (const [fishId, weight] of expectedFishWeights) {
  const sellPrice = expectedFishSellPrices.get(fishId);
  assert.match(
    probabilityText,
    new RegExp(`\\{ id: "${fishId}", weight: ${weight} \\}`),
  );
  assert.equal(
    config.itemDefinitions.find((item) => item.id === fishId)?.sellPrice,
    sellPrice,
  );
  assert.match(
    defaultContentText,
    new RegExp(`id: "${fishId}"[\\s\\S]{0,180}sellPrice: ${sellPrice}`),
  );
  assert.match(appText, new RegExp(`"${fishId}"`));
  assert.match(fishingAnimationText, new RegExp(`"${fishId}": "/park/fish/`));
  assert.match(storageText, new RegExp(`"${fishId}":`));
}
assert.match(typesText, /sellPrice\?: number/);
assert.match(appText, /const sellRawFish = \(item: ItemDefinition\)/);
assert.match(appText, /const BITS_EARN_AUDIO_SRC = "\/audio\/card-room-chip-payout\.mp3"/);
assert.match(appText, /const playBitsEarnSound = \(\) =>/);
assert.match(
  appText,
  /const sellRawFish = \(item: ItemDefinition\)[\s\S]*?playBitsEarnSound\(\);[\s\S]*?updateActiveInteraction\(/,
);
assert.match(appText, /selectedRawFishItemId/);
assert.match(appText, /className="inventory-sell-actions"/);
assert.doesNotMatch(appText, /x\{quantity\}[\s\S]{0,80}actionLabel/);
assert.match(typesText, /\| "fish"/);
assert.match(appText, /item\.id\.startsWith\("cooked-"\)[\s\S]{0,80}\? "fish"/);
assert.match(appText, /activeBehavior === "fish"/);
assert.match(avatarRendererText, /const drawCookedFishMeal =/);
assert.match(avatarRendererText, /const drawCookedFishBite =/);
assert.match(avatarRendererText, /const drawFishEatPose =/);
assert.doesNotMatch(avatarRendererText, /interaction\.kind === "feed" && cookedFish/);
const fishRarityOrder = Array.from(expectedFishWeights.keys());
for (let index = 1; index < fishRarityOrder.length; index += 1) {
  const moreCommonFish = fishRarityOrder[index - 1];
  const rarerFish = fishRarityOrder[index];
  assert(expectedFishWeights.get(moreCommonFish) > expectedFishWeights.get(rarerFish));
  assert(expectedFishSellPrices.get(moreCommonFish) < expectedFishSellPrices.get(rarerFish));
}
assert.equal(
  Array.from(expectedFishWeights.values()).reduce((total, weight) => total + weight, 0),
  100,
);
assert.match(probabilityText, /const roll = clamp01\(random\(\)\) \* totalWeight/);
assert.match(probabilityText, /if \(roll < cumulativeWeight\) return fish\.id/);
const weightedFishForRoll = (roll) => {
  let cumulativeWeight = 0;
  for (const [fishId, weight] of expectedFishWeights) {
    cumulativeWeight += weight;
    if (roll < cumulativeWeight) return fishId;
  }
  return "raw-rainbow-trout";
};
assert.deepEqual(
  [0, 25.999, 26, 47.999, 48, 65.999, 66, 80.999, 81, 91.999, 92, 100].map(
    weightedFishForRoll,
  ),
  [
    "raw-crucian-carp",
    "raw-crucian-carp",
    "raw-bluegill",
    "raw-bluegill",
    "raw-black-bass",
    "raw-black-bass",
    "raw-yellow-perch",
    "raw-yellow-perch",
    "raw-weather-loach",
    "raw-weather-loach",
    "raw-rainbow-trout",
    "raw-rainbow-trout",
  ],
);
assert.match(fishingAnimationText, /PARK_FISH_FALLBACK_PALETTES/);
for (const fishLabel of ["蓝鳃太阳鱼", "黄鲈", "泥鳅", "虹鳟"]) {
  assert.match(animationPreviewText, new RegExp(fishLabel));
}
for (const fishClass of [
  "raw-bluegill",
  "raw-yellow-perch",
  "raw-weather-loach",
  "raw-rainbow-trout",
  "cooked-bluegill",
  "cooked-yellow-perch",
  "cooked-weather-loach",
  "cooked-rainbow-trout",
]) {
  assert.match(parkCssText, new RegExp(`item-thumb-${fishClass}`));
}
const fishManifest = JSON.parse(fishManifestText);
assert.deepEqual(fishManifest.canvas, {
  width: 64,
  height: 40,
  format: "PNG",
  colorMode: "RGBA",
  background: "transparent",
  orientation: "head-left",
});
assert.equal(fishManifest.exports.length, 4);
assert.match(fishGeneratorText, /def bluegill_marker/);
assert.match(fishGeneratorText, /def yellow_perch_marker/);
assert.match(fishGeneratorText, /def weather_loach_marker/);
assert.match(fishGeneratorText, /def rainbow_trout_marker/);

assert.match(parkContentText, /export interface ParkFishingSpot/);
assert.match(parkContentText, /export const PARK_BENCH_RELAX_SPOT/);
assert.match(parkContentText, /x: 804/);
assert.match(parkContentText, /y: 332/);
assert.equal(isGrass(804, 332), true, "bench interaction point must stay on grass");
assert.doesNotMatch(
  parkContentText,
  /\{ x: 803, y: 321, radius: 34 \}/,
  "fixed hilltop bench must not block park navigation",
);
for (const fishingSpotId of ["upper-bank", "middle-bank", "lower-bank"]) {
  assert.match(parkContentText, new RegExp(`id: "${fishingSpotId}"`));
}
assert.match(runtimeText, /\| "bite"/);
assert.match(runtimeText, /activity: "bite"/);
assert.match(runtimeText, /activityStartedAt: pose === state\.fishingPose/);
assert.match(runtimeText, /fishingSpotId: spot\.id/);
assert.equal(
  (runtimeText.match(/facing: "front"[\s\S]{0,140}?activityLabel: "Casting/g) ?? []).length,
  2,
  "initial and repeated casts must use the front-facing pose",
);
assert.match(
  runtimeText,
  /activity: "wait"[\s\S]{0,220}?facing: "right"[\s\S]{0,120}?activityLabel: "Fishing"/,
);
assert.match(rendererText, /drawParkFishingAnimation/);
assert.match(parkText, /const calendarNowMs = Date\.now\(\)/);
assert.match(parkText, /nowMs: calendarNowMs,\s*fishingNowMs: now,/);
assert.match(rendererText, /fishingNowMs\?: number/);
assert.match(
  rendererText,
  /const fishingNowMs = options\.fishingNowMs \?\? motionNowMs/,
);
assert.match(
  rendererText,
  /const fishingPoseStartedAt = options\.fishingPoseStartedAt \?\? fishingNowMs/,
);
assert.match(rendererText, /parkFishingClock/);
assert.match(rendererText, /parkFishingElapsedMs/);
assert.match(parkText, /const PARK_TARGET_FPS = 30/);
assert.match(parkText, /const PARK_RENDER_INTERVAL_MS = 1000 \/ PARK_TARGET_FPS/);
assert.match(parkText, /const PARK_RENDER_DEADLINE_TOLERANCE_MS = 1/);
assert.match(parkText, /frame \+= elapsed \* 60/);
assert.match(parkText, /document\.visibilityState !== "hidden"/);
assert.match(
  parkText,
  /now \+ PARK_RENDER_DEADLINE_TOLERANCE_MS >= nextRenderAt/,
);
assert.match(
  parkText,
  /nextRenderAt = now \+ PARK_RENDER_INTERVAL_MS/,
);
assert.doesNotMatch(parkText, /lastRenderAt|renderElapsedMs/);
assert.match(parkText, /measureParkRender\(canvas, now/);
assert.match(parkText, /frame: Math\.floor\(frame\)/);
for (const rafStepMs of [16.666, 8.333]) {
  const renderIntervals = parkRenderIntervalsForRafStep(rafStepMs);
  assert(renderIntervals.length > 100, "render-deadline simulation needs a stable sample");
  assert(
    Math.max(...renderIntervals) < 34.5,
    `${rafStepMs}ms rAF must not create an avoidable 50ms park frame`,
  );
  assert(
    Math.min(...renderIntervals) > 32,
    `${rafStepMs}ms rAF must remain near the 30fps deadline after warm-up`,
  );
}
const longFrameRenderedAt = parkRenderTimesForTimestamps([
  0,
  1000 / 120,
  2000 / 120,
  3000 / 120,
  4000 / 120,
  5000 / 120,
  6000 / 120,
  7000 / 120,
  8000 / 120,
  200,
  200 + 1000 / 120,
  200 + 2000 / 120,
  200 + 3000 / 120,
  200 + 4000 / 120,
]);
assert.deepEqual(
  longFrameRenderedAt.map((value) => Math.round(value * 1000) / 1000),
  [0, 33.333, 66.667, 200, 233.333],
  "a long park frame must render once and rebase without catch-up frames",
);
assert.match(
  rendererText,
  /export type ParkRenderProfile =[\s\S]*\| "base-only"[\s\S]*\| "no-sea-light"/,
);
assert.match(rendererText, /renderProfile\?: ParkRenderProfile/);
assert.match(rendererText, /const renderProfile = options\.renderProfile \?\? "full"/);
assert.match(rendererText, /setParkDataset\(canvas, "parkRenderProfile", renderProfile\)/);
const renderPlanSource = rendererText.match(
  /export const resolveParkRenderPlan = \(renderProfile = "full"\) => \{[\s\S]*?\n\};/,
)?.[0];
assert(renderPlanSource, "render plan resolver must be extractable for behavior checks");
const resolveParkRenderPlanForSmoke = new Function(
  `${renderPlanSource.replace("export const", "const")}\nreturn resolveParkRenderPlan;`,
)();
const fullRenderPlan = {
  dynamicSky: true,
  staticBase: true,
  movingNightSky: true,
  movingClouds: true,
  weatherSky: true,
  weatherEffects: true,
  movingCliffFog: true,
  horizonSeaTint: true,
  dynamicShadows: true,
  terrainMotion: true,
  pondSurface: true,
  sceneActors: true,
  shoreFoam: true,
  timeGrade: true,
  seaLighting: true,
  selection: true,
};
assert.deepEqual(resolveParkRenderPlanForSmoke(), fullRenderPlan);
assert.deepEqual(resolveParkRenderPlanForSmoke("full"), fullRenderPlan);
assert.deepEqual(resolveParkRenderPlanForSmoke("base-only"), {
  dynamicSky: true,
  staticBase: true,
  movingNightSky: false,
  movingClouds: false,
  weatherSky: false,
  weatherEffects: false,
  movingCliffFog: false,
  horizonSeaTint: false,
  dynamicShadows: false,
  terrainMotion: false,
  pondSurface: false,
  sceneActors: false,
  shoreFoam: false,
  timeGrade: false,
  seaLighting: false,
  selection: false,
});
assert.deepEqual(resolveParkRenderPlanForSmoke("no-ambient"), {
  ...fullRenderPlan,
  movingNightSky: false,
  movingClouds: false,
  weatherSky: false,
  weatherEffects: false,
  movingCliffFog: false,
  horizonSeaTint: false,
  terrainMotion: false,
  pondSurface: false,
  shoreFoam: false,
  seaLighting: false,
});
assert.deepEqual(resolveParkRenderPlanForSmoke("no-clouds"), {
  ...fullRenderPlan,
  movingClouds: false,
  weatherSky: false,
});
for (const [profile, effect] of [
  ["no-fog", "movingCliffFog"],
  ["no-grass", "terrainMotion"],
  ["no-pond", "pondSurface"],
  ["no-foam", "shoreFoam"],
  ["no-sea-light", "seaLighting"],
]) {
  assert.deepEqual(resolveParkRenderPlanForSmoke(profile), {
    ...fullRenderPlan,
    [effect]: false,
  });
}
assert.match(rendererText, /if \(!renderPlan\.sceneActors\) return/);
for (const disabledProfile of [
  "no-clouds",
  "no-fog",
  "no-grass",
  "no-pond",
  "no-foam",
  "no-sea-light",
]) {
  assert.match(rendererText, new RegExp(`renderProfile !== "${disabledProfile}"`));
}
const renderSceneSource = rendererText.slice(
  rendererText.indexOf("export const renderParkScene"),
);
let previousRenderCallIndex = -1;
for (const renderCall of [
  "drawDynamicSky(ctx, timeVisual)",
  "drawMovingNightSky(ctx, timeVisual, celestial, motionNowMs)",
  "drawMovingCloudLayer(ctx, timeVisual, motionNowMs)",
  "drawParkWeatherSky(ctx, weather, motionNowMs)",
  "layers.neutralBaseWithoutDistantShoreFoamAndCliffFog",
  "drawMovingCliffFog(ctx, layers, motionNowMs)",
  "drawHorizonSeaTint(ctx, layers, timeVisual)",
  "drawParkWeatherSeaHaze(ctx, layers, weather)",
  "drawDynamicShadows(ctx, options.objects, celestial, timeVisual, weather)",
  "drawTerrainMotion(ctx, layers, motionNowMs)",
  "drawPondSurface(ctx, layers, motionNowMs)",
  "drawParkRainBack(ctx, weather, motionNowMs, timeVisual.nightStrength)",
  "drawParkRainSurfaceEffects(ctx, layers, weather, motionNowMs, {",
  "drawAvatar(",
  "drawShoreFoamBreath(",
  "applyTimeGrade(ctx, timeVisual)",
  "applyParkWeatherGrade(ctx, weather)",
  "drawSeaLighting(ctx, layers, timeVisual, weather, motionNowMs)",
  "drawParkRainForeground(ctx, weather, motionNowMs, timeVisual.nightStrength)",
]) {
  const renderCallIndex = renderSceneSource.indexOf(
    renderCall,
    previousRenderCallIndex + 1,
  );
  assert(renderCallIndex > previousRenderCallIndex, `${renderCall} must preserve full render order`);
  previousRenderCallIndex = renderCallIndex;
}
assert.match(parkText, /const renderProfileRef = useRef<ParkRenderProfile>\("full"\)/);
assert.match(parkText, /renderProfile: renderProfileRef\.current/);
assert.match(parkText, /const mainWindowProfilePendingRef = useRef\(false\)/);
assert.match(parkText, /if \(mainWindowProfilePendingRef\.current\) return/);
assert.match(parkText, /disabled=\{mainWindowProfilePending\}/);
assert.match(parkText, /aria-label="公园渲染剖析"/);
assert.match(parkText, /隐藏主窗口（A\/B）/);
assert.match(
  parkText,
  /let mainWindowVisibilityQueue: Promise<void> = Promise\.resolve\(\)/,
);
assert.match(parkText, /const queueMainWindowVisibility = \(visible: boolean\)/);
assert.match(parkText, /mainWindowHiddenForProfileRef\.current = true/);
assert.match(parkText, /queueMainWindowVisibility\(false\)/);
assert.match(parkText, /void restoreMainWindowAfterPark\(false\);\s*const visit = visitRef\.current/);
assert.match(
  parkText,
  /const handoffMainWindowHideRequestedRef = useRef\(false\)/,
);
assert.match(
  parkText,
  /handoffComplete[\s\S]*!handoffMainWindowHideRequestedRef\.current[\s\S]*queueMainWindowVisibility\(false\)/,
  "the park must hide the main window only after the guest handoff completes",
);
assert(
  parkText.indexOf("queueMainWindowVisibility(false)")
    > parkText.indexOf("const handoffComplete"),
  "the park must not request a main-window hide before observing handoffComplete",
);
assert.match(
  parkText,
  /queueMainWindowVisibility\(true\)[\s\S]*handoffMainWindowHideRequestedRef\.current = false;[\s\S]*mainWindowHiddenForProfileRef\.current = false;/,
  "closing the park must restore the main window and clear handoff ownership",
);
assert.match(
  parkText,
  /!latest \|\| latest\.phase === "cancelled" \|\| latest\.phase === "ended"[\s\S]*await restoreMainWindowAfterPark\(\)[\s\S]*invitationStartedRef\.current = false/,
  "a missing or terminal park visit must restore the main window before allowing another invite",
);
assert.doesNotMatch(
  parkText,
  /invoke\("set_main_window_visibility_for_park_profile", \{ visible: true \}\)/,
  "the desktop park must not force the main room visible while it is rendering",
);
assert.doesNotMatch(
  parkText,
  /localStorage\.(?:getItem|setItem)\([^\n]*parkRenderProfile/,
  "render profiles must remain non-persistent diagnostics",
);
assert.match(
  ambientAudioText,
  /PARK_AMBIENT_AUDIO_VOLUME_KEY = "aivatar\.parkAmbientVolume\.v1"/,
);
assert.match(
  ambientAudioText,
  /DEFAULT_PARK_AMBIENT_AUDIO_VOLUME = 0\.55/,
);
assert.match(
  ambientAudioText,
  /controller\.audio\.volume = parkAmbientVolume \* controller\.weatherGain/,
);
assert.match(ambientAudioText, /return 1 - eased \* 0\.35/);
assert.match(ambientAudioText, /updateParkAmbientAudioWeather/);
assert.doesNotMatch(
  ambientAudioText,
  /aivatar\.audioVolume\.v1|PARK_AMBIENT_AUDIO_VOLUME_MULTIPLIER|globalVolume/,
  "park ambience must not be attenuated by the global SFX setting",
);
for (const source of [
  "rain-layer-fine-candidate.ogg",
  "rain-layer-surface-candidate.ogg",
  "rain-layer-downpour-candidate.ogg",
  "thunder-distant-candidate.wav",
  "thunder-medium-candidate.wav",
  "thunder-near-candidate.wav",
]) {
  assert.match(weatherAudioText, new RegExp(source.replace(".", "\\.")));
}
assert.match(weatherAudioText, /fine: smoothRange\(amount, 0\.015, 0\.22\) \* 0\.44/);
assert.match(weatherAudioText, /surface: smoothRange\(amount, 0\.08, 0\.68\) \* 0\.48/);
assert.match(weatherAudioText, /downpour: smoothRange\(amount, 0\.42, 1\) \* 0\.62/);
assert.match(weatherAudioText, /target >= controller\.smoothedRainAmount \? 2500 : 4000/);
assert.match(weatherAudioText, /audio\.preload = "auto"[\s\S]*audio\.load\(\)/);
assert.match(weatherAudioText, /PARK_THUNDER_TAIL_GUARD_MS = 7_000/);
assert.match(weatherAudioText, /controller\.thunderBusyUntilMs = nowMs \+ PARK_THUNDER_TAIL_GUARD_MS/);
assert.match(weatherAudioText, /!audio\.paused && !audio\.ended/);
assert.match(weatherAudioText, /PARK_THUNDER_BUSY_RECHECK_MS = 250/);
assert.match(
  weatherAudioText,
  /controller\.thunderBusyUntilMs \?\? nowMs\)[\s\S]*thunderIntervalMs\(controller, weather\.debugMode, false\)/,
);
assert.match(weatherAudioText, /18_000 \+ random \* 37_000/);
assert.match(weatherAudioText, /firstInStorm[\s\S]*2000 \+ random \* 2000/);
assert.match(weatherAudioText, /random < 0\.55/);
assert.match(weatherAudioText, /random < 0\.87/);
assert.match(
  weatherAudioText,
  /weather\.rainLevel === "storm" && weather\.rainAmount >= 0\.86/,
);
assert.doesNotMatch(
  weatherAudioText,
  /aivatar\.audioVolume\.v1|PARK_GLOBAL_SFX_VOLUME_KEY/,
  "weather ambience must follow the park ambience volume instead of global SFX",
);
const weatherAudioSmoothRange = (value, start, end) => {
  const progress = clamp01((value - start) / (end - start));
  return progress * progress * (3 - 2 * progress);
};
const weatherAudioMixForSmoke = (amount) => ({
  fine: weatherAudioSmoothRange(amount, 0.015, 0.22) * 0.44,
  surface: weatherAudioSmoothRange(amount, 0.08, 0.68) * 0.48,
  downpour: weatherAudioSmoothRange(amount, 0.42, 1) * 0.62,
});
assert.deepEqual(weatherAudioMixForSmoke(0), { fine: 0, surface: 0, downpour: 0 });
assert.deepEqual(weatherAudioMixForSmoke(1), { fine: 0.44, surface: 0.48, downpour: 0.62 });
let previousWeatherAudioMix = weatherAudioMixForSmoke(0);
for (let step = 1; step <= 1000; step += 1) {
  const currentWeatherAudioMix = weatherAudioMixForSmoke(step / 1000);
  assert(currentWeatherAudioMix.fine >= previousWeatherAudioMix.fine);
  assert(currentWeatherAudioMix.surface >= previousWeatherAudioMix.surface);
  assert(currentWeatherAudioMix.downpour >= previousWeatherAudioMix.downpour);
  previousWeatherAudioMix = currentWeatherAudioMix;
}
assert.match(parkText, /createParkWeatherAudio/);
assert.match(parkText, /startParkWeatherAudio\(weatherAudio\)/);
assert.match(parkText, /pauseParkWeatherAudio\(weatherAudio\)/);
assert.match(parkText, /disposeParkWeatherAudio\(weatherAudio\)/);
assert.match(parkText, /updateParkWeatherAudio\([\s\S]*weatherAudioRef\.current/);
assert.match(parkText, /updateParkAmbientAudioWeather\([\s\S]*ambientAudioRef\.current/);
assert.match(parkText, /parkWeatherAudioThunderInMs/);
assert.match(appText, /const loadInitialParkAmbientAudioVolume/);
assert.match(appText, /const \[parkAmbientAudioVolume, setParkAmbientAudioVolume\]/);
assert.match(appText, /localStorage\.setItem\(\s*PARK_AMBIENT_AUDIO_VOLUME_KEY/);
assert.match(appText, /parkAmbientVolumeLabel/);
assert.match(appText, /setParkAmbientAudioVolume\(Number\(event\.target\.value\) \/ 100\)/);
assert.match(appText, /const SHOW_DEBUG_CARD = false/);
assert.match(appText, /\{SHOW_DEBUG_CARD \? \(/);
assert.match(parkText, /const SHOW_PARK_DEBUG = false/);
assert.match(parkText, /\{SHOW_PARK_DEBUG \? \(/);
const tauriConfig = JSON.parse(tauriConfigText);
assert.equal(
  tauriConfig.app.windows.find((windowConfig) => windowConfig.label === "main")
    ?.backgroundThrottling,
  "throttle",
  "the main WebView must remain timer-throttled instead of fully suspended when occluded",
);
assert.match(tauriText, /fn set_main_window_visibility_for_park_profile/);
assert.match(tauriText, /get_webview_window\("main"\)/);
assert.match(tauriText, /fn attach_main_window_restore_handler/);
assert.match(tauriText, /fn set_main_window_visibility_for_park_owner/);
assert.match(tauriText, /WindowEvent::CloseRequested \{ \.\. \} \| tauri::WindowEvent::Destroyed/);
assert.match(tauriText, /struct ParkProfileWindowState/);
assert.match(tauriText, /hidden_by: Mutex<Option<String>>/);
assert.match(
  tauriText,
  /hidden_by\.as_ref\(\)\.is_some_and\(\|owner\| owner != owner_label\)[\s\S]*Another park window owns/,
);
assert.match(tauriText, /!visible && app\.get_webview_window\(owner_label\)\.is_none\(\)/);
assert.match(tauriText, /\.manage\(ParkProfileWindowState::default\(\)\)/);
assert.match(tauriText, /\.focused\(false\)\s*\.visible\(false\)/);
assert.match(tauriText, /attach_main_window_restore_handler\(window\.clone\(\), app\.clone\(\)\)/);
assert.match(
  nativeParkOpenerText,
  /window\.show\(\)\.and_then\(\|_\| window\.set_focus\(\)\)/,
  "the native park opener must reveal the park without waiting for a main-window hide",
);
assert.doesNotMatch(
  nativeParkOpenerText,
  /set_main_window_visibility_for_park_owner\(&app, &label, (?:false|true)\)/,
  "native park open must leave the main room running until the React handoff completes",
);
assert.match(tauriText, /set_main_window_visibility_for_park_profile,\s*open_save_slot_window/);
assert.match(canvasSnapshotsText, /const snapshotStateByCanvas = new WeakMap/);
assert.match(canvasSnapshotsText, /typeof createImageBitmap !== "function"/);
assert.match(canvasSnapshotsText, /state\.pending \|\| state\.disabled \|\| state\.bitmap/);
assert.match(canvasSnapshotsText, /return state\.bitmap \?\? canvas/);
assert.match(rendererText, /parkCanvasSnapshotSource/);
assert.doesNotMatch(rendererText, /invalidateParkCanvasSnapshot/);
assert.match(rendererText, /ctx\.drawImage\(horizonTintCanvas, 0, 0\)/);
assert.match(rendererText, /ctx\.drawImage\(\s*sprite,/);
assert.match(rendererText, /ctx\.drawImage\(waterLightCanvas, 0, 0\)/);
assert.doesNotMatch(
  rendererText,
  /pondSurfaceCanvas|pondTextureCanvas|pondCompositeCanvas/,
  "the pond must not allocate dynamic runtime canvases",
);
const mainRoomAdvanceLogicText = appText.slice(
  appText.indexOf("const advanceLogic ="),
  appText.indexOf("const pumpLogic ="),
);
const mainRoomRenderText = appText.slice(
  appText.indexOf("const renderCurrentScene ="),
  appText.indexOf("let animation = 0", appText.indexOf("const renderCurrentScene =")),
);
assert.match(appText, /const awayRoomFrameRenderedRef = useRef\(false\)/);
assert.match(appText, /const logicStepMs = 1000 \/ 60/);
assert.match(appText, /const maxStoredLogicBacklogMs = 30_000/);
assert.match(appText, /const maxBackgroundLogicStepsPerPump = Math\.ceil\(1250 \/ logicStepMs\)/);
assert.match(appText, /const maxForegroundLogicStepsPerPump = 4/);
assert.match(appText, /const staleAnimationFrameThresholdMs = 100/);
assert.match(appText, /const pumpLogic = \(now: number, maxSteps: number\)/);
assert.match(appText, /logicAccumulatorMs \+ 0\.001 >= logicStepMs/);
assert.match(appText, /advanceLogic\(logicalNow, logicStepSeconds\)/);
assert.match(appText, /const logicTimer = window\.setInterval/);
assert.match(appText, /if \(now - lastAnimationFrameAt < staleAnimationFrameThresholdMs\) return/);
assert.match(appText, /pumpLogic\(now, maxBackgroundLogicStepsPerPump\)/);
assert.match(appText, /pumpLogic\(now, maxForegroundLogicStepsPerPump\)/);
assert.match(appText, /animation = window\.requestAnimationFrame\(renderLoop\)/);
assert.match(appText, /window\.clearInterval\(logicTimer\)/);
assert.match(appText, /window\.cancelAnimationFrame\(animation\)/);
assert.match(
  mainRoomAdvanceLogicText,
  /if \(avatarAwayRef\.current\) \{\s*syncUiMirror\(\);\s*return;/,
  "background logic must stop home-room actions once the park owns the avatar",
);
assert.doesNotMatch(
  mainRoomAdvanceLogicText,
  /renderScene\(/,
  "logic fallback must never paint an occluded WebView",
);
assert.equal(
  (mainRoomRenderText.match(/renderScene\(/g) ?? []).length,
  1,
  "the rAF render path must own the only continuous main-room paint",
);
assert.match(mainRoomRenderText, /if \(avatarIsAway && awayRoomFrameRenderedRef\.current\) return/);
assert.match(mainRoomRenderText, /awayRoomFrameRenderedRef\.current = avatarIsAway/);
assert.match(
  appText,
  /if \(avatarAway && awayRoomFrameRenderedRef\.current\) return;/,
);
assert.equal(
  mainRoomLogicStepsForPumps(
    Array.from({ length: 61 }, (_, index) => index * (1000 / 60)),
  ),
  60,
  "visible 60Hz pumps must advance exactly 60 one-sixtieth logic steps per second",
);
assert.equal(
  mainRoomLogicStepsForPumps([0, 1000, 2000]),
  120,
  "a timer throttled to 1Hz must still compensate the full elapsed movement",
);
assert.equal(
  mainRoomLogicStepsForPumps([0, 5000]),
  75,
  "one background wake must cap catch-up work at the approved 1.25 seconds",
);
assert.equal(
  mainRoomLogicStepsForPumps([0, 5000, 5000, 5000, 5000]),
  300,
  "unprocessed catch-up time must remain queued instead of being permanently discarded",
);
assert.equal(
  mainRoomLogicStepsForPumps(
    [0, 5000, ...Array.from({ length: 74 }, () => 5000)],
    4,
  ),
  300,
  "rAF recovery must drain a five-second backlog gradually without losing logical time",
);
assert.match(performanceText, /const PARK_PERFORMANCE_WINDOW = 180/);
assert.match(performanceText, /const performanceStateByCanvas = new WeakMap/);
assert.match(performanceText, /parkPerfAverageRenderMs/);
assert.match(performanceText, /parkPerfP95RenderMs/);
assert.match(performanceText, /parkPerfRenderFps/);
assert.match(performanceText, /parkPerfOver33ms/);
assert.match(
  rendererText,
  /nowMs: fishingNowMs,\s*poseStartedAt: fishingPoseStartedAt/,
);
assert.doesNotMatch(
  rendererText,
  /nowMs: motionNowMs,\s*poseStartedAt: options\.fishingPoseStartedAt/,
);
assert.match(rendererText, /fishingPoseStartedAt/);
assert.match(rendererText, /fishingSpot\?: ParkFishingSpot/);
assert.match(fishingAnimationText, /const FISHING_HAND_ANCHORS/);
assert.match(fishingAnimationText, /frontX: number/);
assert.match(fishingAnimationText, /frontY: number/);
assert.match(fishingAnimationText, /const frontFacing = avatar\.facing === "front"/);
assert.match(
  fishingAnimationText,
  /frontFacing \? anchor\.frontX : anchor\.x \* side/,
);
assert.match(fishingAnimationText, /const frontFacing = facing === "front"/);
assert.match(fishingAnimationText, /x: hand\.x - 25, y: hand\.y - 59/);
assert.match(fishingAnimationText, /x: hand\.x \+ 72, y: hand\.y - 27/);
assert.match(
  fishingAnimationText,
  /resolveRodTip\(hand, pose, poseElapsedMs, avatar\.facing\)/,
);
assert.match(fishingAnimationText, /handAnchorCount: Object\.keys\(FISHING_HAND_ANCHORS\)\.length/);
assert.match(fishingAnimationText, /frontCastSupported: true/);
assert.match(
  fishingAnimationText,
  /"cute-crayfish": \{ x: 16, y: -18, frontX: 10, frontY: -18, followsBodyBob: true \}/,
  "the crayfish side and front rod anchors must stay in front of its chest",
);
assert.doesNotMatch(fishingAnimationText, /drawCrayfishRodGrip/);
assert.match(
  fishingAnimationText,
  /export const resolveParkFishingGrip/,
  "the fishing layer must expose one shared rod grip for the avatar claw",
);
assert.match(fishingAnimationText, /crayfishUsesAvatarClaw: true/);
assert.match(avatarRendererText, /heldPropGrip\?: AvatarHeldPropGrip/);
assert.match(avatarRendererText, /heldPropOverlayOnly\?: boolean/);
assert.match(avatarRendererText, /if \(heldPropGrip\) \{/);
assert.match(avatarRendererText, /clawRotation: grip\.angle/);
assert.match(avatarRendererText, /const supportGripDistance = 10/);
assert.match(avatarRendererText, /const supportClaw = fishingClawPose/);
assert.match(avatarRendererText, /return \[supportClaw, leadClaw\]/);
assert.match(avatarRendererText, /const drawPenguinFishingFlippers = \(leadGrip: AvatarHeldPropGrip\)/);
assert.match(avatarRendererText, /const supportGrip: AvatarHeldPropGrip = \{/);
assert.match(
  avatarRendererText,
  /if \(isSide\) \{\s*drawGripFlipper\(x \+ sideDirection, y - 17, leadGrip, sideDirection\);\s*return;\s*\}/,
  "a side-facing penguin must root its only visible grip flipper at the chest color boundary",
);
assert.match(
  avatarRendererText,
  /drawGripFlipper\(x - 13, y - 15, supportGrip, -1\);\s*drawGripFlipper\(x \+ 13, y - 15, leadGrip, 1\);/,
  "a front-facing penguin must root both grip flippers at the belly color boundaries",
);
assert.match(
  avatarRendererText,
  /if \(heldPropOverlayOnly\) \{\s*if \(heldPropGrip\) drawPenguinFishingFlippers\(heldPropGrip\);\s*return;\s*\}/,
  "the penguin grip must support a dedicated foreground overlay pass",
);
assert.match(
  avatarRendererText,
  /drawCutePenguinAvatar\([\s\S]*?options\.heldPropGrip/,
  "the penguin renderer must receive the shared fishing grip",
);
assert.match(
  fishingAnimationText,
  /appearanceId === "cute-crayfish" \? 20 : 13/,
  "the crayfish rod handle must provide room for both native claws",
);
assert.match(
  rendererText,
  /const fishingGripAppearanceId =\s*options\.avatarAppearanceId === "cute-crayfish" \|\|\s*options\.avatarAppearanceId === "cute-penguin"/,
  "crayfish claws and penguin flippers must share the animated fishing grip",
);
assert.match(rendererText, /if \(crayfishFishingGrip\) drawFishing\(\);/);
assert.match(rendererText, /\{ heldPropGrip: avatarFishingGrip \}/);
assert.match(
  rendererText,
  /if \(penguinFishingGrip\) \{\s*drawFishing\(\);[\s\S]*?heldPropOverlayOnly: true/,
  "the park must draw the penguin body, then rod, then foreground gripping flipper overlay",
);
assert.match(rendererText, /else if \(!crayfishFishingGrip\) \{\s*drawFishing\(\);/);
assert.match(
  animationPreviewText,
  /appearanceId === "cute-crayfish" \|\| appearanceId === "cute-penguin"/,
  "the animation preview must expose the same penguin fishing grip as the main park",
);
assert.match(animationPreviewText, /if \(crayfishFishingGrip\) drawFishing\(\);/);
assert.match(animationPreviewText, /\{ heldPropGrip: avatarFishingGrip \}/);
assert.match(
  animationPreviewText,
  /if \(penguinFishingGrip\) \{\s*drawFishing\(\);[\s\S]*?heldPropOverlayOnly: true/,
  "the action preview must use the same penguin body, rod, and foreground flipper ordering",
);
assert.match(animationPreviewText, /else if \(!crayfishFishingGrip\) \{\s*drawFishing\(\);/);
assert.match(animationPreviewText, /resolveParkFishingGrip/);
assert.match(animationPreviewText, /\{ heldPropGrip: crayfishGrip \}/);
assert.match(fishingAnimationText, /quadraticCurveTo\(control\.x, control\.y, tip\.x, tip\.y\)/);
assert.match(fishingAnimationText, /const drawPixelRipple/);
assert.match(fishingAnimationText, /const drawSplash/);
assert.match(fishingAnimationText, /const drawBobber/);
assert.match(fishingAnimationText, /const HOOK_SHAKE_CYCLE_MS = 420/);
assert.match(fishingAnimationText, /const resolveHookStruggle/);
assert.match(fishingAnimationText, /irregularWave/);
assert.match(fishingAnimationText, /drawPixelRipple\(ctx, \{ x, y: center\.y \}, nowMs \* 1\.45, 1\.08\)/);
assert.match(fishingAnimationText, /PARK_FISH_SPRITE_ASSETS/);
assert.match(fishingAnimationText, /drawProceduralFishFallback/);
assert.match(fishingAnimationText, /Math\.round\(Math\.sin\(frame \/ 6\)\)/);
assert.match(fishingAnimationText, /export const resolveParkFishingVisualAvatar/);
assert.match(fishingAnimationText, /avatar\.x - waterDirection \* Math\.round\(pull \* 7\)/);
assert.match(fishingAnimationText, /const REEL_FISH_EXIT_PROGRESS = 0\.34/);
assert.match(fishingAnimationText, /const resolveReelFishFlight/);
assert.match(fishingAnimationText, /point\.y -= Math\.sin\(flight \* Math\.PI\) \* 76/);
assert.match(fishingAnimationText, /\{ x: avatarX, y: avatarY - 55 \}/);
assert.match(fishingAnimationText, /drawFish\(ctx, fishId, reelFish\.point\.x, reelFish\.point\.y, frame\)/);
assert.match(fishingAnimationText, /showBobber = flight > 0\.84/);
assert.match(fishingAnimationText, /showBobber = reelProgress < REEL_FISH_EXIT_PROGRESS/);
assert.match(rendererText, /resolveParkFishingVisualAvatar/);
assert.match(animationPreviewText, /fishingPose === "display" \|\| fishingPose === "reel"/);
assert.match(animationPreviewText, /previewFishingRecoilX/);
assert.match(animationPreviewText, /bite: 3200/);
assert.match(animationPreviewText, /全部基础动作/);
assert.match(animationPreviewText, /\{ id: "read_book", label: "长椅读书" \}/);
assert.match(animationPreviewText, /activeBehavior === "read_book"/);
assert.match(animationPreviewText, /钓鱼动作/);
assert.match(animationPreviewText, /drawParkFishingAnimation/);
assert.match(animationPreviewText, /fishingPose === "cast"\s*\? facing/);
assert.match(animationPreviewText, /if \(pose === "cast"\) setFacing\("front"\)/);
assert.match(
  animationPreviewText,
  /if \(fishingPose !== "cast"\) setFishingPose\("none"\)/,
);
assert.match(animationPreviewText, /previewFishingFacing = activeFacing/);
assert.match(animationPreviewText, /重新播放/);
assert.match(animationPreviewText, /DISPLAY_FISH_OPTIONS/);
assert.match(animationPreviewText, /previewFishId/);
assert.match(animationPreviewText, /展示鱼种/);
assert.match(mainText, /view === "park-animation-preview"/);
assert.match(parkText, /open_park_animation_preview_window/);
assert.match(parkText, /打开角色动作预览/);
assert.match(tauriText, /open_park_animation_preview_window/);
assert.match(tauriText, /\.inner_size\(760\.0, 600\.0\)/);

assert.match(typesText, /"room-visit" \| "card-room" \| "park"/);
assert.match(typesText, /\| "read_book"/);
assert.match(parkText, /guestRuntimeRoomInstanceId === instanceIdRef\.current/);
assert.match(parkText, /simulationRef\.current = null/);
assert.match(parkText, /label: "实时", hour: null/);
assert.match(parkText, /label: "朝霞 06:30", hour: 6\.5/);
assert.match(parkText, /label: "中午 12:00", hour: 12/);
assert.match(parkText, /label: "晚霞 18:18", hour: 18\.3/);
assert.match(parkText, /label: "夜晚 22:30", hour: 22\.5/);
assert.match(parkText, /url\.searchParams\.delete\("parkHour"\)/);
assert.match(parkText, /url\.searchParams\.set\("parkHour", String\(hour\)\)/);
assert.match(parkText, /aria-label="公园时间预览"/);
assert.match(parkText, /aria-label="公园天气预览"/);
for (const weatherPreviewLabel of [
  "自动天气",
  "晴天",
  "乌云聚集",
  "零星雨滴",
  "小雨",
  "中雨",
  "大雨",
  "暴雨",
  "雨势减弱",
  "雨后放晴",
  "60 秒完整雨程",
]) {
  assert.match(parkText, new RegExp(weatherPreviewLabel));
}
assert.match(parkText, /createParkWeatherRuntime/);
assert.match(parkText, /resolveParkWeather/);
assert.match(parkText, /setParkWeatherDebugMode/);
assert.match(parkText, /weather,\s*\}\);/);
assert.doesNotMatch(
  parkText,
  /localStorage\.(?:getItem|setItem)\([^\n]*WeatherDebugMode/,
  "manual weather previews must not persist",
);
assert.match(parkText, /aria-label="公园角色预览"/);
assert.match(parkText, /强制召唤角色/);
assert.match(parkText, /强制钓鱼（临时钓竿）/);
assert.match(parkText, /强制长椅放松/);
assert.match(parkText, /强制长椅读书/);
assert.match(parkText, /benchPose: activeSimulation\?\.benchPose/);
assert.match(parkText, /debugRodRef\.current \|\| hasFishingRod\(currentSave\)/);
assert.match(parkText, /if \(!debugPreviewActive && visit\)/);
assert.match(parkText, /Debug 行为不会写入存档/);
assert.match(parkCssText, /\.park-debug \{/);
assert.match(parkCssText, /left: 14px;/);
assert.match(parkCssText, /bottom: 14px;/);
assert.match(runtimeText, /export const forceParkFishingPreview/);
assert.match(runtimeText, /export const forceParkBenchPreview/);
assert.match(runtimeText, /"to-fishing"/);
for (const benchActivity of ["to-bench", "bench-relax", "bench-read"]) {
  assert.match(runtimeText, new RegExp(`"${benchActivity}"`));
}
assert.match(runtimeText, /const fishingChance = options\.hasRod \? 0\.38 : 0/);
assert.match(runtimeText, /const benchChance = options\.hasRod \? 0\.27 : 0\.32/);
assert.match(runtimeText, /shouldChooseParkReading/);
assert.match(runtimeText, /behavior: reading \? "read_book" : "relax"/);
assert.match(runtimeText, /const benchTargetReachable/);
assert.match(runtimeText, /\? \[\.\.\.gridPath, target\]\.filter/);
assert.match(probabilityText, /export const parkReadingProbability/);
assert.match(probabilityText, /export const shouldChooseParkReading/);
assert.match(runtimeText, /canLandFishingCatch/);
assert.match(probabilityText, /export const fishingHookStruggleDurationSeconds/);
assert.match(probabilityText, /1\.4 \+ clamp01\(random\(\)\) \* 1\.4/);
assert.match(probabilityText, /export const FISHING_BITE_WAVE_PERIOD_SECONDS = 20/);
assert.match(probabilityText, /export const fishingBiteProbability/);
assert.match(probabilityText, /return 0\.25 \* \(1 - Math\.cos\(phase\)\)/);
assert.match(probabilityText, /export const shouldFishBite/);
assert.match(runtimeText, /fishingStartedAt: number/);
assert.match(runtimeText, /fishingStartedAt: now/);
assert.match(runtimeText, /shouldFishBite\(elapsedFishingSeconds, random\)/);
assert.match(runtimeText, /activityLabel: "Waiting for a bite"/);
assert.match(runtimeText, /activityEndsAt: now \+ fishingHookStruggleDurationSeconds\(random\) \* 1000/);
assert.match(
  runtimeText,
  /if \(state\.activity === "bite"[\s\S]*if \(canLandFishingCatch\(options\.traits\.focus, random\)\)/,
);
assert.match(runtimeText, /activityLabel: "The fish slipped off the hook"/);
assert.match(runtimeText, /fishingSessionDurationSeconds/);
assert.match(runtimeText, /PARK_REFERENCE_COLLIDERS/);
assert.match(avatarRendererText, /const drawReadingBookSprite/);
assert.match(avatarRendererText, /const openingLinear = Math\.max/);
assert.match(avatarRendererText, /const coverLeft = "#8b4d2b"/);
assert.match(avatarRendererText, /const coverRight = "#744026"/);
assert.match(avatarRendererText, /const pageEdge = "#f5e5b8"/);
assert.match(avatarRendererText, /The pages face the character/);
assert.match(avatarRendererText, /Page turns happen on the character-facing side/);
assert.doesNotMatch(avatarRendererText, /const pageX = Math\.round/);
assert.doesNotMatch(avatarRendererText, /const pageLift = Math\.round/);
assert.match(avatarRendererText, /avatar\.behavior === "read_book"/);
assert.match(rendererText, /const visualAvatar = options\.avatar/);
assert.doesNotMatch(rendererText, /PARK_BENCH_RELAX_SPOT\.visualX/);
assert.doesNotMatch(rendererText, /drawFixedBenchFront/);
for (const grassStepAudio of [
  grassStep1Audio,
  grassStep2Audio,
  grassStep3Audio,
  grassStep4Audio,
]) {
  assert.equal(grassStepAudio.subarray(0, 4).toString("ascii"), "RIFF");
  assert(grassStepAudio.length > 40_000, "grass footstep must contain a full one-shot");
}
for (const fishingAudio of [
  fishingCastAudio,
  fishingBiteAudio,
  fishingReelAudio,
  fishingDisplayAudio,
]) {
  assert.equal(fishingAudio.subarray(0, 4).toString("ascii"), "RIFF");
  assert(fishingAudio.length > 40_000, "fishing SFX must contain a full one-shot");
}
for (const rainAudio of [rainFineAudio, rainSurfaceAudio, rainDownpourAudio]) {
  assert.equal(rainAudio.subarray(0, 4).toString("ascii"), "OggS");
  assert(rainAudio.length > 500_000, "rain layer must contain a full ambience loop");
}
for (const thunderAudio of [thunderDistantAudio, thunderMediumAudio, thunderNearAudio]) {
  assert.equal(thunderAudio.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(thunderAudio.subarray(8, 12).toString("ascii"), "WAVE");
  assert(thunderAudio.length > 1_000_000, "thunder candidate must retain its rolling tail");
}
assert.match(
  parkSfxVolumeText,
  /PARK_GLOBAL_SFX_VOLUME_KEY = "aivatar\.audioVolume\.v1"/,
);
assert.match(parkSfxVolumeText, /DEFAULT_PARK_GLOBAL_SFX_VOLUME = 0\.45/);
assert.match(parkSfxVolumeText, /normalized === 0 \? 0 : Math\.sqrt\(normalized\)/);
assert.match(parkSfxVolumeText, /new AudioContextConstructor\(\{ latencyHint: "interactive" \}\)/);
assert.match(parkSfxVolumeText, /webkitAudioContext/);
assert.match(parkSfxVolumeText, /return new AudioContextConstructor\(\);/);
assert.match(
  footstepAudioText,
  /PARK_FOOTSTEP_MUTED_APPEARANCE_ID: AvatarAppearanceId =\s*"cute-ghost"/,
);
assert.match(footstepAudioText, /PARK_FOOTSTEP_VOLUME_MIN = 0\.22/);
assert.match(footstepAudioText, /PARK_FOOTSTEP_VOLUME_MAX = 0\.28/);
assert.match(footstepAudioText, /PARK_FOOTSTEP_DISTANCE_MIN = 18/);
assert.match(footstepAudioText, /PARK_FOOTSTEP_DISTANCE_VARIANCE = 4/);
assert.match(footstepAudioText, /createParkSfxAudioContext/);
assert.match(footstepAudioText, /readParkSfxVolume/);
assert.match(footstepAudioText, /Promise\.allSettled/);
assert.match(footstepAudioText, /result\.status === "fulfilled"/);
assert.match(footstepAudioText, /context\.decodeAudioData\(await response\.arrayBuffer\(\)\)/);
assert.match(footstepAudioText, /context\.createBufferSource\(\)/);
assert.match(footstepAudioText, /context\.createGain\(\)/);
assert.match(footstepAudioText, /source\.connect\(gain\)/);
assert.match(footstepAudioText, /gain\.connect\(context\.destination\)/);
assert.match(footstepAudioText, /source\.playbackRate\.value = 0\.97 \+ Math\.random\(\) \* 0\.07/);
assert.match(footstepAudioText, /globalVolume \* volumeMultiplier/);
assert.match(footstepAudioText, /controller\.activeVoices\.set\(source, gain\)/);
assert.match(footstepAudioText, /controller\.activeVoices\.clear\(\)/);
assert.match(footstepAudioText, /controller\.disposed = true/);
assert.match(footstepAudioText, /!controller\.disposed && context\.state !== "closed"/);
assert.match(footstepAudioText, /new AbortController\(\)/);
assert.match(footstepAudioText, /controller\.abortController\?\.abort\(\)/);
assert.match(footstepAudioText, /export const resumeParkFootstepAudio/);
assert.doesNotMatch(
  footstepAudioText,
  /controller\.resumePromise/,
  "a suspended automatic footstep resume must not block the next user gesture",
);
assert.match(footstepAudioText, /context\.close\(\)\.catch/);
assert.doesNotMatch(
  footstepAudioText,
  /HTMLAudioElement|new Audio\(|\.pause\(\)|\.currentTime\s*=|\.play\(\)/,
  "park footsteps must not reactivate HTML media elements while the avatar walks",
);
assert.match(
  footstepAudioText,
  /update\.appearanceId === PARK_FOOTSTEP_MUTED_APPEARANCE_ID/,
);
assert.match(fishingAudioText, /createParkSfxAudioContext/);
assert.match(fishingAudioText, /readParkSfxVolume/);
assert.match(fishingAudioText, /cast: "\/audio\/fishing-cast\.wav"/);
assert.match(fishingAudioText, /bite: "\/audio\/fishing-bite\.wav"/);
assert.match(fishingAudioText, /reel: "\/audio\/fishing-reel\.wav"/);
assert.match(fishingAudioText, /display: "\/audio\/fishing-display\.wav"/);
assert.match(fishingAudioText, /cast: 0\.5/);
assert.match(fishingAudioText, /bite: 0\.52/);
assert.match(fishingAudioText, /reel: 0\.42/);
assert.match(fishingAudioText, /display: 0\.48/);
assert.match(fishingAudioText, /Promise\.allSettled/);
assert.match(fishingAudioText, /context\.decodeAudioData\(await response\.arrayBuffer\(\)\)/);
assert.match(fishingAudioText, /context\.createBufferSource\(\)/);
assert.match(fishingAudioText, /context\.createGain\(\)/);
assert.match(fishingAudioText, /bank\.activeVoices\.set\(source, gain\)/);
assert.match(fishingAudioText, /bank\.lastError = audioErrorMessage/);
assert.match(fishingAudioText, /export const resumeParkFishingAudioBank/);
assert.match(fishingAudioText, /pendingPose: ParkFishingSoundPose \| null/);
assert.match(fishingAudioText, /bank\.pendingPose = pose/);
assert.match(fishingAudioText, /flushPendingParkFishingSound\(bank\)/);
assert.doesNotMatch(
  fishingAudioText,
  /if \(bank\.resumePromise\) return bank\.resumePromise/,
  "an automatic suspended resume must never block a later user-gesture retry",
);
assert.match(fishingAudioText, /bank\.loadState = "disposed"/);
assert.match(fishingAudioText, /context\.close\(\)\.catch/);
assert.doesNotMatch(
  fishingAudioText,
  /HTMLAudioElement|new Audio\(|\.pause\(\)|\.currentTime\s*=|\.play\(\)/,
  "park fishing SFX must use decoded Web Audio one-shots instead of HTML media IPC",
);
assert.match(parkText, /updateParkFootstepAudio\(footstepAudioRef\.current/);
assert.match(parkText, /resumeParkFootstepAudio\(footstepAudio\)/);
assert.match(parkText, /addEventListener\("pointerdown", resumeFootsteps, true\)/);
assert.match(parkText, /addEventListener\("keydown", resumeFootsteps, true\)/);
assert.match(parkText, /addEventListener\("touchstart", resumeFootsteps, true\)/);
assert.match(parkText, /removeEventListener\("pointerdown", resumeFootsteps, true\)/);
assert.match(parkText, /removeEventListener\("keydown", resumeFootsteps, true\)/);
assert.match(parkText, /removeEventListener\("touchstart", resumeFootsteps, true\)/);
assert.match(parkText, /resumeParkFishingAudioBank\(audioBank\)/);
assert.match(parkText, /addEventListener\("pointerdown", resumeFishing, true\)/);
assert.match(parkText, /addEventListener\("keydown", resumeFishing, true\)/);
assert.match(parkText, /addEventListener\("touchstart", resumeFishing, true\)/);
assert.match(parkText, /removeEventListener\("pointerdown", resumeFishing, true\)/);
assert.match(parkText, /removeEventListener\("keydown", resumeFishing, true\)/);
assert.match(parkText, /removeEventListener\("touchstart", resumeFishing, true\)/);
assert.match(parkText, /distancePx: distanceMoved/);
assert.match(parkText, /onGrass: isParkGrassPoint/);
assert.match(appText, /shouldChooseCooking\(warmth\)/);
assert.match(
  appText,
  /const cookingInteractionInFlight =\s*pendingWorldInteractionRef\.current\?\.kind === "cook" \|\|\s*activeInteractionRef\.current\?\.kind === "cook";/,
  "pending or active cooking must reserve the shared brew behavior from autonomous coffee",
);
assert.match(
  appText,
  /runtimeActionBehavior\(runtimeRef\.current\) === "brew" &&\s*!cookingInteractionInFlight &&/,
  "autonomous coffee must not run while cooking owns the shared brew behavior",
);
assert.match(
  avatarRendererText,
  /const shouldRestorePlacedItemOverFurniture = \(\s*item: PlacedItem,\s*furniture: FurnitureDefinition,\s*\) =>[\s\S]*?\(item\.itemId === "oil-easel" && furniture\.id === "bed"\);/,
  "an Oil Easel at the foot of the bed must be restored above bed-family occlusion redraws",
);
assert.match(
  avatarRendererText,
  /\.filter\(\(furniture\) => shouldRestorePlacedItemOverFurniture\(item, furniture\)\)\s*\.filter\(\(furniture\) => itemDepth >= furnitureDepthY\(furniture\)\)/,
  "bed-family easel restoration must retain the existing item-versus-furniture depth gate",
);
assert.match(
  avatarRendererText,
  /const placedItemDepthSort = \(left: PlacedItem, right: PlacedItem\) =>\s*placedItemDepthY\(left\) - placedItemDepthY\(right\)/,
  "floor placed items must use their visual foot depth instead of incompatible raw anchors",
);
assert.equal(
  (avatarRendererText.match(/\.sort\(placedItemDepthSort\)/g) ?? []).length,
  3,
  "the cached and fallback floor-item render paths must share one depth comparator",
);
assert.match(appText, /consumeFurnitureStorageItem\([\s\S]*"fridge"/);
assert.match(tauriText, /inner_size\(1180\.0, 900\.0\)/);
assert.match(
  rendererText,
  /parkCanvasSnapshotSource\(\s*layers\.neutralBaseWithoutDistantShoreFoamAndCliffFog/,
);
assert.match(rendererText, /PARK_HORIZON_Y = 122/);
assert.match(rendererText, /PARK_HORIZON_TINT_END_Y = 235/);
assert.match(rendererText, /const drawHorizonSeaTint/);
assert.match(rendererText, /const color = visual\.skyHorizon/);
assert.match(rendererText, /const dawnWindow = Math\.max\(0, 1 - Math\.abs\(visual\.hour - 6\.5\) \/ 2\)/);
assert.match(rendererText, /const dawnBoost = dawnWindow \* dawnWindow \* \(3 - 2 \* dawnWindow\)/);
assert.match(rendererText, /const topAlpha = 0\.62 \+ dawnBoost \* 0\.16/);
assert.match(rendererText, /const middleAlpha = 0\.4 \+ dawnBoost \* 0\.12/);
assert.match(rendererText, /const lowerAlpha = 0\.14 \+ dawnBoost \* 0\.05/);
assert.match(rendererText, /createLinearGradient/);
assert.match(rendererText, /gradient\.addColorStop\(1, `rgba\(\$\{color\.join\(","\)\},0\)`\)/);
assert.match(rendererText, /globalCompositeOperation = "destination-in"/);
assert.match(
  rendererText,
  /tint\.drawImage\(parkCanvasSnapshotSource\(layers\.seaMask\), 0, 0\)/,
);
assert.match(rendererText, /globalCompositeOperation = "soft-light"/);
assert.match(rendererText, /drawHorizonSeaTint\(ctx, layers, timeVisual\)/);
assert.match(rendererText, /parkHorizonTintEnd/);
assert.match(rendererText, /parkHorizonDawnBoost/);
assert.match(nightSkyText, /PARK_NIGHT_STAR_BACKGROUND_COUNT = 104/);
assert.match(nightSkyText, /PARK_NIGHT_STAR_BAND_COUNT = 42/);
assert.match(nightSkyText, /const PARK_NIGHT_STARS/);
assert.match(nightSkyText, /const isGalacticBand/);
assert.match(nightSkyText, /const bandCenter/);
assert.match(nightSkyText, /const horizonFade/);
assert.match(nightSkyText, /star\.size === 3/);
assert.doesNotMatch(nightSkyText, /Math\.random\(\)/);
assert.match(rendererText, /parkNightStarCount/);
assert.match(rendererText, /parkNightStarBandCount/);
assert.match(rendererText, /parkNightStarDistribution = "seeded-field-plus-band"/);
assert.match(rendererText, /ctx\.imageSmoothingEnabled = false/);
assert.doesNotMatch(rendererText, /drawSkyAndSea\(ctx, options/);
assert.doesNotMatch(rendererText, /drawPlateau\(ctx, options/);
assert.match(rendererText, /resolveParkCelestialPosition\(timeVisual\.hour\)/);
assert.match(rendererText, /const horizontal = caster\.x - celestial\.x/);
assert.doesNotMatch(rendererText, /drawMovingCelestialBody/);
assert.doesNotMatch(rendererText, /reflectionStrength/);
assert.match(
  rendererText,
  /drawSeaLighting\(ctx, layers, timeVisual, weather, motionNowMs\)/,
);
assert.match(
  rendererText,
  /light\.drawImage\(parkCanvasSnapshotSource\(layers\.seaMotionMask\), 0, 0\)/,
);
assert.match(rendererText, /PARK_FOG_UPDATE_INTERVAL_MS = 1000 \/ 30/);
assert.match(rendererText, /PARK_GRASS_UPDATE_INTERVAL_MS = 1000 \/ 20/);
assert.doesNotMatch(rendererText, /PARK_POND_UPDATE_INTERVAL_MS/);
assert.match(rendererText, /PARK_SEA_LIGHT_UPDATE_INTERVAL_MS = 1000 \/ 20/);
assert.match(rendererText, /PARK_FOAM_UPDATE_INTERVAL_MS = 1000 \/ 24/);
assert.match(rendererText, /PARK_DIAGNOSTIC_UPDATE_INTERVAL_MS = 250/);
assert.match(rendererText, /const ambientUpdateDue/);
assert.match(rendererText, /const shouldUpdateParkDiagnostics/);
assert.doesNotMatch(
  rendererText,
  /pondSurfaceCanvas|pondTextureCanvas|pondCompositeCanvas|pondPatternCache|createPattern\(/,
  "the park runtime must not rebuild the pond through dynamic offscreen canvases",
);
assert.match(rendererText, /const sortedParkObjects/);
assert.match(rendererText, /const sortedStaticOccluders/);
assert.match(rendererText, /parkPondPatternCache = "none"/);
assert.doesNotMatch(rendererText, /const drawReferenceMotion/);
assert.doesNotMatch(rendererText, /const coverReferenceSun/);
assert.doesNotMatch(rendererText, /layers\.full/);
assert.match(rendererText, /const PARK_SEA_FINE_GLINT_COUNT = 260/);
assert.match(rendererText, /const PARK_SEA_WAVE_GLINT_COUNT = 104/);
assert.match(rendererText, /const PARK_SEA_SPARKLE_COUNT = 34/);
assert.match(rendererText, /Math\.pow\(pulse, 5\)/);
assert.match(rendererText, /parkSeaSparkleCount/);
assert.match(rendererText, /parkSeaSparklePhase/);
assert.doesNotMatch(seaLightingText, /Math\.random\(\)/);

assert.match(pondAtlasText, /PARK_POND_ATLAS_SOURCE = "\/park\/hilltop-pond-motion-v1\.png"/);
assert.match(pondAtlasText, /PARK_POND_ATLAS_FRAME_WIDTH = 396/);
assert.match(pondAtlasText, /PARK_POND_ATLAS_FRAME_HEIGHT = 443/);
assert.match(pondAtlasText, /PARK_POND_ATLAS_FRAME_COUNT = 80/);
assert.match(pondAtlasText, /PARK_POND_ATLAS_COLUMNS = 8/);
assert.match(pondAtlasText, /PARK_POND_ATLAS_ROWS = 10/);
assert.match(pondAtlasText, /PARK_POND_ATLAS_FPS = 10/);
assert.match(pondAtlasText, /PARK_POND_ATLAS_GUTTER = 1/);
assert.match(pondAtlasText, /image\.decoding = "async"/);
assert.match(pondAtlasText, /image\.naturalWidth !== PARK_POND_ATLAS_WIDTH/);
assert.match(pondAtlasText, /image\.naturalHeight !== PARK_POND_ATLAS_HEIGHT/);
assert.match(pondAtlasText, /export const ensureParkPondAtlas/);
assert.match(pondAtlasText, /export const getParkPondAtlas/);
assert.match(pondAtlasText, /export const getParkPondAtlasStatus/);
assert.match(pondAtlasText, /Math\.floor\(nowMs \/ frameDurationMs\) % PARK_POND_ATLAS_FRAME_COUNT/);
assert.doesNotMatch(pondAtlasText, /createElement\("canvas"\)|createImageBitmap/);

assert.match(rendererText, /from "\.\/parkPondAtlas"/);
assert.match(rendererText, /const drawPondSurface/);
assert.match(pondSurfaceText, /ensureParkPondAtlas\(\)/);
assert.match(pondSurfaceText, /const atlas = getParkPondAtlas\(\)/);
assert.match(pondSurfaceText, /pondBounds\.x !== 784/);
assert.match(pondSurfaceText, /pondBounds\.y !== 457/);
assert.match(pondSurfaceText, /pondBounds\.width !== PARK_POND_ATLAS_FRAME_WIDTH/);
assert.match(pondSurfaceText, /pondBounds\.height !== PARK_POND_ATLAS_FRAME_HEIGHT/);
assert.match(pondSurfaceText, /const source = parkPondAtlasFrameSource\(nowMs\)/);
assert.equal(
  (pondSurfaceText.match(/ctx\.drawImage\(/g) ?? []).length,
  1,
  "each visible pond frame must use exactly one image-to-main-canvas draw",
);
assert.doesNotMatch(
  pondSurfaceText,
  /createPattern|destination-in|pondInteriorMask|pondEdgeMask|pondRimMask/,
);

assert.match(pondGeneratorText, /FRAME_WIDTH = 396/);
assert.match(pondGeneratorText, /FRAME_HEIGHT = 443/);
assert.match(pondGeneratorText, /FRAME_COUNT = 80/);
assert.match(pondGeneratorText, /ATLAS_COLUMNS = 8/);
assert.match(pondGeneratorText, /ATLAS_ROWS = 10/);
assert.match(pondGeneratorText, /ATLAS_FPS = 10/);
assert.match(pondGeneratorText, /ATLAS_GUTTER = 1/);
assert.match(pondGeneratorText, /POND_STRIP_HEIGHT = 2/);
assert.match(pondGeneratorText, /POND_TRAVELLING_HIGHLIGHT_FREQUENCY = 0\.049/);
assert.match(pondGeneratorText, /POND_TRAVELLING_HIGHLIGHT_STRENGTH = 0\.42/);
assert.match(pondGeneratorText, /POND_TRAVELLING_HIGHLIGHT_SHARPNESS = 9/);
assert.match(
  pondGeneratorText,
  /\(min_x, min_y, width, height\) != \(784, 457, FRAME_WIDTH, FRAME_HEIGHT\)/,
);
assert.match(pondGeneratorText, /def make_pond_masks/);
assert.match(pondGeneratorText, /def make_cellular_texture/);
assert.match(pondGeneratorText, /def tiled_texture_layer/);
assert.match(pondGeneratorText, /mode == "multiply"/);
assert.match(pondGeneratorText, /mode == "screen"/);
assert.match(pondGeneratorText, /def sampled_strip/);
assert.match(pondGeneratorText, /opacity=1\.0 - morph_mix/);
assert.match(pondGeneratorText, /for ripple_x, ripple_y, ripple_phase, warp_amount, warp_phase/);
assert.match(pondGeneratorText, /particle_cycles = 2 if index % 7 <= 1 else 1/);
assert.match(pondGeneratorText, /glimmer_cycles = 1 \+ \(1 if index % 5 == 0 else 0\)/);
assert.match(pondGeneratorText, /surface\[\.\.\., 3\] \*= interior_mask/);
assert.match(pondGeneratorText, /edge_layer\[\.\.\., 3\] = edge_mask/);
assert.match(pondGeneratorText, /rim_layer\[\.\.\., 3\] = rim_mask/);
assert.match(pondGeneratorText, /frame_index \/ FRAME_COUNT/);

assert.match(rendererText, /PARK_DOWNWARD_RIPPLE_PHASE_SCALE_MS = 680/);
assert.match(rendererText, /PARK_DOWNWARD_RIPPLE_FREQUENCY = 0\.049/);
assert.match(rendererText, /PARK_DOWNWARD_RIPPLE_SHARPNESS = 9/);
assert.match(
  rendererText,
  /Math\.PI \* 2 \* PARK_DOWNWARD_RIPPLE_PHASE_SCALE_MS/,
);
assert.match(terrainMotionText, /const phase = nowMs \/ PARK_DOWNWARD_RIPPLE_PHASE_SCALE_MS/);
assert.match(
  terrainMotionText,
  /Math\.sin\(y \* PARK_DOWNWARD_RIPPLE_FREQUENCY - phase\)/,
);
assert.match(
  terrainMotionText,
  /Math\.pow\(crestWave, PARK_DOWNWARD_RIPPLE_SHARPNESS\)/,
);
assert.match(terrainMotionText, /const stripHeight = 2/);
assert.match(terrainMotionText, /const lowerOffset = Math\.floor\(lateralBend\)/);
assert.match(terrainMotionText, /crest \* 0\.2 \* \(1 - offsetMix\)/);
assert.match(terrainMotionText, /crest \* 0\.2 \* offsetMix/);
assert.match(
  terrainMotionText,
  /ripple\.drawImage\(parkCanvasSnapshotSource\(layers\.grassRippleMask\), 0, 0\)/,
);
assert.doesNotMatch(terrainMotionText, /const gust/);
assert.doesNotMatch(terrainMotionText, /Math\.random\(\)/);
assert.doesNotMatch(rendererText, /cliffGrassSway|CliffGrassSway|CLIFF_GRASS_SWAY/);
assert.doesNotMatch(rendererText, /ctx\.ellipse\(1118, 682, 285, 255/);
assert.match(rendererText, /parkPondSurfaceLayerCount = "1"/);
assert.match(rendererText, /parkPondCellVerticalScale = "prebaked"/);
assert.match(rendererText, /parkPondWaveInterpolation = "prebaked-loop"/);
assert.match(rendererText, /parkPondTexturePass = "single-image-draw"/);
assert.match(rendererText, /parkPondTextureDrawsPerUpdate = "1"/);
assert.match(rendererText, /parkGrassRipplePhase = downwardRipplePhase/);
assert.match(rendererText, /parkGrassRippleDirection = "toward-foreground"/);
assert.match(rendererText, /parkGrassRippleSharedWithPond = "false"/);
assert.match(rendererText, /parkGrassRippleMaskPixels/);
assert.match(rendererText, /parkGrassRippleObstacleExclusionCount/);
assert.match(rendererText, /parkPondFinePalette = "prebaked-lightened"/);
assert.match(rendererText, /parkPondMorphInterpolation = "seamless-prebaked-loop"/);
assert.match(rendererText, /parkPondOffscreenStrategy = "prebaked-image-atlas"/);
assert.match(rendererText, /parkPondOffscreenAreaRatio = "0\.0000"/);
assert.match(rendererText, /parkPondSurfaceBufferPixels = "0"/);
assert.match(rendererText, /parkPondTextureBufferPixels = "0"/);
assert.match(rendererText, /parkPondLeftBay = "audited-seeded-water"/);
assert.match(rendererText, /parkPondSource = !pondAtlasBoundsMatch/);
assert.match(rendererText, /"prebaked-image-atlas"/);
assert.match(rendererText, /static-fallback-/);
assert.match(rendererText, /parkPondAtlasFrameCount/);
assert.match(rendererText, /parkPondAtlasFps/);
assert.match(rendererText, /parkPondAtlasGutter/);
assert.match(rendererText, /parkPondParticleCount/);
assert.match(rendererText, /parkPondTimeGraded = "true"/);
const pondDrawCallIndex = rendererText.lastIndexOf("drawPondSurface(ctx, layers, motionNowMs)");
const avatarDrawCallIndex = rendererText.lastIndexOf("drawAvatar(");
assert(pondDrawCallIndex >= 0, "pond surface draw call must exist");
assert(avatarDrawCallIndex > pondDrawCallIndex, "pond surface must render below the avatar");
assert.match(rendererText, /const resolveShoreFoamBreath/);
assert.match(rendererText, /let shoreFoamMotionCanvas/);
assert.match(rendererText, /let shoreFoamHighlightCanvas/);
assert.match(rendererText, /let shoreFoamFringeCanvas/);
assert.match(rendererText, /const smootherstep/);
assert.match(rendererText, /const cycle = \(nowMs \/ segment\.periodMs \+ segment\.phase/);
assert.match(rendererText, /const localBreath = smootherstep\(riseAndFall\)/);
assert.match(rendererText, /const distanceSteps = segment\.amplitudePx \* localBreath/);
assert.match(rendererText, /const lowerStep = Math\.floor\(distanceSteps\)/);
assert.match(rendererText, /coreAlpha \* \(1 - mix\)/);
assert.match(rendererText, /coreAlpha \* mix/);
assert.match(rendererText, /const coreAlpha = 0\.62 \+ localBreath \* 0\.38/);
assert.match(rendererText, /const highlightAlpha = 0\.02 \+ localBreath \* 0\.26/);
assert.match(rendererText, /const fringeBreath = smootherstep\(\(localBreath - 0\.28\) \/ 0\.72\)/);
assert.match(rendererText, /const fringeAlpha = fringeBreath \* 0\.3/);
assert.match(rendererText, /const fringeDistanceSteps = distanceSteps \+ fringeBreath \* 0\.75/);
assert.match(rendererText, /segment\.directionX \* step/);
assert.match(rendererText, /segment\.directionY \* step/);
assert.match(
  rendererText,
  /motion\.drawImage\(\s*parkCanvasSnapshotSource\(layers\.shoreFoamMotionMask\)/,
);
assert.match(
  rendererText,
  /highlight\.drawImage\(\s*parkCanvasSnapshotSource\(layers\.shoreFoamMotionMask\)/,
);
assert.match(
  rendererText,
  /fringe\.drawImage\(\s*parkCanvasSnapshotSource\(layers\.shoreFoamMotionMask\)/,
);
assert.match(shoreFoamMotionText, /ctx\.globalCompositeOperation = "source-over"/);
assert.match(shoreFoamMotionText, /ctx\.globalAlpha = nightDimming/);
assert.match(shoreFoamMotionText, /ctx\.globalCompositeOperation = "screen"/);
assert.match(rendererText, /parkShoreFoamSegmentCount/);
assert.match(rendererText, /parkShoreFoamGroupCount/);
assert.match(rendererText, /parkShoreFoamMaxOffset = "2\.25"/);
assert.match(rendererText, /parkShoreFoamInterpolatingSegments/);
assert.match(rendererText, /parkShoreFoamBreathingFringeSegments/);
assert.match(rendererText, /parkShoreFoamFringeOffset = "0\.75"/);
assert.match(rendererText, /parkShoreFoamTimeGraded = "true"/);
assert.match(rendererText, /parkShoreFoamNightDimming = "0\.62"/);
assert.match(shoreFoamMotionText, /const nightDimming = 1 - visual\.nightStrength \* 0\.62/);
const foamDrawCallIndex = rendererText.lastIndexOf("? drawShoreFoamBreath(");
const timeGradeCallIndex = rendererText.lastIndexOf("applyTimeGrade(ctx, timeVisual)");
assert(foamDrawCallIndex >= 0, "foam draw call must exist");
assert(timeGradeCallIndex > foamDrawCallIndex, "time grade must be applied after moving foam");
assert(timeGradeCallIndex > pondDrawCallIndex, "pond surface must be affected by the time grade");
assert.match(rendererText, /parkShoreFoamMotionPhase/);
assert.doesNotMatch(shoreFoamMotionText, /Math\.random\(\)/);
assert.doesNotMatch(shoreFoamMotionText, /Math\.round\(Math\.sin/);
assert.match(rendererText, /drawFoamBand\(layers\.shoreFoamOuterMask, 0\.1 \+ outerExpansion \* 0\.22\)/);
assert.match(rendererText, /drawFoamBand\(layers\.shoreFoamInnerMask, 0\.44 \+ cachedFoamBreath \* 0\.28\)/);
assert.match(rendererText, /const outerExpansion = Math\.max/);
assert.doesNotMatch(rendererText, /shoreFoamCanvas/);
assert.match(rendererText, /parkSeaMotionMaskPixels/);
assert.match(rendererText, /parkShoreFoamInnerMaskPixels/);
assert.match(rendererText, /parkShoreFoamOuterMaskPixels/);
assert.match(rendererText, /parkDistantShoreFoamMaskPixels/);
assert.match(rendererText, /parkShoreFoamBreath/);
assert.doesNotMatch(rendererText, /Math\.floor\(nowMs \/ \(110 \+ \(index % 3\) \* 31\)\)/);
assert.match(rendererText, /const PARK_CLOUD_LANES/);
assert.match(rendererText, /const trackLength = PARK_SCENE_WIDTH \+ travelWidth \+ lane\.gap/);
assert.match(rendererText, /const cycleIndex = Math\.floor\(travel \/ trackLength\)/);
assert.match(rendererText, /phase - travelWidth - lane\.gap \/ 2 \+ \(travelWidth - drawWidth\) \/ 2/);
assert.match(
  rendererText,
  /ctx\.drawImage\(\s*sprite,/,
);
assert.match(rendererText, /ctx\.imageSmoothingEnabled = true/);
assert.doesNotMatch(rendererText, /parkCanvasSnapshotSource\(sprite\)/);
assert.doesNotMatch(rendererText, /from "\.\/parkClouds"/);
assert.match(rendererText, /parkCloudSource = "imagegen-time-atlas"/);
assert.match(rendererText, /scale: 0\.684/);
assert.match(rendererText, /scale: 0\.216/);
assert.match(rendererText, /styleSequence: \[3, 4\]/);
assert.match(rendererText, /styleSequence: \[5, 6\]/);
assert.match(rendererText, /styleSequence: \[0\].*speed: 0\.0027/);
assert.match(rendererText, /styleSequence: \[1\].*speed: 0\.00205/);
assert.match(rendererText, /styleSequence: \[2\].*speed: 0\.00335/);
assert.equal((rendererText.match(/alpha: 1/g) ?? []).length, 6);
assert.match(rendererText, /styleSequence: \[0\], y: -41\.5/);
assert.match(rendererText, /styleSequence: \[1\], y: -25/);
assert.match(rendererText, /styleSequence: \[2\], y: -5/);
assert.match(rendererText, /styleSequence: \[3, 4\], y: -2\.5/);
assert.match(rendererText, /styleSequence: \[5, 6\], y: 1\.5/);
assert.match(rendererText, /styleSequence: \[7\], y: 8\.5/);
assert.match(rendererText, /ctx\.globalAlpha = lane\.alpha/);
assert.doesNotMatch(rendererText, /lane\.alpha \* \(1 - visual\.nightStrength/);
assert.match(rendererText, /const lightingNowMs = previewTime\(options\.nowMs\)/);
assert.match(rendererText, /const motionNowMs = options\.nowMs/);
assert.match(rendererText, /drawMovingCloudLayer\(ctx, timeVisual, motionNowMs\)/);
assert.match(rendererText, /const drawMovingCliffFog/);
assert.match(rendererText, /drawMovingCliffFog\(ctx, layers, motionNowMs\)/);
assert.match(rendererText, /parkCliffFogSegmentCount/);
assert.match(rendererText, /parkCliffFogMaskPixels/);
assert.match(rendererText, /parkCliffFogMotionMaskPixels/);
assert.match(rendererText, /parkCliffFogPhase/);
assert.match(rendererText, /parkCliffFogMaxOffset/);
assert.match(rendererText, /parkCliffFogSource = "authored-reference-layer"/);
assert.match(
  rendererText,
  /parkCanvasSnapshotSource\(\s*layers\.neutralBaseWithoutDistantShoreFoamAndCliffFog/,
);
assert.match(
  cliffFogMotionText,
  /-\(Math\.sin\(phase\) \* 0\.5 \+ 0\.5\) \* segment\.amplitudeX/,
);
assert.match(cliffFogMotionText, /phase \* 0\.73 \+ index \* 1\.37/);
assert.match(cliffFogMotionText, /motion\.imageSmoothingEnabled = true/);
assert.doesNotMatch(cliffFogMotionText, /Math\.round\(horizontalOffset/);
assert.doesNotMatch(cliffFogMotionText, /Math\.round\(verticalOffset/);
assert.match(rendererText, /const PARK_CLIFF_FOG_UNDERLAY_ALPHA = 0\.94/);
assert.match(cliffFogMotionText, /motion\.globalCompositeOperation = "destination-over"/);
assert.match(
  cliffFogMotionText,
  /motion\.globalAlpha = segment\.alpha \* PARK_CLIFF_FOG_UNDERLAY_ALPHA/,
);
assert.match(
  cliffFogMotionText,
  /parkCanvasSnapshotSource\(segment\.canvas\),\s*segment\.x,\s*segment\.y/,
  "the authored fog pattern must fill the area revealed behind the moving bank",
);
assert.match(cliffFogMotionText, /motion\.globalCompositeOperation = "destination-in"/);
assert.match(
  cliffFogMotionText,
  /motion\.drawImage\(\s*parkCanvasSnapshotSource\(layers\.cliffFogMotionMask\)/,
);
assert.doesNotMatch(cliffFogMotionText, /Math\.random\(\)/);
const blendedCloudStart = rendererText.indexOf("const blendedCloud =");
const blendedCloudEnd = rendererText.indexOf("const PARK_CLOUD_DRAW_REFERENCE_HEIGHT");
assert(blendedCloudStart >= 0 && blendedCloudEnd > blendedCloudStart, "blended cloud block must exist");
const blendedCloudBlock = rendererText.slice(blendedCloudStart, blendedCloudEnd);
assert.match(blendedCloudBlock, /style\.variants\[blend\.from\]/);
assert.match(blendedCloudBlock, /style\.variants\[blend\.to\]/);
assert.match(blendedCloudBlock, /quantizedMix/);
assert.match(blendedCloudBlock, /globalCompositeOperation = "source-atop"/);
assert.match(blendedCloudBlock, /getImageData/);
assert.match(rendererText, /PARK_CLOUD_DRAW_REFERENCE_HEIGHT = 227/);
assert.match(rendererText, /PARK_CLOUD_TRAVEL_REFERENCE_HEIGHT = 454/);
assert.match(rendererText, /const targetContentHeight = PARK_CLOUD_DRAW_REFERENCE_HEIGHT \* lane\.scale/);
assert.match(rendererText, /const travelContentHeight = PARK_CLOUD_TRAVEL_REFERENCE_HEIGHT \* lane\.scale/);
for (const hour of [4.5, 6.5, 11.5, 15.5, 18.3, 20.5]) {
  assert.match(rendererText, new RegExp(String(hour).replace(".", "\\.")));
}
assert.match(rendererText, /parkCloudCornerAlpha/);
assert.match(rendererText, /const travel = celestial\.progress \* 175/);
assert.match(rendererText, /globalCompositeOperation = "destination-in"/);
for (const hour of [0, 6.5, 12.2, 18.3, 21]) {
  assert.match(rendererText, new RegExp(`hour: ${String(hour).replace(".", "\\.")}`));
}
assert.match(layersText, /PARK_REFERENCE_ASSET = "\/park\/hilltop-park-midday-ground\.png"/);
assert.match(layersText, /PARK_REFERENCE_STAMP_ASSET = "\/park\/hilltop-park-reference\.png"/);
assert.match(
  layersText,
  /PARK_WEATHER_BACKDROP_MASK_ASSET = "\/park\/hilltop-park-weather-backdrop-mask\.png"/,
);
assert.match(layersText, /PARK_REFERENCE_SOURCE_WIDTH = 1435/);
assert.match(layersText, /PARK_REFERENCE_SOURCE_HEIGHT = 1095/);
assert.match(layersText, /buildLayers\(image, stampImage, weatherBackdropImage\)/);
assert.match(layerInterfaceText, /weatherBackdropMask: HTMLCanvasElement/);
assert.doesNotMatch(layerInterfaceText, /full: HTMLCanvasElement/);
assert.doesNotMatch(
  layerInterfaceText,
  /neutralBaseWithoutDistantShoreFoam: HTMLCanvasElement/,
);
assert.doesNotMatch(layerInterfaceText, /cliffFogMask: HTMLCanvasElement/);
assert.doesNotMatch(layerInterfaceText, /pondMask: HTMLCanvasElement/);
assert.doesNotMatch(layerInterfaceText, /distantShoreFoamMask: HTMLCanvasElement/);
assert.match(layersText, /const makeGrassRippleMask/);
assert.match(layersText, /if \(!isParkGrassPoint\(x, y\)\) continue/);
assert.match(layersText, /const grassLike = green >= 55/);
assert.match(layersText, /PARK_REFERENCE_COLLIDERS\.forEach/);
assert.match(layersText, /const radius = collider\.radius \+ 6/);
assert.match(layersText, /staticOccluders\.forEach\(\(occluder\)/);
assert.match(layersText, /deltaX \* deltaX \+ deltaY \* deltaY <= 9/);
assert.match(layersText, /grassRippleMask = makeGrassRippleMask\(neutralBase, staticOccluders\)/);
assert.match(layersText, /grassRippleMaskPixels: countOpaquePixels\(grassRippleMask\)/);
assert.doesNotMatch(layersText, /cliffGrassSway|CliffGrassSway|CLIFF_GRASS/);
assert.match(
  layersText,
  /PARK_REFERENCE_COLLIDERS\.length \+ staticOccluders\.length/,
);
assert.match(layersText, /interface ParkCliffFogSegment/);
assert.match(layersText, /const PARK_CLIFF_FOG_BANDS/);
for (const fogId of [
  "upper-cliff-fog",
  "middle-cliff-fog",
  "lower-cliff-fog",
]) {
  assert.match(layersText, new RegExp(`id: "${fogId}"`));
}
assert.match(layersText, /periodMs: 46_000/);
assert.match(layersText, /periodMs: 58_000/);
assert.match(layersText, /periodMs: 52_000/);
assert.match(layersText, /PARK_CLIFF_FOG_FEATHER_RADIUS = 4/);
assert.match(layersText, /const makeCliffFogLayers/);
assert.match(layersText, /const candidates = new Uint8Array\(pixelCount\)/);
assert.match(layersText, /if \(!hasFogSeed \|\| component\.length < 12\) continue/);
assert.match(layersText, /const fogAlphaPixels = new Uint8Array\(pixelCount\)/);
assert.match(
  layersText,
  /smoothFeather\(nearestOutside \/ PARK_CLIFF_FOG_FEATHER_RADIUS\) \* 255/,
);
assert.match(
  layersText,
  /segmentImage\.data\[segmentOffset \+ 3\] = fogAlphaPixels\[index\] \?\? 0/,
);
assert.doesNotMatch(layersText, /segmentImage\.data\[segmentOffset \+ 3\] = 255/);
assert.match(layersText, /neutralBaseWithoutDistantShoreFoamAndCliffFog: cleaned/);
assert.match(layersText, /cliffFogMask: makeMaskCanvas\(fogAlphaPixels\)/);
assert.match(layersText, /cliffFogMotionMask: makeMaskCanvas\(motionPixels\)/);
assert.match(layersText, /makeCliffFogLayers\(neutralBaseWithoutDistantShoreFoam\)/);
assert.doesNotMatch(layersText, /\{ x: 234, y: 397, width: 52, length: 90/);
assert.doesNotMatch(layersText, /\{ x: 507, y: 298, width: 86, length: 168/);
assert.doesNotMatch(layersText, /\{ x: 871, y: 334, width: 64, length: 112/);
assert.match(layersText, /const makeNeutralBase/);
assert.match(layersText, /const smoothFeather/);
assert.match(layersText, /previousSeaNeutral/);
assert.match(layersText, /sampledNeutral\[index\].*0\.12/);
assert.match(layersText, /const topFeather = smoothFeather/);
assert.match(layersText, /const bottomFeather = 1 - smoothFeather/);
assert.match(layersText, /const rightFeather = 1 - smoothFeather/);
assert.match(layersText, /blendedSolarWeight/);
assert.match(layersText, /const brightnessCorrection = brightness - neutralTargetBrightness/);
assert.match(layersText, /targetRed/);
assert.match(layersText, /targetGreen/);
assert.match(layersText, /targetBlue/);
assert.doesNotMatch(layersText, /for \(let x = 0; x < 245; x \+= 1\)/);
assert.match(layersText, /const makeSeaMasks/);
assert.match(layersText, /const connectedSea = new Uint8Array/);
assert.match(layersText, /while \(queueHead < queueTail\)/);
assert.match(layersText, /const PARK_OCEAN_LAND_EXCLUSIONS/);
assert.match(layersText, /const makeLandExclusionMask/);
assert.match(layersText, /if \(landExclusion\[index\] !== 0\) connectedSea\[index\] = 0/);
assert.match(layersText, /if \(connectedSea\[index\] !== 0 && nearestLand <= 4\) seaMotion\[index\] = 0/);
assert.match(layersText, /seaMotionMask: makeMaskCanvas\(seaMotion\)/);
assert.match(layersText, /const staticFoamColor = brightness >= 126/);
assert.match(layersText, /let touchesConnectedSea = false/);
assert.match(layersText, /Expand only the authored foam pixels toward connected water/);
assert.match(layersText, /const makeMaskDistanceField/);
assert.match(layersText, /const landDistance = makeMaskDistanceField\(landExclusion, 7\)/);
assert.match(layersText, /const PARK_DISTANT_SHORE_FOAM_BANDS/);
for (const secondaryBand of [
  /id: "left-island-secondary"[\s\S]*?minX: 0, minY: 225, maxX: 100, maxY: 260[\s\S]*?splitIntoComponents: true/,
  /id: "left-upper-secondary"[\s\S]*?minX: 45, minY: 250, maxX: 235, maxY: 335[\s\S]*?splitIntoComponents: true/,
  /id: "left-lower-secondary"[\s\S]*?minX: 60, minY: 325, maxX: 270, maxY: 420[\s\S]*?splitIntoComponents: true/,
]) {
  assert.match(layersText, secondaryBand);
}
for (const group of [
  "left-island",
  "left-coast-upper",
  "left-coast-lower",
  "center-island",
  "right-island-upper",
  "right-island-lower",
]) {
  assert.match(layersText, new RegExp(`group: "${group}"`));
}
assert.match(layersText, /const whiteFoam = luma >= 190/);
assert.match(layersText, /const blueWhiteFoam = luma >= 150/);
assert.match(layersText, /if \(contrast < 18\) continue/);
assert.match(layersText, /distantShoreFoamCandidates/);
assert.doesNotMatch(layersText, /const distantLandDistance/);
assert.match(layersText, /const makeBaseWithoutDistantShoreFoam/);
assert.match(layersText, /if \(distantShoreFoam\[index\] !== 0\) shoreFoamInner\[index\] = 0/);
assert.match(layersText, /neutralBaseWithoutDistantShoreFoam: makeBaseWithoutDistantShoreFoam/);
assert.match(layersText, /const foamDistance = makeMaskDistanceField\(shoreFoamInner, 3\)/);
assert.match(layersText, /shoreFoamInnerMask: makeMaskCanvas\(shoreFoamInner\)/);
assert.match(layersText, /shoreFoamOuterMask: makeMaskCanvas\(shoreFoamOuter\)/);
assert.match(layersText, /distantShoreFoamMask: makeMaskCanvas\(distantShoreFoam\)/);
assert.match(layersText, /shoreFoamMotionMask: makeMaskCanvas\(shoreFoamMotion\)/);
assert.match(layersText, /const makePondMasks/);
assert.match(layersText, /const PARK_POND_MIN_X = 750/);
assert.match(layersText, /const PARK_POND_AUDITED_SEEDS/);
assert.match(layersText, /\[790, 620\]/);
assert.match(layersText, /\[800, 650\]/);
assert.match(layersText, /PARK_POND_AUDITED_SEEDS\.forEach/);
assert.match(layersText, /const connectedPond = new Uint8Array/);
assert.match(layerInterfaceText, /pondBounds: ParkPondBounds/);
assert.match(layersText, /const measureMaskBounds/);
assert.match(layersText, /const pondBounds = measureMaskBounds\(connectedPond\)/);
assert.match(layersText, /Seeding only[\s\S]*those edges rejects isolated blue details/);
assert.match(layersText, /pondMask: makeMaskCanvas\(connectedPond, pondBounds\)/);
assert.match(layersText, /pondInteriorMask: makeMaskCanvas\(pondInterior, pondBounds\)/);
assert.match(layersText, /pondEdgeMask: makeMaskCanvas\(pondEdge, pondBounds\)/);
assert.match(layersText, /pondRimMask: makeMaskCanvas\(pondRim, pondBounds\)/);
assert.match(layersText, /const makeShoreFoamSegments/);
assert.match(layersText, /if \(!band\.splitIntoComponents\)/);
assert.match(layersText, /for \(let deltaY = -1; deltaY <= 1; deltaY \+= 1\)/);
assert.match(layersText, /for \(let deltaX = -3; deltaX <= 3; deltaX \+= 1\)/);
assert.match(layersText, /`\$\{band\.id\}-\$\{componentIndex \+ 1\}`/);
assert.match(layersText, /periodMs: 3400 \+ \(periodHash % 1601\)/);
assert.match(rendererText, /Math\.sin\(nowMs \/ 675\)/);
assert.match(rendererText, /Math\.sin\(nowMs \/ 1025 \+ 1\.35\)/);
assert.match(layersText, /inhaleRatio: 0\.54/);
assert.match(layersText, /amplitudePx: 1\.8/);
assert.match(layersText, /directionX: band\.directionX/);
assert.match(layersText, /directionY: band\.directionY/);
assert.match(layersText, /shoreFoamSegments: makeShoreFoamSegments\(distantShoreFoam, sourceImage\)/);
assert.doesNotMatch(layersText, /CLOUD_RECIPES/);
assert.match(layersText, /PARK_REFERENCE_SHADOW_CASTERS/);
assert.match(layersText, /const STATIC_OCCLUDER_RECIPES/);
for (const occluderId of [
  "upper-rock-flower-cluster",
  "left-double-rock-cluster",
  "middle-single-rock",
  "middle-white-flower-shrub",
  "lower-pink-flower-shrub",
]) {
  assert.match(layersText, new RegExp(`id: "${occluderId}"`));
}
assert.match(layersText, /const makeStaticOccluder/);
assert.match(layersText, /type OccluderContour/);
assert.match(layersText, /pointInsideContour/);
assert.match(layersText, /occluderContourAt/);
assert.match(layersText, /minComponentPixels/);
assert.match(layersText, /connectedPixels/);
assert.match(layersText, /component\.length >= recipe\.minComponentPixels/);
assert.match(layersText, /mode: "solid"/);
assert.doesNotMatch(layersText, /OccluderEllipse/);
assert.doesNotMatch(layersText, /occluderSilhouetteCoverage/);
assert.match(layersText, /staticOccluders: ParkReferenceOccluder\[\]/);
assert.match(layersText, /makeStaticOccluder\(neutralBase, recipe\)/);
assert.match(rendererText, /const staticOccludersInFront = visualAvatar/);
assert.match(rendererText, /occluder\.depthY > avatarY/);
assert.match(rendererText, /drawReferenceOccluder\(ctx, occluder\)/);
assert.match(rendererText, /parkStaticOccluderCount/);
assert.match(rendererText, /parkStaticOccludersInFront/);
assert.doesNotMatch(rendererText, /parkOccluderDebug/);
assert.doesNotMatch(rendererText, /black-background/);
assert.match(layersText, /seaMaskPixels/);
assert.match(layersText, /seaMotionMaskPixels/);
assert.match(layersText, /shoreFoamInnerMaskPixels/);
assert.match(layersText, /shoreFoamOuterMaskPixels/);
assert.match(layersText, /distantShoreFoamMaskPixels/);
assert.match(layersText, /shoreFoamMotionMaskPixels/);
assert.match(layersText, /cliffFogMaskPixels/);
assert.match(layersText, /cliffFogMotionMaskPixels/);
assert.match(cloudAtlasText, /PARK_CLOUD_ATLAS_ASSET/);
assert.match(cloudAtlasText, /cumulonimbus-cloud-time-atlas\.png/);
assert.match(cloudAtlasText, /ATLAS_COLUMN_WIDTH = 418/);
assert.match(cloudAtlasText, /const ATLAS_ROWS/);
assert.equal((cloudAtlasText.match(/\{ y: \d+, height: \d+ \}/g) ?? []).length, 8);
assert.match(cloudAtlasText, /\["dawn", "noon", "sunset"\]/);
assert.match(cloudAtlasText, /BLACK_KEY_CUTOFF = 48/);
assert.match(cloudAtlasText, /SPRITE_SAFE_MARGIN = 4/);
assert.match(cloudAtlasText, /CUMULONIMBUS_STYLE_COUNT = 3/);
assert.match(cloudAtlasText, /CUMULONIMBUS_BOTTOM_EDGE_ALPHA = \[96, 184, 232\]/);
assert.match(cloudAtlasText, /getImageData/);
assert.match(cloudAtlasText, /const erodedMask = erodeMask/);
assert.match(cloudAtlasText, /erodedMask\[maskIndex\] === 0/);
assert.match(cloudAtlasText, /const featherCumulonimbusBottomEdge/);
assert.match(cloudAtlasText, /styleIndex < CUMULONIMBUS_STYLE_COUNT/);
assert.match(cloudAtlasText, /featherCumulonimbusBottomEdge\(pixels, erodedMask/);
assert.match(cloudAtlasText, /pixels\[pixelIndex \+ 3\] = 255/);
assert.match(cloudAtlasText, /ctx\.putImageData\(imageData, 0, 0\)/);
assert.match(cloudAtlasText, /ensureParkCloudAtlas/);
assert.match(cloudAtlasText, /getParkCloudAtlasStyles/);
assert.match(cloudAtlasText, /parkCloudAtlasOpaquePixelCount/);
assert.equal(groundImage.readUInt32BE(16), 1435);
assert.equal(groundImage.readUInt32BE(20), 1096);
assert.equal(
  createHash("sha256").update(groundImage).digest("hex"),
  "64b9c73327ee7d912ad66271402ba9f2d82034144285ca754737c43050355eba",
  "park ground asset must remain byte-identical to the approved ImageGen output",
);
assert.equal(referenceImage.readUInt32BE(16), 1436);
assert.equal(referenceImage.readUInt32BE(20), 1096);
assert.equal(
  createHash("sha256").update(referenceImage).digest("hex"),
  "9a2974b347735b1c20d91fd0b7574a7cd41cb3a813f0ee5801fb57692ccb25a7",
  "park reference asset must remain byte-identical to the approved ImageGen output",
);
assert.equal(weatherBackdropMaskImage.readUInt32BE(16), 1180);
assert.equal(weatherBackdropMaskImage.readUInt32BE(20), 900);
assert.equal(weatherBackdropMaskImage.readUInt8(25), 6, "weather backdrop mask must remain RGBA");
assert.equal(
  createHash("sha256").update(weatherBackdropMaskImage).digest("hex"),
  "380b976318d0bbc6c97c43dc86f22f7c3ffcc884884e39cb208363967857b1d7",
  "pixel-audited weather backdrop mask must remain stable",
);
assert.equal(cloudAtlasImage.readUInt32BE(16), 1254);
assert.equal(cloudAtlasImage.readUInt32BE(20), 1254);
assert.equal(cloudAtlasImage.readUInt8(25), 2, "black-key cloud atlas must remain RGB");
assert.equal(
  createHash("sha256").update(cloudAtlasImage).digest("hex"),
  "eb01111594f15522e71029b9f80f25597baba273533ec30a54fa2b59a4aba899",
  "three-state ImageGen cloud atlas must remain stable",
);
assert.equal(pondAtlasImage.readUInt32BE(16), 3184);
assert.equal(pondAtlasImage.readUInt32BE(20), 4450);
assert.equal(pondAtlasImage.readUInt8(25), 6, "pond motion atlas must remain RGBA");
assert.equal(
  createHash("sha256").update(pondAtlasImage).digest("hex"),
  "cecc4276f09a39e39f9dc9524a40ebc32749f924c4727a66bb02f0780354e882",
  "prebaked pond motion atlas must remain stable",
);
for (const [name, image, expectedHash] of [
  ["black bass", blackBassImage, "6cd6e5413a4d31e1ec4e702ad2c56a6cb4c1b0c532f34fc7d386f9809c3d171e"],
  ["crucian carp", crucianCarpImage, "6b8ecb86e2c718771fac0dab5720642ff0c389ce22beb4dbc93573e29a3a9084"],
  ["bluegill", bluegillImage, "f0f24be2a4d9f4fed4ca9b37589bfbb8b16bd9db2030b4d25f75ddb8e884145b"],
  ["yellow perch", yellowPerchImage, "81e30fa804c4ceff2c72e098b6fe681b61c91c0df86a87f0e688a92b7202c693"],
  ["weather loach", weatherLoachImage, "73c79df9c94a63a48021a9c81692f4e02deb01db5f5182edcc4ba4d68cabf9d8"],
  ["rainbow trout", rainbowTroutImage, "0edacf105e43a7c66f362c82607cace35d3938e0de89c3314220ea37e4db5e7f"],
]) {
  assert.equal(image.readUInt32BE(16), 64, `${name} sprite width must remain 64px`);
  assert.equal(image.readUInt32BE(20), 40, `${name} sprite height must remain 40px`);
  assert.equal(image.readUInt8(25), 6, `${name} sprite must remain RGBA`);
  assert.equal(
    createHash("sha256").update(image).digest("hex"),
    expectedHash,
    `${name} park fish sprite must remain stable`,
  );
}

console.log("Park smoke passed: deterministic two-day weekly rain scheduling, staged weather previews, layered rain ambience and storm thunder, weather-scaled sea haze/pond ripples/grass splashes, static rock/shrub occluders, independent grass ripples, single-draw pond atlas, independent park ambience, foam and cliff-fog motion, looping clouds, handoff, traits, fish, cooking, and window size markers are present.");
