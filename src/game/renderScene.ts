import { isTerminalBubbleAgent } from "../agentRegistry";
import type {
  AivatarContent,
  AivatarMemory,
  AivatarPaintingArtwork,
  AivatarPaintingGallery,
  AivatarRoomVisitor,
  AvatarAppearanceId,
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
import { ROOM_DOOR_RECT } from "./roomVisits";
import {
  BED_SKIN_SPRITE_DATA,
  BED_SPRITE_WIDTH,
  BED_SPRITE_X_OFFSET,
  BED_SPRITE_Y_OFFSET,
  type BedSpriteDefinition,
} from "./bedSkinSprites";
import {
  ACRYLIC_DESK_SPRITE_PALETTE,
  ACRYLIC_DESK_SPRITE_ROWS,
  ACRYLIC_DESK_SPRITE_X_OFFSET,
  ACRYLIC_DESK_SPRITE_Y_OFFSET,
  CLASSIC_DESK_SPRITE_PALETTE,
  CLASSIC_DESK_SPRITE_ROWS,
  CLASSIC_DESK_SPRITE_X_OFFSET,
  CLASSIC_DESK_SPRITE_Y_OFFSET,
  INDUSTRIAL_DESK_SPRITE_PALETTE,
  INDUSTRIAL_DESK_SPRITE_ROWS,
  INDUSTRIAL_DESK_SPRITE_X_OFFSET,
  INDUSTRIAL_DESK_SPRITE_Y_OFFSET,
  ROCOCO_DESK_SPRITE_PALETTE,
  ROCOCO_DESK_SPRITE_ROWS,
} from "./deskSprites";
import {
  FILE_CABINET_SPRITE_DATA,
  FILE_CABINET_SPRITE_HEIGHT,
  FILE_CABINET_SPRITE_WIDTH,
  FILE_CABINET_SPRITE_X_OFFSET,
  FILE_CABINET_SPRITE_Y_OFFSET,
  type FileCabinetSpriteState,
} from "./fileCabinetSprites";
import {
  FLOOR_SURFACE_SPRITE_DATA,
  FLOOR_SURFACE_SPRITE_HEIGHT,
  FLOOR_SURFACE_SPRITE_WIDTH,
} from "./floorSurfaceSprites";
import { GAME_CONSOLE_SCREEN_REGION, GAME_CONSOLE_SPRITE_DATA } from "./gameConsoleSprites";
import { RECORD_PLAYER_SPRITE_DATA } from "./recordPlayerSprites";
import { RUG_SPRITE_DATA, type RugSpriteId } from "./rugSprites";
import { SMALL_ITEM_SPRITE_DATA, type SmallItemSpriteId } from "./smallItemSprites";
import {
  FRIDGE_DEFAULT_BODY_WIDTH,
  FRIDGE_DEFAULT_BODY_X,
  FRIDGE_DEFAULT_FRONT_HEIGHT,
  FRIDGE_SKIN_SPRITE_DATA,
  FRIDGE_DEFAULT_SPRITE_HEIGHT,
  FRIDGE_DEFAULT_SPRITE_WIDTH,
  FRIDGE_DEFAULT_SPRITE_X_OFFSET,
  FRIDGE_DEFAULT_SPRITE_Y_OFFSET,
  FRIDGE_DEFAULT_TOP_HEIGHT,
} from "./fridgeSprites";
import {
  TERMINAL_MONITOR_DEFAULT_SPRITE,
  TERMINAL_MONITOR_SKIN_IDS,
  TERMINAL_MONITOR_SKIN_SPRITE_DATA,
  TERMINAL_MONITOR_STATUS_BUBBLE_Y_OFFSET,
  TERMINAL_MONITOR_SPRITE_X_OFFSET,
  TERMINAL_MONITOR_SPRITE_Y_OFFSET,
  type TerminalMonitorSkinId,
} from "./terminalSprites";
import {
  WALL_SURFACE_SPRITE_DATA,
  WALL_SURFACE_SPRITE_HEIGHT,
  WALL_SURFACE_SPRITE_WIDTH,
} from "./wallSurfaceSprites";
import {
  normalizePaintingGallery,
  paintingArtworkById,
  paintingPixelVisible,
  paintingProgressRatio,
} from "./paintings";

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
type AvatarRenderLayer =
  | { kind: "primary"; y: number; runtime: AvatarRuntime }
  | { kind: "visitor"; y: number; runtime: AvatarRuntime; visitor: AivatarRoomVisitor };
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
type TerminalMonitorSkinKey = "classic" | TerminalMonitorSkinId;

type DominantTrait = keyof AivatarMemory["growth"]["traits"];
type MoodBand = "high" | "normal" | "low" | "depleted";
type UiThemeId = "classic" | "terminal" | "terminal-amber" | "arcade-cabinet";

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
  "arcade-cabinet": {
    shadow: "#5a123f",
    border: "#00e5ff",
    fill: "#0b1018",
    tail: "#00e5ff",
    infoText: "#fff6bf",
    warningText: "#ffe66d",
    errorText: "#ff5c7a",
    progressTrack: "#05070b",
    progressFill: "#ffb32c",
  },
};

const bubblePaletteForTheme = (uiTheme: UiThemeId): BubblePalette =>
  bubblePalettes[uiTheme] ?? bubblePalettes.classic;

const isTerminalTheme = (uiTheme: UiThemeId) => uiTheme !== "classic";

const terminalScanlineForTheme = (uiTheme: UiThemeId) =>
  uiTheme === "terminal-amber"
    ? "#7a3d08"
    : uiTheme === "arcade-cabinet"
      ? "#00e5ff"
      : "#145c22";

const terminalRoomBackdropForTheme = (uiTheme: UiThemeId) =>
  uiTheme === "terminal-amber"
    ? "#090500"
    : uiTheme === "arcade-cabinet"
      ? "#05070b"
      : "#020804";

const terminalStatusPanelForTheme = (uiTheme: UiThemeId) =>
  uiTheme === "terminal-amber"
    ? "#160c03"
    : uiTheme === "arcade-cabinet"
      ? "#0b1018"
      : "#031207";

