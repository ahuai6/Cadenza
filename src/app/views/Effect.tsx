import { LyricSourcesEditor } from '../ui/LyricSources';
// The effect-lyrics view's controls, over the engine's picture. The picture itself and the move into it are the
// engine's (the hand-over from the now-playing page); these controls appear as it lands. The bottom bar rises whenever
// the pointer moves and sinks after a still moment; the pointer itself hides with it and comes back on any movement.
// The song's own settings slide in from the right edge.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useOutsideClose } from '../ui/outside';
import { tx } from '../../i18n';
import { D } from '../bridge';
import { ui, settings, useStore, trackOf, toast, openMenu } from '../state';
import { Button, IconButton, Row, Slider, Note, Section, Dropdown, Cover, usePresence } from '../ui/kit';
import { Icon } from '../ui/icons';
import { engine } from '../playback/stage';
import {
  player,
  editSong,
  chooseSongPreset,
  saveSong,
  setLyricOffset,
  setMvOn,
  unbindMv,
  spacedLines,
  saveSpacing,
  fxAspect,
  FX_ASPECTS,
  setFxAspect,
} from '../playback/player';
import { refs, back } from '../layers';
import { Progress, Transport, QueueButton, ModeButton } from './Player';
import { NpLyrics } from '../ui/NpLyrics';
import { StylePage, ExportPanel } from './panes';
import { askMv, askMvOffset } from './Modals';
import { MvLook } from './Settings';
import s from './Effect.module.css';
import { PerfHud } from './PerfHud';
import { canEdit, useEditing, useEditingDraft } from '../editing';
import { EditControls, EditModeButton } from '../ui/EditModeButton';

const IDLE_MS = 2600;
export function EffectView() {
  const hud = useStore(settings, (x) => !!x.perfHud);
  const layer = useStore(ui, (x) => x.layer),
    full = useStore(ui, (x) => x.win.full),
    queue = useStore(ui, (x) => x.queue),
    modal = useStore(ui, (x) => !!x.modal);
  const shownId = useStore(player, (x) => x.shownId),
    session = useStore(player, (x) => x.session),
    hasLyrics = useStore(player, (x) => x.hasLyrics);
  const t = trackOf(shownId),
    root = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false),
    [list, setList] = useState(false),
    [panel, setPanel] = useState(false),
    [near, setNear] = useState(false);
  const on = layer === 'fx';
  const listPresence = usePresence(list && on);
  useLayoutEffect(() => {
    refs.fxUi = root.current;
  });
  useEffect(
    () => () => {
      refs.fxUi = null;
    },
    [],
  );
  // any movement shows the pointer and the bar; a still moment hides both (never while a control is in use)
  useEffect(() => {
    if (!on) {
      setIdle(false);
      setPanel(false);
      setList(false);
      return;
    }
    let tm = 0;
    const wake = () => {
      setIdle(false);
      clearTimeout(tm);
      tm = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    const evs = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const;
    evs.forEach((e) => addEventListener(e, wake, { passive: true }));
    wake();
    return () => {
      evs.forEach((e) => removeEventListener(e, wake));
      clearTimeout(tm);
    };
  }, [on]);
  useEffect(() => {
    if (!on) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ui.get().modal && (list || panel)) {
        e.stopImmediatePropagation();
        setList(false);
        setPanel(false);
      }
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [on, list, panel]);
  // (the lyric list and the song's panel go away when the picture is pressed; the bar's own buttons open and close them)
  const closeAll = useCallback(() => {
    setList(false);
    setPanel(false);
  }, []);
  useOutsideClose(
    on && (list || panel),
    closeAll,
    '[data-test="song-panel"]',
    '[data-test="fx-list"]',
    '[data-test="fx-bar"]',
  );
  if (!t) return null;
  const bar = !idle || near || list || panel || queue || modal;
  const cursor = !idle || near || panel || list || queue || modal;
  return (
    <div
      data-test="fx"
      className={s.fx + ' on-picture'}
      ref={root}
      data-on={on}
      data-bar={bar}
      data-cursor={cursor}
      aria-hidden={!on}
      inert={!on}
      onPointerMove={(e) => setNear(e.clientY > innerHeight - 130)}
    >
      {hud && on && <PerfHud />}
      <div className={s.edge} onPointerEnter={(e) => e.pointerType === 'mouse' && setPanel(true)} />
      {listPresence.shown && hasLyrics && session && (
        <div
          className={s.list + ' glass'}
          role="dialog"
          data-test="fx-list"
          aria-label={tx('s.lyricList')}
          data-presence=""
          data-closing={listPresence.closing || undefined}
          inert={listPresence.closing}
        >
          <NpLyrics lines={session.doc.lines} live compact />
        </div>
      )}
      <div data-test="fx-bar" className={s.bottom + ' glass'}>
        <IconButton n="chevronLeft" label={tx('s.fxExit')} onClick={back} />
        <div className={s.meta}>
          <b>{t.title}</b>
          <small>{t.artist}</small>
        </div>
        {/* (how the queue moves on, right before the progress line) */}
        <ModeButton />
        <Progress />
        <Transport />
        <div className={s.tools}>
          <IconButton
            n="quote"
            label={tx('s.lyricList')}
            pressed={list}
            onClick={() => setList((v) => !v)}
            disabled={!hasLyrics}
          />
          <QueueButton />
          <EditControls inline>
            <AspectPick />
          </EditControls>
          <MvButton />
          <EditModeButton className={s.editMode} compact />
          <IconButton n="sliders" label={tx('s.panel.song')} pressed={panel} onClick={() => setPanel((v) => !v)} />
          <IconButton
            n={full ? 'unfull' : 'full'}
            label={tx(full ? 's.unfullscreen' : 's.fullscreen')}
            onClick={() => D?.win('full')}
          />
        </div>
      </div>
      {on && session && <SongPanel open={panel} onClose={() => setPanel(false)} />}
    </div>
  );
}

