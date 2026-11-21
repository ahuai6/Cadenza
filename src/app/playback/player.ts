// Application integration for the playback coordinator and the independent visual Session.
import { createStore } from '../../core/emitter';
import {
  Session,
  ensureFont,
  analyzeHead,
  RHYTHM_VERSION,
  isCurrent,
  balanceDb,
  parseLyrics as parse,
  isTtml,
  lrcToTtml,
  spacingKey,
  loadSegmenter,
  type RhythmAnalysis,
  type Spacing,
} from '../../engine';
import { storedStyle, type Style } from '../../theme/style';
import { tx } from '../../i18n';
import { Lib, D, coverUrl, type Settings, type SongData, type Track } from '../bridge';
import { lib, ui, settings, toast, trackOf, remember, keep } from '../state';
import { insertNext, followList } from './queue';
import { SCHEMA } from '../settings/schema';
import { engine, sessionEnv } from './stage';
import { analyzeNow, decodeForAnalysis } from './analysis';
import { traceBegin, tracePhase, traceEnd } from './trace';
import {
  hifiOn,
  refresh as hifiRefresh,
  release as hifiRelease,
  closeFile,
  waitReleased,
  onTrouble,
  hwGain,
  hifi,
} from './hifi';
import { PlaybackCoordinator, weightedPick, type PlaybackRequest, type Phase, type Mode } from './coordinator';
import { prepareOutput, preload, clearPreload, decodeFile, type PreparedOutput } from './outputs';
export type { Mode } from './coordinator';
export const MODES: Mode[] = ['loop', 'shuffle', 'one', 'stop'];
export const MODE_ICON: Record<Mode, string> = { loop: 'repeat', shuffle: 'shuffle', one: 'repeat1', stop: 'once' };
/** The play mode at start: the one chosen last — except that "stop at the end", left over from earlier versions where
 *  it was easy to land on, gives way once to playing on in order, the default everywhere (3.2.11). */
function startMode(): Mode {
  const m = remember<Mode>('mode', 'loop');
  if (remember('mode.v2', false)) return MODES.includes(m) ? m : 'loop';
  keep('mode.v2', true);
  if (m === 'stop' || !MODES.includes(m)) {
    keep('mode', 'loop');
    return 'loop';
  }
  return m;
}
export interface MvState {
  bound: boolean;
  name: string;
  offset: number;
  on: boolean;
  ready: boolean;
}
const projection = createStore({
  /** Compatibility names for the selected song; its visual scene is optional. */
  id: null as string | null,
  shownId: null as string | null,
  session: null as Session | null,
  rev: 0,
  queue: [] as string[],
  queueKeys: [] as number[],
  index: -1,
  loading: false,
  playing: false,
  intent: false,
  duration: 0,
  phase: 'idle' as Phase,
  visualError: null as string | null,
  song: null as SongData | null,
  lyrics: null as { source: string; text: string } | null,
  hasLyrics: false,
  route: 'std' as 'std' | 'hifi',
  mv: { bound: false, name: '', offset: 0, on: false, ready: false } as MvState,
  mode: startMode(),
  error: null as string | null,
  volume: remember('vol', 1),
  /** album play: the queue is one album, played through in order as one continuous film in the first song's look */
  album: null as null | { look: Partial<Style> | null },
  /** which way the last change of song went (1 on to the next, −1 back, 0 a jump), for the pages' own transitions */
  dir: 0 as -1 | 0 | 1,
});
export const player = { get: projection.get, subscribe: projection.subscribe };

/* Playback and visuals share a request identity. Only the coordinator can authorize sound. */
const coming = new WeakMap<Session, Promise<RhythmAnalysis | null>>();
export function rhythmState(): 'whole' | 'partial' | 'streamed' | null {
  const s = player.get().session;
  if (!s) return null;
  return s.analysis?.partial || s.staged ? 'partial' : coming.has(s) ? 'streamed' : 'whole';
}
export function forgetPrepared(id: string) {
  clearPreload(id);
}
export async function wholeRhythm() {
  const s = player.get().session;
  const p = s && coming.get(s);
  if (!s || !p) return;
  if ((await p) && s === player.get().session && s.staged && s.takeStaged()) engine.invalidate();
}

