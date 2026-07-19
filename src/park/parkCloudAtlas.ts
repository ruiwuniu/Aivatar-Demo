export const PARK_CLOUD_ATLAS_ASSET = "/park/cumulonimbus-cloud-time-atlas.png";

export type ParkCloudLightVariant = "dawn" | "noon" | "sunset";

export interface ParkCloudAtlasStyle {
  variants: Record<ParkCloudLightVariant, HTMLCanvasElement>;
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  opaquePixels: number;
}

type AtlasRow = { y: number; height: number };
type CellResult = {
  canvas: HTMLCanvasElement;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  opaquePixels: number;
};

const ATLAS_COLUMN_WIDTH = 418;
const ATLAS_ROWS: AtlasRow[] = [
  { y: 0, height: 257 },
  { y: 257, height: 187 },
  { y: 444, height: 207 },
  { y: 651, height: 121 },
  { y: 772, height: 109 },
  { y: 881, height: 107 },
  { y: 988, height: 132 },
  { y: 1120, height: 134 },
];
const CLOUD_VARIANTS: ParkCloudLightVariant[] = ["dawn", "noon", "sunset"];
const BLACK_KEY_CUTOFF = 48;
const SPRITE_SAFE_MARGIN = 4;
const CUMULONIMBUS_STYLE_COUNT = 3;
const CUMULONIMBUS_BOTTOM_EDGE_ALPHA = [96, 184, 232] as const;

let cachedStyles: ParkCloudAtlasStyle[] = [];
let loadingStarted = false;

const newCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const erodeMask = (mask: Uint8Array, width: number, height: number) => {
  const eroded = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      eroded[index] = mask[index]
        && mask[index - 1]
        && mask[index + 1]
        && mask[index - width]
        && mask[index + width]
        ? 1
        : 0;
    }
  }
  return eroded;
};

const featherCumulonimbusBottomEdge = (
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
) => {
  for (let x = 0; x < width; x += 1) {
    let bottomY = -1;
    for (let y = height - 1; y >= 0; y -= 1) {
      if (mask[y * width + x] !== 0) {
        bottomY = y;
        break;
      }
    }
    if (bottomY < 0) continue;

    for (let depth = 0; depth < CUMULONIMBUS_BOTTOM_EDGE_ALPHA.length; depth += 1) {
      const y = bottomY - depth;
      if (y < 0) break;
      const maskIndex = y * width + x;
      if (mask[maskIndex] === 0) break;
      const alphaIndex = maskIndex * 4 + 3;
      pixels[alphaIndex] = Math.min(
        pixels[alphaIndex] ?? 255,
        CUMULONIMBUS_BOTTOM_EDGE_ALPHA[depth]!,
      );
    }
  }
};

const keyAtlasCell = (
  image: HTMLImageElement,
  row: AtlasRow,
  column: number,
  smoothBottomEdge: boolean,
): CellResult | null => {
  const canvas = newCanvas(ATLAS_COLUMN_WIDTH, row.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    image,
    column * ATLAS_COLUMN_WIDTH,
    row.y,
    ATLAS_COLUMN_WIDTH,
    row.height,
    0,
    0,
    ATLAS_COLUMN_WIDTH,
    row.height,
  );
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const solidMask = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < solidMask.length; index += 1) {
    const pixelIndex = index * 4;
    solidMask[index] = Math.max(
      pixels[pixelIndex] ?? 0,
      pixels[pixelIndex + 1] ?? 0,
      pixels[pixelIndex + 2] ?? 0,
    ) > BLACK_KEY_CUTOFF ? 1 : 0;
  }
  const erodedMask = erodeMask(solidMask, canvas.width, canvas.height);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const maskIndex = y * canvas.width + x;
      const pixelIndex = maskIndex * 4;
      if (erodedMask[maskIndex] === 0) {
        pixels[pixelIndex] = 0;
        pixels[pixelIndex + 1] = 0;
        pixels[pixelIndex + 2] = 0;
        pixels[pixelIndex + 3] = 0;
        continue;
      }
      pixels[pixelIndex + 3] = 255;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      opaquePixels += 1;
    }
  }

  if (smoothBottomEdge) {
    featherCumulonimbusBottomEdge(pixels, erodedMask, canvas.width, canvas.height);
  }

  if (maxX < minX || maxY < minY) return null;
  ctx.putImageData(imageData, 0, 0);
  return { canvas, minX, minY, maxX, maxY, opaquePixels };
};

const buildCloudStyle = (
  image: HTMLImageElement,
  row: AtlasRow,
  styleIndex: number,
): ParkCloudAtlasStyle | null => {
  const cells = CLOUD_VARIANTS.map((_, column) => keyAtlasCell(
    image,
    row,
    column,
    styleIndex < CUMULONIMBUS_STYLE_COUNT,
  ));
  if (cells.some((cell) => !cell)) return null;
  const keyedCells = cells as CellResult[];
  const minX = Math.min(...keyedCells.map((cell) => cell.minX));
  const minY = Math.min(...keyedCells.map((cell) => cell.minY));
  const maxX = Math.max(...keyedCells.map((cell) => cell.maxX));
  const maxY = Math.max(...keyedCells.map((cell) => cell.maxY));
  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const width = contentWidth + SPRITE_SAFE_MARGIN * 2;
  const height = contentHeight + SPRITE_SAFE_MARGIN * 2;
  const variants = {} as Record<ParkCloudLightVariant, HTMLCanvasElement>;

  CLOUD_VARIANTS.forEach((variant, index) => {
    const canvas = newCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      keyedCells[index]!.canvas,
      minX,
      minY,
      contentWidth,
      contentHeight,
      SPRITE_SAFE_MARGIN,
      SPRITE_SAFE_MARGIN,
      contentWidth,
      contentHeight,
    );
    variants[variant] = canvas;
  });

  return {
    variants,
    width,
    height,
    contentWidth,
    contentHeight,
    opaquePixels: keyedCells.reduce((sum, cell) => sum + cell.opaquePixels, 0),
  };
};

export const ensureParkCloudAtlas = () => {
  if (loadingStarted || cachedStyles.length > 0) return;
  loadingStarted = true;
  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", () => {
    cachedStyles = ATLAS_ROWS
      .map((row, styleIndex) => buildCloudStyle(image, row, styleIndex))
      .filter((style): style is ParkCloudAtlasStyle => Boolean(style));
    window.dispatchEvent(new CustomEvent("aivatar:park-cloud-atlas-ready"));
  });
  image.addEventListener("error", () => {
    loadingStarted = false;
  });
  image.src = PARK_CLOUD_ATLAS_ASSET;
};

export const getParkCloudAtlasStyles = () => cachedStyles;

export const parkCloudAtlasOpaquePixelCount = () =>
  cachedStyles.reduce((sum, style) => sum + style.opaquePixels, 0);
