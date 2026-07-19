export interface ParkCloudSprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  opaquePixels: number;
}

type CloudLobe = {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  lift?: number;
};

type CloudBlueprint = {
  width: number;
  height: number;
  scale: number;
  seed: number;
  structure: "anvil" | "tower" | "bank";
  lobes: CloudLobe[];
};

const CLOUD_BLUEPRINTS: CloudBlueprint[] = [
  {
    width: 172,
    height: 50,
    scale: 3,
    seed: 13,
    structure: "anvil",
    lobes: [
      { x: 15, y: 32, radiusX: 20, radiusY: 9 },
      { x: 35, y: 27, radiusX: 27, radiusY: 14 },
      { x: 58, y: 19, radiusX: 24, radiusY: 18, lift: 0.1 },
      { x: 68, y: 8, radiusX: 17, radiusY: 13, lift: 0.13 },
      { x: 86, y: 4, radiusX: 20, radiusY: 14, lift: 0.16 },
      { x: 104, y: 8, radiusX: 19, radiusY: 13, lift: 0.13 },
      { x: 82, y: 15, radiusX: 25, radiusY: 20, lift: 0.16 },
      { x: 105, y: 20, radiusX: 30, radiusY: 18, lift: 0.08 },
      { x: 132, y: 25, radiusX: 32, radiusY: 15 },
      { x: 157, y: 31, radiusX: 24, radiusY: 10 },
      { x: 79, y: 33, radiusX: 69, radiusY: 11 },
    ],
  },
  {
    width: 144,
    height: 40,
    scale: 3,
    seed: 37,
    structure: "tower",
    lobes: [
      { x: 13, y: 29, radiusX: 17, radiusY: 8 },
      { x: 30, y: 24, radiusX: 24, radiusY: 12 },
      { x: 51, y: 15, radiusX: 22, radiusY: 16, lift: 0.13 },
      { x: 60, y: 7, radiusX: 16, radiusY: 12, lift: 0.14 },
      { x: 75, y: 5, radiusX: 17, radiusY: 12, lift: 0.16 },
      { x: 73, y: 18, radiusX: 27, radiusY: 16, lift: 0.08 },
      { x: 96, y: 13, radiusX: 21, radiusY: 18, lift: 0.15 },
      { x: 117, y: 23, radiusX: 28, radiusY: 13 },
      { x: 136, y: 29, radiusX: 15, radiusY: 8 },
      { x: 71, y: 30, radiusX: 58, radiusY: 9 },
    ],
  },
  {
    width: 118,
    height: 34,
    scale: 3,
    seed: 71,
    structure: "tower",
    lobes: [
      { x: 10, y: 25, radiusX: 14, radiusY: 7 },
      { x: 25, y: 21, radiusX: 21, radiusY: 10 },
      { x: 43, y: 13, radiusX: 20, radiusY: 14, lift: 0.14 },
      { x: 62, y: 17, radiusX: 24, radiusY: 13, lift: 0.06 },
      { x: 82, y: 12, radiusX: 17, radiusY: 14, lift: 0.12 },
      { x: 100, y: 22, radiusX: 23, radiusY: 10 },
      { x: 112, y: 26, radiusX: 12, radiusY: 6 },
      { x: 57, y: 26, radiusX: 47, radiusY: 8 },
    ],
  },
  {
    width: 92,
    height: 28,
    scale: 3,
    seed: 109,
    structure: "bank",
    lobes: [
      { x: 8, y: 21, radiusX: 12, radiusY: 6 },
      { x: 22, y: 17, radiusX: 18, radiusY: 9 },
      { x: 39, y: 10, radiusX: 17, radiusY: 12, lift: 0.15 },
      { x: 55, y: 15, radiusX: 21, radiusY: 11, lift: 0.07 },
      { x: 72, y: 13, radiusX: 16, radiusY: 11, lift: 0.1 },
      { x: 86, y: 21, radiusX: 13, radiusY: 6 },
      { x: 46, y: 22, radiusX: 35, radiusY: 6 },
    ],
  },
];

let cachedCloudSprites: ParkCloudSprite[] | null = null;

const hashNoise = (x: number, y: number, seed: number) => {
  const value = Math.sin(x * 91.17 + y * 47.73 + seed * 13.31) * 43758.5453;
  return value - Math.floor(value);
};

