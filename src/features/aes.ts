import './aes-decrypter';
import { loadKeyHTTP } from '../loader/key-loader-http';
import { featureHooks } from '../utils/feature-hooks';
import type { HlsConfig } from '../config';

featureHooks.loadKeyHTTP = loadKeyHTTP;

/**
 * Clear-key decryption (`EXT-X-KEY` without a KEYFORMAT): key loading and
 * AES-128/AES-256 segment decryption. MPEG-TS SAMPLE-AES also needs mpeg-ts.
 */
export const aes: Partial<HlsConfig> = {};
