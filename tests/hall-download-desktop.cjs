const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { initializeProfile, identifyBuild } = require('../electron/profile.cjs');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-hall-download-'));
const profile = path.join(scratch, 'profile');
const music = path.join(scratch, 'destination');
const fixture = path.join(scratch, 'response.flac');
const translation = '[offset:50]\n[00:00.50]Translation\n\n[00:02.50]\n';
const lyrics =
  '[500,1000](500,500,0)A fixture (1050,450,0)line\n\n[2500,300]\n[3000,1000](3000,1000,0)Another fixture\n';

(async () => {
  fs.mkdirSync(music);
  const standalone = path.join(scratch, 'standalone');
  fs.mkdirSync(standalone);
  fs.mkdirSync(profile);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ closeToTray: false, rhythmEngine: 'dsp' }));
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.03*sin(2*PI*375*t):s=48000:d=5', '-c:a', 'flac', fixture],
    { windowsHide: true },
  );
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, CADENZA_USER_DATA: profile },
  });
  try {
    const main = await app.firstWindow();
    await main.waitForFunction(() => window.__cadenza?.lib.get().loaded);
    await main.evaluate(() => window.__cadenza.pauseAnalysis(true, 'download-fixture'));
    const evidence = await app.evaluate(
      async (_electron, { root, music, fixture, lyrics, translation, standalone }) => {
        const require = process.getBuiltinModule('node:module').createRequire(root + '/package.json');
        const fs = require('node:fs/promises');
        const { createDownloads } = require('./electron/online-downloads.cjs');
        const library = require('./electron/library.cjs');
        const data = await fs.readFile(fixture);
        const previous = globalThis.fetch;
        globalThis.fetch = async (url, ...args) => {
          if (String(url) === 'https://media.fixture.example/cadenza-fixture')
            return new Response(data, {
              headers: { 'Content-Type': 'audio/flac', 'Content-Length': String(data.length) },
            });
          if (String(url) === 'https://media.fixture.example/cadenza-redirect')
            return new Response(null, { status: 302, headers: { location: 'https://offlist.fixture.example/block' } });
          if (String(url).includes('offlist.fixture.example'))
            throw new Error('Download must never contact an off-list host');
          if (String(url) === 'https://media.fixture.example/cadenza-html')
            return new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } });
          return previous(url, ...args);
        };
        let failOnce = true;
        const manager = createDownloads({
          nativeBin: require('./electron/audio.cjs').binPath,
          publish() {},
          library: {
            writeOnlineSidecars: library.writeOnlineSidecars,
            importOnline: async (input) => {
              if (failOnce) {
                failOnce = false;
                throw new Error('injected import failure');
              }
              return library.importOnline(input);
            },
          },
          resolve: async (job) => ({
            url:
              'https://media.fixture.example/cadenza-' +
              (job.track === 'broken' ? 'html' : job.track === 'redirect' ? 'redirect' : 'fixture'),
            permission: job.track === 'preview' ? 'stream' : 'save',
            transport: { mediaDomains: ['media.fixture.example'] },
            expiresAt: Date.now() + 8000,
            size: data.length,
            codec: 'flac',
            tier: 'lossless',
            lyrics: { text: lyrics, format: 'yrc', auxiliary: { translation } },
            track: {
              ref: {
                provider: 'fixture',
                namespace: 'songs',
                id: job.track,
                access: { kind: 'public' },
                availability: {},
              },
              title: 'Synthetic',
              artist: 'Fixture',
              album: 'Local test',
              duration: 5,
            },
          }),
        });
        const enqueue = (track, conflict) =>
          manager.add({ folder: music, title: 'Fixture', tier: 'lossless', track, conflict }).id;
        const wait = async (id) => {
          for (let n = 0; n < 160; n++) {
            const job = manager.snapshot().find((item) => item.id === id);
            if (['complete', 'failed', 'cancelled', 'skipped'].includes(job.state)) return job;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error('Download test did not reach a terminal state');
        };
        try {
          const original = enqueue('original', 'keep');
          const failed = await wait(original);
          const filesBeforeRetry = await fs.readdir(music);
          manager.act(original, 'retry');
          const recovered = await wait(original);
          const rejected = await wait(enqueue('broken', 'keep'));
          const restricted = await wait(enqueue('preview', 'keep'));
          const redirected = await wait(enqueue('redirect', 'keep'));
          const skipped = await wait(enqueue('original', 'skip'));
          const duplicate = await wait(enqueue('original', 'keep'));
          const saveOnly = await wait(
            manager.add({
              folder: standalone,
              tier: 'lossless',
              title: 'Fixture',
              track: 'standalone',
              conflict: 'keep',
              settings: { fields: ['title'], naming: 'title', lyricFile: 'external', importTrack: false },
            }).id,
          );

          return {
            failed,
            filesBeforeRetry,
            recovered,
            rejected,
            restricted,
            redirected,
            skipped,
            duplicate,
            saveOnly,
            standaloneFiles: await fs.readdir(standalone),
            savedFile: manager.savedFile(original),
            files: await fs.readdir(music),
          };
        } finally {
          await manager.close();
          globalThis.fetch = previous;
        }
      },
      { root, music, fixture, lyrics, translation, standalone },
    );
    assert.equal(evidence.failed.problem, 'import-failed', JSON.stringify(evidence));
    assert.deepEqual(evidence.filesBeforeRetry, ['Fixture - Synthetic.flac']);
    assert.equal(evidence.recovered.state, 'complete');
    assert.equal(evidence.saveOnly.state, 'complete', JSON.stringify(evidence));
    assert.deepEqual(evidence.standaloneFiles, [
      'Synthetic.flac',
      'Synthetic.flac.translation.lrc',
      'Synthetic.flac.yrc',
    ]);
    assert.equal(fs.readFileSync(path.join(standalone, 'Synthetic.flac.yrc'), 'utf8'), lyrics);
    const only = await (await import('music-metadata')).parseFile(path.join(standalone, 'Synthetic.flac'));
    assert.equal(only.common.title, 'Synthetic');
    assert.equal(only.common.album, undefined);
    assert.deepEqual(await require('../electron/flac-lyrics.cjs').fields(path.join(standalone, 'Synthetic.flac')), []);

    assert.equal(evidence.savedFile, path.join(music, 'Fixture - Synthetic.flac'));
    assert.equal(evidence.rejected.problem, 'invalid-response');
    assert.equal(evidence.restricted.problem, 'restricted');
    assert.equal(evidence.redirected.problem, 'restricted');
    assert.equal(evidence.skipped.state, 'skipped');
    assert.equal(evidence.duplicate.state, 'complete');
    assert.deepEqual(evidence.files, ['Fixture - Synthetic (2).flac', 'Fixture - Synthetic.flac']);
    await main.waitForFunction(() => window.__cadenza.lib.get().tracks.length === 2);
    const tracks = await main.evaluate(() => window.__cadenza.lib.get().tracks);
    assert.notEqual(tracks[0].id, tracks[1].id);
    assert.equal(tracks[0].audioContentId, tracks[1].audioContentId);
    const data = JSON.parse(fs.readFileSync(path.join(profile, 'library', 'db.json'), 'utf8'));
    assert.equal(data.sourceLinks.length, 2);
    const found = await main.evaluate((id) => window.cadenzaLib.lyrics(id), tracks[0].id);
    assert.equal(found.text, lyrics);
    const sources = await main.evaluate((id) => window.cadenzaLib.lyricSources(id), tracks[0].id);
    assert.equal(sources.fields.find((field) => field.id.startsWith('flac:LYRICS_TRANSLATION:')).text, translation);
    assert.equal(sources.primary, 'flac:YRC:0');
    const nativeFields = await require('../electron/flac-lyrics.cjs').fields(
      path.join(music, 'Fixture - Synthetic.flac'),
    );
    assert.equal(nativeFields.find((field) => field.key === 'LYRICS_TRANSLATION').text, translation);
    await main.evaluate((id) => window.__cadenza.api.playIds([id], 0), tracks[0].id);
    await main.waitForFunction(() => window.__cadenza.api.playback.get().phase === 'playing');
    console.log(
      'Verified Windows download handling, import recovery, collision choices, lyrics, content IDs, links and playable local files',
    );
  } finally {
    await app.close();
  }
  const fresh = path.join(scratch, 'fresh-profile');
  fs.mkdirSync(fresh);
  initializeProfile(fresh, identifyBuild(require('../package.json').version));
  fs.mkdirSync(path.join(fresh, 'library'), { recursive: true });
  fs.writeFileSync(path.join(fresh, 'library', 'db.json'), JSON.stringify({ version: 1, folders: [music] }));
  fs.writeFileSync(path.join(fresh, 'settings.json'), JSON.stringify({ closeToTray: false, rhythmEngine: 'dsp' }));
  const restored = await _electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, CADENZA_USER_DATA: fresh },
  });
  try {
    const main = await restored.firstWindow();
    await main.waitForFunction(() => window.__cadenza?.lib.get().tracks.length === 2);
    const found = await main.evaluate(() => window.cadenzaLib.lyricSources(window.__cadenza.lib.get().tracks[0].id));
    assert.equal(found.fields.find((field) => field.id === 'flac:LYRICS_TRANSLATION:0').text, translation);
    assert.equal(found.fields.find((field) => field.id === 'flac:YRC:0').text, lyrics);
    assert.equal(found.primary, 'flac:YRC:0');
    console.log('Fresh isolated profile recovered embedded original and translation directly from FLAC');
  } finally {
    await restored.close();
  }
  console.log('Evidence:', scratch);
})().catch((error) => {
  console.error(error);
  console.error('Evidence:', scratch);
  process.exitCode = 1;
});
