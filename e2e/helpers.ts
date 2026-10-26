import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "Dcb@2026";

/**
 * Sessions saved per login for the rest of the run. The app allows 5 OTPs per login in 10 minutes (a security
 * rule we keep), so after the first real sign-in a login reuses its session cookie. Cleared by global setup.
 */
export const SESSION_DIR = path.join(__dirname, "..", "test-results", ".sessions");

const sessionFile = (opts: { as: string; id: string }) => path.join(SESSION_DIR, `${opts.as.replace(/\W+/g, "_")}-${opts.id}.json`);

/**
 * Signs in through the real screen: login type, ID + password, then the OTP shown in dev mode.
 * `fresh: true` always goes through the screen (for checks about signing in itself).
 */
export async function signIn(page: Page, opts: { as: "Employee / Pensioner" | "HR & Accounts" | "Admin"; id: string; otpOnly?: boolean; fresh?: boolean }) {
  const file = sessionFile(opts);
  if (!opts.fresh && fs.existsSync(file)) {
    await page.context().clearCookies();
    await page.context().addCookies(JSON.parse(fs.readFileSync(file, "utf8")));
    await page.goto("/home");
    if (new URL(page.url()).pathname === "/home") return;
  }
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("radio", { name: opts.as }).click();
  if (opts.otpOnly) {
    await page.getByRole("radio", { name: "With mobile OTP only" }).click();
    await page.getByRole("textbox", { name: "Mobile number" }).fill(opts.id);
  } else {
    await page.getByRole("textbox", { name: "Employee ID or mobile number" }).fill(opts.id);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(DEMO_PASSWORD);
  }
  await page.getByRole("button", { name: "Send OTP" }).click();
  const devOtp = page.getByTestId("dev-otp");
  await expect(devOtp).toBeVisible();
  const otp = (await devOtp.textContent())!.match(/\d{6}/)![0];
  await page.getByRole("group", { name: "6-digit OTP" }).getByRole("textbox").first().fill(otp);
  await page.waitForURL("**/home");
  // Keep only the session cookie: a language choice made in one test must not leak into the next.
  const session = (await page.context().cookies()).filter((c) => c.name === "dcb_session");
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(session));
}

/** Leaves the browser signed out. The saved session stays valid for the next test that signs in as that login. */
export async function signOut(page: Page) {
  await page.context().clearCookies();
}

/** Opens a task from the Approvals inbox and approves it (the screen asks to confirm). */
export async function approveTask(page: Page, title: RegExp) {
  await page.goto("/approvals");
  await page.getByRole("cell", { name: title }).first().click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL("**/approvals");
}
