-- Industrial Gearbox Data – cloud sync schema (Rev 1.2). Reusable for any Supabase project: no project IDs or keys in here.
-- Run once in the Supabase SQL editor (or via the Management API). Safe to re-run: every statement is idempotent.
-- Model: one organisation per Supabase project. Only signed-in, enabled members (public.members, created by an Admin
-- through the rg-admin Edge Function) can read or write anything. Photos and final PDFs live in the PRIVATE bucket 'ramgear-files'.

-- ---------- tables ----------
create table if not exists public.members (          -- app users (mirrors the tablet's local user list)
  id text primary key,                               -- the app's user id
  auth_user_id uuid unique references auth.users(id) on delete set null,   -- Supabase Auth account (null until activated)
  username text unique not null, display_name text not null,
  role text not null check (role in ('admin','technician')), disabled boolean not null default false,
  secret jsonb,                                      -- PBKDF2 record {algo, iterations, salt, hash} for offline sign-in on every tablet (never the PIN)
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.tablets (id text primary key, name text not null, last_seen_at timestamptz, last_user text,
  app_rev text, updated_at timestamptz not null default now());
create table if not exists public.customers (id text primary key, data jsonb not null, deleted boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(), updated_tablet text);
create table if not exists public.jobs (id text primary key, customer_id text not null, data jsonb not null, deleted boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(), updated_tablet text);
create table if not exists public.forms (job_id text not null, form_key text not null, data jsonb not null,
  status text not null default 'draft' check (status in ('draft','completed')), revision int not null default 1,
  lock_tablet text, lock_tablet_name text, lock_user text, lock_until timestamptz,   -- check-out lock: "In use on <tablet>"
  deleted boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(), updated_tablet text,
  primary key (job_id, form_key));
create table if not exists public.files (id text primary key, job_id text not null, kind text not null check (kind in ('photo','pdf')),
  path text not null, thumb_path text, meta jsonb not null, deleted boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(), updated_tablet text);
create table if not exists public.audit (id text primary key, at timestamptz not null, data jsonb not null,
  user_id uuid default auth.uid(), updated_at timestamptz not null default now());
create index if not exists jobs_updated on public.jobs (updated_at);
create index if not exists forms_updated on public.forms (updated_at);
create index if not exists files_updated on public.files (updated_at);
create index if not exists customers_updated on public.customers (updated_at);
create index if not exists audit_updated on public.audit (updated_at);
create index if not exists members_updated on public.members (updated_at);

-- ---------- membership helpers ----------
create or replace function public.is_member() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.members where auth_user_id = auth.uid() and not disabled) $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.members where auth_user_id = auth.uid() and not disabled and role = 'admin') $$;
revoke all on function public.is_member() from public, anon; grant execute on function public.is_member() to authenticated;
revoke all on function public.is_admin() from public, anon; grant execute on function public.is_admin() to authenticated;

-- ---------- server timestamps (sync cursors use updated_at) ----------
create or replace function public.touch_updated_at() returns trigger language plpgsql as
  $$ begin new.updated_at := clock_timestamp(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['members','tablets','customers','jobs','files','audit'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop; end $$;

-- ---------- row level security: members of this org only ----------
do $$ declare t text; begin
  foreach t in array array['tablets','customers','jobs','forms','files'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists member_all on public.%I', t);
    execute format('create policy member_all on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop; end $$;
alter table public.members enable row level security;      -- written only by the rg-admin Edge Function (service role)
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.is_member());
alter table public.audit enable row level security;        -- append-only log
drop policy if exists audit_read on public.audit;
drop policy if exists audit_insert on public.audit;
create policy audit_read on public.audit for select to authenticated using (public.is_member());
create policy audit_insert on public.audit for insert to authenticated with check (public.is_member());
revoke all on all tables in schema public from anon;

-- ---------- forms: finalized = locked everywhere; check-out lock blocks other tablets ----------
create or replace function public.forms_guard() returns trigger language plpgsql as $$ begin
  if tg_op = 'UPDATE' then
    if old.status = 'completed' and new.data is distinct from old.data and not (new.revision > old.revision) then
      raise exception 'RG_FINALIZED: form is finalized (rev %) and locked', old.revision using errcode = 'P0001';
    end if;
    if old.lock_tablet is not null and old.lock_until > now() and new.updated_tablet is distinct from old.lock_tablet
       and new.data is distinct from old.data then
      raise exception 'RG_LOCKED: in use on %', coalesce(old.lock_tablet_name, old.lock_tablet) using errcode = 'P0001';
    end if;
    if new.revision < old.revision then raise exception 'RG_STALE: older revision' using errcode = 'P0001'; end if;
  end if;
  new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists forms_guard on public.forms;
create trigger forms_guard before insert or update on public.forms for each row execute function public.forms_guard();

-- atomic check-out: succeeds when the form is free, the lock expired, or this tablet already holds it
create or replace function public.checkout_form(p_job text, p_form text, p_tablet text, p_tablet_name text, p_user text, p_minutes int default 30)
returns table (ok boolean, lock_tablet text, lock_tablet_name text, lock_user text, lock_until timestamptz, status text)
language plpgsql security invoker set search_path = public as $$ begin
  if not public.is_member() then raise exception 'not a member'; end if;
  update public.forms f set lock_tablet = p_tablet, lock_tablet_name = p_tablet_name, lock_user = p_user,
         lock_until = now() + make_interval(mins => p_minutes), updated_tablet = p_tablet
   where f.job_id = p_job and f.form_key = p_form and f.status = 'draft'
     and (f.lock_tablet is null or f.lock_until < now() or f.lock_tablet = p_tablet);
  return query select (f.lock_tablet = p_tablet and f.status = 'draft'), f.lock_tablet, f.lock_tablet_name, f.lock_user, f.lock_until, f.status
    from public.forms f where f.job_id = p_job and f.form_key = p_form;
end $$;
create or replace function public.release_form(p_job text, p_form text, p_tablet text) returns void
language sql security invoker set search_path = public as $$
  update public.forms set lock_tablet = null, lock_tablet_name = null, lock_user = null, lock_until = null, updated_tablet = p_tablet
   where job_id = p_job and form_key = p_form and lock_tablet = p_tablet $$;
revoke all on function public.checkout_form(text,text,text,text,text,int) from public, anon;
revoke all on function public.release_form(text,text,text) from public, anon;
grant execute on function public.checkout_form(text,text,text,text,text,int) to authenticated;
grant execute on function public.release_form(text,text,text) to authenticated;

-- ---------- private storage bucket for photos and final PDFs ----------
insert into storage.buckets (id, name, public, file_size_limit) values ('ramgear-files', 'ramgear-files', false, 52428800)
  on conflict (id) do update set public = false;
drop policy if exists rg_files_select on storage.objects;
drop policy if exists rg_files_insert on storage.objects;
drop policy if exists rg_files_update on storage.objects;
drop policy if exists rg_files_delete on storage.objects;
create policy rg_files_select on storage.objects for select to authenticated using (bucket_id = 'ramgear-files' and public.is_member());
create policy rg_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'ramgear-files' and public.is_member());
create policy rg_files_update on storage.objects for update to authenticated using (bucket_id = 'ramgear-files' and public.is_member());
create policy rg_files_delete on storage.objects for delete to authenticated using (bucket_id = 'ramgear-files' and public.is_member());
