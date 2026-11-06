// MediaSource hand-over between Hls instances (hls.transferMedia() and
// attachMedia with a transferred MediaSource), used by interstitials and
// iframes; installed as featureHooks.mediaTransfer by those features.
import { sourceBufferNameToIndex } from './buffer-controller';
import { Events } from '../events';
import { BufferHelper } from '../utils/buffer-helper';
import { isCompatibleTrackChange } from '../utils/mediasource-helper';
import { stringify } from '../utils/safe-json-stringify';
import type BufferOperationQueue from './buffer-operation-queue';
import type { FragmentTracker } from './fragment-tracker';
import type Hls from '../hls';
import type { LevelDetails } from '../loader/level-details';
import type {
  AttachMediaSourceData,
  EmptyTuple,
  SourceBufferName,
  SourceBuffersTuple,
  SourceBufferTrack,
  SourceBufferTrackSet,
} from '../types/buffer';
import type { MediaAttachingData } from '../types/events';
import type { PlaylistLevelType } from '../types/loader';

/** The BufferController members the hand-over uses. */
export type TransferHost = {
  hls: Hls;
  media: HTMLMediaElement | null;
  mediaSource: MediaSource | null;
  transferData?: MediaAttachingData;
  tracks: SourceBufferTrackSet;
  sourceBuffers: SourceBuffersTuple;
  operationQueue: BufferOperationQueue | null;
  details: LevelDetails | null;
  fragmentTracker: FragmentTracker;
  bufferCodecEventsTotal: number;
  readonly tracksReady: boolean;
  readonly sourceBufferCount: number;
  readonly mediaSourceOpenOrEnded: boolean;
  _onMediaSourceOpen: (e?: Event) => void;
  log(message: string): void;
  warn(message: string): void;
  isUpdating(): boolean;
  isQueued(): boolean;
  removeBuffer(type: SourceBufferName): void;
  bufferCreated(): void;
  trackSourceBuffer(type: SourceBufferName, track: SourceBufferTrack): void;
  onMediaDetaching(event: Events.MEDIA_DETACHING, data: {}): void;
  onMediaAttaching(
    event: Events.MEDIA_ATTACHING,
    data: MediaAttachingData,
  ): void;
};

export function transferMedia(
  host: TransferHost,
): AttachMediaSourceData | null {
  const { media, mediaSource } = host;
  if (!media) {
    return null;
  }
  const tracks = {};
  if (host.operationQueue) {
    const updating = host.isUpdating();
    if (!updating) {
      host.operationQueue.removeBlockers();
    }
    const queued = host.isQueued();
    if (updating || queued) {
      host.warn(
        `Transfering MediaSource with${queued ? ' operations in queue' : ''}${updating ? ' updating SourceBuffer(s)' : ''} ${host.operationQueue}`,
      );
    }
    host.operationQueue.destroy();
  }
  const transferData = host.transferData;
  if (
    transferData &&
    !host.sourceBufferCount &&
    transferData.mediaSource === mediaSource
  ) {
    Object.assign(tracks, transferData.tracks);
  } else {
    host.sourceBuffers.forEach((tuple) => {
      const [type] = tuple;
      if (type) {
        tracks[type] = Object.assign({}, host.tracks[type]);
        host.removeBuffer(type);
      }
      tuple[0] = tuple[1] = null;
    });
  }
  return {
    media,
    mediaSource,
    tracks,
  };
}

export function attachTransferred(host: TransferHost) {
  const media = host.media;
  const data = host.transferData;
  if (!data || !media) {
    return;
  }
  const requiredTracks = host.tracks;
  const transferredTracks = data.tracks;
  const trackNames = transferredTracks ? Object.keys(transferredTracks) : null;
  const trackCount = trackNames ? trackNames.length : 0;
  const mediaSourceOpenCallback = () => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    Promise.resolve().then(() => {
      if (host.media && host.mediaSourceOpenOrEnded) {
        host._onMediaSourceOpen();
      }
    });
  };
  if (transferredTracks && trackNames && trackCount) {
    if (!host.tracksReady) {
      // Wait for CODECS event(s)
      host.hls.config.startFragPrefetch = true;
      host.log(`attachTransferred: waiting for SourceBuffer track info`);
      return;
    }
    host.log(`attachTransferred: (bufferCodecEventsTotal ${host.bufferCodecEventsTotal})
required tracks: ${stringify(requiredTracks, (key, value) => (key === 'initSegment' ? undefined : value))};
transfer tracks: ${stringify(transferredTracks, (key, value) => (key === 'initSegment' ? undefined : value))}}`);
    if (!isCompatibleTrackChange(transferredTracks, requiredTracks)) {
      // destroy attaching media source
      data.mediaSource = null;
      data.tracks = undefined;

      const currentTime = media.currentTime;

      const details = host.details;
      const startTime = Math.max(currentTime, details?.fragments[0].start || 0);
      if (startTime - currentTime > 1) {
        host.log(
          `attachTransferred: waiting for playback to reach new tracks start time ${currentTime} -> ${startTime}`,
        );
        return;
      }
      host.warn(
        `attachTransferred: resetting MediaSource for incompatible tracks ("${Object.keys(transferredTracks)}"->"${Object.keys(requiredTracks)}") start time: ${startTime} currentTime: ${currentTime}`,
      );
      host.onMediaDetaching(Events.MEDIA_DETACHING, {});
      host.onMediaAttaching(Events.MEDIA_ATTACHING, data);
      media.currentTime = startTime;
      return;
    }
    host.transferData = undefined;
    trackNames.forEach((trackName) => {
      const type = trackName as SourceBufferName;
      const track = transferredTracks[type];
      if (track) {
        const sb = track.buffer;
        if (sb) {
          // Purge fragment tracker of ejected segments for existing buffer
          const fragmentTracker = host.fragmentTracker;
          const playlistType = track.id as PlaylistLevelType;
          if (
            fragmentTracker.hasFragments(playlistType) ||
            fragmentTracker.hasParts(playlistType)
          ) {
            const bufferedTimeRanges = BufferHelper.getBuffered(sb);
            fragmentTracker.detectEvictedFragments(
              type,
              bufferedTimeRanges,
              playlistType,
              null,
              null,
              true,
            );
          }
          // Transfer SourceBuffer
          const sbIndex = sourceBufferNameToIndex(type);
          const sbTuple = [type, sb] as Exclude<
            SourceBuffersTuple[typeof sbIndex],
            EmptyTuple
          >;
          host.sourceBuffers[sbIndex] = sbTuple as any;
          if (sb.updating && host.operationQueue) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            host.operationQueue.prependBlocker(type);
          }
          host.trackSourceBuffer(type, track);
        }
      }
    });
    mediaSourceOpenCallback();
    host.bufferCreated();
  } else {
    host.log(`attachTransferred: MediaSource w/o SourceBuffers`);
    mediaSourceOpenCallback();
  }
}
