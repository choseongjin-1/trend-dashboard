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

export const metadata: Metadata = {
  title: "SPIKE — 지금 뜨는 키워드를 가장 먼저",
  description: "YouTube 인기 급상승 기준 실시간 키워드 랭킹 대시보드",
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
