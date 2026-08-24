import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./page";
import type { TrendsResponse } from "@/lib/trends/types";
import type { WatchlistRow } from "@/lib/watchlist";
import { useAuth } from "@/lib/auth/useAuth";

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);

const loggedOut = {
  user: null,
  loading: false,
  error: null,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
};

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

function trendsForRegion(region: string): TrendsResponse {
  return { ...mockTrends, region };
}

function baseFetchImplementation(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/api/trends/history")) {
    return Promise.resolve(jsonResponse({ error: "not found" }, { ok: false, status: 404 }));
  }
  if (url.includes("/api/trends?region=")) {
    const region = new URL(url, "http://localhost").searchParams.get("region") ?? "KR";
    return Promise.resolve(jsonResponse(trendsForRegion(region)));
  }
  return Promise.reject(new Error(`Unexpected fetch: ${url}`));
}

describe("Home dashboard", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue(loggedOut);
    vi.stubGlobal("fetch", vi.fn(baseFetchImplementation));
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

    expect(await screen.findByText("아직 감지된 신호가 없습니다")).toBeInTheDocument();
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

  it("shows a sign-in prompt in the header when logged out", async () => {
    render(<Home />);
    await screen.findByText("가을 캠핑 브이로그");

    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그아웃" })).not.toBeInTheDocument();
  });

  it("shows the user's email and a logout control when logged in", async () => {
    mockUseAuth.mockReturnValue({ ...loggedOut, user: { email: "creator@example.com" } });

    render(<Home />);
    await screen.findByText("가을 캠핑 브이로그");

    expect(screen.getByText("creator@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그인" })).not.toBeInTheDocument();
  });

  it("re-fetches trends and history for the newly selected region on tab switch", async () => {
    const fetchMock = vi.fn(baseFetchImplementation);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<Home />);
    await screen.findByText("가을 캠핑 브이로그");
    expect(fetchMock).toHaveBeenCalledWith("/api/trends?region=KR");

    await user.click(screen.getByRole("tab", { name: /US/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/trends?region=US");
    });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/trends/history?region=US")).toBe(
        true,
      );
    });
  });

  it("supports adding and removing a keyword from the watchlist when logged in", async () => {
    mockUseAuth.mockReturnValue({ ...loggedOut, user: { email: "creator@example.com" } });

    let watchlistState: WatchlistRow[] = [];
    let nextId = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/watchlist")) {
          if (!init?.method || init.method === "GET") {
            return Promise.resolve(jsonResponse(watchlistState));
          }
          if (init.method === "POST") {
            const body = JSON.parse(init.body as string) as { keyword: string; region: string };
            const row: WatchlistRow = {
              id: String(nextId++),
              keyword: body.keyword,
              region: body.region,
              created_at: "2026-08-24T00:00:00.000Z",
            };
            watchlistState = [...watchlistState, row];
            return Promise.resolve(jsonResponse(row, { status: 201 }));
          }
          if (init.method === "DELETE") {
            const id = new URL(url, "http://localhost").searchParams.get("id");
            watchlistState = watchlistState.filter((w) => w.id !== id);
            return Promise.resolve(jsonResponse({ ok: true }));
          }
        }
        return baseFetchImplementation(input);
      }),
    );
    const user = userEvent.setup();

    render(<Home />);
    await screen.findByText("가을 캠핑 브이로그");

    const addButtons = await screen.findAllByRole("button", { name: "워치리스트에 추가" });
    await user.click(addButtons[0]);

    const watchlistPanel = await screen.findByText("내 워치리스트");
    const panelSection = watchlistPanel.closest("section")!;
    await waitFor(() => {
      expect(within(panelSection).getByText("가을 캠핑 브이로그")).toBeInTheDocument();
    });

    const removeButton = await screen.findByRole("button", { name: "워치리스트에서 제거" });
    await user.click(removeButton);

    await waitFor(() => {
      expect(within(panelSection).queryByText("가을 캠핑 브이로그")).not.toBeInTheDocument();
    });
  });
});
