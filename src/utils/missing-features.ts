import { Events } from '../events';
import type Hls from '../hls';
import type { ManifestLoadedData } from '../types/events';

/**
 * Warns once per feature when the config or stream uses an optional feature
 * this build leaves out; playback continues without it. Features a stream
 * can't play without raise fatal errors instead (missingFeatureError).
 */
export function warnMissingFeatures(hls: Hls) {
  const { config, userConfig, logger } = hls;
  const warned: Record<string, true> = {};
  const check = (missing: unknown, feature: string, use: string) => {
    if (missing && !warned[feature]) {
      warned[feature] = true;
      logger.warn(`${use} ignored: it needs the ${feature} feature`);
    }
  };
  // userConfig, not config: some defaults (useMediaCapabilities) are on even
  // where the feature is absent.
  check(userConfig.cmcd && !config.cmcdController, 'cmcd', 'cmcd config');
  check(
    userConfig.capLevelToPlayerSize && !config.capLevelController,
    'cap-level',
    'capLevelToPlayerSize',
  );
  check(
    userConfig.capLevelOnFPSDrop && !config.fpsController,
    'fps',
    'capLevelOnFPSDrop',
  );
  check(
    userConfig.useMediaCapabilities && !config.mediaDecodingInfo,
    'media-capabilities',
    'useMediaCapabilities',
  );
  check(
    userConfig.emeEnabled && !config.emeController,
    'eme-drm',
    'emeEnabled',
  );
  hls.on(Events.MANIFEST_LOADED, (_, data: ManifestLoadedData) => {
    check(
      (data.subtitles?.length || data.captions?.length) &&
        !config.timelineController,
      'subtitles',
      'Subtitle and caption renditions',
    );
    check(
      data.audioTracks.some((track) => track.url) &&
        !config.audioStreamController,
      'alt-audio',
      'Alternate audio renditions',
    );
    check(
      data.contentSteering && !config.contentSteeringController,
      'content-steering',
      'EXT-X-CONTENT-STEERING',
    );
    check(
      data.iframeVariants.length && !config.iframeController,
      'iframes',
      'I-frame variants',
    );
  });
  hls.on(Events.LEVEL_LOADED, (_, { details }) => {
    check(details.live && !config.latencyController, 'latency', 'Live sync');
    const dateRanges = Object.keys(details.dateRanges).map(
      (id) => details.dateRanges[id],
    );
    check(
      dateRanges.length && !config.id3TrackController,
      'metadata',
      'EXT-X-DATERANGE metadata',
    );
    check(
      dateRanges.some((dateRange) => dateRange?.isInterstitial) &&
        !config.interstitialsController,
      'interstitials',
      'Interstitials',
    );
  });
}