let prepared: PreparedOutput | null = null;
let visualRequest: PlaybackRequest | null = null;
let trace: ReturnType<typeof traceBegin> | null = null;
let preloadTimer: ReturnType<typeof setTimeout> | undefined;
let audioConfig: Promise<unknown> | null = null;
let warnedFormat = false;

const transport = new PlaybackCoordinator<PreparedOutput>(
  {
    duration: (id) => trackOf(id)?.duration || 0,
    route: () => (hifiOn() ? 'hifi' : 'std'),
    plays: (id) => trackOf(id)?.plays || 0,
    selected(request) {
      prepared = null;
      visualRequest = request;
      cancelVisual();
      clearTimeout(preloadTimer);
      const id = request.entry.id;
      trace = traceBegin(trackOf(id)?.title || id);
      engine.clear(transport.get().album && request.automatic ? 'album' : 'song');
      engine.mv.setOn(false);
      engine.mv.close();
      const s = transport.get();
      // Background priority can change independently of the renderer and the output.
      void Lib?.prioritize([id, ...s.queue.slice(s.index + 1, s.index + 3).map((e) => e.id)]).catch(() => {});
    },
    async prepare(request) {
      const tr = trace;
      if (audioConfig) await audioConfig;
      request.signal.throwIfAborted();
      // Settings can change while requests wait for the device transaction.
      const route = hifiOn() ? 'hifi' : 'std';
      let output: PreparedOutput;
      try {
        if (route === 'std') await waitReleased();
        request.signal.throwIfAborted();
        applyBalance();
        output = await prepareOutput(
          { ...request, route },
          trackOf(request.entry.id)?.duration || 0,
          transport.get().album,
        );
      } catch (error) {
        if (route === 'std' || request.signal.aborted) throw error;
        await hifiRelease();
        request.signal.throwIfAborted();
        if (!warnedFormat) {
          warnedFormat = true;
          toast(tx('s.hifi.notThis'));
        }
        output = await prepareOutput({ ...request, route: 'std' }, 0, transport.get().album);
      }
      if (tr) tracePhase(tr, 'audioPrepared', performance.now() - tr.t0);
      return output;
    },
    ready(request, output) {
      prepared = output;
      const { queue, index } = transport.get();
      keep('last', { q: queue.slice(0, 3000).map((e) => e.id), i: index });
      applyBalance();
      scheduleVisual(request, output);
      schedulePreload();
    },
  },
  startMode(),
);
export const playback = { get: transport.get, subscribe: transport.subscribe, time: () => transport.time };
export const seekFile = (at: number, scrubbing = false) => transport.seek(at, scrubbing);
export function stopPlayback() {
  transport.stop();
  prepared = null;
  cancelVisual();
  clearTimeout(preloadTimer);
  clearPreload();
}
/** Consumers that need a real scene (such as export) can wait without holding playback. */
export async function waitForVisual(id: string) {
  const generation = transport.get().generation;
  return new Promise<Session | null>((resolve) => {
    const check = () => {
      const p = player.get();
      if (transport.get().generation !== generation || p.shownId !== id || p.error || p.visualError || p.session) {
        off();
        resolve(transport.get().generation === generation && p.shownId === id ? p.session : null);
      }
    };
    const off = player.subscribe(check);
    check();
  });
}
engine.followTransport({
  time: () => transport.time,
  playing: () => transport.get().phase === 'playing',
  ended: () => transport.get().phase === 'ended',
  play: () => transport.play(),
  pause: () => transport.pause(),
  toggle,
  seek: seekFile,
  gain: () => prepared?.syncGain(),
});
transport.subscribe((s, previous) => {
  const changedQueue = s.queue !== previous.queue;
  const requested = s.generation !== previous.generation;
  projection.set({
    ...(requested
      ? {
          id: s.target?.id ?? null,
          shownId: s.target?.id ?? null,
          session: null,
          song: null,
          lyrics: null,
          hasLyrics: false,
          visualError: null,
          dir: s.direction,
          mv: { bound: false, name: '', offset: 0, on: false, ready: false },
        }
      : {}),
    ...(changedQueue ? { queue: s.queue.map((e) => e.id), queueKeys: s.queue.map((e) => e.key) } : {}),
    index: s.index,
    route: s.route,
    mode: s.mode,
    intent: s.intent,
    duration: s.duration,
    phase: s.phase,
    loading: s.phase === 'preparing' || s.phase === 'buffering',
    playing: s.phase === 'playing',
    error: s.error,
  });
  if (s.generation === previous.generation && s.candidate !== previous.candidate && prepared) schedulePreload();
  if (s.phase === 'playing' && s.target && lastPlayedGeneration !== s.generation) {
    lastPlayedGeneration = s.generation;
    void Lib?.played(s.target.id).catch(() => {});
  }
  if (s.phase === 'error' && previous.phase !== 'error') {
    console.warn('audio playback', s.error);
    toast(tx(s.error === 'hifi-down' ? 's.hifi.down' : 'aud.bad'));
  }
  engine.transportChanged();
});
let lastPlayedGeneration = 0;

