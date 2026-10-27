"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Calculator, FilePlus2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatMonth } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";

type Type = "ARREARS" | "WITHHELD" | "JOINER";
type Group = "OPS" | "NPS" | "CONTRACT";

interface ArrearsRow {
  employeeId: string;
  code: string;
  name: string;
  nameHi: string | null;
  months: { month: string; lines: { code: string; name: string; nameHi: string; kind: string; due: number; drawn: number; diff: number }[] }[];
  gross: number;
  deductions: number;
  net: number;
  isSelf: boolean;
}

interface Candidate {
  id: string;
  code: string;
  name: string;
  nameHi: string | null;
  month?: string;
  net?: number;
  reason?: string | null;
  hasBank?: boolean;
  dateOfJoining?: string;
  isSelf: boolean;
}

/** S-42: pick what the bill pays, look at it, then make the bill — it then goes through the payroll's five stages. */
export function BillMaker({ defaultFrom, defaultTo, lastMonth }: { defaultFrom: string; defaultTo: string; lastMonth: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [type, setType] = useState<Type>("ARREARS");
  const [group, setGroup] = useState<Group>("NPS");
  const [range, setRange] = useState({ fromMonth: defaultFrom, toMonth: defaultTo, reason: "" });
  const [forMonth, setForMonth] = useState(lastMonth);
  const [arrears, setArrears] = useState<ArrearsRow[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [regularApproved, setRegularApproved] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"look" | "make" | null>(null);
  const reset = () => {
    setArrears(null);
    setCandidates(null);
    setPicked(new Set());
  };
  const nameOf = (r: { name: string; nameHi: string | null }) => (locale === "hi" && r.nameHi ? r.nameHi : r.name);

  async function look() {
    setBusy("look");
    setErrors({});
    try {
      if (type === "ARREARS") {
        setArrears(await api<ArrearsRow[]>("/api/v1/payroll/arrears/preview", { body: { payGroup: group, fromMonth: range.fromMonth, toMonth: range.toMonth } }));
      } else {
        const r = await api<{ people: Candidate[]; regularApproved?: boolean }>(`/api/v1/payroll/supplementary/candidates?type=${type}&payGroup=${group}&month=${forMonth}`);
        setCandidates(r.people);
        setRegularApproved(r.regularApproved ?? true);
        setPicked(new Set(r.people.filter((p) => !p.isSelf && p.hasBank !== false).map((p) => p.id)));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
    } finally {
      setBusy(null);
    }
  }

  async function make() {
    setBusy("make");
    setErrors({});
    try {
      const body =
        type === "ARREARS"
          ? { type, payGroup: group, ...range }
          : type === "WITHHELD"
            ? { type, payGroup: group, payslipIds: [...picked] }
            : { type, payGroup: group, forMonth, employeeIds: [...picked] };
      const r = await api<{ id: string }>("/api/v1/payroll/supplementary", { body });
      toast(t("payroll.supplementary.made"));
      router.push(`/payroll/${r.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
      setBusy(null);
    }
  }

  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const total = arrears?.filter((a) => !a.isSelf).reduce((s, a) => s + a.net, 0) ?? 0;

  return (
    <Card>
      <CardHeader title={t("payroll.supplementary.make")} description={t(`payroll.supplementary.help.${type}`)} icon={<FilePlus2 className="size-4.5" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        <Segmented<Type>
          label={t("payroll.supplementary.what")}
          value={type}
          onChange={(v) => {
            setType(v);
            reset();
          }}
          options={(["ARREARS", "WITHHELD", "JOINER"] as const).map((v) => ({ value: v, label: t(`payroll.supplementary.types.${v}`) }))}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select label={t("payroll.payGroup")} value={group} onChange={(e) => { setGroup(e.target.value as Group); reset(); }}>
            {(["OPS", "NPS", "CONTRACT"] as const).map((g) => (
              <option key={g} value={g}>
                {t(`payroll.groups.${g}`)}
              </option>
            ))}
          </Select>
          {type === "ARREARS" && (
            <>
              <Input label={t("payroll.supplementary.fromMonth")} type="month" value={range.fromMonth} onChange={(e) => { setRange({ ...range, fromMonth: e.target.value }); reset(); }} error={errors.fromMonth} />
              <Input label={t("payroll.supplementary.toMonth")} type="month" value={range.toMonth} onChange={(e) => { setRange({ ...range, toMonth: e.target.value }); reset(); }} error={errors.toMonth} />
              <Input label={t("payroll.supplementary.reason")} hint={t("payroll.supplementary.reasonHelp")} value={range.reason} onChange={(e) => setRange({ ...range, reason: e.target.value })} error={errors.reason} containerClassName="sm:col-span-3" maxLength={200} />
            </>
          )}
          {type === "JOINER" && <Input label={t("payroll.supplementary.forMonth")} type="month" value={forMonth} onChange={(e) => { setForMonth(e.target.value); reset(); }} />}
        </div>
      </CardBody>

      {arrears && (
        <div className="border-t border-ink-100">
          {arrears.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("payroll.supplementary.noArrears")}</p>
            </CardBody>
          ) : (
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("payroll.columns.employee")}</Th>
                  <Th>{t("payroll.supplementary.months")}</Th>
                  <Th align="right">{t("payroll.gross")}</Th>
                  <Th align="right">{t("payroll.deductions")}</Th>
                  <Th align="right">{t("payroll.net")}</Th>
                </tr>
              </THead>
              <tbody>
                {arrears.map((a) => (
                  <ArrearsRows key={a.employeeId} a={a} open={open === a.employeeId} onToggle={() => setOpen(open === a.employeeId ? null : a.employeeId)} name={nameOf(a)} />
                ))}
                <Tr className="bg-brand-50/50 font-semibold">
                  <Td colSpan={4}>{t("common.total")}</Td>
                  <Td align="right">{formatINR(total)}</Td>
                </Tr>
              </tbody>
            </Table>
          )}
        </div>
      )}

      {candidates && (
        <div className="border-t border-ink-100">
          {!regularApproved ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("payroll.supplementary.regularNotApproved")}</p>
            </CardBody>
          ) : candidates.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("payroll.supplementary.nobody")}</p>
            </CardBody>
          ) : (
            <Table stack>
              <THead>
                <tr>
                  <Th className="w-10" />
                  <Th>{t("payroll.columns.employee")}</Th>
                  <Th>{type === "WITHHELD" ? t("payroll.month") : t("payroll.supplementary.joined")}</Th>
                  {type === "WITHHELD" && <Th align="right">{t("payroll.net")}</Th>}
                </tr>
              </THead>
              <tbody>
                {candidates.map((c) => (
                  <Tr key={c.id}>
                    <Td actions>{!c.isSelf && <input type="checkbox" aria-label={`${c.code} ${nameOf(c)}`} className="accent-brand-700" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />}</Td>
                    <Td>
                      <span className="font-medium text-ink-900">{nameOf(c)}</span>
                      <span className="block text-xs text-ink-500">{c.code}</span>
                      {c.hasBank === false && <Badge tone="red">{t("payroll.exceptions.codes.NO_BANK")}</Badge>}
                      {c.isSelf && <Badge tone="blue">{t("payroll.self")}</Badge>}
                    </Td>
                    <Td label={type === "WITHHELD" ? t("payroll.month") : t("payroll.supplementary.joined")}>{c.month ? formatMonth(c.month, locale) : c.dateOfJoining}</Td>
                    {type === "WITHHELD" && (
                      <Td label={t("payroll.net")} align="right">
                        {formatINR(c.net ?? 0)}
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}

      <CardFooter className="justify-between">
        <Button variant="secondary" icon={<Calculator className="size-4" />} loading={busy === "look"} onClick={look}>
          {type === "ARREARS" ? t("payroll.supplementary.workOut") : t("payroll.supplementary.find")}
        </Button>
        <Button
          variant="primary"
          icon={<FilePlus2 className="size-4" />}
          loading={busy === "make"}
          disabled={type === "ARREARS" ? !arrears?.some((a) => !a.isSelf) || range.reason.trim().length < 3 : picked.size === 0}
          onClick={make}
        >
          {t("payroll.supplementary.makeButton")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ArrearsRows({ a, open, onToggle, name }: { a: ArrearsRow; open: boolean; onToggle: () => void; name: string }) {
  const { t, locale } = useI18n();
  return (
    <>
      <Tr>
        <Td>
          <button type="button" onClick={onToggle} aria-expanded={open} className="text-left font-medium text-ink-900 hover:text-brand-700">
            {name}
          </button>
          <span className="block text-xs text-ink-500">{a.code}</span>
          {a.isSelf && <Badge tone="blue">{t("payroll.self")}</Badge>}
        </Td>
        <Td label={t("payroll.supplementary.months")} className="text-sm">
          {a.months.map((m) => formatMonth(m.month, locale)).join(", ")}
        </Td>
        <Td label={t("payroll.gross")} align="right">
          {formatINR(a.gross)}
        </Td>
        <Td label={t("payroll.deductions")} align="right">
          {formatINR(a.deductions)}
        </Td>
        <Td label={t("payroll.net")} align="right" className="font-semibold text-ink-950">
          {formatINR(a.net)}
        </Td>
      </Tr>
      {open &&
        a.months.map((m) => (
          <Tr key={m.month} className="bg-ink-50/50">
            <Td colSpan={5} className="text-sm">
              <p className="font-semibold text-ink-800">{formatMonth(m.month, locale)}</p>
              <ul className="mt-1 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                {m.lines.map((l) => (
                  <li key={l.code} className="flex justify-between gap-3 text-ink-700">
                    <span>{locale === "hi" ? l.nameHi : l.name}</span>
                    <span className="tabular">
                      {formatINR(l.due)} − {formatINR(l.drawn)} = <b>{formatINR(l.diff)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            </Td>
          </Tr>
        ))}
    </>
  );
}
