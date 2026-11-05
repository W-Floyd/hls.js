import AACDemuxer from '../demux/audio/aacdemuxer';
import { AC3Demuxer } from '../demux/audio/ac3-demuxer';
import MP3Demuxer from '../demux/audio/mp3demuxer';
import TSDemuxer from '../demux/tsdemuxer';
import MP4Remuxer from '../remux/mp4-remuxer';
import type { HlsConfig } from '../config';
import type { MuxConfig } from '../demux/transmuxer';

const muxers: MuxConfig[] = [
  { demux: TSDemuxer, remux: MP4Remuxer },
  { demux: AACDemuxer, remux: MP4Remuxer },
  { demux: MP3Demuxer, remux: MP4Remuxer },
];

if (__USE_M2TS_ADVANCED_CODECS__) {
  muxers.splice(1, 0, { demux: AC3Demuxer, remux: MP4Remuxer });
}

// MPEG-TS and packed audio (AAC, MP3, AC-3) segments, transmuxed to fMP4.
export const mpegTs: Partial<HlsConfig> = { muxers };
