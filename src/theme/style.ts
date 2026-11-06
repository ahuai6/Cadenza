/* Themes. Four presets, each tuned as a whole (backdrop, colours, typeface, camera, motion) and locked; anything else is
   a custom theme, which starts from a preset's tuning and can be changed, saved and deleted. Every theme stores its
   tuned motion values in m0; the interface shows a dozen knobs (k), each a multiplier with 1.0 meaning exactly the
   theme's tuning; one knob drives a family of related values. m is derived, never stored. Plain data only. */
import { clamp } from '../core/math';
import { hex2rgb, hexOf, paleOf } from '../core/color';

export type CameraStyleId = 'punch' | 'glide' | 'waltz' | 'close' | 'hover' | 'center';
export interface Motion {
  shake: number; sway: number; punch: number; flash: number; flashk: number; impact: number; impk: number; speed: number; pulse: number; /** the beat-and-melody motion's strength (from the groove knob; 1 = the theme's) */ groove?: number;
  tilt: number; turn: number; tang: number; split: number; glow: number; shadow: number; enter: number; lead: number;
  depth: number; float: number; jitter: number; tsize: number; glyphf: number; glassf: number;
}
export interface Style {
  preset: string; from: string; id?: string | null; name?: string;
  /** the motion style (風格, MOTIONS) the motion was taken from, kept as its name (what was tuned on top is the knobs'
   *  and the advanced settings') */
  motion?: string;
  /** a saved custom motion style (我的風格) this style's motion was taken from: its id and name */
  motionId?: string | null; motionName?: string;
  /** a custom theme changed since it was taken from a preset or a saved theme (only then is it an unsaved theme of its own) */
  edited?: boolean;
  bg: string; bg2: string; text: string; accent: string; flash: string;
  font: string; tin: string; tout: string; cut: CameraStyleId; bgStyle: string; flashMode: 'color' | 'invert'; future: 'dim' | 'hide'; trans?: 'auto' | 'off'; /** the lyric type (director/lyrictypes.ts): how the lyrics are presented and come in; 'flow' by default */ ltype?: string;
  coverEdge?: 'album' | 'float' | 'blend'; coverBlur?: number; coverSize?: number; vidDark?: number; /** the solid backdrop: how much darker than the background colour it is drawn (0..0.9) */ solidDark?: number; vidBlur?: number; vidDesat?: number; /** the video backdrop never turns, so it is barely cropped */ vidFit?: boolean;
  m0: Motion; k: Record<string, number>; m: Motion;
  fx: Record<string, boolean>;
  /** per-effect parameters (see the effect's own schema); missing values take the effect's defaults */
  fxp?: Record<string, Record<string, number | string | boolean>>;
  aspect: string; aa: string;
}

