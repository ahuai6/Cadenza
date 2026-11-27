// The interface's building blocks: buttons, segmented controls, switches, checkboxes, sliders, dropdowns, fields,
// covers, and the floating things (context menu with its submenus, toast). Everything that opens also closes with a
// short fade (usePresence), so nothing ever vanishes in one frame.
import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { coverUrl } from '../bridge';
import { tx } from '../../i18n';
import { ui, useStore, type MenuItem } from '../state';
import { duration } from '../motion';
import s from './kit.module.css';
export { s as kit };

/** How long a thing takes to leave (--t-out): it stays mounted that long, marked closing. */
/** A label with a long note in brackets at its end ("懸停（鏡頭停在歌詞中間，帶圓舞般的弧線移動）"): the label alone,
 *  the note shown when the pointer rests on it — a settings list read as names, not as sentences. A short bracket
 *  ("下載（約 40 MB）") stays where it is. */
export function splitNote(label: string): [string, string] {
  const m = /^(.+?)\s*[（(]([^（）()]+)[）)]\s*$/.exec(label);
  // (long: seven characters or more, spaces not counted)
  return m && m[2].replace(/\s/g, '').length >= 7 ? [m[1], m[2]] : [label, ''];
}
/** Keep the visual surface mounted for its shared exit time. */
export function usePresence(open: boolean, ms?: number | '--t-med') {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    if (!shown) return;
    const tm = window.setTimeout(() => setShown(false), typeof ms === 'number' ? ms : duration(ms ?? '--t-out'));
    return () => clearTimeout(tm);
  }, [open, shown, ms]);
  return { shown: shown || open, closing: shown && !open };
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'ghost' | 'danger' | 'quiet';
  size?: 'sm' | 'lg';
  glass?: boolean;
  icon?: string;
};
export function Button({ kind, size, glass, icon, children, className, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      data-feedback=""
      className={s.btn + (className ? ' ' + className : '')}
      data-kind={kind}
      data-size={size}
      data-glass={glass || undefined}
      {...rest}
    >
      {icon && <Icon n={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
    </button>
  );
}
type IbProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  n: string;
  label: string;
  size?: 'sm' | 'lg' | 'xl';
  iconSize?: number;
  glass?: boolean;
  solid?: boolean;
  pressed?: boolean;
  on?: boolean;
  filled?: boolean;
  count?: number;
};
/** An icon button: its label is its tooltip and its accessible name. */
export function IconButton({
  n,
  label,
  size,
  iconSize,
  glass,
  solid,
  pressed,
  on,
  filled,
  count,
  className,
  ...rest
}: IbProps) {
  const isz = iconSize ?? (size === 'xl' ? 26 : size === 'lg' ? 21 : size === 'sm' ? 16 : 18);
  return (
    <button
      type="button"
      data-feedback=""
      className={s.ib + (className ? ' ' + className : '')}
      data-size={size}
      data-glass={glass || undefined}
      data-solid={solid || undefined}
      data-on={on ? 'true' : undefined}
      aria-pressed={pressed}
      title={label}
      aria-label={label}
      {...rest}
    >
      <Icon n={n} size={isz} filled={filled} />
      {count != null && count > 1 && <i className={s.badgeN}>{count > 99 ? '99+' : count}</i>}
    </button>
  );
}

/** A segmented control. The chosen segment's mark slides to it (one element moved, never two cross-fading). */
export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  size,
  fit,
  label,
  role = 'radiogroup',
}: {
  value: T;
  options: [T, string, string?, string?][];
  onChange: (v: T) => void;
  size?: 'sm';
  fit?: boolean;
  label?: string;
  role?: 'radiogroup' | 'tablist';
}) {
  const item = role === 'tablist' ? 'tab' : 'radio',
    box = useRef<HTMLDivElement>(null),
    [mark, setMark] = useState<CSSProperties | null>(null),
    first = useRef(true);
  useLayoutEffect(() => {
    const place = () => {
      const el = box.current?.querySelector<HTMLElement>('[aria-checked="true"],[aria-selected="true"]');
      if (!el) {
        setMark(null);
        return;
      }
      setMark({
        width: el.offsetWidth,
        height: el.offsetHeight,
        transform: `translate(${el.offsetLeft}px, ${el.offsetTop}px)`,
        transition: first.current ? 'none' : undefined,
      });
      first.current = false;
    };
    place();
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div className={s.seg} ref={box} data-size={size} data-fit={fit || undefined} role={role} aria-label={label}>
      {mark && <i className={s.segMark} style={mark} aria-hidden="true" />}
      {options.map(([v, full, ic, tip0]) => {
        const [text, note] = splitNote(full),
          tip = tip0 || note;
        return (
          <button
            key={String(v)}
            type="button"
            role={item}
            aria-selected={item === 'tab' ? value === v : undefined}
            aria-checked={item === 'radio' ? value === v : undefined}
            title={tip ? (note && !tip0 ? `${text}：${note}` : tip) : text}
            aria-label={tip0 || undefined}
            onClick={() => onChange(v)}
          >
            {ic && <Icon n={ic} size={size === 'sm' ? 14 : 15} />}
            {text && <span>{text}</span>}
          </button>
        );
      })}
    </div>
  );
}
export function Toggle({
  label,
  help,
  on,
  set,
}: {
  label: string;
  help?: string;
  on: boolean;
  set: (v: boolean) => void;
}) {
  return (
    <label className={s.toggle}>
      <span>
        <b title={splitNote(label)[1] || undefined}>{splitNote(label)[0]}</b>
        {help && <small>{help}</small>}
      </span>
      <input type="checkbox" role="switch" checked={!!on} onChange={(e) => set(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}
export function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={s.check}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true">
        <Icon n="check" size={13} />
      </i>
      <span title={splitNote(label)[1] || undefined}>{splitNote(label)[0]}</span>
    </label>
  );
}
/** A slider. onChange: at every step while it is dragged (what can follow it live); onCommit: once it is let go (a
 *  release, a key's step) — what costs a rebuild goes there, so dragging never rebuilds at every step. While dragged it
 *  shows its own value, whatever the caller has taken of it so far. */
/** home: the value the slider means "as it comes" (a knob's 1.00×): marked on the track, and the value shown in the
 *  accent once it is moved off it. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  format,
  home,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  format?: (v: number) => string;
  home?: number;
}) {
  const id = useId(),
    [draft, setDraft] = useState<number | null>(null),
    v = draft ?? value ?? min,
    p = ((v - min) / Math.max(1e-9, max - min)) * 100;
  const hp = home == null ? null : (home - min) / Math.max(1e-9, max - min),
    off = home != null && Math.abs(v - home) > step / 2;
  const el = useRef<HTMLInputElement>(null),
    commit = useRef(onCommit);
  commit.current = onCommit;
  // (the input's own 'change': fired once the thumb is let go, or a key has stepped it — never during a drag)
  useEffect(() => {
    const i = el.current;
    if (!i) return;
    const h = () => {
      commit.current?.(+i.value);
      setDraft(null);
    };
    i.addEventListener('change', h);
    return () => i.removeEventListener('change', h);
  }, []);
  return (
    <div className={s.slider} data-off={off || undefined}>
      <label htmlFor={id} title={splitNote(label)[1] || label}>
        {splitNote(label)[0]}
      </label>
      <span className={s.rw}>
        {hp != null && (
          <i className={s.home} style={{ left: `calc(7px + (100% - 14px) * ${hp.toFixed(4)})` }} aria-hidden="true" />
        )}
        <input
          id={id}
          ref={el}
          className={s.range}
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          style={{ ['--p' as string]: `${p}%` }}
          onChange={(e) => {
            const x = +e.target.value;
            setDraft(x);
            onChange?.(x);
          }}
        />
      </span>
      <output htmlFor={id}>{format ? format(v) : (+v).toFixed(2)}</output>
    </div>
  );
}

/* ---------- the dropdown: one look for every choice from a list (the system's own list never shows) ---------- */
/** [value, label, the style its label is shown in (a font's own face), a note under it] */
export type Opt = [string, string, CSSProperties?, string?];
export function Dropdown({
  value,
  options,
  onChange,
  label,
  id,
  className,
  wide,
}: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  label?: string;
  id?: string;
  className?: string;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false),
    btn = useRef<HTMLButtonElement>(null),
    cur = options.find((o) => o[0] === value) || options[0];
  return (
    <>
      <button
        type="button"
        id={id}
        ref={btn}
        className={s.dd + (className ? ' ' + className : '')}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span style={cur?.[2]} title={cur ? splitNote(cur[1])[1] || undefined : undefined}>
          {cur ? splitNote(cur[1])[0] : ''}
        </span>
        <Icon n="chevronDown" size={14} />
      </button>
      <DropList
        open={open}
        anchor={btn}
        options={options}
        value={value}
        wide={wide}
        onPick={(v) => {
          setOpen(false);
          if (v !== value) onChange(v);
          btn.current?.focus();
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
function DropList({
  open,
  anchor,
  options,
  value,
  onPick,
  onClose,
  wide,
}: {
  open: boolean;
  anchor: React.RefObject<HTMLElement | null>;
  options: Opt[];
  value: string;
  onPick: (v: string) => void;
  onClose: () => void;
  wide?: boolean;
}) {
  const { shown, closing } = usePresence(open),
    box = useRef<HTMLDivElement>(null),
    [pos, setPos] = useState<CSSProperties | null>(null),
    [hi, setHi] = useState(-1);
  const pict = !!anchor.current?.closest('.on-picture');
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const a = anchor.current.getBoundingClientRect(),
      H = Math.min(360, options.length * 34 + 10);
    const chrome = anchor.current.closest('.space-root')?.querySelector('.hud.top');
    const top = (chrome?.getBoundingClientRect().bottom || 0) + 8;
    const roomAbove = a.top - top - 6,
      roomBelow = innerHeight - a.bottom - 14,
      below = roomBelow >= H || roomBelow >= roomAbove,
      w = Math.min(innerWidth - 16, Math.max(a.width, wide ? 260 : 0));
    setPos({
      left: Math.max(8, Math.min(a.left, innerWidth - w - 8)),
      width: w,
      ...(below
        ? { top: a.bottom + 6, transformOrigin: 'top' }
        : { bottom: innerHeight - a.top + 6, transformOrigin: 'bottom' }),
      maxHeight: Math.min(H, Math.max(0, below ? roomBelow : roomAbove)),
    });
    setHi(
      Math.max(
        0,
        options.findIndex((o) => o[0] === value),
      ),
    );
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const sel = box.current?.querySelector('[aria-selected="true"]');
    sel?.scrollIntoView({ block: 'nearest' });
  }, [open, pos]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        anchor.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        setHi((i) => {
          if (options[i]) onPick(options[i][0]);
          return i;
        });
      } else if (e.key === 'Tab') onClose();
    };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', key, true);
    addEventListener('blur', onClose);
    return () => {
      removeEventListener('pointerdown', away, true);
      removeEventListener('keydown', key, true);
      removeEventListener('blur', onClose);
    };
  }, [open, options]);
  useEffect(() => {
    box.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);
  if (!shown || !pos) return null;
  return createPortal(
    <div
      ref={box}
      className={s.drop + ' glass' + (pict ? ' on-picture' : '')}
      data-mosaic=""
      data-pop=""
      role="listbox"
      data-closing={closing || undefined}
      style={pos}
    >
      {options.map(([v, l, st, note], i) => (
        <div
          key={v}
          role="option"
          data-i={i}
          aria-selected={v === value}
          data-hi={i === hi || undefined}
          onPointerEnter={() => setHi(i)}
          onClick={() => onPick(v)}
        >
          <span style={st} title={splitNote(l)[1] || undefined}>
            {splitNote(l)[0]}
          </span>
          {note && <small>{note}</small>}
          {v === value && <Icon n="check" size={14} />}
        </div>
      ))}
    </div>,
    document.body,
  );
}
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: (Opt | [string, string])[];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className={s.field}>
      <label htmlFor={id}>{label}</label>
      <Dropdown id={id} label={label} value={value} options={options as Opt[]} onChange={onChange} />
    </div>
  );
}
/** A text field that commits on blur or Enter and follows outside changes while it is not being edited. */
export function TextField({
  label,
  value,
  onCommit,
  placeholder,
  inputMode,
  onInputChange,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  inputMode?: 'decimal' | 'text';
  onInputChange?: (v: string) => void;
}) {
  const id = useId(),
    [v, setV] = useState(value ?? ''),
    editing = useRef(false),
    startingValue = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!editing.current) setV(value ?? '');
  }, [value]);
  const commit = () => {
    editing.current = false;
    if (v !== (startingValue.current ?? value ?? '')) onCommit(v);
    startingValue.current = undefined;
  };
  return (
    <div className={s.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={v}
        placeholder={placeholder}
        inputMode={inputMode}
        onFocus={() => {
          editing.current = true;
          startingValue.current = v;
        }}
        onChange={(e) => {
          setV(e.target.value);
          onInputChange?.(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
export const Section = ({
  title,
  note,
  children,
  action,
}: {
  title?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) => (
  <section className={s.section}>
    {title && (
      <h3>
        {title}
        {action}
      </h3>
    )}
    {children}
    {note && <p className={s.note}>{note}</p>}
  </section>
);
export const Row = ({ children }: { children: ReactNode }) => <div className={s.row}>{children}</div>;
export const Note = ({ children }: { children: ReactNode }) => <p className={s.note}>{children}</p>;
export const Badge = ({ children, k }: { children: ReactNode; k?: 'warn' | 'accent' }) => (
  <i className={s.badge} data-k={k}>
    {children}
  </i>
);

/** A change of song, as the pages show it: what was there slides out the way the queue went (on to the next: left;
 *  back: right; a jump: in place) and fades, the new one comes in from the other side. Keyed by `k`; the old content
 *  stays only for the moment it leaves. `fill`: the content fills the box (a cover). */
export function Swap({
  k,
  dir,
  fill,
  className,
  children,
}: {
  k: string;
  dir: number;
  fill?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const cur = useRef<{ k: string; n: React.ReactNode }>({ k, n: children }),
    prev = useRef<{ k: string; n: React.ReactNode } | null>(null),
    [, force] = useState(0);
  if (cur.current.k !== k) prev.current = cur.current;
  cur.current = { k, n: children };
  useEffect(() => {
    if (!prev.current) return;
    const tm = window.setTimeout(() => {
      prev.current = null;
      force((x) => x + 1);
    }, 240);
    return () => clearTimeout(tm);
  }, [k]);
  return (
    <span data-swap data-fill={fill || undefined} className={className} style={{ ['--sd' as string]: dir }}>
      {prev.current && (
        <span key={'o' + prev.current.k} data-swap-out aria-hidden="true">
          {prev.current.n}
        </span>
      )}
      <span key={'i' + k} data-swap-in={prev.current ? true : undefined}>
        {children}
      </span>
    </span>
  );
}
export const Cover = memo(function Cover({
  k,
  full,
  round,
  className,
  eager,
  radius,
}: {
  k: string | null | undefined;
  full?: boolean;
  round?: boolean;
  className?: string;
  eager?: boolean;
  radius?: string;
}) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [k]);
  return (
    <span
      className={s.cover + (className ? ' ' + className : '')}
      data-round={round || undefined}
      style={radius ? { ['--cover-r' as string]: radius } : undefined}
    >
      {k && !bad ? (
        <img
          src={coverUrl(k, full)}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding={eager ? 'sync' : 'async'}
          draggable={false}
          onError={() => setBad(true)}
        />
      ) : (
        <span className={s.coverPh} aria-hidden="true">
          <Icon n="note" size={22} />
        </span>
      )}
    </span>
  );
});
export function Mosaic({ keys, className }: { keys: (string | null)[]; className?: string }) {
  const u = [...new Set(keys.filter(Boolean))].slice(0, 4) as string[];
  if (u.length < 4) return <Cover k={u[0]} className={className} />;
  return (
    <span className={s.cover + ' ' + s.mosaic + (className ? ' ' + className : '')}>
      {u.map((k) => (
        <img key={k} src={coverUrl(k)} alt="" loading="lazy" draggable={false} />
      ))}
    </span>
  );
}
export function Empty({
  title,
  help,
  icon = 'note',
  children,
}: {
  title: string;
  help?: string;
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <div className={s.emptyArt} aria-hidden="true">
        <Icon n={icon} size={26} />
      </div>
      <h2 className="display">{title}</h2>
      {help && <p>{help}</p>}
      {children}
    </div>
  );
}

/* ---------- the context menu (with submenus) and the toast ---------- */
export function ContextMenu() {
  const m = useStore(ui, (x) => x.menu),
    last = useRef(m);
  if (m) last.current = m;
  const { shown, closing } = usePresence(!!m),
    cur = m || last.current;
  if (!shown || !cur) return null;
  return <MenuList key={cur.x + ':' + cur.y} items={cur.items} at={{ x: cur.x, y: cur.y }} closing={closing} root />;
}
function MenuList({
  items,
  at,
  closing,
  root,
  side,
  onEnter,
  focusOnOpen,
}: {
  items: (MenuItem | '-')[];
  at: { x: number; y: number; w?: number };
  closing?: boolean;
  root?: boolean;
  side?: number;
  onEnter?: () => void;
  focusOnOpen?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [pos, setPos] = useState<CSSProperties | null>(null),
    [sub, setSub] = useState<{ i: number; x: number; y: number; w: number } | null>(null),
    subTm = useRef(0);
  const lastSub = useRef(sub);
  if (sub) lastSub.current = sub;
  const subPresence = usePresence(!!sub && !closing);
  const shownSub = sub || lastSub.current;
  const focusChild = useRef(false);
  const pict = ui.get().layer !== 'none';
  useLayoutEffect(() => {
    if (!ref.current) return;
    const { offsetWidth: width, offsetHeight: height } = ref.current;
    // (a submenu opens to the right of its item, or to the left where there is no room)
    let left = at.x,
      top = at.y,
      ox = 'left';
    if (side != null && left + width > innerWidth - 8) {
      left = side - width;
      ox = 'right';
    }
    left = Math.max(8, Math.min(left, innerWidth - width - 8));
    const oy = top + height > innerHeight - 8 ? 'bottom' : 'top';
    top = Math.max(8, Math.min(top, innerHeight - height - 8));
    setPos({ left, top, transformOrigin: `${ox} ${oy}` });
  }, [at.x, at.y]);
  useEffect(() => {
    if (!root || closing) return;
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.('[data-menu]')) ui.set({ menu: null });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        ui.set({ menu: null });
      }
    };
    addEventListener('pointerdown', close, true);
    addEventListener('blur', close);
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('pointerdown', close, true);
      removeEventListener('blur', close);
      removeEventListener('keydown', key, true);
    };
  }, [root, closing]);
  useEffect(() => () => clearTimeout(subTm.current), []);
  useEffect(() => {
    if (pos && focusOnOpen && !closing) ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [pos, focusOnOpen, closing]);
  const openSub = (i: number, el: HTMLElement) => {
    clearTimeout(subTm.current);
    const r = el.getBoundingClientRect();
    setSub({ i, x: r.right + 2, y: r.top - 5, w: r.left - 2 });
  };
  const node = (
    <div
      className={s.menu + ' glass' + (pict ? ' on-picture' : '')}
      data-mosaic=""
      data-pop=""
      ref={ref}
      role="menu"
      data-menu
      data-closing={closing || undefined}
      inert={closing}
      style={pos || { left: at.x, top: at.y, visibility: 'hidden' }}
      onPointerEnter={onEnter}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse' || ref.current?.contains(document.activeElement)) return;
        clearTimeout(subTm.current);
        subTm.current = window.setTimeout(() => setSub(null), 260);
      }}
      onKeyDown={(e) => {
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      }}
    >
      {items.map((it, i) =>
        it === '-' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            data-danger={it.danger || undefined}
            disabled={it.disabled}
            data-feedback=""
            aria-haspopup={it.sub ? 'menu' : undefined}
            aria-expanded={it.sub ? sub?.i === i : undefined}
            onPointerEnter={(e) => {
              if (e.pointerType !== 'mouse') return;
              focusChild.current = false;
              if (it.sub) openSub(i, e.currentTarget);
              else {
                clearTimeout(subTm.current);
                subTm.current = window.setTimeout(() => setSub(null), 160);
              }
            }}
            onClick={(e) => {
              if (it.sub) {
                focusChild.current = e.detail === 0;
                if (!focusChild.current && sub?.i === i && !matchMedia('(hover: hover)').matches) setSub(null);
                else openSub(i, e.currentTarget);
                return;
              }
              ui.set({ menu: null });
              it.run?.();
            }}
          >
            {it.icon ? <Icon n={it.icon} size={16} /> : <i />}
            <span>{it.label}</span>
            {it.sub && <Icon n="chevronRight" size={14} />}
          </button>
        ),
      )}
    </div>
  );
  // (a submenu is the menu's sibling, not its child: a fixed box inside a scaling one would scale and move with it)
  const both = (
    <>
      {node}
      {subPresence.shown && shownSub && (items[shownSub.i] as MenuItem)?.sub && (
        <MenuList
          key={shownSub.i}
          items={(items[shownSub.i] as MenuItem).sub!}
          at={{ x: shownSub.x, y: shownSub.y }}
          side={shownSub.w}
          closing={closing || subPresence.closing}
          focusOnOpen={focusChild.current}
          onEnter={() => clearTimeout(subTm.current)}
        />
      )}
    </>
  );
  return root ? createPortal(both, document.body) : both;
}
export function Toast() {
  const t = useStore(ui, (x) => x.toast),
    last = useRef(t);
  if (t) last.current = t;
  return (
    <div className={s.toast + ' glass'} role="status" data-on={!!t}>
      {(t || last.current)?.text || ''}
    </div>
  );
}
export const unknownArtist = () => tx('s.unknownArtist');

