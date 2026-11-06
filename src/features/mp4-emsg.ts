import { featureHooks } from '../utils/feature-hooks';
import { extractEmsgSamples } from '../utils/mp4-emsg';

// emsg parsing runs in the transmuxer, which may be in a worker without config.
featureHooks.emsg = { extractEmsgSamples };
