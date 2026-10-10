// Exercise the production icon component and styles with synthetic items only.
// The static page has no app runtime, localStorage, bridge, or user browser data.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "aivatar-inventory-layout-"));
const require = createRequire(join(root, "package.json"));
const loadedModules = new Map();
const loadComponentModule = (file) => {
  if (loadedModules.has(file)) return loadedModules.get(file).exports;
  assert(file.startsWith(join(root, "src", "components") + sep), "Only icon component modules may be loaded");
  const module = { exports: {} };
  loadedModules.set(file, module);
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const componentRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier);
    assert(specifier.startsWith("."), `Unexpected component dependency ${specifier}`);
    const base = resolve(dirname(file), specifier);
    const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
    assert(target, `Missing icon module ${specifier}`);
    return loadComponentModule(target);
  };
  new Function("require", "module", "exports", output)(componentRequire, module, module.exports);
  return module.exports;
};
const { InventoryItemIcon } = loadComponentModule(join(root, "src/components/InventoryItemIcon.tsx"));
assert.equal(typeof InventoryItemIcon, "function");
const items = [
  "raw-crucian-carp", "raw-bluegill", "raw-black-bass", "raw-yellow-perch",
  "raw-weather-loach", "raw-rainbow-trout", "pond-weed", "pond-weed-salad",
  "fishing-trophy-bronze", "fishing-trophy-silver", "fishing-trophy-gold", "fishing-trophy-crystal",
];
const app = await readFile(join(root, "src/App.tsx"), "utf8");
assert.match(app, /const ItemThumbnail[\s\S]*?if \(hasInventoryPixelIcon\(itemId\)\)\s*\{\s*return <InventoryItemIcon itemId=\{itemId\} \/>;/);
assert.match(app, /inventoryItems\.map\([\s\S]*?className=\{`pixel-button inventory-item-button/);

const themes = [
  ["starship", "theme-starship-console", "Starship · 背包"],
  ["classic", "theme-classic", "Classic"],
  ["terminal", "theme-terminal", "Terminal"],
  ["amber", "theme-terminal theme-terminal-amber", "Amber"],
  ["arcade", "theme-arcade-cabinet", "Arcade Cabinet"],
];
const defaultIcon = (id) => `<span class="item-button-thumbnail item-thumb-${id}" aria-hidden="true"><span class="item-thumb-steam steam-left"></span><span class="item-thumb-steam steam-right"></span><span class="item-thumb-shape"></span><span class="item-thumb-accent"></span><span class="item-thumb-detail"></span></span>`;
const cards = [
  ...["coffee", "cola"].map((id) => ({ id, icon: defaultIcon(id), baseline: true })),
  ...items.map((id) => ({ id, icon: renderToStaticMarkup(React.createElement(InventoryItemIcon, { itemId: id })) })),
];
const panels = themes.map(([theme, classes, title]) => `
  <section class="app-shell inventory-fixture ${classes}" data-theme="${theme}" lang="zh-Hans">
    <div class="section-heading"><h2>${title}</h2><span>85879 bits</span></div>
    <div class="button-grid">${cards.map(({ id, icon, baseline }, index) => `
      <button type="button" class="pixel-button${baseline ? "" : " inventory-item-button"}" data-item="${id}"${baseline ? ' data-baseline="true"' : ""} aria-label="${id}">
        <span class="item-button-content">${icon}<span data-count>x${[1, 10, 0, 99999][index % 4]}</span></span>
      </button>`).join("")}
    </div>
    <p class="fixture-note">首行：默认图标对照 · 后六行：12 款简化图标</p>
  </section>`).join("");
const css = (await Promise.all(["src/styles.css", "src/park/park.css"].map(async (file) =>
  (await readFile(join(root, file), "utf8")).replace(/url\((["']?)\/([^"')]+)\1\)/g, (_match, _quote, asset) => {
    const [assetPath] = asset.split("?");
    return `url("${pathToFileURL(join(root, "public", decodeURIComponent(assetPath))).href}")`;
  })))).join("\n");
const html = join(directory, "inventory.html");
const screenshot = join(directory, "inventory-themes.png");
await writeFile(html, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>
body{margin:0;padding:18px;background:#11151c;overflow:visible;min-height:0}
.fixture-title{font:18px sans-serif;color:#edf1eb;margin:0 0 16px}
.fixture-grid{display:grid;grid-template-columns:repeat(3,300px);gap:18px;align-items:start}
.app-shell.inventory-fixture{display:block;width:300px;min-width:0;height:auto;min-height:0;margin:0;padding:12px;overflow:visible}
.inventory-fixture .section-heading{margin:0 0 10px}.inventory-fixture h2{font-size:17px}
.fixture-note{font:10px sans-serif;color:#a2acb9;margin:12px 0 0;line-height:1.5}
</style></head><body><h1 class="fixture-title">Inventory icons · default card size · actual component and theme styles</h1>
<main class="fixture-grid">${panels}</main><pre id="result" hidden></pre><script>
(async () => {
  await document.fonts.ready;
  const errors=[];const results=[];const close=(a,b)=>Math.abs(a-b)<0.05;
  const check=(condition,message)=>{if(!condition)errors.push(message)};
  for(const panel of document.querySelectorAll('[data-theme]')){
    const theme=panel.dataset.theme;const buttons=[...panel.querySelectorAll('.button-grid > button')];
    const baseline=buttons[0].getBoundingClientRect();
    check(buttons.length===14,theme+': expected 12 icons and 2 default controls');
    check(close(baseline.height,27),theme+': default card must remain 27px');
    for(const [index,button] of buttons.entries()){
      const id=button.dataset.item;const rect=button.getBoundingClientRect();
      const frame=button.querySelector('.item-button-thumbnail');const frameRect=frame?.getBoundingClientRect();
      check(close(rect.height,27)&&close(rect.height,baseline.height),theme+'/'+id+': card must match default 27px height');
      check(close(rect.width,baseline.width),theme+'/'+id+': two columns must remain equal width');
      check(frameRect&&close(frameRect.width,18)&&close(frameRect.height,18),theme+'/'+id+': thumbnail frame must be 18x18');
      if(frameRect){
        check(frameRect.left>=rect.left&&frameRect.right<=rect.right&&frameRect.top>=rect.top&&frameRect.bottom<=rect.bottom,theme+'/'+id+': thumbnail must fit inside card');
        const count=button.querySelector('[data-count]').getBoundingClientRect();
        check(frameRect.right<=count.left&&count.right<=rect.right,theme+'/'+id+': quantity must not overlap icon or overflow');
      }
      if(!button.dataset.baseline){
        const svg=frame?.querySelector('svg');const svgRect=svg?.getBoundingClientRect();
        check(svgRect&&close(svgRect.width,16)&&close(svgRect.height,16),theme+'/'+id+': icon must be 16x16');
        check(svg?.getAttribute('viewBox')==='0 0 16 16',theme+'/'+id+': logical pixel grid must be 16x16');
        if(svgRect&&frameRect)check(svgRect.left>=frameRect.left&&svgRect.right<=frameRect.right&&svgRect.top>=frameRect.top&&svgRect.bottom<=frameRect.bottom,theme+'/'+id+': SVG must not overflow thumbnail');
        for(const pixel of svg?.querySelectorAll('rect')??[]){
          const x=Number(pixel.getAttribute('x'));const y=Number(pixel.getAttribute('y'));
          const width=Number(pixel.getAttribute('width'));const height=Number(pixel.getAttribute('height'));
          check([x,y,width,height].every(Number.isInteger)&&x>=0&&y>=0&&width>0&&height>0&&x+width<=16&&y+height<=16,theme+'/'+id+': pixels must align and stay within logical grid');
        }
      }
      if(index%2===1)check(close(rect.top,buttons[index-1].getBoundingClientRect().top),theme+': each pair must share a row');
      if(index>=2)check(close(rect.top-buttons[index-2].getBoundingClientRect().bottom,5),theme+': rows must retain default 5px gap');
    }
    results.push({theme,cards:buttons.length,width:baseline.width,height:baseline.height});
  }
  document.querySelector('#result').textContent=JSON.stringify({ok:errors.length===0,errors,themes:results});
  document.body.dataset.ready='true';
})();</script></body></html>`);
const executable = [process.env.AIVATAR_SMOKE_BROWSER, process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome"].find((value) => value && existsSync(value));
assert(executable, "Chrome or Edge is required for the inventory layout smoke");
const { stdout } = await promisify(execFile)(executable, ["--headless=new", "--disable-gpu",
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions",
  "--disable-sync", "--hide-scrollbars", "--window-size=980,710", "--force-device-scale-factor=2",
  `--user-data-dir=${join(directory, "browser-profile")}`, `--screenshot=${screenshot}`,
  "--virtual-time-budget=5000", "--dump-dom", pathToFileURL(html).href],
{ timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
assert(stdout.includes('data-ready="true"'), "The browser must finish font loading and measure every theme");
const serialized = stdout.match(/<pre id="result" hidden="">([^<]+)<\/pre>/)?.[1];
assert(serialized, "The browser must return layout measurements");
const results = JSON.parse(serialized.replaceAll("&amp;", "&").replaceAll("&quot;", '"'));
assert.deepEqual(results.errors, [], `Inventory layout failures: ${JSON.stringify(results.errors)}`);
assert.equal(results.themes.length, themes.length);
assert((await readFile(screenshot)).length > 10000, "The screenshot must contain the rendered theme matrix");
console.log(JSON.stringify({ ...results, screenshot, directory }, null, 2));
