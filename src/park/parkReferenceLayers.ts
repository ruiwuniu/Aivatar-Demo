import {
  isParkGrassPoint,
  PARK_REFERENCE_COLLIDERS,
  PARK_SCENE_HEIGHT,
  PARK_SCENE_WIDTH,
  type ParkObjectKind,
} from "./parkContent";

export const PARK_REFERENCE_ASSET = "/park/hilltop-park-midday-ground.png";
export const PARK_REFERENCE_STAMP_ASSET = "/park/hilltop-park-reference.png";
export const PARK_REFERENCE_SOURCE_WIDTH = 1435;
export const PARK_REFERENCE_SOURCE_HEIGHT = 1095;
const PARK_REFERENCE_STAMP_SOURCE_WIDTH = 1436;
const PARK_REFERENCE_STAMP_SOURCE_HEIGHT = 1095;

export interface ParkReferenceStamp {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

export interface ParkReferenceOccluder {
  id: string;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  depthY: number;
  opaquePixelCount: number;
}

export interface ParkShoreFoamSegment {
  id: string;
  group: ParkShoreFoamGroup;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  periodMs: number;
  phase: number;
  inhaleRatio: number;
  amplitudePx: number;
  directionX: -1 | 0 | 1;
  directionY: -1 | 0 | 1;
}

export interface ParkCliffFogSegment {
  id: string;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  periodMs: number;
  phase: number;
  amplitudeX: number;
  amplitudeY: number;
  alpha: number;
}

export interface ParkReferenceLayers {
  neutralBase: HTMLCanvasElement;
  neutralBaseWithoutDistantShoreFoamAndCliffFog: HTMLCanvasElement;
  cliffFogMotionMask: HTMLCanvasElement;
  cliffFogSegments: ParkCliffFogSegment[];
  grassRippleMask: HTMLCanvasElement;
  seaMask: HTMLCanvasElement;
  seaMotionMask: HTMLCanvasElement;
  pondInteriorMask: HTMLCanvasElement;
  pondEdgeMask: HTMLCanvasElement;
  pondRimMask: HTMLCanvasElement;
  shoreFoamInnerMask: HTMLCanvasElement;
  shoreFoamOuterMask: HTMLCanvasElement;
  shoreFoamMotionMask: HTMLCanvasElement;
  shoreFoamSegments: ParkShoreFoamSegment[];
  staticOccluders: ParkReferenceOccluder[];
  sun: ParkReferenceStamp;
  seaMaskPixels: number;
  seaMotionMaskPixels: number;
  pondMaskPixels: number;
  pondInteriorMaskPixels: number;
  pondEdgeMaskPixels: number;
  pondRimMaskPixels: number;
  shoreFoamInnerMaskPixels: number;
  shoreFoamOuterMaskPixels: number;
  distantShoreFoamMaskPixels: number;
  shoreFoamMotionMaskPixels: number;
  cliffFogMaskPixels: number;
  cliffFogMotionMaskPixels: number;
  grassRippleMaskPixels: number;
  grassRippleObstacleExclusionCount: number;
  stamps: Partial<Record<ParkObjectKind, ParkReferenceStamp>>;
}

export interface ParkReferenceShadowCaster {
  x: number;
  y: number;
  width: number;
  length: number;
  strength: number;
}

type StampRecipe = {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  threshold: number;
};

type OccluderPoint = { x: number; y: number };

type OccluderContour = {
  points: OccluderPoint[];
  mode?: "adaptive" | "solid";
  threshold?: number;
};

type OccluderRecipe = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depthY: number;
  threshold: number;
  minComponentPixels: number;
  contours: OccluderContour[];
};

const STAMP_RECIPES: Partial<Record<ParkObjectKind, StampRecipe>> = {
  tree: { x: 442, y: 88, width: 250, height: 242, anchorX: 134, anchorY: 225, threshold: 34 },
  flowers: { x: 510, y: 556, width: 96, height: 64, anchorX: 48, anchorY: 54, threshold: 24 },
  shrub: { x: 350, y: 640, width: 114, height: 91, anchorX: 57, anchorY: 78, threshold: 25 },
  rock: { x: 194, y: 438, width: 86, height: 64, anchorX: 43, anchorY: 56, threshold: 29 },
  bench: { x: 754, y: 267, width: 101, height: 78, anchorX: 50, anchorY: 67, threshold: 30 },
  lamp: { x: 925, y: 653, width: 55, height: 92, anchorX: 28, anchorY: 82, threshold: 33 },
};

const STATIC_OCCLUDER_RECIPES: OccluderRecipe[] = [
  {
    id: "upper-rock-flower-cluster",
    x: 360,
    y: 300,
    width: 135,
    height: 80,
    depthY: 370,
    threshold: 24,
    minComponentPixels: 7,
    contours: [
      { points: [{ x: 29, y: 33 }, { x: 35, y: 25 }, { x: 48, y: 21 }, { x: 64, y: 21 }, { x: 75, y: 27 }, { x: 76, y: 39 }, { x: 67, y: 48 }, { x: 49, y: 50 }, { x: 35, y: 44 }] },
      { points: [{ x: 77, y: 36 }, { x: 84, y: 27 }, { x: 104, y: 25 }, { x: 118, y: 32 }, { x: 122, y: 44 }, { x: 115, y: 54 }, { x: 91, y: 55 }, { x: 78, y: 48 }] },
      { threshold: 46, points: [{ x: 10, y: 51 }, { x: 20, y: 41 }, { x: 35, y: 40 }, { x: 49, y: 46 }, { x: 64, y: 49 }, { x: 82, y: 50 }, { x: 98, y: 48 }, { x: 117, y: 51 }, { x: 125, y: 57 }, { x: 119, y: 63 }, { x: 99, y: 64 }, { x: 79, y: 68 }, { x: 57, y: 67 }, { x: 36, y: 65 }, { x: 19, y: 62 }, { x: 9, y: 57 }] },
    ],
  },
  {
    id: "left-double-rock-cluster",
    x: 165,
    y: 430,
    width: 140,
    height: 95,
    depthY: 516,
    threshold: 24,
    minComponentPixels: 9,
    contours: [
      { points: [{ x: 35, y: 39 }, { x: 40, y: 31 }, { x: 53, y: 25 }, { x: 78, y: 25 }, { x: 93, y: 33 }, { x: 96, y: 43 }, { x: 89, y: 51 }, { x: 57, y: 56 }, { x: 42, y: 48 }] },
      { points: [{ x: 27, y: 64 }, { x: 35, y: 55 }, { x: 50, y: 49 }, { x: 76, y: 50 }, { x: 90, y: 60 }, { x: 88, y: 73 }, { x: 75, y: 82 }, { x: 45, y: 83 }, { x: 30, y: 74 }] },
      { points: [{ x: 96, y: 61 }, { x: 104, y: 54 }, { x: 120, y: 56 }, { x: 132, y: 65 }, { x: 131, y: 75 }, { x: 119, y: 82 }, { x: 103, y: 77 }] },
    ],
  },
  {
    id: "middle-single-rock",
    x: 570,
    y: 455,
    width: 90,
    height: 67,
    depthY: 515,
    threshold: 25,
    minComponentPixels: 7,
    contours: [
      { points: [{ x: 20, y: 40 }, { x: 24, y: 32 }, { x: 36, y: 27 }, { x: 52, y: 27 }, { x: 64, y: 32 }, { x: 67, y: 41 }, { x: 60, y: 50 }, { x: 35, y: 53 }, { x: 23, y: 47 }] },
      { threshold: 46, points: [{ x: 15, y: 50 }, { x: 26, y: 45 }, { x: 38, y: 50 }, { x: 53, y: 50 }, { x: 68, y: 47 }, { x: 78, y: 51 }, { x: 76, y: 57 }, { x: 61, y: 60 }, { x: 29, y: 59 }, { x: 17, y: 55 }] },
    ],
  },
  {
    id: "middle-white-flower-shrub",
    x: 505,
    y: 550,
    width: 125,
    height: 80,
    depthY: 622,
    threshold: 20,
    minComponentPixels: 6,
    contours: [
      { mode: "solid", points: [{ x: 22, y: 60 }, { x: 30, y: 50 }, { x: 43, y: 46 }, { x: 55, y: 40 }, { x: 70, y: 43 }, { x: 84, y: 42 }, { x: 96, y: 47 }, { x: 108, y: 53 }, { x: 110, y: 63 }, { x: 102, y: 70 }, { x: 89, y: 75 }, { x: 70, y: 77 }, { x: 51, y: 73 }, { x: 34, y: 69 }] },
    ],
  },
  {
    id: "lower-pink-flower-shrub",
    x: 340,
    y: 620,
    width: 155,
    height: 110,
    depthY: 716,
    threshold: 20,
    minComponentPixels: 7,
    contours: [
      { mode: "solid", points: [{ x: 18, y: 67 }, { x: 22, y: 51 }, { x: 34, y: 42 }, { x: 40, y: 25 }, { x: 58, y: 17 }, { x: 72, y: 16 }, { x: 84, y: 24 }, { x: 97, y: 21 }, { x: 108, y: 30 }, { x: 117, y: 45 }, { x: 130, y: 50 }, { x: 137, y: 63 }, { x: 132, y: 78 }, { x: 119, y: 88 }, { x: 100, y: 92 }, { x: 83, y: 98 }, { x: 61, y: 91 }, { x: 42, y: 94 }, { x: 27, y: 82 }] },
    ],
  },
];

export const PARK_REFERENCE_SHADOW_CASTERS: ParkReferenceShadowCaster[] = [
  { x: 803, y: 321, width: 54, length: 62, strength: 0.48 },
  { x: 410, y: 346, width: 42, length: 52, strength: 0.46 },
  { x: 892, y: 382, width: 48, length: 58, strength: 0.48 },
  { x: 230, y: 487, width: 50, length: 58, strength: 0.5 },
  { x: 614, y: 500, width: 42, length: 52, strength: 0.45 },
  { x: 438, y: 688, width: 55, length: 58, strength: 0.42 },
  { x: 555, y: 604, width: 48, length: 48, strength: 0.38 },
];

