import { LoadError } from './fragment-loader';
import { LevelKey } from './level-key';
import { ErrorDetails, ErrorTypes } from '../errors';
import {
  featureHooks,
  missingFeatureError,
  noDecrypterError,
} from '../utils/feature-hooks';
import { arrayToHex } from '../utils/hex';
import { Logger } from '../utils/logger';
import { parseKeyIdsFromTenc } from '../utils/mp4-tools';
import type { HlsConfig } from '../config';
import type EMEController from '../controller/eme-controller';
import type { EncryptedFragment, Fragment } from '../loader/fragment';
import type { ComponentAPI } from '../types/component-api';
import type { KeyLoadedData } from '../types/events';
import type {
  KeyLoaderContext,
  Loader,
  PlaylistLevelType,
} from '../types/loader';
import type { NullableNetworkDetails } from '../types/network-details';
import type { ILogger } from '../utils/logger';
import type { KeySystemFormats } from '../utils/mediakeys-helper';

export interface KeyLoaderInfo {
  decryptdata: LevelKey;
  keyLoadPromise?: Promise<KeyLoadedData> | null;
  loader?: Loader<KeyLoaderContext> | null;
}
export default class KeyLoader extends Logger implements ComponentAPI {
  private readonly config: HlsConfig;
  private keyLoaderInfo: { [keyId: string]: KeyLoaderInfo | undefined } = {};
  public emeController: EMEController | null = null;

  constructor(config: HlsConfig, logger: ILogger) {
    super('key-loader', logger);
    this.config = config;
  }

  public abort(type?: PlaylistLevelType) {
    for (const uri in this.keyLoaderInfo) {
      const loader = this.keyLoaderInfo[uri]!.loader;
      if (loader) {
        if (type && type !== loader.context?.frag.type) {
          return;
        }
        loader.abort();
      }
    }
  }

  public destroy() {
    for (const uri in this.keyLoaderInfo) {
      const loader = this.keyLoaderInfo[uri]!.loader;
      if (loader) {
        loader.destroy();
      }
    }
    this.emeController = null;
    this.keyLoaderInfo = {};
  }

  public loadClear(
    loadingFrag: Fragment,
    encryptedFragments: Fragment[],
    startFragRequested: boolean,
  ): Promise<void> | null {
    if (!__USE_ENCRYPTION__) {
      return null;
    }
    if (this.emeController) {
      return this.emeController.loadClear(
        loadingFrag,
        encryptedFragments,
        startFragRequested,
      );
    }
    return null;
  }

  public load(
    frag: Fragment,
    initDataPromise?: Promise<void>,
  ): Promise<KeyLoadedData> {
    if (!__USE_ENCRYPTION__) {
      return Promise.reject(noEncryptionError());
    }
    if (
      !frag.decryptdata &&
      frag.encrypted &&
      this.emeController &&
      this.config.emeEnabled
    ) {
      // Multiple keys, but none selected, resolve in eme-controller
      return this.emeController
        .selectKeySystemFormat(frag)
        .then((keySystemFormat) => {
          return this.loadInternal(frag, initDataPromise, keySystemFormat);
        });
    }

    return this.loadInternal(frag, initDataPromise);
  }

