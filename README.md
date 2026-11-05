# Bondhu Fund — Desktop

Offline Windows app for running a members' savings fund: monthly dues, late fees, expenses,
investments, reports and backups. No server, no internet, no database install.

## Install (end users)
- **Installer:** `release/BondhuFund-Setup-2.0.0.exe`. Installs per-user (no admin rights needed) and creates desktop and Start-menu shortcuts.
- **Portable:** `release/BondhuFund-Portable-2.0.0.exe`. Runs without installing, for example from a USB drive.
- Windows 10/11, 64-bit.
- A new install starts empty. You can then add members, restore a backup (**Backup & Restore → Restore from file**), or load demo data.
- Uninstalling keeps your data.

## Your data
| What | Where |
|---|---|
| Live database | `%APPDATA%\Bondhu Fund\database\bondhu_fund.db` |
| Daily automatic backups (14 kept) | `%APPDATA%\Bondhu Fund\database\backups\Auto_*.db` |
| Snapshot taken before every restore | `...\backups\PreRestore_*.db` |

- Restoring checks the file first and never touches your current data if the file is invalid.
- Backups from older versions, including the prototype, are upgraded automatically when restored.
- Keep a manual backup on a USB drive or cloud folder as well.

## Develop
```bash
npm install
npm run electron:dev   # Vite + Electron with live reload
npm run typecheck      # renderer + main process
npm run dist           # builds release/ installer + portable exe
```
If Electron opens as plain Node, clear the variable: `set ELECTRON_RUN_AS_NODE=`.

Architecture, data rules and the full API are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
