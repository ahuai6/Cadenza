// Diagnostic markers from the graph and simulated DAC. Neither marker measures audible output at a physical endpoint.
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const [snapshot, out] = process.argv.slice(2);
const scratch = fs.realpathSync(process.env.CADENZA_BASELINE_ROOT || '');
if (!out || path.dirname(out) !== scratch || fs.existsSync(out)) throw new Error('Use the isolated baseline runner');
const count = 30;
const sampleRate = 48_000;
const frequencies = [375, 1125];
const music = path.join(out, 'music');
fs.mkdirSync(music, { recursive: true });

// A name and small amplitude change make every cold destination a distinct entry with the same measurable tone.
function tone(i) {
  const seconds = 12;
  const buffer = Buffer.alloc(44 + seconds * sampleRate * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  for (let n = 0; n < seconds * sampleRate; n++) {
    const value = Math.round((7000 + i * 40) * Math.sin((2 * Math.PI * frequencies[i % 2] * n) / sampleRate));
    buffer.writeInt16LE(value, 44 + 2 * n);
  }
  const name = String(i).padStart(2, '0');
  fs.writeFileSync(path.join(music, name + '.wav'), buffer);
  fs.writeFileSync(path.join(music, name + '.lrc'), '[00:00.50]The first line\n[00:02.00]The second line\n');
}
for (let i = 0; i < count + 2; i++) tone(i);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentiles(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0 };
  const at = (p) => Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 10) / 10;
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95) };
}

function tapFakeDevice(directory) {
  const offsets = new Map();
  const markers = [];
  const block = Buffer.alloc(256 * 2 * 2); // 256 stereo s16 frames, about 5 ms at 48 kHz.
  function sample() {
    for (const name of fs.readdirSync(directory).filter((name) => name.endsWith('-48000-i16-ex.raw'))) {
      const file = path.join(directory, name);
      const length = fs.statSync(file).size;
      let offset = offsets.get(name) ?? 0;
      if (length - offset < block.length) continue;
      const fd = fs.openSync(file, 'r');
      try {
        while (length - offset >= block.length && fs.readSync(fd, block, 0, block.length, offset) === block.length) {
          let peak = 0;
          let crossings = 0;
          let sign = 0;
          for (let i = 0; i < block.length; i += 4) {
            const amplitude = block.readInt16LE(i);
            peak = Math.max(peak, Math.abs(amplitude));
            if (Math.abs(amplitude) < 100) continue;
            const next = Math.sign(amplitude);
            if (sign && sign !== next) crossings++;
            sign = next;
          }
          markers.push({ time: Date.now(), tone: peak < 400 ? null : crossings >= 8 ? 1 : 0 });
          offset += block.length;
        }
      } finally {
        fs.closeSync(fd);
      }
      offsets.set(name, offset);
    }
  }
  const timer = setInterval(sample, 5);
  return { markers, close: () => clearInterval(timer) };
}

