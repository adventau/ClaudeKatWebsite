#!/usr/bin/env node
'use strict';
/**
 * Generates icons + DMG background for Royal Vault.
 *
 * Outputs:
 *   build/icon.png          — 1024×1024 app icon (purple + white crown)
 *   build/tray.png          — 32×32 tray template icon
 *   build/dmg-background.png — 600×400 DMG installer background
 */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── PNG helpers ───────────────────────────────────────────────────────────────
function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(d.length);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([len, t, d, crcBuf]);
}

function makePNG(width, height, fillFn) {
  const raw = Buffer.allocUnsafe((1 + width * 4) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const off = y * (1 + width * 4) + 1 + x * 4;
      const [r, g, b, a] = fillFn(x, y, width, height);
      raw[off] = r; raw[off+1] = g; raw[off+2] = b; raw[off+3] = a;
    }
  }
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Point-in-polygon (ray casting) ───────────────────────────────────────────
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// Crown polygon in normalised [-0.5,0.5] space (y down)
const CROWN_POLY = [
  [ 0.00, -0.30],   // centre peak tip
  [ 0.09, -0.08],   // right of centre base
  [ 0.21, -0.20],   // right peak tip
  [ 0.30, -0.06],   // right of right base
  [ 0.33, -0.06],   // right outer top
  [ 0.33,  0.22],   // right outer bottom
  [-0.33,  0.22],   // left outer bottom
  [-0.33, -0.06],   // left outer top
  [-0.30, -0.06],   // left of left base
  [-0.21, -0.20],   // left peak tip
  [-0.09, -0.08],   // left of centre base
];

// Crown gem circles: [cx, cy, radius] in normalised space
const CROWN_GEMS = [
  [ 0.00, -0.30, 0.035],  // centre tip gem
  [ 0.21, -0.20, 0.028],  // right tip gem
  [-0.21, -0.20, 0.028],  // left tip gem
];

function inCrown(cx, cy) {
  if (pointInPoly(cx, cy, CROWN_POLY)) return true;
  return CROWN_GEMS.some(([gx, gy, gr]) =>
    Math.sqrt((cx - gx) ** 2 + (cy - gy) ** 2) < gr
  );
}

// ── Rounded-square mask ───────────────────────────────────────────────────────
function inRoundedSquare(nx, ny, radius = 0.18) {
  const ax = Math.abs(nx), ay = Math.abs(ny);
  if (ax >= 0.5 || ay >= 0.5) return false;
  const edgeX = 0.5 - radius, edgeY = 0.5 - radius;
  if (ax > edgeX && ay > edgeY) {
    return Math.sqrt((ax - edgeX) ** 2 + (ay - edgeY) ** 2) < radius;
  }
  return true;
}

// ── App icon 1024×1024 ───────────────────────────────────────────────────────
function appIconPixel(x, y, w, h) {
  const nx = x / w - 0.5, ny = y / h - 0.5; // -0.5 to 0.5

  if (!inRoundedSquare(nx, ny)) return [0, 0, 0, 0];

  // Background: deep purple radial gradient
  const dist = Math.sqrt(nx * nx + ny * ny);
  const t = dist / 0.7;
  const bgR = Math.round(68  - t * 28);   // 68 → 40
  const bgG = Math.round(14  - t * 8);    // 14 → 6
  const bgB = Math.round(180 - t * 80);   // 180 → 100

  // Subtle inner glow at centre
  const glow = Math.max(0, 0.18 - dist) * 3;
  const baseR = Math.min(255, bgR + glow * 40);
  const baseG = Math.min(255, bgG + glow * 20);
  const baseB = Math.min(255, bgB + glow * 60);

  // Crown (white with slight gold tint)
  if (inCrown(nx, ny)) {
    // Anti-alias: soften edge by checking nearby pixels
    const crownAlpha = 255;
    // Gold-white: #f5e6c8
    return [245, 230, 200, crownAlpha];
  }

  return [Math.round(baseR), Math.round(baseG), Math.round(baseB), 255];
}

