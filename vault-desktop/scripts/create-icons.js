#!/usr/bin/env node
'use strict';
/**
 * Generates placeholder icons for Royal Vault in build/
 *
 * Creates:
 *   build/icon.png  — 1024×1024 app icon (purple gradient square)
 *   build/tray.png  — 32×32 tray template icon (black circle on transparent)
 *
 * electron-builder will auto-convert icon.png → .icns on macOS.
 * Replace these with real artwork before shipping.
 */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC-32 ────────────────────────────────────────────────────────────────────
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
  const crcData = Buffer.concat([t, d]);
  const crcBuf  = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, t, d, crcBuf]);
}

function makePNG(width, height, fillFn) {
  // RGBA pixels
  const raw = Buffer.allocUnsafe((1 + width * 4) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const off = y * (1 + width * 4) + 1 + x * 4;
      const [r, g, b, a] = fillFn(x, y, width, height);
      raw[off]   = r;
      raw[off+1] = g;
      raw[off+2] = b;
      raw[off+3] = a;
    }
  }
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // RGBA
  ihdr[10] = ihdr[11] = ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]), // PNG sig
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── App icon: 1024×1024 rounded-square purple gradient ────────────────────────
function appIconPixel(x, y, w, h) {
  const cx = x / w - 0.5, cy = y / h - 0.5;
  const rx = Math.abs(cx), ry = Math.abs(cy);
  const r = 0.18; // corner radius
  const inRect = rx < 0.44 && ry < 0.44;
  const inCorner = rx > (0.44 - r) && ry > (0.44 - r);
  const cornerDist = Math.sqrt((rx - (0.44 - r)) ** 2 + (ry - (0.44 - r)) ** 2);
  const inside = inRect && (!inCorner || cornerDist < r);

  if (!inside) return [0, 0, 0, 0];

  // Purple gradient: top-left #3b0764 → bottom-right #7c3aed
  const t = (x / w * 0.4 + y / h * 0.6);
  const R = Math.round(59  + t * (124 - 59));
  const G = Math.round(7   + t * (58  - 7));
  const B = Math.round(100 + t * (237 - 100));

  // Crown-ish: just a "K" initial in lighter purple centre
  // Simple cross/diamond highlight in centre for visual interest
  const dist = Math.sqrt(cx * cx + cy * cy);
  const highlight = Math.max(0, 0.08 - dist) * 10;

  return [
    Math.min(255, R + Math.round(highlight * 80)),
    Math.min(255, G + Math.round(highlight * 60)),
    Math.min(255, B + Math.round(highlight * 40)),
    255
  ];
}

// ── Tray icon: 32×32 black crown on transparent ───────────────────────────────
function trayPixel(x, y, w, h) {
  // Simple filled circle in the centre (template image — must be black)
  const cx = x - w / 2 + 0.5, cy = y - h / 2 + 0.5;
  const r = w * 0.38;
  const dist = Math.sqrt(cx * cx + cy * cy);

  if (dist > r) return [0, 0, 0, 0];

  // Crown shape (5-point outline via rows)
  // Outer ring
  if (dist > r - 1.5) return [0, 0, 0, 230];

  // Inner fill with cross-like crown suggestion
  const topY = -r * 0.55;
  const bottomY = r * 0.45;
  const inBody = cy > topY * 0.3 && cy < bottomY;
  const points = [
    [0, topY],                        // centre top
    [-r * 0.45, topY * 0.55],         // left top
    [r * 0.45,  topY * 0.55],         // right top
  ];
  const inPoints = points.some(([px, py]) =>
    Math.sqrt((cx - px) ** 2 + (cy - py) ** 2) < r * 0.18
  );
  if (inBody || inPoints) return [0, 0, 0, 220];
  return [0, 0, 0, 0];
}

// ── Write files ───────────────────────────────────────────────────────────────
const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });

console.log('Generating app icon (1024×1024)…');
const appPNG  = makePNG(1024, 1024, appIconPixel);
fs.writeFileSync(path.join(buildDir, 'icon.png'), appPNG);
console.log('✓ build/icon.png');

console.log('Generating tray icon (32×32)…');
const trayPNG = makePNG(32, 32, trayPixel);
fs.writeFileSync(path.join(buildDir, 'tray.png'), trayPNG);
console.log('✓ build/tray.png');

console.log('\nIcons created. Replace with real artwork before shipping!');
