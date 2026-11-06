const path = require('path');
const importHelper = require('@babel/helper-module-imports');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const babel = require('@rollup/plugin-babel');
const alias = require('@rollup/plugin-alias');
const replace = require('@rollup/plugin-replace');
const terser = require('@rollup/plugin-terser');
const istanbul = require('rollup-plugin-istanbul');
const fs = require('fs');

const featureCodes = require('./src/features/codes.json');

const pkgJson = JSON.parse(
  fs.readFileSync('./package.json', { encoding: 'utf-8' }),
);

const BUILD_TYPE = {
  full: 'full',
  light: 'light',
};

const FORMAT = {
  umd: 'umd',
  esm: 'esm',
  iife: 'iife',
};

const buildTypeToOutputName = {
  full: `hls`,
  light: `hls.light`,
};

/* Allow to customize builds through env-vars */
// eslint-disable-next-line no-undef
const env = process.env;
const DISABLED_ENV_VALUES = ['', '0', 'false', 'off', 'no'];

function parseEnvToggle(value) {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  // Preserve prior behavior where any non-empty, non-false-like value enables a feature.
  return !DISABLED_ENV_VALUES.includes(normalized);
}

function readFeatureFlag(name, ...aliases) {
  const envName = [`USE_${name}`, name, ...aliases].find(
    (candidate) => env[candidate] !== undefined,
  );

  return envName ? parseEnvToggle(env[envName]) : undefined;
}

function isFeatureEnabled(type, explicit, enableInLight = false) {
  return explicit ?? (type === BUILD_TYPE.full || enableInLight);
}

const flags = {
  subtitles: readFeatureFlag('SUBTITLES', 'SUBTITLE'),
  altAudio: readFeatureFlag('ALT_AUDIO'),
  emeDrm: readFeatureFlag('EME_DRM'),
  cmcd: readFeatureFlag('CMCD'),
  contentSteering: readFeatureFlag('CONTENT_STEERING'),
  variableSubstitution: readFeatureFlag('VARIABLE_SUBSTITUTION'),
  m2tsAdvancedCodecs: readFeatureFlag('M2TS_ADVANCED_CODECS'),
  mediaCapabilities: readFeatureFlag('MEDIA_CAPABILITIES'),
  interstitials: readFeatureFlag('INTERSTITIALS'),
  iframes: readFeatureFlag('IFRAMES'),
  mpegTs: readFeatureFlag('MPEG_TS'),
  capLevel: readFeatureFlag('CAP_LEVEL'),
  fps: readFeatureFlag('FPS'),
  metadata: readFeatureFlag('METADATA'),
  latency: readFeatureFlag('LATENCY'),
};

function getFeatureSupport(type) {
  return {
    subtitles: isFeatureEnabled(type, flags.subtitles),
    altAudio: isFeatureEnabled(type, flags.altAudio),
    emeDrm: isFeatureEnabled(type, flags.emeDrm),
    cmcd: isFeatureEnabled(type, flags.cmcd),
    contentSteering: isFeatureEnabled(type, flags.contentSteering, true),
    variableSubstitution: isFeatureEnabled(type, flags.variableSubstitution),
    m2tsAdvancedCodecs: isFeatureEnabled(type, flags.m2tsAdvancedCodecs),
    mediaCapabilities: isFeatureEnabled(type, flags.mediaCapabilities),
    interstitials: isFeatureEnabled(type, flags.interstitials),
    iframes: isFeatureEnabled(type, flags.iframes),
    mpegTs: isFeatureEnabled(type, flags.mpegTs, true),
    capLevel: isFeatureEnabled(type, flags.capLevel, true),
    fps: isFeatureEnabled(type, flags.fps, true),
    metadata: isFeatureEnabled(type, flags.metadata, true),
    latency: isFeatureEnabled(type, flags.latency, true),
  };
}

const shouldBundleWorker = (format) => format !== FORMAT.esm;

