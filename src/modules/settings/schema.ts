import { z } from "zod";

/**
 * Board settings (S-82). Secrets — gateway keys, SMTP passwords, portal passwords — are never stored:
 * a setting may only name the environment variable that holds them (PRD §12 rule 7).
 */
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
};
