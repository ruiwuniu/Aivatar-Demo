import {
  cardLabel,
  visibleHoleCardsForPlayer,
  type CardRoomCharacter,
  type HoldemPlayer,
  type HoldemStreet,
  type HoldemTableState,
  type PlayingCard,
} from "./holdemEngine";
import {
  CARD_ROOM_WALNUT_FLOOR_SPRITE,
  type CardRoomFloorSpriteDefinition,
} from "./cardRoomFloorSprites";
import { CARD_ROOM_DEFAULT_WALL_SPRITE } from "./cardRoomWallSprites";
import { CARD_ROOM_POKER_TABLE_SPRITE } from "./cardRoomTableSprites";
import {
  CARD_ROOM_RED_SOFA_SIDE_FOREGROUND_SPRITES,
  CARD_ROOM_RED_SOFA_SPRITES,
} from "./cardRoomSeatSprites";
import { drawAvatar } from "../game/renderScene";
import type {
  AivatarContent,
  AivatarMemory,
  AvatarRuntime,
  CodexStatusMessage,
  FurnitureDefinition,
} from "../types";
import { cardRoomDefaultPetStats } from "./cardRoomContent";
import type { CardRoomActionCue } from "./cardRoomRuntime";

export const cardRoomSceneSize = {
  width: 960,
  height: 640,
};

const TOP_OPPONENT_SEAT_COUNT = 6;
const VISIBLE_OPPONENT_SEAT_COUNT = 8;
const TABLE_CARD_SCALE = 0.62;
const POKER_TABLE_X = 160;
const POKER_TABLE_Y = 320;
const POKER_TABLE_WIDTH = 640;
const POKER_TABLE_HEIGHT = 220;
const SIDE_OPPONENT_VERTICAL_CARD_WIDTH = Math.round(42 * TABLE_CARD_SCALE);
const SIDE_OPPONENT_SEAT_Y_OFFSET = 64 - SIDE_OPPONENT_VERTICAL_CARD_WIDTH;
const SIDE_OPPONENT_CARD_Y_OFFSET = 30 - SIDE_OPPONENT_VERTICAL_CARD_WIDTH;
const SIDE_OPPONENT_BET_Y_OFFSET = 90 - SIDE_OPPONENT_VERTICAL_CARD_WIDTH;
const COMMUNITY_CARD_FRAME_CENTERS_X = [224.5, 272, 319.5, 367.5, 414.5] as const;
const COMMUNITY_CARD_FRAME_CENTER_Y = 125;

interface CardRoomRenderLayout {
  width: number;
  height: number;
  originX: number;
  originY: number;
}

type CardRoomBubble = {
  text: string;
  startedAt: number;
};

export interface CardRoomTableMotion {
  handNumber: number;
  handStartedAt: number;
  street: HoldemStreet;
  streetStartedAt: number;
  actionSerial: number;
  actionStartedAt: number;
  communityRevealFrom: number;
  communityRevealCount: number;
  communityRevealStartedAt: number;
  completionStartedAt: number | null;
  winningAvatarIds: string[];
  userVictoryStartedAt: number | null;
}

type CardRoomDepthRenderItem = {
  depth: number;
  order: number;
  draw: () => void;
};

const CARD_ROOM_CITY_WINDOW_SPRITE_SRC = "/assets/card-room/city-window-wide.png";
const CARD_ROOM_CITY_WINDOW_SPRITE_WIDTH = 480;
const CARD_ROOM_CITY_WINDOW_SPRITE_HEIGHT = 154;
const CARD_ROOM_CITY_WINDOW_GLASS = {
  x: 34,
  y: 37,
  width: 412,
  height: 84,
};
const CARD_ROOM_WALL_SCONCE_SPRITE_SRC = "/assets/card-room/wall-sconce.png?v=2";
const CARD_ROOM_WALL_SCONCE_SPRITE_WIDTH = 24;
const CARD_ROOM_WALL_SCONCE_SPRITE_HEIGHT = 36;

let cardRoomCityWindowSprite: HTMLImageElement | null = null;
let cardRoomWallSconceSprite: HTMLImageElement | null = null;

const suitColor: Record<string, string> = {
  h: "#c72336",
  d: "#c72336",
  c: "#111827",
  s: "#111827",
};

const drawPixelRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
};

const drawPixelStroke = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  thickness = 2,
) => {
  drawPixelRect(ctx, x, y, width, thickness, color);
  drawPixelRect(ctx, x, y + height - thickness, width, thickness, color);
  drawPixelRect(ctx, x, y, thickness, height, color);
  drawPixelRect(ctx, x + width - thickness, y, thickness, height, color);
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const easeOutCubic = (value: number) => {
  const clamped = clamp01(value);
  return 1 - (1 - clamped) ** 3;
};

const easeInOutSine = (value: number) =>
  0.5 - Math.cos(clamp01(value) * Math.PI) / 2;

const lerp = (start: number, end: number, progress: number) =>
  start + (end - start) * progress;

const timedProgress = (now: number, startAt: number, durationMs: number) => {
  if (now < startAt) return -1;
  return clamp01((now - startAt) / Math.max(1, durationMs));
};

const getCardRoomCityWindowSprite = (ctx: CanvasRenderingContext2D) => {
  if (!cardRoomCityWindowSprite) {
    const image = ctx.canvas.ownerDocument.createElement("img");
    image.decoding = "async";
    image.src = CARD_ROOM_CITY_WINDOW_SPRITE_SRC;
    cardRoomCityWindowSprite = image;
  }

  return cardRoomCityWindowSprite.complete && cardRoomCityWindowSprite.naturalWidth > 0
    ? cardRoomCityWindowSprite
    : null;
};

const getCardRoomWallSconceSprite = (ctx: CanvasRenderingContext2D) => {
  if (!cardRoomWallSconceSprite) {
    const image = ctx.canvas.ownerDocument.createElement("img");
    image.decoding = "async";
    image.src = CARD_ROOM_WALL_SCONCE_SPRITE_SRC;
    cardRoomWallSconceSprite = image;
  }

  return cardRoomWallSconceSprite.complete && cardRoomWallSconceSprite.naturalWidth > 0
    ? cardRoomWallSconceSprite
    : null;
};

const drawCardRoomWallSconce = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  topY: number,
  frame: number,
) => {
  const sprite = getCardRoomWallSconceSprite(ctx);
  const x = Math.round(centerX - CARD_ROOM_WALL_SCONCE_SPRITE_WIDTH / 2);
  const y = Math.round(topY);
  const glowX = Math.round(centerX);
  const glowY = y + 17;
  const glowRadius = 46;
  const glowPulse = 0.92 + Math.sin(frame / 31) * 0.06;

  ctx.save();
  const glow = ctx.createRadialGradient(glowX, glowY, 4, glowX, glowY, glowRadius);
  glow.addColorStop(0, `rgba(255, 236, 180, ${(0.2 * glowPulse).toFixed(3)})`);
  glow.addColorStop(0.24, `rgba(251, 191, 36, ${(0.14 * glowPulse).toFixed(3)})`);
  glow.addColorStop(0.68, `rgba(245, 158, 11, ${(0.055 * glowPulse).toFixed(3)})`);
  glow.addColorStop(1, "rgba(245, 158, 11, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(glowX - glowRadius, glowY - glowRadius, glowRadius * 2, glowRadius * 2);
  drawPixelRect(ctx, glowX - 6, glowY - 5, 12, 10, "rgba(255, 245, 200, 0.22)");
  ctx.restore();

  if (!sprite) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite,
    x,
    y,
    CARD_ROOM_WALL_SCONCE_SPRITE_WIDTH,
    CARD_ROOM_WALL_SCONCE_SPRITE_HEIGHT,
  );
};

