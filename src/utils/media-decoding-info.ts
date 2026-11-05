export type MediaDecodingInfo = {
  supported: boolean;
  configurations: readonly MediaDecodingConfiguration[];
  decodingInfoResults: readonly MediaCapabilitiesDecodingInfo[];
  error?: Error;
};

// @ts-ignore
const supportedResult: MediaCapabilitiesDecodingInfo = {
  supported: true,
  powerEfficient: true,
  smooth: true,
  // keySystemAccess: null,
};

// @ts-ignore
const unsupportedResult: MediaCapabilitiesDecodingInfo = {
  supported: false,
  smooth: false,
  powerEfficient: false,
  // keySystemAccess: null,
};

export const SUPPORTED_INFO_DEFAULT: MediaDecodingInfo = {
  supported: true,
  configurations: [] as MediaDecodingConfiguration[],
  decodingInfoResults: [supportedResult],
} as const;

export function getUnsupportedResult(
  error: Error,
  configurations: MediaDecodingConfiguration[],
): MediaDecodingInfo {
  return {
    supported: false,
    configurations,
    decodingInfoResults: [unsupportedResult],
    error,
  };
}

export function estimatedAudioBitrate(
  audioCodec: string | undefined,
  levelBitrate: number,
): number {
  if (levelBitrate <= 1) {
    return 1;
  }
  let audioBitrate = 128000;
  if (audioCodec === 'ec-3') {
    audioBitrate = 768000;
  } else if (audioCodec === 'ac-3') {
    audioBitrate = 640000;
  }
  return Math.min(levelBitrate / 2, audioBitrate); // Don't exceed some % of level bitrate
}
