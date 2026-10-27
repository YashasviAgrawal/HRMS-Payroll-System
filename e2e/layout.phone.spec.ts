import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/** On a phone nothing may push the page sideways; wide tables scroll inside their own card. */
async function expectNoSidewaysScroll(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, `${path} is ${scrollWidth}px wide on a ${clientWidth}px screen`).toBeLessThanOrEqual(clientWidth);
}

test("HR screens fit a phone screen", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10007" });
  for (const path of ["/home", "/employees", "/employees/posts", "/employees/requests", "/recruitment", "/recruitment?tab=joining", "/recruitment?tab=probation", "/recruitment?tab=files", "/recruitment/vacancies/new", "/attendance", "/attendance?tab=register", "/attendance?tab=lock", "/attendance?tab=requests", "/attendance?tab=import", "/attendance/holidays", "/leave/manage", "/leave/manage?tab=balances", "/leave/manage?tab=enter", "/leave/manage?tab=opening", "/leave/manage?tab=rules", "/approvals", "/profile"]) {
    await expectNoSidewaysScroll(page, path);
  }
  await page.goto("/recruitment");
  await page.getByText("DCB/REC/2026/001").first().click();
  await page.waitForURL("**/recruitment/vacancies/**");
  await expectNoSidewaysScroll(page, new URL(page.url()).pathname);
});

test("employee screens fit a phone screen", async ({ page }) => {
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10014" });
  for (const path of ["/home", "/my/record", "/my/requests", "/my/attendance", "/my/payslips", "/my/tax", "/my/funds", "/leave", "/leave/apply", "/leave/ledger/me", "/profile"]) {
    await expectNoSidewaysScroll(page, path);
  }
});

test("reporting officer screens fit a phone screen", async ({ page }) => {
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10008" });
  for (const path of ["/my/team", "/my/team/attendance", "/my/team/leave", "/my/funds"]) {
    await expectNoSidewaysScroll(page, path);
  }
});

test("payroll screens fit a phone screen", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  for (const path of ["/payroll", "/payroll/items", "/payroll/increments", "/payroll/increments?tab=fixation", "/payroll/arrears", "/payroll/loans", "/payroll/payslips", "/admin/rates", "/admin/rates?tab=heads", "/admin/rates?tab=matrix"]) {
    await expectNoSidewaysScroll(page, path);
  }
  // A closed month from the demo history: every tab and one pay sheet.
  const overview = (await (await page.request.get("/api/v1/payroll/runs")).json()).data as { history: { id: string; payGroup: string }[] };
  const run = `/payroll/${overview.history.find((r) => r.payGroup === "NPS")!.id}`;
  for (const tab of ["people", "sections", "heads", "prints", "exceptions"]) await expectNoSidewaysScroll(page, `${run}?tab=${tab}`);
  await page.goto(`${run}?tab=people`);
  await page.getByRole("link", { name: "Priya Singh" }).first().click();
  await page.waitForURL(/\/people\//);
  await expectNoSidewaysScroll(page, new URL(page.url()).pathname);
  await page.goto("/payroll/items");
  await page.getByRole("combobox", { name: "Employee" }).selectOption({ label: "DCB10002 · Sunita Verma" });
  await page.waitForURL(/employee=/);
  await expectNoSidewaysScroll(page, new URL(page.url()).pathname + new URL(page.url()).search);
});

test("statutory screens fit a phone screen", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  for (const path of ["/statutory", "/statutory/files", "/statutory/tds", "/statutory/declarations", "/statutory/form16", "/statutory/funds", "/statutory/funds?view=nps", "/admin/rates?tab=tax", "/admin/rates?tab=dues"]) {
    await expectNoSidewaysScroll(page, path);
  }
  await page.goto("/statutory/declarations");
  await page.getByRole("link", { name: "Dr. Alok Mishra" }).click();
  await page.waitForURL(/\/statutory\/declarations\/.+/);
  await expectNoSidewaysScroll(page, new URL(page.url()).pathname);
  await page.goto("/statutory/funds");
  await page.getByRole("link", { name: "Rajesh Kumar" }).click();
  await page.waitForURL(/\/statutory\/funds\/.+/);
  await expectNoSidewaysScroll(page, new URL(page.url()).pathname);
});

test("pension screens fit a phone screen", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10005" });
  for (const path of ["/pension", "/pension/pensioners", "/pension/pensioners/new", "/pension/life-certificates", "/pension/cases", "/pension/cases/new", "/pension/arrears", "/admin/rates?tab=pension"]) {
    await expectNoSidewaysScroll(page, path);
  }
  await page.goto("/pension/pensioners");
  await page.getByRole("link", { name: "Dharam Pal" }).click();
  await page.waitForURL(/\/pension\/pensioners\/(?!new).+/);
  await expectNoSidewaysScroll(page, new URL(page.url()).pathname);
  await page.goto("/pension");
  await page.getByRole("link", { name: /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/ }).first().click();
  await page.waitForURL(/\/pension\/bills\/.+/);
  await expectNoSidewaysScroll(page, `${new URL(page.url()).pathname}?tab=people`);
});

test("pensioner screens fit a phone screen", async ({ page }) => {
  await signIn(page, { as: "Employee / Pensioner", id: "DCB09001" });
  for (const path of ["/home", "/my/pension-slips", "/my/life-certificate", "/my/record", "/profile"]) {
    await expectNoSidewaysScroll(page, path);
  }
});

test("report screens and the Admin dashboard fit a phone screen", async ({ page }) => {
  await signIn(page, { as: "Admin", id: "DCB10002" });
  for (const path of ["/home", "/reports", "/reports/employee-list", "/reports/headcount", "/reports/attendance-register", "/reports/salary-register", "/reports/pay-bill", "/reports/month-change", "/reports/loans", "/reports/gpf-ledger", "/reports/tds-24q", "/reports/pension-register", "/reports/ghost-check"]) {
    await expectNoSidewaysScroll(page, path);
  }
});
