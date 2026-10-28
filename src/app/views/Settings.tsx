// The app's own settings: appearance, music folders, start at login and the tray, audio output, preview performance.
import { useEffect, type ReactNode } from 'react';
import { tx, LANGS, currentLang, type Lang } from '../../i18n';
import { D, Lib, type Settings } from '../bridge';
import { settings, lib, useStore } from '../state';
import { Icon } from '../ui/icons';
import { Button, Seg, Toggle, Note } from '../ui/kit';
import { engine } from '../playback/stage';
import { switchOutput } from '../playback/player';
import { hifi, refresh as hifiRefresh } from '../playback/hifi';
import { setLang, renderSettings } from './Shell';
import s from './Settings.module.css';

const SCALES: ('auto' | number)[] = ['auto', 1, 0.85, 0.7, 0.55], FPS = [0, 120, 60, 30];
export async function setSettings(patch: Partial<Settings>) {
  settings.set(patch); const n = D ? await D.setSettings(patch) : { ...settings.get(), ...patch }; settings.set(n);
  if ('scale' in patch || 'fps' in patch || 'prerender' in patch) engine.setRender(renderSettings(n));
  if ('audioOut' in patch || 'audioMode' in patch || 'audioDevice' in patch) switchOutput();
  if ('fixedVolume' in patch) engine.setVolume(engine.volume);
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
      <Group title={tx('s.set.perf')} help={tx('s.set.scaleHelp')}>
        <Field label={tx('s.set.scale')}><Seg size="sm" fit value={String(st.scale)} onChange={v => set({ scale: v === 'auto' ? 'auto' : +v })} options={SCALES.map(v => [String(v), v === 'auto' ? tx('s.set.scale.auto') : tx('s.set.scale.p', { n: Math.round(v * 100) })])} /></Field>
        <Field label={tx('s.set.fps')}><Seg size="sm" fit value={+st.fps} onChange={v => set({ fps: v })} options={FPS.map(v => [v, v ? `${v} fps` : tx('s.set.fps.none')])} /></Field>
        <Toggle label={tx('s.set.prerender')} help={tx('s.set.prerenderHelp')} on={st.prerender !== false} set={v => set({ prerender: v })} />
      </Group>
      <Group title={tx('s.set.about')}><Note>{tx('s.set.aboutText', { v: st.version || '' })}</Note></Group>
    </div>
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
    </Group>
  );
}
const Group = ({ title, help, children }: { title: string; help?: string; children: ReactNode }) => <section className={s.group}><h2>{title}</h2>{help && <Note>{help}</Note>}<div className={s.body}>{children}</div></section>;
const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className={s.field}><span>{label}</span>{children}</div>;
