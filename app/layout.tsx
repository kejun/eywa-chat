import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eywa",
  description: "AI assistant with persistent memory",
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
