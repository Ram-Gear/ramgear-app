-- Industrial Gearbox Data – customer cards for the Cardfile app (Rev 1.8). Reusable for any Supabase project: no project IDs or keys.
-- Requires 001_init.sql (public.customers, public.is_member(), public.touch_updated_at()). Safe to re-run: every statement is idempotent.
-- Runs as ONE transaction (all or nothing). Undo: 002_customer_cards_down.sql.
--
-- One card per QC customer, kept in sync BY THE DATABASE (trigger on public.customers), so it works for every tablet and for
-- offline edits that sync later. QC never writes customer_cards directly.
--   * QC owns:       title (customer name, max 39 chars, truncated), body (plain-text contact block), customer_id.
--   * Cardfile owns: notes (shared across devices; QC never writes it), deleted_at (soft delete; QC never sets it),
--                    file (Cardfile's card-file name; QC cards are created with file = 'Customers', never changed by QC afterwards).
--   * Fail-safe: a problem in the card sync only raises a WARNING; it can never block or roll back a customer insert/update.
--   * No hard deletes: authenticated users get SELECT / INSERT / UPDATE only (no DELETE grant, no DELETE policy).
--   * A card picked in QC's "Find in card file" is linked by the trigger: the customer row carries data.cardId and, when the
--     customer reaches the cloud (online or after an offline sync), the trigger links that card if it is still free
--     (customer_id is null, deleted_at is null) instead of creating a new one. Never a duplicate card for a customer.
--   * QC customer deleted (tombstone customers.deleted = true, or a hard delete): the card is KEPT, customer_id is set to NULL,
--     deleted_at is NOT set.
--   * updated_at is bumped on every insert / update (clock_timestamp) for incremental sync: ...?updated_at=gt.<last_sync>.
-- Model: one organisation per Supabase project, so no org_id column; RLS uses public.is_member() exactly like customers.

begin;

-- ---------- table ----------
create table if not exists public.customer_cards (
  id          uuid primary key default gen_random_uuid(),
  customer_id text unique references public.customers(id) on delete set null,   -- customers.id is text; NULL = card no longer linked to a QC customer
  title       text not null check (char_length(title) <= 39),                     -- customer / company name (QC truncates to 39)
  body        text not null default '',                                           -- plain text: Contact, Phone (XXX-XXX-XXXX), Email, Address, Notes
  notes       text,                                                               -- Cardfile notes, shared across devices; never written by QC
  source      text not null default 'qc' constraint customer_cards_source_check check (source in ('qc', 'cardfile')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,                                                        -- soft delete (Cardfile); lookups use deleted_at is null
  file        text                                                                -- Cardfile's card-file name ('Customers' for QC cards)
);
-- (re-run on a table created by an earlier draft of this file)
alter table public.customer_cards add column if not exists file text;
drop index if exists public.customer_cards_updated;
create index if not exists customer_cards_updated_id on public.customer_cards (updated_at, id);   -- incremental sync / keyset paging
alter table public.customer_cards drop constraint if exists customer_cards_source_check;
alter table public.customer_cards add constraint customer_cards_source_check check (source in ('qc', 'cardfile'));
drop index if exists public.customer_cards_live_title;

-- ilike '%term%' search on title / body (live cards only): pg_trgm GIN indexes. Supabase keeps extensions in the
-- "extensions" schema; if pg_trgm is already installed elsewhere, the opclass is taken from wherever it lives.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
do $$ declare s text; begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists customer_cards_title_trgm on public.customer_cards using gin (title %I.gin_trgm_ops) where deleted_at is null', s);
  execute format('create index if not exists customer_cards_body_trgm on public.customer_cards using gin (body %I.gin_trgm_ops) where deleted_at is null', s);
end $$;

-- updated_at on EVERY insert / update (same server-clock function as the other sync tables)
drop trigger if exists touch on public.customer_cards;
create trigger touch before insert or update on public.customer_cards for each row execute function public.touch_updated_at();

-- ---------- formatting (mirrors js/card.js exactly) ----------
-- field clean-up: CRLF / CR -> LF, trim spaces, tabs and newlines at both ends
create or replace function public.rg_card_clean(s text) returns text language sql immutable as
  $$ select btrim(regexp_replace(coalesce(s, ''), E'\r\n?', E'\n', 'g'), E' \t\n') $$;
-- US phone: 10 digits (or 11 starting with 1) and no letters / '#' -> XXX-XXX-XXXX; anything else (extension, foreign) as stored
create or replace function public.rg_card_phone(p text) returns text language sql immutable as $$
  with v as (select public.rg_card_clean(p) as s),
       d as (select s, regexp_replace(s, '\D', '', 'g') as dd from v),
       t as (select s, case when length(dd) = 11 and left(dd, 1) = '1' then substr(dd, 2) else dd end as ten from d)
  select case when length(ten) = 10 and s !~* '[a-z#]' then substr(ten, 1, 3) || '-' || substr(ten, 4, 3) || '-' || substr(ten, 7, 4) else s end from t $$;
create or replace function public.rg_card_title(d jsonb) returns text language sql immutable as
  $$ select rtrim(left(coalesce(nullif(public.rg_card_clean(d->>'name'), ''), '(no name)'), 39), E' \t\n') $$;   -- truncate, then drop a trailing space
create or replace function public.rg_card_body(d jsonb) returns text language sql immutable as $$
  select coalesce(string_agg(l, E'\n' order by n), '') from (values
    (1, 'Contact: ' || nullif(public.rg_card_clean(d->>'contact'), '')),
    (2, 'Phone: '   || nullif(public.rg_card_phone(d->>'phone'), '')),
    (3, 'Email: '   || nullif(public.rg_card_clean(d->>'email'), '')),
    (4, 'Address: ' || nullif(public.rg_card_clean(d->>'address'), '')),
    (5, 'Notes: '   || nullif(public.rg_card_clean(d->>'notes'), ''))) as x(n, l)
  where l is not null $$;

-- ---------- keep the card in sync with public.customers ----------
-- security definer: the card always follows the customer row, whoever (tablet, offline sync, admin) wrote it.
create or replace function public.customers_card_sync() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text; v_body text; v_pick uuid;
begin
  begin   -- fail-safe: any error in here is rolled back to this point and reported as a WARNING; the customer write always succeeds
    if new.deleted then                                 -- QC tombstone: keep the card, unlink it, do not touch deleted_at
      update public.customer_cards set customer_id = null where customer_id = new.id;
      return null;
    end if;
    v_title := public.rg_card_title(new.data); v_body := public.rg_card_body(new.data);
    -- 1) a card is already linked to this customer (QC's own, or linked from Cardfile / by a pick): update title + body only.
    --    notes, source, file and deleted_at are never touched; an unchanged customer write does not touch the card.
    if exists (select 1 from public.customer_cards where customer_id = new.id) then
      update public.customer_cards set title = v_title, body = v_body
        where customer_id = new.id and (title is distinct from v_title or body is distinct from v_body);
      return null;
    end if;
    -- 2) card picked with "Find in card file" (data.cardId): link it if it is still free (not linked, not soft-deleted).
    if coalesce(new.data->>'cardId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_pick := (new.data->>'cardId')::uuid;
      update public.customer_cards set customer_id = new.id, title = v_title, body = v_body
        where id = v_pick and customer_id is null and deleted_at is null;
      if found then return null; end if;             -- linked (row lock: two customers can never take the same card)
    end if;
    -- 3) no card yet (or the picked card was taken / deleted meanwhile): a new QC card in the 'Customers' file
    insert into public.customer_cards as c (customer_id, title, body, source, file) values (new.id, v_title, v_body, 'qc', 'Customers')
    on conflict (customer_id) do update set title = excluded.title, body = excluded.body
      where c.title is distinct from excluded.title or c.body is distinct from excluded.body;
  exception when others then
    raise warning 'customer_cards sync skipped for customer %: % (SQLSTATE %)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end $$;
revoke all on function public.customers_card_sync() from public, anon, authenticated;
drop trigger if exists customers_card_sync on public.customers;
create trigger customers_card_sync after insert or update of data, deleted on public.customers
  for each row execute function public.customers_card_sync();

-- ---------- back-fill cards for existing (not deleted) customers ----------
insert into public.customer_cards as c (customer_id, title, body, source, file)
  select id, public.rg_card_title(data), public.rg_card_body(data), 'qc', 'Customers' from public.customers where not deleted
on conflict (customer_id) do update set title = excluded.title, body = excluded.body
  where c.title is distinct from excluded.title or c.body is distinct from excluded.body;

-- ---------- row level security + grants: signed-in, enabled members of this org; no DELETE ----------
alter table public.customer_cards enable row level security;
drop policy if exists member_all on public.customer_cards;
drop policy if exists cards_select on public.customer_cards;
drop policy if exists cards_insert on public.customer_cards;
drop policy if exists cards_update on public.customer_cards;
create policy cards_select on public.customer_cards for select to authenticated using (public.is_member());
create policy cards_insert on public.customer_cards for insert to authenticated with check (public.is_member());
create policy cards_update on public.customer_cards for update to authenticated using (public.is_member()) with check (public.is_member());
revoke all on public.customer_cards from public, anon, authenticated;
grant select, insert, update on public.customer_cards to authenticated;

commit;
