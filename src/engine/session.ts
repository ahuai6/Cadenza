/* A session: one song (or one workshop project) with everything bound to it — audio, rhythm, lyrics, style, cover,
   video — and its plan. Sessions are independent objects: the player and the workshop each keep their own, and the
   engine can render two at once (a song change crossfades them). Edits go through the session; it replans what they
   affect, in one place. */
import { parse, parseRange } from '../lyrics/parse';
import { buildLyrics, type LyricDoc } from '../lyrics/model';
import { RhythmMap, Signals, analyzeInBackground, isCurrent, type RhythmAnalysis } from '../rhythm';
import { plan as makePlan, ASPECTS, type ScenePlan } from '../director';
import type { SongInfo } from '../director/titles';
import { styleFromStored, presetStyle, normalizeStyle, knobbed, isCustom, PROJECT_KEYS, KNOB_REBUILD, type Style } from '../theme/style';
import { canvasMeasurer, EM } from '../text/metrics';
import { fontStack, ensureFontSoon } from '../text/fonts';
import { paletteOf, paletteFromImage, ambientFromImage, ambientFromName, type Palette, type Ambient } from '../render/palette';
import { clearGlyphCache } from '../render/glyphs';
import type { AudioLike } from './audio';

export interface SessionSpec {
  key: string;
  lyrics: string;
  /** a stored style, or none: the cover theme in the cover's colours */
  style?: unknown;
  song: SongInfo;
  coverUrl?: string;
  audio?: AudioLike | null;
  analysis?: RhythmAnalysis | null;
  range?: string; lshift?: number; bpm?: number; endLen?: number;
  fade?: boolean;
  /** the frame's aspect, whatever the stored style says ('fill': the view's own, as the player shows it) */
  aspect?: string;
}
export interface SessionEnv { lang: string; labels: { composer: string; lyricist: string; artist: string }; viewAspect: () => number; onAnalysis?: (a: RhythmAnalysis) => void }
type Img = CanvasImageSource & { width: number; height: number };