const terminalStatusTextForTheme = (uiTheme: UiThemeId) =>
  uiTheme === "terminal-amber"
    ? "#ffe4a3"
    : uiTheme === "arcade-cabinet"
      ? "#fff6bf"
      : "#d8ffd0";

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
      workout: "Clean reps",
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
      workout: "One more rep",
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
      workout: "Good form",
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
  "workout",
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
  const state: FileCabinetSpriteState =
    count <= 0
      ? "empty"
      : failedCount > 0
        ? "failed"
        : count <= 2
          ? "few"
          : count <= 5
            ? "several"
            : "full";
  const sprite = FILE_CABINET_SPRITE_DATA[state];
  const spriteX = item.x + FILE_CABINET_SPRITE_X_OFFSET;
  const spriteY = item.y + FILE_CABINET_SPRITE_Y_OFFSET;

  void frame;
  drawTableSprite(ctx, spriteX, spriteY, sprite.palette, sprite.rows);

  if (highlight !== "none") {
    ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.round(spriteX),
      Math.round(spriteY),
      FILE_CABINET_SPRITE_WIDTH,
      FILE_CABINET_SPRITE_HEIGHT,
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

const furnitureOcclusionY = (item: FurnitureDefinition) => {
  const bounds = getFurnitureVisualBounds(item);

  return item.id === "bed"
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
};

const isFurnitureInFrontOfAvatar = (
  item: FurnitureDefinition,
  avatar: AvatarRuntime,
) => {
  const avatarFeetY = avatar.y + 12;

  return avatarFeetY < furnitureOcclusionY(item);
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

const TERMINAL_MONITOR_SKIN_ID_SET = new Set<string>(TERMINAL_MONITOR_SKIN_IDS);

const terminalMonitorSkinId = (skinId?: string): TerminalMonitorSkinKey =>
  skinId && TERMINAL_MONITOR_SKIN_ID_SET.has(skinId)
    ? (skinId as TerminalMonitorSkinId)
    : "classic";

const terminalMonitorSpriteForSkinId = (skinId: TerminalMonitorSkinKey) =>
  skinId === "classic"
    ? TERMINAL_MONITOR_DEFAULT_SPRITE
    : TERMINAL_MONITOR_SKIN_SPRITE_DATA[skinId];

const terminalMonitorAnimationPalette = (skinId: TerminalMonitorSkinKey) => {
  switch (skinId) {
    case "terminal-green-amber-skin":
      return {
        screenTop: "#c8ffbd",
        line: "#95f58f",
        lineSoft: "#5fcf6c",
        alt: "#d6ff9f",
        scanline: "rgba(90, 230, 94, 0.7)",
        cursor: "#ffb338",
        indicatorA: "#ffb338",
        indicatorB: "#b36b16",
        keyShadow: "#6f4d1a",
        keyTop: "#ffd56d",
      };
    case "terminal-white-cyan-skin":
      return {
        screenTop: "#f1ffff",
        line: "#9efcff",
        lineSoft: "#52d7e7",
        alt: "#e7ffff",
        scanline: "rgba(105, 238, 255, 0.72)",
        cursor: "#ffffff",
        indicatorA: "#39e7ff",
        indicatorB: "#1ba4bc",
        keyShadow: "#4fbccb",
        keyTop: "#f7ffff",
      };
    case "terminal-neon-dark-skin":
      return {
        screenTop: "#b8fff2",
        line: "#7fe6ff",
        lineSoft: "#3ca9ff",
        alt: "#ff6fe1",
        scanline: "rgba(120, 167, 255, 0.74)",
        cursor: "#ff3bc8",
        indicatorA: "#5cecff",
        indicatorB: "#ff3bc8",
        keyShadow: "#1fb5d0",
        keyTop: "#ff47cc",
      };
    case "classic":
    default:
      return {
        screenTop: "#b8fff2",
        line: "#9ee6ff",
        lineSoft: "#78a7ff",
        alt: "#eaffd0",
        scanline: "rgba(120, 167, 255, 0.72)",
        cursor: "#ffe66d",
        indicatorA: "#8dff9d",
        indicatorB: "#3ac46d",
        keyShadow: "#78a7ff",
        keyTop: "#fff7c2",
      };
  }
};

const CLASSIC_BED_SPRITE_PALETTE: Record<string, string> = {
  "0": "#a5865d",
  "1": "#0a286e",
  "2": "#113c98",
  "3": "#123d9a",
  "4": "#55250c",
  "5": "#0d3182",
  "6": "#421d0a",
  "7": "#0c2e7c",
  "8": "#a04d19",
  "9": "#0d2f7d",
  "A": "#e19642",
  "B": "#b3591e",
  "C": "#feeed1",
  "D": "#c55c25",
  "E": "#f3daaf",
  "F": "#783310",
  "G": "#fbe8c6",
  "H": "#d57428",
  "I": "#964617",
  "J": "#3e1b08",
  "K": "#103993",
  "L": "#113b96",
  "M": "#f9e2ba",
  "N": "#0c2c76",
  "O": "#8c4016",
  "P": "#0e3388",
  "Q": "#0e3286",
  "R": "#133f9c",
  "S": "#e8c893",
  "T": "#0f368d",
  "U": "#feeed0",
  "V": "#5c270c",
  "W": "#341808",
  "X": "#4e240e",
  "Y": "#713010",
  "Z": "#7c5e49",
  a: "#0b286f",
  b: "#b1a18d",
  c: "#7f3712",
  d: "#5a250c",
  e: "#491f09",
  f: "#fbeacb",
  g: "#0e348a",
  h: "#62290c",
  i: "#13214e",
  j: "#893d16",
  k: "#feefd2",
  l: "#fdedce",
  m: "#823b14",
  n: "#883b15",
  o: "#813913",
  p: "#0a2567",
  q: "#e0ae66",
  r: "#672d0d",
  s: "#10378f",
  t: "#5d2a0f",
  u: "#0f3791",
  v: "#08225f",
  w: "#0f358a",
  x: "#103a96",
  y: "#7a3814",
  z: "#4e3d41",
  "!": "#0d2d79",
  "#": "#0b2c79",
  "$": "#0c3082",
  "%": "#fdeed0",
  "&": "#feeecf",
  "(": "#14182f",
};

const CLASSIC_BED_SPRITE_ROWS = [
  ".btttttZ....................................................................Ztttttb.",
  "byHHHHHI0..................................................................0IHHHHHrb",
  "tHHHHHHHyb................................................................bmHHHHHHHX",
  "tAHAAAAAOb................................................................bIAAAAAAAt",
  "tAqqqqqAyb................................................................bmAqqqqqHX",
  "XnIIIIIceb................................................................bdn88IIIF6",
  "XOcomocceb................................................................b4OmmnocF6",
  "XnccccoFe6zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzXXcooocoY6",
  "zhhhhhhVWVnI888888888888888888888888888888888888888888888888888888888888In4edhhhrhez",
  ".WJeeeJWJrOBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBOYJWJeeeJW.",
  ".JdrFr4JYBHAqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHBhe4rFhdW.",
  ".6rOOnhe4FOIIIIII8IIIIIIIIIIIIIIIIIIIIIII88IIII8IIIIIIIIIII8IIIIIIIIIIIIIOF4erOOnrJ.",
  ".eFB88F4eYFFFFFFFcyFyccFFFyFccyFFFFFcyyyycFFFFFcyFccyFFFFFFFFFcFFcFFFFFFFFYeVF888F6.",
  ".eFBB8c4W6JJ6J66666J66666666666J6J66JJJJJ666JJJ6JJJ66JJJJJJ6J6JJJJJJJJ6JJ66WhF8BBF6.",
  ".eFBB8F4J4ddddhhVVVVVVVVVVVVVVhVhhVVVVdVVhhhhVhhVVVVVVVVVVVVVVVVVVVVVhVd444JVF88Bc6.",
  ".eFB88F4eVrrFFFFFFFFFFFFFFFFFFFFFFFFFFFYFFFFFYFFFFFFFFFFFFFFFFFFFFFFFFYYrhd6VY88BF6.",
  ".eYB8IY4ehrYrYymmmooocyyycyyoymommmmoymyyycmymcyommoooommmmomccoooymyyYrYrh6dYI8BF6.",
  ".eYB8IY4ehrrVDAHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHAHHHHHHHHHHHHHHAAABtrrhJdYI8BF6.",
  ".eYB8IY4ehYr4BDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDOVrrVJdYIBBF6.",
  ".eYB8IFeehrr48DDDBDDDDBDBDDBBDDDDDDDBBBBBDDBBBDBDDDDDDDBDDBDBBBBBBDBDBjdrrVJVY88BF6.",
  ".eFB8IYeehrrdrYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYtVrhVJVY888F6.",
  ".eFB8IYeeVhrhVd4ddd4VVdddd44ddd444ddddddddVVVVd44444ddddddddddddddd4dddthhVJdF88BF6.",
  ".eFB8IYeeVhtd444444444444444444444444dddVhhVddd444444444444444444444444dVhdJVY888F6.",
  ".eyB8IYe6VdXXXZZZZZZZZZZZZZZZZZZZZZZZteX4VVXeeXZZZZZZZZZZZZZZZZZZZZZZZXe4ddJdFI8Bc6.",
  ".eFB8Ire64XtZ0SEMMMMMMMMEMMMMMMMMMMEE0ZytXXtZZ0EMMMMMMMEMMMEMMMMMMMMESZZtX46dr8BBce.",
  ".eYB8Ire6XX0qEGll&UlllfGGGGGGGGGlllfGESqZttZqSMGll&llGGGGGGGGGGGGfllGMSqZXe64rI8BF6.",
  ".eYB8Ihe6eZqEGfMGfCCCCCCClf&UCkUUGMEMfMSqZ0qSGGMMGGUCUCCClfllUUUUfGMMGMSqy6J4rI8BF6.",
  ".eYB8OheWyqSGMMl&CUCCCkkCCCUUUCCCUClMMGESZ0SMMMfCUUUCUUUUCUUCU&&U&UUGMGMS0YW4rI8BF6.",
  ".eYB8OheWZqEMGCl%UCCCkkCCCCCUCkCkCCUUGMMS00SMMlCUUUUUUUUUUCkCCU&UUUllfMMEqyWehI8BF6.",
  ".eYB8nheWZSEG&UflUCCCCCkCCCCCCCCCCClUUGES00SEGll&UUUCkUUUCCkCkU&UUUfllGMEqyWehO8BF6.",
  ".eYB8oVeWZSEGllUCUCCUUCCkCCkkkkkkklGlUlMS00SGl&fl&UCkkCUUCC%%%U&UU&Ul%lGESZWeVn88F6.",
  ".eYBIcdeWZSGfffUCUkCUCCCCCCCkCCCkCClfflMS00SMffl%UkkkkkCCCC%bbb%UUUlb0bGMSZWe4o88F6.",
  ".eYBIF46WZSMGlUCCCUUUCCCkCCkCkkkkkkCCfGMS00SMGGl&UUkCkkkkCCbyBr0bbb0yBrbMSZWe4c88F6.",
  ".eY8IF4JWZSEfUUUUCCUUCCCCCCCUUCCCCC%C&MES00SMG&UUUUCCkCCC%%tDHy4rFFecHBXEqyWJ4FI8F6.",
  ".eY8OYeWJZSMGl&GlCkkkkCUCCkUUUCCCUfGG&GES00SEG&GG&UUCC%CCCCtBmYIBBBOYm8tEqyWJeYI8YJ.",
  ".erInre6JZqEGGfGlCCCCCUCCUkUUUCCUUfMMGGES00SMGGGGl%%UUUUCCCbtr8BBBBBIhtbEqyW6erOIYJ.",
  ".6rOcdJq0ZqEMMf&GGGGlUCkkCCUUUGlGGGlGMMEqZ0SEEGllGGGGlUCC%&fzIB88B888OXESqZ00WVcOrJ.",
  ".6hoYe0S0ZqSMfGEEMGfllGfGGfl%UflGMEMGGESqZ0SSElGEEMfflCCUl&fzI8XBBBtOOXMSqZqS04ForJ.",
  ".6VcYJqEqZqEGESSEMGGGMMMMMMGGGlGGGMSEGMSqZ0qEMMSSEGGGGGGGMGMzj8Oq0qOInXMEqZqEq6YFhJ.",
  ".6VFVZSMq0SGSqSSEEEEEEEEEEEEEEEEEEESSSMEqZ0SMEqSEEEEEEEEEEESXYIASZqAIr6SMSZqMqyVFhJ.",
  ".6VFe0SMb0ESqqqqSSSSSSSSSSSSSSSSSSqSqqSS0ZZqSqqqSSSSSSSSqSqZr6YBAqABFJrrbSZqMSZ4YhJ.",
  ".6Vr4qSEqZ000000000000000000000000000000Z0ZZ00000000000000Zm8rJeryreJVImtZZSES04rhJ.",
  ".6dreqqqq0Z000000000000000000000000000000qq0000000000000004D8FJrrhVV4h88Yt0qqq0ehhJ.",
  ".J4h600qbbbSSEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEESymcehO8IIOrJFct0Sqq0ZeVVJ.",
  ".J4dt0SEGGlffffllCkkkkUkUCUkkCCCkkkkkkkkkkkkkkk&llfllllllMStJJ4O8BBOdJJ60SGGES0e4VJ.",
  ".Jd40SMGGlfGfGGGfGGGGfflflflGGffkkkkkkkkkkkkkkkkkkkkllfGGMZYHBehn8OreBDFZSMGGEqZ6hJ.",
  ".JdtqSMGGGGGGGfGGffffllllUllffllkkkkk&llfffllflfC%%kllfGMSeBBBOJrFr6nDBB60EMGES0JhJ.",
  ".J4tqEGGUllll&&%lUkkCCkC%CCkkkkkkkkkk%%lllllllllkCUkk&kfMSJOIIIeJWWJIIInW0MfGMS0JhJ.",
  ".J4tqEMMMMGfGll%%UUC&%%%llUUk%lU%&%%&%%&UU%%%%C%%&%%U%kllE04o8hX000thIoXZSGGMGE0JhJ.",
  ".J4tqSEMEMMMGEEEMMMMMMGGMMMMMMMfEEEMGEEEMGMEEEfMEEEEGMGMMES06XzqSEEqzJW0SEEEEESbJdW.",
  ".JetqEMffffffffffffffffffffffffffffffffffffffffffffffffffffMESEMGfGGESSEGfffGMSbW4W.",
  ".JXqEGS000000000000000000000000000000000000000000000000000000000000000000000SEGSZeW.",
  ".JtSSqZvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvz0qS0XW.",
  ".WtqZzvN9997779799999777777979777999$99977999995599999977777777797999777777Npiz004W.",
  ".W4Zip5KuKKuuuKuuKKKKKuKu2KLKuxTxKsxKuKKKKxuKTxs2wxuKuKuuuuuuuuuKuxuKKKuuKsug#piZeW.",
  ".WXZp!KL3222K2LLxLK222LL23LK2K2KKuKKsKxsuKKKKKLsKKLKKKKx2K2uxuKKxLxKKKKxx2KxuQNiy6W.",
  ".Wezp5KRLRR3R3RRR33RR333R3333R2R23RRR3333RRR3RR32R3RR332R233x23R3R2R333x2L23KQNpzeW.",
  ".JeiNQ2RRR332Rb3LL23R33332LL32LL2x2L2LLLLRbbLLx3x2LL2L2R222L3Lx22LK2LLLx2223xu9a(eW.",
  ".JXi7P3RRR3RRRR3333RRRRRR3RRRRR3R23RR3333RbbR22R33RRRRRRR3RR333R3333RRR33RR3xKQN(4W.",
  ".JXi!w3R3L332K3xL3LL32LLLL22LLRL3KLLL22LK2RRxKxKLLL2L32L2LLLKL22K2LKRbbRx2LKLLQNi4W.",
  ".J4i!P2R2LLLLK2xL2xx2LLLZRLKLK2KLL3KKL2LKxKKx2xsxKKKL2KKRRKxKLLLKxKuZSSZxLKKxK5Ni4J.",
  ".J4i!P33233233323L2323RRSbR323L2L33L322222Kxx2222LLL3RK2ZRL332K22LxxxZ023x222K$N(dJ.",
  ".64iNPKssuuTuTKssgTTTws0SbRssgTgKTwsuswTTPgTPgTKggwwTugTTwTTuTgTTwgTPwwTTTTuTT9a(dJ.",
  ".J4ia9wQTQQQPQPQQPQ5PQQQ0RPPP5Q5QQ55QQQ5Q5QQ5QQg5QQ5QQQ55P5gQw$$Q5QP55Q5$gQQQQ71(dJ.",
  ".64i1N5Q597$59599597599999959$7!9597#799777799977999979777997579959999977$7977N1(dW.",
  ".64ipa!aaz0aaaaaaaaaaaa1111111a11a111111p111a1111111111111pa11111a1a1a11111aaNap(dJ.",
  ".6divaNNaNaaaaaNNaNNNaaa11aaa1a1aaa1aaa1aa1a1NaNNaaa1aa111aaaa1aaaaa1a111a1Naapv(dJ.",
  ".6di175QQQ555Q5PQQ5555$$55555559Q5555Q55555Q55Q5555$$$$$5Q555P5Q555g$5$$5$Q5$9Np(VJ.",
  ".6di!5wKKxTsuKsKsLKsssTTTsTwTsssKsxKKLKuKKxxRsKKTsssusTKuKTuuxsxsKK2uuKssxKswP7a(VJ.",
  ".6di!P3R3L22232322223222232L3322LLL22232L22LbRLLx2L3L32xxxK22L2L23233xxR03222K$a(VJ.",
  ".6diNwLKxKx2uKLx2LKLL2xKxxxxxxKLs2KKxK2xuxuKLxKK2KKLuKuKuKuxxxKxxLLKxKKLRKxK2u$1(VJ.",
  ".6diaQssKuKsuTKKsTsKssKuTsTusssssssTTssusuTTTTuuuuusuTsTTTuuTTuTsuKussTsswuKTg7p(VJ.",
  ".6di1!999555Q555555QQ55QQ5555555QQQQ55555955$$Q59555595995595$55Q5QQ5555595Q59Np(VJ.",
  ".6dia9QQQQ5Q5P55$595595559ws59597777997$5955995559$955Q9$5!5$7$$$$999999$7995$Np(VJ.",
  ".6Via7555595907!NNN!!#NNNN9ZNNNN#NNNNNNNaNNNN!NNNNNNN!N!!N!b#NN#NNNNNaaNaaNN#!Np(VJ.",
  ".6Vi1N9595999z!N!!N!7!!7!NN!#!!!N#N!NN##N#NN7!79!7#7!97!9!bM0###777#7#####7#Na1p(VJ.",
  ".64ipN957959#979$99799777!7#77!9#7#77997979997757777977997wSw7!7!!9N7#777#777N1v(VJ.",
  ".6diaQTuwuTsPsTsTTTPwwTgTPTggTwPgugTTTPTwwQTTwwTwgwTTuwTwwwRsggTwwTgTgwTgPPTPQ7p(hJ.",
  ".6Vi95sTTuTTTgwwTTTTwggwTPTPgPgPPPgsgTTTwwTTguwsgTPPwTggTggTPPggPgwswTZZTTgTgP5NiVJ.",
  ".6Vi!P333R2322222323L3323233LKxLLZR322R2LL2LLL3LLL2L33LL2L323L22L3233RSbR3222KQNiVJ.",
  ".6ViNwR33RRR22233R232323322322222bR2233222LL33LR32L222323L2L2L32L2233RbbR3222L5NiVJ.",
  ".6ViNQKsssssssKsKusKuusKusuuussTTsKusuuuusssKuTsKuTTTTsssTsTsTTwwTTTTTRLTTTusg7aiVJ.",
  ".6Via5wwwTPwwwwgTgwTwgTTgPggggPgPPwgPgwTgPwPggggwssPPwwPPPPQgPPPPgPPQQQgPPggP5#1ihJ.",
  ".6Via!5QQQ5QQ55QQQPQQQQPQ5Q5QQ5Q5Q5QQQQgQ5Q5Q5P5QbbwQPQ$$9$$$555QQ5QQ$$$$$Q559NpihJ.",
  ".eVipa7977979975w9997997997979977777999777!777979bSz7777##777#777779977779777#ap(hJ.",
  ".eVippa11111a1N0b!aa111aaapp1111a1aa1aa11111pa1ap!z111111p111111111a111a111111pp(hJ.",
  ".ehiv1aapp1111zSSZ11111111111p11pp111111aNa1111111p111111p111111ppppp1111a11a1pv(rJ.",
  ".ehi1955979!977ZZ99777799979!7#7779#9#77!b9777#9##777!7777977!!977#77997999997Np(rJ.",
  ".ehi!9wwgTggwQgwggTPPgTPgggPgggPPPgQggwwTPggPPQQQPPQPQPPTPT5wR0TgPPgPgggggwwP5!airJ.",
  ".ehiNTRRRRR3R2R3222233322233333L32R3L3333RR2332Rx2333332R2RLRRR2322Rx333232R3K5NihJ.",
  ".ehiN5LR3R3L3332332RR3R33L32RR33R332R233R3333323333322RLR3RR2K2LL22333L3L223LT91ihJ.",
  ".6VipNPgPgPPgPPQgPQgggPggQgPRbwgPggQgPwPPPPPggwQwPPPPQPggPgPgPPQQPPPPQPQPPPPQ5Np(VJ.",
  ".64iv175ggPPP5QPPQPQgPggwPP5PPQP5g5PQPQPQgg5P5gQPPPQP5wQP5w5g5PQ5PP5gQQZ0PgP9#pv(VJ.",
  ".J4iivpa#NNNNNNNN##NNNNNNNNN!NNNN#N#NNN!NN!N#N#NNNNNNN#NNN!N#NNaNNNN#NN!!N#N1vvi(4W.",
  ".WV4tX(p111a111111a1a1a111a1a1aa1a11111111111pa111111111111p1p1p1111a11aa1a1p(X4X4W.",
  "XOHHHDyWvpppppppppppppppppppppppppppppppppppppppppppppvpppvpvppvpppvppppppvvWjHHHDyX",
  "tHHHHHDWiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii6HHHHHHt",
  "rAAAHAAJryommmmmoomoommmcoocccccccoomoooooooomoooooooccccooomocccmoooccccycVXAHHHAAt",
  "tAqAAqH6jBDHHHHHHHHHHHHHHHHHDDDHHHHDHDHHHHHDDHHDHHHDDDDDDHDDHHDDDHHHDDDHHDBceAqqAqAt",
  "X88888c6DAAqqAAAAqAAAAAAAAAAAAAAAAAAAAAAAAqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADJO888IOX",
  "XIOOOOc6YjnjOOnmOjjjOjjjnnjnnnnnOOmnjjnnOnnOOjjjmcnOnooonOnnnnnoonjOnmnjnnnrJOjjjnOX",
  "XmOjjnFJryommmmmmnooooocmocyommcomcmmjommmmmoomooooooycccomooocooycooccoooyh6mmnjjyX",
  "ZX444t4W6XXXXX4XXXXXXXXXXXXXXXXXXXXX4XXXXXXXXXXXXXXXXX44XXXX4XXXXXXXXXXXX4XeW444ttXX",
  ".JdrrVJehyyccyyycccccccccycccccocccccccFFyccccyccocycyyccyFccccccccccccyyyyhe6trrdW.",
  ".6YcFheXYoomomjjnOjjjjjjOOnjoommomnmonommmmnnojnjmmmnjnojjjjjjjnnnnojjOOjjnreXryoY6.",
  ".Xn8IFXdyjOOOjO8AAAAAAAAAABnOIIIIIIIIyWWWWWWWWII888I8OIOIDAAAAAAAAAHnjnoomnYXtyI8me.",
  ".4ID8mVVynjmjmjIHDDDDDDDDDIonjmjmmjjjYWWJJJJWWIjjjnmnnjmODDDDDDDDDDHonOOOOOYXrm8DOX.",
  ".48D8OtVcOOOOjnIDDDDDDDDDDInOjOOjOOOOyrymmmmmFIjOOjjOOOOOBDDDDDDDDDDmjjnmOjY4rj8DIX.",
  ".48HBOdVyjOOOjmcOIIOOOOIIOoojjnjmjmnOjjOIIIIIOjOnjjjjjnnnmOOOOOOIOOOymjmmjOF4rOBHIX.",
  ".48HBO4VFmjjOjjnnnnnnnnnnmnjnjOOjnjjOjjnnnjjnjnjjOjnjjjnnmmmnnnnmnnmnnnnjjnF4rOBH8X.",
  ".48HBOdeX4ddd4ddtdd4dd4444ddtdVVV4dddddd44dddd44dd4444d444444dd44d44444444d4JrOBH8X.",
  ".48H8Ote4htttththhhVVttttthhrhhhhthhhhhhhthhhhhthhhhthhVtVVVthhhhththhhhttt46rOBH8X.",
  ".48H8OtWJ6666666666666666666666666666666666666666666666666J666666666666666J6JrIBH8X.",
  ".48HBO4JW6WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWJJJrOBH8X.",
  ".48H8Ot46e................................................................e6XrOBH8X.",
  ".48H8Otte..................................................................XVYOBHIX.",
  ".48HBItre..................................................................4hYIBH8e.",
  ".48DBItYe..................................................................4rY8DH8X.",
  ".4IDDOrYe..................................................................4rYIDDIe.",
  ".4OjnOtYe..................................................................4rYOnjOX.",
  ".4OIOIrre..................................................................4rYOOIIX.",
  ".4jOOOr40bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbZ4FjOOje.",
  ".ZFccotZ...................................................................bZtymmFZ.",
  ".btttttb....................................................................btrrYtb.",
] as const;

const CLASSIC_BED_EDGE_HALO_TOKENS = new Set<string>(["b", "Z"]);

const CLASSIC_BED_SPRITE = {
  palette: CLASSIC_BED_SPRITE_PALETTE,
  rows: CLASSIC_BED_SPRITE_ROWS,
  edgeHaloTokens: CLASSIC_BED_EDGE_HALO_TOKENS,
} satisfies BedSpriteDefinition;

const isBedSpriteEdgeHaloPixel = (
  sprite: BedSpriteDefinition,
  rowIndex: number,
  column: number,
  token: string,
) => {
  if (!sprite.edgeHaloTokens?.has(token)) return false;

  const row = sprite.rows[rowIndex];
  const left = column === 0 || row.charAt(column - 1) === ".";
  const right = column >= row.length - 1 || row.charAt(column + 1) === ".";
  const top = rowIndex === 0 || sprite.rows[rowIndex - 1]?.charAt(column) === ".";
  const bottom =
    rowIndex >= sprite.rows.length - 1 ||
    sprite.rows[rowIndex + 1]?.charAt(column) === ".";

  return left || right || top || bottom;
};

const drawBedSpriteMatrix = (
  ctx: CanvasRenderingContext2D,
  spriteX: number,
  spriteY: number,
  sprite: BedSpriteDefinition,
) => {
  for (let rowIndex = 0; rowIndex < sprite.rows.length; rowIndex += 1) {
    const row = sprite.rows[rowIndex];
    let runColor: string | null = null;
    let runStart = 0;

    for (let column = 0; column <= row.length; column += 1) {
      const token = column < row.length ? row.charAt(column) : ".";
      const color =
        token === "." || isBedSpriteEdgeHaloPixel(sprite, rowIndex, column, token)
          ? null
          : sprite.palette[token] ?? null;

      if (color === runColor) continue;

      if (runColor) {
        drawPixelRect(ctx, spriteX + runStart, spriteY + rowIndex, column - runStart, 1, runColor);
      }

      runColor = color;
      runStart = column;
    }
  }
};

const bedSpriteForSkinId = (skinId: BedSkinId): BedSpriteDefinition | undefined =>
  skinId === "classic" ? CLASSIC_BED_SPRITE : BED_SKIN_SPRITE_DATA[skinId];

const drawClassicBedSprite = (ctx: CanvasRenderingContext2D, spriteX: number, spriteY: number) => {
  drawBedSpriteMatrix(ctx, spriteX, spriteY, CLASSIC_BED_SPRITE);
};

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
  const sprite = bedSpriteForSkinId(bedSkinId(item));
  if (sprite) {
    drawBedSpriteMatrix(
      ctx,
      item.x + BED_SPRITE_X_OFFSET,
      item.y + BED_SPRITE_Y_OFFSET,
      sprite,
    );
  } else {
    drawBedFootboard(ctx, item, "none");
  }
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

  return avatarFeetY < placedItemDepthY(item);
};

const rectsOverlap = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

const placedItemDepthY = (item: PlacedItem) => {
  const bounds = placedItemBounds(item);
  return bounds.y + bounds.height - Math.min(8, bounds.height * 0.2);
};

const shouldRestorePlacedItemOverFurniture = (furniture: FurnitureDefinition) =>
  furniture.id === "table" || furniture.id === "file-cabinet";

const rowsVisualBounds = (
  item: FurnitureDefinition,
  xOffset: number,
  yOffset: number,
  rows: readonly string[],
) => ({
  x: item.x + xOffset,
  y: item.y + yOffset,
  width: Math.max(0, ...rows.map((row) => row.length)),
  height: rows.length,
});

const foregroundFurnitureOverlayBounds = (item: FurnitureDefinition) => {
  if (item.id === "table") {
    const skinId = tableSkinId(item);
    const rows =
      skinId === "rococo-ivory-table-skin"
        ? ROCOCO_TABLE_SPRITE_ROWS
        : skinId === "dark-oak-table-skin"
          ? DARK_OAK_TABLE_SPRITE_ROWS
          : skinId === "white-tech-table-skin"
            ? WHITE_TECH_TABLE_SPRITE_ROWS
            : CLASSIC_TABLE_SPRITE_ROWS;
    return rowsVisualBounds(item, -4, -5, rows);
  }

  if (item.id === "file-cabinet") {
    return {
      x: item.x + FILE_CABINET_SPRITE_X_OFFSET,
      y: item.y + FILE_CABINET_SPRITE_Y_OFFSET,
      width: FILE_CABINET_SPRITE_WIDTH,
      height: FILE_CABINET_SPRITE_HEIGHT,
    };
  }

  return getFurnitureVisualBounds(item);
};

const placedItemFurnitureOverlayClipRects = (
  item: PlacedItem,
  definition: ItemDefinition | undefined,
  content: AivatarContent,
  foregroundFurniture: FurnitureDefinition[],
) => {
  if (
    !definition ||
    definition.kind !== "decor" ||
    item.surfaceFurnitureId ||
    isFloorUnderlayItem(item.itemId) ||
    getItemPlacementKind(definition) !== "floor"
  ) {
    return [];
  }

  const itemBounds = placedItemBounds(item);
  const itemDepth = placedItemDepthY(item);
  return foregroundFurniture
    .filter(shouldRestorePlacedItemOverFurniture)
    .filter((furniture) => itemDepth >= furnitureDepthY(furniture))
    .flatMap((furniture) => [
      foregroundFurnitureOverlayBounds(furniture),
      ...(content.placedItems ?? [])
        .filter((candidate) => candidate.surfaceFurnitureId === furniture.id)
        .map(placedItemBounds),
    ])
    .filter((bounds) => rectsOverlap(itemBounds, bounds));
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

const CLASSIC_TABLE_SPRITE_PALETTE: Record<string, string> = {
  "0": "#21262a",
  "1": "#353d42",
  "2": "#465058",
  "3": "#a7aeb7",
  "4": "#c4c9d1",
  "5": "#e5e8eb",
  "6": "#b4bac3",
  "7": "#a1a9b2",
  "8": "#bbc1c9",
  "9": "#dadde2",
  a: "#8f97a0",
  b: "#969ea7",
  c: "#9ca3ac",
  d: "#f9f9fb",
  e: "#adb4bd",
  f: "#838c94",
  g: "#ced2d9",
  h: "#6a747c",
};

const CLASSIC_TABLE_SPRITE_ROWS = [
  "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "011111111222222222222222222222222222222222222222211121111111111111111122222222222222222111111111111110",
  "01hbaabbbcc73ee68444444444444888666ee33337777cccbaaaaaaaafffffaffaaaaabbcccc7777777777cbbaaafffffff210",
  "02a555ddddddddddddddddddddddddddddddddddddd5555599999gggg44444444444gggg999995555559999ggg4448866e6h10",
  "02f999955dddddddddddddddddddddddddddddddd55555999gggg44448888888888884444ggggggg99gggg444886ee337c3h10",
  "02fg4ggg955dddddddddddddddddddddddddd55559999ggg44448886666666666e6688888444444g4g44448866ee3777cc7h10",
  "02f6ee68844gg99555ddddddddd5555599999ggg444488666eeee3337777777777733333eeee666666666ee3377cbbaaaabh10",
  "02f3733e668844g99955555555559999ggggg444888866ee3337777ccccccccccccc77777333eeeeeeee3377ccbbaaaaafah10",
  "02f3733e668844g99955555555559999gggg4444888866ee333777cccccccccccccc777773333eeeeee33377ccbbaaaaafah10",
  "02f3c773ee68844gg999955599999ggggg4444888666ee333777cccbbbbbbbbbbbcccccc777333333333377ccbbaaaffffah10",
  "02f7bc733e668844gg9999999999gggg44448886666ee33777ccccbbbbbbbbbbbbbbbbcccc777733333777ccbbaaafffffah10",
  "02f3c733e668844gg999995559999gggg44444888666ee333777cccbbbbbbbbbbbbbbccc7777333ee333377ccbbaaaafffbh10",
  "02f8688844gg999555dddddddddd5555599999gggg444888666eee33333377333333eee66688884444448866e3377ccbbbch10",
  "02b9g999555dddddddddddddddddddddddddd555559999gggg4448888886668888844ggg9999555555555599gg4886eee36f10",
  "02bg4gg999555ddddddddddddddddddddd5555559999gggg444488886666666888844ggg999555ddddddddd559gg48866e6f10",
  "02a86888444gg9955555dddddddd5555599999gggg44448886666eee333333eeeee6688444gg999955555559gg48866ee3eh10",
  "02a63ee668844ggg99955555555559999ggggg444488866eeee33337777777777333ee66688444gggg99gggg4866ee337c3h10",
  "0hf37333ee668844gg999999999999gggg444488866eee33377777cccbbbbbccccc77333ee6668844444444866e3377ccb7f10",
  "02f7bcc7733ee66884444gggggg444488886666eee33377cccbbbbbaaaaaaaaaaabbbccc7733eee66666666e3377cbbbaacf10",
  "02fcabbcc7733ee668844444444448888666eee333777cccbbbbaaaaaaaaaaaaaaaaabbccc7733eee66666ee377ccbaaafbf10",
  "0hfbaaabbcc7733ee6688888888866666ee333377cccbbbaaaaaaafffffffffffaaaaaabbbcc77773333e3377ccbbaaaffbf10",
  "0hfafaaabbbcc7733eee666666666eeee3337777ccbbbaaaaaafffffffffffffffffaaaaabbbcc7777777777cbbbaaafffbf10",
  "0hfbfaaabbbc77333ee6668888666eeee333377cccbbbaaaaafffffffffffffffffaaaaaabbbcc7773333377cccbbaaaffca10",
  "0hfbaaabbcc7333e668888844888886666eeee3777ccbbbaaaaaaaffffffffffffaaaaabbccc77333eeee3377cccbbaaafcf10",
  "02fcbbbc7733e668844ggggggggg444888666eee3377ccbbbbaaaaaafffffffaaaaabbbbcc773eee666666ee337ccbbbaa7f10",
  "02f373ee68844gg9955ddddddd5555999ggg4488866ee3377ccccbbbbaaaabbbbcccc7733ee6888444ggg444886ee3777b3f10",
  "02f33ee668844gg9955ddddddd5555999gggg4488866ee3377cccbbbbaaabbbbbccc7733ee6888444gggggg44886ee337c3f10",
  "02f333ee668844gg9999555555599999gggg4488866ee3377ccccbbbaaaaaabbbbcc7773ee6688444ggggg444886ee337c3f10",
  "02f37333e6668844ggg999999999gggg444488866ee3337ccbbbbbaaaaaaaaaaabbbcc773ee6688844444448886ee3377c3f10",
  "02f444gg99955555dddddddddddddddd5555555999gg4448866eee333733333eee668444gg999555555dd5555599ggg4484f10",
  "02hfffaaabbbccccccccccccccccbbccccccccbbbaaaaaffffffffffffffffffffffffaaaaabbbccccbbbbbbbbbbaaaafffh10",
  "012222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222210",
  "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "100111111111111111111111111111111111111111111111111111122222211111111111111111111111111111111111111001",
  ".0he7733337733333eeeeeeee6666e666666666888884444ggg99955dddd55599ggg44888866666eeeeee3333337777777e20.",
  ".01hhhhhhhhhhhhhhhhhfffhhhhhhhhhhfffffffffffffffffaaabbbccccbaaaafffffffffffffhhhhhhhhhhhhhhhhhhhhh10.",
  ".00012222222222222222222222222222222222222222222222hhhhhhhhhh2222222222222222222222222222222222220000.",
  ".0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000.",
  "..........01hh10......................................................................01hh10..........",
  "..........024820......................................................................0288h0..........",
  "..........1h55h1......................................................................0h55h1..........",
  "..........1h59h1......................................................................1h95h1..........",
  "..........1h55h1......................................................................1h95h1..........",
  "..........1h55h1......................................................................1h95h1..........",
  "..........1h55h1......................................................................1h95h1..........",
  "..........1h55h1......................................................................1h95h1..........",
  "..........1h55h1......................................................................1h95h1..........",
  "..........1h55h1......................................................................1h95h1..........",
  "..........1h55h1......................................................................1h95h1..........",
  "..........1h55h1......................................................................1h95h0..........",
  "..........1h55h1......................................................................1h95h0..........",
  "..........1h55h1......................................................................1h95h0..........",
  "..........1h55h1......................................................................1h95h0..........",
  "..........1h55h1......................................................................1h95h0..........",
  "..........1h55h1......................................................................1h95h0..........",
  "..........1h55h1......................................................................1h95h0..........",
  "..........1h55h1......................................................................1h95h0..........",
  "..........1h55h1......................................................................1h95h1..........",
  "..........1h59h1......................................................................1h99h1..........",
  "..........1h59h1......................................................................1h99h1..........",
  "..........1h99h1......................................................................1h99h1..........",
  "..........1h9gh1......................................................................1hggh1..........",
  "..........1h99h0......................................................................0h99h1..........",
  "..........01hh10......................................................................01hh10..........",
  "........0122222210..................................................................0122112210........",
  "........0111111110..................................................................0111111110........",
  ".......200000000012................................................................210000000012.......",
  ".......211111111112................................................................211111111122.......",
] as const;

const ROCOCO_TABLE_SPRITE_PALETTE: Record<string, string> = {
  "0": "#292930",
  "1": "#705e3e",
  "2": "#f4eee1",
  "3": "#f7f2e6",
  "4": "#f2ecdd",
  "5": "#d1c09d",
  "6": "#f0e9d8",
  "7": "#e4dac5",
  "8": "#faf7ed",
  "9": "#f3edde",
  a: "#b09e7c",
  b: "#eee7d8",
  c: "#f9f4ea",
  d: "#f8f3e7",
  e: "#dbcdb0",
  f: "#ece2c9",
  g: "#f6efe2",
  h: "#f5f0e4",
  i: "#fefcf9",
  j: "#fcf9f1",
  k: "#c9b486",
  l: "#20212a",
  m: "#837359",
  n: "#463f37",
};

const ROCOCO_TABLE_SPRITE_ROWS = [
  "n11111111111111mmmmmm111111111111111111111111111111111111nnnn1111111111111111111111111111111111111111n",
  "1eeee77ffff6693cdd3gggggggg99999999446666ffffff777eeeeeeeeeeeeeeeeeeeeeeeeeeeee777fff6666666ffff7ee7e1",
  "15kee55555555555555e5555e5ee5eeeeeeeeeee5555555555555555555555555555555555555555ee555e5ee5555555555k51",
  "15kkk76b6444444992ggh333333333333333333h2999949994999994444444444444444444444999222222g229944466fkak51",
  "15kkkfhgg3ddcc88888jjjjiiiiiiiiiiiiiiiijjj888cccccddddd3333333333333ddddddddcc8888888888cccddd3d65kk51",
  "15kk7d492992gg3d88jjjiiiiiiiiiiiiiiiiiiijjj88cccd3333hhggghhggggggh333333ddcccc8888888888ccd333hdb5k51",
  "15edg3cccc88jjjiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiijjjjj8888cccddddcddddcccccccc8888jjjjjjjjj88ccdddd3hje51",
  "15e942gh3dc88jjjjjiiiiiiiiiiiiiiiiiiiiiiiiiijj888cccdddddddddddddc8888888888jjjjjiiiiijj88ccdd333gce51",
  "15e964444922ghgh33dc888jjjjjjjjjiiiijjjjjjj88cccdd33333333333333h33hhh33333dddc88888j8888ccd3hggg2de51",
  "15e9644444444444992gh33dcccc888jj8888888cccddd333hhhgghghhggggggg2g22gggggggh333dccccccccd33ghhgg2de51",
  "15e24444444994999922ggh3333dcccc8cccccd33hgggggggg2229999922222222222222ggg2gghhh33ddd33hhg222gg293e51",
  "15eg499992229222ghh333dcccc8888jjjjj88888cccccdddddddddddddddddd333333dddddcc8888jjjjjjj888ccdd33hce51",
  "15edg33ddddddd33333c8888888jjjjjjjjjjjjjj88888ccccccccccccccdcccdddd333dddddcc88jjjiiijjjj88ccdd3h8e51",
  "15eg49222gh3c8jjjiiiiiiiiiiiiiiiiiiijjj888ccddd333333hhhgghhhhghghhgh333ddcc88jjiiiiiiiiiijj8cd3h2de51",
  "15eg44449922gh3dccc8888888888888888ccccd33333hhhghggggggggggghggghggggggghhh33dcc888j88888c3hhh2293e51",
  "15e94444444444444922hh333333dccccccccd3hhhgggg222g22222222222222222222222gggh33dccc88888ccd3hgg2293e51",
  "15e4666664464444492222hh3h3333dccccdd33ghg2222222229994999999992999222ghh33ddcc888jjjjjj88ccd33gg2de51",
  "15e4b6b66666666666444449222222222222222229949999994499949949999999922222ggh333ccc88jj8888cc33hg2293e51",
  "1554b666bb666666644222ghh333333dd33dd33333hgghgggg22222999999999222gghhh333dcc8jjiiiiiiiijj8cd33g2de51",
  "1556bbbbbbbbbb66444922h33333333d3333hhggg2222222999222999999222222gggghh333ddcc888jjjjj888cc33g2243e51",
  "1554b664992h3ddcc8jjiiiiiiiiiiiiiiijjjj8ccd33hhgghggggghhhhhggghhhhh33333dccc88jjjjjjjjjj888cd33g2de51",
  "1556bbbb666499h3cc8jjiiiiiiiiijjjjj88cc33hggg2222299922229222222g2g2ggh3h333cc8jjjiiiiijjj88cd3hh2de51",
  "1556bbbbbbbbbbbbb6644922222h22222222294444444444444444494444999999222222gghhh3dcc8888888ccd33gg294he51",
  "1556bbbbbbbb666649922hhhhhhhh2222222292999992299994444444444449444499499999222hhh333333hhh222944462e51",
  "1556bbbbbbbb64449922hhhhhhhhh222222222222222229944444444444444444444444499222ghh3dddd333hh229444662e51",
  "155bbbbbbbbbbbbbbbbbbb666b6666666646444444444444666666666666666666464444444499222hhhh222294446666b9e51",
  "155fbbbbbbbbbbbbbbbbb6664444444444444666666666666666666666666b666666666666644922g33333hh22446666bb6e51",
  "1kkeebbbbbbbbbbbbbb644922hhh33333h2244666bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb6664492h3c88j8cc3h2944464fek51",
  "155akfbbbbbbbbbbbbb6444499999999994444666666666bbb666b6bb666bbb66666bbb666444922hh33333hh2944464b5ak51",
  "1kkkkef77777777777ffffffffffffffffffffff77ffff777777f777f777777ff777f77fffffffffbbbbbbbbffffffffekkak1",
  "15555e7777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777555e1",
  "1k555ee77ffff69g6fffffffffffffffffffffffffffffffffffffffff7fffffffffffffff77777ffffff666fffffff77eeek1",
  "n1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111n",
  "nnaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaann",
  ".1544g99dddg7ebh888g9cddddddddd3333333gdekk566e965aa569e665kke6444646666666666666669946b5eb6496b6bb51.",
  ".nke5eheaee7ama7fk5aafh2222222229999994he5ekakke5kaak5ekkake5e6bbbbbbbbbbbbbbbbb7aakke7amaeeea5be5ek1.",
  ".nmmakekaaakaaa5aaaake7777777777777777777777ka5k5akka555ak77777777eee777eeeeeeeeekaaaakaaakkaakekaamn.",
  ".nn0mkkkkkkk555555555555555555555kk5555kkkkk55maakmmkaamk5kkkkkkkkkkkkkkkkkkkkkkkkk555k5kkkkkkkkkm0nn.",
  ".......nnnn1111nnnnnnn..........................................................nnnnnnn1111nnnnn......",
  ".......00l1aama1l00000..........................................................00000lnaaam1l000......",
  ".......00l1e55knl00000..........................................................000000n555k1l000......",
  ".......00l1akaanl00000..........................................................00000lnaaka1l000......",
  ".......00lmekm5ml00000..........................................................00000l1ekakml000......",
  ".......00lmf7keml00000..........................................................00000l1f7keml000......",
  ".......00lmf3eeml00000..........................................................00000l17275ml000......",
  ".......00lmfheeml00000..........................................................00000l1727eml000......",
  ".......00lmf3eeml00000..........................................................00000l1727eml000......",
  ".......00lmf37eml00000..........................................................00000l1f27eal000......",
  ".......00lmfc77ml00000..........................................................00000l1fhfeal000......",
  ".......00lm6c77ml00000..........................................................00000l1fcbeal000......",
  ".......00lm6877ml00000..........................................................00000l1fcbeal000......",
  ".......00lm6877ml00000..........................................................00000l1fdbeal000......",
  ".......00lm6c77ml00000..........................................................00000l1f3feal000......",
  ".......00lm6d77ml00000..........................................................00000l1fhfeal000......",
  ".......00lm6377ml00000..........................................................00000l1fhfeal000......",
  ".......00lm6377ml00000..........................................................00000l1fhfeal000......",
  ".......00lm6377ml00000..........................................................00000l1fhfeal000......",
  ".......00lm6d77ml00000..........................................................00000l1fgfeal000......",
  ".......00lm4757ml00000..........................................................00000l16f57al000......",
  ".......00lmfekeml00000..........................................................00000l177keal000......",
  ".......00l15kk5nl00000..........................................................00000ln55k51l000......",
  ".......00lmkmak1l00000..........................................................00000l1kamkml000......",
  ".......00lm5aak1l00000..........................................................00000l1kakkml000......",
  ".......00l1kkkanl00000..........................................................00000lnk5ka1l000......",
  ".......0na555555a00000..........................................................00000m555555an00......",
  "........nk7eeee7al...................................................................a7eeee7kn........",
  ".......11maaaaaam1n................................................................n1maaaaaam11.......",
  ".......nm111111111n................................................................nm11111111mn.......",
] as const;

const DARK_OAK_TABLE_SPRITE_PALETTE: Record<string, string> = {
  "0": "#281610",
  "1": "#1b1920",
  "2": "#854f3d",
  "3": "#704031",
  "4": "#4a2920",
  "5": "#42241b",
  "6": "#0b0807",
  "7": "#371f16",
  "8": "#392119",
  "9": "#60382c",
  a: "#131111",
  b: "#aa7460",
  c: "#2d1912",
  d: "#502c21",
  e: "#301c15",
  f: "#21130d",
  g: "#3e231a",
  h: "#351c14",
  i: "#5a3227",
  j: "#2e1a13",
  k: "#533026",
  l: "#402921",
  m: "#211e20",
  n: "#1e181c",
};

const DARK_OAK_TABLE_SPRITE_ROWS = [
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6aaaaaaaaaaaaaaaa",
  "accjccjeeeee777888lllllllllllllll888787eeeeeeejccccccccccccccccccccccjejjjeee77888llll8eeeejcc0000cff6",
  "aedddki993333222bbbbbbbbbbbbbbbbbbbb2222233333399ii99iiikddkkkii99999333332222bbbbbbbbbb222339iiidk5e6",
  "ahieh8544ddki9933222bbbbbbbbbbb22233399ikkd445gg5555ggg888gggggg555544ddki99333222bbb22239ikd45g8h7dh6",
  "aekg8544ddkki9933222bbbbbbbbbbbb22233399ikkd445555gg8888777888888gg5544dki9333222bbbbb22239id455ghh486",
  "ah4cj78g554dkii933222bbbbbbbbb2223399ikkddd455ggg55555g777ggggg555544dddkiii9933222b22339ikd45gg8h7dh6",
  "ahdjch75554444dki9933222bbbbb223399iik44555g877h7777hhhhhhhhhhhh77778gg5444dii933322239ikd45g8777jc576",
  "a7400cjjeee8gg5444di993322222339kd445g887ejcjcccc00c000000000cccjjehheh778gg544di93339id44g87hc00f0576",
  "a74cjh77888544l44kk99332222223399id444l5gg887heeejcccccc0cjjjjjjeee778ggg5544ki99933339ikd45587ej0c576",
  "a7dej785544444dk993333222222233399iikd4455gg77heehhheheeeeeee7778g55544dkki99332222b222339iid45g8h7486",
  "a7k8g544ddkki9993333222bbbbb2223999iiik444455gg8888877gggggg888888855544dki99933222b222399kd45587eh486",
  "a7ig54kii99339332222bbbbbbbbbbbb22223399ikdd455g8877eeeh77888gg55444l44dkki9933222bbb222399idd458h7476",
  "a7i8854dk9993332222bbbbbbbbbbbbb222233333999iikdd44555gg5555444ddiiii9933333222bbbbbbbb2223399id455d76",
  "a895g54dkkii993332222bbbbbbbbb22223339ikkkddd44455555g55544455554ddki9933332222bbbbbbbbb22399ik4588d76",
  "a8kh7g55444dii993333222bbbbbb2223399iikdd4455g887777hh7888gg888gg544444dki9933222bbbbb2239iidd45g78d76",
  "a8dej78g55544dkkii9332222bb222339ikk445555g877877h77777777888g555554444ddkki933322bbb22339iid445gh7476",
  "a7dcjhh88g5554l444dki9933333399kd44l5g8877eeeeeeejeeejjjjjjeehh78g5554dddddki93332222233iid445g7hje476",
  "a7djjh78888gg54dddkki9333223339iik4445g8777heejjjjjccjccjcccjjjjjeh778gg544dkki99332339iid445g8hj0j476",
  "a7d00cjh777888gg5l44444kkiikk4lll888eeeejjjj00000000000ff00000000ccjehhe78g54dkki99399id455877ej0f0576",
  "a7d0f0cceeeh78gg54ddkk9993339ik4llg887eeeeejccccccc00cccccccccjjjeeeeh777778gl44dki99ik4lg887hhcc0c576",
  "a7k0f0ceeeeh78888glll4kkk99kk44llgg887eejcccccc00000000c00000000ccccjeeh788gg544dk9999k4gg87ejc0ff0576",
  "a7d00cjeeee7888gll4kk999333339ik4lllgg87eejc0000000000000f00000cjeeh77788g5l4444ki999ik445587hjc0f0486",
  "a7d0ceh8gg5544dki993222bbbbb2222339iid445g8877ejc000000000000ccjeeeh7778gg55dddk9333339iidd4587hj00486",
  "a7ig785444di993332222bbbbbbbbb22399ik4l5g888g8heeeeeeec0cejjeeeh7788g5544ddki993322222339id45588hchd86",
  "a7kee788gg544dkki993322222b222399ikd445g877heeeejjcc0000000cccjeee778gg55l44dki933223339ik445g8he0c486",
  "a7deh77888gg54ddkii99332222223399ikd445g87hhheejjjccccccccjjjjehhhhh78g554444dki9333339iik44587hc0c576",
  "a7d000cjh778ggg544dkk9933223399kk455g87heejcc000000000c0000000cjjeeh7778g5544dkii93339ik4455887he0j476",
  "a740cjhh788g5554dddkki93322339ikd44455877hhhhejhhjjjcjccccccjcehhheh78g555544dkii93339ikd45g87hjc0c5h6",
  "ah4000chh7eehh78888ll4kk9999kk4lg877ehecc00000000f0fffffffff00000ccccjeeh77788g54ki9ik4lg87hejcc0f05h6",
  "ahdfff0cjjhheeeh77g544di9939id45g87hjjjcc0000ffffffffffffffffff00000ccjjjhh788g54di9id4587hec00ffaf5h6",
  "aed455544dkki9993222222bbbbbb222233399ikkd4444555gg5555555555555444dkii99999332222bb2223399ikd445g44c6",
  "ac0ejjeeee777888lllllllllkklllllllll887eeeeeeeejjcccccccjcccjjjjeeeeeee7888888lllllllllg8877eejjjje006",
  "aa00000000000000000000000000000000000000000000000ff00000000000000ff000000000000000000f00ffff0000000ff6",
  "a66666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666",
  "laa555555gg8g55g8888g555g8g5585gg8h7g545554d44di9i993322223399ikkkd4445g55ggggggg87gg7778g5g8gggg55aal",
  ".a039iiiikddiidddd4dkdddddddd444dddddkiiii933333332222bbbbb2223333999iiiidddddddd444d454ddddddddi99fa.",
  ".aff0h0cccccc0000000c000000ffffff0c0ff0c0ccchh7hjhg75554dd5g87hhjjjc0cc000fff0c0000fffffff0000c0c0fff.",
  ".a666fffffffffffff6666666666666666666666666ffffffaafffffffffffffa6666a6666666666666666fffffffffff66aa.",
  ".......666666666666666..........................................................666666666666a666......",
  "..........a0d5f6111111..........................................................1111116f45fa..........",
  "..........fh23ha111111..........................................................111111ac33ea..........",
  "..........fhb3ha111111..........................................................111111ac22hf..........",
  "..........fhb2ha111111..........................................................111111ac22hf..........",
  "..........07b2ha111111..........................................................111111ac22hf..........",
  "..........f7b2ha111111..........................................................111111acb2hf..........",
  "..........07b276111111..........................................................111111acb2hf..........",
  "..........07b2ha111111..........................................................111111fcb2hf..........",
  "..........07b2h6111111..........................................................111111fcb2hf..........",
  "..........fgb2h6111111..........................................................111111ac227f..........",
  "..........f7b2h6111111..........................................................111111ac22hf..........",
  "..........fgb3ha111111..........................................................111111fj22hf..........",
  "..........fgb3ha111111..........................................................111111fj22hf..........",
  "..........f723ja111111..........................................................111111aj22hf..........",
  "..........f723ea111111..........................................................111111ah22hf..........",
  "..........0723ha111111..........................................................111111ah22hf..........",
  "..........f723ha111111..........................................................111111aj22hf..........",
  "..........0723ha111111..........................................................111111aj22hf..........",
  "..........f72376111111..........................................................111111aj237f..........",
  "..........f723ha111111..........................................................111111aj33hf..........",
  "..........f729ha111111..........................................................111111aj23hf..........",
  "..........fh29ea111111..........................................................111111aj33hf..........",
  "..........fh3ija111111..........................................................111111aj33hf..........",
  "..........fh39ha111111..........................................................111111aj33hf..........",
  "..........6fd5f6a1mm11..........................................................111m116f45f6..........",
  "........mmmmmmmman..................................................................mammmmmmnn........",
  "........ammmmmmm1a...................................................................nmmmmmm1a........",
  ".......l166666666nl................................................................l166666666al.......",
  ".......mmmmmmmmmmmm................................................................lmmmmmmmm1mm.......",
] as const;

const WHITE_TECH_TABLE_SPRITE_PALETTE: Record<string, string> = {
  "0": "#dce0e6",
  "1": "#2c3039",
  "2": "#e5e8ed",
  "3": "#fffeff",
  "4": "#e8ecf1",
  "5": "#e0e3e9",
  "6": "#e3e5eb",
  "7": "#a6adb6",
  "8": "#eff1f5",
  "9": "#f8f9fb",
  a: "#ebedf1",
  b: "#f4f5f8",
  c: "#3a4146",
  d: "#636c76",
  e: "#fcfdfd",
  f: "#20262c",
  g: "#d1e4ec",
  h: "#2d323a",
  i: "#b6cad5",
  j: "#d1dee6",
  k: "#d4f2f7",
  l: "#c9d9e3",
  m: "#fefcfd",
  n: "#818a93",
};

const WHITE_TECH_TABLE_SPRITE_ROWS = [
  "f1chhcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccchhhhchf",
  "fdllljj00566666665566666666666666666666666666666665555555555556655665666666666226266666566665000llilnf",
  "fn3mbb988888888ke33333333333333333333333333333333333333333333333333333333333333333333333ekkkkkkk8889nf",
  "fne5gkg88b99999beeeeeemeeeeeeeeeeeeeeemeeeeeeeeeme99bb88888888888bbbbb99eeemmmeeemeee99b8444265glllbnf",
  "fn3gkgbb9mm333333333333333333333333333333333eee99bb888aaaaa44aaaaa8888bbb99eeeeeeee99bb888aaa222gll9nf",
  "fn3kk4aa88bbb99eeee33333333333333meeeeee9999bbb88aa442222666666222244aa8888bbb999bbb888a442265505gl9nf",
  "fnel422444aa888bbb99eee3memmeeeeee99bbbb8888aaa422265555555500555566622444aa8888888aa44266550000j0l9nf",
  "fneg4622244aa888bb999eeemmeeee99999bbb8888aaa44422265555555000555556622444aa888888aa442266550000j0i9nf",
  "fneg256622244aa888bb999e999999bbbbbb888aaaa442222655500000000000005556222444aaaaaaa442666550000jj0i9nf",
  "fneg2556662224aa888bbb9999b9bbbbbb8888aa444222226650000000000000000555622244aaaaa4442265500000jjj0i9nf",
  "fnel605555562224aa88bbb99bbbbbbb888aaa442222266655000000000000000000555622224444442226550000jjjjj0i9nf",
  "fnel60005566224aa88b999ee99999bbbb8888aaa444222265555000000000000055566224444aaaaa44226550000jjjj0i9nf",
  "fn3g2556224a88bb999e333333333eeeee999999bbbb8888aa442226666666622224aa8888bbb999999bbb8a4226500005lenf",
  "fn3ga244a8bb9e333333333333333333333333333eee999bb888aaaa4444444aaa888bbb99e33333333333e9b88a422252lenf",
  "fn3ga244a888b99e33333333333333333333meeee999bbbb88aaa4422222222444aa888bb99eee3333333ee9bb8aa42262lenf",
  "fn3g4562244a88bb99ee333333333meeeee9999bbb88888aa42222666665566622244aaa88bb999eeee99bb88aa4266556lenf",
  "fn3g25556224aaa8bbb99eee3eee999999bbbb8888aaaa44222665555555555556622244aa888bbbbbbb888a4422655005lenf",
  "fn3g50005562244a888bb99999999bbbbb88888aa4442222655550000000000055556622244a88888888aa442265500005lenf",
  "fn3g5j00005566244aa88888888888888aaaa442222266555500000000000000000555662224aaaa8aaa442265550000j0lenf",
  "fn3g5j000005562244aa88888888888aaa4442222665555500000000jjjj0000000005566222444aaa4422265550000jj0lenf",
  "fn3g0jjj000005562224aaaa8aaaaaaa4422226665555000000000jjjjjjjjjj00000005566222224422266555000jjjj0lenf",
  "fn3l0jjj0000055662224aaaaaaa44444222266555500000000jjjjjjjjjjjjj00000005555622222222266550000jjjj0lenf",
  "fn3l0jjjjj00005562222444aa44442222266655500000000jjjjjjjjjjjjjjjj0000000555662222222666500000jjjljlenf",
  "fn3l0jjj000005562224aaa88aaaaa4444222666555500000000jjjjjjjjjjjj000000055562224444422265550000jjj0lenf",
  "fn3g5j005566244a888bb9999999bbbbb8888aa44222226555000000000000000555662244aa8888bb888aa44226550000le7f",
  "fn3l526224aa88bb99ee33333333eeee9999bbb888aaa4422265555555555556622244aa88bb9999ee99bbb88aa4222665lenf",
  "fn3gl522444aa88bb99eeeeeeeeeeee9999bbb88aaa4442226655555500055556622244a888bbb99999bbbb88a4422225lgmnf",
  "fnegklggkg488bb99mmm3333333333mmmm999bbb888aaaaa4222666666556662222aaaa888bb999mmm999bbb88aagggllgg9nf",
  "fn90lllllllggggggggggggkgggggggggggggggllllllllllllllllliliilllllllllllllllggggggggggggglllllllllij9nf",
  "fnb52kkk4444444444444444444444444444444444444444444444444444444444444444444444444444444444444kkkk2087f",
  "fnb8bb9999mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm99m99999999999999999999999mmmmmmmmmmmmmmmmmmm9m9999bbb89nf",
  "fd77777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777df",
  "fcdddddddddddddddddddddddddddddnddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddcf",
  ".c49222222666666666666262666666666665555500000000000000jjjjj0000000000555562666666665566666666224290c.",
  ".c2kliiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiilggggllllllllllggggliiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiilkjc.",
  ".c4kkgggggggggggggggggggggggggggggggjjjjj05555kggggggggk5555jjjjjjjjjjjggggggggggggggggggggggggggkk0c.",
  ".h7i7777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777777i7h.",
  ".hchhh111cccccc111111111111111111111111111111111111111111111111h11111111111111111111111hccccc1h11hhhh.",
  "........fnin7ndf111111..........................................................111111fdnn7inf........",
  "........f7mkgidfh1hhhh..........................................................11111hfdigkm71........",
  "........f73kkidfh11111..........................................................111111fdikk37f........",
  "........f73kkidfh11111..........................................................111111fdikk371........",
  "........f73kkidfh11hh1..........................................................11h111fdikk371........",
  "........f73kkidfh11hh1..........................................................11h111fdikk371........",
  "........f73kkidfh11h11..........................................................11h111fdikk371........",
  "........f73kkidfh111hh..........................................................1h1111fdikk371........",
  "........f73kkidfh111hh..........................................................1h111hfdikk371........",
  "........f73kkidfh111hh..........................................................11111hfdikk371........",
  "........f73kkldf111111..........................................................11111hfdikk371........",
  "........f73kkidfh11111..........................................................11111hfdikk371........",
  "........f73kkidfh11111..........................................................11111hfdikk371........",
  "........f73kkidfh1hh11..........................................................11111hfdikk371........",
  "........f73kkidfh1hh1h..........................................................h1111hfdikk371........",
  "........f73kkidfh1hhhh..........................................................111111fdikk371........",
  "........f73kkidfh1hhhh..........................................................111111fdikk371........",
  "........f73kkldfh1hhhh..........................................................11hh1hfdikk371........",
  "........f73kkldfh111hh..........................................................11hh1hfdikk371........",
  "........f73kkidfh11hhh..........................................................11111hfdikk371........",
  "........f73kkidfh1hhhh..........................................................hh111hfdikk371........",
  "........f73kkidfh11hhh..........................................................hhh11hfdikk371........",
  "........f73kkidfh11111..........................................................1hh11hfdikk371........",
  "........f73kkidfh11111..........................................................11111hfdikk371........",
  "........fnmkgidfhhhhhh..........................................................hhhhh1fdigkm7f........",
  ".......cccdddccc1chhhc..........................................................hhccc1cccdddccc.......",
  ".......1dnddddnd1....................................................................hcdddddnd1.......",
  ".......fccccccchf....................................................................1hcccccccf.......",
  ".......c11111111cc..................................................................cc1h1h11h1cc......",
  ".......cccccccccc1..................................................................1ccccccccccf......",
] as const;

interface CachedTableSprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

const tableSpriteCache = new WeakMap<
  readonly string[],
  WeakMap<Record<string, string>, CachedTableSprite>
>();

const drawTableSpriteRows = (
  ctx: CanvasRenderingContext2D,
  spriteX: number,
  spriteY: number,
  palette: Record<string, string>,
  rows: readonly string[],
) => {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    let runColor: string | null = null;
    let runStart = 0;

    for (let column = 0; column <= row.length; column += 1) {
      const token = column < row.length ? row.charAt(column) : ".";
      const color = token === "." ? null : palette[token] ?? null;

      if (color === runColor) continue;

      if (runColor) {
        drawPixelRect(ctx, spriteX + runStart, spriteY + rowIndex, column - runStart, 1, runColor);
      }

      runColor = color;
      runStart = column;
    }
  }
};

const getCachedTableSprite = (
  ctx: CanvasRenderingContext2D,
  palette: Record<string, string>,
  rows: readonly string[],
) => {
  let paletteCache = tableSpriteCache.get(rows);
  if (!paletteCache) {
    paletteCache = new WeakMap<Record<string, string>, CachedTableSprite>();
    tableSpriteCache.set(rows, paletteCache);
  }

  const cachedSprite = paletteCache.get(palette);
  if (cachedSprite) return cachedSprite;

  const width = Math.max(0, ...rows.map((row) => row.length));
  const height = rows.length;
  if (width <= 0 || height <= 0) return null;

  const cacheCanvas = ctx.canvas.ownerDocument.createElement("canvas");
  cacheCanvas.width = width;
  cacheCanvas.height = height;
  const cacheCtx = cacheCanvas.getContext("2d");
  if (!cacheCtx) return null;

  cacheCtx.imageSmoothingEnabled = false;
  drawTableSpriteRows(cacheCtx, 0, 0, palette, rows);

  const nextSprite = { canvas: cacheCanvas, width, height };
  paletteCache.set(palette, nextSprite);
  return nextSprite;
};

const drawTableSprite = (
  ctx: CanvasRenderingContext2D,
  spriteX: number,
  spriteY: number,
  palette: Record<string, string>,
  rows: readonly string[],
) => {
  const cachedSprite = getCachedTableSprite(ctx, palette, rows);
  if (!cachedSprite) {
    drawTableSpriteRows(ctx, spriteX, spriteY, palette, rows);
    return;
  }

  ctx.drawImage(cachedSprite.canvas, Math.round(spriteX), Math.round(spriteY));
};

const drawSpriteSubRect = (
  ctx: CanvasRenderingContext2D,
  spriteX: number,
  spriteY: number,
  palette: Record<string, string>,
  rows: readonly string[],
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth = sourceWidth,
  destinationHeight = sourceHeight,
) => {
  const cachedSprite = getCachedTableSprite(ctx, palette, rows);
  if (!cachedSprite) return;

  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    cachedSprite.canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    Math.round(spriteX),
    Math.round(spriteY),
    Math.round(destinationWidth),
    Math.round(destinationHeight),
  );
  ctx.imageSmoothingEnabled = smoothing;
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
    const skinId = bedSkinId(item);
    const industrial = skinId === "industrial-bed-skin";
    const pinkPlaid = skinId === "ivory-pink-plaid-bed-skin";
    const modernMinimal =
      skinId === "modern-minimal-bed-skin" ||
      skinId === "space-white-deep-gray-bed-skin";
    const sprite = bedSpriteForSkinId(skinId);

    if (modernMinimal && sprite) {
      drawPixelRect(ctx, item.x + 6, item.y + item.height + 3, item.width - 8, 8, palette.shadow);
    } else {
      drawPixelRect(ctx, item.x + 8, item.y + 10, item.width, item.height, palette.shadow);
    }
    if (sprite) {
      drawBedSpriteMatrix(
        ctx,
        item.x + BED_SPRITE_X_OFFSET,
        item.y + BED_SPRITE_Y_OFFSET,
        sprite,
      );

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
    const classic = skinId === "classic";

    drawPixelRect(
      ctx,
      item.x + 6,
      item.y + 9,
      item.width,
      item.height + 19,
      industrialFrame
        ? acrylic
          ? "rgba(18, 28, 32, 0.07)"
          : "rgba(16, 18, 23, 0.9)"
        : "rgba(21, 19, 33, 0.9)",
    );

    const drawerTop = item.y + 32;
    const leftX = item.x - 2;
    const stackWidth = 30;
    const rightX = item.x + item.width - stackWidth + 2;
    const drawerHeight = 10;
    const drawerGap = 11;

    if (industrial || acrylic) {
      const spriteX = item.x + (acrylic ? ACRYLIC_DESK_SPRITE_X_OFFSET : INDUSTRIAL_DESK_SPRITE_X_OFFSET);
      const spriteY = item.y + (acrylic ? ACRYLIC_DESK_SPRITE_Y_OFFSET : INDUSTRIAL_DESK_SPRITE_Y_OFFSET);

      if (acrylic) {
        const backSupportY = spriteY + 5;
        drawPixelRect(ctx, spriteX + 9, backSupportY, 94, 4, "rgba(89, 196, 218, 0.34)");
        drawPixelRect(ctx, spriteX + 9, backSupportY, 94, 1, "rgba(238, 254, 255, 0.72)");
        drawPixelRect(ctx, spriteX + 10, backSupportY + 1, 92, 1, "rgba(188, 238, 249, 0.48)");
        drawPixelRect(ctx, spriteX + 10, backSupportY + 3, 92, 1, "rgba(35, 93, 108, 0.42)");

        const drawTabletopSupportSide = (x: number, y: number, height: number) => {
          drawPixelRect(ctx, x, y, 4, height, "rgba(83, 187, 208, 0.36)");
          drawPixelRect(ctx, x, y, 1, height, "rgba(238, 254, 255, 0.72)");
          drawPixelRect(ctx, x + 1, y + 1, 1, height - 2, "rgba(184, 236, 248, 0.46)");
          drawPixelRect(ctx, x + 3, y + 1, 1, height - 2, "rgba(35, 91, 106, 0.4)");
        };
        drawTabletopSupportSide(spriteX + 3, spriteY + 5, 41);
        drawTabletopSupportSide(spriteX + 102, spriteY + 9, 30);

        const drawRearLeg = (x: number, y: number, height: number) => {
          drawPixelRect(ctx, x, y, 8, height, "rgba(48, 66, 73, 0.72)");
          drawPixelRect(ctx, x + 1, y, 2, height, "rgba(240, 252, 255, 0.7)");
          drawPixelRect(ctx, x + 3, y + 1, 2, height - 2, "rgba(116, 176, 190, 0.52)");
          drawPixelRect(ctx, x + 6, y + 2, 2, height - 4, "rgba(20, 31, 38, 0.44)");
        };
        drawRearLeg(spriteX + 6, spriteY + 9, 25);
        drawRearLeg(spriteX + 94, spriteY + 7, 25);

        drawPixelRect(ctx, spriteX + 5, spriteY + 37, 98, 2, "rgba(112, 194, 210, 0.32)");
        drawPixelRect(ctx, spriteX + 6, spriteY + 39, 96, 2, "rgba(33, 68, 78, 0.28)");
      }

      drawTableSprite(
        ctx,
        spriteX,
        spriteY,
        acrylic ? ACRYLIC_DESK_SPRITE_PALETTE : INDUSTRIAL_DESK_SPRITE_PALETTE,
        acrylic ? ACRYLIC_DESK_SPRITE_ROWS : INDUSTRIAL_DESK_SPRITE_ROWS,
      );

      const frontFootY = drawerTop - 2 + 38 - 3;
      drawPixelRect(
        ctx,
        item.x + 6,
        drawerTop + 5,
        item.width - 12,
        frontFootY - drawerTop - 2,
        acrylic ? "rgba(20, 28, 32, 0.07)" : "rgba(8, 10, 13, 0.34)",
      );
      drawPixelRect(
        ctx,
        item.x + 10,
        frontFootY - 2,
        item.width - 20,
        3,
        acrylic ? "rgba(31, 43, 49, 0.08)" : "rgba(15, 18, 22, 0.38)",
      );
      drawPixelRect(
        ctx,
        leftX,
        drawerTop + 6,
        4,
        frontFootY - drawerTop - 3,
        acrylic ? "rgba(20, 30, 36, 0.1)" : "rgba(8, 10, 13, 0.46)",
      );
      drawPixelRect(
        ctx,
        rightX + stackWidth - 1,
        drawerTop + 6,
        4,
        frontFootY - drawerTop - 3,
        acrylic ? "rgba(20, 30, 36, 0.1)" : "rgba(8, 10, 13, 0.46)",
      );

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

    if (classic || rococo) {
      drawTableSprite(
        ctx,
        item.x + CLASSIC_DESK_SPRITE_X_OFFSET,
        item.y + CLASSIC_DESK_SPRITE_Y_OFFSET,
        rococo ? ROCOCO_DESK_SPRITE_PALETTE : CLASSIC_DESK_SPRITE_PALETTE,
        rococo ? ROCOCO_DESK_SPRITE_ROWS : CLASSIC_DESK_SPRITE_ROWS,
      );

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
    const skinId = tableSkinId(item);
    const spriteX = Math.round(item.x - 4);
    const spriteY = Math.round(item.y - 5);
    const drawTableSelection = () => {
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
    };

    drawPixelRect(ctx, item.x + 5, item.y + 10, item.width, 50, "rgba(21, 19, 33, 0.9)");

    if (skinId === "rococo-ivory-table-skin") {
      drawTableSprite(ctx, spriteX, spriteY, ROCOCO_TABLE_SPRITE_PALETTE, ROCOCO_TABLE_SPRITE_ROWS);
      drawTableSelection();
      return;
    }

    if (skinId === "dark-oak-table-skin") {
      drawTableSprite(ctx, spriteX, spriteY, DARK_OAK_TABLE_SPRITE_PALETTE, DARK_OAK_TABLE_SPRITE_ROWS);
      drawTableSelection();
      return;
    }

    if (skinId === "white-tech-table-skin") {
      drawTableSprite(ctx, spriteX, spriteY, WHITE_TECH_TABLE_SPRITE_PALETTE, WHITE_TECH_TABLE_SPRITE_ROWS);
      drawTableSelection();
      return;
    }

    drawTableSprite(ctx, spriteX, spriteY, CLASSIC_TABLE_SPRITE_PALETTE, CLASSIC_TABLE_SPRITE_ROWS);
    drawTableSelection();
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

    const fridgeSprite = FRIDGE_SKIN_SPRITE_DATA[skinId];
    if (fridgeSprite) {
      const spriteX = Math.round(item.x + FRIDGE_DEFAULT_SPRITE_X_OFFSET);
      const spriteY = Math.round(item.y + FRIDGE_DEFAULT_SPRITE_Y_OFFSET);
      drawPixelRect(
        ctx,
        spriteX + 9,
        spriteY + FRIDGE_DEFAULT_TOP_HEIGHT + FRIDGE_DEFAULT_FRONT_HEIGHT,
        FRIDGE_DEFAULT_SPRITE_WIDTH - 18,
        8,
        "rgba(21, 19, 33, 0.9)",
      );
      drawTableSprite(
        ctx,
        spriteX,
        spriteY,
        fridgeSprite.palette,
        fridgeSprite.rows,
      );

      if (doorOpen > 0) {
        const defaultUpperDoor = {
          x: spriteX + FRIDGE_DEFAULT_BODY_X,
          y: spriteY + FRIDGE_DEFAULT_TOP_HEIGHT,
          width: FRIDGE_DEFAULT_BODY_WIDTH,
          height: 28,
        };
        drawPixelRect(
          ctx,
          defaultUpperDoor.x,
          defaultUpperDoor.y,
          defaultUpperDoor.width,
          defaultUpperDoor.height,
          "#12231a",
        );
        drawPixelRect(
          ctx,
          defaultUpperDoor.x + 1,
          defaultUpperDoor.y + 1,
          defaultUpperDoor.width - 2,
          defaultUpperDoor.height - 2,
          "#c6f0ef",
        );
        drawPixelRect(
          ctx,
          defaultUpperDoor.x + 4,
          defaultUpperDoor.y + 5,
          defaultUpperDoor.width - 8,
          4,
          "#ecfbff",
        );
        drawPixelRect(
          ctx,
          defaultUpperDoor.x + 4,
          defaultUpperDoor.y + defaultUpperDoor.height - 8,
          defaultUpperDoor.width - 8,
          3,
          "#d6f4f7",
        );
        drawPixelRect(ctx, defaultUpperDoor.x + 9, defaultUpperDoor.y + 12, 6, 7, "#d7a65e");
        drawPixelRect(ctx, defaultUpperDoor.x + 24, defaultUpperDoor.y + 10, 8, 7, "#f0d8a2");
        drawPixelRect(
          ctx,
          defaultUpperDoor.x,
          defaultUpperDoor.y + defaultUpperDoor.height - 1,
          defaultUpperDoor.width,
          2,
          "#102015",
        );

        const doorWidth = Math.max(
          10,
          Math.round(defaultUpperDoor.width * (1 - doorOpen * 0.72)),
        );
        const doorX = defaultUpperDoor.x + defaultUpperDoor.width - doorWidth;
        drawSpriteSubRect(
          ctx,
          doorX,
          defaultUpperDoor.y,
          fridgeSprite.palette,
          fridgeSprite.rows,
          FRIDGE_DEFAULT_BODY_X,
          FRIDGE_DEFAULT_TOP_HEIGHT,
          defaultUpperDoor.width,
          defaultUpperDoor.height,
          doorWidth,
          defaultUpperDoor.height,
        );
      }

      if (highlight !== "none") {
        ctx.strokeStyle = highlight === "selected" ? "#ffe66d" : "#9ee6ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          spriteX,
          spriteY,
          FRIDGE_DEFAULT_SPRITE_WIDTH,
          FRIDGE_DEFAULT_SPRITE_HEIGHT,
        );
      }
      if (highlight === "selected") {
        drawFurnitureCollisionRange(ctx, item);
      }
      return;
    }

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

const drawDemoSparkAvatar = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  frame: number,
  x: number,
  y: number,
  wiggle: number,
  body: string,
  bodyLight: string,
  ink: string,
  theme: (typeof traitVisualThemes)[DominantTrait],
  dominantTrait: DominantTrait,
) => {
  const facing = avatar.facing;
  const sideDirection = facing === "left" ? -1 : 1;
  const focused = avatar.expression === "focused";
  const worried = avatar.expression === "worried";
  const sleepy = avatar.expression === "sleepy";
  const happy = avatar.expression === "happy";
  const completeYawn = avatar.behavior === "success";
  const sparkLift = Math.round(Math.sin(frame / 5) * 2);
  const pulse = Math.round(Math.sin(frame / 6) * 1);
  const shell = "#083344";
  const shellLight = "#22d3ee";
  const glow = avatar.behavior === "error" ? "#fb7185" : theme.screenGlow;

  drawPixelRect(ctx, x - 15, y + 10, 33, 7, "#0b1220");
  drawPixelRect(ctx, x - 16, y - 24, 34, 27, shell);
  drawPixelRect(ctx, x - 9, y - 39 + sparkLift, 3, 7, shellLight);
  drawPixelRect(ctx, x + 8, y - 39 - sparkLift, 3, 7, shellLight);
  drawPixelRect(ctx, x - 12, y - 42 + sparkLift, 7, 4, glow);
  drawPixelRect(ctx, x + 6, y - 42 - sparkLift, 7, 4, glow);
  drawPixelRect(ctx, x - 10, y - 36, 22, 5, bodyLight);
  drawPixelRect(ctx, x - 14, y - 32, 30, 9, body);
  drawPixelRect(ctx, x - 16, y - 25, 34, 17, body);
  drawPixelRect(ctx, x - 13, y - 9, 28, 10, body);
  if (facing === "back") {
    drawPixelRect(ctx, x - 12, y - 25, 26, 20, "#5f0f1c");
    drawPixelRect(ctx, x - 10, y - 23, 22, 17, "#dc2626");
    drawPixelRect(ctx, x - 8, y - 23, 18, 6, "#fff7ed");
    drawPixelRect(ctx, x - 6, y - 14, 14, 6, "#f8fafc");
    drawPixelRect(ctx, x - 1, y - 13, 4, 2, "#b91c1c");
    drawPixelRect(ctx, x - 14, y - 21, 4, 13, "#7f1d1d");
    drawPixelRect(ctx, x + 12, y - 21, 4, 13, "#7f1d1d");
  } else {
    drawPixelRect(ctx, x - 13, y - 24, 28, 9, "#0f172a");
    drawPixelRect(ctx, x - 11, y - 22, 24, 5, glow);
    drawPixelRect(ctx, x - 4 + pulse, y - 21, 5, 3, "#e0f2fe");
  }

  if (facing === "back") {
    drawPixelRect(ctx, x - 8, y - 29, 20, 4, bodyLight);
  } else if (facing === "left" || facing === "right") {
    const eyeX = x + sideDirection * 5;
    drawPixelRect(ctx, eyeX - 5, y - 22, 11, 6, "#0f172a");
    if (sleepy || completeYawn) {
      drawPixelRect(ctx, eyeX - 3, y - 19, 7, 2, glow);
    } else {
      drawPixelRect(ctx, eyeX - 3, y - 21, 7, focused ? 4 : 5, glow);
      drawPixelRect(ctx, eyeX, y - 20, 2, 2, "#eff6ff");
    }
    if (worried) {
      drawPixelRect(ctx, x - sideDirection * 12, y - 26, 3, 6, "#9ee6ff");
    }
  } else if (sleepy || completeYawn) {
    drawPixelRect(ctx, x - 8, y - 20, 18, 3, glow);
  } else {
    drawPixelRect(ctx, x - 8, y - 21, 5, focused ? 4 : 5, glow);
    drawPixelRect(ctx, x + 5, y - 21, 5, focused ? 4 : 5, glow);
    drawPixelRect(ctx, x - 6, y - 20, 2, 2, "#eff6ff");
    drawPixelRect(ctx, x + 7, y - 20, 2, 2, "#eff6ff");
    if (worried) {
      drawPixelRect(ctx, x + 16, y - 26, 3, 6, "#9ee6ff");
    }
  }

  drawPixelRect(ctx, x - 11, y - 5, 6, 14 + wiggle, body);
  drawPixelRect(ctx, x - 3, y - 3, 6, 15 - wiggle, bodyLight);
  drawPixelRect(ctx, x + 6, y - 5, 6, 13 + wiggle, body);
  if (facing !== "back") {
    drawPixelRect(ctx, x - 17, y - 1, 6, 11 - wiggle, bodyLight);
    drawPixelRect(ctx, x + 14, y - 1, 6, 11 + wiggle, bodyLight);
  }
  drawPixelRect(ctx, x - 12, y + 8 + wiggle, 7, 4, shell);
  drawPixelRect(ctx, x - 2, y + 10 - wiggle, 7, 4, shell);
  drawPixelRect(ctx, x + 8, y + 8 + wiggle, 7, 4, shell);

  if (completeYawn) {
    drawCompleteYawnPose(ctx, x, y, frame, facing, body, bodyLight, ink);
  } else if (facing !== "back") {
    const mouthX = facing === "left" || facing === "right" ? x + sideDirection * 5 : x - 2;
    drawPixelRect(ctx, mouthX, y - 11, happy ? 8 : 6, 2, happy ? "#ecfeff" : ink);
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
    drawPhonePose(ctx, x, y, frame, facing, body, bodyLight, ink, glow);
  }
  if (avatar.behavior === "admire") {
    drawAdmirePose(ctx, x, y, frame, facing, body, bodyLight, ink, glow);
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
    const tap = Math.round(Math.sin(frame / 3) * 2);
    drawPixelRect(ctx, deviceX, y - 8, 13, 9, "#07111f");
    drawPixelRect(ctx, deviceX + 2, y - 6, 9, 4, glow);
    drawPixelRect(ctx, x - 18, y - 2 + tap, 8, 4, bodyLight);
    drawPixelRect(ctx, x + 13, y - 1 - tap, 8, 4, bodyLight);
  }

  drawTraitStatusMotif(ctx, dominantTrait, avatar, x, y, frame, theme);
  drawTraitMicroExpression(ctx, dominantTrait, avatar, x, y, frame, theme);
};

const drawCuteCrayfishAvatar = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  frame: number,
  x: number,
  y: number,
  wiggle: number,
  theme: (typeof traitVisualThemes)[DominantTrait],
  dominantTrait: DominantTrait,
) => {
  const facing = avatar.facing;
  const sideDirection = facing === "left" ? -1 : 1;
  const focused = avatar.expression === "focused";
  const worried = avatar.expression === "worried";
  const sleepy = avatar.expression === "sleepy";
  const happy = avatar.expression === "happy";
  const completeYawn = avatar.behavior === "success";
  const clawLift = Math.round(Math.sin(frame / 9) * 2);
  const antennaWave = Math.round(Math.sin(frame / 16));
  const shell = avatar.behavior === "error" ? "#dc2626" : "#ef4444";
  const shellLight = "#fecaca";
  const shellMid = "#f87171";
  const shellShade = "#b91c1c";
  const shellDark = "#6f1d1b";
  const ink = "#240b0b";
  const glow = avatar.behavior === "error" ? "#fee2e2" : theme.screenGlow;
  const clawScale = 0.6;

  const drawClaw = (
    clawX: number,
    clawY: number,
    direction: number,
    open = false,
    scale = 1,
  ) => {
    const scaledOffset = (value: number) => Math.round(value * scale);
    const scaledSize = (value: number) => Math.max(1, Math.round(value * scale));
    const mirroredX = (offset: number, width: number) =>
      direction > 0
        ? clawX + scaledOffset(offset)
        : clawX - scaledOffset(offset) - scaledSize(width);
    drawPixelRect(ctx, mirroredX(-8, 13), clawY + scaledOffset(8), scaledSize(13), scaledSize(6), shellDark);
    drawPixelRect(ctx, mirroredX(-5, 10), clawY + scaledOffset(7), scaledSize(10), scaledSize(5), shellShade);
    drawPixelRect(ctx, mirroredX(2, 18), clawY + scaledOffset(-1), scaledSize(18), scaledSize(15), shellDark);
    drawPixelRect(ctx, mirroredX(4, 16), clawY + scaledOffset(-3), scaledSize(16), scaledSize(17), shell);
    drawPixelRect(ctx, mirroredX(6, 12), clawY + scaledOffset(-5), scaledSize(12), scaledSize(19), shellMid);
    drawPixelRect(ctx, mirroredX(9, 6), clawY + scaledOffset(-6), scaledSize(6), scaledSize(4), shellLight);
    drawPixelRect(ctx, mirroredX(15, 10), clawY + scaledOffset(-10), scaledSize(10), scaledSize(9), shellDark);
    drawPixelRect(ctx, mirroredX(16, 8), clawY + scaledOffset(-11), scaledSize(8), scaledSize(7), shellLight);
    drawPixelRect(ctx, mirroredX(16, 10), clawY + scaledOffset(open ? 8 : 6), scaledSize(10), scaledSize(8), shellDark);
    drawPixelRect(ctx, mirroredX(17, 8), clawY + scaledOffset(open ? 9 : 7), scaledSize(8), scaledSize(6), shell);
    drawPixelRect(ctx, mirroredX(16, 5), clawY + scaledOffset(2), scaledSize(5), scaledSize(3), ink);
  };

  const drawAnchoredClaw = (
    anchorX: number,
    anchorY: number,
    direction: number,
    open: boolean,
    rotation = 0,
  ) => {
    if (rotation === 0) {
      drawClaw(anchorX, anchorY, direction, open, clawScale);
      return;
    }

    ctx.save();
    ctx.translate(anchorX, anchorY);
    ctx.rotate(rotation);
    drawClaw(0, Math.round(-8 * clawScale), direction, open, clawScale);
    ctx.restore();
  };

  const drawTailFan = (tailX: number, tailY: number) => {
    drawPixelRect(ctx, tailX - 10, tailY, 20, 7, shellDark);
    drawPixelRect(ctx, tailX - 8, tailY - 1, 16, 7, shellShade);
    drawPixelRect(ctx, tailX - 3, tailY + 1, 6, 5, shellMid);
    drawPixelRect(ctx, tailX - 11, tailY + 3, 6, 4, shell);
    drawPixelRect(ctx, tailX + 5, tailY + 3, 6, 4, shell);
  };

  const drawLittleFeet = (footY: number, sideView = false) => {
    const step = Math.round(Math.sin(frame / 8));
    const footOffsets = sideView ? [-13, -6, 2, 9] : [-14, -8, -2, 5, 11];
    footOffsets.forEach((offset, index) => {
      const footStep = index % 2 === 0 ? step : -step;
      drawPixelRect(ctx, x + offset, footY + footStep, 5, 5, shellDark);
      drawPixelRect(ctx, x + offset + 1, footY + 3 + footStep, 5, 2, shellShade);
    });
  };

  const drawHeldClawGrip = (gripX: number, gripY: number, direction: number) => {
    void gripX;
    void gripY;
    void direction;
  };

  const drawTwoClawHold = (leftX: number, rightX: number, gripY: number) => {
    drawHeldClawGrip(leftX, gripY, -1);
    drawHeldClawGrip(rightX, gripY, 1);
  };

  type CrayfishClawPose = {
    clawX: number;
    clawY: number;
    direction: number;
    armScale?: number;
    jointX?: number;
    jointY?: number;
    shoulderX?: number;
    shoulderY?: number;
    wristX?: number;
    wristY?: number;
    clawRotation?: number;
    open?: boolean;
  };

  const frontLeftShoulderX = x - 18;
  const frontRightShoulderX = x + 18;
  const frontShoulderY = y - 22;

  const crayfishMouthAnchor = () => {
    const front = facing === "front";
    const side = facing === "left" ? -1 : 1;
    const mouthLeftX = front ? x - 3 : x + side * 7;
    const mouthY = y - 19;
    return {
      front,
      side,
      mouthLeftX,
      mouthCenterX: mouthLeftX + 3,
      mouthY,
    };
  };

  const crayfishActionLayout = () => {
    const { front, side, mouthLeftX, mouthCenterX, mouthY } = crayfishMouthAnchor();
    const isDrinking = avatar.behavior === "coffee" || avatar.behavior === "cola";
    const isPhone = avatar.behavior === "phone";
    const bob = isDrinking ? 0 : isPhone ? Math.round(Math.sin(frame / 16)) : Math.round(Math.sin(frame / 5));
    const tap = isPhone ? Math.round(Math.sin(frame / 14)) : Math.round(Math.sin(frame / 4) * 2);
    const drinkX = front ? mouthCenterX : mouthCenterX + side * 7;
    const drinkTopY = mouthY + 2 + bob;
    const trayX = front ? x - 13 : mouthCenterX + side * 4 - 13;
    const trayY = y - 12 + bob;
    const cookieX = front ? x + 4 : mouthCenterX + side * 7;
    const cookieY = mouthY + 4 + bob;
    const phoneX = front ? x : x + side * 18;
    const phoneY = y - 18 + bob;
    return {
      front,
      side,
      mouthLeftX,
      mouthCenterX,
      mouthY,
      bob,
      tap,
      drinkX,
      drinkTopY,
      drinkGripY: drinkTopY + 8,
      trayX,
      trayY,
      cookieX,
      cookieY,
      phoneX,
      phoneY,
    };
  };

  const defaultFrontClaws = (): CrayfishClawPose[] => [
    {
      shoulderX: frontLeftShoulderX,
      shoulderY: frontShoulderY,
      jointX: x - 30,
      jointY: y - 36 + clawLift,
      wristX: x - 44,
      wristY: y - 48 + clawLift,
      clawX: x - 44,
      clawY: y - 48 + clawLift,
      direction: 1,
      clawRotation: -Math.PI / 2,
      open: focused,
    },
    {
      shoulderX: frontRightShoulderX,
      shoulderY: frontShoulderY,
      jointX: x + 30,
      jointY: y - 36 - clawLift,
      wristX: x + 44,
      wristY: y - 48 - clawLift,
      clawX: x + 44,
      clawY: y - 48 - clawLift,
      direction: -1,
      clawRotation: Math.PI / 2,
      open: focused,
    },
  ];

  const drawArmSegment = (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string,
    size = 4,
  ) => {
    const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY), 1);
    const stride = 4;
    for (let step = 0; step <= steps; step += stride) {
      const t = step / steps;
      const px = Math.round(fromX + (toX - fromX) * t);
      const py = Math.round(fromY + (toY - fromY) * t);
      drawPixelRect(ctx, px - Math.floor(size / 2), py - Math.floor(size / 2), size, size, color);
    }
  };

  const drawCrayfishArm = (
    shoulderX: number,
    shoulderY: number,
    jointX: number,
    jointY: number,
    wristX: number,
    wristY: number,
  ) => {
    drawPixelRect(ctx, shoulderX - 2, shoulderY - 2, 5, 5, shellDark);
    drawPixelRect(ctx, shoulderX - 1, shoulderY - 1, 3, 3, shell);
    drawArmSegment(shoulderX, shoulderY, jointX, jointY, shellDark, 4);
    drawPixelRect(ctx, jointX - 2, jointY - 2, 5, 5, shellDark);
    drawPixelRect(ctx, jointX - 2, jointY - 2, 4, 4, shellMid);
    drawArmSegment(jointX, jointY, wristX, wristY, shellShade, 4);
    drawPixelRect(ctx, wristX - 2, wristY - 2, 4, 4, shellShade);
  };

  const drawCrayfishEfficiencyControl = (controlX: number, controlY: number) => {
    if (dominantTrait !== "efficiency") return;

    const blink = frame % 32 < 16;
    drawPixelRect(ctx, controlX - 2, controlY - 2, 15, 11, ink);
    drawPixelRect(ctx, controlX - 1, controlY - 1, 13, 9, "#10231a");
    drawPixelRect(ctx, controlX + 1, controlY + 1, 3, 3, theme.accent);
    drawPixelRect(ctx, controlX + 5, controlY + (blink ? 1 : 4), 3, 3, theme.bodyLight);
    drawPixelRect(ctx, controlX + 9, controlY + 2, 2, 5, theme.accent);
    drawPixelRect(ctx, controlX + 2, controlY + 6, 7, 1, "#d8fff7");
  };

  const drawDumbbell = (centerX: number, centerY: number) => {
    drawPixelRect(ctx, centerX - 9, centerY - 2, 18, 4, "#111827");
    drawPixelRect(ctx, centerX - 12, centerY - 5, 5, 10, ink);
    drawPixelRect(ctx, centerX + 7, centerY - 5, 5, 10, ink);
    drawPixelRect(ctx, centerX - 11, centerY - 4, 3, 8, "#374151");
    drawPixelRect(ctx, centerX + 8, centerY - 4, 3, 8, "#374151");
    drawPixelRect(ctx, centerX - 6, centerY - 1, 12, 2, "#6b7280");
    drawPixelRect(ctx, centerX - 10, centerY - 4, 1, 2, "#9ca3af");
    drawPixelRect(ctx, centerX + 9, centerY - 4, 1, 2, "#9ca3af");
  };

  const drawCrayfishClaws = (poses: CrayfishClawPose[]) => {
    poses.forEach((pose) => {
      const armScale = pose.armScale ?? 0.35;
      const side = pose.clawX < x ? -1 : 1;
      const shoulderX =
        pose.shoulderX ?? (facing === "left" || facing === "right" ? x + sideDirection * 14 : x + side * 15);
      const shoulderY = pose.shoulderY ?? y - 23;
      const rawJointX = pose.jointX ?? Math.round((shoulderX + pose.clawX) / 2);
      const rawJointY = pose.jointY ?? Math.round((shoulderY + pose.clawY) / 2) - 2;
      const rawWristX = pose.wristX ?? Math.round((rawJointX + pose.clawX) / 2);
      const rawWristY = pose.wristY ?? Math.round((rawJointY + pose.clawY + 6) / 2);
      const jointX = Math.round(shoulderX + (rawJointX - shoulderX) * armScale);
      const jointY = Math.round(shoulderY + (rawJointY - shoulderY) * armScale);
      const wristX = Math.round(shoulderX + (rawWristX - shoulderX) * armScale);
      const wristY = Math.round(shoulderY + (rawWristY - shoulderY) * armScale);
      const clawX = Math.round(shoulderX + (pose.clawX - shoulderX) * armScale);
      const clawY = Math.round(shoulderY + (pose.clawY - shoulderY) * armScale);
      drawCrayfishArm(shoulderX, shoulderY, jointX, jointY, wristX, wristY);
      drawAnchoredClaw(
        pose.clawRotation === undefined ? clawX : wristX,
        pose.clawRotation === undefined ? clawY : wristY,
        pose.direction,
        Boolean(pose.open),
        pose.clawRotation,
      );
    });
  };

  const getCrayfishClawPoses = () => {
    const tap = Math.round(Math.sin(frame / 3) * 2);
    const bob = Math.round(Math.sin(frame / 5));
    const isTyping = avatar.behavior === "coding" || avatar.behavior === "thinking";
    const isFoodOrDrink =
      avatar.behavior === "coffee" ||
      avatar.behavior === "cola" ||
      avatar.behavior === "cookie";
    const isTwoClawHold =
      avatar.behavior === "bento" || avatar.behavior === "read_task_file";
    const isSinglePropHold =
      isFoodOrDrink ||
      avatar.behavior === "phone" ||
      avatar.behavior === "fetch_task_file" ||
      avatar.behavior === "carry_task_file";

    if (facing === "left" || facing === "right") {
      const side = facing === "left" ? -1 : 1;
      if (isTyping) {
        return [
          {
            armScale: 1,
            shoulderX: x + side * 13,
            shoulderY: y - 23,
            jointX: x + side * 20,
            jointY: y - 15 + tap,
            wristX: x + side * 27,
            wristY: y - 6 + tap,
            clawX: x + side * 29,
            clawY: y - 5 + tap,
            direction: side,
            open: true,
          },
        ];
      }
      if (avatar.behavior === "phone") {
        const layout = crayfishActionLayout();
        return [
          {
            armScale: 1,
            shoulderX: x + side * 13,
            shoulderY: y - 23,
            jointX: x + side * 20,
            jointY: y - 15 + layout.bob,
            wristX: layout.phoneX - side * 8,
            wristY: layout.phoneY + 11,
            clawX: layout.phoneX - side * 8,
            clawY: layout.phoneY + 11,
            direction: side,
            open: false,
          },
          {
            armScale: 1,
            shoulderX: x - side * 11,
            shoulderY: y - 18,
            jointX: x + side * 5,
            jointY: y - 11 - layout.tap,
            wristX: layout.phoneX + side * 3,
            wristY: layout.phoneY + 7 - layout.tap,
            clawX: layout.phoneX + side * 3,
            clawY: layout.phoneY + 7 - layout.tap,
            direction: side,
            open: true,
          },
        ];
      }
      if (avatar.behavior === "coffee" || avatar.behavior === "cola") {
        const layout = crayfishActionLayout();
        return [
          {
            armScale: 1,
            shoulderX: x + side * 13,
            shoulderY: y - 23,
            jointX: x + side * 19,
            jointY: y - 14 + layout.bob,
            wristX: layout.drinkX - side * 6,
            wristY: layout.drinkGripY,
            clawX: layout.drinkX - side * 6,
            clawY: layout.drinkGripY,
            direction: side,
            open: true,
          },
          {
            armScale: 1,
            shoulderX: x - side * 11,
            shoulderY: y - 18,
            jointX: x + side * 3,
            jointY: y - 10 + layout.bob,
            wristX: layout.drinkX - side * 1,
            wristY: layout.drinkGripY + 1,
            clawX: layout.drinkX - side * 1,
            clawY: layout.drinkGripY + 1,
            direction: side,
            open: true,
          },
        ];
      }
      if (avatar.behavior === "bento") {
        const layout = crayfishActionLayout();
        return [
          {
            armScale: 1,
            shoulderX: x + side * 13,
            shoulderY: y - 23,
            jointX: x + side * 19,
            jointY: y - 12 + bob,
            wristX: layout.trayX + 3,
            wristY: layout.trayY + 5,
            clawX: layout.trayX + 3,
            clawY: layout.trayY + 5,
            direction: side,
            open: true,
          },
          {
            armScale: 1,
            shoulderX: x - side * 11,
            shoulderY: y - 18,
            jointX: x + side * 2,
            jointY: y - 9 + bob,
            wristX: layout.trayX + 20,
            wristY: layout.trayY + 5,
            clawX: layout.trayX + 20,
            clawY: layout.trayY + 5,
            direction: side,
            open: true,
          },
        ];
      }
      if (avatar.behavior === "cookie") {
        const layout = crayfishActionLayout();
        return [
          {
            armScale: 1,
            shoulderX: x + side * 13,
            shoulderY: y - 23,
            jointX: x + side * 19,
            jointY: y - 17 + bob,
            wristX: layout.cookieX - side * 4,
            wristY: layout.cookieY + 2,
            clawX: layout.cookieX - side * 4,
            clawY: layout.cookieY + 2,
            direction: side,
            open: true,
          },
          {
            armScale: 1,
            shoulderX: x - side * 11,
            shoulderY: y - 18,
            jointX: x - side * 10,
            jointY: y - 8,
            wristX: x - side * 11,
            wristY: y - 2,
            clawX: x - side * 11,
            clawY: y - 2,
            direction: -side,
            open: false,
          },
        ];
      }
      if (avatar.behavior === "workout") {
        const lift = Math.round((Math.sin(frame / 18) + 1) * 7);
        return [
          {
            armScale: 1,
            shoulderX: x + side * 13,
            shoulderY: y - 23,
            jointX: x + side * 18,
            jointY: y - 17 - Math.round(lift / 2),
            wristX: x + side * 25,
            wristY: y - 16 - lift,
            clawX: x + side * 25,
            clawY: y - 16 - lift,
            direction: side,
            open: false,
          },
          {
            armScale: 1,
            shoulderX: x - side * 11,
            shoulderY: y - 18,
            jointX: x + side * 3,
            jointY: y - 9,
            wristX: x + side * 8,
            wristY: y - 2 + Math.round(lift / 6),
            clawX: x + side * 8,
            clawY: y - 2 + Math.round(lift / 6),
            direction: -side,
            open: false,
          },
        ];
      }
      if (
        isSinglePropHold ||
        isTwoClawHold ||
        avatar.behavior === "admire" ||
        avatar.behavior === "paint"
      ) {
        return [
          {
            shoulderX: x + side * 13,
            shoulderY: y - 23,
            jointX: x + side * 22,
            jointY: y - 20 + bob,
            wristX: x + side * 19,
            wristY: y - 21 + bob,
            clawX: x + side * 17,
            clawY: y - 21 + bob,
            direction: isSinglePropHold || isTwoClawHold ? -side : side,
            open: true,
          },
        ];
      }
      return [
        {
          shoulderX: x + side * 13,
          shoulderY: y - 21,
          jointX: x + side * 22,
          jointY: y - 29 - clawLift,
          wristX: x + side * 27,
          wristY: y - 31 - clawLift,
          clawX: x + side * 28,
          clawY: y - 28 - clawLift,
          direction: side,
          clawRotation: -side * (Math.PI / 2),
          open: focused,
        },
      ];
    }

    if (isTyping) {
      return [
        {
          armScale: 1,
          shoulderX: frontLeftShoulderX,
          shoulderY: frontShoulderY,
          jointX: x - 15,
          jointY: y - 14 + tap,
          wristX: x - 9,
          wristY: y - 5 + tap,
          clawX: x - 8,
          clawY: y - 4 + tap,
          direction: 1,
          open: true,
        },
        {
          armScale: 1,
          shoulderX: frontRightShoulderX,
          shoulderY: frontShoulderY,
          jointX: x + 15,
          jointY: y - 14 - tap,
          wristX: x + 9,
          wristY: y - 5 - tap,
          clawX: x + 8,
          clawY: y - 4 - tap,
          direction: -1,
          open: true,
        },
      ];
    }

    if (avatar.behavior === "phone") {
      const layout = crayfishActionLayout();
      return [
        {
          armScale: 1,
          shoulderX: frontLeftShoulderX,
          shoulderY: frontShoulderY,
          jointX: x - 15,
          jointY: y - 12 + layout.bob,
          wristX: layout.phoneX - 7,
          wristY: layout.phoneY + 12,
          clawX: layout.phoneX - 7,
          clawY: layout.phoneY + 12,
          direction: 1,
          open: false,
        },
        {
          armScale: 1,
          shoulderX: frontRightShoulderX,
          shoulderY: frontShoulderY,
          jointX: x + 14,
          jointY: y - 14 - layout.tap,
          wristX: layout.phoneX + 10,
          wristY: layout.phoneY + 7 - layout.tap,
          clawX: layout.phoneX + 10,
          clawY: layout.phoneY + 7 - layout.tap,
          direction: -1,
          open: true,
        },
      ];
    }

    if (avatar.behavior === "coffee" || avatar.behavior === "cola") {
      const layout = crayfishActionLayout();
      return [
        {
          armScale: 1,
          shoulderX: frontLeftShoulderX,
          shoulderY: frontShoulderY,
          jointX: x - 14,
          jointY: y - 14 + layout.bob,
          wristX: layout.drinkX - 8,
          wristY: layout.drinkGripY,
          clawX: layout.drinkX - 8,
          clawY: layout.drinkGripY,
          direction: 1,
          open: true,
        },
        {
          armScale: 1,
          shoulderX: frontRightShoulderX,
          shoulderY: frontShoulderY,
          jointX: x + 14,
          jointY: y - 14 + layout.bob,
          wristX: layout.drinkX + 8,
          wristY: layout.drinkGripY,
          clawX: layout.drinkX + 8,
          clawY: layout.drinkGripY,
          direction: -1,
          open: true,
        },
      ];
    }

    if (avatar.behavior === "bento") {
      const layout = crayfishActionLayout();
      return [
        {
          armScale: 1,
          shoulderX: frontLeftShoulderX,
          shoulderY: frontShoulderY,
          jointX: x - 16,
          jointY: y - 11 + bob,
          wristX: layout.trayX - 1,
          wristY: layout.trayY + 5,
          clawX: layout.trayX - 1,
          clawY: layout.trayY + 5,
          direction: 1,
          open: true,
        },
        {
          armScale: 1,
          shoulderX: frontRightShoulderX,
          shoulderY: frontShoulderY,
          jointX: x + 16,
          jointY: y - 11 + bob,
          wristX: layout.trayX + 27,
          wristY: layout.trayY + 5,
          clawX: layout.trayX + 27,
          clawY: layout.trayY + 5,
          direction: -1,
          open: true,
        },
      ];
    }

    if (avatar.behavior === "cookie") {
      const layout = crayfishActionLayout();
      return [
        {
          armScale: 1,
          shoulderX: frontLeftShoulderX,
          shoulderY: frontShoulderY,
          jointX: x - 14,
          jointY: y - 10,
          wristX: x - 10,
          wristY: y - 2,
          clawX: x - 10,
          clawY: y - 2,
          direction: 1,
          open: false,
        },
        {
          armScale: 1,
          shoulderX: frontRightShoulderX,
          shoulderY: frontShoulderY,
          jointX: x + 15,
          jointY: y - 17 + bob,
          wristX: layout.cookieX + 4,
          wristY: layout.cookieY + 2,
          clawX: layout.cookieX + 4,
          clawY: layout.cookieY + 2,
          direction: -1,
          open: true,
        },
      ];
    }

    if (avatar.behavior === "workout") {
      const lift = Math.round((Math.sin(frame / 18) + 1) * 7);
      const leftY = y - 18 - lift;
      const rightY = y - 18 - Math.round(lift * 0.75);
      return [
        {
          armScale: 1,
          shoulderX: frontLeftShoulderX,
          shoulderY: frontShoulderY,
          jointX: x - 21,
          jointY: y - 18 - Math.round(lift / 2),
          wristX: x - 27,
          wristY: leftY,
          clawX: x - 27,
          clawY: leftY,
          direction: 1,
          open: false,
        },
        {
          armScale: 1,
          shoulderX: frontRightShoulderX,
          shoulderY: frontShoulderY,
          jointX: x + 21,
          jointY: y - 18 - Math.round(lift / 3),
          wristX: x + 27,
          wristY: rightY,
          clawX: x + 27,
          clawY: rightY,
          direction: -1,
          open: false,
        },
      ];
    }

    if (isFoodOrDrink || avatar.behavior === "fetch_task_file" || avatar.behavior === "carry_task_file") {
      return [
        defaultFrontClaws()[0],
        {
          shoulderX: frontRightShoulderX,
          shoulderY: frontShoulderY,
          jointX: x + 18,
          jointY: y - 21 + bob,
          wristX: x + 13,
          wristY: y - 22 + bob,
          clawX: x + 9,
          clawY: y - 22 + bob,
          direction: -1,
          open: true,
        },
      ];
    }

    if (isTwoClawHold) {
      return [
        {
          shoulderX: frontLeftShoulderX,
          shoulderY: frontShoulderY,
          jointX: x - 18,
          jointY: y - 16 + bob,
          wristX: x - 13,
          wristY: y - 14 + bob,
          clawX: x - 8,
          clawY: y - 12 + bob,
          direction: 1,
          open: true,
        },
        {
          shoulderX: frontRightShoulderX,
          shoulderY: frontShoulderY,
          jointX: x + 18,
          jointY: y - 16 + bob,
          wristX: x + 13,
          wristY: y - 14 + bob,
          clawX: x + 8,
          clawY: y - 12 + bob,
          direction: -1,
          open: true,
        },
      ];
    }

    if (avatar.behavior === "paint") {
      return [
        {
          shoulderX: frontLeftShoulderX,
          shoulderY: frontShoulderY,
          jointX: x - 20,
          jointY: y - 16 + bob,
          wristX: x - 20,
          wristY: y - 12 + bob,
          clawX: x - 20,
          clawY: y - 9 + bob,
          direction: -1,
          open: true,
        },
        {
          shoulderX: frontRightShoulderX,
          shoulderY: frontShoulderY,
          jointX: x + 23,
          jointY: y - 20 + tap,
          wristX: x + 24,
          wristY: y - 18 + tap,
          clawX: x + 25,
          clawY: y - 16 + tap,
          direction: 1,
          open: true,
        },
      ];
    }

    if (avatar.behavior === "admire") {
      return defaultFrontClaws().map((pose) => ({
        ...pose,
        jointY: (pose.jointY ?? y - 27) + bob,
        clawY: pose.clawY + bob,
        open: true,
      }));
    }

    return defaultFrontClaws();
  };

  const drawCrayfishFace = () => {
    if (facing === "back") return;

    if (completeYawn) {
      const yawnOpen = frame % 36 < 24;
      const faceY = y - 6;
      if (facing === "left" || facing === "right") {
        const eyeX = x + sideDirection * 8;
        const mouthX = x + sideDirection * 8;
        drawPixelRect(ctx, eyeX - 4, faceY - 20, 8, 2, ink);
        drawPixelRect(ctx, mouthX - 2, faceY - 14, 6, yawnOpen ? 7 : 4, ink);
        drawPixelRect(ctx, mouthX - 1, faceY - 13, 4, yawnOpen ? 5 : 2, "#51415f");
        drawPixelRect(ctx, mouthX, faceY - 13, 2, 2, "#f8f0c9");
      } else {
        drawPixelRect(ctx, x - 8, faceY - 20, 5, 2, ink);
        drawPixelRect(ctx, x + 5, faceY - 20, 5, 2, ink);
        drawPixelRect(ctx, x - 5, faceY - 14, 12, yawnOpen ? 8 : 5, ink);
        drawPixelRect(ctx, x - 3, faceY - 13, 8, yawnOpen ? 6 : 3, "#51415f");
        drawPixelRect(ctx, x - 1, faceY - 13, 4, 2, "#f8f0c9");
      }
      drawPixelRect(ctx, x + 17, faceY - 28, 3, 3, "#f8f0c9");
      drawPixelRect(ctx, x + 22, faceY - 32, 2, 2, "#f8f0c9");
      return;
    }

    const faceY = y - 6;

    if (facing === "left" || facing === "right") {
      if (sleepy) {
        drawPixelRect(ctx, x + sideDirection * 5, faceY - 20, 8, 2, ink);
      } else {
        const eyeX = x + sideDirection * 8;
        drawPixelRect(ctx, eyeX - 2, faceY - 23, 6, focused ? 5 : 6, ink);
        drawPixelRect(ctx, eyeX, faceY - 22, 2, 2, "#fff7ed");
      }
      if (worried) {
        drawPixelRect(ctx, x - sideDirection * 12, faceY - 26, 3, 6, "#9ee6ff");
      }
    } else {
      if (sleepy) {
        drawPixelRect(ctx, x - 8, faceY - 20, 6, 2, ink);
        drawPixelRect(ctx, x + 5, faceY - 20, 6, 2, ink);
      } else {
        drawPixelRect(ctx, x - 8, faceY - 23, 5, focused ? 5 : 6, ink);
        drawPixelRect(ctx, x + 6, faceY - 23, 5, focused ? 5 : 6, ink);
        drawPixelRect(ctx, x - 6, faceY - 22, 2, 2, "#fff7ed");
        drawPixelRect(ctx, x + 8, faceY - 22, 2, 2, "#fff7ed");
      }
      if (worried) {
        drawPixelRect(ctx, x + 17, faceY - 27, 3, 6, "#9ee6ff");
      }
    }

    const mouthX = facing === "left" || facing === "right" ? x + sideDirection * 7 : x - 3;
    drawPixelRect(ctx, mouthX, faceY - 13, happy ? 8 : 6, 2, ink);
    if (happy) {
      drawPixelRect(ctx, mouthX + 1, faceY - 11, 4, 2, "#fff7ed");
    }
  };

  const drawCrayfishTypingPose = () => {
    const tap = Math.round(Math.sin(frame / 3) * 2);
    const frontLike = facing === "front" || facing === "back";
    const deviceX = frontLike ? x - 16 : facing === "left" ? x - 33 : x + 17;
    const deviceY = frontLike ? y - 2 : y - 8;

    drawPixelRect(ctx, deviceX, deviceY, frontLike ? 33 : 14, 8, "#101827");
    drawPixelRect(ctx, deviceX + 2, deviceY + 2, frontLike ? 29 : 10, 3, glow);
    drawPixelRect(ctx, deviceX + 4, deviceY + 5, 5, 2, "#d8fff7");
    drawPixelRect(ctx, deviceX + 13, deviceY + 5, 5, 2, "#9ee6ff");
    drawPixelRect(ctx, deviceX + 22, deviceY + 5, 5, 2, "#f8f0c9");

    if (frontLike) {
      drawCrayfishEfficiencyControl(x + 20, y - 13);
      drawHeldClawGrip(x - 8, y - 8 + tap, -1);
      drawHeldClawGrip(x + 8, y - 8 - tap, 1);
      return;
    }

    const side = facing === "left" ? -1 : 1;
    drawCrayfishEfficiencyControl(
      x + side * 28 - (side < 0 ? 13 : 0),
      y - 18,
    );
    drawHeldClawGrip(x + side * 27, y - 10 + tap, side);
    drawPixelRect(ctx, x - side * 15, y - 2 - tap, 9, 5, shellShade);
  };

  const drawCrayfishInteractionPose = () => {
    if (avatar.behavior === "coding" || avatar.behavior === "thinking") {
      drawCrayfishTypingPose();
      return;
    }
    if (facing === "back") return;

    const {
      front,
      side,
      mouthLeftX,
      mouthCenterX,
      mouthY,
      bob,
      tap,
      drinkX,
      drinkTopY,
      trayX,
      trayY,
      cookieX,
      cookieY,
      phoneX,
      phoneY,
    } = crayfishActionLayout();
    const steamRise = Math.round(Math.sin(frame / 10) * 2);
    const biteY = mouthY + 2 + bob;

    if (avatar.behavior === "workout") {
      const lift = Math.round((Math.sin(frame / 18) + 1) * 7);
      if (front) {
        drawDumbbell(x - 27, y - 18 - lift);
        drawDumbbell(x + 27, y - 18 - Math.round(lift * 0.75));
      } else {
        drawDumbbell(x + side * 25, y - 16 - lift);
        drawDumbbell(x + side * 8, y - 2 + Math.round(lift / 6));
      }
      drawPixelRect(ctx, mouthLeftX, mouthY + 1, 7, 1, ink);
      return;
    }

    if (avatar.behavior === "coffee") {
      drawPixelRect(ctx, drinkX - 7, drinkTopY, 14, 11, ink);
      drawPixelRect(ctx, drinkX - 6, drinkTopY - 1, 12, 11, "#f4ead2");
      drawPixelRect(ctx, drinkX - 4, drinkTopY + 1, 8, 2, "#6f3a20");
      drawPixelRect(ctx, drinkX + side * 5, drinkTopY + 3, 3, 5, "#f4ead2");
      drawPixelRect(ctx, drinkX - 4, drinkTopY + 5, 8, 1, "#d7b98d");
      drawPixelRect(ctx, drinkX - 3, drinkTopY - 7 - steamRise, 2, 4, "#d8f7ff");
      drawPixelRect(ctx, drinkX + 3, drinkTopY - 10 + steamRise, 2, 5, "#d8f7ff");
      drawPixelRect(ctx, mouthLeftX, mouthY, 7, 1, ink);
      return;
    }

    if (avatar.behavior === "cola") {
      const canRed = "#d9364a";
      const canDark = "#8f1f36";
      const canLight = "#ff8fa3";
      drawPixelRect(ctx, drinkX - 5, drinkTopY - 1, 10, 15, ink);
      drawPixelRect(ctx, drinkX - 4, drinkTopY - 2, 8, 15, canRed);
      drawPixelRect(ctx, drinkX - 3, drinkTopY, 2, 11, canLight);
      drawPixelRect(ctx, drinkX + 2, drinkTopY, 2, 11, canDark);
      drawPixelRect(ctx, drinkX - 3, drinkTopY + 4, 6, 1, "#f4ead2");
      drawPixelRect(ctx, drinkX - 2, drinkTopY - 3, 5, 1, "#f4ead2");
      drawPixelRect(ctx, drinkX + side, mouthY + 1, 1, drinkTopY - mouthY, "#f4ead2");
      drawPixelRect(ctx, mouthLeftX, mouthY, 8, 1, "#f4ead2");
      return;
    }

    if (avatar.behavior === "bento") {
      drawPixelRect(ctx, trayX - 2, trayY - 3, 28, 13, ink);
      drawPixelRect(ctx, trayX - 1, trayY - 4, 26, 12, "#f4ead2");
      drawPixelRect(ctx, trayX + 1, trayY - 2, 8, 5, "#fff8df");
      drawPixelRect(ctx, trayX + 10, trayY - 2, 7, 5, "#ff8fa3");
      drawPixelRect(ctx, trayX + 18, trayY - 1, 5, 4, "#8df7c4");
      drawPixelRect(ctx, trayX + 1, trayY + 5, 22, 1, "#d7b98d");
      drawPixelRect(ctx, mouthCenterX - 2, biteY, 5, 2, "#fff8df");
      drawPixelRect(ctx, mouthCenterX + 2, biteY + 1, 3, 1, "#ff8fa3");
      return;
    }

    if (avatar.behavior === "cookie") {
      const crumb = Math.round(Math.sin(frame / 5));
      drawPixelRect(ctx, cookieX - 4, cookieY - 4, 9, 8, ink);
      drawPixelRect(ctx, cookieX - 3, cookieY - 5, 8, 7, "#c48650");
      drawPixelRect(ctx, cookieX - 2, cookieY - 4, 3, 1, "#f0c276");
      drawPixelRect(ctx, cookieX + 1, cookieY - 2, 1, 1, "#5b2a10");
      drawPixelRect(ctx, cookieX + 3, cookieY + 1, 1, 1, "#5b2a10");
      drawPixelRect(ctx, mouthCenterX - 2, biteY, 4, 2, "#c48650");
      drawPixelRect(ctx, cookieX + side * 9, cookieY - 7 + crumb, 2, 2, "#f0c276");
      return;
    }

    if (avatar.behavior === "phone") {
      drawPixelRect(ctx, phoneX - 8, phoneY - 2, 17, 22, ink);
      drawPixelRect(ctx, phoneX - 7, phoneY - 3, 15, 22, "#101827");
      drawPixelRect(ctx, phoneX - 6, phoneY - 1, 13, 19, "#334155");
      drawPixelRect(ctx, phoneX - 5, phoneY, 11, 17, "#475569");
      drawPixelRect(ctx, phoneX - 4, phoneY + 1, 4, 4, "#0f172a");
      drawPixelRect(ctx, phoneX - 3, phoneY + 2, 2, 2, "#94a3b8");
      drawPixelRect(ctx, phoneX + 2, phoneY + 1, 2, 2, "#94a3b8");
      drawPixelRect(ctx, phoneX - 2, phoneY + 15, 5, 1, "#1e293b");
      if (front) {
        drawPixelRect(ctx, phoneX - 5, phoneY - 2, 11, 1, glow);
      } else {
        drawPixelRect(ctx, phoneX - side * 8, phoneY, 1, 16, glow);
      }
      if (frame % 44 < 22) {
        drawPixelRect(ctx, phoneX - 1, phoneY + 7, 3, 1, "#cbd5e1");
        drawPixelRect(ctx, phoneX + side * 7, phoneY + 7 - tap, 2, 2, "#f8f0c9");
      }
      return;
    }

    if (
      avatar.behavior === "fetch_task_file" ||
      avatar.behavior === "carry_task_file" ||
      avatar.behavior === "read_task_file"
    ) {
      const isReading = avatar.behavior === "read_task_file";
      const fileX = front || isReading ? x - 13 : x + side * 12 - 7;
      const fileY = isReading ? y - 22 + bob : y - 16 + bob;
      if (isReading) {
        drawPixelRect(ctx, fileX - 2, fileY - 1, 30, 18, "#27313d");
        drawTaskFileSheet(ctx, fileX, fileY, 12, 15, "#9ee6ff");
        drawTaskFileSheet(ctx, fileX + 14, fileY, 12, 15, "#b4f56c");
        drawTwoClawHold(fileX - 2, fileX + 27, fileY + 8);
        return;
      }
      drawTaskFileSheet(ctx, fileX, fileY, 13, 16, "#ffe66d");
      drawHeldClawGrip(fileX + (front ? 14 : 7), fileY + 6, side);
      return;
    }

    if (avatar.behavior === "admire") {
      const pulse = Math.round(Math.sin(frame / 5) * 2);
      const gazeX = front ? x + 26 : x + side * 28;
      const gazeY = y - 29;
      drawHeldClawGrip(gazeX - side * 2, gazeY + 13 + pulse, side);
      drawPixelRect(ctx, gazeX - 1, gazeY - 1, 3, 3, glow);
      drawPixelRect(ctx, gazeX, gazeY - 5, 1, 2, "#fff7d8");
      drawPixelRect(ctx, gazeX, gazeY + 4, 1, 2, "#fff7d8");
      drawPixelRect(ctx, gazeX - 5, gazeY, 2, 1, "#fff7d8");
      drawPixelRect(ctx, gazeX + 4, gazeY, 2, 1, "#fff7d8");
      return;
    }

    if (avatar.behavior === "paint") {
      const brushLift = Math.round(Math.sin(frame / 4) * 2);
      const paletteX = front ? x - 19 : x - side * 21;
      const paletteY = y - 8 + bob;
      const brushX = front ? x + 23 : x + side * 24;
      const brushY = y - 18 + brushLift;
      drawPixelRect(ctx, paletteX - 8, paletteY - 5, 16, 11, ink);
      drawPixelRect(ctx, paletteX - 7, paletteY - 6, 15, 10, "#f4ead2");
      drawPixelRect(ctx, paletteX - 6, paletteY - 2, 3, 3, "#ff5c7a");
      drawPixelRect(ctx, paletteX + 2, paletteY - 4, 3, 3, "#5ce1e6");
      drawPixelRect(ctx, paletteX + 4, paletteY, 3, 3, "#ffe66d");
      drawHeldClawGrip(paletteX, paletteY, front ? -1 : -side);
      ctx.strokeStyle = "#5b2a10";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(brushX - side * 8, brushY + 8);
      ctx.lineTo(brushX + side * 7, brushY - 9);
      ctx.stroke();
      drawPixelRect(ctx, brushX + side * 7 - 2, brushY - 10, 5, 4, "#d95d75");
      drawHeldClawGrip(brushX - side * 5, brushY + 1, front ? 1 : side);
    }
  };

  drawPixelRect(ctx, x - 18, y + 10, 37, 7, "#15111d");

  if (facing === "back") {
    drawCrayfishInteractionPose();
    drawCrayfishClaws(getCrayfishClawPoses());
    drawPixelRect(ctx, x - 12, y - 35, 25, 6, shellDark);
    drawPixelRect(ctx, x - 17, y - 32, 35, 8, shellDark);
    drawPixelRect(ctx, x - 19, y - 26, 39, 9, shellDark);
    drawPixelRect(ctx, x - 15, y - 19, 31, 9, shellDark);
    drawPixelRect(ctx, x - 11, y - 11, 23, 5, shellDark);
    drawPixelRect(ctx, x - 10, y - 6, 21, 5, shellDark);
    drawPixelRect(ctx, x - 9, y - 1, 19, 3, shellDark);
    drawPixelRect(ctx, x - 10, y - 35, 21, 7, shellMid);
    drawPixelRect(ctx, x - 15, y - 32, 31, 9, shell);
    drawPixelRect(ctx, x - 17, y - 26, 35, 10, shell);
    drawPixelRect(ctx, x - 13, y - 18, 27, 10, shell);
    drawPixelRect(ctx, x - 9, y - 11, 19, 5, shell);
    drawPixelRect(ctx, x - 8, y - 6, 17, 5, shell);
    drawPixelRect(ctx, x - 7, y - 1, 15, 3, shell);
    drawPixelRect(ctx, x - 14, y - 24, 29, 3, shellShade);
    drawPixelRect(ctx, x - 10, y - 14, 21, 3, shellShade);
    drawPixelRect(ctx, x - 7, y - 7, 15, 4, shellShade);
    drawPixelRect(ctx, x - 8, y - 3, 17, 8, shellDark);
    drawPixelRect(ctx, x - 6, y - 3, 13, 7, shellShade);
    drawPixelRect(ctx, x - 3, y, 7, 4, shellMid);
    drawPixelRect(ctx, x - 6, y - 32, 12, 2, shellLight);
    drawPixelRect(ctx, x - 17, y - 28 + antennaWave, 3, 12, shellDark);
    drawPixelRect(ctx, x + 15, y - 28 - antennaWave, 3, 12, shellDark);
    drawPixelRect(ctx, x - 20, y - 35 + antennaWave, 8, 2, shellMid);
    drawPixelRect(ctx, x + 13, y - 35 - antennaWave, 8, 2, shellMid);
    drawTailFan(x, y + 1);
    drawLittleFeet(y + 1);
  } else if (facing === "left" || facing === "right") {
    drawPixelRect(ctx, x - 11, y - 34, 25, 6, shellDark);
    drawPixelRect(ctx, x - 17, y - 30, 36, 8, shellDark);
    drawPixelRect(ctx, x - 18, y - 25, 36, 8, shellDark);
    drawPixelRect(ctx, x - 16, y - 20, 31, 11, shellDark);
    drawPixelRect(ctx, x - 12, y - 10, 23, 4, shellDark);
    drawPixelRect(ctx, x - 11, y - 6, 21, 4, shellDark);
    drawPixelRect(ctx, x - 10, y - 2, 19, 1, shellDark);
    drawPixelRect(ctx, x - 9, y - 34, 21, 7, shellMid);
    drawPixelRect(ctx, x - 15, y - 30, 32, 9, shell);
    drawPixelRect(ctx, x - 16, y - 25, 32, 9, shell);
    drawPixelRect(ctx, x - 14, y - 19, 27, 10, shell);
    drawPixelRect(ctx, x - 10, y - 11, 19, 4, shell);
    drawPixelRect(ctx, x - 9, y - 7, 17, 4, shell);
    drawPixelRect(ctx, x - 8, y - 3, 15, 2, shell);
    drawPixelRect(ctx, x - 8, y - 9, 17, 3, shellShade);
    drawPixelRect(ctx, x - sideDirection * 5, y - 13, 15, 7, shellMid);
    drawPixelRect(ctx, x - sideDirection * 2, y - 6, 8, 1, shellShade);
    drawPixelRect(ctx, x - sideDirection * 1, y - 3, 5, 1, shellShade);
    drawPixelRect(ctx, x - 7, y - 26, 11, 2, shellLight);
    drawPixelRect(ctx, x + sideDirection * 8, y - 37 + antennaWave, 2, 12, shellDark);
    drawPixelRect(ctx, x + sideDirection * 13, y - 38 - antennaWave, 2, 12, shellDark);
    drawPixelRect(ctx, x + sideDirection * 8, y - 39 + antennaWave, 8, 2, shellMid);
    drawPixelRect(ctx, x - sideDirection * 16, y - 4 + wiggle, 8, 6, shellShade);
    drawTailFan(x - sideDirection * 9, y);
    drawLittleFeet(y - 1, true);
    drawCrayfishFace();
    drawCrayfishInteractionPose();
    drawCrayfishClaws(getCrayfishClawPoses());
  } else {
    drawPixelRect(ctx, x - 12, y - 35, 26, 6, shellDark);
    drawPixelRect(ctx, x - 17, y - 31, 36, 8, shellDark);
    drawPixelRect(ctx, x - 19, y - 25, 40, 9, shellDark);
    drawPixelRect(ctx, x - 16, y - 18, 32, 9, shellDark);
    drawPixelRect(ctx, x - 12, y - 10, 24, 5, shellDark);
    drawPixelRect(ctx, x - 11, y - 5, 22, 5, shellDark);
    drawPixelRect(ctx, x - 10, y, 20, 3, shellDark);
    drawPixelRect(ctx, x - 10, y - 35, 22, 7, shellMid);
    drawPixelRect(ctx, x - 15, y - 31, 32, 9, shell);
    drawPixelRect(ctx, x - 17, y - 25, 36, 10, shell);
    drawPixelRect(ctx, x - 14, y - 18, 28, 10, shell);
    drawPixelRect(ctx, x - 10, y - 11, 20, 5, shell);
    drawPixelRect(ctx, x - 9, y - 6, 18, 5, shell);
    drawPixelRect(ctx, x - 8, y - 1, 16, 4, shell);
    drawPixelRect(ctx, x - 9, y - 10, 19, 3, shellShade);
    drawPixelRect(ctx, x - 7, y - 4, 14, 5, shellShade);
    drawPixelRect(ctx, x - 14, y - 13, 12, 7, shellMid);
    drawPixelRect(ctx, x + 2, y - 13, 12, 7, shellMid);
    drawPixelRect(ctx, x - 12, y - 7, 10, 1, shellShade);
    drawPixelRect(ctx, x + 2, y - 7, 10, 1, shellShade);
    drawPixelRect(ctx, x - 1, y - 13, 1, 7, shellShade);
    drawPixelRect(ctx, x + 1, y - 13, 1, 7, shellShade);
    drawPixelRect(ctx, x - 6, y - 6, 5, 1, shellMid);
    drawPixelRect(ctx, x + 2, y - 6, 5, 1, shellMid);
    drawPixelRect(ctx, x - 5, y - 4, 4, 1, shellMid);
    drawPixelRect(ctx, x + 2, y - 4, 4, 1, shellMid);
    drawPixelRect(ctx, x - 4, y - 2, 3, 1, shellMid);
    drawPixelRect(ctx, x + 2, y - 2, 3, 1, shellMid);
    drawPixelRect(ctx, x, y - 6, 1, 5, shellShade);
    drawPixelRect(ctx, x - 6, y - 31, 12, 2, shellLight);
    drawPixelRect(ctx, x - 14, y - 38 + antennaWave, 2, 13, shellDark);
    drawPixelRect(ctx, x + 14, y - 38 - antennaWave, 2, 13, shellDark);
    drawPixelRect(ctx, x - 19, y - 40 + antennaWave, 8, 2, shellMid);
    drawPixelRect(ctx, x + 11, y - 40 - antennaWave, 8, 2, shellMid);
    drawPixelRect(ctx, x - 8, y, 16, 7, shellDark);
    drawPixelRect(ctx, x - 6, y - 1, 12, 7, shellShade);
    drawPixelRect(ctx, x - 4, y, 8, 4, shellMid);
    drawTailFan(x, y + 4);
    drawLittleFeet(y + 3);
    drawCrayfishFace();
    drawCrayfishInteractionPose();
    drawCrayfishClaws(getCrayfishClawPoses());
  }

  drawTraitStatusMotif(ctx, dominantTrait, avatar, x, y, frame, theme);
  if (dominantTrait !== "efficiency") {
    drawTraitMicroExpression(ctx, dominantTrait, avatar, x, y, frame, theme);
  }
};

