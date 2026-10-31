/* Themes. Four presets, each tuned as a whole (backdrop, colours, typeface, camera, motion) and locked; anything else is
   a custom theme, which starts from a preset's tuning and can be changed, saved and deleted. Every theme stores its
   tuned motion values in m0; the interface shows a dozen knobs (k), each a multiplier with 1.0 meaning exactly the
   theme's tuning; one knob drives a family of related values. m is derived, never stored. Plain data only. */
import { clamp } from '../core/math';
import { hex2rgb, hexOf, paleOf } from '../core/color';

export type CameraStyleId = 'punch' | 'glide' | 'waltz' | 'close' | 'hover' | 'center';
export interface Motion {
  shake: number; sway: number; punch: number; flash: number; flashk: number; impact: number; impk: number; speed: number; pulse: number; /** the beat-and-melody motion's strength (from the groove knob; 1 = the theme's) */ groove?: number;
  tilt: number; turn: number; tang: number; drift: number; split: number; glow: number; shadow: number; enter: number; lead: number;
  depth: number; float: number; jitter: number; tsize: number; flip: number; glyphf: number; glassf: number;
}
export interface Style {
  preset: string; from: string; id?: string | null; name?: string;
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

const FX_OFF = { wordring: false, motes: false, feathers: false, grid: false, eq: false, rings: false, scan: false, vignette: false, grain: false, glass: false, glyph: false, frame: false, stars: false, wires: false, shards: false, doors: false, lines: false, invgeo: false, chroma: false, glitch: false };
/** (the presets' flash: the backdrop elements' colour, paler — see paleOf) */
const paleHex = (accent: string) => hexOf(paleOf(hex2rgb(accent)));
export const PRESETS: Record<string, Omit<Style, 'preset' | 'from' | 'k' | 'm' | 'aspect' | 'aa'>> = {
  liquid: { tin: 'rise', tout: 'none', font: 'maru', bg: '#0b0820', bg2: '#2a1f66', text: '#ffffff', accent: '#ff5fc1', flash: paleHex('#ff5fc1'), cut: 'waltz', bgStyle: 'liquid', flashMode: 'color', future: 'dim',
    m0: { shake: .2, sway: .8, punch: .5, flash: 1, flashk: .35, impact: 1, impk: .6, speed: .75, pulse: .8, tilt: 1, turn: .45, tang: 45, drift: 1.1, split: .4, glow: .35, shadow: 0, enter: .21, lead: .15, depth: 1.2, float: .8, jitter: 0, tsize: 1, flip: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, motes: true, vignette: true, stars: true } },
  gothic: { tin: 'drift', tout: 'none', font: 'tiempos', bg: '#24060c', bg2: '#701221', text: '#f2e6de', accent: '#b3172f', flash: paleHex('#b3172f'), cut: 'waltz', bgStyle: 'gothic', flashMode: 'color', future: 'dim',
    m0: { shake: .75, sway: 1, punch: .8, flash: 1, flashk: .4, impact: 1, impk: .8, speed: .95, pulse: .7, tilt: 1.1, turn: .45, tang: 35, drift: 1.1, split: .25, glow: .35, shadow: 0, enter: .22, lead: .12, depth: 1.3, float: .6, jitter: .15, tsize: 1, flip: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, motes: true, vignette: true, grain: true, glass: true, glyph: true } },
  cover: { tin: 'drift', tout: 'none', font: 'notosans', bg: '#141118', bg2: '#2c2536', text: '#f5f2f7', accent: '#c7a8ff', flash: paleHex('#c7a8ff'), cut: 'glide', bgStyle: 'cover', flashMode: 'color', future: 'dim',
    coverEdge: 'album', coverBlur: 0, coverSize: 0.6,
    m0: { shake: .1, sway: .4, punch: .3, flash: 1, flashk: .25, impact: 1, impk: .4, speed: .7, pulse: .4, tilt: .6, turn: .25, tang: 30, drift: .8, split: 0, glow: .55, shadow: 0, enter: .24, lead: .15, depth: 1, float: .45, jitter: 0, tsize: 1, flip: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, motes: true, vignette: true, frame: true } },
  video: { tin: 'blur', tout: 'none', font: 'notosans', bg: '#0b0b0e', bg2: '#3b4250', text: '#f7f2ea', accent: '#e8c8a0', flash: paleHex('#e8c8a0'), cut: 'glide', bgStyle: 'video', flashMode: 'color', future: 'dim',
    vidDark: 0.6, vidBlur: 0.35, vidDesat: 0.35,
    m0: { shake: .1, sway: .35, punch: .3, flash: 0, flashk: 0, impact: 1, impk: .4, speed: .7, pulse: .35, tilt: .6, turn: .25, tang: 25, drift: .9, split: 0, glow: .22, shadow: 1, enter: .28, lead: .15, depth: 1.4, float: .5, jitter: 0, tsize: 1, flip: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, motes: true, vignette: true, grain: true, frame: true } },
  // the record: the camera holds the middle, where the whole disc turns; lines come and go above and below it; door
  // frames on a horizon, plain lines, wireframe solids and line fragments around it. Its colours come from the cover:
  // the ground the cover's own, the rest its opposite hue (palette.ts). Instrumentals take it by default.
  vinyl: { tin: 'rise', tout: 'none', font: 'notosans', bg: '#120e16', bg2: '#25304a', text: '#f4f6fb', accent: '#7fd4ff', flash: '#d8f1ff', cut: 'center', bgStyle: 'vinyl', flashMode: 'color', future: 'dim',
    m0: { shake: .1, sway: 0, punch: .35, flash: .7, flashk: .2, impact: 1, impk: .35, speed: .7, pulse: .6, tilt: 0, turn: 0, tang: 0, drift: 0, split: 0, glow: .45, shadow: 0, enter: .28, lead: .15, depth: 0, float: .3, jitter: 0, tsize: 1, flip: 1, glyphf: 1, glassf: 1 },
    fx: { ...FX_OFF, doors: true, lines: true, wires: true, shards: true } },
};
export const DEFAULT_THEME = 'liquid';
/** The knobs: [key, group, min, max, step]. 1 = the theme's tuning. */
export const KNOBS: [string, string, number, number, number][] = [
  ['pace', 'grp.camera', 0.4, 1.6, .05], ['energy', 'grp.camera', 0, 2, .05], ['groove', 'grp.camera', 0, 4, .05], ['float', 'grp.camera', 0, 2, .05], ['turns', 'grp.camera', 0, 2, .05],
  ['depth', 'grp.camera', 0, 2, .05], ['size', 'grp.text', 0.6, 2, .05], ['enter', 'grp.text', 0.15, 1.6, .05],
  ['glow', 'grp.text', 0, 2, .05], ['split', 'grp.text', 0, 2, .05], ['jitter', 'grp.text', 0, 2, .05], ['trigger', 'grp.triggers', 0, 2, .05], ['glyph', 'grp.triggers', 0.25, 1.75, .05],
];
export const AA_MODES = ['off', 'ssaa', 'ssaa3'];
/** Style fields that belong to the project (frame, smoothing, the imported media), changeable even on a locked preset. */
/** What makes a theme's look (colours, typeface, backdrop and how the cover or video sits in it) — not its motion,
 *  effects or camera: what album play carries from the first song to the rest. */
export const LOOK_KEYS = ['bg', 'bg2', 'text', 'accent', 'flash', 'font', 'bgStyle', 'coverEdge', 'coverBlur', 'coverSize', 'vidDark', 'vidBlur', 'vidDesat', 'vidFit', 'solidDark'] as const;
export const PROJECT_KEYS = ['aspect', 'aa', 'vidDark', 'vidBlur', 'vidDesat', 'vidFit', 'coverEdge', 'coverBlur', 'coverSize'];
/** What each knob rebuilds: 0 nothing, 1 the layout, 2 the camera path, 4 the effect cues. */
export const KNOB_REBUILD: Record<string, number> = { jitter: 0, pace: 2, turns: 1, flip: 1, depth: 1, size: 1, glyph: 1, trigger: 4, energy: 4, groove: 0, float: 0, enter: 0, glow: 0, split: 0 };

const knobDefaults = () => Object.fromEntries(KNOBS.map(([k]) => [k, 1]));
const up = (b: number, k: number, ref: number) => (k <= 1 ? b * k : b + (k - 1) * Math.max(b, ref));
export function knobbed(m0: Motion, k: Record<string, number>): Motion {
  const K = (key: string) => k[key] ?? 1, m = { ...m0 };
  const p = K('pace'); m.speed = m0.speed * p; m.drift = m0.drift * Math.sqrt(p);
  // force: the hits on strong beats and accents (kicks, arrival nudges, impacts); groove: the small motion with every beat
  // and the melody (the backdrop's pulse and flicker, the frame's breathing pump) — its range reaches far higher
  const e = K('energy'); for (const [x, r] of [['shake', .5], ['punch', .6], ['impk', .5]] as const) (m as any)[x] = up((m0 as any)[x], e, r);
  const gv = K('groove'); m.pulse = up(m0.pulse, gv, 0.9); m.groove = gv <= 1 ? gv : 1 + (gv - 1) * 1.6;
  m.jitter = up(m0.jitter, K('jitter'), .4);
  const f = K('float'); m.float = up(m0.float, f, .4); m.sway = up(m0.sway, f, .5);
  const tu = K('turns'); m.turn = clamp(up(m0.turn, tu, .3), 0, 1); m.tang = clamp(up(m0.tang, tu, 30), 0, 135); m.tilt = up(m0.tilt, tu, .6);
  m.flip = m0.flip * K('flip'); m.depth = up(m0.depth, K('depth'), .8);
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
