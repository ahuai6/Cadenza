// Gapless playback (4.0.0-alpha.6): one continuous sine is cut into two files at a point that is not a block boundary
// and played as an album, through the standard output (recorded after the page's volume gain) and through the Hi-Fi
// output (the simulated device's own dump of what was written to it, exclusive at the file's rate). A gap, a dropped or
// repeated stretch or a level step shows as a jump in the sine's recurrence x[n+1] = 2cos(w)x[n] - x[n-1], or as a
// shift of its phase after the join. Also checks that the player moves to the next song without buffering and that
// its clock carries on across the boundary.
// Needs FFmpeg and a Playwright that Node can resolve (NODE_PATH), as the other desktop suites.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-gapless-'));
const music = path.join(scratch, 'music');
const HZ = 441;
const CUT = 3.7123;
const LENGTH = 8;
// [encoder flags, rate, lossy]: a pair at a rate of its own, one at CD rate, one with an encoder delay.
// AAC halves are encoded each on its own, so their edges carry the codec's own error (a reference decoder joining the
// two shows a step of the same size): for them the test checks that no sample is added or lost at the join.
const pairs = {
  wav: [['-c:a', 'pcm_s16le'], 48000, false],
  flac: [['-c:a', 'flac'], 44100, false],
  m4a: [['-c:a', 'aac', '-b:a', '256k'], 44100, true],
};

/** the phase of a tone of angular frequency w (radians a sample) over [from, to) */
function phase(x, w, from, to) {
  let s = 0,
    c = 0;
  for (let n = from; n < to; n++) {
    s += x[n] * Math.sin(w * n);
    c += x[n] * Math.cos(w * n);
  }
  return Math.atan2(c, s);
}

