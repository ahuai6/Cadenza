// The personal music library, in the main process. It owns everything on disk: the folders the user chose, what is in
// them (tags, covers, sidecar lyrics), the user's favourites and playlists, each song's own lyric style, the rhythm
// analysis cache, and lookups of lyrics (LRCLIB), tags (MusicBrainz) and covers. The page only ever sees ids and
// cadenza:// URLs, never paths it could ask to read or write on its own; the one file it may write is a song's own .lrc
// beside the audio.
//
// Rhythm analysis runs in the page (the rhythm SDK's worker). This side keeps the queue of songs still to analyse and the
// cache: each analysis is the SDK's own RhythmAnalysis JSON (gzip), tagged with the SDK version that made it; a newer SDK
// asks for the songs again.
const { app, net, nativeImage, dialog, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { promisify } = require('node:util');
const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);

const PLAYABLE = new Set(['.mp3', '.m4a', '.aac', '.mp4', '.flac', '.ogg', '.oga', '.opus', '.wav', '.webm']);
// files a streaming service delivered encrypted for its own player: listed so the user knows why they do not play, and
// never decrypted (the app respects the platforms' licences and DRM)
const PROTECTED = new Set(['.ncm', '.mflac', '.mgg', '.mgg1', '.kgm', '.kgma', '.vpr', '.kwm', '.qmc0', '.qmc2', '.qmc3', '.qmcflac', '.qmcogg', '.tkm', '.bkcmp3', '.m4p', '.xm']);
const UA = () => `Cadenza/${app.getVersion()} (https://github.com/ahuai6/Cadenza)`;

const root = () => path.join(app.getPath('userData'), 'library');
const P = {
  db: () => path.join(root(), 'db.json'), covers: () => path.join(root(), 'covers'), thumbs: () => path.join(root(), 'thumbs'),
  analysis: () => path.join(root(), 'rhythm'), songs: () => path.join(root(), 'songs'),
};

let db = null, mm = null, send = () => {};
let want = 0;                      // the rhythm SDK version the page asks for (it tells us with each request)
const empty = () => ({ version: 1, folders: [], tracks: {}, favorites: [], playlists: [], overrides: {} });

// first start: take over the library of Lyric Motion (the app Cadenza replaces), if there is one: folders, favourites,
// playlists, the user's own tags and covers, and each song's bound style. Tracks are rescanned (ids come from the file
// contents, so they match); the old beat analysis is not reused, the rhythm SDK analyses again.
async function adopt() {
  const old = path.join(app.getPath('appData'), 'Lyric Motion', 'library');
  try {
    const o = JSON.parse(await fsp.readFile(path.join(old, 'db.json'), 'utf8'));
    db = { ...empty(), folders: o.folders || [], favorites: o.favorites || [], playlists: o.playlists || [], overrides: o.overrides || {} };
    for (const [d, to] of [['covers', P.covers()], ['thumbs', P.thumbs()], ['songs', P.songs()]]) {
      try { for (const f of await fsp.readdir(path.join(old, d))) await fsp.copyFile(path.join(old, d, f), path.join(to, f)); } catch (e) { /* not there */ }
    }
    return true;
  } catch (e) { return false; }
}
async function load() {
  for (const d of [root(), P.covers(), P.thumbs(), P.analysis(), P.songs()]) await fsp.mkdir(d, { recursive: true });
  try { db = { ...empty(), ...JSON.parse(await fsp.readFile(P.db(), 'utf8')) }; }
  catch (e) { db = empty(); if (!process.env.CADENZA_USER_DATA && await adopt()) save(); }
}
// written shortly after the last change, through a temporary file so a crash never leaves half a database
let saveTm = 0, saving = Promise.resolve();
function save() { clearTimeout(saveTm); saveTm = setTimeout(() => { saving = saving.then(async () => {
  const tmp = P.db() + '.tmp'; await fsp.writeFile(tmp, JSON.stringify(db)); await fsp.rename(tmp, P.db()); }).catch(() => {}); }, 400); }
let changeTm = 0;
function changed() { save(); clearTimeout(changeTm); changeTm = setTimeout(() => send('lib:changed', view()), 120); }

