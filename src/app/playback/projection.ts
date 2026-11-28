// What the interface reads about playback: the selected song, its optional visual scene, the queue, the play mode, the
// volume, the MV. One store, written by the playback modules (player.ts for the transport and the queue, visual.ts for
// the scene, song-data.ts and mv.ts for what is bound to the song), read everywhere through `player`.
import { createStore } from '../../core/emitter';
import type { Session } from '../../engine';
import type { Style } from '../../theme/style';
import type { SongData } from '../bridge';
import { keep, remember } from '../state';
import type { Mode, Phase } from './coordinator';

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
export const NO_MV: MvState = { bound: false, name: '', offset: 0, on: false, ready: false };
export const projection = createStore({
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
  mv: NO_MV,
  mode: startMode(),
  error: null as string | null,
  volume: remember('vol', 1),
  /** album play: the queue is one album, played through in order as one continuous film in the first song's look */
  album: null as null | { look: Partial<Style> | null },
  /** which way the last change of song went (1 on to the next, −1 back, 0 a jump), for the pages' own transitions */
  dir: 0 as -1 | 0 | 1,
});
export const player = { get: projection.get, subscribe: projection.subscribe };
/** The shown scene changed in place: views that draw from it read it again. */
export const bumpScene = () => projection.set({ rev: projection.get().rev + 1 });
