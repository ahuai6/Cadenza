// The interface's typeface. Six choices; each pairs a face for Latin text with the CJK cut for the interface language
// (Traditional, Simplified, Japanese and Korean shapes differ), all from the app's own font folder on the desktop.
// A face is applied only once its glyphs for the interface's own words are in (document.fonts.load with a sample of
// them): the interface never shows one font and then swaps to another. At start this happens before the first paint.
const CJK: Record<string, string[]> = { 'zh-Hant': ['Noto Sans TC', 'Noto Sans SC'], 'zh-Hans': ['Noto Sans SC', 'Noto Sans TC'], ja: ['Noto Sans JP', 'Noto Sans TC'], ko: ['Noto Sans KR', 'Noto Sans TC'] };
const SYS = '"PingFang TC","PingFang SC","Hiragino Sans","Microsoft JhengHei","Microsoft YaHei","Yu Gothic","Malgun Gothic"';
/** [Latin face (null: the bundled Instrument Sans), a face that covers CJK itself (before the Noto cut), serif CJK] */
export const UI_FONTS: Record<string, { latin: string | null; cjk?: string; serif?: boolean }> = {
  default: { latin: null }, grotesk: { latin: 'Space Grotesk' }, serif: { latin: 'Source Serif 4', serif: true },
  round: { latin: 'Chiron GoRound TC', cjk: 'Chiron GoRound TC' }, huninn: { latin: 'Huninn', cjk: 'Huninn' }, kai: { latin: 'LXGW WenKai TC', cjk: 'LXGW WenKai TC', serif: true },
};
const slug = (f: string) => f.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const loaded = new Map<string, Promise<void>>();
function link(fam: string): Promise<void> {
  const base = (window as any).CADENZA_FONTS as string | undefined; if (!base) return Promise.resolve();
  const s = slug(fam); if (!loaded.has(s)) loaded.set(s, new Promise(res => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + s + '.css'; l.onload = l.onerror = () => res(); document.head.appendChild(l); setTimeout(res, 3000); }));
  return loaded.get(s)!;
}
let cur = { lang: '', font: 'default' }, sample = '';
/** Apply the interface font for `lang` (and the chosen face, default: the one in use): resolves once it shows. */
export async function applyUiFont(lang: string, font = cur.font, words?: string) {
  const U = UI_FONTS[font] || UI_FONTS.default, cjk = CJK[lang] || CJK['zh-Hant'];
  const serifCjk = cjk.map(f => f.replace('Sans', 'Serif'));
  const fams = [...(U.latin ? [U.latin] : []), ...(U.cjk ? [U.cjk] : []), ...cjk, ...(U.serif && !U.cjk ? serifCjk : [])];
  await Promise.all([...new Set(fams)].map(link));
  if (words) sample = [...new Set(words)].join('').slice(0, 900);
  // (the glyphs the interface will draw, at the weights it draws them in)
  if (document.fonts) await Promise.race([Promise.all(fams.flatMap(f => ['450', '600'].map(w => document.fonts.load(`${w} 14px "${f}"`, sample + 'Aa0').catch(() => {})))), new Promise(r => setTimeout(r, 2500))]);
  const cjkStack = [...(U.cjk ? [U.cjk] : []), ...(U.serif ? serifCjk : cjk)].map(f => `"${f}"`).join(',');
  const root = document.documentElement.style;
  root.setProperty('--font-cjk', `${cjk.map(f => `"${f}"`).join(',')},${SYS}`);
  root.setProperty('--font-ui', `${U.latin ? `"${U.latin}",` : '"Instrument Sans Variable","Instrument Sans",'}${cjkStack},${SYS},${U.serif ? 'serif' : 'system-ui,sans-serif'}`);
  document.documentElement.lang = lang; cur = { lang, font };
}
