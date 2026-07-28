import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import process from "node:process";
import WebSocket from "ws";

const repoRoot = process.cwd();
const COOKIE_PRICE = 6;
const START_BITS = 200;
const RAPID_CLICK_COUNT = 30;
const RAPID_CLICK_INTERVAL_MS = 30;
const EXPECTED_RAPID_PURCHASES = 2;
const LONG_PRESS_MS = 650;
const smokeSlotId = `shop-ui-smoke-${Date.now()}`;
const smokeAvatarId = "avatar-shop-ui-smoke";
const smokeRoomId = "room-shop-ui-smoke";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

const waitFor = async (fn, timeoutMs, label) => {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
};

const findBrowserExecutable = () => {
  const configured = process.env.AIVATAR_SMOKE_BROWSER;
  const candidates = [
    configured,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
};

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (payload) => {
      const message = JSON.parse(String(payload));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  async send(method, params = {}) {
    await this.opened;
    const id = this.nextId;
    this.nextId += 1;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  close() {
    this.socket.close();
  }
}

const evaluate = async (client, expression) => {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const detail =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.exception?.value ??
      result.exceptionDetails.text ??
      "Runtime evaluation failed";
    throw new Error(String(detail));
  }
  return result.result?.value;
};

const startVite = async () => {
  const port = await getFreePort();
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(
    process.execPath,
    [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--clearScreen", "false"],
    {
      cwd: repoRoot,
      env: { ...process.env, BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    return response.ok;
  }, 30_000, "Vite startup");

  return { child, port, logs };
};

const startBrowser = async (url) => {
  const executable = findBrowserExecutable();
  if (!executable) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "No Chrome or Edge executable found for DOM-level shop UI smoke.",
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  const debugPort = await getFreePort();
  const profileDir = path.join(os.tmpdir(), "aivatar-shop-ui-smoke-profile");
  fs.mkdirSync(profileDir, { recursive: true });

  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--headless=new",
      "--window-size=900,700",
      url,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );

  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  }, 30_000, "Browser DevTools target");

  return { child, target };
};

const clickSelector = (selector) =>
  `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`;

const readSaveExpression = `(() => {
  const slotId = localStorage.getItem("aivatar.activeSaveSlot.v1");
  const key = slotId ? \`aivatar.saveSlot.v1.\${slotId}\` : "aivatar.save.v1";
  const raw = localStorage.getItem(key) ?? localStorage.getItem("aivatar.save.v1");
  const save = raw ? JSON.parse(raw) : null;
  return {
    key,
    bits: save?.wallet?.bits ?? null,
    cookieQuantity: save?.inventory?.find((entry) => entry.itemId === "cookie")?.quantity ?? 0,
  };
})()`;

const debugPageExpression = `(() => ({
  href: location.href,
  title: document.title,
  bodyClass: document.body.className,
  saveOverlay: Boolean(document.querySelector('.save-slot-overlay')),
  emptySlots: document.querySelectorAll('.save-slot-card.empty').length,
  createButton: Boolean(document.querySelector('.save-create-button')),
  shopTabs: document.querySelectorAll('.shop-category-tab').length,
  shopButtons: document.querySelectorAll('button.shop-button').length,
  errorBoundary: Boolean(document.querySelector('.app-error-boundary')),
  localStorageKeys: Object.keys(localStorage).sort(),
  bodyText: document.body.innerText.slice(0, 1000),
}))()`;

const cookieButtonExpression = `(() => [...document.querySelectorAll('button.shop-button')]
  .find((button) => /Cookie|曲奇/.test(button.title || button.textContent || '')))()`;

const waitForRoomUi = async (client, label) => {
  try {
    await waitFor(
      () => evaluate(client, "!document.querySelector('.save-slot-overlay') && Boolean(document.querySelectorAll('.shop-category-tab')[3])"),
      15_000,
      label,
    );
  } catch (error) {
    const debug = await evaluate(client, debugPageExpression);
    throw new Error(`${error.message}\n${JSON.stringify(debug, null, 2)}`);
  }
};

let vite = null;
let browser = null;
let client = null;