let cachedLayers: ParkReferenceLayers | null = null;
let loadingStarted = false;

const newCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const colorDistance = (
  red: number,
  green: number,
  blue: number,
  background: [number, number, number],
) => Math.hypot(red - background[0], green - background[1], blue - background[2]);

const edgeColorForRow = (pixels: Uint8ClampedArray, width: number, row: number) => {
  let red = 0;
  let green = 0;
  let blue = 0;
  let samples = 0;
  const edgeWidth = Math.max(2, Math.min(7, Math.floor(width / 8)));
  for (let x = 0; x < width; x += 1) {
    if (x >= edgeWidth && x < width - edgeWidth) continue;
    const offset = (row * width + x) * 4;
    red += pixels[offset] ?? 0;
    green += pixels[offset + 1] ?? 0;
    blue += pixels[offset + 2] ?? 0;
    samples += 1;
  }
  return [red / samples, green / samples, blue / samples] as [number, number, number];
};

const makeStamp = (source: HTMLCanvasElement, recipe: StampRecipe): ParkReferenceStamp | null => {
  const canvas = newCanvas(recipe.width, recipe.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source,
    recipe.x,
    recipe.y,
    recipe.width,
    recipe.height,
    0,
    0,
    recipe.width,
    recipe.height,
  );
  const image = ctx.getImageData(0, 0, recipe.width, recipe.height);
  for (let y = 0; y < recipe.height; y += 1) {
    const background = edgeColorForRow(image.data, recipe.width, y);
    for (let x = 0; x < recipe.width; x += 1) {
      const offset = (y * recipe.width + x) * 4;
      const distance = colorDistance(
        image.data[offset] ?? 0,
        image.data[offset + 1] ?? 0,
        image.data[offset + 2] ?? 0,
        background,
      );
      image.data[offset + 3] = Math.round(
        Math.max(0, Math.min(1, (distance - recipe.threshold) / 24)) * 255,
      );
    }
  }
  ctx.clearRect(0, 0, recipe.width, recipe.height);
  ctx.putImageData(image, 0, 0);
  return {
    canvas,
    width: recipe.width,
    height: recipe.height,
    anchorX: recipe.anchorX,
    anchorY: recipe.anchorY,
  };
};

const makeSunStamp = (source: HTMLCanvasElement): ParkReferenceStamp => {
  const x = 36;
  const y = 56;
  const width = 70;
  const height = 58;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    const solar = Math.max(0, Math.min(1, (red + green - blue - 300) / 95));
    image.data[offset + 3] = Math.round(solar * 255);
  }
  ctx.clearRect(0, 0, width, height);
  ctx.putImageData(image, 0, 0);
  return { canvas, width, height, anchorX: 35, anchorY: 29 };
};

const insideEllipse = (
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
) => {
  const dx = (x - centerX) / radiusX;
  const dy = (y - centerY) / radiusY;
  return Math.max(0, 1 - dx * dx - dy * dy);
};

const smoothFeather = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
};

const pointInsideContour = (
  x: number,
  y: number,
  contour: OccluderContour,
) => {
  let inside = false;
  for (let index = 0, previous = contour.points.length - 1; index < contour.points.length; previous = index, index += 1) {
    const currentPoint = contour.points[index]!;
    const previousPoint = contour.points[previous]!;
    const crosses = (currentPoint.y > y) !== (previousPoint.y > y)
      && x < ((previousPoint.x - currentPoint.x) * (y - currentPoint.y))
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const occluderContourAt = (
  x: number,
  y: number,
  contours: OccluderContour[],
) => contours.find((contour) => pointInsideContour(x + 0.5, y + 0.5, contour));

const makeStaticOccluder = (
  source: HTMLCanvasElement,
  recipe: OccluderRecipe,
): ParkReferenceOccluder => {
  const canvas = newCanvas(recipe.width, recipe.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source,
    recipe.x,
    recipe.y,
    recipe.width,
    recipe.height,
    0,
    0,
    recipe.width,
    recipe.height,
  );
  const image = ctx.getImageData(0, 0, recipe.width, recipe.height);
  const extractedAlpha = new Uint8ClampedArray(recipe.width * recipe.height);
  for (let y = 0; y < recipe.height; y += 1) {
    const background = edgeColorForRow(image.data, recipe.width, y);
    for (let x = 0; x < recipe.width; x += 1) {
      const pixelIndex = y * recipe.width + x;
      const offset = pixelIndex * 4;
      const contour = occluderContourAt(x, y, recipe.contours);
      if (!contour) continue;
      if (contour.mode === "solid") {
        extractedAlpha[pixelIndex] = 255;
        continue;
      }
      const distance = colorDistance(
        image.data[offset] ?? 0,
        image.data[offset + 1] ?? 0,
        image.data[offset + 2] ?? 0,
        background,
      );
      const subject = smoothFeather((distance - (contour.threshold ?? recipe.threshold)) / 12);
      extractedAlpha[pixelIndex] = Math.round(subject * 255);
    }
  }

  const connectedPixels = new Uint8Array(recipe.width * recipe.height);
  const visitedPixels = new Uint8Array(recipe.width * recipe.height);
  const neighbours = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ] as const;
  for (let startY = 0; startY < recipe.height; startY += 1) {
    for (let startX = 0; startX < recipe.width; startX += 1) {
      const startIndex = startY * recipe.width + startX;
      if (visitedPixels[startIndex] || (extractedAlpha[startIndex] ?? 0) < 64) continue;
      const component: number[] = [];
      const queue = [startIndex];
      visitedPixels[startIndex] = 1;
      for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const pixelIndex = queue[queueIndex]!;
        component.push(pixelIndex);
        const x = pixelIndex % recipe.width;
        const y = Math.floor(pixelIndex / recipe.width);
        neighbours.forEach(([deltaX, deltaY]) => {
          const sampleX = x + deltaX;
          const sampleY = y + deltaY;
          if (sampleX < 0 || sampleX >= recipe.width || sampleY < 0 || sampleY >= recipe.height) return;
          const sampleIndex = sampleY * recipe.width + sampleX;
          if (visitedPixels[sampleIndex] || (extractedAlpha[sampleIndex] ?? 0) < 64) return;
          visitedPixels[sampleIndex] = 1;
          queue.push(sampleIndex);
        });
      }
      if (component.length >= recipe.minComponentPixels) {
        component.forEach((pixelIndex) => {
          connectedPixels[pixelIndex] = 1;
        });
      }
    }
  }

  let opaquePixelCount = 0;
  for (let y = 0; y < recipe.height; y += 1) {
    for (let x = 0; x < recipe.width; x += 1) {
      const pixelIndex = y * recipe.width + x;
      let alpha = extractedAlpha[pixelIndex] ?? 0;
      if (!connectedPixels[pixelIndex]) {
        const touchesConnectedPixel = alpha >= 24 && neighbours.some(([deltaX, deltaY]) => {
          const sampleX = x + deltaX;
          const sampleY = y + deltaY;
          return sampleX >= 0
            && sampleX < recipe.width
            && sampleY >= 0
            && sampleY < recipe.height
            && connectedPixels[sampleY * recipe.width + sampleX] === 1;
        });
        if (!touchesConnectedPixel) alpha = 0;
      }
      image.data[pixelIndex * 4 + 3] = alpha;
      if (alpha > 24) opaquePixelCount += 1;
    }
  }
  ctx.clearRect(0, 0, recipe.width, recipe.height);
  ctx.putImageData(image, 0, 0);
  return {
    id: recipe.id,
    canvas,
    x: recipe.x,
    y: recipe.y,
    depthY: recipe.depthY,
    opaquePixelCount,
  };
};

