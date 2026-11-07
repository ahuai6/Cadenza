// The space's player bar, completed: the lyric list (the same list the classic effect lyrics open), the play queue and
// the play mode, as the classic player card has them. The buttons live in the HUD's player card (a portal into it); the
// lists open as glass cards above it.
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { tx } from '../../i18n';
import { useStore, trackOf, lib } from '../state';
import { Icon } from '../ui/icons';
import { Seg, Cover } from '../ui/kit';
import { NpLyrics } from '../ui/NpLyrics';
import { player, setMode, MODES, MODE_ICON, playQueueAt, removeFromQueue, clearQueue, type Mode } from '../playback/player';
import s from './SpacePanels.module.css';

export type Panel = 'lyrics' | 'queue' | null;

/** The three buttons, placed into the HUD's player card. */
export function PlayerExtras({ host, panel, setPanel }: { host: HTMLElement | null; panel: Panel; setPanel: (p: Panel) => void }) {
  const mode = useStore(player, x => x.mode), hasLyrics = useStore(player, x => x.hasLyrics);
  if (!host) return null;
  const btn = (n: string, label: string, on: boolean, f: () => void, dis = false) =>
    <button type="button" className={'btn ' + s.ib} aria-pressed={on} title={label} aria-label={label} onClick={f} disabled={dis}><Icon n={n} size={18} /></button>;
  return createPortal(<>
    {btn('quote', tx('s.lyricList'), panel === 'lyrics', () => setPanel(panel === 'lyrics' ? null : 'lyrics'), !hasLyrics)}
    {btn('queue', tx('s.queue'), panel === 'queue', () => setPanel(panel === 'queue' ? null : 'queue'))}
    {btn(MODE_ICON[mode], tx('s.mode.' + mode), mode !== 'stop', () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]))}
  </>, host);
}

/** The open list: the lyrics (scrolling with the song; a line clicked plays from it), or the queue. */
export function SpacePanel({ panel, onClose }: { panel: Panel; onClose: () => void }) {
  const session = useStore(player, x => x.session), hasLyrics = useStore(player, x => x.hasLyrics), shownId = useStore(player, x => x.shownId || x.id);
  useEffect(() => { if (!panel) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [panel, onClose]);
  if (panel === 'lyrics') return (
    <section className={`hud card ${s.panel} ${s.lyr}`} aria-label={tx('s.lyricList')} data-test="space-lyrics">
      <header className={s.head}><b>{tx('s.lyricList')}</b><button type="button" className={s.x} onClick={onClose} aria-label={tx('close')}>✕</button></header>
      <div className={s.lyrBox}>{hasLyrics && session ? <NpLyrics key={session.version + ':' + shownId} lines={session.doc.lines} live compact /> : null}</div>
    </section>);
  if (panel === 'queue') return <Queue onClose={onClose} />;
  return null;
}

function Queue({ onClose }: { onClose: () => void }) {
  const p = useStore(player); useStore(lib, x => x.tracks);
  const [, bump] = useState(0); useEffect(() => { const el = document.querySelector('[data-test="space-queue"] [data-cur="true"]'); el?.scrollIntoView({ block: 'center' }); bump(1); }, []);
  const items = p.queue.map((id, i) => ({ id, i, t: trackOf(id) })).filter(x => x.t), cur = items.findIndex(x => x.id === p.id);
  return (
    <section className={`hud card ${s.panel}`} aria-label={tx('s.queue')} data-test="space-queue">
      <header className={s.head}><div><b>{tx('s.queue')}</b><small>{tx('s.queue.count', { n: items.length, rest: Math.max(0, items.length - 1 - cur) })}</small></div>
        <button type="button" className={s.clear} disabled={items.length < 2} onClick={() => clearQueue()}>{tx('s.queue.clear')}</button>
        <button type="button" className={s.x} onClick={onClose} aria-label={tx('close')}>✕</button></header>
      <div className={s.modes}><Seg size="sm" value={p.mode} label={tx('s.mode')} onChange={(m: Mode) => setMode(m)} options={MODES.map(m => [m, '', MODE_ICON[m], tx('s.mode.' + m)])} />
        <small>{tx('s.mode.' + p.mode + '.help')}</small></div>
      <ol className={s.list}>
        {items.map(x => { const on = x.id === p.id; return (
          <li key={x.id + ':' + x.i} data-cur={on}>
            <button type="button" className={s.row} onClick={() => playQueueAt(x.i)}><span className={s.cover}><Cover k={x.t!.cover} /></span><span className={s.text}><b>{x.t!.title}</b><small>{x.t!.artist}</small></span></button>
            {!on && <button type="button" className={s.rm} onClick={() => removeFromQueue(x.i)} aria-label={tx('s.queue.remove')} title={tx('s.queue.remove')}>✕</button>}
          </li>); })}
      </ol>
    </section>);
}
