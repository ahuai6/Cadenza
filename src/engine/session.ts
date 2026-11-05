/* A session: one song (or one workshop project) with everything bound to it — audio, rhythm, lyrics, style, cover,
   video — and its plan. Sessions are independent objects: the player and the workshop each keep their own, and the
   engine can render two at once (a song change crossfades them). Edits go through the session; it replans what they
   affect, in one place. */
import { parse, parseRange } from '../lyrics/parse';
import { respace, type Spacing } from '../lyrics/spacing';
import { loadSegmenter, segmenterReady } from '../text/segment';
import { buildLyrics, type LyricDoc } from '../lyrics/model';
import { RhythmMap, Signals, analyzeInBackground, isCurrent, type RhythmAnalysis } from '../rhythm';
import { planCuesFor, recommendMotion, ASPECTS, type ScenePlan } from '../director';
import { planSong, type MapOrigin } from './planner';
import type { SongInfo } from '../director/titles';
import { styleFromStored, presetStyle, normalizeStyle, knobbed, isCustom, withLook, withMotion, PROJECT_KEYS, KNOB_REBUILD, REPLAN, RECUE, LOOK_KEYS, type Style } from '../theme/style';
import { canvasMeasurer, EM } from '../text/metrics';
import { fontStack, ensureFontSoon } from '../text/fonts';
import { paletteOf, paletteFromImage, paletteVinyl, paletteForPreset, ambientFromImage, ambientFromName, type Palette, type Ambient } from '../render/palette';
import { clearGlyphCache } from '../render/glyphs';
import type { AudioLike } from './audio';

export interface SessionSpec {
  key: string;
  lyrics: string;
  /** a stored style, or none: `preset` (the cover theme by default) in the cover's colours */
  style?: unknown;
  preset?: string;
  song: SongInfo;
  coverUrl?: string;
  audio?: AudioLike | null;
  analysis?: RhythmAnalysis | null;
  range?: string; lshift?: number; bpm?: number; endLen?: number;
  /** the listener's own word spacing, line by line (lyrics/spacing.ts); the segmenter's everywhere else */
  spacing?: Spacing;
  fade?: boolean;
  /** the frame's aspect, whatever the stored style says ('fill': the view's own, as the player shows it) */
  aspect?: string;
  /** another song's look in place of this one's own (album play: the first song's), for as long as the session lives */
  look?: Partial<Style>;
}
export interface SessionEnv { lang: string; labels: { composer: string; lyricist: string; artist: string }; viewAspect: () => number; onAnalysis?: (a: RhythmAnalysis) => void }
type Img = CanvasImageSource & { width: number; height: number };

