// Windows Electron regression with an isolated profile and generated PCM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');
const ROOT = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g2-playback-'));
const music = path.join(scratch, 'music');
const sampleRate = 48000;
const tones = [375, 750, 1125, 1500, 1875];
fs.mkdirSync(music);
for (let i = 0; i < tones.length; i++) {
  const size = 12 * sampleRate * 2;
  const wav = Buffer.alloc(44 + size);
  wav.write('RIFF');
  wav.writeUInt32LE(size + 36, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(size, 40);
  for (let n = 0; n < size / 2; n++) {
    wav.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * tones[i] * n) / sampleRate)), 44 + n * 2);
  }
  fs.writeFileSync(path.join(music, i + '.wav'), wav);
  fs.writeFileSync(path.join(music, i + '.lrc'), '[00:01.00]Visual line ' + i + '\n');
}

async function run(route, crash = false) {
  const prof = path.join(scratch, crash ? 'crash' : route);
  fs.mkdirSync(prof);
  initializeProfile(prof, identifyBuild(require('../package.json').version));
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
      rhythmStream: 'full',
      audioOut: route === 'hifi' ? 'hifi' : 'standard',
      prerender: false,
      closeToTray: false,
      fixedVolume: true,
    }),
  );
  const env = { ...process.env, CADENZA_USER_DATA: prof };
  delete env.CADENZA_AUDIO_FAKE;
  if (route === 'hifi')
    env.CADENZA_AUDIO_FAKE = 'rates=48000;fmts=i16;dump=' + path.join(prof, 'pcm') + (crash ? ';crash-after=0.6' : '');
  const app = await _electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')),
    args: [ROOT, '--no-sandbox'],
    env,
  });
  try {
    const win = await app.firstWindow();
    const errors = [];
    win.on('pageerror', (e) => errors.push(e.message));
    const wait = (fn, a) => win.waitForFunction(fn, a, { timeout: 12000 });
    const run = (fn, a) => win.evaluate(fn, a);
    await wait(() => !!window.__cadenza?.pauseAnalysis);
    await run(() => window.__cadenza.pauseAnalysis(true, 'g2 fixture'));
    await wait(() => window.__cadenza?.lib.get().tracks.length === 5);
    if (crash) {
      await run(() => {
        window.crashEvents = [];
        window.cadenzaAudio.onEvent((e) => window.crashEvents.push(e));
        const { api, lib } = window.__cadenza;
        void api.playIds([lib.get().tracks[0].id], 0);
      });
      await wait(() => window.crashEvents.some((e) => e.ev === 'pos' && e.run));
      await wait(() => window.__cadenza.api.playback.get().error === 'hifi-down');
      await wait(() => {
        const stopped = window.crashEvents.find((e) => e.ev === 'down');
        return stopped && window.crashEvents.some((e) => e.ev === 'hello' && e.processEpoch > stopped.processEpoch);
      });
      assert.equal(await run(() => window.__cadenza.api.playback.get().intent), false);
      assert.equal(await run(() => window.__cadenza.api.playback.get().output), null);
      assert.deepEqual(errors, []);
      console.log('pass hifi child fault: replacement process is ready without restoring a revoked run');
      return;
    }
    await run(() => {
      const { api, lib } = window.__cadenza;
      const id = lib.get().tracks.find((t) => t.file === '0.wav')?.id || lib.get().tracks[0].id;
      return api.playIds([id], 0, { play: false });
    });
    await wait(() => !!window.__cadenza?.player.get().session);
    const q = await run(async (route) => {
      const { lib, engine, player } = window.__cadenza;
      const ids = [...lib.get().tracks].sort((a, b) => a.file.localeCompare(b.file)).map((t) => t.id);
      const sessionType = player.get().session.constructor;
      const planOf = sessionType.prototype.planOf;
      const open = sessionType.open;
      const post = Worker.prototype.postMessage;
      const fontLoad = document.fonts.load.bind(document.fonts);
      const gates = (window.g2 = {
        plans: [],
        rhythm: [],
        fonts: [],
        holdFont: false,
        delay: '',
        fail: '',
        plansId: '',
        events: [],
      });
      document.fonts.load = (...args) =>
        gates.holdFont
          ? new Promise((resolve, reject) => gates.fonts.push(() => fontLoad(...args).then(resolve, reject)))
          : fontLoad(...args);
      sessionType.prototype.planOf = function (...args) {
        if (this.spec.key !== gates.plansId) return planOf.apply(this, args);
        return new Promise((resolve) => gates.plans.push(() => resolve(planOf.apply(this, args))));
      };
      sessionType.open = function (spec, ...rest) {
        if (spec.key === gates.fail) throw new Error('g2 fixture: scene unavailable');
        return open.call(this, spec, ...rest);
      };
      Worker.prototype.postMessage = function (message, ...args) {
        if (gates.delay && message.channels && !message.only) {
          gates.rhythm.push(() => post.call(this, message, ...args));
        } else post.call(this, message, ...args);
      };
      if (route === 'std') {
        engine.clock.warm();
        const ctx = engine.clock.ctx;
        await ctx.resume();
        const a = ctx.createAnalyser();
        a.fftSize = 1024;
        a.smoothingTimeConstant = 0;
        const quiet = ctx.createGain();
        quiet.gain.value = 0.02;
        a.connect(quiet);
        quiet.connect(ctx.destination);
        engine.audioRoute(a);
        const bins = new Float32Array(a.frequencyBinCount);
        gates.graphSignal = (frequency) => {
          a.getFloatFrequencyData(bins);
          return bins[Math.round((frequency * a.fftSize) / ctx.sampleRate)] > -50;
        };
      } else {
        window.cadenzaAudio.onEvent((event) => {
          gates.events.push(event);
          if (gates.events.length > 3000) gates.events.shift();
        });
      }
      return ids;
    }, route);
    const target = (i) =>
      wait(
        ({ id, route }) => {
          const state = window.__cadenza.api.playback.get();
          return state.output?.id === id && state.route === route;
        },
        { id: q[i], route },
      );

    await wait(() => window.__cadenza.lib.get().analysisFor == null);
    await run(async (id) => {
      await window.cadenzaLib.reanalyze([id]);
      window.g2.delay = id;
      const a = window.__cadenza.api;
      a.setMode('stop');
      void a.playIds([id], 0);
    }, q[1]);
    await wait(() => window.g2.rhythm.length > 0);
    await target(1);
    assert.equal(await run(() => window.__cadenza.player.get().session), null);
    if (route === 'std') {
      await wait((hz) => window.g2.graphSignal(hz), tones[1]);
    } else {
      // Samples sent to the simulated endpoint, beyond its silent lock period.
      await win.waitForTimeout(100);
      const dump = fs.readdirSync(prof).find((name) => /^pcm-.+-48000-i16-ex\.raw$/.test(name));
      assert.ok(dump, 'native endpoint dump');
      const pcm = fs.readFileSync(path.join(prof, dump));
      assert.ok(pcm.subarray(-8192).some((value) => value !== 0));
    }
    await run((id) => {
      window.g2.delay = '';
      window.g2.holdFont = true;
      window.g2.plansId = id;
      for (const resolve of window.g2.rhythm.splice(0)) resolve();
    }, q[1]);
    await wait(() => window.g2.fonts.length > 0);
    assert.equal(await run(() => window.__cadenza.player.get().session), null);
    await target(1);
    await run(() => {
      window.g2.holdFont = false;
      for (const resolve of window.g2.fonts.splice(0)) resolve();
    });
    await wait(() => window.g2.plans.length === 1);
    assert.equal(await run(() => window.__cadenza.player.get().session), null);
    // The old scene is still in the planner while A → B → C changes audio.
    await run(
      (ids) => {
        const a = window.__cadenza.api;
        void a.playIds(ids, 0);
        void a.playQueueAt(1);
        void a.playQueueAt(2);
        a.seekFile(4);
        a.toggle();
      },
      [q[2], q[0], q[3]],
    );
    await wait(() => window.__cadenza.api.playback.get().phase === 'paused');
    const last = await run(() => JSON.parse(localStorage.getItem('cz-last')));
    assert.deepEqual(last, { q: [q[2], q[0], q[3]], i: 2 });
    assert.deepEqual(
      await run(() => {
        const s = window.__cadenza.api.playback.get();
        return [s.index, s.position, s.output, window.__cadenza.player.get().session];
      }),
      [2, 4, null, null],
    );
    await run(() => window.__cadenza.api.toggle());
    await target(3);
    if (route === 'std') {
      await wait((hz) => window.g2.graphSignal(hz), tones[3]);
      assert.equal(await run((hz) => window.g2.graphSignal(hz), tones[1]), false);
    }
    await run((id) => {
      window.g2.fail = id;
      window.g2.plansId = '';
      window.g2.plans.shift()();
    }, q[3]);
    await wait(() => !!window.__cadenza.player.get().visualError);
    assert.equal(await run(() => window.__cadenza.api.playback.get().phase), 'playing');

    // Backend EOF advances the queue while the effect UI still has no scene.
    await run(
      (ids) => {
        const { api, ui } = window.__cadenza;
        ui.set({ layer: 'fx' });
        void api.playIds(ids, 0, { album: true });
        api.seekFile(11.5);
      },
      [q[3], q[4]],
    );
    await target(4);
    await wait((id) => window.__cadenza.player.get().session?.spec.key === id, q[4]);
    assert.equal(await run(() => window.__cadenza.api.playback.get().index), 1);
    const mediaToggle = () =>
      app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((w) => !w.isDestroyed())
          .webContents.send('media', 'toggle');
      });
    await mediaToggle();
    await wait(() => window.__cadenza.api.playback.get().phase === 'paused');
    const drag = await run(() => {
      const { api, player } = window.__cadenza;
      let notifications = 0;
      const off = player.subscribe(() => notifications++);
      const rev = player.get().rev;
      for (let i = 0; i < 240; i++) api.seekFile(0.25 + i / 40, true);
      api.seekFile(6.25);
      off();
      return { notifications, visualRevisions: player.get().rev - rev, position: api.playback.time() };
    });
    assert.deepEqual(drag, { notifications: 0, visualRevisions: 0, position: 6.25 });
    await mediaToggle();
    await target(4);
    // Exercise the renderer and the native command pipe under repeated revocation.
    await run(() => {
      window.g2.fail = '';
    });
    for (let batch = 0; batch < 12; batch++) {
      const final = batch % q.length;
      await run(
        async ({ ids, final }) => {
          const a = window.__cadenza.api;
          void a.playIds(ids, 0);
          for (let i = 1; i <= 8; i++) void a.playQueueAt(i % ids.length);
          await a.playQueueAt(final);
        },
        { ids: q, final },
      );
      await target(final);
    }
    await run(() => {
      window.__cadenza.api.stopPlayback();
      window.__cadenza.api.stopPlayback();
    });
    if (route === 'std') {
      await wait((hz) => hz.every((f) => !window.g2.graphSignal(f)), tones);
      assert.equal(await run(() => window.__cadenza.engine.clock.src), null);
    } else {
      try {
        await wait(() => window.g2.events.filter((e) => e.ev === 'pos').at(-1)?.id === null);
      } catch (error) {
        console.error(
          await run(() => ({ playback: window.__cadenza.api.playback.get(), tail: window.g2.events.slice(-15) })),
        );
        throw error;
      }
      await run((id) => window.__cadenza.api.playIds([id], 0), q[4]);
      await target(4);
      await wait((id) => window.__cadenza.player.get().session?.spec.key === id, q[4]);
      await win.keyboard.press('Control+Shift+E');
      await win.locator('[data-test=titlebar] [data-test=edit-mode][aria-pressed=true]').waitFor({ state: 'attached' });
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('lib:writeLyrics');
        ipcMain.handle(
          'lib:writeLyrics',
          () =>
            new Promise((resolve) => {
              globalThis.completeReviewLyrics = () => resolve({ ok: true });
            }),
        );
      });
      await run(() => {
        const { api, settings } = window.__cadenza;
        settings.set({ lyricsTarget: 'tag' });
        window.g2.tagEdit = api.useLyrics('[00:01.00]Review lyrics');
      });
      // Alert the user controls while the tagged file is unavailable. The later edit completion cannot restore old intent.
      await wait(() => window.__cadenza.api.playback.get().phase === 'preparing');
      await run(() => {
        const a = window.__cadenza.api;
        a.seekFile(6.5);
        a.toggle();
      });
      let pending = false;
      for (let i = 0; i < 100 && !pending; i++) {
        pending = await app.evaluate(() => typeof globalThis.completeReviewLyrics === 'function');
        if (!pending) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(pending, 'the tag write reached the main process after native close acknowledgement');
      await app.evaluate(() => globalThis.completeReviewLyrics());
      await run(() => window.g2.tagEdit);
      assert.deepEqual(
        await run(() => {
          const a = window.__cadenza.api;
          const { intent, phase } = a.playback.get();
          return { intent, phase, position: a.playback.time() };
        }),
        { intent: false, phase: 'paused', position: 6.5 },
      );
    }
    await run((id) => {
      window.g2.plansId = id;
      return window.__cadenza.api.playIds([id], 0, { play: false });
    }, q[1]);
    await wait(() => window.g2.plans.length > 0);
    const cancelled = await run(async (id) => {
      const a = window.__cadenza.api;
      const waiter = a.waitForVisual(id);
      a.stopPlayback();
      return Promise.race([waiter, new Promise((resolve) => setTimeout(() => resolve('pending'), 500))]);
    }, q[1]);
    assert.equal(cancelled, null);
    assert.deepEqual(errors, []);
    console.log(
      'pass',
      route,
      'signal during rhythm/font/planner delays, latest paused seek, stale/failed visuals, EOF, media toggle, repeated revocation and stop',
    );
  } finally {
    await app.close();
  }
}

(async () => {
  for (const route of process.argv.slice(2).length ? process.argv.slice(2) : ['std', 'hifi', 'crash']) {
    await run(route === 'crash' ? 'hifi' : route, route === 'crash');
  }
  console.log('Evidence:', scratch);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