const makeNeutralBase = (source: HTMLCanvasElement) => {
  const canvas = newCanvas(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);

  for (let y = 0; y < 122; y += 1) {
    for (let x = 0; x < PARK_SCENE_WIDTH; x += 1) {
      image.data[(y * PARK_SCENE_WIDTH + x) * 4 + 3] = 0;
    }
  }

  let previousSeaNeutral: [number, number, number] | null = null;
  for (let y = 122; y < 330; y += 1) {
    const samples: Array<[number, number, number]> = [];
    for (let x = 250; x < 960; x += 3) {
      const offset = (y * PARK_SCENE_WIDTH + x) * 4;
      const red = image.data[offset] ?? 0;
      const green = image.data[offset + 1] ?? 0;
      const blue = image.data[offset + 2] ?? 0;
      if (blue > red + 7 && blue >= green - 4) samples.push([red, green, blue]);
    }
    const sampledNeutral = samples.length > 0
      ? samples.reduce(
          (sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]] as [number, number, number],
          [0, 0, 0] as [number, number, number],
        ).map((value) => value / samples.length) as [number, number, number]
      : null;
    if (sampledNeutral) {
      previousSeaNeutral = previousSeaNeutral
        ? previousSeaNeutral.map(
            (value, index) => value + (sampledNeutral[index]! - value) * 0.12,
          ) as [number, number, number]
        : sampledNeutral;
    }
    const neutral = previousSeaNeutral;
    if (!neutral) continue;
    const topFeather = smoothFeather((y - 122) / 72);
    const bottomFeather = 1 - smoothFeather((y - 242) / 88);
    for (let x = 0; x < 360; x += 1) {
      const offset = (y * PARK_SCENE_WIDTH + x) * 4;
      const red = image.data[offset] ?? 0;
      const green = image.data[offset + 1] ?? 0;
      const blue = image.data[offset + 2] ?? 0;
      const brightness = (red + green + blue) / 3;
      const neutralBrightness = (neutral[0] + neutral[1] + neutral[2]) / 3;
      const solarWeight = Math.max(
        0,
        Math.min(1, (brightness - neutralBrightness + Math.max(0, red - blue) * 0.7) / 55),
      );
      const rightFeather = 1 - smoothFeather((x - 120) / 240);
      const blendedSolarWeight = solarWeight * topFeather * bottomFeather * rightFeather;
      if (blendedSolarWeight <= 0) continue;
      const texture = ((x * 13 + y * 7) % 9) - 4;
      const neutralTargetBrightness = (neutral[0] + neutral[1] + neutral[2]) / 3 + texture;
      const brightnessCorrection = brightness - neutralTargetBrightness;
      const targetRed = Math.max(0, Math.min(255, neutral[0] + texture + brightnessCorrection));
      const targetGreen = Math.max(0, Math.min(255, neutral[1] + texture + brightnessCorrection));
      const targetBlue = Math.max(0, Math.min(255, neutral[2] + texture + brightnessCorrection));
      image.data[offset] = Math.round(red + (targetRed - red) * blendedSolarWeight * 0.68);
      image.data[offset + 1] = Math.round(green + (targetGreen - green) * blendedSolarWeight * 0.68);
      image.data[offset + 2] = Math.round(blue + (targetBlue - blue) * blendedSolarWeight * 0.68);
    }
  }

  const originalShadowRegions = [
    { x: 610, y: 347, radiusX: 170, radiusY: 54 },
    { x: 308, y: 418, radiusX: 92, radiusY: 34 },
    { x: 944, y: 365, radiusX: 105, radiusY: 36 },
    { x: 844, y: 352, radiusX: 70, radiusY: 28 },
    { x: 466, y: 375, radiusX: 62, radiusY: 26 },
    { x: 274, y: 510, radiusX: 62, radiusY: 27 },
    { x: 657, y: 526, radiusX: 58, radiusY: 25 },
  ];
  originalShadowRegions.forEach((region) => {
    const minX = Math.max(0, Math.floor(region.x - region.radiusX));
    const maxX = Math.min(PARK_SCENE_WIDTH - 1, Math.ceil(region.x + region.radiusX));
    const minY = Math.max(122, Math.floor(region.y - region.radiusY));
    const maxY = Math.min(PARK_SCENE_HEIGHT - 1, Math.ceil(region.y + region.radiusY));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const weight = insideEllipse(x, y, region.x, region.y, region.radiusX, region.radiusY);
        if (weight <= 0) continue;
        const offset = (y * PARK_SCENE_WIDTH + x) * 4;
        const red = image.data[offset] ?? 0;
        const green = image.data[offset + 1] ?? 0;
        const blue = image.data[offset + 2] ?? 0;
        const grassLike = green > red * 1.04 && green > blue * 1.03;
        if (!grassLike) continue;
        const lift = weight * 0.32;
        image.data[offset] = Math.round(red + (Math.min(180, red * 1.42 + 14) - red) * lift);
        image.data[offset + 1] = Math.round(green + (Math.min(195, green * 1.34 + 10) - green) * lift);
        image.data[offset + 2] = Math.round(blue + (Math.min(120, blue * 1.22 + 6) - blue) * lift);
      }
    }
  });

  ctx.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  ctx.putImageData(image, 0, 0);
  return canvas;
};

const PARK_OCEAN_TOP = 122;
const PARK_OCEAN_BOTTOM = 430;
type ParkMaskPoint = readonly [number, number];

type ParkShoreFoamGroup =
  | "left-island"
  | "left-coast-upper"
  | "left-coast-lower"
  | "center-island"
  | "right-island-upper"
  | "right-island-lower";

type ParkShoreFoamBand = {
  id: string;
  group: ParkShoreFoamGroup;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  directionX: -1 | 0 | 1;
  directionY: -1 | 0 | 1;
  splitIntoComponents?: boolean;
};

// These are deliberately narrow water-side sample bands traced from the
// authored white/cyan surf. They are not filled rectangles: source pixels
// still have to pass the foam colour and water-side contrast tests below.
// Keeping the six annotated shoreline groups explicit prevents open-ocean
// glints and yellow/grey island highlights from entering the moving layer.
const PARK_DISTANT_SHORE_FOAM_BANDS: readonly ParkShoreFoamBand[] = [
  { id: "left-island-1", group: "left-island", minX: 0, minY: 241, maxX: 13, maxY: 244, directionX: 0, directionY: 1 },
  { id: "left-island-2", group: "left-island", minX: 15, minY: 243, maxX: 44, maxY: 250, directionX: 0, directionY: 1 },
  { id: "left-island-3", group: "left-island", minX: 45, minY: 239, maxX: 76, maxY: 248, directionX: 0, directionY: 1 },
  { id: "left-upper-1", group: "left-coast-upper", minX: 151, minY: 256, maxX: 201, maxY: 270, directionX: 1, directionY: -1 },
  { id: "left-upper-2", group: "left-coast-upper", minX: 133, minY: 268, maxX: 169, maxY: 278, directionX: 1, directionY: -1 },
  { id: "left-upper-3", group: "left-coast-upper", minX: 112, minY: 274, maxX: 133, maxY: 281, directionX: 1, directionY: -1 },
  { id: "left-upper-4", group: "left-coast-upper", minX: 81, minY: 279, maxX: 120, maxY: 295, directionX: 1, directionY: -1 },
  { id: "left-upper-5", group: "left-coast-upper", minX: 66, minY: 293, maxX: 101, maxY: 302, directionX: 1, directionY: -1 },
  { id: "left-upper-6", group: "left-coast-upper", minX: 77, minY: 302, maxX: 97, maxY: 315, directionX: 1, directionY: -1 },
  { id: "left-lower-1", group: "left-coast-lower", minX: 145, minY: 329, maxX: 183, maxY: 352, directionX: 1, directionY: -1 },
  { id: "left-lower-2", group: "left-coast-lower", minX: 117, minY: 350, maxX: 143, maxY: 363, directionX: 1, directionY: -1 },
  { id: "left-lower-3", group: "left-coast-lower", minX: 102, minY: 360, maxX: 122, maxY: 369, directionX: 1, directionY: -1 },
  { id: "left-lower-4", group: "left-coast-lower", minX: 84, minY: 368, maxX: 98, maxY: 377, directionX: 1, directionY: -1 },
  // The user's three annotated left-coast regions also contain secondary,
  // parallel surf strokes farther from the land edge. Keep these wider
  // regions explicit and split their accepted pixels into separate lines so
  // the extra surf breathes independently instead of moving as one block.
  { id: "left-island-secondary", group: "left-island", minX: 0, minY: 225, maxX: 100, maxY: 260, directionX: 0, directionY: 1, splitIntoComponents: true },
  { id: "left-upper-secondary", group: "left-coast-upper", minX: 45, minY: 250, maxX: 235, maxY: 335, directionX: 1, directionY: -1, splitIntoComponents: true },
  { id: "left-lower-secondary", group: "left-coast-lower", minX: 60, minY: 325, maxX: 270, maxY: 420, directionX: 1, directionY: -1, splitIntoComponents: true },
  { id: "center-island-1", group: "center-island", minX: 306, minY: 230, maxX: 327, maxY: 241, directionX: 0, directionY: 1 },
  { id: "center-island-2", group: "center-island", minX: 318, minY: 236, maxX: 376, maxY: 247, directionX: 0, directionY: 1 },
  { id: "center-island-3", group: "center-island", minX: 370, minY: 235, maxX: 429, maxY: 245, directionX: 0, directionY: 1 },
  { id: "center-island-4", group: "center-island", minX: 408, minY: 230, maxX: 431, maxY: 238, directionX: 1, directionY: 1 },
  { id: "center-island-5", group: "center-island", minX: 429, minY: 222, maxX: 455, maxY: 233, directionX: 1, directionY: 1 },
  { id: "right-upper-1", group: "right-island-upper", minX: 1096, minY: 253, maxX: 1135, maxY: 269, directionX: -1, directionY: 1 },
  { id: "right-upper-2", group: "right-island-upper", minX: 1129, minY: 269, maxX: 1146, maxY: 279, directionX: -1, directionY: 1 },
  { id: "right-upper-3", group: "right-island-upper", minX: 1143, minY: 273, maxX: 1175, maxY: 284, directionX: -1, directionY: 1 },
  { id: "right-upper-4", group: "right-island-upper", minX: 1163, minY: 282, maxX: 1179, maxY: 293, directionX: -1, directionY: 1 },
  { id: "right-lower-1", group: "right-island-lower", minX: 1142, minY: 312, maxX: 1177, maxY: 329, directionX: -1, directionY: 1 },
  { id: "right-lower-2", group: "right-island-lower", minX: 1163, minY: 314, maxX: 1179, maxY: 334, directionX: -1, directionY: 1 },
] as const;

// These silhouettes deliberately sit just inside the authored land edges.
// The colour classifier remains useful for preserving pixel-scale water
// texture, while these fixed exclusions prevent blue-grey cliffs and islands
// from ever joining the connected ocean component.
const PARK_OCEAN_LAND_EXCLUSIONS: readonly (readonly ParkMaskPoint[])[] = [
  [
    [270, 430], [278, 365], [300, 340], [330, 315], [365, 292], [410, 267],
    [460, 244], [510, 220], [570, 205], [630, 210], [685, 238], [735, 266],
    [790, 293], [845, 317], [905, 335], [970, 350], [1040, 365], [1105, 378],
    [1180, 390], [1180, 430],
  ],
  [
    [0, 242], [35, 232], [80, 240], [125, 258], [165, 280], [200, 310],
    [230, 340], [255, 370], [220, 405], [0, 410],
  ],
  [[0, 202], [28, 202], [58, 214], [82, 230], [62, 242], [18, 240], [0, 234]],
  [
    [310, 222], [338, 210], [370, 207], [400, 214], [430, 226], [450, 240],
    [425, 254], [375, 253], [335, 246], [315, 236],
  ],
  [[1105, 251], [1135, 240], [1180, 245], [1180, 312], [1145, 307], [1118, 287]],
] as const;

