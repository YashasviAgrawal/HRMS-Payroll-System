import { expect, test } from "@playwright/test";
import { approveTask, signIn, signOut } from "./helpers";

const monthName = (offset: number) => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1 + offset, 1)));
};

test("Module 9 — the month's pension bill; a Jeevan Pramaan upload is checked and the held months are paid with the next bill (PN-02, PN-06)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10005" });
  await page.goto("/pension");
  await expect(page.getByRole("heading", { name: "Pension", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Work out the pension bill" }).click();
  await page.waitForURL(/\/pension\/bills\/[^/?]+/);
  await expect(page.getByRole("heading", { name: `Pension bill ${monthName(0)}` })).toBeVisible();
  // The certificate three years old: the system held the pension and says why.
  await page.getByRole("link", { name: /^Exceptions/ }).click();
  await expect(page.getByText("Life certificate overdue")).toBeVisible();
  await expect(page.getByText(/Pay withheld — System/)).toBeVisible();
  await page.getByRole("link", { name: /^People/ }).click();
  await expect(page.getByRole("row", { name: /Dharam Pal/ })).toContainText("Withheld");
  await expect(page.getByRole("row", { name: /Kamla Devi/ })).toContainText("DCB/PPO/2012/0031");

  // The Jeevan Pramaan upload waiting in the Pension clerk's approvals.
  await approveTask(page, /Life certificate from Dharam Pal/);
  await page.goto("/pension/life-certificates?lc=HELD");
  await expect(page.getByText("Nobody in this list.")).toBeVisible();

  await page.goto("/pension");
  await page.getByTestId("pension-bill").getByRole("link", { name: "Open" }).click();
  await page.getByRole("button", { name: "Work out again" }).click();
  await expect(page.getByText("Pension bill worked out.")).toBeVisible();
  await page.getByRole("link", { name: /^People/ }).click();
  const row = page.getByRole("row", { name: /Dharam Pal/ });
  await expect(row).not.toContainText("Withheld");
  await row.getByRole("link", { name: "Dharam Pal" }).click();
  await expect(page.getByTestId("catch-up")).toContainText(monthName(-2));
  await expect(page.getByTestId("catch-up")).toContainText(monthName(-1));
});

test("Module 9 — a retirement case: calculator, no-dues, Checker then Admin, PPO and the benefits bill (PN-07 to PN-10)", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, { as: "HR & Accounts", id: "DCB10005" });
  await page.goto("/pension/cases");
  await expect(page.getByTestId("retirement-alerts").getByRole("row", { name: /Rekha Sharma/ })).toContainText("6 months");
  await page.getByTestId("retirement-alerts").getByRole("row", { name: /Rekha Sharma/ }).getByRole("link", { name: "Start case" }).click();
  await page.waitForURL(/\/pension\/cases\/new/);
  await page.getByRole("button", { name: "Work out the case" }).click();
  await page.waitForURL(/\/pension\/cases\/(?!new)[^/?]+$/);
  await expect(page.getByTestId("case-tiles")).toContainText("Pension a month");
  await expect(page.getByTestId("case-working")).toContainText(/six-monthly periods/);
  await expect(page.getByTestId("case-working")).toContainText("Commutation");

  // Every section answers the no-dues checklist; one has dues.
  const noDues = page.getByTestId("no-dues");
  const sections = await noDues.getByText("Waiting", { exact: true }).count();
  await noDues.getByRole("button", { name: "Dues…" }).first().click();
  await page.getByLabel(/^Amount due/).fill("2500");
  await page.getByLabel(/^What for/).fill("Library books not returned");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(noDues.getByText("Waiting", { exact: true })).toHaveCount(sections - 1);
  await expect(noDues.getByRole("row").filter({ hasText: "Library books not returned" })).toContainText("₹2,500");
  for (let left = await noDues.getByText("Waiting", { exact: true }).count(); left > 0; left--) {
    await noDues.getByRole("row").filter({ hasText: "Waiting" }).first().getByRole("button", { name: "Nothing due" }).click();
    await expect(noDues.getByText("Waiting", { exact: true })).toHaveCount(left - 1);
  }
  await page.getByRole("button", { name: "Send to Checker" }).click();
  await expect(page.getByText("Waiting for a Checker.")).toBeVisible();
  const caseUrl = page.url();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Pension case — Rekha Sharma/);
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /Pension case — Rekha Sharma/);
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10005" });
  await page.goto(caseUrl);
  await expect(page.getByText(/Approved — PPO DCB\/PPO\/\d{4}\/\d{4}/)).toBeVisible();
  const ppo = await page.request.get((await page.getByRole("link", { name: "PPO (PDF)" }).getAttribute("href"))!);
  expect(ppo.headers()["content-type"]).toBe("application/pdf");
  await page.getByRole("button", { name: "Make the benefits bill" }).click();
  await page.waitForURL(/\/pension\/bills\/[^/?]+/);
  await expect(page.getByRole("heading", { name: /Retirement benefits — Rekha Sharma/ })).toBeVisible();
  await page.getByRole("link", { name: /^People/ }).click();
  await page.getByRole("link", { name: "Rekha Sharma" }).click();
  await expect(page.getByText("Gratuity").first()).toBeVisible();
  // The library dues come off the benefits.
  await expect(page.getByText("Overpayment recovery")).toBeVisible();
  await expect(page.getByText("₹2,500").first()).toBeVisible();
});

test("Module 9 — a family pensioner signs in with mobile and OTP and sees pension slips and the life certificate, in her language (PN-12)", async ({ page }) => {
  // Kamla Devi chose Hindi: the screens open in Hindi.
  await signIn(page, { as: "Employee / Pensioner", id: "9810000202", otpOnly: true });
  const menu = page.getByRole("navigation", { name: "मेनू" });
  await expect(menu.getByRole("link", { name: "पेंशन पर्ची" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "जीवन प्रमाण पत्र" })).toBeVisible();
  await expect(menu.getByRole("link")).toHaveCount(4);
  await page.goto("/my/pension-slips");
  await expect(page.getByRole("heading", { name: "मेरी पेंशन पर्चियाँ" })).toBeVisible();
  // 9,000 + 20% additional pension at 80 + 60% DR on both + 1,000 medical allowance.
  await expect(page.getByTestId("my-pension-slips")).toContainText("₹18,280");
  const pdf = await page.request.get((await page.getByTestId("my-pension-slips").getByRole("link").first().getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await page.goto("/my/life-certificate");
  await expect(page.getByRole("heading", { name: "मेरा जीवन प्रमाण पत्र" })).toBeVisible();
  await expect(page.getByTestId("lc-status")).toContainText("2026");
  await page.goto("/my/record");
  await expect(page.getByRole("heading", { name: "मेरा पेंशन अभिलेख" })).toBeVisible();
  await expect(page.getByText("DCB/PPO/2012/0031").first()).toBeVisible();
  // Other pensioners' records are not hers to see.
  const other = await page.request.get("/api/v1/pension/pensioners");
  expect(other.status()).toBe(403);
});
