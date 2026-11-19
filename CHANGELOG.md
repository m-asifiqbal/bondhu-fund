# Changelog

All notable changes, newest first. Dates are commit dates. Detailed notes for the newest versions are in [docs/](docs/); the 2.9.0 review is in [docs/AUDIT_2026-11.md](docs/AUDIT_2026-11.md).

Versions marked *pre-release* are test builds; the database format is unchanged (schema 9) since 2.8.0.

## 2.9.0 test 1 (pre-release), 2026-11-19

**Licence: offline and online both monitored** ([docs/LICENSING.md](docs/LICENSING.md))
- An **offline counter** measures how long the app has actually been running without reaching the licence server, using the computer's monotonic timer (changing the date cannot reduce it). After 14 days of use without a check-in the copy locks until it has been online once.
- Copies **report their offline stretches** to Supabase when they are next online; License Control shows total, last and longest offline time and "clock set back N×" per computer.
- **Clock set back** or an **edited licence record** locks the copy until one online check-in. The record is now **signed** with a key held in Windows secure storage. The first start after upgrading from 2.8.0 needs one online check-in.
- An amber **"Working offline"** bar tells the user how many days of use remain.
- Fixed: two check-ins at the same moment could report one offline stretch twice (now one check-in at a time).

**Google account sync and Drive backup** ([docs/GOOGLE_SYNC.md](docs/GOOGLE_SYNC.md))
- A **premium feature**: switched off by default, and only `iqbal_labs` can switch it on or off for a computer (the switch is stored encrypted). Per-user permissions still apply.
- **Signing in does the first sync at once**: a new or replacement computer gets everything back with no second step; nothing is overwritten when both sides have data.
- Only the **newest 10** synced copies and **10** Drive backups are kept; a failed upload is **retried after 10 seconds** (up to 5 times) and a half-uploaded copy is cleaned up.
- Google Desktop-client credentials can be built into the program (`config/google.json`, git-ignored) or entered inside the app.

**Personal loans** ([docs/LOANS.md](docs/LOANS.md))
- An **enforced lending policy** (Loan policy dialog): open loans per member (default 1), no new loan for an overdue or written-off borrower (default on), minimum membership, unpaid contribution limit, share of the fund, cash reserve, guarantees per member (default 2). **Only an Admin can approve an exception**, with a written reason kept on the loan.
- **No silent deletion:** deleting a loan needs an Admin and a reason; removing a repayment needs a reason and is refused if it would make cash negative; a deleted loan's draft waits again.
- **Portfolio quality:** overdue loans by age (1–30, 31–60, 61–90, 90+ days), PAR 30/60/90 and a defaulters list that names the guarantor.

**Entry and accounting checks** ([docs/ENTRY_RULES.md](docs/ENTRY_RULES.md))
- 65 bad inputs were tried against every money entry; 32 were wrongly accepted and are now handled: impossible dates are refused (they used to be replaced by today), infinite or absurd amounts are refused, fractions of a paisa are rounded, a month before the member joined or more than a year ahead is refused, a second payment for a member and month **asks before replacing the first** (the old amount is logged), spending or investing more than the cash in hand asks first, and payment methods, categories and sectors must come from Master Data. Member fields and text lengths are checked.

**Performance and fixes** ([docs/PERFORMANCE.md](docs/PERFORMANCE.md))
- A covering index, faster date arithmetic, savings by date by binary search, no logo or avatar read on every call, one export per backup, report previews capped at 300 rows (exports use all rows). On a 500-member, 33,000-payment fund every operation is within its target; `npm run bench` repeats the measurement.
- Fixed: foreign keys switched off after any backup or sync export; a login lock that re-armed after it expired; money values cut off with "…" on narrow cards.

**Documentation and tests**
- New: LICENSING, GOOGLE_SYNC, LOANS, ENTRY_RULES, TESTING, PERFORMANCE and AUDIT documents; `npm run bench`; the sync, licence, loan and entry tests were extended (the licence suite now covers the offline counter, clock tricks and the signed record; the sync suite covers retention of 10, retry and the premium rule; the loan suite covers the policy, deletions and PAR).

**Behaviour changes to expect after upgrading**
- Existing funds get the strict loan defaults (change them in *Loan policy*). Deleting a loan is Admin-only. Recording a second payment for a month now asks first. Google sync is off until `iqbal_labs` switches it on. Run the latest `docs/supabase/license.sql` once.

## 2.8.0, 2026-11-14

- **Personal loans, consent and guarantors:** loan applications as drafts, a printable consent paper, signed-paper upload (SHA-256), guarantors (member or outsider with National ID), disbursement only after the paper is uploaded.
- **Module access:** per-user permissions (none / view / edit) per module, set only by `iqbal_labs`.
- **Google account sync and Drive backup** (Windows), with conflict protection and an optional sync PIN.
- **Licence control:** activation PINs, monthly payments (months and days), remote suspend, per-user and per-computer limits, a username allow-list, monitoring of computers and users, and the `iqbal_labs` License Control panel on a free Supabase project.
- **Committee investment reviews** with completion and outcomes.
- **Fines:** a separate Fines screen (who paid, where the money sits) and a books-balance proof; a randomised accounting stress test.
- **macOS build** for Apple silicon (`npm run dist:mac`, built on a Mac).

## 2.7.0, 2026-11-09
- **Personal Loans:** loan calculator (reducing, flat and interest-free), repayments, closure and write-off, accounting and reports.

## 2.6.1, 2026-11-08
- Excel format download and upload in Backup & Restore; collapsed sidebar icons centred.

## 2.6.0, 2026-11-08
- New Excel data-entry file with National ID; smoother sidebar; row shading.

## 2.5.1 and 2.5.0, 2026-11-07
- Collections layout, mint table headers and filters, a new sidebar toggle; larger UI, password eye toggle, print-friendly PDFs, code-signed as Iqbal Labs, static dialog close button.

## 2.4.1 and 2.4.0, 2026-11-07
- Startup hotfix (the window can never stay invisible; software rendering; error dialogs; a startup log).
- Mandatory National ID with NID search; redesigned PDF reports; member deletion restricted to the Super User.

## 2.3.x, 2026-11-06 to 2026-11-07
- Member settlement and investment returns (2.3.0); statement downloads, a No. column, profit and loss in Entry Center (2.3.2); Collections side panels and compact donut charts (2.3.3); sticky member columns (2.3.4); encrypted PIN backups with Super User recovery and unified PDF/Excel exports (2.3.5); correct Bangla and Hijri dates on Dhaka time (2.3.6); a one-click clear (×) button on every text field (2.3.7 to 2.3.9).

## 2.2.x, 2026-11-06
- Sign-in and roles, Excel member import with till-date collections, the accounting health check (2.2.0); late-fee card, Bangla toolbar fixes (2.2.1); faster startup and a smaller package (2.2.3); design overhaul: buttons, animated tabs, dialogs.

## 2.1.0 and earlier, 2026-11-05
- Profile screen, logo branding, searchable selects, date picker, full Bangla, Electron 35, signing-ready; the database moved to the main process with migrations, real metrics and safe backup and restore; ECharts overview, packaging and offline fonts.
