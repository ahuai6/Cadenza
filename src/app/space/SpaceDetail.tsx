// What you click in the space opens here, where you stand (the view never moves for it): an album or a playlist opened
// out into its songs, or one song; with everything the classic library offers for them — play from any song, add to
// the queue, favourites, playlists made, renamed, deleted, songs added and taken out.
import { useEffect, useMemo, useState } from 'react';
import { tx } from '../../i18n';
import { Lib, type Track } from '../bridge';
import { lib, useStore, useIndex, fmtTime } from '../state';
import { Icon } from '../ui/icons';
import { Cover } from '../ui/kit';
import { player, playIds } from '../playback/player';
import { addToPlaylist, renamePlaylist, run, type Target } from '../commands';
import { ts } from './i18n';
import s from './SpacePanels.module.css';

export type Detail = { kind: 'album' | 'playlist' | 'song'; key: string } | null;

export function SpaceDetail({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const idx = useIndex(),
    playlists = useStore(lib, (x) => x.playlists),
    favs = useStore(lib, (x) => x.favorites),
    curId = useStore(player, (x) => x.id);
  const [rename, setRename] = useState<string | null>(null),
    [adding, setAdding] = useState<string[] | null>(null);
  useEffect(() => {
    setRename(null);
    setAdding(null);
  }, [detail?.kind, detail?.key]);
  useEffect(() => {
    if (!detail) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (adding) setAdding(null);
        else onClose();
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [detail, onClose, adding]);
  const view = useMemo(() => {
    if (!detail) return null;
    if (detail.kind === 'album') {
      const a = idx.albums.find((g) => g.key === detail.key);
      if (!a) return null;
      return {
        eye: ts('kind.album'),
        title: a.name,
        meta: [a.artist, a.year].filter(Boolean).join(' · '),
        cover: a.cover,
        tracks: a.tracks,
        list: null as null | { id: string; fav: boolean },
      };
    }
    if (detail.kind === 'playlist') {
      const fav = detail.key === 'favorites',
        p = fav ? null : playlists.find((x) => x.id === detail.key);
      if (!fav && !p) return null;
      const ids = fav ? favs : p!.tracks,
        tracks = ids.map((id) => idx.byId.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof idx.byId.get>>[];
      return {
        eye: ts('kind.list'),
        title: fav ? tx('s.favorites') : p!.name,
        meta: tx('s.tracks', { n: tracks.length }),
        cover: tracks[0]?.cover ?? null,
        tracks,
        list: { id: detail.key, fav },
      };
    }
    const t = idx.byId.get(detail.key);
    if (!t) return null;
    return {
      eye: ts('kind.song'),
      title: t.title,
      meta: [t.artist, t.album && `《${t.album}》`].filter(Boolean).join(' · '),
      cover: t.cover,
      tracks: [t],
      list: null,
    };
  }, [detail, idx, playlists, favs]);
  if (!detail || !view) return null;
  const ids = view.tracks.map((t) => t.id),
    one = detail.kind === 'song';
  const fav = (id: string) => idx.fav.has(id),
    setFav = (id: string, on: boolean) => Lib?.favorite(id, on);
  // (a song of this card, as the commands take it)
  const song = (t: Track): Target => ({ kind: 'track', track: t, list: view.tracks, playlist: view.list?.id });
  const play = (i: number) => {
    playIds(ids, i).catch(() => {});
  };
  return (
    <section className={`hud card ${s.panel} ${s.detail}`} aria-label={view.title} data-test="space-detail">
      <header className={s.dhead}>
        <span className={s.dcover}>
          <Cover k={view.cover} />
        </span>
        <div>
          <small className={s.eye}>{view.eye}</small>
          {rename != null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (view.list) renamePlaylist(view.list.id, rename);
                setRename(null);
              }}
            >
              <input
                className={s.input}
                autoFocus
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                aria-label={tx('s.plName')}
                onBlur={() => setRename(null)}
              />
            </form>
          ) : (
            <b className={s.dtitle}>{view.title}</b>
          )}
          <small>{view.meta}</small>
        </div>
        <button type="button" className={s.x} onClick={onClose} aria-label={ts('close')}>
          ✕
        </button>
      </header>
      <div className={s.actions}>
        <button type="button" className={s.solid} disabled={!ids.length} onClick={() => play(0)}>
          <Icon n="play" size={15} />
          {one ? tx('s.play') : tx('s.playAll')}
        </button>
        <button
          type="button"
          className={s.ghost}
          disabled={!ids.length}
          onClick={() => run('tracks.enqueue', { kind: 'tracks', ids })}
        >
          <Icon n="queue" size={15} />
          {tx('s.queue.add')}
        </button>
        {one && (
          <button
            type="button"
            className={s.ghost}
            aria-pressed={fav(ids[0])}
            onClick={() => setFav(ids[0], !fav(ids[0]))}
          >
            <Icon n="heart" size={15} />
            {tx(fav(ids[0]) ? 's.unfav' : 's.fav')}
          </button>
        )}
        {one && (
          <button type="button" className={s.ghost} onClick={() => setAdding(ids)}>
            <Icon n="plus" size={15} />
            {tx('s.addToPl')}
          </button>
        )}
        {!one && (
          <button type="button" className={s.ghost} disabled={!ids.length} onClick={() => setAdding(ids)}>
            <Icon n="plus" size={15} />
            {tx('s.addToPl')}
          </button>
        )}
        {view.list && !view.list.fav && (
          <>
            <button type="button" className={s.ghost} onClick={() => setRename(view.title)}>
              {tx('s.rename')}
            </button>
            <button
              type="button"
              className={s.ghost + ' ' + s.danger}
              onClick={() => {
                run('playlist.delete', { kind: 'playlist', id: view.list!.id, name: view.title, ids });
                onClose();
              }}
            >
              <Icon n="trash" size={15} />
              {tx('s.delete')}
            </button>
          </>
        )}
      </div>
      {adding && <AddTo ids={adding} onDone={() => setAdding(null)} />}
      {!one && (
        <ol className={s.list}>
          {view.tracks.map((t, i) => (
            <li key={t.id + ':' + i} data-cur={t.id === curId}>
              <button type="button" className={s.row} onClick={() => play(i)} title={tx('s.play')}>
                <span className={s.num}>{t.id === curId ? <Icon n="play" size={12} /> : i + 1}</span>
                <span className={s.text}>
                  <b>{t.title}</b>
                  <small>{t.artist}</small>
                </span>
                <span className={s.dur}>{fmtTime(t.duration)}</span>
              </button>
              <button
                type="button"
                className={s.rm}
                aria-pressed={fav(t.id)}
                data-on={fav(t.id)}
                onClick={() => setFav(t.id, !fav(t.id))}
                aria-label={tx(fav(t.id) ? 's.unfav' : 's.fav')}
                title={tx(fav(t.id) ? 's.unfav' : 's.fav')}
              >
                <Icon n="heart" size={14} />
              </button>
              <button
                type="button"
                className={s.rm}
                onClick={() => setAdding([t.id])}
                aria-label={tx('s.addToPl')}
                title={tx('s.addToPl')}
              >
                <Icon n="plus" size={14} />
              </button>
              {view.list && (
                <button
                  type="button"
                  className={s.rm}
                  onClick={() => run('track.removeFromPlaylist', song(t))}
                  aria-label={tx('s.removeFromPl')}
                  title={tx('s.removeFromPl')}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Into which playlist: the ones there are, or a new one named here. */
function AddTo({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const playlists = useStore(lib, (x) => x.playlists),
    [name, setName] = useState('');
  const add = async (id: string, nm: string) => {
    await addToPlaylist(ids, { id, name: nm });
    onDone();
  };
  const create = async () => {
    await addToPlaylist(ids, { create: name });
    onDone();
  };
  return (
    <div className={s.addTo} role="dialog" aria-label={tx('s.addToPl')}>
      <form
        className={s.newRow}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          className={s.input}
          autoFocus
          placeholder={tx('s.newPlaylist')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={tx('s.plName')}
        />
        <button type="submit" className={s.solid}>
          <Icon n="plus" size={14} />
          {tx('s.newPlaylist')}
        </button>
        <button type="button" className={s.x} onClick={onDone} aria-label={ts('close')}>
          ✕
        </button>
      </form>
      <ul>
        {playlists.map((p) => (
          <li key={p.id}>
            <button type="button" className={s.row} onClick={() => add(p.id, p.name)}>
              <Icon n="lyrics" size={14} />
              <span className={s.text}>
                <b>{p.name}</b>
                <small>{tx('s.tracks', { n: p.tracks.length })}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
