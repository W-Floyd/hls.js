import { createAuto, loadSplit as loadSplitBuild } from './auto';
import type {
  AutoFeature,
  AutoOptions,
  DetectedFeatures,
  LoadedHls,
} from './auto-types';
import type Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';

export type {
  AutoFeature,
  AutoOptions,
  AutoPlaylist,
  DetectedFeatures,
  LoadedHls,
} from './auto-types';

const auto = createAuto(new URL('.', import.meta.url).href, 'esm');

/**
 * Plays `src` in `media`: natively when the browser supports HLS (resolves
 * `null`), otherwise with an Hls instance from the bundle `src` needs,
 * already loading `src` and attached to `media`.
 */
export const attach: (
  media: HTMLMediaElement,
  src: string,
  options?: AutoOptions,
) => Promise<Hls | null> = auto.attach;

/**
 * Detects what `src` needs and loads the matching Hls bundle from the bundle
 * server, with a config that reuses the playlists fetched to decide.
 */
export const loadHls: (
  src: string,
  options?: AutoOptions,
) => Promise<LoadedHls> = auto.loadHls;

/**
 * Features `src` needs, from its multivariant playlist, first media playlist
 * and `options`. If the manifest can't be loaded, only option- and
 * config-derived features are returned and hls.js reports the error itself.
 */
export const detectFeatures: (
  src: string,
  options?: AutoOptions,
) => Promise<DetectedFeatures> = auto.detectFeatures;

/**
 * Core plus `features` from a split build directory (`core.mjs`, `features/`,
 * `chunks/`, i.e. `dist/core.min`), with no detection: the Hls class and the
 * features' config to pass to `new Hls()`.
 */
export const loadSplit: (
  base: string,
  features: AutoFeature[],
) => Promise<{ Hls: typeof Hls; config: Partial<HlsConfig> }> = loadSplitBuild;
