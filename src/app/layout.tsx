import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "画像シート生成",
  description: "表形式で入力してPNG画像をまとめて生成します。",
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