const pointInsidePolygon = (x: number, y: number, polygon: readonly ParkMaskPoint[]) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [currentX, currentY] = polygon[index]!;
    const [previousX, previousY] = polygon[previous]!;
    const crosses = (currentY > y) !== (previousY > y)
      && x < (previousX - currentX) * (y - currentY) / (previousY - currentY) + currentX;
    if (crosses) inside = !inside;
  }
  return inside;
};

type ParkCliffFogBand = {
  id: string;
  polygon: readonly ParkMaskPoint[];
  periodMs: number;
  phase: number;
  amplitudeX: number;
  amplitudeY: number;
  alpha: number;
};

// Three narrow valley-side polygons follow the authored mist below the west
// cliff. Their right edges stop before the rock face, so drifting pixels stay
// behind the cliff instead of washing over the playable plateau.
const PARK_CLIFF_FOG_BANDS: readonly ParkCliffFogBand[] = [
  {
    id: "upper-cliff-fog",
    polygon: [[0, 435], [103, 435], [126, 462], [122, 500], [96, 530], [0, 537]],
    periodMs: 46_000,
    phase: 0.35,
    amplitudeX: 12,
    amplitudeY: 1.25,
    alpha: 0.98,
  },
  {
    id: "middle-cliff-fog",
    polygon: [[0, 590], [72, 590], [96, 614], [95, 650], [72, 681], [0, 690]],
    periodMs: 58_000,
    phase: 2.2,
    amplitudeX: 9,
    amplitudeY: 1,
    alpha: 0.96,
  },
  {
    id: "lower-cliff-fog",
    polygon: [[0, 746], [72, 746], [104, 774], [110, 810], [88, 844], [0, 852]],
    periodMs: 52_000,
    phase: 4.1,
    amplitudeX: 5,
    amplitudeY: 1.5,
    alpha: 0.97,
  },
] as const;
const PARK_CLIFF_FOG_FEATHER_RADIUS = 4;

const makeLandExclusionMask = (
  polygons: readonly (readonly ParkMaskPoint[])[] = PARK_OCEAN_LAND_EXCLUSIONS,
) => {
  const mask = new Uint8Array(PARK_SCENE_WIDTH * PARK_SCENE_HEIGHT);
  polygons.forEach((polygon) => {
    const minX = Math.max(0, Math.floor(Math.min(...polygon.map(([x]) => x))));
    const maxX = Math.min(PARK_SCENE_WIDTH - 1, Math.ceil(Math.max(...polygon.map(([x]) => x))));
    const minY = Math.max(PARK_OCEAN_TOP, Math.floor(Math.min(...polygon.map(([, y]) => y))));
    const maxY = Math.min(PARK_OCEAN_BOTTOM - 1, Math.ceil(Math.max(...polygon.map(([, y]) => y))));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (pointInsidePolygon(x + 0.5, y + 0.5, polygon)) {
          mask[y * PARK_SCENE_WIDTH + x] = 255;
        }
      }
    }
  });
  return mask;
};

