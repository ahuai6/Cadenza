// Isolated tests against the actual native executable and its simulated endpoints.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g4-native-'));
const bin =
  process.env.CADENZA_NATIVE_TEST_BIN ||
  path.resolve(
    __dirname,
    '../native/cadenza-audio/target/release/',
    process.platform === 'win32' ? 'cadenza-audio.exe' : 'cadenza-audio',
  );
const rate = 48_000;

function wav(name, bits, channels = 2, seconds = 5) {
  const width = bits / 8;
  const bytes = rate * seconds * width * channels;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF');
  b.writeUInt32LE(bytes + 36, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * width * channels, 28);
  b.writeUInt16LE(width * channels, 32);
  b.writeUInt16LE(bits, 34);
  b.write('data', 36);
  b.writeUInt32LE(bytes, 40);
  const edge = [2 ** (bits - 1) - 1, -(2 ** (bits - 1)), 1, -1, 0];
  for (let i = 0; i < bytes / width; i++) {
    const sample = i < edge.length ? edge[i] : Math.round(2 ** (bits - 2) * Math.sin(i * 0.031));
    b.writeIntLE(sample, 44 + i * width, width);
  }
  const file = path.join(root, name + '.wav');
  fs.writeFileSync(file, b);
  return { file, data: b.subarray(44), width };
}

const fixture = wav('clock', 24);

async function simulated(name, config, body) {
  const prefix = path.join(root, name);
  const p = spawn(bin, [], {
    windowsHide: true,
    env: { ...process.env, CADENZA_AUDIO_FAKE: `${config};dump=${prefix}` },
  });
  const exited = once(p, 'close');
  const events = [];
  const line = readline.createInterface({ input: p.stdout });
  line.on('line', (s) => events.push({ ...JSON.parse(s), arrived: performance.now() }));
  p.stdin.on('error', () => {});
  const send = (command) => p.stdin.write(JSON.stringify(command) + '\n');
  async function until(accept, timeout = 5000) {
    const start = performance.now();
    while (performance.now() - start < timeout && p.exitCode === null) {
      const e = events.find(accept);
      if (e) return e;
      await delay(5);
    }
    throw new Error(`Missing ${name} event, recent: ${JSON.stringify(events.slice(-7))}`);
  }
  const load = async (file = fixture.file) => {
    send({ cmd: 'load', id: 'one', path: file, seq: 1 });
    return until((e) => e.ev === 'ready');
  };
  try {
    await until((e) => e.ev === 'hello' && e.clockProtocol === 1);
    await body({
      send,
      until,
      load,
      events,
      dumps: () =>
        fs
          .readdirSync(root)
          .filter((f) => f.startsWith(name + '-'))
          .map((f) => path.join(root, f))
          .sort(),
    });
  } finally {
    p.stdin.end();
    const kill = setTimeout(() => p.kill(), 4000);
    const [code] = await exited;
    clearTimeout(kill);
    assert.equal(code, 0);
  }
}

test('reconfiguration acknowledges release before the replacement mode can start', async () => {
  await simulated('reconfigure', 'rates=48000;fmts=i16', async ({ send, until, load, events }) => {
    await load();
    send({ cmd: 'play', pos: 0, seq: 1, run: 1 });
    await until((e) => e.ev === 'pos' && e.run && e.epoch === 1);
    send({ cmd: 'config', mode: 'shared', ticket: 21 });
    const configured = await until((e) => e.ev === 'configured' && e.ticket === 21);
    assert.equal(configured.ok, true);
    const closed = events.find((e) => e.ev === 'device' && !e.open && e.epoch === 1);
    assert.ok(closed && closed.arrived <= configured.arrived);

    send({ cmd: 'play', pos: 0, seq: 1, run: 2 });
    send({ cmd: 'load', id: 'second', path: fixture.file, seq: 2 });
    await until((e) => e.ev === 'ready' && e.seq === 2);
    send({ cmd: 'play', pos: 2, end: 2.25, seq: 2, run: 3 });
    const running = await until((e) => e.ev === 'pos' && e.run && e.epoch === 2);
    assert.equal(running.seq, 2);
    assert.equal(running.runId, 3);
    assert.ok(running.t >= 2 && running.t < 2.05);
    assert.equal(events.find((e) => e.ev === 'device' && e.epoch === 2).exclusive, false);
    await until((e) => e.ev === 'ended' && e.runId === 3);
    assert.ok(!events.some((e) => e.ev === 'pos' && e.run && e.runId === 2));
  });
});

