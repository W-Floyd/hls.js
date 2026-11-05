import { findBox, readUint32, types, writeUint32 } from './mp4-tools';
import { bin2str } from './numeric-encoding-utils';

// Shrink a box to newPayloadSize + header, turning the remainder into a
// nested 'free' box (Safari rejects trun/saiz boxes larger than their
// declared sample count requires)
function shrinkBox(data: Uint8Array, box: Uint8Array, newPayloadSize: number) {
  const start = box.byteOffset - data.byteOffset - 8;
  const newSize = 8 + newPayloadSize;
  const tail = box.byteLength + 8 - newSize;
  if (tail < 8) {
    // No change needed, or the remainder is too small to hold a box header
    return;
  }
  writeUint32(data, start, newSize);
  writeUint32(data, start + newSize, tail);
  writeUint32(data, start + newSize + 4, types.free);
}

// View-relative [start, end) byte range of a box, including its 8-byte header
function boxRange(box: Uint8Array, base: number): [number, number] {
  return [box.byteOffset - base - 8, box.byteOffset - base + box.byteLength];
}

// Splice the given byte ranges out of `data`, returning the shrunk copy, the
// total bytes removed, and a droppedBefore(offset) helper for repositioning
// surviving offsets. Ranges are view-relative and sorted in place.
function spliceOutBoxes(
  data: Uint8Array<ArrayBuffer>,
  dropRanges: [number, number][],
): {
  result: Uint8Array<ArrayBuffer>;
  dropped: number;
  droppedBefore: (offset: number) => number;
} {
  dropRanges.sort((a, b) => a[0] - b[0]);
  const dropped = dropRanges.reduce(
    (sum, [start, end]) => sum + end - start,
    0,
  );
  const result = new Uint8Array(data.byteLength - dropped);
  let read = 0;
  let write = 0;
  for (let i = 0; i < dropRanges.length; i++) {
    const [start, end] = dropRanges[i];
    result.set(data.subarray(read, start), write);
    write += start - read;
    read = end;
  }
  result.set(data.subarray(read), write);
  const droppedBefore = (offset: number) =>
    dropRanges.reduce(
      (sum, [start, end]) => (end <= offset ? sum + end - start : sum),
      0,
    );
  return { result, dropped, droppedBefore };
}