const makeMaskCanvas = (values: Uint8Array) => {
  const canvas = newCanvas(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  for (let index = 0; index < values.length; index += 1) {
    const alpha = values[index] ?? 0;
    if (alpha === 0) continue;
    const offset = index * 4;
    image.data[offset] = 255;
    image.data[offset + 1] = 255;
    image.data[offset + 2] = 255;
    image.data[offset + 3] = alpha;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

const makeShoreFoamSegments = (
  values: Uint8Array,
  sourceImage: ImageData,
): ParkShoreFoamSegment[] => {
  const assigned = new Uint8Array(values.length);
  const segments: ParkShoreFoamSegment[] = [];
  const hashRhythm = (seed: number, salt: number) => {
    let value = (seed ^ salt) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    return (value ^ (value >>> 16)) >>> 0;
  };
  const appendSegment = (
    band: ParkShoreFoamBand,
    bandIndex: number,
    componentIndex: number | null,
    pixels: number[],
  ) => {
    let minX = PARK_SCENE_WIDTH;
    let maxX = -1;
    let minY = PARK_SCENE_HEIGHT;
    let maxY = -1;
    pixels.forEach((index) => {
      const x = index % PARK_SCENE_WIDTH;
      const y = Math.floor(index / PARK_SCENE_WIDTH);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });
    if (pixels.length === 0 || maxX < minX || maxY < minY) return;

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const canvas = newCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(width, height);
    pixels.forEach((index) => {
      const x = index % PARK_SCENE_WIDTH;
      const y = Math.floor(index / PARK_SCENE_WIDTH);
      const sourceOffset = index * 4;
      const offset = ((y - minY) * width + x - minX) * 4;
      image.data[offset] = sourceImage.data[sourceOffset] ?? 255;
      image.data[offset + 1] = sourceImage.data[sourceOffset + 1] ?? 255;
      image.data[offset + 2] = sourceImage.data[sourceOffset + 2] ?? 255;
      image.data[offset + 3] = sourceImage.data[sourceOffset + 3] ?? 255;
    });
    ctx.putImageData(image, 0, 0);

    const seed = minX * 17
      + minY * 29
      + pixels.length * 47
      + bandIndex * 101
      + (componentIndex ?? 0) * 313;
    const periodHash = hashRhythm(seed, 0x165667b1);
    const phaseHash = hashRhythm(seed, 0xd3a2646c);
    const inhaleHash = hashRhythm(seed, 0xfd7046c5);
    const amplitudeHash = hashRhythm(seed, 0xb55a4f09);
    segments.push({
      id: componentIndex === null ? band.id : `${band.id}-${componentIndex + 1}`,
      group: band.group,
      canvas,
      x: minX,
      y: minY,
      periodMs: 3400 + (periodHash % 1601),
      phase: phaseHash / 0x1_0000_0000 * Math.PI * 2,
      inhaleRatio: 0.54 + inhaleHash / 0x1_0000_0000 * 0.06,
      amplitudePx: 1.8 + amplitudeHash / 0x1_0000_0000 * 0.45,
      directionX: band.directionX,
      directionY: band.directionY,
    });
  };

  PARK_DISTANT_SHORE_FOAM_BANDS.forEach((band, bandIndex) => {
    if (!band.splitIntoComponents) {
      const pixels: number[] = [];
      for (let y = band.minY; y <= Math.min(band.maxY, PARK_SCENE_HEIGHT - 1); y += 1) {
        for (let x = band.minX; x <= Math.min(band.maxX, PARK_SCENE_WIDTH - 1); x += 1) {
          const index = y * PARK_SCENE_WIDTH + x;
          if (values[index] === 0 || assigned[index] !== 0) continue;
          assigned[index] = 1;
          pixels.push(index);
        }
      }
      appendSegment(band, bandIndex, null, pixels);
      return;
    }

    let componentIndex = 0;
    for (let y = band.minY; y <= Math.min(band.maxY, PARK_SCENE_HEIGHT - 1); y += 1) {
      for (let x = band.minX; x <= Math.min(band.maxX, PARK_SCENE_WIDTH - 1); x += 1) {
        const seedIndex = y * PARK_SCENE_WIDTH + x;
        if (values[seedIndex] === 0 || assigned[seedIndex] !== 0) continue;

        const pixels: number[] = [];
        const queue = [seedIndex];
        assigned[seedIndex] = 1;
        for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
          const index = queue[queueIndex]!;
          const pixelX = index % PARK_SCENE_WIDTH;
          const pixelY = Math.floor(index / PARK_SCENE_WIDTH);
          pixels.push(index);
          for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
            const nextY = pixelY + deltaY;
            if (nextY < band.minY || nextY > band.maxY) continue;
            for (let deltaX = -3; deltaX <= 3; deltaX += 1) {
              if (deltaX === 0 && deltaY === 0) continue;
              const nextX = pixelX + deltaX;
              if (nextX < band.minX || nextX > band.maxX) continue;
              const nextIndex = nextY * PARK_SCENE_WIDTH + nextX;
              if (values[nextIndex] === 0 || assigned[nextIndex] !== 0) continue;
              assigned[nextIndex] = 1;
              queue.push(nextIndex);
            }
          }
        }
        appendSegment(band, bandIndex, componentIndex, pixels);
        componentIndex += 1;
      }
    }
  });

  return segments;
};

const makeBaseWithoutDistantShoreFoam = (
  sourceImage: ImageData,
  distantShoreFoam: Uint8Array,
  connectedSea: Uint8Array,
) => {
  const canvas = newCanvas(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const ctx = canvas.getContext("2d")!;
  const cleaned = ctx.createImageData(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  cleaned.data.set(sourceImage.data);

  // Remove only the selected distant foam pixels from this derived canvas.
  // Nearby connected-water pixels provide the replacement colour, so the
  // source PNG and every land/island pixel remain untouched.
  for (let y = PARK_OCEAN_TOP; y < PARK_OCEAN_BOTTOM; y += 1) {
    for (let x = 0; x < PARK_SCENE_WIDTH; x += 1) {
      const index = y * PARK_SCENE_WIDTH + x;
      if (distantShoreFoam[index] === 0) continue;
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      let weightTotal = 0;
      for (let dy = -6; dy <= 6; dy += 1) {
        const sampleY = y + dy;
        if (sampleY < PARK_OCEAN_TOP || sampleY >= PARK_OCEAN_BOTTOM) continue;
        for (let dx = -6; dx <= 6; dx += 1) {
          const distance = Math.abs(dx) + Math.abs(dy);
          if (distance === 0 || distance > 6) continue;
          const sampleX = x + dx;
          if (sampleX < 0 || sampleX >= PARK_SCENE_WIDTH) continue;
          const sampleIndex = sampleY * PARK_SCENE_WIDTH + sampleX;
          if (connectedSea[sampleIndex] === 0 || distantShoreFoam[sampleIndex] !== 0) continue;
          const sampleOffset = sampleIndex * 4;
          const red = sourceImage.data[sampleOffset] ?? 0;
          const green = sourceImage.data[sampleOffset + 1] ?? 0;
          const blue = sourceImage.data[sampleOffset + 2] ?? 0;
          const brightness = (red + green + blue) / 3;
          const highlightPenalty = brightness > 190 ? 0.18 : 1;
          const weight = highlightPenalty / (1 + distance);
          redTotal += red * weight;
          greenTotal += green * weight;
          blueTotal += blue * weight;
          weightTotal += weight;
        }
      }
      if (weightTotal <= 0) continue;
      const offset = index * 4;
      cleaned.data[offset] = Math.round(redTotal / weightTotal);
      cleaned.data[offset + 1] = Math.round(greenTotal / weightTotal);
      cleaned.data[offset + 2] = Math.round(blueTotal / weightTotal);
      cleaned.data[offset + 3] = 255;
    }
  }

  ctx.putImageData(cleaned, 0, 0);
  return canvas;
};

const makeCliffFogLayers = (sourceBase: HTMLCanvasElement) => {
  const source = sourceBase.getContext("2d", { willReadFrequently: true })!;
  const sourceImage = source.getImageData(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const pixelCount = PARK_SCENE_WIDTH * PARK_SCENE_HEIGHT;
  const fogPixels = new Uint8Array(pixelCount);
  const fogAlphaPixels = new Uint8Array(pixelCount);
  const motionPixels = new Uint8Array(pixelCount);
  const cleaned = newCanvas(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const cleanedContext = cleaned.getContext("2d")!;
  const cleanedImage = cleanedContext.createImageData(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  cleanedImage.data.set(sourceImage.data);
  const segments: ParkCliffFogSegment[] = [];
  const allFogPixels: number[] = [];

  PARK_CLIFF_FOG_BANDS.forEach((band) => {
    const minX = Math.max(0, Math.floor(Math.min(...band.polygon.map(([x]) => x))));
    const maxX = Math.min(
      PARK_SCENE_WIDTH - 1,
      Math.ceil(Math.max(...band.polygon.map(([x]) => x))),
    );
    const minY = Math.max(0, Math.floor(Math.min(...band.polygon.map(([, y]) => y))));
    const maxY = Math.min(
      PARK_SCENE_HEIGHT - 1,
      Math.ceil(Math.max(...band.polygon.map(([, y]) => y))),
    );
    const candidates = new Uint8Array(pixelCount);
    const seeds = new Uint8Array(pixelCount);
    const visited = new Uint8Array(pixelCount);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!pointInsidePolygon(x + 0.5, y + 0.5, band.polygon)) continue;
        const index = y * PARK_SCENE_WIDTH + x;
        motionPixels[index] = 255;
        const offset = index * 4;
        const red = sourceImage.data[offset] ?? 0;
        const green = sourceImage.data[offset + 1] ?? 0;
        const blue = sourceImage.data[offset + 2] ?? 0;
        const luma = red * 0.299 + green * 0.587 + blue * 0.114;
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
        const coolEnough = blue >= red - 46 && blue >= green - 38;
        if (luma >= 118 && chroma <= 72 && coolEnough) candidates[index] = 1;
        if (luma >= 158 && chroma <= 60 && coolEnough) seeds[index] = 1;
      }
    }

    const selectedPixels: number[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const seedIndex = y * PARK_SCENE_WIDTH + x;
        if (candidates[seedIndex] === 0 || visited[seedIndex] !== 0) continue;
        const component: number[] = [];
        const queue = [seedIndex];
        let hasFogSeed = false;
        visited[seedIndex] = 1;
        for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
          const index = queue[queueIndex]!;
          component.push(index);
          if (seeds[index] !== 0) hasFogSeed = true;
          const pixelX = index % PARK_SCENE_WIDTH;
          const pixelY = Math.floor(index / PARK_SCENE_WIDTH);
          for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
            const nextY = pixelY + deltaY;
            if (nextY < minY || nextY > maxY) continue;
            for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
              if (deltaX === 0 && deltaY === 0) continue;
              const nextX = pixelX + deltaX;
              if (nextX < minX || nextX > maxX) continue;
              const nextIndex = nextY * PARK_SCENE_WIDTH + nextX;
              if (candidates[nextIndex] === 0 || visited[nextIndex] !== 0) continue;
              visited[nextIndex] = 1;
              queue.push(nextIndex);
            }
          }
        }
        if (!hasFogSeed || component.length < 12) continue;
        component.forEach((index) => {
          fogPixels[index] = 255;
          selectedPixels.push(index);
          allFogPixels.push(index);
        });
      }
    }

    if (selectedPixels.length === 0) return;
    selectedPixels.forEach((index) => {
      const x = index % PARK_SCENE_WIDTH;
      const y = Math.floor(index / PARK_SCENE_WIDTH);
      let nearestOutside = PARK_CLIFF_FOG_FEATHER_RADIUS + 1;
      for (
        let deltaY = -PARK_CLIFF_FOG_FEATHER_RADIUS;
        deltaY <= PARK_CLIFF_FOG_FEATHER_RADIUS;
        deltaY += 1
      ) {
        const sampleY = y + deltaY;
        if (sampleY < 0 || sampleY >= PARK_SCENE_HEIGHT) continue;
        for (
          let deltaX = -PARK_CLIFF_FOG_FEATHER_RADIUS;
          deltaX <= PARK_CLIFF_FOG_FEATHER_RADIUS;
          deltaX += 1
        ) {
          const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));
          if (distance === 0 || distance >= nearestOutside) continue;
          const sampleX = x + deltaX;
          if (sampleX < 0 || sampleX >= PARK_SCENE_WIDTH) continue;
          const sampleIndex = sampleY * PARK_SCENE_WIDTH + sampleX;
          if (fogPixels[sampleIndex] === 0) nearestOutside = distance;
        }
      }
      fogAlphaPixels[index] = nearestOutside > PARK_CLIFF_FOG_FEATHER_RADIUS
        ? 255
        : Math.round(
            smoothFeather(nearestOutside / PARK_CLIFF_FOG_FEATHER_RADIUS) * 255,
          );
    });
    const segmentMinX = Math.min(...selectedPixels.map((index) => index % PARK_SCENE_WIDTH));
    const segmentMaxX = Math.max(...selectedPixels.map((index) => index % PARK_SCENE_WIDTH));
    const segmentMinY = Math.min(
      ...selectedPixels.map((index) => Math.floor(index / PARK_SCENE_WIDTH)),
    );
    const segmentMaxY = Math.max(
      ...selectedPixels.map((index) => Math.floor(index / PARK_SCENE_WIDTH)),
    );
    const segmentCanvas = newCanvas(
      segmentMaxX - segmentMinX + 1,
      segmentMaxY - segmentMinY + 1,
    );
    const segmentContext = segmentCanvas.getContext("2d")!;
    const segmentImage = segmentContext.createImageData(
      segmentCanvas.width,
      segmentCanvas.height,
    );
    selectedPixels.forEach((index) => {
      const x = index % PARK_SCENE_WIDTH;
      const y = Math.floor(index / PARK_SCENE_WIDTH);
      const sourceOffset = index * 4;
      const segmentOffset = (
        (y - segmentMinY) * segmentCanvas.width + x - segmentMinX
      ) * 4;
      segmentImage.data[segmentOffset] = sourceImage.data[sourceOffset] ?? 0;
      segmentImage.data[segmentOffset + 1] = sourceImage.data[sourceOffset + 1] ?? 0;
      segmentImage.data[segmentOffset + 2] = sourceImage.data[sourceOffset + 2] ?? 0;
      segmentImage.data[segmentOffset + 3] = fogAlphaPixels[index] ?? 0;
    });
    segmentContext.putImageData(segmentImage, 0, 0);
    segments.push({
      id: band.id,
      canvas: segmentCanvas,
      x: segmentMinX,
      y: segmentMinY,
      periodMs: band.periodMs,
      phase: band.phase,
      amplitudeX: band.amplitudeX,
      amplitudeY: band.amplitudeY,
      alpha: band.alpha,
    });
  });

  // The source PNG stays untouched. Inpaint only the extracted mist pixels by
  // propagating the immediately surrounding valley colours inward one ring at
  // a time. This keeps the revealed background continuous when a bank drifts,
  // instead of exposing an offset clone or a stationary copy of the mist.
  const unresolved = new Uint8Array(fogPixels);
  let remainingPixels = allFogPixels.length;
  for (let pass = 0; pass < 180 && remainingPixels > 0; pass += 1) {
    const updates: Array<readonly [number, number, number, number]> = [];
    allFogPixels.forEach((index) => {
      if (unresolved[index] === 0) return;
      const x = index % PARK_SCENE_WIDTH;
      const y = Math.floor(index / PARK_SCENE_WIDTH);
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      let samples = 0;
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        const sampleY = y + deltaY;
        if (sampleY < 0 || sampleY >= PARK_SCENE_HEIGHT) continue;
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue;
          const sampleX = x + deltaX;
          if (sampleX < 0 || sampleX >= PARK_SCENE_WIDTH) continue;
          const sampleIndex = sampleY * PARK_SCENE_WIDTH + sampleX;
          if (unresolved[sampleIndex] !== 0) continue;
          const sampleOffset = sampleIndex * 4;
          redTotal += cleanedImage.data[sampleOffset] ?? 0;
          greenTotal += cleanedImage.data[sampleOffset + 1] ?? 0;
          blueTotal += cleanedImage.data[sampleOffset + 2] ?? 0;
          samples += 1;
        }
      }
      if (samples === 0) return;
      const texture = ((x * 17 + y * 31 + pass * 13) % 7) - 3;
      updates.push([
        index,
        Math.max(0, Math.min(255, Math.round(redTotal / samples) + texture)),
        Math.max(0, Math.min(255, Math.round(greenTotal / samples) + texture)),
        Math.max(0, Math.min(255, Math.round(blueTotal / samples) + texture)),
      ]);
    });
    if (updates.length === 0) break;
    updates.forEach(([index, red, green, blue]) => {
      const offset = index * 4;
      cleanedImage.data[offset] = red;
      cleanedImage.data[offset + 1] = green;
      cleanedImage.data[offset + 2] = blue;
      cleanedImage.data[offset + 3] = 255;
      unresolved[index] = 0;
      remainingPixels -= 1;
    });
  }

  cleanedContext.putImageData(cleanedImage, 0, 0);
  return {
    neutralBaseWithoutDistantShoreFoamAndCliffFog: cleaned,
    cliffFogMask: makeMaskCanvas(fogAlphaPixels),
    cliffFogMotionMask: makeMaskCanvas(motionPixels),
    cliffFogSegments: segments,
  };
};

