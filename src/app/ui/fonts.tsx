// Picking a typeface: every face listed by its style (thin, bold, serif, rounded, handwritten, brush, artistic, Latin
// display), each name shown in its own face, with a note of which script it was made for. The names are pictures baked
// beforehand (scripts/font-previews.mjs: one WebP per interface language, used as a mask in the text's own colour), so
// opening the picker loads no face at all — thirty of them, most large CJK ones, used to make it stall. A face the
// pictures do not have yet (a new one, before they are baked again) is shown as before, in its own face.
import { useEffect, useMemo, type CSSProperties } from 'react';
import { tx, currentLang } from '../../i18n';
import { FONTS, FONT_KINDS, fontStack, ensureFont } from '../../engine';
import { Dropdown, type Opt } from './kit';
import BAKED from './font-previews/index.json';

const baked = BAKED as unknown as { scale: number; row: number; width: number; langs: Record<string, Record<string, [number, number]>> };
/** The baked picture of a face's name in the interface's language, as the style of the name's place (or null). */
function preview(key: string): CSSProperties | null {
  const lang = currentLang(), at = baked.langs[lang]?.[key]; if (!at) return null;
  const img = new URL(`./font-previews/${lang}.webp`, import.meta.url).href, n = Object.keys(baked.langs[lang]).length;
  return { display: 'inline-block', width: at[1], height: baked.row, fontSize: 0, verticalAlign: 'middle', background: 'currentColor',
    WebkitMaskImage: `url("${img}")`, maskImage: `url("${img}")`, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    WebkitMaskSize: `${baked.width}px ${n * baked.row}px`, maskSize: `${baked.width}px ${n * baked.row}px`,
    WebkitMaskPosition: `0 ${-at[0] * baked.row}px`, maskPosition: `0 ${-at[0] * baked.row}px` };
}
/** The faces as dropdown options: grouped by style, previewed. `extra` goes first (e.g. "the interface's own"). */
export function fontOptions(extra: Opt[] = []): Opt[] {
  const keys = Object.keys(FONTS).sort((a, b) => FONT_KINDS.indexOf(FONTS[a].kind) - FONT_KINDS.indexOf(FONTS[b].kind));
  return [...extra, ...keys.map(k => { const f = FONTS[k], st = fontStack(k, tx('fontn.' + k));
    return [k, tx('fontn.' + k), preview(k) ?? { fontFamily: st.stack, fontWeight: st.w, fontSize: 15 }, [tx('fontk.' + f.kind), f.only ? tx('fonto.' + f.only) : ''].filter(Boolean).join(' · ')] as Opt; })];
}
export function FontPicker({ value, onChange, label, extra }: { value: string; onChange: (v: string) => void; label: string; extra?: Opt[] }) {
  const opts = useMemo(() => fontOptions(extra), [extra]);
  // (only a face without a baked picture is loaded, for its name)
  useEffect(() => { for (const k of Object.keys(FONTS)) if (!baked.langs[currentLang()]?.[k]) ensureFont(k, tx('fontn.' + k)).catch(() => {}); }, []);
  return <Dropdown wide label={label} value={value} options={opts} onChange={onChange} />;
}
