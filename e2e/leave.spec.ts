import { expect, test } from "@playwright/test";
import { approveTask, signIn, signOut } from "./helpers";

const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** A working day (Mon–Fri) at least `ahead` days from today, past the demo's waiting applications. */
function workingDay(ahead: number) {
  let d = addDays(todayIST(), ahead);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}

test("Module 5 — apply with a live balance, officer approves, employee cancels (LV-03, LV-04)", async ({ page }) => {
  test.setTimeout(120_000);
  const day = workingDay(20);
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10010" });
  await page.goto("/leave/apply");
  await page.getByRole("combobox", { name: "Leave type" }).selectOption({ value: "CL" });
  await page.getByLabel("From").fill(day);
  await page.getByLabel("To").fill(day);
  await expect(page.getByText("Days of leave: 1")).toBeVisible();
  await expect(page.getByText("Your reporting officer decides.", { exact: true })).toBeVisible();
  await page.getByLabel("Reason").fill("Parent-teacher meeting at my son's school");
  await page.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByRole("heading", { name: /Casual Leave · 1/ })).toBeVisible();
  await expect(page.getByText("Waiting", { exact: true })).toBeVisible();
  const applicationUrl = page.url();
  await signOut(page);

  await signIn(page, { as: "Employee / Pensioner", id: "DCB10008" });
  await page.goto("/approvals");
  // Both of Suresh's CL applications are waiting with his officer; approve them.
  await approveTask(page, /CL 1 day: Suresh Pal/);
  await approveTask(page, /CL 2 days: Suresh Pal/);
  await page.goto("/my/team/leave");
  await expect(page.getByRole("row", { name: /Suresh Pal/ }).first()).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "Employee / Pensioner", id: "DCB10010" });
  await page.goto(applicationUrl);
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel leave" }).click();
  await page.getByLabel("Why are you cancelling?").fill("The meeting was moved to a Saturday");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel leave" }).click();
  await expect(page.getByText("Leave cancelled.")).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await page.goto("/leave/ledger/me");
  await expect(page.getByText("Restored").first()).toBeVisible();
  // LV-07: the printable leave account is a PDF.
  const href = await page.getByRole("link", { name: "Print leave account" }).getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

test("Module 5 — long leave and leave without an officer go to an Admin; HR enters a paper sanction (LV-05, PRD §14)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/leave/manage?tab=enter");
  await page.getByRole("combobox", { name: "Employee" }).selectOption({ label: "DCB10021 · Ravi Prakash" });
  await page.getByRole("combobox", { name: "Leave type" }).selectOption({ value: "CL" });
  const day = workingDay(25);
  await page.getByLabel("From").fill(day);
  await page.getByLabel("To").fill(day);
  await expect(page.getByText("An Admin decides (beyond the officer's limit).")).toBeVisible();
  await page.getByLabel("Reason").fill("Sick — informed the section head by phone");
  await page.getByLabel("Sanction order no. and date").fill("Hort/Leave/45 dated today");
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Entered by HR from a paper sanction").first()).toBeVisible();
  await signOut(page);

  // Gardens has no reporting officer, and Pooja's 5 days of EL are beyond Education's (it has none either).
  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /Leave entry: CL 1 day\(s\) for Ravi Prakash/);
  await approveTask(page, /EL 5 days: Pooja Bhatia/);
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/leave/manage?tab=applications&status=APPROVED");
  await expect(page.getByRole("row", { name: /Ravi Prakash/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Pooja Bhatia/ })).toBeVisible();
});

test("Module 5 — a leave rule changes only after an Admin approves (LV-01)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/leave/manage?tab=rules");
  await page.getByRole("row", { name: /Paternity Leave/ }).getByRole("button", { name: "Propose a change" }).click();
  await page.getByLabel("Officer may sanction up to (days)").fill("10");
  await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Sent to an Admin for approval.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Paternity Leave/ }).getByText("A change is waiting for an Admin.")).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "Admin", id: "DCB10002" });
  await approveTask(page, /Leave rule change: PTL/);
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/leave/manage?tab=rules");
  await expect(page.getByRole("row", { name: /Paternity Leave/ })).toContainText("Up to 10 days");
  await expect(page.getByRole("row", { name: /Paternity Leave/ })).toContainText("Version 2");
});
