/**
 * Money helpers shared by the browser and the server.
 *
 * Amounts are stored as Decimal(14,2) rupees. Calculations run in integer paise so that sums never drift,
 * and every pay head is rounded to the rupee the way government pay bills are (PRD §1: match FoxPro to ₹1).
 */

export type RoundingMode = "NEAREST" | "UP" | "DOWN";

/** Converts rupees (number, numeric string or Prisma Decimal) to integer paise. */
export function toPaise(rupees: number | string | { toString(): string } | null | undefined): number {
  if (rupees === null || rupees === undefined || rupees === "") return 0;
  const n = typeof rupees === "number" ? rupees : Number(rupees.toString());
  if (!Number.isFinite(n)) throw new Error(`Not a money amount: ${String(rupees)}`);
  return Math.round(n * 100);
}

export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * Rounds paise to whole rupees. NEAREST follows the government rule: 50 paise and above go up,
 * below 50 paise are dropped. Works for negative amounts symmetrically (recoveries).
 */
export function roundPaiseToRupee(paise: number, mode: RoundingMode = "NEAREST"): number {
  const sign = paise < 0 ? -1 : 1;
  const abs = Math.abs(paise);
  let rupees: number;
  if (mode === "UP") rupees = Math.ceil(abs / 100);
  else if (mode === "DOWN") rupees = Math.floor(abs / 100);
  else rupees = Math.floor((abs + 50) / 100);
  return sign * rupees * 100;
}

/** Percentage of an amount in paise, rounded to the rupee. 10% of ₹56,640 → ₹5,664. */
export function percentOf(paise: number, percent: number, mode: RoundingMode = "NEAREST"): number {
  return roundPaiseToRupee((paise * percent) / 100, mode);
}

const inrWhole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,23,456 — Indian digit grouping. Pass paise: true when the value is in paise. */
export function formatINR(
  amount: number | string | { toString(): string } | null | undefined,
  opts: { paise?: boolean; decimals?: boolean; symbol?: boolean } = {},
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const rupees = opts.paise ? Number(amount) / 100 : Number(amount.toString());
  const text = (opts.decimals ? inrPaise : inrWhole).format(rupees);
  return opts.symbol === false ? text : `₹${text}`;
}

// ── Amount in words ─────────────────────────────────────────────────────────

const EN_ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function enBelowHundred(n: number): string {
  if (n < 20) return EN_ONES[n];
  const t = EN_TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${EN_ONES[n % 10]}` : t;
}

function enBelowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${EN_ONES[h]} Hundred`);
  if (rest) parts.push(enBelowHundred(rest));
  return parts.join(" ");
}

/** Indian system: crore, lakh, thousand, hundred. */
function enWhole(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  if (crore) parts.push(`${enWhole(crore)} Crore`);
  n %= 1_00_00_000;
  const lakh = Math.floor(n / 1_00_000);
  if (lakh) parts.push(`${enBelowHundred(lakh)} Lakh`);
  n %= 1_00_000;
  const thousand = Math.floor(n / 1000);
  if (thousand) parts.push(`${enBelowHundred(thousand)} Thousand`);
  n %= 1000;
  if (n) parts.push(enBelowThousand(n));
  return parts.join(" ");
}

// Hindi numbers 0–99 are irregular, so they are listed in full.
const HI_0_99 = [
  "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
  "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
  "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
  "पचास", "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
  "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
  "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी",
  "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
  "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
];

function hiWhole(n: number): string {
  if (n === 0) return HI_0_99[0];
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  if (crore) parts.push(`${hiWhole(crore)} करोड़`);
  n %= 1_00_00_000;
  const lakh = Math.floor(n / 1_00_000);
  if (lakh) parts.push(`${HI_0_99[lakh]} लाख`);
  n %= 1_00_000;
  const thousand = Math.floor(n / 1000);
  if (thousand) parts.push(`${HI_0_99[thousand]} हज़ार`);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  if (hundred) parts.push(`${HI_0_99[hundred]} सौ`);
  n %= 100;
  if (n) parts.push(HI_0_99[n]);
  return parts.join(" ");
}

/** "Rupees Seventy-Three Thousand Twenty Only" / "तिहत्तर हज़ार बीस रुपये मात्र" (SL-02). */
export function amountInWords(rupees: number, lang: "en" | "hi" = "en"): string {
  const negative = rupees < 0;
  const paiseTotal = Math.round(Math.abs(rupees) * 100);
  const whole = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  if (lang === "hi") {
    let text = `${hiWhole(whole)} रुपये`;
    if (paise) text += ` ${HI_0_99[paise]} पैसे`;
    return `${negative ? "ऋण " : ""}${text} मात्र`;
  }
  let text = `Rupees ${enWhole(whole)}`;
  if (paise) text += ` and ${enBelowHundred(paise)} Paise`;
  return `${negative ? "Minus " : ""}${text} Only`;
}
