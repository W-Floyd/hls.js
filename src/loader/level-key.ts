import { arrayValuesMatch, optionalArrayValuesMatch } from '../utils/arrays';
import { isFullSegmentEncryption } from '../utils/encryption-methods-util';
import { hexToArrayBuffer } from '../utils/hex';
import { logger } from '../utils/logger';

let keyUriToKeyIdMap: { [uri: string]: Uint8Array<ArrayBuffer> | undefined } =
  {};

export interface DecryptData {
  uri: string;
  method: string;
  keyFormat: string;
  keyFormatVersions: number[];
  iv: Uint8Array<ArrayBuffer> | null;
  key: Uint8Array<ArrayBuffer> | null;
  keyId: Uint8Array<ArrayBuffer> | null;
  pssh: Uint8Array<ArrayBuffer> | null;
  encrypted: boolean;
  isCommonEncryption: boolean;
}

export class LevelKey implements DecryptData {
  public readonly uri: string;
  public readonly method: string;
  public readonly keyFormat: string;
  public readonly keyFormatVersions: number[];
  public readonly encrypted: boolean;
  public readonly isCommonEncryption: boolean;
  public iv: Uint8Array<ArrayBuffer> | null = null;
  public key: Uint8Array<ArrayBuffer> | null = null;
  public keyId: Uint8Array<ArrayBuffer> | null = null;
  public pssh: Uint8Array<ArrayBuffer> | null = null;
  public scheme?: string;

  // Installed by the emeDrm feature
  static drm?: {
    isSupported(key: LevelKey): boolean;
    getDecryptData(
      key: LevelKey,
      levelKeys?: { [key: string]: LevelKey | undefined },
    ): LevelKey;
  };

  static getKeyIdForUri(uri: string): Uint8Array<ArrayBuffer> | undefined {
    return keyUriToKeyIdMap[uri];
  }

  static clearKeyUriToKeyIdMap() {
    keyUriToKeyIdMap = {};
  }

  static setKeyIdForUri(uri: string, keyId: Uint8Array<ArrayBuffer>) {
    keyUriToKeyIdMap[uri] = keyId;
  }

  static addKeyIdForUri(uri: string): Uint8Array<ArrayBuffer> {
    const val = Object.keys(keyUriToKeyIdMap).length % Number.MAX_SAFE_INTEGER;
    const keyId = new Uint8Array(16);
    const dv = new DataView(keyId.buffer, 12, 4); // Just set the last 4 bytes
    dv.setUint32(0, val);
    keyUriToKeyIdMap[uri] = keyId;
    return keyId;
  }

  constructor(
    method: string,
    uri: string,
    format: string,
    formatversions: number[] = [1],
    iv: Uint8Array<ArrayBuffer> | null = null,
    keyId?: string,
  ) {
    this.method = method;
    this.uri = uri;
    this.keyFormat = format;
    this.keyFormatVersions = formatversions;
    this.iv = iv;
    this.encrypted = method ? method !== 'NONE' : false;
    this.isCommonEncryption =
      this.encrypted && !isFullSegmentEncryption(method);
    if (keyId?.startsWith('0x')) {
      this.keyId = new Uint8Array(hexToArrayBuffer(keyId));
    }
  }

  public matches(key: LevelKey): boolean {
    return (
      key.uri === this.uri &&
      key.method === this.method &&
      key.encrypted === this.encrypted &&
      key.keyFormat === this.keyFormat &&
      arrayValuesMatch(key.keyFormatVersions, this.keyFormatVersions) &&
      optionalArrayValuesMatch(key.iv, this.iv) &&
      optionalArrayValuesMatch(key.keyId, this.keyId)
    );
  }

  public isSupported(): boolean {
    // If it's Segment encryption or No encryption, just select that key system
    if (this.method) {
      if (isFullSegmentEncryption(this.method) || this.method === 'NONE') {
        return true;
      }
      if (this.keyFormat === 'identity') {
        // Maintain support for clear SAMPLE-AES with MPEG-3 TS
        return this.method === 'SAMPLE-AES';
      } else if (__USE_EME_DRM__ && LevelKey.drm) {
        return LevelKey.drm.isSupported(this);
      }
    }
    return false;
  }

  public getDecryptData(
    sn: number | 'initSegment',
    levelKeys?: { [key: string]: LevelKey | undefined },
  ): LevelKey | null {
    if (!this.encrypted || !this.uri) {
      return null;
    }

    if (isFullSegmentEncryption(this.method)) {
      let iv = this.iv;
      if (!iv) {
        if (typeof sn !== 'number') {
          // We are fetching decryption data for a initialization segment
          // If the segment was encrypted with AES-128/256
          // It must have an IV defined. We cannot substitute the Segment Number in.
          logger.warn(
            `missing IV for initialization segment with method="${this.method}" - compliance issue`,
          );

          // Explicitly set sn to resulting value from implicit conversions 'initSegment' values for IV generation.
          sn = 0;
        }
        iv = createInitializationVector(sn);
      }
      const decryptdata = new LevelKey(
        this.method,
        this.uri,
        'identity',
        this.keyFormatVersions,
        iv,
      );
      return decryptdata;
    }

    const drm = __USE_EME_DRM__ && LevelKey.drm;
    if (!drm) {
      return this;
    }
    return drm.getDecryptData(this, levelKeys);
  }
}

function createInitializationVector(segmentNumber: number) {
  const uint8View = new Uint8Array(16);
  for (let i = 12; i < 16; i++) {
    uint8View[i] = (segmentNumber >> (8 * (15 - i))) & 0xff;
  }
  return uint8View;
}
