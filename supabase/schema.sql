create table if not exists trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  region text not null,
  fetched_at timestamptz not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists trend_snapshots_source_region_idx
  on trend_snapshots (source, region, fetched_at desc);

-- Added for the scheduled-ingestion round: distinguishes real API-backed
-- snapshots from mock-fallback ones, so /api/trends can propagate the
-- `mocked` flag correctly when serving a cached snapshot. `if not exists`
-- keeps this script safe to re-run against a table that already has rows.
alter table trend_snapshots
  add column if not exists mocked boolean not null default false;

-- Per-user keyword watchlist (paid-tier hook). Row Level Security ensures
-- a signed-in user can only see/modify their own rows; there is no public
-- read/write policy, so this table is inaccessible without a valid user
-- session (the service-role key still bypasses RLS for backend/ingestion
-- use, but nothing in this codebase uses it against this table).
create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null,
  region text not null,
  created_at timestamptz not null default now()
);

create index if not exists watchlist_user_id_idx on watchlist (user_id);

alter table watchlist enable row level security;

drop policy if exists "watchlist_select_own" on watchlist;
create policy "watchlist_select_own"
  on watchlist for select
  using (auth.uid() = user_id);

drop policy if exists "watchlist_insert_own" on watchlist;
create policy "watchlist_insert_own"
  on watchlist for insert
  with check (auth.uid() = user_id);

drop policy if exists "watchlist_delete_own" on watchlist;
create policy "watchlist_delete_own"
  on watchlist for delete
  using (auth.uid() = user_id);
