// Cadenza end to end, on a clean profile and a small generated library (tests/fixtures/gen/library.sh): scan →
// background rhythm analysis → library → play → the card opening into now playing (and reversed half-way) → the hand-over
// into the effect lyrics → the cursor and the bar → song changes in every view → the song's panel (with an input method)
// → MV → queue → export → workshop → hit areas → poster wall and settings. Screenshots go to the folder given as the
// first argument. Run under xvfb-run on Linux:  xvfb-run -a node tests/desktop.cjs <shots> [dark|light]
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), CACHE = path.join(__dirname, '.cache'), SHOTS = process.argv[2] || os.tmpdir();
let failed = 0; const ok = (name, pass, detail) => { if (!pass) failed++; console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
(async () => {
  if (!fs.existsSync(path.join(CACHE, 'lib'))) execFileSync('sh', [path.join(__dirname, 'fixtures', 'gen', 'library.sh'), CACHE], { stdio: 'inherit' });
  fs.mkdirSync(SHOTS, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-')); fs.mkdirSync(path.join(prof, 'library'), { recursive: true });
  fs.writeFileSync(path.join(prof, 'library', 'db.json'), JSON.stringify({ version: 1, folders: [path.join(CACHE, 'lib')], tracks: {}, favorites: [], playlists: [], overrides: {} }));
  fs.writeFileSync(path.join(prof, 'settings.json'), JSON.stringify({ theme: process.argv[3] || 'dark', lang: 'zh-Hant' }));
  const app = await electron.launch({ executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox'], env: { ...process.env, CADENZA_USER_DATA: prof } });
  const out = path.join(prof, 'export.mp4');
  await app.evaluate(({ dialog }, [mv, o]) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [mv] }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, [path.join(CACHE, 'mv.mp4'), out]);
  const win = await app.firstWindow(); const errs = []; let probing = false;   // (probing: the 404 the model route's own check asks for)
  win.on('pageerror', e => errs.push(e.message)); win.on('console', m => { if (m.type() === 'error' && !/Autofill/.test(m.text()) && !(probing && /404/.test(m.text()))) errs.push(m.text()); });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = n => win.screenshot({ path: path.join(SHOTS, `cz-${n}.png`) });
  const W = ms => win.waitForTimeout(ms);
  const C = (f, a) => win.evaluate(f, a);
  const layerIs = (l, ms = 8000) => win.waitForFunction(l => { const c = window.__cadenza, e = c.engine, p = c.layers.npProgress(); if (c.ui.get().layer !== l) return false;
    return l === 'fx' ? e.handoff.p > 0.999 : l === 'np' ? p > 0.999 && e.handoff.p < 0.001 : p < 0.001 && e.view === 'hidden'; }, l, { timeout: ms }).then(() => true, () => false);

  // drag regions (Windows applies them under whatever is painted on top): Chromium's rule rebuilt here, drag and no-drag
  // rectangles in document order, then every control the pointer can reach is sampled at five points
  const dragHits = () => C(() => {
    const regs = []; let sane = false;
    for (const el of document.querySelectorAll('*')) { const cs = getComputedStyle(el), v = cs.getPropertyValue('app-region') || cs.getPropertyValue('-webkit-app-region');
      if (!v || v === 'none' || v === 'auto' || cs.display === 'none' || cs.visibility !== 'visible') continue;
      if (el.dataset.test === 'titlebar' && v === 'drag') sane = true;
      for (const r of el.getClientRects()) regs.push({ drag: v === 'drag', r }); }
    const inDrag = (x, y) => { let d = false; for (const g of regs) if (x >= g.r.left && x <= g.r.right && y >= g.r.top && y <= g.r.bottom) d = g.drag; return d; };
    const bad = new Set();
    for (const el of document.querySelectorAll('button, [role=slider], input, select, textarea, label, [role=listitem]')) {
      const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
      for (const [fx, fy] of [[0.5, 0.5], [0.12, 0.5], [0.88, 0.5], [0.5, 0.15], [0.5, 0.85]]) { const x = r.left + r.width * fx, y = r.top + r.height * fy, top = document.elementFromPoint(x, y);
        if (!top || !(el === top || el.contains(top))) continue;
        if (inDrag(x, y)) bad.add(el.getAttribute('aria-label') || el.textContent.slice(0, 20) || el.tagName); } }
    return { sane, bad: [...bad] };
  });

  /* ---------- scan and background analysis ---------- */
  await win.waitForFunction(() => document.querySelectorAll('[role=listitem], [role=tab]').length > 0, null, { timeout: 30000 });
  const t0 = Date.now(); let st = null;
  for (;;) { st = await C(() => window.cadenzaLib.get().then(v => ({ n: v.tracks.length, prot: v.tracks.filter(t => t.protected).length, an: v.tracks.filter(t => t.analyzed > 0).length, covers: v.tracks.filter(t => t.cover).length, lrc: v.tracks.filter(t => t.lrc).length })));
    if (st.an >= 3 || Date.now() - t0 > 90000) break; await W(500); }
  ok('scan: 4 files, 1 protected (listed, never decoded), covers and lyrics found', st.n === 4 && st.prot === 1 && st.covers === 2 && st.lrc === 2, JSON.stringify(st));
  ok('rhythm analysis: every playable song analysed in the background and cached', st.an === 3, `${st.an}/3 in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const ids = await C(() => window.cadenzaLib.get().then(v => Object.fromEntries(v.tracks.map(t => [t.title, t.id]))));
  const cached = await C(id => window.cadenzaLib.analysis(id, 3).then(a => a && { v: a.version, engine: a.engine, beats: a.beats.length, events: a.events.length, bpm: Math.round(a.tempo.bpm), spec: (a.spec || []).length }), ids['晨光']);
  ok('rhythm cache: the SDK\'s own analysis, versioned, saying which engine found the beats', cached && cached.v === 3 && (cached.engine === 'neural' || cached.engine === 'dsp') && cached.beats > 20 && cached.events > 20 && cached.spec === 6, JSON.stringify(cached));
  await win.locator('nav[aria-label=Cadenza]').getByRole('button', { name: '歌曲', exact: true }).click(); await W(500); await shot('songs');
  ok('sidebar: the library\'s sections listed right under it, the chosen one marked', await win.locator('nav[aria-label=Cadenza]').getByRole('button', { name: '歌曲', exact: true }).getAttribute('aria-current') === 'page' && await win.locator('h1', { hasText: '歌曲' }).count() > 0);
  // the song rows line up: every column starts at the same x in every row
  const cols = await C(() => [...document.querySelectorAll('[role=list] [role=listitem]')].map(r => [...r.children].map(c => Math.round(c.getBoundingClientRect().left))));
  ok('library: every row\'s columns line up', cols.length === 4 && cols.every(r => r.join() === cols[0].join()), JSON.stringify(cols.map(r => r.slice(1, 6))));
  await win.locator('nav[aria-label=Cadenza]').getByRole('button', { name: '專輯', exact: true }).click(); await W(400); await shot('albums');
  await win.locator('nav[aria-label=Cadenza]').getByRole('button', { name: '歌曲', exact: true }).click(); await W(300);

  /* ---------- play ---------- */
  await win.locator('[role=listitem]', { hasText: '晨光' }).dblclick();
  await win.waitForFunction(() => window.__cadenza.engine.isPlaying && window.__cadenza.engine.time > 0.5, null, { timeout: 20000 });
  const p1 = await C(() => { const s = window.__cadenza.player.get().session; return { title: s.spec.song.title, lines: s.doc.lines.length, beats: s.map.beats.length, audio: s.map.hasAudio, intro: s.plan.titles.intro && s.plan.titles.intro.kind }; });
  ok('play: the song plays with its lyrics, its analysed beats and an intro title', p1.title === '晨光' && p1.lines >= 6 && p1.beats > 20 && p1.audio && !!p1.intro, JSON.stringify(p1));
  await shot('playing');
  const fonts = await C(async () => { await new Promise(r => setTimeout(r, 1500)); await document.fonts.ready;
    const sheets = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href), res = performance.getEntriesByType('resource').filter(e => /\.woff2|fonts\.g/.test(e.name) && !e.name.startsWith('file:'));
    return { local: sheets.filter(h => h.startsWith('file:') && /\/fonts\//.test(h)).length, remote: res.length + sheets.filter(h => !h.startsWith('file:')).length, loaded: [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')))] }; });
  ok('fonts: all bundled with the app, nothing downloaded', fonts.local >= 1 && !fonts.remote && fonts.loaded.includes('Noto Sans TC'), JSON.stringify({ ...fonts, loaded: fonts.loaded.slice(0, 6) }));
  // the progress bar: at the start nothing of the fill shows (no specks), the fill is a rounded clip of the track
  await C(() => { window.__cadenza.engine.pause(); window.__cadenza.engine.seek(0); }); await W(300);
  const pb = await win.locator('[data-test=card] [data-test=progress]').boundingBox();
  const speck = await win.screenshot({ clip: { x: pb.x, y: pb.y + pb.height / 2 - 4, width: 12, height: 8 } });
  const bright = await C(async b64 => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, (d[i] + d[i + 1] + d[i + 2]) / 3); return m; }, speck.toString('base64'));
  ok('progress: no white specks at the start of the bar', bright < 150, `brightest ${bright.toFixed(0)}`);
  await C(() => window.__cadenza.engine.play());

  /* ---------- the card opens into now playing: one progress, reversible at any moment ---------- */
  await win.locator('[data-test=card]').getByTitle('展開').first().click(); await W(140);
  const mid = await C(() => { const st = document.querySelector('[data-test=stage]'), cv = document.querySelector('[data-test=np-cover]'); const m = /inset\(([\d.]+)px/.exec(st.style.clipPath || '');
    return { p: window.__cadenza.layers.npProgress(), clipTop: m ? +m[1] : null, coverTop: cv.getBoundingClientRect().top, coverLeft: cv.getBoundingClientRect().left, moved: !!cv.style.transform }; });
  await shot('np-opening');
  ok('opening: the picture comes out with the cover (its top edge led by the cover), the cover flies', mid.p > 0.05 && mid.p < 0.98 && mid.moved && mid.clipTop != null && mid.clipTop <= mid.coverTop + 1, JSON.stringify(mid));
  await win.keyboard.press('Escape'); await W(120);
  const rev = await C(() => window.__cadenza.layers.npProgress());
  const closed = await layerIs('none');
  const after = await C(() => ({ np: document.querySelector('[data-test=np]').dataset.vis, stage: document.querySelector('[data-test=stage]').dataset.vis, view: window.__cadenza.engine.view, mini: document.querySelector('[data-test=card] span span').style.visibility }));
  ok('reversed half-way: it turns round from where it is and closes completely (nothing left stuck)', rev < mid.p + 0.4 && closed && after.np === 'false' && after.stage === 'false' && after.view === 'hidden' && after.mini === '', JSON.stringify({ mid: mid.p, rev, ...after }));
  await win.locator('[data-test=card]').getByTitle('展開').first().click();
  ok('now playing: open', await layerIs('np'));
  await W(400); await shot('nowplaying');
  const np = await C(() => ({ lines: document.querySelectorAll('[data-test=np] [data-test=line]').length, cur: !!document.querySelector('[data-test=np] [data-test=line][data-on="true"]'), queue: !!document.querySelector('[data-test=np] [aria-label="播放佇列"]'),
    ambient: window.__cadenza.engine.view, same: window.__cadenza.engine.session === window.__cadenza.player.get().session }));
  ok('now playing: lyrics laid out word by word, a queue button, the backdrop is the engine\'s own picture of this song', np.lines >= 6 && np.cur && np.queue && np.ambient === 'ambient' && np.same, JSON.stringify(np));
  // the queue from the now-playing page: modes on one line, rows lined up with the header
  await win.locator('[data-test=np] [aria-label="播放佇列"]').click(); await W(600); await shot('np-queue');
  const qp = await C(() => { const q = document.querySelector('[data-test=queue]'); if (!q) return null; const seg = q.querySelector('[role=radiogroup]'), rows = [...q.querySelectorAll('[role=listitem]')], head = q.querySelector('header b');
    return { segH: Math.round(seg.getBoundingClientRect().height), modes: seg.querySelectorAll('button').length, rows: rows.length, coverX: rows.map(r => Math.round(r.children[1].getBoundingClientRect().left)), headX: Math.round(head.getBoundingClientRect().left), segX: Math.round(seg.getBoundingClientRect().left),
      wraps: [...seg.querySelectorAll('button')].some(b => b.scrollHeight > b.clientHeight + 1) }; });
  ok('queue: the four modes on one line, rows lined up with the header', qp && qp.modes === 4 && qp.segH <= 36 && !qp.wraps && qp.rows >= 1 && qp.coverX.every(x => x === qp.coverX[0]) && Math.abs(qp.headX - qp.segX) <= 2, JSON.stringify(qp));
  await win.keyboard.press('Escape'); await W(400);

  /* ---------- into the effect lyrics: a full-screen blur, the view changes underneath ---------- */
  await win.getByRole('button', { name: '特效歌詞' }).click();
  // sample the blur veil while it runs: it rises, the view changes at its peak, and it clears
  const ho = await C(() => new Promise(res => { const seen = []; const t0 = performance.now(); const tick = () => { const v = [...document.body.children].find(x => x.style && x.style.zIndex === '60');
      seen.push({ b: v && v.style.display !== 'none' ? parseFloat((v.style.backdropFilter.match(/blur\(([\d.]+)/) || [0, 0])[1]) : 0, view: window.__cadenza.engine.view });
      if (performance.now() - t0 < 1300) requestAnimationFrame(tick); else res({ peak: Math.max(...seen.map(x => x.b)), endBlur: seen[seen.length - 1].b, viewAtPeak: seen.reduce((m, x) => (x.b > m.b ? x : m), seen[0]).view, last: seen[seen.length - 1].view }); }; tick(); }));
  await shot('fx-opening');
  ok('into the effect lyrics: a full-screen blur rises, the view changes under it, and it clears', ho.peak > 20 && ho.endBlur < 0.5 && ho.last === 'effect', JSON.stringify(ho));
  ok('effect lyrics: open', await layerIs('fx')); await W(300); await shot('fx');
  // nothing draws an edge of its own over the picture: the page's edge is the main area's, under the full-window picture
  const edge = await C(() => { const np = document.querySelector('[data-test=np]'), st = document.querySelector('[data-test=stage]').getBoundingClientRect();
    return { after: getComputedStyle(np, '::after').content, stage: [st.left, st.top, st.width, st.height].map(Math.round), win: [innerWidth, innerHeight] }; });
  ok('effect lyrics: no page edge over the picture (the picture covers the window)', edge.after === 'none' && edge.stage[0] === 0 && edge.stage[1] === 0 && edge.stage[2] === edge.win[0] && edge.stage[3] === edge.win[1], JSON.stringify(edge));
  const fx = await C(() => { const e = window.__cadenza.engine, f = e.frameAt(e.time); return { view: e.view, mix: f.view.effect, owner: f.coverOwner, vinyl: f.vinylOut, aspect: e.session.style.aspect, theme: e.session.style.bgStyle }; });
  ok('effect lyrics: full picture at 16:9, the cover theme, the record out from under the sleeve', fx.view === 'effect' && fx.mix > 0.99 && fx.owner === 'backdrop' && fx.vinyl > 0.99 && fx.theme === 'cover' && fx.aspect === '16:9', JSON.stringify(fx));
  // the bar and the pointer: both hide after a still moment, both come back on any movement
  await win.mouse.move(700, 400); await W(3200);
  const idle = await C(() => { const f = document.querySelector('[data-test=fx]'); return { bar: f.dataset.bar, cursor: f.dataset.cursor, css: getComputedStyle(f).cursor }; });
  await win.mouse.move(760, 430); await W(150);
  const woke = await C(() => { const f = document.querySelector('[data-test=fx]'); return { bar: f.dataset.bar, cursor: f.dataset.cursor, css: getComputedStyle(f).cursor }; });
  ok('effect view: pointer and bar hide when still and return on any movement', idle.bar === 'false' && idle.css === 'none' && woke.bar === 'true' && woke.css !== 'none', JSON.stringify({ idle, woke }));
  await W(400); await shot('fx-bar');

  /* ---------- song changes, in the effect view, however fast ---------- */
  const order0 = await C(() => window.__cadenza.player.get().queue.length);
  await C(async ([a, b, c]) => { const A = window.__cadenza.api; await A.playIds([a, b, c], 0); }, [ids['晨光'], ids['Night Drive'], ids['無詞的歌']]); await W(1200);
  await C(() => { const A = window.__cadenza.api; A.next(); A.next(); A.next(); }); await W(200); await shot('fx-skipping');
  await win.waitForFunction(() => !window.__cadenza.player.get().loading && window.__cadenza.player.get().shownId === window.__cadenza.player.get().id, null, { timeout: 20000 }).catch(() => {});
  await W(1200);
  const sk = await C(() => { const P = window.__cadenza.player.get(), e = window.__cadenza.engine, s = e.session; return { want: P.id, shown: P.shownId, same: s === P.session, key: s.spec.key, view: e.view, playing: e.isPlaying, intro: !!s.plan.titles.intro }; });
  ok('rapid skips: the last song asked for is the one shown, in every part of the picture, still in the effect view', sk.want === sk.shown && sk.same && sk.key === sk.want && sk.view === 'effect' && sk.playing, JSON.stringify(sk));
  await shot('fx-after-skips');

  /* ---------- the song's own panel ---------- */
  await C(async id => window.__cadenza.api.playIds([id], 0), ids['晨光']); await W(1500);
  await win.mouse.move(1436, 450, { steps: 6 }); await W(800); await win.mouse.move(1250, 300, { steps: 8 }); await W(200);
  ok('song panel: slides in from the right edge', await C(() => document.querySelector('[data-test=song-panel]').dataset.open === 'true'));
  await win.locator('[data-test=song-panel]').getByRole('tab', { name: '背景' }).click(); await W(300); await shot('fx-panel-bg');
  { const sp = win.locator('[data-test=song-panel]'), heads = await sp.locator('h2, h3, header').allInnerTexts();
    ok('song panel: the background tab holds the MV settings (no empty section)', await sp.getByText('MV 畫面').count() > 0 && await sp.getByRole('slider').count() >= 3, JSON.stringify(heads)); }
  // the colour picker of our own: its square, hue and hex; the eyedropper lays the song's cover over the square
  { const sp = win.locator('[data-test=song-panel]'), fieldBtn = sp.locator('button[aria-haspopup="dialog"]').first();
    const bg0 = await C(() => window.__cadenza.player.get().session.style.bg);
    await fieldBtn.scrollIntoViewIfNeeded(); await fieldBtn.click(); await W(300);
    const pop = win.locator('[data-colorpop]'), opened = await pop.count();
    const hex = pop.locator('input[aria-label="HEX"]'); await hex.fill('#3366cc'); await hex.press('Enter'); await W(400);
    const bg = await C(() => window.__cadenza.player.get().session.style.bg);
    await pop.getByRole('button', { name: /螢幕吸色/ }).click(); await W(400); await shot('fx-colorpick');
    const coverUp = await pop.locator('img').count();
    await C(() => document.querySelector('[data-test=song-panel] button[aria-haspopup="dialog"]').click()); await W(300);   // (closed from its own swatch: the panel stays)
    const closed = await pop.count() === 0;
    await C(v => window.__cadenza.api.editSong(s => s.setStyle('bg', v)), bg0);   // (the song's colour as it was, for what follows)
    ok('colour picker: opens over the panel, takes a hex, and the eyedropper lays the cover over the square', opened === 1 && bg === '#3366cc' && coverUp === 1 && closed, JSON.stringify({ opened, bg, coverUp, closed })); }
  // the font picker: its names are baked pictures — opening it loads no face (it used to load thirty, and stall)
  { const sp = win.locator('[data-test=song-panel]'), links = () => C(() => document.querySelectorAll('link[rel=stylesheet][href*="fonts/"]').length);
    await sp.getByRole('tab', { name: '文字' }).click(); await W(400); const before = await links(), t0 = Date.now();
    await sp.getByRole('combobox', { name: '字體' }).click(); await W(500); const open = await C(() => document.querySelectorAll('[role=option]').length), took = Date.now() - t0;
    const baked = await C(() => [...document.querySelectorAll('[role=option] span')].filter(e => /^url\(/.test(getComputedStyle(e).webkitMaskImage) && getComputedStyle(e).fontSize === '0px').length);
    await shot('fx-fontpicker'); const after = await links(); await sp.getByRole('combobox', { name: '字體' }).click(); await W(300);
    ok('font picker: opens with every name a baked picture, loading no face', open > 30 && baked > 30 && after === before, JSON.stringify({ open, baked, before, after, took })); }
  // a knob the plan reads: dragging it does not replan at every step — only once it is let go
  { const sp = win.locator('[data-test=song-panel]'); await sp.getByRole('tab', { name: '風格' }).click(); await W(400);
    const r = await C(async () => { const s = window.__cadenza.player.get().session, inp = [...document.querySelectorAll('[data-test=song-panel] input[type=range]')].find(i => i.labels?.[0]?.textContent === '速度');
      if (!inp) return { found: false };
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set, v0 = s.version, k0 = s.style.k.speed ?? 1, wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 1; i <= 10; i++) { set.call(inp, String(k0 + i * 0.02)); inp.dispatchEvent(new Event('input', { bubbles: true })); await wait(40); }
      await wait(300); const during = s.version - v0, live = s.style.k.speed;
      inp.dispatchEvent(new Event('change', { bubbles: true })); await wait(1500); const after = s.version - v0;
      // (and back as it was, for what follows)
      set.call(inp, String(k0)); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); await wait(1200);
      return { found: true, during, after, live: +live.toFixed(2), want: +(k0 + 0.2).toFixed(2) }; });
    ok('knobs: dragging one the plan reads replans only once it is let go (its value follows the drag)', r.found && r.during === 0 && r.after >= 1 && r.live === r.want, JSON.stringify(r)); }
  // a rebuild waits for the segmenter and the face; asked for again meanwhile (every frame does), it is still the one
  { const r = await C(async () => { const s = window.__cadenza.player.get().session, v0 = s.version;
      // (each rebuild ends in one replan: twenty asks while one waits make one rebuild, one replan)
      s.setSpacing(s.spec.spacing); await Promise.all(Array.from({ length: 20 }, () => s.flush())); const builds = s.version - v0;
      // the colour split, struck on accents: switched on, its cues are made at once (a replan of the cues alone)
      const was = !!s.style.fx.chroma, v1 = s.version, cues0 = s.plan.cues; s.setEffect('chroma', !was); await s.flush();
      const recued = s.version - v1, sameplan = s.plan.cues !== cues0; s.setEffect('chroma', was); await s.flush();
      return { builds, recued, sameplan }; });
    ok('rebuilds: one at a time however often asked for; switching the colour split remakes its cues at once', r.builds === 1 && r.recued === 1 && r.sameplan, JSON.stringify(r)); }
  // a replan is made off the page's thread (engine/plan.worker.ts): the frames go on while it runs, and the plan is laid
  // out from the widths the page measured (every one of them there)
  { const r = await C(async () => { const c = window.__cadenza, s = c.player.get().session, st0 = { ...c.planStats }, v0 = s.version, was = s.style.motion || 'story';
      let gap = 0, last = performance.now(), on = true; const tick = () => { const n = performance.now(); gap = Math.max(gap, n - last); last = n; if (on) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 300));
      // (the longest wait between frames with nothing being planned, then while a replan runs: a frame here is slow —
      // a software canvas — so the replan is judged against the frames' own pace, not a fixed figure)
      gap = 0; await new Promise(r => setTimeout(r, 700)); const baseGap = gap; gap = 0;
      const t0 = performance.now(); c.api.editSong(x => x.applyMotion(was === 'waltz' ? 'groove' : 'waltz')); await s.flush(); const ms = performance.now() - t0;
      const replanGap = gap; c.api.editSong(x => x.applyMotion(was)); await s.flush(); on = false;
      return { worker: c.planStats.worker - st0.worker, here: c.planStats.here - st0.here, miss: c.planStats.miss, workerMs: Math.round(c.planStats.ms), totalMs: Math.round(ms), baseGap: Math.round(baseGap), replanGap: Math.round(replanGap), replans: s.version - v0 }; });
  // the performance overlay (settings) over the effect lyrics: frame rate, the time per layer, the GPU lyric layer
  { await C(() => window.__cadenza.setSettings({ perfHud: true })); await W(1500);
    const r = await C(() => { const c = window.__cadenza, P = c.engine.perf, el = document.querySelector('[data-test=perf-hud]');
      return { shown: !!el, text: el ? el.textContent.slice(0, 60) : '', fps: Math.round(P.fps), layers: Object.keys(P.layers).length, gpu: c.gpuStats.on, quads: c.gpuStats.quads, webgl2: !!document.createElement('canvas').getContext('webgl2') }; });
    await shot('fx-perf'); await C(() => window.__cadenza.setSettings({ perfHud: false })); await W(300);
    const gone = await C(() => !document.querySelector('[data-test=perf-hud]'));
    // (no WebGL2 here — Electron without a graphics card — the lyric layer is drawn as before, and says so)
    ok('performance overlay: shows the frame rate and each layer\'s time; the lyric layer on the GPU where WebGL2 is (else as before)', r.shown && r.fps > 0 && r.layers === 5 && (r.webgl2 ? r.gpu && r.quads > 0 : !r.gpu) && gone, JSON.stringify(r)); }
    ok('planning: a replan runs in the planning worker, from the measured widths, and the frames go on meanwhile', r.worker >= 1 && r.here === 0 && r.miss === 0 && r.replans >= 2 && r.replanGap <= r.baseGap * 1.3 + 120, JSON.stringify(r)); }
  await win.locator('[data-test=song-panel]').getByRole('tab', { name: '歌詞' }).click(); await W(300); await shot('fx-panel-lyrics');
  const ime = {};
  await win.locator('[data-test=song-panel] textarea').first().click(); await C(() => document.querySelector('[data-test=song-panel] textarea').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㄋ' })));
  await win.mouse.move(300, 450); await W(1000); ime.composing = await C(() => document.querySelector('[data-test=song-panel]').dataset.open);
  await C(() => document.querySelector('[data-test=song-panel] textarea').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你' })));
  await W(1000); ime.typing = await C(() => document.querySelector('[data-test=song-panel]').dataset.open);
  await C(() => document.activeElement.blur()); await win.mouse.move(320, 460); await W(1000); ime.left = await C(() => document.querySelector('[data-test=song-panel]') ? document.querySelector('[data-test=song-panel]').dataset.open : 'gone');
  ok('song panel: typing with an input method keeps it open; it closes once focus and pointer leave', ime.composing === 'true' && ime.typing === 'true' && ime.left !== 'true', JSON.stringify(ime));
  await win.mouse.move(1436, 450, { steps: 6 }); await W(800); await win.mouse.move(1250, 300, { steps: 8 }); await W(200);
  console.log('      panel', await C(() => document.querySelector('[data-test=song-panel]')?.dataset.open));
  // the cue symbols: Alt + a number types its symbol at the cursor, and its key above the text does the same
  { const ta = win.locator('[data-test=song-panel] textarea').first(); await ta.click(); await win.keyboard.press('Control+End');
    await win.keyboard.press('Alt+1'); await win.locator('[data-test=song-panel]').getByRole('toolbar').getByRole('button', { name: /#3/ }).click(); await W(200);
    const v = await ta.inputValue(), keys = await win.locator('[data-test=song-panel]').getByRole('toolbar').getByRole('button').count();
    ok('lyrics editor: cue symbols typed at the cursor, by Alt + their key or their button', v.endsWith('#1#3') && keys === 5, JSON.stringify({ tail: v.slice(-12), keys }));
    await win.keyboard.press('Backspace'); await win.keyboard.press('Backspace'); await win.keyboard.press('Backspace'); await win.keyboard.press('Backspace');
    await C(() => document.activeElement.blur()); }
  await win.locator('[data-test=song-panel]').getByRole('tab', { name: '風格' }).click(); await W(300);
  await C(() => window.__cadenza.api.editSong(s => s.setKnob('energy', 1.6))); await W(1000);
  const saved = await C(id => window.cadenzaLib.song(id).then(s => ({ k: s && s.style && s.style.k && s.style.k.energy, custom: s && s.style && s.style.preset })), ids['晨光']);
  ok('song panel: editing makes a custom theme bound to the song and saves it', saved.k === 1.6 && saved.custom === 'custom', JSON.stringify(saved));
  { const r = await C(async () => { const s = window.__cadenza.player.get().session, look = { bg: s.style.bg, font: s.style.font, bgStyle: s.style.bgStyle }, was = s.style.motion || 'story';
      const opts = [...document.querySelectorAll('[data-test=song-panel] [role=radio]')].map(b => b.textContent);
      window.__cadenza.api.editSong(x => x.applyMotion('float')); await s.flush(); const after = { cut: s.style.cut, ltype: s.style.ltype, bg: s.style.bg, font: s.style.font, bgStyle: s.style.bgStyle };
      window.__cadenza.api.editSong(x => x.applyMotion(was)); await s.flush();
      return { rec: s.recommended, opts: opts.slice(0, 2), same: after.bg === look.bg && after.font === look.font && after.bgStyle === look.bgStyle, after }; });
    ok('style pane: a motion style is chosen apart from the look (the look stays), one recommended for the song', r.same && r.after.cut === 'hover' && r.after.ltype === 'orbit' && !!r.rec, JSON.stringify(r)); }
  // 我的風格: named and saved from the pane, shown as the chosen style, and taken in again after another one
  { const P = win.locator('[data-test=song-panel]'), f = P.getByLabel('風格名稱'); await f.fill('我的測試'); await f.press('Enter');
    await P.getByRole('button', { name: '存成我的風格' }).click();
    const shown = await win.locator('[data-test=song-panel] [role=radio][aria-checked=true]', { hasText: '我的測試' }).first().textContent({ timeout: 3000 }).catch(() => '');
    const r = await C(async shown => { const s = window.__cadenza.player.get().session, list = JSON.parse(localStorage.getItem('cz-motions') || '[]'), e = list[0];
      window.__cadenza.api.editSong(x => { x.applyMotion('float'); x.setKnob('energy', 1); }); await s.flush(); const away = [s.style.cut, s.style.k.energy, s.style.motionId];
      window.__cadenza.api.editSong(x => x.applySavedMotion(e.motion, e.id, e.name)); await s.flush();
      return { n: list.length, name: e && e.name, shown, away, back: [s.style.cut, s.style.k.energy, s.style.motionName] }; }, shown);
    ok('my styles: a motion saved under a name, shown as the chosen style, and taken in again (camera and knobs)', r.n === 1 && r.name === '我的測試' && r.shown.startsWith('我的測試') && r.away[2] === null && r.back[1] === 1.6 && r.back[2] === '我的測試', JSON.stringify(r)); }
  await shot('fx-panel-motion');
  await win.mouse.move(700, 450); await W(1200);

  /* ---------- MV ---------- */
  await win.mouse.move(700, 860); await W(300);
  await win.locator('[data-test=fx-bar]').getByRole('button', { name: 'MV' }).click(); await W(400); await shot('fx-mvbind');
  await win.locator('[data-test=modal]').getByRole('button', { name: /選擇/ }).click();
  // (the clip loads, then fades in: waited for up to six seconds rather than for a fixed time)
  const mvNow = () => C(() => { const e = window.__cadenza.engine; return { on: e.mv.on, k: e.mv.k, bg: e.session.style.bgStyle, ready: window.__cadenza.player.get().mv.ready }; });
  let mv = await mvNow(); for (let i = 0; i < 30 && !(mv.on && mv.ready && mv.k > 0.99); i++) { await W(200); mv = await mvNow(); }
  ok('MV mode: bound, fading in over the song\'s own backdrop', mv.on && mv.ready && mv.k > 0.99 && mv.bg === 'cover', JSON.stringify(mv));
  // an MV shorter than the song: once it has run out, the song is as it is without one — whatever its theme is now
  { const r = await C(() => { const e = window.__cadenza.engine, s = e.session, d = e.mv.el.duration, keep = s.style.bgStyle;
      s.style.bgStyle = 'gothic'; const tin = 5, tout = d - s.audioStart - e.mv.offset + 1.5, a = e.frameAt(tin), b = e.frameAt(tout); s.style.bgStyle = keep;
      return { dur: s.dur, tout, during: !!(a && a.media.mv && a.media.mv.k > 0.9), after: b ? b.media.mv : 'none', stale: b ? 'mvDone' in b.media : true }; });
    ok('MV shorter than the song: after it the song is as without one (no MV layer, no stand-in theme)', r.tout < r.dur && r.during && r.after === null && !r.stale, JSON.stringify(r)); }
  await shot('fx-mv');
  await C(() => window.__cadenza.api.setMvOn(false)); await W(1200);
  // back to the page: the title bar's brand and search (above the blur) stay away — the play page covers the window, so
  // they never come back over it
  const tbBack = C(() => new Promise(res => { const seen = []; const t0 = performance.now(); const tb = document.querySelector('[data-test=titlebar]'), brand = tb.children[0], mid = tb.children[1];
    const tick = () => { const v = [...document.body.children].find(x => x.style && x.style.zIndex === '60'), b = v && v.style.display !== 'none' ? parseFloat((v.style.backdropFilter.match(/blur\(([\d.]+)/) || [0, 0])[1]) : 0;
      seen.push({ b, view: window.__cadenza.engine.view, o: Math.max(+getComputedStyle(brand).opacity * (getComputedStyle(brand).visibility === 'visible'), +getComputedStyle(mid).opacity * (getComputedStyle(mid).visibility === 'visible')) });
      if (performance.now() - t0 < 1100) requestAnimationFrame(tick); else res(seen); }; tick(); }));
  await win.keyboard.press('Escape');
  { const seen = await tbBack, early = seen.filter(x => x.view === 'effect' && x.o > 0.02), lateIn = seen.filter(x => x.view !== 'effect' && x.b > 18 && x.o > 0.6);
    const shown = seen.filter(x => x.o > 0.02);
    ok('back to now playing: the brand and search stay away over the play page (never shown on the way)', !early.length && !shown.length, JSON.stringify({ early: early.length, shown: shown.length, last: seen[seen.length - 1] })); }
  ok('effect lyrics: Esc hands back to now playing', await layerIs('np')); await W(300); await shot('np-back');
  // interrupted blurs: effect lyrics and back again faster than a blur takes, then settled — the veil must clear (an
  // interrupted blur used to leave the whole window blurred for good)
  for (const [l, ms] of [['fx', 120], ['np', 90], ['fx', 200], ['np', 60], ['fx', 40], ['np', 150]]) { await C(l => window.__cadenza.ui.set({ layer: l }), l); await W(ms); }
  await layerIs('np'); await W(1200);
  const veilLeft = await C(() => { const v = [...document.body.children].find(x => x.style && x.style.zIndex === '60'); return v ? { shown: v.style.display !== 'none', f: v.style.backdropFilter } : null; });
  ok('transitions: blurs interrupted again and again leave no veil once settled', veilLeft && !veilLeft.shown, JSON.stringify(veilLeft));
  const npEdge = await C(() => { const r = document.querySelector('[data-test=stage]').getBoundingClientRect(), n = document.querySelector('[data-test=np]').getBoundingClientRect(), b = document.querySelector('[data-close]'), br = b && b.getBoundingClientRect(), hit = br && document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    return { coverLeft: Math.round(document.querySelector('[data-test=np-cover]').getBoundingClientRect().left), stage: [r.left, r.top, r.width, r.height].map(Math.round), np: [n.left, n.top, n.width, n.height].map(Math.round), win: [innerWidth, innerHeight], close: !!(hit && b.contains(hit)) }; });
  // (the play page covers the whole window; the window's own buttons stay above it)
  ok('now playing: it opens straight up — the cover in flight keeps the left edge it lands on', Math.abs(mid.coverLeft - npEdge.coverLeft) <= 2, JSON.stringify({ flying: mid.coverLeft, landed: npEdge.coverLeft }));
  ok('now playing: the page covers the whole window, the window buttons above it', npEdge.stage.join() === `0,0,${npEdge.win.join()}` && npEdge.np.join() === npEdge.stage.join() && npEdge.close, JSON.stringify(npEdge));
  ok('now playing: no "now playing" label at the top (the page itself says it)', !(await C(() => [...document.querySelectorAll('.kicker')].some(k => k.textContent === '正在播放' && k.getClientRects().length))));
  await win.keyboard.press('Escape');
  ok('now playing: Esc closes into the card', await layerIs('none')); await W(300);

  /* ---------- lyrics typed for a song are written to its .lrc; the next song follows at the end ---------- */
  // (the .lrc target: the setting's other choice — the default, into the tags, is tested below)
  await C(() => window.__cadenza.setSettings({ lyricsTarget: 'lrc' }));
  await C(async id => window.__cadenza.api.playIds([id], 0), ids['無詞的歌']); await W(1500);
  await C(() => window.__cadenza.api.useLyrics('[00:01.00]新的第一行\n[00:05.00]第二行')); await W(500);
  await C(() => window.__cadenza.setSettings({ lyricsTarget: 'tag' }));
  const lrcPath = path.join(CACHE, 'lib', 'A', '02 無詞的歌.lrc'), lrc = fs.existsSync(lrcPath) ? fs.readFileSync(lrcPath, 'utf8') : '';
  ok('lyrics: saved to the .lrc beside the audio file and shown at once', lrc.includes('新的第一行') && await C(() => window.__cadenza.player.get().session.doc.lines.length === 2), lrc.slice(0, 30).replace(/\s+/g, ' '));
  try { fs.rmSync(lrcPath); } catch (e) { /* gone */ }
  await C(async ([a, b]) => window.__cadenza.api.playIds([a, b], 0), [ids['無詞的歌'], ids['晨光']]); await W(1500);
  await C(() => { const e = window.__cadenza.engine; e.seek(e.session.musicEnd - 0.6); e.play(); }); await W(4000);
  ok('player: the next song starts when one ends', await C(t => window.__cadenza.player.get().shownId === t && window.__cadenza.engine.isPlaying, ids['晨光']));

  /* ---------- queue modes and shuffle ---------- */
  { const modes = await C(async ([a, b, c]) => { const A = window.__cadenza.api, P = window.__cadenza.player, out = {}, w = ms => new Promise(r => setTimeout(r, ms));
      await A.playIds([a, b, c], 0); await w(800);
      A.setMode('one'); await A.next(true); out.one = P.get().index;
      A.setMode('loop'); await A.next(true); out.loop1 = P.get().index; await A.next(true); await A.next(true); out.loopWrap = P.get().index;
      A.setMode('stop'); await A.playQueueAt(2); await A.next(true); await w(200); out.stopIdx = P.get().index; out.stopPlaying = window.__cadenza.engine.isPlaying;
      A.setMode('loop'); return out; }, [ids['晨光'], ids['Night Drive'], ids['無詞的歌']]);
    ok('queue modes: repeat one, repeat all (wraps round), stop at the end', modes.one === 0 && modes.loop1 === 1 && modes.loopWrap === 0 && modes.stopIdx === 2 && !modes.stopPlaying, JSON.stringify(modes));
    const sh = await C(() => { const A = window.__cadenza.api, q = window.__cadenza.player.get().queue; let good = true, cur = 0;
      for (let r = 0; r < 300; r++) { const seen = new Set([q[cur]]); for (let k = 0; k < q.length - 1; k++) { cur = A.shufflePick(q, cur); if (seen.has(q[cur])) good = false; seen.add(q[cur]); } } return good; });
    ok('shuffle: no repeats within a round', sh); }

  /* ---------- export from the library ---------- */
  await C(() => window.__cadenza.ui.set({ page: 'library', section: 'songs', detail: null })); await W(500);
  await win.locator('[role=listitem]', { hasText: '晨光' }).click({ button: 'right' }); await W(300);
  await win.getByRole('menuitem', { name: /匯出 MP4/  }).click(); await W(2000); await shot('export-dialog');
  const exOpen = await C(() => window.__cadenza.ui.get().modal && window.__cadenza.ui.get().modal.kind);
  await win.locator('[data-test=modal]').getByRole('combobox', { name: '解析度' }).click(); await W(300);
  await win.getByRole('option', { name: /720/ }).first().click(); await W(200);
  await win.locator('[data-test=modal]').getByRole('button', { name: '開始匯出' }).click();
  await win.waitForFunction(() => /完成/.test(document.querySelector('[data-test=modal] [role=status]')?.textContent || ''), null, { timeout: 180000 }).catch(() => {});
  const exMsg = await C(() => document.querySelector('[data-test=modal] [role=status]')?.textContent || '');
  ok('export: an MP4 of a library song, written straight to the chosen file', exOpen === 'export' && fs.existsSync(out) && fs.statSync(out).size > 100000, `${fs.existsSync(out) ? (fs.statSync(out).size / 1048576).toFixed(1) + ' MB' : 'no file'} · ${exMsg.slice(0, 80)}`);
  await shot('export-done'); await win.keyboard.press('Escape'); await W(300);

  /* ---------- the volume balance: every song measured; one steady gain towards a like loudness ---------- */
  { const v = await C(() => { const L = window.__cadenza.lib.get().tracks.filter(t => !t.protected), cur = window.__cadenza.lib.get().tracks.find(t => t.id === window.__cadenza.player.get().shownId);
      const db = cur && cur.loudness ? Math.max(-12, Math.min(12, -14 - cur.loudness.lufs, Math.max(0, -20 * Math.log10(cur.loudness.peak) - 1))) : null;
      return { measured: L.filter(t => t.loudness && isFinite(t.loudness.lufs)).length, all: L.length, lufs: cur && cur.loudness, want: db == null ? null : 10 ** (db / 20), got: window.__cadenza.engine.balance }; });
    ok('volume balance: every playable song measured (BS.1770), the playing one at its own steady gain', v.measured === v.all && v.want != null && Math.abs(v.got - v.want) < 1e-6, JSON.stringify(v));
    await C(() => window.__cadenza.setSettings({ volBalance: false })); await W(200); const off = await C(() => window.__cadenza.engine.balance);
    await C(() => window.__cadenza.setSettings({ volBalance: true })); await W(200); const back = await C(() => window.__cadenza.engine.balance);
    ok('volume balance: off in the settings, the song plays at its own level; on again, the same gain', off === 1 && Math.abs(back - v.want) < 1e-6, JSON.stringify({ off, back })); }

  /* ---------- an instrumental: marked from the song's menu — no words in the picture, the play page says it is an
     instrumental, the record theme by default ---------- */
  await win.locator('[role=listitem]', { hasText: '晨光' }).click({ button: 'right' }); await W(300);
  await win.getByRole('menuitem', { name: '標記為純音樂' }).click(); await W(600);
  await C(id => window.__cadenza.api.playIds([id], 0), ids['晨光']); await W(2500);
  const ins = await C(() => { const s = window.__cadenza.engine.session; return { marked: window.__cadenza.lib.get().tracks.find(t => t.title === '晨光').instrumental, lines: s.doc.lines.length, np: [...document.querySelectorAll('[data-test=np] b')].map(e => e.textContent).find(t => t.includes('純音樂')) || '', bg: s.style.bgStyle, cut: s.style.cut }; });
  ok('instrumental: marked from the menu, no words in the picture, the play page says 純音樂 請欣賞, the record theme by default', ins.marked === true && ins.lines === 0 && ins.np === '純音樂 請欣賞' && ins.bg === 'vinyl' && ins.cut === 'center', JSON.stringify(ins));
  await C(() => window.__cadenza.layers.openFx()); await W(2200); await shot('fx-instrumental'); await C(() => window.__cadenza.ui.set({ layer: 'none' })); await W(1500);
  await win.locator('[role=listitem]', { hasText: '晨光' }).click({ button: 'right' }); await W(300);
  await win.getByRole('menuitem', { name: '取消純音樂標記' }).click(); await W(2500);
  const ins2 = await C(() => { const s = window.__cadenza.engine.session; return { marked: !!window.__cadenza.lib.get().tracks.find(t => t.title === '晨光').instrumental, bg: s.style.bgStyle, lines: s.doc.lines.length }; });
  ok('instrumental: unmarked, the song is itself again (its lyrics, the cover theme)', !ins2.marked && ins2.bg === 'cover' && ins2.lines > 1, JSON.stringify(ins2));

  /* ---------- workshop ---------- */
  const before = await C(() => window.__cadenza.player.get().shownId);
  await C(() => window.__cadenza.engine.play()); await W(500);
  await win.getByRole('button', { name: '歌詞工坊' }).click(); await W(2500); await shot('workshop');
  const ws = await C(() => { const w = window.__cadenza.workshop.get().session, e = window.__cadenza.wsEngine; return { ws: w && w.spec.key, lines: w && w.doc.lines.length, own: e !== window.__cadenza.engine && e.session === w, playerPaused: !window.__cadenza.engine.isPlaying, canvas: !!document.querySelector('main canvas') }; });
  ok('workshop: its own project and engine; the player pauses', ws.ws === 'workshop' && ws.lines > 3 && ws.own && ws.playerPaused && ws.canvas, JSON.stringify(ws));
  await C(() => window.__cadenza.wsEngine.play()); await W(1500);
  ok('workshop: plays on its own clock', await C(() => window.__cadenza.wsEngine.time > 0.5)); await shot('workshop-playing');
  await win.getByRole('button', { name: '音樂庫' }).click(); await W(800);
  ok('workshop: leaving it stops it, the player\'s song is still there', await C(b => !window.__cadenza.wsEngine.isPlaying && window.__cadenza.player.get().shownId === b, before));

  /* ---------- hit areas in every layer ---------- */
  { const sts = [];
    sts.push(['library', await dragHits()]);
    await win.locator('[data-test=card]').getByTitle('展開').first().click(); await layerIs('np'); sts.push(['now playing', await dragHits()]);
    await win.getByRole('button', { name: '特效歌詞' }).click(); await layerIs('fx'); await win.mouse.move(1436, 300); await W(800); sts.push(['effect view + panel', await dragHits()]);
    await win.keyboard.press('Escape'); await W(300); await win.keyboard.press('Escape'); await layerIs('np'); await win.keyboard.press('Escape'); await layerIs('none');
    await win.locator('[role=listitem]').first().click({ button: 'right' }); await W(300); sts.push(['menu', await dragHits()]); await win.keyboard.press('Escape'); await W(200);
    const bad = sts.filter(([, r]) => r.bad.length);
    ok('hit areas: no control under a window-drag region (library, now playing, effect view, menu)', sts[0][1].sane && !bad.length, bad.map(([n, r]) => `${n}: ${r.bad.join(', ')}`).join(' | ')); }

  /* ---------- a playlist reordered by dragging ---------- */
  { const pid = await C(ids => window.cadenzaLib.playlist('create', 'Drag', [ids['晨光'], ids['Night Drive'], ids['無詞的歌']]), ids); await W(400);
    await C(pid => window.__cadenza.ui.set({ page: 'library', detail: { kind: 'playlist', key: pid } }), pid); await W(800);
    const rows = await win.$$('[role=list] [role=listitem]'); const a = await rows[0].boundingBox(), c = await rows[2].boundingBox();
    await win.mouse.move(a.x + 400, a.y + a.height / 2); await win.mouse.down();
    for (let k = 1; k <= 12; k++) { await win.mouse.move(a.x + 400, a.y + a.height / 2 + (c.y - a.y) * k / 12); await W(30); }
    await W(150); await shot('drag'); await win.mouse.up(); await W(700);
    const order = await C(pid => window.cadenzaLib.get().then(v => v.playlists.find(p => p.id === pid).tracks), pid);
    ok('playlist: a dragged row lands in its new place', order[2] === ids['晨光'] && order[0] === ids['Night Drive'], JSON.stringify(order.map(x => Object.keys(ids).find(k => ids[k] === x))));
    await C(pid => window.cadenzaLib.playlist('delete', pid), pid); await C(() => window.__cadenza.ui.set({ detail: null })); await W(300); }

  /* ---------- a song analysed again from its menu: its analysis dropped, then made anew (and checked) ---------- */
  { await win.locator('[role=listitem]', { hasText: '晨光' }).click({ button: 'right' }); await W(300);
    await win.getByRole('menuitem', { name: '重新掃描' }).click(); await W(400);
    const an = () => C(() => window.cadenzaLib.get().then(v => v.tracks.find(t => t.title === '晨光').analyzed));
    const dropped = await an(); let back = 0; for (let i = 0; i < 60 && !(back > 0); i++) { await W(1000); back = await an(); }
    ok('rescan: a song analysed again from its menu (dropped, then analysed anew)', back > 0, JSON.stringify({ dropped, back })); }
  /* ---------- streaming: a song not analysed yet plays at once on its opening's reading, the whole one taking over ---------- */
  { await C(() => window.__cadenza.pauseAnalysis(true));
    await C(id => { window.__cadenza.api.forgetPrepared(id); return window.cadenzaLib.reanalyze([id]); }, ids['Night Drive']);
    const t0 = Date.now(); await C(id => window.__cadenza.api.playIds([id], 0), ids['Night Drive']); const wait = Date.now() - t0;
    let st = null; for (let i = 0; i < 60 && st !== 'streamed'; i++) { await W(500); st = await C(() => window.__cadenza.api.rhythmState()); }
    const r = await C(id => Promise.all([window.cadenzaLib.analysis(id, 3), window.__cadenza.player.get()]).then(([a, p]) => ({ saved: !!a && !a.partial, partial: !!p.session.analysis.partial, playing: p.playing })), ids['Night Drive']);
    await C(() => window.__cadenza.pauseAnalysis(false));
    ok('streaming: an unanalysed song plays at once, the whole reading put in place while it plays (and only that one kept)', st === 'streamed' && r.saved && !r.partial && r.playing, JSON.stringify({ st, wait, ...r })); }
  /* ---------- edited lyrics written into the song's own tags (the file let go of and taken up again) ---------- */
  { await C(id => window.__cadenza.api.playIds([id], 0), ids['無詞的歌']); await W(2500);
    const before = await C(id => window.cadenzaLib.get().then(v => v.tracks.find(t => t.id === id).analyzed), ids['無詞的歌']);
    await C(() => window.__cadenza.api.useLyrics('[00:01.00]寫入標籤測試\n[00:05.00]第二行')); await W(1500);
    const r = await C(id => Promise.all([window.cadenzaLib.lyrics(id), window.cadenzaLib.get().then(v => v.tracks.find(t => t.id === id))]).then(([l, t]) => ({ src: l && l.source, has: !!(l && l.text.includes('寫入標籤測試')), analyzed: t.analyzed, embedded: t.embedded, playing: window.__cadenza.player.get().playing, shown: window.__cadenza.player.get().shownId === id })), ids['無詞的歌']);
    ok('lyrics into the tags: written into the file, read back from it, the song playing on, its analysis kept', r.src === 'embedded' && r.has && r.embedded && r.shown && r.analyzed === before && before > 0, JSON.stringify({ ...r, before })); }
  /* ---------- poster wall, settings, light theme ---------- */
  await win.getByRole('button', { name: '海報牆' }).click(); await W(900); await shot('wall');
  await win.getByRole('button', { name: '設定' }).click(); await W(600); await shot('settings');
  // the native runtime for the rhythm engine's networks (ONNX Runtime in a utility process): its settings shown; with
  // CADENZA_NATIVE_MODELS (the models already there) one Beat This! window really runs through it, on the CPU here
  { const st = await C(() => window.cadenzaInfer.status()), have = !!process.env.CADENZA_NATIVE_MODELS;
    const rows = { mode: await win.getByRole('radio', { name: '本機加速（自動）' }).count(), get: await win.getByRole('button', { name: /^下載（約 \d+ MB）$/ }).count(), dev: await win.getByRole('radio', { name: '僅 CPU' }).count() };
    let run = null;
    if (have) run = await C(async () => { const t = performance.now(), r = await window.cadenzaInfer.run('beat', { spect: new Float32Array(1500 * 128) }), s = await window.cadenzaInfer.status();
      return { n: r.beat.length, m: r.downbeat.length, finite: [...r.beat].every(Number.isFinite), ep: s.ep, ms: Math.round(performance.now() - t) }; });
    ok('settings: the native runtime is offered, its models fetched on request (or, when there, its device)', st.runtime && rows.mode === 1 && (have ? st.models && rows.dev === 1 : !st.models && rows.get === 1), JSON.stringify({ st, rows }));
    if (have) ok('native: a Beat This! window runs in the utility process (CPU here)', run && run.n === 1500 && run.m === 1500 && run.finite && run.ep === 'cpu', JSON.stringify(run)); }
  // the rhythm engine: its setting, the status line (the device it runs on, or why not and that the built-in analysis
  // is used), and the models served to the page as cadenza://model/ (only the engine's files)
  { await W(800); probing = true; const r = await C(async () => { const head = async f => (await fetch('cadenza://model/' + f, { method: 'HEAD' }).catch(() => ({ status: 0 }))).status;
      const txt = document.body.innerText; return { seg: !!document.querySelector('[role=radio][aria-checked]') && txt.includes('節奏識別') && txt.includes('神經網路（自動）'),
        status: /使用 .+ 分析|無法使用神經網路/.test(txt), beat: await head('beat_this-wgsl.bin'), demucs: await head('htdemucs-wgsl.bin'), other: await head('..%2Fpackage.json') }; });
    await W(300); probing = false; const has = require('fs').existsSync(path.join(ROOT, 'models', 'beat_this-wgsl.bin'));
    ok('rhythm engine: the setting and its status line, the models served (and nothing else)', r.seg && r.status && (!has || (r.beat === 200 && r.demucs === 200)) && r.other === 404, JSON.stringify({ ...r, has })); }
  // the data group: each action asks first (cancelled here: nothing is cleared); the photosensitivity warning is shown
  { await win.getByRole('button', { name: '清除所有快取' }).click(); await W(400); await shot('settings-confirm');
    const dlg = await C(() => { const m = document.querySelector('[data-test=modal][data-kind=confirm]'); return m ? m.innerText : null; });
    await win.locator('[data-test=modal]').getByRole('button', { name: '取消' }).click(); await W(400);
    const after = await C(() => window.cadenzaLib.get().then(v => ({ modal: !!document.querySelector('[data-test=modal]'), an: v.tracks.filter(t => t.analyzed > 0).length })));
    const warn = await C(() => document.body.innerText.includes('光敏性癲癇提醒'));
    ok('settings: clearing the caches asks first, and cancelling keeps them; the photosensitivity warning is shown', !!dlg && dlg.includes('清除') && !after.modal && after.an > 0 && warn, JSON.stringify({ dlg: dlg && dlg.slice(0, 40), ...after, warn })); }
  await win.getByRole('radio', { name: '淺色' }).click(); await W(600); await shot('settings-light');
  { await win.getByRole('radio', { name: '白色' }).click(); await W(500); await shot('settings-white');
    const white = await C(() => ({ tone: document.documentElement.dataset.tone, bg: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() }));
    await win.getByRole('radio', { name: '紙色' }).click(); await W(400);
    const paper = await C(() => ({ tone: document.documentElement.dataset.tone, bg: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() }));
    ok('settings: the light theme in white (as before) or paper', white.tone === 'white' && ['#fff', '#ffffff'].includes(white.bg) && paper.tone === 'paper' && paper.bg === '#faf9f5', JSON.stringify({ white, paper })); }
  await win.getByRole('button', { name: '音樂庫' }).click(); await W(600); await shot('library-light');
  await win.locator('[data-test=card]').getByTitle('展開').first().click(); await layerIs('np'); await W(300); await shot('np-light');
  await win.keyboard.press('Escape'); await layerIs('none');
  const fsIcon = () => C(() => document.querySelector('[data-test=titlebar] [aria-label$="全螢幕"]')?.getAttribute('aria-label'));
  const f0 = await fsIcon(); await C(() => window.cadenzaDesktop.win('full')); await W(1500); const f1 = await fsIcon(); await C(() => window.cadenzaDesktop.win('full')); await W(1500); const f2 = await fsIcon();
  ok('full screen: the button shows enter in a window and leave in full screen', f0 === '全螢幕' && f1 === '結束全螢幕' && f2 === '全螢幕', JSON.stringify([f0, f1, f2]));

  ok('no page errors', !errs.length, errs.slice(0, 5).join(' | '));
  await app.close();
  console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
