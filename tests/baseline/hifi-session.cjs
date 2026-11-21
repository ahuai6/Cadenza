// Same-machine comparison of the native release transaction and idle cost. No real endpoint is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const readline = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');

const [before, after] = process.argv.slice(2);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g4-session-'));
const tone = path.join(scratch, '8s.wav');
const rate = 48000;
const pcm = Buffer.alloc(44 + rate * 4 * 8);
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
  const amplitude = Math.round(7000 * Math.sin((2 * Math.PI * 375 * ((off - 44) / 4)) / rate));
  pcm.writeInt16LE(amplitude, off);
  pcm.writeInt16LE(amplitude, off + 2);
}
fs.writeFileSync(tone, pcm);

function metrics(pid) {
  return JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-Process -Id ${Number(pid)} | Select-Object CPU,Handles,PrivateMemorySize64 | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8', windowsHide: true },
    ),
  );
}
function percentile(values, p) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
}
async function measure(binary) {
  const child = spawn(path.resolve(binary), [], {
    env: { ...process.env, CADENZA_AUDIO_FAKE: 'rates=48000;fmts=i16' },
    windowsHide: true,
  });
  const exited = once(child, 'close');
  const events = [];
  readline
    .createInterface({ input: child.stdout })
    .on('line', (l) => events.push({ ...JSON.parse(l), at: performance.now() }));
  child.stdin.on('error', () => {});
  const send = (v) => child.stdin.write(JSON.stringify(v) + '\n');
  const wait = async (f) => {
    for (let n = 0; n < 1500; n++) {
      const e = events.find(f);
      if (e) return e;
      if (child.exitCode !== null) break;
      await delay(5);
    }
    throw new Error(JSON.stringify(events.slice(-8)));
  };
  try {
    await wait((e) => e.ev === 'hello');
    send({ cmd: 'config', mode: 'exclusive', release_after: 60 });
    const rows = [];
    for (let seq = 1; seq <= 16; seq++) {
      send({ cmd: 'load', id: 'tone', seq, path: tone });
      await wait((e) => e.ev === 'ready' && e.seq === seq);
      const start = performance.now();
      send({ cmd: 'play', pos: 0, seq, run: seq });
      const run = await wait((e) => e.ev === 'pos' && e.run && e.seq === seq);
      const at = performance.now();
      send({ cmd: 'release' });
      send({ cmd: 'barrier', ticket: seq });
      rows.push({
        firstRunningMs: run.at - start,
        releaseAckMs: (await wait((e) => e.ev === 'barrier' && e.ticket === seq)).at - at,
      });
    }
    send({ cmd: 'load', id: 'tone', seq: 17, path: tone });
    await wait((e) => e.ev === 'ready' && e.seq === 17);
    send({ cmd: 'play', pos: 0, seq: 17, run: 17 });
    await wait((e) => e.ev === 'pos' && e.run && e.seq === 17);
    send({ cmd: 'pause', seq: 17 });
    await wait((e) => e.ev === 'pos' && !e.run && e.seq === 17 && e.t > 0);
    const begin = metrics(child.pid);
    const previous = events.length;
    await delay(10_000);
    const idle = {
      begin,
      end: metrics(child.pid),
      positionMessages: events.slice(previous).filter((e) => e.ev === 'pos').length,
    };
    const summary = Object.fromEntries(
      ['firstRunningMs', 'releaseAckMs'].map((key) => {
        const values = rows.map((r) => r[key]);
        return [key, { p50: percentile(values, 0.5), p95: percentile(values, 0.95) }];
      }),
    );
    return { rows, summary, idle };
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 4000);
    const [code] = await exited;
    clearTimeout(timer);
    assert.equal(code, 0);
  }
}

if (process.platform !== 'win32' || !before || !after) throw new Error('Pass two Windows native executable paths');
(async () => {
  const report = { before: await measure(before), after: await measure(after) };
  fs.writeFileSync(path.join(scratch, 'comparison.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      before: report.before.summary,
      after: report.after.summary,
      idleBefore: report.before.idle,
      idleAfter: report.after.idle,
    }),
  );
  console.log('Native session evidence:', scratch);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
