const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-identity-desktop-'));
const profile = path.join(scratch, 'profile');
const music = path.join(scratch, 'music');
const folder = path.join(profile, 'library');
const db = path.join(folder, 'db.json');
const first = path.join(music, 'A.wav');
const moved = path.join(music, 'sub', 'Renamed.wav');
const cover = path.join(scratch, 'cover.png');
const old = '11223344';
const fields = { lshift: 0.325, locked: true, style: { theme: 'cover' } };
const media = Buffer.alloc(44 + 44100 * 4 * 3);
media.write('RIFF');
media.writeUInt32LE(media.length - 8, 4);
media.write('WAVEfmt ', 8);
media.writeUInt32LE(16, 16);
media.writeUInt16LE(1, 20);
media.writeUInt16LE(2, 22);
media.writeUInt32LE(44100, 24);
media.writeUInt32LE(176400, 28);
media.writeUInt16LE(4, 32);
media.writeUInt16LE(16, 34);
media.write('data', 36);
media.writeUInt32LE(media.length - 44, 40);
for (let i = 44; i < media.length; i += 2) media.writeInt16LE(Math.round(5200 * Math.sin(i / 39)), i);

function fixtures() {
  fs.mkdirSync(profile);
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  fs.mkdirSync(path.join(folder, 'songs'), { recursive: true });
  fs.writeFileSync(first, media);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=96x96', '-frames:v', '1', cover], {
    windowsHide: true,
  });
  fs.writeFileSync(path.join(music, 'Copy.wav'), media);
  for (let i = 0; i < 64; i++) fs.writeFileSync(path.join(music, `Z${i}.wav`), media);
  const f = fs.statSync(first);
  fs.writeFileSync(path.join(folder, 'songs', old + '.json'), JSON.stringify(fields));
  fs.writeFileSync(
    db,
    JSON.stringify({
      version: 1,
      folders: [music],
      tracks: {
        [old]: {
          id: old,
          path: first,
          size: f.size,
          mtime: f.mtimeMs,
          title: 'A',
          plays: 17,
          codec: 'PCM',
          duration: 3,
          added: Date.now(),
          analyzed: 3,
          loudness: { lufs: -1, peak: 1 },
          ak: 'legacy',
        },
      },
      favorites: [old],
      playlists: [{ id: 'p1', name: 'Kept', tracks: [old] }],
      overrides: { [old]: { title: 'Saved title' } },
    }),
  );
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ lang: 'en', rhythmEngine: 'dsp', closeToTray: false }),
  );
}