// each pair is cut from a tone made at its own rate, so the files themselves join exactly
function cut(ext, flags, rate) {
  const source = path.join(scratch, `tone-${rate}.wav`);
  if (!fs.existsSync(source))
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=0.3*sin(2*PI*${HZ}*t):s=${rate}:d=${LENGTH}:c=stereo`,
      source,
    ]);
  const at = Math.round(CUT * rate);
  const a = path.join(music, `${ext} 1.${ext}`),
    b = path.join(music, `${ext} 2.${ext}`);
  execFileSync('ffmpeg', ['-v', 'error', '-i', source, '-af', `atrim=end_sample=${at}`, ...flags, a]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    source,
    '-af',
    `atrim=start_sample=${at},asetpts=PTS-STARTPTS`,
    ...flags,
    b,
  ]);
}

/** The joined tone in `x` (one channel at `rate`), checked across the boundary. */
function examine(label, x, rate, lossy, extra) {
  const w = (2 * Math.PI * HZ) / rate;
  const k = 2 * Math.cos(w);
  const first = x.findIndex((v) => Math.abs(v) > 0.05);
  const boundary = first + Math.round(CUT * rate);
  assert.ok(first >= 0 && x.length > boundary + 6000, `${label}: the recording reaches past the join`);
  let worst = 0,
    worstAt = -1,
    quiet = 0,
    run = 0;
  // skip the first song's opening (a resampler's first samples) and stop where the recording stopped
  const last = Math.min(x.length - 1, boundary + Math.round(1.0 * rate));
  for (let n = first + 400; n < last; n++) {
    const r = Math.abs(x[n + 1] - k * x[n] + x[n - 1]);
    if (r > worst) {
      worst = r;
      worstAt = n;
    }
    run = Math.abs(x[n]) < 1e-4 ? run + 1 : 0;
    quiet = Math.max(quiet, run);
  }
  // what an ordinary sample of this sine gives, for scale
  let typical = 0;
  for (let n = first + 400; n < first + 4400; n++)
    typical = Math.max(typical, Math.abs(x[n + 1] - k * x[n] + x[n - 1]));
  // samples added or lost at the join shift the tone's phase after it
  let shift = phase(x, w, boundary + 2000, boundary + 6000) - phase(x, w, boundary - 6000, boundary - 2000);
  shift = Math.atan2(Math.sin(shift), Math.cos(shift)) / w;
  const result = {
    rate,
    boundaryAt: boundary,
    worstResidual: +worst.toFixed(5),
    worstAt,
    typicalResidual: +typical.toFixed(5),
    longestSilence: quiet,
    shiftSamples: +shift.toFixed(3),
    ...extra,
  };
  console.log(label, JSON.stringify(result));
  // a step of this size is audible as a click; a gap of a millisecond leaves a run of zeros
  if (!lossy)
    assert.ok(
      worst < Math.max(0.01, typical * 4),
      `${label}: discontinuity ${worst} at ${worstAt} (boundary ${boundary})`,
    );
  assert.ok(Math.abs(shift) < 0.5, `${label}: ${shift} samples added or lost at the join`);
  assert.ok(quiet < 16, `${label}: ${quiet} silent samples in the joined tone`);
  assert.ok(!extra.buffering, `${label}: the next song buffered`);
  assert.ok(extra.clock > 0.6 && extra.clock < 1.4, `${label}: clock ${extra.clock} a moment into the second song`);
  return result;
}

async function run(route) {
  const profile = path.join(scratch, 'profile-' + route);
  const dumps = path.join(scratch, 'dump-' + route);
  fs.mkdirSync(profile);
  fs.mkdirSync(dumps);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  fs.mkdirSync(path.join(profile, 'library'));
  fs.writeFileSync(
    path.join(profile, 'library', 'db.json'),
    JSON.stringify({ version: 1, folders: [music], tracks: {}, favorites: [], playlists: [], overrides: {} }),
  );
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ closeToTray: false, prerender: true, rhythmEngine: 'dsp', audioOut: route, lang: 'en' }),
  );
  const env = { ...process.env, CADENZA_USER_DATA: profile };
  delete env.CADENZA_AUDIO_FAKE;
  // the Hi-Fi output on a simulated device that takes each file's own rate exclusively and keeps what it was given
  if (route === 'hifi') env.CADENZA_AUDIO_FAKE = `rates=44100,48000;fmts=i16;dump=${path.join(dumps, 'pcm')}`;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'], env });
  const results = {};
  try {
    const page = await app.firstWindow();
    const wait = (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout });
    await wait(() => window.__cadenza?.lib.get().tracks.filter((t) => t.duration > 0).length === 6);
    await page.evaluate(async () => {
      const { api, engine, pauseAnalysis } = window.__cadenza;
      pauseAnalysis(true, 'gapless probe');
      api.setMode('stop');
      api.setVolume(1);
      engine.clock.warm();
      const ctx = engine.clock.ctx;
      await ctx.resume();
      // a recorder after the gain: channel 0, every quantum
      const source = `registerProcessor('rec', class extends AudioWorkletProcessor {
        process(inputs) { const c = inputs[0][0]; if (c) this.port.postMessage(c.slice()); return true; }
      });`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      const rec = new AudioWorkletNode(ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 0 });
      window.recorded = [];
      window.recording = false;
      rec.port.onmessage = (e) => window.recording && window.recorded.push(e.data);
      engine.audioRoute(rec);
    });
    for (const [ext, [, rate, lossy]] of Object.entries(pairs)) {
      const ids = await page.evaluate(
        (ext) =>
          window.__cadenza.lib
            .get()
            .tracks.filter((t) => t.title.startsWith(ext + ' '))
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((t) => t.id),
        ext,
      );
      assert.equal(ids.length, 2, ext);
      // (one device stream can carry several pairs: only what is written from here on is this pair's)
      const before = new Map(fs.readdirSync(dumps).map((name) => [name, fs.statSync(path.join(dumps, name)).size]));
      await page.evaluate((ids) => {
        window.recorded = [];
        window.phases = [];
        const { api } = window.__cadenza;
        window.offPhases = api.playback.subscribe((s) =>
          window.phases.push([s.output?.id ?? null, s.target?.id ?? null, s.phase, s.route]),
        );
        window.recording = true;
        void api.playIds(ids, 0, { album: true });
      }, ids);
      await wait((id) => window.__cadenza.api.playback.get().output?.id === id, ids[1], 30000);
      // the clock across the boundary: B's time a moment after it began
      await page.waitForTimeout(800);
      const clock = await page.evaluate(() => window.__cadenza.api.playback.time());
      await page.waitForTimeout(600);
      const record = await page.evaluate(() => {
        window.recording = false;
        window.offPhases();
        const { api, engine } = window.__cadenza;
        api.stopPlayback();
        const out = new Float32Array(window.recorded.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const c of window.recorded) out.set(c, (at += c.length) - c.length);
        return { samples: Array.from(out), rate: engine.clock.ctx.sampleRate, phases: window.phases };
      });
      const buffering = record.phases.some(([, target, state]) => target === ids[1] && state === 'buffering');
      const routes = [...new Set(record.phases.map((p) => p[3]))];
      assert.deepEqual(routes, [route === 'hifi' ? 'hifi' : 'std'], `${ext}: played through ${routes}`);
      if (route === 'standard') {
        results[ext] = examine(`std ${ext}`, record.samples, record.rate, lossy, { clock, buffering });
      } else {
        await page.waitForTimeout(400);
        // what the device was given: 16-bit stereo, the newest stream at this pair's rate
        const files = fs
          .readdirSync(dumps)
          .filter((name) => name.includes(`-${rate}-i16`))
          .map((name) => ({ name, size: fs.statSync(path.join(dumps, name)).size - (before.get(name) ?? 0) }))
          .sort((a, b) => b.size - a.size);
        assert.ok(files.length, `${ext}: a device stream at ${rate} Hz`);
        const bytes = fs.readFileSync(path.join(dumps, files[0].name)).subarray(before.get(files[0].name) ?? 0);
        const x = new Float64Array(bytes.length >> 2);
        for (let i = 0; i < x.length; i++) x[i] = bytes.readInt16LE(i * 4) / 32768;
        results[ext] = examine(`hifi ${ext}`, x, rate, lossy, { clock, buffering, stream: files[0].name });
      }
    }
  } finally {
    await app.close();
  }
  return results;
}

async function main() {
  fs.mkdirSync(music);
  for (const [ext, [flags, rate]] of Object.entries(pairs)) cut(ext, flags, rate);
  const results = { standard: await run('standard'), hifi: await run('hifi') };
  fs.writeFileSync(path.join(scratch, 'results.json'), JSON.stringify(results, null, 2));
  console.log('Evidence:', scratch);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
