#!/usr/bin/env node
'use strict';
/**
 * Copies socket.io-client browser bundle into renderer/vendor/
 * so it can be loaded as a plain <script> tag (no bundler needed).
 */

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js');
const destDir = path.join(__dirname, '..', 'renderer', 'vendor');
const dest = path.join(destDir, 'socket.io.min.js');

if (!fs.existsSync(src)) {
  console.warn('⚠  socket.io-client not found — run `npm install` first.');
  process.exit(0);
}

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

fs.copyFileSync(src, dest);
console.log('✓ socket.io.min.js → renderer/vendor/');
