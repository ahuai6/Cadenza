const { OnlineError } = require('./online.cjs');
const { registerApple } = require('./online-apple.cjs');
const { registerKugou } = require('./online-kugou.cjs');

const boundedText = (x, limit = 200) => (typeof x === 'string' ? x.slice(0, limit) : '');
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
function registerPublicProviders(service, developerToken) {
  registerApple(service, developerToken, { getJson, boundedText, publicUrl, catalogId });
  const qqPublic = async (method, params, signal) => {
    const sdk = require('@sansenjian/qq-music-api/services');
    const result = await sdk[method]({
      params,
      isFormat: false,
      option: { signal, timeout: 8000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024 },
    });
    signal.throwIfAborted();
    if (result.status !== 200) throw new OnlineError('provider-failed');
    const body = result.body?.response;
    if (body?.code !== 0) throw new OnlineError('invalid-response');
    return body;
  };
  service.register(
    {
      id: 'qq',
      name: 'QQ Music',
      label: 'hall.qq',
      capabilities: {
        search: 'public',
        charts: 'public',
        recommendations: 'public',
        collection: 'public',
        lyrics: 'public',
        open: 'public',
      },
    },
    {
      async charts(_input, { signal }) {
        const data = await qqPublic('getTopLists', {}, signal);
        if (!Array.isArray(data.data?.topList)) throw new OnlineError('invalid-response');
        return {
          rows: data.data.topList.slice(0, 50).flatMap((chart) => {
            const id = catalogId(chart.id);
            if (!/^\d+$/.test(id) || !chart.topTitle) return [];
            return [
              {
                ref: { provider: 'qq', namespace: 'charts', id, access: { kind: 'public' }, availability: {} },
                title: boundedText(chart.topTitle),
                artist: '',
                album: '',
                image: publicUrl(String(chart.picUrl || '').replace(/^http:/, 'https:'), ['gtimg.cn']),
                preview: false,
                collection: false,
              },
            ];
          }),
          more: false,
        };
      },
      async recommendations(_, { signal }) {
        const result = await qqPublic('songLists', { sin: 0, ein: 24, sortId: 5, categoryId: 10000000 }, signal);
        if (!Array.isArray(result.data?.list)) throw new OnlineError('invalid-response');
        return {
          rows: result.data.list.flatMap((item) => {
            const id = catalogId(item.dissid);
            if (!/^\d+$/.test(id) || !item.dissname) return [];
            return [
              {
                ref: { provider: 'qq', namespace: 'playlists', id, access: { kind: 'public' }, availability: {} },
                title: boundedText(item.dissname),
                artist: '',
                album: '',
                preview: false,
                collection: false,
                image: publicUrl(String(item.imgurl || '').replace(/^http:/, 'https:'), ['qq.com', 'gtimg.cn']),
              },
            ];
          }),
          more: false,
        };
      },
      async collection({ id, namespace, offset }, { signal }) {
        if (namespace !== 'albums') throw new OnlineError('unavailable');
        const result = await qqPublic('getAlbumSongs', { albumMid: id, begin: offset, num: 25 }, signal);
        const album = result.albumSonglist?.data;
        if (result.albumSonglist?.code !== 0 || album?.albumMid !== id || !Array.isArray(album?.songList))
          throw new OnlineError('invalid-response');
        return {
          rows: album.songList.flatMap(({ songInfo }) => {
            const id = catalogId(songInfo?.mid);
            if (!id || !songInfo.name) return [];
            return [
              {
                ref: { provider: 'qq', namespace: 'songs', id, access: { kind: 'public' }, availability: {} },
                title: boundedText(songInfo.name),
                album: boundedText(songInfo.album?.name),
                artist: boundedText((songInfo.singer || []).map(({ name }) => name).join(' / ')),
                duration: songInfo.interval,
                preview: false,
              },
            ];
          }),
          more: offset + album.songList.length < Number(album.totalNum),
        };
      },
      async search({ query, offset }, { signal }) {
        if (offset) return { rows: [], more: false, source: 'qq-smartbox' };
        const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg');
        url.search = new URLSearchParams({ key: query, format: 'json' });
        const result = await getJson(url, { signal });
        if (+result.code !== 0 || !result.data) throw new OnlineError('invalid-response');
        const rows = ['song', 'album'].flatMap((kind) =>
          (result.data[kind]?.itemlist || []).flatMap((item) => {
            const id = catalogId(item.mid);
            if (!id || !item.name) return [];
            return [
              {
                ref: {
                  provider: 'qq',
                  namespace: kind === 'song' ? 'songs' : 'albums',
                  id,
                  access: { kind: 'public' },
                  availability: {},
                },
                title: boundedText(item.name),
                artist: boundedText(item.singer),
                album: '',
                image: publicUrl(String(item.pic || '').replace(/^http:/, 'https:'), ['gtimg.cn']),
                preview: false,
              },
            ];
          }),
        );
        return { rows, more: false, source: 'qq-smartbox' };
      },
      async lyrics({ id, namespace }, { signal }) {
        if (namespace !== 'songs') throw new OnlineError('invalid');
        const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
        url.search = new URLSearchParams({ songmid: id, format: 'json', nobase64: '1' });
        const data = await getJson(url, { signal, headers: { Referer: 'https://y.qq.com/' } });
        if (+data.code !== 0) throw new OnlineError('not-found');
        const lyric = (value) => {
          if (typeof value !== 'string' || value.length > 500_000) return '';
          if (/^\s*\[/.test(value)) return value;
          if (!/^[\w+/]+={0,2}$/.test(value)) return '';
          const decoded = Buffer.from(value, 'base64').toString('utf8');
          return /^\s*\[/.test(decoded) ? decoded : '';
        };
        const original = lyric(data.lyric);
        if (!original) throw new OnlineError('not-found');
        return { text: original, format: 'lrc', tracks: { original, translation: lyric(data.trans) || undefined } };
      },
      async open({ id, namespace }) {
        if (namespace === 'charts' && /^\d+$/.test(id)) return { url: 'https://y.qq.com/n/ryqq/toplist/' + id };
        if (namespace === 'albums') return { url: 'https://y.qq.com/n/ryqq/albumDetail/' + id };
        if (namespace === 'playlists' && /^\d+$/.test(id)) return { url: 'https://y.qq.com/n/ryqq/playlist/' + id };
        if (namespace !== 'songs') throw new OnlineError('invalid');
        return { url: 'https://y.qq.com/n/ryqq/songDetail/' + id };
      },
    },
  );
  registerKugou(service, { getJson, boundedText, publicUrl, catalogId });
}

module.exports = { registerPublicProviders, catalogId, boundedText, publicUrl, request, getJson };
