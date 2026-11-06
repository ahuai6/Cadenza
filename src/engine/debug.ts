/* The detailed debug log (settings → performance → 「詳細除錯日誌」): what the picture was doing, frame by frame, for a
   fault that leaves no trace in the performance overlay — the picture stuck, the play page's backdrop black, while the
   frames go on as quick as ever. While it is on:
   - every drawn frame: the song time, the view, the canvas size, how long the page worked, the camera and the frame's
     own motion, the rhythm sample, the GPU lyric layer's numbers — and any value in them that was not a number (the
     frame is then drawn with the last good one: engine.ts frameAt);
   - four times a second, what really is on the canvas: a few pixels of it read back (its brightness and a fingerprint),
     so a picture that stops changing while the song plays, or goes black, is caught and marked;
   - events: canvas or WebGL context lost and restored, errors and warnings on the page, the analysis repaired as it was
     read, a song opened, the view changed.
   The last few minutes are kept (a ring); 「匯出除錯日誌」 saves them, with the setup (version, settings, the GPU's name,
   the song and its analysis in short), as one text file. Off, it costs nothing but the guard in frameAt. */

export interface DebugFrame { w: number; t: number; v: string; ms: number; cw: number; ch: number; px: number;
  cam: number[]; fx: number[]; rs: number[]; gpu: number[]; bad?: string }
export interface DebugEvent { w: number; t: number; kind: string; data?: unknown }

const FRAMES = 12000, EVENTS = 2000;
class DebugLog {
  on = false;
  private frames: DebugFrame[] = []; private events: DebugEvent[] = []; private fi = 0;
  private probeCv: HTMLCanvasElement | null = null; private lastProbe = 0; private lastHash = -1; private sameSince = 0; private stuckNoted = false; private blackNoted = false;
  private hooked = false;
  /** the song time now (set by the engine), for events noted from elsewhere */ t = 0;
  /** what the header says (filled by the engine and the app) */ setup: Record<string, unknown> = {};
  setOn(v: boolean) { this.on = v; if (v) { this.hook(); this.event('debug on', { ua: navigator.userAgent }); } }
  event(kind: string, data?: unknown) {
    if (!this.on) return; this.events.push({ w: Math.round(performance.now()), t: +this.t.toFixed(3), kind, data });
    if (this.events.length > EVENTS) this.events.splice(0, this.events.length - EVENTS);
  }
  frame(f: DebugFrame) { if (!this.on) return; if (this.frames.length < FRAMES) this.frames.push(f); else { this.frames[this.fi] = f; this.fi = (this.fi + 1) % FRAMES; } }
  /** What is on the canvas now (a few pixels read back, four times a second): brightness and a fingerprint, and whether it
   *  has stopped changing while the song plays (stuck) or gone dark (black). */
  probe(canvas: HTMLCanvasElement, playing: boolean, view: string, t: number) {
    if (!this.on) return; const now = performance.now(); if (now - this.lastProbe < 250) return; this.lastProbe = now;
    try {
      if (!this.probeCv) { this.probeCv = document.createElement('canvas'); this.probeCv.width = 16; this.probeCv.height = 9; }
      const g = this.probeCv.getContext('2d', { willReadFrequently: true })!; g.clearRect(0, 0, 16, 9); g.drawImage(canvas, 0, 0, 16, 9);
      const d = g.getImageData(0, 0, 16, 9).data; let lum = 0, h = 0;
      for (let i = 0; i < d.length; i += 4) { lum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; h = (h * 31 + d[i] * 7 + d[i + 1] * 3 + d[i + 2]) >>> 0; }
      lum /= d.length / 4;
      if (h !== this.lastHash) { this.lastHash = h; this.sameSince = now; if (this.stuckNoted) this.event('picture moving again'); this.stuckNoted = false; }
      else if (playing && view !== 'hidden' && now - this.sameSince > 1200 && !this.stuckNoted) { this.stuckNoted = true; this.event('PICTURE STUCK', { since: +(t - (now - this.sameSince) / 1000).toFixed(2), lum: +lum.toFixed(1), view }); }
      if (lum < 1.5 && view !== 'hidden' && !this.blackNoted) { this.blackNoted = true; this.event('PICTURE BLACK', { lum: +lum.toFixed(2), view }); }
      else if (lum >= 1.5 && this.blackNoted) { this.blackNoted = false; this.event('picture not black again', { lum: +lum.toFixed(1) }); }
      this.events.push({ w: Math.round(now), t: +t.toFixed(3), kind: 'probe', data: { lum: +lum.toFixed(1), hash: h, view } }); if (this.events.length > EVENTS) this.events.splice(0, this.events.length - EVENTS);
    } catch (e) { this.event('probe failed', String(e)); }
  }
  private hook() {
    if (this.hooked || typeof window === 'undefined') return; this.hooked = true;
    window.addEventListener('error', e => this.event('page error', { msg: e.message, at: `${e.filename}:${e.lineno}:${e.colno}` }));
    window.addEventListener('unhandledrejection', e => this.event('unhandled rejection', String((e as PromiseRejectionEvent).reason)));
    for (const k of ['warn', 'error'] as const) { const orig = console[k].bind(console); console[k] = (...a: unknown[]) => { try { this.event('console.' + k, a.map(x => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : safeJson(x))).join(' ').slice(0, 2000)); } catch { /* never in the way */ } orig(...a); }; }
    try { const c = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl'); const ext = c?.getExtension('WEBGL_debug_renderer_info');
      this.setup.gpu = ext ? { vendor: c!.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: c!.getParameter(ext.UNMASKED_RENDERER_WEBGL) } : c ? { renderer: c.getParameter(c.RENDERER) } : 'no WebGL';
      this.setup.maxTexture = c?.getParameter(c.MAX_TEXTURE_SIZE); } catch { /* none */ }
  }
  /** The log as text: the setup, the events, then the frames (oldest first), one line each. */
  text(): string {
    const fr = this.frames.length < FRAMES ? this.frames : [...this.frames.slice(this.fi), ...this.frames.slice(0, this.fi)];
    const lines = ['# Cadenza debug log', '# setup ' + safeJson(this.setup), '# frame columns: wall_ms t view work_ms canvas_w canvas_h px | cam x y z r d yaw pitch | fx x y r z | rs level loud pulse cone coneRoll sounding bt | gpu on quads uploads draws | bad', '## events'];
    for (const e of this.events) lines.push(`${e.w} t=${e.t} ${e.kind}${e.data !== undefined ? ' ' + safeJson(e.data) : ''}`);
    lines.push('## frames');
    for (const f of fr) lines.push(`${f.w} ${f.t} ${f.v} ${f.ms} ${f.cw} ${f.ch} ${f.px} | ${f.cam.join(' ')} | ${f.fx.join(' ')} | ${f.rs.join(' ')} | ${f.gpu.join(' ')}${f.bad ? ' | BAD ' + f.bad : ''}`);
    return lines.join('\n');
  }
  clear() { this.frames = []; this.events = []; this.fi = 0; }
}
function safeJson(x: unknown) { try { return JSON.stringify(x, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)); } catch { return String(x); } }
/** Rounded for the log (non-numbers kept visible as NaN / Infinity). */
export const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : (x as unknown as number));
export const DEBUG = new DebugLog();
