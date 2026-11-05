/* Planning a song off the page's thread (plan.worker.ts), and on it where there is no worker (tests, a page that cannot
   start one) or the worker fails. Either way the plan is the same: the worker lays the words out from the very widths
   the page measured (measuresFor), builds the same rhythm map from the same analysis, and the director is
   deterministic. The plan that comes back is the page's own once its map and style are put back in. */
import { plan as planHere, measuresFor, type PlanInput } from '../director';
import type { ScenePlan } from '../director/types';
import type { RhythmAnalysis } from '../rhythm/types';
import PlanWorker from './plan.worker.ts?worker&inline';
import type { MapSpec, PlanReply, PlanRequest } from './plan.worker';

/** How the plan's rhythm map was made, so the worker can make the same: from an analysis (at an offset) or a grid. */
export type MapOrigin = { analysis: RhythmAnalysis; offset: number } | { grid: [number, number, number] };

let worker: Worker | null = null, broken = false, nextId = 1;
const pending = new Map<number, (r: PlanReply) => void>();
/** analyses the worker has been sent (it keeps the last few): later plans of the same song send only their key */
const keys = new WeakMap<RhythmAnalysis, number>(); let nextKey = 1; const sent = new Set<number>();
function getWorker(): Worker | null {
  if (worker || broken) return worker;
  if (typeof Worker === 'undefined') { broken = true; return null; }
  try {
    const w = new PlanWorker();
    w.onmessage = (ev: MessageEvent<PlanReply>) => { const r = pending.get(ev.data.id); if (r) { pending.delete(ev.data.id); r(ev.data); } };
    w.onerror = e => { console.warn('planning worker failed', e.message); broken = true; worker = null; for (const r of pending.values()) r({ id: 0, error: 'worker failed' }); pending.clear(); w.terminate(); };
    worker = w;
  } catch { broken = true; }
  return worker;
}
const ask = (w: Worker, req: PlanRequest) => new Promise<PlanReply>((res, rej) => { pending.set(req.id, res); try { w.postMessage(req); } catch (e) { pending.delete(req.id); rej(e); } });

/** Plan off the page's thread (or on it, if it must). `input` as director/plan takes it; `origin` says how its map was
 *  made. Last statistics, for the profiler and the tests. */
export const PLAN_STATS = { worker: 0, here: 0, ms: 0, miss: 0 };
export async function planSong(input: PlanInput, origin: MapOrigin): Promise<ScenePlan> {
  const w = getWorker();
  if (w) {
    const measures = measuresFor(input.doc, input.style, input.measure);
    const { measure: _m, map: _map, ...rest } = input;
    // (the style as plain data: the live one may hold a stray non-cloneable value — it is put back after)
    const req = (spec: MapSpec): PlanRequest => ({ id: nextId++, input: { ...rest, style: JSON.parse(JSON.stringify(input.style)) }, map: spec, measures });
    let spec: MapSpec;
    if ('grid' in origin) spec = origin;
    else { let k = keys.get(origin.analysis); if (!k) { k = nextKey++; keys.set(origin.analysis, k); } spec = { key: k, offset: origin.offset, ...(sent.has(k) ? {} : { analysis: origin.analysis }) }; sent.add(k); }
    try {
      let r = await ask(w, req(spec));
      if (r.missing && 'key' in spec) r = await ask(w, req({ ...spec, analysis: (origin as { analysis: RhythmAnalysis }).analysis }));
      if (r.plan) {
        const p = r.plan as ScenePlan; p.map = input.map; p.style = input.style;
        PLAN_STATS.worker++; PLAN_STATS.ms = r.ms ?? 0; PLAN_STATS.miss = r.miss ?? 0;
        return p;
      }
      if (r.error) console.warn('planning worker:', r.error);
    } catch (e) { console.warn('planning worker:', e); }
  }
  // (here: the same planner, on this thread)
  PLAN_STATS.here++; return planHere(input);
}