interface SlimePalette {
  outline: string;
  body: string;
  light: string;
  shade: string;
  accent: string;
  ink: string;
}

const slimeMoodBandForMood = (mood: number): MoodBand => {
  if (mood >= 75) return "high";
  if (mood >= 45) return "normal";
  if (mood >= 20) return "low";
  return "depleted";
};

const slimePaletteForMood = (mood: number): SlimePalette => {
  if (mood >= 75) {
    return {
      outline: "#831843",
      body: "#f472b6",
      light: "#fbcfe8",
      shade: "#db2777",
      accent: "#fef3c7",
      ink: "#500724",
    };
  }
  if (mood >= 45) {
    return {
      outline: "#14532d",
      body: "#4ade80",
      light: "#bbf7d0",
      shade: "#16a34a",
      accent: "#fef08a",
      ink: "#052e16",
    };
  }
  if (mood >= 20) {
    return {
      outline: "#0f172a",
      body: "#1d4ed8",
      light: "#93c5fd",
      shade: "#1e3a8a",
      accent: "#bfdbfe",
      ink: "#dbeafe",
    };
  }
  return {
    outline: "#1f1b2e",
    body: "#8b7aa8",
    light: "#d8c7f0",
    shade: "#5f5275",
    accent: "#c4b5fd",
    ink: "#181422",
  };
};

