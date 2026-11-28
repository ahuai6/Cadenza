// The selected song's visual scene: built beside the audio (never holding it up), shown when ready, rebuilt when the
// song's data that shapes it changes, and given the rhythm as it becomes known. At most one build runs, and one waits;
// a build for a song no longer selected is dropped before it can submit a whole new one. A scene is never needed for
// sound: the coordinator authorizes playback on its own (player.ts).
import { ensureFont, loadSegmenter, RhythmPreview, Session, type RhythmAnalysis } from '../../engine';
import { coverUrl, D, Lib, type Settings } from '../bridge';
import { lib, settings, trackOf, ui } from '../state';
import { SCHEMA } from '../settings/schema';
import { engine, sessionEnv } from './stage';
import { onAnalysisUpgrade, readRhythm, requestAnalysis } from './analysis';
import { traceBegin, traceEnd, tracePhase } from './trace';
import type { PlaybackRequest } from './coordinator';
import type { PreparedOutput } from './outputs';
import { bumpScene, NO_MV, player, projection } from './projection';
import { applySongChoices, unsavedSong } from './song-data';
import { loadMv } from './mv';

/* ---------- the rhythm the scene has ---------- */
const coming = new WeakMap<Session, Promise<RhythmAnalysis | null>>();
export function rhythmState(): 'whole' | 'partial' | 'streamed' | null {
  const s = player.get().session;
  if (!s) return null;
  if (!s.analysis) return coming.has(s) ? 'partial' : null;
  return s.analysis?.partial || s.staged ? 'partial' : coming.has(s) ? 'streamed' : 'whole';
}
export async function wholeRhythm() {
  const s = player.get().session;
  const p = s && coming.get(s);
  if (!s || !p) return;
  if ((await p) && s === player.get().session && s.staged && s.takeStaged()) engine.invalidate();
}

/* ---------- the selection the scene is for ---------- */
let current: { request: PlaybackRequest; output: PreparedOutput | null } | null = null;
let trace: ReturnType<typeof traceBegin> | null = null;
/** A new song is selected: what was being built for the one before is dropped, and its timing trace begins. */
export function selectVisual(request: PlaybackRequest) {
  current = { request, output: null };
  cancelVisual();
  trace = traceBegin(trackOf(request.entry.id)?.title || request.entry.id);
}
/** The timing trace of the selection under way (for the audio's own phases). */
export const visualTrace = () => trace;
/** The selected song's output is ready: its scene can be built with its audio. */
export function outputReady(request: PlaybackRequest, output: PreparedOutput) {
  if (current?.request === request) current.output = output;
}
onAnalysisUpgrade((content, result) => {
  const { session, shownId } = player.get();
  const request = current?.request;
  if (!session || !shownId || request?.entry.id !== shownId || trackOf(shownId)?.audioContentId !== content) return;
  void session
    .stage(result, request.signal)
    .then((staged) => {
      if (staged && session === player.get().session) engine.invalidate();
    })
    .catch(() => {});
});
/** Consumers that need a real scene (such as export) can wait without holding playback. */
export async function waitForVisual(id: string) {
  const request = current?.request;
  if (!request || request.entry.id !== id || request.signal.aborted) return null;
  return new Promise<Session | null>((resolve) => {
    const finish = (session: Session | null) => {
      off();
      request.signal.removeEventListener('abort', abort);
      resolve(session);
    };
    const abort = () => finish(null);
    const check = () => {
      const p = player.get();
      if (request.signal.aborted || p.shownId !== id || p.error || p.visualError) finish(null);
      else if (p.session) finish(p.session);
    };
    const off = player.subscribe(check);
    request.signal.addEventListener('abort', abort, { once: true });
    check();
  });
}

