import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eywa Chat",
  description: "Persistent-memory chatbot",
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