const makeMaskDistanceField = (seeds: Uint8Array, maximumDistance: number) => {
  const distances = new Uint8Array(seeds.length);
  distances.fill(maximumDistance + 1);
  const queue = new Int32Array(seeds.length);
  let queueHead = 0;
  let queueTail = 0;
  for (let y = PARK_OCEAN_TOP; y < PARK_OCEAN_BOTTOM; y += 1) {
    for (let x = 0; x < PARK_SCENE_WIDTH; x += 1) {
      const index = y * PARK_SCENE_WIDTH + x;
      if (seeds[index] === 0) continue;
      distances[index] = 0;
      queue[queueTail] = index;
      queueTail += 1;
    }
  }
  while (queueHead < queueTail) {
    const index = queue[queueHead] ?? 0;
    queueHead += 1;
    const distance = distances[index] ?? maximumDistance + 1;
    if (distance >= maximumDistance) continue;
    const x = index % PARK_SCENE_WIDTH;
    const y = Math.floor(index / PARK_SCENE_WIDTH);
    const visit = (nextIndex: number) => {
      if ((distances[nextIndex] ?? 0) <= distance + 1) return;
      distances[nextIndex] = distance + 1;
      queue[queueTail] = nextIndex;
      queueTail += 1;
    };
    if (x > 0) visit(index - 1);
    if (x + 1 < PARK_SCENE_WIDTH) visit(index + 1);
    if (y > PARK_OCEAN_TOP) visit(index - PARK_SCENE_WIDTH);
    if (y + 1 < PARK_OCEAN_BOTTOM) visit(index + PARK_SCENE_WIDTH);
  }
  return distances;
};

const makeSeaMasks = (
  neutralBase: HTMLCanvasElement,
  authoredSource: HTMLCanvasElement,
) => {
  const source = neutralBase.getContext("2d", { willReadFrequently: true })!;
  const sourceImage = source.getImageData(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const authored = authoredSource.getContext("2d", { willReadFrequently: true })!;
  const authoredImage = authored.getImageData(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const pixelCount = PARK_SCENE_WIDTH * PARK_SCENE_HEIGHT;
  const candidates = new Uint8Array(pixelCount);
  const connectedSea = new Uint8Array(pixelCount);
  const landExclusion = makeLandExclusionMask();
  const queue = new Int32Array(pixelCount);
  let queueHead = 0;
  let queueTail = 0;

  for (let y = PARK_OCEAN_TOP; y < PARK_OCEAN_BOTTOM; y += 1) {
    for (let x = 0; x < PARK_SCENE_WIDTH; x += 1) {
      const offset = (y * PARK_SCENE_WIDTH + x) * 4;
      const red = sourceImage.data[offset] ?? 0;
      const green = sourceImage.data[offset + 1] ?? 0;
      const blue = sourceImage.data[offset + 2] ?? 0;
      const clearBlue = blue >= red + 35 && green >= red + 28 && blue >= green - 10;
      const deepBlue = blue >= red + 45 && green >= red + 24 && blue >= green + 8;
      if (clearBlue || deepBlue) candidates[y * PARK_SCENE_WIDTH + x] = 1;
    }
  }

  const enqueue = (index: number) => {
    if (candidates[index] === 0 || connectedSea[index] !== 0) return;
    connectedSea[index] = 255;
    queue[queueTail] = index;
    queueTail += 1;
  };

  for (let y = PARK_OCEAN_TOP; y <= PARK_OCEAN_TOP + 8; y += 1) {
    for (let x = 0; x < PARK_SCENE_WIDTH; x += 1) {
      enqueue(y * PARK_SCENE_WIDTH + x);
    }
  }

  while (queueHead < queueTail) {
    const index = queue[queueHead] ?? 0;
    queueHead += 1;
    const x = index % PARK_SCENE_WIDTH;
    const y = Math.floor(index / PARK_SCENE_WIDTH);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < PARK_SCENE_WIDTH) enqueue(index + 1);
    if (y > PARK_OCEAN_TOP) enqueue(index - PARK_SCENE_WIDTH);
    if (y + 1 < PARK_OCEAN_BOTTOM) enqueue(index + PARK_SCENE_WIDTH);
  }

  // Reclaim isolated cyan/white wave pixels only when they are surrounded by
  // already connected ocean. This closes sparkle holes without bridging onto
  // the blue-grey cliffs or islands.
  for (let pass = 0; pass < 2; pass += 1) {
    const additions: number[] = [];
    for (let y = PARK_OCEAN_TOP + 1; y < PARK_OCEAN_BOTTOM - 1; y += 1) {
      for (let x = 1; x < PARK_SCENE_WIDTH - 1; x += 1) {
        const index = y * PARK_SCENE_WIDTH + x;
        if (connectedSea[index] !== 0) continue;
        const offset = index * 4;
        const red = sourceImage.data[offset] ?? 0;
        const green = sourceImage.data[offset + 1] ?? 0;
        const blue = sourceImage.data[offset + 2] ?? 0;
        const brightWater = green >= red - 5 && blue >= red - 3 && blue >= green - 10;
        if (!brightWater) continue;
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            if (connectedSea[(y + dy) * PARK_SCENE_WIDTH + x + dx] !== 0) neighbours += 1;
          }
        }
        if (neighbours >= 6) additions.push(index);
      }
    }
    additions.forEach((index) => {
      connectedSea[index] = 255;
    });
  }

  for (let index = 0; index < connectedSea.length; index += 1) {
    if (landExclusion[index] !== 0) connectedSea[index] = 0;
  }

  const seaMotion = new Uint8Array(connectedSea);
  const shoreFoamInner = new Uint8Array(pixelCount);
  const shoreFoamOuter = new Uint8Array(pixelCount);
  const distantShoreFoam = new Uint8Array(pixelCount);
  const landDistance = makeMaskDistanceField(landExclusion, 7);
  for (let y = PARK_OCEAN_TOP; y < PARK_OCEAN_BOTTOM; y += 1) {
    for (let x = 0; x < PARK_SCENE_WIDTH; x += 1) {
      const index = y * PARK_SCENE_WIDTH + x;
      if (landExclusion[index] !== 0) continue;
      const nearestLand = landDistance[index] ?? 8;

      if (connectedSea[index] !== 0 && nearestLand <= 4) seaMotion[index] = 0;
      if (nearestLand > 7) continue;
      const offset = index * 4;
      const red = sourceImage.data[offset] ?? 0;
      const green = sourceImage.data[offset + 1] ?? 0;
      const blue = sourceImage.data[offset + 2] ?? 0;
      const brightness = (red + green + blue) / 3;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      const staticFoamColor = brightness >= 126
        && chroma <= 104
        && green >= red - 12
        && blue >= red - 10;
      if (!staticFoamColor) continue;
      let touchesConnectedSea = false;
      for (let dy = -2; dy <= 2 && !touchesConnectedSea; dy += 1) {
        const sampleY = y + dy;
        if (sampleY < PARK_OCEAN_TOP || sampleY >= PARK_OCEAN_BOTTOM) continue;
        for (let dx = -2; dx <= 2; dx += 1) {
          const sampleX = x + dx;
          if (sampleX < 0 || sampleX >= PARK_SCENE_WIDTH) continue;
          if (connectedSea[sampleY * PARK_SCENE_WIDTH + sampleX] !== 0) {
            touchesConnectedSea = true;
            break;
          }
        }
      }
      if (touchesConnectedSea) {
        const brightnessWeight = Math.max(0.32, Math.min(1, (brightness - 108) / 92));
        shoreFoamInner[index] = Math.round(255 * brightnessWeight);
      }
    }
  }

  // The distant surf belongs to a fixed authored asset, so use the audited
  // water-side bands rather than a wide distance ring around approximate land
  // polygons. Each source pixel must still be white/cyan and brighter than the
  // connected water sampled in that band's outward direction.
  const distantShoreFoamCandidates = new Uint8Array(pixelCount);
  PARK_DISTANT_SHORE_FOAM_BANDS.forEach((band) => {
    const perpendicularX = -band.directionY;
    const perpendicularY = band.directionX;
    for (let y = band.minY; y <= Math.min(band.maxY, PARK_SCENE_HEIGHT - 1); y += 1) {
      for (let x = band.minX; x <= Math.min(band.maxX, PARK_SCENE_WIDTH - 1); x += 1) {
        const index = y * PARK_SCENE_WIDTH + x;
        const offset = index * 4;
        const red = authoredImage.data[offset] ?? 0;
        const green = authoredImage.data[offset + 1] ?? 0;
        const blue = authoredImage.data[offset + 2] ?? 0;
        const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
        const whiteFoam = luma >= 190
          && chroma <= 45
          && green >= red - 10
          && blue >= red - 10;
        const blueWhiteFoam = luma >= 150
          && blue >= red + 15
          && green >= red + 8
          && blue >= green - 18;
        if (!whiteFoam && !blueWhiteFoam) continue;

        const waterLumaSamples: number[] = [];
        for (let distance = 3; distance <= 10; distance += 1) {
          for (let side = -1; side <= 1; side += 1) {
            const sampleX = x + band.directionX * distance + perpendicularX * side;
            const sampleY = y + band.directionY * distance + perpendicularY * side;
            if (
              sampleX < 0
              || sampleX >= PARK_SCENE_WIDTH
              || sampleY < PARK_OCEAN_TOP
              || sampleY >= PARK_OCEAN_BOTTOM
            ) continue;
            const sampleIndex = sampleY * PARK_SCENE_WIDTH + sampleX;
            const sampleOffset = sampleIndex * 4;
            const sampleRed = authoredImage.data[sampleOffset] ?? 0;
            const sampleGreen = authoredImage.data[sampleOffset + 1] ?? 0;
            const sampleBlue = authoredImage.data[sampleOffset + 2] ?? 0;
            const waterSideColor = sampleBlue >= sampleRed + 18
              && sampleGreen >= sampleRed + 12
              && sampleBlue >= sampleGreen - 12;
            if (!waterSideColor) continue;
            waterLumaSamples.push(
              sampleRed * 0.2126 + sampleGreen * 0.7152 + sampleBlue * 0.0722,
            );
          }
        }
        if (waterLumaSamples.length === 0) continue;
        waterLumaSamples.sort((left, right) => left - right);
        const waterLuma = waterLumaSamples[Math.floor(waterLumaSamples.length / 2)] ?? luma;
        const contrast = luma - waterLuma;
        if (contrast < 18) continue;
        const confidence = Math.max(0.48, Math.min(1, contrast / 80));
        distantShoreFoamCandidates[index] = Math.round(confidence * 255);
      }
    }
  });

  // Keep line work, not isolated sparkles. The approved bands remain the
  // segmentation boundary, so nearby parallel waves cannot merge together.
  PARK_DISTANT_SHORE_FOAM_BANDS.forEach((band) => {
    for (let y = band.minY; y <= Math.min(band.maxY, PARK_SCENE_HEIGHT - 1); y += 1) {
      for (let x = band.minX; x <= Math.min(band.maxX, PARK_SCENE_WIDTH - 1); x += 1) {
        const index = y * PARK_SCENE_WIDTH + x;
        if (distantShoreFoamCandidates[index] === 0) continue;
        let hasLineNeighbour = false;
        for (let dy = -1; dy <= 1 && !hasLineNeighbour; dy += 1) {
          const nextY = y + dy;
          if (nextY < band.minY || nextY > band.maxY) continue;
          for (let dx = -2; dx <= 2; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nextX = x + dx;
            if (nextX < band.minX || nextX > band.maxX) continue;
            if (distantShoreFoamCandidates[nextY * PARK_SCENE_WIDTH + nextX] !== 0) {
              hasLineNeighbour = true;
              break;
            }
          }
        }
        if (hasLineNeighbour) distantShoreFoam[index] = distantShoreFoamCandidates[index] ?? 0;
      }
    }
  });

  // These distant strokes are now fully owned by the moving layer. Remove
  // them from the generic static breathing source so no stationary copy can
  // remain underneath the animated pixels.
  for (let index = 0; index < shoreFoamInner.length; index += 1) {
    if (distantShoreFoam[index] !== 0) shoreFoamInner[index] = 0;
  }

  // Expand only the authored foam pixels toward connected water. The second
  // band cross-fades with the original pixels in the renderer, so the coast
  // appears to breathe without inventing a new shoreline shape.
  const foamDistance = makeMaskDistanceField(shoreFoamInner, 3);
  for (let y = PARK_OCEAN_TOP + 1; y < PARK_OCEAN_BOTTOM - 1; y += 1) {
    for (let x = 1; x < PARK_SCENE_WIDTH - 1; x += 1) {
      const index = y * PARK_SCENE_WIDTH + x;
      if (connectedSea[index] === 0 || shoreFoamInner[index] !== 0) continue;
      const nearestFoam = foamDistance[index] ?? 4;
      if (nearestFoam > 3) continue;
      const dash = ((x * 13 + y * 19 + Math.floor(x / 5) * 3) % 29) < 20;
      if (!dash) continue;
      shoreFoamOuter[index] = Math.round(190 * (4 - nearestFoam) / 3);
    }
  }

  const shoreFoamMotion = new Uint8Array(connectedSea);
  for (let index = 0; index < shoreFoamMotion.length; index += 1) {
    if (distantShoreFoam[index] !== 0) shoreFoamMotion[index] = 255;
  }

  return {
    neutralBaseWithoutDistantShoreFoam: makeBaseWithoutDistantShoreFoam(
      sourceImage,
      distantShoreFoam,
      connectedSea,
    ),
    seaMask: makeMaskCanvas(connectedSea),
    seaMotionMask: makeMaskCanvas(seaMotion),
    shoreFoamInnerMask: makeMaskCanvas(shoreFoamInner),
    shoreFoamOuterMask: makeMaskCanvas(shoreFoamOuter),
    distantShoreFoamMask: makeMaskCanvas(distantShoreFoam),
    shoreFoamMotionMask: makeMaskCanvas(shoreFoamMotion),
    shoreFoamSegments: makeShoreFoamSegments(distantShoreFoam, sourceImage),
  };
};

