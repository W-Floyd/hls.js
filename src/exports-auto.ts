import { createAuto } from './auto';

export type { AutoOptions } from './auto';

export const { attach, loadHls, detectFeatures } = createAuto(
  new URL('.', import.meta.url).href,
  'esm',
);
