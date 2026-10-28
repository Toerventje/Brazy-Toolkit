// Small, safe bridge between the toolkit page and the desktop app (core/core.js answers these).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rsDesktop', {
  version: () => ipcRenderer.invoke('rs:version'),
  getExportDir: () => ipcRenderer.invoke('rs:getDir'),
  chooseExportDir: () => ipcRenderer.invoke('rs:chooseDir'),
  clearExportDir: () => ipcRenderer.invoke('rs:clearDir'),
  openExportDir: () => ipcRenderer.invoke('rs:openDir'),
  gpuInfo: () => ipcRenderer.invoke('rs:gpu'),
  onSaved: (cb) => ipcRenderer.on('rs:saved', (_e, info) => cb(info)),
  // 8.4: the app on screen (its export subfolder), export options {sub, keep}, show a saved file in Explorer
  setApp: (name) => ipcRenderer.invoke('rs:setApp', name),
  exportOpts: (o) => ipcRenderer.invoke('rs:exportOpts', o || null),
  showSaved: (p) => ipcRenderer.invoke('rs:openSaved', p),
  // updates
  pickUpdate: () => ipcRenderer.invoke('rs:pickUpdate'),
  checkOnline: () => ipcRenderer.invoke('rs:checkOnline'),
  downloadOnline: () => ipcRenderer.invoke('rs:downloadOnline'),
  // 8.0: background updates — state {phase: idle|checking|downloading|ready|installing|error|needsInstaller, version, notes, restart}
  updateState: () => ipcRenderer.invoke('rs:updateState'),
  installUpdate: () => ipcRenderer.invoke('rs:installUpdate'),
  onUpdateState: (cb) => ipcRenderer.on('rs:updateState', (_e, s) => cb(s)),
  onUpdateAvailable: (cb) => ipcRenderer.on('rs:updateAvailable', (_e, info) => cb(info)),
  onUpdateResult: (cb) => ipcRenderer.on('rs:updateResult', (_e, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('rs:updateProgress', (_e, info) => cb(info)),
  // 6.6: keep the PC awake during exports, projects opened from Windows, crash recovery, performance report
  keepAwake: (on) => ipcRenderer.invoke('rs:keepAwake', !!on),
  // 8.11.2: colour from anywhere on screen -> '#rrggbb' or null
  eyedrop: () => ipcRenderer.invoke('rs:eyedrop'),
  onOpenFile: (cb) => ipcRenderer.on('rs:openFile', (_e, f) => cb(f)),
  onCrashed: (cb) => ipcRenderer.on('rs:crashed', (_e, info) => cb(info)),
  metrics: () => ipcRenderer.invoke('rs:metrics'),
  // 7.1: automatic backups
  backupDir: () => ipcRenderer.invoke('rs:backupDir'),
  chooseBackupDir: () => ipcRenderer.invoke('rs:chooseBackupDir'),
  clearBackupDir: () => ipcRenderer.invoke('rs:clearBackupDir'),
  openBackupDir: () => ipcRenderer.invoke('rs:openBackupDir'),
  backupWrite: (name, data, keep) => ipcRenderer.invoke('rs:backupWrite', name, data, keep),
  backupList: () => ipcRenderer.invoke('rs:backupList'),
  backupRead: (name) => ipcRenderer.invoke('rs:backupRead', name),
});
