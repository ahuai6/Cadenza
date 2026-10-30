// The workshop: the full lyric-video desk (picture, transport, timeline, every setting, export). It is the whole web
// build, and inside the desktop app it is the Lyric workshop page — a separate, fully custom project with an engine of
// its own, so the player and the workshop never disturb each other.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tx, LANGS, currentLang, type Lang } from '../../../i18n';
import type { Session } from '../../../engine';
import { desktop, offerFile, pickSavePath, D, type Track } from '../../bridge';
import { ui, useStore, toast } from '../../state';
import { Icon } from '../../ui/icons';
import { Button, IconButton, Seg, Section, Row, Check, TextField, Note, Slider, Dropdown } from '../../ui/kit';
import { CueBar, cueKeyDown } from '../../ui/cues';
import { yieldAudio, songForWorkshop } from '../../playback/player';
import { storedStyle } from '../../../theme/style';
import { ThemePane, LookPane, TextPane, MotionPane, EffectsPane, EndPane, ExportPanel } from '../panes';
import { ws, engine, canvas, start, edit, applyLyrics, resetDemo, importAudio, clearAudio, importCover, clearCover, importVideo, clearVideo, setVideoOpt, importProject, projectData, queueImport } from '../../workshop/project';
import s from './Workshop.module.css';

