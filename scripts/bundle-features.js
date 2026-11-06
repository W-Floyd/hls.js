#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-env node */
'use strict';

/**
 * Bundles the split build (dist/core) into one file holding core plus the named
 * features, installed as Hls.DefaultConfig. It starts from the unminified
 * chunks and minifies the whole bundle once, landing within ~1% of a
 * flag-compiled build. esbuild does syntax/whitespace minification and swc
 * mangles names: esbuild's own mangling left bundles ~3% larger, and terser's
 * matched swc's size at ~5x the time (~90 ms total here).
 *
 *   node scripts/bundle-features.js [--format esm|iife] [--out file] feature...
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const swc = require('@swc/core');

const SPLIT = path.resolve(__dirname, '..', 'dist', 'core');

// Bundle file names list feature codes in this order: hls-ts-subs.min.mjs.
const featureCodes = require('../src/features/codes.json');
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

// `fast` skips swc: esbuild's own mangling, ~30 ms but ~3% larger.
async function bundleFeatures({ features, format = 'esm', outfile, fast }) {
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

  const result = await esbuild.build({
    stdin: { contents, resolveDir: SPLIT, loader: 'js' },
    bundle: true,
    format,
    target: 'es2017',
    write: false,
    minify: !!fast,
    minifySyntax: true,
    minifyWhitespace: true,
    legalComments: 'none',
  });
  const { code } = fast
    ? { code: result.outputFiles[0].text }
    : await swc.minify(result.outputFiles[0].text, {
        ecma: 2017,
        module: format === 'esm',
        compress: false,
        mangle: true,
      });
  if (outfile) {
    await fs.promises.mkdir(path.dirname(outfile), { recursive: true });
    await fs.promises.writeFile(outfile, code);
  }
  return code;
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
