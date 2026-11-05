#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-env node */
'use strict';

/**
 * Bundles the precompiled split build (dist/core.min) into one file holding
 * core plus the named features, installed as Hls.DefaultConfig. No
 * transpilation happens here, so any combination takes milliseconds.
 *
 *   node scripts/bundle-features.js [--format esm|iife] [--out file] feature...
 */

const path = require('path');
const esbuild = require('esbuild');

const SPLIT = path.resolve(__dirname, '..', 'dist', 'core.min');

// Bundle file names list feature codes in this order: hls-ts-subs.min.mjs.
const featureCodes = {
  'mpeg-ts': 'ts',
  subtitles: 'subs',
  'alt-audio': 'audio',
  'eme-drm': 'drm',
  cmcd: 'cmcd',
  interstitials: 'ads',
  'content-steering': 'steering',
  iframes: 'iframes',
  metadata: 'id3',
  latency: 'latency',
  'cap-level': 'caplevel',
  fps: 'fps',
  'media-capabilities': 'mcap',
  'variable-substitution': 'vars',
};
const BUNDLE_NAME = /^hls-([a-z0-9-]+)\.min\.(m?js)$/;

/**
 * Parses a bundle file name into its features and format. `canonical` is the
 * name with codes in standard order; undefined when a code is unknown or
 * repeated.
 */
function parseBundleName(name) {
  const match = BUNDLE_NAME.exec(name);
  if (!match) return null;
  const codes = match[1] === 'core' ? [] : match[1].split('-');
  const features = Object.keys(featureCodes).filter((feature) =>
    codes.includes(featureCodes[feature]),
  );
  if (features.length !== codes.length) return null;
  const extension = match[2];
  return {
    features,
    format: extension === 'mjs' ? 'esm' : 'iife',
    canonical: `${bundleName(features)}.min.${extension}`,
  };
}

const bundleName = (features) =>
  `hls-${features.map((feature) => featureCodes[feature]).join('-') || 'core'}`;

const toIdentifier = (feature) =>
  feature.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());

function bundleFeatures({ features, format = 'esm', outfile, write = true }) {
  const contents = [
    `import Hls from './core.mjs';`,
    ...features.map(
      (feature) =>
        `import { ${toIdentifier(feature)} } from './features/${feature}.mjs';`,
    ),
    `Hls.DefaultConfig = Object.assign({}, Hls.DefaultConfig, ${features
      .map(toIdentifier)
      .join(', ')});`,
    format === 'esm' ? 'export default Hls;' : 'self.Hls = Hls;',
  ].join('\n');

  return esbuild.build({
    stdin: { contents, resolveDir: SPLIT, loader: 'js' },
    bundle: true,
    minify: true,
    format,
    target: 'es2017',
    outfile,
    write,
    legalComments: 'none',
  });
}

module.exports = { bundleFeatures, featureCodes, parseBundleName };

if (require.main === module) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args.splice(i, 2)[1];
  };
  const format = option('format', 'esm');
  const outfile = option(
    'out',
    `dist/hls.custom.min.${format === 'esm' ? 'mjs' : 'js'}`,
  );
  const start = Date.now();
  bundleFeatures({ features: args, format, outfile }).then(() =>
    console.log(
      `${outfile} (${args.join(', ') || 'core only'}) in ${Date.now() - start} ms`,
    ),
  );
}
