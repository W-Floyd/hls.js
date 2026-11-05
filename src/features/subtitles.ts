import { SubtitleStreamController } from '../controller/subtitle-stream-controller';
import SubtitleTrackController from '../controller/subtitle-track-controller';
import { TimelineController } from '../controller/timeline-controller';
import type { HlsConfig } from '../config';

export const subtitles: Partial<HlsConfig> = {
  subtitleStreamController: SubtitleStreamController,
  subtitleTrackController: SubtitleTrackController,
  timelineController: TimelineController,
};
