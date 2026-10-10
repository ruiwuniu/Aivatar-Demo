/** Macintosh skin: the original PNG is fitted inside the existing terminal footprint. */
export const MACINTOSH_TERMINAL_SKIN_ID = "terminal-macintosh-skin";
export const MACINTOSH_TERMINAL_ASSET = "/assets/furniture/terminal-macintosh.png";
export const MACINTOSH_FOREST_ORANGE_SKIN_ID = "terminal-macintosh-forest-orange-skin";
export const MACINTOSH_FOREST_ORANGE_ASSET = "/assets/furniture/terminal-macintosh-forest-orange.png";
export const MACINTOSH_ORANGE_GREEN_SKIN_ID = "terminal-macintosh-orange-green-skin";
export const MACINTOSH_ORANGE_GREEN_ASSET = "/assets/furniture/terminal-macintosh-orange-green.png";
export const isMacintoshTerminalSkin = (skinId?: string): boolean =>
  skinId === MACINTOSH_TERMINAL_SKIN_ID || skinId === MACINTOSH_FOREST_ORANGE_SKIN_ID || skinId === MACINTOSH_ORANGE_GREEN_SKIN_ID;
export type MacintoshTerminalPhase = "idle" | "thinking" | "executing" | "waiting_for_user" | "complete" | "error";
export type MacintoshTerminalGhost = "none" | "valid" | "invalid";
type Rect = { x: number; y: number; width: number; height: number };

// Source coordinates refer to the accepted 1161 x 1355 PNG, not the older
// terminal's screen/key locations. The faint alpha outside the body is omitted.
const source = { x: 117, y: 103, width: 927, height: 1188 } as const;
const imageScale = 50 / source.height;
const imageWidth = source.width * imageScale;
const imageRect = { x: -imageWidth / 2, y: -35, width: imageWidth, height: 50 };
const mapSourceRect = (rect: Rect): Rect => ({
  x: imageRect.x + (rect.x - source.x) * imageScale,
  y: imageRect.y + (rect.y - source.y) * imageScale,
  width: rect.width * imageScale,
  height: rect.height * imageScale,
});
const screen = mapSourceRect({ x: 352, y: 311, width: 460, height: 342 });
const keys = [
  { x: 220, y: 1036, width: 43, height: 24 },
  { x: 337, y: 1036, width: 39, height: 24 },
  { x: 448, y: 1036, width: 40, height: 24 },
  { x: 561, y: 1036, width: 41, height: 24 },
  { x: 674, y: 1036, width: 41, height: 24 },
  { x: 787, y: 1036, width: 40, height: 24 },
  { x: 306, y: 1082, width: 40, height: 23 },
  { x: 418, y: 1082, width: 40, height: 23 },
  { x: 531, y: 1082, width: 40, height: 23 },
  { x: 645, y: 1082, width: 40, height: 23 },
  { x: 439, y: 1121, width: 40, height: 23 },
  { x: 612, y: 1121, width: 39, height: 23 },
].map(mapSourceRect);

export const MACINTOSH_TERMINAL_GEOMETRY = {
  bounds: { x: -21, y: -35, width: 42, height: 50 },
  source, image: imageRect, screen, keys,
  // A small monochrome drive-activity light under the disk slot.
  indicator: { ...mapSourceRect({ x: 832, y: 847, width: 22, height: 13 }) },
} as const;

export interface MacintoshTerminalAnimationState {
  phase: MacintoshTerminalPhase;
  static: boolean;
  cursorVisible: boolean;
  indicatorOn: boolean;
  lineStep: number;
  scanRow: number;
  pressedKeyIndex: number | null;
}

/** Status drives the CRT; proximity/arrival only gates physical key pressing. */
export const macintoshTerminalAnimationState = (
  frame: number, phase: MacintoshTerminalPhase = "idle", active = false,
  ghost: MacintoshTerminalGhost = "none",
): MacintoshTerminalAnimationState => {
  const tick = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
  if (ghost !== "none") return {
    phase: "idle", static: true, cursorVisible: true, indicatorOn: false,
    lineStep: 0, scanRow: 0, pressedKeyIndex: null,
  };
  const running = phase === "thinking" || phase === "executing";
  const keyBeat = Math.floor(tick / (phase === "thinking" ? 12 : 4));
  return {
    phase, static: false,
    cursorVisible: Math.floor(tick / (phase === "waiting_for_user" ? 24 : 16)) % 2 === 0,
    indicatorOn: running && Math.floor(tick / 6) % 2 === 0,
    lineStep: Math.floor(tick / 7) % 4,
    scanRow: Math.floor(tick / 3) % 12,
    pressedKeyIndex: active && running && (phase === "executing" || keyBeat % 3 === 0)
      ? (keyBeat * 5 + 2) % keys.length : null,
  };
};

