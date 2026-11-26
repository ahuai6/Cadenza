const { isKrc, decodeKrc } = require('./krc.cjs');
const MAX_BODY = 1_500_000;
const text = (value) => (typeof value === 'string' && value.length <= 500_000 ? value : '');
const field = (value) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');
const safeId = (value) => /^[a-zA-Z0-9]{1,32}$/.test(String(value || ''));
const normalized = (value) =>
  field(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}]/gu, '');
const variant = (value) =>
  field(value)
    .toLowerCase()
    .match(/(?:\b(?:live|remaster(?:ed)?|remix|cover|acoustic|instrumental|karaoke|edit)\b|现场|重制|翻唱|伴奏)/gu)
    ?.sort()
    .join('/') || '';

function krcLanes(document) {
  const encoded = /^\[language:([A-Za-z0-9+/=]+)\]/m.exec(document)?.[1];
  if (!encoded) return {};
  let tracks;
  try {
    tracks = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')).content;
  } catch {
    return {};
  }
  if (!Array.isArray(tracks)) return {};
  const timestamps = [...document.matchAll(/^\[(\d+),\d+\]</gm)].map((line) => Number(line[1]));
  const lanes = {};
  for (const [type, role] of [
    [0, 'transliteration'],
    [1, 'translation'],
  ]) {
    const track = tracks.find((item) => item?.type === type && item.lyricContent?.length === timestamps.length);
    if (!track || !Array.isArray(track.lyricContent)) continue;
    const rows = track.lyricContent.map((row, index) => {
      const ms = timestamps[index];
      const stamp =
        Math.floor(ms / 60000) +
        ':' +
        String(Math.floor(ms / 1000) % 60).padStart(2, '0') +
        '.' +
        String(ms % 1000).padStart(3, '0');
      if (!Array.isArray(row) || !row.every((word) => typeof word === 'string')) return '[' + stamp + ']';
      return '[' + stamp + ']' + row.join(type === 0 ? ' ' : '');
    });
    lanes[role] = rows.join('\n');
  }
  return lanes;
}

function match(q, item) {
  const delta = item.duration > 0 && q.duration > 0 ? Math.abs(item.duration - q.duration) : null;
  const warnings = [];
  let score = 0;
  if (normalized(q.title) === normalized(item.title)) score += 35;
  else warnings.push('title');
  if (q.artist && normalized(q.artist) === normalized(item.artist)) score += 30;
  else if (q.artist) warnings.push('artist');
  if (q.album && normalized(q.album) === normalized(item.album)) score += 8;
  if (delta !== null && delta <= 3) score += 15;
  else if (delta > 8) warnings.push('duration');
  if (variant(q.title + ' ' + q.album) !== variant(item.title + ' ' + item.album)) {
    warnings.push('version');
    score -= 45;
  }
  if (q.isrc && q.isrc === item.isrc?.toUpperCase()) score += 30;
  return { ...item, score, warnings, delta };
}

function url(base, params) {
  const address = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value) address.searchParams.set(key, String(value));
  return address;
}

