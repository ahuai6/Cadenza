// Which characters each lyric face has of its own (baked by scripts/font-coverage.mjs from the font files' character
// maps), read the first time a font picker opens: the faces that show all of a song's lyrics are listed first.
type Ranges = [number, number][];
let COV: Record<string, Ranges> | null = null, covLoad: Promise<void> | null = null;
export const loadCoverage = () => covLoad ??= import('./font-previews/coverage.json').then(m => {
  COV = Object.fromEntries(Object.entries(m.default as Record<string, string>).map(([k, s]) => { let p = 0;
    return [k, s.split(';').map(x => { const [d, l] = x.split(','), a = p + parseInt(d, 36), b = a + parseInt(l, 36); p = b; return [a, b] as [number, number]; })]; })); });
const has = (rs: Ranges, c: number) => { let lo = 0, hi = rs.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (c < rs[m][0]) hi = m - 1; else if (c > rs[m][1]) lo = m + 1; else return true; } return false; };
/** How much of a text's letters and digits a face shows in its own glyphs (0..1): by the characters themselves, never by
 *  the script a face is labelled for — a face with both Traditional and Simplified characters shows lyrics in either.
 *  The Noto faces (cjk) follow the lyrics' script (always 1); a face not baked yet counts as whole. */
export function fontCoverage(key: string, text: string, cjk = false): number {
  const rs = COV?.[key]; if (cjk || !rs) return 1;
  const cs = [...new Set([...text].filter(ch => /[\p{L}\p{N}]/u.test(ch)).map(ch => ch.codePointAt(0)!))]; if (!cs.length) return 1;
  return cs.filter(c => has(rs, c)).length / cs.length;
}
export const coverageReady = () => !!COV;