test('a default-device change retires a healthy stream before following the new default', async () => {
  await simulated('default-change', 'switch-default-after=0.7', async ({ send, until, load, events }) => {
    await load();
    send({ cmd: 'play', pos: 0, end: 1.75, seq: 1, run: 1 });
    await until((e) => e.ev === 'pos' && e.run && e.epoch === 1);
    const lost = await until((e) => e.ev === 'lost' && e.kind === 'default-changed');
    const next = await until((e) => e.ev === 'device' && e.open && e.epoch === 2);
    assert.equal(next.endpoint, 'fake-spare');
    assert.ok(events.some((e) => e.ev === 'device' && !e.open && e.epoch === 1 && e.arrived <= next.arrived));
    const resumed = await until((e) => e.ev === 'pos' && e.run && e.epoch === 2);
    assert.equal(resumed.runId, 1);
    assert.ok(resumed.t >= lost.t && resumed.t - lost.t < 0.055);
    assert.equal((await until((e) => e.ev === 'ended')).epoch, 2);
  });
});

test('a burst of superseded requests keeps the newest decoder request eligible', async () => {
  await simulated('burst', 'rates=48000;fmts=i16', async ({ send, until, events }) => {
    for (let seq = 1; seq <= 64; seq++) {
      send({ cmd: 'load', id: 'one', path: fixture.file, seq });
      if (seq < 64) send({ cmd: 'stop', seq });
    }
    await until((e) => e.ev === 'ready' && e.seq === 64);
    send({ cmd: 'play', pos: 0, end: 0.25, seq: 64, run: 1 });
    assert.equal((await until((e) => e.ev === 'pos' && e.run)).seq, 64);
    assert.equal((await until((e) => e.ev === 'ended')).seq, 64);
    assert.ok(!events.some((e) => e.ev === 'error' && e.seq === 64));
  });
});

test('a silent exclusive start releases the stalled client and resumes through shared mode', async () => {
  await simulated('no-consumption', 'stall-exclusive=1', async ({ send, until, load, events }) => {
    await load();
    send({ cmd: 'play', pos: 0.2, end: 0.7, seq: 1, run: 1 });
    const fault = await until((e) => e.ev === 'lost' && e.kind === 'clock-stalled');
    assert.equal(fault.t, 0.2);
    const shared = await until((e) => e.ev === 'device' && e.open && e.epoch === 2);
    assert.equal(shared.exclusive, false);
    assert.ok(events.some((e) => e.ev === 'fallback' && e.code === 'shared'));
    assert.ok(events.some((e) => e.ev === 'device' && !e.open && e.epoch === 1 && e.arrived <= shared.arrived));
    const start = await until((e) => e.ev === 'pos' && e.run);
    assert.equal(start.epoch, 2);
    assert.equal(start.runId, 1);
    assert.ok(start.t >= 0.2 && start.t < 0.25);
    assert.equal((await until((e) => e.ev === 'ended')).t, 0.7);
  });
});