const lobeDensity = (x: number, y: number, lobe: CloudLobe) => {
  const dx = (x - lobe.x) / lobe.radiusX;
  const dy = (y - lobe.y) / lobe.radiusY;
  return Math.max(0, 1 - dx * dx - dy * dy + (lobe.lift ?? 0));
};

const buildCloudSprite = (blueprint: CloudBlueprint): ParkCloudSprite => {
  const logical = document.createElement("canvas");
  logical.width = blueprint.width;
  logical.height = blueprint.height;
  const logicalCtx = logical.getContext("2d")!;
  const image = logicalCtx.createImageData(blueprint.width, blueprint.height);
  let logicalOpaquePixels = 0;

  for (let y = 0; y < blueprint.height; y += 1) {
    for (let x = 0; x < blueprint.width; x += 1) {
      const densities = blueprint.lobes.map((lobe) => lobeDensity(x, y, lobe));
      const density = Math.max(...densities);
      if (density <= 0.025) continue;
      const offset = (y * blueprint.width + x) * 4;
      const vertical = y / blueprint.height;
      const horizontal = x / blueprint.width;
      const upperLight = Math.max(0, Math.min(1, (0.64 - vertical) * 2.15));
      const lowerShadow = Math.max(0, Math.min(1, (vertical - 0.46) * 2.7));
      const scallopLight = densities.some((value) => value > 0.48) ? 1 : 0;
      const noise = hashNoise(x, y, blueprint.seed);
      const dither = noise > 0.78 ? 9 : noise < 0.17 ? -8 : 0;
      const towerCenter = blueprint.structure === "anvil" ? 0.5 : 0.52;
      const towerWidth = blueprint.structure === "bank" ? 0.34 : 0.22;
      const updraftCore = Math.max(0, 1 - Math.abs(horizontal - towerCenter) / towerWidth)
        * Math.max(0, 1 - vertical / 0.88);
      const updraftRib = updraftCore
        * (Math.sin(x * 0.72 + blueprint.seed) > 0.05 ? 14 : 4);
      const anvilHighlight = blueprint.structure === "anvil"
        && vertical < 0.3
        && horizontal > 0.25
        && horizontal < 0.78
        ? 18 * (1 - vertical / 0.3)
        : 0;
      const cellularFold = (
        Math.sin(x * 0.24 + y * 0.41 + blueprint.seed)
        + Math.sin(x * 0.51 - y * 0.19 + blueprint.seed * 0.37)
      ) * 0.5;
      const shadowCavity = density > 0.22 && vertical > 0.2
        ? Math.max(0, -cellularFold) * 27 + (noise < 0.12 ? 11 : 0)
        : 0;
      const undersideBand = lowerShadow
        * (10 + Math.max(0, Math.sin(x * 0.19 + y * 0.73 + blueprint.seed)) * 17);
      const rimLight = density < 0.2 && vertical < 0.64 ? 11 : 0;
      const tone = Math.max(
        105,
        Math.min(
          252,
          188
            + upperLight * 39
            + scallopLight * 9
            + updraftRib
            + anvilHighlight
            + rimLight
            - lowerShadow * 62
            - undersideBand
            - shadowCavity
            + dither,
        ),
      );
      const edgeAlpha = density < 0.09 ? 176 : density < 0.16 ? 224 : 255;
      image.data[offset] = tone;
      image.data[offset + 1] = tone;
      image.data[offset + 2] = Math.min(255, tone + 5);
      image.data[offset + 3] = edgeAlpha;
      logicalOpaquePixels += 1;
    }
  }

  logicalCtx.putImageData(image, 0, 0);
  const canvas = document.createElement("canvas");
  canvas.width = blueprint.width * blueprint.scale;
  canvas.height = blueprint.height * blueprint.scale;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(logical, 0, 0, canvas.width, canvas.height);
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    opaquePixels: logicalOpaquePixels * blueprint.scale * blueprint.scale,
  };
};

export const getParkCloudSprites = () => {
  if (!cachedCloudSprites) cachedCloudSprites = CLOUD_BLUEPRINTS.map(buildCloudSprite);
  return cachedCloudSprites;
};

export const parkCloudOpaquePixelCount = () =>
  getParkCloudSprites().reduce((sum, sprite) => sum + sprite.opaquePixels, 0);
