import type * as Mp4Captions from './mp4-captions';
import type { HlsConfig } from '../config';
import type { extractEmsgSamples } from './mp4-emsg';
import type { videoOnlyInitSegment } from './mp4-iframes';
import type * as VariableSubstitution from './variable-substitution';
import type Decrypter from '../crypt/decrypter';
import type { loadKeyHTTP } from '../loader/key-loader-http';
import type { remuxIFrameFragment } from '../remux/passthrough-iframes';

// Implementations for modules without config access (static parsers, code that
// may run in the transmux worker), set by importing the feature providing them.
export const featureHooks: {
  variableSubstitution?: typeof VariableSubstitution;
  decrypter?: typeof Decrypter;
  loadKeyHTTP?: typeof loadKeyHTTP;
  emsg?: { extractEmsgSamples: typeof extractEmsgSamples };
  mp4Captions?: Pick<
    typeof Mp4Captions,
    'isSEIMessage' | 'parseSamples' | 'parseSEIMessageFromNALu'
  >;
  iframeRemux?: {
    videoOnlyInitSegment: typeof videoOnlyInitSegment;
    remuxIFrameFragment: typeof remuxIFrameFragment;
  };
} = {};

/**
 * A decrypter for AES-128/AES-256 segments, or null without the aes feature;
 * callers report that as a decrypt error.
 */
export function createDecrypter(config: HlsConfig): Decrypter | null {
  const AesDecrypter = __USE_AES__ && featureHooks.decrypter;
  return AesDecrypter ? new AesDecrypter(config) : null;
}

export const hasDecrypter = () => !!(__USE_AES__ && featureHooks.decrypter);

/**
 * For a stream this build can't play without `feature`; raised as fatal.
 * Optional features the stream could use are only warned about
 * (see missing-features.ts).
 */
export function missingFeatureError(feature: string, need: string): Error {
  const error = new Error(`${need} needs the ${feature} feature`);
  error.name = 'MissingFeatureError';
  return error;
}

export const isMissingFeatureError = (error: Error | null | undefined) =>
  error?.name === 'MissingFeatureError';

export const noDecrypterError = () =>
  missingFeatureError(
    'aes',
    'Clear-key (AES-128, AES-256, SAMPLE-AES) decryption',
  );

// {$name} references only resolve with the variable-substitution feature.
export const unresolvedVariablesError = (text: string) =>
  !(__USE_VARIABLE_SUBSTITUTION__ && featureHooks.variableSubstitution) &&
  text.indexOf('{$') !== -1
    ? missingFeatureError(
        'variable-substitution',
        'Playlist variables ({$name})',
      )
    : null;