async function measure(mode) {
  const prof = path.join(out, mode);
  fs.mkdirSync(path.join(prof, 'library'), { recursive: true });
  fs.writeFileSync(
    path.join(prof, 'library', 'db.json'),
    JSON.stringify({
      version: 1,
      folders: [music],
      tracks: {},
      favorites: [],
      playlists: [],
      overrides: {},
    }),
  );
  fs.writeFileSync(
    path.join(prof, 'settings.json'),
    JSON.stringify({
      lang: 'en',
      rhythmEngine: 'dsp',
      prerender: false,
      closeToTray: false,
      audioOut: mode === 'standard' ? 'standard' : 'hifi',
      audioMode: 'exclusive',
      fixedVolume: true,
    }),
  );
  const env = { ...process.env, CADENZA_USER_DATA: prof };
  const dump = path.join(prof, 'fake-dac');
  if (mode === 'fake-hifi') {
    fs.mkdirSync(dump);
    env.CADENZA_AUDIO_FAKE = 'rates=48000;fmts=i16;dump=' + path.join(dump, 'out');
  }
  const app = await electron.launch({
    executablePath: require(path.join(snapshot, 'node_modules', 'electron')),
    args: [snapshot, '--no-sandbox', '--user-data-dir=' + prof],
    env,
  });
  const tap = mode === 'fake-hifi' ? tapFakeDevice(dump) : null;
  const rows = [];
  try {
    const win = await app.firstWindow();
    await win.waitForFunction((n) => window.__cadenza?.lib?.get().tracks.length === n, count + 2, { timeout: 60_000 });
    await win.keyboard.press('Tab');
    await win.evaluate(
      async ({ mode, frequencies }) => {
        const { api, lib, engine, player, pauseAnalysis } = window.__cadenza;
        pauseAnalysis(true, 'baseline');
        let sample = null;
        let analyser;
        let bins;
        if (mode === 'standard') {
          engine.clock.warm();
          const ctx = engine.clock.ctx;
          await ctx.resume();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0;
          bins = new Float32Array(analyser.frequencyBinCount);
          // Keep the render graph active without routing the synthetic tone to the listener's device.
          const muted = ctx.createGain();
          muted.gain.value = 0;
          analyser.connect(muted);
          muted.connect(ctx.destination);
          engine.audioRoute(analyser);
        } else {
          window.cadenzaAudio.onEvent((event) => {
            const s = sample;
            if (!s || event.ev !== 'pos') return;
            const now = performance.now() - s.start;
            if (event.id === s.target && event.run) s.firstRunningPositionMs ??= now;
          });
        }
        const original = console.info;
        console.info = (...args) => {
          if (args[0] === '[start]' && sample && player.get().shownId === sample.target) {
            sample.initialVisualMs ??= performance.now() - sample.start;
            sample.phases = JSON.parse(args[3]);
          }
          original.apply(console, args);
        };
        // The trace marks the initial planned presentation. A partial rhythm plan may be replaced later.
        setInterval(() => {
          const s = sample;
          if (!s) return;
          const now = performance.now() - s.start;
          if (analyser) {
            analyser.getFloatFrequencyData(bins);
            const active = (parity) => {
              const bin = Math.round((frequencies[parity] * analyser.fftSize) / analyser.context.sampleRate);
              return Math.max(bins[bin - 1], bins[bin], bins[bin + 1]) > -50;
            };
            if (s.previous && !active(1 - s.parity)) s.oldSignalEndedMs ??= now;
            if (active(s.parity)) s.newSignalMs ??= now;
          }
          const p = player.get();
          if (p.shownId === s.target && p.session?.plan && p.session.analysis && !p.session.analysis.partial)
            s.fullPlanMs ??= now;
          if (p.id === s.target && p.error) s.error = p.error;
        }, 8);
        const ids = [...lib.get().tracks].sort((a, b) => a.file.localeCompare(b.file)).map((track) => track.id);
        window.baselinePlay = (index, previous) => {
          sample = {
            index,
            start: performance.now(),
            epoch: Date.now(),
            target: ids[index],
            previous: ids[previous],
            parity: index % 2,
          };
          void api.playIds([ids[index]], 0);
        };
        window.baselineSample = () => sample;
      },
      { mode, frequencies },
    );

    let previous;
    const cases = [
      ['first', [0]],
      ['prime-warm', [1, 0]],
      ['warm', Array.from({ length: count }, (_, i) => (i + 1) % 2)],
      // The warm route ends on 0. Start on an odd tone to distinguish old and new signals.
      ['cache-cold', Array.from({ length: count }, (_, i) => count + 1 - i)],
    ];
    for (const [scenario, destinations] of cases) {
      for (const index of destinations) {
        await win.evaluate(({ index, previous }) => window.baselinePlay(index, previous), { index, previous });
        let timedOut = false;
        try {
          await win.waitForFunction(
            () => {
              const s = window.baselineSample();
              return (
                s.error ||
                ((s.newSignalMs != null || s.firstRunningPositionMs != null) &&
                  s.initialVisualMs != null &&
                  (s.previous == null || s.oldSignalEndedMs != null || s.firstRunningPositionMs != null))
              );
            },
            null,
            { timeout: 15_000, polling: 25 },
          );
        } catch {
          timedOut = true;
        }
        await sleep(90);
        const row = { scenario, timedOut, ...(await win.evaluate(() => window.baselineSample())) };
        if (tap) {
          const after = tap.markers.filter((marker) => marker.time >= row.epoch);
          const firstNew = after.findIndex((marker) => marker.tone === row.parity);
          if (firstNew >= 0) {
            row.newSignalMs = after[firstNew].time - row.epoch;
            // Find the first block after the previous tone ends, before the new tone runs.
            if (row.previous) {
              const lastOld = after.slice(0, firstNew).findLastIndex((marker) => marker.tone === 1 - row.parity);
              row.oldSignalEndedMs = after[lastOld + 1].time - row.epoch;
            }
          }
          if (row.newSignalMs == null) row.error ??= 'No new tone was found in simulated PCM';
        }
        rows.push(row);
        if (timedOut || rows.at(-1).error) break;
        previous = index;
      }
      if (rows.at(-1)?.timedOut || rows.at(-1)?.error) break;
    }
  } finally {
    tap?.close();
    await app.close();
    const summary = {};
    for (const scenario of ['first', 'warm', 'cache-cold']) {
      const matches = rows.filter((row) => row.scenario === scenario);
      summary[scenario] = {
        attempted: matches.length,
        failures: matches.filter((row) => row.timedOut || row.error).length,
        ...Object.fromEntries(
          ['oldSignalEndedMs', 'newSignalMs', 'initialVisualMs', 'fullPlanMs', 'firstRunningPositionMs'].map(
            (metric) => [metric, percentiles(matches.map((row) => row[metric]))],
          ),
        ),
      };
    }
    fs.writeFileSync(path.join(out, mode + '.json'), JSON.stringify({ mode, summary, rows }, null, 2) + '\n');
    console.log(mode, JSON.stringify(summary));
  }
  return rows.length === 3 + count * 2 && rows.every((row) => !row.timedOut && !row.error);
}

(async () => {
  const standard = await measure('standard');
  const native = path.join(
    snapshot,
    'native',
    'cadenza-audio',
    'target',
    'release',
    process.platform === 'win32' ? 'cadenza-audio.exe' : 'cadenza-audio',
  );
  if (!fs.existsSync(native)) {
    console.log('blocked: simulated Hi-Fi requires the baseline native executable');
    process.exitCode = standard ? 2 : 1;
    return;
  }
  const hifi = await measure('fake-hifi');
  process.exitCode = standard && hifi ? 0 : 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
