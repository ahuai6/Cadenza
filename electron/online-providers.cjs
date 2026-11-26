const { OnlineError } = require('./online.cjs');
const { registerApple } = require('./online-apple.cjs');

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
  service.register(
    {
      id: 'qq',
      name: 'QQ Music',
      label: 'hall.qq',
      capabilities: { search: 'public', charts: 'public', open: 'public' },
    },
    {
      async charts(_input, { signal }) {
        const { getTopLists } = require('@sansenjian/qq-music-api/services');
        const response = await getTopLists({
          isFormat: false,
          option: { signal, timeout: 8000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024 },
        });
        signal.throwIfAborted();
        if (response.status !== 200) throw new OnlineError('provider-failed');
        const data = response.body?.response;
        if (data?.code !== 0 || !Array.isArray(data.data?.topList)) throw new OnlineError('invalid-response');
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
              },
            ];
          }),
          more: false,
        };
      },
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
        if (namespace === 'charts' && /^\d+$/.test(id)) return { url: 'https://y.qq.com/n/ryqq/toplist/' + id };
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
}

module.exports = { registerPublicProviders, catalogId, boundedText, publicUrl, request, getJson };