const drawSlimeSoftPseudopod = (
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  tipX: number,
  tipY: number,
  width: number,
  body: string,
  bodyLight: string,
  outline: string,
) => {
  const deltaX = tipX - baseX;
  const deltaY = tipY - baseY;
  const length = Math.max(1, Math.hypot(deltaX, deltaY));
  const normalX = -deltaY / length;
  const normalY = deltaX / length;
  const forwardX = deltaX / length;
  const forwardY = deltaY / length;
  const midX = (baseX + tipX) / 2;
  const midY = (baseY + tipY) / 2;

  const drawPodPath = (baseWidth: number, tipWidth: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(baseX + normalX * baseWidth, baseY + normalY * baseWidth);
    ctx.quadraticCurveTo(
      midX + normalX * (baseWidth + 1),
      midY + normalY * (baseWidth + 1),
      tipX + normalX * tipWidth,
      tipY + normalY * tipWidth,
    );
    ctx.quadraticCurveTo(
      tipX + forwardX * 3,
      tipY + forwardY * 3,
      tipX - normalX * tipWidth,
      tipY - normalY * tipWidth,
    );
    ctx.quadraticCurveTo(
      midX - normalX * (baseWidth + 1),
      midY - normalY * (baseWidth + 1),
      baseX - normalX * baseWidth,
      baseY - normalY * baseWidth,
    );
    ctx.quadraticCurveTo(
      baseX - forwardX * 3,
      baseY - forwardY * 3,
      baseX + normalX * baseWidth,
      baseY + normalY * baseWidth,
    );
    ctx.closePath();
    ctx.fill();
  };

  drawPodPath(width + 1, Math.max(2, width - 2), outline);
  drawPodPath(width, Math.max(2, width - 3), body);
  drawPixelRect(ctx, baseX - 2 + normalX * 2, baseY - 1 + normalY * 2, 4, 1, bodyLight);
};

