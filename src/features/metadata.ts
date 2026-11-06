import ID3TrackController from '../controller/id3-track-controller';
import './mp4-emsg';
import type { HlsConfig } from '../config';

export const metadata: Partial<HlsConfig> = {
  id3TrackController: ID3TrackController,
};
