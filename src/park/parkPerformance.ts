const PARK_PERFORMANCE_WINDOW = 180;
const PARK_PERFORMANCE_REPORT_INTERVAL_MS = 1000;

interface ParkPerformanceState {
  renderDurations: number[];
  renderIntervals: number[];
  lastRenderAt: number | null;
  lastReportAt: number;
  rendersSinceReport: number;
}

const performanceStateByCanvas = new WeakMap<
  HTMLCanvasElement,
  ParkPerformanceState
>();

const percentile = (values: readonly number[], ratio: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
};

const average = (values: readonly number[]) =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;

const pushBounded = (values: number[], value: number) => {
  values.push(value);
  if (values.length > PARK_PERFORMANCE_WINDOW) {
    values.splice(0, values.length - PARK_PERFORMANCE_WINDOW);
  }
};

const setDatasetValue = (
  canvas: HTMLCanvasElement,
  key: string,
  value: string,
) => {
  if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
};

export const measureParkRender = (
  canvas: HTMLCanvasElement,
  frameNowMs: number,
  render: () => void,
) => {
  let state = performanceStateByCanvas.get(canvas);
  if (!state) {
    state = {
      renderDurations: [],
      renderIntervals: [],
      lastRenderAt: null,
      lastReportAt: frameNowMs,
      rendersSinceReport: 0,
    };
    performanceStateByCanvas.set(canvas, state);
  }

  if (state.lastRenderAt !== null) {
    pushBounded(state.renderIntervals, frameNowMs - state.lastRenderAt);
  }
  state.lastRenderAt = frameNowMs;

  const startedAt = performance.now();
  render();
  pushBounded(state.renderDurations, performance.now() - startedAt);
  state.rendersSinceReport += 1;

  const reportElapsedMs = frameNowMs - state.lastReportAt;
  if (reportElapsedMs < PARK_PERFORMANCE_REPORT_INTERVAL_MS) return;

  const renderAverage = average(state.renderDurations);
  const intervalAverage = average(state.renderIntervals);
  setDatasetValue(canvas, "parkPerfAverageRenderMs", renderAverage.toFixed(2));
  setDatasetValue(
    canvas,
    "parkPerfP95RenderMs",
    percentile(state.renderDurations, 0.95).toFixed(2),
  );
  setDatasetValue(
    canvas,
    "parkPerfMaxRenderMs",
    Math.max(0, ...state.renderDurations).toFixed(2),
  );
  setDatasetValue(
    canvas,
    "parkPerfAverageIntervalMs",
    intervalAverage.toFixed(2),
  );
  setDatasetValue(
    canvas,
    "parkPerfP95IntervalMs",
    percentile(state.renderIntervals, 0.95).toFixed(2),
  );
  setDatasetValue(
    canvas,
    "parkPerfRenderFps",
    (state.rendersSinceReport / (reportElapsedMs / 1000)).toFixed(1),
  );
  setDatasetValue(
    canvas,
    "parkPerfOver16ms",
    String(state.renderDurations.filter((value) => value > 16.7).length),
  );
  setDatasetValue(
    canvas,
    "parkPerfOver33ms",
    String(state.renderDurations.filter((value) => value > 33.4).length),
  );
  setDatasetValue(canvas, "parkPerfSamples", String(state.renderDurations.length));

  state.lastReportAt = frameNowMs;
  state.rendersSinceReport = 0;
};
