import { remuxIFrameFragment } from '../remux/passthrough-iframes';
import { featureHooks } from '../utils/feature-hooks';
import { videoOnlyInitSegment } from '../utils/mp4-iframes';

// I-Frame remuxing runs in the transmuxer, which may be in a worker without config.
featureHooks.iframeRemux = { videoOnlyInitSegment, remuxIFrameFragment };
