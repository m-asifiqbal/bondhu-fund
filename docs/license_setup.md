# Licence control (activation PIN, monthly payments, remote lock) — setup

Everything runs on your free Supabase project (`bondhu_app`). The desktop app needs **no extra package**; it talks to Supabase over HTTPS.

## What it does
- **Limits per licence:** when you create a customer you set **how many computers** may use the PIN (1, 2, 3 …) and **how many users** may sign in (a number, or empty = any number). You decide per sale. A tagged PIN is always for one user.
- **Activation PIN:** 12 characters, `XXXX-XXXX-XXXX`. It can be **tagged to a username** (type that username when you create the customer):
  only that user is asked for the PIN, and only that user is locked when it expires or is suspended.
  Without a tag the PIN covers **every user on the computer**.
- **When it is asked:** a user types username and password. If the password is right and the user has no licence yet, the app asks for
  the PIN **once** (the computer needs the internet for that step). Each computer enters the PIN once, up to the number of computers allowed (a further computer is refused). With a user limit, a user is **counted the first time they sign in** (online, no PIN needed on an already activated computer); a user beyond the limit is refused.
- **Monitoring:** the *Computers and users* button on each customer lists every computer (name, app version, last user, last seen, online now) and every counted user. *Remove* frees a place: a removed computer is locked at its next check, a removed user is counted again if they sign in again.
- **Who is let in:** a user, when their own licence or the whole-computer licence is active. **iqbal_labs is never asked**, so you can always fix things.
- **Monthly payments:** each licence has a *paid-until* date. *Payment* records the amount (cash), the months **and extra days** and extends the date
  (from today if it had already lapsed, otherwise after the current end date). When the date passes, that licence locks by itself.
- **Remote lock:** *Suspend* locks that licence's user (or the whole computer, for an untagged PIN) at the next check (every 10 minutes while
  the app is open and online): they are signed out, cannot sign in, and see your message. *Resume* opens it again; a refused sign-in re-checks
  the server once, so a renewal works straight away.
- **Nothing is ever deleted.** A lock only blocks signing in. The data stays on the customer's computer and the app opens again the moment the licence is active.
  Anything a user had typed but not saved is lost when they are signed out, so suspend outside working hours.
- **Offline copies** keep working until their paid-until date, but not longer than 14 days after the last successful check. Turning the PC clock back
  does not help (the app remembers the latest time it has seen, and the server's clock wins whenever it is online).

## One-time setup (about 5 minutes)
1. Supabase → project → **SQL Editor** → New query → paste all of `docs/supabase/license.sql` → **Run**.
   (Run it again after updating the app: it adds the new parts and keeps your customers.)
2. **Authentication → Users → Add user → Create new user**: your email and a long password, tick *Auto Confirm User*.
3. **Authentication → Sign In / Providers → Email**: turn **off** *Allow new users to sign up*.
4. In the SQL editor run (your email in it):
   `insert into public.bf_admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;`
5. Bondhu Fund → sign in as iqbal_labs → **License Control** → sign in with that email and password.

## Who may sign in: the user list (allowlist)
- Accounts and passwords stay **on the customer's computer** (the app works offline). **You decide, in Supabase, which usernames may sign in.**
- When you create a customer, type the usernames in *Users who may sign in* (for example `cashier1, manager`) and leave *Only these users may sign in* ticked. The names are stored in your Supabase.
- A username that is not on the list is **refused** at sign-in, even if the customer creates that account in their own app. Passwords never leave the customer's computer.
- Add or remove names any time: *Computers and users* → **Add a user** / **Remove**. A new name works at once: a refused sign-in re-checks the server before giving up. A removed name is refused (and signed out) within about 10 minutes.
- The list is also the user limit: with *Users allowed* = 5 you can list at most 5 names. Without the tick, any username is accepted up to the limit and counted the first time it signs in.
- A PIN tagged to one username has no list (it is for that one user).

## Selling to a customer (cash)
1. License Control → **New customer**. Type the customer's name, choose **computers allowed** and **users allowed**, and the first paid months. Only for a per-user PIN, also type that user's **username** exactly as in the customer's app.
2. Give the 12-character PIN to the customer after they pay. Each further month: **Payment** → months and amount.
3. A customer with 3 computers and 5 users: one row, computers 3, users 5, the five usernames in the list, one PIN given to everyone. Per-person PINs: one tagged row per user.

## Switching locking on
`config/supabase.json` (git-ignored) holds the project URL and the *publishable* key (public by design: it can only call `bf_activate` and `bf_check`).
It ships with `"LICENSE_ENFORCE": false`: customers can be created and the panel works, but no copy asks for a PIN yet.
When you are ready, set `"LICENSE_ENFORCE": true`, run `npm run build:all`, and build the installer. **Try it on your own test copy first.**

## Keep in mind
- A free Supabase project **pauses after 7 days without activity**. Open copies check in every 10 minutes, which keeps it awake; if it ever pauses, restore it from the dashboard. Copies stay open meanwhile (14-day offline grace).
- Never put the database password or the `service_role` key in the app. The app only ever has the publishable key; your admin sign-in is a normal Supabase user kept encrypted by Windows on your computer.
- There is no auto-update: customers whose copy is older than a locking build have no lock and are not affected until they install it.
- A determined programmer can modify any desktop program. This stops ordinary users, not experts.
