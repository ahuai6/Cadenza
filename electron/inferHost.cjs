// The main process's side of the native inference (infer.cjs): where the models are (downloaded on request into the
// profile, each checked against its SHA-256 before it is kept), the utility process that runs them (started on the first
// request, let go after two idle minutes), and the page's requests passed to it one at a time. The page never sees a path.
const { app, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');

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
const present = () =>
  MODELS.every((m) => {
    try {
      return fs.statSync(path.join(dir(), m.name + '.onnx')).size === m.size;
    } catch {
      return false;
    }
  });
/** Can the native runtime load here at all (its binding for this platform). */
function runtime() {
  try {
    const root = path.dirname(require.resolve('onnxruntime-node/package.json'));
    return fs.existsSync(path.join(root, 'bin', 'napi-v6', process.platform, process.arch, 'onnxruntime_binding.node'));
  } catch {
    return false;
  }
}

function get(url, onRes, hops = 0) {
  https
    .get(url, { headers: { 'user-agent': 'Cadenza' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 8) {
        res.resume();
        get(new URL(res.headers.location, url).href, onRes, hops + 1);
        return;
      }
      onRes(res);
    })
    .on('error', (e) => onRes(null, e));
}
function download(m, progress) {
  return new Promise((resolve, reject) => {
    const to = path.join(dir(), m.name + '.onnx'),
      part = to + '.part';
    fs.mkdirSync(dir(), { recursive: true });
    get(m.url, (res, err) => {
      if (err || !res || res.statusCode !== 200) {
        res?.resume();
        reject(err || new Error(`download failed (${res && res.statusCode})`));
        return;
      }
      const out = fs.createWriteStream(part),
        h = crypto.createHash('sha256');
      let got = 0;
      res.on('data', (b) => {
        h.update(b);
        got += b.length;
        progress(got / m.size);
      });
      res.pipe(out);
      out.on('error', reject);
      out.on('finish', () => {
        if (h.digest('hex') !== m.sha256 || got !== m.size) {
          fs.rmSync(part, { force: true });
          reject(new Error('download corrupted (hash mismatch)'));
          return;
        }
        fs.renameSync(part, to);
        resolve();
      });
    });
  });
}

function start(ipcMain, getWin, settings) {
  let proc = null,
    ready = null,
    ep = null,
    idle = null,
    next = 1,
    downloading = null;
  const pending = new Map();
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
      proc.on('exit', () => drop('the inference process ended'));
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
      return await call(op, args);
    } catch (e) {
      ready = null;
      throw e;
    } finally {
      arm();
    }
  }
  ipcMain.handle('infer:status', () => ({
    runtime: runtime(),
    models: present(),
    ep,
    downloading: !!downloading,
    size: MODELS.reduce((a, m) => a + m.size, 0),
  }));
  ipcMain.handle('infer:download', async () => {
    if (present()) return { ok: true };
    downloading ??= (async () => {
      const total = MODELS.reduce((a, m) => a + m.size, 0);
      let done = 0;
      for (const m of MODELS) {
        const f = path.join(dir(), m.name + '.onnx');
        if (fs.existsSync(f) && fs.statSync(f).size === m.size) {
          done += m.size;
          continue;
        }
        await download(m, (k) => send('infer:progress', (done + k * m.size) / total));
        done += m.size;
      }
    })().finally(() => {
      downloading = null;
    });
    try {
      await downloading;
      return { ok: true };
    } catch (e) {
      return { ok: false, why: String(e.message || e) };
    }
  });
  ipcMain.handle('infer:run', (_e, op, args) => {
    if (op !== 'beat' && op !== 'separate') throw new Error('unknown op');
    if (!present()) throw new Error('models missing');
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
    },
  };
}
module.exports = { start, MODELS };
