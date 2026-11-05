import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getWasmBinary: () => ipcRenderer.invoke('app:get-wasm-binary'),
  loadDatabase: () => ipcRenderer.invoke('db:load'),
  saveDatabase: (bytes: Uint8Array) => ipcRenderer.invoke('db:save', bytes),
  getDatabaseInfo: () => ipcRenderer.invoke('db:get-info'),
  backupDatabase: (currentBytes?: Uint8Array) => ipcRenderer.invoke('db:backup', currentBytes),
  restoreDatabase: () => ipcRenderer.invoke('db:restore'),
  getSafetyBackups: () => ipcRenderer.invoke('db:get-safety-backups'),
});

