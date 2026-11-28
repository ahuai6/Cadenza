// What the page may ask the desktop for: save paths and streamed writes (exports), the window's buttons, the app's
// settings, the music library (by id, never by path), and the Hi-Fi output.
const { contextBridge, ipcRenderer } = require('electron');
const on = (ch) => (f) => {
  const h = (_e, d) => f(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};
const L = (...a) => ipcRenderer.invoke(...a);
contextBridge.exposeInMainWorld('cadenzaDesktop', {
  saveDialog: (opts) => L('save-dialog', opts),
  openWrite: (path) => L('open-write', path),
  write: (id, data, pos) => L('write', id, data, pos),
  close: (id) => L('close', id),
  abort: (id) => L('abort', id),
  saveText: (path, text) => L('save-text', path, text),
  showItem: (path) => L('show-item', path),
  platform: process.platform,
  win: (op) => L('win:op', op),
  onWin: on('win:state'),
  onMedia: on('media'),
  settings: () => L('settings:get'),
  setSettings: (patch) => L('settings:set', patch),
  setEditing: (on) => L('editing:set', on),
  relaunch: () => L('app:relaunch'),
  playing: (on) => L('win:playing', on),
  onSettings: on('settings:pushed'),
  // the lyrics on the desktop (electron/desk.cjs): fed by the main window, read by their own
  deskFeed: (d) => ipcRenderer.send('desk:feed', d),
  onDeskFeed: on('desk:feed'),
  onDeskState: on('desk:state'),
  deskState: () => L('desk:state'),
  deskOp: (op) => L('desk:op', op),
});
contextBridge.exposeInMainWorld('cadenzaLib', {
  get: () => L('lib:get'),
  openWorkshopAudio: () => L('lib:openWorkshopAudio'),
  closeWorkshopAudio: (id) => L('lib:closeWorkshopAudio', id),
  addFolder: () => L('lib:addFolder'),
  removeFolder: (d) => L('lib:removeFolder', d),
  rescan: () => L('lib:rescan'),
  favorite: (id, on) => L('lib:favorite', id, on),
  playlist: (op, a, b) => L('lib:playlist', op, a, b),
  played: (id) => L('lib:played', id),
  analysis: (id, version) => L('lib:analysis', id, version),
  analysisToken: (id) => L('lib:analysisToken', id),
  saveAnalysis: (id, a, token) => L('lib:saveAnalysis', id, a, token),
  saveLoudness: (id, l, token) => L('lib:saveLoudness', id, l, token),
  analysisFailed: (id, why, token) => L('lib:analysisFailed', id, why, token),
  reanalyze: (ids) => L('lib:reanalyze', ids),
  verified: (id, v, token) => L('lib:verified', id, v, token),
  unverified: (v, quality) => L('lib:unverified', v, quality),
  clearCaches: () => L('lib:clearCaches'),
  resetAll: () => L('lib:resetAll'),
  taskDetails: () => L('lib:taskDetails'),
  nextAnalysis: (version, omit, capability) => L('lib:nextAnalysis', version, omit, capability),
  prioritize: (ids) => L('lib:prioritize', ids),
  song: (id) => L('lib:song', id),
  setSong: (id, d) => L('lib:setSong', id, d),
  lyrics: (id) => L('lib:lyrics', id),
  lyricSources: (id) => L('lib:lyricSources', id),
  selectLyrics: (id, source) => L('lib:selectLyrics', id, source),
  mutateLyrics: (id, request) => L('lib:mutateLyrics', id, request),
  exportLyrics: (id, text) => L('lib:exportLyrics', id, text),
  writeLyrics: (id, t, target) => L('lib:writeLyrics', id, t, target),
  importLyricsFile: () => L('lib:importLyricsFile'),
  cancelLyricSearch: () => L('lib:cancelLyricSearch'),
  searchLyrics: (q) => L('lib:searchLyrics', q),
  clearMeta: (id, part) => L('lib:clearMeta', id, part),
  instrumental: (id, on) => L('lib:instrumental', id, on),
  editMeta: (id, f) => L('lib:editMeta', id, f),
  setCover: (id, how) => L('lib:setCover', id, how),
  bindMv: (id) => L('lib:bindMv', id),
  onChanged: on('lib:changed'),
  onPatch: on('lib:patch'),
  onProgress: on('lib:progress'),
  onAnalysis: on('lib:analysis'),
  onWake: on('lib:wake'),
  onAnalysisInvalidated: on('lib:analysisInvalidated'),
});
// what the listener makes and chooses, kept with the library (electron/kept.cjs)
contextBridge.exposeInMainWorld('cadenzaKept', {
  start: () => L('kept:start'),
  get: (key) => L('kept:get', key),
  set: (key, value) => L('kept:set', key, value),
  move: (values) => L('kept:move', values),
});
// the rhythm engine's networks run natively (electron/infer.cjs): their state, the models' download, one network pass
contextBridge.exposeInMainWorld('cadenzaInfer', {
  status: () => L('infer:status'),
  download: (repair) => L('infer:download', repair === true),
  cancelDownload: () => L('infer:cancel-download'),
  onProgress: on('infer:progress'),
  run: (op, args) => L('infer:run', op, args),
});
contextBridge.exposeInMainWorld('cadenzaAudio', {
  state: () => L('audio:state'),
  cmd: (o) => L('audio:cmd', o),
  qpc: () => L('audio:qpc'),
  onEvent: on('audio:ev'),
});

const ai = (action, input) => ipcRenderer.invoke('lyrics-ai:' + action, input);
contextBridge.exposeInMainWorld('cadenzaLyricAI', {
  state: () => ai('state'),
  signIn: () => ai('signIn'),
  cancelSignIn: () => ai('cancelSignIn'),
  signOut: () => ai('signOut'),
  save: (input) => ai('save', input),
  remove: (id) => ai('remove', id),
  models: (id) => ai('models', id),
  preferences: (input) => ai('preferences', input),
  translate: (input) => ai('translate', input),
  cancel: () => ai('cancel'),
});
