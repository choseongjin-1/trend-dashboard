import { TrendItem, TrendSource } from "./types";

export interface SourceItems {
  source: TrendSource;
  /** Must already be ranked 1..N within this source, best item first. */
  items: TrendItem[];
}

/**
 * Blends multiple sources' already-ranked item lists into one fairly
 * ranked list.
 *
 * Rejected approach: concatenate every source's items and sort by raw
 * `score`. YouTube view counts (tens/hundreds of thousands+) and HN points
 * (tens to low thousands) sit on wildly different scales, so a raw-score
 * sort would let YouTube dominate every slot — an HN story could be the
 * single best thing on Hacker News that day and still never surface,
 * purely because "view count" and "points" aren't the same unit.
 *
 * Chosen approach: rank-percentile normalization. Each item's position
 * within its OWN source's list (rank r of n items) becomes a comparable
 * percentile — (n - r + 1) / n — so the #1 YouTube video and the #1 HN
 * story both score 1.0, regardless of the underlying magnitude. Sources
 * compete on relative standing within themselves, not absolute units.
 *
 * Ties (equal percentile, e.g. each source's #1 item) are broken by the
 * stable sort preserving `sourceLists` input order — whichever source is
 * listed first wins ties. Deterministic, not randomized.
 */
export function blendTrendItems(sourceLists: SourceItems[], limit = 20): TrendItem[] {
  const scored = sourceLists.flatMap(({ items }) => {
    const n = items.length;
    if (n === 0) return [];
    return items.map((item) => ({
      item,
      percentile: (n - item.rank + 1) / n,
    }));
  });

  return scored
    .sort((a, b) => b.percentile - a.percentile)
    .slice(0, limit)
    .map(({ item }, i) => ({ ...item, rank: i + 1 }));
}
