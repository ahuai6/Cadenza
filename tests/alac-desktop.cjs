// Windows Electron and native decoding regression. All writes target a fresh fixture directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');
const { manifest } = require('../electron/mp4-integrity.cjs');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-alac-'));
const music = path.join(scratch, 'music');
const profile = path.join(scratch, 'profile');
const native =
  process.env.CADENZA_NATIVE_TEST_BIN ||
  path.join(root, 'native', 'cadenza-audio', 'target', 'release', 'cadenza-audio.exe');
const text =
  '<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">\n<head><metadata></metadata></head>\n<body><div>\n\n<p begin="0.5s" end="1.5s"><span begin="0.5s" end="1s">first</span><span begin="1s" end="1.5s">word</span><span ttm:role="x-translation" xml:lang="zh">测试</span><span ttm:role="x-roman">ce shi</span></p>\n<p begin="2s" end="3s"></p>\n</div><div><p begin="4s" end="5s">second section</p></div></body>\n</tt>';
const plain = 'Untimed line\n\n[00:02.00]\n\nLast line';
const files = {
  '16-ttml.m4a': { format: 'alac', bits: 16, lyrics: text, cover: true },
  '24-plain.m4a': { format: 'alac', bits: 24, lyrics: plain },
  '24-empty.m4a': { format: 'alac', bits: 24 },
  '16-short.m4a': { format: 'alac', bits: 16, duration: 4 },
  'aac-plain.m4a': { format: 'aac', lyrics: plain, cover: true },
};
const ff = (args, maxBuffer = 32 * 1024 * 1024) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer });
const call = (args) => execFileSync(native, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const checksum = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixtures() {
  fs.mkdirSync(music);
  fs.mkdirSync(profile);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  fs.mkdirSync(path.join(profile, 'library'), { recursive: true });
  const cover = path.join(scratch, 'fixture.jpg');
  ff(['-f', 'lavfi', '-i', 'color=royalblue:s=96x96', '-frames:v', '1', cover]);
  for (const [name, spec] of Object.entries(files)) {
    const args = [
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=0.17*sin(2*PI*375*t)|0.13*sin(2*PI*1125*t):s=44100:d=${spec.duration ?? 12}`,
    ];
    if (spec.cover) args.push('-i', cover);
    args.push('-map', '0:a:0', '-c:a', spec.format);
    if (spec.cover) args.push('-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    if (spec.bits)
      args.push('-sample_fmt', spec.bits === 16 ? 's16p' : 's32p', '-bits_per_raw_sample', String(spec.bits));
    if (spec.lyrics) args.push('-metadata', 'lyrics=' + spec.lyrics);
    ff([
      ...args,
      '-metadata',
      'title=' + name,
      '-metadata',
      'artist=Synthetic',
      '-metadata',
      'copyright=Fixture',
      path.join(music, name),
    ]);
  }
  const provided = process.env.CADENZA_ALAC_SAMPLE;
  if (provided) fs.copyFileSync(provided, path.join(music, 'private-reference.m4a'));
  fs.writeFileSync(path.join(profile, 'library/db.json'), JSON.stringify({ version: 1, folders: [music] }));
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      lang: 'en',
      closeToTray: false,
      scanOnLaunch: true,
      rhythmEngine: 'dsp',
      rhythmStream: 'full',
      audioOut: 'standard',
      fixedVolume: true,
      volBalance: false,
    }),
  );
  return provided;
}

function exact(file, bits) {
  const info = JSON.parse(call(['--alac-info', file]));
  const bytes = info.channels * Math.ceil(info.bits / 8);
  const reference = ff(['-i', file, '-map', '0:a:0', '-f', 's' + bits + 'le', 'pipe:1']);
  assert.equal(info.bits, bits);
  assert.equal(info.frames * bytes, reference.length);
  assert.ok(call(['--alac-pcm', file, '0', String(info.frames)]).equals(reference));
  for (const first of [1, 4097, Math.floor(info.frames * 0.72), info.frames - 31]) {
    assert.ok(
      call(['--alac-pcm', file, String(first), '31']).equals(reference.subarray(first * bytes, (first + 31) * bytes)),
    );
  }
}

async function run() {
  const provided = fixtures();
  const originalSum = provided && checksum(provided);
  for (const [name, spec] of Object.entries(files)) if (spec.bits) exact(path.join(music, name), spec.bits);
  if (provided) exact(path.join(music, 'private-reference.m4a'), 16);
  console.log('Pass native integer PCM and seeks against FFmpeg');
  const app = await _electron.launch({
    executablePath: require(path.join(root, 'node_modules', 'electron')),
    args: [root, '--no-sandbox'],
    env: {
      ...process.env,
      CADENZA_USER_DATA: profile,
      CADENZA_AUDIO_FAKE: `rates=44100,48000;fmts=i16;dump=${path.join(scratch, 'endpoint')}`,
    },
  });
  try {
    const win = await app.firstWindow();
    await win.locator('[data-test=titlebar] [data-test=edit-mode]').click();
    await win.locator('[data-test=titlebar] [data-test=edit-mode][aria-pressed=true]').waitFor();
    const errors = [];
    win.on('pageerror', (error) => errors.push(error.message));
    const wait = (test, arg, timeout = 25000) => win.waitForFunction(test, arg, { timeout });
    const tracks = () => win.evaluate(() => window.cadenzaLib.get().then((view) => view.tracks));
    await wait((count) => window.__cadenza?.lib.get().tracks.length === count, Object.keys(files).length + !!provided);
    const scanned = await tracks();
    const id = (name) => scanned.find((track) => track.file === name).id;
    for (const [name, spec] of Object.entries(files)) {
      const t = scanned.find((item) => item.id === id(name));
      assert.equal(t.lossless, spec.format === 'alac', name);
      assert.equal(Boolean(t.cover), Boolean(spec.cover), name);
      assert.equal(Boolean(t.ttml), spec.lyrics === text, name);
      if (spec.bits) assert.equal(t.bits, spec.bits, name);
      assert.equal(t.copyright, 'Fixture');
      const lyrics = await win.evaluate((id) => window.cadenzaLib.lyrics(id), t.id);
      assert.equal(lyrics?.text ?? undefined, spec.lyrics, name);
    }
    const selected = id('16-ttml.m4a');
    const packet = await win.evaluate(async (id) => {
      const url = 'cadenza://media/' + id;
      const get = async (range) => {
        const res = await fetch(url, { headers: { Range: range } });
        return {
          status: res.status,
          bytes: Array.from(new Uint8Array(await res.arrayBuffer())),
          type: res.headers.get('content-type'),
        };
      };
      const head = await fetch(url, { method: 'HEAD' });
      const controller = new AbortController();
      const stream = await fetch(url, { signal: controller.signal });
      const reader = stream.body.getReader();
      const first = (await reader.read()).value.byteLength;
      controller.abort();
      await reader.cancel().catch(() => {});
      return {
        header: await get('bytes=0-43'),
        part: await get('bytes=17845-19012'),
        invalid: (await get('bytes=100000000-')).status,
        length: Number(head.headers.get('content-length')),
        first,
      };
    }, selected);
    assert.equal(packet.header.status, 206);
    assert.equal(packet.header.type, 'audio/wav');
    assert.equal(Buffer.from(packet.header.bytes).toString('ascii', 0, 4), 'RIFF');
    assert.ok(packet.first < packet.length);
    assert.equal(packet.invalid, 416);
    const reference = ff(['-i', path.join(music, '16-ttml.m4a'), '-f', 's16le', 'pipe:1']);
    assert.ok(Buffer.from(packet.part.bytes).equals(reference.subarray(17845 - 44, 19013 - 44)));
    console.log('Pass scan, cover, lyric formats, bounded first read, cancel and unaligned range');

    await win.evaluate(async () => {
      const { engine } = window.__cadenza;
      window.alacDevices = [];
      window.cadenzaAudio.onEvent((e) => {
        if (e.ev === 'device' && e.open) window.alacDevices.push(e);
      });
      engine.clock.warm();
      const ctx = engine.clock.ctx;
      await ctx.resume();
      window.alacTap = ctx.createAnalyser();
      const mute = ctx.createGain();
      mute.gain.value = 0;
      window.alacTap.connect(mute).connect(ctx.destination);
      engine.audioRoute(window.alacTap);
    });
    const play = (ids) => win.evaluate((ids) => window.__cadenza.api.playIds(ids, 0, { album: true }), ids);
    const running = async (id, route) => {
      try {
        await wait(
          ({ id, route }) => {
            const state = window.__cadenza.api.playback.get();
            return state.phase === 'playing' && state.output?.id === id && state.route === route;
          },
          { id, route },
        );
      } catch (error) {
        const state = await win.evaluate(async (id) => {
          const { api, lib } = window.__cadenza;
          const track = lib.get().tracks.find((track) => track.id === id);
          const response = await fetch(`cadenza://media/${id}?rev=${track?.mediaRevision}`, {
            headers: { Range: 'bytes=32768-32799' },
          });
          return {
            playback: api.playback.get(),
            response: response.status,
            bytes: (await response.arrayBuffer()).byteLength,
          };
        }, id);
        throw new Error(`${route} output did not start: ${JSON.stringify(state)}; fixtures: ${scratch}`, {
          cause: error,
        });
      }
    };
    await play([selected, id('24-plain.m4a')]);
    await running(selected, 'std');
    await wait(() => {
      const bins = new Float32Array(window.alacTap.frequencyBinCount);
      window.alacTap.getFloatFrequencyData(bins);
      return bins.some((d) => d > -45);
    });
    await win.evaluate(() => window.__cadenza.api.seekFile(11.1));
    await running(id('24-plain.m4a'), 'std');
    await win.evaluate(() => window.__cadenza.setSettings({ audioOut: 'hifi', audioMode: 'exclusive' }));
    await play([selected]);
    await running(selected, 'hifi');
    await wait(() => window.alacDevices.some((e) => e.exclusive && e.rate === 44100));
    await win.evaluate(() => window.__cadenza.api.seekFile(2.5));
    await wait(() => window.__cadenza.api.playback.time() > 2.65);
    await win.evaluate(() => window.__cadenza.setSettings({ audioMode: 'shared' }));
    await running(selected, 'hifi');
    await wait(() => window.alacDevices.at(-1)?.exclusive === false);
    const short = id('16-short.m4a');
    await play([short]);
    await running(short, 'hifi');
    await wait(() => window.__cadenza.api.playback.time() > 0.35);
    await win.evaluate(() => window.__cadenza.api.seekFile(2.4));
    await wait(() => window.__cadenza.api.playback.time() > 2.5);
    await win.evaluate(() => window.__cadenza.setSettings({ audioOut: 'standard' }));
    await play([selected]);
    await running(selected, 'std');
    const digital = fs.readdirSync(scratch).find((name) => /^endpoint-.*-44100-i16-ex\.raw$/.test(name));
    assert.ok(digital, 'the simulated exclusive device accepted source-rate 16-bit PCM');
    const seeked = call(['--alac-pcm', path.join(music, '16-ttml.m4a'), String(Math.round(44100 * 2.55)), '1024']);
    assert.ok(fs.readFileSync(path.join(scratch, digital)).includes(seeked), 'output PCM matches the seeked ALAC');
    await wait(
      (id) => window.__cadenza.lib.get().tracks.some((t) => t.id === id && t.analyzed && t.loudness),
      selected,
      90000,
    );
    const work = await win.evaluate(async (id) => {
      const z = window.__cadenza;
      const t = (await window.cadenzaLib.get()).tracks.find((t) => t.id === id);
      const data = await z.api.songForWorkshop(t);
      return { duration: data.buffer.duration, analysis: !!data.analysis, lyrics: data.lyrics };
    }, selected);
    assert.equal(work.duration, 12);
    assert.ok(work.analysis);
    assert.equal(work.lyrics, text);
    console.log(
      'Pass ordinary audio signal, seek and album handoff, simulated Hi-Fi modes, analysis, loudness and workshop PCM',
    );

    const exported = path.join(scratch, 'workshop-export.mp4');
    await app.evaluate(
      ({ dialog }, { input, exported }) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported });
      },
      { input: path.join(music, '24-plain.m4a'), exported },
    );
    await win.getByRole('button', { name: 'Lyric workshop', exact: true }).click();
    await win.getByRole('button', { name: 'Import audio', exact: true }).click();
    await wait(
      () => {
        const w = window.__cadenza.workshop.get();
        return !w.analyzing && w.audioName === '24-plain.m4a';
      },
      undefined,
      90000,
    );
    await win.evaluate(() => window.__cadenza.wsEngine.play());
    await wait(() => window.__cadenza.wsEngine.time > 0.3);
    await win.getByRole('button', { name: 'Export MP4', exact: true }).click();
    await win.getByRole('button', { name: 'Start export', exact: true }).click();
    await wait(
      () =>
        [...document.querySelectorAll('[role=status]')].some((row) =>
          /done|completed|saved|complete/i.test(row.textContent),
        ),
      undefined,
      150000,
    );
    const media = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'json',
        exported,
      ]),
    );
    assert.equal(media.streams[0].codec_name, 'aac');
    await win.getByRole('button', { name: 'Library', exact: true }).click();
    console.log('Pass native workshop selection, live preview and rendered MP4 with AAC audio');

    for (const file of ['16-ttml.m4a', 'aac-plain.m4a', ...(provided ? ['private-reference.m4a'] : [])]) {
      const track = id(file);
      const filename = path.join(music, file);
      const before = await manifest(filename);
      const wasAnalyzed = (await tracks()).find((t) => t.id === track).analyzed;
      const read = await win.evaluate((id) => window.cadenzaLib.lyrics(id), track);
      const edit =
        file === 'aac-plain.m4a'
          ? plain + '\n\nNew'
          : file === 'private-reference.m4a'
            ? read.text.replace('</tt>', '\n<!-- G4R isolated write -->\n</tt>')
            : text.replace('second section', 'edited section');
      if (file === 'private-reference.m4a') assert.ok(read.text !== edit && read.source === 'ttml');
      let result;
      if (file === 'private-reference.m4a') {
        const audio = scanned.find((track) => track.file === file);
        assert.equal(audio.codec, 'ALAC');
        assert.equal(audio.bits, 16);
        assert.equal(audio.sampleRate, 44100);
        assert.equal(audio.channels, 2);
        assert.ok(audio.cover);
        await play([track]);
        await running(track, 'std');
        await win.evaluate(() => window.__cadenza.api.seekFile(25));
        await wait(() => {
          const { api, player } = window.__cadenza;
          const signal = new Float32Array(window.alacTap.frequencyBinCount);
          window.alacTap.getFloatFrequencyData(signal);
          return api.playback.time() > 25 && player.get().session && signal.some((db) => db > -60);
        });
        const ok = await win.evaluate((edit) => window.__cadenza.api.useLyrics(edit, { edit: true }), edit);
        result = { ok, target: 'tag' };
        await running(track, 'std');
        await wait(() => window.__cadenza.api.playback.time() > 25);
        exact(filename, 16);
        assert.equal(checksum(provided), originalSum);
      } else {
        await win.evaluate(() => window.__cadenza.api.stopPlayback());
        result = await win.evaluate(({ id, edit }) => window.cadenzaLib.writeLyrics(id, edit, 'tag'), {
          id: track,
          edit,
        });
      }
      assert.deepEqual(result, { ok: true, target: 'tag' }, file);
      assert.deepEqual(await manifest(filename), before, file);
      const after = await win.evaluate((id) => window.cadenzaLib.lyrics(id), track);
      assert.equal(after.text, edit, file);
      await win.evaluate(() => window.cadenzaLib.rescan());
      const rescanned = (await tracks()).find((t) => t.file === file);
      assert.equal(rescanned.id, track);
      if (wasAnalyzed) assert.equal(rescanned.analyzed, wasAnalyzed);
    }
    await win.evaluate(() => window.__cadenza.api.stopPlayback());
    const changedFile = path.join(music, '24-empty.m4a');
    const external = fs.statSync(changedFile);
    fs.utimesSync(changedFile, external.atime, new Date(external.mtimeMs + 10000));
    const previous = checksum(changedFile);
    const blocked = await win.evaluate(
      (id) => window.cadenzaLib.writeLyrics(id, 'stale edit', 'tag'),
      id('24-empty.m4a'),
    );
    assert.deepEqual(blocked, { ok: false, why: 'changed' });
    assert.equal(checksum(changedFile), previous);
    console.log('Pass atom-level write verification, full TTML round-trip and stable library IDs');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
  console.log('Evidence:', scratch);
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
