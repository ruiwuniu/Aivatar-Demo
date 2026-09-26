import type { AvatarRuntime, BehaviorName } from "../types";
import type {
  DesktopActivityArea, DesktopAreaHandle, DesktopDragTarget, DesktopHitRegion, DesktopLayout, DesktopPoint,
  DesktopRuntime, DesktopViewport, DesktopVendingProductId, DesktopVendingPurchaseRequest,
} from "./desktopTypes";
import {
  DESKTOP_PIXEL_SCALE, DESKTOP_FURNITURE_GAP, DESKTOP_VENDING_PRESS_MS,
  DESKTOP_VENDING_DISPENSE_MS, DESKTOP_VENDING_CONSUME_MS,
  desktopFurniturePairFits, desktopTerminalVisualBounds, desktopTerminalFrontBounds,
  desktopVendingVisualBounds, desktopVendingFrontBounds, desktopVendingInteractionPoint,
} from "./desktopVendingMachine";

export { DESKTOP_PIXEL_SCALE } from "./desktopVendingMachine";
export const DESKTOP_MIN_ACTIVITY_SIZE = { width: 760, height: 520 } as const;
const WALK_SPEED = 80;
const ARRIVAL_DISTANCE = 1;
const DRAG_REST_MS = 4000;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(Math.max(low, high), value));
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const normalizeDesktopActivityArea = (
  value: unknown, viewport: DesktopViewport,
): DesktopActivityArea => {
  const candidate = value && typeof value === "object" ? value as Partial<DesktopActivityArea> : {};
  const screenWidth = Math.max(1, finite(viewport.width, 1));
  const screenHeight = Math.max(1, finite(viewport.height, 1));
  const width = clamp(finite(candidate.width, screenWidth),
    Math.min(DESKTOP_MIN_ACTIVITY_SIZE.width, screenWidth), screenWidth);
  const height = clamp(finite(candidate.height, screenHeight),
    Math.min(DESKTOP_MIN_ACTIVITY_SIZE.height, screenHeight), screenHeight);
  return {
    x: clamp(finite(candidate.x, 0), 0, screenWidth - width),
    y: clamp(finite(candidate.y, 0), 0, screenHeight - height),
    width, height,
  };
};

/** Deltas are measured from the rectangle at pointer-down, not the last frame. */
export const resizeDesktopActivityArea = (
  area: DesktopActivityArea, handle: DesktopAreaHandle, delta: DesktopPoint,
  viewport: DesktopViewport,
): DesktopActivityArea => {
  const start = normalizeDesktopActivityArea(area, viewport);
  const screen = normalizeDesktopActivityArea(undefined, viewport);
  const minWidth = Math.min(DESKTOP_MIN_ACTIVITY_SIZE.width, screen.width);
  const minHeight = Math.min(DESKTOP_MIN_ACTIVITY_SIZE.height, screen.height);
  const dx = finite(delta.x, 0);
  const dy = finite(delta.y, 0);
  if (handle === "move") {
    return { ...start,
      x: clamp(start.x + dx, 0, screen.width - start.width),
      y: clamp(start.y + dy, 0, screen.height - start.height),
    };
  }
  let left = start.x;
  let right = left + start.width;
  let top = start.y;
  let bottom = top + start.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - minWidth);
  if (handle.includes("e")) right = clamp(right + dx, left + minWidth, screen.width);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - minHeight);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + minHeight, screen.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export const clampDesktopPoint = (
  point: DesktopPoint, target: DesktopDragTarget, viewport: DesktopViewport,
  area?: DesktopActivityArea,
): DesktopPoint => {
  const bounds = normalizeDesktopActivityArea(area, viewport);
  const { width, height } = bounds;
  // Leave room above the sprite for its two-line bubble and below the computer
  // for the avatar's work position. These are CSS, not monitor device pixels.
  // The computer needs the avatar's horizontal clearance as well, otherwise
  // clamping the work point would move it away from the keyboard at an edge.
  const marginX = Math.min((target === "vendingMachine" ? 54 : 47) * DESKTOP_PIXEL_SCALE, width / 2);
  const top = Math.min((target === "vendingMachine" ? 116 : target === "avatar" ? 82 : 71) * DESKTOP_PIXEL_SCALE, height / 2);
  const bottom = Math.min((target === "vendingMachine" ? 46 : target === "avatar" ? 17 : 58) * DESKTOP_PIXEL_SCALE, height / 2);
  return {
    x: clamp(finite(point.x, bounds.x + width / 2), bounds.x + marginX, bounds.x + width - marginX),
    y: clamp(finite(point.y, bounds.y + height / 2), bounds.y + top, bounds.y + height - bottom),
  };
};

