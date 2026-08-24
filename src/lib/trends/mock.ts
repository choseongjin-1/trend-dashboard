import { TrendItem } from "./types";

const MOCK_YOUTUBE_TITLES = [
  "가을 캠핑 브이로그",
  "저속노화 식단 챌린지",
  "에어프라이어 신메뉴",
  "재테크 초보 가이드",
  "무지출 챌린지 브이로그",
  "홈트 루틴 30분",
  "AI 코딩 튜토리얼",
  "반려동물 훈련 꿀팁",
  "제주도 가을 여행",
  "미니멀 라이프 정리",
];

const MOCK_HACKERNEWS_TITLES = [
  "Show HN: A tiny static site generator in 200 lines",
  "Why we moved off Kubernetes",
  "The C standard library, annotated",
  "Ask HN: How do you review a 10k-line PR?",
  "PostgreSQL 18 released",
  "A postmortem on our outage last week",
  "Rewriting our build system in Rust",
  "Understanding TCP congestion control",
];

export function getMockYoutubeItems(): TrendItem[] {
  return MOCK_YOUTUBE_TITLES.map((keyword, i) => ({
    rank: i + 1,
    keyword,
    source: "youtube",
    score: 100000 - i * 7000,
  }));
}

export function getMockHackerNewsItems(): TrendItem[] {
  return MOCK_HACKERNEWS_TITLES.map((keyword, i) => ({
    rank: i + 1,
    keyword,
    source: "hackernews",
    score: 500 - i * 40,
  }));
}
