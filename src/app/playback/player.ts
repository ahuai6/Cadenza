// The player: the queue, and opening one song as a Session with everything bound to it. The data path for a song:
//   scan (main process): tags, cover, .lrc found  →  background analysis: the rhythm SDK runs once, cached on disk
//   play: audio decoded (cadenza://media)  +  cached analysis  +  lyrics  +  the song's own style  →  Session  →  engine
//     (Hi-Fi output: the native player decodes the file instead, and its clock drives the engine)
//   while it plays: the next song in the queue is prepared ahead, so skipping never waits
//   edits in the song's panel  →  the session replans; saved to that song (style, timing, lock, MV), lyrics to its .lrc
// A song change is one swap: the new session is built completely, then shown; the picture crossfades and every view
// (card, now playing, effect lyrics) switches together, however fast the user skips (each request supersedes the last).
import { createStore } from '../../core/emitter';
import { Session, type AudioLike } from '../../engine';
import { ensureFont, RHYTHM_VERSION, isCurrent, balanceDb, parseLyrics as parse, autoSpacing, spacingKey, type RhythmAnalysis, type Spacing } from '../../engine';
import { storedStyle, type Style } from '../../theme/style';
import { tx } from '../../i18n';
import { Lib, D, coverUrl, mediaUrl, type SongData, type Track } from '../bridge';
import { lib, ui, settings, toast, trackOf, remember, keep } from '../state';
import { engine, sessionEnv } from './stage';
import { analyzeNow } from './analysis';
import { hifiOn, output, load as hifiLoad, preload as hifiPreload, refresh as hifiRefresh, release as hifiRelease, onTrouble, hwGain, hifi } from './hifi';

export type Mode = 'loop' | 'shuffle' | 'one' | 'stop';
export const MODES: Mode[] = ['loop', 'shuffle', 'one', 'stop'];
export const MODE_ICON: Record<Mode, string> = { loop: 'repeat', shuffle: 'shuffle', one: 'repeat1', stop: 'once' };
export interface MvState { bound: boolean; name: string; offset: number; on: boolean; ready: boolean }
export const player = createStore({
  /** the song asked for (the card shows it at once) and the song on screen (its session is built and shown) */
  id: null as string | null, shownId: null as string | null, session: null as Session | null, rev: 0,
  queue: [] as string[], index: -1, loading: false, playing: false, song: null as SongData | null,
  lyrics: null as { source: string; text: string } | null, hasLyrics: false, route: 'std' as 'std' | 'hifi',
  mv: { bound: false, name: '', offset: 0, on: false, ready: false } as MvState, mode: remember<Mode>('mode', 'loop'), error: null as string | null,
  volume: remember('vol', 1),
  /** album play: the queue is one album, played through in order as one continuous film in the first song's look */
  album: null as null | { look: Partial<Style> | null },
  /** which way the last change of song went (1 on to the next, −1 back, 0 a jump), for the pages' own transitions */
  dir: 0 as -1 | 0 | 1,
});

/* ---------- decoding, with the next song prepared ahead ---------- */
let decoder: OfflineAudioContext | null = null;
const decodeFile = async (id: string) => { const r = await fetch(mediaUrl(id)); if (!r.ok) throw new Error('read'); return (decoder ||= new OfflineAudioContext(2, 1, 48000)).decodeAudioData(await r.arrayBuffer()); };
const cache = new Map<string, Promise<{ buffer: AudioBuffer | null; analysis: RhythmAnalysis | null }>>();
function prepare(id: string, route: 'std' | 'hifi') {
  const key = route + ':' + id, hit = cache.get(key); if (hit) return hit;
  const p = (async () => {
    let analysis = await Lib!.analysis(id, RHYTHM_VERSION).catch(() => null) as RhythmAnalysis | null;
    if (!isCurrent(analysis)) analysis = null;
    // the Hi-Fi output reads the file itself: the page decodes only to analyse a song the cache does not have yet
    if (route === 'hifi') return { buffer: null, analysis: analysis || await analyzeNow(id, null, true).catch(() => null) };
    const buffer = await decodeFile(id);
    // (a cached reading made for audio of another length — the file replaced under the same name — is not this song's)
    if (analysis && !isCurrent(analysis, buffer.duration)) analysis = null;
    return { buffer, analysis: analysis || await analyzeNow(id, buffer, true).catch(() => null) };
  })();
  cache.set(key, p); p.catch(() => cache.delete(key));
  while (cache.size > 4) cache.delete(cache.keys().next().value!);
  return p;
}
/** What the engine holds for audio the native player plays: its length and layout, and a way to decode it after all
 *  (only an export with sound needs the samples). */