const drawMoodSlimePseudopods = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  frame: number,
  x: number,
  y: number,
  body: string,
  bodyLight: string,
  outline: string,
) => {
  if (avatar.facing === "back") return;

  const reach = Math.round(Math.sin(frame / 11) * 2);
  const isFront = avatar.facing === "front";
  const sideDirection = avatar.facing === "left" ? -1 : 1;

  if (isFront) {
    drawSlimeSoftPseudopod(
      ctx,
      x - 16,
      y - 8,
      x - 24,
      y - 7 + reach,
      6,
      body,
      bodyLight,
      outline,
    );
    drawSlimeSoftPseudopod(
      ctx,
      x + 16,
      y - 8,
      x + 24,
      y - 7 - reach,
      6,
      body,
      bodyLight,
      outline,
    );
    return;
  }

  drawSlimeSoftPseudopod(
    ctx,
    x + sideDirection * 15,
    y - 9,
    x + sideDirection * 26,
    y - 10 + reach,
    6,
    body,
    bodyLight,
    outline,
  );
  drawSlimeSoftPseudopod(
    ctx,
    x - sideDirection * 16,
    y - 3,
    x - sideDirection * 21,
    y - 2 - reach,
    5,
    body,
    bodyLight,
    outline,
  );
};

const drawSlimeMoodDetails = (
  ctx: CanvasRenderingContext2D,
  moodBand: MoodBand,
  frame: number,
  x: number,
  y: number,
  squish: number,
  palette: SlimePalette,
  facing: AvatarRuntime["facing"],
) => {
  const pulse = Math.round(Math.sin(frame / 28));
  const frontOrSide = facing !== "back";

  if (moodBand === "high") {
    drawPixelRect(ctx, x + 12, y - 27 + squish + pulse, 2, 2, palette.accent);
    drawPixelRect(ctx, x + 15, y - 24 + squish + pulse, 2, 2, palette.accent);
    drawPixelRect(ctx, x - 16, y - 16 + squish, 2, 2, "#fff7ed");
    return;
  }

  if (moodBand === "normal") {
    drawPixelRect(ctx, x + 13, y - 23 + squish, 4, 2, palette.light);
    drawPixelRect(ctx, x - 17, y - 10, 4, 2, palette.shade);
    drawPixelRect(ctx, x + 15, y - 8, 3, 2, palette.shade);
    return;
  }

  if (moodBand === "low") {
    drawPixelRect(ctx, x - 16, y - 15 + squish, 7, 2, palette.shade);
    drawPixelRect(ctx, x + 10, y - 13 + squish, 6, 2, palette.shade);
    if (frontOrSide) {
      drawPixelRect(ctx, x + 15, y - 25 + squish + pulse, 2, 5, "#93c5fd");
    }
    return;
  }

  drawPixelRect(ctx, x - 16, y - 22 + squish, 6, 3, palette.shade);
  drawPixelRect(ctx, x + 11, y - 17 + squish, 6, 2, palette.shade);
  drawPixelRect(ctx, x - 13, y - 8, 5, 2, palette.shade);
  if (frontOrSide) {
    drawPixelRect(ctx, x + 14, y - 25 + squish, 3, 6, palette.light);
  }
};

const drawMoodSlimeAvatar = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  frame: number,
  x: number,
  y: number,
  stats: PetStats,
  theme: (typeof traitVisualThemes)[DominantTrait],
  dominantTrait: DominantTrait,
) => {
  const facing = avatar.facing;
  const sideDirection = facing === "left" ? -1 : 1;
  const palette = slimePaletteForMood(stats.mood);
  const moodBand = slimeMoodBandForMood(stats.mood);
  const focused = avatar.expression === "focused";
  const worried = avatar.expression === "worried";
  const sleepy = avatar.expression === "sleepy";
  const happy = avatar.expression === "happy";
  const completeYawn = avatar.behavior === "success";
  const isMoving =
    Math.abs(avatar.targetX - avatar.x) > 1 || Math.abs(avatar.targetY - avatar.y) > 1;
  const traveling = isMoving || avatar.behavior === "wander";
  const crawlPhase = Math.sin(frame / (traveling ? 16 : 30));
  const crawlPressure = traveling ? Math.abs(crawlPhase) : Math.max(0, crawlPhase) * 0.45;
  const bottomWave = traveling ? Math.round(Math.sin(frame / 16 + Math.PI / 3) * 2) : 0;
  const squish =
    Math.round(Math.sin(frame / 30) * 1) + Math.round(crawlPressure * 3);
  const body = palette.body;
  const bodyLight = palette.light;
  const ink = palette.ink;
  const needsPseudopods =
    avatar.behavior === "interact" ||
    avatar.behavior === "brew" ||
    avatar.behavior === "play" ||
    avatar.behavior === "music";

  const groundY = y + 12;
  const leftFoot = x - 22 - Math.round(crawlPressure * 2);
  const rightFoot = x + 23 + Math.round(crawlPressure * 2);

  const drawBlobPath = (inset: number, fill: string) => {
    const topY = y - 33 + squish + inset;
    const bottomY = groundY - inset;
    const pressureY = Math.round(crawlPressure * 2);
    const topLeftX = x - 8 + inset;
    const topRightX = x + 8 - inset;
    const topBlendY = topY + 2;

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(topLeftX, topBlendY);
    ctx.bezierCurveTo(
      x - 2 + inset,
      topY,
      x + 2 - inset,
      topY,
      topRightX,
      topBlendY,
    );
    ctx.bezierCurveTo(
      x + 19 - inset,
      topY + 5,
      x + 27 - inset,
      y - 17 + squish + pressureY,
      x + 26 - inset,
      y - 4 + pressureY,
    );
    ctx.bezierCurveTo(
      x + 26 - inset,
      y + 5 + pressureY,
      x + 25 - inset,
      bottomY,
      rightFoot - inset,
      bottomY - 2,
    );
    ctx.quadraticCurveTo(
      x + 14,
      bottomY + 3 - inset - bottomWave,
      x + 4,
      bottomY + 1 - inset,
    );
    ctx.quadraticCurveTo(
      x - 4,
      bottomY + 4 - inset + bottomWave,
      leftFoot + inset,
      bottomY - 2,
    );
    ctx.bezierCurveTo(
      x - 25 + inset,
      bottomY,
      x - 26 + inset,
      y + 5 + pressureY,
      x - 26 + inset,
      y - 4 + pressureY,
    );
    ctx.bezierCurveTo(
      x - 27 + inset,
      y - 17 + squish + pressureY,
      x - 19 + inset,
      topY + 5,
      topLeftX,
      topBlendY,
    );
    ctx.closePath();
    ctx.fill();
  };

  drawPixelRect(ctx, x - 22, groundY + 1, 45, 5, "#10121d");
  drawPixelRect(ctx, x - 17, groundY, 13, 3, "rgba(16, 18, 29, 0.72)");
  drawPixelRect(ctx, x - 2, groundY + 1, 14, 3, "rgba(16, 18, 29, 0.72)");
  drawBlobPath(0, palette.outline);
  drawBlobPath(2, body);
  drawPixelRect(ctx, x - 18, y + 5, 12, 3, palette.shade);
  drawPixelRect(ctx, x - 4 + bottomWave, y + 8, 14, 3, palette.shade);
  drawPixelRect(ctx, x + 10, y + 5, 9, 3, palette.shade);
  drawPixelRect(ctx, x - 12, y - 25 + squish, 8, 4, bodyLight);
  drawPixelRect(ctx, x - 7, y - 30 + squish, 12, 3, bodyLight);
  drawSlimeMoodDetails(ctx, moodBand, frame, x, y, squish, palette, facing);

  if (facing === "back") {
    drawPixelRect(ctx, x - 9, y - 23 + squish, 20, 3, palette.light);
    drawPixelRect(ctx, x - 5, y - 17 + squish, 12, 4, palette.accent);
    drawPixelRect(ctx, x - 2, y - 12 + squish, 6, 2, palette.light);
  } else if (facing === "left" || facing === "right") {
    const eyeX = x + sideDirection * 5;
    if (sleepy || completeYawn) {
      drawPixelRect(ctx, eyeX - 4, y - 19 + squish, 8, 2, ink);
    } else {
      drawPixelRect(ctx, eyeX - 3, y - 22 + squish, 7, focused ? 5 : 6, ink);
      drawPixelRect(ctx, eyeX - 1, y - 21 + squish, 2, 2, "#f8fafc");
    }
    if (moodBand === "low" || moodBand === "depleted") {
      drawPixelRect(
        ctx,
        eyeX - 3,
        y - 15 + squish,
        7,
        1,
        moodBand === "low" ? palette.light : palette.shade,
      );
    }
    if (worried) {
      drawPixelRect(ctx, x - sideDirection * 12, y - 25 + squish, 3, 6, "#9ee6ff");
    }
  } else if (sleepy || completeYawn) {
    drawPixelRect(ctx, x - 8, y - 19 + squish, 6, 2, ink);
    drawPixelRect(ctx, x + 4, y - 19 + squish, 6, 2, ink);
  } else {
    drawPixelRect(ctx, x - 8, y - 22 + squish, 5, focused ? 5 : 6, ink);
    drawPixelRect(ctx, x + 5, y - 22 + squish, 5, focused ? 5 : 6, ink);
    drawPixelRect(ctx, x - 6, y - 21 + squish, 2, 2, "#f8fafc");
    drawPixelRect(ctx, x + 7, y - 21 + squish, 2, 2, "#f8fafc");
    if (moodBand === "low" || moodBand === "depleted") {
      const underEye = moodBand === "low" ? palette.light : palette.shade;
      drawPixelRect(ctx, x - 8, y - 15 + squish, 5, 1, underEye);
      drawPixelRect(ctx, x + 5, y - 15 + squish, 5, 1, underEye);
    }
    if (worried) {
      drawPixelRect(ctx, x + 16, y - 26 + squish, 3, 6, "#9ee6ff");
    }
  }

  if (completeYawn) {
    drawCompleteYawnPose(ctx, x, y, frame, facing, body, bodyLight, ink);
  } else if (facing !== "back") {
    const mouthX = facing === "left" || facing === "right" ? x + sideDirection * 3 : x - 4;
    if (moodBand === "depleted") {
      drawPixelRect(ctx, mouthX + 1, y - 11 + squish, 5, 2, ink);
      drawPixelRect(ctx, mouthX, y - 10 + squish, 2, 2, ink);
      drawPixelRect(ctx, mouthX + 6, y - 10 + squish, 2, 2, ink);
    } else if (moodBand === "low") {
      drawPixelRect(ctx, mouthX + 1, y - 12 + squish, 5, 2, ink);
      drawPixelRect(ctx, mouthX + 6, y - 11 + squish, 2, 2, ink);
    } else {
      drawPixelRect(ctx, mouthX, y - 12 + squish, happy ? 9 : 7, 2, ink);
    }
    if (moodBand === "high" && !sleepy) {
      drawPixelRect(ctx, mouthX + 1, y - 10 + squish, 5, 2, "#ecfccb");
    }
  }

  if (needsPseudopods) {
    drawMoodSlimePseudopods(ctx, avatar, frame, x, y, body, bodyLight, palette.outline);
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
    drawPhonePose(ctx, x, y, frame, facing, body, bodyLight, ink, palette.accent);
  }
  if (avatar.behavior === "admire") {
    drawAdmirePose(ctx, x, y, frame, facing, body, bodyLight, ink, palette.accent);
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
    const tap = Math.round(Math.sin(frame / 3) * 2);
    drawPixelRect(ctx, deviceX, y - 8, 13, 9, "#101827");
    drawPixelRect(ctx, deviceX + 2, y - 6, 9, 4, palette.accent);
    if (facing === "front") {
      drawSlimeSoftPseudopod(
        ctx,
        x + 14,
        y - 4,
        x + 21,
        y - 5 - tap,
        5,
        body,
        bodyLight,
        palette.outline,
      );
      drawPixelRect(ctx, x - 17, y + 2 + tap, 7, 3, body);
    } else {
      drawSlimeSoftPseudopod(
        ctx,
        x + sideDirection * 15,
        y - 5,
        x + sideDirection * 23,
        y - 6 - tap,
        5,
        body,
        bodyLight,
        palette.outline,
      );
      drawPixelRect(ctx, x - sideDirection * 17, y + 2 + tap, 6, 3, body);
    }
  }

  drawTraitStatusMotif(ctx, dominantTrait, avatar, x, y, frame, theme);
  drawTraitMicroExpression(ctx, dominantTrait, avatar, x, y, frame, theme);
};

const drawWaveLizardAvatar = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  frame: number,
  x: number,
  y: number,
  wiggle: number,
  theme: (typeof traitVisualThemes)[DominantTrait],
  dominantTrait: DominantTrait,
) => {
  const facing = avatar.facing;
  const sideDirection = facing === "left" ? -1 : 1;
  const isSide = facing === "left" || facing === "right";
  const focused = avatar.expression === "focused";
  const worried = avatar.expression === "worried";
  const sleepy = avatar.expression === "sleepy";
  const happy = avatar.expression === "happy";
  const completeYawn = avatar.behavior === "success";
  const wave = Math.round(Math.sin(frame / 9) * 2);
  const tailWag = Math.round(Math.sin(frame / 14) * 2);
  const step = Math.round(Math.sin(frame / 8));
  const body = avatar.behavior === "error" ? "#34a853" : "#4ade80";
  const bodyMid = "#22c55e";
  const bodyLight = "#bbf7d0";
  const belly = "#b7e99c";
  const bellyShade = "#86c971";
  const bodyShade = "#15803d";
  const bodyDark = "#14532d";
  const ink = "#102116";
  const eyeWhite = "#f8fafc";
  const glow = avatar.behavior === "error" ? "#fee2e2" : theme.screenGlow;
  const needsSharedPose =
    avatar.behavior === "coffee" ||
    avatar.behavior === "cola" ||
    avatar.behavior === "bento" ||
    avatar.behavior === "cookie" ||
    avatar.behavior === "phone" ||
    avatar.behavior === "fetch_task_file" ||
    avatar.behavior === "carry_task_file" ||
    avatar.behavior === "read_task_file" ||
    avatar.behavior === "admire" ||
    avatar.behavior === "paint";
  const isTyping = avatar.behavior === "coding" || avatar.behavior === "thinking";

  const drawLizardHand = (handX: number, handY: number, direction: number) => {
    drawPixelRect(ctx, handX - 2, handY - 2, 5, 5, bodyDark);
    drawPixelRect(ctx, handX - 1, handY - 3, 4, 4, bodyLight);
    drawPixelRect(ctx, handX + direction * 3, handY - 4, 2, 2, bodyLight);
    drawPixelRect(ctx, handX + direction * 4, handY, 2, 2, bodyLight);
    drawPixelRect(ctx, handX - direction * 3, handY, 2, 2, bodyLight);
  };

  const drawLizardArm = (
    shoulderX: number,
    shoulderY: number,
    handX: number,
    handY: number,
    direction: number,
  ) => {
    const elbowX = Math.round((shoulderX + handX) / 2);
    const elbowY = Math.round((shoulderY + handY) / 2) + 2;
    drawPixelRect(ctx, shoulderX - 2, shoulderY - 2, 5, 5, bodyDark);
    drawPixelRect(ctx, shoulderX - 1, shoulderY - 1, 4, 4, bodyMid);
    drawPixelRect(ctx, elbowX - 2, elbowY - 2, 5, 5, body);
    drawPixelRect(ctx, Math.min(shoulderX, elbowX) - 1, Math.min(shoulderY, elbowY), Math.abs(elbowX - shoulderX) + 3, 4, bodyShade);
    drawPixelRect(ctx, Math.min(elbowX, handX) - 1, Math.min(elbowY, handY), Math.abs(handX - elbowX) + 3, 4, bodyMid);
    drawLizardHand(handX, handY, direction);
  };

  const drawLizardSmile = (
    fromX: number,
    fromY: number,
    controlX: number,
    controlY: number,
    toX: number,
    toY: number,
  ) => {
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.quadraticCurveTo(controlX, controlY, toX, toY);
    ctx.stroke();
    ctx.restore();
  };

  const drawRoundedPixelRect = (
    left: number,
    top: number,
    width: number,
    height: number,
    radius: number,
    color: string,
  ) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(Math.round(left), Math.round(top), Math.round(width), Math.round(height), radius);
    ctx.fill();
  };

  const drawPixelEllipse = (
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    color: string,
  ) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(
      Math.round(centerX),
      Math.round(centerY),
      radiusX,
      radiusY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };

  const drawLizardEye = (centerX: number, centerY: number, lookX = 0) => {
    drawPixelEllipse(centerX, centerY, 5.5, 5, ink);
    drawPixelEllipse(centerX, centerY - 1, 4.5, 4.25, eyeWhite);
    drawPixelEllipse(centerX + lookX, centerY, focused ? 2.6 : 2.1, focused ? 2.8 : 2.3, ink);
    drawPixelRect(ctx, centerX + lookX + 1, centerY - 1, 1, 1, "#e0f2fe");
  };

  const drawLizardTail = () => {
    const fillTail = (color: string, buildPath: () => void) => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      buildPath();
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const strokeTailHighlight = (
      startX: number,
      startY: number,
      c1x: number,
      c1y: number,
      c2x: number,
      c2y: number,
      endX: number,
      endY: number,
    ) => {
      ctx.save();
      ctx.strokeStyle = bodyLight;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, endX, endY);
      ctx.stroke();
      ctx.restore();
    };

    if (isSide) {
      const rear = -sideDirection;
      const sx = (offset: number) => x + rear * offset;
      const sideTailPath = (inset = 0) => {
        ctx.moveTo(sx(5 + inset), y - 3 + inset);
        ctx.bezierCurveTo(
          sx(15 + inset),
          y + 5 + tailWag,
          sx(31 - inset),
          y + 2 + tailWag,
          sx(37 - inset),
          y - 7 + tailWag,
        );
        ctx.bezierCurveTo(
          sx(42 - inset),
          y - 15 + tailWag,
          sx(34 - inset),
          y - 22 + tailWag,
          sx(25 - inset),
          y - 19 + tailWag,
        );
        ctx.bezierCurveTo(
          sx(31 - inset),
          y - 15 + tailWag,
          sx(31 - inset),
          y - 10 + tailWag,
          sx(25 + inset),
          y - 5 + tailWag,
        );
        ctx.bezierCurveTo(
          sx(18 + inset),
          y + 1 + tailWag,
          sx(10 + inset),
          y + 2,
          sx(4 + inset),
          y + 4 - inset,
        );
      };

      fillTail(bodyDark, () => sideTailPath(0));
      fillTail(bodyMid, () => sideTailPath(2));
      strokeTailHighlight(
        sx(12),
        y,
        sx(22),
        y + 1 + tailWag,
        sx(33),
        y - 5 + tailWag,
        sx(28),
        y - 14 + tailWag,
      );
      drawPixelRect(ctx, x + rear * 16, y + 1 + tailWag, 2, 2, "#86efac");
      drawPixelRect(ctx, x + rear * 24, y - 1 + tailWag, 2, 2, bodyShade);
      drawPixelRect(ctx, x + rear * 33, y - 8 + tailWag, 2, 2, "#86efac");
      return;
    }

    const frontTailPath = (inset = 0) => {
      ctx.moveTo(x - 7 + inset, y - 3 + inset);
      ctx.bezierCurveTo(
        x - 18 + inset,
        y + 6,
        x - 35 + inset,
        y + 3 + tailWag,
        x - 42 + inset,
        y - 6 + tailWag,
      );
      ctx.bezierCurveTo(
        x - 48 + inset,
        y - 15 + tailWag,
        x - 39 + inset,
        y - 23 + tailWag,
        x - 27,
        y - 20 + tailWag,
      );
      ctx.bezierCurveTo(
        x - 35 - inset,
        y - 16 + tailWag,
        x - 35 - inset,
        y - 10 + tailWag,
        x - 29 - inset,
        y - 5 + tailWag,
      );
      ctx.bezierCurveTo(
        x - 22 - inset,
        y + 1 + tailWag,
        x - 13 - inset,
        y + 2,
        x - 7 - inset,
        y + 5 - inset,
      );
    };

    fillTail(bodyDark, () => frontTailPath(0));
    fillTail(bodyMid, () => frontTailPath(2));
    strokeTailHighlight(
      x - 13,
      y,
      x - 24,
      y + 3 + tailWag,
      x - 38,
      y - 5 + tailWag,
      x - 31,
      y - 15 + tailWag,
    );
    drawPixelRect(ctx, x - 17, y + 1 + tailWag, 2, 2, "#86efac");
    drawPixelRect(ctx, x - 27, y - 1 + tailWag, 2, 2, bodyShade);
    drawPixelRect(ctx, x - 36, y - 7 + tailWag, 2, 2, "#86efac");
    return;
  };

  const drawLizardTailRootBridge = () => {
    if (isSide) {
      const rear = -sideDirection;
      const rootX = x + rear * 6;
      drawRoundedPixelRect(rootX - 6, y - 4, 12, 12, 6, bodyDark);
      drawRoundedPixelRect(rootX - 4, y - 3, 9, 10, 5, bodyMid);
      drawPixelRect(ctx, rootX - rear * 2, y - 1, 4, 6, body);
      return;
    }

    drawRoundedPixelRect(x - 14, y - 5, 13, 12, 7, bodyDark);
    drawRoundedPixelRect(x - 12, y - 4, 10, 10, 6, bodyMid);
    drawPixelRect(ctx, x - 8, y - 2, 6, 6, body);
  };

  const drawLizardLegs = () => {
    if (isSide) {
      drawPixelRect(ctx, x - sideDirection * 4, y - 1 + step, 5, 12, bodyDark);
      drawPixelRect(ctx, x - sideDirection * 3, y, 4, 10, bodyMid);
      drawPixelRect(ctx, x + sideDirection * 7, y + 1 - step, 5, 11, bodyDark);
      drawPixelRect(ctx, x + sideDirection * 8, y + 2 - step, 4, 9, bodyMid);
      drawPixelRect(ctx, x - sideDirection * 6, y + 10 + step, 9, 4, bodyDark);
      drawPixelRect(ctx, x + sideDirection * 6, y + 11 - step, 9, 4, bodyDark);
      return;
    }

    drawPixelRect(ctx, x - 8, y - 1 + step, 5, 12, bodyDark);
    drawPixelRect(ctx, x - 7, y, 4, 10, bodyMid);
    drawPixelRect(ctx, x + 5, y + 1 - step, 5, 11, bodyDark);
    drawPixelRect(ctx, x + 6, y + 2 - step, 4, 9, bodyMid);
    drawPixelRect(ctx, x - 11, y + 10 + step, 9, 4, bodyDark);
    drawPixelRect(ctx, x + 4, y + 11 - step, 9, 4, bodyDark);
    drawPixelRect(ctx, x - 8, y + 10 + step, 3, 2, bodyLight);
    drawPixelRect(ctx, x + 6, y + 11 - step, 3, 2, bodyLight);
  };

  const drawDefaultLizardArms = () => {
    if (facing === "back") {
      drawLizardArm(x - 10, y - 20, x - 20, y - 12 + wave, -1);
      drawLizardArm(x + 10, y - 20, x + 20, y - 12 - wave, 1);
      return;
    }

    const shouldWave =
      avatar.behavior === "idle" ||
      avatar.behavior === "wander" ||
      avatar.behavior === "relax" ||
      avatar.behavior === "explore";

    if (isSide) {
      const raisedY = shouldWave ? y - 28 + wave : y - 15 + wave;
      drawLizardArm(x + sideDirection * 9, y - 21, x + sideDirection * 20, raisedY, sideDirection);
      drawLizardArm(x - sideDirection * 7, y - 16, x - sideDirection * 15, y - 8 - wave, -sideDirection);
      return;
    }

    drawLizardArm(x - 10, y - 20, x - 20, y - 12 + wave, -1);
    drawLizardArm(
      x + 10,
      y - 20,
      shouldWave ? x + 21 : x + 19,
      shouldWave ? y - 30 - wave : y - 12 - wave,
      1,
    );
  };

  const drawLizardFace = () => {
    if (facing === "back") {
      drawPixelRect(ctx, x - 6, y - 33, 14, 2, bodyLight);
      drawPixelRect(ctx, x - 2, y - 29, 6, 2, bodyShade);
      return;
    }

    const mouthY = y - 19;
    if (isSide) {
      const eyeX = x + sideDirection * 7;
      const eyeY = y - 33;
      const snoutX = x + sideDirection * 12;
      if (sleepy || completeYawn) {
        drawLizardSmile(eyeX - 4, eyeY, eyeX, eyeY + 1, eyeX + 4, eyeY);
      } else {
        drawLizardEye(eyeX, eyeY, sideDirection);
      }
      drawPixelRect(ctx, snoutX - 1, y - 22, 2, 2, ink);
      drawPixelRect(ctx, snoutX + sideDirection * 4, y - 22, 2, 2, ink);
      if (!completeYawn) {
        const smileStart = x + sideDirection * 5;
        const smileEnd = x + sideDirection * (happy ? 15 : 13);
        drawLizardSmile(smileStart, mouthY, x + sideDirection * 10, mouthY + 3, smileEnd, mouthY);
        drawPixelRect(ctx, x + sideDirection * 2, mouthY - 2, 4, 2, "#86efac");
      }
      if (completeYawn) {
        drawPixelRect(ctx, x + sideDirection * 9, mouthY - 1, 6, 7, ink);
        drawPixelRect(ctx, x + sideDirection * 10, mouthY, 4, 5, "#51415f");
      }
      if (worried) {
        drawPixelRect(ctx, x - sideDirection * 9, y - 24, 3, 6, "#9ee6ff");
      }
      return;
    }

    const eyeY = y - 33;
    if (sleepy || completeYawn) {
      drawLizardSmile(x - 12, eyeY, x - 8, eyeY + 1, x - 4, eyeY);
      drawLizardSmile(x + 7, eyeY, x + 11, eyeY + 1, x + 15, eyeY);
    } else {
      drawLizardEye(x - 8, eyeY, 0);
      drawLizardEye(x + 9, eyeY, 0);
    }
    drawPixelRect(ctx, x - 3, y - 22, 2, 2, ink);
    drawPixelRect(ctx, x + 5, y - 22, 2, 2, ink);
    if (completeYawn) {
      drawPixelRect(ctx, x - 5, mouthY, 12, 8, ink);
      drawPixelRect(ctx, x - 3, mouthY + 1, 8, 6, "#51415f");
      drawPixelRect(ctx, x - 1, mouthY + 1, 4, 2, "#f8f0c9");
    } else {
      drawLizardSmile(x - 9, mouthY, x, happy ? mouthY + 5 : mouthY + 3, x + 9, mouthY);
      drawPixelRect(ctx, x - 14, mouthY - 2, 4, 2, "#86efac");
      drawPixelRect(ctx, x + 13, mouthY - 2, 4, 2, "#86efac");
      if (happy) {
        drawPixelRect(ctx, x - 2, mouthY + 3, 5, 1, "#ecfccb");
      }
    }
    if (worried) {
      drawPixelRect(ctx, x + 16, y - 24, 3, 6, "#9ee6ff");
    }
  };

  const drawLizardTypingPose = () => {
    const tap = Math.round(Math.sin(frame / 3) * 2);
    const frontLike = facing === "front" || facing === "back";
    const deviceX = frontLike ? x - 16 : facing === "left" ? x - 32 : x + 18;
    const deviceY = frontLike ? y - 2 : y - 8;

    drawPixelRect(ctx, deviceX, deviceY, frontLike ? 33 : 14, 8, "#101827");
    drawPixelRect(ctx, deviceX + 2, deviceY + 2, frontLike ? 29 : 10, 3, glow);
    drawPixelRect(ctx, deviceX + 4, deviceY + 5, 5, 2, "#d8fff7");
    drawPixelRect(ctx, deviceX + 13, deviceY + 5, 5, 2, "#9ee6ff");
    drawPixelRect(ctx, deviceX + 22, deviceY + 5, 5, 2, "#f8f0c9");

    if (frontLike) {
      drawLizardArm(x - 10, y - 19, x - 8, y - 5 + tap, -1);
      drawLizardArm(x + 10, y - 19, x + 8, y - 5 - tap, 1);
      return;
    }

    const side = facing === "left" ? -1 : 1;
    drawLizardArm(x + side * 9, y - 19, x + side * 24, y - 6 + tap, side);
    drawLizardArm(x - side * 8, y - 14, x - side * 15, y - 3 - tap, -side);
  };

  const lizardMouthAnchor = () => {
    const side = facing === "left" ? -1 : 1;
    return {
      front: facing === "front",
      side,
      mouthX: facing === "front" ? x : x + side * 12,
      mouthY: y - 21,
    };
  };

  const drawLizardDrinkPose = (kind: "coffee" | "cola") => {
    if (facing === "back") return;

    const { front, side, mouthX, mouthY } = lizardMouthAnchor();
    const bob = Math.round(Math.sin(frame / 10));
    const propX = front ? x : mouthX + side * 3;
    const propTop = mouthY + 2 + bob;
    const gripY = propTop + 8;

    if (front) {
      drawLizardArm(x - 8, y - 18, x - 6, gripY, -1);
      drawLizardArm(x + 8, y - 18, x + 6, gripY, 1);
    } else {
      drawLizardArm(x + side * 8, y - 18, propX - side * 4, gripY, side);
      drawLizardArm(x - side * 6, y - 13, propX - side * 8, gripY + 2, -side);
    }

    if (kind === "coffee") {
      const steamRise = Math.round(Math.sin(frame / 10) * 2);
      drawPixelRect(ctx, propX - 6, propTop - 1, 12, 10, ink);
      drawPixelRect(ctx, propX - 5, propTop - 2, 10, 10, "#f4ead2");
      drawPixelRect(ctx, propX - 3, propTop, 6, 2, "#6f3a20");
      drawPixelRect(ctx, propX + side * 5 - (front ? 0 : 1), propTop + 2, 3, 5, "#f4ead2");
      drawPixelRect(ctx, mouthX - (front ? 2 : side * 1), mouthY + 1, front ? 5 : 4, 1, "#6f3a20");
      drawPixelRect(ctx, propX - 2, propTop - 8 - steamRise, 2, 4, "#d8f7ff");
      drawPixelRect(ctx, propX + 3, propTop - 11 + steamRise, 2, 5, "#d8f7ff");
      return;
    }

    const fizz = Math.round(Math.sin(frame / 6));
    drawPixelRect(ctx, propX - 5, propTop - 4, 10, 14, ink);
    drawPixelRect(ctx, propX - 4, propTop - 5, 8, 14, "#d9364a");
    drawPixelRect(ctx, propX - 3, propTop - 3, 2, 10, "#ff8fa3");
    drawPixelRect(ctx, propX + 2, propTop - 3, 2, 10, "#8f1f36");
    drawPixelRect(ctx, propX - 3, propTop, 6, 2, "#f4ead2");
    drawPixelRect(ctx, propX - 1, propTop - 9, 2, 10, "#f4ead2");
    drawPixelRect(ctx, mouthX - (front ? 1 : side * 2), mouthY + 1, front ? 5 : 4, 1, "#f4ead2");
    drawPixelRect(ctx, propX + side * 7, propTop - 10 + fizz, 2, 2, "#d8f7ff");
  };

  const drawLizardBentoPose = () => {
    if (facing === "back") return;

    const { front, side, mouthX, mouthY } = lizardMouthAnchor();
    const chew = Math.round(Math.sin(frame / 5));
    const boxX = front ? x : mouthX + side * 2;
    const boxY = y - 11 + chew;

    if (front) {
      drawLizardArm(x - 8, y - 17, x - 11, boxY + 7, -1);
      drawLizardArm(x + 8, y - 17, x + 11, boxY + 7, 1);
    } else {
      drawLizardArm(x + side * 8, y - 17, boxX - side * 7, boxY + 6, side);
      drawLizardArm(x - side * 6, y - 13, boxX - side * 11, boxY + 8, -side);
    }

    drawPixelRect(ctx, boxX - 12, boxY - 5, 24, 13, ink);
    drawPixelRect(ctx, boxX - 11, boxY - 6, 22, 12, "#f4ead2");
    drawPixelRect(ctx, boxX - 9, boxY - 4, 7, 5, "#fff8df");
    drawPixelRect(ctx, boxX - 1, boxY - 4, 6, 5, "#ff8fa3");
    drawPixelRect(ctx, boxX + 6, boxY - 4, 3, 5, "#8df7c4");
    drawPixelRect(ctx, boxX - 9, boxY + 2, 8, 3, "#ffe66d");
    drawPixelRect(ctx, boxX, boxY + 2, 9, 3, "#8df7c4");
    drawPixelRect(ctx, boxX - 11, boxY + 6, 22, 2, "#d7b98d");
    drawPixelRect(ctx, mouthX - (front ? 3 : side * 2), mouthY - 1 + chew, 5, 3, "#fff8df");
    drawPixelRect(ctx, mouthX + (front ? 1 : side * 1), mouthY + chew, 3, 2, "#ff8fa3");
  };

  const drawLizardCookiePose = () => {
    if (facing === "back") return;

    const { front, side, mouthX, mouthY } = lizardMouthAnchor();
    const chew = Math.round(Math.sin(frame / 4));
    const cookieX = front ? x + 1 : mouthX + side * 3;
    const cookieY = mouthY + 5 + chew;

    if (front) {
      drawLizardArm(x - 8, y - 17, x - 4, cookieY + 3, -1);
      drawLizardArm(x + 8, y - 17, x + 5, cookieY + 2, 1);
    } else {
      drawLizardArm(x + side * 8, y - 17, cookieX - side * 3, cookieY + 3, side);
    }

    drawPixelEllipse(cookieX, cookieY, 5, 4, ink);
    drawPixelEllipse(cookieX, cookieY - 1, 4, 3.5, "#c48650");
    drawPixelRect(ctx, cookieX - 2, cookieY - 3, 3, 1, "#f0c276");
    drawPixelRect(ctx, cookieX + 1, cookieY - 2, 1, 1, "#5b2a10");
    drawPixelRect(ctx, cookieX - 2, cookieY, 1, 1, "#5b2a10");
    drawPixelRect(ctx, mouthX - (front ? 2 : side * 1), mouthY + 1 + chew, 4, 2, "#c48650");
  };

  const drawLizardPaintHat = () => {
    if (facing === "back") return;

    const side = facing === "left" ? -1 : 1;
    const hatX = facing === "front" ? x : x + side * 4;
    const hatY = y - 36;
    drawPixelRect(ctx, hatX - 10, hatY + 1, 21, 4, "#111624");
    drawPixelRect(ctx, hatX - 8, hatY - 5, 16, 7, "#4b2f62");
    drawPixelRect(ctx, hatX - 11, hatY + 3, 24, 3, "#6d4385");
    drawPixelRect(ctx, hatX - 2, hatY - 6, 7, 2, "#a074b8");
  };

  const drawLizardPaintPose = () => {
    if (facing === "back") return;

    const bob = Math.round(Math.sin(frame / 5));
    const brushLift = Math.round(Math.sin(frame / 4) * 2);
    const front = facing === "front";
    const side = facing === "left" ? -1 : 1;
    const paletteX = front ? x - 14 : x - side * 14;
    const paletteY = y - 9 + bob;
    const brushX = front ? x + 14 : x + side * 16;
    const brushY = y - 18 + brushLift;

    drawPixelRect(ctx, paletteX - 8, paletteY - 5, 16, 11, ink);
    drawPixelRect(ctx, paletteX - 7, paletteY - 6, 15, 10, "#f4ead2");
    drawPixelRect(ctx, paletteX - 6, paletteY - 2, 3, 3, "#ff5c7a");
    drawPixelRect(ctx, paletteX - 1, paletteY - 3, 3, 3, "#5ce1e6");
    drawPixelRect(ctx, paletteX + 4, paletteY, 3, 3, "#ffe66d");
    drawPixelRect(ctx, paletteX - 3, paletteY + 2, 3, 2, "#62c56f");

    if (front) {
      drawLizardArm(x - 8, y - 18, x - 15, y - 8 + bob, -1);
      drawLizardArm(x + 8, y - 18, x + 17, y - 18 + brushLift, 1);
    } else {
      drawLizardArm(x - side * 6, y - 14, paletteX - side * 5, paletteY + 4, -side);
      drawLizardArm(x + side * 8, y - 18, brushX, brushY, side);
    }

    ctx.strokeStyle = "#5b2a10";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(brushX - side * 6, brushY + 7);
    ctx.lineTo(brushX + side * 6, brushY - 8);
    ctx.stroke();
    drawPixelRect(ctx, brushX + side * 6 - 2, brushY - 9, 5, 4, "#d95d75");
    drawPixelRect(ctx, brushX + side * 5 - 1, brushY - 11, 3, 2, "#ffe66d");
  };

  drawPixelRect(ctx, x - 14, y + 11, 29, 6, "#14151f");
  drawLizardTail();
  drawLizardLegs();

  if (facing === "back") {
    drawRoundedPixelRect(x - 8, y - 29, 17, 7, 6, bodyDark);
    drawRoundedPixelRect(x - 10, y - 25, 21, 26, 8, bodyDark);
    drawRoundedPixelRect(x - 7, y - 30, 13, 7, 5, body);
    drawRoundedPixelRect(x - 8, y - 25, 17, 26, 7, body);
    drawPixelRect(ctx, x - 5, y - 26, 11, 4, bodyLight);
    drawPixelRect(ctx, x - 4, y - 16, 9, 3, bodyShade);
    drawPixelRect(ctx, x - 3, y - 8, 7, 2, bodyShade);
    drawRoundedPixelRect(x - 11, y - 35, 23, 12, 7, bodyDark);
    drawRoundedPixelRect(x - 9, y - 36, 19, 12, 7, body);
    drawPixelRect(ctx, x - 5, y - 34, 12, 3, bodyLight);
  } else if (isSide) {
    const side = sideDirection;
    drawRoundedPixelRect(x - 8, y - 29, 18, 7, 6, bodyDark);
    drawRoundedPixelRect(x - 9, y - 25, 19, 26, 8, bodyDark);
    drawRoundedPixelRect(x - 6, y - 30, 14, 7, 5, body);
    drawRoundedPixelRect(x - 7, y - 25, 15, 26, 7, body);
    drawRoundedPixelRect(x - 4, y - 22, 10, 22, 5, belly);
    drawPixelRect(ctx, x + side * 1, y - 3, 5, 2, bellyShade);
    const headLeft = side > 0 ? x : x - 18;
    drawRoundedPixelRect(headLeft, y - 35, 19, 12, 7, bodyDark);
    drawRoundedPixelRect(side > 0 ? headLeft + 2 : headLeft + 1, y - 36, 16, 11, 7, body);
    drawPixelRect(ctx, x + side * 5, y - 34, 8, 3, bodyLight);
    drawPixelRect(ctx, x + side * 13, y - 28, 4, 3, bodyMid);
  } else {
    drawRoundedPixelRect(x - 7, y - 30, 15, 7, 6, bodyDark);
    drawRoundedPixelRect(x - 10, y - 25, 21, 8, 7, bodyDark);
    drawRoundedPixelRect(x - 10, y - 19, 21, 19, 8, bodyDark);
    drawRoundedPixelRect(x - 7, y, 15, 8, 5, bodyDark);
    drawRoundedPixelRect(x - 5, y - 31, 11, 7, 5, body);
    drawRoundedPixelRect(x - 8, y - 25, 17, 8, 6, body);
    drawRoundedPixelRect(x - 8, y - 19, 17, 19, 7, body);
    drawRoundedPixelRect(x - 6, y, 13, 8, 5, body);
    drawPixelRect(ctx, x - 6, y - 27, 13, 4, bodyLight);
    drawRoundedPixelRect(x - 5, y - 20, 11, 24, 5, belly);
    drawPixelRect(ctx, x - 3, y - 1, 7, 2, bellyShade);
    drawRoundedPixelRect(x - 12, y - 35, 25, 12, 7, bodyDark);
    drawRoundedPixelRect(x - 10, y - 36, 21, 12, 7, body);
    drawPixelRect(ctx, x - 6, y - 35, 12, 3, bodyLight);
  }

  drawLizardTailRootBridge();

  if (avatar.behavior === "paint") {
    drawLizardPaintHat();
  }

  drawLizardFace();

  if (isTyping) {
    drawLizardTypingPose();
  } else if (!needsSharedPose && !completeYawn) {
    drawDefaultLizardArms();
  }

  if (avatar.behavior === "coffee") {
    drawLizardDrinkPose("coffee");
  }
  if (avatar.behavior === "cola") {
    drawLizardDrinkPose("cola");
  }
  if (avatar.behavior === "bento") {
    drawLizardBentoPose();
  }
  if (avatar.behavior === "cookie") {
    drawLizardCookiePose();
  }
  if (avatar.behavior === "phone") {
    drawPhonePose(ctx, x, y, frame, facing, bodyMid, bodyLight, ink, glow);
  }
  if (avatar.behavior === "admire") {
    drawAdmirePose(ctx, x, y, frame, facing, bodyMid, bodyLight, ink, glow);
  }
  if (avatar.behavior === "paint") {
    drawLizardPaintPose();
  }
  if (
    avatar.behavior === "fetch_task_file" ||
    avatar.behavior === "carry_task_file" ||
    avatar.behavior === "read_task_file"
  ) {
    drawTaskFilePose(ctx, x, y, frame, facing, bodyMid, bodyLight, avatar.behavior);
  }

  drawTraitStatusMotif(ctx, dominantTrait, avatar, x, y, frame, theme);
  drawTraitMicroExpression(ctx, dominantTrait, avatar, x, y, frame, theme);
};

