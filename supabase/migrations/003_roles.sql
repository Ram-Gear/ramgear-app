-- Industrial Gearbox Data – roles per app (Rev 1.9). Reusable for any Supabase project: no project IDs or keys.
-- Requires 001_init.sql and 002_customer_cards.sql. Runs as ONE transaction; safe to re-run. Undo: 003_roles_down.sql.
--
-- QC app (members.role):           admin | technician | viewer (new: view only, no changes)
--   * SELECT on all app data: any active member  (public.is_member())
--   * INSERT / UPDATE / DELETE on customers, jobs, forms, files and the photo/PDF bucket: admin or technician (public.can_edit())
--   * tablets (device heartbeat) and audit (append-only sign-in/action log) stay writable by every active member.
-- Cardfile app (members.card_role): none | viewer | editor | admin   (default 'editor' = what every existing user had before:
--   read, add and edit cards; deleting is now admin only)
--   * SELECT customer_cards:                    card_role <> 'none'          (public.card_can_view())
--   * INSERT / UPDATE customer_cards:           card_role editor or admin    (public.card_can_edit())
--   * soft delete (setting/clearing deleted_at) and hard DELETE: card_role admin (public.card_can_delete())
--   * QC's own card sync (trigger on customers, owner rights) is NOT affected: cards are created/updated for every customer
--     whatever the saving user's card_role.
-- No data is changed by this migration (existing members keep role; card_role gets the default 'editor').

begin;

-- ---------- members: QC viewer role + per-member Cardfile permission ----------
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('admin', 'technician', 'viewer'));
alter table public.members add column if not exists card_role text not null default 'editor';
alter table public.members drop constraint if exists members_card_role_check;
alter table public.members add constraint members_card_role_check check (card_role in ('none', 'viewer', 'editor', 'admin'));

-- ---------- helpers (security definer: read the caller's own member row) ----------
create or replace function public.can_edit() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.members where auth_user_id = auth.uid() and not disabled and role in ('admin', 'technician')) $$;
create or replace function public.card_role() returns text language sql stable security definer set search_path = public as
  $$ select coalesce((select card_role from public.members where auth_user_id = auth.uid() and not disabled), 'none') $$;
create or replace function public.card_can_view() returns boolean language sql stable security definer set search_path = public as
  $$ select public.card_role() in ('viewer', 'editor', 'admin') $$;
create or replace function public.card_can_edit() returns boolean language sql stable security definer set search_path = public as
  $$ select public.card_role() in ('editor', 'admin') $$;
create or replace function public.card_can_delete() returns boolean language sql stable security definer set search_path = public as
  $$ select public.card_role() = 'admin' $$;
do $$ declare f text; begin
  foreach f in array array['can_edit', 'card_role', 'card_can_view', 'card_can_edit', 'card_can_delete'] loop
    execute format('revoke all on function public.%I() from public, anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop; end $$;

-- ---------- QC data: read = member, write = admin/technician ----------
do $$ declare t text; begin
  foreach t in array array['customers', 'jobs', 'forms', 'files'] loop
    execute format('drop policy if exists member_all on public.%I', t);
    execute format('drop policy if exists member_read on public.%I', t);
    execute format('drop policy if exists editor_insert on public.%I', t);
    execute format('drop policy if exists editor_update on public.%I', t);
    execute format('drop policy if exists editor_delete on public.%I', t);
    execute format('create policy member_read on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy editor_insert on public.%I for insert to authenticated with check (public.can_edit())', t);
    execute format('create policy editor_update on public.%I for update to authenticated using (public.can_edit()) with check (public.can_edit())', t);
    execute format('create policy editor_delete on public.%I for delete to authenticated using (public.can_edit())', t);
  end loop; end $$;

-- photos and final PDFs in the private bucket
drop policy if exists rg_files_insert on storage.objects;
drop policy if exists rg_files_update on storage.objects;
drop policy if exists rg_files_delete on storage.objects;
create policy rg_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'ramgear-files' and public.can_edit());
create policy rg_files_update on storage.objects for update to authenticated using (bucket_id = 'ramgear-files' and public.can_edit()) with check (bucket_id = 'ramgear-files' and public.can_edit());
create policy rg_files_delete on storage.objects for delete to authenticated using (bucket_id = 'ramgear-files' and public.can_edit());

-- check-out lock: only editors check a form out (a viewer never blocks a technician)
create or replace function public.checkout_form(p_job text, p_form text, p_tablet text, p_tablet_name text, p_user text, p_minutes int default 30)
returns table (ok boolean, lock_tablet text, lock_tablet_name text, lock_user text, lock_until timestamptz, status text)
language plpgsql security invoker set search_path = public as $$ begin
  if not public.can_edit() then raise exception 'RG_VIEWER: view-only account' using errcode = 'P0001'; end if;
  update public.forms f set lock_tablet = p_tablet, lock_tablet_name = p_tablet_name, lock_user = p_user,
         lock_until = now() + make_interval(mins => p_minutes), updated_tablet = p_tablet
   where f.job_id = p_job and f.form_key = p_form and f.status = 'draft'
     and (f.lock_tablet is null or f.lock_until < now() or f.lock_tablet = p_tablet);
  return query select (f.lock_tablet = p_tablet and f.status = 'draft'), f.lock_tablet, f.lock_tablet_name, f.lock_user, f.lock_until, f.status
    from public.forms f where f.job_id = p_job and f.form_key = p_form;
end $$;

-- ---------- customer_cards: per-app Cardfile permission ----------
drop policy if exists cards_select on public.customer_cards;
drop policy if exists cards_insert on public.customer_cards;
drop policy if exists cards_update on public.customer_cards;
drop policy if exists cards_delete on public.customer_cards;
create policy cards_select on public.customer_cards for select to authenticated using (public.card_can_view());
create policy cards_insert on public.customer_cards for insert to authenticated
  with check (public.card_can_edit() and (deleted_at is null or public.card_can_delete()));
create policy cards_update on public.customer_cards for update to authenticated using (public.card_can_edit()) with check (public.card_can_edit());
create policy cards_delete on public.customer_cards for delete to authenticated using (public.card_can_delete());
grant select, insert, update, delete on public.customer_cards to authenticated;
-- soft delete / undelete needs card admin. Applies to API users only (role "authenticated"); QC's owner-rights card sync never
-- touches deleted_at anyway.
create or replace function public.customer_cards_guard() returns trigger language plpgsql set search_path = public as $$ begin
  if current_user = 'authenticated' and new.deleted_at is distinct from old.deleted_at and not public.card_can_delete() then
    raise exception 'RG_CARD_DELETE: only a card-file admin can delete or restore cards' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard on public.customer_cards;
create trigger guard before update on public.customer_cards for each row execute function public.customer_cards_guard();

commit;
