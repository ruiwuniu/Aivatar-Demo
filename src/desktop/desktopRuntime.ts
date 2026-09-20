import type { AvatarRuntime, BehaviorName } from "../types";
import type {
  DesktopDragTarget, DesktopHitRegion, DesktopLayout, DesktopPoint,
  DesktopRuntime, DesktopViewport,
} from "./desktopTypes";

export const DESKTOP_PIXEL_SCALE = 4 / 3;
const WALK_SPEED = 80;
const ARRIVAL_DISTANCE = 1;
const DRAG_REST_MS = 4000;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(Math.max(low, high), value));
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const clampDesktopPoint = (
  point: DesktopPoint, target: DesktopDragTarget, viewport: DesktopViewport,
): DesktopPoint => {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  // Leave room above the sprite for its two-line bubble and below the computer
  // for the avatar's work position. These are CSS, not monitor device pixels.
  const marginX = Math.min((target === "avatar" ? 47 : 46) * DESKTOP_PIXEL_SCALE, width / 2);
  const top = Math.min((target === "avatar" ? 82 : 71) * DESKTOP_PIXEL_SCALE, height / 2);
  const bottom = Math.min((target === "avatar" ? 17 : 58) * DESKTOP_PIXEL_SCALE, height / 2);
  return {
    x: clamp(finite(point.x, width / 2), marginX, width - marginX),
    y: clamp(finite(point.y, height / 2), top, height - bottom),
  };
};

export const normalizeDesktopLayout = (
  value: unknown, viewport: DesktopViewport,
): DesktopLayout => {
  const candidate = value && typeof value === "object" ? value as Partial<DesktopLayout> : {};
  const valid = candidate.version === 1;
  const oldWidth = valid ? finite(candidate.viewport?.width, viewport.width) : viewport.width;
  const oldHeight = valid ? finite(candidate.viewport?.height, viewport.height) : viewport.height;
  // Preserve exact positions at the same resolution; proportionally restore a
  // removed/resized monitor's layout before clamping it into the new work area.
  const ratioX = oldWidth > 0 ? viewport.width / oldWidth : 1;
  const ratioY = oldHeight > 0 ? viewport.height / oldHeight : 1;
  const point = (target: DesktopDragTarget, fallback: DesktopPoint): DesktopPoint => {
    const saved = valid ? candidate[target] : undefined;
    return clampDesktopPoint(saved ? {
      x: finite(saved.x, fallback.x / ratioX) * ratioX,
      y: finite(saved.y, fallback.y / ratioY) * ratioY,
    } : fallback, target, viewport);
  };
  return {
    version: 1, monitorId: viewport.monitorId,
    viewport: { width: viewport.width, height: viewport.height },
    avatar: point("avatar", { x: viewport.width * 0.60, y: viewport.height * 0.72 }),
    computer: point("computer", { x: viewport.width * 0.75, y: viewport.height * 0.63 }),
  };
};

export const createDesktopRuntime = (layout: DesktopLayout): DesktopRuntime => ({
  avatar: {
    ...layout.avatar, targetX: layout.avatar.x, targetY: layout.avatar.y,
    facing: "front", behavior: "idle", behaviorTimer: 0, expression: "calm",
  },
  computer: { ...layout.computer }, nextDecisionAt: 0, dragPauseUntil: 0,
  lastTaskBehavior: null,
});

export const desktopLayoutFromRuntime = (
  runtime: DesktopRuntime, viewport: DesktopViewport,
): DesktopLayout => ({
  version: 1, monitorId: viewport.monitorId,
  viewport: { width: viewport.width, height: viewport.height },
  avatar: { x: runtime.avatar.x, y: runtime.avatar.y },
  computer: { ...runtime.computer },
});

export const moveDesktopObject = (
  runtime: DesktopRuntime, target: DesktopDragTarget, point: DesktopPoint,
  viewport: DesktopViewport, nowMs: number,
): DesktopRuntime => {
  const next = clampDesktopPoint(point, target, viewport);
  return {
    ...runtime, dragPauseUntil: nowMs + DRAG_REST_MS,
    nextDecisionAt: nowMs + DRAG_REST_MS,
    computer: target === "computer" ? next : runtime.computer,
    avatar: {
      ...runtime.avatar,
      ...(target === "avatar" ? next : {}),
      targetX: target === "avatar" ? next.x : runtime.avatar.x,
      targetY: target === "avatar" ? next.y : runtime.avatar.y,
      behavior: "idle", behaviorTimer: 0, expression: "calm",
      actionIntent: undefined, activityLabel: undefined,
    },
  };
};

