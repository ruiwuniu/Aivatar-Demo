import type { AvatarAppearanceId, AvatarRuntime } from "../types";
import type { ParkFishingSpot } from "./parkContent";
import type { ParkRawFishId } from "./parkProbability";
import type { ParkFishingPose } from "./parkRuntime";

type Point = { x: number; y: number };

interface FishingHandAnchor {
  x: number;
  y: number;
  frontX: number;
  frontY: number;
  followsBodyBob: boolean;
}

export interface ParkFishingAnimationOptions {
  ctx: CanvasRenderingContext2D;
  avatar: AvatarRuntime;
  appearanceId?: AvatarAppearanceId;
  pose: ParkFishingPose;
  fishId?: ParkRawFishId;
  frame: number;
  nowMs: number;
  poseStartedAt: number;
  spot?: ParkFishingSpot;
}

const CAST_DURATION_MS = 1200;
const REEL_DURATION_MS = 1450;
const BITE_DURATION_MS = 520;
const HOOK_SHAKE_CYCLE_MS = 420;
const REEL_FISH_EXIT_PROGRESS = 0.34;
const REEL_FISH_SPLASH_SPAN = 0.2;
const PARK_FISH_SPRITE_ASSETS: Record<ParkRawFishId, string> = {
  "raw-crucian-carp": "/park/fish/raw-crucian-carp-v1.png",
  "raw-bluegill": "/park/fish/raw-bluegill-v1.png",
  "raw-black-bass": "/park/fish/raw-black-bass-v1.png",
  "raw-yellow-perch": "/park/fish/raw-yellow-perch-v1.png",
  "raw-weather-loach": "/park/fish/raw-weather-loach-v1.png",
  "raw-rainbow-trout": "/park/fish/raw-rainbow-trout-v1.png",
};
const PARK_FISH_FALLBACK_PALETTES: Record<
  ParkRawFishId,
  { body: string; light: string }
> = {
  "raw-crucian-carp": { body: "#b5aa84", light: "#e1d3a6" },
  "raw-bluegill": { body: "#53765b", light: "#9bb376" },
  "raw-black-bass": { body: "#526f54", light: "#9bb870" },
  "raw-yellow-perch": { body: "#b79234", light: "#edcd68" },
  "raw-weather-loach": { body: "#755b31", light: "#bc9958" },
  "raw-rainbow-trout": { body: "#778b84", light: "#d3dcc7" },
};
const parkFishSpriteCache = new Map<ParkRawFishId, HTMLImageElement>();

const FISHING_HAND_ANCHORS: Record<AvatarAppearanceId, FishingHandAnchor> = {
  octopus: { x: 18, y: 4, frontX: 11, frontY: 5, followsBodyBob: true },
  "demo-spark": { x: 18, y: -3, frontX: 10, frontY: -1, followsBodyBob: true },
  "mood-slime": { x: 18, y: -3, frontX: 10, frontY: -1, followsBodyBob: true },
  "cute-crayfish": { x: 22, y: -5, frontX: 13, frontY: -2, followsBodyBob: true },
  "cute-ghost": { x: 22, y: -10, frontX: 12, frontY: -7, followsBodyBob: true },
  "cute-penguin": { x: 19, y: -10, frontX: 10, frontY: -7, followsBodyBob: false },
  "wave-lizard": { x: 20, y: -12, frontX: 11, frontY: -9, followsBodyBob: true },
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
};
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const lerpPoint = (from: Point, to: Point, amount: number): Point => ({
  x: lerp(from.x, to.x, amount),
  y: lerp(from.y, to.y, amount),
});

const reelProgressAt = (nowMs: number, poseStartedAt: number) =>
  clamp01((nowMs - poseStartedAt) / REEL_DURATION_MS);

const reelPullStrength = (progress: number) =>
  Math.sin(clamp01((progress - 0.04) / 0.9) * Math.PI);

const resolveHookStruggle = (poseElapsedMs: number) => {
  const strength = smoothstep(poseElapsedMs / BITE_DURATION_MS);
  const phase = poseElapsedMs / HOOK_SHAKE_CYCLE_MS * Math.PI * 2;
  const irregularWave =
    (Math.sin(phase) + Math.sin(phase * 2.3 + 0.8) * 0.42) / 1.42;
  const tug = strength * (0.42 + (Math.sin(phase + 0.65) + 1) * 0.29);
  return {
    x: irregularWave * strength * 3,
    y: strength * 4 + (Math.sin(phase * 1.35 + 0.4) + 1) * strength * 2,
    tug,
  };
};