function schedulePreload() {
  clearTimeout(preloadTimer);
  const { candidate, target, route, generation } = transport.get();
  if (!target || settings.get().prerender === false) return clearPreload();
  preloadTimer = setTimeout(() => {
    const s = transport.get();
    if (generation === s.generation && s.candidate === candidate) preload(candidate, route, target.id);
  }, 1500);
}

// At most one scene build is active and one replacement queued. Native image/font
// work already submitted may finish, but an aborted scene cannot submit a full new build.
type VisualJob = { request: PlaybackRequest; output: PreparedOutput; abort: AbortController };
let visualActive: VisualJob | null = null;
let visualNext: VisualJob | null = null;
let visualAbort: AbortController | null = null;
let focusedAnalysis: Promise<RhythmAnalysis | null> | null = null;
function waitForAnalysis(work: Promise<RhythmAnalysis | null>, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<RhythmAnalysis | null>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void work.then((value) => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    });
  });
}
async function analyzeVisual(id: string, pcm: AudioBuffer | null, urgent: boolean, signal: AbortSignal) {
  while (focusedAnalysis) {
    await waitForAnalysis(focusedAnalysis, signal);
    signal.throwIfAborted();
  }
  signal.throwIfAborted();
  const analysis = (focusedAnalysis = analyzeNow(id, pcm, urgent).catch(() => null));
  void analysis.then(() => {
    if (focusedAnalysis === analysis) focusedAnalysis = null;
  });
  return waitForAnalysis(analysis, signal);
}
function cancelVisual() {
  visualAbort?.abort();
  visualAbort = null;
  visualNext = null;
}
function scheduleVisual(request: PlaybackRequest, output: PreparedOutput) {
  cancelVisual();
  if (request.signal.aborted) return;
  visualAbort = new AbortController();
  visualNext = { request, output, abort: visualAbort };
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
async function readRhythm(id: string, duration: number) {
  const analysis = (await Lib!.analysis(id, RHYTHM_VERSION).catch(() => null)) as RhythmAnalysis | null;
  return isCurrent(analysis, duration || undefined) ? analysis : null;
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
  let analysis = cached;
  let later: Promise<RhythmAnalysis | null> | undefined;
  if (!analysis) {
    const pcm = output.pcm || (await decodeForAnalysis(id).catch(() => null));
    signal.throwIfAborted();
    if (settings.get().rhythmStream !== 'full' && pcm) {
      later = analyzeVisual(id, pcm, false, signal).catch(() => null);
      analysis = await analyzeHead(pcm).catch(() => null);
      if (!analysis) {
        analysis = await later;
        later = undefined;
      }
    } else {
      analysis = await analyzeVisual(id, pcm, true, signal).catch(() => null);
    }
  }
  signal.throwIfAborted();
  tracePhase(tr, 'visualData', performance.now() - tm);
  const song = songWrites.get(id)?.song || storedSong;
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
    mv: { bound: !!mv, name: mv?.name || '', offset: mv?.offset || 0, on: false, ready: false },
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

export async function playIds(ids: string[], index = 0, opts: { play?: boolean; album?: boolean } = {}) {
  if (!Lib) return;
  const valid = (id: string) => {
    const track = trackOf(id);
    return track && !track.protected;
  };
  const at = Math.min(Math.max(0, index), ids.length - 1);
  const q = ids.filter(valid);
  if (!q.length) return;
  const i = valid(ids[at]) ? ids.slice(0, at).filter(valid).length : 0;
  projection.set({ album: opts.album ? { look: null } : null });
  await transport.replace(q, i, opts.play !== false, !!opts.album);
}
const loadAt = (index: number, play: boolean) => transport.select(index, play);
/** Restore the exact occurrence last selected, paused. */
export async function resumeLast() {
  if (player.get().id) return;
  const last = remember<{ q: string[]; i: number } | null>('last', null);
  if (
    last?.q.some((id) => {
      const track = trackOf(id);
      return track && !track.protected;
    })
  )
    return playIds(last.q, last.i, { play: false });
  await playIds(
    lib
      .get()
      .tracks.filter((t) => !t.protected)
      .map((t) => t.id),
    0,
    { play: false },
  );
}

/** Serialize device configuration and let the latest playback request wait on its completion. */
export async function switchOutput<T>(apply: () => Promise<T>): Promise<T> {
  const prior = audioConfig;
  const tx = (async () => {
    if (prior) await prior.catch(() => {});
    const result = await apply();
    if (!hifiOn()) await waitReleased();
    await hifiRefresh();
    return result;
  })();
  audioConfig = tx;
  if (transport.get().target) void transport.restart();
  try {
    return await tx;
  } finally {
    if (audioConfig === tx) audioConfig = null;
  }
}
onTrouble((kind) => {
  if (transport.get().route !== 'hifi' || !hifiOn()) return;
  toast(tx(kind === 'fallback' ? 's.hifi.fallback' : kind === 'back' ? 's.hifi.backOn' : 's.hifi.toDefault'));
});
export function warmAudio() {
  engine.clock.warm();
}
export async function yieldAudio() {
  transport.pause();
  if (hifiOn()) await hifiRelease().catch((error) => console.warn('hifi release', error));
}

/* ---------- edits to the playing song's tags or cover show at once, in every view ---------- */
// a song added to the list the queue was taken from (a playlist, the favourites, the library) joins the queue too
lib.subscribe((L, prev) => {
  const p = player.get();
  if (p.album || !p.queue.length) return;
  const lists: [string[], string[]][] = [];
  if (L.favorites !== prev.favorites) lists.push([prev.favorites, L.favorites]);
  if (L.playlists !== prev.playlists)
    for (const pl of L.playlists) {
      const was = prev.playlists.find((x) => x.id === pl.id);
      if (was && was.tracks !== pl.tracks) lists.push([was.tracks, pl.tracks]);
    }
  if (L.tracks !== prev.tracks && L.tracks.length > prev.tracks.length)
    lists.push([prev.tracks.map((t) => t.id), L.tracks.map((t) => t.id)]);
  for (const [before, now] of lists) {
    const q = followList(
      p.queue,
      before,
      now.filter((id) => {
        const t = trackOf(id);
        return t && !t.protected;
      }),
    );
    if (q) {
      transport.reconcile(q);
      return;
    }
  }
});
lib.subscribe((L, prev) => {
  if (L.tracks === prev.tracks) return;
  const p = player.get(),
    s = p.session;
  if (!p.shownId) return;
  const t = trackOf(p.shownId),
    was = prev.tracks.find((x) => x.id === p.shownId);
  if (!t || !was) return;
  if (!!was.instrumental !== !!t.instrumental && prepared && visualRequest) {
    scheduleVisual(visualRequest, prepared);
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
  // (its loudness measured just now: taken at once only near the start — later, a jump in the middle of the song would be
  // heard; it applies from the song's next play)
  if (was.loudness?.lufs !== t.loudness?.lufs && transport.time < 2) applyBalance();
  projection.set({ rev: p.rev + 1 });
});

/** The volume balance for the song now playing: a steady gain towards a like loudness. Through the standard output, or
 *  the Hi-Fi output with its own volume, it is a plain gain on the samples; with a fixed (bit-perfect) volume the samples
 *  are left untouched and the balance goes to the device's own hardware volume — and on a device without one, to the
 *  samples after all (the balance is on: the songs are evened out, the output is then not bit-perfect). */
/** The effect lyrics' frame shapes: the scene is planned for the shape (changed in size, never cropped), in the window,
 *  full screen and in an export alike. */
export const FX_ASPECTS: string[] = [...SCHEMA.fxAspect.options];
export const fxAspect = () => {
  const a = settings.get().fxAspect;
  return a && FX_ASPECTS.includes(a) ? a : '16:9';
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
    projection.set({ rev: player.get().rev + 1 });
  }
}
export function applyBalance() {
  const p = player.get(),
    t = p.shownId ? trackOf(p.shownId) : null,
    st = settings.get();
  const db = st.volBalance !== false && t ? balanceDb(t.loudness) : 0,
    fixed = p.route === 'hifi' && st.fixedVolume !== false;
  const hw = fixed && hifi.get().hw?.supported !== false;
  engine.setBalance(hw ? 1 : 10 ** (db / 20));
  if (p.route === 'hifi') hwGain(hw ? db : 0);
}
// (the device answers whether it has a hardware volume: the balance goes where it can)
hifi.subscribe((h, prev) => {
  if (h.hw?.supported !== prev.hw?.supported && player.get().route === 'hifi') applyBalance();
});
/** Mark a song as an instrumental, or no longer. */
export async function setInstrumental(id: string, on: boolean) {
  if (!Lib) return;
  // its look goes with it: the song's own saved look gives way (to the record theme, or back to the cover theme) unless
  // the song is locked, which is how a look is kept on purpose
  const song = (await Lib.song(id).catch(() => null)) as SongData | null;
  if (song && song.style && !song.locked) {
    const { style: _s, ...rest } = song;
    await Lib.setSong(id, rest);
    if (player.get().shownId === id) projection.set({ song: rest });
  }
  await Lib.instrumental(id, on);
  toast(tx(on ? 's.instr.marked' : 's.instr.unmarked'));
}

/* ---------- transport ---------- */
export function toggle() {
  const s = transport.get();
  if (!s.target) {
    const ids = lib
      .get()
      .tracks.filter((t) => !t.protected)
      .map((t) => t.id);
    if (ids.length) void playIds(ids);
  } else if (s.intent) transport.pause();
  else transport.play();
}
export const seekBy = (d: number) => transport.seek(transport.time + d);
export function setVolume(v: number) {
  projection.set({ volume: v });
  keep('vol', v);
  engine.setVolume(v);
}
engine.setVolume(player.get().volume);
engine.setPageBackdrop(ui.get().npLyr.bg || 'ambient');
ui.subscribe((x, y) => {
  if (x.npLyr.bg !== y.npLyr.bg) engine.setPageBackdrop(x.npLyr.bg || 'ambient');
});

/** Initial shuffle selection for the library button. The running queue shuffles occurrences. */
export function shufflePick(queue: string[], current: number, rng = Math.random) {
  const indices = queue.map((_, i) => i).filter((i) => i !== current);
  return weightedPick(indices, (i) => trackOf(queue[i])?.plays || 0, rng) ?? (queue.length ? 0 : -1);
}
export function setMode(mode: Mode) {
  if (!MODES.includes(mode)) return;
  transport.setMode(mode);
  keep('mode', mode);
}
export const next = () => transport.next();
export const prev = () => transport.previous();

/** Add songs at the end of the queue; with nothing selected, start the first of them. */
export async function enqueue(ids: string[]) {
  const p = player.get();
  const add = ids.filter((id) => {
    const t = trackOf(id);
    return t && !t.protected && !p.queue.slice(p.index + 1).includes(id) && id !== p.id;
  });
  if (!add.length) {
    toast(tx('s.queue.already'));
    return;
  }
  const q = p.queue.concat(add);
  transport.reconcile(q);
  const t = trackOf(add[0]);
  toast(add.length > 1 ? tx('s.queue.addedN', { n: add.length }) : tx('s.queue.added', { title: t ? t.title : '' }));
  if (!p.id) await loadAt(q.length - add.length, true);
}
/** Songs to play next, right after the one playing. */
export async function playNext(ids: string[]) {
  const p = player.get();
  const add = ids.filter((id) => {
    const t = trackOf(id);
    return t && !t.protected && id !== p.id;
  });
  if (!add.length) return;
  if (!p.id || p.index < 0) {
    await playIds(add);
    return;
  }
  transport.reconcile(insertNext(p.queue, p.index, add));
  const t = trackOf(add[0]);
  toast(add.length > 1 ? tx('s.queue.nextN', { n: add.length }) : tx('s.queue.nextOne', { title: t ? t.title : '' }));
}
export const playQueueAt = (i: number) => transport.playAt(i);
export const removeFromQueue = (i: number) => transport.remove(i);
export const reorderQueue = (keys: number[]) => transport.reorder(keys);
export const clearQueue = () => transport.clearQueue();
engine.on('change', () => {
  const p = player.get();
  if (p.session) projection.set({ rev: p.rev + 1, hasLyrics: p.session.hasLyrics });
});
D?.onMedia((op) => {
  if (op === 'toggle') toggle();
  else if (op === 'next') void next();
  else if (op === 'prev') void prev();
});

/* ---------- what is bound to the song: saved shortly after each change ---------- */
const songWrites = new Map<string, { timer: number; song: SongData }>();
export function saveSong(patch: Partial<SongData>) {
  const p = player.get();
  if (!p.shownId || !Lib) return;
  const song = { ...(p.song || {}), ...patch };
  projection.set({ song });
  const id = p.shownId;
  clearTimeout(songWrites.get(id)?.timer);
  const timer = window.setTimeout(() => {
    songWrites.delete(id);
    void Lib!.setSong(id, song).catch(() => {});
  }, 500);
  songWrites.set(id, { song, timer });
}
/** Change the shown song's session (its style, timing, lyrics) and keep the change with the song. */
export function editSong(fn: (s: Session) => unknown) {
  const s = player.get().session;
  if (!s || player.get().song?.locked) return;
  fn(s);
  engine.invalidate();
  projection.set({ rev: player.get().rev + 1 });
  saveSong({ style: storedStyle(s.ownStyle()), lshift: s.spec.lshift || 0, v: 3 });
}

/* ---------- lyrics ---------- */
/** New lyrics for the shown song. `edit`: the listener's own edit of the lyrics shown — lyrics that came as TTML were
 *  edited as LRC (ttmlToLrc), and are written back as TTML in their own form (lrcToTtml), never turned into an LRC. */
export async function useLyrics(text: string, o: { edit?: boolean } = {}) {
  {
    const was = player.get().session?.spec.lyrics || '';
    if (o.edit && !isTtml(text) && isTtml(was)) text = lrcToTtml(text, was, (x) => parse(x));
  }
  const p = player.get(),
    s = p.session;
  if (!p.shownId || !s || !Lib) return false;
  s.setLyrics(text);
  await s.flush();
  const current = () => player.get().session === s;
  if (current()) engine.invalidate();
  // (TTML is kept as TTML — a .ttml beside the song; anything else as the setting says)
  if (isTtml(text)) {
    if (current()) projection.set({ hasLyrics: s.hasLyrics, lyrics: { source: 'ttml', text }, rev: p.rev + 1 });
    await Lib.writeLyrics(p.shownId, text, 'ttml');
    return s.hasLyrics;
  }
  if (current())
    projection.set({
      hasLyrics: s.hasLyrics,
      lyrics: { source: settings.get().lyricsTarget === 'lrc' ? 'lrc' : 'embedded', text },
      rev: p.rev + 1,
    });
  if (settings.get().lyricsTarget === 'lrc') await Lib.writeLyrics(p.shownId, text, 'lrc');
  else await writeIntoFile(p.shownId, text);
  return s.hasLyrics;
}
/** The lyrics written into the song's own tags. The file must not be held while it is rewritten: the Hi-Fi player is
 *  stopped (its decoder closed) first, and the song is loaded again afterwards at the same moment, playing if it was. A
 *  format without a lyrics tag gets the .lrc beside it instead; a file another program holds is said so. */
async function writeIntoFile(id: string, text: string) {
  const { generation, intent, target } = transport.get();
  const seq = target?.id === id ? prepared?.nativeSeq : undefined;
  const at = transport.time;
  if (seq !== undefined) {
    transport.pause();
    try {
      await closeFile(seq);
    } catch (error) {
      toast(tx('s.lyr.tagBusy'));
      if (transport.get().generation === generation) void transport.restart(intent, at);
      return;
    }
  }
  const r = await Lib!.writeLyrics(id, text, 'tag').catch((e) => ({ ok: false, why: String(e) }));
  if (!r.ok && r.why === 'unsupported') {
    await Lib!.writeLyrics(id, text, 'lrc');
    toast(tx('s.lyr.tagUnsupported'));
  } else if (!r.ok) toast(tx(r.why === 'busy' ? 's.lyr.tagBusy' : 's.lyr.tagFail', { why: r.why || '' }), 4200);
  else toast(tx('s.lyr.tagSaved'));
  // (back to where it was: the song opened again from the rewritten file)
  if (seq !== undefined && transport.get().generation === generation) await transport.restart(intent, at);
}
/** The shown song's lines as its words are spaced now (one per line). */
export const spacedLines = () =>
  (player.get().session?.doc?.lines || [])
    .filter((L) => L.words.length)
    .map((L) => L.words.map((w) => w.text).join(' '));
/** Keep the listener's spacing of the shown song's lines (only where it differs from the automatic one — the phrases
 *  the singing joins the segmenter's words into, as shown — or from the segmenter's own), or none: every line back to
 *  the automatic spacing at once. */
export async function saveSpacing(edited: string[] | null) {
  const p = player.get(),
    s = p.session;
  if (!s) return;
  let sp: Spacing | undefined;
  // each line as it is shown now (the segmenter's words, joined into the phrases they are sung in — or the listener's own)
  const shown = new Map(
    (s.doc?.lines || [])
      .filter((L) => L.words.length)
      .map((L) => {
        const t = L.words.map((w) => w.text).join(' ');
        return [spacingKey(t), { t, own: !!L.own }];
      }),
  );
  // a line is kept as the listener's when it differs from what is shown, or was theirs already — compared with what is
  // shown, never with the segmenter's own split: a phrase split back to the segmenter's words is an edit too (it used
  // to be taken for no change, and the singing joined it again)
  if (edited) {
    const o: Spacing = {};
    for (const e of edited) {
      const t = e.trim().replace(/\s+/g, ' '),
        k = spacingKey(t),
        cur = shown.get(k);
      if (!t || !cur) continue;
      if (t !== cur.t || cur.own) o[k] = t;
    }
    if (Object.keys(o).length) sp = o;
  }
  s.setSpacing(sp);
  saveSong({ spacing: sp });
  await s.flush();
  if (player.get().session === s) {
    engine.invalidate();
    projection.set({ rev: p.rev + 1 });
  }
}
export const hasTimedLines = (text: string) => parse(text, 0).lines.length > 0 && /\[\d+:\d+/.test(text);
/** Untimed lyrics (plain text): lines spread evenly between the first beat and the end of the music. */
export function spreadPlain(text: string, dur: number) {
  const ls = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ls.length) return '';
  const a = Math.min(8, dur * 0.06),
    b = Math.max(a + 1, dur - Math.min(10, dur * 0.06)),
    step = (b - a) / ls.length;
  const f = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  return ls.map((l, i) => `[${f(a + i * step)}]${l}`).join('\n');
}

/* ---------- MV ---------- */
async function loadMv(id: string, mv: { offset: number }, on: boolean) {
  const generation = transport.get().generation;
  const session = player.get().session;
  engine.mv.offset = mv.offset || 0;
  const ok = await engine.mv.open(`cadenza://mv/${id}?v=${Date.now()}`);
  if (transport.get().generation !== generation || player.get().session !== session || player.get().shownId !== id)
    return;
  projection.set({ mv: { ...player.get().mv, ready: ok, on: ok && on } });
  if (ok && on) engine.mv.setOn(true);
}
export async function bindMv() {
  const p = player.get();
  if (!p.shownId || !Lib) return false;
  const generation = transport.get().generation;
  const r = await Lib.bindMv(p.shownId);
  if (!r || generation !== transport.get().generation) return false;
  // (kept on before the clip is opened: binding it changes the library, and a song opened again meanwhile reads what
  // is kept — it would find the MV off, and turn it off)
  projection.set({
    mv: { bound: true, name: r.name, offset: r.offset, on: false, ready: false },
    song: { ...(p.song || {}), mv: r, mvOn: true },
  });
  saveSong({ mvOn: true });
  await loadMv(p.shownId, r, true);
  return true;
}
export function setMvOn(on: boolean) {
  const p = player.get();
  if (!p.mv.ready) return;
  engine.mv.setOn(on);
  projection.set({ mv: { ...p.mv, on } });
  saveSong({ mvOn: on });
}
export function setMvOffset(x: number) {
  const p = player.get();
  engine.mv.offset = +x || 0;
  engine.invalidate();
  projection.set({ mv: { ...p.mv, offset: +x || 0 } });
  saveSong({ mv: { ...(p.song?.mv || { name: p.mv.name }), offset: +x || 0 } });
}
export async function unbindMv() {
  const p = player.get();
  engine.mv.setOn(false);
  engine.mv.close();
  projection.set({ mv: { bound: false, name: '', offset: 0, on: false, ready: false } });
  saveSong({ mvOn: false });
  if (p.shownId)
    Lib?.setSong(p.shownId, { ...(player.get().song || {}), mv: null, mvOn: false, unbind: true }).catch(() => {});
}

/* ---------- a library song, elsewhere ---------- */
/** For the workshop: a song's audio, analysis, lyrics, cover and bound style. */
export async function songForWorkshop(t: Track) {
  const [buffer, cached, song, lyr] = await Promise.all([
    decodeFile(t.id),
    readRhythm(t.id, t.duration),
    Lib!.song(t.id).catch(() => null),
    Lib!.lyrics(t.id).catch(() => null),
  ]);
  // (the workshop works on the whole reading)
  return {
    buffer,
    analysis: cached || (await analyzeNow(t.id, buffer, false).catch(() => null)),
    song,
    lyrics: t.instrumental ? '' : lyr?.text || '',
    name: t.file,
  };
}
