import type {
  AivatarMemory,
  AivatarPaintingArtwork,
  AivatarPaintingDraft,
  AivatarPaintingGallery,
  AivatarPaintingPlan,
  GrowthTrait,
} from "../types";

export const PAINTING_PIXEL_WIDTH = 24;
export const PAINTING_PIXEL_HEIGHT = 35;
export const PAINTING_TARGET_SECONDS = 3 * 60 * 60;
export const PAINTING_GALLERY_LIMIT = 12;

const PAINTING_REWARD_RANGES: Record<number, [number, number]> = {
  1: [4, 9],
  2: [8, 16],
  3: [15, 28],
  4: [26, 44],
  5: [40, 72],
};

const TRAIT_ORDER: GrowthTrait[] = [
  "focus",
  "resilience",
  "curiosity",
  "efficiency",
  "creativity",
  "warmth",
];

const PALETTES: Record<GrowthTrait, string[]> = {
  focus: [
    "#101827",
    "#243a55",
    "#426c8f",
    "#88c8dd",
    "#f7fbff",
    "#fff3b0",
    "#34513b",
    "#7fa66d",
    "#d95d75",
    "#1b1024",
  ],
  resilience: [
    "#151924",
    "#283144",
    "#4f5f7d",
    "#8a9fbd",
    "#f4ead2",
    "#e5a64a",
    "#5d4739",
    "#9f6f4d",
    "#66b38f",
    "#241425",
  ],
  curiosity: [
    "#0d1230",
    "#222f68",
    "#4d5bb8",
    "#7fb8ff",
    "#f7fbff",
    "#ffe66d",
    "#1f7a80",
    "#5ce1e6",
    "#d95dff",
    "#080914",
  ],
  efficiency: [
    "#111624",
    "#243040",
    "#52607d",
    "#9ee6ff",
    "#f7fbff",
    "#67ff72",
    "#335642",
    "#a0c46a",
    "#ffb02e",
    "#080b10",
  ],
  creativity: [
    "#180f24",
    "#3b2256",
    "#7d3f98",
    "#ff8fa3",
    "#fff3b0",
    "#5ce1e6",
    "#2f6f4e",
    "#8fbe74",
    "#d95d75",
    "#0b0711",
  ],
  warmth: [
    "#21131a",
    "#54313a",
    "#8f4d48",
    "#d98256",
    "#ffe0a3",
    "#fff7c7",
    "#4f6f45",
    "#a6b86a",
    "#78c4d4",
    "#11080b",
  ],
};

const TITLE_WORDS: Record<GrowthTrait, [string, string]> = {
  focus: ["Quiet", "Signal"],
  resilience: ["Steady", "Harbor"],
  curiosity: ["Little", "Horizon"],
  efficiency: ["Bright", "Circuit"],
  creativity: ["Color", "Bloom"],
  warmth: ["Soft", "Lantern"],
};

type PaintingArchetypeId =
  | "signal_tower"
  | "window_city"
  | "terminal_star_map"
  | "desk_still_life"
  | "harbor_beacon"
  | "mountain_path"
  | "circuit_grid"
  | "mosaic_garden"
  | "color_bloom"
  | "lantern_room";

interface PaintingArchetypeDefinition {
  id: PaintingArchetypeId;
  title: string;
  traits: GrowthTrait[];
  tags: string[];
}

