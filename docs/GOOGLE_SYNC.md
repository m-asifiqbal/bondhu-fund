# Google sync and Drive backup

Keeps the whole fund safe in the **user's own Google Drive** and the same on every computer. It is a **premium feature**, switched off until `iqbal_labs` turns it on for a computer.

For the one-time Google Cloud setup (Desktop client, consent screen, publishing), see [google_setup.md](google_setup.md). This page describes how the feature behaves.

- [1. The four rules](#1-the-four-rules)
- [2. Turning it on (premium) and who may use it](#2-turning-it-on-premium-and-who-may-use-it)
- [3. Signing in, and a new or replacement computer](#3-signing-in-and-a-new-or-replacement-computer)
- [4. What is stored in Drive](#4-what-is-stored-in-drive)
- [5. How a sync decides: push, pull, conflict](#5-how-a-sync-decides-push-pull-conflict)
- [6. Automatic backup](#6-automatic-backup)
- [7. Retention: only the newest 10](#7-retention-only-the-newest-10)
- [8. Failed attempts: retry after 10 seconds](#8-failed-attempts-retry-after-10-seconds)
- [9. Sync PIN (optional encryption)](#9-sync-pin-optional-encryption)
- [10. Drive backup files](#10-drive-backup-files)
- [11. Where things are kept on the computer](#11-where-things-are-kept-on-the-computer)
- [12. Troubleshooting](#12-troubleshooting)
- [13. Verification status](#13-verification-status)

---

## 1. The four rules

1. **Automatic backup** when the user has it switched on (the tick box *Back up my changes to Google Drive automatically*, on by default).
2. **Lost PC or lost data:** install the app on the new computer, sign in to it, sign in with the same Google account, and the data **comes back by itself**. No second step, no tension.
3. **Only the newest 10 copies are kept.** When an 11th is saved, the oldest is deleted.
4. **If a backup fails, it is tried again after 10 seconds**, automatically.

## 2. Turning it on (premium) and who may use it

- Every computer starts with Google sync **switched off for everybody**, including the Admin. The *Backup & Restore* cards show "Premium feature … ask the software provider (iqbal_labs)".
- **Only `iqbal_labs`** sees **Switch on for this computer** (and **Switch off** at the bottom of the same card). The switch is stored encrypted by Windows on that computer; a customer cannot turn it on by editing a file, and no other account can change it.
- Switching it off stops everything at once, **including background uploads**. An account that was signed in stays signed in; nothing in Google Drive is touched.
- Once it is on, the normal per-user permissions apply: modules **Google account sync** and **Google Drive backup**, set in *Users & Roles → Access*. The Admin role has them by default; only `iqbal_labs` can change a user's permissions.

## 3. Signing in, and a new or replacement computer

**Sign in with Google** opens the browser, the user allows access, and the app is connected. **Signing in also does the first sync immediately**:

| This computer | Google Drive | Result |
|---|---|---|
| has no data (new install, lost PC) | has data | the data is **pulled**: members, payments, loans, users and signed consent papers come back, and the app reloads |
| has data | is empty | the data is **uploaded** (the first backup) |
| has data | has data | nothing is overwritten: the user is asked which to keep ([section 5](#5-how-a-sync-decides-push-pull-conflict)) |
| has no data | is empty | nothing to do |

After a pull the user signs in to the app with their **usual username and password**, because the users are part of the restored data.

The app asks Google for only these permissions: `openid`, `email`, `profile` and **`drive.appdata`**, a hidden app-data folder that does **not** appear in drive.google.com and that no other app can read. It never sees the user's other Drive files. A customer can see (and clear) the app's hidden data in Google Drive → Settings → *Manage apps*.

## 4. What is stored in Drive

All of it lives in the hidden app-data folder:

| File | Content |
|---|---|
| `bondhu-sync-head.json` | which snapshot is current: revision, time, device, counts, documents |
| `bondhu-snap-<revision>-<device>.bfsnap` | the whole database as one snapshot, gzip-compressed, or **encrypted** when the sync PIN is on |
| `bondhu-doc-<sha256>` | a signed loan consent paper (uploaded once, checked by its SHA-256) |
| `bondhu-backup-<timestamp>.bfbak` | a manual Drive backup (see [section 10](#10-drive-backup-files)) |

## 5. How a sync decides: push, pull, conflict

Every snapshot has a **revision number**. Each computer remembers the revision it last synced and whether it has changed data since.

| Situation | Action |
|---|---|
| Drive unchanged since my last sync, and I changed something | **Push**: upload my data as a new revision |
| Drive has a newer revision and I changed nothing (new computer, or a second PC) | **Pull**: replace my data with Drive's (a safety copy of mine is kept first) |
| Drive is newer **and** I changed things (two PCs edited separately) | **Conflict**: nothing is overwritten until the user chooses which side to keep; the other side is saved first so it can still be recovered |
| Drive was rolled back below my revision | Push (this computer holds the newer data) |
| Another computer pushed while this one was uploading | The upload is abandoned and the half-uploaded copy removed; nothing is overwritten |

Checks that protect the data: the downloaded snapshot's SHA-256 must match the index; each signed paper is checked by its hash and downloaded before anything is replaced; a safety snapshot of the current data is made before a pull; a different Google account starts from scratch.

## 6. Automatic backup

- **About 20 seconds after the app starts**: a full, safe sync (it can push or pull).
- **Every 10 minutes**, when this computer has unsynced changes: **push only**. Background syncing **never replaces data while someone may be working**; if newer data is waiting in Drive it says so and waits for **Sync now**.
- It runs only when the premium switch is on, a Google account is connected, and the tick box is on.

## 7. Retention: only the newest 10

- **10 synced copies** (snapshots) and **10 Drive backup files**, counted separately.
- When a new one is saved and there are more than 10, the **oldest are deleted**. The current snapshot is never deleted.
- Backup names include the **millisecond**, so "oldest" is always the genuinely oldest.
- Signed papers no longer used by the current snapshot are removed.

## 8. Failed attempts: retry after 10 seconds

- A sync or a Drive backup that fails because of **no connection** or a **Google hiccup** is tried again **10 seconds** later, up to **5 more times**.
- The screen shows *"Last attempt: … Trying again in 10 seconds (2 of 5)"* and refreshes itself while retrying.
- Not retried (waiting would not help): an **expired Google sign-in**, a **full Drive**, **not signed in**, a **cancelled** sign-in. These are reported, and the next automatic run tries again.
- A failure after the snapshot was uploaded (for example while writing the index) **removes the half-uploaded copy**, so a retry starts clean and no stray file is left.
- Only one sync runs at a time.

## 9. Sync PIN (optional encryption)

*Protect the cloud copy with a sync PIN* encrypts the snapshots with the user's PIN. A **new computer asks for the PIN once**. Without the PIN the cloud copy cannot be opened (by anyone, including the vendor). A wrong PIN is reported, never applied.

## 10. Drive backup files

*Google Drive backup* saves the normal **PIN-encrypted backup file** (the same format as a local backup) in the hidden folder, and restores it from any computer: *Back up to Google Drive*, *Refresh*, *Restore*, *Delete*. Restoring replaces all data after a safety snapshot. Local backups on the computer are separate and keep working as before.

## 11. Where things are kept on the computer

`%APPDATA%\Bondhu Fund\google\`:

| File | Content |
|---|---|
| `account.json` | the connected account; the refresh token is sealed with Windows secure storage |
| `config.json` | Google credentials entered inside the app (sealed); builds can also have them built in |
| `sync-state.json` | revision, last sync, "unsynced changes", auto on/off, last result |
| `vault.json` | sealed secrets: the sync PIN and the **premium switch** |

## 12. Troubleshooting

| Message or symptom | Cause and fix |
|---|---|
| "Premium feature …" | Not switched on for this computer. Sign in as `iqbal_labs` and switch it on. |
| Google says *access blocked* or the app is unverified | The Google consent screen is still in **Testing**: publish it, or add the account as a test user (see [google_setup.md](google_setup.md)). |
| "Google is not set up on this computer yet" | No Desktop client credentials in this build: paste them in *Set up Google* (iqbal_labs) or build them in (`config/google.json`). |
| "Your Google sign-in has expired" | Sign in with Google again. |
| "Your Google Drive storage is full" | Free space in Google Drive. |
| "Choose which data to keep" | Both this computer and Drive changed. Pick the side to keep; the other is saved first. |
| "Enter the sync PIN" | The cloud copy is encrypted: enter the PIN once. |
| "Trying again in 10 seconds" | A temporary problem; leave it. If all 5 retries fail, press **Sync now** later. |

## 13. Verification status

Covered by `npm run test:gsync` (about 90 checks against a fake Google server): first upload, pull on a fresh computer, push after changes, conflicts (nothing overwritten, safety copy made), a different account, the sync PIN, damaged downloads, a download that fails halfway, signed papers, retention of exactly 10, retry after failures (success on a later try, giving up after the last retry, no retry for a full Drive, half-uploaded copy removed), retry of Drive backups, and the premium rule.

Run against the **real app** (isolated profile): the Google credentials are built in, the sign-in link carries the Desktop client ID, `drive.appdata` only and PKCE, Google's own server accepts the link and shows its sign-in page, and a cancelled sign-in comes back cleanly. A premium-switch test with an Admin and a Manager passes.

**Not yet verified end to end:** a real sign-in followed by a real upload and restore with a real Google account. That needs the account holder to sign in once. Do it before relying on it: sign in, press **Sync now**, then check in a second install that the data comes back.
