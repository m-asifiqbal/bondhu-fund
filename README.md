# Bondhu Fund - Union Finance Desk (Windows Desktop Application)

A modern, standalone, offline Windows Desktop Application for **Bondhu Fund (Union Finance Desk)** built to replicate the UX/UI reference design with pixel-level precision.

Powered by a **pure local SQLite database**, requiring **zero web servers, zero cloud storage, and zero XAMPP/WAMP services**.

---

## 🚀 Key Features

1. **Pure Desktop Application (Zero Server/Cloud)**:
   - Self-contained Windows Desktop Application built with **Electron + React + TypeScript + Tailwind CSS + Lucide Icons + Recharts**.
   - Runs offline on Windows with native framing, native dialogs, and smooth hardware-accelerated animations.

2. **Local SQLite Database Engine**:
   - Stores all members, collections, investments, expenses, users, and audit logs locally in standard SQLite `.db` binary format.
   - Auto-seeded with the exact dataset visible in the 5 design mockups (48 members, June 2024 collection ledger, TK 1,284,600 total fund balance, 4 active investments).

3. **Native Windows Database Backup & Restore**:
   - **One-Click Backup**: Opens native Windows `Save File Dialog` to export timestamped `.db` backups to any disk, folder, or USB drive.
   - **One-Click Restore**: Opens native Windows `Open File Dialog` with automatic SQLite header verification, auto-creates a safety rollback snapshot of the active database before overwriting, and hot-swaps the application state instantly without restarting.
   - **Safety Snapshot History**: Full audit trail of past backups and automatic pre-restore snapshots.

4. **1:1 Visual Fidelity Matching the 5 Reference Screens**:
   - **Overview Dashboard**: 4 KPI cards, Fund growth area chart (6m/12m toggle), Collection status donut chart, Needs attention actionable alerts, Recent activity timeline.
   - **Members Directory**: Summary stats (48 total, 42 paid, 3 pending, 3 overdue), search and status filter bar, member table with avatars, member IDs (`BF-0012`), status pills, and "+ Add member" modal.
   - **Collections & Ledger**: Expected vs. collected KPI cards, late fees tracker, status tabs (`All 48`, `Paid 42`, `Pending 3`, `Overdue 3`), collection progress bar, and late payment rule callout (`TK 300` fine).
   - **Investment Portfolio**: Total invested vs. current valuation, unrealized gain (+TK 156,000), portfolio allocation stacked bar, return snapshot grouped bar chart, active investments table, and committee review alert.
   - **Entry Center ("Add a fund entry")**: Tabbed entry switcher (`Money received`, `Expense`, `Investment`), live right-side **Entry Summary** preview card with instant calculations, and audit tips.

5. **Additional User-Requested Screens & Reports Center**:
   - **Reports & Data Export Center**: Download formatted CSV reports with filters:
     - **Day-wise**: Collections & expenses filtered by specific calendar date.
     - **Month-wise**: Full monthly ledger with dues, payments, penalties, and expenses.
     - **Fiscal Year-wise**: Annual financial statement with member totals and asset valuations.
     - **Member-wise**: Complete lifetime payment statement for any selected member.
     - **Operating Expenses**: Categorized expense breakdown with receipt verification audit status.
     - **Investment Portfolio**: Property valuation and unrealized capital gain summary.
     - **Master System Dump**: Comprehensive multi-section CSV audit export.
   - **System User Creation & Roles**: Create and manage treasurers, administrators, auditors, and managers with avatar badges and quick user switching.
   - **Operating Expenses Ledger**: Track union expenditures, categorized operational costs, and verify receipt vouchers.
   - **Master Data Configuration**: Easily add/edit/delete custom **Expense Types**, **Investment Sectors**, **Payment Methods**, and **Fund Rules**.
   - **System Settings**: Union profile name, currency symbol (`TK`), default dues, due dates, penalty configurations, and direct database backup buttons.

---

## 📦 Windows Standalone Installer (.exe)

The application includes a self-contained Windows NSIS installer that can be deployed on any Windows PC without needing Node.js or any runtime dependencies:

- **Installer Location**:
  `release\Bondhu Fund Setup 1.0.0.exe` (~93.5 MB)
- **Portable Unpacked Folder**:
  `release\win-unpacked\Bondhu Fund.exe`

### How to Build the Installer:
```bash
npm run dist        # Builds release\Bondhu Fund Setup 1.0.0.exe
npm run dist:dir    # Builds release\win-unpacked\ (portable folder)
```

---

## 🛠️ How to Run the Application

### 1. Launch the Desktop App:
```bash
npm start
```
This launches the native Electron Windows application immediately loading the compiled application and local SQLite database.

### 2. Run in Development Mode (Live HMR):
```bash
npm run electron:dev
```
This runs the Vite live development server concurrently with the Electron desktop window for instant live reload.

### 3. Rebuild Application:
```bash
npm run build           # Compiles frontend assets with Vite
npm run build:electron  # Compiles Electron main & preload scripts
```

---

## 📂 Local SQLite Database Storage

The active SQLite database file is stored locally on your machine at:
- `%APPDATA%\bondhu-fund-desktop\database\bondhu_fund.db`

Backups and safety rollback snapshots are stored in:
- `%APPDATA%\bondhu-fund-desktop\database\backups\`

You can also backup and save `.db` files to any folder or external USB drive using the in-app **Backup & Restore** screen.

