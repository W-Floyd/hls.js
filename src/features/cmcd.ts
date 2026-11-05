import CMCDController from '../controller/cmcd-controller';
import type { HlsConfig } from '../config';

export const cmcd: Partial<HlsConfig> = {
  cmcdController: CMCDController,
};