const FX_OFF = { afterimage: false, wordring: false, motes: false, feathers: false, grid: false, eq: false, rings: false, scan: false, vignette: false, grain: false, glass: false, glyph: false, frame: false, stars: false, wires: false, shards: false, doors: false, lines: false, invgeo: false, chroma: false, glitch: false };
/** (the presets' flash: the backdrop elements' colour, paler — see paleOf) */
const paleHex = (accent: string) => hexOf(paleOf(hex2rgb(accent)));
export const PRESETS: Record<string, Omit<Style, 'preset' | 'from' | 'k' | 'm' | 'aspect' | 'aa'>> = {
  liquid: { tin: 'rise', tout: 'none', font: 'maru', bg: '#0b0820', bg2: '#2a1f66', text: '#ffffff', accent: '#ff5fc1', flash: paleHex('#ff5fc1'), cut: 'waltz', bgStyle: 'liquid', flashMode: 'color', future: 'dim',
    m0: { shake: .2, sway: .8, punch: .5, flash: 1, flashk: .35, impact: 1, impk: .6, speed: .75, pulse: .8, tilt: 1, turn: .45, tang: 45, split: .4, glow: .35, shadow: 0, enter: .21, lead: .15, depth: 1.2, float: .8, jitter: 0, tsize: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, motes: true, vignette: true, stars: true, afterimage: true } },
  gothic: { tin: 'drift', tout: 'none', font: 'tiempos', bg: '#24060c', bg2: '#701221', text: '#f2e6de', accent: '#b3172f', flash: paleHex('#b3172f'), cut: 'waltz', bgStyle: 'gothic', flashMode: 'color', future: 'dim',
    m0: { shake: .75, sway: 1, punch: .8, flash: 1, flashk: .4, impact: 1, impk: .8, speed: .95, pulse: .7, tilt: 1.1, turn: .45, tang: 35, split: .25, glow: .35, shadow: 0, enter: .22, lead: .12, depth: 1.3, float: .6, jitter: .15, tsize: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, motes: true, vignette: true, grain: true, glass: true, glyph: true, afterimage: true }, fxp: { afterimage: { amount: 0.625 } } },
  cover: { tin: 'drift', tout: 'none', font: 'notosans', bg: '#141118', bg2: '#2c2536', text: '#f5f2f7', accent: '#c7a8ff', flash: paleHex('#c7a8ff'), cut: 'glide', bgStyle: 'cover', flashMode: 'color', future: 'dim',
    coverEdge: 'album', coverBlur: 0, coverSize: 0.6,
    m0: { shake: .1, sway: .4, punch: .3, flash: 1, flashk: .25, impact: 1, impk: .4, speed: .7, pulse: .4, tilt: .6, turn: .25, tang: 30, split: 0, glow: .55, shadow: 0, enter: .24, lead: .15, depth: 1, float: .45, jitter: 0, tsize: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, motes: true, vignette: true, frame: true } },
  video: { tin: 'blur', tout: 'none', font: 'notosans', bg: '#0b0b0e', bg2: '#3b4250', text: '#f7f2ea', accent: '#e8c8a0', flash: paleHex('#e8c8a0'), cut: 'glide', bgStyle: 'video', flashMode: 'color', future: 'dim',
    vidDark: 0.6, vidBlur: 0.35, vidDesat: 0.35,
    m0: { shake: .1, sway: .35, punch: .3, flash: 0, flashk: 0, impact: 1, impk: .4, speed: .7, pulse: .35, tilt: .6, turn: .25, tang: 25, split: 0, glow: .22, shadow: 1, enter: .28, lead: .15, depth: 1.4, float: .5, jitter: 0, tsize: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, motes: true, vignette: true, grain: true, frame: true } },
  // the record: the camera holds the middle, where the whole disc turns; lines come and go above and below it; door
  // frames on a horizon, plain lines, wireframe solids and line fragments around it. Its colours come from the cover:
  // the ground the cover's own, the rest its opposite hue (palette.ts). Instrumentals take it by default.
  vinyl: { tin: 'rise', tout: 'none', font: 'notosans', bg: '#120e16', bg2: '#25304a', text: '#f4f6fb', accent: '#7fd4ff', flash: '#d8f1ff', cut: 'center', bgStyle: 'vinyl', flashMode: 'color', future: 'dim',
    m0: { shake: .1, sway: 0, punch: .35, flash: .7, flashk: .2, impact: 1, impk: .35, speed: .7, pulse: .6, tilt: 0, turn: 0, tang: 0, split: 0, glow: .45, shadow: 0, enter: .28, lead: .15, depth: 0, float: .3, jitter: 0, tsize: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, doors: true, lines: true, wires: true, shards: true } },
};
export const DEFAULT_THEME = 'liquid';

/* ---- the three layers: the look (外觀: a preset's backdrop, colours, typeface, effects), the motion style (風格: how
   the lyrics move — camera, lyric type, entrance, exit, the motion's tuning) and the knobs on top. A look and a style
   are chosen apart: any look with any style. ---- */
export type MotionKey = 'cut' | 'ltype' | 'tin' | 'tout';
export interface MotionRecipe { cut: CameraStyleId; ltype: string; tin: string; tout: string; m0: Motion }
/** What makes a motion style (the rest of a style is its look and its project's). */
export const MOTION_KEYS: MotionKey[] = ['cut', 'ltype', 'tin', 'tout'];
const mo = (base: string, cut: CameraStyleId, ltype: string, tin: string, tout: string, over: Partial<Motion> = {}): MotionRecipe =>
  ({ cut, ltype, tin, tout, m0: { ...PRESETS[base].m0, ...over } });
/** The motion styles, in the order they are offered (and recommended, when two fit as well). Each takes its tuning from
 *  the preset whose motion it was. */
