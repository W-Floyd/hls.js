import { ErrorActionFlags } from './error-controller';
import { HdcpLevels } from '../types/level';
import { PlaylistLevelType } from '../types/loader';
import { arrayToHex } from '../utils/hex';
import type { IErrorAction } from './error-controller';
import type Hls from '../hls';
import type { LevelKey } from '../loader/level-key';
import type { ErrorData } from '../types/events';
import type { Level } from '../types/level';
import type { ILogger } from '../utils/logger';

// HDCP and key-system error handling for ErrorController, reached through
// config.emeController so it ships with the eme-drm feature.
export function resolveKeyErrorAction(
  hls: Hls,
  data: ErrorData,
  errorAction: IErrorAction,
  level: Level | undefined,
  logger: Pick<ILogger, 'log' | 'warn'>,
) {
  if (errorAction.flags & ErrorActionFlags.MoveAllAlternatesMatchingHDCP) {
    const restrictedHdcpLevel = (level as Level | undefined)?.attrs[
      'HDCP-LEVEL'
    ];
    errorAction.hdcpLevel = restrictedHdcpLevel;
    const restrictedOutputErrorWhileNoneDeclared =
      restrictedHdcpLevel === 'NONE';
    if (restrictedHdcpLevel && !restrictedOutputErrorWhileNoneDeclared) {
      hls.maxHdcpLevel =
        HdcpLevels[HdcpLevels.indexOf(restrictedHdcpLevel) - 1];
      errorAction.resolved = true;
      logger.warn(
        `Restricting playback to HDCP-LEVEL of "${hls.maxHdcpLevel}" or lower`,
      );
    } else {
      if (restrictedOutputErrorWhileNoneDeclared) {
        logger.warn(`HDCP policy resticted output with HDCP-LEVEL=NONE`);
      }
      // Move alternates matching key when no HDCP-LEVEL attribute is found
      errorAction.flags |= ErrorActionFlags.MoveAllAlternatesMatchingKey;
    }
  }
  if (errorAction.flags & ErrorActionFlags.MoveAllAlternatesMatchingKey) {
    const levelKey = data.decryptdata;
    if (levelKey) {
      // Penalize all levels with key
      const levels = hls.levels;
      const levelCountWithError = levels.length;
      for (let i = levelCountWithError; i--; ) {
        if (variantHasKey(hls, levels[i], levelKey)) {
          logger.log(
            `Banned key found in level ${i} (${levels[i].bitrate}bps) or audio group "${levels[i].audioGroups?.join(',')}" (${data.frag?.type} fragment) ${arrayToHex(levelKey.keyId || [])}`,
          );
          levels[i].fragmentError++;
          levels[i].loadError++;
          logger.log(`Removing level ${i} with key error (${data.error})`);
          hls.removeLevel(i);
        }
      }
      const frag = data.frag;
      if (hls.levels.length < levelCountWithError) {
        errorAction.resolved = true;
      } else if (frag && frag.type !== PlaylistLevelType.MAIN) {
        // Ignore key error for audio track with unmatched key (main session error)
        const fragLevelKey = frag.decryptdata;
        if (fragLevelKey && !levelKey.matches(fragLevelKey)) {
          errorAction.resolved = true;
        }
      }
    }
  }
}

function variantHasKey(
  hls: Hls,
  level: Level | undefined,
  keyInError: LevelKey,
): boolean {
  if (level) {
    if (level.details?.hasKey(keyInError)) {
      return true;
    }
    const audioGroupsIds = level.audioGroups;
    if (audioGroupsIds) {
      const audioTracks = hls.allAudioTracks.filter(
        (track) => audioGroupsIds.indexOf(track.groupId) >= 0,
      );
      return audioTracks.some((track) => track.details?.hasKey(keyInError));
    }
  }
  return false;
}
