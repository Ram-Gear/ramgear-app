-- Undo 004_changegear.sql. DROPS the Change Gear tables and their data. ONE transaction.
begin;
drop table if exists public.cg_presets, public.cg_gear_sets, public.cg_machines;
drop function if exists public.cg_can_delete(), public.cg_can_edit(), public.cg_can_view(), public.cg_role();
alter table public.members drop constraint if exists members_changegear_role_check;
alter table public.members drop column if exists changegear_role;
commit;
