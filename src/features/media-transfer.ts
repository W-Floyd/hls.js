import { attachTransferred, transferMedia } from '../controller/media-transfer';
import { featureHooks } from '../utils/feature-hooks';

// MediaSource hand-over between player instances (asset players, I-frame player).
featureHooks.mediaTransfer = { attachTransferred, transferMedia };
