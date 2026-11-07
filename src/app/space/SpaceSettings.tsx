// The space's settings page: a glass card over the cathedral (the renderer draws the glass behind every .card). The
// walking keys and immersive mode live here (no guide card in the room); the rest are the space's own settings and the
// handful of Cadenza's the room needs at hand. Everything is saved to Cadenza's settings, so both interfaces share it.
import { useEffect, useRef, type ReactNode } from 'react';
import { tx, LANGS, currentLang, type Lang } from '../../i18n';
import { settings, lib, useStore } from '../state';
import { Lib, D, type Settings } from '../bridge';
import { setSettings, setLang } from '../actions/settings';
import { Seg, Toggle, Slider, Button, Dropdown } from '../ui/kit';
import { FontPicker } from '../ui/fonts';
import { ts } from './i18n';
import s from './SpaceSettings.module.css';

export type SpaceSection = 'guide' | 'light' | 'audio' | 'lyrics' | 'look' | 'library';

const Group = ({ id, title, children }: { id: SpaceSection; title: string; children: ReactNode }) =>
  <section className={s.group} data-section={id}><h3>{title}</h3><div className={s.body}>{children}</div></section>;
const Field = ({ label, help, children }: { label: string; help?: string; children: ReactNode }) =>
  <div className={s.field}><div><span>{label}</span>{help && <small>{help}</small>}</div>{children}</div>;