// what the page sees: tracks with the user's edits applied, no paths beyond the file name
function trackView(t) {
  const o = db.overrides[t.id] || {};
  return { id: t.id, file: path.basename(t.path), folder: path.basename(path.dirname(t.path)), title: o.title || t.title || path.parse(t.path).name,
    artist: o.artist || t.artist || '', album: o.album || t.album || '', albumArtist: o.albumArtist || t.albumArtist || '', genre: o.genre || t.genre || [],
    year: o.year || t.year || null, track: o.track || t.track || null, disc: o.disc || t.disc || null, duration: t.duration || 0, codec: t.codec || '', bitrate: t.bitrate || 0,
    sampleRate: t.sampleRate || 0, bits: t.bits || 0, lossless: !!t.lossless, ext: path.extname(t.path).slice(1).toLowerCase(), composer: t.composer || '', lyricist: t.lyricist || '',
    cover: o.coverKey || t.coverKey || null, lrc: !!t.lrc, embedded: !!t.embedded, protected: !!t.protected, analyzed: t.analyzed || 0,
    added: t.added, plays: t.plays || 0, last: t.last || 0, looked: !!o.mbid, edited: Object.keys(o).some(k => k !== 'coverKey' && k !== 'instrumental'), coverSet: !!o.coverKey, instrumental: !!o.instrumental, loudness: t.loudness || null,
    // what the file itself says, for the edit form's placeholders and per-field reset
    tags: { title: t.title || path.parse(t.path).name, artist: t.artist || '', album: t.album || '', albumArtist: t.albumArtist || '', year: t.year || null, genre: t.genre || [], track: t.track || null, disc: t.disc || null } };
}
function view() {
  return { folders: db.folders.slice(), tracks: Object.values(db.tracks).map(trackView), favorites: db.favorites.slice(),
    playlists: db.playlists.map(p => ({ ...p, tracks: p.tracks.slice() })) };
}

/* ---------- identity: the same recording keeps its id when moved or renamed ---------- */
async function fileId(p, size) {
  const fh = await fsp.open(p, 'r'); const h = crypto.createHash('sha1'); h.update(String(size));
  try { const n = Math.min(65536, size), a = Buffer.alloc(n); await fh.read(a, 0, n, 0); h.update(a);
    if (size > n) { const b = Buffer.alloc(n); await fh.read(b, 0, n, Math.max(0, size - n)); h.update(b); } }
  finally { await fh.close(); }
  return h.digest('hex').slice(0, 20);
}
const sidecar = p => { const b = p.slice(0, -path.extname(p).length); for (const e of ['.lrc', '.LRC', '.Lrc']) if (fs.existsSync(b + e)) return b + e; return null; };

/* ---------- covers: kept once per image, with a small copy for grids ---------- */
async function storeCover(data) {
  if (!data || !data.length) return null;
  const key = crypto.createHash('sha1').update(data).digest('hex').slice(0, 20), full = path.join(P.covers(), key + '.img'), th = path.join(P.thumbs(), key + '.jpg');
  if (!fs.existsSync(full)) await fsp.writeFile(full, data);
  if (!fs.existsSync(th)) { try { const img = nativeImage.createFromBuffer(Buffer.from(data)); if (!img.isEmpty()) { const s = img.getSize(), w = Math.min(420, s.width);
    await fsp.writeFile(th, img.resize({ width: w, height: Math.round(s.height * w / s.width), quality: 'best' }).toJPEG(86)); } } catch (e) { /* the full image still serves */ } }
  return key;
}