const soakSeconds = Number(process.env.CADENZA_HIFI_SOAK_SECONDS || 0);
test('long simulated stream clock tracks frames at a non-wall-clock rate', { skip: !soakSeconds }, async () => {
  assert.ok(Number.isInteger(soakSeconds) && soakSeconds >= 10 && soakSeconds <= 120);
  const long = wav('soak-tone', 16, 2, soakSeconds + 2);
  await simulated('soak', 'rates=48000;fmts=i16;speed=1.02', async ({ send, until, load, events }) => {
    await load(long.file);
    send({ cmd: 'play', pos: 0, end: soakSeconds, seq: 1, run: 1 });
    const end = await until((e) => e.ev === 'ended', (soakSeconds + 7) * 1000);
    const samples = events.filter((e) => e.ev === 'pos' && e.run);
    const first = samples[0];
    const last = samples.at(-1);
    const errorFrames = Math.max(
      ...samples.map((sample) => Math.abs((sample.t - first.t) * rate - (sample.streamFrame - first.streamFrame))),
    );
    const effectiveRate = (last.t - first.t) / ((last.arrived - first.arrived) / 1000);
    assert.ok(errorFrames < 1, `mapping error ${errorFrames} frames`);
    assert.ok(effectiveRate > 1.01 && effectiveRate < 1.03, `stream moved at ${effectiveRate}×`);
    assert.equal(end.t, soakSeconds);
    assert.ok(samples.every((e) => e.source === 'simulated' && e.limit >= e.t));
    console.log('Soak', { count: samples.length, effectiveRate, errorFrames });
  });
});

test('device loss reopens at the consumed position with a new epoch and adapts to the new mix rate', async () => {
  await simulated(
    'recover',
    'lose-after=0.64;changed-mix=44100;fail-after-loss=1;return-after=3.2',
    async ({ send, until, load, events }) => {
      send({ cmd: 'config', device: 'fake-dac', mode: 'shared', ticket: 1 });
      assert.equal((await until((e) => e.ev === 'configured' && e.ticket === 1)).ok, true);
      await load();
      send({ cmd: 'play', pos: 0.1, end: 1.4, seq: 1, run: 10 });
      const old = await until((e) => e.ev === 'pos' && e.run && e.epoch === 1);
      assert.equal(old.source, 'simulated');
      const lost = await until((e) => e.ev === 'lost' && e.resume);
      assert.equal(lost.kind, 'device-invalidated');
      const reconfigured = await until((e) => e.ev === 'device' && e.open && e.epoch === 2);
      assert.equal(reconfigured.rate, 44_100);
      assert.equal(reconfigured.endpoint, 'fake-spare');
      assert.ok(events.some((e) => e.ev === 'device' && !e.open && e.epoch === 1 && e.arrived <= reconfigured.arrived));
      assert.ok(events.some((e) => e.ev === 'fallback' && e.code === 'default'));
      const recovered = await until((e) => e.ev === 'pos' && e.run && e.epoch === 2);
      assert.equal(recovered.runId, 10);
      assert.ok(Math.abs(recovered.t - lost.t) < 0.055, `lost ${lost.t}; resumed ${recovered.t}`);
      const eof = await until((e) => e.ev === 'ended');
      assert.equal(eof.runId, 10);
      assert.equal(eof.epoch, 2);
      assert.equal(eof.t, 1.4);
      await delay(1400);
      assert.equal(events.filter((e) => e.ev === 'ended').length, 1);
      assert.equal(events.filter((e) => e.ev === 'device' && e.open).length, 2);
      send({ cmd: 'release' });
      await until((e) => e.ev === 'device' && !e.open && e.epoch === 2);
      send({ cmd: 'load', id: 'returned', path: fixture.file, seq: 2 });
      await until((e) => e.ev === 'ready' && e.seq === 2);
      send({ cmd: 'play', pos: 0, end: 0.2, seq: 2, run: 11 });
      const preferred = await until((e) => e.ev === 'device' && e.open && e.epoch === 3);
      assert.equal(preferred.endpoint, 'fake-dac');
      assert.equal(preferred.rate, 48_000);
      assert.ok(events.some((e) => e.ev === 'fallback' && e.code === 'back'));
      console.log('Recovery ms', recovered.arrived - lost.arrived, 'position', lost.t, recovered.t);
    },
  );
});

