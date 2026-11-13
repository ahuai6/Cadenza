// What the space points at, as the commands take it (commands/registry.ts): an album as its songs, a playlist (the
// favourites among them), one song among its album's songs.
import { tx } from '../../i18n';
import { lib, indexOf } from '../state';
import type { Target } from '../commands';

export function targetOf(d: { kind: 'album' | 'playlist' | 'song'; key: string }): Target | null {
  const { tracks, favorites, playlists } = lib.get(),
    idx = indexOf(tracks, favorites);
  if (d.kind === 'album') {
    const a = idx.albums.find((g) => g.key === d.key);
    return a ? { kind: 'tracks', ids: a.tracks.map((t) => t.id) } : null;
  }
  if (d.kind === 'playlist') {
    if (d.key === 'favorites') return { kind: 'playlist', id: 'favorites', name: tx('s.favorites'), ids: favorites };
    const p = playlists.find((x) => x.id === d.key);
    return p ? { kind: 'playlist', id: p.id, name: p.name, ids: p.tracks } : null;
  }
  const t = idx.byId.get(d.key);
  if (!t) return null;
  const album = idx.albums.find((g) => g.tracks.some((x) => x.id === t.id));
  return { kind: 'track', track: t, list: album ? album.tracks : [t] };
}
