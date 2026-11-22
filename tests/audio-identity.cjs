const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fingerprint, revision, validId } = require('../electron/audio-identity.cjs');
const { openLibrary, replace } = require('../electron/library-storage.cjs');

const native =
  process.env.CADENZA_NATIVE_TEST_BIN ||
  path.resolve(__dirname, '../native/cadenza-audio/target/release/cadenza-audio.exe');
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', ...args], { windowsHide: true });
const id = async (file) => fingerprint(native, file, revision(await fs.stat(file)));

test('format identities keep audio under tag changes and distinguish different encoded sounds', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cadenza-identity-vectors-'));
  const formats = [
    ['mp3', 'libmp3lame'],
    ['flac', 'flac'],
    ['m4a', 'aac'],
    ['m4a', 'alac'],
    ['aac', 'aac'],
    ['ogg', 'libvorbis'],
    ['opus', 'libopus'],
    ['wav', 'pcm_s16le'],
    ['webm', 'libopus'],
  ];
  for (const [ext, codec] of formats) {
    const a = path.join(scratch, `a-${codec}-${ext}.${ext}`);
    const tagged = path.join(scratch, `tag-${codec}-${ext}.${ext}`);
    const b = path.join(scratch, `b-${codec}-${ext}.${ext}`);
    for (const [out, hz] of [
      [a, 410],
      [b, 515],
    ])
      ff(
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${hz}:sample_rate=44100:duration=1.1`,
        '-c:a',
        codec,
        '-metadata',
        'title=G5 source title',
        ...(ext === 'webm' ? ['-write_crc32', '0'] : []),
        out,
      );
    if (ext === 'webm') {
      // Matroska remuxing may change container packet durations. Exercise an actual tag-only edit.
      const bytes = await fs.readFile(a);
      const offset = bytes.indexOf('G5 source title');
      assert.ok(offset >= 0);
      bytes.write('G5 edited title', offset);
      await fs.writeFile(tagged, bytes);
    } else ff('-i', a, '-c', 'copy', '-metadata', 'title=Revised title', '-metadata', 'lyrics=Line one', tagged);
    const expected = await id(a);
    assert.ok(validId(expected), `${ext}/${codec}`);
    assert.equal(await id(tagged), expected, `${ext}/${codec} should ignore tags`);
    assert.notEqual(await id(b), expected, `${ext}/${codec} should distinguish different audio`);
  }
  const a = path.join(scratch, 'a-alac-m4a.m4a');
  const old = await id(a);
  const bytes = await fs.readFile(a);
  const field = bytes.indexOf('elst');
  assert.ok(field >= 0);
  bytes[field + 15] ^= 1;
  const edited = path.join(scratch, 'edited-timing.m4a');
  await fs.writeFile(edited, bytes);
  assert.notEqual(await id(edited), old, 'MP4 edit list is part of the audio timeline');

  const aac = path.join(scratch, 'a-aac-m4a.m4a');
  const other = path.join(scratch, 'b-aac-m4a.m4a');
  const mux = async (name, second, color) => {
    const target = path.join(scratch, `${name}.mp4`);
    ff(
      '-i',
      aac,
      '-i',
      second,
      '-f',
      'lavfi',
      '-i',
      `color=${color}:s=32x32:d=1.1`,
      '-map',
      '0:a',
      '-map',
      '1:a',
      '-map',
      '2:v',
      '-c:a',
      'copy',
      '-c:v',
      'mpeg4',
      target,
    );
    return id(target);
  };
  const multi = await mux('multi', aac, 'blue');
  assert.equal(await mux('other-video', aac, 'red'), multi, 'video payload must stay outside the audio identity');
  assert.notEqual(await mux('other-audio', other, 'blue'), multi, 'secondary audio stream is covered');
});

test('a deterministic little-endian PCM vector locks the v1 encoding', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cadenza-identity-pcm-'));
  const file = path.join(scratch, 'reference.wav');
  const bytes = Buffer.alloc(44 + 4096);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(4096, 40);
  for (let i = 44; i < bytes.length; i += 2) bytes.writeUInt16LE((i * 17) % 65536, i);
  await fs.writeFile(file, bytes);
  assert.equal(await id(file), 'audio-sha256-v1:e5120eab8f9e495b42507f0ac6808dd00ae9e7244dad614df4dd9c3da66cb292');
});

test('index migration is atomic, retains unresolved user records, and resumes from a prepared backup', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cadenza-library-v2-'));
  const file = path.join(scratch, 'db.json');
  const original = {
    version: 1,
    favorites: ['aa'],
    tracks: { aa: { id: 'aa', plays: 6, ak: 'sampled', analyzed: 3 } },
    overrides: { aa: { preferLrc: true } },
    playlists: [{ id: 'p', tracks: ['aa'] }],
  };
  const body = JSON.stringify(original);
  await fs.writeFile(file, body);
  await fs.writeFile(path.join(scratch, 'db.v1.json'), body);
  await fs.writeFile(file + '.interrupted.tmp', '{incomplete');
  const next = await openLibrary(file);
  assert.equal(next.version, 2);
  assert.deepEqual(next.tracks.aa, { id: 'aa', plays: 6 });
  for (const key of ['favorites', 'overrides', 'playlists']) assert.deepEqual(next[key], original[key]);
  assert.deepEqual(await openLibrary(file), next);
  assert.equal(await fs.readFile(path.join(scratch, 'db.v1.json'), 'utf8'), body);
  assert.equal(await replace(file, 'bad', () => false), false);
  assert.deepEqual(await openLibrary(file), next);
  await fs.writeFile(file, '{incomplete');
  await assert.rejects(openLibrary(file));
  assert.equal(await fs.readFile(file, 'utf8'), '{incomplete');
  const invalid = JSON.stringify({ ...original, tracks: { aa: 'corrupt record' } });
  await fs.writeFile(file, invalid);
  await assert.rejects(openLibrary(file), /invalid or unsupported Cadenza library index/);
  assert.equal(await fs.readFile(file, 'utf8'), invalid);
});