export interface MacintoshTerminalDrawOptions {
  x: number;
  y: number;
  frame: number;
  phase?: MacintoshTerminalPhase;
  active?: boolean;
  ghost?: MacintoshTerminalGhost;
  skinId?: string;
  /** Optional loaded image for isolated renderer previews/tests. */
  image?: CanvasImageSource;
}

const cachedImages = new Map<string, HTMLImageElement>();
const terminalImage = (skinId?: string): HTMLImageElement | undefined => {
  if (typeof Image === "undefined") return undefined;
  const asset = skinId === MACINTOSH_ORANGE_GREEN_SKIN_ID ? MACINTOSH_ORANGE_GREEN_ASSET
    : skinId === MACINTOSH_FOREST_ORANGE_SKIN_ID ? MACINTOSH_FOREST_ORANGE_ASSET : MACINTOSH_TERMINAL_ASSET;
  let cachedImage = cachedImages.get(asset);
  if (!cachedImage) {
    cachedImage = new Image();
    cachedImage.src = asset;
    cachedImages.set(asset, cachedImage);
  }
  return cachedImage.complete && cachedImage.naturalWidth > 0 ? cachedImage : undefined;
};

const classicPalette = {
  ink: "#273126", screenTop: "#b8c0ae", screenBottom: "#a9b49e", reflection: "#e4ead7",
  scanline: "rgba(225, 235, 213, 0.12)", shellShadow: "#81735d", shellFace: "#e7d8b9",
  indicatorOn: "#5b6b4d", indicatorOff: "#948973",
  keyShadow: "#84745b", keyFace: "#d6c5a5", keyHighlight: "#eee0c3",
};
type MacintoshTerminalPalette = typeof classicPalette;
const forestOrangePalette: MacintoshTerminalPalette = {
  ink: "#172018", screenTop: "#ff991f", screenBottom: "#ff7d16", reflection: "#ffe5a2",
  scanline: "rgba(255, 224, 149, 0.16)", shellShadow: "#082e24", shellFace: "#205b49",
  indicatorOn: "#ff951f", indicatorOff: "#1e5947",
  keyShadow: "#173c31", keyFace: "#669681", keyHighlight: "#a8cdb5",
};
const orangeGreenPalette: MacintoshTerminalPalette = {
  ink: "#16331b", screenTop: "#46c844", screenBottom: "#2eac3b", reflection: "#c0f3b0",
  scanline: "rgba(192, 243, 176, 0.16)", shellShadow: "#914013", shellFace: "#e87521",
  indicatorOn: "#46c844", indicatorOff: "#a94d17",
  keyShadow: "#994515", keyFace: "#edaa6b", keyHighlight: "#ffce99",
};
const glyph = (ctx: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number, size = 1) => {
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row].length; column += 1) {
      if (rows[row][column] === "1") ctx.fillRect(x + column * size, y + row * size, size, size);
    }
  }
};