const drawCardRoomCityWindow = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  variant: "default" | "neon" | "private",
) => {
  const outerX = x - 24;
  const outerY = y - 18;
  const sprite = getCardRoomCityWindowSprite(ctx);
  if (!sprite) return;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite,
    Math.round(outerX),
    Math.round(outerY),
    CARD_ROOM_CITY_WINDOW_SPRITE_WIDTH,
    CARD_ROOM_CITY_WINDOW_SPRITE_HEIGHT,
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    Math.round(outerX + CARD_ROOM_CITY_WINDOW_GLASS.x),
    Math.round(outerY + CARD_ROOM_CITY_WINDOW_GLASS.y),
    CARD_ROOM_CITY_WINDOW_GLASS.width,
    CARD_ROOM_CITY_WINDOW_GLASS.height,
  );
  ctx.clip();

  const aviationLights = [
    [29, 55],
    [104, 58],
    [141, 48],
    [214, 51],
    [279, 50],
    [338, 54],
    [420, 57],
  ] as const;
  aviationLights.forEach(([lightX, lightY], index) => {
    const pulse = (Math.floor(frame) + index * 13) % 96;
    const on = pulse < 5 || (pulse >= 13 && pulse < 17);
    drawPixelRect(ctx, outerX + lightX, outerY + lightY, 2, 2, on ? "#ff3b30" : "#5f1111");
    if (on) {
      drawPixelRect(ctx, outerX + lightX - 1, outerY + lightY + 1, 4, 1, "rgba(255, 95, 86, 0.42)");
    }
  });

  const neonFaster = variant === "neon";
  const neonSigns = [
    { x: 29, y: 78, width: 3, height: 22, color: "#ff4fd8", phase: 0, cycle: 91 },
    { x: 112, y: 87, width: 39, height: 3, color: "#ff4fd8", phase: 17, cycle: 123 },
    { x: 177, y: 75, width: 27, height: 3, color: "#35e9ff", phase: 31, cycle: 107 },
    { x: 306, y: 90, width: 4, height: 26, color: "#35e9ff", phase: 11, cycle: 139 },
    { x: 385, y: 95, width: 35, height: 3, color: "#ff4fd8", phase: 43, cycle: 113 },
  ] as const;
  neonSigns.forEach((sign) => {
    const period = neonFaster ? Math.max(54, sign.cycle - 32) : sign.cycle;
    const t = (Math.floor(frame * 0.85) + sign.phase) % period;
    const brightness =
      t < 2
        ? 0.18
        : t < 5
          ? 0.62
          : t === 17 || t === 18 || t === Math.floor(period * 0.73)
            ? 0.28
            : t > period - 4
              ? 0.48
              : 1;
    const previousAlpha = ctx.globalAlpha;
    ctx.globalAlpha = brightness;
    drawPixelRect(ctx, outerX + sign.x, outerY + sign.y, sign.width, sign.height, sign.color);
    ctx.globalAlpha = Math.min(1, brightness * 0.42);
    drawPixelRect(
      ctx,
      outerX + sign.x - 1,
      outerY + sign.y,
      sign.width + 2,
      Math.max(1, sign.height),
      "rgba(255, 255, 255, 0.28)",
    );
    ctx.globalAlpha = previousAlpha;
  });
  ctx.restore();
};

const surfacePalette = (
  surfaces: AivatarContent["room"]["wallSurfaces"],
  surfaceId: string | undefined,
  fallbackId: string,
) =>
  surfaces?.find((surface) => surface.id === surfaceId)?.palette ??
  surfaces?.find((surface) => surface.id === fallbackId)?.palette;

interface CachedCardRoomMatrixSprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

const cardRoomMatrixSpriteCache = new WeakMap<
  readonly string[],
  WeakMap<Record<string, string>, CachedCardRoomMatrixSprite>
>();

const drawCardRoomMatrixSpriteRows = (
  ctx: CanvasRenderingContext2D,
  spriteX: number,
  spriteY: number,
  palette: Record<string, string>,
  rows: readonly string[],
  tokenWidth = 1,
) => {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    let runColor: string | null = null;
    let runStart = 0;
    const columnCount = Math.floor(row.length / tokenWidth);

    for (let column = 0; column <= columnCount; column += 1) {
      const token =
        column < columnCount
          ? row.slice(column * tokenWidth, column * tokenWidth + tokenWidth)
          : "";
      const color = token ? palette[token] ?? null : null;

      if (color === runColor) continue;

      if (runColor) {
        drawPixelRect(ctx, spriteX + runStart, spriteY + rowIndex, column - runStart, 1, runColor);
      }

      runColor = color;
      runStart = column;
    }
  }
};

const getCachedCardRoomMatrixSprite = (
  ctx: CanvasRenderingContext2D,
  sprite: CardRoomFloorSpriteDefinition,
) => {
  let paletteCache = cardRoomMatrixSpriteCache.get(sprite.rows);
  if (!paletteCache) {
    paletteCache = new WeakMap<Record<string, string>, CachedCardRoomMatrixSprite>();
    cardRoomMatrixSpriteCache.set(sprite.rows, paletteCache);
  }

  const cachedSprite = paletteCache.get(sprite.palette);
  if (cachedSprite) return cachedSprite;

  const cacheCanvas = ctx.canvas.ownerDocument.createElement("canvas");
  cacheCanvas.width = sprite.width;
  cacheCanvas.height = sprite.height;
  const cacheCtx = cacheCanvas.getContext("2d");
  if (!cacheCtx) return null;

  cacheCtx.imageSmoothingEnabled = false;
  drawCardRoomMatrixSpriteRows(cacheCtx, 0, 0, sprite.palette, sprite.rows, sprite.tokenWidth);

  const nextSprite = {
    canvas: cacheCanvas,
    width: sprite.width,
    height: sprite.height,
  };
  paletteCache.set(sprite.palette, nextSprite);
  return nextSprite;
};

const drawCardRoomMatrixSprite = (
  ctx: CanvasRenderingContext2D,
  sprite: CardRoomFloorSpriteDefinition,
  x: number,
  y: number,
  width = sprite.width,
  height = sprite.height,
) => {
  const cachedSprite = getCachedCardRoomMatrixSprite(ctx, sprite);
  if (!cachedSprite) {
    drawCardRoomMatrixSpriteRows(ctx, x, y, sprite.palette, sprite.rows, sprite.tokenWidth);
    return;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    cachedSprite.canvas,
    Math.round(x),
    Math.round(y),
    Math.round(width),
    Math.round(height),
  );
};

const drawSuitIcon = (
  ctx: CanvasRenderingContext2D,
  suit: PlayingCard["suit"],
  centerX: number,
  centerY: number,
  unit: number,
  color = suitColor[suit],
) => {
  const u = Math.max(1, Math.round(unit));
  const x = Math.round(centerX);
  const y = Math.round(centerY);
  if (suit === "h") {
    drawPixelRect(ctx, x - 4 * u, y - 3 * u, 3 * u, 2 * u, color);
    drawPixelRect(ctx, x + u, y - 3 * u, 3 * u, 2 * u, color);
    drawPixelRect(ctx, x - 5 * u, y - u, 10 * u, 3 * u, color);
    drawPixelRect(ctx, x - 3 * u, y + 2 * u, 6 * u, 2 * u, color);
    drawPixelRect(ctx, x - u, y + 4 * u, 2 * u, 2 * u, color);
  } else if (suit === "d") {
    drawPixelRect(ctx, x - u, y - 5 * u, 2 * u, 2 * u, color);
    drawPixelRect(ctx, x - 3 * u, y - 3 * u, 6 * u, 2 * u, color);
    drawPixelRect(ctx, x - 5 * u, y - u, 10 * u, 2 * u, color);
    drawPixelRect(ctx, x - 3 * u, y + u, 6 * u, 2 * u, color);
    drawPixelRect(ctx, x - u, y + 3 * u, 2 * u, 2 * u, color);
  } else if (suit === "c") {
    drawPixelRect(ctx, x - 2 * u, y - 5 * u, 4 * u, 4 * u, color);
    drawPixelRect(ctx, x - 5 * u, y - u, 4 * u, 4 * u, color);
    drawPixelRect(ctx, x + u, y - u, 4 * u, 4 * u, color);
    drawPixelRect(ctx, x - 2 * u, y + u, 4 * u, 3 * u, color);
    drawPixelRect(ctx, x - u, y + 4 * u, 2 * u, 3 * u, color);
    drawPixelRect(ctx, x - 3 * u, y + 6 * u, 6 * u, u, color);
  } else {
    drawPixelRect(ctx, x - 5 * u, y - 2 * u, 10 * u, 3 * u, color);
    drawPixelRect(ctx, x - 3 * u, y - 4 * u, 6 * u, 2 * u, color);
    drawPixelRect(ctx, x - u, y - 6 * u, 2 * u, 2 * u, color);
    drawPixelRect(ctx, x - 3 * u, y + u, 6 * u, 2 * u, color);
    drawPixelRect(ctx, x - u, y + 3 * u, 2 * u, 4 * u, color);
    drawPixelRect(ctx, x - 3 * u, y + 6 * u, 6 * u, u, color);
  }
};

const drawText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    color?: string;
    size?: number;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    weight?: string;
  } = {},
) => {
  ctx.fillStyle = options.color ?? "#f8fafc";
  ctx.font = `${options.weight ?? "700"} ${options.size ?? 14}px "Antonio", monospace`;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = options.baseline ?? "top";
  ctx.fillText(text, Math.round(x), Math.round(y));
};

const drawCardBack = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width = 42,
  height = 58,
) => {
  drawPixelRect(ctx, x + 2, y + 3, width, height, "rgba(2, 6, 23, 0.35)");
  drawPixelRect(ctx, x, y, width, height, "#111827");
  drawPixelRect(ctx, x + 3, y + 3, width - 6, height - 6, "#134e4a");
  drawPixelRect(ctx, x + 6, y + 6, width - 12, height - 12, "#0f766e");
  drawPixelStroke(ctx, x + 7, y + 7, width - 14, height - 14, "#5eead4", 1);
  drawPixelRect(ctx, x + width / 2 - 7, y + height / 2 - 8, 14, 16, "#042f2e");
  drawPixelRect(ctx, x + width / 2 - 4, y + height / 2 - 5, 8, 10, "#14b8a6");
  const dot = Math.max(1, Math.round(Math.min(width, height) * 0.07));
  const startX = x + width * 0.22;
  const startY = y + height * 0.2;
  const gapX = width * 0.18;
  const gapY = height * 0.14;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      if ((row + col) % 2 === 0) {
        drawPixelRect(ctx, startX + col * gapX, startY + row * gapY, dot, dot, "#99f6e4");
      }
    }
  }
};

