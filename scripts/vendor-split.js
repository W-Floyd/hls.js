#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-env node */
'use strict';

/**
 * Copies the minified split build (dist/core.min, from rollup configType
 * coreMin) and the ES module auto loader (configType autoEsm) into
 * <out>/<content hash>/, for serving as static files, e.g. vendored into a
 * site. Relative imports between the modules rule out per-file fingerprinting,
 * so the directory is the cache-busting unit. Writes <out>/manifest.json:
 * { "dir": "<hash>/", "files": [...] }. Build with any USE_* flags first.
 *
 *   node scripts/vendor-split.js <out>
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');
const SOURCES = [
  { from: path.join(DIST, 'core.min'), to: '' },
  { from: path.join(DIST, 'hls.auto.min.mjs'), to: 'hls-auto.min.mjs' },
];

function list(from, to) {
  if (!fs.statSync(from).isDirectory()) return [{ from, to }];
  return fs
    .readdirSync(from)
    .sort()
    .flatMap((name) => list(path.join(from, name), path.posix.join(to, name)));
}

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/vendor-split.js <out>');
  process.exit(1);
}
const files = SOURCES.flatMap(({ from, to }) => {
  if (!fs.existsSync(from)) {
    console.error(
      `missing ${from}: run rollup --configType coreMin --configType autoEsm`,
    );
    process.exit(1);
  }
  return list(from, to);
}).filter(({ to }) => to.endsWith('.mjs'));
const hash = crypto.createHash('sha256');
files.forEach(({ from, to }) => hash.update(to).update(fs.readFileSync(from)));
const dir = hash.digest('hex').slice(0, 12);
files.forEach(({ from, to }) => {
  const target = path.join(out, dir, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(from, target);
});
fs.writeFileSync(
  path.join(out, 'manifest.json'),
  `${JSON.stringify({ dir: `${dir}/`, files: files.map(({ to }) => to) }, null, 2)}\n`,
);
console.log(`${files.length} files -> ${path.join(out, dir)}/`);
