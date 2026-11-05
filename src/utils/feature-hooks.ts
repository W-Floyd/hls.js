import type { videoOnlyInitSegment } from './mp4-iframes';
import type * as VariableSubstitution from './variable-substitution';
import type { remuxIFrameFragment } from '../remux/passthrough-iframes';

// Implementations for modules without config access (static parsers, code that
// may run in the transmux worker), set by importing the feature providing them.
export const featureHooks: {
  variableSubstitution?: typeof VariableSubstitution;
  iframeRemux?: {
    videoOnlyInitSegment: typeof videoOnlyInitSegment;
    remuxIFrameFragment: typeof remuxIFrameFragment;
  };
} = {};
