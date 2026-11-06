import { EventEmitter } from 'eventemitter3';
import Transmuxer, {
  isPromise,
  TransmuxConfig,
  TransmuxState,
} from '../demux/transmuxer';
import { ErrorDetails, ErrorTypes } from '../errors';
import { Events } from '../events';
import { getM2TSSupportedAudioTypes } from '../utils/codecs';
import { featureHooks } from '../utils/feature-hooks';
import { stringify } from '../utils/safe-json-stringify';
import type { WorkerContext } from './inject-worker';
import type { WorkerHost } from './transmuxer-worker-client';
import type { HlsEventEmitter } from '../events';
import type Hls from '../hls';
import type { MediaFragment, Part } from '../loader/fragment';
import type { ErrorData, FragDecryptedData } from '../types/events';
import type { PlaylistLevelType } from '../types/loader';
import type { ChunkMetadata, TransmuxerResult } from '../types/transmuxer';
import type { TimestampOffset } from '../utils/timescale-conversion';

let transmuxerInstanceCount: number = 0;

export default class TransmuxerInterface {
  public error: Error | null = null;
  private hls: Hls;
  private id: PlaylistLevelType;
  private instanceNo: number = transmuxerInstanceCount++;
  private observer: HlsEventEmitter;
  private frag: MediaFragment | null = null;
  private part: Part | null = null;
  private useWorker: boolean;
  private workerContext: WorkerContext | null = null;
  private transmuxer: Transmuxer | null = null;
  private onTransmuxComplete: (transmuxResult: TransmuxerResult) => void;
  private onFlush: (chunkMeta: ChunkMetadata) => void;

  constructor(
    hls: Hls,
    id: PlaylistLevelType,
    onTransmuxComplete: (transmuxResult: TransmuxerResult) => void,
    onFlush: (chunkMeta: ChunkMetadata) => void,
  ) {
    const config = hls.config;
    this.hls = hls;
    this.id = id;
    this.useWorker = !!config.enableWorker;
    this.onTransmuxComplete = onTransmuxComplete;
    this.onFlush = onFlush;

    const forwardMessage = (
      ev: Events.ERROR | Events.FRAG_DECRYPTED,
      data: ErrorData | FragDecryptedData,
    ) => {
      data = data || {};
      data.frag = this.frag || undefined;
      if (ev === Events.ERROR) {
        data = data as ErrorData;
        data.parent = this.id;
        data.part = this.part;
        this.error = data.error;
      }
      this.hls.trigger(ev, data);
    };

    // forward events to main thread
    this.observer = new EventEmitter() as HlsEventEmitter;
    this.observer.on(Events.FRAG_DECRYPTED, forwardMessage);
    this.observer.on(Events.ERROR, forwardMessage);

    const m2tsTypeSupported = getM2TSSupportedAudioTypes(
      config.preferManagedMediaSource,
    );

    const workerClient = featureHooks.transmuxWorker;
    if (
      this.useWorker &&
      workerClient &&
      typeof Worker !== 'undefined' &&
      workerClient.canStart(config)
    ) {
      try {
        this.workerContext = workerClient.start(
          this as unknown as WorkerHost,
          m2tsTypeSupported,
        );
        return;
      } catch (err) {
        hls.logger.warn(
          `Error setting up "${id}" Web Worker, fallback to inline`,
          err,
        );
        this.terminateWorker();
        this.error = null;
      }
    }

    this.transmuxer = new Transmuxer(
      this.observer,
      m2tsTypeSupported,
      config,
      '',
      id,
      hls.logger,
    );
  }

  reset() {
    this.frag = null;
    this.part = null;
    if (this.workerContext) {
      const instanceNo = this.instanceNo;
      this.instanceNo = transmuxerInstanceCount++;
      const config = this.hls.config;
      const m2tsTypeSupported = getM2TSSupportedAudioTypes(
        config.preferManagedMediaSource,
      );
      this.workerContext.worker.postMessage({
        instanceNo: this.instanceNo,
        cmd: 'reset',
        resetNo: instanceNo,
        typeSupported: m2tsTypeSupported,
        id: this.id,
        config: stringify(config),
      });
    }
  }

  private terminateWorker() {
    const { workerContext } = this;
    if (workerContext) {
      this.workerContext = null;
      featureHooks.transmuxWorker?.terminate(
        workerContext,
        this.hls.config.workerPath,
      );
    }
  }

  destroy() {
    if (this.workerContext) {
      this.terminateWorker();
    } else {
      const transmuxer = this.transmuxer;
      if (transmuxer) {
        transmuxer.destroy();
        this.transmuxer = null;
      }
    }
    const observer = this.observer;
    if (observer) {
      observer.removeAllListeners();
    }
    this.frag = null;
    this.part = null;
    // @ts-ignore
    this.observer = null;
    // @ts-ignore
    this.hls = null;
  }

