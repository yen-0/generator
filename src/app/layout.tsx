import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "複数アキネーター生成器",
  description: "日本語教材向けの画像シートをまとめて生成できるワークスペースです。",
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
