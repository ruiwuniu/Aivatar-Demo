import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Execute the production runtime with a fake monotonic clock and seeded inputs.
// The storage trap ensures these checks never open or modify a user's save.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let clock = 1000;
const context = vm.createContext({
  console,
  performance: { now: () => clock },
  setTimeout,
  clearTimeout,
});
const modules = new Map();
const load = (relative) => {
  if (modules.has(relative)) return modules.get(relative).exports;
  if (relative === "src/persistence/saveStore.ts") {
    return { appStorage: new Proxy({}, { get() { throw new Error("Fishing test must not access storage"); } }) };
  }
  assert(relative.startsWith("src/") && !relative.includes(".."));
  const module = { exports: {} };
  modules.set(relative, module);
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative,
  }).outputText;
  const evaluate = vm.runInContext(`(function(require,module,exports){${javascript}\n})`, context, { filename: relative });
  evaluate((specifier) => {
    assert(specifier.startsWith("."), `Unexpected external import ${specifier}`);
    return load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${specifier}.ts`)));
  }, module, module.exports);
  return module.exports;
};
const runtime = load("src/park/parkRuntime.ts");
const gameApi = load("src/park/parkFishingGame.ts");
const options = { objects: [], traits: { resilience: 1_000_000, focus: 0 }, hasRod: true };
const sequence = (...values) => {
  let index = 0;
  return () => {
    assert(index < values.length, "Unexpected random draw");
    return values[index++];
  };
};
const advance = (state, now, overrides = {}) => {
  clock = now;
  return runtime.advanceParkSimulation(state, 0, now, { ...options, random: () => 0, ...overrides });
};
const invited = (inviteRoll = 0) => {
  clock = 1000;
  const initial = { ...runtime.initialParkSimulation(), activity: "to-fishing", fishingSpotId: "middle-bank" };
  const casting = advance(initial, clock).state;
  return advance(casting, casting.activityEndsAt, { random: sequence(0, inviteRoll) }).state;
};
const accept = (state, random = () => 0, at = clock) => runtime.applyParkFishingInput(
  state, { type: "accept", id: state.fishingGame.id }, at, random,
);
const qte = (random = () => 0) => {
  const waiting = accept(invited());
  return advance(waiting, waiting.fishingGame.biteAt, { random }).state;
};
const cursorTime = (game, position) => game.roundStartedAt
  + (game.roundEndsAt - game.roundStartedAt) * (game.direction === "reverse" ? 1 - position : position);
const hitTime = (game) => cursorTime(game, (game.targetStart + game.targetEnd) / 2);
const reel = (state, at = hitTime(state.fishingGame), overrides = {}, random = () => 0) => runtime.applyParkFishingInput(
  state, { type: "reel", id: state.fishingGame.id, round: state.fishingGame.round, ...overrides }, at, random,
);
const win = (state = qte(), random = () => 0) => {
  for (let hit = 0; hit < 3; hit += 1) state = reel(state, undefined, {}, random);
  return state;
};
let checks = 0;
const check = (name, run) => {
  run();
  checks += 1;
  console.log(`[park-fishing] PASS ${name}`);
};

check("each cast samples the 35% invitation threshold once, never each frame", () => {
  assert.equal(invited(0.34999).fishingGame.phase, "invite");
  assert.equal(invited(0.35).fishingGame, undefined);
  const state = invited(0.99);
  const next = advance(state, clock + 100, { random: () => { throw new Error("Wait frame resampled invitation"); } }).state;
  assert.equal(next.fishingGame, undefined);
});

check("invites expire after 12 seconds and stale or duplicate confirmations are ignored", () => {
  const state = invited();
  assert.equal(state.fishingGame.expiresAt - clock, 12_000);
  const stale = runtime.applyParkFishingInput(state, { type: "accept", id: state.fishingGame.id + 1 }, clock);
  assert.equal(stale, state);
  assert.equal(accept(state, () => 0, state.fishingGame.expiresAt), state);
  const accepted = accept(state);
  assert.equal(runtime.applyParkFishingInput(accepted, { type: "accept", id: state.fishingGame.id }, clock), accepted);
  const expired = advance({ ...state, nextBiteAt: Infinity }, state.fishingGame.expiresAt).state;
  assert.equal(expired.fishingGame, undefined);
});

check("decline preserves autonomous fishing and the 60-second cooldown survives recasts", () => {
  const state = invited();
  const declined = runtime.applyParkFishingInput(state, { type: "decline", id: state.fishingGame.id }, clock);
  assert.equal(declined.activity, "wait");
  assert.equal(declined.fishingGame, undefined);
  assert.equal(declined.nextBiteAt, state.nextBiteAt);
  assert.equal(declined.nextFishingInviteAt - clock, 60_000);
  const recasting = { ...declined, activity: "cast", activityEndsAt: clock + 1000 };
  const cooling = advance(recasting, recasting.activityEndsAt, { random: sequence(0) }).state;
  assert.equal(cooling.fishingGame, undefined);
  const ready = advance({ ...cooling, activity: "cast", activityEndsAt: state.nextFishingInviteAt }, state.nextFishingInviteAt).state;
  assert.equal(ready.fishingGame.phase, "invite");
  assert(ready.fishingGame.id > state.fishingGame.id);
  assert.equal(runtime.applyParkFishingInput(ready, { type: "accept", id: state.fishingGame.id }, clock), ready);
});

check("autonomous bites invalidate invitations and retain Focus-dependent landing", () => {
  const state = invited();
  const biting = advance(state, state.nextBiteAt).state;
  assert.equal(biting.activity, "bite");
  assert.equal(biting.fishingGame, undefined);
  assert.equal(runtime.applyParkFishingInput(biting, { type: "accept", id: state.fishingGame.id }, clock), biting);
  const lost = advance(biting, biting.activityEndsAt, { random: () => 0.99 }).state;
  assert.equal(lost.activity, "wait");
  assert.equal(lost.pendingFish, undefined);
  const landed = advance(biting, biting.activityEndsAt, { random: () => 0 }).state;
  assert.equal(landed.activity, "reel");
});

check("accepted casts guarantee a bite in 4–10 seconds despite the original session deadline", () => {
  for (const [roll, delay] of [[0, 4000], [1, 10_000]]) {
    const state = invited();
    const waiting = accept({ ...state, fishingSessionEndsAt: clock + 1 }, () => roll);
    assert.equal(waiting.fishingGame.biteAt - clock, delay);
    const before = advance(waiting, waiting.fishingGame.biteAt - 1).state;
    assert.equal(before.fishingGame.phase, "waiting");
    assert.equal(before.pendingFish, undefined);
    const biting = advance(before, waiting.fishingGame.biteAt).state;
    assert.equal(biting.fishingGame.phase, "qte");
    assert.equal(biting.activity, "bite");
    assert(biting.pendingFish);
  }
});

check("QTE cursor and target are bounded and only live round inputs are accepted", () => {
  const state = qte();
  const game = state.fishingGame;
  assert.equal(gameApi.parkFishingCursor(game, game.roundStartedAt - 100), 0);
  assert.equal(gameApi.parkFishingCursor(game, game.roundEndsAt + 100), 1);
  assert(game.targetStart > 0 && game.targetStart < game.targetEnd && game.targetEnd < 1);
  assert.equal(reel(state, hitTime(game), { round: game.round - 1 }), state);
  assert.equal(reel(state, hitTime(game), { id: game.id + 1 }), state);
  assert.equal(reel(state, hitTime(game), { round: undefined }), state);
  assert.equal(reel(state, game.roundEndsAt), state);
});

check("one input consumes one round and feedback blocks keyboard/click double input", () => {
  const state = qte();
  const now = hitTime(state.fishingGame);
  const hit = reel(state, now);
  assert.equal(hit.fishingGame.hits, 1);
  assert.equal(hit.fishingGame.lastOutcome, "hit");
  assert.equal(hit.fishingGame.nextInputAt - now, 350);
  assert.equal(reel(hit, now, { round: state.fishingGame.round }), hit);
  assert.equal(reel(hit, now), hit);
  assert.equal(reel(hit, hit.fishingGame.nextInputAt - 1), hit);
  const ready = advance(hit, hit.fishingGame.nextInputAt).state;
  assert.equal(ready.fishingGame.lastOutcome, undefined);
});

check("three hits succeed without another random landing check, yielding exactly one catch", () => {
  let state = win();
  assert.equal(state.fishingGame.phase, "success");
  assert.equal(state.fishingGame.hits, gameApi.PARK_FISHING_HITS_TO_WIN);
  assert.equal(state.activity, "reel");
  assert.equal(reel(state), state);
  assert.equal(runtime.cancelParkFishingGame(state, state.activityStartedAt), state);
  const fish = state.pendingFish;
  let next = advance(state, state.activityEndsAt, { allowFishingInvites: false, random: () => 0.99 });
  assert.equal(next.events.length, 0);
  assert.equal(next.state.activity, "display");
  assert.equal(next.state.fishingGame.phase, "success");
  next = advance(next.state, next.state.activityEndsAt, { allowFishingInvites: false, random: () => 0.99 });
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0].fishId, fish);
  assert.equal(next.state.fishingGame, undefined);
  assert.equal(next.state.pendingFish, undefined);
  next = advance(next.state, clock, { allowFishingInvites: false });
  assert.equal(next.events.length, 0);
});

check("two misses or round timeouts escape without rewarding a fish", () => {
  for (const timeout of [false, true]) {
    let state = qte();
    for (let miss = 0; miss < 2; miss += 1) {
      if (timeout) {
        const result = advance(state, state.fishingGame.roundEndsAt);
        assert.equal(result.events.length, 0);
        state = result.state;
      } else state = reel(state, state.fishingGame.roundStartedAt);
    }
    assert.equal(state.fishingGame.phase, "escaped");
    assert.equal(state.fishingGame.misses, gameApi.PARK_FISHING_MISSES_TO_LOSE);
    assert.equal(state.pendingFish, undefined);
    const resumed = advance(state, state.fishingGame.expiresAt);
    assert.equal(resumed.events.length, 0);
    assert.equal(resumed.state.fishingGame, undefined);
    assert.equal(resumed.state.activity, "wait");
  }
});

check("a manual catch can finish after session expiry, then returns to ordinary wandering", () => {
  const invitation = invited();
  const waiting = accept({ ...invitation, fishingSessionEndsAt: clock + 1 });
  const fighting = advance(waiting, waiting.fishingGame.biteAt).state;
  const won = win(fighting);
  assert.equal(won.activity, "reel");
  const shown = advance(won, won.activityEndsAt);
  assert.equal(shown.events.length, 0);
  const caught = advance(shown.state, shown.state.activityEndsAt);
  assert.equal(caught.events.length, 1);
  assert.equal(caught.state.activity, "wander");
  assert.equal(caught.state.pendingFish, undefined);
  assert.equal(caught.state.fishingGame, undefined);
});

check("one miss does not prevent winning and target-edge hits count", () => {
  let state = qte();
  state = reel(state, state.fishingGame.roundStartedAt);
  assert.equal(state.fishingGame.misses, 1);
  for (const edge of ["targetStart", "targetEnd"]) {
    const round = state.fishingGame;
    state = reel(state, cursorTime(round, round[edge]));
  }
  state = reel(state);
  assert.equal(state.fishingGame.phase, "success");
  assert.equal(state.fishingGame.hits, 3);
  assert.equal(state.fishingGame.misses, 1);
});

check("background cancellation clears unfinished attempts and expired sessions resume wandering", () => {
  for (const make of [invited, () => accept(invited()), qte]) {
    const state = make();
    const cancelled = runtime.cancelParkFishingGame(state, clock);
    assert.equal(cancelled.fishingGame, undefined);
    assert.equal(cancelled.pendingFish, undefined);
    assert.equal(runtime.applyParkFishingInput(cancelled, { type: "reel", id: state.fishingGame.id, round: state.fishingGame.round }, clock), cancelled);
    const hidden = advance(state, clock, { allowFishingInvites: false });
    assert.equal(hidden.state.fishingGame, undefined);
    assert.equal(hidden.events.length, 0);
  }
  const state = qte();
  const cancelled = runtime.cancelParkFishingGame(state, state.fishingSessionEndsAt + 1);
  assert.equal(cancelled.activity, "wander");
  assert.equal(cancelled.pendingFish, undefined);
});

check("rodless and hidden casts never invite, and re-entry never restores an unfinished game", () => {
  const original = invited();
  for (const override of [{ hasRod: false }, { allowFishingInvites: false }]) {
    const casting = { ...original, fishingGame: undefined, nextFishingInviteAt: 0, activity: "cast", activityEndsAt: clock };
    assert.equal(advance(casting, clock, override).state.fishingGame, undefined);
  }
  const inProgress = qte();
  const reopened = runtime.initialParkSimulation(inProgress.avatar, inProgress.navMemory);
  assert.equal(reopened.activity, "wander");
  assert.equal(reopened.fishingGame, undefined);
  assert.equal(reopened.pendingFish, undefined);
});

check("immediate exit during a won reel or display completes the same catch exactly once", () => {
  for (const presentation of ["reel", "display"]) {
    let won = win();
    if (presentation === "display") won = advance(won, won.activityEndsAt).state;
    const fish = won.pendingFish;
    const now = won.activityStartedAt;
    const finished = runtime.finishParkFishingGameOnExit(won, now);
    assert.equal(finished.events.length, 1);
    assert.equal(finished.events[0].fishId, fish);
    assert.equal(finished.state.activity, "wander");
    assert.equal(finished.state.fishingGame, undefined);
    assert.equal(finished.state.pendingFish, undefined);
    const repeated = runtime.finishParkFishingGameOnExit(finished.state, now);
    assert.equal(repeated.events.length, 0);
    assert.equal(repeated.state, finished.state);
    assert.equal(advance(repeated.state, now).events.length, 0);
    assert.equal(advance(repeated.state, won.activityEndsAt, { random: () => 0.99 }).events.length, 0);
  }
});

check("exit cancels invitations, waiting, active QTE, and escaped games without a catch", () => {
  const escaped = () => {
    let state = qte();
    state = reel(state, state.fishingGame.roundStartedAt);
    return reel(state, state.fishingGame.roundStartedAt);
  };
  for (const make of [invited, () => accept(invited()), qte, escaped]) {
    const state = make();
    const result = runtime.finishParkFishingGameOnExit(state, clock);
    assert.equal(result.events.length, 0);
    assert.equal(result.state.fishingGame, undefined);
    assert.equal(result.state.pendingFish, undefined);
    assert.equal(runtime.finishParkFishingGameOnExit(result.state, clock).events.length, 0);
  }
});

check("exit after ordinary completed display cannot award its fish a second time", () => {
  const won = win();
  const shown = advance(won, won.activityEndsAt);
  const caught = advance(shown.state, shown.state.activityEndsAt);
  assert.equal(caught.events.length, 1);
  const finished = runtime.finishParkFishingGameOnExit(caught.state, clock);
  assert.equal(finished.events.length, 0);
  assert.equal(finished.state.pendingFish, undefined);
});

check("random round parameters cover both directions with fair reaction and hit windows", () => {
  const durations = new Set();
  const widths = new Set();
  const positions = new Set();
  const directions = new Set();
  for (const durationRoll of [0, 0.37, 1]) {
    for (const widthRoll of [0, 0.61, 1]) {
      for (const positionRoll of [0, 0.43, 1]) {
        for (const directionRoll of [0, 1]) {
          const game = gameApi.startParkFishingRound(
            gameApi.createParkFishingInvite(1, 0), 1000.375,
            sequence(durationRoll, widthRoll, positionRoll, directionRoll),
          );
          const duration = game.roundEndsAt - game.roundStartedAt;
          const width = game.targetEnd - game.targetStart;
          const entryPosition = game.direction === "reverse" ? game.targetEnd : game.targetStart;
          const exitPosition = game.direction === "reverse" ? game.targetStart : game.targetEnd;
          const entryAt = cursorTime(game, entryPosition);
          const exitAt = cursorTime(game, exitPosition);
          assert(duration >= 2200 && duration <= 3400);
          assert(width >= 0.2 - 1e-12 && width <= 0.32 + 1e-12);
          assert(game.targetStart >= 0.2 - 1e-12 && game.targetEnd <= 0.8 + 1e-12);
          assert(entryAt - game.roundStartedAt >= 440 - 1e-9);
          assert(exitAt - entryAt >= 440 - 1e-9 && exitAt - entryAt <= 1088 + 1e-9);
          assert.equal(gameApi.parkFishingCursor(game, game.roundStartedAt - 100), directionRoll === 0 ? 0 : 1);
          assert.equal(gameApi.parkFishingCursor(game, game.roundEndsAt + 100), directionRoll === 0 ? 1 : 0);
          durations.add(duration.toFixed(5));
          widths.add(width.toFixed(5));
          positions.add(game.targetStart.toFixed(5));
          directions.add(game.direction);
        }
      }
    }
  }
  assert.equal(durations.size, 3);
  assert.equal(widths.size, 3);
  assert(positions.size >= 5);
  assert.deepEqual([...directions].sort(), ["forward", "reverse"]);
});

check("every round retains its sampled parameters while rendering and advancing time", () => {
  for (const roll of [0.27, 0.83]) {
    let state = qte(() => roll);
    const before = JSON.stringify(state.fishingGame);
    const game = state.fishingGame;
    const markers = [];
    for (const fraction of [0, 0.2, 0.5, 0.8, 0.99]) {
      const now = game.roundStartedAt + (game.roundEndsAt - game.roundStartedAt) * fraction;
      markers.push(gameApi.parkFishingCursor(game, now));
      state = advance(state, now, { random: () => { throw new Error("Active QTE must not resample difficulty"); } }).state;
      assert.equal(JSON.stringify(state.fishingGame), before);
    }
    for (let index = 1; index < markers.length; index += 1) {
      assert(game.direction === "forward" ? markers[index] > markers[index - 1] : markers[index] < markers[index - 1]);
    }
  }
});

check("both directions support wins, misses, and timeouts through the same runtime", () => {
  for (const roll of [0.31, 0.79]) {
    const random = () => roll;
    const expectedDirection = roll < 0.5 ? "forward" : "reverse";
    const started = qte(random);
    assert.equal(started.fishingGame.direction, expectedDirection);
    let state = started;
    for (let hit = 0; hit < 3; hit += 1) {
      assert.equal(state.fishingGame.direction, expectedDirection);
      const cursor = gameApi.parkFishingCursor(state.fishingGame, hitTime(state.fishingGame));
      assert(cursor > state.fishingGame.targetStart && cursor < state.fishingGame.targetEnd);
      state = reel(state, undefined, {}, random);
    }
    assert.equal(state.fishingGame.phase, "success");
    assert.equal(runtime.finishParkFishingGameOnExit(state, state.activityStartedAt).events.length, 1);
    for (const timeout of [false, true]) {
      state = qte(random);
      for (let miss = 0; miss < 2; miss += 1) {
        assert.equal(state.fishingGame.direction, expectedDirection);
        if (timeout) {
          const result = advance(state, state.fishingGame.roundEndsAt, { random });
          assert.equal(result.events.length, 0);
          state = result.state;
        } else state = reel(state, state.fishingGame.roundStartedAt, {}, random);
      }
      assert.equal(state.fishingGame.phase, "escaped");
      assert.equal(state.pendingFish, undefined);
      assert.equal(runtime.finishParkFishingGameOnExit(state, clock).events.length, 0);
    }
  }
});

check("random target edges remain hittable in either direction with a fractional clock", () => {
  for (const roll of [0, 0.17, 0.49, 0.51, 0.73, 1]) {
    for (const clockOffset of [0.375, 10_000_000.375]) {
      for (const edge of ["targetStart", "targetEnd"]) {
        const state = qte(() => roll);
        const game = {
          ...state.fishingGame,
          roundStartedAt: state.fishingGame.roundStartedAt + clockOffset,
          roundEndsAt: state.fishingGame.roundEndsAt + clockOffset,
          nextInputAt: state.fishingGame.nextInputAt + clockOffset,
        };
        const next = reel({ ...state, fishingGame: game }, cursorTime(game, game[edge]));
        assert.equal(next.fishingGame.hits, 1, `${game.direction} ${edge} at roll ${roll}, clock ${clockOffset}`);
        assert.equal(next.fishingGame.misses, 0);
        const outside = game[edge] + (edge === "targetStart" ? -1e-6 : 1e-6);
        const missed = reel({ ...state, fishingGame: game }, cursorTime(game, outside));
        assert.equal(missed.fishingGame.hits, 0);
        assert.equal(missed.fishingGame.misses, 1, "The edge tolerance must not widen the target by 1e-6");
      }
    }
  }
});

check("invalid injected random values cannot create impossible or nonfinite rounds", () => {
  for (const roll of [NaN, Infinity, -Infinity, -5, 5]) {
    const game = gameApi.startParkFishingRound(gameApi.createParkFishingInvite(1, 0), 100, () => roll);
    for (const value of [game.roundStartedAt, game.roundEndsAt, game.targetStart, game.targetEnd]) assert(Number.isFinite(value));
    assert(game.roundEndsAt - game.roundStartedAt >= 2200 && game.roundEndsAt - game.roundStartedAt <= 3400);
    assert(game.targetStart >= 0.2 - 1e-12 && game.targetEnd <= 0.8 + 1e-12);
    assert(["forward", "reverse"].includes(game.direction));
    assert(Number.isFinite(gameApi.parkFishingCursor(game, NaN)));
  }
});

// Exercise the actual App callbacks as well as the runtime. All persistence,
// window and audio boundaries below are synthetic; no React root or save opens.
const appSource = fs.readFileSync(path.join(root, "src/park/ParkApp.tsx"), "utf8");
const appAst = ts.createSourceFile("ParkApp.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const appCallback = (name, bindings) => {
  const found = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === name && node.initializer) found.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(appAst);
  assert.equal(found.length, 1, `Expected one production callback: ${name}`);
  const javascript = ts.transpileModule(`const operation = ${found[0].getText(appAst)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), `${javascript}\nreturn operation;`)(...Object.values(bindings));
};
const flushHarness = (state, { preview = false, record, flush } = {}) => {
  const catches = [];
  const bindings = {
    hostSlotId: "synthetic-fishing",
    simulationRef: { current: state },
    visitRef: { current: { visitId: "synthetic-visit" } },
    debugPreviewRef: { current: preview },
    saveRef: { current: null },
    setSave: () => {},
    setSaveError: () => {},
    isStoreClosing: () => true,
    performance: { now: () => clock },
    finishParkFishingGameOnExit: runtime.finishParkFishingGameOnExit,
    recordParkCatch: async (slot, fishId) => {
      catches.push({ slot, fishId });
      return record ? record() : {};
    },
    persistParkRuntime: () => {},
    flushParkSaveSlotResult: flush ?? (async () => ({ result: { ok: true, written: true }, save: null })),
  };
  return { bindings, catches, flush: appCallback("flushCurrentParkSave", bindings) };
};
const checkAsync = async (name, run) => {
  await run();
  checks += 1;
  console.log(`[park-fishing] PASS ${name}`);
};

