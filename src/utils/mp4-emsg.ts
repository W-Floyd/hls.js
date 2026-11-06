// emsg ID3/KLV timed metadata; the metadata feature installs it as
// featureHooks.emsg.
import { findBox, readCString, readUint32 } from './mp4-tools';
import { MetadataSchema } from '../types/demuxer';
import { logger } from '../utils/logger';
import type { HlsConfig } from '../config';
import type { MetadataSample } from '../types/demuxer';

const emsgSchemePattern = /\/emsg[-/]ID3/i;

export interface IEmsgParsingData {
  schemeIdUri: string;
  value: string;
  timeScale: number;
  presentationTimeDelta?: number;
  presentationTime?: number;
  eventDuration: number;
  id: number;
  payload: Uint8Array;
}

export function extractEmsgSamples(
  data: Uint8Array,
  timeOffset: number,
  config: Pick<HlsConfig, 'enableEmsgKLVMetadata' | 'emsgKLVSchemaUri'>,
  samples: MetadataSample[],
) {
  const emsgs = findBox(data, ['emsg']);
  if (emsgs) {
    emsgs.forEach((data: Uint8Array) => {
      const emsgInfo = parseEmsg(data);
      if (emsgSchemePattern.test(emsgInfo.schemeIdUri)) {
        const pts = getEmsgStartTime(emsgInfo, timeOffset);
        let duration =
          emsgInfo.eventDuration === 0xffffffff
            ? Number.POSITIVE_INFINITY
            : emsgInfo.eventDuration / emsgInfo.timeScale;
        // Safari takes anything <= 0.001 seconds and maps it to Infinity
        if (duration <= 0.001) {
          duration = Number.POSITIVE_INFINITY;
        }
        const payload = emsgInfo.payload;
        samples.push({
          data: payload,
          len: payload.byteLength,
          dts: pts,
          pts: pts,
          type: MetadataSchema.emsg,
          duration: duration,
        });
      } else if (config.enableEmsgKLVMetadata) {
        const klvSchemaUri = config.emsgKLVSchemaUri || MetadataSchema.misbklv;
        if (emsgInfo.schemeIdUri.startsWith(klvSchemaUri)) {
          const pts = getEmsgStartTime(emsgInfo, timeOffset);
          samples.push({
            data: emsgInfo.payload,
            len: emsgInfo.payload.byteLength,
            dts: pts,
            pts: pts,
            type: MetadataSchema.misbklv,
            duration: Number.POSITIVE_INFINITY,
          });
        }
      }
    });
  }
}

function getEmsgStartTime(
  emsgInfo: IEmsgParsingData,
  timeOffset: number,
): number {
  return Number.isFinite(emsgInfo.presentationTime)
    ? (emsgInfo.presentationTime as number) / emsgInfo.timeScale
    : timeOffset +
        (emsgInfo.presentationTimeDelta as number) / emsgInfo.timeScale;
}

export function parseEmsg(data: Uint8Array): IEmsgParsingData {
  const version = data[0];
  let schemeIdUri: string = '';
  let value: string = '';
  let timeScale: number = 0;
  let presentationTimeDelta: number = 0;
  let presentationTime: number | undefined;
  let eventDuration: number = 0;
  let id: number = 0;
  // Skip the FullBox version and flags
  let offset: number = 4;

  if (version === 0) {
    const scheme = readCString(data, offset);
    const schemeValue =
      scheme !== null ? readCString(data, offset + scheme.length) : null;

    if (scheme !== null && schemeValue !== null) {
      schemeIdUri = scheme;
      value = schemeValue;
      offset += scheme.length + schemeValue.length;

      timeScale = readUint32(data, offset);
      offset += 4;
      presentationTimeDelta = readUint32(data, offset);
      offset += 4;
      eventDuration = readUint32(data, offset);
      offset += 4;
      id = readUint32(data, offset);
      offset += 4;
    } else {
      logger.warn(
        `Unterminated ${scheme === null ? 'scheme_id_uri' : 'value'} in parsing emsg box: version 0 box ends inside a string, dropping all of its fields`,
      );
      // The box ends inside a string, so every field of the box follows it
      offset = data.length;
    }
  } else if (version === 1) {
    timeScale = readUint32(data, offset);
    offset += 4;
    const leftPresentationTime = readUint32(data, offset);
    offset += 4;
    const rightPresentationTime = readUint32(data, offset);
    offset += 4;
    presentationTime = 2 ** 32 * leftPresentationTime + rightPresentationTime;
    if (!Number.isSafeInteger(presentationTime)) {
      presentationTime = Number.MAX_SAFE_INTEGER;
      logger.warn(
        'Presentation time exceeds safe integer limit and wrapped to max safe integer in parsing emsg box',
      );
    }

    eventDuration = readUint32(data, offset);
    offset += 4;
    id = readUint32(data, offset);
    offset += 4;

    const scheme = readCString(data, offset);
    const schemeValue =
      scheme !== null ? readCString(data, offset + scheme.length) : null;

    if (scheme !== null) {
      schemeIdUri = scheme;
      offset += scheme.length;
    }
    if (schemeValue !== null) {
      value = schemeValue;
      offset += schemeValue.length;
    } else {
      logger.warn(
        `Unterminated ${scheme === null ? 'scheme_id_uri' : 'value'} in parsing emsg box: version 1 box ends inside a string, dropping its ${scheme === null ? 'strings and payload' : 'value and payload'}`,
      );
      // The box ends inside a string, so it carries no payload
      offset = data.length;
    }
  }
  const payload = data.subarray(offset, data.byteLength);

  return {
    schemeIdUri,
    value,
    timeScale,
    presentationTime,
    presentationTimeDelta,
    eventDuration,
    id,
    payload,
  };
}