export const MOTIONS: Record<string, MotionRecipe> = {
  /** 敘事: glides from word to word — mid-tempo pop, ballads (the cover theme's own motion: new songs) */
  story: mo('cover', 'glide', 'flow', 'drift', 'none'),
  /** 圓舞: steady, on curves, floating — slow songs, 3/4, gentle ones */
  waltz: mo('liquid', 'waltz', 'flow', 'rise', 'drift'),
  /** 律動: quick and hard on the beat — fast songs, electronic, rock */
  groove: mo('gothic', 'punch', 'flow', 'pop', 'none'),
  /** 特寫: close on every character — rap, spoken words, dense lyrics (a quick entrance: a word this large, this close,
   *  must be read the moment it is there) */
  close: mo('cover', 'close', 'flow', 'track', 'none', { enter: .12 }),
  /** 漂浮: hovering, round a centre, deep — ambient, dreamy, post-rock */
  float: mo('liquid', 'hover', 'orbit', 'blur', 'spread', { depth: 1.5, float: 1 }),
  /** 舞台: held in the middle, whole lines — instrumentals, karaoke, subtitles */
  stage: mo('vinyl', 'center', 'line', 'rise', 'none'),
};
export const DEFAULT_MOTION = 'story';
/** The motion style a style's camera reads as (styles from before the styles had names). */
const MOTION_OF_CUT: Record<string, string> = { glide: 'story', waltz: 'waltz', punch: 'groove', close: 'close', hover: 'float', center: 'stage' };
export const motionOf = (s: Pick<Style, 'motion' | 'cut'>) => (s.motion && MOTIONS[s.motion] ? s.motion : MOTION_OF_CUT[s.cut] || DEFAULT_MOTION);
/** A style with a motion style taken in: its camera, lyric type, entrance, exit and tuning; its look, its knobs and its
 *  project's settings as they were. */
export function withMotion(st: Style, id: string): Style {
  const r = MOTIONS[id] || MOTIONS[DEFAULT_MOTION], out: Style = { ...st, cut: r.cut, ltype: r.ltype, tin: r.tin, tout: r.tout, m0: clone(r.m0), motion: MOTIONS[id] ? id : DEFAULT_MOTION, motionId: null, motionName: '' };
  out.m = knobbed(out.m0, out.k); return out;
}
/* ---- custom motion styles (我的風格): what of a style is its motion — the camera, the lyric type, the entrance and
   exit, transitions and how unsung words show, the motion's tuning (m0) and every knob but the text size — saved under
   a name, and put back on any style, its look kept. ---- */
export interface SavedMotion { base: string; cut: CameraStyleId; ltype: string; tin: string; tout: string; trans: 'auto' | 'off'; future: 'dim' | 'hide'; m0: Motion; k: Record<string, number> }
export function motionPart(st: Style): SavedMotion {
  const k = { ...st.k }; delete k.size;
  return { base: motionOf(st), cut: st.cut, ltype: st.ltype || 'flow', tin: st.tin, tout: st.tout, trans: st.trans || 'auto', future: st.future, m0: clone(st.m0), k };
}
export function withSavedMotion(st: Style, m: SavedMotion, id: string, name: string): Style {
  const out: Style = { ...st, cut: m.cut, ltype: m.ltype, tin: m.tin, tout: m.tout, trans: m.trans, future: m.future, m0: { ...st.m0, ...clone(m.m0) }, k: { ...st.k, ...m.k, size: st.k.size ?? 1 }, motion: m.base, motionId: id, motionName: name };
  out.m = knobbed(out.m0, out.k); return out;
}
/** What a look (a preset) sets: its backdrop, colours, typeface, how the cover sits, and its effects. */
const LOOK_FIELDS = ['bg', 'bg2', 'text', 'accent', 'flash', 'font', 'bgStyle', 'flashMode', 'coverEdge', 'coverBlur', 'coverSize', 'vidDark', 'vidBlur', 'vidDesat', 'solidDark'] as const;
/** A style with a look taken in (a preset's), its motion style, knobs and project's settings as they were. */
export function withLook(st: Style, id: string): Style {
  const p = PRESETS[id] ? id : DEFAULT_THEME, L = PRESETS[p] as any, out: any = { ...st, from: p, fx: { ...L.fx }, fxp: { ...(st.fxp || {}), ...clone(L.fxp || {}) } };
  for (const k of LOOK_FIELDS) { if (L[k] !== undefined) out[k] = clone(L[k]); else if (k !== 'flashMode') delete out[k]; }
  return out as Style;
}
/** The five knobs offered first (微調): each turns a few of the detailed ones together (KNOBS, in 進階) — a detailed
 *  knob's value is its own times its macro's, kept within its own range. [key, min, max, step, the detailed ones]. */
