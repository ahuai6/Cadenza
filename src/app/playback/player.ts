// The desktop player: the playback coordinator wired to the outputs, the queue and the play mode, the volume and its
// balance, media keys, and the file edits that must release a song's output first. The scene is built beside it
// (visual.ts), what is bound to the song is kept by song-data.ts and mv.ts, and the interface reads it all through
// `player` (projection.ts).
import { balanceDb } from '../../engine';
import { tx } from '../../i18n';
import { Lib, D } from '../bridge';
import { lib, ui, settings, toast, trackOf, keep } from '../state';
import { kept, setKept } from '../kept';
import { insertNext, followList } from './queue';
import { engine } from './stage';
import {
  hifiOn,
  refresh as hifiRefresh,
  release as hifiRelease,
  closeFile,
  waitReleased,
  onTrouble,
  hwGain,
  nativeMusic,
  hifi,
} from './hifi';
import { PlaybackCoordinator, weightedPick, type Mode } from './coordinator';
import { prepareOutput, preload, keepPreload, clearPreload, type PreparedOutput } from './outputs';
import { MODES, NO_MV, player, projection } from './projection';
import { cancelVisual, outputReady, scheduleVisual, selectVisual, visualTrace } from './visual';
import { tracePhase } from './trace';
export { MODES, MODE_ICON, player, type Mode, type MvState } from './projection';

export function forgetPrepared(id: string) {
  clearPreload(id);
}

let prepared: PreparedOutput | null = null;
let preloadTimer: ReturnType<typeof setTimeout> | undefined;
let audioConfig: Promise<unknown> | null = null;
let warnedFormat = false;
const tagEdits = new Map<string, ReturnType<NonNullable<typeof Lib>['writeLyrics']>>();

