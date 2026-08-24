import type { WatchlistRow } from "@/lib/watchlist";

interface WatchlistPanelProps {
  entries: WatchlistRow[];
  onRemove: (id: string) => void;
}

/**
 * Personal watchlist section, shown only when the watchlist feature is
 * actually available (parent hides this component entirely otherwise — see
 * page.tsx / src/lib/watchlist.ts's "unavailable" sentinel). Entries can
 * span multiple regions, so each chip shows its region alongside the
 * keyword to avoid ambiguity.
 */
export function WatchlistPanel({ entries, onRemove }: WatchlistPanelProps) {
  return (
    <section className="mb-6 rounded-md border border-signal-dim/60 bg-surface px-4 py-3">
      <h2 className="mb-2 font-data text-[11px] uppercase tracking-widest text-signal">
        내 워치리스트
      </h2>
      {entries.length === 0 ? (
        <p className="text-xs text-text-dim">
          랭킹에서 ☆ 버튼을 눌러 추적할 키워드를 추가하세요.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                onClick={() => onRemove(entry.id)}
                title="워치리스트에서 제거"
                className="group flex items-center gap-1.5 rounded-full border border-signal/30 bg-signal/10 px-3 py-1 text-xs text-text"
              >
                <span className="font-data text-[10px] text-text-dim">{entry.region}</span>
                {entry.keyword}
                <span className="text-text-dim group-hover:text-fall">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
