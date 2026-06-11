import type {
  AivatarContent,
  AivatarMemory,
  AvatarRuntime,
  CodexStatusMessage,
  FurnitureDefinition,
  FurnitureInteractionState,
  ItemDefinition,
  PetStats,
  PlacedItem,
  RoomSurfaceDefinition,
  RoomSurfacePalette,
  RoomWindowDefinition,
} from "../types";
import {
  getFurniturePlacementFootBounds,
  getFurnitureVisualBounds,
  getItemPlacementKind,
  getPlacedItemPlacementFootBounds,
  placedItemBounds,
  sceneSize,
} from "./interactions";
import {
  deriveBehaviorFromCodex,
  getFurnitureInteractionStandpoints,
  getNavigationDebugPath,
  getPlacedItemInteractionStandpoints,
} from "./simulation";

const CJK_CANVAS_FONT =
  '"Noto Sans TC", "Noto Sans SC", "Noto Sans HK", "Microsoft JhengHei UI", "Microsoft YaHei UI", "Microsoft JhengHei", "Microsoft YaHei", sans-serif';

const isCjkCharacter = (char: string) =>
  /[\u3400-\u9fff\uf900-\ufaff]/u.test(char);

interface PlacementPreview {
  item: ItemDefinition;
  x: number;
  y: number;
  valid: boolean;
}

interface WindowPlacementPreview {
  window: RoomWindowDefinition;
  x: number;
  y: number;
  valid: boolean;
}

interface FurniturePlacementPreview {
  furniture: FurnitureDefinition;
  x: number;
  y: number;
  valid: boolean;
}

type FurnitureRenderLayer = "all" | "behind-avatar" | "in-front-of-avatar";
type PlacedItemRenderLayer = "all" | "behind-avatar" | "in-front-of-avatar";
type BedSkinId =
  | "classic"
  | "industrial-bed-skin"
  | "wood-red-bed-skin"
  | "ivory-pink-plaid-bed-skin"
  | "modern-minimal-bed-skin"
  | "space-white-deep-gray-bed-skin";
type DeskSkinId =
  | "classic"
  | "industrial-desk-skin"
  | "rococo-ivory-desk-skin"
  | "transparent-acrylic-desk-skin";
type TableSkinId =
  | "classic"
  | "rococo-ivory-table-skin"
  | "dark-oak-table-skin"
  | "white-tech-table-skin";
type FridgeSkinId =
  | "classic"
  | "ivory-fridge-skin"
  | "red-retro-fridge-skin"
  | "white-tech-fridge-skin";

type DominantTrait = keyof AivatarMemory["growth"]["traits"];
type MoodBand = "high" | "normal" | "low" | "depleted";
type UiThemeId = "classic" | "terminal" | "terminal-amber";

interface BubblePalette {
  shadow: string;
  border: string;
  fill: string;
  tail: string;
  infoText: string;
  warningText: string;
  errorText: string;
  progressTrack: string;
  progressFill: string;
}

const bubblePalettes: Record<UiThemeId, BubblePalette> = {
  classic: {
    shadow: "#404040",
    border: "#000000",
    fill: "#ffffe1",
    tail: "#000000",
    infoText: "#000080",
    warningText: "#808000",
    errorText: "#800000",
    progressTrack: "#ffffff",
    progressFill: "#000080",
  },
  terminal: {
    shadow: "#010804",
    border: "#67ff72",
    fill: "#041108",
    tail: "#67ff72",
    infoText: "#d8ffd0",
    warningText: "#d9ff5f",
    errorText: "#b6ff4a",
    progressTrack: "#020804",
    progressFill: "#67ff72",
  },
  "terminal-amber": {
    shadow: "#080300",
    border: "#ffbf4d",
    fill: "#160c03",
    tail: "#ffbf4d",
    infoText: "#ffe4a3",
    warningText: "#ffd166",
    errorText: "#ff8f3d",
    progressTrack: "#090500",
    progressFill: "#ffb02e",
  },
};

const bubblePaletteForTheme = (uiTheme: UiThemeId): BubblePalette =>
  bubblePalettes[uiTheme] ?? bubblePalettes.classic;

const isTerminalTheme = (uiTheme: UiThemeId) => uiTheme !== "classic";

const terminalScanlineForTheme = (uiTheme: UiThemeId) =>
  uiTheme === "terminal-amber" ? "#7a3d08" : "#145c22";

const terminalRoomBackdropForTheme = (uiTheme: UiThemeId) =>
  uiTheme === "terminal-amber" ? "#090500" : "#020804";

const terminalStatusPanelForTheme = (uiTheme: UiThemeId) =>
  uiTheme === "terminal-amber" ? "#160c03" : "#031207";

const terminalStatusTextForTheme = (uiTheme: UiThemeId) =>
  uiTheme === "terminal-amber" ? "#ffe4a3" : "#d8ffd0";

interface TraitVisualTheme {
  body: string;
  bodyLight: string;
  bodyLow: string;
  bodyDepleted: string;
  accent: string;
  eye: string;
  ink: string;
  screenGlow: string;
}

const traitVisualThemes: Record<DominantTrait, TraitVisualTheme> = {
  focus: {
    body: "#5f6dff",
    bodyLight: "#9ee6ff",
    bodyLow: "#465178",
    bodyDepleted: "#252b46",
    accent: "#78f0ff",
    eye: "#f4f8ff",
    ink: "#201c36",
    screenGlow: "#8de8ff",
  },
  resilience: {
    body: "#e76f73",
    bodyLight: "#ffc46b",
    bodyLow: "#9b4b55",
    bodyDepleted: "#4a2730",
    accent: "#ffe66d",
    eye: "#fff4d0",
    ink: "#3a1d2a",
    screenGlow: "#ffb25c",
  },
  curiosity: {
    body: "#5bcfa8",
    bodyLight: "#ffe66d",
    bodyLow: "#437b68",
    bodyDepleted: "#253f3b",
    accent: "#ff8fd5",
    eye: "#fff8df",
    ink: "#17352f",
    screenGlow: "#8df7c4",
  },
  efficiency: {
    body: "#36bdd6",
    bodyLight: "#f4fbff",
    bodyLow: "#317083",
    bodyDepleted: "#1d3d4a",
    accent: "#b4f56c",
    eye: "#efffff",
    ink: "#132437",
    screenGlow: "#b4f56c",
  },
  creativity: {
    body: "#b65cff",
    bodyLight: "#ffd6ff",
    bodyLow: "#704087",
    bodyDepleted: "#382646",
    accent: "#ffe66d",
    eye: "#fff4ff",
    ink: "#2b1838",
    screenGlow: "#ff8fd5",
  },
  warmth: {
    body: "#ff9a6b",
    bodyLight: "#ffe0a3",
    bodyLow: "#9a5d49",
    bodyDepleted: "#4a3029",
    accent: "#ffef8a",
    eye: "#fff7d8",
    ink: "#3a2018",
    screenGlow: "#ffc46b",
  },
};

const dominantTraitFromMemory = (memory?: AivatarMemory): DominantTrait => {
  const traits = memory?.growth.traits;
  if (!traits) return "focus";

  return (Object.entries(traits) as Array<[DominantTrait, number]>).sort(
    ([leftTrait, leftValue], [rightTrait, rightValue]) =>
      rightValue - leftValue || leftTrait.localeCompare(rightTrait),
  )[0]?.[0] ?? "focus";
};

const traitBubbleText = (
  trait: DominantTrait,
  behavior: AvatarRuntime["behavior"],
  fallback: string,
) => {
  const copy: Record<DominantTrait, Partial<Record<AvatarRuntime["behavior"], string>>> = {
    focus: {
      thinking: "Tracing it",
      coding: "Deep work",
      error: "Inspecting",
      success: "Clean pass",
      relax: "Recenter",
      admire: "Studying",
      brew: "Prep focus",
      paint: "Slow line",
    },
    resilience: {
      thinking: "Hold steady",
      coding: "Pushing on",
      error: "We recover",
      success: "Back up",
      play: "Reset mood",
      paint: "Making it",
      sleep: "Recovering",
      snack: "Refuel",
    },
    curiosity: {
      thinking: "What if?",
      coding: "Trying paths",
      error: "What broke?",
      success: "Found it",
      admire: "New detail",
      paint: "Color idea",
      interact: "Looking closer",
      wander: "Exploring",
    },
    efficiency: {
      thinking: "Plan route",
      coding: "Optimizing",
      error: "Scanning",
      success: "Done clean",
      brew: "Stocking up",
      play: "Quick reset",
      paint: "Clean strokes",
      snack: "Fast fuel",
    },
    creativity: {
      thinking: "Sketching",
      coding: "New angle",
      success: "Spark!",
      admire: "Pretty idea",
      paint: "New color",
      interact: "Remixing",
      wander: "Wondering",
    },
    warmth: {
      thinking: "Gentle focus",
      coding: "With you",
      error: "It's okay",
      success: "Good job",
      play: "Joy break",
      paint: "Soft colors",
      sleep: "Cozy rest",
      snack: "Warm bite",
    },
  };

  return copy[trait][behavior] ?? fallback;
};

const IDLE_BUBBLE_CYCLE_MS = 12000;
const IDLE_BUBBLE_VISIBLE_MS = 3600;

const idleBubbleBehaviors = new Set<AvatarRuntime["behavior"]>([
  "idle",
  "phone",
  "wander",
  "relax",
  "interact",
  "admire",
  "paint",
  "music",
]);

const stableTextHash = (text: string) =>
  Array.from(text).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    7,
  );

const idleBubbleText = (
  trait: DominantTrait,
  behavior: AvatarRuntime["behavior"],
  customPhrases: string[] = [],
) => {
  if (!idleBubbleBehaviors.has(behavior)) return null;

  const now = performance.now();
  if (now % IDLE_BUBBLE_CYCLE_MS > IDLE_BUBBLE_VISIBLE_MS) return null;

  const copy: Record<DominantTrait, string[]> = {
    focus: [
      "Tiny plan",
      "Stillness",
      "One more thought",
      "Neat room",
    ],
    resilience: [
      "All okay",
      "Soft reset",
      "Steady now",
      "I got this",
    ],
    curiosity: [
      "Ooh?",
      "What is that",
      "Small mystery",
      "New corner",
    ],
    efficiency: [
      "Tidying",
      "Route set",
      "Quick check",
      "All sorted",
    ],
    creativity: [
      "New idea",
      "Tiny spark",
      "Color thought",
      "What if",
    ],
    warmth: [
      "Cozy here",
      "You got this",
      "Soft light",
      "Take care",
    ],
  };
  const options = [...customPhrases, ...copy[trait]];
  const cycle = Math.floor(now / IDLE_BUBBLE_CYCLE_MS);
  const index =
    stableTextHash(`${trait}:${behavior}:${cycle}`) % options.length;
  return options[index];
};

const statusHasOwnSummary = (status: CodexStatusMessage) =>
  Boolean(
    (status.summary && status.summary.trim()) ||
      (status.message && status.message.trim()) ||
      (status.task && status.task.trim()) ||
      (status.phase && status.phase.trim()),
  );

const moodBandForStats = (stats: PetStats): MoodBand => {
  if (stats.mood < 20) return "depleted";
  if (stats.mood < 40) return "low";
  if (stats.mood >= 75) return "high";
  return "normal";
};

const drawTraitStatusMotif = (
  ctx: CanvasRenderingContext2D,
  trait: DominantTrait,
  avatar: AvatarRuntime,
  x: number,
  y: number,
  frame: number,
  theme: TraitVisualTheme,
) => {
  if (avatar.behavior !== "thinking" && avatar.behavior !== "success" && avatar.behavior !== "error") {
    return;
  }

  const pulse = Math.round(Math.sin(frame / 6));

  if (trait === "focus" && avatar.behavior === "thinking") {
    drawPixelRect(ctx, x - 4, y - 43 + pulse, 3, 3, theme.accent);
    drawPixelRect(ctx, x + 4, y - 45 - pulse, 3, 3, theme.bodyLight);
    drawPixelRect(ctx, x + 12, y - 42, 2, 2, theme.accent);
  }

  if (trait === "resilience" && (avatar.behavior === "success" || avatar.behavior === "error")) {
    drawPixelRect(ctx, x - 18, y - 34 + pulse, 3, 7, theme.accent);
    drawPixelRect(ctx, x - 20, y - 31 + pulse, 7, 3, theme.accent);
    drawPixelRect(ctx, x + 16, y - 33 - pulse, 3, 6, theme.bodyLight);
  }

  if (trait === "curiosity" && (avatar.behavior === "thinking" || avatar.behavior === "error")) {
    drawPixelText(ctx, "?", x + 16, y - 41 + pulse, theme.accent);
  }

  if (trait === "efficiency" && avatar.behavior === "success") {
    drawPixelRect(ctx, x + 15, y - 38, 3, 3, theme.accent);
    drawPixelRect(ctx, x + 18, y - 35, 3, 3, theme.accent);
    drawPixelRect(ctx, x + 21, y - 38, 3, 3, theme.accent);
  }
};

const drawTraitMicroExpression = (
  ctx: CanvasRenderingContext2D,
  trait: DominantTrait,
  avatar: AvatarRuntime,
  x: number,
  y: number,
  frame: number,
  theme: TraitVisualTheme,
) => {
  if (avatar.behavior === "sleep") return;

  const pulse = Math.round(Math.sin(frame / 8));
  const sparkle = Math.round(Math.sin(frame / 5));
  const sideDirection = avatar.facing === "left" ? -1 : 1;
  const isSide = avatar.facing === "left" || avatar.facing === "right";

  if (trait === "focus") {
    drawPixelRect(ctx, x - 12, y - 30 + pulse, 4, 1, theme.accent);
    drawPixelRect(ctx, x + 8, y - 32 - pulse, 5, 1, theme.accent);
    drawPixelRect(ctx, x + (isSide ? sideDirection * 12 : 0), y - 37, 2, 2, theme.bodyLight);
    return;
  }

  if (trait === "resilience") {
    const fistX = x + (isSide ? sideDirection * 18 : 18);
    const fistY = y - 9 + pulse;
    drawPixelRect(ctx, fistX - 3, fistY, 7, 6, theme.accent);
    drawPixelRect(ctx, fistX - 1, fistY - 3, 4, 3, theme.bodyLight);
    drawPixelRect(ctx, fistX - 4, fistY + 3, 3, 5, theme.body);
    return;
  }

  if (trait === "curiosity") {
    drawPixelText(ctx, "?", x + (isSide ? sideDirection * 16 : 16), y - 41 + pulse, theme.accent);
    drawPixelRect(ctx, x - 3, y - 30 - sparkle, 2, 2, theme.bodyLight);
    drawPixelRect(ctx, x + 6, y - 33 + sparkle, 2, 2, theme.accent);
    return;
  }

  if (trait === "efficiency") {
    const markX = x + (isSide ? sideDirection * 15 : 14);
    const markY = y - 34 + pulse;
    drawPixelRect(ctx, markX - 4, markY + 4, 3, 3, theme.accent);
    drawPixelRect(ctx, markX - 1, markY + 7, 3, 3, theme.accent);
    drawPixelRect(ctx, markX + 2, markY + 4, 3, 3, theme.accent);
    drawPixelRect(ctx, markX + 5, markY + 1, 3, 3, theme.bodyLight);
    return;
  }

  if (trait === "creativity") {
    drawPixelRect(ctx, x - 17, y - 37 + sparkle, 3, 3, theme.accent);
    drawPixelRect(ctx, x - 19, y - 35 + sparkle, 7, 1, theme.accent);
    drawPixelRect(ctx, x - 16, y - 38 + sparkle, 1, 7, theme.accent);
    drawPixelRect(ctx, x + 15, y - 33 - sparkle, 3, 3, theme.bodyLight);
    drawPixelRect(ctx, x + 19, y - 29 + sparkle, 2, 2, "#ff8fd5");
    return;
  }

  if (trait === "warmth") {
    const blushY = y - 15 + pulse;
    if (avatar.facing === "front") {
      drawPixelRect(ctx, x - 13, blushY, 4, 2, "#ffd6c2");
      drawPixelRect(ctx, x + 11, blushY, 4, 2, "#ffd6c2");
    } else if (isSide) {
      drawPixelRect(ctx, x + sideDirection * 10, blushY, 4, 2, "#ffd6c2");
    }
    drawPixelRect(ctx, x + (isSide ? sideDirection * 17 : 17), y - 35 - pulse, 2, 2, theme.accent);
    drawPixelRect(ctx, x + (isSide ? sideDirection * 19 : 19), y - 35 - pulse, 2, 2, theme.accent);
    drawPixelRect(ctx, x + (isSide ? sideDirection * 18 : 18), y - 33 - pulse, 2, 2, theme.accent);
  }
};

const compactStatusText = (status: CodexStatusMessage, fallback: string) =>
  [
    status.agent,
    status.summary ?? status.message ?? status.task ?? status.phase ?? fallback,
  ]
    .filter(Boolean)
    .join(": ")
    .replace(/\s+/g, " ")
    .trim();

const truncateText = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;

const pixelGlyphs: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["010", "110", "010", "010", "010", "010", "111"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ".": ["0", "0", "0", "0", "0", "0", "1"],
  ",": ["0", "0", "0", "0", "0", "1", "1"],
  ":": ["0", "1", "0", "0", "0", "1", "0"],
  ";": ["0", "1", "0", "0", "0", "1", "1"],
  "!": ["1", "1", "1", "1", "1", "0", "1"],
  "?": ["1110", "0001", "0001", "0010", "0100", "0000", "0100"],
  "-": ["0", "0", "0", "1111", "0", "0", "0"],
  "_": ["0", "0", "0", "0", "0", "0", "1111"],
  "+": ["0", "010", "010", "111", "010", "010", "0"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "\\": ["10000", "01000", "01000", "00100", "00010", "00010", "00001"],
  "|": ["1", "1", "1", "1", "1", "1", "1"],
  "(": ["01", "10", "10", "10", "10", "10", "01"],
  ")": ["10", "01", "01", "01", "01", "01", "10"],
  "[": ["11", "10", "10", "10", "10", "10", "11"],
  "]": ["11", "01", "01", "01", "01", "01", "11"],
  "'": ["1", "1", "0", "0", "0", "0", "0"],
  '"': ["101", "101", "0", "0", "0", "0", "0"],
};

const pixelGlyphFor = (char: string) => pixelGlyphs[char.toUpperCase()];

const measurePixelText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  scale = 1,
) => {
  let width = 0;

  for (const char of text) {
    if (char === " ") {
      width += 4 * scale;
      continue;
    }

    const glyph = pixelGlyphFor(char);
    if (glyph) {
      width += (glyph[0].length + 1) * scale;
      continue;
    }

    const previousFont = ctx.font;
    ctx.font = isCjkCharacter(char)
      ? `${9 * scale}px ${CJK_CANVAS_FONT}`
      : `${8 * scale}px monospace`;
    width += Math.ceil(ctx.measureText(char).width) + scale;
    ctx.font = previousFont;
  }

  return Math.max(0, width - scale);
};

const drawPixelText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
) => {
  let cursorX = Math.round(x);
  const baseY = Math.round(y);
  ctx.fillStyle = color;

  for (const char of text) {
    if (char === " ") {
      cursorX += 4 * scale;
      continue;
    }

    const glyph = pixelGlyphFor(char);
    if (!glyph) {
      ctx.font = isCjkCharacter(char)
        ? `${9 * scale}px ${CJK_CANVAS_FONT}`
        : `${8 * scale}px monospace`;
      ctx.fillText(char, cursorX, baseY + 7 * scale);
      cursorX += Math.ceil(ctx.measureText(char).width) + scale;
      continue;
    }

    glyph.forEach((row, rowIndex) => {
      [...row].forEach((cell, columnIndex) => {
        if (cell === "1") {
          drawPixelRect(
            ctx,
            cursorX + columnIndex * scale,
            baseY + rowIndex * scale,
            scale,
            scale,
            color,
          );
        }
      });
    });
    cursorX += (glyph[0].length + 1) * scale;
  }
};

const ellipsizeToWidth = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) => {
  if (measurePixelText(ctx, text) <= maxWidth) return text;

  let next = text;
  while (next.length > 0 && measurePixelText(ctx, `${next}...`) > maxWidth) {
    next = next.slice(0, -1);
  }

  return next ? `${next}...` : "...";
};

const wrapBubbleTextByWidth = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  if (maxLines <= 1) return [ellipsizeToWidth(ctx, normalized, maxWidth)];

  const lines: string[] = [];
  let line = "";
  let consumed = 0;

  for (const char of normalized) {
    const next = `${line}${char}`;
    if (line && measurePixelText(ctx, next) > maxWidth) {
      lines.push(line.trim());
      consumed += line.length;
      line = char.trimStart();
      if (lines.length === maxLines - 1) break;
    } else {
      line = next;
    }
  }

  const remaining = normalized.slice(consumed).trim();
  const last = lines.length === maxLines - 1 ? remaining || line : line;
  if (last) {
    lines.push(ellipsizeToWidth(ctx, last.trim(), maxWidth));
  }

  return lines.length > 0 ? lines.slice(0, maxLines) : [""];
};

const wrapBubbleText = (text: string, maxLineLength: number, maxLines: number) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (maxLines <= 1) return [truncateText(normalized, maxLineLength)];

  const lines: string[] = [];
  let remaining = normalized;

  while (remaining && lines.length < maxLines) {
    const isLastLine = lines.length === maxLines - 1;
    if (remaining.length <= maxLineLength) {
      lines.push(remaining);
      break;
    }

    if (isLastLine) {
      lines.push(truncateText(remaining, maxLineLength));
      break;
    }

    const slice = remaining.slice(0, maxLineLength + 1);
    const breakAt = Math.max(slice.lastIndexOf(" "), Math.floor(maxLineLength * 0.62));
    const line = remaining.slice(0, breakAt).trim();
    lines.push(line || remaining.slice(0, maxLineLength));
    remaining = remaining.slice(lines[lines.length - 1].length).trim();
  }

  return lines.length > 0 ? lines : [""];
};

const STATUS_BUBBLE_VISIBLE_MS = 6000;
const BUILTIN_TERMINAL_PLACED_ITEM_ID = "builtin-terminal";
const TERMINAL_MONITOR_ITEM_ID = "terminal-monitor";

const isStatusBubbleVisible = (status: CodexStatusMessage) => {
  if (["thinking", "executing", "waiting_for_user", "error"].includes(status.status)) {
    return true;
  }

  const updatedAt = Date.parse(status.timestamp);
  if (Number.isNaN(updatedAt)) return true;
  return Date.now() - updatedAt <= STATUS_BUBBLE_VISIBLE_MS;
};

const fallbackFloorPalette: RoomSurfacePalette = {
  border: "#2a160c",
  base: "#925324",
  plankA: "#a7612b",
  plankB: "#b66f34",
  plankC: "#965526",
  plankD: "#c17a38",
  seam: "#6c3719",
  highlight: "#dc944a",
  grainDark: "#7b421d",
  grainLight: "#cf8840",
};

const fallbackWallPalette: RoomSurfacePalette = {
  border: "#2a160c",
  base: "#b86c2f",
  plankA: "#b86c2f",
  plankB: "#c87936",
  plankC: "#a85e29",
  plankD: "#d58a42",
  seam: "#8e4b22",
  highlight: "#df9148",
  grainDark: "#85451f",
  grainLight: "#dc9148",
};

const resolveSurface = (
  surfaces: RoomSurfaceDefinition[] | undefined,
  surfaceId: string | undefined,
  fallbackPalette: RoomSurfacePalette,
): RoomSurfaceDefinition => {
  const surface =
    surfaces?.find((candidate) => candidate.id === surfaceId) ?? surfaces?.[0];

  return {
    id: surface?.id ?? "fallback",
    name: surface?.name ?? "Fallback Surface",
    palette: {
      ...fallbackPalette,
      ...(surface?.palette ?? {}),
    },
  };
};

const fallbackWindow: RoomWindowDefinition = {
  id: "cozy-window",
  name: "Cozy Window",
  kind: "cozy-window",
  x: 178,
  y: 36,
  width: 72,
  height: 48,
};

const resolveRoomWindow = (
  windows: RoomWindowDefinition[] | undefined,
  windowId: string | undefined,
) => windows?.find((candidate) => candidate.id === windowId) ?? windows?.[0] ?? fallbackWindow;

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

const drawTaskFileSheet = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width = 10,
  height = 13,
  accent = "#9ee6ff",
  failed = false,
) => {
  drawPixelRect(ctx, x, y, width, height, "#f4ead2");
  drawPixelRect(ctx, x + width - 3, y, 3, 3, "#d7caa8");
  drawPixelRect(ctx, x + width - 2, y + 1, 2, 2, "#fff8df");
  drawPixelRect(ctx, x + 2, y + 3, Math.max(3, width - 5), 1, accent);
  drawPixelRect(ctx, x + 2, y + 6, Math.max(4, width - 4), 1, "#8f8270");
  drawPixelRect(ctx, x + 2, y + 9, Math.max(3, width - 6), 1, "#8f8270");
  if (failed) {
    const markSize = Math.min(width - 4, height - 4);
    for (let offset = 0; offset < markSize; offset += 1) {
      drawPixelRect(ctx, x + 2 + offset, y + 2 + offset, 1, 1, "#ff5c7a");
      drawPixelRect(ctx, x + width - 3 - offset, y + 2 + offset, 1, 1, "#ff5c7a");
    }
  }
};

const drawFileCabinet = (
  ctx: CanvasRenderingContext2D,
  item: FurnitureDefinition,
  highlight: "none" | "hover" | "selected",
  frame = 0,
  taskFileCount = 0,
  failedTaskFileCount = 0,
) => {
  const count = Math.max(0, Math.min(12, Math.round(taskFileCount)));
  const failedCount = Math.max(0, Math.min(count, Math.round(failedTaskFileCount)));
  const pulse = Math.round(Math.sin(frame / 10));
  const openLevel = count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : 3;
  const openDepth = [0, 2, 4, 5][openLevel];
  const body = item.color || "#54606f";

  drawPixelRect(ctx, item.x + 4, item.y + item.height + 1, item.width - 6, 5, "#151321");
  drawPixelRect(ctx, item.x - 2, item.y - 4, item.width + 4, item.height + 8, "#222936");
  drawPixelRect(ctx, item.x, item.y - 2, item.width, item.height + 4, "#3a4655");
  const faceX = item.x + 4;
  const faceWidth = item.width - 8;
  drawPixelRect(ctx, faceX, item.y + 3, faceWidth, item.height - 3, body);
  drawPixelRect(ctx, item.x + 2, item.y - 8, item.width - 4, 10, "#7d8998");
  drawPixelRect(ctx, item.x + 6, item.y - 11, item.width - 12, 4, "#a5afbc");
  drawPixelRect(ctx, item.x + 5, item.y - 7, item.width - 11, 3, "#c1c9d2");
  drawPixelRect(ctx, item.x + 2, item.y + 1, item.width - 5, 2, "#4b5666");
  drawPixelRect(ctx, item.x + item.width - 8, item.y - 8, 5, 10, "#566272");
  drawPixelRect(ctx, faceX + 3, item.y + 6, faceWidth - 8, 2, "#84909f");
  drawPixelRect(ctx, faceX + faceWidth - 4, item.y + 2, 3, item.height - 3, "#36404e");
  drawPixelRect(ctx, item.x + 3, item.y + item.height - 4, item.width - 8, 3, "#2b3440");

  const drawerHeight = 16;
  const drawerY = [item.y + 10, item.y + 28, item.y + 46];
  drawerY.forEach((y, index) => {
    const isOpen = openLevel > index;
    const depth = isOpen ? Math.max(1, openDepth - index) : 0;
    const drawerX = faceX + 2;
    const drawerWidth = faceWidth - 4;
    const drawerFrontY = y + depth;

    drawPixelRect(
      ctx,
      drawerX - 1,
      y - 1,
      drawerWidth + 2,
      drawerHeight + depth + 2,
      "#27313d",
    );
    if (depth > 0) {
      drawPixelRect(ctx, drawerX + 2, y, drawerWidth - 4, depth + 3, "#1f2732");
      drawPixelRect(ctx, drawerX + 4, y - 4, drawerWidth - 8, 5, "#d7caa8");
      const fileSlots = Math.min(4, Math.max(0, count - index * 3));
      for (let fileIndex = 0; fileIndex < fileSlots; fileIndex += 1) {
        const taskIndex = index * 3 + fileIndex;
        const fileX = drawerX + 3 + fileIndex * 5;
        const fileY = y - 5 - (fileIndex % 2);
        drawTaskFileSheet(
          ctx,
          fileX,
          fileY,
          10,
          13,
          fileIndex % 3 === 0 ? "#9ee6ff" : fileIndex % 3 === 1 ? "#ffe66d" : "#ff8fa3",
          taskIndex < failedCount,
        );
      }
    }
    drawPixelRect(
      ctx,
      drawerX,
      drawerFrontY,
      drawerWidth,
      drawerHeight,
      isOpen ? "#788493" : "#566271",
    );
    drawPixelRect(ctx, drawerX + 3, drawerFrontY + 3, drawerWidth - 6, 2, "#9aa6b5");
    drawPixelRect(ctx, drawerX + drawerWidth / 2 - 6, drawerFrontY + 9, 12, 3, "#202936");
    drawPixelRect(ctx, drawerX + drawerWidth / 2 - 4, drawerFrontY + 8, 8, 2, "#d2a24a");
  });

  if (count > 0) {
    drawPixelRect(ctx, item.x + item.width - 10, item.y - 10 + pulse, 7, 9, "#ffe66d");
    drawPixelRect(ctx, item.x + item.width - 8, item.y - 7 + pulse, 3, 1, "#5a3c13");
    drawPixelRect(ctx, item.x + 6, item.y - 11, 16, 9, "#f4ead2");
    drawPixelRect(ctx, item.x + 8, item.y - 8, 11, 1, "#8f8270");
  }

  if (count >= 6) {
    drawPixelRect(ctx, item.x - 7, item.y + item.height - 6, 16, 10, "#f4ead2");
    drawPixelRect(ctx, item.x - 5, item.y + item.height - 3, 10, 1, "#8f8270");
  }

  if (highlight !== "none") {
    ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.round(item.x - 5),
      Math.round(item.y - 8),
      Math.round(item.width + 10),
      Math.round(item.height + 16),
    );
  }
};

const drawPlaceableFileCabinet = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  frame = 0,
  taskFileCount = 0,
  failedTaskFileCount = 0,
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;

  drawFileCabinet(
    ctx,
    {
      id: "file-cabinet",
      name: "File Cabinet",
      tags: ["furniture", "file-cabinet"],
      placementSurfaces: ["floor"],
      zone: "office",
      x: Math.round(x) - 22,
      y: Math.round(y) - 58,
      width: 44,
      height: 58,
      color: "#54606f",
      interaction: "interact",
    },
    ghost === "none" ? "none" : ghost === "valid" ? "hover" : "selected",
    frame,
    taskFileCount,
    failedTaskFileCount,
  );

  ctx.restore();
};

const isFurnitureInFrontOfAvatar = (
  item: FurnitureDefinition,
  avatar: AvatarRuntime,
) => {
  const avatarFeetY = avatar.y + 12;
  const bounds = getFurnitureVisualBounds(item);
  const occlusionLine =
    item.id === "bed"
      ? item.y + item.height - 14
      : item.id === "desk"
        ? item.y + 46
        : item.id === "table"
          ? item.y + 32
          : item.id === "fridge"
            ? item.y + item.height - 10
            : item.id === "file-cabinet"
              ? item.y + item.height - 8
              : bounds.y + bounds.height;

  return avatarFeetY < occlusionLine;
};

const furnitureDepthY = (item: FurnitureDefinition) => {
  if (item.id === "bed") return item.y + item.height - 4;
  if (item.id === "desk") return item.y + 74;
  if (item.id === "table") return item.y + 62;
  if (item.id === "fridge") return item.y + item.height + 9;
  if (item.id === "file-cabinet") return item.y + item.height + 8;

  const bounds = getFurnitureVisualBounds(item);
  return bounds.y + bounds.height;
};

const furnitureByDepth = (furniture: FurnitureDefinition[]) =>
  [...furniture].sort(
    (left, right) =>
      furnitureDepthY(left) - furnitureDepthY(right) ||
      left.x - right.x ||
      left.id.localeCompare(right.id),
  );

const bedSkinId = (item: FurnitureDefinition): BedSkinId =>
  item.skinId === "industrial-bed-skin" ||
  item.skinId === "wood-red-bed-skin" ||
  item.skinId === "ivory-pink-plaid-bed-skin" ||
  item.skinId === "modern-minimal-bed-skin" ||
  item.skinId === "space-white-deep-gray-bed-skin"
    ? item.skinId
    : "classic";

const bedPalette = (item: FurnitureDefinition) =>
  bedSkinId(item) === "industrial-bed-skin"
    ? {
        shadow: "#12161d",
        frameDark: "#222933",
        frame: "#4d5663",
        frameLight: "#8d98a6",
        frameBright: "#c5ccd2",
        frameAccent: "#697481",
        slatDark: "#171c24",
        pillow: "#d7dce0",
        pillowLight: "#eef1f3",
        pillowShade: "#aeb6bf",
        sheet: "#c4c9ce",
        sheetLight: "#e4e7ea",
        blanket: "#252a31",
        blanketLight: "#363c45",
        blanketMid: "#2d333b",
        blanketLow: "#1d2229",
        blanketDark: "#14181e",
        blanketSpark: "#727b86",
      }
    : bedSkinId(item) === "wood-red-bed-skin"
      ? {
          shadow: "#1f1510",
          frameDark: "#4d2614",
          frame: "#8a4a24",
          frameLight: "#c47a3c",
          frameBright: "#f0b46c",
          frameAccent: "#6b351a",
          slatDark: "#35180d",
          pillow: "#f5e6d0",
          pillowLight: "#fff4dc",
          pillowShade: "#d8b887",
          sheet: "#f4e4cf",
          sheetLight: "#fff3dc",
          blanket: "#9d1f2f",
          blanketLight: "#d6454b",
          blanketMid: "#b72b38",
          blanketLow: "#7e1728",
          blanketDark: "#5a1020",
          blanketSpark: "#ffd48a",
          bolt: "#d89b45",
          handle: "#7a451f",
          handleLight: "#d89b45",
        }
    : bedSkinId(item) === "ivory-pink-plaid-bed-skin"
      ? {
          shadow: "#30231f",
          frameDark: "#a99676",
          frame: "#eadbbd",
          frameLight: "#fff1d2",
          frameBright: "#fffbea",
          frameAccent: "#cdb58a",
          slatDark: "#88765a",
          pillow: "#fff0f4",
          pillowLight: "#fff9fb",
          pillowShade: "#e6b9c4",
          sheet: "#fff3e6",
          sheetLight: "#fffaf0",
          blanket: "#f4a1bd",
          blanketLight: "#ffd2df",
          blanketMid: "#ea7fa7",
          blanketLow: "#d86491",
          blanketDark: "#bd4d78",
          blanketSpark: "#fff4fa",
          bolt: "#f0d88d",
          handle: "#9f8354",
          handleLight: "#ffe7a3",
        }
    : bedSkinId(item) === "modern-minimal-bed-skin"
      ? {
          shadow: "#181a1c",
          frameDark: "#4a3927",
          frame: "#b9824d",
          frameLight: "#d8ae73",
          frameBright: "#f0d49b",
          frameAccent: "#8a623b",
          slatDark: "#2d2520",
          pillow: "#f4efe5",
          pillowLight: "#fffaf1",
          pillowShade: "#d5cbbd",
          sheet: "#eee7dc",
          sheetLight: "#fff8ed",
          blanket: "#7c998b",
          blanketLight: "#a7bdaf",
          blanketMid: "#8ba89a",
          blanketLow: "#617b70",
          blanketDark: "#40564e",
          blanketSpark: "#d8b46a",
          bolt: "#d8b46a",
          handle: "#2e3335",
          handleLight: "#6d7475",
        }
    : bedSkinId(item) === "space-white-deep-gray-bed-skin"
      ? {
          shadow: "#15191f",
          frameDark: "#8f9ca7",
          frame: "#e8eef2",
          frameLight: "#fbfdfd",
          frameBright: "#ffffff",
          frameAccent: "#c7d2da",
          slatDark: "#6e7b86",
          pillow: "#f5f8f8",
          pillowLight: "#ffffff",
          pillowShade: "#cbd5dc",
          sheet: "#e9eef1",
          sheetLight: "#ffffff",
          blanket: "#252b34",
          blanketLight: "#414a56",
          blanketMid: "#303844",
          blanketLow: "#1d232c",
          blanketDark: "#111720",
          blanketSpark: "#414a56",
          bolt: "#88d6ff",
          handle: "#202833",
          handleLight: "#5f6d7a",
        }
    : {
        shadow: "#151321",
        frameDark: "#5a2b1c",
        frame: "#8f4e38",
        frameLight: "#d4875d",
        frameBright: "#d4875d",
        frameAccent: "#a76549",
        slatDark: "#3c1b13",
        pillow: "#f4ead2",
        pillowLight: "#fff8df",
        pillowShade: "#d7b98d",
        sheet: "#f4ead2",
        sheetLight: "#fff8df",
        blanket: "#132d78",
        blanketLight: "#2551b5",
        blanketMid: "#132d78",
        blanketLow: "#102667",
        blanketDark: "#0b1e57",
        blanketSpark: "#ffe58a",
      };

const deskSkinId = (item: FurnitureDefinition): DeskSkinId =>
  item.skinId === "industrial-desk-skin" ||
  item.skinId === "rococo-ivory-desk-skin" ||
  item.skinId === "transparent-acrylic-desk-skin"
    ? item.skinId
    : "classic";

const deskPalette = (item: FurnitureDefinition) =>
  deskSkinId(item) === "industrial-desk-skin"
    ? {
        shadow: "#101217",
        topDark: "#2a1710",
        top: "#4a2618",
        topMid: "#5d3321",
        topLight: "#815136",
        topEdge: "#1b0f0a",
        padDark: "#11151a",
        pad: "#252b31",
        padLight: "#4c5660",
        metalDark: "#080a0d",
        metal: "#171b21",
        metalMid: "#262c34",
        metalLight: "#5d6873",
        bolt: "#8b98a5",
        handle: "#2f3842",
        handleLight: "#6f7d8a",
      }
    : deskSkinId(item) === "transparent-acrylic-desk-skin"
      ? {
          shadow: "rgba(9, 18, 24, 0.54)",
          topDark: "rgba(105, 177, 204, 0.38)",
          top: "rgba(215, 246, 255, 0.46)",
          topMid: "rgba(157, 220, 238, 0.42)",
          topLight: "rgba(249, 254, 255, 0.82)",
          topEdge: "rgba(63, 170, 204, 0.68)",
          padDark: "rgba(69, 145, 170, 0.42)",
          pad: "rgba(199, 244, 255, 0.58)",
          padLight: "rgba(255, 255, 255, 0.78)",
          metalDark: "#080b0f",
          metal: "#151b22",
          metalMid: "#2c3740",
          metalLight: "#b7d8e3",
          bolt: "#dff8ff",
          handle: "#22303a",
          handleLight: "#9fe6f6",
        }
    : deskSkinId(item) === "rococo-ivory-desk-skin"
      ? {
          shadow: "#2c231c",
          topDark: "#aa9777",
          top: "#eadbbd",
          topMid: "#d7c39e",
          topLight: "#fff4d8",
          topEdge: "#8f7a58",
          padDark: "#c9b68e",
          pad: "#f4e8cf",
          padLight: "#fffaf0",
          metalDark: "#9a835c",
          metal: "#d8c59b",
          metalMid: "#efe0bf",
          metalLight: "#fff6df",
          bolt: "#f4d98a",
          handle: "#a88442",
          handleLight: "#ffe8a4",
        }
    : {
        shadow: "#151321",
        topDark: "#5a2b1c",
        top: "#8f4e38",
        topMid: "#a76549",
        topLight: "#d4875d",
        topEdge: "#3c1b13",
        padDark: "#111624",
        pad: "#282b2d",
        padLight: "#45494d",
        metalDark: "#2a120d",
        metal: "#3b1a11",
        metalMid: "#8f4e38",
        metalLight: "#b86d4d",
        bolt: "#d2a24a",
        handle: "#8f611c",
        handleLight: "#d2a24a",
      };

const tableSkinId = (item: FurnitureDefinition): TableSkinId =>
  item.skinId === "rococo-ivory-table-skin" ||
  item.skinId === "dark-oak-table-skin" ||
  item.skinId === "white-tech-table-skin"
    ? item.skinId
    : "classic";

const fridgeSkinId = (item: FurnitureDefinition): FridgeSkinId =>
  item.skinId === "ivory-fridge-skin" ||
  item.skinId === "red-retro-fridge-skin" ||
  item.skinId === "white-tech-fridge-skin"
    ? item.skinId
    : "classic";

const drawBedFootboard = (
  ctx: CanvasRenderingContext2D,
  item: FurnitureDefinition,
  highlight: "none" | "hover" | "selected",
) => {
  const palette = bedPalette(item);

  drawPixelRect(ctx, item.x - 2, item.y + item.height - 18, item.width + 4, 17, palette.frameDark);
  drawPixelRect(ctx, item.x + 2, item.y + item.height - 15, item.width - 4, 11, palette.frame);
  drawPixelRect(ctx, item.x + 14, item.y + item.height - 11, 12, 4, palette.frameLight);
  drawPixelRect(ctx, item.x + item.width - 26, item.y + item.height - 11, 12, 4, palette.frameLight);
  drawPixelRect(ctx, item.x + 38, item.y + item.height - 12, 10, 4, palette.slatDark);

  if (highlight !== "none") {
    ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.round(item.x - 5),
      Math.round(item.y - 6),
      Math.round(item.width + 10),
      Math.round(item.height + 12),
    );
  }
  if (highlight === "selected") {
    drawFurnitureCollisionRange(ctx, item);
  }
};

const drawBedFootboardAvatarOcclusion = (
  ctx: CanvasRenderingContext2D,
  item: FurnitureDefinition,
  avatar: AvatarRuntime,
) => {
  const clipLeft = Math.max(item.x - 2, Math.round(avatar.x - 16));
  const clipRight = Math.min(item.x + item.width + 2, Math.round(avatar.x + 16));
  if (clipRight <= clipLeft) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(clipLeft, item.y + item.height - 20, clipRight - clipLeft, 24);
  ctx.clip();
  drawBedFootboard(ctx, item, "none");
  ctx.restore();
};

const isPlacedItemInFrontOfAvatar = (
  item: PlacedItem,
  definition: ItemDefinition | undefined,
  avatar: AvatarRuntime,
) => {
  if (!definition || item.surfaceFurnitureId || isFloorUnderlayItem(item.itemId)) {
    return false;
  }
  if (getItemPlacementKind(definition) !== "floor") return false;

  const avatarFeetY = avatar.y + 12;
  const bounds = placedItemBounds(item);
  const occlusionLine = bounds.y + bounds.height - Math.min(8, bounds.height * 0.2);

  return avatarFeetY < occlusionLine;
};

const drawFurnitureCollisionRange = (
  ctx: CanvasRenderingContext2D,
  item: FurnitureDefinition,
) => {
  const collision = item.collision;
  if (!collision) return;

  ctx.save();
  ctx.fillStyle = "rgba(255, 64, 64, 0.14)";
  ctx.strokeStyle = "#ff4040";
  ctx.lineWidth = 2;
  ctx.fillRect(
    Math.round(collision.x),
    Math.round(collision.y),
    Math.round(collision.width),
    Math.round(collision.height),
  );
  ctx.strokeRect(
    Math.round(collision.x),
    Math.round(collision.y),
    Math.round(collision.width),
    Math.round(collision.height),
  );
  ctx.restore();
};

const drawInteractionPoint = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
) => {
  const px = Math.round(x);
  const py = Math.round(y);

  ctx.save();
  ctx.fillStyle = "rgba(20, 24, 38, 0.72)";
  ctx.fillRect(px - 5, py - 5, 10, 10);
  ctx.fillStyle = "#8df7c4";
  ctx.fillRect(px - 1, py - 5, 2, 10);
  ctx.fillRect(px - 5, py - 1, 10, 2);
  ctx.fillStyle = "#ffe66d";
  ctx.fillRect(px - 1, py - 1, 2, 2);
  ctx.restore();
};

const drawFootProjectionRange = (
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
) => {
  ctx.save();
  ctx.fillStyle = "rgba(220, 220, 220, 0.22)";
  ctx.strokeStyle = "#d8d8d8";
  ctx.lineWidth = 1;
  ctx.fillRect(
    Math.round(bounds.x),
    Math.round(bounds.y),
    Math.round(bounds.width),
    Math.round(bounds.height),
  );
  ctx.strokeRect(
    Math.round(bounds.x),
    Math.round(bounds.y),
    Math.round(bounds.width),
    Math.round(bounds.height),
  );
  ctx.restore();
};

const NAV_DEBUG_GRID_SIZE = 8;
const NAV_DEBUG_MIN_X = 84;
const NAV_DEBUG_MAX_X = 396;
const NAV_DEBUG_MIN_Y = 136;
const NAV_DEBUG_MAX_Y = 300;
const NAV_DEBUG_FOOT_HALF_WIDTH = 6;
const NAV_DEBUG_FOOT_TOP_OFFSET = 6;
const NAV_DEBUG_FOOT_HEIGHT = 8;
const NAV_DEBUG_PLANNING_CLEARANCE = 4;

const navDebugFootBounds = (x: number, y: number) => ({
  x: x - NAV_DEBUG_FOOT_HALF_WIDTH,
  y: y + NAV_DEBUG_FOOT_TOP_OFFSET,
  width: NAV_DEBUG_FOOT_HALF_WIDTH * 2,
  height: NAV_DEBUG_FOOT_HEIGHT,
});

const navDebugCollisionPoint = (x: number, y: number) => ({
  x,
  y: y + NAV_DEBUG_FOOT_TOP_OFFSET + NAV_DEBUG_FOOT_HEIGHT / 2,
});

const navDebugInflatedRect = (
  rect: { x: number; y: number; width: number; height: number },
  clearance = 0,
) => {
  const insetX = NAV_DEBUG_FOOT_HALF_WIDTH + clearance;
  const insetY = NAV_DEBUG_FOOT_HEIGHT / 2 + clearance;

  return {
    x: rect.x - insetX,
    y: rect.y - insetY,
    width: rect.width + insetX * 2,
    height: rect.height + insetY * 2,
  };
};

const navDebugPointInsideRect = (
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
) =>
  point.x > rect.x + 0.5 &&
  point.x < rect.x + rect.width - 0.5 &&
  point.y > rect.y + 0.5 &&
  point.y < rect.y + rect.height - 0.5;

const navDebugCollisionRects = (content: AivatarContent) => [
  ...content.room.furniture
    .filter((item) => item.collision)
    .map((item) => item.collision!),
  ...(content.placedItems ?? [])
    .filter((item) => item.itemId === "oil-easel" && !item.surfaceFurnitureId)
    .map(getPlacedItemPlacementFootBounds),
];

const drawNavigationDebugOverlay = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  avatar: AvatarRuntime,
) => {
  const collisionRects = navDebugCollisionRects(content);

  ctx.save();
  for (let y = NAV_DEBUG_MIN_Y; y <= NAV_DEBUG_MAX_Y; y += NAV_DEBUG_GRID_SIZE) {
    for (let x = NAV_DEBUG_MIN_X; x <= NAV_DEBUG_MAX_X; x += NAV_DEBUG_GRID_SIZE) {
      const point = navDebugCollisionPoint(x, y);
      const blocked = collisionRects.some((rect) =>
        navDebugPointInsideRect(
          point,
          navDebugInflatedRect(rect, NAV_DEBUG_PLANNING_CLEARANCE),
        ),
      );
      ctx.fillStyle = blocked ? "rgba(255, 64, 64, 0.34)" : "rgba(64, 255, 150, 0.18)";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }

  collisionRects.forEach((rect) => {
    const inflated = navDebugInflatedRect(rect, NAV_DEBUG_PLANNING_CLEARANCE);
    ctx.fillStyle = "rgba(255, 64, 64, 0.08)";
    ctx.fillRect(inflated.x, inflated.y, inflated.width, inflated.height);
    ctx.fillStyle = "rgba(255, 64, 64, 0.16)";
    ctx.strokeStyle = "#ff4040";
    ctx.lineWidth = 1;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  });

  const foot = navDebugFootBounds(avatar.x, avatar.y);
  ctx.fillStyle = "rgba(90, 170, 255, 0.24)";
  ctx.strokeStyle = "#5aaaff";
  ctx.beginPath();
  ctx.ellipse(
    foot.x + foot.width / 2,
    foot.y + foot.height / 2,
    foot.width / 2,
    foot.height / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.stroke();

  const hasNavigationTarget =
    (avatar.behavior !== "idle" || avatar.actionIntent) &&
    Math.hypot(avatar.x - avatar.targetX, avatar.y - avatar.targetY) > 1;

  if (hasNavigationTarget) {
    ctx.strokeStyle = "#66e8ff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(avatar.x, avatar.y);
    ctx.lineTo(avatar.targetX, avatar.targetY);
    ctx.stroke();
    drawPixelRect(ctx, avatar.targetX - 3, avatar.targetY - 3, 6, 6, "#66e8ff");

    const path = getNavigationDebugPath(avatar, content);
    if (path.length > 1) {
      ctx.strokeStyle = "#00ffd5";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      path.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
      path.forEach((point) => {
        drawPixelRect(ctx, point.x - 1, point.y - 1, 3, 3, "#00ffd5");
      });
    }
  }

  (avatar.interactionTargetAlternates ?? []).forEach((point) => {
    drawPixelRect(ctx, point.x - 2, point.y - 2, 4, 4, "#ffe66d");
  });

  ctx.fillStyle = "rgba(15, 20, 30, 0.86)";
  ctx.fillRect(82, 28, 174, 46);
  drawPixelText(ctx, "Nav: green walk / red blocked", 88, 34, "#d8ffd0");
  drawPixelText(ctx, "blue target, yellow points", 88, 48, "#d8ffd0");
  drawPixelText(ctx, "cyan path = A* plan", 88, 62, "#d8ffd0");
  ctx.restore();
};

const drawSelectedInteractionPoints = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  selectedFurnitureId?: string | null,
  selectedPlacedItemId?: string | null,
) => {
  const selectedFurniture = selectedFurnitureId
    ? content.room.furniture.find((item) => item.id === selectedFurnitureId)
    : null;
  const selectedPlacedItem = selectedPlacedItemId
    ? (content.placedItems ?? []).find((item) => item.id === selectedPlacedItemId)
    : null;

  const points = selectedPlacedItem
    ? getPlacedItemInteractionStandpoints(selectedPlacedItem, content)
    : selectedFurniture
      ? getFurnitureInteractionStandpoints(selectedFurniture, content)
      : [];

  if (selectedPlacedItem) {
    const definition = itemDefinitionById(content, selectedPlacedItem.itemId);
    if (definition && getItemPlacementKind(definition) === "floor") {
      drawFootProjectionRange(
        ctx,
        getPlacedItemPlacementFootBounds(selectedPlacedItem),
      );
    }
  } else if (selectedFurniture) {
    drawFootProjectionRange(
      ctx,
      getFurniturePlacementFootBounds(
        selectedFurniture,
        selectedFurniture.x,
        selectedFurniture.y,
      ),
    );
  }

  points.forEach((point) => drawInteractionPoint(ctx, point.x, point.y));
};

const drawFurniture = (
  ctx: CanvasRenderingContext2D,
  item: FurnitureDefinition,
  highlight: "none" | "hover" | "selected",
  frame = 0,
  avatar?: AvatarRuntime,
  activeInteraction?: FurnitureInteractionState | null,
  taskCabinetFileCount = 0,
  failedTaskCabinetFileCount = 0,
) => {
  if (item.id === "file-cabinet") {
    drawFileCabinet(
      ctx,
      item,
      highlight,
      frame,
      taskCabinetFileCount,
      failedTaskCabinetFileCount,
    );
    if (highlight === "selected") {
      drawFurnitureCollisionRange(ctx, item);
    }
    return;
  }

  if (item.id === "bed") {
    const palette = bedPalette(item);
    const industrial = bedSkinId(item) === "industrial-bed-skin";
    const pinkPlaid = bedSkinId(item) === "ivory-pink-plaid-bed-skin";
    const modernMinimal =
      bedSkinId(item) === "modern-minimal-bed-skin" ||
      bedSkinId(item) === "space-white-deep-gray-bed-skin";

    drawPixelRect(ctx, item.x + 8, item.y + 10, item.width, item.height, palette.shadow);
    if (!modernMinimal) {
      drawPixelRect(ctx, item.x - 5, item.y - 8, 8, item.height + 18, palette.frameDark);
      drawPixelRect(ctx, item.x + item.width - 3, item.y - 8, 8, item.height + 18, palette.frameDark);
      drawPixelRect(ctx, item.x - 3, item.y - 10, 5, item.height + 21, palette.frame);
      drawPixelRect(ctx, item.x + item.width - 1, item.y - 10, 5, item.height + 21, palette.frame);
      drawPixelRect(ctx, item.x - 2, item.y - 6, 3, item.height + 12, palette.frameLight);
      drawPixelRect(ctx, item.x + item.width, item.y - 6, 3, item.height + 12, palette.frameLight);
      drawPixelRect(ctx, item.x - 6, item.y - 12, 10, 8, palette.frameDark);
      drawPixelRect(ctx, item.x + item.width - 4, item.y - 12, 10, 8, palette.frameDark);
      drawPixelRect(ctx, item.x - 4, item.y - 15, 6, 4, palette.frameBright);
      drawPixelRect(ctx, item.x + item.width - 1, item.y - 15, 6, 4, palette.frameBright);
    }

    if (modernMinimal) {
      drawPixelRect(ctx, item.x - 2, item.y - 2, item.width + 4, 28, palette.frameDark);
      drawPixelRect(ctx, item.x, item.y, item.width, 31, palette.frame);
      drawPixelRect(ctx, item.x + 5, item.y + 4, item.width - 10, 3, palette.frameLight);
      drawPixelRect(ctx, item.x + 7, item.y + 13, item.width - 14, 2, palette.frameAccent);
      drawPixelRect(ctx, item.x + 9, item.y + 20, item.width - 18, 2, palette.frameBright);
      drawPixelRect(ctx, item.x + 4, item.y + 27, item.width - 8, 2, palette.frameLight);
    } else {
      drawPixelRect(ctx, item.x - 2, item.y - 2, item.width + 4, 28, palette.frameDark);
      drawPixelRect(ctx, item.x + 2, item.y + 1, item.width - 4, 24, palette.frame);
      drawPixelRect(ctx, item.x + 6, item.y + 5, item.width - 12, 5, palette.frameLight);
      drawPixelRect(ctx, item.x + 8, item.y + 15, item.width - 16, 3, palette.slatDark);
      drawPixelRect(ctx, item.x + 18, item.y + 18, 14, 5, palette.frameAccent);
      drawPixelRect(ctx, item.x + item.width - 32, item.y + 18, 14, 5, palette.frameAccent);
    }
    if (pinkPlaid) {
      drawPixelRect(ctx, item.x - 1, item.y - 7, 1, item.height + 13, palette.frameBright);
      drawPixelRect(ctx, item.x + item.width + 1, item.y - 7, 1, item.height + 13, palette.frameBright);
      drawPixelRect(ctx, item.x + 7, item.y + 3, item.width - 14, 1, palette.frameBright);
      drawPixelRect(ctx, item.x + 10, item.y + 11, item.width - 20, 1, palette.frameAccent);
      drawPixelRect(ctx, item.x + 17, item.y + 20, 16, 1, palette.frameBright);
      drawPixelRect(ctx, item.x + item.width - 33, item.y + 20, 16, 1, palette.frameBright);
      drawPixelRect(ctx, item.x + 9, item.y + 8, 2, 2, "#ffe7a3");
      drawPixelRect(ctx, item.x + item.width - 11, item.y + 8, 2, 2, "#ffe7a3");
      drawPixelRect(ctx, item.x + 28, item.y + 17, 2, 2, "#ffe7a3");
      drawPixelRect(ctx, item.x + item.width - 30, item.y + 17, 2, 2, "#ffe7a3");
    }
    if (industrial) {
      drawPixelRect(ctx, item.x + 8, item.y + 9, item.width - 16, 2, palette.frameBright);
      drawPixelRect(ctx, item.x + 12, item.y + 20, item.width - 24, 2, palette.frameDark);
    }
    if (modernMinimal) {
      const legColor = palette.handle ?? "#2e3335";
      const accentColor = palette.bolt ?? "#d8b46a";
      drawPixelRect(ctx, item.x + 5, item.y + 2, item.width - 10, 2, palette.frameBright);
      drawPixelRect(ctx, item.x + 8, item.y + 8, item.width - 16, 1, palette.frameAccent);
      drawPixelRect(ctx, item.x + 10, item.y + 21, item.width - 20, 2, palette.frameLight);
      drawPixelRect(ctx, item.x + 1, item.y + 100, 3, 7, legColor);
      drawPixelRect(ctx, item.x + item.width - 4, item.y + 100, 3, 7, legColor);
      drawPixelRect(ctx, item.x + 1, item.y + 106, 3, 2, accentColor);
      drawPixelRect(ctx, item.x + item.width - 4, item.y + 106, 3, 2, accentColor);
      drawPixelRect(ctx, item.x + 11, item.y + 18, 2, 2, accentColor);
      drawPixelRect(ctx, item.x + item.width - 13, item.y + 18, 2, 2, accentColor);
    }

    drawPixelRect(ctx, item.x + 8, item.y + 16, 28, 16, palette.pillow);
    drawPixelRect(ctx, item.x + 10, item.y + 14, 24, 4, palette.pillowLight);
    drawPixelRect(ctx, item.x + 13, item.y + 19, 18, 8, industrial ? palette.sheet : "#f7cf9d");
    drawPixelRect(ctx, item.x + 32, item.y + 20, 4, 7, palette.pillowShade);
    drawPixelRect(ctx, item.x + item.width - 36, item.y + 16, 28, 16, palette.pillow);
    drawPixelRect(ctx, item.x + item.width - 34, item.y + 14, 24, 4, palette.pillowLight);
    drawPixelRect(ctx, item.x + item.width - 31, item.y + 19, 18, 8, industrial ? palette.sheet : "#f7cf9d");
    drawPixelRect(ctx, item.x + item.width - 12, item.y + 20, 4, 7, palette.pillowShade);

    if (modernMinimal) {
      drawPixelRect(ctx, item.x + 2, item.y + 31, 3, item.height - 36, palette.frameAccent);
      drawPixelRect(ctx, item.x + item.width - 5, item.y + 31, 3, item.height - 36, palette.frameAccent);
      drawPixelRect(ctx, item.x + 5, item.y + 25, item.width - 10, 14, palette.sheet);
      drawPixelRect(ctx, item.x + 8, item.y + 28, item.width - 16, 3, palette.sheetLight);
      drawPixelRect(ctx, item.x, item.y + 31, item.width, 8, palette.sheet);
      drawPixelRect(ctx, item.x + 4, item.y + 32, item.width - 8, 2, palette.sheetLight);
      drawPixelRect(ctx, item.x, item.y + 36, item.width, 55, palette.blanket);
      drawPixelRect(ctx, item.x + 5, item.y + 37, item.width - 10, 3, palette.blanketLight);
      drawPixelRect(ctx, item.x + 5, item.y + 40, item.width - 10, 7, palette.blanketLight);
      drawPixelRect(ctx, item.x + 5, item.y + 47, item.width - 10, 8, palette.blanketMid);
      drawPixelRect(ctx, item.x + 3, item.y + 55, item.width - 6, 33, palette.blanket);
      drawPixelRect(ctx, item.x + 2, item.y + 88, item.width - 4, 10, palette.sheet);
      drawPixelRect(ctx, item.x + 6, item.y + 89, item.width - 12, 1, palette.sheetLight);
      drawPixelRect(ctx, item.x + 2, item.y + 88, item.width - 4, 2, palette.blanketDark);
      drawPixelRect(ctx, item.x, item.y + 90, 2, 8, palette.blanket);
      drawPixelRect(ctx, item.x + item.width - 2, item.y + 90, 2, 8, palette.blanket);
      drawPixelRect(ctx, item.x - 1, item.y + 98, item.width + 2, 2, palette.frame);
      drawPixelRect(ctx, item.x + 3, item.y + 99, item.width - 6, 1, palette.frameLight);
    } else {
      drawPixelRect(ctx, item.x + 2, item.y + 25, item.width - 4, 15, palette.sheet);
      drawPixelRect(ctx, item.x + 6, item.y + 28, item.width - 12, 4, palette.sheetLight);
      drawPixelRect(ctx, item.x + 2, item.y + 36, item.width - 4, item.height - 50, palette.blanket);
      drawPixelRect(ctx, item.x + 5, item.y + 37, item.width - 10, 3, palette.blanketLight);
      drawPixelRect(ctx, item.x + 5, item.y + 40, item.width - 10, 7, palette.blanketLight);
      drawPixelRect(ctx, item.x + 5, item.y + 47, item.width - 10, 8, palette.blanketMid);
      drawPixelRect(ctx, item.x + 5, item.y + 55, item.width - 10, 9, palette.blanket);
      drawPixelRect(ctx, item.x + 5, item.y + 64, item.width - 10, 8, palette.blanketLow);
      drawPixelRect(ctx, item.x + 5, item.y + 52, item.width - 10, industrial ? 1 : 3, palette.blanketDark);
      drawPixelRect(ctx, item.x + 5, item.y + 69, item.width - 10, industrial ? 1 : 3, palette.blanketDark);
    }
    drawPixelRect(ctx, item.x + 13, item.y + 45, 3, 3, palette.blanketSpark);
    drawPixelRect(ctx, item.x + 39, item.y + 58, 2, 2, industrial ? palette.frameBright : "#fff4b8");
    drawPixelRect(ctx, item.x + item.width - 20, item.y + 48, 3, 3, palette.blanketSpark);
    drawPixelRect(ctx, item.x + item.width - 39, item.y + 66, 2, 2, industrial ? palette.frameBright : "#fff4b8");
    if (pinkPlaid) {
      drawPixelRect(ctx, item.x + 11, item.y + 37, 1, 35, palette.blanketLight);
      drawPixelRect(ctx, item.x + 22, item.y + 37, 2, 35, palette.blanketDark);
      drawPixelRect(ctx, item.x + 35, item.y + 37, 1, 35, palette.blanketLight);
      drawPixelRect(ctx, item.x + item.width - 34, item.y + 37, 2, 35, palette.blanketDark);
      drawPixelRect(ctx, item.x + item.width - 18, item.y + 37, 1, 35, palette.blanketLight);
      drawPixelRect(ctx, item.x + 5, item.y + 42, item.width - 10, 1, palette.blanketLight);
      drawPixelRect(ctx, item.x + 5, item.y + 49, item.width - 10, 2, palette.blanketDark);
      drawPixelRect(ctx, item.x + 5, item.y + 57, item.width - 10, 1, palette.blanketLight);
      drawPixelRect(ctx, item.x + 5, item.y + 64, item.width - 10, 2, palette.blanketDark);
      drawPixelRect(ctx, item.x + 5, item.y + 70, item.width - 10, 1, palette.blanketLight);
    }
    if (modernMinimal) {
      drawPixelRect(ctx, item.x + 9, item.y + 42, item.width - 18, 2, palette.sheetLight);
      drawPixelRect(ctx, item.x + 9, item.y + 50, item.width - 18, 1, palette.blanketDark);
      drawPixelRect(ctx, item.x + 16, item.y + 57, 9, 2, palette.blanketSpark);
      drawPixelRect(ctx, item.x + 27, item.y + 57, 19, 2, palette.sheetLight);
      drawPixelRect(ctx, item.x + item.width - 28, item.y + 64, 10, 2, palette.blanketSpark);
    }

    if (!modernMinimal) {
      drawBedFootboard(ctx, item, "none");
    }

    const plushX = item.x + item.width - 20;
    const plushY = item.y + 31;
    drawPixelRect(ctx, plushX - 6, plushY - 5, 12, 10, "#c48650");
    drawPixelRect(ctx, plushX - 8, plushY - 8, 5, 5, "#c48650");
    drawPixelRect(ctx, plushX + 3, plushY - 8, 5, 5, "#c48650");
    drawPixelRect(ctx, plushX - 3, plushY - 1, 2, 2, "#241c35");
    drawPixelRect(ctx, plushX + 3, plushY - 1, 2, 2, "#241c35");
    drawPixelRect(ctx, plushX - 1, plushY + 3, 4, 1, "#7b421d");

    if (highlight !== "none") {
      ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.round(item.x - 5),
        Math.round(item.y - 6),
        Math.round(item.width + 10),
        Math.round(item.height + 12),
      );
    }
    if (highlight === "selected") {
      drawFurnitureCollisionRange(ctx, item);
    }
    return;
  }

  if (item.id === "desk") {
    const palette = deskPalette(item);
    const skinId = deskSkinId(item);
    const industrial = skinId === "industrial-desk-skin";
    const acrylic = skinId === "transparent-acrylic-desk-skin";
    const industrialFrame = industrial || acrylic;
    const rococo = skinId === "rococo-ivory-desk-skin";

    drawPixelRect(
      ctx,
      item.x + 6,
      item.y + 9,
      item.width,
      item.height + 19,
      industrialFrame
        ? "rgba(16, 18, 23, 0.9)"
        : "rgba(21, 19, 33, 0.9)",
    );

    drawPixelRect(ctx, item.x - 5, item.y - 3, item.width + 10, 39, palette.topDark);
    drawPixelRect(ctx, item.x - 2, item.y - 7, item.width + 4, 34, palette.topMid);
    drawPixelRect(ctx, item.x + 2, item.y - 4, item.width - 4, 28, palette.top);
    drawPixelRect(ctx, item.x + 3, item.y - 4, item.width - 9, 4, palette.topLight);
    drawPixelRect(
      ctx,
      item.x + item.width - 6,
      item.y - 5,
      4,
      29,
      acrylic ? "rgba(230, 252, 255, 0.72)" : industrial ? "#6c3e2a" : rococo ? "#fff4d8" : "#c06f4d",
    );
    drawPixelRect(ctx, item.x - 2, item.y + 23, item.width + 4, 3, palette.topEdge);
    if (industrial) {
      drawPixelRect(ctx, item.x + 9, item.y + 2, item.width - 22, 2, "#6f432b");
      drawPixelRect(ctx, item.x + 13, item.y + 4, item.width - 32, 1, "#9a6545");
      drawPixelRect(ctx, item.x + 18, item.y + 7, 28, 1, "#b07954");
      drawPixelRect(ctx, item.x + 54, item.y + 8, 18, 1, "#8b573b");
      drawPixelRect(ctx, item.x + 14, item.y + 10, item.width - 34, 2, "#351d13");
      drawPixelRect(ctx, item.x + 18, item.y + 13, item.width - 42, 1, "#5d3321");
      drawPixelRect(ctx, item.x + 8, item.y + 16, item.width - 24, 1, "#2a1710");
      drawPixelRect(ctx, item.x + 5, item.y + 18, item.width - 18, 1, "#7c4a31");
      drawPixelRect(ctx, item.x + 28, item.y + 20, 20, 1, "#a66c4a");
      drawPixelRect(ctx, item.x + item.width - 43, item.y + 20, 17, 1, "#8b573b");
    } else if (acrylic) {
      drawPixelRect(ctx, item.x + 7, item.y - 1, item.width - 16, 2, "rgba(255, 255, 255, 0.72)");
      drawPixelRect(ctx, item.x + 9, item.y + 3, item.width - 24, 1, "rgba(142, 231, 255, 0.68)");
      drawPixelRect(ctx, item.x + 14, item.y + 7, 28, 1, "rgba(255, 255, 255, 0.58)");
      drawPixelRect(ctx, item.x + 49, item.y + 8, 22, 1, "rgba(90, 204, 232, 0.5)");
      drawPixelRect(ctx, item.x + 18, item.y + 11, 10, 1, "rgba(255, 255, 255, 0.78)");
      drawPixelRect(ctx, item.x + 32, item.y + 12, 4, 1, "rgba(142, 231, 255, 0.82)");
      drawPixelRect(ctx, item.x + item.width - 34, item.y + 13, 15, 1, "rgba(255, 255, 255, 0.56)");
      drawPixelRect(ctx, item.x + 13, item.y + 17, item.width - 30, 1, "rgba(71, 185, 215, 0.52)");
      drawPixelRect(ctx, item.x + 24, item.y + 20, 5, 2, "rgba(230, 252, 255, 0.76)");
      drawPixelRect(ctx, item.x + item.width - 30, item.y + 20, 5, 2, "rgba(230, 252, 255, 0.76)");
    } else if (rococo) {
      drawPixelRect(ctx, item.x + 6, item.y - 1, item.width - 14, 2, "#fffbea");
      drawPixelRect(ctx, item.x + 11, item.y + 3, item.width - 24, 1, "#f4d98a");
      drawPixelRect(ctx, item.x + 17, item.y + 8, item.width - 36, 1, "#cdb58a");
      drawPixelRect(ctx, item.x + 8, item.y + 16, item.width - 20, 1, "#fff4d8");
      drawPixelRect(ctx, item.x + 20, item.y + 18, 8, 2, "#f4d98a");
      drawPixelRect(ctx, item.x + item.width - 29, item.y + 18, 8, 2, "#f4d98a");
      drawPixelRect(ctx, item.x + Math.round(item.width / 2) - 2, item.y + 11, 4, 2, "#ffe8a4");
      drawPixelRect(ctx, item.x + Math.round(item.width / 2) - 5, item.y + 13, 10, 1, "#a88442");
    }

    if (industrial) {
      drawPixelRect(ctx, item.x + 8, item.y + 1, item.width - 16, 1, "#7b4a31");
      drawPixelRect(ctx, item.x + 6, item.y - 2, item.width - 18, 1, "#a66c4a");
      drawPixelRect(ctx, item.x + 12, item.y + 5, 18, 1, "#6f432b");
      drawPixelRect(ctx, item.x + 36, item.y + 6, 23, 1, "#3b2116");
      drawPixelRect(ctx, item.x + item.width - 34, item.y + 5, 14, 1, "#75472f");
      drawPixelRect(ctx, item.x + 10, item.y + 11, 25, 1, "#3a2015");
      drawPixelRect(ctx, item.x + 44, item.y + 12, 17, 1, "#6a402a");
      drawPixelRect(ctx, item.x + item.width - 28, item.y + 13, 12, 1, "#4b2a1c");
      drawPixelRect(ctx, item.x + 20, item.y + 18, 16, 1, "#75472f");
      drawPixelRect(ctx, item.x + 52, item.y + 18, 22, 1, "#3b2116");
      drawPixelRect(ctx, item.x + 37, item.y + 13, 3, 2, "#3a2015");
      drawPixelRect(ctx, item.x + 38, item.y + 14, 1, 1, "#6f432b");
    } else if (acrylic) {
      drawPixelRect(ctx, item.x + 8, item.y + 1, item.width - 16, 1, "rgba(255, 255, 255, 0.62)");
      drawPixelRect(ctx, item.x + 6, item.y - 2, item.width - 18, 1, "rgba(179, 237, 250, 0.66)");
      drawPixelRect(ctx, item.x + 12, item.y + 5, 17, 1, "rgba(94, 202, 228, 0.48)");
      drawPixelRect(ctx, item.x + 35, item.y + 6, 24, 1, "rgba(255, 255, 255, 0.44)");
      drawPixelRect(ctx, item.x + item.width - 34, item.y + 5, 14, 1, "rgba(97, 214, 240, 0.48)");
      drawPixelRect(ctx, item.x + 10, item.y + 11, 25, 1, "rgba(255, 255, 255, 0.5)");
      drawPixelRect(ctx, item.x + 44, item.y + 12, 17, 1, "rgba(75, 186, 215, 0.44)");
      drawPixelRect(ctx, item.x + item.width - 28, item.y + 13, 12, 1, "rgba(255, 255, 255, 0.48)");
      drawPixelRect(ctx, item.x + 21, item.y + 18, 15, 1, "rgba(96, 210, 238, 0.56)");
      drawPixelRect(ctx, item.x + 51, item.y + 18, 22, 1, "rgba(255, 255, 255, 0.42)");
      drawPixelRect(ctx, item.x + 38, item.y + 9, 1, 6, "rgba(214, 249, 255, 0.54)");
      drawPixelRect(ctx, item.x + 39, item.y + 14, 6, 1, "rgba(214, 249, 255, 0.54)");
    } else if (rococo) {
      drawPixelRect(ctx, item.x + 12, item.y + 1, item.width - 24, 21, palette.padDark);
      drawPixelRect(ctx, item.x + 15, item.y + 3, item.width - 30, 17, palette.padLight);
      drawPixelRect(ctx, item.x + 21, item.y + 6, item.width - 42, 10, palette.pad);
      drawPixelRect(ctx, item.x + 24, item.y + 8, item.width - 48, 1, "#fffbea");
      drawPixelRect(ctx, item.x + 28, item.y + 14, item.width - 56, 1, "#d8c59b");
      drawPixelRect(ctx, item.x + item.width / 2 - 7, item.y + 7, 14, 2, "#f4d98a");
      drawPixelRect(ctx, item.x + item.width / 2 - 4, item.y + 10, 8, 1, "#a88442");
    } else {
      drawPixelRect(ctx, item.x + 12, item.y + 1, item.width - 24, 21, palette.padDark);
      drawPixelRect(ctx, item.x + 14, item.y + 3, item.width - 28, 17, palette.padLight);
      drawPixelRect(ctx, item.x + 19, item.y + 6, item.width - 38, 11, palette.pad);
      drawPixelRect(ctx, item.x + item.width - 20, item.y + 8, 4, 9, "#1b1e20");
    }

    const drawerTop = item.y + 32;
    const leftX = item.x - 2;
    const stackWidth = 30;
    const rightX = item.x + item.width - stackWidth + 2;
    const drawerHeight = 10;
    const drawerGap = 11;
    const drawDrawer = (x: number, y: number, width: number, height: number) => {
      drawPixelRect(ctx, x, y, width, height, palette.metal);
      drawPixelRect(ctx, x + 3, y + 3, width - 6, height - 5, industrial ? palette.metalMid : palette.top);
      drawPixelRect(ctx, x + 5, y + 5, width - 10, 2, industrial ? palette.metalLight : palette.metalLight);
      drawPixelRect(ctx, x + width / 2 - 5, y + 8, 10, 3, palette.handle);
      drawPixelRect(ctx, x + width / 2 - 3, y + 6, 6, 3, palette.handleLight);
    };

    if (industrialFrame) {
      const drawIndustrialLeg = (
        x: number,
        y: number,
        height: number,
        front = false,
      ) => {
        drawPixelRect(ctx, x, y, 8, height, palette.metalDark);
        drawPixelRect(ctx, x + 1, y + 1, 6, height - 3, front ? (acrylic ? "#24313a" : "#20262d") : "#171c22");
        drawPixelRect(ctx, x + 2, y + 2, 4, height - 5, front ? (acrylic ? "#3d4d58" : "#333b45") : "#252c34");
        drawPixelRect(ctx, x + 2, y + 4, 1, height - 10, front ? (acrylic ? "#b7d8e3" : "#747f8b") : "#4c5660");
        if (front) {
          drawPixelRect(ctx, x + 4, y + 7, 1, Math.max(4, height - 16), acrylic ? "#5d7c89" : "#3f4852");
        }
        drawPixelRect(ctx, x + 6, y + 2, 1, height - 5, front ? "#171c22" : "#0b0d10");
        drawPixelRect(ctx, x - 1, y + height - 3, 10, 3, palette.metalDark);
        drawPixelRect(ctx, x + 1, y + height - 4, 6, 1, palette.metalLight);
        drawPixelRect(ctx, x, y + height - 2, 3, 1, front ? (acrylic ? "#9fe6f6" : "#5d6873") : "#4c5660");
        drawPixelRect(ctx, x + 5, y + height - 2, 3, 1, front ? "#333b45" : "#252c34");
      };

      drawIndustrialLeg(leftX + 3, drawerTop - 1, 12);
      drawIndustrialLeg(rightX + stackWidth - 9, drawerTop - 1, 12);
      drawIndustrialLeg(leftX - 1, drawerTop - 2, 38, true);
      drawIndustrialLeg(rightX + stackWidth - 7, drawerTop - 2, 38, true);

      const frontFootY = drawerTop - 2 + 38 - 3;
      drawPixelRect(ctx, item.x + 6, drawerTop + 5, item.width - 12, frontFootY - drawerTop - 2, "rgba(8, 10, 13, 0.34)");
      drawPixelRect(ctx, item.x + 10, frontFootY - 2, item.width - 20, 3, "rgba(15, 18, 22, 0.38)");
      drawPixelRect(ctx, leftX, drawerTop + 6, 4, frontFootY - drawerTop - 3, "rgba(8, 10, 13, 0.46)");
      drawPixelRect(ctx, rightX + stackWidth - 1, drawerTop + 6, 4, frontFootY - drawerTop - 3, "rgba(8, 10, 13, 0.46)");
      drawPixelRect(ctx, leftX + 1, drawerTop - 1, 1, 34, acrylic ? "#b7d8e3" : "#747f8b");
      drawPixelRect(ctx, leftX + 2, drawerTop + 3, 1, 25, acrylic ? "#5d7c89" : "#3f4852");
      drawPixelRect(ctx, rightX + stackWidth - 5, drawerTop - 1, 1, 34, acrylic ? "#b7d8e3" : "#747f8b");
      drawPixelRect(ctx, rightX + stackWidth - 4, drawerTop + 3, 1, 25, acrylic ? "#5d7c89" : "#3f4852");
      const eyeY = drawerTop + 15;
      const eyeX = Math.round(item.x + item.width / 2 - 3);
      const catX = eyeX - 7;
      const catY = eyeY - 10;
      drawPixelRect(ctx, catX + 3, catY + 2, 2, 3, "rgba(4, 5, 8, 0.9)");
      drawPixelRect(ctx, catX + 4, catY + 4, 3, 3, "rgba(4, 5, 8, 0.9)");
      drawPixelRect(ctx, catX + 15, catY + 2, 2, 3, "rgba(4, 5, 8, 0.9)");
      drawPixelRect(ctx, catX + 13, catY + 4, 3, 3, "rgba(4, 5, 8, 0.9)");
      drawPixelRect(ctx, catX + 3, catY + 7, 14, 10, "rgba(4, 5, 8, 0.9)");
      drawPixelRect(ctx, catX + 1, catY + 10, 18, 7, "rgba(4, 5, 8, 0.88)");
      drawPixelRect(ctx, catX + 4, catY + 16, 14, 4, "rgba(4, 5, 8, 0.88)");
      drawPixelRect(ctx, catX + 2, catY + 18, 20, 10, "rgba(4, 5, 8, 0.86)");
      drawPixelRect(ctx, catX, catY + 23, 22, 8, "rgba(4, 5, 8, 0.84)");
      drawPixelRect(ctx, catX + 3, catY + 29, 18, 4, "rgba(4, 5, 8, 0.86)");
      drawPixelRect(ctx, catX + 5, catY + 30, 5, 5, "rgba(4, 5, 8, 0.88)");
      drawPixelRect(ctx, catX + 12, catY + 30, 5, 5, "rgba(4, 5, 8, 0.88)");
      const eyeCycle = (frame + item.x * 3 + item.y * 5) % 1200;
      const eyesOpen = eyeCycle > 98 && eyeCycle < 164;
      const drawShadowEye = (x: number) => {
        drawPixelRect(ctx, x - 1, eyeY - 1, 4, 4, "#080a0d");
        drawPixelRect(ctx, x - 1, eyeY, 3, 1, "#8f611c");
        drawPixelRect(ctx, x, eyeY, 1, 1, "#ffe66d");
        drawPixelRect(ctx, x, eyeY + 1, 1, 1, "#ffe66d");
      };
      if (eyesOpen) {
        drawShadowEye(eyeX);
        drawShadowEye(eyeX + 7);
      }

      drawPixelRect(ctx, item.x - 2, drawerTop - 5, item.width + 4, 9, palette.topEdge);
      drawPixelRect(ctx, item.x + 2, drawerTop - 4, item.width - 4, 3, acrylic ? "rgba(224, 250, 255, 0.54)" : "#2f1a12");
      drawPixelRect(ctx, item.x + 6, drawerTop - 1, item.width - 13, 1, acrylic ? "rgba(255, 255, 255, 0.68)" : "#6c3e2a");
      drawPixelRect(ctx, item.x + 1, drawerTop - 4, 3, 7, palette.topLight);
      drawPixelRect(ctx, item.x + 4, drawerTop - 4, 9, 1, acrylic ? "rgba(130, 224, 245, 0.72)" : "#8a5638");
      drawPixelRect(ctx, item.x + item.width - 5, drawerTop - 4, 3, 7, acrylic ? "rgba(105, 177, 204, 0.5)" : "#6c3e2a");
      drawPixelRect(ctx, item.x + item.width - 14, drawerTop - 4, 9, 1, acrylic ? "rgba(130, 224, 245, 0.72)" : "#8a5638");
    } else if (rococo) {
      const drawRococoDrawer = (x: number, y: number, width: number, height: number) => {
        drawPixelRect(ctx, x - 1, y - 1, width + 2, height + 2, palette.metalDark);
        drawPixelRect(ctx, x, y, width, height, palette.metal);
        drawPixelRect(ctx, x + 3, y + 2, width - 6, height - 4, palette.metalMid);
        drawPixelRect(ctx, x + 5, y + 4, width - 10, 1, palette.metalLight);
        drawPixelRect(ctx, x + width / 2 - 4, y + 6, 8, 2, palette.handle);
        drawPixelRect(ctx, x + width / 2 - 2, y + 5, 4, 2, palette.handleLight);
      };
      drawPixelRect(ctx, leftX - 3, drawerTop - 3, stackWidth + 6, 36, palette.topDark);
      drawPixelRect(ctx, rightX - 3, drawerTop - 3, stackWidth + 6, 36, palette.topDark);
      drawRococoDrawer(leftX, drawerTop, stackWidth, drawerHeight);
      drawRococoDrawer(leftX, drawerTop + drawerGap, stackWidth, drawerHeight);
      drawRococoDrawer(leftX, drawerTop + drawerGap * 2, stackWidth, drawerHeight);
      drawRococoDrawer(rightX, drawerTop, stackWidth, drawerHeight);
      drawRococoDrawer(rightX, drawerTop + drawerGap, stackWidth, drawerHeight);
      drawRococoDrawer(rightX, drawerTop + drawerGap * 2, stackWidth, drawerHeight);

      const centerX = item.x + 30;
      const centerWidth = item.width - 60;
      drawPixelRect(ctx, centerX, drawerTop, centerWidth, 15, palette.topDark);
      drawPixelRect(ctx, centerX + 3, drawerTop + 2, centerWidth - 6, 10, palette.metalMid);
      drawPixelRect(ctx, centerX + 7, drawerTop + 5, centerWidth - 14, 1, palette.metalLight);
      drawPixelRect(ctx, item.x + item.width / 2 - 5, drawerTop + 8, 10, 3, palette.handle);
      drawPixelRect(ctx, item.x + item.width / 2 - 3, drawerTop + 6, 6, 3, palette.handleLight);

      const drawRococoLeg = (x: number, y: number, mirror = false) => {
        const curl = mirror ? -1 : 1;
        drawPixelRect(ctx, x, y, 6, 34, palette.topDark);
        drawPixelRect(ctx, x + 1, y + 1, 4, 30, palette.top);
        drawPixelRect(ctx, x + 2, y + 4, 2, 18, palette.topLight);
        drawPixelRect(ctx, x + curl * 2, y + 20, 6, 3, palette.topMid);
        drawPixelRect(ctx, x + curl * 4, y + 23, 5, 3, palette.top);
        drawPixelRect(ctx, x + curl * 5, y + 27, 4, 3, palette.handleLight);
        drawPixelRect(ctx, x - 1, y + 32, 9, 3, palette.handle);
      };
      drawRococoLeg(leftX + 2, drawerTop + 1);
      drawRococoLeg(leftX + stackWidth - 8, drawerTop + 1, true);
      drawRococoLeg(rightX + 2, drawerTop + 1);
      drawRococoLeg(rightX + stackWidth - 8, drawerTop + 1, true);
      drawPixelRect(ctx, leftX + 5, drawerTop + 31, 10, 1, palette.handleLight);
      drawPixelRect(ctx, leftX + stackWidth - 15, drawerTop + 31, 10, 1, palette.handleLight);
      drawPixelRect(ctx, rightX + 5, drawerTop + 31, 10, 1, palette.handleLight);
      drawPixelRect(ctx, rightX + stackWidth - 15, drawerTop + 31, 10, 1, palette.handleLight);
    } else {
      drawPixelRect(ctx, leftX - 2, drawerTop - 2, stackWidth + 4, 35, palette.metalDark);
      drawPixelRect(ctx, rightX - 2, drawerTop - 2, stackWidth + 4, 35, palette.metalDark);
      drawDrawer(leftX, drawerTop, stackWidth, drawerHeight);
      drawDrawer(leftX, drawerTop + drawerGap, stackWidth, drawerHeight);
      drawDrawer(leftX, drawerTop + drawerGap * 2, stackWidth, drawerHeight);
      drawDrawer(rightX, drawerTop, stackWidth, drawerHeight);
      drawDrawer(rightX, drawerTop + drawerGap, stackWidth, drawerHeight);
      drawDrawer(rightX, drawerTop + drawerGap * 2, stackWidth, drawerHeight);

      const shadowBlobX = Math.round(item.x + item.width / 2 - 12);
      const shadowBlobY = drawerTop + 16;
      drawPixelRect(ctx, shadowBlobX + 6, shadowBlobY, 12, 1, "rgba(5, 7, 10, 0.62)");
      drawPixelRect(ctx, shadowBlobX + 3, shadowBlobY + 1, 18, 2, "rgba(5, 7, 10, 0.74)");
      drawPixelRect(ctx, shadowBlobX + 1, shadowBlobY + 3, 22, 3, "rgba(5, 7, 10, 0.8)");
      drawPixelRect(ctx, shadowBlobX, shadowBlobY + 6, 24, 3, "rgba(5, 7, 10, 0.82)");
      drawPixelRect(ctx, shadowBlobX + 1, shadowBlobY + 9, 22, 2, "rgba(5, 7, 10, 0.78)");
      drawPixelRect(ctx, shadowBlobX + 4, shadowBlobY + 11, 16, 2, "rgba(5, 7, 10, 0.72)");
      drawPixelRect(ctx, shadowBlobX + 7, shadowBlobY + 13, 10, 1, "rgba(5, 7, 10, 0.56)");
      const classicEyeCycle = (frame + item.x * 5 + item.y * 7) % 1200;
      const classicEyesOpen = classicEyeCycle > 98 && classicEyeCycle < 164;
      const classicEyeY = shadowBlobY + 6;
      const drawClassicShadowEye = (x: number) => {
        drawPixelRect(ctx, x - 1, classicEyeY - 1, 4, 4, "#080a0d");
        drawPixelRect(ctx, x - 1, classicEyeY, 3, 1, "#8f611c");
        drawPixelRect(ctx, x, classicEyeY, 1, 1, "#ffe66d");
        drawPixelRect(ctx, x, classicEyeY + 1, 1, 1, "#ffe66d");
      };
      if (classicEyesOpen) {
        drawClassicShadowEye(shadowBlobX + 8);
        drawClassicShadowEye(shadowBlobX + 15);
      }

      const centerX = item.x + 29;
      const centerWidth = item.width - 58;
      drawPixelRect(ctx, centerX, drawerTop, centerWidth, 15, palette.metalDark);
      drawPixelRect(ctx, centerX + 4, drawerTop + 3, centerWidth - 8, 8, palette.top);
      drawPixelRect(ctx, centerX + 8, drawerTop + 6, centerWidth - 16, 3, "#6f351d");
      drawPixelRect(ctx, item.x + item.width / 2 - 5, drawerTop + 8, 10, 3, palette.handle);
      drawPixelRect(ctx, item.x + item.width / 2 - 3, drawerTop + 6, 6, 3, palette.handleLight);

      drawPixelRect(ctx, leftX + 2, drawerTop + 35, 5, 4, palette.topDark);
      drawPixelRect(ctx, leftX + stackWidth - 7, drawerTop + 35, 5, 4, palette.topDark);
      drawPixelRect(ctx, rightX + 2, drawerTop + 35, 5, 4, palette.topDark);
      drawPixelRect(ctx, rightX + stackWidth - 7, drawerTop + 35, 5, 4, palette.topDark);
    }

    if (highlight !== "none") {
      ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.round(item.x - 7),
        Math.round(item.y - 9),
        Math.round(item.width + 14),
        Math.round(item.height + 42),
      );
    }
    if (highlight === "selected") {
      drawFurnitureCollisionRange(ctx, item);
    }
    return;
  }

  if (item.id === "computer") {
    const active =
      (avatar?.behavior === "coding" || avatar?.behavior === "thinking") &&
      Math.hypot(avatar.x - (item.x + item.width / 2), avatar.y - (item.y + item.height + 18)) <
        90;
    const blink = Math.floor(frame / 8) % 3;

    drawPixelRect(ctx, item.x + 2, item.y + 2, 31, 24, "#e4dfc4");
    drawPixelRect(ctx, item.x + 4, item.y + 4, 27, 20, "#b8ad93");
    drawPixelRect(ctx, item.x + 6, item.y + 6, 23, 16, "#d8d0b5");
    drawPixelRect(ctx, item.x + 7, item.y + 7, 21, 14, "#3349ff");
    drawPixelRect(ctx, item.x + 7, item.y + 7, 21, 2, active ? "#9ee6ff" : "#78a7ff");
    drawPixelRect(ctx, item.x + 9, item.y + 12, 8, 2, "#9ee6ff");
    drawPixelRect(ctx, item.x + 20, item.y + 12, 7, 2, "#9ee6ff");
    drawPixelRect(ctx, item.x + 9, item.y + 17, 7, 2, "#9ee6ff");
    drawPixelRect(ctx, item.x + 20, item.y + 17, 7, 2, "#9ee6ff");
    if (active) {
      drawPixelRect(ctx, item.x + 9 + blink * 3, item.y + 15, 8, 1, "#eaffd0");
      drawPixelRect(ctx, item.x + 19, item.y + 19 - blink, 8, 1, "#eaffd0");
    }
    drawPixelRect(ctx, item.x + 12, item.y + 25, 11, 3, "#8f8270");
    drawPixelRect(ctx, item.x + 8, item.y + 28, 19, 3, "#e4dfc4");

    drawPixelRect(ctx, item.x + 4, item.y + 32, 28, 8, "#d2c8ad");
    drawPixelRect(ctx, item.x + 7, item.y + 35, 10, 2, "#f2eed8");
    drawPixelRect(ctx, item.x + 20, item.y + 34, 3, 2, "#b8ad93");
    drawPixelRect(ctx, item.x + 25, item.y + 34, 3, 2, "#b8ad93");
    drawPixelRect(ctx, item.x + 20, item.y + 38, 10, 1, "#24462d");
    drawPixelRect(ctx, item.x + 27, item.y + 38, 2, 1, active ? "#ff3b30" : "#5b2b26");

    drawPixelRect(ctx, item.x - 2, item.y + 42, 38, 8, "#8f8270");
    drawPixelRect(ctx, item.x, item.y + 40, 34, 7, "#d2c8ad");
    drawPixelRect(ctx, item.x + 1, item.y + 41, 32, 2, "#f2eed8");
    drawPixelRect(ctx, item.x + 2, item.y + 47, 30, 2, "#756957");
    for (let keyX = item.x + 3; keyX < item.x + 29; keyX += 4) {
      drawPixelRect(ctx, keyX, item.y + 42, 2, 2, "#f2eed8");
      drawPixelRect(ctx, keyX + 1, item.y + 44, 2, 2, "#8f8270");
    }
    if (active) {
      drawPixelRect(ctx, item.x + 4 + blink * 7, item.y + 42, 3, 2, "#ffe66d");
      drawPixelRect(ctx, item.x + 24 - blink * 5, item.y + 44, 3, 2, "#78a7ff");
    }

    if (highlight !== "none") {
      ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(item.x), Math.round(item.y), 36, 53);
    }
    if (highlight === "selected") {
      drawFurnitureCollisionRange(ctx, item);
    }
    return;
  }

  if (item.id === "table") {
    const rococo = tableSkinId(item) === "rococo-ivory-table-skin";
    const darkOak = tableSkinId(item) === "dark-oak-table-skin";
    const whiteTech = tableSkinId(item) === "white-tech-table-skin";

    drawPixelRect(ctx, item.x + 5, item.y + 10, item.width, 50, "rgba(21, 19, 33, 0.9)");

    if (rococo) {
      drawPixelRect(ctx, item.x - 3, item.y - 3, item.width + 6, 33, "#aa9777");
      drawPixelRect(ctx, item.x, item.y - 1, item.width, 29, "#d7c39e");
      drawPixelRect(ctx, item.x + 2, item.y + 1, item.width - 4, 24, "#eadbbd");
      drawPixelRect(ctx, item.x + 5, item.y + 3, item.width - 12, 3, "#fff4d8");
      drawPixelRect(ctx, item.x + 10, item.y + 8, item.width - 24, 1, "#f4d98a");
      drawPixelRect(ctx, item.x + 15, item.y + 15, item.width - 34, 1, "#cdb58a");
      drawPixelRect(ctx, item.x + item.width / 2 - 8, item.y + 10, 16, 2, "#ffe8a4");
      drawPixelRect(ctx, item.x + item.width / 2 - 4, item.y + 13, 8, 1, "#a88442");
      const drawIrisMotif = (x: number, y: number, mirrorX = false, mirrorY = false) => {
        const sx = mirrorX ? -1 : 1;
        const sy = mirrorY ? -1 : 1;
        drawPixelRect(ctx, x, y, 2, 2, "#f4d98a");
        drawPixelRect(ctx, x - sx * 2, y - sy * 1, 2, 1, "#7b63b8");
        drawPixelRect(ctx, x + sx * 2, y - sy * 1, 2, 1, "#7b63b8");
        drawPixelRect(ctx, x - sx * 1, y - sy * 3, 3, 2, "#9b7ee0");
        drawPixelRect(ctx, x - sx * 1, y + sy * 2, 3, 1, "#6f559d");
        drawPixelRect(ctx, x - sx * 3, y + sy * 1, 1, 2, "#5f8f62");
        drawPixelRect(ctx, x + sx * 3, y + sy * 1, 1, 2, "#5f8f62");
      };
      drawIrisMotif(item.x + 15, item.y + 9);
      drawIrisMotif(item.x + item.width - 15, item.y + 9, true);
      drawIrisMotif(item.x + 15, item.y + 20, false, true);
      drawIrisMotif(item.x + item.width - 15, item.y + 20, true, true);
      drawPixelRect(ctx, item.x + 4, item.y + 24, item.width - 8, 4, "#8f7a58");
      drawPixelRect(ctx, item.x + 7, item.y + 24, item.width - 15, 1, "#fffbea");

      drawPixelRect(ctx, item.x - 1, item.y + 29, item.width + 2, 5, "#9a835c");
      drawPixelRect(ctx, item.x + 3, item.y + 30, item.width - 6, 2, "#d8c59b");
      drawPixelRect(ctx, item.x + 14, item.y + 32, item.width - 28, 1, "#ffe8a4");

      const drawRococoTableLeg = (x: number, y: number, mirror = false) => {
        const curl = mirror ? -1 : 1;
        drawPixelRect(ctx, x, y, 6, 27, "#9a835c");
        drawPixelRect(ctx, x + 1, y + 1, 4, 24, "#eadbbd");
        drawPixelRect(ctx, x + 2, y + 3, 2, 17, "#fff4d8");
        drawPixelRect(ctx, x + curl * 2, y + 17, 6, 3, "#d7c39e");
        drawPixelRect(ctx, x + curl * 4, y + 20, 5, 3, "#eadbbd");
        drawPixelRect(ctx, x + curl * 5, y + 23, 4, 3, "#ffe8a4");
        drawPixelRect(ctx, x - 1, y + 26, 9, 3, "#a88442");
      };

      drawRococoTableLeg(item.x + 8, item.y + 34);
      drawRococoTableLeg(item.x + item.width - 14, item.y + 34, true);
      drawPixelRect(ctx, item.x + 6, item.y + 59, 9, 3, "#7f673f");
      drawPixelRect(ctx, item.x + item.width - 15, item.y + 59, 9, 3, "#7f673f");

      if (highlight !== "none") {
        ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          Math.round(item.x - 4),
          Math.round(item.y - 5),
          Math.round(item.width + 8),
          68,
        );
      }
      if (highlight === "selected") {
        drawFurnitureCollisionRange(ctx, item);
      }
      return;
    }

    if (darkOak) {
      drawPixelRect(ctx, item.x - 3, item.y - 3, item.width + 6, 33, "#2a1710");
      drawPixelRect(ctx, item.x, item.y - 1, item.width, 29, "#4a2618");
      drawPixelRect(ctx, item.x + 2, item.y + 1, item.width - 4, 24, "#5d3321");
      drawPixelRect(ctx, item.x + 4, item.y + 3, item.width - 10, 3, "#815136");
      drawPixelRect(ctx, item.x + 9, item.y + 8, item.width - 20, 1, "#a66c4a");
      drawPixelRect(ctx, item.x + 15, item.y + 13, item.width - 32, 1, "#3a2015");
      drawPixelRect(ctx, item.x + 8, item.y + 19, item.width - 21, 2, "#75472f");
      drawPixelRect(ctx, item.x + 22, item.y + 6, 18, 1, "#b07954");
      drawPixelRect(ctx, item.x + item.width - 42, item.y + 16, 21, 1, "#8b573b");
      drawPixelRect(ctx, item.x + 5, item.y + 24, item.width - 10, 4, "#351d13");
      drawPixelRect(ctx, item.x + 8, item.y + 24, item.width - 18, 1, "#7c4a31");

      drawPixelRect(ctx, item.x - 1, item.y + 29, item.width + 2, 5, "#24140e");
      drawPixelRect(ctx, item.x + 2, item.y + 30, item.width - 4, 2, "#6f432b");
      drawPixelRect(ctx, item.x + 12, item.y + 32, item.width - 24, 1, "#a66c4a");

      const drawOakLeg = (x: number, y: number) => {
        drawPixelRect(ctx, x, y, 8, 27, "#24140e");
        drawPixelRect(ctx, x + 1, y + 1, 6, 24, "#4a2618");
        drawPixelRect(ctx, x + 2, y + 2, 3, 21, "#6f432b");
        drawPixelRect(ctx, x + 4, y + 4, 2, 17, "#815136");
        drawPixelRect(ctx, x - 1, y + 25, 10, 4, "#1b0f0a");
        drawPixelRect(ctx, x + 1, y + 26, 6, 1, "#8b573b");
      };

      drawOakLeg(item.x + 8, item.y + 34);
      drawOakLeg(item.x + item.width - 16, item.y + 34);
      drawPixelRect(ctx, item.x + 6, item.y + 59, 9, 3, "#1b0f0a");
      drawPixelRect(ctx, item.x + item.width - 15, item.y + 59, 9, 3, "#1b0f0a");

      if (highlight !== "none") {
        ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          Math.round(item.x - 4),
          Math.round(item.y - 5),
          Math.round(item.width + 8),
          68,
        );
      }
      if (highlight === "selected") {
        drawFurnitureCollisionRange(ctx, item);
      }
      return;
    }

    if (whiteTech) {
      drawPixelRect(ctx, item.x - 3, item.y - 3, item.width + 6, 33, "#8fa0aa");
      drawPixelRect(ctx, item.x, item.y - 1, item.width, 29, "#dfe8ed");
      drawPixelRect(ctx, item.x + 2, item.y + 1, item.width - 4, 24, "#f6fbfd");
      drawPixelRect(ctx, item.x + 5, item.y + 3, item.width - 12, 3, "#ffffff");
      drawPixelRect(ctx, item.x + 6, item.y + 24, item.width - 12, 4, "#aab9c2");
      drawPixelRect(ctx, item.x + 8, item.y + 25, item.width - 18, 1, "#f9feff");
      drawPixelRect(ctx, item.x + 10, item.y + 9, item.width - 24, 1, "#88dfff");
      drawPixelRect(ctx, item.x + 10, item.y + 9, 1, 9, "#88dfff");
      drawPixelRect(ctx, item.x + 12, item.y + 11, 16, 1, "#c7f3ff");
      drawPixelRect(ctx, item.x + 28, item.y + 11, 1, 5, "#88dfff");
      drawPixelRect(ctx, item.x + 30, item.y + 16, 18, 1, "#88dfff");
      drawPixelRect(ctx, item.x + item.width - 35, item.y + 8, 24, 1, "#bdf1ff");
      drawPixelRect(ctx, item.x + item.width - 12, item.y + 8, 1, 8, "#88dfff");
      drawPixelRect(ctx, item.x + item.width - 28, item.y + 16, 17, 1, "#88dfff");
      drawPixelRect(ctx, item.x + 17, item.y + 18, 4, 4, "#bdf1ff");
      drawPixelRect(ctx, item.x + 18, item.y + 19, 2, 2, "#ffffff");
      drawPixelRect(ctx, item.x + item.width - 23, item.y + 18, 4, 4, "#bdf1ff");
      drawPixelRect(ctx, item.x + item.width - 22, item.y + 19, 2, 2, "#ffffff");
      drawPixelRect(ctx, item.x + item.width / 2 - 8, item.y + 13, 16, 2, "#d5f7ff");
      drawPixelRect(ctx, item.x + item.width / 2 - 5, item.y + 16, 10, 1, "#88dfff");

      drawPixelRect(ctx, item.x - 1, item.y + 29, item.width + 2, 5, "#7d8e9a");
      drawPixelRect(ctx, item.x + 3, item.y + 30, item.width - 6, 2, "#d7e2e8");
      drawPixelRect(ctx, item.x + 14, item.y + 32, item.width - 28, 1, "#f9feff");

      const drawTechLeg = (x: number, y: number) => {
        drawPixelRect(ctx, x, y, 7, 27, "#202832");
        drawPixelRect(ctx, x + 1, y + 1, 5, 24, "#3d4a55");
        drawPixelRect(ctx, x + 2, y + 2, 2, 20, "#9fb0b9");
        drawPixelRect(ctx, x + 4, y + 5, 1, 14, "#88dfff");
        drawPixelRect(ctx, x - 1, y + 25, 9, 4, "#151b23");
        drawPixelRect(ctx, x + 1, y + 26, 5, 1, "#7d8e9a");
      };

      drawTechLeg(item.x + 8, item.y + 34);
      drawTechLeg(item.x + item.width - 15, item.y + 34);
      drawPixelRect(ctx, item.x + 6, item.y + 59, 9, 3, "#151b23");
      drawPixelRect(ctx, item.x + item.width - 15, item.y + 59, 9, 3, "#151b23");

      if (highlight !== "none") {
        ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          Math.round(item.x - 4),
          Math.round(item.y - 5),
          Math.round(item.width + 8),
          68,
        );
      }
      if (highlight === "selected") {
        drawFurnitureCollisionRange(ctx, item);
      }
      return;
    }

    drawPixelRect(ctx, item.x - 2, item.y - 2, item.width + 4, 32, "#2c3030");
    drawPixelRect(ctx, item.x, item.y, item.width, 28, "#747a78");
    const metalRows = [
      "#d7ddd9",
      "#c2cbc7",
      "#aeb8b4",
      "#8f9a97",
      "#717d7a",
      "#525e5d",
    ];
    metalRows.forEach((color, index) => {
      drawPixelRect(ctx, item.x + 2, item.y + 2 + index * 4, item.width - 4, 4, color);
    });
    drawPixelRect(ctx, item.x + 5, item.y + 4, item.width - 14, 2, "#f3f7f2");
    drawPixelRect(ctx, item.x + 12, item.y + 10, item.width - 30, 1, "#dfe5e1");
    drawPixelRect(ctx, item.x + item.width - 36, item.y + 14, 20, 2, "#ccd5d1");
    drawPixelRect(ctx, item.x + 8, item.y + 19, item.width - 22, 2, "#5f6968");
    drawPixelRect(ctx, item.x + 2, item.y + 25, item.width - 4, 3, "#464b49");

    drawPixelRect(ctx, item.x + 16, item.y + 9, 4, 3, "#d8dfdc");
    drawPixelRect(ctx, item.x + 38, item.y + 13, 3, 2, "#d8dfdc");
    drawPixelRect(ctx, item.x + item.width - 18, item.y + 8, 5, 3, "#646c6d");
    drawPixelRect(ctx, item.x - 1, item.y + 29, item.width + 2, 5, "#313635");
    drawPixelRect(ctx, item.x + 1, item.y + 30, item.width - 2, 2, "#737a76");
    drawPixelRect(ctx, item.x + 8, item.y + 34, 5, 25, "#3b4244");
    drawPixelRect(ctx, item.x + 10, item.y + 34, 2, 25, "#9aa2a1");
    drawPixelRect(ctx, item.x + item.width - 13, item.y + 34, 5, 25, "#3b4244");
    drawPixelRect(ctx, item.x + item.width - 11, item.y + 34, 2, 25, "#9aa2a1");
    drawPixelRect(ctx, item.x + 6, item.y + 59, 9, 3, "#252b2d");
    drawPixelRect(ctx, item.x + item.width - 15, item.y + 59, 9, 3, "#252b2d");

    if (highlight !== "none") {
      ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.round(item.x - 4),
        Math.round(item.y - 5),
        Math.round(item.width + 8),
        68,
      );
    }
    if (highlight === "selected") {
      drawFurnitureCollisionRange(ctx, item);
    }
    return;
  }

  if (item.id === "fridge") {
    const skinId = fridgeSkinId(item);
    const redRetro = skinId === "red-retro-fridge-skin";
    const whiteTech = skinId === "white-tech-fridge-skin";
    const fridgePalette =
      skinId === "ivory-fridge-skin"
        ? {
            outline: "#9f8b67",
            body: "#eadbbd",
            panel: "#f1e4c9",
            inset: "#dfcfad",
            seam: "#9f8b67",
            seamLight: "#fff4d8",
            handle: "#b99a5f",
            handleLight: "#ffe8a4",
            sideShade: "#cdb58a",
            foot: "#9f8b67",
          }
        : whiteTech
          ? {
              outline: "#aebdc8",
              body: "#f7fbff",
              panel: "#e7f0f5",
              inset: "#d4e4ec",
              seam: "#7f96a5",
              seamLight: "#bff2ff",
              handle: "#dff7ff",
              handleLight: "#ffffff",
              sideShade: "#bdcbd4",
              foot: "#7f96a5",
            }
        : redRetro
          ? {
              outline: "#4a1119",
              body: "#c81724",
              panel: "#e1262f",
              inset: "#bd1420",
              seam: "#4a1119",
              seamLight: "#ffd7bd",
              handle: "#c8d0d8",
              handleLight: "#f7fbff",
              sideShade: "#8d111b",
              foot: "#2d1720",
            }
          : {
              outline: "#2d241f",
              body: "#6f9560",
              panel: "#789e68",
              inset: "#719962",
              seam: "#2d241f",
              seamLight: "#9ab580",
              handle: "#d2d3c0",
              handleLight: "#eef0dc",
              sideShade: "#5f8455",
              foot: "#2d241f",
            };
    const fridgeDoorOpenMs = 650;
    const fridgeDoorHoldMs = 2950;
    const fridgeDoorCloseMs = 900;
    const fridgeDoorTotalMs =
      fridgeDoorOpenMs + fridgeDoorHoldMs + fridgeDoorCloseMs;
    const active =
      activeInteraction?.kind === "feed" &&
      activeInteraction.furnitureId === item.id &&
      performance.now() - activeInteraction.startedAt < fridgeDoorTotalMs;
    const age = activeInteraction ? performance.now() - activeInteraction.startedAt : 0;
    const doorOpen = active
      ? age < fridgeDoorOpenMs
        ? Math.sin((age / fridgeDoorOpenMs) * Math.PI * 0.5)
        : age < fridgeDoorOpenMs + fridgeDoorHoldMs
          ? 1
          : Math.cos(
              Math.min(
                1,
                (age - fridgeDoorOpenMs - fridgeDoorHoldMs) / fridgeDoorCloseMs,
              ) *
                Math.PI *
                0.5,
            )
      : 0;
    const openWidth = Math.round(22 * doorOpen);
    const fridgeSplitY = item.y + Math.round(item.height * 0.4);
    const upperDoor = {
      x: item.x + 3,
      y: item.y + 3,
      width: item.width - 7,
      height: fridgeSplitY - item.y - 5,
    };

    drawPixelRect(ctx, item.x + 4, item.y + item.height + 1, item.width - 8, 5, "#151321");
    drawPixelRect(ctx, item.x + 9, item.y + item.height + 4, item.width - 18, 3, "#0f1422");

    if (redRetro) {
      drawPixelRect(ctx, item.x + 5, item.y - 30, item.width - 10, 4, "#2d241f");
      drawPixelRect(ctx, item.x + 1, item.y - 27, item.width - 2, 5, "#2d241f");
      drawPixelRect(ctx, item.x - 2, item.y - 23, item.width + 4, 15, "#2d241f");
      drawPixelRect(ctx, item.x + 1, item.y - 8, item.width - 2, 10, "#3b1723");
      drawPixelRect(ctx, item.x + 6, item.y - 27, item.width - 12, 4, "#6d2637");
      drawPixelRect(ctx, item.x + 2, item.y - 24, item.width - 4, 8, "#6d2637");
      drawPixelRect(ctx, item.x, item.y - 18, item.width, 10, "#6d2637");
      drawPixelRect(ctx, item.x + 2, item.y - 24, item.width - 4, 5, "#8d3447");
      drawPixelRect(ctx, item.x + 4, item.y - 20, item.width - 8, 4, "#b84d63");
      drawPixelRect(ctx, item.x + 3, item.y - 5, item.width - 6, 4, "#7a2c3e");
    } else if (whiteTech) {
      drawPixelRect(ctx, item.x - 4, item.y - 30, item.width + 8, 32, "#8ea2af");
      drawPixelRect(ctx, item.x - 3, item.y - 27, item.width + 6, 25, "#e9f3f8");
      drawPixelRect(ctx, item.x - 2, item.y - 24, item.width + 4, 10, "#f7fbff");
      drawPixelRect(ctx, item.x, item.y - 20, item.width, 5, "#ffffff");
      drawPixelRect(ctx, item.x - 4, item.y - 8, item.width + 8, 10, "#aebdc8");
      drawPixelRect(ctx, item.x, item.y - 5, item.width - 2, 4, "#d4e4ec");
    } else {
      drawPixelRect(ctx, item.x - 4, item.y - 30, item.width + 8, 32, "#2d241f");
      drawPixelRect(ctx, item.x - 3, item.y - 27, item.width + 6, 25, "#6d2637");
      drawPixelRect(ctx, item.x - 2, item.y - 24, item.width + 4, 10, "#8d3447");
      drawPixelRect(ctx, item.x, item.y - 20, item.width, 5, "#b84d63");
      drawPixelRect(ctx, item.x - 4, item.y - 8, item.width + 8, 10, "#3b1723");
      drawPixelRect(ctx, item.x, item.y - 5, item.width - 2, 4, "#7a2c3e");
    }
    if (whiteTech) {
      drawPixelRect(ctx, item.x + 1, item.y - 26, 15, 18, "#6f8797");
      drawPixelRect(ctx, item.x + 4, item.y - 23, 10, 12, "#dff7ff");
      drawPixelRect(ctx, item.x + 5, item.y - 20, 7, 1, "#7fe6ff");
      drawPixelRect(ctx, item.x + 5, item.y - 16, 7, 1, "#ffffff");
      drawPixelRect(ctx, item.x + 25, item.y - 25, 16, 20, "#eef7fb");
      drawPixelRect(ctx, item.x + 28, item.y - 21, 10, 2, "#7fe6ff");
      drawPixelRect(ctx, item.x + 30, item.y - 14, 2, 6, "#8ea2af");
      drawPixelRect(ctx, item.x + 36, item.y - 14, 2, 6, "#8ea2af");
      drawPixelRect(ctx, item.x + item.width - 12, item.y - 28, 10, 15, "#6f8797");
      drawPixelRect(ctx, item.x + item.width - 10, item.y - 25, 7, 4, "#dff7ff");
      drawPixelRect(ctx, item.x + item.width - 12, item.y - 15, 9, 12, "#d4e4ec");
      drawPixelRect(ctx, item.x + item.width - 13, item.y - 8, 13, 22, "#f7fbff");
      drawPixelRect(ctx, item.x + item.width - 10, item.y - 3, 7, 2, "#7fe6ff");
      drawPixelRect(ctx, item.x + item.width - 8, item.y + 3, 3, 3, "#ffffff");
    } else {
      drawPixelRect(ctx, item.x + 1, item.y - 26, 14, 18, "#2b1f28");
      drawPixelRect(ctx, item.x + 4, item.y - 22, 9, 10, "#c1b8a2");
      drawPixelRect(ctx, item.x + 5, item.y - 19, 6, 5, "#6d6f70");
      drawPixelRect(ctx, item.x + 25, item.y - 25, 16, 20, "#f1e4ad");
      drawPixelRect(ctx, item.x + 29, item.y - 15, 3, 9, "#4f7796");
      drawPixelRect(ctx, item.x + 37, item.y - 15, 3, 9, "#4f7796");
      drawPixelRect(ctx, item.x + item.width - 11, item.y - 28, 9, 14, "#2b1f28");
      drawPixelRect(ctx, item.x + item.width - 9, item.y - 25, 7, 5, "#a55b63");
      drawPixelRect(ctx, item.x + item.width - 12, item.y - 15, 9, 12, "#263a25");
      drawPixelRect(ctx, item.x + item.width - 13, item.y - 8, 13, 22, "#536b38");
      drawPixelRect(ctx, item.x + item.width - 9, item.y + 1, 6, 6, "#f0c178");
    }

    if (redRetro) {
      drawPixelRect(ctx, item.x + 4, item.y - 2, item.width - 8, item.height + 5, fridgePalette.outline);
      drawPixelRect(ctx, item.x, item.y, item.width, item.height + 1, fridgePalette.outline);
      drawPixelRect(ctx, item.x - 2, item.y + 7, item.width + 4, item.height - 12, fridgePalette.outline);
      drawPixelRect(ctx, item.x + 4, item.y, item.width - 8, item.height + 1, fridgePalette.body);
      drawPixelRect(ctx, item.x + 1, item.y + 2, item.width - 2, item.height - 1, fridgePalette.body);
      drawPixelRect(ctx, item.x, item.y + 8, item.width, item.height - 12, fridgePalette.body);
      drawPixelRect(ctx, item.x + 5, item.y + 3, item.width - 10, item.height - 8, fridgePalette.panel);
      drawPixelRect(ctx, item.x + 3, item.y + 10, item.width - 6, item.height - 20, fridgePalette.panel);
      drawPixelRect(ctx, item.x + 8, item.y + 9, item.width - 18, item.height - 20, fridgePalette.inset);
    } else {
      drawPixelRect(ctx, item.x - 2, item.y - 2, item.width + 4, item.height + 5, fridgePalette.outline);
      drawPixelRect(ctx, item.x, item.y, item.width, item.height, fridgePalette.body);
      drawPixelRect(ctx, item.x + 3, item.y + 3, item.width - 7, item.height - 8, fridgePalette.panel);
      drawPixelRect(ctx, item.x + 7, item.y + 8, item.width - 16, item.height - 18, fridgePalette.inset);
    }
    if (redRetro) {
      drawPixelRect(ctx, item.x + 8, item.y + 4, item.width - 16, 2, "#ffd7bd");
      drawPixelRect(ctx, item.x + 5, item.y + 11, 4, item.height - 24, "#ff6f5f");
      drawPixelRect(ctx, item.x + 10, item.y + item.height - 10, item.width - 20, 2, "#89111b");
    } else if (whiteTech) {
      drawPixelRect(ctx, item.x + 5, item.y + 4, item.width - 12, 2, "#ffffff");
      drawPixelRect(ctx, item.x + 7, item.y + 10, item.width - 18, 1, "#bff2ff");
      drawPixelRect(ctx, item.x + 7, item.y + item.height - 12, item.width - 18, 1, "#bff2ff");
      drawPixelRect(ctx, item.x + item.width - 10, item.y + 10, 4, 12, "#314252");
      drawPixelRect(ctx, item.x + item.width - 9, item.y + 12, 2, 2, "#7fe6ff");
      drawPixelRect(ctx, item.x + item.width - 9, item.y + 17, 2, 1, "#ffffff");
      drawPixelRect(ctx, item.x + 9, item.y + 14, 2, 2, "#7fe6ff");
      drawPixelRect(ctx, item.x + 14, item.y + 14, 1, 8, "#aebdc8");
      drawPixelRect(ctx, item.x + 18, item.y + 23, 10, 1, "#dff7ff");
      drawPixelRect(ctx, item.x + 7, item.y + item.height - 8, 4, 2, "#ffffff");
      drawPixelRect(ctx, item.x + item.width - 16, item.y + item.height - 8, 4, 2, "#ffffff");
    }
    drawPixelRect(
      ctx,
      item.x + (redRetro ? 5 : 3),
      fridgeSplitY - 2,
      item.width - (redRetro ? 10 : 7),
      4,
      fridgePalette.seam,
    );
    drawPixelRect(
      ctx,
      item.x + (redRetro ? 6 : 3),
      fridgeSplitY + 1,
      item.width - (redRetro ? 12 : 7),
      3,
      fridgePalette.seamLight,
    );
    const handleX = item.x + 7;
    const handleWidth = 16;
    const handleHeight = 4;
    drawPixelRect(ctx, handleX, fridgeSplitY - 12, handleWidth, handleHeight, fridgePalette.handle);
    drawPixelRect(ctx, handleX, fridgeSplitY + 8, handleWidth, handleHeight, fridgePalette.handle);
    drawPixelRect(ctx, handleX + 2, fridgeSplitY - 11, handleWidth - 4, 1, fridgePalette.handleLight);
    drawPixelRect(ctx, handleX + 2, fridgeSplitY + 9, handleWidth - 4, 1, fridgePalette.handleLight);
    drawPixelRect(
      ctx,
      item.x + item.width - 5,
      item.y + (redRetro ? 9 : 5),
      2,
      item.height - (redRetro ? 20 : 12),
      fridgePalette.sideShade,
    );
    drawPixelRect(ctx, item.x + 5, item.y + item.height + 1, 8, 4, fridgePalette.foot);
    drawPixelRect(ctx, item.x + item.width - 13, item.y + item.height + 1, 8, 4, fridgePalette.foot);

    if (openWidth > 0) {
      drawPixelRect(ctx, upperDoor.x, upperDoor.y, upperDoor.width, upperDoor.height, "#c9f4ff");
      drawPixelRect(ctx, upperDoor.x + 2, upperDoor.y + 4, upperDoor.width - 5, 4, "#eefcff");
      drawPixelRect(ctx, upperDoor.x + 2, upperDoor.y + upperDoor.height - 10, upperDoor.width - 5, 3, "#eefcff");
      drawPixelRect(ctx, upperDoor.x + 6, upperDoor.y + 12, 6, 6, "#f0c178");
      drawPixelRect(ctx, upperDoor.x + upperDoor.width - 10, upperDoor.y + upperDoor.height - 12, 5, 6, "#b64c54");
      const hingeX = upperDoor.x + upperDoor.width;
      const doorWidth = Math.max(8, upperDoor.width - openWidth);
      const doorX = hingeX - doorWidth + Math.round(openWidth * 0.55);
      drawPixelRect(ctx, doorX, upperDoor.y, doorWidth, upperDoor.height, fridgePalette.outline);
      drawPixelRect(ctx, doorX + 2, upperDoor.y + 2, Math.max(2, doorWidth - 4), upperDoor.height - 4, fridgePalette.inset);
      drawPixelRect(ctx, doorX + 4, upperDoor.y + 6, Math.max(2, doorWidth - 8), 7, fridgePalette.panel);
      if (redRetro) {
        drawPixelRect(ctx, doorX + 4, upperDoor.y + 4, Math.max(2, doorWidth - 8), 1, "#ffd7bd");
      } else if (whiteTech) {
        drawPixelRect(ctx, doorX + 4, upperDoor.y + 4, Math.max(2, doorWidth - 8), 1, "#ffffff");
        drawPixelRect(ctx, doorX + Math.max(3, doorWidth - 7), upperDoor.y + 7, 2, 7, "#7fe6ff");
      }
      drawPixelRect(ctx, doorX + 3, upperDoor.y + 17, 3, 10, fridgePalette.handle);
      drawPixelRect(ctx, doorX + 4, upperDoor.y + 18, 1, 8, fridgePalette.handleLight);
    }

    if (highlight !== "none") {
      ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.round(item.x - 8),
        Math.round(item.y - 31),
        Math.round(item.width + 16),
        Math.round(item.height + 40),
      );
    }
    if (highlight === "selected") {
      drawFurnitureCollisionRange(ctx, item);
    }
    return;
  }

  drawPixelRect(ctx, item.x + 6, item.y + 8, item.width, item.height, "#151321");
  drawPixelRect(ctx, item.x - 2, item.y - 2, item.width + 4, item.height + 4, "#20192c");
  drawPixelRect(ctx, item.x, item.y, item.width, item.height, item.color);
  drawPixelRect(ctx, item.x + 3, item.y + 3, item.width - 8, 5, "#f4d78c");
  drawPixelRect(ctx, item.x + item.width - 7, item.y + 2, 5, item.height - 4, "#44324a");

  if (highlight !== "none") {
    ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.round(item.x - 3),
      Math.round(item.y - 3),
      Math.round(item.width + 12),
      Math.round(item.height + 14),
    );
  }

  if (highlight === "selected") {
    drawFurnitureCollisionRange(ctx, item);
  }
};

const drawCoffeeSipPose = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: AvatarRuntime["facing"],
  body: string,
  bodyLight: string,
  ink: string,
) => {
  if (facing === "back") return;

  const steamRise = Math.round(Math.sin(frame / 10) * 2);

  if (facing === "left" || facing === "right") {
    const sideDirection = facing === "left" ? -1 : 1;
    const cupX = x + sideDirection * 14;
    const cupY = y - 10;
    drawPixelRect(ctx, cupX - 5, cupY - 2, 10, 10, "#f4ead2");
    drawPixelRect(ctx, cupX - 3, cupY, 6, 2, "#6f3a20");
    drawPixelRect(ctx, cupX + sideDirection * 4, cupY + 1, 3, 5, "#f4ead2");
    drawPixelRect(ctx, x + sideDirection * 8, y - 8, 10, 5, body);
    drawPixelRect(ctx, x + sideDirection * 12, y - 7, 5, 3, bodyLight);
    drawPixelRect(ctx, cupX - 2, cupY - 8 - steamRise, 2, 4, "#d8f7ff");
    drawPixelRect(ctx, cupX + 3, cupY - 11 + steamRise, 2, 5, "#d8f7ff");
    return;
  }

  const cupX = x;
  const cupY = y - 10;
  drawPixelRect(ctx, x - 15, y - 9, 10, 6, body);
  drawPixelRect(ctx, x + 7, y - 9, 10, 6, body);
  drawPixelRect(ctx, x - 12, y - 7, 8, 3, bodyLight);
  drawPixelRect(ctx, x + 8, y - 7, 8, 3, bodyLight);
  drawPixelRect(ctx, cupX - 7, cupY - 2, 14, 11, "#f4ead2");
  drawPixelRect(ctx, cupX - 5, cupY, 10, 2, "#6f3a20");
  drawPixelRect(ctx, cupX - 8, cupY + 2, 3, 5, "#f4ead2");
  drawPixelRect(ctx, cupX + 6, cupY + 2, 3, 5, "#f4ead2");
  drawPixelRect(ctx, cupX - 5, cupY + 7, 10, 2, "#d7b98d");
  drawPixelRect(ctx, cupX - 4, cupY - 9 - steamRise, 2, 5, "#d8f7ff");
  drawPixelRect(ctx, cupX + 1, cupY - 12 + steamRise, 2, 6, "#d8f7ff");
  drawPixelRect(ctx, cupX + 5, cupY - 8 - steamRise, 2, 4, "#d8f7ff");
  drawPixelRect(ctx, x - 2, y - 12, 6, 2, ink);
};

const drawColaSipPose = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: AvatarRuntime["facing"],
  body: string,
  bodyLight: string,
  ink: string,
) => {
  if (facing === "back") return;

  const fizz = Math.round(Math.sin(frame / 6) * 1);
  const canRed = "#d9364a";
  const canDark = "#8f1f36";
  const canLight = "#ff8fa3";
  const straw = "#f4ead2";

  if (facing === "left" || facing === "right") {
    const sideDirection = facing === "left" ? -1 : 1;
    const canX = x + sideDirection * 14;
    const canY = y - 10;

    drawPixelRect(ctx, x + sideDirection * 8, y - 8, 10, 5, body);
    drawPixelRect(ctx, x + sideDirection * 12, y - 7, 5, 3, bodyLight);
    drawPixelRect(ctx, canX - 5, canY - 4, 10, 14, ink);
    drawPixelRect(ctx, canX - 4, canY - 5, 8, 14, canRed);
    drawPixelRect(ctx, canX - 3, canY - 3, 2, 10, canLight);
    drawPixelRect(ctx, canX + 2, canY - 3, 2, 10, canDark);
    drawPixelRect(ctx, canX - 3, canY, 6, 2, "#f4ead2");
    drawPixelRect(ctx, canX - sideDirection * 1, canY - 9, 2, 10, straw);
    drawPixelRect(ctx, x + sideDirection * 7, y - 13, 6, 2, straw);
    drawPixelRect(ctx, x + sideDirection * 9, y - 13, 3, 2, ink);
    drawPixelRect(ctx, canX + sideDirection * 7, canY - 10 + fizz, 2, 2, "#d8f7ff");
    drawPixelRect(ctx, canX + sideDirection * 10, canY - 15 - fizz, 2, 2, "#d8f7ff");
    return;
  }

  const canX = x + 1;
  const canY = y - 8;
  drawPixelRect(ctx, x - 15, y - 8, 11, 6, body);
  drawPixelRect(ctx, x + 8, y - 8, 11, 6, body);
  drawPixelRect(ctx, x - 12, y - 6, 8, 3, bodyLight);
  drawPixelRect(ctx, x + 8, y - 6, 8, 3, bodyLight);
  drawPixelRect(ctx, canX - 7, canY - 4, 14, 17, ink);
  drawPixelRect(ctx, canX - 6, canY - 5, 12, 17, canRed);
  drawPixelRect(ctx, canX - 5, canY - 3, 3, 13, canLight);
  drawPixelRect(ctx, canX + 3, canY - 3, 2, 13, canDark);
  drawPixelRect(ctx, canX - 4, canY + 1, 8, 3, "#f4ead2");
  drawPixelRect(ctx, canX - 3, canY + 7, 6, 2, "#ffe66d");
  drawPixelRect(ctx, canX - 1, canY - 9, 2, 10, straw);
  drawPixelRect(ctx, x - 1, y - 12, 7, 2, straw);
  drawPixelRect(ctx, x - 4, y - 11, 10, 3, canRed);
  drawPixelRect(ctx, canX - 13, canY - 10 + fizz, 2, 2, "#d8f7ff");
  drawPixelRect(ctx, canX + 12, canY - 13 - fizz, 2, 2, "#d8f7ff");
  drawPixelRect(ctx, canX + 9, canY - 18 + fizz, 2, 2, "#d8f7ff");
};

const drawBentoEatPose = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: AvatarRuntime["facing"],
  body: string,
  bodyLight: string,
  ink: string,
) => {
  if (facing === "back") return;

  const chew = Math.round(Math.sin(frame / 5));
  const box = "#f4ead2";
  const boxShade = "#d7b98d";
  const rice = "#fff8df";
  const salmon = "#ff8fa3";
  const greens = "#8df7c4";

  if (facing === "left" || facing === "right") {
    const sideDirection = facing === "left" ? -1 : 1;
    const boxX = x + sideDirection * 13;
    const boxY = y - 6;

    drawPixelRect(ctx, x + sideDirection * 8, y - 7, 10, 5, body);
    drawPixelRect(ctx, x + sideDirection * 12, y - 6, 5, 3, bodyLight);
    drawPixelRect(ctx, boxX - 8, boxY - 3, 16, 11, ink);
    drawPixelRect(ctx, boxX - 7, boxY - 4, 14, 10, box);
    drawPixelRect(ctx, boxX - 5, boxY - 2, 5, 4, rice);
    drawPixelRect(ctx, boxX + 1, boxY - 2, 4, 4, salmon);
    drawPixelRect(ctx, boxX - 4, boxY + 3, 10, 2, greens);
    drawPixelRect(ctx, boxX - 7, boxY + 6, 14, 2, boxShade);
    drawPixelRect(ctx, x + sideDirection * 8, y - 13 + chew, 4, 3, rice);
    drawPixelRect(ctx, x + sideDirection * 10, y - 12 + chew, 2, 2, salmon);
    drawPixelRect(ctx, x + sideDirection * 9, y - 14 + chew, 7, 1, "#6f3a20");
    return;
  }

  const boxX = x;
  const boxY = y - 4;
  drawPixelRect(ctx, x - 17, y - 6, 13, 6, body);
  drawPixelRect(ctx, x + 7, y - 6, 13, 6, body);
  drawPixelRect(ctx, x - 14, y - 4, 9, 3, bodyLight);
  drawPixelRect(ctx, x + 8, y - 4, 9, 3, bodyLight);
  drawPixelRect(ctx, boxX - 13, boxY - 5, 26, 13, ink);
  drawPixelRect(ctx, boxX - 12, boxY - 6, 24, 12, box);
  drawPixelRect(ctx, boxX - 10, boxY - 4, 8, 5, rice);
  drawPixelRect(ctx, boxX - 1, boxY - 4, 6, 5, salmon);
  drawPixelRect(ctx, boxX + 6, boxY - 4, 4, 5, greens);
  drawPixelRect(ctx, boxX - 10, boxY + 2, 9, 3, "#ffe66d");
  drawPixelRect(ctx, boxX, boxY + 2, 10, 3, greens);
  drawPixelRect(ctx, boxX - 12, boxY + 6, 24, 2, boxShade);
  drawPixelRect(ctx, x - 3, y - 13 + chew, 5, 3, rice);
  drawPixelRect(ctx, x + 1, y - 12 + chew, 3, 2, salmon);
  drawPixelRect(ctx, x - 4, y - 15 + chew, 11, 1, "#6f3a20");
  drawPixelRect(ctx, x - 4, y - 11, 10, 3, body);
};

const drawCookieEatPose = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: AvatarRuntime["facing"],
  body: string,
  bodyLight: string,
  ink: string,
) => {
  if (facing === "back") return;

  const chew = Math.round(Math.sin(frame / 4));
  const crumb = Math.round(Math.sin(frame / 5));
  const cookie = "#c48650";
  const cookieLight = "#f0c276";
  const cookieDark = "#8c4a16";
  const chip = "#5b2a10";

  if (facing === "left" || facing === "right") {
    const sideDirection = facing === "left" ? -1 : 1;
    const cookieX = x + sideDirection * 13;
    const cookieY = y - 9;

    drawPixelRect(ctx, x + sideDirection * 8, y - 7, 10, 5, body);
    drawPixelRect(ctx, x + sideDirection * 12, y - 6, 5, 3, bodyLight);
    drawPixelRect(ctx, cookieX - 3, cookieY - 2, 6, 7, ink);
    drawPixelRect(ctx, cookieX - 2, cookieY - 3, 5, 7, cookie);
    drawPixelRect(ctx, cookieX - 1, cookieY - 2, 2, 1, cookieLight);
    drawPixelRect(ctx, cookieX + sideDirection, cookieY - 3, 2, 2, "#21131b");
    drawPixelRect(ctx, cookieX - 1, cookieY + 1, 1, 1, chip);
    drawPixelRect(ctx, cookieX + 1, cookieY + 3, 1, 1, chip);
    drawPixelRect(ctx, x + sideDirection * 8, y - 14 + chew, 3, 2, cookie);
    drawPixelRect(ctx, x + sideDirection * 11, y - 13 + chew, 1, 1, chip);
    drawPixelRect(ctx, x + sideDirection * 16, y - 15 + crumb, 2, 2, cookieLight);
    return;
  }

  const cookieX = x;
  const cookieY = y - 8;
  drawPixelRect(ctx, x - 16, y - 7, 12, 6, body);
  drawPixelRect(ctx, x + 8, y - 7, 12, 6, body);
  drawPixelRect(ctx, x - 13, y - 5, 8, 3, bodyLight);
  drawPixelRect(ctx, x + 9, y - 5, 8, 3, bodyLight);
  drawPixelRect(ctx, cookieX - 5, cookieY - 3, 10, 8, ink);
  drawPixelRect(ctx, cookieX - 4, cookieY - 4, 9, 7, cookie);
  drawPixelRect(ctx, cookieX - 3, cookieY - 3, 4, 1, cookieLight);
  drawPixelRect(ctx, cookieX + 2, cookieY - 4, 3, 3, "#21131b");
  drawPixelRect(ctx, cookieX - 2, cookieY, 1, 1, chip);
  drawPixelRect(ctx, cookieX + 1, cookieY + 2, 1, 1, chip);
  drawPixelRect(ctx, cookieX + 3, cookieY + 1, 1, 1, cookieDark);
  drawPixelRect(ctx, x - 3, y - 14 + chew, 4, 2, cookie);
  drawPixelRect(ctx, x + 1, y - 13 + chew, 1, 1, chip);
  drawPixelRect(ctx, x + 8, y - 15 + crumb, 2, 2, cookieLight);
  drawPixelRect(ctx, x - 9, y - 13 - crumb, 2, 2, cookieDark);
  drawPixelRect(ctx, x - 4, y - 11, 10, 2, ink);
};

const drawPhonePose = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: AvatarRuntime["facing"],
  body: string,
  bodyLight: string,
  ink: string,
  screenGlow: string,
) => {
  if (facing === "back") return;

  const front = facing === "front";
  const sideDirection = facing === "left" ? -1 : 1;
  const phoneX = front ? x - 4 : x + sideDirection * 12;
  const phoneY = y - 12;
  const tap = Math.round(Math.sin(frame / 4) * 2);

  if (front) {
    drawPixelRect(ctx, phoneX - 1, phoneY, 9, 14, "#111624");
    drawPixelRect(ctx, phoneX, phoneY - 1, 8, 14, "#52607d");
    drawPixelRect(ctx, phoneX + 1, phoneY, 6, 11, "#6f7d96");
    drawPixelRect(ctx, phoneX + 2, phoneY + 1, 2, 2, "#202638");
    drawPixelRect(ctx, phoneX + 5, phoneY + 1, 1, 1, "#9ee6ff");
    drawPixelRect(ctx, phoneX + 3, phoneY + 7, 2, 2, "#d8fff7");
  } else {
    drawPixelRect(ctx, phoneX - 1, phoneY, 10, 14, ink);
    drawPixelRect(ctx, phoneX, phoneY - 1, 8, 14, "#171b26");
    drawPixelRect(ctx, phoneX + 1, phoneY + 1, 6, 10, screenGlow);
    drawPixelRect(ctx, phoneX + 3, phoneY + 12, 2, 1, "#d8fff7");
  }

  if (front) {
    drawPixelRect(ctx, x - 17, y - 8 + tap, 10, 5, body);
    drawPixelRect(ctx, x + 9, y - 8 - tap, 10, 5, body);
    drawPixelRect(ctx, x - 13, y - 6 + tap, 5, 2, bodyLight);
    drawPixelRect(ctx, x + 11, y - 6 - tap, 5, 2, bodyLight);
  } else {
    drawPixelRect(ctx, x + sideDirection * 7, y - 8 + tap, 11, 5, body);
    drawPixelRect(ctx, x + sideDirection * 11, y - 6 + tap, 5, 2, bodyLight);
    drawPixelRect(ctx, x - sideDirection * 16, y - 5 - tap, 8, 4, body);
  }

  if (!front && frame % 44 < 22) {
    drawPixelRect(ctx, phoneX + 3, phoneY + 4, 4, 1, "#f8f0c9");
    drawPixelRect(ctx, phoneX + 3, phoneY + 7, 3, 1, "#8df7c4");
  }
};

const drawTaskFilePose = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: AvatarRuntime["facing"],
  body: string,
  bodyLight: string,
  behavior: AvatarRuntime["behavior"],
) => {
  if (facing === "back") return;

  const sideDirection = facing === "left" ? -1 : 1;
  const bob = Math.round(Math.sin(frame / 5));
  const isReading = behavior === "read_task_file";
  const fileX =
    facing === "left" ? x - 31 : facing === "right" ? x + 18 : x - 7;
  const fileY = isReading ? y - 19 + bob : y - 13 + bob;
  const accent = behavior === "fetch_task_file" ? "#ffe66d" : "#9ee6ff";

  if (isReading) {
    drawPixelRect(ctx, x - 14, y - 18 + bob, 28, 17, "#27313d");
    drawTaskFileSheet(ctx, x - 12, y - 17 + bob, 11, 14, accent);
    drawTaskFileSheet(ctx, x + 1, y - 17 + bob, 11, 14, "#b4f56c");
    drawPixelRect(ctx, x - 18, y - 6 + bob, 10, 4, body);
    drawPixelRect(ctx, x + 9, y - 6 + bob, 10, 4, body);
    drawPixelRect(ctx, x - 16, y - 2 + bob, 6, 2, bodyLight);
    drawPixelRect(ctx, x + 11, y - 2 + bob, 6, 2, bodyLight);
    return;
  }

  drawTaskFileSheet(ctx, fileX, fileY, 12, 15, accent);
  if (facing === "left" || facing === "right") {
    drawPixelRect(ctx, x + sideDirection * 12, y - 8 + bob, 10, 4, body);
    drawPixelRect(ctx, x + sideDirection * 16, y - 4 + bob, 5, 2, bodyLight);
  } else {
    drawPixelRect(ctx, x - 17, y - 5 + bob, 10, 4, body);
    drawPixelRect(ctx, x + 10, y - 5 + bob, 10, 4, body);
    drawPixelRect(ctx, x - 14, y - 1 + bob, 5, 2, bodyLight);
    drawPixelRect(ctx, x + 13, y - 1 + bob, 5, 2, bodyLight);
  }
};

const drawAdmirePose = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: AvatarRuntime["facing"],
  body: string,
  bodyLight: string,
  ink: string,
  accent: string,
) => {
  if (facing === "back") return;

  const pulse = Math.round(Math.sin(frame / 5) * 2);
  const sparkle = Math.floor(frame / 10) % 3;
  const sideDirection = facing === "left" ? -1 : 1;
  const front = facing === "front";
  const gazeX = front ? x + 18 : x + sideDirection * 22;
  const gazeY = y - 29;

  if (front) {
    drawPixelRect(ctx, x - 20, y - 10 - pulse, 12, 5, body);
    drawPixelRect(ctx, x + 9, y - 10 + pulse, 12, 5, body);
    drawPixelRect(ctx, x - 17, y - 8 - pulse, 6, 2, bodyLight);
    drawPixelRect(ctx, x + 11, y - 8 + pulse, 6, 2, bodyLight);
  } else {
    drawPixelRect(ctx, x + sideDirection * 9, y - 11 - pulse, 13, 5, body);
    drawPixelRect(ctx, x + sideDirection * 13, y - 9 - pulse, 6, 2, bodyLight);
    drawPixelRect(ctx, x - sideDirection * 17, y - 4 + pulse, 9, 4, body);
  }

  drawPixelRect(ctx, gazeX - 1, gazeY - 1, 3, 3, accent);
  drawPixelRect(ctx, gazeX, gazeY - 4 - sparkle, 1, 2, "#fff7d8");
  drawPixelRect(ctx, gazeX, gazeY + 3 + sparkle, 1, 2, "#fff7d8");
  drawPixelRect(ctx, gazeX - 4 - sparkle, gazeY, 2, 1, "#fff7d8");
  drawPixelRect(ctx, gazeX + 3 + sparkle, gazeY, 2, 1, "#fff7d8");
  drawPixelRect(ctx, gazeX + sideDirection * 7, gazeY + 7, 2, 2, ink);
  drawPixelRect(ctx, gazeX + sideDirection * 10, gazeY + 5, 1, 1, accent);
};

const drawPaintPose = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: AvatarRuntime["facing"],
  body: string,
  bodyLight: string,
  ink: string,
) => {
  if (facing === "back") return;

  const bob = Math.round(Math.sin(frame / 5));
  const brushLift = Math.round(Math.sin(frame / 4) * 2);
  const front = facing === "front";
  const sideDirection = facing === "left" ? -1 : 1;
  const paletteX = front ? x - 18 : x - sideDirection * 16;
  const paletteY = y - 8 + bob;
  const brushX = front ? x + 18 : x + sideDirection * 18;
  const brushY = y - 17 + brushLift;

  drawPixelRect(ctx, x - 12, y - 39, 24, 5, "#111624");
  drawPixelRect(ctx, x - 10, y - 43, 19, 7, "#4b2f62");
  drawPixelRect(ctx, x - 15, y - 37, 29, 4, "#6d4385");
  drawPixelRect(ctx, x - 2, y - 44, 8, 2, "#a074b8");

  drawPixelRect(ctx, paletteX - 8, paletteY - 5, 16, 11, ink);
  drawPixelRect(ctx, paletteX - 7, paletteY - 6, 15, 10, "#f4ead2");
  drawPixelRect(ctx, paletteX - 2, paletteY - 3, 3, 3, "#5b2a10");
  drawPixelRect(ctx, paletteX - 6, paletteY - 2, 3, 3, "#ff5c7a");
  drawPixelRect(ctx, paletteX + 2, paletteY - 4, 3, 3, "#5ce1e6");
  drawPixelRect(ctx, paletteX + 4, paletteY, 3, 3, "#ffe66d");
  drawPixelRect(ctx, paletteX - 3, paletteY + 2, 3, 2, "#62c56f");

  if (front) {
    drawPixelRect(ctx, x - 20, y - 8 + bob, 13, 5, body);
    drawPixelRect(ctx, x - 17, y - 5 + bob, 7, 2, bodyLight);
    drawPixelRect(ctx, x + 8, y - 11 + brushLift, 13, 5, body);
    drawPixelRect(ctx, x + 11, y - 9 + brushLift, 7, 2, bodyLight);
  } else {
    drawPixelRect(ctx, x - sideDirection * 22, y - 8 + bob, 12, 5, body);
    drawPixelRect(ctx, x - sideDirection * 19, y - 5 + bob, 6, 2, bodyLight);
    drawPixelRect(ctx, x + sideDirection * 8, y - 12 + brushLift, 14, 5, body);
    drawPixelRect(ctx, x + sideDirection * 12, y - 10 + brushLift, 7, 2, bodyLight);
  }

  ctx.strokeStyle = "#5b2a10";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(brushX - sideDirection * 8, brushY + 8);
  ctx.lineTo(brushX + sideDirection * 7, brushY - 9);
  ctx.stroke();
  drawPixelRect(ctx, brushX + sideDirection * 7 - 2, brushY - 10, 5, 4, "#d95d75");
  drawPixelRect(ctx, brushX + sideDirection * 6 - 1, brushY - 12, 3, 2, "#ffe66d");
};

const drawCompleteYawnPose = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  facing: AvatarRuntime["facing"],
  body: string,
  bodyLight: string,
  ink: string,
) => {
  const yawnOpen = frame % 36 < 24;
  const lift = yawnOpen ? Math.round(Math.sin(frame / 4)) : 0;

  if (facing === "back") {
    drawPixelRect(ctx, x + 12, y - 29 + lift, 3, 3, "#f8f0c9");
    drawPixelRect(ctx, x + 17, y - 32 - lift, 2, 2, "#f8f0c9");
    return;
  }

  if (facing === "left" || facing === "right") {
    const sideDirection = facing === "left" ? -1 : 1;
    const eyeX = x + sideDirection * 5;
    const mouthX = x + sideDirection * 10;

    drawPixelRect(ctx, eyeX - 4, y - 19, 8, 2, ink);
    drawPixelRect(ctx, mouthX - 2, y - 14, 6, yawnOpen ? 8 : 4, ink);
    drawPixelRect(ctx, mouthX - 1, y - 13, 4, yawnOpen ? 6 : 2, "#51415f");
    drawPixelRect(ctx, mouthX, y - 13, 2, 2, "#f8f0c9");
    drawPixelRect(ctx, x - sideDirection * 13, y - 9 + lift, 9, 5, body);
    drawPixelRect(ctx, x - sideDirection * 13, y - 7 + lift, 5, 2, bodyLight);
    drawPixelRect(ctx, x + sideDirection * 18, y - 24 - lift, 3, 3, "#f8f0c9");
    drawPixelRect(ctx, x + sideDirection * 23, y - 28 + lift, 2, 2, "#f8f0c9");
    return;
  }

  drawPixelRect(ctx, x - 8, y - 19, 5, 2, ink);
  drawPixelRect(ctx, x + 5, y - 19, 5, 2, ink);
  drawPixelRect(ctx, x - 5, y - 14, 12, yawnOpen ? 9 : 5, ink);
  drawPixelRect(ctx, x - 3, y - 13, 8, yawnOpen ? 7 : 3, "#51415f");
  drawPixelRect(ctx, x - 1, y - 13, 4, 2, "#f8f0c9");
  drawPixelRect(ctx, x - 18, y - 8 + lift, 11, 5, body);
  drawPixelRect(ctx, x + 10, y - 8 - lift, 11, 5, body);
  drawPixelRect(ctx, x - 15, y - 6 + lift, 6, 2, bodyLight);
  drawPixelRect(ctx, x + 12, y - 6 - lift, 6, 2, bodyLight);
  drawPixelRect(ctx, x + 17, y - 28 + lift, 3, 3, "#f8f0c9");
  drawPixelRect(ctx, x + 22, y - 32 - lift, 2, 2, "#f8f0c9");
};

const drawAvatar = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  frame: number,
  stats: PetStats,
  status: CodexStatusMessage,
  memory?: AivatarMemory,
) => {
  const bob = avatar.behavior === "sleep" ? 1 : Math.sin(frame / 12) * 2;
  const wiggle = Math.round(Math.sin(frame / 8) * 2);
  const x = Math.round(avatar.x);
  const y = Math.round(avatar.y + bob);
  const minStat = Math.min(stats.energy, stats.mood, stats.hunger);
  const busy =
    status.status === "thinking" ||
    status.status === "executing" ||
    status.status === "waiting_for_user" ||
    status.status === "error";
  const depletion =
    busy && minStat <= 8
      ? "critical"
      : busy && minStat <= 20
        ? "low"
        : busy && minStat <= 35
          ? "tired"
          : "normal";
  const dominantTrait = dominantTraitFromMemory(memory);
  const moodBand = moodBandForStats(stats);
  const theme = traitVisualThemes[dominantTrait];
  const themedBody =
    moodBand === "depleted"
      ? theme.bodyDepleted
      : moodBand === "low"
        ? theme.bodyLow
        : theme.body;
  const themedBodyLight =
    moodBand === "depleted"
      ? theme.bodyLow
      : moodBand === "low"
        ? theme.body
        : moodBand === "high"
          ? theme.accent
          : theme.bodyLight;
  const body =
    depletion === "critical"
      ? "#171923"
      : depletion === "low"
        ? "#30354c"
        : depletion === "tired"
          ? "#5b668c"
          : avatar.behavior === "error"
            ? dominantTrait === "resilience"
              ? theme.bodyLow
              : "#d95d75"
            : themedBody;
  const bodyLight =
    depletion === "critical"
      ? "#32384d"
      : depletion === "low"
        ? "#4b5879"
        : depletion === "tired"
          ? "#7b8eb8"
          : avatar.behavior === "success"
            ? dominantTrait === "resilience"
              ? theme.accent
              : "#b4f56c"
            : themedBodyLight;
  const shadow = "#171322";
  const ink = theme.ink;
  const facing = avatar.facing;
  const sideDirection = facing === "left" ? -1 : 1;

  drawPixelRect(ctx, x - 15, y + 10, 33, 7, shadow);
  drawPixelRect(ctx, x - 16, y - 24, 34, 27, ink);
  drawPixelRect(ctx, x - 10, y - 36, 22, 5, body);
  drawPixelRect(ctx, x - 14, y - 32, 30, 9, body);
  drawPixelRect(ctx, x - 16, y - 25, 34, 17, body);
  drawPixelRect(ctx, x - 13, y - 9, 28, 10, body);
  drawPixelRect(
    ctx,
    facing === "left" ? x - 14 : x + 8,
    y - 23,
    6,
    17,
    bodyLight,
  );
  drawPixelRect(ctx, x - 11, y - 5, 6, 14 + wiggle, body);
  drawPixelRect(ctx, x - 3, y - 3, 6, 15 - wiggle, body);
  drawPixelRect(ctx, x + 6, y - 5, 6, 13 + wiggle, body);
  if (facing !== "back") {
    drawPixelRect(ctx, x - 17, y - 1, 6, 11 - wiggle, body);
    drawPixelRect(ctx, x + 14, y - 1, 6, 11 + wiggle, body);
  }
  drawPixelRect(ctx, x - 12, y + 8 + wiggle, 7, 4, ink);
  drawPixelRect(ctx, x - 2, y + 10 - wiggle, 7, 4, ink);
  drawPixelRect(ctx, x + 8, y + 8 + wiggle, 7, 4, ink);

  const focused = avatar.expression === "focused";
  const worried = avatar.expression === "worried";
  const sleepy = avatar.expression === "sleepy";
  const happy = avatar.expression === "happy";
  const completeYawn = avatar.behavior === "success";

  if (facing === "back") {
    drawPixelRect(ctx, x - 8, y - 29, 20, 4, bodyLight);
    drawPixelRect(ctx, x - 5, y - 21, 17, 3, theme.accent);
    drawPixelRect(ctx, x - 3, y - 16, 13, 2, theme.accent);
  } else if (facing === "left" || facing === "right") {
    const eyeX = x + sideDirection * 5;
    const browX = x + sideDirection * 3;

    if (sleepy || completeYawn) {
      drawPixelRect(ctx, eyeX - 3, y - 19, 7, 2, ink);
      if (!completeYawn) {
        ctx.fillStyle = "#f8f0c9";
        ctx.font = "10px monospace";
        ctx.fillText("Z", x + sideDirection * 17, y - 34);
      }
    } else {
      const eyeHeight =
        dominantTrait === "efficiency" ? 5 : dominantTrait === "curiosity" ? 7 : focused ? 5 : 6;
      drawPixelRect(ctx, eyeX - 3, y - 21, 7, eyeHeight, theme.eye);
      drawPixelRect(
        ctx,
        eyeX,
        y - (dominantTrait === "curiosity" ? 17 : 18),
        dominantTrait === "efficiency" ? 3 : 2,
        2,
        ink,
      );
      if (focused) {
        drawPixelRect(ctx, browX - 4, y - 24, 8, 2, ink);
      }
      if (dominantTrait === "resilience" && worried) {
        drawPixelRect(ctx, browX - 3, y - 24, 8, 2, theme.accent);
      }
    }

    drawPixelRect(ctx, x + sideDirection * 11, y - 15, 5, 5, body);
  } else if (sleepy || completeYawn) {
    drawPixelRect(ctx, x - 7, y - 19, 5, 2, ink);
    drawPixelRect(ctx, x + 5, y - 19, 5, 2, ink);
    if (!completeYawn) {
      ctx.fillStyle = "#f8f0c9";
      ctx.font = "10px monospace";
      ctx.fillText("Z", x + 17, y - 34);
    }
  } else {
    const eyeHeight =
      dominantTrait === "efficiency" ? 5 : dominantTrait === "curiosity" ? 7 : focused ? 5 : 6;
    drawPixelRect(ctx, x - 8, y - 20, 5, eyeHeight, theme.eye);
    drawPixelRect(ctx, x + 5, y - 20, 5, eyeHeight, theme.eye);
    drawPixelRect(ctx, x - 6, y - (dominantTrait === "curiosity" ? 17 : 18), dominantTrait === "efficiency" ? 3 : 2, 2, ink);
    drawPixelRect(ctx, x + 7, y - (dominantTrait === "curiosity" ? 17 : 18), dominantTrait === "efficiency" ? 3 : 2, 2, ink);
    if (focused) {
      drawPixelRect(ctx, x - 9, y - 23, 7, 2, ink);
      drawPixelRect(ctx, x + 4, y - 23, 7, 2, ink);
    }
    if (dominantTrait === "resilience" && worried) {
      drawPixelRect(ctx, x - 10, y - 23, 8, 2, theme.accent);
      drawPixelRect(ctx, x + 5, y - 23, 8, 2, theme.accent);
    }
  }

  if (completeYawn) {
    drawCompleteYawnPose(ctx, x, y, frame, facing, body, bodyLight, ink);
  } else if (facing === "back") {
    drawPixelRect(ctx, x - 8, y - 9, 18, 3, theme.accent);
  } else if (facing === "left" || facing === "right") {
    const mouthX = x + sideDirection * 5;
    if (happy) {
      drawPixelRect(ctx, mouthX - 2, y - 11, 8, 2, "#f8f0c9");
    } else if (worried) {
      drawPixelRect(ctx, mouthX - 1, y - 11, 5, 2, ink);
      drawPixelRect(ctx, x - sideDirection * 12, y - 26, 3, 6, "#9ee6ff");
    } else {
      drawPixelRect(ctx, mouthX, y - 11, 5, 2, "#51415f");
    }
  } else if (happy) {
    drawPixelRect(ctx, x - 4, y - 11, 10, 2, "#f8f0c9");
  } else if (worried) {
    drawPixelRect(ctx, x - 2, y - 11, 6, 2, ink);
    drawPixelRect(ctx, x + 16, y - 26, 3, 6, "#9ee6ff");
  } else {
    drawPixelRect(ctx, x - 2, y - 11, 6, 2, "#51415f");
  }

  if (avatar.behavior === "coffee") {
    drawCoffeeSipPose(ctx, x, y, frame, facing, body, bodyLight, ink);
  }

  if (avatar.behavior === "cola") {
    drawColaSipPose(ctx, x, y, frame, facing, body, bodyLight, ink);
  }

  if (avatar.behavior === "bento") {
    drawBentoEatPose(ctx, x, y, frame, facing, body, bodyLight, ink);
  }

  if (avatar.behavior === "cookie") {
    drawCookieEatPose(ctx, x, y, frame, facing, body, bodyLight, ink);
  }

  if (avatar.behavior === "phone") {
    drawPhonePose(ctx, x, y, frame, facing, body, bodyLight, ink, theme.screenGlow);
  }

  if (avatar.behavior === "admire") {
    drawAdmirePose(ctx, x, y, frame, facing, body, bodyLight, ink, theme.accent);
  }

  if (avatar.behavior === "paint") {
    drawPaintPose(ctx, x, y, frame, facing, body, bodyLight, ink);
  }

  if (
    avatar.behavior === "fetch_task_file" ||
    avatar.behavior === "carry_task_file" ||
    avatar.behavior === "read_task_file"
  ) {
    drawTaskFilePose(ctx, x, y, frame, facing, body, bodyLight, avatar.behavior);
  }

  if (avatar.behavior === "coding" || avatar.behavior === "thinking") {
    const deviceX = facing === "left" ? x - 30 : x + 17;
    drawPixelRect(ctx, deviceX, y - 8, 13, 9, "#171b26");
    drawPixelRect(ctx, deviceX + 2, y - 6, 9, 4, theme.screenGlow);
    const tap = Math.round(Math.sin(frame / 3) * 2);
    drawPixelRect(ctx, x - 18, y - 2 + tap, 8, 4, body);
    drawPixelRect(ctx, x + 13, y - 1 - tap, 8, 4, body);
    drawPixelRect(ctx, x - 18, y + 2 + tap, 5, 2, bodyLight);
    drawPixelRect(ctx, x + 16, y + 3 - tap, 5, 2, bodyLight);
  }

  drawTraitStatusMotif(ctx, dominantTrait, avatar, x, y, frame, theme);
  drawTraitMicroExpression(ctx, dominantTrait, avatar, x, y, frame, theme);
};

const drawSleepBlanketOverlay = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  avatar: AvatarRuntime,
) => {
  if (avatar.behavior !== "sleep") return;

  const bed = content.room.furniture.find((item) => item.id === "bed");
  if (!bed) return;

  const bedSleepX = bed.x + bed.width / 2;
  const bedSleepY = bed.y + 50;
  if (Math.hypot(avatar.x - bedSleepX, avatar.y - bedSleepY) > 28) return;

  const palette = bedPalette(bed);
  const industrial = bedSkinId(bed) === "industrial-bed-skin";
  const pinkPlaid = bedSkinId(bed) === "ivory-pink-plaid-bed-skin";
  const modernMinimal =
    bedSkinId(bed) === "modern-minimal-bed-skin" ||
    bedSkinId(bed) === "space-white-deep-gray-bed-skin";

  if (modernMinimal) {
    drawPixelRect(ctx, bed.x + 2, bed.y + 31, 3, bed.height - 36, palette.frameAccent);
    drawPixelRect(ctx, bed.x + bed.width - 5, bed.y + 31, 3, bed.height - 36, palette.frameAccent);
    drawPixelRect(ctx, bed.x + 5, bed.y + 25, bed.width - 10, 14, palette.sheet);
    drawPixelRect(ctx, bed.x + 8, bed.y + 28, bed.width - 16, 3, palette.sheetLight);
    drawPixelRect(ctx, bed.x, bed.y + 31, bed.width, 8, palette.sheet);
    drawPixelRect(ctx, bed.x + 4, bed.y + 32, bed.width - 8, 2, palette.sheetLight);
    drawPixelRect(ctx, bed.x, bed.y + 36, bed.width, 55, palette.blanket);
    drawPixelRect(ctx, bed.x + 5, bed.y + 37, bed.width - 10, 3, palette.blanketLight);
    drawPixelRect(ctx, bed.x + 5, bed.y + 40, bed.width - 10, 7, palette.blanketLight);
    drawPixelRect(ctx, bed.x + 5, bed.y + 47, bed.width - 10, 8, palette.blanketMid);
    drawPixelRect(ctx, bed.x + 3, bed.y + 55, bed.width - 6, 33, palette.blanket);
    drawPixelRect(ctx, bed.x + 2, bed.y + 88, bed.width - 4, 10, palette.sheet);
    drawPixelRect(ctx, bed.x + 6, bed.y + 89, bed.width - 12, 1, palette.sheetLight);
    drawPixelRect(ctx, bed.x + 2, bed.y + 88, bed.width - 4, 2, palette.blanketDark);
    drawPixelRect(ctx, bed.x, bed.y + 90, 2, 8, palette.blanket);
    drawPixelRect(ctx, bed.x + bed.width - 2, bed.y + 90, 2, 8, palette.blanket);
    drawPixelRect(ctx, bed.x - 1, bed.y + 98, bed.width + 2, 2, palette.frame);
    drawPixelRect(ctx, bed.x + 3, bed.y + 99, bed.width - 6, 1, palette.frameLight);
  } else {
    drawPixelRect(ctx, bed.x + 2, bed.y + 25, bed.width - 4, 15, palette.sheet);
    drawPixelRect(ctx, bed.x + 6, bed.y + 28, bed.width - 12, 4, palette.sheetLight);
    drawPixelRect(ctx, bed.x + 2, bed.y + 36, bed.width - 4, bed.height - 50, palette.blanket);
    drawPixelRect(ctx, bed.x + 5, bed.y + 37, bed.width - 10, 3, palette.blanketLight);
    drawPixelRect(ctx, bed.x + 5, bed.y + 40, bed.width - 10, 7, palette.blanketLight);
    drawPixelRect(ctx, bed.x + 5, bed.y + 47, bed.width - 10, 8, palette.blanketMid);
    drawPixelRect(ctx, bed.x + 5, bed.y + 55, bed.width - 10, 9, palette.blanket);
    drawPixelRect(ctx, bed.x + 5, bed.y + 64, bed.width - 10, 8, palette.blanketLow);
    drawPixelRect(ctx, bed.x + 5, bed.y + 52, bed.width - 10, industrial ? 1 : 3, palette.blanketDark);
    drawPixelRect(ctx, bed.x + 5, bed.y + 69, bed.width - 10, industrial ? 1 : 3, palette.blanketDark);
  }
  drawPixelRect(ctx, bed.x + 13, bed.y + 45, 3, 3, palette.blanketSpark);
  drawPixelRect(ctx, bed.x + 39, bed.y + 58, 2, 2, industrial ? palette.frameBright : "#fff4b8");
  drawPixelRect(ctx, bed.x + bed.width - 20, bed.y + 48, 3, 3, palette.blanketSpark);
  if (pinkPlaid) {
    drawPixelRect(ctx, bed.x + 11, bed.y + 37, 1, 35, palette.blanketLight);
    drawPixelRect(ctx, bed.x + 22, bed.y + 37, 2, 35, palette.blanketDark);
    drawPixelRect(ctx, bed.x + 35, bed.y + 37, 1, 35, palette.blanketLight);
    drawPixelRect(ctx, bed.x + bed.width - 34, bed.y + 37, 2, 35, palette.blanketDark);
    drawPixelRect(ctx, bed.x + bed.width - 18, bed.y + 37, 1, 35, palette.blanketLight);
    drawPixelRect(ctx, bed.x + 5, bed.y + 42, bed.width - 10, 1, palette.blanketLight);
    drawPixelRect(ctx, bed.x + 5, bed.y + 49, bed.width - 10, 2, palette.blanketDark);
    drawPixelRect(ctx, bed.x + 5, bed.y + 57, bed.width - 10, 1, palette.blanketLight);
    drawPixelRect(ctx, bed.x + 5, bed.y + 64, bed.width - 10, 2, palette.blanketDark);
    drawPixelRect(ctx, bed.x + 5, bed.y + 70, bed.width - 10, 1, palette.blanketLight);
  }
  if (modernMinimal) {
    drawPixelRect(ctx, bed.x + 9, bed.y + 42, bed.width - 18, 2, palette.sheetLight);
    drawPixelRect(ctx, bed.x + 9, bed.y + 50, bed.width - 18, 1, palette.blanketDark);
    drawPixelRect(ctx, bed.x + 16, bed.y + 57, 9, 2, palette.blanketSpark);
    drawPixelRect(ctx, bed.x + 27, bed.y + 57, 19, 2, palette.sheetLight);
    drawPixelRect(ctx, bed.x + bed.width - 28, bed.y + 64, 10, 2, palette.blanketSpark);
  }
};

const drawAvatarBubble = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  interaction?: FurnitureInteractionState | null,
  uiTheme: UiThemeId = "classic",
) => {
  if (!interaction?.bubbleText) return;

  const now = performance.now();
  const ageSeconds = (now - interaction.startedAt) / 1000;
  const hasDuration = typeof interaction.endsAt === "number";

  if (!hasDuration && ageSeconds > 4) return;

  const progress = hasDuration
    ? Math.min(1, Math.max(0, (now - interaction.startedAt) / (interaction.endsAt! - interaction.startedAt)))
    : interaction.progress;
  ctx.font = "8px monospace";
  const maxTextWidth = 118;
  const text = ellipsizeToWidth(ctx, interaction.bubbleText, maxTextWidth);
  const width = Math.max(38, Math.ceil(measurePixelText(ctx, text)) + 14);
  const x = Math.round(Math.min(sceneSize.width - width - 8, Math.max(8, avatar.x - width / 2)));
  const y = Math.round(Math.max(18, avatar.y - 64));
  const palette = bubblePaletteForTheme(uiTheme);

  drawPixelRect(ctx, x + 3, y + 4, width, hasDuration ? 25 : 18, palette.shadow);
  drawPixelRect(ctx, x, y, width, hasDuration ? 25 : 18, palette.border);
  drawPixelRect(ctx, x + 2, y + 2, width - 4, hasDuration ? 21 : 14, palette.fill);
  if (isTerminalTheme(uiTheme)) {
    drawPixelRect(ctx, x + 4, y + 4, width - 8, 1, terminalScanlineForTheme(uiTheme));
  }
  drawPixelRect(
    ctx,
    x + Math.floor(width / 2) - 3,
    y + (hasDuration ? 25 : 18),
    6,
    5,
    palette.tail,
  );

  const textColor = interaction.kind === "blocked" ? palette.errorText : palette.warningText;
  drawPixelText(ctx, text, x + 6, y + 4, textColor);

  if (typeof progress === "number") {
    const barWidth = width - 12;
    drawPixelRect(ctx, x + 6, y + 17, barWidth, 4, palette.progressTrack);
    drawPixelRect(
      ctx,
      x + 6,
      y + 17,
      barWidth * Math.min(1, Math.max(0, progress)),
      4,
      palette.progressFill,
    );
  }
};

const drawPixelBubble = (
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  text: string,
  tone: "info" | "warning" | "error" = "info",
  shape: "pixel" | "rounded" = "pixel",
  options: { maxLines?: number } = {},
  uiTheme: UiThemeId = "classic",
) => {
  const maxLines = options.maxLines ?? 1;
  ctx.font = "8px monospace";
  const maxTextWidth = shape === "rounded" ? 150 : 128;
  const lines = wrapBubbleTextByWidth(ctx, text, maxTextWidth, maxLines);
  const textWidth = Math.max(
    ...lines.map((line) => measurePixelText(ctx, line)),
  );
  const width = Math.ceil(Math.max(54, textWidth + 14));
  const height = lines.length > 1 ? 28 : 18;
  const x = Math.round(Math.min(sceneSize.width - width - 8, Math.max(8, anchorX - width / 2)));
  const y = Math.round(Math.max(12, anchorY));
  const palette = bubblePaletteForTheme(uiTheme);
  const textColor =
    tone === "error"
      ? palette.errorText
      : tone === "warning"
        ? palette.warningText
        : palette.infoText;

  if (shape === "rounded") {
    ctx.fillStyle = palette.shadow;
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 4, width, height, 7);
    ctx.fill();
    ctx.fillStyle = palette.border;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 7);
    ctx.fill();
    ctx.fillStyle = palette.fill;
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, width - 4, height - 4, 5);
    ctx.fill();
  } else {
    drawPixelRect(ctx, x + 3, y + 4, width, height, palette.shadow);
    drawPixelRect(ctx, x, y, width, height, palette.border);
    drawPixelRect(ctx, x + 2, y + 2, width - 4, height - 4, palette.fill);
  }
  if (isTerminalTheme(uiTheme)) {
    drawPixelRect(ctx, x + 4, y + 4, width - 8, 1, terminalScanlineForTheme(uiTheme));
  }
  drawPixelRect(ctx, x + Math.floor(width / 2) - 3, y + height, 6, 5, palette.tail);

  ctx.fillStyle = textColor;
  lines.forEach((line, index) => {
    drawPixelText(ctx, line, x + 6, y + 6 + index * 10, textColor);
  });
};

const drawComputerStatusBubble = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  status: CodexStatusMessage,
  uiTheme: UiThemeId = "classic",
) => {
  if (status.agent !== "codex" && status.agent !== "claude-code") return;
  if (status.status === "idle" || status.status === "thinking") return;
  if (!isStatusBubbleVisible(status)) return;
  const terminal = content.placedItems?.find(
    (item) =>
      item.id === BUILTIN_TERMINAL_PLACED_ITEM_ID ||
      item.itemId === TERMINAL_MONITOR_ITEM_ID,
  );
  if (!terminal) return;

  const tone =
    status.status === "error"
      ? "error"
      : status.status === "waiting_for_user"
        ? "warning"
        : "info";

  drawPixelBubble(
    ctx,
    terminal.x,
    terminal.y - 52,
    compactStatusText(status, status.status),
    tone,
    "pixel",
    { maxLines: 2 },
    uiTheme,
  );
};

const drawCodexThinkingBubble = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  status: CodexStatusMessage,
  memory?: AivatarMemory,
  uiTheme: UiThemeId = "classic",
) => {
  if (status.status !== "thinking") return;
  if (!isStatusBubbleVisible(status)) return;
  const trait = dominantTraitFromMemory(memory);
  drawPixelBubble(
    ctx,
    avatar.x,
    avatar.y - 72,
    statusHasOwnSummary(status)
      ? compactStatusText(status, "Thinking")
      : traitBubbleText(trait, "thinking", "Thinking"),
    "info",
    "rounded",
    { maxLines: 2 },
    uiTheme,
  );
};

const drawActivityBubble = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  memory?: AivatarMemory,
  uiTheme: UiThemeId = "classic",
) => {
  if (["coding", "thinking", "waiting"].includes(avatar.behavior)) {
    return;
  }
  const trait = dominantTraitFromMemory(memory);
  const customPhrases = memory?.preferences.idleBubblePhrases ?? [];
  const text =
    (avatar.behavior === "admire" && avatar.activityLabel
      ? traitBubbleText(trait, avatar.behavior, avatar.activityLabel)
      : idleBubbleText(trait, avatar.behavior, customPhrases)) ??
    (avatar.activityLabel && avatar.behaviorTimer >= 2.2
      ? traitBubbleText(trait, avatar.behavior, avatar.activityLabel)
      : null);

  if (!text) return;

  drawAvatarBubble(ctx, avatar, {
    kind: "none",
    furnitureId: "activity",
    furnitureName: "Activity",
    message: text,
    startedAt: performance.now(),
    bubbleText: text,
  }, uiTheme);
};

const drawTinyPlant = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  ctx.save();
  if (ghost !== "none") {
    ctx.globalAlpha = 0.62;
  }

  const pot = ghost === "invalid" ? "#ff8fa3" : "#c48650";
  const potDark = ghost === "invalid" ? "#d95575" : "#8d5436";
  const potLight = ghost === "invalid" ? "#ffc0cf" : "#e1a06d";
  const soil = ghost === "invalid" ? "#7d2f48" : "#4a2f25";
  const stem = ghost === "invalid" ? "#ffd1dc" : "#4f8a8f";
  const leaf = ghost === "invalid" ? "#ffd1dc" : "#8df7c4";
  const leafDark = ghost === "invalid" ? "#ff9bb4" : "#2f9f73";
  const leafMid = ghost === "invalid" ? "#ffc0cf" : "#5bd898";
  const leafLight = ghost === "invalid" ? "#fff0f4" : "#b4f56c";
  const outline = ghost === "valid" ? "#ffe66d" : "#111624";
  const baseX = Math.round(x);
  const baseY = Math.round(y);

  drawPixelRect(ctx, baseX - 8, baseY - 7, 16, 2, "rgba(17, 22, 36, 0.24)");

  drawPixelRect(ctx, baseX - 8, baseY - 13, 16, 4, outline);
  drawPixelRect(ctx, baseX - 6, baseY - 15, 12, 5, pot);
  drawPixelRect(ctx, baseX - 5, baseY - 14, 10, 2, potLight);
  drawPixelRect(ctx, baseX - 4, baseY - 12, 8, 2, soil);
  drawPixelRect(ctx, baseX - 7, baseY - 9, 14, 8, outline);
  drawPixelRect(ctx, baseX - 5, baseY - 11, 10, 10, pot);
  drawPixelRect(ctx, baseX - 5, baseY - 4, 10, 3, potDark);
  drawPixelRect(ctx, baseX - 2, baseY - 10, 2, 8, potLight);
  drawPixelRect(ctx, baseX + 4, baseY - 8, 1, 5, potDark);

  drawPixelRect(ctx, baseX - 1, baseY - 25, 2, 13, stem);
  drawPixelRect(ctx, baseX - 5, baseY - 22, 2, 9, stem);
  drawPixelRect(ctx, baseX + 4, baseY - 24, 2, 10, stem);

  drawPixelRect(ctx, baseX - 13, baseY - 23, 9, 5, leafDark);
  drawPixelRect(ctx, baseX - 12, baseY - 25, 7, 3, leafMid);
  drawPixelRect(ctx, baseX - 10, baseY - 26, 4, 2, leaf);
  drawPixelRect(ctx, baseX + 4, baseY - 26, 10, 6, leafDark);
  drawPixelRect(ctx, baseX + 5, baseY - 28, 8, 4, leafMid);
  drawPixelRect(ctx, baseX + 7, baseY - 29, 5, 2, leaf);
  drawPixelRect(ctx, baseX - 5, baseY - 32, 10, 6, leafDark);
  drawPixelRect(ctx, baseX - 4, baseY - 34, 8, 5, leafLight);
  drawPixelRect(ctx, baseX - 2, baseY - 35, 5, 2, leaf);
  drawPixelRect(ctx, baseX + 1, baseY - 21, 7, 4, leafMid);
  drawPixelRect(ctx, baseX + 3, baseY - 22, 4, 2, leafLight);
  drawPixelRect(ctx, baseX - 8, baseY - 18, 5, 3, leafMid);
  drawPixelRect(ctx, baseX - 7, baseY - 19, 3, 2, leafLight);

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.lineWidth = 1;
    ctx.strokeRect(baseX - 13, baseY - 32, 26, 34);
  }

  ctx.restore();
};

const drawCozyRug = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.58;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const edge = ghost === "invalid" ? "#b64c54" : "#f4ead2";
  const stripeColors =
    ghost === "invalid"
      ? ["#ff8fa3", "#ffb3c1", "#ff8fa3", "#ffd1dc", "#ff8fa3", "#b64c54"]
      : ["#ff5c7a", "#f2a65a", "#ffe66d", "#8df7c4", "#5ce1e6", "#a98ed0"];

  drawPixelRect(ctx, baseX - 38, baseY + 18, 78, 3, "rgba(17, 22, 36, 0.32)");
  drawPixelRect(ctx, baseX + 38, baseY - 16, 3, 34, "rgba(17, 22, 36, 0.24)");
  drawPixelRect(ctx, baseX - 37, baseY - 18, 74, 36, edge);
  drawPixelRect(ctx, baseX - 35, baseY - 16, 70, 32, "#f4ead2");

  stripeColors.forEach((color, index) => {
    const stripeY = baseY - 16 + index * 5;
    const stripeHeight = index === stripeColors.length - 1 ? 7 : 5;
    drawPixelRect(ctx, baseX - 33, stripeY, 66, stripeHeight, color);
  });

  drawPixelRect(ctx, baseX - 35, baseY - 16, 2, 32, "#f4ead2");
  drawPixelRect(ctx, baseX + 33, baseY - 16, 2, 32, "#c8af79");
  drawPixelRect(ctx, baseX - 33, baseY - 15, 66, 2, "rgba(255, 255, 255, 0.18)");
  drawPixelRect(ctx, baseX - 33, baseY + 13, 66, 3, "rgba(17, 22, 36, 0.18)");

  for (let tuftX = -34; tuftX <= 32; tuftX += 6) {
    const tuftColor = tuftX % 12 === 0 ? "#f4ead2" : "#cfc5a8";
    drawPixelRect(ctx, baseX + tuftX, baseY - 23, 3, 4, tuftColor);
    drawPixelRect(ctx, baseX + tuftX + 2, baseY + 19, 3, 4, tuftColor);
  }

  for (let textureX = -30; textureX <= 30; textureX += 10) {
    drawPixelRect(ctx, baseX + textureX, baseY - 10, 4, 1, "rgba(255, 255, 255, 0.28)");
    drawPixelRect(ctx, baseX + textureX + 5, baseY, 4, 1, "rgba(17, 22, 36, 0.22)");
    drawPixelRect(ctx, baseX + textureX - 2, baseY + 9, 3, 1, "rgba(255, 255, 255, 0.22)");
  }

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 44, baseY - 24, 88, 48);
  }
  ctx.restore();
};

const drawMorphBlobRug = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.58;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const body = ghost === "invalid" ? "#ff8fa3" : "#b86fe6";
  const bodyLight = ghost === "invalid" ? "#ffd1dc" : "#d58cff";
  const bodyDark = ghost === "invalid" ? "#b64c54" : "#8b46bd";
  const edge = ghost === "invalid" ? "#732b39" : "#6d319f";
  const shadow = ghost === "invalid" ? "#732b39" : "#63318e";
  const face = ghost === "invalid" ? "#732b39" : "#4d2478";

  drawPixelRect(ctx, baseX - 38, baseY + 4, 84, 10, shadow);
  drawPixelRect(ctx, baseX - 36, baseY - 7, 80, 20, edge);
  drawPixelRect(ctx, baseX - 32, baseY - 20, 72, 30, edge);
  drawPixelRect(ctx, baseX - 25, baseY - 31, 58, 30, edge);
  drawPixelRect(ctx, baseX - 34, baseY - 5, 76, 15, bodyDark);
  drawPixelRect(ctx, baseX - 30, baseY - 18, 66, 25, body);
  drawPixelRect(ctx, baseX - 22, baseY - 28, 50, 22, body);
  drawPixelRect(ctx, baseX - 30, baseY - 16, 13, 16, bodyLight);
  drawPixelRect(ctx, baseX + 17, baseY - 15, 12, 16, bodyDark);
  drawPixelRect(ctx, baseX - 13, baseY + 3, 28, 8, bodyLight);
  drawPixelRect(ctx, baseX - 36, baseY - 3, 8, 10, edge);
  drawPixelRect(ctx, baseX + 29, baseY - 2, 13, 12, edge);
  drawPixelRect(ctx, baseX - 34, baseY - 14, 6, 8, bodyDark);
  drawPixelRect(ctx, baseX + 28, baseY - 12, 10, 8, bodyDark);
  drawPixelRect(ctx, baseX - 36, baseY - 9, 5, 7, bodyDark);
  drawPixelRect(ctx, baseX + 31, baseY - 7, 8, 8, bodyDark);
  drawPixelRect(ctx, baseX - 24, baseY - 28, 8, 5, body);
  drawPixelRect(ctx, baseX + 18, baseY - 26, 12, 5, body);
  drawPixelRect(ctx, baseX - 29, baseY - 23, 7, 6, body);
  drawPixelRect(ctx, baseX + 24, baseY - 21, 12, 6, body);
  drawPixelRect(ctx, baseX - 34, baseY + 6, 10, 4, bodyDark);
  drawPixelRect(ctx, baseX + 24, baseY + 6, 16, 4, bodyDark);
  drawPixelRect(ctx, baseX - 18, baseY - 34, 20, 7, edge);
  drawPixelRect(ctx, baseX + 7, baseY - 34, 24, 7, edge);
  drawPixelRect(ctx, baseX - 13, baseY - 38, 14, 5, edge);
  drawPixelRect(ctx, baseX + 13, baseY - 38, 13, 5, edge);
  drawPixelRect(ctx, baseX - 11, baseY - 37, 11, 4, body);
  drawPixelRect(ctx, baseX + 15, baseY - 37, 9, 4, body);
  drawPixelRect(ctx, baseX - 8, baseY - 39, 7, 2, bodyLight);
  drawPixelRect(ctx, baseX + 17, baseY - 39, 6, 2, bodyLight);
  drawPixelRect(ctx, baseX + 1, baseY - 33, 7, 3, body);
  drawPixelRect(ctx, baseX + 4, baseY - 35, 3, 2, bodyLight);
  drawPixelRect(ctx, baseX - 19, baseY - 17, 4, 4, face);
  drawPixelRect(ctx, baseX + 7, baseY - 17, 4, 4, face);
  drawPixelRect(ctx, baseX - 20, baseY - 10, 4, 2, face);
  drawPixelRect(ctx, baseX - 16, baseY - 8, 8, 2, face);
  drawPixelRect(ctx, baseX - 8, baseY - 7, 16, 2, face);
  drawPixelRect(ctx, baseX + 8, baseY - 8, 8, 2, face);
  drawPixelRect(ctx, baseX + 16, baseY - 10, 4, 2, face);
  drawPixelRect(ctx, baseX - 24, baseY - 23, 10, 2, "#e6a8ff");
  drawPixelRect(ctx, baseX - 8, baseY - 27, 13, 2, "#e6a8ff");
  drawPixelRect(ctx, baseX + 14, baseY - 22, 10, 2, "#a855d4");
  drawPixelRect(ctx, baseX - 28, baseY - 1, 5, 2, "#e6a8ff");
  drawPixelRect(ctx, baseX + 27, baseY + 2, 6, 2, "#a855d4");
  for (let fringeX = -32; fringeX <= 32; fringeX += 8) {
    drawPixelRect(ctx, baseX + fringeX, baseY + 12, 3, 4, edge);
  }

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 40, baseY - 44, 88, 62);
  }
  ctx.restore();
};

const drawBluePersianRug = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.58;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const outline = ghost === "invalid" ? "#7d2f47" : "#102f62";
  const navy = ghost === "invalid" ? "#b64c54" : "#174b8a";
  const deepBlue = ghost === "invalid" ? "#d95575" : "#1d5fa8";
  const midBlue = ghost === "invalid" ? "#ff8fa3" : "#4fa3d9";
  const ice = ghost === "invalid" ? "#ffd1dc" : "#d7f0ff";
  const ivory = ghost === "invalid" ? "#fff0f4" : "#f7fbff";
  const pale = ghost === "invalid" ? "#ffc0cf" : "#b9def6";
  const drawMirroredDetail = (
    dx: number,
    dy: number,
    draw: (detailX: number, detailY: number) => void,
  ) => {
    draw(baseX + dx, baseY + dy);
    draw(baseX - dx, baseY + dy);
    draw(baseX + dx, baseY - dy);
    draw(baseX - dx, baseY - dy);
  };

  drawPixelRect(ctx, baseX - 48, baseY + 31, 100, 5, "rgba(17, 22, 36, 0.3)");
  drawPixelRect(ctx, baseX + 47, baseY - 30, 5, 64, "rgba(17, 22, 36, 0.18)");

  drawPixelRect(ctx, baseX - 52, baseY - 36, 104, 72, outline);
  drawPixelRect(ctx, baseX - 50, baseY - 34, 100, 68, navy);
  drawPixelRect(ctx, baseX - 44, baseY - 28, 88, 56, ice);
  drawPixelRect(ctx, baseX - 38, baseY - 22, 76, 44, ivory);

  drawPixelRect(ctx, baseX - 48, baseY - 32, 96, 3, midBlue);
  drawPixelRect(ctx, baseX - 48, baseY + 29, 96, 3, midBlue);
  drawPixelRect(ctx, baseX - 48, baseY - 29, 3, 58, deepBlue);
  drawPixelRect(ctx, baseX + 45, baseY - 29, 3, 58, deepBlue);
  drawPixelRect(ctx, baseX - 42, baseY - 26, 84, 2, ivory);
  drawPixelRect(ctx, baseX - 42, baseY + 24, 84, 2, pale);
  drawPixelRect(ctx, baseX - 42, baseY - 24, 2, 48, pale);
  drawPixelRect(ctx, baseX + 40, baseY - 24, 2, 48, ivory);
  drawPixelRect(ctx, baseX - 34, baseY - 18, 68, 1, midBlue);
  drawPixelRect(ctx, baseX - 34, baseY + 17, 68, 1, midBlue);

  for (let offset = -34; offset <= 34; offset += 17) {
    drawPixelRect(ctx, baseX + offset, baseY - 27, 5, 3, ivory);
    drawPixelRect(ctx, baseX + offset + 6, baseY + 24, 5, 3, ivory);
    drawPixelRect(ctx, baseX - 46, baseY + Math.round(offset * 0.58), 3, 5, pale);
    drawPixelRect(ctx, baseX + 43, baseY - Math.round(offset * 0.58), 3, 5, pale);
  }

  for (let guardX = -36; guardX <= 36; guardX += 12) {
    drawPixelRect(ctx, baseX + guardX, baseY - 31, 3, 2, navy);
    drawPixelRect(ctx, baseX + guardX + 6, baseY + 30, 3, 2, navy);
  }

  drawPixelRect(ctx, baseX - 8, baseY - 18, 16, 36, deepBlue);
  drawPixelRect(ctx, baseX - 18, baseY - 10, 36, 20, deepBlue);
  drawPixelRect(ctx, baseX - 11, baseY - 13, 22, 26, midBlue);
  drawPixelRect(ctx, baseX - 15, baseY - 7, 30, 14, midBlue);
  drawPixelRect(ctx, baseX - 6, baseY - 8, 12, 16, ivory);
  drawPixelRect(ctx, baseX - 9, baseY - 4, 18, 8, ivory);
  drawPixelRect(ctx, baseX - 3, baseY - 3, 6, 6, navy);
  drawPixelRect(ctx, baseX - 2, baseY - 13, 4, 4, ivory);
  drawPixelRect(ctx, baseX - 2, baseY + 9, 4, 4, pale);
  drawPixelRect(ctx, baseX - 13, baseY - 1, 4, 2, navy);
  drawPixelRect(ctx, baseX + 9, baseY - 1, 4, 2, navy);
  drawPixelRect(ctx, baseX - 5, baseY - 16, 10, 2, navy);
  drawPixelRect(ctx, baseX - 5, baseY + 14, 10, 2, navy);
  drawPixelRect(ctx, baseX - 20, baseY - 2, 5, 4, midBlue);
  drawPixelRect(ctx, baseX + 15, baseY - 2, 5, 4, midBlue);

  const heratiMarks = [
    { x: -24, y: -11 },
    { x: 24, y: -11 },
    { x: -24, y: 11 },
    { x: 24, y: 11 },
  ];
  for (const mark of heratiMarks) {
    drawPixelRect(ctx, baseX + mark.x - 2, baseY + mark.y - 2, 4, 4, deepBlue);
    drawPixelRect(ctx, baseX + mark.x - 4, baseY + mark.y, 8, 1, pale);
    drawPixelRect(ctx, baseX + mark.x, baseY + mark.y - 4, 1, 8, pale);
  }

  const cornerMotifs = [
    { sx: -1, sy: -1 },
    { sx: 1, sy: -1 },
    { sx: -1, sy: 1 },
    { sx: 1, sy: 1 },
  ];
  for (const motif of cornerMotifs) {
    const cornerX = baseX + motif.sx * 31;
    const cornerY = baseY + motif.sy * 18;
    drawPixelRect(ctx, cornerX - 5, cornerY - 3, 10, 6, midBlue);
    drawPixelRect(ctx, cornerX - 2, cornerY - 7, 4, 14, deepBlue);
    drawPixelRect(ctx, cornerX - 7, cornerY - 1, 14, 2, deepBlue);
    drawPixelRect(ctx, cornerX - 1, cornerY - 1, 2, 2, ivory);
    drawPixelRect(ctx, cornerX + motif.sx * 6, cornerY, 3, 2, pale);
    drawPixelRect(ctx, cornerX, cornerY + motif.sy * 5, 2, 3, ivory);
  }

  for (const [dx, dy] of [
    [16, 14],
    [30, 14],
  ] as const) {
    drawMirroredDetail(dx, dy, (detailX, detailY) => {
      drawPixelRect(ctx, detailX - 4, detailY, 8, 1, pale);
      drawPixelRect(ctx, detailX - 1, detailY + (detailY > baseY ? -2 : 1), 2, 2, midBlue);
    });
  }

  for (const [dx, dy] of [
    [16, 5],
    [32, 5],
  ] as const) {
    drawMirroredDetail(dx, dy, (detailX, detailY) => {
      drawPixelRect(ctx, detailX - 1, detailY - 2, 3, 5, midBlue);
      drawPixelRect(ctx, detailX + 1, detailY - 4, 2, 3, deepBlue);
      drawPixelRect(ctx, detailX - 2, detailY + 2, 2, 2, pale);
    });
  }

  for (const [dx, dy] of [
    [12, 6],
    [30, 6],
  ] as const) {
    drawMirroredDetail(dx, dy, (detailX, detailY) => {
      drawPixelRect(ctx, detailX - 1, detailY - 1, 2, 2, pale);
    });
  }

  for (let threadX = -45; threadX <= 45; threadX += 6) {
    drawPixelRect(ctx, baseX + threadX, baseY - 40, 3, 4, threadX % 12 === 0 ? ice : ivory);
    drawPixelRect(ctx, baseX + threadX + 2, baseY + 36, 3, 4, threadX % 12 === 0 ? pale : ivory);
  }
  for (let threadY = -28; threadY <= 28; threadY += 7) {
    drawPixelRect(ctx, baseX - 56, baseY + threadY, 4, 3, threadY % 14 === 0 ? ice : ivory);
    drawPixelRect(ctx, baseX + 52, baseY + threadY + 2, 4, 3, threadY % 14 === 0 ? pale : ivory);
  }

  drawPixelRect(ctx, baseX - 38, baseY - 20, 76, 2, "rgba(255, 255, 255, 0.28)");
  drawPixelRect(ctx, baseX - 38, baseY + 18, 76, 3, "rgba(17, 22, 36, 0.14)");

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 52, baseY - 36, 104, 72);
  }
  ctx.restore();
};

const drawDeskLamp = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const shade = ghost === "invalid" ? "#ff8fa3" : "#ffe66d";
  const shadeDark = ghost === "invalid" ? "#d95575" : "#d19b2f";
  const shadeLight = ghost === "invalid" ? "#ffd1dc" : "#fff3a6";
  const metal = ghost === "invalid" ? "#ffd1dc" : "#6d7794";
  const metalLight = ghost === "invalid" ? "#fff0f4" : "#aab4cc";
  const glow =
    ghost === "invalid" ? "rgba(255, 143, 163, 0.22)" : "rgba(255, 230, 109, 0.28)";

  drawPixelRect(ctx, baseX - 13, baseY + 1, 26, 3, glow);
  drawPixelRect(ctx, baseX - 10, baseY - 3, 20, 5, "#111624");
  drawPixelRect(ctx, baseX - 8, baseY - 5, 16, 4, metal);
  drawPixelRect(ctx, baseX - 6, baseY - 4, 10, 1, metalLight);
  drawPixelRect(ctx, baseX + 5, baseY - 3, 2, 3, "#3f465f");

  drawPixelRect(ctx, baseX - 4, baseY - 19, 3, 15, "#111624");
  drawPixelRect(ctx, baseX - 3, baseY - 19, 3, 15, metal);
  drawPixelRect(ctx, baseX - 2, baseY - 18, 1, 12, metalLight);
  drawPixelRect(ctx, baseX + 1, baseY - 18, 3, 3, "#111624");
  drawPixelRect(ctx, baseX + 2, baseY - 17, 2, 2, metalLight);

  drawPixelRect(ctx, baseX + 1, baseY - 22, 8, 3, "#111624");
  drawPixelRect(ctx, baseX + 2, baseY - 22, 7, 2, metal);
  drawPixelRect(ctx, baseX + 5, baseY - 24, 3, 5, "#111624");
  drawPixelRect(ctx, baseX + 6, baseY - 24, 2, 4, metalLight);

  drawPixelRect(ctx, baseX - 9, baseY - 27, 19, 3, "#111624");
  drawPixelRect(ctx, baseX - 10, baseY - 24, 21, 6, "#111624");
  drawPixelRect(ctx, baseX - 8, baseY - 28, 16, 3, shadeLight);
  drawPixelRect(ctx, baseX - 9, baseY - 24, 19, 5, shade);
  drawPixelRect(ctx, baseX - 6, baseY - 20, 13, 3, shadeDark);
  drawPixelRect(ctx, baseX - 5, baseY - 19, 11, 2, "#f4ead2");
  drawPixelRect(ctx, baseX + 6, baseY - 24, 2, 4, shadeDark);
  drawPixelRect(ctx, baseX - 7, baseY - 26, 4, 1, "#fff7c7");
  drawPixelRect(ctx, baseX - 3, baseY - 17, 7, 2, "rgba(255, 243, 166, 0.5)");
  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 12, baseY - 31, 24, 35);
  }
  ctx.restore();
};

const drawPoster = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const sky = ghost === "invalid" ? "#ff8fa3" : "#78a7ff";
  const skyDark = ghost === "invalid" ? "#d95575" : "#3556a3";
  const sun = ghost === "invalid" ? "#ffd1dc" : "#ffe66d";

  drawPixelRect(ctx, baseX - 16, baseY - 39, 32, 43, "#111624");
  drawPixelRect(ctx, baseX - 14, baseY - 37, 28, 39, "#f4ead2");
  drawPixelRect(ctx, baseX - 12, baseY - 35, 24, 35, "#202638");

  drawPixelRect(ctx, baseX - 11, baseY - 34, 22, 12, sky);
  drawPixelRect(ctx, baseX - 11, baseY - 22, 22, 7, "#9ee6ff");
  drawPixelRect(ctx, baseX - 11, baseY - 15, 22, 14, "#2f6f4e");
  drawPixelRect(ctx, baseX - 11, baseY - 5, 22, 5, "#1b3b33");

  drawPixelRect(ctx, baseX + 4, baseY - 32, 5, 5, sun);
  drawPixelRect(ctx, baseX - 10, baseY - 19, 8, 4, skyDark);
  drawPixelRect(ctx, baseX - 4, baseY - 23, 10, 8, "#4b315f");
  drawPixelRect(ctx, baseX + 3, baseY - 18, 9, 5, "#6d7794");
  drawPixelRect(ctx, baseX - 8, baseY - 10, 6, 9, "#4f8f5f");
  drawPixelRect(ctx, baseX - 1, baseY - 12, 5, 11, "#65a96f");
  drawPixelRect(ctx, baseX + 6, baseY - 9, 4, 8, "#3f7d55");

  drawPixelRect(ctx, baseX - 13, baseY - 36, 26, 1, "#fff7c7");
  drawPixelRect(ctx, baseX - 13, baseY + 1, 26, 1, "#c8af79");
  drawPixelRect(ctx, baseX - 16, baseY - 41, 32, 2, "#6d4c41");
  drawPixelRect(ctx, baseX - 16, baseY + 4, 32, 2, "#6d4c41");
  drawPixelRect(ctx, baseX - 10, baseY - 43, 20, 2, "#302f4f");
  drawPixelRect(ctx, baseX - 1, baseY - 45, 2, 2, "#f4ead2");
  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 18, baseY - 46, 36, 54);
  }
  ctx.restore();
};

const drawSkySentinelPoster = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const skyTop = ghost === "invalid" ? "#ff8fa3" : "#5b8cff";
  const skyMid = ghost === "invalid" ? "#ffd1dc" : "#9ee6ff";
  const sunrise = ghost === "invalid" ? "#fff0f4" : "#ffe66d";
  const city = ghost === "invalid" ? "#732b39" : "#243a68";
  const suit = ghost === "invalid" ? "#d95575" : "#2456b8";
  const cape = ghost === "invalid" ? "#b64c54" : "#d94a4a";
  const dog = ghost === "invalid" ? "#ffc0cf" : "#f7fbff";

  drawPixelRect(ctx, baseX - 16, baseY - 39, 32, 43, "#111624");
  drawPixelRect(ctx, baseX - 14, baseY - 37, 28, 39, "#f4ead2");
  drawPixelRect(ctx, baseX - 12, baseY - 35, 24, 35, "#17213f");

  drawPixelRect(ctx, baseX - 11, baseY - 34, 22, 11, skyTop);
  drawPixelRect(ctx, baseX - 11, baseY - 23, 22, 10, skyMid);
  drawPixelRect(ctx, baseX - 11, baseY - 13, 22, 13, "#345f9f");
  drawPixelRect(ctx, baseX - 3, baseY - 23, 7, 7, sunrise);
  drawPixelRect(ctx, baseX - 5, baseY - 20, 11, 3, "rgba(255, 230, 109, 0.55)");
  drawPixelRect(ctx, baseX - 10, baseY - 30, 5, 1, "#d7f0ff");
  drawPixelRect(ctx, baseX + 4, baseY - 27, 6, 1, "#f7fbff");

  drawPixelRect(ctx, baseX - 10, baseY - 8, 3, 8, city);
  drawPixelRect(ctx, baseX - 6, baseY - 11, 4, 11, "#1c2c54");
  drawPixelRect(ctx, baseX - 1, baseY - 6, 3, 6, city);
  drawPixelRect(ctx, baseX + 3, baseY - 10, 4, 10, "#1c2c54");
  drawPixelRect(ctx, baseX + 8, baseY - 7, 3, 7, city);
  drawPixelRect(ctx, baseX - 9, baseY - 5, 1, 1, sunrise);
  drawPixelRect(ctx, baseX - 4, baseY - 8, 1, 1, sunrise);
  drawPixelRect(ctx, baseX + 5, baseY - 7, 1, 1, sunrise);

  drawPixelRect(ctx, baseX - 3, baseY - 25, 5, 5, "#f4d0a8");
  drawPixelRect(ctx, baseX - 4, baseY - 20, 7, 11, suit);
  drawPixelRect(ctx, baseX + 3, baseY - 20, 4, 10, cape);
  drawPixelRect(ctx, baseX + 6, baseY - 18, 4, 8, cape);
  drawPixelRect(ctx, baseX + 8, baseY - 15, 2, 6, cape);
  drawPixelRect(ctx, baseX + 5, baseY - 11, 4, 4, cape);
  drawPixelRect(ctx, baseX - 1, baseY - 19, 2, 8, "#7fb8ff");
  drawPixelRect(ctx, baseX - 5, baseY - 21, 11, 2, cape);
  drawPixelRect(ctx, baseX - 7, baseY - 18, 3, 2, "#f4d0a8");
  drawPixelRect(ctx, baseX - 9, baseY - 16, 2, 2, "#f4d0a8");
  drawPixelRect(ctx, baseX + 3, baseY - 17, 4, 2, "#f4d0a8");
  drawPixelRect(ctx, baseX - 2, baseY - 8, 2, 5, suit);
  drawPixelRect(ctx, baseX + 1, baseY - 8, 2, 5, suit);
  drawPixelRect(ctx, baseX - 4, baseY - 25, 7, 1, "#302f4f");

  drawPixelRect(ctx, baseX + 5, baseY - 25, 4, 3, dog);
  drawPixelRect(ctx, baseX + 9, baseY - 24, 2, 2, dog);
  drawPixelRect(ctx, baseX + 4, baseY - 24, 2, 1, "#8fb8d8");
  drawPixelRect(ctx, baseX + 6, baseY - 21, 2, 2, "#9ee6ff");
  drawPixelRect(ctx, baseX + 9, baseY - 21, 2, 1, cape);

  drawPixelRect(ctx, baseX - 13, baseY - 36, 26, 1, "#fff7c7");
  drawPixelRect(ctx, baseX - 13, baseY + 1, 26, 1, "#c8af79");
  drawPixelRect(ctx, baseX - 16, baseY - 41, 32, 2, "#243a68");
  drawPixelRect(ctx, baseX - 16, baseY + 4, 32, 2, "#243a68");
  drawPixelRect(ctx, baseX - 10, baseY - 43, 20, 2, "#d94a4a");
  drawPixelRect(ctx, baseX - 1, baseY - 45, 2, 2, "#f4ead2");

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 18, baseY - 46, 36, 54);
  }
  ctx.restore();
};

const drawDigitalWallClock = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const now = new Date();
  const timeText = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
  const glow = ghost === "invalid" ? "#ff8fa3" : "#8df7c4";

  drawPixelRect(ctx, baseX - 18, baseY - 15, 36, 18, "#111624");
  drawPixelRect(ctx, baseX - 16, baseY - 13, 32, 14, "#2d241f");
  drawPixelRect(ctx, baseX - 14, baseY - 11, 28, 10, "#0f1422");
  drawPixelRect(ctx, baseX - 13, baseY - 10, 26, 1, "#263b4a");
  drawPixelRect(ctx, baseX - 13, baseY - 2, 26, 1, "#263b4a");
  drawPixelRect(ctx, baseX - 15, baseY - 14, 30, 1, "#6f4b2a");
  drawPixelText(ctx, timeText, baseX - 13, baseY - 9, glow);
  drawPixelRect(ctx, baseX - 2, baseY - 18, 4, 3, "#111624");
  drawPixelRect(ctx, baseX - 1, baseY - 17, 2, 2, "#f4ead2");

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 20, baseY - 19, 40, 24);
  }
  ctx.restore();
};

const drawGameConsole = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  frame = 0,
  avatar?: AvatarRuntime,
  playingOverride = false,
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const playing =
    ghost === "none" &&
    (playingOverride ||
      (avatar?.behavior === "play" &&
        Math.hypot(avatar.x - baseX, avatar.y - baseY) < 24));
  const screen = ghost === "invalid" ? "#ff8fa3" : playing ? "#1bffd2" : "#8df7c4";

  drawPixelRect(ctx, baseX - 21, baseY - 20, 42, 18, "#0b0d10");
  drawPixelRect(ctx, baseX - 20, baseY - 19, 7, 16, ghost === "invalid" ? "#ff8fa3" : "#2ca8ff");
  drawPixelRect(ctx, baseX + 13, baseY - 19, 7, 16, ghost === "invalid" ? "#ff8fa3" : "#ff5c5c");
  drawPixelRect(ctx, baseX - 13, baseY - 19, 26, 16, "#111624");
  drawPixelRect(ctx, baseX - 12, baseY - 18, 24, 14, "#263b4a");
  drawPixelRect(ctx, baseX - 10, baseY - 17, 20, 12, screen);
  drawPixelRect(ctx, baseX - 9, baseY - 16, 13, 2, "#d8fff7");
  if (playing) {
    const pulse = Math.floor(frame / 5) % 4;
    drawPixelRect(ctx, baseX - 9 + pulse * 3, baseY - 14, 3, 2, "#ffe66d");
    drawPixelRect(ctx, baseX + 4 - pulse * 2, baseY - 11, 4, 2, "#ff5c7a");
    drawPixelRect(ctx, baseX - 8, baseY - 8 + (pulse % 2), 16, 1, "#141823");
    drawPixelRect(ctx, baseX - 6 + (Math.floor(frame / 3) % 10), baseY - 15, 1, 1, "#ffffff");
  }
  drawPixelRect(ctx, baseX - 19, baseY - 16, 3, 3, "#111624");
  drawPixelRect(ctx, baseX - 18, baseY - 15, 1, 1, "#d8fff7");
  drawPixelRect(ctx, baseX - 17, baseY - 8, 2, 2, "#111624");
  drawPixelRect(ctx, baseX + 16, baseY - 16, 2, 2, "#111624");
  drawPixelRect(ctx, baseX + 15, baseY - 10, 2, 2, "#111624");
  drawPixelRect(ctx, baseX + 18, baseY - 10, 1, 1, "#f4ead2");
  drawPixelRect(ctx, baseX - 15, baseY - 2, 30, 3, "#302f4f");
  drawPixelRect(ctx, baseX - 8, baseY + 1, 16, 2, "#111624");

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 21, baseY - 25, 42, 33);
  }
  ctx.restore();
};

const drawRecordPlayer = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  frame = 0,
  avatar?: AvatarRuntime,
  recordPlayerPlaying = false,
) => {
  void avatar;
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const playing = ghost === "none" && recordPlayerPlaying;
  const pulse = Math.floor(frame / 6) % 4;
  const spinPhase = playing ? Math.floor(frame / 4) % 4 : 0;
  const recordHighlight = playing
    ? ["#ffe66d", "#9ee6ff", "#ff8fa3", "#b4f56c"][pulse]
    : "#2f3648";

  drawPixelRect(ctx, baseX - 23, baseY - 18, 46, 24, "#111624");
  drawPixelRect(
    ctx,
    baseX - 21,
    baseY - 20,
    42,
    23,
    ghost === "invalid" ? "#7d3144" : "#6d4c41",
  );
  drawPixelRect(
    ctx,
    baseX - 18,
    baseY - 17,
    36,
    17,
    ghost === "invalid" ? "#ff8fa3" : "#9a6a4c",
  );
  drawPixelRect(ctx, baseX - 20, baseY + 1, 40, 6, "#3b2430");
  drawPixelRect(ctx, baseX - 17, baseY + 3, 34, 2, "#4a2b3a");
  drawPixelRect(ctx, baseX + 14, baseY + 2, 4, 4, "#111624");
  drawPixelRect(ctx, baseX + 15, baseY + 3, 2, 2, playing ? "#ff304f" : "#5a1f2c");
  if (playing) {
    drawPixelRect(ctx, baseX + 15, baseY + 3, 1, 1, "#ffd1dc");
  }
  drawPixelRect(ctx, baseX - 15, baseY + 7, 5, 4, "#111624");
  drawPixelRect(ctx, baseX + 10, baseY + 7, 5, 4, "#111624");
  drawPixelRect(ctx, baseX - 14, baseY + 6, 3, 2, "#273044");
  drawPixelRect(ctx, baseX + 11, baseY + 6, 3, 2, "#273044");

  const recordY = baseY - 4;
  drawPixelRect(ctx, baseX - 8, recordY - 12, 16, 2, "#0b0d10");
  drawPixelRect(ctx, baseX - 13, recordY - 10, 26, 2, "#0b0d10");
  drawPixelRect(ctx, baseX - 16, recordY - 8, 32, 4, "#0b0d10");
  drawPixelRect(ctx, baseX - 16, recordY - 4, 32, 4, "#0b0d10");
  drawPixelRect(ctx, baseX - 13, recordY, 26, 2, "#0b0d10");
  drawPixelRect(ctx, baseX - 8, recordY + 2, 16, 2, "#0b0d10");

  drawPixelRect(ctx, baseX - 6, recordY - 9, 12, 1, "#273044");
  drawPixelRect(ctx, baseX - 10, recordY - 8, 20, 2, "#273044");
  drawPixelRect(ctx, baseX - 11, recordY - 6, 22, 4, "#273044");
  drawPixelRect(ctx, baseX - 9, recordY - 2, 18, 1, "#273044");
  drawPixelRect(ctx, baseX - 6, recordY - 1, 12, 1, "#273044");

  if (playing) {
    const spinStreaks = [
      [
        { x: -10, y: -8, width: 8 },
        { x: 3, y: -5, width: 7 },
        { x: -5, y: -2, width: 10 },
      ],
      [
        { x: -2, y: -9, width: 10 },
        { x: -11, y: -5, width: 8 },
        { x: 4, y: -2, width: 6 },
      ],
      [
        { x: 2, y: -8, width: 8 },
        { x: -10, y: -5, width: 7 },
        { x: -5, y: -1, width: 10 },
      ],
      [
        { x: -9, y: -9, width: 7 },
        { x: 2, y: -6, width: 10 },
        { x: -11, y: -3, width: 6 },
      ],
    ][spinPhase];
    spinStreaks.forEach((streak, index) => {
      drawPixelRect(
        ctx,
        baseX + streak.x,
        recordY + streak.y,
        streak.width,
        1,
        index === 0 ? recordHighlight : "#465068",
      );
    });
  }

  drawPixelRect(ctx, baseX - 4, recordY - 7, 8, 6, "#111624");
  drawPixelRect(ctx, baseX - 2, recordY - 5, 4, 3, "#273044");
  drawPixelRect(ctx, baseX - 1, recordY - 4, 2, 1, "#f4ead2");
  if (playing) {
    const labelGlints = [
      { x: -2, y: -6 },
      { x: 1, y: -6 },
      { x: 1, y: -3 },
      { x: -2, y: -3 },
    ];
    const glint = labelGlints[spinPhase];
    drawPixelRect(ctx, baseX + glint.x, recordY + glint.y, 1, 1, "#fff8df");
  }
  if (playing) {
    drawPixelRect(ctx, baseX - 11 + pulse, recordY - 9 + pulse, 7, 1, recordHighlight);
    drawPixelRect(
      ctx,
      baseX + 4 - pulse,
      recordY - 3 - Math.min(pulse, 2),
      7,
      1,
      recordHighlight,
    );
  } else {
    drawPixelRect(ctx, baseX - 10, recordY - 10, 9, 1, "#465068");
  }

  drawPixelRect(ctx, baseX + 9, recordY - 14, 10, 3, "#d7caa8");
  drawPixelRect(ctx, baseX + 15, recordY - 12, 3, 11, "#8f8270");
  drawPixelRect(ctx, baseX + 10, recordY - 4, 8, 3, "#d7caa8");
  drawPixelRect(ctx, baseX + 7, recordY - 5, 4, 2, "#f4ead2");
  drawPixelRect(ctx, baseX + 12, recordY - 16, 5, 2, "#ffe66d");

  if (playing) {
    const noteY = baseY - 32 + (pulse % 2);
    drawPixelRect(ctx, baseX + 21, noteY, 2, 9, "#ffe66d");
    drawPixelRect(ctx, baseX + 18, noteY + 7, 5, 4, "#ffe66d");
    drawPixelRect(ctx, baseX + 27, noteY - 5, 2, 8, "#9ee6ff");
    drawPixelRect(ctx, baseX + 24, noteY + 1, 5, 4, "#9ee6ff");
  }

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 24, baseY - 29, 48, 36);
  }
  ctx.restore();
};

const drawOilEasel = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  frame = 0,
  avatar?: AvatarRuntime,
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const painting =
    ghost === "none" &&
    avatar?.behavior === "paint" &&
    Math.hypot(avatar.x - baseX, avatar.y - baseY) < 30;
  const wood = ghost === "invalid" ? "#ff8fa3" : "#b86c2f";
  const woodLight = ghost === "invalid" ? "#ffd1dc" : "#d58a42";
  const woodDark = ghost === "invalid" ? "#d95575" : "#5b2a10";
  const woodDeep = "#2d1a12";
  const brass = ghost === "invalid" ? "#ffd1dc" : "#d6a94f";
  const paintTray = ghost === "invalid" ? "#ff8fa3" : "#3a2430";
  const canvas = ghost === "invalid" ? "#ffd1dc" : "#fff8df";
  const canvasShade = ghost === "invalid" ? "#ff8fa3" : "#dfd7c4";
  const canvasShadow = ghost === "invalid" ? "#d95575" : "#c6baa2";
  const paintPulse = Math.floor(frame / 8) % 4;

  drawPixelRect(ctx, baseX - 26, baseY + 4, 54, 5, "rgba(17, 22, 36, 0.34)");
  drawPixelRect(ctx, baseX - 17, baseY + 7, 37, 2, "rgba(17, 22, 36, 0.18)");

  const strokeBeam = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: string,
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(baseX + x1, baseY + y1);
    ctx.lineTo(baseX + x2, baseY + y2);
    ctx.stroke();
  };

  strokeBeam(-2, -55, -26, 5, 5, woodDeep);
  strokeBeam(8, -52, 24, 5, 5, woodDeep);
  strokeBeam(0, -47, 0, 8, 4, woodDeep);
  strokeBeam(15, -41, -18, 5, 3, woodDeep);

  strokeBeam(-2, -55, -25, 5, 2, wood);
  strokeBeam(8, -52, 23, 5, 2, wood);
  strokeBeam(0, -47, 0, 8, 2, wood);
  strokeBeam(15, -41, -18, 5, 1, wood);
  strokeBeam(-4, -47, -24, 3, 1, woodLight);
  strokeBeam(10, -45, 22, 2, 1, woodLight);

  drawPixelRect(ctx, baseX - 24, baseY - 3, 50, 5, woodDeep);
  drawPixelRect(ctx, baseX - 22, baseY - 4, 47, 3, wood);
  drawPixelRect(ctx, baseX - 19, baseY - 4, 14, 2, woodLight);
  drawPixelRect(ctx, baseX + 10, baseY - 4, 10, 2, woodLight);
  drawPixelRect(ctx, baseX - 18, baseY - 29, 41, 5, woodDeep);
  drawPixelRect(ctx, baseX - 17, baseY - 30, 39, 3, wood);
  drawPixelRect(ctx, baseX - 14, baseY - 30, 9, 2, woodLight);

  drawPixelRect(ctx, baseX - 4, baseY - 64, 8, 7, woodDeep);
  drawPixelRect(ctx, baseX - 2, baseY - 66, 6, 11, wood);
  drawPixelRect(ctx, baseX - 1, baseY - 65, 2, 9, woodLight);
  drawPixelRect(ctx, baseX + 2, baseY - 63, 2, 5, woodDark);
  drawPixelRect(ctx, baseX - 15, baseY - 54, 31, 5, woodDeep);
  drawPixelRect(ctx, baseX - 13, baseY - 55, 28, 3, wood);
  drawPixelRect(ctx, baseX - 10, baseY - 55, 12, 2, woodLight);
  drawPixelRect(ctx, baseX - 1, baseY - 56, 4, 4, brass);
  drawPixelRect(ctx, baseX, baseY - 55, 2, 2, "#fff2a8");

  drawPixelRect(ctx, baseX - 9, baseY - 48, 21, 4, woodDeep);
  drawPixelRect(ctx, baseX - 8, baseY - 49, 20, 2, woodLight);

  const canvasX = baseX - 16;
  const canvasY = baseY - 54;
  drawPixelRect(ctx, canvasX - 2, canvasY - 1, 42, 44, woodDeep);
  drawPixelRect(ctx, canvasX, canvasY, 37, 41, canvasShadow);
  drawPixelRect(ctx, canvasX + 1, canvasY + 1, 35, 39, canvas);
  drawPixelRect(ctx, canvasX + 3, canvasY + 3, 30, 35, "#fffdf0");
  drawPixelRect(ctx, canvasX + 4, canvasY + 4, 28, 1, "#fff7cf");
  drawPixelRect(ctx, canvasX + 4, canvasY + 5, 1, 31, "#ffffff");
  drawPixelRect(ctx, canvasX + 34, canvasY + 3, 3, 37, canvasShade);
  drawPixelRect(ctx, canvasX + 4, canvasY + 37, 31, 3, canvasShade);
  drawPixelRect(ctx, canvasX + 2, canvasY + 1, 4, 39, "#ffffff");
  drawPixelRect(ctx, canvasX + 7, canvasY + 7, 11, 4, "#bfeaff");
  drawPixelRect(ctx, canvasX + 19, canvasY + 7, 11, 2, "#e7f7ff");
  drawPixelRect(ctx, canvasX + 20, canvasY + 9, 9, 3, "#c9f0ff");
  drawPixelRect(ctx, canvasX + 5, canvasY + 22, 27, 8, "#b9d987");
  drawPixelRect(ctx, canvasX + 6, canvasY + 25, 26, 3, "#8fbe74");
  drawPixelRect(ctx, canvasX + 8, canvasY + 18, 9, 6, "#78a76d");
  drawPixelRect(ctx, canvasX + 18, canvasY + 16, 10, 9, "#8dc07a");
  drawPixelRect(ctx, canvasX + 21, canvasY + 18, 6, 5, "#679a63");
  drawPixelRect(ctx, canvasX + 10, canvasY + 12, 3, 3, "#ffe66d");
  drawPixelRect(ctx, canvasX + 13, canvasY + 13, 2, 2, "#ffd16a");
  drawPixelRect(ctx, canvasX + 9, canvasY + 11, 7, 1, "#fff2a8");
  drawPixelRect(ctx, canvasX + 6, canvasY + 31, 24, 2, "#7b8f65");
  drawPixelRect(ctx, canvasX + 8, canvasY + 34, 18, 2, "#6b7e5e");
  drawPixelRect(ctx, canvasX + 7, canvasY + 8, 10, 1, "#f0eadc");
  drawPixelRect(ctx, canvasX + 10, canvasY + 15, 7, 1, "#8a7f76");
  drawPixelRect(ctx, canvasX + 23, canvasY + 10, 8, 1, "#eee5d4");
  drawPixelRect(ctx, canvasX + 25, canvasY + 25, 7, 1, "#7e9b6a");
  drawPixelRect(ctx, canvasX + 14, canvasY + 27, 4, 2, "#fffdf0");
  drawPixelRect(ctx, canvasX + 22, canvasY + 29, 5, 2, "#fffdf0");
  drawPixelRect(ctx, canvasX + 2, canvasY + 2, 2, 2, brass);
  drawPixelRect(ctx, canvasX + 32, canvasY + 2, 2, 2, brass);
  drawPixelRect(ctx, canvasX + 2, canvasY + 36, 2, 2, brass);
  drawPixelRect(ctx, canvasX + 32, canvasY + 36, 2, 2, brass);
  if (painting) {
    drawPixelRect(ctx, canvasX + 8 + paintPulse * 3, canvasY + 8 + paintPulse, 5, 3, "#5ce1e6");
    drawPixelRect(ctx, canvasX + 15 + paintPulse, canvasY + 16, 4, 3, "#d95d75");
    drawPixelRect(ctx, canvasX + 24, canvasY + 25 - paintPulse, 5, 3, "#ffe66d");
    drawPixelRect(ctx, canvasX + 18 + paintPulse, canvasY + 30 - paintPulse, 3, 2, "#ff8fa3");
  }

  drawPixelRect(ctx, baseX - 3, baseY - 9, 6, 13, woodDeep);
  drawPixelRect(ctx, baseX - 1, baseY - 10, 3, 14, wood);
  drawPixelRect(ctx, baseX, baseY - 9, 1, 11, woodLight);
  drawPixelRect(ctx, baseX - 14, baseY - 10, 29, 5, paintTray);
  drawPixelRect(ctx, baseX - 12, baseY - 11, 25, 2, woodLight);
  drawPixelRect(ctx, baseX - 9, baseY - 8, 4, 2, "#5ce1e6");
  drawPixelRect(ctx, baseX - 2, baseY - 8, 4, 2, "#d95d75");
  drawPixelRect(ctx, baseX + 5, baseY - 8, 4, 2, "#ffe66d");
  drawPixelRect(ctx, baseX - 25, baseY + 4, 9, 4, woodDark);
  drawPixelRect(ctx, baseX + 18, baseY + 4, 9, 4, woodDark);

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 26, baseY - 68, 54, 76);
  }
  ctx.restore();
};

const drawTerminalMonitor = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  frame = 0,
  avatar?: AvatarRuntime,
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const screen = ghost === "invalid" ? "#ff8fa3" : "#8df7c4";
  const active =
    ghost === "none" &&
    (avatar?.behavior === "coding" || avatar?.behavior === "thinking") &&
    Math.hypot(avatar.x - baseX, avatar.y - (baseY + 18)) < 92;
  const blink = Math.floor(frame / 7) % 4;
  const tap = Math.floor(frame / 4) % 2;

  drawPixelRect(ctx, baseX - 18, baseY - 32, 36, 27, "#e4dfc4");
  drawPixelRect(ctx, baseX - 15, baseY - 29, 30, 21, "#b8ad93");
  drawPixelRect(ctx, baseX - 13, baseY - 27, 26, 17, "#756957");
  drawPixelRect(ctx, baseX - 12, baseY - 26, 24, 15, ghost === "invalid" ? screen : "#3349ff");
  drawPixelRect(ctx, baseX - 11, baseY - 25, 22, 2, active ? "#b8fff2" : "#9ee6ff");
  drawPixelRect(ctx, baseX - 10, baseY - 20, 8 + (active ? blink : 0), 2, "#9ee6ff");
  drawPixelRect(ctx, baseX + 2, baseY - 20, 8, 2, active ? "#eaffd0" : "#9ee6ff");
  drawPixelRect(ctx, baseX - 10, baseY - 15, 7, 2, "#9ee6ff");
  drawPixelRect(ctx, baseX + 3, baseY - 15, 7 - (active && blink === 3 ? 3 : 0), 2, "#9ee6ff");
  if (active) {
    drawPixelRect(ctx, baseX - 11, baseY - 23 + blink, 22, 1, "#78a7ff");
    drawPixelRect(ctx, baseX + 7 + blink, baseY - 13, 2, 2, "#ffe66d");
  }
  drawPixelRect(ctx, baseX - 6, baseY - 7, 12, 3, "#8f8270");
  drawPixelRect(ctx, baseX - 11, baseY - 4, 22, 4, "#e4dfc4");
  drawPixelRect(ctx, baseX - 17, baseY, 34, 4, "#d2c8ad");
  drawPixelRect(ctx, baseX - 14, baseY + 1, 10, 2, "#f2eed8");
  drawPixelRect(ctx, baseX + 5, baseY + 1, 8, 1, "#24462d");

  drawPixelRect(ctx, baseX - 20, baseY + 5, 40, 7, "#8f8270");
  drawPixelRect(ctx, baseX - 18, baseY + 4, 36, 6, "#d2c8ad");
  drawPixelRect(ctx, baseX - 16, baseY + 5, 32, 2, "#f2eed8");
  drawPixelRect(ctx, baseX - 17, baseY + 10, 34, 2, "#756957");
  for (let keyX = baseX - 15; keyX <= baseX + 12; keyX += 4) {
    const keyActive = active && (keyX + tap * 8 + frame) % 12 === 0;
    drawPixelRect(
      ctx,
      keyX,
      baseY + 6 + (keyActive ? 1 : 0),
      2,
      2,
      keyActive ? "#ffe66d" : "#f2eed8",
    );
    drawPixelRect(ctx, keyX + 1, baseY + 8, 2, 1, keyActive ? "#78a7ff" : "#8f8270");
  }

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 21, baseY - 35, 42, 50);
  }

  ctx.restore();
};

const drawCoffeeMachine = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  frame = 0,
  brewing = false,
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const accent = ghost === "invalid" ? "#ff8fa3" : "#8df7c4";
  const highlight = ghost === "valid" ? "#ffe66d" : "#edf2f4";
  const pulseOn = brewing && Math.floor(frame / 6) % 2 === 0;
  const dripPhase = brewing ? frame % 12 : 0;
  const brewAccent = pulseOn ? "#b4f56c" : accent;

  drawPixelRect(ctx, baseX - 24, baseY - 44, 50, 48, "#0b0d10");
  drawPixelRect(ctx, baseX - 22, baseY - 47, 44, 4, "#050608");
  drawPixelRect(ctx, baseX - 22, baseY - 42, 36, 39, "#343637");
  drawPixelRect(ctx, baseX + 15, baseY - 42, 9, 39, "#26282a");
  drawPixelRect(ctx, baseX + 13, baseY - 35, 3, 32, "#121416");
  drawPixelRect(ctx, baseX + 19, baseY - 28, 2, 13, "#111315");
  drawPixelRect(ctx, baseX + 22, baseY - 42, 4, 39, "#0a0b0d");
  drawPixelRect(ctx, baseX - 23, baseY - 43, 45, 1, "#4e5050");
  drawPixelRect(ctx, baseX - 20, baseY - 33, 37, 2, "#222426");
  drawPixelRect(ctx, baseX - 22, baseY + 4, 48, 6, "#202325");
  drawPixelRect(ctx, baseX - 20, baseY + 10, 10, 4, "#0b0d10");
  drawPixelRect(ctx, baseX + 14, baseY + 10, 10, 4, "#0b0d10");

  drawPixelRect(ctx, baseX - 27, baseY - 37, 4, 9, "#0b0d10");
  drawPixelRect(ctx, baseX - 30, baseY - 22, 20, 8, "#0b0d10");
  drawPixelRect(ctx, baseX - 28, baseY - 23, 18, 7, "#a55307");
  drawPixelRect(ctx, baseX - 27, baseY - 22, 17, 3, "#c06a10");
  drawPixelRect(ctx, baseX - 18, baseY - 17, 8, 2, "#7b3905");
  drawPixelRect(ctx, baseX - 8, baseY - 20, 9, 2, "#153847");
  drawPixelRect(ctx, baseX - 9, baseY - 19, 11, 2, "#18729a");

  drawPixelRect(ctx, baseX - 19, baseY - 39, 4, 2, "#131517");
  drawPixelRect(ctx, baseX - 14, baseY - 39, 4, 2, "#141618");
  drawPixelRect(ctx, baseX - 18, baseY - 37, 6, 4, "#0a5e82");
  drawPixelRect(ctx, baseX - 10, baseY - 38, 3, 2, "#1c1f21");
  drawPixelRect(ctx, baseX - 5, baseY - 39, 5, 2, "#151719");
  drawPixelRect(ctx, baseX + 1, baseY - 39, 4, 2, "#121416");
  drawPixelRect(ctx, baseX - 4, baseY - 37, 7, 4, "#0a5e82");
  drawPixelRect(ctx, baseX + 10, baseY - 39, 7, 8, "#141618");
  drawPixelRect(ctx, baseX + 12, baseY - 37, 5, 6, brewAccent);
  drawPixelRect(ctx, baseX - 6, baseY - 30, 20, 2, pulseOn ? "#f23b32" : "#990f12");
  drawPixelRect(ctx, baseX + 16, baseY - 30, 2, 2, pulseOn ? "#fffda8" : "#fff235");

  drawPixelRect(ctx, baseX - 10, baseY - 24, 22, 9, "#202426");
  drawPixelRect(ctx, baseX - 8, baseY - 23, 18, 7, "#aeb5b2");
  drawPixelRect(ctx, baseX - 7, baseY - 22, 17, 3, highlight);
  drawPixelRect(ctx, baseX + 9, baseY - 20, 3, 4, "#575e5f");
  drawPixelRect(ctx, baseX - 5, baseY - 15, 14, 3, "#2f3335");
  drawPixelRect(ctx, baseX - 2, baseY - 13, 8, 5, "#777d7c");
  drawPixelRect(ctx, baseX - 1, baseY - 8, 6, 3, "#242729");
  drawPixelRect(ctx, baseX - 7, baseY - 11, 16, 2, "#c8ccc6");

  if (brewing) {
    const streamHeight = 5 + Math.floor(dripPhase / 4);
    drawPixelRect(ctx, baseX + 1, baseY - 8, 2, streamHeight, "#6f3a20");
    drawPixelRect(ctx, baseX + 2, baseY - 7, 1, Math.max(2, streamHeight - 1), "#d07a2c");
    if (dripPhase > 7) {
      drawPixelRect(ctx, baseX + 1, baseY - 1, 2, 2, "#d07a2c");
    }
  }

  drawPixelRect(ctx, baseX - 5, baseY - 5, 12, 5, "#743b12");
  drawPixelRect(ctx, baseX - 3, baseY - 3, 10, 9, "#e0a151");
  drawPixelRect(ctx, baseX - 2, baseY - 2, 9, 3, "#ffd08a");
  if (brewing) {
    drawPixelRect(ctx, baseX - 1, baseY - 1, 7, 2, "#7b3905");
    drawPixelRect(ctx, baseX, baseY, 5, 1, "#d07a2c");
    drawPixelRect(ctx, baseX - 4 + (dripPhase % 3), baseY - 9, 1, 3, "#edf2f4");
    drawPixelRect(ctx, baseX + 7 - (dripPhase % 2), baseY - 11, 1, 2, "#cfd8dc");
  }
  drawPixelRect(ctx, baseX + 4, baseY + 1, 4, 2, "#f0b865");
  drawPixelRect(ctx, baseX - 4, baseY + 2, 3, 4, "#8c4a16");

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 31, baseY - 48, 58, 63);
  }

  ctx.restore();
};

const drawCoffeeCup = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  hasCoffee = false,
  frame = 0,
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const outline = ghost === "valid" ? "#ffe66d" : "#111624";
  const glass = ghost === "invalid" ? "#ffd1dc" : "#dff7ff";
  const glassLight = ghost === "invalid" ? "#ffe0e8" : "#f5fdff";
  const glassShade = ghost === "invalid" ? "#ff8fa3" : "#8fc4d6";
  const glassDeepShade = ghost === "invalid" ? "#d95575" : "#5e91a8";
  const coffee = ghost === "invalid" ? "#d95575" : "#8c4a16";
  const coffeeLight = ghost === "invalid" ? "#ffc0cf" : "#c48650";
  const coffeeDark = ghost === "invalid" ? "#a73555" : "#5b2a10";

  drawPixelRect(ctx, baseX - 10, baseY + 2, 22, 2, "rgba(17, 22, 36, 0.32)");
  drawPixelRect(ctx, baseX - 6, baseY + 4, 13, 1, "rgba(17, 22, 36, 0.22)");

  drawPixelRect(ctx, baseX - 10, baseY, 23, 2, outline);
  drawPixelRect(ctx, baseX - 8, baseY - 1, 19, 1, outline);
  drawPixelRect(ctx, baseX - 7, baseY - 2, 17, 1, glassShade);
  drawPixelRect(ctx, baseX - 9, baseY + 1, 21, 2, "rgba(223, 247, 255, 0.72)");
  drawPixelRect(ctx, baseX - 6, baseY + 2, 14, 1, glassLight);
  drawPixelRect(ctx, baseX + 7, baseY + 1, 4, 1, glassShade);

  drawPixelRect(ctx, baseX - 5, baseY - 15, 11, 1, outline);
  drawPixelRect(ctx, baseX - 8, baseY - 14, 17, 1, outline);
  drawPixelRect(ctx, baseX - 9, baseY - 13, 19, 2, outline);
  drawPixelRect(ctx, baseX - 8, baseY - 12, 3, 1, outline);
  drawPixelRect(ctx, baseX - 5, baseY - 11, 11, 1, outline);
  drawPixelRect(ctx, baseX + 6, baseY - 12, 3, 1, outline);
  drawPixelRect(ctx, baseX - 8, baseY - 10, 17, 8, outline);
  drawPixelRect(ctx, baseX - 6, baseY - 2, 13, 2, outline);
  drawPixelRect(ctx, baseX - 4, baseY, 9, 1, outline);

  drawPixelRect(ctx, baseX - 4, baseY - 14, 9, 1, glassLight);
  drawPixelRect(ctx, baseX - 7, baseY - 13, 15, 1, "rgba(223, 247, 255, 0.78)");
  drawPixelRect(ctx, baseX - 8, baseY - 12, 17, 1, glassLight);
  drawPixelRect(ctx, baseX - 6, baseY - 11, 13, 1, "rgba(223, 247, 255, 0.72)");
  drawPixelRect(ctx, baseX - 7, baseY - 10, 15, 8, "rgba(223, 247, 255, 0.34)");
  drawPixelRect(ctx, baseX - 5, baseY - 2, 11, 2, "rgba(223, 247, 255, 0.54)");
  drawPixelRect(ctx, baseX - 3, baseY, 7, 1, glassShade);
  drawPixelRect(ctx, baseX + 5, baseY - 8, 3, 7, "rgba(143, 196, 214, 0.58)");
  drawPixelRect(ctx, baseX + 7, baseY - 7, 1, 5, glassDeepShade);
  drawPixelRect(ctx, baseX - 6, baseY - 8, 2, 6, "rgba(245, 253, 255, 0.76)");
  drawPixelRect(ctx, baseX - 4, baseY - 10, 1, 1, glassLight);

  drawPixelRect(ctx, baseX + 9, baseY - 10, 5, 2, outline);
  drawPixelRect(ctx, baseX + 13, baseY - 8, 2, 7, outline);
  drawPixelRect(ctx, baseX + 9, baseY - 1, 5, 2, outline);
  drawPixelRect(ctx, baseX + 10, baseY - 8, 3, 1, glassLight);
  drawPixelRect(ctx, baseX + 10, baseY - 2, 3, 1, glass);
  drawPixelRect(ctx, baseX + 12, baseY - 7, 1, 5, glassLight);
  drawPixelRect(ctx, baseX + 13, baseY - 6, 1, 4, glassShade);

  if (hasCoffee) {
    drawPixelRect(ctx, baseX - 6, baseY - 13, 13, 1, coffee);
    drawPixelRect(ctx, baseX - 7, baseY - 12, 15, 1, coffee);
    drawPixelRect(ctx, baseX - 5, baseY - 11, 11, 1, "#6f3513");
    drawPixelRect(ctx, baseX - 4, baseY - 13, 5, 1, coffeeLight);
    drawPixelRect(ctx, baseX + 3, baseY - 12, 3, 1, coffeeLight);
    drawPixelRect(ctx, baseX - 8, baseY - 12, 3, 1, outline);
    drawPixelRect(ctx, baseX - 5, baseY - 11, 11, 1, outline);
    drawPixelRect(ctx, baseX + 6, baseY - 12, 3, 1, outline);
    drawPixelRect(ctx, baseX - 7, baseY - 10, 15, 1, coffeeLight);
    drawPixelRect(ctx, baseX - 7, baseY - 9, 15, 5, coffee);
    drawPixelRect(ctx, baseX - 6, baseY - 4, 13, 2, coffeeDark);
    drawPixelRect(ctx, baseX - 5, baseY - 8, 4, 2, coffeeLight);
    drawPixelRect(ctx, baseX + 4, baseY - 9, 3, 4, "#6f3513");
    drawPixelRect(ctx, baseX - 7, baseY - 10, 1, 8, glassLight);
    drawPixelRect(ctx, baseX + 7, baseY - 10, 1, 8, glassShade);
    if (ghost === "none") {
      const steamColumns = [
        { x: -5, delay: 0, height: 4 },
        { x: 1, delay: 18, height: 5 },
        { x: 5, delay: 34, height: 3 },
      ];

      for (const steam of steamColumns) {
        const phase = (frame + steam.delay) % 72;
        const rise = Math.floor(phase / 14);
        const sway = phase < 36 ? 0 : 1;
        const alpha = phase < 14 || phase > 60 ? 0.3 : 0.62;
        const steamColor = `rgba(245, 253, 255, ${alpha})`;
        drawPixelRect(
          ctx,
          baseX + steam.x + sway,
          baseY - 19 - rise,
          1,
          steam.height,
          steamColor,
        );
        if (phase > 16 && phase < 56) {
          drawPixelRect(
            ctx,
            baseX + steam.x + sway + 1,
            baseY - 23 - rise,
            2,
            2,
            `rgba(223, 247, 255, ${alpha})`,
          );
        }
      }
    }
  } else {
    drawPixelRect(ctx, baseX - 6, baseY - 13, 13, 1, "#e5d6c2");
    drawPixelRect(ctx, baseX - 7, baseY - 12, 15, 1, "rgba(245, 253, 255, 0.7)");
    drawPixelRect(ctx, baseX - 5, baseY - 11, 11, 1, glassLight);
    drawPixelRect(ctx, baseX - 8, baseY - 12, 3, 1, outline);
    drawPixelRect(ctx, baseX - 5, baseY - 11, 11, 1, outline);
    drawPixelRect(ctx, baseX + 6, baseY - 12, 3, 1, outline);
    drawPixelRect(ctx, baseX + 4, baseY - 12, 3, 2, glassShade);
  }

  drawPixelRect(ctx, baseX - 6, baseY - 6, 2, 4, "rgba(255, 255, 255, 0.42)");
  drawPixelRect(ctx, baseX - 3, baseY - 1, 7, 1, glassDeepShade);

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 11, baseY - 24, 28, 28);
  }
  ctx.restore();
};

const drawPlaceableItem = (
  ctx: CanvasRenderingContext2D,
  itemId: string,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  frame = 0,
  avatar?: AvatarRuntime,
  brewing = false,
  coffeeCupHasCoffee = false,
  taskFileCount = 0,
  failedTaskFileCount = 0,
  gameConsolePlaying = false,
  recordPlayerPlaying = false,
) => {
  switch (itemId) {
    case "cozy-rug":
      drawCozyRug(ctx, x, y, ghost);
      return;
    case "morph-blob-rug":
      drawMorphBlobRug(ctx, x, y, ghost);
      return;
    case "blue-persian-rug":
      drawBluePersianRug(ctx, x, y, ghost);
      return;
    case "desk-lamp":
      drawDeskLamp(ctx, x, y, ghost);
      return;
    case "poster":
      drawPoster(ctx, x, y, ghost);
      return;
    case "sky-sentinel-poster":
      drawSkySentinelPoster(ctx, x, y, ghost);
      return;
    case "digital-wall-clock":
      drawDigitalWallClock(ctx, x, y, ghost);
      return;
    case "game-console":
      drawGameConsole(ctx, x, y, ghost, frame, avatar, gameConsolePlaying);
      return;
    case "record-player":
      drawRecordPlayer(ctx, x, y, ghost, frame, avatar, recordPlayerPlaying);
      return;
    case "oil-easel":
      drawOilEasel(ctx, x, y, ghost, frame, avatar);
      return;
    case "terminal-monitor":
      drawTerminalMonitor(ctx, x, y, ghost, frame, avatar);
      return;
    case "coffee-machine":
      drawCoffeeMachine(ctx, x, y, ghost, frame, brewing);
      return;
    case "coffee-cup":
      drawCoffeeCup(ctx, x, y, ghost, coffeeCupHasCoffee, frame);
      return;
    case "file-cabinet":
      drawPlaceableFileCabinet(
        ctx,
        x,
        y,
        ghost,
        frame,
        taskFileCount,
        failedTaskFileCount,
      );
      return;
    default:
      drawTinyPlant(ctx, x, y, ghost);
  }
};

const isFloorUnderlayItem = (itemId: string) =>
  itemId === "cozy-rug" ||
  itemId === "morph-blob-rug" ||
  itemId === "blue-persian-rug";

const itemDefinitionById = (content: AivatarContent, itemId: string) =>
  content.itemDefinitions.find((candidate) => candidate.id === itemId);

const isWallPlacedItem = (content: AivatarContent, item: PlacedItem) => {
  const definition = itemDefinitionById(content, item.itemId);
  return Boolean(definition && getItemPlacementKind(definition) === "wall");
};

const drawPlacedItemHighlight = (
  ctx: CanvasRenderingContext2D,
  item: PlacedItem,
) => {
  const bounds = placedItemBounds(item);

  ctx.strokeStyle = "#ffe66d";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    Math.round(bounds.x - 2),
    Math.round(bounds.y - 2),
    Math.round(bounds.width + 4),
    Math.round(bounds.height + 4),
  );
};

const avatarFootprintTouchesPoint = (
  avatar: AvatarRuntime,
  point: { x: number; y: number },
) =>
  point.x >= avatar.x - 7 &&
  point.x <= avatar.x + 7 &&
  point.y >= avatar.y + 4 &&
  point.y <= avatar.y + 18;

const isAvatarPlayingGameConsole = (
  avatar: AvatarRuntime | undefined,
  item: PlacedItem,
  content: AivatarContent,
  activeInteraction?: FurnitureInteractionState | null,
) => {
  if (!avatar || item.itemId !== "game-console" || avatar.behavior !== "play") {
    return false;
  }

  if (activeInteraction?.furnitureId === item.id) {
    return true;
  }

  const standpoints = getPlacedItemInteractionStandpoints(item, content);
  if (standpoints.length === 0) {
    return Math.hypot(avatar.x - item.x, avatar.y - item.y) < 36;
  }

  const nearCurrentTarget =
    Math.hypot(avatar.x - avatar.targetX, avatar.y - avatar.targetY) <= 32;

  return standpoints.some(
    (point) =>
      avatarFootprintTouchesPoint(avatar, point) ||
      Math.hypot(avatar.x - point.x, avatar.y - point.y) <= 32 ||
      (nearCurrentTarget &&
        Math.hypot(avatar.targetX - point.x, avatar.targetY - point.y) <= 32),
    );
};

const isRecordPlayerActive = (
  item: PlacedItem,
  activeRecordPlayerId?: string | null,
) => item.itemId === "record-player" && item.id === activeRecordPlayerId;

const drawPlacedItem = (
  ctx: CanvasRenderingContext2D,
  item: PlacedItem,
  content: AivatarContent,
  frame = 0,
  avatar?: AvatarRuntime,
  activeInteraction?: FurnitureInteractionState | null,
  activeRecordPlayerId?: string | null,
  coffeeCupHasCoffee = false,
  taskFileCount = 0,
  failedTaskFileCount = 0,
) => {
  const definition = content.itemDefinitions.find((candidate) => candidate.id === item.itemId);
  if (!definition) return;
  const brewing =
    definition.id === "coffee-machine" &&
    activeInteraction?.kind === "brew" &&
    activeInteraction.furnitureId === item.id;
  const gameConsolePlaying = isAvatarPlayingGameConsole(
    avatar,
    item,
    content,
    activeInteraction,
  );
  const recordPlayerPlaying = isRecordPlayerActive(item, activeRecordPlayerId);

  if (definition.kind === "decor" || definition.kind === "furniture") {
    if (item.rotation) {
      ctx.save();
      ctx.translate(Math.round(item.x), Math.round(item.y));
      ctx.rotate((item.rotation * Math.PI) / 180);
      drawPlaceableItem(
        ctx,
        definition.id,
        0,
        0,
        "none",
        frame,
        avatar,
        brewing,
        coffeeCupHasCoffee,
        taskFileCount,
        failedTaskFileCount,
        gameConsolePlaying,
        recordPlayerPlaying,
      );
      ctx.restore();
      return;
    }

    drawPlaceableItem(
      ctx,
      definition.id,
      item.x,
      item.y,
      "none",
      frame,
      avatar,
      brewing,
      coffeeCupHasCoffee,
      taskFileCount,
      failedTaskFileCount,
      gameConsolePlaying,
      recordPlayerPlaying,
    );
  }
};

const tableCoffeeCupFillSet = (
  content: AivatarContent,
  tableCoffeeQuantity: number,
) =>
  new Set(
    (content.placedItems ?? [])
      .filter(
        (item) =>
          item.itemId === "coffee-cup" && item.surfaceFurnitureId === "table",
      )
      .slice()
      .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id))
      .slice(0, Math.max(0, tableCoffeeQuantity))
      .map((item) => item.id),
  );

const drawPlacedItems = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  frame: number,
  avatar: AvatarRuntime,
  selectedPlacedItemId?: string | null,
  preview?: PlacementPreview | null,
  activeInteraction?: FurnitureInteractionState | null,
  tableCoffeeQuantity = 0,
  taskCabinetFileCount = 0,
  failedTaskCabinetFileCount = 0,
  layer: PlacedItemRenderLayer = "all",
  activeRecordPlayerId?: string | null,
) => {
  const placedItems = content.placedItems ?? [];
  const filledCoffeeCups = tableCoffeeCupFillSet(content, tableCoffeeQuantity);
  placedItems
    .filter(
      (item) =>
        !isFloorUnderlayItem(item.itemId) && !isWallPlacedItem(content, item),
    )
    .slice()
    .sort((left, right) => left.y - right.y)
    .forEach((item) => {
      const definition = content.itemDefinitions.find(
        (candidate) => candidate.id === item.itemId,
      );
      const inFrontOfAvatar = isPlacedItemInFrontOfAvatar(item, definition, avatar);
      if (layer === "behind-avatar" && inFrontOfAvatar) return;
      if (layer === "in-front-of-avatar" && !inFrontOfAvatar) return;

      drawPlacedItem(
        ctx,
        item,
        content,
        frame,
        avatar,
        activeInteraction,
        activeRecordPlayerId,
        filledCoffeeCups.has(item.id),
        item.itemId === "file-cabinet" ? taskCabinetFileCount : 0,
        item.itemId === "file-cabinet" ? failedTaskCabinetFileCount : 0,
      );
      if (item.id === selectedPlacedItemId) {
        drawPlacedItemHighlight(ctx, item);
      }
    });

  if (
    preview &&
    layer !== "in-front-of-avatar" &&
    getItemPlacementKind(preview.item) !== "wall"
  ) {
    drawPlaceableItem(
      ctx,
      preview.item.id,
      preview.x,
      preview.y,
      preview.valid ? "valid" : "invalid",
      frame,
      avatar,
    );
  }
};

const drawWallPlacedItems = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  frame: number,
  avatar: AvatarRuntime,
  selectedPlacedItemId?: string | null,
  preview?: PlacementPreview | null,
) => {
  (content.placedItems ?? [])
    .filter((item) => isWallPlacedItem(content, item))
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .forEach((item) => {
      drawPlacedItem(ctx, item, content, frame, avatar);
      if (item.id === selectedPlacedItemId) {
        drawPlacedItemHighlight(ctx, item);
      }
    });

  if (preview && getItemPlacementKind(preview.item) === "wall") {
    drawPlaceableItem(
      ctx,
      preview.item.id,
      preview.x,
      preview.y,
      preview.valid ? "valid" : "invalid",
      frame,
      avatar,
    );
  }
};

const drawPlacedItemsForSurface = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  surfaceFurnitureId: string,
  frame: number,
  avatar: AvatarRuntime,
  selectedPlacedItemId?: string | null,
  activeInteraction?: FurnitureInteractionState | null,
  tableCoffeeQuantity = 0,
  activeRecordPlayerId?: string | null,
) => {
  const filledCoffeeCups = tableCoffeeCupFillSet(content, tableCoffeeQuantity);
  (content.placedItems ?? [])
    .filter((item) => item.surfaceFurnitureId === surfaceFurnitureId)
    .sort((left, right) => left.y - right.y)
    .forEach((item) => {
      drawPlacedItem(
        ctx,
        item,
        content,
        frame,
        avatar,
        activeInteraction,
        activeRecordPlayerId,
        filledCoffeeCups.has(item.id),
      );
      if (item.id === selectedPlacedItemId) {
        drawPlacedItemHighlight(ctx, item);
      }
    });
};

const drawFloorUnderlayItems = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  frame: number,
  avatar: AvatarRuntime,
  selectedPlacedItemId?: string | null,
) => {
  (content.placedItems ?? [])
    .filter((item) => isFloorUnderlayItem(item.itemId))
    .sort((left, right) => left.y - right.y)
    .forEach((item) => {
      drawPlacedItem(ctx, item, content, frame, avatar);
      if (item.id === selectedPlacedItemId) {
        drawPlacedItemHighlight(ctx, item);
      }
    });
};

const isPreviewOnSurface = (
  preview: PlacementPreview | null | undefined,
  surface: FurnitureDefinition,
) =>
  Boolean(
    preview &&
      (surface.id === "desk" || surface.id === "table") &&
      preview.x >= surface.x &&
      preview.x <= surface.x + surface.width &&
      preview.y >= surface.y - 4 &&
      preview.y <= surface.y + 28,
  );

const drawWoodFloor = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;

  drawPixelRect(ctx, 70, 128, 340, 184, palette.border);
  drawPixelRect(ctx, 76, 132, 328, 174, palette.base);

  const boardWidth = 18;
  const colors = [
    palette.plankA,
    palette.plankB,
    palette.plankC,
    palette.plankD,
    palette.plankA,
  ];

  for (let x = 76; x < 404; x += boardWidth) {
    const index = Math.floor((x - 76) / boardWidth);
    const boardX = Math.round(x);
    const width = Math.min(boardWidth, 404 - boardX);

    drawPixelRect(ctx, boardX, 132, width, 174, colors[index % colors.length]);
    drawPixelRect(ctx, boardX, 132, 1, 174, palette.seam);
    drawPixelRect(ctx, boardX + width - 1, 132, 1, 174, palette.highlight);

    for (let y = 146 + ((index * 13) % 30); y < 298; y += 42) {
      drawPixelRect(ctx, boardX + 3, y, width - 6, 2, palette.grainDark);
      drawPixelRect(ctx, boardX + 4, y + 2, width - 8, 1, palette.grainLight);
    }

    for (let y = 140; y < 300; y += 15) {
      const grainX = boardX + 3 + ((index * 7 + y) % Math.max(5, width - 5));
      drawPixelRect(ctx, grainX, y, 1, 8, palette.grainDark);
      drawPixelRect(ctx, grainX + 4, y + 4, 1, 7, palette.grainLight);
    }
  }

  [
    { x: 130, y: 176 },
    { x: 222, y: 244 },
    { x: 344, y: 166 },
    { x: 302, y: 286 },
  ].forEach((knot) => {
    drawPixelRect(ctx, knot.x - 4, knot.y - 2, 8, 5, palette.seam);
    drawPixelRect(ctx, knot.x - 2, knot.y - 1, 5, 3, palette.grainLight);
    drawPixelRect(ctx, knot.x, knot.y, 2, 1, palette.border);
  });
};

const drawCheckerTileFloor = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;
  const tileSize = 24;

  drawPixelRect(ctx, 70, 128, 340, 184, palette.border);
  drawPixelRect(ctx, 76, 132, 328, 174, palette.seam);

  for (let y = 132; y < 306; y += tileSize) {
    for (let x = 76; x < 404; x += tileSize) {
      const tileX = Math.round(x);
      const tileY = Math.round(y);
      const width = Math.min(tileSize - 1, 404 - tileX);
      const height = Math.min(tileSize - 1, 306 - tileY);
      const isLight = ((tileX - 76) / tileSize + (tileY - 132) / tileSize) % 2 === 0;
      const fill = isLight ? palette.plankA : palette.plankB;
      const shade = isLight ? palette.plankC : palette.plankD;
      const scratch = isLight ? palette.seam : palette.grainLight;

      drawPixelRect(ctx, tileX, tileY, width, height, fill);
      drawPixelRect(ctx, tileX, tileY, width, 2, isLight ? palette.highlight : "#46464c");
      drawPixelRect(ctx, tileX, tileY, 2, height, isLight ? palette.highlight : "#2a2a30");
      drawPixelRect(ctx, tileX + width - 2, tileY + 2, 2, height - 2, shade);
      drawPixelRect(ctx, tileX + 2, tileY + height - 2, width - 2, 2, shade);

      if ((tileX + tileY) % 3 === 0) {
        drawPixelRect(ctx, tileX + 6, tileY + 7, Math.max(4, width - 14), 1, scratch);
      }
      if (isLight && (tileX + tileY) % 5 === 0) {
        drawPixelRect(ctx, tileX + width - 7, tileY + 5, 3, 2, "#ffffff");
      }
    }
  }

  for (let x = 76; x <= 404; x += tileSize) {
    drawPixelRect(ctx, x, 132, 1, 174, palette.seam);
  }
  for (let y = 132; y <= 306; y += tileSize) {
    drawPixelRect(ctx, 76, y, 328, 1, palette.seam);
  }
};

const drawPolishedCementFloor = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;

  drawPixelRect(ctx, 70, 128, 340, 184, palette.border);
  drawPixelRect(ctx, 76, 132, 328, 174, palette.base);
  drawPixelRect(ctx, 76, 132, 328, 2, "rgba(234, 238, 240, 0.22)");
  drawPixelRect(ctx, 76, 304, 328, 2, "rgba(61, 67, 72, 0.26)");

  for (let y = 136; y < 303; y += 4) {
    for (let x = 82; x < 400; x += 8) {
      const speck = (x * 13 + y * 17) % 9;
      const color =
        speck <= 1
          ? "rgba(234, 238, 240, 0.14)"
          : speck <= 3
            ? "rgba(195, 200, 203, 0.12)"
            : speck === 4
              ? "rgba(80, 87, 93, 0.10)"
              : "rgba(143, 150, 155, 0.08)";
      if (speck < 5) {
        drawPixelRect(ctx, x + ((y * 2) % 5), y, speck === 4 ? 2 : 1, 1, color);
      }
    }
  }

  for (let y = 140; y < 300; y += 9) {
    const offset = (y * 7) % 39;
    drawPixelRect(ctx, 84 + offset, y, 62 + (offset % 34), 1, "rgba(223, 228, 231, 0.10)");
    drawPixelRect(ctx, 174 + offset / 3, y + 2, 82 + (offset % 29), 1, "rgba(112, 120, 126, 0.08)");
    drawPixelRect(ctx, 108 + offset / 2, y + 5, 46 + (offset % 25), 1, "rgba(206, 211, 214, 0.09)");
    drawPixelRect(ctx, 246 - offset / 4, y + 7, 66 + (offset % 21), 1, "rgba(78, 85, 91, 0.07)");
  }

  [
    { x: 92, y: 166, width: 128 },
    { x: 176, y: 214, width: 176 },
    { x: 244, y: 150, width: 116 },
    { x: 118, y: 264, width: 86 },
  ].forEach((gloss, index) => {
    const lift = index % 2;
    drawPixelRect(ctx, gloss.x + 12, gloss.y, gloss.width - 24, 1, "rgba(242, 246, 248, 0.16)");
    drawPixelRect(ctx, gloss.x, gloss.y + 2 + lift, gloss.width, 1, "rgba(232, 237, 239, 0.11)");
    drawPixelRect(ctx, gloss.x + 26, gloss.y + 4 + lift, gloss.width - 58, 1, "rgba(242, 246, 248, 0.13)");
    drawPixelRect(ctx, gloss.x + 42, gloss.y + 7, Math.max(26, gloss.width - 88), 1, "rgba(196, 202, 205, 0.10)");
    drawPixelRect(ctx, gloss.x + 8, gloss.y + 10, gloss.width - 20, 1, "rgba(77, 84, 90, 0.06)");
  });
};

const drawIndustrialMetalFloor = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;
  const plateWidth = 82;
  const plateHeight = 44;

  drawPixelRect(ctx, 70, 128, 340, 184, palette.border);
  drawPixelRect(ctx, 76, 132, 328, 174, palette.base);

  for (let y = 132; y < 306; y += plateHeight) {
    for (let x = 76; x < 404; x += plateWidth) {
      const width = Math.min(plateWidth - 1, 404 - x);
      const height = Math.min(plateHeight - 1, 306 - y);
      const alt = ((x - 76) / plateWidth + (y - 132) / plateHeight) % 2 === 0;
      const rowTone = (y - 132) / (306 - 132);
      const fill =
        rowTone < 0.34
          ? alt
            ? palette.plankD
            : palette.plankA
          : rowTone < 0.68
            ? alt
              ? palette.plankA
              : palette.plankB
            : alt
              ? palette.plankB
              : palette.plankC;
      const topLight = rowTone < 0.45 ? palette.highlight : palette.grainLight;
      const sideLight = rowTone < 0.55 ? palette.grainLight : palette.plankA;
      const shade = rowTone < 0.5 ? palette.plankC : palette.grainDark;

      drawPixelRect(ctx, x, y, width, height, fill);
      drawPixelRect(ctx, x, y, width, 2, topLight);
      drawPixelRect(ctx, x, y, 2, height, sideLight);
      drawPixelRect(ctx, x + width - 2, y + 2, 2, height - 2, shade);
      drawPixelRect(ctx, x + 2, y + height - 2, width - 2, 2, palette.seam);
      drawPixelRect(ctx, x + 4, y + 5, width - 10, 1, sideLight);
      drawPixelRect(ctx, x + 5, y + height - 7, width - 12, 1, palette.grainDark);
      drawPixelRect(ctx, x + width - 7, y + 6, 1, height - 14, palette.grainDark);

      drawPixelRect(ctx, x + 14, y + 10, Math.max(18, width - 38), 2, rowTone < 0.55 ? palette.plankD : palette.plankA);
      drawPixelRect(ctx, x + 22, y + 13, Math.max(12, width - 54), 1, topLight);
      drawPixelRect(ctx, x + 36, y + 28, Math.max(10, width - 62), 1, sideLight);

      [
        { rx: 8, ry: 7 },
        { rx: width - 12, ry: 7 },
        { rx: 8, ry: height - 11 },
        { rx: width - 12, ry: height - 11 },
      ].forEach((rivet) => {
        drawPixelRect(ctx, x + rivet.rx, y + rivet.ry, 5, 5, palette.grainDark);
        drawPixelRect(ctx, x + rivet.rx + 1, y + rivet.ry, 3, 3, palette.seam);
        drawPixelRect(ctx, x + rivet.rx + 1, y + rivet.ry, 2, 1, palette.highlight);
        drawPixelRect(ctx, x + rivet.rx + 3, y + rivet.ry + 3, 1, 1, palette.plankC);
      });

    }
  }

  for (let x = 76; x <= 404; x += plateWidth) {
    drawPixelRect(ctx, x, 132, 2, 174, palette.seam);
  }
  for (let y = 132; y <= 306; y += plateHeight) {
    drawPixelRect(ctx, 76, y, 328, 2, palette.seam);
  }
};

const grayTechFloorLayout = {
  floorX: 76,
  floorY: 132,
  floorWidth: 328,
  floorHeight: 174,
  splitOffsetX: 139,
  splitOffsetY: 98,
};

const grayTechFloorLedPalette = {
  ledBlue: "#4ea7ff",
  ledBlueBright: "#bfe8ff",
  ledBlueBed: "#1f4f74",
};

interface GlowBlockerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const furnitureGlowBlockers = (item: FurnitureDefinition): GlowBlockerRect[] => {
  if (item.id === "desk") {
    const drawerTop = item.y + 32;
    const leftX = item.x - 2;
    const stackWidth = 30;
    const rightX = item.x + item.width - stackWidth + 2;
    const centerX = Math.round(item.x + item.width / 2);
    const skinId = deskSkinId(item);
    const topBlockers = [
      { x: item.x - 5, y: item.y - 7, width: item.width + 10, height: 35 },
      { x: item.x - 2, y: drawerTop - 5, width: item.width + 4, height: 9 },
    ];

    if (skinId === "industrial-desk-skin" || skinId === "transparent-acrylic-desk-skin") {
      const catX = centerX - 10;
      const catY = drawerTop + 5;

      return [
        ...topBlockers,
        { x: leftX - 2, y: drawerTop - 2, width: 14, height: 39 },
        { x: rightX + stackWidth - 10, y: drawerTop - 2, width: 14, height: 39 },
        { x: catX + 3, y: catY + 2, width: 2, height: 3 },
        { x: catX + 4, y: catY + 4, width: 3, height: 3 },
        { x: catX + 15, y: catY + 2, width: 2, height: 3 },
        { x: catX + 13, y: catY + 4, width: 3, height: 3 },
        { x: catX + 3, y: catY + 7, width: 14, height: 10 },
        { x: catX + 1, y: catY + 10, width: 18, height: 7 },
        { x: catX + 4, y: catY + 16, width: 14, height: 4 },
        { x: catX + 2, y: catY + 18, width: 20, height: 10 },
        { x: catX, y: catY + 23, width: 22, height: 8 },
        { x: catX + 3, y: catY + 29, width: 18, height: 4 },
        { x: catX + 5, y: catY + 30, width: 5, height: 5 },
        { x: catX + 12, y: catY + 30, width: 5, height: 5 },
      ];
    }

    const sideAndCenterBlockers = [
      { x: leftX - 3, y: drawerTop - 3, width: stackWidth + 6, height: 43 },
      { x: rightX - 3, y: drawerTop - 3, width: stackWidth + 6, height: 43 },
      { x: centerX - 18, y: drawerTop - 2, width: 36, height: 19 },
    ];

    if (skinId === "rococo-ivory-desk-skin") {
      return [...topBlockers, ...sideAndCenterBlockers];
    }

    const shadowBlobX = centerX - 12;
    const shadowBlobY = drawerTop + 16;

    return [
      ...topBlockers,
      ...sideAndCenterBlockers,
      { x: shadowBlobX + 6, y: shadowBlobY, width: 12, height: 1 },
      { x: shadowBlobX + 3, y: shadowBlobY + 1, width: 18, height: 2 },
      { x: shadowBlobX + 1, y: shadowBlobY + 3, width: 22, height: 3 },
      { x: shadowBlobX, y: shadowBlobY + 6, width: 24, height: 3 },
      { x: shadowBlobX + 1, y: shadowBlobY + 9, width: 22, height: 2 },
      { x: shadowBlobX + 4, y: shadowBlobY + 11, width: 16, height: 2 },
      { x: shadowBlobX + 7, y: shadowBlobY + 13, width: 10, height: 1 },
    ];
  }

  if (item.id === "table") {
    return [
      { x: item.x - 3, y: item.y - 3, width: item.width + 6, height: 37 },
      { x: item.x + 5, y: item.y + 28, width: 13, height: 35 },
      { x: item.x + item.width - 18, y: item.y + 28, width: 13, height: 35 },
    ];
  }

  if (item.id === "bed") {
    return [{ x: item.x - 6, y: item.y - 15, width: item.width + 12, height: item.height + 26 }];
  }

  if (item.id === "fridge") {
    return [{ x: item.x - 8, y: item.y - 31, width: item.width + 16, height: item.height + 40 }];
  }

  if (item.id === "file-cabinet") {
    return [{ x: item.x - 5, y: item.y - 8, width: item.width + 10, height: item.height + 16 }];
  }

  return [{ x: item.x - 2, y: item.y - 2, width: item.width + 8, height: item.height + 10 }];
};

const avatarGlowBlockers = (avatar: AvatarRuntime): GlowBlockerRect[] => {
  const x = Math.round(avatar.x);
  const y = Math.round(avatar.y);

  return [
    { x: x - 22, y: y - 39, width: 44, height: 43 },
    { x: x - 25, y: y - 6, width: 50, height: 18 },
    { x: x - 20, y: y + 8, width: 40, height: 13 },
  ];
};

const floorGlowOcclusionRects = (
  content: AivatarContent,
  avatar: AvatarRuntime,
): GlowBlockerRect[] => {
  const placedItemBlockers = (content.placedItems ?? [])
    .filter((item) => !isWallPlacedItem(content, item))
    .map(placedItemBounds);

  return [
    ...content.room.furniture.flatMap(furnitureGlowBlockers),
    ...placedItemBlockers,
    ...avatarGlowBlockers(avatar),
  ];
};

const drawGrayTechFloor = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;
  const { floorX, floorY, floorWidth, floorHeight, splitOffsetX, splitOffsetY } =
    grayTechFloorLayout;
  const splitX = floorX + splitOffsetX;
  const splitY = floorY + splitOffsetY;
  const { ledBlue, ledBlueBright, ledBlueBed } = grayTechFloorLedPalette;

  drawPixelRect(ctx, 70, 128, 340, 184, palette.border);
  drawPixelRect(ctx, floorX, floorY, floorWidth, floorHeight, palette.base);

  [
    { x: floorX, y: floorY, width: floorWidth, height: 22, color: "rgba(226, 237, 242, 0.11)" },
    { x: floorX + 6, y: floorY + 24, width: 134, height: 54, color: "rgba(196, 204, 210, 0.15)" },
    { x: floorX + 146, y: floorY + 15, width: 112, height: 58, color: "rgba(129, 140, 149, 0.18)" },
    { x: floorX + 238, y: floorY + 34, width: 84, height: 72, color: "rgba(196, 204, 210, 0.13)" },
    { x: floorX + 18, y: floorY + 92, width: 118, height: 58, color: "rgba(116, 126, 136, 0.14)" },
    { x: floorX + 142, y: floorY + 82, width: 174, height: 74, color: "rgba(226, 237, 242, 0.09)" },
  ].forEach((patch) => {
    drawPixelRect(ctx, patch.x, patch.y, patch.width, patch.height, patch.color);
    drawPixelRect(ctx, patch.x + 5, patch.y + 4, patch.width - 10, 1, "rgba(238, 246, 248, 0.08)");
    drawPixelRect(ctx, patch.x + 6, patch.y + patch.height - 5, patch.width - 12, 1, "rgba(54, 64, 72, 0.10)");
  });

  for (let y = floorY + 5; y < floorY + floorHeight - 5; y += 7) {
    const offset = (y * 5) % 19;
    const length = floorWidth - 16 - ((y * 3) % 31);
    const color = y % 3 === 0 ? "rgba(232, 239, 242, 0.09)" : "rgba(65, 74, 82, 0.10)";
    drawPixelRect(ctx, floorX + 8 + offset, y, Math.max(64, length), 1, color);
  }

  for (let i = 0; i < 34; i += 1) {
    const speckX = floorX + 10 + ((i * 37) % (floorWidth - 24));
    const speckY = floorY + 9 + ((i * 23) % (floorHeight - 20));
    const speckWidth = 2 + (i % 4);
    const speckColor = i % 2 === 0 ? "rgba(236, 243, 245, 0.13)" : "rgba(52, 62, 70, 0.12)";
    drawPixelRect(ctx, speckX, speckY, speckWidth, 1, speckColor);
  }

  drawPixelRect(ctx, splitX - 1, floorY + 6, 4, floorHeight - 12, "rgba(35, 46, 56, 0.32)");
  drawPixelRect(ctx, splitX, floorY + 8, 2, floorHeight - 16, ledBlueBed);
  drawPixelRect(ctx, splitX, floorY + 8, 1, floorHeight - 16, ledBlue);
  drawPixelRect(ctx, splitX + 1, floorY + 9, 1, floorHeight - 18, ledBlueBright);

  drawPixelRect(ctx, floorX, splitY - 1, floorWidth, 4, "rgba(35, 46, 56, 0.32)");
  drawPixelRect(ctx, floorX, splitY, floorWidth, 2, ledBlueBed);
  drawPixelRect(ctx, floorX, splitY, floorWidth, 1, ledBlue);
  drawPixelRect(ctx, floorX + 1, splitY + 1, floorWidth - 2, 1, ledBlueBright);

  drawPixelRect(ctx, splitX - 1, splitY - 1, 4, 4, "rgba(22, 36, 48, 0.48)");
  drawPixelRect(ctx, splitX, splitY, 2, 2, ledBlue);
  drawPixelRect(ctx, splitX + 1, splitY + 1, 1, 1, ledBlueBright);

  drawPixelRect(ctx, floorX, floorY, floorWidth, 2, "rgba(238, 246, 248, 0.16)");
  drawPixelRect(ctx, floorX, floorY + floorHeight - 3, floorWidth, 3, "rgba(47, 56, 64, 0.34)");
  drawPixelRect(ctx, floorX, floorY, 2, floorHeight, "rgba(226, 237, 242, 0.08)");
  drawPixelRect(ctx, floorX + floorWidth - 2, floorY, 2, floorHeight, "rgba(47, 56, 64, 0.26)");
};

const drawGrayTechFloorLedGlow = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  avatar: AvatarRuntime,
) => {
  const { floorX, floorY, floorWidth, floorHeight, splitOffsetX, splitOffsetY } =
    grayTechFloorLayout;
  const splitX = floorX + splitOffsetX;
  const splitY = floorY + splitOffsetY;

  const glowCanvas = ctx.canvas.ownerDocument.createElement("canvas");
  glowCanvas.width = ctx.canvas.width;
  glowCanvas.height = ctx.canvas.height;
  const glowCtx = glowCanvas.getContext("2d");
  if (!glowCtx) return;
  glowCtx.imageSmoothingEnabled = false;

  drawPixelRect(glowCtx, splitX - 4, floorY + 6, 10, floorHeight - 12, "rgba(78, 167, 255, 0.10)");
  drawPixelRect(glowCtx, splitX - 2, floorY + 7, 6, floorHeight - 14, "rgba(78, 167, 255, 0.16)");
  drawPixelRect(glowCtx, splitX, floorY + 8, 2, floorHeight - 16, "rgba(191, 232, 255, 0.42)");

  drawPixelRect(glowCtx, floorX, splitY - 4, floorWidth, 10, "rgba(78, 167, 255, 0.10)");
  drawPixelRect(glowCtx, floorX, splitY - 2, floorWidth, 6, "rgba(78, 167, 255, 0.16)");
  drawPixelRect(glowCtx, floorX, splitY, floorWidth, 2, "rgba(191, 232, 255, 0.42)");

  drawPixelRect(glowCtx, splitX - 4, splitY - 4, 10, 10, "rgba(78, 167, 255, 0.16)");
  drawPixelRect(glowCtx, splitX - 2, splitY - 2, 6, 6, "rgba(191, 232, 255, 0.26)");
  drawPixelRect(glowCtx, splitX, splitY, 2, 2, "rgba(255, 255, 255, 0.40)");

  glowCtx.globalCompositeOperation = "destination-out";
  floorGlowOcclusionRects(content, avatar).forEach((rect) => {
    drawPixelRect(
      glowCtx,
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height),
      "#000000",
    );
  });
  glowCtx.globalCompositeOperation = "destination-in";
  drawPixelRect(glowCtx, floorX, floorY, floorWidth, floorHeight, "#000000");

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(glowCanvas, 0, 0);
  ctx.restore();
};

const drawFloorLightOverlay = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
  content: AivatarContent,
  avatar: AvatarRuntime,
) => {
  if (surface.id === "gray-tech-floor") {
    drawGrayTechFloorLedGlow(ctx, content, avatar);
  }
};

const drawTatamiMatFloor = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;
  const binding = "#3f6f47";
  const bindingDark = "#25482f";
  const bindingLight = "#6e9a65";
  const strawShadow = "#9b925b";
  const mats = [
    { x: 76, y: 132, width: 82, height: 58, vertical: true },
    { x: 158, y: 132, width: 123, height: 58, vertical: false },
    { x: 281, y: 132, width: 123, height: 58, vertical: false },
    { x: 76, y: 190, width: 123, height: 58, vertical: false },
    { x: 199, y: 190, width: 82, height: 116, vertical: true },
    { x: 281, y: 190, width: 123, height: 58, vertical: false },
    { x: 76, y: 248, width: 123, height: 58, vertical: false },
    { x: 281, y: 248, width: 123, height: 58, vertical: false },
  ];

  drawPixelRect(ctx, 70, 128, 340, 184, palette.border);
  drawPixelRect(ctx, 76, 132, 328, 174, palette.seam);

  mats.forEach((mat, index) => {
    const fill = index % 2 === 0 ? palette.plankA : palette.plankB;
    drawPixelRect(ctx, mat.x, mat.y, mat.width - 1, mat.height - 1, fill);
    drawPixelRect(ctx, mat.x, mat.y, mat.width - 1, 4, binding);
    drawPixelRect(ctx, mat.x, mat.y, 4, mat.height - 1, binding);
    drawPixelRect(ctx, mat.x + mat.width - 5, mat.y + 4, 4, mat.height - 5, bindingDark);
    drawPixelRect(ctx, mat.x + 4, mat.y + mat.height - 5, mat.width - 5, 4, bindingDark);
    drawPixelRect(ctx, mat.x + 2, mat.y + 1, mat.width - 5, 1, bindingLight);
    drawPixelRect(ctx, mat.x + 1, mat.y + 2, 1, mat.height - 5, bindingLight);

    if (mat.vertical) {
      for (let x = mat.x + 8; x < mat.x + mat.width - 7; x += 4) {
        const color = (x + index) % 3 === 0 ? palette.grainLight : palette.plankD;
        drawPixelRect(ctx, x, mat.y + 6, 1, mat.height - 12, color);
        if ((x + index) % 2 === 0) {
          drawPixelRect(ctx, x + 2, mat.y + 8, 1, mat.height - 16, strawShadow);
        }
      }
    } else {
      for (let y = mat.y + 7; y < mat.y + mat.height - 7; y += 3) {
        const color = (y + index) % 4 === 0 ? palette.grainLight : palette.plankD;
        drawPixelRect(ctx, mat.x + 7, y, mat.width - 14, 1, color);
        if ((y + index) % 2 === 0) {
          drawPixelRect(ctx, mat.x + 9, y + 2, mat.width - 18, 1, strawShadow);
        }
      }
    }

    for (let fleck = 0; fleck < 10; fleck += 1) {
      const fleckX = mat.x + 9 + ((mat.x * 3 + mat.y + fleck * 17) % Math.max(8, mat.width - 20));
      const fleckY = mat.y + 8 + ((mat.x + mat.y * 5 + fleck * 11) % Math.max(8, mat.height - 18));
      drawPixelRect(ctx, fleckX, fleckY, 3 + (fleck % 3), 1, fleck % 2 === 0 ? palette.grainLight : palette.plankC);
    }

    drawPixelRect(ctx, mat.x + 5, mat.y + 5, 8, 1, palette.plankD);
    drawPixelRect(ctx, mat.x + mat.width - 18, mat.y + mat.height - 9, 10, 1, palette.plankC);
  });
};

const drawFloor = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  if (surface.id === "checker-tile-floor") {
    drawCheckerTileFloor(ctx, surface);
    return;
  }

  if (surface.id === "polished-cement-floor") {
    drawPolishedCementFloor(ctx, surface);
    return;
  }

  if (surface.id === "industrial-metal-floor") {
    drawIndustrialMetalFloor(ctx, surface);
    return;
  }

  if (surface.id === "gray-tech-floor") {
    drawGrayTechFloor(ctx, surface);
    return;
  }

  if (surface.id === "tatami-mat-floor") {
    drawTatamiMatFloor(ctx, surface);
    return;
  }

  drawWoodFloor(ctx, surface);
};

const drawWoodWall = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;

  drawPixelRect(ctx, 70, 14, 340, 120, palette.border);
  drawPixelRect(ctx, 76, 20, 328, 106, palette.base);
  drawPixelRect(ctx, 76, 120, 328, 8, palette.seam);

  for (let x = 84; x < 398; x += 18) {
    drawPixelRect(ctx, x, 22, 2, 96, palette.seam);
    drawPixelRect(ctx, x + 2, 22, 1, 96, palette.highlight);
  }

  for (let y = 28; y < 114; y += 14) {
    for (let x = 90; x < 390; x += 52) {
      const offset = (x + y) % 11;
      drawPixelRect(ctx, x + offset, y, 12, 2, palette.grainDark);
      drawPixelRect(ctx, x + offset + 2, y + 3, 6, 1, palette.grainLight);
    }
  }
};

const drawLatexPaintWall = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;

  drawPixelRect(ctx, 70, 14, 340, 120, palette.border);
  drawPixelRect(ctx, 76, 20, 328, 106, palette.base);
  drawPixelRect(ctx, 76, 120, 328, 8, palette.seam);
  drawPixelRect(ctx, 76, 20, 328, 4, palette.highlight);
  drawPixelRect(ctx, 76, 24, 4, 96, palette.grainDark);
  drawPixelRect(ctx, 400, 24, 4, 96, palette.grainDark);

  for (let y = 28; y < 116; y += 12) {
    for (let x = 88; x < 390; x += 34) {
      const offset = (x * 3 + y * 5) % 13;
      const width = 10 + ((x + y) % 9);
      const color = (x + y) % 3 === 0 ? palette.plankB : palette.plankC;
      drawPixelRect(ctx, x + offset, y, width, 2, color);
      if ((x + y) % 4 === 0) {
        drawPixelRect(ctx, x + offset + 3, y + 4, Math.max(4, width - 6), 1, palette.grainLight);
      }
    }
  }

  for (let y = 34; y < 112; y += 19) {
    for (let x = 94; x < 386; x += 58) {
      const offset = (x + y * 2) % 17;
      drawPixelRect(ctx, x + offset, y, 2, 2, palette.grainDark);
      drawPixelRect(ctx, x + offset + 8, y + 7, 3, 1, palette.highlight);
    }
  }
};

const drawBubbleWallpaper = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;

  drawPixelRect(ctx, 70, 14, 340, 120, palette.border);
  drawPixelRect(ctx, 76, 20, 328, 106, palette.base);
  drawPixelRect(ctx, 76, 120, 328, 8, palette.seam);
  drawPixelRect(ctx, 76, 20, 328, 4, palette.highlight);
  drawPixelRect(ctx, 76, 24, 4, 96, palette.grainDark);
  drawPixelRect(ctx, 400, 24, 4, 96, palette.grainDark);

  for (let y = 30; y < 110; y += 30) {
    for (let x = 92; x < 386; x += 60) {
      const offsetX = ((x * 5 + y * 3) % 17) - 8;
      const offsetY = ((x * 2 + y) % 11) - 5;
      const bubbleX = x + offsetX;
      const bubbleY = y + offsetY;
      const size = 18 + ((x + y) % 3) * 4;
      const bubbleDark = (x + y) % 2 === 0 ? palette.plankC : palette.plankA;
      const bubbleLight = (x + y) % 2 === 0 ? palette.plankD : palette.plankB;

      drawPixelRect(ctx, bubbleX + 7, bubbleY, size - 14, 2, bubbleDark);
      drawPixelRect(ctx, bubbleX + 4, bubbleY + 2, size - 8, 3, bubbleDark);
      drawPixelRect(ctx, bubbleX + 2, bubbleY + 5, size - 4, 4, bubbleDark);
      drawPixelRect(ctx, bubbleX, bubbleY + 9, size, size - 18, bubbleDark);
      drawPixelRect(ctx, bubbleX + 2, bubbleY + size - 9, size - 4, 4, bubbleDark);
      drawPixelRect(ctx, bubbleX + 4, bubbleY + size - 5, size - 8, 3, bubbleDark);
      drawPixelRect(ctx, bubbleX + 7, bubbleY + size - 2, size - 14, 2, bubbleDark);

      drawPixelRect(ctx, bubbleX + 5, bubbleY + 5, size - 10, size - 10, bubbleLight);
      drawPixelRect(ctx, bubbleX + 3, bubbleY + 9, size - 6, size - 18, bubbleLight);
      drawPixelRect(ctx, bubbleX + 6, bubbleY + 4, 6, 3, palette.highlight);
      drawPixelRect(ctx, bubbleX + 4, bubbleY + 8, 3, 4, palette.highlight);
      drawPixelRect(ctx, bubbleX + size - 8, bubbleY + size - 8, 3, 3, palette.grainDark);
    }
  }

  for (let y = 30; y < 114; y += 13) {
    for (let x = 88; x < 392; x += 38) {
      if ((x + y) % 4 !== 0) continue;
      drawPixelRect(ctx, x, y, 7, 1, palette.grainLight);
      drawPixelRect(ctx, x + 2, y + 3, 4, 1, palette.grainDark);
    }
  }
};

const drawExposedBrickWallpaper = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;
  const hash = (x: number, y: number) =>
    Math.abs((x * 92837111) ^ (y * 689287499));

  drawPixelRect(ctx, 70, 14, 340, 120, palette.border);
  drawPixelRect(ctx, 76, 20, 328, 106, "#7c7a72");
  drawPixelRect(ctx, 76, 20, 328, 2, "#a49c8e");

  const brickWidth = 34;
  const brickHeight = 10;
  const mortar = 2;
  const brickAreaLeft = 76;
  const brickAreaRight = 404;
  const brickAreaTop = 24;
  const brickAreaBottom = 128;

  for (let y = brickAreaTop; y < brickAreaBottom; y += brickHeight + mortar) {
    const row = Math.floor((y - brickAreaTop) / (brickHeight + mortar));
    const offset = row % 2 === 0 ? -5 : -brickWidth / 2 - 5;

    for (let x = brickAreaLeft + offset; x < brickAreaRight; x += brickWidth + mortar) {
      const brickX = Math.max(brickAreaLeft, Math.round(x));
      const brickY = y;
      const brickRight = Math.min(brickAreaRight, Math.round(x + brickWidth));
      const brickBottom = Math.min(brickAreaBottom, y + brickHeight);
      const brickW = brickRight - brickX;
      const brickH = brickBottom - brickY;
      if (brickW < 8 || brickH < 6) continue;

      const brickHash = hash(Math.floor(x), y);
      const tone =
        brickHash % 5 === 0
          ? palette.plankC
          : brickHash % 3 === 0
            ? palette.plankB
            : brickHash % 7 === 0
              ? palette.plankD
              : palette.plankA;

      drawPixelRect(ctx, brickX + 1, brickY + 1, brickW, brickH, "#42342e");
      drawPixelRect(ctx, brickX, brickY, brickW, brickH, tone);
      drawPixelRect(ctx, brickX, brickY, brickW, 1, palette.highlight);
      drawPixelRect(ctx, brickX + 1, brickY + 1, Math.max(0, brickW - 4), 1, palette.grainLight);
      drawPixelRect(ctx, brickX, brickY + brickH - 1, brickW, 1, palette.grainDark);
      drawPixelRect(ctx, brickX + brickW - 1, brickY + 1, 1, Math.max(0, brickH - 2), palette.grainDark);
      drawPixelRect(ctx, brickX + 1, brickY + brickH - 1, Math.max(0, brickW - 3), 1, "#3b231d");

      for (let dotIndex = 0; dotIndex < 5; dotIndex += 1) {
        const dotHash = hash(brickX + dotIndex * 11, brickY + dotIndex * 7);
        const dotX = brickX + 4 + (dotHash % Math.max(1, brickW - 9));
        const dotY = brickY + 3 + (Math.floor(dotHash / 13) % Math.max(1, brickH - 6));
        const dotColor =
          dotHash % 4 === 0
            ? "rgba(255, 203, 151, 0.28)"
            : dotHash % 3 === 0
              ? "rgba(52, 25, 20, 0.35)"
              : "rgba(167, 76, 49, 0.55)";
        drawPixelRect(ctx, dotX, dotY, dotHash % 5 === 0 ? 2 : 1, 1, dotColor);
      }

      if (brickHash % 4 === 0 && brickW > 20) {
        const scarX = brickX + 6 + (brickHash % Math.max(1, brickW - 15));
        drawPixelRect(ctx, scarX, brickY + brickH - 4, 6, 1, "rgba(55, 28, 23, 0.42)");
      }

      if (brickHash % 6 === 1 && brickW > 20) {
        drawPixelRect(ctx, brickX + 3, brickY + 3, 4, 1, "#8a3828");
        drawPixelRect(ctx, brickX + 5, brickY + 4, 2, 1, "#5b261e");
      }
    }
  }

  for (let y = brickAreaTop + 6; y < brickAreaBottom; y += 16) {
    drawPixelRect(ctx, 80, y, 320, 1, "rgba(255, 255, 255, 0.08)");
  }
};

const drawSakuraWallpaper = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;

  drawPixelRect(ctx, 70, 14, 340, 120, palette.border);
  drawPixelRect(ctx, 76, 20, 328, 106, palette.base);
  drawPixelRect(ctx, 76, 120, 328, 8, palette.seam);
  drawPixelRect(ctx, 76, 20, 328, 4, palette.highlight);
  drawPixelRect(ctx, 76, 24, 4, 96, palette.grainDark);
  drawPixelRect(ctx, 400, 24, 4, 96, palette.grainDark);

  const patternHash = (x: number, y: number) => Math.abs((x * 73856093) ^ (y * 19349663));

  for (let y = 28; y < 116; y += 18) {
    for (let x = 88; x < 392; x += 38) {
      const hash = patternHash(x, y);
      if (hash % 11 === 0) continue;
      const offsetX = (hash % 23) - 11;
      const offsetY = (Math.floor(hash / 23) % 17) - 8;
      const flowerX = x + offsetX;
      const flowerY = y + offsetY;
      const small = hash % 5 === 0;

      drawPixelRect(ctx, flowerX + 3, flowerY, small ? 3 : 4, 3, palette.plankD);
      drawPixelRect(ctx, flowerX, flowerY + 3, small ? 3 : 4, small ? 3 : 4, palette.plankA);
      drawPixelRect(ctx, flowerX + 7, flowerY + 3, small ? 3 : 4, small ? 3 : 4, palette.plankA);
      drawPixelRect(ctx, flowerX + 3, flowerY + 7, small ? 3 : 4, 3, palette.plankB);
      drawPixelRect(ctx, flowerX + 4, flowerY + 4, 3, 3, palette.seam);

      if (hash % 3 === 0) {
        drawPixelRect(ctx, flowerX + 15, flowerY + 2, 3, 2, palette.plankD);
        drawPixelRect(ctx, flowerX + 18, flowerY + 5, 2, 3, palette.plankA);
      }
    }
  }

  for (let y = 34; y < 114; y += 14) {
    for (let x = 86; x < 396; x += 31) {
      const hash = patternHash(x + 13, y + 7);
      if (hash % 7 > 3) continue;
      const petalX = x + (hash % 13) - 6;
      const petalY = y + (Math.floor(hash / 13) % 11) - 5;
      drawPixelRect(ctx, petalX, petalY, 4, 2, palette.grainLight);
      drawPixelRect(ctx, petalX + 6, petalY + 5, 3, 2, palette.plankC);
    }
  }

  for (let y = 36; y < 110; y += 20) {
    for (let x = 104; x < 384; x += 44) {
      const hash = patternHash(x + 29, y + 17);
      if (hash % 5 === 0) continue;
      const budX = x + (hash % 17) - 8;
      const budY = y + (Math.floor(hash / 17) % 13) - 6;
      drawPixelRect(ctx, budX, budY, 3, 2, palette.plankD);
      drawPixelRect(ctx, budX + 3, budY + 2, 2, 2, palette.plankA);
      drawPixelRect(ctx, budX + 1, budY + 4, 2, 1, palette.seam);
    }
  }
};

const drawIvoryWallpaper = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;

  drawPixelRect(ctx, 70, 14, 340, 120, palette.border);
  drawPixelRect(ctx, 76, 20, 328, 106, palette.base);
  drawPixelRect(ctx, 76, 120, 328, 8, palette.seam);
  drawPixelRect(ctx, 76, 20, 328, 4, palette.highlight);
  drawPixelRect(ctx, 76, 24, 4, 96, palette.grainDark);
  drawPixelRect(ctx, 400, 24, 4, 96, palette.grainDark);

  for (let x = 118; x < 390; x += 54) {
    drawPixelRect(ctx, x, 26, 1, 92, palette.grainLight);
    drawPixelRect(ctx, x + 1, 28, 1, 88, palette.plankB);
  }

  for (let y = 30; y < 114; y += 10) {
    const offset = (y * 5) % 23;
    drawPixelRect(ctx, 88 + offset, y, 82, 1, palette.grainLight);
    drawPixelRect(ctx, 202 - offset / 2, y + 4, 96, 1, palette.plankA);
    drawPixelRect(ctx, 314 - offset / 3, y + 7, 58, 1, palette.plankB);
  }

  for (let y = 34; y < 112; y += 17) {
    for (let x = 92; x < 386; x += 47) {
      const mark = (x * 7 + y * 3) % 6;
      if (mark > 2) continue;
      drawPixelRect(ctx, x + mark, y, 3, 1, palette.highlight);
      drawPixelRect(ctx, x + 8, y + 5, 2, 1, palette.grainDark);
    }
  }
};

const drawWhiteTechWallpaper = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;
  const traces: Array<Array<{ x: number; y: number }>> = [
    [
      { x: 92, y: 42 },
      { x: 128, y: 42 },
      { x: 128, y: 54 },
      { x: 154, y: 54 },
    ],
    [
      { x: 174, y: 34 },
      { x: 174, y: 62 },
      { x: 210, y: 62 },
      { x: 210, y: 78 },
      { x: 240, y: 78 },
    ],
    [
      { x: 258, y: 40 },
      { x: 292, y: 40 },
      { x: 292, y: 30 },
      { x: 326, y: 30 },
      { x: 326, y: 54 },
    ],
    [
      { x: 104, y: 94 },
      { x: 144, y: 94 },
      { x: 144, y: 106 },
      { x: 188, y: 106 },
    ],
    [
      { x: 222, y: 100 },
      { x: 252, y: 100 },
      { x: 252, y: 88 },
      { x: 300, y: 88 },
      { x: 300, y: 106 },
      { x: 348, y: 106 },
    ],
    [
      { x: 338, y: 70 },
      { x: 374, y: 70 },
      { x: 374, y: 92 },
      { x: 392, y: 92 },
    ],
  ];
  const panels = [
    { x: 82, y: 26, width: 66, height: 28 },
    { x: 154, y: 26, width: 74, height: 42 },
    { x: 236, y: 26, width: 76, height: 32 },
    { x: 318, y: 26, width: 78, height: 44 },
    { x: 82, y: 62, width: 84, height: 50 },
    { x: 174, y: 74, width: 70, height: 42 },
    { x: 252, y: 66, width: 86, height: 50 },
    { x: 344, y: 78, width: 50, height: 38 },
  ];
  const nodes = [
    { x: 128, y: 42, size: 5 },
    { x: 154, y: 54, size: 4 },
    { x: 174, y: 62, size: 4 },
    { x: 240, y: 78, size: 5 },
    { x: 292, y: 40, size: 4 },
    { x: 326, y: 54, size: 5 },
    { x: 144, y: 94, size: 4 },
    { x: 188, y: 106, size: 5 },
    { x: 252, y: 100, size: 4 },
    { x: 300, y: 88, size: 5 },
    { x: 348, y: 106, size: 4 },
    { x: 374, y: 70, size: 5 },
  ];

  const drawTrace = (points: Array<{ x: number; y: number }>, color: string) => {
    points.slice(1).forEach((point, index) => {
      const previous = points[index];
      if (previous.x === point.x) {
        drawPixelRect(ctx, point.x, Math.min(previous.y, point.y), 1, Math.abs(point.y - previous.y) + 1, color);
        return;
      }
      drawPixelRect(ctx, Math.min(previous.x, point.x), point.y, Math.abs(point.x - previous.x) + 1, 1, color);
    });
  };

  drawPixelRect(ctx, 70, 14, 340, 120, palette.border);
  drawPixelRect(ctx, 76, 20, 328, 106, palette.base);
  drawPixelRect(ctx, 76, 20, 328, 4, palette.highlight);
  drawPixelRect(ctx, 76, 24, 4, 96, palette.grainDark);
  drawPixelRect(ctx, 400, 24, 4, 96, palette.grainDark);

  panels.forEach((panel, index) => {
    const fill = index % 3 === 0 ? palette.plankA : index % 3 === 1 ? palette.plankB : palette.base;
    drawPixelRect(ctx, panel.x, panel.y, panel.width, panel.height, fill);
    drawPixelRect(ctx, panel.x, panel.y, panel.width, 1, palette.highlight);
    drawPixelRect(ctx, panel.x, panel.y, 1, panel.height, palette.highlight);
    drawPixelRect(ctx, panel.x + panel.width - 1, panel.y + 1, 1, panel.height - 1, palette.grainDark);
    drawPixelRect(ctx, panel.x + 1, panel.y + panel.height - 1, panel.width - 1, 1, palette.seam);
    if (index % 2 === 0) {
      drawPixelRect(ctx, panel.x + 8, panel.y + 8, Math.min(34, panel.width - 18), 1, palette.grainLight);
      drawPixelRect(ctx, panel.x + 10, panel.y + 12, Math.min(20, panel.width - 20), 1, palette.plankD);
    }
  });

  [132, 230, 314].forEach((x) => {
    drawPixelRect(ctx, x, 24, 1, 94, palette.seam);
    drawPixelRect(ctx, x + 1, 26, 1, 90, palette.highlight);
  });
  [60, 116].forEach((y) => {
    drawPixelRect(ctx, 82, y, 314, 1, palette.seam);
    drawPixelRect(ctx, 84, y + 1, 310, 1, palette.highlight);
  });

  traces.forEach((trace, index) => drawTrace(trace, index % 2 === 0 ? palette.grainLight : palette.seam));

  nodes.forEach((node, index) => {
    const offset = Math.floor(node.size / 2);
    drawPixelRect(ctx, node.x - offset - 1, node.y - offset - 1, node.size + 2, node.size + 2, palette.highlight);
    drawPixelRect(ctx, node.x - offset, node.y - offset, node.size, node.size, palette.plankD);
    drawPixelRect(ctx, node.x - offset + 1, node.y - offset + 1, Math.max(1, node.size - 2), Math.max(1, node.size - 2), index % 3 === 0 ? "#ffffff" : palette.grainLight);
  });

  [
    { x: 356, y: 34 },
    { x: 362, y: 34 },
    { x: 368, y: 34 },
    { x: 112, y: 72 },
    { x: 118, y: 72 },
    { x: 124, y: 72 },
    { x: 276, y: 110 },
    { x: 282, y: 110 },
    { x: 288, y: 110 },
  ].forEach((light) => {
    drawPixelRect(ctx, light.x, light.y, 4, 2, palette.plankD);
    drawPixelRect(ctx, light.x + 1, light.y, 2, 1, "#ffffff");
  });

  for (let x = 88; x < 392; x += 42) {
    const y = 36 + ((x * 7) % 68);
    drawPixelRect(ctx, x, y, 2, 2, palette.grainDark);
    drawPixelRect(ctx, x + 10, y + 8, 3, 1, palette.highlight);
  }

  drawPixelRect(ctx, 76, 118, 328, 10, palette.seam);
  drawPixelRect(ctx, 76, 118, 328, 2, palette.highlight);
  drawPixelRect(ctx, 84, 122, 72, 2, palette.plankB);
  drawPixelRect(ctx, 188, 122, 92, 2, palette.plankB);
  drawPixelRect(ctx, 314, 122, 72, 2, palette.plankB);
  drawPixelRect(ctx, 206, 119, 28, 4, palette.plankD);
  drawPixelRect(ctx, 212, 120, 16, 1, "#ffffff");
};

const drawWall = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  if (surface.id === "exposed-red-brick-wallpaper") {
    drawExposedBrickWallpaper(ctx, surface);
    return;
  }

  if (surface.id === "purple-bubble-wallpaper") {
    drawBubbleWallpaper(ctx, surface);
    return;
  }

  if (surface.id === "pink-sakura-wallpaper") {
    drawSakuraWallpaper(ctx, surface);
    return;
  }

  if (surface.id === "warm-ivory-wallpaper") {
    drawIvoryWallpaper(ctx, surface);
    return;
  }

  if (surface.id === "white-tech-wallpaper") {
    drawWhiteTechWallpaper(ctx, surface);
    return;
  }

  if (surface.id === "hermes-green-paint") {
    drawLatexPaintWall(ctx, surface);
    return;
  }

  drawWoodWall(ctx, surface);
};

const drawCozyWindow = (
  ctx: CanvasRenderingContext2D,
  windowDefinition: RoomWindowDefinition,
) => {
  const { x, y, width, height } = windowDefinition;
  const frame = Math.max(4, Math.round(Math.min(width, height) * 0.08));
  const innerX = x + frame;
  const innerY = y + frame;
  const innerWidth = width - frame * 2;
  const innerHeight = height - frame * 2;
  const paneWidth = Math.floor((innerWidth - frame) / 2);

  drawPixelRect(ctx, x, y, width, height, "#3d1f11");
  drawPixelRect(ctx, innerX, innerY, innerWidth, innerHeight, "#f0c36f");
  drawPixelRect(ctx, innerX + frame, innerY + frame, paneWidth - frame, innerHeight - frame * 2, "#fff0bf");
  drawPixelRect(
    ctx,
    innerX + paneWidth + frame,
    innerY + frame,
    paneWidth - frame,
    innerHeight - frame * 2,
    "#bfe6ee",
  );
  drawPixelRect(ctx, innerX + paneWidth, innerY, frame, innerHeight, "#8d4c22");
  drawPixelRect(ctx, innerX, innerY + Math.floor(innerHeight / 2), innerWidth, frame, "#8d4c22");
  drawPixelRect(ctx, innerX + frame, innerY + frame, paneWidth - frame, 4, "#fff9dd");
  drawPixelRect(
    ctx,
    innerX + paneWidth + frame,
    innerY + frame,
    paneWidth - frame,
    4,
    "#e3fbff",
  );
};

const hexToRgb = (color: string) => ({
  r: Number.parseInt(color.slice(1, 3), 16),
  g: Number.parseInt(color.slice(3, 5), 16),
  b: Number.parseInt(color.slice(5, 7), 16),
});

const mixChannel = (from: number, to: number, amount: number) =>
  Math.round(from + (to - from) * amount);

const smoothstep = (amount: number) => amount * amount * (3 - 2 * amount);

const mixColor = (from: string, to: string, amount: number) => {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const smoothAmount = smoothstep(Math.max(0, Math.min(1, amount)));

  return `rgb(${mixChannel(start.r, end.r, smoothAmount)}, ${mixChannel(start.g, end.g, smoothAmount)}, ${mixChannel(start.b, end.b, smoothAmount)})`;
};

const colorAtHour = (
  hour: number,
  stops: Array<{ hour: number; color: string }>,
) => {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const sortedStops = [...stops].sort((a, b) => a.hour - b.hour);
  const wrappedStops = [
    ...sortedStops,
    { hour: sortedStops[0].hour + 24, color: sortedStops[0].color },
  ];

  for (let index = 0; index < wrappedStops.length - 1; index += 1) {
    const current = wrappedStops[index];
    const next = wrappedStops[index + 1];
    const currentHour =
      normalizedHour < sortedStops[0].hour ? normalizedHour + 24 : normalizedHour;

    if (currentHour >= current.hour && currentHour <= next.hour) {
      return mixColor(
        current.color,
        next.color,
        (currentHour - current.hour) / (next.hour - current.hour),
      );
    }
  }

  return sortedStops[0].color;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const smoothRange = (hour: number, start: number, end: number) =>
  smoothstep(clamp01((hour - start) / (end - start)));

const dayWindowVisibilityAtHour = (hour: number) => {
  if (hour >= 5 && hour < 7.5) return smoothRange(hour, 5, 7.5);
  if (hour >= 7.5 && hour < 16.5) return 1;
  if (hour >= 16.5 && hour < 19) return 1 - smoothRange(hour, 16.5, 19);

  return 0;
};

const interiorLightActivityAtHour = (hour: number) => {
  if (hour >= 16.5 && hour < 20) return 0.08 + smoothRange(hour, 16.5, 20) * 0.82;
  if (hour >= 20 && hour < 23) return 0.9;
  if (hour >= 23) return 0.9 - smoothRange(hour, 23, 24) * 0.42;
  if (hour < 2) return 0.48 - smoothRange(hour, 0, 2) * 0.34;
  if (hour < 5) return 0.1;
  if (hour < 7) return 0.1 - smoothRange(hour, 5, 7) * 0.1;

  return 0;
};

const drawCityNightWindow = (
  ctx: CanvasRenderingContext2D,
  windowDefinition: RoomWindowDefinition,
  animationFrame: number,
  windowTimeMs: number,
) => {
  const { x, y, width, height } = windowDefinition;
  const frameSize = Math.max(5, Math.round(Math.min(width, height) * 0.08));
  const glassX = x + frameSize;
  const glassY = y + frameSize;
  const glassWidth = width - frameSize * 2;
  const glassHeight = height - frameSize * 2;
  const windowDate = new Date(windowTimeMs);
  const hour = windowDate.getHours() + windowDate.getMinutes() / 60;
  const isDay = hour >= 7 && hour < 17;
  const isDusk = hour >= 17 && hour < 20;
  const isDawn = hour >= 5 && hour < 7;
  const skyBase = colorAtHour(hour, [
    { hour: 0, color: "#10162d" },
    { hour: 5, color: "#243c66" },
    { hour: 7, color: "#86c7e8" },
    { hour: 12, color: "#7ec7ed" },
    { hour: 17, color: "#514078" },
    { hour: 20, color: "#172850" },
  ]);
  const skyBand = colorAtHour(hour, [
    { hour: 0, color: "#172850" },
    { hour: 5, color: "#456a8e" },
    { hour: 7, color: "#b7e6f4" },
    { hour: 12, color: "#c6edf7" },
    { hour: 17, color: "#9b5b77" },
    { hour: 20, color: "#1d3158" },
  ]);
  const dayWindowAmount = dayWindowVisibilityAtHour(hour);
  const interiorLightAmount = interiorLightActivityAtHour(hour);
  const interiorLightVisualAlpha =
    hour >= 5 && hour < 7.5 ? 1 - smoothRange(hour, 5, 7.5) : 1;
  const glint = Math.floor(animationFrame / 28) % 2;
  const farWindowLightColors = isDay
    ? ["#6d8fa5", "#88a6ba"]
    : ["#d9a957", "#c98f4c", "#7fb2d8"];
  const nearWindowLightColors = isDay
    ? ["#88a6ba", "#6d8fa5"]
    : ["#ffd36f", "#ffbc5f", "#f7e0a0", "#ffa45c", "#8fd3ff"];
  const farDayWindowGlassColors = ["#526f86", "#6f8ea0", "#7aa0b0"];
  const nearDayWindowGlassColors = ["#587486", "#7294a4", "#7ea8b8", "#688b7c"];
  const celestialProgress =
    isDay || isDawn || isDusk
      ? Math.max(0, Math.min(1, (hour - 5) / 15))
      : hour >= 20
        ? Math.max(0, Math.min(1, (hour - 20) / 9))
        : Math.max(0, Math.min(1, (hour + 4) / 9));
  const celestialX = glassX + 6 + Math.round((glassWidth - 18) * celestialProgress);
  const celestialArc = Math.sin(celestialProgress * Math.PI);
  const celestialY = glassY + 22 - Math.round(celestialArc * 16);
  const drawWindowPixel = (
    pixelX: number,
    pixelY: number,
    pixelWidth: number,
    pixelHeight: number,
    color: string,
    alpha: number,
  ) => {
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha *= clamp01(alpha);
    drawPixelRect(ctx, pixelX, pixelY, pixelWidth, pixelHeight, color);
    ctx.restore();
  };
  const drawCelestialBody = () => {
    if (isDay || isDawn || isDusk) {
      drawPixelRect(ctx, celestialX, celestialY, 8, 8, "#fff4a3");
      drawPixelRect(ctx, celestialX - 2, celestialY + 8, 12, 2, "#ffe083");
      return;
    }

    drawPixelRect(ctx, celestialX + 1, celestialY, 6, 6, "#fff0b8");
    drawPixelRect(ctx, celestialX + 4, celestialY, 3, 5, skyBase);
  };
  const drawCloud = (cloudX: number, cloudY: number, cloudWidth: number) => {
    const cloudColor = colorAtHour(hour, [
      { hour: 0, color: "#202c4d" },
      { hour: 5, color: "#809bb7" },
      { hour: 7, color: "#dff5ff" },
      { hour: 12, color: "#e9fbff" },
      { hour: 17, color: "#73516f" },
      { hour: 20, color: "#26345a" },
    ]);
    const cloudShadow = colorAtHour(hour, [
      { hour: 0, color: "#151d38" },
      { hour: 5, color: "#617d9a" },
      { hour: 7, color: "#b6ddec" },
      { hour: 12, color: "#c9e7f1" },
      { hour: 17, color: "#4c3656" },
      { hour: 20, color: "#182240" },
    ]);

    drawPixelRect(ctx, cloudX, cloudY + 4, cloudWidth, 5, cloudShadow);
    drawPixelRect(ctx, cloudX + 4, cloudY + 1, Math.floor(cloudWidth * 0.45), 5, cloudColor);
    drawPixelRect(ctx, cloudX + Math.floor(cloudWidth * 0.38), cloudY, Math.floor(cloudWidth * 0.36), 6, cloudColor);
    drawPixelRect(ctx, cloudX + Math.floor(cloudWidth * 0.68), cloudY + 3, Math.floor(cloudWidth * 0.26), 5, cloudColor);
  };
  const drawClouds = () => {
    const drift = Math.floor(windowTimeMs / 120000) % (glassWidth + 56);
    const cloudA = glassX + ((drift + 10) % (glassWidth + 44)) - 28;
    const cloudB = glassX + ((drift + Math.floor(glassWidth * 0.55)) % (glassWidth + 56)) - 34;

    drawCloud(cloudA, glassY + 14, 26);
    drawCloud(cloudB, glassY + 27, 34);
  };

  drawPixelRect(ctx, x, y, width, height, "#26140c");
  drawPixelRect(ctx, glassX, glassY, glassWidth, glassHeight, skyBase);
  drawPixelRect(ctx, glassX, glassY, glassWidth, Math.max(6, Math.floor(glassHeight * 0.22)), skyBand);
  drawPixelRect(
    ctx,
    glassX + 8,
    glassY + Math.floor(glassHeight * 0.38),
    Math.floor(glassWidth * 0.72),
    1,
    isDay ? "#8ec4dc" : "#263a63",
  );
  ctx.save();
  ctx.beginPath();
  ctx.rect(glassX, glassY, glassWidth, glassHeight);
  ctx.clip();
  drawCelestialBody();
  drawClouds();

  const farBuildings = [
    { offset: 0, width: 0.1, height: 0.34 },
    { offset: 0.09, width: 0.12, height: 0.42 },
    { offset: 0.2, width: 0.09, height: 0.3 },
    { offset: 0.28, width: 0.14, height: 0.46 },
    { offset: 0.42, width: 0.1, height: 0.38 },
    { offset: 0.52, width: 0.13, height: 0.5 },
    { offset: 0.64, width: 0.1, height: 0.36 },
    { offset: 0.73, width: 0.15, height: 0.44 },
    { offset: 0.88, width: 0.12, height: 0.32 },
  ];

  farBuildings.forEach((building, index) => {
    const buildingWidth = Math.round(glassWidth * building.width);
    const buildingHeight = Math.round(glassHeight * building.height);
    const buildingX = glassX + Math.round(glassWidth * building.offset);
    const buildingY = glassY + glassHeight - buildingHeight;

    drawPixelRect(ctx, buildingX, buildingY, buildingWidth, buildingHeight, "#141c31");

    for (let lightY = buildingY + 6; lightY < glassY + glassHeight - 3; lightY += 8) {
      for (let lightX = buildingX + 3; lightX < buildingX + buildingWidth - 2; lightX += 7) {
        const lightSeed = lightX * 3 + lightY * 5 + index * 17;
        const dayPaneVisible = Math.abs(lightSeed) % 4 !== 0;
        const lightRank = Math.abs(lightSeed) % 100;

        if (dayPaneVisible) {
          drawWindowPixel(
            lightX,
            lightY,
            2,
            2,
            farDayWindowGlassColors[Math.abs(lightSeed) % farDayWindowGlassColors.length],
            dayWindowAmount * 0.78,
          );
        }
        drawWindowPixel(
          lightX,
          lightY,
          2,
          2,
          farWindowLightColors[Math.abs(lightSeed) % farWindowLightColors.length],
          lightRank < interiorLightAmount * 65 ? interiorLightVisualAlpha : 0,
        );
      }
    }
  });

  const buildings = [
    { offset: 0.03, width: 0.12, height: 0.58, color: "#1b2237" },
    { offset: 0.16, width: 0.13, height: 0.78, color: "#202944" },
    { offset: 0.3, width: 0.09, height: 0.64, color: "#182138" },
    { offset: 0.41, width: 0.14, height: 0.86, color: "#222b47" },
    { offset: 0.58, width: 0.11, height: 0.7, color: "#1c2540" },
    { offset: 0.7, width: 0.18, height: 0.76, color: "#1b243d" },
    { offset: 0.88, width: 0.1, height: 0.62, color: "#222b47" },
  ];

  buildings.forEach((building, index) => {
    const buildingWidth = Math.round(glassWidth * building.width);
    const buildingHeight = Math.round(glassHeight * building.height);
    const buildingX = glassX + Math.round(glassWidth * building.offset);
    const buildingY = glassY + glassHeight - buildingHeight;
    const beaconActive = isDusk || (!isDay && !isDawn);
    const beaconPulse = Math.floor((animationFrame + index * 9) / 18) % 4;
    const beaconColor =
      beaconPulse === 0 ? "#ff3b45" : beaconPulse === 1 ? "#d32035" : "#6e1b2a";
    const hasAntenna = index % 2 === 1;
    const hasRoofBeacon =
      beaconActive && building.height >= 0.62 && (hasAntenna || index % 2 === 0);

    drawPixelRect(ctx, buildingX, buildingY, buildingWidth, buildingHeight, building.color);
    if (hasAntenna) {
      drawPixelRect(ctx, buildingX + Math.floor(buildingWidth / 2), buildingY - 7, 2, 7, "#263553");
    }
    if (hasRoofBeacon) {
      drawPixelRect(
        ctx,
        buildingX + Math.floor(buildingWidth / 2),
        hasAntenna ? buildingY - 9 : buildingY - 3,
        2,
        2,
        beaconColor,
      );
    }
    drawPixelRect(ctx, buildingX + 2, buildingY + 2, buildingWidth - 4, 2, "#293657");

    for (let lightY = buildingY + 6; lightY < glassY + glassHeight - 4; lightY += 7) {
      for (let lightX = buildingX + 3; lightX < buildingX + buildingWidth - 3; lightX += 6) {
        const lightSeed = lightX * 7 + lightY * 3 + index * 19;
        const dayPaneVisible = Math.abs(lightSeed) % 5 !== 0;
        const lightRank = Math.abs(lightSeed + index * 11) % 100;

        if (dayPaneVisible) {
          drawWindowPixel(
            lightX,
            lightY,
            2,
            3,
            nearDayWindowGlassColors[
              Math.abs(lightSeed + index * 7) % nearDayWindowGlassColors.length
            ],
            dayWindowAmount * 0.82,
          );
        }
        drawWindowPixel(
          lightX,
          lightY,
          2,
          3,
          nearWindowLightColors[
            Math.abs(lightSeed + index * 11) % nearWindowLightColors.length
          ],
          lightRank < interiorLightAmount * 100 ? interiorLightVisualAlpha : 0,
        );
      }
    }
  });

  drawPixelRect(ctx, glassX + 6 + glint, glassY + 5, Math.floor(glassWidth * 0.34), 3, isDay ? "#eaf9ff" : "#49699f");
  drawPixelRect(ctx, glassX + 10, glassY + 12, 1, Math.floor(glassHeight * 0.22), isDay ? "#d6f3ff" : "#314b78");
  drawPixelRect(ctx, glassX + glassWidth - 18, glassY + 10, 1, Math.floor(glassHeight * 0.18), isDay ? "#c7ebfb" : "#263f6b");
  ctx.restore();
  drawPixelRect(ctx, x + frameSize, y + frameSize, glassWidth, 3, "#f4b563");
};

const drawOceanWindow = (
  ctx: CanvasRenderingContext2D,
  windowDefinition: RoomWindowDefinition,
  animationFrame: number,
  windowTimeMs: number,
) => {
  const { x, y, width, height } = windowDefinition;
  const frameSize = Math.max(5, Math.round(Math.min(width, height) * 0.07));
  const glassX = x + frameSize;
  const glassY = y + frameSize;
  const glassWidth = width - frameSize * 2;
  const glassHeight = height - frameSize * 2;
  const windowDate = new Date(windowTimeMs);
  const hour = windowDate.getHours() + windowDate.getMinutes() / 60;
  const isDay = hour >= 7 && hour < 17.5;
  const isDawn = hour >= 5 && hour < 7.2;
  const isDusk = hour >= 17.2 && hour < 19.7;
  const shipLightsOn = hour >= 18.2 || hour < 5.4;
  const horizonY = glassY + Math.round(glassHeight * 0.48);
  const seaTop = horizonY + 1;
  const skyBase = colorAtHour(hour, [
    { hour: 0, color: "#101735" },
    { hour: 4.8, color: "#27355d" },
    { hour: 6.4, color: "#f3a66f" },
    { hour: 8, color: "#8bd2f4" },
    { hour: 12, color: "#7bc8ee" },
    { hour: 16.8, color: "#7aa9d8" },
    { hour: 18.4, color: "#f09a73" },
    { hour: 20.3, color: "#1d315c" },
  ]);
  const skyBand = colorAtHour(hour, [
    { hour: 0, color: "#16264d" },
    { hour: 5.2, color: "#5b6289" },
    { hour: 6.5, color: "#ffd08f" },
    { hour: 9, color: "#d6f5ff" },
    { hour: 14, color: "#bcecff" },
    { hour: 17.3, color: "#ffc58a" },
    { hour: 19.4, color: "#704b7b" },
    { hour: 22, color: "#111b3f" },
  ]);
  const seaBase = colorAtHour(hour, [
    { hour: 0, color: "#17284d" },
    { hour: 5.2, color: "#355f7d" },
    { hour: 7, color: "#3f9fc2" },
    { hour: 12, color: "#2789b4" },
    { hour: 17.5, color: "#316f98" },
    { hour: 19, color: "#493e70" },
    { hour: 22, color: "#13254b" },
  ]);
  const seaBand = colorAtHour(hour, [
    { hour: 0, color: "#233963" },
    { hour: 5.8, color: "#6b8ea3" },
    { hour: 7, color: "#82d4df" },
    { hour: 13, color: "#5bbdd2" },
    { hour: 17.8, color: "#f0a26f" },
    { hour: 20, color: "#253a6a" },
  ]);
  const celestialProgress =
    isDay || isDawn || isDusk
      ? clamp01((hour - 5.2) / 14.5)
      : hour >= 19.7
        ? clamp01((hour - 19.7) / 9.5)
        : clamp01((hour + 4.3) / 9.5);
  const celestialX = glassX + 8 + Math.round((glassWidth - 20) * celestialProgress);
  const celestialArc = Math.sin(celestialProgress * Math.PI);
  const celestialY = glassY + 31 - Math.round(celestialArc * 24);
  const boatCycleA = 300000;
  const boatCycleB = 300000;
  const boatCycleC = 420000;
  const boatProgressA = (windowTimeMs % boatCycleA) / boatCycleA;
  const boatProgressB = ((windowTimeMs + boatCycleB * 0.38) % boatCycleB) / boatCycleB;
  const boatProgressC = ((windowTimeMs + boatCycleC * 0.18) % boatCycleC) / boatCycleC;
  const cloudDrift = Math.floor(windowTimeMs / 90000) % (glassWidth + 70);
  const waveShift = animationFrame * 0.28;
  const shimmerPulse = (Math.sin(animationFrame / 18) + 1) / 2;
  const reflectionColor = colorAtHour(hour, [
    { hour: 0, color: "#b9d6ff" },
    { hour: 5.8, color: "#ffe6b8" },
    { hour: 8, color: "#f7ffff" },
    { hour: 13, color: "#e8fff8" },
    { hour: 17.8, color: "#ffd39a" },
    { hour: 20, color: "#c7d7ff" },
  ]);
  const softReflectionColor = colorAtHour(hour, [
    { hour: 0, color: "#5f86c2" },
    { hour: 6, color: "#f4bd8d" },
    { hour: 9, color: "#bdf4ff" },
    { hour: 15, color: "#a6e5e7" },
    { hour: 18.5, color: "#e69082" },
    { hour: 21, color: "#5477b4" },
  ]);
  const horizonColor = colorAtHour(hour, [
    { hour: 0, color: "#314a78" },
    { hour: 5.8, color: "#d89c84" },
    { hour: 8, color: "#b9e4eb" },
    { hour: 13, color: "#9fd5df" },
    { hour: 17.8, color: "#d58b7b" },
    { hour: 20, color: "#405983" },
  ]);

  const drawCloud = (cloudX: number, cloudY: number, cloudWidth: number) => {
    const cloudColor = colorAtHour(hour, [
      { hour: 0, color: "#23335a" },
      { hour: 5.8, color: "#f4b88c" },
      { hour: 8, color: "#e8fbff" },
      { hour: 13, color: "#f4fdff" },
      { hour: 18, color: "#d98291" },
      { hour: 21, color: "#24365f" },
    ]);
    const cloudShadow = colorAtHour(hour, [
      { hour: 0, color: "#182746" },
      { hour: 6, color: "#c18484" },
      { hour: 9, color: "#bddfec" },
      { hour: 17.5, color: "#9a5b78" },
      { hour: 21, color: "#182747" },
    ]);

    drawPixelRect(ctx, cloudX, cloudY + 5, cloudWidth, 5, cloudShadow);
    drawPixelRect(ctx, cloudX + 4, cloudY + 2, Math.floor(cloudWidth * 0.42), 5, cloudColor);
    drawPixelRect(ctx, cloudX + Math.floor(cloudWidth * 0.34), cloudY, Math.floor(cloudWidth * 0.42), 7, cloudColor);
    drawPixelRect(ctx, cloudX + Math.floor(cloudWidth * 0.68), cloudY + 3, Math.floor(cloudWidth * 0.26), 5, cloudColor);
  };

  const drawShipRect = (
    rectX: number,
    rectY: number,
    rectWidth: number,
    rectHeight: number,
    color: string,
  ) => {
    ctx.fillStyle = color;
    ctx.fillRect(rectX, Math.round(rectY), Math.round(rectWidth), Math.round(rectHeight));
  };

  const oceanSparkleHash = (sparkleX: number, sparkleY: number) =>
    Math.abs((Math.round(sparkleX) * 73856093) ^ (Math.round(sparkleY) * 19349663));

  const drawOceanSparkles = () => {
    const seaHeight = glassY + glassHeight - seaTop;
    const reflectionCenterX = celestialX;
    const reflectionMaxWidth = Math.max(34, glassWidth * 0.42);

    for (let row = 0; row < 9; row += 1) {
      const waveY = seaTop + 5 + row * 5;
      const rowDepth = row / 8;
      const rowReflectionWidth = 10 + reflectionMaxWidth * rowDepth;
      const drift = (waveShift + row * 4) % 18;

      for (let waveX = glassX - 16 + drift; waveX < glassX + glassWidth; waveX += 10) {
        const hash = oceanSparkleHash(waveX + row * 13, waveY);
        const sparklePhase = (Math.sin(animationFrame / 10 + (hash % 17)) + 1) / 2;
        const distanceFromReflection = Math.abs(waveX - reflectionCenterX);
        const reflectionStrength = clamp01(
          1 - distanceFromReflection / rowReflectionWidth,
        );
        const baseVisible = hash % 5 !== 0;
        const breathingVisible =
          sparklePhase + shimmerPulse * 0.55 + reflectionStrength * 0.9 > 0.88;

        if (!baseVisible && reflectionStrength < 0.35) continue;
        if (!breathingVisible) continue;

        const sparkleWidth =
          reflectionStrength > 0.55 ? 3 + (hash % 4) : 1 + (hash % 3);
        const sparkleColor =
          reflectionStrength > 0.42 || sparklePhase > 0.8
            ? reflectionColor
            : row % 2 === 0
              ? softReflectionColor
              : "#7ed6e5";
        drawPixelRect(ctx, waveX, waveY, sparkleWidth, 1, sparkleColor);

        if (reflectionStrength > 0.6 && hash % 3 === 0) {
          drawPixelRect(ctx, waveX + sparkleWidth + 2, waveY + 2, 2, 1, softReflectionColor);
        }
      }
    }

    for (let stripe = 0; stripe < 5; stripe += 1) {
      const stripeY = seaTop + 7 + stripe * Math.max(5, Math.floor(seaHeight / 7));
      const stripeWidth = Math.max(8, Math.floor(30 - stripe * 3 + shimmerPulse * 8));
      drawPixelRect(
        ctx,
        reflectionCenterX - stripeWidth / 2 + Math.sin(animationFrame / 36 + stripe) * 1.5,
        stripeY,
        stripeWidth,
        1,
        stripe % 2 === 0 ? reflectionColor : softReflectionColor,
      );
    }
  };

  const drawCargoShip = (
    boatX: number,
    boatY: number,
    direction: -1 | 1,
  ) => {
    const bridgeX = boatX - direction * 4;
    drawShipRect(boatX - 10, boatY + 5, 20, 2, "#13243c");
    drawShipRect(boatX - 12, boatY + 2, 24, 4, "#37536b");
    drawShipRect(boatX - 9, boatY, 18, 2, "#d9553d");
    drawShipRect(boatX - 7, boatY - 2, 5, 2, "#f0b13f");
    drawShipRect(boatX - 1, boatY - 2, 5, 2, "#5fb1d4");
    drawShipRect(boatX + 5, boatY - 2, 5, 2, "#e7d15d");
    drawShipRect(bridgeX - 3, boatY - 6, 7, 4, "#e8f1f2");
    drawShipRect(bridgeX + direction * 4, boatY - 8, 2, 6, "#33475e");
    drawShipRect(bridgeX - 2, boatY - 5, 2, 1, "#6fb7d8");
    drawShipRect(bridgeX + 2, boatY - 5, 2, 1, "#6fb7d8");
    if (shipLightsOn) {
      drawShipRect(boatX - 6, boatY + 3, 2, 1, "#ffd56f");
      drawShipRect(boatX + 1, boatY + 3, 2, 1, "#ffd56f");
      drawShipRect(bridgeX - 1, boatY - 5, 1, 1, "#fff3a6");
      drawShipRect(bridgeX + 2, boatY - 5, 1, 1, "#fff3a6");
    }
    drawShipRect(boatX - 10, boatY + 10, 20, 1, "#d8fff7");
  };

  const drawDistantCargoShip = (
    boatX: number,
    boatY: number,
    direction: -1 | 1,
  ) => {
    const bridgeX = boatX - direction * 3;
    drawShipRect(boatX - 7, boatY + 3, 14, 1, "#172743");
    drawShipRect(boatX - 8, boatY + 1, 16, 3, "#415f73");
    drawShipRect(boatX - 5, boatY, 10, 1, "#c9563d");
    drawShipRect(boatX - 4, boatY - 1, 3, 1, "#e2b24c");
    drawShipRect(boatX, boatY - 1, 3, 1, "#73b8cd");
    drawShipRect(bridgeX - 2, boatY - 3, 5, 2, "#d7e7ea");
    drawShipRect(bridgeX + direction * 3, boatY - 4, 1, 3, "#3f5264");
    if (shipLightsOn) {
      drawShipRect(boatX - 3, boatY + 2, 1, 1, "#ffd56f");
      drawShipRect(boatX + 3, boatY + 2, 1, 1, "#ffd56f");
      drawShipRect(bridgeX, boatY - 2, 1, 1, "#fff3a6");
    }
    drawShipRect(boatX - 7, boatY + 6, 14, 1, softReflectionColor);
  };

  const drawCruiseShip = (
    boatX: number,
    boatY: number,
    direction: -1 | 1,
  ) => {
    const bowX = boatX + direction * 10;
    drawShipRect(boatX - 10, boatY + 5, 20, 2, "#16314f");
    drawShipRect(boatX - 12, boatY + 2, 24, 4, "#f1f6f7");
    drawShipRect(boatX - 9, boatY, 18, 2, "#e0edf2");
    drawShipRect(boatX - 6, boatY - 3, 13, 3, "#f7fbfb");
    drawShipRect(boatX - 4, boatY - 6, 6, 2, "#36506a");
    drawShipRect(bowX - direction * 2, boatY + 1, 3, 1, "#f1f6f7");
    for (let dot = -7; dot <= 7; dot += 4) {
      drawShipRect(boatX + dot, boatY + 1, 2, 1, "#4fa3c7");
      drawShipRect(boatX + dot, boatY - 2, 2, 1, "#4fa3c7");
    }
    if (shipLightsOn) {
      for (let dot = -7; dot <= 7; dot += 4) {
        drawShipRect(boatX + dot, boatY + 1, 1, 1, "#ffe28a");
        drawShipRect(boatX + dot, boatY - 2, 1, 1, "#fff3a6");
      }
    }
    drawShipRect(boatX - 10, boatY + 10, 20, 1, "#d8fff7");
  };

  drawPixelRect(ctx, x, y, width, height, "#2c160d");
  drawPixelRect(ctx, glassX, glassY, glassWidth, glassHeight, skyBase);
  drawPixelRect(ctx, glassX, glassY, glassWidth, Math.max(8, Math.floor(glassHeight * 0.22)), skyBand);

  ctx.save();
  ctx.beginPath();
  ctx.rect(glassX, glassY, glassWidth, glassHeight);
  ctx.clip();

  if (isDay || isDawn || isDusk) {
    drawPixelRect(ctx, celestialX - 4, celestialY - 4, 10, 10, "#fff2a0");
    drawPixelRect(ctx, celestialX - 7, celestialY + 5, 16, 2, "#ffd280");
  } else {
    drawPixelRect(ctx, celestialX - 3, celestialY - 3, 8, 8, "#f7efc1");
    drawPixelRect(ctx, celestialX + 1, celestialY - 3, 5, 7, skyBase);
  }

  drawCloud(glassX + ((cloudDrift + 8) % (glassWidth + 46)) - 30, glassY + 14, 32);
  drawCloud(glassX + ((cloudDrift + Math.floor(glassWidth * 0.52)) % (glassWidth + 62)) - 38, glassY + 30, 42);
  drawCloud(glassX + ((cloudDrift + Math.floor(glassWidth * 0.86)) % (glassWidth + 52)) - 34, glassY + 20, 26);

  drawPixelRect(ctx, glassX, horizonY, glassWidth, 1, horizonColor);
  drawPixelRect(ctx, glassX, horizonY + 1, glassWidth, 1, seaBand);
  drawPixelRect(ctx, glassX, seaTop, glassWidth, glassY + glassHeight - seaTop, seaBase);
  drawPixelRect(ctx, glassX, seaTop + 5, glassWidth, Math.floor((glassY + glassHeight - seaTop) * 0.32), seaBand);

  drawOceanSparkles();

  if (isDawn || isDusk) {
    const glowColor = isDawn ? "#ffd7a4" : "#ff9d7a";
    drawPixelRect(ctx, glassX + 6, horizonY - 5, glassWidth - 12, 2, glowColor);
    drawPixelRect(ctx, glassX + 18, seaTop + 8, Math.floor(glassWidth * 0.5), 2, glowColor);
    drawPixelRect(ctx, glassX + 34, seaTop + 17, Math.floor(glassWidth * 0.32), 1, "#ffe2a0");
  }

  drawCargoShip(
    glassX - 24 + (glassWidth + 48) * boatProgressA,
    seaTop + 18,
    1,
  );
  drawDistantCargoShip(
    glassX + glassWidth + 18 - (glassWidth + 36) * boatProgressC,
    seaTop + 6,
    -1,
  );
  drawCruiseShip(
    glassX + glassWidth + 24 - (glassWidth + 48) * boatProgressB,
    seaTop + 25,
    -1,
  );

  drawPixelRect(ctx, glassX + 7, glassY + 5, Math.floor(glassWidth * 0.36), 3, isDay ? "#e8fbff" : "#49699f");
  drawPixelRect(ctx, glassX + glassWidth - 24, glassY + 9, 1, Math.floor(glassHeight * 0.28), isDay ? "#c8eefb" : "#2b4776");
  ctx.restore();

  drawPixelRect(ctx, x + frameSize, y + frameSize, glassWidth, 3, "#f4b563");
  drawPixelRect(ctx, x + frameSize, y + height - frameSize - 3, glassWidth, 3, "#5a2d16");
};

const drawCyberpunkCityWindow = (
  ctx: CanvasRenderingContext2D,
  windowDefinition: RoomWindowDefinition,
  animationFrame: number,
  windowTimeMs: number,
) => {
  const { x, y, width, height } = windowDefinition;
  const frameSize = Math.max(5, Math.round(Math.min(width, height) * 0.07));
  const glassX = x + frameSize;
  const glassY = y + frameSize;
  const glassWidth = width - frameSize * 2;
  const glassHeight = height - frameSize * 2;
  const windowDate = new Date(windowTimeMs);
  const hour = windowDate.getHours() + windowDate.getMinutes() / 60;
  const isDay = hour >= 7 && hour < 17.2;
  const isDawn = hour >= 5 && hour < 7.4;
  const isDusk = hour >= 17.2 && hour < 20.2;
  const trafficLightsOn = hour >= 17.8 || hour < 5.6;
  const dayWindowAmount = dayWindowVisibilityAtHour(hour);
  const interiorLightAmount = interiorLightActivityAtHour(hour);
  const interiorLightVisualAlpha =
    hour >= 5 && hour < 7.5 ? 1 - smoothRange(hour, 5, 7.5) : 1;
  const morningGoldAmount =
    hour >= 5 && hour < 9.2
      ? hour < 6.9
        ? smoothRange(hour, 5, 6.9)
        : 1 - smoothRange(hour, 6.9, 9.2)
      : 0;
  const duskRoseAmount =
    hour >= 16.3 && hour < 20.3
      ? hour < 18.4
        ? smoothRange(hour, 16.3, 18.4)
        : 1 - smoothRange(hour, 18.4, 20.3)
      : 0;
  const skylineBottom = glassY + glassHeight;
  const skyBase = colorAtHour(hour, [
    { hour: 0, color: "#0c132a" },
    { hour: 5.2, color: "#26345d" },
    { hour: 6.4, color: "#f29a64" },
    { hour: 8, color: "#8dccec" },
    { hour: 12, color: "#78badb" },
    { hour: 16.8, color: "#5e7fb1" },
    { hour: 18.4, color: "#bd6d86" },
    { hour: 20.3, color: "#17264a" },
  ]);
  const skyBand = colorAtHour(hour, [
    { hour: 0, color: "#18234a" },
    { hour: 5.4, color: "#5a6088" },
    { hour: 6.5, color: "#ffd08a" },
    { hour: 9, color: "#d8f5ff" },
    { hour: 14, color: "#b9e7f7" },
    { hour: 17.4, color: "#ffaf89" },
    { hour: 19.6, color: "#4b3b73" },
    { hour: 22, color: "#111b3b" },
  ]);
  const farMetalColor = colorAtHour(hour, [
    { hour: 0, color: "#151d31" },
    { hour: 6.3, color: "#46546a" },
    { hour: 8.2, color: "#253545" },
    { hour: 13, color: "#1f2d3a" },
    { hour: 18.3, color: "#5b3e4d" },
    { hour: 20.2, color: "#151c31" },
  ]);
  const midMetalColor = colorAtHour(hour, [
    { hour: 0, color: "#101826" },
    { hour: 6.3, color: "#536276" },
    { hour: 8.2, color: "#22313e" },
    { hour: 13, color: "#1c2934" },
    { hour: 18.3, color: "#704a55" },
    { hour: 20.2, color: "#121927" },
  ]);
  const nearMetalColor = colorAtHour(hour, [
    { hour: 0, color: "#0b111c" },
    { hour: 6.3, color: "#445061" },
    { hour: 8.2, color: "#182531" },
    { hour: 13, color: "#15222d" },
    { hour: 18.3, color: "#5d3d45" },
    { hour: 20.2, color: "#0d121d" },
  ]);
  const detailColor = colorAtHour(hour, [
    { hour: 0, color: "#26324e" },
    { hour: 6.5, color: "#d19b70" },
    { hour: 8.5, color: "#3d5265" },
    { hour: 13, color: "#304555" },
    { hour: 18.5, color: "#c07672" },
    { hour: 21, color: "#1d2945" },
  ]);
  const edgeWarmColor = morningGoldAmount >= duskRoseAmount ? "#ffd178" : "#ff9d87";
  const bridgeColor = colorAtHour(hour, [
    { hour: 0, color: "#1b253c" },
    { hour: 7, color: "#415766" },
    { hour: 13, color: "#334653" },
    { hour: 18.4, color: "#8f5a63" },
    { hour: 21, color: "#172137" },
  ]);
  const glint = Math.floor(animationFrame / 30) % 2;

  const drawPixelWithAlpha = (
    targetCtx: CanvasRenderingContext2D,
    pixelX: number,
    pixelY: number,
    pixelWidth: number,
    pixelHeight: number,
    color: string,
    alpha: number,
  ) => {
    if (alpha <= 0) return;

    targetCtx.save();
    targetCtx.globalAlpha *= clamp01(alpha);
    drawPixelRect(targetCtx, pixelX, pixelY, pixelWidth, pixelHeight, color);
    targetCtx.restore();
  };

  const cyberHash = (hashX: number, hashY: number, salt: number) =>
    Math.abs((Math.round(hashX) * 73856093) ^ (Math.round(hashY) * 19349663) ^ (salt * 83492791));

  const drawCloud = (cloudX: number, cloudY: number, cloudWidth: number, alpha = 0.92) => {
    const cloudColor = colorAtHour(hour, [
      { hour: 0, color: "#25345d" },
      { hour: 5.9, color: "#f3b08b" },
      { hour: 8, color: "#eafdff" },
      { hour: 13, color: "#f4fdff" },
      { hour: 18.1, color: "#d78396" },
      { hour: 21, color: "#24345b" },
    ]);
    const cloudShadow = colorAtHour(hour, [
      { hour: 0, color: "#172541" },
      { hour: 6, color: "#b87b82" },
      { hour: 9, color: "#bddfec" },
      { hour: 17.8, color: "#9a5775" },
      { hour: 21, color: "#172540" },
    ]);

    drawPixelWithAlpha(ctx, cloudX, cloudY + 5, cloudWidth, 5, cloudShadow, alpha);
    drawPixelWithAlpha(ctx, cloudX + 4, cloudY + 2, Math.floor(cloudWidth * 0.42), 5, cloudColor, alpha);
    drawPixelWithAlpha(
      ctx,
      cloudX + Math.floor(cloudWidth * 0.34),
      cloudY,
      Math.floor(cloudWidth * 0.42),
      7,
      cloudColor,
      alpha,
    );
    drawPixelWithAlpha(
      ctx,
      cloudX + Math.floor(cloudWidth * 0.68),
      cloudY + 3,
      Math.floor(cloudWidth * 0.26),
      5,
      cloudColor,
      alpha,
    );
  };

  type CyberTower = {
    offset: number;
    width: number;
    height: number;
    topInset?: number;
    spire?: number;
    crown?: "needle" | "fork" | "flat";
    beacon?: boolean;
  };

  const drawCyberTower = (
    tower: CyberTower,
    index: number,
    color: string,
    depth: number,
  ) => {
    const towerWidth = Math.max(5, Math.round(glassWidth * tower.width));
    const towerHeight = Math.max(16, Math.round(glassHeight * tower.height));
    const towerX = glassX + Math.round(glassWidth * tower.offset);
    const towerY = skylineBottom - towerHeight;
    const topInset = tower.topInset ?? (index % 3 === 0 ? 0.18 : 0.1);
    const shoulderHeight = Math.round(towerHeight * (index % 2 === 0 ? 0.16 : 0.1));
    const insetPixels = Math.max(1, Math.round(towerWidth * topInset));
    const upperWidth = Math.max(3, towerWidth - insetPixels * 2);
    const upperX = towerX + Math.round((towerWidth - upperWidth) / 2);
    const warmEdgeAlpha = Math.max(morningGoldAmount, duskRoseAmount * 0.92) * (0.45 + depth * 0.42);
    const sideShade = depth > 0.72 ? "#080d16" : "#11192b";
    const paneStepX = depth > 0.72 ? 4 : 3;
    const paneStepY = depth > 0.72 ? 5 : 4;
    const paneWidth = depth > 0.72 ? 2 : 1;
    const paneHeight = depth > 0.72 ? 2 : 1;
    const lightDensity = depth > 0.72 ? 116 : 94;

    drawPixelRect(ctx, towerX, towerY + shoulderHeight, towerWidth, towerHeight - shoulderHeight, color);
    drawPixelRect(ctx, upperX, towerY, upperWidth, shoulderHeight + 2, color);
    drawPixelWithAlpha(ctx, towerX, towerY + shoulderHeight, 2, towerHeight - shoulderHeight, edgeWarmColor, warmEdgeAlpha);
    drawPixelWithAlpha(ctx, upperX, towerY, 2, shoulderHeight + 2, edgeWarmColor, warmEdgeAlpha);
    drawPixelWithAlpha(ctx, towerX + towerWidth - 2, towerY + 4, 2, towerHeight - 4, sideShade, 0.48);
    drawPixelRect(ctx, towerX + 2, towerY + shoulderHeight + 2, Math.max(1, towerWidth - 4), 1, detailColor);

    if (tower.crown === "fork") {
      drawPixelRect(ctx, upperX + 1, towerY - 7, 1, 7, detailColor);
      drawPixelRect(ctx, upperX + upperWidth - 2, towerY - 6, 1, 6, detailColor);
    } else if (tower.crown === "needle" || tower.spire) {
      const spireHeight = tower.spire ?? 9;
      const spireX = upperX + Math.floor(upperWidth / 2);
      drawPixelRect(ctx, spireX, towerY - spireHeight, 1 + (depth > 0.75 ? 1 : 0), spireHeight, detailColor);
    }

    if (tower.beacon && (isDusk || trafficLightsOn)) {
      const pulse = Math.floor((animationFrame + index * 11) / 18) % 4;
      const beaconColor = pulse === 0 ? "#ff3b45" : pulse === 1 ? "#ff6a36" : "#7e1f2a";
      drawPixelRect(ctx, upperX + Math.floor(upperWidth / 2), towerY - (tower.spire ?? 4) - 2, 2, 2, beaconColor);
    }

    for (let bandY = towerY + shoulderHeight + 8; bandY < skylineBottom - 3; bandY += 11) {
      drawPixelWithAlpha(ctx, towerX + 2, bandY, towerWidth - 4, 1, detailColor, 0.55);
    }

    for (let ribX = towerX + 4; ribX < towerX + towerWidth - 3; ribX += Math.max(7, paneStepX * 2)) {
      drawPixelWithAlpha(ctx, ribX, towerY + shoulderHeight + 3, 1, towerHeight - shoulderHeight - 5, detailColor, 0.42);
    }

    for (let moduleY = towerY + shoulderHeight + 5; moduleY < skylineBottom - 6; moduleY += 13 + (index % 3)) {
      const moduleSeed = cyberHash(towerX + index, moduleY, 43);
      const moduleInset = 2 + (moduleSeed % Math.max(2, Math.floor(towerWidth * 0.22)));
      const moduleWidth = Math.max(3, Math.floor(towerWidth * (0.26 + (moduleSeed % 4) * 0.08)));
      drawPixelWithAlpha(ctx, towerX + moduleInset, moduleY, moduleWidth, 1, detailColor, 0.34 + depth * 0.18);
    }

    for (let shaftY = towerY + shoulderHeight + 10; shaftY < skylineBottom - 8; shaftY += 17) {
      const leftClamp = towerX + 1 + ((shaftY + index) % 3);
      const rightClamp = towerX + towerWidth - 3 - ((shaftY + index) % 2);
      drawPixelWithAlpha(ctx, leftClamp, shaftY, 1, Math.min(7, skylineBottom - shaftY - 3), detailColor, 0.3);
      drawPixelWithAlpha(ctx, rightClamp, shaftY + 3, 1, Math.min(6, skylineBottom - shaftY - 6), sideShade, 0.38);
    }

    if (towerWidth >= 12) {
      for (let terraceY = towerY + shoulderHeight + 14 + (index % 4); terraceY < skylineBottom - 8; terraceY += 22) {
        const terraceSide = (terraceY + index) % 2 === 0 ? -1 : 1;
        const terraceX = terraceSide < 0 ? towerX - 2 : towerX + towerWidth - 1;
        drawPixelWithAlpha(ctx, terraceX, terraceY, 3, 1, detailColor, 0.42);
      }
    }

    for (let paneY = towerY + shoulderHeight + 6; paneY < skylineBottom - 4; paneY += paneStepY) {
      for (let paneX = towerX + 3; paneX < towerX + towerWidth - 3; paneX += paneStepX) {
        const seed = cyberHash(paneX, paneY, index + 3);
        if (seed % 29 === 0) continue;

        if (dayWindowAmount > 0 && seed % 4 !== 0) {
          const dayPaneColors = ["#4f6b80", "#617f91", "#7895a5", "#4e665d"];
          drawPixelWithAlpha(
            ctx,
            paneX,
            paneY,
            paneWidth,
            paneHeight,
            dayPaneColors[seed % dayPaneColors.length],
            dayWindowAmount * (0.34 + depth * 0.24),
          );
        }

        const lightRank = cyberHash(paneX + index * 5, paneY, index + 13) % 100;
        if (lightRank < interiorLightAmount * lightDensity) {
          const lightColors = ["#ffd36f", "#ffad55", "#ff8a3a", "#f7d088", "#ff6f32"];
          drawPixelWithAlpha(
            ctx,
            paneX,
            paneY,
            paneWidth,
            paneHeight,
            lightColors[(seed + index) % lightColors.length],
            interiorLightVisualAlpha,
          );
        }
      }
    }
  };

  const drawFlyingTraffic = () => {
    const drawTrafficPixel = (
      trafficX: number,
      trafficY: number,
      pixelWidth: number,
      pixelHeight: number,
      color: string,
      alpha: number,
    ) => {
      if (alpha <= 0) return;

      ctx.save();
      ctx.globalAlpha *= clamp01(alpha);
      ctx.fillStyle = color;
      ctx.fillRect(trafficX, Math.round(trafficY), pixelWidth, pixelHeight);
      ctx.restore();
    };

    const laneYs = [18, 27, 36, 45, 54, 63, 72];
    laneYs.forEach((laneY, lane) => {
      const cycle = 87500 + lane * 10500;
      const direction = lane % 2 === 0 ? 1 : -1;
      const totalTravel = glassWidth + 34;
      const dotCount = lane < 4 ? 13 : 17;

      for (let dot = 0; dot < dotCount; dot += 1) {
        const progress = ((windowTimeMs + dot * (cycle / dotCount) + lane * 14731) % cycle) / cycle;
        const trafficX =
          direction === 1
            ? glassX - 16 + totalTravel * progress
            : glassX + glassWidth + 16 - totalTravel * progress;
        const trafficPhase = progress * Math.PI * 2 + lane * 0.7 + dot * 0.19;
        const trafficY = glassY + laneY + Math.sin(trafficPhase) * 1.4;
        const seed = cyberHash(dot * 17 + lane * 31, laneY, lane + 71);
        const dotWidth = trafficLightsOn
          ? seed % 5 === 0
            ? 3
            : 2
          : seed % 6 === 0
            ? 2
            : 1.5;

        if (trafficLightsOn) {
          const trafficColors = ["#ff6d2f", "#ff973a", "#d92c24", "#ffbd58"];
          const trafficColor = trafficColors[seed % trafficColors.length];
          drawTrafficPixel(trafficX, trafficY, dotWidth, 1, trafficColor, 0.9);
          if (seed % 3 === 0) {
            drawTrafficPixel(trafficX - direction * 2, trafficY, 1.5, 1, "#5a1d25", 0.22);
          }
        } else {
          const trafficColors = ["#1f2c36", "#2f3d48", "#3d4f5a", "#263642"];
          drawTrafficPixel(
            trafficX,
            trafficY,
            dotWidth,
            1,
            trafficColors[seed % trafficColors.length],
            0.78,
          );
          if (seed % 7 === 0) {
            drawTrafficPixel(trafficX + 1, trafficY - 1, 1, 1, "#9fb7c5", 0.35);
          }
        }
      }
    });
  };

  const drawNeonBillboard = () => {
    const signX = glassX + Math.floor(glassWidth * 0.62);
    const signY = glassY + Math.floor(glassHeight * 0.58);
    const signWidth = 6;
    const signHeight = 24;
    const pulse = (Math.sin(animationFrame / 9) + 1) / 2;
    const scanY = signY + (animationFrame % signHeight);
    const neonAlpha = trafficLightsOn || isDusk ? 0.72 + pulse * 0.28 : 0.26;

    drawPixelWithAlpha(ctx, signX, signY, signWidth, signHeight, "#10091f", 0.92);
    drawPixelWithAlpha(ctx, signX - 1, signY + 1, 1, signHeight - 2, "#4b164b", neonAlpha * 0.45);
    drawPixelWithAlpha(ctx, signX, signY, 1, signHeight, "#ff4fd8", neonAlpha);
    drawPixelWithAlpha(ctx, signX + signWidth - 1, signY, 1, signHeight, "#33f4ff", neonAlpha);
    drawPixelWithAlpha(ctx, signX + 1, signY, signWidth - 2, 1, "#9d6bff", neonAlpha * 0.78);
    drawPixelWithAlpha(ctx, signX + 1, signY + signHeight - 1, signWidth - 2, 1, "#ff9d3f", neonAlpha * 0.76);
    drawPixelWithAlpha(ctx, signX + 1, scanY, signWidth - 2, 1, "#fff0a8", neonAlpha);

    for (let dash = 3; dash < signHeight - 2; dash += 5) {
      const dashOn = Math.floor(animationFrame / 16 + dash) % 2 === 0;
      drawPixelWithAlpha(
        ctx,
        signX + 2,
        signY + dash,
        2,
        2,
        dashOn ? "#ff9d3f" : "#7040ff",
        neonAlpha,
      );
    }
  };

  const farTowers: CyberTower[] = [
    { offset: -0.03, width: 0.08, height: 0.44, crown: "needle", spire: 7 },
    { offset: 0.06, width: 0.08, height: 0.9, crown: "needle", spire: 18 },
    { offset: 0.18, width: 0.06, height: 0.48, crown: "flat" },
    { offset: 0.27, width: 0.08, height: 0.62, crown: "fork" },
    { offset: 0.4, width: 0.07, height: 0.8, crown: "needle", spire: 14 },
    { offset: 0.53, width: 0.06, height: 0.58, crown: "flat" },
    { offset: 0.65, width: 0.07, height: 0.72, crown: "needle", spire: 10 },
    { offset: 0.78, width: 0.07, height: 0.86, crown: "needle", spire: 13 },
    { offset: 0.91, width: 0.06, height: 0.52, crown: "fork" },
  ];
  const midTowers: CyberTower[] = [
    { offset: -0.01, width: 0.1, height: 0.72, topInset: 0.12, crown: "needle", spire: 11, beacon: true },
    { offset: 0.12, width: 0.08, height: 0.34, topInset: 0.08 },
    { offset: 0.25, width: 0.09, height: 0.6, crown: "fork" },
    { offset: 0.39, width: 0.11, height: 0.88, topInset: 0.16, crown: "needle", spire: 16, beacon: true },
    { offset: 0.5, width: 0.1, height: 0.96, topInset: 0.22, crown: "needle", spire: 18, beacon: true },
    { offset: 0.62, width: 0.08, height: 0.64, crown: "flat" },
    { offset: 0.72, width: 0.11, height: 0.8, topInset: 0.18, crown: "needle", spire: 12, beacon: true },
    { offset: 0.88, width: 0.09, height: 0.56, topInset: 0.08 },
  ];
  const nearTowers: CyberTower[] = [
    { offset: -0.05, width: 0.12, height: 0.88, topInset: 0.08, crown: "needle", spire: 10, beacon: true },
    { offset: 0.14, width: 0.12, height: 0.28, topInset: 0.06 },
    { offset: 0.34, width: 0.08, height: 0.34, topInset: 0.12 },
    { offset: 0.48, width: 0.09, height: 0.44, topInset: 0.18 },
    { offset: 0.66, width: 0.08, height: 0.38, topInset: 0.1 },
    { offset: 0.84, width: 0.16, height: 0.5, topInset: 0.08, beacon: true },
  ];

  const drawRoundedPixelRect = (
    rectX: number,
    rectY: number,
    rectWidth: number,
    rectHeight: number,
    radius: number,
    color: string,
  ) => {
    const roundedRadius = Math.max(0, Math.min(radius, rectWidth / 2, rectHeight / 2));

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(Math.round(rectX + roundedRadius), Math.round(rectY));
    ctx.lineTo(Math.round(rectX + rectWidth - roundedRadius), Math.round(rectY));
    ctx.quadraticCurveTo(
      Math.round(rectX + rectWidth),
      Math.round(rectY),
      Math.round(rectX + rectWidth),
      Math.round(rectY + roundedRadius),
    );
    ctx.lineTo(Math.round(rectX + rectWidth), Math.round(rectY + rectHeight - roundedRadius));
    ctx.quadraticCurveTo(
      Math.round(rectX + rectWidth),
      Math.round(rectY + rectHeight),
      Math.round(rectX + rectWidth - roundedRadius),
      Math.round(rectY + rectHeight),
    );
    ctx.lineTo(Math.round(rectX + roundedRadius), Math.round(rectY + rectHeight));
    ctx.quadraticCurveTo(
      Math.round(rectX),
      Math.round(rectY + rectHeight),
      Math.round(rectX),
      Math.round(rectY + rectHeight - roundedRadius),
    );
    ctx.lineTo(Math.round(rectX), Math.round(rectY + roundedRadius));
    ctx.quadraticCurveTo(
      Math.round(rectX),
      Math.round(rectY),
      Math.round(rectX + roundedRadius),
      Math.round(rectY),
    );
    ctx.closePath();
    ctx.fill();
  };

  drawRoundedPixelRect(x, y, width, height, 10, "#68727b");
  drawRoundedPixelRect(x + 2, y + 2, width - 4, height - 4, 8, "#b7c1c8");
  drawRoundedPixelRect(x + 5, y + 5, width - 10, height - 10, 5, "#45515b");
  drawPixelRect(ctx, glassX, glassY, glassWidth, glassHeight, skyBase);
  drawPixelRect(ctx, glassX, glassY, glassWidth, Math.max(10, Math.floor(glassHeight * 0.26)), skyBand);

  ctx.save();
  ctx.beginPath();
  ctx.rect(glassX, glassY, glassWidth, glassHeight);
  ctx.clip();

  const celestialProgress =
    isDay || isDawn || isDusk
      ? clamp01((hour - 5.1) / 14.8)
      : hour >= 20.2
        ? clamp01((hour - 20.2) / 9.3)
        : clamp01((hour + 4.5) / 9.3);
  const celestialX = glassX + 8 + Math.round((glassWidth - 24) * celestialProgress);
  const celestialArc = Math.sin(celestialProgress * Math.PI);
  const celestialY = glassY + 34 - Math.round(celestialArc * 27);

  if (isDay || isDawn || isDusk) {
    drawPixelWithAlpha(ctx, celestialX - 5, celestialY - 5, 11, 11, "#fff2a0", 0.94);
    drawPixelWithAlpha(ctx, celestialX - 9, celestialY + 6, 18, 2, "#ffd27d", 0.86);
  } else {
    drawPixelWithAlpha(ctx, celestialX - 3, celestialY - 3, 8, 8, "#f5eec1", 0.82);
    drawPixelRect(ctx, celestialX + 1, celestialY - 3, 5, 7, skyBase);
  }

  if (isDawn || isDusk) {
    const glowColor = isDawn ? "#ffd083" : "#ff8d7b";
    drawPixelWithAlpha(ctx, glassX + 4, glassY + Math.floor(glassHeight * 0.45), Math.floor(glassWidth * 0.58), 2, glowColor, 0.78);
    drawPixelWithAlpha(ctx, glassX + 18, glassY + Math.floor(glassHeight * 0.54), Math.floor(glassWidth * 0.36), 1, "#ffe6a7", 0.65);
  }

  farTowers.forEach((tower, index) => drawCyberTower(tower, index, farMetalColor, 0.42));

  const cloudTravel = glassWidth + 88;
  const cloudDrift = (windowTimeMs / 98000) % cloudTravel;
  drawCloud(glassX + ((cloudDrift + 6) % cloudTravel) - 44, glassY + 28, 42, 0.78);
  drawCloud(glassX + ((cloudDrift + Math.floor(glassWidth * 0.45)) % cloudTravel) - 50, glassY + 42, 52, 0.86);
  drawCloud(glassX + ((cloudDrift + Math.floor(glassWidth * 0.78)) % cloudTravel) - 46, glassY + 26, 34, 0.72);

  midTowers.forEach((tower, index) => drawCyberTower(tower, index + 23, midMetalColor, 0.66));

  drawPixelWithAlpha(ctx, glassX + Math.floor(glassWidth * 0.58), glassY + Math.floor(glassHeight * 0.42), 52, 2, bridgeColor, 0.86);
  drawPixelWithAlpha(ctx, glassX + Math.floor(glassWidth * 0.2), glassY + Math.floor(glassHeight * 0.6), 38, 2, bridgeColor, 0.72);

  drawFlyingTraffic();

  nearTowers.forEach((tower, index) => drawCyberTower(tower, index + 47, nearMetalColor, 0.86));

  drawNeonBillboard();

  drawPixelWithAlpha(ctx, glassX + 7 + glint, glassY + 5, Math.floor(glassWidth * 0.34), 3, isDay ? "#e8fbff" : "#45669b", 0.72);
  drawPixelWithAlpha(ctx, glassX + glassWidth - 24, glassY + 8, 1, Math.floor(glassHeight * 0.3), isDay ? "#c8eefb" : "#2b4776", 0.72);
  ctx.restore();

  drawPixelRect(ctx, x + frameSize, y + frameSize, glassWidth, 2, "#edf7fb");
  drawPixelRect(ctx, x + frameSize, y + height - frameSize - 3, glassWidth, 3, "#5e6872");
  drawPixelRect(ctx, x + frameSize - 1, y + frameSize, 2, glassHeight, "#d5e1e7");
  drawPixelRect(ctx, x + width - frameSize - 1, y + frameSize, 2, glassHeight, "#3b4650");
};

const drawRoomWindow = (
  ctx: CanvasRenderingContext2D,
  windowDefinition: RoomWindowDefinition,
  frame: number,
  windowTimeMs: number,
) => {
  if (windowDefinition.kind === "city-night-window") {
    drawCityNightWindow(ctx, windowDefinition, frame, windowTimeMs);
    return;
  }

  if (windowDefinition.kind === "ocean-window") {
    drawOceanWindow(ctx, windowDefinition, frame, windowTimeMs);
    return;
  }

  if (windowDefinition.kind === "cyberpunk-city-window") {
    drawCyberpunkCityWindow(ctx, windowDefinition, frame, windowTimeMs);
    return;
  }

  drawCozyWindow(ctx, windowDefinition);
};

const drawWindowHighlight = (
  ctx: CanvasRenderingContext2D,
  windowDefinition: RoomWindowDefinition,
  valid = true,
) => {
  ctx.strokeStyle = valid ? "#ffe66d" : "#ff5c7a";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    Math.round(windowDefinition.x - 3),
    Math.round(windowDefinition.y - 3),
    Math.round(windowDefinition.width + 6),
    Math.round(windowDefinition.height + 6),
  );
};

const drawRoom = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  avatar: AvatarRuntime,
  frame: number,
  hoveredFurnitureId?: string | null,
  selectedFurnitureId?: string | null,
  selectedWindowId?: string | null,
  windowPreview?: WindowPlacementPreview | null,
  furniturePreview?: FurniturePlacementPreview | null,
  activeInteraction?: FurnitureInteractionState | null,
  floorUnderlay?: (() => void) | null,
  wallItems?: (() => void) | null,
  furnitureLayer: FurnitureRenderLayer = "all",
  windowTimeMs = Date.now(),
  taskCabinetFileCount = 0,
  failedTaskCabinetFileCount = 0,
  uiTheme: UiThemeId = "classic",
) => {
  ctx.fillStyle = isTerminalTheme(uiTheme)
    ? terminalRoomBackdropForTheme(uiTheme)
    : "#151523";
  ctx.fillRect(0, 0, sceneSize.width, sceneSize.height);

  const floorSurface = resolveSurface(
    content.room.floorSurfaces,
    content.room.floorSurfaceId,
    fallbackFloorPalette,
  );
  const wallSurface = resolveSurface(
    content.room.wallSurfaces,
    content.room.wallSurfaceId,
    fallbackWallPalette,
  );
  const roomWindow = resolveRoomWindow(content.room.windows, content.room.windowId);
  const previewWindow = windowPreview
    ? { ...windowPreview.window, x: windowPreview.x, y: windowPreview.y }
    : null;

  drawWall(ctx, wallSurface);
  drawFloor(ctx, floorSurface);
  drawRoomWindow(ctx, roomWindow, frame, windowTimeMs);
  if (roomWindow.id === selectedWindowId) {
    drawWindowHighlight(ctx, roomWindow);
  }
  if (previewWindow) {
    ctx.save();
    ctx.globalAlpha = 0.72;
    drawRoomWindow(ctx, previewWindow, frame, windowTimeMs);
    ctx.restore();
    drawWindowHighlight(ctx, previewWindow, windowPreview?.valid ?? true);
  }

  if (furnitureLayer === "behind-avatar") {
    wallItems?.();
  }

  drawPixelRect(ctx, 68, 12, 344, 8, "#f1a451");
  drawPixelRect(ctx, 68, 12, 8, 302, "#f1a451");
  drawPixelRect(ctx, 404, 12, 8, 302, "#f1a451");
  drawPixelRect(ctx, 68, 306, 344, 8, "#f1a451");
  drawPixelRect(ctx, 76, 20, 328, 5, "#ffe2a0");
  drawPixelRect(ctx, 76, 301, 328, 5, "#5a2d16");

  if (furnitureLayer === "behind-avatar") {
    floorUnderlay?.();
  }

  furnitureByDepth(content.room.furniture).forEach((item) => {
    const inFrontOfAvatar = isFurnitureInFrontOfAvatar(item, avatar);
    if (furnitureLayer === "behind-avatar" && inFrontOfAvatar && item.id !== "bed") return;
    if (furnitureLayer === "in-front-of-avatar" && !inFrontOfAvatar) return;

    const highlight =
      item.id === selectedFurnitureId
        ? "selected"
        : item.id === hoveredFurnitureId
          ? "hover"
          : "none";
    drawFurniture(
      ctx,
      item,
      highlight,
      frame,
      avatar,
      activeInteraction,
      taskCabinetFileCount,
      failedTaskCabinetFileCount,
    );
  });

  if (furniturePreview) {
    ctx.save();
    ctx.globalAlpha = 0.62;
    drawFurniture(
      ctx,
      {
        ...furniturePreview.furniture,
        x: furniturePreview.x,
        y: furniturePreview.y,
      },
      furniturePreview.valid ? "hover" : "selected",
      frame,
      avatar,
      null,
      taskCabinetFileCount,
      failedTaskCabinetFileCount,
    );
    ctx.restore();
  }
};

const drawStatusLights = (
  ctx: CanvasRenderingContext2D,
  status: CodexStatusMessage,
  uiTheme: UiThemeId = "classic",
) => {
  const colors: Record<CodexStatusMessage["status"], string> = {
    idle: "#8df7c4",
    thinking: "#ffe66d",
    executing: "#78a7ff",
    waiting_for_user: "#f2a65a",
    error: "#ff5c7a",
    complete: "#b4f56c",
  };

  const panel = isTerminalTheme(uiTheme)
    ? terminalStatusPanelForTheme(uiTheme)
    : "#c0c0c0";
  const text = isTerminalTheme(uiTheme)
    ? terminalStatusTextForTheme(uiTheme)
    : "#000000";
  const accent = isTerminalTheme(uiTheme)
    ? terminalScanlineForTheme(uiTheme)
    : "#808080";

  drawPixelRect(ctx, 22, 22, 82, 24, panel);
  if (isTerminalTheme(uiTheme)) {
    drawPixelRect(ctx, 24, 24, 78, 2, accent);
    drawPixelRect(ctx, 24, 42, 78, 2, accent);
  } else {
    drawPixelRect(ctx, 22, 22, 82, 2, "#ffffff");
    drawPixelRect(ctx, 22, 22, 2, 24, "#ffffff");
    drawPixelRect(ctx, 22, 44, 82, 2, "#404040");
    drawPixelRect(ctx, 102, 22, 2, 24, "#404040");
    drawPixelRect(ctx, 24, 24, 78, 2, "#dfdfdf");
    drawPixelRect(ctx, 24, 42, 78, 2, accent);
  }
  drawPixelRect(ctx, 30, 30, 8, 8, colors[status.status]);
  drawPixelText(ctx, status.status.replace("_for_user", ""), 44, 31, text);
};

const visibleRoomStatus = (status: CodexStatusMessage): CodexStatusMessage => {
  if (status.status !== "complete") return status;
  return deriveBehaviorFromCodex(status) === "success"
    ? status
    : { ...status, status: "idle" };
};

export const renderScene = (
  canvas: HTMLCanvasElement,
  content: AivatarContent,
  avatar: AvatarRuntime,
  status: CodexStatusMessage,
  frame: number,
  hoveredFurnitureId?: string | null,
  selectedFurnitureId?: string | null,
  activeInteraction?: FurnitureInteractionState | null,
  placementPreview?: PlacementPreview | null,
  selectedPlacedItemId?: string | null,
  selectedWindowId?: string | null,
  windowPreview?: WindowPlacementPreview | null,
  furniturePreview?: FurniturePlacementPreview | null,
  tableCoffeeQuantity = 0,
  memory?: AivatarMemory,
  windowTimeMs = Date.now(),
  taskCabinetFileCount = 0,
  failedTaskCabinetFileCount = 0,
  uiTheme: UiThemeId = "classic",
  showNavigationDebug = false,
  activeRecordPlayerId?: string | null,
) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = sceneSize.width;
  canvas.height = sceneSize.height;
  ctx.imageSmoothingEnabled = false;

  const floorSurface = resolveSurface(
    content.room.floorSurfaces,
    content.room.floorSurfaceId,
    fallbackFloorPalette,
  );

  drawRoom(
    ctx,
    content,
    avatar,
    frame,
    hoveredFurnitureId,
    selectedFurnitureId,
    selectedWindowId,
    windowPreview,
    furniturePreview,
    activeInteraction,
    () => drawFloorUnderlayItems(ctx, content, frame, avatar, selectedPlacedItemId),
    () =>
      drawWallPlacedItems(
        ctx,
        content,
        frame,
        avatar,
        selectedPlacedItemId,
        placementPreview,
      ),
    "behind-avatar",
    windowTimeMs,
    taskCabinetFileCount,
    failedTaskCabinetFileCount,
    uiTheme,
  );
  drawPlacedItems(
    ctx,
    content,
    frame,
    avatar,
    selectedPlacedItemId,
    placementPreview,
    activeInteraction,
    tableCoffeeQuantity,
    taskCabinetFileCount,
    failedTaskCabinetFileCount,
    "behind-avatar",
    activeRecordPlayerId,
  );
  drawAvatar(ctx, avatar, frame, content.petStats, status, memory);
  drawPlacedItems(
    ctx,
    content,
    frame,
    avatar,
    selectedPlacedItemId,
    null,
    activeInteraction,
    tableCoffeeQuantity,
    taskCabinetFileCount,
    failedTaskCabinetFileCount,
    "in-front-of-avatar",
    activeRecordPlayerId,
  );
  furnitureByDepth(content.room.furniture).forEach((item) => {
    if (!isFurnitureInFrontOfAvatar(item, avatar)) return;
    const highlight =
      item.id === selectedFurnitureId
        ? "selected"
        : item.id === hoveredFurnitureId
          ? "hover"
          : "none";
    if (item.id === "bed") {
      if (
        bedSkinId(item) === "modern-minimal-bed-skin" ||
        bedSkinId(item) === "space-white-deep-gray-bed-skin"
      ) {
        return;
      }
      drawBedFootboardAvatarOcclusion(ctx, item, avatar);
      return;
    }
    drawFurniture(
      ctx,
      item,
      highlight,
      frame,
      avatar,
      activeInteraction,
      taskCabinetFileCount,
      failedTaskCabinetFileCount,
    );
    drawPlacedItemsForSurface(
      ctx,
      content,
      item.id,
      frame,
      avatar,
      selectedPlacedItemId,
      activeInteraction,
      tableCoffeeQuantity,
      activeRecordPlayerId,
    );
    const surfacePreview = placementPreview;
    if (surfacePreview && isPreviewOnSurface(surfacePreview, item)) {
      drawPlaceableItem(
        ctx,
        surfacePreview.item.id,
        surfacePreview.x,
        surfacePreview.y,
        surfacePreview.valid ? "valid" : "invalid",
        frame,
        avatar,
      );
    }
  });
  drawFloorLightOverlay(ctx, floorSurface, content, avatar);
  drawSleepBlanketOverlay(ctx, content, avatar);
  if (status.status === "thinking") {
    drawCodexThinkingBubble(ctx, avatar, status, memory, uiTheme);
  } else if (activeInteraction?.bubbleText) {
    drawAvatarBubble(ctx, avatar, activeInteraction, uiTheme);
  } else {
    drawActivityBubble(ctx, avatar, memory, uiTheme);
  }
  drawSelectedInteractionPoints(
    ctx,
    content,
    selectedFurnitureId,
    selectedPlacedItemId,
  );
  if (showNavigationDebug) {
    drawNavigationDebugOverlay(ctx, content, avatar);
  }
  drawComputerStatusBubble(ctx, content, status, uiTheme);
  drawStatusLights(ctx, visibleRoomStatus(status), uiTheme);
};
