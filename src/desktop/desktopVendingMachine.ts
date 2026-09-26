import type { DesktopHitRegion, DesktopPoint } from "./desktopTypes";

export const DESKTOP_PIXEL_SCALE = 4 / 3;
export const DESKTOP_FURNITURE_GAP = 4 * DESKTOP_PIXEL_SCALE;
export const DESKTOP_VENDING_PRESS_MS = 450;
export const DESKTOP_VENDING_DISPENSE_MS = 1000;
export const DESKTOP_VENDING_CONSUME_MS = 4000;
export const DESKTOP_VENDING_SPRITE = {
  src: "/assets/furniture/desktop-vending-machine.png",
  source: { x: 142, y: 65, width: 740, height: 1404 },
  width: 60,
  height: 114,
} as const;

/** All public geometry is in CSS pixels; vending anchors are bottom-centre. */
export const desktopVendingVisualBounds = (point: DesktopPoint): DesktopHitRegion => ({
  x: point.x - 30 * DESKTOP_PIXEL_SCALE,
  y: point.y - 114 * DESKTOP_PIXEL_SCALE,
  width: 60 * DESKTOP_PIXEL_SCALE,
  height: 114 * DESKTOP_PIXEL_SCALE,
});

export const desktopVendingInteractionPoint = (point: DesktopPoint): DesktopPoint => ({
  // The pickup opening is left of the body centre in the selected PNG.
  x: point.x - 6.1 * DESKTOP_PIXEL_SCALE,
  y: point.y + 28 * DESKTOP_PIXEL_SCALE,
});

export const desktopVendingFrontBounds = (point: DesktopPoint): DesktopHitRegion => ({
  x: point.x - (6.1 + 12) * DESKTOP_PIXEL_SCALE,
  y: point.y,
  width: 24 * DESKTOP_PIXEL_SCALE,
  height: (28 + 17) * DESKTOP_PIXEL_SCALE,
});

export const desktopTerminalVisualBounds = (point: DesktopPoint): DesktopHitRegion => ({
  x: point.x - 21 * DESKTOP_PIXEL_SCALE,
  y: point.y - 35 * DESKTOP_PIXEL_SCALE,
  width: 42 * DESKTOP_PIXEL_SCALE,
  height: 50 * DESKTOP_PIXEL_SCALE,
});

export const desktopTerminalFrontBounds = (point: DesktopPoint): DesktopHitRegion => ({
  x: point.x - 12 * DESKTOP_PIXEL_SCALE,
  y: point.y + 15 * DESKTOP_PIXEL_SCALE,
  width: 24 * DESKTOP_PIXEL_SCALE,
  height: (40 + 17 - 15) * DESKTOP_PIXEL_SCALE,
});

export const desktopRectsOverlap = (left: DesktopHitRegion, right: DesktopHitRegion, gap = 0) =>
  left.x < right.x + right.width + gap - 1e-7
  && left.x + left.width + gap > right.x + 1e-7
  && left.y < right.y + right.height + gap - 1e-7
  && left.y + left.height + gap > right.y + 1e-7;

export const desktopFurniturePairFits = (computer: DesktopPoint, vending: DesktopPoint) => {
  const terminalBody = desktopTerminalVisualBounds(computer);
  const vendingBody = desktopVendingVisualBounds(vending);
  return !desktopRectsOverlap(terminalBody, vendingBody, DESKTOP_FURNITURE_GAP)
    && !desktopRectsOverlap(desktopTerminalFrontBounds(computer), vendingBody, DESKTOP_FURNITURE_GAP)
    && !desktopRectsOverlap(desktopVendingFrontBounds(vending), terminalBody, DESKTOP_FURNITURE_GAP);
};