function standIn(id: string, r: { dur: number; src: { rate: number; ch: number } } | null, t: Track | null): AudioLike {
  const dur = r && r.dur > 0 ? r.dur : (t && t.duration) || 0, rate = r ? r.src.rate : 48000;
  return { duration: dur, sampleRate: rate, numberOfChannels: r ? Math.min(2, r.src.ch) : 2, length: Math.round(dur * rate), load: () => decodeFile(id) };
}

/* ---------- opening a song ---------- */
let gen = 0, stale = false, warnedFormat = false;
/** Play a list: it becomes the queue, in its own order (shuffle only changes which song comes next). */
export async function playIds(ids: string[], index = 0, opts: { play?: boolean; album?: boolean } = {}) {
  const want = ids[Math.min(Math.max(0, index), ids.length - 1)];
  ids = ids.filter(id => { const t = trackOf(id); return t && !t.protected; });
  if (!ids.length) return;
  history.length = 0; round.clear();
  const i = Math.max(0, ids.indexOf(want));
  player.set({ queue: ids, index: i, album: opts.album ? { look: null } : null });
  await loadAt(i, opts.play !== false);
}
/** Everything a song needs to be shown: its audio (through the output asked for, or the standard one when the Hi-Fi
 *  output cannot take it), its rhythm, what is kept with it, and its session. */
async function openSong(id: string, wantRoute: 'std' | 'hifi', ok: () => boolean) {
  let route = wantRoute;
  const [prep0, song, lyr, hr] = await Promise.all([prepare(id, route), Lib!.song(id).catch(() => null), Lib!.lyrics(id).catch(() => null),
    route === 'hifi' ? hifiLoad(id).catch(e => { console.warn('hifi', e.message); return null; }) : null]);
  if (!ok()) return null;
  let prep = prep0;
  if (route === 'hifi' && !hr) {
    // a file the Hi-Fi output cannot read, or it is not running: this song goes through the standard output
    route = 'std'; if (!warnedFormat) { warnedFormat = true; toast(tx('s.hifi.notThis')); }
    prep = await prepare(id, 'std'); if (!ok()) return null;
  }
  const t = trackOf(id)!, instr = !!t.instrumental, album = player.get().album;
  // an instrumental: its own line in place of lyrics, and the record theme unless the song already has a look of its own.
  // In album play: no fade at the end (the audio is the album's own), only the small title, the first song's look
  const s = await Session.open({ key: id, lyrics: instr ? instrumentalLyrics() : lyr?.text || '', style: song?.style, preset: instr ? 'vinyl' : undefined, song: { on: true, title: t.title, artist: t.artist || '', composer: t.composer || '', lyricist: t.lyricist || '', album: !!album },
    coverUrl: coverUrl(t.cover, true), audio: prep.buffer || standIn(id, hr, t), analysis: prep.analysis, lshift: song?.lshift || 0, spacing: song?.spacing, fade: !album, aspect: fxAspect(), look: album?.look || undefined }, sessionEnv());
  // the play page's own lyric face, its glyphs for these lyrics in before the page shows them (never a late swap)
  { const f = ui.get().npLyr.font; if (f && f !== 'ui' && s.hasLyrics) await Promise.race([ensureFont(f, s.doc.lines.map(L => L.text).join('')), new Promise(r => setTimeout(r, 1500))]); }
  return { s, route, song, lyr };
}
/** Album play: the next song opened ahead, so the film runs straight on into it (standard output only: the Hi-Fi output
 *  takes one song at a time and has its own preloading). */