export const drawPlayingCard = (
  ctx: CanvasRenderingContext2D,
  card: PlayingCard | null,
  x: number,
  y: number,
  options: { hidden?: boolean; scale?: number } = {},
) => {
  const scale = options.scale ?? 1;
  const width = 42 * scale;
  const height = 58 * scale;
  if (!card || options.hidden) {
    drawCardBack(ctx, x, y, width, height);
    return;
  }

  const label = card.rank === "T" ? "10" : card.rank;
  const ink = suitColor[card.suit];
  const border = Math.max(2, Math.round(3 * scale));
  const inner = border + 2 * scale;
  const labelSize = (label.length > 1 ? 17 : 21) * scale;
  const suitScale = scale * 1.28;
  const suitUnit = Math.max(1, Math.round(suitScale));
  const suitCenterX = x + width - border - suitUnit * 5 - 1;
  const suitCenterY = y + height - border - suitUnit * 7 - 1;

  drawPixelRect(ctx, x + 2 * scale, y + 3 * scale, width, height, "rgba(2, 6, 23, 0.25)");
  drawPixelRect(ctx, x, y, width, height, "#111827");
  drawPixelRect(ctx, x + border, y + border, width - border * 2, height - border * 2, "#fffdf7");
  drawPixelRect(
    ctx,
    x + inner,
    y + inner,
    width - inner * 2,
    height - inner * 2,
    "#fff7ed",
  );
  drawPixelRect(ctx, x + border, y + border, width - border * 2, Math.max(1, scale), "#ffffff");
  drawText(ctx, label, x + 6 * scale, y + 6 * scale, {
    color: ink,
    size: labelSize,
    weight: "900",
  });
  drawSuitIcon(ctx, card.suit, suitCenterX, suitCenterY, suitScale, ink);
};

const drawDealerShuffle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  motion: CardRoomTableMotion | undefined,
  table: HoldemTableState,
  now: number,
) => {
  if (!motion || motion.handNumber !== table.handNumber || table.street === "waiting") return;
  const elapsed = now - motion.handStartedAt;
  if (elapsed < 0 || elapsed > 760) return;

  const scale = TABLE_CARD_SCALE;
  const width = 42 * scale;
  const height = 58 * scale;
  const fade = elapsed < 560 ? 1 : clamp01(1 - (elapsed - 560) / 200);
  const split = Math.sin(elapsed / 58);
  ctx.save();
  ctx.globalAlpha = fade;
  for (let index = 0; index < 6; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const layer = Math.floor(index / 2);
    const phase = elapsed / 72 + index * 1.7;
    const offsetX = side * (6 + layer * 4) * Math.abs(split) + Math.sin(phase) * 2;
    const offsetY = -layer * 2 + Math.cos(phase) * 2;
    const tilt = side * (0.06 + layer * 0.025) * split;
    ctx.save();
    ctx.translate(Math.round(x + offsetX), Math.round(y + offsetY));
    ctx.rotate(tilt);
    drawPlayingCard(ctx, null, -width / 2, -height / 2, {
      hidden: true,
      scale,
    });
    ctx.restore();
  }
  ctx.restore();
};

const localTopLeftFromGlobal = (
  globalX: number,
  globalY: number,
  originX: number,
  originY: number,
  rotation: number,
) => {
  const dx = globalX - originX;
  const dy = globalY - originY;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
};

const drawWinnerBurst = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ageMs: number,
  frame: number,
) => {
  if (ageMs < 0 || ageMs > 6400) return;
  const fadeIn = clamp01(ageMs / 220);
  const fadeOut = ageMs > 5400 ? clamp01(1 - (ageMs - 5400) / 1000) : 1;
  const alpha = fadeIn * fadeOut;
  const pulse = 1 + Math.sin(frame * 0.42) * 0.1;
  const reveal = clamp01(ageMs / 760);
  const rayCount = 22;
  const innerRadius = 9 * pulse;
  const outerRadius = (34 + reveal * 18) * pulse;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "lighter";

  const beam = ctx.createLinearGradient(x, y - 92, x, y + 76);
  beam.addColorStop(0, "rgba(255, 250, 205, 0)");
  beam.addColorStop(0.36, "rgba(255, 238, 142, 0.2)");
  beam.addColorStop(0.68, "rgba(250, 204, 21, 0.12)");
  beam.addColorStop(1, "rgba(255, 250, 205, 0)");
  ctx.fillStyle = beam;
  ctx.fillRect(x - 42, y - 94, 84, 178);

  const glow = ctx.createRadialGradient(x, y, 4, x, y, 58);
  glow.addColorStop(0, "rgba(255, 255, 226, 0.98)");
  glow.addColorStop(0.2, "rgba(255, 229, 118, 0.75)");
  glow.addColorStop(0.55, "rgba(244, 114, 182, 0.22)");
  glow.addColorStop(0.82, "rgba(45, 212, 191, 0.12)");
  glow.addColorStop(1, "rgba(251, 191, 36, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - 64, y - 64, 128, 128);

  for (let index = 0; index < rayCount; index += 1) {
    const angle = (Math.PI * 2 * index) / rayCount + frame * 0.018;
    const wobble = Math.sin(frame * 0.28 + index * 1.7) * 7;
    const start = innerRadius + (index % 2) * 3;
    const end = outerRadius + wobble;
    ctx.lineWidth = index % 4 === 0 ? 3 : 2;
    ctx.strokeStyle =
      index % 5 === 0
        ? "#ffffff"
        : index % 5 === 1
          ? "#fff3a3"
          : index % 5 === 2
            ? "#facc15"
            : index % 5 === 3
              ? "#fb7185"
              : "#5eead4";
    ctx.beginPath();
    ctx.moveTo(Math.round(x + Math.cos(angle) * start), Math.round(y + Math.sin(angle) * start));
    ctx.lineTo(Math.round(x + Math.cos(angle) * end), Math.round(y + Math.sin(angle) * end));
    ctx.stroke();
  }

  for (let ring = 0; ring < 3; ring += 1) {
    const size = 34 + ring * 18 + Math.sin(frame * 0.2 + ring) * 3;
    ctx.globalAlpha = alpha * (0.36 - ring * 0.08);
    drawPixelStroke(ctx, x - size / 2, y - size / 2, size, size, ring === 1 ? "#f0abfc" : "#fde68a", 2);
  }
  ctx.globalAlpha = alpha;

  for (let index = 0; index < 12; index += 1) {
    const angle = (Math.PI * 2 * index) / 12 - frame * 0.032;
    const sparkleRadius = 25 + Math.sin(frame * 0.37 + index) * 11;
    drawPixelRect(
      ctx,
      x + Math.cos(angle) * sparkleRadius - 2,
      y + Math.sin(angle) * sparkleRadius - 2,
      index % 3 === 0 ? 5 : 4,
      index % 3 === 0 ? 5 : 4,
      index % 4 === 0 ? "#ffffff" : index % 4 === 1 ? "#fde68a" : index % 4 === 2 ? "#f472b6" : "#5eead4",
    );
  }

  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10 + frame * 0.04;
    const radius = 36 + (index % 2) * 11 + Math.sin(frame * 0.22 + index) * 4;
    const chipX = Math.round(x + Math.cos(angle) * radius);
    const chipY = Math.round(y + Math.sin(angle) * (radius * 0.46));
    const chipColor = index % 3 === 0 ? "#facc15" : index % 3 === 1 ? "#14b8a6" : "#f472b6";
    drawPixelRect(ctx, chipX - 5, chipY + 2, 10, 3, "rgba(17, 24, 39, 0.48)");
    drawPixelRect(ctx, chipX - 4, chipY - 2, 8, 5, "#111827");
    drawPixelRect(ctx, chipX - 3, chipY - 3, 6, 5, chipColor);
    drawPixelRect(ctx, chipX - 1, chipY - 4, 2, 1, "#fff7ed");
  }

  const crownLift = Math.round(Math.sin(frame * 0.28) * 2);
  const crownY = y - 10 + crownLift;
  drawPixelRect(ctx, x - 18, crownY + 10, 36, 5, "rgba(17, 24, 39, 0.68)");
  drawPixelRect(ctx, x - 16, crownY + 5, 32, 10, "#7c2d12");
  drawPixelRect(ctx, x - 14, crownY + 3, 7, 11, "#facc15");
  drawPixelRect(ctx, x - 4, crownY - 2, 8, 16, "#fde047");
  drawPixelRect(ctx, x + 7, crownY + 3, 7, 11, "#facc15");
  drawPixelRect(ctx, x - 13, crownY + 9, 26, 4, "#f59e0b");
  drawPixelRect(ctx, x - 11, crownY + 6, 4, 3, "#ef4444");
  drawPixelRect(ctx, x - 2, crownY + 4, 4, 3, "#5eead4");
  drawPixelRect(ctx, x + 7, crownY + 6, 4, 3, "#ef4444");

  const plaqueY = y + 34 + Math.round(Math.sin(frame * 0.18) * 2);
  drawPixelRect(ctx, x - 31, plaqueY - 2, 62, 18, "rgba(17, 24, 39, 0.78)");
  drawPixelRect(ctx, x - 28, plaqueY - 5, 56, 18, "#7c2d12");
  drawPixelStroke(ctx, x - 28, plaqueY - 5, 56, 18, "#fde68a", 2);
  drawText(ctx, "WIN", x, plaqueY - 1, {
    align: "center",
    color: "#fff7ad",
    size: 12,
    weight: "900",
  });

  for (let index = 0; index < 18; index += 1) {
    const fall = ((ageMs / 32 + index * 19) % 120) - 42;
    const sway = Math.sin(frame * 0.18 + index * 0.9) * 20;
    const confettiX = x + sway + (index % 6 - 2.5) * 10;
    const confettiY = y - 64 + fall;
    const color = index % 5 === 0 ? "#facc15" : index % 5 === 1 ? "#f472b6" : index % 5 === 2 ? "#5eead4" : index % 5 === 3 ? "#ffffff" : "#fb923c";
    drawPixelRect(ctx, confettiX, confettiY, index % 2 ? 5 : 3, 3, color);
  }

  ctx.restore();
};