const ARCHETYPES: PaintingArchetypeDefinition[] = [
  {
    id: "signal_tower",
    title: "Quiet Tower",
    traits: ["focus", "efficiency"],
    tags: ["signal", "status", "bridge", "wait", "focus", "idle", "thinking"],
  },
  {
    id: "window_city",
    title: "Window Signal",
    traits: ["focus", "curiosity", "warmth"],
    tags: ["window", "city", "preview", "browser", "night", "view", "room"],
  },
  {
    id: "terminal_star_map",
    title: "Terminal Stars",
    traits: ["focus", "curiosity", "efficiency", "creativity"],
    tags: ["terminal", "codex", "agent", "task", "session", "map", "star", "status"],
  },
  {
    id: "desk_still_life",
    title: "Desk Signal",
    traits: ["focus", "efficiency", "warmth"],
    tags: ["desk", "coffee", "table", "item", "room", "organize", "still"],
  },
  {
    id: "harbor_beacon",
    title: "Steady Beacon",
    traits: ["resilience", "warmth"],
    tags: ["recover", "error", "steady", "repair", "safe", "harbor"],
  },
  {
    id: "mountain_path",
    title: "Little Path",
    traits: ["resilience", "curiosity"],
    tags: ["explore", "path", "route", "learn", "outside", "climb"],
  },
  {
    id: "circuit_grid",
    title: "Bright Circuit",
    traits: ["efficiency", "focus"],
    tags: ["build", "test", "grid", "clean", "fast", "efficient"],
  },
  {
    id: "mosaic_garden",
    title: "Mosaic Garden",
    traits: ["creativity", "warmth", "curiosity"],
    tags: ["color", "garden", "bubble", "new", "idea", "soft"],
  },
  {
    id: "color_bloom",
    title: "Color Bloom",
    traits: ["creativity"],
    tags: ["paint", "art", "creative", "spark", "bloom", "palette"],
  },
  {
    id: "lantern_room",
    title: "Soft Lantern",
    traits: ["warmth", "resilience"],
    tags: ["warm", "care", "sleep", "cozy", "lantern", "heart"],
  },
];

const ARCHETYPES_BY_ID = new Map(ARCHETYPES.map((archetype) => [archetype.id, archetype]));

const ARCHETYPES_BY_TRAIT: Record<GrowthTrait, PaintingArchetypeId[]> = {
  focus: ["signal_tower", "window_city", "terminal_star_map", "desk_still_life"],
  resilience: ["harbor_beacon", "mountain_path", "desk_still_life", "lantern_room"],
  curiosity: ["terminal_star_map", "window_city", "mountain_path", "mosaic_garden"],
  efficiency: ["circuit_grid", "terminal_star_map", "desk_still_life", "signal_tower"],
  creativity: ["color_bloom", "mosaic_garden", "terminal_star_map", "window_city"],
  warmth: ["lantern_room", "desk_still_life", "window_city", "mosaic_garden"],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const compactText = (value: string, maxLength: number) =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const safePlanText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? compactText(value, maxLength) : "";

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
};

const dominantTrait = (memory: AivatarMemory): GrowthTrait =>
  TRAIT_ORDER.reduce((best, trait) =>
    memory.growth.traits[trait] > memory.growth.traits[best] ? trait : best,
  );

const sourceText = (memory: AivatarMemory) => [
  ...memory.recentEvents.slice(0, 6).map((event) => event.summary),
  ...(memory.preferences.idleBubblePhrases ?? []).slice(0, 6),
];

const sourceContext = (memory: AivatarMemory, source: string[]) =>
  [
    ...source,
    memory.preferences.favoriteActivity ?? "",
    memory.preferences.favoriteRecovery ?? "",
    ...memory.recentEvents.slice(0, 6).map((event) =>
      [event.type, event.behavior ?? "", event.itemId ?? ""].join(" "),
    ),
  ]
    .join(" ")
    .toLowerCase();

const archetypeKeywordScore = (
  archetype: PaintingArchetypeDefinition,
  text: string,
) =>
  archetype.tags.reduce(
    (score, tag) => score + (text.includes(tag.toLowerCase()) ? 1 : 0),
    0,
  );

const archetypeFromText = (value: string): PaintingArchetypeId | undefined => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  for (const archetype of ARCHETYPES) {
    if (normalized.includes(archetype.id)) return archetype.id;
    if (
      archetype.tags.some((tag) =>
        normalized.includes(tag.toLowerCase().replace(/[^a-z0-9]+/g, "_")),
      )
    ) {
      return archetype.id;
    }
  }
  return undefined;
};

const choosePaintingArchetype = (
  trait: GrowthTrait,
  memory: AivatarMemory,
  source: string[],
  seed: number,
): PaintingArchetypeId => {
  const text = sourceContext(memory, source);
  const candidates = ARCHETYPES_BY_TRAIT[trait]
    .map((id) => ARCHETYPES_BY_ID.get(id))
    .filter((value): value is PaintingArchetypeDefinition => Boolean(value));
  let best = candidates[0] ?? ARCHETYPES[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const archetype of candidates) {
    const jitter = (hashString(`${seed}:${archetype.id}`) % 1000) / 1000;
    const score =
      archetypeKeywordScore(archetype, text) * 2.4 +
      (archetype.traits.includes(trait) ? 0.5 : 0) +
      jitter;
    if (score > bestScore) {
      best = archetype;
      bestScore = score;
    }
  }

  return best.id;
};

