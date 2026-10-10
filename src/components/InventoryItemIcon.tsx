import {
  INVENTORY_PIXEL_ICONS,
  hasInventoryPixelIcon,
  type InventoryPixelIcon,
} from "./inventoryPixelIcons";

export function InventoryItemIcon({ itemId }: { itemId: string }) {
  if (!hasInventoryPixelIcon(itemId)) return null;
  const icon: InventoryPixelIcon = INVENTORY_PIXEL_ICONS[itemId];

  return (
    <span
      className="item-button-thumbnail item-thumbnail-inventory-pixel"
      data-inventory-icon={itemId}
      aria-hidden="true"
    >
      <svg width={16} height={16} viewBox="0 0 16 16" shapeRendering="crispEdges" focusable="false">
        {icon.pixels.flatMap((row, y) =>
          [...row].map((pixel, x) => pixel === "." ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={icon.palette[pixel]} />
          )),
        )}
      </svg>
    </span>
  );
}
