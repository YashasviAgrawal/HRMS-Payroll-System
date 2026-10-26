import "server-only";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSetting } from "@/modules/settings/service";

/**
 * Email through the Board's SMTP server (S-82 settings; the user name and password come from the environment variables
 * the settings name, never from the database — PRD §12 rule 7). With no SMTP host set, or in console mode, the message
 * is only logged. Every message is recorded in MessageLog. Never throws: a failed email never blocks payroll.
 */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export async function sendEmail(boardId: string, to: string, subject: string, text: string, attachments: EmailAttachment[] = [], template = "email"): Promise<{ ok: boolean; error?: string }> {
  let result: { ok: boolean; ref?: string; error?: string };
  try {
    const cfg = await getSetting(boardId, "email");
    if (!cfg.smtpHost || env().SMS_PROVIDER === "console") {
      console.info(`[email] to ${to.replace(/^(.{2}).*(@.*)$/, "$1***$2")}: ${subject} (${attachments.length} attachment(s))`);
      result = { ok: true, ref: "console" };
    } else {
      const transport = nodemailer.createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort,
        secure: cfg.secure,
        auth: cfg.userEnv ? { user: process.env[cfg.userEnv] ?? "", pass: process.env[cfg.passwordEnv] ?? "" } : undefined,
      });
      const info = await transport.sendMail({ from: { name: cfg.fromName, address: cfg.fromAddress }, to, subject, text, attachments });
      result = { ok: true, ref: info.messageId };
    }
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await db.messageLog.create({
    data: { boardId, channel: "EMAIL", recipient: to, template, body: `${subject}\n\n${text}`.slice(0, 2000), status: result.ok ? "SENT" : "FAILED", providerRef: result.ref ?? null, error: result.error ?? null },
  });
  return result;
}
