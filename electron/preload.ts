import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('db:call', method, args),
  appInfo: () => ipcRenderer.invoke('app:info'),
  backup: () => ipcRenderer.invoke('db:backup'),
  restore: () => ipcRenderer.invoke('db:restore'),
  restoreSnapshot: (fileName: string) => ipcRenderer.invoke('db:restore-snapshot', fileName),
  listSnapshots: () => ipcRenderer.invoke('db:snapshots'),
  snapshotNow: () => ipcRenderer.invoke('db:snapshot-now'),
  openBackupsFolder: () => ipcRenderer.invoke('app:open-backups-folder'),
  saveText: (name: string, content: string, filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('file:save-text', name, content, filters),
  savePdf: (name: string) => ipcRenderer.invoke('file:save-pdf', name),
});
