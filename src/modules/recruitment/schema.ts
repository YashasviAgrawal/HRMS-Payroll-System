import { z } from "zod";
import { isISODate } from "@/lib/dates";
import { MOBILE_RE, normaliseMobile, optionalNumber } from "@/lib/validators";

export const RESERVATION_CATEGORIES = ["GEN", "OBC", "SC", "ST", "EWS"] as const;
export const APPLICANT_STATUSES = ["APPLIED", "ELIGIBLE", "SHORTLISTED", "SELECTED", "WAITLISTED", "REJECTED"] as const;
/** RO-05 joining checklist; each item is ticked with an upload. */
export const CHECKLIST_ITEMS = ["documents", "medical", "police", "oath", "bank", "pan", "aadhaarConsent"] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];
export type Checklist = Record<ChecklistItem, { done: boolean; documentId: string | null; note: string | null; by: string | null; at: string | null }>;

export function emptyChecklist(): Checklist {
  return Object.fromEntries(CHECKLIST_ITEMS.map((k) => [k, { done: false, documentId: null, note: null, by: null, at: null }])) as Checklist;
}

const optDate = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isISODate(v), "validation.date");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const reservationSchema = z.object(Object.fromEntries(RESERVATION_CATEGORIES.map((c) => [c, z.coerce.number().int().min(0).max(500)])) as Record<(typeof RESERVATION_CATEGORIES)[number], z.ZodCoercedNumber<unknown>>);

export const vacancySchema = z
  .object({
    sectionId: z.string().min(1, "validation.required"),
    postId: z.string().min(1, "validation.required"),
    seats: z.coerce.number().int().min(1, "validation.invalid").max(500),
    reservation: reservationSchema,
    advertNumber: optText(80),
    advertDate: optDate,
    lastDate: optDate,
    notes: optText(1000),
  })
  .superRefine((v, ctx) => {
    const total = RESERVATION_CATEGORIES.reduce((a, c) => a + Number(v.reservation[c] ?? 0), 0);
    if (total !== v.seats) ctx.addIssue({ code: "custom", path: ["reservation"], message: "recruitment.errors.reservationTotal" });
    if (v.advertDate && v.lastDate && v.lastDate < v.advertDate) ctx.addIssue({ code: "custom", path: ["lastDate"], message: "employees.errors.endBeforeStart" });
  });
export type VacancyInput = z.infer<typeof vacancySchema>;

export const advertSchema = z
  .object({ advertNumber: z.string().trim().min(1, "validation.required").max(80), advertDate: z.string().refine(isISODate, "validation.date"), lastDate: z.string().refine(isISODate, "validation.date") })
  .refine((v) => v.lastDate >= v.advertDate, { path: ["lastDate"], message: "employees.errors.endBeforeStart" });

export const applicantSchema = z.object({
  applicationNo: optText(40),
  name: z.string().trim().min(2, "validation.tooShort").max(120),
  nameHi: optText(120),
  fatherName: optText(120),
  gender: z.enum(["M", "F", "T"]),
  dateOfBirth: z.string().refine(isISODate, "validation.date"),
  category: z.enum(RESERVATION_CATEGORIES),
  mobile: z
    .string()
    .nullish()
    .transform((v) => (v ? normaliseMobile(v) : null))
    .refine((v) => v === null || MOBILE_RE.test(v), "validation.mobile"),
  email: optText(120),
  address: optText(300),
  qualification: optText(200),
});
export type ApplicantInput = z.infer<typeof applicantSchema>;

export const applicantUpdateSchema = z.object({
  status: z.enum(APPLICANT_STATUSES),
  score: optionalNumber(z.number().min(0).max(100000)),
  meritRank: optionalNumber(z.number().int().min(1).max(100000)),
  remarks: optText(500),
});

export const directJoiningSchema = z
  .object({
    firstName: z.string().trim().min(1, "validation.required").max(60),
    lastName: optText(60),
    nameHi: optText(120),
    gender: z.enum(["M", "F", "T"]),
    dateOfBirth: z.string().refine(isISODate, "validation.date"),
    mobile: z
      .string()
      .nullish()
      .transform((v) => (v ? normaliseMobile(v) : null))
      .refine((v) => v === null || MOBILE_RE.test(v), "validation.mobile"),
    type: z.enum(["CONTRACT", "DAILY_WAGE"]),
    sectionId: z.string().min(1, "validation.required"),
    postId: z.string().min(1, "validation.required"),
    dateOfJoining: z.string().refine(isISODate, "validation.date"),
    agencyName: optText(120),
    wageRate: z.coerce.number().positive("validation.invalid").max(1_000_000),
    wageBasis: z.enum(["MONTHLY", "DAILY"]),
    contractStart: optDate,
    contractEnd: optDate,
  })
  .refine((v) => v.type !== "CONTRACT" || (v.contractStart && v.contractEnd), { path: ["contractEnd"], message: "validation.required" });
export type DirectJoiningInput = z.infer<typeof directJoiningSchema>;

export const checklistUpdateSchema = z.object({
  item: z.enum(CHECKLIST_ITEMS),
  done: z.boolean(),
  documentId: z.string().nullish(),
  note: optText(300),
});
