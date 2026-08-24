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
            className={`relative px-3 py-2 font-data text-xs tracking-wide transition ${
              isActive ? "text-signal" : "text-text-dim hover:text-text"
            }`}
          >
            {region.code}
            <span className="ml-1.5 font-body text-[11px]">{region.label}</span>
            {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-signal" />}
          </button>
        );
      })}
    </div>
  );
}
