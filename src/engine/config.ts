// Everything the host sets about how the engine works, in one typed object and one call: the picture (render size, frame
// cap, pre-rendering, quality mode, the MV's look) and the rhythm analysis (which engine, the drum stem, where the
// models are). The settings of the layers below live in those layers (render/gfx.ts, rhythm/index.ts); this is the one
// place they are set from, so a host — the desktop interface, the workshop, a test — never reaches into them.
import type { Engine, RenderSettings } from './engine';
import type { MvLook } from '../render/frame';
import { setGfx, type GfxMode } from '../render/gfx';
import { setRhythmEngine, setNeuralDrums, setModelBase, setNativeRuntime, type RhythmEngine, type NativeRuntime } from '../rhythm';

export interface EngineConfig {
  render: Partial<RenderSettings>;
  /** the live picture's quality mode (exports always draw in 'default') */
  gfx: GfxMode;
  mv: MvLook;
  rhythm: { engine?: RhythmEngine; drums?: boolean; /** where the neural engine's model files are, or null for none */ models?: string | null;
    /** the networks run natively (the desktop app), or null for the WebGPU kernels */ native?: NativeRuntime | null };
}
/** Apply the parts of a configuration given; the rest stays as it is. */
export function configure(engine: Engine, c: Partial<EngineConfig>) {
  if (c.render) engine.setRender(c.render);
  if (c.gfx) { setGfx(c.gfx); engine.invalidate(); }
  if (c.mv) { engine.mvLook = { ...c.mv }; engine.invalidate(); }
  if (c.rhythm) { const r = c.rhythm;
    if (r.models !== undefined) setModelBase(r.models);
    if (r.engine) setRhythmEngine(r.engine);
    if (r.drums !== undefined) setNeuralDrums(r.drums);
    if (r.native !== undefined) setNativeRuntime(r.native); }
}
