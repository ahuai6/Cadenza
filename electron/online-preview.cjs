const { randomUUID } = require('node:crypto');
const { OnlineError } = require('./online.cjs');
const { publicUrl, request } = require('./online-providers.cjs');

let current;
function close(owner) {
  if (!current || (owner != null && current.owner !== owner)) return null;
  const previous = current;
  current = null;
  clearTimeout(previous.timer);
  return previous.token;
}
async function prepare(lease, signal) {
  const url = publicUrl(
    lease.url,
    ['mzstatic.com', 'itunes.apple.com', 'music.126.net', '126.net', 'qq.com', 'kugou.com'],
    true,
  );
  if (!url || lease.permission !== 'stream' || lease.expiresAt <= Date.now()) throw new OnlineError('restricted');
  const { content, type } = await request(url, { signal, bytes: 4 * 1024 * 1024 });
  const isMp4 = content.subarray(4, 8).toString() === 'ftyp';
  const isMp3 = content.subarray(0, 3).toString() === 'ID3' || (content[0] === 255 && (content[1] & 224) === 224);
  if (
    (!isMp4 && !isMp3) ||
    content.length < 500 ||
    (!type.startsWith('audio/') && type !== 'application/octet-stream' && type !== 'video/mp4')
  )
    throw new OnlineError('invalid-response');
  const mm = await import('music-metadata');
  const metadata = await mm.parseBuffer(
    content,
    { mimeType: isMp4 ? 'audio/mp4' : 'audio/mpeg', size: content.length },
    { duration: true, skipCovers: true },
  );
  if (!(metadata.format.duration > 0 && metadata.format.duration <= 95)) throw new OnlineError('restricted');
  return { content, mime: isMp4 ? 'audio/mp4' : 'audio/mpeg', duration: metadata.format.duration };
}
function open(owner, asset, onExpire) {
  close();
  const token = randomUUID();
  current = {
    ...asset,
    owner,
    token,
    timer: setTimeout(() => onExpire(token), Math.min(110_000, (asset.duration + 12) * 1000)),
  };
  return { token, duration: asset.duration };
}
function serve(token, request) {
  if (!current || current.token !== token || !['GET', 'HEAD'].includes(request.method))
    return new Response(null, { status: 404 });
  const total = current.content.length;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': current.mime,
    'Accept-Ranges': 'bytes',
  };
  const range = request.headers.get('range');
  let first = 0,
    last = total - 1;
  if (range) {
    const found = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (found && (found[1] || found[2])) {
      first = found[1] ? +found[1] : Math.max(0, total - +found[2]);
      last = found[1] && found[2] ? Math.min(last, +found[2]) : last;
    }
    if (!found || (!found[1] && !found[2]) || first > last)
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': 'bytes */' + total } });
    headers['Content-Range'] = `bytes ${first}-${last}/${total}`;
  }
  headers['Content-Length'] = String(last - first + 1);
  return new Response(request.method === 'HEAD' ? null : current.content.subarray(first, last + 1), {
    status: range ? 206 : 200,
    headers,
  });
}
module.exports = { close, open, prepare, serve };
