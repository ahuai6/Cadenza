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
  return [path.join(root, 'release', exe), path.join(root, 'x86_64-pc-windows-gnu', 'release', exe)].find(p => fs.existsSync(p)) || path.join(root, 'release', exe);
}
// Hi-Fi output needs WASAPI (Windows); elsewhere only the tests' simulated device
const supported = () => (process.platform === 'win32' || !!process.env.CADENZA_AUDIO_FAKE) && fs.existsSync(binPath());

function start(ipcMain, getWin, settings, library) {
  let proc = null, want = false, restarts = 0, lastStart = 0;
  const state = { running: false, devices: [], caps: null, device: null, error: null };
  const send = ev => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('audio:ev', ev); };
  const write = o => { if (proc && proc.stdin.writable) proc.stdin.write(JSON.stringify(o) + '\n'); };
  const config = () => write({ cmd: 'config', device: settings.audioDevice || null, mode: settings.audioMode === 'shared' ? 'shared' : 'exclusive', release_after: 20 });

  function launch() {
    if (proc || !want || !supported()) return;
    lastStart = Date.now();
    proc = spawn(binPath(), [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    state.running = true; state.error = null;
    readline.createInterface({ input: proc.stdout }).on('line', line => {
      let ev; try { ev = JSON.parse(line); } catch (e) { return; }
      if (ev.ev === 'devices') state.devices = ev.list;
      else if (ev.ev === 'caps') state.caps = ev;
      else if (ev.ev === 'device') state.device = ev.open ? ev : null;
      else if (ev.ev === 'error' && ev.code === 'device') state.error = ev.msg;
      send(ev);
    });
    proc.on('error', e => { state.error = String(e.message || e); });
    proc.on('exit', () => {
      proc = null; state.running = false; state.device = null;
      send({ ev: 'down' });
      // an unexpected exit: start again (a few times, then give up and let the page fall back to the standard output)
      if (want) { if (Date.now() - lastStart > 30000) restarts = 0; if (restarts++ < 3) setTimeout(launch, 800); }
    });
    write({ cmd: 'devices' }); config();
  }
  function stop() { want = false; if (proc) { try { proc.stdin.end(); } catch (e) { /* already gone */ } } }
  function apply() { if (settings.audioOut === 'hifi') { want = true; if (proc) config(); else launch(); } else stop(); }

  ipcMain.handle('audio:state', () => ({ supported: supported(), ...state }));
  ipcMain.handle('audio:cmd', (_e, o) => {
    if (!o || typeof o.cmd !== 'string') return false;
    if (!proc) { if (want) launch(); if (!proc) return false; }
    if (o.cmd === 'load') { const p = library.pathOf(o.id); if (!p) return false; write({ cmd: 'load', id: o.id, path: p, next: !!o.next, seq: o.seq | 0 }); return true; }
    if (['play', 'pause', 'stop', 'release', 'gain', 'hwgain', 'devices'].includes(o.cmd)) { write(o); return true; }
    return false;
  });
  app.on('will-quit', stop);
  apply();
  return { apply };
}
module.exports = { start };
