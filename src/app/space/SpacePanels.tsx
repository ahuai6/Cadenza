// The space's player bar, completed: the lyric list (the same list the classic effect lyrics open), the play queue and
// the play mode, as the classic player card has them. The buttons live in the HUD's player card (a portal into it); the
// lists open as glass cards above it.
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { tx } from '../../i18n';
import { useStore, trackOf, lib, toast, ui } from '../state';
import { Lib, D } from '../bridge';
import { Icon } from '../ui/icons';
import { Seg, Cover } from '../ui/kit';
import { NpLyrics } from '../ui/NpLyrics';
import {
  player,
  setMode,
  MODES,
  MODE_ICON,
  playQueueAt,
  removeFromQueue,
  clearQueue,
  useLyrics,
  type Mode,
} from '../playback/player';
import { ts } from './i18n';
import s from './SpacePanels.module.css';

export type Panel = 'lyrics' | 'queue' | null;

/** The three buttons, placed into the HUD's player card. */
export function PlayerExtras({
  host,
  panel,
  setPanel,
}: {
  host: HTMLElement | null;
  panel: Panel;
  setPanel: (p: Panel) => void;
}) {
  const mode = useStore(player, (x) => x.mode),
    hasSong = useStore(player, (x) => !!x.id);
  if (!host) return null;
  const btn = (n: string, label: string, on: boolean, f: () => void, dis = false) => (
    <button
      type="button"
      className={'btn ' + s.ib}
      aria-pressed={on}
      title={label}
      aria-label={label}
      onClick={f}
      disabled={dis}
    >
      <Icon n={n} size={18} />
    </button>
  );
  return createPortal(
    <>
      {btn(
        'quote',
        tx('s.lyricList'),
        panel === 'lyrics',
        () => setPanel(panel === 'lyrics' ? null : 'lyrics'),
        !hasSong,
      )}
      {btn('queue', tx('s.queue'), panel === 'queue', () => setPanel(panel === 'queue' ? null : 'queue'))}
      {btn(MODE_ICON[mode], tx('s.mode.' + mode), mode !== 'stop', () =>
        setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]),
      )}
    </>,
    host,
  );
}

/** The window's own buttons (the window has no frame): minimise, maximise or restore, full screen, close. */
export function WinButtons({ host }: { host: HTMLElement | null }) {
  const st = useStore(ui, (x) => x.win);
  if (!host || !D) return null;
  const b = (n: string, label: string, op: 'min' | 'max' | 'full' | 'close', close = false) => (
    <button
      type="button"
      className={s.wb + (close ? ' ' + s.wclose : '')}
      title={label}
      aria-label={label}
      onClick={() => D?.win(op)}
    >
      <Icon n={n} size={15} />
    </button>
  );
  return createPortal(
    <>
      {!st.full && b('min', tx('s.min'), 'min')}
      {!st.full && b(st.max ? 'restore' : 'max', tx(st.max ? 's.restore' : 's.max'), 'max')}
      {b(st.full ? 'unfull' : 'full', tx(st.full ? 's.unfullscreen' : 's.fullscreen'), 'full')}
      {b('close', tx('s.quit'), 'close', true)}
    </>,
    host,
  );
}