test('a reset falls back to padding and keeps bounded position through an actual decode underrun', async () => {
  await simulated(
    'starve',
    'clock-reset=0.45;stall-decoder-ms=1400;speed=1.02',
    async ({ send, until, load, events }) => {
      await load();
      send({ cmd: 'play', pos: 0, end: 1.4, seq: 1, run: 2 });
      await until((e) => e.ev === 'pos' && e.run && e.source === 'simulated');
      await until((e) => e.ev === 'pos' && e.run && e.source === 'padding');
      const under = await until((e) => e.ev === 'underrun');
      const hold = await until((e) => e.ev === 'pos' && !e.run && e.t > 0.2 && e.arrived >= under.arrived);
      const resumed = await until((e) => e.ev === 'pos' && e.run && e.arrived > hold.arrived);
      assert.ok(resumed.t >= hold.t && resumed.t - hold.t < 0.08);
      await until((e) => e.ev === 'ended' && e.runId === 2);
      const positions = events.filter((e) => e.ev === 'pos' && e.runId === 2);
      positions.forEach((e, i) => {
        assert.ok(e.limit >= e.t && e.streamFrame <= e.submittedFrame);
        assert.ok(!i || e.t >= positions[i - 1].t);
      });
    },
  );
});

test('exclusive open refusal falls through to shared and unrepairable endpoints stop retrying', async () => {
  await simulated(
    'exclusive-fail',
    'exclusive-open-fails=1;lose-after=0.45;fail-after-loss=20',
    async ({ send, until, load, events }) => {
      await load();
      send({ cmd: 'play', pos: 0, seq: 1, run: 3 });
      await until((e) => e.ev === 'fallback' && e.code === 'shared');
      const open = await until((e) => e.ev === 'device' && e.open);
      assert.ok(open.requestedExclusive && !open.exclusive);
      await until((e) => e.ev === 'lost');
      const failed = await until((e) => e.ev === 'error' && e.code === 'device' && e.runId === 3);
      await delay(350);
      assert.equal(events.filter((e) => e.ev === 'error' && e.code === 'device').length, 1);
      assert.ok(!events.some((e) => e.ev === 'pos' && e.run && e.arrived > failed.arrived));
    },
  );
});

for (const [bits, format, width] of [
  [16, 'i24in32', 4],
  [24, 'i24', 3],
  [24, 'i24in32', 4],
  [32, 'i32', 4],
]) {
  test(`digital PCM ${bits}-bit to ${format} preserves signed boundaries and low bits`, async () => {
    const input = wav(`${bits}-${format}`, bits);
    await simulated(`pcm${bits}${format}`, `rates=${rate};fmts=${format}`, async ({ send, until, load, dumps }) => {
      const ready = await load(input.file);
      assert.equal(ready.out.bitperfect, true);
      send({ cmd: 'play', pos: 0, end: 0.05, seq: 1, run: 1 });
      const at = await until((e) => e.ev === 'pos' && e.run && e.exact);
      assert.equal(at.qpc100ns > 0, true);
      await until((e) => e.ev === 'ended');
      send({ cmd: 'release' });
      await until((e) => e.ev === 'device' && !e.open);
      const raw = fs.readFileSync(dumps()[0]);
      let i = 0;
      while (i + width <= raw.length && raw.readIntLE(i, width) === 0) i += width;
      for (let n = 0; n < (rate / 20) * 2; n++) {
        assert.equal(
          raw.readIntLE(i + n * width, width),
          input.data.readIntLE(n * input.width, input.width) * 2 ** (8 * width - bits),
        );
      }
    });
  });
}

test('mono duplication and software gain cannot claim bit-perfect PCM', async () => {
  const input = wav('mono', 24, 1);
  await simulated('mono-map', 'rates=48000;fmts=i24in32', async ({ send, until, load, dumps }) => {
    const ready = await load(input.file);
    assert.equal(ready.out.bitperfect, false);
    send({ cmd: 'gain', g: 0.5 });
    send({ cmd: 'play', pos: 0, end: 0.1, seq: 1, run: 1 });
    const p = await until((e) => e.ev === 'pos' && e.run);
    assert.equal(p.exact, false);
    await until((e) => e.ev === 'ended');
    const raw = fs.readFileSync(dumps()[0]);
    assert.ok(raw.length > 0);
    for (let i = 0; i < raw.length - 7; i += 8) {
      assert.ok(Math.abs(raw.readInt32LE(i) - raw.readInt32LE(i + 4)) <= 512);
    }
  });
});

console.log('Synthetic native fixtures:', root);