const normalizePaintingPlanValue = (
  value: Partial<AivatarPaintingPlan> | undefined,
  context: {
    trait: GrowthTrait;
    memory: AivatarMemory;
    source: string[];
    seed: number;
  },
): AivatarPaintingPlan => {
  const title = safePlanText(value?.title, 42);
  const combinedPlanText = [
    value?.archetype,
    title,
    value?.mood,
    value?.paletteHint,
    value?.composition?.background,
    value?.composition?.subject,
    value?.composition?.foreground,
    ...(Array.isArray(value?.motifs) ? value.motifs : []),
  ]
    .filter((entry): entry is string => typeof entry === "string")
    .join(" ");
  const archetypeId =
    archetypeFromText(safePlanText(value?.archetype, 80)) ??
    archetypeFromText(combinedPlanText) ??
    choosePaintingArchetype(
      context.trait,
      context.memory,
      context.source,
      context.seed,
    );
  const archetype = ARCHETYPES_BY_ID.get(archetypeId) ?? ARCHETYPES[0];
  const motifs = Array.isArray(value?.motifs)
    ? value.motifs
        .map((motif) => safePlanText(motif, 32))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return {
    title: title || archetype.title,
    archetype: archetype.id,
    mood: safePlanText(value?.mood, 60) || undefined,
    paletteHint: safePlanText(value?.paletteHint, 60) || undefined,
    composition:
      value?.composition && isRecord(value.composition)
        ? {
            background:
              safePlanText(value.composition.background, 60) || undefined,
            subject: safePlanText(value.composition.subject, 60) || undefined,
            foreground:
              safePlanText(value.composition.foreground, 60) || undefined,
            accent: safePlanText(value.composition.accent, 60) || undefined,
          }
        : undefined,
    motifs,
    source: value?.source === "llm" ? "llm" : "heuristic",
  };
};

export const normalizePaintingPlan = (
  value: Partial<AivatarPaintingPlan> | undefined,
  context: {
    trait: GrowthTrait;
    memory: AivatarMemory;
    source: string[];
    seed: number;
  },
) => normalizePaintingPlanValue(value, context);

const setPixel = (grid: number[][], x: number, y: number, color: number) => {
  if (
    x < 0 ||
    y < 0 ||
    y >= PAINTING_PIXEL_HEIGHT ||
    x >= PAINTING_PIXEL_WIDTH
  ) {
    return;
  }
  grid[y][x] = color;
};

const fillRect = (
  grid: number[][],
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
) => {
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      setPixel(grid, x + col, y + row, color);
    }
  }
};

const drawLine = (
  grid: number[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number,
) => {
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;

  while (true) {
    setPixel(grid, x, y, color);
    if (x === x1 && y === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
};

const fillCircle = (
  grid: number[][],
  cx: number,
  cy: number,
  radius: number,
  color: number,
) => {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        setPixel(grid, x, y, color);
      }
    }
  }
};

const strokeRect = (
  grid: number[][],
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
) => {
  drawLine(grid, x, y, x + width - 1, y, color);
  drawLine(grid, x, y + height - 1, x + width - 1, y + height - 1, color);
  drawLine(grid, x, y, x, y + height - 1, color);
  drawLine(grid, x + width - 1, y, x + width - 1, y + height - 1, color);
};

const scatterPixels = (
  grid: number[][],
  random: () => number,
  count: number,
  minY: number,
  maxY: number,
  colors: number[],
) => {
  for (let index = 0; index < count; index += 1) {
    setPixel(
      grid,
      Math.floor(random() * PAINTING_PIXEL_WIDTH),
      minY + Math.floor(random() * Math.max(1, maxY - minY + 1)),
      colors[Math.floor(random() * colors.length)] ?? 4,
    );
  }
};

const drawSignalTower = (grid: number[][], random: () => number) => {
  fillRect(grid, 10, 11, 4, 17, 4);
  fillRect(grid, 11, 9, 2, 21, 5);
  drawLine(grid, 6, 29, 12, 9, 7);
  drawLine(grid, 18, 29, 12, 9, 7);
  drawLine(grid, 7, 18, 17, 18, 3);
  drawLine(grid, 5, 24, 19, 24, 3);
  drawLine(grid, 8, 7, 5, 5, 5);
  drawLine(grid, 16, 7, 19, 5, 5);
  drawLine(grid, 7, 4, 4, 2, 3);
  drawLine(grid, 17, 4, 20, 2, 3);
  fillCircle(grid, 12, 8, 2, 5);
  scatterPixels(grid, random, 8, 3, 14, [3, 4, 5]);
};