type FurnitureTarget = "computer" | "vendingMachine";
type FurnitureLayout = Pick<DesktopRuntime, "computer" | "vendingMachine" | "activityArea">;
const visualBounds = (target: FurnitureTarget, point: DesktopPoint) => target === "computer"
  ? desktopTerminalVisualBounds(point) : desktopVendingVisualBounds(point);
const frontBounds = (target: FurnitureTarget, point: DesktopPoint) => target === "computer"
  ? desktopTerminalFrontBounds(point) : desktopVendingFrontBounds(point);
const rectangleInside = (inner: DesktopHitRegion, outer: DesktopActivityArea) =>
  inner.x >= outer.x - 1e-7 && inner.y >= outer.y - 1e-7
  && inner.x + inner.width <= outer.x + outer.width + 1e-7
  && inner.y + inner.height <= outer.y + outer.height + 1e-7;

export const isDesktopFurniturePlacementValid = (
  runtime: FurnitureLayout, target: FurnitureTarget, point: DesktopPoint, viewport: DesktopViewport,
): boolean => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const area = normalizeDesktopActivityArea(runtime.activityArea, viewport);
  const clamped = clampDesktopPoint(point, target, viewport, area);
  if (Math.abs(clamped.x - point.x) > 1e-7 || Math.abs(clamped.y - point.y) > 1e-7
    || !rectangleInside(visualBounds(target, point), area) || !rectangleInside(frontBounds(target, point), area)) return false;
  if (target === "vendingMachine") return desktopFurniturePairFits(runtime.computer, point);
  return !runtime.vendingMachine || desktopFurniturePairFits(point, runtime.vendingMachine);
};

