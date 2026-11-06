import { createAuto } from './auto';

// Captured while this classic script runs; it is null once loading finishes.
const script = self.document?.currentScript as HTMLScriptElement | null;

export const { attach, loadHls, detectFeatures } = createAuto(
  script ? new URL('.', script.src).href : self.location.href,
  'iife',
);