export const MACROS: [string, number, number, number, string[]][] = [
  ['speed', 0.4, 1.6, .05, ['pace']], ['force', 0, 2, .05, ['energy', 'trigger']], ['rhythm', 0, 2, .05, ['groove', 'jitter']],
  ['space', 0, 2, .05, ['depth', 'float', 'turns']], ['feel', 0.25, 2, .05, ['enter', 'glow']],
];
const MACRO_OF: Record<string, string> = Object.fromEntries(MACROS.flatMap(([m, , , , ks]) => ks.map(k => [k, m])));
/** The detailed knobs (進階): [key, group, min, max, step]. 1 = the theme's tuning. */
export const KNOBS: [string, string, number, number, number][] = [
  ['pace', 'grp.camera', 0.4, 1.6, .05], ['energy', 'grp.camera', 0, 2, .05], ['groove', 'grp.camera', 0, 4, .05], ['float', 'grp.camera', 0, 2, .05], ['turns', 'grp.camera', 0, 2, .05],
  ['depth', 'grp.camera', 0, 2, .05], ['size', 'grp.text', 0.6, 2, .05], ['enter', 'grp.text', 0.15, 1.6, .05],
  ['glow', 'grp.text', 0, 2, .05], ['jitter', 'grp.text', 0, 2, .05], ['trigger', 'grp.triggers', 0, 2, .05],
  // (the afterimage's strength and the glyph panes' frequency are their effects' own settings now: 文字殘影, 字形紋樣)
];
export const AA_MODES = ['off', 'ssaa', 'ssaa3'];
/** Style fields that belong to the project (frame, smoothing, the imported media), changeable even on a locked preset. */
/** What makes a theme's look (colours, typeface, backdrop and how the cover or video sits in it) — not its motion,
 *  effects or camera: what album play carries from the first song to the rest. */
export const LOOK_KEYS = ['bg', 'bg2', 'text', 'accent', 'flash', 'font', 'bgStyle', 'coverEdge', 'coverBlur', 'coverSize', 'vidDark', 'vidBlur', 'vidDesat', 'vidFit', 'solidDark'] as const;
export const PROJECT_KEYS = ['aspect', 'aa', 'vidDark', 'vidBlur', 'vidDesat', 'vidFit', 'coverEdge', 'coverBlur', 'coverSize'];
/** What a change asks of the plan: REPLAN the whole of it (the layout and the camera are planned together), RECUE the
 *  effect cues only. */
export const REPLAN = 1, RECUE = 4;
/** What each knob rebuilds (0: nothing — it is read as the picture is drawn). As the plan reads them: the layout the
 *  pace, turns, depth, size and entrance (how early a word shows); the camera the float (its handheld drift and sway)
 *  and the energy (its punch and shake); the cues the triggers and the glyph panes' frequency. */
export const KNOB_REBUILD: Record<string, number> = { jitter: 0, pace: REPLAN, turns: REPLAN, depth: REPLAN, size: REPLAN, enter: REPLAN, float: REPLAN, energy: REPLAN, glyph: RECUE, trigger: RECUE, groove: 0, glow: 0, split: 0 };
// (a macro rebuilds what any of its knobs does)
for (const [mk, , , , ks] of MACROS) KNOB_REBUILD[mk] = ks.reduce((r, k) => r | (KNOB_REBUILD[k] ?? 0), 0);

