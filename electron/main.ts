import { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as store from './database';
import { buildTemplate, parseWorkbook, buildMembersExport, type ParsedWorkbook } from './excel';
import { buildStatementsXlsx, buildStatementsHtml, type StatementsData } from './statements';
import { encryptBackup, decryptBackup, decryptBackupWithMaster, deriveMasterKeys, hasMasterRecovery, isEncryptedBackup, validatePin } from './backup-crypto';
import { buildTableXlsx, buildTableHtml, buildVoucherHtml, renderPdf, type ExportDoc, type VoucherData, type Lang } from './exporter';

/** Parsed import files waiting for confirmation (token → workbook). Kept in memory only. */
const pendingImports = new Map<string, { parsed: ParsedWorkbook; fileName: string }>();

let mainWindow: BrowserWindow | null = null;
let dataDir = '';
let dbFile = '';
let backupsDir = '';

const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';

// Software rendering: this is a forms-and-tables app, and a faulty graphics driver must never leave it without a window.
app.disableHardwareAcceleration();

/** Tiny startup log (%APPDATA%/Bondhu Fund/startup.log) so a PC that cannot open the app can be diagnosed. */
function startupLog(msg: string) {
  try {
    const f = path.join(app.getPath('userData'), 'startup.log');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try { if (fs.statSync(f).size > 200_000) fs.writeFileSync(f, ''); } catch { /* new file */ }
    fs.appendFileSync(f, `${new Date().toISOString()}  ${msg}
`);
  } catch { /* logging must never break startup */ }
}
process.on('uncaughtException', err => {
  startupLog('uncaughtException: ' + (err?.stack || err));
  try { dialog.showErrorBox('Bondhu Fund', String(err?.stack || err)); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Single instance: two windows writing the same database would corrupt it.
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  // Do not quit silently: an earlier copy that is still running (even with no visible window) holds the lock.
  app.whenReady().then(() => {
    dialog.showErrorBox('Bondhu Fund is already running',
      'Another copy of Bondhu Fund is already open (it may have no visible window).\n\n' +
      'Open Task Manager, end every "Bondhu Fund" process, then start the app again.');
    app.quit();
  });
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
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
  startupLog(`start v${app.getVersion()} electron ${process.versions.electron} ${process.platform} ${process.arch} ${require('os').release()}`);
  const fallbacks = listBackups().map(b => b.filePath); // newest first, used only if main DB is unreadable
  // Start loading the database and the window at the same time (they used to run one after the other).
  dbReady = store.openDatabase(dbFile, readWasm(), fallbacks);
  registerIpc();
  Menu.setApplicationMenu(null);
  createWindow();
  try {
    await dbReady;
  } catch (e: any) {
    dialog.showErrorBox('Bondhu Fund', `The database could not be opened.\n\n${e?.message || e}`);
    app.exit(1);
    return;
  }
  // Daily snapshot after the window is up, so it never delays startup.
  setTimeout(dailyAutoBackup, 5000);
}

const UI_SCALE = 0.93;

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
  // Interface scale: everything (text, cards, radii, spacing) is 15% smaller than the default, and the layout
  // re-flows for the larger effective screen so more cards fit in a row.
  const applyScale = () => mainWindow?.webContents.setZoomFactor(UI_SCALE);
  mainWindow.webContents.on('dom-ready', applyScale);
  mainWindow.webContents.on('did-finish-load', applyScale);
  let shown = false;
  const showNow = (why: string) => {
    if (shown || !mainWindow) return;
    shown = true;
    startupLog('window shown (' + why + ')');
    mainWindow.maximize(); mainWindow.show();
  };
  mainWindow.once('ready-to-show', () => showNow('ready-to-show'));
  // Safety net: never stay invisible. If the page has not reported ready after 5 s, show the window anyway.
  setTimeout(() => showNow('timeout'), 5000);
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    startupLog(`did-fail-load ${code} ${desc} ${url}`);
    if (!isMain || code === -3) return;
    showNow('load-failed');
    dialog.showErrorBox('Bondhu Fund', `The application screen could not be loaded.

${desc} (${code})
${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    startupLog('render-process-gone ' + d.reason);
    dialog.showErrorBox('Bondhu Fund', `The application screen stopped working (${d.reason}). The app will restart.`);
    app.relaunch(); app.exit(0);
  });

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
  mainWindow.webContents.on('context-menu', (_e, params) => { void showContextMenu(params); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

/** Right-click menu: Cut / Copy / Paste / Select all in fields, Copy on selected text. Labels follow the app language. */
async function showContextMenu(params: Electron.ContextMenuParams) {
  const wc = mainWindow?.webContents;
  if (!wc) return;
  const { isEditable, selectionText, editFlags } = params;
  const hasSelection = selectionText.trim().length > 0;
  if (!isEditable && !hasSelection) return; // nothing useful to offer on plain UI
  let bn = false;
  try { bn = (await wc.executeJavaScript('document.documentElement.lang', true)) === 'bn'; } catch { /* default English */ }
  const L = (en: string, b: string) => (bn ? b : en);
  const items: Electron.MenuItemConstructorOptions[] = isEditable
    ? [
        { label: L('Undo', 'পূর্বাবস্থা'), role: 'undo', enabled: editFlags.canUndo, accelerator: 'Ctrl+Z' },
        { label: L('Redo', 'পুনরায় করুন'), role: 'redo', enabled: editFlags.canRedo, accelerator: 'Ctrl+Y' },
        { type: 'separator' },
        { label: L('Cut', 'কাটুন'), role: 'cut', enabled: editFlags.canCut, accelerator: 'Ctrl+X' },
        { label: L('Copy', 'কপি'), role: 'copy', enabled: editFlags.canCopy, accelerator: 'Ctrl+C' },
        { label: L('Paste', 'পেস্ট'), role: 'paste', enabled: editFlags.canPaste, accelerator: 'Ctrl+V' },
        { label: L('Delete', 'মুছুন'), role: 'delete', enabled: editFlags.canDelete },
        { type: 'separator' },
        { label: L('Select all', 'সব নির্বাচন'), role: 'selectAll', enabled: editFlags.canSelectAll, accelerator: 'Ctrl+A' },
      ]
    : [
        { label: L('Copy', 'কপি'), role: 'copy', accelerator: 'Ctrl+C' },
        { type: 'separator' },
        { label: L('Select all', 'সব নির্বাচন'), role: 'selectAll', accelerator: 'Ctrl+A' },
      ];
  if (mainWindow) Menu.buildFromTemplate(items).popup({ window: mainWindow });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  try { store.flush(); } catch (e) { console.error('Final save failed', e); }
});

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
type Result<T = any> = { ok: true; data: T } | { ok: false; error: string };
// The window opens while the database loads; IPC calls simply wait until it is ready.
let dbReady: Promise<void> = Promise.resolve();
const wrap = async <T>(fn: () => T | Promise<T>): Promise<Result<T>> => {
  try { await dbReady; return { ok: true, data: await fn() }; } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
};

function registerIpc() {
  ipcMain.handle('db:call', (_e, method: string, args: any[]) => wrap(() => {
    const fn = store.api[method];
    if (typeof fn !== 'function') throw new Error(`Unknown database operation: ${method}`);
    store.authorize(method, Array.isArray(args) ? args : []);   // session + role + upload permission
    return fn(...(Array.isArray(args) ? args : []));
  }));

  ipcMain.handle('app:info', () => wrap(() => {
    store.requireSession();
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

  /** Manual backup: always encrypted with the PIN the user chose (.bfbak). */
  /** Hijri date from the Aladhan service (Umm al-Qura) for an ISO date. Fails quietly when offline: the app then uses its local calendar. */
  ipcMain.handle('calendar:hijri', (_e, iso: string) => wrap(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error('Bad date.');
    const [y, m, d] = String(iso).split('-');
    const res = await net.fetch(`https://api.aladhan.com/v1/gToH/${d}-${m}-${y}?calendarMethod=UAQ`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('Calendar service unavailable.');
    const j: any = await res.json();
    const h = j?.data?.hijri;
    const day = Number(h?.day), month = Number(h?.month?.number), year = Number(h?.year);
    if (!(day >= 1 && day <= 30 && month >= 1 && month <= 12 && year > 1300 && year < 1700)) throw new Error('Unexpected calendar reply.');
    return { day, month: month - 1, year };
  }));

  ipcMain.handle('db:backup', (_e, pin: string) => wrap(async () => {
    store.requireSession();
    validatePin(pin);                                             // refuse before opening any dialog
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save encrypted database backup',
      defaultPath: path.join(app.getPath('documents'), `BondhuFund_Backup_${stamp()}.bfbak`),
      filters: [{ name: 'Bondhu Fund encrypted backup', extensions: ['bfbak'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const pub = store.getMasterRecoveryPub();
    const bytes = encryptBackup(store.exportBytes(), pin, pub ? Buffer.from(pub, 'base64') : null);
    const tmp = `${res.filePath}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, res.filePath);
    store.logBackup(path.basename(res.filePath), res.filePath, bytes.length, 'Manual');
    return { canceled: false, filePath: res.filePath, fileName: path.basename(res.filePath), fileSize: bytes.length };
  }));

  const restoreBytes = (bytes: Buffer, name: string, origin: string) => {
    const safety = snapshot('PreRestore');       // current data is always kept first
    store.replaceWith(bytes);                     // validates + migrates; throws before touching anything if invalid
    store.revalidateSession();                    // signed-in user may not exist in the restored data
    store.logBackup(name, origin, bytes.length, 'Restored');
    return { canceled: false, fileName: name, safetySnapshot: safety };
  };
  const restoreFrom = (file: string) => restoreBytes(fs.readFileSync(file), path.basename(file), file);

  // An encrypted file that was picked and now waits for its PIN (kept only in memory; never the PIN).
  let pendingRestore: { file: string; bytes: Buffer } | null = null;
  let pinFails = 0, pinLockedUntil = 0;

  ipcMain.handle('db:restore', () => wrap(async () => {
    store.requireAdmin();
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a Bondhu Fund backup to restore',
      properties: ['openFile'],
      filters: [{ name: 'Bondhu Fund backup', extensions: ['bfbak', 'db', 'sqlite', 'sqlite3'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const bytes = fs.readFileSync(res.filePaths[0]);
    if (isEncryptedBackup(bytes)) {
      pendingRestore = { file: res.filePaths[0], bytes };
      return { canceled: false, needsPin: true, fileName: path.basename(res.filePaths[0]), masterRecovery: hasMasterRecovery(bytes) && !!store.api.getSession()?.canUpload };
    }
    return restoreBytes(bytes, path.basename(res.filePaths[0]), res.filePaths[0]);   // older, unencrypted backup
  }));

  ipcMain.handle('db:restore-pin', (_e, pin: string) => wrap(() => {
    store.requireAdmin();
    if (!pendingRestore) throw new Error('Choose the backup file again.');
    if (Date.now() < pinLockedUntil) throw new Error(`Too many wrong PINs. Try again in ${Math.ceil((pinLockedUntil - Date.now()) / 1000)} seconds.`);
    let plain: Buffer;
    try {
      plain = decryptBackup(pendingRestore.bytes, String(pin ?? ''));
    } catch (e: any) {
      if (++pinFails >= 5) { pinFails = 0; pinLockedUntil = Date.now() + 60_000; }
      throw new Error(e.message);
    }
    pinFails = 0;
    const { file } = pendingRestore;
    pendingRestore = null;
    return restoreBytes(plain, path.basename(file), file);
  }));

  const requireSystem = () => { store.requireSession(); if (!(store.api.getSession() as any)?.canUpload) throw new Error('Only the iqbal_labs Super User can do this.'); };

  /** Super User: is the backup-recovery key set up? */
  ipcMain.handle('master:status', () => wrap(() => { requireSystem(); return { enabled: !!store.getMasterRecoveryPub() }; }));

  /** Super User: create (or replace) the recovery key. Needs the account password again + the master PIN. Nothing secret is stored. */
  ipcMain.handle('master:setup', (_e, password: string, masterPin: string) => wrap(() => {
    requireSystem();
    if (!store.verifySystemPassword(password)) throw new Error('Incorrect password.');
    if (typeof masterPin !== 'string' || masterPin.length < 4) throw new Error('The master PIN must be at least 4 characters.');
    store.setMasterRecoveryPub(deriveMasterKeys(masterPin, password).publicKey.toString('base64'));
    return { enabled: true };
  }));

  /** Super User: open the picked encrypted backup when its owner forgot the PIN. */
  ipcMain.handle('db:restore-master', (_e, password: string, masterPin: string) => wrap(() => {
    requireSystem();
    store.requireAdmin();
    if (!pendingRestore) throw new Error('Choose the backup file again.');
    if (Date.now() < pinLockedUntil) throw new Error(`Too many wrong attempts. Try again in ${Math.ceil((pinLockedUntil - Date.now()) / 1000)} seconds.`);
    if (!store.verifySystemPassword(password)) { if (++pinFails >= 5) { pinFails = 0; pinLockedUntil = Date.now() + 60_000; } throw new Error('Incorrect password.'); }
    let plain: Buffer;
    try {
      plain = decryptBackupWithMaster(pendingRestore.bytes, masterPin, password);
    } catch (e: any) {
      if (++pinFails >= 5) { pinFails = 0; pinLockedUntil = Date.now() + 60_000; }
      throw new Error(e.message);
    }
    pinFails = 0;
    const { file } = pendingRestore;
    pendingRestore = null;
    return restoreBytes(plain, path.basename(file), file);
  }));

  ipcMain.handle('db:restore-cancel', () => { pendingRestore = null; return { ok: true, data: null }; });

  ipcMain.handle('db:restore-snapshot', (_e, fileName: string) => wrap(() => {
    store.requireAdmin();
    const file = path.join(backupsDir, path.basename(String(fileName))); // basename: no path traversal
    if (!fs.existsSync(file)) throw new Error('Snapshot not found.');
    return restoreFrom(file);
  }));

  ipcMain.handle('db:snapshots', () => wrap(() => { store.requireSession(); return listBackups(); }));
  ipcMain.handle('db:snapshot-now', () => wrap(() => { store.requireSession(); return path.basename(snapshot('Manual')); }));
  ipcMain.handle('app:open-backups-folder', () => wrap(() => shell.openPath(backupsDir)));

  /** Native "Save as" for reports (CSV / HTML / JSON text). */
  ipcMain.handle('file:save-text', (_e, defaultName: string, content: string, filters?: Electron.FileFilter[]) => wrap(async () => {
    store.requireSession();
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
  // ---- Excel: member import template / import / export ------------------------------------
  ipcMain.handle('import:template', () => wrap(async () => {
    store.requireUpload();
    const s = store.api.getAppSettings();
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save member import template',
      defaultPath: path.join(app.getPath('documents'), 'BondhuFund_Member_Import_Template.xlsx'),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const now = new Date();
    const buf = await buildTemplate({
      orgName: s.organization_name, defaultDue: s.default_monthly_due, dueDay: s.monthly_due_day,
      currentMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    });
    fs.writeFileSync(res.filePath, buf);
    shell.openPath(res.filePath);
    return { canceled: false, filePath: res.filePath };
  }));

  ipcMain.handle('import:pick', (_e, opts: store.ImportOptions) => wrap(async () => {
    store.requireUpload();
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose the filled member workbook',
      properties: ['openFile'],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const file = res.filePaths[0];
    if (fs.statSync(file).size > 25 * 1024 * 1024) throw new Error('The file is larger than 25 MB.');
    const parsed = await parseWorkbook(fs.readFileSync(file));
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingImports.clear();                       // only one import in flight
    pendingImports.set(token, { parsed, fileName: path.basename(file) });
    return { canceled: false, token, fileName: path.basename(file), preview: store.previewMemberImport(parsed, opts) };
  }));

  ipcMain.handle('import:preview', (_e, token: string, opts: store.ImportOptions) => wrap(() => {
    store.requireUpload();
    const p = pendingImports.get(token);
    if (!p) throw new Error('The import session expired. Please choose the file again.');
    return store.previewMemberImport(p.parsed, opts);
  }));

  ipcMain.handle('import:commit', (_e, token: string, opts: store.ImportOptions) => wrap(() => {
    store.requireUpload();
    const p = pendingImports.get(token);
    if (!p) throw new Error('The import session expired. Please choose the file again.');
    snapshot('PreImport');                        // undo point: restore this snapshot to roll back an import
    const result = store.commitMemberImport(p.parsed, opts);
    pendingImports.delete(token);
    return result;
  }));

  ipcMain.handle('members:export-xlsx', () => wrap(async () => {
    store.requireSession();
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export members to Excel',
      defaultPath: path.join(app.getPath('documents'), `BondhuFund_Members_${new Date().toISOString().slice(0, 10)}.xlsx`),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const d = store.exportMembersData();
    fs.writeFileSync(res.filePath, await buildMembersExport(d.members, d.payments, d.months));
    shell.openPath(res.filePath);
    return { canceled: false, filePath: res.filePath };
  }));

  // ---- Shared export helpers: operator (signed-in user), save dialog -------------------------------
  const operator = (lang?: string) => {
    const sess: any = store.api.getSession();
    const bn = lang === 'bn' && sess?.user?.full_name_bn;
    return { name: String(bn || sess?.user?.full_name || sess?.user?.username || 'N/A'), role: String(sess?.user?.role || 'N/A') };
  };
  const pickFile = async (title: string, defaultName: string, ext: 'pdf' | 'xlsx') => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title, defaultPath: path.join(app.getPath('documents'), path.basename(defaultName)),
      filters: [ext === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    return res.canceled || !res.filePath ? null : res.filePath;
  };
  const safeName = (v: string) => String(v).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

  /** Member statement(s) as PDF or Excel. memberId = one member; null = every member. */
  ipcMain.handle('members:export-statements', (_e, memberId: number | null, format: 'pdf' | 'xlsx', lang?: Lang) => wrap(async () => {
    store.requireSession();
    const data = store.getStatementsData(memberId ? [Number(memberId)] : undefined) as unknown as StatementsData;
    if (!data.statements.length) throw new Error('There are no members to export.');
    const ext = format === 'xlsx' ? 'xlsx' : 'pdf';
    const day = new Date().toISOString().slice(0, 10);
    const one = data.statements.length === 1 ? data.statements[0].member : null;
    const name = one ? `Statement_${one.member_code}_${safeName(one.name) || 'member'}_${day}.${ext}` : `BondhuFund_All_Statements_${day}.${ext}`;
    const file = await pickFile(one ? 'Save member statement' : 'Save all member statements', name, ext);
    if (!file) return { canceled: true };
    const op = operator(lang);
    if (ext === 'xlsx') fs.writeFileSync(file, await buildStatementsXlsx(data, op, lang || 'en'));
    else fs.writeFileSync(file, await renderPdf(buildStatementsHtml(data, op, lang || 'en'), true));
    shell.openPath(file);
    return { canceled: false, filePath: file, count: data.statements.length };
  }));

  /** Any report / list: the renderer sends a plain document description; this makes the styled PDF or Excel file. */
  ipcMain.handle('export:table', (_e, doc: ExportDoc, format: 'pdf' | 'xlsx', fileName: string) => wrap(async () => {
    store.requireSession();
    if (!doc || !Array.isArray(doc.sections)) throw new Error('Nothing to export.');
    const ext = format === 'xlsx' ? 'xlsx' : 'pdf';
    const file = await pickFile('Save ' + (ext === 'pdf' ? 'PDF' : 'Excel file'), `${safeName(fileName || 'BondhuFund_Report') || 'BondhuFund_Report'}.${ext}`, ext);
    if (!file) return { canceled: true };
    const op = operator(doc.lang);
    if (ext === 'xlsx') fs.writeFileSync(file, await buildTableXlsx(doc, op));
    else fs.writeFileSync(file, await renderPdf(buildTableHtml(doc, op), !!doc.landscape));
    shell.openPath(file);
    return { canceled: false, filePath: file };
  }));

  /** Payment voucher as a proper PDF with authorized + receiver signatures. */
  ipcMain.handle('export:voucher', (_e, v: VoucherData) => wrap(async () => {
    store.requireSession();
    const file = await pickFile('Save payment voucher', `Voucher_${safeName(v.member_code || 'member')}_${safeName(v.payment_month || '')}.pdf`, 'pdf');
    if (!file) return { canceled: true };
    fs.writeFileSync(file, await renderPdf(buildVoucherHtml(v, operator(v.lang)), false));
    shell.openPath(file);
    return { canceled: false, filePath: file };
  }));

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