/* ---------- scanning ---------- */
async function walk(dir, out, depth = 0) {
  if (depth > 24) return; let ents = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) { if (e.name.startsWith('.')) continue; const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else { const x = path.extname(e.name).toLowerCase(); if (PLAYABLE.has(x) || PROTECTED.has(x)) out.push(p); } }
}
const TAGS_V = 2;       // what readTags reads; files read by an older version are read again once
async function readTags(p) {
  mm ||= await import('music-metadata');
  const r = await mm.parseFile(p, { duration: false, skipCovers: false });
  const c = r.common, f = r.format, pic = c.picture && c.picture[0];
  return { title: c.title || '', artist: c.artist || (c.artists || []).join(', '), album: c.album || '', albumArtist: c.albumartist || '', genre: c.genre || [],
    year: c.year || null, track: c.track && c.track.no || null, disc: c.disk && c.disk.no || null, duration: f.duration || 0, codec: f.codec || f.container || '',
    bitrate: f.bitrate || 0, cover: pic ? pic.data : null, embedded: !!(c.lyrics && c.lyrics.length),
    // the sound itself (for the quality label) and the credits (for the ending card)
    sampleRate: f.sampleRate || 0, bits: f.bitsPerSample || 0, lossless: !!f.lossless, composer: (c.composer || []).join(', '), lyricist: (c.lyricist || []).join(', '), tv: TAGS_V };
}
let scanning = false, rescan = false;
async function scan() {
  if (scanning) { rescan = true; return; } scanning = true;
  try { do { rescan = false;
    const files = []; for (const d of db.folders) await walk(d, files);
    const seen = new Set(files), byPath = new Map(Object.values(db.tracks).map(t => [t.path, t]));
    let done = 0; send('lib:progress', { phase: 'scan', done, total: files.length });
    const queue = files.slice(), work = async () => { for (let p; (p = queue.shift());) {
      try { const st = await fsp.stat(p), old = byPath.get(p);
        if (old && old.size === st.size && old.mtime === st.mtimeMs) { old.lrc = !!sidecar(p);
          if (!old.protected && old.tv !== TAGS_V) { const tg = await readTags(p).catch(() => null); if (tg) { delete tg.cover; Object.assign(old, tg); } } }
        else {
          const id = await fileId(p, st.size), x = path.extname(p).toLowerCase(), prev = db.tracks[id];
          const base = { id, path: p, size: st.size, mtime: st.mtimeMs, added: prev?.added || Date.now(), plays: prev?.plays || 0, last: prev?.last || 0, lrc: !!sidecar(p), failed: false };
          if (PROTECTED.has(x)) db.tracks[id] = { ...base, title: path.parse(p).name, protected: true };
          else { const tg = await readTags(p).catch(() => ({})); const coverKey = await storeCover(tg.cover).catch(() => null); delete tg.cover;
            db.tracks[id] = { ...prev, ...base, ...tg, coverKey, protected: false, analyzed: prev?.analyzed && prev.size === st.size ? prev.analyzed : 0 }; }
          if (old && old.id !== id) delete db.tracks[old.id];
        } } catch (e) { /* unreadable file: skipped this time */ }
      done++; if (done % 8 === 0 || done === files.length) send('lib:progress', { phase: 'scan', done, total: files.length }); } };
    await Promise.all([work(), work(), work(), work()]);
    for (const t of Object.values(db.tracks)) if (!seen.has(t.path)) delete db.tracks[t.id];        // gone from disk (or its folder was removed)
    const live = new Set(Object.keys(db.tracks));
    db.favorites = db.favorites.filter(id => live.has(id)); for (const pl of db.playlists) pl.tracks = pl.tracks.filter(id => live.has(id));
    changed(); send('lib:progress', { phase: 'idle', done: files.length, total: files.length }); send('lib:wake');
  } while (rescan); } finally { scanning = false; }
}

/* ---------- watching: a folder that changes is rescanned a moment later ---------- */
const watchers = new Map(); let watchTm = 0;
function watchAll() {
  for (const [d, w] of watchers) if (!db.folders.includes(d)) { w.close(); watchers.delete(d); }
  for (const d of db.folders) if (!watchers.has(d)) { try { watchers.set(d, fs.watch(d, { recursive: true }, () => { clearTimeout(watchTm); watchTm = setTimeout(scan, 1500); })); } catch (e) { /* not watchable */ } }
}

/* ---------- the rhythm cache: RhythmAnalysis JSON per song, compressed ---------- */
const anFile = id => path.join(P.analysis(), id.replace(/[^a-f0-9]/g, '') + '.json.gz');
async function saveAnalysis(id, a) {
  const t = db.tracks[id]; if (!t || !a || typeof a.version !== 'number' || !Array.isArray(a.beats)) return false;
  await fsp.writeFile(anFile(id), await gzip(Buffer.from(JSON.stringify(a)), { level: 6 }));
  if (!want) want = a.version;      // (a song saved before the page's first request for the queue says which version is wanted)
  t.analyzed = a.version; t.failed = false; if (a.duration && !t.duration) t.duration = a.duration; if (a.loudness) setLoud(t, a.loudness); save(); analysisProgress(); return true;
}
async function getAnalysis(id, version) {
  try { const a = JSON.parse((await gunzip(await fsp.readFile(anFile(id)))).toString()); return version == null || a.version === version ? a : null; } catch (e) { return null; }
}
// progress of the background analysis, as a small event: a large library is not re-sent to the page after every song
let apTm = 0;
function analysisProgress() { clearTimeout(apTm); apTm = setTimeout(() => {
  const all = Object.values(db.tracks).filter(t => !t.protected && !t.failed), done = all.filter(t => t.analyzed === want).length;
  send('lib:analysis', { done, total: all.length }); if (done === all.length) changed(); }, 150); }
