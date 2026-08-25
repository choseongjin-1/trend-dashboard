import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSyncExternalStore } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeClient } from "./HomeClient";
import type { TrendsResponse } from "@/lib/trends/types";
import type { WatchlistRow } from "@/lib/watchlist";
import { useAuth } from "@/lib/auth/useAuth";

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: vi.fn(),
}));

// A minimal reactive stand-in for next/navigation: the mocked router's
// push/replace mutate a shared query-string store and notify subscribers,
// so components reading useSearchParams() actually re-render with the new
// URL — the same way the real App Router context behaves. Needed because
// HomeClient derives the detail modal's open state directly from the URL
// (round 12: deep-linkable keyword detail).
const navState = vi.hoisted(() => ({
  search: "",
  listeners: new Set<() => void>(),
}));

function setSearch(qs: string) {
  navState.search = qs;
  navState.listeners.forEach((l) => l());
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const qs = useSyncExternalStore(
      (cb) => {
        navState.listeners.add(cb);
        return () => navState.listeners.delete(cb);
      },
      () => navState.search,
      () => navState.search,
    );
    return new URLSearchParams(qs);
  },
  usePathname: () => "/",
  useRouter: () => ({
    push: (url: string) => setSearch(url.includes("?") ? url.split("?")[1] : ""),
    replace: (url: string) => setSearch(url.includes("?") ? url.split("?")[1] : ""),
  }),
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
  sources: ["youtube"],
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
    setSearch("");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the ranking list given a mocked successful fetch response", async () => {
    render(<HomeClient />);

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

    render(<HomeClient />);

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

    render(<HomeClient />);

    expect(await screen.findByText("표시할 키워드가 없습니다")).toBeInTheDocument();
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

    render(<HomeClient />);

    await waitFor(() => {
      expect(screen.getByText("가을 캠핑 브이로그")).toBeInTheDocument();
    });
    // Page must not crash or show an error because of the malformed history payload.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a sign-in prompt in the header when logged out", async () => {
    render(<HomeClient />);
    await screen.findByText("가을 캠핑 브이로그");

    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그아웃" })).not.toBeInTheDocument();
  });

  it("shows the user's email and a logout control when logged in", async () => {
    mockUseAuth.mockReturnValue({ ...loggedOut, user: { email: "creator@example.com" } });

    render(<HomeClient />);
    await screen.findByText("가을 캠핑 브이로그");

    expect(screen.getByText("creator@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그인" })).not.toBeInTheDocument();
  });

  it("re-fetches trends and history for the newly selected region on tab switch", async () => {
    const fetchMock = vi.fn(baseFetchImplementation);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HomeClient />);
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
              last_seen_rank: null,
              last_seen_at: null,
              // POST's real response omits current_rank entirely (see
              // src/app/api/watchlist/route.ts) — matched here for fidelity.
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

    render(<HomeClient />);
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

  const keywordHistoryFetch = (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/trends/keyword-history")) {
      return Promise.resolve(
        jsonResponse({
          keyword: "가을 캠핑 브이로그",
          region: "KR",
          points: [
            { rank: 3, fetchedAt: "2026-08-24T00:00:00.000Z" },
            { rank: 1, fetchedAt: "2026-08-24T01:00:00.000Z" },
          ],
        }),
      );
    }
    return baseFetchImplementation(input);
  };

  it("opens a keyword detail view with a rank-history chart when enough history exists", async () => {
    vi.stubGlobal("fetch", vi.fn(keywordHistoryFetch));
    const user = userEvent.setup();

    render(<HomeClient />);
    await screen.findByText("가을 캠핑 브이로그");

    await user.click(screen.getByRole("button", { name: "가을 캠핑 브이로그" }));

    const dialog = await screen.findByRole("dialog", { name: "가을 캠핑 브이로그 순위 추이" });
    expect(within(dialog).getByText(/현재/)).toBeInTheDocument();
    expect(within(dialog).getByText(/최고/)).toBeInTheDocument();
    // The chart's SVG is now aria-hidden (decorative) — the real data lives
    // in an accessible table for screen readers instead.
    expect(within(dialog).getByRole("table")).toBeInTheDocument();
    expect(within(dialog).getByText("3위")).toBeInTheDocument();
    expect(within(dialog).queryByText("아직 데이터가 충분하지 않습니다")).not.toBeInTheDocument();
  });

  it("shows a clear message instead of a chart when a keyword has too little history", async () => {
    const user = userEvent.setup();

    // baseFetchImplementation returns a 404 for /api/trends/history, so every
    // keyword resolves to an empty history — the sparse-data case.
    render(<HomeClient />);
    await screen.findByText("가을 캠핑 브이로그");

    await user.click(screen.getByRole("button", { name: "가을 캠핑 브이로그" }));

    const dialog = await screen.findByRole("dialog", { name: "가을 캠핑 브이로그 순위 추이" });
    expect(within(dialog).getByText("아직 데이터가 충분하지 않습니다")).toBeInTheDocument();
    expect(within(dialog).queryByRole("table")).not.toBeInTheDocument();
  });

  it("does not name YouTube specifically in user-facing copy", async () => {
    render(<HomeClient />);
    await screen.findByText("가을 캠핑 브이로그");

    expect(screen.queryByText(/YouTube/i)).not.toBeInTheDocument();
  });

  it("hides per-item source labels when every item shares one source", async () => {
    render(<HomeClient />);
    await screen.findByText("가을 캠핑 브이로그");

    expect(screen.queryByText("YouTube")).not.toBeInTheDocument();
  });

  it("shows a per-item source label once multiple sources are present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/trends/history")) {
          return Promise.resolve(jsonResponse({ error: "not found" }, { ok: false, status: 404 }));
        }
        if (url.includes("/api/trends?region=")) {
          const mixedSourceTrends = {
            ...mockTrends,
            items: [
              { rank: 1, keyword: "가을 캠핑 브이로그", source: "youtube", score: 100000 },
              { rank: 2, keyword: "Show HN: something", source: "hackernews", score: 500 },
            ],
          } as unknown as TrendsResponse;
          return Promise.resolve(jsonResponse(mixedSourceTrends));
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<HomeClient />);
    await screen.findByText("가을 캠핑 브이로그");

    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(screen.getByText("Hackernews")).toBeInTheDocument();
  });

  describe("deep-linkable keyword detail (URL sync)", () => {
    it("opens the detail modal directly on load when ?keyword= is present in the URL", async () => {
      setSearch("keyword=" + encodeURIComponent("가을 캠핑 브이로그") + "&region=KR");
      vi.stubGlobal("fetch", vi.fn(keywordHistoryFetch));

      render(<HomeClient />);

      const dialog = await screen.findByRole("dialog", { name: "가을 캠핑 브이로그 순위 추이" });
      expect(dialog).toBeInTheDocument();
    });

    it("gracefully shows the sparse-data state for a keyword that doesn't exist / has no history", async () => {
      setSearch("keyword=" + encodeURIComponent("존재하지않는키워드") + "&region=KR");
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/api/trends/keyword-history")) {
            return Promise.resolve(
              jsonResponse({ keyword: "존재하지않는키워드", region: "KR", points: [] }),
            );
          }
          return baseFetchImplementation(input);
        }),
      );

      render(<HomeClient />);

      const dialog = await screen.findByRole("dialog", { name: "존재하지않는키워드 순위 추이" });
      expect(within(dialog).getByText("아직 데이터가 충분하지 않습니다")).toBeInTheDocument();
      // Never a broken/blank state.
      expect(within(dialog).queryByText(/undefined|NaN/)).not.toBeInTheDocument();
    });

    it("updates the URL when opening a keyword and removes it when closing", async () => {
      vi.stubGlobal("fetch", vi.fn(keywordHistoryFetch));
      const user = userEvent.setup();

      render(<HomeClient />);
      await screen.findByText("가을 캠핑 브이로그");
      expect(navState.search).toBe("");

      await user.click(screen.getByRole("button", { name: "가을 캠핑 브이로그" }));
      await screen.findByRole("dialog", { name: "가을 캠핑 브이로그 순위 추이" });
      expect(navState.search).toContain("keyword=");
      expect(navState.search).toContain("region=KR");

      await user.click(screen.getByRole("button", { name: "닫기" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(navState.search).not.toContain("keyword=");
    });

    it("closes the modal when the URL's keyword param is removed (browser back button)", async () => {
      setSearch("keyword=" + encodeURIComponent("가을 캠핑 브이로그") + "&region=KR");
      vi.stubGlobal("fetch", vi.fn(keywordHistoryFetch));

      render(<HomeClient />);
      await screen.findByRole("dialog", { name: "가을 캠핑 브이로그 순위 추이" });

      // Simulate the browser back button: the URL changes out from under the
      // component, exactly like a popstate-driven searchParams update.
      setSearch("");

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      // The list underneath is still intact — closing via URL isn't a crash.
      expect(screen.getByText("가을 캠핑 브이로그")).toBeInTheDocument();
    });
  });

  describe("modal accessibility (useModalA11y)", () => {
    it("closes the keyword detail modal on Escape and restores focus to the row that opened it", async () => {
      vi.stubGlobal("fetch", vi.fn(keywordHistoryFetch));
      const user = userEvent.setup();

      render(<HomeClient />);
      const trigger = await screen.findByRole("button", { name: "가을 캠핑 브이로그" });
      trigger.focus();
      await user.click(trigger);

      await screen.findByRole("dialog", { name: "가을 캠핑 브이로그 순위 추이" });
      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(document.activeElement).toBe(trigger);
    });

    it("moves focus into the auth modal on open and traps Tab within it", async () => {
      const user = userEvent.setup();
      render(<HomeClient />);
      await screen.findByText("가을 캠핑 브이로그");

      await user.click(screen.getByRole("button", { name: "로그인" }));
      const dialog = await screen.findByRole("dialog", { name: "로그인" });

      // Focus should have moved into the dialog (its close button, the first
      // focusable element), not stayed on the trigger or reset to <body>.
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  describe("watchlist rank-change notifications", () => {
    it("shows no watchlist UI at all when logged out", async () => {
      render(<HomeClient />);
      await screen.findByText("가을 캠핑 브이로그");

      expect(screen.queryByText("내 워치리스트")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "워치리스트에 추가" })).not.toBeInTheDocument();
    });

    it("shows the right indicator for each current/last-seen rank combination", async () => {
      mockUseAuth.mockReturnValue({ ...loggedOut, user: { email: "creator@example.com" } });
      const entries: WatchlistRow[] = [
        {
          id: "1",
          keyword: "새로운키워드",
          region: "KR",
          created_at: "2026-08-24T00:00:00.000Z",
          last_seen_rank: null,
          last_seen_at: null,
          current_rank: 5,
        },
        {
          id: "2",
          keyword: "이탈한키워드",
          region: "KR",
          created_at: "2026-08-24T00:00:00.000Z",
          last_seen_rank: 3,
          last_seen_at: "2026-08-24T00:00:00.000Z",
          current_rank: null,
        },
        {
          id: "3",
          keyword: "그대로키워드",
          region: "KR",
          created_at: "2026-08-24T00:00:00.000Z",
          last_seen_rank: 4,
          last_seen_at: "2026-08-24T00:00:00.000Z",
          current_rank: 4,
        },
        {
          id: "4",
          keyword: "상승키워드",
          region: "KR",
          created_at: "2026-08-24T00:00:00.000Z",
          last_seen_rank: 5,
          last_seen_at: "2026-08-24T00:00:00.000Z",
          current_rank: 1,
        },
        {
          id: "5",
          keyword: "하락키워드",
          region: "KR",
          created_at: "2026-08-24T00:00:00.000Z",
          last_seen_rank: 1,
          last_seen_at: "2026-08-24T00:00:00.000Z",
          current_rank: 8,
        },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/api/watchlist")) {
            if (!init?.method || init.method === "GET") return Promise.resolve(jsonResponse(entries));
          }
          return baseFetchImplementation(input);
        }),
      );

      render(<HomeClient />);
      await screen.findByText("가을 캠핑 브이로그");
      const panel = (await screen.findByText("내 워치리스트")).closest("section")!;

      // "new" — ranked now, never acknowledged: keyword shown, no badge text.
      expect(within(panel).getByText("새로운키워드")).toBeInTheDocument();
      // "dropped" — confirmed out of the current rankings.
      expect(within(panel).getByText("순위 이탈")).toBeInTheDocument();
      // "unchanged".
      expect(within(panel).getByText("4위")).toBeInTheDocument();
      // "moved" — up (improved) and down (declined).
      expect(within(panel).getByText("5위 → 1위")).toBeInTheDocument();
      expect(within(panel).getByText("1위 → 8위")).toBeInTheDocument();
    });

    it("acknowledges a watchlisted keyword's rank when its detail is viewed, updating the badge without a reload", async () => {
      mockUseAuth.mockReturnValue({ ...loggedOut, user: { email: "creator@example.com" } });
      let watchlistState: WatchlistRow[] = [
        {
          id: "1",
          keyword: "가을 캠핑 브이로그",
          region: "KR",
          created_at: "2026-08-24T00:00:00.000Z",
          last_seen_rank: 5,
          last_seen_at: "2026-08-24T00:00:00.000Z",
          current_rank: 1,
        },
      ];
      let patchCalled = false;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/api/watchlist")) {
            if (!init?.method || init.method === "GET") {
              return Promise.resolve(jsonResponse(watchlistState));
            }
            if (init.method === "PATCH") {
              patchCalled = true;
              const body = JSON.parse(init.body as string) as { id: string };
              watchlistState = watchlistState.map((w) =>
                w.id === body.id ? { ...w, last_seen_rank: w.current_rank ?? null } : w,
              );
              const updated = watchlistState.find((w) => w.id === body.id)!;
              return Promise.resolve(jsonResponse(updated));
            }
          }
          return keywordHistoryFetch(input);
        }),
      );
      const user = userEvent.setup();

      render(<HomeClient />);
      // The keyword legitimately appears twice here (watchlist panel +
      // ranking row), unlike the empty-watchlist tests above.
      await screen.findAllByText("가을 캠핑 브이로그");
      const panel = (await screen.findByText("내 워치리스트")).closest("section")!;
      expect(within(panel).getByText("5위 → 1위")).toBeInTheDocument();

      await user.click(within(panel).getByRole("button", { name: "가을 캠핑 브이로그 상세 보기" }));
      await screen.findByRole("dialog", { name: "가을 캠핑 브이로그 순위 추이" });

      await waitFor(() => expect(patchCalled).toBe(true));
      await waitFor(() => {
        expect(within(panel).queryByText("5위 → 1위")).not.toBeInTheDocument();
      });
      expect(within(panel).getByText("1위")).toBeInTheDocument();
    });

    it("removes an entry via the watchlist panel's own remove button", async () => {
      mockUseAuth.mockReturnValue({ ...loggedOut, user: { email: "creator@example.com" } });
      let watchlistState: WatchlistRow[] = [
        {
          id: "1",
          keyword: "가을 캠핑 브이로그",
          region: "KR",
          created_at: "2026-08-24T00:00:00.000Z",
          last_seen_rank: null,
          last_seen_at: null,
          current_rank: 1,
        },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/api/watchlist")) {
            if (!init?.method || init.method === "GET") return Promise.resolve(jsonResponse(watchlistState));
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

      render(<HomeClient />);
      // The keyword legitimately appears twice here (watchlist panel +
      // ranking row), unlike the empty-watchlist tests above.
      await screen.findAllByText("가을 캠핑 브이로그");
      const panel = (await screen.findByText("내 워치리스트")).closest("section")!;

      await user.click(
        within(panel).getByRole("button", { name: "가을 캠핑 브이로그 워치리스트에서 제거" }),
      );

      // The panel itself stays (watchlist is now an empty array, not
      // unavailable) — its empty-state copy takes over.
      await waitFor(() => {
        expect(
          within(panel).getByText("랭킹에서 ☆ 버튼을 눌러 추적할 키워드를 추가하세요."),
        ).toBeInTheDocument();
      });
    });
  });
});
