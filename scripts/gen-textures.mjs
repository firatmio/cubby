// Projeye ait 16x16 piksel dokuları üretir (Mojang dosyası kullanılmaz).
// Çalıştırma: bun scripts/gen-textures.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "textures");
const SIZE = 16;

/** Deterministik PRNG: her çalıştırmada aynı doku. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Ağırlıklı paletten seçim: [[renk, ağırlık], ...] */
function picker(palette, rand) {
  const total = palette.reduce((s, [, w]) => s + w, 0);
  return () => {
    let r = rand() * total;
    for (const [c, w] of palette) {
      if ((r -= w) < 0) return hex(c);
    }
    return hex(palette[0][0]);
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** pixels: (x, y) => [r, g, b] — RGB, filtresiz PNG. */
function png(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
  for (let y = 0; y < SIZE; y++) {
    const row = y * (1 + SIZE * 3);
    raw[row] = 0;
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = pixels(x, y);
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function grid(fill) {
  const g = [];
  for (let y = 0; y < SIZE; y++) {
    g.push([]);
    for (let x = 0; x < SIZE; x++) g[y].push(fill(x, y));
  }
  return (x, y) => g[y][x];
}

const DIRT = [
  ["#866043", 5],
  ["#79553a", 4],
  ["#966c4a", 3],
  ["#5e4029", 2],
  ["#b9855c", 1],
];

const STONE = [
  ["#7f7f7f", 6],
  ["#747474", 4],
  ["#8a8a8a", 3],
  ["#686868", 2],
  ["#9a9a9a", 1],
];

const GRASS = [
  ["#5f9f35", 5],
  ["#6aaa3d", 3],
  ["#548c2f", 3],
  ["#79c04a", 1],
];

function dirt(seed) {
  return grid(picker(DIRT, mulberry32(seed)));
}

function stone(seed) {
  return grid(picker(STONE, mulberry32(seed)));
}

/** Yan çim bloğu: üstte çim, aşağı doğru düzensiz sarkan uçlar, altı toprak. */
function grassSide(seed) {
  const rand = mulberry32(seed);
  const soil = dirt(seed + 1);
  const grass = picker(GRASS, rand);
  const drip = Array.from({ length: SIZE }, () => 3 + Math.floor(rand() * 3));
  return grid((x, y) => (y < drip[x] ? grass() : soil(x, y)));
}

mkdirSync(OUT, { recursive: true });
const textures = { "dirt.png": dirt(7), "stone.png": stone(11), "grass_side.png": grassSide(23) };
for (const [name, pixels] of Object.entries(textures)) {
  writeFileSync(join(OUT, name), png(pixels));
  console.log("yazıldı:", name);
}
