// CEA-608/708 caption extraction from SEI NAL units; the subtitles feature
// installs it as featureHooks.mp4Captions, and the MPEG-TS parsers import it.
import { decodeText, UTF_8 } from '@svta/cml-utils';
import {
  findBox,
  isHEVC,
  readSint32,
  readUint16,
  readUint32,
} from './mp4-tools';
import { ElementaryStreamTypes } from '../loader/fragment';
import { logger } from '../utils/logger';
import type { PassthroughTrack, UserdataSample } from '../types/demuxer';

let utf8TextDecoder: TextDecoder | undefined;

function decodeUtf8UserData(data: Uint8Array): string {
  if (typeof TextDecoder === 'undefined') {
    return decodeText(data, { encoding: UTF_8 }).replace(/\0/g, '');
  }
  const result = (utf8TextDecoder ||= new TextDecoder('utf-8')).decode(data);
  return result.replace(/\0/g, '');
}

export function parseSamples(
  timeOffset: number,
  track: PassthroughTrack,
): UserdataSample[] {
  const seiSamples = [] as UserdataSample[];
  const videoData = track.samples;
  const timescale = track.timescale;
  const trackId = track.id;
  let isHEVCFlavor = false;

  const moofs = findBox(videoData, ['moof']);
  moofs.map((moof) => {
    const moofOffset = moof.byteOffset - 8;
    const trafs = findBox(moof, ['traf']);
    trafs.map((traf) => {
      // get the base media decode time from the tfdt
      const baseTime = findBox(traf, ['tfdt']).map((tfdt) => {
        const version = tfdt[0];
        let result = readUint32(tfdt, 4);
        if (version === 1) {
          result *= Math.pow(2, 32);
          result += readUint32(tfdt, 8);
        }
        return result / timescale;
      })[0];

      if ((baseTime as any) !== undefined) {
        timeOffset = baseTime;
      }

      return findBox(traf, ['tfhd']).map((tfhd) => {
        const id = readUint32(tfhd, 4);
        const tfhdFlags = readUint32(tfhd, 0) & 0xffffff;
        const baseDataOffsetPresent = (tfhdFlags & 0x000001) !== 0;
        let baseDataOffset = 0;
        const sampleDescriptionIndexPresent = (tfhdFlags & 0x000002) !== 0;
        const defaultSampleDurationPresent = (tfhdFlags & 0x000008) !== 0;
        let defaultSampleDuration = 0;
        const defaultSampleSizePresent = (tfhdFlags & 0x000010) !== 0;
        let defaultSampleSize = 0;
        const defaultSampleFlagsPresent = (tfhdFlags & 0x000020) !== 0;
        const defaultBaseIsMoof =
          !baseDataOffsetPresent && (tfhdFlags & 0x020000) !== 0;
        let tfhdOffset = 8;

        if (id === trackId) {
          if (baseDataOffsetPresent) {
            baseDataOffset = readUint32(tfhd, tfhdOffset);
            tfhdOffset += 4;
            baseDataOffset *= Math.pow(2, 32);
            baseDataOffset += readUint32(tfhd, tfhdOffset);
            tfhdOffset += 4;
          } else if (defaultBaseIsMoof) {
            baseDataOffset = moofOffset;
          }
          if (sampleDescriptionIndexPresent) {
            tfhdOffset += 4;
          }
          if (defaultSampleDurationPresent) {
            defaultSampleDuration = readUint32(tfhd, tfhdOffset);
            tfhdOffset += 4;
          }
          if (defaultSampleSizePresent) {
            defaultSampleSize = readUint32(tfhd, tfhdOffset);
            tfhdOffset += 4;
          }
          if (defaultSampleFlagsPresent) {
            tfhdOffset += 4;
          }
          if (track.type === 'video') {
            isHEVCFlavor = isHEVC(track.codec);
          }

          findBox(traf, ['trun']).map((trun) => {
            const version = trun[0];
            const flags = readUint32(trun, 0) & 0xffffff;
            const dataOffsetPresent = (flags & 0x000001) !== 0;
            let dataOffset = 0;
            const firstSampleFlagsPresent = (flags & 0x000004) !== 0;
            const sampleDurationPresent = (flags & 0x000100) !== 0;
            let sampleDuration = 0;
            const sampleSizePresent = (flags & 0x000200) !== 0;
            let sampleSize = 0;
            const sampleFlagsPresent = (flags & 0x000400) !== 0;
            const sampleCompositionOffsetsPresent = (flags & 0x000800) !== 0;
            let compositionOffset = 0;
            const sampleCount = readUint32(trun, 4);
            let trunOffset = 8; // past version, flags, and sample count

            if (dataOffsetPresent) {
              dataOffset = readUint32(trun, trunOffset);
              trunOffset += 4;
            }
            if (firstSampleFlagsPresent) {
              trunOffset += 4;
            }
            let sampleOffset = baseDataOffset + dataOffset;
            for (let ix = 0; ix < sampleCount; ix++) {
              if (sampleDurationPresent) {
                sampleDuration = readUint32(trun, trunOffset);
                trunOffset += 4;
              } else {
                sampleDuration = defaultSampleDuration;
              }
              if (sampleSizePresent) {
                sampleSize = readUint32(trun, trunOffset);
                trunOffset += 4;
              } else {
                sampleSize = defaultSampleSize;
              }
              if (sampleFlagsPresent) {
                trunOffset += 4;
              }
              if (sampleCompositionOffsetsPresent) {
                if (version === 0) {
                  compositionOffset = readUint32(trun, trunOffset);
                } else {
                  compositionOffset = readSint32(trun, trunOffset);
                }
                trunOffset += 4;
              }
              if (track.type === ElementaryStreamTypes.VIDEO) {
                let naluTotalSize = 0;
                while (naluTotalSize < sampleSize) {
                  const naluSize = readUint32(videoData, sampleOffset);
                  sampleOffset += 4;
                  if (isSEIMessage(isHEVCFlavor, videoData[sampleOffset])) {
                    const data = videoData.subarray(
                      sampleOffset,
                      sampleOffset + naluSize,
                    );
                    parseSEIMessageFromNALu(
                      data,
                      isHEVCFlavor ? 2 : 1,
                      timeOffset + compositionOffset / timescale,
                      seiSamples,
                    );
                  }
                  sampleOffset += naluSize;
                  naluTotalSize += naluSize + 4;
                }
              }

              timeOffset += sampleDuration / timescale;
            }
          });
        }
      });
    });
  });
  return seiSamples;
}