// a song's loudness (the volume balance), kept with the track: small, and the player needs it before the analysis
const setLoud = (t, l) => { if (l && isFinite(l.lufs) && isFinite(l.peak)) t.loudness = { lufs: +(+l.lufs).toFixed(2), peak: +(+l.peak).toFixed(4) }; };
function saveLoudness(id, l) { const t = db.tracks[id]; if (!t) return false; if (l) setLoud(t, l); else t.loudFailed = true; save(); changed(); return true; }
// the queue: songs the player asked for first, then the most recently played and added; once every song is analysed,
// the songs analysed before the volume balance have only their loudness measured (no full analysis again)
let priority = [];
function nextJob(version) {
  if (version) want = version;
  const pick = id => { const t = db.tracks[id]; return t && !t.protected && t.analyzed !== want && !t.failed ? t : null; };
  const loudPick = id => { const t = db.tracks[id]; return t && !t.protected && t.analyzed === want && !t.loudness && !t.loudFailed ? t : null; };
  while (priority.length) { const id = priority.shift(), t = pick(id); if (t) return { id: t.id }; const u = loudPick(id); if (u) return { id: u.id, only: 'loudness' }; }
  const byRecent = (a, b) => (b.last - a.last) || (b.added - a.added);
  const t = Object.values(db.tracks).filter(x => pick(x.id)).sort(byRecent)[0];
  if (t) return { id: t.id };
  const u = Object.values(db.tracks).filter(x => loudPick(x.id)).sort(byRecent)[0];
  return u ? { id: u.id, only: 'loudness' } : null;
}

/* ---------- per-song data: the lyric style bound to this song, lock, MV, timing ---------- */
const songFile = id => path.join(P.songs(), id.replace(/[^a-f0-9]/g, '') + '.json');
async function getSong(id) { try { return JSON.parse(await fsp.readFile(songFile(id), 'utf8')); } catch (e) { return null; } }
// the page may change everything here except which video file is bound as the MV: that only comes from the open dialog
async function setSong(id, data, fromDialog) {
  if (!db.tracks[id] || !data || typeof data !== 'object') return false;
  if (!fromDialog) { const old = await getSong(id); data = { ...data, mv: !data.unbind && old && old.mv ? { ...old.mv, offset: +(data.mv && data.mv.offset) || 0 } : null }; delete data.unbind; }
  await fsp.writeFile(songFile(id), JSON.stringify(data)); return true;
}

/* ---------- lyrics: the .lrc beside the audio file, or the lyrics embedded in it ---------- */
async function readLyrics(id) {
  const t = db.tracks[id]; if (!t) return null; const sc = sidecar(t.path);
  if (sc) { const b = await fsp.readFile(sc); return { source: 'lrc', text: decodeText(b) }; }
  if (t.embedded) { try { mm ||= await import('music-metadata'); const r = await mm.parseFile(t.path, { skipCovers: true }); const L = (r.common.lyrics || [])[0];
    if (L) { const txt = L.syncText && L.syncText.length ? L.syncText.map(s => `[${lrcTime((s.timestamp || 0) / 1000)}]${s.text}`).join('\n') : (L.text || ''); if (txt.trim()) return { source: 'embedded', text: txt }; } } catch (e) { /* unreadable tags */ } }
  return null;
}
async function writeLyrics(id, text) {
  const t = db.tracks[id]; if (!t || t.protected) return false;
  const p = sidecar(t.path) || t.path.slice(0, -path.extname(t.path).length) + '.lrc';
  await fsp.writeFile(p, '\ufeff' + String(text).replace(/\r?\n/g, '\r\n'), 'utf8'); t.lrc = true; changed(); return true;
}
// .lrc files come in UTF-8 (with or without a BOM), UTF-16, or GBK/Big5 from older tools
function decodeText(b) {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const u = new TextDecoder('utf-8', { fatal: false }).decode(b); if (!u.includes('\ufffd')) return u.replace(/^\ufeff/, '');
  for (const enc of ['gb18030', 'big5']) { try { const s = new TextDecoder(enc).decode(b); if (!s.includes('\ufffd')) return s; } catch (e) { /* not supported */ } }
  return u;
}
const lrcTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;

