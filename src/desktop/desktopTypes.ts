import type { AvatarRuntime, BehaviorName } from "../types";

export interface DesktopPoint { x: number; y: number }
export interface DesktopViewport {
  width: number;
  height: number;
  scaleFactor: number;
  monitorId: string;
}

/** Coordinates are CSS pixels relative to the current monitor's work area. */
export interface DesktopLayout {
  version: 1;
  monitorId: string;
  viewport: { width: number; height: number };
  avatar: DesktopPoint;
  computer: DesktopPoint;
}

export interface DesktopRuntime {
  avatar: AvatarRuntime;
  computer: DesktopPoint;
  nextDecisionAt: number;
  dragPauseUntil: number;
  lastTaskBehavior: BehaviorName | null;
}

export interface DesktopHitRegion extends DesktopPoint { width: number; height: number }
export type DesktopDragTarget = "avatar" | "computer";
