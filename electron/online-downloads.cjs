const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { OnlineError } = require('./online.cjs');
const { publicUrl, request } = require('./online-providers.cjs');
const { assertDirectory } = require('./library-storage.cjs');
const identity = require('./audio-identity.cjs');
const flac = require('./flac-lyrics.cjs');
const tags = require('./tag-lyrics.cjs');

const maxAudio = 256 * 1024 * 1024;
const audioDomains = ['music.126.net', 'music.163.com'];
const decoderNames = new Map([
  ['flac', { ext: '.flac', codec: 'FLAC', lossless: true }],
  ['alac', { ext: '.m4a', codec: 'ALAC', lossless: true }],
  ['aac', { ext: '.m4a', codec: 'AAC', lossless: false }],
  ['mp3', { ext: '.mp3', codec: 'MP3', lossless: false }],
]);
function temporary(folder, suffix = '') {
  return path.join(folder, '.cadenza-online-' + randomUUID() + suffix);
}
const remove = (filename) => fs.rm(filename, { force: true }).catch(() => {});
const segment = (value) =>
  String(value || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 105);
const normalizeCodec = (codec) => {
  const name = String(codec || '').toLowerCase();
  if (/\bflac\b/.test(name)) return 'flac';
  if (/\balac\b/.test(name)) return 'alac';
  if (/aac|mp4a/.test(name)) return 'aac';
  if (/layer\s*3|mp3/.test(name)) return 'mp3';
  return '';
};