/** (the session's own rebuilds, beside the style's REPLAN and RECUE) */
const BUILD = 2, RETIME = 8;
/** effects the plan strikes on accents (their cues: director/cues.ts) */
const CUED_FX = new Set(['glass', 'glyph', 'chroma', 'glitch']);
const titleCard = (s: SongInfo) => `[00:00.00]${(s.title || '♪').replace(/[[\]<>#|]/g, ' ')}` + (s.artist ? `\n[00:00.00]${s.artist.replace(/[[\]<>#|]/g, ' ')}` : '');
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(res => { if (!url) return res(null); const im = new Image(); if (!/^data:/.test(url)) im.crossOrigin = 'anonymous'; im.decoding = 'async';
    im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}

export class Session {
  spec: SessionSpec; style!: Style; pal!: Palette; ambient!: Ambient;
  cover: Img | null = null; coverKey = ''; private fontsLate = false;
  map!: RhythmMap; sig!: Signals; doc!: LyricDoc; plan!: ScenePlan;
  hasLyrics = false; audioStart = 0; musicEnd = 0; dur = 0; endLen = 3.5;
  version = 0;                        // bumps on every replan (views re-read the plan)
  /** what needs rebuilding before the next frame: REPLAN, BUILD (from the lyrics down), RETIME (the timing only: the
   *  lyric shift, the ending's length — the words as they were), RECUE (the effect cues only) */
  private dirty = 0;
  /** the rebuild under way, if one is (one at a time: edits made meanwhile are taken by the next round) */
  private flushing: Promise<void> | null = null;
  constructor(spec: SessionSpec, private env: SessionEnv) { this.spec = { ...spec }; }

  static async open(spec: SessionSpec, env: SessionEnv): Promise<Session> {
    const s = new Session(spec, env);
    s.cover = await loadImage(spec.coverUrl || ''); s.coverKey = spec.coverUrl || '';
    { const id = spec.preset || 'cover'; s.style = spec.style ? styleFromStored(spec.style) : { ...presetStyle(id), ...(s.cover ? paletteForPreset(id, s.cover) || {} : {}) }; }
    if (spec.aspect) s.style.aspect = spec.aspect;
    if (spec.look) { s.ownLook = s.lookOf(); Object.assign(s.style, spec.look); }
    s.colors();
    let a = spec.analysis && isCurrent(spec.analysis) ? spec.analysis : null;
    const buf = spec.audio;
    // (no analysis can be had — the neural engine only, and it cannot run: the song plays on a tempo grid)
    if (!a && buf && buf.getChannelData && !buf.load) { a = await analyzeInBackground(buf as AudioBuffer).catch(() => null); if (a) env.onAnalysis?.(a); }
    s.analysis = a;
    await s.build();
    return s;
  }
  analysis: RhythmAnalysis | null = null;
  /** the song's own look while it wears another one (see spec.look): what is kept with the song */
  ownLook: Partial<Style> | null = null;
  lookOf(): Partial<Style> { const o: any = {}; for (const k of LOOK_KEYS) if ((this.style as any)[k] !== undefined) o[k] = (this.style as any)[k]; return o; }
  /** The style as the song keeps it (its own look, not one it wears for an album). */
  ownStyle(): Style { return this.ownLook ? { ...this.style, ...this.ownLook } : this.style; }
  get audio() { return this.spec.audio ?? null; }

  /** Everything from the lyrics down: timing, rhythm map, lyric model, plan. */
  async build() {
    const sp = this.spec, r = parseRange(sp.range), buf = sp.audio;
    const fileEnd = buf ? (r.b != null ? Math.min(r.b, buf.duration) : buf.duration) : Infinity;
    const parsedLen = isFinite(fileEnd) ? fileEnd - r.a : Infinity;
    let parsed = parse(sp.lyrics || '', r.a, parsedLen); this.hasLyrics = parsed.lines.length > 0;
    if (!this.hasLyrics) parsed = parse(titleCard(sp.song), 0);
    // the words: where the segmenter (or the listener) breaks each line — its dictionary waited for a moment the first
    // time (it loads once, in the background); without it the lines break by the browser's own word breaker
    if (this.hasLyrics) { if (!segmenterReady()) await Promise.race([loadSegmenter(), new Promise(r => setTimeout(r, 2500))]); parsed = respace(parsed, sp.spacing); }
    // song time 0 is the range start; the lyric shift moves the music under the lyrics (it is in audioStart), so the
    // layout, the beats, the audio and the video stay in agreement
    const text = parsed.lines.map(L => L.text).join('');
    await ensureFontSoon(this.style.font, text + sp.song.title, this.env.lang, 1200, () => { this.fontsLate = true; this.dirty |= REPLAN; });
    this.parsed = parsed; await this.retime();
  }
  /** From the timing down (the lyric shift, the ending, the rhythm map, the lyric model, the plan) — the words read from
   *  the lyrics as they were: what the timing sliders change, without reading and breaking the lyrics again. */
  private async retime() {
    const sp = this.spec, r = parseRange(sp.range), buf = sp.audio, parsed = this.parsed!;
    // (all of it made aside and put in place together with its plan: until the plan is ready the picture goes on with
    // the timing, map and plan it has, never a new map under an old plan)
    const audioStart = r.a - (sp.lshift || 0) / 1000, endLen = sp.song.album ? 0.05 : Math.min(8, Math.max(2, sp.endLen ?? 3.5));
    const fileEnd = buf ? (r.b != null ? Math.min(r.b, buf.duration) : buf.duration) : Infinity, last = parsed.lines[parsed.lines.length - 1];
    const musicEnd = buf ? Math.max(1, fileEnd - audioStart) : (last ? (last.stop ?? last.t + 3) + 1.6 : 10), dur = musicEnd + endLen;
    const origin: MapOrigin = this.analysis ? { analysis: this.analysis, offset: audioStart } : { grid: [Math.max(40, Math.min(240, sp.bpm || 120)), 0, dur + 2] };
    const map = 'grid' in origin ? RhythmMap.grid(...origin.grid) : new RhythmMap(origin.analysis, origin.offset);
    const doc = buildLyrics(parsed, map, musicEnd);
    const plan = await this.planOf(doc, map, origin, musicEnd, endLen);
    Object.assign(this, { audioStart, endLen, musicEnd, dur, map, sig: new Signals(map), doc, plan, rec: null }); this.version++;
  }
  /** The plan for these words and this map, in the style as it is now (planner.ts: off the page's thread). */
  private planOf(doc: LyricDoc, map: RhythmMap, origin: MapOrigin, musicEnd: number, endLen: number): Promise<ScenePlan> {
    const fc = fontStack(this.style.font, doc.lines.map(L => L.text).join('').slice(0, 400), this.env.lang);
    const aspect = ASPECTS[this.style.aspect] ?? this.env.viewAspect();
    // the glyph bitmaps are keyed by face: they stay valid across a replan, unless the face itself arrived late (the ones
    // drawn before then are of a stand-in face under the same name)
    if (this.fontsLate) { clearGlyphCache(); this.fontsLate = false; }
    return planSong({ doc, map, style: this.style, measure: canvasMeasurer(`${fc.w} ${EM}px ${fc.stack}`), aspect, musicEnd, endLen, song: this.spec.song, labels: this.env.labels }, origin);
  }
  private get origin(): MapOrigin { return this.analysis ? { analysis: this.analysis, offset: this.audioStart } : { grid: [Math.max(40, Math.min(240, this.spec.bpm || 120)), 0, this.dur + 2] }; }
  private parsed: ReturnType<typeof parse> | null = null;
  /** A newer reading of the song's rhythm, arriving while it plays (streaming: the song started on a quick reading of
   *  its opening): everything that follows from it — map, signals, lyric timing, plan — is made aside now, and put in
   *  place at once by takeStaged when the engine finds the moment (under a blur, or with a crossfade). */
  staged: { analysis: RhythmAnalysis; map: RhythmMap; sig: Signals; doc: LyricDoc; plan: ScenePlan } | null = null;
  async stage(a: RhythmAnalysis): Promise<boolean> {
    if (!this.parsed || !isCurrent(a)) return false;
    const map = new RhythmMap(a, this.audioStart), doc = buildLyrics(this.parsed, map, this.musicEnd);
    const plan = await this.planOf(doc, map, { analysis: a, offset: this.audioStart }, this.musicEnd, this.endLen);
    // (an edit or a newer reading meanwhile has taken over: this one is not wanted any more)
    if (this.analysis?.partial !== true || this.parsed == null) return false;
    this.staged = { analysis: a, map, sig: new Signals(map), doc, plan }; return true;
  }
  /** Put the staged reading in place; returns the session as it was (for the picture to fade from), or null. */
  takeStaged(): Session | null {
    const st = this.staged; if (!st) return null; this.staged = null;
    const before = Object.assign(Object.create(Object.getPrototypeOf(this)), this) as Session;
    Object.assign(this, st); this.rec = null; this.version++; return before;
  }
  async replan() {
    const doc = this.doc, map = this.map, plan = await this.planOf(doc, map, this.origin, this.musicEnd, this.endLen);
    // (a rebuild of the words or the timing meanwhile is newer: it keeps its own)
    if (this.doc !== doc || this.map !== map) return;
    this.plan = plan; this.version++;
  }
  /** The effect cues alone, the rest of the plan as it is (a trigger's sensitivity, an effect struck on accents). */
  private recue() { this.plan.cues = planCuesFor(this.plan); this.version++; }   // (the same plan: its glyphs need no baking again)
  colors() { this.pal = paletteOf(this.style); this.ambient = this.cover ? ambientFromImage(this.cover) : ambientFromName(this.spec.song.title); }
  /** Rebuild whatever edits asked for (called by the engine once per frame at most). */
  async flush(): Promise<void> {
    // (one rebuild at a time: a rebuild waits for the segmenter and the face, and every frame asks for one meanwhile —
    // they are all this one; what is edited while it runs is taken by its next round)
    if (this.flushing) return this.flushing;
    // (a round with nothing to wait for — a replan — runs to its end at once, before the promise is even kept: only one
    // still running is kept as the one under way)
    let done = false, run: Promise<void> | null = null;
    run = (async () => {
      try {
        while (this.dirty) {
          // (an edit while a newer rhythm waits: it is taken now, under the edit's own rebuild)
          if (this.staged) { this.analysis = this.staged.analysis; this.staged = null; this.dirty |= BUILD; }
          const d = this.dirty; this.dirty = 0;
          if (d & BUILD) await this.build(); else if (d & RETIME) await this.retime(); else if (d & REPLAN) await this.replan(); else if (d & RECUE) this.recue();
        }
      } finally { done = true; if (this.flushing === run) this.flushing = null; }
    })();
    if (!done) this.flushing = run;
    return run!;
  }
  get needsFlush() { return this.dirty !== 0 || !!this.flushing; }

  /* ---- edits ---- */
  get custom() { return isCustom(this.style); }
  setStyle(k: keyof Style | string, v: unknown) {
    const st = this.style as any;
    if (!this.custom && !PROJECT_KEYS.includes(k as string)) return false;
    if (st[k] === v) return true; st[k] = v; if (!PROJECT_KEYS.includes(k as string)) st.edited = true;
    if (['bg', 'bg2', 'text', 'accent', 'flash'].includes(k as string)) { this.colors(); return true; }
    if (['vidDark', 'solidDark', 'vidBlur', 'vidDesat', 'vidFit', 'coverSize', 'coverEdge', 'coverBlur', 'aa', 'quality'].includes(k as string)) return true;
    if (k === 'font') { this.dirty |= BUILD; return true; }
    if (k === 'bgStyle') { st.coverEdge ??= 'album'; st.coverBlur ??= 0; st.coverSize ??= 0.6; }
    this.dirty |= REPLAN; return true;
  }
  /** A knob; `live`: only its look while it is dragged — what it changes in the plan is taken when it is let go (a
   *  second call without live), so dragging never replans at every step. */
  setKnob(k: string, v: number, live = false) { if (!this.custom && k !== 'size') return false; this.style.k[k] = +v; if (k !== 'size') this.style.edited = true; this.style.m = knobbed(this.style.m0, this.style.k);
    if (!live) { const r = KNOB_REBUILD[k] ?? 0; if (r & REPLAN) this.dirty |= REPLAN; else if (r & RECUE) this.dirty |= RECUE; } return true; }
  setEffect(id: string, on: boolean) { if (!this.custom) return false; this.style.fx[id] = !!on; this.style.edited = true;
    // (what the plan holds for an effect: the frames are laid out with the words; the shattered glass, the glyph panes, the
    // colour split and the glitch are cues struck on accents)
    if (id === 'frame') this.dirty |= REPLAN; else if (CUED_FX.has(id)) this.dirty |= RECUE; return true; }
  /** An effect's own setting; `live`: only its look while it is dragged (the glyph panes' frequency is a cue: taken
   *  when let go). */
  setEffectParam(id: string, key: string, v: number | string | boolean, live = false) { if (!this.custom) return false; (this.style.fxp ||= {})[id] = { ...(this.style.fxp?.[id] || {}), [key]: v }; this.style.edited = true;
    if (!live && id === 'glyph' && key === 'freq') this.dirty |= RECUE; return true; }
  makeCustom() { if (this.custom) return; this.style = { ...JSON.parse(JSON.stringify(this.style)), preset: 'custom', from: this.style.from || this.style.preset, id: null, name: '', edited: false }; this.style.m = knobbed(this.style.m0, this.style.k); }
  applyPreset(id: string) { const keep = this.style; this.style = presetStyle(id, keep); this.style.edited = false; if (this.spec.aspect) this.style.aspect = this.spec.aspect; if (this.cover) Object.assign(this.style, paletteForPreset(id, this.cover) || {}); this.colors(); this.dirty |= BUILD; }
  /** A look (外觀: a preset's backdrop, colours — the cover's, for the cover look — typeface and effects), the motion
   *  style and knobs kept. */
  applyLook(id: string) { if (!this.custom) return false; this.style = withLook(this.style, id); this.style.edited = true;
    if (this.cover) Object.assign(this.style, paletteForPreset(id, this.cover) || {}); this.colors(); this.dirty |= BUILD; return true; }
  /** A motion style (風格), the look and knobs kept. */
  applyMotion(id: string) { if (!this.custom) return false; this.style = withMotion(this.style, id); this.style.edited = true; this.dirty |= REPLAN; return true; }
  /** The motion style that fits this song best (director/recommend.ts), offered beside the others. */
  get recommended(): string { return this.rec ??= recommendMotion({ doc: this.doc, map: this.map, analysis: this.analysis }); }
  private rec: string | null = null;
  applyTheme(stored: unknown) { const keep = this.style; this.style = normalizeStyle({ ...(JSON.parse(JSON.stringify(stored)) as Style), preset: 'custom', aspect: this.spec.aspect || keep.aspect, aa: keep.aa, edited: false }); this.colors(); this.dirty |= BUILD; }
  coverPalette() { if (!this.cover) return; Object.assign(this.style, (this.style.bgStyle === 'vinyl' ? paletteVinyl : paletteFromImage)(this.cover)); this.colors(); }
  setSong(p: Partial<SongInfo>) { this.spec.song = { ...this.spec.song, ...p }; if (!this.hasLyrics) this.dirty |= BUILD; else this.dirty |= REPLAN; }
  setLyrics(src: string) { this.spec.lyrics = src; this.dirty |= BUILD; }
  /** The listener's word spacing (lyrics/spacing.ts), or none to go back to the segmenter's. */
  setSpacing(sp: Spacing | undefined) { this.spec.spacing = sp; this.dirty |= BUILD; }
  /** The timing: the lyric shift and the ending's length retime what is there; a new range or tempo builds anew. */
  setTiming(p: { lshift?: number; range?: string; endLen?: number; bpm?: number }) { Object.assign(this.spec, p); this.dirty |= p.range !== undefined || p.bpm !== undefined || !this.parsed ? BUILD : RETIME; }
  async setCover(url: string, repaint: boolean) {
    this.cover = await loadImage(url); this.coverKey = url; this.spec.coverUrl = url;
    // (the record theme keeps its own stage, in the new cover's colours; any other becomes the cover theme)
    if (repaint && this.cover) { const rec = this.style.bgStyle === 'vinyl'; if (!rec && this.style.bgStyle !== 'cover') { if (this.custom) this.style.bgStyle = 'cover'; else this.style = presetStyle('cover', this.style); }
      Object.assign(this.style, (rec ? paletteVinyl : paletteFromImage)(this.cover)); }
    this.colors(); this.dirty |= repaint ? 1 : 0;
  }
  setAudio(buf: AudioLike | null, analysis: RhythmAnalysis | null) { this.spec.audio = buf; this.staged = null; this.analysis = analysis && isCurrent(analysis) ? analysis : null; this.dirty |= BUILD; }
  /** The aspect changed (a fill-the-window view resized): the camera and layout depend on it. */
  aspectChanged() { if (this.style.aspect === 'fill') this.dirty |= REPLAN; }
}