let ahead: { id: string; p: Promise<Awaited<ReturnType<typeof openSong>>> } | null = null;
async function loadAt(index: number, play: boolean, at = 0, how: { dir?: -1 | 0 | 1; auto?: boolean } = {}) {
  const { queue } = player.get(), id = queue[index]; if (!id || !Lib) return;
  const my = ++gen, album = player.get().album;
  player.set({ index, id, loading: true, error: null, dir: how.dir ?? 0 });
  Lib.prioritize([id, ...queue.slice(index + 1, index + 3)]).catch(() => {});
  try {
    const want: 'std' | 'hifi' = hifiOn() ? 'hifi' : 'std', pre = ahead && ahead.id === id && want === 'std' && album ? ahead.p : null; ahead = null;
    const o = (pre ? await pre.catch(() => null) : null) || await openSong(id, want, () => my === gen);
    if (!o || my !== gen) return;
    const { s, route, song, lyr } = o;
    if (album && !album.look) player.set({ album: { look: s.lookOf() } });
    stale = false;
    engine.pause();                                   // before the output changes: nothing replays on the way
    engine.setOutput(route === 'hifi' ? output : null);
    engine.mv.setOn(false); engine.mv.close();
    engine.show(s, { transition: album && how.auto ? 'album' : 'song', at, play });
    const mv = song?.mv;
    player.set({ shownId: id, session: s, loading: false, route, song: song || {}, lyrics: lyr, hasLyrics: s.hasLyrics,
      mv: { bound: !!mv, name: mv ? mv.name : '', offset: mv ? mv.offset : 0, on: false, ready: false } });
    if (mv) loadMv(id, mv, !!song?.mvOn);
    applyBalance();
    Lib.played(id).catch(() => {});
    keep('last', { q: player.get().queue.slice(0, 3000), i: index });
    // the next song, ready before it is needed
    const nx = player.get().queue[index + 1];
    if (nx && settings.get().prerender !== false) setTimeout(() => { if (my !== gen) return; prepare(nx, route).catch(() => {}); if (route === 'hifi') hifiPreload(nx); }, 1500);
    if (nx && album && route === 'std') setTimeout(() => { if (my !== gen || ahead) return; const p = openSong(nx, 'std', () => true); p.catch(() => {}); ahead = { id: nx, p }; }, 6000);
  } catch (e) {
    if (my !== gen) return; console.warn('load failed', e);
    player.set({ loading: false, error: String((e as Error)?.message || e) }); toast(tx('aud.bad'));
  }
}
/** At launch: the song last shown (in its queue) is opened again, paused, so the play page and its picture are made and
 *  ready before anything is played — opening the page or pressing play is then immediate. */
export async function resumeLast() {
  if (player.get().id) return;
  const L = remember<{ q: string[]; i: number } | null>('last', null), ok = (id: string) => { const t = trackOf(id); return !!t && !t.protected; };
  let q = (L?.q || []).filter(ok), i = L && L.q[L.i] ? q.indexOf(L.q[L.i]) : -1;
  if (!q.length) { q = lib.get().tracks.filter(t => !t.protected).map(t => t.id); i = 0; }
  if (q.length) await playIds(q, Math.max(0, i), { play: false });
}
/** The output was switched in the settings: the same song, from the same moment, through the other one. */
export async function switchOutput() {
  await hifiRefresh();
  const p = player.get(); if (!p.id) return;
  await loadAt(p.index, p.playing, engine.time);
}
onTrouble(kind => {
  if (!engine.clock.external) return;
  if (kind === 'fallback') { toast(tx('s.hifi.fallback')); return; }
  stale = true; engine.pause(); toast(tx(kind === 'down' ? 's.hifi.down' : 's.hifi.deviceLost'));
});
/** The workshop takes the audio device: the player pauses and the Hi-Fi output lets go of it. */
export function yieldAudio() { engine.pause(); if (engine.clock.external) { hifiRelease(); stale = true; } }

/* ---------- edits to the playing song's tags or cover show at once, in every view ---------- */
lib.subscribe((L, prev) => {
  if (L.tracks === prev.tracks) return;
  const p = player.get(), s = p.session; if (!s || !p.shownId) return;
  const t = trackOf(p.shownId), was = prev.tracks.find(x => x.id === p.shownId); if (!t || !was) return;
  if (was.title !== t.title || was.artist !== t.artist) { s.setSong({ title: t.title, artist: t.artist || '' }); engine.invalidate(); }
  if (was.cover !== t.cover) s.setCover(coverUrl(t.cover, true), false).then(() => engine.invalidate());
  if (!!was.instrumental !== !!t.instrumental) { loadAt(p.index, p.playing, engine.time); return; }
  // (its loudness measured just now: taken at once only near the start — later, a jump in the middle of the song would be
  // heard; it applies from the song's next play)
  if (was.loudness?.lufs !== t.loudness?.lufs && engine.time < 2) applyBalance();
  player.set({ rev: p.rev + 1 });
});

/** The volume balance for the song now playing: a steady gain towards a like loudness. Through the standard output, or
 *  the Hi-Fi output with its own volume, it is a plain gain on the samples; with a fixed (bit-perfect) volume the samples
 *  are left untouched and the balance goes to the device's own hardware volume — and on a device without one, to the
 *  samples after all (the balance is on: the songs are evened out, the output is then not bit-perfect). */
