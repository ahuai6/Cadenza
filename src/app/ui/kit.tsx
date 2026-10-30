// The interface's building blocks: buttons, segmented controls, switches, checkboxes, sliders, dropdowns, fields,
// covers, and the floating things (context menu with its submenus, toast). Everything that opens also closes with a
// short fade (usePresence), so nothing ever vanishes in one frame.
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { coverUrl } from '../bridge';
import { tx } from '../../i18n';
import { ui, useStore, type MenuItem } from '../state';
import s from './kit.module.css';
export { s as kit };

/** How long a thing takes to leave (--t-out): it stays mounted that long, marked closing. */
export const OUT_MS = 130;
/** Keep a thing mounted while it leaves: `shown` stays true for OUT_MS after `open` goes false, `closing` meanwhile. */
export function usePresence(open: boolean, ms = OUT_MS) {
  const [shown, setShown] = useState(open), [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setShown(true); setClosing(false); return; }
    if (!shown) return; setClosing(true); const tm = window.setTimeout(() => { setShown(false); setClosing(false); }, ms); return () => clearTimeout(tm);
  }, [open]);
  return { shown: shown || open, closing: closing && !open };
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger' | 'quiet'; size?: 'sm' | 'lg'; glass?: boolean; icon?: string };
export function Button({ kind, size, glass, icon, children, className, ...rest }: BtnProps) {
  return <button type="button" className={s.btn + (className ? ' ' + className : '')} data-kind={kind} data-size={size} data-glass={glass || undefined} {...rest}>
    {icon && <Icon n={icon} size={size === 'sm' ? 15 : 17} />}{children}</button>;
}
type IbProps = ButtonHTMLAttributes<HTMLButtonElement> & { n: string; label: string; size?: 'sm' | 'lg' | 'xl'; iconSize?: number; glass?: boolean; solid?: boolean; pressed?: boolean; on?: boolean; filled?: boolean; count?: number };
/** An icon button: its label is its tooltip and its accessible name. */
export function IconButton({ n, label, size, iconSize, glass, solid, pressed, on, filled, count, className, ...rest }: IbProps) {
  const isz = iconSize ?? (size === 'xl' ? 26 : size === 'lg' ? 21 : size === 'sm' ? 16 : 18);
  return <button type="button" className={s.ib + (className ? ' ' + className : '')} data-size={size} data-glass={glass || undefined} data-solid={solid || undefined}
    data-on={on ? 'true' : undefined} aria-pressed={pressed} title={label} aria-label={label} {...rest}>
    <Icon n={n} size={isz} filled={filled} />{count != null && count > 1 && <i className={s.badgeN}>{count > 99 ? '99+' : count}</i>}</button>;
}

/** A segmented control. The chosen segment's mark slides to it (one element moved, never two cross-fading). */
export function Seg<T extends string | number>({ value, options, onChange, size, fit, label, role = 'radiogroup' }: { value: T; options: [T, string, string?, string?][]; onChange: (v: T) => void; size?: 'sm'; fit?: boolean; label?: string; role?: 'radiogroup' | 'tablist' }) {
  const item = role === 'tablist' ? 'tab' : 'radio', box = useRef<HTMLDivElement>(null), [mark, setMark] = useState<CSSProperties | null>(null), first = useRef(true);
  useLayoutEffect(() => {
    const place = () => { const el = box.current?.querySelector<HTMLElement>('[aria-checked="true"],[aria-selected="true"]'); if (!el) { setMark(null); return; }
      setMark({ width: el.offsetWidth, height: el.offsetHeight, transform: `translate(${el.offsetLeft}px, ${el.offsetTop}px)`, transition: first.current ? 'none' : undefined }); first.current = false; };
    place(); const ro = new ResizeObserver(place); if (box.current) ro.observe(box.current); return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div className={s.seg} ref={box} data-size={size} data-fit={fit || undefined} role={role} aria-label={label}>
      {mark && <i className={s.segMark} style={mark} aria-hidden="true" />}
      {options.map(([v, text, ic, tip]) => (
        <button key={String(v)} type="button" role={item} aria-selected={item === 'tab' ? value === v : undefined} aria-checked={item === 'radio' ? value === v : undefined} title={tip || text} aria-label={tip || undefined} onClick={() => onChange(v)}>
          {ic && <Icon n={ic} size={size === 'sm' ? 14 : 15} />}{text && <span>{text}</span>}
        </button>))}
    </div>
  );
}
export function Toggle({ label, help, on, set }: { label: string; help?: string; on: boolean; set: (v: boolean) => void }) {
  return <label className={s.toggle}><span><b>{label}</b>{help && <small>{help}</small>}</span>
    <input type="checkbox" role="switch" checked={!!on} onChange={e => set(e.target.checked)} /><i aria-hidden="true" /></label>;
}
export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className={s.check}><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} /><i aria-hidden="true"><Icon n="check" size={13} /></i><span>{label}</span></label>;
}
export function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const id = useId(), v = value ?? min, p = ((v - min) / Math.max(1e-9, max - min)) * 100;
  return (
    <div className={s.slider}>
      <label htmlFor={id} title={label}>{label}</label>
      <input id={id} className={s.range} type="range" min={min} max={max} step={step} value={v} style={{ ['--p' as string]: `${p}%` }} onChange={e => onChange(+e.target.value)} />
      <output htmlFor={id}>{format ? format(v) : (+v).toFixed(2)}</output>
    </div>
  );
}