const buildConstants = (
  type,
  additional = {},
  features = getFeatureSupport(type),
) => ({
  preventAssignment: true,
  values: {
    __VERSION__: JSON.stringify(pkgJson.version),
    __USE_SUBTITLES__: JSON.stringify(features.subtitles),
    __USE_ALT_AUDIO__: JSON.stringify(features.altAudio),
    __USE_EME_DRM__: JSON.stringify(features.emeDrm),
    __USE_CMCD__: JSON.stringify(features.cmcd),
    __USE_CONTENT_STEERING__: JSON.stringify(features.contentSteering),
    __USE_VARIABLE_SUBSTITUTION__: JSON.stringify(
      features.variableSubstitution,
    ),
    __USE_M2TS_ADVANCED_CODECS__: JSON.stringify(features.m2tsAdvancedCodecs),
    __USE_MEDIA_CAPABILITIES__: JSON.stringify(features.mediaCapabilities),
    __USE_INTERSTITIALS__: JSON.stringify(features.interstitials),
    __USE_IFRAMES__: JSON.stringify(features.iframes),
    // Single quotes: coverage instrumentation embeds this source unescaped in
    // a double-quoted string.
    __FEATURE_CODES__: `({${Object.entries(featureCodes)
      .map(([feature, code]) => `'${feature}':'${code}'`)
      .join(',')}})`,
    __USE_MPEG_TS__: JSON.stringify(features.mpegTs),
    __USE_CAP_LEVEL__: JSON.stringify(features.capLevel),
    __USE_FPS__: JSON.stringify(features.fps),
    __USE_METADATA__: JSON.stringify(features.metadata),
    __USE_LATENCY__: JSON.stringify(features.latency),

    ...additional,
  },
});

const buildOnLog = ({ allowCircularDeps } = {}) => {
  return (level, log, handler) => {
    if (allowCircularDeps && log.code === 'CIRCULAR_DEPENDENCY') return;

    if (level === 'warn') {
      // treat warnings as errors
      handler('error', log);
    } else {
      handler(level, log);
    }
  };
};

const workerFnBanner = '(function __HLS_WORKER_BUNDLE__(__IN_WORKER__){';
const workerFnFooter = '})(false);';

const extensions = ['.ts', '.js'];

// Browser baseline for the legacy UMD/IIFE bundles. Chosen so that all listed
// targets natively support the ES2015 built-ins (Map, Set, Array.from,
// Uint8Array.from, Promise, etc.) that source and bundled @svta/* deps rely
// on — we intentionally do NOT bundle core-js polyfills, to keep size down.
// Keep this list in sync with the "Compatibility" section in README.md.
const babelPresetEnvTargets = {
  chrome: '47',
  firefox: '51',
  safari: '10',
  ios: '10',
  android: '5',
  samsung: '5',
  edge: '14',
};

const babelTsWithPresetEnvTargets = ({ targets, stripConsole }) =>
  babel({
    extensions,
    babelHelpers: 'bundled',
    exclude: /node_modules\/(?!(@svta)\/).*/,
    assumptions: {
      noDocumentAll: true,
      noClassCalls: true,
    },
    presets: [
      [
        '@babel/preset-typescript',
        {
          optimizeConstEnums: true,
        },
      ],
      [
        '@babel/preset-env',
        {
          loose: true,
          targets,
          bugfixes: true,
        },
      ],
    ],
    plugins: [
      [
        '@babel/plugin-transform-class-properties',
        {
          loose: true,
        },
      ],
      '@babel/plugin-transform-object-rest-spread',
      {
        visitor: {
          CallExpression: function (espath) {
            if (espath.get('callee').matchesPattern('Number.isFinite')) {
              espath.node.callee = importHelper.addNamed(
                espath,
                'isFiniteNumber',
                path.resolve('src/polyfills/number'),
              );
            } else if (
              espath.get('callee').matchesPattern('Number.isSafeInteger')
            ) {
              espath.node.callee = importHelper.addNamed(
                espath,
                'isSafeInteger',
                path.resolve('src/polyfills/number'),
              );
            } else if (
              espath.get('callee').matchesPattern('Number.MAX_SAFE_INTEGER')
            ) {
              espath.node.callee = importHelper.addNamed(
                espath,
                'MAX_SAFE_INTEGER',
                path.resolve('src/polyfills/number'),
              );
            }
          },
        },
      },
      ['@babel/plugin-transform-object-assign'],
      ['@babel/plugin-transform-optional-chaining'],

      ...(stripConsole
        ? [
            [
              // Strip console.assert statements from build targets
              'transform-remove-console',
              {
                exclude: ['log', 'warn', 'error'],
              },
            ],
          ]
        : []),
    ],
  });

