import { PARK_SCENE_HEIGHT, PARK_SCENE_WIDTH, isParkGrassPoint } from "./parkContent";
import { ensureParkCloudAtlas, getParkCloudAtlasStyles } from "./parkCloudAtlas";
import { parkCanvasSnapshotSource } from "./parkCanvasSnapshots";
import type { ParkReferenceLayers } from "./parkReferenceLayers";
import type { ParkWeatherFrame } from "./parkWeather";

export interface ParkWeatherRenderCounts {
  backDrops: number;
  frontDrops: number;
  pondRipples: number;
  grassSplashes: number;
}

export interface ParkWeatherSurfaceOptions {
  pond: boolean;
  grass: boolean;
}

const WEATHER_SURFACE_UPDATE_INTERVAL_MS = 1000 / 20;
const MAX_BACK_DROPS = 280;
const MAX_FRONT_DROPS = 170;
const MAX_POND_RIPPLES = 68;
const MAX_GRASS_SPLASHES = 172;
const MAX_RAIN_DENSITY_MULTIPLIER = 2;
const PARK_WEATHER_HAZE_TOP_Y = 0;
const PARK_RAIN_SPRITE_PHASE_COUNT = 25;
const PARK_GRASS_SPLASH_MIN_X = 109;
const PARK_GRASS_SPLASH_MIN_Y = 225;
const PARK_GRASS_SPLASH_MAX_X = 1075;
const PARK_GRASS_SPLASH_MAX_Y = 842;
const PARK_GRASS_SPLASH_WIDTH = PARK_GRASS_SPLASH_MAX_X - PARK_GRASS_SPLASH_MIN_X;
const PARK_GRASS_SPLASH_HEIGHT = PARK_GRASS_SPLASH_MAX_Y - PARK_GRASS_SPLASH_MIN_Y;
const PARK_STORM_CLOUD_FADE_RANGES = [
  { start: 0, end: 0.28 },
  { start: 0.22, end: 0.5 },
  { start: 0.54, end: 0.8 },
] as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstepRange = (value: number, start: number, end: number) => {
  const progress = clamp01((value - start) / Math.max(0.001, end - start));
  return progress * progress * (3 - 2 * progress);
};
const resolveParkRainColor = (foreground: boolean, nightStrength: number) => {
  const dayColor = foreground ? [200, 216, 220] : [169, 193, 200];
  const nightColor = foreground ? [112, 135, 158] : [88, 108, 132];
  const night = clamp01(nightStrength);
  return `rgb(${dayColor.map((channel, index) => Math.round(
    channel + ((nightColor[index] ?? channel) - channel) * night,
  )).join(", ")})`;
};
const hashUnit = (index: number, salt: number) => {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(salt + 17, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
};

interface ParkRainParticleSeed {
  delayUnit: number;
  baseXUnit: number;
  thickness: number;
}

interface ParkPondRippleSeed {
  phaseUnit: number;
  xUnit: number;
  yUnit: number;
  periodMs: number;
}

interface ParkGrassSplashSeed {
  x: number;
  y: number;
  phaseUnit: number;
  periodMs: number;
  isGrass: boolean;
}

const makeRainParticleSeeds = (
  count: number,
  salt: number,
  foreground: boolean,
): readonly ParkRainParticleSeed[] => Array.from({ length: count }, (_, index) => ({
  delayUnit: hashUnit(index, salt),
  baseXUnit: hashUnit(index, salt + 31),
  thickness: foreground && index % 7 === 0 ? 2 : 1,
}));

const PARK_RAIN_BACK_SEEDS = makeRainParticleSeeds(
  MAX_BACK_DROPS * MAX_RAIN_DENSITY_MULTIPLIER,
  19,
  false,
);
const PARK_RAIN_FRONT_SEEDS = makeRainParticleSeeds(
  MAX_FRONT_DROPS * MAX_RAIN_DENSITY_MULTIPLIER,
  83,
  true,
);
const PARK_POND_RIPPLE_SEEDS: readonly ParkPondRippleSeed[] = Array.from(
  { length: MAX_POND_RIPPLES },
  (_, index) => ({
    phaseUnit: hashUnit(index, 41),
    xUnit: hashUnit(index, 47),
    yUnit: hashUnit(index, 53),
    periodMs: 520 + index % 5 * 85,
  }),
);
const PARK_GRASS_SPLASH_SEEDS: readonly ParkGrassSplashSeed[] = Array.from(
  { length: MAX_GRASS_SPLASHES },
  (_, index) => {
    const x = 112 + hashUnit(index, 61) * 958;
    const y = 236 + hashUnit(index, 67) * 604;
    return {
      x,
      y,
      phaseUnit: hashUnit(index, 71),
      periodMs: 430 + index % 7 * 62,
      isGrass: isParkGrassPoint(x, y),
    };
  },
);

export const resolveParkRainDensityMultiplier = (
  amount: number,
) => {
  const progress = clamp01((amount - 0.52) / (0.76 - 0.52));
  return 1 + progress * progress * (3 - 2 * progress);
};

const PARK_RAIN_LENGTH_ANCHORS = [
  { amount: 0, multiplier: 1 },
  { amount: 0.09, multiplier: 1 },
  { amount: 0.28, multiplier: 1 },
  { amount: 0.52, multiplier: 2 },
  { amount: 0.76, multiplier: 4 },
  { amount: 1, multiplier: 10 },
] as const;

export const resolveParkWeatherRenderCounts = (
  weather: ParkWeatherFrame,
): ParkWeatherRenderCounts => {
  const densityMultiplier = resolveParkRainDensityMultiplier(weather.rainAmount);
  return {
    backDrops: Math.round(MAX_BACK_DROPS * weather.rainAmount * densityMultiplier),
    frontDrops: Math.round(MAX_FRONT_DROPS * weather.rainAmount * densityMultiplier),
    pondRipples: Math.round(MAX_POND_RIPPLES * weather.pondImpact),
    grassSplashes: Math.round(MAX_GRASS_SPLASHES * weather.grassSplash),
  };
};

export const resolveParkRainLineLength = (
  amount: number,
  foreground: boolean,
) => {
  const normalizedAmount = clamp01(amount);
  const rightIndex = Math.max(
    1,
    PARK_RAIN_LENGTH_ANCHORS.findIndex((anchor) => normalizedAmount <= anchor.amount),
  );
  const left = PARK_RAIN_LENGTH_ANCHORS[rightIndex - 1]!;
  const right = PARK_RAIN_LENGTH_ANCHORS[rightIndex]!;
  const span = Math.max(0.001, right.amount - left.amount);
  const progress = clamp01((normalizedAmount - left.amount) / span);
  const eased = progress * progress * (3 - 2 * progress);
  const baseLengthAt = (anchor: typeof left) => Math.round(
    (foreground ? 7 : 4) + anchor.amount * (foreground ? 10 : 7),
  ) * anchor.multiplier;
  const leftLength = baseLengthAt(left);
  const rightLength = baseLengthAt(right);
  return Math.round(leftLength + (rightLength - leftLength) * eased);
};

let seaHazeCanvas: HTMLCanvasElement | null = null;
let seaHazeKey = "";
let pondImpactCanvas: HTMLCanvasElement | null = null;
let grassSplashCanvas: HTMLCanvasElement | null = null;
let lastSurfaceUpdateAt = Number.NEGATIVE_INFINITY;
let lastSurfaceKey = "";
const stormCloudCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

const makeCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

interface ParkRainLineSprite {
  canvas: HTMLCanvasElement;
  renderedStyleKey: string;
  width: number;
}

interface ParkRainLineSpriteCache {
  entries: Map<string, ParkRainLineSprite>;
  maxLength: number;
}

const makeRainLineSpriteCache = (foreground: boolean): ParkRainLineSpriteCache => ({
  entries: new Map(),
  maxLength: resolveParkRainLineLength(1, foreground),
});

const backRainLineSpriteCache = makeRainLineSpriteCache(false);
const frontRainLineSpriteCache = makeRainLineSpriteCache(true);

const rainLinePhaseKey = (x: number) => Math.round(
  (x - Math.floor(x)) * PARK_RAIN_SPRITE_PHASE_COUNT + 1e-12,
);

const rainLineSprite = (
  cache: ParkRainLineSpriteCache,
  length: number,
  thickness: number,
  color: string,
  phaseKey: number,
) => {
  const entryKey = `${phaseKey}/${thickness}`;
  let entry = cache.entries.get(entryKey);
  if (!entry) {
    const maxWidth = Math.ceil(cache.maxLength * 0.34) + thickness + 1;
    entry = {
      canvas: makeCanvas(maxWidth, cache.maxLength),
      renderedStyleKey: "",
      width: 0,
    };
    cache.entries.set(entryKey, entry);
  }

  const styleKey = `${length}/${color}`;
  if (entry.renderedStyleKey !== styleKey) {
    entry.renderedStyleKey = styleKey;
    const sprite = entry.canvas.getContext("2d")!;
    sprite.setTransform(1, 0, 0, 1, 0, 0);
    sprite.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    sprite.imageSmoothingEnabled = false;
    sprite.fillStyle = color;
    const representativePhase = phaseKey / PARK_RAIN_SPRITE_PHASE_COUNT;
    let maxX = 0;
    for (let step = 0; step < length; step += 2) {
      const drawX = Math.round(representativePhase + step * 0.34);
      sprite.fillRect(drawX, step, thickness, 2);
      maxX = Math.max(maxX, drawX + thickness);
    }
    entry.width = maxX;
  }
  return entry;
};

const stormCloudSprite = (source: HTMLCanvasElement) => {
  const cached = stormCloudCache.get(source);
  if (cached) return cached;
  const canvas = makeCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "#344555";
  ctx.globalAlpha = 0.72;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "#71818a";
  ctx.globalAlpha = 0.12;
  ctx.fillRect(0, 0, canvas.width, Math.max(1, Math.round(canvas.height * 0.38)));
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  stormCloudCache.set(source, canvas);
  return canvas;
};

export const drawParkWeatherSky = (
  ctx: CanvasRenderingContext2D,
  weather: ParkWeatherFrame,
  nowMs: number,
) => {
  if (weather.cloudCover <= 0.002) return;
  const cover = clamp01(weather.cloudCover);
  ctx.save();
  const gradient = ctx.createLinearGradient(0, 0, 0, 245);
  gradient.addColorStop(0, `rgba(31, 44, 58, ${0.34 * cover})`);
  gradient.addColorStop(0.62, `rgba(53, 68, 78, ${0.48 * cover})`);
  gradient.addColorStop(1, `rgba(87, 101, 106, ${0.22 * cover})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, PARK_SCENE_WIDTH, 245);

  ensureParkCloudAtlas();
  const styles = getParkCloudAtlasStyles().slice(0, 3);
  if (styles.length > 0) {
    ctx.imageSmoothingEnabled = false;
    for (
      let lane = 0;
      lane < Math.min(styles.length, PARK_STORM_CLOUD_FADE_RANGES.length);
      lane += 1
    ) {
      const fadeRange = PARK_STORM_CLOUD_FADE_RANGES[lane]!;
      const lanePresence = smoothstepRange(cover, fadeRange.start, fadeRange.end);
      if (lanePresence <= 0.002) continue;
      const style = styles[lane % styles.length]!;
      const sprite = stormCloudSprite(style.variants.noon);
      const scale = 0.86 + lane * 0.12;
      const drawWidth = Math.round(sprite.width * scale);
      const drawHeight = Math.round(sprite.height * scale);
      const travel = PARK_SCENE_WIDTH + drawWidth + 340;
      const x = ((nowMs * (0.005 + lane * 0.0017) + lane * 487) % travel)
        - drawWidth - 170;
      const y = -22 + lane * 38;
      ctx.globalAlpha = cover * (0.46 + lane * 0.13) * lanePresence;
      ctx.drawImage(sprite, Math.round(x), y, drawWidth, drawHeight);
      ctx.drawImage(sprite, Math.round(x + travel), y, drawWidth, drawHeight);
    }
  }
  ctx.restore();
};

export const drawParkWeatherSeaHaze = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  weather: ParkWeatherFrame,
) => {
  if (weather.seaVisibility >= 0.995) return;
  const backdropMask = parkCanvasSnapshotSource(layers.weatherBackdropMask);
  const key = Math.round(weather.seaVisibility * 24).toString();
  if (!seaHazeCanvas) seaHazeCanvas = makeCanvas(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  if (key !== seaHazeKey) {
    seaHazeKey = key;
    const haze = seaHazeCanvas.getContext("2d")!;
    haze.setTransform(1, 0, 0, 1, 0, 0);
    haze.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
    const obscurity = 1 - weather.seaVisibility;
    const gradient = haze.createLinearGradient(
      0,
      PARK_WEATHER_HAZE_TOP_Y,
      0,
      PARK_SCENE_HEIGHT,
    );
    gradient.addColorStop(0, `rgba(184, 197, 197, ${0.58 * obscurity})`);
    gradient.addColorStop(0.28, `rgba(119, 139, 147, ${0.72 * obscurity})`);
    gradient.addColorStop(1, `rgba(68, 91, 105, ${0.52 * obscurity})`);
    haze.fillStyle = gradient;
    haze.fillRect(
      0,
      PARK_WEATHER_HAZE_TOP_Y,
      PARK_SCENE_WIDTH,
      PARK_SCENE_HEIGHT - PARK_WEATHER_HAZE_TOP_Y,
    );
    haze.globalCompositeOperation = "destination-in";
    haze.drawImage(backdropMask, 0, 0);
    haze.globalCompositeOperation = "source-over";
  }
  ctx.drawImage(seaHazeCanvas, 0, 0);
};

const drawRainField = (
  ctx: CanvasRenderingContext2D,
  nowMs: number,
  amount: number,
  count: number,
  seeds: readonly ParkRainParticleSeed[],
  foreground: boolean,
  nightStrength: number,
) => {
  if (count <= 0) return;
  const speed = foreground ? 0.78 : 0.46;
  const wind = 0.16 + amount * 0.13;
  const length = resolveParkRainLineLength(amount, foreground);
  const night = clamp01(nightStrength);
  const color = resolveParkRainColor(foreground, night);
  const spriteCache = foreground ? frontRainLineSpriteCache : backRainLineSpriteCache;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = ((foreground ? 0.34 : 0.25) + amount * 0.28)
    * (1 - night * 0.25);
  for (let index = 0; index < count; index += 1) {
    const seed = seeds[index]!;
    const delay = seed.delayUnit * (PARK_SCENE_HEIGHT + 220);
    const y = (nowMs * speed + delay) % (PARK_SCENE_HEIGHT + 220) - 110;
    const baseX = seed.baseXUnit * (PARK_SCENE_WIDTH + 180) - 90;
    const x = (baseX + nowMs * wind + y * 0.18) % (PARK_SCENE_WIDTH + 180) - 90;
    const phaseKey = rainLinePhaseKey(x);
    const sprite = rainLineSprite(
      spriteCache,
      length,
      seed.thickness,
      color,
      phaseKey,
    );
    ctx.drawImage(
      sprite.canvas,
      0,
      0,
      sprite.width,
      length,
      Math.floor(x),
      Math.round(y),
      sprite.width,
      length,
    );
  }
  ctx.restore();
};

export const drawParkRainBack = (
  ctx: CanvasRenderingContext2D,
  weather: ParkWeatherFrame,
  nowMs: number,
  nightStrength: number,
) => {
  const counts = resolveParkWeatherRenderCounts(weather);
  drawRainField(
    ctx,
    nowMs,
    weather.rainAmount,
    counts.backDrops,
    PARK_RAIN_BACK_SEEDS,
    false,
    nightStrength,
  );
};

export const drawParkRainForeground = (
  ctx: CanvasRenderingContext2D,
  weather: ParkWeatherFrame,
  nowMs: number,
  nightStrength: number,
) => {
  const counts = resolveParkWeatherRenderCounts(weather);
  drawRainField(
    ctx,
    nowMs,
    weather.rainAmount,
    counts.frontDrops,
    PARK_RAIN_FRONT_SEEDS,
    true,
    nightStrength,
  );
};

const updateWeatherSurfaces = (
  layers: ParkReferenceLayers,
  weather: ParkWeatherFrame,
  nowMs: number,
) => {
  const counts = resolveParkWeatherRenderCounts(weather);
  const quantizedTime = Math.floor(nowMs / WEATHER_SURFACE_UPDATE_INTERVAL_MS);
  const surfaceKey = [
    quantizedTime,
    counts.pondRipples,
    counts.grassSplashes,
    layers.pondBounds.width,
    layers.pondBounds.height,
  ].join("/");
  if (
    surfaceKey === lastSurfaceKey
    && nowMs >= lastSurfaceUpdateAt
    && nowMs - lastSurfaceUpdateAt < WEATHER_SURFACE_UPDATE_INTERVAL_MS
  ) return;
  lastSurfaceUpdateAt = nowMs;
  lastSurfaceKey = surfaceKey;

  const { pondBounds } = layers;
  if (
    !pondImpactCanvas
    || pondImpactCanvas.width !== pondBounds.width
    || pondImpactCanvas.height !== pondBounds.height
  ) {
    pondImpactCanvas = makeCanvas(pondBounds.width, pondBounds.height);
  }
  const pond = pondImpactCanvas.getContext("2d")!;
  pond.setTransform(1, 0, 0, 1, 0, 0);
  pond.clearRect(0, 0, pondBounds.width, pondBounds.height);
  pond.imageSmoothingEnabled = false;
  pond.strokeStyle = "#d9edf0";
  pond.lineWidth = 1;
  for (let index = 0; index < counts.pondRipples; index += 1) {
    const seed = PARK_POND_RIPPLE_SEEDS[index]!;
    const cycle = (nowMs / seed.periodMs + seed.phaseUnit) % 1;
    const radius = 1 + cycle * (3.5 + weather.pondImpact * 5.5);
    const x = 12 + seed.xUnit * Math.max(1, pondBounds.width - 24);
    const y = 8 + seed.yUnit * Math.max(1, pondBounds.height - 16);
    pond.globalAlpha = (1 - cycle) * (0.22 + weather.pondImpact * 0.48);
    pond.beginPath();
    pond.ellipse(Math.round(x), Math.round(y), radius * 1.7, radius * 0.62, 0, 0, Math.PI * 2);
    pond.stroke();
  }
  pond.globalAlpha = 1;
  pond.globalCompositeOperation = "destination-in";
  pond.drawImage(parkCanvasSnapshotSource(layers.pondInteriorMask), 0, 0);
  pond.globalCompositeOperation = "source-over";

  if (!grassSplashCanvas) {
    grassSplashCanvas = makeCanvas(PARK_GRASS_SPLASH_WIDTH, PARK_GRASS_SPLASH_HEIGHT);
  }
  const grass = grassSplashCanvas.getContext("2d")!;
  grass.setTransform(1, 0, 0, 1, 0, 0);
  grass.clearRect(0, 0, PARK_GRASS_SPLASH_WIDTH, PARK_GRASS_SPLASH_HEIGHT);
  grass.imageSmoothingEnabled = false;
  grass.fillStyle = "#e1eee0";
  for (let index = 0; index < counts.grassSplashes; index += 1) {
    const seed = PARK_GRASS_SPLASH_SEEDS[index]!;
    if (!seed.isGrass) continue;
    const cycle = (nowMs / seed.periodMs + seed.phaseUnit) % 1;
    if (cycle > 0.55) continue;
    const rise = Math.sin(cycle / 0.55 * Math.PI);
    grass.globalAlpha = (0.32 + weather.grassSplash * 0.58) * rise;
    const drawX = Math.round(seed.x) - PARK_GRASS_SPLASH_MIN_X;
    const drawY = Math.round(seed.y - rise * (3 + weather.grassSplash * 5))
      - PARK_GRASS_SPLASH_MIN_Y;
    grass.fillRect(drawX - 3, drawY, 3, 2);
    grass.fillRect(drawX + 2, drawY - 1, 3, 2);
    if (weather.grassSplash > 0.38) grass.fillRect(drawX, drawY - 3, 2, 3);
  }
  grass.globalAlpha = 1;
  grass.globalCompositeOperation = "destination-in";
  grass.drawImage(
    parkCanvasSnapshotSource(layers.grassRippleMask),
    PARK_GRASS_SPLASH_MIN_X,
    PARK_GRASS_SPLASH_MIN_Y,
    PARK_GRASS_SPLASH_WIDTH,
    PARK_GRASS_SPLASH_HEIGHT,
    0,
    0,
    PARK_GRASS_SPLASH_WIDTH,
    PARK_GRASS_SPLASH_HEIGHT,
  );
  grass.globalCompositeOperation = "source-over";
};

export const drawParkRainSurfaceEffects = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  weather: ParkWeatherFrame,
  nowMs: number,
  options: ParkWeatherSurfaceOptions,
) => {
  if (weather.rainAmount <= 0.002) return;
  updateWeatherSurfaces(layers, weather, nowMs);
  if (options.pond && pondImpactCanvas) {
    ctx.drawImage(pondImpactCanvas, layers.pondBounds.x, layers.pondBounds.y);
  }
  if (options.grass && grassSplashCanvas) {
    ctx.drawImage(grassSplashCanvas, PARK_GRASS_SPLASH_MIN_X, PARK_GRASS_SPLASH_MIN_Y);
  }
};

export const applyParkWeatherGrade = (
  ctx: CanvasRenderingContext2D,
  weather: ParkWeatherFrame,
) => {
  const strength = clamp01(weather.cloudCover * 0.42 + weather.rainAmount * 0.18);
  if (strength <= 0.002) return;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = strength;
  ctx.fillStyle = "#617181";
  ctx.fillRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  ctx.restore();
};