function deadline(ms, code, abort) {
  return setTimeout(() => abort.abort(new OnlineError(code)), ms);
}
async function writeFlacLyrics(file, edits) {
  const staged = temporary(path.dirname(file), '.flac');
  try {
    await flac.writeFields(file, staged, edits);
    await fs.rename(staged, file);
  } finally {
    await remove(staged);
  }
}
async function receive(lease, filename, update, signal) {
  let url = publicUrl(lease.url, audioDomains, true);
  if (!url || lease.permission !== 'save' || lease.expiresAt <= Date.now()) throw new OnlineError('restricted');
  if (!Number.isSafeInteger(lease.size) || lease.size < 2048 || lease.size > maxAudio)
    throw new OnlineError('invalid-response');
  const deadlineAbort = new AbortController();
  const combined = AbortSignal.any([signal, deadlineAbort.signal]);
  let response;
  let timer = deadline(15000, 'timeout', deadlineAbort);
  try {
    for (let n = 0; n < 3; n++) {
      response = await fetch(url, { redirect: 'manual', signal: combined });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      try {
        url = publicUrl(new URL(location || '', url).href, audioDomains, true);
      } catch {
        url = '';
      }
      if (!url) throw new OnlineError('restricted');
    }
    if (!response?.ok || response.status !== 200) {
      await response?.body?.cancel();
      throw new OnlineError(response?.status === 429 ? 'rate-limit' : 'provider-failed');
    }
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (/json|html|text\//.test(type)) {
      await response.body.cancel();
      throw new OnlineError('invalid-response');
    }
    const length = response.headers.get('content-length');
    if (length && Number(length) !== lease.size) {
      await response.body.cancel();
      throw new OnlineError('invalid-response');
    }
    const file = await fs.open(filename, 'wx');
    try {
      const reader = response.body.getReader();
      let read = 0;
      try {
        for (;;) {
          clearTimeout(timer);
          timer = deadline(read ? 18000 : 12000, read ? 'download-stalled' : 'first-byte-timeout', deadlineAbort);
          const part = await reader.read();
          clearTimeout(timer);
          if (part.done) break;
          read += part.value.length;
          if (read > lease.size) throw new OnlineError('invalid-response');
          await file.writeFile(part.value);
          update(read, lease.size);
        }
        if (read !== lease.size) throw new OnlineError('incomplete');
        await file.sync();
      } finally {
        await reader.cancel().catch(() => {});
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    if (signal.aborted) throw new OnlineError('cancelled');
    if (deadlineAbort.signal.aborted) throw deadlineAbort.signal.reason;
    throw error instanceof OnlineError ? error : new OnlineError('provider-failed');
  } finally {
    clearTimeout(timer);
  }
}

async function inspected(file, lease) {
  const mm = await import('music-metadata');
  const metadata = await mm.parseFile(file, { duration: true });
  const { format } = metadata;
  const kind = decoderNames.get(normalizeCodec(format.codec));
  if (
    !kind ||
    format.lossless !== kind.lossless ||
    kind.codec.toLowerCase() !== lease.codec ||
    !(format.duration > 0) ||
    Math.abs(format.duration - lease.track.duration) > Math.max(2, lease.track.duration * 0.03)
  )
    throw new OnlineError('format-mismatch');
  if (
    (lease.tier === 'lossless' && !kind.lossless) ||
    (lease.tier === 'high' && !kind.lossless && format.bitrate > 0 && format.bitrate < 220_000)
  )
    throw new OnlineError('format-mismatch');
  return {
    metadata,
    kind,
    detected: {
      codec: kind.codec,
      container: format.container,
      sampleRate: format.sampleRate,
      bits: format.bitsPerSample,
      bitrate: format.bitrate,
      lossless: kind.lossless,
    },
  };
}

async function decorate(file, lease, info, nativeBin, signal) {
  const before = await identity.fingerprint(nativeBin(), file, identity.revision(await fs.stat(file)), signal);
  if (!before) throw new OnlineError('invalid-response');
  const taglib = require('node-taglib-sharp');
  const handle = taglib.File.createFromPath(file);
  // Tags are supplied by the same provider and version as the resolved resource.
  const existing = info.metadata.common;
  try {
    handle.tag.title ||= lease.track.title;
    if (!handle.tag.performers?.length && lease.track.artist) handle.tag.performers = [lease.track.artist];
    handle.tag.album ||= lease.track.album || '';
    if (!handle.tag.pictures?.length && lease.track.image) {
      try {
        const address = publicUrl(lease.track.image, ['music.126.net']);
        if (address) {
          const pic = await request(address, { signal, bytes: 2 * 1024 * 1024 });
          if (pic.type === 'image/jpeg' && pic.content[0] === 255 && pic.content[1] === 216) {
            const picture = taglib.Picture.fromData(taglib.ByteVector.fromByteArray(pic.content));
            picture.type = taglib.PictureType.FrontCover;
            handle.tag.pictures = [picture];
          }
        }
      } catch {
        signal.throwIfAborted();
      }
    }
    handle.save();
  } finally {
    handle.dispose();
  }
  const text = lease.lyrics?.text;
  const flacEdits = [];
  if (typeof text === 'string' && text.length && !existing.lyrics?.length) {
    const xml = /^\s*(?:<\?xml[^>]*>\s*)?<tt[\s>]/i.test(text);
    if (info.kind.ext === '.flac') {
      flacEdits.push({ target: xml ? 'new:ttml' : 'new:lrc', text });
    } else if (info.kind.ext === '.mp3') {
      tags.write(file, 'id3', 'id3:new', text);
      if (!tags.read(file, 'id3').some((item) => item.text === text)) throw new OnlineError('tag-verification');
    } else {
      const handle = taglib.File.createFromPath(file);
      try {
        const apple = handle.getTag(taglib.TagTypes.Apple, true);
        apple.lyrics = text;
        handle.save();
      } finally {
        handle.dispose();
      }
      const mm = await import('music-metadata');
      const checked = await mm.parseFile(file, { skipCovers: true });
      if (checked.native.iTunes?.find((item) => item.id === '©lyr')?.value !== text)
        throw new OnlineError('tag-verification');
    }
  }
  const auxiliary = { ...lease.lyrics?.auxiliary };
  if (info.kind.ext === '.flac') {
    const previousFields = flacEdits.length || Object.keys(auxiliary).length ? await flac.fields(file) : [];
    const verified = [];
    for (const role of ['translation', 'transliteration']) {
      const value = auxiliary[role];
      if (typeof value !== 'string' || !value) continue;
      const field = 'LYRICS_' + role.toUpperCase();
      const previous = previousFields.find((item) => item.key.toUpperCase() === field);
      if (previous && previous.text !== value) continue;
      if (!previous) flacEdits.push({ target: 'new:' + role, text: value });
      verified.push({ field, text: value });
      delete auxiliary[role];
    }
    if (flacEdits.length) await writeFlacLyrics(file, flacEdits);
    if (verified.length) {
      const fields = await flac.fields(file);
      if (
        !verified.every(({ field, text }) =>
          fields.some((item) => item.key.toUpperCase() === field && item.text === text),
        )
      )
        throw new OnlineError('tag-verification');
    }
  }
  const checked = await inspected(file, lease);
  if (!checked.metadata.common.title || (existing.picture?.length && !checked.metadata.common.picture?.length))
    throw new OnlineError('tag-verification');
  const after = await identity.fingerprint(nativeBin(), file, identity.revision(await fs.stat(file)), signal);
  if (before !== after) throw new OnlineError('tag-verification');
  return { content: before, auxiliary };
}

// TagLib rewrites tag blocks synchronously. Keep that disk and CPU work off the Electron IPC thread.
function decorateAsync(file, lease, binary, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { file, lease, binary } });
    const cancel = () => worker.postMessage('abort');
    let done = false;
    function finish(error, value) {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(new OnlineError('cancelled'));
      else if (error) reject(error);
      else resolve(value);
    }
    signal.addEventListener('abort', cancel, { once: true });
    worker.once('message', (reply) => finish(reply.code && new OnlineError(reply.code), reply.content));
    worker.once('error', (error) => finish(error));
    worker.once('exit', () => finish(new OnlineError('tag-verification')));
  });
}
if (!isMainThread) {
  const abort = new AbortController();
  parentPort.once('message', () => abort.abort());
  void inspected(workerData.file, workerData.lease)
    .then((info) => decorate(workerData.file, workerData.lease, info, () => workerData.binary, abort.signal))
    .then(
      (result) => parentPort.postMessage({ content: result }),
      (error) => parentPort.postMessage({ code: error instanceof OnlineError ? error.code : 'tag-verification' }),
    )
    .finally(() => parentPort.close());
}