const buildBabelLegacyBrowsers = ({ stripConsole }) =>
  babelTsWithPresetEnvTargets({
    targets: babelPresetEnvTargets,
    stripConsole,
  });

const buildBabelEsm = ({ stripConsole }) =>
  babelTsWithPresetEnvTargets({ targets: { esmodules: true }, stripConsole });

const basePlugins = [
  nodeResolve({
    extensions,
    browser: true,
    preferBuiltins: false,
  }),
  commonjs({ transformMixedEsModules: true }),
];

function getAliasesForDist(format, features) {
  const emptyFile = format === 'esm' ? 'empty-es.js' : 'empty.js';

  let aliases = {};

  if (!features.emeDrm) {
    aliases = {
      ...aliases,
      './controller/eme-controller': `./${emptyFile}`,
      './utils/mediakeys-helper': `./${emptyFile}`,
      '../utils/mediakeys-helper': `../${emptyFile}`,
    };
  }

  if (!features.cmcd) {
    aliases = { ...aliases, './controller/cmcd-controller': `./${emptyFile}` };
  }

  if (!features.subtitles) {
    aliases = {
      ...aliases,
      './utils/cues': `./${emptyFile}`,
      './controller/timeline-controller': `./${emptyFile}`,
      './controller/subtitle-track-controller': `./${emptyFile}`,
      './controller/subtitle-stream-controller': `./${emptyFile}`,
    };
  }

  if (!features.altAudio) {
    aliases = {
      ...aliases,
      './controller/audio-track-controller': `./${emptyFile}`,
      './controller/audio-stream-controller': `./${emptyFile}`,
    };
  }

  if (!features.variableSubstitution) {
    aliases = {
      ...aliases,
      './utils/variable-substitution': `./${emptyFile}`,
      '../utils/variable-substitution': `../${emptyFile}`,
    };
  }

  if (!features.m2tsAdvancedCodecs) {
    aliases = {
      ...aliases,
      './ac3-demuxer': `../${emptyFile}`,
      './video/hevc-video-parser': `../${emptyFile}`,
    };
  }

  if (!features.mediaCapabilities) {
    aliases = {
      ...aliases,
      './utils/mediacapabilities-helper': `./${emptyFile}`,
      '../utils/mediacapabilities-helper': `../${emptyFile}`,
    };
  }

  if (!features.contentSteering) {
    aliases = {
      ...aliases,
      './controller/content-steering-controller': `./${emptyFile}`,
      '../controller/content-steering-controller': `../${emptyFile}`,
    };
  }

  if (!features.interstitials) {
    aliases = {
      ...aliases,
      './controller/interstitials-controller': `./${emptyFile}`,
      './controller/interstitial-player': `./${emptyFile}`,
      './controller/interstitials-schedule': `./${emptyFile}`,
      './interstitial-player': `./${emptyFile}`,
      './interstitials-schedule': `./${emptyFile}`,
      './interstitial-event': `./${emptyFile}`,
      '../controller/interstitial-player': `../${emptyFile}`,
      '../controller/interstitials-schedule': `../${emptyFile}`,
      '../loader/interstitial-event': `../${emptyFile}`,
      '../loader/interstitial-asset-list': `../${emptyFile}`,
    };
  }

  if (!features.iframes) {
    aliases = {
      ...aliases,
      './controller/iframe-controller': `./${emptyFile}`,
      './iframe-stream-controller': `./${emptyFile}`,
      './image-iframe-stream-controller': `./${emptyFile}`,
    };
  }

  const featureModules = {
    subtitles: 'subtitles',
    altAudio: 'alt-audio',
    emeDrm: 'eme-drm',
    cmcd: 'cmcd',
    contentSteering: 'content-steering',
    interstitials: 'interstitials',
    iframes: 'iframes',
    mpegTs: 'mpeg-ts',
    capLevel: 'cap-level',
    fps: 'fps',
    metadata: 'metadata',
    latency: 'latency',
    mediaCapabilities: 'media-capabilities',
    variableSubstitution: 'variable-substitution',
  };
  Object.keys(featureModules).forEach((feature) => {
    if (!features[feature]) {
      aliases[`./features/${featureModules[feature]}`] = `./${emptyFile}`;
      aliases[`../features/${featureModules[feature]}`] = `../${emptyFile}`;
    }
  });

  if (!features.iframes) {
    aliases['./iframe-remux'] = `../${emptyFile}`;
    aliases['../features/iframe-remux'] = `../${emptyFile}`;
  }

  // Exported by name from exports-named
  if (!features.capLevel) {
    aliases['./controller/cap-level-controller'] = `./${emptyFile}`;
  }
  if (!features.fps) {
    aliases['./controller/fps-controller'] = `./${emptyFile}`;
  }

  return aliases;
}

