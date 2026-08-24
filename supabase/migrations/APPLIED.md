# Migration log

Convention: every schema change gets a **new** numbered file (`0003_*.sql`,
`0004_*.sql`, ...) — never edit an already-applied migration file. A new
migration is listed below as **pending** until the user confirms they ran
it against the live Supabase project (via SQL Editor or otherwise), at
which point its row is updated to **applied** with the date.

| File | Status | Applied | Notes |
| --- | --- | --- | --- |
| `0001_initial.sql` | applied | 2026-08-24 | `trend_snapshots` table + index |
| `0002_mocked_column_and_watchlist.sql` | applied | 2026-08-24 | `trend_snapshots.mocked` column, `watchlist` table + RLS |
| `0003_rate_limiting.sql` | pending | — | `rate_limit_counters` table + `increment_rate_limit()` RPC for /api/trends, /api/trends/history, /api/trends/keyword-history |
