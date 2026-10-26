"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardBody, CardFooter } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";

interface Item {
  id: string;
  headCode: string;
  head: { name: string; nameHi: string; kind: string } | null;
  amount: number;
  fromMonth: string;
  toMonth: string | null;
  note: string | null;
}

export function ItemsPanel({ employeeId, items, heads, canEdit, isSelf, thisMonth }: { employeeId: string; items: Item[]; heads: { code: string; name: string; nameHi: string; kind: string }[]; canEdit: boolean; isSelf: boolean; thisMonth: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<Item | null>(null);
  const [form, setForm] = useState({ headCode: heads[0]?.code ?? "", amount: "", fromMonth: thisMonth, toMonth: "", note: "" });
  const [endMonth, setEndMonth] = useState(thisMonth);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>, done: () => void) {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/payroll/items", { body: { employeeId, ...body } });
      toast(t("payroll.items.sent"));
      done();
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

  const headName = (i: Item) => (i.head ? (locale === "hi" ? i.head.nameHi : i.head.name) : i.headCode);

  return (
    <>
      {items.length === 0 ? (
        <CardBody>
          <p className="text-sm text-ink-600">{t("payroll.items.none")}</p>
        </CardBody>
      ) : (
        <Table stack>
          <THead>
            <tr>
              <Th>{t("payroll.items.head")}</Th>
              <Th align="right">{t("payroll.columns.amount")}</Th>
              <Th>{t("payroll.items.fromMonth")}</Th>
              <Th>{t("payroll.columns.status")}</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {items.map((i) => {
              const running = !i.toMonth || i.toMonth >= thisMonth;
              return (
                <Tr key={i.id} className={running ? undefined : "opacity-60"}>
                  <Td>
                    <span className="font-medium text-ink-900">{headName(i)}</span>
                    {i.head && <span className="block text-xs text-ink-500">{tDynamic(t, `rates.heads.kinds.${i.head.kind}`)}</span>}
                    {i.note && <span className="block text-xs text-ink-500">{i.note}</span>}
                  </Td>
                  <Td label={t("payroll.columns.amount")} align="right" className="font-semibold">
                    {formatINR(i.amount)}
                  </Td>
                  <Td label={t("payroll.items.fromMonth")}>{i.fromMonth}</Td>
                  <Td label={t("payroll.columns.status")}>{i.toMonth ? <Badge tone={running ? "blue" : "gray"}>{t("payroll.items.ended", { month: i.toMonth })}</Badge> : <Badge tone="green">{t("payroll.items.running")}</Badge>}</Td>
                  <Td align="right" actions>
                    {canEdit && running && (
                      <Button size="sm" variant="ghost" icon={<Square className="size-4" />} onClick={() => { setEnding(i); setEndMonth(thisMonth < i.fromMonth ? i.fromMonth : thisMonth); setErrors({}); }}>
                        {t("payroll.items.end")}
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {isSelf && (
        <CardBody className="border-t border-ink-100 py-3">
          <p className="text-sm text-ink-600">{t("payroll.items.own")}</p>
        </CardBody>
      )}
      {canEdit && (
        <CardFooter className="justify-start">
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setAdding(true); setErrors({}); }}>
            {t("payroll.items.add")}
          </Button>
        </CardFooter>
      )}

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        closeLabel={t("common.close")}
        title={t("payroll.items.add")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => send({ headCode: form.headCode, amount: form.amount, fromMonth: form.fromMonth, toMonth: form.toMonth, note: form.note || undefined }, () => setAdding(false))}>
              {t("common.submit")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t("payroll.items.head")} value={form.headCode} onChange={(e) => setForm({ ...form, headCode: e.target.value })} error={errors.headCode} className="sm:col-span-2">
            {heads.map((h) => (
              <option key={h.code} value={h.code}>
                {locale === "hi" ? h.nameHi : h.name} ({tDynamic(t, `rates.heads.kinds.${h.kind}`)})
              </option>
            ))}
          </Select>
          <Input label={t("payroll.items.amount")} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={errors.amount} required />
          <Input label={t("payroll.items.fromMonth")} type="month" value={form.fromMonth} onChange={(e) => setForm({ ...form, fromMonth: e.target.value })} error={errors.fromMonth} required />
          <Input label={t("payroll.items.toMonth")} type="month" value={form.toMonth} onChange={(e) => setForm({ ...form, toMonth: e.target.value })} error={errors.toMonth} />
          <Input label={t("payroll.items.note")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={errors.note} maxLength={200} />
        </div>
      </Dialog>

      <Dialog
        open={!!ending}
        onClose={() => setEnding(null)}
        closeLabel={t("common.close")}
        title={t("payroll.items.endTitle")}
        description={ending ? `${headName(ending)} · ${formatINR(ending.amount)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEnding(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => ending && send({ headCode: ending.headCode, amount: ending.amount, fromMonth: ending.fromMonth, toMonth: endMonth, endItemId: ending.id }, () => setEnding(null))}>
              {t("common.submit")}
            </Button>
          </>
        }
      >
        <Input label={t("payroll.items.endAfter")} type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} error={errors.toMonth} required />
      </Dialog>
    </>
  );
}
