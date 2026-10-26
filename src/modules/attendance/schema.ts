import { z } from "zod";
import { isMonth } from "@/lib/dates";
import { isoDateField } from "@/lib/validators";
import { MUSTER_STATUSES, RESOLUTIONS } from "./rules";
import { PUNCH_FORMATS } from "./format-defs";

export const monthField = z.string().refine(isMonth, "validation.invalid");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "validation.time");
const optTime = z.union([z.literal("").transform(() => null), hhmm]).nullish();

export const formatField = z.enum(PUNCH_FORMATS);

/** AT-04: missed punch (give the time that is missing) or on duty away from office. */
export const attendanceRequestSchema = z
  .object({
    date: isoDateField,
    type: z.enum(["MISSED_PUNCH", "ON_DUTY"]),
    inTime: optTime,
    outTime: optTime,
    reason: z.string().trim().min(3, "validation.tooShort").max(300),
  })
  .superRefine((v, ctx) => {
    if (v.type === "MISSED_PUNCH" && !v.inTime && !v.outTime) ctx.addIssue({ code: "custom", path: ["inTime"], message: "attendance.errors.giveTime" });
    if (v.inTime && v.outTime && v.outTime <= v.inTime) ctx.addIssue({ code: "custom", path: ["outTime"], message: "attendance.errors.outBeforeIn" });
  });

/** AT-02: muster entries for one section and month; a null status clears an earlier entry. */
export const musterSchema = z.object({
  sectionId: z.string().min(1),
  month: monthField,
  note: z.string().trim().max(300).optional(),
  entries: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        date: isoDateField,
        status: z.enum(MUSTER_STATUSES).nullable(),
      }),
    )
    .min(1, "attendance.errors.nothingToSend")
    .max(2000),
});

/** AT-05: the officer's decision for every unexplained day, then the lock. */
export const lockSchema = z.object({
  sectionId: z.string().min(1),
  month: monthField,
  resolutions: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        date: isoDateField,
        outcome: z.enum(RESOLUTIONS),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .max(2000),
});

export const unlockSchema = z.object({
  sectionId: z.string().min(1),
  month: monthField,
  reason: z.string().trim().min(5, "validation.tooShort").max(300),
});

export const sectionRulesSchema = z.object({
  attendanceMode: z.enum(["DEVICE", "MANUAL"]),
  /** null = Board default; [] = no weekly off. */
  weeklyOff: z.array(z.number().int().min(0).max(6)).max(3).nullable(),
});

export const holidaySchema = z.object({
  date: isoDateField,
  name: z.string().trim().min(2, "validation.required").max(80),
  nameHi: z.string().trim().min(2, "validation.required").max(80),
  kind: z.enum(["GAZETTED", "RESTRICTED"]),
});

export const holidayListSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    holidays: z.array(holidaySchema).max(80),
    note: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.holidays.forEach((h, i) => {
      if (!h.date.startsWith(`${v.year}-`)) ctx.addIssue({ code: "custom", path: ["holidays", i, "date"], message: "attendance.errors.wrongYear" });
      const key = `${h.date}|${h.name.toLowerCase()}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["holidays", i, "name"], message: "attendance.errors.duplicateHoliday" });
      seen.add(key);
    });
  });
