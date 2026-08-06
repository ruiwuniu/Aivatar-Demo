export const PARK_POND_ATLAS_SOURCE = "/park/hilltop-pond-motion-v1.png";
export const PARK_POND_ATLAS_FRAME_WIDTH = 396;
export const PARK_POND_ATLAS_FRAME_HEIGHT = 443;
export const PARK_POND_ATLAS_FRAME_COUNT = 80;
export const PARK_POND_ATLAS_COLUMNS = 8;
export const PARK_POND_ATLAS_ROWS = 10;
export const PARK_POND_ATLAS_FPS = 10;
export const PARK_POND_ATLAS_GUTTER = 1;
export const PARK_POND_ATLAS_CELL_WIDTH =
  PARK_POND_ATLAS_FRAME_WIDTH + PARK_POND_ATLAS_GUTTER * 2;
export const PARK_POND_ATLAS_CELL_HEIGHT =
  PARK_POND_ATLAS_FRAME_HEIGHT + PARK_POND_ATLAS_GUTTER * 2;
export const PARK_POND_ATLAS_WIDTH =
  PARK_POND_ATLAS_CELL_WIDTH * PARK_POND_ATLAS_COLUMNS;
export const PARK_POND_ATLAS_HEIGHT =
  PARK_POND_ATLAS_CELL_HEIGHT * PARK_POND_ATLAS_ROWS;

export type ParkPondAtlasStatus = "idle" | "loading" | "ready" | "error";

let pondAtlas: HTMLImageElement | null = null;
let pondAtlasStatus: ParkPondAtlasStatus = "idle";

const acceptPondAtlas = (image: HTMLImageElement) => {
  if (
    image.naturalWidth !== PARK_POND_ATLAS_WIDTH
    || image.naturalHeight !== PARK_POND_ATLAS_HEIGHT
  ) {
    pondAtlasStatus = "error";
    return;
  }
  pondAtlas = image;
  pondAtlasStatus = "ready";
};

export const ensureParkPondAtlas = () => {
  if (pondAtlasStatus !== "idle" || typeof Image === "undefined") return;
  pondAtlasStatus = "loading";
  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", () => {
    void image.decode()
      .catch(() => undefined)
      .then(() => acceptPondAtlas(image));
  }, { once: true });
  image.addEventListener("error", () => {
    pondAtlasStatus = "error";
  }, { once: true });
  image.src = PARK_POND_ATLAS_SOURCE;
};

export const getParkPondAtlas = () => pondAtlas;

export const getParkPondAtlasStatus = () => pondAtlasStatus;

export const parkPondAtlasFrameSource = (nowMs: number) => {
  const frameDurationMs = 1000 / PARK_POND_ATLAS_FPS;
  const frame = Math.floor(nowMs / frameDurationMs) % PARK_POND_ATLAS_FRAME_COUNT;
  return {
    frame,
    x: (frame % PARK_POND_ATLAS_COLUMNS) * PARK_POND_ATLAS_CELL_WIDTH
      + PARK_POND_ATLAS_GUTTER,
    y: Math.floor(frame / PARK_POND_ATLAS_COLUMNS) * PARK_POND_ATLAS_CELL_HEIGHT
      + PARK_POND_ATLAS_GUTTER,
  };
};
