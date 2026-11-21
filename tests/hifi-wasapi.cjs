// Opt-in Windows endpoint smoke. Uses quiet synthetic PCM and leaves system settings alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const readline = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');

const bin =
  process.env.CADENZA_NATIVE_TEST_BIN ||
  path.resolve(__dirname, '../native/cadenza-audio/target/release/cadenza-audio.exe');
async function check(mode) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-wasapi-'));
  const file = path.join(scratch, 'tone.wav');
  const rate = mode === 'exclusive' ? 44100 : 48000;
  const pcm = Buffer.alloc(44 + rate * 4 * 4);
  pcm.write('RIFF');
  pcm.writeUInt32LE(pcm.length - 8, 4);
  pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 4, 28);
  pcm.writeUInt16LE(4, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(pcm.length - 44, 40);
  for (let off = 44; off < pcm.length; off += 4) {
    const n = (off - 44) / 4;
    const amplitude = Math.round(250 * Math.sin((2 * Math.PI * 375 * n) / rate));
    pcm.writeInt16LE(amplitude, off);
    pcm.writeInt16LE(amplitude, off + 2);
  }
  fs.writeFileSync(file, pcm);
  const env = { ...process.env };
  delete env.CADENZA_AUDIO_FAKE;
  const child = spawn(bin, [], { env, windowsHide: true });
  const closed = once(child, 'close');
  const events = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => events.push(JSON.parse(line)));
  child.stdin.on('error', () => {});
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  const wait = async (f) => {
    for (let n = 0; n < 500; n++) {
      const e = events.find(f);
      if (e) return e;
      if (child.exitCode !== null) break;
      await delay(20);
    }
    throw new Error(JSON.stringify(events.slice(-8)));
  };
  try {
    send({ cmd: 'config', mode, ticket: 1 });
    assert.equal((await wait((e) => e.ev === 'configured')).ok, true);
    send({ cmd: 'load', seq: 1, id: 'tone', path: file });
    await wait((e) => e.ev === 'ready');
    send({ cmd: 'play', seq: 1, run: 1, pos: 0 });
    const initialDevice = await wait((e) => e.ev === 'device' && e.open);
    const running = await wait((e) => e.ev === 'pos' && e.run);
    const device = events.find((e) => e.ev === 'device' && e.open && e.epoch === running.epoch);
    assert.ok(device);
    if (mode === 'exclusive' && !device.exclusive) {
      assert.ok(events.some((e) => e.ev === 'fallback' && e.code === 'shared'));
    }
    send({ cmd: 'pause', seq: 1 });
    const paused = await wait((e) => e.ev === 'pos' && e.epoch === running.epoch && !e.run && e.t > 0);
    await delay(120);
    send({ cmd: 'play', seq: 1, run: 2, pos: 2, end: 2.65 });
    const seek = await wait((e) => e.ev === 'pos' && e.run && e.runId === 2);
    assert.ok(seek.t >= 2 && seek.t < 2.1);
    const eof = await wait((e) => e.ev === 'ended' && e.runId === 2);
    assert.equal(eof.t, 2.65);
    send({ cmd: 'release' });
    await wait((e) => e.ev === 'device' && e.epoch === eof.epoch && !e.open);
    const observations = events.filter((e) => e.ev === 'pos' && e.run);
    const sources = Object.fromEntries(
      [...new Set(observations.map((e) => e.source))].map((s) => [
        s,
        observations.filter((e) => e.source === s).length,
      ]),
    );
    const endpoint = events.find((e) => e.ev === 'endpoint-clock');
    console.log(
      JSON.stringify({
        device,
        initialDevice: initialDevice === device ? undefined : initialDevice,
        sources,
        clockSources: events.filter((e) => e.ev === 'clock-source'),
        endpoint,
        paused: paused.t,
        seek: seek.t,
        eof: eof.t,
        fallback: events.filter((e) => e.ev === 'fallback'),
      }),
    );
    fs.writeFileSync(path.join(scratch, 'events.json'), JSON.stringify(events, null, 2));
    console.log('Windows evidence:', scratch);
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5000);
    const [exit] = await closed;
    clearTimeout(timer);
    assert.equal(exit, 0);
  }
}

if (process.platform !== 'win32' || !process.argv.includes('--real'))
  throw new Error('Use --real for the Windows endpoint smoke');
(async () => {
  await check('shared');
  await check('exclusive');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