// Video-only copy of an init segment, or null when there is no video track or nothing to remove
export function videoOnlyInitSegment(
  initSegment: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> | null {
  const moovs = findBox(initSegment, ['moov']);
  if (moovs.length !== 1 || findBox(initSegment, ['moof']).length) {
    return null;
  }
  const base = initSegment.byteOffset;
  const dropRanges: [number, number][] = [];
  const dropTrackIds: number[] = [];
  let hasVideo = false;
  const traks = findBox(moovs[0], ['trak']);
  for (let i = 0; i < traks.length; i++) {
    const trak = traks[i];
    const hdlr = findBox(trak, ['mdia', 'hdlr'])[0];
    const handler = hdlr ? bin2str(hdlr.subarray(8, 12)) : '';
    if (handler === 'vide') {
      hasVideo = true;
      continue;
    }
    const tkhd = findBox(trak, ['tkhd'])[0];
    if (!tkhd) {
      return null;
    }
    const version = tkhd[0];
    dropTrackIds.push(readUint32(tkhd, version === 0 ? 12 : 20));
    dropRanges.push(boxRange(trak, base));
  }
  if (!hasVideo || !dropRanges.length) {
    return null;
  }
  const mvex = findBox(moovs[0], ['mvex'])[0];
  let mvexDropped = 0;
  if (mvex) {
    const trexs = findBox(mvex, ['trex']);
    for (let i = 0; i < trexs.length; i++) {
      const trex = trexs[i];
      if (dropTrackIds.indexOf(readUint32(trex, 4)) !== -1) {
        dropRanges.push(boxRange(trex, base));
        mvexDropped += trex.byteLength + 8;
      }
    }
  }
  // Splice out the dropped ranges, then patch sizes at their result offsets
  const { result, dropped, droppedBefore } = spliceOutBoxes(
    initSegment,
    dropRanges,
  );
  const moovStart = moovs[0].byteOffset - base - 8;
  writeUint32(result, moovStart, moovs[0].byteLength + 8 - dropped);
  if (mvex && mvexDropped) {
    const mvexStart = mvex.byteOffset - base - 8;
    writeUint32(
      result,
      mvexStart - droppedBefore(mvexStart),
      mvex.byteLength + 8 - mvexDropped,
    );
  }
  return result;
}

// Duration rewrite for remuxVideoOnlyIFrameMoof: `value` (video timescale) is
// written at `durationOffset` — the last sample's duration or the tfhd default
export type IFrameDurationRewrite = {
  durationOffset: number;
  value: number;
};

// Remux a moof+mdat I-Frame fragment to video-only in place: drop non-video trafs
// (muxed A/V), truncate to the in-range samples (partial mdat), and stretch the
// last sample duration, preserving senc/saiz/saio. Returns null when it cannot be
// rewritten (no video traf, no samples, or non-moof-relative muxed content).
export function remuxVideoOnlyIFrameMoof(
  data: Uint8Array<ArrayBuffer>,
  videoTrackId: number,
  keepSampleCount: number,
  keepEndOffset: number | undefined,
  durationRewrite: IFrameDurationRewrite | undefined,
): Uint8Array<ArrayBuffer> | null {
  if (keepSampleCount < 1) {
    return null;
  }
  const moofs = findBox(data, ['moof']);
  if (moofs.length !== 1) {
    return null;
  }
  const moof = moofs[0];
  const base = data.byteOffset;
  const videoTrafs: Uint8Array[] = [];
  const dropRanges: [number, number][] = [];
  const trafs = findBox(moof, ['traf']);
  let videoBaseIsMoof = true;
  for (let i = 0; i < trafs.length; i++) {
    const traf = trafs[i];
    const tfhd = findBox(traf, ['tfhd'])[0];
    if (!tfhd) {
      return null;
    }
    if (readUint32(tfhd, 4) === videoTrackId) {
      videoTrafs.push(traf);
      if (!(readUint32(tfhd, 0) & 0x20000)) {
        videoBaseIsMoof = false;
      }
    } else {
      dropRanges.push(boxRange(traf, base));
    }
  }
  if (!videoTrafs.length) {
    return null;
  }
  // Patching moof-relative offsets after a splice requires default-base-is-moof
  if (dropRanges.length && !videoBaseIsMoof) {
    return null;
  }

  if (keepEndOffset !== undefined) {
    // Distribute the kept count across the runs; emptied runs become 'free'
    // boxes (parsers reject zero-sample truns)
    let remaining = keepSampleCount;
    for (let t = 0; t < videoTrafs.length; t++) {
      const traf = videoTrafs[t];
      let trafKept = 0;
      const truns = findBox(traf, ['trun']);
      for (let j = 0; j < truns.length; j++) {
        const trun = truns[j];
        const count = Math.min(remaining, readUint32(trun, 4));
        if (count) {
          writeUint32(data, trun.byteOffset - base + 4, count);
          const flags = readUint32(trun, 0) & 0xffffff;
          const perSample =
            (flags & 0x100 ? 4 : 0) +
            (flags & 0x200 ? 4 : 0) +
            (flags & 0x400 ? 4 : 0) +
            (flags & 0x800 ? 4 : 0);
          shrinkBox(
            data,
            trun,
            8 +
              (flags & 0x01 ? 4 : 0) +
              (flags & 0x04 ? 4 : 0) +
              count * perSample,
          );
        } else {
          writeUint32(data, trun.byteOffset - base - 4, types.free);
        }
        remaining -= count;
        trafKept += count;
      }
      const senc = findBox(traf, ['senc'])[0];
      if (senc) {
        // The size of a senc box cannot be validated without the tenc IV size,
        // so rewriting the sample count alone is accepted
        writeUint32(data, senc.byteOffset - base + 4, trafKept);
      }
      const saiz = findBox(traf, ['saiz'])[0];
      if (saiz) {
        const saizFlags = (saiz[1] << 16) | (saiz[2] << 8) | saiz[3];
        let off = 4;
        if (saizFlags & 0x01) {
          off += 8;
        }
        const defaultSampleInfoSize = saiz[off];
        off += 1;
        writeUint32(data, saiz.byteOffset - base + off, trafKept);
        shrinkBox(
          data,
          saiz,
          off + 4 + (defaultSampleInfoSize === 0 ? trafKept : 0),
        );
      }
    }
    const mdats = findBox(data, ['mdat']);
    if (mdats.length === 1) {
      const mdatStart = mdats[0].byteOffset - base - 8;
      writeUint32(data, mdatStart, keepEndOffset - mdatStart);
    }
  }

  let result: Uint8Array<ArrayBuffer> = data;
  let dropped = 0;
  let droppedBefore: (offset: number) => number = () => 0;
  if (dropRanges.length) {
    // Splice out the dropped ranges, then patch sizes/offsets at their result offsets
    ({ result, dropped, droppedBefore } = spliceOutBoxes(data, dropRanges));
    writeUint32(
      result,
      moof.byteOffset - base - 8,
      moof.byteLength + 8 - dropped,
    );
    for (let t = 0; t < videoTrafs.length; t++) {
      const traf = videoTrafs[t];
      // The mdat moves up by everything dropped; the traf and the senc payload
      // its saio points to by what was dropped before the traf
      const trafShift = droppedBefore(traf.byteOffset - base);
      const truns = findBox(traf, ['trun']);
      for (let j = 0; j < truns.length; j++) {
        const trun = truns[j];
        if (readUint32(trun, 0) & 0x01) {
          writeUint32(
            result,
            trun.byteOffset - base - trafShift + 8,
            readUint32(trun, 8) - dropped,
          );
        }
      }
      if (trafShift) {
        const saios = findBox(traf, ['saio']);
        for (let s = 0; s < saios.length; s++) {
          const saio = saios[s];
          const stride = saio[0] === 0 ? 4 : 8;
          let offset = readUint32(saio, 0) & 0x01 ? 12 : 4;
          let entries = readUint32(saio, offset);
          for (offset += 4; entries--; offset += stride) {
            // Patch the low word of each aux info offset
            const at = offset + stride - 4;
            writeUint32(
              result,
              saio.byteOffset - base - trafShift + at,
              readUint32(saio, at) - trafShift,
            );
          }
        }
      }
    }
  }

  if (durationRewrite) {
    const { durationOffset, value } = durationRewrite;
    writeUint32(result, durationOffset - droppedBefore(durationOffset), value);
  }

  return keepEndOffset !== undefined
    ? result.subarray(0, keepEndOffset - dropped)
    : result;
}
