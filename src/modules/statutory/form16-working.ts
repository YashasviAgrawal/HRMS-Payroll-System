import "server-only";
import type { DbLike } from "@/lib/db";
import { endOfMonth } from "@/lib/dates";
import { fullName } from "@/modules/employees/present";
import { familyPensionIds } from "@/modules/pension/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { statutorySettings } from "./settings";
import { fyMonths, taxWorking, type TaxWorking } from "./tax-rules";
import { addParts, declaredFor, headFlags, partsOf, taxRulesFor, ZERO_PARTS, type SalaryParts } from "./tds-projection";

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;

export interface YearWorking {
  employeeId: string;
  code: string;
  name: string;
  nameHi: string | null;
  panEnc: string | null;
  panLast4: string | null;
  post: string;
  from: string;
  to: string;
  parts: SalaryParts;
  carriedIn: { salary: number; tds: number; note: string } | null;
  months: { month: string; gross: number; tds: number }[];
  working: TaxWorking;
  /** TDS deducted in the year (pay bills plus any carried in). */
  tds: number;
  basis: "DECLARED" | "VERIFIED" | "NONE";
}

/**
 * ST-07: the year's actual tax working per person, from the approved pay bills (and salary carried in) — what Form 16
 * Part B prints and the fourth-quarter 24Q's salary details carry. Deductions count only once verified (year end).
 */
export async function form16Workings(tx: DbLike, boardId: string, fy: string, employeeIds?: string[]): Promise<YearWorking[]> {
  const [from, to] = fyMonths(fy);
  const where = employeeIds ? { employeeId: { in: employeeIds } } : {};
  const [heads, allSlips, carried, declarations, rules, settings] = await Promise.all([
    tx.payHead.findMany({ where: { boardId } }),
    tx.payslip.findMany({
      where: { boardId, ...where, month: { gte: from, lte: to }, status: "INCLUDED", run: { status: { in: [...PAID] } } },
      select: { employeeId: true, pensionerId: true, month: true, lines: true },
      orderBy: { month: "asc" },
    }),
    tx.taxCarryIn.findMany({ where: { boardId, ...where, fy } }),
    tx.taxDeclaration.findMany({ where: { boardId, ...where, fy } }),
    taxRulesFor(tx, boardId, fy),
    statutorySettings(tx, boardId),
  ]);
  const family = await familyPensionIds(tx, boardId);
  const slips = allSlips.filter((s) => !s.pensionerId || !family.has(s.pensionerId));
  const ids = [...new Set([...slips.map((s) => s.employeeId), ...carried.map((c) => c.employeeId)])];
  const people = await tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, panEnc: true, panLast4: true, post: { select: { name: true } } }, orderBy: { employeeCode: "asc" } });
  const flags = headFlags(heads);
  const carriedBy = new Map(carried.map((c) => [c.employeeId, c]));
  const declBy = new Map(declarations.map((d) => [d.employeeId, d]));
  return people.map((e) => {
    const c = carriedBy.get(e.id);
    let parts: SalaryParts = c ? { ...ZERO_PARTS, gross: num(c.salary), tds: num(c.tds) } : { ...ZERO_PARTS };
    const months = new Map<string, { gross: number; tds: number }>();
    for (const s of slips.filter((x) => x.employeeId === e.id)) {
      const p = partsOf(s.lines as unknown as PayLine[], flags);
      parts = addParts(parts, p);
      const m = months.get(s.month) ?? { gross: 0, tds: 0 };
      months.set(s.month, { gross: m.gross + p.gross, tds: m.tds + p.tds });
    }
    const declared = declaredFor(declBy.get(e.id), to);
    const working = taxWorking(parts, declared.regime, declared.items, rules[declared.regime], settings.metroHra);
    const paidMonths = [...months.keys()].sort();
    return {
      employeeId: e.id,
      code: e.employeeCode ?? "",
      name: fullName(e),
      nameHi: e.nameHi,
      panEnc: e.panEnc,
      panLast4: e.panLast4,
      post: e.post.name,
      from: c || !paidMonths.length ? `${from}-01` : `${paidMonths[0]}-01`,
      to: endOfMonth(`${paidMonths.at(-1) ?? to}-01`),
      parts,
      carriedIn: c ? { salary: num(c.salary), tds: num(c.tds), note: c.note } : null,
      months: paidMonths.map((m) => ({ month: m, ...months.get(m)! })),
      working,
      tds: Math.round(parts.tds),
      basis: declared.basis,
    };
  });
}
