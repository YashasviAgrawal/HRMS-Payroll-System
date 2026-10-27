/**
 * The rates the pay engine reads (PR-02, ST-01), with the defaults from the PRD (DA 60% from 1 Jan 2026, HRA 30% for
 * Delhi, TA by level with DA on TA) and central rules for the statutory rates — all to confirm for DCB (PRD §18).
 * Values live in the dated PayRate table; this file only names them.
 */
export type RateUnit = "PERCENT" | "RUPEES" | "COUNT";
export type RateGroup = "PAY" | "ALLOWANCE" | "STATUTORY" | "PENSION";

export interface RateDef {
  key: string;
  name: string;
  nameHi: string;
  unit: RateUnit;
  group: RateGroup;
}

export const RATE_CATALOG: RateDef[] = [
  { key: "DA_PERCENT", name: "Dearness allowance", nameHi: "महँगाई भत्ता", unit: "PERCENT", group: "PAY" },
  { key: "HRA_PERCENT", name: "House rent allowance (Delhi, X city)", nameHi: "मकान किराया भत्ता (दिल्ली, X शहर)", unit: "PERCENT", group: "ALLOWANCE" },
  { key: "HRA_MIN", name: "House rent allowance — lowest amount", nameHi: "मकान किराया भत्ता — न्यूनतम राशि", unit: "RUPEES", group: "ALLOWANCE" },
  { key: "TA_HIGH", name: "Transport allowance — Level 9 and above", nameHi: "परिवहन भत्ता — लेवल 9 और ऊपर", unit: "RUPEES", group: "ALLOWANCE" },
  { key: "TA_MID", name: "Transport allowance — Levels 3 to 8", nameHi: "परिवहन भत्ता — लेवल 3 से 8", unit: "RUPEES", group: "ALLOWANCE" },
  { key: "TA_LOW", name: "Transport allowance — Levels 1 and 2", nameHi: "परिवहन भत्ता — लेवल 1 और 2", unit: "RUPEES", group: "ALLOWANCE" },
  { key: "TA_LOW_PAY_LIMIT", name: "Levels 1–2 with Basic at or above this get the Level 3–8 TA", nameHi: "लेवल 1–2 में इतने या अधिक मूल वेतन पर लेवल 3–8 का परिवहन भत्ता", unit: "RUPEES", group: "ALLOWANCE" },
  { key: "NPS_EMPLOYEE", name: "NPS — employee share of Basic + DA", nameHi: "एनपीएस — मूल + महँगाई भत्ते का कर्मचारी अंश", unit: "PERCENT", group: "STATUTORY" },
  { key: "NPS_EMPLOYER", name: "NPS — Board share of Basic + DA", nameHi: "एनपीएस — मूल + महँगाई भत्ते का परिषद अंश", unit: "PERCENT", group: "STATUTORY" },
  { key: "GPF_MIN", name: "GPF — lowest subscription (of Basic)", nameHi: "जीपीएफ — न्यूनतम अंशदान (मूल वेतन का)", unit: "PERCENT", group: "STATUTORY" },
  { key: "GPF_ANNUAL_CAP", name: "GPF — most a person may subscribe in a year", nameHi: "जीपीएफ — एक वर्ष में अधिकतम अंशदान", unit: "RUPEES", group: "STATUTORY" },
  { key: "GPF_INTEREST", name: "GPF — interest a year", nameHi: "जीपीएफ — वार्षिक ब्याज", unit: "PERCENT", group: "STATUTORY" },
  { key: "GPF_ADVANCE_MAX", name: "GPF — advance up to (of balance)", nameHi: "जीपीएफ — अग्रिम अधिकतम (शेष का)", unit: "PERCENT", group: "STATUTORY" },
  { key: "GPF_WITHDRAWAL_MAX", name: "GPF — withdrawal up to (of balance)", nameHi: "जीपीएफ — निकासी अधिकतम (शेष का)", unit: "PERCENT", group: "STATUTORY" },
  { key: "PENSION_EMPLOYER", name: "Board pension fund contribution (OPS)", nameHi: "परिषद पेंशन निधि अंशदान (पुरानी पेंशन)", unit: "PERCENT", group: "STATUTORY" },
  { key: "GIS_A", name: "Group insurance — Group A", nameHi: "समूह बीमा — समूह क", unit: "RUPEES", group: "STATUTORY" },
  { key: "GIS_B", name: "Group insurance — Group B", nameHi: "समूह बीमा — समूह ख", unit: "RUPEES", group: "STATUTORY" },
  { key: "GIS_C", name: "Group insurance — Group C", nameHi: "समूह बीमा — समूह ग", unit: "RUPEES", group: "STATUTORY" },
  { key: "EPF_EMPLOYEE", name: "EPF — employee share", nameHi: "ईपीएफ — कर्मचारी अंश", unit: "PERCENT", group: "STATUTORY" },
  { key: "EPF_EMPLOYER", name: "EPF — employer share (with EPS)", nameHi: "ईपीएफ — नियोक्ता अंश (ईपीएस सहित)", unit: "PERCENT", group: "STATUTORY" },
  { key: "EPS_PERCENT", name: "EPS part of the employer share", nameHi: "नियोक्ता अंश में ईपीएस भाग", unit: "PERCENT", group: "STATUTORY" },
  { key: "EPF_CEILING", name: "EPF wage ceiling", nameHi: "ईपीएफ वेतन सीमा", unit: "RUPEES", group: "STATUTORY" },
  { key: "ESIC_EMPLOYEE", name: "ESIC — employee share", nameHi: "ईएसआईसी — कर्मचारी अंश", unit: "PERCENT", group: "STATUTORY" },
  { key: "ESIC_EMPLOYER", name: "ESIC — employer share", nameHi: "ईएसआईसी — नियोक्ता अंश", unit: "PERCENT", group: "STATUTORY" },
  { key: "ESIC_CEILING", name: "ESIC wage ceiling", nameHi: "ईएसआईसी वेतन सीमा", unit: "RUPEES", group: "STATUTORY" },
  // Pension (PN-02, PN-04, PN-08): central rules, to confirm against the Cantonment Board Employees Service Rules 2021.
  { key: "FMA", name: "Fixed medical allowance to pensioners", nameHi: "पेंशनभोगियों को नियत चिकित्सा भत्ता", unit: "RUPEES", group: "PENSION" },
  { key: "PENSION_PERCENT", name: "Pension — share of emoluments for full service", nameHi: "पेंशन — पूर्ण सेवा पर परिलब्धियों का भाग", unit: "PERCENT", group: "PENSION" },
  { key: "PENSION_FULL_YEARS", name: "Pension — years of service for full pension", nameHi: "पेंशन — पूर्ण पेंशन हेतु सेवा वर्ष", unit: "COUNT", group: "PENSION" },
  { key: "PENSION_MIN_YEARS", name: "Pension — least years of service", nameHi: "पेंशन — न्यूनतम सेवा वर्ष", unit: "COUNT", group: "PENSION" },
  { key: "PENSION_MIN", name: "Pension — lowest amount a month", nameHi: "पेंशन — न्यूनतम मासिक राशि", unit: "RUPEES", group: "PENSION" },
  { key: "PENSION_MAX", name: "Pension — highest amount a month", nameHi: "पेंशन — अधिकतम मासिक राशि", unit: "RUPEES", group: "PENSION" },
  { key: "FAMILY_PENSION_ENHANCED", name: "Family pension — enhanced rate (of last pay)", nameHi: "पारिवारिक पेंशन — बढ़ी दर (अंतिम वेतन का)", unit: "PERCENT", group: "PENSION" },
  { key: "FAMILY_PENSION_NORMAL", name: "Family pension — normal rate (of last pay)", nameHi: "पारिवारिक पेंशन — सामान्य दर (अंतिम वेतन का)", unit: "PERCENT", group: "PENSION" },
  { key: "COMMUTATION_MAX", name: "Commutation — most of the pension", nameHi: "रूपांतरण — पेंशन का अधिकतम भाग", unit: "PERCENT", group: "PENSION" },
  { key: "GRATUITY_CEILING", name: "Gratuity — ceiling", nameHi: "उपदान — अधिकतम सीमा", unit: "RUPEES", group: "PENSION" },
  { key: "LEAVE_ENCASH_MAX_DAYS", name: "Leave encashment — most days of earned leave", nameHi: "अवकाश नकदीकरण — अर्जित अवकाश के अधिकतम दिन", unit: "COUNT", group: "PENSION" },
  { key: "ADDL_PENSION_80", name: "Additional pension from age 80", nameHi: "80 वर्ष से अतिरिक्त पेंशन", unit: "PERCENT", group: "PENSION" },
  { key: "ADDL_PENSION_85", name: "Additional pension from age 85", nameHi: "85 वर्ष से अतिरिक्त पेंशन", unit: "PERCENT", group: "PENSION" },
  { key: "ADDL_PENSION_90", name: "Additional pension from age 90", nameHi: "90 वर्ष से अतिरिक्त पेंशन", unit: "PERCENT", group: "PENSION" },
  { key: "ADDL_PENSION_95", name: "Additional pension from age 95", nameHi: "95 वर्ष से अतिरिक्त पेंशन", unit: "PERCENT", group: "PENSION" },
  { key: "ADDL_PENSION_100", name: "Additional pension from age 100", nameHi: "100 वर्ष से अतिरिक्त पेंशन", unit: "PERCENT", group: "PENSION" },
];