const transport = new PlaybackCoordinator<PreparedOutput>(
  {
    duration: (id) => trackOf(id)?.duration || 0,
    route: () => (hifiOn() ? 'hifi' : 'std'),
    plays: (id) => trackOf(id)?.plays || 0,
    selected(request) {
      prepared = null;
      selectVisual(request);
      clearTimeout(preloadTimer);
      const id = request.entry.id;
      if (request.handoff && projection.get().shownId === id && projection.get().session) return;
      engine.clear(transport.get().album && request.automatic ? 'album' : 'song');
      engine.mv.setOn(false);
      engine.mv.close();
      const s = transport.get();
      // Background priority can change independently of the renderer and the output.
      void Lib?.prioritize([id, ...s.queue.slice(s.index + 1, s.index + 3).map((e) => e.id)]).catch(() => {});
    },
    async prepare(request) {
      const tr = visualTrace();
      while (audioConfig) {
        const configuration = audioConfig;
        await configuration;
        request.signal.throwIfAborted();
        if (audioConfig === configuration) break;
      }
      for (let edit; (edit = tagEdits.get(request.entry.id)); ) {
        request.signal.throwIfAborted();
        await edit.catch(() => {});
      }
      request.signal.throwIfAborted();
      // Settings can change while requests wait for the device transaction.
      const route = hifiOn() ? 'hifi' : 'std';
      let output: PreparedOutput;
      try {
        if (route === 'std') await waitReleased();
        request.signal.throwIfAborted();
        await engine.clock.outputDevice(route === 'hifi');
        request.signal.throwIfAborted();
        applyBalance();
        output = await prepareOutput(
          { ...request, route },
          trackOf(request.entry.id),
          transport.get().album,
          transport.get().position,
        );
      } catch (error) {
        if (route === 'std' || request.signal.aborted) throw error;
        await hifiRelease();
        request.signal.throwIfAborted();
        await engine.clock.outputDevice(false);
        request.signal.throwIfAborted();
        if (!warnedFormat) {
          warnedFormat = true;
          toast(tx('s.hifi.notThis'));
        }
        output = await prepareOutput(
          { ...request, route: 'std' },
          trackOf(request.entry.id),
          transport.get().album,
          transport.get().position,
        );
      }
      if (tr) tracePhase(tr, 'audioPrepared', performance.now() - tr.t0);
      return output;
    },
    ready(request, output) {
      prepared = output;
      const { queue, index } = transport.get();
      setKept('queue', { q: queue.slice(0, 3000).map((e) => e.id), i: index });
      applyBalance();
      outputReady(request, output);
      if (!request.handoff || !projection.get().session) scheduleVisual();
      schedulePreload();
    },
  },
  player.get().mode,
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
engine.followTransport({
  time: () => transport.time,
  playing: () => transport.get().phase === 'playing',
  ended: () => transport.get().phase === 'ended',
  liveAnalysis: () => {
    const { output, phase, route } = transport.get();
    if (phase !== 'playing' || output?.id !== engine.session?.spec.key) return null;
    if (route === 'std') return engine.clock.liveMusic();
    const level = nativeMusic();
    return level == null ? null : { level };
  },
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
    ...(requested && !(s.handoff && projection.get().session)
      ? {
          id: s.target?.id ?? null,
          shownId: s.target?.id ?? null,
          session: null,
          song: null,
          lyrics: null,
          hasLyrics: false,
          visualError: null,
          dir: s.direction,
          mv: NO_MV,
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
  if (
    s.generation === previous.generation &&
    (s.candidate !== previous.candidate || (s.route === 'std' && s.phase !== previous.phase)) &&
    prepared
  )
    schedulePreload();
  if (s.phase === 'playing' && s.target && lastPlayedGeneration !== s.generation) {
    lastPlayedGeneration = s.generation;
    if (!s.handoff || s.target.key !== lastPlayedEntry) {
      lastPlayedEntry = s.target.key;
      void Lib?.played(s.target.id).catch(() => {});
    }
  }
  if (s.phase === 'error' && previous.phase !== 'error') {
    console.warn('audio playback', s.error);
    toast(tx(s.error === 'hifi-down' ? 's.hifi.down' : 'aud.bad'));
  }
  engine.transportChanged();
});
let lastPlayedEntry = 0;
let lastPlayedGeneration = 0;
function schedulePreload() {
  clearTimeout(preloadTimer);
  const { candidate, target, route, generation, phase, album } = transport.get();
  if (!target || settings.get().prerender === false || phase === 'error') return clearPreload();
  const track = candidate ? trackOf(candidate.id) : null;
  keepPreload(track, album);
  if (route === 'std' && phase !== 'playing') return;
  preloadTimer = setTimeout(() => {
    const s = transport.get();
    if (generation === s.generation && s.candidate === candidate && (route === 'hifi' || s.phase === 'playing')) {
      preload(candidate ? trackOf(candidate.id) : null, route, prepared, album);
    }
  }, 1500);
}
settings.subscribe((next, previous) => {
  if (transport.get().route === 'std' && next.prerender !== previous.prerender) schedulePreload();
});

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
  const last = kept<{ q: string[]; i: number } | null>('queue', null);
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
  const transaction = Promise.resolve(prior)
    .catch(() => {})
    .then(async () => {
      const result = await apply();
      if (!hifiOn()) await waitReleased();
      await hifiRefresh();
      return result;
    });
  audioConfig = transaction;
  const handoff = transport.handoff();
  try {
    const result = await transaction;
    await handoff;
    return result;
  } finally {
    if (audioConfig === transaction) audioConfig = null;
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

/* ---------- the library changes under the queue ---------- */
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
// (the shown song's loudness measured just now: taken at once only near the start — later, a jump in the middle of the
// song would be heard; it applies from the song's next play)
lib.subscribe((L, prev) => {
  if (L.tracks === prev.tracks || transport.time >= 2) return;
  const id = player.get().shownId;
  const t = id ? trackOf(id) : null,
    was = id ? prev.tracks.find((x) => x.id === id) : null;
  if (t && was && t !== was && was.loudness?.lufs !== t.loudness?.lufs) applyBalance();
});

/* ---------- volume ---------- */
/** The volume balance for the song now playing: a steady gain towards a like loudness. Through the standard output, or
 *  the Hi-Fi output with its own volume, it is a plain gain on the samples; with a fixed (bit-perfect) volume the samples
 *  are left untouched and the balance goes to the device's own hardware volume — and on a device without one, to the
 *  samples after all (the balance is on: the songs are evened out, the output is then not bit-perfect). */
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

/* ---------- transport and queue ---------- */
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

/* ---------- edits written into a song's file ---------- */
/** Serialize writes and keep any new prepare for this file behind the edit. Playback controls retain their latest intent. */
export async function writeIntoFile(id: string, write: () => ReturnType<NonNullable<typeof Lib>['writeLyrics']>) {
  const { target, route, phase } = transport.get();
  const current = target?.id === id;
  const seq = current ? prepared?.nativeSeq : undefined;
  const previous = tagEdits.get(id);
  const edit = (async () => {
    // Publish the lane and release this song's output before asking the main process to replace the file.
    await previous?.catch(() => {});
    if (seq !== undefined) {
      try {
        await closeFile(seq);
      } catch {
        toast(tx('s.lyr.tagBusy'));
        return { ok: false as const, target: undefined };
      }
    }
    const r = await write().catch((e) => ({ ok: false, target: undefined, why: String(e) }));
    if (!r.ok) toast(tx(r.why === 'busy' ? 's.lyr.tagBusy' : 's.lyr.tagFail', { why: r.why || '' }), 4200);
    else {
      const fresh = await Lib!.get().catch(() => null);
      if (fresh) lib.set(fresh);
      toast(tx(r.target === 'tag' ? 's.lyr.tagSaved' : 's.lyr.saved'));
    }
    return r;
  })().finally(() => {
    if (tagEdits.get(id) === edit) tagEdits.delete(id);
  });
  tagEdits.set(id, edit);
  clearPreload(id);
  const resume =
    seq !== undefined || (current && (phase === 'preparing' || (route === 'std' && prepared)))
      ? transport.restart()
      : null;
  const result = await edit;
  await resume;
  return result;
}
