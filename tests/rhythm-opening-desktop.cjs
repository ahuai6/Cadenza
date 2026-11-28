// A song not read before (4.0.0 phase 3): with the effect lyrics open, its scene shows on a reading of its opening,
// carried over the whole song on its own beat — so the picture has beats from its first frame and wherever the song is
// taken — and the whole reading takes its place at the peak of a blur transition, not in a plain crossfade. Two plays
// of a synthetic 4-minute song in an isolated profile: one taken to 2:30 four seconds in, one left to play.
// Needs FFmpeg, the desktop suites' fixtures (tests/.cache, see docs/TESTING.md) and a Playwright that Node can resolve.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');

const root = path.join(__dirname, '..');
const source = path.join(__dirname, '.cache', 'songpop86.wav');

async function play(seek) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-opening-'));
  const profile = path.join(scratch, 'profile'),
    music = path.join(scratch, 'music');
  fs.mkdirSync(profile);
  fs.mkdirSync(music);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    source,
    '-i',
    source,
    '-filter_complex',
    '[0:a][1:a]concat=n=2:v=0:a=1',
    path.join(music, 'Four minutes.flac'),
  ]);
  fs.writeFileSync(
    path.join(music, 'Four minutes.lrc'),
    Array.from({ length: 60 }, (_, k) => {
      const t = 2 + k * 4;
      return `[${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}.00]Line ${k + 1}`;
    }).join('\n'),
  );
  fs.mkdirSync(path.join(profile, 'library'));
  fs.writeFileSync(
    path.join(profile, 'library', 'db.json'),
    JSON.stringify({ version: 2, folders: [music], tracks: {}, favorites: [], playlists: [], overrides: {} }),
  );
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ closeToTray: false, rhythmEngine: 'dsp', audioOut: 'standard', lang: 'en' }),
  );
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [root, '--no-sandbox'],
    env: { ...process.env, CADENZA_USER_DATA: profile },
  });
  try {
    const page = await app.firstWindow();
    // (its identity known, so the analysis can start the moment it is played; nothing read yet)
    await page.waitForFunction(() => window.__cadenza?.lib.get().tracks[0]?.audioContentId, null, { timeout: 120000 });
    const id = await page.evaluate(() => window.__cadenza.lib.get().tracks[0].id);
    await page.evaluate(() => window.__cadenza.api.setVolume(0.15));
    return await page.evaluate(
      async ({ id, seek }) => {
        const { api, engine, layers } = window.__cadenza;
        layers.openFx();
        const t0 = performance.now();
        const out = { scene: null, partialAtScene: null, beatsAtStart: null, beatsAfterSeek: null, swap: null };
        let plan = null;
        void api.playIds([id], 0);
        for (;;) {
          await new Promise((r) => requestAnimationFrame(r));
          const ms = performance.now() - t0;
          const s = api.player.get().session;
          if (s && out.scene === null) {
            out.scene = Math.round(ms);
            out.partialAtScene = !!s.analysis?.partial;
          }
          if (s && out.beatsAtStart === null && engine.time > 1)
            out.beatsAtStart = s.map.eventsIn(0, engine.time + 2, 0).length;
          if (s && seek && ms > 4000 && out.seekAt === undefined) {
            api.seekFile(150);
            out.seekAt = Math.round(ms);
          }
          if (s && out.seekAt !== undefined && out.beatsAfterSeek === null && engine.time > 150.5)
            out.beatsAfterSeek = s.map.eventsIn(149, 153, 0).length;
          if (s && plan && s.plan !== plan && !s.analysis?.partial && !out.swap) {
            const t = engine.time;
            const passage = s.plan.passages.find((P) => Math.abs(P.t - t) < 0.2);
            out.swap = {
              ms: Math.round(ms),
              t: +t.toFixed(2),
              atPassage: !!passage,
              seeking: out.seekAt !== undefined,
            };
          }
          plan = s?.plan ?? plan;
          // (a seek is a cut in the picture: the reading may be put in place with it, before the beats there are counted)
          if ((out.swap && (!seek || out.beatsAfterSeek !== null)) || ms > 60000) return out;
        }
      },
      { id, seek },
    );
  } finally {
    await app.close();
  }
}

async function main() {
  const seeking = await play(true);
  console.log('seek', JSON.stringify(seeking));
  assert.ok(seeking.partialAtScene, 'the scene shows on the reading of the opening');
  assert.ok(seeking.beatsAtStart > 0, 'the picture has beats from the start');
  assert.ok(seeking.beatsAfterSeek > 0, 'taken to 2:30, the picture still has beats there');
  assert.ok(seeking.swap, 'the whole reading is put in place');

  const steady = await play(false);
  console.log('steady', JSON.stringify(steady));
  assert.ok(steady.partialAtScene, 'the scene shows on the reading of the opening');
  assert.ok(steady.swap?.atPassage, 'the whole reading takes its place at a blur transition');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
