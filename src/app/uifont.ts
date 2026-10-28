// The interface's typeface: Instrument Sans for Latin text, and the Noto Sans cut for the interface language's CJK forms
// (Traditional, Simplified, Japanese and Korean shapes differ), from the app's own font folder on the desktop.
const CJK: Record<string, string[]> = { 'zh-Hant': ['Noto Sans TC', 'Noto Sans SC'], 'zh-Hans': ['Noto Sans SC', 'Noto Sans TC'], ja: ['Noto Sans JP', 'Noto Sans TC'], ko: ['Noto Sans KR', 'Noto Sans TC'] };
const SYS = '"PingFang TC","PingFang SC","Hiragino Sans","Microsoft JhengHei","Microsoft YaHei","Yu Gothic","Malgun Gothic"';
const loaded = new Set<string>();
export function applyUiFont(lang: string) {
  const fams = CJK[lang] || CJK['zh-Hant'], base = (window as any).CADENZA_FONTS as string | undefined;
  if (base) for (const f of fams) { const slug = f.toLowerCase().replace(/[^a-z0-9]+/g, '-'); if (loaded.has(slug)) continue; loaded.add(slug);
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + slug + '.css'; document.head.appendChild(l); }
  document.documentElement.style.setProperty('--font-cjk', `${fams.map(f => `"${f}"`).join(',')},${SYS}`);
  document.documentElement.lang = lang;
}