const PARK_POND_MIN_X = 750;
const PARK_POND_MIN_Y = 425;
const PARK_POND_MAX_X = PARK_SCENE_WIDTH - 1;
const PARK_POND_MAX_Y = PARK_SCENE_HEIGHT - 1;
const PARK_POND_AUDITED_SEEDS: readonly (readonly [number, number])[] = [
  [790, 620],
  [800, 650],
] as const;

const makePondMasks = (neutralBase: HTMLCanvasElement) => {
  const source = neutralBase.getContext("2d", { willReadFrequently: true })!;
  const sourceImage = source.getImageData(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const pixelCount = PARK_SCENE_WIDTH * PARK_SCENE_HEIGHT;
  const candidates = new Uint8Array(pixelCount);
  const connectedPond = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueHead = 0;
  let queueTail = 0;

  // The pond is the only connected blue/teal component inside this audited
  // lower-right region. Colour classification preserves the authored,
  // irregular shoreline while leaving docks, reeds, lily pads, rocks and
  // grass as transparent holes instead of relying on a loose ellipse clip.
  for (let y = PARK_POND_MIN_Y; y <= PARK_POND_MAX_Y; y += 1) {
    for (let x = PARK_POND_MIN_X; x <= PARK_POND_MAX_X; x += 1) {
      const index = y * PARK_SCENE_WIDTH + x;
      const offset = index * 4;
      const red = sourceImage.data[offset] ?? 0;
      const green = sourceImage.data[offset + 1] ?? 0;
      const blue = sourceImage.data[offset + 2] ?? 0;
      const blueWater = blue >= red + 20
        && green >= red + 11
        && blue >= green + 5
        && blue >= 48
        && red <= 118;
      const deepTealWater = blue >= red + 15
        && green >= red + 18
        && blue >= green - 8
        && blue >= 42
        && red <= 92;
      if (blueWater || deepTealWater) candidates[index] = 1;
    }
  }

  const enqueue = (index: number) => {
    if (candidates[index] === 0 || connectedPond[index] !== 0) return;
    connectedPond[index] = 255;
    queue[queueTail] = index;
    queueTail += 1;
  };

  // The authored pond exits the canvas on the right and bottom. Seeding only
  // those edges rejects isolated blue details elsewhere on the plateau.
  for (let y = PARK_POND_MIN_Y; y <= PARK_POND_MAX_Y; y += 1) {
    enqueue(y * PARK_SCENE_WIDTH + PARK_POND_MAX_X);
  }
  for (let x = PARK_POND_MIN_X; x <= PARK_POND_MAX_X; x += 1) {
    enqueue(PARK_POND_MAX_Y * PARK_SCENE_WIDTH + x);
  }
  // The small bay beneath the middle dock is genuine pond water but reeds,
  // pilings and deep bank shadow can separate it from the right/bottom edge
  // component. These audited seeds recover only blue/teal candidate pixels.
  PARK_POND_AUDITED_SEEDS.forEach(([x, y]) => {
    enqueue(y * PARK_SCENE_WIDTH + x);
  });

  while (queueHead < queueTail) {
    const index = queue[queueHead] ?? 0;
    queueHead += 1;
    const x = index % PARK_SCENE_WIDTH;
    const y = Math.floor(index / PARK_SCENE_WIDTH);
    if (x > PARK_POND_MIN_X) enqueue(index - 1);
    if (x < PARK_POND_MAX_X) enqueue(index + 1);
    if (y > PARK_POND_MIN_Y) enqueue(index - PARK_SCENE_WIDTH);
    if (y < PARK_POND_MAX_Y) enqueue(index + PARK_SCENE_WIDTH);
  }

  // Reclaim only tiny bright authored ripple gaps that are already enclosed
  // by pond water. Large non-water objects cannot satisfy this neighbourhood
  // test and therefore remain excluded from every animated layer.
  for (let pass = 0; pass < 2; pass += 1) {
    const additions: number[] = [];
    for (let y = PARK_POND_MIN_Y + 1; y < PARK_POND_MAX_Y; y += 1) {
      for (let x = PARK_POND_MIN_X + 1; x < PARK_POND_MAX_X; x += 1) {
        const index = y * PARK_SCENE_WIDTH + x;
        if (connectedPond[index] !== 0) continue;
        let neighbours = 0;
        for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
          for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
            if (deltaX === 0 && deltaY === 0) continue;
            if (connectedPond[(y + deltaY) * PARK_SCENE_WIDTH + x + deltaX] !== 0) {
              neighbours += 1;
            }
          }
        }
        if (neighbours >= 6) additions.push(index);
      }
    }
    additions.forEach((index) => {
      connectedPond[index] = 255;
    });
  }

  const pondInterior = new Uint8Array(pixelCount);
  const pondEdge = new Uint8Array(pixelCount);
  const pondRim = new Uint8Array(pixelCount);
  for (let y = PARK_POND_MIN_Y; y <= PARK_POND_MAX_Y; y += 1) {
    for (let x = PARK_POND_MIN_X; x <= PARK_POND_MAX_X; x += 1) {
      const index = y * PARK_SCENE_WIDTH + x;
      if (connectedPond[index] === 0) continue;
      let nearestOutside = 6;
      for (let radius = 1; radius <= 5; radius += 1) {
        let touchesOutside = false;
        for (let deltaY = -radius; deltaY <= radius && !touchesOutside; deltaY += 1) {
          const remaining = radius - Math.abs(deltaY);
          for (const deltaX of remaining === 0 ? [0] : [-remaining, remaining]) {
            const sampleX = x + deltaX;
            const sampleY = y + deltaY;
            if (
              sampleX < PARK_POND_MIN_X
              || sampleX > PARK_POND_MAX_X
              || sampleY < PARK_POND_MIN_Y
              || sampleY > PARK_POND_MAX_Y
              || connectedPond[sampleY * PARK_SCENE_WIDTH + sampleX] === 0
            ) {
              touchesOutside = true;
              break;
            }
          }
        }
        if (touchesOutside) {
          nearestOutside = radius;
          break;
        }
      }
      if (nearestOutside === 1) pondRim[index] = 255;
      if (nearestOutside <= 5) pondEdge[index] = Math.round(255 * (6 - nearestOutside) / 5);
      if (nearestOutside >= 4) pondInterior[index] = 255;
    }
  }

  return {
    pondMask: makeMaskCanvas(connectedPond),
    pondInteriorMask: makeMaskCanvas(pondInterior),
    pondEdgeMask: makeMaskCanvas(pondEdge),
    pondRimMask: makeMaskCanvas(pondRim),
  };
};

