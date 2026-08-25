import type { Metadata } from "next";
import Link from "next/link";

const TITLE = "요금제 — FLIP";
const DESCRIPTION = "FLIP의 무료 기능과 준비 중인 프리미엄 기능을 확인하세요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
};

interface Tier {
  name: string;
  tagline: string;
  features: string[];
}

const FREE: Tier = {
  name: "무료",
  tagline: "지금 뜨는 키워드, 누구나 바로",
  features: [
    "실시간 키워드 랭킹 (한국·미국·일본)",
    "키워드 검색·필터",
    "워치리스트 — 관심 키워드 추적 + 순위 변동 알림",
    "키워드 상세 보기 및 순위 추이",
  ],
};

const PREMIUM: Tier = {
  name: "프리미엄",
  tagline: "더 깊이, 더 오래 추적하고 싶다면",
  features: [
    "워치리스트 히스토리 전체 보관 (무료는 최근 구간만)",
    "지역·소스 무제한 확장 — 새 지역이 열리는 즉시 이용",
    "랭킹 데이터 CSV 내보내기",
    "신규 소스·기능 우선 반영",
  ],
};

/*
 * Tier cards borrow the board's own visual vocabulary instead of a generic
 * pricing-table look: a settled tier reads like a resolved flap row (solid
 * panel, solid border); a not-yet-real tier reads like the app's existing
 * "nothing here yet" empty state (dashed border, dimmer text) — see
 * EmptyFlaps.tsx / HomeClient.tsx's empty states for the same pattern. No
 * decorative color: rising/falling stay reserved for rank-delta status.
 */
function TierCard({ tier, resolved, cta }: { tier: Tier; resolved: boolean; cta: React.ReactNode }) {
  const headingId = `tier-${tier.name}`;
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-1 flex-col rounded-sm px-5 py-6 ${
        resolved
          ? "border border-flap-dim/10 bg-panel shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_2px_4px_rgba(0,0,0,0.35)]"
          : "border border-dashed border-flap-dim/25 bg-transparent"
      }`}
    >
      <h2 id={headingId} className="font-display text-lg tracking-wide text-flap">
        {tier.name}
      </h2>
      <p className="mt-1 text-xs text-flap-dim">{tier.tagline}</p>
      <ul className="mt-5 flex flex-1 flex-col gap-2.5">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 font-data text-xs text-flap-dim">
            <span className={resolved ? "text-flap" : "text-flap-dim/50"} aria-hidden="true">
              {resolved ? "✓" : "·"}
            </span>
            <span className={resolved ? "text-flap" : ""}>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6">{cta}</div>
    </section>
  );
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-casing text-flap">
      <header className="border-b border-flap-dim/20 bg-panel">
        <div className="mx-auto max-w-2xl px-6 py-4">
          <Link href="/" className="font-display text-xl tracking-wide text-flap">
            FLIP
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="font-display text-2xl tracking-wide text-flap">요금제</h1>
        <p className="mt-2 text-sm text-flap-dim">
          오늘의 랭킹은 언제나 무료입니다. 더 깊은 추적이 필요해지면 프리미엄을 준비하고
          있어요.
        </p>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <TierCard
            tier={FREE}
            resolved
            cta={
              <Link
                href="/"
                className="inline-block w-full rounded-sm border border-flap-dim/20 px-3 py-2 text-center font-data text-xs text-flap transition hover:border-flap-dim/40"
              >
                무료로 시작하기
              </Link>
            }
          />
          <TierCard
            tier={PREMIUM}
            resolved={false}
            cta={
              <div>
                <button
                  disabled
                  className="w-full cursor-not-allowed rounded-sm border border-dashed border-flap-dim/25 px-3 py-2 font-data text-xs text-flap-dim"
                >
                  프리미엄 — 곧 출시
                </button>
                <p className="mt-2 text-[11px] text-flap-dim">
                  출시되면 이 페이지에서 가장 먼저 안내해 드릴게요.
                </p>
              </div>
            }
          />
        </div>
      </main>
    </div>
  );
}
