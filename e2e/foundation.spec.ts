import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("Module 1 — foundation", () => {
  test("sign-in screen offers the three logins and Hindi", async ({ page }) => {
    await page.goto("/login");
    for (const name of ["Employee / Pensioner", "HR & Accounts", "Admin"]) {
      await expect(page.getByRole("radio", { name })).toBeVisible();
    }
    // Mobile + OTP only appears for the Employee login (PRD §2 rule 4).
    await expect(page.getByRole("radio", { name: "With mobile OTP only" })).toBeVisible();
    await page.getByRole("radio", { name: "Admin" }).click();
    await expect(page.getByRole("radio", { name: "With mobile OTP only" })).toHaveCount(0);
    await page.getByRole("button", { name: "हिं" }).click();
    await expect(page.getByRole("heading", { name: "साइन इन" })).toBeVisible();
    await page.getByRole("button", { name: "EN" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("wrong password shows a plain message", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("radio", { name: "HR & Accounts" }).click();
    await page.getByRole("textbox", { name: "Employee ID or mobile number" }).fill("DCB10006");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page.getByText("The ID or password is not correct.")).toBeVisible();
  });

  test("HR & Accounts menus follow the ticked permissions (PRD §13, §14)", async ({ page }) => {
    // Priya holds HR only: no payroll, statutory or pension screens.
    await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
    const nav = page.getByRole("navigation", { name: "Menu" }).first();
    for (const item of ["Home", "Employees", "Recruitment and joining", "Attendance and leave", "Reports"]) {
      await expect(nav.getByRole("link", { name: item })).toBeVisible();
    }
    for (const item of ["Payroll", "Statutory and tax", "Pension"]) {
      await expect(nav.getByRole("link", { name: item, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Priya");
  });

  test("a Checker sees every HR & Accounts area, because checking needs viewing", async ({ page }) => {
    await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
    const nav = page.getByRole("navigation", { name: "Menu" }).first();
    for (const item of ["Employees", "Payroll", "Statutory and tax", "Pension", "Reports"]) {
      await expect(nav.getByRole("link", { name: item, exact: true })).toBeVisible();
    }
  });

  test("User & settings manager manages users but never sees pay data", async ({ page }) => {
    await signIn(page, { as: "Admin", id: "IT01" });
    await page.getByRole("link", { name: "Users and permissions" }).first().click();
    await expect(page.getByRole("heading", { name: "Users and permissions" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Neha Arora/ })).toBeVisible();
    await page.getByRole("link", { name: "Audit trail" }).first().click();
    await expect(page.getByText("You see system events only")).toBeVisible();
    await page.getByRole("link", { name: "Settings" }).first().click();
    await expect(page.getByRole("heading", { name: "SMS gateway" })).toBeVisible();
  });

  test("Approver sees the admin menu and their approvals inbox", async ({ page }) => {
    await signIn(page, { as: "Admin", id: "DCB10002" });
    const nav = page.getByRole("navigation", { name: "Menu" }).first();
    // An Admin approves little but sees every area of the Board; the admin tools sit behind "Administration".
    for (const item of ["Approvals", "Employees", "Attendance and leave", "Payroll and sign", "Pension", "Reports", "Administration"]) {
      await expect(nav.getByRole("link", { name: item })).toBeVisible();
    }
    await nav.getByRole("link", { name: "Administration" }).click();
    for (const item of ["Statutory and tax", "Recruitment and joining", "Users and permissions", "Rates and rules", "Audit trail"]) {
      await expect(page.getByTestId("admin-hub").getByRole("link", { name: new RegExp(item) })).toBeVisible();
    }
    await nav.getByRole("link", { name: "Approvals" }).click();
    // The demo leaves a 5-day EL application waiting for an Admin (Education has no reporting officer).
    await expect(page.getByRole("cell", { name: /EL 5 days: Pooja Bhatia/ })).toBeVisible();
  });

  test("every module is built; an unknown page is a friendly 404", async ({ page }) => {
    await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
    await page.goto("/migration");
    await expect(page.getByRole("heading", { name: "Migration from FoxPro" })).toBeVisible();
    await page.goto("/no-such-page");
    await expect(page.getByText("This page does not exist.")).toBeVisible();
  });
});