const drawWindowCity = (grid: number[][], random: () => number) => {
  fillRect(grid, 3, 5, 18, 20, 1);
  strokeRect(grid, 2, 4, 20, 22, 4);
  drawLine(grid, 12, 5, 12, 25, 3);
  drawLine(grid, 3, 14, 21, 14, 3);
  for (let col = 0; col < 5; col += 1) {
    const x = 4 + col * 3 + Math.floor(random() * 2);
    const height = 4 + Math.floor(random() * 9);
    fillRect(grid, x, 23 - height, 2, height, 6 + (col % 2));
    if (random() > 0.35) setPixel(grid, x, 21 - height, 5);
    setPixel(grid, x + 1, 22 - Math.floor(height / 2), 5);
  }
  fillCircle(grid, 18, 8, 2, 5);
  drawLine(grid, 4, 27, 20, 27, 9);
};

const drawTerminalStarMap = (grid: number[][], random: () => number) => {
  fillRect(grid, 4, 7, 16, 18, 1);
  strokeRect(grid, 3, 6, 18, 20, 4);
  fillRect(grid, 5, 23, 14, 2, 2);
  const points = Array.from({ length: 7 }, () => ({
    x: 6 + Math.floor(random() * 12),
    y: 9 + Math.floor(random() * 10),
  }));
  points.forEach((point, index) => {
    setPixel(grid, point.x, point.y, index % 2 === 0 ? 5 : 7);
    if (index > 0) {
      drawLine(grid, points[index - 1].x, points[index - 1].y, point.x, point.y, 3);
    }
  });
  fillRect(grid, 6, 21, 5, 1, 5);
  fillRect(grid, 12, 21, 2, 1, 7);
  drawLine(grid, 8, 28, 16, 28, 9);
};

const drawDeskStillLife = (grid: number[][], random: () => number) => {
  fillRect(grid, 2, 23, 20, 5, 6);
  drawLine(grid, 2, 23, 21, 23, 4);
  fillRect(grid, 5, 16, 6, 6, 1);
  strokeRect(grid, 4, 15, 8, 8, 4);
  fillRect(grid, 14, 17, 3, 5, 5);
  drawLine(grid, 17, 18, 19, 19, 5);
  fillRect(grid, 13, 22, 7, 2, 7);
  fillRect(grid, 7 + Math.floor(random() * 3), 12, 6, 2, 3);
  scatterPixels(grid, random, 7, 14, 25, [3, 4, 5, 7]);
};

const drawHarborBeacon = (grid: number[][], random: () => number) => {
  fillRect(grid, 9, 11, 5, 15, 4);
  fillRect(grid, 8, 9, 7, 3, 5);
  fillRect(grid, 10, 6, 3, 3, 7);
  drawLine(grid, 10, 7, 2, 11, 5);
  drawLine(grid, 12, 7, 22, 12, 5);
  for (let y = 26; y < 32; y += 2) {
    drawLine(grid, 1, y, 22, y + Math.floor(random() * 2), y % 4 === 0 ? 3 : 7);
  }
};

const drawMountainPath = (grid: number[][], random: () => number) => {
  drawLine(grid, 2, 28, 9, 13, 7);
  drawLine(grid, 9, 13, 15, 28, 7);
  drawLine(grid, 8, 28, 17, 10, 4);
  drawLine(grid, 17, 10, 23, 28, 4);
  for (let y = 30; y >= 18; y -= 3) {
    const center = 12 + Math.floor(random() * 5) - 2;
    fillRect(grid, center, y, 3, 1, 5);
  }
  fillCircle(grid, 18, 6, 2, 5);
};

const drawCircuitGrid = (grid: number[][], random: () => number) => {
  for (let x = 4; x < 21; x += 4) drawLine(grid, x, 8, x, 30, 3);
  for (let y = 10; y < 31; y += 5) drawLine(grid, 3, y, 21, y, 5);
  for (let index = 0; index < 7; index += 1) {
    const x = 4 + Math.floor(random() * 16);
    const y = 9 + Math.floor(random() * 20);
    fillRect(grid, x, y, 3, 3, index % 2 === 0 ? 4 : 7);
  }
};

