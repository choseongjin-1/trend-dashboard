const KNOWN_SOURCE_LABELS: Record<string, string> = {
  youtube: "YouTube",
};

/**
 * Human-readable label for a TrendItem's `source`. Falls back to a
 * title-cased version of the raw value for any source without a specific
 * label yet, so a new backend source (e.g. a second real data source)
 * displays reasonably without a frontend change.
 */
export function sourceLabel(source: string): string {
  return (
    KNOWN_SOURCE_LABELS[source] ??
    source.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
