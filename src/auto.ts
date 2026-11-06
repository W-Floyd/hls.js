/**
 * Loads the smallest hls.js bundle a stream needs from a bundle server
 * (cdn/server.js), or uses the browser's own HLS playback when it has it.
 *
 * Needs are read from the multivariant playlist, its first media playlist and
 * the config; both playlists are then handed to hls.js so they aren't fetched
 * twice. Features a stream only reveals later (e.g. a key in a later segment,
 * undeclared in-band captions) must be listed in `features`.
 *
 * No `async` or `class` syntax: the classic-script build targets browsers
 * without them, and a transpiled subclass of the bundle's native loader class
 * would throw.
 */
import type {
  AutoFeature,
  AutoOptions,
  AutoPlaylist,
  DetectedFeatures,
  LoadedHls,
} from './auto-types';
import type { PlaylistLoaderConstructor } from './config';
import type codes from './features/codes.json';
import type {
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
} from './types/loader';
import type Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';

// Both fail to compile when AutoFeature and src/features/codes.json disagree.
const CODES: Record<AutoFeature, string> = __FEATURE_CODES__ as typeof codes;
const ORDER: AutoFeature[] = Object.keys(CODES) as (keyof typeof codes)[];

type HlsClass = typeof Hls;
type Playlist = AutoPlaylist;

const ATTRIBUTE = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

function attributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTRIBUTE.lastIndex = 0;
  while ((match = ATTRIBUTE.exec(line))) {
    result[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return result;
}

const tagLines = (text: string, tag: string) =>
  text.split(/\r?\n/).filter((line) => line.indexOf(`#${tag}:`) === 0);

// Key systems other than clear-key need EME; clear-key (identity) keys need
// the aes feature.
function addKeyFeature(line: string, found: Set<string>) {
  const { METHOD, KEYFORMAT } = attributes(line);
  if (METHOD === 'NONE') return;
  if (
    (!!KEYFORMAT && KEYFORMAT !== 'identity') ||
    METHOD === 'SAMPLE-AES-CTR' ||
    METHOD === 'SAMPLE-AES-CENC'
  ) {
    found.add('eme-drm');
  } else if (/^AES-(128|256)|^SAMPLE-AES$/.test(METHOD)) {
    found.add('aes');
  }
}

function scanMultivariant(text: string, found: Set<string>) {
  tagLines(text, 'EXT-X-MEDIA').forEach((line) => {
    const { TYPE, URI } = attributes(line);
    if (TYPE === 'SUBTITLES' || TYPE === 'CLOSED-CAPTIONS') {
      found.add('subtitles');
    } else if (TYPE === 'AUDIO' && URI) {
      found.add('alt-audio');
    }
  });
  tagLines(text, 'EXT-X-SESSION-KEY').forEach((line) =>
    addKeyFeature(line, found),
  );
  if (tagLines(text, 'EXT-X-CONTENT-STEERING').length) {
    found.add('content-steering');
  }
  if (tagLines(text, 'EXT-X-DEFINE').length) {
    found.add('variable-substitution');
  }
}

function scanMedia(text: string, found: Set<string>) {
  // fMP4 always has EXT-X-MAP; segments without one are MPEG-TS or packed audio.
  if (text.indexOf('#EXTINF') !== -1 && text.indexOf('#EXT-X-MAP') === -1) {
    found.add('mpeg-ts');
  }
  tagLines(text, 'EXT-X-KEY').forEach((line) => addKeyFeature(line, found));
  const dateRanges = tagLines(text, 'EXT-X-DATERANGE');
  if (dateRanges.length) found.add('metadata');
  if (
    dateRanges.some(
      (line) => attributes(line).CLASS === 'com.apple.hls.interstitial',
    )
  ) {
    found.add('interstitials');
  }
  if (
    text.indexOf('#EXT-X-ENDLIST') === -1 ||
    text.indexOf('#EXT-X-PART-INF') !== -1
  ) {
    found.add('latency');
  }
  if (tagLines(text, 'EXT-X-DEFINE').length) {
    found.add('variable-substitution');
  }
}

function scanConfig(config: Partial<HlsConfig>, found: Set<string>) {
  if (config.cmcd) found.add('cmcd');
  if (config.capLevelToPlayerSize) found.add('cap-level');
  if (config.capLevelOnFPSDrop) found.add('fps');
  if (config.useMediaCapabilities) found.add('media-capabilities');
  if (config.progressive) found.add('progressive');
  if (
    config.emeEnabled ||
    config.widevineLicenseUrl ||
    Object.keys(config.drmSystems || {}).length
  ) {
    found.add('eme-drm');
  }
}

function fetchText(url: string): Promise<Playlist> {
  return self.fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`${response.status} loading ${url}`);
    }
    return response.text().then((text) => ({ url: response.url || url, text }));
  });
}

const absolute = (url: string, base?: string) =>
  new URL(url, base || self.location.href).href;

/**
 * Features the stream at `src` needs (ordered as in /features), and the
 * playlists fetched to find out, keyed by request URL. If the manifest can't
 * be loaded, only option- and config-derived features are returned and hls.js
 * reports the error itself.
 */
