"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarPlus, Copy, PencilLine, Send, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardFooter } from "@/components/ui/card";
import { Input, controlClass } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDate, isISODate, weekday } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

export interface HolidayRow {
  date: string;
  name: string;
  nameHi: string;
  kind: "GAZETTED" | "RESTRICTED";
}

export function HolidayEditor({ year, holidays, lastYear, canEdit, pending }: { year: number; holidays: HolidayRow[]; lastYear: HolidayRow[]; canEdit: boolean; pending: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<HolidayRow[]>(holidays);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const sorted = (list: HolidayRow[]) => [...list].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const set = (i: number, patch: Partial<HolidayRow>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/attendance/holidays", { body: { year, holidays: rows, note: note || undefined } });
      toast(t("attendance.holidays.sent"));
      setEditing(false);
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

  if (!editing) {
    const list = sorted(holidays);
    return (
      <>
        {list.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-600 sm:px-6">{t("attendance.holidays.empty", { year })}</p>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("attendance.holidays.date")}</Th>
                <Th>{t("attendance.holidays.name")}</Th>
                <Th>{t("attendance.holidays.kind")}</Th>
              </tr>
            </THead>
            <tbody>
              {list.map((h) => (
                <Tr key={`${h.date}-${h.name}`}>
                  <Td className="whitespace-nowrap">
                    <span className="font-medium text-ink-900">{formatDate(h.date, locale)}</span>
                    <span className="ml-2 text-xs text-ink-500">{tDynamic(t, `attendance.weekday.${weekday(h.date)}`)}</span>
                  </Td>
                  <Td>
                    <p className="text-ink-900">{locale === "hi" ? h.nameHi : h.name}</p>
                    <p className="text-xs text-ink-500">{locale === "hi" ? h.name : h.nameHi}</p>
                  </Td>
                  <Td label={t("attendance.holidays.kind")}>
                    <Badge tone={h.kind === "GAZETTED" ? "gold" : "gray"}>{h.kind === "GAZETTED" ? t("attendance.holidays.gazetted") : t("attendance.holidays.restricted")}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {canEdit && !pending && (
          <CardFooter>
            {holidays.length === 0 && lastYear.length > 0 && (
              <Button
                icon={<Copy className="size-4" />}
                onClick={() => {
                  setRows(sorted(lastYear.map((h) => ({ ...h, date: `${year}${h.date.slice(4)}` })).filter((h) => isISODate(h.date))));
                  setEditing(true);
                }}
              >
                {t("attendance.holidays.copyLast", { year: year - 1 })}
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<PencilLine className="size-4" />}
              onClick={() => {
                setRows(sorted(holidays));
                setEditing(true);
              }}
            >
              {t("attendance.holidays.edit")}
            </Button>
          </CardFooter>
        )}
      </>
    );
  }

  return (
    <>
      <p className="border-b border-ink-100 px-5 py-3 text-sm text-amber-900 sm:px-6">{t("attendance.holidays.copyHint")}</p>
      <ul className="divide-y divide-ink-100">
        {rows.map((h, i) => (
          <li key={i} className="grid gap-2 px-5 py-3 sm:px-6 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_9rem_auto] md:items-start">
            <div>
              <input type="date" aria-label={t("attendance.holidays.date")} value={h.date} min={`${year}-01-01`} max={`${year}-12-31`} onChange={(e) => set(i, { date: e.target.value })} className={controlClass(!!errors[`holidays.${i}.date`], "h-9 text-sm")} />
              {errors[`holidays.${i}.date`] && <p className="mt-1 text-xs text-red-600">{errors[`holidays.${i}.date`]}</p>}
            </div>
            <div>
              <input aria-label={t("attendance.holidays.name")} placeholder={t("attendance.holidays.name")} value={h.name} onChange={(e) => set(i, { name: e.target.value })} className={controlClass(!!errors[`holidays.${i}.name`], "h-9 text-sm")} />
              {errors[`holidays.${i}.name`] && <p className="mt-1 text-xs text-red-600">{errors[`holidays.${i}.name`]}</p>}
            </div>
            <div>
              <input aria-label={t("attendance.holidays.nameHi")} placeholder={t("attendance.holidays.nameHi")} value={h.nameHi} onChange={(e) => set(i, { nameHi: e.target.value })} lang="hi" className={controlClass(!!errors[`holidays.${i}.nameHi`], "h-9 text-sm")} />
              {errors[`holidays.${i}.nameHi`] && <p className="mt-1 text-xs text-red-600">{errors[`holidays.${i}.nameHi`]}</p>}
            </div>
            <select aria-label={t("attendance.holidays.kind")} value={h.kind} onChange={(e) => set(i, { kind: e.target.value as HolidayRow["kind"] })} className={controlClass(false, "h-9 text-sm")}>
              <option value="GAZETTED">{t("attendance.holidays.gazetted")}</option>
              <option value="RESTRICTED">{t("attendance.holidays.restricted")}</option>
            </select>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setRows((r) => r.filter((_, k) => k !== i))} aria-label={`${t("attendance.holidays.remove")} ${h.name}`}>
              <span className="md:sr-only">{t("attendance.holidays.remove")}</span>
            </Button>
          </li>
        ))}
      </ul>
      <div className="px-5 py-3 sm:px-6">
        <Button size="sm" icon={<CalendarPlus className="size-4" />} onClick={() => setRows((r) => [...r, { date: `${year}-01-01`, name: "", nameHi: "", kind: "GAZETTED" }])}>
          {t("attendance.holidays.add")}
        </Button>
      </div>
      <CardFooter className="flex-wrap items-end">
        <Input label={t("attendance.register.noteLabel")} value={note} onChange={(e) => setNote(e.target.value)} optionalLabel={t("common.optional")} containerClassName="min-w-56 flex-1" />
        <Button variant="ghost" icon={<X className="size-4" />} onClick={() => setEditing(false)}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" icon={<Send className="size-4" />} loading={busy} onClick={send}>
          {t("attendance.holidays.send")}
        </Button>
      </CardFooter>
    </>
  );
}
