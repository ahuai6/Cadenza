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
const lyrics = '[00:00.50]A fixture line\n\n[00:02.50]\n[00:03.00]Another fixture\n';

(async () => {
  fs.mkdirSync(music);
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
      async (_electron, { root, music, fixture, lyrics, translation }) => {
        const require = process.getBuiltinModule('node:module').createRequire(root + '/package.json');
        const fs = require('node:fs/promises');
        const { createDownloads } = require('./electron/online-downloads.cjs');
        const library = require('./electron/library.cjs');
        const data = await fs.readFile(fixture);
        const previous = globalThis.fetch;
        globalThis.fetch = async (url, ...args) => {
          if (String(url) === 'https://music.126.net/cadenza-fixture')
            return new Response(data, {
              headers: { 'Content-Type': 'audio/flac', 'Content-Length': String(data.length) },
            });
          if (String(url) === 'https://music.126.net/cadenza-html')
            return new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } });
          return previous(url, ...args);
        };
        let failOnce = true;
        const manager = createDownloads({
          nativeBin: require('./electron/audio.cjs').binPath,
          publish() {},
          library: {
            importOnline: async (input) => {
              if (failOnce) {
                failOnce = false;
                throw new Error('injected import failure');
              }
              return library.importOnline(input);
            },
          },
          resolve: async (job) => ({
            url: 'https://music.126.net/cadenza-' + (job.track === 'broken' ? 'html' : 'fixture'),
            permission: job.track === 'preview' ? 'stream' : 'save',
            expiresAt: Date.now() + 8000,
            size: data.length,
            codec: 'flac',
            tier: 'lossless',
            lyrics: { text: lyrics, auxiliary: { translation } },
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
          const skipped = await wait(enqueue('original', 'skip'));
          const duplicate = await wait(enqueue('original', 'keep'));
          return {
            failed,
            filesBeforeRetry,
            recovered,
            rejected,
            restricted,
            skipped,
            duplicate,
            files: await fs.readdir(music),
          };
        } finally {
          await manager.close();
          globalThis.fetch = previous;
        }
      },
      { root, music, fixture, lyrics, translation },
    );
    assert.equal(evidence.failed.problem, 'import-failed', JSON.stringify(evidence));
    assert.deepEqual(evidence.filesBeforeRetry, ['Fixture - Synthetic.flac']);
    assert.equal(evidence.recovered.state, 'complete');
    assert.equal(evidence.rejected.problem, 'invalid-response');
    assert.equal(evidence.restricted.problem, 'restricted');
    assert.equal(evidence.skipped.state, 'skipped');
    assert.equal(evidence.duplicate.state, 'complete');
    assert.deepEqual(evidence.files, [
      'Fixture - Synthetic (2).flac',
      'Fixture - Synthetic (2).flac.translation.lrc',
      'Fixture - Synthetic.flac',
      'Fixture - Synthetic.flac.translation.lrc',
    ]);
    await main.waitForFunction(() => window.__cadenza.lib.get().tracks.length === 2);
    const tracks = await main.evaluate(() => window.__cadenza.lib.get().tracks);
    assert.notEqual(tracks[0].id, tracks[1].id);
    assert.equal(tracks[0].audioContentId, tracks[1].audioContentId);
    const data = JSON.parse(fs.readFileSync(path.join(profile, 'library', 'db.json'), 'utf8'));
    assert.equal(data.sourceLinks.length, 2);
    const found = await main.evaluate((id) => window.cadenzaLib.lyrics(id), tracks[0].id);
    assert.equal(found.text, lyrics);
    const sources = await main.evaluate((id) => window.cadenzaLib.lyricSources(id), tracks[0].id);
    assert.equal(sources.fields.find((field) => field.id === 'sidecar:translation').text, translation);
    assert.notEqual(sources.primary, 'sidecar:translation');
    await main.evaluate((id) => window.__cadenza.api.playIds([id], 0), tracks[0].id);
    await main.waitForFunction(() => window.__cadenza.api.playback.get().phase === 'playing');
    console.log(
      'Verified Windows download handling, import recovery, collision choices, lyrics, content IDs, links and playable local files',
    );
  } finally {
    await app.close();
  }
  console.log('Evidence:', scratch);
})().catch((error) => {
  console.error(error);
  console.error('Evidence:', scratch);
  process.exitCode = 1;
});
