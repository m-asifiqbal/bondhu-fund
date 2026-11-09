/**
 * Bundles the Electron main process (and its dependencies: sql.js, exceljs) into single files in dist-electron/,
 * so the packaged app ships no node_modules (~65 MB less to unpack on every launch).
 * Type checking is done separately by `tsc -p tsconfig.electron.json --noEmit`.
 */
const path = require('path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');

esbuild.buildSync({
  absWorkingDir: root,
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/database.ts', 'electron/excel.ts', 'electron/backup-crypto.ts', 'electron/loans.ts'],
  outdir: 'dist-electron',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('electron bundle ready');
