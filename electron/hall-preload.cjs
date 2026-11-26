const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel) => (callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('cadenzaHall', {
  read: () => ipcRenderer.invoke('hall:read'),
  window: (op) => ipcRenderer.invoke('hall:window', op),
  onMaximized: subscribe('hall:maximized'),
  onAppearance: subscribe('hall:appearance'),
});
