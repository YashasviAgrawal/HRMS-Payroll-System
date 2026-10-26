/**
 * Employee master field rules (EM-01…EM-04), shared by the browser forms and the server.
 * Messages are i18n keys; the API wrapper translates them.
 */
import { z } from "zod";
import { isISODate, completedYears } from "@/lib/dates";
import {
  isValidAadhaar,
  isValidBankAccount,
  isValidEsic,
  isValidIfsc,
  isValidPan,
  isValidPincode,
  isValidPran,
  isValidUan,
  MOBILE_RE,
  normaliseMobile,
  optionalNumber,
} from "@/lib/validators";
import { cellCount, PAY_LEVELS } from "@/modules/payroll/matrix-7cpc";

export const EMPLOYEE_TYPES = ["PERMANENT_OPS", "PERMANENT_NPS", "CONTRACT", "DAILY_WAGE", "REEMPLOYED", "DEPUTATION"] as const;
export const EMPLOYEE_STATUSES = ["DRAFT", "ACTIVE", "SUSPENDED", "RETIRED", "RESIGNED", "TRANSFERRED", "TERMINATED", "DECEASED"] as const;
export const GENDERS = ["M", "F", "T"] as const;
export const CATEGORIES = ["GEN", "OBC", "SC", "ST", "EWS"] as const;
export const MARITAL = ["SINGLE", "MARRIED", "WIDOWED", "DIVORCED"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const RELATIONS = ["SPOUSE", "SON", "DAUGHTER", "FATHER", "MOTHER", "BROTHER", "SISTER", "OTHER"] as const;
export const NOMINEE_SCHEMES = ["GPF", "GRATUITY", "GROUP_INSURANCE", "FAMILY_PENSION", "NPS"] as const;
export const DOC_CATEGORIES = ["APPOINTMENT_ORDER", "CERTIFICATE", "ID_PROOF", "SERVICE_ORDER", "MEDICAL", "PHOTO", "OTHER"] as const;
export const SERVICE_EVENTS = [
  "APPOINTMENT", "CONFIRMATION", "INCREMENT", "PROMOTION", "MACP", "PAY_FIXATION",
  "TRANSFER", "LEAVE", "PENALTY", "REWARD", "RETIREMENT", "OTHER",
] as const;
/** Service book events that, after the Checker, also need an Admin Approver (§14: "A (appointment, promotion, penalty)"). */
export const EVENTS_NEEDING_APPROVER = ["APPOINTMENT", "PROMOTION", "PENALTY"] as const;
export const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;

/** Employee types that hold a sanctioned post and are paid from the 7th CPC matrix. */
export const MATRIX_TYPES = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"] as const;
/** Types paid a wage rate instead (RO-09). */
export const WAGE_TYPES = ["CONTRACT", "DAILY_WAGE", "REEMPLOYED"] as const;

export const isMatrixType = (t: string) => (MATRIX_TYPES as readonly string[]).includes(t);
export const isWageType = (t: string) => (WAGE_TYPES as readonly string[]).includes(t);

// ── building blocks ─────────────────────────────────────────────────────────

/** Optional free text: "" and whitespace become null. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "validation.tooLong")
    .nullish()
    .transform((v) => (v ? v : null));

const optDate = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isISODate(v), "validation.date");

const optEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal("")])
    .nullish()
    .transform((v) => (v ? (v as T[number]) : null));

const optFormatted = (check: (v: string) => boolean, message: string, normalise: (v: string) => string = (v) => v.trim()) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ? normalise(v) : null))
    .refine((v) => v === null || check(v), message);

export const addressSchema = z
  .object({
    line1: z.string().trim().max(150).default(""),
    line2: z.string().trim().max(150).default(""),
    city: z.string().trim().max(80).default(""),
    district: z.string().trim().max(80).default(""),
    state: z.string().trim().max(60).default(""),
    pincode: z.string().trim().default(""),
  })
  .refine((a) => !a.pincode || isValidPincode(a.pincode), { message: "validation.invalid", path: ["pincode"] })
  .nullish()
  .transform((a) => (a && (a.line1 || a.city || a.pincode) ? a : null));

export type Address = { line1: string; line2: string; city: string; district: string; state: string; pincode: string };

// ── tabs ────────────────────────────────────────────────────────────────────

export const personalSchema = z.object({
  firstName: z.string().trim().min(1, "validation.required").max(60, "validation.tooLong"),
  middleName: optText(60),
  lastName: optText(60),
  nameHi: optText(120),
  gender: z.enum(GENDERS),
  dateOfBirth: z.string().refine(isISODate, "validation.date"),
  fatherOrSpouseName: optText(120),
  category: optEnum(CATEGORIES),
  maritalStatus: optEnum(MARITAL),
  bloodGroup: optEnum(BLOOD_GROUPS),
  isDisabled: z.boolean().default(false),
  mobile: optFormatted((v) => MOBILE_RE.test(v), "validation.mobile", normaliseMobile),
  email: optFormatted((v) => z.email().safeParse(v).success, "validation.email", (v) => v.trim().toLowerCase()),
  presentAddress: addressSchema,
  permanentAddress: addressSchema,
});

export const jobSchema = z.object({
  type: z.enum(EMPLOYEE_TYPES),
  sectionId: z.string().min(1, "validation.required"),
  postId: z.string().min(1, "validation.required"),
  dateOfJoining: z.string().refine(isISODate, "validation.date"),
  payLevel: optEnum(PAY_LEVELS as unknown as [string, ...string[]]),
  payCell: optionalNumber(z.number().int().min(1).max(40)),
  probationEndDate: optDate,
  confirmationDate: optDate,
  agencyName: optText(120),
  wageRate: optionalNumber(z.number().min(0).max(1_000_000)),
  wageBasis: optEnum(["MONTHLY", "DAILY"] as const),
  contractStart: optDate,
  contractEnd: optDate,
});

export const idsSchema = z.object({
  pan: optFormatted(isValidPan, "validation.pan", (v) => v.trim().toUpperCase()),
  aadhaar: optFormatted(isValidAadhaar, "validation.aadhaar", (v) => v.replace(/[\s-]/g, "")),
  pran: optFormatted(isValidPran, "validation.pran"),
  uan: optFormatted(isValidUan, "validation.uan"),
  esicNumber: optFormatted(isValidEsic, "validation.esic"),
  gpfNumber: optText(30),
  bankAccount: optFormatted(isValidBankAccount, "validation.bankAccount", (v) => v.replace(/\s/g, "")),
  ifsc: optFormatted(isValidIfsc, "validation.ifsc", (v) => v.trim().toUpperCase()),
  bankName: optText(100),
  bankBranch: optText(100),
});

export type PersonalInput = z.infer<typeof personalSchema>;
export type JobInput = z.infer<typeof jobSchema>;
export type IdsInput = z.infer<typeof idsSchema>;

export const createEmployeeSchema = z.object({
  personal: personalSchema,
  job: jobSchema,
  ids: idsSchema,
  note: optText(500),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/**
 * Rules that look at more than one field. Returns { field: messageKey } for every problem found.
 * Used on create and again on every edit against the merged record.
 */
export function crossCheck(p: Pick<PersonalInput, "dateOfBirth">, j: JobInput, ids?: Partial<IdsInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (isISODate(p.dateOfBirth) && isISODate(j.dateOfJoining)) {
    if (completedYears(p.dateOfBirth, j.dateOfJoining) < 18) errors["job.dateOfJoining"] = "employees.errors.under18";
  }
  if (isMatrixType(j.type)) {
    if (!j.payLevel) errors["job.payLevel"] = "validation.required";
    if (!j.payCell) errors["job.payCell"] = "validation.required";
    if (j.payLevel && j.payCell && j.payCell > cellCount(j.payLevel)) errors["job.payCell"] = "employees.errors.noSuchCell";
  }
  if (isWageType(j.type)) {
    if (j.wageRate === null || j.wageRate === undefined) errors["job.wageRate"] = "validation.required";
    if (!j.wageBasis) errors["job.wageBasis"] = "validation.required";
  }
  if (j.type === "CONTRACT" || j.type === "REEMPLOYED") {
    if (!j.contractStart) errors["job.contractStart"] = "validation.required";
    if (!j.contractEnd) errors["job.contractEnd"] = "validation.required";
  }
  if (j.contractStart && j.contractEnd && j.contractEnd < j.contractStart) errors["job.contractEnd"] = "employees.errors.endBeforeStart";
  if (j.probationEndDate && j.probationEndDate < j.dateOfJoining) errors["job.probationEndDate"] = "employees.errors.endBeforeStart";
  if (ids?.bankAccount && !ids.ifsc) errors["ids.ifsc"] = "validation.required";
  return errors;
}

export const familyMemberSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "validation.required").max(120),
  nameHi: optText(120),
  relation: z.enum(RELATIONS),
  gender: optEnum(GENDERS),
  dateOfBirth: optDate,
  isDependent: z.boolean().default(false),
  isDisabled: z.boolean().default(false),
  isAlive: z.boolean().default(true),
});

