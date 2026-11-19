# Bondhu Fund — Architecture & Data Contract

## Processes
- **Main process** (`electron/main.ts`, `electron/database.ts`): owns the SQLite database (sql.js/WASM, no native build).
  All SQL lives in `database.ts`. Writes are debounced (250 ms) and saved atomically (temp file + rename); flushed on quit.
- **Preload** (`electron/preload.ts`): exposes `window.electronAPI` (sandboxed, context-isolated).
- **Renderer** (`src/`): React 18 + Tailwind. Never touches SQL. Calls `src/services/db.ts`, a typed async proxy.

## Storage conventions (schema v1)
| Kind   | Format        | Example        |
|--------|---------------|----------------|
| Date   | `YYYY-MM-DD`  | `2026-11-05`   |
| Month  | `YYYY-MM`     | `2026-11`      |

- Month **arguments** accept `YYYY-MM` *or* `June 2024` (MonthPicker format). Returned months are always `YYYY-MM`.
- `<input type="date">` values are already `YYYY-MM-DD` → pass them straight through.
- **Display** dates/months with `formatDate(iso)` / `formatMonth(key)` from `useApp()` (language-aware, Bangla digits).
  Helpers also in `src/utils/date.ts` (`todayISO`, `currentMonthKey`, `toMonthKey`, `monthKeyToName`, `addMonths`, `fiscalYearRange`).
- Never hardcode demo numbers, member counts, months ('June 2024') or `2000`/`300` — read settings via `getAppSettings()`.

## Dues model
A `collections` row exists **only for a real payment** (unique per member+month).
Pending/Overdue are **derived**: every Active member who joined on/before a month owes `monthly_due` for it;
unpaid after `monthly_due_day` → `Overdue`, otherwise `Pending`. So:
- `getCollections(month)` returns one row per member due that month (paid or not). Unpaid rows have
  `payment_id = null`, `id = -member_id`, `contribution_amount = 0`, `status = 'Pending' | 'Overdue'`.
  `getCollections('All')` returns only actual payments across all months.
