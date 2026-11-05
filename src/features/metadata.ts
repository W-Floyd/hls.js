import ID3TrackController from '../controller/id3-track-controller';
import type { HlsConfig } from '../config';

export const metadata: Partial<HlsConfig> = {
  id3TrackController: ID3TrackController,
};