/** The effect lyrics' frame shapes: the scene is planned for the shape (changed in size, never cropped), in the window,
 *  full screen and in an export alike. */
export const FX_ASPECTS = ['16:9', '16:10', '9:16', '1:1'];
export const fxAspect = () => { const a = settings.get().fxAspect; return a && FX_ASPECTS.includes(a) ? a : '16:9'; };
/** Change the shape: kept for every song, and the song shown is planned again for it at once. */
export function setFxAspect(a: string) {
  if (!FX_ASPECTS.includes(a)) return; settings.set({ fxAspect: a }); D?.setSettings({ fxAspect: a });
  const s = player.get().session; if (s) { s.spec.aspect = a; s.setStyle('aspect', a); engine.invalidate(); player.set({ rev: player.get().rev + 1 }); }
}
export function applyBalance() {
  const p = player.get(), t = p.shownId ? trackOf(p.shownId) : null, st = settings.get();
  const db = st.volBalance !== false && t ? balanceDb(t.loudness) : 0, fixed = p.route === 'hifi' && st.fixedVolume !== false;
  const hw = fixed && hifi.get().hw?.supported !== false;
  engine.setBalance(hw ? 1 : 10 ** (db / 20));
  if (p.route === 'hifi') hwGain(hw ? db : 0);
}
// (the device answers whether it has a hardware volume: the balance goes where it can)
hifi.subscribe((h, prev) => { if (h.hw?.supported !== prev.hw?.supported && player.get().route === 'hifi') applyBalance(); });
/** What an instrumental shows instead of lyrics: one line, a moment in, for a few bars. */
export const instrumentalLyrics = () => `[00:01.50]${tx('s.instr.text')}\n[00:10.00]`;
/** Mark a song as an instrumental, or no longer. */
export async function setInstrumental(id: string, on: boolean) {
  if (!Lib) return;
  // its look goes with it: the song's own saved look gives way (to the record theme, or back to the cover theme) unless
  // the song is locked, which is how a look is kept on purpose
  const song = await Lib.song(id).catch(() => null) as SongData | null;
  if (song && song.style && !song.locked) { const { style: _s, ...rest } = song; await Lib.setSong(id, rest); if (player.get().shownId === id) player.set({ song: rest }); }
  await Lib.instrumental(id, on); toast(tx(on ? 's.instr.marked' : 's.instr.unmarked'));
}

/* ---------- transport ---------- */
export function toggle() {
  const p = player.get();
  if (!p.id) { const t = lib.get().tracks.filter(x => !x.protected); if (t.length) playIds(t.map(x => x.id)); return; }
  if (stale && !engine.isPlaying) { loadAt(p.index, true, engine.time); return; }      // load it again, then go on from there
  engine.toggle();
}
export const seekBy = (d: number) => { const s = player.get().session; if (s) engine.seek(Math.max(0, Math.min(s.musicEnd, engine.time + d))); };
export function setVolume(v: number) { player.set({ volume: v }); keep('vol', v); engine.setVolume(v); }
engine.setVolume(player.get().volume);
/* the queue and how it moves on:
   loop    the queue in order, round and round
   shuffle a pseudo-random pick each time, from the songs not yet heard this round (no repeats until all have played);
           a song played less often is more likely: weight 1 / (1 + plays)^0.75
   one     the same song again when it ends (skipping still moves on)
   stop    the queue in order once, pausing after the last song */
