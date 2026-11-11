// What the page may ask the desktop for: save paths and streamed writes (exports), the window's buttons, the app's
// settings, the music library (by id, never by path), and the Hi-Fi output.
const { contextBridge, ipcRenderer } = require('electron');
const on = ch => f => { const h = (_e, d) => f(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
const L = (...a) => ipcRenderer.invoke(...a);
contextBridge.exposeInMainWorld('cadenzaDesktop', {
  saveDialog: opts => L('save-dialog', opts),
  openWrite: path => L('open-write', path),
  write: (id, data, pos) => L('write', id, data, pos),
  close: id => L('close', id),
  abort: id => L('abort', id),
  saveText: (path, text) => L('save-text', path, text),
  showItem: path => L('show-item', path),
  platform: process.platform,
  win: op => L('win:op', op),
  onWin: on('win:state'),
  onMedia: on('media'),
  settings: () => L('settings:get'),
  setSettings: patch => L('settings:set', patch),
  relaunch: () => L('app:relaunch'),
  playing: on => L('win:playing', on),
});
contextBridge.exposeInMainWorld('cadenzaLib', {
  get: () => L('lib:get'), addFolder: () => L('lib:addFolder'), removeFolder: d => L('lib:removeFolder', d), rescan: () => L('lib:rescan'),
  favorite: (id, on) => L('lib:favorite', id, on), playlist: (op, a, b) => L('lib:playlist', op, a, b), played: id => L('lib:played', id),
  analysis: (id, version) => L('lib:analysis', id, version), saveAnalysis: (id, a) => L('lib:saveAnalysis', id, a), saveLoudness: (id, l) => L('lib:saveLoudness', id, l), analysisFailed: (id, why) => L('lib:analysisFailed', id, why), reanalyze: ids => L('lib:reanalyze', ids), verified: (id, v) => L('lib:verified', id, v), unverified: v => L('lib:unverified', v), clearCaches: () => L('lib:clearCaches'), resetAll: () => L('lib:resetAll'),
  nextAnalysis: version => L('lib:nextAnalysis', version), prioritize: ids => L('lib:prioritize', ids),
  song: id => L('lib:song', id), setSong: (id, d) => L('lib:setSong', id, d),
  lyrics: id => L('lib:lyrics', id), writeLyrics: (id, t, target) => L('lib:writeLyrics', id, t, target), importLyricsFile: () => L('lib:importLyricsFile'),
  searchLyrics: q => L('lib:searchLyrics', q), searchMeta: q => L('lib:searchMeta', q), applyMeta: (id, m) => L('lib:applyMeta', id, m), clearMeta: (id, part) => L('lib:clearMeta', id, part), instrumental: (id, on) => L('lib:instrumental', id, on),
  editMeta: (id, f) => L('lib:editMeta', id, f), searchCovers: q => L('lib:searchCovers', q), setCover: (id, how) => L('lib:setCover', id, how),
  bindMv: id => L('lib:bindMv', id),
  onChanged: on('lib:changed'), onProgress: on('lib:progress'), onAnalysis: on('lib:analysis'), onWake: on('lib:wake'),
});
// the rhythm engine's networks run natively (electron/infer.cjs): their state, the models' download, one network pass
contextBridge.exposeInMainWorld('cadenzaInfer', {
  status: () => L('infer:status'), download: () => L('infer:download'), onProgress: on('infer:progress'), run: (op, args) => L('infer:run', op, args),
});
contextBridge.exposeInMainWorld('cadenzaAudio', {
  state: () => L('audio:state'), cmd: o => L('audio:cmd', o), onEvent: on('audio:ev'),
});
