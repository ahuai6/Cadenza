// The standard output's audio-thread player. It holds the decoded samples of the song playing and of the one chained
// after it (stereo, each at its own rate) and writes them to the output sample by sample:
// - one resampling filter runs across the join of two chained songs, so the next song's first sample follows the last
//   one's with no gap and no filter edge; a song at the output's own rate is copied unfiltered, bit for bit;
// - pauses, stops and seeks ramp over 6 ms (no click); a song's end fade and volume balance are applied here, so they
//   change exactly at the boundary between songs.
//
// The body below runs in the AudioWorkletGlobalScope, loaded from its own source text (pcmProcessorSource): it must not
// refer to anything outside the function. Messages are typed in protocol.ts.

export const PCM_PROCESSOR = 'cadenza-pcm';

/** The processor's source, for a Blob URL: the desktop page is loaded from file://, where module URLs cannot be fetched. */
export function pcmProcessorSource(name: string = PCM_PROCESSOR) {
  return `(${pcmProcessor.toString()})(${JSON.stringify(name)});`;
}

function pcmProcessor(name: string) {
  type Scope = {
    sampleRate: number;
    currentFrame: number;
    registerProcessor(name: string, ctor: unknown): void;
    AudioWorkletProcessor: new () => { port: MessagePort };
  };
  const scope = globalThis as unknown as Scope;
  const OUT = scope.sampleRate;
  /** pause, stop, seek and resume ramp over 6 ms (the native core's FADE_S) */
  const RAMP = Math.max(1, Math.round(OUT * 0.006));
  /** a clock report every 8 render quanta (about 21 ms at 48 kHz) */
  const CLOCK_EVERY = 8;
  /** the resampling filter: windowed sinc with 32 zero crossings a side (at most 128 taps a side when downsampling) */
  const ZEROS = 32;
  const MAX_SPAN = 128;
  const PHASES = 256;
  const KAISER_BETA = 8.6;
  /** source frames the filter's window holds */
  const WINDOW = 1 << 14;

  interface Kernel {
    /** source frames per output frame */
    step: number;
    /** taps a side, in source frames */
    span: number;
    table: Float32Array;
  }
  const besselI0 = (x: number) => {
    let sum = 1,
      term = 1;
    for (let k = 1; k < 64; k++) {
      term *= (x / (2 * k)) ** 2;
      sum += term;
      if (term < sum * 1e-12) break;
    }
    return sum;
  };
  const kernels = new Map<number, Kernel | null>();
  /** null: the song is at the output's rate and is copied as it is */
  function kernelFor(rate: number): Kernel | null {
    if (rate === OUT) return null;
    if (kernels.has(rate)) return kernels.get(rate)!;
    const cutoff = Math.min(1, OUT / rate) * 0.97;
    const span = Math.min(MAX_SPAN, Math.ceil(ZEROS / cutoff));
    const table = new Float32Array(span * PHASES + 2);
    const i0 = besselI0(KAISER_BETA);
    for (let i = 0; i < table.length; i++) {
      const x = i / PHASES;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x * cutoff) / (Math.PI * x * cutoff);
      const w = x >= span ? 0 : besselI0(KAISER_BETA * Math.sqrt(1 - (x / span) ** 2)) / i0;
      table[i] = cutoff * sinc * w;
    }
    const kernel = { step: rate / OUT, span, table };
    kernels.set(rate, kernel);
    return kernel;
  }

  interface Segment {
    id: number;
    chunks: Float32Array[];
    /** sample index into chunks[0] */
    head: number;
    /** frames waiting in chunks */
    buffered: number;
    /** the song's rate, first frame and length (frames), from the feeder's first block; length 0 until known */
    rate: number;
    first: number;
    length: number;
    eof: boolean;
    /** frames taken into the filter's window */
    pulled: number;
    reported: number;
    gain: number;
    /** end fade, seconds (0: none) */
    fade: number;
    starved: boolean;
  }
  type Data = {
    t: string;
    seg: number;
    samples?: Float32Array;
    eof?: boolean;
    rate?: number;
    first?: number;
    length?: number;
  };
  type State = 'idle' | 'starting' | 'playing' | 'pausing' | 'paused' | 'stopping';

  class Processor extends scope.AudioWorkletProcessor {
    private readonly segments = new Map<number, Segment>();
    private readonly chains = new Map<number, number>();
    /** samples that arrived over the feeder's port before the page's 'open' (two ports, no shared order) */
    private readonly early = new Map<number, Data[]>();
    private feed: MessagePort | null = null;
    private state: State = 'idle';
    /** the song at the output, and the one whose samples follow it in the window (chained, gapless) */
    private play: Segment | null = null;
    private next: Segment | null = null;
    /** the song whose samples are being taken into the window */
    private feeding: Segment | null = null;
    /** a new stream's window is made when it starts; a resumed one keeps its own */
    private fresh = false;
    /** the stream was started by the processor itself, after the song chained before it */
    private auto = false;
    private prebuffer = 0;
    /** the click guard in whole steps (0..RAMP, gain env/RAMP), moving one step a sample towards `target` */
    private env = RAMP;
    private target = RAMP;
    private queued: { seg: Segment; prebuffer: number; fadeIn: boolean } | null = null;
    private quanta = 0;
    // the filter's window: source frames of `play` (from playBase) and then of `next` (from nextBase)
    private readonly wl = new Float32Array(WINDOW);
    private readonly wr = new Float32Array(WINDOW);
    private wlen = 0;
    /** position of the next output sample in the window, in source frames */
    private t = 0;
    private kernel: Kernel | null = null;
    private playBase = 0;
    private nextBase = Infinity;

    constructor() {
      super();
      this.port.onmessage = (event: MessageEvent) => this.command(event.data);
    }

    private post(report: object) {
      this.port.postMessage(report);
    }

    private command(c: {
      t: string;
      seg?: number;
      port?: MessagePort;
      gain?: number;
      fade?: number;
      prebuffer?: number;
      fadeIn?: boolean;
      next?: number | null;
    }) {
      const seg = c.seg != null ? this.segments.get(c.seg) : undefined;
      switch (c.t) {
        case 'feed':
          this.feed = c.port!;
          this.feed.onmessage = (event: MessageEvent) => this.data(event.data);
          break;
        case 'open':
          this.segments.set(c.seg!, {
            id: c.seg!,
            chunks: [],
            head: 0,
            buffered: 0,
            rate: 0,
            first: 0,
            length: 0,
            eof: false,
            pulled: 0,
            reported: 0,
            gain: c.gain!,
            fade: c.fade!,
            starved: false,
          });
          for (const d of this.early.get(c.seg!) ?? []) this.data(d);
          this.early.delete(c.seg!);
          break;
        case 'play':
          if (!seg) break;
          if (this.play === seg) {
            if (this.state === 'paused' || this.state === 'pausing') {
              this.state = this.state === 'pausing' ? 'playing' : 'starting';
              this.prebuffer = c.prebuffer!;
              this.target = RAMP;
            }
          } else if (this.play && (this.state === 'playing' || this.state === 'pausing' || this.state === 'stopping')) {
            // the stream playing ramps out first; this one starts after it
            if (this.state !== 'stopping') this.stopCurrent();
            this.queued = { seg, prebuffer: c.prebuffer!, fadeIn: c.fadeIn! };
          } else this.begin(seg, c.prebuffer!, c.fadeIn!);
          break;
        case 'pause':
          if (this.queued?.seg === seg) this.queued = null;
          if (this.play === seg) {
            if (this.state === 'starting') this.settlePause();
            else if (this.state === 'playing') {
              this.state = 'pausing';
              this.target = 0;
            }
          }
          break;
        case 'stop':
          if (this.queued?.seg === seg) this.queued = null;
          if (this.play === seg && (this.state === 'playing' || this.state === 'pausing')) this.stopCurrent();
          else if (seg) this.drop(seg);
          break;
        case 'close':
          if (this.queued?.seg === seg) this.queued = null;
          if (seg) this.drop(seg);
          break;
        case 'chain':
          if (c.next == null) this.chains.delete(c.seg!);
          else this.chains.set(c.seg!, c.next);
          break;
        case 'gain':
          if (seg) seg.gain = c.gain!;
          break;
      }
    }

    private data(d: Data) {
      if (d.t !== 'data') return;
      const seg = this.segments.get(d.seg);
      if (!seg) {
        const list = this.early.get(d.seg) ?? [];
        list.push(d);
        this.early.set(d.seg, list);
        // a stream closed before it opened leaves nothing behind for long
        if (this.early.size > 8) this.early.delete(this.early.keys().next().value!);
        return;
      }
      if (d.rate) {
        seg.rate = d.rate;
        seg.first = d.first ?? 0;
        seg.length = d.length ?? 0;
      }
      if (d.samples && d.samples.length) {
        seg.chunks.push(d.samples);
        seg.buffered += d.samples.length >> 1;
      }
      if (d.eof) {
        seg.eof = true;
        // the exact length: everything delivered
        seg.length = seg.first + seg.pulled + seg.buffered;
      }
    }

    private begin(seg: Segment, prebuffer: number, fadeIn: boolean, auto = false) {
      this.auto = auto;
      this.play = seg;
      this.next = null;
      this.nextBase = Infinity;
      this.feeding = seg;
      this.fresh = true;
      this.state = 'starting';
      this.prebuffer = prebuffer;
      // a song started from its beginning is not faded in (its own first samples are the start)
      this.env = fadeIn ? 0 : RAMP;
      this.target = RAMP;
    }

    /** A new window for a stream that starts on its own: silence before its first sample. */
    private resetWindow(seg: Segment) {
      this.kernel = kernelFor(seg.rate);
      const lead = this.kernel ? this.kernel.span : 0;
      this.wl.fill(0, 0, lead);
      this.wr.fill(0, 0, lead);
      this.wlen = lead;
      this.t = lead;
      this.playBase = lead;
      this.next = null;
      this.nextBase = Infinity;
      this.feeding = seg;
    }

    private stopCurrent() {
      this.state = 'stopping';
      this.target = 0;
    }

    private position() {
      const p = this.play!;
      return p.rate ? (p.first + Math.max(0, this.t - this.playBase)) / p.rate : 0;
    }

    private settlePause() {
      this.state = 'paused';
      this.env = 0;
      this.post({ t: 'paused', frame: scope.currentFrame, seg: this.play!.id, pos: this.position() });
    }

    private drop(seg: Segment) {
      this.segments.delete(seg.id);
      this.chains.delete(seg.id);
      this.early.delete(seg.id);
      if (this.next === seg) {
        this.next = null;
        this.nextBase = Infinity;
      }
      if (this.feeding === seg) this.feeding = null;
      if (this.play === seg) {
        this.play = null;
        this.next = null;
        this.nextBase = Infinity;
        this.feeding = null;
        this.state = 'idle';
      }
      this.feed?.postMessage({ t: 'closed', seg: seg.id });
    }

    private fadeAt(seg: Segment, frame: number) {
      if (!seg.fade || !seg.length) return 1;
      const left = (seg.length - frame) / seg.rate;
      return left >= seg.fade ? 1 : Math.max(0, left / seg.fade);
    }

    private reportConsumed(seg: Segment) {
      if (this.feed && seg.pulled - seg.reported >= seg.rate * 0.1) {
        seg.reported = seg.pulled;
        this.feed.postMessage({ t: 'consumed', seg: seg.id, frames: seg.pulled });
      }
    }

    /** Make room at the window's end by dropping what the filter no longer reaches. */
    private compact() {
      const keep = Math.floor(this.t) - (this.kernel ? this.kernel.span : 0) - 1;
      if (keep <= 0) return;
      this.wl.copyWithin(0, keep, this.wlen);
      this.wr.copyWithin(0, keep, this.wlen);
      this.wlen -= keep;
      this.t -= keep;
      this.playBase -= keep;
      this.nextBase -= keep;
    }

    /** Take source frames into the window until the next output sample can be made. False: starved. */
    private fill(): boolean {
      const reach = () => Math.floor(this.t) + (this.kernel ? this.kernel.span + 1 : 1);
      if (reach() > WINDOW / 2) this.compact();
      const want = reach();
      while (this.wlen < want) {
        const src = this.feeding;
        if (src && src.buffered > 0) {
          const chunk = src.chunks[0];
          const m = Math.min(want - this.wlen, (chunk.length - src.head) >> 1);
          for (let i = 0; i < m; i++) {
            const g = src.gain * this.fadeAt(src, src.first + src.pulled + i);
            this.wl[this.wlen + i] = chunk[src.head + 2 * i] * g;
            this.wr[this.wlen + i] = chunk[src.head + 2 * i + 1] * g;
          }
          this.wlen += m;
          src.head += 2 * m;
          src.buffered -= m;
          src.pulled += m;
          if (src.head >= chunk.length) {
            src.chunks.shift();
            src.head = 0;
          }
          this.reportConsumed(src);
          continue;
        }
        if (src && !src.eof) return false;
        if (src && src === this.play && !this.next) {
          // the song's last sample is in: the chained one follows it in the same window, under the same filter
          const id = this.chains.get(src.id);
          const following = id != null ? this.segments.get(id) : undefined;
          if (following && following.rate === src.rate && (following.buffered > 0 || following.eof)) {
            this.next = following;
            this.nextBase = this.wlen;
            this.feeding = following;
            continue;
          }
        }
        // nothing follows: silence after the end, for the filter's last outputs
        this.wl[this.wlen] = this.wr[this.wlen] = 0;
        this.wlen++;
        this.feeding = null;
      }
      return true;
    }

    private sample(out: { l: number; r: number }) {
      const k = this.kernel;
      if (!k) {
        out.l = this.wl[this.t];
        out.r = this.wr[this.t];
        return;
      }
      const centre = Math.floor(this.t);
      const frac = this.t - centre;
      let l = 0,
        r = 0;
      for (let j = -k.span + 1; j <= k.span; j++) {
        const a = Math.abs(j - frac) * PHASES;
        const i = a | 0;
        if (i >= k.span * PHASES) continue;
        const f = a - i;
        const w = k.table[i] * (1 - f) + k.table[i + 1] * f;
        l += this.wl[centre + j] * w;
        r += this.wr[centre + j] * w;
      }
      out.l = l;
      out.r = r;
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
      const out = outputs[0];
      const L = out[0],
        R = out[1] ?? out[0];
      const n = L.length;
      const frame0 = scope.currentFrame;
      if (++this.quanta % CLOCK_EVERY === 0 && this.play && this.play.rate && !this.fresh)
        this.post({
          t: 'clock',
          frame: frame0,
          seg: this.play.id,
          pos: this.position(),
          playing: this.state === 'playing' || this.state === 'pausing' || this.state === 'stopping',
        });
      const s = { l: 0, r: 0 };
      let i = 0;
      while (i < n) {
        const seg = this.play;
        if (!seg || this.state === 'idle' || this.state === 'paused') break;
        if (this.state === 'starting') {
          if (!seg.rate) break;
          const ahead = Math.max(1, Math.round(this.prebuffer * seg.rate));
          const need = seg.length ? Math.min(ahead, Math.max(1, seg.length - seg.first - seg.pulled)) : ahead;
          if (seg.buffered < need && !seg.eof) break;
          if (this.fresh) {
            this.fresh = false;
            this.resetWindow(seg);
          }
          this.state = 'playing';
          seg.starved = false;
          this.post({ t: 'started', frame: frame0 + i, seg: seg.id, pos: this.position(), chained: this.auto });
          this.auto = false;
        }
        // the output has reached the chained song's first sample
        if (this.next && this.t >= this.nextBase) {
          const following = this.next;
          this.post({ t: 'ended', frame: frame0 + i, seg: seg.id, pos: seg.length / seg.rate });
          this.play = following;
          this.playBase = this.nextBase;
          this.next = null;
          this.nextBase = Infinity;
          this.segments.delete(seg.id);
          this.chains.delete(seg.id);
          this.feed?.postMessage({ t: 'closed', seg: seg.id });
          this.post({ t: 'started', frame: frame0 + i, seg: following.id, pos: this.position(), chained: true });
          continue;
        }
        // every sample of the song has been heard, and nothing was joined to it
        if (seg.eof && !seg.buffered && !this.next && this.t >= this.playBase + seg.pulled) {
          this.ended(seg, frame0 + i);
          continue;
        }
        if (this.state === 'stopping' && this.env === 0) {
          this.finishStop(seg, frame0 + i);
          continue;
        }
        if (!this.fill()) {
          if (this.state === 'stopping') {
            this.finishStop(seg, frame0 + i);
            continue;
          }
          if (!seg.starved) {
            seg.starved = true;
            this.post({ t: 'starved', frame: frame0 + i, seg: seg.id, pos: this.position() });
          }
          break;
        }
        if (seg.starved) {
          seg.starved = false;
          this.post({ t: 'resumed', frame: frame0 + i, seg: seg.id, pos: this.position() });
        }
        if (this.env !== this.target) this.env += this.target > this.env ? 1 : -1;
        this.sample(s);
        const g = this.env / RAMP;
        L[i] = s.l * g;
        R[i] = s.r * g;
        i++;
        this.t += this.kernel ? this.kernel.step : 1;
        if (this.env === 0 && this.target === 0) {
          if (this.state === 'pausing') {
            this.settlePause();
            break;
          }
          if (this.state === 'stopping') this.finishStop(seg, frame0 + i);
        }
      }
      for (; i < n; i++) L[i] = R[i] = 0;
      if (R !== L && out.length > 2) for (let c = 2; c < out.length; c++) out[c].fill(0);
      return true;
    }

    private ended(seg: Segment, frame: number) {
      this.post({ t: 'ended', frame, seg: seg.id, pos: seg.length / seg.rate });
      const nextId = this.chains.get(seg.id);
      this.drop(seg);
      const following = nextId != null ? this.segments.get(nextId) : undefined;
      // a chained song that was not ready to join (or is at another rate) starts on its own, from its beginning
      if (following) this.begin(following, 0.05, false, true);
    }

    private finishStop(seg: Segment, frame: number) {
      this.post({ t: 'stopped', frame, seg: seg.id, pos: this.position() });
      this.drop(seg);
      const queued = this.queued;
      this.queued = null;
      if (queued && this.segments.has(queued.seg.id)) this.begin(queued.seg, queued.prebuffer, queued.fadeIn);
    }
  }

  scope.registerProcessor(name, Processor);
}
