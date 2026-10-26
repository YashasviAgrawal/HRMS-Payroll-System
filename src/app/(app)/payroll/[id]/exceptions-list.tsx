"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Undo2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { formatMonth } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface ExceptionItem {
  id: string;
  code: string;
  severity: "BLOCK" | "WARN";
  vars: Record<string, string | number>;
  resolution: "EXPLAINED" | "WITHHELD" | "WAIVED" | null;
  note: string | null;
  resolvedByName: string | null;
  allowed: ("EXPLAINED" | "WITHHELD" | "WAIVED")[];
  isSelf: boolean;
  person: { code: string; name: string; nameHi: string | null } | null;
}

/** PR-10: each exception with what is wrong, how to fix it, and how it was resolved. */
export function ExceptionsList({ runId, items, canResolve }: { runId: string; items: ExceptionItem[]; canResolve: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState<ExceptionItem | null>(null);
  const [choice, setChoice] = useState<ExceptionItem["allowed"][number] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (!items.length) {
    return (
      <CardBody>
        <p className="flex items-center gap-2 text-sm text-brand-800">
          <CheckCircle2 className="size-4" aria-hidden="true" /> {t("payroll.exceptions.none")}
        </p>
      </CardBody>
    );
  }

  const vars = (x: ExceptionItem) => {
    const v: Record<string, string | number> = { ...x.vars };
    for (const k of ["net", "lastNet"]) if (typeof v[k] === "number") v[k] = formatINR(v[k] as number, { symbol: false });
    if (typeof v.pct === "number") v.pct = `${(v.pct as number) > 0 ? "+" : ""}${v.pct}`;
    if (locale === "hi" && v.sectionHi) v.section = v.sectionHi;
    if (typeof v.month === "string") v.month = formatMonth(v.month, locale);
    return v;
  };

  function start(x: ExceptionItem) {
    setOpen(x);
    setChoice(x.allowed.length === 1 ? x.allowed[0] : null);
    setNote("");
    setError(undefined);
  }

  async function save() {
    if (!open || !choice) return;
    setBusy(true);
    try {
      await api(`/api/v1/payroll/runs/${runId}/exceptions/${open.id}`, { body: { resolution: choice, note } });
      toast(t("payroll.exceptions.saved"));
      setOpen(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.fields.note ?? err.message);
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function undo(x: ExceptionItem) {
    try {
      await api(`/api/v1/payroll/runs/${runId}/exceptions/${x.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    }
  }

  return (
    <>
      <ul className="divide-y divide-ink-100">
        {items.map((x) => {
          const block = x.severity === "BLOCK";
          return (
            <li key={x.id} className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:px-6", x.resolution && "bg-ink-50/40")} data-testid={`exception-${x.code}`}>
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", x.resolution ? "bg-brand-50 text-brand-700" : block ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")} aria-hidden="true">
                {x.resolution ? <CheckCircle2 className="size-5" /> : block ? <AlertOctagon className="size-5" /> : <AlertTriangle className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink-900">{tDynamic(t, `payroll.exceptions.codes.${x.code}`)}</p>
                  {!x.resolution && <Badge tone={block ? "red" : "amber"}>{block ? t("payroll.exceptions.blocking") : t("payroll.exceptions.warning")}</Badge>}
                  {x.isSelf && <Badge tone="blue">{t("payroll.self")}</Badge>}
                </div>
                {x.person && (
                  <p className="mt-0.5 text-sm font-medium text-ink-700">
                    {x.person.code} · {locale === "hi" && x.person.nameHi ? x.person.nameHi : x.person.name}
                  </p>
                )}
                <p className="mt-1 text-sm text-ink-600">{tDynamic(t, `payroll.exceptions.detail.${x.code}`, vars(x))}</p>
                {x.resolution ? (
                  <p className="mt-2 text-sm text-ink-800">
                    <span className="font-medium">{tDynamic(t, `payroll.exceptions.resolution.${x.resolution}`)}</span> — {x.resolvedByName}: “{x.note}”
                  </p>
                ) : (
                  <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-600">
                    <Wrench className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                    <span>
                      <span className="font-medium text-ink-700">{t("payroll.exceptions.howToFix")}:</span> {tDynamic(t, `payroll.exceptions.fix.${x.code}`)}
                    </span>
                  </p>
                )}
              </div>
              {canResolve && !x.isSelf && (
                <div className="flex shrink-0 gap-2 sm:pt-1">
                  {x.resolution ? (
                    <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => undo(x)}>
                      {t("payroll.exceptions.undo")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => start(x)}>
                      {t("payroll.exceptions.resolve")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        closeLabel={t("common.close")}
        title={open ? tDynamic(t, `payroll.exceptions.codes.${open.code}`) : ""}
        description={open?.person ? `${open.person.code} · ${locale === "hi" && open.person.nameHi ? open.person.nameHi : open.person.name}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} disabled={!choice} onClick={save}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {open && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="sr-only">{t("payroll.exceptions.resolve")}</legend>
              {open.allowed.map((r) => (
                <label key={r} className={cn("flex cursor-pointer gap-3 rounded-xl border px-4 py-3", choice === r ? "border-brand-500 bg-brand-50/50" : "border-ink-200 hover:border-ink-300")}>
                  <input type="radio" name="resolution" className="mt-1 accent-brand-700" checked={choice === r} onChange={() => setChoice(r)} />
                  <span>
                    <span className="block text-sm font-semibold text-ink-900">{tDynamic(t, `payroll.exceptions.resolution.${r}`)}</span>
                    <span className="block text-sm text-ink-600">{tDynamic(t, `payroll.exceptions.resolutionHelp.${r}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Textarea label={t("payroll.exceptions.remark")} hint={t("payroll.exceptions.remarkHelp")} value={note} onChange={(e) => { setNote(e.target.value); setError(undefined); }} error={error} maxLength={500} rows={3} required />
          </div>
        )}
      </Dialog>
    </>
  );
}
