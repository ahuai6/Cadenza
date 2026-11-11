// Picking a typeface: every face listed by its style (thin, bold, serif, rounded, handwritten, brush, artistic, Latin
// display), each name shown in its own face, with a note of which script it was made for. The names are pictures baked
// beforehand (scripts/font-previews.mjs: one WebP per interface language, used as a mask in the text's own colour), so
// opening the picker loads no face at all — thirty of them, most large CJK ones, used to make it stall. A face the
// pictures do not have yet (a new one, before they are baked again) is shown as before, in its own face.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { tx, currentLang } from '../../i18n';
import { FONTS, FONT_KINDS, fontStack, ensureFont } from '../../engine';
import { Dropdown, type Opt } from './kit';
import BAKED from './font-previews/index.json';
import { loadCoverage, coverageReady, fontCoverage } from './fontCoverage';

const baked = BAKED as unknown as {
  scale: number;
  row: number;
  width: number;
  langs: Record<string, Record<string, [number, number]>>;
};
/** The baked picture of a face's name in the interface's language, as the style of the name's place (or null). */
function preview(key: string): CSSProperties | null {
  const lang = currentLang(),
    at = baked.langs[lang]?.[key];
  if (!at) return null;
  const img = new URL(`./font-previews/${lang}.webp`, import.meta.url).href,
    n = Object.keys(baked.langs[lang]).length;
  return {
    display: 'inline-block',
    width: at[1],
    height: baked.row,
    fontSize: 0,
    verticalAlign: 'middle',
    background: 'currentColor',
    WebkitMaskImage: `url("${img}")`,
    maskImage: `url("${img}")`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: `${baked.width}px ${n * baked.row}px`,
    maskSize: `${baked.width}px ${n * baked.row}px`,
    WebkitMaskPosition: `0 ${-at[0] * baked.row}px`,
    maskPosition: `0 ${-at[0] * baked.row}px`,
  };
}
/** The faces as dropdown options: grouped by style, previewed. `extra` goes first (e.g. "the interface's own"). With a
 *  text (the lyrics), the faces that show all of it come first; the others after, marked with how much falls back. */
export function fontOptions(extra: Opt[] = [], text = ''): Opt[] {
  const cov = Object.fromEntries(Object.keys(FONTS).map((k) => [k, text ? fontCoverage(k, text, !!FONTS[k].cjk) : 1]));
  const keys = Object.keys(FONTS).sort(
    (a, b) => +(cov[b] >= 1) - +(cov[a] >= 1) || FONT_KINDS.indexOf(FONTS[a].kind) - FONT_KINDS.indexOf(FONTS[b].kind),
  );
  return [
    ...extra,
    ...keys.map((k) => {
      const f = FONTS[k],
        st = fontStack(k, tx('fontn.' + k)),
        miss = Math.max(1, Math.round((1 - cov[k]) * 100));
      return [
        k,
        tx('fontn.' + k),
        preview(k) ?? { fontFamily: st.stack, fontWeight: st.w, fontSize: 15 },
        [
          tx('fontk.' + f.kind),
          f.only ? tx('fonto.' + f.only) : '',
          cov[k] < 1 ? tx('fontc.partial', { pct: miss }) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      ] as Opt;
    }),
  ];
}
/** text: the lyrics the face is for (the faces that show all of them listed first). */
export function FontPicker({
  value,
  onChange,
  label,
  extra,
  text = '',
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  extra?: Opt[];
  text?: string;
}) {
  const [cov, setCov] = useState(coverageReady());
  useEffect(() => {
    if (text && !coverageReady())
      loadCoverage()
        .then(() => setCov(true))
        .catch(() => {});
  }, [text]);
  const opts = useMemo(() => fontOptions(extra, cov ? text : ''), [extra, text, cov]);
  // (only a face without a baked picture is loaded, for its name)
  useEffect(() => {
    for (const k of Object.keys(FONTS))
      if (!baked.langs[currentLang()]?.[k]) ensureFont(k, tx('fontn.' + k)).catch(() => {});
  }, []);
  return <Dropdown wide label={label} value={value} options={opts} onChange={onChange} />;
}
