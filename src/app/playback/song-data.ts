// What is bound to the shown song and kept with it: its own style and timing, the spacing of its lines, its MV binding
// (saved shortly after each change, in the order made), the listening choices made for it, whether it is an
// instrumental — and a library song's data as the workshop opens it.
import { spacingKey, type Session, type Spacing } from '../../engine';
import { storedStyle } from '../../theme/style';
import { tx } from '../../i18n';
import { Lib, type SongData, type Track } from '../bridge';
import { toast } from '../state';
import { beforeEditingExit, canEdit } from '../editing';
import { applyExistingPreset, type PresetChoice } from '../preset-choice';
import { setSongChoices, songChoices } from '../kept';
import { engine } from './stage';
import { bumpScene, player, projection } from './projection';
import { readRhythm, requestAnalysis } from './analysis';
import { decodeFile } from './pcm';

/* ---------- saved shortly after each change ---------- */
const songWrites = new Map<string, { timer: number; song: SongData }>();
const writing = new Map<string, Promise<boolean>>();
/** A song's data not yet written (the newest the page holds), if any. */
export const unsavedSong = (id: string) => songWrites.get(id)?.song;
export function writeSong(id: string): Promise<boolean> {
  const entry = songWrites.get(id);
  if (!entry || !Lib) return Promise.resolve(true);
  clearTimeout(entry.timer);
  const work = (async () => {
    await writing.get(id);
    if (songWrites.get(id) !== entry) return true;
    const saved = await Lib!.setSong(id, entry.song).catch(() => false);
    if (saved && songWrites.get(id) === entry) songWrites.delete(id);
    return saved;
  })();
  writing.set(id, work);
  void work.then(() => {
    if (writing.get(id) === work) writing.delete(id);
  });
  return work;
}
beforeEditingExit(async () => (await Promise.all([...songWrites.keys()].map(writeSong))).every(Boolean));
export function saveSong(patch: Partial<SongData>) {
  const p = player.get();
  if (!canEdit() || !p.shownId || !Lib) return;
  const id = p.shownId;
  if (songWrites.get(id)?.song.unbind && !Object.hasOwn(patch, 'mv')) patch = { ...patch, unbind: true };
  const song = { ...(p.song || {}), ...patch };
  const { unbind: _, ...visible } = song;
  projection.set({ song: visible });
  clearTimeout(songWrites.get(id)?.timer);
  const timer = window.setTimeout(() => void writeSong(id), 500);
  songWrites.set(id, { song, timer });
}

/** Change the shown song's session (its style, timing, lyrics) and keep the change with the song. */
export function editSong(fn: (s: Session) => unknown) {
  const { session: s, song, shownId } = player.get();
  if (!canEdit() || !s || song?.locked) return;
  fn(s);
  engine.invalidate();
  bumpScene();
  if (shownId) setSongChoices(shownId, []);
  saveSong({ style: storedStyle(s.ownStyle()), lshift: s.spec.lshift || 0, v: 3 });
}

/** Listening choices preserve the saved per-song style and offer only registered presets. */
export function chooseSongPreset(choice: PresetChoice) {
  const { session, shownId } = player.get();
  if (!session || !shownId || !applyExistingPreset(session, choice)) return;
  if (canEdit() && !player.get().song?.locked) {
    editSong(() => {});
    return;
  }
  const family = (option: PresetChoice) => option.kind === 'look' || option.kind === 'theme';
  const prior = songChoices<PresetChoice>(shownId).filter((option) => family(option) !== family(choice));
  setSongChoices(shownId, [...(choice.kind === 'theme' ? [] : prior), choice]);
  engine.invalidate();
  bumpScene();
}
/** The listening choices made for a song, applied to its new session. */
export async function applySongChoices(id: string, s: Session) {
  const selections = songChoices<PresetChoice>(id);
  for (const selection of selections) applyExistingPreset(s, selection);
  if (selections.length) await s.flush();
}

export function setLyricOffset(lshift: number) {
  const { session, song } = player.get();
  if (!canEdit() || !session || song?.locked) return;
  session.setTiming({ lshift });
  engine.invalidate();
  bumpScene();
  saveSong({ lshift });
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
  if (!canEdit()) return false;
  const s = player.get().session;
  if (!s) return false;
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
    bumpScene();
  }
  return true;
}

/** Mark a song as an instrumental, or no longer. */
export async function setInstrumental(id: string, on: boolean) {
  if (!canEdit()) return;
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

/** For the workshop: a song's audio, analysis, lyrics, cover and bound style. */
export async function songForWorkshop(t: Track) {
  const [buffer, cached, song, lyr] = await Promise.all([
    decodeFile(t.id, undefined, t.mediaRevision),
    readRhythm(t.id, t.duration),
    Lib!.song(t.id).catch(() => null),
    Lib!.lyrics(t.id).catch(() => null),
  ]);
  // (the workshop works on the whole reading)
  return {
    buffer,
    analysis: cached || (await requestAnalysis(t.id).catch(() => null)),
    song,
    lyrics: t.instrumental ? '' : lyr?.text || '',
    name: t.file,
  };
}