const buildRollupConfig = ({
  type,
  minified,
  format,
  allowCircularDeps,
  includeCoverage,
  sourcemap = true,
  outputFile = null,
  input = './src/exports-default.ts',
  outputName = buildTypeToOutputName[type],
  featureSupport = getFeatureSupport(type),
}) => {
  const extension = format === FORMAT.esm ? 'mjs' : 'js';
  const distAliases = getAliasesForDist(format, featureSupport);

  return {
    input,
    onLog: buildOnLog({ allowCircularDeps }),
    output: {
      name: 'Hls',
      file: outputFile
        ? outputFile
        : minified
          ? `./dist/${outputName}.min.${extension}`
          : `./dist/${outputName}.${extension}`,
      format,
      banner: shouldBundleWorker(format) ? workerFnBanner : null,
      footer: shouldBundleWorker(format) ? workerFnFooter : null,
      sourcemap,
      sourcemapFile: minified
        ? `${outputName}.${extension}.min.map`
        : `${outputName}.${extension}.map`,
    },
    plugins: [
      ...basePlugins,
      replace(buildConstants(type, {}, featureSupport)),
      ...(!shouldBundleWorker(format)
        ? [alias({ entries: { './transmuxer-worker': '../empty.js' } })]
        : []),
      ...(Object.keys(distAliases).length
        ? [alias({ entries: distAliases })]
        : []),
      ...(format === 'esm'
        ? [buildBabelEsm({ stripConsole: true })]
        : [buildBabelLegacyBrowsers({ stripConsole: true })]),
      ...(minified ? [terser()] : []),
      ...(includeCoverage
        ? [istanbul({ exclude: ['tests/**/*', 'node_modules/**/*'] })]
        : []),
    ],
  };
};

const coreFeatures = Object.keys(featureCodes);

// Code-split ESM: `core` plus one entry per feature. Feature code is compiled
// in (full flags) but only reaches a client that imports its entry.
const buildCoreRollupConfig = ({ minified }) => {
  const base = buildRollupConfig({
    type: BUILD_TYPE.full,
    format: FORMAT.esm,
    minified,
    input: './src/exports-core.ts',
  });
  const input = { core: './src/exports-core.ts' };
  coreFeatures.forEach((name) => {
    input[`features/${name}`] = `./src/features/${name}.ts`;
  });
  let coreModules;
  return {
    ...base,
    input,
    output: {
      format: FORMAT.esm,
      dir: minified ? './dist/core.min' : './dist/core',
      entryFileNames: '[name].mjs',
      chunkFileNames: 'chunks/[name].mjs',
      sourcemap: true,
      // Everything core loads goes in one chunk: many small chunks compress
      // worse and cost requests. Only feature-only modules stay split.
      manualChunks(id, { getModuleInfo }) {
        if (!coreModules) {
          coreModules = new Set();
          const entry = path.resolve('src/exports-core.ts');
          const visit = (moduleId) => {
            if (coreModules.has(moduleId)) return;
            coreModules.add(moduleId);
            getModuleInfo(moduleId)?.importedIds.forEach(visit);
          };
          visit(entry);
        }
        return coreModules.has(id) ? 'core' : undefined;
      },
    },
  };
};

