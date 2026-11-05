// The effect-lyrics view's controls, over the engine's picture. The picture itself and the move into it are the
// engine's (the hand-over from the now-playing page); these controls appear as it lands. The bottom bar rises whenever
// the pointer moves and sinks after a still moment; the pointer itself hides with it and comes back on any movement.
// The song's own settings slide in from the right edge.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { D, Lib } from '../bridge';
import { ui, settings, useStore, trackOf, toast, openMenu } from '../state';
import { Button, IconButton, Seg, Row, Slider, Note, Badge, Section, Dropdown } from '../ui/kit';
import { CueBar, cueKeyDown } from '../ui/cues';
import { Icon } from '../ui/icons';
import { engine } from '../playback/stage';
import { player, editSong, saveSong, useLyrics, spreadPlain, hasTimedLines, setMvOn, unbindMv, spacedLines, saveSpacing, fxAspect, FX_ASPECTS, setFxAspect } from '../playback/player';
import { refs, back } from '../layers';
import { Progress, Transport, QueueButton } from './Player';
import { NpLyrics } from './NowPlaying';
import { ThemePane, LookPane, TextPane, MotionPane, EffectsPane, ExportPanel } from './panes';
import { askMv, askMvOffset } from './Modals';
import { MvLook } from './Settings';
import { setSettings } from '../actions/settings';
import s from './Effect.module.css';
import { PerfHud } from './PerfHud';

const IDLE_MS = 2600;
export function EffectView() {
  const hud = useStore(settings, x => !!x.perfHud);
  const layer = useStore(ui, x => x.layer), full = useStore(ui, x => x.win.full), queue = useStore(ui, x => x.queue), modal = useStore(ui, x => !!x.modal);
  const shownId = useStore(player, x => x.shownId), session = useStore(player, x => x.session), hasLyrics = useStore(player, x => x.hasLyrics);
  const t = trackOf(shownId), root = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false), [list, setList] = useState(false), [panel, setPanel] = useState(false), [near, setNear] = useState(false);
  const on = layer === 'fx';
  useLayoutEffect(() => { refs.fxUi = root.current; });
  useEffect(() => () => { refs.fxUi = null; }, []);
  // any movement shows the pointer and the bar; a still moment hides both (never while a control is in use)
  useEffect(() => {
    if (!on) { setIdle(false); setPanel(false); setList(false); return; }
    let tm = 0; const wake = () => { setIdle(false); clearTimeout(tm); tm = window.setTimeout(() => setIdle(true), IDLE_MS); };
    const evs = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const; evs.forEach(e => addEventListener(e, wake, { passive: true })); wake();
    return () => { evs.forEach(e => removeEventListener(e, wake)); clearTimeout(tm); };
  }, [on]);
  useEffect(() => { if (!on) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ui.get().modal && (list || panel)) { e.stopImmediatePropagation(); setList(false); setPanel(false); } };
    addEventListener('keydown', k, true); return () => removeEventListener('keydown', k, true); }, [on, list, panel]);
  if (!t) return null;
  const bar = !idle || near || list || panel || queue || modal;
  const cursor = !idle || near || panel || list || queue || modal;
  return (
    <div data-test="fx" className={s.fx + ' on-picture'} ref={root} data-on={on} data-bar={bar} data-cursor={cursor} aria-hidden={!on} inert={!on}
      onPointerMove={e => setNear(e.clientY > innerHeight - 130)}>
      {hud && on && <PerfHud />}
      <div className={s.edge} onPointerEnter={() => setPanel(true)} />
      {list && hasLyrics && session && <div className={s.list + ' glass'} role="dialog" aria-label={tx('s.lyricList')}><NpLyrics lines={session.doc.lines} live compact /></div>}
      <div data-test="fx-bar" className={s.bottom + ' glass'}>
        <IconButton n="chevronLeft" label={tx('s.fxExit')} onClick={back} />
        <div className={s.meta}><b>{t.title}</b><small>{t.artist}</small></div>
        <Progress />
        <Transport />
        <div className={s.tools}>
          <IconButton n="quote" label={tx('s.lyricList')} pressed={list} onClick={() => setList(v => !v)} disabled={!hasLyrics} />
          <QueueButton />
          <AspectPick />
          <MvButton />
          <IconButton n="sliders" label={tx('s.panel.song')} pressed={panel} onClick={() => setPanel(v => !v)} />
          <IconButton n={full ? 'unfull' : 'full'} label={tx(full ? 's.unfullscreen' : 's.fullscreen')} onClick={() => D?.win('full')} />
        </div>
      </div>
      {on && session && <SongPanel open={panel} onClose={() => setPanel(false)} />}
    </div>
  );
}

