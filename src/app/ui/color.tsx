// A colour field: a swatch opening a picker of our own — a saturation/brightness square, a hue strip, the hex — with a
// screen eyedropper that picks from anywhere on the screen, other windows too (the EyeDropper API: the system's own
// picker, not limited to this page); while it is up, the song's cover lies over the colour square, to pick from it.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { tx } from '../../i18n';
import { Icon } from './icons';
import s from './color.module.css';

type HSV = [number, number, number];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export function hexToHsv(hex: string): HSV {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); const n = m ? parseInt(m[1], 16) : 0;
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx === 0 ? 0 : d / mx, mx];
}
export function hsvToHex([h, sa, v]: HSV): string {
  const f = (k: number) => { const kk = (k + h / 60) % 6; return v - v * sa * Math.max(0, Math.min(kk, 4 - kk, 1)); };
  return '#' + [f(5), f(3), f(1)].map(x => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0')).join('');
}
const hasDropper = () => typeof window !== 'undefined' && 'EyeDropper' in window;

export function ColorField({ value, onChange, label, cover }: { value: string; onChange: (hex: string) => void; label: string; cover?: string | null }) {
  const [open, setOpen] = useState(false), btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={btn} className={s.field} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <i style={{ background: value }} /><span>{label}</span>
      </button>
      {open && <Picker anchor={btn} value={value} onChange={onChange} cover={cover} onClose={() => setOpen(false)} label={label} />}
    </>
  );
}

function Picker({ anchor, value, onChange, cover, onClose, label }: { anchor: React.RefObject<HTMLElement | null>; value: string; onChange: (hex: string) => void; cover?: string | null; onClose: () => void; label: string }) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value)), [hex, setHex] = useState(value), [picking, setPicking] = useState(false), [pos, setPos] = useState<CSSProperties | null>(null);
  const box = useRef<HTMLDivElement>(null), sq = useRef<HTMLDivElement>(null), coverImg = useRef<HTMLImageElement>(null), pickingRef = useRef(false);
  const pict = !!anchor.current?.closest('.on-picture');
  // (a colour changed from outside — a palette from the cover, another field — shows here too)
  useEffect(() => { if (value.toLowerCase() !== hsvToHex(hsv)) { setHsv(hexToHsv(value)); setHex(value); } }, [value]);
  useLayoutEffect(() => { if (!anchor.current) return; const a = anchor.current.getBoundingClientRect(), W = 248, Hh = 330;
    const below = innerHeight - a.bottom - 12 >= Hh || a.top < Hh + 12;
    setPos({ left: Math.max(8, Math.min(a.left, innerWidth - W - 8)), width: W, ...(below ? { top: a.bottom + 6 } : { bottom: innerHeight - a.top + 6 }) }); }, []);
  useEffect(() => {
    const away = (e: Event) => { if (pickingRef.current) return; const t = e.target as Node; if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pickingRef.current) { e.preventDefault(); e.stopPropagation(); onClose(); anchor.current?.focus(); } };
    addEventListener('pointerdown', away, true); addEventListener('keydown', key, true);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', key, true); }; }, []);
  const set = (v: HSV) => { setHsv(v); const h = hsvToHex(v); setHex(h); onChange(h); };
  const setFromHex = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); if (!m) return; const x = '#' + m[1].toLowerCase(); setHsv(hexToHsv(x)); setHex(x); onChange(x); };
  const drag = (e: React.PointerEvent) => { const el = sq.current!; el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); set([hsv[0], clamp01((ev.clientX - r.left) / r.width), 1 - clamp01((ev.clientY - r.top) / r.height)]); };
    at(e); const mv = (ev: PointerEvent) => at(ev), up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); };
  // the screen eyedropper: anywhere on the screen, other windows too; the cover over the colour square meanwhile
  const pick = async () => {
    setPicking(true); pickingRef.current = true;
    try {
      if (hasDropper()) { const r = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open(); setFromHex(r.sRGBHex); setPicking(false); }
      // (no screen eyedropper here: the cover stays up, and a click on it picks its colour)
    } catch { setPicking(false); }
    finally { pickingRef.current = false; }
  };
  const fromCover = (e: React.MouseEvent<HTMLImageElement>) => { if (hasDropper()) return; const img = coverImg.current!, r = img.getBoundingClientRect();
    try { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d')!;
      g.drawImage(img, (e.clientX - r.left) / r.width * img.naturalWidth, (e.clientY - r.top) / r.height * img.naturalHeight, 1, 1, 0, 0, 1, 1);
      const [R, G, B] = g.getImageData(0, 0, 1, 1).data; setFromHex('#' + [R, G, B].map(x => x.toString(16).padStart(2, '0')).join('')); } catch { /* (a cover that cannot be read back) */ }
    setPicking(false); };
  if (!pos) return null;
  return createPortal(
    <div ref={box} className={s.pop + ' glass' + (pict ? ' on-picture' : '')} role="dialog" aria-label={label} data-colorpop style={pos}>
      <div className={s.sq} ref={sq} style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex([hsv[0], 1, 1])})` }} onPointerDown={drag}>
        <b style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: hex }} />
        {picking && cover && <img ref={coverImg} className={s.cover} src={cover} alt="" draggable={false} onClick={fromCover} />}
      </div>
      <input className={s.hue} type="range" min={0} max={359} value={Math.round(hsv[0])} aria-label={tx('col.hue')} onChange={e => set([+e.target.value, hsv[1], hsv[2]])} />
      <div className={s.row}>
        <i style={{ background: hex }} />
        <input className={s.hex} value={hex} spellCheck={false} aria-label="HEX" onChange={e => setHex(e.target.value)} onBlur={() => setFromHex(hex)} onKeyDown={e => { if (e.key === 'Enter') setFromHex(hex); }} />
        <button type="button" className={s.drop} data-on={picking || undefined} title={tx('col.dropper')} aria-label={tx('col.dropper')} onClick={pick}><Icon n="pipette" size={16} /></button>
      </div>
      {picking && <p className={s.note}>{tx(hasDropper() ? 'col.dropperHelp' : 'col.dropperCover')}</p>}
    </div>, document.body);
}
