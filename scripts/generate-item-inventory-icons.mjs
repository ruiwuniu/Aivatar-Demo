import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const WIDTH = 16;
const HEIGHT = 16;
const OUTPUT_DIR = resolve("public/icons");

const rgba = (hex) => {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
    0xff,
  ];
};

const createCanvas = () => new Uint8Array(WIDTH * HEIGHT * 4);

const setPixel = (pixels, x, y, color) => {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 4;
  pixels.set(color, offset);
};

const fillRect = (pixels, x, y, width, height, color) => {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(pixels, column, row, color);
    }
  }
};

const drawLine = (pixels, startX, startY, endX, endY, color) => {
  let x = startX;
  let y = startY;
  const deltaX = Math.abs(endX - startX);
  const stepX = startX < endX ? 1 : -1;
  const deltaY = -Math.abs(endY - startY);
  const stepY = startY < endY ? 1 : -1;
  let error = deltaX + deltaY;

  while (true) {
    setPixel(pixels, x, y, color);
    if (x === endX && y === endY) break;
    const doubled = error * 2;
    if (doubled >= deltaY) {
      error += deltaY;
      x += stepX;
    }
    if (doubled <= deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
};

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
};

const encodePng = (pixels) => {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 6;

  const scanlines = Buffer.alloc(HEIGHT * (WIDTH * 4 + 1));
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowOffset = y * (WIDTH * 4 + 1);
    scanlines[rowOffset] = 0;
    Buffer.from(
      pixels.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4),
    ).copy(scanlines, rowOffset + 1);
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const ovenIcon = () => {
  const pixels = createCanvas();
  const ink = rgba("#171b1c");
  const shadow = rgba("#353b39");
  const body = rgba("#858c7d");
  const light = rgba("#c2c6b2");
  const brassDark = rgba("#8b571e");
  const brass = rgba("#d7a13b");
  const amberDark = rgba("#6f2e10");
  const amber = rgba("#d46b16");
  const amberLight = rgba("#ffb238");

  fillRect(pixels, 3, 1, 10, 1, ink);
  fillRect(pixels, 2, 2, 12, 12, ink);
  fillRect(pixels, 3, 3, 10, 10, body);
  fillRect(pixels, 4, 3, 8, 1, light);
  fillRect(pixels, 12, 4, 1, 8, shadow);

  for (const [x, y] of [[4, 4], [9, 4], [4, 6], [9, 6]]) {
    fillRect(pixels, x, y, 2, 1, shadow);
    setPixel(pixels, x + 1, y, ink);
  }
  fillRect(pixels, 3, 7, 10, 1, ink);
  for (const x of [4, 6, 9, 11]) {
    setPixel(pixels, x, 8, brassDark);
    setPixel(pixels, x, 9, brass);
  }
  fillRect(pixels, 4, 10, 8, 3, ink);
  fillRect(pixels, 5, 11, 6, 1, amber);
  setPixel(pixels, 6, 11, amberLight);
  fillRect(pixels, 5, 12, 6, 1, amberDark);
  fillRect(pixels, 4, 14, 2, 1, ink);
  fillRect(pixels, 10, 14, 2, 1, ink);
  return pixels;
};

const fishingRodIcon = () => {
  const pixels = createCanvas();
  const ink = rgba("#24160f");
  const handle = rgba("#5d3826");
  const woodDark = rgba("#955323");
  const wood = rgba("#d28a3f");
  const woodLight = rgba("#f0b65f");
  const line = rgba("#b8c3bd");
  const red = rgba("#d74a38");
  const cream = rgba("#f7e4b3");

  drawLine(pixels, 2, 14, 12, 2, ink);
  drawLine(pixels, 3, 14, 13, 2, ink);
  drawLine(pixels, 3, 13, 12, 2, woodDark);
  drawLine(pixels, 4, 12, 12, 3, wood);
  drawLine(pixels, 5, 11, 11, 4, woodLight);
  fillRect(pixels, 1, 13, 3, 2, ink);
  fillRect(pixels, 2, 12, 2, 3, handle);

  for (const [x, y] of [
    [13, 3], [14, 4], [14, 5], [14, 6], [14, 7],
    [13, 8], [12, 9], [12, 10], [13, 11],
  ]) {
    setPixel(pixels, x, y, line);
  }

  setPixel(pixels, 12, 11, ink);
  setPixel(pixels, 11, 12, ink);
  setPixel(pixels, 12, 12, red);
  setPixel(pixels, 13, 12, ink);
  setPixel(pixels, 11, 13, red);
  setPixel(pixels, 12, 13, cream);
  setPixel(pixels, 13, 13, red);
  setPixel(pixels, 11, 14, ink);
  setPixel(pixels, 12, 14, cream);
  setPixel(pixels, 13, 14, ink);
  return pixels;
};

const cookedFishIcon = () => {
  const pixels = createCanvas();
  const ink = rgba("#3a1d0f");
  const caramelDark = rgba("#8a3e12");
  const caramel = rgba("#c86617");
  const gold = rgba("#e99725");
  const goldLight = rgba("#ffc451");
  const cream = rgba("#fff0b7");
  const steam = rgba("#f1e2bc");

  fillRect(pixels, 5, 1, 1, 2, steam);
  setPixel(pixels, 4, 3, steam);
  fillRect(pixels, 8, 2, 1, 2, steam);
  setPixel(pixels, 9, 1, steam);

  fillRect(pixels, 4, 5, 7, 1, ink);
  fillRect(pixels, 2, 6, 10, 1, ink);
  fillRect(pixels, 1, 7, 12, 3, ink);
  fillRect(pixels, 2, 10, 10, 1, ink);
  fillRect(pixels, 4, 11, 7, 1, ink);

  fillRect(pixels, 4, 6, 7, 1, caramel);
  fillRect(pixels, 3, 7, 8, 3, gold);
  fillRect(pixels, 4, 10, 7, 1, caramel);
  setPixel(pixels, 2, 8, caramel);
  setPixel(pixels, 3, 7, goldLight);
  setPixel(pixels, 4, 8, goldLight);
  setPixel(pixels, 5, 6, goldLight);
  setPixel(pixels, 3, 7, cream);
  setPixel(pixels, 3, 8, ink);

  drawLine(pixels, 6, 7, 8, 9, caramelDark);
  drawLine(pixels, 8, 7, 10, 9, caramelDark);
  setPixel(pixels, 6, 10, caramelDark);
  setPixel(pixels, 7, 10, caramelDark);

  setPixel(pixels, 12, 7, caramelDark);
  setPixel(pixels, 13, 6, ink);
  setPixel(pixels, 14, 5, ink);
  setPixel(pixels, 15, 5, ink);
  fillRect(pixels, 13, 7, 3, 3, caramel);
  setPixel(pixels, 14, 6, caramel);
  setPixel(pixels, 15, 6, ink);
  setPixel(pixels, 15, 7, ink);
  setPixel(pixels, 15, 8, ink);
  setPixel(pixels, 15, 9, ink);
  setPixel(pixels, 15, 10, ink);
  setPixel(pixels, 14, 10, caramel);
  setPixel(pixels, 13, 10, ink);
  setPixel(pixels, 14, 11, ink);
  setPixel(pixels, 15, 11, ink);
  return pixels;
};

const icons = [
  ["item-gas-oven-range.png", ovenIcon()],
  ["item-fishing-rod.png", fishingRodIcon()],
  ["item-cooked-fish.png", cookedFishIcon()],
];

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [filename, pixels] of icons) {
  const outputPath = resolve(OUTPUT_DIR, filename);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, encodePng(pixels));
  console.log(outputPath);
}
