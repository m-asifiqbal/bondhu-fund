/**
 * Bundles the Electron main process (and its dependencies: sql.js, exceljs) into single files in dist-electron/,
 * so the packaged app ships no node_modules (~65 MB less to unpack on every launch).
 * Type checking is done separately by `tsc -p tsconfig.electron.json --noEmit`.
 */
const path = require('path');
const esbuild = require('esbuild');
const fs = require('fs');
const root = path.resolve(__dirname, '..');

// Google sign-in credentials (a "Desktop app" OAuth client in the same Google Cloud project as FocusFlow). They are read from config/google.json,
// which is git-ignored, and compiled into the main-process bundle. Without the file the app still works; Google sync then asks the Super User to paste them in.
let define = {};
try {
  const g = JSON.parse(fs.readFileSync(path.join(root, 'config', 'google.json'), 'utf8'));
  if (g.GOOGLE_DESKTOP_CLIENT_ID && g.GOOGLE_DESKTOP_CLIENT_SECRET) {
    define = { 'process.env.BF_GOOGLE_CLIENT_ID_BUILT': JSON.stringify(g.GOOGLE_DESKTOP_CLIENT_ID), 'process.env.BF_GOOGLE_CLIENT_SECRET_BUILT': JSON.stringify(g.GOOGLE_DESKTOP_CLIENT_SECRET) };
    console.log('Google client credentials found in config/google.json');
  }
} catch { /* no credentials in this build */ }

// Licence server (Supabase project). config/supabase.json is git-ignored. LICENSE_ENFORCE must be true for a build to lock unlicensed copies;
// with false (or without the file) every copy works and only the iqbal_labs panel is available.
try {
  const sb = JSON.parse(fs.readFileSync(process.env.BF_SUPABASE_CONFIG || path.join(root, 'config', 'supabase.json'), 'utf8'));
  if (sb.SUPABASE_URL && sb.SUPABASE_PUBLISHABLE_KEY) {
    define['process.env.BF_SUPABASE_URL_BUILT'] = JSON.stringify(sb.SUPABASE_URL);
    define['process.env.BF_SUPABASE_KEY_BUILT'] = JSON.stringify(sb.SUPABASE_PUBLISHABLE_KEY);
    define['process.env.BF_LICENSE_ENFORCE_BUILT'] = JSON.stringify(sb.LICENSE_ENFORCE === true ? '1' : '');
    console.log(`Licence server found in config/supabase.json (enforcement ${sb.LICENSE_ENFORCE === true ? 'ON' : 'off'})`);
  }
} catch { /* no licence server in this build */ }

esbuild.buildSync({
  absWorkingDir: root,
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/database.ts', 'electron/excel.ts', 'electron/backup-crypto.ts', 'electron/loans.ts', 'electron/google.ts', 'electron/gsync.ts', 'electron/google-main.ts', 'electron/license.ts', 'electron/license-main.ts'],
  outdir: process.env.BF_OUTDIR || 'dist-electron',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  legalComments: 'none',
  define,
  logLevel: 'warning',
});
console.log('electron bundle ready');
