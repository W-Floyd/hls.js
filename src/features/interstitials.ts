import InterstitialsController from '../controller/interstitials-controller';
import './media-transfer';
import type { HlsConfig } from '../config';

export const interstitials: Partial<HlsConfig> = {
  interstitialsController: InterstitialsController,
};
