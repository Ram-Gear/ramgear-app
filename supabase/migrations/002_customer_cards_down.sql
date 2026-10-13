-- Undo 002_customer_cards.sql: removes the customer cards feature from the database. Safe to re-run (idempotent).
-- WARNING: deletes every card, including Cardfile-only cards and Cardfile notes. Back up public.customer_cards first.
-- public.customers and all other tables are not touched. pg_trgm stays installed (other objects may use it; Supabase ships it).
begin;
drop trigger if exists customers_card_sync on public.customers;
drop function if exists public.customers_card_sync();
drop table if exists public.customer_cards;            -- also drops its indexes, policies, grants and the touch trigger
drop function if exists public.rg_card_body(jsonb);
drop function if exists public.rg_card_title(jsonb);
drop function if exists public.rg_card_phone(text);
drop function if exists public.rg_card_clean(text);
commit;