/** The open list: the lyrics (scrolling with the song; a line clicked plays from it), or the queue. */
export function SpacePanel({ panel, onClose }: { panel: Panel; onClose: () => void }) {
  const session = useStore(player, (x) => x.session),
    hasLyrics = useStore(player, (x) => x.hasLyrics),
    shownId = useStore(player, (x) => x.shownId || x.id);
  useEffect(() => {
    if (!panel) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [panel, onClose]);
  if (panel === 'lyrics')
    return <Lyrics key={shownId || ''} onClose={onClose} hasLyrics={hasLyrics} session={session} shownId={shownId} />;
  if (panel === 'queue') return <Queue onClose={onClose} />;
  return null;
}

// the lyric list, and its editor: the song's lyrics as text (LRC, TTML or plain), saved where the settings say
function Lyrics({
  onClose,
  hasLyrics,
  session,
  shownId,
}: {
  onClose: () => void;
  hasLyrics: boolean;
  session: ReturnType<typeof player.get>['session'];
  shownId: string | null;
}) {
  const text = useStore(player, (x) => x.lyrics?.text || ''),
    [edit, setEdit] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!hasLyrics && edit == null) setEdit(text);
  }, [hasLyrics]);
  const save = async () => {
    if (edit == null) return;
    setBusy(true);
    try {
      await useLyrics(edit);
      setEdit(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`hud card ${s.panel} ${s.lyr}`} aria-label={tx('s.lyricList')} data-test="space-lyrics">
      <header className={s.head}>
        <b>{edit != null ? ts('lyr.edit') : tx('s.lyricList')}</b>
        {edit == null && (
          <button type="button" className={s.clear} onClick={() => setEdit(text)}>
            {ts('lyr.edit')}
          </button>
        )}
        <button type="button" className={s.x} onClick={onClose} aria-label={tx('close')}>
          ✕
        </button>
      </header>
      {edit != null ? (
        <div className={s.editor}>
          <textarea
            value={edit}
            onChange={(e) => setEdit(e.target.value)}
            spellCheck={false}
            aria-label={ts('lyr.edit')}
            placeholder={ts('lyr.placeholder')}
          />
          <div className={s.actions}>
            <button type="button" className={s.solid} disabled={busy} onClick={save}>
              {tx('s.save')}
            </button>
            <button type="button" className={s.ghost} onClick={() => setEdit(null)} disabled={!hasLyrics}>
              {tx('s.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className={s.lyrBox}>
          {hasLyrics && session ? (
            <NpLyrics key={session.version + ':' + shownId} lines={session.doc.lines} live compact />
          ) : null}
        </div>
      )}
    </section>
  );
}

function Queue({ onClose }: { onClose: () => void }) {
  const p = useStore(player);
  useStore(lib, (x) => x.tracks);
  const [, bump] = useState(0);
  useEffect(() => {
    const el = document.querySelector('[data-test="space-queue"] [data-cur="true"]');
    el?.scrollIntoView({ block: 'center' });
    bump(1);
  }, []);
  const items = p.queue.map((id, i) => ({ id, i, t: trackOf(id) })).filter((x) => x.t),
    cur = items.findIndex((x) => x.id === p.id);
  return (
    <section className={`hud card ${s.panel}`} aria-label={tx('s.queue')} data-test="space-queue">
      <header className={s.head}>
        <div>
          <b>{tx('s.queue')}</b>
          <small>{tx('s.queue.count', { n: items.length, rest: Math.max(0, items.length - 1 - cur) })}</small>
        </div>
        <button
          type="button"
          className={s.clear}
          disabled={!items.length}
          onClick={async () => {
            const n = ts('queueList');
            await Lib?.playlist(
              'create',
              n,
              items.map((x) => x.id),
            );
            toast(tx('s.addedTo', { name: n }));
          }}
        >
          {ts('saveQueue')}
        </button>
        <button type="button" className={s.clear} disabled={items.length < 2} onClick={() => clearQueue()}>
          {tx('s.queue.clear')}
        </button>
        <button type="button" className={s.x} onClick={onClose} aria-label={tx('close')}>
          ✕
        </button>
      </header>
      <div className={s.modes}>
        <Seg
          size="sm"
          value={p.mode}
          label={tx('s.mode')}
          onChange={(m: Mode) => setMode(m)}
          options={MODES.map((m) => [m, '', MODE_ICON[m], tx('s.mode.' + m)])}
        />
        <small>{tx('s.mode.' + p.mode + '.help')}</small>
      </div>
      <ol className={s.list}>
        {items.map((x) => {
          const on = x.id === p.id;
          return (
            <li key={x.id + ':' + x.i} data-cur={on}>
              <button type="button" className={s.row} onClick={() => playQueueAt(x.i)}>
                <span className={s.cover}>
                  <Cover k={x.t!.cover} />
                </span>
                <span className={s.text}>
                  <b>{x.t!.title}</b>
                  <small>{x.t!.artist}</small>
                </span>
              </button>
              {!on && (
                <button
                  type="button"
                  className={s.rm}
                  onClick={() => removeFromQueue(x.i)}
                  aria-label={tx('s.queue.remove')}
                  title={tx('s.queue.remove')}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
