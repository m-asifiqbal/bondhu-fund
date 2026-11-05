import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as store from './database';

let mainWindow: BrowserWindow | null = null;
let dataDir = '';
let dbFile = '';
let backupsDir = '';

const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';

// ---------------------------------------------------------------------------
// Single instance: two windows writing the same database would corrupt it.
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(start).catch(err => {
    dialog.showErrorBox('Bondhu Fund failed to start', String(err?.stack || err));
    app.exit(1);
  });
}

// One fixed data folder for dev and installed builds: %APPDATA%\Bondhu Fund
app.setName('Bondhu Fund');
app.commandLine.appendSwitch('lang', 'en-GB'); // dd/mm/yyyy date inputs
app.setPath('userData', path.join(app.getPath('appData'), 'Bondhu Fund'));

function initPaths() {
  dataDir = path.join(app.getPath('userData'), 'database');
  backupsDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  dbFile = path.join(dataDir, 'bondhu_fund.db');

  // First run of v2: carry over data from the prototype's folder (it is migrated on open).
  const legacy = path.join(app.getPath('appData'), 'bondhu-fund-desktop', 'database', 'bondhu_fund.db');
  if (!fs.existsSync(dbFile) && fs.existsSync(legacy)) {
    fs.copyFileSync(legacy, dbFile);
    fs.copyFileSync(legacy, path.join(backupsDir, `Legacy_v1_${new Date().toISOString().slice(0, 10)}.db`));
  }
}

