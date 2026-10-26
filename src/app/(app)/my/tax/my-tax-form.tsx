"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { CircleCheck, FileText, FileUp, Paperclip, Scale, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { EMPTY_ITEMS, taxWorking, type AnnualSalary, type DeclaredItems, type Regime, type TaxRuleSet } from "@/modules/statutory/tax-rules";
import { TaxComparison } from "../../statutory/_components/tax-comparison";
import { upload } from "../../statutory/_components/upload";

interface Proof {
  id: string;
  name: string;
  size: number;
}

export interface MyTaxProps {
  fy: string;
  declaration: { id: string; regime: Regime; items: DeclaredItems; proofs: Proof[]; status: string; remarks: string | null; submittedAt: string | null; verifiedAt: string | null } | null;
  waitingForCheck: boolean;
  year: AnnualSalary & { tds: number };
  tdsSoFar: number;
  monthsToCome: number;
  rules: Record<Regime, TaxRuleSet>;
  metro: boolean;
  caps: { sec80C: number; sec80D: number; sec80CCD1B: number; homeLoanInterest: number };
  proofsDueOn: string;
}

const OLD_ITEMS = ["sec80C", "sec80D", "sec80CCD1B", "homeLoanInterest", "rentPaid"] as const;

/** ST-02, ST-03: choose the regime with both taxes in view, declare old-regime deductions, attach proofs, send. */
export function MyTaxForm(p: MyTaxProps) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const d = p.declaration;
  const [regime, setRegime] = useState<Regime>(d?.regime ?? "NEW");
  const [items, setItems] = useState<Record<keyof DeclaredItems, string>>(() => Object.fromEntries(Object.entries(d?.items ?? EMPTY_ITEMS).map(([k, v]) => [k, v ? String(v) : ""])) as Record<keyof DeclaredItems, string>);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "save" | "send" | "proof">("");
  const numbers = useMemo(() => Object.fromEntries(Object.entries(items).map(([k, v]) => [k, Math.max(0, Number(v) || 0)])) as unknown as DeclaredItems, [items]);
  const workings = useMemo(
    () => ({ NEW: taxWorking(p.year, "NEW", { ...EMPTY_ITEMS, otherIncome: numbers.otherIncome }, p.rules.NEW, p.metro), OLD: taxWorking(p.year, "OLD", numbers, p.rules.OLD, p.metro) }),
    [numbers, p.year, p.rules, p.metro],
  );
  const capOf: Partial<Record<keyof DeclaredItems, number>> = p.caps;

  async function save(submit: boolean) {
    setBusy(submit ? "send" : "save");
    setErrors({});
    try {
      await api("/api/v1/me/tax", { method: "PUT", body: { regime, items: numbers, submit } });
      toast(submit ? t("statutory.my.sent") : t("statutory.my.saved"));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^items\./, ""), v])));
        toast(err.message, "error");
      }
    } finally {
      setBusy("");
    }
  }

  async function addProof(f: File | undefined) {
    if (!f) return;
    setBusy("proof");
    try {
      const form = new FormData();
      form.set("file", f);
      await upload("/api/v1/me/tax/proofs", form);
      toast(t("statutory.my.proofAdded"));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast(err.message, "error");
    } finally {
      setBusy("");
      if (file.current) file.current.value = "";
    }
  }

  async function removeProof(id: string) {
    try {
      await api(`/api/v1/me/tax/proofs/${id}`, { method: "DELETE" });
      toast(t("statutory.my.proofRemoved"));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast(err.message, "error");
    }
  }

  const banner =
    d?.status === "RETURNED" && d.remarks
      ? { tone: "bg-red-50 text-red-800", text: t("statutory.tax.returnedNote", { note: d.remarks }) }
      : p.waitingForCheck && d?.submittedAt
        ? { tone: "bg-amber-50 text-amber-900", text: t("statutory.my.waiting", { date: formatDate(d.submittedAt.slice(0, 10), locale) }) }
        : d?.status === "VERIFIED" && d.verifiedAt
          ? { tone: "bg-brand-50 text-brand-900", text: t("statutory.my.verified", { date: formatDate(d.verifiedAt.slice(0, 10), locale) }) }
          : d?.status === "DRAFT"
            ? { tone: "bg-sky-50 text-sky-900", text: t("statutory.my.draftNote") }
            : null;

  return (
    <div className="space-y-5">
      {banner && (
        <p role="status" className={cn("rounded-xl px-4 py-3 text-sm font-medium", banner.tone)}>
          {banner.text}
        </p>
      )}
      <Card>
        <CardHeader title={t("statutory.my.regimeTitle")} description={t("statutory.my.regimeHelp")} icon={<Scale className="size-4.5" aria-hidden="true" />} />
        <CardBody>
          <div role="radiogroup" aria-label={t("statutory.my.regimeTitle")} className="grid gap-3 sm:grid-cols-2">
            {(["NEW", "OLD"] as Regime[]).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={regime === r}
                onClick={() => setRegime(r)}
                className={cn("rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand-600", regime === r ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-ink-200 hover:border-ink-300")}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink-950">{t(`statutory.tax.regimes.${r}`)}</span>
                  {regime === r && <CircleCheck className="size-5 text-brand-600" aria-hidden="true" />}
                </span>
                <span className="mt-1 block text-sm text-ink-600">{r === "NEW" ? t("statutory.my.newHelp") : t("statutory.my.oldHelp")}</span>
                <span className="mt-2 block text-sm">
                  {t("statutory.tax.line.total")}: <span className="tabular font-semibold text-ink-950">{formatINR(workings[r].total)}</span>
                </span>
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      {regime === "OLD" && (
        <Card>
          <CardHeader title={t("statutory.my.itemsTitle")} description={t("statutory.my.itemsHelp")} icon={<FileText className="size-4.5" aria-hidden="true" />} />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {OLD_ITEMS.map((k) => (
              <Input
                key={k}
                label={t(`statutory.tax.items.${k}`)}
                inputMode="decimal"
                value={items[k]}
                onChange={(e) => setItems({ ...items, [k]: e.target.value.replace(/[^\d.]/g, "") })}
                error={errors[k]}
                hint={capOf[k] ? (k === "sec80C" ? t("statutory.tax.capIncl", { amount: formatINR(capOf[k]!) }) : t("statutory.tax.cap", { amount: formatINR(capOf[k]!) })) : undefined}
                leading="₹"
              />
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t("statutory.my.otherTitle")} icon={<FileText className="size-4.5" aria-hidden="true" />} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input label={t("statutory.tax.items.otherIncome")} inputMode="decimal" value={items.otherIncome} onChange={(e) => setItems({ ...items, otherIncome: e.target.value.replace(/[^\d.]/g, "") })} error={errors.otherIncome} leading="₹" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("statutory.tax.comparison")} description={t("statutory.tax.comparisonHelp")} icon={<Scale className="size-4.5" aria-hidden="true" />} />
        <CardBody>
          <TaxComparison workings={workings} chosen={regime} monthsLeft={p.monthsToCome} deducted={p.tdsSoFar} />
          <p className="mt-3 text-xs text-ink-500">
            {t("statutory.my.salarySoFar", { amount: formatINR(p.year.gross) })} · {t("statutory.my.tdsSoFar", { amount: formatINR(p.tdsSoFar) })}
          </p>
        </CardBody>
      </Card>

      {regime === "OLD" && (
        <Card>
          <CardHeader title={t("statutory.my.proofsTitle")} description={t("statutory.my.proofsHelp", { date: formatDate(p.proofsDueOn, locale) })} icon={<Paperclip className="size-4.5" aria-hidden="true" />} />
          <CardBody className="space-y-3">
            {!d?.proofs.length ? (
              <p className="text-sm text-ink-600">{t("statutory.my.noProofs")}</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {d.proofs.map((pr) => (
                  <li key={pr.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <a href={`/api/v1/statutory/proofs/${d.id}/${pr.id}`} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                      {pr.name}
                    </a>
                    {d.status !== "VERIFIED" && !p.waitingForCheck && (
                      <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => removeProof(pr.id)}>
                        {t("statutory.my.removeProof")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <input ref={file} id="proof-file" type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={(e) => addProof(e.target.files?.[0])} aria-label={t("statutory.my.addProof")} />
            <Button variant="secondary" size="sm" icon={<FileUp className="size-4" />} loading={busy === "proof"} onClick={() => file.current?.click()}>
              {t("statutory.my.addProof")}
            </Button>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardFooter className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" loading={busy === "save"} onClick={() => save(false)}>
            {t("statutory.my.saveDraft")}
          </Button>
          <Button variant="primary" icon={<Send className="size-4" />} loading={busy === "send"} onClick={() => save(true)}>
            {t("statutory.my.send")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
