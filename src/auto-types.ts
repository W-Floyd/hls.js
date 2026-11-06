// Public types of the auto loader, shipped as dist/hls.auto.d.ts. They import
// from the package itself so they share hls.js's Hls class: it has private
// members, so a copy would not be assignable to it.
import type Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';

/** An optional hls.js feature, as named in the bundle server's /features. */
export type AutoFeature =
  | 'mpeg-ts'
  | 'subtitles'
  | 'alt-audio'
  | 'eme-drm'
  | 'cmcd'
  | 'interstitials'
  | 'content-steering'
  | 'iframes'
  | 'metadata'
  | 'latency'
  | 'cap-level'
  | 'fps'
  | 'media-capabilities'
  | 'variable-substitution'
  | 'progressive'
  | 'aes'
  | 'abr'
  | 'worker';

/** Options for {@link attach}, {@link loadHls} and {@link detectFeatures}. */
export type AutoOptions = {
  /**
   * Bundle server base URL. Defaults to the URL this loader was loaded from,
   * so it is required when the loader is bundled from npm.
   */
  cdn?: string;
  /** Features to include whatever the stream declares. */
  features?: AutoFeature[];
  /** Use the browser's own HLS playback when available. Default `true`. */
  native?: boolean;
  /**
   * Load core and each needed feature as separate ES modules from a split
   * build instead of one bundle: more requests, but shared and cached across
   * feature sets. A URL is a directory holding the split build (`core.mjs`,
   * `features/`, `chunks/`, i.e. `dist/core.min`), e.g. vendored as static
   * files; `true` uses the bundle server's copy (`cdn`). ES module loader only;
   * the classic-script loader always loads a bundle.
   */
  split?: string | boolean;
  /**
   * Passed to the Hls constructor. Some options also select features, e.g.
   * `cmcd`, `drmSystems`, `capLevelToPlayerSize`.
   */
  config?: Partial<HlsConfig>;
};

/** A playlist fetched during detection: its final URL and its text. */
export type AutoPlaylist = { url: string; text: string };

/** Result of {@link detectFeatures}. */
export type DetectedFeatures = {
  /** Needed features, in the bundle server's order. */
  features: AutoFeature[];
  /** Playlists fetched to decide, keyed by request URL. */
  playlists: Map<string, AutoPlaylist>;
};

/** Result of {@link loadHls}. */
export type LoadedHls = {
  /** Hls from the bundle holding exactly `features`, or split-build core. */
  Hls: typeof Hls;
  features: AutoFeature[];
  /**
   * `options.config`, plus a playlist loader that reuses detection's fetches
   * and, in split mode, the features' config. Pass it to `new Hls()`.
   */
  config: Partial<HlsConfig>;
};