function createDownloads({ resolve, library, nativeBin, publish }) {
  const queue = [];
  let active = null;
  let drain;
  let closed = false;
  let lastUpdate = 0;
  const emit = () => {
    lastUpdate = Date.now();
    publish(snapshot());
  };
  const snapshot = () =>
    queue.map(({ id, state, problem, bytes, total, title, tier, import: imported }) => ({
      id,
      state,
      problem,
      bytes,
      total,
      title,
      tier,
      saved: state === 'complete' && !!imported,
    }));
  async function execute(job) {
    const { signal } = job.abort;
    const part = temporary(job.folder);
    let file;
    try {
      await assertDirectory(job.folder);
      job.state = 'resolving';
      emit();
      const lease = await resolve(job, signal);
      signal.throwIfAborted();
      job.title = lease.track.title;
      job.state = 'downloading';
      emit();
      await receive(
        lease,
        part,
        (bytes, total) => {
          job.bytes = bytes;
          job.total = total;
          if (Date.now() - lastUpdate >= 200) emit();
        },
        signal,
      );
      job.state = 'verifying';
      emit();
      const info = await inspected(part, lease);
      file = part + info.kind.ext;
      await fs.rename(part, file);
      const { content, auxiliary } = await decorateAsync(file, lease, nativeBin(), signal);
      signal.throwIfAborted();
      const stem = segment([lease.track.artist, lease.track.title].filter(Boolean).join(' - ')) || 'Audio';
      const prefix = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) ? '_' + stem : stem;
      let final;
      await assertDirectory(job.folder);
      for (let i = 1; i <= 100; i++) {
        final = path.join(job.folder, prefix + (i > 1 ? ' (' + i + ')' : '') + info.kind.ext);
        try {
          await fs.link(file, final);
          break;
        } catch (error) {
          if (error.code !== 'EEXIST' || i === 100) throw error;
          if (job.conflict === 'skip') {
            job.state = 'skipped';
            return;
          }
        }
      }
      job.import = {
        file: final,
        ref: lease.track.ref,
        tier: job.tier,
        detected: info.detected,
        content,
        auxiliary,
      };
      job.state = 'importing';
      emit();
      await library.importOnline(job.import);
      job.state = 'complete';
    } finally {
      await remove(part);
      if (file) await remove(file);
    }
  }
  async function pump() {
    if (active || closed) return;
    const job = queue.find((item) => item.state === 'queued');
    if (!job) return;
    active = job;
    try {
      if (job.import) {
        job.state = 'importing';
        emit();
        await library.importOnline(job.import);
        job.state = 'complete';
        return;
      }
      await execute(job);
    } catch (error) {
      job.problem = error instanceof OnlineError ? error.code : job.import ? 'import-failed' : 'download-failed';
      job.state = job.abort.signal.aborted ? 'cancelled' : 'failed';
      if (
        !closed &&
        !job.import &&
        job.attempts < 1 &&
        ['timeout', 'first-byte-timeout', 'download-stalled'].includes(job.problem)
      ) {
        job.attempts++;
        job.state = 'retrying';
        emit();
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (!job.abort.signal.aborted && !closed) job.state = 'queued';
      }
    } finally {
      active = null;
      drain?.();
      emit();
      void pump();
    }
  }
  return {
    add(input) {
      if (
        closed ||
        queue.filter((item) => !['complete', 'failed', 'skipped', 'cancelled'].includes(item.state)).length >= 12
      )
        throw new OnlineError('rate-limit');
      while (queue.length >= 32) {
        const index = queue.findIndex((item) => ['complete', 'failed', 'skipped', 'cancelled'].includes(item.state));
        if (index < 0) throw new OnlineError('rate-limit');
        queue.splice(index, 1);
      }
      const job = {
        ...input,
        id: randomUUID(),
        state: 'queued',
        bytes: 0,
        total: 0,
        attempts: 0,
        abort: new AbortController(),
      };
      queue.push(job);
      emit();
      void pump();
      return snapshot().find((item) => item.id === job.id);
    },
    act(id, command) {
      const job = queue.find((item) => item.id === id);
      if (!job) return false;
      if (command === 'cancel' && !job.import) {
        job.abort.abort();
        if (job.state === 'queued' || job.state === 'retrying') job.state = 'cancelled';
      } else if (command === 'retry' && ['failed', 'cancelled'].includes(job.state)) {
        Object.assign(job, {
          state: 'queued',
          abort: new AbortController(),
          bytes: 0,
          total: 0,
          problem: '',
          attempts: 0,
        });
        void pump();
      }
      emit();
      return true;
    },
    snapshot,
    savedFile(id) {
      const job = queue.find((item) => item.id === id && item.state === 'complete');
      return job?.import?.file;
    },
    async close() {
      closed = true;
      for (const job of queue) job.abort.abort();
      if (active)
        await new Promise((resolve) => {
          drain = resolve;
        });
    },
  };
}

module.exports = { createDownloads, inspected };