/** Test nearby obstacle/area edges, then choose the closest legal anchor. */
export const findDesktopFurniturePlacement = (
  runtime: FurnitureLayout, target: FurnitureTarget, preferred: DesktopPoint, viewport: DesktopViewport,
): DesktopPoint | null => {
  const original = clampDesktopPoint(preferred, target, viewport, runtime.activityArea);
  if (isDesktopFurniturePlacementValid(runtime, target, original, viewport)) return original;
  const low = clampDesktopPoint({ x: -1e9, y: -1e9 }, target, viewport, runtime.activityArea);
  const high = clampDesktopPoint({ x: 1e9, y: 1e9 }, target, viewport, runtime.activityArea);
  const xs = new Set([original.x, low.x, high.x, (low.x + high.x) / 2]);
  const ys = new Set([original.y, low.y, high.y, (low.y + high.y) / 2]);
  const other = target === "computer" ? runtime.vendingMachine : runtime.computer;
  const otherTarget = target === "computer" ? "vendingMachine" : "computer";
  if (other) {
    const obstacles = [visualBounds(otherTarget, other), frontBounds(otherTarget, other)];
    const offsets = [visualBounds(target, { x: 0, y: 0 }), frontBounds(target, { x: 0, y: 0 })];
    for (const obstacle of obstacles) for (const offset of offsets) {
      xs.add(obstacle.x - offset.x - offset.width - DESKTOP_FURNITURE_GAP - 0.01);
      xs.add(obstacle.x + obstacle.width - offset.x + DESKTOP_FURNITURE_GAP + 0.01);
      ys.add(obstacle.y - offset.y - offset.height - DESKTOP_FURNITURE_GAP - 0.01);
      ys.add(obstacle.y + obstacle.height - offset.y + DESKTOP_FURNITURE_GAP + 0.01);
    }
  }
  const candidates: DesktopPoint[] = [];
  for (const x of xs) for (const y of ys) {
    const point = clampDesktopPoint({ x, y }, target, viewport, runtime.activityArea);
    if (isDesktopFurniturePlacementValid(runtime, target, point, viewport)) candidates.push(point);
  }
  candidates.sort((a, b) => Math.hypot(a.x - original.x, a.y - original.y)
    - Math.hypot(b.x - original.x, b.y - original.y) || a.x - b.x || a.y - b.y);
  return candidates[0] ?? null;
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
  const oldArea = normalizeDesktopActivityArea(valid ? candidate.activityArea : undefined, {
    ...viewport,
    width: oldWidth > 0 ? oldWidth : viewport.width,
    height: oldHeight > 0 ? oldHeight : viewport.height,
  });
  const activityArea = normalizeDesktopActivityArea({
    x: oldArea.x * ratioX, y: oldArea.y * ratioY,
    width: oldArea.width * ratioX, height: oldArea.height * ratioY,
  }, viewport);
  const point = (target: "avatar" | "computer", fallback: DesktopPoint): DesktopPoint => {
    const saved = valid ? candidate[target] : undefined;
    return clampDesktopPoint(saved ? {
      x: finite(saved.x, fallback.x / ratioX) * ratioX,
      y: finite(saved.y, fallback.y / ratioY) * ratioY,
    } : fallback, target, viewport, activityArea);
  };
  const computer = point("computer", { x: viewport.width * 0.75, y: viewport.height * 0.63 });
  const savedMachine = valid ? candidate.vendingMachine ?? candidate.vendingMachineParked : undefined;
  const preferredMachine = savedMachine && typeof savedMachine === "object" ? {
    x: finite(savedMachine.x, activityArea.x + activityArea.width / 2) * ratioX,
    y: finite(savedMachine.y, activityArea.y + activityArea.height / 2) * ratioY,
  } : null;
  const vendingMachine = preferredMachine ? findDesktopFurniturePlacement(
    { computer, vendingMachine: null, activityArea }, "vendingMachine", preferredMachine, viewport,
  ) : null;
  return {
    version: 1, monitorId: viewport.monitorId,
    viewport: { width: viewport.width, height: viewport.height },
    avatar: point("avatar", { x: viewport.width * 0.60, y: viewport.height * 0.72 }),
    computer,
    activityArea,
    ...(vendingMachine ? { vendingMachine } : preferredMachine
      ? { vendingMachine: null, vendingMachineParked: preferredMachine } : {}),
  };
};

export const createDesktopRuntime = (layout: DesktopLayout): DesktopRuntime => {
  const viewport: DesktopViewport = { ...layout.viewport, monitorId: layout.monitorId, scaleFactor: 1 };
  const normalized = normalizeDesktopLayout(layout, viewport);
  const activityArea = normalized.activityArea!;
  const avatar = normalized.avatar;
  return {
    avatar: {
      ...avatar, targetX: avatar.x, targetY: avatar.y,
      facing: "front", behavior: "idle", behaviorTimer: 0, expression: "calm",
    },
    computer: normalized.computer,
    activityArea, nextDecisionAt: 0, dragPauseUntil: 0, lastTaskBehavior: null,
    vendingMachine: normalized.vendingMachine ?? null,
    vendingMachineParked: normalized.vendingMachineParked ?? null,
    vendingInteraction: null, navigationPath: [],
  };
};

export const desktopLayoutFromRuntime = (
  runtime: DesktopRuntime, viewport: DesktopViewport,
): DesktopLayout => ({
  version: 1, monitorId: viewport.monitorId,
  viewport: { width: viewport.width, height: viewport.height },
  avatar: { x: runtime.avatar.x, y: runtime.avatar.y },
  computer: { ...runtime.computer },
  activityArea: { ...runtime.activityArea },
  ...(runtime.vendingMachine ? { vendingMachine: { ...runtime.vendingMachine } }
    : runtime.vendingMachineParked ? { vendingMachine: null, vendingMachineParked: { ...runtime.vendingMachineParked } } : {}),
});

