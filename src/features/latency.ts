import LatencyController from '../controller/latency-controller';
import type { HlsConfig } from '../config';

export const latency: Partial<HlsConfig> = {
  latencyController: LatencyController,
};