const drawMosaicGarden = (grid: number[][], random: () => number) => {
  for (let index = 0; index < 12; index += 1) {
    fillCircle(
      grid,
      3 + Math.floor(random() * 18),
      12 + Math.floor(random() * 17),
      1 + Math.floor(random() * 3),
      3 + Math.floor(random() * 5),
    );
  }
  drawLine(grid, 3, 30, 21, 30, 7);
};

const drawColorBloom = (grid: number[][], random: () => number) => {
  const cx = 11 + Math.floor(random() * 3);
  const cy = 19;
  [3, 4, 5, 7, 8].forEach((color, index) => {
    const angle = (index / 5) * Math.PI * 2;
    fillCircle(
      grid,
      cx + Math.round(Math.cos(angle) * 5),
      cy + Math.round(Math.sin(angle) * 5),
      4,
      color,
    );
  });
  fillCircle(grid, cx, cy, 3, 5);
  drawLine(grid, cx, cy + 5, cx - 4, 31, 7);
  drawLine(grid, cx, cy + 5, cx + 4, 31, 7);
};

const drawLanternRoom = (grid: number[][], random: () => number) => {
  fillRect(grid, 5, 9, 14, 16, 2);
  strokeRect(grid, 4, 8, 16, 18, 4);
  fillCircle(grid, 12, 14, 4, 5);
  fillCircle(grid, 12, 14, 2, 4);
  fillRect(grid, 7, 24, 10, 4, 6);
  drawLine(grid, 7, 28, 17, 28, 9);
  scatterPixels(grid, random, 9, 8, 24, [4, 5, 7]);
};

const paintBackground = (
  grid: number[][],
  trait: GrowthTrait,
  random: () => number,
) => {
  for (let y = 0; y < PAINTING_PIXEL_HEIGHT; y += 1) {
    const band = y < 9 ? 1 : y < 18 ? 2 : y < 26 ? 3 : 6;
    fillRect(grid, 0, y, PAINTING_PIXEL_WIDTH, 1, band);
  }

  if (trait === "focus" || trait === "efficiency") {
    for (let x = 3; x < PAINTING_PIXEL_WIDTH; x += 5) {
      drawLine(grid, x, 4, x, 28, trait === "focus" ? 3 : 5);
    }
  }

  if (trait === "warmth") {
    fillCircle(grid, 18, 8, 4, 4);
    fillCircle(grid, 18, 8, 2, 5);
  } else if (trait === "curiosity") {
    for (let count = 0; count < 18; count += 1) {
      setPixel(
        grid,
        Math.floor(random() * PAINTING_PIXEL_WIDTH),
        Math.floor(random() * 14),
        random() > 0.72 ? 5 : 4,
      );
    }
  } else {
    fillCircle(grid, 17 + Math.floor(random() * 4), 7, 2, 5);
  }
};

