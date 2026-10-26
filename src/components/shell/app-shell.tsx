"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarDays,
  ChevronDown,
  Fingerprint,
  HeartPulse,
  History,
  Home,
  IdCard,
  Inbox,
  Landmark,
  Leaf,
  LogOut,
  Menu,
  MoreHorizontal,
  Receipt,
  Scale,
  Send,
  Settings,
  User,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type { MenuIcon, MenuItem } from "@/lib/auth/menu";
import { useT } from "@/lib/i18n/client";
import { tDynamic } from "@/lib/i18n";
import { api } from "@/lib/http";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { LanguageSwitch } from "./language-switch";
import { IdleTimer } from "./idle-timer";

const ICONS: Record<MenuIcon, LucideIcon> = {
  home: Home,
  inbox: Inbox,
  wallet: Wallet,
  chart: BarChart3,
  users: Users,
  scale: Scale,
  settings: Settings,
  history: History,
  idcard: IdCard,
  briefcase: Briefcase,
  calendar: CalendarDays,
  landmark: Landmark,
  receipt: Receipt,
  heart: HeartPulse,
  user: UserRound,
  send: Send,
  team: UsersRound,
  fingerprint: Fingerprint,
  leaf: Leaf,
};

interface ShellUser {
  name: string;
  nameHi: string | null;
  loginId: string;
  loginType: string;
  permissions: string[];
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

async function signOut() {
  try {
    const res = await api<{ redirect: string }>("/api/v1/auth/logout", { body: {} });
    // Full page load: every cached screen of the signed-in person must be dropped.
     
    window.location.assign(res.redirect);
  } catch {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}

function NavList({ menu, pathname, onNavigate }: { menu: MenuItem[]; pathname: string; onNavigate?: () => void }) {
  const t = useT();
  return (
    <ul className="space-y-0.5">
      {menu.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.9rem] font-medium transition-colors",
                active ? "bg-brand-50 text-brand-800" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
              )}
            >
              {active && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-600" aria-hidden="true" />}
              <Icon className={cn("size-[1.15rem] shrink-0", active ? "text-brand-700" : "text-ink-400 group-hover:text-ink-600")} aria-hidden="true" />
              <span className="truncate">{tDynamic(t, `nav.${item.key}`)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Brand({ logo }: { logo: string }) {
  const t = useT();
  return (
    <Link href="/home" className="flex items-center gap-3 px-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" className="size-10 rounded-full ring-1 ring-ink-200" />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[0.9rem] font-semibold text-ink-900">{t("app.board")}</p>
        <p className="truncate text-xs text-ink-500">{t("app.name")}</p>
      </div>
    </Link>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-ink-100"
      >
        <Avatar name={user.name} size="sm" />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-ink-800 md:block">{user.name}</span>
        <ChevronDown className="hidden size-4 text-ink-400 md:block" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 animate-fade-in rounded-xl border border-ink-200 bg-white p-1.5 shadow-raised">
          <div className="border-b border-ink-100 px-3 pb-3 pt-2">
            <p className="text-xs text-ink-500">{t("shell.signedInAs")}</p>
            <p className="truncate text-sm font-semibold text-ink-900">{user.name}</p>
            <p className="truncate text-xs text-ink-500">
              {tDynamic(t, `loginType.${user.loginType}`)} · {user.loginId}
            </p>
          </div>
          <Link href="/profile" role="menuitem" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
            <User className="size-4 text-ink-400" aria-hidden="true" /> {t("nav.profile")}
          </Link>
          <button type="button" role="menuitem" onClick={signOut} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50">
            <LogOut className="size-4" aria-hidden="true" /> {t("common.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({
  menu,
  user,
  inboxCount,
  logo,
  idleTimeoutMs,
  mobileBottomNav,
  children,
}: {
  menu: MenuItem[];
  user: ShellUser;
  inboxCount: number | null;
  logo: string;
  idleTimeoutMs: number;
  mobileBottomNav: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  const bottomItems = menu.slice(0, 4);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-raised">
        {t("shell.skipToContent")}
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] flex-col border-r border-ink-200/80 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-ink-100 px-4">
          <Brand logo={logo} />
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4" aria-label={t("nav.menu")}>
          <NavList menu={menu} pathname={pathname} />
        </nav>
        <div className="border-t border-ink-100 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
            <Avatar name={user.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-900">{user.name}</p>
              <p className="truncate text-xs text-ink-500">{tDynamic(t, `loginType.${user.loginType}`)}</p>
            </div>
            <button type="button" onClick={signOut} className="rounded-lg p-1.5 text-ink-400 hover:bg-white hover:text-red-600" aria-label={t("common.signOut")} title={t("common.signOut")}>
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
          <div className="absolute inset-0 animate-fade-in bg-ink-950/40 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs animate-slide-in-left flex-col bg-white shadow-overlay">
            <div className="flex h-16 items-center justify-between border-b border-ink-100 px-4">
              <Brand logo={logo} />
              <button type="button" onClick={() => setDrawer(false)} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label={t("shell.closeMenu")}>
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <NavList menu={menu} pathname={pathname} onNavigate={() => setDrawer(false)} />
            </nav>
            <div className="border-t border-ink-100 p-3">
              <button type="button" onClick={signOut} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50">
                <LogOut className="size-4" aria-hidden="true" /> {t("common.signOut")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="lg:pl-[17rem]">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200/70 bg-white/85 px-4 backdrop-blur-md sm:px-6">
          <button type="button" onClick={() => setDrawer(true)} className="-ml-1 rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden" aria-label={t("shell.openMenu")}>
            <Menu className="size-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="" className="size-8 rounded-full ring-1 ring-ink-200" />
            <span className="truncate text-sm font-semibold text-ink-900">{t("app.boardShort")} HRMS</span>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {inboxCount !== null && (
              <Link
                href="/approvals"
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors",
                  inboxCount > 0 ? "bg-gold-50 text-gold-600 ring-1 ring-gold-500/30 hover:bg-gold-100" : "text-ink-500 hover:bg-ink-100",
                )}
              >
                <Bell className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t("shell.waitingForYou")}</span>
                <span className="tabular rounded-full bg-white px-1.5 text-xs font-semibold ring-1 ring-inset ring-current/20" data-testid="inbox-count">
                  {inboxCount}
                </span>
              </Link>
            )}
            <LanguageSwitch compact />
            <UserMenu user={user} />
          </div>
        </header>

        <main id="main" className={cn("mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8", mobileBottomNav && "pb-28 lg:pb-8")}>
          {children}
        </main>
      </div>

      {/* Phone bottom bar for employees and pensioners — last payslip is two taps away (PRD §1). */}
      {mobileBottomNav && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label={t("nav.menu")}>
          <ul className="grid grid-cols-5">
            {bottomItems.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.key}>
                  <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-1 px-1 py-2.5 text-[0.7rem] font-medium", active ? "text-brand-700" : "text-ink-500")}>
                    <Icon className="size-5" aria-hidden="true" />
                    <span className="max-w-full truncate">{tDynamic(t, `navShort.${item.key}`)}</span>
                  </Link>
                </li>
              );
            })}
            <li>
              <button type="button" onClick={() => setDrawer(true)} className="flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[0.7rem] font-medium text-ink-500">
                <MoreHorizontal className="size-5" aria-hidden="true" />
                <span>{t("nav.more")}</span>
              </button>
            </li>
          </ul>
        </nav>
      )}

      <IdleTimer timeoutMs={idleTimeoutMs} onTimeout={signOut} />
    </div>
  );
}