export function isSEIMessage(isHEVCFlavor: boolean, naluHeader: number) {
  if (isHEVCFlavor) {
    const naluType = (naluHeader >> 1) & 0x3f;
    return naluType === 39 || naluType === 40;
  } else {
    const naluType = naluHeader & 0x1f;
    return naluType === 6;
  }
}

export function parseSEIMessageFromNALu(
  unescapedData: Uint8Array,
  headerSize: number,
  pts: number,
  samples: UserdataSample[],
) {
  const data = discardEPB(unescapedData);
  let seiPtr = 0;
  // skip nal header
  seiPtr += headerSize;
  let payloadType = 0;
  let payloadSize = 0;
  let b = 0;

  while (seiPtr < data.length) {
    payloadType = 0;
    do {
      if (seiPtr >= data.length) {
        break;
      }
      b = data[seiPtr++];
      payloadType += b;
    } while (b === 0xff);

    // Parse payload size.
    payloadSize = 0;
    do {
      if (seiPtr >= data.length) {
        break;
      }
      b = data[seiPtr++];
      payloadSize += b;
    } while (b === 0xff);

    const leftOver = data.length - seiPtr;
    // Create a variable to process the payload
    let payPtr = seiPtr;

    // Increment the seiPtr to the end of the payload
    if (payloadSize < leftOver) {
      seiPtr += payloadSize;
    } else if (payloadSize > leftOver) {
      // Some type of corruption has happened?
      logger.error(
        `Malformed SEI payload. ${payloadSize} is too small, only ${leftOver} bytes left to parse.`,
      );
      // We might be able to parse some data, but let's be safe and ignore it.
      break;
    }

    if (payloadType === 4) {
      const countryCode = data[payPtr++];
      if (countryCode === 181) {
        const providerCode = readUint16(data, payPtr);
        payPtr += 2;

        if (providerCode === 49) {
          const userStructure = readUint32(data, payPtr);
          payPtr += 4;

          if (userStructure === 0x47413934) {
            const userDataType = data[payPtr++];

            // Raw CEA-608 bytes wrapped in CEA-708 packet
            if (userDataType === 3) {
              const firstByte = data[payPtr++];
              const totalCCs = 0x1f & firstByte;
              const enabled = 0x40 & firstByte;
              const totalBytes = enabled ? 2 + totalCCs * 3 : 0;
              const byteArray = new Uint8Array(totalBytes);
              if (enabled) {
                byteArray[0] = firstByte;
                for (let i = 1; i < totalBytes; i++) {
                  byteArray[i] = data[payPtr++];
                }
              }

              samples.push({
                type: userDataType,
                payloadType,
                pts,
                bytes: byteArray,
              });
            }
          }
        }
      }
    } else if (payloadType === 5) {
      if (payloadSize > 16) {
        const uuidStrArray: Array<string> = [];
        for (let i = 0; i < 16; i++) {
          const b = data[payPtr++].toString(16);
          uuidStrArray.push(b.length == 1 ? '0' + b : b);

          if (i === 3 || i === 5 || i === 7 || i === 9) {
            uuidStrArray.push('-');
          }
        }
        const length = payloadSize - 16;
        const userDataBytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
          userDataBytes[i] = data[payPtr++];
        }

        samples.push({
          payloadType,
          pts,
          uuid: uuidStrArray.join(''),
          userData: decodeUtf8UserData(userDataBytes),
          userDataBytes,
        });
      }
    }
  }
}

/**
 * remove Emulation Prevention bytes from a RBSP
 */
export function discardEPB(data: Uint8Array): Uint8Array {
  const length = data.byteLength;
  let epbPositions: number[] | undefined;
  let position = data.indexOf(0x03, 3);

  // Find all `Emulation Prevention Bytes`
  while (position !== -1) {
    if (data[position - 1] === 0 && data[position - 2] === 0) {
      (epbPositions ||= []).push(position);
    }
    position = data.indexOf(0x03, position + 1);
  }

  // If no Emulation Prevention Bytes were found just return the original
  // array
  if (!epbPositions) {
    return data;
  }

  // Create a new array to hold the NAL unit data
  const newLength = length - epbPositions.length;
  const newData = new Uint8Array(newLength);
  let epbIndex = 0;
  let sourceIndex = 0;

  for (let i = 0; i < newLength; sourceIndex++, i++) {
    if (sourceIndex === epbPositions[epbIndex]) {
      // Skip this byte
      sourceIndex++;
      epbIndex++;
    }
    newData[i] = data[sourceIndex];
  }
  return newData;
}
