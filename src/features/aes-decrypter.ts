import Decrypter from '../crypt/decrypter';
import { featureHooks } from '../utils/feature-hooks';

// Decryption also runs in the transmuxer, which may be in a worker without config.
featureHooks.decrypter = Decrypter;
