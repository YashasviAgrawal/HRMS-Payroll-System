import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Module 10 — Admin opens a report, filters it and downloads it as Excel and PDF (S-70, §11)", async ({ page }) => {
  await signIn(page, { as: "Admin", id: "DCB10002" });
  await page.getByRole("navigation", { name: "Menu" }).first().getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  for (const area of ["Employees", "Attendance and leave", "Payroll", "Statutory and tax", "Pension", "Control"]) await expect(page.getByRole("heading", { name: area, exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/reports/"]')).toHaveCount(25);

  await page.getByRole("link", { name: /Salary register/ }).click();
  await expect(page.getByRole("heading", { name: "11. Salary register" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Total", exact: true })).toBeVisible();
  await expect(page.getByText(/^\d+ rows$/)).toBeVisible();

  // One section only: the URL carries the filter and the downloads follow it.
  await page.getByRole("combobox", { name: "Section" }).selectOption({ label: "Accounts" });
  await page.getByRole("button", { name: "Show" }).click();
  await page.waitForURL(/section=/);
  await expect(page.getByRole("cell", { name: "Mohit Gupta" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Anil Sharma" })).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Excel" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Report-11-salary-register-\d{4}-\d{2}\.xlsx$/);
  const pdf = await page.request.get((await page.getByRole("link", { name: "PDF" }).getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // The download is in the audit trail.
  await page.goto("/admin/audit?q=salary-register");
  await expect(page.getByText(/Downloaded report 11 \(salary-register\) as Excel/).first()).toBeVisible();
});

test("Module 10 — the Admin dashboard shows cost, headcount by type, retirements and due dates (§11)", async ({ page }) => {
  await signIn(page, { as: "Admin", id: "DCB10002" });
  await page.goto("/home");
  for (const tile of ["Salary cost (with Board's share)", "Pension bill", "Retiring in 6 months", "Pay groups approved this month"]) await expect(page.getByText(tile, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Headcount by type" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Retirements ahead" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Statutory due dates" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Rekha Sharma/ })).toBeVisible();
});

test("Module 10 — a reporting officer's reports cover their own section only (§14)", async ({ page }) => {
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10008" });
  await page.goto("/reports");
  await expect(page.getByRole("link", { name: /Monthly attendance register/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Salary register/ })).toHaveCount(0);
  await page.goto("/reports/attendance-register?section=elsewhere");
  await expect(page.getByText("You see your own section only.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Section" })).toBeDisabled();
  await expect(page.getByRole("cell", { name: "Health and Sanitation" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Accounts", exact: true })).toHaveCount(0);
  await page.goto("/reports/salary-register");
  await expect(page.getByText("Your login does not include this screen.", { exact: false })).toBeVisible();
});