/** The frame's shape, right in the bar: the scene is planned again for it (it changes size; nothing is cropped). */
function AspectPick() {
  useStore(settings, x => x.fxAspect);
  return <Dropdown className={s.aspect} label={tx('aspect')} value={fxAspect()} options={FX_ASPECTS.map(a => [a, a])} onChange={setFxAspect} />;
}
function MvButton() {
  const mv = useStore(player, x => x.mv);
  const click = () => { if (!mv.bound) askMv(); else if (!mv.ready) toast(tx('s.mvLoading')); else setMvOn(!mv.on); };
  const menu = (e: React.MouseEvent) => openMenu(e, [
    { label: tx('s.mvChange'), icon: 'mv', run: () => askMv() },
    mv.bound && { label: tx('s.mvOffset'), icon: 'refresh', run: () => askMvOffset() },
    mv.bound && mv.on && { label: tx('s.mvOff'), icon: 'close', run: () => setMvOn(false) },
    mv.bound && '-', mv.bound && { label: tx('s.mvUnbind'), icon: 'trash', danger: true, run: () => unbindMv() },
  ]);
  return <Button glass className={s.mvb} aria-pressed={mv.on} title={mv.bound ? mv.name : tx('s.mvBind')} onClick={click} onContextMenu={menu} icon="mv">MV</Button>;
}

