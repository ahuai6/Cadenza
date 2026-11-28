// Windows Electron playback, with synthetic audio and an isolated data profile. Requires ffmpeg and Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g3-'));
const profile = path.join(scratch, 'profile');
const music = path.join(scratch, 'music');
const rate = 48000;
const tones = [375, 1125, 750, 94, 1500, 1875];
const rawAac = 'ADTS at 44.1 kHz.aac';
const alac = process.argv.includes('--alac') ? 'ALAC 24-bit.m4a' : null;
const cases = {
  'MP3 at 44.1 kHz.mp3': ['-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '4'],
  'AAC in M4A with index at end.m4a': ['-c:a', 'aac', '-b:a', '192k'],
  'AAC in MP4 with faststart.mp4': ['-c:a', 'aac', '-movflags', '+faststart'],
  [rawAac]: ['-ar', '44100', '-c:a', 'aac'],
  'WAV 24-bit.wav': ['-c:a', 'pcm_s24le'],
  'FLAC at 96 kHz 24-bit.flac': ['-ar', '96000', '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'],
  'Vorbis.ogg': ['-ar', '44100', '-c:a', 'libvorbis'],
  'Opus.opus': ['-c:a', 'libopus'],
  'Opus in WebM.webm': ['-c:a', 'libopus'],
  'Vorbis in WebM.webm': ['-c:a', 'libvorbis'],
  'Surround.flac': ['-c:a', 'flac'],
  ...(alac ? { [alac]: ['-c:a', 'alac', '-sample_fmt', 's32p', '-bits_per_raw_sample', '24'] } : {}),
};

function generate(name, flags) {
  const channels = name === 'Surround.flac' ? tones : tones.slice(0, 2);
  const signal = channels.map((hz) => `0.20*sin(2*PI*${hz}*t)`).join('|');
  const layout = channels.length === 6 ? ':c=5.1' : '';
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=${signal}:s=${rate}:d=4${layout}`,
    ...flags,
    path.join(music, name),
  ]);
}

function longWave(file, duration) {
  const bytes = rate * 4 * duration;
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(bytes + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  const second = Buffer.alloc(rate * 4);
  for (let i = 0; i < rate; i++) {
    second.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * tones[0] * i) / rate)), i * 4);
    second.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * tones[1] * i) / rate)), i * 4 + 2);
  }
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, header);
    fs.ftruncateSync(fd, 44 + bytes);
    for (let i = 0; i < 24; i++) fs.writeSync(fd, second, 0, second.length, 44 + second.length * i);
    fs.writeSync(fd, second, 0, second.length, 44 + second.length * (duration - 10));
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');
  fs.mkdirSync(profile);
  fs.mkdirSync(music);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  fs.mkdirSync(path.join(profile, 'library'));
  for (const [name, flags] of Object.entries(cases)) generate(name, flags);
  const long = { 'long.wav': 2700, 'medium.wav': 600 };
  for (const [name, duration] of Object.entries(long)) longWave(path.join(music, name), duration);
  fs.writeFileSync(path.join(music, 'broken.wav'), 'Invalid RIFF stream');
  fs.writeFileSync(path.join(music, 'locked.ncm'), 'Protected fixture');
  const tracks = Object.fromEntries(
    fs.readdirSync(music).map((name, i) => {
      const id = (i + 1).toString(16).padStart(8, '0');
      const file = path.join(music, name);
      const st = fs.statSync(file);
      return [
        id,
        {
          id,
          path: file,
          title: name,
          size: st.size,
          mtime: st.mtimeMs,
          sampleRate: rate,
          duration: name === rawAac ? 0 : long[name] || 4,
          channels: name === 'Surround.flac' ? 6 : 2,
          protected: name === 'locked.ncm',
          ...(name === alac ? { codec: 'ALAC', bits: 24, lossless: true } : {}),
        },
      ];
    }),
  );
  const id = (name) => Object.values(tracks).find((track) => track.title === name).id;
  fs.writeFileSync(path.join(profile, 'library/db.json'), JSON.stringify({ tracks, version: 1 }));
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      closeToTray: false,
      scanOnLaunch: false,
      prerender: false,
      rhythmEngine: 'dsp',
      audioOut: 'standard',
      lang: 'en',
    }),
  );
  // 4.0.0-alpha.6: the standard output plays PCM from the native decoder. A decoder held once after 0.7 s of
  // long.wav stands in for a slow disk (formerly a gate on the media file's protocol reads).
  const env = {
    ...process.env,
    CADENZA_USER_DATA: profile,
    CADENZA_AUDIO_FAKE: 'stall-decoder-ms=2500;stall-decoder-file=long.wav',
  };
  const app = await _electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'], env });
  try {
    const page = await app.firstWindow();
    const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 });
    await wait(() => window.__cadenza?.lib.get().loaded);
    await page.evaluate(() => {
      const { api, engine, pauseAnalysis } = window.__cadenza;
      pauseAnalysis(true, 'isolated streaming probe');
      api.stopPlayback();
      api.setMode('stop');
      api.setVolume(1);
      engine.clock.warm();
    });
    const devtools = await page.context().newCDPSession(page);
    await devtools.send('Performance.enable');
    await page.evaluate(async (tones) => {
      const { engine } = window.__cadenza;
      const ctx = engine.clock.ctx;
      await ctx.resume();
      const output = ctx.createGain();
      output.gain.value = 0;
      output.connect(ctx.destination);
      const split = ctx.createChannelSplitter(6);
      const taps = tones.map(() => {
        const tap = ctx.createAnalyser();
        tap.fftSize = 2048;
        tap.smoothingTimeConstant = 0;
        tap.connect(output);
        return tap;
      });
      const bins = new Float32Array(taps[0].frequencyBinCount);
      taps.forEach((tap, i) => split.connect(tap, i));
      engine.audioRoute(split);
      window.g3levels = (ownTones = tones) =>
        taps.map((tap, i) => {
          tap.getFloatFrequencyData(bins);
          return bins[Math.round((ownTones[i] * tap.fftSize) / ctx.sampleRate)];
        });
    }, tones);
    const output = (id) => wait((id) => window.__cadenza.api.playback.get().output?.id === id, id);
    const select = (ids, album = true) =>
      page.evaluate(
        ({ ids, album }) => {
          void window.__cadenza.api.playIds(ids, 0, { album });
        },
        { ids, album },
      );
    const stop = () => page.evaluate(() => window.__cadenza.api.stopPlayback());
    // the native decoders serving playback streams: their files and first frames
    const decoders = () =>
      []
        .concat(
          JSON.parse(
            execFileSync(
              'powershell.exe',
              [
                '-NoProfile',
                '-Command',
                "@(Get-CimInstance Win32_Process -Filter \"Name='cadenza-audio.exe'\" | Where-Object { $_.CommandLine -like '*--play-pcm*' } | ForEach-Object { $_.CommandLine }) | ConvertTo-Json -Compress",
              ],
              { encoding: 'utf8' },
            ).trim() || '[]',
          ),
        )
        .filter((line) => line.includes(music))
        .map((line) => {
          const [, quoted, plain, start] = line.match(/--play-pcm\s+(?:"([^"]+)"|(\S+))\s+([\d.]+)/) ?? [];
          return { file: path.basename(quoted ?? plain ?? ''), from: Number(start) };
        });
    const graph = (channels = 2) =>
      wait(
        (count) =>
          window
            .g3levels()
            .slice(0, count)
            .every((db) => db > -40),
        channels,
      );
    const memory = async () => {
      await devtools.send('HeapProfiler.collectGarbage');
      return {
        renderer: Object.fromEntries(
          (await devtools.send('Performance.getMetrics')).metrics
            .filter(({ name }) => /JSHeapUsedSize|Nodes|TaskDuration|ScriptDuration/.test(name))
            .map(({ name, value }) => [name, value]),
        ),
        processes: await app.evaluate(({ app }) =>
          app.getAppMetrics().map(({ type, memory, cpu }) => ({ type, memory, cpu })),
        ),
      };
    };
    const measure = { initial: await memory() };
    await page.evaluate(() => window.__cadenza.settings.set({ rhythmStream: 'full' }));
    for (const name of Object.keys(cases)) {
      await select([id(name)]);
      await output(id(name));
      // (the standard output is stereo: a surround file is mixed down by the decoder, as the stereo graph did before)
      await graph(2);
      const levels = await page.evaluate(() => window.g3levels());
      assert.ok(
        levels.slice(0, 2).every((db) => db < -18),
        name,
      );
      console.log('format', name, JSON.stringify(levels));
      await stop();
    }
    const apiStatus = (name, extra = {}) =>
      page.evaluate(
        async ({ id, extra }) => {
          const track = window.__cadenza.lib.get().tracks.find((t) => t.id === id);
          return (
            await fetch(`cadenza://media/${id}${extra.rev ? '?rev=' + encodeURIComponent(track.mediaRevision) : ''}`, {
              method: 'HEAD',
            })
          ).status;
        },
        { id: id(name), extra },
      );
    assert.equal(await apiStatus('locked.ncm'), 404);
    await select([id('broken.wav')]);
    await wait(() => window.__cadenza.api.playback.get().phase === 'error');
    await stop();

    await select([id('medium.wav')]);
    await output(id('medium.wav'));
    await graph();
    measure.medium = await memory();
    await stop();
    await select([id('long.wav')]);
    await output(id('long.wav'));
    await graph();
    const first = decoders();
    assert.deepEqual(first, [{ file: 'long.wav', from: 0 }]);
    const phase = () => page.evaluate(() => window.__cadenza.api.playback.get().phase);
    const time = () => page.evaluate(() => window.__cadenza.api.playback.time());
    await wait(() => window.__cadenza.api.playback.get().phase === 'buffering');
    const heldAt = await time();
    await page.waitForTimeout(250);
    assert.equal(await time(), heldAt, 'clock stopped on actual starvation');
    await output(id('long.wav'));
    await graph();
    measure.long = await memory();
    await page.evaluate(() => window.__cadenza.api.seekFile(2690));
    await output(id('long.wav'));
    await graph();
    assert.ok((await time()) >= 2690 && (await time()) < 2691);
    // the clock goes on from the new position (alpha.6 held it at the seek target while the music played on)
    const afterSeek = await time();
    await page.waitForTimeout(800);
    assert.ok((await time()) - afterSeek > 0.5, `clock moves after a seek: ${afterSeek} → ${await time()}`);
    // (the stream from 0 is closed; the one from 2690 s may already have read its last ten seconds and ended)
    assert.ok(
      decoders().every((d) => d.file === 'long.wav' && d.from === 2690),
      JSON.stringify(decoders()),
    );
    await page.evaluate(() => window.__cadenza.api.playback.get().intent && window.__cadenza.api.toggle());
    assert.equal(await phase(), 'paused');
    await page.evaluate(() => window.__cadenza.api.seekFile(2690.25, true));
    await page.evaluate(() => window.__cadenza.api.seekFile(2690.25));
    assert.equal(await time(), 2690.25);
    await page.evaluate(() => window.__cadenza.api.toggle());
    await graph();
    await stop();
    await page.waitForTimeout(350);
    const final = decoders();
    assert.deepEqual(final, [], 'decoders closed after stop');
    const soakSeconds = Number(process.env.CADENZA_STREAM_SOAK_SECONDS || 0);
    if (soakSeconds > 0) {
      await select([id('long.wav')]);
      await output(id('long.wav'));
      measure.soak = [];
      for (let t = 10; t <= soakSeconds; t += 10) {
        await page.waitForTimeout(10_000);
        assert.equal(await phase(), 'playing');
        measure.soak.push({ seconds: await time(), ...(await memory()) });
      }
      await stop();
    }
    await page.evaluate(
      ([a, b]) => {
        const { api } = window.__cadenza;
        for (let i = 0; i < 60; i++) void api.playIds([i % 2 ? b : a], 0);
      },
      [id('medium.wav'), id('long.wav')],
    );
    await output(id('long.wav'));
    for (let n = 0; n < 12; n++) {
      const next = id(n % 2 ? 'long.wav' : 'medium.wav');
      await select([next]);
      await output(next);
    }
    await stop();
    await page.waitForTimeout(350);
    assert.deepEqual(decoders(), [], 'all decoders closed after a rapid burst and stop');
    await select([id('long.wav')]);
    await output(id('long.wav'));
    await graph();
    fs.appendFileSync(path.join(music, 'long.wav'), 'changed');
    assert.equal(await apiStatus('long.wav', { rev: true }), 409);
    await page.evaluate(() => window.__cadenza.api.seekFile(1700));
    await wait(() => window.__cadenza.api.playback.get().phase === 'error');
    fs.renameSync(path.join(music, 'long.wav'), path.join(music, 'moved.wav'));
    assert.equal(await apiStatus('long.wav', { rev: true }), 404);
    await stop();
    await page.waitForTimeout(750);
    measure.stopped = await memory();
    console.log('streaming', JSON.stringify({ first, final, heldAt, measure }));
    fs.writeFileSync(path.join(scratch, 'results.json'), JSON.stringify({ first, final, heldAt, measure }, null, 2));
    console.log('Evidence:', scratch);
  } finally {
    await app.close();
  }
  if (process.argv.includes('--space')) await spaceAudio(env, id(alac ?? 'WAV 24-bit.wav'));
}

