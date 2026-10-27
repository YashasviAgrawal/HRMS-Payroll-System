"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PencilLine, Send, X } from "lucide-react";
import type { DayStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import { formatDate, istTime, weekday } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { MUSTER_STATUSES, STATUS_CODE, type MonthTotals } from "@/modules/attendance/rules";
import { CELL } from "./tones";

export interface GridDay {
  date: string;
  status: DayStatus | null;
  onRoll: boolean;
  unmarked: boolean;
  pending?: DayStatus | null | "CLEAR";
  firstIn: string | null;
  lastOut: string | null;
  half: boolean;
}

export interface GridRow {
  employee: { id: string; code: string; name: string; nameHi: string | null; post: string; postHi: string; type: string };
  days: GridDay[];
  totals: MonthTotals;
}

type Change = DayStatus | null;

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function RegisterGrid({
  rows,
  dates,
  holidays,
  weeklyOff,
  sectionId,
  month,
  today,
  canEdit,
}: {
  rows: GridRow[];
  dates: string[];
  holidays: { date: string; name: string; nameHi: string }[];
  weeklyOff: number[];
  sectionId: string;
  month: string;
  today: string;
  canEdit: boolean;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [picking, setPicking] = useState<{ row: GridRow; day: GridDay } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const holidayOn = useMemo(() => new Map(holidays.map((h) => [h.date, locale === "hi" ? h.nameHi : h.name])), [holidays, locale]);
  const count = Object.keys(changes).length;

  async function send() {
    setBusy(true);
    try {
      await api("/api/v1/attendance/muster", {
        body: {
          sectionId,
          month,
          note: note || undefined,
          entries: Object.entries(changes).map(([key, status]) => {
            const [employeeId, date] = key.split("|");
            return { employeeId, date, status };
          }),
        },
      });
      toast(t("attendance.register.sent"));
      setChanges({});
      setEditing(false);
      setNote("");
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  }

  const name = (r: GridRow) => (locale === "hi" && r.employee.nameHi) || r.employee.name;

  function cellTitle(r: GridRow, d: GridDay) {
    const parts = [`${name(r)} · ${formatDate(d.date, locale)}`];
    if (!d.onRoll) parts.push(t("attendance.register.notOnRolls"));
    else if (d.status) parts.push(tDynamic(t, `attendance.status.${d.status}`));
    if (d.firstIn) parts.push(`${t("attendance.my.in")} ${istTime(new Date(d.firstIn))}`);
    if (d.lastOut) parts.push(`${t("attendance.my.out")} ${istTime(new Date(d.lastOut))}`);
    if (d.pending !== undefined) parts.push(t("attendance.register.pending"));
    const h = holidayOn.get(d.date);
    if (h) parts.push(h);
    return parts.join(" · ");
  }

  return (
    <div>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3 sm:px-6">
          <p className="text-sm text-ink-600">{editing ? t("attendance.register.editHint") : ""}</p>
          {editing ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<X className="size-4" />}
              onClick={() => {
                setEditing(false);
                setChanges({});
              }}
            >
              {t("attendance.register.stopEditing")}
            </Button>
          ) : (
            <Button size="sm" icon={<PencilLine className="size-4" />} onClick={() => setEditing(true)}>
              {t("attendance.register.edit")}
            </Button>
          )}
        </div>
      )}

      {/* relative: keeps the screen-reader labels inside the scroll box instead of widening the page */}
      <ScrollArea label={t("attendance.tabs.register")}>
        <table className="border-separate border-spacing-0 text-xs" aria-label={t("attendance.tabs.register")}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[2] min-w-36 border-b sm:min-w-48 border-ink-200 bg-ink-50 px-4 py-2 text-left font-semibold uppercase tracking-wide text-ink-500 sm:px-6">
                {t("attendance.register.employee")}
              </th>
              {dates.map((d) => {
                const off = weeklyOff.includes(weekday(d));
                const hol = holidayOn.has(d);
                return (
                  <th
                    key={d}
                    scope="col"
                    title={holidayOn.get(d)}
                    className={cn(
                      "w-8 min-w-8 border-b border-ink-200 px-0 py-1.5 text-center font-medium",
                      hol ? "bg-gold-50 text-gold-600" : off ? "bg-ink-100 text-ink-500" : "bg-ink-50 text-ink-500",
                      d === today && "text-brand-700 shadow-[inset_0_-2px_0_var(--color-brand-600)]",
                    )}
                  >
                    <span className="block text-[0.7rem] leading-none">{Number(d.slice(8))}</span>
                    <span className="block text-[0.6rem] uppercase leading-tight">{tDynamic(t, `attendance.weekday.${weekday(d)}`).slice(0, 2)}</span>
                  </th>
                );
              })}
              {(["P", "½", "OD", "LV", "A", "M", "DN"] as const).map((h) => (
                <th key={h} scope="col" className="w-10 min-w-10 border-b border-l border-ink-200 bg-ink-50 px-1 py-2 text-center font-semibold text-ink-500 first-of-type:border-l">
                  {h}
                </th>
              ))}
              {/* The two totals payroll uses stay in view while the days scroll. */}
              <th scope="col" className="z-[2] w-20 md:sticky md:right-20 min-w-20 border-b border-l border-ink-200 bg-ink-50 px-2 py-2 text-center font-semibold leading-tight text-ink-600 md:shadow-[-8px_0_10px_-8px_rgb(15_32_24/0.18)]">{t("attendance.register.payable")}</th>
              <th scope="col" className="z-[2] w-20 md:sticky md:right-0 min-w-20 border-b border-ink-200 bg-ink-50 px-2 py-2 text-center font-semibold leading-tight text-ink-600">{t("attendance.register.worked")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee.id} className="group">
                <th scope="row" className="sticky left-0 z-[1] max-w-36 border-b border-ink-100 bg-white px-4 py-2 text-left font-normal group-hover:bg-ink-50 sm:max-w-none sm:px-6">
                  <p className="truncate text-sm font-medium text-ink-900">{name(r)}</p>
                  <p className="truncate text-[0.7rem] text-ink-500">
                    {r.employee.code} · {locale === "hi" ? r.employee.postHi : r.employee.post}
                  </p>
                </th>
                {r.days.map((d) => {
                  const key = `${r.employee.id}|${d.date}`;
                  const changed = key in changes;
                  const shown: DayStatus | null = changed ? changes[key] : d.pending !== undefined ? (d.pending === "CLEAR" ? null : d.pending) : d.status;
                  const editable = editing && d.onRoll && d.date <= today && d.pending === undefined;
                  const content = !d.onRoll ? "" : shown ? STATUS_CODE[shown] : d.unmarked ? "·" : "";
                  const cls = cn(
                    "flex h-8 w-full items-center justify-center rounded-md text-[0.7rem] tabular",
                    !d.onRoll ? "bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,var(--color-ink-100)_3px,var(--color-ink-100)_5px)]" : shown ? CELL[shown] : d.unmarked ? "bg-amber-50/60 text-amber-700 ring-1 ring-inset ring-amber-300" : "text-ink-300",
                    d.pending !== undefined && !changed && "outline-1 outline-dashed -outline-offset-2 outline-amber-500",
                    changed && "ring-2 ring-inset ring-brand-600",
                    editable && "cursor-pointer hover:ring-2 hover:ring-brand-400",
                  );
                  return (
                    <td key={d.date} className="border-b border-ink-100 p-0.5" data-status={shown ?? (d.unmarked ? "UNMARKED" : "")} data-date={d.date}>
                      {editable ? (
                        <button type="button" className={cls} onClick={() => setPicking({ row: r, day: d })} aria-label={cellTitle(r, d)} title={cellTitle(r, d)}>
                          {content}
                        </button>
                      ) : (
                        <div className={cls} title={cellTitle(r, d)}>
                          {content}
                          <span className="sr-only">{cellTitle(r, d)}</span>
                        </div>
                      )}
                    </td>
                  );
                })}
                {[r.totals.present, r.totals.halfDays, r.totals.onDuty, r.totals.leave, r.totals.absent, r.totals.missedPunch, r.totals.diesNon].map((v, i) => (
                  <td key={i} className={cn("tabular border-b border-l border-ink-100 px-1 text-center text-ink-700", i >= 4 && v > 0 && "font-semibold text-red-700")}>
                    {v ? fmtNum(v) : "–"}
                  </td>
                ))}
                <td className="tabular z-[1] w-20 md:sticky md:right-20 min-w-20 border-b border-l border-ink-100 bg-white px-2 text-center text-sm font-semibold text-ink-900 md:shadow-[-8px_0_10px_-8px_rgb(15_32_24/0.18)] group-hover:bg-ink-50">{fmtNum(r.totals.payableDays)}</td>
                <td className={cn("tabular z-[1] w-20 md:sticky md:right-0 min-w-20 border-b border-ink-100 bg-white px-2 text-center text-sm group-hover:bg-ink-50", ["CONTRACT", "DAILY_WAGE"].includes(r.employee.type) ? "font-semibold text-brand-800" : "text-ink-500")}>{fmtNum(r.totals.workedDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>

      {editing && count > 0 && (
        <div className="sticky bottom-0 z-[3] flex flex-wrap items-end gap-3 border-t border-ink-200 bg-white/95 px-5 py-3 backdrop-blur sm:px-6">
          <Input label={t("attendance.register.noteLabel")} value={note} onChange={(e) => setNote(e.target.value)} containerClassName="min-w-56 flex-1" optionalLabel={t("common.optional")} />
          <Button variant="primary" icon={<Send className="size-4" />} loading={busy} onClick={send}>
            {t("attendance.register.send", { count })}
          </Button>
        </div>
      )}

      <Dialog
        open={!!picking}
        onClose={() => setPicking(null)}
        size="sm"
        closeLabel={t("common.close")}
        title={picking ? t("attendance.register.chooseStatus", { name: name(picking.row), date: formatDate(picking.day.date, locale) }) : ""}
        description={
          picking
            ? picking.day.firstIn
              ? `${t("attendance.register.punches")}: ${istTime(new Date(picking.day.firstIn))}${picking.day.lastOut ? ` – ${istTime(new Date(picking.day.lastOut))}` : ""}`
              : t("attendance.register.noPunches")
            : undefined
        }
      >
        {picking && (
          <div className="grid gap-2">
            {MUSTER_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setChanges((c) => ({ ...c, [`${picking.row.employee.id}|${picking.day.date}`]: s }));
                  setPicking(null);
                }}
                className="flex items-center gap-3 rounded-xl border border-ink-200 px-3 py-2.5 text-left text-sm font-medium text-ink-800 transition-colors hover:border-brand-300 hover:bg-brand-50/50"
              >
                <span className={cn("flex size-8 items-center justify-center rounded-lg text-xs", CELL[s])}>{STATUS_CODE[s]}</span>
                {tDynamic(t, `attendance.status.${s}`)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const key = `${picking.row.employee.id}|${picking.day.date}`;
                setChanges((c) => ({ ...c, [key]: null }));
                setPicking(null);
              }}
              className="rounded-xl px-3 py-2 text-left text-sm text-ink-600 hover:bg-ink-50"
            >
              {t("attendance.register.clear")}
            </button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
