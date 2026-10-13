-- Undo 003_roles.sql: back to Rev 1.8 permissions (every active member may read and write everything; cards: no DELETE).
-- Refuses to run while viewers exist: change them to technician (Admin › Users) or disable them first.
-- card_role values are dropped. Safe to re-run.
begin;
do $$ begin
  if exists (select 1 from public.members where role = 'viewer') then
    raise exception 'members with role viewer exist – change or disable them before rolling back 003';
  end if; end $$;
drop trigger if exists guard on public.customer_cards;
drop function if exists public.customer_cards_guard();
drop policy if exists cards_select on public.customer_cards;
drop policy if exists cards_insert on public.customer_cards;
drop policy if exists cards_update on public.customer_cards;
drop policy if exists cards_delete on public.customer_cards;
create policy cards_select on public.customer_cards for select to authenticated using (public.is_member());
create policy cards_insert on public.customer_cards for insert to authenticated with check (public.is_member());
create policy cards_update on public.customer_cards for update to authenticated using (public.is_member()) with check (public.is_member());
revoke delete on public.customer_cards from authenticated;
do $$ declare t text; begin
  foreach t in array array['customers', 'jobs', 'forms', 'files'] loop
    execute format('drop policy if exists member_read on public.%I', t);
    execute format('drop policy if exists editor_insert on public.%I', t);
    execute format('drop policy if exists editor_update on public.%I', t);
    execute format('drop policy if exists editor_delete on public.%I', t);
    execute format('drop policy if exists member_all on public.%I', t);
    execute format('create policy member_all on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop; end $$;
drop policy if exists rg_files_insert on storage.objects;
drop policy if exists rg_files_update on storage.objects;
drop policy if exists rg_files_delete on storage.objects;
create policy rg_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'ramgear-files' and public.is_member());
create policy rg_files_update on storage.objects for update to authenticated using (bucket_id = 'ramgear-files' and public.is_member());
create policy rg_files_delete on storage.objects for delete to authenticated using (bucket_id = 'ramgear-files' and public.is_member());
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
drop function if exists public.card_can_delete();
drop function if exists public.card_can_edit();
drop function if exists public.card_can_view();
drop function if exists public.card_role();
drop function if exists public.can_edit();
alter table public.members drop constraint if exists members_card_role_check;
alter table public.members drop column if exists card_role;
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('admin', 'technician'));
commit;
