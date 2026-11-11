// Cadenza desktop shell. The window is frameless (the page draws its own title bar and window buttons); this process adds
// what a page cannot do itself: the music library on disk (library.cjs), save dialogs and streamed writes for exports of
// any size, the app's own settings (start at login, the tray), media keys, and the Hi-Fi output (audio.cjs).
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  Tray,
  nativeImage,
  nativeTheme,
  globalShortcut,
  protocol,
  screen,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const library = require('./library.cjs');
const audio = require('./audio.cjs');
const inferHost = require('./inferHost.cjs');

app.setName('Cadenza');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCEncoderSupport'); // H.265 export where the GPU can encode it
// no HTTP/3: the lookup services sit behind a CDN that offers it after the first answer, and on networks that block or
// slow UDP every request after the first then fails or hangs
app.commandLine.appendSwitch('disable-quic');
if (process.env.CADENZA_USER_DATA) app.setPath('userData', process.env.CADENZA_USER_DATA); // tests run against a clean profile
// everything reset (Settings → data): the profile is removed here, as the app starts again, before anything opens it
if (process.argv.includes('--reset-data')) {
  try {
    fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
  } catch (e) {
    /* in use: kept */
  }
}
protocol.registerSchemesAsPrivileged([library.scheme]);
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null,
  tray = null,
  quitting = false,
  hifi = null,
  infer = null;
const allowed = new Set(); // paths the user chose in a save dialog during this session: the only ones we write
const open = new Map();
let nextId = 1;

/* ---------- the app's own settings ---------- */
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  ui: 'classic',
  spaceBeams: true,
  spaceFollow: false,
  spaceAmbient: true,
  spaceAmbientVol: 0.6,
  spaceImmersive: false,
  spaceTint: 'cover',
  spaceTintColor: '#D97757',
  spaceBeatBeams: true,
  spacePulse: true,
  spaceDream: true,
  spaceLine: 'mid',
  spaceShadow: 'high',
  spaceScale: 1,
  spaceWalk: 1,
  spaceLook: 1,
  spaceLyric: 'm',
  spaceReduced: false,
  spaceFont: 'sansmed',
  spaceFxBeat: 1,
  spaceFxPulse: 1,
  spaceFxTint: 1,
  spaceFxBeams: 1,
  mvDark: 0.34,
  mvBlur: 0.12,
  mvDesat: 0,
  mvFit: false,
  theme: 'system',
  tone: 'paper',
  scanOnLaunch: true,
  openAtLogin: false,
  closeToTray: false,
  lang: '',
  scale: 'auto',
  fps: 0,
  prerender: true,
  audioOut: 'standard',
  audioMode: 'exclusive',
  audioDevice: '',
  fixedVolume: true,
  volBalance: true,
  rhythmEngine: 'auto',
  rhythmRuntime: 'auto',
  rhythmDevice: 'auto',
  rhythmDrums: true,
  rhythmStream: 'stream',
  gfx: 'default',
  gpuLyrics: true,
  perfHud: false,
  debugLog: false,
  fxCapSubs: true,
  fxCapReads: true,
  uiFont: 'default',
  fxAspect: '16:9',
  lyricsTarget: 'tag',
};
let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')) };
} catch (e) {
  /* first run */
}
function applySettings() {
  nativeTheme.themeSource = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';
  if (process.platform !== 'linux')
    app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, args: ['--hidden'] });
  if (settings.closeToTray && !tray) makeTray();
  else if (!settings.closeToTray && tray) {
    tray.destroy();
    tray = null;
  }
}
const bgColor = () => (nativeTheme.shouldUseDarkColors ? '#101014' : '#f5f4f7');
const asset = (f) => path.join(__dirname, 'assets', f);

