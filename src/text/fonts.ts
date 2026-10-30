// Typefaces: the display faces for lyrics, the Noto fallbacks for every script that appears, and loading them. The
// desktop app carries every face (window.CADENZA_FONTS points at its folder of stylesheets) and never goes online for
// fonts; the web page asks Google Fonts for exactly the families and weights it needs.

/** A typeface for lyrics. `cjk`: the family is Noto, in the cut for the lyrics' own script (Traditional, Simplified,
 *  Japanese, Korean). `kind`: the style group the pickers list it under. `only`: the script its own glyphs are made for
 *  (others fall back to Noto). */
export interface Face { family: string; w: number; q: string; serif: boolean; fbw?: number; cjk?: boolean; kind: FontKind; only?: 'tc' | 'sc' | 'jp' | 'latin' }
export type FontKind = 'sans' | 'thin' | 'serif' | 'round' | 'hand' | 'brush' | 'art' | 'display';
export const FONT_KINDS: FontKind[] = ['sans', 'thin', 'serif', 'round', 'hand', 'brush', 'art', 'display'];
const g = (fam: string, w: number | string) => fam.replace(/ /g, '+') + (w ? ':wght@' + w : '');
export const FONTS: Record<string, Face> = {
  // the plain cuts, every script, from hairline to black
  notosans: { family: 'Noto Sans TC', w: 900, q: g('Noto Sans TC', 900), serif: false, cjk: true, kind: 'sans' },
  sansmed: { family: 'Noto Sans TC', w: 600, q: g('Noto Sans TC', 600), serif: false, cjk: true, kind: 'sans', fbw: 600 },
  sanslight: { family: 'Noto Sans TC', w: 300, q: g('Noto Sans TC', 300), serif: false, cjk: true, kind: 'thin', fbw: 300 },
  sansthin: { family: 'Noto Sans TC', w: 150, q: g('Noto Sans TC', 100), serif: false, cjk: true, kind: 'thin', fbw: 150 },
  serif: { family: 'Noto Serif TC', w: 900, q: g('Noto Serif TC', 900), serif: true, cjk: true, kind: 'serif' },
  seriflight: { family: 'Noto Serif TC', w: 300, q: g('Noto Serif TC', 300), serif: true, cjk: true, kind: 'thin', fbw: 300 },
  sunghk: { family: 'Chiron Sung HK', w: 700, q: g('Chiron Sung HK', 700), serif: true, kind: 'serif', fbw: 700, only: 'tc' },
  sungthin: { family: 'Chiron Sung HK', w: 250, q: g('Chiron Sung HK', 250), serif: true, kind: 'thin', fbw: 300, only: 'tc' },
  cactus: { family: 'Cactus Classical Serif', w: 400, q: g('Cactus Classical Serif', 0), serif: true, kind: 'serif', fbw: 500, only: 'tc' },
  tiempos: { family: 'Source Serif 4', w: 700, q: 'Source+Serif+4:opsz,wght@8..60,700', serif: true, fbw: 700, kind: 'serif', only: 'latin' },
  // rounded
  maru: { family: 'Zen Maru Gothic', w: 700, q: g('Zen Maru Gothic', 700), serif: false, fbw: 700, kind: 'round', only: 'jp' },
  goround: { family: 'Chiron GoRound TC', w: 800, q: g('Chiron GoRound TC', 800), serif: false, fbw: 800, kind: 'round', only: 'tc' },
  goroundlight: { family: 'Chiron GoRound TC', w: 300, q: g('Chiron GoRound TC', 300), serif: false, fbw: 300, kind: 'thin', only: 'tc' },
  huninn: { family: 'Huninn', w: 400, q: g('Huninn', 0), serif: false, fbw: 600, kind: 'round', only: 'tc' },
  chocolate: { family: 'Chocolate Classical Sans', w: 400, q: g('Chocolate Classical Sans', 0), serif: false, fbw: 500, kind: 'sans', only: 'tc' },
  // written by hand: kai, pencil, felt pen
  wenkai: { family: 'LXGW WenKai TC', w: 700, q: g('LXGW WenKai TC', 700), serif: true, fbw: 700, kind: 'hand', only: 'tc' },
  iansui: { family: 'Iansui', w: 400, q: g('Iansui', 0), serif: true, fbw: 500, kind: 'hand', only: 'tc' },
  klee: { family: 'Klee One', w: 600, q: g('Klee One', 600), serif: true, fbw: 600, kind: 'hand', only: 'jp' },
  longcang: { family: 'Long Cang', w: 400, q: g('Long Cang', 0), serif: true, fbw: 500, kind: 'hand', only: 'sc' },
  caveat: { family: 'Caveat', w: 700, q: g('Caveat', 700), serif: false, fbw: 600, kind: 'hand', only: 'latin' },
  // brush
  mashan: { family: 'Ma Shan Zheng', w: 400, q: g('Ma Shan Zheng', 0), serif: true, fbw: 700, kind: 'brush', only: 'sc' },
  zhimang: { family: 'Zhi Mang Xing', w: 400, q: g('Zhi Mang Xing', 0), serif: true, fbw: 600, kind: 'brush', only: 'sc' },
  syuku: { family: 'Yuji Syuku', w: 400, q: g('Yuji Syuku', 0), serif: true, fbw: 600, kind: 'brush', only: 'jp' },
  // artistic and stylised
  dela: { family: 'Dela Gothic One', w: 400, q: g('Dela Gothic One', 0), serif: false, kind: 'art', only: 'jp' },
  dot: { family: 'DotGothic16', w: 400, q: g('DotGothic16', 0), serif: false, kind: 'art', only: 'jp' },
  kuaile: { family: 'ZCOOL KuaiLe', w: 400, q: g('ZCOOL KuaiLe', 0), serif: false, fbw: 700, kind: 'art', only: 'sc' },
  xiaowei: { family: 'ZCOOL XiaoWei', w: 400, q: g('ZCOOL XiaoWei', 0), serif: true, fbw: 600, kind: 'art', only: 'sc' },
  antique: { family: 'Zen Antique', w: 400, q: g('Zen Antique', 0), serif: true, fbw: 700, kind: 'art', only: 'jp' },
  decol: { family: 'Kaisei Decol', w: 700, q: g('Kaisei Decol', 700), serif: true, fbw: 700, kind: 'art', only: 'jp' },
  monoton: { family: 'Monoton', w: 400, q: g('Monoton', 0), serif: false, fbw: 300, kind: 'art', only: 'latin' },
  // Latin display faces (other scripts in Noto)
  fraunces: { family: 'Fraunces', w: 300, q: 'Fraunces:opsz,wght@9..144,300', serif: true, fbw: 300, kind: 'display', only: 'latin' },
  playfair: { family: 'Playfair Display', w: 800, q: g('Playfair Display', 800), serif: true, fbw: 800, kind: 'display', only: 'latin' },
  instrument: { family: 'Instrument Serif', w: 400, q: g('Instrument Serif', 0), serif: true, fbw: 400, kind: 'display', only: 'latin' },
  bebas: { family: 'Bebas Neue', w: 400, q: g('Bebas Neue', 0), serif: false, fbw: 800, kind: 'display', only: 'latin' },
  grotesk: { family: 'Space Grotesk', w: 700, q: g('Space Grotesk', 700), serif: false, fbw: 700, kind: 'display', only: 'latin' },
  syne: { family: 'Syne', w: 800, q: g('Syne', 800), serif: false, fbw: 800, kind: 'display', only: 'latin' },
};
export const SCRIPTS = [
  { id: 'han', re: /[㐀-鿿豈-﫿＀-￯]/, sans: ['Noto Sans TC', 'Noto Sans SC'], serif: ['Noto Serif TC', 'Noto Serif SC'] },
  { id: 'kana', re: /[぀-ヿㇰ-ㇿ]/, sans: ['Noto Sans JP'], serif: ['Noto Serif JP'] },
  { id: 'hangul', re: /[가-힯ᄀ-ᇿ㄰-㆏]/, sans: ['Noto Sans KR'], serif: ['Noto Serif KR'] },
  { id: 'latinx', re: /[À-ɏḀ-ỿͰ-ϿЀ-ӿ]/, sans: ['Noto Sans'], serif: ['Noto Serif'] },
  { id: 'thai', re: /[฀-๿]/, sans: ['Noto Sans Thai'], serif: ['Noto Serif Thai'] },
  { id: 'arabic', re: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/, sans: ['Noto Sans Arabic'], serif: ['Noto Naskh Arabic'] },
  { id: 'hebrew', re: /[֐-׿]/, sans: ['Noto Sans Hebrew'], serif: ['Noto Serif Hebrew'] },
  { id: 'deva', re: /[ऀ-ॿ]/, sans: ['Noto Sans Devanagari'], serif: ['Noto Serif Devanagari'] },
];
const FAMILY_WEIGHTS: Record<string, string> = { 'Noto Naskh Arabic': '500;700' };
const SIMP = new Set('们这说时来对发么还过个国会后东车长门见让认语书无为爱梦风飞乐声边远间头样开关亲听问岁经观总当实现进运动将变红马鱼鸟节热泪忆灯钟');
const TRAD = new Set('們這說時來對發麼還過個國會後東車長門見讓認語書無為愛夢風飛樂聲邊遠間頭樣開關親聽問歲經觀總當實現進運動將變紅馬魚鳥節熱淚憶燈鐘');

