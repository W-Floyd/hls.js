// HTTP(S)/data-URL loading of clear-key (identity) keys for KeyLoader,
// installed by the aes feature.
import { createKeyLoadError } from './key-loader';
import { ErrorDetails } from '../errors';
import { LoaderContextType } from '../types/loader';
import { arrayToHex } from '../utils/hex';
import type { KeyLoaderInfo } from './key-loader';
import type { HlsConfig } from '../config';
import type { EncryptedFragment } from '../loader/fragment';
import type { KeyLoadedData } from '../types/events';
import type {
  KeyLoaderContext,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderResponse,
  LoaderStats,
} from '../types/loader';
import type { NullableNetworkDetails } from '../types/network-details';
import type { ILogger } from '../utils/logger';

export function loadKeyHTTP(
  frag: EncryptedFragment,
  keyLoaderInfo: { [keyId: string]: KeyLoaderInfo | undefined },
  config: HlsConfig,
  logger: Pick<ILogger, 'log'>,
): Promise<KeyLoadedData> {
  const decryptdata = frag.decryptdata;
  const uri = decryptdata.uri;
  if (!uri) {
    return Promise.reject(
      createKeyLoadError(
        frag,
        ErrorDetails.KEY_LOAD_ERROR,
        new Error(`Invalid key URI: "${uri}"`),
      ),
    );
  }

  const cachedKeyInfo = keyLoaderInfo[uri];
  if (cachedKeyInfo) {
    // LevelKey matches previously loaded key
    if (cachedKeyInfo.decryptdata.key) {
      decryptdata.key = cachedKeyInfo.decryptdata.key;
      cachedKeyInfo.keyLoadPromise = null;
      return Promise.resolve({ frag, keyInfo: cachedKeyInfo });
    }
    // LevelKey loading for other fragment
    if (cachedKeyInfo.keyLoadPromise) {
      return cachedKeyInfo.keyLoadPromise.then((keyLoadedData) => {
        decryptdata.key = cachedKeyInfo.decryptdata.key;
        return { ...keyLoadedData, frag };
      });
    }
  }

  logger.log(
    `Loading${decryptdata.keyId ? ' keyId: ' + arrayToHex(decryptdata.keyId) : ''} URI: ${decryptdata.uri} from ${frag.type} ${frag.level}`,
  );

  // Load LevelKey
  const Loader = config.loader;
  const keyLoader = new Loader(config) as Loader<KeyLoaderContext>;
  frag.keyLoader = keyLoader;

  const keyInfo: KeyLoaderInfo = (keyLoaderInfo[uri] = {
    decryptdata,
    keyLoadPromise: null,
    loader: keyLoader,
  });

  return (keyInfo.keyLoadPromise = new Promise((resolve, reject) => {
    const loaderContext: KeyLoaderContext = {
      type: LoaderContextType.KEY,
      keyInfo,
      frag,
      responseType: 'arraybuffer',
      url: uri,
    };

    // maxRetry is 0 so that instead of retrying the same key on the same variant multiple times,
    // key-loader will trigger an error and rely on stream-controller to handle retry logic.
    // this will also align retry logic with fragment-loader
    const loadPolicy = config.keyLoadPolicy.default;
    const loaderConfig: LoaderConfiguration = {
      loadPolicy,
      timeout: loadPolicy.maxLoadTimeMs,
      maxRetry: 0,
      retryDelay: 0,
      maxRetryDelay: 0,
    };

    const loaderCallbacks: LoaderCallbacks<KeyLoaderContext> = {
      onSuccess: (
        response: LoaderResponse,
        stats: LoaderStats,
        context: KeyLoaderContext,
        networkDetails: NullableNetworkDetails,
      ) => {
        const { frag, keyInfo, url } = context;
        if (!frag.decryptdata || keyInfo !== keyLoaderInfo[url]) {
          resetLoader(keyLoaderInfo, context);
          return reject(
            createKeyLoadError(
              frag,
              ErrorDetails.KEY_LOAD_ERROR,
              new Error('after key load, decryptdata unset or changed'),
              networkDetails,
            ),
          );
        }

        keyInfo.decryptdata.key = frag.decryptdata.key = new Uint8Array(
          response.data as ArrayBuffer,
        );

        // detach fragment key loader on load success
        frag.keyLoader = keyInfo.loader = keyInfo.keyLoadPromise = null;
        resolve({ frag, keyInfo });
      },

      onError: (
        response: { code: number; text: string },
        context: KeyLoaderContext,
        networkDetails: NullableNetworkDetails,
        stats: LoaderStats,
      ) => {
        resetLoader(keyLoaderInfo, context);
        reject(
          createKeyLoadError(
            frag,
            ErrorDetails.KEY_LOAD_ERROR,
            new Error(
              `HTTP Error ${response.code} loading key ${response.text}`,
            ),
            networkDetails,
            { url: uri, data: undefined, ...response },
          ),
        );
      },

      onTimeout: (
        stats: LoaderStats,
        context: KeyLoaderContext,
        networkDetails: NullableNetworkDetails,
      ) => {
        resetLoader(keyLoaderInfo, context);
        reject(
          createKeyLoadError(
            frag,
            ErrorDetails.KEY_LOAD_TIMEOUT,
            new Error('key loading timed out'),
            networkDetails,
          ),
        );
      },

      onAbort: (
        stats: LoaderStats,
        context: KeyLoaderContext,
        networkDetails: NullableNetworkDetails,
      ) => {
        resetLoader(keyLoaderInfo, context);
        reject(
          createKeyLoadError(
            frag,
            ErrorDetails.INTERNAL_ABORTED,
            new Error('key loading aborted'),
            networkDetails,
          ),
        );
      },
    };

    keyLoader.load(loaderContext, loaderConfig, loaderCallbacks);
  }));
}

function resetLoader(
  keyLoaderInfo: { [keyId: string]: KeyLoaderInfo | undefined },
  context: KeyLoaderContext,
) {
  const { frag, keyInfo, url } = context;
  const loader = keyInfo.loader;
  if (frag.keyLoader === loader) {
    frag.keyLoader = keyInfo.loader = keyInfo.keyLoadPromise = null;
  }
  delete keyLoaderInfo[url];
  if (loader) {
    loader.destroy();
  }
}
