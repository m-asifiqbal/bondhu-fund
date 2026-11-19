# Performance

How the app was measured, what the numbers are, what was changed in 2.9.0, and what could still be improved. The method is repeatable: `npm run bench` ([scripts/perf-bench.js](../scripts/perf-bench.js)).

- [1. Summary](#1-summary)
- [2. Method](#2-method)
- [3. Results on a large fund](#3-results-on-a-large-fund)
- [4. The app itself: start-up, screens, memory, size](#4-the-app-itself-start-up-screens-memory-size)
- [5. What was changed in 2.9.0](#5-what-was-changed-in-290)
- [6. How the app is built to stay fast](#6-how-the-app-is-built-to-stay-fast)
- [7. Still open (not done)](#7-still-open-not-done)

---

## 1. Summary

On a fund with **500 members and about 33,000 payments** (a 10 MB database) every operation a user waits for is within its target. Start-up to a visible window is about **0.45 s** (development run), switching between screens takes **20 to 60 ms**, a write takes about **1 ms**, and a whole-database backup export about **16 ms**. A typical fund (tens of members, a few thousand payments) is far smaller than this test.

## 2. Method

- A throw-away database is built through the real code: **500 members**, **33,420 payments** (2021 to 2026, a few months skipped), 400 expenses, 12 investments and 60 loans (half with a repayment). Building it takes about 13 s, roughly 2,900 payments a second.
- Each operation is timed with a high-resolution timer (several repetitions where it is cheap) and compared with a **target**; the benchmark **exits non-zero** if any is slower.
- Run it on an idle machine. Timings move by a few tens of percent between runs: for example the Fines screen measured 565 ms and 739 ms in two runs of the same code (target 800 ms).
- The app-level numbers (start-up, screen switches, memory) come from running the **real Electron app** with an isolated profile and demo data, as described in [TESTING.md](TESTING.md) section 6.

## 3. Results on a large fund

| Operation | Target | Measured (two runs) |
|---|---|---|
| Overview screen | ≤ 500 ms | 246–286 ms |
| Members page (10 rows) | ≤ 200 ms | 45 ms |
| Members search | ≤ 200 ms | 45 ms |
| Collections for one month | ≤ 200 ms | 11–14 ms |
| **Fines screen** | ≤ 800 ms | 565–739 ms |
| Fund books | ≤ 400 ms | 131–162 ms |
| Loans list and summary | ≤ 500 ms | 25–31 ms |
| Accounting health check | ≤ 800 ms | 413–429 ms |
| Cash-book source (all transactions) | ≤ 800 ms | 348–434 ms |
| Notifications | ≤ 300 ms | 12–13 ms |
| Record one payment | ≤ 100 ms | 1 ms |
| Backup export (whole database) | ≤ 200 ms | 16 ms |

The slowest screens (Fines, the health check, the cash-book source) read the whole history; they are still under a second at this size.

## 4. The app itself: start-up, screens, memory, size

Measured on the real app, development run, demo data:

| Measure | Result |
|---|---|
| Process start to the window ready | **about 0.45 s** |
| Sign in | 82 ms |
| Switching screen (Overview, Collections, Fines, Members, Investments, Loans, Reports) | **21–56 ms** |
| Memory, all 4 Electron processes together | about **510 MB** (normal for Electron; the GPU is disabled for compatibility, so rendering is in software) |
| Front-end bundle (`dist/`) | 3.1 MB; the biggest chunk is the charting library (600 KB), loaded only when a chart is shown |
| Main-process bundle (`dist-electron/main.js`) | 3.2 MB (the spreadsheet library is bundled eagerly) |
| Portable `.exe` | about 75 MB; it **unpacks itself on every launch**, so the first window takes several seconds (about 6 s measured once). The **installed** copy starts faster. |

## 5. What was changed in 2.9.0

| Change | Effect |
|---|---|
| A **covering index** on payments by date (`idx_coll_cov(payment_date, total_amount)`) | The fund-position sums (the Overview computes it 14 times for its 12-month trend) read only the index. Measured on a synthetic 30,000-payment table: the 14 sums fell from 412 ms to 56 ms. |
| Month and date arithmetic **without `Date` objects** (`addMonths`, `daysInMonth`, `dayDiff`) | These run inside loops over members × months × payments (arrears, fines, reports). |
| **Savings by date by binary search** over running totals in whole paisa (`benefitAllocation`) | Was a full re-sum for every event and every member. Results are identical to the paisa; fines, settlement and the books-balance stress test pass. Per-line bookkeeping is kept only for the one member being settled. |
| With the covering index already in place, the two changes above took the Overview from about **338 ms to 252 ms** and the Fines screen from about **688 ms to 560 ms** on the 500-member fund | |
| The **logo and avatar images are no longer read on every call.** Each request used to select the signed-in user's avatar (up to about 800 KB) and every setting, including the logo | Lighter per-call work and smaller internal messages. |
| **One export per backup** (it used to export twice) | Backup export about 17 ms. |
| The **report preview shows the first 300 rows** (with *Show all rows*); totals and every export always use all rows | A year of transactions no longer builds thousands of table rows. |
| The licence screen no longer re-renders the whole shell every minute | Fewer needless renders. |

Bugs found while profiling, and fixed:
- **Foreign keys were switched off after any backup, snapshot or Google sync export** (SQLite's export resets the pragma). Writes in that window ran without enforcement.
- A login lock that had **expired** re-armed on the next single wrong password.
- Large money values on narrow KPI cards were cut off with "…" instead of wrapping.

## 6. How the app is built to stay fast

- The database is an in-memory **sql.js** (SQLite compiled to WebAssembly), saved with a **debounced flush** (250 ms) and an atomic temp-file rename, plus a flush on quit. A write costs about a millisecond.
- The database opens in parallel with the window; requests wait for it to be ready.
- Lists are paginated in SQL (10 rows per page); searches are debounced.
- Screens are `React.lazy` chunks with an error boundary; charts (ECharts) are tree-shaken, SVG-rendered and memoised.
- Real indexes exist on the hot columns, and every write is one transaction with one change notification.

## 7. Still open (not done)

Found by the 2.9.0 review, in rough order of value:

1. **Overview 12-month trend**: compute it from one `GROUP BY month` per table plus running totals instead of 14 separate position calculations (about 140 queries down to about 8). Moderate risk: the trend must equal the position exactly.
2. **Reports** fetch the whole history to compute an opening balance and use `getCollections('All')` for the fiscal report; add a SQL opening balance and a `GROUP BY member` roll-up.
3. **Every write refreshes** settings, users and notifications and re-renders every consumer of the one large context; narrow the refresh and split the context.
4. **The arrears calculation is copied in three places** (Overview, Fines, the Defaulters report); one `getArrears(month)` in SQL.
5. `getMembers` evaluates its payments group-by three times (count, page, stats).
6. The main bundle includes the spreadsheet library eagerly (about 3 MB); load it only for import and export. Minify the main bundle and stop shipping the test bundles that `electron-builder` copies from `dist-electron/`.
7. The clear-button helper polls the page every 250 ms.
8. Smaller: `enrichLoans` loads every loan for one, the statements export runs about 3 queries per member, and date columns compared with `substr()` cannot use an index (fine at today's sizes).

None of these is a problem at 500 members and 33,000 payments; they matter only if funds grow much larger.
