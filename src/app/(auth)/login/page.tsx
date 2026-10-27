import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BadgeCheck, CalendarCheck2, IndianRupee, ShieldCheck } from "lucide-react";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { getActor } from "@/lib/auth/session";
import { logoSrc } from "@/lib/brand";
import { devHelpersEnabled } from "@/lib/env";
import { getT } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  if (await getActor()) redirect("/home");
  const { reason } = await searchParams;
  const { t } = await getT();
  const logo = logoSrc();

  const points = [
    { icon: IndianRupee, text: t("login.point1") },
    { icon: CalendarCheck2, text: t("login.point2") },
    { icon: ShieldCheck, text: t("login.point3") },
  ];

  return (
    <main className="grid grid-cols-1 min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="brand-gradient relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="grid-pattern absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="" className="size-16 rounded-full bg-white p-1 shadow-lg shadow-black/20" />
          <div>
            <p className="text-lg font-semibold leading-tight">{t("app.board")}</p>
            <p className="text-sm text-white/70">{t("app.govt")}</p>
          </div>
        </div>
        <div className="relative max-w-lg">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/20">
            <BadgeCheck className="size-3.5" aria-hidden="true" /> {t("app.boardShort")} · Release 1
          </p>
          <h1 className="text-4xl font-semibold leading-[1.15] tracking-tight xl:text-5xl">{t("app.name")}</h1>
          <p className="mt-4 text-lg text-white/80">{t("app.tagline")}</p>
          <ul className="mt-10 space-y-4">
            {points.map((p, i) => (
              <li key={i} className="flex items-center gap-3 text-white/90">
                <span className="flex size-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <p.icon className="size-4.5" aria-hidden="true" />
                </span>
                <span className="text-[0.95rem]">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/60">{t("login.helpdesk")}</p>
      </section>

      {/* Form panel */}
      <section className="relative flex flex-col bg-white">
        <div className="flex items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3 lg:invisible">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="" className="size-10 rounded-full ring-1 ring-ink-200" />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-ink-900">{t("app.board")}</p>
              <p className="text-xs text-ink-500">{t("app.name")}</p>
            </div>
          </div>
          <LanguageSwitch />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12 pt-4 sm:px-8">
          <div className="w-full max-w-[420px]">
            <LoginForm reason={reason ?? null} devMode={devHelpersEnabled()} />
          </div>
        </div>
        <p className="px-5 pb-6 text-center text-xs text-ink-400 sm:px-8 lg:hidden">{t("login.helpdesk")}</p>
      </section>
    </main>
  );
}