const knobDefaults = () => Object.fromEntries([...KNOBS.map(([k]) => k), ...MACROS.map(([k]) => k)].map(k => [k, 1]));
const up = (b: number, k: number, ref: number) => (k <= 1 ? b * k : b + (k - 1) * Math.max(b, ref));
export function knobbed(m0: Motion, k: Record<string, number>): Motion {
  const lim = Object.fromEntries(KNOBS.map(([key, , mn, mx]) => [key, [mn, mx]]));
  // (a detailed knob as it acts: its own value times its macro's, within its own range)
  const K = (key: string) => { const v = (k[key] ?? 1) * (MACRO_OF[key] ? k[MACRO_OF[key]] ?? 1 : 1), r = lim[key]; return r ? clamp(v, r[0], r[1]) : v; }, m = { ...m0 };
  m.speed = m0.speed * K('pace');
  // force: the hits on strong beats and accents (kicks, arrival nudges, impacts); groove: the small motion with every beat
  // and the melody (the backdrop's pulse and flicker, the frame's breathing pump) — its range reaches far higher
  const e = K('energy'); for (const [x, r] of [['shake', .5], ['punch', .6], ['impk', .5]] as const) (m as any)[x] = up((m0 as any)[x], e, r);
  const gv = K('groove'); m.pulse = up(m0.pulse, gv, 0.9); m.groove = gv <= 1 ? gv : 1 + (gv - 1) * 1.6;
  m.jitter = up(m0.jitter, K('jitter'), .4);
  const f = K('float'); m.float = up(m0.float, f, .4); m.sway = up(m0.sway, f, .5);
  const tu = K('turns'); m.turn = clamp(up(m0.turn, tu, .3), 0, 1); m.tang = clamp(up(m0.tang, tu, 30), 0, 135); m.tilt = up(m0.tilt, tu, .6);
  m.depth = up(m0.depth, K('depth'), .8);
  m.tsize = m0.tsize * K('size'); m.enter = m0.enter * K('enter');
  const g = K('glow'); m.glow = up(m0.glow, g, .4); m.shadow = up(m0.shadow, g, .5);
  m.split = up(m0.split, K('split'), .6);
  const tr = K('trigger'); for (const x of ['flash', 'impact', 'glassf'] as const) m[x] = clamp(m0[x] * tr, 0, 2);
  if (!(m0.flash > 0) && tr > 1) { m.flash = tr - 1; m.flashk = m0.flashk || 0.3; }
  m.glyphf = m0.glyphf * K('glyph');
  return m;
}
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export function presetStyle(key: string, keep?: Partial<Style>): Style {
  const id = PRESETS[key] ? key : DEFAULT_THEME, p = clone(PRESETS[id]);
  const s: Style = { ...p, preset: id, from: id, k: knobDefaults(), m: p.m0, aspect: keep?.aspect || '16:9', aa: AA_MODES.includes(keep?.aa as string) ? keep!.aa! : 'off' } as Style;
  if (keep?.k && keep.k.size != null) s.k.size = keep.k.size;            // lyric size is the project's, not the theme's
  s.m = knobbed(s.m0, s.k); return s;
}
/** Whatever a stored style lacks is filled in (themes saved by older versions, partial data). */
export function normalizeStyle(s: Partial<Style>): Style {
  const from = PRESETS[s.from as string] ? s.from! : PRESETS[s.preset as string] ? s.preset! : DEFAULT_THEME, base = PRESETS[from];
  const out = { ...clone(base), ...s, from, fx: { ...base.fx, ...(s.fx || {}) }, k: { ...knobDefaults(), ...(s.k || {}) }, m0: { ...base.m0, ...(s.m0 || {}) } } as Style;
  if (!AA_MODES.includes(out.aa)) out.aa = 'off';
  if (!out.aspect) out.aspect = '16:9'; delete (out as { quality?: unknown }).quality;   // (a field older saves carry, no longer read)
  out.m = knobbed(out.m0, out.k); return out;
}
export const isCustom = (s: Style) => s.preset === 'custom';
/** A style saved by this app or by Lyric Motion 1.x/2.x: presets are rebuilt from their tuning (keeping the project's
 *  own settings); older custom styles become custom themes with their values kept. */
export function styleFromStored(st: any): Style {
  if (!st || typeof st !== 'object') return presetStyle(DEFAULT_THEME);
  if (st.coverBlur === 0.55) st = { ...st, coverBlur: 0 };
  // (the close-up's entrance as it was before 2.17, untouched: its new, quicker one)
  if (st.motion === 'close' && st.m0 && st.m0.enter === 0.24) st = { ...st, m0: { ...st.m0, enter: 0.12 } };
  const own: any = {}; for (const k of PROJECT_KEYS) if (st[k] != null) own[k] = st[k];
  if (st.m0) return st.preset === 'custom' ? normalizeStyle({ ...st }) : { ...presetStyle(st.preset, st), ...own };
  if (PRESETS[st.preset]) return { ...presetStyle(st.preset, { ...st, k: { size: st.m && st.m.tsize != null ? st.m.tsize : 1 } }), ...own };
  const m = { ...(st.m || {}) };
  if (m.flashk == null && m.flash != null) { m.flashk = m.flash; m.flash = m.flash > 0.01 ? 1 : 0; if (m.impact != null) { m.impk = m.impact; m.impact = m.impact > 0.01 ? 1 : 0; } }
  const size = m.tsize ?? 1.3; m.tsize = 1;
  return normalizeStyle({ ...st, preset: 'custom', from: DEFAULT_THEME, m0: { ...PRESETS[DEFAULT_THEME].m0, ...m }, k: { size }, name: st.name || '' });
}
/** Only what is stored: the derived motion is rebuilt on load. */
export const storedStyle = (s: Style) => { const { m, ...rest } = s; return clone(rest); };
