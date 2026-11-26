const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

function musicHall({ online, fromMain, preferences, asset }) {
  let window = null;
  const authorized = (event) =>
    window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  ipcMain.handle('hall:open', (event) => {
    if (!fromMain(event)) return false;
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return true;
    }
    const w = new BrowserWindow({
      title: 'Cadenza · Music Hall',
      width: 1160,
      height: 800,
      minWidth: 640,
      minHeight: 480,
      backgroundColor: preferences().theme === 'dark' ? '#171715' : '#ffffff',
      frame: false,
      show: false,
      icon: asset(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'hall-preload.cjs'),
        partition: 'cadenza-music-hall',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    window = w;
    const owner = w.webContents.id;
    w.once('ready-to-show', () => {
      if (!w.isDestroyed()) w.show();
    });
    w.on('closed', () => {
      online.closeOwner(owner);
      if (window === w) window = null;
    });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (event) => event.preventDefault());
    w.webContents.on('will-attach-webview', (event) => event.preventDefault());
    for (const event of ['maximize', 'unmaximize'])
      w.on(event, () => w.webContents.send('hall:maximized', w.isMaximized()));
    void w.loadFile(path.join(__dirname, '..', 'dist-app', 'index.html'), { hash: 'hall' }).catch(() => {
      if (!w.isDestroyed()) w.destroy();
    });
    return true;
  });
  ipcMain.handle('hall:read', (event) =>
    authorized(event) ? { ...online.snapshot(), appearance: preferences() } : null,
  );
  ipcMain.handle('hall:window', (event, op) => {
    if (!authorized(event)) return;
    if (op === 'min') window.minimize();
    if (op === 'max') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (op === 'close') window.close();
  });
  return {
    appearanceChanged() {
      if (window && !window.isDestroyed()) window.webContents.send('hall:appearance', preferences());
    },
  };
}

module.exports = { musicHall };
