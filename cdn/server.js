#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-env node */
'use strict';

/**
 * Serves single-file hls.js bundles for any feature combination, assembled on
 * first request from the split build (dist/core.min) and cached on disk with
 * brotli and gzip variants.
 *
 *   GET /hls-<codes>.min.mjs   ES module, e.g. /hls-ts-subs.min.mjs
 *   GET /hls-<codes>.min.js    classic script setting self.Hls
 *   GET /hls-core.min.mjs      no optional features
 *   GET /features              feature names and their codes
 *
 * Env: PORT (8080), CACHE_DIR (os tmpdir), CACHE_CONTROL (public, max-age=3600),
 * CACHE_PRUNE_AFTER_HOURS (24), CACHE_MAX_SIZE (1G; bytes, or e.g. 500M, 2G; 0 for unbounded)
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const zlib = require('zlib');
const {
  bundleFeatures,
  featureCodes,
  parseBundleName,
} = require('../scripts/bundle-features');

const PORT = Number(process.env.PORT) || 8080;
const CACHE_CONTROL = process.env.CACHE_CONTROL || 'public, max-age=3600';
const SPLIT = path.resolve(__dirname, '..', 'dist', 'core.min');

// Hash of everything that shapes a response: the split build, the bundler, its
// esbuild version and this server. Any change gets a fresh cache directory and
// new ETags, so neither the disk cache nor HTTP caches serve stale bundles.
const BUILD_ID = (() => {
  const hash = crypto.createHash('sha256');
  const walk = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((entry) => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith('.mjs'))
          hash.update(fs.readFileSync(file));
      });
  walk(SPLIT);
  hash.update(fs.readFileSync(require.resolve('../scripts/bundle-features')));
  hash.update(fs.readFileSync(__filename));
  hash.update(require('esbuild').version);
  return hash.digest('hex').slice(0, 16);
})();
const CACHE_ROOT =
  process.env.CACHE_DIR || path.join(os.tmpdir(), 'hls-bundles');
const CACHE_DIR = path.join(CACHE_ROOT, BUILD_ID);
fs.mkdirSync(CACHE_DIR, { recursive: true });

// Other builds' directories, once idle this long. Not removed immediately so a
// replica still running the previous build on a shared volume keeps working.
const PRUNE_AFTER_MS =
  (Number(process.env.CACHE_PRUNE_AFTER_HOURS) || 24) * 60 * 60 * 1000;
function pruneStaleBuilds() {
  fs.readdirSync(CACHE_ROOT, { withFileTypes: true }).forEach((entry) => {
    const dir = path.join(CACHE_ROOT, entry.name);
    if (
      entry.isDirectory() &&
      entry.name !== BUILD_ID &&
      Date.now() - fs.statSync(dir).mtimeMs > PRUNE_AFTER_MS
    ) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`pruned stale cache ${entry.name}`);
    }
  });
}
pruneStaleBuilds();
require('timers')
  .setInterval(pruneStaleBuilds, 60 * 60 * 1000)
  .unref();

const ENCODINGS = [
  ['br', '.br'],
  ['gzip', '.gz'],
  ['identity', ''],
];
// Async zlib runs on the libuv pool, so a slow brotli pass doesn't block
// requests for bundles that are already cached.
const compressors = {
  '.gz': (source) =>
    promisify(zlib.gzip)(source, { level: zlib.constants.Z_BEST_COMPRESSION }),
  '.br': (source) =>
    promisify(zlib.brotliCompress)(source, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]:
          zlib.constants.BROTLI_MAX_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    }),
};
// Keyed by cache file path; deduplicates concurrent work on the same file.
const inflight = new Map();

function parseSize(value) {
  const match = /^(\d+(?:\.\d+)?)\s*([kmgt]?)i?b?$/i.exec(String(value).trim());
  if (!match) {
    throw new Error(
      `Invalid CACHE_MAX_SIZE "${value}"; use bytes or e.g. 500M`,
    );
  }
  const power = ' kmgt'.indexOf(match[2].toLowerCase() || ' ');
  return Math.floor(Number(match[1]) * 1024 ** power);
}
// 0 means unbounded.
const MAX_BYTES = parseSize(process.env.CACHE_MAX_SIZE || '1G') || Infinity;

// Per bundle (all encodings): bytes on disk and when last served. Seeded from
// this build's directory; other builds' are left to pruneStaleBuilds.
const usage = new Map();
let totalBytes = 0;
const bundleOf = (file) => path.basename(file).replace(/\.(br|gz)$/, '');

function track(file, bytes, used = Date.now()) {
  const name = bundleOf(file);
  const entry = usage.get(name) || { bytes: 0, used };
  entry.bytes += bytes;
  entry.used = Math.max(entry.used, used);
  usage.set(name, entry);
  totalBytes += bytes;
}

fs.readdirSync(CACHE_DIR).forEach((file) => {
  const full = path.join(CACHE_DIR, file);
  if (file.endsWith('.tmp')) {
    fs.rmSync(full, { force: true });
    return;
  }
  const { size, mtimeMs } = fs.statSync(full);
  track(file, size, mtimeMs);
});

// Least recently served first; skips bundles still being written and `keep`.
function evict(keep) {
  if (totalBytes <= MAX_BYTES) return;
  const busy = new Set([...inflight.keys()].map(bundleOf));
  const candidates = [...usage]
    .filter(([name]) => name !== keep && !busy.has(name))
    .sort((a, b) => a[1].used - b[1].used);
  candidates.some(([name, { bytes }]) => {
    if (totalBytes <= MAX_BYTES) return true;
    ['', '.br', '.gz'].forEach((suffix) =>
      fs.rmSync(path.join(CACHE_DIR, name + suffix), { force: true }),
    );
    usage.delete(name);
    totalBytes -= bytes;
    console.log(`evicted ${name} (${bytes} bytes)`);
    return false;
  });
}

async function writeAtomic(file, data) {
  // Recreated if another replica pruned it.
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, file);
  track(file, data.length);
  evict(bundleOf(file));
}

function once(file, create) {
  if (fs.existsSync(file)) return Promise.resolve();
  let pending = inflight.get(file);
  if (!pending) {
    pending = create().finally(() => inflight.delete(file));
    inflight.set(file, pending);
  }
  return pending;
}

// Writes the uncompressed bundle, then starts compressing it in the background
// so identity requests are served without waiting on compression.
function ensureSource(name, { features, format }) {
  const file = path.join(CACHE_DIR, name);
  return once(file, async () => {
    const start = Date.now();
    const result = await bundleFeatures({ features, format, write: false });
    const source = Buffer.from(result.outputFiles[0].contents);
    await writeAtomic(file, source);
    console.log(
      `generated ${name} (${features.join(', ') || 'core'}) in ${Date.now() - start} ms`,
    );
    Object.keys(compressors).forEach((suffix) =>
      ensureVariant(name, suffix, source).catch((error) =>
        console.error(`failed ${name}${suffix}:`, error),
      ),
    );
  });
}

// Also recovers variants missing from disk, e.g. after a restart mid-compress.
function ensureVariant(name, suffix, source) {
  const file = path.join(CACHE_DIR, name);
  if (!suffix) return Promise.resolve();
  return once(`${file}${suffix}`, async () => {
    const data = await compressors[suffix](
      source || (await fs.promises.readFile(file)),
    );
    await writeAtomic(`${file}${suffix}`, data);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(body);
}

async function serveBundle(req, res, name, parsed) {
  const accepted = String(req.headers['accept-encoding'] || '');
  const [encoding, suffix] = ENCODINGS.find(
    ([token]) => token === 'identity' || accepted.includes(token),
  );
  // Each encoding is a distinct representation, so its own validator.
  const etag = `"${BUILD_ID}-${name}${suffix}"`;
  const headers = {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': CACHE_CONTROL,
    ETag: etag,
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === etag) {
    send(res, 304, null, headers);
    return;
  }
  // Brotli clients wait for brotli rather than get gzip, which a shared cache
  // in front would then keep serving them. Retried once in case the bundle is
  // evicted between being ensured and read.
  let body;
  for (let attempt = 0; !body; attempt++) {
    await ensureSource(name, parsed);
    await ensureVariant(name, suffix);
    try {
      body = await fs.promises.readFile(path.join(CACHE_DIR, name) + suffix);
    } catch (error) {
      if (error.code !== 'ENOENT' || attempt) throw error;
    }
  }
  const entry = usage.get(name);
  if (entry) entry.used = Date.now();
  if (encoding !== 'identity') headers['Content-Encoding'] = encoding;
  headers['Content-Length'] = body.length;
  send(res, 200, req.method === 'HEAD' ? null : body, headers);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
    return;
  }
  const { pathname } = new URL(req.url, 'http://localhost');
  const name = pathname.slice(1);
  if (name === 'healthz') {
    send(res, 200, 'ok\n');
    return;
  }
  if (name === 'features') {
    send(res, 200, `${JSON.stringify({ build: BUILD_ID, featureCodes })}\n`, {
      'Content-Type': 'application/json',
    });
    return;
  }
  const parsed = parseBundleName(name);
  if (!parsed) {
    send(
      res,
      404,
      `Unknown bundle. Use /hls-<codes>.min.mjs or .min.js with codes from /features.\n`,
    );
    return;
  }
  if (parsed.canonical !== name) {
    send(res, 301, null, { Location: `/${parsed.canonical}` });
    return;
  }
  serveBundle(req, res, name, parsed).catch((error) => {
    console.error(`failed ${name}:`, error);
    send(res, 500, 'Bundle generation failed\n');
  });
});

server.listen(PORT, () =>
  console.log(`serving build ${BUILD_ID} on :${PORT}, cache ${CACHE_DIR}`),
);