/* ---------- building ---------- */
// At most one scene build is active and one replacement queued. Native image/font
// work already submitted may finish, but an aborted scene cannot submit a full new build.
type VisualJob = { request: PlaybackRequest; output: PreparedOutput; abort: AbortController };
let visualActive: VisualJob | null = null;
let visualNext: VisualJob | null = null;
let visualAbort: AbortController | null = null;
export function cancelVisual() {
  visualAbort?.abort();
  visualAbort = null;
  visualNext = null;
}
/** Build the scene of the selected song with its ready output (again, when its data that shapes it changed). */
export function scheduleVisual() {
  cancelVisual();
  if (!current?.output || current.request.signal.aborted) return;
  visualAbort = new AbortController();
  visualNext = { request: current.request, output: current.output, abort: visualAbort };
  runVisual();
}
function runVisual() {
  if (visualActive || !visualNext) return;
  const job = (visualActive = visualNext);
  visualNext = null;
  void openVisual(job)
    .catch((error) => {
      if (!job.abort.signal.aborted && !job.request.signal.aborted) {
        console.warn('visual preparation', error);
        projection.set({ visualError: String((error as Error)?.message || error) });
      }
    })
    .finally(() => {
      visualActive = null;
      runVisual();
    });
}
async function openVisual({ request, output, abort }: VisualJob) {
  const signal = AbortSignal.any([request.signal, abort.signal]);
  signal.throwIfAborted();
  const id = request.entry.id;
  const tr = trace;
  const t = trackOf(id);
  if (!t || !Lib) return;
  const tm = performance.now();
  void loadSegmenter().catch(() => {});
  const [storedSong, lyr, cached] = await Promise.all([
    Lib.song(id).catch(() => null),
    Lib.lyrics(id).catch(() => null),
    readRhythm(id, output.duration),
  ]);
  signal.throwIfAborted();
  const analysis = cached;
  const preview = analysis ? undefined : new RhythmPreview();
  const later =
    preview &&
    requestAnalysis(id, signal, (slice) => {
      if (signal.aborted) return;
      preview.add(slice);
      engine.invalidate();
    });
  tracePhase(tr, 'visualData', performance.now() - tm);
  const song = unsavedSong(id) || storedSong;
  const album = player.get().album;
  const instr = !!t.instrumental;
  const s = await Session.open(
    {
      key: id,
      instrumental: instr,
      lyrics: instr ? '' : lyr?.text || '',
      style: song?.style,
      preset: instr ? 'vinyl' : undefined,
      song: {
        on: true,
        title: t.title,
        artist: t.artist || '',
        composer: t.composer || '',
        lyricist: t.lyricist || '',
        album: !!album,
      },
      coverUrl: coverUrl(t.cover, true),
      audio: output.audio,
      analysis,
      preview,
      lshift: song?.lshift || 0,
      spacing: song?.spacing,
      fade: !album,
      aspect: fxAspect(),
      look: album?.look || undefined,
    },
    sessionEnv(),
    { signal, analyzeAudio: false },
  );
  signal.throwIfAborted();
  await applySongChoices(id, s);
  signal.throwIfAborted();
  if (tr) tr.cached = !!cached;
  for (const [name, ms] of Object.entries(s.timings)) tracePhase(tr, name, ms);
  const font = ui.get().npLyr.font;
  if (font && font !== 'ui' && s.hasLyrics) {
    await Promise.race([
      ensureFont(font, s.doc.lines.map((line) => line.text).join('')),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }
  signal.throwIfAborted();
  if (album && !album.look) projection.set({ album: { look: s.lookOf() } });
  const fresh = trackOf(id);
  if (fresh && (fresh.title !== t.title || fresh.artist !== t.artist))
    s.setSong({ title: fresh.title, artist: fresh.artist || '' });
  if (fresh && fresh.cover !== t.cover)
    void s.setCover(coverUrl(fresh.cover, true), false).then(() => {
      if (!signal.aborted) engine.invalidate();
    });
  const mv = song?.mv;
  engine.show(s);
  projection.set({
    session: s,
    song: song || {},
    lyrics: lyr,
    hasLyrics: s.hasLyrics,
    visualError: null,
    mv: { ...NO_MV, bound: !!mv, name: mv?.name || '', offset: mv?.offset || 0 },
  });
  if (mv) void loadMv(id, mv, !!song?.mvOn);
  const shown = performance.now();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (signal.aborted) return;
      tracePhase(tr, 'show', performance.now() - shown);
      traceEnd(tr);
    }),
  );
  if (later) {
    coming.set(
      s,
      later
        .then(async (value) => {
          if (value && !signal.aborted && s === player.get().session) await s.stage(value, signal);
          return signal.aborted ? null : value;
        })
        .catch(() => null),
    );
  }
}

/* ---------- edits to the shown song's tags or cover show at once, in every view ---------- */
lib.subscribe((L, prev) => {
  if (L.tracks === prev.tracks) return;
  const p = player.get(),
    s = p.session;
  if (!p.shownId) return;
  const t = trackOf(p.shownId),
    was = prev.tracks.find((x) => x.id === p.shownId);
  if (!t || !was || t === was) return;
  if (!!was.instrumental !== !!t.instrumental && current?.output) {
    scheduleVisual();
    return;
  }
  if (s && (was.title !== t.title || was.artist !== t.artist)) {
    s.setSong({ title: t.title, artist: t.artist || '' });
    engine.invalidate();
  }
  if (s && was.cover !== t.cover)
    void s.setCover(coverUrl(t.cover, true), false).then(() => {
      if (s === player.get().session) engine.invalidate();
    });
  bumpScene();
});

/* ---------- the frame's shape ---------- */
/** The effect lyrics' frame shapes: the scene is planned for the shape (changed in size, never cropped), in the window,
 *  full screen and in an export alike. */
export const FX_ASPECTS: string[] = [...SCHEMA.fxAspect.options];
export const fxAspect = () => {
  const a = settings.get().fxAspect;
  return a && FX_ASPECTS.includes(a) ? a : SCHEMA.fxAspect.default;
};
/** Change the shape: kept for every song, and the song shown is planned again for it at once. */
export function setFxAspect(shape: string) {
  if (!FX_ASPECTS.includes(shape)) return;
  const a = shape as Settings['fxAspect'];
  settings.set({ fxAspect: a });
  D?.setSettings({ fxAspect: a });
  const s = player.get().session;
  if (s) {
    s.spec.aspect = a;
    s.setStyle('aspect', a);
    engine.invalidate();
    bumpScene();
  }
}
