// The small window on top (both appearances): nothing but the song's lyrics on a slow liquid of its cover's colours, a
// line to say what is playing, play / pause, and the way back to the full window. The window is dragged by its edges and
// its bottom line; the lyrics stay clickable (a line plays from itself).
import { tx } from '../../i18n';
import { D } from '../bridge';
import { useStore, trackOf, lib } from '../state';
import { Icon } from './icons';
import { NpLyrics } from './NpLyrics';
import { player, toggle } from '../playback/player';
import s from './MiniLyrics.module.css';

const HOUSE = { base: [78, 60, 50], cols: [[196, 96, 63], [140, 154, 98], [139, 162, 189], [201, 154, 110]] };
const rgb = (c: number[] | undefined, a = 1) => c ? `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})` : `rgba(90,70,60,${a})`;

export function MiniLyrics() {
  const session = useStore(player, x => x.session), hasLyrics = useStore(player, x => x.hasLyrics), playing = useStore(player, x => x.playing), id = useStore(player, x => x.shownId || x.id);
  useStore(lib, x => x.tracks);
  // (before the song's own colours are known: the house's warm tones, so the liquid is never a flat fill)
  const t = trackOf(id), amb = session?.ambient || HOUSE, cols = [amb.base, ...amb.cols];
  const pick = (k: number) => cols.length ? cols[k % cols.length] : undefined;
  return (
    <div className={s.mini} data-test="mini" style={{ background: rgb(amb?.base) }}>
      {/* the liquid: four soft blobs of the cover's colours, drifting on their own slow paths */}
      <div className={s.liquid} aria-hidden="true">{[0, 1, 2, 3].map(k => <i key={k} style={{ background: `radial-gradient(circle at 50% 50%, ${rgb(pick(k + 1), .95)}, ${rgb(pick(k + 1), 0)} 68%)` }} />)}</div>
      <div className={s.grab} aria-hidden="true" />
      <button type="button" className={s.back} onClick={() => D?.win('mini')} title={tx('s.unmini')} aria-label={tx('s.unmini')}><Icon n="pip" size={16} /></button>
      <div className={s.lyr}>{hasLyrics && session ? <NpLyrics key={session.version + ':' + id} lines={session.doc.lines} live compact /> : <p className={s.none}>{t?.title || ''}</p>}</div>
      <footer className={s.bar}>
        <button type="button" className={s.pp} onClick={() => toggle()} aria-label={tx(playing ? 'pause' : 'play')}><Icon n={playing ? 'pause' : 'play'} size={16} /></button>
        <span className={s.t}><b>{t?.title || ''}</b><small>{t?.artist || ''}</small></span>
      </footer>
    </div>);
}
