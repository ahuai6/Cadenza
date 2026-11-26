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
const { serveFile } = require('./file-response.cjs');
const { serveAlac } = require('./alac.cjs');
const { binPath } = require('./audio.cjs');
const identity = require('./audio-identity.cjs');
const { openLibrary, replace, assertDirectory } = require('./library-storage.cjs');
const { manifest: mp4Manifest } = require('./mp4-integrity.cjs');
const { isDeepStrictEqual } = require('node:util');
const { promisify } = require('node:util');
const gzip = promisify(zlib.gzip),
  gunzip = promisify(zlib.gunzip);

const PLAYABLE = new Set(['.mp3', '.m4a', '.aac', '.mp4', '.flac', '.ogg', '.oga', '.opus', '.wav', '.webm']);
// files a streaming service delivered encrypted for its own player: listed so the user knows why they do not play, and
// never decrypted (the app respects the platforms' licences and DRM)
const PROTECTED = new Set([
  '.ncm',
  '.mflac',
  '.mgg',
  '.mgg1',
  '.kgm',
  '.kgma',
  '.vpr',
  '.kwm',
  '.qmc0',
  '.qmc2',
  '.qmc3',
  '.qmcflac',
  '.qmcogg',
  '.tkm',
  '.bkcmp3',
  '.m4p',
  '.xm',
]);
const UA = () => `Cadenza/${app.getVersion()} (https://github.com/ahuai6/Cadenza)`;

const root = () => path.join(app.getPath('userData'), 'library');
const P = {
  db: () => path.join(root(), 'db.json'),
  covers: () => path.join(root(), 'covers'),
  thumbs: () => path.join(root(), 'thumbs'),
  analysis: () => path.join(root(), 'rhythm-v2'),
  songs: () => path.join(root(), 'songs'),
};

let db = null,
  mm = null,
  send = () => {};
let want = 0; // the rhythm SDK version the page asks for (it tells us with each request)
let preferences = {};
const activeTrack = (id) => (Object.hasOwn(db.tracks, id) && !db.tracks[id].detached ? db.tracks[id] : null);

async function load() {
  for (const d of [root(), P.covers(), P.thumbs(), P.analysis(), P.songs()]) {
    await fsp.mkdir(d, { recursive: true });
    await assertDirectory(d);
  }
  db = await openLibrary(P.db());
  db.derived ??= {};
}

let saveTm = 0;
let saving = Promise.resolve();
function flush() {
  clearTimeout(saveTm);
  saveTm = 0;
  const body = JSON.stringify(db);
  saving = saving.catch(() => {}).then(() => replace(P.db(), body));
  return saving;
}
function save() {
  if (saveTm) return;
  saveTm = setTimeout(() => void flush().catch((error) => console.error('[library save]', error)), 400);
}
let changeTm = 0;
let wakeAfterView = false;
function changed(wake = false) {
  wakeAfterView ||= wake;
  save();
  if (!changeTm)
    changeTm = setTimeout(() => {
      changeTm = 0;
      send('lib:changed', view());
      if (wakeAfterView) {
        wakeAfterView = false;
        send('lib:wake');
      }
    }, 120);
}

// what the page sees: tracks with the user's edits applied, no paths beyond the file name
function trackView(t) {
  const o = db.overrides[t.id] || {};
  return {
    id: t.id,
    file: path.basename(t.path),
    folder: path.basename(path.dirname(t.path)),
    title: o.title || t.title || path.parse(t.path).name,
    artist: o.artist || t.artist || '',
    album: o.album || t.album || '',
    albumArtist: o.albumArtist || t.albumArtist || '',
    genre: o.genre || t.genre || [],
    year: o.year || t.year || null,
    date: t.date || '',
    copyright: t.copyright || '',
    isrc: t.isrc || [],
    upc: t.upc || '',
    track: o.track || t.track || null,
    disc: o.disc || t.disc || null,
    duration: t.duration || 0,
    codec: t.codec || '',
    bitrate: t.bitrate || 0,
    sampleRate: t.sampleRate || 0,
    channels: t.channels || 0,
    mediaRevision: mediaRevision(t),
    audioContentId: identity.validId(t.audioContentId) ? t.audioContentId : null,
    identityState: t.protected
      ? 'protected'
      : identity.validId(t.audioContentId)
        ? 'verified'
        : t.identityError
          ? 'unverified'
          : 'pending',
    metadataRevision: t.metadataRevision || 0,
    lyricsRevision: t.lyricsRevision || 0,
    bits: t.bits || 0,
    lossless: !!t.lossless,
    ext: path.extname(t.path).slice(1).toLowerCase(),
    composer: t.composer || '',
    lyricist: t.lyricist || '',
    cover: o.coverKey || t.coverKey || null,
    lrc: !!t.lrc,
    embedded: !!t.embedded,
    ttml: !!(t.ttml || t.ttmlFile),
    protected: !!t.protected,
    analyzed: rhythmSummary(t)?.version || 0,
    added: t.added,
    plays: t.plays || 0,
    last: t.last || 0,
    looked: !!o.mbid,
    edited: Object.keys(o).some((k) => k !== 'coverKey' && k !== 'instrumental'),
    coverSet: !!o.coverKey,
    instrumental: !!o.instrumental,
    loudness: loudnessOf(t),
    // what the file itself says, for the edit form's placeholders and per-field reset
    tags: {
      title: t.title || path.parse(t.path).name,
      artist: t.artist || '',
      album: t.album || '',
      albumArtist: t.albumArtist || '',
      year: t.year || null,
      genre: t.genre || [],
      track: t.track || null,
      disc: t.disc || null,
    },
  };
}
function view() {
  return {
    folders: db.folders.slice(),
    tracks: Object.values(db.tracks)
      .filter((t) => !t.detached)
      .map(trackView),
    identityConflicts: Object.values(db.tracks)
      .filter((t) => t.detached)
      .map((t) => ({ id: t.id, file: path.basename(t.path), reason: t.detached })),
    favorites: db.favorites.slice(),
    playlists: db.playlists.map((p) => ({ ...p, tracks: p.tracks.slice() })),
  };
}

const ttmlSidecar = (p) => {
  const b = p.slice(0, -path.extname(p).length);
  for (const e of ['.ttml', '.TTML']) if (fs.existsSync(b + e)) return b + e;
  return null;
};
const sidecar = (p) => {
  const b = p.slice(0, -path.extname(p).length);
  for (const e of ['.lrc', '.LRC', '.Lrc']) if (fs.existsSync(b + e)) return b + e;
  return null;
};

/* ---------- covers: kept once per image, with a small copy for grids ---------- */
async function storeCover(data) {
  if (!data || !data.length) return null;
  const key = crypto.createHash('sha1').update(data).digest('hex').slice(0, 20),
    full = path.join(P.covers(), key + '.img'),
    th = path.join(P.thumbs(), key + '.jpg');
  if (!fs.existsSync(full)) await fsp.writeFile(full, data);
  if (!fs.existsSync(th)) {
    try {
      const img = nativeImage.createFromBuffer(Buffer.from(data));
      if (!img.isEmpty()) {
        const s = img.getSize(),
          w = Math.min(420, s.width);
        await fsp.writeFile(
          th,
          img.resize({ width: w, height: Math.round((s.height * w) / s.width), quality: 'best' }).toJPEG(86),
        );
      }
    } catch (e) {
      /* the full image still serves */
    }
  }
  return key;
}

/* ---------- scanning ---------- */
const containsPath = (dir, file) => {
  const relative = path.relative(dir, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const identityIssues = new Set();
const scanCounters = { directories: 0, tags: 0, fingerprints: 0, analyses: 0, cacheHits: 0 };
async function walk(dir, out, unavailable, depth = 0) {
  if (depth > 24) {
    unavailable.add(dir);
    return;
  }
  scanCounters.directories++;
  let ents = [];
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT' || db.folders.includes(dir)) unavailable.add(dir);
    return;
  }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, unavailable, depth + 1);
    else {
      const x = path.extname(e.name).toLowerCase();
      if (PLAYABLE.has(x) || PROTECTED.has(x)) out.push(p);
    }
  }
}
const TAGS_V = 5; // re-read metadata in place without changing song IDs or the profile generation
const alac = (codec) => /^alac$/i.test(codec || '');
const mp4Audio = (p) => /\.(m4a|mp4)$/i.test(p);
const isTtmlText = (text) =>
  typeof text === 'string' && /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<tt[\s>]/i.test(text);
