// The library page: favourites and playlists (kept by the app), and songs, albums, artists and genres (from the files).
import { memo, useMemo, useState } from 'react';
import { tx } from '../../i18n';
import { Lib, type Track } from '../bridge';
import { ui, lib, useStore, useIndex, fmtTime, keep, remember, toast, openMenu, match, type MenuItem } from '../state';
import { player, playIds, enqueue, setMode, shufflePick, setInstrumental } from '../playback/player';
import { Icon } from '../ui/icons';
import { Button, IconButton, Cover, Mosaic, Empty, Badge, Dropdown, Turn } from '../ui/kit';
import { LiveEq } from '../ui/LiveEq';
import { QualityTag } from '../ui/quality';
import { useReorder } from '../ui/reorder';
import { askText, editMeta, exportTrack } from './Modals';
import { sendToWorkshop } from './workshop/Workshop';
import s from './Library.module.css';

export const SECTIONS: [string, string, string][] = [['favorites', 's.favorites', 'heart'], ['playlists', 's.playlists', 'lyrics'], ['songs', 's.songs', 'note'], ['albums', 's.albums', 'disc'], ['artists', 's.artists', 'user'], ['genres', 's.genres', 'tag']];

export function LibraryView() {
  const loaded = useStore(lib, x => x.loaded), folders = useStore(lib, x => x.folders), tracks = useStore(lib, x => x.tracks), favorites = useStore(lib, x => x.favorites), idx = useIndex();
  const section = useStore(ui, x => x.section) || (favorites.length ? 'favorites' : 'songs');
  const detail = useStore(ui, x => x.detail), search = useStore(ui, x => x.search).trim().toLowerCase();
  if (loaded && !folders.length && !tracks.length) return <EmptyLibrary />;
  return (
    <div className={s.libWrap}>
      <Turn k={detail ? detail.kind + ':' + detail.key : 'list'}>{detail ? <Detail idx={idx} search={search} /> : (
        <>
          <header className={s.head}>
            <span className="kicker">{tx('s.library')}</span>
            <h1 className="display">{tx(SECTIONS.find(x => x[0] === section)?.[1] || 's.library')}</h1>
          </header>
          <Turn k={section}>
            {section === 'favorites' && <Favorites idx={idx} search={search} />}
            {section === 'playlists' && <Playlists idx={idx} search={search} />}
            {section === 'songs' && <Songs tracks={tracks} search={search} />}
            {section === 'albums' && <CardGrid items={idx.albums.filter(a => match(search, a.name, a.artist))} kind="album" />}
            {section === 'artists' && <CardGrid items={idx.artists.filter(a => match(search, a.name))} kind="artist" />}
            {section === 'genres' && <CardGrid items={idx.genres.filter(a => match(search, a.name))} kind="genre" />}
          </Turn>
        </>
      )}</Turn>
    </div>
  );
}
function EmptyLibrary() {
  return <Empty title={tx('s.empty.lib')} help={tx('s.empty.libHelp')} icon="note">
    <Button kind="primary" icon="folder" onClick={() => Lib!.addFolder().then(v => lib.set(v))}>{tx('s.addFolder')}</Button></Empty>;
}

