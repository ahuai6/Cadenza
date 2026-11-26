// The dialogs both appearances open (the classic views and the space): one at a time, each opened through a function that
// resolves with its answer — a name, a yes or no, a song's information (edit, MusicBrainz tags, cover). An appearance
// adds dialogs of its own with `addDialogs` (views/Modals.tsx: playlists, MV, export, the play page's settings).
import { useEffect, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { Lib, type Track } from '../bridge';
import { ui, lib, useStore, toast } from '../state';
import { Button, IconButton, Seg, Cover, usePresence } from './kit';
import { canEdit, editTask, useEditing, useEditingDraft } from '../editing';
import { EditControls, EditModeButton } from './EditModeButton';
import s from './dialogs.module.css';

let resolver: ((v: unknown) => void) | null = null;
const editDialogs = new Set(['meta', 'mv', 'mvOffset']);
export function openDialog<T>(modal: { kind: string; [k: string]: unknown }): Promise<T | null> {
  if (editDialogs.has(modal.kind) && !canEdit()) return Promise.resolve(null);
  resolver?.(null);
  return new Promise((res) => {
    resolver = res as (v: unknown) => void;
    ui.set({ modal });
  });
}
export function closeDialog(v: unknown) {
  ui.set({ modal: null });
  const r = resolver;
  resolver = null;
  r?.(v);
}
const close = closeDialog;

export const askText = (title: string, label: string, value: string) =>
  openDialog<string>({ kind: 'text', title, label, value });
export const editMeta = (t: Track) => openDialog<boolean>({ kind: 'meta', id: t.id });
/** A yes or no to something that cannot be undone (`danger`: the yes button is red). */
export const askConfirm = (title: string, text: string, yes: string, danger = false) =>
  openDialog<boolean>({ kind: 'confirm', title, text, yes, danger });

type Body = (p: { m: any }) => React.ReactElement | null;
const BODIES: Record<string, Body> = {};
/** `busy`: while it says so, a press on the scrim leaves the dialog open (an export running) */
let busyCheck: () => boolean = () => false;
export function addDialogs(more: Record<string, Body>, busy?: () => boolean) {
  Object.assign(BODIES, more);
  if (busy) busyCheck = busy;
}

export function ModalHost() {
  const m = useStore(ui, (x) => x.modal),
    last = useRef(m),
    dialog = useRef<HTMLDivElement>(null);
  if (m) last.current = m;
  const { shown, closing } = usePresence(!!m),
    cur = m || last.current;
  useEffect(() => {
    if (!m && resolver) {
      const r = resolver;
      resolver = null;
      r(null);
    }
  }, [m]);
  useEffect(() => {
    const el = dialog.current;
    if (!m || !el) return;
    const origin = document.activeElement;
    const focus = requestAnimationFrame(() => {
      if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(focus);
      if (origin instanceof HTMLElement && origin.isConnected && !origin.closest('[inert]'))
        origin.focus({ preventScroll: true });
    };
  }, [m]);
  if (!shown || !cur) return null;
  const Body = BODIES[cur.kind];
  if (!Body) return null;
  return (
    // (closing: the dialog and its scrim fade out quickly, nothing taking clicks meanwhile)
    <div
      className={s.scrim + ' ' + (ui.get().layer !== 'none' ? 'on-picture' : '')}
      data-closing={closing || undefined}
      inert={closing}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busyCheck()) close(null);
      }}
    >
      <div
        data-test="modal"
        className={s.modal}
        role="dialog"
        aria-modal="true"
        data-kind={cur.kind}
        ref={dialog}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (!busyCheck()) close(null);
          }
          if (e.key !== 'Tab') return;
          const items = [
            ...e.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]'),
          ].filter((item) => !item.matches(':disabled') && item.tabIndex >= 0 && item.getClientRects().length);
          const index = items.indexOf(document.activeElement as HTMLElement);
          if (index < 0 || (e.shiftKey ? index === 0 : index === items.length - 1)) {
            e.preventDefault();
            items[e.shiftKey ? items.length - 1 : 0]?.focus();
          }
        }}
      >
        {editDialogs.has(cur.kind) ? <EditDialogBody Body={Body} m={cur} /> : <Body m={cur} />}
      </div>
    </div>
  );
}
function EditDialogBody({ Body, m }: { Body: Body; m: Record<string, unknown> }) {
  const editing = useEditing();
  return (
    <>
      <EditControls>
        <Body m={m} />
      </EditControls>
      {!editing && (
        <>
          <DialogHead title={tx('edit.mode')} />
          <p className={s.help}>{tx('edit.required')}</p>
          <EditModeButton />
        </>
      )}
    </>
  );
}
export const DialogHead = ({ title }: { title: string }) => (
  <header className={s.head}>
    <h2>{title}</h2>
    <IconButton n="close" size="sm" label={tx('s.close')} onClick={() => close(null)} />
  </header>
);