function embeddedText(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value && typeof value === 'object')
    return value.text ?? value.value ?? (Array.isArray(value) ? value.join('') : '');
  return value;
}
function mp4LyricOf(native) {
  const value = embeddedText(native?.iTunes?.find((tag) => tag.id === '©lyr')?.value);
  return typeof value === 'string' ? value : null;
}
function ttmlOf(native) {
  const lyric = mp4LyricOf(native);
  if (isTtmlText(lyric)) return lyric;
  for (const tag of Object.values(native || {}).flat()) {
    if (!/(^|[:\s])TTML$/i.test(tag.id || '')) continue;
    const text = embeddedText(tag.value);
    if (isTtmlText(text)) return text;
  }
  return null;
}
async function readTags(p) {
  scanCounters.tags++;
  mm ||= await import('music-metadata');
  const r = await mm.parseFile(p, { duration: false, skipCovers: false });
  const c = r.common,
    f = r.format,
    pic = c.picture && c.picture[0];
  return {
    title: c.title || '',
    artist: c.artist || (c.artists || []).join(', '),
    album: c.album || '',
    albumArtist: c.albumartist || '',
    genre: c.genre || [],
    year: c.year || null,
    date: c.date || '',
    copyright: c.copyright || '',
    isrc: c.isrc || [],
    upc: String(
      Object.values(r.native)
        .flat()
        .find((tag) => /(^|:)UPC$/i.test(tag.id))?.value ?? '',
    ),
    track: (c.track && c.track.no) || null,
    disc: (c.disk && c.disk.no) || null,
    duration: f.duration || 0,
    codec: f.codec || f.container || '',
    bitrate: f.bitrate || 0,
    cover: pic ? pic.data : null,
    tagLyric: digest(JSON.stringify([mp4LyricOf(r.native), ttmlOf(r.native), c.lyrics || []])),
    embedded: mp4LyricOf(r.native) !== null || !!c.lyrics?.length,
    ttml: !!ttmlOf(r.native),
    // the sound itself (for the quality label) and the credits (for the ending card)
    sampleRate: f.sampleRate || 0,
    channels: f.numberOfChannels || 0,
    bits: f.bitsPerSample || 0,
    lossless: !!f.lossless,
    composer: (c.composer || []).join(', '),
    lyricist: (c.lyricist || []).join(', '),
    tv: TAGS_V,
  };
}
// Pending discoveries need only one stat snapshot. Full verification runs separately from the scan and the player.
const pending = new Map();
const identityRetryDelays = [250, 1250];
let activeIdentity = null,
  identityTimer = null,
  indexing = false,
  stopping = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function queueIdentity(track, previous) {
  if (stopping || track.protected) return;
  const stamp = track.sourceStamp;
  identityIssues.delete(track.path);
  const queued = pending.get(track.path);
  if (queued?.stamp === stamp) return;
  if (activeIdentity?.track.path === track.path && activeIdentity.stamp === stamp) return;
  if (activeIdentity?.track.path === track.path) activeIdentity.controller.abort();
  pending.set(track.path, { track, previous, stamp, attempts: 0, readyAt: 0 });
}
async function indexAudio() {
  if (indexing) return;
  clearTimeout(identityTimer);
  identityTimer = null;
  indexing = true;
  try {
    while (!stopping && pending.size) {
      const first = pending.entries().next().value;
      const now = Date.now();
      let next = first;
      if (first[1].readyAt > now) {
        for (const candidate of pending) {
          if (candidate[1].readyAt < next[1].readyAt) next = candidate;
          if (next[1].readyAt <= now) break;
        }
      }
      const [file, entry] = next;
      if (entry.readyAt > now) {
        identityTimer = setTimeout(runIdentityIndex, entry.readyAt - now);
        break;
      }
      pending.delete(file);
      const { track, previous, stamp } = entry;
      const controller = new AbortController();
      activeIdentity = { track, controller, stamp };
      scanCounters.fingerprints++;
      sendProgress();
      let content;
      try {
        content = await identity.fingerprint(binPath(), file, stamp, controller.signal);
      } catch {
        // A corrupt or unsupported file can still use the ordinary output. It has no reusable analysis identity.
      }
      const current = await fsp.stat(file).catch(() => null);
      activeIdentity = null;
      if (
        stopping ||
        controller.signal.aborted ||
        pending.has(file) ||
        track.sourceStamp !== stamp ||
        (current && identity.revision(current) !== stamp)
      )
        continue;
      if ((!current || !content) && entry.attempts < identityRetryDelays.length) {
        entry.readyAt = Date.now() + identityRetryDelays[entry.attempts++];
        pending.set(file, entry);
        continue;
      }
      if (!current) {
        if (db.tracks[track.id] === track) track.identityError = true;
        else identityIssues.add(file);
        changed(true);
        continue;
      }
      if (previous) {
        if (
          db.tracks[previous.id] === previous &&
          previous.detached &&
          content &&
          content === previous.audioContentId
        ) {
          track.id = previous.id;
          track.added = previous.added;
          track.last = previous.last;
          track.plays = previous.plays;
          track.metadataRevision = (previous.metadataRevision || 0) + Number(!sameMetadata(track, previous));
          track.lyricsRevision =
            (previous.lyricsRevision || 0) +
            Number(track.sidecarStamp !== previous.sidecarStamp || track.tagLyric !== previous.tagLyric);
        }
      } else if (db.tracks[track.id] !== track || track.detached) continue;
      track.audioContentId = content;
      track.identityError = !content;
      db.tracks[track.id] = track;
      changed(true);
      await pause(40);
    }
  } finally {
    indexing = false;
    sendProgress();
  }
}

function runIdentityIndex() {
  void indexAudio().catch((error) => console.error('[audio identity]', error));
}

const metadataFields = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'genre',
  'year',
  'date',
  'copyright',
  'isrc',
  'upc',
  'track',
  'disc',
  'composer',
  'lyricist',
  'coverKey',
];
const sameMetadata = (a, b) => metadataFields.every((k) => isDeepStrictEqual(a[k], b[k]));

async function sidecars(track) {
  const files = [ttmlSidecar(track.path), sidecar(track.path)];
  const stamps = await Promise.all(
    files.map(async (file) => {
      const info = file && (await fsp.stat(file).catch(() => null));
      return info ? identity.revision(info) : '';
    }),
  );
  const current = stamps.join('|');
  if (track.sidecarStamp !== current) track.lyricsRevision = (track.lyricsRevision || 0) + 1;
  track.sidecarStamp = current;
  [track.ttmlFile, track.lrc] = files.map(Boolean);
}

let scanning = false,
  rescan = false,
  retryIdentity = false,
  fullScan = false;
const scanScopes = new Set();
let scanStatus = { phase: 'idle', done: 0, total: 0, unavailable: 0 };
function sendProgress() {
  send('lib:progress', { ...scanStatus, hashing: Number(!!activeIdentity), queued: pending.size });
}
async function scan(retryFailed = false, scopes) {
  if (stopping) return;
  retryIdentity ||= retryFailed;
  if (scopes) for (const scope of scopes) scanScopes.add(scope);
  else fullScan = true;
  if (scanning) {
    rescan = true;
    return;
  }
  scanning = true;
  try {
    do {
      rescan = false;
      const retry = retryIdentity;
      retryIdentity = false;
      const files = [];
      watchAll();
      const whole = fullScan;
      const roots = whole
        ? db.folders
        : [...scanScopes].filter((dir) => db.folders.some((root) => containsPath(root, dir)));
      fullScan = false;
      scanScopes.clear();
      const unique = roots.filter((dir) => !roots.some((root) => root !== dir && containsPath(root, dir)));
      const unavailable = new Set();
      scanStatus = { phase: 'scan', done: 0, total: 0, unavailable: 0 };
      sendProgress();
      for (const folder of unique) await walk(folder, files, unavailable);
      const missing = (file) =>
        (whole || unique.some((dir) => containsPath(dir, file))) &&
        ![...unavailable].some((dir) => containsPath(dir, file));
      const seen = new Set(files);
      const rows = Object.values(db.tracks);
      const byPath = new Map();
      const orphansByKey = new Map();
      for (const t of rows) {
        const prior = byPath.get(t.path);
        if (!prior || (prior.detached && !t.detached)) byPath.set(t.path, t);
        if (!seen.has(t.path) && missing(t.path)) t.detached ||= 'missing';
        if (t.detached === 'missing') {
          if (t.fileKey) {
            const matches = orphansByKey.get(t.fileKey) || [];
            matches.push(t);
            orphansByKey.set(t.fileKey, matches);
          }
        }
      }
      for (const file of pending.keys()) if (!seen.has(file) && missing(file)) pending.delete(file);
      for (const file of identityIssues) if (!seen.has(file) && missing(file)) identityIssues.delete(file);
      if (activeIdentity && !seen.has(activeIdentity.track.path) && missing(activeIdentity.track.path))
        activeIdentity.controller.abort();
      let done = 0;
      scanStatus = { phase: 'scan', done, total: seen.size, unavailable: unavailable.size };
      sendProgress();
      for (const file of seen) {
        if (stopping) return;
        try {
          const st = await fsp.stat(file);
          if (!st.isFile()) continue;
          const stamp = identity.revision(st),
            key = identity.fileKey(st);
          const matches = orphansByKey.get(key);
          const old = byPath.get(file) || (matches?.length === 1 ? matches[0] : null);
          const legacyUnchanged =
            old && !old.sourceStamp && old.path === file && old.size === st.size && old.mtime === st.mtimeMs;
          const unchanged = old && (old.sourceStamp === stamp || legacyUnchanged);
          if (unchanged) {
            Object.assign(old, { path: file, fileKey: key, sourceStamp: stamp, size: st.size, mtime: st.mtimeMs });
            delete old.detached;
            await sidecars(old);
            if (!old.protected && old.tv !== TAGS_V) {
              const tags = await readTags(file).catch(() => null);
              if (tags) {
                delete tags.cover;
                Object.assign(old, tags);
              }
            }
            if (!identity.validId(old.audioContentId) && (retry || !old.identityError)) queueIdentity(old);
          } else {
            // Keep an old entry and all its user data quarantined until bytes confirm a safe association.
            if (old) old.detached = old.path === file ? 'changed' : 'missing';
            if (
              pending.get(file)?.stamp === stamp ||
              (activeIdentity?.track.path === file && activeIdentity.stamp === stamp)
            )
              continue;
            const track = {
              id: crypto.randomBytes(16).toString('hex'),
              path: file,
              size: st.size,
              mtime: st.mtimeMs,
              fileKey: key,
              sourceStamp: stamp,
              added: Date.now(),
              plays: 0,
              last: 0,
              metadataRevision: (old?.metadataRevision || 0) + 1,
              lyricsRevision: (old?.lyricsRevision || 0) + 1,
              protected: PROTECTED.has(path.extname(file).toLowerCase()),
            };
            await sidecars(track);
            if (track.protected) {
              track.title = path.parse(file).name;
            } else {
              const tags = await readTags(file).catch(() => ({}));
              track.coverKey = await storeCover(tags.cover).catch(() => null);
              delete tags.cover;
              Object.assign(track, tags);
            }
            const previous = !track.protected && old && identity.validId(old.audioContentId) ? old : null;
            if (!previous) db.tracks[track.id] = track;
            queueIdentity(track, previous);
          }
        } catch {
          // An unreadable path can be reconsidered on the next scan.
        } finally {
          done++;
          scanStatus.done = done;
          if (done % 8 === 0) sendProgress();
          if (done % 32 === 0 && seen.size > 32) changed();
        }
      }
      changed(true);
      scanStatus.phase = 'idle';
      sendProgress();
      runIdentityIndex();
    } while (rescan);
  } finally {
    scanning = false;
  }
}

