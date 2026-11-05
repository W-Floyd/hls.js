import { normalizePts } from '../utils/timescale-conversion';
import type {
  DemuxedMetadataTrack,
  DemuxedUserdataTrack,
} from '../types/demuxer';
import type { RemuxedMetadata, RemuxedUserdata } from '../types/remuxer';
import type {
  RationalTimestamp,
  TimestampOffset,
} from '../utils/timescale-conversion';

export function flushTextTrackMetadataCueSamples(
  track: DemuxedMetadataTrack,
  timeOffset: number,
  initPTS: TimestampOffset,
  initDTS: TimestampOffset,
): RemuxedMetadata | undefined {
  const length = track.samples.length;
  if (!length) {
    return;
  }
  const inputTimeScale = track.inputTimeScale;
  for (let index = 0; index < length; index++) {
    const sample = track.samples[index];
    // setting id3 pts, dts to relative time
    // using this._initPTS and this._initDTS to calculate relative time
    sample.pts =
      normalizePts(
        sample.pts - (initPTS.baseTime * inputTimeScale) / initPTS.timescale,
        timeOffset * inputTimeScale,
      ) / inputTimeScale;
    sample.dts =
      normalizePts(
        sample.dts - (initDTS.baseTime * inputTimeScale) / initDTS.timescale,
        timeOffset * inputTimeScale,
      ) / inputTimeScale;
  }
  const samples = track.samples;
  track.samples = [];
  return {
    samples,
  };
}

export function flushTextTrackUserdataCueSamples(
  track: DemuxedUserdataTrack,
  timeOffset: number,
  initPTS: RationalTimestamp,
): RemuxedUserdata | undefined {
  const length = track.samples.length;
  if (!length) {
    return;
  }

  const inputTimeScale = track.inputTimeScale;
  for (let index = 0; index < length; index++) {
    const sample = track.samples[index];
    // setting text pts, dts to relative time
    // using this._initPTS and this._initDTS to calculate relative time
    sample.pts =
      normalizePts(
        sample.pts - (initPTS.baseTime * inputTimeScale) / initPTS.timescale,
        timeOffset * inputTimeScale,
      ) / inputTimeScale;
  }
  track.samples.sort((a, b) => a.pts - b.pts);
  const samples = track.samples;
  track.samples = [];
  return {
    samples,
  };
}
