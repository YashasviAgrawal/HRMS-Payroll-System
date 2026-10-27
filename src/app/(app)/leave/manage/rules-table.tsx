"use client";

import { useState } from "react";
import { PencilLine, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";

export interface RuleRow {
  code: string;
  name: string;
  nameHi: string;
  pay: "FULL" | "HALF" | "NONE";
  creditMode: "HALF_YEARLY" | "YEARLY" | "SPELL" | "SERVICE" | "NONE";
  creditDays: number;
  cap: number | null;
  lapsesAtYearEnd: boolean;
  countsOffDays: boolean;
  halfDayAllowed: boolean;
  needsCertificate: boolean;
  officerLimitDays: number | null;
  isActive: boolean;
  version: number;
}

const blank: RuleRow = { code: "", name: "", nameHi: "", pay: "FULL", creditMode: "NONE", creditDays: 0, cap: null, lapsesAtYearEnd: false, countsOffDays: true, halfDayAllowed: false, needsCertificate: false, officerLimitDays: null, isActive: true, version: 0 };

/** LV-01: the leave rules table; HR proposes, an Admin approves. */
export function RulesTable({ rows, pending, canPropose }: { rows: RuleRow[]; pending: string[]; canPropose: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [edit, setEdit] = useState<{ row: RuleRow; isNew: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<RuleRow>) => setEdit((e) => (e ? { ...e, row: { ...e.row, ...patch } } : e));

  async function send() {
    if (!edit) return;
    setBusy(true);
    setErrors({});
    try {
      const r = edit.row;
      await api("/api/v1/leave/rules", { body: { code: r.code, name: r.name, nameHi: r.nameHi, pay: r.pay, creditMode: r.creditMode, creditDays: r.creditDays, cap: r.cap ?? "", lapsesAtYearEnd: r.lapsesAtYearEnd, countsOffDays: r.countsOffDays, halfDayAllowed: r.halfDayAllowed, needsCertificate: r.needsCertificate, officerLimitDays: r.officerLimitDays ?? "", isActive: r.isActive } });
      toast(t("leave.rules.sent"));
      setEdit(null);
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

  return (
    <>
      <Table stack>
        <THead>
          <tr>
            <Th>{t("leave.rules.name")}</Th>
            <Th>{t("leave.rules.credit")}</Th>
            <Th>{t("leave.rules.pay")}</Th>
            <Th>{t("leave.rules.officer")}</Th>
            <Th />
          </tr>
        </THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.code} className={r.isActive ? undefined : "bg-ink-50/70"}>
              <Td>
                <p className="font-medium text-ink-900">
                  {locale === "hi" ? r.nameHi : r.name} <span className="text-xs font-semibold text-ink-400">{r.code}</span>
                </p>
                <p className="text-xs text-ink-500">{t("leave.rules.version", { n: r.version })}</p>
              </Td>
              <Td label={t("leave.rules.credit")}>
                {tDynamic(t, `leave.rules.creditMode.${r.creditMode}`, { days: r.creditDays })}
                {r.cap !== null && <span className="block text-xs text-ink-500">{t("leave.rules.cap")}: {r.cap}</span>}
                {r.lapsesAtYearEnd && <span className="block text-xs text-ink-500">{t("leave.rules.lapses")}</span>}
              </Td>
              <Td label={t("leave.rules.pay")}>
                <Badge tone={r.pay === "FULL" ? "green" : r.pay === "HALF" ? "amber" : "red"}>{tDynamic(t, `leave.pay.${r.pay}`)}</Badge>
              </Td>
              <Td label={t("leave.rules.officer")}>{r.officerLimitDays === null ? t("leave.rules.adminOnly") : r.officerLimitDays === 1 ? t("leave.rules.upToOne") : t("leave.rules.upTo", { days: r.officerLimitDays })}</Td>
              <Td align="right" actions>
                <div className="flex justify-end">
                  {pending.includes(r.code) ? (
                    <Badge tone="amber">{t("leave.rules.pending")}</Badge>
                  ) : (
                    canPropose && (
                      <Button size="sm" variant="ghost" icon={<PencilLine className="size-4" />} onClick={() => setEdit({ row: r, isNew: false })}>
                        {t("leave.rules.change")}
                      </Button>
                    )
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {canPropose && (
        <div className="border-t border-ink-100 px-5 py-3 sm:px-6">
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ row: blank, isNew: true })}>
            {t("leave.rules.add")}
          </Button>
        </div>
      )}
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        closeLabel={t("common.close")}
        title={edit ? (edit.isNew ? t("leave.rules.addTitle") : t("leave.rules.changeTitle", { code: edit.row.code })) : ""}
        description={t("leave.rules.hint")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={send}>
              {t("common.submit")}
            </Button>
          </>
        }
      >
        {edit && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t("leave.rules.code")} value={edit.row.code} disabled={!edit.isNew} onChange={(e) => set({ code: e.target.value.toUpperCase() })} error={errors.code} required />
            <Select label={t("leave.rules.pay")} value={edit.row.pay} onChange={(e) => set({ pay: e.target.value as RuleRow["pay"] })}>
              {(["FULL", "HALF", "NONE"] as const).map((p) => (
                <option key={p} value={p}>
                  {tDynamic(t, `leave.pay.${p}`)}
                </option>
              ))}
            </Select>
            <Input label={t("leave.rules.name")} value={edit.row.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} required />
            <Input label={t("leave.rules.nameHi")} value={edit.row.nameHi} onChange={(e) => set({ nameHi: e.target.value })} error={errors.nameHi} lang="hi" required />
            <Select label={t("leave.rules.creditModeLabel")} value={edit.row.creditMode} onChange={(e) => set({ creditMode: e.target.value as RuleRow["creditMode"] })}>
              {(["HALF_YEARLY", "YEARLY", "SPELL", "SERVICE", "NONE"] as const).map((m) => (
                <option key={m} value={m}>
                  {tDynamic(t, `leave.rules.creditMode.${m}`, { days: "n" })}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input label={t("leave.rules.creditDays")} type="number" min={0} step="0.5" value={edit.row.creditDays} onChange={(e) => set({ creditDays: Number(e.target.value) })} error={errors.creditDays} />
              <Input label={t("leave.rules.cap")} type="number" min={0} value={edit.row.cap ?? ""} onChange={(e) => set({ cap: e.target.value === "" ? null : Number(e.target.value) })} error={errors.cap} optionalLabel={t("common.optional")} />
            </div>
            <Input
              label={t("leave.rules.officerLimit")}
              type="number"
              min={0}
              value={edit.row.officerLimitDays ?? ""}
              onChange={(e) => set({ officerLimitDays: e.target.value === "" ? null : Number(e.target.value) })}
              hint={t("leave.rules.officerLimitHint")}
              error={errors.officerLimitDays}
              containerClassName="sm:col-span-2"
            />
            <Checkbox label={t("leave.rules.lapses")} checked={edit.row.lapsesAtYearEnd} onChange={(e) => set({ lapsesAtYearEnd: e.target.checked })} />
            <Checkbox label={t("leave.rules.countsOffDays")} checked={edit.row.countsOffDays} onChange={(e) => set({ countsOffDays: e.target.checked })} />
            <Checkbox label={t("leave.rules.halfDayAllowed")} checked={edit.row.halfDayAllowed} onChange={(e) => set({ halfDayAllowed: e.target.checked })} />
            <Checkbox label={t("leave.rules.needsCertificate")} checked={edit.row.needsCertificate} onChange={(e) => set({ needsCertificate: e.target.checked })} />
            <Checkbox label={t("leave.rules.active")} checked={edit.row.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          </div>
        )}
      </Dialog>
    </>
  );
}
