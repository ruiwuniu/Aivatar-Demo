import type {
  AivatarMemory,
  AvatarAppearanceId,
  AvatarRuntime,
  PetStats,
} from "../types";
import { drawAvatar } from "../game/renderScene";
import {
  PARK_SCENE_HEIGHT,
  PARK_SCENE_WIDTH,
  type ParkObjectPlacement,
} from "./parkContent";
import type { ParkFishingPose } from "./parkRuntime";
import type { ParkRawFishId } from "./parkProbability";
import {
  ensureParkCloudAtlas,
  getParkCloudAtlasStyles,
  parkCloudAtlasOpaquePixelCount,
  type ParkCloudAtlasStyle,
  type ParkCloudLightVariant,
} from "./parkCloudAtlas";
import {
  ensureParkReferenceLayers,
  getParkReferenceLayers,
  PARK_REFERENCE_SHADOW_CASTERS,
  type ParkReferenceLayers,
  type ParkReferenceShadowCaster,
} from "./parkReferenceLayers";

const rect = (
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

const mix = (a: string, b: string, amount: number) => {
  const parse = (value: string) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const left = parse(a);
  const right = parse(b);
  return `#${left
    .map((value, index) => Math.round(value + (right[index]! - value) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
};

const daylight = (date: Date) => {
  const hour = date.getHours() + date.getMinutes() / 60;
  const sunProgress = Math.max(0, Math.min(1, (hour - 6) / 12));
  const dayStrength = Math.max(0, Math.sin(sunProgress * Math.PI));
  const twilight = hour >= 5 && hour < 7 ? (hour - 5) / 2 : hour >= 17 && hour < 19 ? (19 - hour) / 2 : 0;
  return { hour, sunProgress, dayStrength, twilight: Math.max(0, Math.min(1, twilight)) };
};

const drawSkyAndSea = (ctx: CanvasRenderingContext2D, nowMs: number, frame: number) => {
  const date = new Date(nowMs);
  const light = daylight(date);
  const night = light.hour < 5 || light.hour >= 19;
  const skyTop = night ? "#10192d" : mix("#6fa8cf", "#f4b775", light.twilight * 0.7);
  const skyBottom = night ? "#273656" : mix("#bfe0dc", "#ffd39a", light.twilight * 0.85);
  for (let y = 0; y < 150; y += 10) {
    rect(ctx, 0, y, PARK_SCENE_WIDTH, 10, mix(skyTop, skyBottom, y / 150));
  }

  if (night) {
    for (let index = 0; index < 70; index += 1) {
      const x = (index * 173 + 41) % PARK_SCENE_WIDTH;
      const y = (index * 67 + 19) % 120;
      if ((index + Math.floor(frame / 30)) % 7 === 0) rect(ctx, x, y, 3, 3, "#f4efc2");
      else rect(ctx, x, y, 2, 2, "#b6c8da");
    }
  }

  const sunX = 90 + light.sunProgress * 1000;
  const sunY = 116 - Math.sin(light.sunProgress * Math.PI) * 82;
  if (light.hour >= 5 && light.hour < 19) {
    rect(ctx, sunX - 11, sunY - 14, 22, 28, "#fff0a6");
    rect(ctx, sunX - 15, sunY - 10, 30, 20, "#fff0a6");
  } else {
    const moonProgress = ((light.hour + 5) % 24) / 10;
    const moonX = 120 + moonProgress * 900;
    rect(ctx, moonX - 9, 55, 18, 24, "#e9ebd0");
    rect(ctx, moonX - 12, 59, 24, 16, "#e9ebd0");
    rect(ctx, moonX + 4, 52, 8, 14, skyTop);
  }

  for (let y = 150; y < 265; y += 8) {
    rect(ctx, 0, y, PARK_SCENE_WIDTH, 8, mix(night ? "#172b46" : "#4d86a3", night ? "#25465d" : "#74aebd", (y - 150) / 115));
  }
  for (let index = 0; index < 170; index += 1) {
    const x = (index * 89 + Math.floor(nowMs / 95)) % PARK_SCENE_WIDTH;
    const y = 164 + ((index * 37) % 84);
    const width = 2 + (index % 4) * 3;
    if ((index + frame) % 3 === 0) rect(ctx, x, y, width, 2, night ? "#7390a2" : "#cde0cc");
  }

  const cloudPalettes = night
    ? ["#30405c", "#3d506a", "#59677b"]
    : ["#e9e1ce", "#f6e8cd", "#fff0d6"];
  [0.018, 0.026, 0.034].forEach((speed, layer) => {
    for (let cloud = 0; cloud < 3; cloud += 1) {
      const base = (cloud * 430 + layer * 155 + nowMs * speed) % 1500 - 180;
      const y = 18 + layer * 30 + cloud * 10;
      const color = cloudPalettes[layer]!;
      rect(ctx, base, y + 12, 108, 18, color);
      rect(ctx, base + 18, y, 42, 34, color);
      rect(ctx, base + 53, y + 5, 48, 29, color);
      rect(ctx, base + 92, y + 17, 34, 13, color);
    }
  });
};

const drawPlateau = (ctx: CanvasRenderingContext2D, nowMs: number, frame: number) => {
  const date = new Date(nowMs);
  const { dayStrength, twilight } = daylight(date);
  const grass = mix("#334f38", "#6f8f32", dayStrength * 0.8 + twilight * 0.12);
  const grassLight = mix("#456344", "#93aa3c", dayStrength * 0.75);
  const grassDark = mix("#243c32", "#49632c", dayStrength * 0.7);

  ctx.beginPath();
  ctx.moveTo(105, 235);
  ctx.lineTo(1040, 235);
  ctx.lineTo(1100, 500);
  ctx.lineTo(1060, 842);
  ctx.lineTo(160, 842);
  ctx.lineTo(112, 650);
  ctx.closePath();
  ctx.fillStyle = "#5d4632";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(160, 832);
  ctx.lineTo(1060, 832);
  ctx.lineTo(1040, 900);
  ctx.lineTo(185, 900);
  ctx.closePath();
  ctx.fillStyle = "#49372b";
  ctx.fill();
  for (let x = 195; x < 1030; x += 54) {
    rect(ctx, x, 842 + ((x / 54) % 2) * 8, 34, 6, "#76543a");
    rect(ctx, x + 12, 872 + ((x / 27) % 3) * 5, 28, 5, "#2e2925");
  }
  ctx.beginPath();
  ctx.moveTo(112, 650);
  ctx.lineTo(160, 842);
  ctx.lineTo(160, 886);
  ctx.lineTo(105, 790);
  ctx.closePath();
  ctx.fillStyle = "#3d3028";
  ctx.fill();
  for (let y = 665; y < 870; y += 22) {
    rect(ctx, 116 + ((y / 22) % 2) * 7, y, 42, 5, y % 44 ? "#806044" : "#4b382c");
  }

  ctx.beginPath();
  ctx.moveTo(105, 235);
  ctx.lineTo(1040, 235);
  ctx.lineTo(1100, 500);
  ctx.lineTo(1060, 832);
  ctx.lineTo(160, 832);
  ctx.lineTo(112, 650);
  ctx.closePath();
  ctx.fillStyle = grass;
  ctx.fill();

  for (let y = 250; y < 825; y += 22) {
    for (let x = 150 + ((y / 22) % 2) * 16; x < 1050; x += 32) {
      if (((x * 7 + y * 11) % 13) < 5) {
        rect(ctx, x, y, 3, 5, grassLight);
        rect(ctx, x + 3, y + 3, 3, 3, grassDark);
      }
    }
  }

  const breeze = Math.max(0, Math.sin(nowMs / 4700) - 0.48) / 0.52;
  if (breeze > 0) {
    const drift = Math.floor((nowMs / 32) % 210);
    for (let row = 0; row < 9; row += 1) {
      const y = 360 + row * 52;
      for (let streak = 0; streak < 6; streak += 1) {
        const x = 160 + ((streak * 180 + drift + row * 43) % 820);
        rect(ctx, x, y + Math.sin((x + frame) / 28) * 3, 18 + breeze * 24, 2, grassLight);
      }
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(1110, 650, 285, 235, 0, 0, Math.PI * 2);
  ctx.clip();
  rect(ctx, 800, 405, 430, 500, mix("#173c4d", "#176b83", dayStrength));
  for (let y = 445; y < 880; y += 17) {
    const offset = Math.floor((nowMs / 48 + y * 0.7) % 72);
    for (let x = 795 - offset; x < 1200; x += 72) {
      rect(ctx, x, y, 22 + ((x + y) % 17), 3, dayStrength > 0.2 ? "#5ba4a0" : "#3c6572");
    }
  }
  ctx.restore();
  ctx.strokeStyle = grassDark;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.ellipse(1110, 650, 291, 241, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = grassLight;
  ctx.lineWidth = 4;
  ctx.stroke();

  for (let index = 0; index < 24; index += 1) {
    const angle = 2.4 + index * 0.1;
    const x = 1110 + Math.cos(angle) * 278;
    const y = 650 + Math.sin(angle) * 228;
    rect(ctx, x, y - 9, 3, 12, grassDark);
    rect(ctx, x + 4, y - 13, 2, 16, grassLight);
  }
};

const drawTree = (ctx: CanvasRenderingContext2D, object: ParkObjectPlacement, frame: number) => {
  const sway = Math.round(Math.sin(frame / 27 + object.x) * 2);
  rect(ctx, object.x - 14, object.y - 79, 17, 82, "#493a2b");
  rect(ctx, object.x - 7, object.y - 70, 13, 72, "#72523a");
  rect(ctx, object.x - 37 + sway, object.y - 92, 78, 31, "#243f2f");
  rect(ctx, object.x - 28 + sway, object.y - 110, 68, 39, "#355c34");
  rect(ctx, object.x - 4 + sway, object.y - 120, 48, 32, "#4e7437");
  rect(ctx, object.x + 18 + sway, object.y - 98, 43, 25, "#5d813c");
};

const drawParkObject = (ctx: CanvasRenderingContext2D, object: ParkObjectPlacement, frame: number) => {
  if (object.kind === "tree") return drawTree(ctx, object, frame);
  if (object.kind === "flowers") {
    for (let index = 0; index < 10; index += 1) {
      const x = object.x - 15 + (index * 11) % 31;
      const y = object.y - ((index * 7) % 14);
      rect(ctx, x, y, 3, 8, "#315435");
      rect(ctx, x - 2, y - 3, 7, 5, index % 2 ? "#f1c2d5" : "#f4df77");
    }
    return;
  }
  if (object.kind === "shrub") {
    rect(ctx, object.x - 22, object.y - 20, 44, 22, "#294b32");
    rect(ctx, object.x - 15, object.y - 31, 37, 23, "#47723c");
    rect(ctx, object.x + 3, object.y - 24, 26, 19, "#5b843f");
    return;
  }
  if (object.kind === "rock") {
    rect(ctx, object.x - 22, object.y - 17, 44, 19, "#4d514d");
    rect(ctx, object.x - 15, object.y - 28, 31, 20, "#73766a");
    rect(ctx, object.x - 9, object.y - 25, 17, 5, "#a0a087");
    return;
  }
  if (object.kind === "bench") {
    rect(ctx, object.x - 34, object.y - 31, 68, 10, "#3b2820");
    rect(ctx, object.x - 30, object.y - 29, 60, 6, "#9a6538");
    rect(ctx, object.x - 36, object.y - 14, 72, 10, "#3b2820");
    rect(ctx, object.x - 31, object.y - 12, 62, 6, "#a97845");
    rect(ctx, object.x - 27, object.y - 5, 6, 15, "#4c3527");
    rect(ctx, object.x + 21, object.y - 5, 6, 15, "#4c3527");
    return;
  }
  rect(ctx, object.x - 4, object.y - 57, 8, 60, "#27323a");
  rect(ctx, object.x - 10, object.y - 67, 20, 14, "#1b252c");
  rect(ctx, object.x - 6, object.y - 64, 12, 8, "#ffe4a1");
};

const drawFish = (
  ctx: CanvasRenderingContext2D,
  fishId: ParkRawFishId,
  x: number,
  y: number,
  scale = 1,
) => {
  const body = fishId === "raw-black-bass" ? "#526f54" : "#b5aa84";
  const light = fishId === "raw-black-bass" ? "#9bb870" : "#e1d3a6";
  rect(ctx, x - 15 * scale, y - 6 * scale, 25 * scale, 12 * scale, "#263b38");
  rect(ctx, x - 11 * scale, y - 8 * scale, 24 * scale, 14 * scale, body);
  rect(ctx, x - 6 * scale, y - 5 * scale, 17 * scale, 4 * scale, light);
  rect(ctx, x + 11 * scale, y - 3 * scale, 9 * scale, 8 * scale, body);
  rect(ctx, x + 17 * scale, y - 7 * scale, 5 * scale, 15 * scale, "#354a42");
  rect(ctx, x - 8 * scale, y - 5 * scale, 2 * scale, 2 * scale, "#111b1b");
};

const drawFishingOverlay = (
  ctx: CanvasRenderingContext2D,
  avatar: AvatarRuntime,
  pose: ParkFishingPose,
  fishId: ParkRawFishId | undefined,
  frame: number,
) => {
  if (pose === "none") return;
  const x = Math.round(avatar.x);
  const y = Math.round(avatar.y);
  if (pose !== "display") {
    const reel = pose === "reel" ? Math.sin(frame / 2) * 10 : 0;
    ctx.strokeStyle = "#50351e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 7, y - 24);
    ctx.lineTo(x + 49 - reel, y - 72 + reel * 0.3);
    ctx.stroke();
    ctx.strokeStyle = "#d7e2cf";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 49 - reel, y - 72 + reel * 0.3);
    ctx.lineTo(x + 92, pose === "reel" ? y - 28 : y + 3);
    ctx.stroke();
    if (pose === "whistle") {
      rect(ctx, x + 23, y - 45, 4, 4, "#fff0a6");
      rect(ctx, x + 31, y - 52, 3, 3, "#fff0a6");
    }
  }
  if (pose === "display" && fishId) drawFish(ctx, fishId, x, y - 55, 1.6);
};

type Rgb = [number, number, number];

interface ParkTimeKeyframe {
  hour: number;
  multiply: Rgb;
  multiplyAlpha: number;
  screen: Rgb;
  screenAlpha: number;
  nightStrength: number;
  skyTop: Rgb;
  skyHorizon: Rgb;
  cloudLight: Rgb;
  cloudShadow: Rgb;
  reflection: Rgb;
}

export interface ParkTimeVisual extends Omit<ParkTimeKeyframe, "hour"> {
  hour: number;
}

const PARK_TIME_KEYFRAMES: ParkTimeKeyframe[] = [
  { hour: 0, multiply: [20, 32, 68], multiplyAlpha: 0.7, screen: [43, 72, 116], screenAlpha: 0.12, nightStrength: 1, skyTop: [7, 15, 38], skyHorizon: [30, 53, 78], cloudLight: [82, 94, 118], cloudShadow: [32, 43, 69], reflection: [157, 187, 211] },
  { hour: 4.8, multiply: [46, 52, 91], multiplyAlpha: 0.56, screen: [110, 89, 131], screenAlpha: 0.14, nightStrength: 0.72, skyTop: [18, 28, 58], skyHorizon: [91, 67, 91], cloudLight: [131, 112, 143], cloudShadow: [57, 54, 88], reflection: [157, 165, 193] },
  { hour: 5.8, multiply: [115, 68, 76], multiplyAlpha: 0.26, screen: [255, 132, 104], screenAlpha: 0.2, nightStrength: 0.2, skyTop: [91, 55, 91], skyHorizon: [255, 155, 101], cloudLight: [255, 199, 145], cloudShadow: [137, 84, 111], reflection: [255, 186, 113] },
  { hour: 6.5, multiply: [255, 255, 255], multiplyAlpha: 0, screen: [255, 255, 255], screenAlpha: 0, nightStrength: 0, skyTop: [183, 111, 132], skyHorizon: [255, 218, 140], cloudLight: [255, 229, 173], cloudShadow: [173, 126, 141], reflection: [255, 221, 141] },
  { hour: 9.2, multiply: [241, 234, 207], multiplyAlpha: 0.06, screen: [226, 246, 244], screenAlpha: 0.07, nightStrength: 0, skyTop: [96, 166, 210], skyHorizon: [214, 239, 230], cloudLight: [249, 244, 221], cloudShadow: [153, 176, 189], reflection: [235, 245, 220] },
  { hour: 12.2, multiply: [225, 238, 255], multiplyAlpha: 0.08, screen: [214, 247, 255], screenAlpha: 0.09, nightStrength: 0, skyTop: [72, 151, 210], skyHorizon: [190, 231, 240], cloudLight: [248, 246, 231], cloudShadow: [142, 172, 191], reflection: [235, 249, 244] },
  { hour: 15.8, multiply: [255, 239, 202], multiplyAlpha: 0.05, screen: [255, 226, 175], screenAlpha: 0.08, nightStrength: 0, skyTop: [93, 159, 200], skyHorizon: [230, 218, 172], cloudLight: [255, 233, 190], cloudShadow: [163, 158, 166], reflection: [255, 228, 174] },
  { hour: 18.3, multiply: [137, 69, 92], multiplyAlpha: 0.3, screen: [255, 104, 66], screenAlpha: 0.22, nightStrength: 0.08, skyTop: [79, 46, 96], skyHorizon: [255, 125, 78], cloudLight: [255, 178, 116], cloudShadow: [119, 67, 106], reflection: [255, 150, 83] },
  { hour: 19.5, multiply: [65, 54, 88], multiplyAlpha: 0.48, screen: [116, 66, 117], screenAlpha: 0.13, nightStrength: 0.48, skyTop: [36, 31, 65], skyHorizon: [146, 76, 117], cloudLight: [162, 119, 151], cloudShadow: [67, 56, 91], reflection: [188, 137, 175] },
  { hour: 21, multiply: [27, 44, 80], multiplyAlpha: 0.66, screen: [48, 82, 128], screenAlpha: 0.12, nightStrength: 0.92, skyTop: [9, 18, 43], skyHorizon: [41, 64, 91], cloudLight: [89, 105, 130], cloudShadow: [31, 44, 70], reflection: [151, 183, 211] },
  { hour: 24, multiply: [20, 32, 68], multiplyAlpha: 0.7, screen: [43, 72, 116], screenAlpha: 0.12, nightStrength: 1, skyTop: [7, 15, 38], skyHorizon: [30, 53, 78], cloudLight: [82, 94, 118], cloudShadow: [32, 43, 69], reflection: [157, 187, 211] },
];

const lerp = (left: number, right: number, amount: number) => left + (right - left) * amount;
const lerpRgb = (left: Rgb, right: Rgb, amount: number): Rgb => [
  Math.round(lerp(left[0], right[0], amount)),
  Math.round(lerp(left[1], right[1], amount)),
  Math.round(lerp(left[2], right[2], amount)),
];

export const resolveParkTimeVisual = (nowMs: number): ParkTimeVisual => {
  const date = new Date(nowMs);
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const rightIndex = Math.max(1, PARK_TIME_KEYFRAMES.findIndex((keyframe) => hour <= keyframe.hour));
  const left = PARK_TIME_KEYFRAMES[rightIndex - 1]!;
  const right = PARK_TIME_KEYFRAMES[rightIndex]!;
  const amount = Math.max(0, Math.min(1, (hour - left.hour) / (right.hour - left.hour)));
  return {
    hour,
    multiply: lerpRgb(left.multiply, right.multiply, amount),
    multiplyAlpha: lerp(left.multiplyAlpha, right.multiplyAlpha, amount),
    screen: lerpRgb(left.screen, right.screen, amount),
    screenAlpha: lerp(left.screenAlpha, right.screenAlpha, amount),
    nightStrength: lerp(left.nightStrength, right.nightStrength, amount),
    skyTop: lerpRgb(left.skyTop, right.skyTop, amount),
    skyHorizon: lerpRgb(left.skyHorizon, right.skyHorizon, amount),
    cloudLight: lerpRgb(left.cloudLight, right.cloudLight, amount),
    cloudShadow: lerpRgb(left.cloudShadow, right.cloudShadow, amount),
    reflection: lerpRgb(left.reflection, right.reflection, amount),
  };
};

export interface ParkCelestialPosition {
  kind: "sun" | "moon";
  x: number;
  y: number;
  progress: number;
  elevation: number;
  strength: number;
}

export const resolveParkCelestialPosition = (hour: number): ParkCelestialPosition => {
  if (hour >= 5.6 && hour < 19.3) {
    const progress = Math.max(0, Math.min(1, (hour - 5.6) / 13.7));
    const elevation = Math.max(0, Math.sin(progress * Math.PI));
    return {
      kind: "sun",
      x: -45 + progress * 1270,
      y: 110 - elevation * 88,
      progress,
      elevation,
      strength: 0.42 + elevation * 0.58,
    };
  }
  const progress = hour >= 19.3
    ? Math.min(1, (hour - 19.3) / 10.3)
    : Math.min(1, (hour + 4.7) / 10.3);
  const elevation = Math.max(0, Math.sin(progress * Math.PI));
  return {
    kind: "moon",
    x: -55 + progress * 1290,
    y: 98 - elevation * 66,
    progress,
    elevation,
    strength: 0.12 + elevation * 0.2,
  };
};

const previewTime = (nowMs: number) => {
  if (typeof window === "undefined") return nowMs;
  const previewHour = Number.parseFloat(new URLSearchParams(window.location.search).get("parkHour") ?? "");
  if (!Number.isFinite(previewHour) || previewHour < 0 || previewHour >= 24) return nowMs;
  const date = new Date(nowMs);
  const wholeHour = Math.floor(previewHour);
  date.setHours(
    wholeHour,
    Math.round((previewHour - wholeHour) * 60),
    date.getSeconds(),
    date.getMilliseconds(),
  );
  return date.getTime();
};

const rgbColor = (color: Rgb) => `rgb(${color.join(",")})`;
const PARK_HORIZON_Y = 122;
const PARK_HORIZON_TINT_END_Y = 235;

let horizonTintCanvas: HTMLCanvasElement | null = null;

const drawHorizonSeaTint = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  visual: ParkTimeVisual,
) => {
  if (!horizonTintCanvas) {
    horizonTintCanvas = document.createElement("canvas");
    horizonTintCanvas.width = PARK_SCENE_WIDTH;
    horizonTintCanvas.height = PARK_SCENE_HEIGHT;
  }
  const tint = horizonTintCanvas.getContext("2d")!;
  tint.setTransform(1, 0, 0, 1, 0, 0);
  tint.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  const color = visual.skyHorizon;
  const dawnWindow = Math.max(0, 1 - Math.abs(visual.hour - 6.5) / 2);
  const dawnBoost = dawnWindow * dawnWindow * (3 - 2 * dawnWindow);
  const topAlpha = 0.62 + dawnBoost * 0.16;
  const middleAlpha = 0.4 + dawnBoost * 0.12;
  const lowerAlpha = 0.14 + dawnBoost * 0.05;
  const gradient = tint.createLinearGradient(
    0,
    PARK_HORIZON_Y,
    0,
    PARK_HORIZON_TINT_END_Y,
  );
  gradient.addColorStop(0, `rgba(${color.join(",")},${topAlpha})`);
  gradient.addColorStop(0.36, `rgba(${color.join(",")},${middleAlpha})`);
  gradient.addColorStop(0.72, `rgba(${color.join(",")},${lowerAlpha})`);
  gradient.addColorStop(1, `rgba(${color.join(",")},0)`);
  tint.fillStyle = gradient;
  tint.fillRect(
    0,
    PARK_HORIZON_Y,
    PARK_SCENE_WIDTH,
    PARK_HORIZON_TINT_END_Y - PARK_HORIZON_Y,
  );
  tint.globalCompositeOperation = "destination-in";
  tint.drawImage(layers.seaMask, 0, 0);
  tint.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.82;
  ctx.drawImage(horizonTintCanvas, 0, 0);
  ctx.restore();
};

const drawDynamicSky = (ctx: CanvasRenderingContext2D, visual: ParkTimeVisual) => {
  for (let y = 0; y < 150; y += 4) {
    ctx.fillStyle = rgbColor(lerpRgb(visual.skyTop, visual.skyHorizon, y / 150));
    ctx.fillRect(0, y, PARK_SCENE_WIDTH, 4);
  }
};

type ParkNightStar = {
  x: number;
  y: number;
  size: 1 | 2 | 3;
  color: string;
  alpha: number;
  twinkleAmount: number;
  twinklePeriodMs: number;
  phase: number;
  isGalacticBand: boolean;
};

const PARK_NIGHT_STAR_BACKGROUND_COUNT = 104;
const PARK_NIGHT_STAR_BAND_COUNT = 42;
const PARK_NIGHT_STAR_FIELD_WIDTH = PARK_SCENE_WIDTH + 180;

const hashNightStar = (index: number, salt: number) => {
  let value = (index * 0x9e3779b1 + salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
};

const nightStarUnit = (index: number, salt: number) =>
  hashNightStar(index, salt) / 0x1_0000_0000;

const PARK_NIGHT_STARS: readonly ParkNightStar[] = Array.from(
  { length: PARK_NIGHT_STAR_BACKGROUND_COUNT + PARK_NIGHT_STAR_BAND_COUNT },
  (_, index): ParkNightStar => {
    const isGalacticBand = index >= PARK_NIGHT_STAR_BACKGROUND_COUNT;
    const x = nightStarUnit(index, 0x243f6a88) * PARK_NIGHT_STAR_FIELD_WIDTH;
    const scatteredY = 5 + nightStarUnit(index, 0x85a308d3) * 109;
    const bandCenter = 46
      + Math.sin(x / PARK_NIGHT_STAR_FIELD_WIDTH * Math.PI * 1.35 - 0.7) * 23;
    const bandOffset = (
      nightStarUnit(index, 0x13198a2e)
      + nightStarUnit(index, 0x03707344)
      + nightStarUnit(index, 0xa4093822)
      - 1.5
    ) * 31;
    const y = isGalacticBand
      ? Math.max(5, Math.min(114, bandCenter + bandOffset))
      : scatteredY;
    const magnitude = nightStarUnit(index, 0x299f31d0);
    const size = magnitude > 0.96 ? 3 : magnitude > 0.78 ? 2 : 1;
    const colorRoll = nightStarUnit(index, 0x082efa98);
    const color = colorRoll < 0.09
      ? "#f3dfb8"
      : colorRoll < 0.15
        ? "#c8ddf4"
        : "#dce7ee";
    const brightness = 0.3 + Math.pow(magnitude, 1.65) * 0.62;
    return {
      x,
      y,
      size,
      color,
      alpha: brightness * (isGalacticBand ? 0.72 : 1),
      twinkleAmount: 0.05 + magnitude * 0.11,
      twinklePeriodMs: 1450 + nightStarUnit(index, 0x452821e6) * 2100,
      phase: nightStarUnit(index, 0x38d01377) * Math.PI * 2,
      isGalacticBand,
    };
  },
);

const drawMovingNightSky = (
  ctx: CanvasRenderingContext2D,
  visual: ParkTimeVisual,
  celestial: ParkCelestialPosition,
  nowMs: number,
) => {
  if (visual.nightStrength <= 0.03) return;
  const travel = celestial.progress * 175;
  PARK_NIGHT_STARS.forEach((star) => {
    const worldX = (star.x + travel) % PARK_NIGHT_STAR_FIELD_WIDTH;
    const x = Math.round(worldX - 90);
    const y = Math.round(star.y);
    const horizonAmount = Math.max(0, Math.min(1, (star.y - 88) / 28));
    const horizonFade = 1 - horizonAmount * horizonAmount * (3 - 2 * horizonAmount) * 0.68;
    const twinkle = 1
      + Math.sin(nowMs / star.twinklePeriodMs * Math.PI * 2 + star.phase)
      * star.twinkleAmount;
    ctx.globalAlpha = visual.nightStrength * star.alpha * horizonFade * twinkle;
    ctx.fillStyle = star.color;
    if (star.size === 3) {
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y - 1, 1, 3);
    } else {
      ctx.fillRect(x, y, star.size, star.size);
    }
  });
  ctx.globalAlpha = 1;
};

type ParkCloudVariantBlend = {
  from: ParkCloudLightVariant;
  to: ParkCloudLightVariant;
  mix: number;
};

const smoothCloudMix = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
};

const resolveParkCloudVariantBlend = (hour: number): ParkCloudVariantBlend => {
  if (hour >= 4.5 && hour < 6.5) {
    return { from: "noon", to: "dawn", mix: smoothCloudMix((hour - 4.5) / 2) };
  }
  if (hour >= 6.5 && hour < 11.5) {
    return { from: "dawn", to: "noon", mix: smoothCloudMix((hour - 6.5) / 5) };
  }
  if (hour >= 15.5 && hour < 18.3) {
    return { from: "noon", to: "sunset", mix: smoothCloudMix((hour - 15.5) / 2.8) };
  }
  if (hour >= 18.3 && hour < 20.5) {
    return { from: "sunset", to: "noon", mix: smoothCloudMix((hour - 18.3) / 2.2) };
  }
  return { from: "noon", to: "noon", mix: 0 };
};

const blendedCloudCache = new WeakMap<
  ParkCloudAtlasStyle,
  { canvas: HTMLCanvasElement; key: string }
>();
let blendedCloudCornerAlpha = 0;

const blendedCloud = (
  style: ParkCloudAtlasStyle,
  visual: ParkTimeVisual,
) => {
  const blend = resolveParkCloudVariantBlend(visual.hour);
  const quantizedMix = Math.round(blend.mix * 64) / 64;
  const quantizedNight = Math.round(visual.nightStrength * 64) / 64;
  const key = `${blend.from}/${blend.to}/${quantizedMix}/${quantizedNight}/${visual.cloudShadow.join("-")}`;
  const cached = blendedCloudCache.get(style);
  if (cached?.key === key) return cached.canvas;
  const canvas = cached?.canvas ?? document.createElement("canvas");
  if (!cached) {
    canvas.width = style.width;
    canvas.height = style.height;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(style.variants[blend.from], 0, 0);
  if (blend.to !== blend.from && quantizedMix > 0) {
    ctx.globalAlpha = quantizedMix;
    ctx.drawImage(style.variants[blend.to], 0, 0);
    ctx.globalAlpha = 1;
  }
  if (quantizedNight > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = quantizedNight * 0.72;
    ctx.fillStyle = rgbColor(visual.cloudShadow);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
  const corners = [
    ctx.getImageData(0, 0, 1, 1).data[3] ?? 0,
    ctx.getImageData(canvas.width - 1, 0, 1, 1).data[3] ?? 0,
    ctx.getImageData(0, canvas.height - 1, 1, 1).data[3] ?? 0,
    ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[3] ?? 0,
  ];
  blendedCloudCornerAlpha = Math.max(blendedCloudCornerAlpha, ...corners);
  blendedCloudCache.set(style, { canvas, key });
  return canvas;
};

const PARK_CLOUD_DRAW_REFERENCE_HEIGHT = 227;
const PARK_CLOUD_TRAVEL_REFERENCE_HEIGHT = 454;
const PARK_CLOUD_LANES = [
  { styleSequence: [0], y: -41.5, speed: 0.0027, gap: 520, offset: 90, alpha: 1, scale: 0.684 },
  { styleSequence: [1], y: -25, speed: 0.00205, gap: 590, offset: 760, alpha: 1, scale: 0.612 },
  { styleSequence: [2], y: -5, speed: 0.00335, gap: 470, offset: 330, alpha: 1, scale: 0.522 },
  { styleSequence: [3, 4], y: -2.5, speed: 0.0068, gap: 630, offset: 1120, alpha: 1, scale: 0.378 },
  { styleSequence: [5, 6], y: 1.5, speed: 0.0075, gap: 680, offset: 1510, alpha: 1, scale: 0.252 },
  { styleSequence: [7], y: 8.5, speed: 0.0059, gap: 760, offset: 1840, alpha: 1, scale: 0.216 },
] as const;

const drawMovingCloudLayer = (
  ctx: CanvasRenderingContext2D,
  visual: ParkTimeVisual,
  nowMs: number,
) => {
  ensureParkCloudAtlas();
  const styles = getParkCloudAtlasStyles();
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  PARK_CLOUD_LANES.forEach((lane) => {
    const sequenceStyles = lane.styleSequence
      .map((styleIndex) => styles[styleIndex])
      .filter((style): style is ParkCloudAtlasStyle => Boolean(style));
    if (sequenceStyles.length !== lane.styleSequence.length) return;
    const targetContentHeight = PARK_CLOUD_DRAW_REFERENCE_HEIGHT * lane.scale;
    const travelContentHeight = PARK_CLOUD_TRAVEL_REFERENCE_HEIGHT * lane.scale;
    const travelWidth = Math.max(
      ...sequenceStyles.map((style) =>
        travelContentHeight * style.contentWidth / style.contentHeight),
    );
    const trackLength = PARK_SCENE_WIDTH + travelWidth + lane.gap;
    const travel = nowMs * lane.speed + lane.offset;
    const cycleIndex = Math.floor(travel / trackLength);
    const sequenceIndex = ((cycleIndex % lane.styleSequence.length) + lane.styleSequence.length)
      % lane.styleSequence.length;
    const style = styles[lane.styleSequence[sequenceIndex]!];
    if (!style) return;
    const sprite = blendedCloud(style, visual);
    const scale = targetContentHeight / style.contentHeight;
    const drawWidth = sprite.width * scale;
    const drawHeight = sprite.height * scale;
    const phase = travel % trackLength;
    const x = phase - travelWidth - lane.gap / 2 + (travelWidth - drawWidth) / 2;
    if (x + drawWidth <= 0 || x >= PARK_SCENE_WIDTH) return;
    ctx.globalAlpha = lane.alpha;
    ctx.drawImage(sprite, x, lane.y, drawWidth, drawHeight);
  });
  ctx.restore();
};

const drawTerrainMotion = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  nowMs: number,
) => {
  const gust = Math.max(0, Math.sin(nowMs / 5200) - 0.7) / 0.3;
  if (gust <= 0) return;
  ctx.save();
  ctx.globalAlpha = gust * 0.3;
  for (let y = 345; y < 780; y += 19) {
    const shift = Math.round(Math.sin(nowMs / 260 + y * 0.21) * 3 * gust);
    ctx.drawImage(layers.neutralBase, 255, y, 580, 3, 255 + shift, y, 580, 3);
  }
  ctx.restore();
};

const objectShadowCaster = (object: ParkObjectPlacement): ParkReferenceShadowCaster => {
  const dimensions: Record<ParkObjectPlacement["kind"], [number, number, number]> = {
    tree: [70, 132, 0.74],
    flowers: [24, 30, 0.28],
    shrub: [44, 58, 0.42],
    rock: [42, 48, 0.45],
    bench: [62, 58, 0.46],
    lamp: [22, 74, 0.5],
  };
  const [width, length, strength] = dimensions[object.kind];
  return { x: object.x, y: object.y, width, length, strength };
};

const drawProjectedShadow = (
  ctx: CanvasRenderingContext2D,
  caster: ParkReferenceShadowCaster,
  celestial: ParkCelestialPosition,
  visual: ParkTimeVisual,
) => {
  const horizontal = caster.x - celestial.x;
  const horizontalDirection = horizontal / Math.max(160, Math.abs(horizontal));
  const lengthFactor = 0.28 + (1 - celestial.elevation) * 0.9;
  const distanceX = horizontalDirection * caster.length * lengthFactor;
  const distanceY = caster.length * (0.12 + (1 - celestial.elevation) * 0.18);
  const steps = Math.max(5, Math.round(distanceY / 3));
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = celestial.kind === "sun"
    ? rgbColor(visual.cloudShadow)
    : "#283852";
  ctx.globalAlpha = caster.strength * celestial.strength * (celestial.kind === "sun" ? 0.46 : 0.2);
  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    const centerX = caster.x + distanceX * amount;
    const centerY = caster.y + distanceY * amount;
    const halfWidth = caster.width * (0.5 - amount * 0.32);
    ctx.fillRect(
      Math.round(centerX - halfWidth),
      Math.round(centerY + step * 0.12),
      Math.max(2, Math.round(halfWidth * 2)),
      3,
    );
  }
  ctx.restore();
};

const drawDynamicShadows = (
  ctx: CanvasRenderingContext2D,
  objects: ParkObjectPlacement[],
  celestial: ParkCelestialPosition,
  visual: ParkTimeVisual,
) => {
  PARK_REFERENCE_SHADOW_CASTERS.forEach((caster) =>
    drawProjectedShadow(ctx, caster, celestial, visual));
  objects.forEach((object) =>
    drawProjectedShadow(ctx, objectShadowCaster(object), celestial, visual));
};

let waterLightCanvas: HTMLCanvasElement | null = null;
let shoreFoamMotionCanvas: HTMLCanvasElement | null = null;
let shoreFoamHighlightCanvas: HTMLCanvasElement | null = null;
let shoreFoamFringeCanvas: HTMLCanvasElement | null = null;
let pondSurfaceCanvas: HTMLCanvasElement | null = null;
let pondTextureCanvas: HTMLCanvasElement | null = null;
let pondLargeHighlightTextures: HTMLCanvasElement[] | null = null;
let pondLargeLowlightTextures: HTMLCanvasElement[] | null = null;
let pondFineHighlightTextures: HTMLCanvasElement[] | null = null;
let pondFineLowlightTextures: HTMLCanvasElement[] | null = null;

type PondTextureColor = readonly [number, number, number, number];

const PARK_POND_MORPH_FRAME_COUNT = 8;
const PARK_POND_LARGE_MORPH_PERIOD_MS = 22_000;
const PARK_POND_FINE_MORPH_PERIOD_MS = 17_000;

type PondTravellingHighlight = {
  phase: number;
  frequency: number;
  strength: number;
  sharpness: number;
};

const pondHash = (x: number, y: number, salt: number) => {
  let value = Math.imul(x ^ salt, 0x45d9f3b) ^ Math.imul(y + salt, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
};

const makePondCellularTexture = (
  tileSize: number,
  cellSize: number,
  salt: number,
  verticalScale: number,
  color: PondTextureColor,
  morphPhase: number,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = tileSize;
  canvas.height = Math.round(tileSize * verticalScale);
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  const cellHeight = Math.max(4, Math.round(cellSize * verticalScale));
  const cellCountX = Math.round(canvas.width / cellSize);
  const cellCountY = Math.round(canvas.height / cellHeight);
  const wrapCellX = (value: number) => ((value % cellCountX) + cellCountX) % cellCountX;
  const wrapCellY = (value: number) => ((value % cellCountY) + cellCountY) % cellCountY;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const baseCellX = Math.floor(x / cellSize);
      const baseCellY = Math.floor(y / cellHeight);
      let nearest = Number.POSITIVE_INFINITY;
      let secondNearest = Number.POSITIVE_INFINITY;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const cellX = baseCellX + offsetX;
          const cellY = baseCellY + offsetY;
          const wrappedX = wrapCellX(cellX);
          const wrappedY = wrapCellY(cellY);
          const hashX = pondHash(wrappedX, wrappedY, salt);
          const hashY = pondHash(wrappedX, wrappedY, salt ^ 0x9e3779b9);
          const morphX = Math.sin(
            morphPhase + wrappedX * 1.91 + wrappedY * 0.73 + salt * 0.00011,
          ) * cellSize * 0.055;
          const morphY = Math.cos(
            morphPhase + wrappedX * 0.64 - wrappedY * 1.37 + salt * 0.00017,
          ) * cellHeight * 0.085;
          const centerX = (cellX + 0.22 + (hashX % 560) / 1000) * cellSize + morphX;
          const centerY = (cellY + 0.22 + (hashY % 560) / 1000) * cellHeight + morphY;
          const deltaX = x - centerX;
          const deltaY = (y - centerY) / verticalScale;
          const distance = deltaX * deltaX + deltaY * deltaY;
          if (distance < nearest) {
            secondNearest = nearest;
            nearest = distance;
          } else if (distance < secondNearest) {
            secondNearest = distance;
          }
        }
      }
      const boundaryDistance = secondNearest - nearest;
      const lineWidth = cellSize * 1.7;
      if (boundaryDistance > lineWidth) continue;
      const brokenContour = pondHash(x >> 1, y >> 1, salt ^ 0x85ebca6b) % 17;
      if (brokenContour === 0) continue;
      const strength = 1 - boundaryDistance / lineWidth;
      const offset = (y * canvas.width + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = Math.round(color[3] * (strength > 0.58 ? 1 : 0.55));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

const makePondTextureSequence = (
  tileSize: number,
  cellSize: number,
  salt: number,
  verticalScale: number,
  color: PondTextureColor,
) => Array.from(
  { length: PARK_POND_MORPH_FRAME_COUNT },
  (_, frameIndex) => makePondCellularTexture(
    tileSize,
    cellSize,
    salt,
    verticalScale,
    color,
    frameIndex / PARK_POND_MORPH_FRAME_COUNT * Math.PI * 2,
  ),
);

const ensurePondTextures = () => {
  if (!pondSurfaceCanvas) {
    pondSurfaceCanvas = document.createElement("canvas");
    pondSurfaceCanvas.width = PARK_SCENE_WIDTH;
    pondSurfaceCanvas.height = PARK_SCENE_HEIGHT;
  }
  if (!pondTextureCanvas) {
    pondTextureCanvas = document.createElement("canvas");
    pondTextureCanvas.width = PARK_SCENE_WIDTH;
    pondTextureCanvas.height = PARK_SCENE_HEIGHT;
  }
  pondLargeHighlightTextures ??= makePondTextureSequence(224, 28, 0x1374, 0.5, [167, 226, 216, 190]);
  pondLargeLowlightTextures ??= makePondTextureSequence(224, 28, 0x1374, 0.5, [8, 47, 72, 158]);
  pondFineHighlightTextures ??= makePondTextureSequence(168, 14, 0x5b21, 0.5, [220, 246, 235, 136]);
  pondFineLowlightTextures ??= makePondTextureSequence(168, 14, 0x5b21, 0.5, [64, 111, 124, 104]);
};

const drawTiledPondTexture = (
  ctx: CanvasRenderingContext2D,
  textures: readonly HTMLCanvasElement[],
  offsetX: number,
  offsetY: number,
  alpha: number,
  wavePhase: number,
  waveAmplitude: number,
  waveFrequency: number,
  morphProgress: number,
  travellingHighlight?: PondTravellingHighlight,
) => {
  const texture = textures[0]!;
  const textureLayer = pondTextureCanvas!.getContext("2d")!;
  textureLayer.setTransform(1, 0, 0, 1, 0, 0);
  textureLayer.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  textureLayer.imageSmoothingEnabled = false;
  const startX = -texture.width + ((offsetX % texture.width) + texture.width) % texture.width;
  const startY = 405 - texture.height + ((offsetY % texture.height) + texture.height) % texture.height;
  const wrappedMorphProgress = ((morphProgress % 1) + 1) % 1;
  const morphPosition = wrappedMorphProgress * textures.length;
  const morphFrame = Math.floor(morphPosition) % textures.length;
  const nextMorphFrame = (morphFrame + 1) % textures.length;
  const rawMorphMix = morphPosition - Math.floor(morphPosition);
  const morphMix = rawMorphMix * rawMorphMix * (3 - 2 * rawMorphMix);
  for (let y = startY; y < PARK_SCENE_HEIGHT; y += texture.height) {
    for (let x = startX; x < PARK_SCENE_WIDTH; x += texture.width) {
      textureLayer.globalAlpha = 1 - morphMix;
      textureLayer.drawImage(textures[morphFrame]!, x, y);
      textureLayer.globalAlpha = morphMix;
      textureLayer.drawImage(textures[nextMorphFrame]!, x, y);
    }
  }
  textureLayer.globalAlpha = 1;

  // Deform the tiled field in two-pixel horizontal ribbons. Blending the two
  // neighbouring integer offsets keeps the pixel art crisp without snapping,
  // while the secondary sine prevents the surface from moving as one rigid net.
  const stripHeight = 2;
  for (let y = 405; y < PARK_SCENE_HEIGHT; y += stripHeight) {
    const primaryWave = Math.sin(y * waveFrequency + wavePhase) * waveAmplitude;
    const secondaryWave = Math.sin(y * waveFrequency * 0.47 - wavePhase * 0.73)
      * waveAmplitude * 0.36;
    const waveOffset = primaryWave + secondaryWave;
    const crestWave = travellingHighlight
      ? 0.5 + Math.sin(y * travellingHighlight.frequency - travellingHighlight.phase) * 0.5
      : 0;
    const travellingCrest = travellingHighlight
      ? Math.pow(crestWave, travellingHighlight.sharpness) * travellingHighlight.strength
      : 0;
    const stripAlpha = Math.min(1, alpha + travellingCrest);
    const lowerOffset = Math.floor(waveOffset);
    const offsetMix = waveOffset - lowerOffset;
    const height = Math.min(stripHeight, PARK_SCENE_HEIGHT - y);
    ctx.globalAlpha = stripAlpha * (1 - offsetMix);
    ctx.drawImage(
      pondTextureCanvas!,
      730,
      y,
      450,
      height,
      730 + lowerOffset,
      y,
      450,
      height,
    );
    ctx.globalAlpha = stripAlpha * offsetMix;
    ctx.drawImage(
      pondTextureCanvas!,
      730,
      y,
      450,
      height,
      731 + lowerOffset,
      y,
      450,
      height,
    );
  }
};

const drawPixelPondRing = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
) => {
  for (let x = -radiusX; x <= radiusX; x += 2) {
    const normalizedX = x / Math.max(1, radiusX);
    const y = Math.round(radiusY * Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX)));
    ctx.fillRect(Math.round(centerX + x), Math.round(centerY - y), 3, 1);
    if (y > 1) ctx.fillRect(Math.round(centerX + x), Math.round(centerY + y), 3, 1);
  }
};

const PARK_POND_RIPPLES = [
  { x: 1102, y: 548, periodMs: 7600, phase: 0.1 },
  { x: 1018, y: 674, periodMs: 9100, phase: 0.46 },
  { x: 1128, y: 786, periodMs: 8300, phase: 0.73 },
  { x: 950, y: 824, periodMs: 10_200, phase: 0.31 },
] as const;
const PARK_POND_WAVE_PARTICLE_COUNT = 26;
const PARK_POND_GLIMMER_COUNT = 13;

const drawPondSurface = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  nowMs: number,
) => {
  ensurePondTextures();
  const surface = pondSurfaceCanvas!.getContext("2d")!;
  surface.setTransform(1, 0, 0, 1, 0, 0);
  surface.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  surface.imageSmoothingEnabled = false;

  // Flat colour and land shadow establish depth before the two independently
  // drifting cellular layers reproduce the reference shader's surface flow.
  surface.globalCompositeOperation = "source-over";
  surface.globalAlpha = 0.13;
  surface.fillStyle = "#207f96";
  surface.fillRect(730, 405, 450, 495);

  const largeWobbleX = Math.sin(nowMs / 7800) * 2;
  const largeWobbleY = Math.sin(nowMs / 10_400 + 0.8) * 1.5;
  const fineWobbleX = Math.sin(nowMs / 5100 + 1.4) * 1.5;
  const fineWobbleY = Math.sin(nowMs / 6800 + 2.1);
  surface.globalCompositeOperation = "multiply";
  drawTiledPondTexture(
    surface,
    pondLargeLowlightTextures!,
    nowMs * 0.0018 + largeWobbleX,
    nowMs * 0.00055 + largeWobbleY,
    0.28,
    nowMs / 1900,
    4.2,
    0.038,
    nowMs / PARK_POND_LARGE_MORPH_PERIOD_MS,
  );
  drawTiledPondTexture(
    surface,
    pondFineLowlightTextures!,
    -nowMs * 0.0025 + fineWobbleX,
    nowMs * 0.0011 + fineWobbleY,
    0.18,
    nowMs / 1450 + 1.3,
    2.6,
    0.061,
    nowMs / PARK_POND_FINE_MORPH_PERIOD_MS,
  );
  surface.globalCompositeOperation = "screen";
  drawTiledPondTexture(
    surface,
    pondLargeHighlightTextures!,
    nowMs * 0.0018 + largeWobbleX + 2,
    nowMs * 0.00055 + largeWobbleY - 1,
    0.32,
    nowMs / 2100 + 0.7,
    3.7,
    0.036,
    nowMs / PARK_POND_LARGE_MORPH_PERIOD_MS,
    {
      phase: nowMs / 680,
      frequency: 0.049,
      strength: 0.42,
      sharpness: 9,
    },
  );
  drawTiledPondTexture(
    surface,
    pondFineHighlightTextures!,
    -nowMs * 0.0025 + fineWobbleX - 1,
    nowMs * 0.0011 + fineWobbleY + 1,
    0.2,
    nowMs / 1250 + 2.1,
    2.3,
    0.066,
    nowMs / PARK_POND_FINE_MORPH_PERIOD_MS,
  );

  // Ring particles expand and fade at separate rhythms, so the pond never
  // pulses as a single synchronized sheet.
  surface.globalCompositeOperation = "screen";
  surface.fillStyle = "#a6ded3";
  PARK_POND_RIPPLES.forEach((ripple) => {
    const phase = (nowMs / ripple.periodMs + ripple.phase) % 1;
    const life = smootherstep(Math.min(1, phase / 0.18))
      * (1 - smootherstep(Math.max(0, (phase - 0.55) / 0.45)));
    surface.globalAlpha = life * 0.3;
    drawPixelPondRing(
      surface,
      ripple.x,
      ripple.y,
      5 + Math.round(phase * 34),
      2 + Math.round(phase * 10),
    );
  });

  // Short drifting wave particles and sparse glimmers provide the final two
  // shader passes without introducing frame-random flicker.
  for (let index = 0; index < PARK_POND_WAVE_PARTICLE_COUNT; index += 1) {
    const periodMs = 5200 + (index % 7) * 610;
    const phase = (nowMs / periodMs + (pondHash(index, 19, 0x4ca7) % 1000) / 1000) % 1;
    const x = 846 + ((index * 83 + index * index * 17) % 346) + Math.sin(phase * Math.PI * 2) * 4;
    const y = 452 + ((index * 137 + 31) % 444) - phase * 6;
    const pulse = Math.sin(phase * Math.PI);
    surface.globalAlpha = pulse * 0.24;
    surface.fillStyle = index % 4 === 0 ? "#d5eee0" : "#83c8c8";
    surface.fillRect(Math.round(x), Math.round(y), 2 + (index % 5), 1);
  }
  for (let index = 0; index < PARK_POND_GLIMMER_COUNT; index += 1) {
    const phase = nowMs / (2400 + (index % 5) * 390) + index * 1.79;
    const pulse = Math.pow(0.5 + Math.sin(phase) * 0.5, 6);
    if (pulse < 0.14) continue;
    const x = 868 + ((index * 149 + 23) % 320);
    const y = 472 + ((index * 193 + 71) % 418);
    surface.globalAlpha = pulse * 0.58;
    surface.fillStyle = "#e6f4d7";
    surface.fillRect(x - 3, y, 7, 1);
    surface.fillRect(x, y - 2, 1, 5);
  }

  surface.globalCompositeOperation = "destination-in";
  surface.globalAlpha = 1;
  surface.drawImage(layers.pondInteriorMask, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(pondSurfaceCanvas!, 0, 0);
  ctx.restore();

  // Darken the bank-facing water, then restore a one-pixel inner land edge.
  // Both masks are derived from the exact connected pond component.
  surface.globalCompositeOperation = "source-over";
  surface.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  surface.globalAlpha = 1;
  surface.fillStyle = "#083e59";
  surface.fillRect(730, 405, 450, 495);
  surface.globalCompositeOperation = "destination-in";
  surface.drawImage(layers.pondEdgeMask, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.32;
  ctx.drawImage(pondSurfaceCanvas!, 0, 0);
  ctx.restore();

  surface.globalCompositeOperation = "source-over";
  surface.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  surface.fillStyle = "#b8ddc8";
  surface.fillRect(730, 405, 450, 495);
  surface.globalCompositeOperation = "destination-in";
  surface.drawImage(layers.pondRimMask, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.16;
  ctx.drawImage(pondSurfaceCanvas!, 0, 0);
  ctx.restore();
};

const PARK_SEA_FINE_GLINT_COUNT = 260;
const PARK_SEA_WAVE_GLINT_COUNT = 104;
const PARK_SEA_SPARKLE_COUNT = 34;
const PARK_SEA_SPARKLE_TOTAL = PARK_SEA_FINE_GLINT_COUNT
  + PARK_SEA_WAVE_GLINT_COUNT
  + PARK_SEA_SPARKLE_COUNT;

const resolveShoreFoamBreath = (nowMs: number) => {
  const primary = 0.5 + Math.sin(nowMs / 675) * 0.5;
  const secondary = 0.5 + Math.sin(nowMs / 1025 + 1.35) * 0.5;
  return primary * 0.72 + secondary * 0.28;
};

const smootherstep = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
};

const drawSeaLighting = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  visual: ParkTimeVisual,
  nowMs: number,
) => {
  if (!waterLightCanvas) {
    waterLightCanvas = document.createElement("canvas");
    waterLightCanvas.width = PARK_SCENE_WIDTH;
    waterLightCanvas.height = PARK_SCENE_HEIGHT;
  }
  const light = waterLightCanvas.getContext("2d")!;
  light.setTransform(1, 0, 0, 1, 0, 0);
  light.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);

  const dawnWarmth = Math.max(0, 1 - Math.abs(visual.hour - 6.5) / 2.3);
  const duskWarmth = Math.max(0, 1 - Math.abs(visual.hour - 18.25) / 2.6);
  const warmStrength = Math.max(dawnWarmth, duskWarmth);
  const nightDimming = 1 - visual.nightStrength * 0.58;
  const brightColor = lerpRgb(
    visual.reflection,
    warmStrength > 0.04 ? [255, 236, 190] : [240, 252, 250],
    0.62,
  );
  const softColor = lerpRgb(
    visual.reflection,
    warmStrength > 0.04 ? [222, 181, 142] : [139, 205, 215],
    0.42,
  );
  const coolColor = lerpRgb(visual.reflection, [112, 178, 207], 0.5);

  // Distant pinpricks form a dense, slow-moving glitter field. Their short
  // strokes keep the authored pixel texture readable near the horizon.
  for (let index = 0; index < PARK_SEA_FINE_GLINT_COUNT; index += 1) {
    const y = 126 + ((index * 47) % 286);
    const depth = Math.max(0, Math.min(1, (y - PARK_HORIZON_Y) / 292));
    const drift = Math.sin(nowMs / (7200 + (index % 7) * 610) + index * 1.73)
      * (0.8 + depth * 4.2);
    const lift = Math.sin(nowMs / (11_500 + (index % 5) * 860) + index * 0.61)
      * (0.35 + depth * 0.85);
    const x = ((index * 97 + index * index * 13) % PARK_SCENE_WIDTH) + drift;
    const widthRange = Math.max(3, Math.round(5 + depth * 10));
    const width = 1 + ((index * 11) % widthRange);
    const twinkle = 0.5
      + Math.sin(nowMs / (1850 + (index % 6) * 260) + index * 2.17) * 0.5;
    const crest = Math.pow(twinkle, 2.2);
    light.globalAlpha = (0.08 + crest * (0.2 + depth * 0.12)) * nightDimming;
    const glintColor = index % 6 === 0
      ? brightColor
      : index % 3 === 0
        ? coolColor
        : softColor;
    light.fillStyle = rgbColor(glintColor);
    light.fillRect(
      Math.round(x),
      Math.round(y + lift),
      width,
      index % 19 === 0 && crest > 0.62 ? 2 : 1,
    );
  }

  // Mid-distance broken wave crests travel more slowly and brighten in
  // sequence, creating the impression of broad ripples catching the light.
  for (let index = 0; index < PARK_SEA_WAVE_GLINT_COUNT; index += 1) {
    const y = 150 + ((index * 67) % 260);
    const depth = Math.max(0, Math.min(1, (y - PARK_HORIZON_Y) / 292));
    const x = ((index * 181 + 47) % PARK_SCENE_WIDTH)
      + Math.sin(nowMs / (12_500 + (index % 4) * 1150) + index * 1.19)
        * (1.5 + depth * 5);
    const width = 4 + ((index * 7) % Math.max(7, Math.round(9 + depth * 17)));
    const wave = 0.5
      + Math.sin(nowMs / (3150 + (index % 5) * 390) + index * 0.93) * 0.5;
    const waveCrest = Math.pow(wave, 1.7);
    light.globalAlpha = (0.055 + waveCrest * (0.18 + depth * 0.08)) * nightDimming;
    light.fillStyle = rgbColor(index % 4 === 0 ? brightColor : softColor);
    const drawX = Math.round(x);
    light.fillRect(drawX, y, width, 1);
    if (width >= 11 && index % 3 === 0) {
      light.globalAlpha *= 0.48;
      light.fillRect(drawX + 3, y + 2, Math.max(2, Math.round(width * 0.45)), 1);
    }
  }

  // A few smooth flare pulses provide the unmistakable "sparkling" beat.
  // They remain pixel crosses rather than soft particles, matching the scene.
  for (let index = 0; index < PARK_SEA_SPARKLE_COUNT; index += 1) {
    const y = 132 + ((index * 83) % 270);
    const depth = Math.max(0, Math.min(1, (y - PARK_HORIZON_Y) / 292));
    const x = ((index * 211 + index * index * 29 + 73) % PARK_SCENE_WIDTH)
      + Math.sin(nowMs / (9800 + (index % 4) * 780) + index * 0.71)
        * (1 + depth * 3.5);
    const pulse = Math.max(
      0,
      Math.sin(nowMs / (1250 + (index % 6) * 190) + index * 2.43),
    );
    const flare = Math.pow(pulse, 5);
    if (flare < 0.025) continue;
    const radius = flare > 0.68 ? 3 + (index % 2) : 2;
    const drawX = Math.round(x);
    light.fillStyle = rgbColor(brightColor);
    light.globalAlpha = (0.08 + flare * 0.66) * nightDimming;
    light.fillRect(drawX - radius, y, radius * 2 + 1, 1);
    light.fillRect(drawX, y - Math.max(1, radius - 1), 1, Math.max(3, radius * 2 - 1));
    if (flare > 0.76) {
      light.globalAlpha *= 0.42;
      light.fillRect(drawX - 1, y - 1, 3, 3);
    }
  }

  light.globalCompositeOperation = "destination-in";
  light.globalAlpha = 1;
  light.drawImage(layers.seaMotionMask, 0, 0);
  light.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 1 - visual.nightStrength * 0.32;
  ctx.drawImage(waterLightCanvas, 0, 0);
  ctx.restore();
};

const drawShoreFoamBreath = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  visual: ParkTimeVisual,
  breath: number,
  nowMs: number,
) => {
  const nightDimming = 1 - visual.nightStrength * 0.62;
  const drawFoamBand = (
    mask: HTMLCanvasElement,
    alpha: number,
  ) => {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = alpha * nightDimming;
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  };

  const outerExpansion = Math.max(0, Math.min(1, (breath - 0.18) / 0.82));
  drawFoamBand(layers.shoreFoamOuterMask, 0.1 + outerExpansion * 0.22);
  drawFoamBand(layers.shoreFoamInnerMask, 0.44 + breath * 0.28);

  if (!shoreFoamMotionCanvas) {
    shoreFoamMotionCanvas = document.createElement("canvas");
    shoreFoamMotionCanvas.width = PARK_SCENE_WIDTH;
    shoreFoamMotionCanvas.height = PARK_SCENE_HEIGHT;
  }
  if (!shoreFoamHighlightCanvas) {
    shoreFoamHighlightCanvas = document.createElement("canvas");
    shoreFoamHighlightCanvas.width = PARK_SCENE_WIDTH;
    shoreFoamHighlightCanvas.height = PARK_SCENE_HEIGHT;
  }
  if (!shoreFoamFringeCanvas) {
    shoreFoamFringeCanvas = document.createElement("canvas");
    shoreFoamFringeCanvas.width = PARK_SCENE_WIDTH;
    shoreFoamFringeCanvas.height = PARK_SCENE_HEIGHT;
  }
  const motion = shoreFoamMotionCanvas.getContext("2d")!;
  const highlight = shoreFoamHighlightCanvas.getContext("2d")!;
  const fringe = shoreFoamFringeCanvas.getContext("2d")!;
  motion.setTransform(1, 0, 0, 1, 0, 0);
  motion.globalCompositeOperation = "source-over";
  motion.globalAlpha = 1;
  motion.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  motion.imageSmoothingEnabled = false;
  highlight.setTransform(1, 0, 0, 1, 0, 0);
  highlight.globalCompositeOperation = "source-over";
  highlight.globalAlpha = 1;
  highlight.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  highlight.imageSmoothingEnabled = false;
  fringe.setTransform(1, 0, 0, 1, 0, 0);
  fringe.globalCompositeOperation = "source-over";
  fringe.globalAlpha = 1;
  fringe.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  fringe.imageSmoothingEnabled = false;
  let interpolatingSegments = 0;
  let breathingFringeSegments = 0;
  layers.shoreFoamSegments.forEach((segment) => {
    const cycle = (nowMs / segment.periodMs + segment.phase / (Math.PI * 2)) % 1;
    const riseAndFall = cycle < segment.inhaleRatio
      ? cycle / segment.inhaleRatio
      : (1 - cycle) / (1 - segment.inhaleRatio);
    const localBreath = smootherstep(riseAndFall);
    const directionLength = Math.hypot(segment.directionX, segment.directionY);
    const distanceSteps = segment.amplitudePx * localBreath / Math.max(1, directionLength);
    const lowerStep = Math.floor(distanceSteps);
    const mix = distanceSteps - lowerStep;
    if (mix > 0.01 && mix < 0.99) interpolatingSegments += 1;
    const coreAlpha = 0.62 + localBreath * 0.38;
    const highlightAlpha = 0.02 + localBreath * 0.26;
    const drawAtStep = (
      target: CanvasRenderingContext2D,
      step: number,
      alpha: number,
    ) => {
      if (alpha <= 0.001) return;
      target.globalAlpha = alpha;
      target.drawImage(
        segment.canvas,
        segment.x + segment.directionX * step,
        segment.y + segment.directionY * step,
      );
    };
    drawAtStep(motion, lowerStep, coreAlpha * (1 - mix));
    drawAtStep(motion, lowerStep + 1, coreAlpha * mix);
    drawAtStep(highlight, lowerStep, highlightAlpha * (1 - mix));
    drawAtStep(highlight, lowerStep + 1, highlightAlpha * mix);

    const fringeBreath = smootherstep((localBreath - 0.28) / 0.72);
    const fringeAlpha = fringeBreath * 0.3;
    if (fringeAlpha > 0.01) breathingFringeSegments += 1;
    const fringeDistanceSteps = distanceSteps + fringeBreath * 0.75;
    const fringeLowerStep = Math.floor(fringeDistanceSteps);
    const fringeMix = fringeDistanceSteps - fringeLowerStep;
    drawAtStep(fringe, fringeLowerStep, fringeAlpha * (1 - fringeMix));
    drawAtStep(fringe, fringeLowerStep + 1, fringeAlpha * fringeMix);
  });
  motion.globalAlpha = 1;
  highlight.globalAlpha = 1;
  fringe.globalAlpha = 1;

  // The mask contains connected water plus the audited authored foam pixels.
  // Both interpolated integer positions therefore remain off cliffs/islands.
  motion.globalCompositeOperation = "destination-in";
  motion.drawImage(layers.shoreFoamMotionMask, 0, 0);
  motion.globalCompositeOperation = "source-over";
  highlight.globalCompositeOperation = "destination-in";
  highlight.drawImage(layers.shoreFoamMotionMask, 0, 0);
  highlight.globalCompositeOperation = "source-over";
  fringe.globalCompositeOperation = "destination-in";
  fringe.drawImage(layers.shoreFoamMotionMask, 0, 0);
  fringe.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = nightDimming;
  ctx.drawImage(shoreFoamMotionCanvas, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = nightDimming;
  ctx.drawImage(shoreFoamHighlightCanvas, 0, 0);
  ctx.drawImage(shoreFoamFringeCanvas, 0, 0);
  ctx.restore();
  return { interpolatingSegments, breathingFringeSegments };
};

const drawReferenceMotion = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  nowMs: number,
) => {
  const cloudShift = Math.round(Math.sin(nowMs / 17_000) * 7);
  const cloudRegions = [
    { x: 0, y: 0, width: 280, height: 105 },
    { x: 320, y: 5, width: 310, height: 115 },
    { x: 720, y: 0, width: 460, height: 122 },
  ];
  ctx.save();
  ctx.globalAlpha = 0.2;
  cloudRegions.forEach((region, index) => {
    const shift = cloudShift * (0.55 + index * 0.23);
    ctx.save();
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.width, region.height);
    ctx.clip();
    ctx.drawImage(
      layers.full,
      region.x,
      region.y,
      region.width,
      region.height,
      Math.round(region.x + shift),
      region.y,
      region.width,
      region.height,
    );
    ctx.restore();
  });
  ctx.restore();

  const shimmerRegions = [
    { x: 0, y: 124, width: 440, height: 190 },
    { x: 690, y: 124, width: 490, height: 250 },
  ];
  ctx.save();
  ctx.globalAlpha = 0.3;
  shimmerRegions.forEach((region, regionIndex) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.width, region.height);
    ctx.clip();
    for (let y = region.y + 2; y < region.y + region.height; y += 7) {
      const shift = Math.round(Math.sin(nowMs / 760 + y * 0.17 + regionIndex) * 3);
      ctx.drawImage(layers.full, region.x, y, region.width, 2, region.x + shift, y, region.width, 2);
    }
    ctx.restore();
  });
  ctx.restore();

  const gust = Math.max(0, Math.sin(nowMs / 5200) - 0.7) / 0.3;
  if (gust > 0) {
    ctx.save();
    ctx.globalAlpha = gust * 0.32;
    for (let y = 345; y < 780; y += 19) {
      const shift = Math.round(Math.sin(nowMs / 260 + y * 0.21) * 3 * gust);
      ctx.drawImage(layers.full, 255, y, 580, 3, 255 + shift, y, 580, 3);
    }
    ctx.restore();
  }
};

const drawReferenceObject = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  object: ParkObjectPlacement,
  frame: number,
) => {
  const stamp = layers.stamps[object.kind];
  if (!stamp) return;
  const sway = object.kind === "tree" ? Math.round(Math.sin(frame / 31 + object.x * 0.01) * 2) : 0;
  ctx.drawImage(
    stamp.canvas,
    Math.round(object.x - stamp.anchorX + sway),
    Math.round(object.y - stamp.anchorY),
  );
};

const applyTimeGrade = (ctx: CanvasRenderingContext2D, visual: ParkTimeVisual) => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 122, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT - 122);
  ctx.clip();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = visual.multiplyAlpha;
  ctx.fillStyle = `rgb(${visual.multiply.join(",")})`;
  ctx.fillRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = visual.screenAlpha;
  ctx.fillStyle = `rgb(${visual.screen.join(",")})`;
  ctx.fillRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  ctx.restore();
};

const coverReferenceSun = (ctx: CanvasRenderingContext2D, layers: ParkReferenceLayers) => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(35, 55, 76, 65);
  ctx.clip();
  ctx.globalAlpha = 0.96;
  ctx.drawImage(layers.full, 118, 55, 76, 65, 35, 55, 76, 65);
  ctx.restore();
};

const drawCelestialLayer = (
  ctx: CanvasRenderingContext2D,
  layers: ParkReferenceLayers,
  visual: ParkTimeVisual,
  nowMs: number,
) => {
  if (visual.hour > 7.15 && visual.hour < 19.3) {
    const progress = Math.max(0, Math.min(1, (visual.hour - 5.6) / 13.7));
    const x = 64 + progress * 1050;
    const y = 102 - Math.sin(progress * Math.PI) * 78;
    ctx.save();
    ctx.globalAlpha = 0.75 + Math.sin(progress * Math.PI) * 0.2;
    ctx.drawImage(layers.sun.canvas, Math.round(x - layers.sun.anchorX), Math.round(y - layers.sun.anchorY));
    ctx.restore();
  }

  if (visual.nightStrength <= 0.05) return;
  ctx.save();
  for (let index = 0; index < 82; index += 1) {
    const x = (index * 157 + 43) % PARK_SCENE_WIDTH;
    const y = (index * 71 + 17) % 116;
    const twinkle = 0.55 + Math.sin(nowMs / 730 + index * 2.1) * 0.35;
    ctx.globalAlpha = visual.nightStrength * twinkle;
    ctx.fillStyle = index % 5 === 0 ? "#fff1ba" : "#d9e7f2";
    ctx.fillRect(x, y, index % 7 === 0 ? 3 : 2, index % 7 === 0 ? 3 : 2);
  }
  const moonProgress = ((visual.hour + 3) % 24) / 10;
  const moonX = 120 + Math.min(1, moonProgress) * 900;
  const moonY = 78 - Math.sin(Math.min(1, moonProgress) * Math.PI) * 42;
  ctx.globalAlpha = visual.nightStrength;
  ctx.fillStyle = "#f4ebc2";
  ctx.fillRect(Math.round(moonX - 9), Math.round(moonY - 15), 19, 31);
  ctx.fillRect(Math.round(moonX - 15), Math.round(moonY - 9), 31, 19);
  ctx.fillStyle = "#b8c7cb";
  ctx.globalAlpha = visual.nightStrength * 0.45;
  ctx.fillRect(Math.round(moonX + 2), Math.round(moonY - 10), 7, 6);
  ctx.fillRect(Math.round(moonX - 7), Math.round(moonY + 4), 5, 4);
  ctx.restore();
};

export interface ParkRenderOptions {
  nowMs: number;
  frame: number;
  objects: ParkObjectPlacement[];
  avatar?: AvatarRuntime;
  avatarAppearanceId?: AvatarAppearanceId;
  petStats?: PetStats;
  memory?: AivatarMemory;
  fishingPose?: ParkFishingPose;
  displayedFish?: ParkRawFishId;
  selectedObjectId?: string;
}

export const renderParkScene = (canvas: HTMLCanvasElement, options: ParkRenderOptions) => {
  if (canvas.width !== PARK_SCENE_WIDTH) canvas.width = PARK_SCENE_WIDTH;
  if (canvas.height !== PARK_SCENE_HEIGHT) canvas.height = PARK_SCENE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
  ctx.imageSmoothingEnabled = false;
  ensureParkReferenceLayers();
  const layers = getParkReferenceLayers();
  if (!layers) {
    ctx.fillStyle = "#152535";
    ctx.fillRect(0, 0, PARK_SCENE_WIDTH, PARK_SCENE_HEIGHT);
    return;
  }
  const lightingNowMs = previewTime(options.nowMs);
  const motionNowMs = options.nowMs;
  const timeVisual = resolveParkTimeVisual(lightingNowMs);
  const celestial = resolveParkCelestialPosition(timeVisual.hour);
  canvas.dataset.parkHour = timeVisual.hour.toFixed(3);
  canvas.dataset.parkCelestial = celestial.kind;
  canvas.dataset.parkCelestialX = celestial.x.toFixed(2);
  canvas.dataset.parkCelestialY = celestial.y.toFixed(2);
  canvas.dataset.parkReflectionX = celestial.x.toFixed(2);
  canvas.dataset.parkShadowDirection = celestial.x < PARK_SCENE_WIDTH / 2 ? "right" : "left";
  canvas.dataset.parkCloudPhase = ((motionNowMs * PARK_CLOUD_LANES[0].speed) % (PARK_SCENE_WIDTH + 740)).toFixed(2);
  canvas.dataset.parkCloudPixels = String(parkCloudAtlasOpaquePixelCount());
  canvas.dataset.parkCloudSource = "imagegen-time-atlas";
  canvas.dataset.parkCloudCornerAlpha = String(blendedCloudCornerAlpha);
  canvas.dataset.parkNightStarCount = String(PARK_NIGHT_STARS.length);
  canvas.dataset.parkNightStarBandCount = String(PARK_NIGHT_STAR_BAND_COUNT);
  canvas.dataset.parkNightStarDistribution = "seeded-field-plus-band";
  canvas.dataset.parkSeaMaskPixels = String(layers.seaMaskPixels);
  canvas.dataset.parkSeaMotionMaskPixels = String(layers.seaMotionMaskPixels);
  canvas.dataset.parkPondMaskPixels = String(layers.pondMaskPixels);
  canvas.dataset.parkPondInteriorMaskPixels = String(layers.pondInteriorMaskPixels);
  canvas.dataset.parkPondEdgeMaskPixels = String(layers.pondEdgeMaskPixels);
  canvas.dataset.parkPondRimMaskPixels = String(layers.pondRimMaskPixels);
  canvas.dataset.parkPondSurfaceLayerCount = "2";
  canvas.dataset.parkPondCellVerticalScale = "0.5";
  canvas.dataset.parkPondWaveStripHeight = "2";
  canvas.dataset.parkPondWaveInterpolation = "adjacent-pixel-crossfade";
  canvas.dataset.parkPondTravellingHighlightLayer = "large-cell";
  canvas.dataset.parkPondTravellingHighlightDirection = "toward-foreground";
  canvas.dataset.parkPondFinePalette = "lightened";
  canvas.dataset.parkPondMorphFrameCount = String(PARK_POND_MORPH_FRAME_COUNT);
  canvas.dataset.parkPondLargeMorphPeriodMs = String(PARK_POND_LARGE_MORPH_PERIOD_MS);
  canvas.dataset.parkPondFineMorphPeriodMs = String(PARK_POND_FINE_MORPH_PERIOD_MS);
  canvas.dataset.parkPondMorphInterpolation = "cyclic-smoothstep-crossfade";
  canvas.dataset.parkPondCoverageMinX = "730";
  canvas.dataset.parkPondLeftBay = "audited-seeded-water";
  canvas.dataset.parkPondLargeMorphPhase = (
    (motionNowMs % PARK_POND_LARGE_MORPH_PERIOD_MS) / PARK_POND_LARGE_MORPH_PERIOD_MS
  ).toFixed(3);
  canvas.dataset.parkPondFineMorphPhase = (
    (motionNowMs % PARK_POND_FINE_MORPH_PERIOD_MS) / PARK_POND_FINE_MORPH_PERIOD_MS
  ).toFixed(3);
  canvas.dataset.parkPondRippleCount = String(PARK_POND_RIPPLES.length);
  canvas.dataset.parkPondParticleCount = String(
    PARK_POND_WAVE_PARTICLE_COUNT + PARK_POND_GLIMMER_COUNT,
  );
  canvas.dataset.parkPondRipplePhase = ((motionNowMs % 10_200) / 10_200).toFixed(3);
  canvas.dataset.parkPondTimeGraded = "true";
  canvas.dataset.parkPondSource = "layered-cellular-canvas";
  canvas.dataset.parkSeaSparkleCount = String(PARK_SEA_SPARKLE_TOTAL);
  canvas.dataset.parkSeaSparklePhase = ((motionNowMs % 10_000) / 10_000).toFixed(3);
  canvas.dataset.parkShoreFoamInnerMaskPixels = String(layers.shoreFoamInnerMaskPixels);
  canvas.dataset.parkShoreFoamOuterMaskPixels = String(layers.shoreFoamOuterMaskPixels);
  canvas.dataset.parkDistantShoreFoamMaskPixels = String(layers.distantShoreFoamMaskPixels);
  canvas.dataset.parkShoreFoamMotionMaskPixels = String(layers.shoreFoamMotionMaskPixels);
  canvas.dataset.parkShoreFoamSegmentCount = String(layers.shoreFoamSegments.length);
  canvas.dataset.parkShoreFoamGroupCount = String(
    new Set(layers.shoreFoamSegments.map((segment) => segment.group)).size,
  );
  canvas.dataset.parkShoreFoamGroups = Array.from(
    new Set(layers.shoreFoamSegments.map((segment) => segment.group)),
  ).join(",");
  canvas.dataset.parkShoreFoamSegmentIds = layers.shoreFoamSegments
    .map((segment) => segment.id)
    .join(",");
  canvas.dataset.parkShoreFoamMaxOffset = "2.25";
  canvas.dataset.parkHorizonTint = timeVisual.skyHorizon.join(",");
  canvas.dataset.parkHorizonTintEnd = String(PARK_HORIZON_TINT_END_Y);
  canvas.dataset.parkHorizonDawnBoost = Math.max(
    0,
    1 - Math.abs(timeVisual.hour - 6.5) / 2,
  ).toFixed(3);
  drawDynamicSky(ctx, timeVisual);
  drawMovingNightSky(ctx, timeVisual, celestial, motionNowMs);
  drawMovingCloudLayer(ctx, timeVisual, motionNowMs);
  ctx.drawImage(layers.neutralBaseWithoutDistantShoreFoam, 0, 0);
  drawHorizonSeaTint(ctx, layers, timeVisual);
  drawDynamicShadows(ctx, options.objects, celestial, timeVisual);
  drawTerrainMotion(ctx, layers, motionNowMs);
  drawPondSurface(ctx, layers, motionNowMs);

  const avatarY = options.avatar?.y ?? Number.POSITIVE_INFINITY;
  const sorted = [...options.objects].sort((left, right) => left.y - right.y);
  sorted
    .filter((object) => object.y <= avatarY)
    .forEach((object) => drawReferenceObject(ctx, layers, object, options.frame));
  if (options.avatar && options.petStats) {
    drawAvatar(
      ctx,
      options.avatar,
      options.frame,
      options.petStats,
      { status: "idle", timestamp: new Date(options.nowMs).toISOString() },
      options.memory,
      options.avatarAppearanceId,
    );
    drawFishingOverlay(
      ctx,
      options.avatar,
      options.fishingPose ?? "none",
      options.displayedFish,
      options.frame,
    );
  }
  sorted
    .filter((object) => object.y > avatarY)
    .forEach((object) => drawReferenceObject(ctx, layers, object, options.frame));

  const shoreFoamBreath = resolveShoreFoamBreath(motionNowMs);
  canvas.dataset.parkShoreFoamBreath = shoreFoamBreath.toFixed(3);
  const foamMotion = drawShoreFoamBreath(
    ctx,
    layers,
    timeVisual,
    shoreFoamBreath,
    motionNowMs,
  );
  applyTimeGrade(ctx, timeVisual);
  drawSeaLighting(ctx, layers, timeVisual, motionNowMs);
  canvas.dataset.parkShoreFoamInterpolatingSegments = String(foamMotion.interpolatingSegments);
  canvas.dataset.parkShoreFoamBreathingFringeSegments = String(
    foamMotion.breathingFringeSegments,
  );
  canvas.dataset.parkShoreFoamFringeOffset = "0.75";
  canvas.dataset.parkShoreFoamTimeGraded = "true";
  canvas.dataset.parkShoreFoamNightDimming = "0.62";
  canvas.dataset.parkShoreFoamMotionPhase = ((motionNowMs % 12_400) / 12_400).toFixed(3);

  if (options.selectedObjectId) {
    const selected = options.objects.find((object) => object.id === options.selectedObjectId);
    if (selected) {
      ctx.strokeStyle = "#ffe66d";
      ctx.lineWidth = 3;
      ctx.strokeRect(selected.x - 35, selected.y - 75, 70, 82);
    }
  }
};
