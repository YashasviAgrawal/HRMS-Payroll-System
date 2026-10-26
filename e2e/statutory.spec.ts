import { expect, test } from "@playwright/test";
import { approveTask, signIn, signOut } from "./helpers";

const lastMonth = () => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

test("Module 8 — an employee picks the old regime, declares and attaches a proof; a Checker verifies it (ST-02, ST-03)", async ({ page }) => {
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10010" });
  await page.goto("/my/tax");
  await expect(page.getByRole("heading", { name: "My tax" })).toBeVisible();
  // Both regimes are worked out side by side before choosing.
  await expect(page.getByTestId("regime-NEW")).toContainText("Tax with cess");
  await expect(page.getByTestId("regime-OLD")).toContainText("Tax with cess");
  await page.getByRole("radio", { name: /^Old regime/ }).click();
  await page.getByLabel(/^Section 80C —/).fill("120000");
  await page.getByLabel(/Rent paid in the year/).fill("96000");
  await page.locator("#proof-file").setInputFiles({ name: "ppf-receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% PPF receipt (test)\n") });
  await expect(page.getByText("Proof added.")).toBeVisible();
  await expect(page.getByRole("link", { name: "ppf-receipt.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "Send to HR & Accounts" }).click();
  await expect(page.getByText("Sent to HR & Accounts to check.")).toBeVisible();
  await expect(page.getByText(/HR & Accounts are checking it/)).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Tax declaration .*: Suresh Pal .* old regime/);
  await page.goto("/statutory/declarations?status=VERIFIED");
  await expect(page.getByRole("row", { name: /Suresh Pal/ })).toContainText("Verified");
  await page.getByRole("link", { name: "Suresh Pal" }).click();
  await expect(page.getByRole("link", { name: "ppf-receipt.pdf" })).toBeVisible();
  await expect(page.getByText("Tax for the year both ways")).toBeVisible();
});

test("Module 8 — a GPF advance goes to a Checker and an Admin, then is recovered from pay (§9 GPF)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/statutory/funds");
  await page.getByRole("link", { name: "Ramesh Chand" }).click();
  await expect(page.getByText(/Up to ₹[\d,]+ as an advance \(75% of the balance\)/)).toBeVisible();
  await page.getByLabel(/^Amount/).fill("50000");
  await page.getByLabel(/Instalments/).fill("24");
  await page.getByLabel("Sanction order number").fill("DCB/Accts/GPF/52");
  await page.getByLabel("Purpose").fill("Repair of house");
  await expect(page.getByText("₹2,084 a month from next month's pay")).toBeVisible();
  await page.getByRole("button", { name: "Send to Checker" }).click();
  await expect(page.getByText("Sent to a Checker; an Admin approves after.")).toBeVisible();
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /GPF advance ₹50,000: Ramesh Chand/);
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /GPF advance ₹50,000: Ramesh Chand/);
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/statutory/funds");
  await expect(page.getByRole("row", { name: /Ramesh Chand/ })).toContainText("₹50,000");
  await page.getByRole("link", { name: "Ramesh Chand" }).click();
  await expect(page.getByRole("row", { name: /Advance \(paid back\)/ })).toContainText("Being recovered");
  const pdf = await page.request.get((await page.getByRole("link", { name: /Statement for .* \(PDF\)/ }).getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

test("Module 8 — a revised NPS file is made and released by an Admin; the CRA statement is checked (ST-06, ST-09)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  // Last month's files were made and released in the demo; a revised one goes to an Admin again.
  await page.goto(`/statutory/files?month=${lastMonth()}`);
  const card = page.getByTestId("card-stat.nps");
  await expect(card).toContainText("Downloaded");
  await card.getByRole("button", { name: "Make again" }).click();
  await expect(page.getByText("File made. An Admin must release it before download.")).toBeVisible();
  await expect(card).toContainText("Waiting for Admin approval");
  await page.goto("/statutory/funds?view=nps");
  await page.locator("#cra-file").setInputFiles({ name: "cra.csv", mimeType: "text/csv", buffer: Buffer.from("PRAN,Contribution Month,Employee Contribution,Employer Contribution\n999988887777,092026,100,140\n") });
  await expect(page.getByTestId("cra-result")).toContainText("1 not in our bills");
  // ST-05: a challan is checked as it is typed.
  await page.goto("/statutory/tds");
  await page.getByRole("button", { name: "Record a challan" }).click();
  await page.getByLabel("BSR code (7 digits)").fill("12");
  await page.getByLabel("Challan serial no. (5 digits)").fill("1");
  await page.getByLabel("Date deposited").fill("2026-10-05");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("BSR code is 7 digits")).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /NPS contribution file \(CRA\) — /);
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto(`/statutory/files?month=${lastMonth()}`);
  await expect(page.getByTestId("card-stat.nps")).toContainText("Approved · ready to download");
});

test("Module 8 — the finished quarter's Form 24Q is built from its challans and released (ST-06)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/statutory/tds");
  const make = page.getByRole("button", { name: "Make 24Q file" });
  // The demo's two closed months fall in a finished quarter on most days; on the last month of a quarter they do not.
  test.skip((await make.count()) === 0, "No finished quarter with pay bills in the demo on this date");
  await make.first().click();
  await expect(page.getByText("Form 24Q made. Run it through the FVU after an Admin releases it.")).toBeVisible();
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /Form 24Q .* Q\d: \d+ challans/);
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/statutory");
  await expect(page.getByRole("row", { name: /Form 24Q/ }).first()).toContainText("Done");
});

test("Module 8 — Form 16 Part B is made for everyone paid this year (ST-07)", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/statutory/form16");
  await expect(page.getByText(/is not over\. Part B can be made as a draft/)).toBeVisible();
  await page.getByRole("button", { name: "Make Part B for everyone" }).click();
  await expect(page.getByText(/Part B made for \d+ people\./)).toBeVisible({ timeout: 150_000 });
  const link = page.getByRole("row", { name: /Anil Sharma/ }).getByRole("link", { name: "Download" }).first();
  const pdf = await page.request.get((await link.getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});