const stackLabel = (stack: number) => (stack >= 0 ? `${stack}` : `-${Math.abs(stack)}`);

const cardRoomIdleStatus: CodexStatusMessage = {
  agent: "aivatar",
  sessionId: "card-room-render",
  status: "idle",
  phase: "card-room",
  task: "Card room",
  timestamp: new Date(0).toISOString(),
};

const memoryForCharacter = (character: CardRoomCharacter): AivatarMemory => ({
  recentEvents: [],
  growth: {
    level: character.growthLevel,
    xp: 0,
    totalXp: 0,
    completedTurns: 0,
    errorCount: 0,
    errorRecoveries: 0,
    waitingTurns: 0,
    weightedTokensLearned: 0,
    traits: character.traits,
  },
  darkTraits: character.darkTraits,
  preferences: {
    activityWeights: {},
    itemAffinities: {},
  },
  milestones: [],
});

const actionCueProgress = (cue: CardRoomActionCue | undefined) => {
  if (!cue) return 0;
  const progress = (performance.now() - cue.startedAt) / cue.durationMs;
  if (progress < 0 || progress > 1) return 0;
  return Math.sin(progress * Math.PI);
};

const actionCueVector = (runtime: AvatarRuntime) => {
  if (runtime.facing === "front") return { x: 0, y: 1 };
  if (runtime.facing === "back") return { x: 0, y: -1 };
  if (runtime.facing === "right") return { x: 1, y: 0 };
  return { x: -1, y: 0 };
};

const runtimeForActionCue = (
  runtime: AvatarRuntime,
  cue: CardRoomActionCue | undefined,
): AvatarRuntime => {
  const pulse = actionCueProgress(cue);
  if (!cue || pulse <= 0) return runtime;
  const vector = actionCueVector(runtime);
  const direction = cue.type === "fold" ? -1 : 1;
  const magnitude =
    cue.type === "think" || cue.type === "hesitate"
      ? 1
      : cue.intensity === "large"
        ? 6
        : cue.intensity === "medium"
          ? 4
          : 2;
  const checkLift = cue.type === "check" ? -Math.round(pulse * 2) : 0;
  return {
    ...runtime,
    x: runtime.x + Math.round(vector.x * pulse * magnitude * direction),
    y: runtime.y + Math.round(vector.y * pulse * magnitude * direction) + checkLift,
  };
};

const drawActionChip = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) => {
  drawPixelRect(ctx, x - 4, y - 2, 8, 4, "#111827");
  drawPixelRect(ctx, x - 3, y - 4, 6, 4, color);
  drawPixelRect(ctx, x - 2, y - 5, 4, 1, "#fef3c7");
};

const drawActionCueEffect = (
  ctx: CanvasRenderingContext2D,
  runtime: AvatarRuntime,
  cue: CardRoomActionCue | undefined,
) => {
  const pulse = actionCueProgress(cue);
  if (!cue || pulse <= 0) return;

  const vector = actionCueVector(runtime);
  const sideVector = { x: -vector.y, y: vector.x };
  const x = runtime.x + vector.x * (20 + pulse * 10);
  const y = runtime.y - 12 + vector.y * (20 + pulse * 10);
  ctx.save();
  ctx.globalAlpha = 0.45 + pulse * 0.55;

  if (cue.type === "fold") {
    const foldX = runtime.x - vector.x * (16 + pulse * 8);
    const foldY = runtime.y - 20 - vector.y * (8 + pulse * 8);
    drawPixelRect(ctx, foldX - 10, foldY - 4, 15, 21, "#e5e7eb");
    drawPixelStroke(ctx, foldX - 10, foldY - 4, 15, 21, "#111827", 2);
    drawPixelRect(ctx, foldX - 3, foldY + 3, 15, 21, "#cbd5e1");
    drawPixelStroke(ctx, foldX - 3, foldY + 3, 15, 21, "#111827", 2);
  } else if (cue.type === "check") {
    drawPixelRect(ctx, runtime.x - 9, runtime.y - 74 - pulse * 3, 18, 3, "#bfdbfe");
    drawPixelRect(ctx, runtime.x - 3, runtime.y - 80 - pulse * 3, 6, 3, "#bfdbfe");
  } else if (
    cue.type === "think" ||
    cue.type === "hesitate" ||
    cue.type === "pressure" ||
    cue.type === "snap"
  ) {
    const dotColor =
      cue.type === "hesitate"
        ? "#fca5a5"
        : cue.type === "pressure"
          ? "#c084fc"
          : cue.type === "snap"
            ? "#fde68a"
            : "#bfdbfe";
    const dotCount = cue.type === "snap" ? 2 : 3;
    for (let index = 0; index < dotCount; index += 1) {
      const dotX = runtime.x - (dotCount - 1) * 4 + index * 8;
      const dotY = runtime.y - 77 - Math.round(Math.sin(pulse * Math.PI + index) * 3);
      drawPixelRect(ctx, dotX - 2, dotY - 2, 4, 4, "#020617");
      drawPixelRect(ctx, dotX - 1, dotY - 3, 3, 3, dotColor);
    }
  } else {
    const chipCount = cue.type === "all-in" ? 5 : cue.type === "raise" ? 4 : 3;
    for (let index = 0; index < chipCount; index += 1) {
      const offset = index - (chipCount - 1) / 2;
      drawActionChip(
        ctx,
        x + sideVector.x * offset * 7,
        y + sideVector.y * offset * 7 - (index % 2) * 4,
        cue.type === "all-in" ? "#f43f5e" : cue.type === "raise" ? "#a855f7" : "#f59e0b",
      );
    }
  }

  ctx.restore();
};

const drawAvatarFigure = (
  ctx: CanvasRenderingContext2D,
  runtime: AvatarRuntime,
  character: CardRoomCharacter,
  player: HoldemPlayer | undefined,
  active: boolean,
  frame: number,
  actionCue?: CardRoomActionCue,
  winnerStartedAt?: number | null,
  now = performance.now(),
) => {
  const displayedRuntime = runtimeForActionCue(runtime, actionCue);
  const x = Math.round(displayedRuntime.x);
  const y = Math.round(displayedRuntime.y);
  if (winnerStartedAt) {
    drawWinnerBurst(ctx, x, y - 54, now - winnerStartedAt, frame);
  }
  drawAvatar(
    ctx,
    displayedRuntime,
    frame,
    cardRoomDefaultPetStats,
    cardRoomIdleStatus,
    memoryForCharacter(character),
    character.avatarAppearanceId,
  );
  drawActionCueEffect(ctx, displayedRuntime, actionCue);

  if (active) {
    drawPixelStroke(ctx, x - 23, y - 45, 46, 66, "#facc15", 2);
  }

  drawText(ctx, character.avatarName.slice(0, 12), x, y - 64, {
    align: "center",
    color: active ? "#fde68a" : "#e5e7eb",
    size: 9,
    weight: "800",
  });
};

