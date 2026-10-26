/**
 * ST-01, ST-08: statutory due dates as rules, and the calendar worked out from them. Defaults are central rules and to
 * be confirmed for DCB (PRD §18); each is an editable row.
 */
import { addDays, type ISODate } from "@/lib/dates";

export type DueKind = "MONTHLY" | "QUARTERLY" | "YEARLY" | "AFTER_PAY";

export interface DueRuleDef {
  code: string;
  name: string;
  nameHi: string;
  kind: DueKind;
  /** MONTHLY: day of the next month; AFTER_PAY: days after the pay bill is approved. */
  day: number;
  /** QUARTERLY / YEARLY: "MM-DD" dates. */
  dates: string[];
}

export const DUE_DEFAULTS: DueRuleDef[] = [
  { code: "TDS_DEPOSIT", name: "Deposit income tax (TDS) for last month", nameHi: "पिछले माह का आयकर (टीडीएस) जमा करें", kind: "MONTHLY", day: 7, dates: [] },
  { code: "NPS_CRA", name: "NPS contribution file to the CRA", nameHi: "सीआरए को एनपीएस अंशदान फ़ाइल", kind: "MONTHLY", day: 7, dates: [] },
  { code: "EPF_ECR", name: "EPF return (ECR) and payment", nameHi: "ईपीएफ रिटर्न (ईसीआर) और भुगतान", kind: "MONTHLY", day: 15, dates: [] },
  { code: "ESIC", name: "ESIC contribution", nameHi: "ईएसआईसी अंशदान", kind: "MONTHLY", day: 15, dates: [] },
  { code: "PENSION_FUND", name: "Board pension fund contribution for posting", nameHi: "पोस्टिंग हेतु परिषद पेंशन निधि अंशदान", kind: "AFTER_PAY", day: 4, dates: [] },
  { code: "FORM_24Q", name: "Form 24Q (TDS return on salary)", nameHi: "फ़ॉर्म 24क्यू (वेतन पर टीडीएस रिटर्न)", kind: "QUARTERLY", day: 0, dates: ["07-31", "10-31", "01-31", "05-31"] },
  { code: "FORM_16", name: "Form 16 to employees", nameHi: "कर्मचारियों को फ़ॉर्म 16", kind: "YEARLY", day: 0, dates: ["06-15"] },
  { code: "TAX_PROOFS", name: "Investment proofs from employees", nameHi: "कर्मचारियों से निवेश प्रमाण", kind: "YEARLY", day: 0, dates: ["12-31"] },
];

export interface DueItem {
  code: string;
  name: string;
  nameHi: string;
  dueOn: ISODate;
  /** What the filing is for: "2026-09" for a month, "2026-27 Q2" for a quarter, "2026-27" for a year. */
  period: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
function shift(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
const fyOf = (month: string) => {
  const y = Number(month.slice(0, 4));
  const s = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
  return `${s}-${pad((s + 1) % 100)}`;
};

/**
 * Due dates from `from` to `to` (inclusive). `approvals` gives, per month, when its pay bill was approved — for
 * AFTER_PAY rules.
 */
export function dueItems(rules: DueRuleDef[], from: ISODate, to: ISODate, approvals: Map<string, ISODate> = new Map()): DueItem[] {
  const out: DueItem[] = [];
  const startMonth = shift(from.slice(0, 7), -2);
  for (const r of rules) {
    if (r.kind === "MONTHLY") {
      for (let m = startMonth; `${m}-01` <= to; m = shift(m, 1)) {
        const period = shift(m, -1);
        const dueOn = `${m}-${pad(Math.min(r.day, 28))}`;
        if (dueOn >= from && dueOn <= to) out.push({ code: r.code, name: r.name, nameHi: r.nameHi, dueOn, period });
      }
    } else if (r.kind === "AFTER_PAY") {
      for (const [month, approved] of approvals) {
        const dueOn = addDays(approved, r.day);
        if (dueOn >= from && dueOn <= to) out.push({ code: r.code, name: r.name, nameHi: r.nameHi, dueOn, period: month });
      }
    } else {
      for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++) {
        r.dates.forEach((md, i) => {
          const dueOn = `${y}-${md}`;
          if (dueOn < from || dueOn > to) return;
          if (r.kind === "QUARTERLY") {
            // 31 Jul is Q1 of the year it falls in; 31 May is Q4 of the year before.
            const q = i + 1;
            const fyStart = q === 4 || q === 3 ? y - 1 : y;
            out.push({ code: r.code, name: r.name, nameHi: r.nameHi, dueOn, period: `${fyStart}-${pad((fyStart + 1) % 100)} Q${q}` });
          } else {
            const month = `${y}-${md.slice(0, 2)}`;
            const fy = r.code === "FORM_16" ? fyOf(shift(month, -12)) : fyOf(month);
            out.push({ code: r.code, name: r.name, nameHi: r.nameHi, dueOn, period: fy });
          }
        });
      }
    }
  }
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.code.localeCompare(b.code));
}
