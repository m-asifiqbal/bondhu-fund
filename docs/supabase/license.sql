-- Bondhu Fund licensing (activation PIN, monthly payments, remote lock, computer and user limits)
-- Run in Supabase: project "bondhu_app" -> SQL Editor -> New query -> paste all -> Run.
-- It is safe to run again, also after an update of the app: it creates what is missing, moves old data to the new layout
-- and refreshes the functions. Your customers and payments are kept.
--
-- Who can do what
--   * The desktop apps use only the public (publishable) key and can call exactly three functions:
--       bf_activate(pin, ...), bf_check(token, ...) and bf_register_user(token, username).
--     They cannot read or change any table.
--   * You (the vendor) sign in inside the app (License Control) as a Supabase user listed in bf_admins;
--     row-level security gives only that user access to the tables.
--
-- A licence = one PIN with: a paid-until date, "max computers" and "max users".
--   max_users empty = any number of users.  username (optional tag) = the PIN is for that one user only.
--   restrict_users = true: only the usernames you add to the licence may sign in (a user allowlist kept here, not on the customer's computer).

-- ---------------------------------------------------------------------------------------------- tables
create table if not exists public.bf_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.bf_licenses (
  id           uuid primary key default gen_random_uuid(),
  customer     text not null,
  username     text,                                       -- the app user this PIN is for; empty = for the whole customer
  contact      text,
  notes        text,
  pin          text not null unique,                       -- 12 letters/digits, shown to you as XXXX-XXXX-XXXX
  status       text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  paid_until   timestamptz,                                -- null = no expiry
  monthly_fee  numeric(12, 2) not null default 0,
  message      text,                                       -- shown to the customer when they are locked
  max_devices  int not null default 1 check (max_devices between 1 and 1000),
  max_users    int check (max_users is null or max_users between 1 and 1000),
  restrict_users boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.bf_licenses add column if not exists username text;
alter table public.bf_licenses add column if not exists max_devices int not null default 1;
alter table public.bf_licenses add column if not exists max_users int;
alter table public.bf_licenses add column if not exists restrict_users boolean not null default false;

-- the computers that use a licence
create table if not exists public.bf_devices (
  id          uuid primary key default gen_random_uuid(),
  license_id  uuid not null references public.bf_licenses (id) on delete cascade,
  install_id  text not null,
  token       text not null unique,
  device_name text,
  app_version text,
  last_user   text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (license_id, install_id)
);

-- the users who have signed in under a licence
create table if not exists public.bf_license_users (
  id         uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.bf_licenses (id) on delete cascade,
  username   text not null,
  note       text,                                         -- e.g. the person's name; for your eyes only
  first_seen timestamptz not null default now(),
  last_seen  timestamptz,                                  -- empty until that user has signed in
  unique (license_id, username)
);
alter table public.bf_license_users add column if not exists note text;
alter table public.bf_license_users alter column last_seen drop not null;
alter table public.bf_license_users alter column last_seen drop default;

create table if not exists public.bf_license_payments (
  id         uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.bf_licenses (id) on delete cascade,
  amount     numeric(12, 2) not null default 0,
  months     int not null default 1,
  days       int not null default 0,
  paid_on    date not null default current_date,
  method     text,
  note       text,
  period_from timestamptz,
  period_to   timestamptz,
  created_at timestamptz not null default now()
);
alter table public.bf_license_payments add column if not exists days int not null default 0;
create index if not exists bf_license_payments_license_idx on public.bf_license_payments (license_id, paid_on desc);

-- move an older layout (one computer stored on the licence itself) to the devices table
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bf_licenses' and column_name = 'install_id') then
    insert into public.bf_devices (license_id, install_id, token, device_name, app_version, first_seen, last_seen)
      select id, install_id, device_token, device_name, app_version, coalesce(activated_at, created_at), coalesce(last_seen, now())
        from public.bf_licenses where install_id is not null and device_token is not null
      on conflict do nothing;
    alter table public.bf_licenses
      drop column install_id, drop column device_token, drop column device_name, drop column app_version, drop column activated_at, drop column last_seen;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------- security
alter table public.bf_admins           enable row level security;
alter table public.bf_licenses         enable row level security;
alter table public.bf_devices          enable row level security;
alter table public.bf_license_users    enable row level security;
alter table public.bf_license_payments enable row level security;

revoke all on public.bf_admins, public.bf_licenses, public.bf_devices, public.bf_license_users, public.bf_license_payments from anon;
revoke all on public.bf_admins from authenticated;
grant select on public.bf_admins to authenticated;
grant select, insert, update, delete on public.bf_licenses, public.bf_devices, public.bf_license_users, public.bf_license_payments to authenticated;

create or replace function public.bf_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bf_admins where user_id = auth.uid());
$$;

drop policy if exists bf_admins_self on public.bf_admins;
create policy bf_admins_self on public.bf_admins for select to authenticated using (user_id = auth.uid());

drop policy if exists bf_licenses_admin on public.bf_licenses;
create policy bf_licenses_admin on public.bf_licenses for all to authenticated
  using (public.bf_is_admin()) with check (public.bf_is_admin());

drop policy if exists bf_devices_admin on public.bf_devices;
create policy bf_devices_admin on public.bf_devices for all to authenticated
  using (public.bf_is_admin()) with check (public.bf_is_admin());

drop policy if exists bf_license_users_admin on public.bf_license_users;
create policy bf_license_users_admin on public.bf_license_users for all to authenticated
  using (public.bf_is_admin()) with check (public.bf_is_admin());

drop policy if exists bf_payments_admin on public.bf_license_payments;
create policy bf_payments_admin on public.bf_license_payments for all to authenticated
  using (public.bf_is_admin()) with check (public.bf_is_admin());

-- ---------------------------------------------------------------------------------------------- what an app may call
create or replace function public.bf_license_payload(l public.bf_licenses)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'customer', l.customer, 'username', l.username, 'status', l.status, 'paid_until', l.paid_until,
    'message', coalesce(l.message, ''), 'server_time', now(),
    'max_devices', l.max_devices, 'max_users', l.max_users, 'restrict_users', l.restrict_users,
    'users', coalesce((select jsonb_agg(u.username order by u.username) from public.bf_license_users u where u.license_id = l.id), '[]'::jsonb));
