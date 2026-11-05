import FPSController from '../controller/fps-controller';
import type { HlsConfig } from '../config';

export const fps: Partial<HlsConfig> = {
  fpsController: FPSController,
};