export function SpaceSettings({ section, onClose }: { section?: string; onClose: () => void }) {
  const st = useStore(settings), folders = useStore(lib, x => x.folders), body = useRef<HTMLDivElement>(null);
  const set = (p: Partial<Settings>) => { setSettings(p); };
  useEffect(() => { const el = section ? body.current?.querySelector(`[data-section="${section}"]`) : null; el?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [section]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <section className={`hud card ${s.panel}`} aria-label={ts('s.title')} data-test="space-settings">
      <header className={s.head}><h2>{ts('s.title')}</h2><button type="button" className={s.close} onClick={onClose} aria-label={ts('close')}>✕</button></header>
      <div className={s.scroll} ref={body}>
        <Group id="guide" title={ts('g.guide')}>
          <ul className={s.keys}>{['k.look', 'k.walk', 'k.wall', 'k.pages', 'k.sit', 'k.keys'].map(k => <li key={k}>{ts(k)}</li>)}</ul>
          <Toggle label={ts('immersive')} help={ts('immersive.help')} on={!!st.spaceImmersive} set={v => set({ spaceImmersive: v })} />
          <Toggle label={ts('follow')} help={ts('follow.help')} on={!!st.spaceFollow} set={v => set({ spaceFollow: v })} />
          <Slider label={ts('walk')} value={st.spaceWalk || 1} min={.5} max={2} step={.1} onCommit={v => set({ spaceWalk: v })} format={v => v.toFixed(1) + '×'} />
          <Slider label={ts('lookSpeed')} value={st.spaceLook || 1} min={.4} max={2} step={.1} onCommit={v => set({ spaceLook: v })} format={v => v.toFixed(1) + '×'} />
          <Toggle label={ts('reduced')} help={ts('reduced.help')} on={!!st.spaceReduced} set={v => set({ spaceReduced: v })} />
        </Group>
        <Group id="light" title={ts('g.light')}>
          <Field label={ts('tint')} help={ts('tint.help')}>
            <Seg size="sm" value={st.spaceTint === 'fixed' ? 'fixed' : 'cover'} onChange={v => set({ spaceTint: v })} options={[['cover', ts('tint.cover')], ['fixed', ts('tint.fixed')]]} />
          </Field>
          {st.spaceTint === 'fixed' && <Field label={ts('tint.pick')}><input className={s.color} type="color" value={st.spaceTintColor || '#D97757'} onChange={e => set({ spaceTintColor: e.target.value })} aria-label={ts('tint.pick')} /></Field>}
          <Toggle label={ts('beams')} on={st.spaceBeams !== false} set={v => set({ spaceBeams: v })} />
          <Toggle label={ts('beatBeams')} on={st.spaceBeatBeams !== false} set={v => set({ spaceBeatBeams: v })} />
          <Toggle label={ts('pulse')} help={ts('pulse.help')} on={st.spacePulse !== false} set={v => set({ spacePulse: v })} />
          <Toggle label={ts('dream')} on={st.spaceDream !== false} set={v => set({ spaceDream: v })} />
          <Field label={ts('line')}><Seg size="sm" value={st.spaceLine || 'mid'} onChange={v => set({ spaceLine: v })} options={[['thin', ts('line.thin')], ['mid', ts('line.mid')], ['bold', ts('line.bold')]]} /></Field>
          <Field label={ts('shadow')}><Seg size="sm" value={st.spaceShadow || 'high'} onChange={v => set({ spaceShadow: v })} options={[['high', ts('q.high')], ['mid', ts('q.mid')], ['low', ts('q.low')]]} /></Field>
          <Field label={tx('s.set.gfx')} help={tx('s.set.gfx.' + (st.gfx === 'optimized' || st.gfx === 'lite' ? st.gfx : 'default') + 'Help')}>
            <Seg size="sm" value={st.gfx === 'optimized' || st.gfx === 'lite' ? st.gfx : 'default'} onChange={v => set({ gfx: v })} options={[['default', tx('s.set.gfx.default')], ['optimized', tx('s.set.gfx.optimized')], ['lite', tx('s.set.gfx.lite')]]} />
          </Field>
          <Field label={tx('s.set.scale')}><Seg size="sm" value={String(st.spaceScale || 1)} onChange={v => set({ spaceScale: +v })} options={[['1', '100%'], ['0.75', '75%'], ['0.5', '50%']]} /></Field>
        </Group>
        <Group id="audio" title={ts('g.audio')}>
          <Field label={tx('s.set.out')}><Seg size="sm" value={st.audioOut === 'hifi' ? 'hifi' : 'standard'} onChange={v => set({ audioOut: v })} options={[['standard', tx('s.set.out.std')], ['hifi', tx('s.set.out.hifi')]]} /></Field>
          <Toggle label={tx('s.set.balance')} on={st.volBalance !== false} set={v => set({ volBalance: v })} />
          <Toggle label={ts('ambient')} help={ts('ambient.help')} on={st.spaceAmbient !== false} set={v => set({ spaceAmbient: v })} />
          <Slider label={ts('ambientVol')} value={st.spaceAmbientVol ?? .6} min={0} max={1} step={.05} onCommit={v => set({ spaceAmbientVol: v })} format={v => Math.round(v * 100) + '%'} />
        </Group>
        <Group id="lyrics" title={ts('g.lyrics')}>
          <Field label={ts('lyricFont')} help={ts('lyricFont.help')}><FontPicker label={ts('lyricFont')} value={st.spaceFont || 'sansmed'} onChange={v => set({ spaceFont: v })} /></Field>
          <Toggle label={tx('s.set.fxCapSubs')} on={st.fxCapSubs !== false} set={v => set({ fxCapSubs: v })} />
          <Toggle label={tx('s.set.fxCapReads')} on={st.fxCapReads !== false} set={v => set({ fxCapReads: v })} />
          <Field label={ts('lyricSize')}><Seg size="sm" value={st.spaceLyric || 'm'} onChange={v => set({ spaceLyric: v })} options={[['s', ts('size.s')], ['m', ts('size.m')], ['l', ts('size.l')]]} /></Field>
        </Group>
        <Group id="look" title={ts('g.look')}>
          <Field label={tx('s.set.uiMode.pick')} help={tx('s.set.uiMode.help')}>
            <Seg size="sm" value={st.ui === 'space' ? 'space' : 'classic'} onChange={v => set({ ui: v })} options={[['classic', tx('s.set.uiMode.classic')], ['space', tx('s.set.uiMode.space')]]} />
          </Field>
          <div><Button size="sm" icon="refresh" onClick={() => D?.relaunch()}>{tx('s.set.uiMode.restart')}</Button></div>
          <Field label={tx('s.set.lang')}><Dropdown value={currentLang()} options={LANGS.map(([k, n]) => [k, n] as [string, string])} onChange={v => setLang(v as Lang)} /></Field>
        </Group>
        <Group id="library" title={ts('g.library')}>
          <ul className={s.folders}>{folders.map(f => <li key={f}><span title={f}>{f}</span><button type="button" onClick={() => Lib?.removeFolder(f).then(v => lib.set(v))} aria-label={tx('remove')}>✕</button></li>)}</ul>
          <div className={s.row}><Button size="sm" icon="plus" onClick={() => Lib?.addFolder().then(v => lib.set(v))}>{tx('s.addFolder')}</Button><Button size="sm" icon="refresh" onClick={() => Lib?.rescan()}>{tx('s.set.rescan')}</Button></div>
        </Group>
      </div>
    </section>
  );
}
