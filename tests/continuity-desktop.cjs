// The picture across a change of song (4.0.0-alpha.6): with the effect lyrics open, the next song is asked for and the
// engine's canvas is sampled every frame until the next song's scene is shown. Before alpha.6 the canvas was cleared
// while the next scene was built (a black screen under music that had already moved on); now the song before is held
// and fades over the next one. Also checks that the lyric list's lines come in with a rise, not in a single frame,
// and that a seek and a restart (previous) leave the picture moving on from the new position (alpha.6 froze it).
// Needs FFmpeg and a Playwright that Node can resolve (NODE_PATH), as the other desktop suites.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-continuity-'));
const profile = path.join(scratch, 'profile');
const music = path.join(scratch, 'music');

async function main() {
  fs.mkdirSync(profile);
  fs.mkdirSync(music);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  for (const [i, hz] of [330, 392, 494].entries()) {
    const file = path.join(music, `${i + 1} tone.flac`);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=0.2*sin(2*PI*${hz}*t)*(1+0.5*sin(2*PI*2*t)):s=44100:d=20:c=stereo`,
      file,
    ]);
    fs.writeFileSync(
      file.replace(/\.flac$/, '.lrc'),
      Array.from(
        { length: 8 },
        (_, k) => `[00:${String(1 + k * 2).padStart(2, '0')}.00]Line ${k + 1} of song ${i + 1}`,
      ).join('\n'),
    );
  }
  fs.mkdirSync(path.join(profile, 'library'));
  fs.writeFileSync(
    path.join(profile, 'library', 'db.json'),
    JSON.stringify({ version: 1, folders: [music], tracks: {}, favorites: [], playlists: [], overrides: {} }),
  );
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ closeToTray: false, rhythmEngine: 'dsp', audioOut: 'standard', lang: 'en' }),
  );
  const env = { ...process.env, CADENZA_USER_DATA: profile };
  delete env.CADENZA_AUDIO_FAKE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'], env });
  const results = {};
  try {
    const page = await app.firstWindow();
    const wait = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });
    await wait(() => window.__cadenza?.lib.get().tracks.filter((t) => t.duration > 0).length === 3);
    const ids = await page.evaluate(() =>
      window.__cadenza.lib
        .get()
        .tracks.slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((t) => t.id),
    );
    await page.evaluate((ids) => {
      const { api, layers } = window.__cadenza;
      api.setVolume(0.2);
      void api.playIds(ids, 0);
      layers.openFx();
    }, ids);
    await wait((id) => window.__cadenza.api.player.get().session?.spec.key === id, ids[0]);
    await page.waitForTimeout(2500);
    for (const transition of ['next', 'album']) {
      if (transition === 'album')
        await page.evaluate((ids) => void window.__cadenza.api.playIds(ids, 1, { album: true }), ids);
      // sample the canvas every frame: is anything drawn (any pixel not transparent)?
      const frames = await page.evaluate(
        async ({ transition, target }) => {
          const { api, engine } = window.__cadenza;
          const canvas = engine.canvas;
          const probe = document.createElement('canvas');
          probe.width = 64;
          probe.height = 40;
          const g = probe.getContext('2d', { willReadFrequently: true });
          const covered = () => {
            g.clearRect(0, 0, 64, 40);
            g.drawImage(canvas, 0, 0, 64, 40);
            const d = g.getImageData(0, 0, 64, 40).data;
            let drawn = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 8) drawn++;
            return drawn / (64 * 40);
          };
          if (transition === 'next') void api.next();
          const out = [];
          const t0 = performance.now();
          await new Promise((resolve) => {
            const step = () => {
              const p = api.player.get();
              out.push({
                ms: Math.round(performance.now() - t0),
                covered: covered(),
                shown: p.session?.spec.key ?? null,
              });
              if ((p.session?.spec.key === target && performance.now() - t0 > 1500) || performance.now() - t0 > 8000)
                resolve();
              else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          });
          return out;
        },
        { transition, target: transition === 'next' ? ids[1] : ids[1] },
      );
      const until = frames.findIndex((f) => f.shown === ids[1]);
      const emptiest = Math.min(...frames.map((f) => f.covered));
      results[transition] = {
        frames: frames.length,
        sceneShownAfterMs: until >= 0 ? frames[until].ms : null,
        emptiestFrame: +emptiest.toFixed(3),
        emptyFrames: frames.filter((f) => f.covered < 0.5).length,
      };
      console.log(transition, JSON.stringify(results[transition]));
      assert.ok(until >= 0, `${transition}: the next scene was shown`);
      assert.ok(emptiest > 0.5, `${transition}: a frame was left empty while the next scene was built`);
      await page.waitForTimeout(2500);
    }
    // songs skipped in a row, each before the one before has its scene (4.0.0-alpha.7): the held picture stays
    const rapid = await page.evaluate(async () => {
      const { api, engine } = window.__cadenza;
      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 40;
      const g = probe.getContext('2d', { willReadFrequently: true });
      const covered = () => {
        g.clearRect(0, 0, 64, 40);
        g.drawImage(engine.canvas, 0, 0, 64, 40);
        const d = g.getImageData(0, 0, 64, 40).data;
        let drawn = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) drawn++;
        return drawn / (64 * 40);
      };
      const out = [];
      const t0 = performance.now();
      let skips = 0;
      await new Promise((resolve) => {
        const step = () => {
          const ms = performance.now() - t0;
          if (skips < 5 && ms >= skips * 120) {
            skips++;
            void api.next();
          }
          out.push(covered());
          if (ms > 4000) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      return { frames: out.length, emptiest: +Math.min(...out).toFixed(3), empty: out.filter((c) => c < 0.5).length };
    });
    console.log('rapid', JSON.stringify(rapid));
    results.rapid = rapid;
    assert.ok(rapid.emptiest > 0.5, 'songs skipped in a row: a frame was left empty');
    await page.waitForTimeout(2500);
    // a seek and a restart (previous, past the first seconds): the picture goes on from the new position
    for (const action of ['seek', 'previous']) {
      const moved = await page.evaluate(async (action) => {
        const { api, engine } = window.__cadenza;
        if (action === 'seek') api.seekFile(12);
        else void api.prev();
        const target = action === 'seek' ? 12 : 0;
        const t0 = performance.now();
        while (!api.player.get().playing && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
        const from = engine.time;
        await new Promise((r) => setTimeout(r, 1000));
        return { target, from: +from.toFixed(3), after: +engine.time.toFixed(3) };
      }, action);
      console.log(action, JSON.stringify(moved));
      results[action] = moved;
      assert.ok(Math.abs(moved.from - moved.target) < 0.5, `${action}: the clock went to the new position`);
      assert.ok(moved.after - moved.from > 0.6, `${action}: the picture's clock moves on from the new position`);
      await page.waitForTimeout(3500);
    }
    // the lyric list: its lines rise in when a new song's scene arrives
    await page.evaluate(() => window.__cadenza.layers.openNp());
    await page.waitForTimeout(800);
    const rise = await page.evaluate(async (id) => {
      const { api } = window.__cadenza;
      void api.playIds([id], 0);
      const t0 = performance.now();
      for (;;) {
        await new Promise((r) => requestAnimationFrame(r));
        const box = document.querySelector('[data-np-lyr]');
        if (box && api.player.get().session?.spec.key === id) {
          return {
            ms: Math.round(performance.now() - t0),
            animations: box.getAnimations().length,
            opacity: +getComputedStyle(box).opacity,
          };
        }
        if (performance.now() - t0 > 8000) return null;
      }
    }, ids[2]);
    console.log('lyrics', JSON.stringify(rise));
    results.lyrics = rise;
    assert.ok(rise && rise.animations === 1 && rise.opacity < 0.9, 'the new lines rise in');
  } finally {
    await app.close();
  }
  fs.writeFileSync(path.join(scratch, 'results.json'), JSON.stringify(results, null, 2));
  console.log('Evidence:', scratch);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
