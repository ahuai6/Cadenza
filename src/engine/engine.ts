/* The engine: one canvas, one clock, one loop. Each frame it reads the clock once, builds one RenderFrame (camera,
   rhythm sample, view, media) and draws it; the interface hears about the same moment through a single 'tick'.
   - sessions: whatever is shown (a song, the workshop's project) is a Session; showing another one crossfades them;
   - views: hidden (nothing drawn, time still runs), ambient (the now-playing page's backdrop), effect (the full picture),
     with the shared-element handoff between ambient and effect;
   - render settings only change how many pixels are drawn and how often, never which effects;
   - coming moments are drawn ahead into a tiny canvas while there is time to spare, so their glyphs are ready. */
import { clamp, sstep } from '../core/math';
import { Emitter } from '../core/emitter';
import { cameraAt } from '../director/evaluate';
import { drawFrame } from '../render/renderer';
import { MV_LOOK, type RenderFrame, type MvLook } from '../render/frame';
import { makeCanvas } from '../render/palette';
import type { RhythmSample } from '../rhythm/signals';
import { AudioClock, type ExternalOut } from './audio';
import { VideoSource, MvSource } from './media';
import { Handoff, type HandoffSpec, type WinRect } from './handoff';
import type { Session } from './session';
import { ssDown, ssFactor } from './ssaa';
import { prewarmGlyphs, prewarmSharp } from '../render/glyphs';
import { EM } from '../text/metrics';

const idle = (fn: (d?: { timeRemaining(): number }) => void) => (typeof requestIdleCallback !== 'undefined' ? requestIdleCallback(d => fn(d), { timeout: 400 }) : setTimeout(() => fn(), 30));

export type View = 'hidden' | 'ambient' | 'effect';
export type AspectBox = 'fill' | number | { cover: number };
export interface Tick { t: number; dur: number; musicEnd: number; playing: boolean; rs: RhythmSample | null; session: Session | null }
export interface EngineEvents extends Record<string, unknown> { tick: Tick; change: void; musicend: Session; ended: Session; session: Session | null; frame: number }
export interface RenderSettings { scale: 'auto' | number; fps: number; prerender: boolean }

