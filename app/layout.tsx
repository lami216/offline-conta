import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "../lib/app-brand";
import "./globals.css";

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description: "نظام نقاط بيع ومشتريات ومخازن وحسابات قابل للتدقيق.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/alkarna-logo.png",
    shortcut: "/alkarna-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