const paintTraitMotif = (
  grid: number[][],
  trait: GrowthTrait,
  archetype: PaintingArchetypeId,
  random: () => number,
) => {
  if (archetype === "signal_tower") {
    drawSignalTower(grid, random);
  } else if (archetype === "window_city") {
    drawWindowCity(grid, random);
  } else if (archetype === "terminal_star_map") {
    drawTerminalStarMap(grid, random);
  } else if (archetype === "desk_still_life") {
    drawDeskStillLife(grid, random);
  } else if (archetype === "harbor_beacon") {
    drawHarborBeacon(grid, random);
  } else if (archetype === "mountain_path") {
    drawMountainPath(grid, random);
  } else if (archetype === "circuit_grid") {
    drawCircuitGrid(grid, random);
  } else if (archetype === "mosaic_garden") {
    drawMosaicGarden(grid, random);
  } else if (archetype === "color_bloom") {
    drawColorBloom(grid, random);
  } else if (archetype === "lantern_room") {
    drawLanternRoom(grid, random);
  } else if (trait === "focus") {
    fillRect(grid, 8, 11, 8, 13, 4);
    fillRect(grid, 10, 13, 4, 9, 1);
    fillRect(grid, 11, 10, 2, 17, 5);
  } else if (trait === "resilience") {
    drawLine(grid, 2, 27, 10, 14, 7);
    drawLine(grid, 10, 14, 16, 27, 7);
    drawLine(grid, 10, 14, 22, 27, 4);
    fillRect(grid, 5, 27, 15, 5, 6);
  } else if (trait === "curiosity") {
    drawLine(grid, 4, 29, 10, 22, 5);
    drawLine(grid, 10, 22, 17, 16, 7);
    drawLine(grid, 17, 16, 21, 10, 4);
    fillCircle(grid, 17, 16, 2, 8);
  } else if (trait === "efficiency") {
    for (let y = 12; y < 29; y += 5) {
      drawLine(grid, 4, y, 19, y, 5);
    }
    for (let x = 5; x < 20; x += 5) {
      drawLine(grid, x, 11, x, 30, 3);
    }
    fillRect(grid, 7, 16, 4, 4, 4);
    fillRect(grid, 14, 22, 4, 4, 7);
  } else if (trait === "creativity") {
    fillCircle(grid, 10, 17, 6, 3);
    fillCircle(grid, 14, 21, 5, 5);
    fillCircle(grid, 8, 23, 3, 8);
    drawLine(grid, 6, 14, 18, 27, 4);
  } else {
    fillRect(grid, 7, 14, 10, 13, 3);
    fillRect(grid, 9, 16, 6, 8, 4);
    fillRect(grid, 10, 25, 4, 4, 5);
    drawLine(grid, 4, 30, 20, 30, 7);
  }

  for (let count = 0; count < 8; count += 1) {
    const x = 2 + Math.floor(random() * 20);
    const y = 8 + Math.floor(random() * 23);
    setPixel(grid, x, y, 4 + Math.floor(random() * 3));
  }
};

const paintMemoryGlyphs = (
  grid: number[][],
  memory: AivatarMemory,
  random: () => number,
) => {
  const events = memory.recentEvents.slice(0, 5);
  events.forEach((event, index) => {
    const x = 2 + ((hashString(event.summary) + index * 5) % 18);
    const y = 7 + ((hashString(event.type) + index * 7) % 22);
    const color =
      event.type === "task_complete"
        ? 5
        : event.type === "task_error" || event.type === "error_recovered"
          ? 8
          : event.behavior === "paint"
            ? 3
            : 7;
    fillRect(grid, x, y, 2, 2, color);
    if (event.type === "task_complete") {
      drawLine(grid, x, y, x + 3, y - 2, color);
    }
  });

  (memory.preferences.idleBubblePhrases ?? []).slice(0, 5).forEach((phrase, index) => {
    const phraseSeed = hashString(phrase);
    const x = 2 + ((phraseSeed + index * 3) % 19);
    const y = 9 + (((phraseSeed >>> 8) + index * 5) % 21);
    drawLine(
      grid,
      x,
      y,
      clamp(x + Math.floor(random() * 7) - 3, 1, 22),
      clamp(y + Math.floor(random() * 7) - 3, 4, 32),
      4 + (phraseSeed % 5),
    );
  });
};

const addHighlights = (grid: number[][], random: () => number) => {
  for (let count = 0; count < 16; count += 1) {
    const x = Math.floor(random() * PAINTING_PIXEL_WIDTH);
    const y = Math.floor(random() * PAINTING_PIXEL_HEIGHT);
    if (grid[y][x] !== 0) {
      setPixel(grid, x, y, random() > 0.35 ? 4 : 5);
    }
  }

  drawLine(grid, 1, PAINTING_PIXEL_HEIGHT - 2, PAINTING_PIXEL_WIDTH - 2, PAINTING_PIXEL_HEIGHT - 2, 9);
};

const qualityForMemory = (
  memory: AivatarMemory,
  trait: GrowthTrait,
  random: () => number,
) => {
  const eventRichness = Math.min(1.6, memory.recentEvents.length * 0.22);
  const phraseRichness = Math.min(
    1.2,
    (memory.preferences.idleBubblePhrases?.length ?? 0) * 0.3,
  );
  const traitRichness = Math.min(
    1.1,
    Math.log10((memory.growth.traits[trait] ?? 0) + 1) * 0.42,
  );
  return Math.round(clamp(1 + eventRichness + phraseRichness + traitRichness + random() * 1.05, 1, 5));
};