export const resolveParkFishingVisualAvatar = (
  avatar: AvatarRuntime,
  pose: ParkFishingPose,
  nowMs: number,
  poseStartedAt: number,
): AvatarRuntime => {
  if (pose !== "reel") return avatar;
  const progress = reelProgressAt(nowMs, poseStartedAt);
  const pull = reelPullStrength(progress);
  if (pull <= 0.001) return avatar;
  const waterDirection = avatar.facing === "left" ? -1 : 1;
  return {
    ...avatar,
    x: avatar.x - waterDirection * Math.round(pull * 7),
    y: avatar.y + Math.round(pull * 2),
  };
};

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

const resolveHand = (
  avatar: AvatarRuntime,
  appearanceId: AvatarAppearanceId,
  frame: number,
): Point => {
  const anchor = FISHING_HAND_ANCHORS[appearanceId];
  const frontFacing = avatar.facing === "front";
  const side = avatar.facing === "left" ? -1 : 1;
  const bodyBob = anchor.followsBodyBob
    ? avatar.behavior === "sleep"
      ? 1
      : Math.sin(frame / 12) * 2
    : 0;
  return {
    x: Math.round(avatar.x + (frontFacing ? anchor.frontX : anchor.x * side)),
    y: Math.round(avatar.y + bodyBob + (frontFacing ? anchor.frontY : anchor.y)),
  };
};

const resolveRodTip = (
  hand: Point,
  pose: ParkFishingPose,
  poseElapsedMs: number,
  facing: AvatarRuntime["facing"],
): Point => {
  const frontFacing = facing === "front";
  const side = facing === "left" ? -1 : 1;
  const resting = frontFacing
    ? { x: hand.x + 49, y: hand.y - 47 }
    : { x: hand.x + 53 * side, y: hand.y - 50 };
  if (pose === "cast") {
    const progress = clamp01(poseElapsedMs / CAST_DURATION_MS);
    const backswing = frontFacing
      ? { x: hand.x - 25, y: hand.y - 59 }
      : { x: hand.x - 30 * side, y: hand.y - 52 };
    const forward = frontFacing
      ? { x: hand.x + 72, y: hand.y - 27 }
      : { x: hand.x + 68 * side, y: hand.y - 34 };
    if (progress < 0.28) {
      return lerpPoint(resting, backswing, smoothstep(progress / 0.28));
    }
    if (progress < 0.7) {
      return lerpPoint(backswing, forward, smoothstep((progress - 0.28) / 0.42));
    }
    return lerpPoint(forward, resting, smoothstep((progress - 0.7) / 0.3));
  }
  if (pose === "bite") {
    const struggle = resolveHookStruggle(poseElapsedMs);
    const forwardX = frontFacing ? 48 : 48 * side;
    return {
      x: hand.x + forwardX - (frontFacing ? 1 : side) * struggle.tug * 9,
      y: hand.y - 40 + struggle.tug * 10,
    };
  }
  if (pose === "reel") {
    const progress = clamp01(poseElapsedMs / REEL_DURATION_MS);
    const pull = reelPullStrength(progress);
    const forwardX = frontFacing ? 48 : 48 * side;
    const backwardX = frontFacing ? -12 : -18 * side;
    const vibration = Math.sin(progress * Math.PI * 8) * (1 - progress) * 1.5;
    return {
      x: hand.x + lerp(forwardX, backwardX, pull) + vibration,
      y: hand.y - 47 - pull * 18,
    };
  }
  return resting;
};

const quadraticPoint = (
  start: Point,
  control: Point,
  end: Point,
  amount: number,
): Point => {
  const inverse = 1 - amount;
  return {
    x:
      inverse * inverse * start.x +
      2 * inverse * amount * control.x +
      amount * amount * end.x,
    y:
      inverse * inverse * start.y +
      2 * inverse * amount * control.y +
      amount * amount * end.y,
  };
};