export const canApplyDesktopActivityArea = (
  runtime: DesktopRuntime, area: DesktopActivityArea, viewport: DesktopViewport,
): boolean => {
  const machine = runtime.vendingMachine ?? runtime.vendingMachineParked;
  if (!machine) return true;
  const activityArea = normalizeDesktopActivityArea(area, viewport);
  const computer = clampDesktopPoint(runtime.computer, "computer", viewport, activityArea);
  return findDesktopFurniturePlacement({ computer, vendingMachine: null, activityArea },
    "vendingMachine", machine, viewport) !== null;
};

export const applyDesktopActivityArea = (
  runtime: DesktopRuntime, area: DesktopActivityArea, viewport: DesktopViewport, nowMs: number,
): DesktopRuntime => {
  const activityArea = normalizeDesktopActivityArea(area, viewport);
  // Constrain the computer first so every subsequent task target remains in
  // the new rectangle. Cancel old movement intentions when accepting a resize.
  const computer = clampDesktopPoint(runtime.computer, "computer", viewport, activityArea);
  const machine = runtime.vendingMachine ?? runtime.vendingMachineParked;
  const vendingMachine = machine ? findDesktopFurniturePlacement({ computer, vendingMachine: null, activityArea },
    "vendingMachine", machine, viewport) : null;
  if (machine && !vendingMachine) return runtime;
  const avatar = clampDesktopPoint(runtime.avatar, "avatar", viewport, activityArea);
  return {
    ...runtime, activityArea, computer, vendingMachine, vendingMachineParked: null,
    vendingInteraction: null, navigationPath: [], navigationKey: undefined,
    nextDecisionAt: nowMs + DRAG_REST_MS, dragPauseUntil: nowMs + DRAG_REST_MS,
    lastTaskBehavior: null,
    avatar: {
      ...runtime.avatar, ...avatar, targetX: avatar.x, targetY: avatar.y,
      behavior: "idle", behaviorTimer: 0, expression: "calm", facing: "front",
      actionIntent: undefined, actionActivityLabel: undefined, activityLabel: undefined,
      interactionTargetAlternates: undefined, navigationFailure: undefined,
    },
  };
};

export const moveDesktopObject = (
  runtime: DesktopRuntime, target: DesktopDragTarget, point: DesktopPoint,
  viewport: DesktopViewport, nowMs: number,
): DesktopRuntime => {
  const cancelled = cancelDesktopVendingInteraction(runtime, nowMs);
  if (target === "vendingMachine" && !runtime.vendingMachine) return cancelled;
  const next = clampDesktopPoint(point, target, viewport, runtime.activityArea);
  if (target !== "avatar" && !isDesktopFurniturePlacementValid(runtime, target, next, viewport)) return cancelled;
  return {
    ...cancelled, dragPauseUntil: nowMs + DRAG_REST_MS,
    navigationPath: [], navigationKey: undefined,
    nextDecisionAt: nowMs + DRAG_REST_MS,
    computer: target === "computer" ? next : runtime.computer,
    vendingMachine: target === "vendingMachine" ? next : runtime.vendingMachine,
    avatar: {
      ...cancelled.avatar,
      ...(target === "avatar" ? next : {}),
      targetX: target === "avatar" ? next.x : runtime.avatar.x,
      targetY: target === "avatar" ? next.y : runtime.avatar.y,
      behavior: "idle", behaviorTimer: 0, expression: "calm",
      actionIntent: undefined, activityLabel: undefined,
    },
  };
};

export const desktopWorkPoint = (
  computer: DesktopPoint, viewport: DesktopViewport, area?: DesktopActivityArea,
) => clampDesktopPoint({ x: computer.x, y: computer.y + 40 * DESKTOP_PIXEL_SCALE }, "avatar", viewport, area);

export const cancelDesktopVendingInteraction = (runtime: DesktopRuntime, nowMs: number): DesktopRuntime => {
  if (!runtime.vendingInteraction) return runtime;
  return {
    ...runtime, vendingInteraction: null, navigationPath: [], navigationKey: undefined,
    nextDecisionAt: nowMs + 2500,
    avatar: {
      ...runtime.avatar, targetX: runtime.avatar.x, targetY: runtime.avatar.y,
      behavior: "idle", behaviorTimer: 0, expression: "calm", facing: "front",
      actionIntent: undefined, actionActivityLabel: undefined, activityLabel: undefined,
    },
  };
};

