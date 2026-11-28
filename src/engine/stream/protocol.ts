// Messages between the standard output's three parts: the player on the page (pcm-player.ts), the feeder worker that
// reads and decodes (pcm-feed.worker.ts) and the audio-thread processor (pcm-worklet.ts). A stream ("segment") is one
// read of one song from one position; its samples are stereo at the song's own rate. Song positions are in seconds;
// `frame` is an audio-context frame.

/** Where a song's samples come from: the native decoder by URL, or the browser's own decoders reading the media file.
 *  The feeder tries the native source first and falls back before any audio. */
export interface PcmSource {
  native?: string;
  browser?: string;
}

/** page → feeder */
export type FeedCommand = { t: 'open'; seg: number; source: PcmSource; at: number } | { t: 'close'; seg: number };

/** feeder → page */
export type FeedReport =
  | {
      t: 'meta';
      seg: number;
      /** seconds (0 when unknown) */
      length: number;
      /** seconds: where the stream actually begins */
      first: number;
      srcRate: number;
      srcChannels: number;
      bits: number;
      native: boolean;
    }
  | { t: 'error'; seg: number; message: string };

/** feeder → processor (the first block carries the rate and first frame), and processor → feeder (consumption) */
export type FeedData =
  | {
      t: 'data';
      seg: number;
      samples: Float32Array;
      eof: boolean;
      rate?: number;
      /** source frame of the first sample */
      first?: number;
      /** the song's length in source frames (0 when unknown) */
      length?: number;
    }
  | { t: 'consumed'; seg: number; frames: number }
  | { t: 'closed'; seg: number };

/** page → processor */
export type ProcessorCommand =
  | { t: 'feed'; port: MessagePort }
  | { t: 'open'; seg: number; gain: number; fade: number }
  | { t: 'play'; seg: number; prebuffer: number; fadeIn: boolean }
  | { t: 'pause'; seg: number }
  | { t: 'stop'; seg: number }
  | { t: 'close'; seg: number }
  | { t: 'chain'; seg: number; next: number | null }
  | { t: 'gain'; seg: number; gain: number };

/** processor → page */
export type ProcessorReport =
  | { t: 'clock'; frame: number; seg: number; pos: number; playing: boolean }
  | { t: 'started'; frame: number; seg: number; pos: number; chained: boolean }
  | { t: 'starved'; frame: number; seg: number; pos: number }
  | { t: 'resumed'; frame: number; seg: number; pos: number }
  | { t: 'paused'; frame: number; seg: number; pos: number }
  | { t: 'ended'; frame: number; seg: number; pos: number }
  | { t: 'stopped'; frame: number; seg: number; pos: number };