const drawCharacterBubble = (
  ctx: CanvasRenderingContext2D,
  runtime: AvatarRuntime,
  bubble: CardRoomBubble | undefined,
) => {
  if (!bubble) return;
  if (performance.now() - bubble.startedAt > 2600) return;

  const text = bubble.text.length > 28 ? `${bubble.text.slice(0, 25)}...` : bubble.text;
  ctx.save();
  ctx.font = `800 8px "Antonio", monospace`;
  const width = Math.min(150, Math.max(48, Math.ceil(ctx.measureText(text).width) + 18));
  const height = 18;
  const x = Math.round(runtime.x - width / 2);
  const y = Math.round(runtime.y - 88);
  drawPixelRect(ctx, x + 3, y + 4, width, height, "#020617");
  drawPixelRect(ctx, x, y, width, height, "#facc15");
  drawPixelRect(ctx, x + 2, y + 2, width - 4, height - 4, "#111827");
  drawPixelRect(ctx, runtime.x - 4, y + height, 8, 4, "#facc15");
  drawPixelRect(ctx, runtime.x - 2, y + height, 4, 3, "#111827");
  drawText(ctx, text, runtime.x, y + 4, {
    align: "center",
    color: "#f8fafc",
    size: 8,
    weight: "800",
  });
  ctx.restore();
};

const shiftedRuntime = (
  runtime: AvatarRuntime,
  layout: CardRoomRenderLayout,
): AvatarRuntime => ({
  ...runtime,
  x: runtime.x + layout.originX,
  y: runtime.y + layout.originY,
  targetX: runtime.targetX + layout.originX,
  targetY: runtime.targetY + layout.originY,
});

const shiftFurniture = (
  item: FurnitureDefinition,
  layout: CardRoomRenderLayout,
): FurnitureDefinition => ({
  ...item,
  x: item.x + layout.originX,
  y: item.y + layout.originY,
  collision: item.collision
    ? {
        ...item.collision,
        x: item.collision.x + layout.originX,
        y: item.collision.y + layout.originY,
      }
    : undefined,
});

const drawRoomShell = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  frame: number,
  layout: CardRoomRenderLayout,
) => {
  const roomWidth = layout.width;
  const roomHeight = layout.height;
  const floorY = Math.max(156, Math.round(roomHeight * 0.3));
  const floorBottom = roomHeight - 24;
  const roomRight = roomWidth - 20;
  const roomInnerRight = roomWidth - 28;
  const usesDefaultWallSprite = (content.room.wallSurfaceId ?? "card-room-wall") === "card-room-wall";
  const wallPalette = surfacePalette(
    content.room.wallSurfaces,
    content.room.wallSurfaceId,
    "card-room-wall",
  );
  const floorPalette = surfacePalette(
    content.room.floorSurfaces,
    content.room.floorSurfaceId,
    "card-room-floor",
  );
  const wallBase = wallPalette?.base ?? "#321a13";
  const wallPanel = wallPalette?.plankA ?? "#3a1f17";
  const wallPanelAlt = wallPalette?.plankB ?? "#2b160f";
  const wallDark = wallPalette?.plankC ?? "#1b0d0a";
  const wallSeam = wallPalette?.seam ?? "#150907";
  const wallHighlight = wallPalette?.highlight ?? "#c56a2c";
  const floorBase = floorPalette?.base ?? "#21110c";
  const floorPanel = floorPalette?.plankA ?? "#301912";
  const floorPanelAlt = floorPalette?.plankB ?? "#27130e";
  const floorDark = floorPalette?.plankC ?? "#3a2118";
  const floorSeam = floorPalette?.seam ?? "#140905";
  const floorHighlight = floorPalette?.highlight ?? "#7c4a31";

  drawPixelRect(ctx, 0, 0, roomWidth, roomHeight, "#06070b");
  drawPixelRect(ctx, 20, 12, roomWidth - 40, roomHeight - 28, "#130b0a");
  if (usesDefaultWallSprite) {
    drawCardRoomMatrixSprite(
      ctx,
      CARD_ROOM_DEFAULT_WALL_SPRITE,
      28,
      20,
      roomWidth - 56,
      floorY - 20,
    );
  } else {
    drawPixelRect(ctx, 28, 20, roomWidth - 56, floorY - 20, wallBase);
    drawPixelRect(ctx, 28, 20, roomWidth - 56, 10, wallPanelAlt);
    drawPixelRect(ctx, 28, floorY - 18, roomWidth - 56, 7, wallDark);
    for (let x = 44; x < roomRight; x += 54) {
      const panelTone = (x / 54) % 2 === 0 ? wallPanel : wallPanelAlt;
      drawPixelRect(ctx, x - 12, 34, 44, floorY - 50, panelTone);
      drawPixelRect(ctx, x, 24, 3, floorY - 30, wallSeam);
      drawPixelRect(ctx, x + 3, 24, 1, floorY - 30, "rgba(255, 255, 255, 0.12)");
      drawPixelRect(ctx, x - 6, 44, 22, 2, "rgba(255, 226, 190, 0.08)");
      drawPixelRect(ctx, x - 3, floorY - 44, 28, 2, "rgba(0, 0, 0, 0.24)");
      if (content.room.wallSurfaceId === "card-room-green-felt-wall") {
        drawPixelRect(ctx, x + 16, 58 + ((x / 3) % 18), 4, 4, wallHighlight);
        drawPixelRect(ctx, x + 25, 78 + ((x / 5) % 20), 3, 7, wallDark);
      }
      if (content.room.wallSurfaceId === "card-room-burgundy-wall") {
        drawPixelRect(ctx, x + 10, 38, 26, 3, wallHighlight);
        drawPixelRect(ctx, x + 14, 76 + ((x / 2) % 16), 18, 2, "rgba(251, 113, 133, 0.42)");
      }
    }
  }
  drawPixelRect(ctx, 28, floorY, roomWidth - 56, floorBottom - floorY, floorBase);
  if (content.room.floorSurfaceId === "card-room-checker-floor") {
    const tile = 32;
    for (let y = floorY; y < floorBottom; y += tile) {
      for (let x = 28; x < roomWidth - 28; x += tile) {
        const checker = (Math.floor((x - 28) / tile) + Math.floor((y - floorY) / tile)) % 2;
        drawPixelRect(ctx, x, y, tile, tile, checker ? floorPanelAlt : floorPanel);
        drawPixelRect(ctx, x, y, tile, 2, floorSeam);
        drawPixelRect(ctx, x, y, 2, tile, floorSeam);
        if (!checker) drawPixelRect(ctx, x + 7, y + 9, 18, 1, floorHighlight);
      }
    }
  } else if (content.room.floorSurfaceId === "card-room-floor") {
    drawCardRoomMatrixSprite(
      ctx,
      CARD_ROOM_WALNUT_FLOOR_SPRITE,
      28,
      floorY,
      roomWidth - 56,
      floorBottom - floorY,
    );
  } else {
    for (let x = 36; x < roomInnerRight; x += 46) {
      const plankTone =
        content.room.floorSurfaceId === "card-room-emerald-carpet-floor"
          ? ((x / 46) % 3 === 0 ? floorPanel : (x / 46) % 3 === 1 ? floorPanelAlt : floorDark)
          : (x / 46) % 3 === 0
            ? floorPanel
            : (x / 46) % 3 === 1
              ? floorPanelAlt
              : floorDark;
      drawPixelRect(ctx, x - 2, floorY + 10, 41, floorBottom - floorY - 20, plankTone);
      drawPixelRect(ctx, x, floorY + 16, 3, floorBottom - floorY - 30, floorSeam);
      drawPixelRect(ctx, x + 4, floorY + 22 + ((x / 2) % 9), 28, 1, "rgba(255, 226, 190, 0.13)");
      drawPixelRect(ctx, x + 10, floorY + 160 + ((x / 3) % 11), 34, 1, "rgba(255, 226, 190, 0.09)");
      drawPixelRect(ctx, x + 6, floorBottom - 18, 24, 2, "rgba(0, 0, 0, 0.22)");
      if (content.room.floorSurfaceId === "card-room-emerald-carpet-floor") {
        drawPixelRect(ctx, x + 18, floorY + 64 + ((x / 4) % 20), 4, 4, floorHighlight);
      }
    }
  }
  drawPixelRect(ctx, 28, floorY - 8, roomWidth - 56, 12, wallHighlight);
  drawPixelRect(ctx, 28, floorY - 8, roomWidth - 56, 3, "rgba(255, 255, 255, 0.18)");
  drawPixelRect(ctx, 28, floorY + 2, roomWidth - 56, 4, "#431407");
  drawPixelRect(ctx, 58, floorY + 22, roomWidth - 116, 5, "rgba(250, 204, 21, 0.08)");
  drawPixelRect(ctx, 28, floorBottom, roomWidth - 56, 4, "#0d0706");
  drawPixelRect(ctx, 36, floorBottom - 10, roomWidth - 72, 2, floorDark);

  const roomWindow = content.room.windows?.find((item) => item.id === content.room.windowId);
  if (roomWindow) {
    const x = roomWindow.x + layout.originX;
    const y = roomWindow.y + layout.originY;
    drawCardRoomCityWindow(
      ctx,
      x,
      y,
      frame,
      roomWindow.id === "card-room-neon-window"
        ? "neon"
        : roomWindow.id === "card-room-private-window"
          ? "private"
          : "default",
    );
  }

  const lampY = Math.max(102, floorY - 132);
  for (const lampX of [Math.round(roomWidth * 0.22), Math.round(roomWidth * 0.78)]) {
    drawCardRoomWallSconce(ctx, lampX, lampY, frame);
  }
};