const drawScreen = (ctx: CanvasRenderingContext2D, state: MacintoshTerminalAnimationState, palette: MacintoshTerminalPalette) => {
  const { x, y, width, height } = screen;
  const cut = 1.45;
  ctx.save();
  // The stepped CRT corners keep every animated pixel off the dark bezel.
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + width - cut, y);
  ctx.lineTo(x + width, y + cut);
  ctx.lineTo(x + width, y + height - cut);
  ctx.lineTo(x + width - cut, y + height);
  ctx.lineTo(x + cut, y + height);
  ctx.lineTo(x, y + height - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
  ctx.clip();
  const phosphor = ctx.createLinearGradient(x, y, x + width, y + height);
  phosphor.addColorStop(0, palette.screenTop);
  phosphor.addColorStop(1, palette.screenBottom);
  ctx.fillStyle = phosphor;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = palette.reflection;
  ctx.fillRect(x + 1.1, y + 1, 1.8, 0.6);
  ctx.fillRect(x + 1.1, y + 1.6, 0.6, 0.7);
  ctx.fillStyle = palette.ink;

  switch (state.phase) {
    case "thinking":
      glyph(ctx, ["11111", "01010", "00100", "01010", "11111"], x + 3, y + 4);
      for (let index = 0; index <= state.lineStep; index += 1) ctx.fillRect(x + 10 + index * 1.7, y + 8, 0.8, 0.8);
      break;
    case "executing":
      glyph(ctx, ["100", "010", "100"], x + 2, y + 3, 0.8);
      ctx.fillRect(x + 6, y + 4, 6 + state.lineStep, 0.8);
      ctx.fillRect(x + 3, y + 7, 9 + (state.lineStep % 2) * 3, 0.8);
      ctx.fillRect(x + 3, y + 10, 5 + state.lineStep, 0.8);
      if (state.cursorVisible) ctx.fillRect(x + 10 + state.lineStep, y + 10, 1.6, 0.8);
      ctx.fillStyle = palette.scanline;
      ctx.fillRect(x, y + 1 + state.scanRow, width, 0.5);
      break;
    case "waiting_for_user":
      glyph(ctx, ["01110", "10001", "00010", "00100", "00000", "00100"], x + 4, y + 3);
      if (state.cursorVisible) ctx.fillRect(x + 12, y + 9, 3, 1);
      break;
    case "complete":
      glyph(ctx, ["0000001", "0000011", "1000110", "1101100", "0111000", "0010000"], x + 6, y + 4);
      break;
    case "error":
      glyph(ctx, ["1100011", "0110110", "0011100", "0001000", "0011100", "0110110", "1100011"], x + 6, y + 3);
      break;
    case "idle":
    default:
      glyph(ctx, ["100", "010", "001", "010", "100"], x + 2, y + 4, 0.75);
      if (state.cursorVisible) ctx.fillRect(x + 5.5, y + 7.1, 2.4, 0.75);
      break;
  }
  ctx.restore();
};

const drawLoadingSilhouette = (ctx: CanvasRenderingContext2D, palette: MacintoshTerminalPalette) => {
  // A first-frame placeholder prevents an empty native transparent window
  // while the accepted PNG is decoded; subsequent animation frames use it.
  ctx.fillStyle = palette.shellShadow;
  ctx.fillRect(-15, -34, 30, 37);
  ctx.fillRect(-19, 4, 38, 10);
  ctx.fillStyle = palette.shellFace;
  ctx.fillRect(-14, -33, 28, 35);
  ctx.fillRect(-18, 5, 36, 8);
};

export const drawMacintoshTerminal = (
  ctx: CanvasRenderingContext2D, options: MacintoshTerminalDrawOptions,
): void => {
  const ghost = options.ghost ?? "none";
  const state = macintoshTerminalAnimationState(options.frame, options.phase, options.active, ghost);
  const palette = options.skinId === MACINTOSH_ORANGE_GREEN_SKIN_ID ? orangeGreenPalette
    : options.skinId === MACINTOSH_FOREST_ORANGE_SKIN_ID ? forestOrangePalette : classicPalette;
  const image = options.image ?? terminalImage(options.skinId);
  ctx.save();
  ctx.translate(Math.round(options.x), Math.round(options.y));
  ctx.imageSmoothingEnabled = false;
  if (ghost !== "none") ctx.globalAlpha *= 0.62;
  if (image) {
    ctx.drawImage(image, source.x, source.y, source.width, source.height,
      imageRect.x, imageRect.y, imageRect.width, imageRect.height);
  } else {
    drawLoadingSilhouette(ctx, palette);
  }
  drawScreen(ctx, state, palette);
  if (!state.static) {
    const light = MACINTOSH_TERMINAL_GEOMETRY.indicator;
    ctx.fillStyle = state.indicatorOn ? palette.indicatorOn : palette.indicatorOff;
    ctx.fillRect(light.x, light.y, light.width, light.height);
  }
  if (state.pressedKeyIndex !== null) {
    const key = keys[state.pressedKeyIndex];
    // Darken the vacated top strip, then lower the key face. All these
    // points are calibrated against this PNG's individual key caps.
    ctx.fillStyle = palette.keyShadow;
    ctx.fillRect(key.x - 0.15, key.y, key.width + 0.3, key.height + 0.45);
    ctx.fillStyle = palette.keyFace;
    ctx.fillRect(key.x, key.y + 0.55, key.width, Math.max(0.35, key.height - 0.1));
    ctx.fillStyle = palette.keyHighlight;
    ctx.fillRect(key.x + 0.15, key.y + 0.55, Math.max(0.2, key.width - 0.3), 0.25);
  }
  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.lineWidth = 1;
    ctx.strokeRect(-20.5, -34.5, 41, 49);
  }
  ctx.restore();
};
