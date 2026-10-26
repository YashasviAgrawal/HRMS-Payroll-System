import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/500.css";
import "@fontsource/noto-sans-devanagari/600.css";
import "@fontsource/noto-sans-devanagari/700.css";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: { default: "DCB HRMS & Payroll", template: "%s · DCB HRMS" },
  description: "Delhi Cantonment Board — employee records, attendance, leave, payroll and pension.",
  robots: { index: false, follow: false },
  icons: { icon: "/brand/logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#116541",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