export const placeDesktopVendingMachine = (
  runtime: DesktopRuntime, viewport: DesktopViewport, nowMs: number, preferredPoint?: DesktopPoint,
): { runtime: DesktopRuntime; ok: boolean } => {
  if (runtime.vendingMachine || runtime.vendingMachineParked) return { runtime, ok: false };
  const position = findDesktopFurniturePlacement(runtime, "vendingMachine", preferredPoint ?? {
    x: runtime.computer.x - 120 * DESKTOP_PIXEL_SCALE,
    y: runtime.computer.y + 15 * DESKTOP_PIXEL_SCALE,
  }, viewport);
  if (!position) return { runtime, ok: false };
  return { ok: true, runtime: {
    ...cancelDesktopVendingInteraction(runtime, nowMs), vendingMachine: position, vendingMachineParked: null,
    navigationPath: [], navigationKey: undefined,
  } };
};

export const removeDesktopVendingMachine = (runtime: DesktopRuntime, nowMs: number): DesktopRuntime => ({
  ...cancelDesktopVendingInteraction(runtime, nowMs),
  vendingMachine: null, vendingMachineParked: null, navigationPath: [], navigationKey: undefined,
});

export const beginDesktopVendingInteraction = (
  runtime: DesktopRuntime, productId: DesktopVendingProductId, requestId: string,
  viewport: DesktopViewport, nowMs: number,
): DesktopRuntime => {
  if (!runtime.vendingMachine || runtime.vendingInteraction || !requestId.trim()
    || !["cookie", "cola", "coffee"].includes(productId)
    || !isDesktopFurniturePlacementValid(runtime, "vendingMachine", runtime.vendingMachine, viewport)) return runtime;
  const target = desktopVendingInteractionPoint(runtime.vendingMachine);
  return {
    ...runtime, vendingInteraction: { requestId, productId, phase: "approach", phaseStartedAt: nowMs, purchaseRequested: false },
    navigationPath: [], navigationKey: undefined, dragPauseUntil: 0,
    avatar: { ...runtime.avatar, targetX: target.x, targetY: target.y,
      behavior: "wander", behaviorTimer: 0, expression: "calm", actionIntent: undefined, activityLabel: undefined },
  };
};

export const takeDesktopVendingPurchaseRequest = (
  runtime: DesktopRuntime,
): { runtime: DesktopRuntime; request: DesktopVendingPurchaseRequest | null } => {
  const interaction = runtime.vendingInteraction;
  if (interaction?.phase !== "awaitingPurchase" || interaction.purchaseRequested) return { runtime, request: null };
  return {
    runtime: { ...runtime, vendingInteraction: { ...interaction, purchaseRequested: true } },
    request: { requestId: interaction.requestId, productId: interaction.productId },
  };
};

export const settleDesktopVendingPurchase = (
  runtime: DesktopRuntime, requestId: string, success: boolean, nowMs: number,
): DesktopRuntime => {
  const interaction = runtime.vendingInteraction;
  if (!interaction || interaction.requestId !== requestId || interaction.phase !== "awaitingPurchase"
    || !interaction.purchaseRequested || !runtime.vendingMachine) return runtime;
  if (!success) return cancelDesktopVendingInteraction(runtime, nowMs);
  return { ...runtime, vendingInteraction: { ...interaction, phase: "dispense", phaseStartedAt: nowMs } };
};

const navigationObstacles = (runtime: DesktopRuntime): DesktopHitRegion[] => {
  const bodies = [desktopTerminalVisualBounds(runtime.computer)];
  if (runtime.vendingMachine) bodies.push(desktopVendingVisualBounds(runtime.vendingMachine));
  // Convert body collision into avatar-anchor space using the room's small
  // foot projection, keeping the head free to overlap the machine in front.
  return bodies.map((body) => ({
    x: body.x - 6 * DESKTOP_PIXEL_SCALE - 2,
    y: body.y - 14 * DESKTOP_PIXEL_SCALE - 2,
    width: body.width + 12 * DESKTOP_PIXEL_SCALE + 4,
    height: body.height + 8 * DESKTOP_PIXEL_SCALE + 4,
  }));
};
const pointInside = (point: DesktopPoint, bounds: DesktopHitRegion) =>
  point.x > bounds.x + 1e-7 && point.x < bounds.x + bounds.width - 1e-7
  && point.y > bounds.y + 1e-7 && point.y < bounds.y + bounds.height - 1e-7;

