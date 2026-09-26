import type { AvatarRuntime, BehaviorName } from "../types";

export interface DesktopPoint { x: number; y: number }
export interface DesktopActivityArea extends DesktopPoint { width: number; height: number }
export type DesktopAreaHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
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
  /** Missing in earlier v1 layouts, where the whole work area was available. */
  activityArea?: DesktopActivityArea;
}

export interface DesktopRuntime {
  avatar: AvatarRuntime;
  computer: DesktopPoint;
  activityArea: DesktopActivityArea;
  nextDecisionAt: number;
  dragPauseUntil: number;
  lastTaskBehavior: BehaviorName | null;
}

export interface DesktopHitRegion extends DesktopPoint { width: number; height: number }
export type DesktopDragTarget = "avatar" | "computer";
