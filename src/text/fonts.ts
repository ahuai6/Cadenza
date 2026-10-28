// Typefaces: the display faces for lyrics, the Noto fallbacks for every script that appears, and loading them. The
// desktop app carries every face (window.CADENZA_FONTS points at its folder of stylesheets) and never goes online for
// fonts; the web page asks Google Fonts for exactly the families and weights it needs.

export interface Face { family: string; w: number; q: string; serif: boolean; fbw?: number }
export const FONTS: Record<string, Face> = {
  notosans: { family: 'Noto Sans TC', w: 900, q: 'Noto+Sans+TC:wght@900', serif: false },
  serif: { family: 'Noto Serif TC', w: 900, q: 'Noto+Serif+TC:wght@900', serif: true },
  tiempos: { family: 'Source Serif 4', w: 700, q: 'Source+Serif+4:opsz,wght@8..60,700', serif: true, fbw: 700 },
  dela: { family: 'Dela Gothic One', w: 400, q: 'Dela+Gothic+One', serif: false },
  maru: { family: 'Zen Maru Gothic', w: 700, q: 'Zen+Maru+Gothic:wght@700', serif: false, fbw: 700 },
  dot: { family: 'DotGothic16', w: 400, q: 'DotGothic16', serif: false },
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
  const f = FONTS[key] || FONTS.notosans; if (key !== 'notosans' && key !== 'serif') return f;
  const fam = (key === 'serif' ? 'Noto Serif ' : 'Noto Sans ') + cjkRegion(sample, uiLang);
  return { ...f, family: fam, q: fam.replace(/ /g, '+') + ':wght@900' };
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
    const wts = FAMILY_WEIGHTS[fam] || (S.sans.includes(fam) ? `500;${fw >= 900 ? 900 : 700}` : `${fw >= 900 ? 900 : 700}`);
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