/* ---------- online: lyrics from LRCLIB, tags from MusicBrainz, covers from iTunes / Cover Art Archive ---------- */
// one request, with a time limit; network errors, timeouts and busy answers (5xx, 429) are tried again after a pause
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, { tries = 3, timeout = 12000 } = {}) {
  let last = null;
  for (let k = 0; k < tries; k++) {
    if (k) await sleep(700 * k);
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await net.fetch(url, { headers: { 'User-Agent': UA(), Accept: 'application/json' }, signal: ac.signal });
      if (r.ok) return await r.json();
      last = Object.assign(new Error('http ' + r.status), { status: r.status });
      if (r.status < 500 && r.status !== 429) throw last;              // a real answer (not found, bad request): final
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 429) throw e;
      last = ac.signal.aborted ? Object.assign(new Error('timeout'), { kind: 'timeout' }) : e;
    } finally { clearTimeout(tm); }
  }
  throw last;
}
// lyrics: the exact match first, then a search by title and artist, then a free-text search; results merged, synced
// lyrics and the closest length first
async function searchLyrics(q) {
  const seen = new Map(); let err = null;
  const add = list => { for (const x of [].concat(list || [])) if (x && x.id && !seen.has(x.id)) seen.set(x.id, x); };
  const tryGet = async u => { try { add(await getJSON(u.toString())); } catch (e) { if (e.status !== 404) err = e; } };
  if (q.title && q.artist && q.album && q.duration) {
    const u = new URL('https://lrclib.net/api/get');
    u.searchParams.set('track_name', q.title); u.searchParams.set('artist_name', q.artist); u.searchParams.set('album_name', q.album); u.searchParams.set('duration', Math.round(+q.duration));
    await tryGet(u);
  }
  if (q.title) { const u = new URL('https://lrclib.net/api/search'); u.searchParams.set('track_name', q.title); if (q.artist) u.searchParams.set('artist_name', q.artist); await tryGet(u); }
  if (seen.size < 3) { const u = new URL('https://lrclib.net/api/search'); u.searchParams.set('q', [q.title, q.artist].filter(Boolean).join(' ') || q.q || ''); if (u.searchParams.get('q')) await tryGet(u); }
  if (!seen.size && err) throw err;
  const d = +q.duration || 0;
  return [...seen.values()].map(x => ({ id: x.id, title: x.trackName, artist: x.artistName, album: x.albumName, duration: x.duration, synced: x.syncedLyrics || '', plain: x.plainLyrics || '', instrumental: !!x.instrumental }))
    .sort((a, b) => (!!b.synced - !!a.synced) || (d ? Math.abs(a.duration - d) - Math.abs(b.duration - d) : 0)).slice(0, 20);
}
// MusicBrainz asks for at most one request a second from each application
let mbLast = 0;
async function mb(url) { for (let k = 0; k < 4; k++) { const w = mbLast + 1100 - Date.now(); if (w > 0) await sleep(w); mbLast = Date.now();
  try { return await getJSON(url, { tries: 1 }); } catch (e) { if (e.status !== 503 && e.status !== 429) throw e; await sleep(1500 * (k + 1)); } } throw new Error('busy'); }