export const desktopAvatarPointBlocked = (runtime: DesktopRuntime, point: DesktopPoint) =>
  navigationObstacles(runtime).some((obstacle) => pointInside(point, obstacle));

const segmentHitsRectangle = (from: DesktopPoint, to: DesktopPoint, bounds: DesktopHitRegion) => {
  let enter = 0;
  let exit = 1;
  for (const axis of ["x", "y"] as const) {
    const delta = to[axis] - from[axis];
    const low = bounds[axis] + 1e-7;
    const high = bounds[axis] + (axis === "x" ? bounds.width : bounds.height) - 1e-7;
    if (Math.abs(delta) < 1e-9) {
      if (from[axis] <= low || from[axis] >= high) return false;
    } else {
      const a = (low - from[axis]) / delta;
      const b = (high - from[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) return false;
    }
  }
  return enter <= exit && exit >= 0 && enter <= 1;
};

/** Small visibility graph: two devices need only their expanded corners. */
export const findDesktopPath = (
  runtime: DesktopRuntime, requestedTarget: DesktopPoint, viewport: DesktopViewport,
): DesktopPoint[] => {
  const obstacles = navigationObstacles(runtime);
  const target = clampDesktopPoint(requestedTarget, "avatar", viewport, runtime.activityArea);
  const clampPoint = (point: DesktopPoint) => clampDesktopPoint(point, "avatar", viewport, runtime.activityArea);
  const candidates: DesktopPoint[] = [target];
  for (const bounds of obstacles) {
    const left = bounds.x - 1;
    const right = bounds.x + bounds.width + 1;
    const top = bounds.y - 1;
    const bottom = bounds.y + bounds.height + 1;
    candidates.push(...[
      { x: left, y: top }, { x: left, y: bottom }, { x: right, y: top }, { x: right, y: bottom },
      { x: left, y: target.y }, { x: right, y: target.y }, { x: target.x, y: top }, { x: target.x, y: bottom },
    ].map(clampPoint));
  }
  const free = candidates.filter((point) => !obstacles.some((bounds) => pointInside(point, bounds)));
  if (free.length === 0) return [];
  free.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
  const goal = free[0];
  const start = { x: runtime.avatar.x, y: runtime.avatar.y };
  const nodes = [start, goal, ...free.slice(1)];
  const distances = nodes.map((_, index) => index === 0 ? 0 : Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const visited = new Set<number>();
  for (let step = 0; step < nodes.length; step += 1) {
    let current = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      if (!visited.has(index) && (current < 0 || distances[index] < distances[current])) current = index;
    }
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === 1) {
      const path: DesktopPoint[] = [];
      for (let index = 1; index !== 0 && index >= 0; index = previous[index]) path.unshift({ ...nodes[index] });
      return path;
    }
    visited.add(current);
    for (let next = 0; next < nodes.length; next += 1) {
      if (next === current || visited.has(next)) continue;
      const blocked = obstacles.some((bounds) => {
        // A manually dropped avatar may start inside a body. Its first edge
        // can exit that body; subsequent edges still obey ordinary collision.
        if (current === 0 && pointInside(start, bounds) && !pointInside(nodes[next], bounds)) return false;
        return segmentHitsRectangle(nodes[current], nodes[next], bounds);
      });
      if (blocked) continue;
      const distance = distances[current] + Math.hypot(nodes[current].x - nodes[next].x, nodes[current].y - nodes[next].y);
      if (distance < distances[next]) { distances[next] = distance; previous[next] = current; }
    }
  }
  return [];
};

const navigationKey = (runtime: DesktopRuntime, target: DesktopPoint) => JSON.stringify([
  target.x, target.y, runtime.computer.x, runtime.computer.y, runtime.vendingMachine?.x, runtime.vendingMachine?.y,
  runtime.activityArea.x, runtime.activityArea.y, runtime.activityArea.width, runtime.activityArea.height,
]);

