import { TrendsResponse } from "./types";

const MOCK_TITLES = [
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

export function getMockTrends(region: string): TrendsResponse {
  return {
    source: "youtube",
    region,
    fetchedAt: new Date().toISOString(),
    mocked: true,
    items: MOCK_TITLES.map((keyword, i) => ({
      rank: i + 1,
      keyword,
      source: "youtube",
      score: 100000 - i * 7000,
    })),
  };
}
