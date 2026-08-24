import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Home from "./page";
import type { TrendsResponse } from "@/lib/trends/types";

function jsonResponse(body: unknown, init?: Partial<{ ok: boolean; status: number }>): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as Response;
}

const mockTrends: TrendsResponse = {
  source: "youtube",
  region: "KR",
  fetchedAt: "2026-08-24T00:00:00.000Z",
  mocked: true,
  items: [
    { rank: 1, keyword: "가을 캠핑 브이로그", source: "youtube", score: 100000 },
    { rank: 2, keyword: "저속노화 식단 챌린지", source: "youtube", score: 93000 },
  ],
};

function mockFetchImplementation(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/api/trends/history")) {
    // Simulate the parallel backend endpoint not existing yet.
    return Promise.resolve(jsonResponse({ error: "not found" }, { ok: false, status: 404 }));
  }
  if (url.includes("/api/trends")) {
    return Promise.resolve(jsonResponse(mockTrends));
  }
  return Promise.reject(new Error(`Unexpected fetch: ${url}`));
}

describe("Home dashboard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(mockFetchImplementation));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the ranking list given a mocked successful fetch response", async () => {
    render(<Home />);

    expect(await screen.findByText("가을 캠핑 브이로그")).toBeInTheDocument();
    expect(await screen.findByText("저속노화 식단 챌린지")).toBeInTheDocument();

    // mocked-data banner should still show since TrendsResponse.mocked is true
    expect(
      screen.getByText(/목업 데이터 표시 중입니다/),
    ).toBeInTheDocument();

    // no error banner
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the error state when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/trends/history")) {
          return Promise.resolve(jsonResponse({}, { ok: false, status: 404 }));
        }
        return Promise.resolve(jsonResponse({}, { ok: false, status: 500 }));
      }),
    );

    render(<Home />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("오류: 요청 실패 (500)");

    // no ranking list rendered on error
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows an explicit empty state when items is an empty array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/trends/history")) {
          return Promise.resolve(jsonResponse({}, { ok: false, status: 404 }));
        }
        return Promise.resolve(
          jsonResponse({ ...mockTrends, items: [] } satisfies TrendsResponse),
        );
      }),
    );

    render(<Home />);

    expect(await screen.findByText("표시할 랭킹 데이터가 없습니다")).toBeInTheDocument();
  });

  it("degrades gracefully when the history endpoint returns malformed data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/trends/history")) {
          // Malformed / unexpected shape from the parallel backend track.
          return Promise.resolve(jsonResponse({ totally: "unexpected" }));
        }
        return Promise.resolve(jsonResponse(mockTrends));
      }),
    );

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("가을 캠핑 브이로그")).toBeInTheDocument();
    });
    // Page must not crash or show an error because of the malformed history payload.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
