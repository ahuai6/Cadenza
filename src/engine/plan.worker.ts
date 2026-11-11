// The planning worker: a song's plan (director/plan.ts: layout, camera, cues, titles) made off the page's thread, so a
// knob let go, a new lyric or a song opening never holds up the picture — the frames go on with the plan there is until
// the new one is ready. The director is plain computation; the one thing it needs from the page is how wide each word
// is in the song's face, and the page measures every word it can ask for beforehand (measuresFor) and sends the table.
// The rhythm map is built here from the analysis, which is sent once and kept (a few, by key) — a replan sends only
// the style and the words.
import { plan, type PlanInput } from '../director/plan';
import { RhythmMap } from '../rhythm/map';
import { tableMeasurer, type WordBox } from '../text/metrics';
import type { RhythmAnalysis } from '../rhythm/types';

export type MapSpec = { key: number; analysis?: RhythmAnalysis; offset: number } | { grid: [number, number, number] };
export interface PlanRequest {
  id: number;
  input: Omit<PlanInput, 'map' | 'measure'>;
  map: MapSpec;
  measures: Record<string, WordBox>;
}
export type PlanReply = { id: number; plan?: unknown; missing?: true; miss?: number; error?: string; ms?: number };

const KEEP = 6,
  analyses = new Map<number, RhythmAnalysis>();
function mapOf(m: MapSpec): RhythmMap | null {
  if ('grid' in m) return RhythmMap.grid(m.grid[0], m.grid[1], m.grid[2]);
  if (m.analysis) {
    analyses.delete(m.key);
    analyses.set(m.key, m.analysis);
    while (analyses.size > KEEP) analyses.delete(analyses.keys().next().value!);
  }
  const a = analyses.get(m.key);
  return a ? new RhythmMap(a, m.offset) : null;
}
self.onmessage = (ev: MessageEvent<PlanRequest>) => {
  const { id, input, measures } = ev.data;
  try {
    const map = mapOf(ev.data.map);
    if (!map) {
      (self as any).postMessage({ id, missing: true } satisfies PlanReply);
      return;
    }
    let miss = 0;
    const t0 = performance.now();
    const p = plan({ ...input, map, measure: tableMeasurer(measures, () => miss++) }) as any;
    // (the map and the style go back as the page's own: they are not sent)
    p.map = null;
    p.style = null;
    (self as any).postMessage({ id, plan: p, miss, ms: performance.now() - t0 } satisfies PlanReply);
  } catch (e) {
    (self as any).postMessage({ id, error: String((e as Error)?.stack || e) } satisfies PlanReply);
  }
};
