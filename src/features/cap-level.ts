import CapLevelController from '../controller/cap-level-controller';
import type { HlsConfig } from '../config';

export const capLevel: Partial<HlsConfig> = {
  capLevelController: CapLevelController,
};
