import { expect, test } from "@playwright/test";
import { approveTask, signIn, signOut } from "./helpers";

const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${todayIST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

test("Client add-on — the full and final settlement takes every loan and recovery, then a Checker and an Admin approve", async ({ page }) => {
  test.setTimeout(120_000);
  // Payroll opens the leaver seeded at the end of last month (Vikas Malhotra, with a festival advance running).
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/employees/exits");
  await page.getByRole("link", { name: "Vikas Malhotra" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Resignation — Vikas Malhotra/ })).toBeVisible();
  const settlement = page.getByTestId("settlement");
  await expect(settlement.getByTestId("settlement-dues")).toContainText("Leave encashment");
  await expect(settlement.getByTestId("settlement-recoveries")).toContainText("Festival advance");
  // A section's dues entered by hand, then sent for checking.
  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("What it is for").fill("Stores — tools not returned");
  await page.getByLabel("Amount (₹)").fill("500");
  await page.getByRole("button", { name: "Save and work out again" }).click();
  await expect(settlement.getByTestId("settlement-recoveries")).toContainText("Stores — tools not returned");
  await page.getByRole("button", { name: "Send for checking" }).click();
  await expect(page.getByText("Sent to the Checker")).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Full and final settlement — Vikas Malhotra/);
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10002" });
  await approveTask(page, /Full and final settlement — Vikas Malhotra/);
  await signOut(page);

  // Approved: Payroll makes the settlement bill, which goes through the usual payroll stages.
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/employees/exits?show=all");
  await page.getByRole("link", { name: "Vikas Malhotra" }).click();
  await expect(page.getByText("Settlement approved — to pay or recover").first()).toBeVisible();
  await page.getByRole("button", { name: "Make the settlement bill" }).click();
  await page.waitForURL(/\/payroll\/[a-z0-9]{20,}/);
  await expect(page.getByRole("heading", { name: /Full and final settlement — Vikas Malhotra/ })).toBeVisible();
});

test("Client add-on — a suspension and the reinstatement each go through a Checker and an Admin", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/employees?q=DCB10015");
  await expect(page.getByRole("heading", { level: 1, name: /Sanjay Rawat/ })).toBeVisible();
  await page.getByRole("button", { name: "Suspension or leaving" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "What" }).selectOption("SUSPENSION");
  await dialog.getByLabel("Under suspension from").fill(daysAgo(5));
  await dialog.getByLabel("Order number").fill("DCB/VIG/07");
  await dialog.getByLabel("Order date").fill(daysAgo(5));
  await dialog.getByLabel("Reason or remarks").fill("Pending a departmental inquiry");
  await dialog.getByRole("button", { name: "Send for check" }).click();
  await expect(page.getByText("Sent for approval")).toBeVisible();
  await expect(page.getByTestId("separation-banner")).toContainText("waiting for approval");
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Suspension — Sanjay Rawat/);
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10002" });
  await approveTask(page, /Suspension — Sanjay Rawat/);
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/employees?q=DCB10015");
  await expect(page.getByTestId("separation-banner")).toContainText("Under suspension from");
  await page.getByTestId("separation-banner").getByRole("link", { name: "Open" }).click();
  await page.getByRole("button", { name: "Reinstate" }).click();
  const back = page.getByRole("dialog");
  await back.getByLabel("Back on duty from").fill(todayIST());
  await back.getByLabel("Order number").fill("DCB/VIG/09");
  await back.getByLabel("Order date").fill(todayIST());
  await back.getByLabel("How the suspension period is treated").fill("Inquiry closed; the period is treated as duty");
  await back.getByRole("button", { name: "Send for check" }).click();
  await expect(page.getByText("Sent for approval")).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Reinstatement — Sanjay Rawat/);
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10002" });
  await approveTask(page, /Reinstatement — Sanjay Rawat/);
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/employees?q=DCB10015");
  await expect(page.getByRole("heading", { level: 1, name: /Sanjay Rawat/ })).toBeVisible();
  await expect(page.getByTestId("separation-banner")).toHaveCount(0);
  await page.goto("/employees/exits?show=all");
  await expect(page.getByRole("row", { name: /Sanjay Rawat/ })).toContainText("Ended");
});

test("Client add-on — one screen per employee, DA & TA by year, and scanned service books", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  // Payroll sees salary and loans on the overview.
  await page.goto("/employees?q=DCB10013");
  await expect(page.getByRole("heading", { level: 1, name: /Arun Joshi/ })).toBeVisible();
  await expect(page.getByTestId("overview-salary")).toBeVisible();
  await expect(page.getByTestId("overview-leave")).toBeVisible();
  await page.goto("/admin/rates?tab=daTa");
  await expect(page.getByRole("heading", { level: 2, name: "2026" })).toBeVisible();
  await expect(page.getByText("DA 58% → 60%").first()).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/employees/service-books");
  await page.getByTestId("service-book-files").setInputFiles({ name: "DCB10009 service book.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo service book\n") });
  await page.getByRole("button", { name: "Upload 1 files" }).click();
  await expect(page.getByText("1 of 1 files saved.").first()).toBeVisible();
  await page.goto("/employees?q=DCB10009");
  await page.getByRole("link", { name: "Service book", exact: true }).click();
  await expect(page.getByText("DCB10009 service book.pdf").first()).toBeVisible();
});

test("Client add-on — an Admin sees everyone's record and pay: the employee list with last net pay, and one person in full", async ({ page }) => {
  await signIn(page, { as: "Admin", id: "DCB10001" });
  await page.getByRole("navigation", { name: "Menu" }).first().getByRole("link", { name: "Employees" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Employees" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Last net pay" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Arun Joshi/ })).toContainText("₹");
  // The search in the top bar: an exact Employee ID opens the whole person on one screen.
  await page.getByRole("searchbox", { name: "Find an employee — ID or name" }).fill("DCB10013");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: /Arun Joshi/ })).toBeVisible();
  await expect(page.getByTestId("overview-salary")).toBeVisible();
  await expect(page.getByTestId("overview-leave")).toBeVisible();
  // Documents on the same screen: the key ones on file or not, and the latest to open.
  await expect(page.getByTestId("overview-documents")).toContainText("Appointment order");
  // A name that finds one person opens their profile too.
  await page.getByRole("searchbox", { name: "Find an employee — ID or name" }).fill("Arun Joshi");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: /Arun Joshi/ })).toBeVisible();
  // Seeing is not changing: no edit or leaving buttons for an Admin.
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Suspension or leaving" })).toHaveCount(0);

  // Month-wise and year-wise: last month in full, then this financial year month by month.
  const [y, m] = todayIST().split("-").map(Number);
  const lastMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const bar = page.getByTestId("period-bar");
  await bar.getByLabel("Month").fill(lastMonth);
  await bar.getByRole("button", { name: "Show" }).click();
  await expect(bar).toContainText("Showing");
  await expect(page.getByTestId("overview-salary")).toContainText("Net pay");
  await bar.getByRole("link", { name: "Year" }).click();
  await expect(page.getByTestId("overview-year")).toContainText("Total for the year");
  await page.getByTestId("overview-year").getByRole("link", { name: "All payslips" }).click();
  await expect(page.getByTestId("payslips-total")).toBeVisible();
});
