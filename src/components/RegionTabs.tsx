import type { Region } from "@/lib/trends/regions";

interface RegionTabsProps {
  regions: Region[];
  active: string;
  onChange: (code: string) => void;
}

/**
 * Segmented region selector styled like a channel/source selector on a
 * monitoring console — the active tab reads as "currently tuned in".
 */
export function RegionTabs({ regions, active, onChange }: RegionTabsProps) {
  return (
    <div role="tablist" aria-label="지역 선택" className="flex gap-1 border-b border-hairline">
      {regions.map((region) => {
        const isActive = region.code === active;
        return (
          <button
            key={region.code}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(region.code)}
            className={`relative whitespace-nowrap px-2.5 py-2 font-data text-xs tracking-wide transition sm:px-3 ${
              isActive ? "text-signal" : "text-text-dim hover:text-text"
            }`}
          >
            {region.code}
            <span className="ml-1.5 hidden font-body text-[11px] sm:inline">{region.label}</span>
            {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-signal" />}
          </button>
        );
      })}
    </div>
  );
}
