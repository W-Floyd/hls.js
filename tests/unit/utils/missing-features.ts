import { expect } from 'chai';
import { hlsCoreConfig } from '../../../src/config';
import { Events } from '../../../src/events';
import M3U8Parser from '../../../src/loader/m3u8-parser';
import { PlaylistLevelType } from '../../../src/types/loader';
import {
  createDecrypter,
  featureHooks,
  isMissingFeatureError,
  noDecrypterError,
} from '../../../src/utils/feature-hooks';
import { warnMissingFeatures } from '../../../src/utils/missing-features';
import type { HlsConfig } from '../../../src/config';
import type Hls from '../../../src/hls';

const multivariant = `#EXTM3U
#EXT-X-DEFINE:NAME="host",VALUE="cdn.test"
#EXT-X-STREAM-INF:BANDWIDTH=1000000
https://{$host}/video.m3u8`;
const media = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-DEFINE:NAME="seg",VALUE="s0"
#EXTINF:6,
{$seg}.m4s
#EXT-X-ENDLIST`;

type Hooks = Partial<typeof featureHooks>;
const allHooks: Hooks = { ...featureHooks };
const withoutHook = (name: keyof typeof featureHooks): Hooks => ({
  ...allHooks,
  [name]: undefined,
});

// Features a stream can't play without: a MissingFeatureError, raised fatal.
const required: {
  name: string;
  hooks: Hooks;
  missing: (() => Error | null | undefined)[];
}[] = [
  {
    name: 'playlist variables need variable-substitution',
    hooks: withoutHook('variableSubstitution'),
    missing: [
      () =>
        M3U8Parser.parseMasterPlaylist(multivariant, 'https://a.test/')
          .playlistParsingError,
      () =>
        M3U8Parser.parseLevelPlaylist(
          media,
          'https://a.test/v.m3u8',
          0,
          PlaylistLevelType.MAIN,
          0,
          null,
        ).playlistParsingError,
    ],
  },
  {
    name: 'AES-128 needs aes',
    hooks: withoutHook('decrypter'),
    missing: [
      // As the call sites do: no decrypter means noDecrypterError().
      () => (createDecrypter(hlsCoreConfig) ? null : noDecrypterError()),
    ],
  },
];

// Optional features: warned about once, playback continues.
const optional: {
  name: string;
  userConfig?: Partial<HlsConfig>;
  config?: Partial<HlsConfig>;
  events?: [Events, any][];
  warnings: string[];
}[] = [
  {
    name: 'nothing used, nothing warned',
    userConfig: {},
    events: [
      [
        Events.MANIFEST_LOADED,
        { audioTracks: [], iframeVariants: [], contentSteering: null },
      ],
    ],
    warnings: [],
  },
  {
    name: 'config options of absent features',
    userConfig: {
      cmcd: {},
      capLevelToPlayerSize: true,
      capLevelOnFPSDrop: true,
      useMediaCapabilities: true,
      emeEnabled: true,
    },
    warnings: ['cmcd', 'cap-level', 'fps', 'media-capabilities', 'eme-drm'],
  },
  {
    name: 'present features are not warned about',
    userConfig: { cmcd: {} },
    config: { cmcdController: function () {} as any },
    warnings: [],
  },
  {
    name: 'manifest renditions, once each',
    events: [
      [
        Events.MANIFEST_LOADED,
        {
          subtitles: [{}],
          audioTracks: [{ url: 'a.m3u8' }],
          contentSteering: { uri: 's.json' },
          iframeVariants: [{}],
        },
      ],
      [
        Events.MANIFEST_LOADED,
        { subtitles: [{}], audioTracks: [], iframeVariants: [] },
      ],
    ],
    warnings: ['subtitles', 'alt-audio', 'content-steering', 'iframes'],
  },
  {
    name: 'live, date ranges and interstitials',
    events: [
      [
        Events.LEVEL_LOADED,
        {
          details: {
            live: true,
            dateRanges: { ad: { isInterstitial: true } },
          },
        },
      ],
    ],
    warnings: ['latency', 'metadata', 'interstitials'],
  },
];

describe('missing features', function () {
  afterEach(function () {
    Object.assign(featureHooks, allHooks);
  });

  required.forEach(({ name, hooks, missing }) => {
    it(`${name}: fails with MissingFeatureError`, function () {
      Object.assign(featureHooks, hooks);
      missing.forEach((run) => expect(isMissingFeatureError(run())).to.be.true);
      Object.assign(featureHooks, allHooks);
      missing.forEach(
        (run) => expect(isMissingFeatureError(run())).to.be.false,
      );
    });
  });

  optional.forEach(
    ({ name, userConfig = {}, config = {}, events = [], warnings }) => {
      it(`${name}: warns once per optional feature`, function () {
        const warned: string[] = [];
        const handlers: Record<string, (event: Events, data: any) => void> = {};
        const hls = {
          config,
          userConfig,
          logger: {
            warn: (message: string) =>
              warned.push(/needs the (\S+) feature/.exec(message)![1]),
          },
          on: (event: Events, handler: (event: Events, data: any) => void) => {
            handlers[event] = handler;
          },
        } as unknown as Hls;
        warnMissingFeatures(hls);
        events.forEach(([event, data]) => handlers[event]?.(event, data));
        expect(warned).to.deep.equal(warnings);
      });
    },
  );
});