const drawCutePenguinAvatar = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  frame: number,
  x: number,
  y: number,
  theme: (typeof traitVisualThemes)[DominantTrait],
  dominantTrait: DominantTrait,
) => {
  const facing = avatar.facing;
  const sideDirection = facing === "left" ? -1 : 1;
  const isSide = facing === "left" || facing === "right";
  const focused = avatar.expression === "focused";
  const worried = avatar.expression === "worried";
  const sleepy = avatar.expression === "sleepy";
  const happy = avatar.expression === "happy";
  const completeYawn = avatar.behavior === "success";
  const horizontalMotion = avatar.targetX - avatar.x;
  const movingHorizontally =
    Math.abs(horizontalMotion) > 1.4 ||
    avatar.behavior === "wander" ||
    avatar.behavior === "explore";
  const step = movingHorizontally ? Math.round(Math.sin(frame / 5) * 2) : 0;
  const waddle = movingHorizontally ? Math.round(Math.sin(frame / 8)) : 0;
  const wingWave = Math.round(Math.sin(frame / 11) * 2);
  const tap = Math.round(Math.sin(frame / 3) * 2);
  const body = avatar.behavior === "error" ? "#20202c" : "#151b24";
  const bodyMid = avatar.behavior === "error" ? "#2f2a3b" : "#242c38";
  const bodyLight = "#3a4351";
  const white = "#fff8ea";
  const whiteShade = "#e7dfce";
  const ink = "#080d14";
  const beak = "#f59e0b";
  const beakLight = "#ffbf3d";
  const blush = "#f7a8b8";
  const foot = "#f59e0b";
  const footLight = "#ffbf3d";
  const footShade = "#b96805";
  const glow = avatar.behavior === "error" ? "#fee2e2" : theme.screenGlow;
  const needsSharedPose =
    avatar.behavior === "coffee" ||
    avatar.behavior === "cola" ||
    avatar.behavior === "bento" ||
    avatar.behavior === "cookie" ||
    avatar.behavior === "phone" ||
    avatar.behavior === "fetch_task_file" ||
    avatar.behavior === "carry_task_file" ||
    avatar.behavior === "read_task_file" ||
    avatar.behavior === "admire" ||
    avatar.behavior === "paint";
  const isTyping = avatar.behavior === "coding" || avatar.behavior === "thinking";

  const drawRoundedPixelRect = (
    left: number,
    top: number,
    width: number,
    height: number,
    radius: number,
    color: string,
  ) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(Math.round(left), Math.round(top), Math.round(width), Math.round(height), radius);
    ctx.fill();
  };

  const drawPixelEllipse = (
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    color: string,
  ) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(Math.round(centerX), Math.round(centerY), radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawFoot = (
    footX: number,
    footY: number,
    width: number,
    height: number,
    direction: number,
  ) => {
    drawPixelRect(ctx, footX - 1, footY + height - 2, width + 2, 2, ink);
    drawPixelRect(ctx, footX, footY + 2, width, Math.max(3, height - 2), footShade);
    drawPixelRect(ctx, footX + 1, footY, Math.max(1, width - 2), Math.max(3, height - 1), foot);
    drawPixelRect(ctx, footX + 2, footY + 1, Math.max(1, width - 4), 2, footLight);
    drawPixelRect(ctx, footX + (direction > 0 ? width - 2 : 0), footY + 4, 3, 3, foot);
  };

  const drawPenguinFeet = () => {
    if (isSide) {
      const frontFootX = x + sideDirection * 2 - (sideDirection < 0 ? 9 : 0);
      const rearFootX = x - sideDirection * 7 - (sideDirection < 0 ? 7 : 0);
      if (movingHorizontally) {
        drawFoot(frontFootX, y + 8 - step, 10, 6, sideDirection);
        drawFoot(rearFootX, y + 9 + step, 8, 5, -sideDirection);
        return;
      }
      drawFoot(frontFootX, y + 6, 12, 8, sideDirection);
      drawFoot(rearFootX, y + 8, 8, 5, -sideDirection);
      return;
    }

    if (movingHorizontally) {
      drawFoot(x - 12 + waddle, y + 8 + step, 11, 6, -1);
      drawFoot(x + 2 + waddle, y + 8 - step, 11, 6, 1);
      return;
    }

    drawFoot(x - 17, y + 3, 13, 10, -1);
    drawFoot(x + 5, y + 3, 13, 10, 1);
  };

  const drawFlipper = (
    shoulderX: number,
    shoulderY: number,
    tipX: number,
    tipY: number,
    direction: number,
    raised = false,
  ) => {
    const outerTopX = Math.round(shoulderX - direction * 3);
    const outerTopY = Math.round(shoulderY - (raised ? 6 : 4));
    const outerBaseX = Math.round(shoulderX - direction * 2);
    const outerBaseY = Math.round(shoulderY + (raised ? 10 : 16));
    const outerTipX = Math.round(tipX);
    const outerTipY = Math.round(tipY + (raised ? -1 : 2));
    const innerTopX = Math.round(shoulderX - direction);
    const innerTopY = Math.round(shoulderY - (raised ? 4 : 2));
    const innerBaseX = Math.round(shoulderX - direction);
    const innerBaseY = Math.round(shoulderY + (raised ? 8 : 13));
    const innerTipX = Math.round(tipX - direction * 3);
    const innerTipY = Math.round(tipY + (raised ? 0 : 2));

    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(outerTopX, outerTopY);
    ctx.lineTo(outerTipX, outerTipY);
    ctx.lineTo(outerBaseX, outerBaseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(innerTopX, innerTopY);
    ctx.lineTo(innerTipX, innerTipY);
    ctx.lineTo(innerBaseX, innerBaseY);
    ctx.closePath();
    ctx.fill();

    drawPixelRect(
      ctx,
      Math.min(innerTopX, innerTipX) + (direction > 0 ? 1 : 0),
      innerTopY + 2,
      Math.max(2, Math.abs(innerTipX - innerTopX) - 1),
      2,
      bodyMid,
    );
    drawPixelRect(ctx, outerTipX - 1, outerTipY - 1, 2, 2, ink);
  };

  const drawSideTail = (side: number) => {
    const rearSide = -side;
    const rootX = x + rearSide * 11 + waddle;
    const rootY = y + 4;
    const drawTailStrip = (
      stripX: number,
      stripY: number,
      width: number,
      height: number,
      color: string,
    ) => {
      drawPixelRect(
        ctx,
        rearSide > 0 ? stripX : stripX - width,
        stripY,
        width,
        height,
        color,
      );
    };

    drawTailStrip(rootX, rootY, 5, 2, ink);
    drawTailStrip(rootX + rearSide * 2, rootY + 2, 6, 2, bodyMid);
    drawTailStrip(rootX + rearSide * 4, rootY + 4, 5, 2, body);
    drawTailStrip(rootX + rearSide * 6, rootY + 6, 3, 1, bodyLight);
    drawTailStrip(rootX + rearSide * 7, rootY + 7, 3, 1, ink);
  };

  const drawBackTail = () => {
    const tailX = x + waddle;

    drawPixelRect(ctx, tailX - 10, y + 1, 21, 3, ink);
    drawPixelRect(ctx, tailX - 8, y + 3, 17, 4, bodyMid);
    drawPixelRect(ctx, tailX - 6, y + 6, 4, 4, ink);
    drawPixelRect(ctx, tailX - 1, y + 6, 3, 5, body);
    drawPixelRect(ctx, tailX + 4, y + 6, 4, 4, ink);
    drawPixelRect(ctx, tailX - 8, y + 8, 2, 3, bodyLight);
    drawPixelRect(ctx, tailX + 8, y + 8, 2, 3, bodyLight);
  };

  const drawDefaultFlippers = () => {
    if (facing === "back") {
      drawFlipper(x - 15, y - 18, x - 22, y - 4 + wingWave, -1);
      drawFlipper(x + 15, y - 18, x + 22, y - 4 - wingWave, 1);
      return;
    }

    if (isSide) {
      const wingSide = -sideDirection;
      drawFlipper(
        x + wingSide * 8,
        y - 16,
        x + wingSide * 18,
        y + 2 + wingWave,
        wingSide,
      );
      return;
    }

    drawFlipper(x - 19, y - 17, x - 27, y - 1 + wingWave, -1);
    drawFlipper(x + 19, y - 17, x + 27, y - 1 - wingWave, 1);
  };

  const mouthAnchor = () => {
    const front = facing === "front";
    const side = facing === "left" ? -1 : 1;
    return {
      front,
      side,
      mouthX: front ? x : x + side * 13,
      mouthY: y - 19,
    };
  };

  const drawPenguinBody = () => {
    drawPixelRect(ctx, x - 18, y + 13, 37, 5, "rgba(8, 13, 20, 0.28)");
    drawPixelRect(ctx, x - 10, y + 14, 21, 3, "rgba(8, 13, 20, 0.22)");
    drawPenguinFeet();

    if (facing === "back") {
      drawRoundedPixelRect(x - 18 + waddle, y - 35, 37, 42, 16, ink);
      drawRoundedPixelRect(x - 16 + waddle, y - 34, 33, 40, 15, body);
      drawRoundedPixelRect(x - 7 + waddle, y - 26, 15, 27, 8, bodyMid);
      drawPixelRect(ctx, x - 5 + waddle, y - 23, 11, 3, bodyLight);
      drawBackTail();
      return;
    }

    if (isSide) {
      const side = sideDirection;
      const sideInset = side * -1;
      const bodyLeft = x - (side > 0 ? 14 : 20) + waddle;
      const faceLeft = (side > 0 ? x + 2 + waddle : x - 21 + waddle) + sideInset;
      const bellyLeft = (side > 0 ? x + waddle : x - 21 + waddle) + sideInset;
      drawSideTail(side);
      drawRoundedPixelRect(bodyLeft, y - 34, 35, 40, 16, ink);
      drawRoundedPixelRect(bodyLeft + 2, y - 33, 31, 38, 15, body);
      drawRoundedPixelRect(bellyLeft, y - 25, 21, 31, 9, white);
      drawRoundedPixelRect(faceLeft, y - 31, 20, 18, 8, white);
      drawPixelRect(
        ctx,
        x + side * 7 + waddle - (side < 0 ? 9 : 0) + sideInset,
        y - 6,
        9,
        2,
        whiteShade,
      );
      return;
    }

    drawRoundedPixelRect(x - 20 + waddle, y - 35, 40, 42, 17, ink);
    drawRoundedPixelRect(x - 18 + waddle, y - 34, 36, 40, 16, body);
    drawRoundedPixelRect(x - 15 + waddle, y - 30, 15, 16, 8, white);
    drawRoundedPixelRect(x + 1 + waddle, y - 30, 15, 16, 8, white);
    drawRoundedPixelRect(x - 13 + waddle, y - 15, 27, 24, 12, white);
    drawPixelRect(ctx, x - 9 + waddle, y + 2, 19, 3, whiteShade);
  };

  const drawPenguinFace = () => {
    if (facing === "back") return;

    const { side, mouthX, mouthY } = mouthAnchor();
    const faceWaddle = isSide ? waddle : waddle;
    if (isSide) {
      const sideInset = side * -1;
      const eyeX = x + side * 10 + faceWaddle + sideInset;
      const beakLeft = (side > 0 ? x + 16 + faceWaddle : x - 24 + faceWaddle) + sideInset;
      if (sleepy || completeYawn) {
        drawPixelRect(ctx, eyeX - 3, y - 25, 7, 2, ink);
      } else {
        drawPixelRect(ctx, eyeX - 2, y - 28, focused ? 4 : 3, focused ? 5 : 4, ink);
        drawPixelRect(ctx, eyeX, y - 27, 1, 1, "#ffffff");
      }
      drawPixelRect(ctx, beakLeft, y - 24, 8, 4, ink);
      drawPixelRect(ctx, beakLeft + (side > 0 ? 1 : 0), y - 25, 7, 4, beak);
      drawPixelRect(ctx, beakLeft + (side > 0 ? 2 : 1), y - 24, 5, 1, beakLight);
      drawPixelRect(
        ctx,
        x + side * 8 + faceWaddle - (side < 0 ? 4 : 0) + sideInset,
        y - 18,
        4,
        3,
        blush,
      );
      if (worried) {
        drawPixelRect(ctx, x - side * 10 + sideInset, y - 19, 3, 6, "#9ee6ff");
      }
      return;
    }

    if (sleepy || completeYawn) {
      drawPixelRect(ctx, x - 10 + faceWaddle, y - 25, 7, 2, ink);
      drawPixelRect(ctx, x + 5 + faceWaddle, y - 25, 7, 2, ink);
    } else {
      drawPixelRect(ctx, x - 9 + faceWaddle, y - 28, focused ? 4 : 3, focused ? 5 : 4, ink);
      drawPixelRect(ctx, x + 6 + faceWaddle, y - 28, focused ? 4 : 3, focused ? 5 : 4, ink);
      drawPixelRect(ctx, x - 7 + faceWaddle, y - 27, 1, 1, "#ffffff");
      drawPixelRect(ctx, x + 8 + faceWaddle, y - 27, 1, 1, "#ffffff");
    }
    drawPixelRect(ctx, x - 5 + faceWaddle, mouthY - 2, 11, 5, ink);
    drawPixelRect(ctx, x - 4 + faceWaddle, mouthY - 3, 9, 5, beak);
    drawPixelRect(ctx, x - 3 + faceWaddle, mouthY - 2, 7, 2, beakLight);
    drawPixelRect(ctx, x - 14 + faceWaddle, y - 20, 5, 3, blush);
    drawPixelRect(ctx, x + 10 + faceWaddle, y - 20, 5, 3, blush);
    if (happy) {
      drawPixelRect(ctx, x - 2 + faceWaddle, mouthY + 4, 6, 1, "#ffffff");
    }
    if (completeYawn) {
      drawPixelRect(ctx, x - 4 + faceWaddle, mouthY + 2, 9, 6, ink);
      drawPixelRect(ctx, x - 2 + faceWaddle, mouthY + 3, 5, 4, "#51415f");
    }
    if (worried) {
      drawPixelRect(ctx, x + 17, y - 18, 3, 6, "#9ee6ff");
    }
  };

  const drawPenguinTypingPose = () => {
    if (facing === "back") return;

    const frontLike = facing === "front";
    const deviceX = frontLike ? x - 16 : facing === "left" ? x - 31 : x + 17;
    const deviceY = frontLike ? y - 3 : y - 8;
    const deviceWidth = frontLike ? 33 : 14;

    drawPixelRect(ctx, deviceX, deviceY, deviceWidth, 8, "#101827");
    drawPixelRect(ctx, deviceX + 2, deviceY + 2, deviceWidth - 4, 3, glow);
    drawPixelRect(ctx, deviceX + 4, deviceY + 5, 5, 2, "#d8fff7");
    drawPixelRect(ctx, deviceX + 13, deviceY + 5, 5, 2, "#9ee6ff");
    if (frontLike) {
      drawPixelRect(ctx, deviceX + 22, deviceY + 5, 5, 2, "#f8f0c9");
      drawFlipper(x - 15, y - 16, x - 8, y - 3 + tap, -1, true);
      drawFlipper(x + 15, y - 16, x + 8, y - 3 - tap, 1, true);
      return;
    }

    const side = facing === "left" ? -1 : 1;
    drawFlipper(x + side * 10, y - 16, x + side * 23, y - 5 + tap, side, true);
  };

  const drawPenguinPaintHat = () => {
    if (facing === "back") return;

    const side = facing === "left" ? -1 : 1;
    const hatX = facing === "front" ? x + waddle : x + side * 4 + waddle;
    drawPixelRect(ctx, hatX - 11, y - 40, 23, 4, "#111624");
    drawPixelRect(ctx, hatX - 8, y - 45, 16, 7, "#4b2f62");
    drawPixelRect(ctx, hatX - 13, y - 37, 27, 4, "#6d4385");
    drawPixelRect(ctx, hatX - 2, y - 46, 7, 2, "#a074b8");
  };

  drawPenguinBody();

  if (avatar.behavior === "paint") {
    drawPenguinPaintHat();
  }

  drawPenguinFace();

  if (isTyping) {
    drawPenguinTypingPose();
  } else if (!needsSharedPose && !completeYawn) {
    drawDefaultFlippers();
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
    drawPhonePose(ctx, x, y, frame, facing, body, bodyLight, ink, glow);
  }
  if (avatar.behavior === "admire") {
    drawAdmirePose(ctx, x, y, frame, facing, body, bodyLight, ink, glow);
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

  drawTraitStatusMotif(ctx, dominantTrait, avatar, x, y, frame, theme);
  drawTraitMicroExpression(ctx, dominantTrait, avatar, x, y, frame, theme);
};

const drawCuteGhostAvatar = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  frame: number,
  x: number,
  y: number,
  theme: (typeof traitVisualThemes)[DominantTrait],
  dominantTrait: DominantTrait,
) => {
  const facing = avatar.facing;
  const sideDirection = facing === "left" ? -1 : 1;
  const focused = avatar.expression === "focused";
  const worried = avatar.expression === "worried";
  const sleepy = avatar.expression === "sleepy";
  const happy = avatar.expression === "happy";
  const completeYawn = avatar.behavior === "success";
  const idleLaugh =
    !focused &&
    !sleepy &&
    (avatar.behavior === "idle" ||
      avatar.behavior === "wander" ||
      avatar.behavior === "relax" ||
      avatar.behavior === "explore") &&
    frame % 220 > 176;
  const laughing = happy || completeYawn || idleLaugh;
  const float = Math.round(Math.sin(frame / 18));
  const wave = Math.round(Math.sin(frame / 11) * 2);
  const horizontalMotion = avatar.targetX - avatar.x;
  const movingHorizontally = Math.abs(horizontalMotion) > 1.5;
  const skirtTrailDirection =
    movingHorizontally && horizontalMotion > 0
      ? -1
      : movingHorizontally && horizontalMotion < 0
        ? 1
        : 0;
  const skirtBridgeTrail = skirtTrailDirection;
  const skirtHemTrail = skirtTrailDirection * 2;
  const skirtRippleAmplitude = movingHorizontally ? 3 : 1;
  const skirtHemPhase = frame / (movingHorizontally ? 10 : 28);
  const skirtHighlightScale = movingHorizontally ? 2 : 1;
  const skirtHighlightLeft = Math.min(
    Math.round(((Math.sin(frame / (movingHorizontally ? 18 : 48) + 0.4) + 1) / 2) *
      skirtHighlightScale),
    movingHorizontally ? 2 : 1,
  );
  const skirtHighlightCenter = Math.min(
    Math.round(((Math.sin(frame / (movingHorizontally ? 20 : 56) + 2.1) + 1) / 2) *
      skirtHighlightScale),
    movingHorizontally ? 2 : 1,
  );
  const skirtHighlightRight = Math.min(
    Math.round(((Math.sin(frame / (movingHorizontally ? 17 : 52) + 3.7) + 1) / 2) *
      skirtHighlightScale),
    movingHorizontally ? 2 : 1,
  );
  const body = avatar.behavior === "error" ? "#eadcff" : "#e0f7ff";
  const bodyLight = "#ffffff";
  const bodyShade = avatar.behavior === "error" ? "#c4b5fd" : "#93c5fd";
  const edge = avatar.behavior === "error" ? "#a78bfa" : "#7dd3fc";
  const ink = "#123447";
  const blush = "#ff9ad5";
  const glow = avatar.behavior === "error" ? "#fee2e2" : theme.screenGlow;

  const drawAlphaRect = (
    rectX: number,
    rectY: number,
    width: number,
    height: number,
    color: string,
    alpha = 0.72,
  ) => {
    ctx.save();
    ctx.globalAlpha *= alpha;
    drawPixelRect(ctx, rectX, rectY, width, height, color);
    ctx.restore();
  };

  const drawFrontHalfMoonMouth = (
    centerX: number,
    topY: number,
    width: number,
    fill = "#51415f",
    accent = bodyLight,
  ) => {
    const left = centerX - Math.floor(width / 2);
    drawPixelRect(ctx, left, topY, width, 2, ink);
    drawPixelRect(ctx, left + 1, topY + 2, width - 2, 2, ink);
    drawPixelRect(ctx, left + 3, topY + 4, width - 6, 2, ink);
    drawPixelRect(ctx, left + 5, topY + 6, width - 10, 1, ink);
    drawPixelRect(ctx, left + 2, topY + 1, width - 4, 2, fill);
    drawPixelRect(ctx, left + 3, topY + 3, width - 6, 2, fill);
    drawPixelRect(ctx, left + 5, topY + 5, width - 10, 1, fill);
    drawPixelRect(ctx, left + 4, topY + 1, Math.max(3, width - 8), 1, accent);
  };

  const drawSideHalfMoonMouth = (
    mouthX: number,
    topY: number,
    direction: number,
    fill = "#51415f",
    accent = bodyLight,
  ) => {
    const left = direction > 0 ? mouthX - 1 : mouthX - 9;
    drawPixelRect(ctx, left, topY, 10, 2, ink);
    drawPixelRect(ctx, left + 1, topY + 2, 8, 2, ink);
    drawPixelRect(ctx, left + 3, topY + 4, 5, 1, ink);
    drawPixelRect(ctx, left + 1, topY + 1, 8, 2, fill);
    drawPixelRect(ctx, left + 2, topY + 3, 6, 1, fill);
    drawPixelRect(ctx, left + 3, topY + 1, 4, 1, accent);
  };

  const drawGhostArm = (handX: number, handY: number, direction: number) => {
    const shoulderX = x + direction * 13;
    const shoulderY = y - 20 + float;
    const jointX = Math.round((shoulderX + handX) / 2);
    const jointY = Math.round((shoulderY + handY) / 2) + (direction < 0 ? 1 : -1);
    drawAlphaRect(shoulderX - 2, shoulderY - 2, 5, 5, edge, 0.62);
    drawAlphaRect(jointX - 3, jointY - 2, 7, 5, bodyShade, 0.58);
    drawAlphaRect(handX - 3, handY - 3, 7, 7, body, 0.68);
    drawAlphaRect(handX + direction * 3, handY - 1, 3, 3, bodyLight, 0.7);
  };

  const drawGhostBody = () => {
    const drawSkirtBand = (
      topOffset: number,
      leftOffset: number,
      rightOffset: number,
      height: number,
      color: string,
      swayOffset = 0,
    ) => {
      drawPixelRect(
        ctx,
        x + leftOffset + swayOffset,
        y + topOffset,
        rightOffset - leftOffset,
        height,
        color,
      );
    };
    const drawDenseSkirtHem = (
      topOffset: number,
      leftOffset: number,
      rightOffset: number,
      color: string,
      swayOffset = 0,
    ) => {
      const width = rightOffset - leftOffset;
      const stripWidth = 2;
      let stripIndex = 0;

      for (
        let stripLeft = leftOffset;
        stripLeft < rightOffset;
        stripLeft += stripWidth
      ) {
        const stripRight = Math.min(rightOffset, stripLeft + stripWidth);
        const stripCenter = stripLeft + (stripRight - stripLeft) / 2;
        const t = (stripCenter - leftOffset) / Math.max(1, width);
        const wShapeDrop = Math.round(
          1 - Math.abs(Math.sin(t * Math.PI * 2)),
        );
        const rippleDrop = Math.round(
          ((Math.sin(skirtHemPhase + stripIndex * 1.1) + 1) / 2) *
            skirtRippleAmplitude,
        );
        const sideDrop =
          stripLeft === leftOffset || stripRight >= rightOffset ? 1 : 0;
        const stripHeight =
          1 + Math.max(wShapeDrop, sideDrop) + rippleDrop;

        drawSkirtBand(
          topOffset,
          stripLeft,
          stripRight,
          stripHeight,
          color,
          swayOffset,
        );
        stripIndex += 1;
      }
    };

    drawPixelRect(ctx, x - 15, y + 14, 33, 4, "rgba(18, 52, 71, 0.16)");
    drawPixelRect(ctx, x - 8, y + 15, 18, 2, "rgba(18, 52, 71, 0.14)");
    ctx.save();
    ctx.globalAlpha *= 0.66;
    drawPixelRect(ctx, x - 7, y - 40, 15, 3, edge);
    drawPixelRect(ctx, x - 12, y - 39, 25, 5, edge);
    drawPixelRect(ctx, x - 16, y - 36, 33, 8, edge);
    drawPixelRect(ctx, x - 19, y - 30, 39, 18, edge);
    drawSkirtBand(-12, -18, 19, 6, edge);
    drawSkirtBand(-6, -18, 19, 5, edge, skirtBridgeTrail);
    drawSkirtBand(-1, -18, 19, 6, edge, skirtHemTrail);
    drawDenseSkirtHem(5, -18, 19, edge, skirtHemTrail);
    drawPixelRect(ctx, x - 6, y - 39, 13, 3, body);
    drawPixelRect(ctx, x - 10, y - 38, 21, 6, body);
    drawPixelRect(ctx, x - 14, y - 35, 29, 9, body);
    drawPixelRect(ctx, x - 17, y - 28, 35, 16, body);
    drawSkirtBand(-12, -17, 18, 6, body);
    drawSkirtBand(-6, -17, 18, 5, body, skirtBridgeTrail);
    drawSkirtBand(-1, -17, 18, 6, body, skirtHemTrail);
    drawDenseSkirtHem(5, -17, 18, body, skirtHemTrail);
    drawPixelRect(ctx, x - 7, y - 34, 14, 3, bodyLight);
    drawPixelRect(ctx, x + 7, y - 20, 8, 2, bodyShade);
    drawPixelRect(ctx, x - 14, y - 12, 6, 2, bodyLight);
    drawPixelRect(
      ctx,
      x - 15 + skirtBridgeTrail,
      y - 2 + skirtHighlightLeft,
      5,
      1,
      bodyLight,
    );
    drawPixelRect(
      ctx,
      x - 2 + skirtHemTrail,
      y + 2 + skirtHighlightCenter,
      5,
      1,
      bodyLight,
    );
    drawPixelRect(
      ctx,
      x + 11 + skirtBridgeTrail,
      y - 2 + skirtHighlightRight,
      5,
      1,
      bodyShade,
    );
    ctx.restore();
  };

  const drawGhostFace = () => {
    if (facing === "back") {
      drawAlphaRect(x - 7, y - 31, 15, 2, bodyLight, 0.76);
      drawAlphaRect(x - 4, y - 22, 10, 3, bodyShade, 0.42);
      return;
    }

    const faceY = y - 6;
    if (laughing) {
      if (facing === "left" || facing === "right") {
        const eyeX = x + sideDirection * 7;
        drawPixelRect(ctx, eyeX - 3, faceY - 23, 7, 2, ink);
        drawSideHalfMoonMouth(x + sideDirection * 8, faceY - 16, sideDirection);
      } else {
        drawPixelRect(ctx, x - 8, faceY - 23, 6, 2, ink);
        drawPixelRect(ctx, x + 5, faceY - 23, 6, 2, ink);
        drawFrontHalfMoonMouth(x, faceY - 16, 17);
      }
      if (completeYawn) {
        drawPixelRect(ctx, x + 17, faceY - 30, 3, 3, bodyLight);
        drawPixelRect(ctx, x + 22, faceY - 34, 2, 2, bodyLight);
      }
      return;
    }

    if (facing === "left" || facing === "right") {
      const eyeX = x + sideDirection * 7;
      if (sleepy) {
        drawPixelRect(ctx, eyeX - 4, faceY - 23, 8, 2, ink);
      } else {
        drawPixelRect(ctx, eyeX, faceY - 24, 4, 4, ink);
        drawPixelRect(ctx, eyeX + 1, faceY - 23, 1, 1, bodyLight);
      }
      drawPixelRect(ctx, x + sideDirection * 4, faceY - 14, 10, 1, ink);
      drawPixelRect(ctx, x - sideDirection * 7, faceY - 15, 4, 2, blush);
      if (worried) {
        drawPixelRect(ctx, x - sideDirection * 12, faceY - 26, 3, 6, "#9ee6ff");
      }
      return;
    }

    if (sleepy) {
      drawPixelRect(ctx, x - 9, faceY - 23, 7, 2, ink);
      drawPixelRect(ctx, x + 5, faceY - 23, 7, 2, ink);
    } else {
      drawPixelRect(ctx, x - 8, faceY - 24, 4, 4, ink);
      drawPixelRect(ctx, x + 6, faceY - 24, 4, 4, ink);
      drawPixelRect(ctx, x - 7, faceY - 23, 1, 1, bodyLight);
      drawPixelRect(ctx, x + 7, faceY - 23, 1, 1, bodyLight);
    }
    drawPixelRect(ctx, x - 14, faceY - 17, 5, 2, blush);
    drawPixelRect(ctx, x + 11, faceY - 17, 5, 2, blush);
    drawPixelRect(ctx, x - 6, faceY - 14, 13, 1, ink);
    if (worried) {
      drawPixelRect(ctx, x + 17, faceY - 27, 3, 6, "#9ee6ff");
    }
  };

  const mouthAnchor = () => {
    const front = facing === "front";
    const side = facing === "left" ? -1 : 1;
    return {
      front,
      side,
      mouthX: front ? x : x + side * 8,
      mouthY: y - 20,
    };
  };

  const drawGhostChewMouth = (foodColor: string) => {
    if (facing === "back") return;

    const { front, side, mouthX, mouthY } = mouthAnchor();
    const chewOpen = frame % 18 < 10;
    const chewY = mouthY + Math.round(Math.sin(frame / 5));
    if (chewOpen) {
      if (front) {
        drawFrontHalfMoonMouth(mouthX, chewY, 11, "#5b3d42", foodColor);
      } else {
        drawSideHalfMoonMouth(mouthX, chewY, side, "#5b3d42", foodColor);
      }
      return;
    }

    if (front) {
      drawPixelRect(ctx, mouthX - 5, chewY + 2, 11, 1, ink);
      drawPixelRect(ctx, mouthX - 2, chewY + 3, 5, 1, foodColor);
      return;
    }

    const left = side > 0 ? mouthX : mouthX - 6;
    drawPixelRect(ctx, left, chewY + 2, 7, 1, ink);
    drawPixelRect(ctx, left + 2, chewY + 3, 3, 1, foodColor);
  };

  const drawGhostTypingPose = () => {
    const tap = Math.round(Math.sin(frame / 3) * 2);
    const frontLike = facing === "front" || facing === "back";
    if (facing === "back") {
      const deviceX = x - 13;
      const deviceY = y - 31;
      drawPixelRect(ctx, deviceX + 2, deviceY + 1, 23, 2, "#0a111d");
      drawPixelRect(ctx, deviceX, deviceY + 3, 27, 5, "#101827");
      drawPixelRect(ctx, deviceX + 2, deviceY + 7, 23, 2, "#182235");
      drawPixelRect(ctx, deviceX + 4, deviceY + 4, 4, 1, "#d8fff7");
      drawPixelRect(ctx, deviceX + 11, deviceY + 5, 4, 1, "#9ee6ff");
      drawPixelRect(ctx, deviceX + 18, deviceY + 4, 4, 1, "#f8f0c9");
      drawGhostArm(x - 9, deviceY + 8 + tap, -1);
      drawGhostArm(x + 10, deviceY + 8 - tap, 1);
      return;
    }
    const deviceX = frontLike ? x - 16 : facing === "left" ? x - 32 : x + 18;
    const deviceY = frontLike ? y - 2 : y - 8;
    drawPixelRect(ctx, deviceX, deviceY, frontLike ? 33 : 14, 8, "#101827");
    drawPixelRect(ctx, deviceX + 2, deviceY + 2, frontLike ? 29 : 10, 3, glow);
    drawPixelRect(ctx, deviceX + 4, deviceY + 5, 5, 2, "#d8fff7");
    drawPixelRect(ctx, deviceX + 13, deviceY + 5, 5, 2, "#9ee6ff");
    drawPixelRect(ctx, deviceX + 22, deviceY + 5, 5, 2, "#f8f0c9");
    if (frontLike) {
      drawGhostArm(x - 8, y - 5 + tap, -1);
      drawGhostArm(x + 9, y - 5 - tap, 1);
      return;
    }
    const side = facing === "left" ? -1 : 1;
    drawGhostArm(x + side * 25, y - 5 + tap, side);
  };

  const drawGhostInteractionPose = () => {
    if (avatar.behavior === "coding" || avatar.behavior === "thinking") {
      drawGhostTypingPose();
      return;
    }
    if (facing === "back") return;

    const { front, side, mouthX, mouthY } = mouthAnchor();
    const bob = Math.round(Math.sin(frame / 8));
    const propX = front ? x : mouthX + side * 5;
    const propY = mouthY + 3 + bob;

    if (avatar.behavior === "coffee") {
      drawGhostArm(propX - 7, propY + 7, -1);
      drawGhostArm(propX + 7, propY + 7, 1);
      drawPixelRect(ctx, propX - 6, propY, 12, 10, ink);
      drawPixelRect(ctx, propX - 5, propY - 1, 10, 10, "#f4ead2");
      drawPixelRect(ctx, propX - 3, propY + 1, 6, 2, "#6f3a20");
      drawPixelRect(ctx, propX + side * 5, propY + 3, 3, 5, "#f4ead2");
      drawPixelRect(ctx, propX - 2, propY - 7, 2, 4, "#d8f7ff");
      drawPixelRect(ctx, mouthX - 2, mouthY + 2, 5, 1, "#6f3a20");
      return;
    }

    if (avatar.behavior === "cola") {
      drawGhostArm(propX - 6, propY + 8, -1);
      drawGhostArm(propX + 6, propY + 8, 1);
      drawPixelRect(ctx, propX - 5, propY - 2, 10, 14, ink);
      drawPixelRect(ctx, propX - 4, propY - 3, 8, 14, "#d9364a");
      drawPixelRect(ctx, propX - 3, propY, 2, 9, "#ff8fa3");
      drawPixelRect(ctx, propX + 2, propY, 2, 9, "#8f1f36");
      drawPixelRect(ctx, propX - 1, propY - 6, 2, 8, "#f4ead2");
      drawPixelRect(ctx, mouthX - 2, mouthY + 2, 5, 1, "#f4ead2");
      return;
    }

    if (avatar.behavior === "bento") {
      const trayX = front ? x - 13 : propX - 12;
      const trayY = y - 13 + bob;
      drawGhostArm(trayX, trayY + 8, -1);
      drawGhostArm(trayX + 25, trayY + 8, 1);
      drawPixelRect(ctx, trayX - 2, trayY - 3, 28, 13, ink);
      drawPixelRect(ctx, trayX - 1, trayY - 4, 26, 12, "#f4ead2");
      drawPixelRect(ctx, trayX + 1, trayY - 2, 8, 5, "#fff8df");
      drawPixelRect(ctx, trayX + 10, trayY - 2, 7, 5, "#ff8fa3");
      drawPixelRect(ctx, trayX + 18, trayY - 1, 5, 4, "#8df7c4");
      drawGhostChewMouth("#fff8df");
      return;
    }

    if (avatar.behavior === "cookie") {
      const cookieX = front ? x + 4 : propX;
      const cookieY = mouthY + 6 + bob;
      drawGhostArm(cookieX, cookieY + 2, side);
      drawPixelRect(ctx, cookieX - 4, cookieY - 4, 9, 8, ink);
      drawPixelRect(ctx, cookieX - 3, cookieY - 5, 8, 7, "#c48650");
      drawPixelRect(ctx, cookieX - 2, cookieY - 4, 3, 1, "#f0c276");
      drawPixelRect(ctx, cookieX + 2, cookieY - 2, 1, 1, "#5b2a10");
      drawGhostChewMouth("#c48650");
      return;
    }

    if (avatar.behavior === "phone") {
      const phoneX = front ? x : x + side * 15;
      const phoneY = y - 17 + bob;
      drawGhostArm(phoneX - 5, phoneY + 11, -1);
      drawGhostArm(phoneX + 5, phoneY + 11, 1);
      drawPixelRect(ctx, phoneX - 6, phoneY - 1, 13, 18, ink);
      drawPixelRect(ctx, phoneX - 5, phoneY - 2, 11, 18, "#101827");
      drawPixelRect(ctx, phoneX - 4, phoneY, 2, 14, "#ff5c7a");
      drawPixelRect(ctx, phoneX - 2, phoneY, 2, 14, "#ffb454");
      drawPixelRect(ctx, phoneX, phoneY, 1, 14, "#ffe66d");
      drawPixelRect(ctx, phoneX + 1, phoneY, 2, 14, "#8df7c4");
      drawPixelRect(ctx, phoneX + 3, phoneY, 1, 14, "#5ce1e6");
      drawPixelRect(ctx, phoneX + 4, phoneY, 1, 14, "#a78bfa");
      drawPixelRect(ctx, phoneX + 1, phoneY - 1, 3, 3, "#0f172a");
      drawPixelRect(ctx, phoneX + 2, phoneY, 2, 2, "#94a3b8");
      drawPixelRect(ctx, phoneX + 2, phoneY, 1, 1, "#e0f2fe");
      drawPixelRect(ctx, phoneX - 3, phoneY + 1, 3, 1, "#fff7ed");
      drawPixelRect(ctx, phoneX - 1, phoneY + 13, 4, 1, "#1e293b");
      return;
    }

    if (avatar.behavior === "admire") {
      const pulse = Math.round(Math.sin(frame / 5) * 2);
      const gazeX = front ? x + 24 : x + side * 26;
      const gazeY = y - 29;
      drawGhostArm(gazeX - side * 3, gazeY + 13 + pulse, side);
      drawPixelRect(ctx, gazeX - 1, gazeY - 1, 3, 3, glow);
      drawPixelRect(ctx, gazeX, gazeY - 5, 1, 2, bodyLight);
      drawPixelRect(ctx, gazeX - 5, gazeY, 2, 1, bodyLight);
      drawPixelRect(ctx, gazeX + 4, gazeY, 2, 1, bodyLight);
      return;
    }

    if (avatar.behavior === "paint") {
      const brushLift = Math.round(Math.sin(frame / 4) * 2);
      const paletteX = front ? x - 17 : x - side * 19;
      const paletteY = y - 9 + bob;
      const brushX = front ? x + 21 : x + side * 22;
      const brushY = y - 18 + brushLift;
      drawGhostArm(paletteX, paletteY + 4, -1);
      drawGhostArm(brushX - side * 5, brushY + 1, side);
      drawPixelRect(ctx, paletteX - 8, paletteY - 5, 16, 11, ink);
      drawPixelRect(ctx, paletteX - 7, paletteY - 6, 15, 10, "#f4ead2");
      drawPixelRect(ctx, paletteX - 6, paletteY - 2, 3, 3, "#ff5c7a");
      drawPixelRect(ctx, paletteX + 2, paletteY - 4, 3, 3, "#5ce1e6");
      ctx.strokeStyle = "#5b2a10";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(brushX - side * 7, brushY + 8);
      ctx.lineTo(brushX + side * 7, brushY - 9);
      ctx.stroke();
      drawPixelRect(ctx, brushX + side * 7 - 2, brushY - 10, 5, 4, "#d95d75");
      return;
    }

    if (
      avatar.behavior === "fetch_task_file" ||
      avatar.behavior === "carry_task_file" ||
      avatar.behavior === "read_task_file"
    ) {
      const isReading = avatar.behavior === "read_task_file";
      const fileX = front || isReading ? x - 13 : x + side * 12 - 7;
      const fileY = isReading ? y - 22 + bob : y - 16 + bob;
      drawGhostArm(fileX, fileY + 8, -1);
      drawGhostArm(fileX + 24, fileY + 8, 1);
      if (isReading) {
        drawPixelRect(ctx, fileX - 2, fileY - 1, 30, 18, "#27313d");
        drawTaskFileSheet(ctx, fileX, fileY, 12, 15, "#9ee6ff");
        drawTaskFileSheet(ctx, fileX + 14, fileY, 12, 15, "#b4f56c");
        return;
      }
      drawTaskFileSheet(ctx, fileX, fileY, 13, 16, "#ffe66d");
    }
  };

  const backTyping =
    facing === "back" && (avatar.behavior === "coding" || avatar.behavior === "thinking");

  if (backTyping) {
    ctx.save();
    ctx.globalAlpha *= 0.45;
    drawGhostTypingPose();
    ctx.restore();
  }

  drawGhostBody();
  drawGhostFace();

  if (avatar.behavior === "paint" && facing !== "back") {
    drawPixelRect(ctx, x - 12, y - 39, 24, 3, "#6d4385");
    drawPixelRect(ctx, x - 8, y - 44, 16, 7, "#4b2f62");
    drawPixelRect(ctx, x - 2, y - 45, 7, 2, "#a074b8");
  }

  if (
    avatar.behavior === "coding" ||
    avatar.behavior === "thinking" ||
    avatar.behavior === "coffee" ||
    avatar.behavior === "cola" ||
    avatar.behavior === "bento" ||
    avatar.behavior === "cookie" ||
    avatar.behavior === "phone" ||
    avatar.behavior === "admire" ||
    avatar.behavior === "paint" ||
    avatar.behavior === "fetch_task_file" ||
    avatar.behavior === "carry_task_file" ||
    avatar.behavior === "read_task_file"
  ) {
    if (!backTyping) {
      drawGhostInteractionPose();
    }
  } else if (!completeYawn) {
    if (facing === "left" || facing === "right") {
      drawGhostArm(x + sideDirection * 22, y - 16 + wave, sideDirection);
    } else {
      drawGhostArm(x - 23, y - 17 + wave, -1);
      drawGhostArm(x + 23, y - 17 - wave, 1);
    }
  }

  drawTraitStatusMotif(ctx, dominantTrait, avatar, x, y, frame, theme);
  drawTraitMicroExpression(ctx, dominantTrait, avatar, x, y, frame, theme);
};

const drawAvatar = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  frame: number,
  stats: PetStats,
  status: CodexStatusMessage,
  memory?: AivatarMemory,
  appearanceId: AvatarAppearanceId = "octopus",
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

  if (appearanceId === "demo-spark") {
    drawDemoSparkAvatar(
      ctx,
      avatar,
      frame,
      x,
      y,
      wiggle,
      body,
      bodyLight,
      ink,
      theme,
      dominantTrait,
    );
    return;
  }

  if (appearanceId === "mood-slime") {
    drawMoodSlimeAvatar(ctx, avatar, frame, x, y, stats, theme, dominantTrait);
    return;
  }

  if (appearanceId === "cute-crayfish") {
    drawCuteCrayfishAvatar(ctx, avatar, frame, x, y, wiggle, theme, dominantTrait);
    return;
  }

  if (appearanceId === "cute-ghost") {
    drawCuteGhostAvatar(ctx, avatar, frame, x, y, theme, dominantTrait);
    return;
  }

  if (appearanceId === "cute-penguin") {
    drawCutePenguinAvatar(ctx, avatar, frame, x, Math.round(avatar.y), theme, dominantTrait);
    return;
  }

  if (appearanceId === "wave-lizard") {
    drawWaveLizardAvatar(ctx, avatar, frame, x, y, wiggle, theme, dominantTrait);
    return;
  }

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

  const sprite = bedSpriteForSkinId(bedSkinId(bed));
  if (sprite) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      bed.x + BED_SPRITE_X_OFFSET,
      bed.y + 25,
      BED_SPRITE_WIDTH,
      59,
    );
    ctx.clip();
    drawBedSpriteMatrix(
      ctx,
      bed.x + BED_SPRITE_X_OFFSET,
      bed.y + BED_SPRITE_Y_OFFSET,
      sprite,
    );
    ctx.restore();
    return;
  }

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

  const progress = hasDuration
    ? Math.min(1, Math.max(0, (now - interaction.startedAt) / (interaction.endsAt! - interaction.startedAt)))
    : interaction.progress;
  const hasProgress = typeof progress === "number";
  const bubbleHeight = hasDuration || hasProgress ? 25 : 18;

  if (!hasDuration && !hasProgress && ageSeconds > 4) return;
  ctx.font = "8px monospace";
  const maxTextWidth = 118;
  const text = ellipsizeToWidth(ctx, interaction.bubbleText, maxTextWidth);
  const width = Math.max(38, Math.ceil(measurePixelText(ctx, text)) + 14);
  const x = Math.round(Math.min(sceneSize.width - width - 8, Math.max(8, avatar.x - width / 2)));
  const y = Math.round(Math.max(18, avatar.y - 64));
  const palette = bubblePaletteForTheme(uiTheme);

  drawPixelRect(ctx, x + 3, y + 4, width, bubbleHeight, palette.shadow);
  drawPixelRect(ctx, x, y, width, bubbleHeight, palette.border);
  drawPixelRect(ctx, x + 2, y + 2, width - 4, bubbleHeight - 4, palette.fill);
  if (isTerminalTheme(uiTheme)) {
    drawPixelRect(ctx, x + 4, y + 4, width - 8, 1, terminalScanlineForTheme(uiTheme));
  }
  drawPixelRect(
    ctx,
    x + Math.floor(width / 2) - 3,
    y + bubbleHeight,
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
  if (!isTerminalBubbleAgent(status)) return;
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
    terminal.y + TERMINAL_MONITOR_STATUS_BUBBLE_Y_OFFSET,
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

const drawSmallItemSprite = (
  ctx: CanvasRenderingContext2D,
  itemId: SmallItemSpriteId,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  const sprite = SMALL_ITEM_SPRITE_DATA[itemId];
  const spriteX = Math.round(x) + sprite.xOffset;
  const spriteY = Math.round(y) + sprite.yOffset;

  ctx.save();
  if (ghost !== "none") {
    ctx.globalAlpha = 0.62;
  }

  drawTableSprite(ctx, spriteX, spriteY, sprite.palette, sprite.rows);

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.lineWidth = 1;
    ctx.strokeRect(spriteX, spriteY, sprite.width, sprite.height);
  }

  ctx.restore();
};

