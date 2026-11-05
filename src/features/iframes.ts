import './iframe-remux';
import { IFrameController } from '../controller/iframe-controller';
import type { HlsConfig } from '../config';

export const iframes: Partial<HlsConfig> = {
  iframeController: IFrameController,
};
