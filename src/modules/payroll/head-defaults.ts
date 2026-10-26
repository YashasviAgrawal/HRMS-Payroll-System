/**
 * Default pay heads (PR-03 earnings, PR-04 deductions, employer shares). Account heads are placeholders for the
 * e-Chhawani chart of accounts and DCB's own allowance rates are open questions (PRD §18) — both editable in S-81.
 */
import type { PayHeadCalc, PayHeadKind } from "@/generated/prisma/enums";

export interface PayHeadDefault {
  code: string;
  name: string;
  nameHi: string;
  kind: PayHeadKind;
  calc: PayHeadCalc;
  value?: number;
  postCodes?: string[];
  prorate?: boolean;
  countsForDa?: boolean;
  taxable?: boolean;
  accountHead: string;
}

export const PAY_HEAD_DEFAULTS: PayHeadDefault[] = [
  { code: "BASIC", name: "Basic pay", nameHi: "मूल वेतन", kind: "EARNING", calc: "SYSTEM", accountHead: "E-1.01 Pay of officers and staff" },
  { code: "NPA", name: "Non-practising allowance", nameHi: "गैर-प्रैक्टिस भत्ता", kind: "EARNING", calc: "PERCENT_BASIC", value: 20, postCodes: ["MO"], countsForDa: true, accountHead: "E-1.01 Pay of officers and staff" },
  { code: "WAGES", name: "Wages", nameHi: "मजदूरी", kind: "EARNING", calc: "SYSTEM", accountHead: "E-1.05 Wages of contract and daily-wage staff" },
  { code: "DA", name: "Dearness allowance", nameHi: "महँगाई भत्ता", kind: "EARNING", calc: "SYSTEM", accountHead: "E-1.02 Dearness allowance" },
  { code: "HRA", name: "House rent allowance", nameHi: "मकान किराया भत्ता", kind: "EARNING", calc: "SYSTEM", accountHead: "E-1.03 House rent allowance" },
  { code: "TA", name: "Transport allowance", nameHi: "परिवहन भत्ता", kind: "EARNING", calc: "SYSTEM", accountHead: "E-1.04 Other allowances" },
  { code: "DA_TA", name: "DA on transport allowance", nameHi: "परिवहन भत्ते पर महँगाई भत्ता", kind: "EARNING", calc: "SYSTEM", accountHead: "E-1.04 Other allowances" },
  { code: "SPECIAL", name: "Special allowance", nameHi: "विशेष भत्ता", kind: "EARNING", calc: "ITEM", accountHead: "E-1.04 Other allowances" },
  { code: "WASHING", name: "Washing allowance", nameHi: "धुलाई भत्ता", kind: "EARNING", calc: "FIXED", value: 150, postCodes: ["SK", "MALI"], accountHead: "E-1.04 Other allowances" },
  { code: "UNIFORM", name: "Uniform allowance", nameHi: "वर्दी भत्ता", kind: "EARNING", calc: "ITEM", prorate: false, accountHead: "E-1.04 Other allowances" },
  { code: "CONSERVANCY", name: "Conservancy allowance", nameHi: "सफ़ाई भत्ता", kind: "EARNING", calc: "FIXED", value: 500, postCodes: ["SK"], accountHead: "E-1.04 Other allowances" },
  { code: "RISK", name: "Risk allowance", nameHi: "जोखिम भत्ता", kind: "EARNING", calc: "FIXED", value: 400, postCodes: ["SK", "PMP", "ELC"], accountHead: "E-1.04 Other allowances" },
  { code: "NPS", name: "NPS (employee 10%)", nameHi: "एनपीएस (कर्मचारी 10%)", kind: "DEDUCTION", calc: "SYSTEM", prorate: false, accountHead: "D-2.01 NPS contribution payable" },
  { code: "GPF", name: "GPF subscription", nameHi: "जीपीएफ अंशदान", kind: "DEDUCTION", calc: "SYSTEM", prorate: false, accountHead: "D-2.02 GPF deposits" },
  { code: "GIS", name: "Group insurance", nameHi: "समूह बीमा", kind: "DEDUCTION", calc: "SYSTEM", prorate: false, accountHead: "D-2.03 Group insurance" },
  { code: "EPF", name: "EPF (employee)", nameHi: "ईपीएफ (कर्मचारी)", kind: "DEDUCTION", calc: "SYSTEM", prorate: false, accountHead: "D-2.04 EPF payable" },
  { code: "ESIC", name: "ESIC (employee)", nameHi: "ईएसआईसी (कर्मचारी)", kind: "DEDUCTION", calc: "SYSTEM", prorate: false, accountHead: "D-2.05 ESIC payable" },
  { code: "IT", name: "Income tax (TDS)", nameHi: "आयकर (टीडीएस)", kind: "DEDUCTION", calc: "ITEM", prorate: false, accountHead: "D-2.06 Income tax deducted" },
  { code: "LICENCE", name: "Licence fee (quarters)", nameHi: "लाइसेंस शुल्क (आवास)", kind: "DEDUCTION", calc: "ITEM", prorate: false, accountHead: "R-3.01 Rent of buildings" },
  { code: "LOAN", name: "Loan and advance recovery", nameHi: "ऋण एवं अग्रिम वसूली", kind: "DEDUCTION", calc: "ITEM", prorate: false, accountHead: "D-2.07 Loans and advances" },
  { code: "COURT", name: "Court attachment", nameHi: "न्यायालय कुर्की", kind: "DEDUCTION", calc: "ITEM", prorate: false, accountHead: "D-2.08 Court attachments" },
  { code: "SOCIETY", name: "Co-operative society dues", nameHi: "सहकारी समिति देय", kind: "DEDUCTION", calc: "ITEM", prorate: false, accountHead: "D-2.09 Society dues" },
  { code: "RECOVERY", name: "Overpayment recovery", nameHi: "अधिक भुगतान वसूली", kind: "DEDUCTION", calc: "ITEM", prorate: false, accountHead: "D-2.10 Recoveries of overpayment" },
  { code: "NPS_ER", name: "NPS (Board 14%)", nameHi: "एनपीएस (परिषद 14%)", kind: "EMPLOYER", calc: "SYSTEM", prorate: false, accountHead: "E-1.10 Board's NPS contribution" },
  { code: "PENSION_ER", name: "Pension fund (Board 10%)", nameHi: "पेंशन निधि (परिषद 10%)", kind: "EMPLOYER", calc: "SYSTEM", prorate: false, accountHead: "E-1.11 Contribution to pension fund" },
  { code: "EPF_ER", name: "EPF (employer)", nameHi: "ईपीएफ (नियोक्ता)", kind: "EMPLOYER", calc: "SYSTEM", prorate: false, accountHead: "E-1.12 Employer's EPF contribution" },
  { code: "ESIC_ER", name: "ESIC (employer)", nameHi: "ईएसआईसी (नियोक्ता)", kind: "EMPLOYER", calc: "SYSTEM", prorate: false, accountHead: "E-1.13 Employer's ESIC contribution" },
];