const advanceDesktopWalk = (runtime: DesktopRuntime, viewport: DesktopViewport, elapsedSeconds: number): DesktopRuntime => {
  const avatar = { ...runtime.avatar };
  const target = { x: avatar.targetX, y: avatar.targetY };
  let key = navigationKey(runtime, target);
  let path = runtime.navigationKey === key ? [...runtime.navigationPath] : findDesktopPath(runtime, target, viewport);
  if (path.length > 0) {
    const goal = path[path.length - 1];
    avatar.targetX = goal.x;
    avatar.targetY = goal.y;
    key = navigationKey(runtime, goal);
  }
  let remaining = WALK_SPEED * clamp(elapsedSeconds, 0, 0.1);
  while (path.length > 0) {
    const next = path[0];
    const dx = next.x - avatar.x;
    const dy = next.y - avatar.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-7) { path.shift(); continue; }
    avatar.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "front" : "back");
    const step = Math.min(remaining, distance);
    avatar.x += dx / distance * step;
    avatar.y += dy / distance * step;
    remaining -= step;
    if (step >= distance - 1e-7) path.shift();
    if (remaining <= 1e-7) break;
  }
  return { ...runtime, avatar, navigationPath: path, navigationKey: key };
};

const expressionForTask = (behavior: BehaviorName): AvatarRuntime["expression"] =>
  behavior === "success" ? "happy" : behavior === "error" || behavior === "waiting" ? "worried" : "focused";

