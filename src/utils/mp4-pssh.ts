import { arrayToHex } from './hex';
import type { KeySystemIds } from './mediakeys-helper';

export function mp4Box(type: ArrayLike<number>, ...payload: Uint8Array[]) {
  const len = payload.length;
  let size = 8;
  let i = len;
  while (i--) {
    size += payload[i].byteLength;
  }
  const result = new Uint8Array(size);
  result[0] = (size >> 24) & 0xff;
  result[1] = (size >> 16) & 0xff;
  result[2] = (size >> 8) & 0xff;
  result[3] = size & 0xff;
  result.set(type, 4);
  for (i = 0, size = 8; i < len; i++) {
    result.set(payload[i], size);
    size += payload[i].byteLength;
  }
  return result;
}

export function mp4pssh(
  systemId: Uint8Array,
  keyids: Array<Uint8Array> | null,
  data: Uint8Array,
) {
  if (systemId.byteLength !== 16) {
    throw new RangeError('Invalid system id');
  }
  let version;
  let kids;
  if (keyids) {
    version = 1;
    kids = new Uint8Array(keyids.length * 16);
    for (let ix = 0; ix < keyids.length; ix++) {
      const k = keyids[ix]; // uint8array
      if (k.byteLength !== 16) {
        throw new RangeError('Invalid key');
      }
      kids.set(k, ix * 16);
    }
  } else {
    version = 0;
    kids = new Uint8Array();
  }
  let kidCount;
  if (version > 0) {
    kidCount = new Uint8Array(4);
    if (keyids!.length > 0) {
      new DataView(kidCount.buffer).setUint32(0, keyids!.length, false);
    }
  } else {
    kidCount = new Uint8Array();
  }
  const dataSize = new Uint8Array(4);
  if (data.byteLength > 0) {
    new DataView(dataSize.buffer).setUint32(0, data.byteLength, false);
  }
  return mp4Box(
    [112, 115, 115, 104],
    new Uint8Array([
      version,
      0x00,
      0x00,
      0x00, // Flags
    ]),
    systemId, // 16 bytes
    kidCount,
    kids,
    dataSize,
    data,
  );
}

export type PsshData = {
  version: 0 | 1;
  systemId: KeySystemIds;
  kids: null | Uint8Array<ArrayBuffer>[];
  data: null | Uint8Array<ArrayBuffer>;
  offset: number;
  size: number;
};

export type PsshInvalidResult = {
  systemId?: undefined;
  kids?: undefined;
  offset: number;
  size: number;
};

export function parseMultiPssh(
  initData: ArrayBuffer,
): (PsshData | PsshInvalidResult)[] {
  const results: (PsshData | PsshInvalidResult)[] = [];
  if (initData instanceof ArrayBuffer) {
    const length = initData.byteLength;
    let offset = 0;
    while (offset + 32 < length) {
      const view = new DataView(initData, offset);
      const pssh = parsePssh(view);
      results.push(pssh);
      offset += pssh.size;
    }
  }
  return results;
}

function parseWidevinePsshKids(
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer>[] {
  const kids: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < data.length; ) {
    const tag = data[i++];
    const wireType = tag & 7;
    if (wireType === 0) {
      // Varint
      while (data[i++] & 0x80) {
        /* empty */
      }
      continue;
    }
    if (wireType !== 2) {
      // 1	64-bit fixed // 5	32-bit fixed
      i += wireType === 1 ? 8 : 4;
      continue;
    }
    let len = 0;
    for (let shift = 0, b = 0x80; b & 0x80; shift += 7) {
      len |= ((b = data[i++]) & 0x7f) << shift;
    }
    if (tag >> 3 === 2) {
      // key_id - 16 raw bytes or 32-byte ASCII hex string
      if (len === 32) {
        const kid = new Uint8Array(16) as Uint8Array<ArrayBuffer>;
        for (let j = 0; j < 16; j++) {
          kid[j] = parseInt(
            String.fromCharCode(data[i + j * 2], data[i + j * 2 + 1]),
            16,
          );
        }
        kids.push(kid);
      } else if (len === 16) {
        kids.push(data.subarray(i, i + 16));
      }
    }
    i += len;
  }
  return kids;
}

function parsePssh(view: DataView<ArrayBuffer>): PsshData | PsshInvalidResult {
  const size = view.getUint32(0);
  const offset = view.byteOffset;
  const length = view.byteLength;
  if (length < size) {
    return {
      offset,
      size: length,
    };
  }
  const type = view.getUint32(4);
  if (type !== 0x70737368) {
    return { offset, size };
  }
  const version = view.getUint32(8) >>> 24;
  if (version !== 0 && version !== 1) {
    return { offset, size };
  }
  const buffer = view.buffer;
  const systemId = arrayToHex(
    new Uint8Array(buffer, offset + 12, 16),
  ) as KeySystemIds;

  let kids: null | Uint8Array<ArrayBuffer>[] = null;
  let data: null | Uint8Array<ArrayBuffer> = null;
  let dataSizeOffset = 0;

  if (version === 0) {
    dataSizeOffset = 28;
  } else {
    const kidCounts = view.getUint32(28);
    if (!kidCounts || length < 32 + kidCounts * 16) {
      return { offset, size };
    }
    kids = [];
    for (let i = 0; i < kidCounts; i++) {
      kids.push(new Uint8Array(buffer, offset + 32 + i * 16, 16));
    }
    dataSizeOffset = 32 + kidCounts * 16;
  }

  if (!dataSizeOffset) {
    return { offset, size };
  }

  const dataSizeOrKidCount = view.getUint32(dataSizeOffset);
  if (size - 32 < dataSizeOrKidCount) {
    return { offset, size };
  }
  data = new Uint8Array(
    buffer,
    offset + dataSizeOffset + 4,
    dataSizeOrKidCount,
  );
  if (version === 0) {
    kids = parseWidevinePsshKids(data);
  }
  return {
    version,
    systemId,
    kids,
    data,
    offset,
    size,
  };
}
