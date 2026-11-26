const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { initializeProfile, identifyBuild } = require('../electron/profile.cjs');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-hall-live-'));
const profile = path.join(scratch, 'profile');
const music = path.join(scratch, 'music');

async function run() {
  fs.mkdirSync(music);
  fs.mkdirSync(profile);
  initializeProfile(profile, identifyBuild(require('../package.json').version));
  fs.mkdirSync(path.join(profile, 'library'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'library', 'db.json'), JSON.stringify({ version: 1, folders: [music] }));
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      lang: 'zh-CN',
      closeToTray: false,
      rhythmEngine: 'dsp',
      audioOut: 'standard',
    }),
  );
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.02*sin(2*PI*375*t):s=48000:d=90',
      '-c:a',
      'flac',
      path.join(music, 'local-tone.flac'),
    ],
    { windowsHide: true },
  );
  const app = await _electron.launch({
    executablePath: process.env.CADENZA_TEST_EXE || require('electron'),
    args: process.env.CADENZA_TEST_EXE ? [] : [root],
    env: { ...process.env, CADENZA_USER_DATA: profile },
  });
  try {
    const main = await app.firstWindow();
    const errors = [];
    main.on('pageerror', (error) => errors.push(error.message));
    await main.waitForFunction(() => window.__cadenza?.lib.get().tracks.length === 1);
    const initial = await main.evaluate(async () => {
      const { api, lib, engine, pauseAnalysis } = window.__cadenza;
      pauseAnalysis(true, 'hall-fixture');
      engine.clock.warm();
      const ctx = engine.clock.ctx;
      const tap = ctx.createAnalyser();
      const quiet = ctx.createGain();
      quiet.gain.value = 0.03;
      tap.connect(quiet).connect(ctx.destination);
      tap.fftSize = 1024;
      const buffer = new Float32Array(1024);
      window.hallWave = () => {
        tap.getFloatTimeDomainData(buffer);
        return buffer.some((value) => Math.abs(value) > 0.045);
      };
      engine.audioRoute(tap);
      await api.playIds([lib.get().tracks[0].id], 0);
      return api.playback.get().target;
    });
    await main.waitForFunction(() => window.__cadenza.api.playback.get().phase === 'playing');
    const next = app.waitForEvent('window');
    await main.locator('[data-test=open-hall]').click();
    const hall = await next;
    hall.on('pageerror', (error) => errors.push(error.message));
    await hall.locator('[data-test=music-hall]').waitFor();
    assert.equal(await hall.evaluate(() => !!window.cadenzaAudio || !!window.cadenzaLib), false);
    for (const [id, name] of [
      ['netease', '网易云音乐'],
      ['qq', 'QQ 音乐'],
      ['kugou', '酷狗音乐'],
      ['apple', 'Apple Music'],
    ]) {
      await hall.locator('#platform-' + id).click();
      await hall.getByLabel('歌曲搜索').fill(id === 'apple' ? 'Bohemian Rhapsody' : 'Bach');
      await hall.getByRole('button', { name: '搜索', exact: true }).click();
      const section = hall.getByRole('region', { name: '在线目录' });
      if (id === 'qq') {
        const warning = section.getByRole('status').filter({ hasText: /来源|超时|未找到|没有可用|返回|失败|请求/ });
        await section.locator('div[aria-busy=false] ul li').first().or(warning).first().waitFor({ timeout: 18000 });
        if (await warning.count()) {
          assert.equal(await section.locator('ul li').count(), 0);
          console.log(
            'QQ search returned explicit upstream unavailability or no results:',
            await warning.allTextContents(),
          );
          continue;
        }
      }
      await section.locator('div[aria-busy=false] ul li').first().waitFor({ timeout: 18000 });
      const count = await section.locator('div[aria-busy=false] ul li').count();
      assert.ok(count > 0, name);
      console.log('Live catalog:', id, count);
    }
    const snap = await hall.evaluate(() => window.cadenzaHall.read());
    assert.deepEqual(
      snap.providers.map((p) => p.id),
      ['netease', 'qq', 'kugou', 'apple'],
    );
    assert.equal(snap.providers.find((p) => p.id === 'apple').capabilities.download, 'unavailable');
    const charts = await hall.evaluate(() => window.cadenzaHall.catalog('qq', 'charts', {}));
    assert.ok(charts.ok && charts.data.rows.length > 0, JSON.stringify(charts));
    assert.ok(charts.data.rows.every((row) => row.ref.namespace === 'charts'));
    console.log('Live QQ charts:', charts.data.rows.length);
    await hall.getByRole('button', { name: '试听', exact: true }).first().click();
    await hall.getByText(/^正在试听/).waitFor({ timeout: 25000 });
    await main.waitForFunction(() => window.__cadenza.api.playback.get().phase === 'paused' && window.hallWave());
    await main.waitForFunction(() => window.__cadenza.api.playback.time() > 0);
    const held = await main.evaluate(() => window.__cadenza.api.playback.get());
    assert.deepEqual(held.target, initial);
    assert.equal(held.queue.length, 1);
    await hall.screenshot({ path: path.join(scratch, 'music-hall.png') });
    await hall.locator('[data-test=hall-titlebar] button[data-op=close]').click();
    await main.waitForFunction(() => window.__cadenza.api.playback.get().phase === 'playing');
    const resumed = await main.evaluate(() => ({
      at: window.__cadenza.api.playback.time(),
      target: window.__cadenza.api.playback.get().target,
    }));
    assert.deepEqual(resumed.target, initial);
    assert.ok(resumed.at >= held.position - 0.03);
    const reopened = app.waitForEvent('window');
    await main.locator('[data-test=open-hall]').click();
    const account = await reopened;
    await account.locator('#platform-netease').waitFor();
    const qr = await account.evaluate(async () => {
      const result = await window.cadenzaHall.account('netease', 'begin');
      if (!result.ok) return result;
      const state = await window.cadenzaHall.account('netease', 'poll', { id: result.data.id });
      const cancelled = await window.cadenzaHall.account('netease', 'cancel', { id: result.data.id });
      return { image: result.data.image?.startsWith('data:image/png;base64,'), state, cancelled };
    });
    assert.equal(qr.image, true, JSON.stringify(qr));
    assert.equal(qr.state.data.phase, 'waiting');
    assert.equal(qr.cancelled.data.phase, 'cancelled');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
  console.log('Windows Music Hall evidence:', scratch);
}
run().catch((error) => {
  console.error(error);
  console.error('Evidence:', scratch);
  process.exitCode = 1;
});
