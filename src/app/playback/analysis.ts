// The library's rhythm analysis, in the background: the main process keeps the queue (songs the player is about to need
// first, then the most recently played and added), this page takes one song at a time, decodes it at the analysis rate
// (22 kHz: a quarter of the memory of a full decode) and runs the rhythm SDK in its worker. One song at a time, with a
// pause between songs and none at all while an export runs, so playback and the interface never compete with it.
import { analyzeInBackground, loudnessInBackground, RHYTHM_VERSION, type RhythmAnalysis } from '../../rhythm';
import { Lib, mediaUrl } from '../bridge';

let busy = false, paused = false, wake: (() => void) | null = null;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Decode a song's file for analysis only. */
export async function decodeForAnalysis(id: string) {
  const r = await fetch(mediaUrl(id)); if (!r.ok) throw new Error('read');
  return new OfflineAudioContext(1, 1, 22050).decodeAudioData(await r.arrayBuffer());
}
/** Analyse one song now (the player calls this for a song it needs and the cache does not have). */
const inflight = new Map<string, Promise<RhythmAnalysis>>();
export function analyzeNow(id: string, decoded?: AudioBuffer | null): Promise<RhythmAnalysis> {
  let p = inflight.get(id);
  if (!p) {
    p = (async () => { const a = await analyzeInBackground(decoded || await decodeForAnalysis(id)); await Lib?.saveAnalysis(id, a); return a; })();
    inflight.set(id, p); p.finally(() => inflight.delete(id));
  }
  return p;
}
async function loop() {
  if (busy || !Lib) return; busy = true;
  try {
    for (;;) {
      while (paused) await new Promise<void>(r => { wake = r; });
      const job = await Lib.nextAnalysis(RHYTHM_VERSION); if (!job) break;
      if (job.only === 'loudness') {
        // a song analysed before the volume balance: only how loud it is
        try { await Lib.saveLoudness(job.id, await loudnessInBackground(await decodeForAnalysis(job.id))); } catch { await Lib.saveLoudness(job.id, null); }
      } else try { await analyzeNow(job.id); } catch { await Lib.analysisFailed(job.id); }
      await sleep(120);
    }
  } finally { busy = false; }
}
export function startAnalysis() { if (!Lib) return; Lib.onWake(() => loop()); setTimeout(loop, 1500); }
export function pauseAnalysis(on: boolean) { paused = on; if (!on) { wake?.(); wake = null; } }
