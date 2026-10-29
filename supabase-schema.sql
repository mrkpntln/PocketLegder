-- PocketLedger Supabase schema (also applied to the hosted project).
-- Run only in a new PocketLedger project. All exposed tables use per-user RLS.
create extension if not exists pgcrypto;

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, client_id)
);
create table if not exists public.plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, client_id)
);
create table if not exists public.payment_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  plan_item_client_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, client_id)
);
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists ledger_transactions_user_updated_idx on public.ledger_transactions (user_id, updated_at desc);
create index if not exists plan_items_user_updated_idx on public.plan_items (user_id, updated_at desc);
create index if not exists payment_history_user_created_idx on public.payment_history (user_id, created_at desc);
create index if not exists payment_history_parent_idx on public.payment_history (user_id, plan_item_client_id);

alter table public.ledger_transactions enable row level security;
alter table public.plan_items enable row level security;
alter table public.payment_history enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "Users manage own ledger transactions" on public.ledger_transactions;
create policy "Users manage own ledger transactions" on public.ledger_transactions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage own plan items" on public.plan_items;
create policy "Users manage own plan items" on public.plan_items for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage own payment history" on public.payment_history;
create policy "Users manage own payment history" on public.payment_history for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage own settings" on public.user_settings;
create policy "Users manage own settings" on public.user_settings for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.ledger_transactions to authenticated;
grant select, insert, update, delete on public.plan_items to authenticated;
grant select, insert, update, delete on public.payment_history to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;
