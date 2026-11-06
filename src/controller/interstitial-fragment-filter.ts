import type { HlsAssetPlayer } from './interstitial-player';
import type { InterstitialsManager } from './interstitials-controller';
import type { MediaFragment, Part } from '../loader/fragment';
import type { LevelDetails } from '../loader/level-details';

export function fragOverlapsQueuedInterstitial(
  frag: MediaFragment | Part,
  playerQueue: HlsAssetPlayer[] | undefined,
  playhead: number,
): boolean {
  if (playerQueue) {
    for (let i = playerQueue.length; i--; ) {
      const interstitial = playerQueue[i].interstitial;
      const start = interstitial.startTime;
      const end = Math.min(
        start + interstitial.duration,
        interstitial.resumeTime,
      );
      if (interstitial.appendInPlace) {
        if (frag.start >= start && frag.end <= end) {
          return true;
        }
        if (playhead > frag.start && frag.end > start && frag.start < end) {
          return true;
        }
      }
    }
  }
  return false;
}

// Primary (non-subtitle) fragments outside the buffering schedule item are not loaded.
export function filterReplacedPrimary<T extends MediaFragment | Part>(
  frag: T,
  details: LevelDetails | undefined,
  interstitials: InterstitialsManager | null,
  playhead: number,
): T | null {
  const bufferingItem = interstitials?.bufferingItem;
  if (bufferingItem) {
    const bufferingInterstitial = bufferingItem.event;
    if (bufferingInterstitial) {
      // Do not stream fragments while buffering Interstitial Events (except for overlap at the start)
      if (
        !bufferingInterstitial.appendInPlace &&
        (Math.abs(frag.start - bufferingItem.start) > 1 ||
          bufferingItem.start === 0)
      ) {
        return null;
      }
    } else {
      if (frag.end <= bufferingItem.start && details?.live === false) {
        return null;
      }
      if (frag.start >= bufferingItem.end && bufferingItem.nextEvent) {
        // allow some overflow when not appending in place to prevent stalls
        if (
          (bufferingItem.nextEvent.appendInPlace &&
            !bufferingItem.nextEvent.hasPlayed) ||
          frag.start - bufferingItem.end > 1
        ) {
          return null;
        }
      }
    }
  }
  // Skip fragments that overlap completely with appendInPlace interstitials
  if (
    fragOverlapsQueuedInterstitial(frag, interstitials?.playerQueue, playhead)
  ) {
    return null;
  }
  return frag;
}