/** The frame's shape, right in the bar: the scene is planned again for it (it changes size; nothing is cropped). */
function AspectPick() {
  useStore(settings, (x) => x.fxAspect);
  return (
    <Dropdown
      className={s.aspect}
      label={tx('aspect')}
      value={fxAspect()}
      options={FX_ASPECTS.map((a) => [a, a])}
      onChange={(value) => {
        if (canEdit()) setFxAspect(value);
      }}
    />
  );
}
function MvButton() {
  const mv = useStore(player, (x) => x.mv);
  const click = () => {
    if (!mv.bound) askMv();
    else if (!mv.ready) toast(tx('s.mvLoading'));
    else setMvOn(!mv.on);
  };
  const menu = (e: React.MouseEvent) =>
    openMenu(e, [
      canEdit() && { label: tx('s.mvChange'), icon: 'mv', run: () => askMv() },
      canEdit() && mv.bound && { label: tx('s.mvOffset'), icon: 'refresh', run: () => askMvOffset() },
      mv.bound && mv.on && { label: tx('s.mvOff'), icon: 'close', run: () => setMvOn(false) },
      canEdit() && mv.bound && '-',
      canEdit() && mv.bound && { label: tx('s.mvUnbind'), icon: 'trash', danger: true, run: () => unbindMv() },
    ]);
  const button = (
    <Button
      glass
      className={s.mvb}
      aria-pressed={mv.on}
      title={mv.bound ? mv.name : tx('s.mvBind')}
      onClick={click}
      onContextMenu={menu}
      icon="mv"
    >
      MV
    </Button>
  );
  return mv.bound ? button : <EditControls inline>{button}</EditControls>;
}