function makeTray() {
  // Windows: an .ico with every size drawn for itself (a 16 px image stretched to 24 or 32 px is blurry); elsewhere a
  // 32 px image marked as 2x
  tray = new Tray(
    process.platform === 'win32'
      ? asset('icon.ico')
      : nativeImage.createFromBuffer(fs.readFileSync(asset('tray.png')), { scaleFactor: 2 }),
  );
  tray.setToolTip('Cadenza');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Cadenza', click: showWin },
      { type: 'separator' },
      { label: '▶ / ❚❚', click: () => win && win.webContents.send('media', 'toggle') },
      { label: '⏭', click: () => win && win.webContents.send('media', 'next') },
      { type: 'separator' },
      {
        role: 'quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showWin);
}
function showWin() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: bgColor(),
    title: 'Cadenza',
    frame: false,
    icon: asset(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    // (backgroundThrottling off: covered or behind other windows, the page's timers and audio scheduling keep full speed)
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  const hidden = process.argv.includes('--hidden') && settings.closeToTray; // started at login into the tray
  win.once('ready-to-show', () => {
    if (!hidden) win.show();
    setThumbar();
  });
  win.on('show', setThumbar);
  win.on('restore', setThumbar); // (Windows forgets them when the window has been hidden)
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible() && !hidden) win.show();
  }, 3000); // some GPUs never report ready
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // on Windows isFullScreen() can still report the old state while its own event fires: each event says what it means,
  // and the state is read again once the window has settled
  const send = (o = {}) =>
    win &&
    !win.isDestroyed() &&
    win.webContents.send('win:state', {
      max: win.isMaximized() && !win.isFullScreen(),
      full: win.isFullScreen(),
      mini: !!miniFrom,
      min: win.isMinimized(),
      ...o,
    });
  let settle = 0;
  const state = (o) => {
    send(o);
    clearTimeout(settle);
    settle = setTimeout(() => send(), 250);
  };
  win.on('maximize', () => state({ max: true }));
  win.on('unmaximize', () => state({ max: false }));
  // (minimised: the page is told, and draws nothing until the window is back — the space's energy saving is this)
  win.on('minimize', () => send({ min: true }));
  win.on('restore', () => send({ min: false }));
  win.on('enter-full-screen', () => state({ full: true }));
  win.on('leave-full-screen', () => state({ full: false }));
  win.on('resize', () => state());
  win.on('close', (e) => {
    if (settings.closeToTray && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
  win.loadFile(path.join(__dirname, '..', 'dist-app', 'index.html'));
}

Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
  ]),
);

