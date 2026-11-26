const { randomUUID } = require('node:crypto');
const { OnlineError } = require('./online.cjs');
const { boundedText, catalogId, publicUrl, request } = require('./online-providers.cjs');

const lyricText = (value) => (typeof value === 'string' && value.length <= 400000 ? value : undefined);
const lyricTracks = (data) => ({
  original: lyricText(data.lrc?.lyric),
  timed: lyricText(data.yrc?.lyric),
  translation: lyricText(data.tlyric?.lyric),
  transliteration: lyricText(data.romalrc?.lyric),
});
const downloadRates = { standard: 128000, high: 320000, lossless: 999000 };
function allowedTiers(privilege) {
  if (!privilege || privilege.st < 0) return [];
  return Object.entries(downloadRates)
    .filter(
      ([tier, bitrate]) =>
        Number(privilege.dl) >= bitrate ||
        (tier === 'lossless' && ['lossless', 'hires', 'jyeffect', 'sky'].includes(privilege.downloadMaxBrLevel)),
    )
    .map(([tier]) => tier);
}

const routes = {
  cloudsearch: ['/api/cloudsearch/pc', (x) => ({ s: x.keywords, type: x.type, limit: x.limit, offset: x.offset })],
  login_qr_key: ['/api/login/qrcode/unikey', () => ({ type: 3 })],
  login_qr_check: ['/api/login/qrcode/client/login', (x) => ({ key: x.key, type: 3 })],
  login_status: ['/api/w/nuser/account/get', () => ({})],
  toplist: ['/api/toplist', () => ({})],
  personalized: ['/api/personalized/playlist', (x) => ({ limit: x.limit, n: 1000, total: true })],
  playlist_detail: ['/api/v6/playlist/detail', (x) => ({ id: x.id, n: 100000, s: 8 })],
  user_playlist: ['/api/user/playlist', (x) => ({ uid: x.uid, limit: x.limit, offset: x.offset })],
  song_detail: ['/api/v3/song/detail', (x) => ({ c: JSON.stringify(x.ids.split(',').map((id) => ({ id }))) })],
  song_download_url: ['/api/song/enhance/download/url', (x) => ({ id: x.id, br: x.br })],
  lyric: ['/api/song/lyric', (x) => ({ id: x.id, tv: -1, lv: -1, rv: -1, kv: -1, _nmclfl: 1 })],
};
async function call(method, query, { signal, secret } = {}) {
  const [route, body] = routes[method];
  const base = 'https://music.163.com';
  const headers = { Referer: base + '/', 'Content-Type': 'application/x-www-form-urlencoded' };
  if (secret?.cookie) headers.Cookie = secret.cookie;
  const result = await request(base + route, {
    signal,
    method: 'POST',
    headers,
    body: new URLSearchParams(body(query)),
  });
  let data;
  try {
    data = JSON.parse(result.content.toString('utf8'));
  } catch {
    throw new OnlineError('invalid-response');
  }
  if (!data || typeof data !== 'object') throw new OnlineError('invalid-response');
  if ([301, 302].includes(data.code)) throw new OnlineError('expired');
  if (method === 'login_qr_check') data.cookie = result.cookies.map((item) => item.split(';', 1)[0]).join('; ');
  return data;
}