const CARRY = 3.2;          // seconds the song before stays on in album play
const RM = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Engine extends Emitter<EngineEvents> {
  readonly canvas: HTMLCanvasElement; private g: CanvasRenderingContext2D;
  session: Session | null = null;
  readonly clock: AudioClock;
  readonly video = new VideoSource(); readonly mv = new MvSource();
  readonly handoff = new Handoff();
  view: View = 'hidden'; loop = false; volume = 1; muted = false;
  render: RenderSettings = { scale: 'auto', fps: 0, prerender: true };
  labels: Record<string, string> = {};
  /** how the song's own video (MV mode) is graded and framed (an app setting) */
  mvLook: MvLook = { ...MV_LOOK };
  private t = 0; private playing = false; private scrub = false; private lastDraw = 0; private dirty = true;
  private pscale = 1; private ema = 0; private fast = 0;
  private fadeOut: { cv: HTMLCanvasElement; t0: number } | null = null;
  /** album play: the song before, still running on in the picture for a moment (see show) */
  private carry: { s: Session; t0: number; at: number } | null = null; private carryCv: HTMLCanvasElement | null = null;
  private box = { x: 0, y: 0, w: 1, h: 1 }; private cssW = 1; private cssH = 1; private dpr = 1;
  private ro: ResizeObserver | null = null; private host: HTMLElement | null = null; private raf = 0;
  private endedFired = false; private musicEndFired = false;
  aspectBox: AspectBox = 'fill';               // fill the host, letterbox an aspect inside it, or cover the host with it
  letterbox = '#000';

  constructor(canvas: HTMLCanvasElement, opts: { audioContext: () => AudioContext }) {
    super(); this.canvas = canvas; this.g = canvas.getContext('2d')!; this.clock = new AudioClock(opts.audioContext);
    this.handoff.toRef = r => this.toRef(r);
    this.raf = requestAnimationFrame(n => this.frame(n));
  }
  destroy() { cancelAnimationFrame(this.raf); this.ro?.disconnect(); this.clock.stop(); this.video.close(); this.mv.close(); }

  /* ---------- mounting and size ---------- */
  mount(host: HTMLElement) {
    if (this.canvas.parentNode !== host) host.prepend(this.canvas);
    this.host = host; this.ro?.disconnect(); this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(host); this.fit();
  }
  private fit() {
    const h = this.host; if (!h) return; const r = h.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    this.cssW = Math.round(r.width); this.cssH = Math.round(r.height);
    // 'fill': the host's own shape; a number: that aspect inside the host (letterboxed); { cover }: that aspect over the
    // whole host (cropped by the host, as a backdrop is)
    const ab = this.aspectBox, cover = typeof ab === 'object', a = ab === 'fill' ? this.cssW / this.cssH : cover ? ab.cover : ab;
    let w = this.cssW, hh = this.cssH;
    if (cover) { if (w / hh > a) hh = Math.round(w / a); else w = Math.round(hh * a); }
    else if (w / hh > a) w = Math.round(hh * a); else hh = Math.round(w / a);
    this.box = { x: Math.round((this.cssW - w) / 2), y: Math.round((this.cssH - hh) / 2), w, h: hh };
    // the canvas is exactly the picture's box; the host shows the letterbox around it
    Object.assign(this.canvas.style, { position: 'absolute', left: this.box.x + 'px', top: this.box.y + 'px', width: w + 'px', height: hh + 'px' });
    h.style.background = this.aspectBox === 'fill' || cover ? '' : this.letterbox;
    this.applyScale(); this.session?.aspectChanged(); this.dirty = true;
    this.redrawNow();
  }
  /** Draw at once (a resize clears the canvas: waiting for the next frame showed it black for a moment). */
  private redrawNow() { const s = this.session; if (!s || this.view === 'hidden' || s.needsFlush) return; try { this.draw(s); this.dirty = false; } catch (e) { console.warn(e); } }
  setAspectBox(a: AspectBox, letterbox = '#000') { const same = JSON.stringify(a) === JSON.stringify(this.aspectBox); this.aspectBox = a; this.letterbox = letterbox; if (!same) this.fit(); }
  /** The aspect of the picture's box (for sessions whose style fills the view). */
  viewAspect = () => this.box.w / Math.max(1, this.box.h);
  private baseDpr() { const d = Math.min(2, devicePixelRatio || 1); return this.render.scale === 'auto' ? d : Math.max(0.5, d * clamp(+this.render.scale || 1, 0.3, 1)); }
  private applyScale() { this.dpr = this.baseDpr() * this.pscale; const W = Math.round(this.box.w * this.dpr), H = Math.round(this.box.h * this.dpr); if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; this.redrawNow(); } }
  setRender(o: Partial<RenderSettings>) { Object.assign(this.render, o); if (this.render.scale !== 'auto') this.pscale = 1; this.applyScale(); this.dirty = true; }
  /** A window rect (CSS px) in the picture's reference px. */
  toRef(r: WinRect) { const c = this.canvas.getBoundingClientRect(), s = this.session, H = s ? s.plan.H : 720, k = H / Math.max(1, c.height);
    return { x: (r.left - c.left) * k, y: (r.top - c.top) * k, w: r.width * k, h: r.height * k }; }
  /** The cover's resting rect in window px, for the page to fly its own cover there (null when the theme draws none). */
  coverWindowRect(): WinRect & { rot: number; radius: number } | null {
    const f = this.frameAt(this.t); if (!f) return null; const s = this.session!; if (s.style.bgStyle !== 'cover') return null;
    const { coverTarget } = require_handoff(); const tg = coverTarget(f), c = this.canvas.getBoundingClientRect(), k = this.box.h / s.plan.H;
    return { left: c.left + (tg.cx - tg.S / 2) * k, top: c.top + (tg.cy - tg.S / 2) * k, width: tg.S * k, height: tg.S * k, rot: tg.rot, radius: tg.radius * k };
  }

  /* ---------- sessions ---------- */
  /** Show a session. 'song': the picture crossfades from the previous one, which is snapshot and fades out softly.
   *  'album' (in the effect view): one continuous shot — the song before keeps running on, its picture dissolving into
   *  the new one's (the same look) without a blur, and its last words stay on, drifting with its camera and fading,
   *  while the new song begins; the audio is not touched. */
  show(s: Session, o: { transition?: 'song' | 'album' | 'none'; at?: number; play?: boolean } = {}) {
    const was = this.playing; this.stopAudio(); this.carry = null;
    if (o.transition === 'album' && this.session && this.view === 'effect') this.carry = { s: this.session, t0: this.t, at: performance.now() };
    else if (o.transition && o.transition !== 'none' && this.session && this.view !== 'hidden') { const cv = makeCanvas(this.canvas.width, this.canvas.height) as HTMLCanvasElement; cv.getContext('2d')!.drawImage(this.canvas, 0, 0); this.fadeOut = { cv, t0: performance.now() }; }
    this.session = s; this.t = clamp(o.at ?? 0, 0, Math.max(0, s.dur - 0.01)); this.endedFired = false; this.musicEndFired = false;
    this.clock.hold(this.t); this.dirty = true; this.emit('session', s); this.emit('change', undefined);
    if (o.play ?? was) this.play();
  }
  clear() { this.stopAudio(); this.session = null; this.playing = false; this.dirty = true; this.emit('session', null); this.emit('change', undefined); }

  /* ---------- transport ---------- */
  get time() { return this.t; } get isPlaying() { return this.playing; }
  play() { const s = this.session; if (!s) return; if (this.t >= s.dur - 0.02) this.t = 0; this.playing = true; this.startAudio(); this.emit('change', undefined); }
  pause() { if (!this.playing) return; this.t = this.clock.now(this.session?.audioStart ?? 0); this.playing = false; this.stopAudio(); this.clock.hold(this.t); this.dirty = true; this.emit('change', undefined); }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(x: number, scrubbing = false) {
    const s = this.session; if (!s) return; this.t = clamp(x, 0, Math.max(0, s.dur - 0.01)); this.dirty = true; this.endedFired = false; this.musicEndFired = this.t >= s.musicEnd;
    if (scrubbing) { this.scrub = true; if (this.playing) this.clock.stop(); this.clock.hold(this.t); }
    else { this.scrub = false; this.clock.hold(this.t); if (this.playing) this.startAudio(); }
  }
  setOutput(o: ExternalOut | null) { const on = this.playing; this.stopAudio(); this.clock.setExternal(o); if (on) this.startAudio(); }
  private startAudio() { const s = this.session; if (!s) return; const end = s.audio ? s.audioStart + s.musicEnd : 0; this.clock.start(this.t, s.audio, s.audioStart, end); this.gain(); }
  private stopAudio() { this.clock.stop(); }
  private gain() { const s = this.session; if (!s) return; const e = s.musicEnd, f = s.spec.fade !== false ? 1 - clamp((this.t - (e - 1.6)) / 1.6) : 1; this.clock.gain(this.muted ? 0 : f * this.volume * this.balance); }
  /** The volume balance: one steady factor for the whole song (its loudness towards the others'), nothing that moves
   *  with the music — no compression, no limiting; a boost stays within the song's own headroom (rhythm/loudness.ts). */
  balance = 1;
  setBalance(k: number) { this.balance = Math.max(0, Math.min(4, isFinite(k) ? k : 1)); this.gain(); }
  setVolume(v: number) { this.volume = clamp(v); this.gain(); }
  setMuted(m: boolean) { this.muted = m; this.gain(); }

  /* ---------- views ---------- */
  /** Change what is drawn. ambient ↔ effect runs the shared-element handoff (spec: where the page's elements are). */
  setView(v: View, spec: HandoffSpec = {}, o: { instant?: boolean } = {}): Promise<void> {
    const prev = this.view; this.view = v; this.dirty = true;
    if (o.instant) { this.handoff.jump(v === 'effect' ? 1 : 0); return Promise.resolve(); }
    if (v === 'hidden') { this.handoff.jump(0); return Promise.resolve(); }
    // coming out of hidden: draw now, so the stage never shows a stale picture for the frame it becomes visible
    if (prev === 'hidden' && this.session) { this.handoff.jump(0); try { this.draw(this.session); this.dirty = false; } catch (e) { console.warn(e); } }
    if (v === 'ambient' && prev === 'effect') return this.handoff.go(0, spec);
    if (v === 'effect' && prev !== 'effect') { if (prev === 'hidden') this.handoff.jump(0); return this.handoff.go(1, spec); }
    if (v === 'ambient') this.handoff.jump(0);
    return Promise.resolve();
  }
  invalidate() { this.dirty = true; }
  /** Draw the page's picture once while nothing shows it (the now-playing page warming up out of sight): the canvas, the
   *  ambient field and the cover's layers are then made before the page first opens. */
  warmPicture() { const s = this.session; if (!s || s.needsFlush || this.view !== 'hidden') return false; try { this.draw(s); } catch (e) { console.warn(e); } this.dirty = true; return true; }

  /* ---------- the frame ---------- */
  frameAt(t: number, opts: { offline?: boolean; px?: number } = {}, sess?: Session): RenderFrame | null {
    const s = sess || this.session; if (!s) return null; const plan = s.plan, motion = RM ? 0.25 : 1;
    const cf = cameraAt(plan, s.sig, t, motion), rs = cf.rs, M = s.style.m;
    const mvEnd = this.mv.k > 0 ? this.mv.endK(t, s.audioStart) : 1;   // (an MV shorter than the song: fading out at its end)
    const p = this.handoff.p, scene = opts.offline ? 1 : this.handoff.scene;
    return { plan, style: s.style, pal: s.pal, ambient: s.ambient, t, dt: 0, W: plan.W, H: plan.H, px: opts.px ?? this.canvas.height / plan.H,
      cam: cf, rs, media: { cover: s.cover, coverKey: s.coverKey, video: s.style.bgStyle === 'video' ? this.video.drawable() : null, mv: this.mv.k > 0 && mvEnd > 0 ? { ...(this.mv.drawable() || { frame: null, w: 16, h: 9 }), k: this.mv.k * mvEnd } : null, mvDone: this.mv.k > 0 && mvEnd < 1, mvLook: this.mvLook },
      view: { effect: opts.offline ? 1 : (this.view === 'effect' || p > 0 ? scene : 0) }, motion, offline: !!opts.offline, labels: this.labels,
      I: clamp(0.35 + 0.65 * rs.level), P: rs.pulse * clamp(M.pulse, 0, 2) * cf.calm * (1 - rs.still), ink: s.pal.text,
      coverOwner: opts.offline ? 'backdrop' : this.handoff.coverOwner, vinylOut: opts.offline ? 1 : this.handoff.vinyl,
      wordAlpha: opts.offline ? undefined : (i: number, k: number) => this.handoff.wordAlpha(i, k) } as RenderFrame;
  }
  private frame(now: number) {
    this.raf = requestAnimationFrame(n => this.frame(n));
    const t0 = performance.now(), s = this.session;
    if (!s) { if (this.dirty && this.view !== 'hidden') { this.dirty = false; this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.clearRect(0, 0, this.canvas.width, this.canvas.height); } return; }
    if (s.needsFlush) { s.flush().then(() => { this.dirty = true; this.emit('change', undefined); }).catch(e => console.warn(e)); }
    if (this.playing && !this.scrub) {
      this.t = this.clock.now(s.audioStart);
      if (!this.musicEndFired && this.t >= s.musicEnd) { this.musicEndFired = true; this.emit('musicend', s); }
      if (this.t >= s.dur) { if (this.loop) { this.seek(0); } else { this.t = s.dur; this.playing = false; this.stopAudio(); this.clock.hold(this.t); if (!this.endedFired) { this.endedFired = true; this.emit('ended', s); } this.emit('change', undefined); } }
      this.gain(); this.dirty = true;
    }
    const vis = this.view !== 'hidden';
    this.video.sync(this.t, this.playing, s.audioStart, vis && s.style.bgStyle === 'video');
    this.mv.sync(this.t, this.playing, s.audioStart, vis && (this.mv.on || this.mv.k > 0));
    if (this.mv.tick()) this.dirty = true;
    if (this.handoff.tick()) this.dirty = true;
    if (this.playing && this.mv.k > 0) this.dirty = true;
    if (this.fadeOut || this.carry) this.dirty = true;
    if (this.view === 'ambient') this.dirty = true;        // the ambient field is alive even while paused
    const cap = this.render.fps > 0 ? 1000 / this.render.fps : 0, due = !cap || now - this.lastDraw >= cap - 1.5;
    if (vis && this.dirty && due) { this.dirty = false; this.lastDraw = now; try { this.draw(s); } catch (e) { console.warn(e); } }
    if (!s.needsFlush && (!this.bake || this.bake.plan !== s.plan)) this.startBake(s);
    const f = this.playing ? this.frameRs(s) : null;
    this.emit('tick', { t: this.t, dur: s.dur, musicEnd: s.musicEnd, playing: this.playing, rs: f, session: s });
    // adapt the resolution while playing (never below one CSS pixel), restore it when paused
    if (vis && this.render.scale === 'auto') { const d = performance.now() - t0; this.ema = this.ema ? this.ema * 0.9 + d * 0.1 : d;
      if (!this.playing && this.pscale < 1) { this.pscale = 1; this.applyScale(); this.dirty = true; }
      else if (this.playing && this.ema > 22 && this.pscale > 1 / this.baseDpr() + 1e-3) { this.pscale = Math.max(1 / this.baseDpr(), this.pscale - 0.25); this.applyScale(); this.ema = 0; }
      else if (this.playing && this.ema < 9 && this.pscale < 1) { if (++this.fast > 120) { this.pscale = Math.min(1, this.pscale + 0.25); this.applyScale(); this.ema = 0; this.fast = 0; } } else this.fast = 0; }
    // look ahead: draw ~0.6 s ahead into a tiny canvas when the frame had time to spare (fills the glyph caches)
    if (vis && this.view === 'effect' && this.render.prerender && this.playing && performance.now() - t0 < 9) { try { this.lookAhead(s, this.t + 0.6); } catch { /* ignore */ } }
    this.emit('frame', now);
  }
  private rsCache: { t: number; v: RhythmSample } | null = null;
  private frameRs(s: Session) { if (this.rsCache && this.rsCache.t === this.t) return this.rsCache.v; const v = s.sig.sample(this.t); this.rsCache = { t: this.t, v }; return v; }
  private draw(s: Session) {
    const f = this.frameAt(this.t); if (!f) return; const g = this.g, cw = this.canvas.width, ch = this.canvas.height;
    const N = !this.playing ? ssFactor(s.style.aa, cw, ch) : 1, target = N > 1 ? this.ssCanvas(cw * N, ch * N) : null, tg = target ? target.getContext('2d')! : g;
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over';
    f.px = ch * N / s.plan.H;
    drawFrame(tg, f, { sig: s.sig, captions: true, captionBottom: s.plan.H * 0.9, under: (gg, ff) => this.handoff.drawCover(gg, ff), overlay: (gg, ff) => this.handoff.draw(gg, ff) });
    if (target) ssDown(target, this.canvas, N);
    if (this.carry) { const el = (performance.now() - this.carry.at) / 1000; if (el >= CARRY || this.carry.s.needsFlush) this.carry = null; else this.drawCarry(this.carry, el); }
    if (this.fadeOut) { const u = clamp((performance.now() - this.fadeOut.t0) / 900);
      if (u >= 1) this.fadeOut = null; else { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = (1 - u) ** 1.5; g.filter = `blur(${(u * 18 * this.dpr).toFixed(1)}px)`; g.drawImage(this.fadeOut.cv, 0, 0, cw, ch); g.filter = 'none'; g.restore(); } }
  }
  /** The song before, over the new one: its whole picture for the first second (dissolving), then its words alone. */
  private drawCarry(c: { s: Session; t0: number }, el: number) {
    const f = this.frameAt(c.t0 + el, {}, c.s); if (!f) return; const g = this.g, cw = this.canvas.width, ch = this.canvas.height, u = clamp(el / 1.0);
    f.px = ch / c.s.plan.H;
    if (u < 1) { if (!this.carryCv || this.carryCv.width !== cw || this.carryCv.height !== ch) this.carryCv = makeCanvas(cw, ch) as HTMLCanvasElement;
      const cg = this.carryCv.getContext('2d')!; cg.setTransform(1, 0, 0, 1, 0, 0); cg.globalAlpha = 1; cg.clearRect(0, 0, cw, ch); drawFrame(cg, f, { sig: c.s.sig });
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = (1 - u) ** 1.3; g.drawImage(this.carryCv, 0, 0); g.restore(); }
    const L = 1 - sstep(clamp((el - 0.6) / (CARRY - 0.6))), k = L * (1 - (1 - u) ** 1.3); if (k < 0.01) return;
    const { visibleWords, drawLyrics } = require_lyrics(); f.view = { effect: k }; f.vis = visibleWords(f, false);
    drawLyrics(g, f, f.vis, { ink: f.pal.text, split: 0 });
  }
  private ss: HTMLCanvasElement | null = null;
  private ssCanvas(w: number, h: number) { if (!this.ss) this.ss = makeCanvas(w, h) as HTMLCanvasElement; if (this.ss.width !== w || this.ss.height !== h) { this.ss.width = w; this.ss.height = h; } return this.ss; }
  private warm: CanvasRenderingContext2D | null = null;
  /* ---------- baking ahead ----------
     Once a song is planned, idle time is spent making what it will need before it is needed: the glyph ladder of every
     character in its lyrics (in the colours the lyric pass blurs), then one full frame drawn off screen at each moment
     that first uses something costly — each transition's blur, each glyph contour, the start of the words, and a frame
     half-way through the hand-over (its layer, the cover's layers) — so no transition is slow the first time it plays. */
  private bake: { plan: unknown; steps: (() => boolean)[]; i: number; heavy: boolean[] } | null = null; private probeCv: HTMLCanvasElement | null = null;
  private startBake(s: Session) {
    const f0 = this.frameAt(0); if (!f0) return; const plan = s.plan, { lyricBake } = require_lyrics(), spec = lyricBake(f0);
    const glyphs = prewarmGlyphs(spec.font, spec.cols, spec.chars, [1, 2, 3, 4, 5], spec.grad), steps: (() => boolean)[] = [], heavy: boolean[] = [];
    steps.push(() => glyphs(3)); heavy.push(false);
    // the glyph panes (the large frosted character): each made once, ahead, never in the frame its slot comes in
    { const panes = require_glyph().glyphPaneWarm(f0); steps.push(() => panes()); heavy.push(false); }
    // the large levels only for the glyphs the camera will frame large (the plan knows each framing's closeness)
    const pxK = this.canvas.height / plan.H, big = new Set<string>();
    for (const st of plan.camera.stops) for (const S of st.words) if (EM * S.s * st.z * pxK > 150) for (const u of S.units) big.add(u.c);
    if (big.size) { const large = prewarmGlyphs(spec.font, [], [...big], [0, 1], spec.grad); steps.push(() => large(3)); heavy.push(false); }
    // and the sharp bitmaps they are drawn from at those sizes (the face, its edge, an unsung character's outline): a
    // close-up otherwise made them in the frames that first showed them
    { const seen = new Set<string>(), items: [string, number][] = [];
      for (const st of plan.camera.stops) for (const S of st.words) { const G = EM * S.s * st.z * pxK; if (G < 150) continue;
        for (const u of S.units) for (const g of [G, G * 1.12]) { const k = u.c + '|' + Math.round(Math.log2(g) * 4); if (!seen.has(k)) { seen.add(k); items.push([u.c, g]); } } }
      if (items.length) { const sharp = prewarmSharp(spec.font, items.slice(0, 600), [spec.grad, spec.edge, { stroke: spec.ink, w: 2.4 }]); steps.push(() => sharp(3)); heavy.push(false); }
      // (the emphasised words' own fill, at the same sizes)
      const em = new Set(spec.emph.chars), emItems = items.filter(([c]) => em.has(c));
      if (emItems.length) { const sharpE = prewarmSharp(spec.font, emItems.slice(0, 200), [spec.emph.grad]); steps.push(() => sharpE(3)); heavy.push(false); } }
    // the emphasised words' blur levels in the flash's colour
    if (spec.emph.chars.length) { const emG = prewarmGlyphs(spec.font, [], spec.emph.chars, [1, 2, 3, 4, 5], spec.emph.grad); steps.push(() => emG(3)); heavy.push(false); }
    // (the first transition at several depths of its blur: each depth works at its own size)
    const first = plan.words[0]?.show ?? 0, p0 = plan.passages[0], ramp = p0 ? [0.2, 0.4, 0.6, 0.8].map(u => p0.t - p0.inn * (1 - u)) : [];
    const times = [first + 0.3, ...ramp, ...plan.passages.map(p => p.t), ...plan.cues.glyphSlots.map(g => g.t + 0.6),
      // (and the first shatter at a few moments of it: the cracks, the pieces breaking out, flying — its first frames were
      // the slow ones; once drawn, every later shatter is as quick as any frame)
      ...plan.cues.glass.slice(0, 1).flatMap(g => [g.t + 0.04, g.t + 0.15, g.t + 0.4, g.t + 0.9])];
    for (const T of [...new Set(times.map(x => Math.round(x * 10) / 10))].filter(x => x >= 0 && x < plan.dur)) { steps.push(() => { this.probe(s, T, false); return false; }); heavy.push(true); }
    steps.push(() => { this.probe(s, first + 0.3, true); return false; }); heavy.push(true);
    this.bake = { plan, steps, i: 0, heavy }; idle(this.runBake);
  }
  private runBake = (dl?: { timeRemaining(): number }) => {
    const b = this.bake, s = this.session; if (!b || !s || b.plan !== s.plan) return;
    const t0 = performance.now(), budget = () => (dl ? dl.timeRemaining() : (this.playing ? 3 : 8) - (performance.now() - t0));
    while (b.i < b.steps.length) {
      if (b.heavy[b.i] && this.playing && budget() < 16) break;             // a full frame only when there is room for it
      if (!b.heavy[b.i] && budget() < 1) break;
      try { if (!b.steps[b.i]()) b.i++; } catch (e) { console.warn(e); b.i++; }
      if (b.heavy[b.i - 1]) break;
    }
    if (b.i < b.steps.length) idle(this.runBake); else this.probeCv = null;
  };
  private probe(s: Session, t: number, mid: boolean) {
    const f = this.frameAt(t); if (!f) return; const W = this.canvas.width, H = this.canvas.height; if (W < 4 || H < 4) return;
    if (!this.probeCv || this.probeCv.width !== W || this.probeCv.height !== H) { this.probeCv = makeCanvas(W, H) as HTMLCanvasElement; }
    const g = this.probeCv.getContext('2d')!; f.px = H / s.plan.H; if (mid) { f.view = { effect: 0.5 }; f.coverOwner = 'backdrop'; } else f.view = { effect: 1 };
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); drawFrame(g, f, { sig: s.sig });
  }
  private lookAhead(s: Session, t: number) {
    if (t >= s.dur) return; if (!this.warm) this.warm = (makeCanvas(2, 2) as HTMLCanvasElement).getContext('2d')!;
    const f = this.frameAt(t); if (!f) return; f.px = this.canvas.height / s.plan.H;
    const { visibleWords, drawLyrics } = require_lyrics(); f.vis = visibleWords(f, !!f.plan.titles.end); this.warm.setTransform(f.px, 0, 0, f.px, 0, 0); drawLyrics(this.warm, f, f.vis, { ink: f.pal.text, split: 0 });
  }
}
import * as handoffMod from './handoff';
import * as lyricsMod from '../render/lyrics';
const require_handoff = () => handoffMod;
const require_lyrics = () => lyricsMod;
import * as glyphMod from '../render/effects/glyph';
const require_glyph = () => glyphMod;
