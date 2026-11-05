import ContentSteeringController from '../controller/content-steering-controller';
import type { HlsConfig } from '../config';

export const contentSteering: Partial<HlsConfig> = {
  contentSteeringController: ContentSteeringController,
};