const TABS: [string, string][] = [['lyrics', 'tab.lyrics'], ['look', 'tab.look'], ['motion', 'tab.motion'], ['fx', 'tab.fx'], ['end', 'tab.end']];
const fmt = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${(x % 60).toFixed(2).padStart(5, '0')}`;
const wide = () => matchMedia('(min-width: 900px)').matches;

/** A library song into the workshop: its audio, lyrics, cover and bound style become the workshop's next project. */
export async function sendToWorkshop(t: Track) {
  try {
    const x = await songForWorkshop(t);
    const style = x.song?.style ? { ...(x.song.style as object), aspect: '16:9' } : { preset: 'cover', aspect: '16:9' };
    const clean = (v: string) => String(v || '').replace(/[[\]<>#|]/g, ' ');
    const coverData = t.cover ? await fetch(`cadenza://cover/${t.cover}`).then(r => r.blob()).then(b => new Promise<string>(res => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.readAsDataURL(b); })).catch(() => '') : '';
    queueImport({ project: { app: 'cadenza', version: 1, lyrics: x.lyrics || `[00:00.00]${clean(t.title)}`, bpm: x.analysis?.tempo.bpm || 120, style, song: { on: true, title: t.title, artist: t.artist || '' },
      lshift: x.song?.lshift || 0, range: '', fade: true, endLen: 3.5, cover: coverData ? { data: coverData, name: t.title } : null }, buffer: x.buffer, analysis: x.analysis, name: t.file });
    ui.set({ page: 'workshop', detail: null, layer: 'none' });
    toast(tx('s.toWorkshopDone', { title: t.title }));
  } catch (e) { console.warn(e); toast(tx('aud.bad')); }
}
/** The desktop page: the player yields the audio device while the workshop is open. */
export function WorkshopPage() {
  useEffect(() => { yieldAudio(); return () => engine.pause(); }, []);
  return <Workshop note />;
}
export function Workshop({ note, web }: { note?: boolean; web?: boolean }) {
  const session = useStore(ws, x => x.session); useStore(ws, x => x.rev);
  const [panel, setPanel] = useState(wide), [tab, setTab] = useState('lyrics'), [exp, setExp] = useState(false), [idle, setIdle] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { engine.mount(host.current!); engine.setView('effect'); engine.handoff.jump(1); start(); return () => { engine.setView('hidden'); }; }, []);
  // keyboard: space plays, arrows seek (Shift for 5 s), Home and End jump, F fills the screen; never while typing
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]') || ui.get().modal) return;
      const ss = ws.get().session; if (!ss) return;
      if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); engine.toggle(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); engine.seek(engine.time + (e.shiftKey ? 5 : 1) * (e.key === 'ArrowRight' ? 1 : -1)); }
      else if (e.key === 'Home') { e.preventDefault(); engine.seek(0); }
      else if (e.key === 'End') { e.preventDefault(); engine.seek(Math.max(0, ss.musicEnd)); }
      else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) fullscreen();
    };
    addEventListener('keydown', k, true); return () => removeEventListener('keydown', k, true);
  }, []);
  useEffect(() => { let tm = 0; const wake = () => { setIdle(false); clearTimeout(tm); tm = window.setTimeout(() => setIdle(true), 3200); };
    const evs = ['pointermove', 'pointerdown', 'keydown'] as const; evs.forEach(e => addEventListener(e, wake, { passive: true })); wake();
    return () => { evs.forEach(e => removeEventListener(e, wake)); clearTimeout(tm); }; }, []);
  const fullscreen = () => { if (D) D.win('full'); else if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); };
  const props = session ? { s: session, edit, ctx: 'workshop' as const } : null;
  return (
    <div className={s.app + (web ? ' ' + s.web : '')} data-panel={panel} data-idle={idle && engine.isPlaying && !exp}>
      <main className={s.stage} ref={host}>
        {note && <p className={s.note + ' glass on-picture'}><Icon n="workshop" size={15} />{tx('s.ws.note')}</p>}
        {session && <Hud s={session} />}
        {exp && session && <div className={s.pop + ' glass'}><h2>{tx('x.open')}</h2><ExportPanel engine={engine} s={session} before={() => engine.pause()} /></div>}
      </main>
      <aside className={s.panel} aria-label={tx('settings')} inert={!panel}>
        <div className={s.ptabs}><Seg role="tablist" size="sm" fit value={tab} onChange={setTab} options={TABS.map(([k, l]) => [k, tx(l)])} /><IconButton n="close" size="sm" label={tx('panel.hide')} onClick={() => setPanel(false)} /></div>
        <div className={s.pane} key={tab}>{props && <>
          {tab === 'lyrics' && <LyricsPane s={props.s} />}
          {tab === 'look' && <><ThemePane {...props} /><LookPane {...props} media={<MediaBox s={props.s} />} /><TextPane {...props} /></>}
          {tab === 'motion' && <MotionPane {...props} />}
          {tab === 'fx' && <EffectsPane {...props} />}
          {tab === 'end' && <EndPane {...props} />}
        </>}</div>
        {web && <footer className={s.pfoot}><label htmlFor="lang">{tx('lang')}</label>
          <Dropdown id="lang" label={tx('lang')} value={currentLang()} options={LANGS.map(([v, n]) => [v, n])} onChange={v => import('../../uifont').then(m => { m.applyUiFont(v); import('../../../i18n').then(i => i.setLang(v as Lang)); try { localStorage.setItem('cz-lang', v); } catch { /* private */ } })} /></footer>}
      </aside>
      <nav className={s.bar} aria-label={tx('transport')}>
        <IconButton n={engine.isPlaying ? 'pause' : 'play'} solid size="lg" iconSize={20} label={tx(engine.isPlaying ? 'pause' : 'play')} onClick={() => engine.toggle()} />
        <Clock />
        {session ? <Timeline s={session} /> : <div />}
        <div className={s.tools}>
          <IconButton n="repeat" label={tx('loop')} pressed={engine.loop} onClick={() => { engine.loop = !engine.loop; ws.set({ rev: ws.get().rev + 1 }); }} />
          {session?.audio && <IconButton n={engine.muted ? 'mute' : 'volume'} label={tx('mute')} pressed={engine.muted} onClick={() => { engine.setMuted(!engine.muted); ws.set({ rev: ws.get().rev + 1 }); }} />}
          <IconButton n="sliders" label={tx(panel ? 'panel.hide' : 'panel.show')} pressed={panel} onClick={() => { if (!wide()) setExp(false); setPanel(p => !p); }} />
          <IconButton n="full" label={tx('fullscreen')} onClick={fullscreen} />
          <Button kind="primary" size="sm" icon="download" aria-expanded={exp} onClick={() => { if (!wide()) setPanel(false); setExp(x => !x); }}>{tx('x.open')}</Button>
        </div>
      </nav>
    </div>
  );
}
function Clock() {
  const cur = useRef<HTMLElement>(null), tot = useRef<HTMLSpanElement>(null);
  useEffect(() => engine.on('tick', p => { if (cur.current) cur.current.textContent = fmt(p.t); if (tot.current) tot.current.textContent = ' / ' + fmt(p.dur); }), []);
  return <span className={s.time}><b ref={cur}>00:00.00</b><span ref={tot}> / 00:00.00</span></span>;
}
/** Title and credits; tempo, bar and beat (through refs on every tick). */
function Hud({ s: ss }: { s: Session }) {
  const bar = useRef<HTMLElement>(null), pips = useRef<HTMLSpanElement>(null), meter = ss.map.meter;
  useEffect(() => engine.on('tick', p => { const b = ss.map.beatAt(p.t), bi = Math.floor(b.inBar), br = String(Math.max(1, b.bar + 1)).padStart(2, '0');
    if (bar.current && bar.current.textContent !== br) bar.current.textContent = br;
    if (pips.current) [...pips.current.children].forEach((x, k) => ((x as HTMLElement).dataset.on = String(k === bi))); }), [ss]);
  return (
    <div className={s.hud + ' glass on-picture'} title={tx(ss.map.hasAudio ? 'beats.audio' : 'beats.grid')}>
      <span><b>{+ss.map.bpm.toFixed(1)}</b> BPM</span>
      <span>{tx('bar')} <b ref={bar}>01</b></span>
      <span className={s.pips} ref={pips} aria-hidden="true">{Array.from({ length: meter }, (_, k) => <i key={k} />)}</span>
      <span>{ss.custom ? (ss.style.name || tx('custom')) : tx('preset.' + ss.style.preset)}</span>
    </div>
  );
}
/** The song at a glance: level, bars and phrase starts, words, strong beats and drops, transitions, idle stretches, the ending. */
function Timeline({ s: ss }: { s: Session }) {
  const box = useRef<HTMLDivElement>(null), d = Math.max(0.01, ss.dur), plan = ss.plan;
  const data = useMemo(() => {
    const m = ss.map, a = ss.analysis, n = 360, level = a ? Array.from({ length: n }, (_, i) => m.level(i / (n - 1) * ss.musicEnd)) : null;
    const bars: { t: number; phrase: boolean }[] = []; for (let b = 0; b < 2000; b++) { const t = m.barTime(b); if (t > d) break; if (t >= 0) bars.push({ t, phrase: b % 4 === 0 }); }
    return { level, bars, words: plan.words.map(w => ({ t: w.w.t, line: w.k === 0 })), hits: m.eventsIn(0, ss.musicEnd, 2).map(e => e.t), drops: m.sections.filter(x => x.drop).map(x => x.t0),
      trans: plan.passages.map(p => p.t), idle: plan.camera.idle };
  }, [ss.version, ss.plan]);
  useEffect(() => engine.on('tick', p => { box.current?.style.setProperty('--k', String(Math.min(1, Math.max(0, p.t / d)))); }), [d]);
  const at = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * d; };
  const pc = (t: number) => `${(t / d) * 100}%`;
  return (
    <div className={s.tl} ref={box} role="slider" tabIndex={0} aria-label={tx('tl.label')} title={tx('tl.title')} aria-valuemin={0} aria-valuemax={+d.toFixed(1)}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); engine.seek(at(e), true); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) engine.seek(at(e), true); }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) engine.seek(at(e), false); }}>
      {data.level && <svg viewBox={`0 0 ${data.level.length - 1} 1`} preserveAspectRatio="none" aria-hidden="true"><path d={`M0 1 ${data.level.map((v, i) => `L${i} ${(1 - v * 0.9).toFixed(3)}`).join(' ')} L${data.level.length - 1} 1 Z`} /></svg>}
      <div className={s.lane} aria-hidden="true">
        {data.idle.map((I, i) => <i key={'i' + i} className={s.idle} style={{ left: pc(I.a), width: pc(I.b - I.a) }} />)}
        {data.bars.map((b, i) => <i key={'b' + i} className={b.phrase ? s.phrase : s.bar1} style={{ left: pc(b.t) }} />)}
        {data.trans.map((t, i) => <i key={'t' + i} className={s.trans} style={{ left: pc(t) }} />)}
        {data.words.map((w, i) => <i key={'w' + i} className={s.word} style={{ left: pc(w.t), height: w.line ? 10 : 6 }} />)}
        {data.hits.map((t, i) => <i key={'h' + i} className={s.hit} style={{ left: pc(t) }} />)}
        {data.drops.map((t, i) => <i key={'d' + i} className={s.drop} style={{ left: pc(t) }} />)}
        <i className={s.endz} style={{ width: pc(ss.endLen) }} />
      </div>
      <i className={s.tfill} /><i className={s.thead} />
    </div>
  );
}

