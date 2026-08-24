import type { Metadata } from "next";
import { Black_Han_Sans, Nanum_Gothic_Coding, IBM_Plex_Sans_KR } from "next/font/google";
import "./globals.css";

const blackHanSans = Black_Han_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const ibmPlexSansKR = IBM_Plex_Sans_KR({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Split-flap boards use one fixed-width character set for every character on
// the board — keywords included, not just numbers. Space Mono (the original
// pick) is Latin-only and can't render Hangul, which is most of this
// product's actual keyword text, so the mechanical/data role needs a real
// Korean coding-monospace face instead.
const nanumGothicCoding = Nanum_Gothic_Coding({
  variable: "--font-data",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const TITLE = "FLIP — 지금 뜨는 키워드를 가장 먼저";
const DESCRIPTION =
  "YouTube 인기 급상승 신호를 실시간으로 감지하는 키워드 랭킹 보드. 워치리스트에 담아두면 순위가 바뀔 때마다 가장 먼저 알 수 있어요.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "FLIP",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${blackHanSans.variable} ${ibmPlexSansKR.variable} ${nanumGothicCoding.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-casing text-flap">{children}</body>
    </html>
  );
}