const drawTinyPlant = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  drawSmallItemSprite(ctx, "tiny-plant", x, y, ghost);
};

const drawRugSprite = (
  ctx: CanvasRenderingContext2D,
  itemId: RugSpriteId,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  const sprite = RUG_SPRITE_DATA[itemId];
  const spriteX = Math.round(x) + sprite.xOffset;
  const spriteY = Math.round(y) + sprite.yOffset;

  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.58;
  drawTableSprite(ctx, spriteX, spriteY, sprite.palette, sprite.rows);

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.lineWidth = 1;
    ctx.strokeRect(spriteX, spriteY, sprite.width, sprite.height);
  }

  ctx.restore();
};

const drawCozyRug = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  drawRugSprite(ctx, "cozy-rug", x, y, ghost);
};

const drawMorphBlobRug = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  drawRugSprite(ctx, "morph-blob-rug", x, y, ghost);
};

const drawBluePersianRug = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  drawRugSprite(ctx, "blue-persian-rug", x, y, ghost);
};

const drawDeskLampGlow = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  const baseX = Math.round(x);
  const baseY = Math.round(y);

  ctx.save();
  drawPixelRect(ctx, baseX - 14, baseY - 18, 16, 3, "rgba(245, 208, 106, 0.11)");
  drawPixelRect(ctx, baseX - 16, baseY - 15, 20, 4, "rgba(245, 208, 106, 0.09)");
  drawPixelRect(ctx, baseX - 14, baseY - 11, 16, 3, "rgba(245, 208, 106, 0.07)");
  drawPixelRect(ctx, baseX - 10, baseY - 8, 10, 2, "rgba(245, 208, 106, 0.05)");
  ctx.restore();
};

const drawDeskLamp = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
) => {
  if (ghost === "none") {
    drawDeskLampGlow(ctx, x, y);
  }

  drawSmallItemSprite(ctx, "desk-lamp", x, y, ghost);
};

const drawGeneratedPainting = (
  ctx: CanvasRenderingContext2D,
  artwork: AivatarPaintingArtwork,
  x: number,
  y: number,
  progress = 1,
  pixelSize = 1,
) => {
  drawPixelRect(
    ctx,
    x,
    y,
    artwork.width * pixelSize,
    artwork.height * pixelSize,
    "#fff8df",
  );

  artwork.pixels.forEach((row, rowIndex) => {
    [...row].forEach((pixel, columnIndex) => {
      if (!paintingPixelVisible(artwork, columnIndex, rowIndex, progress)) return;
      const colorIndex = Number.parseInt(pixel, 36);
      const color = artwork.palette[colorIndex] ?? artwork.palette[0] ?? "#111624";
      drawPixelRect(
        ctx,
        x + columnIndex * pixelSize,
        y + rowIndex * pixelSize,
        pixelSize,
        pixelSize,
        color,
      );
    });
  });
};

const drawPoster = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  artwork?: AivatarPaintingArtwork,
  progress = 1,
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

  if (artwork && ghost === "none") {
    drawGeneratedPainting(ctx, artwork, baseX - 12, baseY - 35, progress);
  } else {
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
  }

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

const drawGameConsoleScreenAnimation = (
  ctx: CanvasRenderingContext2D,
  spriteX: number,
  spriteY: number,
  frame: number,
) => {
  const screenX = spriteX + GAME_CONSOLE_SCREEN_REGION.x;
  const screenY = spriteY + GAME_CONSOLE_SCREEN_REGION.y;
  const runnerX = screenX + 4 + (Math.floor(frame / 4) % 10);
  const jump = Math.floor(frame / 8) % 4 === 1 ? 1 : 0;
  const pulse = Math.floor(frame / 6) % 4;

  drawPixelRect(ctx, screenX + 1, screenY + 1, GAME_CONSOLE_SCREEN_REGION.width - 2, 1, "#133438");
  drawPixelRect(ctx, screenX + 3, screenY + 10, 16, 1, "#4fc2a8");
  drawPixelRect(ctx, screenX + 5, screenY + 11, 15, 1, "#2b7a72");
  drawPixelRect(ctx, screenX + 7, screenY + 8 - jump, 3, 3, "#b4f56c");
  drawPixelRect(ctx, screenX + 8, screenY + 9 - jump, 1, 1, "#102f27");
  drawPixelRect(ctx, runnerX, screenY + 7, 2, 2, "#ffe66d");
  drawPixelRect(ctx, screenX + 15 + (pulse % 2), screenY + 4, 4, 2, "#7ed9b2");
  drawPixelRect(ctx, screenX + 16 + (pulse % 2), screenY + 3, 2, 1, "#b4f56c");
  drawPixelRect(ctx, screenX + 4 + pulse * 3, screenY + 5, 1, 1, "#8df7c4");
};

const drawGameConsoleScreenBase = (
  ctx: CanvasRenderingContext2D,
  spriteX: number,
  spriteY: number,
) => {
  const screenX = spriteX + GAME_CONSOLE_SCREEN_REGION.x;
  const screenY = spriteY + GAME_CONSOLE_SCREEN_REGION.y;

  drawPixelRect(
    ctx,
    screenX,
    screenY,
    GAME_CONSOLE_SCREEN_REGION.width,
    GAME_CONSOLE_SCREEN_REGION.height,
    "#010407",
  );
  drawPixelRect(
    ctx,
    screenX + 1,
    screenY + 1,
    GAME_CONSOLE_SCREEN_REGION.width - 2,
    GAME_CONSOLE_SCREEN_REGION.height - 2,
    "#03080d",
  );
  drawPixelRect(ctx, screenX + 2, screenY + 2, 7, 1, "#26343b");
  drawPixelRect(ctx, screenX + 2, screenY + 3, 4, 1, "#111b22");
  drawPixelRect(ctx, screenX + 11, screenY + 1, 6, 1, "#17262d");
  drawPixelRect(ctx, screenX + 17, screenY + 2, 2, 1, "#22343b");
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
  const sprite = GAME_CONSOLE_SPRITE_DATA["game-console-c"];
  const spriteX = baseX + sprite.xOffset;
  const spriteY = baseY + sprite.yOffset;

  drawTableSprite(ctx, spriteX, spriteY, sprite.palette, sprite.rows);
  drawGameConsoleScreenBase(ctx, spriteX, spriteY);

  if (playing) {
    drawGameConsoleScreenAnimation(ctx, spriteX, spriteY, frame);
  }

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(spriteX, spriteY, sprite.width, sprite.height);
  }
  ctx.restore();
};

const drawRecordPlayerVinylMotion = (
  ctx: CanvasRenderingContext2D,
  spriteX: number,
  spriteY: number,
  frame: number,
) => {
  const spinPhase = Math.floor(frame / 6) % 4;
  const spinStreaks = [
    [
      { x: 12, y: 9, width: 8, color: "#3a4558" },
      { x: 23, y: 21, width: 6, color: "#596174" },
    ],
    [
      { x: 20, y: 10, width: 7, color: "#596174" },
      { x: 10, y: 18, width: 7, color: "#30394c" },
    ],
    [
      { x: 10, y: 13, width: 8, color: "#4a5368" },
      { x: 20, y: 23, width: 7, color: "#30394c" },
    ],
    [
      { x: 18, y: 8, width: 7, color: "#4a5368" },
      { x: 9, y: 20, width: 8, color: "#596174" },
    ],
  ][spinPhase];

  spinStreaks.forEach((streak) => {
    drawPixelRect(
      ctx,
      spriteX + streak.x,
      spriteY + streak.y,
      streak.width,
      1,
      streak.color,
    );
  });

  const labelGlints = [
    { x: 19, y: 16 },
    { x: 21, y: 18 },
    { x: 18, y: 19 },
    { x: 20, y: 15 },
  ];
  const glint = labelGlints[spinPhase];
  drawPixelRect(ctx, spriteX + glint.x, spriteY + glint.y, 1, 1, "#fff8df");
};

const drawRecordPlayerVinyl = (ctx: CanvasRenderingContext2D, spriteX: number, spriteY: number) => {
  const outer = "#06090e";
  const rim = "#111827";
  const groove = "#263044";
  const grooveDark = "#161d2a";

  drawPixelRect(ctx, spriteX + 13, spriteY + 7, 17, 1, rim);
  drawPixelRect(ctx, spriteX + 9, spriteY + 8, 25, 2, outer);
  drawPixelRect(ctx, spriteX + 7, spriteY + 10, 29, 3, outer);
  drawPixelRect(ctx, spriteX + 6, spriteY + 13, 31, 8, outer);
  drawPixelRect(ctx, spriteX + 8, spriteY + 21, 27, 3, outer);
  drawPixelRect(ctx, spriteX + 12, spriteY + 24, 18, 1, rim);
  drawPixelRect(ctx, spriteX + 13, spriteY + 25, 15, 1, rim);

  drawPixelRect(ctx, spriteX + 11, spriteY + 9, 18, 1, "#30394c");
  drawPixelRect(ctx, spriteX + 8, spriteY + 13, 25, 1, groove);
  drawPixelRect(ctx, spriteX + 7, spriteY + 18, 27, 1, grooveDark);
  drawPixelRect(ctx, spriteX + 10, spriteY + 22, 19, 1, "#323b50");
};

const drawRecordPlayerIndicator = (
  ctx: CanvasRenderingContext2D,
  spriteX: number,
  spriteY: number,
  playing: boolean,
) => {
  drawPixelRect(ctx, spriteX + 34, spriteY + 31, 5, 3, "#2a1e1d");
  drawPixelRect(ctx, spriteX + 35, spriteY + 32, 4, 2, "#382227");

  if (!playing) {
    drawPixelRect(ctx, spriteX + 36, spriteY + 31, 2, 2, "#4a291a");
    drawPixelRect(ctx, spriteX + 37, spriteY + 32, 1, 1, "#553522");
    return;
  }

  drawPixelRect(ctx, spriteX + 35, spriteY + 31, 3, 2, "#961418");
  drawPixelRect(ctx, spriteX + 37, spriteY + 31, 2, 2, "#f1524c");
  drawPixelRect(ctx, spriteX + 36, spriteY + 32, 3, 2, "#dc403b");
  drawPixelRect(ctx, spriteX + 38, spriteY + 32, 1, 1, "#f6816f");
};

const drawRecordPlayerNotes = (ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) => {
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const notes = [
    { color: "#ffe66d", duration: 76, offset: 0, startX: 20, startY: -9, distance: 24 },
    { color: "#9ee6ff", duration: 86, offset: 38, startX: 28, startY: -12, distance: 28 },
  ];

  notes.forEach((note) => {
    const phase = ((frame + note.offset) % note.duration) / note.duration;
    const rise = Math.round(phase * note.distance);
    const drift = Math.round(Math.sin(phase * Math.PI * 2) * 2);
    const noteX = baseX + note.startX + drift;
    const noteY = baseY + note.startY - rise;
    const fadeIn = Math.min(1, phase / 0.16);
    const fadeOut = Math.min(1, (1 - phase) / 0.28);

    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(fadeIn, fadeOut));
    drawPixelRect(ctx, noteX + 3, noteY, 2, 8, note.color);
    drawPixelRect(ctx, noteX, noteY + 6, 5, 4, note.color);
    drawPixelRect(ctx, noteX + 5, noteY + 1, 4, 1, note.color);
    drawPixelRect(ctx, noteX + 8, noteY + 2, 2, 6, note.color);
    drawPixelRect(ctx, noteX + 6, noteY + 7, 5, 4, note.color);
    ctx.restore();
  });
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
  const playing = ghost === "none" && recordPlayerPlaying;
  const sprite = RECORD_PLAYER_SPRITE_DATA["record-player-idle"];
  const spriteX = Math.round(x) + sprite.xOffset;
  const spriteY = Math.round(y) + sprite.yOffset;

  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;

  drawRecordPlayerVinyl(ctx, spriteX, spriteY);
  if (playing) {
    drawRecordPlayerVinylMotion(ctx, spriteX, spriteY, frame);
  }
  drawTableSprite(ctx, spriteX, spriteY, sprite.palette, sprite.rows);
  drawPixelRect(ctx, spriteX + 13, spriteY + 25, 15, 1, "#111827");
  drawRecordPlayerIndicator(ctx, spriteX, spriteY, playing);

  if (playing) {
    drawRecordPlayerNotes(ctx, x, y, frame);
  }

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.lineWidth = 1;
    ctx.strokeRect(spriteX, spriteY, sprite.width, sprite.height);
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
  artwork?: AivatarPaintingArtwork,
  artworkProgress = 1,
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
  if (artwork && ghost === "none") {
    drawGeneratedPainting(
      ctx,
      artwork,
      canvasX + 6,
      canvasY + 3,
      artworkProgress,
    );
  } else {
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
  }
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
  skinId?: string,
) => {
  ctx.save();
  if (ghost !== "none") ctx.globalAlpha = 0.62;
  const baseX = Math.round(x);
  const baseY = Math.round(y);
  const active =
    ghost === "none" &&
    (avatar?.behavior === "coding" || avatar?.behavior === "thinking") &&
    Math.hypot(avatar.x - baseX, avatar.y - (baseY + 18)) < 92;
  const blink = Math.floor(frame / 7) % 4;
  const tap = Math.floor(frame / 4) % 2;
  const resolvedSkinId = terminalMonitorSkinId(skinId);
  const sprite = terminalMonitorSpriteForSkinId(resolvedSkinId);
  const animationPalette = terminalMonitorAnimationPalette(resolvedSkinId);
  const spriteX = baseX + TERMINAL_MONITOR_SPRITE_X_OFFSET;
  const spriteY = baseY + TERMINAL_MONITOR_SPRITE_Y_OFFSET;
  const screenX = spriteX + 9;
  const screenY = spriteY + 7;
  const screenWidth = 24;
  const screenHeight = 16;

  drawTableSprite(
    ctx,
    spriteX,
    spriteY,
    sprite.palette,
    sprite.rows,
  );

  if (ghost === "invalid") {
    drawPixelRect(ctx, screenX, screenY, screenWidth, screenHeight, "rgba(255, 143, 163, 0.58)");
    drawPixelRect(ctx, screenX + 1, screenY + 1, screenWidth - 2, 2, "rgba(255, 224, 232, 0.72)");
  }

  if (active) {
    drawPixelRect(ctx, screenX + 1, screenY + 1, screenWidth - 2, 1, animationPalette.screenTop);
    drawPixelRect(ctx, screenX + 2, screenY + 4, 9 + blink, 1, animationPalette.line);
    drawPixelRect(ctx, screenX + 2, screenY + 8, 8, 1, animationPalette.line);
    drawPixelRect(ctx, screenX + 13, screenY + 8, 7 - (blink === 3 ? 3 : 0), 1, animationPalette.alt);
    drawPixelRect(ctx, screenX + 2, screenY + 12, 7, 1, animationPalette.lineSoft);
    drawPixelRect(ctx, screenX + 12, screenY + 12, 8, 1, animationPalette.line);
    drawPixelRect(ctx, screenX + 1, screenY + 2 + blink * 3, screenWidth - 2, 1, animationPalette.scanline);
    drawPixelRect(ctx, screenX + 18 + blink, screenY + 12, 2, 2, animationPalette.cursor);
    drawPixelRect(
      ctx,
      spriteX + 35,
      spriteY + 27,
      2,
      2,
      blink % 2 === 0 ? animationPalette.indicatorA : animationPalette.indicatorB,
    );

    const keyPoints = [
      [7, 37],
      [12, 37],
      [17, 37],
      [22, 37],
      [27, 37],
      [32, 37],
      [8, 41],
      [14, 41],
      [20, 41],
      [26, 41],
      [32, 41],
    ] as const;

    for (let index = 0; index < keyPoints.length; index += 1) {
      const [keyX, keyY] = keyPoints[index];
      const keyActive = (index + tap + frame) % 5 === 0;
      if (!keyActive) continue;
      drawPixelRect(ctx, spriteX + keyX, spriteY + keyY + 1, 3, 1, animationPalette.keyShadow);
      drawPixelRect(ctx, spriteX + keyX, spriteY + keyY, 3, 2, animationPalette.keyTop);
    }
  }

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 21, baseY - 35, 42, 50);
  }

  ctx.restore();
};

const COFFEE_MACHINE_SPRITE_PALETTE: Record<string, string> = {
  "0": "#44565c",
  "1": "#161618",
  "2": "#0d0d0f",
  "3": "#090b0e",
  "4": "#0f1014",
  "5": "#080709",
  "6": "#282c33",
  "7": "#2e3138",
  "8": "#373a41",
  "9": "#32353d",
  a: "#6c6560",
  b: "#1e2129",
  c: "#22242b",
  d: "#1a1e25",
  e: "#13151a",
  f: "#424144",
  g: "#1e1e22",
  h: "#35363c",
  i: "#80887e",
  j: "#5b4130",
  k: "#312219",
  l: "#060404",
  m: "#000001",
  n: "#171a20",
  o: "#191b22",
  p: "#a2cdc2",
  q: "#020304",
  r: "#33363e",
  s: "#1e4049",
  t: "#1f232b",
  u: "#ffffff",
};

