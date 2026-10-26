import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "Dcb@2026";

/** Signs in through the real screen: login type, ID + password, then the OTP shown in dev mode. */
export async function signIn(page: Page, opts: { as: "Employee / Pensioner" | "HR & Accounts" | "Admin"; id: string; otpOnly?: boolean }) {
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
}

export async function signOut(page: Page) {
  await page.request.post("/api/v1/auth/logout", { headers: { origin: new URL(page.url()).origin } });
}
