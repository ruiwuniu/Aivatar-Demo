import type { AvatarRuntime, BehaviorName } from "../types";

export interface DesktopPoint { x: number; y: number }
export interface DesktopActivityArea extends DesktopPoint { width: number; height: number }
export type DesktopAreaHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type DesktopVendingProductId = "cookie" | "cola" | "coffee";
export type DesktopVendingSkinId = "original" | "red" | "dark-green";
export type DesktopVendingPhase = "approach" | "press" | "awaitingPurchase" | "dispense" | "consume";
export interface DesktopVendingInteraction {
  requestId: string;
  productId: DesktopVendingProductId;
  phase: DesktopVendingPhase;
  phaseStartedAt: number;
  purchaseRequested: boolean;
}
export interface DesktopVendingPurchaseRequest { requestId: string; productId: DesktopVendingProductId }
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
  vendingMachine?: DesktopPoint | null;
  /** Retain a placed machine while a temporarily smaller screen cannot fit it. */
  vendingMachineParked?: DesktopPoint;
  /** Independent of placement, so packing the machine retains its appearance. */
  vendingMachineSkinId?: DesktopVendingSkinId;
}

export interface DesktopRuntime {
  avatar: AvatarRuntime;
  computer: DesktopPoint;
  activityArea: DesktopActivityArea;
  vendingMachine: DesktopPoint | null;
  vendingMachineParked: DesktopPoint | null;
  vendingMachineSkinId: DesktopVendingSkinId;
  vendingInteraction: DesktopVendingInteraction | null;
  navigationPath: DesktopPoint[];
  navigationKey?: string;
  nextDecisionAt: number;
  dragPauseUntil: number;
  lastTaskBehavior: BehaviorName | null;
}

export interface DesktopHitRegion extends DesktopPoint { width: number; height: number }
export type DesktopDragTarget = "avatar" | "computer" | "vendingMachine";
