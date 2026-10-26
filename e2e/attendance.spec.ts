import { expect, test, type Page } from "@playwright/test";
import { approveTask, signIn, signOut } from "./helpers";

/** Today's date in India, as the app sees it. */
const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => iso.split("-").reverse().join("-");

async function noSidewaysScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);
}

test("Module 4 — HR checks a punch file before saving it (AT-01)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/attendance?tab=import");
  await page.getByRole("combobox", { name: "File format" }).selectOption({ label: "Board template (Biometric ID, Date, Time)" });
  const today = dmy(todayIST());
  const csv = ["Biometric ID,Date,Time", `10003,${today},00:02`, `10007,${today},00:03`, `99999,${today},00:04`, "10003,nonsense,09:00"].join("\n");
  await page.getByLabel("Punch file").setInputFiles({ name: "gate-device.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByTestId("ready-count")).toHaveText("2");
  await expect(page.getByText("Unknown biometric IDs").first()).toBeVisible();
  await expect(page.getByText("Date not understood")).toBeVisible();
  await page.getByRole("button", { name: "Save 2 new punches" }).click();
  await expect(page.getByText("2 punches saved.")).toBeVisible();
  await expect(page.getByRole("cell", { name: /gate-device\.csv/ })).toBeVisible();
});

test("Module 4 — correction request, officer's decision and the month lock (AT-04, AT-05)", async ({ page }) => {
  test.setTimeout(120_000);
  // The employee asks for yesterday to be marked on duty.
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10010" });
  await page.goto("/my/attendance");
  await page.locator(`button[data-date="${todayIST()}"]`).click();
  await page.getByRole("button", { name: "Ask for a correction" }).click();
  await page.getByLabel("Date").fill(addDays(todayIST(), -1));
  await page.getByRole("radio", { name: "I was on official duty outside the office" }).click();
  await page.getByLabel("Reason").fill("Fogging drive in Sadar Bazar with the health team");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Request sent to your reporting officer.")).toBeVisible();
  await signOut(page);

  // Rajesh, the section's reporting officer, approves both requests from his section.
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10008" });
  await approveTask(page, /On duty: Suresh Pal/);
  await approveTask(page, /Missed punch: Suresh Pal/);

  // Then decides last month's unexplained days and locks it.
  await page.goto("/my/team/attendance");
  await page.getByRole("link", { name: "Review and lock" }).first().click();
  await expect(page.getByRole("heading", { name: "Lock attendance" })).toBeVisible();
  await expect(page.getByText("Nothing is blocking the lock.")).toBeVisible();
  await page.getByRole("combobox", { name: "Set every day to" }).selectOption({ label: "Mark present" });
  await expect(page.getByText(/^(\d+) of \1 decided$/)).toBeVisible();
  const lock = page.getByRole("button", { name: /^Lock / }).first();
  await lock.click();
  await page.getByRole("dialog").getByRole("button", { name: /^Lock / }).click();
  await expect(page.getByText("Month locked.")).toBeVisible();
  await page.waitForURL("**/my/team/attendance**");
  await expect(page.getByRole("link", { name: "Review and lock" })).toHaveCount(0);
});

test("Module 4 — HR corrects the muster roll and a Checker checks it (AT-02)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/attendance?tab=register");
  await page.getByRole("combobox", { name: "Section" }).selectOption({ label: "Horticulture" });
  await page.waitForURL(/section=/);
  await noSidewaysScroll(page);
  await page.getByRole("button", { name: "Correct entries" }).click();
  const unmarked = page.locator('td[data-status="UNMARKED"] button');
  const cell = (await unmarked.count()) ? unmarked.first() : page.locator('td[data-status="PRESENT"] button').first();
  await cell.click();
  await page.getByRole("dialog").getByRole("button", { name: "On duty" }).click();
  await page.getByRole("button", { name: "Send 1 changes for check" }).click();
  await expect(page.getByText("Sent to the Checker.")).toBeVisible();
  await expect(page.getByText(/waiting for a Checker/).first()).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Attendance entries: Horticulture/);
  await page.goto("/attendance?tab=register");
  await page.getByRole("combobox", { name: "Section" }).selectOption({ label: "Horticulture" });
  await page.waitForURL(/section=/);
  await expect(page.locator('td[data-status="ON_DUTY"]').first()).toBeVisible();
});

test("Module 4 — next year's holiday calendar goes to a Checker (AT-08)", async ({ page }) => {
  const next = Number(todayIST().slice(0, 4)) + 1;
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto(`/attendance/holidays?year=${next}`);
  await expect(page.getByText(`No holidays are set for ${next} yet.`)).toBeVisible();
  await page.getByRole("button", { name: `Start from the ${next - 1} list` }).click();
  await page.getByRole("button", { name: "Send for check" }).click();
  await expect(page.getByText("Sent to the Checker.")).toBeVisible();
  await expect(page.getByText(/are waiting for a Checker/)).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, new RegExp(`Holiday calendar ${next}`));
  await page.goto(`/attendance/holidays?year=${next}`);
  await expect(page.getByText(/17 gazetted · 8 restricted/)).toBeVisible();
});
