import { featureHooks } from '../utils/feature-hooks';
import * as variableSubstitutionImpl from '../utils/variable-substitution';
import type { HlsConfig } from '../config';

// Playlist parsing has no config access; EXT-X-DEFINE is enabled by importing this.
featureHooks.variableSubstitution = variableSubstitutionImpl;

export const variableSubstitution: Partial<HlsConfig> = {};
