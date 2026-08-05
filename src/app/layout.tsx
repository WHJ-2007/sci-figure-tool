import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "科研制图工具",
  description: "AI 辅助的科研示意图编辑器",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
