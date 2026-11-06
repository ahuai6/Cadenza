// The app's own settings: appearance, music folders, start at login and the tray, audio output, preview performance.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { tx, LANGS, currentLang, words, type Lang } from '../../i18n';
import { UI_FONTS, applyUiFont } from '../uifont';
import { D, Lib, Infer, type Settings } from '../bridge';
import { settings, lib, useStore } from '../state';
import { Icon } from '../ui/icons';
import { Button, Seg, Toggle, Note, Slider, Dropdown } from '../ui/kit';
import { hifi, refresh as hifiRefresh } from '../playback/hifi';
import { neuralStatus, neuralRecheck, DEBUG } from '../../engine';
import { setLang, setSettings } from '../actions/settings';
import { askConfirm } from './Modals';
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
      <SettingsIndex />
      <div className={s.doc + ' stagger'}>
      <header className={s.head}><span className="kicker">Cadenza {st.version || ''}</span><h1 className="display">{tx('s.settings')}</h1></header>
      <Group title={tx('s.set.look')}>
        <Field label={tx('s.set.theme')}><Seg size="sm" fit value={st.theme} onChange={v => set({ theme: v })} options={[['system', tx('s.set.system')], ['light', tx('s.set.light')], ['dark', tx('s.set.dark')]]} /></Field>
        {st.theme !== 'dark' && <Field label={tx('s.set.tone')}><Seg size="sm" fit value={st.tone === 'white' ? 'white' : 'paper'} onChange={v => set({ tone: v })} options={[['paper', tx('s.set.tone.paper')], ['white', tx('s.set.tone.white')]]} /></Field>}
        <Field label={tx('s.set.uiFont')}><Dropdown label={tx('s.set.uiFont')} value={st.uiFont || 'default'} options={Object.keys(UI_FONTS).map(k => [k, tx('s.set.uiFont.' + k)])}
          onChange={async v => { await applyUiFont(currentLang(), v, words(currentLang())); set({ uiFont: v }); }} /></Field>
        <Field label={tx('s.set.lang')}><Dropdown label={tx('s.set.lang')} value={currentLang()} onChange={v => setLang(v as Lang)} options={LANGS.map(([v, n]) => [v, n])} /></Field>
      </Group>
      <Group title={tx('s.set.fxCaps')} help={tx('s.set.fxCapsHelp')}>
        <Toggle label={tx('s.set.fxCapSubs')} on={st.fxCapSubs !== false} set={v => set({ fxCapSubs: v })} />
        <Toggle label={tx('s.set.fxCapReads')} on={st.fxCapReads !== false} set={v => set({ fxCapReads: v })} />
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
        <Note><Icon n="alert" size={14} /> {tx('s.set.photosens')}</Note>
        <MvLook />
      </Group>
      <Group title={tx('s.set.perf')} help={tx('s.set.scaleHelp')}>
        <Field label={tx('s.set.gfx')}><Seg size="sm" fit value={st.gfx === 'optimized' || st.gfx === 'lite' ? st.gfx : 'default'} onChange={v => set({ gfx: v })} options={[['default', tx('s.set.gfx.default')], ['optimized', tx('s.set.gfx.optimized')], ['lite', tx('s.set.gfx.lite')]]} /></Field>
        <Note>{tx('s.set.gfx.' + (st.gfx === 'optimized' || st.gfx === 'lite' ? st.gfx : 'default') + 'Help')}</Note>
        <Field label={tx('s.set.scale')}><Seg size="sm" fit value={String(st.scale)} onChange={v => set({ scale: v === 'auto' ? 'auto' : +v })} options={SCALES.map(v => [String(v), v === 'auto' ? tx('s.set.scale.auto') : tx('s.set.scale.p', { n: Math.round(v * 100) })])} /></Field>
        <Field label={tx('s.set.fps')}><Seg size="sm" fit value={+st.fps} onChange={v => set({ fps: v })} options={FPS.map(v => [v, v ? `${v} fps` : tx('s.set.fps.none')])} /></Field>
        <Toggle label={tx('s.set.prerender')} help={tx('s.set.prerenderHelp')} on={st.prerender !== false} set={v => set({ prerender: v })} />
        <Toggle label={tx('s.set.gpuLyrics')} help={tx('s.set.gpuLyricsHelp')} on={st.gpuLyrics !== false} set={v => set({ gpuLyrics: v })} />
        <Toggle label={tx('s.set.perfHud')} help={tx('s.set.perfHudHelp')} on={!!st.perfHud} set={v => set({ perfHud: v })} />
        <Toggle label={tx('s.set.debugLog')} help={tx('s.set.debugLogHelp')} on={!!st.debugLog} set={v => set({ debugLog: v })} />
        {st.debugLog && <div><Button size="sm" icon="download" onClick={() => saveDebugLog(st.version || '')}>{tx('s.set.debugExport')}</Button></div>}
      </Group>
      <DataGroup />
      <Group title={tx('s.set.about')}><Note>{tx('s.set.aboutText', { v: st.version || '' })}</Note></Group>
      </div>
    </div>
  );
}
// the library's stored data: caches (rhythm analyses, thumbnails, loudness) cleared, every song analysed again, or
// everything reset (the app starts afresh)
function DataGroup() {
  const ask = (k: string, danger = false) => askConfirm(tx(`s.set.data.${k}`), tx(`s.set.data.${k}Ask`), tx(`s.set.data.${k}Yes`), danger);
  return (
    <Group title={tx('s.set.data')} help={tx('s.set.dataHelp')}>
      <div className={s.btns}>
        <Button size="sm" icon="refresh" onClick={async () => { if (await ask('reanalyze')) { await Lib!.reanalyze('all'); Lib!.rescan(); } }}>{tx('s.set.data.reanalyze')}</Button>
        <Button size="sm" onClick={async () => { if (await ask('caches')) { await Lib!.clearCaches(); Lib!.rescan(); } }}>{tx('s.set.data.caches')}</Button>
        <Button size="sm" kind="danger" icon="trash" onClick={async () => { if (await ask('reset', true)) Lib!.resetAll(); }}>{tx('s.set.data.reset')}</Button>
      </div>
    </Group>
  );
}
// the rhythm engine: the neural one (on the GPU, where it can run) or the built-in analysis; what runs it, or why not
function RhythmGroup({ st }: { st: Settings }) {
  const [ns, setNs] = useState<{ ok: boolean; device?: string; reason?: string; native?: boolean } | null>(null), eng = st.rhythmEngine === 'dsp' || st.rhythmEngine === 'neural' ? st.rhythmEngine : 'auto', auto = eng !== 'dsp';
  const [tick, setTick] = useState(0), recheck = () => { neuralRecheck(); setTick(t => t + 1); };
  useEffect(() => { let on = true; if (auto) neuralStatus().then(v => on && setNs(v)); return () => { on = false; }; }, [auto, tick, st.rhythmRuntime, st.rhythmDevice]);
  return (
    <Group title={tx('s.set.rhythm')} help={tx('s.set.rhythmHelp')}>
      <Field label={tx('s.set.engine')}><Seg size="sm" fit value={eng} onChange={v => setSettings({ rhythmEngine: v })} options={[['auto', tx('s.set.engine.auto')], ['neural', tx('s.set.engine.neural')], ['dsp', tx('s.set.engine.dsp')]]} /></Field>
      {auto && <Toggle label={tx('s.set.drums')} help={tx('s.set.drumsHelp')} on={st.rhythmDrums !== false} set={v => setSettings({ rhythmDrums: v })} />}
      {auto && Infer && <NativeRows st={st} onChange={recheck} />}
      {auto && ns && <Note>{ns.ok ? tx('s.set.engine.on', { d: ns.native ? deviceName(ns.device) : ns.device || 'GPU' }) : tx(eng === 'neural' ? 's.set.engine.offForced' : 's.set.engine.off', { r: ns.reason || '' })}</Note>}
      {eng === 'neural' && <Note>{tx('s.set.engine.neuralHelp')}</Note>}
      <Note>{tx('s.set.engine.note')}</Note>
      <Field label={tx('s.set.stream')}><Seg size="sm" fit value={st.rhythmStream === 'full' ? 'full' : 'stream'} onChange={v => setSettings({ rhythmStream: v })} options={[['stream', tx('s.set.stream.on')], ['full', tx('s.set.stream.off')]]} /></Field>
      <Note>{tx('s.set.stream.note')}</Note>
    </Group>
  );
}
const EPS: Record<string, string> = { dml: 'DirectML', coreml: 'Core ML', cpu: 'CPU' };
/** 'native dml' → "this computer (DirectML)"; before its first run the provider is not known yet. */
function deviceName(d = '') { const ep = d.split(' ')[1]; return tx('s.set.native.dev', { ep: ep ? EPS[ep] || ep : tx('s.set.native.epAuto') }); }
// the desktop app's own runtime for the networks (ONNX Runtime: DirectML on Windows, Core ML on macOS), in place of the
// page's WebGPU kernels: which of the two, its models (downloaded on request) and the device it uses
function NativeRows({ st, onChange }: { st: Settings; onChange: () => void }) {
  const [is, setIs] = useState<Awaited<ReturnType<NonNullable<typeof Infer>['status']>> | null>(null), [prog, setProg] = useState<number | null>(null), [err, setErr] = useState('');
  const look = () => Infer!.status().then(setIs).catch(() => setIs(null));
  useEffect(() => { look(); return Infer!.onProgress(k => setProg(k)); }, []);
  const rt = st.rhythmRuntime === 'webgpu' ? 'webgpu' : 'auto';
  async function fetchModels() {
    setErr(''); setProg(0);
    const r = await Infer!.download(); setProg(null); await look();
    if (r.ok) onChange(); else setErr(r.why || '');
  }
  if (!is?.runtime) return null;
  const mb = Math.round(is.size / 1e6);
  return <>
    <Field label={tx('s.set.native')}><Seg size="sm" fit value={rt} onChange={v => setSettings({ rhythmRuntime: v })} options={[['auto', tx('s.set.native.auto')], ['webgpu', tx('s.set.native.webgpu')]]} /></Field>
    {rt === 'auto' && (is.models
      ? <Field label={tx('s.set.native.device')}><Seg size="sm" fit value={st.rhythmDevice === 'cpu' ? 'cpu' : 'auto'} onChange={v => setSettings({ rhythmDevice: v })} options={[['auto', tx('s.set.native.devAuto')], ['cpu', tx('s.set.native.devCpu')]]} /></Field>
      : <Field label={tx('s.set.native.models')}>{prog != null || is.downloading
          ? <span>{tx('s.set.native.loading', { pct: Math.round((prog ?? 0) * 100) })}</span>
          : <Button size="sm" onClick={fetchModels}>{tx('s.set.native.get', { mb })}</Button>}</Field>)}
    {rt === 'auto' && !is.models && <Note>{err ? tx('s.set.native.failed', { r: err }) : tx('s.set.native.help', { mb })}</Note>}
  </>;
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
          <Dropdown label={tx('s.set.device')} value={st.audioDevice || ''} onChange={v => set({ audioDevice: v })} options={[['', tx('s.set.device.def')], ...h.devices.map(d => [d.id, d.name] as [string, string])]} />
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
// a group: its title and what it is for on the left, its controls on the right, a hairline above
const Group = ({ title, help, children }: { title: string; help?: string; children: ReactNode }) => <section className={s.group} data-group><header><h2>{title}</h2>{help && <Note>{help}</Note>}</header><div className={s.body}>{children}</div></section>;
/** The settings' parts, numbered, down the left: read from the page's own groups (a new group shows here by itself); the
 *  one in view marked, a click scrolls to it. */
function SettingsIndex() {
  const [items, setItems] = useState<string[]>([]), [cur, setCur] = useState(0), box = useRef<HTMLElement>(null), pinned = useRef<number | null>(null);
  const groups = () => [...(box.current?.parentElement?.querySelectorAll<HTMLElement>('[data-group]') || [])];
  useLayoutEffect(() => {
    const read = () => setItems(groups().map(g => g.querySelector('h2')?.textContent || ''));
    read(); const mo = new MutationObserver(read); if (box.current?.parentElement) mo.observe(box.current.parentElement, { childList: true, subtree: true, characterData: true });
    // (the one whose heading has passed the top; at the very bottom — where the last ones can never reach the top — the
    // last; and one picked from here stays marked until the page is scrolled by hand)
    const sc = box.current?.closest<HTMLElement>('[data-scroll]');
    const onScroll = () => { if (pinned.current != null) { setCur(pinned.current); return; }
      const gs = groups(), top = (sc?.getBoundingClientRect().top ?? 0) + 120; let k = 0; gs.forEach((g, i) => { if (g.getBoundingClientRect().top <= top) k = i; });
      if (sc && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) k = gs.length - 1; setCur(Math.max(0, k)); };
    const byHand = () => { pinned.current = null; };
    onScroll(); sc?.addEventListener('scroll', onScroll, { passive: true });
    for (const e of ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const) sc?.addEventListener(e, byHand, { passive: true });
    return () => { mo.disconnect(); sc?.removeEventListener('scroll', onScroll); for (const e of ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const) sc?.removeEventListener(e, byHand); };
  }, []);
  return (
    <nav className={s.index} ref={box} aria-label={tx('s.settings')}>
      <ol>{items.map((t, i) => <li key={i}><button type="button" aria-current={i === cur || undefined} onClick={() => { pinned.current = i; setCur(i); groups()[i]?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}>
        <span>{String(i + 1).padStart(2, '0')}</span>{t}</button></li>)}</ol>
    </nav>
  );
}
const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className={s.field}><span>{label}</span>{children}</div>;

/** The debug log as a text file the listener saves (and sends): the setup, the events, the frames. */
function saveDebugLog(version: string) {
  DEBUG.setup.version = version; DEBUG.setup.saved = new Date().toISOString();
  const blob = new Blob([DEBUG.text()], { type: 'text/plain' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `cadenza-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
