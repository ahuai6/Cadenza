// The desktop app with the Hi-Fi output on, against the simulated DAC (CADENZA_AUDIO_FAKE): the native player is started,
// songs play through it with the lyrics on its clock, the device follows each song's rate, the next song is preloaded,
// pause / seek hold the clock, the workshop gets the device back for its standard output, and switching the output in
// the settings carries on from the same moment. Run under xvfb-run on Linux:  node tests/desktop-hifi.cjs [shots dir]
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), CACHE = path.join(__dirname, '.cache'), SHOTS = process.argv[2] || os.tmpdir();
let failed = 0; const ok = (name, pass, detail) => { if (!pass) failed++; console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
(async () => {
  if (!fs.existsSync(path.join(CACHE, 'lib'))) execFileSync('sh', [path.join(__dirname, 'fixtures', 'gen', 'library.sh'), CACHE], { stdio: 'inherit' });
  const BIN = path.join(ROOT, 'native', 'cadenza-audio', 'target', 'release', 'cadenza-audio');
  if (!fs.existsSync(BIN)) execFileSync('cargo', ['build', '--release'], { cwd: path.join(ROOT, 'native', 'cadenza-audio'), stdio: 'inherit' });
  fs.mkdirSync(SHOTS, { recursive: true });
  // a library of two songs: the CD-rate MP3 with lyrics, and a 24-bit 96 kHz FLAC
  const L = path.join(CACHE, 'hifilib'); fs.rmSync(L, { recursive: true, force: true }); fs.mkdirSync(L);
  for (const f of ['01 晨光.mp3', '01 晨光.lrc']) fs.copyFileSync(path.join(CACHE, 'lib', 'A', f), path.join(L, f));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-t', '30', '-i', path.join(CACHE, 'lib', 'A', '02 無詞的歌.flac'), '-ar', '96000', '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24',
    '-metadata', 'title=Hi-Res', '-metadata', 'artist=Test', path.join(L, '02 Hi-Res.flac')]);
  const DUMP = path.join(CACHE, 'hifidump'); fs.rmSync(DUMP, { recursive: true, force: true }); fs.mkdirSync(DUMP);

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'czh-')); fs.mkdirSync(path.join(prof, 'library'), { recursive: true });
  fs.writeFileSync(path.join(prof, 'library', 'db.json'), JSON.stringify({ version: 1, folders: [L], tracks: {}, favorites: [], playlists: [], overrides: {} }));
  fs.writeFileSync(path.join(prof, 'settings.json'), JSON.stringify({ theme: 'dark', lang: 'zh-Hant', audioOut: 'hifi', audioMode: 'exclusive', fixedVolume: true }));
  const app = await electron.launch({ executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox'],
    env: { ...process.env, CADENZA_USER_DATA: prof, CADENZA_AUDIO_FAKE: `rates=44100,48000,88200,96000;fmts=i24in32,i16;dump=${path.join(DUMP, 'd')}` } });
  const win = await app.firstWindow(); const errs = [];
  win.on('pageerror', e => errs.push(e.stack)); win.on('console', m => { if (m.type() === 'error' && !/Autofill/.test(m.text())) errs.push(m.text()); });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = n => win.screenshot({ path: path.join(SHOTS, `hifi-${n}.png`) });
  const W = ms => win.waitForTimeout(ms), C = (f, a) => win.evaluate(f, a);
  await win.waitForFunction(() => !!window.cadenzaAudio && !!window.__cadenza && !!window.__cadenza.api, null, { timeout: 20000 });
  await C(() => { window.__ev = []; window.cadenzaAudio.onEvent(e => { e.at = performance.now(); window.__ev.push(e); if (window.__ev.length > 4000) window.__ev.splice(0, 2000); }); });

  const t0 = Date.now(); let st;
  for (;;) { st = await C(() => window.cadenzaLib.get().then(v => ({ n: v.tracks.length, an: v.tracks.filter(t => t.analyzed > 0).length, ids: Object.fromEntries(v.tracks.map(t => [t.title, t.id])) })));
    if (st.an >= 2 || Date.now() - t0 > 90000) break; await W(800); }
  ok('library scanned and analysed', st.n === 2 && st.an === 2, JSON.stringify({ n: st.n, an: st.an }));
  const hs = await C(() => window.cadenzaAudio.state());
  ok('Hi-Fi output: the native player is running', hs.supported && hs.running, JSON.stringify({ supported: hs.supported, running: hs.running }));

  await C(ids => window.__cadenza.api.playIds([ids['晨光'], ids['Hi-Res']], 0), st.ids);
  await win.waitForFunction(() => window.__cadenza.engine.isPlaying && window.__cadenza.engine.time > 1.0, null, { timeout: 20000 });
  const p1 = await C(() => ({ route: window.__cadenza.player.get().route, ext: !!window.__cadenza.engine.clock.external, dev: window.__ev.filter(e => e.ev === 'device' && e.open).pop() }));
  ok('song 1 plays through the Hi-Fi output, device at 44.1 kHz exclusive', p1.route === 'hifi' && p1.ext && p1.dev && p1.dev.rate === 44100 && p1.dev.exclusive, JSON.stringify(p1));
  await W(1500);
  // the picture runs on the device's clock: engine time against the last reported position, extrapolated
  const sync = await C(() => { const e = window.__ev.filter(x => x.ev === 'pos' && x.run).pop(), s = window.__cadenza.engine.session; return { eng: window.__cadenza.engine.time + s.audioStart, rep: e.t + (performance.now() - e.at) / 1000 }; });
  ok('engine clock follows the device clock', Math.abs(sync.eng - sync.rep) < 0.04, `file ${sync.rep.toFixed(3)} s, picture ${sync.eng.toFixed(3)} s`);
  await win.locator('[data-test=card]').getByTitle('展開').first().click(); await W(1500); await shot('nowplaying');
  const badge = await C(() => { const np = document.querySelector('[data-test=np]'); const b = [...np.querySelectorAll('div')].find(d => /kHz/.test(d.textContent) && d.children.length >= 3 && d.children.length <= 6); return b ? b.innerText.replace(/\s+/g, ' ') : null; });
  ok('now playing shows the format badge', !!badge && /MP3/.test(badge) && /44\.1 kHz/.test(badge), badge);
  ok('fixed volume: the volume slider gives way to the DAC', await C(() => !!document.querySelector('[data-test=np] [title]') && /DAC/.test(document.querySelector('[data-test=np]').innerText)));

  // pause holds the clock; play resumes from there; seek waits at the new place, then runs on
  await C(() => window.__cadenza.engine.pause()); await W(600);
  const a = await C(() => window.__cadenza.engine.time); await W(500); const b = await C(() => window.__cadenza.engine.time);
  await C(() => window.__cadenza.engine.play()); await W(700); const c = await C(() => window.__cadenza.engine.time);
  ok('pause holds, play resumes from the same moment', Math.abs(a - b) < 1e-6 && c > b && c - b < 1.0, `${a.toFixed(3)} → ${b.toFixed(3)} → ${c.toFixed(3)}`);
  await C(() => window.__cadenza.engine.seek(15)); await W(80);
  const s1 = await C(() => window.__cadenza.engine.time); await W(900); const s2 = await C(() => window.__cadenza.engine.time);
  ok('seek: no running back, then on from the new place', s1 >= 14.95 && s1 < 15.3 && s2 > 15.4 && s2 < 16.3, `${s1.toFixed(3)} → ${s2.toFixed(3)}`);

  // the next song was preloaded; skipping changes the device rate (24/96: bit-perfect)
  await win.waitForFunction(() => window.__ev.some(e => e.ev === 'preloaded'), null, { timeout: 8000 }).catch(() => {});
  const pre = await C(() => window.__ev.some(e => e.ev === 'preloaded'));
  const tk = Date.now(); await C(() => window.__cadenza.api.next());
  await win.waitForFunction(id => window.__cadenza.player.get().shownId === id && window.__cadenza.engine.isPlaying && window.__cadenza.engine.time > 0.3, st.ids['Hi-Res'], { timeout: 15000 });
  const skip = Date.now() - tk;
  const p2 = await C(() => ({ dev: window.__ev.filter(e => e.ev === 'device' && e.open).pop(), ready: window.__ev.filter(e => e.ev === 'ready').pop() }));
  ok('next song preloaded, starts promptly', pre && skip < 3000, `${skip} ms to 0.3 s into the song (300 ms of it is the DAC locking)`);
  ok('device follows the song: 96 kHz, 24 bit, bit-perfect', p2.dev.rate === 96000 && p2.dev.bits === 24 && p2.ready.out.bitperfect, JSON.stringify({ rate: p2.dev.rate, bits: p2.dev.bits, bp: p2.ready.out.bitperfect }));
  await W(600); await shot('nowplaying-hires');
  await win.keyboard.press('Escape'); await W(800);

  // the workshop plays through the standard output: the device is let go of, and taken again on the way back
  await win.getByRole('button', { name: '歌詞工坊' }).click(); await W(1800);
  const ws = await C(() => ({ playing: window.__cadenza.engine.isPlaying, released: (window.__ev.filter(e => e.ev === 'device').pop() || {}).open === false }));
  ok('workshop: the player pauses and the DAC is released', !ws.playing && ws.released, JSON.stringify(ws));
  await win.getByRole('button', { name: '音樂庫' }).click(); await W(1200);
  await C(() => window.__cadenza.api.toggle()); await win.waitForFunction(() => window.__cadenza.engine.isPlaying, null, { timeout: 15000 }).catch(() => {}); await W(1200);
  const back = await C(() => ({ ext: !!window.__cadenza.engine.clock.external, playing: window.__cadenza.engine.isPlaying, dev: window.__ev.filter(e => e.ev === 'device').pop() }));
  ok('back from the workshop: Hi-Fi again', back.ext && back.playing && back.dev.open && back.dev.rate === 96000, JSON.stringify({ ext: back.ext, playing: back.playing }));

  // switch to the standard output in the settings: the same song carries on from the same moment
  await win.getByRole('button', { name: '設定' }).click(); await W(900); await shot('settings');
  const tb = await C(() => window.__cadenza.engine.time);
  await win.locator('main[data-scroll]').getByRole('radio', { name: '標準' }).click();
  await win.waitForFunction(() => window.__cadenza.player.get().route === 'std' && window.__cadenza.engine.isPlaying, null, { timeout: 15000 }).catch(() => {});
  await W(800);
  const sw = await C(() => ({ ext: !!window.__cadenza.engine.clock.external, t: window.__cadenza.engine.time }));
  const run = await C(() => window.cadenzaAudio.state().then(s => s.running));
  ok('standard output: carries on from the same moment, native player stopped', !sw.ext && sw.t > tb && sw.t - tb < 3 && !run, JSON.stringify({ before: tb, after: sw.t, running: run }));

  // the quick switch at the bottom of the sidebar: back to Hi-Fi from anywhere, the same song carrying on
  { const side = win.locator('nav[aria-label=Cadenza]'), t1 = await C(() => window.__cadenza.engine.time);
    ok('sidebar: the output switch shows, on the output in use', await side.getByRole('radio', { name: '標準' }).getAttribute('aria-checked') === 'true');
    await side.getByRole('radio', { name: 'Hi-Fi' }).click();
    await win.waitForFunction(() => window.__cadenza.player.get().route === 'hifi' && window.__cadenza.engine.isPlaying, null, { timeout: 15000 }).catch(() => {}); await W(800);
    const q = await C(() => ({ route: window.__cadenza.player.get().route, ext: !!window.__cadenza.engine.clock.external, t: window.__cadenza.engine.time, set: window.__cadenza.settings.get().audioOut }));
    ok('sidebar switch: to Hi-Fi in one click, the setting kept, the song carrying on', q.route === 'hifi' && q.ext && q.set === 'hifi' && q.t > t1 && q.t - t1 < 4, JSON.stringify(q)); }
  // the volume balance with the fixed volume: the samples untouched, the device's hardware volume asked (the test DAC has none)
  { const hw = await C(() => ({ hw: window.__cadenza.hifi?.get?.().hw ?? null, bal: window.__cadenza.engine.balance, ev: window.__ev.filter(e => e.ev === 'hwvol').pop() || null }));
    ok('volume balance on Hi-Fi with a fixed volume: no gain on the samples, the hardware volume asked instead', hw.bal === 1 && !!hw.ev && hw.ev.supported === false, JSON.stringify(hw)); }
  ok('no page errors', !errs.length, errs.slice(0, 5).join(' | '));
  await app.close();
  const files = fs.readdirSync(DUMP).sort();
  ok('device opened at 44.1 kHz, then 96 kHz', files.some(f => /-44100-i24in32-ex/.test(f)) && files.some(f => /-96000-i24in32-ex/.test(f)), files.join(', '));
  console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