/* ---------- the dropdown: one look for every choice from a list (the system's own list never shows) ---------- */
/** [value, label, the style its label is shown in (a font's own face), a note under it] */
export type Opt = [string, string, CSSProperties?, string?];
export function Dropdown({ value, options, onChange, label, id, className, wide }: { value: string; options: Opt[]; onChange: (v: string) => void; label?: string; id?: string; className?: string; wide?: boolean }) {
  const [open, setOpen] = useState(false), btn = useRef<HTMLButtonElement>(null), cur = options.find(o => o[0] === value) || options[0];
  return (
    <>
      <button type="button" id={id} ref={btn} className={s.dd + (className ? ' ' + className : '')} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-label={label} title={label}
        onClick={() => setOpen(v => !v)} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}>
        <span style={cur?.[2]}>{cur ? cur[1] : ''}</span><Icon n="chevronDown" size={14} />
      </button>
      <DropList open={open} anchor={btn} options={options} value={value} wide={wide} onPick={v => { setOpen(false); if (v !== value) onChange(v); btn.current?.focus(); }} onClose={() => setOpen(false)} />
    </>
  );
}
function DropList({ open, anchor, options, value, onPick, onClose, wide }: { open: boolean; anchor: React.RefObject<HTMLElement | null>; options: Opt[]; value: string; onPick: (v: string) => void; onClose: () => void; wide?: boolean }) {
  const { shown, closing } = usePresence(open), box = useRef<HTMLDivElement>(null), [pos, setPos] = useState<CSSProperties | null>(null), [hi, setHi] = useState(-1);
  const pict = !!anchor.current?.closest('.on-picture');
  useLayoutEffect(() => { if (!open || !anchor.current) return; const a = anchor.current.getBoundingClientRect(), H = Math.min(360, options.length * 34 + 10);
    const below = innerHeight - a.bottom - 12 >= H || a.top < H + 12, w = Math.max(a.width, wide ? 260 : 0);
    setPos({ left: Math.max(8, Math.min(a.left, innerWidth - w - 8)), width: w, ...(below ? { top: a.bottom + 6, transformOrigin: 'top' } : { bottom: innerHeight - a.top + 6, transformOrigin: 'bottom' }), maxHeight: H });
    setHi(Math.max(0, options.findIndex(o => o[0] === value))); }, [open]);
  useEffect(() => { if (!open) return; const sel = box.current?.querySelector('[aria-selected="true"]'); sel?.scrollIntoView({ block: 'nearest' }); }, [open, pos]);
  useEffect(() => { if (!open) return;
    const away = (e: Event) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchor.current?.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setHi(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setHi(i => { if (options[i]) onPick(options[i][0]); return i; }); }
      else if (e.key === 'Tab') onClose(); };
    addEventListener('pointerdown', away, true); addEventListener('keydown', key, true); addEventListener('blur', onClose);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', key, true); removeEventListener('blur', onClose); }; }, [open, options]);
  useEffect(() => { box.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  if (!shown || !pos) return null;
  return createPortal(
    <div ref={box} className={s.drop + ' glass' + (pict ? ' on-picture' : '')} role="listbox" data-closing={closing || undefined} style={pos}>
      {options.map(([v, l, st, note], i) => (
        <div key={v} role="option" data-i={i} aria-selected={v === value} data-hi={i === hi || undefined} onPointerEnter={() => setHi(i)} onClick={() => onPick(v)}>
          <span style={st}>{l}</span>{note && <small>{note}</small>}{v === value && <Icon n="check" size={14} />}
        </div>))}
    </div>, document.body);
}
export function Select({ label, value, options, onChange }: { label: string; value: string; options: (Opt | [string, string])[]; onChange: (v: string) => void }) {
  const id = useId();
  return <div className={s.field}><label htmlFor={id}>{label}</label><Dropdown id={id} label={label} value={value} options={options as Opt[]} onChange={onChange} /></div>;
}
/** A text field that commits on blur or Enter and follows outside changes while it is not being edited. */
export function TextField({ label, value, onCommit, placeholder, inputMode }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; inputMode?: 'decimal' | 'text' }) {
  const id = useId(), [v, setV] = useState(value ?? ''), editing = useRef(false);
  useEffect(() => { if (!editing.current) setV(value ?? ''); }, [value]);
  const commit = () => { editing.current = false; if (v !== (value ?? '')) onCommit(v); };
  return <div className={s.field}><label htmlFor={id}>{label}</label>
    <input id={id} type="text" value={v} placeholder={placeholder} inputMode={inputMode} onFocus={() => { editing.current = true; }} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></div>;
}
export const Section = ({ title, note, children, action }: { title?: ReactNode; note?: ReactNode; children?: ReactNode; action?: ReactNode }) => (
  <section className={s.section}>{title && <h3>{title}{action}</h3>}{children}{note && <p className={s.note}>{note}</p>}</section>
);
export const Row = ({ children }: { children: ReactNode }) => <div className={s.row}>{children}</div>;
export const Note = ({ children }: { children: ReactNode }) => <p className={s.note}>{children}</p>;
export const Badge = ({ children, k }: { children: ReactNode; k?: 'warn' | 'accent' }) => <i className={s.badge} data-k={k}>{children}</i>;

/** A change of song, as the pages show it: what was there slides out the way the queue went (on to the next: left;
 *  back: right; a jump: in place) and fades, the new one comes in from the other side. Keyed by `k`; the old content
 *  stays only for the moment it leaves. `fill`: the content fills the box (a cover). */
export function Swap({ k, dir, fill, className, children }: { k: string; dir: number; fill?: boolean; className?: string; children: React.ReactNode }) {
  const cur = useRef<{ k: string; n: React.ReactNode }>({ k, n: children }), prev = useRef<{ k: string; n: React.ReactNode } | null>(null), [, force] = useState(0);
  if (cur.current.k !== k) prev.current = cur.current;
  cur.current = { k, n: children };
  useEffect(() => { if (!prev.current) return; const tm = window.setTimeout(() => { prev.current = null; force(x => x + 1); }, 240); return () => clearTimeout(tm); }, [k]);
  return (
    <span data-swap data-fill={fill || undefined} className={className} style={{ ['--sd' as string]: dir }}>
      {prev.current && <span key={'o' + prev.current.k} data-swap-out aria-hidden="true">{prev.current.n}</span>}
      <span key={'i' + k} data-swap-in={prev.current ? true : undefined}>{children}</span>
    </span>
  );
}
export const Cover = memo(function Cover({ k, full, round, className, eager, radius }: { k: string | null | undefined; full?: boolean; round?: boolean; className?: string; eager?: boolean; radius?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [k]);
  return (
    <span className={s.cover + (className ? ' ' + className : '')} data-round={round || undefined} style={radius ? { ['--cover-r' as string]: radius } : undefined}>
      {k && !bad ? <img src={coverUrl(k, full)} alt="" loading={eager ? 'eager' : 'lazy'} decoding={eager ? 'sync' : 'async'} draggable={false} onError={() => setBad(true)} />
        : <span className={s.coverPh} aria-hidden="true"><Icon n="note" size={22} /></span>}
    </span>
  );
});
export function Mosaic({ keys, className }: { keys: (string | null)[]; className?: string }) {
  const u = [...new Set(keys.filter(Boolean))].slice(0, 4) as string[];
  if (u.length < 4) return <Cover k={u[0]} className={className} />;
  return <span className={s.cover + ' ' + s.mosaic + (className ? ' ' + className : '')}>{u.map(k => <img key={k} src={coverUrl(k)} alt="" loading="lazy" draggable={false} />)}</span>;
}
export function Empty({ title, help, icon = 'note', children }: { title: string; help?: string; icon?: string; children?: ReactNode }) {
  return <div className={s.empty}><div className={s.emptyArt} aria-hidden="true"><Icon n={icon} size={26} /></div><h2 className="display">{title}</h2>{help && <p>{help}</p>}{children}</div>;
}

/* ---------- the context menu (with submenus) and the toast ---------- */
export function ContextMenu() {
  const m = useStore(ui, x => x.menu), last = useRef(m); if (m) last.current = m;
  const { shown, closing } = usePresence(!!m), cur = m || last.current;
  if (!shown || !cur) return null;
  return <MenuList key={cur.x + ':' + cur.y} items={cur.items} at={{ x: cur.x, y: cur.y }} closing={closing} root />;
}
function MenuList({ items, at, closing, root, side, onEnter }: { items: (MenuItem | '-')[]; at: { x: number; y: number; w?: number }; closing?: boolean; root?: boolean; side?: number; onEnter?: () => void }) {
  const ref = useRef<HTMLDivElement>(null), [pos, setPos] = useState<CSSProperties | null>(null), [sub, setSub] = useState<{ i: number; x: number; y: number; w: number } | null>(null), subTm = useRef(0);
  const pict = ui.get().layer !== 'none';
  useLayoutEffect(() => { if (!ref.current) return; const r = ref.current.getBoundingClientRect();
    // (a submenu opens to the right of its item, or to the left where there is no room)
    let left = at.x, top = at.y, ox = 'left';
    if (side != null && left + r.width > innerWidth - 8) { left = side - r.width; ox = 'right'; }
    left = Math.max(8, Math.min(left, innerWidth - r.width - 8)); const oy = top + r.height > innerHeight - 8 ? 'bottom' : 'top'; top = Math.max(8, Math.min(top, innerHeight - r.height - 8));
    setPos({ left, top, transformOrigin: `${ox} ${oy}` }); }, [at.x, at.y]);
  useEffect(() => { if (!root) return; const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.('[data-menu]')) ui.set({ menu: null }); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); ui.set({ menu: null }); } };
    addEventListener('pointerdown', close, true); addEventListener('blur', close); addEventListener('keydown', key, true);
    return () => { removeEventListener('pointerdown', close, true); removeEventListener('blur', close); removeEventListener('keydown', key, true); }; }, []);
  const openSub = (i: number, el: HTMLElement) => { clearTimeout(subTm.current); const r = el.getBoundingClientRect(); setSub({ i, x: r.right + 2, y: r.top - 5, w: r.left - 2 }); };
  const node = (
    <div className={s.menu + ' glass' + (pict ? ' on-picture' : '')} ref={ref} role="menu" data-menu data-closing={closing || undefined} style={pos || { left: at.x, top: at.y, visibility: 'hidden' }}
      onPointerEnter={onEnter} onPointerLeave={() => { subTm.current = window.setTimeout(() => setSub(null), 260); }}>
      {items.map((it, i) => it === '-' ? <hr key={i} /> : (
        <button key={i} type="button" role="menuitem" data-danger={it.danger || undefined} disabled={it.disabled} aria-haspopup={it.sub ? 'menu' : undefined} aria-expanded={it.sub ? sub?.i === i : undefined}
          onPointerEnter={e => { if (it.sub) openSub(i, e.currentTarget); else { clearTimeout(subTm.current); subTm.current = window.setTimeout(() => setSub(null), 160); } }}
          onClick={e => { if (it.sub) { openSub(i, e.currentTarget); return; } ui.set({ menu: null }); it.run?.(); }}>
          {it.icon ? <Icon n={it.icon} size={16} /> : <i />}<span>{it.label}</span>{it.sub && <Icon n="chevronRight" size={14} />}
        </button>))}
    </div>
  );
  // (a submenu is the menu's sibling, not its child: a fixed box inside a scaling one would scale and move with it)
  const both = <>{node}{sub && (items[sub.i] as MenuItem)?.sub && <MenuList items={(items[sub.i] as MenuItem).sub!} at={{ x: sub.x, y: sub.y }} side={sub.w} closing={closing} onEnter={() => clearTimeout(subTm.current)} />}</>;
  return root ? createPortal(both, document.body) : both;
}
export function Toast() {
  const t = useStore(ui, x => x.toast), last = useRef(t); if (t) last.current = t;
  return <div className={s.toast + ' glass'} role="status" data-on={!!t}>{(t || last.current)?.text || ''}</div>;
}
export const unknownArtist = () => tx('s.unknownArtist');

/** A turn between views (pages, a library section, a detail): the old one fades out quickly, then the new one rises
 *  in — never both at once, never a cut. Keyed by `k`. */
export function Turn({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  const [cur, setCur] = useState(k), last = useRef<ReactNode>(children);
  useEffect(() => { if (k === cur) return; const tm = window.setTimeout(() => setCur(k), OUT_MS); return () => clearTimeout(tm); }, [k, cur]);
  // (while the old one leaves it shows as it last was; then the new one, live)
  const out = k !== cur; if (!out) last.current = children;
  return <div key={cur} className={s.turn + (className ? ' ' + className : '')} data-out={out || undefined}>{out ? last.current : children}</div>;
}
