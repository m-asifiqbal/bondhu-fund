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
  savePdf: (name: string, landscape?: boolean) => ipcRenderer.invoke('file:save-pdf', name, landscape),
  importTemplate: () => ipcRenderer.invoke('import:template'),
  importPick: (opts: unknown) => ipcRenderer.invoke('import:pick', opts),
  importPreview: (token: string, opts: unknown) => ipcRenderer.invoke('import:preview', token, opts),
  importCommit: (token: string, opts: unknown) => ipcRenderer.invoke('import:commit', token, opts),
  exportMembersXlsx: () => ipcRenderer.invoke('members:export-xlsx'),
  exportStatements: (memberId: number | null, format: 'pdf' | 'xlsx') => ipcRenderer.invoke('members:export-statements', memberId, format),
});
