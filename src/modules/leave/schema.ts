import { z } from "zod";
import { isoDateField } from "@/lib/validators";

const reason = z.string().trim().min(3, "validation.tooShort").max(300);

/** LV-03: an employee's own application. */
export const applySchema = z.object({
  leaveCode: z.string().trim().min(1, "validation.required").max(10),
  fromDate: isoDateField,
  toDate: isoDateField,
  halfDay: z.boolean().default(false),
  reason,
  contact: z.string().trim().max(120).optional(),
});

/** LV-05: HR enters leave already sanctioned on paper, for someone who does not use the system. */
export const enterSchema = applySchema.extend({
  employeeId: z.string().min(1, "validation.required"),
  sanctionRef: z.string().trim().min(3, "validation.required").max(120),
});

export const cancelSchema = z.object({ note: z.string().trim().min(3, "validation.tooShort").max(300) });

const num = (max: number) => z.coerce.number().min(0).max(max);

/** LV-01: one row of the leave rules table, as HR proposes it. */
export const leaveRuleSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, "validation.invalid"),
  name: z.string().trim().min(2, "validation.required").max(60),
  nameHi: z.string().trim().min(2, "validation.required").max(60),
  pay: z.enum(["FULL", "HALF", "NONE"]),
  creditMode: z.enum(["HALF_YEARLY", "YEARLY", "SPELL", "SERVICE", "NONE"]),
  creditDays: num(1000),
  cap: z.union([z.literal("").transform(() => null), z.null(), num(1000)]).optional().transform((v) => v ?? null),
  lapsesAtYearEnd: z.boolean(),
  countsOffDays: z.boolean(),
  halfDayAllowed: z.boolean(),
  needsCertificate: z.boolean(),
  officerLimitDays: z.union([z.literal("").transform(() => null), z.null(), z.coerce.number().int().min(0).max(365)]).optional().transform((v) => v ?? null),
  isActive: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

/** LV-06: opening balances as on the cut-over date. */
export const openingSchema = z.object({
  asOn: isoDateField,
  rows: z
    .array(z.object({ employeeId: z.string().min(1), leaveCode: z.string().min(1).max(10), days: z.coerce.number().min(0).max(1000) }))
    .min(1, "validation.required")
    .max(20000),
  note: z.string().trim().max(300).optional(),
});
