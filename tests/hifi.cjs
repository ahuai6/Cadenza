// The Hi-Fi output (native/cadenza-audio) against a simulated DAC that consumes in real time and records every byte it is sent.
// Checks: bit-perfect output, the device following each song's rate, resampling only when the DAC lacks the rate,
// silence for the DAC to lock after opening, preloading, no clicks on pause / seek / song change, the gain glide,
// the clock, and the fallback to shared mode when exclusive mode is refused.
//   node tests/hifi.cjs        (builds the native binary first if needed)
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'),
  path = require('path'),
  readline = require('readline');

const ROOT = path.join(__dirname, '..'),
  C = path.join(__dirname, '.cache', 'hifi');
const BIN = path.join(ROOT, 'native', 'cadenza-audio', 'target', 'release', 'cadenza-audio');
fs.mkdirSync(C, { recursive: true });
if (!fs.existsSync(BIN))
  execFileSync('cargo', ['build', '--release'], { cwd: path.join(ROOT, 'native', 'cadenza-audio'), stdio: 'inherit' });

const ff = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const F = {
  hr: path.join(C, 'sine-96k-24.flac'), // 1 kHz, 24-bit 96 kHz, 6 s
  cd: path.join(C, 'sine-44k-16.flac'), // 440 Hz, 16-bit 44.1 kHz, 6 s
  mp3: path.join(C, 'sine-44k.mp3'),
};
if (!fs.existsSync(F.hr))
  ff(
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:sample_rate=96000:duration=6',
    '-ac',
    '2',
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    '-bits_per_raw_sample',
    '24',
    F.hr,
  );
if (!fs.existsSync(F.cd))
  ff(
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=6',
    '-ac',
    '2',
    '-c:a',
    'flac',
    '-sample_fmt',
    's16',
    F.cd,
  );
if (!fs.existsSync(F.mp3))
  ff(
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=6',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '256k',
    F.mp3,
  );
const ref = (file) => {
  const b = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 's32le', '-ac', '2', '-'], {
    maxBuffer: 1 << 28,
  });
  return new Int32Array(b.buffer, b.byteOffset, b.length >> 2);
};

let fails = 0;
const ok = (c, m) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m);
  if (!c) fails++;
};
const AMP = 0.0884; // ffmpeg's sine source peaks at 1/8 of full scale over √2
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(fake, tag) {
  for (const f of fs.readdirSync(C)) if (f.startsWith(tag + '-')) fs.unlinkSync(path.join(C, f));
  const p = spawn(BIN, [], { env: { ...process.env, CADENZA_AUDIO_FAKE: `${fake};dump=${path.join(C, tag)}` } });
  const evs = [],
    waiters = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => {
    let e;
    try {
      e = JSON.parse(l);
    } catch (x) {
      return;
    }
    e.at = Date.now();
    evs.push(e);
    for (const w of waiters.slice())
      if (w.f(e)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.r(e);
      }
  });
  p.stderr.on('data', (d) => process.stderr.write(d));
  const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  const wait = (f, ms = 5000) => {
    const e = evs.find(f);
    if (e) return Promise.resolve(e);
    return new Promise((r, j) => {
      const w = { f, r };
      waiters.push(w);
      setTimeout(() => {
        if (waiters.includes(w)) {
          waiters.splice(waiters.indexOf(w), 1);
          j(new Error('timeout'));
        }
      }, ms);
    });
  };
  const done = async () => {
    send({ cmd: 'quit' });
    await new Promise((r) => p.on('exit', r));
  };
  const dumps = () =>
    fs
      .readdirSync(C)
      .filter((f) => f.startsWith(tag + '-'))
      .sort((a, b) => parseInt(a.split('-')[1]) - parseInt(b.split('-')[1]));
  return { p, evs, send, wait, done, dumps };
}
const i32 = (file) => {
  const b = fs.readFileSync(path.join(C, file));
  return new Int32Array(b.buffer, b.byteOffset, b.length >> 2);
};
const i16 = (file) => {
  const b = fs.readFileSync(path.join(C, file));
  return new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
};
const firstNonZero = (a) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== 0) return i;
  return -1;
};
// the largest step between neighbouring samples of one channel, as a share of full scale
function maxStep(a, full, from = 0, to = a.length) {
  let m = 0;
  for (let i = from + 2; i < to; i += 2) {
    const d = Math.abs(a[i] - a[i - 2]) / full;
    if (d > m) m = d;
  }
  return m;
}