/* ---------- this song's settings ---------- */
/** The song's MV: bind or change it, and how it sits behind the lyrics (the look is app-wide). */
function MvPane() {
  const mv = useStore(player, x => x.mv);
  return (
    <Section title={tx('s.set.mv')} note={tx(mv.bound ? 's.set.mvHelp' : 's.mvBindHelp')}>
      <Row>
        <Button size="sm" onClick={() => askMv()}>{tx(mv.bound ? 's.mvChange' : 's.mvBind')}</Button>
        {mv.bound && <Button size="sm" onClick={() => askMvOffset()}>{tx('s.mvOffset')}</Button>}
        {mv.bound && mv.ready && <Button kind="ghost" size="sm" onClick={() => setMvOn(!mv.on)}>{tx(mv.on ? 's.mvOff' : 's.mv')}</Button>}
      </Row>
      <MvLook />
    </Section>
  );
}
const TABS: [string, string][] = [['theme', 's.sec.theme'], ['lyrics', 's.sec.lyrics'], ['bg', 's.sec.bg'], ['text', 's.sec.text'], ['motion', 's.sec.motion'], ['fx', 's.sec.fx'], ['export', 's.sec.export']];   // (the ending's card follows the song's own details, like its title)
function SongPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  useStore(player, x => x.rev);
  const session = useStore(player, x => x.session)!, song = useStore(player, x => x.song), locked = !!song?.locked;
  const [tab, setTab] = useState('theme'), el = useRef<HTMLElement>(null), leaveTm = useRef(0);
  // a song's panel always edits the song's own copy: a preset becomes a custom theme bound to the song when it opens
  useEffect(() => { if (open && !session.custom && !locked) editSong(x => x.makeCustom()); }, [open, locked, session]);
  // An input method's candidate window (Zhuyin, Pinyin, Japanese, Korean…) is a window of its own: while it is up the
  // page sees the pointer leave. So the panel never closes while one of its fields is focused or being composed in, or
  // while the window has lost focus; it closes once the pointer has been outside it for a moment with nothing typed.
  const composing = useRef(false), inside = useRef(false);
  const typing = () => { const a = document.activeElement as HTMLElement | null; return !!(el.current && a && el.current.contains(a) && a.matches('input,textarea,select,[contenteditable="true"]')); };
  const leave = () => { clearTimeout(leaveTm.current); leaveTm.current = window.setTimeout(() => {
    if (!inside.current && !composing.current && !typing() && document.hasFocus() && !ui.get().modal && !ui.get().menu && !document.querySelector('[data-colorpop]')) onClose(); }, 600); };   // (nor while a colour picker of its is open: its eyedropper roams the whole screen)
  useEffect(() => () => clearTimeout(leaveTm.current), []);
  const props = { s: session, edit: editSong, ctx: 'song' as const };
  return (
    <aside data-test="song-panel" className={s.panel + ' glass'} ref={el} data-open={open} aria-hidden={!open} inert={!open}
      onPointerLeave={e => { const r = el.current!.getBoundingClientRect(); if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return; inside.current = false; leave(); }}
      onPointerEnter={() => { inside.current = true; clearTimeout(leaveTm.current); }}
      onCompositionStart={() => { composing.current = true; clearTimeout(leaveTm.current); }} onCompositionEnd={() => { composing.current = false; if (!inside.current) leave(); }}
      onBlur={e => { if (!inside.current && !el.current!.contains(e.relatedTarget as Node)) leave(); }}>
      <header className={s.phead}>
        <div><b>{tx('s.panel.song')}</b><small>{tx('s.panel.bound')}</small></div>
        <IconButton n={locked ? 'lock' : 'unlock'} pressed={locked} label={tx(locked ? 's.locked' : 's.lock')} onClick={() => { if (!locked) saveSong({ locked: true }); }} onDoubleClick={() => { if (locked) saveSong({ locked: false }); }} />
      </header>
      <div className={s.tabs}><Seg role="tablist" fit size="sm" value={tab} onChange={setTab} options={TABS.map(([k, l]) => [k, tx(l)])} /></div>
      <div className={s.pbody} data-locked={locked}>
        {tab === 'theme' && <ThemePane {...props} />}
        {tab === 'lyrics' && <LyricsTab />}
        {tab === 'bg' && <><LookPane {...props} /><MvPane /></>}
        {tab === 'text' && <TextPane {...props} />}
        {tab === 'motion' && <MotionPane {...props} />}
        {tab === 'fx' && <EffectsPane {...props} />}
        {tab === 'export' && <ExportPanel engine={engine} s={session} before={() => engine.pause()} aspect={{ value: fxAspect(), options: FX_ASPECTS, set: setFxAspect }} />}
        {locked && <div className={s.lockCover} onDoubleClick={() => saveSong({ locked: false })}><Icon n="lock" size={22} /><span>{tx('s.locked')}</span></div>}
      </div>
    </aside>
  );
}
/** The song's word breaks: its lines as they are spaced now, editable, back to the segmenter's in one go. */
function SpacingEditor() {
  const doc = useStore(player, x => x.session?.doc), [text, setText] = useState(() => spacedLines().join('\n')), [msg, setMsg] = useState('');
  useEffect(() => { setText(spacedLines().join('\n')); }, [doc]);       // (a new song or new lyrics, not every repaint)
  return (
    <div style={{ display: 'grid', gap: 8, padding: '0 0 14px' }}>
      <b style={{ fontSize: 13 }}>{tx('s.lyr.spacing')}</b>
      <Note>{tx('s.lyr.spacingHelp')}</Note>
      <textarea className={s.lyricsTa} spellCheck={false} value={text} onChange={e => setText(e.target.value)} />
      <Row>
        <Button kind="primary" size="sm" onClick={async () => { await saveSpacing(text.split('\n')); setMsg(tx('s.lyr.spacingSaved')); }}>{tx('s.lyr.spacingSave')}</Button>
        <Button size="sm" onClick={async () => { await saveSpacing(null); setText(spacedLines().join('\n')); setMsg(tx('s.lyr.spacingRestored')); }}>{tx('s.lyr.spacingReset')}</Button>
      </Row>
      {msg && <Note>{msg}</Note>}
    </div>
  );
}
export function LyricsTab() {
  const p = useStore(player), t = trackOf(p.shownId), session = p.session!, target = useStore(settings, x => x.lyricsTarget) === 'lrc' ? 'lrc' : 'tag';
  const [text, setText] = useState(() => (p.hasLyrics ? session.spec.lyrics : '') || ''), [msg, setMsg] = useState('');
  const [q, setQ] = useState({ title: t ? t.title : '', artist: t ? t.artist : '' }), [res, setRes] = useState<Awaited<ReturnType<NonNullable<typeof Lib>['searchLyrics']>> | null>(null);
  const [busy, setBusy] = useState(false), [pick, setPick] = useState<number | null>(null), ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setText((player.get().hasLyrics ? player.get().session?.spec.lyrics : '') || ''); }, [p.shownId]);
  const use = async (src: string) => { const ok = await useLyrics(src); setText(src); setMsg(tx(ok ? 's.lyr.saved' : 'load.none')); };
  const search = async () => { setBusy(true); setRes(null); setPick(null); try { setRes(await Lib!.searchLyrics({ ...q, album: t?.album, duration: t?.duration })); } catch { setMsg(tx('s.netFail')); } setBusy(false); };
  const end = session.musicEnd;
  return (
    <>
      <div style={{ display: 'grid', gap: 8, padding: '6px 0 14px' }}>
        <Row><b style={{ fontSize: 13 }}>{tx('s.lyr.edit')}</b><span className="muted" style={{ fontSize: 12 }}>{tx(p.lyrics ? 's.lyr.source.' + p.lyrics.source : 's.lyr.source.none')}</span></Row>
        <CueBar target={ta} />
        <textarea ref={ta} className={s.lyricsTa} spellCheck={false} value={text} onKeyDown={cueKeyDown} onChange={e => setText(e.target.value)} placeholder="[00:12.30]…" />
        <Row>
          <Button kind="primary" size="sm" onClick={() => use(hasTimedLines(text) ? text : spreadPlain(text, end))}>{tx('s.lyr.saveLrc')}</Button>
          <Dropdown className={s.target} label={tx('s.lyr.target')} value={target} onChange={v => setSettings({ lyricsTarget: v as 'tag' | 'lrc' })} options={[['tag', tx('s.lyr.target.tag')], ['lrc', tx('s.lyr.target.lrc')]]} />
          <Button size="sm" onClick={async () => { const x = await Lib!.importLyricsFile(); if (x) use(/\[\d+:\d+/.test(x) ? x : spreadPlain(x, end)); }}>{tx('s.lyr.import')}</Button>
        </Row>
        {msg && <Note>{msg}</Note>}
        <Slider label={tx('s.lyr.offset')} min={-1500} max={1500} step={10} value={session.spec.lshift || 0} format={v => `${v > 0 ? '+' : ''}${Math.round(v)}`} onCommit={v => editSong(x => x.setTiming({ lshift: v }))} />
      </div>
      {p.hasLyrics && <SpacingEditor />}
      <div style={{ display: 'grid', gap: 8 }}>
        <b style={{ fontSize: 13 }}>{tx('s.lyr.online')}</b>
        <form className={s.q} onSubmit={e => { e.preventDefault(); search(); }}>
          <input type="text" value={q.title} placeholder={tx('s.col.title')} onChange={e => setQ({ ...q, title: e.target.value })} />
          <input type="text" value={q.artist} placeholder={tx('s.artists')} onChange={e => setQ({ ...q, artist: e.target.value })} />
          <Button kind="primary" size="sm" type="submit" disabled={busy}>{tx(busy ? 's.searching' : 's.searchBtn')}</Button>
        </form>
        {res && !res.length && <Note>{tx('s.empty.results')}</Note>}
        {res && res.map(r => (
          <div key={r.id} className={s.res}>
            <button type="button" className={s.resH} onClick={() => setPick(pick === r.id ? null : r.id)}>
              <span><b>{r.title}</b><small>{[r.artist, r.album].filter(Boolean).join(' · ')}</small></span>
              <Badge k={r.synced ? 'accent' : undefined}>{r.instrumental ? tx('s.instrumental') : r.synced ? tx('s.lyr.synced') : tx('s.lyr.plain')}</Badge>
            </button>
            {pick === r.id && !r.instrumental && <>
              <pre className={s.pre}>{(r.synced || r.plain).split('\n').slice(0, 14).join('\n')}</pre>
              <div style={{ padding: '0 11px 11px' }}><Button kind="primary" size="sm" onClick={() => use(r.synced || spreadPlain(r.plain, end))}>{tx('s.lyr.use')}</Button></div>
            </>}
          </div>
        ))}
      </div>
    </>
  );
}
