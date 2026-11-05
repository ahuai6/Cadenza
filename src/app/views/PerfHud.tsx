// The performance overlay (Settings → performance → show frame timings): how fast the effect lyrics draw on this
// machine, where each frame's time goes layer by layer, and what the GPU lyric layer and the planning worker did. The
// times are the page's own work per frame; what the graphics card does after shows in the frame rate.
import { useEffect, useState } from 'react';
import { tx } from '../../i18n';
import { engine } from '../playback/stage';
import { GPU_STATS, PLAN_STATS } from '../../engine';
import s from './PerfHud.module.css';

const LAYERS = ['backdrop', 'world', 'lyrics', 'post', 'screen'] as const;
export function PerfHud() {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick(n => n + 1), 250); return () => clearInterval(id); }, []);
  const P = engine.perf, total = Math.max(0.01, LAYERS.reduce((a, k) => a + (P.layers[k] ?? 0), 0));
  const f1 = (v: number) => v.toFixed(1);
  return (
    <div className={s.hud} data-test="perf-hud" aria-hidden="true">
      <div className={s.row + ' ' + s.head}><span>{Math.round(P.fps)} fps</span><span>{f1(P.frameMs)} ms</span></div>
      <div className={s.row + ' ' + s.dim}><span>{tx('perf.page')}</span><span>{f1(P.drawMs)} ms</span></div>
      {LAYERS.map(k => { const v = P.layers[k] ?? 0; return <div key={k}>
        <div className={s.row}><span>{tx('perf.' + k)}</span><span>{f1(v)}</span></div>
        <div className={s.bar}><i style={{ width: `${Math.min(100, v / total * 100)}%` }} /></div></div>; })}
      <div className={s.row + ' ' + s.dim}><span>{tx('perf.gpu')}</span><span>{GPU_STATS.on ? tx('perf.gpuOn', { q: GPU_STATS.quads, d: GPU_STATS.draws }) : tx('perf.gpuOff')}</span></div>
      <div className={s.row + ' ' + s.dim}><span>{tx('perf.plan')}</span><span>{PLAN_STATS.worker || PLAN_STATS.here ? `${f1(PLAN_STATS.ms)} ms${PLAN_STATS.here ? ' · ' + tx('perf.planHere') : ''}` : '—'}</span></div>
      <div className={s.row + ' ' + s.dim}><span>{tx('perf.size')}</span><span>{P.w}×{P.h}</span></div>
    </div>
  );
}