export const paintingProgressRatio = (draft?: AivatarPaintingDraft) =>
  draft
    ? clamp(draft.progressSeconds / Math.max(1, draft.targetSeconds), 0, 1)
    : 0;

export const paintingPixelVisible = (
  artwork: AivatarPaintingArtwork,
  x: number,
  y: number,
  progress: number,
) => {
  const reveal = hashString(`${artwork.seed}:${x}:${y}`) / 0xffffffff;
  const eased = clamp(progress, 0, 1) ** 0.72;
  return reveal <= eased;
};

export const createPaintingDraft = (
  memory: AivatarMemory,
  options: {
    avatarId?: string;
    easelItemId?: string;
    nowIso?: string;
    paintingPlan?: Partial<AivatarPaintingPlan>;
  } = {},
): AivatarPaintingDraft => {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const trait = dominantTrait(memory);
  const source = sourceText(memory);
  const baseSeed = hashString(
    [
      options.avatarId ?? "avatar",
      options.easelItemId ?? "easel",
      nowIso,
      trait,
      ...source,
    ].join("|"),
  );
  const paintingPlan = normalizePaintingPlanValue(options.paintingPlan, {
    trait,
    memory,
    source,
    seed: baseSeed,
  });
  const seed = hashString(
    [
      baseSeed.toString(36),
      paintingPlan.archetype,
      paintingPlan.title,
      paintingPlan.motifs?.join(",") ?? "",
    ].join("|"),
  );
  const random = mulberry32(seed);
  const palette = PALETTES[trait];
  const grid = Array.from({ length: PAINTING_PIXEL_HEIGHT }, () =>
    Array.from({ length: PAINTING_PIXEL_WIDTH }, () => 0),
  );

  paintBackground(grid, trait, random);
  paintTraitMotif(
    grid,
    trait,
    paintingPlan.archetype as PaintingArchetypeId,
    random,
  );
  paintMemoryGlyphs(grid, memory, random);
  addHighlights(grid, random);

  const [titleA, titleB] = TITLE_WORDS[trait];
  const fallbackTitle = `${titleA} ${titleB}`;
  const artwork: AivatarPaintingArtwork = {
    id: `painting-${seed.toString(36)}-${Date.parse(nowIso).toString(36)}`,
    title: paintingPlan.title || fallbackTitle,
    createdAt: nowIso,
    width: PAINTING_PIXEL_WIDTH,
    height: PAINTING_PIXEL_HEIGHT,
    palette,
    pixels: grid.map((row) => row.map((pixel) => pixel.toString(36)).join("")),
    seed,
    theme: trait,
    archetype: paintingPlan.archetype,
    quality: qualityForMemory(memory, trait, random),
    paintingPlan,
    sourceSummary: source.slice(0, 3).join(" / "),
  };

  return {
    id: `draft-${artwork.id}`,
    artwork,
    startedAt: nowIso,
    updatedAt: nowIso,
    progressSeconds: 0,
    targetSeconds: PAINTING_TARGET_SECONDS,
    easelItemId: options.easelItemId,
  };
};

const normalizeStoredPaintingPlan = (
  value: unknown,
  fallbackArchetype: PaintingArchetypeId,
  fallbackTitle: string,
): AivatarPaintingPlan | undefined => {
  if (!isRecord(value)) return undefined;
  const archetype =
    archetypeFromText(safePlanText(value.archetype, 80)) ?? fallbackArchetype;
  const definition = ARCHETYPES_BY_ID.get(archetype) ?? ARCHETYPES[0];
  const motifs = Array.isArray(value.motifs)
    ? value.motifs
        .map((motif) => safePlanText(motif, 32))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return {
    title:
      safePlanText(value.title, 42) ||
      fallbackTitle ||
      definition.title,
    archetype: definition.id,
    mood: safePlanText(value.mood, 60) || undefined,
    paletteHint: safePlanText(value.paletteHint, 60) || undefined,
    composition:
      isRecord(value.composition)
        ? {
            background:
              safePlanText(value.composition.background, 60) || undefined,
            subject: safePlanText(value.composition.subject, 60) || undefined,
            foreground:
              safePlanText(value.composition.foreground, 60) || undefined,
            accent: safePlanText(value.composition.accent, 60) || undefined,
          }
        : undefined,
    motifs,
    source: value.source === "llm" ? "llm" : "heuristic",
  };
};

