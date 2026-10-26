"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

interface SectionRow {
  id: string;
  name: string;
  nameHi: string;
  attendanceMode: "DEVICE" | "MANUAL";
  weeklyOff: string | null;
}

type OffChoice = "default" | "none" | "custom";

export function SectionRules({ sections, boardWeeklyOff, canEdit }: { sections: SectionRow[]; boardWeeklyOff: number[]; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState<SectionRow | null>(null);
  const [mode, setMode] = useState<"DEVICE" | "MANUAL">("DEVICE");
  const [choice, setChoice] = useState<OffChoice>("default");
  const [days, setDays] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const dayNames = (list: number[]) => (list.length ? list.map((d) => tDynamic(t, `attendance.weekday.${d}`)).join(", ") : t("attendance.holidays.noWeeklyOff"));
  const describe = (s: SectionRow) => (s.weeklyOff === null ? t("attendance.holidays.boardDefault", { days: dayNames(boardWeeklyOff) }) : s.weeklyOff === "-" ? t("attendance.holidays.noWeeklyOff") : dayNames(s.weeklyOff.split(",").map(Number)));

  function open(s: SectionRow) {
    setEditing(s);
    setMode(s.attendanceMode);
    setChoice(s.weeklyOff === null ? "default" : s.weeklyOff === "-" ? "none" : "custom");
    setDays(s.weeklyOff && s.weeklyOff !== "-" ? s.weeklyOff.split(",").map(Number) : boardWeeklyOff);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await api(`/api/v1/attendance/sections/${editing.id}`, { method: "PUT", body: { attendanceMode: mode, weeklyOff: choice === "default" ? null : choice === "none" ? [] : days } });
      toast(t("attendance.holidays.rulesSaved"));
      setEditing(null);
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Table stack>
        <THead>
          <tr>
            <Th>{t("attendance.register.section")}</Th>
            <Th>{t("attendance.holidays.mode")}</Th>
            <Th>{t("attendance.holidays.weeklyOff")}</Th>
            {canEdit && <Th />}
          </tr>
        </THead>
        <tbody>
          {sections.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium text-ink-900">{locale === "hi" ? s.nameHi : s.name}</Td>
              <Td label={t("attendance.holidays.mode")}>
                <Badge tone={s.attendanceMode === "DEVICE" ? "green" : "blue"}>{tDynamic(t, `attendance.mode.${s.attendanceMode}`)}</Badge>
              </Td>
              <Td label={t("attendance.holidays.weeklyOff")} className="text-ink-700">{describe(s)}</Td>
              {canEdit && (
                <Td align="right" actions>
                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" icon={<Settings2 className="size-4" />} onClick={() => open(s)}>
                      {t("attendance.holidays.editRules")}
                    </Button>
                  </div>
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </Table>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        closeLabel={t("common.close")}
        title={editing ? t("attendance.holidays.rulesTitle", { section: locale === "hi" ? editing.nameHi : editing.name }) : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {t("common.saveChanges")}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink-800">{t("attendance.holidays.mode")}</p>
            <Segmented label={t("attendance.holidays.mode")} value={mode} onChange={setMode} options={[{ value: "DEVICE", label: t("attendance.mode.DEVICE") }, { value: "MANUAL", label: t("attendance.mode.MANUAL") }]} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink-800">{t("attendance.holidays.weeklyOff")}</p>
            <Segmented
              label={t("attendance.holidays.weeklyOff")}
              value={choice}
              onChange={setChoice}
              options={[
                { value: "default", label: t("attendance.holidays.boardDefault", { days: dayNames(boardWeeklyOff) }) },
                { value: "custom", label: t("attendance.holidays.custom") },
                { value: "none", label: t("attendance.holidays.noWeeklyOff") },
              ]}
            />
            {choice === "custom" && (
              <div className="flex flex-wrap gap-2 pt-2" role="group" aria-label={t("attendance.holidays.custom")}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const on = days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDays((x) => (on ? x.filter((y) => y !== d) : x.length >= 3 ? x : [...x, d]))}
                      className={cn("h-9 min-w-12 rounded-lg border px-3 text-sm font-medium transition-colors", on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-600 hover:border-ink-300")}
                    >
                      {tDynamic(t, `attendance.weekday.${d}`)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