export const nomineeSchema = z.object({
  scheme: z.enum(NOMINEE_SCHEMES),
  /** Index into the family list being saved (ids may not exist yet for new members). */
  memberIndex: z.number().int().min(0),
  sharePercent: z.coerce.number().gt(0).max(100),
});

export const familySchema = z
  .object({ members: z.array(familyMemberSchema).max(30), nominees: z.array(nomineeSchema).max(60), note: optText(500) })
  .superRefine((v, ctx) => {
    for (const n of v.nominees) {
      if (n.memberIndex >= v.members.length) ctx.addIssue({ code: "custom", message: "validation.invalid", path: ["nominees"] });
    }
    // EM-04: the shares of each scheme add up to exactly 100%.
    const totals = new Map<string, number>();
    for (const n of v.nominees) totals.set(n.scheme, (totals.get(n.scheme) ?? 0) + Math.round(n.sharePercent * 100));
    for (const [scheme, total] of totals) {
      if (total !== 10000) ctx.addIssue({ code: "custom", message: "employees.errors.sharesNot100", path: ["nominees", scheme] });
    }
  });
export type FamilyInput = z.infer<typeof familySchema>;

export const serviceEntrySchema = z.object({
  event: z.enum(SERVICE_EVENTS),
  eventDate: z.string().refine(isISODate, "validation.date"),
  orderNumber: optText(80),
  orderDate: optDate,
  details: z.string().trim().min(3, "validation.tooShort").max(1000, "validation.tooLong"),
  detailsHi: optText(1000),
  documentId: z.string().nullish(),
});
export type ServiceEntryInput = z.infer<typeof serviceEntrySchema>;

