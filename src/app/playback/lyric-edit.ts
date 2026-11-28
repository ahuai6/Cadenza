// The shown song's lyrics changed by the listener: written to the song's own lyric file or into the audio file (that
// one through player.ts, which releases the song's output first), previewed without writing, or switched to another of
// the song's lyric sources. The scene takes the new lines at once.
import { isTtml } from '../../engine';
import { tx } from '../../i18n';
import { Lib, type LyricMutation } from '../bridge';
import { settings, toast } from '../state';
import { canEdit, editTask } from '../editing';
import { engine } from './stage';
import { player, projection } from './projection';
import { writeIntoFile } from './player';

/** Persist the supplied source. Edits of TTML remain XML, including lines and tracks not rendered by the player. */
export const useLyrics = (text: string, options: { edit?: boolean } = {}) =>
  canEdit() ? editTask(() => applyLyricsEdit(text, options)) : Promise.resolve(false);

async function applyLyricsEdit(text: string, o: { edit?: boolean }) {
  const ttml = isTtml(text);
  if (ttml || (o.edit && isTtml(player.get().session?.spec.lyrics || ''))) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (!ttml || xml.querySelector('parsererror')) {
      toast(tx('s.lyr.tagFail', { why: 'TTML XML' }));
      return false;
    }
  }
  const { shownId: id, session } = player.get();
  if (!id || !session || !Lib) return false;
  const tag = settings.get().lyricsTarget === 'tag';
  const result = await (tag
    ? writeIntoFile(id, () => Lib!.writeLyrics(id, text, 'tag'))
    : Lib.writeLyrics(id, text, ttml ? 'ttml' : 'lrc').catch(() => ({ ok: false as const, target: undefined })));
  if (!result.ok) return false;
  return refreshLyrics(id, {
    source: ttml ? 'ttml' : result.target === 'tag' ? 'embedded' : 'lrc',
    text,
  });
}
async function refreshLyrics(id: string, lyrics: Awaited<ReturnType<NonNullable<typeof Lib>['lyrics']>>) {
  const { shownId, session } = player.get();
  if (shownId !== id || !session) return true;
  session.setLyrics(lyrics?.text || '');
  await session.flush();
  if (player.get().session === session) {
    engine.invalidate();
    projection.set({ hasLyrics: session.hasLyrics, lyrics, rev: player.get().rev + 1 });
  }
  return true;
}

export function previewLyrics(id: string, text: string) {
  if (player.get().shownId !== id) return Promise.resolve(false);
  return refreshLyrics(id, { source: isTtml(text) ? 'ttml' : 'lrc', text });
}
export async function resetLyricPreview(id: string) {
  if (!Lib || player.get().shownId !== id) return false;
  return refreshLyrics(id, await Lib.lyrics(id));
}
export async function switchLyricSource(id: string, source: string) {
  if (!Lib || !(await Lib.selectLyrics(id, source))) return false;
  return refreshLyrics(id, await Lib.lyrics(id));
}
export async function commitLyricField(id: string, request: LyricMutation) {
  if (!Lib || !canEdit()) return { ok: false, why: 'editing-disabled' };
  return editTask(async () => {
    const write = () => Lib!.mutateLyrics(id, request);
    const result = await (request.source.startsWith('sidecar:') ? write() : writeIntoFile(id, write));
    if (result.ok) await refreshLyrics(id, await Lib!.lyrics(id));
    return result;
  });
}