const drawCardRoomDecorFurniture = (
  ctx: CanvasRenderingContext2D,
  furniture: FurnitureDefinition,
  frame: number,
  layout: CardRoomRenderLayout,
) => {
  const x = furniture.x + layout.originX;
  const y = furniture.y + layout.originY;
  const { width, height } = furniture;

  if (furniture.id === "card-room-chip-cabinet") {
    drawPixelRect(ctx, x - 6, y + 48, width + 12, 22, "#120807");
    drawPixelRect(ctx, x, y + 10, width, height - 10, "#4a2518");
    drawPixelRect(ctx, x + 8, y + 4, width - 16, 12, "#8a5636");
    drawPixelRect(ctx, x + 12, y + 24, width - 24, 20, "#1f0f0b");
    drawPixelRect(ctx, x + 18, y + 28, 22, 10, "#facc15");
    drawPixelRect(ctx, x + 46, y + 28, 22, 10, "#fb7185");
    drawPixelRect(ctx, x + 74, y + 28, 16, 10, "#22d3ee");
    drawPixelRect(ctx, x + 12, y + 52, width - 24, 2, "#a16207");
    drawPixelRect(ctx, x + 18, y + 58, 28, 10, "#2b1712");
    drawPixelRect(ctx, x + width - 46, y + 58, 28, 10, "#2b1712");
    return;
  }

  if (furniture.id === "card-room-card-shelf") {
    drawPixelRect(ctx, x - 8, y + 4, width + 16, height + 10, "#130b0a");
    drawPixelRect(ctx, x, y, width, height, "#3d1f11");
    drawPixelRect(ctx, x + 8, y + 10, width - 16, 10, "#8a5636");
    drawPixelRect(ctx, x + 8, y + 42, width - 16, 10, "#8a5636");
    for (let i = 0; i < 9; i += 1) {
      const bx = x + 22 + i * 28;
      drawPixelRect(
        ctx,
        bx,
        y + 22,
        12,
        18,
        i % 3 === 0 ? "#dc2626" : i % 3 === 1 ? "#0f766e" : "#facc15",
      );
      drawPixelRect(ctx, bx + 3, y + 25, 6, 2, "#f8fafc");
    }
    drawPixelRect(ctx, x + width - 56, y + 22, 22, 18, "#ca8a04");
    drawPixelRect(ctx, x + width - 50, y + 16, 10, 8, "#fde68a");
    return;
  }

  if (furniture.id === "card-room-floor-lamp") {
    const glow =
      frame % 60 < 38 ? "rgba(250, 204, 21, 0.16)" : "rgba(250, 204, 21, 0.08)";
    drawPixelRect(ctx, x - 30, y + 8, width + 60, 56, glow);
    drawPixelRect(ctx, x + width / 2 - 3, y + 38, 6, 58, "#854d0e");
    drawPixelRect(ctx, x + width / 2 - 18, y + 96, 36, 8, "#451a03");
    drawPixelRect(ctx, x + 6, y + 10, width - 12, 26, "#f59e0b");
    drawPixelRect(ctx, x + 12, y + 14, width - 24, 18, "#fde68a");
    drawPixelRect(ctx, x + 16, y + 35, width - 32, 5, "#92400e");
    return;
  }

  if (furniture.id === "card-room-sideboard") {
    drawPixelRect(ctx, x - 8, y + 42, width + 16, 24, "#120807");
    drawPixelRect(ctx, x, y + 10, width, height - 10, "#4b2418");
    drawPixelRect(ctx, x + 10, y + 2, width - 20, 14, "#8a5636");
    drawPixelRect(ctx, x + 16, y + 24, 34, 24, "#1f0f0b");
    drawPixelRect(ctx, x + width - 50, y + 24, 34, 24, "#1f0f0b");
    drawPixelRect(ctx, x + 55, y + 22, 10, 9, "#facc15");
    drawPixelRect(ctx, x + 69, y + 19, 10, 12, "#facc15");
    drawPixelRect(ctx, x + 83, y + 24, 10, 7, "#facc15");
  }
};

type SeatSide = "top" | "left" | "right" | "bottom";

interface TableSeatSpot {
  x: number;
  y: number;
  facing: "front" | "back" | "left" | "right";
  side: SeatSide;
  cardX: number;
  cardY: number;
  betX: number;
  betY: number;
}

const topSeatX = (index: number, count: number, table: FurnitureDefinition) => {
  const span = table.width - 140;
  return count <= 1 ? table.x + table.width / 2 : table.x + 70 + (span / Math.max(1, count - 1)) * index;
};

const opponentSeatSpot = (
  index: number,
  count: number,
  table: FurnitureDefinition,
): TableSeatSpot => {
  if (count > TOP_OPPONENT_SEAT_COUNT && index >= TOP_OPPONENT_SEAT_COUNT) {
    const leftSide = index === TOP_OPPONENT_SEAT_COUNT;
    const x = leftSide ? table.x - 24 : table.x + table.width + 24;
    const middleY = table.y + table.height / 2;
    return {
      x,
      y: middleY + SIDE_OPPONENT_SEAT_Y_OFFSET,
      facing: leftSide ? "right" : "left",
      side: leftSide ? "left" : "right",
      cardX: leftSide ? table.x + 52 : table.x + table.width - 52,
      cardY: middleY + SIDE_OPPONENT_CARD_Y_OFFSET,
      betX: leftSide ? table.x + 116 : table.x + table.width - 116,
      betY: middleY + SIDE_OPPONENT_BET_Y_OFFSET,
    };
  }

  const topCount = Math.min(count, TOP_OPPONENT_SEAT_COUNT);
  const x = topSeatX(index, topCount, table);
  return {
    x,
    y: table.y - 24,
    facing: "front",
    side: "top",
    cardX: x,
    cardY: table.y + 32,
    betX: x,
    betY: table.y + 86,
  };
};

const userSeatSpot = (table: FurnitureDefinition): TableSeatSpot => {
  const handCenterX = table.x + table.width / 2;

  return {
    x: handCenterX,
    y: table.y + table.height + 18,
    facing: "back",
    side: "bottom",
    cardX: handCenterX,
    cardY: table.y + table.height - 64,
    betX: handCenterX - 95,
    betY: table.y + table.height - 42,
  };
};

const fallbackPokerTable = (layout: CardRoomRenderLayout): FurnitureDefinition => ({
  id: "poker-table",
  name: "Poker Table",
  tags: ["furniture", "table"],
  placementSurfaces: ["floor"],
  zone: "kitchen",
  x: layout.originX + POKER_TABLE_X,
  y: layout.originY + POKER_TABLE_Y,
  width: POKER_TABLE_WIDTH,
  height: POKER_TABLE_HEIGHT,
  color: "#0f766e",
  interaction: "interact",
  collision: {
    x: layout.originX + POKER_TABLE_X,
    y: layout.originY + POKER_TABLE_Y,
    width: POKER_TABLE_WIDTH,
    height: POKER_TABLE_HEIGHT,
  },
});

const seatSpotForPlayer = (
  player: HoldemPlayer,
  opponentIndex: number,
  opponentCount: number,
  table: FurnitureDefinition,
) => (player.isUser ? userSeatSpot(table) : opponentSeatSpot(opponentIndex, opponentCount, table));

const drawChair = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  active: boolean,
  facing: TableSeatSpot["facing"],
) => {
  const sprite =
    facing === "left"
      ? CARD_ROOM_RED_SOFA_SPRITES.left
      : facing === "right"
        ? CARD_ROOM_RED_SOFA_SPRITES.right
        : facing === "back"
          ? CARD_ROOM_RED_SOFA_SPRITES.back
          : CARD_ROOM_RED_SOFA_SPRITES.front;
  const chairX = x - sprite.width / 2;
  const chairY = y - sprite.height / 2;
  drawPixelRect(
    ctx,
    chairX + 5,
    chairY + sprite.height - 7,
    sprite.width - 10,
    8,
    "rgba(0, 0, 0, 0.28)",
  );
  if (active) {
    drawPixelRect(
      ctx,
      chairX - 3,
      chairY - 3,
      sprite.width + 6,
      sprite.height + 6,
      "rgba(250, 204, 21, 0.16)",
    );
    drawPixelStroke(ctx, chairX - 2, chairY - 2, sprite.width + 4, sprite.height + 4, "#facc15", 1);
  }
  drawCardRoomMatrixSprite(ctx, sprite, chairX, chairY);
};