/* ---------- songs ---------- */
const SORTS: [string, string][] = [['added', 's.sort.added'], ['title', 's.sort.title'], ['artist', 's.sort.artist'], ['plays', 's.sort.plays']];
function Songs({ tracks, search }: { tracks: Track[]; search: string }) {
  const [sort, setSort] = useState(() => remember('sort', 'added'));
  const list = useMemo(() => {
    const f = tracks.filter(t => match(search, t.title, t.artist, t.album, (t.genre || []).join(' ')));
    const cmp = ({ added: (a: Track, b: Track) => b.added - a.added, title: (a: Track, b: Track) => a.title.localeCompare(b.title, undefined, { numeric: true }),
      artist: (a: Track, b: Track) => (a.artist || '￿').localeCompare(b.artist || '￿') || a.album.localeCompare(b.album), plays: (a: Track, b: Track) => b.plays - a.plays || b.last - a.last } as Record<string, (a: Track, b: Track) => number>)[sort];
    const byTitle = (a: Track, b: Track) => a.title.localeCompare(b.title, undefined, { numeric: true }) || a.id.localeCompare(b.id);   // ties never reshuffle the list
    return f.sort((a, b) => cmp(a, b) || byTitle(a, b));
  }, [tracks, search, sort]);
  return (
    <>
      <div className={s.tools}>
        <span className={s.count}>{tx('s.tracks', { n: list.length })}</span>
        <PlayButtons ids={list.map(t => t.id)} />
        <label className={s.sel}><span className="kicker">{tx('s.sort')}</span>
          <Dropdown label={tx('s.sort')} value={sort} onChange={v => { setSort(v); keep('sort', v); }} options={SORTS.map(([v, k]) => [v, tx(k)])} /></label>
      </div>
      {list.length ? <TrackList tracks={list} /> : <Empty title={tx('s.empty.results')} icon="search" />}
    </>
  );
}
function PlayButtons({ ids, album }: { ids: string[]; album?: boolean }) {
  const cur = useStore(player, x => x.id), here = !!cur && ids.includes(cur);
  return <>
    <Button kind="primary" size="sm" icon="play" disabled={!ids.length} onClick={() => playIds(ids, 0)}>{tx('s.playAll')}</Button>
    {album && ids.length > 1 && <Button size="sm" icon="disc" title={tx('s.albumPlayHelp')} onClick={() => playIds(ids, 0, { album: true })}>{tx('s.albumPlay')}</Button>}
    <Button size="sm" icon="shuffle" disabled={!ids.length} onClick={() => { setMode('shuffle'); playIds(ids, Math.max(0, shufflePick(ids, -1))); }}>{tx('s.shuffle')}</Button>
    {here && <IconButton n="locate" size="sm" label={tx('s.locate')} onClick={locatePlaying} />}
  </>;
}
/** Bring the playing song's row into view, centred, and light it up for a moment. */
export function locatePlaying() {
  const row = document.querySelector<HTMLElement>('[role="list"] [data-cur="true"]'); if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  row.dataset.flash = 'false'; void row.offsetWidth; row.dataset.flash = 'true'; row.focus({ preventScroll: true });
  setTimeout(() => { row.dataset.flash = 'false'; }, 1600);
}
export function trackMenu(e: React.MouseEvent, t: Track, list: Track[], extra?: MenuItem | null) {
  const fav = lib.get().favorites.includes(t.id), ids = list.map(x => x.id);
  openMenu(e, [
    !t.protected && { label: tx('s.play'), icon: 'play', run: () => playIds(ids, ids.indexOf(t.id)) },
    !t.protected && { label: tx('s.queue.add'), icon: 'queue', run: () => enqueue([t.id]) },
    { label: tx(fav ? 's.unfav' : 's.fav'), icon: 'heart', run: () => Lib!.favorite(t.id, !fav) },
    // (into a playlist: a submenu of them, and a new one)
    { label: tx('s.addToPl'), icon: 'plus', sub: [
      ...lib.get().playlists.map(p => ({ label: p.name, icon: 'lyrics', run: () => { Lib!.playlist('add', p.id, [t.id]); toast(tx('s.addedTo', { name: p.name })); } })),
      ...(lib.get().playlists.length ? ['-' as const] : []),
      { label: tx('s.newPlaylist') + '…', icon: 'plus', run: async () => { const n = await askText(tx('s.newPlaylist'), tx('s.plName'), tx('s.untitledPl')); if (n != null) Lib!.playlist('create', n || tx('s.untitledPl'), [t.id]); } }] },
    extra, '-',
    !t.protected && { label: tx('s.toWorkshop'), icon: 'workshop', run: () => sendToWorkshop(t) },
    !t.protected && { label: tx('s.exportMp4'), icon: 'film', run: () => exportTrack(t, list) },
    { label: tx('s.meta.menu'), icon: 'tag', run: () => editMeta(t) },
    !t.protected && { label: tx('s.reanalyze'), icon: 'refresh', run: () => { Lib!.reanalyze([t.id]); toast(tx('s.reanalyzed', { name: t.title })); } },
    !t.protected && { label: tx(t.instrumental ? 's.instr.off' : 's.instr.on'), icon: 'note', run: () => setInstrumental(t.id, !t.instrumental) },
  ]);
}
/** onReorder: the rows can be dragged into a new order (playlists). */
export const TrackList = memo(function TrackList({ tracks, numbered, menuExtra, onReorder }: { tracks: Track[]; numbered?: boolean; menuExtra?: (t: Track) => MenuItem; onReorder?: ((ids: string[]) => void) | null }) {
  const cur = useStore(player, x => x.id), playing = useStore(player, x => x.playing), favs = useStore(lib, x => x.favorites);
  const fav = useMemo(() => new Set(favs), [favs]);
  const { shown, down, listProps } = useReorder(tracks, onReorder && (list => onReorder(list.map(t => t.id))));
  const play = (t: Track) => { if (t.protected) { toast(tx('s.protectedHelp'), 4200); return; } const ids = shown.map(x => x.id); playIds(ids, ids.indexOf(t.id)); };
  return (
    <div className={s.tracks + ' stagger'} role="list" data-reorder={!!onReorder} {...listProps}>
      <div className={s.colHead} aria-hidden="true"><span /><span className={s.lead}>{numbered ? '#' : ''}</span><span>{tx('s.col.title')}</span><span className={s.album}>{tx('s.col.album')}</span><span className={s.badges}>{tx('s.col.format')}</span><span /><span /><span className={s.time}>{tx('s.col.time')}</span><span /></div>
      {shown.map((t, i) => { const on = fav.has(t.id), isCur = t.id === cur; return (
        <div key={t.id} role="listitem" className={s.row} data-cur={isCur} data-protected={t.protected} tabIndex={0} style={{ '--i': i } as React.CSSProperties}
          onPointerDown={e => down(e, i)} onDoubleClick={() => play(t)} onKeyDown={e => { if (e.key === 'Enter') play(t); }} onContextMenu={e => trackMenu(e, t, shown, menuExtra?.(t))}>
          <span className={s.grip} aria-hidden="true">{onReorder && <Icon n="grip" size={15} />}</span>
          <span className={s.lead}>
            {numbered ? <span className={s.num}>{t.track || i + 1}</span> : <Cover k={t.cover} />}
            {isCur && playing ? <span className={s.playOver} style={{ opacity: 1 }}><LiveEq /></span>
              : !t.protected && <button type="button" className={s.playOver} aria-label={tx('s.play')} onClick={() => play(t)}><Icon n="play" size={16} /></button>}
          </span>
          <span className={s.main}><b>{t.title}</b><small>{t.artist || tx('s.unknownArtist')}</small></span>
          <span className={s.album}>{t.album}</span>
          <span className={s.badges}>{t.protected ? <Badge k="warn"><Icon n="lock" size={11} />{tx('s.badge.protected')}</Badge> : <><QualityTag t={t} />{t.lrc || t.embedded ? <Badge>{tx('s.badge.lrc')}</Badge> : null}</>}</span>
          {t.protected ? <span /> : <IconButton n="plus" size="sm" label={tx('s.queue.add')} className={s.hide + ' ' + s.qadd} onClick={() => enqueue([t.id])} />}
          <IconButton n="heart" size="sm" filled={on} on={on} data-fav="" className={s.hide} label={tx(on ? 's.unfav' : 's.fav')} onClick={() => Lib!.favorite(t.id, !on)} />
          <span className={s.time}>{fmtTime(t.duration)}</span>
          <IconButton n="more" size="sm" className={s.hide} label={tx('s.more')} onClick={e => trackMenu(e, t, shown, menuExtra?.(t))} />
        </div>); })}
    </div>
  );
});

