import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSetting } from "@/modules/settings/service";

/**
 * SMS gateway — the only live connection in Release 1, because OTP needs it (PRD §12).
 * Message texts must match the templates registered on the DLT platform, so they live here in one place.
 */
export type SmsTemplate = "otp" | "approveOtp" | "welcome" | "alert" | "payslip" | "pensionSlip" | "lifeCertificate";

const TEXTS: Record<SmsTemplate, { en: string; hi: string }> = {
  otp: {
    en: "{otp} is your OTP to sign in to DCB HRMS. It is valid for 5 minutes. Do not share it with anyone. - Delhi Cantonment Board",
    hi: "डीसीबी एचआरएमएस में साइन इन के लिए आपका ओटीपी {otp} है। यह 5 मिनट तक मान्य है। इसे किसी को न बताएँ। - दिल्ली छावनी परिषद",
  },
  approveOtp: {
    en: "{otp} is your OTP to approve {what} in DCB HRMS. Valid for 5 minutes. Do not share it. - Delhi Cantonment Board",
    hi: "डीसीबी एचआरएमएस में {what} स्वीकृत करने के लिए आपका ओटीपी {otp} है। 5 मिनट तक मान्य। किसी को न बताएँ। - दिल्ली छावनी परिषद",
  },
  welcome: {
    en: "Welcome to DCB HRMS. Sign in at {url} with your mobile number and OTP. - Delhi Cantonment Board",
    hi: "डीसीबी एचआरएमएस में आपका स्वागत है। {url} पर अपने मोबाइल नंबर और ओटीपी से साइन इन करें। - दिल्ली छावनी परिषद",
  },
  payslip: {
    en: "Your salary slip for {month} is ready. Net pay Rs {net} sent to your bank account. See it at {url} - Delhi Cantonment Board",
    hi: "{month} की आपकी वेतन पर्ची तैयार है। शुद्ध वेतन रु {net} आपके बैंक खाते में भेजा गया। यहाँ देखें: {url} - दिल्ली छावनी परिषद",
  },
  pensionSlip: {
    en: "Your pension for {month} is paid. Net pension Rs {net} sent to your bank account. See the slip at {url} - Delhi Cantonment Board",
    hi: "{month} की आपकी पेंशन का भुगतान हो गया। शुद्ध पेंशन रु {net} आपके बैंक खाते में भेजी गई। पर्ची यहाँ देखें: {url} - दिल्ली छावनी परिषद",
  },
  lifeCertificate: {
    en: "Please give your life certificate by {date} through Jeevan Pramaan or at the Board office so that your pension continues. PPO {ppo}. - Delhi Cantonment Board",
    hi: "पेंशन जारी रखने के लिए कृपया {date} तक जीवन प्रमाण या परिषद कार्यालय में अपना जीवन प्रमाण पत्र दें। पीपीओ {ppo}। - दिल्ली छावनी परिषद",
  },
  alert: {
    en: "{text} - Delhi Cantonment Board",
    hi: "{text} - दिल्ली छावनी परिषद",
  },
};

function render(text: string, vars: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export interface SmsResult {
  ok: boolean;
  ref?: string;
  error?: string;
}

/**
 * Sends one SMS and records it in MessageLog with any OTP blanked out. Never throws: callers decide
 * whether a failure matters (it does for OTP; it never blocks payroll).
 */
export async function sendSms(
  boardId: string,
  to: string,
  template: SmsTemplate,
  vars: Record<string, string>,
  lang: "en" | "hi" = "en",
): Promise<SmsResult> {
  const text = render(TEXTS[template][lang], vars);
  const redacted = vars.otp ? text.split(vars.otp).join("******") : text;
  let result: SmsResult;
  try {
    const cfg = await getSetting(boardId, "sms");
    if (env().SMS_PROVIDER === "console" || cfg.provider === "console") {
      console.info(`[sms] to ${to.slice(-4).padStart(10, "*")}: ${text}`);
      result = { ok: true, ref: "console" };
    } else {
      const apiKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] ?? "" : "";
      const values: Record<string, string> = {
        to: `91${to}`,
        text,
        templateId: cfg.templates[template] ?? "",
        senderId: cfg.senderId,
        entityId: cfg.dltEntityId,
        apiKey,
      };
      const url = cfg.url.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(values[k] ?? ""));
      const res = await fetch(url, { method: cfg.method, signal: AbortSignal.timeout(10_000) });
      const body = (await res.text()).slice(0, 200);
      result = res.ok ? { ok: true, ref: body } : { ok: false, error: `HTTP ${res.status}: ${body}` };
    }
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await db.messageLog.create({
    data: {
      boardId,
      channel: "SMS",
      recipient: to,
      template,
      body: redacted,
      status: result.ok ? "SENT" : "FAILED",
      providerRef: result.ref ?? null,
      error: result.error ?? null,
    },
  });
  return result;
}