const drawTaperedRodPass = (
  ctx: CanvasRenderingContext2D,
  hand: Point,
  control: Point,
  tip: Point,
  color: string,
  handWidth: number,
  tipWidth: number,
) => {
  const segmentCount = 14;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let index = 0; index < segmentCount; index += 1) {
    const startAmount = index / segmentCount;
    const endAmount = (index + 1) / segmentCount;
    const start = quadraticPoint(hand, control, tip, startAmount);
    const end = quadraticPoint(hand, control, tip, endAmount);
    const widthAmount = (startAmount + endAmount) / 2;
    ctx.lineWidth = lerp(handWidth, tipWidth, widthAmount);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
};

const drawCurvedRod = (
  ctx: CanvasRenderingContext2D,
  hand: Point,
  tip: Point,
  pose: ParkFishingPose,
  poseElapsedMs: number,
) => {
  const distance = Math.hypot(tip.x - hand.x, tip.y - hand.y);
  const tension =
    pose === "bite"
      ? 13
      : pose === "reel"
        ? 10 + Math.sin(poseElapsedMs / 90) * 3
        : pose === "cast"
          ? 4
          : 7;
  const control = {
    x: lerp(hand.x, tip.x, 0.56) + Math.max(0, 66 - distance) * 0.12,
    y: lerp(hand.y, tip.y, 0.56) - tension,
  };

  drawTaperedRodPass(ctx, hand, control, tip, "#271a13", 4.8, 1.35);
  drawTaperedRodPass(ctx, hand, control, tip, "#75502e", 3.15, 0.82);

  ctx.save();
  ctx.strokeStyle = "#c5904e";
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.moveTo(hand.x + 0.5, hand.y - 0.5);
  ctx.quadraticCurveTo(control.x, control.y, tip.x, tip.y);
  ctx.stroke();
  ctx.restore();

  const handleAngle = Math.atan2(tip.y - hand.y, tip.x - hand.x);
  const gripEnd = {
    x: hand.x - Math.cos(handleAngle) * 13,
    y: hand.y - Math.sin(handleAngle) * 13,
  };
  ctx.save();
  ctx.strokeStyle = "#33231c";
  ctx.lineWidth = 5.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hand.x, hand.y);
  ctx.lineTo(gripEnd.x, gripEnd.y);
  ctx.stroke();
  ctx.restore();
  rect(ctx, hand.x - 2, hand.y - 2, 4, 4, "#624225");
};

const drawFishingLine = (
  ctx: CanvasRenderingContext2D,
  tip: Point,
  end: Point,
  sag: number,
  alpha = 0.9,
) => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#dbe8dd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(tip.x), Math.round(tip.y));
  ctx.quadraticCurveTo(
    Math.round(lerp(tip.x, end.x, 0.54)),
    Math.round(lerp(tip.y, end.y, 0.54) + sag),
    Math.round(end.x),
    Math.round(end.y),
  );
  ctx.stroke();
  ctx.restore();
};