const normalizeArtwork = (value: unknown): AivatarPaintingArtwork | null => {
  if (!isRecord(value)) return null;
  const width = Number(value.width);
  const height = Number(value.height);
  const palette = Array.isArray(value.palette)
    ? value.palette.filter((color): color is string => typeof color === "string")
    : [];
  const pixels = Array.isArray(value.pixels)
    ? value.pixels.filter((row): row is string => typeof row === "string")
    : [];

  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.createdAt !== "string" ||
    width !== PAINTING_PIXEL_WIDTH ||
    height !== PAINTING_PIXEL_HEIGHT ||
    palette.length === 0 ||
    pixels.length !== PAINTING_PIXEL_HEIGHT ||
    pixels.some((row) => row.length !== PAINTING_PIXEL_WIDTH)
  ) {
    return null;
  }

  const theme = TRAIT_ORDER.includes(value.theme as GrowthTrait)
    ? (value.theme as GrowthTrait)
    : "creativity";
  const saleBits = Number(value.saleBits);
  const archetype =
    archetypeFromText(safePlanText(value.archetype, 80)) ??
    ARCHETYPES_BY_TRAIT[theme][0] ??
    "color_bloom";
  const paintingPlan = normalizeStoredPaintingPlan(
    value.paintingPlan,
    archetype,
    value.title,
  );

  return {
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    completedAt:
      typeof value.completedAt === "string" ? value.completedAt : undefined,
    width: PAINTING_PIXEL_WIDTH,
    height: PAINTING_PIXEL_HEIGHT,
    palette,
    pixels,
    seed: Number.isFinite(Number(value.seed)) ? Number(value.seed) : hashString(value.id),
    theme,
    archetype,
    quality: clamp(Math.round(Number(value.quality) || 1), 1, 5),
    saleBits:
      Number.isFinite(saleBits) && saleBits > 0
        ? clamp(Math.round(saleBits), 1, 9999)
        : undefined,
    paintingPlan,
    sourceSummary:
      typeof value.sourceSummary === "string" ? value.sourceSummary : "",
  };
};

const normalizeDraft = (value: unknown): AivatarPaintingDraft | undefined => {
  if (!isRecord(value)) return undefined;
  const artwork = normalizeArtwork(value.artwork);
  if (!artwork || typeof value.id !== "string") return undefined;
  const targetSeconds = PAINTING_TARGET_SECONDS;

  return {
    id: value.id,
    artwork,
    startedAt:
      typeof value.startedAt === "string" ? value.startedAt : artwork.createdAt,
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : artwork.createdAt,
    progressSeconds: clamp(Number(value.progressSeconds) || 0, 0, targetSeconds),
    targetSeconds,
    easelItemId:
      typeof value.easelItemId === "string" ? value.easelItemId : undefined,
  };
};

export const normalizePaintingGallery = (
  value?: Partial<AivatarPaintingGallery>,
): AivatarPaintingGallery => {
  const artworks = Array.isArray(value?.artworks)
    ? value.artworks
        .map(normalizeArtwork)
        .filter((artwork): artwork is AivatarPaintingArtwork => Boolean(artwork))
        .slice(0, PAINTING_GALLERY_LIMIT)
    : [];

  return {
    artworks,
    activeDraft: normalizeDraft(value?.activeDraft),
  };
};

export const advancePaintingDraft = (
  draft: AivatarPaintingDraft,
  elapsedSeconds: number,
  nowIso = new Date().toISOString(),
): AivatarPaintingDraft => ({
  ...draft,
  updatedAt: nowIso,
  progressSeconds: clamp(
    draft.progressSeconds + Math.max(0, elapsedSeconds),
    0,
    draft.targetSeconds,
  ),
});

export const rewardBitsForPaintingQuality = (
  quality: number,
  random: () => number = Math.random,
) => {
  const [min, max] = PAINTING_REWARD_RANGES[clamp(Math.round(quality), 1, 5)];
  return min + Math.floor(random() * (max - min + 1));
};

export const paintingArtworkById = (
  gallery: AivatarPaintingGallery | undefined,
  artworkId: string | undefined,
) => {
  if (!artworkId) return undefined;
  return normalizePaintingGallery(gallery).artworks.find(
    (artwork) => artwork.id === artworkId,
  );
};