/** Fade out the current page before replacing it. Navigation can change the pending destination during that fade. */
export function Turn({
  k,
  children,
  className,
  boxClassName,
}: {
  k: string;
  children: ReactNode;
  className?: string;
  boxClassName?: string;
}) {
  const [current, setCurrent] = useState({ key: k, entered: false });
  const last = useRef(children);
  const destination = useRef(k);
  const leaving = k !== current.key;
  useLayoutEffect(() => {
    destination.current = k;
    if (!leaving) last.current = children;
  });
  useLayoutEffect(() => {
    if (!leaving) return;
    const swap = () => setCurrent({ key: destination.current, entered: true });
    const ms = duration('--t-out');
    if (!ms) return swap();
    const timer = window.setTimeout(swap, ms + 48);
    return () => clearTimeout(timer);
  }, [leaving]);
  const cls = s.turn + (className ? ' ' + className : '');
  return (
    <div className={s.turnBox + (boxClassName ? ' ' + boxClassName : '')}>
      <div
        key={current.key}
        className={cls}
        data-turn={leaving ? 'out' : 'in'}
        data-enter={current.entered || undefined}
        aria-hidden={leaving || undefined}
        inert={leaving}
        onTransitionEnd={(e) => {
          if (leaving && e.target === e.currentTarget && e.propertyName === 'opacity')
            setCurrent({ key: destination.current, entered: true });
        }}
      >
        {leaving ? last.current : children}
      </div>
    </div>
  );
}
