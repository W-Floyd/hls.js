import { LevelKey } from './level-key';
import { arrayValuesMatch } from '../utils/arrays';
import { convertDataUriToArrayBytes } from '../utils/keysystem-util';
import {
  KeySystemFormats,
  KeySystemIds,
  parsePlayReadyWRM,
} from '../utils/mediakeys-helper';
import { mp4pssh, parseMultiPssh } from '../utils/mp4-pssh';

// Key system (KEYFORMAT) handling for LevelKey, installed by the emeDrm feature.
export const levelKeyDrm: NonNullable<typeof LevelKey.drm> = {
  isSupported(key: LevelKey): boolean {
    switch (key.keyFormat) {
      case KeySystemFormats.FAIRPLAY:
      case KeySystemFormats.WIDEVINE:
      case KeySystemFormats.PLAYREADY:
      case KeySystemFormats.CLEARKEY:
        return (
          ['SAMPLE-AES', 'SAMPLE-AES-CENC', 'SAMPLE-AES-CTR'].indexOf(
            key.method,
          ) !== -1
        );
    }
    return false;
  },

  getDecryptData(
    key: LevelKey,
    levelKeys?: { [key: string]: LevelKey | undefined },
  ): LevelKey {
    if (key.keyId) {
      // Handle case where key id is changed in KEY_LOADING event handler #7542#issuecomment-3305203929
      const assignedKeyId = LevelKey.getKeyIdForUri(key.uri);
      if (assignedKeyId && !arrayValuesMatch(key.keyId, assignedKeyId)) {
        LevelKey.setKeyIdForUri(key.uri, key.keyId);
      }

      if (key.pssh) {
        return key;
      }
    }

    // Key bytes are signalled the KEYID attribute, typically only found on WideVine KEY tags
    // Initialize keyId if possible
    const keyBytes = convertDataUriToArrayBytes(key.uri);
    if (keyBytes) {
      switch (key.keyFormat) {
        case KeySystemFormats.WIDEVINE:
          // Setting `pssh` on this LevelKey/DecryptData allows HLS.js to generate a session using
          // the playlist-key before the "encrypted" event. (Comment out to only use "encrypted" path.)
          key.pssh = keyBytes;
          // In case of Widevine, if KEYID is not in the playlist, assume only two fields in the pssh KEY tag URI.
          if (!key.keyId) {
            const results = parseMultiPssh(keyBytes.buffer).filter(
              (result) => result.systemId === KeySystemIds.WIDEVINE,
            );
            if (results.length) {
              const psshData = results[0];
              key.keyId = psshData.kids?.length ? psshData.kids[0] : null;
            }
          }
          if (!key.keyId) {
            key.keyId = getKeyIdFromPlayReadyKey(levelKeys);
          }
          break;
        case KeySystemFormats.PLAYREADY: {
          const PlayReadyKeySystemUUID = new Uint8Array([
            0x9a, 0x04, 0xf0, 0x79, 0x98, 0x40, 0x42, 0x86, 0xab, 0x92, 0xe6,
            0x5b, 0xe0, 0x88, 0x5f, 0x95,
          ]);

          // Setting `pssh` on this LevelKey/DecryptData allows HLS.js to generate a session using
          // the playlist-key before the "encrypted" event. (Comment out to only use "encrypted" path.)
          key.pssh = mp4pssh(PlayReadyKeySystemUUID, null, keyBytes);

          key.keyId = parsePlayReadyWRM(keyBytes);

          break;
        }
        default: {
          let keydata = keyBytes.subarray(0, 16);
          if (keydata.length !== 16) {
            const padded = new Uint8Array(16);
            padded.set(keydata, 16 - keydata.length);
            keydata = padded;
          }
          key.keyId = keydata;
          break;
        }
      }
    }

    // Default behavior: get keyId from other KEY tag or URI lookup
    if (key.keyId?.byteLength !== 16) {
      let keyId: Uint8Array<ArrayBuffer> | null | undefined;
      keyId = getKeyIdFromWidevineKey(levelKeys);
      if (!keyId) {
        keyId = getKeyIdFromPlayReadyKey(levelKeys);
        if (!keyId) {
          keyId = LevelKey.getKeyIdForUri(key.uri);
        }
      }
      if (keyId) {
        key.keyId = keyId;
        LevelKey.setKeyIdForUri(key.uri, keyId);
      }
      // else if the key id could not be identified from the playlist, wait for the init segment
    }
    return key;
  },
};

function getKeyIdFromWidevineKey(
  levelKeys: { [key: string]: LevelKey | undefined } | undefined,
) {
  const widevineKey = levelKeys?.[KeySystemFormats.WIDEVINE];
  if (widevineKey) {
    return widevineKey.keyId;
  }
  return null;
}

function getKeyIdFromPlayReadyKey(
  levelKeys: { [key: string]: LevelKey | undefined } | undefined,
) {
  const playReadyKey = levelKeys?.[KeySystemFormats.PLAYREADY];
  if (playReadyKey) {
    const playReadyKeyBytes = convertDataUriToArrayBytes(playReadyKey.uri);
    if (playReadyKeyBytes) {
      return parsePlayReadyWRM(playReadyKeyBytes);
    }
  }
  return null;
}
