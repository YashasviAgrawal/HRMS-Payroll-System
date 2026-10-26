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
  for (const path of ["/home", "/employees", "/employees/posts", "/employees/requests", "/recruitment", "/recruitment?tab=joining", "/recruitment?tab=probation", "/recruitment?tab=files", "/recruitment/vacancies/new", "/approvals", "/profile"]) {
    await expectNoSidewaysScroll(page, path);
  }
  await page.goto("/recruitment");
  await page.getByText("DCB/REC/2026/001").first().click();
  await page.waitForURL("**/recruitment/vacancies/**");
  await expectNoSidewaysScroll(page, new URL(page.url()).pathname);
});

test("employee screens fit a phone screen", async ({ page }) => {
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10014" });
  for (const path of ["/home", "/my/record", "/my/requests", "/profile"]) {
    await expectNoSidewaysScroll(page, path);
  }
});
