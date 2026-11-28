// The Hi-Fi output: native/cadenza-audio, a separate process that reads the music file itself and plays it through
// WASAPI exclusive mode at the file's own rate and bit depth. This side starts it while the Hi-Fi output is on, passes the
// page's commands to it (resolving a track id to its file here, so the page never sees a path), relays its events, and
// brings it back if it ever exits unexpectedly. When the app quits, closing its stdin makes it fade out and let go.
const { app } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

function binPath() {
  const exe = process.platform === 'win32' ? 'cadenza-audio.exe' : 'cadenza-audio';
  if (app.isPackaged) return path.join(process.resourcesPath, exe);
  const root = path.join(__dirname, '..', 'native', 'cadenza-audio', 'target');
  const host = path.join(root, 'release', exe);
  const production = path.join(root, 'x86_64-pc-windows-gnu', 'release', exe);
  // build:native and the host-only test build use different target directories.
  // During development use the last build so an older binary cannot shadow it.
  if (process.platform !== 'win32') return host;
  const builtAt = (p) => fs.statSync(p, { throwIfNoEntry: false })?.mtimeMs || 0;
  return builtAt(production) > builtAt(host) ? production : host;
}
// Hi-Fi output needs WASAPI (Windows); elsewhere only the tests' simulated device
const supported = () => (process.platform === 'win32' || !!process.env.CADENZA_AUDIO_FAKE) && fs.existsSync(binPath());

function start(ipcMain, getWin, settings, library) {
  let proc = null,
    shutdown = null,
    want = false,
    restarts = 0,
    lastStart = 0,
    retryTimer = null,
    processEpoch = 0,
    configSerial = 0,
    configuration = null;
  const pendingLoads = { current: null, next: null };
  const state = { running: false, devices: [], caps: null, device: null, error: null };
  const send = (ev) => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('audio:ev', { ...ev, processEpoch });
  };
  const write = (o) => {
    if (!proc || shutdown || !proc.stdin.writable) return false;
    proc.stdin.write(JSON.stringify(o) + '\n');
    return true;
  };
  function config() {
    const device = settings.audioDevice || null;
    const mode = settings.audioMode === 'shared' ? 'shared' : 'exclusive';
    const key = JSON.stringify([device, mode]);
    if (configuration?.key === key) return;
    configuration?.settle(false);
    const ticket = ++configSerial;
    let resolve;
    const done = new Promise((r) => {
      resolve = r;
    });
    const timer = setTimeout(() => settle(false), 3500);
    function settle(ok) {
      clearTimeout(timer);
      resolve(ok);
      if (!ok && configuration?.ticket === ticket) configuration.key = null;
    }
    configuration = { key, ticket, done, settle };
    if (
      !write({
        cmd: 'config',
        device,
        mode,
        release_after: 20,
        ticket,
      })
    )
      settle(false);
  }

  function launch() {
    if (proc || !want || !supported()) return;
    lastStart = Date.now();
    const child = spawn(binPath(), [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    proc = child;
    processEpoch++;
    state.running = false;
    state.error = null;
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (proc !== child || shutdown) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch (e) {
        return;
      }
      if (ev.ev === 'hello') {
        if (ev.clockProtocol !== 1) {
          state.error = 'hifi-protocol';
          configuration?.settle(false);
          child.stdin.end();
          return;
        }
        state.running = true;
      } else if (!state.running) return;
      if (ev.ev === 'configured') {
        if (configuration?.ticket === ev.ticket) configuration.settle(ev.ok === true);
        return;
      }
      if (ev.ev === 'devices') state.devices = ev.list;
      else if (ev.ev === 'caps') state.caps = ev;
      else if (ev.ev === 'device') {
        state.device = ev.open ? ev : null;
        if (ev.open) state.error = null;
      } else if (ev.ev === 'error' && ev.code === 'device') state.error = ev.msg;
      send(ev);
    });
    child.stdin.on('error', () => {
      // If the child went away during a write, its close handler owns the shutdown.
    });
    child.on('error', (e) => {
      state.error = String(e.message || e);
    });
    child.once('close', () => {
      const expected = !!shutdown;
      configuration?.settle(false);
      configuration = null;
      proc = null;
      shutdown = null;
      state.running = false;
      state.device = null;
      if (expected) {
        state.error = null;
        send({ ev: 'stopped' });
        // Hi-Fi may have been enabled again during the device's fade and release.
        launch();
        return;
      }
      send({ ev: 'down', reason: state.error });
      // an unexpected exit: start again (a few times, then give up and let the page fall back to the standard output)
      if (want && state.error !== 'hifi-protocol') {
        if (Date.now() - lastStart > 30000) restarts = 0;
        if (restarts < 3) {
          const delay = 500 * 2 ** restarts++;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            launch();
          }, delay);
        }
      }
    });
    write({ cmd: 'devices' });
    config();
  }
  function stop() {
    want = false;
    restarts = 0;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (proc && !shutdown) {
      const child = proc;
      shutdown = new Promise((resolve) => child.once('close', resolve));
      try {
        child.stdin.end();
      } catch (e) {
        /* already gone */
      }
    }
  }
  function apply() {
    if (settings.audioOut === 'hifi') {
      want = true;
      if (proc && !shutdown) config();
      else if (!proc && !retryTimer) launch();
    } else stop();
  }

  ipcMain.handle('audio:state', () => ({ supported: supported(), processEpoch, ...state }));
  // the performance counter now (100 ns units, libuv's high-resolution time rests on it as the native core's reports
  // do): the page measures how its own clock stands to it
  ipcMain.handle('audio:qpc', () => Number(process.hrtime.bigint() / 100n));
  ipcMain.handle('audio:cmd', async (_e, o) => {
    if (!o || typeof o.cmd !== 'string') return false;
    const lane = o.next ? 'next' : 'current';
    if (o.cmd === 'load') pendingLoads[lane] = o;
    if (o.cmd === 'clearnext' || o.cmd === 'release') pendingLoads.next = null;
    if (
      o.cmd === 'release' ||
      ((o.cmd === 'stop' || o.cmd === 'closefile') && (!o.seq || pendingLoads.current?.seq === o.seq))
    )
      pendingLoads.current = null;
    if (o.cmd === 'wait-released') {
      if (!shutdown) return true;
      let timer;
      try {
        return await Promise.race([
          shutdown.then(() => true),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), 3000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    if (want && shutdown) await shutdown;
    if (!want || shutdown) return false;
    if (!proc) return false;
    if (o.cmd === 'load') {
      const owner = proc;
      const tx = configuration;
      if (!tx || !(await tx.done) || proc !== owner || configuration !== tx || shutdown) return false;
      const p = await library.pathOf(o.id);
      if (!p || pendingLoads[lane] !== o || proc !== owner || configuration !== tx || shutdown || !want) return false;
      pendingLoads[lane] = null;
      return write({ cmd: 'load', id: o.id, path: p, next: !!o.next, seq: Number.isSafeInteger(o.seq) ? o.seq : 0 });
    }
    if (
      [
        'play',
        'pause',
        'stop',
        'release',
        'gain',
        'hwgain',
        'devices',
        'closefile',
        'barrier',
        'clearnext',
        'chain',
      ].includes(o.cmd)
    ) {
      return write(o);
    }
    return false;
  });
  app.on('will-quit', stop);
  apply();
  return { apply };
}
module.exports = { start, binPath };
