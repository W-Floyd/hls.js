const MPEG_TS_CLOCK_FREQ_HZ = 90000;

export type RationalTimestamp = {
  baseTime: number; // ticks
  timescale: number; // ticks per second
};

export type TimestampOffset = RationalTimestamp & { trackId: number };

export function toTimescaleFromBase(
  baseTime: number,
  destScale: number,
  srcBase: number = 1,
  round: boolean = false,
): number {
  const result = baseTime * destScale * srcBase; // equivalent to `(value * scale) / (1 / base)`
  return round ? Math.round(result) : result;
}

export function toTimescaleFromScale(
  baseTime: number,
  destScale: number,
  srcScale: number = 1,
  round: boolean = false,
): number {
  return toTimescaleFromBase(baseTime, destScale, 1 / srcScale, round);
}

export function toMsFromMpegTsClock(
  baseTime: number,
  round: boolean = false,
): number {
  return toTimescaleFromBase(baseTime, 1000, 1 / MPEG_TS_CLOCK_FREQ_HZ, round);
}

export function toMpegTsClockFromTimescale(
  baseTime: number,
  srcScale: number = 1,
): number {
  return toTimescaleFromBase(baseTime, MPEG_TS_CLOCK_FREQ_HZ, 1 / srcScale);
}

export function timestampToString(timestamp: TimestampOffset): string {
  const { baseTime, timescale, trackId } = timestamp;
  return `${baseTime / timescale} (${baseTime}/${timescale}) trackId: ${trackId}`;
}

export const MPEG_TS_PTS_ROLLOVER = 8589934592; // 2^33

export function normalizePts(value: number, reference: number | null): number {
  let offset;
  if (reference === null) {
    return value;
  }

  if (reference < value) {
    // - 2^33
    offset = -MPEG_TS_PTS_ROLLOVER;
  } else {
    // + 2^33
    offset = MPEG_TS_PTS_ROLLOVER;
  }
  /* PTS is 33bit (from 0 to 2^33 -1)
    if diff between value and reference is bigger than half of the amplitude (2^32) then it means that
    PTS looping occured. fill the gap */
  while (Math.abs(value - reference) > 4294967296) {
    value += offset;
  }

  return value;
}
