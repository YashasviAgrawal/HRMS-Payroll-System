import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("employee signs in on a phone with mobile + OTP only", async ({ page }) => {
  await signIn(page, { as: "Employee / Pensioner", id: "9810000010", otpOnly: true });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Suresh");
  // Bottom bar keeps payslips one tap away (PRD §1: 2 taps to the last payslip).
  const bottom = page.getByRole("navigation", { name: "Menu" }).last();
  await expect(bottom.getByRole("link", { name: "Payslips and Form 16" })).toBeVisible();
});
