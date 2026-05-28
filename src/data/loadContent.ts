import type { AivatarContent } from "../types";
import { defaultContent } from "./defaultContent";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const mergeContent = (value: unknown): AivatarContent => {
  if (!isRecord(value)) return defaultContent;

  const avatar = isRecord(value.avatar)
    ? { ...defaultContent.avatar, ...value.avatar }
    : defaultContent.avatar;

  const room = isRecord(value.room)
    ? {
        ...defaultContent.room,
        ...value.room,
        zones: Array.isArray(value.room.zones) ? value.room.zones : defaultContent.room.zones,
        furniture: Array.isArray(value.room.furniture)
          ? value.room.furniture
          : defaultContent.room.furniture,
        floorSurfaces: Array.isArray(value.room.floorSurfaces)
          ? value.room.floorSurfaces
          : defaultContent.room.floorSurfaces,
        wallSurfaces: Array.isArray(value.room.wallSurfaces)
          ? value.room.wallSurfaces
          : defaultContent.room.wallSurfaces,
        windows: Array.isArray(value.room.windows)
          ? value.room.windows
          : defaultContent.room.windows,
      }
    : defaultContent.room;

  const shop = isRecord(value.shop)
    ? {
        ...defaultContent.shop,
        ...value.shop,
        items: Array.isArray(value.shop.items) ? value.shop.items : defaultContent.shop.items,
      }
    : defaultContent.shop;

  return {
    ...defaultContent,
    ...value,
    avatar,
    room,
    shop,
    inventory: Array.isArray(value.inventory) ? value.inventory : defaultContent.inventory,
    itemDefinitions: Array.isArray(value.itemDefinitions)
      ? value.itemDefinitions
      : defaultContent.itemDefinitions,
    petStats: isRecord(value.petStats)
      ? { ...defaultContent.petStats, ...value.petStats }
      : defaultContent.petStats,
    wallet: isRecord(value.wallet)
      ? { ...defaultContent.wallet, ...value.wallet }
      : defaultContent.wallet,
  } as AivatarContent;
};

export const loadContentConfig = async (): Promise<AivatarContent> => {
  const response = await fetch("/config/aivatar.config.json", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Config request failed with ${response.status}`);
  }

  return mergeContent(await response.json());
};