const COFFEE_MACHINE_SPRITE_ROWS = [
  "...........012342555335555543556..........................",
  "..........71809a0b6cccc66c6a7dce1.........................",
  "..........fgghghhgggggggggg7ggg1c.........................",
  "...........02afaihhhfh7ffhhifjh4..........................",
  "...........74ifajkjkkkkkhkkahaf2..........................",
  "............gfjkkjkkjkkkkkjkkkhc..........................",
  ".............lkjkkjjjkkkkkkkj1g...........................",
  "..............5kkk252kk221kk56............................",
  "...fmlllllll32nb80dodood4cfe3545llllllllllllllllllll5mmc..",
  "..mf0ee111111egc7hcbccccgchgoeeee11111111e11111111e12g0hm.",
  ".60apa0f00000ffff8fffffffffffffffff00fffffff00f00000aipahc",
  ".qai6i0r88888888888888888888888888888888888888888888iacaaq",
  ".l3gn3322222222222222222222222222222222223ml55555555ll35q5",
  ".m0ii0000000000000000000000000000000000008qb767766666767ol",
  ".m70r8rrrr8rr88888rrrrrrrrr88rr88r88888887mnbddoddooddobel",
  ".m609rr99999rrrrrrr999rr999rrrrrrrrrrrrr87mneq5qq55q55qnel",
  ".m709rrr9999r9999r9999rrrrrrr99rrrrrrrr9r7q2s0000000000s25",
  ".m709rrr99999999rr9999rr99999999rrrrrrrrr7q2sipp0pp0ppis55",
  ".m709rrrrrrrr9999999999rr99rrrrrr9999rrrr7q2spppippippps55",
  ".m709rrrrrr9r9999999rrrrr9rrrrrr99rrrrr9r7q4s0ss0ss0ss0s25",
  ".m709rrrrr99r99rr999999rr9rrrrr999rrrrrrr7monl55555555loel",
  ".m6099rrrrrrrrrrrrrrr99rrrrrrrrr9r99rrrr87mnttttttttttbcel",
  ".m609rrrrrrrrrrrrrrrr9rrrrrrrrrrrrrrrrrr87mon5333bo5335oel",
  ".m607rrrrrrrrrrrrr9rrrr9rrrrrrrrrrrrrrrr87q20ppppespppp055",
  ".mfif8r8888rrr888rrr8rrrrr8888r8rrrr888887q50pppp4spppp0l5",
  ".mfa87777777777777777777777777777767677776q1sssssntsssss4l",
  ".q4d4eeeeeeeeeeeeee444444444e44eeeeeeeeeeemdg5222to2222gel",
  ".4lq3qqqqqqqqqmqml2411n11111111125mqqqqqqqmeoddddnnddddo2l",
  "..148eeeeeeeeeeeqc0iiiiiiiiiiiii0cm4444442ml555555555555q5",
  "..ln0cbbbbbbbbbtmfippp.uuppppiipa8m4444442mdcbcccccccctcel",
  "..ln0cbbbbbbbbbtmfiuup...ppppiipifmnnnnnnemnha24cttttttcel",
  "..ln0cbtbbbbbbbb4cfaafm0af000fh08g4nnnnnoemohjnd6cccccc6el",
  "..ln0cbtbbbbbbbbceqm1h02mf76gggmm2dnnnnnoem4e4nneeeeeeen2l",
  "..5n0cbbbbbbbbbbbcbqapu..upiiialednnnnnnoem3235555555555l5",
  "..3o06ttttttttttttdqappppppiaaam4oooonnnoem7rtccccccccc6el",
  ".c55g122222222222gdm2fiiiia00fhm4dnnnnnnonm67bcn3qmmd6tcel",
  "gkjajjjjjjjjjjjjjkgii0ggg435552enonnnnnnnem67b44maaan36cel",
  "1kjajjjjjjjjjjjjjkkpifmaiaaaa6mdonnnnoonoem67tmgifhf0h4tel",
  "1kjjjjkjkkkkkkkkk1gf6c8p.piip0mdnnnnnnnnoem67tq1a1mma0mbel",
  "kkkkkkkkkkkkkkkk2odqmcpia0f0pamdonnnnnnnoem67tq2jcela0mbel",
  ".122k11111bttttbtbbc5hpi0mm4p0ldoonnnnnnonm67cqkakema0mbel",
  "..5n0cbttbbbbbbbbbbdbgklqnnnk1nnooonnnnnonm67tqkjk4ma0mtel",
  "..ln0cbbbbbbbbbbbbbtcbjkndogjgddonnnnnnnoem67tq1jc4ma0mtel",
  "..ln0cdbbbbbbbbbbbd4qqjkmmmlj5mqednnnnnnoem67cqkak4ma0mbel",
  "..ln0cbbbbbbbbbbbne4ffjjffffjjfjg4onnnnnonm69cqjij4ma0mbel",
  "..ln0cbtbbbbbbbbt32.ppaippppjpppa1nnnnnnoem69cqjik4ma0mbel",
  "..ln0cbttbbbbbbbc51pakkkkkkkjkjappmeonnnoem67cqjik4ma0mbel",
  "..ln0cbbtbbbbbbbt51ipuuuuuuuppi5aimeonnnoem69cqkjk4qa0mtel",
  "..ln0tdbbbbbbbbdt51ip.uuppppiiimaimeonnnnem69cqkakmmaamtnl",
  "..lo06tcccccccttc31ip.upppppiiiajj4ndddddnm69cmka2gaa8mbel",
  "..54he43333333333mmkip.pppppiiaj2m35555532m69te1klg0ce4tel",
  "..2q5gc8hhhhhh88hfh4japppppiiaj3cfhhhhhhg4m69t6d323q3e66el",
  "..236ii000000aaa0a0bmkiipiiiijmnfa0000000fm69tcc66666ctcel",
  ".2m5caiaaaaaaaaaaaaafckkkkkk1g7aaaaaaaaa08m69tccccccccccel",
  ".mfabiifffffffffffff7b4444444g6fffffffff0fm6rcccccccccc6el",
  ".m0inf0aaaaaaaaaaaaaaaiiaiiiiiaaaaaaaaaaf6mc6odddddddddb4l",
  ".m0al22444444444444444222242224444444444225244222222222455",
  ".m0it666666666666666666666666666666c6666cc6c66ccccccccc6nl",
  ".mcfodddbddddddddddddddddddddddddddddddddddddddddoooooon35",
  ".gc423533333333333333333333333333333333333333333555553254g",
  "..74m544444m52222222222222222222222222222222245m422245m2g.",
  "....2bccccc4g.................................g1tbbbto2f..",
  ".....cqlll20...................................f5llll1....",
] as const;

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
  const spriteX = baseX - 31;
  const spriteY = baseY - 48;

  for (let rowIndex = 0; rowIndex < COFFEE_MACHINE_SPRITE_ROWS.length; rowIndex += 1) {
    const row = COFFEE_MACHINE_SPRITE_ROWS[rowIndex];
    let runColor: string | null = null;
    let runStart = 0;

    for (let column = 0; column <= row.length; column += 1) {
      const token = column < row.length ? row.charAt(column) : ".";
      const color = token === "." ? null : COFFEE_MACHINE_SPRITE_PALETTE[token] ?? null;

      if (color === runColor) continue;

      if (runColor) {
        drawPixelRect(ctx, spriteX + runStart, spriteY + rowIndex, column - runStart, 1, runColor);
      }

      runColor = color;
      runStart = column;
    }
  }

  if (brewing) {
    const pulseOn = Math.floor(frame / 6) % 2 === 0;
    const beanPhase = Math.floor(frame / 5) % 4;
    const dripPhase = frame % 12;
    const steamPhase = Math.floor(frame / 4) % 3;
    const streamHeight = 5 + Math.floor(dripPhase / 3);
    const displayGlow = pulseOn ? "#ffffff" : "#a2cdc2";
    const tubeGlow = pulseOn ? "#ffba31" : "#a96a31";

    drawPixelRect(ctx, spriteX + 19 + beanPhase * 3, spriteY + 4 + (beanPhase % 2), 2, 1, "#a96a31");
    drawPixelRect(ctx, spriteX + 34 - beanPhase * 2, spriteY + 5 - (beanPhase % 2), 2, 1, "#c47a32");
    drawPixelRect(ctx, spriteX + 45, spriteY + 17, 3, 2, displayGlow);
    drawPixelRect(ctx, spriteX + 50, spriteY + 17, 2, 2, displayGlow);
    drawPixelRect(ctx, spriteX + 45, spriteY + 34, 2, 2, pulseOn ? "#fff7c2" : "#6c6560");
    drawPixelRect(ctx, spriteX + 48, spriteY + 40, 2, 9, tubeGlow);
    drawPixelRect(ctx, spriteX + 49, spriteY + 47 + (dripPhase % 2), 1, 2, "#ffd36a");
    drawPixelRect(ctx, spriteX + 30, spriteY + 38, 2, streamHeight, "#5b4130");
    drawPixelRect(ctx, spriteX + 31, spriteY + 38, 1, Math.max(3, streamHeight - 1), "#c47a32");
    if (dripPhase > 7) {
      drawPixelRect(ctx, spriteX + 30, spriteY + 45, 2, 2, "#c47a32");
    }
    drawPixelRect(ctx, spriteX + 26 + steamPhase, spriteY + 34, 1, 3, "#ffffff");
    drawPixelRect(ctx, spriteX + 37 - (steamPhase % 2), spriteY + 35, 1, 2, "#a2cdc2");
    drawPixelRect(ctx, spriteX + 29, spriteY + 47, 8, 2, "#5b4130");
  }

  if (ghost !== "none") {
    ctx.strokeStyle = ghost === "valid" ? "#ffe66d" : "#ff5c7a";
    ctx.strokeRect(baseX - 31, baseY - 48, 58, 63);
  }

  ctx.restore();
};

const drawCoffeeCupSteam = (
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  frame: number,
) => {
  const steamLines = [
    {
      x: -4,
      delay: 0,
      speed: 0.9,
      sway: 1.2,
      phaseOffset: 0.2,
      segments: [
        { x: 0, y: -22, height: 3, drift: 0 },
        { x: 1, y: -26, height: 3, drift: 0.6 },
        { x: 0, y: -30, height: 2, drift: 1.1 },
      ],
    },
    {
      x: 1,
      delay: 18,
      speed: 1,
      sway: 1.5,
      phaseOffset: 1.6,
      segments: [
        { x: 0, y: -21, height: 4, drift: 0 },
        { x: -1, y: -25, height: 3, drift: 0.5 },
        { x: 0, y: -29, height: 2, drift: 1.1 },
      ],
    },
    {
      x: 5,
      delay: 36,
      speed: 0.82,
      sway: 1.1,
      phaseOffset: 2.7,
      segments: [
        { x: 0, y: -23, height: 3, drift: 0 },
        { x: 1, y: -27, height: 3, drift: 0.7 },
        { x: 0, y: -31, height: 2, drift: 1.2 },
      ],
    },
  ];

  for (const line of steamLines) {
    const phase = ((frame * line.speed + line.delay) % 120) / 120;
    const rise = Math.round(phase * 3);
    const lineSway = Math.round(Math.sin(phase * Math.PI * 2 + line.phaseOffset) * line.sway);

    line.segments.forEach((segment, segmentIndex) => {
      const segmentPhase = Math.min(1, Math.max(0, phase * 1.4 - segmentIndex * 0.22));
      if (segmentPhase <= 0 || segmentPhase >= 1) return;

      const segmentSway = Math.round(
        Math.sin(segmentPhase * Math.PI * 2 + line.phaseOffset + segment.drift) * 0.8,
      );
      const segmentRise = rise + Math.round(segmentPhase * 2);
      const fadeIn = Math.min(1, segmentPhase / 0.24);
      const fadeOut = Math.min(1, (1 - segmentPhase) / 0.36);
      const segmentAlpha = Math.max(
        0.08,
        0.18 + 0.44 * Math.min(fadeIn, fadeOut) - segmentIndex * 0.08,
      );

      drawPixelRect(
        ctx,
        baseX + line.x + segment.x + lineSway + segmentSway,
        baseY + segment.y - segmentRise,
        1,
        segment.height,
        `rgba(230, 235, 235, ${segmentAlpha})`,
      );
    });
  }
};

const drawCoffeeCup = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ghost: "none" | "valid" | "invalid" = "none",
  hasCoffee = false,
  frame = 0,
) => {
  drawSmallItemSprite(ctx, hasCoffee ? "coffee-cup-filled" : "coffee-cup-empty", x, y, ghost);

  if (hasCoffee && ghost === "none") {
    drawCoffeeCupSteam(ctx, Math.round(x), Math.round(y), frame);
  }
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
  skinId?: string,
  paintingArtwork?: AivatarPaintingArtwork,
  paintingProgress = 1,
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
      drawPoster(ctx, x, y, ghost, paintingArtwork, paintingProgress);
      return;
    case "sky-sentinel-poster":
      if (paintingArtwork) {
        drawPoster(ctx, x, y, ghost, paintingArtwork, paintingProgress);
        return;
      }
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
      drawOilEasel(ctx, x, y, ghost, frame, avatar, paintingArtwork, paintingProgress);
      return;
    case "terminal-monitor":
      drawTerminalMonitor(ctx, x, y, ghost, frame, avatar, skinId);
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
  paintingGallery?: AivatarPaintingGallery,
) => {
  const definition = content.itemDefinitions.find((candidate) => candidate.id === item.itemId);
  if (!definition) return;
  const gallery = normalizePaintingGallery(paintingGallery);
  const activeDraft =
    item.itemId === "oil-easel" &&
    gallery.activeDraft &&
    (!gallery.activeDraft.easelItemId || gallery.activeDraft.easelItemId === item.id)
      ? gallery.activeDraft
      : undefined;
  const placedArtwork = paintingArtworkById(gallery, item.artworkId);
  const paintingArtwork = activeDraft?.artwork ?? placedArtwork;
  const paintingProgress = activeDraft ? paintingProgressRatio(activeDraft) : 1;
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
        item.skinId,
        paintingArtwork,
        paintingProgress,
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
      item.skinId,
      paintingArtwork,
      paintingProgress,
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
  paintingGallery?: AivatarPaintingGallery,
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
        paintingGallery,
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

const clipToRects = (
  ctx: CanvasRenderingContext2D,
  rects: Array<{ x: number; y: number; width: number; height: number }>,
) => {
  ctx.beginPath();
  rects.forEach((rect) => {
    ctx.rect(
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height),
    );
  });
  ctx.clip();
};

const drawPlacedItemsInFrontOfForegroundFurniture = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  foregroundFurniture: FurnitureDefinition[],
  frame: number,
  avatar: AvatarRuntime,
  selectedPlacedItemId?: string | null,
  placementPreview?: PlacementPreview | null,
  activeInteraction?: FurnitureInteractionState | null,
  tableCoffeeQuantity = 0,
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
      const clipRects = placedItemFurnitureOverlayClipRects(
        item,
        definition,
        content,
        foregroundFurniture,
      );
      if (clipRects.length === 0) return;

      ctx.save();
      clipToRects(ctx, clipRects);
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
      ctx.restore();
    });

  if (
    !placementPreview ||
    getItemPlacementKind(placementPreview.item) === "wall" ||
    foregroundFurniture.some((furniture) =>
      isPreviewOnSurface(placementPreview, furniture),
    )
  ) {
    return;
  }

  const previewItem: PlacedItem = {
    id: "__placement-preview__",
    itemId: placementPreview.item.id,
    x: placementPreview.x,
    y: placementPreview.y,
  };
  const clipRects = placedItemFurnitureOverlayClipRects(
    previewItem,
    placementPreview.item,
    content,
    foregroundFurniture,
  );
  if (clipRects.length === 0) return;

  ctx.save();
  clipToRects(ctx, clipRects);
  drawPlaceableItem(
    ctx,
    placementPreview.item.id,
    placementPreview.x,
    placementPreview.y,
    placementPreview.valid ? "valid" : "invalid",
    frame,
    avatar,
  );
  ctx.restore();
};

const drawWallPlacedItems = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  frame: number,
  avatar: AvatarRuntime,
  selectedPlacedItemId?: string | null,
  preview?: PlacementPreview | null,
  paintingGallery?: AivatarPaintingGallery,
) => {
  (content.placedItems ?? [])
    .filter((item) => isWallPlacedItem(content, item))
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .forEach((item) => {
      drawPlacedItem(
        ctx,
        item,
        content,
        frame,
        avatar,
        undefined,
        undefined,
        false,
        0,
        0,
        paintingGallery,
      );
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
  paintingGallery?: AivatarPaintingGallery,
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
        0,
        0,
        paintingGallery,
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
) => {
  if (!preview) return false;
  if (surface.id === "file-cabinet") {
    return (
      preview.x >= surface.x + 2 &&
      preview.x <= surface.x + surface.width - 2 &&
      preview.y >= surface.y - 10 &&
      preview.y <= surface.y + 18
    );
  }

  return (
    (surface.id === "desk" || surface.id === "table") &&
    preview.x >= surface.x &&
    preview.x <= surface.x + surface.width &&
    preview.y >= surface.y - 4 &&
    preview.y <= surface.y + 28
  );
};

const drawWoodFloor = (
  ctx: CanvasRenderingContext2D,
  surface: RoomSurfaceDefinition,
) => {
  const palette = surface.palette;
  const sprite = FLOOR_SURFACE_SPRITE_DATA[surface.id];

  drawPixelRect(ctx, 70, 128, 340, 184, palette.border);
  if (sprite) {
    drawPixelRect(ctx, 76, 132, FLOOR_SURFACE_SPRITE_WIDTH, FLOOR_SURFACE_SPRITE_HEIGHT, palette.base);
    drawTableSprite(ctx, 76, 132, sprite.palette, sprite.rows);
    return;
  }

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

const drawRoomDoor = (ctx: CanvasRenderingContext2D, frame: number) => {
  const pulse = Math.floor(frame / 18) % 2;
  drawPixelRect(ctx, ROOM_DOOR_RECT.x, 306, ROOM_DOOR_RECT.width, 5, "#4d1a2a");
  drawPixelRect(ctx, ROOM_DOOR_RECT.x + 5, 304, ROOM_DOOR_RECT.width - 10, 9, "#ff5c7a");
  drawPixelRect(ctx, ROOM_DOOR_RECT.x + 8, 306, ROOM_DOOR_RECT.width - 16, 4, "#ff9ab0");
  drawPixelRect(ctx, ROOM_DOOR_RECT.x + 12, 310, ROOM_DOOR_RECT.width - 24, 2, "#b62c55");
  if (pulse === 0) {
    drawPixelRect(ctx, ROOM_DOOR_RECT.x + 15, 305, 12, 1, "#ffd1dc");
    drawPixelRect(ctx, ROOM_DOOR_RECT.x + ROOM_DOOR_RECT.width - 27, 305, 12, 1, "#ffd1dc");
  }
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
    return [
      {
        x: item.x + FILE_CABINET_SPRITE_X_OFFSET,
        y: item.y + FILE_CABINET_SPRITE_Y_OFFSET,
        width: FILE_CABINET_SPRITE_WIDTH,
        height: FILE_CABINET_SPRITE_HEIGHT,
      },
    ];
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
  if (surface.id === "gray-tech-floor" && !FLOOR_SURFACE_SPRITE_DATA[surface.id]) {
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
  if (FLOOR_SURFACE_SPRITE_DATA[surface.id]) {
    drawWoodFloor(ctx, surface);
    return;
  }

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
  const sprite = WALL_SURFACE_SPRITE_DATA[surface.id];
  if (sprite) {
    drawPixelRect(ctx, 70, 14, 340, 120, surface.palette.border);
    drawPixelRect(ctx, 76, 20, WALL_SURFACE_SPRITE_WIDTH, WALL_SURFACE_SPRITE_HEIGHT, surface.palette.base);
    drawTableSprite(ctx, 76, 20, sprite.palette, sprite.rows);
    return;
  }

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
  const shipNightAmount =
    hour >= 18.2
      ? smoothRange(hour, 18.2, 19.4)
      : hour < 5.4
        ? 1 - smoothRange(hour, 4.6, 5.4)
        : 0;
  const shipTone = (dayColor: string, nightColor: string) =>
    mixColor(dayColor, nightColor, shipNightAmount);

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
  const drawShipLight = (
    lightX: number,
    lightY: number,
    lightWidth = 1,
    haloColor = "#d88b2f",
  ) => {
    drawShipRect(lightX - 1, lightY, lightWidth + 2, 1, haloColor);
    drawShipRect(lightX, lightY, lightWidth, 1, "#ffe28a");
    if (shipNightAmount > 0.45) {
      drawShipRect(lightX, lightY - 1, Math.max(1, lightWidth - 1), 1, "#fff7c2");
    }
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
    drawShipRect(boatX - 10, boatY + 5, 20, 2, shipTone("#13243c", "#06101f"));
    drawShipRect(boatX - 12, boatY + 2, 24, 4, shipTone("#37536b", "#152139"));
    drawShipRect(boatX - 9, boatY, 18, 2, shipTone("#d9553d", "#5a2430"));
    drawShipRect(boatX - 7, boatY - 2, 5, 2, shipTone("#f0b13f", "#5f4522"));
    drawShipRect(boatX - 1, boatY - 2, 5, 2, shipTone("#5fb1d4", "#203d58"));
    drawShipRect(boatX + 5, boatY - 2, 5, 2, shipTone("#e7d15d", "#66582a"));
    drawShipRect(bridgeX - 3, boatY - 6, 7, 4, shipTone("#e8f1f2", "#233049"));
    drawShipRect(bridgeX + direction * 4, boatY - 8, 2, 6, shipTone("#33475e", "#101b2d"));
    drawShipRect(bridgeX - 2, boatY - 5, 2, 1, shipTone("#6fb7d8", "#1b3450"));
    drawShipRect(bridgeX + 2, boatY - 5, 2, 1, shipTone("#6fb7d8", "#1b3450"));
    if (shipLightsOn) {
      drawShipLight(boatX - 6, boatY + 3, 2);
      drawShipLight(boatX + 1, boatY + 3, 2);
      drawShipLight(bridgeX - 1, boatY - 5);
      drawShipLight(bridgeX + 2, boatY - 5);
      drawShipRect(boatX - 7, boatY + 8, 4, 1, "#b8893f");
      drawShipRect(boatX, boatY + 8, 4, 1, "#b8893f");
    }
    drawShipRect(boatX - 10, boatY + 10, 20, 1, shipTone("#d8fff7", "#294365"));
  };

  const drawDistantCargoShip = (
    boatX: number,
    boatY: number,
    direction: -1 | 1,
  ) => {
    const bridgeX = boatX - direction * 3;
    drawShipRect(boatX - 7, boatY + 3, 14, 1, shipTone("#172743", "#071225"));
    drawShipRect(boatX - 8, boatY + 1, 16, 3, shipTone("#415f73", "#152238"));
    drawShipRect(boatX - 5, boatY, 10, 1, shipTone("#c9563d", "#552231"));
    drawShipRect(boatX - 4, boatY - 1, 3, 1, shipTone("#e2b24c", "#5d4622"));
    drawShipRect(boatX, boatY - 1, 3, 1, shipTone("#73b8cd", "#20394f"));
    drawShipRect(bridgeX - 2, boatY - 3, 5, 2, shipTone("#d7e7ea", "#202d44"));
    drawShipRect(bridgeX + direction * 3, boatY - 4, 1, 3, shipTone("#3f5264", "#111d2f"));
    if (shipLightsOn) {
      drawShipLight(boatX - 3, boatY + 2);
      drawShipLight(boatX + 3, boatY + 2);
      drawShipLight(bridgeX, boatY - 2);
      drawShipRect(boatX - 4, boatY + 5, 3, 1, "#a87835");
      drawShipRect(boatX + 2, boatY + 5, 3, 1, "#a87835");
    }
    drawShipRect(boatX - 7, boatY + 6, 14, 1, shipTone(softReflectionColor, "#24395d"));
  };

  const drawCruiseShip = (
    boatX: number,
    boatY: number,
    direction: -1 | 1,
  ) => {
    const bowX = boatX + direction * 10;
    drawShipRect(boatX - 10, boatY + 5, 20, 2, shipTone("#16314f", "#061427"));
    drawShipRect(boatX - 12, boatY + 2, 24, 4, shipTone("#f1f6f7", "#1b2a41"));
    drawShipRect(boatX - 9, boatY, 18, 2, shipTone("#e0edf2", "#21334d"));
    drawShipRect(boatX - 6, boatY - 3, 13, 3, shipTone("#f7fbfb", "#263955"));
    drawShipRect(boatX - 4, boatY - 6, 6, 2, shipTone("#36506a", "#101c31"));
    drawShipRect(bowX - direction * 2, boatY + 1, 3, 1, shipTone("#f1f6f7", "#1b2a41"));
    for (let dot = -7; dot <= 7; dot += 4) {
      drawShipRect(boatX + dot, boatY + 1, 2, 1, shipTone("#4fa3c7", "#17324f"));
      drawShipRect(boatX + dot, boatY - 2, 2, 1, shipTone("#4fa3c7", "#17324f"));
    }
    if (shipLightsOn) {
      for (let dot = -7; dot <= 7; dot += 4) {
        drawShipLight(boatX + dot, boatY + 1);
        drawShipLight(boatX + dot, boatY - 2, 1, "#e09a3d");
      }
      drawShipRect(boatX - 9, boatY + 8, 18, 1, "#b8893f");
    }
    drawShipRect(boatX - 10, boatY + 10, 20, 1, shipTone("#d8fff7", "#294365"));
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
  const beaconActive = isDusk || trafficLightsOn;

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

  const drawRoofBeacon = (beaconX: number, beaconY: number, index: number, depth: number) => {
    if (!beaconActive) return;

    const breath = smoothstep((Math.sin(animationFrame / 58 + index * 1.37) + 1) / 2);
    const coreAlpha = 0.34 + breath * 0.62;
    const haloAlpha = (0.12 + breath * 0.3) * (0.78 + depth * 0.22);
    const hotColor = breath > 0.72 ? "#ff7a42" : "#ff3b45";

    drawPixelWithAlpha(ctx, beaconX - 1, beaconY, 4, 1, "#8a1d2e", haloAlpha);
    drawPixelWithAlpha(ctx, beaconX, beaconY, 2, 2, hotColor, coreAlpha);
    if (breath > 0.62) {
      drawPixelWithAlpha(ctx, beaconX, beaconY - 1, 1, 1, "#ffd0a0", (breath - 0.62) * 1.9);
    }
  };

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

    const autoBeacon =
      tower.height >= 0.68 ||
      (depth >= 0.62 && tower.height >= 0.52 && tower.crown !== "flat") ||
      (depth >= 0.82 && tower.height >= 0.42 && index % 2 === 0);
    if (tower.beacon || autoBeacon) {
      const beaconTopOffset =
        tower.crown === "fork"
          ? 9
          : tower.crown === "needle" || tower.spire
            ? (tower.spire ?? 9) + 2
            : 3;
      drawRoofBeacon(
        upperX + Math.floor(upperWidth / 2),
        towerY - beaconTopOffset,
        index,
        depth,
      );
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
    const pulse = smoothstep((Math.sin(animationFrame / 28) + 1) / 2);
    const scanY = signY + (Math.floor(animationFrame / 3) % signHeight);
    const neonAlpha = trafficLightsOn || isDusk ? 0.72 + pulse * 0.28 : 0.26;

    drawPixelWithAlpha(ctx, signX, signY, signWidth, signHeight, "#10091f", 0.92);
    drawPixelWithAlpha(ctx, signX - 1, signY + 1, 1, signHeight - 2, "#4b164b", neonAlpha * 0.45);
    drawPixelWithAlpha(ctx, signX, signY, 1, signHeight, "#ff4fd8", neonAlpha);
    drawPixelWithAlpha(ctx, signX + signWidth - 1, signY, 1, signHeight, "#33f4ff", neonAlpha);
    drawPixelWithAlpha(ctx, signX + 1, signY, signWidth - 2, 1, "#9d6bff", neonAlpha * 0.78);
    drawPixelWithAlpha(ctx, signX + 1, signY + signHeight - 1, signWidth - 2, 1, "#ff9d3f", neonAlpha * 0.76);
    drawPixelWithAlpha(ctx, signX + 1, scanY, signWidth - 2, 1, "#fff0a8", neonAlpha);

    for (let dash = 3; dash < signHeight - 2; dash += 5) {
      const dashOn = Math.floor(animationFrame / 44 + dash / 5) % 2 === 0;
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
  drawRoomDoor(ctx, frame);

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

const visitorIdleStatus = (visitor: AivatarRoomVisitor): CodexStatusMessage => ({
  agent: "aivatar",
  sessionId: visitor.visitId,
  status: "idle",
  phase: "visit",
  task: `${visitor.avatarName} is visiting`,
  timestamp: new Date().toISOString(),
});

const drawVisitorBubble = (
  ctx: CanvasRenderingContext2D,
  visitor: AivatarRoomVisitor,
  uiTheme: UiThemeId,
) => {
  if (!visitor.bubbleText) return;
  drawAvatarBubble(
    ctx,
    visitor.runtime,
    {
      kind: "none",
      furnitureId: `visitor-${visitor.avatarId}`,
      furnitureName: visitor.avatarName,
      message: visitor.bubbleText,
      startedAt: performance.now(),
      bubbleText: visitor.bubbleText,
    },
    uiTheme,
  );
};

const avatarDepthY = (runtime: AvatarRuntime) => runtime.y + 12;

const createAvatarRenderLayers = (
  avatar: AvatarRuntime,
  visitors: AivatarRoomVisitor[],
  primaryAvatarVisible: boolean,
) => {
  const layers: AvatarRenderLayer[] = [];

  if (primaryAvatarVisible) {
    layers.push({ kind: "primary", y: avatarDepthY(avatar), runtime: avatar });
  }

  visitors.forEach((visitor) => {
    layers.push({
      kind: "visitor",
      y: avatarDepthY(visitor.runtime),
      runtime: visitor.runtime,
      visitor,
    });
  });

  return layers.sort(
    (left, right) =>
      left.y - right.y ||
      left.runtime.x - right.runtime.x ||
      left.kind.localeCompare(right.kind),
  );
};

const drawAvatarRenderLayer = (
  ctx: CanvasRenderingContext2D,
  layer: AvatarRenderLayer,
  content: AivatarContent,
  frame: number,
  status: CodexStatusMessage,
  memory: AivatarMemory | undefined,
  avatarAppearanceId: AvatarAppearanceId,
) => {
  if (layer.kind === "primary") {
    drawAvatar(
      ctx,
      layer.runtime,
      frame,
      content.petStats,
      status,
      memory,
      avatarAppearanceId,
    );
    return;
  }

  drawAvatar(
    ctx,
    layer.visitor.runtime,
    frame,
    layer.visitor.petStats,
    visitorIdleStatus(layer.visitor),
    layer.visitor.memory,
    layer.visitor.avatarAppearanceId,
  );
};

const avatarOcclusionClipBounds = (runtime: AvatarRuntime) => ({
  x: Math.round(runtime.x - 44),
  y: Math.round(runtime.y - 68),
  width: 88,
  height: 96,
});

const drawAvatarForegroundOcclusion = (
  ctx: CanvasRenderingContext2D,
  content: AivatarContent,
  layer: AvatarRenderLayer,
  frame: number,
  hoveredFurnitureId?: string | null,
  selectedFurnitureId?: string | null,
  activeInteraction?: FurnitureInteractionState | null,
  placementPreview?: PlacementPreview | null,
  selectedPlacedItemId?: string | null,
  tableCoffeeQuantity = 0,
  taskCabinetFileCount = 0,
  failedTaskCabinetFileCount = 0,
  paintingGallery?: AivatarPaintingGallery,
  activeRecordPlayerId?: string | null,
) => {
  const runtime = layer.runtime;
  const clipBounds = avatarOcclusionClipBounds(runtime);
  const foregroundFurniture = furnitureByDepth(content.room.furniture).filter((item) =>
    isFurnitureInFrontOfAvatar(item, runtime),
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(clipBounds.x, clipBounds.y, clipBounds.width, clipBounds.height);
  ctx.clip();

  drawPlacedItems(
    ctx,
    content,
    frame,
    runtime,
    selectedPlacedItemId,
    null,
    activeInteraction,
    tableCoffeeQuantity,
    taskCabinetFileCount,
    failedTaskCabinetFileCount,
    "in-front-of-avatar",
    paintingGallery,
    activeRecordPlayerId,
  );

  foregroundFurniture.forEach((item) => {
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
      drawBedFootboardAvatarOcclusion(ctx, item, runtime);
      return;
    }

    drawFurniture(
      ctx,
      item,
      highlight,
      frame,
      runtime,
      activeInteraction,
      taskCabinetFileCount,
      failedTaskCabinetFileCount,
    );
    drawPlacedItemsForSurface(
      ctx,
      content,
      item.id,
      frame,
      runtime,
      selectedPlacedItemId,
      activeInteraction,
      tableCoffeeQuantity,
      activeRecordPlayerId,
      paintingGallery,
    );
    if (placementPreview && isPreviewOnSurface(placementPreview, item)) {
      drawPlaceableItem(
        ctx,
        placementPreview.item.id,
        placementPreview.x,
        placementPreview.y,
        placementPreview.valid ? "valid" : "invalid",
        frame,
        runtime,
      );
    }
  });

  drawPlacedItemsInFrontOfForegroundFurniture(
    ctx,
    content,
    foregroundFurniture,
    frame,
    runtime,
    selectedPlacedItemId,
    placementPreview,
    activeInteraction,
    tableCoffeeQuantity,
    activeRecordPlayerId,
  );

  ctx.restore();
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
  paintingGallery?: AivatarPaintingGallery,
  activeRecordPlayerId?: string | null,
  avatarAppearanceId: AvatarAppearanceId = "octopus",
  visitors: AivatarRoomVisitor[] = [],
  primaryAvatarVisible = true,
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
        paintingGallery,
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
    paintingGallery,
    activeRecordPlayerId,
  );
  const avatarLayers = createAvatarRenderLayers(avatar, visitors, primaryAvatarVisible);

  avatarLayers.forEach((layer) => {
    drawAvatarRenderLayer(
      ctx,
      layer,
      content,
      frame,
      status,
      memory,
      avatarAppearanceId,
    );
  });
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
    paintingGallery,
    activeRecordPlayerId,
  );
  const foregroundFurniture = furnitureByDepth(content.room.furniture).filter((item) =>
    isFurnitureInFrontOfAvatar(item, avatar),
  );
  foregroundFurniture.forEach((item) => {
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
      paintingGallery,
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
  drawPlacedItemsInFrontOfForegroundFurniture(
    ctx,
    content,
    foregroundFurniture,
    frame,
    avatar,
    selectedPlacedItemId,
    placementPreview,
    activeInteraction,
    tableCoffeeQuantity,
    activeRecordPlayerId,
  );
  if (visitors.length > 0) {
    avatarLayers.forEach((layer) => {
      drawAvatarRenderLayer(
        ctx,
        layer,
        content,
        frame,
        status,
        memory,
        avatarAppearanceId,
      );
      drawAvatarForegroundOcclusion(
        ctx,
        content,
        layer,
        frame,
        hoveredFurnitureId,
        selectedFurnitureId,
        activeInteraction,
        placementPreview,
        selectedPlacedItemId,
        tableCoffeeQuantity,
        taskCabinetFileCount,
        failedTaskCabinetFileCount,
        paintingGallery,
        activeRecordPlayerId,
      );
    });
  }
  drawFloorLightOverlay(ctx, floorSurface, content, avatar);
  if (primaryAvatarVisible) {
    drawSleepBlanketOverlay(ctx, content, avatar);
    if (status.status === "thinking") {
      drawCodexThinkingBubble(ctx, avatar, status, memory, uiTheme);
    } else if (activeInteraction?.bubbleText) {
      drawAvatarBubble(ctx, avatar, activeInteraction, uiTheme);
    } else {
      drawActivityBubble(ctx, avatar, memory, uiTheme);
    }
  }
  visitors.forEach((visitor) => drawVisitorBubble(ctx, visitor, uiTheme));
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
