-- Tracks each watchlist item's last-acknowledged rank server-side, so
-- "your watched keyword moved" notifications don't depend on the frontend
-- recomputing a baseline from scratch on every load, and the baseline
-- persists across devices/sessions for the same signed-in user.
--
-- Both nullable: a freshly-added watchlist item has never been
-- acknowledged yet (last_seen_rank/last_seen_at both null until the
-- frontend PATCHes it), and a keyword can genuinely have no rank to
-- record (it fell out of the rankings entirely).
alter table watchlist
  add column if not exists last_seen_rank integer,
  add column if not exists last_seen_at timestamptz;