const titleCard = (s: SongInfo) => `[00:00.00]${(s.title || '♪').replace(/[[\]<>#|]/g, ' ')}` + (s.artist ? `\n[00:00.00]${s.artist.replace(/[[\]<>#|]/g, ' ')}` : '');
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(res => { if (!url) return res(null); const im = new Image(); if (!/^data:/.test(url)) im.crossOrigin = 'anonymous'; im.decoding = 'async';
    im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}

export class Session {
  spec: SessionSpec; style!: Style; pal!: Palette; ambient!: Ambient;
  cover: Img | null = null; coverKey = '';
  map!: RhythmMap; sig!: Signals; doc!: LyricDoc; plan!: ScenePlan;
  hasLyrics = false; audioStart = 0; musicEnd = 0; dur = 0; endLen = 3.5;
  version = 0;                        // bumps on every replan (views re-read the plan)
  private dirty = 0;                  // what needs rebuilding before the next frame
  constructor(spec: SessionSpec, private env: SessionEnv) { this.spec = { ...spec }; }

  static async open(spec: SessionSpec, env: SessionEnv): Promise<Session> {
    const s = new Session(spec, env);
    s.cover = await loadImage(spec.coverUrl || ''); s.coverKey = spec.coverUrl || '';
    s.style = spec.style ? styleFromStored(spec.style) : { ...presetStyle('cover'), ...(s.cover ? paletteFromImage(s.cover) : {}) };
    if (spec.aspect) s.style.aspect = spec.aspect;
    s.colors();
    let a = spec.analysis && isCurrent(spec.analysis) ? spec.analysis : null;
    const buf = spec.audio;
    if (!a && buf && buf.getChannelData && !buf.load) { a = await analyzeInBackground(buf as AudioBuffer); env.onAnalysis?.(a); }
    s.analysis = a;
    await s.build();
    return s;
  }
  analysis: RhythmAnalysis | null = null;
  get audio() { return this.spec.audio ?? null; }

  /** Everything from the lyrics down: timing, rhythm map, lyric model, plan. */
  async build() {
    const sp = this.spec, r = parseRange(sp.range), buf = sp.audio;
    this.audioStart = r.a - (sp.lshift || 0) / 1000; this.endLen = Math.min(8, Math.max(2, sp.endLen ?? 3.5));
    const fileEnd = buf ? (r.b != null ? Math.min(r.b, buf.duration) : buf.duration) : Infinity;
    const parsedLen = isFinite(fileEnd) ? fileEnd - r.a : Infinity;
    let parsed = parse(sp.lyrics || '', r.a, parsedLen); this.hasLyrics = parsed.lines.length > 0;
    if (!this.hasLyrics) parsed = parse(titleCard(sp.song), 0);
    // song time 0 is the range start; the lyric shift moves the music under the lyrics (it is in audioStart), so the
    // layout, the beats, the audio and the video stay in agreement
    const text = parsed.lines.map(L => L.text).join('');
    await ensureFontSoon(this.style.font, text + sp.song.title, this.env.lang, 1200, () => { this.dirty |= 1; });
    const last = parsed.lines[parsed.lines.length - 1];
    this.musicEnd = buf ? Math.max(1, fileEnd - this.audioStart) : (last ? (last.stop ?? last.t + 3) + 1.6 : 10);
    this.dur = this.musicEnd + this.endLen;
    this.map = this.analysis ? new RhythmMap(this.analysis, this.audioStart) : RhythmMap.grid(Math.max(40, Math.min(240, sp.bpm || 120)), 0, this.dur + 2);
    this.sig = new Signals(this.map);
    this.doc = buildLyrics(parsed, this.map, this.musicEnd);
    this.replan();
  }
  replan() {
    const fc = fontStack(this.style.font, this.doc.lines.map(L => L.text).join('').slice(0, 400), this.env.lang);
    const aspect = ASPECTS[this.style.aspect] ?? this.env.viewAspect();
    clearGlyphCache();
    this.plan = makePlan({ doc: this.doc, map: this.map, style: this.style, measure: canvasMeasurer(`${fc.w} ${EM}px ${fc.stack}`), aspect,
      musicEnd: this.musicEnd, endLen: this.endLen, song: this.spec.song, labels: this.env.labels });
    this.version++; this.dirty = 0;
  }
  colors() { this.pal = paletteOf(this.style); this.ambient = this.cover ? ambientFromImage(this.cover) : ambientFromName(this.spec.song.title); }
  /** Rebuild whatever edits asked for (called by the engine once per frame at most). */
  async flush() { if (this.dirty & 2) await this.build(); else if (this.dirty & 1) this.replan(); }
  get needsFlush() { return this.dirty !== 0; }

  /* ---- edits ---- */
  get custom() { return isCustom(this.style); }
  setStyle(k: keyof Style | string, v: unknown) {
    const st = this.style as any;
    if (!this.custom && !PROJECT_KEYS.includes(k as string)) return false;
    if (st[k] === v) return true; st[k] = v;
    if (['bg', 'bg2', 'text', 'accent', 'flash'].includes(k as string)) { this.colors(); return true; }
    if (['vidDark', 'vidBlur', 'vidDesat', 'coverSize', 'coverEdge', 'coverBlur', 'aa', 'quality'].includes(k as string)) return true;
    if (k === 'font') { this.dirty |= 2; return true; }
    if (k === 'bgStyle') { st.coverEdge ??= 'album'; st.coverBlur ??= 0; st.coverSize ??= 0.6; }
    this.dirty |= 1; return true;
  }
  setKnob(k: string, v: number) { if (!this.custom && k !== 'size') return false; this.style.k[k] = +v; this.style.m = knobbed(this.style.m0, this.style.k); if (KNOB_REBUILD[k]) this.dirty |= 1; return true; }
  setEffect(id: string, on: boolean) { if (!this.custom) return false; this.style.fx[id] = !!on; if (id === 'glass' || id === 'glyph' || id === 'frame') this.dirty |= 1; return true; }
  setEffectParam(id: string, key: string, v: number | string | boolean) { if (!this.custom) return false; (this.style.fxp ||= {})[id] = { ...(this.style.fxp?.[id] || {}), [key]: v }; return true; }
  makeCustom() { if (this.custom) return; this.style = { ...JSON.parse(JSON.stringify(this.style)), preset: 'custom', from: this.style.from || this.style.preset, id: null, name: '' }; this.style.m = knobbed(this.style.m0, this.style.k); }
  applyPreset(id: string) { const keep = this.style; this.style = presetStyle(id, keep); if (this.spec.aspect) this.style.aspect = this.spec.aspect; if (id === 'cover' && this.cover) Object.assign(this.style, paletteFromImage(this.cover)); this.colors(); this.dirty |= 2; }
  applyTheme(stored: unknown) { const keep = this.style; this.style = normalizeStyle({ ...(JSON.parse(JSON.stringify(stored)) as Style), preset: 'custom', aspect: this.spec.aspect || keep.aspect, quality: keep.quality, aa: keep.aa }); this.colors(); this.dirty |= 2; }
  coverPalette() { if (!this.cover) return; Object.assign(this.style, paletteFromImage(this.cover)); this.colors(); }
  setSong(p: Partial<SongInfo>) { this.spec.song = { ...this.spec.song, ...p }; if (!this.hasLyrics) this.dirty |= 2; else this.dirty |= 1; }
  setLyrics(src: string) { this.spec.lyrics = src; this.dirty |= 2; }
  setTiming(p: { lshift?: number; range?: string; endLen?: number; bpm?: number }) { Object.assign(this.spec, p); this.dirty |= 2; }
  async setCover(url: string, repaint: boolean) {
    this.cover = await loadImage(url); this.coverKey = url; this.spec.coverUrl = url;
    if (repaint && this.cover) { if (this.style.bgStyle !== 'cover') { if (this.custom) this.style.bgStyle = 'cover'; else this.style = presetStyle('cover', this.style); } Object.assign(this.style, paletteFromImage(this.cover)); }
    this.colors(); this.dirty |= repaint ? 1 : 0;
  }
  setAudio(buf: AudioLike | null, analysis: RhythmAnalysis | null) { this.spec.audio = buf; this.analysis = analysis && isCurrent(analysis) ? analysis : null; this.dirty |= 2; }
  /** The aspect changed (a fill-the-window view resized): the camera and layout depend on it. */
  aspectChanged() { if (this.style.aspect === 'fill') this.dirty |= 1; }
}
