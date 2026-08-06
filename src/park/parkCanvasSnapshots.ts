interface ParkCanvasSnapshotState {
  bitmap: ImageBitmap | null;
  pending: boolean;
  disabled: boolean;
}

const snapshotStateByCanvas = new WeakMap<
  HTMLCanvasElement,
  ParkCanvasSnapshotState
>();

const snapshotState = (canvas: HTMLCanvasElement) => {
  const existing = snapshotStateByCanvas.get(canvas);
  if (existing) return existing;

  const created: ParkCanvasSnapshotState = {
    bitmap: null,
    pending: false,
    disabled: false,
  };
  snapshotStateByCanvas.set(canvas, created);
  return created;
};

const requestParkCanvasSnapshot = (
  canvas: HTMLCanvasElement,
  state: ParkCanvasSnapshotState,
) => {
  if (state.pending || state.disabled || state.bitmap) return;
  if (
    typeof createImageBitmap !== "function"
    || canvas.width <= 0
    || canvas.height <= 0
  ) {
    state.disabled = true;
    return;
  }

  state.pending = true;
  void createImageBitmap(canvas)
    .then((bitmap) => {
      state.bitmap = bitmap;
    })
    .catch(() => {
      state.disabled = true;
    })
    .finally(() => {
      state.pending = false;
    });
};

export const parkCanvasSnapshotSource = (
  canvas: HTMLCanvasElement,
): CanvasImageSource => {
  const state = snapshotState(canvas);
  requestParkCanvasSnapshot(canvas, state);
  return state.bitmap ?? canvas;
};
