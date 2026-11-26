const { OnlineError } = require('./online.cjs');

function registerKugou(service, { getJson, boundedText, catalogId, publicUrl }) {
  const cover = (url) =>
    publicUrl(
      String(url || '')
        .replace(/^http:/, 'https:')
        .replaceAll('{size}', '150'),
      ['kugou.com'],
    );
  const ref = (namespace, id) => ({ provider: 'kugou', namespace, id, access: { kind: 'public' }, availability: {} });
  const row = (item) => {
    const id = catalogId(item.FileHash || item.hash);
    const title = boundedText(item.SongName || item.songname);
    if (!/^[a-f\d]{32}$/i.test(id) || !title) return [];
    return [
      {
        ref: ref('songs', id),
        title,
        artist: boundedText(item.SingerName || item.h5_author_name || item.singername),
        album: boundedText(item.AlbumName),
        duration: Number.isFinite(item.Duration) ? item.Duration : undefined,
        image: cover(item.AlbumImage || item.album_sizable_cover),
        preview: false,
      },
    ];
  };
  const mobile = (route, signal, page = 1) =>
    getJson('https://m.kugou.com' + route + '?json=true&page=' + page, { signal });
  function result(list, map, more = false) {
    if (!Array.isArray(list)) throw new OnlineError('invalid-response');
    return { rows: list.flatMap(map), more };
  }
  service.register(
    {
      id: 'kugou',
      name: 'KuGou',
      label: 'hall.kugou',
      capabilities: {
        search: 'public',
        charts: 'public',
        collection: 'public',
        recommendations: 'public',
        open: 'public',
      },
    },
    {
      async search({ query, offset }, { signal }) {
        const url = new URL('https://songsearch.kugou.com/song_search_v2');
        url.search = new URLSearchParams({ keyword: query, page: String(1 + Math.floor(offset / 25)), pagesize: '25' });
        const data = await getJson(url, { signal });
        if (+data.status !== 1) throw new OnlineError('invalid-response');
        return result(data.data?.lists, row, offset + 25 < Number(data.data?.total));
      },
      async charts(_, { signal }) {
        const { rank } = await mobile('/rank/list', signal);
        return result(rank?.list, (item) => {
          const id = catalogId(item.rankid);
          return /^\d+$/.test(id) && item.rankname
            ? [
                {
                  ref: ref('charts', id),
                  title: boundedText(item.rankname),
                  image: cover(item.imgurl),
                  artist: '',
                  album: '',
                  preview: false,
                },
              ]
            : [];
        });
      },
      async recommendations(_, { signal }) {
        const { plist } = await mobile('/plist/index', signal);
        return result(plist?.list?.info, (item) => {
          const id = catalogId(item.specialid);
          return /^\d+$/.test(id) && item.specialname
            ? [
                {
                  ref: ref('playlists', id),
                  title: boundedText(item.specialname),
                  image: cover(item.imgurl),
                  artist: boundedText(item.username),
                  album: '',
                  preview: false,
                  collection: false,
                },
              ]
            : [];
        });
      },
      async collection({ id, namespace, offset }, { signal }) {
        if (!/^\d+$/.test(id)) throw new OnlineError('invalid');
        const first = Math.floor(offset / 30) + 1;
        if (namespace !== 'charts') throw new OnlineError('unavailable');
        const route = '/rank/info/' + id;
        const { songs } = await mobile(route, signal, first);
        if (!Array.isArray(songs?.list) || +songs.pagesize !== 30 || +songs.page !== first)
          throw new OnlineError('invalid-response');
        const start = offset % 30;
        const rows = songs.list.slice(start, start + 25);
        if (rows.length < 25 && first * 30 < Number(songs.total)) {
          const next = (await mobile(route, signal, first + 1)).songs;
          if (!Array.isArray(next?.list) || +next.page !== first + 1) throw new OnlineError('invalid-response');
          rows.push(...next.list.slice(0, 25 - rows.length));
        }
        return result(rows, row, offset + 25 < Number(songs.total));
      },
      async open({ id, namespace }) {
        if (!/^\d+$/.test(id)) throw new OnlineError('invalid');
        if (namespace === 'charts') return { url: 'https://m.kugou.com/rank/info/' + id };
        if (namespace === 'playlists') return { url: 'https://www.kugou.com/yy/special/single/' + id + '.html' };
        throw new OnlineError('unavailable');
      },
    },
  );
}

module.exports = { registerKugou };
