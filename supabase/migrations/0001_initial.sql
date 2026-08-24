-- Round 1: trend snapshot storage.
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
