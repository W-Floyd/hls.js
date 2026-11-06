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
  | 'abr';

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
  /** Hls from the bundle holding exactly `features`. */
  Hls: typeof Hls;
  features: AutoFeature[];
  /** `options.config`, plus a playlist loader that reuses detection's fetches. */
  config: Partial<HlsConfig>;
};
