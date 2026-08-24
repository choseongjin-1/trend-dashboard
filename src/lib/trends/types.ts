export type TrendSource = "youtube" | "hackernews";

export interface TrendItem {
  rank: number;
  keyword: string;
  source: TrendSource;
  score: number;
  url?: string;
  thumbnailUrl?: string;
}

export interface TrendsResponse {
  /** Every source blended into `items` for this response — see src/lib/trends/ingest.ts. */
  sources: TrendSource[];
  region: string;
  fetchedAt: string;
  mocked: boolean;
  items: TrendItem[];
}