await checkAsync("App close consumes a won fish before awaiting storage, including reentrant close", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const h = flushHarness(win(), { record: () => pending });
  const first = h.flush(true);
  assert.equal(h.catches.length, 1);
  assert.equal(h.bindings.simulationRef.current.pendingFish, undefined);
  const second = h.flush(true);
  assert.equal(h.catches.length, 1);
  release({});
  assert((await first).ok);
  assert((await second).ok);
  await h.flush(true);
  assert.equal(h.catches.length, 1);
});

await checkAsync("App close retries queued saving without emitting another catch", async () => {
  let canSave = false;
  const h = flushHarness(win(), {
    record: () => null,
    flush: async () => ({ result: { ok: canSave, written: canSave }, save: null }),
  });
  assert.equal((await h.flush(true)).ok, false);
  assert.equal(h.catches.length, 1);
  canSave = true;
  assert.equal((await h.flush(true)).ok, true);
  assert.equal(h.catches.length, 1);
});

await checkAsync("App close cancels unfinished participation and never rewards a preview", async () => {
  const h = flushHarness(qte());
  await h.flush(true);
  assert.equal(h.catches.length, 0);
  assert.equal(h.bindings.simulationRef.current.fishingGame, undefined);
  const preview = flushHarness(win(), { preview: true });
  await preview.flush(true);
  assert.equal(preview.catches.length, 0);
  assert.equal(preview.bindings.simulationRef.current.pendingFish, undefined);
});

check("App inputs use current state, reject background clicks, and play the winning reel once", () => {
  let state = qte();
  state = reel(reel(state));
  clock = hitTime(state.fishingGame);
  const sounds = [];
  let focused = false;
  const bindings = {
    simulationRef: { current: state },
    visitRef: { current: {} },
    debugPreviewRef: { current: false },
    isStoreClosing: () => false,
    document: { visibilityState: "visible", hasFocus: () => focused },
    performance: { now: () => clock },
    applyParkFishingInput: runtime.applyParkFishingInput,
    playParkFishingSound: (_bank, pose) => sounds.push(pose),
    fishingAudioBankRef: { current: {} },
    publishFishingOverlay: () => {},
  };
  const input = { type: "reel", id: state.fishingGame.id, round: state.fishingGame.round };
  const handle = appCallback("handleFishingInput", bindings);
  handle(input);
  assert.equal(bindings.simulationRef.current, state);
  focused = true;
  handle(input);
  handle(input);
  assert.equal(bindings.simulationRef.current.fishingGame.phase, "success");
  assert.deepEqual(sounds, ["reel"]);
});

console.log(`Park fishing smoke passed: ${checks} production-runtime/App checks; no user storage accessed.`);