/** Which CJK glyph forms to use: the lyrics decide when they can, otherwise the interface language does. */
export function cjkRegion(sample: string, uiLang = 'zh-Hant'): 'TC' | 'SC' | 'JP' | 'KR' {
  if (/[぀-ヿ]/.test(sample)) return 'JP';
  if (/[가-힯]/.test(sample)) return 'KR';
  let sc = 0, tc = 0; for (const ch of sample) { if (SIMP.has(ch)) sc++; else if (TRAD.has(ch)) tc++; }
  if (sc > tc) return 'SC'; if (tc > sc) return 'TC';
  return ({ 'zh-Hans': 'SC', ja: 'JP', ko: 'KR' } as Record<string, 'SC' | 'JP' | 'KR'>)[uiLang] || 'TC';
}
export function faceOf(key: string, sample = '', uiLang?: string): Face {
  const f = FONTS[key] || FONTS.notosans; if (!f.cjk) return f;
  const fam = (f.serif ? 'Noto Serif ' : 'Noto Sans ') + cjkRegion(sample, uiLang);
  return { ...f, family: fam, q: g(fam, f.w) };
}
export function fallbackFamilies(serif: boolean, sample = '', uiLang?: string): string[] {
  const r = cjkRegion(sample, uiLang), pref = [r, ...(['TC', 'SC', 'JP', 'KR'] as const).filter(x => x !== r)];
  return [...pref.map(x => (serif ? 'Noto Serif ' : 'Noto Sans ') + x), ...SCRIPTS.filter(S => !['han', 'kana', 'hangul'].includes(S.id)).map(S => (serif ? S.serif[0] : S.sans[0]))];
}
const SYS_CJK = '"PingFang TC","PingFang SC","Hiragino Sans","Apple SD Gothic Neo","Microsoft JhengHei","Microsoft YaHei","Yu Gothic","Malgun Gothic"';
/** The CSS font stack and weight for lyrics in a face. */
export function fontStack(key: string, sample = '', uiLang?: string): { w: number; stack: string } {
  const f = faceOf(key, sample, uiLang);
  return { w: f.w, stack: `"${f.family}",${fallbackFamilies(f.serif, sample, uiLang).map(x => `"${x}"`).join(',')},${SYS_CJK},${f.serif ? 'serif' : 'sans-serif'}` };
}
export const captionStack = (sample = '', uiLang?: string) => `${fallbackFamilies(false, sample, uiLang).map(x => `"${x}"`).join(',')},${SYS_CJK},sans-serif`;

