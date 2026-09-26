import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Execute the real TSX component and runtime in a minimal, deterministic hook
// host. Effects/native APIs/animation remain disabled: no DOM, app, real save,
// or agent session is opened. Browser layout is covered by separate visual QA.
const root = fileURLToPath(new URL("../", import.meta.url));
const modules = new Map();
let activeHost;
const cell = (kind, initial) => {
  assert(activeHost, "Hooks require the synthetic component host");
  const index = activeHost.cursor++;
  if (!activeHost.slots[index]) activeHost.slots[index] = { kind, value: initial() };
  assert.equal(activeHost.slots[index].kind, kind, "Component hook order remains stable");
  return activeHost.slots[index];
};
const hooks = {
  useRef: (initial) => cell("ref", () => ({ current: initial })).value,
  useState: (initial) => {
    const entry = cell("state", () => typeof initial === "function" ? initial() : initial);
    const owner = activeHost;
    return [entry.value, (next) => {
      const value = typeof next === "function" ? next(entry.value) : next;
      if (!Object.is(entry.value, value)) owner.renderRequested = true;
      entry.value = value;
    }];
  },
  useLayoutEffect: () => { cell("effect", () => null); },
};
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const external = {
  react: hooks,
  "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
  "@tauri-apps/api/core": { isTauri: () => false, invoke: () => { throw new Error("Native IPC is forbidden in this fixture"); } },
  "src/i18n.ts": { t: (_locale, key) => key },
  "src/persistence/saveStore.ts": { isStoreClosing: () => activeHost.closing },
  "src/game/simulation.ts": { deriveBehaviorFromCodex: (status) => ({
    thinking: "thinking", executing: "coding", waiting_for_user: "waiting", error: "error",
  }[status.status] ?? null) },
  "src/game/renderScene.ts": { renderDesktopScene: () => { throw new Error("Animation is disabled in this fixture"); } },
  "src/desktop/desktopAnimation.ts": { startDesktopAnimation: () => { throw new Error("Animation is disabled in this fixture"); } },
};
const load = (relative) => {
  if (relative in external) return external[relative];
  if (relative.endsWith(".css")) return {};
  if (modules.has(relative)) return modules.get(relative).exports;
  assert(relative.startsWith("src/desktop/") && !relative.includes(".."), `Unexpected module: ${relative}`);
  const module = { exports: {} };
  modules.set(relative, module);
  const text = readFileSync(path.join(root, relative), "utf8");
  const code = ts.transpileModule(text, { fileName: relative, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function("require", "module", "exports", code)((specifier) => {
    if (specifier in external) return external[specifier];
    assert(specifier.startsWith("."), `Unexpected dependency: ${specifier}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
    return load(/\.(?:tsx?|css)$/.test(resolved) ? resolved : `${resolved}.ts`);
  }, module, module.exports);
  return module.exports;
};
const runtime = load("src/desktop/desktopRuntime.ts");
const { DesktopCompanion } = load("src/desktop/DesktopCompanion.tsx");
const viewport = { width: 1440, height: 900, scaleFactor: 2, monitorId: "synthetic-menu-display" };
const normalized = runtime.normalizeDesktopLayout(null, viewport);
const placed = runtime.placeDesktopVendingMachine(runtime.createDesktopRuntime(normalized), viewport, 0, { x: 800, y: 450 });
assert.equal(placed.ok, true);
const initialLayout = runtime.desktopLayoutFromRuntime(placed.runtime, viewport);
const flatten = (tree) => {
  if (Array.isArray(tree)) return tree.flatMap(flatten);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...flatten(tree.props?.children)];
};
const makeHost = () => {
  const pointerCapture = new Set();
  const host = { slots: [], cursor: 0, closing: false, layouts: [], sounds: [], purchases: [],
    element: {
      style: {}, focus() {},
      setPointerCapture: (id) => pointerCapture.add(id),
      hasPointerCapture: (id) => pointerCapture.has(id),
      releasePointerCapture: (id) => pointerCapture.delete(id),
    },
  };
  host.props = {
    content: { placedItems: [] }, status: { status: "idle" }, appearanceId: "octopus", viewport,
    initialLayout: structuredClone(initialLayout), locale: "en", walletBits: 100,
    vendingProducts: [{ id: "cookie", name: "Cookie", price: 6, available: true },
      { id: "cola", name: "Cola", price: 10, available: true },
      { id: "coffee", name: "Coffee", price: 8, available: true }],
    onLayoutChange: (layout) => host.layouts.push(structuredClone(layout)),
    onReturn: async () => {},
    onPurchaseAndConsume: (request) => { host.purchases.push(request); return { accepted: true }; },
    onVendingSound: (cue) => host.sounds.push(cue),
  };
  host.render = () => {
    activeHost = host;
    host.cursor = 0;
    host.renderRequested = false;
    host.tree = DesktopCompanion(host.props);
    return host.tree;
  };
  host.nodes = () => flatten(host.tree);
  host.canvas = () => host.nodes().find((node) => node.type === "canvas");
  host.menu = () => host.nodes().find((node) => node.props.role === "menu");
  host.runtime = () => host.slots.find((entry) => entry.kind === "ref"
    && entry.value.current?.avatar && "vendingInteraction" in entry.value.current)?.value.current;
  host.event = (type, options = {}) => ({
    type, button: 0, pointerId: 1, clientX: 800, clientY: 380,
    currentTarget: host.element, preventDefault() {}, ...options,
  });
  host.render();
  return host;
};

const host = makeHost();
const beforeClick = structuredClone(host.runtime().vendingMachine);
host.canvas().props.onPointerDown(host.event("pointerdown"));
host.canvas().props.onPointerUp(host.event("pointerup"));
host.render();
assert.equal(host.menu(), undefined, "A left click on the vending machine must not open its menu");
assert.deepEqual(host.runtime().vendingMachine, beforeClick, "A click leaves the vending position unchanged");
assert.equal(host.purchases.length, 0);

host.canvas().props.onPointerDown(host.event("pointerdown"));
host.canvas().props.onPointerMove(host.event("pointermove", { clientX: 860, clientY: 400 }));
host.canvas().props.onPointerUp(host.event("pointerup", { clientX: 860, clientY: 400 }));
host.render();
assert.equal(host.menu(), undefined, "Finishing a left-button drag must not open a menu");
assert.notDeepEqual(host.runtime().vendingMachine, beforeClick, "Left dragging still moves the machine");

const machinePoint = () => ({ clientX: host.runtime().vendingMachine.x, clientY: host.runtime().vendingMachine.y - 70 });
const openMenu = () => {
  host.canvas().props.onContextMenu(host.event("contextmenu", { ...machinePoint(), button: 2 }));
  host.render();
  assert(host.menu(), "Right click opens the vending menu");
  assert.equal(host.nodes().filter((node) => node.props["data-vending-product"]).length, 3,
    "The right-click menu retains all three product choices");
};
openMenu();

// Skin button assertions are connected to the component's rendered controls,
// not copies of its handlers or source-text matching.
const skinButtons = () => host.nodes().filter((node) => node.props["data-vending-skin"]);
assert.equal(skinButtons().length, 3, "Original, red, and dark-green skins are selectable");
for (const skin of ["red", "dark-green", "original"]) {
  if (!host.menu()) openMenu();
  const button = skinButtons().find((node) => node.props["data-vending-skin"] === skin);
  assert(button, `Missing skin control: ${skin}`);
  if (skin === "dark-green") host.runtime().vendingInteraction = {
    requestId: "synthetic-pending-order", productId: "coffee", phase: "awaitingPurchase",
    phaseStartedAt: 1000, purchaseRequested: true,
  };
  const before = structuredClone(host.runtime());
  const checkpoints = host.layouts.length;
  const sounds = host.sounds.length;
  button.props.onClick();
  assert.equal(host.renderRequested, true, "A changed color requests a React render for its selected control");
  host.render();
  assert.equal(host.runtime().vendingMachineSkinId, skin);
  assert.deepEqual(host.runtime(), { ...before, vendingMachineSkinId: skin }, "Switching color changes only its skin");
  assert.equal(host.layouts.length, checkpoints + 1, "A skin choice checkpoints the desktop layout");
  assert.equal(host.layouts.at(-1).vendingMachineSkinId ?? "original", skin);
  assert.equal(host.purchases.length, 0, "Choosing a color cannot issue a purchase");
  assert.equal(host.sounds.length, sounds, "Choosing a color cannot play purchase/consumption effects");
  assert(host.menu(), "Color selection keeps the menu open");
  assert.deepEqual(skinButtons().filter((node) => node.props["aria-checked"])
    .map((node) => node.props["data-vending-skin"]), [skin], "Only the current color is checked");
}

const originalButton = skinButtons().find((node) => node.props["data-vending-skin"] === "original");
const noOpCheckpoints = host.layouts.length;
originalButton.props.onClick();
assert.equal(host.layouts.length, noOpCheckpoints, "Selecting the same color avoids redundant persistence");
assert.equal(host.renderRequested, false);
host.closing = true;
const beforeClosing = structuredClone(host.runtime());
skinButtons().find((node) => node.props["data-vending-skin"] === "red").props.onClick();
assert.deepEqual(host.runtime(), beforeClosing, "The save-close barrier blocks late appearance mutations");
assert.equal(host.layouts.length, noOpCheckpoints);
assert.equal(host.purchases.length, 0);

console.log("Desktop vending menu smoke passed: left click/drag never open menus, right click exposes products and colors, and skin changes only checkpoint appearance without purchasing.");