async function run() {
  fixtures();
  const launch = () =>
    _electron.launch({
      executablePath: require(path.join(root, 'node_modules', 'electron')),
      args: [root, '--no-sandbox'],
      env: { ...process.env, CADENZA_USER_DATA: profile },
    });
  const app = await launch();
  const started = performance.now();
  try {
    const win = await app.firstWindow();
    await win.waitForFunction(() => window.__cadenza?.lib.get().loaded);
    const readyWindowMs = performance.now() - started;
    await win.evaluate(() => window.__cadenza.pauseAnalysis(true, 'identity test'));
    const snapshot = () => win.evaluate(() => window.cadenzaLib.get());
    const call = (fn, args) => win.evaluate(fn, args);
    const at = (file) =>
      win.waitForFunction(
        (name) => window.__cadenza.lib.get().tracks.some((t) => t.file === name && t.audioContentId),
        file,
      );
    assert.equal(fs.existsSync(path.join(folder, 'db.v1.json')), true);
    const afterWindow = await snapshot();
    const initial = afterWindow.tracks.find((t) => t.id === old);
    assert.equal(initial.title, 'Saved title');
    assert.equal(initial.analyzed, 0);
    assert.equal(initial.loudness, null);
    const sampleGraph = (id) =>
      call(async (id) => {
        const { api, engine } = window.__cadenza;
        engine.clock.warm();
        const ctx = engine.clock.ctx;
        await ctx.resume();
        const tap = ctx.createAnalyser();
        tap.fftSize = 1024;
        const silent = ctx.createGain();
        silent.gain.value = 0;
        tap.connect(silent).connect(ctx.destination);
        engine.audioRoute(tap);
        const data = new Float32Array(tap.fftSize);
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const samples = [];
        try {
          for (let trial = 0; trial < 6; trial++) {
            const drain = performance.now();
            for (;;) {
              tap.getFloatTimeDomainData(data);
              if (data.every((v) => Math.abs(v) < 0.001)) break;
              if (performance.now() - drain > 2000) throw new Error('previous output did not drain');
              await delay(5);
            }
            const t0 = performance.now();
            void api.playIds([id], 0);
            for (;;) {
              tap.getFloatTimeDomainData(data);
              if (api.playback.get().phase === 'playing' && data.some((v) => Math.abs(v) > 0.02)) break;
              if (performance.now() - t0 > 7000) throw new Error('no audio signal');
              await delay(5);
            }
            samples.push({
              ms: performance.now() - t0,
              remaining: window.__cadenza.lib.get().tracks.filter((t) => !t.audioContentId).length,
            });
            api.stopPlayback();
            await delay(90);
          }
          return samples;
        } finally {
          engine.audioRoute(null);
          tap.disconnect();
          silent.disconnect();
        }
      }, id);
    const indexing = await sampleGraph(old);
    assert.ok(indexing.filter((row) => row.remaining > 0).length >= 4);
    await win.waitForFunction(
      () =>
        window.__cadenza.lib.get().tracks.length === 66 &&
        window.__cadenza.lib.get().tracks.every((t) => t.audioContentId),
    );
    const steady = await sampleGraph(old);
    console.log('Cadenza graph timing', JSON.stringify({ readyWindowMs, indexing, steady }));
    await at('A.wav');
    await at('Copy.wav');
    const rows = (await snapshot()).tracks;
    const a = rows.find((t) => t.file === 'A.wav');
    const b = rows.find((t) => t.file === 'Copy.wav');
    assert.equal(a.id, old);
    assert.notEqual(a.id, b.id);
    assert.equal(a.audioContentId, b.audioContentId);
    await win.locator('[data-test=titlebar] [data-test=edit-mode]').click();
    await win.locator('[data-test=titlebar] [data-test=edit-mode][aria-pressed=true]').waitFor();
    await call((id) => window.cadenzaLib.setSong(id, { lshift: 0.55 }), b.id);
    assert.deepEqual(await call((id) => window.cadenzaLib.song(id), old), fields);
    assert.equal((await call((id) => window.cadenzaLib.song(id), b.id)).lshift, 0.55);

    const token = await call((id) => window.cadenzaLib.analysisToken(id), old);
    const analysis = { version: 77, beats: [0, 0.5], loudness: { lufs: -20, peak: 0.4 } };
    const save = (token) =>
      call(({ token, analysis }) => window.cadenzaLib.saveAnalysis(token.id, analysis, token), { token, analysis });
    assert.equal(await save(token), true);
    assert.deepEqual(await call((id) => window.cadenzaLib.analysis(id, 77), b.id), analysis);
    await call(() => window.__cadenza.setSettings({ rhythmEngine: 'auto' }));
    assert.equal(await call((id) => window.cadenzaLib.analysis(id, 77), b.id), null);
    assert.equal(await save(token), false);
    await call(() => window.__cadenza.setSettings({ rhythmEngine: 'dsp' }));
    assert.deepEqual(await call((id) => window.cadenzaLib.analysis(id, 77), b.id), analysis);
    await call((id) => window.cadenzaLib.writeLyrics(id, '\n[00:01.00]\n\nKeep sections\n', 'lrc'), old);
    const lyricEdit = (await snapshot()).tracks.find((t) => t.id === old);
    assert.ok(lyricEdit.lyricsRevision > a.lyricsRevision);
    assert.equal(lyricEdit.metadataRevision, a.metadataRevision);
    assert.equal(lyricEdit.audioContentId, a.audioContentId);
    await call((id) => window.cadenzaLib.editMeta(id, { title: 'Edited' }), old);
    const metaEdit = (await snapshot()).tracks.find((t) => t.id === old);
    assert.ok(metaEdit.metadataRevision > lyricEdit.metadataRevision);
    assert.equal(metaEdit.lyricsRevision, lyricEdit.lyricsRevision);
    assert.equal(metaEdit.analyzed, 77);
    assert.equal(metaEdit.audioContentId, a.audioContentId);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, cover);
    assert.equal(await call((id) => window.cadenzaLib.setCover(id, { file: true }), old), true);
    const coverEdit = (await snapshot()).tracks.find((t) => t.id === old);
    assert.ok(coverEdit.cover && coverEdit.coverSet);
    assert.ok(coverEdit.metadataRevision > metaEdit.metadataRevision);
    assert.equal(coverEdit.lyricsRevision, metaEdit.lyricsRevision);
    assert.equal(coverEdit.audioContentId, a.audioContentId);
    assert.equal(coverEdit.analyzed, 77);

    fs.renameSync(first, moved);
    await call(() => window.cadenzaLib.rescan());
    await at('Renamed.wav');
    const renamed = (await snapshot()).tracks.find((t) => t.file === 'Renamed.wav');
    assert.equal(renamed.id, old);
    assert.ok(renamed.plays >= 17);
    assert.equal(renamed.title, 'Edited');
    assert.equal(renamed.analyzed, 77);
    assert.deepEqual(await call((id) => window.cadenzaLib.song(id), old), fields);

    // Change a tiny subsection outside the old 64 KiB head, middle and tail windows.
    const changed = Buffer.from(media);
    changed[128000] ^= 1;
    fs.writeFileSync(moved, changed);
    assert.equal(await call((id) => window.cadenzaLib.analysis(id, 77), old), null);
    assert.equal(await save(token), false);
    await call(() => window.cadenzaLib.rescan());
    await win.waitForFunction(
      (id) =>
        window.__cadenza.lib.get().tracks.some((t) => t.file === 'Renamed.wav' && t.id !== id && t.audioContentId),
      old,
    );
    const replaced = await snapshot();
    const newer = replaced.tracks.find((t) => t.file === 'Renamed.wav');
    assert.notEqual(newer.audioContentId, a.audioContentId);
    assert.equal(newer.analyzed, 0);
    assert.equal(newer.plays, 0);
    assert.ok(replaced.identityConflicts.some((c) => c.id === old && c.reason === 'changed'));
    assert.deepEqual(replaced.favorites, [old]);
    assert.deepEqual(replaced.playlists[0].tracks, [old]);
    assert.deepEqual(await call((id) => window.cadenzaLib.analysis(id, 77), b.id), analysis);

    const alias = await call((id) => window.cadenzaLib.analysisToken(id), b.id);
    await call(() => window.cadenzaLib.clearCaches());
    assert.equal(await save(alias), false);
    assert.equal(await call((id) => window.cadenzaLib.analysis(id, 77), b.id), null);
    assert.equal(await save(await call((id) => window.cadenzaLib.analysisToken(id), b.id)), true);

    const faults = await app.evaluate((_electron, root) => {
      const load = process.getBuiltinModule('node:module').createRequire(root + '/package.json');
      const identity = load('./electron/audio-identity.cjs');
      const original = identity.fingerprint;
      const counts = { 'Transient.wav': 0, 'Recheck.wav': 0 };
      identity.fingerprint = (binary, file, stamp, signal) => {
        const name = load('node:path').basename(file);
        if (
          name === 'Reboot.wav' ||
          (Object.hasOwn(counts, name) && ++counts[name] <= (name === 'Transient.wav' ? 1 : 3))
        ) {
          throw Object.assign(new Error('injected disk contention'), { code: 'EBUSY' });
        }
        return original(binary, file, stamp, signal);
      };
      return true;
    }, root);
    assert.equal(faults, true);
    fs.writeFileSync(path.join(music, 'Transient.wav'), media);
    fs.writeFileSync(path.join(music, 'Recheck.wav'), media);
    await call(() => window.cadenzaLib.rescan());
    await at('Transient.wav');
    await win.waitForFunction(() =>
      window.__cadenza.lib.get().tracks.some((t) => t.file === 'Recheck.wav' && t.identityState === 'unverified'),
    );
    const unverified = (await snapshot()).tracks.find((t) => t.file === 'Recheck.wav');
    assert.equal(await call((id) => window.cadenzaLib.analysisToken(id), unverified.id), null);
    await call(() => window.cadenzaLib.rescan());
    await at('Recheck.wav');
    const rechecked = (await snapshot()).tracks.find((t) => t.file === 'Recheck.wav');
    assert.equal(rechecked.id, unverified.id);
    assert.equal(rechecked.audioContentId, a.audioContentId);
    fs.writeFileSync(path.join(music, 'Reboot.wav'), media);
    await call(() => window.cadenzaLib.rescan());
    await win.waitForFunction(() =>
      window.__cadenza.lib.get().tracks.some((t) => t.file === 'Reboot.wav' && t.identityState === 'unverified'),
    );
    await call(() => window.cadenzaDesktop.setSettings({ scanOnLaunch: false }));
    const cache = path.join(folder, 'rhythm-v2');
    fs.writeFileSync(
      path.join(
        cache,
        fs.readdirSync(cache).find((name) => /-77\.json\.gz$/.test(name)),
      ),
      'damaged',
    );
    assert.equal(await call((id) => window.cadenzaLib.analysis(id, 77), b.id), null);
    assert.equal(await save(await call((id) => window.cadenzaLib.analysisToken(id), b.id)), true);
  } finally {
    await app.close();
  }
  const saved = JSON.parse(fs.readFileSync(db, 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.favorites, [old]);
  assert.equal(saved.tracks[old].detached, 'changed');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'songs', old + '.json'), 'utf8')), fields);
  const copy = Object.values(saved.tracks).find((track) => path.basename(track.path) === 'Copy.wav');
  const reboot = Object.values(saved.tracks).find((track) => path.basename(track.path) === 'Reboot.wav');
  assert.equal(reboot.identityError, true);
  assert.equal(saved.fieldOrigins[old].title.source, 'manual');
  const reopened = await launch();
  try {
    const win = await reopened.firstWindow();
    await win.waitForFunction(() => window.__cadenza?.lib.get().loaded);
    await win.evaluate(() => window.__cadenza.pauseAnalysis(true, 'identity test'));
    await win.waitForFunction(
      (id) => window.__cadenza.lib.get().tracks.some((t) => t.id === id && t.identityState === 'verified'),
      reboot.id,
    );
    const state = await win.evaluate(async (id) => {
      const view = await window.cadenzaLib.get();
      return {
        track: view.tracks.find((track) => track.id === id),
        analysis: await window.cadenzaLib.analysis(id, 77),
      };
    }, copy.id);
    assert.equal(state.track.audioContentId, copy.audioContentId);
    assert.equal(state.analysis.version, 77);
  } finally {
    await reopened.close();
  }
  console.log('Evidence:', scratch);
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
