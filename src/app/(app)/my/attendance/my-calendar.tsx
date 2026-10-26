"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageSquarePlus, Send } from "lucide-react";
import type { DayStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { formatDate, istTime, weekday } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { BADGE, CELL } from "../../attendance/_components/tones";

export interface CalDay {
  date: string;
  status: DayStatus | null;
  onRoll: boolean;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number | null;
  holidayName: string | null;
}

/** Monday-first month calendar with a correction request (AT-04). */
export function MyCalendar({ days, today, canRequestFrom, locked, manual }: { days: CalDay[]; today: string; canRequestFrom: string; locked: boolean; manual: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState<CalDay | null>(null);
  const [form, setForm] = useState<{ date: string; type: "MISSED_PUNCH" | "ON_DUTY"; inTime: string; outTime: string; reason: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lead = (weekday(days[0].date) + 6) % 7;
  const requestable = (d: CalDay) => !locked && d.onRoll && d.date <= today && d.date >= canRequestFrom;

  function startRequest(d: CalDay) {
    setOpen(null);
    setErrors({});
    setForm({ date: d.date, type: manual ? "ON_DUTY" : "MISSED_PUNCH", inTime: "", outTime: "", reason: "" });
  }

  async function send() {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/attendance/requests", { body: form });
      toast(t("attendance.my.sent"));
      setForm(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  const worked = (m: number | null) => (m ? t("attendance.my.worked", { h: Math.floor(m / 60), m: m % 60 }) : null);

  return (
    <>
      <div className="grid grid-cols-7 gap-1 px-3 pb-4 pt-3 sm:gap-1.5 sm:px-5">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <p key={d} className="pb-1 text-center text-[0.7rem] font-semibold uppercase tracking-wide text-ink-500">
            {tDynamic(t, `attendance.weekday.${d}`)}
          </p>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => setOpen(d)}
            data-date={d.date}
            aria-label={`${formatDate(d.date, locale)}${d.status ? ` · ${tDynamic(t, `attendance.status.${d.status}`)}` : ""}`}
            className={cn(
              "flex min-h-16 flex-col items-start rounded-xl border p-1.5 text-left transition-shadow hover:shadow-raised sm:min-h-20 sm:p-2",
              d.date === today ? "border-brand-500 ring-2 ring-brand-500/20" : "border-ink-100",
              !d.onRoll && "opacity-40",
              d.status ? CELL[d.status] : "bg-white text-ink-700",
            )}
          >
            <span className="tabular text-xs font-semibold sm:text-sm">{Number(d.date.slice(8))}</span>
            {d.status && <span className="mt-auto line-clamp-2 text-[0.6rem] font-medium leading-tight sm:text-[0.7rem]">{tDynamic(t, `attendance.status.${d.status}`)}</span>}
            {d.firstIn && <span className="tabular hidden text-[0.65rem] opacity-80 sm:block">{istTime(new Date(d.firstIn))}{d.lastOut ? `–${istTime(new Date(d.lastOut))}` : ""}</span>}
          </button>
        ))}
      </div>

      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        size="sm"
        closeLabel={t("common.close")}
        title={open ? formatDate(open.date, locale) : ""}
        description={open?.holidayName ?? undefined}
        footer={
          open && requestable(open) ? (
            <Button variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={() => startRequest(open)}>
              {t("attendance.my.request")}
            </Button>
          ) : undefined
        }
      >
        {open && (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-ink-500">{t("common.status")}</dt>
              <dd className="mt-1">{open.status ? <Badge tone={BADGE[open.status]} dot>{tDynamic(t, `attendance.status.${open.status}`)}</Badge> : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-500">{t("attendance.my.in")}</dt>
              <dd className="tabular mt-1 font-medium text-ink-900">{open.firstIn ? istTime(new Date(open.firstIn)) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-500">{t("attendance.my.out")}</dt>
              <dd className="tabular mt-1 font-medium text-ink-900">{open.lastOut ? istTime(new Date(open.lastOut)) : "—"}</dd>
            </div>
            {worked(open.workedMinutes) && <p className="col-span-2 text-xs text-ink-500">{worked(open.workedMinutes)}</p>}
          </dl>
        )}
      </Dialog>

      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        closeLabel={t("common.close")}
        title={t("attendance.my.request")}
        description={t("attendance.my.requestHint")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon={<Send className="size-4" />} loading={busy} onClick={send}>
              {t("attendance.my.send")}
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Input label={t("attendance.my.date")} type="date" value={form.date} max={today} min={canRequestFrom} onChange={(e) => setForm({ ...form, date: e.target.value })} error={errors.date} required />
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-ink-800">{t("attendance.my.type")}</p>
              <Segmented
                label={t("attendance.my.type")}
                value={form.type}
                onChange={(type) => setForm({ ...form, type })}
                options={[...(manual ? [] : [{ value: "MISSED_PUNCH" as const, label: t("attendance.my.missedPunch") }]), { value: "ON_DUTY" as const, label: t("attendance.my.onDuty") }]}
              />
            </div>
            {form.type === "MISSED_PUNCH" && (
              <div className="grid grid-cols-2 gap-3">
                <Input label={t("attendance.my.inTime")} type="time" value={form.inTime} onChange={(e) => setForm({ ...form, inTime: e.target.value })} error={errors.inTime} />
                <Input label={t("attendance.my.outTime")} type="time" value={form.outTime} onChange={(e) => setForm({ ...form, outTime: e.target.value })} error={errors.outTime} />
                <p className="col-span-2 -mt-1 text-xs text-ink-500">{t("attendance.my.timeHint")}</p>
              </div>
            )}
            <Textarea label={t("attendance.my.reason")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t("attendance.my.reasonPlaceholder")} error={errors.reason} required rows={3} />
          </div>
        )}
      </Dialog>
    </>
  );
}
