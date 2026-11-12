// The space interface, end to end in a headless browser (software WebGL): the built page (dist-app) with a made-up
// library and a stand-in desktop bridge, driven through the scene's test hooks (window.__cad). It checks what can be
// checked without a GPU or sound: the scene loads and draws without errors, the rooms, the lyrics in the air and their
// captions, what opens where you stand and the reach rule, the settings card, the player bar, the small window, and that
// the heap does not grow. Screenshots go to the folder given as the first argument — look at them.
//   npm run build:app && node tests/space.cjs <shots>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PAGE = 'file://' + path.resolve(__dirname, '..', 'dist-app', 'index.html');
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'cz-space-'));
let failed = 0;
const ok = (name, pass, detail) => {
  if (!pass) failed++;
  console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

/** The stand-ins the page finds in place of the desktop app: its settings, its window, and a library of 140 songs. */
function standIns() {
  const st = {
    ui: 'space',
    theme: 'system',
    lang: 'zh-Hant',
    scale: 'auto',
    fps: 0,
    prerender: true,
    audioOut: 'standard',
    gfx: 'default',
  };
  const off = () => () => {};
  const titles = ['晚風', '燈塔', 'Paper Moon', '回聲', '石與光', 'Ápple', 'きゃぴ', 'Glass', '123', '夜曲'];
  const artists = ['雨聲', '海岸', 'Mira', '林間'];
  const tracks = Array.from({ length: 140 }, (_, i) => ({
    id: 't' + i,
    file: `/m/${i}.flac`,
    folder: '/m',
    title: `${titles[i % 10]} ${i + 1}`,
    artist: artists[i % 4],
    album: '專輯 ' + ((i % 20) + 1),
    albumArtist: '',
    genre: [],
    year: 2010 + (i % 14),
    track: i,
    disc: 1,
    duration: 210,
    codec: 'flac',
    bitrate: 0,
    sampleRate: 44100,
    bits: 16,
    lossless: true,
    ext: 'flac',
    composer: '',
    lyricist: '',
    cover: null,
    lrc: false,
    embedded: false,
    protected: false,
    analyzed: 0,
    added: 0,
    plays: 0,
    last: 0,
    looked: true,
    edited: false,
    coverSet: false,
    tags: {},
  }));
  window.cadenzaDesktop = {
    settings: async () => st,
    setSettings: async (x) => Object.assign(st, x),
    relaunch: async () => {},
    platform: 'win32',
    win: async () => null,
    onWin: (f) => {
      window.__winState = f;
      return () => {};
    },
    onMedia: off,
  };
  const lib = {
    get: async () => ({
      folders: ['/m'],
      tracks,
      favorites: ['t3', 't7', 't11'],
      playlists: [{ id: 'p1', name: '雨天', created: 0, tracks: ['t1', 't2', 't5', 't9', 't13'] }],
    }),
    unverified: async () => [],
    onChanged: off,
    onProgress: off,
    onAnalysis: off,
    onWake: off,
  };
  window.cadenzaLib = new Proxy(lib, { get: (t, k) => t[k] || (async () => null) });
}

/** A made-up song for the scene (no player, no audio): four lines, the second with a harmony, with captions. */
const SONG = `(() => {
  const L = [
    ['清晨的光落在窗邊', 'Morning light falls by the window', 'qīng chén de guāng', null],
    ['我們沿著長長的街道慢慢地走向遠方的海岸線', 'We walk slowly down the long street', '', { text: '慢慢地 走', t: 7.5 }],
    ['When the night is over we will sing again together', '當夜晚過去我們會再一起唱', '', null],
    ['明天見', 'See you tomorrow', 'míng tiān jiàn', null],
  ];
  __cad.fakeNow({ rate: 0.25, id: 'x', title: 'Test', artist: 'A', album: 'B', cover: null, coverFull: null,
    playing: true, busy: true, dur: 60,
    lines: L.map(([text, sub, rd, harm], k) => ({ t: 1 + k * 5, end: 5.6 + k * 5, sung: 5 + k * 5, text,
      subs: [sub], reads: rd ? [rd] : [], harm, kar: false, times: [] })) });
  __cad.fakeBeats(0.5);
})()`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push((e.stack || e.message).slice(0, 300)));
  await p.addInitScript(standIns);
  await p.goto(PAGE);
  await p.waitForFunction(() => window.__cad && document.getElementById('loading')?.hidden, null, { timeout: 120000 });
  const shot = (n) => p.screenshot({ path: path.join(SHOTS, n + '.png') });
  const wait = (ms) => p.waitForTimeout(ms);

  // the rooms
  for (const room of ['nave', 'dome', 'lists', 'altar', 'settings']) {
    await p.evaluate((r) => __cad.go(r), room);
    await wait(1500);
    await shot('room-' + room);
    ok(`room: ${room} is where the scene says it is`, (await p.evaluate(() => __cad.room())) === room);
  }
  // the rigs: a flight to another room goes by its doorways and arrives; a set of shots takes the view and gives it back
  await p.evaluate(() => {
    __cad.go('nave');
    __cad.fly('lists');
  });
  await p.waitForFunction(() => __cad.room() === 'lists', null, { timeout: 30000 }).catch(() => {});
  ok('rig: a flight through the doorways arrives', (await p.evaluate(() => __cad.room())) === 'lists');
  await wait(2500);
  const eye = () =>
    p.evaluate(() =>
      __cad
        .camera()
        .position.toArray()
        .map((v) => +v.toFixed(1)),
    );
  const walked = await eye();
  await p.evaluate(() => __cad.rig('shots', 3));
  await wait(4000);
  const framed = await eye();
  await shot('rig-shot');
  await p.evaluate(() => __cad.rig('walk'));
  await wait(300);
  ok(
    'rig: a shot takes the view elsewhere; walking has it back where it was',
    Math.hypot(framed[0] - walked[0], framed[2] - walked[2]) > 10 && (await eye()).join() === walked.join(),
    JSON.stringify([walked, framed]),
  );
  ok('window buttons: minimise, maximise, full screen, close', (await p.$$('#win-btns button')).length === 4);

  // the lyrics in the air, and their captions
  await p.evaluate(() => {
    __cad.go('dome');
    __cad.look(0, 0.02);
  });
  await wait(1000);
  await p.evaluate(SONG);
  // (waited for, not timed: a slow machine draws the first line later)
  await p
    .waitForFunction(
      () => __cad.lyr().lines.some((l) => !l.falling) && document.querySelector('#subs .cb:not(.out) .cap'),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  await wait(800);
  await shot('lyrics-1');
  const first = await p.evaluate(() => ({
    air: __cad.lyr().lines.filter((l) => !l.falling).length,
    caps: [...document.querySelectorAll('#subs .cb:not(.out) .cap')].map((e) => e.textContent),
  }));
  ok(
    'lyrics: one line in the air, with its captions',
    first.air === 1 && first.caps.length === 2,
    JSON.stringify(first),
  );
  await wait(15000);
  await shot('lyrics-2');
  const second = await p.evaluate(() => {
    const cam = __cad.camera(),
      air = __cad.lyr().lines.filter((l) => !l.falling);
    return {
      air: air.length,
      falling: __cad.lyr().lines.filter((l) => l.falling).length,
      rows: air[0] ? +(air[0].height / 0.85).toFixed(1) : 0,
    };
  });
  ok(
    'lyrics: the line before falls as the next comes; a long line wraps',
    second.air === 1 && second.falling >= 1 && second.rows > 1.5,
    JSON.stringify(second),
  );

  // the progress line
  const bar = await (await p.$('#p-seek')).boundingBox();
  await p.mouse.move(bar.x + 20, bar.y + bar.height / 2);
  await p.mouse.down();
  await p.mouse.move(bar.x + bar.width * 0.6, bar.y + bar.height / 2, { steps: 4 });
  await wait(150);
  const fill = await p.$eval('#p-bar', (e) => parseFloat(e.style.width));
  await p.mouse.up();
  ok('player: the progress line follows a drag', Math.abs(fill - 60) < 3, `${fill}%`);
  await p.evaluate(() => {
    __cad.fakeNow(null);
    __cad.fakeBeats(null);
  });

  // what opens where you stand, and the reach
  await p.evaluate(() => {
    __cad.go('nave');
    __cad.stand(3, -9.5, Math.PI / 2, 0);
  });
  await wait(1200);
  await p.mouse.click(640, 300);
  await wait(400);
  ok('reach: an album too far away does not open', !(await p.$('[data-test="space-detail"]')));
  await p.evaluate(() => __cad.stand(-3, -9.5, Math.PI / 2, 0));
  await wait(1000);
  const before = await p.evaluate(() =>
    [__cad.camera().position.x.toFixed(2), __cad.camera().position.z.toFixed(2)].join(),
  );
  await p.mouse.click(640, 300);
  await wait(1000);
  const after = await p.evaluate(() =>
    [__cad.camera().position.x.toFixed(2), __cad.camera().position.z.toFixed(2)].join(),
  );
  ok(
    'reach: within reach it opens, and the view does not move',
    !!(await p.$('[data-test="space-detail"]')) && before === after,
  );
  await shot('detail');
  // (the card's buttons run the library's commands: adding to the queue says so)
  await p.click('[data-test="space-detail"] button:has-text("加入播放佇列")');
  await wait(200);
  // (the notice keeps its words after it fades: on a slow machine the click alone can outlast it)
  const said = await p.$eval('[role="status"]', (e) => e.textContent);
  ok('commands: a card adds its songs to the queue, and says so', /\d+ 首加入播放佇列/.test(said), said);
  await p.evaluate(() => __cad.stand(0, -30, 0, 0));
  await wait(700);
  ok('reach: walking away closes it', !(await p.$('[data-test="space-detail"]')));

  // the settings card: a jump to a section and a few switches never scroll the card itself
  await p.click('#cfg');
  await wait(800);
  await p.evaluate(() =>
    document.querySelector('[data-section="lyrics"]').scrollIntoView({ block: 'start', behavior: 'instant' }),
  );
  for (const sw of (await p.$$('[data-test="space-settings"] [role="switch"]')).slice(0, 3)) {
    await sw.click({ timeout: 3000 }).catch(() => {});
    await wait(200);
  }
  const card = await p.evaluate(() => {
    const c = document.querySelector('[data-test="space-settings"]');
    return [c.querySelector('header').getBoundingClientRect().top - c.getBoundingClientRect().top, c.scrollTop];
  });
  ok('settings: the card stays put (its header at its top)', card[0] === 0 && card[1] === 0, JSON.stringify(card));
  await shot('settings');
  const close = await (await p.$('[data-test="space-settings"] header button')).boundingBox();
  await p.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
  await wait(400);
  ok('settings: closes', !(await p.$('[data-test="space-settings"]')));

  // the player bar's lists
  await p.click('[aria-label="播放佇列"]');
  await wait(700);
  ok('player: the queue opens', !!(await p.$('[data-test="space-queue"]')));
  await shot('queue');
  await p.keyboard.press('Escape');

  // the heap over half a minute of drawing
  const cdp = await p.context().newCDPSession(p);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576;
  };
  await p.evaluate(() => __cad.go('dome'));
  await wait(8000);
  const h0 = await heap();
  await wait(30000);
  const h1 = await heap();
  ok('memory: the heap does not grow while the scene draws', h1 - h0 < 1.5, `${h0.toFixed(1)} → ${h1.toFixed(1)} MB`);

  // the small window: its own view, its buttons clear of every drag region
  await p.evaluate(() => window.__winState({ max: false, full: false, mini: true }));
  await p.setViewportSize({ width: 480, height: 300 });
  await wait(1200);
  await shot('mini');
  const mini = await p.evaluate(() => {
    const drags = [...document.querySelectorAll('*')]
      .filter((e) => {
        const c = getComputedStyle(e);
        return (
          (c.getPropertyValue('app-region') || c.getPropertyValue('-webkit-app-region')) === 'drag' &&
          e.getClientRects().length
        );
      })
      .map((e) => e.getBoundingClientRect());
    return [...document.querySelectorAll('[data-test="mini"] button')].map((b) => {
      const r = b.getBoundingClientRect(),
        x = r.x + r.width / 2,
        y = r.y + r.height / 2,
        top = document.elementFromPoint(x, y);
      return (
        (top === b || b.contains(top)) && !drags.some((d) => x >= d.left && x <= d.right && y >= d.top && y <= d.bottom)
      );
    });
  });
  ok(
    'small window: both buttons can be clicked (on top, in no drag region)',
    mini.length === 2 && mini.every(Boolean),
    JSON.stringify(mini),
  );

  ok('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`${failed ? failed + ' failed' : 'all passed'}; screenshots in ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})();
