import AudioStreamController from '../controller/audio-stream-controller';
import AudioTrackController from '../controller/audio-track-controller';
import type { HlsConfig } from '../config';

export const altAudio: Partial<HlsConfig> = {
  audioStreamController: AudioStreamController,
  audioTrackController: AudioTrackController,
};
