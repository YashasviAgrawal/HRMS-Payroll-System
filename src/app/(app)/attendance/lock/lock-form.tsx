"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock } from "lucide-react";
import type { DayStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardFooter } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Select, controlClass } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatDate, istTime } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { RESOLUTIONS } from "@/modules/attendance/rules";
import { BADGE } from "../_components/tones";

export interface Exception {
  employeeId: string;
  code: string;
  name: string;
  nameHi: string | null;
  date: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
}

export function LockForm({
  sectionId,
  sectionName,
  month,
  monthLabel,
  exceptions,
  leaveChoices,
  blocked,
  backHref,
}: {
  sectionId: string;
  sectionName: string;
  month: string;
  monthLabel: string;
  exceptions: Exception[];
  /** Leave each person may have a day treated as, with what is left. */
  leaveChoices: Record<string, { code: string; name: string; nameHi: string; available: number | null }[]>;
  blocked: boolean;
  backHref: string;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  // A decision is a resolution, or "LEAVE:<code>" for a kind of leave.
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = (x: Exception) => `${x.employeeId}|${x.date}`;
  const done = exceptions.filter((x) => decisions[key(x)]).length;

  async function lock() {
    setBusy(true);
    try {
      await api("/api/v1/attendance/lock", {
        body: {
          sectionId,
          month,
          resolutions: exceptions.map((x) => {
            const [outcome, leaveCode] = decisions[key(x)].split(":");
            return { employeeId: x.employeeId, date: x.date, outcome, leaveCode, note: notes[key(x)] || undefined };
          }),
        },
      });
      toast(t("attendance.lock.done"));
      setConfirm(false);
      router.push(backHref);
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {exceptions.length > 0 && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-100 px-5 py-3 sm:px-6">
            <Badge tone={done === exceptions.length ? "green" : "amber"}>{t("attendance.lock.decidedCount", { done, total: exceptions.length })}</Badge>
            <Select
              label={t("attendance.lock.setAll")}
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) setDecisions(Object.fromEntries(exceptions.map((x) => [key(x), v])));
              }}
              containerClassName="w-full sm:w-60"
            >
              <option value="">{t("attendance.lock.choose")}</option>
              {RESOLUTIONS.filter((r) => r !== "LEAVE").map((r) => (
                <option key={r} value={r}>
                  {tDynamic(t, `attendance.lock.outcome.${r}`)}
                </option>
              ))}
            </Select>
          </div>
          <ul className="divide-y divide-ink-100">
            {exceptions.map((x) => (
              <li key={key(x)} className="grid gap-3 px-5 py-3.5 sm:px-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{(locale === "hi" && x.nameHi) || x.name}</p>
                  <p className="text-xs text-ink-500">{x.code}</p>
                </div>
                <div>
                  <p className="text-sm text-ink-800">{formatDate(x.date, locale)}</p>
                  <p className="text-xs text-ink-500">{x.firstIn ? `${t("attendance.my.in")} ${istTime(new Date(x.firstIn))}${x.lastOut ? ` · ${t("attendance.my.out")} ${istTime(new Date(x.lastOut))}` : ""}` : t("attendance.register.noPunches")}</p>
                </div>
                <div>
                  <Badge tone={BADGE[x.status]} dot>
                    {tDynamic(t, `attendance.status.${x.status}`)}
                  </Badge>
                  {x.status === "HALF_DAY" && <p className="mt-1 text-xs text-ink-500">{t("attendance.lock.halfDayNote")}</p>}
                </div>
                <div className="grid gap-2">
                  <select
                    aria-label={`${t("attendance.lock.decision")} · ${x.name} · ${formatDate(x.date, locale)}`}
                    value={decisions[key(x)] ?? ""}
                    onChange={(e) => setDecisions((d) => ({ ...d, [key(x)]: e.target.value }))}
                    className={controlClass(false, "h-9 text-sm")}
                  >
                    <option value="">{t("attendance.lock.choose")}</option>
                    {RESOLUTIONS.filter((r) => r !== "LEAVE").map((r) => (
                      <option key={r} value={r}>
                        {tDynamic(t, `attendance.lock.outcome.${r}`)}
                      </option>
                    ))}
                    {(leaveChoices[x.employeeId] ?? []).length > 0 && (
                      <optgroup label={t("attendance.lock.outcome.LEAVE")}>
                        {leaveChoices[x.employeeId].map((c) => (
                          <option key={c.code} value={`LEAVE:${c.code}`} disabled={c.available !== null && c.available < (x.status === "HALF_DAY" ? 0.5 : 1)}>
                            {c.available === null ? t("attendance.lock.leaveOptionNoLimit", { name: locale === "hi" ? c.nameHi : c.name }) : t("attendance.lock.leaveOption", { name: locale === "hi" ? c.nameHi : c.name, available: c.available })}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <input
                    aria-label={t("attendance.lock.noteOptional")}
                    placeholder={t("attendance.lock.noteOptional")}
                    value={notes[key(x)] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [key(x)]: e.target.value }))}
                    maxLength={200}
                    className={controlClass(false, "h-9 text-sm")}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <CardFooter>
        <Button variant="primary" icon={<Lock className="size-4" />} disabled={blocked || done < exceptions.length} onClick={() => setConfirm(true)}>
          {t("attendance.lock.lockButton", { month: monthLabel })}
        </Button>
      </CardFooter>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        closeLabel={t("common.close")}
        title={t("attendance.lock.lockButton", { month: monthLabel })}
        description={t("attendance.lock.confirm", { section: sectionName, month: monthLabel })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={lock} icon={<Lock className="size-4" />}>
              {t("attendance.lock.lockButton", { month: monthLabel })}
            </Button>
          </>
        }
      />
    </>
  );
}
