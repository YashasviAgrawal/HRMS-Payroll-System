import { expect, test } from "@playwright/test";
import { approveTask, signIn, signOut } from "./helpers";

const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const monthsAgo = (n: number) => {
  const [y, m] = todayIST().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
};

test("Module 7 — the increment due list goes to a Checker and the increments are given (PR-06)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/increments");
  await expect(page.getByRole("heading", { name: /Increments due on/ })).toBeVisible();
  // Mohit's own increment cannot be ticked by him (PRD §2 rule 2).
  await expect(page.getByRole("row", { name: /Mohit Gupta/ }).getByRole("checkbox")).toHaveCount(0);
  const send = page.getByRole("button", { name: /^Send \d+ to Checker$/ });
  const count = Number((await send.textContent())!.match(/\d+/)![0]);
  expect(count).toBeGreaterThan(0);
  await page.getByLabel("Order number (optional)").fill("DCB/Est/Inc/2027-01");
  await send.click();
  await expect(page.getByText("With Checker").first()).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, new RegExp(`Annual increment .*: ${count} people`));
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/increments");
  await expect(page.getByText(new RegExp(`\\d+ can be given · ${count} given`))).toBeVisible();
});

test("Module 7 — pay fixation on promotion shows the rule, then a Checker and an Admin approve (PR-07)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/increments?tab=fixation");
  await page.getByRole("combobox", { name: "Employee" }).selectOption({ label: "DCB10020 · Shalini Kapoor — L2 C7" });
  await page.getByRole("combobox", { name: "New post" }).selectOption({ label: "Upper Division Clerk (L4)" });
  await page.getByLabel("From (date of promotion or upgrade)").fill(todayIST());
  await page.getByLabel("Order number").fill("DCB/Est/Promo/14");
  await page.getByRole("button", { name: "Work it out" }).click();
  await expect(page.getByText("What the fixation comes to")).toBeVisible();
  await expect(page.getByText(/Level 4, cell \d+ · ₹/)).toBeVisible();
  await page.getByRole("button", { name: "Send to Checker" }).click();
  await expect(page.getByText("Sent to a Checker; an Admin approves after.")).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Promotion pay fixation: Shalini Kapoor/);
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /Promotion pay fixation: Shalini Kapoor/);
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/increments?tab=fixation");
  await expect(page.getByRole("row", { name: /Shalini Kapoor/ })).toContainText("L4");
});

test("Module 7 — a back-dated DA order becomes arrears in a supplementary bill (PR-08, S-42)", async ({ page }) => {
  test.setTimeout(120_000);
  // HR proposes DA 64% from the first day of two months ago; an Admin approves.
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/admin/rates");
  await page.getByRole("row", { name: /Dearness allowance/ }).getByRole("button", { name: "Propose a change" }).click();
  await page.getByRole("dialog").getByLabel(/New value/).fill("64");
  await page.getByRole("dialog").getByLabel("Starts on").fill(`${monthsAgo(2)}-01`);
  await page.getByRole("dialog").getByLabel("Order or reason").fill("DA order no. 4/2026 (demo, back-dated)");
  await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Sent to an Admin for approval.")).toBeVisible();
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10002" });
  await approveTask(page, /Dearness allowance: 64%/);
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/arrears");
  await page.getByRole("combobox", { name: "Pay group" }).selectOption("OPS");
  await page.getByLabel("From month").fill(monthsAgo(2));
  await page.getByLabel("To month").fill(monthsAgo(1));
  await page.getByRole("button", { name: "Work out arrears" }).click();
  await expect(page.getByRole("button", { name: "Rajesh Kumar" })).toBeVisible();
  await page.getByRole("button", { name: "Rajesh Kumar" }).click();
  await expect(page.getByText(/Dearness allowance/).first()).toBeVisible();
  await page.getByLabel("Reason").fill("DA 64% from the order dated back");
  await page.getByRole("button", { name: "Make supplementary bill" }).click();
  await page.waitForURL(/\/payroll\/[a-z0-9]{20,}/);
  await expect(page.getByRole("heading", { name: /Supplementary bill 1 .* Arrears/ })).toBeVisible();
  await page.getByRole("link", { name: /People/ }).click();
  await page.getByRole("link", { name: "Rajesh Kumar" }).click();
  await expect(page.getByText("Arrears month by month")).toBeVisible();
});

test("Module 7 — a loan is sanctioned through a Checker and an Admin, then recovered (PR-09)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/loans");
  await page.getByRole("combobox", { name: "Employee" }).selectOption({ label: "DCB10024 · Ashok Saini" });
  await page.getByRole("combobox", { name: "Type" }).selectOption("VEHICLE");
  await page.getByLabel("Amount (₹)").fill("60000");
  await page.getByLabel("Interest (% a year)").fill("10");
  await page.getByLabel("Instalments").fill("30");
  await page.getByLabel("Sanction date").fill(todayIST());
  await page.getByLabel("Sanction order number").fill("DCB/Accts/Adv/131");
  await expect(page.getByText(/₹2,000 a month for \d+ months/)).toBeVisible();
  await page.getByRole("button", { name: "Send to Checker" }).click();
  await expect(page.getByText("Sent to a Checker; an Admin approves after.")).toBeVisible();
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Loan \(VEHICLE\) ₹60,000: Ashok Saini/);
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /Loan \(VEHICLE\) ₹60,000: Ashok Saini/);
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/loans");
  await expect(page.getByRole("row", { name: /Ashok Saini/ })).toContainText("Being recovered");
  await page.getByRole("link", { name: "Ashok Saini" }).click();
  await expect(page.getByText("Schedule")).toBeVisible();
});

test("Module 7 — an employee downloads a payslip; HR & Accounts download a section as one PDF (SL-01 to SL-05)", async ({ page }) => {
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10010" });
  await page.goto("/my/payslips");
  const link = page.getByRole("link", { name: "Download" }).first();
  await expect(link).toBeVisible();
  const pdf = await page.request.get((await link.getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/payslips");
  const bulk = page.getByRole("link", { name: "Download (English)" }).first();
  const all = await page.request.get((await bulk.getAttribute("href"))!);
  expect(all.headers()["content-type"]).toBe("application/pdf");
});
