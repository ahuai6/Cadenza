// Picking a typeface: every face listed by its style (thin, bold, serif, rounded, handwritten, brush, artistic, Latin
// display), each name shown in its own face, with a note of which script it was made for. The faces are loaded as the
// picker appears (only the glyphs of their names), so the list never shows one font and then another.
import { useEffect, useMemo } from 'react';
import { tx } from '../../i18n';
import { FONTS, FONT_KINDS, fontStack, ensureFont } from '../../engine';
import { Dropdown, type Opt } from './kit';

/** The faces as dropdown options: grouped by style, previewed. `extra` goes first (e.g. "the interface's own"). */
export function fontOptions(extra: Opt[] = []): Opt[] {
  const keys = Object.keys(FONTS).sort((a, b) => FONT_KINDS.indexOf(FONTS[a].kind) - FONT_KINDS.indexOf(FONTS[b].kind));
  return [...extra, ...keys.map(k => { const f = FONTS[k], st = fontStack(k, tx('fontn.' + k));
    return [k, tx('fontn.' + k), { fontFamily: st.stack, fontWeight: st.w, fontSize: 15 }, [tx('fontk.' + f.kind), f.only ? tx('fonto.' + f.only) : ''].filter(Boolean).join(' · ')] as Opt; })];
}
export function FontPicker({ value, onChange, label, extra }: { value: string; onChange: (v: string) => void; label: string; extra?: Opt[] }) {
  const opts = useMemo(() => fontOptions(extra), [extra]);
  useEffect(() => { for (const k of Object.keys(FONTS)) ensureFont(k, tx('fontn.' + k)).catch(() => {}); }, []);
  return <Dropdown wide label={label} value={value} options={opts} onChange={onChange} />;
}
