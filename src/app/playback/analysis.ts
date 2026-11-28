import {
  analyzePcm,
  checkAnalysis,
  isCurrent,
  neuralStatus,
  RHYTHM_VERSION,
  type RhythmAnalysis,
  type RhythmPreviewUpdate,
  type RhythmTaskStage,
} from '../../engine';
import { Lib, mediaUrl, type AnalysisToken } from '../bridge';
import { lib, settings, trackOf } from '../state';

/** A song's kept rhythm reading, if it is one this version of the analysis made for this length of song. */
export async function readRhythm(id: string, duration: number) {
  const analysis = (await Lib!.analysis(id, RHYTHM_VERSION).catch(() => null)) as RhythmAnalysis | null;
  return isCurrent(analysis, duration || undefined) ? analysis : null;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const requests = new Set<{
  id: string;
  deliver: (value: RhythmAnalysis | null) => void;
  preview?: (slice: RhythmPreviewUpdate) => void;
}>();
const upgrades = new Set<(content: string, result: RhythmAnalysis) => void>();
export function onAnalysisUpgrade(listener: (content: string, result: RhythmAnalysis) => void) {
  upgrades.add(listener);
  return () => {
    upgrades.delete(listener);
  };
}
const holds = new Set<string>();
const blockedByUser = () => [...holds].some((reason) => reason !== 'watching');
let running = false;
let requested = false;
let focused: string | null = null;
let capability = '';
let active: { id: string; source: string; content: string; abort: AbortController } | null = null;

export async function requestAnalysis(
  id: string,
  signal?: AbortSignal,
  preview?: (slice: RhythmPreviewUpdate) => void,
): Promise<RhythmAnalysis | null> {
  if (!Lib || signal?.aborted) return null;
  const saved = (await Lib.analysis(id, RHYTHM_VERSION).catch(() => null)) as RhythmAnalysis | null;
  if (signal?.aborted) return null;
  if (saved && !checkAnalysis(saved)) return saved;
  const content = trackOf(id)?.audioContentId;
  if (preview) {
    if (content && focused !== id && active && active.content !== content) active.abort.abort();
    focused = id;
  }
  // Register the observer before the main process work is prioritized. It neither owns nor starts an analysis job.
  return new Promise((resolve) => {
    const entry = { id, deliver, preview };
    function deliver(value: RhythmAnalysis | null) {
      requests.delete(entry);
      signal?.removeEventListener('abort', abort);
      resolve(value);
    }
    const abort = () => deliver(null);
    requests.add(entry);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else {
      void Lib!.prioritize([id]).catch(() => deliver(null));
      void loop();
    }
  });
}

function deliver(id: string, content: string, result: RhythmAnalysis | null) {
  for (const entry of requests) {
    if (entry.id === id || (result && trackOf(entry.id)?.audioContentId === content)) entry.deliver(result);
  }
}

async function analyzeJob(
  id: string,
  token: AnalysisToken,
  only: 'loudness' | undefined,
  upgrade: boolean,
  signal: AbortSignal,
) {
  const track = trackOf(id);
  const url = 'cadenza://analysis-pcm/' + id + '?rev=' + encodeURIComponent(token.source);
  const progress = (value: number) => lib.set({ analysisNow: value, analysisFor: id });
  const stage = (value: RhythmTaskStage) => {
    const task = lib.get().analysisTask;
    if (!signal.aborted && task.id === id && task.stage !== value) lib.set({ analysisTask: { ...task, stage: value } });
  };
  try {
    stage('decode');
    const browser = /opus/i.test(track?.codec || '') || /^(opus|aac)$/i.test(track?.ext?.replace(/^\./, '') || '');
    const result = await analyzePcm(
      browser ? mediaUrl(id, token.source) : url,
      {
        duration: track?.duration || 0,
        signal,
        browser,
        onlyLoudness: only === 'loudness',
        urgent: id === focused,
        stage,
        // Automatic mode first produces a usable baseline for unanalysed content. The same cache row
        // remains eligible for both neural stages once the rest of the library has received its baseline.
        engine: !upgrade && settings.get().rhythmEngine === 'auto' ? 'dsp' : undefined,
        preview:
          only || upgrade
            ? undefined
            : (slice) => {
                if (signal.aborted) return;
                for (const entry of requests)
                  if (entry.id === id || trackOf(entry.id)?.audioContentId === token.content) entry.preview?.(slice);
              },
      },
      progress,
    );
    signal.throwIfAborted();
    stage('write');
    if (only === 'loudness') {
      await Lib!.saveLoudness(id, result.loudness ?? null, token);
      return;
    }
    const why = checkAnalysis(result.analysis);
    if (why) throw new Error(why);
    if (await Lib!.saveAnalysis(id, result.analysis!, token)) {
      deliver(id, token.content, result.analysis!);
      if (upgrade) for (const listener of upgrades) listener(token.content, result.analysis!);
    }
  } catch (error) {
    if (signal.aborted || (error as Error)?.message === 'analysis decoder busy') return;
    if (only === 'loudness') await Lib!.saveLoudness(id, null, token);
    else {
      await Lib!.analysisFailed(id, String((error as Error)?.message || error).slice(0, 200), token);
      deliver(id, token.content, null);
    }
  }
}

async function loop() {
  if (!Lib) return;
  if (running) {
    requested = true;
    return;
  }
  running = true;
  requested = false;
  const blocked = new Set<string>();
  try {
    while (!blockedByUser()) {
      const omit = [...blocked];
      const job = await Lib.nextAnalysis(RHYTHM_VERSION, omit, holds.has('watching') ? '' : capability);
      if (!job) {
        if (await verifyCached()) continue;
        // An indexed track may have completed just before the observer registered.
        for (const entry of requests) {
          const t = trackOf(entry.id);
          if (!t || (t.audioContentId && !blocked.has(t.id))) {
            const data = t
              ? ((await Lib.analysis(entry.id, RHYTHM_VERSION).catch(() => null)) as RhythmAnalysis | null)
              : null;
            entry.deliver(data && !checkAnalysis(data) ? data : null);
          }
        }
        break;
      }
      const token = await Lib.analysisToken(job.id);
      if (!token || token.source !== trackOf(job.id)?.mediaRevision) {
        blocked.add(job.id);
        continue;
      }
      if (blockedByUser()) break;
      const abort = new AbortController();
      active = { id: job.id, source: token.source, content: token.content, abort };
      lib.set({
        analysisTask: { phase: job.upgrade ? 'upgrade' : job.only || 'rhythm', id: job.id },
        analysisFor: job.id,
        analysisNow: 0,
      });
      await analyzeJob(job.id, token, job.only, !!job.upgrade, abort.signal);
      active = null;
      lib.set({ analysisTask: { phase: 'idle', id: null }, analysisFor: null, analysisNow: null });
      await sleep(160);
    }
  } catch (error) {
    console.warn('[library analysis]', error);
  } finally {
    active = null;
    running = false;
    lib.set({
      analysisTask: { phase: blockedByUser() ? 'paused' : 'idle', id: null },
      analysisFor: null,
      analysisNow: null,
    });
    if (requested && !blockedByUser()) void loop();
  }
}

async function verifyCached(): Promise<boolean> {
  if (!Lib) return false;
  const inspectQuality = !!capability;
  let revisit = false;
  for (const id of await Lib.unverified(RHYTHM_VERSION, inspectQuality).catch(() => [] as string[])) {
    if (blockedByUser()) break;
    const token = await Lib.analysisToken(id);
    if (!token) continue;
    lib.set({ analysisTask: { phase: 'validate', id } });
    const data = await Lib.analysis(id, RHYTHM_VERSION).catch(() => null);
    if (checkAnalysis(data)) {
      await Lib.reanalyze([id]);
      revisit = true;
    } else {
      await Lib.verified(id, RHYTHM_VERSION, token);
      revisit ||= inspectQuality;
    }
    await sleep(40);
  }
  return revisit;
}

let started = false;
export async function refreshAnalysisCapability() {
  const start = settings.get();
  const state = start.rhythmEngine === 'dsp' ? null : await neuralStatus().catch(() => null);
  const current = settings.get();
  if (
    current.rhythmEngine !== start.rhythmEngine ||
    current.rhythmRuntime !== start.rhythmRuntime ||
    current.rhythmDevice !== start.rhythmDevice
  )
    return;
  const next = state?.ok ? `${state.native ? 'native' : 'web'}:${state.stems ? 2 : 1}` : '';
  if (capability !== next) {
    capability = next;
    void loop();
  }
}
export function startAnalysis() {
  if (!Lib || started) return;
  started = true;
  Lib.onWake(() => void loop());
  Lib.onAnalysisInvalidated((contents) => {
    if (active && (!contents || contents.includes(active.content))) active.abort.abort();
  });
  lib.subscribe(() => {
    if (active && trackOf(active.id)?.mediaRevision !== active.source) active.abort.abort();
  });
  settings.subscribe((next, previous) => {
    if (
      ['rhythmEngine', 'rhythmDrums', 'rhythmRuntime', 'rhythmDevice'].some(
        (key) => next[key as keyof typeof next] !== previous[key as keyof typeof next],
      )
    ) {
      active?.abort.abort();
      capability = '';
      void refreshAnalysisCapability();
      void loop();
    }
  });
  setTimeout(() => {
    void refreshAnalysisCapability();
    void loop();
  }, 1500);
  setInterval(() => {
    if (!blockedByUser()) void refreshAnalysisCapability();
  }, 60_000);
}

export function pauseAnalysis(on: boolean, why = 'export') {
  if (on === holds.has(why)) return;
  if (on) holds.add(why);
  else holds.delete(why);
  if (on && active && why !== 'watching') active.abort.abort();
  if (!on) void loop();
}
