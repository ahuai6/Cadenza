const { OnlineError } = require('./online.cjs');
const storefront = (x) => (/^[a-z]{2}$/.test(x || '') ? x : 'us');

function appleStyle(source, base, headers, { getJson, boundedText, publicUrl, catalogId }) {
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
      ref: {
        provider: 'apple',
        namespace: item.type,
        id,
        access: { kind: 'public' },
        availability: { storefront: country },
      },
      title: boundedText(a.name),
      artist: boundedText(a.artistName || a.curatorName),
      album: boundedText(a.albumName),
      duration: Number.isFinite(a.durationInMillis) ? a.durationInMillis / 1000 : undefined,
      preview: !!publicUrl(a.previews?.[0]?.url, ['mzstatic.com', 'itunes.apple.com'], true),
      image,
      source,
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
      source,
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
      const item = data.data?.[0];
      if (item?.type !== 'songs' || String(item.id) !== id) throw new OnlineError('unmatched');
      const link = publicUrl(item.attributes?.previews?.[0]?.url, ['mzstatic.com', 'itunes.apple.com'], true);
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

const fallbackErrors = new Set([
  'provider-failed',
  'expired',
  'timeout',
  'rate-limit',
  'restricted',
  'invalid-response',
]);

function appleLink(query, { publicUrl, catalogId }) {
  let url;
  try {
    url = new URL(query);
  } catch {
    return null;
  }
  if (!publicUrl(url.href, ['music.apple.com'])) throw new OnlineError('restricted');
  const [region, kind, ...trail] = url.pathname.split('/').filter(Boolean);
  const song = url.searchParams.get('i');
  const namespace = song ? 'songs' : { song: 'songs', album: 'albums', playlist: 'playlists' }[kind];
  const id = catalogId(song || trail.at(-1));
  if (!namespace || !id || !/^[a-z]{2}$/.test(region)) throw new OnlineError('invalid');
  return { region, namespace, id };
}

function registerApple(service, developerToken, transport) {
  const flow = appleStyle('lyricsflow', 'https://api.trylyricsflow.com', {}, transport);
  const official = developerToken
    ? appleStyle('apple', 'https://api.music.apple.com', { Authorization: 'Bearer ' + developerToken }, transport)
    : null;
  const catalog = async (operation) => {
    if (official) {
      try {
        return await operation(official);
      } catch (error) {
        if (!fallbackErrors.has(error.code)) throw error;
      }
    }
    return operation(flow);
  };
  const recommendations = async ({ region }, { signal }) => {
    const country = storefront(region);
    const result = await flow.get('/recommendations', { storefront: country }, signal);
    if (!Array.isArray(result.data)) throw new OnlineError('invalid-response');
    return flow.page(
      result.data.flatMap((group) => group.relationships?.contents?.data || []),
      country,
    );
  };
  service.register(
    {
      id: 'apple',
      name: 'Apple Music',
      configuration: { officialCatalog: !!official },
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
      search(input, context) {
        const link = appleLink(input.query, transport);
        if (!link) return catalog((client) => client.operations.search(input, context));
        return catalog(async (client) => {
          const result = await client.get(
            `/v1/catalog/${link.region}/${link.namespace}/${link.id}`,
            {},
            context.signal,
          );
          const page = client.page(result.data, link.region, result.next);
          if (page.rows.some((row) => row.ref.namespace !== link.namespace || row.ref.id !== link.id))
            throw new OnlineError('unmatched');
          return page;
        });
      },
      charts: (input, context) => catalog((client) => client.operations.charts(input, context)),
      collection: (input, context) => catalog((client) => client.operations.collection(input, context)),
      recommendations,
      preview: flow.operations.preview,
      open: flow.operations.open,
      async lyrics({ region, id, namespace }, { signal }) {
        if (namespace !== 'songs') throw new OnlineError('invalid');
        const data = await flow.get('/lyrics', { storefront: storefront(region), song: id }, signal);
        if (String(data.trackId) !== id) throw new OnlineError('unmatched');
        const text = data.syncedLyrics || data.plainLyrics;
        if (typeof text !== 'string' || !text || text.length > 500000) throw new OnlineError('not-found');
        return { text, format: transport.boundedText(data.format, 20) };
      },
    },
  );
}

module.exports = { registerApple };
