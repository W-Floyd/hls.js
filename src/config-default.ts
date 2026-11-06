import { hlsCoreConfig } from './config';
import { abr } from './features/abr';
import { aes } from './features/aes';
import { altAudio } from './features/alt-audio';
import { capLevel } from './features/cap-level';
import { cmcd } from './features/cmcd';
import { contentSteering } from './features/content-steering';
import { emeDrm } from './features/eme-drm';
import { fps } from './features/fps';
import { iframes } from './features/iframes';
import { interstitials } from './features/interstitials';
import { latency } from './features/latency';
import { mediaCapabilities } from './features/media-capabilities';
import { metadata } from './features/metadata';
import { mpegTs } from './features/mpeg-ts';
import { progressive } from './features/progressive';
import { subtitles } from './features/subtitles';
import { variableSubstitution } from './features/variable-substitution';
import type { HlsConfig } from './config';

/**
 * @ignore
 * Core defaults plus every feature enabled for this build.
 */
export const hlsDefaultConfig: HlsConfig = {
  ...hlsCoreConfig,
  ...(__USE_CAP_LEVEL__ ? capLevel : undefined),
  ...(__USE_FPS__ ? fps : undefined),
  ...(__USE_METADATA__ ? metadata : undefined),
  ...(__USE_LATENCY__ ? latency : undefined),
  ...(__USE_MPEG_TS__ ? mpegTs : undefined),
  ...(__USE_MEDIA_CAPABILITIES__ ? mediaCapabilities : undefined),
  ...(__USE_SUBTITLES__ ? subtitles : undefined),
  ...(__USE_VARIABLE_SUBSTITUTION__ ? variableSubstitution : undefined),
  ...(__USE_ALT_AUDIO__ ? altAudio : undefined),
  ...(__USE_EME_DRM__ ? emeDrm : undefined),
  ...(__USE_CMCD__ ? cmcd : undefined),
  ...(__USE_CONTENT_STEERING__ ? contentSteering : undefined),
  ...(__USE_IFRAMES__ ? iframes : undefined),
  ...(__USE_INTERSTITIALS__ ? interstitials : undefined),
  ...(__USE_PROGRESSIVE__ ? progressive : undefined),
  ...(__USE_AES__ ? aes : undefined),
  ...(__USE_ABR__ ? abr : undefined),
};