- To mark a due as paid → `recordPayment({...})` (upsert; editing an existing month's payment replaces it).
- To void a payment → `deletePayment(payment_id)`.
- Suggested late fee → `suggestLateFee(month, paymentDateISO)`.

## Money model
- `fundBalance = Σ opening_balance + Σ collections.total_amount − Σ expenses + realized gains on sold investments`
- `cashInHand = fundBalance − active investments at cost`
- `netWorth = fundBalance + unrealized gain (estimated value − cost of active investments)`
- `members.opening_balance` = contributions made before using the app. `total_contributed` (returned by `getMembers`) = opening + Σ contributions.

## Error handling
Every API call **throws `Error(message)`** with a user-readable message on validation/DB failure
(e.g. duplicate username, deleting a member that has payments). Views must `try/catch` and `showToast(e.message, 'error')`.
Never show success toasts before the awaited call resolves.

## API (src/services/db.ts) — all async
Settings: `getAppSettings()`, `saveAppSettings(patch)` → settings: organization_name, currency_symbol, default_monthly_due,
monthly_due_day (1–28), late_fee_amount, fiscal_year_start_month (1–12, BD default 7), auto_backup_enabled, auto_backup_keep.

Members: `getMembers(search, status, page, limit, month, startDateISO, endDateISO, sortBy)` → `{members, total, stats:{total,active,paid,pending,overdue}}`
 - status: `All | Paid | Pending | Overdue | Active | Inactive`; date range filters **join_date**; sortBy: newest, oldest, name_asc, name_desc, due_high, due_low, contributed_high, contributed_low, code_asc, join_desc.
 - `getAllMembersLite()` (for selects), `addMember(d)`, `updateMember(id, d)` (name, phone, email, designation, status, monthly_due, join_date, notes, opening_balance),
   `deleteMember(id)` (throws if member has payments → suggest Inactive), `getMemberHistory(id)`, `getMemberStatement(id)` → month-by-month incl. unpaid,
   `bulkAddMembers(list)`, `getNextMemberCode()`.

Collections: `getCollections(month|'All', statusTab, startISO, endISO, search, sortBy)` → `{records, stats}`
 - stats: totalMembers, paidCount, pendingCount, overdueCount, collectedAmount, lateFeeAmount, expectedAmount, outstandingAmount, percentage
 - sortBy: newest, oldest, name_asc, name_desc, amount_high, amount_low, date_desc, date_asc, status
 - `recordPayment({member_id, payment_month, payment_date, contribution_amount, late_fee, payment_method, trx_id, note})`, `deletePayment(id)`, `suggestLateFee(month, dateISO)`.

Investments: `getInvestments(sortBy, status, startISO, endISO, search)` (gain_loss computed), `addInvestment(d)`,
`updateInvestment(id, d)` (incl. status 'Sold' + sold_amount + sold_date), `updateInvestmentValuation(id, value)`, `deleteInvestment(id)`.
Status: Growing | Review | Sold. sortBy: newest, oldest, name_asc, val_high, val_low, gain_high, gain_low, date_desc.

Expenses: `getExpenses(category, status, startISO, endISO, search, sortBy)`, `addExpense(d)` (no receipt_ref → 'Needs receipt'),
`updateExpense(id, d)`, `verifyExpenseReceipt(id, ref)`, `deleteExpense(id)`. sortBy: newest, oldest, amount_high, amount_low, title_asc, category.

Users: `getUsers()`, `addUser(u)`, `updateUser(id, u)`, `deleteUser(id)` (last Admin protected).
Master data (types `expense_category | investment_sector | payment_method`): `getMasterData(type?, activeOnly?)`, `addMasterItem`, `updateMasterItem(id, {name, description, is_active})` (rename cascades to records), `deleteMasterItem` (throws if in use → deactivate instead).

Analytics: `getOverviewData(month)` (see `OverviewData` in types), `getOverviewMetrics(month)` (legacy summary),
`getTransactions(startISO, endISO, type)` → unified ledger rows `{type, date, party, description, method, reference, credit, debit}`,
`getAuditLog(limit)`, `getDynamicNotifications()`.

Backup: `performBackup()`, `performRestore()` (native dialogs; restore validates, migrates old backups, snapshots current data first),
`listSnapshots()`, `restoreSnapshot(fileName)`, `snapshotNow()`, `openBackupsFolder()`, `getBackupLogs()`, `getAppInfo()`,
`resetDatabase(keepSetup=true)`, `loadDemoData()`.

Files: `saveTextFile(name, content, filters?)` (native Save dialog; CSV gets UTF-8 BOM so Excel shows Bangla), `savePdf(name)` (prints current window),
`toCsv(headers, rows)`.

## Backups
- `%APPDATA%/Bondhu Fund/database/bondhu_fund.db` — live database.
- `.../database/backups/Auto_YYYY-MM-DD.db` — daily automatic snapshot (rotated, default keep 14).
- `.../database/backups/PreRestore_*.db` — taken automatically before every restore (keep 10).
- Old backups (including prototype/schema v0 files) are upgraded automatically on restore.

## Modules added in 2.8 and 2.9

| Module | Process | Files | Reference |
|---|---|---|---|
| Licence client and gate | main | `electron/license.ts` (pure), `electron/license-main.ts` (secure storage, timers, IPC `license:call`) | [LICENSING.md](LICENSING.md) |
| Licence vendor panel | renderer + main | `src/views/LicenseControlView.tsx`, `LicenseAdmin` in `license.ts` | [LICENSING.md](LICENSING.md) |
| Google sign-in and Drive | main | `electron/google.ts` (OAuth with PKCE, Drive appDataFolder) | [GOOGLE_SYNC.md](GOOGLE_SYNC.md) |
| Sync engine | main | `electron/gsync.ts` (push / pull / conflict, retention, retry; no Electron imports, fully tested) | [GOOGLE_SYNC.md](GOOGLE_SYNC.md) |
| Google IPC and premium switch | main | `electron/google-main.ts` (IPC `google:call`, background sync) | [GOOGLE_SYNC.md](GOOGLE_SYNC.md) |
| Loan engine | main | `electron/loans.ts` (pure maths), loan section of `database.ts` (policy, booking) | [LOANS.md](LOANS.md) |
| Entry checks | main | helpers before `validateMember` in `database.ts` | [ENTRY_RULES.md](ENTRY_RULES.md) |

### Three IPC entry points
- `db:call` (the fund's data): every call goes through `authorize(method, args)` (session, role, module permission) before the function runs.
- `license:call`: `status`, `activate`, `register`, `check` are open to any window (the lock screen needs them); every `admin…` operation is `iqbal_labs` only.
- `google:call`: first the **premium gate** (`premiumGate`), then the user's module permission (`google_sync` / `drive_backup`), then `iqbal_labs` for system operations.

### What is kept on the computer (`%APPDATA%\Bondhu Fund`)

| Path | Content |
|---|---|
| `database/` | the SQLite file, automatic backups and snapshots |
| `license/state.json` | the licence record (HMAC-signed): last confirmed time, the offline counter, per-licence snapshots |
| `license/vault.json` | sealed (Windows DPAPI): device tokens, the record's signing key, the vendor's Supabase session |
| `google/` | `account.json`, `config.json`, `sync-state.json`, `vault.json` (sync PIN, premium switch) |
| `loan-documents/` | uploaded signed consent papers |

### Business rules live in the main process
The screens only ask. Validation, permissions, the lending policy, premium and licence decisions are all enforced in `electron/`, so no screen can bypass them. Two flows ask the user a question and repeat the call with a flag (`replace`, `allow_overdraft`); see [ENTRY_RULES.md](ENTRY_RULES.md) section 9.

### Accounting invariants (checked by tests)
- Fund balance at cost = what members are owed + the fund's own reserve; the reserve = fines + penalties − expenses − settlement adjustments + unshared benefit.
- Ledger = cash in hand; the fine register = the fines in payments and loan repayments; every loan schedule sums exactly (Σ principal = amount, Σ installments = principal + interest).
- The randomised stress test checks all of these after **every** operation.
