// The word segmenter, as the rest of Cadenza sees it: where a line of lyrics breaks into words. Folia's icu-folia
// (segmenter.ts, NOTICE.md): the browser's own word breaker (ICU, by script: a dictionary for Thai, spaces for Latin
// and Hangul) with Chinese cut by jieba — a dictionary and an HMM, never at random — its particles kept on the word they
// hang from (故事的), and Japanese cut by BudouX into bunsetsu (君の / 夢に). Its engines load lazily (a few MB of
// dictionary, off the startup path); until they are in, the plain ICU split stands.
import { segmentWithIcuFolia, type IcuFoliaEngines } from './segmenter';

let engines: IcuFoliaEngines | null = null, loading: Promise<boolean> | null = null;
/** Load the engines once; true when they are ready, false if they could not load (the ICU split stays). */
export function loadSegmenter(): Promise<boolean> {
  return (loading ??= import('./engines').then(m => m.loadIcuFoliaEngines()).then(e => { engines = e; return true; },
    e => { console.warn('[segment] the dictionary did not load, words break by ICU alone:', e); return false; }));
}
export const segmenterReady = () => engines !== null;
const MEMO = new Map<string, string[]>();
/** The pieces of a line (words, and the spaces and punctuation between them as pieces of their own); they join back
 *  to the line exactly. */
export function segmentText(text: string): string[] {
  const key = (engines ? '1' : '0') + text; let out = MEMO.get(key);
  if (!out) { out = segmentWithIcuFolia(text, engines); if (MEMO.size > 2000) MEMO.delete(MEMO.keys().next().value!); MEMO.set(key, out); }
  return out.slice();
}
