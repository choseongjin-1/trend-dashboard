export type TrendSource = "youtube";

export interface TrendItem {
  rank: number;
  keyword: string;
  source: TrendSource;
  score: number;
  url?: string;
  thumbnailUrl?: string;
}

export interface TrendsResponse {
  source: TrendSource;
  region: string;
  fetchedAt: string;
  mocked: boolean;
  items: TrendItem[];
}
