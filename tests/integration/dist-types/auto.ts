import { attach, detectFeatures, loadHls } from 'hls.js/auto';
import type Hls from 'hls.js';
import type { AutoFeature, AutoOptions } from 'hls.js/auto';

const options: AutoOptions = {
  cdn: 'https://cdn.example/',
  features: ['subtitles', 'mpeg-ts'],
  config: { lowLatencyMode: false },
};

// @ts-expect-error unknown feature names are rejected
const misspelt: AutoFeature = 'subtitle';

const video = document.createElement('video');

// The loader's Hls is the package's Hls, not a structurally separate copy.
const fromAttach: Promise<Hls | null> = attach(video, '/live.m3u8', options);

loadHls('/live.m3u8', options).then(({ Hls: HlsBundle, features, config }) => {
  const hls: Hls = new HlsBundle(config);
  const first: AutoFeature | undefined = features[0];
  return { hls, first };
});

detectFeatures('/live.m3u8').then(({ features, playlists }) =>
  playlists.forEach(({ url, text }, requested) =>
    console.log(features.length, url, text.length, requested),
  ),
);

export { fromAttach, misspelt };
