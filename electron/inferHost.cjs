// The main process's side of the native inference (infer.cjs): where the models are (downloaded on request into the
// profile, each checked against its SHA-256 before it is kept), the utility process that runs them (started on the first
// request, let go after two idle minutes), and the page's requests passed to it one at a time. The page never sees a path.
const { app, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

/** The models, each pinned to a revision of its repository and checked against its hash. */
const MODELS = [
  {
    name: 'beat_this',
    size: 190649026,
    sha256: '1337dc6c21257ed6b803418efc320df42b5d8eb296ef16648ef60457cd4b9e55',
    url: 'https://huggingface.co/musetric/beat-this-onnx/resolve/25308706dda545c0d5950065bb0604ad71bcf1f5/beat_this.onnx',
  },
  {
    name: 'htdemucs',
    size: 165612636,
    sha256: 'd05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a',
    url: 'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx',
  },
];
const IDLE_MS = 120_000;
const dir = () => process.env.CADENZA_NATIVE_MODELS || path.join(app.getPath('userData'), 'models', 'native');
function presentModel(m) {
  try {
    return fs.statSync(path.join(dir(), m.name + '.onnx')).size === m.size;
  } catch {
    return false;
  }
}
const present = () => MODELS.every(presentModel);
/** Can the native runtime load here at all (its binding for this platform). */
function runtime() {
  try {
    const root = path.dirname(require.resolve('onnxruntime-node/package.json'));
    return fs.existsSync(path.join(root, 'bin', 'napi-v6', process.platform, process.arch, 'onnxruntime_binding.node'));
  } catch {
    return false;
  }
}

async function get(url, signal, hops = 0) {
  const res = await new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'Cadenza' }, signal }, resolve);
    req.setTimeout(30_000, () => req.destroy(new Error('model download stalled')));
    req.on('error', reject);
  });
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 8) {
    res.resume();
    return get(new URL(res.headers.location, url).href, signal, hops + 1);
  }
  return res;
}
async function download(m, progress, signal) {
  const to = path.join(dir(), m.name + '.onnx');
  const part = to + '.part';
  await fs.promises.mkdir(dir(), { recursive: true });
  try {
    const res = await get(m.url, signal);
    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`download failed (${res.statusCode})`);
    }
    const h = crypto.createHash('sha256');
    let got = 0;
    const check = new Transform({
      transform(bytes, _encoding, done) {
        got += bytes.length;
        if (got > m.size) return done(new Error('model exceeds the expected size'));
        h.update(bytes);
        progress(got / m.size);
        done(null, bytes);
      },
    });
    await pipeline(res, check, fs.createWriteStream(part), { signal });
    if (got !== m.size || h.digest('hex') !== m.sha256) throw new Error('download corrupted (hash mismatch)');
    signal.throwIfAborted();
    await fs.promises.rename(part, to);
  } finally {
    await fs.promises.rm(part, { force: true }).catch(() => {});
  }
}

function start(ipcMain, getWin, settings) {
  let proc = null,
    ready = null,
    ep = null,
    idle = null,
    next = 1,
    downloading = null,
    downloadAbort = null;
  const pending = new Map();
  const errors = { beat: null, separate: null };
  const send = (ch, d) => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send(ch, d);
  };
  const drop = (why) => {
    for (const p of pending.values()) p.rej(new Error(why));
    pending.clear();
    proc = null;
    ready = null;
  };
  function call(op, args) {
    if (!proc) {
      proc = utilityProcess.fork(path.join(__dirname, 'infer.cjs'), [], { serviceName: 'Cadenza inference' });
      proc.on('message', (m) => {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        m.error != null ? p.rej(new Error(m.error)) : p.res(m.result);
      });
      const instance = proc;
      instance.on('exit', () => {
        if (proc === instance) drop('the inference process ended');
      });
    }
    const id = next++;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      proc.postMessage({ id, op, args });
    });
  }
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (!pending.size && proc) {
        proc.kill();
        drop('idle');
      }
    }, IDLE_MS);
  };
  async function run(op, args) {
    clearTimeout(idle);
    try {
      ready ??= call('init', { modelsDir: dir(), prefer: settings.rhythmDevice === 'cpu' ? 'cpu' : 'auto' }).then(
        (r) => {
          ep = r.ep;
          return r;
        },
      );
      await ready;
      const result = await call(op, args);
      errors[op] = null;
      return result;
    } catch (e) {
      ready = null;
      errors[op] = String(e.message || e).slice(0, 240);
      throw e;
    } finally {
      arm();
    }
  }
  ipcMain.handle('infer:status', () => {
    const [beats, stems] = MODELS.map(presentModel);
    return {
      runtime: runtime(),
      models: beats && stems,
      beats,
      stems,
      ep,
      errors: { ...errors },
      downloading: !!downloading,
      size: MODELS.reduce((a, m) => a + m.size, 0),
    };
  });
  ipcMain.handle('infer:download', async (_event, repair) => {
    const replace = repair === true ? { ...errors } : {};
    if (present() && !replace.beat && !replace.separate) return { ok: true };
    if (!downloading) downloadAbort = new AbortController();
    downloading ??= (async () => {
      const { signal } = downloadAbort;
      const total = MODELS.reduce((a, m) => a + m.size, 0);
      let done = 0;
      for (const m of MODELS) {
        const op = m.name === 'beat_this' ? 'beat' : 'separate';
        if (!replace[op] && presentModel(m)) {
          done += m.size;
          continue;
        }
        await download(m, (k) => send('infer:progress', (done + k * m.size) / total), signal);
        errors[op] = null;
        done += m.size;
      }
    })().finally(() => {
      downloading = null;
      downloadAbort = null;
    });
    try {
      await downloading;
      return { ok: true };
    } catch (e) {
      return { ok: false, why: String(e.message || e) };
    }
  });
  ipcMain.handle('infer:cancel-download', () => downloadAbort?.abort());
  ipcMain.handle('infer:run', (_e, op, args) => {
    if (op !== 'beat' && op !== 'separate') throw new Error('unknown op');
    if (!presentModel(MODELS[op === 'beat' ? 0 : 1])) throw new Error('model missing');
    return run(op, args);
  });
  // (a new choice of device: the process starts again on it at the next request)
  return {
    restart() {
      if (proc) {
        proc.kill();
        drop('restarted');
      }
      ep = null;
      errors.beat = errors.separate = null;
      // (a network the GPU could not run is tried on it again: the device chosen may be another)
      try {
        for (const f of fs.readdirSync(path.join(dir(), 'cache')))
          if (f.endsWith('.unusable')) fs.rmSync(path.join(dir(), 'cache', f), { force: true });
      } catch {
        /* no cache yet */
      }
    },
  };
}
module.exports = { start, MODELS };
