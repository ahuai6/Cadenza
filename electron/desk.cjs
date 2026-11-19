// The lyrics on the desktop: a window of their own, three lines, over everything else on the screen. It is dragged by
// its lines and sized by its edges while unlocked; locked, the pointer goes through it to whatever is underneath, and it
// can be unlocked only from the app (the settings, or the button beside the player). The main window's page feeds it the
// lines and the song's time (desk:feed); it keeps no player of its own.
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let desk = null,
  ctx = null; // { get settings, save(patch), main() }
let saveTm = 0;
function bounds() {
  try {
    const b = JSON.parse(ctx.settings().deskBounds || 'null');
    if (b && b.width > 100 && b.height > 40) {
      // (still on a screen there: a screen taken away since puts it back at the foot of the main one)
      const d = screen.getDisplayMatching(b).workArea;
      if (b.x < d.x + d.width - 40 && b.x + b.width > d.x + 40 && b.y < d.y + d.height - 20 && b.y > d.y - 20) return b;
    }
  } catch {
    /* none kept */
  }
  const wa = screen.getPrimaryDisplay().workArea,
    width = Math.min(1100, Math.round(wa.width * 0.62)),
    height = 190;
  return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + wa.height - height - 36, width, height };
}
function apply() {
  if (!desk) return;
  const s = ctx.settings(),
    locked = !!s.deskLock;
  // (locked: clicks go through; the window cannot take the focus or be moved)
  desk.setIgnoreMouseEvents(locked, { forward: true });
  desk.setFocusable(!locked);
  desk.setResizable(!locked);
  desk.webContents.send('desk:state', { locked, size: s.deskSize || 34 });
}
function open() {
  if (desk) return apply();
  desk = new BrowserWindow({
    ...bounds(),
    minWidth: 360,
    minHeight: 110,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Cadenza',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  // (over full-screen windows too, as a game's or a video's)
  desk.setAlwaysOnTop(true, 'screen-saver');
  desk.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  desk.loadFile(path.join(__dirname, '..', 'dist-app', 'index.html'), { hash: 'desk' });
  desk.once('ready-to-show', () => {
    desk?.showInactive();
    apply();
  });
  const keep = () => {
    clearTimeout(saveTm);
    saveTm = setTimeout(() => desk && ctx.save({ deskBounds: JSON.stringify(desk.getBounds()) }), 400);
  };
  desk.on('move', keep);
  desk.on('resize', keep);
  desk.on('closed', () => {
    desk = null;
  });
}
function close() {
  if (desk) desk.destroy();
  desk = null;
}
/** After any change of the settings: open, close or update the window as they say. */
function sync() {
  if (!ctx) return;
  if (ctx.settings().deskLyrics) open();
  else close();
}
function init(c) {
  const again = !!ctx;
  ctx = c;
  if (again) return sync(); // (a second main window: the handlers are there already)
  // the main window's page: the lines and the time, passed on as they are
  ipcMain.on('desk:feed', (_e, d) => {
    if (desk && !desk.isDestroyed()) desk.webContents.send('desk:feed', d);
  });
  // from the window itself (only while unlocked): lock it, a size step, close it
  ipcMain.handle('desk:op', (_e, op) => {
    const s = ctx.settings();
    if (op === 'lock') ctx.save({ deskLock: true });
    else if (op === 'bigger') ctx.save({ deskSize: Math.min(72, (s.deskSize || 34) + 2) });
    else if (op === 'smaller') ctx.save({ deskSize: Math.max(18, (s.deskSize || 34) - 2) });
    else if (op === 'close') ctx.save({ deskLyrics: false });
    return true;
  });
  // (the page of the window asks for its state once it is up)
  ipcMain.handle('desk:state', () => ({ locked: !!ctx.settings().deskLock, size: ctx.settings().deskSize || 34 }));
  sync();
}
module.exports = { init, sync, apply, close };
