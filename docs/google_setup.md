# Google sync & Drive backup — setup (one time)

Bondhu Fund uses the **same Google Cloud project as the FocusFlow app**, and the same Drive permission:
`https://www.googleapis.com/auth/drive.appdata` — a hidden app-data folder in the user's Google Drive that
does not appear in drive.google.com and that no other app can read. Nothing else in Drive is touched.

FocusFlow already has an OAuth consent screen, the Drive API enabled and a *Web* client (for Android). A Windows
desktop app needs one more client of type **Desktop app** in that same project. That is the only thing missing,
and it can only be created in the Google Cloud console (it needs your Google login).

## 0. Premium: only iqbal_labs gives or takes this feature

Google account sync and Google Drive backup are a **premium feature**. On every computer they start **switched off**, for everybody (the Admin included).
- **Switch on / off for a computer:** sign in as `iqbal_labs` → *Backup & Restore* → *Google account sync* → **Switch on for this computer**
  (and **Switch off** at the bottom of the same card). The switch is kept encrypted by Windows on that computer; a customer cannot turn it on by editing a file,
  and no other account can change it. Switching it off stops everything at once, including the background uploads. Nothing in Google Drive is touched.
- **Who may use it once it is on:** the per-user permissions still apply. The Admin role has it by default; give or take it for any user in
  *Users & Roles → Access* (modules *Google account sync* and *Google Drive backup*). Only iqbal_labs can change these permissions.
- While it is off, the screens show "Premium feature … ask the software provider" and every Google operation is refused.

## 1. Create the Desktop client (2 minutes)

1. Open <https://console.cloud.google.com/> and select the **FocusFlow project** (the one whose client ID starts with `348478…`).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
3. Application type: **Desktop app**. Name: `Bondhu Fund Desktop`. Create.
4. Copy the **Client ID** and the **Client secret** shown.
   For a desktop app Google does not treat the secret as confidential, but keep it out of git anyway.

## 2. Check the consent screen

- **APIs & Services → OAuth consent screen**: scope `…/auth/drive.appdata` must be listed (FocusFlow already added it).
- If the app is in **Testing** status, add every Google account that will use Bondhu Fund as a *test user*,
  and note that Google expires sign-ins of Testing apps after **7 days**. `drive.appdata` is a non-sensitive scope,
  so you can click **Publish app** (no review needed) and sign-ins stay valid.

## 3. Give the credentials to Bondhu Fund — pick one

**A. Inside the app (no rebuild).** Sign in as `iqbal_labs` → *Backup & Restore* → *Google account sync* →
*Set up Google* → paste the Client ID and Client secret. They are stored encrypted by Windows (DPAPI) on that computer.
Repeat on each computer, or use B.

**B. Build them into the program.** Copy `config/google.example.json` to `config/google.json` (git-ignored), paste the two
values, then build as usual (`npm run build:all` and `npx electron-builder …`). Every installer then ships with Google sync ready.

## 4. Use it

- **Sign in with Google.** Signing in also does the first sync at once. The first computer uploads everything; there is no second step.
- On a **new computer** (or after a lost PC or lost data): install the app, sign in to it, open *Backup & Restore → Google account sync* and
  sign in with the same Google account. That is all: the data comes back by itself (members, payments, loans, users and the signed consent
  papers) and the app reloads. If the new computer already holds its own data as well, nothing is overwritten: you are asked which to keep.
- Two computers with the same Google account stay in step: whichever syncs last data up, the other one gets it on its next *Sync now*.
  If both computers changed data separately, the app never overwrites silently: you choose which data to keep, and the other side
  is saved as a safety copy first.
- *Protect cloud data with a sync PIN* (optional) encrypts the cloud copy. A new computer then asks for that PIN once.
- **Automatic backup** (the tick box *Back up my changes to Google Drive automatically*, on by default) uploads changes in the background every
  10 minutes and when the app starts.
- **Only the newest 10 are kept.** Ten synced copies and ten Drive backup files; when an 11th is saved the oldest is deleted.
- **If an upload fails** (no internet, a Google hiccup) the app tries again by itself **after 10 seconds, up to 5 more times**. The screen shows
  "Trying again in 10 seconds (2 of 5)". A full Drive or an expired Google sign-in is not retried (waiting would not help); it is reported
  and the next automatic run tries again.
- *Google Drive backup* saves a normal PIN-encrypted backup file in the same hidden Drive folder (the newest 10 are kept).
  Local backups on the computer keep working exactly as before.

Who may use these features is set per user by the Super User in *Users & Roles → Access* (modules **Google account sync** and **Google Drive backup**).
