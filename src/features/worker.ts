import { canStart, start, terminate } from '../demux/transmuxer-worker-client';
import { featureHooks } from '../utils/feature-hooks';
import type { HlsConfig } from '../config';

featureHooks.transmuxWorker = { canStart, start, terminate };

/** Transmuxing in a Web Worker (`enableWorker`); without it, on the main thread. */
export const worker: Partial<HlsConfig> = {};