const esc = s => String(s).replace(/(["\\])/g, '\\$1');
async function searchMeta(q) {
  const parts = []; if (q.title) parts.push(`recording:"${esc(q.title)}"`); if (q.artist) parts.push(`artist:"${esc(q.artist)}"`); if (q.album) parts.push(`release:"${esc(q.album)}"`);
  const r = await mb(`https://musicbrainz.org/ws/2/recording?fmt=json&limit=12&query=${encodeURIComponent(parts.join(' AND ') || q.q || '')}`);
  return (r.recordings || []).map(x => { const rel = (x.releases || [])[0] || {};
    return { mbid: x.id, title: x.title, artist: (x['artist-credit'] || []).map(a => a.name + (a.joinphrase || '')).join(''), album: rel.title || '', release: rel.id || null,
      year: (rel.date || x['first-release-date'] || '').slice(0, 4) || null, duration: x.length ? x.length / 1000 : null, score: x.score,
      genre: (x.tags || []).sort((a, b) => b.count - a.count).slice(0, 3).map(t => t.name) }; });
}
// apply a chosen match: its tags as an override in the library (the audio file is never rewritten)
async function applyMeta(id, m) {
  const t = db.tracks[id]; if (!t) return false; const o = { ...(db.overrides[id] || {}) };
  for (const k of ['title', 'artist', 'album', 'year']) if (m[k]) o[k] = m[k];
  if (m.genre && m.genre.length) o.genre = m.genre; o.mbid = m.mbid;
  if (m.mbid) { try { const g = await mb(`https://musicbrainz.org/ws/2/recording/${m.mbid}?fmt=json&inc=genres`); if (g.genres && g.genres.length) o.genre = g.genres.sort((a, b) => b.count - a.count).slice(0, 3).map(x => x.name); } catch (e) { /* tags without genres */ } }
  db.overrides[id] = o; changed(); return true;
}
// the user's own edits: a field left empty goes back to what the file says
const EDITABLE = ['title', 'artist', 'album', 'albumArtist', 'year', 'genre', 'track', 'disc'];
function editMeta(id, f) {
  const t = db.tracks[id]; if (!t || !f) return false; const o = { ...(db.overrides[id] || {}) };
  for (const k of EDITABLE) { if (!(k in f)) continue; let v = f[k];
    if (k === 'genre') v = [].concat(typeof v === 'string' ? v.split(/\s*[,;，、]\s*/) : v || []).map(x => String(x).trim()).filter(Boolean).slice(0, 6);
    else if (k === 'year' || k === 'track' || k === 'disc') { v = parseInt(v, 10); v = isFinite(v) && v > 0 ? v : null; }
    else v = String(v ?? '').trim().slice(0, 300);
    const none = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (none) delete o[k]; else o[k] = v; }
  delete o.mbid;
  db.overrides[id] = o; changed(); return true;
}
// covers, searched on their own; thumbnails are fetched here and handed to the page as data, so the page never loads
// anything from the network itself
const COVER_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(mzstatic\.com|coverartarchive\.org|archive\.org)\//i;
async function fetchImage(url, timeout = 10000) {
  if (!COVER_HOSTS.test(url)) throw new Error('host');
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), timeout);
  try { const r = await net.fetch(url, { headers: { 'User-Agent': UA() }, signal: ac.signal }); if (!r.ok) throw Object.assign(new Error('http ' + r.status), { status: r.status });
    const type = r.headers.get('content-type') || 'image/jpeg'; if (!/^image\//.test(type)) throw new Error('type'); return { data: Buffer.from(await r.arrayBuffer()), type }; }
  finally { clearTimeout(tm); }
}
async function searchCovers(q) {
  const term = [q.album || q.title, q.artist].filter(Boolean).join(' ').trim(); if (!term) return [];
  const out = [];
  // iTunes answers per storefront and turns busy clients away (403) for a moment: a few storefronts in turn, with a pause
  const itunes = (async () => {
    let r = null;
    for (const [i, c] of [(q.country || 'TW'), 'HK', 'US'].entries()) {
      if (i) await sleep(500);
      const u = new URL('https://itunes.apple.com/search'); u.searchParams.set('term', term); u.searchParams.set('entity', 'album'); u.searchParams.set('limit', '12'); u.searchParams.set('country', c);
      try { r = await getJSON(u.toString(), { tries: 1 }); } catch (e) { if (e.status === 403) { await sleep(900); try { r = await getJSON(u.toString(), { tries: 1 }); } catch (e2) { r = null; } } }
      if (r && r.results && r.results.length) break;
    }
    for (const x of (r && r.results) || []) if (x.artworkUrl100) out.push({ src: 'itunes', title: x.collectionName, artist: x.artistName, year: (x.releaseDate || '').slice(0, 4) || null,
      thumb: x.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x300bb.'), full: x.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1200x1200bb.') });
  })().catch(() => {});
  const caa = (async () => {
    const parts = []; if (q.album || q.title) parts.push(`releasegroup:"${esc(q.album || q.title)}"`); if (q.artist) parts.push(`artist:"${esc(q.artist)}"`);
    const r = await mb(`https://musicbrainz.org/ws/2/release-group?fmt=json&limit=8&query=${encodeURIComponent(parts.join(' AND '))}`);
    for (const g of r['release-groups'] || []) out.push({ src: 'caa', title: g.title, artist: (g['artist-credit'] || []).map(a => a.name + (a.joinphrase || '')).join(''), year: (g['first-release-date'] || '').slice(0, 4) || null,
      thumb: `https://coverartarchive.org/release-group/${g.id}/front-250`, full: `https://coverartarchive.org/release-group/${g.id}/front-1200` });
  })().catch(() => {});
  await Promise.all([itunes, caa]);
  const got = await Promise.all(out.map(async c => { try { const im = await fetchImage(c.thumb, 9000); return { ...c, thumb: `data:${im.type};base64,${im.data.toString('base64')}` }; } catch (e) { return null; } }));
  return got.filter(Boolean).slice(0, 24);
}
// set a song's cover: a chosen search result, an image file the user picks, or back to the file's own
async function setCover(id, how, getWin) {
  const t = db.tracks[id]; if (!t) return false; const o = { ...(db.overrides[id] || {}) };
  if (how && how.reset) delete o.coverKey;
  else if (how && how.url) { const im = await fetchImage(how.url, 20000).catch(async e => { if (/front-1200$/.test(how.url)) return fetchImage(how.url.replace(/front-1200$/, 'front'), 20000); throw e; }); o.coverKey = await storeCover(im.data); }
  else if (how && how.file) {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] });
    if (r.canceled || !r.filePaths[0]) return false; o.coverKey = await storeCover(await fsp.readFile(r.filePaths[0]));
  } else return false;
  if (!o.coverKey) delete o.coverKey;
  db.overrides[id] = o; changed(); return true;
}
// an instrumental: shown with its own line instead of lyrics, in the record theme unless the song has its own look
function setInstrumental(id, on) {
  if (!db.tracks[id]) return false; const o = { ...(db.overrides[id] || {}) };
  if (on) o.instrumental = true; else delete o.instrumental;
  if (Object.keys(o).length) db.overrides[id] = o; else delete db.overrides[id]; changed(); return true;
}
// back to what the file says: its tags, its cover, or both
function resetMeta(id, part) {
  const o = { ...(db.overrides[id] || {}) };
  // (marking a song as an instrumental is not one of its tags: resetting them keeps it)
  if (part === 'cover') delete o.coverKey; else if (part === 'tags') { for (const k of Object.keys(o)) if (k !== 'coverKey' && k !== 'instrumental') delete o[k]; } else for (const k of Object.keys(o)) if (k !== 'instrumental') delete o[k];
  if (Object.keys(o).length) db.overrides[id] = o; else delete db.overrides[id]; changed(); return true;
}

