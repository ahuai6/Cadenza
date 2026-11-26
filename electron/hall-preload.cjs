const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel) => (callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('cadenzaHall', {
  read: () => ipcRenderer.invoke('hall:read'),
  downloads: () => ipcRenderer.invoke('hall:download-list'),
  downloadVariants: (provider, input) => ipcRenderer.invoke('hall:download-variants', provider, input),
  downloadAdd: (provider, input) => ipcRenderer.invoke('hall:download-add', provider, input),
  downloadAct: (id, action) => ipcRenderer.invoke('hall:download-act', id, action),
  downloadReveal: (id) => ipcRenderer.invoke('hall:download-reveal', id),
  onDownloads: subscribe('hall:download-display'),
  catalog: (provider, capability, input) => ipcRenderer.invoke('hall:catalog', provider, capability, input),
  account: (provider, action, input) => ipcRenderer.invoke('hall:account', provider, action, input),
  playlists: (provider, input) => ipcRenderer.invoke('hall:playlists', provider, input),
  cancel: (provider, lane) => ipcRenderer.invoke('hall:cancel', provider, lane),
  stopPreview: () => ipcRenderer.invoke('hall:preview-stop'),
  onPreview: subscribe('hall:preview-display'),
  window: (op) => ipcRenderer.invoke('hall:window', op),
  onMaximized: subscribe('hall:maximized'),
  onAppearance: subscribe('hall:appearance'),
});
