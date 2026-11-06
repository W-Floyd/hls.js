#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-env node */
'use strict';

/**
 * Serves single-file hls.js bundles for any feature combination, assembled on
 * first request from the split build (dist/core) and cached on disk with
 * brotli and gzip variants.
 *
 *   GET /hls-<codes>.min.mjs   ES module, e.g. /hls-ts-subs.min.mjs
 *   GET /hls-<codes>.min.js    classic script setting self.Hls
 *   GET /hls-core.min.mjs      no optional features
 *   GET /hls-<codes>.nolog.min.mjs  same, assembled from the log-stripped split
 *                              build (dist/core-nolog)
 *   GET /hls-light.min.mjs     a preset (src/features/presets.json, or `full`):
 *                              redirects to its /hls-<codes>[.nolog] name
 *   GET /features              feature names and their codes
 *   GET /hls-auto.min.mjs      loader that picks a bundle per stream (src/auto.ts);
 *   GET /hls-auto.min.js       classic-script form, global HlsAuto
 *   GET /split/<build>/core.mjs, /split/<build>/features/<name>.mjs
 *                              the minified split build, for the auto loader's
 *                              `split` mode; <build> is `build` from /features
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
  presets,
  splitDir,
} = require('../scripts/bundle-features');

const PORT = Number(process.env.PORT) || 8080;
const CACHE_CONTROL = process.env.CACHE_CONTROL || 'public, max-age=3600';
// .nolog bundles need the log-stripped split build; without it they 404.
const HAS_NOLOG_SPLIT = fs.existsSync(splitDir(false));
// Minified split build (rollup configType coreMin), served as-is under
// /split/<BUILD_ID>/ for the auto loader's `split` mode.
const SPLIT_MIN = path.resolve(__dirname, '..', 'dist', 'core.min');
const HAS_SPLIT_MIN = fs.existsSync(SPLIT_MIN);
// The auto loader (src/auto.ts), served as-is.
const LOADERS = {
  'hls-auto.min.mjs': path.resolve(__dirname, '..', 'dist', 'hls.auto.min.mjs'),
  'hls-auto.min.js': path.resolve(__dirname, '..', 'dist', 'hls.auto.min.js'),
};

// Hash of everything that shapes a response: the split build, the bundler, its
// esbuild and swc versions and this server. Any change gets a fresh cache directory and
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
  walk(splitDir(true));
  if (HAS_NOLOG_SPLIT) walk(splitDir(false));
  if (HAS_SPLIT_MIN) walk(SPLIT_MIN);
  hash.update(fs.readFileSync(require.resolve('../scripts/bundle-features')));
  hash.update(JSON.stringify([featureCodes, presets]));
  hash.update(fs.readFileSync(__filename));
  Object.values(LOADERS).forEach((file) => hash.update(fs.readFileSync(file)));
  hash.update(require('esbuild').version);
  hash.update(require('@swc/core/package.json').version);
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

// No request waits on slow work. A new bundle is first served from a fast
// build (esbuild alone, ~30 ms, ~3% larger) with quality-9 brotli (~20 ms,
// ~8% larger than quality 11). The optimized build (swc mangling) and its
// quality-11 brotli are made in the background and replace the fast files,
// so later requests get the smaller ones. Every file has its own ETag.
const FAST = '.fast';
const brotli = (quality) => (source) =>
  promisify(zlib.brotliCompress)(source, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  });
// Async zlib runs on the libuv pool, so compression doesn't block requests.
const compressors = {
  '.gz': (source) =>
    promisify(zlib.gzip)(source, { level: zlib.constants.Z_BEST_COMPRESSION }),
  '.br9': brotli(9),
  '.br': brotli(zlib.constants.BROTLI_MAX_QUALITY),
};
const VARIANTS = ['', ...Object.keys(compressors)];
const ALL_SUFFIXES = VARIANTS.concat(VARIANTS.map((suffix) => FAST + suffix));
// Accept-Encoding token -> stored variants, best first.
const ENCODINGS = [
  ['br', ['.br', '.br9']],
  ['gzip', ['.gz']],
  ['identity', ['']],
];
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

// Per bundle (all files): bytes on disk and when last served. Seeded from this
// build's directory; other builds' are left to pruneStaleBuilds.
const usage = new Map();
let totalBytes = 0;
const bundleOf = (file) =>
  path.basename(file).replace(/(\.fast)?(\.br9?|\.gz)?$/, '');

function track(file, bytes, used = Date.now()) {
  const name = bundleOf(file);
  const entry = usage.get(name) || { bytes: 0, used };
  entry.bytes += bytes;
  entry.used = Math.max(entry.used, used);
  usage.set(name, entry);
  totalBytes += bytes;
}

async function remove(file) {
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat) return;
  await fs.promises.rm(file, { force: true });
  const entry = usage.get(bundleOf(file));
  if (entry) entry.bytes -= stat.size;
  totalBytes -= stat.size;
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
    ALL_SUFFIXES.forEach((suffix) =>
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

const background = (label, promise) =>
  promise.catch((error) => console.error(`failed ${label}:`, error));

// `tier` is '' (optimized) or FAST.
function ensureBuild(name, { features, format, logs }, tier) {
  const file = path.join(CACHE_DIR, name + tier);
  // Never recreate a fast build once the optimized one exists; the caller's
  // read then fails and it retries with the optimized file.
  if (tier && fs.existsSync(path.join(CACHE_DIR, name))) {
    return Promise.resolve();
  }
  return once(file, async () => {
    const start = Date.now();
    const code = await bundleFeatures({
      features,
      format,
      logs,
      fast: !!tier,
    });
    await writeAtomic(file, Buffer.from(code));
    console.log(
      `generated ${name + tier} (${features.join(', ') || 'core'}${logs ? '' : ', no logs'}) in ${Date.now() - start} ms`,
    );
    if (!tier) {
      // The optimized build supersedes the fast one.
      await Promise.all(
        VARIANTS.map((suffix) =>
          remove(path.join(CACHE_DIR, name + FAST + suffix)),
        ),
      );
      background(`${name}.br`, ensureVariant(name, '.br'));
    }
  });
}

function ensureVariant(base, suffix) {
  const file = path.join(CACHE_DIR, base);
  if (!suffix) return Promise.resolve();
  return once(`${file}${suffix}`, async () => {
    await writeAtomic(
      `${file}${suffix}`,
      await compressors[suffix](await fs.promises.readFile(file)),
    );
    if (suffix === '.br') await remove(`${file}.br9`);
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

// The best file available now, kicking off background work for better ones.
function select(name, parsed, candidates) {
  const exists = (file) => fs.existsSync(path.join(CACHE_DIR, file));
  if (!exists(name)) {
    background(name, ensureBuild(name, parsed, ''));
    return `${name}${FAST}${candidates[candidates.length - 1]}`;
  }
  const ready = candidates.find((suffix) => exists(name + suffix));
  if (candidates[0] === '.br' && ready !== '.br') {
    background(`${name}.br`, ensureVariant(name, '.br'));
  }
  return name + (ready ?? candidates[candidates.length - 1]);
}

async function serveBundle(req, res, name, parsed) {
  const accepted = String(req.headers['accept-encoding'] || '');
  const [encoding, candidates] = ENCODINGS.find(
    ([token]) => token === 'identity' || accepted.includes(token),
  );
  let file = select(name, parsed, candidates);
  // Each stored file is a distinct representation, so its own validator.
  const etagFor = (stored) => `"${BUILD_ID}-${stored}"`;
  const headers = {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': CACHE_CONTROL,
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === etagFor(file)) {
    send(res, 304, null, { ...headers, ETag: etagFor(file) });
    return;
  }
  // Retried once in case the file is evicted or superseded between being
  // ensured and read.
  let body;
  for (let attempt = 0; !body; attempt++) {
    if (attempt) file = select(name, parsed, candidates);
    const tier = file.startsWith(name + FAST) ? FAST : '';
    await ensureBuild(name, parsed, tier);
    await ensureVariant(name + tier, file.slice((name + tier).length));
    try {
      body = await fs.promises.readFile(path.join(CACHE_DIR, file));
    } catch (error) {
      if (error.code !== 'ENOENT' || attempt) throw error;
    }
  }
  headers.ETag = etagFor(file);
  const entry = usage.get(name);
  if (entry) entry.used = Date.now();
  if (encoding !== 'identity') headers['Content-Encoding'] = encoding;
  headers['Content-Length'] = body.length;
  send(res, 200, req.method === 'HEAD' ? null : body, headers);
}

// Small and fixed per build: compressed once at startup, served from memory.
const loaderBodies = Object.fromEntries(
  Object.entries(LOADERS).map(([name, file]) => {
    const source = fs.readFileSync(file);
    return [
      name,
      {
        br: zlib.brotliCompressSync(source),
        gzip: zlib.gzipSync(source, {
          level: zlib.constants.Z_BEST_COMPRESSION,
        }),
        identity: source,
      },
    ];
  }),
);

function serveLoader(req, res, name) {
  const accepted = String(req.headers['accept-encoding'] || '');
  const encoding = ['br', 'gzip'].find((token) => accepted.includes(token));
  const etag = `"${BUILD_ID}-${name}-${encoding || 'identity'}"`;
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
  const body = loaderBodies[name][encoding || 'identity'];
  if (encoding) headers['Content-Encoding'] = encoding;
  headers['Content-Length'] = body.length;
  send(res, 200, req.method === 'HEAD' ? null : body, headers);
}

// The minified split build, read once. Gzip is ready at startup; brotli is
// compressed in the background and preferred once it exists.
const splitFiles = new Map();
if (HAS_SPLIT_MIN) {
  const walkSplit = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkSplit(file);
      } else if (entry.name.endsWith('.mjs')) {
        const source = fs.readFileSync(file);
        const bodies = {
          identity: source,
          gzip: zlib.gzipSync(source, {
            level: zlib.constants.Z_BEST_COMPRESSION,
          }),
        };
        splitFiles.set(path.relative(SPLIT_MIN, file), bodies);
        background(
          `brotli ${entry.name}`,
          brotli(11)(source).then((br) => {
            bodies.br = br;
          }),
        );
      }
    });
  walkSplit(SPLIT_MIN);
}

function serveSplit(req, res, build, file) {
  const bodies = build === BUILD_ID && splitFiles.get(file);
  if (!bodies) {
    send(res, 404, 'Unknown split build file; get `build` from /features.\n');
    return;
  }
  const accepted = String(req.headers['accept-encoding'] || '');
  const encoding = ['br', 'gzip'].find(
    (token) => bodies[token] && accepted.includes(token),
  );
  const etag = `"${BUILD_ID}-${file}-${encoding || 'identity'}"`;
  const headers = {
    'Content-Type': 'text/javascript; charset=utf-8',
    // The build id is in the path, so the content never changes.
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: etag,
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === etag) {
    send(res, 304, null, headers);
    return;
  }
  const body = bodies[encoding || 'identity'];
  if (encoding) headers['Content-Encoding'] = encoding;
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
  if (LOADERS[name]) {
    serveLoader(req, res, name);
    return;
  }
  const split =
    /^split\/([0-9a-f]+)\/((?:features|chunks)\/)?([a-z0-9-]+\.mjs)$/.exec(
      name,
    );
  if (split) {
    serveSplit(req, res, split[1], (split[2] || '') + split[3]);
    return;
  }
  if (name === 'features') {
    send(
      res,
      200,
      `${JSON.stringify({ build: BUILD_ID, split: HAS_SPLIT_MIN, featureCodes, presets })}\n`,
      {
        'Content-Type': 'application/json',
      },
    );
    return;
  }
  const parsed = parseBundleName(name);
  if (parsed && !parsed.logs && !HAS_NOLOG_SPLIT) {
    send(res, 404, `No log-stripped (.nolog) build on this server.\n`);
    return;
  }
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

// Starts the esbuild service and loads swc so the first request doesn't pay
// for it (~40 ms).
background(
  'warm-up',
  bundleFeatures({ features: [], fast: true }).then(() =>
    bundleFeatures({ features: [] }),
  ),
);

server.listen(PORT, () =>
  console.log(`serving build ${BUILD_ID} on :${PORT}, cache ${CACHE_DIR}`),
);
