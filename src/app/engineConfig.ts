// The settings, as the engine's configuration (engine/config.ts): the one place the interface turns what the user chose
// into how the engine works. Applied whole at start, and again with each change of the settings it covers.
import { engine } from './playback/stage';
import { configure, type EngineConfig } from '../engine';
import { Infer, type Settings } from './bridge';
import type { NativeRuntime } from '../engine';

export function engineConfig(n: Partial<Settings>): EngineConfig {
  const gfx = n.gfx === 'optimized' || n.gfx === 'lite' ? n.gfx : 'default';
  return {
    render: { scale: n.scale === 'auto' || n.scale == null ? 'auto' : +n.scale || 1, fps: +(n.fps ?? 0) || 0, prerender: n.prerender !== false, gpu: n.gpuLyrics !== false, stats: !!n.perfHud },
    gfx,
    mv: { dark: n.mvDark ?? 0.34, blur: n.mvBlur ?? 0.12, desat: n.mvDesat ?? 0, fit: !!n.mvFit },
    // (the desktop app serves the neural engine's models as cadenza://model/)
    rhythm: { engine: n.rhythmEngine === 'dsp' || n.rhythmEngine === 'neural' ? n.rhythmEngine : 'auto', drums: n.rhythmDrums !== false, models: 'cadenza://model/',
      native: n.rhythmRuntime === 'webgpu' ? null : nativeRuntime() },
  };
}
const KEYS: Record<keyof EngineConfig, (k: string) => boolean> = {
  render: k => k === 'scale' || k === 'fps' || k === 'prerender' || k === 'gpuLyrics' || k === 'perfHud', gfx: k => k === 'gfx', mv: k => k.startsWith('mv'), rhythm: k => k === 'rhythmEngine' || k === 'rhythmDrums' || k === 'rhythmRuntime' || k === 'rhythmDevice',
};
/** Configure the engine from the settings: all of it, or (with the keys of a change) only the parts that change touches. */
export function applyEngineConfig(n: Partial<Settings>, changed?: string[]) {
  const all = engineConfig(n), c: Partial<EngineConfig> = {};
  for (const k of Object.keys(KEYS) as (keyof EngineConfig)[]) if (!changed || changed.some(KEYS[k])) (c as any)[k] = all[k];
  configure(engine, c);
  // (the interface follows the quality mode too: html[data-gfx] drops its own blurs in lite)
  if (c.gfx) document.documentElement.dataset.gfx = c.gfx;
}
/** The desktop app's native runtime for the rhythm engine's networks (electron/infer.cjs), when it has one: used once its
 *  models are downloaded (until then the WebGPU kernels run). One object for the app's life. */
let native: NativeRuntime | null | undefined;
function nativeRuntime(): NativeRuntime | null {
  if (native !== undefined) return native;
  if (!Infer) return (native = null);
  const I = Infer;
  return (native = { label: 'native', segment: 343980,
    async ready() { const st = await I.status(); this.label = st.ep ? 'native ' + st.ep : 'native'; return st.runtime && st.models; },
    beat: spect => I.run('beat', { spect }), separate: (left, right) => I.run('separate', { left, right }) });
}
