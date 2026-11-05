import {
  getMediaDecodingInfoPromise,
  requiresMediaCapabilitiesDecodingInfo,
} from '../utils/mediacapabilities-helper';
import type { HlsConfig } from '../config';

export const mediaCapabilities: Partial<HlsConfig> = {
  mediaDecodingInfo: {
    requiresMediaCapabilitiesDecodingInfo,
    getMediaDecodingInfoPromise,
  },
};