// Bundle-server loader (src/auto.ts): picks and loads a bundle per stream.
const buildAutoRollupConfig = (format) => {
  const esm = format === FORMAT.esm;
  const base = buildRollupConfig({
    type: BUILD_TYPE.full,
    format,
    minified: true,
    input: esm ? './src/exports-auto.ts' : './src/exports-auto-umd.ts',
    outputName: 'hls.auto',
  });
  return {
    ...base,
    output: { ...base.output, name: 'HlsAuto', banner: null, footer: null },
  };
};

const configs = Object.entries({
  full: buildRollupConfig({
    type: BUILD_TYPE.full,
    format: FORMAT.umd,
    minified: false,
  }),
  fullMin: buildRollupConfig({
    type: BUILD_TYPE.full,
    format: FORMAT.umd,
    minified: true,
  }),
  fullEsm: buildRollupConfig({
    input: './src/exports-named.ts',
    type: BUILD_TYPE.full,
    format: FORMAT.esm,
    minified: false,
  }),
  fullEsmMin: buildRollupConfig({
    input: './src/exports-named.ts',
    type: BUILD_TYPE.full,
    format: FORMAT.esm,
    minified: true,
  }),
  light: buildRollupConfig({
    type: BUILD_TYPE.light,
    format: FORMAT.umd,
    minified: false,
  }),
  lightMin: buildRollupConfig({
    type: BUILD_TYPE.light,
    format: FORMAT.umd,
    minified: true,
  }),
  lightEsm: buildRollupConfig({
    input: './src/exports-named.ts',
    type: BUILD_TYPE.light,
    format: FORMAT.esm,
    minified: false,
  }),
  lightEsmMin: buildRollupConfig({
    input: './src/exports-named.ts',
    type: BUILD_TYPE.light,
    format: FORMAT.esm,
    minified: true,
  }),
  core: buildCoreRollupConfig({ minified: false }),
  coreMin: buildCoreRollupConfig({ minified: true }),
  autoEsm: buildAutoRollupConfig(FORMAT.esm),
  autoUmd: buildAutoRollupConfig(FORMAT.umd),
  worker: {
    input: './src/demux/transmuxer-worker.ts',
    onLog: buildOnLog(),
    output: {
      name: 'HlsWorker',
      file: './dist/hls.worker.js',
      format: FORMAT.iife,
      sourcemap: true,
      sourcemapFile: 'hls.worker.js.map',
    },
    plugins: [
      ...basePlugins,
      replace(
        buildConstants(BUILD_TYPE.full, {
          __IN_WORKER__: JSON.stringify(true),
        }),
      ),
      buildBabelLegacyBrowsers({ stripConsole: true }),
      terser(),
    ],
  },
  demo: {
    input: './demo/main.js',
    onLog: buildOnLog(),
    output: {
      name: 'HlsDemo',
      file: './dist/hls-demo.js',
      format: FORMAT.umd,
      sourcemap: true,
      sourcemapFile: 'hls-demo.js.map',
    },
    watch: {
      clearScreen: false,
    },
    plugins: [
      ...basePlugins,
      replace({
        preventAssignment: true,
        values: {
          __CLOUDFLARE_PAGES__: JSON.stringify(
            env.CF_PAGES
              ? {
                  branch: env.CF_PAGES_BRANCH,
                  commitRef: env.CF_PAGES_COMMIT_SHA,
                }
              : null,
          ),
        },
      }),
      buildBabelLegacyBrowsers({ stripConsole: false }),
    ],
  },
});

module.exports = {
  BUILD_TYPE,
  FORMAT,
  configs,
  buildRollupConfig,
};
