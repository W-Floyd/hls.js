import FetchLoader, { fetchSupported } from '../utils/fetch-loader';
import type { HlsConfig } from '../config';

export { FetchLoader, fetchSupported };

export const progressive: Partial<HlsConfig> = {
  progressiveLoader: FetchLoader,
};
