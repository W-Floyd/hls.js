import { Events } from '../events';
import type Hls from '../hls';
import type { AbrComponentAPI } from '../types/component-api';

/**
 * Level selection without adaptive bitrate (the core default; the abr feature
 * supplies AbrController). Auto mode starts on the first listed level within
 * the level caps and only moves when error handling, the app or a cap changes
 * it. Without a bandwidth estimator, `hls.bandwidthEstimate` is NaN.
 */
export default class FixedLevelController implements AbrComponentAPI {
  public forcedAutoLevel: number = -1;
  private hls: Hls;

  constructor(hls: Hls) {
    this.hls = hls;
    hls.on(Events.MANIFEST_LOADING, this.onManifestLoading, this);
  }

  public get firstAutoLevel(): number {
    const { firstLevel, minAutoLevel, maxAutoLevel } = this.hls;
    return Math.min(Math.max(firstLevel, minAutoLevel), maxAutoLevel);
  }

  public get nextAutoLevel(): number {
    return this.forcedAutoLevel > -1
      ? this.forcedAutoLevel
      : this.firstAutoLevel;
  }

  public set nextAutoLevel(level: number) {
    this.forcedAutoLevel = level;
  }

  public resetEstimator() {}

  public destroy() {
    this.hls.off(Events.MANIFEST_LOADING, this.onManifestLoading, this);
  }

  private onManifestLoading() {
    this.forcedAutoLevel = -1;
  }
}
