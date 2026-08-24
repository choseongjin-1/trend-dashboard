import type { Region } from "@/lib/trends/regions";

interface RegionTabsProps {
  regions: Region[];
  active: string;
  onChange: (code: string) => void;
}

/**
 * Region selector styled as physical toggle buttons on the board's control
 * strip — a pressed/unpressed pair state, not a web tab underline.
 */
export function RegionTabs({ regions, active, onChange }: RegionTabsProps) {
  return (
    <div role="tablist" aria-label="지역 선택" className="flex gap-1">
      {regions.map((region) => {
        const isActive = region.code === active;
        return (
          <button
            key={region.code}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(region.code)}
            className={`whitespace-nowrap rounded-sm border px-2.5 py-1.5 font-data text-xs tracking-wide transition sm:px-3 ${
              isActive
                ? "border-ink/50 bg-ink/10 text-ink"
                : "border-ink-dim/20 text-ink-dim hover:border-ink-dim/40 hover:text-ink"
            }`}
          >
            {region.code}
            <span className="ml-1.5 hidden font-body text-[11px] sm:inline">{region.label}</span>
          </button>
        );
      })}
    </div>
  );
}
