import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const getSupabaseRouteHandlerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseRouteHandlerClient: () => getSupabaseRouteHandlerClient(),
}));

// Imported after the mock so route.ts picks up the mocked module.
const { GET } = await import("./route");

function req(url: string) {
  return new NextRequest(new URL(url, "https://example.com"));
}

describe("GET /auth/callback", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exchanges a valid code and redirects to / by default", async () => {
    getSupabaseRouteHandlerClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(req("https://example.com/auth/callback?code=valid-code"));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://example.com/");
  });

  it("honors a same-origin ?next= path on success", async () => {
    getSupabaseRouteHandlerClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(req("https://example.com/auth/callback?code=valid-code&next=/settings"));

    expect(res.headers.get("location")).toBe("https://example.com/settings");
  });

  it("ignores an off-origin ?next= (open-redirect guard) and falls back to /", async () => {
    getSupabaseRouteHandlerClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req("https://example.com/auth/callback?code=valid-code&next=https://evil.example/")
    );

    expect(res.headers.get("location")).toBe("https://example.com/");
  });

  it("redirects to /?auth_error=1 when the exchange fails (expired/used code)", async () => {
    getSupabaseRouteHandlerClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });
    exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid code" } });

    const res = await GET(req("https://example.com/auth/callback?code=expired-or-used"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://example.com/?auth_error=1");
  });

  it("redirects to /?auth_error=1 when no code is present, without calling Supabase", async () => {
    const res = await GET(req("https://example.com/auth/callback"));

    expect(getSupabaseRouteHandlerClient).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://example.com/?auth_error=1");
  });

  it("redirects to /?auth_error=1 rather than throwing when Supabase isn't configured", async () => {
    getSupabaseRouteHandlerClient.mockResolvedValue(null);

    const res = await GET(req("https://example.com/auth/callback?code=valid-code"));

    expect(res.headers.get("location")).toBe("https://example.com/?auth_error=1");
  });
});
