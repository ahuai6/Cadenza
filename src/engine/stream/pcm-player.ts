// The standard output's player on the page: it opens streams (a song from a position), tells the audio-thread processor
// when to play, pause, stop and which stream follows which, and turns the processor's reports into the song time being
// heard. The processor reports song positions at audio-context frames; the context's output timestamp says which frame
// is leaving the speakers now, so the heard position needs no estimate of the output latency.
import type { AudioClock } from '../audio';
import FeedWorker from './pcm-feed.worker.ts?worker&inline';
import { PCM_PROCESSOR, pcmProcessorSource } from './pcm-worklet';
import type { FeedCommand, FeedReport, ProcessorCommand, ProcessorReport } from './protocol';

/** How a song is read: the native decoder's URL for a start (seconds), and/or the media file for the browser. */
export interface PcmSourceSpec {
  native?: (at: number) => string;
  browser?: string;
}
export type PcmEvent = 'running' | 'buffering' | 'ended' | { error: string };
export interface PcmMeta {
  /** seconds, from the decoder (0 when it cannot tell) */
  duration: number;
  /** seconds: where the stream actually begins */
  first: number;
  srcRate: number;
  srcChannels: number;
  bits: number;
  native: boolean;
}

/** audio decoded before a start or seek may play: short, the decoder is local */
const PREBUFFER_SECONDS = 0.15;
/** how far a position may be carried past the last report before it waits for the next one */
const CARRY_SECONDS = 0.1;
/** events are released when the heard position reaches them; checked this often while any wait */
const EVENT_POLL_MS = 8;

type Status = 'opening' | 'ready' | 'starting' | 'running' | 'starved' | 'paused' | 'ended' | 'stopped' | 'failed';
/** a song position (seconds) at an audio-context frame */
type Anchor = { frame: number; pos: number; playing: boolean };

export class PcmTrack {
  status: Status = 'opening';
  /** set when the processor started this stream on its own, right after the one chained before it */
  chained = false;
  readonly meta: Promise<PcmMeta>;
  private settleMeta!: { resolve: (m: PcmMeta) => void; reject: (e: Error) => void };
  private notify: ((event: PcmEvent) => void) | null = null;
  private anchors: Anchor[] = [];
  /** the last position given out while running: the heard position never steps back */
  private last = 0;
  /** seconds: where the stream stands while it does not play */
  private held: number;

  constructor(
    private readonly player: PcmPlayer,
    readonly seg: number,
    /** seconds: where this stream begins */
    readonly from: number,
    /** the audio context's rate */
    readonly rate: number,
  ) {
    this.held = from;
    this.meta = new Promise((resolve, reject) => (this.settleMeta = { resolve, reject }));
    // a stream whose metadata nobody awaited still must not raise an unhandled rejection
    this.meta.catch(() => {});
  }

  /** Song time heard now, in seconds. */
  time(): number {
    if (this.status !== 'running' && this.status !== 'starved') return this.held;
    const heard = this.player.heardFrame();
    let a: Anchor | null = null,
      next: Anchor | null = null;
    for (let i = this.anchors.length - 1; i >= 0; i--) {
      if (this.anchors[i].frame <= heard) {
        a = this.anchors[i];
        next = this.anchors[i + 1] ?? null;
        break;
      }
    }
    if (!a) return this.held;
    const limit = next ? next.frame - a.frame : CARRY_SECONDS * this.rate;
    const pos = a.playing ? a.pos + Math.min(heard - a.frame, limit) / this.rate : a.pos;
    this.last = Math.max(this.last, pos);
    return this.last;
  }

  /** Play from where the stream stands (its first frame, or where it paused). A stream the processor already started
   *  after the one chained before it is taken over as it plays. */
  play(notify: (event: PcmEvent) => void, fadeIn: boolean) {
    this.notify = notify;
    if (this.status === 'failed' || this.status === 'ended' || this.status === 'stopped') {
      queueMicrotask(() => this.notify?.({ error: 'stream closed' }));
      return;
    }
    if (this.status === 'running') {
      queueMicrotask(() => this.notify === notify && notify('running'));
      return;
    }
    this.status = 'starting';
    this.player.command({ t: 'play', seg: this.seg, prebuffer: PREBUFFER_SECONDS, fadeIn });
  }

  pause() {
    this.notify = null;
    if (this.status === 'running' || this.status === 'starved' || this.status === 'starting') {
      this.held = this.time();
      this.status = 'paused';
      this.player.command({ t: 'pause', seg: this.seg });
    }
  }

  /** Ramp out (if playing) and release the stream and its decoder. */
  stop() {
    this.notify = null;
    if (this.status === 'stopped') return;
    if (this.status === 'running' || this.status === 'starved') this.held = this.time();
    this.status = 'stopped';
    this.player.command({ t: 'stop', seg: this.seg });
    this.player.release(this);
  }

  /** The stream to play right after this one's last sample (null: none). */
  chain(next: PcmTrack | null) {
    this.player.command({ t: 'chain', seg: this.seg, next: next?.seg ?? null });
  }

  setGain(gain: number) {
    this.player.command({ t: 'gain', seg: this.seg, gain });
  }

