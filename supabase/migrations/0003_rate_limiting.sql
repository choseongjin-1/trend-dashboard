-- Fixed-window rate limiter for public read endpoints (/api/trends,
-- /api/trends/history). No Redis/Upstash available (would need a new
-- external credential), so this counts requests per (route+identifier,
-- window) directly in Postgres via an atomic RPC.
--
-- Fixed window, not sliding: one row per key per minute, one atomic
-- upsert-and-increment call. Tradeoff: a client timing requests around a
-- window boundary can get up to ~2x the nominal limit through in a short
-- burst (e.g. 29 requests at 0:59, 29 more at 1:00). That's an acceptable
-- looseness for coarse abuse protection on a public trend-lookup endpoint
-- — this is not billing-grade metering, and the alternative (a real
-- sliding window / token bucket) needs either Redis or considerably more
-- Postgres machinery for a problem this small.
create table if not exists rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- Atomically increments the counter for (key, window_start) and returns
-- the new count. Also opportunistically deletes counter rows more than an
-- hour old on ~1% of calls, so the table doesn't grow unbounded without
-- needing a separate scheduled cleanup job.
create or replace function increment_rate_limit(p_key text, p_window_start timestamptz)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into rate_limit_counters (key, window_start, count)
  values (p_key, p_window_start, 1)
  on conflict (key, window_start)
  do update set count = rate_limit_counters.count + 1
  returning count into v_count;

  if random() < 0.01 then
    delete from rate_limit_counters where window_start < p_window_start - interval '1 hour';
  end if;

  return v_count;
end;
$$;
