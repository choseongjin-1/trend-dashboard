import type { WatchlistRow } from "@/lib/watchlist";
import { describeRankChange } from "@/lib/watchlist";

interface WatchlistPanelProps {
  entries: WatchlistRow[];
  onRemove: (id: string) => void;
  onView: (keyword: string, region: string) => void;
}

/**
 * Shows how a watchlist item's rank has moved since the user last actually
 * looked at it (its `last_seen_rank` baseline) — distinct from the ranking
 * list's per-row RankDelta, which tracks day-over-day snapshot movement
 * regardless of whether anyone's watching. Reserves rising/falling for a
 * genuine improvement/decline; "new"/"unknown" states get no color since
 * there's nothing to compare against yet.
 */
function RankChangeBadge({ row }: { row: WatchlistRow }) {
  const change = describeRankChange(row);
  switch (change.kind) {
    case "unknown":
      return null;
    case "dropped":
      return <span className="font-data text-[10px] text-flap-dim">순위 이탈</span>;
    case "new":
      return null;
    case "unchanged":
      return <span className="font-data text-[10px] text-flap-dim">{change.rank}위</span>;
    case "moved": {
      const improved = change.to < change.from; // lower rank number = better
      return (
        <span className={`font-data text-[10px] font-semibold ${improved ? "text-rising" : "text-falling"}`}>
          {change.from}위 → {change.to}위
        </span>
      );
    }
  }
}

/**
 * Personal watchlist section, shown only when the watchlist feature is
 * actually available (parent hides this component entirely otherwise — see
 * page.tsx / src/lib/watchlist.ts's "unavailable" sentinel). Entries can
 * span multiple regions, so each chip shows its region alongside the
 * keyword to avoid ambiguity. Clicking a chip opens that keyword's detail
 * view (which acknowledges its current rank as the new baseline); the ✕ is
 * a separate control so viewing and removing don't share one hit target.
 */
export function WatchlistPanel({ entries, onRemove, onView }: WatchlistPanelProps) {
  return (
    <section className="mb-6 rounded-sm border border-flap-dim/20 bg-panel px-4 py-3">
      <h2 className="mb-2 font-data text-[11px] uppercase tracking-widest text-flap-dim">
        내 워치리스트
      </h2>
      {entries.length === 0 ? (
        <p className="text-xs text-flap-dim">
          랭킹에서 ☆ 버튼을 눌러 추적할 키워드를 추가하세요.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="group flex items-center gap-1.5 rounded-sm border border-flap-dim/25 bg-casing/60 px-3 py-1 text-xs text-flap">
                <button
                  onClick={() => onView(entry.keyword, entry.region)}
                  aria-label={`${entry.keyword} 상세 보기`}
                  className="flex items-center gap-1.5 hover:text-flap/80"
                >
                  <span className="font-data text-[10px] text-flap-dim">{entry.region}</span>
                  {entry.keyword}
                  <RankChangeBadge row={entry} />
                </button>
                <button
                  onClick={() => onRemove(entry.id)}
                  aria-label={`${entry.keyword} 워치리스트에서 제거`}
                  className="text-flap-dim hover:text-falling"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
