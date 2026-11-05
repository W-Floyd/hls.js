import type { Level } from '../types/level';
import type {
  AudioSelectionOption,
  MediaPlaylist,
  SubtitleSelectionOption,
  VideoSelectionOption,
} from '../types/media-playlist';

export function getBasicSelectionOption(
  option:
    | MediaPlaylist
    | AudioSelectionOption
    | SubtitleSelectionOption
    | undefined,
): Partial<AudioSelectionOption | SubtitleSelectionOption> | undefined {
  if (!option) {
    return option;
  }
  const { lang, assocLang, characteristics, channels, audioCodec } =
    option as AudioSelectionOption;
  return { lang, assocLang, characteristics, channels, audioCodec };
}

export function findMatchingOption(
  option: MediaPlaylist | AudioSelectionOption | SubtitleSelectionOption,
  tracks: MediaPlaylist[],
  matchPredicate?: (
    option: MediaPlaylist | AudioSelectionOption | SubtitleSelectionOption,
    track: MediaPlaylist,
  ) => boolean,
): number {
  if ('attrs' in option) {
    const index = tracks.indexOf(option);
    if (index !== -1) {
      return index;
    }
  }
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (matchesOption(option, track, matchPredicate)) {
      return i;
    }
  }
  return -1;
}

export function matchesOption(
  option: MediaPlaylist | AudioSelectionOption | SubtitleSelectionOption,
  track: MediaPlaylist,
  matchPredicate?: (
    option: MediaPlaylist | AudioSelectionOption | SubtitleSelectionOption,
    track: MediaPlaylist,
  ) => boolean,
): boolean {
  const { groupId, name, lang, assocLang, default: isDefault } = option;
  const forced = (option as SubtitleSelectionOption).forced;
  return (
    (groupId === undefined || track.groupId === groupId) &&
    (name === undefined || track.name === name) &&
    (lang === undefined || languagesMatch(lang, track.lang)) &&
    (assocLang === undefined || track.assocLang === assocLang) &&
    (isDefault === undefined || track.default === isDefault) &&
    (forced === undefined || track.forced === forced) &&
    (!('characteristics' in option) ||
      characteristicsMatch(
        option.characteristics || '',
        track.characteristics,
      )) &&
    (matchPredicate === undefined || matchPredicate(option, track))
  );
}

function languagesMatch(languageA: string, languageB: string = '--'): boolean {
  if (languageA.length === languageB.length) {
    return languageA === languageB;
  }
  return languageA.startsWith(languageB) || languageB.startsWith(languageA);
}

function characteristicsMatch(
  characteristicsA: string,
  characteristicsB: string = '',
): boolean {
  const arrA = characteristicsA.split(',');
  const arrB = characteristicsB.split(',');
  // Expects each item to be unique:
  return (
    arrA.length === arrB.length && !arrA.some((el) => arrB.indexOf(el) === -1)
  );
}

export function audioMatchPredicate(
  option: MediaPlaylist | AudioSelectionOption,
  track: MediaPlaylist,
) {
  const { audioCodec, channels } = option;
  return (
    (audioCodec === undefined ||
      (track.audioCodec || '').substring(0, 4) ===
        audioCodec.substring(0, 4)) &&
    (channels === undefined || channels === (track.channels || '2'))
  );
}

export function findClosestLevelWithAudioGroup(
  option: MediaPlaylist | AudioSelectionOption,
  levels: Level[],
  allAudioTracks: MediaPlaylist[],
  searchIndex: number,
  matchPredicate: (
    option: MediaPlaylist | AudioSelectionOption,
    track: MediaPlaylist,
  ) => boolean,
): number {
  const currentLevel = levels[searchIndex];
  // Are there variants with same URI as current level?
  // If so, find a match that does not require any level URI change
  const variants = levels.reduce(
    (variantMap: { [uri: string]: number[] }, level, index) => {
      const uri = level.uri;
      const renditions = variantMap[uri] || (variantMap[uri] = []);
      renditions.push(index);
      return variantMap;
    },
    {},
  );
  const renditions = variants[currentLevel.uri];
  if (renditions.length > 1) {
    searchIndex = Math.max.apply(Math, renditions);
  }
  // Find best match
  const currentVideoRange = currentLevel.videoRange;
  const currentFrameRate = currentLevel.frameRate;
  const currentVideoCodec = currentLevel.codecSet.substring(0, 4);
  const matchingVideo = searchDownAndUpList(
    levels,
    searchIndex,
    (level: Level) => {
      if (
        level.videoRange !== currentVideoRange ||
        level.frameRate !== currentFrameRate ||
        level.codecSet.substring(0, 4) !== currentVideoCodec
      ) {
        return false;
      }
      const audioGroups = level.audioGroups;
      const tracks = allAudioTracks.filter((track): boolean =>
        inGroupOrNone(track.groupId, audioGroups),
      );
      return findMatchingOption(option, tracks, matchPredicate) > -1;
    },
  );
  if (matchingVideo > -1) {
    return matchingVideo;
  }
  return searchDownAndUpList(levels, searchIndex, (level: Level) => {
    const audioGroups = level.audioGroups;
    const tracks = allAudioTracks.filter((track): boolean =>
      inGroupOrNone(track.groupId, audioGroups),
    );
    return findMatchingOption(option, tracks, matchPredicate) > -1;
  });
}

function searchDownAndUpList(
  arr: any[],
  searchIndex: number,
  predicate: (item: any) => boolean,
): number {
  for (let i = searchIndex; i > -1; i--) {
    if (predicate(arr[i])) {
      return i;
    }
  }
  for (let i = searchIndex + 1; i < arr.length; i++) {
    if (predicate(arr[i])) {
      return i;
    }
  }
  return -1;
}

export function inGroupOrNone(
  groupId: string | undefined,
  groupIds: (string | undefined)[] | null | undefined,
): boolean {
  if (!groupIds) {
    return true;
  }
  return groupIds.indexOf(groupId) !== -1;
}

export function getVideoPreference(
  level: Level | null | undefined,
  basePreference?: VideoSelectionOption,
): VideoSelectionOption | undefined {
  if (basePreference || level) {
    const videoPreference = Object.assign({}, basePreference);
    if (level) {
      if (level.videoCodec) {
        videoPreference.videoCodec = level.videoCodec;
      }
      if (level.videoRange) {
        videoPreference.allowedVideoRanges = [level.videoRange];
      }
    }
    return videoPreference;
  }
}