  push(
    data: ArrayBuffer,
    initSegmentData: Uint8Array | undefined,
    audioCodec: string | undefined,
    videoCodec: string | undefined,
    frag: MediaFragment,
    part: Part | null,
    duration: number,
    accurateTimeOffset: boolean,
    chunkMeta: ChunkMetadata,
    defaultInitPTS?: TimestampOffset,
  ) {
    chunkMeta.transmuxing.start = self.performance.now();
    const { instanceNo, transmuxer } = this;
    const timeOffset = part ? part.start : frag.start;
    // TODO: push "clear-lead" decrypt data for unencrypted fragments in streams with encrypted ones
    const decryptdata = frag.decryptdata;
    const lastFrag = this.frag;

    const discontinuity = lastFrag ? frag.cc !== lastFrag.cc : true;
    const trackSwitch = lastFrag ? chunkMeta.level !== lastFrag.level : true;
    const snDiff = lastFrag ? chunkMeta.sn - lastFrag.sn : -1;
    const partDiff = this.part ? chunkMeta.part - this.part.index : -1;
    const progressive =
      snDiff === 0 &&
      chunkMeta.id > 1 &&
      chunkMeta.id === lastFrag?.stats.chunkCount;
    const contiguous =
      !trackSwitch &&
      (snDiff === 1 ||
        (snDiff === 0 && (partDiff === 1 || (progressive && partDiff <= 0))));
    const now = self.performance.now();

    if (trackSwitch || snDiff || frag.stats.parsing.start === 0) {
      frag.stats.parsing.start = now;
    }
    if (part && (partDiff || !contiguous)) {
      part.stats.parsing.start = now;
    }
    const initSegmentChange = !(
      lastFrag && frag.initSegment?.url === lastFrag.initSegment?.url
    );
    const state = new TransmuxState(
      discontinuity,
      contiguous,
      accurateTimeOffset,
      trackSwitch,
      timeOffset,
      initSegmentChange,
    );
    if (!contiguous || discontinuity || initSegmentChange) {
      this.hls.logger
        .log(`[transmuxer-interface]: Starting new transmux session for ${frag.type} sn: ${chunkMeta.sn}${
        chunkMeta.part > -1 ? ' part: ' + chunkMeta.part : ''
      } ${this.id} playlist: ${chunkMeta.level} id: ${chunkMeta.id}
        discontinuity: ${discontinuity}
        trackSwitch: ${trackSwitch}
        contiguous: ${contiguous}
        accurateTimeOffset: ${accurateTimeOffset}
        timeOffset: ${timeOffset}
        initSegmentChange: ${initSegmentChange}`);
      const config = new TransmuxConfig(
        audioCodec,
        videoCodec,
        initSegmentData,
        duration,
        defaultInitPTS,
      );
      this.configureTransmuxer(config);
    }

    this.frag = frag;
    this.part = part;

    // Frags with sn of 'initSegment' are not transmuxed
    if (this.workerContext) {
      // post fragment payload as transferable objects for ArrayBuffer (no copy)
      this.workerContext.worker.postMessage(
        {
          instanceNo,
          cmd: 'demux',
          data,
          decryptdata,
          chunkMeta,
          state,
        },
        data instanceof ArrayBuffer ? [data] : [],
      );
    } else if (transmuxer) {
      const transmuxResult = transmuxer.push(
        data,
        decryptdata,
        chunkMeta,
        state,
      );
      if (isPromise(transmuxResult)) {
        transmuxResult
          .then((data) => {
            this.handleTransmuxComplete(data);
          })
          .catch((error) => {
            this.transmuxerError(
              error,
              chunkMeta,
              'transmuxer-interface push error',
            );
          });
      } else {
        this.handleTransmuxComplete(transmuxResult as TransmuxerResult);
      }
    }
  }

  flush(chunkMeta: ChunkMetadata) {
    chunkMeta.transmuxing.start = self.performance.now();
    const { instanceNo, transmuxer } = this;
    if (this.workerContext) {
      1;
      this.workerContext.worker.postMessage({
        instanceNo,
        cmd: 'flush',
        chunkMeta,
      });
    } else if (transmuxer) {
      const transmuxResult = transmuxer.flush(chunkMeta);
      if (isPromise(transmuxResult)) {
        transmuxResult
          .then((data) => {
            this.handleFlushResult(data, chunkMeta);
          })
          .catch((error) => {
            this.transmuxerError(
              error,
              chunkMeta,
              'transmuxer-interface flush error',
            );
          });
      } else {
        this.handleFlushResult(transmuxResult, chunkMeta);
      }
    }
  }

  private transmuxerError(
    error: Error,
    chunkMeta: ChunkMetadata,
    reason: string,
  ) {
    if (!this.hls) {
      return;
    }
    this.error = error;
    this.hls.trigger(Events.ERROR, {
      type: ErrorTypes.MEDIA_ERROR,
      details: ErrorDetails.FRAG_PARSING_ERROR,
      chunkMeta,
      frag: this.frag || undefined,
      part: this.part || undefined,
      fatal: false,
      error,
      err: error,
      reason,
    });
  }

  private handleFlushResult(
    results: Array<TransmuxerResult>,
    chunkMeta: ChunkMetadata,
  ) {
    results.forEach((result) => {
      this.handleTransmuxComplete(result);
    });
    this.onFlush(chunkMeta);
  }

  private configureTransmuxer(config: TransmuxConfig) {
    const { instanceNo, transmuxer } = this;
    if (this.workerContext) {
      this.workerContext.worker.postMessage({
        instanceNo,
        cmd: 'configure',
        config,
      });
    } else if (transmuxer) {
      transmuxer.configure(config);
    }
  }

  private handleTransmuxComplete(result: TransmuxerResult) {
    result.chunkMeta.transmuxing.end = self.performance.now();
    this.onTransmuxComplete(result);
  }
}
