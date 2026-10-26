/**
 * Default leave rules — PRD §7 table (central rules, to confirm for DCB). Loaded by the seed; afterwards the
 * table belongs to the Board and changes go through an Admin (LV-01).
 */
import type { EmployeeType, LeaveCreditMode, LeavePay } from "@/generated/prisma/enums";

export interface LeaveTypeDefault {
  code: string;
  name: string;
  nameHi: string;
  pay: LeavePay;
  creditMode: LeaveCreditMode;
  creditDays: number;
  cap?: number;
  lapsesAtYearEnd?: boolean;
  debitFrom?: string;
  debitFactor?: number;
  countsOffDays?: boolean;
  halfDayAllowed?: boolean;
  needsCertificate?: boolean;
  restrictedOnly?: boolean;
  gender?: "F" | "M";
  employeeTypes: EmployeeType[];
  officerLimitDays?: number | null;
}

const REGULAR: EmployeeType[] = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION", "REEMPLOYED"];
const PERMANENT: EmployeeType[] = ["PERMANENT_OPS", "PERMANENT_NPS"];

export const LEAVE_DEFAULTS: LeaveTypeDefault[] = [
  { code: "CL", name: "Casual Leave", nameHi: "आकस्मिक अवकाश", pay: "FULL", creditMode: "YEARLY", creditDays: 8, lapsesAtYearEnd: true, countsOffDays: false, halfDayAllowed: true, employeeTypes: [...REGULAR, "CONTRACT"], officerLimitDays: 8 },
  { code: "EL", name: "Earned Leave", nameHi: "अर्जित अवकाश", pay: "FULL", creditMode: "HALF_YEARLY", creditDays: 15, cap: 300, employeeTypes: REGULAR, officerLimitDays: 15 },
  { code: "HPL", name: "Half Pay Leave", nameHi: "अर्ध वेतन अवकाश", pay: "HALF", creditMode: "HALF_YEARLY", creditDays: 10, employeeTypes: PERMANENT, officerLimitDays: 15 },
  { code: "CML", name: "Commuted Leave", nameHi: "परिवर्तित अवकाश", pay: "FULL", creditMode: "NONE", creditDays: 0, debitFrom: "HPL", debitFactor: 2, needsCertificate: true, employeeTypes: PERMANENT, officerLimitDays: 15 },
  { code: "EOL", name: "Extraordinary Leave", nameHi: "असाधारण अवकाश", pay: "NONE", creditMode: "NONE", creditDays: 0, employeeTypes: PERMANENT, officerLimitDays: null },
  { code: "ML", name: "Maternity Leave", nameHi: "प्रसूति अवकाश", pay: "FULL", creditMode: "SPELL", creditDays: 180, gender: "F", employeeTypes: REGULAR, officerLimitDays: null },
  { code: "PTL", name: "Paternity Leave", nameHi: "पितृत्व अवकाश", pay: "FULL", creditMode: "SPELL", creditDays: 15, gender: "M", employeeTypes: REGULAR, officerLimitDays: 15 },
  // Women employees (and single fathers under the central rules — to confirm for DCB).
  { code: "CCL", name: "Child Care Leave", nameHi: "बाल देखभाल अवकाश", pay: "FULL", creditMode: "SERVICE", creditDays: 730, gender: "F", employeeTypes: REGULAR, officerLimitDays: null },
  { code: "RH", name: "Restricted Holiday", nameHi: "प्रतिबंधित अवकाश", pay: "FULL", creditMode: "YEARLY", creditDays: 2, lapsesAtYearEnd: true, countsOffDays: false, restrictedOnly: true, employeeTypes: [...REGULAR, "CONTRACT"], officerLimitDays: 1 },
];