  /** @internal */
  feedReport(r: FeedReport) {
    if (r.t === 'meta') {
      if (this.status === 'opening') this.status = 'ready';
      this.settleMeta.resolve({
        duration: r.length,
        first: r.first,
        srcRate: r.srcRate,
        srcChannels: r.srcChannels,
        bits: r.bits,
        native: r.native,
      });
    } else {
      const error = new Error(r.message);
      this.settleMeta.reject(error);
      if (this.status !== 'stopped') {
        this.status = 'failed';
        this.notify?.({ error: r.message });
      }
    }
  }

  /** @internal a processor report, released once the heard position has reached it */
  heard(r: ProcessorReport) {
    if (this.status === 'stopped' || this.status === 'failed') return;
    switch (r.t) {
      case 'started':
        this.chained = r.chained;
        this.anchor(r.frame, r.pos, true);
        this.status = 'running';
        this.notify?.('running');
        break;
      case 'resumed':
        this.anchor(r.frame, r.pos, true);
        if (this.status === 'starved') {
          this.status = 'running';
          this.notify?.('running');
        }
        break;
      case 'starved':
        this.anchor(r.frame, r.pos, false);
        if (this.status === 'running') {
          this.status = 'starved';
          this.notify?.('buffering');
        }
        break;
      case 'paused':
        this.held = r.pos;
        break;
      case 'ended':
        this.held = r.pos;
        this.status = 'ended';
        this.player.release(this);
        this.notify?.('ended');
        break;
    }
  }

  /** @internal */
  anchor(frame: number, pos: number, playing: boolean) {
    this.anchors.push({ frame, pos, playing });
    if (this.anchors.length > 64) this.anchors.splice(0, 32);
  }
}

export class PcmPlayer {
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private context: AudioContext | null = null;
  private nextSeg = 1;
  private readonly tracks = new Map<number, PcmTrack>();
  private readonly waiting: ProcessorReport[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly clock: AudioClock) {}

  /** Load the processor and the reader (once; retried after a failure). */
  ready(): Promise<void> {
    this.loading ||= this.init().catch((error) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  private async init() {
    const { context, input } = this.clock.pcmInput();
    const url = URL.createObjectURL(new Blob([pcmProcessorSource()], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(context, PCM_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.connect(input);
    const worker = new FeedWorker();
    const channel = new MessageChannel();
    node.port.postMessage({ t: 'feed', port: channel.port1 } satisfies ProcessorCommand, [channel.port1]);
    worker.postMessage({ t: 'processor', port: channel.port2 }, [channel.port2]);
    node.port.onmessage = (event: MessageEvent<ProcessorReport>) => this.report(event.data);
    worker.onmessage = (event: MessageEvent<FeedReport>) => this.tracks.get(event.data.seg)?.feedReport(event.data);
    worker.onerror = (event) => {
      for (const track of this.tracks.values())
        track.feedReport({ t: 'error', seg: track.seg, message: event.message || 'audio reader failed' });
    };
    this.context = context;
    this.node = node;
    this.worker = worker;
  }

  get rate() {
    return this.context?.sampleRate ?? 48000;
  }

  /** Open a stream of a song from `at` seconds; `fade` is its end fade in seconds. Its metadata arrives once the decoder
   *  has read the file. */
  async open(source: PcmSourceSpec, at: number, options: { gain: number; fade: number }): Promise<PcmTrack> {
    await this.ready();
    const seg = this.nextSeg++;
    const from = Math.max(0, at);
    const track = new PcmTrack(this, seg, from, this.rate);
    this.tracks.set(seg, track);
    this.command({ t: 'open', seg, gain: options.gain, fade: options.fade });
    this.worker!.postMessage({
      t: 'open',
      seg,
      source: { native: source.native?.(from), browser: source.browser },
      at: from,
    } satisfies FeedCommand);
    return track;
  }

  /** @internal */
  command(c: ProcessorCommand) {
    this.node?.port.postMessage(c);
  }

  /** @internal forget a stream (its reader closes when the processor lets go of it) */
  release(track: PcmTrack) {
    this.tracks.delete(track.seg);
    if (track.status === 'stopped') this.worker?.postMessage({ t: 'close', seg: track.seg });
  }

  /** The audio-context frame leaving the speakers now. */
  heardFrame() {
    return this.clock.heardTime() * this.rate;
  }

  private report(r: ProcessorReport) {
    const track = this.tracks.get(r.seg);
    if (!track) return;
    if (r.t === 'clock') {
      track.anchor(r.frame, r.pos, r.playing);
      return;
    }
    if (r.t === 'stopped') return;
    this.waiting.push(r);
    this.deliver();
  }

  /** Hand out the reports the listener has now reached. */
  private deliver() {
    clearTimeout(this.timer);
    const running = this.context?.state === 'running';
    const heard = this.heardFrame();
    while (this.waiting.length && (!running || this.waiting[0].frame <= heard)) {
      const r = this.waiting.shift()!;
      this.tracks.get(r.seg)?.heard(r);
    }
    if (this.waiting.length) this.timer = setTimeout(() => this.deliver(), EVENT_POLL_MS);
  }
}