/* ---------- favourites and playlists ---------- */
type Idx = ReturnType<typeof useIndex>;
function Favorites({ idx, search }: { idx: Idx; search: string }) {
  const favs = useStore(lib, x => x.favorites);
  const list = favs.map(id => idx.byId.get(id)).filter((t): t is Track => !!t && match(search, t.title, t.artist, t.album));
  if (!favs.length) return <Empty title={tx('s.empty.fav')} help={tx('s.empty.favHelp')} icon="heart" />;
  return <><div className={s.tools}><span className={s.count}>{tx('s.tracks', { n: list.length })}</span><PlayButtons ids={list.map(t => t.id)} /></div><TrackList tracks={list} /></>;
}
function Playlists({ idx, search }: { idx: Idx; search: string }) {
  const pls = useStore(lib, x => x.playlists).filter(p => match(search, p.name));
  const create = async () => { const name = await askText(tx('s.newPlaylist'), tx('s.plName'), tx('s.untitledPl')); if (name != null) Lib!.playlist('create', name || tx('s.untitledPl'), []); };
  return (
    <div className={s.cards + ' stagger'}>
      <button type="button" className={s.card + ' ' + s.newCard} onClick={create}><span><Icon n="plus" size={30} /></span><b>{tx('s.newPlaylist')}</b></button>
      {pls.map((p, pi) => (
        <div key={p.id} className={s.cardWrap} style={{ '--i': pi } as React.CSSProperties}>
        <CardPlay ids={p.tracks} />
        <button type="button" className={s.card} onClick={() => ui.set({ detail: { kind: 'playlist', key: p.id } })} onContextMenu={e => openMenu(e, [
          { label: tx('s.play'), icon: 'play', run: () => playIds(p.tracks, 0) },
          { label: tx('s.rename'), icon: 'lyrics', run: async () => { const n = await askText(tx('s.rename'), tx('s.plName'), p.name); if (n) Lib!.playlist('rename', p.id, n); } },
          '-', { label: tx('s.delete'), icon: 'trash', danger: true, run: () => Lib!.playlist('delete', p.id) }])}>
          <Mosaic keys={p.tracks.map(id => idx.byId.get(id)?.cover || null)} />
          <b>{p.name}</b><small>{tx('s.tracks', { n: p.tracks.length })}</small>
        </button></div>
      ))}
    </div>
  );
}

