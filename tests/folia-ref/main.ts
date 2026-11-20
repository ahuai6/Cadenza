// Folia's own visualizer runtimes with real Pixi, driven frame by frame with injected inputs: the reference Cadenza's
// port is measured against. Nothing here is Cadenza's code.
import { motionValue } from 'framer-motion';
import * as PIXI from 'pixi.js';
import { SonnetPixiRuntime } from '../src/components/visualizer/sonnet/createSonnetPixiRuntime';
import { TemperaPixiRuntime } from '../src/components/visualizer/tempera/createTemperaPixiRuntime';
import { compileSonnetProgram } from '../src/components/visualizer/sonnet/sonnetProgram';
import { compileTemperaProgram } from '../src/components/visualizer/tempera/temperaProgram';
import { DEFAULT_SONNET_TUNING, DEFAULT_TEMPERA_TUNING } from '../src/types';
import * as beatFxLive from '../src/services/beatFx/beatFxLive';

// Folia's beat clock, for the beat comparison (tests/folia-compare.cjs: the same beats stepped on both sides)
(window as any).BEAT = beatFxLive;

const host = document.getElementById('host') as HTMLDivElement;
let rt: { renderOnce(): void; destroy(): void } | null = null;
const time = motionValue(0);

(window as any).PIXI = PIXI;
(window as any).REF = {
  /** One scene built by `build(PIXI)` (the same source on both sides), drawn by real Pixi at 1280×720 on `bg`. */
  async scene(src: string, bg: string) {
    rt?.destroy();
    rt = null;
    (window as any).__app?.destroy(true, { children: true });
    host.innerHTML = '';
    const app = new PIXI.Application();
    await app.init({ width: 1280, height: 720, background: bg, antialias: true, resolution: 1, preference: 'webgl' });
    host.appendChild(app.canvas);
    // eslint-disable-next-line no-new-func
    const root = new Function('PIXI', 'return (' + src + ')(PIXI)')(PIXI);
    app.stage.addChild(root);
    app.render();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    app.render();
    (window as any).__app = app;
    return true;
  },
  async open(o: any) {
    rt?.destroy();
    host.innerHTML = '';
    host.style.background = o.bg;
    time.set(0);
    const common = {
      host,
      songSeed: o.seed,
      theme: o.theme,
      renderScale: 1,
      antialias: true,
      currentTime: time,
      lyricsFontScale: 1,
      staticMode: false,
      paused: !o.beat,
      songTitle: o.title,
      songArtist: o.artist,
      songAlbum: o.album,
    };
    if (o.mode === 'tempera') {
      const tuning = { ...DEFAULT_TEMPERA_TUNING, textureResolution: 1, ...(o.tuning || {}) };
      const program = compileTemperaProgram(o.lines, o.seed, { wholeLineLyrics: tuning.wholeLineLyrics });
      rt = await TemperaPixiRuntime.create({ ...common, program, tuning, coverColors: o.coverColors || [] } as any);
    } else {
      const tuning = { ...DEFAULT_SONNET_TUNING, textureResolution: 1, ...(o.tuning || {}) };
      const program = compileSonnetProgram(o.lines, o.seed);
      rt = await SonnetPixiRuntime.create({
        ...common,
        program,
        tuning,
        antialiasMode: 'auto',
        smartBeatEnabled: !!o.beat,
        transparentBackground: !!o.transparent,
      } as any);
    }
    (window as any).__rt = rt;
    return true;
  },
  async frame(t: number) {
    time.set(t);
    // a few renders, so pre-rolled neighbour scenes are built as they would be by then
    for (let i = 0; i < 3; i += 1) rt!.renderOnce();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return true;
  },
};
