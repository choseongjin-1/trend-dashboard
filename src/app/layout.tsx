import type { Metadata } from "next";
import { Gothic_A1, Noto_Sans_KR, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const gothicA1 = Gothic_A1({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["700", "900"],
});

const notoSansKR = Noto_Sans_KR({
  variable: "--font-body",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-data",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const TITLE = "SPIKE — 지금 뜨는 키워드를 가장 먼저";
const DESCRIPTION =
  "YouTube 인기 급상승 신호를 실시간으로 감지하는 키워드 랭킹 대시보드. 워치리스트에 담아두면 순위가 바뀔 때마다 가장 먼저 알 수 있어요.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "SPIKE",
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
      className={`${gothicA1.variable} ${notoSansKR.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text">{children}</body>
    </html>
  );
}