$$;
revoke all on function public.bf_license_payload(public.bf_licenses) from public, anon, authenticated;

-- First use of a PIN on a computer. A computer counts against "max computers" the first time it uses the PIN,
-- the signing-in user counts against "max users". A PIN tagged to a username only works for that user.
drop function if exists public.bf_activate(text, text, text, text);
create or replace function public.bf_activate(p_pin text, p_install text, p_device text, p_version text, p_username text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.bf_licenses;
  d public.bf_devices;
  have_dev boolean;
  tok text;
  uname text := lower(btrim(coalesce(p_username, '')));
  clean text := upper(regexp_replace(coalesce(p_pin, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if length(clean) < 8 or coalesce(length(p_install), 0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;
  select * into l from public.bf_licenses where pin = clean for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_pin'); end if;
  if l.status = 'revoked' then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  if nullif(btrim(l.username), '') is not null and lower(btrim(l.username)) <> uname then
    return jsonb_build_object('ok', false, 'error', 'wrong_user');
  end if;

  select * into d from public.bf_devices where license_id = l.id and install_id = p_install;
  have_dev := found;
  if not have_dev and (select count(*) from public.bf_devices where license_id = l.id) >= l.max_devices then
    return jsonb_build_object('ok', false, 'error', 'device_limit');
  end if;

  if uname <> '' and not exists (select 1 from public.bf_license_users where license_id = l.id and username = uname) then
    if nullif(btrim(l.username), '') is null and l.restrict_users then
      return jsonb_build_object('ok', false, 'error', 'user_not_allowed');
    end if;
    if nullif(btrim(l.username), '') is null and l.max_users is not null
       and (select count(*) from public.bf_license_users where license_id = l.id) >= l.max_users then
      return jsonb_build_object('ok', false, 'error', 'user_limit');
    end if;
    insert into public.bf_license_users (license_id, username, last_seen) values (l.id, uname, now());
  elsif uname <> '' then
    update public.bf_license_users set last_seen = now() where license_id = l.id and username = uname;
  end if;

  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  if have_dev then
    update public.bf_devices set token = tok, device_name = left(p_device, 80), app_version = left(p_version, 40),
           last_user = coalesce(nullif(uname, ''), last_user), last_seen = now() where id = d.id;
  else
    insert into public.bf_devices (license_id, install_id, token, device_name, app_version, last_user)
    values (l.id, p_install, tok, left(p_device, 80), left(p_version, 40), nullif(uname, ''));
  end if;
  return jsonb_build_object('ok', true, 'token', tok) || public.bf_license_payload(l);
end $$;

-- The regular check-in (every few minutes while the app is open and online). p_users = who signed in since the last check.
drop function if exists public.bf_check(text, text, text);
create or replace function public.bf_check(p_token text, p_device text, p_version text, p_users text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.bf_devices;
  l public.bf_licenses;
  u text;
  last_u text;
begin
  if coalesce(length(p_token), 0) < 40 then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  select * into d from public.bf_devices where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  select * into l from public.bf_licenses where id = d.license_id;

  foreach u in array coalesce(p_users, array[]::text[]) loop
    u := lower(btrim(coalesce(u, '')));
    continue when u = '';
    last_u := u;
    if exists (select 1 from public.bf_license_users where license_id = l.id and username = u) then
      update public.bf_license_users set last_seen = now() where license_id = l.id and username = u;
    elsif not l.restrict_users and (nullif(btrim(l.username), '') is not null or l.max_users is null
          or (select count(*) from public.bf_license_users where license_id = l.id) < l.max_users) then
      insert into public.bf_license_users (license_id, username, last_seen) values (l.id, u, now());
    end if;
  end loop;

  update public.bf_devices
     set last_seen = now(), device_name = left(coalesce(p_device, device_name), 80), app_version = left(coalesce(p_version, app_version), 40),
         last_user = coalesce(last_u, last_user)
   where id = d.id;
  return jsonb_build_object('ok', true) || public.bf_license_payload(l);
end $$;

-- A new user signing in on an already activated computer is counted against "max users".
create or replace function public.bf_register_user(p_token text, p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.bf_devices;
  l public.bf_licenses;
  uname text := lower(btrim(coalesce(p_username, '')));
begin
  if coalesce(length(p_token), 0) < 40 then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  select * into d from public.bf_devices where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  select * into l from public.bf_licenses where id = d.license_id for update;
  if uname = '' then return jsonb_build_object('ok', false, 'error', 'wrong_user'); end if;
  if nullif(btrim(l.username), '') is not null and lower(btrim(l.username)) <> uname then
    return jsonb_build_object('ok', false, 'error', 'wrong_user');
  end if;
  if not exists (select 1 from public.bf_license_users where license_id = l.id and username = uname) then
    if nullif(btrim(l.username), '') is null and l.restrict_users then
      return jsonb_build_object('ok', false, 'error', 'user_not_allowed');
    end if;
    if nullif(btrim(l.username), '') is null and l.max_users is not null
       and (select count(*) from public.bf_license_users where license_id = l.id) >= l.max_users then
      return jsonb_build_object('ok', false, 'error', 'user_limit');
    end if;
    insert into public.bf_license_users (license_id, username, last_seen) values (l.id, uname, now());
  else
    update public.bf_license_users set last_seen = now() where license_id = l.id and username = uname;
  end if;
  update public.bf_devices set last_seen = now(), last_user = uname where id = d.id;
  return jsonb_build_object('ok', true) || public.bf_license_payload(l);
end $$;

revoke all on function public.bf_activate(text, text, text, text, text) from public;
revoke all on function public.bf_check(text, text, text, text[]) from public;
revoke all on function public.bf_register_user(text, text) from public;
grant execute on function public.bf_activate(text, text, text, text, text) to anon, authenticated;
grant execute on function public.bf_check(text, text, text, text[]) to anon, authenticated;
grant execute on function public.bf_register_user(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------- vendor only
-- Record a payment and extend the paid-until date in one step: p_months months plus p_days days.
drop function if exists public.bf_extend(uuid, int, numeric, text, text, date);
create or replace function public.bf_extend(p_license uuid, p_months int, p_amount numeric, p_method text, p_note text, p_paid_on date, p_days int default 0)
returns public.bf_licenses language plpgsql security definer set search_path = public as $$
declare l public.bf_licenses; from_t timestamptz; to_t timestamptz;
begin
  if not public.bf_is_admin() then raise exception 'not allowed'; end if;
  if p_months is null or p_months < 0 or p_months > 120 then raise exception 'months must be between 0 and 120'; end if;
  if coalesce(p_days, 0) < 0 or coalesce(p_days, 0) > 3650 then raise exception 'days must be between 0 and 3650'; end if;
  select * into l from public.bf_licenses where id = p_license for update;
  if not found then raise exception 'licence not found'; end if;
  from_t := greatest(coalesce(l.paid_until, now()), now());
  to_t   := case when p_months = 0 and coalesce(p_days, 0) = 0 then l.paid_until else from_t + make_interval(months => p_months, days => coalesce(p_days, 0)) end;
  update public.bf_licenses set paid_until = to_t where id = l.id returning * into l;
  insert into public.bf_license_payments (license_id, amount, months, days, paid_on, method, note, period_from, period_to)
  values (l.id, coalesce(p_amount, 0), p_months, coalesce(p_days, 0), coalesce(p_paid_on, current_date), p_method, p_note, from_t, to_t);
  return l;
end $$;

revoke all on function public.bf_extend(uuid, int, numeric, text, text, date, int) from public, anon;
grant execute on function public.bf_extend(uuid, int, numeric, text, text, date, int) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------------------------- first time only (skip if done)
-- 1. Authentication -> Users -> Add user -> "Create new user": your email + a long password, tick "Auto Confirm User".
-- 2. Authentication -> Sign In / Providers -> Email: turn OFF "Allow new users to sign up".
-- 3. Run this one line in the SQL editor (put YOUR email in it):
--      insert into public.bf_admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
-- 4. In Bondhu Fund, sign in as iqbal_labs -> License Control -> sign in with that same email and password.
