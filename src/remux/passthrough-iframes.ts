import {
  type IFrameDurationRewrite,
  remuxVideoOnlyIFrameMoof,
} from '../utils/mp4-iframes';
import type { ChunkMetadata } from '../types/transmuxer';
import type { ILogger } from '../utils/logger';
import type { TrackTimes } from '../utils/mp4-tools';

// Rewrites a video I-Frame fragment so its samples span the playlist duration.
export function remuxIFrameFragment(
  data: Uint8Array<ArrayBuffer>,
  videoSampleTimestamps: TrackTimes,
  chunkMeta: ChunkMetadata,
  videoStartTime: number,
  videoEndTime: number,
  videoOnlyRemux: boolean,
  video: { id: number; timescale: number },
  logger: ILogger,
): { data: Uint8Array<ArrayBuffer>; videoPtsEnd?: number; duration: number } {
  let data1 = data;
  let videoPtsEnd: number | undefined;
  let duration: number;
  const { trun, start } = videoSampleTimestamps;
  const singleRun = trun.length === 1;
  const samples = !trun.length
    ? []
    : singleRun
      ? trun[0].samples
      : trun[0].samples.concat(...trun.slice(1).map((run) => run.samples));
  if (samples.length) {
    const fragRun = trun[0];
    let lastRun = fragRun;
    for (let i = trun.length; i--; ) {
      if (trun[i].samples.length) {
        lastRun = trun[i];
        break;
      }
    }
    const lastSampleDurationOffset = lastRun.lastSampleDurationOffset;
    const { defaultSampleDurationOffset } = fragRun;
    // Stretch samples to playlist time when the moof's
    // sample timing is off by more than 1/20s.
    const needsDurationAdjustment =
      Math.abs(chunkMeta.duration - (videoEndTime - videoStartTime)) > 0.05;
    const partialMdat = samples.length < videoSampleTimestamps.sampleCount;
    const needsRemux =
      needsDurationAdjustment || partialMdat || videoOnlyRemux || !singleRun;
    if (!needsRemux) {
      // MP4 timing already spans EXTINF and every declared sample's
      // data is in the slice — pass through unchanged.
      duration = videoEndTime - videoStartTime;
    } else {
      const keepEndOffset = partialMdat
        ? lastRun.sampleOffset +
          lastRun.samples.reduce((sum, sample) => sum + sample.size, 0)
        : undefined;
      // A partial mdat or dropped runs leave fewer samples than declared, so
      // stretch the kept samples to the playlist time whenever a duration
      // field can be rewritten (undefined keeps native durations)
      const target = needsDurationAdjustment
        ? chunkMeta.duration
        : videoEndTime - videoStartTime;
      const durationRewrite = computeIFrameDurationRewrite(
        samples,
        target * video.timescale,
        lastSampleDurationOffset,
        defaultSampleDurationOffset,
      );
      const remuxed = remuxVideoOnlyIFrameMoof(
        data,
        video.id,
        samples.length,
        keepEndOffset,
        durationRewrite,
      );
      if (remuxed) {
        data1 = remuxed;
        videoPtsEnd = samplesPresentationEnd(start, samples);
      } else {
        // Could not rewrite (e.g. muxed without moof-relative sample
        // offsets) — fall back to the native sample duration
        logger.warn(
          `IFrame remux skipped (sn ${chunkMeta.sn}); using native sample duration`,
        );
      }
      duration =
        remuxed && durationRewrite ? target : videoEndTime - videoStartTime;
    }
  } else {
    logger.warn(
      `Could not remux IFrame track fragment (no samples in range, trun count ${trun.length})`,
    );
    duration = videoEndTime - videoStartTime;
  }
  return { data: data1, videoPtsEnd, duration };
}

function samplesPresentationEnd(
  baseDecodeTime: number,
  samples: Array<{ cts?: number; duration: number }>,
): number {
  let dts = baseDecodeTime;
  let end = baseDecodeTime;
  for (let i = 0; i < samples.length; i++) {
    const { cts, duration } = samples[i];
    end = Math.max(end, dts + (cts || 0) + duration);
    dts += duration;
  }
  return end;
}

// Stretch the kept I-Frame samples to `totalDuration`, mutating them so the
// reported presentation end matches. Returns undefined when no duration field
// can be written (durations come from moov trex defaults).
function computeIFrameDurationRewrite(
  samples: Array<{ duration: number }>,
  totalDuration: number,
  lastSampleDurationOffset: number | undefined,
  defaultSampleDurationOffset: number | undefined,
): IFrameDurationRewrite | undefined {
  if (lastSampleDurationOffset !== undefined) {
    const lastSample = samples[samples.length - 1];
    let lastSampleDuration = totalDuration;
    for (let i = 0; i < samples.length - 1; i++) {
      lastSampleDuration -= samples[i].duration;
    }
    if (lastSampleDuration <= 0) {
      // Keep the native duration rather than write a wrapped value
      lastSampleDuration = lastSample.duration;
    }
    lastSample.duration = lastSampleDuration;
    return {
      durationOffset: lastSampleDurationOffset,
      value: lastSampleDuration,
    };
  }
  if (defaultSampleDurationOffset === undefined) {
    return undefined;
  }
  const defaultSampleDuration = Math.round(totalDuration / samples.length);
  for (let i = 0; i < samples.length; i++) {
    samples[i].duration = defaultSampleDuration;
  }
  return {
    durationOffset: defaultSampleDurationOffset,
    value: defaultSampleDuration,
  };
}
