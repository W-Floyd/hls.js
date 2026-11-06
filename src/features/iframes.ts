import './iframe-remux';
import './media-transfer';
import { IFrameController } from '../controller/iframe-controller';
import type { HlsConfig } from '../config';

export const iframes: Partial<HlsConfig> = {
  iframeController: IFrameController,
};