const history: string[] = [];
const round = new Set<string>();
let seed = (Date.now() ^ 0x9e3779b9) >>> 0;
const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export function shufflePick(queue: string[], current: number, rng = rand) {
  const n = queue.length; if (n < 2) return n ? 0 : -1;
  if (current >= 0) round.add(queue[current]);
  let cand: number[] = []; for (let i = 0; i < n; i++) if (i !== current && !round.has(queue[i])) cand.push(i);
  if (!cand.length) { round.clear(); if (current >= 0) round.add(queue[current]); cand = []; for (let i = 0; i < n; i++) if (i !== current) cand.push(i); }
  const w = cand.map(i => 1 / Math.pow(1 + (trackOf(queue[i])?.plays || 0), 0.75)), sum = w.reduce((a, b) => a + b, 0);
  let r = rng() * sum; for (let k = 0; k < cand.length; k++) { r -= w[k]; if (r <= 0) return cand[k]; }
  return cand[cand.length - 1];
}
export function setMode(m: Mode) { if (!MODES.includes(m)) return; player.set({ mode: m }); keep('mode', m); if (m === 'shuffle') round.clear(); }
export async function next(auto = false) {
  const p = player.get(), n = p.queue.length; if (!n) return;
  if (auto && p.mode === 'one') { engine.seek(0); engine.play(); return; }
  let j: number;
  // (an album plays through in its own order, once — round again only in the loop mode)
  if (p.mode === 'shuffle' && !p.album) j = shufflePick(p.queue, p.index);
  else { j = p.index + 1; if (j >= n) { if (auto && (p.mode === 'stop' || (p.album && p.mode !== 'loop'))) { engine.pause(); return; } j = 0; } }
  if (j < 0) return;
  if (p.id) history.push(p.id); if (history.length > 200) history.shift();
  await loadAt(j, true, 0, { dir: 1, auto });
}
export async function prev() {
  const p = player.get();
  if (engine.time > 3) { engine.seek(0); return; }
  if (p.mode === 'shuffle' && !p.album) { while (history.length) { const id = history.pop()!, i = p.queue.indexOf(id); if (i >= 0) { await loadAt(i, true, 0, { dir: -1 }); return; } } }
  if (p.index > 0) await loadAt(p.index - 1, true, 0, { dir: -1 }); else if (p.mode === 'loop' && p.queue.length > 1) await loadAt(p.queue.length - 1, true, 0, { dir: -1 }); else engine.seek(0);
}
/** Add songs at the end of the queue; with nothing playing, the first of them starts. */
export async function enqueue(ids: string[]) {
  const p = player.get(), add = ids.filter(id => { const t = trackOf(id); return t && !t.protected && !p.queue.slice(p.index + 1).includes(id) && id !== p.id; });
  if (!add.length) { toast(tx('s.queue.already')); return; }
  const q = p.queue.concat(add); player.set({ queue: q });
  const t = trackOf(add[0]); toast(add.length > 1 ? tx('s.queue.addedN', { n: add.length }) : tx('s.queue.added', { title: t ? t.title : '' }));
  if (!p.id) await loadAt(q.length - add.length, true);
}
export async function playQueueAt(i: number) { const p = player.get(); if (i === p.index) { engine.play(); return; } if (p.id) history.push(p.id); await loadAt(i, true); }
export function removeFromQueue(i: number) { const p = player.get(); if (i === p.index || i < 0 || i >= p.queue.length) return; const q = p.queue.slice(); q.splice(i, 1); player.set({ queue: q, index: i < p.index ? p.index - 1 : p.index }); }
export function reorderQueue(ids: string[]) { const p = player.get(); if (ids.length !== p.queue.length) return; player.set({ queue: ids, index: Math.max(0, ids.indexOf(p.id!)) }); }
export function clearQueue() { const p = player.get(); if (!p.id) { player.set({ queue: [], index: -1 }); return; } player.set({ queue: [p.id], index: 0 }); history.length = 0; round.clear(); }
engine.on('change', () => { const pl = engine.isPlaying, p = player.get(); player.set({ playing: pl, rev: p.rev + 1, hasLyrics: p.session ? p.session.hasLyrics : false }); });
// the music ends: with the picture closed go on at once; in the effect view let the ending card play out first (album
// play has none: the next song follows straight on)
engine.on('musicend', s => { if (s === player.get().session && (ui.get().layer !== 'fx' || player.get().album)) next(true); });
engine.on('ended', s => { if (s === player.get().session && ui.get().layer === 'fx' && !player.get().album) next(true); });
D?.onMedia(op => { if (op === 'toggle') toggle(); else if (op === 'next') next(); else if (op === 'prev') prev(); });

/* ---------- what is bound to the song: saved shortly after each change ---------- */
let saveTm = 0;
export function saveSong(patch: Partial<SongData>) {
  const p = player.get(); if (!p.shownId || !Lib) return;
  const song = { ...(p.song || {}), ...patch }; player.set({ song });
  clearTimeout(saveTm); const id = p.shownId; saveTm = window.setTimeout(() => Lib!.setSong(id, song).catch(() => {}), 500);
}
/** Change the shown song's session (its style, timing, lyrics) and keep the change with the song. */
export function editSong(fn: (s: Session) => unknown) {
  const s = player.get().session; if (!s || player.get().song?.locked) return;
  fn(s); engine.invalidate(); player.set({ rev: player.get().rev + 1 });
  saveSong({ style: storedStyle(s.ownStyle()), lshift: s.spec.lshift || 0, v: 3 });
}

