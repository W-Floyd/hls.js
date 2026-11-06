import AbrController from '../controller/abr-controller';
import type { HlsConfig } from '../config';

/** Adaptive bitrate level selection; without it, auto mode stays on one level. */
export const abr: Partial<HlsConfig> = {
  abrController: AbrController,
};