function ConfirmModal({ m }: { m: { title: string; text: string; yes: string; danger: boolean } }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <DialogHead title={m.title} />
      <p className={s.help}>{m.text}</p>
      <footer className={s.foot}>
        <Button kind="ghost" onClick={() => close(false)}>
          {tx('s.cancel')}
        </Button>
        <Button kind={m.danger ? 'danger' : 'primary'} autoFocus onClick={() => close(true)}>
          {m.yes}
        </Button>
      </footer>
    </div>
  );
}
function TextModal({ m }: { m: { title: string; label: string; value: string } }) {
  const [v, setV] = useState(m.value || ''),
    ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        close(v.trim());
      }}
      style={{ display: 'grid', gap: 14 }}
    >
      <DialogHead title={m.title} />
      <label className={s.field}>
        <span>{m.label}</span>
        <input ref={ref} type="text" value={v} onChange={(e) => setV(e.target.value)} maxLength={80} />
      </label>
      <footer className={s.foot}>
        <Button kind="ghost" onClick={() => close(null)}>
          {tx('s.cancel')}
        </Button>
        <Button kind="primary" type="submit">
          {tx('s.done')}
        </Button>
      </footer>
    </form>
  );
}

// Edits and cover overrides use the local library.
function MetaModal({ m }: { m: { id: string; tab?: string } }) {
  const t = useStore(lib, (x) => x.tracks.find((y) => y.id === m.id)),
    [tab, setTab] = useState(m.tab === 'cover' ? 'cover' : 'edit');
  if (!t) return null;
  return (
    <>
      <DialogHead title={tx('s.meta')} />
      <div className={s.top}>
        <Cover k={t.cover} />
        <div>
          <b>{t.title}</b>
          <small>{[t.artist, t.album].filter(Boolean).join(' — ') || t.file}</small>
        </div>
        <Seg
          size="sm"
          fit
          role="tablist"
          value={tab}
          onChange={setTab}
          options={[
            ['edit', tx('s.meta.edit'), 'lyrics'],
            ['cover', tx('s.meta.cover'), 'image'],
          ]}
        />
      </div>
      {tab === 'edit' && <EditTab key={t.id} t={t} />}
      {tab === 'cover' && <CoverTab t={t} />}
    </>
  );
}
const FIELDS: [keyof Track['tags'], string, number][] = [
  ['title', 's.col.title', 2],
  ['artist', 's.f.artist', 1],
  ['album', 's.col.album', 1],
  ['albumArtist', 's.f.albumArtist', 1],
  ['genre', 's.f.genre', 1],
  ['year', 's.f.year', 0],
  ['track', 's.f.track', 0],
  ['disc', 's.f.disc', 0],
];
const asText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));
function EditTab({ t }: { t: Track }) {
  const [f, setF, clearDraft] = useEditingDraft(
    'meta:' + t.id,
    () => Object.fromEntries(FIELDS.map(([k]) => [k, asText(t[k])])) as Record<string, string>,
  );
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit() || busy) return;
    setBusy(true);
    const saved = await editTask(() => Lib!.editMeta(t.id, f)).catch(() => false);
    setBusy(false);
    if (!saved) {
      toast(tx('edit.saveFailed'));
      return;
    }
    clearDraft(f);
    toast(tx('s.meta.saved'));
    close(true);
  };
  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <div className={s.grid}>
        {FIELDS.map(([k, label, w]) => (
          <label key={k} className={s.field} data-w={w}>
            <span>{tx(label)}</span>
            <input
              type={k === 'year' || k === 'track' || k === 'disc' ? 'number' : 'text'}
              min="0"
              value={f[k]}
              placeholder={asText(t.tags && t.tags[k])}
              onChange={(e) => setF({ ...f, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <p className={s.help}>{tx('s.meta.editHelp')}</p>
      <footer className={s.foot}>
        {t.edited && (
          <Button
            kind="ghost"
            onClick={async () => {
              if (!canEdit() || !(await editTask(() => Lib!.clearMeta(t.id, 'tags')))) return;
              clearDraft();
              toast(tx('s.meta.restored'));
              close(true);
            }}
          >
            {tx('s.lookupReset')}
          </Button>
        )}
        <span className="grow" />
        <Button
          kind="ghost"
          onClick={() => {
            clearDraft();
            close(null);
          }}
        >
          {tx('s.cancel')}
        </Button>
        <Button kind="primary" type="submit" disabled={busy}>
          {tx('s.save')}
        </Button>
      </footer>
    </form>
  );
}
function CoverTab({ t }: { t: Track }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function setCover(how: { file?: boolean; reset?: boolean }) {
    if (!canEdit() || busy) return;
    setBusy(true);
    setError(false);
    try {
      if (await editTask(() => Lib!.setCover(t.id, how))) {
        toast(tx('s.meta.coverSet'));
        close(true);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className={s.help}>
          {tx('edit.saveFailed')}
        </p>
      )}
      <footer className={s.foot}>
        {t.coverSet && (
          <Button kind="ghost" disabled={busy} onClick={() => void setCover({ reset: true })}>
            {tx('s.meta.resetCover')}
          </Button>
        )}
        <span className="grow" />
        <Button icon="folder" disabled={busy} onClick={() => void setCover({ file: true })}>
          {tx('s.meta.fromFile')}
        </Button>
      </footer>
    </>
  );
}
Object.assign(BODIES, { text: TextModal, confirm: ConfirmModal, meta: MetaModal } as Record<string, Body>);