  private loadInternal(
    frag: Fragment,
    initDataPromise: Promise<void> | undefined,
    keySystemFormat?: KeySystemFormats,
  ): Promise<KeyLoadedData> {
    if (!__USE_ENCRYPTION__) {
      return Promise.reject(noEncryptionError());
    }
    if (__USE_EME_DRM__ && keySystemFormat) {
      frag.setKeyFormat(keySystemFormat);
    }
    const decryptdata = frag.decryptdata;
    if (!decryptdata) {
      const error = new Error(
        keySystemFormat
          ? `Expected frag.decryptdata to be defined after setting format ${keySystemFormat}`
          : `Missing decryption data on fragment in onKeyLoading (emeEnabled with controller: ${this.emeController && this.config.emeEnabled})`,
      );
      return Promise.reject(
        createKeyLoadError(frag, ErrorDetails.KEY_LOAD_ERROR, error),
      );
    }
    const encryptedFrag = frag as EncryptedFragment;

    // Return the key-load promise
    switch (decryptdata.method) {
      case 'SAMPLE-AES':
      case 'SAMPLE-AES-CENC':
      case 'SAMPLE-AES-CTR':
        if (decryptdata.keyFormat === 'identity') {
          // loadKeyHTTP handles http(s) and data URLs
          return this.loadKeyHTTP(encryptedFrag);
        }
        return initDataPromise
          ? initDataPromise.then(() => this.loadKeyEME(encryptedFrag))
          : this.loadKeyEME(encryptedFrag);
      case 'AES-128':
      case 'AES-256':
      case 'AES-256-CTR':
        return this.loadKeyHTTP(encryptedFrag);
      default:
        return Promise.reject(
          createKeyLoadError(
            frag,
            ErrorDetails.KEY_LOAD_ERROR,
            new Error(
              `Key supplied with unsupported METHOD: "${decryptdata.method}"`,
            ),
          ),
        );
    }
  }

  private loadKeyEME(frag: EncryptedFragment): Promise<KeyLoadedData> {
    if (!__USE_ENCRYPTION__) {
      return Promise.reject(noEncryptionError());
    }
    if (this.emeController && this.config.emeEnabled) {
      if (!frag.decryptdata.keyId && frag.initSegment?.data) {
        const keyIds = parseKeyIdsFromTenc(
          frag.initSegment.data as Uint8Array<ArrayBuffer>,
        );
        if (keyIds.length) {
          let keyId = keyIds[0];
          const keyUri = frag.decryptdata.uri;
          if (keyId.some((b) => b !== 0)) {
            this.log(
              `Using keyId found in init segment ${arrayToHex(keyId)} keyUri: ${keyUri}`,
            );
            LevelKey.setKeyIdForUri(keyUri, keyId);
          } else {
            const keyIdPatch = LevelKey.addKeyIdForUri(keyUri);
            this.log(
              `Patching empty keyId with ${arrayToHex(keyIdPatch)} keyUri: ${keyUri}`,
            );
            keyId = keyIdPatch;
          }
          frag.decryptdata.keyId = keyId;
        }
      }
      return this.emeController.loadKey(frag).then(() => ({
        frag,
        keyInfo: {
          decryptdata: frag.decryptdata,
        },
      }));
    }
    return Promise.reject(
      createKeyLoadError(
        frag,
        ErrorDetails.KEY_LOAD_ERROR,
        new Error(
          `emeEnabled with controller: ${this.emeController && this.config.emeEnabled})`,
        ),
      ),
    );
  }

  private loadKeyHTTP(frag: EncryptedFragment): Promise<KeyLoadedData> {
    if (!__USE_ENCRYPTION__) {
      return Promise.reject(noEncryptionError());
    }
    const loadKeyHTTP = __USE_AES__ && featureHooks.loadKeyHTTP;
    return loadKeyHTTP
      ? loadKeyHTTP(frag, this.keyLoaderInfo, this.config, this)
      : Promise.reject(
          createKeyLoadError(
            frag,
            ErrorDetails.KEY_LOAD_ERROR,
            noDecrypterError(),
          ),
        );
  }
}

// Unreachable in USE_ENCRYPTION=0 builds: the parser rejects EXT-X-KEY first.
const noEncryptionError = () =>
  missingFeatureError('Encryption needs a build with USE_ENCRYPTION on');

export function createKeyLoadError(
  frag: Fragment,
  details: ErrorDetails = ErrorDetails.KEY_LOAD_ERROR,
  error: Error,
  networkDetails?: NullableNetworkDetails,
  response?: { url: string; data: undefined; code: number; text: string },
): LoadError {
  return new LoadError({
    type: ErrorTypes.NETWORK_ERROR,
    details,
    fatal: false,
    frag,
    response,
    error,
    networkDetails: networkDetails || null,
  });
}
