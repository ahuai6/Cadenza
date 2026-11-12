// The library's commands: what can be done with a song, with several songs, with a playlist.
import { tx } from '../../i18n';
import { Lib } from '../bridge';
import { lib, toast } from '../state';
import { enqueue, forgetPrepared, playIds, setInstrumental } from '../playback/player';
import { define } from './registry';

const isFav = (id: string) => lib.get().favorites.includes(id);

/** Add songs to a playlist, or to a new one of that name; says so. (Shared by the menu and by any form that asks.) */
export async function addToPlaylist(ids: string[], into: { id: string; name: string } | { create: string }) {
  if ('create' in into) {
    const name = into.create.trim() || tx('s.untitledPl');
    await Lib?.playlist('create', name, ids);
    toast(tx('s.addedTo', { name }));
  } else {
    await Lib?.playlist('add', into.id, ids);
    toast(tx('s.addedTo', { name: into.name }));
  }
}
export const renamePlaylist = (id: string, name: string) =>
  name.trim() ? Lib?.playlist('rename', id, name.trim()) : null;

/* ---------- one song ---------- */
define({
  id: 'track.play',
  on: 'track',
  section: 'play',
  icon: 'play',
  label: () => tx('s.play'),
  when: (t) => !t.track.protected,
  // (the songs it is listed with play on after it)
  run: (t) => {
    const ids = t.list.map((x) => x.id);
    return playIds(ids, ids.indexOf(t.track.id));
  },
});
define({
  id: 'track.enqueue',
  on: 'track',
  section: 'play',
  icon: 'queue',
  label: () => tx('s.queue.add'),
  when: (t) => !t.track.protected,
  run: (t) => enqueue([t.track.id]),
});
define({
  id: 'track.favorite',
  on: 'track',
  section: 'collect',
  icon: 'heart',
  label: (t) => tx(isFav(t.track.id) ? 's.unfav' : 's.fav'),
  run: (t) => Lib?.favorite(t.track.id, !isFav(t.track.id)),
});
define({
  id: 'track.addToPlaylist',
  on: 'track',
  section: 'collect',
  icon: 'plus',
  label: () => tx('s.addToPl'),
  // (a menu of the playlists there are, and a new one — which needs the interface to ask its name)
  when: (_t, h) => !!h.ask,
  sub: (t, h) => {
    const pls = lib.get().playlists;
    return [
      ...pls.map((p) => ({ label: p.name, icon: 'lyrics', run: () => void addToPlaylist([t.track.id], p) })),
      ...(pls.length ? ['-' as const] : []),
      {
        label: tx('s.newPlaylist') + '…',
        icon: 'plus',
        run: async () => {
          const n = await h.ask!(tx('s.newPlaylist'), tx('s.plName'), tx('s.untitledPl'));
          if (n != null) addToPlaylist([t.track.id], { create: n });
        },
      },
    ];
  },
});
define({
  id: 'track.removeFromPlaylist',
  on: 'track',
  section: 'collect',
  icon: 'close',
  label: () => tx('s.removeFromPl'),
  when: (t) => !!t.playlist,
  // (the favourites are a list too: taken out of it, a song is no longer a favourite)
  run: (t) =>
    t.playlist === 'favorites' ? Lib?.favorite(t.track.id, false) : Lib?.playlist('remove', t.playlist!, [t.track.id]),
});
define({
  id: 'track.toWorkshop',
  on: 'track',
  section: 'make',
  icon: 'workshop',
  label: () => tx('s.toWorkshop'),
  when: (t, h) => !t.track.protected && !!h.toWorkshop,
  run: (t, h) => h.toWorkshop!(t.track),
});
define({
  id: 'track.exportVideo',
  on: 'track',
  section: 'make',
  icon: 'film',
  label: () => tx('s.exportMp4'),
  when: (t, h) => !t.track.protected && !!h.exportVideo,
  run: (t, h) => h.exportVideo!(t.track, t.list),
});
define({
  id: 'track.editTags',
  on: 'track',
  section: 'make',
  icon: 'tag',
  label: () => tx('s.meta.menu'),
  when: (_t, h) => !!h.editTags,
  run: (t, h) => h.editTags!(t.track),
});
define({
  id: 'track.reanalyze',
  on: 'track',
  section: 'make',
  icon: 'refresh',
  label: () => tx('s.reanalyze'),
  when: (t) => !t.track.protected,
  run: (t) => {
    forgetPrepared(t.track.id);
    Lib?.reanalyze([t.track.id]);
    toast(tx('s.reanalyzed', { name: t.track.title }));
  },
});
define({
  id: 'track.instrumental',
  on: 'track',
  section: 'make',
  icon: 'note',
  label: (t) => tx(t.track.instrumental ? 's.instr.off' : 's.instr.on'),
  when: (t) => !t.track.protected,
  run: (t) => setInstrumental(t.track.id, !t.track.instrumental),
});

/* ---------- several songs as one: an album, an artist, a genre ---------- */
define({
  id: 'tracks.play',
  on: 'tracks',
  section: 'play',
  icon: 'play',
  label: () => tx('s.playAll'),
  when: (t) => t.ids.length > 0,
  run: (t) => playIds(t.ids, 0),
});
define({
  id: 'tracks.enqueue',
  on: 'tracks',
  section: 'play',
  icon: 'queue',
  label: () => tx('s.queue.add'),
  when: (t) => t.ids.length > 0,
  run: (t) => {
    enqueue(t.ids);
    toast(tx('s.queue.addedN', { n: t.ids.length }));
  },
});

/* ---------- a playlist ---------- */
define({
  id: 'playlist.play',
  on: 'playlist',
  section: 'play',
  icon: 'play',
  label: () => tx('s.playAll'),
  when: (t) => t.ids.length > 0,
  run: (t) => playIds(t.ids, 0),
});
define({
  id: 'playlist.enqueue',
  on: 'playlist',
  section: 'play',
  icon: 'queue',
  label: () => tx('s.queue.add'),
  when: (t) => t.ids.length > 0,
  run: (t) => {
    enqueue(t.ids);
    toast(tx('s.queue.addedN', { n: t.ids.length }));
  },
});
define({
  id: 'playlist.rename',
  on: 'playlist',
  section: 'collect',
  icon: 'lyrics',
  label: () => tx('s.rename'),
  // (the favourites are not a playlist of the user's making: neither renamed nor deleted)
  when: (t, h) => t.id !== 'favorites' && !!h.ask,
  run: async (t, h) => {
    const n = await h.ask!(tx('s.rename'), tx('s.plName'), t.name);
    if (n) renamePlaylist(t.id, n);
  },
});
define({
  id: 'playlist.delete',
  on: 'playlist',
  section: 'remove',
  icon: 'trash',
  danger: true,
  label: () => tx('s.delete'),
  when: (t) => t.id !== 'favorites',
  run: (t) => Lib?.playlist('delete', t.id),
});