async function indexExisting() {
  for (const t of Object.values(db.tracks)) {
    if (t.protected || t.detached) continue;
    const st = await fsp.stat(t.path).catch(() => null);
    if (
      !st?.isFile() ||
      st.size !== t.size ||
      st.mtimeMs !== t.mtime ||
      (t.sourceStamp && t.sourceStamp !== identity.revision(st))
    ) {
      if (st?.isFile()) t.detached = 'changed';
      continue;
    }
    t.fileKey = identity.fileKey(st);
    t.sourceStamp = identity.revision(st);
    if (!identity.validId(t.audioContentId)) queueIdentity(t);
  }
  changed();
  await indexAudio();
}

/* ---------- watching: a folder that changes is rescanned a moment later ---------- */
const watchers = new Map();
let watchTm = 0;
const watchCandidates = new Set();
function watchChange(root, filename) {
  if (
    filename &&
    String(filename)
      .split(/[\\/]/)
      .some((part) => part.startsWith('.') || part.includes('.cadenza-backup-'))
  )
    return;
  const candidate = filename ? path.resolve(root, filename) : root;
  if (!containsPath(root, candidate)) return;
  watchCandidates.add(candidate);
  clearTimeout(watchTm);
  watchTm = setTimeout(() => {
    const candidates = [...watchCandidates];
    watchCandidates.clear();
    void scanWatched(candidates).catch((error) => console.error('[library watcher]', error));
  }, 1500);
}
async function scanWatched(candidates) {
  const scopes = new Set();
  for (const file of candidates) {
    const roots = db.folders;
    if (roots.includes(file)) {
      scopes.add(file);
      continue;
    }
    const extension = path.extname(file).toLowerCase();
    if (PLAYABLE.has(extension) || PROTECTED.has(extension) || extension === '.lrc' || extension === '.ttml') {
      scopes.add(path.dirname(file));
      continue;
    }
    const item = await fsp.lstat(file).catch(() => null);
    scopes.add(item?.isDirectory() ? file : path.dirname(file));
  }
  await scan(false, scopes);
}
function watchAll() {
  for (const [d, w] of watchers)
    if (!db.folders.includes(d)) {
      w.close();
      watchers.delete(d);
    }
  for (const d of db.folders)
    if (!watchers.has(d)) {
      try {
        const watcher = fs.watch(d, { recursive: true }, (_event, filename) => watchChange(d, filename));
        watcher.on('error', () => {
          watcher.close();
          if (watchers.get(d) === watcher) watchers.delete(d);
          watchChange(d);
        });
        watchers.set(d, watcher);
      } catch (e) {
        /* not watchable */
      }
    }
}

/* ---------- derived audio data, addressed by verified content and algorithm ---------- */
const loudnessVersion = 1;
const flavor = () => {
  const engine = ['neural', 'dsp'].includes(preferences.rhythmEngine) ? preferences.rhythmEngine : 'auto';
  return [
    engine,
    preferences.rhythmDrums === false ? 'nodrums' : 'drums',
    preferences.rhythmRuntime === 'webgpu' ? 'webgpu' : 'auto',
    preferences.rhythmDevice === 'cpu' ? 'cpu' : 'auto',
  ].join('-');
};
const summary = (t) => (identity.validId(t?.audioContentId) ? db.derived[t.audioContentId] : null);
const rhythmSummary = (t) => summary(t)?.rhythm?.[flavor()];
const loudnessOf = (t) => {
  const record = summary(t);
  const l = record?.loudness;
  return record?.loudnessVersion === loudnessVersion && Number.isFinite(l?.lufs) && Number.isFinite(l?.peak) ? l : null;
};
const contentRecord = (key) => (db.derived[key] ??= { rhythm: {} });
const analysisVersion = (n) => Number.isSafeInteger(n) && n > 0;
const analysisFlavor = (value) => /^(auto|dsp|neural)-(drums|nodrums)-(auto|webgpu)-(auto|cpu)$/.test(value);
const anFile = (key, settings, version) => {
  if (!identity.validId(key) || !analysisFlavor(settings) || !analysisVersion(version))
    throw new Error('invalid rhythm key');
  return path.join(P.analysis(), `${key.slice(-64)}-${settings}-${version}.json.gz`);
};
const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');

let cacheEpoch = 0,
  writes = Promise.resolve();