/* ---------- cadenza:// — covers, thumbnails, audio and a song's MV, streamed with byte ranges so video can seek ---------- */
async function serveFile(p, req, type) {
  const st = await fsp.stat(p), size = st.size, range = req.headers.get('range'), h = { 'Accept-Ranges': 'bytes', 'Content-Type': type, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' };   /* the canvas stays exportable */
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) { let a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : size - 1; if (!m[1] && m[2]) { a = Math.max(0, size - +m[2]); b = size - 1; } b = Math.min(b, size - 1);
    return new Response(Readable.toWeb(fs.createReadStream(p, { start: a, end: b })), { status: 206, headers: { ...h, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(b - a + 1) } }); }
  return new Response(Readable.toWeb(fs.createReadStream(p)), { status: 200, headers: { ...h, 'Content-Length': String(size) } });
}
const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.mp4': 'video/mp4', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.m4v': 'video/mp4' };
const MODEL_FILES = new Set(['beat_this-wgsl.bin', 'htdemucs-wgsl.bin']);
const modelDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, '..', 'models'));
function registerProtocol() {
  protocol.handle('cadenza', async req => {
    try { const u = new URL(req.url), [kind, raw] = [u.hostname, decodeURIComponent(u.pathname.slice(1))], key = raw.replace(/[^a-f0-9]/g, '');
      if (kind === 'thumb' || kind === 'cover') { const p = kind === 'thumb' ? path.join(P.thumbs(), key + '.jpg') : path.join(P.covers(), key + '.img');
        if (kind === 'thumb' && !fs.existsSync(p)) return serveFile(path.join(P.covers(), key + '.img'), req, 'image/jpeg');
        return serveFile(p, req, kind === 'thumb' ? 'image/jpeg' : 'image/*'); }
      if (kind === 'media') { const t = db.tracks[key]; if (!t || t.protected) return new Response('', { status: 404 }); return serveFile(t.path, req, MIME[path.extname(t.path).toLowerCase()] || 'application/octet-stream'); }
      // the neural rhythm engine's weights (shipped as resources/models; in a checkout, models/ from scripts/models.mjs):
      // only the files the engine names, nothing else on disk
      if (kind === 'model') { const f = path.basename(raw); if (!MODEL_FILES.has(f)) return new Response('', { status: 404 });
        const p = path.join(modelDir(), f); if (!fs.existsSync(p)) return new Response('', { status: 404 });
        if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Length': String(fs.statSync(p).size), 'Access-Control-Allow-Origin': '*' } });
        return serveFile(p, req, 'application/octet-stream'); }
      if (kind === 'mv') { const s = await getSong(key); if (!s || !s.mv || !s.mv.path || !fs.existsSync(s.mv.path)) return new Response('', { status: 404 });
        return serveFile(s.mv.path, req, MIME[path.extname(s.mv.path).toLowerCase()] || 'video/mp4'); }
    } catch (e) { /* fall through */ }
    return new Response('', { status: 404 });
  });
}

