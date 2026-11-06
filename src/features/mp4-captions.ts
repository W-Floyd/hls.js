import { featureHooks } from '../utils/feature-hooks';
import {
  isSEIMessage,
  parseSamples,
  parseSEIMessageFromNALu,
} from '../utils/mp4-captions';

// fMP4 caption parsing runs in the transmuxer, which may be in a worker without config.
featureHooks.mp4Captions = {
  isSEIMessage,
  parseSamples,
  parseSEIMessageFromNALu,
};
