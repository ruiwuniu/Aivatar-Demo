import type { AvatarAppearanceId, AvatarRuntime, FurnitureInteractionState } from "../types";

const rect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

export const drawPondWeedSaladMeal = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  rect(ctx, x - 12, y - 1, 25, 5, "#554c3d");
  rect(ctx, x - 10, y + 3, 21, 4, "#b9aa86");
  rect(ctx, x - 8, y + 7, 17, 2, "#8d8068");
  rect(ctx, x - 10, y, 21, 4, "#f0e7cb");
  rect(ctx, x - 8, y - 3, 17, 5, "#426743");
  for (let i = 0; i < 5; i += 1) {
    const px = x - 8 + i * 4;
    rect(ctx, px, y - 4 - i % 2, 4, 4, i % 2 ? "#7fa85c" : "#a0bd66");
    rect(ctx, px + 1, y - 5 - i % 2, 2, 1, "#c5d788");
  }
  rect(ctx, x - 9, y + 2, 19, 1, "#fff4d8");
};

export const drawPondWeedSaladBite = (
  ctx: CanvasRenderingContext2D, bowlX: number, bowlY: number,
  mouthX: number, mouthY: number, frame: number,
) => {
  const progress = (Math.sin(frame / 7 - Math.PI / 2) + 1) / 2;
  const x = Math.round(bowlX + (mouthX - bowlX) * progress);
  const y = Math.round(bowlY + (mouthY - bowlY) * progress - Math.sin(progress * Math.PI) * 4);
  rect(ctx, x + 2, y + 1, 6, 1, "#baa98a");
  rect(ctx, x - 2, y - 1, 5, 2, "#62934c");
  rect(ctx, x - 1, y - 2, 3, 2, "#b6cf76");
};

export interface PondWeedPreparationPalette {
  body: string;
  light: string;
  outline: string;
}

export const pondWeedPreparationPhase = (progress: number) =>
  progress < 1 / 3 ? "chop" : progress < 5 / 6 ? "mix" : "serve";

const drawPreparationHand = (
  ctx: CanvasRenderingContext2D, appearance: AvatarAppearanceId,
  shoulderX: number, shoulderY: number, handX: number, handY: number,
  palette: PondWeedPreparationPalette,
) => {
  const steps = Math.max(1, Math.ceil(Math.hypot(handX - shoulderX, handY - shoulderY)));
  const size = appearance === "cute-penguin" ? 5 : appearance === "mood-slime" ? 6 : 4;
  for (let i = 0; i <= steps; i += 1) {
    const progress = i / steps;
    const x = shoulderX + (handX - shoulderX) * progress;
    const y = shoulderY + (handY - shoulderY) * progress + Math.sin(progress * Math.PI) * 2;
    rect(ctx, x - size / 2, y - size / 2, size, size, palette.body);
  }
  if (appearance === "cute-crayfish") {
    // Two little pincers close around the utensil; no extra idle claws remain.
    rect(ctx, handX - 4, handY - 2, 8, 6, palette.outline);
    rect(ctx, handX - 3, handY - 3, 3, 6, palette.body);
    rect(ctx, handX + 1, handY - 3, 3, 6, palette.body);
    rect(ctx, handX - 3, handY - 3, 2, 2, palette.light);
    rect(ctx, handX + 2, handY - 3, 2, 2, palette.light);
    rect(ctx, handX - 2, handY + 2, 5, 3, palette.body);
  } else {
    rect(ctx, handX - 3, handY - 2, 7, 5, palette.body);
    rect(ctx, handX - 2, handY - 2, 4, 2, palette.light);
  }
};

export const drawPondWeedPreparation = (
  ctx: CanvasRenderingContext2D, avatar: AvatarRuntime, appearance: AvatarAppearanceId,
  interaction: FurnitureInteractionState | null | undefined, frame: number,
  pass: "behind-avatar" | "front-avatar", palette: PondWeedPreparationPalette,
) => {
  if (avatar.behavior !== "cook" || interaction?.kind !== "cook" || interaction.itemId !== "pond-weed") return;
  const behind = avatar.facing === "back";
  if ((behind ? "behind-avatar" : "front-avatar") !== pass) return;
  const now = typeof performance === "undefined" ? interaction.startedAt + frame * 1000 / 60 : performance.now();
  const progress = Math.max(0, Math.min(1, (now - interaction.startedAt) / Math.max(1, (interaction.endsAt ?? interaction.startedAt + 6000) - interaction.startedAt)));
  const phase = pondWeedPreparationPhase(progress);
  const side = avatar.facing === "left" ? -1 : 1;
  const front = avatar.facing === "front";
  // Work at waist height. From the rear only the far-side edge is visible.
  const x = Math.round(avatar.x + (front ? 0 : behind ? -20 : side * 22));
  const y = Math.round(avatar.y - (behind ? 7 : front ? 3 : 5));
  const rhythm = Math.sin(frame / 4);
  let handX = x;
  let handY = y - 6;
  let supportX = x - (front || behind ? 11 : side * 10);
  let supportY = y + 3;
  ctx.save();
  if (phase === "chop") {
    rect(ctx, x - 14, y + 1, 29, 4, "#6f5139");
    rect(ctx, x - 13, y, 27, 3, "#c9a676");
    for (let i = 0; i < 5; i += 1) rect(ctx, x - 9 + i * 4, y - 3 + i % 2, 4, 3, i % 2 ? "#a0bb67" : "#608044");
    handY -= Math.round((rhythm + 1) * 3);
    rect(ctx, x - 1, handY + 2, 2, 7, "#e0e1ce");
    rect(ctx, x - 2, handY, 3, 3, "#806148");
  } else {
    const lift = phase === "serve" ? Math.round((progress - 5 / 6) * 18) : 0;
    drawPondWeedSaladMeal(ctx, x, y - lift);
    if (phase === "mix") {
      const spoonX = x + Math.round(Math.sin(frame / 5) * 6);
      const spoonY = y - 5 + Math.round(Math.cos(frame / 5) * 2);
      rect(ctx, spoonX, spoonY - 4, 2, 7, "#a27e52");
      rect(ctx, spoonX - 1, spoonY + 1, 4, 2, "#d5b481");
      handX = spoonX;
      handY = spoonY - 5;
    } else {
      handX = x + (front || behind ? 11 : side * 10);
      handY = y + 3 - lift;
      supportY -= lift;
    }
  }
  const shoulderOffset = appearance === "wave-lizard" ? 8 : appearance === "mood-slime" ? 18 : 13;
  const shoulderY = avatar.y - (appearance === "cute-crayfish" ? 20 : 11);
  const leadSide = front ? 1 : behind ? -1 : side;
  drawPreparationHand(ctx, appearance, avatar.x - leadSide * shoulderOffset, shoulderY + 3, supportX, supportY, palette);
  drawPreparationHand(ctx, appearance, avatar.x + leadSide * shoulderOffset, shoulderY, handX, handY, palette);
  ctx.restore();
};
