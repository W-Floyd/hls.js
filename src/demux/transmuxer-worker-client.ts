// Runs TransmuxerInterface's transmuxer in a Web Worker; installed as
// featureHooks.transmuxWorker by the worker feature. Without it, transmuxing
// runs on the main thread.
import {
  hasUMDWorker,
  injectWorker,
  loadWorker,
  removeWorkerFromStore,
} from './inject-worker';
import { ErrorDetails, ErrorTypes } from '../errors';
import { Events } from '../events';
import { stringify } from '../utils/safe-json-stringify';
import type { WorkerContext } from './inject-worker';
import type { HlsConfig } from '../config';
import type { HlsListeners } from '../events';
import type Hls from '../hls';
import type { MediaFragment, Part } from '../loader/fragment';
import type { PlaylistLevelType } from '../types/loader';
import type { ChunkMetadata, TransmuxerResult } from '../types/transmuxer';
import type { TypeSupported } from '../utils/codecs';

/** The TransmuxerInterface members the worker client uses. */
export type WorkerHost = {
  hls: Hls | null;
  id: PlaylistLevelType;
  instanceNo: number;
  frag: MediaFragment | null;
  part: Part | null;
  workerContext: WorkerContext | null;
  handleTransmuxComplete(result: TransmuxerResult): void;
  onFlush(chunkMeta: ChunkMetadata): void;
};

type ClientContext = WorkerContext & {
  onMessage?: (event: MessageEvent) => void;
  onError?: (event: ErrorEvent) => void;
};

export const canStart = (config: HlsConfig) =>
  !!(config.workerPath || hasUMDWorker());

export function start(
  host: WorkerHost,
  typeSupported: TypeSupported,
): WorkerContext {
  const hls = host.hls!;
  const { config, logger } = hls;
  const { id } = host;
  let context: ClientContext;
  if (config.workerPath) {
    logger.log(`loading Web Worker ${config.workerPath} for "${id}"`);
    context = loadWorker(config.workerPath);
  } else {
    logger.log(`injecting Web Worker for "${id}"`);
    context = injectWorker();
  }
  const onMessage = (context.onMessage = (
    event: MessageEvent<{
      event: string;
      data?: any;
      instanceNo?: number;
    } | null>,
  ) => onWorkerMessage(host, event));
  const onError = (context.onError = (event: ErrorEvent) =>
    onWorkerError(host, event));
  const { worker } = context;
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.postMessage({
    instanceNo: host.instanceNo,
    cmd: 'init',
    typeSupported,
    id,
    config: stringify(config),
  });
  return context;
}

export function terminate(
  context: ClientContext,
  workerPath: string | null | undefined,
) {
  const { worker, onMessage, onError } = context;
  if (onMessage) worker.removeEventListener('message', onMessage);
  if (onError) worker.removeEventListener('error', onError);
  context.onMessage = context.onError = undefined;
  removeWorkerFromStore(workerPath);
}

function onWorkerMessage(
  host: WorkerHost,
  event: MessageEvent<{
    event: string;
    data?: any;
    instanceNo?: number;
  } | null>,
) {
  const data = event.data;
  const hls = host.hls;
  if (!hls || !data?.event || data.instanceNo !== host.instanceNo) {
    return;
  }
  switch (data.event) {
    case 'init': {
      const objectURL = host.workerContext?.objectURL;
      if (objectURL) {
        // revoke the Object URL that was used to create transmuxer worker, so as not to leak it
        self.URL.revokeObjectURL(objectURL);
      }
      break;
    }

    case 'transmuxComplete': {
      host.handleTransmuxComplete(data.data);
      break;
    }

    case 'flush': {
      host.onFlush(data.data);
      break;
    }

    // pass logs from the worker thread to the main logger
    case 'workerLog': {
      if (hls.logger[data.data.logType]) {
        hls.logger[data.data.logType](data.data.message);
      }
      break;
    }

    default: {
      data.data = data.data || {};
      data.data.frag = host.frag;
      data.data.part = host.part;
      data.data.id = host.id;
      hls.trigger(data.event as keyof HlsListeners, data.data);
      break;
    }
  }
}

function onWorkerError(host: WorkerHost, event: ErrorEvent) {
  const hls = host.hls;
  if (!hls) {
    return;
  }
  const error = new Error(
    `${event.message}  (${event.filename}:${event.lineno})`,
  );
  hls.config.enableWorker = false;
  hls.logger.warn(`Error in "${host.id}" Web Worker, fallback to inline`);
  hls.trigger(Events.ERROR, {
    type: ErrorTypes.OTHER_ERROR,
    details: ErrorDetails.INTERNAL_EXCEPTION,
    fatal: false,
    event: 'demuxerWorker',
    error,
  });
}
