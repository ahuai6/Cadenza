// The app's own settings: appearance, music folders, start at login and the tray, audio output, preview performance.
import { useEffect, useState, type ReactNode } from 'react';
import { tx, LANGS, currentLang, type Lang } from '../../i18n';
import { D, Lib, type Settings } from '../bridge';
import { settings, lib, useStore } from '../state';
import { Icon } from '../ui/icons';
import { Button, Seg, Toggle, Note, Slider } from '../ui/kit';
import { hifi, refresh as hifiRefresh } from '../playback/hifi';
import { neuralStatus } from '../../engine';
import { setLang, setSettings } from '../actions/settings';
import s from './Settings.module.css';

const SCALES: ('auto' | number)[] = ['auto', 1, 0.85, 0.7, 0.55], FPS = [0, 120, 60, 30];
const pc = (v: number | string) => Math.round(+v * 100) + '%';
/** How a song's own MV sits behind the lyrics (app-wide: shown here and in a song's panel). */
export function MvLook() {
  const st = useStore(settings), set = setSettings;
  return <>
    <Slider label={tx('vd.dark')} min={0} max={0.9} step={0.01} value={st.mvDark ?? 0.34} format={pc} onChange={v => set({ mvDark: +v })} />
    <Slider label={tx('vd.blur')} min={0} max={1} step={0.01} value={st.mvBlur ?? 0.12} format={pc} onChange={v => set({ mvBlur: +v })} />
    <Slider label={tx('vd.desat')} min={0} max={1} step={0.01} value={st.mvDesat ?? 0} format={pc} onChange={v => set({ mvDesat: +v })} />
    <Toggle label={tx('vd.fit')} help={tx('vd.fitHelp')} on={!!st.mvFit} set={v => set({ mvFit: v })} />
  </>;
}
export function SettingsView() {
  const st = useStore(settings), folders = useStore(lib, x => x.folders);
  useEffect(() => { D?.settings().then(v => settings.set(v)); }, []);
  const set = setSettings;
  return (
    <div className={s.settings}>
      <h1>{tx('s.settings')}</h1>
      <Group title={tx('s.set.look')}>
        <Field label={tx('s.set.theme')}><Seg size="sm" fit value={st.theme} onChange={v => set({ theme: v })} options={[['system', tx('s.set.system')], ['light', tx('s.set.light')], ['dark', tx('s.set.dark')]]} /></Field>
        <Field label={tx('s.set.lang')}><select value={currentLang()} onChange={e => setLang(e.target.value as Lang)}>{LANGS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></Field>
      </Group>
      <Group title={tx('s.set.folders')} help={tx('s.set.watchHelp')}>
        <div className={s.folders}>
          {folders.map(f => (
            <div key={f} className={s.folder}><Icon n="folder" size={18} /><span title={f}>{f}</span>
              <Button kind="ghost" size="sm" onClick={() => Lib!.removeFolder(f).then(v => lib.set(v))}>{tx('s.set.remove')}</Button></div>
          ))}
        </div>
        <div className={s.btns}>
          <Button kind="primary" size="sm" icon="plus" onClick={() => Lib!.addFolder().then(v => lib.set(v))}>{tx('s.addFolder')}</Button>
          <Button size="sm" icon="refresh" onClick={() => Lib!.rescan()}>{tx('s.set.rescan')}</Button>
        </div>
        <Toggle label={tx('s.set.scanOnLaunch')} on={st.scanOnLaunch} set={v => set({ scanOnLaunch: v })} />
      </Group>
      <Group title={tx('s.set.system2')}>
        {st.platform !== 'linux' && <Toggle label={tx('s.set.openAtLogin')} on={st.openAtLogin} set={v => set({ openAtLogin: v })} />}
        <Toggle label={tx('s.set.tray')} on={st.closeToTray} set={v => set({ closeToTray: v })} />
      </Group>
      <AudioGroup st={st} />
      <RhythmGroup st={st} />
      <Group title={tx('s.set.mv')} help={tx('s.set.mvHelp')}>
        <MvLook />
      </Group>
      <Group title={tx('s.set.perf')} help={tx('s.set.scaleHelp')}>
        <Field label={tx('s.set.gfx')}><Seg size="sm" fit value={st.gfx === 'optimized' || st.gfx === 'lite' ? st.gfx : 'default'} onChange={v => set({ gfx: v })} options={[['default', tx('s.set.gfx.default')], ['optimized', tx('s.set.gfx.optimized')], ['lite', tx('s.set.gfx.lite')]]} /></Field>
        <Note>{tx('s.set.gfx.' + (st.gfx === 'optimized' || st.gfx === 'lite' ? st.gfx : 'default') + 'Help')}</Note>
        <Field label={tx('s.set.scale')}><Seg size="sm" fit value={String(st.scale)} onChange={v => set({ scale: v === 'auto' ? 'auto' : +v })} options={SCALES.map(v => [String(v), v === 'auto' ? tx('s.set.scale.auto') : tx('s.set.scale.p', { n: Math.round(v * 100) })])} /></Field>
        <Field label={tx('s.set.fps')}><Seg size="sm" fit value={+st.fps} onChange={v => set({ fps: v })} options={FPS.map(v => [v, v ? `${v} fps` : tx('s.set.fps.none')])} /></Field>
        <Toggle label={tx('s.set.prerender')} help={tx('s.set.prerenderHelp')} on={st.prerender !== false} set={v => set({ prerender: v })} />
      </Group>
      <Group title={tx('s.set.about')}><Note>{tx('s.set.aboutText', { v: st.version || '' })}</Note></Group>
    </div>
  );
}
// the rhythm engine: the neural one (on the GPU, where it can run) or the built-in analysis; what runs it, or why not
function RhythmGroup({ st }: { st: Settings }) {
  const [ns, setNs] = useState<{ ok: boolean; device?: string; reason?: string } | null>(null), eng = st.rhythmEngine === 'dsp' || st.rhythmEngine === 'neural' ? st.rhythmEngine : 'auto', auto = eng !== 'dsp';
  useEffect(() => { let on = true; if (auto) neuralStatus().then(v => on && setNs(v)); return () => { on = false; }; }, [auto]);
  return (
    <Group title={tx('s.set.rhythm')} help={tx('s.set.rhythmHelp')}>
      <Field label={tx('s.set.engine')}><Seg size="sm" fit value={eng} onChange={v => setSettings({ rhythmEngine: v })} options={[['auto', tx('s.set.engine.auto')], ['neural', tx('s.set.engine.neural')], ['dsp', tx('s.set.engine.dsp')]]} /></Field>
      {auto && <Toggle label={tx('s.set.drums')} help={tx('s.set.drumsHelp')} on={st.rhythmDrums !== false} set={v => setSettings({ rhythmDrums: v })} />}
      {auto && ns && <Note>{ns.ok ? tx('s.set.engine.on', { d: ns.device || 'GPU' }) : tx(eng === 'neural' ? 's.set.engine.offForced' : 's.set.engine.off', { r: ns.reason || '' })}</Note>}
      {eng === 'neural' && <Note>{tx('s.set.engine.neuralHelp')}</Note>}
      <Note>{tx('s.set.engine.note')}</Note>
    </Group>
  );
}
// the output: standard (the page's Web Audio) or Hi-Fi passthrough (the native player, WASAPI exclusive)
function AudioGroup({ st }: { st: Settings }) {
  const h = useStore(hifi), on = st.audioOut === 'hifi', set = setSettings;
  useEffect(() => { hifiRefresh(); }, []);
  const rates: number[] | null = h.caps && h.caps.rates && h.caps.rates.length ? h.caps.rates : null;
  const khz = (r: number) => (r / 1000).toFixed(r % 1000 ? 1 : 0);
  return (
    <Group title={tx('s.set.audio')} help={tx('s.set.audioHelp')}>
      <Field label={tx('s.set.out')}>
        <div className={s.segWrap}><Seg size="sm" fit value={on ? 'hifi' : 'standard'} onChange={v => { if (v === 'hifi' && !h.supported) return; set({ audioOut: v }); }} options={[['standard', tx('s.set.out.std')], ['hifi', tx('s.set.out.hifi')]]} /></div>
      </Field>
      {!h.supported && <Note>{tx('s.set.hifiNo')}</Note>}
      {on && h.supported && <>
        <Field label={tx('s.set.device')}>
          <select value={st.audioDevice || ''} onChange={e => set({ audioDevice: e.target.value })}>
            <option value="">{tx('s.set.device.def')}</option>{h.devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </Field>
        <Field label={tx('s.set.mode')}><Seg size="sm" fit value={st.audioMode === 'shared' ? 'shared' : 'exclusive'} onChange={v => set({ audioMode: v })} options={[['exclusive', tx('s.set.mode.ex')], ['shared', tx('s.set.mode.sh')]]} /></Field>
        <Toggle label={tx('s.set.fixedVol')} help={tx('s.set.fixedVolHelp')} on={st.fixedVolume !== false} set={v => set({ fixedVolume: v })} />
        <Note>{!h.running ? tx('s.set.hifiStart')
          : h.caps && st.audioMode !== 'shared' && !rates ? tx(h.caps.why === 'exclusive-not-allowed' ? 's.set.noExclAllowed' : 's.set.noExcl')
          : h.caps ? `${h.caps.name}${rates ? ' · ' + tx('s.set.rates', { r: rates.map(khz).join(' / ') + ' kHz' }) : ''}` : ''}</Note>
      </>}
      <Toggle label={tx('s.set.balance')} help={tx('s.set.balanceHelp')} on={st.volBalance !== false} set={v => set({ volBalance: v })} />
      {st.volBalance !== false && on && h.supported && st.fixedVolume !== false && h.hw && <Note>{tx(h.hw.supported ? 's.set.balanceHw' : 's.set.balanceNoHw')}</Note>}
    </Group>
  );
}
const Group = ({ title, help, children }: { title: string; help?: string; children: ReactNode }) => <section className={s.group + ' enter'}><h2>{title}</h2>{help && <Note>{help}</Note>}<div className={s.body}>{children}</div></section>;
const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className={s.field}><span>{label}</span>{children}</div>;