// ── Tray icon 32×32 (black template image — crown silhouette) ─────────────────
function trayPixel(x, y, w, h) {
  // 32x32 crown bitmap — clean silhouette for macOS menu bar
  const bitmap = [
    '00000000000000000000000000000000', // 0
    '00000000000000000000000000000000', // 1
    '00000000000000110000000000000000', // 2
    '00000000000001111000000000000000', // 3
    '00000000000001111000000000000000', // 4
    '00000000000000110000000000000000', // 5
    '00100000000000110000000000010000', // 6
    '01110000000000110000000000111000', // 7
    '01110000000000110000000000111000', // 8
    '00100000000000110000000000010000', // 9
    '01100000000001111000000000011000', // 10
    '01110000000001111000000000111000', // 11
    '01111000000011111100000001111000', // 12
    '01111100000011111100000011111000', // 13
    '01111110000111111110000111111000', // 14
    '01111111000111111110001111111000', // 15
    '01111111101111111111011111111000', // 16
    '01111111111111111111111111111000', // 17
    '01111111111111111111111111111000', // 18
    '01111111111111111111111111111000', // 19
    '01111111111111111111111111111000', // 20
    '01111111111111111111111111111000', // 21
    '01111111111111111111111111111000', // 22
    '00111111111111111111111111110000', // 23
    '00111111111111111111111111110000', // 24
    '00011111111111111111111111100000', // 25
    '00011111111111111111111111100000', // 26
    '00001111111111111111111111000000', // 27
    '00001111111111111111111111000000', // 28
    '00000000000000000000000000000000', // 29
    '00000000000000000000000000000000', // 30
    '00000000000000000000000000000000', // 31
  ];
  if (bitmap[y] && bitmap[y][x] === '1') return [0, 0, 0, 220];
  return [0, 0, 0, 0];
}

// ── DMG background 600×400 ───────────────────────────────────────────────────
function dmgBgPixel(x, y, w, h) {
  const nx = x / w, ny = y / h; // 0-1

  // Dark purple → near-black gradient
  const t = ny * 0.6 + nx * 0.1;
  const R = Math.round(22 - t * 10);
  const G = Math.round(8  - t * 4);
  const B = Math.round(45 - t * 20);

  // Subtle radial glow in left-third (where app icon sits)
  const glowX = 0.25, glowY = 0.48;
  const glowDist = Math.sqrt((nx - glowX) ** 2 + (ny - glowY) ** 2);
  const glow = Math.max(0, 0.22 - glowDist) * 2.5;

  // Subtle radial glow in right-third (where Applications sits)
  const glow2Dist = Math.sqrt((nx - 0.75) ** 2 + (ny - glowY) ** 2);
  const glow2 = Math.max(0, 0.18 - glow2Dist) * 1.5;

  return [
    Math.min(255, Math.round(R + glow * 40 + glow2 * 15)),
    Math.min(255, Math.round(G + glow * 15 + glow2 * 10)),
    Math.min(255, Math.round(B + glow * 80 + glow2 * 35)),
    255
  ];
}

// ── Write files ───────────────────────────────────────────────────────────────
const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });

// Skip icon.png if a custom one already exists (user-provided vault logo)
const iconPath = path.join(buildDir, 'icon.png');
if (!fs.existsSync(iconPath) || fs.statSync(iconPath).size < 10000) {
  console.log('Generating app icon  (1024×1024)…');
  fs.writeFileSync(iconPath, makePNG(1024, 1024, appIconPixel));
  console.log('✓ build/icon.png');
} else {
  console.log('Skipping icon.png (custom icon exists)');
}

console.log('Generating tray icon (32×32)…');
fs.writeFileSync(path.join(buildDir, 'tray.png'),           makePNG(32, 32, trayPixel));
console.log('✓ build/tray.png');

console.log('Generating DMG background (600×400)…');
fs.writeFileSync(path.join(buildDir, 'dmg-background.png'), makePNG(600, 400, dmgBgPixel));
console.log('✓ build/dmg-background.png');

console.log('\nAll icons created. Replace with real artwork before shipping.');
