-- Change Gear app: per-member role + machine / gear set / preset tables (Rev 1.10). No project IDs or keys.
-- Requires 001-003. ONE transaction; safe to re-run. Undo: 004_changegear_down.sql.
-- members.changegear_role: none | viewer | admin (default 'viewer' = every existing user can view).
--   SELECT cg_* tables: cg_can_view() (role <> none); INSERT/UPDATE: cg_can_edit(); DELETE: cg_can_delete() (both admin).
-- Data change (approved): members with QC role 'admin' get changegear_role 'admin'.
begin;

alter table public.members add column if not exists changegear_role text not null default 'viewer';
alter table public.members drop constraint if exists members_changegear_role_check;
alter table public.members add constraint members_changegear_role_check check (changegear_role in ('none', 'viewer', 'admin'));

create or replace function public.cg_role() returns text language sql stable security definer set search_path = public as
  $$ select coalesce((select changegear_role from public.members where auth_user_id = auth.uid() and not disabled), 'none') $$;
create or replace function public.cg_can_view() returns boolean language sql stable security definer set search_path = public as
  $$ select public.cg_role() in ('viewer', 'admin') $$;
create or replace function public.cg_can_edit() returns boolean language sql stable security definer set search_path = public as
  $$ select public.cg_role() = 'admin' $$;
create or replace function public.cg_can_delete() returns boolean language sql stable security definer set search_path = public as
  $$ select public.cg_role() = 'admin' $$;
do $$ declare f text; begin
  foreach f in array array['cg_role', 'cg_can_view', 'cg_can_edit', 'cg_can_delete'] loop
    execute format('revoke all on function public.%I() from public, anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop; end $$;

create table if not exists public.cg_machines (
  id uuid primary key default gen_random_uuid(), name text not null unique, notes text, formulas jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);
create table if not exists public.cg_gear_sets (
  id uuid primary key default gen_random_uuid(), machine_id uuid not null references public.cg_machines(id) on delete cascade,
  kind text not null check (kind in ('differential', 'indexing')), teeth int[] not null, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (machine_id, kind));
create table if not exists public.cg_presets (
  id uuid primary key default gen_random_uuid(), machine_id uuid not null references public.cg_machines(id) on delete cascade,
  name text not null, inputs jsonb not null, result jsonb, created_by uuid default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (machine_id, name));

do $$ declare t text; begin
  foreach t in array array['cg_machines', 'cg_gear_sets', 'cg_presets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create index if not exists %I on public.%I (updated_at, id)', t || '_updated_id', t);
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
    execute format('drop policy if exists cg_select on public.%I', t);
    execute format('drop policy if exists cg_insert on public.%I', t);
    execute format('drop policy if exists cg_update on public.%I', t);
    execute format('drop policy if exists cg_delete on public.%I', t);
    execute format('create policy cg_select on public.%I for select to authenticated using (public.cg_can_view())', t);
    execute format('create policy cg_insert on public.%I for insert to authenticated with check (public.cg_can_edit())', t);
    execute format('create policy cg_update on public.%I for update to authenticated using (public.cg_can_edit()) with check (public.cg_can_edit())', t);
    execute format('create policy cg_delete on public.%I for delete to authenticated using (public.cg_can_delete())', t);
  end loop; end $$;
create index if not exists cg_gear_sets_machine on public.cg_gear_sets (machine_id);
create index if not exists cg_presets_machine on public.cg_presets (machine_id);

update public.members set changegear_role = 'admin' where role = 'admin' and changegear_role <> 'admin';
commit;