/* ---------- the page's requests ---------- */
function register(ipcMain, getWin) {
  send = (ch, data) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
  ipcMain.handle('lib:get', () => view());
  ipcMain.handle('lib:addFolder', async () => { const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled) return view(); for (const d of r.filePaths) if (!db.folders.includes(d)) db.folders.push(d); changed(); watchAll(); scan(); return view(); });
  ipcMain.handle('lib:removeFolder', async (_e, d) => { db.folders = db.folders.filter(x => x !== d); watchAll(); await scan(); return view(); });
  ipcMain.handle('lib:rescan', () => { scan(); return true; });
  ipcMain.handle('lib:favorite', (_e, id, on) => { db.favorites = db.favorites.filter(x => x !== id); if (on && db.tracks[id]) db.favorites.unshift(id); changed(); return true; });
  ipcMain.handle('lib:playlist', (_e, op, a, b) => {
    if (op === 'create') { const p = { id: 'p' + Date.now().toString(36), name: String(a || '').slice(0, 80) || 'Playlist', created: Date.now(), tracks: (b || []).filter(id => db.tracks[id]) }; db.playlists.push(p); changed(); return p.id; }
    const p = db.playlists.find(x => x.id === a); if (!p) return false;
    if (op === 'rename') p.name = String(b || '').slice(0, 80) || p.name;
    else if (op === 'delete') db.playlists = db.playlists.filter(x => x !== p);
    else if (op === 'add') { for (const id of [].concat(b)) if (db.tracks[id] && !p.tracks.includes(id)) p.tracks.push(id); }
    else if (op === 'remove') p.tracks = p.tracks.filter(id => ![].concat(b).includes(id));
    else if (op === 'order') p.tracks = [].concat(b).filter(id => p.tracks.includes(id));
    changed(); return true; });
  ipcMain.handle('lib:played', (_e, id) => { const t = db.tracks[id]; if (t) { t.plays = (t.plays || 0) + 1; t.last = Date.now(); changed(); } });
  ipcMain.handle('lib:analysis', (_e, id, version) => getAnalysis(id, version));
  ipcMain.handle('lib:saveAnalysis', (_e, id, a) => saveAnalysis(id, a));
  ipcMain.handle('lib:saveLoudness', (_e, id, l) => saveLoudness(id, l));
  ipcMain.handle('lib:analysisFailed', (_e, id) => { const t = db.tracks[id]; if (t) { t.failed = true; save(); analysisProgress(); } });
  ipcMain.handle('lib:nextAnalysis', (_e, version) => nextJob(version));
  ipcMain.handle('lib:prioritize', (_e, ids) => { priority = [].concat(ids, priority).slice(0, 50); send('lib:wake'); });
  ipcMain.handle('lib:song', async (_e, id) => { const s = await getSong(id); if (s && s.mv) s.mv = { name: s.mv.name, offset: s.mv.offset || 0 }; return s; });
  ipcMain.handle('lib:setSong', (_e, id, d) => setSong(id, d));
  ipcMain.handle('lib:lyrics', (_e, id) => readLyrics(id));
  ipcMain.handle('lib:writeLyrics', (_e, id, text) => writeLyrics(id, text));
  ipcMain.handle('lib:searchLyrics', (_e, q) => searchLyrics(q));
  ipcMain.handle('lib:searchMeta', (_e, q) => searchMeta(q));
  ipcMain.handle('lib:applyMeta', (_e, id, m) => applyMeta(id, m));
  ipcMain.handle('lib:clearMeta', (_e, id, part) => resetMeta(id, part));
  ipcMain.handle('lib:instrumental', (_e, id, on) => setInstrumental(id, !!on));
  ipcMain.handle('lib:editMeta', (_e, id, f) => editMeta(id, f));
  ipcMain.handle('lib:searchCovers', (_e, q) => searchCovers(q || {}));
  ipcMain.handle('lib:setCover', (_e, id, how) => setCover(id, how, getWin));
  ipcMain.handle('lib:bindMv', async (_e, id) => { if (!db.tracks[id]) return null;
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'm4v', 'webm', 'mov', 'mkv'] }] });
    if (r.canceled || !r.filePaths[0]) return null; const s = (await getSong(id)) || {}; s.mv = { path: r.filePaths[0], name: path.basename(r.filePaths[0]), offset: s.mv?.offset || 0 };
    await setSong(id, s, true); return { name: s.mv.name, offset: s.mv.offset }; });
  ipcMain.handle('lib:importLyricsFile', async () => { const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Lyrics', extensions: ['lrc', 'txt'] }] });
    if (r.canceled || !r.filePaths[0]) return null; return decodeText(await fsp.readFile(r.filePaths[0])); });
}

async function start(ipcMain, getWin, settings) {
  await load(); registerProtocol(); register(ipcMain, getWin); watchAll();
  if (settings.scanOnLaunch !== false) setTimeout(scan, 600);
}
// the file behind a playable track (for the Hi-Fi output, which reads files itself); never a protected one
const pathOf = id => { const t = db.tracks[id]; return t && !t.protected ? t.path : null; };
module.exports = { start, pathOf, scheme: { scheme: 'cadenza', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } } };
