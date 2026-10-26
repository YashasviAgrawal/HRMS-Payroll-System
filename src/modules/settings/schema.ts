import { z } from "zod";

/**
 * Board settings (S-82). Secrets — gateway keys, SMTP passwords, portal passwords — are never stored:
 * a setting may only name the environment variable that holds them (PRD §12 rule 7).
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const BANK_FORMATS = ["GENERIC_CSV", "SBI_CMP", "PNB_BULK", "BOB_BULK", "CANARA_BULK"] as const;

export const settingsSchemas = {
  sms: z.object({
    provider: z.enum(["console", "http"]),
    /** Gateway URL with placeholders {to} {text} {templateId} {senderId} {entityId} {apiKey}. */
    url: z.string().max(500),
    method: z.enum(["GET", "POST"]),
    senderId: z.string().max(6),
    dltEntityId: z.string().max(30),
    apiKeyEnv: z.string().max(60).regex(/^[A-Z0-9_]*$/),
    templates: z.object({
      otp: z.string().max(30),
      approveOtp: z.string().max(30),
      welcome: z.string().max(30),
      payslip: z.string().max(30),
      pensionSlip: z.string().max(30),
      alert: z.string().max(30),
    }),
  }),
  email: z.object({
    fromName: z.string().max(100),
    fromAddress: z.union([z.literal(""), z.string().email()]),
    smtpHost: z.string().max(200),
    smtpPort: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    userEnv: z.string().max(60).regex(/^[A-Z0-9_]*$/),
    passwordEnv: z.string().max(60).regex(/^[A-Z0-9_]*$/),
  }),
  bank: z.object({
    name: z.string().max(100),
    format: z.enum(BANK_FORMATS),
    debitAccountLast4: z.string().regex(/^\d{0,4}$/),
    ifsc: z.union([z.literal(""), z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "validation.ifsc")]),
  }),
  general: z.object({
    attendanceLockDay: z.number().int().min(1).max(28),
  }),
  /** Attendance rules (PRD §6) and the biometric devices allowed to push punches (AT-01). */
  attendance: z.object({
    officeStart: z.string().regex(HHMM, "validation.time"),
    /** Late after office start + grace. */
    graceMinutes: z.number().int().min(0).max(120),
    /** Less than this many minutes between first and last punch is a half day. */
    halfDayMinutes: z.number().int().min(60).max(600),
    /** 0 = Sunday … 6 = Saturday. */
    weeklyOff: z.array(z.number().int().min(0).max(6)).max(3),
    devices: z
      .array(
        z.object({
          serial: z.string().trim().min(3, "validation.required").max(40).regex(/^[A-Za-z0-9_-]+$/, "validation.invalid"),
          name: z.string().trim().max(80),
        }),
      )
      .max(50),
  }),
  /**
   * §9: the Board's identities on the statutory portals (TAN for 24Q and Form 16, DDO registration for the CRA,
   * establishment codes for EPFO and ESIC) and the professional-tax switch — off in Delhi, kept for other Boards.
   */
  statutory: z.object({
    deductorName: z.string().trim().max(75),
    address: z.string().trim().max(200),
    tan: z.union([z.literal(""), z.string().regex(/^[A-Z]{4}\d{5}[A-Z]$/, "validation.tan")]),
    pan: z.union([z.literal(""), z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "validation.pan")]),
    responsibleName: z.string().trim().max(75),
    responsibleDesignation: z.string().trim().max(50),
    ddoRegNo: z.string().trim().max(20),
    epfCode: z.string().trim().max(30),
    esicCode: z.string().trim().max(30),
    /** HRA exemption at 50% of Basic + DA (metro) or 40% — Delhi is a metro. */
    metroHra: z.boolean(),
    professionalTax: z.boolean(),
    /** Monthly gross up to `upTo` (null = above) → professional tax for the month. */
    ptSlabs: z.array(z.object({ upTo: z.number().min(0).nullable(), amount: z.number().min(0).max(2500) })).max(10),
  }),
} as const;

export type SettingKey = keyof typeof settingsSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingsSchemas)[K]>;

export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  sms: {
    provider: "console",
    url: "",
    method: "GET",
    senderId: "DCBHRM",
    dltEntityId: "",
    apiKeyEnv: "SMS_API_KEY",
    templates: { otp: "", approveOtp: "", welcome: "", payslip: "", pensionSlip: "", alert: "" },
  },
  email: {
    fromName: "Delhi Cantonment Board",
    fromAddress: "",
    smtpHost: "",
    smtpPort: 587,
    secure: false,
    userEnv: "SMTP_USER",
    passwordEnv: "SMTP_PASSWORD",
  },
  bank: { name: "", format: "GENERIC_CSV", debitAccountLast4: "", ifsc: "" },
  // PRD §6: each section locks its month by the 25th.
  general: { attendanceLockDay: 25 },
  // Central government office hours in Delhi; to confirm for DCB (PRD §18).
  attendance: { officeStart: "09:00", graceMinutes: 15, halfDayMinutes: 240, weeklyOff: [0, 6], devices: [] },
  statutory: {
    deductorName: "Delhi Cantonment Board",
    address: "Sadar Bazar, Delhi Cantonment, New Delhi 110010",
    tan: "",
    pan: "",
    responsibleName: "",
    responsibleDesignation: "Chief Executive Officer",
    ddoRegNo: "",
    epfCode: "",
    esicCode: "",
    metroHra: true,
    // PRD §9: not levied in Delhi. Slabs are an example (Maharashtra) for a Board that switches it on.
    professionalTax: false,
    ptSlabs: [
      { upTo: 7500, amount: 0 },
      { upTo: 10000, amount: 175 },
      { upTo: null, amount: 200 },
    ],
  },
};