const trackEpoch = new Map();
function serialize(write) {
  const operation = writes.catch(() => {}).then(write);
  writes = operation;
  return operation;
}
function matchesToken(id, token) {
  const t = activeTrack(id);
  return (
    t &&
    token &&
    token.id === id &&
    identity.validId(t.audioContentId) &&
    token.content === t.audioContentId &&
    token.source === t.sourceStamp &&
    token.epoch === cacheEpoch &&
    token.revision === (trackEpoch.get(t.audioContentId) || 0) &&
    token.settings === flavor()
  );
}
async function currentSource(t) {
  if (!t || !t.sourceStamp) return false;
  const st = await fsp.stat(t.path).catch(() => null);
  return st?.isFile() && identity.revision(st) === t.sourceStamp;
}
async function analysisToken(id) {
  const t = activeTrack(id);
  if (!t || !identity.validId(t.audioContentId) || !(await currentSource(t)) || activeTrack(id) !== t) return null;
  return {
    id,
    content: t.audioContentId,
    source: t.sourceStamp,
    epoch: cacheEpoch,
    revision: trackEpoch.get(t.audioContentId) || 0,
    settings: flavor(),
  };
}
async function reanalyze(ids) {
  const contents = new Set();
  for (const id of ids) {
    const t = activeTrack(id);
    if (t && identity.validId(t.audioContentId)) contents.add(t.audioContentId);
  }
  for (const key of contents) trackEpoch.set(key, (trackEpoch.get(key) || 0) + 1);
  return serialize(async () => {
    for (const key of contents) {
      const record = db.derived[key];
      for (const [settings, row] of Object.entries(record?.rhythm || {}))
        if (analysisFlavor(settings) && analysisVersion(row?.version))
          await fsp.rm(anFile(key, settings, row.version), { force: true });
      if (record) record.rhythm = {};
    }
    for (const t of Object.values(db.tracks)) {
      if (!contents.has(t.audioContentId)) continue;
      delete t.failWhy;
      delete t.failed;
    }
    priority = [...ids.filter(activeTrack), ...priority.filter((id) => !ids.includes(id))];
    changed();
    analysisProgress();
    send('lib:wake');
    return true;
  });
}
async function clearDir(d) {
  try {
    await assertDirectory(d);
    for (const f of await fsp.readdir(d)) await fsp.rm(path.join(d, f), { force: true, recursive: true });
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
async function saveAnalysis(id, a, token) {
  if (!matchesToken(id, token) || !analysisVersion(a?.version) || !Array.isArray(a.beats) || a.partial) return false;
  const body = JSON.stringify(a);
  const envelope = JSON.stringify({
    key: token.content,
    settings: token.settings,
    version: a.version,
    sum: digest(body),
    body,
  });
  if (Buffer.byteLength(envelope) > 32 * 1024 * 1024) {
    await analysisFailed(id, 'rhythm cache size budget', token);
    return false;
  }
  const encoded = await gzip(Buffer.from(envelope), { level: 6 });
  return serialize(async () => {
    const valid = () => matchesToken(id, token);
    const t = activeTrack(id);
    if (!valid() || !(await currentSource(t)) || !valid()) return false;
    const file = anFile(token.content, token.settings, a.version);
    if (!(await replace(file, encoded, valid)) || !valid()) return false;
    const record = contentRecord(token.content);
    const prev = record.rhythm[token.settings];
    record.rhythm[token.settings] = { version: a.version, checked: false };
    if (analysisVersion(prev?.version) && prev.version !== a.version)
      await fsp.rm(anFile(token.content, token.settings, prev.version), { force: true });
    if (!want) want = a.version;
    if (a.duration && !t.duration) t.duration = a.duration;
    if (a.loudness) setLoud(record, a.loudness);
    delete t.failed;
    delete t.failWhy;
    changed();
    analysisProgress();
    return true;
  });
}
async function getAnalysis(id, version) {
  const token = await analysisToken(id);
  if (!token) return null;
  const t = activeTrack(id),
    row = rhythmSummary(t);
  if (!row || (version != null && row.version !== version)) return null;
  try {
    const file = anFile(token.content, token.settings, row.version);
    const MAX = 32 * 1024 * 1024;
    if ((await fsp.stat(file)).size > MAX) throw new Error('oversized rhythm cache');
    const data = JSON.parse((await gunzip(await fsp.readFile(file), { maxOutputLength: MAX })).toString());
    if (
      data.key !== token.content ||
      data.settings !== token.settings ||
      data.version !== row.version ||
      data.sum !== digest(data.body)
    )
      throw new Error('invalid rhythm cache');
    const result = JSON.parse(data.body);
    if (!Array.isArray(result.beats) || result.version !== row.version) throw new Error('invalid rhythm data');
    if (!matchesToken(id, token) || !(await currentSource(t)) || !matchesToken(id, token)) return null;
    scanCounters.cacheHits++;
    return result;
  } catch {
    if (matchesToken(id, token) && rhythmSummary(t) === row) delete summary(t).rhythm[token.settings];
    changed();
    send('lib:wake');
    return null;
  }
}
let apTm = 0;
function analysisProgress() {
  clearTimeout(apTm);
  apTm = setTimeout(() => {
    const all = Object.values(db.tracks).filter(
      (t) => !t.detached && !t.protected && !t.identityError && t.failed !== flavor(),
    );
    const done = all.filter((t) => rhythmSummary(t)?.version === want).length;
    send('lib:analysis', { done, total: all.length });
  }, 150);
}
const setLoud = (record, l) => {
  if (Number.isFinite(l?.lufs) && Number.isFinite(l?.peak)) {
    record.loudness = { lufs: +l.lufs.toFixed(2), peak: +l.peak.toFixed(4) };
    record.loudnessVersion = loudnessVersion;
  }
};
function saveLoudness(id, l, token) {
  return serialize(async () => {
    const t = activeTrack(id);
    if (!matchesToken(id, token) || !(await currentSource(t)) || !matchesToken(id, token)) return false;
    if (l) setLoud(contentRecord(token.content), l);
    else t.loudFailed = true;
    changed();
    return true;
  });
}
async function analysisFailed(id, why, token) {
  const t = activeTrack(id);
  if (!matchesToken(id, token) || !(await currentSource(t)) || !matchesToken(id, token)) return false;
  t.failed = flavor();
  t.failWhy = typeof why === 'string' ? why.slice(0, 200) : undefined;
  save();
  analysisProgress();
  return true;
}
let priority = [];
function taskDetails() {
  const details = {
    cached: 0,
    pending: 0,
    skipped: 0,
    failed: identityIssues.size,
    unresolved: 0,
    recent: [...identityIssues].slice(0, 20).map((file) => ({ file: path.basename(file), reason: 'unavailable' })),
  };
  for (const t of Object.values(db.tracks)) {
    if (t.detached) continue;
    let reason;
    if (t.protected) {
      details.skipped++;
      reason = 'protected';
    } else if (t.identityError) {
      details.failed++;
      reason = 'fingerprint';
    } else if (!identity.validId(t.audioContentId)) details.unresolved++;
    else if (t.failed === flavor()) {
      if (/budget|duration unavailable/.test(t.failWhy || '')) details.skipped++;
      else details.failed++;
      reason = t.failWhy || 'analysis';
    } else if (rhythmSummary(t)?.version === want) details.cached++;
    else details.pending++;
    if (reason && details.recent.length < 20) details.recent.push({ file: path.basename(t.path), reason });
  }
  return {
    ...details,
    progress: { ...scanStatus, hashing: Number(!!activeIdentity), queued: pending.size },
    counters: { ...scanCounters },
  };
}
function nextJob(version, omit) {
  const excluded = new Set(Array.isArray(omit) ? omit.filter((id) => typeof id === 'string') : []);
  if (version) want = version;
  const ready = (t) => t && !t.detached && !t.protected && identity.validId(t.audioContentId);
  const pick = (t) => {
    if (!ready(t) || excluded.has(t.id)) return null;
    if (rhythmSummary(t)?.version !== want) return t.failed === flavor() ? null : { id: t.id };
    if (!loudnessOf(t) && !t.loudFailed) return { id: t.id, only: 'loudness' };
    return null;
  };
  while (priority.length) {
    const item = pick(activeTrack(priority.shift()));
    if (item) {
      scanCounters.analyses++;
      return item;
    }
  }
  let candidate = null;
  let job = null;
  for (const track of Object.values(db.tracks)) {
    if (candidate && (track.last < candidate.last || (track.last === candidate.last && track.added <= candidate.added)))
      continue;
    const next = pick(track);
    if (next) {
      candidate = track;
      job = next;
    }
  }
  if (job) scanCounters.analyses++;
  return job;
}

/* ---------- per-song data: the lyric style bound to this song, lock, MV, timing ---------- */
const songFile = (id) => path.join(P.songs(), id.replace(/[^a-f0-9]/g, '') + '.json');
async function getSong(id) {
  try {
    return JSON.parse(await fsp.readFile(songFile(id), 'utf8'));
  } catch (e) {
    return null;
  }
}
// the page may change everything here except which video file is bound as the MV: that only comes from the open dialog
async function setSong(id, data, fromDialog) {
  if (!activeTrack(id) || !data || typeof data !== 'object') return false;
  if (!fromDialog) {
    const old = await getSong(id);
    data = {
      ...data,
      mv: !data.unbind && old && old.mv ? { ...old.mv, offset: +(data.mv && data.mv.offset) || 0 } : null,
    };
    delete data.unbind;
  }
  await replace(songFile(id), JSON.stringify(data));
  return true;
}

/* ---------- lyrics: the .lrc beside the audio file, or the lyrics embedded in it ---------- */
const flacLyrics = require('./flac-lyrics.cjs');
const nativeLyrics = require('./tag-lyrics.cjs');
const lyricEdits = new Map();
const lyricRevision = (text, stamp = '') =>
  crypto.createHash('sha256').update(stamp).update('\0').update(text).digest('hex');
const lyricFormat = (text) => (isTtmlText(text) ? 'ttml' : 'lrc');

async function lyricSources(id) {
  const track = activeTrack(id);
  if (!track || (track.sourceStamp && !(await currentSource(track)))) return null;
  const fields = [];
  const targets = [];
  const errors = [];
  const add = (id, label, text, writable, stamp) =>
    fields.push({ id, label, text, format: lyricFormat(text), writable, revision: lyricRevision(text, stamp) });
  const base = track.path.slice(0, -path.extname(track.path).length);
  for (const [format, file] of [
    ['ttml', ttmlSidecar(track.path)],
    ['lrc', sidecar(track.path)],
  ]) {
    const id = 'sidecar:' + format;
    try {
      if (file) add(id, path.basename(file), decodeText(await fsp.readFile(file)), true);
      else targets.push({ id, label: path.basename(base) + '.' + format, format });
    } catch {
      errors.push(id);
    }
  }
  const ext = path.extname(track.path).toLowerCase();
  try {
    if (ext === '.flac') {
      const comments = await flacLyrics.fields(track.path);
      for (const field of comments) add(field.id, field.key, field.text, true, track.sourceStamp);
      for (const [format, key] of [
        ['ttml', 'TTML'],
        ['lrc', 'LYRICS'],
      ]) {
        if (!comments.some((field) => field.key.toUpperCase() === key))
          targets.push({ id: 'new:' + format, label: key, format });
      }
    } else if (mp4Audio(track.path) || nativeLyrics.family(track.path) || track.embedded || track.ttml) {
      mm ||= await import('music-metadata');
      const parsed = await mm.parseFile(track.path, { skipCovers: true });
      const family = nativeLyrics.family(track.path);
      let exact = false;
      if (family) {
        try {
          const entries = nativeLyrics.read(track.path, family);
          exact = true;
          for (const entry of entries) add(entry.id, entry.label, entry.text, true, track.sourceStamp);
          if (family === 'id3' && !entries.some((item) => item.label.endsWith(' · Cadenza')))
            targets.push({ id: 'id3:new', label: 'USLT · und · Cadenza', format: 'either' });
          if (family === 'ogg')
            for (const [format, label] of [
              ['ttml', 'TTML'],
              ['lrc', 'LYRICS'],
            ])
              if (!entries.some((entry) => entry.label === label))
                targets.push({ id: 'ogg:new:' + format, label, format });
        } catch {
          errors.push(family);
        }
      }
      if (mp4Audio(track.path)) {
        const entries = (parsed.native.iTunes || []).filter((item) => item.id === '©lyr');
        entries.forEach((item, i) => {
          const raw = embeddedText(item.value);
          if (typeof raw === 'string') add('mp4:' + i, '©lyr', raw, entries.length === 1, track.sourceStamp);
        });
        if (!entries.length) targets.push({ id: 'mp4:0', label: '©lyr', format: 'either' });
      }
      for (const [family, entries] of Object.entries(parsed.native)) {
        entries.forEach((item, i) => {
          if (
            (family === 'iTunes' && item.id === '©lyr') ||
            (exact && (nativeLyrics.family(track.path) === 'ogg' || /^USLT(?::|$)/.test(item.id))) ||
            !/(?:^|:)(TTML|LYRICS?|UNSYNCEDLYRICS|USLT|SYLT)(?::.*)?$/i.test(item.id)
          )
            return;
          const raw = embeddedText(item.value) || item.value?.text;
          if (typeof raw === 'string') add('tag:' + family + ':' + i, item.id, raw, false, track.sourceStamp);
        });
      }
      if (!fields.some((field) => !field.id.startsWith('sidecar:'))) {
        for (const [i, entry] of (parsed.common.lyrics || []).entries()) {
          const text = entry.syncText?.length
            ? entry.syncText.map((line) => `[${lrcTime((line.timestamp || 0) / 1000)}]${line.text}`).join('\n')
            : entry.text;
          if (text) add('tag:common:' + i, 'Lyrics', text, false, track.sourceStamp);
        }
      }
    }
  } catch {
    errors.push('embedded');
  }
  if (activeTrack(id) !== track || (track.sourceStamp && !(await currentSource(track)))) return null;
  const preference = db.overrides[id] || {};
  const primary =
    fields.find((field) => field.id === preference.lyricsSource) ||
    (preference.preferLrc && fields.find((field) => field.id === 'sidecar:lrc')) ||
    fields.find((field) => field.format === 'ttml') ||
    fields[0];
  return {
    fields: fields.map((field) => ({ ...field, writable: field.writable && !track.protected })),
    targets: track.protected ? [] : targets,
    primary: primary?.id,
    errors,
  };
}
async function readLyrics(id) {
  const sources = await lyricSources(id);
  const field = sources?.fields.find((item) => item.id === sources.primary);
  if (!field) return null;
  return {
    source: field.format === 'ttml' ? 'ttml' : field.id === 'sidecar:lrc' ? 'lrc' : 'embedded',
    text: field.text,
  };
}
async function selectLyrics(id, source) {
  const sources = await lyricSources(id);
  if (!sources?.fields.some((field) => field.id === source)) return false;
  const preference = (db.overrides[id] ||= {});
  preference.lyricsSource = source;
  delete preference.preferLrc;
  changed();
  return true;
}
function mutateLyrics(id, request) {
  const previous = lyricEdits.get(id);
  const operation = Promise.resolve(previous)
    .catch(() => {})
    .then(() => applyLyricMutation(id, request))
    .catch((error) => ({ ok: false, why: error.code || String(error.message || error).slice(0, 160) }))
    .finally(() => {
      if (lyricEdits.get(id) === operation) lyricEdits.delete(id);
    });
  lyricEdits.set(id, operation);
  return operation;
}
async function applyLyricMutation(id, { source, revision, text } = {}) {
  const track = activeTrack(id);
  if (stopping) return { ok: false, why: 'closing' };
  if (!track || track.protected) return { ok: false, why: 'protected' };
  if (
    typeof source !== 'string' ||
    (text !== null && typeof text !== 'string') ||
    (typeof text === 'string' && Buffer.byteLength(text) > 8 * 1024 * 1024)
  )
    return { ok: false, why: 'invalid' };
  if (text !== null && /^\s*<(?:\?xml|tt[\s>])/i.test(text) && !isTtmlText(text)) return { ok: false, why: 'invalid' };
  const sources = await lyricSources(id);
  if (!sources) return { ok: false, why: 'changed' };
  const field = sources.fields.find((item) => item.id === source);
  const target = sources.targets.find((item) => item.id === source);
  if ((field && field.revision !== revision) || (!field && revision)) return { ok: false, why: 'changed' };
  if ((!field?.writable && !target) || (text === null && !field)) return { ok: false, why: 'unsupported' };
  const format = field?.format || target.format;
  if (text !== null && format !== 'either' && !/^(mp4:0|id3:)/.test(source) && lyricFormat(text) !== format)
    return { ok: false, why: 'format' };
  if (source.startsWith('sidecar:')) {
    const base = track.path.slice(0, -path.extname(track.path).length);
    const file = (format === 'ttml' ? ttmlSidecar(track.path) : sidecar(track.path)) || base + '.' + format;
    const stamp = await fsp.lstat(file).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (stamp && !stamp.isFile()) return { ok: false, why: 'unsupported' };
    const verified = stamp && lyricRevision(decodeText(await fsp.readFile(file)));
    if (verified !== (revision || undefined) || activeTrack(id) !== track || !(await currentSource(track)))
      return { ok: false, why: 'changed' };
    if (text === null) {
      // Rename instead of deleting outright so the exact original can be recovered.
      await fsp.rename(file, file + '.cadenza-backup-' + crypto.randomBytes(6).toString('hex'));
    } else {
      await writeLyricSidecar(file, format === 'lrc' ? '\ufeff' + text : text, stamp);
    }
    await sidecars(track);
  } else {
    const why = await writeTagLyrics(track, text, source);
    if (why) return { ok: false, why };
    track.lyricsRevision = (track.lyricsRevision || 0) + 1;
    const tags = await readTags(track.path).catch(() => null);
    if (tags) {
      track.embedded = tags.embedded;
      track.ttml = tags.ttml;
      track.tagLyric = tags.tagLyric;
    }
    if (!track.audioContentId) {
      delete track.identityError;
      queueIdentity(track);
      runIdentityIndex();
    }
  }
  changed();
  return { ok: true, target: source.startsWith('sidecar:') ? format : 'tag' };
}
/** Compatibility entry for integrations that address the conventional field by format. */
async function writeLyrics(id, text, target = 'lrc') {
  if (typeof text !== 'string') return { ok: false, why: 'invalid' };
  const sources = await lyricSources(id);
  if (!sources) return { ok: false, why: 'changed' };
  const format = lyricFormat(text);
  const field =
    target === 'tag'
      ? sources.fields.find(
          (item) =>
            item.id === 'mp4:0' ||
            (item.id.startsWith('id3:') && item.format === format) ||
            ((item.id.startsWith('flac:') || item.id.startsWith('ogg:')) &&
              item.label.toUpperCase() === (format === 'ttml' ? 'TTML' : 'LYRICS')),
        )
      : sources.fields.find((item) => item.id === 'sidecar:' + target);
  const destination =
    field?.id ||
    (target === 'tag'
      ? sources.targets.find(
          (item) =>
            item.id === 'mp4:0' ||
            item.id === 'id3:new' ||
            item.id === 'ogg:new:' + format ||
            item.id === 'new:' + format,
        )?.id
      : 'sidecar:' + target);
  return destination
    ? mutateLyrics(id, { source: destination, revision: field?.revision, text })
    : { ok: false, why: 'unsupported' };
}
async function writeLyricSidecar(file, text, expected) {
  const tmp = path.join(path.dirname(file), '.cadenza-' + crypto.randomBytes(12).toString('hex'));
  try {
    await fsp.writeFile(tmp, text, { encoding: 'utf8', flag: 'wx' });
    if (expected) {
      if (identity.revision(await fsp.lstat(file)) !== identity.revision(expected)) throw new Error('changed');
      await fsp.copyFile(
        file,
        file + '.cadenza-backup-' + crypto.randomBytes(6).toString('hex'),
        fs.constants.COPYFILE_EXCL,
      );
      if (identity.revision(await fsp.lstat(file)) !== identity.revision(expected)) throw new Error('changed');
      await fsp.rename(tmp, file);
    } else {
      await fsp.link(tmp, file);
    }
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}
/** The lyrics written into the file's tags (node-taglib-sharp, LGPL — NOTICE.md). The edit is made on a copy beside the
 *  file and the copy then takes its place, so a failure never leaves a half-written song; a file still held by another
 *  program is tried again for a few seconds. Returns null, or why not. */
async function tagManifest(file, family, source) {
  mm ||= await import('music-metadata');
  const metadata = await mm.parseFile(file);
  const xiph =
    source.split(':').at(-2) === 'new' ? (source.endsWith(':ttml') ? 'TTML' : 'LYRICS') : source.split(':')[1];
  return Object.entries(metadata.native)
    .flatMap(([group, tags]) =>
      tags
        .filter((tag) => (family === 'id3' ? !/^USLT(?::|$)/.test(tag.id) : tag.id.toUpperCase() !== xiph))
        .map((tag) => [group, tag.id, JSON.stringify(tag.value)]),
    )
    .sort();
}
let taglib = null;
async function writeTagLyrics(track, text, source) {
  const p = track.path;
  const ext = path.extname(p);
  for (let k = 0; k < 8; k++) {
    const tmp = path.join(path.dirname(p), '.cadenza-' + crypto.randomBytes(12).toString('hex') + ext);
    try {
      const before = await fsp.stat(p);
      if (
        before.size !== track.size ||
        before.mtimeMs !== track.mtime ||
        (track.sourceStamp && identity.revision(before) !== track.sourceStamp)
      )
        return 'changed';
      const beforeMp4 = mp4Audio(p) ? await mp4Manifest(p) : null;
      const family = nativeLyrics.family(p);
      const nativeField = family && source.startsWith(family + ':');
      const beforeMetadata = nativeField ? await tagManifest(p, family, source) : null;
      if (source.startsWith('flac:') || source.startsWith('new:')) {
        await flacLyrics.write(p, source, tmp, text);
      } else {
        await fsp.copyFile(p, tmp, fs.constants.COPYFILE_EXCL);
        if (nativeField) {
          const expected = nativeLyrics.write(tmp, family, source, text);
          if (
            !isDeepStrictEqual(expected, nativeLyrics.read(tmp, family)) ||
            !isDeepStrictEqual(beforeMetadata, await tagManifest(tmp, family, source))
          )
            return 'verification';
        } else {
          taglib ||= require('node-taglib-sharp');
          const file = taglib.File.createFromPath(tmp);
          try {
            const apple = file.getTag(taglib.TagTypes.Apple, text !== null);
            if (!apple) return 'unsupported';
            apple.lyrics = text;
            file.save();
          } finally {
            file.dispose();
          }
        }
      }
      if (beforeMp4) {
        mm ||= await import('music-metadata');
        const checked = await mm.parseFile(tmp, { skipCovers: true });
        const readBack = checked.native.iTunes?.find((tag) => tag.id === '©lyr')?.value;
        if (
          (text === null && readBack != null) ||
          (text && embeddedText(readBack) !== text) ||
          !isDeepStrictEqual(beforeMp4, await mp4Manifest(tmp))
        )
          return 'verification';
      }
      if (beforeMp4 || nativeField) {
        const original = identity.validId(track.audioContentId)
          ? track.audioContentId
          : await identity.fingerprint(binPath(), p, identity.revision(before));
        const proof = await identity.fingerprint(binPath(), tmp, identity.revision(await fsp.stat(tmp)));
        if (!original || proof !== original) return 'verification';
      }
      const now = await fsp.stat(p);
      if (
        now.size !== before.size ||
        now.mtimeMs !== before.mtimeMs ||
        now.ctimeMs !== before.ctimeMs ||
        now.ino !== before.ino
      )
        return 'changed';
      if (activeTrack(track.id) !== track) return 'changed';
      const backup = p + '.cadenza-backup-' + crypto.randomBytes(6).toString('hex');
      try {
        if (text === null) await fsp.copyFile(p, backup, fs.constants.COPYFILE_EXCL);
        if (identity.revision(await fsp.stat(p)) !== identity.revision(before)) return 'changed';
        await fsp.rename(tmp, p);
      } catch (error) {
        if (text === null) await fsp.rm(backup, { force: true }).catch(() => {});
        throw error;
      }
      const stat = await fsp.stat(p);
      Object.assign(track, {
        size: stat.size,
        mtime: stat.mtimeMs,
        fileKey: identity.fileKey(stat),
        sourceStamp: identity.revision(stat),
      });
      return null;
    } catch (e) {
      const busy = ['EBUSY', 'EPERM', 'EACCES'].includes(e && e.code);
      if (!busy)
        return /unsupported|not supported|unknown file/i.test(String(e && e.message))
          ? 'unsupported'
          : String((e && e.message) || e).slice(0, 160);
      await new Promise((r) => setTimeout(r, 400 + k * 300));
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }
  return 'busy';
}
// .lrc files come in UTF-8 (with or without a BOM), UTF-16, or GBK/Big5 from older tools
function decodeText(b) {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const u = new TextDecoder('utf-8', { fatal: false }).decode(b);
  if (!u.includes('\ufffd')) return u.replace(/^\ufeff/, '');
  for (const enc of ['gb18030', 'big5']) {
    try {
      const s = new TextDecoder(enc).decode(b);
      if (!s.includes('\ufffd')) return s;
    } catch (e) {
      /* not supported */
    }
  }
  return u;
}
const lrcTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;

/* ---------- online: lyrics from LRCLIB, tags from MusicBrainz, covers from iTunes / Cover Art Archive ---------- */
// one request, with a time limit; network errors, timeouts and busy answers (5xx, 429) are tried again after a pause
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, { tries = 3, timeout = 12000 } = {}) {
  let last = null;
  for (let k = 0; k < tries; k++) {
    if (k) await sleep(700 * k);
    const ac = new AbortController(),
      tm = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await net.fetch(url, {
        headers: { 'User-Agent': UA(), Accept: 'application/json' },
        signal: ac.signal,
      });
      if (r.ok) return await r.json();
      last = Object.assign(new Error('http ' + r.status), { status: r.status });
      if (r.status < 500 && r.status !== 429) throw last; // a real answer (not found, bad request): final
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 429) throw e;
      last = ac.signal.aborted ? Object.assign(new Error('timeout'), { kind: 'timeout' }) : e;
    } finally {
      clearTimeout(tm);
    }
  }
  throw last;
}
// lyrics: the exact match first, then a search by title and artist, then a free-text search; results merged, synced
// lyrics and the closest length first
async function searchLyrics(q) {
  const seen = new Map();
  let err = null;
  const add = (list) => {
    for (const x of [].concat(list || [])) if (x && x.id && !seen.has(x.id)) seen.set(x.id, x);
  };
  const tryGet = async (u) => {
    try {
      add(await getJSON(u.toString()));
    } catch (e) {
      if (e.status !== 404) err = e;
    }
  };
  if (q.title && q.artist && q.album && q.duration) {
    const u = new URL('https://lrclib.net/api/get');
    u.searchParams.set('track_name', q.title);
    u.searchParams.set('artist_name', q.artist);
    u.searchParams.set('album_name', q.album);
    u.searchParams.set('duration', Math.round(+q.duration));
    await tryGet(u);
  }
  if (q.title) {
    const u = new URL('https://lrclib.net/api/search');
    u.searchParams.set('track_name', q.title);
    if (q.artist) u.searchParams.set('artist_name', q.artist);
    await tryGet(u);
  }
  if (seen.size < 3) {
    const u = new URL('https://lrclib.net/api/search');
    u.searchParams.set('q', [q.title, q.artist].filter(Boolean).join(' ') || q.q || '');
    if (u.searchParams.get('q')) await tryGet(u);
  }
  if (!seen.size && err) throw err;
  const d = +q.duration || 0;
  return [...seen.values()]
    .map((x) => ({
      id: x.id,
      title: x.trackName,
      artist: x.artistName,
      album: x.albumName,
      duration: x.duration,
      synced: x.syncedLyrics || '',
      plain: x.plainLyrics || '',
      instrumental: !!x.instrumental,
    }))
    .sort((a, b) => !!b.synced - !!a.synced || (d ? Math.abs(a.duration - d) - Math.abs(b.duration - d) : 0))
    .slice(0, 20);
}
// MusicBrainz asks for at most one request a second from each application
let mbLast = 0;
async function mb(url) {
  for (let k = 0; k < 4; k++) {
    const w = mbLast + 1100 - Date.now();
    if (w > 0) await sleep(w);
    mbLast = Date.now();
    try {
      return await getJSON(url, { tries: 1 });
    } catch (e) {
      if (e.status !== 503 && e.status !== 429) throw e;
      await sleep(1500 * (k + 1));
    }
  }
  throw new Error('busy');
}
const esc = (s) => String(s).replace(/(["\\])/g, '\\$1');
async function searchMeta(q) {
  const parts = [];
  if (q.title) parts.push(`recording:"${esc(q.title)}"`);
  if (q.artist) parts.push(`artist:"${esc(q.artist)}"`);
  if (q.album) parts.push(`release:"${esc(q.album)}"`);
  const r = await mb(
    `https://musicbrainz.org/ws/2/recording?fmt=json&limit=12&query=${encodeURIComponent(parts.join(' AND ') || q.q || '')}`,
  );
  return (r.recordings || []).map((x) => {
    const rel = (x.releases || [])[0] || {};
    return {
      mbid: x.id,
      title: x.title,
      artist: (x['artist-credit'] || []).map((a) => a.name + (a.joinphrase || '')).join(''),
      album: rel.title || '',
      release: rel.id || null,
      year: (rel.date || x['first-release-date'] || '').slice(0, 4) || null,
      duration: x.length ? x.length / 1000 : null,
      score: x.score,
      genre: (x.tags || [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((t) => t.name),
    };
  });
}
// apply a chosen match: its tags as an override in the library (the audio file is never rewritten)
async function applyMeta(id, m) {
  const t = activeTrack(id);
  if (!t) return false;
  const rev = t.metadataRevision || 0;
  const o = { ...(db.overrides[id] || {}) };
  const applied = ['title', 'artist', 'album', 'year'].filter((k) => m[k]);
  for (const k of applied) o[k] = m[k];
  if (m.genre && m.genre.length) {
    o.genre = m.genre;
    applied.push('genre');
  }
  o.mbid = m.mbid;
  if (m.mbid) {
    try {
      const g = await mb(`https://musicbrainz.org/ws/2/recording/${m.mbid}?fmt=json&inc=genres`);
      if (g.genres && g.genres.length) {
        o.genre = g.genres
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)
          .map((x) => x.name);
        applied.push('genre');
      }
    } catch (e) {
      /* tags without genres */
    }
  }
  if (activeTrack(id) !== t || (t.metadataRevision || 0) !== rev) return false;
  db.overrides[id] = o;
  if (m.mbid)
    recordFieldOrigins(id, o, applied, {
      provider: 'musicbrainz',
      namespace: 'recording',
      id: String(m.mbid),
      access: { kind: 'public' },
      availability: {},
    });
  t.metadataRevision = (t.metadataRevision || 0) + 1;
  changed();
  return true;
}
// the user's own edits: a field left empty goes back to what the file says
const EDITABLE = ['title', 'artist', 'album', 'albumArtist', 'year', 'genre', 'track', 'disc'];
function recordFieldOrigins(id, fields, keys, source) {
  const origins = (db.fieldOrigins[id] ??= {});
  for (const key of keys) {
    if (Object.hasOwn(fields, key)) origins[key] = { source };
    else delete origins[key];
  }
}
function editMeta(id, f) {
  const t = activeTrack(id);
  if (!t || !f) return false;
  const o = { ...(db.overrides[id] || {}) };
  for (const k of EDITABLE) {
    if (!(k in f)) continue;
    let v = f[k];
    if (k === 'genre')
      v = []
        .concat(typeof v === 'string' ? v.split(/\s*[,;，、]\s*/) : v || [])
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 6);
    else if (k === 'year' || k === 'track' || k === 'disc') {
      v = parseInt(v, 10);
      v = isFinite(v) && v > 0 ? v : null;
    } else
      v = String(v ?? '')
        .trim()
        .slice(0, 300);
    const none = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (none) delete o[k];
    else o[k] = v;
  }
  delete o.mbid;
  if (activeTrack(id) !== t) return false;
  db.overrides[id] = o;
  recordFieldOrigins(
    id,
    o,
    EDITABLE.filter((key) => Object.hasOwn(f, key)),
    'manual',
  );
  t.metadataRevision = (t.metadataRevision || 0) + 1;
  changed();
  return true;
}
// covers, searched on their own; thumbnails are fetched here and handed to the page as data, so the page never loads
// anything from the network itself
const COVER_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(mzstatic\.com|coverartarchive\.org|archive\.org)\//i;
async function fetchImage(url, timeout = 10000) {
  if (!COVER_HOSTS.test(url)) throw new Error('host');
  const ac = new AbortController(),
    tm = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': UA() }, signal: ac.signal });
    if (!r.ok) throw Object.assign(new Error('http ' + r.status), { status: r.status });
    const type = r.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(type)) throw new Error('type');
    return { data: Buffer.from(await r.arrayBuffer()), type };
  } finally {
    clearTimeout(tm);
  }
}
async function searchCovers(q) {
  const term = [q.album || q.title, q.artist].filter(Boolean).join(' ').trim();
  if (!term) return [];
  const out = [];
  // iTunes answers per storefront and turns busy clients away (403) for a moment: a few storefronts in turn, with a pause
  const itunes = (async () => {
    let r = null;
    for (const [i, c] of [q.country || 'TW', 'HK', 'US'].entries()) {
      if (i) await sleep(500);
      const u = new URL('https://itunes.apple.com/search');
      u.searchParams.set('term', term);
      u.searchParams.set('entity', 'album');
      u.searchParams.set('limit', '12');
      u.searchParams.set('country', c);
      try {
        r = await getJSON(u.toString(), { tries: 1 });
      } catch (e) {
        if (e.status === 403) {
          await sleep(900);
          try {
            r = await getJSON(u.toString(), { tries: 1 });
          } catch (e2) {
            r = null;
          }
        }
      }
      if (r && r.results && r.results.length) break;
    }
    for (const x of (r && r.results) || [])
      if (x.artworkUrl100)
        out.push({
          src: 'itunes',
          title: x.collectionName,
          artist: x.artistName,
          year: (x.releaseDate || '').slice(0, 4) || null,
          thumb: x.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x300bb.'),
          full: x.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1200x1200bb.'),
        });
  })().catch(() => {});
  const caa = (async () => {
    const parts = [];
    if (q.album || q.title) parts.push(`releasegroup:"${esc(q.album || q.title)}"`);
    if (q.artist) parts.push(`artist:"${esc(q.artist)}"`);
    const r = await mb(
      `https://musicbrainz.org/ws/2/release-group?fmt=json&limit=8&query=${encodeURIComponent(parts.join(' AND '))}`,
    );
    for (const g of r['release-groups'] || [])
      out.push({
        src: 'caa',
        title: g.title,
        artist: (g['artist-credit'] || []).map((a) => a.name + (a.joinphrase || '')).join(''),
        year: (g['first-release-date'] || '').slice(0, 4) || null,
        thumb: `https://coverartarchive.org/release-group/${g.id}/front-250`,
        full: `https://coverartarchive.org/release-group/${g.id}/front-1200`,
      });
  })().catch(() => {});
  await Promise.all([itunes, caa]);
  const got = await Promise.all(
    out.map(async (c) => {
      try {
        const im = await fetchImage(c.thumb, 9000);
        return { ...c, thumb: `data:${im.type};base64,${im.data.toString('base64')}` };
      } catch (e) {
        return null;
      }
    }),
  );
  return got.filter(Boolean).slice(0, 24);
}
// set a song's cover: a chosen search result, an image file the user picks, or back to the file's own
async function setCover(id, how, getWin, canEdit) {
  const t = activeTrack(id);
  if (!t) return false;
  const rev = t.metadataRevision || 0;
  const o = { ...(db.overrides[id] || {}) };
  if (how && how.reset) delete o.coverKey;
  else if (how && how.url) {
    const im = await fetchImage(how.url, 20000).catch(async (e) => {
      if (/front-1200$/.test(how.url)) return fetchImage(how.url.replace(/front-1200$/, 'front'), 20000);
      throw e;
    });
    o.coverKey = await storeCover(im.data);
  } else if (how && how.file) {
    const r = await dialog.showOpenDialog(getWin(), {
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
    });
    if (r.canceled || !r.filePaths[0]) return false;
    o.coverKey = await storeCover(await fsp.readFile(r.filePaths[0]));
  } else return false;
  if (!o.coverKey) delete o.coverKey;
  if (!canEdit() || activeTrack(id) !== t || (t.metadataRevision || 0) !== rev) return false;
  db.overrides[id] = o;
  recordFieldOrigins(id, o, ['coverKey'], 'manual');
  t.metadataRevision = (t.metadataRevision || 0) + 1;
  changed();
  return true;
}
// an instrumental: shown with its own line instead of lyrics, in the record theme unless the song has its own look
function setInstrumental(id, on) {
  if (!db.tracks[id]) return false;
  const o = { ...(db.overrides[id] || {}) };
  if (on) o.instrumental = true;
  else delete o.instrumental;
  if (Object.keys(o).length) db.overrides[id] = o;
  else delete db.overrides[id];
  changed();
  return true;
}
// back to what the file says: its tags, its cover, or both
function resetMeta(id, part) {
  const t = activeTrack(id);
  if (!t) return false;
  const o = { ...(db.overrides[id] || {}) };
  // (marking a song as an instrumental is not one of its tags: resetting them keeps it)
  if (part === 'cover') delete o.coverKey;
  else if (part === 'tags') {
    for (const k of Object.keys(o)) if (k !== 'coverKey' && k !== 'instrumental' && k !== 'preferLrc') delete o[k];
  } else for (const k of Object.keys(o)) if (k !== 'instrumental' && k !== 'preferLrc') delete o[k];
  if (Object.keys(o).length) db.overrides[id] = o;
  else delete db.overrides[id];
  recordFieldOrigins(
    id,
    o,
    Object.keys(db.fieldOrigins[id] || {}).filter((key) => !Object.hasOwn(o, key)),
    'manual',
  );
  t.metadataRevision = (t.metadataRevision || 0) + 1;
  changed();
  return true;
}

/* ---------- cadenza:// — covers, thumbnails, audio and a song's MV ---------- */
const mediaRevision = (t) =>
  t.sourceStamp || (Number.isFinite(t.mtime) && Number.isFinite(t.size) ? `${t.size}:${t.mtime}` : '');
const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
};
const MODEL_FILES = new Set(['beat_this-wgsl.bin', 'htdemucs-wgsl.bin']);
const workshopFiles = new Map();
const modelDir = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, '..', 'models');
function registerProtocol() {
  protocol.handle('cadenza', async (req) => {
    try {
      const u = new URL(req.url),
        [kind, raw] = [u.hostname, decodeURIComponent(u.pathname.slice(1))],
        key = raw.replace(/[^a-f0-9]/g, '');
      if (kind === 'thumb' || kind === 'cover') {
        const p = kind === 'thumb' ? path.join(P.thumbs(), key + '.jpg') : path.join(P.covers(), key + '.img');
        if (kind === 'thumb' && !fs.existsSync(p))
          return serveFile(path.join(P.covers(), key + '.img'), req, 'image/jpeg');
        return serveFile(p, req, kind === 'thumb' ? 'image/jpeg' : 'image/*');
      }
      if (kind === 'media') {
        const t = key && raw === key && activeTrack(key);
        if (!t || t.protected) return new Response(null, { status: 404 });
        const revision = u.searchParams.get('rev');
        if (revision && revision !== mediaRevision(t)) {
          return new Response(null, { status: 409, headers: { 'Access-Control-Allow-Origin': '*' } });
        }
        const expected = { size: t.size, mtime: t.mtime, sourceStamp: t.sourceStamp };
        if (alac(t.codec)) return await serveAlac(t.path, req, expected);
        return await serveFile(
          t.path,
          req,
          MIME[path.extname(t.path).toLowerCase()] || 'application/octet-stream',
          expected,
        );
      }
      if (kind === 'workshop-audio') {
        const input = key && raw === key && workshopFiles.get(key);
        if (!input || input.expires < Date.now()) {
          workshopFiles.delete(key);
          return new Response(null, { status: 404 });
        }
        return input.alac
          ? await serveAlac(input.path, req, input)
          : await serveFile(input.path, req, input.type, input);
      }
      // the neural rhythm engine's weights (shipped as resources/models; in a checkout, models/ from scripts/models.mjs):
      // only the files the engine names, nothing else on disk
      if (kind === 'model') {
        const f = path.basename(raw);
        if (!MODEL_FILES.has(f)) return new Response('', { status: 404 });
        const p = path.join(modelDir(), f);
        if (!fs.existsSync(p)) return new Response('', { status: 404 });
        return serveFile(p, req, 'application/octet-stream');
      }
      if (kind === 'mv') {
        const s = await getSong(key);
        if (!s || !s.mv || !s.mv.path || !fs.existsSync(s.mv.path)) return new Response('', { status: 404 });
        return serveFile(s.mv.path, req, MIME[path.extname(s.mv.path).toLowerCase()] || 'video/mp4');
      }
    } catch (e) {
      /* fall through */
    }
    return new Response('', { status: 404 });
  });
}