const countOpaquePixels = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if ((pixels[offset] ?? 0) > 24) count += 1;
  }
  return count;
};

const makeGrassRippleMask = (
  neutralBase: HTMLCanvasElement,
  staticOccluders: readonly ParkReferenceOccluder[],
) => {
  const source = neutralBase.getContext("2d", { willReadFrequently: true })!;
  const image = source.getImageData(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const values = new Uint8Array(PARK_SCENE_WIDTH * PARK_SCENE_HEIGHT);

  // Keep the ripple on authored grass pixels rather than on a broad plateau
  // polygon. Grey stone, brown soil, flowers, docks and water therefore remain
  // transparent even before the explicit object exclusions below.
  for (let y = 235; y <= 842; y += 1) {
    for (let x = 0; x < PARK_SCENE_WIDTH; x += 1) {
      if (!isParkGrassPoint(x, y)) continue;
      const index = y * PARK_SCENE_WIDTH + x;
      const offset = index * 4;
      const red = image.data[offset] ?? 0;
      const green = image.data[offset + 1] ?? 0;
      const blue = image.data[offset + 2] ?? 0;
      const redDominance = green - red;
      const blueDominance = green - blue;
      const grassLike = green >= 55
        && redDominance >= 7
        && blueDominance >= 9
        && red >= 28;
      if (!grassLike) continue;
      const confidence = Math.max(
        0,
        Math.min(1, (Math.min(redDominance, blueDominance) - 6) / 24),
      );
      values[index] = Math.round(148 + confidence * 107);
    }
  }

  // Placement colliders cover the authored large rocks, bench and other fixed
  // obstacles. A small safety margin prevents the highlighted grass fringe
  // from visually climbing their silhouettes.
  PARK_REFERENCE_COLLIDERS.forEach((collider) => {
    const radius = collider.radius + 6;
    const minX = Math.max(0, Math.floor(collider.x - radius));
    const maxX = Math.min(PARK_SCENE_WIDTH - 1, Math.ceil(collider.x + radius));
    const minY = Math.max(0, Math.floor(collider.y - radius));
    const maxY = Math.min(PARK_SCENE_HEIGHT - 1, Math.ceil(collider.y + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (Math.hypot(x - collider.x, y - collider.y) <= radius) {
          values[y * PARK_SCENE_WIDTH + x] = 0;
        }
      }
    }
  });

  // The contour-derived occluders include the authored shrub/flower clusters
  // whose green pixels would otherwise pass the grass colour classifier.
  staticOccluders.forEach((occluder) => {
    const occluderContext = occluder.canvas.getContext("2d", { willReadFrequently: true })!;
    const occluderPixels = occluderContext.getImageData(
      0,
      0,
      occluder.canvas.width,
      occluder.canvas.height,
    ).data;
    for (let localY = 0; localY < occluder.canvas.height; localY += 1) {
      for (let localX = 0; localX < occluder.canvas.width; localX += 1) {
        const alpha = occluderPixels[(localY * occluder.canvas.width + localX) * 4 + 3] ?? 0;
        if (alpha <= 24) continue;
        const centerX = occluder.x + localX;
        const centerY = occluder.y + localY;
        for (let deltaY = -3; deltaY <= 3; deltaY += 1) {
          const y = centerY + deltaY;
          if (y < 0 || y >= PARK_SCENE_HEIGHT) continue;
          for (let deltaX = -3; deltaX <= 3; deltaX += 1) {
            const x = centerX + deltaX;
            if (x < 0 || x >= PARK_SCENE_WIDTH) continue;
            if (deltaX * deltaX + deltaY * deltaY <= 9) {
              values[y * PARK_SCENE_WIDTH + x] = 0;
            }
          }
        }
      }
    }
  });

  return makeMaskCanvas(values);
};

const buildLayers = (
  image: HTMLImageElement,
  stampImage: HTMLImageElement,
): ParkReferenceLayers | null => {
  const full = newCanvas(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const ctx = full.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    image,
    0,
    0,
    PARK_REFERENCE_SOURCE_WIDTH,
    PARK_REFERENCE_SOURCE_HEIGHT,
    0,
    0,
    PARK_SCENE_WIDTH,
    PARK_SCENE_HEIGHT,
  );
  const stampFull = newCanvas(PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const stampCtx = stampFull.getContext("2d", { willReadFrequently: true });
  if (!stampCtx) return null;
  stampCtx.imageSmoothingEnabled = false;
  stampCtx.drawImage(
    stampImage,
    0,
    0,
    PARK_REFERENCE_STAMP_SOURCE_WIDTH,
    PARK_REFERENCE_STAMP_SOURCE_HEIGHT,
    0,
    0,
    PARK_SCENE_WIDTH,
    PARK_SCENE_HEIGHT,
  );
  const stamps: Partial<Record<ParkObjectKind, ParkReferenceStamp>> = {};
  Object.entries(STAMP_RECIPES).forEach(([kind, recipe]) => {
    if (!recipe) return;
    const stamp = makeStamp(stampFull, recipe);
    if (stamp) stamps[kind as ParkObjectKind] = stamp;
  });
  const neutralBase = makeNeutralBase(full);
  const {
    neutralBaseWithoutDistantShoreFoam,
    seaMask,
    seaMotionMask,
    shoreFoamInnerMask,
    shoreFoamOuterMask,
    distantShoreFoamMask,
    shoreFoamMotionMask,
    shoreFoamSegments,
  } = makeSeaMasks(neutralBase, full);
  const {
    neutralBaseWithoutDistantShoreFoamAndCliffFog,
    cliffFogMask,
    cliffFogMotionMask,
    cliffFogSegments,
  } = makeCliffFogLayers(neutralBaseWithoutDistantShoreFoam);
  const {
    pondMask,
    pondInteriorMask,
    pondEdgeMask,
    pondRimMask,
  } = makePondMasks(neutralBase);
  const staticOccluders = STATIC_OCCLUDER_RECIPES.map((recipe) =>
    makeStaticOccluder(neutralBase, recipe));
  const grassRippleMask = makeGrassRippleMask(neutralBase, staticOccluders);
  return {
    neutralBase,
    neutralBaseWithoutDistantShoreFoamAndCliffFog,
    cliffFogMotionMask,
    cliffFogSegments,
    grassRippleMask,
    seaMask,
    seaMotionMask,
    pondInteriorMask,
    pondEdgeMask,
    pondRimMask,
    shoreFoamInnerMask,
    shoreFoamOuterMask,
    shoreFoamMotionMask,
    shoreFoamSegments,
    staticOccluders,
    sun: makeSunStamp(stampFull),
    seaMaskPixels: countOpaquePixels(seaMask),
    seaMotionMaskPixels: countOpaquePixels(seaMotionMask),
    pondMaskPixels: countOpaquePixels(pondMask),
    pondInteriorMaskPixels: countOpaquePixels(pondInteriorMask),
    pondEdgeMaskPixels: countOpaquePixels(pondEdgeMask),
    pondRimMaskPixels: countOpaquePixels(pondRimMask),
    shoreFoamInnerMaskPixels: countOpaquePixels(shoreFoamInnerMask),
    shoreFoamOuterMaskPixels: countOpaquePixels(shoreFoamOuterMask),
    distantShoreFoamMaskPixels: countOpaquePixels(distantShoreFoamMask),
    shoreFoamMotionMaskPixels: countOpaquePixels(shoreFoamMotionMask),
    cliffFogMaskPixels: countOpaquePixels(cliffFogMask),
    cliffFogMotionMaskPixels: countOpaquePixels(cliffFogMotionMask),
    grassRippleMaskPixels: countOpaquePixels(grassRippleMask),
    grassRippleObstacleExclusionCount:
      PARK_REFERENCE_COLLIDERS.length + staticOccluders.length,
    stamps,
  };
};

export const getParkReferenceLayers = () => cachedLayers;

export const ensureParkReferenceLayers = () => {
  if (cachedLayers || loadingStarted) return;
  loadingStarted = true;
  const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error(`Unable to load park asset: ${source}`)), {
      once: true,
    });
    image.src = source;
  });
  void Promise.all([
    loadImage(PARK_REFERENCE_ASSET),
    loadImage(PARK_REFERENCE_STAMP_ASSET),
  ]).then(([image, stampImage]) => {
    cachedLayers = buildLayers(image, stampImage);
    window.dispatchEvent(new CustomEvent("aivatar:park-reference-ready"));
  }).catch(() => {
    loadingStarted = false;
  });
};
