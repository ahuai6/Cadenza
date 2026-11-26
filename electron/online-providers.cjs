const { OnlineError } = require('./online.cjs');

const boundedText = (x, limit = 200) => (typeof x === 'string' ? x.slice(0, limit) : '');
const storefront = (x) => (/^[a-z]{2}$/.test(x || '') ? x : 'us');
const catalogId = (value) =>
  (typeof value === 'string' || Number.isSafeInteger(value)) && /^[A-Za-z0-9._-]{1,96}$/.test(String(value))
    ? String(value)
    : '';
const allowed = (host, domains) => domains.some((domain) => host === domain || host.endsWith('.' + domain));

function publicUrl(value, domains, keepQuery = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed(url.hostname, domains))
      return '';
    if (!keepQuery) url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

async function request(url, { signal, headers, method, body, bytes = 5 * 1024 * 1024 } = {}) {
  const deadline = AbortSignal.timeout(12000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let reply;
  try {
    reply = await fetch(url, { signal: combined, headers, method, body, redirect: 'error' });
    if (!reply.ok) {
      await reply.body?.cancel();
      throw new OnlineError(
        { 401: 'expired', 403: 'restricted', 404: 'not-found', 429: 'rate-limit' }[reply.status] || 'provider-failed',
      );
    }
    const reader = reply.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.length;
        if (size > bytes) throw new OnlineError('invalid-response');
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return {
      content: Buffer.concat(chunks, size),
      type: (reply.headers.get('content-type') || '').split(';')[0],
      cookies: reply.headers.getSetCookie(),
    };
  } catch (error) {
    if (error instanceof OnlineError) throw error;
    if (signal?.aborted) throw new OnlineError('cancelled');
    throw new OnlineError(deadline.aborted ? 'timeout' : 'provider-failed');
  }
}

async function getJson(url, options) {
  const result = await request(url, options);
  try {
    return JSON.parse(result.content.toString('utf8'));
  } catch {
    throw new OnlineError('invalid-response');
  }
}
function appleStyle(provider, base, headers = {}) {
  const get = (resource, params, signal) => {
    const url = new URL(resource, base);
    url.search = new URLSearchParams(params).toString();
    return getJson(url, { signal, headers });
  };
  function row(item, country) {
    const a = item?.attributes;
    const id = catalogId(item?.id);
    if (!a?.name || !id || !['songs', 'albums', 'playlists'].includes(item.type)) return null;
    const image = publicUrl(
      a.artwork?.url?.replaceAll('{w}', '160').replaceAll('{h}', '160').replaceAll('{f}', 'jpg'),
      ['mzstatic.com'],
    );
    return {
      ref: { provider, namespace: item.type, id, access: { kind: 'public' }, availability: { storefront: country } },
      title: boundedText(a.name),
      artist: boundedText(a.artistName || a.curatorName),
      album: boundedText(a.albumName),
      duration: Number.isFinite(a.durationInMillis) ? a.durationInMillis / 1000 : undefined,
      preview: !!publicUrl(a.previews?.[0]?.url, ['mzstatic.com', 'itunes.apple.com'], true),
      image,
    };
  }
  function page(items, country, next) {
    if (!Array.isArray(items)) throw new OnlineError('invalid-response');
    return {
      rows: items
        .slice(0, 120)
        .map((item) => row(item, country))
        .filter(Boolean),
      more: !!next,
    };
  }
  const tracks = 'songs';
  const operations = {
    async search({ query, offset, region }, { signal }) {
      const country = storefront(region);
      const data = await get(
        '/v1/catalog/' + country + '/search',
        { term: query, types: tracks, limit: 25, offset },
        signal,
      );
      if (!data.results) throw new OnlineError('invalid-response');
      return page(data.results.songs?.data || [], country, data.results.songs?.next);
    },
    async charts({ region }, { signal }) {
      const country = storefront(region);
      const data = await get('/v1/catalog/' + country + '/charts', { types: tracks, limit: 25 }, signal);
      return page(data.results?.songs?.[0]?.data, country);
    },
    async collection({ id, namespace, offset, region }, { signal }) {
      if (!['albums', 'playlists'].includes(namespace)) throw new OnlineError('invalid');
      const country = storefront(region);
      const data = await get(`/v1/catalog/${country}/${namespace}/${id}/tracks`, { limit: 25, offset }, signal);
      return page(data.data, country, data.next);
    },
    async preview({ id, region }, { signal }) {
      const country = storefront(region);
      const data = await get(`/v1/catalog/${country}/songs/${id}`, {}, signal);
      const link = publicUrl(
        data.data?.[0]?.attributes?.previews?.[0]?.url,
        ['mzstatic.com', 'itunes.apple.com'],
        true,
      );
      if (!link) throw new OnlineError('not-found');
      return {
        url: link,
        expiresAt: Date.now() + 120000,
        permission: 'stream',
        title: boundedText(data.data?.[0]?.attributes?.name),
      };
    },
    async open({ id, namespace, region }) {
      const family = { albums: 'album', playlists: 'playlist', songs: 'song' }[namespace];
      if (!family) throw new OnlineError('invalid');
      return { url: 'https://music.apple.com/' + storefront(region) + '/' + family + '/' + id };
    },
  };
  return { operations, get, page };
}

function registerPublicProviders(service, developerToken) {
  const flow = appleStyle('lyricsflow', 'https://api.trylyricsflow.com');
  service.register(
    {
      id: 'lyricsflow',
      name: 'LyricsFlow',
      capabilities: {
        search: 'public',
        charts: 'public',
        recommendations: 'public',
        collection: 'public',
        preview: 'public',
        lyrics: 'public',
        open: 'public',
      },
    },
    {
      ...flow.operations,
      async search(input, context) {
        let link;
        try {
          link = new URL(input.query);
        } catch {
          /* ordinary search terms */
        }
        if (!link) return flow.operations.search(input, context);
        if (!publicUrl(link.href, ['music.apple.com'])) throw new OnlineError('restricted');
        const [region, namespace, ...rest] = link.pathname.split('/').filter(Boolean);
        const song = catalogId(link.searchParams.get('i') || '');
        const key = song || catalogId(rest.at(-1));
        const type = song ? 'songs' : { song: 'songs', album: 'albums', playlist: 'playlists' }[namespace];
        if (!key || !type || !/^[a-z]{2}$/.test(region)) throw new OnlineError('invalid');
        const result = await flow.get(`/v1/catalog/${region}/${type}/${key}`, {}, context.signal);
        return flow.page(result.data, region, result.next);
      },
      async lyrics({ region, id }, { signal }) {
        const data = await flow.get('/lyrics', { storefront: storefront(region), song: id }, signal);
        if (String(data.trackId) !== id) throw new OnlineError('invalid-response');
        const content = boundedText(data.syncedLyrics || data.plainLyrics, 500000);
        if (!content) throw new OnlineError('not-found');
        return { text: content, format: boundedText(data.format, 20) };
      },
      async recommendations({ region }, { signal }) {
        const country = storefront(region);
        const data = await flow.get('/recommendations', { storefront: country }, signal);
        if (!Array.isArray(data.data)) throw new OnlineError('invalid-response');
        return flow.page(
          data.data.flatMap((group) => group.relationships?.contents?.data || []),
          country,
        );
      },
    },
  );
  service.register(
    { id: 'qq', name: 'QQ Music', label: 'hall.qq', capabilities: { search: 'public', open: 'public' } },
    {
      async search({ query, offset }, { signal }) {
        const url = new URL('https://c.y.qq.com/soso/fcgi-bin/client_search_cp');
        url.search = new URLSearchParams({ w: query, p: String(1 + Math.floor(offset / 25)), n: '25', format: 'json' });
        const result = await getJson(url, { signal });
        const data = result?.data?.song;
        if (+result.code !== 0 || !Array.isArray(data?.list)) throw new OnlineError('invalid-response');
        const rows = data.list.flatMap((item) => {
          const id = catalogId(item.songmid);
          if (!id || !item.songname) return [];
          const coverId = catalogId(item.albummid);
          return [
            {
              ref: { provider: 'qq', namespace: 'songs', id, access: { kind: 'public' }, availability: {} },
              title: boundedText(item.songname),
              artist: boundedText((item.singer || []).map((artist) => artist.name).join(' / ')),
              album: boundedText(item.albumname),
              duration: Number.isFinite(item.interval) ? item.interval : undefined,
              image: coverId ? 'https://y.gtimg.cn/music/photo_new/T002R150x150M000' + coverId + '.jpg' : '',
              preview: false,
            },
          ];
        });
        return {
          rows,
          more: data.list.length === 25 && offset + 25 < Number(data.totalnum || data.curnum + offset + 25),
        };
      },
      async open({ id, namespace }) {
        if (namespace !== 'songs') throw new OnlineError('invalid');
        return { url: 'https://y.qq.com/n/ryqq/songDetail/' + id };
      },
    },
  );
  service.register(
    { id: 'kugou', name: 'KuGou', label: 'hall.kugou', capabilities: { search: 'public' } },
    {
      async search({ query, offset }, { signal }) {
        const url = new URL('https://songsearch.kugou.com/song_search_v2');
        url.search = new URLSearchParams({ keyword: query, page: String(1 + Math.floor(offset / 25)), pagesize: '25' });
        const result = await getJson(url, { signal });
        if (+result.status !== 1 || !Array.isArray(result.data?.lists)) throw new OnlineError('invalid-response');
        const rows = result.data.lists.flatMap((item) => {
          const id = catalogId(item.FileHash);
          if (!id || !item.SongName) return [];
          return [
            {
              ref: { provider: 'kugou', namespace: 'songs', id, access: { kind: 'public' }, availability: {} },
              title: boundedText(item.SongName),
              artist: boundedText(item.SingerName),
              album: boundedText(item.AlbumName),
              duration: Number.isFinite(item.Duration) ? item.Duration : undefined,
              image: publicUrl(item.AlbumImage?.replaceAll('{size}', '150'), ['kugou.com']),
              preview: false,
            },
          ];
        });
        return { rows, more: result.data.lists.length === 25 && offset + 25 < Number(result.data.total) };
      },
    },
  );
  if (developerToken) {
    const apple = appleStyle('apple', 'https://api.music.apple.com', { Authorization: 'Bearer ' + developerToken });
    service.register(
      {
        id: 'apple',
        name: 'Apple Music',
        capabilities: { search: 'public', charts: 'public', collection: 'public', preview: 'public', open: 'public' },
      },
      apple.operations,
    );
  }
}

module.exports = { registerPublicProviders, catalogId, boundedText, publicUrl, request, getJson };