/** The round play button a card shows over its cover on hover: the card's songs, from the first. */
function CardPlay({ ids }: { ids: string[] }) {
  return <button type="button" className={s.cardPlay} aria-label={tx('s.playAll')} title={tx('s.playAll')} disabled={!ids.length} onClick={() => playIds(ids, 0)}><Icon n="play" size={18} /></button>;
}
/* ---------- albums, artists, genres ---------- */
function CardGrid({ items, kind }: { items: Idx['albums']; kind: 'album' | 'artist' | 'genre' }) {
  if (!items.length) return <Empty title={tx('s.empty.results')} icon="search" />;
  return (
    <div className={s.cards + ' stagger'} data-kind={kind}>
      {items.map((g, gi) => (
        <div key={g.key || '-'} className={s.cardWrap} style={{ '--i': gi } as React.CSSProperties}>
        <CardPlay ids={g.tracks.map(t => t.id)} />
        <button type="button" className={s.card} onClick={() => ui.set({ detail: { kind, key: g.key } })}
          onContextMenu={e => openMenu(e, [{ label: tx('s.play'), icon: 'play', run: () => playIds(g.tracks.map(t => t.id), 0) }])}>
          {kind === 'genre' ? <Mosaic keys={g.tracks.map(t => t.cover)} /> : <Cover k={g.cover} round={kind === 'artist'} />}
          <b>{g.name || tx(kind === 'album' ? 's.unknownAlbum' : kind === 'artist' ? 's.unknownArtist' : 's.unknownGenre')}</b>
          <small>{kind === 'album' ? [g.artist, g.year].filter(Boolean).join(' · ') : tx('s.tracks', { n: g.tracks.length })}</small>
        </button></div>
      ))}
    </div>
  );
}
function Detail({ idx, search }: { idx: Idx; search: string }) {
  const detail = useStore(ui, x => x.detail)!, pls = useStore(lib, x => x.playlists);
  let title = '', sub = '', cover: string | null = null, round = false, tracks: Track[] = [], extra: ((t: Track) => MenuItem) | undefined, numbered = false, mosaic: (string | null)[] | null = null;
  if (detail.kind === 'playlist') { const p = pls.find(x => x.id === detail.key); if (!p) return null;
    title = p.name; tracks = p.tracks.map(id => idx.byId.get(id)).filter((t): t is Track => !!t); mosaic = tracks.map(t => t.cover);
    extra = t => ({ label: tx('s.removeFromPl'), icon: 'close', run: () => Lib!.playlist('remove', p.id, [t.id]) }); }
  else { const g = (detail.kind === 'album' ? idx.albums : detail.kind === 'artist' ? idx.artists : idx.genres).find(x => x.key === detail.key); if (!g) return null;
    title = g.name || tx(detail.kind === 'album' ? 's.unknownAlbum' : detail.kind === 'artist' ? 's.unknownArtist' : 's.unknownGenre');
    sub = detail.kind === 'album' ? [g.artist, g.year].filter(Boolean).join(' · ') : ''; cover = g.cover; round = detail.kind === 'artist'; tracks = g.tracks; numbered = detail.kind === 'album';
    if (detail.kind === 'genre') mosaic = g.tracks.map(t => t.cover); }
  const shown = tracks.filter(t => match(search, t.title, t.artist, t.album)), dur = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  return (
    <div className={s.detail}>
      <div className={s.back}><Button kind="ghost" size="sm" icon="chevronLeft" onClick={() => ui.set({ detail: null })}>{tx('s.back')}</Button></div>
      <header className={s.detailHead}>
        {mosaic ? <Mosaic keys={mosaic} /> : <Cover k={cover} full round={round} />}
        <div>
          <span className="kicker">{tx(({ album: 's.albums', artist: 's.artists', genre: 's.genres', playlist: 's.playlists' } as const)[detail.kind])}</span>
          <h1 className="display">{title}</h1>
          <p>{[sub, tx('s.tracks', { n: tracks.length }), fmtTime(dur)].filter(Boolean).join(' · ')}</p>
          <div className={s.ops}>
            <PlayButtons ids={tracks.map(t => t.id)} album={detail.kind === 'album'} />
            {detail.kind === 'playlist' && <>
              <Button kind="ghost" size="sm" onClick={async () => { const n = await askText(tx('s.rename'), tx('s.plName'), title); if (n) Lib!.playlist('rename', detail.key, n); }}>{tx('s.rename')}</Button>
              <Button kind="danger" size="sm" onClick={() => { Lib!.playlist('delete', detail.key); ui.set({ detail: null }); }}>{tx('s.delete')}</Button>
            </>}
          </div>
          {detail.kind === 'playlist' && tracks.length > 1 && <small className="muted">{tx('s.dragHint')}</small>}
        </div>
      </header>
      {shown.length ? <TrackList tracks={shown} numbered={numbered} menuExtra={extra} onReorder={detail.kind === 'playlist' && !search ? ids => Lib!.playlist('order', detail.key, ids) : null} />
        : <Empty title={tx(detail.kind === 'playlist' ? 's.empty.pl' : 's.empty.results')} icon="lyrics" />}
    </div>
  );
}
