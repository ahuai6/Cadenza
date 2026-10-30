// Cadenza desktop shell. The window is frameless (the page draws its own title bar and window buttons); this process adds
// what a page cannot do itself: the music library on disk (library.cjs), save dialogs and streamed writes for exports of
// any size, the app's own settings (start at login, the tray), media keys, and the Hi-Fi output (audio.cjs).
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, nativeTheme, globalShortcut, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const library = require('./library.cjs');
const audio = require('./audio.cjs');

app.setName('Cadenza');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCEncoderSupport');      // H.265 export where the GPU can encode it
// no HTTP/3: the lookup services sit behind a CDN that offers it after the first answer, and on networks that block or
// slow UDP every request after the first then fails or hangs
app.commandLine.appendSwitch('disable-quic');
if (process.env.CADENZA_USER_DATA) app.setPath('userData', process.env.CADENZA_USER_DATA);   // tests run against a clean profile
// everything reset (Settings → data): the profile is removed here, as the app starts again, before anything opens it
if (process.argv.includes('--reset-data')) { try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch (e) { /* in use: kept */ } }
protocol.registerSchemesAsPrivileged([library.scheme]);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, tray = null, quitting = false, hifi = null;
const allowed = new Set();       // paths the user chose in a save dialog during this session: the only ones we write
const open = new Map(); let nextId = 1;

/* ---------- the app's own settings ---------- */
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { mvDark: 0.34, mvBlur: 0.12, mvDesat: 0, mvFit: false, theme: 'system', scanOnLaunch: true, openAtLogin: false, closeToTray: false, lang: '', scale: 'auto', fps: 0, prerender: true,
  audioOut: 'standard', audioMode: 'exclusive', audioDevice: '', fixedVolume: true, volBalance: true, rhythmEngine: 'auto', rhythmDrums: true, gfx: 'default', uiFont: 'default', fxAspect: '16:9', lyricsTarget: 'tag' };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')) }; } catch (e) { /* first run */ }
function applySettings() {
  nativeTheme.themeSource = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';
  if (process.platform !== 'linux') app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, args: ['--hidden'] });
  if (settings.closeToTray && !tray) makeTray(); else if (!settings.closeToTray && tray) { tray.destroy(); tray = null; }
}
const bgColor = () => (nativeTheme.shouldUseDarkColors ? '#101014' : '#f5f4f7');
const asset = f => path.join(__dirname, 'assets', f);

function makeTray() {
  // Windows: an .ico with every size drawn for itself (a 16 px image stretched to 24 or 32 px is blurry); elsewhere a
  // 32 px image marked as 2x
  tray = new Tray(process.platform === 'win32' ? asset('icon.ico') : nativeImage.createFromBuffer(fs.readFileSync(asset('tray.png')), { scaleFactor: 2 }));
  tray.setToolTip('Cadenza');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Cadenza', click: showWin },
    { type: 'separator' },
    { label: '▶ / ❚❚', click: () => win && win.webContents.send('media', 'toggle') },
    { label: '⏭', click: () => win && win.webContents.send('media', 'next') },
    { type: 'separator' },
    { role: 'quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWin);
}
function showWin() { if (!win) return createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640, backgroundColor: bgColor(), title: 'Cadenza', frame: false,
    icon: asset(process.platform === 'win32' ? 'icon.ico' : 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  const hidden = process.argv.includes('--hidden') && settings.closeToTray;      // started at login into the tray
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible() && !hidden) win.show(); }, 3000);   // some GPUs never report ready
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // on Windows isFullScreen() can still report the old state while its own event fires: each event says what it means,
  // and the state is read again once the window has settled
  const send = (o = {}) => win && !win.isDestroyed() && win.webContents.send('win:state', { max: win.isMaximized() && !win.isFullScreen(), full: win.isFullScreen(), ...o });
  let settle = 0; const state = o => { send(o); clearTimeout(settle); settle = setTimeout(() => send(), 250); };
  win.on('maximize', () => state({ max: true })); win.on('unmaximize', () => state({ max: false }));
  win.on('enter-full-screen', () => state({ full: true })); win.on('leave-full-screen', () => state({ full: false }));
  win.on('resize', () => state());
  win.on('close', e => { if (settings.closeToTray && !quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'dist-app', 'index.html'));
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { role: 'fileMenu' }, { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
]));

/* ---------- window buttons and settings ---------- */
ipcMain.handle('win:op', (_e, op) => {
  if (!win) return null;
  if (op === 'min') win.minimize();
  else if (op === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (op === 'close') win.close();
  else if (op === 'full') win.setFullScreen(!win.isFullScreen());
  return { max: win.isMaximized(), full: win.isFullScreen() };
});
ipcMain.handle('settings:get', () => ({ ...settings, platform: process.platform, version: app.getVersion() }));
ipcMain.handle('settings:set', (_e, patch) => {
  for (const k of Object.keys(patch || {})) if (k in DEFAULTS) settings[k] = patch[k];
  try { fs.writeFileSync(SETTINGS(), JSON.stringify(settings)); } catch (e) { /* read-only profile */ }
  applySettings(); if (win) win.setBackgroundColor(bgColor());
  if (hifi && ['audioOut', 'audioMode', 'audioDevice'].some(k => k in (patch || {}))) hifi.apply();
  return { ...settings, platform: process.platform, version: app.getVersion() };
});

/* ---------- exports: the user picks a path, then the page streams positional writes to it ---------- */
ipcMain.handle('save-dialog', async (_e, opts) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('videos'), String(opts.defaultPath || 'cadenza')), filters: opts.filters });
  if (r.canceled || !r.filePath) return null;
  allowed.add(r.filePath); return r.filePath;
});
ipcMain.handle('open-write', async (_e, p) => {
  if (!allowed.has(p)) throw new Error('not a chosen path');
  const fh = await fs.promises.open(p, 'w'); const id = nextId++; open.set(id, { fh, p }); return id;
});
ipcMain.handle('write', async (_e, id, data, pos) => {
  const f = open.get(id); if (!f) throw new Error('closed');
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength); let off = 0;
  while (off < b.length) { const { bytesWritten } = await f.fh.write(b, off, b.length - off, pos + off); off += bytesWritten; }
});
ipcMain.handle('close', async (_e, id) => { const f = open.get(id); if (!f) return 0; open.delete(id); await f.fh.close(); return (await fs.promises.stat(f.p)).size; });
ipcMain.handle('abort', async (_e, id) => { const f = open.get(id); if (!f) return; open.delete(id); await f.fh.close(); await fs.promises.rm(f.p, { force: true }); });
ipcMain.handle('save-text', async (_e, p, text) => { if (!allowed.has(p)) throw new Error('not a chosen path'); await fs.promises.writeFile(p, text, 'utf8'); });
ipcMain.handle('show-item', (_e, p) => { if (allowed.has(p)) shell.showItemInFolder(p); });

app.on('second-instance', showWin);
app.whenReady().then(async () => {
  applySettings();
  await library.start(ipcMain, () => win, settings);
  hifi = audio.start(ipcMain, () => win, settings, library);
  createWindow();
  for (const [key, op] of [['MediaPlayPause', 'toggle'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev']]) { try { globalShortcut.register(key, () => win && win.webContents.send('media', op)); } catch (e) { /* taken by another app */ } }
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!settings.closeToTray) app.quit(); });
app.on('activate', showWin);
