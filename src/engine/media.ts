/* Videos the picture can show: the video backdrop (a clip imported in the workshop) and a song's MV (MV mode). Both play
   by themselves while the song plays and are nudged back if they drift from the song's clock; paused, they seek. The MV
   fades in and out by the interface clock (a slow frame never stretches the fade). */
import { clamp } from '../core/math';
import { parseOffset } from '../lyrics/parse';

export class VideoSource {
  el: HTMLVideoElement | null = null; url = ''; ready = false; name = ''; file: Blob | null = null;
  /** where the clip starts against the song ('' = with the audio), and whether it loops */
  start = ''; loop = true; offset = 0;
  /** during export: the decoded frame for the current time (WebCodecs), replacing the element */
  exportFrame: { cv: CanvasImageSource; displayWidth: number; displayHeight: number } | null = null;
  async open(url: string, file?: Blob | null, name = ''): Promise<boolean> {
    this.close(); this.url = url; this.file = file || null; this.name = name;
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    const ok = await new Promise<boolean>(res => { v.onloadeddata = () => res(true); v.onerror = () => res(false); v.src = url; setTimeout(() => res(v.readyState >= 2), 10000); });
    if (!ok || this.url !== url) return false;
    this.el = v; this.ready = true; return true;
  }
  close() { if (this.el) { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); } this.el = null; this.ready = false; }
  /** The clip's own time at song time t. */
  timeAt(t: number, audioStart: number): number {
    const v = this.el, d = v && isFinite(v.duration) ? v.duration : 0, s = parseOffset(this.start);
    let x = (s == null ? audioStart : s) + t + this.offset;
    if (d > 0) x = this.loop ? ((x % d) + d) % d : clamp(x, 0, Math.max(0, d - 0.05));
    return Math.max(0, x);
  }
  sync(t: number, playing: boolean, audioStart: number, active: boolean) {
    const v = this.el; if (!v || !this.ready) return;
    if (!active) { if (!v.paused) v.pause(); return; }
    const x = this.timeAt(t, audioStart);
    if (playing) { if (v.paused) v.play().catch(() => {}); if (Math.abs(v.currentTime - x) > 0.25 && !v.seeking) v.currentTime = x; }
    else { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - x) > 0.03 && !v.seeking) v.currentTime = x; }
  }
  seek(x: number): Promise<void> { const v = this.el; if (!v || !this.ready) return Promise.resolve();
    return new Promise(res => { if (Math.abs(v.currentTime - x) < 1e-3 && !v.seeking) return res(); const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); setTimeout(done, 1500); v.currentTime = x; }); }
  /** Something drawable now. */
  drawable(): { frame: CanvasImageSource | null; w: number; h: number } | null {
    if (this.exportFrame) return { frame: this.exportFrame.cv, w: this.exportFrame.displayWidth, h: this.exportFrame.displayHeight };
    const v = this.el; if (!v || !this.ready || v.readyState < 2 || !v.videoWidth) return null;
    return { frame: v, w: v.videoWidth, h: v.videoHeight };
  }
}

export class MvSource extends VideoSource {
  on = false; k = 0; private k0 = 0; private t0 = 0;
  constructor() { super(); this.loop = false; }
  setOn(on: boolean) { const n = !!on && !!this.el; if (n !== this.on) { this.k0 = this.k; this.t0 = performance.now(); } this.on = n; }
  /** Advance the fade (900 ms) by the interface clock; returns true while it changes. */
  tick(): boolean { const tgt = this.on ? 1 : 0; if (this.k === tgt) return false; const u = clamp((performance.now() - this.t0) / 900); this.k = u >= 1 ? tgt : this.k0 + (tgt - this.k0) * u; return true; }
  override timeAt(t: number, audioStart: number) { const v = this.el, d = v && isFinite(v.duration) ? v.duration : 0; return clamp(audioStart + t + this.offset, 0, Math.max(0, d - 0.05)); }
}