/* ---- loading (browser only) ---- */
const ready = new Map<string, Promise<void>>();
const slug = (f: string) => f.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const localBase = () => (typeof window !== 'undefined' ? (window as any).CADENZA_FONTS as string | undefined : undefined);
function loadCss(key: string, q: string): Promise<void> {
  const base = localBase(), href = base ? base + slug(decodeURIComponent(q.split(':')[0]).replace(/\+/g, ' ')) + '.css' : `https://fonts.googleapis.com/css2?family=${q}&display=swap`;
  const k = base ? href : key;
  if (!ready.has(k)) ready.set(k, new Promise(res => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href;
    l.onload = () => res(); l.onerror = () => res(); document.head.appendChild(l); setTimeout(res, 6000);
  }));
  return ready.get(k)!;
}
/** Load the face plus the Noto fallbacks for every script that appears in `text`. */
export async function ensureFont(key: string, text: string, uiLang?: string): Promise<void> {
  if (typeof document === 'undefined') return;
  const f = faceOf(key, text, uiLang), fw = f.fbw || f.w, need = SCRIPTS.filter(S => S.re.test(text + 'A'));
  const jobs = [loadCss('face:' + f.family, f.q)];
  for (const S of need) for (const fam of [...S.sans, ...(f.serif ? S.serif : [])]) {
    const fbq = fw >= 900 ? 900 : fw >= 600 ? 700 : fw >= 450 ? 500 : 300;
    const wts = FAMILY_WEIGHTS[fam] || (S.sans.includes(fam) ? `${Math.min(500, fbq)};${fbq}` : `${fbq}`);
    jobs.push(loadCss(fam + wts, fam.replace(/ /g, '+') + ':wght@' + wts));
  }
  await Promise.all(jobs);
  if (!document.fonts) return;
  const uniq = [...new Set(text + 'あ漢A')].join('').slice(0, 600);
  await Promise.all([document.fonts.load(`${f.w} 150px "${f.family}"`, uniq).catch(() => {}),
    ...fallbackFamilies(f.serif, text, uiLang).map(fam => document.fonts.load(`${fw} 150px "${fam}"`, uniq).catch(() => {}))]);
}
/** Never keep the picture waiting on the network: after `ms`, go on with what is there (onLate fires when it arrives). */
export function ensureFontSoon(key: string, text: string, uiLang?: string, ms = 1200, onLate?: () => void): Promise<void> {
  const p = ensureFont(key, text, uiLang); let late = false;
  p.then(() => { if (late) onLate?.(); });
  return Promise.race([p, new Promise<void>(r => setTimeout(() => { late = true; r(); }, ms))]);
}
