export type ParkObjectKind = "tree" | "flowers" | "shrub" | "rock" | "bench" | "lamp";

export interface ParkObjectDefinition {
  kind: ParkObjectKind;
  name: string;
  radius: number;
}

export interface ParkObjectPlacement {
  id: string;
  kind: ParkObjectKind;
  x: number;
  y: number;
}

export const PARK_OBJECT_DEFINITIONS: ParkObjectDefinition[] = [
  { kind: "tree", name: "Windswept Tree", radius: 38 },
  { kind: "flowers", name: "Wildflowers", radius: 14 },
  { kind: "shrub", name: "Coastal Shrub", radius: 22 },
  { kind: "rock", name: "Cliff Rock", radius: 24 },
  { kind: "bench", name: "Park Bench", radius: 30 },
  { kind: "lamp", name: "Park Lamp", radius: 18 },
];

export const DEFAULT_PARK_OBJECTS: ParkObjectPlacement[] = [];

export const PARK_REFERENCE_COLLIDERS = [
  { x: 234, y: 397, radius: 38 },
  { x: 507, y: 298, radius: 52 },
  { x: 871, y: 334, radius: 40 },
  { x: 410, y: 346, radius: 31 },
  { x: 892, y: 382, radius: 32 },
  { x: 230, y: 487, radius: 34 },
  { x: 614, y: 500, radius: 28 },
] as const;

export const PARK_SCENE_WIDTH = 1180;
export const PARK_SCENE_HEIGHT = 900;

export const PARK_ENTRY_POINT = { x: 330, y: 760 };

export const PARK_BENCH_RELAX_SPOT = {
  id: "hilltop-bench",
  x: 804,
  y: 332,
  facing: "front" as const,
} as const;

export interface ParkFishingSpot {
  id: string;
  x: number;
  y: number;
  facing: "right";
  bobberX: number;
  bobberY: number;
}

export const PARK_FISHING_SPOTS: ParkFishingSpot[] = [
  {
    id: "upper-bank",
    x: 805,
    y: 555,
    facing: "right",
    bobberX: 937,
    bobberY: 574,
  },
  {
    id: "middle-bank",
    x: 785,
    y: 650,
    facing: "right",
    bobberX: 916,
    bobberY: 660,
  },
  {
    id: "lower-bank",
    x: 805,
    y: 745,
    facing: "right",
    bobberX: 995,
    bobberY: 788,
  },
];

export const parkFishingSpotById = (id?: string) =>
  PARK_FISHING_SPOTS.find((spot) => spot.id === id);

export const parkObjectDefinition = (kind: ParkObjectKind) =>
  PARK_OBJECT_DEFINITIONS.find((definition) => definition.kind === kind)!;

const plateauLeft = (y: number) => 110 + Math.max(0, y - 235) * 0.055;
const plateauRight = (y: number) => 1080 - Math.max(0, y - 235) * 0.025;

export const isParkGrassPoint = (x: number, y: number) => {
  if (y < 235 || y > 842 || x < plateauLeft(y) || x > plateauRight(y)) return false;
  const pondDx = (x - 1110) / 285;
  const pondDy = (y - 650) / 235;
  return pondDx * pondDx + pondDy * pondDy > 1.08;
};

export const isParkPlacementPoint = (
  x: number,
  y: number,
  objects: ParkObjectPlacement[],
  ignoredId?: string,
) =>
  isParkGrassPoint(x, y) &&
  PARK_REFERENCE_COLLIDERS.every(
    (collider) => Math.hypot(x - collider.x, y - collider.y) > collider.radius + 22,
  ) &&
  objects.every((object) => {
    if (object.id === ignoredId) return true;
    const radius = parkObjectDefinition(object.kind).radius;
    return Math.hypot(x - object.x, y - object.y) > radius + 22;
  });