const drawSideChairForeground = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: TableSeatSpot["facing"],
) => {
  const sprite =
    facing === "left"
      ? CARD_ROOM_RED_SOFA_SIDE_FOREGROUND_SPRITES.left
      : facing === "right"
        ? CARD_ROOM_RED_SOFA_SIDE_FOREGROUND_SPRITES.right
        : null;
  if (!sprite) return;
  drawCardRoomMatrixSprite(ctx, sprite, x - sprite.width / 2, y - sprite.height / 2);
};

const dealStartingSeatIndexForTable = (table: HoldemTableState) => {
  const playerCount = table.players.length;
  if (playerCount <= 1) return 0;
  const buttonIndex = ((table.buttonIndex % playerCount) + playerCount) % playerCount;
  return playerCount === 2 ? buttonIndex : (buttonIndex + 1) % playerCount;
};

const drawPokerChip = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  shadow: string,
  width = 12,
) => {
  drawPixelRect(ctx, x - width / 2, y - 1, width, 5, shadow);
  drawPixelRect(ctx, x - width / 2 + 1, y - 4, width - 2, 5, color);
  drawPixelRect(ctx, x - width / 2 + 3, y - 5, width - 6, 1, "#fff7ed");
  drawPixelRect(ctx, x - width / 2 + 2, y - 2, 2, 1, "#fff7ed");
  drawPixelRect(ctx, x + width / 2 - 4, y - 2, 2, 1, "#fff7ed");
};

const drawBet = (
  ctx: CanvasRenderingContext2D,
  player: HoldemPlayer,
  x: number,
  y: number,
) => {
  if (player.committed <= 0) return;
  drawPixelRect(ctx, x - 22, y - 7, 44, 13, "rgba(2, 6, 23, 0.48)");
  drawPokerChip(ctx, x - 9, y - 6, "#7c3aed", "#2e1065", 13);
  drawPokerChip(ctx, x, y - 10, "#a855f7", "#4c1d95", 13);
  drawPokerChip(ctx, x + 9, y - 6, "#f59e0b", "#713f12", 13);
  drawPixelRect(ctx, x - 20, y + 5, 40, 11, "#020617");
  drawPixelStroke(ctx, x - 20, y + 5, 40, 11, "#7dd3fc", 1);
  drawText(ctx, String(player.committed), x, y + 6, {
    align: "center",
    color: "#f5f3ff",
    size: 8,
    weight: "900",
  });
};

const drawStackChips = (
  ctx: CanvasRenderingContext2D,
  stack: number,
  x: number,
  y: number,
) => {
  const colors = stack < 0 ? ["#fb7185", "#f43f5e"] : ["#facc15", "#14b8a6", "#f97316"];
  const shadows = stack < 0 ? ["#881337", "#7f1d1d"] : ["#713f12", "#134e4a", "#7c2d12"];
  const label = stackLabel(stack);
  const stackHeight = Math.min(6, Math.max(2, Math.ceil(Math.abs(stack) / 350)));
  drawPixelRect(ctx, x - 18, y - stackHeight * 3 - 5, 42, stackHeight * 3 + 8, "rgba(0, 0, 0, 0.22)");
  for (let column = 0; column < 3; column += 1) {
    for (let row = 0; row < stackHeight; row += 1) {
      const chipX = x - 7 + column * 7;
      const chipY = y - row * 3 + column * 2;
      const colorIndex = (column + row) % colors.length;
      drawPokerChip(ctx, chipX, chipY, colors[colorIndex], shadows[colorIndex], 10);
    }
  }
  drawPixelRect(ctx, x - 17, y + 8, 40, 12, "#020617");
  drawPixelStroke(ctx, x - 17, y + 8, 40, 12, stack < 0 ? "#fb7185" : "#facc15", 1);
  drawText(ctx, label, x + 3, y + 10, {
    align: "center",
    color: stack < 0 ? "#fb7185" : "#fde68a",
    size: 7,
    weight: "900",
  });
};

const rotationForSeatFacing = (facing: TableSeatSpot["facing"]) => {
  if (facing === "front") return Math.PI;
  if (facing === "right") return Math.PI / 2;
  if (facing === "left") return -Math.PI / 2;
  return 0;
};

const rightHandVectorForSeatFacing = (facing: TableSeatSpot["facing"]) => {
  if (facing === "front") return { x: -1, y: 0 };
  if (facing === "right") return { x: 0, y: 1 };
  if (facing === "left") return { x: 0, y: -1 };
  return { x: 1, y: 0 };
};

const drawSeatCards = (
  ctx: CanvasRenderingContext2D,
  table: HoldemTableState,
  player: HoldemPlayer,
  spot: TableSeatSpot,
  options: {
    hidden?: boolean;
    scale?: number;
    motion?: CardRoomTableMotion;
    now?: number;
    dealOrigin?: { x: number; y: number };
  } = {},
) => {
  if (table.street === "waiting") return;
  if (player.holeCards.length === 0) return;
  const visibleCards = options.hidden ? [] : visibleHoleCardsForPlayer(table, player);
  const hidden = options.hidden || visibleCards.length === 0;
  const cards = hidden ? [null, null] : visibleCards;
  const scale = options.scale ?? TABLE_CARD_SCALE;
  const cardWidth = 42 * scale;
  const cardHeight = 58 * scale;
  const gap = cardWidth + 4;
  const cardRowWidth = cardWidth * 2 + 4;
  const startX = -cardRowWidth / 2;
  const rotation = rotationForSeatFacing(spot.facing);
  const centerY = spot.cardY + cardHeight / 2;
  const motion = options.motion;
  const now = options.now ?? performance.now();
  const handDealActive =
    Boolean(motion && options.dealOrigin) &&
    motion?.handNumber === table.handNumber;
  const sourceTopLeft =
    handDealActive && options.dealOrigin
      ? localTopLeftFromGlobal(
          options.dealOrigin.x - cardWidth / 2,
          options.dealOrigin.y - cardHeight / 2,
          spot.cardX,
          centerY,
          rotation,
        )
      : null;

  ctx.save();
  ctx.translate(spot.cardX, centerY);
  ctx.rotate(rotation);
  cards.slice(0, 2).forEach((card, index) => {
    const finalX = startX + index * gap;
    const finalY = -cardHeight / 2;
    let drawX = finalX;
    let drawY = finalY;
    let drawHidden = hidden;
    let drawCard = card;

    if (motion && sourceTopLeft) {
      const playerCount = Math.max(1, table.players.length);
      const dealStartSeatIndex = dealStartingSeatIndexForTable(table);
      const seatDealOffset = (player.seatIndex - dealStartSeatIndex + playerCount) % playerCount;
      const dealIndex = index * playerCount + seatDealOffset;
      const progress = timedProgress(
        now,
        motion.handStartedAt + 480 + dealIndex * 90,
        360,
      );
      if (progress < 0) return;
      const eased = easeOutCubic(progress);
      drawX = lerp(sourceTopLeft.x, finalX, eased);
      drawY = lerp(sourceTopLeft.y, finalY, eased);
      if (progress < 0.82) {
        drawHidden = true;
        drawCard = null;
      }
    }

    drawPlayingCard(ctx, drawCard, drawX, drawY, {
      hidden: drawHidden,
      scale,
    });
  });
  ctx.restore();
};

const stackChipsBesideSeatCards = (
  spot: TableSeatSpot,
  scale = TABLE_CARD_SCALE,
) => {
  if (spot.side === "right") {
    return {
      x: spot.x - 46,
      y: spot.y + 8,
    };
  }

  const cardWidth = 42 * scale;
  const cardHeight = 58 * scale;
  const cardRowWidth = cardWidth * 2 + 4;
  const right = rightHandVectorForSeatFacing(spot.facing);
  const offset = cardRowWidth / 2 + 25;
  return {
    x: spot.cardX + right.x * offset,
    y: spot.cardY + cardHeight / 2 + right.y * offset,
  };
};

