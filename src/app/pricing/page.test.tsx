import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PricingPage from "./page";

describe("Pricing page", () => {
  it("renders a page heading and both tier headings", () => {
    render(<PricingPage />);
    expect(screen.getByRole("heading", { level: 1, name: "요금제" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "무료" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "프리미엄" })).toBeInTheDocument();
  });

  it("lists free-tier features, including what's actually built", () => {
    render(<PricingPage />);
    expect(screen.getByText(/실시간 키워드 랭킹/)).toBeInTheDocument();
    expect(screen.getByText(/키워드 검색·필터/)).toBeInTheDocument();
    expect(screen.getByText(/관심 키워드 추적/)).toBeInTheDocument();
  });

  it("lists premium-tier features distinct from the free tier", () => {
    render(<PricingPage />);
    expect(screen.getByText(/워치리스트 히스토리 전체 보관/)).toBeInTheDocument();
    expect(screen.getByText(/CSV 내보내기/)).toBeInTheDocument();
  });

  it("free tier CTA is a real, working link back to the board", () => {
    render(<PricingPage />);
    const cta = screen.getByRole("link", { name: "무료로 시작하기" });
    expect(cta).toHaveAttribute("href", "/");
  });

  it("premium tier CTA is honestly disabled, not a fake or dead link", () => {
    render(<PricingPage />);
    const cta = screen.getByRole("button", { name: "프리미엄 — 곧 출시" });
    expect(cta).toBeDisabled();
    // A disabled <button> — never an <a href> pretending to lead somewhere.
    expect(cta.tagName).toBe("BUTTON");
    expect(screen.getByText(/출시되면 이 페이지에서 가장 먼저 안내해 드릴게요/)).toBeInTheDocument();
  });

  it("header wordmark links back to the dashboard", () => {
    render(<PricingPage />);
    const home = screen.getByRole("link", { name: "FLIP" });
    expect(home).toHaveAttribute("href", "/");
  });
});