export const RATE_KEYS = RATE_CATALOG.map((r) => r.key);

/** Defaults loaded by the seed: [key, value, effective from]. DA 58% from 1 Jul 2025 lets arrears be shown later. */
export const RATE_DEFAULTS: [string, number, string][] = [
  ["DA_PERCENT", 58, "2025-07-01"],
  ["DA_PERCENT", 60, "2026-01-01"],
  ["HRA_PERCENT", 30, "2024-01-01"],
  ["HRA_MIN", 5400, "2016-01-01"],
  ["TA_HIGH", 7200, "2016-01-01"],
  ["TA_MID", 3600, "2016-01-01"],
  ["TA_LOW", 1350, "2016-01-01"],
  ["TA_LOW_PAY_LIMIT", 24200, "2016-01-01"],
  ["NPS_EMPLOYEE", 10, "2004-01-01"],
  ["NPS_EMPLOYER", 14, "2019-04-01"],
  ["GPF_MIN", 6, "2004-01-01"],
  ["GPF_ANNUAL_CAP", 500000, "2022-04-01"],
  ["GPF_INTEREST", 7.1, "2020-04-01"],
  ["GPF_ADVANCE_MAX", 75, "2017-04-01"],
  ["GPF_WITHDRAWAL_MAX", 90, "2017-04-01"],
  ["PENSION_EMPLOYER", 10, "2020-01-01"],
  ["GIS_A", 120, "1990-01-01"],
  ["GIS_B", 60, "1990-01-01"],
  ["GIS_C", 30, "1990-01-01"],
  ["EPF_EMPLOYEE", 12, "2014-09-01"],
  ["EPF_EMPLOYER", 12, "2014-09-01"],
  ["EPS_PERCENT", 8.33, "2014-09-01"],
  ["EPF_CEILING", 15000, "2014-09-01"],
  ["ESIC_EMPLOYEE", 0.75, "2019-07-01"],
  ["ESIC_EMPLOYER", 3.25, "2019-07-01"],
  ["ESIC_CEILING", 21000, "2017-01-01"],
  ["FMA", 1000, "2017-07-01"],
  ["PENSION_PERCENT", 50, "2006-01-01"],
  ["PENSION_FULL_YEARS", 20, "2006-01-01"],
  ["PENSION_MIN_YEARS", 10, "2006-01-01"],
  ["PENSION_MIN", 9000, "2016-01-01"],
  ["PENSION_MAX", 125000, "2016-01-01"],
  ["FAMILY_PENSION_ENHANCED", 50, "2006-01-01"],
  ["FAMILY_PENSION_NORMAL", 30, "2006-01-01"],
  ["COMMUTATION_MAX", 40, "2006-01-01"],
  ["GRATUITY_CEILING", 2000000, "2016-01-01"],
  ["GRATUITY_CEILING", 2500000, "2024-01-01"],
  ["LEAVE_ENCASH_MAX_DAYS", 300, "2006-01-01"],
  ["ADDL_PENSION_80", 20, "2006-01-01"],
  ["ADDL_PENSION_85", 30, "2006-01-01"],
  ["ADDL_PENSION_90", 40, "2006-01-01"],
  ["ADDL_PENSION_95", 50, "2006-01-01"],
  ["ADDL_PENSION_100", 100, "2006-01-01"],
];
