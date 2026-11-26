const { OnlineError } = require('./online.cjs');
const { createHash } = require('node:crypto');
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
      if (!/^\d+$/.test(id)) throw new OnlineError('invalid');
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
  const configuration = { officialCatalog: !!developerToken };
  let configuredToken;
  let configurationRead;
  const officialClient = (token) =>
    appleStyle('apple', 'https://api.music.apple.com', { Authorization: 'Bearer ' + token }, transport);
  async function configuredDeveloper() {
    configurationRead ||= Promise.resolve()
      .then(() => service.readConfiguration('apple'))
      .then((value) => {
        configuredToken ||= value?.developerToken;
        configuration.officialCatalog = !!(configuredToken || developerToken);
      })
      .catch(() => {});
    await configurationRead;
    return configuredToken || developerToken;
  }
  const catalog = async (operation) => {
    const token = await configuredDeveloper();
    if (token) {
      try {
        return await operation(officialClient(token));
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
  function userClient(secret) {
    return appleStyle(
      'apple',
      'https://api.music.apple.com',
      {
        Authorization: 'Bearer ' + secret.developerToken,
        'Music-User-Token': secret.musicUserToken,
      },
      transport,
    );
  }
  async function account(input, { signal }) {
    if (input.action === 'logout') {
      await service.disconnect('apple', input.account);
      return { phase: 'disconnected' };
    }
    if (input.action !== 'import') throw new OnlineError('invalid');
    const token = input.credentials?.developerToken || (await configuredDeveloper());
    const user = input.credentials?.musicUserToken;
    if (typeof token !== 'string' || !/^[\w.-]{20,4096}$/.test(token)) throw new OnlineError('invalid');
    if (user === undefined) {
      await officialClient(token).operations.charts({ region: 'us' }, { signal });
      signal.throwIfAborted();
      await service.saveConfiguration('apple', { developerToken: token });
      configuredToken = token;
      configuration.officialCatalog = true;
      return { phase: 'configured' };
    }
    if (typeof user !== 'string' || !/^[!-~]{16,8192}$/.test(user)) throw new OnlineError('invalid');
    const secret = { developerToken: token, musicUserToken: user };
    const storefrontReply = await userClient(secret).get('/v1/me/storefront', {}, signal);
    const region = storefrontReply.data?.[0]?.id;
    if (!/^[a-z]{2}$/.test(region || '')) throw new OnlineError('invalid-response');
    signal.throwIfAborted();
    const id = createHash('sha256').update(user).digest('hex').slice(0, 32);
    await service.connect('apple', { id, name: 'Apple Music · ' + region.toUpperCase() }, { ...secret, region });
    return { phase: 'connected' };
  }
  async function playlists({ id, account, offset }, { secret, signal }) {
    if (id && !/^p\.[\w.-]+$/.test(id)) throw new OnlineError('invalid');
    const limit = id ? 25 : 100;
    const route = '/v1/me/library/playlists' + (id ? '/' + id + '/tracks' : '');
    const response = await userClient(secret).get(route, { limit, offset }, signal);
    if (!Array.isArray(response.data)) throw new OnlineError('invalid-response');
    const rows = response.data.map((item) => {
      const key = transport.catalogId(item?.id);
      const a = item?.attributes;
      const namespace = id ? 'library-songs' : 'library-playlists';
      if (!key || !a?.name || item.type !== namespace) throw new OnlineError('invalid-response');
      const catalogId =
        id && transport.catalogId(item.relationships?.catalog?.data?.[0]?.id || a.playParams?.catalogId);
      return {
        ref: {
          provider: 'apple',
          namespace,
          id: key,
          access: { kind: 'account', accountId: account },
          availability: { storefront: secret.region },
        },
        title: transport.boundedText(a.name),
        artist: transport.boundedText(a.artistName),
        album: transport.boundedText(a.albumName),
        catalogId: catalogId || undefined,
        preview: !!catalogId,
        collection: !id,
        duration: Number.isFinite(a.durationInMillis) ? a.durationInMillis / 1000 : undefined,
      };
    });
    if (response.next) {
      const next = new URL(response.next, 'https://api.music.apple.com');
      if (
        next.origin !== 'https://api.music.apple.com' ||
        next.pathname !== route ||
        Number(next.searchParams.get('offset')) !== offset + limit
      )
        throw new OnlineError('incomplete');
    }
    return { rows, more: !!response.next };
  }
  service.register(
    {
      id: 'apple',
      name: 'Apple Music',
      configuration,
      capabilities: {
        account: 'public',
        playlists: 'authorized',
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
      account,
      playlists,
      preview: flow.operations.preview,
      open: flow.operations.open,
      async lyrics({ region, id, namespace }, { signal }) {
        if (namespace !== 'songs' || !/^\d+$/.test(id)) throw new OnlineError('invalid');
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