/** EM-08: what an employee may ask HR to change. */
export const selfRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("address"), presentAddress: addressSchema, permanentAddress: addressSchema, note: optText(500) }),
  z.object({
    kind: z.literal("mobile"),
    mobile: z.string().transform(normaliseMobile).refine((v) => MOBILE_RE.test(v), "validation.mobile"),
    note: optText(500),
  }),
  z.object({
    kind: z.literal("bank"),
    bankAccount: z.string().transform((v) => v.replace(/\s/g, "")).refine(isValidBankAccount, "validation.bankAccount"),
    ifsc: z.string().transform((v) => v.trim().toUpperCase()).refine(isValidIfsc, "validation.ifsc"),
    bankName: optText(100),
    bankBranch: optText(100),
    documentId: z.string().nullish(),
    note: optText(500),
  }),
  z.object({
    kind: z.literal("nominee"),
    details: z.string().trim().min(5, "validation.tooShort").max(1000),
    note: optText(500),
  }),
]);
export type SelfRequestInput = z.infer<typeof selfRequestSchema>;

export const sanctionedSchema = z.object({
  rows: z
    .array(z.object({ sectionId: z.string().min(1), postId: z.string().min(1), sanctioned: z.coerce.number().int().min(0).max(5000) }))
    .min(1)
    .max(500),
  orderRef: optText(120),
  note: optText(500),
});
export type SanctionedInput = z.infer<typeof sanctionedSchema>;
