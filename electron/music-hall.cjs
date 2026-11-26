const { BrowserWindow, ipcMain, shell, dialog, app } = require('electron');
const { OnlineError } = require('./online.cjs');
const { boundedText, catalogId, publicUrl } = require('./online-providers.cjs');
const audition = require('./online-preview.cjs');
const { createDownloads } = require('./online-downloads.cjs');
const { downloadSettings, settingsPatch } = require('./online-download-settings.cjs');
const path = require('node:path');
const fs = require('node:fs/promises');
const { assertDirectory, replace } = require('./library-storage.cjs');
const VALID_TIERS = ['standard', 'high', 'lossless'];

function musicHall({ online, fromMain, preferences, asset, getPlayer, library, nativeBin }) {
  let window = null;
  let fetchingPreview;
  let previewStatus = null;
  const downloadPrefsFile = path.join(app.getPath('userData'), 'library', 'online-download-preferences.json');
  let downloadPrefs = {};
  let scopedDownloadPrefs = {};
  let downloadPrefsWrite = Promise.resolve();
  let downloadPrefsLoad;
  function loadDownloadPrefs() {
    downloadPrefsLoad ||= (async () => {
      await assertDirectory(path.dirname(downloadPrefsFile));
      if (!(await fs.lstat(downloadPrefsFile)).isFile()) return;
      const data = JSON.parse(await fs.readFile(downloadPrefsFile, 'utf8'));
      if (typeof data.folder === 'string' && path.isAbsolute(data.folder) && VALID_TIERS.includes(data.tier))
        downloadPrefs = { folder: data.folder, tier: data.tier };
      if (data.scopes && typeof data.scopes === 'object') {
        for (const id of ['global', ...online.snapshot().providers.map((provider) => provider.id)]) {
          if (!Object.hasOwn(data.scopes, id)) continue;
          const scope = data.scopes[id];
          scopedDownloadPrefs[id] = {
            ...settingsPatch(scope),
            ...(VALID_TIERS.includes(scope?.tier) ? { tier: scope.tier } : {}),
            ...(typeof scope?.folder === 'string' && path.isAbsolute(scope.folder) ? { folder: scope.folder } : {}),
          };
        }
      }
    })().catch(() => {});
    return downloadPrefsLoad;
  }
  function saveDownloadPrefs() {
    const body = JSON.stringify({ ...downloadPrefs, scopes: scopedDownloadPrefs });
    downloadPrefsWrite = downloadPrefsWrite
      .catch(() => {})
      .then(async () => {
        await assertDirectory(path.dirname(downloadPrefsFile));
        await replace(downloadPrefsFile, body);
      });
    return downloadPrefsWrite;
  }
  function effectiveDownloadPrefs(provider) {
    return { ...downloadPrefs, ...scopedDownloadPrefs.global, ...scopedDownloadPrefs[provider] };
  }
  function publicDownloadPrefs(provider) {
    const settings = effectiveDownloadPrefs(provider);
    return { ...downloadSettings(settings), hasDirectory: !!settings.folder, tier: settings.tier };
  }
  const displayPreview = () => {
    if (!previewStatus) return tell('hall:preview-display', null);
    const { provider, id, phase, position, duration, title } = previewStatus;
    tell('hall:preview-display', { provider, id, phase, position, duration, title });
  };
  const tell = (channel, ...value) => {
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...value);
  };
  const downloads = createDownloads({
    library,
    nativeBin,
    publish: (tasks) => tell('hall:download-display', tasks),
    resolve: (job, signal) =>
      online.invoke({
        provider: job.provider,
        capability: 'download',
        account: job.account,
        owner: job.owner,
        input: { id: job.track, tier: job.tier, region: job.region },
        signal,
      }),
  });
  function stopPreview(owner) {
    if (fetchingPreview && fetchingPreview.owner === owner) {
      fetchingPreview.abort.abort();
      fetchingPreview = null;
    }
    const token = audition.close(owner);
    const player = token && getPlayer();
    if (player && !player.isDestroyed()) player.webContents.send('hall:preview-request', null);
    if (token && previewStatus?.token === token) {
      previewStatus = null;
      tell('hall:preview-display', null);
    }
  }
  ipcMain.on('hall:preview-status', (event, token, phase, position) => {
    if (
      !fromMain(event) ||
      previewStatus?.token !== token ||
      !['playing', 'buffering', 'ended', 'error'].includes(phase) ||
      !Number.isFinite(position)
    )
      return;
    previewStatus = { ...previewStatus, phase, position: Math.max(0, Math.min(position, previewStatus.duration)) };
    if (phase === 'ended' || phase === 'error') audition.close();
    displayPreview();
  });
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
      stopPreview(owner);
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
  ipcMain.handle('hall:read', async (event) => {
    if (!authorized(event)) return null;
    await loadDownloadPrefs();
    return authorized(event)
      ? {
          ...online.snapshot(),
          appearance: preferences(),
          downloadPreference: publicDownloadPrefs(),
        }
      : null;
  });
  ipcMain.handle('hall:cancel', (event, provider, lane) => {
    if (authorized(event) && catalogId(provider) && ['browse', 'search', 'playlists', 'variants'].includes(lane))
      online.cancel(event.sender.id, provider + ':' + lane);
  });
  ipcMain.handle('hall:preview-stop', (event) => {
    if (authorized(event)) stopPreview(event.sender.id);
  });
  ipcMain.handle('hall:catalog', async (event, provider, capability, raw) => {
    if (!authorized(event)) return { ok: false, code: 'restricted' };
    const owner = event.sender.id;
    const input = {
      id: catalogId(raw?.id || ''),
      namespace: ['songs', 'albums', 'playlists', 'charts'].includes(raw?.namespace) ? raw.namespace : 'songs',
      query: boundedText(raw?.query, 120).trim(),
      region: /^[a-z]{2}$/.test(raw?.region) ? raw.region : 'us',
      offset: Number.isSafeInteger(raw?.offset) ? Math.min(1000, Math.max(0, raw.offset)) : 0,
    };
    const lane = provider + ':' + (capability === 'search' ? 'search' : 'browse');
    try {
      if (typeof provider !== 'string' || !catalogId(provider)) throw new OnlineError('invalid');
      if (!['search', 'charts', 'recommendations', 'collection', 'preview', 'lyrics', 'open'].includes(capability))
        throw new OnlineError('unavailable');
      if (capability === 'search' && !input.query) throw new OnlineError('invalid');
      if (['collection', 'preview', 'lyrics', 'open'].includes(capability) && !input.id)
        throw new OnlineError('invalid');
      if (capability === 'preview') {
        const prior = fetchingPreview;
        prior?.abort.abort();
        const job = { owner, abort: new AbortController() };
        fetchingPreview = job;
        try {
          const media = await online.invoke({
            provider,
            capability,
            input,
            owner,
            lane: 'preview',
            signal: job.abort.signal,
          });
          job.abort.signal.throwIfAborted();
          const asset = await audition.prepare(media, job.abort.signal);
          if (fetchingPreview !== job || !window || window.isDestroyed() || owner !== window.webContents.id)
            throw new OnlineError('cancelled');
          const player = getPlayer();
          if (!player || player.isDestroyed()) throw new OnlineError('unavailable');
          const lease = audition.open(owner, asset, (token) => {
            if (previewStatus?.token === token) stopPreview(owner);
          });
          previewStatus = { ...lease, provider, id: input.id, title: media.title, phase: 'buffering', position: 0 };
          player.webContents.send('hall:preview-request', lease);
          displayPreview();
          return { ok: true };
        } finally {
          if (fetchingPreview === job) fetchingPreview = null;
        }
      }
      const result = await online.invoke({
        provider,
        capability,
        input,
        owner,
        lane: capability === 'open' ? undefined : lane,
      });
      if (!window || window.isDestroyed() || window.webContents.id !== owner) throw new OnlineError('cancelled');
      if (capability === 'open') {
        const url = publicUrl(result.url, ['music.apple.com', 'music.163.com', 'y.qq.com', 'kugou.com'], true);
        if (!url) throw new OnlineError('restricted');
        await shell.openExternal(url);
        return { ok: true };
      }
      return capability === 'lyrics' ? { ok: true, lyrics: result } : { ok: true, data: result };
    } catch (error) {
      return { ok: false, code: error instanceof OnlineError ? error.code : 'provider-failed' };
    }
  });
  const playlistSnapshots = new Map();
  const indexFile = path.join(app.getPath('userData'), 'library', 'online-playlists.json');
  let loadedSnapshots;
  let snapshotWrites = Promise.resolve();
  function loadSnapshots() {
    loadedSnapshots ||= (async () => {
      await assertDirectory(path.dirname(indexFile));
      const stat = await fs.lstat(indexFile);
      if (!stat.isFile() || stat.size > 6 * 1024 * 1024) return;
      const saved = JSON.parse(await fs.readFile(indexFile, 'utf8'));
      if (!Array.isArray(saved)) return;
      for (const [key, entry] of saved.slice(-12)) {
        if (
          typeof key === 'string' &&
          Array.isArray(entry?.rows) &&
          entry.rows.length <= 10000 &&
          entry.rows.every((item) => typeof item?.title === 'string' && catalogId(item.ref?.id)) &&
          Number.isFinite(entry.syncedAt)
        )
          playlistSnapshots.set(key, entry);
      }
    })().catch(() => {});
    return loadedSnapshots;
  }
  function saveSnapshots() {
    while (playlistSnapshots.size > 12) playlistSnapshots.delete(playlistSnapshots.keys().next().value);
    let state = JSON.stringify([...playlistSnapshots]);
    while (Buffer.byteLength(state) > 6 * 1024 * 1024 && playlistSnapshots.size > 1) {
      playlistSnapshots.delete(playlistSnapshots.keys().next().value);
      state = JSON.stringify([...playlistSnapshots]);
    }
    if (Buffer.byteLength(state) > 6 * 1024 * 1024) return;
    snapshotWrites = snapshotWrites
      .catch(() => {})
      .then(async () => {
        await assertDirectory(path.dirname(indexFile));
        await replace(indexFile, state);
      });
    void snapshotWrites.catch(() => console.warn('[online] playlist snapshot unavailable'));
  }
  ipcMain.handle('hall:account', async (event, provider, action, raw) => {
    if (!authorized(event) || !['begin', 'poll', 'cancel', 'logout', 'import'].includes(action))
      return { ok: false, code: 'restricted' };
    try {
      let credentials;
      if (action === 'import') {
        if (provider !== 'apple') return { ok: false, code: 'invalid' };
        const picked = await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: [{ name: 'MusicKit JSON', extensions: ['json'] }],
        });
        if (!authorized(event) || picked.canceled || !picked.filePaths[0]) return { ok: false, code: 'cancelled' };
        const file = await fs.open(picked.filePaths[0], 'r');
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size > 16384) return { ok: false, code: 'invalid' };
          const data = Buffer.alloc(16385);
          const { bytesRead } = await file.read(data, 0, data.length, 0);
          if (bytesRead > 16384) return { ok: false, code: 'invalid' };
          credentials = JSON.parse(data.subarray(0, bytesRead).toString('utf8'));
        } finally {
          await file.close();
        }
      }
      const result = await online.invoke({
        provider,
        capability: 'account',
        owner: event.sender.id,
        input: { action, id: catalogId(raw?.id), account: catalogId(raw?.account), credentials },
      });
      if (action === 'logout') {
        await loadSnapshots();
        for (const key of playlistSnapshots.keys()) {
          if (key.startsWith(provider + ':' + catalogId(raw?.account) + ':')) playlistSnapshots.delete(key);
        }
        saveSnapshots();
      }
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, code: error instanceof OnlineError ? error.code : 'provider-failed' };
    }
  });
  ipcMain.handle('hall:playlists', async (event, provider, raw) => {
    if (!authorized(event)) return { ok: false, code: 'restricted' };
    const owner = event.sender.id;
    const account = catalogId(raw?.account);
    const id = raw?.id ? catalogId(raw.id) : '';
    const key = provider + ':' + account + ':' + id;
    await loadSnapshots();
    const prior = playlistSnapshots.get(key);
    const connected = () =>
      online
        .snapshot()
        .accounts.some((entry) => entry.provider === provider && entry.id === account && entry.state === 'connected');
    if (!authorized(event)) return { ok: false, code: 'cancelled' };
    if (!connected()) return { ok: false, code: 'sign-in-required' };
    if (prior && raw?.refresh !== true) return { ok: true, data: prior };
    try {
      const rows = [];
      const fingerprints = new Set();
      for (let page = 0; page < 400; page++) {
        const result = await online.invoke({
          provider,
          capability: 'playlists',
          account,
          owner,
          lane: provider + ':playlists',
          input: { account, id, offset: page * (id ? 25 : 100) },
        });
        if (!authorized(event)) throw new OnlineError('cancelled');
        if (!connected()) throw new OnlineError('expired');
        if (!Array.isArray(result?.rows)) throw new OnlineError('incomplete');
        const fingerprint = JSON.stringify(result.rows.map((row) => row.ref.id));
        // Full pages of a playlist may intentionally repeat. A repeated list page from an account indicates bad pagination.
        if ((result.more && !result.rows.length) || (!id && fingerprints.has(fingerprint)))
          throw new OnlineError('incomplete');
        fingerprints.add(fingerprint);
        rows.push(...result.rows);
        if (result.more) continue;
        const snapshot = { rows, more: false, syncedAt: Date.now() };
        playlistSnapshots.delete(key);
        playlistSnapshots.set(key, snapshot);
        saveSnapshots();
        return { ok: true, data: snapshot };
      }
      throw new OnlineError('incomplete');
    } catch (error) {
      const code = error instanceof OnlineError ? error.code : 'provider-failed';
      return { ok: false, code, previous: code === 'expired' ? undefined : prior };
    }
  });
  ipcMain.handle('hall:download-list', (event) => (authorized(event) ? downloads.snapshot() : []));
  ipcMain.handle('hall:download-settings', async (event, scope, command, raw) => {
    if (!authorized(event) || !(scope === 'global' || online.snapshot().providers.some(({ id }) => id === scope)))
      return null;
    await loadDownloadPrefs();
    if (!authorized(event)) return null;
    if (command === 'read') return publicDownloadPrefs(scope);
    if (command === 'inherit' && scope !== 'global') {
      delete scopedDownloadPrefs[scope];
    } else if (command === 'save') {
      scopedDownloadPrefs[scope] = {
        ...scopedDownloadPrefs[scope],
        ...settingsPatch(raw),
        ...(VALID_TIERS.includes(raw?.tier) ? { tier: raw.tier } : {}),
      };
    } else if (command === 'folder') {
      const picked = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      if (!authorized(event) || picked.canceled || !picked.filePaths[0]) return null;
      await assertDirectory(picked.filePaths[0]);
      scopedDownloadPrefs[scope] = { ...scopedDownloadPrefs[scope], folder: picked.filePaths[0] };
    } else return null;
    await saveDownloadPrefs();
    return publicDownloadPrefs(scope);
  });
  ipcMain.handle('hall:download-variants', async (event, provider, raw) => {
    if (!authorized(event)) return { ok: false, code: 'restricted' };
    const id = catalogId(raw?.track);
    const account = catalogId(raw?.account);
    const region = /^[a-z]{2}$/.test(raw?.region) ? raw.region : 'us';
    if (!id) return { ok: false, code: 'invalid' };
    try {
      online.requireAccess(provider, 'download', account);
      const tiers = await online.invoke({
        provider,
        capability: 'variants',
        account,
        owner: event.sender.id,
        lane: provider + ':variants',
        input: { id, region },
      });
      if (!authorized(event)) return { ok: false, code: 'cancelled' };
      if (!Array.isArray(tiers)) return { ok: false, code: 'invalid-response' };
      return { ok: true, tiers: [...new Set(tiers.filter((tier) => VALID_TIERS.includes(tier)))] };
    } catch (error) {
      return { ok: false, code: error instanceof OnlineError ? error.code : 'provider-failed' };
    }
  });
  ipcMain.handle(
    'hall:download-act',
    (event, id, command) =>
      authorized(event) && ['cancel', 'retry'].includes(command) && downloads.act(catalogId(id), command),
  );
  ipcMain.handle('hall:download-reveal', async (event, id) => {
    if (!authorized(event)) return false;
    const file = downloads.savedFile(catalogId(id));
    if (!file) return false;
    return fs
      .lstat(file)
      .then((stat) => {
        if (!authorized(event) || !stat.isFile()) return false;
        shell.showItemInFolder(file);
        return true;
      })
      .catch(() => false);
  });
  ipcMain.handle('hall:download-add', async (event, provider, raw) => {
    if (!authorized(event)) return { ok: false, code: 'restricted' };
    const account = catalogId(raw?.account),
      track = catalogId(raw?.track),
      tier = raw?.tier;
    if (!track || !VALID_TIERS.includes(tier)) return { ok: false, code: 'invalid' };
    try {
      online.requireAccess(provider, 'download', account);
    } catch (error) {
      return { ok: false, code: error instanceof OnlineError ? error.code : 'provider-failed' };
    }
    try {
      await loadDownloadPrefs();
      if (!authorized(event)) return { ok: false, code: 'cancelled' };
      const prefs = effectiveDownloadPrefs(provider);
      const settings = downloadSettings(prefs, undefined, raw?.settings);
      let folder = raw?.useDefault === true ? prefs.folder : undefined;
      if (folder) {
        try {
          await assertDirectory(folder);
        } catch {
          folder = undefined;
        }
      }
      if (!folder) {
        const picked = await dialog.showOpenDialog(window, {
          defaultPath: prefs.folder || app.getPath('music'),
          properties: ['openDirectory'],
        });
        if (picked.canceled || !picked.filePaths[0]) return { ok: false, code: 'cancelled' };
        folder = picked.filePaths[0];
      }
      if (!authorized(event)) return { ok: false, code: 'cancelled' };
      const task = downloads.add({
        provider,
        account,
        track,
        tier,
        region: /^[a-z]{2}$/.test(raw?.region) ? raw.region : undefined,
        owner: event.sender.id,
        title: boundedText(raw?.title),
        conflict: raw?.conflict === 'skip' ? 'skip' : raw?.conflict === 'keep' ? 'keep' : settings.conflict,
        settings,
        folder,
      });
      if (raw?.remember === true) {
        scopedDownloadPrefs[provider] = { ...scopedDownloadPrefs[provider], folder, tier };
        void saveDownloadPrefs().catch(() => console.warn('[online] download preferences unavailable'));
      }
      return {
        ok: true,
        task,
        downloadPreference: publicDownloadPrefs(provider),
      };
    } catch (error) {
      return { ok: false, code: error instanceof OnlineError ? error.code : 'download-failed' };
    }
  });
  ipcMain.handle('hall:window', (event, op) => {
    if (!authorized(event)) return;
    if (op === 'min') window.minimize();
    if (op === 'max') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (op === 'close') window.close();
  });
  return {
    async close() {
      await downloads.close();
      await snapshotWrites.catch(() => {});
      await downloadPrefsWrite.catch(() => {});
      if (window && !window.isDestroyed()) stopPreview(window.webContents.id);
      audition.close();
    },
    appearanceChanged() {
      if (window && !window.isDestroyed()) window.webContents.send('hall:appearance', preferences());
    },
  };
}

module.exports = { musicHall };