function readWasm(): Buffer {
  const candidates = [
    path.join(process.resourcesPath || '', 'sql-wasm.wasm'),
    path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(__dirname, '../public/sql-wasm.wasm'),
  ];
  try { candidates.push(require.resolve('sql.js/dist/sql-wasm.wasm')); } catch { /* not resolvable */ }
  for (const p of candidates) if (p && fs.existsSync(p)) return fs.readFileSync(p);
  throw new Error('sql-wasm.wasm not found. Reinstall the application.');
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function listBackups(prefix?: string) {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter(f => f.endsWith('.db') && (!prefix || f.startsWith(prefix)))
    .map(f => {
      const p = path.join(backupsDir, f);
      const st = fs.statSync(p);
      return { fileName: f, filePath: p, size: st.size, sizeKb: (st.size / 1024).toFixed(1), createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function prune(prefix: string, keep: number) {
  for (const b of listBackups(prefix).slice(keep)) {
    try { fs.unlinkSync(b.filePath); } catch { /* ignore */ }
  }
}

/** One automatic snapshot per day, rotated. */
function dailyAutoBackup() {
  try {
    const s = store.api.getAppSettings();
    if (!s.auto_backup_enabled) return;
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(backupsDir, `Auto_${today}.db`);
    if (fs.existsSync(file)) return;
    const bytes = store.exportBytes();
    fs.writeFileSync(file, bytes);
    store.logBackup(path.basename(file), file, bytes.length, 'Automatic');
    prune('Auto_', s.auto_backup_keep || 14);
  } catch (e) {
    console.error('Auto backup failed', e);
  }
}

function snapshot(prefix: string) {
  const bytes = store.exportBytes();
  const file = path.join(backupsDir, `${prefix}_${stamp()}.db`);
  fs.writeFileSync(file, bytes);
  store.logBackup(path.basename(file), file, bytes.length, prefix === 'PreRestore' ? 'Pre-Restore' : 'Automatic');
  prune(`${prefix}_`, 10);
  return file;
}

async function start() {
  initPaths();
  const fallbacks = listBackups().map(b => b.filePath); // newest first, used only if main DB is unreadable
  await store.openDatabase(dbFile, readWasm(), fallbacks);
  dailyAutoBackup();
  registerIpc();
  Menu.setApplicationMenu(null);
  createWindow();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#f4f7f6',
    title: 'Bondhu Fund',
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => { mainWindow?.maximize(); mainWindow?.show(); });

  if (isDev) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));

  // Never navigate away or open new windows inside the app; send links to the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Allow reloading the app itself (error screen "Reload"); block navigation anywhere else.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const own = url.split('#')[0] === mainWindow?.webContents.getURL().split('#')[0];
    if (!own) e.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  try { store.flush(); } catch (e) { console.error('Final save failed', e); }
});

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
type Result<T = any> = { ok: true; data: T } | { ok: false; error: string };
const wrap = async <T>(fn: () => T | Promise<T>): Promise<Result<T>> => {
  try { return { ok: true, data: await fn() }; } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
};

function registerIpc() {
  ipcMain.handle('db:call', (_e, method: string, args: any[]) => wrap(() => {
    const fn = store.api[method];
    if (typeof fn !== 'function') throw new Error(`Unknown database operation: ${method}`);
    return fn(...(Array.isArray(args) ? args : []));
  }));

  ipcMain.handle('app:info', () => wrap(() => {
    const st = fs.existsSync(dbFile) ? fs.statSync(dbFile) : null;
    return {
      version: app.getVersion(),
      dbPath: dbFile,
      backupsDir,
      sizeKb: st ? (st.size / 1024).toFixed(1) : '0',
      lastModified: st ? st.mtime.toISOString() : null,
      ...store.api.getDatabaseStats(),
    };
  }));

  ipcMain.handle('db:backup', () => wrap(async () => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save database backup',
      defaultPath: path.join(app.getPath('documents'), `BondhuFund_Backup_${stamp()}.db`),
      filters: [{ name: 'Bondhu Fund backup', extensions: ['db'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const bytes = store.exportBytes();
    const tmp = `${res.filePath}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, res.filePath);
    store.logBackup(path.basename(res.filePath), res.filePath, bytes.length, 'Manual');
    return { canceled: false, filePath: res.filePath, fileName: path.basename(res.filePath), fileSize: bytes.length };
  }));

  const restoreFrom = (file: string) => {
    const bytes = fs.readFileSync(file);
    const safety = snapshot('PreRestore');       // current data is always kept first
    store.replaceWith(bytes);                     // validates + migrates; throws before touching anything if invalid
    store.logBackup(path.basename(file), file, bytes.length, 'Restored');
    return { canceled: false, fileName: path.basename(file), safetySnapshot: safety };
  };

  ipcMain.handle('db:restore', () => wrap(async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a Bondhu Fund backup to restore',
      properties: ['openFile'],
      filters: [{ name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    return restoreFrom(res.filePaths[0]);
  }));

  ipcMain.handle('db:restore-snapshot', (_e, fileName: string) => wrap(() => {
    const file = path.join(backupsDir, path.basename(String(fileName))); // basename: no path traversal
    if (!fs.existsSync(file)) throw new Error('Snapshot not found.');
    return restoreFrom(file);
  }));

  ipcMain.handle('db:snapshots', () => wrap(() => listBackups()));
  ipcMain.handle('db:snapshot-now', () => wrap(() => path.basename(snapshot('Manual'))));
  ipcMain.handle('app:open-backups-folder', () => wrap(() => shell.openPath(backupsDir)));

  /** Native "Save as" for reports (CSV / HTML / JSON text). */
  ipcMain.handle('file:save-text', (_e, defaultName: string, content: string, filters?: Electron.FileFilter[]) => wrap(async () => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save report',
      defaultPath: path.join(app.getPath('documents'), path.basename(String(defaultName || 'report.csv'))),
      filters: filters?.length ? filters : [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    // BOM so Excel opens UTF-8 (Bangla) correctly
    fs.writeFileSync(res.filePath, (res.filePath.endsWith('.csv') ? 'ï»¿' : '') + String(content ?? ''), 'utf8');
    return { canceled: false, filePath: res.filePath };
  }));

  /** Print-quality PDF of the current window (reports). */
  ipcMain.handle('file:save-pdf', (_e, defaultName: string, landscape?: boolean) => wrap(async () => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save PDF',
      defaultPath: path.join(app.getPath('documents'), path.basename(String(defaultName || 'report.pdf'))),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const pdf = await mainWindow!.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: !!landscape, margins: { marginType: 'default' } });
    fs.writeFileSync(res.filePath, pdf);
    shell.openPath(res.filePath);
    return { canceled: false, filePath: res.filePath };
  }));
}
