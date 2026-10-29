/* Song titles. Every song gets an opening title, whichever way it starts playing (from the library, the queue, a skip,
   in any view), because it is part of the plan: with an intro long enough, a title card like the ending's, shown before
   the first words; with a short intro, a small title at the top that never covers the lyrics. */
import type { Titles } from './types';
import type { RhythmMap } from '../rhythm/map';

export interface SongInfo { on: boolean; title: string; artist?: string; composer?: string; lyricist?: string; /** played as part of an album: only the small title at the top, and no ending card (nothing that lengthens the song) */ album?: boolean }
/** A card needs this long before the first words (and at least two bars). */
export const INTRO_CARD_MIN = 6;

export function planTitles(song: SongInfo, firstLine: number | null, map: RhythmMap, musicEnd: number, labels: { composer: string; lyricist: string; artist: string }): Titles {
  const title = (song.title || '').trim(), artist = (song.artist || '').trim();
  const credits = ([[labels.composer, song.composer], [labels.lyricist, song.lyricist], [labels.artist, song.artist]] as [string, string | undefined][])
    .filter(x => x[1] && x[1]!.trim()).map(x => [x[0], x[1]!.trim()] as [string, string]);
  const has = song.on && !!title;
  let intro: Titles['intro'] = null;
  if (has) {
    const first = firstLine ?? musicEnd, need = Math.max(INTRO_CARD_MIN, 2 * map.meter * map.beatLen(0));
    if (first >= need && !song.album) intro = { kind: 'card', t0: 0.35, t1: Math.min(first - 1.0, 0.35 + 7) };
    else intro = { kind: 'top', t0: 0.15, t1: Math.max(3.2, Math.min(first + 2.5, 5)) };
  }
  return { intro, end: song.on && !song.album && (title || credits.length) ? { t0: musicEnd + 0.45 } : null, title, artist, credits };
}
