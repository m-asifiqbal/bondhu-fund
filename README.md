<div align="center">

<img src="build/icon.png" width="96" alt="Bondhu Fund logo" />

# Bondhu Fund

**An offline Windows desktop app for running a members' savings fund**:
monthly dues, late fees, expenses, investments, reports and backups. Fully bilingual (English / বাংলা).

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0f4a3c)
![Electron](https://img.shields.io/badge/Electron-35-47848f)
![React](https://img.shields.io/badge/React-18-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![SQLite](https://img.shields.io/badge/SQLite-sql.js%20(WASM)-003b57)
![Offline](https://img.shields.io/badge/works-100%25%20offline-2fb36b)

[Download](#-download--install) · [Features](#-features) · [Screenshots](#-screenshots) · [Architecture](#-architecture) · [Database](#-database) · [Development](#-development-setup) · [Adding a feature](#-adding-a-feature)

<img src="docs/screenshots/01-overview.png" alt="Overview dashboard" width="900" />

</div>

---

## Contents
1. [Documentation](#-documentation)
2. [Download & install](#-download--install)
3. [Features](#-features)
4. [Screenshots](#-screenshots)
5. [Architecture](#-architecture)
6. [Database](#-database)
7. [Project structure](#-project-structure)
8. [Development setup](#-development-setup)
9. [Adding a feature](#-adding-a-feature) (step-by-step recipe)
10. [Testing](#-testing)
11. [Building & releasing](#-building--releasing)
12. [Data, backups & recovery](#-data-backups--recovery)
13. [Troubleshooting](#-troubleshooting)
14. [Roadmap](#-roadmap)

---

## 📚 Documentation

| Document | What it covers |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | what changed in every version |
| [docs/LICENSING.md](docs/LICENSING.md) | the licence system: PINs, monthly payments, remote lock, **offline rules and the offline counter**, clock tricks, the vendor panel, the Supabase tables |
| [docs/license_setup.md](docs/license_setup.md) | one-time Supabase setup for licensing |
| [docs/GOOGLE_SYNC.md](docs/GOOGLE_SYNC.md) | Google account sync and Drive backup: the premium switch, restoring on a new PC, retention of 10, retry after 10 s, conflicts |
| [docs/google_setup.md](docs/google_setup.md) | one-time Google Cloud setup (Desktop client, consent screen) |
| [docs/LOANS.md](docs/LOANS.md) | personal loans: lifecycle, interest maths, the **lending policy**, exceptions, deletions, portfolio quality, what is not built yet |
| [docs/ENTRY_RULES.md](docs/ENTRY_RULES.md) | exactly what the program accepts and refuses when money, dates and lists are entered |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | how speed is measured, the numbers, what was changed, what is still open |
| [docs/TESTING.md](docs/TESTING.md) | every test suite, the password variables, the fake servers, the benchmark, testing the real app |
| [docs/AUDIT_2026-11.md](docs/AUDIT_2026-11.md) | the November 2026 audit: findings, fixes, open items |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/UI_GUIDE.md](docs/UI_GUIDE.md) · [docs/RELEASE.md](docs/RELEASE.md) | architecture and data contract, UI conventions, building and releasing |

---

## 📦 Download & install

Get the latest files from **[Releases](https://github.com/m-asifiqbal/bondhu-fund/releases/latest)**:

| File | Use it when |
|---|---|
| `BondhuFund-Setup-<version>.exe` | **Recommended.** Installs for the current Windows user. No admin rights needed. Creates desktop and Start-menu shortcuts. |
| `BondhuFund-Portable-<version>.exe` | You want to run it without installing, for example from a USB drive. |

- **Pre-releases:** versions marked *pre-release* on the Releases page (for example `2.9.0 test 1`) are test builds; **Latest** always points to the newest finished release. A build made with licensing switched on asks non-owner accounts for an activation PIN ([docs/LICENSING.md](docs/LICENSING.md)).
- **Requirements:** Windows 10 or 11, 64-bit. No internet, server, database engine or runtime to install.
- **First start:** sign in with `admin` / `admin` (you'll be asked to set a new password). The database starts empty. Add your first member, **restore a backup** (Backup & Restore → Restore from file), or click **Explore with demo data** to look around.
- **Upgrading:** run the newer Setup file. Your data is kept, and older databases and backups are upgraded automatically.
- **Uninstalling:** your data is **kept** in `%APPDATA%\Bondhu Fund`.
- **SmartScreen warning:** Windows may show *"Windows protected your PC / Unknown publisher"* until the installer is code-signed (see [RELEASE.md](docs/RELEASE.md)). Click **More info → Run anyway**.

---

## ✨ Features

### Money & members
- **Members:** add, edit and import from CSV, with Bangla names, phone, designation, opening balance (contributions made before using the app), Active/Inactive status, and a month-by-month **statement** that includes unpaid months.
- **Dues engine:** every active member owes their monthly due from the month they joined. A month is **Paid** once a payment is recorded, **Overdue** after the due day, otherwise **Pending**. No dues have to be generated by hand.
- **Collections:** a monthly ledger with Paid/Pending/Overdue tabs, progress, a late-fee rule, record payment, void payment, and a printable or downloadable voucher.
- **Late fees:** suggested automatically when the payment date is after the due day. They can be overridden.
- **Expenses:** categories, payee, receipt or voucher reference, and **Needs receipt → Verified** workflow.
- **Investments:** sectors, cost against estimated value, review dates, **Mark as sold** with realized gain, and portfolio charts.
- **Entry Center:** one place to enter money received, expenses and investments.

### Insight
- **Overview dashboard** (Apache ECharts), in five sections:
  - Headline figures: net worth, cash in hand, collected this month, outstanding dues, portfolio value and monthly expenses, each compared with last month.
  - **Collections:** expected vs collected over 12 months, and a clickable Paid/Pending/Overdue chart.
  - **Fund growth & cash flow:** fund balance and cash in hand over time, and money in vs money out.
  - **Portfolio & spending:** cost vs value by sector, and expenses by category.
  - **Members:** a daily payment calendar, payment methods, top contributors, and an arrears list with one-click *Collect*.
  - Every chart has a **table view**, and the page exports to CSV or PDF.
- **Reports & Export** (8 reports with live preview, period presets, a column chooser, and **CSV for Excel** or **PDF**): Cash book with running balance · Monthly collection sheet · Fiscal-year statement · Member statement · Defaulters/arrears · Expenses · Investment portfolio · Audit trail.
- **Notifications:** overdue dues, investment reviews coming up, missing receipts, and backup reminders.

### Administration
- **Users & roles** (Admin, Treasurer, Auditor, Manager) with a **profile page** showing photo upload, contact details, activity statistics, a 12-month activity chart and a timeline.
- **Audit log:** every change is recorded with who made it and when.
- **Master data:** expense categories, investment sectors and payment methods, each with an English and a **Bangla name**. Renaming one updates existing records, and items that are in use can be deactivated but not deleted.
- **Settings:** organization name (English and Bangla), **logo upload** (shown in the sidebar and on printed reports), currency symbol, default due, due day, late fee, fiscal-year start month, and automatic-backup retention.
- **Backup & Restore:**
  - One-click backup to any folder or USB drive.
  - Restore with validation; a safety snapshot is taken first.
  - Daily automatic snapshots.
  - Restore any local snapshot.
  - Demo data and "clear business data" (requires typing DELETE).

### Sign-in & roles
- The app opens on a **sign-in screen**. There are two built-in accounts:

  | Account | Password | Access |
  |---|---|---|
  | `admin` | set by the owner and given separately (only its salted hash is in the code); changeable from the profile screen | Everything **except data upload** |
  | `iqbal_labs` | fixed (given to the owner separately) | Everything, **including data upload**. A protected account: it can't be deleted, edited by others, deactivated, and its password can't be changed. |

- Admins create users, set their passwords and assign roles (Admin, Treasurer, Manager, Auditor). **Auditors are read-only**. Master Data, Users and Settings are Admin-only.
- Every rule is enforced in the main process, not just hidden in the interface. Passwords are stored only as salted **scrypt** hashes. After 5 wrong attempts the account locks for 5 minutes.

### Import members from Excel (iqbal_labs only)
**Members → Import from Excel** opens a 3-step wizard:
1. **Download the template:** an `.xlsx` with an *Instructions* sheet (English and Bangla), a *Members* sheet and a *Payment History* sheet, with example rows. Example rows (codes starting with `EX-`) are always ignored.
2. **Fill it in.** For each member's collections so far, choose **one** method:
   - **Month by month (best):** in *Payment History*, enter the amount paid under each `YYYY-MM` column, or `P` for paid in full. Arrears, statements and reports are then exact.
   - **Only a total:** put the total paid so far in **Opening Balance**, and set **Join Date** to the first month you'll track in the app.
3. **Review and import:**
   - Every row is checked: dates (DD/MM/YYYY, Bangla digits OK), amounts ("3,000", ৩,০০০), duplicate codes, unknown members, future months, and payments dated before the member joined.
   - Rows with errors are skipped and listed with their row or cell number.
   - Re-importing the same file never duplicates members or payments.
   - Everything is saved in one transaction, after a `PreImport_*.db` safety snapshot.

**Members → Export to Excel** writes the same layout, so you can make corrections and re-import.

### Accounting health check
**Backup & Restore → Accounting health check** runs 19 read-only checks:
- the integrity of the database file;
- every payment: total = contribution + late fee, a positive amount, valid dates, and the member exists;
- member, expense and investment values;
- sold investments have their sale details;
- the settings;
- **reconciliation:** opening balances + money in − money out must equal cash in hand, and member totals must equal total contributions.
### Personal loans
Loans to members with a calculator (reducing, flat or interest-free), a draft that moves no money until the **signed consent paper** is uploaded, guarantors (member or outsider with National ID), repayments, early closure and write-off, all booked into the fund's accounts. New in 2.9.0: an **enforced lending policy** (open loans per member, no loan for an overdue or written-off borrower, minimum membership, arrears limit, share of the fund, cash reserve, guarantees per member) where **only an Admin can approve an exception** with a written reason; deletions need a reason (and an Admin for a whole loan); and a **portfolio quality** card (overdue by age, PAR 30/60/90, defaulters with guarantor). Details: [docs/LOANS.md](docs/LOANS.md).

### Fines
A separate screen for every late fee and loan penalty: who paid, when, how late, and where the fine money sits (the fund's own reserve), with a proof that the books balance.

### Licence and remote lock (for the vendor)
Activation PINs, monthly or day-based paid-until dates, remote suspend, limits on computers and users, an allow-list of usernames, and an `iqbal_labs`-only **License Control** panel on a free Supabase project. Offline copies keep working, but an **offline counter** (a timer that changing the date cannot reduce) locks a copy after 14 days of use without a check-in, a PC clock set back or an edited licence record locks it until one online check-in, and offline stretches are reported to the panel. Details: [docs/LICENSING.md](docs/LICENSING.md).

### Google account sync and Drive backup (premium)
Keeps the fund in the user's own Google Drive (a hidden app-data folder): automatic backup, a **new PC restores everything by signing in**, only the newest 10 copies are kept, failed uploads retry after 10 seconds, conflicts never overwrite, and an optional sync PIN encrypts the cloud copy. Only `iqbal_labs` can switch the feature on or off for a computer. Details: [docs/GOOGLE_SYNC.md](docs/GOOGLE_SYNC.md).

### Entry checks
Impossible or future dates, infinite or absurd amounts, a payment for a month before the member joined, and values outside the Master Data lists are refused in the main process; a second payment for the same month and spending more than the cash in hand **ask before they proceed**. Details: [docs/ENTRY_RULES.md](docs/ENTRY_RULES.md).

### Experience
- **English / বাংলা** everywhere: labels, data values (statuses, categories, methods), dates, months and digits (০১২৩…).
- **Light / dark** themes, a collapsible sidebar, and layouts that work down to 960 px wide.
- **Searchable dropdowns** everywhere, a **click-anywhere date picker** (dd/mm/yyyy, Saturday-first weeks), and soft frosted dialogs.
- Works **100% offline**. Fonts are bundled. The only features that use the network are optional: the licence check (licensed builds) and Google sync (premium, off by default); neither is needed to use the fund's books.

---

## 📸 Screenshots

> Generated from the real app with demo data by `npm run screenshots`.

| Overview (light) | Collections |
|---|---|
| ![Overview](docs/screenshots/01-overview.png) | ![Collections](docs/screenshots/02-collections.png) |

**Dark mode**

![Dark overview](docs/screenshots/03-dark-overview.png)

---

## 🏗 Architecture

```
┌──────────────────────────── Electron main process (Node.js) ─────────────────────────────┐
│  electron/main.ts       window, single-instance lock, native dialogs, backups, IPC router  │
│  electron/database.ts   ALL SQL · schema & migrations · business rules · analytics         │
│        │  sql.js (SQLite compiled to WASM, in memory) ──► atomic save to bondhu_fund.db   │
└────────┼───────────────────────────────────────────────────────────────────────────────────┘
         │ ipcMain.handle('db:call', method, args) → { ok, data } | { ok:false, error }
┌────────┼────────── electron/preload.ts (contextBridge, sandboxed) ──────────────────────────┐
│        ▼  window.electronAPI.call / backup / restore / saveText / savePdf …                │
└────────┼───────────────────────────────────────────────────────────────────────────────────┘
┌────────┼────────────────────────── Renderer (React 18 + Vite) ─────────────────────────────┐
│  src/services/db.ts      typed async proxy (same function names as the API)               │
│  src/context/AppContext  language, theme, current user, cached settings & master data,    │
│                          t() / tv() / formatters, toasts, navigation                       │
│  src/views/*             one lazy-loaded screen per sidebar item                            │
│  src/components/common   SearchableSelect · DatePicker · Modal · MonthPicker              │
│  src/components/charts   ECharts wrapper + ChartCard (chart/table toggle)                  │
│  src/locales/*           English/Bangla dictionaries per area                              │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Key design decisions**
| Decision | Why |
|---|---|
| **SQLite via sql.js (WASM) in the main process** | No native module to compile, so the installer works on any Windows PC. The renderer never holds the database, and the full file is never sent over IPC on each write. |
| **One IPC channel with an allow-list** (`db:call` → `api[method]`) | A small attack surface. Every DB function is reachable only if it's in `api` in `database.ts`. |
| **Debounced atomic saves** | Writes are batched (250 ms), saved as temp file + rename, and flushed on quit. A crash never leaves a half-written file. |
| **Derived dues** | `collections` stores only real payments. Pending and Overdue are computed from members × months × due day, so there are no "generate dues" jobs and no stale placeholder rows. |
| **Versioned migrations** (`PRAGMA user_version`) | Old databases and old backups (including the original prototype) are upgraded automatically on open or restore. |
| **Security** | `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, navigation blocked, single-instance lock. |
| **Performance** | Lazy-loaded screens, a memoized context, settings and master data cached in context, debounced search, only the Latin and Bengali font subsets bundled, and Chromium-120 build target. |

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (data contract and full API) · [docs/UI_GUIDE.md](docs/UI_GUIDE.md) (UI and Bangla rules).

### Request flow (example: recording a payment)
1. `RecordPaymentModal` calls `recordPayment({...})` from `src/services/db.ts`.
2. The proxy runs `window.electronAPI.call('recordPayment', [data])` → IPC `db:call`.
3. `main.ts` looks up `api.recordPayment` and runs it inside `wrap()`, which turns any exception into `{ ok:false, error }`.
4. `database.ts` validates the input, then upserts into `collections` inside a transaction, writes an `audit_log` row, and schedules a save.
5. The renderer either gets the new id, or the proxy throws `Error(message)` → the view shows `showToast(e.message, 'error')`.
6. The view calls `triggerRefresh()`, and every screen that depends on `refreshKey` reloads.

### Money model
```
fund balance  = Σ opening balances + Σ collections (incl. late fees) − Σ expenses + realized gains on sold investments
cash in hand  = fund balance − cost of active investments
net worth     = fund balance + unrealized gain (estimated value − cost of active investments)
```

---

## 🗄 Database

- **Engine:** SQLite 3 (sql.js). **File:** `%APPDATA%\Bondhu Fund\database\bondhu_fund.db`. **Schema version:** 2.
- **Formats:** dates are `YYYY-MM-DD`, months are `YYYY-MM`, money is `REAL` in the base currency, and images (avatar, logo) are stored inline as `data:image/...` strings of 500 KB or less.

```mermaid
erDiagram
    MEMBERS ||--o{ COLLECTIONS : "pays"
    USERS ||--o{ AUDIT_LOG : "acts"
    MEMBERS {
        int id PK
        text member_code UK "BF-0001"
        text name
        text name_bn "Bangla name"
        text phone
        text email
        text designation
        text status "Active | Inactive"
        real monthly_due
        text join_date "YYYY-MM-DD"
        real opening_balance "paid before using the app"
        text notes
    }
    COLLECTIONS {
        int id PK
        int member_id FK
        text payment_month "YYYY-MM (unique with member)"
        text payment_date
        real contribution_amount
        real late_fee
        real total_amount
        text payment_method
        text trx_id
        text created_by
    }
    INVESTMENTS {
        int id PK
        text name
        text sector
        text purchase_date
        real invested_amount
        real current_estimated_value
        text status "Growing | Review | Sold"
        text review_date
        text sold_date
        real sold_amount
    }
    EXPENSES {
        int id PK
        text title
        text category
        real amount
        text expense_date
        text payee
        text receipt_ref
        text status "Verified | Needs receipt"
    }
    USERS {
        int id PK
        text username UK
        text full_name
        text role "Admin | Treasurer | Auditor | Manager"
        text status
        text avatar "data URL"
        text phone
        text designation
        text password_hash "reserved for sign-in"
        text last_login_at "reserved"
    }
    MASTER_DATA {
        int id PK
        text type "expense_category | investment_sector | payment_method"
        text name
        text name_bn
        int is_active
    }
    AUDIT_LOG {
        int id PK
        text at
        int user_id
        text user_name
        text action
        text entity
        int entity_id
        text details
    }
    APP_SETTINGS {
        text key PK
        text value
    }
    BACKUP_LOGS {
        int id PK
        text file_name
        text file_path
        int file_size
        text backup_type
    }
```

**Settings keys** (`app_settings`): `organization_name`, `organization_name_bn`, `org_logo`, `currency_symbol`, `default_monthly_due`,
`monthly_due_day` (1–28), `late_fee_amount`, `fiscal_year_start_month` (default 7 = July), `auto_backup_enabled`, `auto_backup_keep`, `active_user_id`, `last_backup_date`.

**Migrations** live in `migrate()` in `electron/database.ts`:
- **v0 → v1:** the prototype stored display strings (`'June 2024'`, `'05 Jun 2024'`) and placeholder Pending rows. These are converted to ISO dates and real payments only, and `opening_balance` is derived.
- **v1 → v2:** adds profile columns, sign-in-ready columns (`password_hash`, `password_salt`, `must_change_password`, `failed_logins`, `last_login_at`), `name_bn` on members and master data, and `audit_log.user_id`.
- Migrations are **idempotent** (`addColumn()` checks `PRAGMA table_info`), so they're safe on fresh, partially upgraded and restored databases.

---

## 📁 Project structure

```
bondhu-fund/
├─ electron/
│  ├─ main.ts            # app lifecycle, window, IPC, backup/restore/snapshots, file save (CSV/PDF)
│  ├─ preload.ts         # window.electronAPI (contextBridge)
│  ├─ database.ts        # schema, migrations, all queries & business rules, entry checks, loan policy, demo data
│  ├─ loans.ts           # pure loan maths (schedules, interest methods)
│  ├─ exporter.ts · excel.ts · backup-crypto.ts   # PDFs / consent paper, Excel import & export, encrypted backups
│  ├─ license.ts         # licence client + vendor panel logic (offline counter, signed record) - no Electron imports
│  ├─ license-main.ts    # licence glue: secure storage, counter timer, sign-in gate
│  ├─ google.ts · gsync.ts · google-main.ts   # Google sign-in & Drive, the sync engine (retry, retention), IPC + premium switch
├─ src/
│  ├─ main.tsx · App.tsx # entry, lazy routes, error boundary
│  ├─ context/AppContext.tsx
│  ├─ services/db.ts     # renderer API client (typed), incl. the "replace? / record anyway?" confirmations
│  ├─ types/index.ts     # shared TypeScript types
│  ├─ views/             # Overview, Members, Collections, Fines, Expenses, Investments, InvestmentReturns, PersonalLoans,
│  │                     # EntryCenter, Reports, MasterData, UserManagement, UserProfile, BackupRestore, Settings, LicenseControl
│  ├─ components/        # common, charts, layout, modals, reports, loans, access, GoogleSyncCard, DriveBackupCard
│  ├─ locales/           # EN/BN dictionaries (common, shell, members, finance, reports, admin, loans, fines, google, license, ...)
│  └─ utils/             # date.ts, i18n.ts, image.ts, licenseStore.ts
├─ scripts/              # test suites (*-test.js), fake-supabase.js, fake-google.js, perf-bench.js, capture-*.js, bundle-electron.js
├─ config/               # *.example.json (copy to supabase.json / google.json; those are git-ignored)
├─ build/                # icons, code-signing trust files
├─ docs/                 # LICENSING · GOOGLE_SYNC · LOANS · ENTRY_RULES · PERFORMANCE · TESTING · AUDIT · ARCHITECTURE · UI_GUIDE · RELEASE
│  └─ supabase/license.sql   # the licence server schema and functions
├─ CHANGELOG.md
└─ package.json          # scripts + electron-builder config ("build")
```

---

## 🛠 Development setup

### Prerequisites
| Tool | Version |
|---|---|
| Windows | 10/11 x64 (macOS/Linux work for development; packaging targets Windows) |
| Node.js | **20 LTS or newer** (`node -v`) |
| Git | any recent version |
| Editor | VS Code with ESLint and Tailwind CSS IntelliSense extensions (recommended) |

### First run
```bash
git clone https://github.com/m-asifiqbal/bondhu-fund.git
cd bondhu-fund
npm install              # also downloads Electron (~100 MB)
npm run electron:dev     # Vite dev server + Electron, with hot reload for the UI
```
- **UI changes** (`src/`) reload instantly.
- **Main-process changes** (`electron/`) need a restart of `npm run electron:dev`, which recompiles them.
- Development uses the **same data folder** as the installed app (`%APPDATA%\Bondhu Fund`). Back up first, or point a test profile elsewhere (the scripts in `scripts/` use throw-away profiles).

### Useful scripts
| Command | What it does |
|---|---|
| `npm run electron:dev` | Development mode (Vite on :5173 + Electron) |
| `npm run typecheck` | TypeScript check for the renderer and main process |
| `npm run test:import` | Excel import suite: template, a messy realistic workbook (Bangla digits, P markers, duplicates, future months), preview, commit, re-import, export round trip |
| `npm run test:db` | Database test suite (fresh DB, CRUD, rules, reconciliation, backup/restore). Add `-- path\to\old.db` to also test migrating a copy of an older database. |
| `npm run screenshots` | Regenerates the 3 images in `docs/screenshots/` using demo data in a temporary profile (set `BONDHU_SYSTEM_PASSWORD` to the iqbal_labs password) |
| `npm run build:all` | Production build of the renderer (`dist/`) and main process (`dist-electron/`) |
| `npm start` | Run the production build locally |
| `npm run dist` | Build `release/BondhuFund-Setup-x.y.z.exe` and `release/BondhuFund-Portable-x.y.z.exe` |
| `npm run dist:mac` | **On a Mac only:** build `release/BondhuFund-macOS-x.y.z-arm64.dmg` (and `.zip`) for Apple silicon |
| `npm run test:license` `test:review` `test:fines` `test:fuzz` | Licence control, committee reviews, fines, and the randomised "the books always balance" stress test (plus `test:access`, `test:gsync`, `test:loans`) |

### Tech stack
Electron 35 · React 18 · TypeScript 5 · Vite 5 · Tailwind CSS 3 · Apache ECharts 5 (Overview) · Recharts 2 (Investments) · lucide-react icons · sql.js (SQLite WASM) · electron-builder 26 (NSIS + portable) · @fontsource Inter & Noto Sans Bengali.

---

## ➕ Adding a feature

Read [docs/UI_GUIDE.md](docs/UI_GUIDE.md) first. It lists the components to use and the rules for Bangla text. Example: **adding a "phone reminder sent" flag to collections**.

**1. Database: add a migration** (`electron/database.ts`)
```ts
export const SCHEMA_VERSION = 3;                 // bump
// inside migrate(), after ensureV2Columns():
addColumn('collections', 'reminder_sent_at', 'TEXT');
```
`addColumn` is idempotent, and old backups get the column when they're restored.

**2. Business logic: add a function and register it**
```ts
function markReminderSent(collectionMemberId: number, month: string) {
  const mk = toMonthKey(month) || fail('Invalid month');
  tx(() => {
    run(`UPDATE collections SET reminder_sent_at = datetime('now','localtime') WHERE member_id = ? AND payment_month = ?`, [collectionMemberId, mk]);
    audit('reminder', 'collection', collectionMemberId, mk);
  });
  mutated();                                     // schedules the atomic save
}
export const api = { /* … */ markReminderSent };
```
Rules:
- Validate input and `fail('readable message')`. That message is exactly what the user sees.
- Wrap writes in `tx()`, call `audit()`, then `mutated()`.

**3. Renderer client** (`src/services/db.ts`)
```ts
export const markReminderSent = (memberId: number, month: string) => call<void>('markReminderSent', memberId, month);
```
Add or extend types in `src/types/index.ts`.

**4. UI** (`src/views/CollectionsView.tsx`)
```tsx
const { t, showToast, triggerRefresh } = useApp();
const onRemind = async (r: CollectionRecord) => {
  try { await markReminderSent(r.member_id, r.payment_month); showToast(t('members.reminder_saved', 'Reminder recorded')); triggerRefresh(); }
  catch (e: any) { showToast(e.message, 'error'); }
};
```
- Use `SearchableSelect`, `DatePicker` and `Modal`. Never use native `<select>`, `<input type="date">` or hand-made overlays.
- Display data values with `tv(value)`, names with `bnName(name, name_bn)`, and money, dates and digits with `formatCurrency`, `formatDate` and `toBanglaDigits`.

**5. Translations** (`src/locales/members.ts`)
```ts
'members.reminder_saved': { en: 'Reminder recorded', bn: 'রিমাইন্ডার সংরক্ষিত হয়েছে' },
```

**6. Verify**
```bash
npm run typecheck && npm run test:db     # add a check for your function in scripts/db-test.js
npm run electron:dev                     # try it in both English and বাংলা, light and dark
```

**Adding a whole new screen:**
1. Add the id to `NavTab` in `src/types`.
2. Create `src/views/XView.tsx`.
3. Add a lazy import and a `case` in `src/App.tsx`.
4. Add a sidebar item in `src/components/layout/Sidebar.tsx`.
5. Add the `nav.x` label to `src/locales/shell.ts`.

---

## 🧪 Testing

Every suite runs in plain Node against the compiled main-process code, with fake Supabase and Google servers; nothing touches your data or the internet. Full guide: **[docs/TESTING.md](docs/TESTING.md)**.

| Command | Covers |
|---|---|
| `npm run test:db` | members, payments, master data, demo data, **ledger = cash in hand**, backup/restore |
| `npm run test:loans` | loan maths, books, repayments, write-off, consent, **lending policy**, deletions, portfolio ageing |
| `npm run test:fines` · `test:settle` · `test:review` | the fine register and books proof · member settlement to the paisa · committee reviews |
| `npm run test:fuzz` | hundreds of random operations; the **books balance after every step** |
| `npm run test:audit` · `test:nid` · `test:import` · `test:backup` · `test:access` | account audit · National IDs · Excel import · encrypted backups · roles and permissions |
| `npm run test:gsync` | Google sync: push, pull, conflicts, retention of 10, retry after 10 s, premium rule |
| `npm run test:license` | licensing: every lock reason, offline counter, clock tricks, signed record |
| `npm run bench` | **performance targets** on a 500-member, 33,000-payment fund ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)) |

Some checks sign in as the built-in accounts and need `BONDHU_SYSTEM_PASSWORD` / `BONDHU_ADMIN_PASSWORD` in the environment (never in a file); without them those checks print `SKIP`. `npm run screenshots` is also a smoke test of the main screens. Manual checklist before a release: [docs/RELEASE.md](docs/RELEASE.md).

---

## 🍎 Running on a Mac (Apple silicon, e.g. M5)

The program is plain Electron with a built-in database, so it runs unchanged on macOS. A Mac installer can only be built **on a Mac**:

```bash
xcode-select --install          # once: command-line tools
brew install node               # once: Node 20 or newer
git clone https://github.com/m-asifiqbal/bondhu-fund.git && cd bondhu-fund
cp /path/to/config/supabase.json config/   # only for License Control (git-ignored; see docs/license_setup.md)
npm install
npm run dist:mac                # → release/BondhuFund-macOS-x.y.z-arm64.dmg
```
Open the `.dmg` and drag *Bondhu Fund* to Applications. Notes:
- An app built on your own Mac normally opens at once. If macOS says it is "damaged" or from an unidentified developer, run
  `xattr -cr "/Applications/Bondhu Fund.app"` and `codesign --force --deep --sign - "/Applications/Bondhu Fund.app"`.
  Distributing it to other Macs without warnings needs an Apple Developer ID certificate and notarisation.
- The first Google sign-in or Drive sync makes macOS ask about the "Bondhu Fund Safe Storage" Keychain item: choose *Allow*.
- Data is kept in `~/Library/Application Support/Bondhu Fund`. To move data between Windows and Mac use an encrypted backup (Backup & Restore) or Google sync: the files are identical on both systems.
- The licence panel, loans, fines, committee reviews and everything else work the same. This Mac build has not yet been tested on real hardware by the author: please report problems.

---

## 🚀 Building & releasing

```bash
npm version minor        # bump version (e.g. 2.1.0 → 2.2.0)
npm run typecheck && npm run test:db
npm run dist             # → release/BondhuFund-Setup-x.y.z.exe + BondhuFund-Portable-x.y.z.exe
```
Then create a GitHub Release with tag `vX.Y.Z` and attach both `.exe` files.
**Code signing** is ready to use: set `CSC_LINK` and `CSC_KEY_PASSWORD` (a `.pfx` certificate) or Azure Trusted Signing variables before `npm run dist`. See [docs/RELEASE.md](docs/RELEASE.md).

---

## 💾 Data, backups & recovery

| What | Where |
|---|---|
| Live database | `%APPDATA%\Bondhu Fund\database\bondhu_fund.db` |
| Daily automatic snapshots (keeps 14) | `%APPDATA%\Bondhu Fund\database\backups\Auto_YYYY-MM-DD.db` |
| Taken before every restore (keeps 10) | `…\backups\PreRestore_*.db` |
| Manual backups | wherever you save them (USB, cloud folder, etc.) |

- **Restore** checks that the file is a SQLite database, that it passes an integrity check, and that it's a Bondhu Fund schema. Only then does it snapshot the current data and swap the new database in. An invalid file never touches your data.
- **If the live database is ever damaged,** the app automatically opens the newest readable snapshot on the next start, and keeps the damaged file aside as `*.corrupt-<time>`.
- Backups are plain SQLite files and can be opened with [DB Browser for SQLite](https://sqlitebrowser.org/).

---

## 🩺 Troubleshooting

| Problem | Fix |
|---|---|
| Electron opens as plain Node / exits immediately during development | An environment variable `ELECTRON_RUN_AS_NODE` is set (some editors set it). Use the npm scripts (they clear it) or run `set ELECTRON_RUN_AS_NODE=` first. |
| `npm install` fails with `EBUSY … electron\dist` | A running copy of the app is locking the files. Close it and retry. |
| Electron download fails (`ECONNRESET`) | Retry, or set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` before `npm install`. |
| Date fields or Bangla text look wrong | Rebuild (`npm run build:all`). Fonts are bundled from `@fontsource`, so no internet is needed. |
| "Windows protected your PC" | The installer isn't code-signed yet: **More info → Run anyway**. See [docs/RELEASE.md](docs/RELEASE.md). |

---

## 🗺 Roadmap
- [ ] Loan **approval workflow** (rejected / withdrawn states, a second approver) and printable repayment receipts, schedules and borrower statements ([docs/LOANS.md](docs/LOANS.md), section 10).
- [ ] A loan **penalty engine** (grace period, rate, cap, waivers), recovery after write-off, rescheduling and early-closure interest.
- [ ] Faster Overview trend and reports on very large funds ([docs/PERFORMANCE.md](docs/PERFORMANCE.md), section 7).
- [ ] Bangla text in the downloadable payment voucher (`.txt`).
- [ ] Auto-update from GitHub Releases.
- [ ] SMS or WhatsApp due reminders.

---

<div align="center">
Built with Electron, React and SQLite · Bangla & English · Works fully offline
</div>