function LyricsPane({ s: ss }: { s: Session }) {
  const st = useStore(ws, x => x.status), audioName = useStore(ws, x => x.audioName), analyzing = useStore(ws, x => x.analyzing);
  const [text, setText] = useState(ss.spec.lyrics), [bpm, setBpm] = useState(String(ss.spec.bpm || 120)), [projMsg, setProjMsg] = useState(''), editing = useRef(false), ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing.current) setText(ss.spec.lyrics); }, [ss, ss.spec.lyrics]);
  useEffect(() => { setBpm(String(+(ss.spec.bpm || 120).toFixed(1))); }, [ss.spec.bpm]);
  const audioFile = useRef<HTMLInputElement>(null), projFile = useRef<HTMLInputElement>(null);
  const exportProject = async () => {
    const p = projectData(); if (!p) return; const name = `${(p.song.title || 'cadenza').replace(/[\\/:*?"<>|\s]+/g, '-')}.json`, json = JSON.stringify(p, null, 2);
    try { if (desktop) { const path = await pickSavePath(name, 'json'); if (!path) return; await D!.saveText(path, json); setProjMsg(tx('x.savedTo', { path })); }
      else { await offerFile(name, new Blob([json], { type: 'application/json' })); setProjMsg(tx('x.saved')); } } catch { setProjMsg(tx('x.unavail')); }
  };
  return (
    <>
      <Section>
        <Note>{tx('lyr.intro')}</Note>
        <details className={s.help}><summary>{tx('lyr.fmt')}</summary>
          <h4>{tx('lyr.line')}</h4><pre>{'[00:04.00] 我們 沿著 街道\n[00:04.00] we walk down the street'}</pre>
          <h4>{tx('lyr.kar')}</h4><pre>{'[01:20.81]<01:20.810>穿<01:21.240>過 <01:21.960>光<01:24.400>'}</pre>
          <p dangerouslySetInnerHTML={{ __html: tx('lyr.karHelp') }} />
          <h4>{tx('lyr.marks')}</h4><pre>{'[01:02.00]#1 夜に駆ける\n[01:10.00]I love you (love you)'}</pre>
          <p dangerouslySetInnerHTML={{ __html: tx('lyr.marksHelp') }} /><p>{tx('lyr.auto')}</p></details>
        <CueBar target={ta} />
        <textarea ref={ta} className={s.lyrics} spellCheck={false} aria-label={tx('lyr.ta')} value={text} onFocus={() => { editing.current = true; }} onKeyDown={cueKeyDown} onChange={e => setText(e.target.value)} />
        <Row>
          <TextField label="BPM" value={bpm} inputMode="decimal" onCommit={v => { setBpm(v); edit(x => x.setTiming({ bpm: Math.max(40, Math.min(240, +v || 120)) })); }} />
          <Button size="sm" disabled={!ss.analysis} title={ss.analysis ? '' : tx('bpm.need')} onClick={() => ss.analysis && edit(x => x.setTiming({ bpm: +ss.analysis!.tempo.bpm.toFixed(1) }))}>{tx('bpm.detect')}</Button>
        </Row>
        <Row>
          <Button kind="primary" size="sm" onClick={() => { editing.current = false; applyLyrics(text, bpm); }}>{tx('apply')}</Button>
          <Button kind="ghost" size="sm" onClick={() => { editing.current = false; resetDemo(); }}>{tx('reset')}</Button>
        </Row>
        {st.lyrics && <Note>{st.lyrics}</Note>}
      </Section>
      <Section title={tx('aud.h')} note={tx('aud.help')}>
        <Row>
          <Button size="sm" icon="note" disabled={analyzing} onClick={() => audioFile.current?.click()}>{tx('aud.import')}</Button>
          {audioName && <Button kind="ghost" size="sm" onClick={clearAudio}>{tx('remove')}</Button>}
          <input ref={audioFile} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importAudio(f); e.target.value = ''; }} />
        </Row>
        {st.audio && <Note>{st.audio}</Note>}
        <Slider label={tx('lshift')} min={-1500} max={1500} step={10} value={ss.spec.lshift || 0} format={v => `${v > 0 ? '+' : ''}${Math.round(v)} ms`} onChange={v => edit(x => x.setTiming({ lshift: v }))} />
        <TextField label={tx('aud.range')} value={ss.spec.range || ''} placeholder={tx('aud.range.ph')} onCommit={v => edit(x => x.setTiming({ range: v }))} />
        <Check label={tx('aud.fade')} checked={ss.spec.fade !== false} onChange={v => edit(x => { x.spec.fade = v; })} />
        <Note>{tx('lshift.help')} {tx('aud.rangeHelp')}</Note>
      </Section>
      <Section title={tx('proj.h')} note={tx('proj.help')}>
        <Row>
          <Button size="sm" onClick={exportProject}>{tx('proj.export')}</Button>
          <Button size="sm" onClick={() => projFile.current?.click()}>{tx('proj.import')}</Button>
          <input ref={projFile} type="file" accept=".json,application/json" hidden onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
            try { await importProject(f); setProjMsg(tx('proj.imported', { name: f.name })); } catch { setProjMsg(tx('proj.bad')); } }} />
        </Row>
        {projMsg && <Note>{projMsg}</Note>}
      </Section>
    </>
  );
}
/** The cover and the background video of the project. */
function MediaBox({ s: ss }: { s: Session }) {
  const st = useStore(ws, x => x.status), video = useStore(ws, x => x.video), cf = useRef<HTMLInputElement>(null), vf = useRef<HTMLInputElement>(null), S = ss.style;
  return (
    <>
      {S.bgStyle === 'cover' && <Row>
        <Button size="sm" icon="image" onClick={() => cf.current?.click()}>{tx('cv.import')}</Button>
        {ss.cover && <Button kind="ghost" size="sm" onClick={clearCover}>{tx('remove')}</Button>}
        <input ref={cf} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importCover(f); e.target.value = ''; }} />
      </Row>}
      {S.bgStyle === 'cover' && <Note>{st.cover || (ss.cover ? '' : tx('cv.none'))}</Note>}
      {S.bgStyle === 'video' && <>
        <Row>
          <Button size="sm" icon="film" onClick={() => vf.current?.click()}>{tx('vd.import')}</Button>
          {video.name && <Button kind="ghost" size="sm" onClick={clearVideo}>{tx('remove')}</Button>}
          <input ref={vf} type="file" accept="video/*,.mp4,.mov,.webm,.m4v" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importVideo(f); e.target.value = ''; }} />
        </Row>
        <Note>{st.video || tx('vd.none')}</Note>
        <Slider label={tx('vd.dark')} min={0.2} max={0.9} step={0.01} value={S.vidDark ?? 0.6} format={v => v.toFixed(2)} onChange={v => edit(x => x.setStyle('vidDark', v))} />
        <Slider label={tx('vd.blur')} min={0} max={1} step={0.05} value={S.vidBlur ?? 0.35} format={v => v.toFixed(2)} onChange={v => edit(x => x.setStyle('vidBlur', v))} />
        <Slider label={tx('vd.desat')} min={0} max={1} step={0.05} value={S.vidDesat ?? 0.35} format={v => v.toFixed(2)} onChange={v => edit(x => x.setStyle('vidDesat', v))} />
        <Check label={tx('vd.fit')} checked={!!S.vidFit} onChange={v => edit(x => x.setStyle('vidFit', v))} />
        <Row><TextField label={tx('vd.start')} value={video.start} placeholder={tx('vd.start.ph')} inputMode="decimal" onCommit={v => setVideoOpt('start', v)} /><Check label={tx('vd.loop')} checked={video.loop} onChange={v => setVideoOpt('loop', v)} /></Row>
        <Note>{tx('vd.help')}</Note>
      </>}
    </>
  );
}
export { canvas, storedStyle };