async function spaceAudio(env, id) {
  const settings = path.join(profile, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(fs.readFileSync(settings, 'utf8')), ui: 'space' }));
  const app = await _electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'], env });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__cad && window.__cadenza?.lib.get().loaded);
    await page.evaluate(() => {
      const { engine, pauseAnalysis } = window.__cadenza;
      pauseAnalysis(true, 'space streaming probe');
      engine.clock.warm();
      const ctx = engine.clock.ctx;
      const tap = ctx.createAnalyser();
      tap.fftSize = 2048;
      tap.smoothingTimeConstant = 0;
      const split = ctx.createChannelSplitter(2);
      split.connect(tap, 0);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      tap.connect(silent).connect(ctx.destination);
      const data = new Float32Array(tap.frequencyBinCount);
      const base = engine.audioRoute.bind(engine);
      let selected;
      engine.audioRoute = (node) => {
        if (selected) selected.disconnect(split);
        selected = node;
        if (node) node.connect(split);
        base(node);
      };
      window.roomProbe = {
        routed: () => !!selected,
        level: () => {
          tap.getFloatFrequencyData(data);
          const i = Math.round((375 * tap.fftSize) / ctx.sampleRate);
          return Math.max(data[i - 1], data[i], data[i + 1]);
        },
      };
    });
    const phones = page.locator('#hp');
    await phones.click();
    await page.waitForFunction(() => window.roomProbe.routed());
    await page.evaluate((id) => {
      const { api } = window.__cadenza;
      api.setVolume(1);
      void api.playIds([id], 0, { album: true });
    }, id);
    await page.waitForFunction(() => window.roomProbe.level() > -48);
    await page.waitForTimeout(250);
    const full = await page.evaluate(() => window.roomProbe.level());
    await page.evaluate(() => window.__cadenza.api.setVolume(0.5));
    await page.waitForFunction((full) => Math.abs(full - window.roomProbe.level() - 6.02) < 1.5, full);
    const half = await page.evaluate(() => window.roomProbe.level());
    assert.ok(Math.abs(full - half - 6.02) < 1.5, `room volume: ${full} dB → ${half} dB`);
    await page.evaluate(() => window.__cadenza.engine.setMuted(true));
    await page.waitForFunction(() => window.roomProbe.level() < -70);
    await phones.click();
    await page.waitForFunction(() => !window.roomProbe.routed());
    console.log('space audio', JSON.stringify({ full, half, mute: true, headphoneRouteRestored: true }));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