const drawPokerTable = (
  ctx: CanvasRenderingContext2D,
  table: HoldemTableState,
  furniture: FurnitureDefinition,
  motion: CardRoomTableMotion | undefined,
  now: number,
) => {
  const { x, y, width, height } = furniture;
  drawPixelRect(ctx, x - 28, y + 22, width + 56, height - 8, "rgba(0, 0, 0, 0.38)");
  drawCardRoomMatrixSprite(ctx, CARD_ROOM_POKER_TABLE_SPRITE, x, y, width, height);

  drawText(ctx, "SYSTEM DEALER", x + width / 2, y + 22, {
    color: "#f8e7bd",
    align: "center",
    baseline: "middle",
    size: 10,
    weight: "900",
  });

  const tableScaleX = width / POKER_TABLE_WIDTH;
  const tableScaleY = height / POKER_TABLE_HEIGHT;
  const communityCardScale = TABLE_CARD_SCALE;
  const cardWidth = 42 * communityCardScale;
  const cardHeight = 58 * communityCardScale;
  const dealerDeckOrigin = {
    x: x + width / 2,
    y: y + 78,
  };
  drawDealerShuffle(ctx, dealerDeckOrigin.x, dealerDeckOrigin.y, motion, table, now);
  const communityCardY =
    y + COMMUNITY_CARD_FRAME_CENTER_Y * tableScaleY - cardHeight / 2;
  COMMUNITY_CARD_FRAME_CENTERS_X.forEach((frameCenterX, index) => {
    const communityCardX = x + frameCenterX * tableScaleX - cardWidth / 2;
    const card = table.communityCards[index] ?? null;
    if (card) {
      const revealActive =
        Boolean(motion) &&
        motion?.handNumber === table.handNumber &&
        index >= (motion?.communityRevealFrom ?? 0) &&
        index < (motion?.communityRevealFrom ?? 0) + (motion?.communityRevealCount ?? 0);
      if (revealActive && motion) {
        const progress = timedProgress(
          now,
          motion.communityRevealStartedAt + (index - motion.communityRevealFrom) * 130,
          390,
        );
        if (progress < 0) return;
        const eased = easeInOutSine(progress);
        const drawX = lerp(dealerDeckOrigin.x - cardWidth / 2, communityCardX, eased);
        const drawY = lerp(dealerDeckOrigin.y - cardHeight / 2, communityCardY, eased);
        drawPlayingCard(ctx, progress < 0.74 ? null : card, drawX, drawY, {
          hidden: progress < 0.74,
          scale: communityCardScale,
        });
        return;
      }
      drawPlayingCard(ctx, card, communityCardX, communityCardY, {
        scale: communityCardScale,
      });
    } else if (table.street !== "waiting") {
      drawPlayingCard(ctx, null, communityCardX, communityCardY, {
        scale: communityCardScale,
      });
    }
  });
  drawText(ctx, `POT ${table.pot}`, x + width / 2, y + height - 19, {
    align: "center",
    baseline: "middle",
    color: "#f8e7bd",
    size: 9,
    weight: "900",
  });
};

interface RenderCardRoomOptions {
  content: AivatarContent;
  table: HoldemTableState;
  characters: CardRoomCharacter[];
  runtimes: Record<string, AvatarRuntime>;
  bubbles?: Record<string, CardRoomBubble>;
  actionCues?: Record<string, CardRoomActionCue>;
  motion?: CardRoomTableMotion;
  frame: number;
  userAvatarId?: string | null;
}

export const renderCardRoom = (
  canvas: HTMLCanvasElement,
  options: RenderCardRoomOptions,
) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const {
    content,
    table,
    characters,
    runtimes,
    bubbles = {},
    actionCues = {},
    motion,
    frame,
    userAvatarId,
  } = options;
  const now = performance.now();
  const displayWidth = Math.max(1, Math.round(canvas.clientWidth || cardRoomSceneSize.width));
  const displayHeight = Math.max(1, Math.round(canvas.clientHeight || cardRoomSceneSize.height));
  if (canvas.width !== displayWidth) {
    canvas.width = displayWidth;
  }
  if (canvas.height !== displayHeight) {
    canvas.height = displayHeight;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  const scale = Math.min(
    displayWidth / cardRoomSceneSize.width,
    displayHeight / cardRoomSceneSize.height,
  );
  const layout: CardRoomRenderLayout = {
    width: displayWidth / scale,
    height: displayHeight / scale,
    originX: (displayWidth / scale - cardRoomSceneSize.width) / 2,
    originY: (displayHeight / scale - cardRoomSceneSize.height) / 2,
  };
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const pokerTable =
    content.room.furniture.find((item) => item.id === "poker-table") ?? null;
  const shiftedPokerTable = pokerTable
    ? shiftFurniture(pokerTable, layout)
    : fallbackPokerTable(layout);
  const playerByAvatarId = new Map(table.players.map((player) => [player.avatarId, player]));
  const opponents = table.players.filter((player) => !player.isUser);
  const opponentsByRoomSeat = new Map(
    opponents.map((player, index) => [player.roomSeatIndex ?? index, player]),
  );
  const dealerDeckOrigin = {
    x: shiftedPokerTable.x + shiftedPokerTable.width / 2,
    y: shiftedPokerTable.y + 78,
  };
  const winnerAvatarIds = new Set(
    table.street === "handComplete"
      ? [
          ...table.winners
            .map((winner) => table.players[winner.seatIndex]?.avatarId)
            .filter((avatarId): avatarId is string => Boolean(avatarId)),
          ...(motion?.handNumber === table.handNumber ? motion.winningAvatarIds : []),
        ]
      : [],
  );
  const winnerStartedAt =
    motion?.handNumber === table.handNumber && table.street === "handComplete"
      ? motion.completionStartedAt
      : null;

  drawRoomShell(ctx, content, frame, layout);
  content.room.furniture
    .filter((item) => item.id !== "poker-table")
    .sort((left, right) => left.y - right.y)
    .forEach((item) => drawCardRoomDecorFurniture(ctx, item, frame, layout));

  const opponentSeats = Math.max(VISIBLE_OPPONENT_SEAT_COUNT, opponents.length);
  const seatRenderEntries: Array<{
    spot: TableSeatSpot;
    active: boolean;
  }> = [];
  for (let index = 0; index < opponentSeats; index += 1) {
    const seatPlayer = opponentsByRoomSeat.get(index);
    const spot = opponentSeatSpot(index, opponentSeats, shiftedPokerTable);
    seatRenderEntries.push({
      spot,
      active: table.activeSeatIndex === seatPlayer?.seatIndex,
    });
  }
  const userSeat = userSeatSpot(shiftedPokerTable);
  seatRenderEntries.push({
    spot: userSeat,
    active: table.activeSeatIndex !== null && table.players[table.activeSeatIndex]?.isUser,
  });

  const avatars = characters
    .map((character) => ({
      character,
      runtime: runtimes[character.avatarId],
      player: playerByAvatarId.get(character.avatarId),
    }))
    .filter((entry) => entry.character.avatarId !== userAvatarId)
    .filter((entry): entry is {
      character: CardRoomCharacter;
      runtime: AvatarRuntime;
      player: HoldemPlayer | undefined;
    } => Boolean(entry.runtime));

  const renderItems: CardRoomDepthRenderItem[] = [];
  let renderOrder = 0;
  const addRenderItem = (depth: number, draw: () => void) => {
    renderItems.push({
      depth,
      order: renderOrder,
      draw,
    });
    renderOrder += 1;
  };

  seatRenderEntries.forEach(({ spot, active }) => {
    addRenderItem(spot.y - 1, () => drawChair(ctx, spot.x, spot.y, active, spot.facing));
    if (spot.side === "left" || spot.side === "right") {
      addRenderItem(spot.y + 1, () => drawSideChairForeground(ctx, spot.x, spot.y, spot.facing));
    }
  });

  avatars.forEach((entry) => {
    const runtime = shiftedRuntime(entry.runtime, layout);
    addRenderItem(runtime.y, () =>
      drawAvatarFigure(
        ctx,
        runtime,
        entry.character,
        entry.player,
        table.activeSeatIndex === entry.player?.seatIndex,
        frame,
        actionCues[entry.character.avatarId],
        winnerAvatarIds.has(entry.character.avatarId) ? winnerStartedAt : null,
        now,
      ),
    );
  });

  addRenderItem(shiftedPokerTable.y + 90, () => {
    drawPokerTable(ctx, table, shiftedPokerTable, motion, now);

    opponents.forEach((player, index) => {
      const roomSeatIndex = player.roomSeatIndex ?? index;
      const spot = opponentSeatSpot(
        roomSeatIndex,
        Math.max(VISIBLE_OPPONENT_SEAT_COUNT, opponents.length),
        shiftedPokerTable,
      );
      drawSeatCards(ctx, table, player, spot, {
        scale: TABLE_CARD_SCALE,
        motion,
        now,
        dealOrigin: dealerDeckOrigin,
      });
      const stackSpot = stackChipsBesideSeatCards(spot);
      drawStackChips(ctx, player.stack, stackSpot.x, stackSpot.y);
      drawBet(ctx, player, spot.betX, spot.betY);
    });
    const userPlayer = table.players.find((player) => player.isUser);
    if (userPlayer) {
      const spot = seatSpotForPlayer(userPlayer, 0, opponents.length, shiftedPokerTable);
      drawSeatCards(ctx, table, userPlayer, spot, {
        hidden: true,
        scale: TABLE_CARD_SCALE,
        motion,
        now,
        dealOrigin: dealerDeckOrigin,
      });
      const stackSpot = stackChipsBesideSeatCards(spot);
      drawStackChips(ctx, userPlayer.stack, stackSpot.x, stackSpot.y);
      drawBet(ctx, userPlayer, spot.betX, spot.betY);
    }
  });

  renderItems
    .sort((left, right) => left.depth - right.depth || left.order - right.order)
    .forEach((item) => item.draw());

  avatars.forEach((entry) =>
    drawCharacterBubble(
      ctx,
      shiftedRuntime(entry.runtime, layout),
      bubbles[entry.character.avatarId],
    ),
  );

};

export const compactCards = (cards: PlayingCard[]) =>
  cards.map(cardLabel).join(" ");
