export interface DesktopAnimationClock {
  now: () => number;
  requestFrame: (callback: (now: number) => void) => number;
  cancelFrame: (id: number) => void;
  setTimer: (callback: () => void, intervalMs: number) => number;
  clearTimer: (id: number) => void;
}

/** Transparent, non-activating WebViews may never deliver their first rAF. */
export const startDesktopAnimation = (
  clock: DesktopAnimationClock,
  onFrame: (now: number, elapsedSeconds: number, initial: boolean) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  let stopped = false;
  let animation = 0;
  let lastPump = clock.now();
  let lastAnimationFrame = lastPump;
  const pump = (now: number, initial = false) => {
    if (stopped) return;
    // Both producers share this timestamp. A rAF arriving after a fallback
    // frame must only advance the portion of time that has not been consumed.
    const elapsed = Math.min(0.1, Math.max(0, (now - lastPump) / 1000));
    lastPump = now;
    try { onFrame(now, elapsed, initial); }
    catch (error) { onError(error); }
  };
  const loop = (now: number) => {
    if (stopped) return;
    lastAnimationFrame = now;
    pump(now);
    animation = clock.requestFrame(loop);
  };
  // Paint before asking the browser for animation frames. This gives the
  // native compositor visible content even if it considers the view occluded.
  pump(lastPump, true);
  animation = clock.requestFrame(loop);
  const timer = clock.setTimer(() => {
    const now = clock.now();
    if (now - lastAnimationFrame >= 100) pump(now);
  }, 1000 / 30);
  return () => {
    stopped = true;
    clock.cancelFrame(animation);
    clock.clearTimer(timer);
  };
};