/* ---------- window buttons and settings ---------- */
// the taskbar preview's buttons (Windows): previous, play / pause, next. Their pictures are drawn here, white on clear.
function thumbIcon(kind) {
  const N = 32,
    buf = Buffer.alloc(N * N * 4),
    put = (x, y) => {
      if (x < 0 || y < 0 || x >= N || y >= N) return;
      const o = (y * N + x) * 4;
      buf[o] = buf[o + 1] = buf[o + 2] = 255;
      buf[o + 3] = 255;
    };
  const rect = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y);
  };
  const tri = (x0, x1, dir) => {
    for (let y = 7; y < 25; y++) {
      const k = 1 - Math.abs(y - 15.5) / 9,
        w = Math.round((x1 - x0) * k);
      for (let i = 0; i < w; i++) put(dir > 0 ? x0 + i : x1 - i, y);
    }
  };
  if (kind === 'play') tri(10, 25, 1);
  else if (kind === 'pause') {
    rect(9, 7, 14, 25);
    rect(18, 7, 23, 25);
  } else if (kind === 'next') {
    tri(7, 21, 1);
    rect(22, 7, 25, 25);
  } else {
    tri(10, 24, -1);
    rect(7, 7, 10, 25);
  }
  return nativeImage.createFromBitmap(buf, { width: N, height: N, scaleFactor: 2 });
}
let thumbPlaying = false;
function setThumbar() {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const send = (op) => () => win && win.webContents.send('media', op);
  try {
    win.setThumbarButtons([
      { tooltip: 'Previous', icon: thumbIcon('prev'), click: send('prev') },
      {
        tooltip: thumbPlaying ? 'Pause' : 'Play',
        icon: thumbIcon(thumbPlaying ? 'pause' : 'play'),
        click: send('toggle'),
      },
      { tooltip: 'Next', icon: thumbIcon('next'), click: send('next') },
    ]);
  } catch (e) {
    /* no taskbar */
  }
}
ipcMain.handle('win:playing', (_e, on) => {
  if (!!on !== thumbPlaying) {
    thumbPlaying = !!on;
    setThumbar();
  }
});
// the small window: kept on top of every other window in a corner of the screen, so the app stays in the foreground
// (Windows throttles a background app's audio over Bluetooth); the window's size and place before it come back after
let miniFrom = null;
function setMini(on) {
  if (!win || on === !!miniFrom) return;
  if (on) {
    miniFrom = { bounds: win.getNormalBounds(), max: win.isMaximized() };
    const go = () => {
      if (!win || !miniFrom) return;
      if (win.isMaximized()) win.unmaximize();
      win.setMinimumSize(320, 200);
      const wa = screen.getDisplayMatching(win.getBounds()).workArea,
        w = 480,
        h = 300;
      win.setBounds({ x: wa.x + wa.width - w - 20, y: wa.y + wa.height - h - 20, width: w, height: h });
      win.setAlwaysOnTop(true, 'floating');
      win.webContents.send('win:state', { max: false, full: false, mini: true });
    };
    if (win.isFullScreen()) {
      win.once('leave-full-screen', () => setTimeout(go, 50));
      win.setFullScreen(false);
    } else go();
  } else {
    const was = miniFrom;
    miniFrom = null;
    win.setAlwaysOnTop(false);
    win.setMinimumSize(980, 640);
    win.setBounds(was.bounds);
    if (was.max) win.maximize();
    win.webContents.send('win:state', { max: win.isMaximized(), full: false, mini: false });
  }
}
ipcMain.handle('win:op', (_e, op) => {
  if (!win) return null;
  if (op === 'mini') {
    setMini(!miniFrom);
    return { max: win.isMaximized(), full: win.isFullScreen(), mini: !!miniFrom };
  }
  if ((op === 'max' || op === 'full') && miniFrom) setMini(false);
  if (op === 'min') win.minimize();
  else if (op === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (op === 'close') win.close();
  else if (op === 'full') win.setFullScreen(!win.isFullScreen());
  return { max: win.isMaximized(), full: win.isFullScreen(), mini: !!miniFrom };
});
// the interface mode (classic or space) is chosen at start: changing it restarts the app
ipcMain.handle('app:relaunch', () => {
  app.relaunch();
  app.exit(0);
});
ipcMain.handle('settings:get', () => ({ ...settings, platform: process.platform, version: app.getVersion() }));
ipcMain.handle('settings:set', (_e, patch) => {
  for (const k of Object.keys(patch || {})) if (k in DEFAULTS) settings[k] = patch[k];
  try {
    fs.writeFileSync(SETTINGS(), JSON.stringify(settings));
  } catch (e) {
    /* read-only profile */
  }
  applySettings();
  if (win) win.setBackgroundColor(bgColor());
  if (hifi && ['audioOut', 'audioMode', 'audioDevice'].some((k) => k in (patch || {}))) hifi.apply();
  if (infer && 'rhythmDevice' in (patch || {})) infer.restart();
  return { ...settings, platform: process.platform, version: app.getVersion() };
});

/* ---------- exports: the user picks a path, then the page streams positional writes to it ---------- */
ipcMain.handle('save-dialog', async (_e, opts) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('videos'), String(opts.defaultPath || 'cadenza')),
    filters: opts.filters,
  });
  if (r.canceled || !r.filePath) return null;
  allowed.add(r.filePath);
  return r.filePath;
});
ipcMain.handle('open-write', async (_e, p) => {
  if (!allowed.has(p)) throw new Error('not a chosen path');
  const fh = await fs.promises.open(p, 'w');
  const id = nextId++;
  open.set(id, { fh, p });
  return id;
});
ipcMain.handle('write', async (_e, id, data, pos) => {
  const f = open.get(id);
  if (!f) throw new Error('closed');
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let off = 0;
  while (off < b.length) {
    const { bytesWritten } = await f.fh.write(b, off, b.length - off, pos + off);
    off += bytesWritten;
  }
});
ipcMain.handle('close', async (_e, id) => {
  const f = open.get(id);
  if (!f) return 0;
  open.delete(id);
  await f.fh.close();
  return (await fs.promises.stat(f.p)).size;
});
ipcMain.handle('abort', async (_e, id) => {
  const f = open.get(id);
  if (!f) return;
  open.delete(id);
  await f.fh.close();
  await fs.promises.rm(f.p, { force: true });
});
ipcMain.handle('save-text', async (_e, p, text) => {
  if (!allowed.has(p)) throw new Error('not a chosen path');
  await fs.promises.writeFile(p, text, 'utf8');
});
ipcMain.handle('show-item', (_e, p) => {
  if (allowed.has(p)) shell.showItemInFolder(p);
});

app.on('second-instance', showWin);
app.whenReady().then(async () => {
  applySettings();
  await library.start(ipcMain, () => win, settings);
  hifi = audio.start(ipcMain, () => win, settings, library);
  infer = inferHost.start(ipcMain, () => win, settings);
  createWindow();
  for (const [key, op] of [
    ['MediaPlayPause', 'toggle'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'prev'],
  ]) {
    try {
      globalShortcut.register(key, () => win && win.webContents.send('media', op));
    } catch (e) {
      /* taken by another app */
    }
  }
});
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (!settings.closeToTray) app.quit();
});
app.on('activate', showWin);