const drawPixelRipple = (
  ctx: CanvasRenderingContext2D,
  center: Point,
  nowMs: number,
  strength = 1,
) => {
  for (let index = 0; index < 2; index += 1) {
    const phase = (nowMs / (1900 + index * 310) + index * 0.42) % 1;
    const radiusX = 6 + phase * 15;
    const radiusY = 2 + phase * 4;
    ctx.save();
    ctx.globalAlpha = (1 - phase) * 0.5 * strength;
    ctx.strokeStyle = index === 0 ? "#e7fff3" : "#8ecfd2";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(
      Math.round(center.x),
      Math.round(center.y + 2),
      Math.round(radiusX),
      Math.max(1, Math.round(radiusY)),
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.restore();
  }
};

const drawSplash = (
  ctx: CanvasRenderingContext2D,
  center: Point,
  poseElapsedMs: number,
) => {
  const progress = clamp01(poseElapsedMs / BITE_DURATION_MS);
  const burst = Math.sin(progress * Math.PI);
  drawPixelRipple(ctx, center, poseElapsedMs * 2.4, 1.65);
  if (burst > 0.08) {
    rect(ctx, center.x - 2, center.y - 4 - burst * 13, 4, 7 + burst * 10, "#effff8");
    rect(ctx, center.x - 7, center.y - 2 - burst * 8, 4, 4 + burst * 6, "#a7e5e4");
    rect(ctx, center.x + 4, center.y - 3 - burst * 10, 4, 5 + burst * 7, "#d9faf2");
  }
  const droplets = [
    { x: -10, y: -12, delay: 0.02 },
    { x: -5, y: -18, delay: 0.08 },
    { x: 4, y: -20, delay: 0 },
    { x: 10, y: -13, delay: 0.1 },
    { x: 15, y: -8, delay: 0.16 },
  ];
  droplets.forEach((droplet, index) => {
    const local = clamp01((progress - droplet.delay) / (1 - droplet.delay));
    const lift = Math.sin(local * Math.PI) * burst;
    if (lift <= 0.08) return;
    rect(
      ctx,
      center.x + droplet.x * local,
      center.y + droplet.y * lift + local * local * 5,
      index % 2 === 0 ? 3 : 2,
      index % 2 === 0 ? 4 : 3,
      index % 2 === 0 ? "#e9fff7" : "#8dd6df",
    );
  });
};

const drawBobber = (
  ctx: CanvasRenderingContext2D,
  center: Point,
  nowMs: number,
  pose: ParkFishingPose,
  poseElapsedMs: number,
) => {
  const idleBob = Math.sin(nowMs / 420) * 1.35;
  const struggle = pose === "bite" ? resolveHookStruggle(poseElapsedMs) : undefined;
  const x = center.x + (struggle?.x ?? 0);
  const y = center.y + (struggle?.y ?? idleBob);
  rect(ctx, x - 1, y - 8, 3, 5, "#f4f0d4");
  rect(ctx, x - 2, y - 3, 5, 4, "#e9584f");
  rect(ctx, x - 1, y + 1, 3, 3, "#6b3a2b");
  if (pose === "bite") {
    if (poseElapsedMs < BITE_DURATION_MS) drawSplash(ctx, center, poseElapsedMs);
    else drawPixelRipple(ctx, { x, y: center.y }, nowMs * 1.45, 1.08);
  } else {
    drawPixelRipple(ctx, center, nowMs, 0.82);
  }
};

const parkFishSprite = (fishId: ParkRawFishId) => {
  const cached = parkFishSpriteCache.get(fishId);
  if (cached) return cached;
  const image = new Image();
  image.decoding = "async";
  image.src = PARK_FISH_SPRITE_ASSETS[fishId];
  parkFishSpriteCache.set(fishId, image);
  return image;
};

const drawProceduralFishFallback = (
  ctx: CanvasRenderingContext2D,
  fishId: ParkRawFishId,
  x: number,
  y: number,
  scale = 1,
) => {
  const { body, light } = PARK_FISH_FALLBACK_PALETTES[fishId];
  rect(ctx, x - 15 * scale, y - 6 * scale, 25 * scale, 12 * scale, "#263b38");
  rect(ctx, x - 11 * scale, y - 8 * scale, 24 * scale, 14 * scale, body);
  rect(ctx, x - 6 * scale, y - 5 * scale, 17 * scale, 4 * scale, light);
  rect(ctx, x + 11 * scale, y - 3 * scale, 9 * scale, 8 * scale, body);
  rect(ctx, x + 17 * scale, y - 7 * scale, 5 * scale, 15 * scale, "#354a42");
  rect(ctx, x - 8 * scale, y - 5 * scale, 2 * scale, 2 * scale, "#111b1b");
};

const drawFish = (
  ctx: CanvasRenderingContext2D,
  fishId: ParkRawFishId,
  x: number,
  y: number,
  frame: number,
) => {
  const sprite = parkFishSprite(fishId);
  const displayBob = Math.round(Math.sin(frame / 6));
  if (!sprite.complete || sprite.naturalWidth <= 0) {
    drawProceduralFishFallback(ctx, fishId, x, y + displayBob, 1.6);
    return;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite,
    Math.round(x - sprite.naturalWidth / 2),
    Math.round(y - sprite.naturalHeight / 2 + displayBob),
  );
  ctx.restore();
};

const resolveReelFishFlight = (
  waterTarget: Point,
  displayTarget: Point,
  reelProgress: number,
) => {
  if (reelProgress < REEL_FISH_EXIT_PROGRESS) return undefined;
  const flight = smoothstep(
    (reelProgress - REEL_FISH_EXIT_PROGRESS) / (1 - REEL_FISH_EXIT_PROGRESS),
  );
  const point = lerpPoint(
    { x: waterTarget.x, y: waterTarget.y + 16 },
    displayTarget,
    flight,
  );
  point.y -= Math.sin(flight * Math.PI) * 76;
  point.x += Math.sin(flight * Math.PI * 2) * (1 - flight) * 5;
  return { point, flight };
};

export const drawParkFishingAnimation = ({
  ctx,
  avatar,
  appearanceId = "octopus",
  pose,
  fishId,
  frame,
  nowMs,
  poseStartedAt,
  spot,
}: ParkFishingAnimationOptions) => {
  if (pose === "none") return;
  const poseElapsedMs = Math.max(0, nowMs - poseStartedAt);
  const avatarX = Math.round(avatar.x);
  const avatarY = Math.round(avatar.y);

  if (pose === "display") {
    if (fishId) drawFish(ctx, fishId, avatarX, avatarY - 55, frame);
    return;
  }

  const hand = resolveHand(avatar, appearanceId, frame);
  const tip = resolveRodTip(hand, pose, poseElapsedMs, avatar.facing);
  const waterTarget = spot
    ? { x: spot.bobberX, y: spot.bobberY }
    : { x: avatarX + 136, y: avatarY + 12 };
  let lineEnd = waterTarget;
  let lineSag = 5;
  let showBobber = true;
  let reelFish: ReturnType<typeof resolveReelFishFlight>;

  if (pose === "cast") {
    const castProgress = clamp01(poseElapsedMs / CAST_DURATION_MS);
    if (castProgress < 0.38) {
      lineEnd = tip;
      showBobber = false;
    } else {
      const flight = smoothstep((castProgress - 0.38) / 0.62);
      const launch = { x: tip.x + 4, y: tip.y + 4 };
      lineEnd = lerpPoint(launch, waterTarget, flight);
      lineEnd.y -= Math.sin(flight * Math.PI) * 54;
      lineSag = 2 + flight * 5;
      showBobber = flight > 0.84;
    }
  } else if (pose === "reel") {
    const reelProgress = clamp01(poseElapsedMs / REEL_DURATION_MS);
    reelFish = fishId
      ? resolveReelFishFlight(
          waterTarget,
          { x: avatarX, y: avatarY - 55 },
          reelProgress,
        )
      : undefined;
    lineEnd = reelFish?.point ?? waterTarget;
    lineSag = Math.max(0, 5 - (reelFish?.flight ?? 0) * 5);
    showBobber = reelProgress < REEL_FISH_EXIT_PROGRESS;
  } else if (pose === "bite") {
    const struggle = resolveHookStruggle(poseElapsedMs);
    lineEnd = {
      x: waterTarget.x + struggle.x,
      y: waterTarget.y + struggle.y,
    };
    lineSag = -2;
  }

  drawFishingLine(ctx, tip, lineEnd, lineSag);
  if (showBobber) {
    drawBobber(ctx, waterTarget, nowMs, pose, poseElapsedMs);
  } else if (pose === "reel") {
    drawPixelRipple(ctx, waterTarget, nowMs, 0.45);
    const splashProgress = clamp01(
      (poseElapsedMs / REEL_DURATION_MS - REEL_FISH_EXIT_PROGRESS) / REEL_FISH_SPLASH_SPAN,
    );
    if (splashProgress < 1) {
      drawSplash(ctx, waterTarget, splashProgress * BITE_DURATION_MS);
    }
  }
  drawCurvedRod(ctx, hand, tip, pose, poseElapsedMs);

  if (pose === "reel" && fishId && reelFish) {
    drawFish(ctx, fishId, reelFish.point.x, reelFish.point.y, frame);
  }

  if (pose === "whistle") {
    rect(ctx, avatarX + 23, avatarY - 45, 4, 4, "#fff0a6");
    rect(ctx, avatarX + 31, avatarY - 52, 3, 3, "#fff0a6");
  }
};

export const PARK_FISHING_ANIMATION_MARKERS = {
  castDurationMs: CAST_DURATION_MS,
  biteDurationMs: BITE_DURATION_MS,
  hookShakeCycleMs: HOOK_SHAKE_CYCLE_MS,
  reelDurationMs: REEL_DURATION_MS,
  reelFishExitProgress: REEL_FISH_EXIT_PROGRESS,
  handAnchorCount: Object.keys(FISHING_HAND_ANCHORS).length,
  fishSpriteCount: Object.keys(PARK_FISH_SPRITE_ASSETS).length,
  frontCastSupported: true,
} as const;