/** Visual movement only. Status mapping, stats, rewards, audio and storage stay with App. */
export const tickDesktopRuntime = (
  runtime: DesktopRuntime, taskBehavior: BehaviorName | null, viewport: DesktopViewport,
  elapsedSeconds: number, nowMs: number, random: () => number = Math.random,
): DesktopRuntime => {
  // A task owns the avatar immediately, even during a drag grace period or an
  // in-flight purchase. A later receipt cannot resurrect the cancelled flow.
  const current = taskBehavior ? cancelDesktopVendingInteraction(runtime, nowMs) : runtime;
  if (nowMs < current.dragPauseUntil) return current;
  let next: DesktopRuntime = { ...current, avatar: { ...current.avatar }, lastTaskBehavior: taskBehavior };
  if (next.vendingInteraction && !next.vendingMachine) next = cancelDesktopVendingInteraction(next, nowMs);

  if (!taskBehavior && next.vendingInteraction && next.vendingMachine) {
    let interaction = { ...next.vendingInteraction };
    if (interaction.phase === "approach") {
      const target = desktopVendingInteractionPoint(next.vendingMachine);
      next.avatar.targetX = target.x;
      next.avatar.targetY = target.y;
      next = advanceDesktopWalk(next, viewport, elapsedSeconds);
      if (Math.hypot(next.avatar.x - target.x, next.avatar.y - target.y) > ARRIVAL_DISTANCE) {
        return { ...next, avatar: { ...next.avatar, behavior: "wander", expression: "calm", actionIntent: undefined } };
      }
      next.avatar.x = target.x;
      next.avatar.y = target.y;
      interaction = { ...interaction, phase: "press", phaseStartedAt: nowMs };
    } else if (interaction.phase === "press" && nowMs - interaction.phaseStartedAt >= DESKTOP_VENDING_PRESS_MS) {
      interaction = { ...interaction, phase: "awaitingPurchase", phaseStartedAt: nowMs };
    } else if (interaction.phase === "dispense" && nowMs - interaction.phaseStartedAt >= DESKTOP_VENDING_DISPENSE_MS) {
      interaction = { ...interaction, phase: "consume", phaseStartedAt: nowMs };
    } else if (interaction.phase === "consume" && nowMs - interaction.phaseStartedAt >= DESKTOP_VENDING_CONSUME_MS) {
      return cancelDesktopVendingInteraction(next, nowMs);
    }
    return {
      ...next, vendingInteraction: interaction,
      avatar: {
        ...next.avatar, behavior: interaction.phase === "consume" ? interaction.productId : "interact",
        facing: interaction.phase === "consume" ? "front" : "back",
        expression: interaction.phase === "consume" ? "happy" : "focused",
        behaviorTimer: interaction.phase === "consume"
          ? Math.max(0, (DESKTOP_VENDING_CONSUME_MS - nowMs + interaction.phaseStartedAt) / 1000) : 0,
        actionIntent: undefined, activityLabel: undefined,
      },
    };
  }

  const avatar = next.avatar;
  const activeTask = taskBehavior === "thinking" || taskBehavior === "coding"
    || taskBehavior === "waiting" || taskBehavior === "error";
  if (activeTask) {
    const target = desktopWorkPoint(next.computer, viewport, next.activityArea);
    avatar.targetX = target.x;
    avatar.targetY = target.y;
  } else if (taskBehavior === "success") {
    avatar.targetX = avatar.x;
    avatar.targetY = avatar.y;
    avatar.behavior = "success";
    avatar.expression = "happy";
    avatar.facing = "front";
    avatar.actionIntent = undefined;
    next.navigationPath = [];
    next.navigationKey = undefined;
    next.nextDecisionAt = nowMs + 2500;
    return next;
  } else if (current.lastTaskBehavior) {
    avatar.targetX = avatar.x;
    avatar.targetY = avatar.y;
    next.nextDecisionAt = nowMs + 2500;
    next.navigationPath = [];
    next.navigationKey = undefined;
  } else if (nowMs >= current.nextDecisionAt) {
    const target = clampDesktopPoint({
      x: avatar.x + (random() - 0.5) * Math.min(640, next.activityArea.width * 0.7),
      y: avatar.y + (random() - 0.5) * Math.min(360, next.activityArea.height * 0.5),
    }, "avatar", viewport, next.activityArea);
    avatar.targetX = target.x;
    avatar.targetY = target.y;
    next.nextDecisionAt = nowMs + 6000 + random() * 7000;
  }

  next = advanceDesktopWalk(next, viewport, elapsedSeconds);
  const walked = next.avatar;
  const distance = Math.hypot(walked.targetX - walked.x, walked.targetY - walked.y);
  if (distance > ARRIVAL_DISTANCE) {
    walked.behavior = next.navigationPath.length > 0 ? "wander" : "idle";
    walked.expression = "calm";
    walked.actionIntent = activeTask ? taskBehavior! : undefined;
  } else {
    walked.x = walked.targetX;
    walked.y = walked.targetY;
    walked.behavior = activeTask ? taskBehavior! : "idle";
    walked.expression = activeTask ? expressionForTask(taskBehavior!) : "calm";
    walked.facing = activeTask && (taskBehavior === "thinking" || taskBehavior === "coding") ? "back" : "front";
    walked.actionIntent = undefined;
  }
  walked.behaviorTimer = 0;
  walked.activityLabel = undefined;
  return next;
};

export const desktopObjectBounds = (
  runtime: DesktopRuntime, target: DesktopDragTarget,
): DesktopHitRegion => target === "vendingMachine"
  ? runtime.vendingMachine ? desktopVendingVisualBounds(runtime.vendingMachine) : { x: 0, y: 0, width: 0, height: 0 }
  : target === "computer" ? desktopTerminalVisualBounds(runtime.computer)
  : {
    x: runtime.avatar.x - 29 * DESKTOP_PIXEL_SCALE,
    y: runtime.avatar.y - 46 * DESKTOP_PIXEL_SCALE,
    width: 58 * DESKTOP_PIXEL_SCALE, height: 61 * DESKTOP_PIXEL_SCALE,
  };

export const desktopObjectAtPoint = (runtime: DesktopRuntime, point: DesktopPoint): DesktopDragTarget | null => {
  // The avatar is also first in hit testing because it is above the computer.
  for (const target of ["avatar", "computer", "vendingMachine"] as const) {
    const bounds = desktopObjectBounds(runtime, target);
    if (bounds.width <= 0 || bounds.height <= 0) continue;
    if (point.x >= bounds.x && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y && point.y <= bounds.y + bounds.height) return target;
  }
  return null;
};
