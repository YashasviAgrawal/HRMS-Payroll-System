import { cn } from "@/lib/utils";
import { tDynamic, type TFunction } from "@/lib/i18n";
import type { BalanceView } from "@/modules/leave/balance";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** One card per leave the person may take: the number that matters, then the fine print. */
export function BalanceCards({ balances, t, locale, compact }: { balances: BalanceView[]; t: TFunction; locale: "en" | "hi"; compact?: boolean }) {
  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-5")}>
      {balances.map((b) => {
        const main = b.available ?? b.balance;
        const sub =
          b.creditMode === "SPELL"
            ? t("leave.perSpell", { days: fmt(b.balance ?? 0) })
            : b.creditMode === "SERVICE"
              ? t("leave.inService", { days: fmt(b.balance ?? 0) })
              : b.debitFrom
                ? t("leave.fromOther", { code: b.debitFrom, factor: 2 })
                : b.balance === null
                  ? t("leave.noLimit")
                  : b.pending > 0
                    ? t("leave.waiting", { days: fmt(b.pending) })
                    : tDynamic(t, `leave.pay.${b.pay}`);
        return (
          <div key={b.code} className="rounded-2xl border border-ink-200/80 bg-white p-4 shadow-card" data-leave={b.code}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug text-ink-700">{locale === "hi" ? b.nameHi : b.name}</p>
              <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[0.65rem] font-semibold text-ink-500">{b.code}</span>
            </div>
            <p className={cn("tabular mt-2 text-2xl font-semibold tracking-tight", main === null ? "text-ink-300" : main <= 0 ? "text-red-700" : b.creditMode === "SPELL" || b.creditMode === "SERVICE" ? "text-ink-700" : "text-brand-800")}>{main === null || b.debitFrom ? "—" : fmt(main)}</p>
            <p className="mt-1 text-xs text-ink-500">{sub}</p>
          </div>
        );
      })}
    </div>
  );
}
