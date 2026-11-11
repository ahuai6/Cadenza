// How the last song start went, phase by phase: what the performance overlay shows, so a slow start on a given machine
// says where its time went (reading and decoding the file, the rhythm, the session — the word segmenter, the face, the
// plan — and the first frame). Times in ms from the request.
import { createStore } from '../../core/emitter';

export interface StartTrace {
  title: string;
  total: number;
  phases: [string, number][];
  cached: boolean;
}
export const lastStart = createStore({ trace: null as StartTrace | null });
let cur: { title: string; t0: number; phases: [string, number][]; cached: boolean } | null = null;
export function traceBegin(title: string) {
  cur = { title, t0: performance.now(), phases: [], cached: false };
  return cur;
}
/** A phase that took ms (measured by its own clock: phases may overlap). */
export function tracePhase(c: typeof cur, name: string, ms: number | undefined) {
  if (c && ms != null && isFinite(ms)) c.phases.push([name, Math.round(ms)]);
}
export function traceEnd(c: typeof cur) {
  if (!c || c !== cur) return;
  const total = Math.round(performance.now() - c.t0);
  lastStart.set({ trace: { title: c.title, total, phases: c.phases, cached: c.cached } });
  console.info('[start]', c.title, total + ' ms', JSON.stringify(Object.fromEntries(c.phases)));
  cur = null;
}
