"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardBody, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";

interface Row {
  employeeId: string;
  code: string;
  name: string;
  post: string;
  section: string;
  level: string;
  fromCell: number;
  toCell: number | null;
  fromBasic: number;
  toBasic: number | null;
  lastChange: string;
  status: "ELIGIBLE" | "NOT_YET" | "TOP_OF_LEVEL" | "WAITING" | "DONE";
  eolDays: number;
  isSelf: boolean;
}

const TONE: Record<Row["status"], Tone> = { ELIGIBLE: "green", NOT_YET: "gray", TOP_OF_LEVEL: "amber", WAITING: "blue", DONE: "green" };

/** PR-06: HR ticks the people to give the increment and sends the list to a Checker. */
export function IncrementList({ due, rows, canSend, tooEarly, sendAheadDays }: { due: string; rows: Row[]; canSend: boolean; tooEarly: boolean; sendAheadDays: number }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const eligible = rows.filter((r) => r.status === "ELIGIBLE" && !r.isSelf);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(eligible.map((r) => r.employeeId)));
  const [order, setOrder] = useState("");
  const [busy, setBusy] = useState(false);

  if (!rows.length) {
    return (
      <CardBody>
        <p className="text-sm text-ink-600">{t("payroll.increments.none")}</p>
      </CardBody>
    );
  }

  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  async function send() {
    setBusy(true);
    try {
      await api("/api/v1/payroll/increments", { body: { dueDate: due, employeeIds: [...picked], orderNumber: order || undefined } });
      toast(t("payroll.increments.sent"));
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
            {canSend && (
              <Th className="w-10">
                <input type="checkbox" aria-label={t("payroll.increments.all")} className="accent-brand-700" checked={picked.size === eligible.length && eligible.length > 0} onChange={(e) => setPicked(e.target.checked ? new Set(eligible.map((r) => r.employeeId)) : new Set())} />
              </Th>
            )}
            <Th>{t("payroll.columns.employee")}</Th>
            <Th>{t("payroll.increments.pay")}</Th>
            <Th>{t("payroll.increments.since")}</Th>
            <Th>{t("payroll.columns.status")}</Th>
          </tr>
        </THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.employeeId} className={r.status === "NOT_YET" || r.status === "DONE" ? "opacity-70" : undefined}>
              {canSend && (
                <Td actions>
                  {r.status === "ELIGIBLE" && !r.isSelf && <input type="checkbox" aria-label={`${r.code} ${r.name}`} className="accent-brand-700" checked={picked.has(r.employeeId)} onChange={() => toggle(r.employeeId)} />}
                </Td>
              )}
              <Td>
                <span className="font-medium text-ink-900">{r.name}</span>
                <span className="block text-xs text-ink-500">
                  {r.code} · {r.post} · {r.section}
                </span>
              </Td>
              <Td label={t("payroll.increments.pay")} className="text-sm">
                L{r.level} C{r.fromCell} · {formatINR(r.fromBasic)}
                {r.toCell && r.toBasic !== null && (
                  <span className="block font-semibold text-brand-800">
                    → C{r.toCell} · {formatINR(r.toBasic)}
                  </span>
                )}
              </Td>
              <Td label={t("payroll.increments.since")} className="text-sm text-ink-600">
                {r.lastChange}
              </Td>
              <Td label={t("payroll.columns.status")}>
                <div className="flex flex-wrap gap-1">
                  <Badge tone={TONE[r.status]}>{tDynamic(t, `payroll.increments.status.${r.status}`)}</Badge>
                  {r.eolDays > 0 && <Badge tone="amber">{t("payroll.increments.eol", { days: r.eolDays })}</Badge>}
                  {r.isSelf && <Badge tone="blue">{t("payroll.self")}</Badge>}
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {canSend && eligible.length > 0 && (
        <CardFooter className="justify-between gap-3">
          <Input label={t("payroll.increments.order")} value={order} onChange={(e) => setOrder(e.target.value)} maxLength={80} containerClassName="max-w-xs" />
          <Button variant="primary" icon={<Send className="size-4" />} loading={busy} disabled={picked.size === 0} onClick={send}>
            {t("payroll.increments.send", { count: picked.size })}
          </Button>
        </CardFooter>
      )}
      {tooEarly && (
        <CardFooter className="justify-start">
          <p className="text-sm text-ink-600">{t("payroll.increments.tooEarly", { days: sendAheadDays })}</p>
        </CardFooter>
      )}
    </>
  );
}