/* ---------- lyrics ---------- */
export async function useLyrics(text: string) {
  const p = player.get(), s = p.session; if (!p.shownId || !s || !Lib) return false;
  s.setLyrics(text); await s.flush(); engine.invalidate();
  await Lib.writeLyrics(p.shownId, text);
  player.set({ hasLyrics: s.hasLyrics, lyrics: { source: 'lrc', text }, rev: p.rev + 1 });
  return s.hasLyrics;
}
/** The shown song's lines as its words are spaced now (one per line). */
export const spacedLines = () => (player.get().session?.doc?.lines || []).filter(L => L.words.length).map(L => L.words.map(w => w.text).join(' '));
/** Keep the listener's spacing of the shown song's lines (only where it differs from the segmenter's), or none: every
 *  line back to the segmenter's at once. */
export async function saveSpacing(edited: string[] | null) {
  const p = player.get(), s = p.session; if (!s) return;
  let sp: Spacing | undefined;
  if (edited) { const o: Spacing = {}; for (const e of edited) { const t = e.trim().replace(/\s+/g, ' '); if (t && t !== autoSpacing(t)) o[spacingKey(t)] = t; } if (Object.keys(o).length) sp = o; }
  s.setSpacing(sp); await s.flush(); engine.invalidate(); saveSong({ spacing: sp }); player.set({ rev: p.rev + 1 });
}
export const hasTimedLines = (text: string) => parse(text, 0).lines.length > 0 && /\[\d+:\d+/.test(text);
/** Untimed lyrics (plain text): lines spread evenly between the first beat and the end of the music. */
export function spreadPlain(text: string, dur: number) {
  const ls = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean); if (!ls.length) return '';
  const a = Math.min(8, dur * 0.06), b = Math.max(a + 1, dur - Math.min(10, dur * 0.06)), step = (b - a) / ls.length;
  const f = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  return ls.map((l, i) => `[${f(a + i * step)}]${l}`).join('\n');
}

/* ---------- MV ---------- */
async function loadMv(id: string, mv: { offset: number }, on: boolean) {
  engine.mv.offset = mv.offset || 0;
  const ok = await engine.mv.open(`cadenza://mv/${id}?v=${Date.now()}`);
  if (player.get().shownId !== id) return;
  player.set({ mv: { ...player.get().mv, ready: ok, on: ok && on } }); if (ok && on) engine.mv.setOn(true);
}
export async function bindMv() {
  const p = player.get(); if (!p.shownId || !Lib) return false;
  const r = await Lib.bindMv(p.shownId); if (!r) return false;
  player.set({ mv: { bound: true, name: r.name, offset: r.offset, on: false, ready: false }, song: { ...(p.song || {}), mv: r } });
  await loadMv(p.shownId, r, true); saveSong({ mvOn: true }); return true;
}
export function setMvOn(on: boolean) { const p = player.get(); if (!p.mv.ready) return; engine.mv.setOn(on); player.set({ mv: { ...p.mv, on } }); saveSong({ mvOn: on }); }
export function setMvOffset(x: number) { const p = player.get(); engine.mv.offset = +x || 0; engine.invalidate(); player.set({ mv: { ...p.mv, offset: +x || 0 } }); saveSong({ mv: { ...(p.song?.mv || { name: p.mv.name }), offset: +x || 0 } }); }
export async function unbindMv() {
  const p = player.get(); engine.mv.setOn(false); engine.mv.close(); player.set({ mv: { bound: false, name: '', offset: 0, on: false, ready: false } });
  saveSong({ mvOn: false }); if (p.shownId) Lib?.setSong(p.shownId, { ...(player.get().song || {}), mv: null, mvOn: false, unbind: true }).catch(() => {});
}

/* ---------- a library song, elsewhere ---------- */
/** For the workshop: a song's audio, analysis, lyrics, cover and bound style. */
export async function songForWorkshop(t: Track) {
  const [prep, song, lyr] = await Promise.all([prepare(t.id, 'std'), Lib!.song(t.id).catch(() => null), Lib!.lyrics(t.id).catch(() => null)]);
  return { buffer: prep.buffer, analysis: prep.analysis, song, lyrics: t.instrumental ? instrumentalLyrics() : lyr?.text || '', name: t.file };
}
