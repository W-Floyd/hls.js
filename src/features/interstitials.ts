import InterstitialsController from '../controller/interstitials-controller';
import type { HlsConfig } from '../config';

export const interstitials: Partial<HlsConfig> = {
  interstitialsController: InterstitialsController,
};
