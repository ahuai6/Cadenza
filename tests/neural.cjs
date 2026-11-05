// The neural rhythm engine end to end, the real models on WebGPU (SwiftShader here, no GPU needed): a synthetic song
// with a known score — 128 BPM in 4/4, four bars of pads alone, then a kit (kick on 1 and 3, snare on 2 and 4, hats
// on the eighths) with bass — through the one interface the app uses (analyzeInBackground), checked against the score.
//   node scripts/models.mjs && npx vite build --mode harness && node tests/neural.cjs
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
const serve = require('./serve.cjs');
const ROOT = path.resolve(__dirname, '..'), DIST = path.join(ROOT, 'dist-harness'), MODELS = path.join(ROOT, 'models');
let failed = 0; const ok = (name, pass, detail) => { if (!pass) failed++; console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
(async () => {
  if (!fs.existsSync(path.join(MODELS, 'beat_this-wgsl.bin'))) { console.log('skip  no models (node scripts/models.mjs)'); process.exit(0); }
  if (!fs.existsSync(path.join(DIST, 'harness.html')) || process.env.BUILD !== '0') execSync('npx vite build --mode harness', { cwd: ROOT, stdio: 'ignore' });
  fs.mkdirSync(path.join(DIST, 'models'), { recursive: true });
  for (const f of fs.readdirSync(MODELS)) if (f.endsWith('.bin')) { const d = path.join(DIST, 'models', f); if (!fs.existsSync(d)) fs.symlinkSync(path.join(MODELS, f), d); }
  const { server, url } = await serve(DIST);
  // (the full browser: the headless shell has no WebGPU)
  const exe = fs.readdirSync('/opt/pw-browsers').find(d => /^chromium-\d/.test(d));
  const browser = await chromium.launch({ executablePath: exe ? `/opt/pw-browsers/${exe}/chrome-linux64/chrome` : undefined,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-fallback-to-gl-for-testing', '--ignore-gpu-blocklist'] });
  const p = await browser.newPage(), errs = [], logs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/\[neural\]/.test(m.text())) { logs.push(m.text()); console.log('  ' + m.text()); } });
  await p.exposeFunction('report', s => console.log('  … ' + s));
  // NATIVE=<models dir>: the networks run by the desktop app's native runtime (electron/infer.cjs, ONNX Runtime on the
  // CPU here) instead of the WebGPU kernels — the same song, the same checks
  const NATIVE = process.env.NATIVE; let nat = null;
  if (NATIVE) {
    const ops = require('../electron/infer.cjs'), init = ops.init({ modelsDir: NATIVE, prefer: 'cpu' }); nat = { ms: { beat: [], separate: [] } };
    const timed = (k, f) => async (...a) => { await init; const t = Date.now(), r = await f(...a); nat.ms[k].push(Date.now() - t); return r; };
    await p.exposeFunction('nativeBeat', timed('beat', async spect => { const r = await ops.beat({ spect: Float32Array.from(spect) }); return { beat: Array.from(r.beat), downbeat: Array.from(r.downbeat) }; }));
    await p.exposeFunction('nativeSeparate', timed('separate', async (l, r) => (await ops.separate({ left: Float32Array.from(l), right: Float32Array.from(r) })).map(s => ({ left: Array.from(s.left), right: Array.from(s.right) }))));
  }
  await p.goto(url + '/harness.html'); await p.waitForFunction(() => window.H);
  if (NATIVE) await p.evaluate(() => H.rhythm.setNativeRuntime({ label: 'native cpu', segment: 343980, ready: async () => true,
    beat: async spect => { const r = await window.nativeBeat(Array.from(spect)); return { beat: Float32Array.from(r.beat), downbeat: Float32Array.from(r.downbeat) }; },
    separate: async (l, r) => (await window.nativeSeparate(Array.from(l), Array.from(r))).map(s => ({ left: Float32Array.from(s.left), right: Float32Array.from(s.right) })) }));
  const r = await p.evaluate(async ([drumSecs, skipDrums]) => {
    const BPM = 128, B = 60 / BPM, SR = 44100, DUR = 46, ctx = new OfflineAudioContext(2, SR * DUR, SR), INTRO = 4 * 4 * B;
    const noise = ctx.createBuffer(1, SR, SR); { const d = noise.getChannelData(0); let s = 7; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823 - 1; } }
    const env = (g, t, a, peak, dec) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.001, t + dec); };
    const kick = t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); env(g, t, 0.002, 0.9, 0.35); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.4); };
    const snare = t => { const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = noise; f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7; env(g, t, 0.001, 0.6, 0.18); n.connect(f).connect(g).connect(ctx.destination); n.start(t, Math.random() * 0.5); n.stop(t + 0.2);
      const o = ctx.createOscillator(), g2 = ctx.createGain(); o.frequency.value = 190; env(g2, t, 0.001, 0.3, 0.1); o.connect(g2).connect(ctx.destination); o.start(t); o.stop(t + 0.12); };
    const hat = t => { const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = noise; f.type = 'highpass'; f.frequency.value = 8000; env(g, t, 0.001, 0.22, 0.05); n.connect(f).connect(g).connect(ctx.destination); n.start(t, Math.random() * 0.5); n.stop(t + 0.06); };
    const tone = (t, hz, len, peak, type = 'sawtooth', cut = 900) => { const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = type; o.frequency.value = hz; f.type = 'lowpass'; f.frequency.value = cut;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + Math.min(0.3, len / 3)); g.gain.setValueAtTime(peak, t + len * 0.8); g.gain.linearRampToValueAtTime(0, t + len); o.connect(f).connect(g).connect(ctx.destination); o.start(t); o.stop(t + len + 0.01); };
    const roots = [110, 87.31, 130.81, 98];
    for (let bar = 0; bar * 4 * B < DUR - 4 * B; bar++) { const t0 = bar * 4 * B, rt = roots[bar % 4];
      for (const m of [2, 2.5, 3]) tone(t0, rt * m, 4 * B, 0.05);                                   // the pad: a chord a bar, slow attack
      if (t0 < INTRO - 1e-6) continue;
      for (let k = 0; k < 4; k++) { const t = t0 + k * B; if (k % 2 === 0) kick(t); else snare(t); tone(t, rt / 2, B * 0.8, 0.16, 'square', 400); }
      for (let k = 0; k < 8; k++) hat(t0 + k * B / 2); }
    const buf = await ctx.startRendering(); window.__song = { buf, INTRO, SR, B };
    H.rhythm.setModelBase(new URL('models/', location.href).href); H.rhythm.setRhythmEngine('auto');
    const st = await H.rhythm.neuralStatus(); if (!st.ok) return { st };
    // the beats first (the urgent path: no drum stem), then the drums on a stretch of the kit (HTDemucs is slow on an
    // emulated GPU: a few segments are enough to see it separate and pick)
    let last = 0; const t0 = performance.now(), prog = [];
    const a = await H.rhythm.analyzeInBackground(buf, k => { prog.push(k); if (k - last > 0.1) { last = k; window.report(`beats ${(k * 100).toFixed(0)} % at ${((performance.now() - t0) / 1000).toFixed(0)} s`); } }, { drums: false }); const ms = performance.now() - t0;
    const clip = { numberOfChannels: 2, sampleRate: SR, getChannelData: c => buf.getChannelData(c).subarray(Math.round(INTRO * SR) - SR * 2, Math.round(INTRO * SR) + SR * drumSecs) };
    let lastD = 0; const t1 = performance.now();
    const ND = skipDrums ? null : await H.neuralRhythm(clip, k => { if (k - lastD > 0.05) { lastD = k; window.report(`drums ${(k * 100).toFixed(0)} % at ${((performance.now() - t1) / 1000).toFixed(0)} s`); } }, { drums: true });
    const off = INTRO - 2, dd = ND && ND.drums ? ND.drums : { times: [], kinds: [] }, dk = [0, 0, 0]; dd.kinds.forEach(k => dk[k]++);
    const kickT = dd.times.filter((t, j) => dd.kinds[j] === 0).map(t => t + off), snareT = dd.times.filter((t, j) => dd.kinds[j] === 1).map(t => t + off);
    const onGrid = (ts, phase) => ts.filter(t => t > INTRO + 0.05 && Math.abs((((t - phase) / (2 * B)) % 1 + 1) % 1 - 0.5) > 0.42).length / Math.max(1, ts.filter(t => t > INTRO + 0.05).length);
    const drumR = { ran: !!ND && ND.drumsRun, drumless: ND && ND.drumless, hits: dd.times.length, kinds: dk, coverage: ND && ND.drums ? ND.drums.coverage : null, kickOn13: onGrid(kickT, 0), snareOn24: onGrid(snareT, B), ms: Math.round(performance.now() - t1),
      voice: ND && ND.voice ? { n: ND.voice.v.length, rate: ND.voice.rate, sung: ND.voice.v.filter(x => x >= 0.35).length / ND.voice.v.length } : null };
    const gaps = a.beats.slice(1).map((t, i) => t - a.beats[i]).sort((x, y) => x - y), gap = gaps[gaps.length >> 1];
    const map = new H.rhythm.RhythmMap(a), bars = a.bars || [], barLens = bars.slice(1).map((b, i) => b - bars[i]);
    // where the bars fall against the score's (the first beat of every 4)
    const downErr = bars.map(i => { const t = a.beats[i], k = Math.round(t / (4 * B)); return Math.abs(t - k * 4 * B); });
    const inBeat = a.beats.map(t => { const k = Math.round(t / B); return Math.abs(t - k * B); });
    const introBeats = a.beats.map((t, i) => [t, i]).filter(([t]) => t < INTRO - 0.3), drumBeats = a.beats.map((t, i) => [t, i]).filter(([t]) => t > INTRO + 2 * B && t < DUR - 6);
    const hits = map.select({ sensitivity: 1, gapBeats: 2 }), H2 = new H.rhythm.Signals(map).grooveHits();
    return { st, ms: Math.round(ms), engine: a.engine, bpm: a.tempo.bpm, gap, meter: a.meter, nBars: bars.length, barLens: [...new Set(barLens)],
      downMaxErr: Math.max(...downErr.slice(1, -1)), beatErr: inBeat.slice(2, -2).sort((x, y) => x - y)[Math.floor(inBeat.length * 0.9)],
      introRhythmic: introBeats.map(([, i]) => a.accents.rhythmic[i]), drumRhythmic: drumBeats.map(([, i]) => a.accents.rhythmic[i]),
      stems: a.stems, drumR,
      introGroove: H2.filter(h => h.t < INTRO - 0.3).length, drumGroove: H2.filter(h => h.t > INTRO).length, strongInIntro: hits.filter(e => e.t < INTRO - 0.3).length,
      prog: [prog[0], prog[prog.length - 1]], version: a.version };
  }, [+(process.env.DRUM_SECS || 8), !!process.env.SKIP_DRUMS]);
  console.log(JSON.stringify(r)); for (const l of logs) console.log('  ' + l);
  ok('neural: the engine can run here (WebGPU, models)', r.st && r.st.ok, JSON.stringify(r.st));
  if (NATIVE) { const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    ok('native: the networks ran natively (not the WebGPU kernels)', r.st && r.st.native && nat.ms.beat.length > 0 && (process.env.SKIP_DRUMS || nat.ms.separate.length > 0),
      `beat windows ${nat.ms.beat.length} (avg ${avg(nat.ms.beat)} ms), segments ${nat.ms.separate.length} (avg ${avg(nat.ms.separate)} ms, first ${nat.ms.separate[0]} ms with the model's loading)`); }
  if (r.st && r.st.ok) {
    ok('neural: the analysis comes from the neural engine, through the same interface', r.engine === 'neural' && r.version >= 3);
    ok('neural: the tempo is the score\'s (128 BPM, within 1)', Math.abs(r.bpm - 128) <= 1 && Math.abs(r.gap - 60 / 128) < 0.01, `${r.bpm} BPM, beat ${r.gap?.toFixed(4)} s`);
    ok('neural: every beat lands on the score (90 % within 25 ms)', r.beatErr < 0.025, `${(r.beatErr * 1000).toFixed(1)} ms`);
    ok('neural: bars of four, each downbeat on the score\'s (within 40 ms)', r.meter === 4 && r.nBars >= 8 && r.downMaxErr < 0.04, `meter ${r.meter}, ${r.nBars} bars, lengths ${r.barLens}, worst ${(r.downMaxErr * 1000).toFixed(0)} ms`);
    ok('neural: the hurried path skips the drum stem and says so', r.stems === 'skipped');
    const D = r.drumR;
    if (!process.env.SKIP_DRUMS) ok('neural: the drum stem is separated and its hits picked (kicks on 1 and 3, the snares found on 2 and 4, hats)', D.ran && !D.drumless && D.hits >= 20 && D.kinds[0] >= 3 && D.kinds[2] >= 3 && D.kickOn13 > 0.8 && (D.kinds[1] === 0 || D.snareOn24 > 0.8),
      `${D.hits} hits, kinds ${D.kinds}, coverage ${D.coverage}, kicks on 1/3 ${(D.kickOn13 * 100).toFixed(0)} %, snares on 2/4 ${(D.snareOn24 * 100).toFixed(0)} %, ${(D.ms / 1000).toFixed(0)} s`);
    // (the song has no singing: the vocal stem, separated in the same pass, is what leaked in — none, or hardly sung)
    if (!process.env.SKIP_DRUMS) ok('neural: the voice is separated with the drums, and a song without singing has (almost) none', D.ran && (!D.voice || D.voice.sung < 0.15), JSON.stringify(D.voice));
    ok('neural: the pad intro has no rhythm (no groove, no strong accents there), the kit has', r.introRhythmic.every(v => v === 0) && r.drumRhythmic.filter(v => v === 1).length / r.drumRhythmic.length > 0.9 && r.introGroove === 0 && r.strongInIntro === 0 && r.drumGroove > 40,
      `intro ${r.introRhythmic.join('')}, groove ${r.introGroove}/${r.drumGroove}, strong in intro ${r.strongInIntro}`);
    ok('neural: the beats take seconds, not minutes (here on an emulated GPU)', r.ms < 600000, `${(r.ms / 1000).toFixed(0)} s`);
    ok('neural: progress is reported from start to end', r.prog[0] < 0.2 && r.prog[1] === 1, JSON.stringify(r.prog));
    // songs asked for at once take turns on the one worker (its networks share their buffers): two in the background,
    // then the song about to play — it does not wait behind them (the running one is stopped and runs again after),
    // and every one of them comes back right, none of them dropped to the built-in analysis
    if (!process.env.SKIP_QUEUE) {
      const q = await p.evaluate(async () => {
        const { buf, INTRO, SR, B } = window.__song, secs = +(window.QUEUE_SECS || 10), order = [];
        const clip = k => ({ numberOfChannels: 2, sampleRate: SR, getChannelData: c => buf.getChannelData(c).subarray(Math.round((INTRO + k) * SR), Math.round((INTRO + k + secs) * SR)) });
        const run = (name, k, o) => H.neuralRhythm(clip(k), null, { drums: false, ...o }).then(r => { order.push(name); return r; });
        const bg1 = run('bg1', 0, {}), bg2 = run('bg2', 2, {});
        await new Promise(r => setTimeout(r, 1500));
        const urgent = run('urgent', 4, { urgent: true });
        const rs = await Promise.all([bg1, bg2, urgent]);
        const gap = r => { if (!r || r.beats.length < 4) return null; const g = r.beats.slice(1).map((t, i) => t - r.beats[i]).sort((x, y) => x - y); return g[g.length >> 1]; };
        return { order, gaps: rs.map(gap), B };
      });
      ok('neural: songs asked for at once take turns, the one about to play first, and all come back right', q.order[0] === 'urgent' && q.gaps.every(g => g != null && Math.abs(g - q.B) < 0.015),
        JSON.stringify({ order: q.order, gaps: q.gaps.map(g => g && +g.toFixed(4)) }));
    }
  }
  ok('neural: no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0);
})();
