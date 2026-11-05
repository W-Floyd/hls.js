import EMEController from '../controller/eme-controller';
import { LevelKey } from '../loader/level-key';
import { levelKeyDrm } from '../loader/level-key-drm';
import { requestMediaKeySystemAccess } from '../utils/mediakeys-helper';
import type { HlsConfig } from '../config';

// LevelKey has no config access; key-system parsing is enabled by importing this.
LevelKey.drm = levelKeyDrm;

export const emeDrm: Partial<HlsConfig> = {
  emeController: EMEController,
  requestMediaKeySystemAccessFunc: requestMediaKeySystemAccess,
};
