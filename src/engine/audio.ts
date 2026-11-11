/* Playback and the clock. One clock is authoritative at a time: Web Audio (the page plays the decoded buffer), an
   external player (the desktop's Hi-Fi output: its clock is the sample leaving the DAC), or a free clock (no audio).
   Song time t maps to file time as  file = audioStart + t. */

/** Decoded audio, or a stand-in for audio another player decodes (it knows its length and can decode on demand). */
export interface AudioLike {
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData?(i: number): Float32Array;
  load?(): Promise<AudioBuffer>;
}
/** An outside player (Hi-Fi): told where in the file to start and where to stop; reports its own clock (file time). */
export interface ExternalOut {
  play(fileTime: number, end: number): void;
  stop(): void;
  clock(): number;
  gain(g: number): void;
}

export class AudioClock {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private t0 = 0;
  private ctx0 = 0;
  private wall0 = 0;
  private ext: ExternalOut | null = null;
  private extOn = false;
  /** the smoothed clock: its last reading (song time, and when), so it never steps back and never stands still */
  private last = -Infinity;
  private lastAt = 0;
  playing = false;
  constructor(private getCtx: () => AudioContext) {}
  /** where the song goes after its gain (volume, balance, fades): the output, or a host's own graph (the space's rooms) */
  private out: AudioNode | null = null;
  private ac() {
    if (!this.ctx) {
      this.ctx = this.getCtx();
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.out || this.ctx.destination);
    }
    return this.ctx;
  }
  /** Send the song (after its gain) into `node` instead of the output; null sends it straight out again. The Hi-Fi
   *  output is not affected: its sound never passes through the page. */
  route(node: AudioNode | null) {
    this.out = node;
    if (!this.gainNode || !this.ctx) return;
    this.gainNode.disconnect();
    this.gainNode.connect(node || this.ctx.destination);
  }
  setExternal(o: ExternalOut | null) {
    this.ext = o;
  }
  /** Make the audio context now (at launch, in idle time): the first play does not wait for it. */
  warm() {
    this.ac();
  }
  get external() {
    return this.ext;
  }
  /** Start at song time t. */
  start(t: number, buf: AudioLike | null, audioStart: number, end: number) {
    this.stopOutput();
    this.t0 = t;
    this.wall0 = performance.now();
    this.playing = true;
    this.last = -Infinity;
    if (!buf) return;
    if (this.ext) {
      this.ext.play(audioStart + t, end);
      this.extOn = true;
      return;
    }
    if (!(buf as AudioBuffer).getChannelData || (buf as AudioLike).load) return; // a stand-in without an outside player: silent
    const c = this.ac();
    c.resume?.();
    const off = audioStart + t,
      when = c.currentTime + 0.04;
    const s = c.createBufferSource();
    s.buffer = buf as AudioBuffer;
    s.connect(this.gainNode!);
    if (off < 0) s.start(when - off, 0, end);
    else if (off < end) s.start(when, off, end - off);
    this.src = s;
    this.ctx0 = when;
  }
  stop() {
    this.stopOutput();
    this.playing = false;
  }
  private stopOutput() {
    if (this.extOn) {
      this.extOn = false;
      try {
        this.ext?.stop();
      } catch {
        /* ignore */
      }
    }
    if (this.src) {
      try {
        this.src.onended = null;
        this.src.stop();
      } catch {
        /* ignore */
      }
      this.src.disconnect();
      this.src = null;
    }
  }
  /** Song time now. */
  now(audioStart: number): number {
    if (!this.playing) return this.t0;
    if (this.extOn && this.ext) return this.ext.clock() - audioStart;
    if (this.src && this.ctx) return this.smooth(Math.max(this.t0, this.t0 + (this.heard(this.ctx) - this.ctx0)));
    return this.t0 + (performance.now() - this.wall0) / 1000;
  }
  /** The audio context's time of what is being heard now. Its currentTime moves in steps of one render buffer (23 ms
   *  of 1024 samples here, 10 ms on many devices) and runs ahead of the speaker by the output's latency: read as it is,
   *  the picture stood still for a frame or two and then jumped — fluid frames that looked like far fewer. The output
   *  timestamp says which context time leaves the speaker at which moment, and the time since that moment is added. */
  private heard(c: AudioContext): number {
    const ts = c.getOutputTimestamp?.();
    if (ts && ts.contextTime != null && ts.performanceTime != null && ts.performanceTime > 0)
      return ts.contextTime + Math.max(0, performance.now() - ts.performanceTime) / 1000;
    return c.currentTime;
  }
  /** Successive readings as one steady clock: it follows the source closely (a small difference eased out over a few
   *  frames, a large one taken at once), and never steps back. */
  private smooth(t: number): number {
    const n = performance.now();
    if (!isFinite(this.last)) {
      this.last = t;
      this.lastAt = n;
      return t;
    }
    const pred = this.last + (n - this.lastAt) / 1000,
      d = t - pred;
    const v = Math.abs(d) > 0.05 ? t : pred + d * 0.2;
    this.last = Math.max(this.last, v);
    this.lastAt = n;
    return this.last;
  }
  /** Hold the clock at t (paused). */
  hold(t: number) {
    this.t0 = t;
    this.last = -Infinity;
  }
  gain(g: number) {
    if (this.extOn && this.ext) {
      this.ext.gain(g);
      return;
    }
    if (this.gainNode) this.gainNode.gain.value = g;
  }
}