/* ---------- the page's requests ---------- */
function register(ipcMain, getWin, canEdit) {
  send = (ch, data) => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send(ch, data);
  };
  ipcMain.handle('lib:get', () => view());
  ipcMain.handle('lib:openWorkshopAudio', async (event) => {
    const win = getWin();
    if (!win || win.webContents !== event.sender) return null;
    const extensions = [...PLAYABLE].map((ext) => ext.slice(1));
    const answer = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions }],
    });
    const file = answer.filePaths[0];
    if (answer.canceled || !file) return null;
    const ext = path.extname(file).toLowerCase();
    if (!PLAYABLE.has(ext)) return null;
    const st = await fsp.stat(file);
    if (!st.isFile()) return null;
    const info = mp4Audio(file) ? await readTags(file).catch(() => null) : null;
    const id = crypto.randomBytes(16).toString('hex');
    workshopFiles.clear();
    workshopFiles.set(id, {
      path: file,
      size: st.size,
      mtime: st.mtimeMs,
      expires: Date.now() + 300000,
      alac: alac(info?.codec),
      type: MIME[ext] || 'application/octet-stream',
    });
    return { id, name: path.basename(file) };
  });
  ipcMain.handle('lib:closeWorkshopAudio', (event, id) => {
    if (getWin()?.webContents === event.sender) workshopFiles.delete(id);
  });
  ipcMain.handle('lib:addFolder', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled) return view();
    for (const d of r.filePaths) if (!db.folders.includes(d)) db.folders.push(d);
    changed();
    watchAll();
    scan();
    return view();
  });
  ipcMain.handle('lib:removeFolder', async (_e, d) => {
    db.folders = db.folders.filter((x) => x !== d);
    watchAll();
    await scan();
    return view();
  });
  ipcMain.handle('lib:rescan', () => {
    scan(true);
    return true;
  });
  ipcMain.handle('lib:favorite', (_e, id, on) => {
    db.favorites = db.favorites.filter((x) => x !== id);
    if (on && db.tracks[id]) db.favorites.unshift(id);
    changed();
    return true;
  });
  ipcMain.handle('lib:playlist', (_e, op, a, b) => {
    if (op === 'create') {
      const p = {
        id: 'p' + Date.now().toString(36),
        name: String(a || '').slice(0, 80) || 'Playlist',
        created: Date.now(),
        tracks: (b || []).filter((id) => db.tracks[id]),
      };
      db.playlists.push(p);
      changed();
      return p.id;
    }
    const p = db.playlists.find((x) => x.id === a);
    if (!p) return false;
    if (op === 'rename') p.name = String(b || '').slice(0, 80) || p.name;
    else if (op === 'delete') db.playlists = db.playlists.filter((x) => x !== p);
    else if (op === 'add') {
      for (const id of [].concat(b)) if (db.tracks[id] && !p.tracks.includes(id)) p.tracks.push(id);
    } else if (op === 'remove') p.tracks = p.tracks.filter((id) => ![].concat(b).includes(id));
    else if (op === 'order') {
      const current = new Set(p.tracks);
      const ordered = [...new Set([].concat(b).filter((id) => current.has(id)))];
      const moved = new Set(ordered);
      p.tracks = [...ordered, ...p.tracks.filter((id) => !moved.has(id))];
    }
    changed();
    return true;
  });
  ipcMain.handle('lib:played', (_e, id) => {
    const t = activeTrack(id);
    if (t) {
      t.plays = (t.plays || 0) + 1;
      t.last = Date.now();
      changed();
    }
  });
  ipcMain.handle('lib:analysis', (_e, id, version) => getAnalysis(id, version));
  ipcMain.handle('lib:analysisToken', (_e, id) => analysisToken(id));
  ipcMain.handle('lib:saveAnalysis', (_e, id, a, token) => saveAnalysis(id, a, token));
  ipcMain.handle('lib:saveLoudness', (_e, id, l, token) => saveLoudness(id, l, token));
  ipcMain.handle('lib:analysisFailed', (_e, id, why, token) => analysisFailed(id, why, token));
  ipcMain.handle('lib:reanalyze', (_e, ids) =>
    reanalyze(ids === 'all' ? Object.keys(db.tracks) : Array.isArray(ids) ? ids : []),
  );
  ipcMain.handle('lib:verified', async (_e, id, version, token) => {
    const t = activeTrack(id);
    if (!matchesToken(id, token) || !(await currentSource(t)) || !matchesToken(id, token)) return;
    const row = rhythmSummary(t);
    if (row?.version === version) {
      row.checked = true;
      save();
    }
  });
  ipcMain.handle('lib:unverified', (_e, version) =>
    Object.values(db.tracks)
      .filter((t) => !t.detached && rhythmSummary(t)?.version === version && !rhythmSummary(t).checked)
      .map((t) => t.id),
  );
  ipcMain.handle('lib:clearCaches', () => {
    cacheEpoch++;
    trackEpoch.clear();
    return serialize(async () => {
      await clearDir(P.analysis());
      await clearDir(path.join(root(), 'rhythm'));
      await clearDir(P.thumbs());
      db.derived = {};
      for (const t of Object.values(db.tracks)) {
        delete t.failed;
        delete t.failWhy;
        delete t.loudFailed;
      }
      changed();
      analysisProgress();
      send('lib:wake');
      return true;
    });
  });
  ipcMain.handle('lib:taskDetails', () => taskDetails());
  ipcMain.handle('lib:nextAnalysis', (_e, version, omit) => nextJob(version, omit));
  ipcMain.handle('lib:prioritize', (_e, ids) => {
    priority = [].concat(ids, priority).slice(0, 50);
    send('lib:wake');
  });
  ipcMain.handle('lib:song', async (_e, id) => {
    const s = activeTrack(id) && (await getSong(id));
    if (s && s.mv) s.mv = { name: s.mv.name, offset: s.mv.offset || 0 };
    return s;
  });
  ipcMain.handle('lib:setSong', (event, id, d) => canEdit(event) && setSong(id, d));
  ipcMain.handle('lib:lyrics', (_e, id) => readLyrics(id));
  ipcMain.handle('lib:lyricSources', (_e, id) => lyricSources(id));
  ipcMain.handle('lib:selectLyrics', (_e, id, source) => selectLyrics(id, source));
  ipcMain.handle('lib:mutateLyrics', (event, id, request) =>
    canEdit(event) ? mutateLyrics(id, request) : { ok: false, why: 'editing-disabled' },
  );
  ipcMain.handle('lib:exportLyrics', async (event, id, text) => {
    if (!canEdit(event) || typeof text !== 'string' || Buffer.byteLength(text) > 8 * 1024 * 1024) return false;
    const format = lyricFormat(text);
    const result = await dialog.showSaveDialog(getWin(), {
      defaultPath: 'lyrics.' + format,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (
      result.canceled ||
      !result.filePath ||
      !canEdit(event) ||
      path.extname(result.filePath).toLowerCase() !== '.' + format
    )
      return false;
    const track = activeTrack(id);
    if (!track) return false;
    const file = result.filePath;
    const sidecarPath = track.path.slice(0, -path.extname(track.path).length) + '.' + format;
    if (!path.relative(sidecarPath, file)) return false;
    const expected = await fsp.lstat(file).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (expected && !expected.isFile()) return false;
    await writeLyricSidecar(file, text, expected);
    return true;
  });
  ipcMain.handle('lib:writeLyrics', (event, id, text, target) =>
    canEdit(event)
      ? writeLyrics(id, text, target === 'tag' || target === 'ttml' ? target : 'lrc')
      : { ok: false, why: 'editing-disabled' },
  );
  ipcMain.handle('lib:searchLyrics', (_e, q) => searchLyrics(q));
  ipcMain.handle('lib:searchMeta', (_e, q) => searchMeta(q));
  ipcMain.handle('lib:applyMeta', (event, id, m) => canEdit(event) && applyMeta(id, m));
  ipcMain.handle('lib:clearMeta', (event, id, part) => canEdit(event) && resetMeta(id, part));
  ipcMain.handle('lib:instrumental', (event, id, on) => canEdit(event) && setInstrumental(id, !!on));
  ipcMain.handle('lib:editMeta', (event, id, f) => canEdit(event) && editMeta(id, f));
  ipcMain.handle('lib:searchCovers', (_e, q) => searchCovers(q || {}));
  ipcMain.handle('lib:setCover', (event, id, how) => canEdit(event) && setCover(id, how, getWin, () => canEdit(event)));
  ipcMain.handle('lib:bindMv', async (event, id) => {
    if (!canEdit(event) || !activeTrack(id)) return null;
    const r = await dialog.showOpenDialog(getWin(), {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'm4v', 'webm', 'mov', 'mkv'] }],
    });
    if (r.canceled || !r.filePaths[0] || !canEdit(event)) return null;
    const s = (await getSong(id)) || {};
    s.mv = { path: r.filePaths[0], name: path.basename(r.filePaths[0]), offset: s.mv?.offset || 0 };
    await setSong(id, s, true);
    return { name: s.mv.name, offset: s.mv.offset };
  });
  ipcMain.handle('lib:importLyricsFile', async () => {
    const r = await dialog.showOpenDialog(getWin(), {
      properties: ['openFile'],
      filters: [{ name: 'Lyrics', extensions: ['lrc', 'txt'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return decodeText(await fsp.readFile(r.filePaths[0]));
  });
}

async function start(ipcMain, getWin, settings, canEdit) {
  preferences = settings;
  await load();
  registerProtocol();
  register(ipcMain, getWin, canEdit);
  watchAll();
  setTimeout(() => {
    const work = settings.scanOnLaunch !== false && db.folders.length ? scan() : indexExisting();
    void work.catch((error) => console.error('[library index]', error));
  }, 600);
}
// the file behind a playable track (for the Hi-Fi output, which reads files itself); never a protected one
const pathOf = async (id) => {
  const t = activeTrack(id);
  if (!t || t.protected) return null;
  if (t.sourceStamp && (!(await currentSource(t)) || activeTrack(id) !== t)) return null;
  return t.path;
};
async function close() {
  stopping = true;
  clearTimeout(identityTimer);
  clearTimeout(watchTm);
  clearTimeout(changeTm);
  pending.clear();
  activeIdentity?.controller.abort();
  for (const watcher of watchers.values()) watcher.close();
  if (db) {
    await Promise.allSettled([...lyricEdits.values(), writes]);
    await flush();
  }
}
module.exports = {
  start,
  close,
  pathOf,
  analysisSettingsChanged: () => {
    if (db && !stopping) send('lib:wake');
  },
  scheme: {
    scheme: 'cadenza',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
};