const idValid = (v) => /^\d{1,20}$/.test(String(v));
const idOf = (v) => {
  if (!idValid(v)) throw new OnlineError('invalid');
  return String(v);
};
function track(item) {
  if (!item?.name || !idValid(item.id)) return null;
  const album = item.al || item.album;
  return {
    ref: { provider: 'netease', namespace: 'songs', id: String(item.id), access: { kind: 'public' }, availability: {} },
    title: boundedText(item.name),
    artist: boundedText((item.ar || item.artists || []).map((a) => a.name).join(' / ')),
    album: boundedText(album?.name),
    image: publicUrl(album?.picUrl, ['music.126.net']),
    duration: Number.isFinite(item.dt) ? item.dt / 1000 : undefined,
    preview: false,
  };
}
function playlist(item) {
  if (!item?.name || !idValid(item.id)) return null;
  return {
    ref: {
      provider: 'netease',
      namespace: 'playlists',
      id: String(item.id),
      access: { kind: 'public' },
      availability: {},
    },
    title: boundedText(item.name),
    artist: boundedText(item.creator?.nickname),
    album: '',
    image: publicUrl(item.coverImgUrl || item.picUrl, ['music.126.net']),
    preview: false,
  };
}
function filtered(list, mapper) {
  if (!Array.isArray(list)) throw new OnlineError('invalid-response');
  return list.map(mapper).filter(Boolean);
}
function accounts(service) {
  const login = new Map();
  return async function account(input, ctx) {
    for (const [key, item] of login) if (item.expiresAt <= Date.now()) login.delete(key);
    if (input.action === 'begin') {
      if (login.size >= 16) throw new OnlineError('rate-limit');
      const data = await call('login_qr_key', {}, ctx);
      const key = catalogId(data.unikey);
      if (!key) throw new OnlineError('invalid-response');
      const id = randomUUID();
      const expiresAt = Date.now() + 180000;
      const image = await require('qrcode').toDataURL('https://music.163.com/login?codekey=' + key, { width: 220 });
      login.set(id, { key, owner: ctx.owner, expiresAt });
      return { id, image, expiresAt, phase: 'waiting' };
    }
    if (input.action === 'logout') {
      await service.disconnect('netease', idOf(input.account));
      return { phase: 'disconnected' };
    }
    const job = login.get(input.id);
    if (!job || job.owner !== ctx.owner) return { phase: 'expired' };
    if (input.action === 'cancel') {
      login.delete(input.id);
      return { phase: 'cancelled' };
    }
    if (input.action !== 'poll') throw new OnlineError('invalid');
    const res = await call('login_qr_check', { key: job.key }, ctx);
    if (login.get(input.id) !== job) throw new OnlineError('cancelled');
    if (res.code === 800) {
      login.delete(input.id);
      return { phase: 'expired' };
    }
    if (res.code === 801 || res.code === 802) return { phase: res.code === 802 ? 'confirm' : 'waiting' };
    if (res.code !== 803 || typeof res.cookie !== 'string') throw new OnlineError('invalid-response');
    const cookie = res.cookie
      .split(';')
      .map((x) => x.trim())
      .filter((x) => /^(MUSIC_U|__csrf|MUSIC_R_T)=/.test(x))
      .join('; ');
    if (!cookie.startsWith('MUSIC_U=') && !cookie.includes('; MUSIC_U=')) throw new OnlineError('invalid-response');
    const status = await call('login_status', {}, { ...ctx, secret: { cookie } });
    const profile = status?.data?.profile || status.profile;
    if (!profile?.nickname || !idValid(profile.userId)) throw new OnlineError('invalid-response');
    if (login.get(input.id) !== job) throw new OnlineError('cancelled');
    await service.connect('netease', { id: String(profile.userId), name: boundedText(profile.nickname) }, { cookie });
    login.delete(input.id);
    return { phase: 'connected' };
  };
}
async function collection(id, offset, ctx) {
  const data = await call('playlist_detail', { id: idOf(id), n: 100000 }, ctx);
  const ids = data.playlist?.trackIds;
  const total = data.playlist?.trackCount;
  if (!Array.isArray(ids) || ids.length !== total) throw new OnlineError('incomplete');
  const wanted = ids.slice(offset, offset + 25).map((item) => idOf(item.id));
  if (!wanted.length) return { rows: [], more: false };
  const result = await call('song_detail', { ids: [...new Set(wanted)].join(',') }, ctx);
  const index = new Map(filtered(result.songs, track).map((item) => [item.ref.id, item]));
  if (wanted.some((id) => !index.has(id))) throw new OnlineError('incomplete');
  return { rows: wanted.map((id) => index.get(id)), more: ids.length > offset + wanted.length };
}
function registerNetease(service) {
  service.register(
    {
      id: 'netease',
      name: 'NetEase Cloud Music',
      label: 'hall.netease',
      capabilities: {
        search: 'public',
        recommendations: 'public',
        charts: 'public',
        collection: 'public',
        account: 'public',
        playlists: 'authorized',
        download: 'authorized',
        variants: 'authorized',
        lyrics: 'public',
        open: 'public',
      },
    },
    {
      async search({ query, offset }, ctx) {
        const data = await call('cloudsearch', { keywords: query, type: 1, limit: 25, offset }, ctx);
        const rows = filtered(data.result?.songs || (data.result?.songCount === 0 ? [] : null), track);
        return { rows, more: offset + rows.length < Number(data.result?.songCount) && rows.length > 0 };
      },
      async recommendations(_, ctx) {
        const data = await call('personalized', { limit: 18 }, ctx);
        return { rows: filtered(data.result, playlist), more: false };
      },
      async charts(_, ctx) {
        const data = await call('toplist', {}, ctx);
        return { rows: filtered(data.list, playlist), more: false };
      },
      collection: ({ id, offset }, ctx) => collection(id, offset, ctx),
      account: accounts(service),
      async lyrics({ id, namespace }, ctx) {
        if (namespace !== 'songs') throw new OnlineError('invalid');
        const raw = await call('lyric', { id: idOf(id) }, ctx);
        const tracks = lyricTracks(raw);
        if (!tracks.timed && !tracks.original) throw new OnlineError('not-found');
        return { text: tracks.timed || tracks.original, format: tracks.timed ? 'yrc' : 'lrc', tracks };
      },
      async playlists({ account, id, offset }, ctx) {
        if (id) return collection(id, offset, ctx);
        const result = await call('user_playlist', { uid: idOf(account), limit: 100, offset }, ctx);
        return {
          rows: filtered(result.playlist, playlist).map((row) => ({
            ...row,
            ref: {
              ...row.ref,
              access: { kind: 'account', accountId: account },
            },
          })),
          more: result.more === true,
        };
      },
      async variants({ id }, ctx) {
        const data = await call('song_detail', { ids: idOf(id) }, ctx);
        return allowedTiers(data.privileges?.find((entry) => String(entry.id) === id));
      },
      async download({ id, tier }, ctx) {
        const bitrate = downloadRates[tier];
        if (!bitrate) throw new OnlineError('invalid');
        const data = await call('song_detail', { ids: idOf(id) }, ctx);
        const metadata = filtered(data.songs, track).find((item) => item.ref.id === id);
        const privilege = data.privileges?.find((entry) => String(entry.id) === id);
        if (!metadata?.duration || !allowedTiers(privilege).includes(tier)) throw new OnlineError('restricted');
        const answer = await call('song_download_url', { id, br: bitrate }, ctx);
        const media = Array.isArray(answer.data) ? answer.data[0] : answer.data;
        if (
          !media?.url ||
          String(media.id) !== id ||
          media.code !== 200 ||
          media.freeTrialInfo ||
          !['mp3', 'flac', 'aac', 'alac'].includes(String(media.encodeType).toLowerCase()) ||
          (tier === 'lossless' && !['flac', 'alac'].includes(String(media.encodeType).toLowerCase())) ||
          (tier !== 'lossless' && Number(media.br) < bitrate)
        )
          throw new OnlineError('restricted');
        let lyrics;
        try {
          const text = await call('lyric', { id }, ctx);
          const tracks = lyricTracks(text);
          const original = tracks.original;
          if (original !== undefined) {
            lyrics = {
              text: original,
              auxiliary: {
                translation: tracks.translation,
                transliteration: tracks.transliteration,
              },
            };
          }
        } catch {
          ctx.signal?.throwIfAborted();
        }
        const address = new URL(media.url);
        if (address.protocol === 'http:') address.protocol = 'https:';
        return {
          url: address.href,
          permission: 'save',
          expiresAt: Date.now() + 90000,
          size: Number(media.size),
          codec: String(media.encodeType).toLowerCase(),
          track: metadata,
          tier,
          lyrics,
        };
      },
      async open({ id, namespace }) {
        return {
          url: 'https://music.163.com/' + (namespace === 'playlists' ? 'playlist' : 'song') + '?id=' + idOf(id),
        };
      },
    },
  );
}

module.exports = { registerNetease };
