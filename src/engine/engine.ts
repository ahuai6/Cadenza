/* The engine: one canvas, one clock, one loop. Each frame it reads the clock once, builds one RenderFrame (camera,
   rhythm sample, view, media) and draws it; the interface hears about the same moment through a single 'tick'.
   - sessions: whatever is shown (a song, the workshop's project) is a Session; showing another one crossfades them;
   - views: hidden (nothing drawn, time still runs), ambient (the now-playing page's backdrop), effect (the full picture),
     with the shared-element handoff between ambient and effect;
   - render settings only change how many pixels are drawn and how often, never which effects;
   - coming moments are drawn ahead into a tiny canvas while there is time to spare, so their glyphs are ready. */
import { clamp } from '../core/math';
import { Emitter } from '../core/emitter';
import { cameraAt } from '../director/evaluate';
import { drawFrame } from '../render/renderer';
import type { RenderFrame } from '../render/frame';
import { makeCanvas } from '../render/palette';
import type { RhythmSample } from '../rhythm/signals';
import { AudioClock, type ExternalOut } from './audio';
import { VideoSource, MvSource } from './media';
import { Handoff, type HandoffSpec, type WinRect } from './handoff';
import type { Session } from './session';
import { ssDown, ssFactor } from './ssaa';

export type View = 'hidden' | 'ambient' | 'effect';
export interface Tick { t: number; dur: number; musicEnd: number; playing: boolean; rs: RhythmSample | null; session: Session | null }
export interface EngineEvents extends Record<string, unknown> { tick: Tick; change: void; musicend: Session; ended: Session; session: Session | null; frame: number }
export interface RenderSettings { scale: 'auto' | number; fps: number; prerender: boolean }

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
  private t = 0; private playing = false; private scrub = false; private last = 0; private lastDraw = 0; private dirty = true;
  private pscale = 1; private ema = 0; private fast = 0;
  private fadeOut: { cv: HTMLCanvasElement; t0: number } | null = null;
  private box = { x: 0, y: 0, w: 1, h: 1 }; private cssW = 1; private cssH = 1; private dpr = 1;
  private ro: ResizeObserver | null = null; private host: HTMLElement | null = null; private raf = 0;
  private endedFired = false; private musicEndFired = false;
  aspectBox: 'fill' | number = 'fill';         // fill the host, or letterbox to an aspect inside it
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
    const a = this.aspectBox === 'fill' ? this.cssW / this.cssH : this.aspectBox;
    let w = this.cssW, hh = this.cssH; if (w / hh > a) w = Math.round(hh * a); else hh = Math.round(w / a);
    this.box = { x: Math.round((this.cssW - w) / 2), y: Math.round((this.cssH - hh) / 2), w, h: hh };
    // the canvas is exactly the picture's box; the host shows the letterbox around it
    Object.assign(this.canvas.style, { position: 'absolute', left: this.box.x + 'px', top: this.box.y + 'px', width: w + 'px', height: hh + 'px' });
    h.style.background = this.aspectBox === 'fill' ? '' : this.letterbox;
    this.applyScale(); this.session?.aspectChanged(); this.dirty = true;
  }
  setAspectBox(a: 'fill' | number, letterbox = '#000') { this.aspectBox = a; this.letterbox = letterbox; this.fit(); }
  /** The aspect of the picture's box (for sessions whose style fills the view). */
  viewAspect = () => this.box.w / Math.max(1, this.box.h);
  private baseDpr() { const d = Math.min(2, devicePixelRatio || 1); return this.render.scale === 'auto' ? d : Math.max(0.5, d * clamp(+this.render.scale || 1, 0.3, 1)); }
  private applyScale() { this.dpr = this.baseDpr() * this.pscale; const W = Math.round(this.box.w * this.dpr), H = Math.round(this.box.h * this.dpr); if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; } }
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
  /** Show a session. 'song': the picture crossfades from the previous one, which is snapshot and fades out softly. */
  show(s: Session, o: { transition?: 'song' | 'none'; at?: number; play?: boolean } = {}) {
    const was = this.playing; this.stopAudio();
    if (o.transition === 'song' && this.session && this.view !== 'hidden') { const cv = makeCanvas(this.canvas.width, this.canvas.height) as HTMLCanvasElement; cv.getContext('2d')!.drawImage(this.canvas, 0, 0); this.fadeOut = { cv, t0: performance.now() }; }
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
  private gain() { const s = this.session; if (!s) return; const e = s.musicEnd, f = s.spec.fade !== false ? 1 - clamp((this.t - (e - 1.6)) / 1.6) : 1; this.clock.gain(this.muted ? 0 : f * this.volume); }
  setVolume(v: number) { this.volume = clamp(v); this.gain(); }
  setMuted(m: boolean) { this.muted = m; this.gain(); }

  /* ---------- views ---------- */
  /** Change what is drawn. ambient ↔ effect runs the shared-element handoff (spec: where the page's elements are). */
  setView(v: View, spec: HandoffSpec = {}): Promise<void> {
    const prev = this.view; this.view = v; this.dirty = true;
    if (v === 'hidden') { this.handoff.jump(0); return Promise.resolve(); }
    if (v === 'ambient' && prev === 'effect') return this.handoff.go(0, spec);
    if (v === 'effect' && prev !== 'effect') { if (prev === 'hidden') this.handoff.jump(0); return this.handoff.go(1, spec); }
    if (v === 'ambient') this.handoff.jump(0);
    return Promise.resolve();
  }
  invalidate() { this.dirty = true; }

  /* ---------- the frame ---------- */
  frameAt(t: number, opts: { offline?: boolean; px?: number } = {}): RenderFrame | null {
    const s = this.session; if (!s) return null; const plan = s.plan, motion = RM ? 0.25 : 1;
    const cf = cameraAt(plan, s.sig, t, motion), rs = cf.rs, M = s.style.m;
    const p = this.handoff.p, scene = opts.offline ? 1 : this.handoff.scene;
    return { plan, style: s.style, pal: s.pal, ambient: s.ambient, t, dt: 0, W: plan.W, H: plan.H, px: opts.px ?? this.canvas.height / plan.H,
      cam: cf, rs, media: { cover: s.cover, coverKey: s.coverKey, video: s.style.bgStyle === 'video' ? this.video.drawable() : null, mv: this.mv.k > 0 ? { ...(this.mv.drawable() || { frame: null, w: 16, h: 9 }), k: this.mv.k } : null },
      view: { effect: opts.offline ? 1 : (this.view === 'effect' || p > 0 ? scene : 0) }, motion, offline: !!opts.offline, labels: this.labels,
      I: clamp(0.35 + 0.65 * rs.level), P: rs.pulse * clamp(M.pulse, 0, 2) * cf.calm * (1 - rs.still), ink: s.pal.text,
      coverOwner: opts.offline ? 'backdrop' : this.handoff.coverOwner, vinylOut: opts.offline ? 1 : this.handoff.vinyl,
      wordAlpha: opts.offline ? undefined : (i: number) => this.handoff.wordAlpha(i) } as RenderFrame;
  }
  private frame(now: number) {
    this.raf = requestAnimationFrame(n => this.frame(n));
    const t0 = performance.now(), s = this.session, dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
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
    if (this.fadeOut) this.dirty = true;
    if (this.view === 'ambient') this.dirty = true;        // the ambient field is alive even while paused
    const cap = this.render.fps > 0 ? 1000 / this.render.fps : 0, due = !cap || now - this.lastDraw >= cap - 1.5;
    if (vis && this.dirty && due) { this.dirty = false; this.lastDraw = now; try { this.draw(s); } catch (e) { console.warn(e); } }
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
    drawFrame(tg, f, { sig: s.sig, captions: true, captionBottom: s.plan.H * 0.9, overlay: (gg, ff) => this.handoff.draw(gg, ff) });
    if (target) ssDown(target, this.canvas, N);
    if (this.fadeOut) { const u = clamp((performance.now() - this.fadeOut.t0) / 900);
      if (u >= 1) this.fadeOut = null; else { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = (1 - u) ** 1.5; g.filter = `blur(${(u * 18 * this.dpr).toFixed(1)}px)`; g.drawImage(this.fadeOut.cv, 0, 0, cw, ch); g.filter = 'none'; g.restore(); } }
  }
  private ss: HTMLCanvasElement | null = null;
  private ssCanvas(w: number, h: number) { if (!this.ss) this.ss = makeCanvas(w, h) as HTMLCanvasElement; if (this.ss.width !== w || this.ss.height !== h) { this.ss.width = w; this.ss.height = h; } return this.ss; }
  private warm: CanvasRenderingContext2D | null = null;
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