/* ---------- this song's settings ---------- */
/** The song's MV: bind or change it, and how it sits behind the lyrics (the look is app-wide). */
function MvPane() {
  const mv = useStore(player, (x) => x.mv);
  return (
    <Section title={tx('s.set.mv')} note={tx(mv.bound ? 's.set.mvHelp' : 's.mvBindHelp')}>
      <Row>
        <Button size="sm" onClick={() => askMv()}>
          {tx(mv.bound ? 's.mvChange' : 's.mvBind')}
        </Button>
        {mv.bound && (
          <Button size="sm" onClick={() => askMvOffset()}>
            {tx('s.mvOffset')}
          </Button>
        )}
        {mv.bound && mv.ready && (
          <Button kind="ghost" size="sm" onClick={() => setMvOn(!mv.on)}>
            {tx(mv.on ? 's.mvOff' : 's.mv')}
          </Button>
        )}
      </Row>
      <MvLook />
    </Section>
  );
}
const TABS: [string, string, string][] = [
  ['style', 's.sec.style', 'palette'],
  ['lyrics', 's.sec.lyrics', 'lyrics'],
  ['export', 's.sec.export', 'download'],
]; // (the ending's card follows the song's own details, like its title)
function SongPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const editing = useEditing();
  useStore(player, (x) => x.rev);
  const session = useStore(player, (x) => x.session)!,
    song = useStore(player, (x) => x.song),
    locked = !!song?.locked;
  const [tab, setTab] = useState('style'),
    el = useRef<HTMLElement>(null),
    leaveTm = useRef(0);
  // An input method's candidate window (Zhuyin, Pinyin, Japanese, Korean…) is a window of its own: while it is up the
  // page sees the pointer leave. So the panel never closes while one of its fields is focused or being composed in, or
  // while the window has lost focus; it closes once the pointer has been outside it for a moment with nothing typed.
  const composing = useRef(false),
    inside = useRef(false);
  const typing = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!(el.current && a && el.current.contains(a) && a.matches('input,textarea,select,[contenteditable="true"]'));
  };
  const leave = () => {
    clearTimeout(leaveTm.current);
    leaveTm.current = window.setTimeout(() => {
      if (
        !inside.current &&
        !composing.current &&
        !typing() &&
        document.hasFocus() &&
        !ui.get().modal &&
        !ui.get().menu &&
        !document.querySelector('[data-colorpop]')
      )
        onClose();
    }, 600);
  }; // (nor while a colour picker of its is open: its eyedropper roams the whole screen)
  useEffect(() => () => clearTimeout(leaveTm.current), []);
  const props = { s: session, edit: editSong, choose: chooseSongPreset, ctx: 'song' as const };
  // (the panel is tinted by the song's own dark, as the play page is)
  const tone = useMemo(() => {
    const A = session.ambient;
    if (!A) return {};
    return { '--amb-base': A.base.map((x) => Math.round(x)).join(',') } as React.CSSProperties;
  }, [session]);
  return (
    <aside
      data-test="song-panel"
      className={s.panel + ' glass'}
      ref={el}
      data-open={open}
      style={tone}
      aria-hidden={!open}
      inert={!open}
      onPointerLeave={(e) => {
        const r = el.current!.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
        inside.current = false;
        leave();
      }}
      onPointerEnter={() => {
        inside.current = true;
        clearTimeout(leaveTm.current);
      }}
      onCompositionStart={() => {
        composing.current = true;
        clearTimeout(leaveTm.current);
      }}
      onCompositionEnd={() => {
        composing.current = false;
        if (!inside.current) leave();
      }}
      onBlur={(e) => {
        if (!inside.current && !el.current!.contains(e.relatedTarget as Node)) leave();
      }}
    >
      {/* the sections down the left edge (the song's cover at their head), the one open beside them */}
      <nav className={s.rail} role="tablist" aria-orientation="vertical" aria-label={tx('s.panel.song')}>
        <span className={s.railCover}>
          <Cover k={trackOf(player.get().shownId)?.cover} />
        </span>
        {TABS.map(([k, l, ic]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            data-k={k}
            className={s.railTab}
            onClick={() => setTab(k)}
          >
            <Icon n={ic as never} size={18} />
            <span>{tx(l)}</span>
          </button>
        ))}
      </nav>
      <header className={s.phead}>
        <div>
          <small className={s.pkick}>{tx('s.panel.song')}</small>
          <b className={s.ptitle}>{tx(TABS.find((x) => x[0] === tab)![1])}</b>
          <small>{tx('s.panel.bound')}</small>
        </div>
        {editing && (
          <IconButton
            n={locked ? 'lock' : 'unlock'}
            pressed={locked}
            label={tx(locked ? 's.locked' : 's.lock')}
            onClick={() => {
              if (!locked) saveSong({ locked: true });
            }}
            onDoubleClick={() => {
              if (locked) saveSong({ locked: false });
            }}
          />
        )}
      </header>
      <div className={s.pbody} data-locked={locked}>
        {tab === 'style' && <StylePage {...props} media={<MvPane />} />}
        {tab === 'lyrics' && <LyricsTab />}
        {tab === 'export' && (
          <ExportPanel
            engine={engine}
            s={session}
            before={() => engine.pause()}
            aspect={{ value: fxAspect(), options: FX_ASPECTS, set: setFxAspect }}
          />
        )}
        {editing && locked && tab !== 'export' && (
          <div className={s.lockCover} onDoubleClick={() => saveSong({ locked: false })}>
            <Icon n="lock" size={22} />
            <span>{tx('s.locked')}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
/** The song's word breaks: its lines as they are spaced now, editable, back to the segmenter's in one go. */
function SpacingEditor() {
  const doc = useStore(player, (x) => x.session?.doc),
    id = useStore(player, (x) => x.shownId),
    [msg, setMsg] = useState('');
  const [text, setText, clearDraft, sync] = useEditingDraft('spacing:' + id, () => spacedLines().join('\n'));
  useEffect(() => {
    sync(spacedLines().join('\n'));
  }, [doc]); // (a new song or new lyrics, not every repaint)
  return (
    <div style={{ display: 'grid', gap: 8, padding: '0 0 14px' }}>
      <b style={{ fontSize: 13 }}>{tx('s.lyr.spacing')}</b>
      <Note>{tx('s.lyr.spacingHelp')}</Note>
      <textarea className={s.lyricsTa} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <Row>
        <Button
          kind="primary"
          size="sm"
          onClick={async () => {
            if (!(await saveSpacing(text.split('\n')))) return;
            clearDraft();
            setMsg(tx('s.lyr.spacingSaved'));
          }}
        >
          {tx('s.lyr.spacingSave')}
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            if (!(await saveSpacing(null))) return;
            clearDraft();
            setMsg(tx('s.lyr.spacingRestored'));
          }}
        >
          {tx('s.lyr.spacingReset')}
        </Button>
      </Row>
      {msg && <Note>{msg}</Note>}
    </div>
  );
}
export function LyricsTab() {
  const editing = useEditing();
  const id = useStore(player, (value) => value.shownId);
  const offset = useStore(player, (value) => value.session?.spec.lshift || 0);
  const hasLyrics = useStore(player, (value) => value.hasLyrics);
  return (
    <>
      {!editing && <Note>{tx('edit.required')}</Note>}
      {id && <LyricSourcesEditor key={id} id={id} />}
      <EditControls>
        <Slider
          label={tx('s.lyr.offset')}
          min={-1500}
          max={1500}
          step={10}
          value={offset}
          format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`}
          onCommit={setLyricOffset}
        />
        {hasLyrics && <SpacingEditor />}
      </EditControls>
    </>
  );
}