(async () => {
  /* 1. bit-perfect, at the file's own rate */
  console.log('bit-perfect at the source rate');
  {
    const A = start('rates=44100,48000,88200,96000,176400,192000;fmts=i24in32,i16', 'bp');
    A.send({ cmd: 'config', mode: 'exclusive' });
    const t0 = Date.now();
    A.send({ cmd: 'load', id: 'hr', path: F.hr, seq: 1 });
    const r = await A.wait((e) => e.ev === 'ready' && e.id === 'hr');
    ok(
      r.out.rate === 96000 && r.out.fmt === 'i24in32' && r.out.bitperfect && !r.out.resample,
      `24/96 FLAC → device 96 kHz, 24 bit, bit-perfect (ready in ${Date.now() - t0} ms)`,
    );
    A.send({ cmd: 'play', pos: 0 });
    const p0 = await A.wait((e) => e.ev === 'pos' && e.run);
    const tp = Date.now();
    await sleep(1500);
    const p1 = A.evs.filter((e) => e.ev === 'pos' && e.run).pop();
    const rate = (p1.t - p0.t) / ((p1.at - p0.at) / 1000);
    ok(Math.abs(rate - 1) < 0.04, `the clock runs in real time (${rate.toFixed(3)}×)`);
    A.send({ cmd: 'pause' });
    await sleep(300);
    const after = A.evs.filter((e) => e.ev === 'pos').slice(-3);
    ok(after.every((e) => !e.run) && Math.abs(after[2].t - after[0].t) < 1e-9, 'pause: the clock stops');
    await A.done();
    const d = A.dumps();
    ok(d.length === 1 && /-96000-i24in32-ex/.test(d[0]), `one device opening: ${d[0]}`);
    const out = i32(d[0]),
      src = ref(F.hr),
      lead = firstNonZero(out);
    ok(
      lead >= 0.3 * 96000 * 2 - 2,
      `${((lead / 2 / 96000) * 1000).toFixed(0)} ms of silence for the DAC to lock before the music`,
    );
    // the source starts with a zero sample; align on the first non-zero sample of both
    const s0 = firstNonZero(src),
      o0 = lead,
      n = 96000 * 2; // one second, untouched by the pause fade
    let same = 0;
    for (let i = 0; i < n; i++) if (out[o0 + i] === src[s0 + i]) same++;
    ok(same === n, `first second identical to the file, sample for sample (${same}/${n})`);
    const fadeAt = o0 + Math.floor(after[0].t * 96000) * 2;
    const nat = maxStep(src, 2 ** 31, s0, s0 + n),
      st = maxStep(out, 2 ** 31, o0 + n, out.length);
    ok(st <= nat * 1.15, `pause fades out: largest step ${st.toFixed(5)} vs the tone's own ${nat.toFixed(5)}`);
    ok(fadeAt > 0, 'paused mid-tone');
  }

  /* 2. the DAC lacks the rate: resample to the nearest in the family, then switch rate for the next song */
  console.log('adaptive rate');
  {
    const A = start('rates=48000,96000;fmts=i16', 'ad');
    A.send({ cmd: 'config', mode: 'exclusive' });
    A.send({ cmd: 'load', id: 'cd', path: F.cd, seq: 1 });
    const r = await A.wait((e) => e.ev === 'ready' && e.id === 'cd');
    ok(
      r.out.rate === 48000 && r.out.resample && !r.out.bitperfect,
      `44.1 kHz on a 48 kHz-family DAC → resampled to ${r.out.rate}`,
    );
    A.send({ cmd: 'play', pos: 0 });
    await sleep(800);
    A.send({ cmd: 'load', id: 'hr', path: F.hr, seq: 2 });
    const r2 = await A.wait((e) => e.ev === 'ready' && e.id === 'hr');
    ok(r2.out.rate === 96000 && !r2.out.resample, 'next song at 96 kHz: the device follows');
    A.send({ cmd: 'play', pos: 0 });
    await A.wait((e) => e.ev === 'pos' && e.id === 'hr' && e.run);
    await sleep(500);
    await A.done();
    const d = A.dumps();
    ok(
      d.length === 2 && /-48000-i16/.test(d[0]) && /-96000-i16/.test(d[1]),
      `device reopened at the new rate: ${d.join(', ')}`,
    );
    const a = i16(d[0]),
      b = i16(d[1]);
    // the 440 Hz tone, resampled: still a clean tone (no step bigger than the tone allows)
    const nat = ((2 * Math.PI * 440) / 48000) * AMP;
    ok(
      maxStep(a, 32768) <= nat * 1.25,
      `resampled tone and the fade at the song change are smooth (${maxStep(a, 32768).toFixed(5)} ≤ ${(nat * 1.25).toFixed(5)})`,
    );
    ok(firstNonZero(b) >= 0.3 * 96000 * 2 - 2, 'new rate: silence for the DAC to lock first');
    // the 24-bit file on a 16-bit DAC: dithered, never clipped
    let peak = 0;
    for (const x of b) peak = Math.max(peak, Math.abs(x));
    ok(
      Math.abs(peak / 32768 - AMP) < 0.003,
      `24-bit source on a 16-bit DAC: level kept (${(peak / 32768).toFixed(3)})`,
    );
  }

  /* 3. preloading: the next song is ready the moment it is asked for */
  console.log('preload, seek, gain');
  {
    const A = start('rates=44100,48000,96000;fmts=i32', 'pl');
    A.send({ cmd: 'config', mode: 'exclusive' });
    A.send({ cmd: 'load', id: 'cd', path: F.cd, seq: 1 });
    await A.wait((e) => e.ev === 'ready' && e.id === 'cd');
    A.send({ cmd: 'play', pos: 0 });
    await A.wait((e) => e.ev === 'pos' && e.run);
    A.send({ cmd: 'load', id: 'mp3', path: F.mp3, next: true });
    await A.wait((e) => e.ev === 'preloaded' && e.id === 'mp3');
    const t = Date.now();
    A.send({ cmd: 'load', id: 'mp3', path: F.mp3, seq: 2 });
    await A.wait((e) => e.ev === 'ready' && e.id === 'mp3');
    const dt = Date.now() - t;
    ok(dt < 60, `preloaded song ready in ${dt} ms`);
    A.send({ cmd: 'play', pos: 2.0 });
    const p = await A.wait((e) => e.ev === 'pos' && e.id === 'mp3' && e.run);
    ok(Math.abs(p.t - 2.0) < 0.06, `song change + seek: starts at ${p.t.toFixed(3)} s`);
    await sleep(400);
    A.send({ cmd: 'gain', g: 0.5 });
    await sleep(400);
    A.send({ cmd: 'play', pos: 4.5 });
    await sleep(300);
    await A.done();
    const d = A.dumps();
    ok(d.length === 1, 'same rate for both songs: the device stays open (no relock)');
    const o = i32(d[0]);
    ok(
      maxStep(o, 2 ** 31) <= ((2 * Math.PI * 440) / 44100) * AMP * 1.2,
      `song change, seek and gain change without clicks (${maxStep(o, 2 ** 31).toFixed(5)})`,
    );
    let pk = 0;
    for (let i = o.length - 44100; i < o.length; i++) pk = Math.max(pk, Math.abs(o[i]));
    ok(Math.abs(pk / 2 ** 31 - AMP / 2) < 0.002, `gain 0.5 holds across a seek (${(pk / 2 ** 31).toFixed(4)})`);
  }

  /* 4. exclusive mode refused: play through the mixer instead */
  console.log('fallback');
  {
    const A = start('busy=1;mix=48000', 'fb');
    A.send({ cmd: 'config', mode: 'exclusive' });
    A.send({ cmd: 'load', id: 'hr', path: F.hr, seq: 1 });
    const r = await A.wait((e) => e.ev === 'ready');
    ok(!r.out.exclusive && r.out.rate === 48000, 'exclusive unavailable: shared mode at the mixer rate');
    A.send({ cmd: 'play', pos: 0 });
    await A.wait((e) => e.ev === 'pos' && e.run);
    await sleep(300);
    await A.done();
    ok(/-48000-f32-sh/.test(A.dumps()[0] || ''), 'played through the mixer');
  }

  /* 5. the app goes away mid-song: stdin closes, the music fades and the device is released */
  console.log('shutdown');
  {
    const A = start('rates=96000;fmts=i32', 'sd');
    A.send({ cmd: 'config', mode: 'exclusive' });
    A.send({ cmd: 'load', id: 'hr', path: F.hr, seq: 1 });
    await A.wait((e) => e.ev === 'ready');
    A.send({ cmd: 'play', pos: 0 });
    await A.wait((e) => e.ev === 'pos' && e.run);
    await sleep(500);
    A.p.stdin.end();
    const code = await new Promise((r) => A.p.on('exit', r));
    const o = i32(A.dumps()[0]);
    let tail = 0;
    for (let i = o.length - 200; i < o.length; i++) tail = Math.max(tail, Math.abs(o[i]));
    ok(code === 0 && tail === 0, 'exits cleanly, ending on silence');
    ok(maxStep(o, 2 ** 31) <= ((2 * Math.PI * 1000) / 96000) * AMP * 1.15, 'faded out, no click');
  }
  /* 6. the volume balance with a fixed volume: the device's own hardware volume, never the samples */
  console.log('volume balance in the hardware volume');
  {
    const A = start('rates=96000;fmts=i24in32;hwvol=-20', 'hw');
    A.send({ cmd: 'config', mode: 'exclusive' });
    A.send({ cmd: 'load', id: 'hr', path: F.hr, seq: 1 });
    await A.wait((e) => e.ev === 'ready');
    A.send({ cmd: 'hwgain', db: -6 });
    const h = await A.wait((e) => e.ev === 'hwvol');
    ok(
      h.supported && h.db === -6 && h.level === -26,
      `a song 6 dB too loud: the device from the user's -20 to ${h.level} dB`,
    );
    A.send({ cmd: 'play', pos: 0 });
    await A.wait((e) => e.ev === 'pos' && e.run);
    await sleep(1400);
    A.send({ cmd: 'hwgain', db: 2 });
    const h2 = await A.wait((e) => e.ev === 'hwvol' && e.db === 2);
    ok(h2.level === -18, `the next song asks for +2: ${h2.level} dB, measured from the user's own level`);
    A.send({ cmd: 'release' });
    const h3 = await A.wait((e) => e.ev === 'hwvol' && e.db === 0);
    ok(h3.level === -20, `released: the device back at the user's level (${h3.level} dB)`);
    await A.done();
    const o = i32(A.dumps()[0]),
      src = ref(F.hr),
      o0 = firstNonZero(o),
      s0 = firstNonZero(src),
      n = 96000 * 2;
    let same = 0;
    for (let i = 0; i < n; i++) if (o[o0 + i] === src[s0 + i]) same++;
    ok(same === n, `while it applies, the samples reach the DAC untouched: bit-perfect (${same}/${n})`);
    const B = start('rates=96000;fmts=i24in32', 'nohw');
    B.send({ cmd: 'config', mode: 'exclusive' });
    B.send({ cmd: 'hwgain', db: -6 });
    const nh = await B.wait((e) => e.ev === 'hwvol');
    ok(nh.supported === false, 'a device without a hardware volume: nothing is touched (and the page is told)');
    await B.done();
  }
  /* 7. the chosen device is not there (unplugged): the system's default plays in its place, nothing to choose again */
  console.log('a chosen device that is gone');
  {
    const A = start('rates=44100,96000;fmts=i24in32', 'gone');
    A.send({ cmd: 'config', device: 'usb-dac-unplugged', mode: 'exclusive' });
    A.send({ cmd: 'load', id: 'cd', path: F.cd, seq: 1 });
    await A.wait((e) => e.ev === 'ready');
    const fb = await A.wait((e) => e.ev === 'fallback' && e.code === 'default').catch(() => null);
    A.send({ cmd: 'play', pos: 0 });
    const run = await A.wait((e) => e.ev === 'pos' && e.run && e.t > 0.3, 4000).catch(() => null);
    const err = A.evs.find((e) => e.ev === 'error' && e.code === 'device');
    ok(!!fb && !!run && !err, 'the default device plays in its place, said once, no error, nothing to choose again');
    await A.done();
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