export const desktopWorkPoint = (computer: DesktopPoint, viewport: DesktopViewport) =>
  clampDesktopPoint({ x: computer.x, y: computer.y + 40 * DESKTOP_PIXEL_SCALE }, "avatar", viewport);

const expressionForTask = (behavior: BehaviorName): AvatarRuntime["expression"] =>
  behavior === "success" ? "happy" : behavior === "error" || behavior === "waiting" ? "worried" : "focused";

/** Visual movement only. Status mapping, stats, rewards, audio and storage stay with App. */
export const tickDesktopRuntime = (
  runtime: DesktopRuntime, taskBehavior: BehaviorName | null, viewport: DesktopViewport,
  elapsedSeconds: number, nowMs: number, random: () => number = Math.random,
): DesktopRuntime => {
  if (nowMs < runtime.dragPauseUntil) return runtime;
  const next = { ...runtime, avatar: { ...runtime.avatar }, lastTaskBehavior: taskBehavior };
  const avatar = next.avatar;
  const activeTask = taskBehavior === "thinking" || taskBehavior === "coding"
    || taskBehavior === "waiting" || taskBehavior === "error";
  if (activeTask) {
    const target = desktopWorkPoint(next.computer, viewport);
    avatar.targetX = target.x;
    avatar.targetY = target.y;
  } else if (taskBehavior === "success") {
    avatar.targetX = avatar.x;
    avatar.targetY = avatar.y;
    avatar.behavior = "success";
    avatar.expression = "happy";
    avatar.facing = "front";
    avatar.actionIntent = undefined;
    next.nextDecisionAt = nowMs + 2500;
    return next;
  } else if (runtime.lastTaskBehavior) {
    avatar.targetX = avatar.x;
    avatar.targetY = avatar.y;
    next.nextDecisionAt = nowMs + 2500;
  } else if (nowMs >= runtime.nextDecisionAt) {
    const target = clampDesktopPoint({
      x: avatar.x + (random() - 0.5) * Math.min(640, viewport.width * 0.7),
      y: avatar.y + (random() - 0.5) * Math.min(360, viewport.height * 0.5),
    }, "avatar", viewport);
    avatar.targetX = target.x;
    avatar.targetY = target.y;
    next.nextDecisionAt = nowMs + 6000 + random() * 7000;
  }

  const dx = avatar.targetX - avatar.x;
  const dy = avatar.targetY - avatar.y;
  const distance = Math.hypot(dx, dy);
  const step = Math.min(distance, WALK_SPEED * clamp(elapsedSeconds, 0, 0.1));
  if (distance > ARRIVAL_DISTANCE) {
    avatar.x += dx / distance * step;
    avatar.y += dy / distance * step;
    avatar.behavior = "wander";
    avatar.expression = "calm";
    avatar.actionIntent = activeTask ? taskBehavior! : undefined;
    avatar.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "front" : "back");
  } else {
    avatar.x = avatar.targetX;
    avatar.y = avatar.targetY;
    avatar.behavior = activeTask ? taskBehavior! : "idle";
    avatar.expression = activeTask ? expressionForTask(taskBehavior!) : "calm";
    avatar.facing = activeTask && (taskBehavior === "thinking" || taskBehavior === "coding") ? "back" : "front";
    avatar.actionIntent = undefined;
  }
  avatar.behaviorTimer = 0;
  avatar.activityLabel = undefined;
  return next;
};

export const desktopObjectBounds = (
  runtime: DesktopRuntime, target: DesktopDragTarget,
): DesktopHitRegion => target === "computer"
  ? {
    x: runtime.computer.x - 21 * DESKTOP_PIXEL_SCALE,
    y: runtime.computer.y - 35 * DESKTOP_PIXEL_SCALE,
    width: 42 * DESKTOP_PIXEL_SCALE, height: 50 * DESKTOP_PIXEL_SCALE,
  }
  : {
    x: runtime.avatar.x - 29 * DESKTOP_PIXEL_SCALE,
    y: runtime.avatar.y - 46 * DESKTOP_PIXEL_SCALE,
    width: 58 * DESKTOP_PIXEL_SCALE, height: 61 * DESKTOP_PIXEL_SCALE,
  };

export const desktopObjectAtPoint = (runtime: DesktopRuntime, point: DesktopPoint): DesktopDragTarget | null => {
  // The avatar is also first in hit testing because it is above the computer.
  for (const target of ["avatar", "computer"] as const) {
    const bounds = desktopObjectBounds(runtime, target);
    if (point.x >= bounds.x && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y && point.y <= bounds.y + bounds.height) return target;
  }
  return null;
};
