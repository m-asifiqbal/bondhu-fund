# Testing

All automated tests run in plain Node against the **compiled** main-process code (`dist-electron/`), with no Electron window. Servers (Supabase, Google) are replaced by small fake servers in `scripts/`. Nothing touches your real data or the internet.

- [1. Quick start](#1-quick-start)
- [2. The suites](#2-the-suites)
- [3. Passwords and environment variables](#3-passwords-and-environment-variables)
- [4. Fake servers](#4-fake-servers)
- [5. Performance benchmark](#5-performance-benchmark)
- [6. Testing the real app](#6-testing-the-real-app)
- [7. Known environment-dependent checks](#7-known-environment-dependent-checks)
- [8. Before a release](#8-before-a-release)

---

## 1. Quick start

```bash
npm install
npm run typecheck                 # both TypeScript projects
npm run test:db                   # one suite (it rebuilds dist-electron first)
```

Run everything (Git Bash / macOS / Linux). The two password variables are explained in section 3:

```bash
export BONDHU_SYSTEM_PASSWORD='<the iqbal_labs password>'
export BONDHU_ADMIN_PASSWORD='<the admin account password>'
node scripts/bundle-electron.js
for t in db audit nid review loan fines settle books-fuzz import backup access gsync license; do
  printf "%-12s " $t; node scripts/$t-test.js 2>&1 | grep -E "FAIL|CRASH|PASSED|FAILURE|CHECKS" | head -3 | tr '\n' ' '; echo
done
```

A suite prints `PASS`/`FAIL` per check and ends with a summary line (`ALL … PASSED`) and a non-zero exit code on any failure.

## 2. The suites

| Command | File | What it proves |
|---|---|---|
| `npm run test:db` | [db-test.js](../scripts/db-test.js) | members, payments (a second payment for a month needs `replace`), future dates refused, master-data renames, realized gains, demo data, **ledger = cash in hand**, backup → reset → restore, invalid file rejected |
| `npm run test:audit` | [audit-test.js](../scripts/audit-test.js) | a full account audit: totals, statements, settlement, audit-log entries |
| `npm run test:nid` | [nid-test.js](../scripts/nid-test.js) | National ID rules (10/13/17 digits, Bangla digits, uniqueness) and NID search |
| `npm run test:review` | [review-test.js](../scripts/review-test.js) | committee investment reviews: completion, outcomes, due dates |
| `npm run test:loans` | [loan-test.js](../scripts/loan-test.js) | loan maths, books, repayments, closure, write-off, drafts and consent, **lending policy**, deletion with reasons, **portfolio ageing and PAR** (see [LOANS.md](LOANS.md)) |
| `npm run test:fines` | [fines-test.js](../scripts/fines-test.js) | the fine register, who paid what, where the money sits, the **books-balance proof** |
| `npm run test:settle` | [settle-test.js](../scripts/settle-test.js) | member settlement (profit share, adjustments) to the paisa |
| `npm run test:fuzz` | [books-fuzz-test.js](../scripts/books-fuzz-test.js) | **hundreds of random operations** (payments, deletions, expenses, investments, profits, sales, loans, settlements) in a fixed random order; after **every step** the books balance, the health check has no failure, the cash book reconciles and the fine register matches. Refused operations are skipped: refusing is correct. Reproduce a run with `FUZZ_SEED=…`. |
| `npm run test:import` | [import-test.js](../scripts/import-test.js) | the Excel import: validation, re-import without duplicates, one transaction |
| `npm run test:backup` | [backup-test.js](../scripts/backup-test.js) | PIN-encrypted backups and the master recovery key |
| `npm run test:access` | [access-test.js](../scripts/access-test.js) | roles and per-user module permissions, enforced server-side |
| `npm run test:gsync` | [gsync-test.js](../scripts/gsync-test.js) | Google sync against a fake Google (see [GOOGLE_SYNC.md](GOOGLE_SYNC.md)): push, pull, conflicts, PIN, retention of 10, retry after 10 s, premium rule |
| `npm run test:license` | [license-test.js](../scripts/license-test.js) | licensing against a fake Supabase (see [LICENSING.md](LICENSING.md)): every lock reason, offline counter, clock tricks, signed record |
| `npm run bench` | [perf-bench.js](../scripts/perf-bench.js) | performance targets on a large fund (section 5) |

## 3. Passwords and environment variables

Some checks sign in as a built-in account. The passwords are **never stored in the code or the repository**: only their salted hashes are. Give them through the environment, in the shell that runs the tests:

| Variable | Account | Needed for |
|---|---|---|
| `BONDHU_SYSTEM_PASSWORD` | `iqbal_labs` (owner, Admin and upload rights) | the sign-in checks in `test:db`, `test:loans` (the policy / deletion / PAR section), `test:gsync`, `test:license` (Part 3), screenshots |
| `BONDHU_ADMIN_PASSWORD` | `admin` | the admin sign-in checks in `test:db`, `test:license`, `test:gsync` (signed consent papers) and the permission section of `test:loans` |

Without a variable, the dependent checks print `SKIP …` and the rest still run. Never put these values in a script, a document or a commit.

## 4. Fake servers

- [scripts/fake-supabase.js](../scripts/fake-supabase.js): the licence server, with auth, the three public functions, the admin tables and `bf_extend`. It can be taken **down** (`ctl.down`) to simulate no internet, and it records the offline report.
- [scripts/fake-google.js](../scripts/fake-google.js): Google's sign-in, token, Drive `appDataFolder` and userinfo endpoints. Switches: `failDownload`, `quotaFull`, `grantDrive`, and `failNext = n` (the next *n* Drive requests fail with a 503, to test the retry).

## 5. Performance benchmark

`npm run bench` builds a throw-away fund (**500 members, about 33,000 payments, 400 expenses, 12 investments, 60 loans**, about 10 MB), times each operation a user waits for, and **exits non-zero when one is slower than its target**:

| Operation | Target |
|---|---|
| Overview screen | ≤ 500 ms |
| Members page / search | ≤ 200 ms |
| Collections for one month | ≤ 200 ms |
| Fines screen | ≤ 800 ms |
| Fund books | ≤ 400 ms |
| Loans list and summary | ≤ 500 ms |
| Accounting health check | ≤ 800 ms |
| Cash-book source | ≤ 800 ms |
| Notifications | ≤ 300 ms |
| One payment (write) | ≤ 100 ms |
| Backup export | ≤ 200 ms |

Timings vary a few tens of percent between runs and machines. See [PERFORMANCE.md](PERFORMANCE.md) for results.

## 6. Testing the real app

The suites above do not open a window. To drive the **real Electron app** (compiled code, real Windows secure storage, the real screens), run it with an **isolated profile** so your own data is never used:

1. Write a small Electron script that sets `app.setPath('appData', <temp>)` and `app.setPath('userData', <temp>)`, then `require`s `dist-electron/main.js`.
2. On `browser-window-created` and `did-finish-load`, call the app through `window.electronAPI.call('method', [args])` (and `licenseCall`, `googleCall`) with `webContents.executeJavaScript`.
3. For screenshots use `webContents.capturePage()`. [scripts/capture-screenshots.js](../scripts/capture-screenshots.js) and [scripts/capture-showcase.js](../scripts/capture-showcase.js) are working examples (they need `BONDHU_SYSTEM_PASSWORD` to load demo data).
4. To simulate **no internet** in the real app, start it with the Chromium switch `--proxy-server=http://127.0.0.1:9`; every request then fails.
5. To test the **packaged exe**, start it with `--remote-debugging-port=<port>` and drive it over the Chrome DevTools protocol. Launch it the way a double-click does (a shortcut opened through Explorer); a plain launch from a script session may exit immediately.

Windows secure storage keys are per user and per data folder: a helper that edits the licence record must use the **same** `userData` path as the app.

## 7. Known environment-dependent checks

- Two checks at the end of the loan suite (*"the older draft is still waiting"* and *"a draft waiting when the requirement is switched off can be disbursed without a paper"*) depend on drafts created in the admin-only section, so they **fail when `BONDHU_ADMIN_PASSWORD` is not set**. They fail the same way on the code before 2.9.0; with the variable set they pass.
- `test:gsync` skips the signed-paper checks without `BONDHU_ADMIN_PASSWORD`.
- Dates: tests use today's date and fixed 2025–2026 dates; a test that relies on "overdue" assumes the fixed dates are in the past.

## 8. Before a release

1. `npm run typecheck`.
2. Every suite in section 2 passes (with both password variables set); `npm run bench` is within target.
3. Secret scan of what will be committed (no passwords, no keys, no `config/*.json`, no `.pfx`).
4. The manual checklist in [RELEASE.md](RELEASE.md).
5. Test the **packaged** build (portable): activate, work offline, check the loans and entry rules.