function lyricService(fetcher = fetch) {
  async function get(address, signal, options, raw = false) {
    const res = await fetcher(address, { ...options, signal, redirect: 'error' });
    if (res.status === 404) return null;
    if (!res.ok || !res.body) throw new Error('lyric-service');
    let bytes = 0;
    const chunks = [];
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > MAX_BODY) throw new Error('lyric-size');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    return raw ? body : JSON.parse(body);
  }
  const usable = ({ synced, plain }) => synced || plain;
  const lrcPrecision = (value) => (/<\d{1,3}:\d{2}(?:[.:]\d+)?\s*>/.test(value) ? 'word' : 'line');
  const ttmlPrecision = (value) => (/<[^<>]*span\b[^<>]*\bbegin\s*=/i.test(value) ? 'word' : 'line');

  async function lrclib(q, signal) {
    const data = await get(
      url('https://lrclib.net/api/search', { track_name: q.title, artist_name: q.artist }),
      signal,
      {
        headers: { 'User-Agent': 'Cadenza (+https://github.com/ahuai6/Cadenza)' },
      },
    );
    if (!Array.isArray(data)) throw new Error('lyric-contract');
    return data
      .slice(0, 24)
      .map((record) => ({
        id: 'lrclib:' + record.id,
        source: 'LRCLIB',
        title: field(record.trackName),
        artist: field(record.artistName),
        album: field(record.albumName),
        duration: +record.duration || 0,
        synced: text(record.syncedLyrics),
        plain: text(record.plainLyrics),
        format: record.syncedLyrics ? 'lrc' : 'plain',
        precision: record.syncedLyrics ? lrcPrecision(record.syncedLyrics) : 'plain',
      }))
      .filter(usable);
  }
  async function flow(q, signal) {
    if (!q.artist) return [];
    const data = await get(
      url('https://api.trylyricsflow.com/lyrics/by-metadata', {
        title: q.title,
        artist: q.artist,
        album: q.album,
        duration_ms: q.duration && Math.round(q.duration * 1000),
      }),
      signal,
    );
    if (!data) return [];
    if (!safeId(data.trackId)) throw new Error('lyric-contract');
    const synced = text(data.syncedLyrics),
      plain = text(data.plainLyrics);
    const ttml = /^\s*(?:<\?xml[^>]*>\s*)?<(?:\w+:)?tt\b/i.test(synced);
    if (!synced && !plain) return [];
    const item = {
      id: 'lyricsflow:' + data.trackId,
      source: 'LyricsFlow',
      title: field(data.title || data.trackName) || q.title,
      artist: field(data.artist || data.artistName) || q.artist,
      album: field(data.album || data.albumName),
      duration: +(data.durationMs || data.duration) / 1000 || 0,
      isrc: field(data.isrc),
      synced,
      plain,
      format: ttml ? 'ttml' : synced ? 'lrc' : 'plain',
      precision: ttml ? ttmlPrecision(synced) : synced ? lrcPrecision(synced) : 'plain',
      matchUnverified: !(data.title || data.trackName),
    };
    return [item, ...(await amll('am-lyrics', item, data.trackId, signal))];
  }
  async function amll(directory, item, ref, signal) {
    try {
      const value = await get(
        'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/' + directory + '/' + ref + '.ttml',
        signal,
        {},
        true,
      );
      return value && /^\s*(?:<\?xml[^>]*>\s*)?<(?:\w+:)?tt\b/i.test(value)
        ? [
            {
              ...item,
              id: 'amll:' + directory + ':' + ref,
              source: 'AMLL',
              synced: value,
              format: 'ttml',
              precision: ttmlPrecision(value),
            },
          ]
        : [];
    } catch {
      return [];
    }
  }
  async function netease(q, signal) {
    function call(route, data) {
      return get('https://music.163.com/api/' + route, signal, { method: 'POST', body: new URLSearchParams(data) });
    }
    const data = await call('cloudsearch/pc', { s: q.query, type: 1, limit: 6, offset: 0 });
    if (!Array.isArray(data?.result?.songs) && data?.result?.songCount !== 0) throw new Error('lyric-contract');
    const items = (data.result.songs || [])
      .filter((rec) => /^\d{1,22}$/.test(String(rec.id)))
      .map((rec) =>
        match(q, {
          id: String(rec.id),
          title: field(rec.name),
          artist: rec.ar?.map((a) => field(a.name)).join(' / ') || '',
          album: field(rec.al?.name),
          duration: +rec.dt / 1000 || 0,
        }),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    return settle(
      items.map(async (item) => {
        const [native, community] = await Promise.allSettled([
          call('song/lyric', { id: item.id, lv: -1, kv: -1, tv: -1, rv: -1, yv: -1, _nmclfl: 1 }),
          amll('ncm-lyrics', item, item.id, signal),
        ]);
        const lyric = native.value,
          yrc = text(lyric?.yrc?.lyric),
          synced = yrc || text(lyric?.lrc?.lyric);
        return [
          ...(community.value || []),
          ...(synced
            ? [
                {
                  ...item,
                  id: 'netease:' + item.id,
                  source: '网易云音乐',
                  synced,
                  format: yrc ? 'yrc' : 'lrc',
                  precision: yrc ? 'word' : lrcPrecision(synced),
                  translation: text(lyric?.ytlrc?.lyric) || text(lyric?.tlyric?.lyric),
                  transliteration: text(lyric?.yromalrc?.lyric) || text(lyric?.romalrc?.lyric),
                },
              ]
            : []),
        ];
      }),
    );
  }
  async function qq(q, signal) {
    const data = await get(
      url('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg', { key: q.query, format: 'json' }),
      signal,
    );
    if (+data?.code !== 0 || !data?.data) throw new Error('lyric-contract');
    const items = (data.data.song?.itemlist || [])
      .slice(0, 6)
      .filter((rec) => safeId(rec.mid))
      .map((rec) =>
        match(q, {
          id: rec.mid,
          title: field(rec.name),
          artist: field(rec.singer),
          album: '',
          duration: 0,
        }),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    return settle(
      items.map(async (item) => {
        const [native, community] = await Promise.allSettled([
          get(
            url('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
              songmid: item.id,
              format: 'json',
              nobase64: 1,
            }),
            signal,
            { headers: { Referer: 'https://y.qq.com/' } },
          ),
          amll('qq-lyrics', item, item.id, signal),
        ]);
        function decode(value) {
          const raw = text(value);
          if (/^\s*\[/.test(raw)) return raw;
          const decoded = /^[\w+/]+={0,2}$/.test(raw) ? Buffer.from(raw, 'base64').toString('utf8') : '';
          return /^\s*\[/.test(decoded) ? decoded : '';
        }
        const synced = +native.value?.code === 0 ? decode(native.value.lyric) : '';
        return [
          ...(community.value || []),
          ...(synced
            ? [
                {
                  ...item,
                  id: 'qq:' + item.id,
                  source: 'QQ 音乐',
                  synced,
                  format: 'lrc',
                  precision: lrcPrecision(synced),
                  translation: decode(native.value.trans),
                  transliteration: decode(native.value.roma),
                },
              ]
            : []),
        ];
      }),
    );
  }
  async function kugou(q, signal) {
    const service = 'https://lyrics.kugou.com/';
    const data = await get(
      url(service + 'search', {
        ver: 1,
        man: 'yes',
        client: 'pc',
        keyword: q.query,
        duration: q.duration && Math.round(q.duration * 1000),
      }),
      signal,
    );
    if (+data?.status !== 200) throw new Error('lyric-contract');
    const candidates = (data.candidates || [])
      .slice(0, 8)
      .flatMap((rec) => {
        if (!safeId(rec.id) || typeof rec.accesskey !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(rec.accesskey))
          return [];
        return [
          {
            ...match(q, {
              id: rec.id,
              title: field(rec.song),
              artist: field(rec.singer),
              album: '',
              duration: +rec.duration / 1000 || 0,
            }),
            lookup: rec.accesskey,
          },
        ];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    return settle(
      candidates.map(async ({ lookup, ...item }) => {
        const data = await get(
          url(service + 'download', {
            ver: 1,
            client: 'pc',
            id: item.id,
            accesskey: lookup,
            fmt: 'krc',
            charset: 'utf8',
          }),
          signal,
        );
        if (+data?.status !== 200 || !text(data.content)) return [];
        const bytes = Buffer.from(data.content, 'base64');
        if (!isKrc(bytes)) return [];
        const synced = decodeKrc(bytes, 500_000);
        if (!/^\uFEFF?\[\d+,\d+\]</m.test(synced)) return [];
        return [
          {
            ...item,
            id: 'kugou:' + item.id,
            source: '酷狗音乐',
            synced,
            format: 'krc',
            precision: 'word',
            ...krcLanes(synced.replace(/^\uFEFF/, '')),
          },
        ];
      }),
    );
  }
  async function settle(tasks) {
    const results = await Promise.allSettled(tasks);
    if (results.length && results.every((item) => item.status === 'rejected')) throw new Error('lyric-service');
    return results.flatMap((item) => item.value || []);
  }
  return async function search(query, cancel) {
    const q = {
      title: field(query?.title),
      artist: field(query?.artist),
      album: field(query?.album),
      duration: Math.min(86400, +query?.duration || 0),
      isrc: field(query?.isrc).toUpperCase(),
    };
    if (!q.title) return [];
    q.query = [q.title, q.artist].filter(Boolean).join(' ');
    const timeout = AbortSignal.timeout(8500);
    const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout;
    const found = await settle([
      lrclib(q, signal),
      flow(q, signal),
      netease(q, signal),
      qq(q, signal),
      kugou(q, signal),
    ]);
    signal.aborted && cancel?.throwIfAborted();
    const precision = { plain: 0, line: 3, word: 7 };
    return found
      .map((item) => {
        const result = match(q, item);
        if (result.matchUnverified) {
          result.score = 0;
          result.warnings.push('metadata');
        }
        return result;
      })
      .sort((a, b) => b.score + precision[b.precision] - (a.score + precision[a.precision]))
      .filter(
        (item, index, sorted) =>
          !sorted
            .slice(0, index)
            .some(
              (prior) =>
                prior.source === item.source &&
                prior.synced === item.synced &&
                prior.plain === item.plain &&
                normalized(prior.title) === normalized(item.title) &&
                normalized(prior.artist) === normalized(item.artist),
            ),
      )
      .slice(0, 24);
  };
}

module.exports = { lyricService, match, krcLanes };
