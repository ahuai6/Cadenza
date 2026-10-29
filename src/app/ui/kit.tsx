// The interface's building blocks: buttons, segmented controls, switches, checkboxes, sliders, fields, covers.
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './icons';
import { coverUrl } from '../bridge';
import { tx } from '../../i18n';
import { ui, useStore } from '../state';
import s from './kit.module.css';
export { s as kit };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'lg'; glass?: boolean; icon?: string };
export function Button({ kind, size, glass, icon, children, className, ...rest }: BtnProps) {
  return <button type="button" className={s.btn + (className ? ' ' + className : '')} data-kind={kind} data-size={size} data-glass={glass || undefined} {...rest}>
    {icon && <Icon n={icon} size={size === 'sm' ? 15 : 17} />}{children}</button>;
}
type IbProps = ButtonHTMLAttributes<HTMLButtonElement> & { n: string; label: string; size?: 'sm' | 'lg' | 'xl'; iconSize?: number; glass?: boolean; solid?: boolean; pressed?: boolean; on?: boolean; filled?: boolean; count?: number };
/** An icon button: its label is its tooltip and its accessible name. */
export function IconButton({ n, label, size, iconSize, glass, solid, pressed, on, filled, count, className, ...rest }: IbProps) {
  const isz = iconSize ?? (size === 'xl' ? 28 : size === 'lg' ? 22 : size === 'sm' ? 16 : 18);
  return <button type="button" className={s.ib + (className ? ' ' + className : '')} data-size={size} data-glass={glass || undefined} data-solid={solid || undefined}
    data-on={on ? 'true' : undefined} aria-pressed={pressed} title={label} aria-label={label} {...rest}>
    <Icon n={n} size={isz} filled={filled} />{count != null && count > 1 && <i className={s.badgeN}>{count > 99 ? '99+' : count}</i>}</button>;
}

export function Seg<T extends string | number>({ value, options, onChange, size, fit, label, role = 'radiogroup' }: { value: T; options: [T, string, string?, string?][]; onChange: (v: T) => void; size?: 'sm'; fit?: boolean; label?: string; role?: 'radiogroup' | 'tablist' }) {
  const item = role === 'tablist' ? 'tab' : 'radio';
  return (
    <div className={s.seg} data-size={size} data-fit={fit || undefined} role={role} aria-label={label}>
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
export function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  const id = useId();
  return <div className={s.field}><label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>{options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>;
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
export const Eq = () => <span className={s.eq} aria-hidden="true"><i /><i /><i /></span>;

/** A change of song, as the pages show it: what was there slides out the way the queue went (on to the next: left;
 *  back: right; a jump: in place) and fades, the new one comes in from the other side. Keyed by `k`; the old content
 *  stays only for the moment it leaves. `fill`: the content fills the box (a cover). */
export function Swap({ k, dir, fill, className, children }: { k: string; dir: number; fill?: boolean; className?: string; children: React.ReactNode }) {
  const cur = useRef<{ k: string; n: React.ReactNode }>({ k, n: children }), prev = useRef<{ k: string; n: React.ReactNode } | null>(null), [, force] = useState(0);
  if (cur.current.k !== k) prev.current = cur.current;
  cur.current = { k, n: children };
  useEffect(() => { if (!prev.current) return; const tm = window.setTimeout(() => { prev.current = null; force(x => x + 1); }, 300); return () => clearTimeout(tm); }, [k]);
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
  return <div className={s.empty}><div className={s.emptyArt} aria-hidden="true"><Icon n={icon} size={30} /></div><h2>{title}</h2>{help && <p>{help}</p>}{children}</div>;
}

/* ---------- the context menu and the toast ---------- */
export function ContextMenu() {
  const m = useStore(ui, x => x.menu), ref = useRef<HTMLDivElement>(null), [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => { if (!m || !ref.current) { setPos(null); return; } const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(m.x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(m.y, innerHeight - r.height - 8)) }); }, [m]);
  useEffect(() => { if (!m) return; const close = (e: Event) => { if (!ref.current || !ref.current.contains(e.target as Node)) ui.set({ menu: null }); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); ui.set({ menu: null }); } };
    addEventListener('pointerdown', close, true); addEventListener('blur', close); addEventListener('keydown', key, true);
    return () => { removeEventListener('pointerdown', close, true); removeEventListener('blur', close); removeEventListener('keydown', key, true); }; }, [m]);
  if (!m) return null;
  return (
    <div className={s.menu + ' glass'} ref={ref} role="menu" style={pos || { left: m.x, top: m.y, visibility: 'hidden' }}>
      {m.items.map((it, i) => it === '-' ? <hr key={i} /> : (
        <button key={i} type="button" role="menuitem" data-danger={it.danger || undefined} disabled={it.disabled} onClick={() => { ui.set({ menu: null }); it.run(); }}>
          {it.icon && <Icon n={it.icon} size={16} />}<span>{it.label}</span>
        </button>))}
    </div>
  );
}
export function Toast() { const t = useStore(ui, x => x.toast); return <div className={s.toast + ' glass'} role="status" data-on={!!t}>{t ? t.text : ''}</div>; }
export const unknownArtist = () => tx('s.unknownArtist');
