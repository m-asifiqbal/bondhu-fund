import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let userDataDir = '';
let activeDbPath = '';
let backupsDir = '';

function initPaths() {
  userDataDir = path.join(app.getPath('userData'), 'database');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  activeDbPath = path.join(userDataDir, 'bondhu_fund.db');
  backupsDir = path.join(userDataDir, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#eef6f3',
    title: 'Bondhu Fund - Union Finance Desk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Remove default menu bar for clean modern desktop feel
  mainWindow.setMenuBarVisibility(false);

  // Check if explicitly running in development mode with dev server
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  initPaths();
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for SQLite persistence and backup/restore
function setupIpcHandlers() {
  // Read sql-wasm.wasm binary directly via Node.js fs to bypass Chromium file:// fetch restrictions
  ipcMain.handle('app:get-wasm-binary', async () => {
    try {
      const candidatePaths = [
        path.join(__dirname, '../dist/sql-wasm.wasm'),
        path.join(__dirname, 'sql-wasm.wasm'),
        path.join(app.getAppPath(), 'dist/sql-wasm.wasm'),
        path.join(app.getAppPath(), 'public/sql-wasm.wasm'),
        path.join(process.resourcesPath || '', 'sql-wasm.wasm'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked/dist/sql-wasm.wasm'),
        path.join(__dirname, '../../public/sql-wasm.wasm'),
      ];
      for (const p of candidatePaths) {
        if (p && fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          return new Uint8Array(buf);
        }
      }
      // Fallback to node_modules if present
      const nmPath = path.join(app.getAppPath(), 'node_modules/sql.js/dist/sql-wasm.wasm');
      if (fs.existsSync(nmPath)) {
        return new Uint8Array(fs.readFileSync(nmPath));
      }
      console.warn('sql-wasm.wasm not found in candidate paths');
      return null;
    } catch (err: any) {
      console.error('Error reading sql-wasm.wasm in main:', err);
      return null;
    }
  });

  // Load active database binary
  ipcMain.handle('db:load', async () => {
    try {
      if (activeDbPath && fs.existsSync(activeDbPath)) {
        const buffer = fs.readFileSync(activeDbPath);
        return new Uint8Array(buffer);
      }
      return null;
    } catch (err: any) {
      console.error('Error loading active DB:', err);
      return null;
    }
  });

  // Save active database binary atomically
  ipcMain.handle('db:save', async (_, uint8Array: Uint8Array) => {
    try {
      if (!activeDbPath) initPaths();
      const tempPath = activeDbPath + '.tmp';
      fs.writeFileSync(tempPath, Buffer.from(uint8Array));
      fs.renameSync(tempPath, activeDbPath);
      return { success: true };
    } catch (err: any) {
      console.error('Error saving DB:', err);
      return { success: false, error: err.message };
    }
  });

  // Get active database info
  ipcMain.handle('db:get-info', async () => {
    try {
      if (!activeDbPath) initPaths();
      if (fs.existsSync(activeDbPath)) {
        const stats = fs.statSync(activeDbPath);
        return {
          exists: true,
          path: activeDbPath,
          sizeKb: (stats.size / 1024).toFixed(2),
          lastModified: stats.mtime.toLocaleString(),
        };
      }
      return {
        exists: false,
        path: activeDbPath,
        sizeKb: '0.00',
        lastModified: 'Never',
      };
    } catch (err: any) {
      return { exists: false, error: err.message };
    }
  });

  // Backup database: Native Windows Save File Dialog
  ipcMain.handle('db:backup', async (_, currentBytes?: Uint8Array) => {
    if (!mainWindow) return { canceled: true };

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultFilename = `BondhuFund_Backup_${dateStr}.db`;

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Database Backup',
      defaultPath: path.join(app.getPath('documents'), defaultFilename),
      filters: [
        { name: 'SQLite Database (*.db)', extensions: ['db'] },
        { name: 'All Files (*.*)', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    try {
      // If current in-memory bytes are provided, write them; otherwise copy active file
      if (currentBytes && currentBytes.length > 0) {
        fs.writeFileSync(result.filePath, Buffer.from(currentBytes));
      } else if (fs.existsSync(activeDbPath)) {
        fs.copyFileSync(activeDbPath, result.filePath);
      } else {
        return { success: false, error: 'No active database file to backup.' };
      }

      const stats = fs.statSync(result.filePath);
      return {
        success: true,
        canceled: false,
        filePath: result.filePath,
        fileName: path.basename(result.filePath),
        fileSize: stats.size,
        date: new Date().toISOString(),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Restore database: Native Windows Open File Dialog with validation & auto-rollback snapshot
  ipcMain.handle('db:restore', async () => {
    if (!mainWindow) return { canceled: true };

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Backup Database to Restore',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite Database (*.db, *.sqlite)', extensions: ['db', 'sqlite'] },
        { name: 'All Files (*.*)', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const selectedFile = result.filePaths[0];

    try {
      const buffer = fs.readFileSync(selectedFile);

      // Verify SQLite header: first 16 bytes must start with "SQLite format 3\0"
      const header = buffer.slice(0, 15).toString('ascii');
      if (!header.startsWith('SQLite format 3')) {
        return {
          success: false,
          error: 'The selected file is not a valid SQLite database file (corrupted or unrecognized header).',
        };
      }

      // 1. Take a safety rollback snapshot of the current active database before overwriting
      if (activeDbPath && fs.existsSync(activeDbPath)) {
        const rollbackFilename = `Safety_Snapshot_PreRestore_${Date.now()}.db`;
        fs.copyFileSync(activeDbPath, path.join(backupsDir, rollbackFilename));
      }

      // 2. Overwrite active database file with restored file
      fs.writeFileSync(activeDbPath, buffer);

      return {
        success: true,
        canceled: false,
        fileName: path.basename(selectedFile),
        data: new Uint8Array(buffer),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get list of automated safety backups
  ipcMain.handle('db:get-safety-backups', async () => {
    try {
      if (!backupsDir || !fs.existsSync(backupsDir)) return [];
      const files = fs.readdirSync(backupsDir);
      return files
        .filter(f => f.endsWith('.db'))
        .map(f => {
          const filePath = path.join(backupsDir, f);
          const stats = fs.statSync(filePath);
          return {
            fileName: f,
            filePath,
            sizeKb: (stats.size / 1024).toFixed(2),
            createdAt: stats.mtime.toLocaleString(),
          };
        });
    } catch (err: any) {
      return [];
    }
  });
}
