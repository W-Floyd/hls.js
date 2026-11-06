import { expect } from 'chai';
import sinon from 'sinon';
import { detectFeatures } from '../../src/auto';
import type { AutoOptions } from '../../src/auto-types';

const BASE = 'https://cdn.test/stream/';
const fmp4Vod = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6,
seg0.m4s
#EXT-X-ENDLIST`;
const tsVod = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6,
seg0.ts
#EXT-X-ENDLIST`;
const multivariant = (tags: string) => `#EXTM3U
${tags}
#EXT-X-STREAM-INF:BANDWIDTH=1000000
video/index.m3u8`;

type Row = {
  name: string;
  // URL path under BASE -> playlist text; a missing path responds 404.
  playlists: Record<string, string>;
  options?: AutoOptions;
  features: string[];
};

const rows: Row[] = [
  {
    name: 'fMP4 VOD needs nothing',
    playlists: { 'index.m3u8': fmp4Vod },
    features: [],
  },
  {
    name: 'segments without EXT-X-MAP are MPEG-TS',
    playlists: { 'index.m3u8': tsVod },
    features: ['mpeg-ts'],
  },
  {
    name: 'live and LL-HLS need latency',
    playlists: {
      'index.m3u8': fmp4Vod.replace(
        '#EXT-X-ENDLIST',
        '#EXT-X-PART-INF:PART-TARGET=1',
      ),
    },
    features: ['latency'],
  },
  {
    name: 'subtitles and alternate audio renditions',
    playlists: {
      'index.m3u8': multivariant(
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="en",URI="s/en.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="a/en.m3u8"',
      ),
      'video/index.m3u8': fmp4Vod,
    },
    features: ['subtitles', 'alt-audio'],
  },
  {
    name: 'audio renditions without URI and AES-128 keys stay in core',
    playlists: {
      'index.m3u8': multivariant(
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="main"',
      ),
      'video/index.m3u8': fmp4Vod.replace(
        '#EXTINF',
        '#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF',
      ),
    },
    features: [],
  },
  {
    name: 'session keys, steering and variable definitions',
    playlists: {
      'index.m3u8': multivariant(
        '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXT-X-CONTENT-STEERING:SERVER-URI="s.json"\n#EXT-X-DEFINE:NAME="v",VALUE="1"',
      ),
      'video/index.m3u8': fmp4Vod,
    },
    features: ['eme-drm', 'content-steering', 'variable-substitution'],
  },
  {
    name: 'interstitial date ranges',
    playlists: {
      'index.m3u8': fmp4Vod.replace(
        '#EXTINF',
        '#EXT-X-DATERANGE:ID="ad",CLASS="com.apple.hls.interstitial",START-DATE="2020-01-01T00:00:00Z"\n#EXTINF',
      ),
    },
    features: ['interstitials', 'metadata'],
  },
  {
    name: 'other date ranges only need metadata',
    playlists: {
      'index.m3u8': fmp4Vod.replace(
        '#EXTINF',
        '#EXT-X-DATERANGE:ID="x",START-DATE="2020-01-01T00:00:00Z"\n#EXTINF',
      ),
    },
    features: ['metadata'],
  },
  {
    name: 'options and config add features in standard order',
    playlists: { 'index.m3u8': fmp4Vod },
    options: {
      features: ['fps', 'subtitles'],
      config: {
        cmcd: {},
        progressive: true,
        drmSystems: { 'com.widevine.alpha': { licenseUrl: 'https://l.test' } },
      },
    },
    features: ['subtitles', 'eme-drm', 'cmcd', 'fps', 'progressive'],
  },
  {
    name: 'an unreadable media playlist assumes MPEG-TS',
    playlists: { 'index.m3u8': multivariant('') },
    features: ['mpeg-ts'],
  },
  {
    name: 'an unreadable manifest keeps option features only',
    playlists: {},
    options: { features: ['subtitles'] },
    features: ['subtitles'],
  },
];

describe('auto detectFeatures', function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  rows.forEach(({ name, playlists, options, features }) => {
    it(name, function () {
      sandbox.stub(self, 'fetch').callsFake((input) => {
        const url = String(input);
        const text = playlists[url.slice(BASE.length)];
        return Promise.resolve(
          text === undefined
            ? new Response('', { status: 404 })
            : new Response(text, { status: 200 }),
        );
      });
      return detectFeatures(`${BASE}index.m3u8`, options).then((result) => {
        expect(result.features).to.deep.equal(features);
        // Every playlist that loaded is kept for reuse, keyed by request URL.
        const loaded = Object.keys(playlists)
          .map((path) => BASE + path)
          .filter((url) => Array.from(result.playlists.keys()).includes(url));
        expect(Array.from(result.playlists.keys())).to.deep.equal(loaded);
        result.playlists.forEach(({ text }, url) =>
          expect(text).to.equal(playlists[url.slice(BASE.length)]),
        );
      });
    });
  });
});