try {
  vite = await startVite();
  const appUrl = `http://127.0.0.1:${vite.port}/?shop-ui-smoke=${Date.now()}`;
  browser = await startBrowser(appUrl);
  client = new CdpClient(browser.target.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      if (!location.origin.startsWith("http://127.0.0.1:${vite.port}")) return;
      const now = new Date().toISOString();
      const slotId = ${JSON.stringify(smokeSlotId)};
      const avatarId = ${JSON.stringify(smokeAvatarId)};
      const roomId = ${JSON.stringify(smokeRoomId)};
      const save = {
        avatarId,
        roomId,
        avatarName: "Shop UI Smoke",
        avatarAppearanceId: "octopus",
        wallet: { bits: ${START_BITS} },
        inventory: [],
        placedItems: [],
        purchasedItemIds: [],
        petStats: { energy: 80, mood: 80, hunger: 80 }
      };
      const slot = {
        id: slotId,
        slotIndex: 0,
        avatarId,
        roomId,
        avatarName: "Shop UI Smoke",
        avatarAppearanceId: "octopus",
        createdAt: now,
        updatedAt: now
      };
      localStorage.clear();
      localStorage.setItem("aivatar.activeSaveSlot.v1", slotId);
      localStorage.setItem("aivatar.saveSlots.v1", JSON.stringify([slot]));
      localStorage.setItem(\`aivatar.saveSlot.v1.\${slotId}\`, JSON.stringify(save));
    })()`,
  });
  await client.send("Page.navigate", { url: appUrl });

  await waitFor(
    () => evaluate(client, "document.readyState === 'complete' || document.readyState === 'interactive'"),
    30_000,
    "App document readiness",
  );
  await waitFor(
    () => evaluate(client, "Boolean(document.querySelector('.save-slot-enter-button'))"),
    30_000,
    "Save slot enter button",
  );
  await evaluate(client, clickSelector(".save-slot-enter-button"));
  await waitFor(
    () => evaluate(client, "!document.querySelector('.save-slot-overlay') && Boolean(document.querySelector('.shop-category-tab'))"),
    15_000,
    "Room UI after entering smoke save",
  );
  await waitForRoomUi(client, "Room UI after smoke save setup");

  await evaluate(client, `(() => {
    const tabs = [...document.querySelectorAll('.shop-category-tab')];
    tabs[3]?.click();
    return tabs.length;
  })()`);
  try {
    await waitFor(
      () => evaluate(client, `Boolean(${cookieButtonExpression})`) ,
      10_000,
      "Cookie shop button",
    );
  } catch (error) {
    const debug = await evaluate(
      client,
      `(() => [...document.querySelectorAll('button.shop-button')].map((button) => ({
        title: button.title,
        text: button.textContent,
        disabled: button.disabled,
      })))()`,
    );
    throw new Error(`${error.message}\n${JSON.stringify(debug, null, 2)}`);
  }

  const before = await evaluate(client, readSaveExpression);
  const rapidResult = await evaluate(client, `(async () => {
    const button = ${cookieButtonExpression};
    if (!button) return { found: false };
    for (let index = 0; index < ${RAPID_CLICK_COUNT}; index += 1) {
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      await new Promise((resolve) => setTimeout(resolve, ${RAPID_CLICK_INTERVAL_MS}));
    }
    return { found: true };
  })()`);
  if (!rapidResult?.found) throw new Error("Cookie button disappeared during rapid-click smoke.");
  await delay(700);
  const afterRapid = await evaluate(client, readSaveExpression);
  const rapidSpend = before.bits - afterRapid.bits;
  const expectedRapidSpend = COOKIE_PRICE * EXPECTED_RAPID_PURCHASES;
  if (rapidSpend !== expectedRapidSpend) {
    throw new Error(`Rapid click smoke expected ${EXPECTED_RAPID_PURCHASES} Cookie purchases (${expectedRapidSpend} bits), spent ${rapidSpend}.`);
  }

  const longPressResult = await evaluate(client, `(async () => {
    const button = ${cookieButtonExpression};
    if (!button) return { found: false };
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 2, pointerType: 'mouse', isPrimary: true }));
    await new Promise((resolve) => setTimeout(resolve, ${LONG_PRESS_MS}));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, pointerId: 2, pointerType: 'mouse', isPrimary: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    return { found: true };
  })()`);
  if (!longPressResult?.found) throw new Error("Cookie button disappeared during long-press smoke.");
  await delay(1000);
  const afterLongPress = await evaluate(client, readSaveExpression);
  const longPressSpend = afterRapid.bits - afterLongPress.bits;
  if (longPressSpend !== COOKIE_PRICE * 10) {
    throw new Error(`Long press smoke expected ten Cookie purchases (${COOKIE_PRICE * 10} bits), spent ${longPressSpend}.`);
  }

  const responsive = await evaluate(client, "document.body.dataset.aivatarShopUiSmoke = 'responsive'; document.body.dataset.aivatarShopUiSmoke");
  console.log(
    JSON.stringify(
      {
        ok: true,
        browser: path.basename(findBrowserExecutable()),
        vitePort: vite.port,
        rapidClickCount: RAPID_CLICK_COUNT,
        rapidClickIntervalMs: RAPID_CLICK_INTERVAL_MS,
        rapidSpend,
        longPressSpend,
        before,
        afterRapid,
        afterLongPress,
        responsive,
      },
      null,
      2,
    ),
  );
} finally {
  client?.close();
  if (browser?.child && !browser.child.killed) {
    browser.child.kill();
  }
  if (vite?.child && !vite.child.killed) {
    vite.child.kill();
  }
}
