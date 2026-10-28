import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * PRD §16: GIGW 3.0 and WCAG 2.1 AA, text readable at 200% zoom, works on low-end phones.
 * Every screen below is checked with axe for the WCAG 2.1 A and AA rules, and the browser must not
 * report a single Content Security Policy violation while it renders.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const w = window as unknown as { __csp?: string[] };
      (w.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

async function expectAccessible(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const found = violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(found, `${path} has accessibility problems`).toEqual([]);
  const csp = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  expect(csp, `${path} broke the Content Security Policy`).toEqual([]);
}

test("the sign-in screen meets WCAG 2.1 AA", async ({ page }) => {
  await watchCsp(page);
  await expectAccessible(page, "/login");
});

test("HR screens meet WCAG 2.1 AA", async ({ page }) => {
  test.setTimeout(180_000);
  await watchCsp(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10007" });
  for (const path of ["/home", "/employees", "/employees/posts", "/employees/new", "/recruitment", "/attendance", "/attendance?tab=register", "/attendance?tab=lock", "/leave/manage", "/leave/manage?tab=balances", "/approvals", "/reports", "/reports/headcount", "/migration", "/migration?tab=files", "/employees/service-books", "/employees/exits"]) {
    await expectAccessible(page, path);
  }
  // Rows open with a real link in their first cell, so screen readers announce them (WCAG 4.1.2) and the
  // keyboard reaches them (2.1.1).
  await page.goto("/employees");
  await page.getByRole("link", { name: /Rajesh Kumar/ }).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/employees\/c/);
  await expectAccessible(page, new URL(page.url()).pathname);
});

test("payroll, statutory and pension screens meet WCAG 2.1 AA", async ({ page }) => {
  test.setTimeout(180_000);
  await watchCsp(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  for (const path of ["/payroll", "/payroll/items", "/payroll/increments", "/payroll/loans", "/payroll/payslips", "/admin/rates", "/admin/rates?tab=matrix", "/admin/rates?tab=daTa", "/statutory", "/statutory/tds", "/statutory/declarations", "/reports/pay-bill"]) {
    await expectAccessible(page, path);
  }
  // A leaver's full and final settlement, with the statement and the clerk's entries (client add-on).
  await page.goto("/employees/exits");
  await page.getByRole("link", { name: /Vikas Malhotra/ }).click();
  await page.waitForURL(/\/employees\/exits\/c/);
  await expectAccessible(page, new URL(page.url()).pathname);
  const overview = (await (await page.request.get("/api/v1/payroll/runs")).json()).data as { history: { id: string; payGroup: string }[] };
  await expectAccessible(page, `/payroll/${overview.history.find((r) => r.payGroup === "NPS")!.id}?tab=people`);
  await signIn(page, { as: "HR & Accounts", id: "DCB10005" });
  for (const path of ["/pension", "/pension/pensioners", "/pension/life-certificates", "/pension/cases/new"]) {
    await expectAccessible(page, path);
  }
});

test("employee self-service and Admin screens meet WCAG 2.1 AA", async ({ page }) => {
  test.setTimeout(180_000);
  await watchCsp(page);
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10014" });
  for (const path of ["/home", "/my/record", "/my/requests", "/my/attendance", "/my/payslips", "/my/tax", "/leave", "/leave/apply", "/profile"]) {
    await expectAccessible(page, path);
  }
  await signIn(page, { as: "Admin", id: "DCB10002" });
  for (const path of ["/home", "/admin", "/employees", "/admin/users", "/admin/settings", "/admin/audit"]) {
    await expectAccessible(page, path);
  }
});

test.describe("at 320 px wide (WCAG 1.4.10 reflow; 1280 px at 400% zoom)", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  test("no screen scrolls sideways", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, { as: "HR & Accounts", id: "DCB10007" });
    for (const path of ["/home", "/employees", "/attendance", "/attendance?tab=lock", "/leave/manage", "/approvals", "/reports", "/migration", "/migration?tab=files", "/migration?tab=map&target=employees"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(scrollWidth, `${path} is ${scrollWidth}px wide on a ${clientWidth}px screen`).toBeLessThanOrEqual(clientWidth);
    }
  });
});