export function detectFeatures(
  src: string,
  options: AutoOptions = {},
): Promise<DetectedFeatures> {
  const found = new Set<string>(options.features || []);
  const playlists = new Map<string, Playlist>();
  scanConfig(options.config || {}, found);
  const mainUrl = absolute(src);
  return fetchText(mainUrl)
    .then((main) => {
      playlists.set(mainUrl, main);
      if (main.text.indexOf('#EXT-X-STREAM-INF') === -1) {
        scanMedia(main.text, found);
        return;
      }
      scanMultivariant(main.text, found);
      const lines = main.text.split(/\r?\n/);
      const index = lines.findIndex(
        (line) => line.indexOf('#EXT-X-STREAM-INF') === 0,
      );
      const uri = lines
        .slice(index + 1)
        .find((line) => line.trim() && line[0] !== '#');
      if (!uri) return;
      const mediaUrl = absolute(uri.trim(), main.url);
      return fetchText(mediaUrl).then(
        (media) => {
          playlists.set(mediaUrl, media);
          scanMedia(media.text, found);
        },
        // Can't tell the container; MPEG-TS support is the safe choice.
        () => found.add('mpeg-ts'),
      );
    })
    .catch(() => {})
    .then(() => ({
      features: ORDER.filter((feature) => found.has(feature)),
      playlists,
    }));
}

// Answers requests for already-fetched playlists, once each, and delegates
// everything else to the configured loader.
function prefetchedLoader(
  Base: new (config: HlsConfig) => Loader<LoaderContext>,
  playlists: Map<string, Playlist>,
) {
  return function PrefetchedLoader(config: HlsConfig) {
    const inner = new Base(config);
    let context: LoaderContext | null = null;
    return {
      get stats() {
        return inner.stats;
      },
      get context() {
        return context || inner.context;
      },
      load(
        loadContext: LoaderContext,
        loadConfig: LoaderConfiguration,
        callbacks: LoaderCallbacks<LoaderContext>,
      ) {
        const hit = playlists.get(loadContext.url);
        if (!hit) {
          inner.load(loadContext, loadConfig, callbacks);
          return;
        }
        playlists.delete(loadContext.url);
        context = loadContext;
        const { stats } = inner;
        const now = self.performance.now();
        stats.loading.start = stats.loading.first = stats.loading.end = now;
        stats.parsing.start = now;
        stats.loaded = stats.total = hit.text.length;
        // Async like a real response, so callers finish setting up first.
        self.setTimeout(() => {
          if (context) {
            callbacks.onSuccess(
              { url: hit.url, data: hit.text, code: 200 },
              stats,
              loadContext,
              null,
            );
          }
        });
      },
      abort() {
        context = null;
        inner.abort();
      },
      destroy() {
        context = null;
        inner.destroy();
      },
      getCacheAge: () => (inner.getCacheAge ? inner.getCacheAge() : null),
      getResponseHeader: (name: string) =>
        inner.getResponseHeader ? inner.getResponseHeader(name) : null,
    };
  } as unknown as PlaylistLoaderConstructor;
}

export function createAuto(defaultCdn: string, format: 'esm' | 'iife') {
  const loadBundle = (url: string): Promise<HlsClass> =>
    format === 'esm'
      ? import(/* webpackIgnore: true */ /* @vite-ignore */ url).then(
          (module: { default: HlsClass }) => module.default,
        )
      : new Promise((resolve, reject) => {
          const script = self.document.createElement('script');
          script.src = url;
          script.onload = () =>
            resolve((self as unknown as { Hls: HlsClass }).Hls);
          script.onerror = () => reject(new Error(`Failed to load ${url}`));
          self.document.head.appendChild(script);
        });

  /**
   * The Hls class for `src` from the bundle server, with a config that
   * reuses the playlists fetched during detection.
   */
  function loadHls(src: string, options: AutoOptions = {}): Promise<LoadedHls> {
    return detectFeatures(src, options).then(({ features, playlists }) => {
      const codes = features.map((feature) => CODES[feature]);
      const base = (options.cdn || defaultCdn).replace(/\/?$/, '/');
      const name = `hls-${codes.join('-') || 'core'}.min.${format === 'esm' ? 'mjs' : 'js'}`;
      return loadBundle(base + name).then((HlsBundle) => {
        const config: Partial<HlsConfig> = { ...options.config };
        if (!config.pLoader && playlists.size) {
          config.pLoader = prefetchedLoader(
            config.loader || HlsBundle.DefaultConfig.loader,
            playlists,
          );
        }
        return { Hls: HlsBundle, features, config };
      });
    });
  }

  /**
   * Plays `src` in `media`: natively when the browser supports HLS (resolves
   * null), otherwise with an Hls instance built from the bundle `src` needs.
   */
  function attach(
    media: HTMLMediaElement,
    src: string,
    options: AutoOptions = {},
  ): Promise<Hls | null> {
    if (
      options.native !== false &&
      media.canPlayType('application/vnd.apple.mpegurl')
    ) {
      media.src = src;
      return Promise.resolve(null);
    }
    return loadHls(src, options).then(({ Hls: HlsBundle, config }) => {
      const hls = new HlsBundle(config);
      hls.loadSource(src);
      hls.attachMedia(media);
      return hls;
    });
  }

  return { attach, loadHls, detectFeatures };
}
