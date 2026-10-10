// Render all three real PNGs through the production animation code in a fresh,
// headless browser profile. No app saves, agent bridge, or user profile is read.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "aivatar-macintosh-visual-"));
const source = await readFile(join(root, "src/game/macintoshTerminal.ts"), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
}).outputText;
const assetNames = ["terminal-macintosh.png", "terminal-macintosh-forest-orange.png", "terminal-macintosh-orange-green.png"];
const assets = await Promise.all(assetNames.map(async (file) =>
  `data:image/png;base64,${(await readFile(join(root, "public/assets/furniture", file))).toString("base64")}`));
const html = join(directory, "preview.html");
const screenshot = join(directory, "macintosh-palettes.png");
await writeFile(html, `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#151d20;color:#e8ebe5;font:16px monospace}h1{margin:18px 24px;font-size:18px}canvas{display:block;margin:0 20px}
</style></head><body><h1>Macintosh terminal · classic / forest green / orange</h1>
<canvas width="960" height="606"></canvas><script type="module">
import {drawMacintoshTerminal, MACINTOSH_TERMINAL_SKIN_ID, MACINTOSH_FOREST_ORANGE_SKIN_ID, MACINTOSH_ORANGE_GREEN_SKIN_ID} from ${JSON.stringify(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)};
const images = await Promise.all(${JSON.stringify(assets)}.map(src => new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;})));
const ctx=document.querySelector('canvas').getContext('2d');
const phases=['idle','thinking','executing','waiting_for_user','complete','error'];
const skins=[MACINTOSH_TERMINAL_SKIN_ID,MACINTOSH_FOREST_ORANGE_SKIN_ID,MACINTOSH_ORANGE_GREEN_SKIN_ID];
for(let row=0;row<skins.length;row++)for(let col=0;col<6;col++){
 const left=col*160,top=row*202;
 for(let y=0;y<174;y+=10)for(let x=0;x<150;x+=10){ctx.fillStyle=(x/10+y/10)%2?'#273237':'#233035';ctx.fillRect(left+x,top+y,10,10);}
 ctx.save();ctx.translate(left+75,top+102);ctx.scale(2.65,2.65);
 drawMacintoshTerminal(ctx,{x:0,y:0,frame:24,phase:phases[col],active:true,skinId:skins[row],image:images[row]});ctx.restore();
 ctx.fillStyle='#d7e7df';ctx.font='12px monospace';ctx.fillText(phases[col],left+5,top+191);
}
document.body.dataset.ready='true';
</script></body></html>`);
const executable = [process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome"].find((value) => value && existsSync(value));
assert(executable, "Chrome/Edge is required to render the visual fixture");
const { stdout } = await promisify(execFile)(executable, ["--headless=new", "--disable-gpu",
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=1000,680",
  `--user-data-dir=${join(directory, "browser-profile")}`, `--screenshot=${screenshot}`,
  "--virtual-time-budget=3000", "--dump-dom", pathToFileURL(html).href],
{ timeout: 25000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
assert(stdout.includes('data-ready="true"'), "All real images must decode and render before screenshot");
assert((await readFile(screenshot)).length > 10000, "The visual evidence must contain a rendered sheet");
console.log(JSON.stringify({ ok: true, screenshot, phases: 6, palettes: assetNames.length, directory }, null, 2));
