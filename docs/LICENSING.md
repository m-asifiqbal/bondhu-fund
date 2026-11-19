# Licensing: how it works, online and offline

Bondhu Fund can be sold as a monthly licence. A customer's copy needs an **activation PIN**, runs while the licence is **paid up**, and can be **locked remotely**. It still works **offline**, but a copy cannot stay offline forever, and it cannot be kept alive by setting the PC clock back.

This page is the design and operating reference. For the one-time Supabase setup, see [license_setup.md](license_setup.md). The SQL is [supabase/license.sql](supabase/license.sql).

- [1. The pieces](#1-the-pieces)
- [2. Who is exempt, and what a build enforces](#2-who-is-exempt-and-what-a-build-enforces)
- [3. A copy's life: activate, check in, lock](#3-a-copys-life-activate-check-in-lock)
- [4. Lock reasons](#4-lock-reasons)
- [5. Offline rules](#5-offline-rules)
- [6. The offline counter and its report](#6-the-offline-counter-and-its-report)
- [7. Clock tricks and a tampered record](#7-clock-tricks-and-a-tampered-record)
- [8. Licence models: computer, user, allow-list](#8-licence-models-computer-user-allow-list)
- [9. The vendor panel (License Control)](#9-the-vendor-panel-license-control)
- [10. Server tables and functions](#10-server-tables-and-functions)
- [11. Constants](#11-constants)
- [12. What it cannot do](#12-what-it-cannot-do)
- [13. Runbook](#13-runbook)
- [14. Verification status](#14-verification-status)

---

## 1. The pieces

| Piece | Where | Job |
|---|---|---|
| **Supabase project** `bondhu_app` (free plan is enough) | cloud | Keeps customers, PINs, paid-until dates, computers, users and payments. Row-level security allows only the vendor's own Supabase login to read or write tables. |
| **Three public functions** `bf_activate`, `bf_check`, `bf_register_user` | Supabase (SQL) | The only things an installed copy may call, using the *publishable* key (public by design). They return what that PIN is allowed, never other customers' data. |
| **`LicenseClient`** ([electron/license.ts](../electron/license.ts)) | every installed copy | Activates a PIN, checks in every 10 minutes, decides "may this user sign in?". No Electron or database imports, so it is unit-tested against a fake server. |
| **`LicenseAdmin`** (same file) | the `iqbal_labs` panel only | Signs in to Supabase and manages customers, PINs and payments. |
| **Glue** ([electron/license-main.ts](../electron/license-main.ts)) | main process | Where the record and the secrets are kept (Windows secure storage), the 30-second counter timer, and the sign-in gate. |
| **License Control** ([src/views/LicenseControlView.tsx](../src/views/LicenseControlView.tsx)) | `iqbal_labs` only | The panel. |

Build-time configuration lives in `config/supabase.json` (git-ignored): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `LICENSE_ENFORCE`. Example: [config/supabase.example.json](../config/supabase.example.json).

## 2. Who is exempt, and what a build enforces

- A build with `LICENSE_ENFORCE: false` (the default in `config/supabase.json`) **never locks anything**. Use it for development and for your own copy.
- A build with `LICENSE_ENFORCE: true` locks every account **except `iqbal_labs`**. The owner account is never asked for a PIN and is never locked, so you cannot lock yourself out.
- Locking **never deletes or changes data**. It only stops the affected accounts from signing in or continuing. The moment the licence is active again, the app opens as before.

## 3. A copy's life: activate, check in, lock

1. **Activation.** The first non-owner sign-in on a locked copy asks for the **PIN** (12 letters and digits, shown as `ABCD-EFGH-JKLM`). `bf_activate` registers the computer (an install id, the computer name, the app version) and returns a **device token**. The token is kept encrypted in Windows secure storage (DPAPI), never in a readable file.
2. **Check-in** every **10 minutes** while the app is open, and once about 3 seconds after start. `bf_check` returns the licence's status, paid-until date, message, and limits, and records who signed in. The **server's clock** is used for the date: online, the PC clock is corrected against it.
3. **Decision.** Every sign-in asks `gate(username)`: the user's own licence or the computer's licence, whichever lets them in (the one running longest wins).
4. **Lock.** When a check-in reports *suspended*, *revoked* or *past paid-until*, the signed-in user is signed out at once and the sign-in screen explains why. A running copy that is only *offline* is not locked until a rule in [section 5](#5-offline-rules) says so.

## 4. Lock reasons

| Reason | Meaning | How it clears |
|---|---|---|
| `not_activated` | No PIN entered on this computer | Enter a PIN |
| `invalid` | The server no longer knows this computer (PIN reset or computer removed) | Enter the new PIN |
| `suspended` | You paused the licence in the panel | Press **Resume** |
| `revoked` | You withdrew the licence | Restore it in the panel |
| `expired` | The paid-until date has passed | Record a payment (months and/or days) |
| `needs_check` | Offline for too long (see below) | Connect to the internet once |
| `clock` | The PC date was set back, or the saved licence record failed its signature | Connect to the internet once |
| `not_registered` | A new user on a limited customer licence must be counted online, once | Connect to the internet |
| `not_allowed` | The username is not on the customer's allow-list | Add the name in the panel |

A copy locked for `expired`, `suspended` or `revoked` opens again by itself a few minutes after you fix it, or at once with **Check again**.

## 5. Offline rules

An offline copy keeps working, **until the first of**:

1. the **paid-until date** passes (compared with the PC clock while offline; the server's clock wins as soon as it is online);
2. **14 days of actual use** without a successful check-in (the *offline counter*, section 6);
3. **14 days on the calendar** since the last successful check-in;
4. a **clock change or an altered record** is detected (section 7).

While offline, the main screen shows an amber bar: *"Working offline. This computer must connect to the internet within N day(s) of use so the licence can be confirmed."* A user can still sign in offline while the licence is valid.

## 6. The offline counter and its report

- The main process adds the time the app has been **running** since the last successful check-in every **30 seconds**. It uses the computer's **monotonic timer**, not the date, so **changing the date cannot reduce the counter**.
- A computer that sleeps, or an app that hangs, adds at most 2 minutes per 30-second tick, so a long pause is not counted as use.
- The counter is saved to disk at least once a minute and survives restarts.
- At the next successful check-in the copy **reports** the counter to Supabase and then resets it. Only stretches longer than **30 minutes** are reported (ordinary gaps between two check-ins are not "offline").
- Reported per computer in `bf_devices`: `offline_seconds_total`, `offline_stretches`, `longest_offline_seconds`, `last_offline_seconds`, `last_offline_at` and `clock_rollbacks`.
- The panel (**Computers and users**) shows them as: *total offline 15d 0h · last stretch … · longest …* and *clock set back N×*. A computer that has always been online shows *Always online so far*.
- Only **one** check-in runs at a time. A second request (the timer plus a manual **Check again**) waits for the first, so a stretch is never reported twice.

## 7. Clock tricks and a tampered record

| Attempt | What happens |
|---|---|
| Set the PC date **back** (more than 10 minutes) | The latest time ever seen is remembered; the copy is **locked** (`clock`) and goes online at once to confirm. One successful check-in clears it. It is counted once per episode, however often the app is restarted, and reported to you as *clock set back N×*. |
| Small correction (a few minutes, time sync) | Ignored (10-minute tolerance). |
| Set the date **forward** | No gain: the paid-until date is compared with that later time, so it locks sooner. |
| Edit the saved licence record by hand | The record is signed (HMAC) with a key held in Windows secure storage. A record that does not verify is **not trusted**: the copy locks (`clock`) until one online check-in. |
| Delete the record | The computer is no longer registered, and a new PIN is needed (and a device slot is used). |
| Delete the key | Same as an unverifiable record. |
| Restore an *older copy* of the whole data folder | Not detected as such. The 14-day rules and the server's clock still bound it, and you see the odd history in the panel. |

A copy upgraded from 2.8.0 holds an **unsigned** record, so its first start needs **one online check-in**; until then a copy that starts offline shows the "date or record was changed" screen.

## 8. Licence models: computer, user, allow-list

- **Computer licence** (a PIN not tied to a name): covers everyone who signs in on that computer. Limits: **max computers** and optionally **max users**.
- **User licence** (a PIN tied to one username): only that person needs it; other users on the same PC are unaffected.
- **Allow-list** (`restrict_users`): only the usernames you added in the panel may sign in; anyone else is refused with `not_allowed`. Accounts and passwords stay on the customer's computer; **you decide in Supabase which usernames may use the licence**.
- A user's own licence and the computer's licence can both exist; the one with the later paid-until date lets them in.

## 9. The vendor panel (License Control)

Only `iqbal_labs` sees it. Sign in with the Supabase admin email and password (kept encrypted on that computer). It offers:

- **New customer** (name, contact, monthly fee, first period in **months and days**, message, max computers, max users, optional username tag) and shows the **PIN once** to copy.
- **Payment** (months and/or days, amount; cash is the only method) which extends from the later of today and the current end date.
- **Suspend / Resume**, **Revoke**, **edit** the message and limits.
- **Computers and users**: each computer's name, version, last user, last seen, online/offline history, and a button to **remove** a computer; the user list with notes and last seen; add or remove allow-list names.
- **Reset PIN / release computers** (a lost PC): every computer is released and the licence gets a new PIN.
- Cards: customers, active, ending in 7 days, locked, monthly fees, collected this month.

## 10. Server tables and functions

| Object | Purpose |
|---|---|
| `bf_admins` | Supabase auth users allowed to administer. |
| `bf_licenses` | Customer, PIN, status (`active`, `suspended`, `revoked`), `paid_until`, `monthly_fee`, `message`, `max_devices`, `max_users`, `restrict_users`, optional `username` tag. |
| `bf_devices` | One row per computer: install id, device token, name, version, last user, first/last seen, **offline columns** (section 6). |
| `bf_license_users` | Usernames seen under a licence, or allow-listed, with notes and last seen. |
| `bf_license_payments` | Payment history: amount, months, **days**, paid on, period from/to. |
| `bf_activate(pin, install, device, version, username?)` | Anonymous. Registers the computer, returns a token and the licence payload. Refuses wrong PIN, other user's PIN, too many computers, too many or unlisted users, revoked. |
| `bf_check(token, device, version, users[], offline_seconds, rollbacks)` | Anonymous. Regular check-in; records users and the offline report (numbers are capped on the server). |
| `bf_register_user(token, username)` | Anonymous. Counts a new user against `max_users`. |
| `bf_extend(license, months, amount, method, note, paid_on, days)` | Admin only. Records a payment and moves `paid_until`. |

Run the latest [license.sql](supabase/license.sql) after every upgrade; it is safe to run again. Older copies keep working against newer SQL.

## 11. Constants

| Name | Value | Where |
|---|---|---|
| Check-in interval | 10 minutes | `CHECK_EVERY_MS` |
| Counter tick | 30 seconds | `TICK_MS` |
| Offline allowance | 14 days (use and calendar) | `OFFLINE_GRACE_DAYS` |
| Report an offline stretch after | 30 minutes | `OFFLINE_REPORT_AFTER_MS` |
| Clock-back tolerance | 10 minutes | `ROLLBACK_TOLERANCE_MS` |
| Licence request timeout | 15 seconds | `rpc()` |

## 12. What it cannot do

- It **cannot make offline use impossible**; it makes it bounded (14 days of use) and visible.
- The numbers a copy reports come from the customer's PC, so use them for **monitoring**, not as proof. The rules themselves are enforced inside the app.
- A technically skilled person who restores an older copy of the whole data folder can replay old state; the server's clock and the 14-day rules limit how far that goes.
- The free Supabase plan **pauses after 7 days without activity**. Open copies check in every 10 minutes, which keeps it awake; if it ever pauses, restore it from the dashboard. Copies stay open meanwhile (offline rules).

## 13. Runbook

| Situation | Do this |
|---|---|
| New customer | License Control → New customer → copy the PIN → give it to them. |
| Customer paid | Payment → months/days. They unlock within minutes. |
| Customer did not pay | Suspend (blocks the next check-in, not data) or let it expire. |
| Lost PC | Reset PIN / release computers, give the new PIN. |
| A user keeps seeing "needs to confirm online" | Offline for 14 days of use: connect once. |
| "Date or record was changed" | Connect to the internet and press **Check again**. If it repeats, look at *clock set back N×* in the panel. |
| Supabase paused | Restore the project in the Supabase dashboard. |
| Seeing a copy's offline history | License Control → the customer → Computers and users. |

## 14. Verification status

Covered by automated tests (`npm run test:license`, 160+ checks against a fake Supabase): activation, every lock reason, remote suspend/resume, expiry and payments, offline grace, clock set back, signed-record tamper detection, the offline counter and its report, one check-in at a time, per-user and allow-list rules.

Also run end to end with the **real packaged exe** and the **real Supabase** (a throw-away customer was created and deleted afterwards): online activation, offline start with the network cut, a normal user signing in offline, 15 days of use offline locking the app, clock set back, one online check-in clearing each case, and remote suspend/resume. Waiting a real 15 days and changing the PC clock were simulated by writing correctly signed records, not done for real.
