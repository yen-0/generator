import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "画像シート生成",
  description: "日本語入力に合わせた4モードのPNG生成ツールです。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
