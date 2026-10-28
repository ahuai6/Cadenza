/* Playback and the clock. One clock is authoritative at a time: Web Audio (the page plays the decoded buffer), an
   external player (the desktop's Hi-Fi output: its clock is the sample leaving the DAC), or a free clock (no audio).
   Song time t maps to file time as  file = audioStart + t. */

/** Decoded audio, or a stand-in for audio another player decodes (it knows its length and can decode on demand). */
export interface AudioLike { duration: number; sampleRate: number; numberOfChannels: number; length: number; getChannelData?(i: number): Float32Array; load?(): Promise<AudioBuffer> }
/** An outside player (Hi-Fi): told where in the file to start and where to stop; reports its own clock (file time). */
export interface ExternalOut { play(fileTime: number, end: number): void; stop(): void; clock(): number; gain(g: number): void }

export class AudioClock {
  private ctx: AudioContext | null = null; private gainNode: GainNode | null = null; private src: AudioBufferSourceNode | null = null;
  private t0 = 0; private ctx0 = 0; private wall0 = 0; private ext: ExternalOut | null = null; private extOn = false;
  playing = false;
  constructor(private getCtx: () => AudioContext) {}
  private ac() { if (!this.ctx) { this.ctx = this.getCtx(); this.gainNode = this.ctx.createGain(); this.gainNode.connect(this.ctx.destination); } return this.ctx; }
  setExternal(o: ExternalOut | null) { this.ext = o; }
  get external() { return this.ext; }
  /** Start at song time t. */
  start(t: number, buf: AudioLike | null, audioStart: number, end: number) {
    this.stopOutput(); this.t0 = t; this.wall0 = performance.now(); this.playing = true;
    if (!buf) return;
    if (this.ext) { this.ext.play(audioStart + t, end); this.extOn = true; return; }
    if (!(buf as AudioBuffer).getChannelData || (buf as AudioLike).load) return;   // a stand-in without an outside player: silent
    const c = this.ac(); c.resume?.();
    const off = audioStart + t, when = c.currentTime + 0.04;
    const s = c.createBufferSource(); s.buffer = buf as AudioBuffer; s.connect(this.gainNode!);
    if (off < 0) s.start(when - off, 0, end); else if (off < end) s.start(when, off, end - off);
    this.src = s; this.ctx0 = when;
  }
  stop() { this.stopOutput(); this.playing = false; }
  private stopOutput() {
    if (this.extOn) { this.extOn = false; try { this.ext?.stop(); } catch { /* ignore */ } }
    if (this.src) { try { this.src.onended = null; this.src.stop(); } catch { /* ignore */ } this.src.disconnect(); this.src = null; }
  }
  /** Song time now. */
  now(audioStart: number): number {
    if (!this.playing) return this.t0;
    if (this.extOn && this.ext) return this.ext.clock() - audioStart;
    if (this.src && this.ctx) return Math.max(this.t0, this.t0 + (this.ctx.currentTime - this.ctx0));
    return this.t0 + (performance.now() - this.wall0) / 1000;
  }
  /** Hold the clock at t (paused). */
  hold(t: number) { this.t0 = t; }
  gain(g: number) { if (this.extOn && this.ext) { this.ext.gain(g); return; } if (this.gainNode) this.gainNode.gain.value = g; }
}
