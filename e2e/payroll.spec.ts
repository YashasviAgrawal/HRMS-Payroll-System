import { expect, test, type Page } from "@playwright/test";
import { approveTask, signIn, signOut } from "./helpers";

const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7);

async function resolve(page: Page, code: string, choice: RegExp | null, remark: string) {
  await page.getByTestId(`exception-${code}`).getByRole("button", { name: "Resolve" }).click();
  const dialog = page.getByRole("dialog");
  if (choice) await dialog.getByRole("radio", { name: choice }).check();
  await dialog.getByRole("textbox", { name: "Remark" }).fill(remark);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId(`exception-${code}`).getByRole("button", { name: "Undo" })).toBeVisible();
}

test("Module 6 — run, fix exceptions, check, approve with OTP, pay and close (S-40, PR-10 to PR-14)", async ({ page }) => {
  test.setTimeout(240_000);
  // Stage 1 — Payroll runs this month's NPS payroll.
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll");
  await page.getByTestId("group-NPS").getByRole("button", { name: "Run payroll" }).click();
  await page.waitForURL(/\/payroll\/[a-z0-9]{20,}/);
  const runUrl = new URL(page.url()).pathname;
  const runId = runUrl.split("/").pop()!;
  await expect(page.getByRole("heading", { name: /Payroll .* — Permanent – NPS/ })).toBeVisible();

  // Stage 2 — PR-10: a one-off recovery moves Manoj's net by over 25% (a remark for the Checker). In the demo Health
  // has not locked last month (blocks) — unless the attendance check before this one locked it.
  await expect(page.getByTestId("exception-NET_CHANGE")).toContainText("DCB10019");
  await expect(page.getByRole("button", { name: / to fix$/ })).toBeDisabled();
  if (await page.getByTestId("exception-ATTENDANCE_NOT_LOCKED").count()) {
    await expect(page.getByTestId("exception-ATTENDANCE_NOT_LOCKED")).toContainText("Health and Sanitation");
    await resolve(page, "ATTENDANCE_NOT_LOCKED", /Paid without loss days/, "Health head confirmed no absences; lock follows tomorrow");
  }
  await resolve(page, "NET_CHANGE", null, "Recovery of HRA paid twice in August, one month only");
  await page.getByLabel("Note for the Checker (optional)").fill("Health section to lock September tomorrow");
  await page.getByRole("button", { name: "Send to Checker" }).click();
  await expect(page.getByText("Waiting for a Checker.", { exact: false })).toBeVisible();
  await signOut(page);

  // Stage 3 — the Checker opens it from the inbox, reviews totals by section, forwards.
  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await page.goto("/approvals");
  await page.getByRole("cell", { name: /Permanent – NPS/ }).first().click();
  await page.getByRole("link", { name: "Open to decide" }).click();
  await expect(page.getByRole("link", { name: "By section" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Forward to Admin" }).click();
  await expect(page.getByText("Waiting for an Admin to approve and sign.")).toBeVisible();
  await signOut(page);

  // Stage 4 — an Admin holding Approver + Pay bill signer approves with the OTP.
  await signIn(page, { as: "Admin", id: "DCB10002" });
  await page.goto(runUrl);
  await page.getByRole("button", { name: "Send OTP" }).click();
  const otp = (await page.getByTestId("dev-otp").textContent())!.match(/\d{6}/)![0];
  await page.getByRole("group", { name: "OTP" }).getByRole("textbox").first().fill(otp);
  await page.getByRole("button", { name: "Approve and sign" }).click();
  await expect(page.getByText(/Approved and signed by Sunita Verma/)).toBeVisible();
  // PR-11: the signed pay bill and the register print as PDFs.
  for (const doc of ["paybill", "register", "schedules", "acquittance"]) {
    const res = await page.request.get(`/api/v1/payroll/runs/${runId}/print/${doc}`);
    expect(res.headers()["content-type"]).toBe("application/pdf");
  }
  await signOut(page);

  // Stage 5 — Payroll makes the bank file; another Admin releases it (ST-09).
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto(runUrl);
  await page.getByRole("button", { name: "Make bank file" }).click();
  await expect(page.getByText("Bank file waiting for an Admin to release it.")).toBeVisible();
  await signOut(page);
  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /Bank file: Payroll .* NPS/);
  // PR-13: once the bank file is released the payroll cannot be reopened.
  await page.goto(runUrl);
  await expect(page.getByText("Bank file released.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
  await signOut(page);

  // PR-12: the bank's return file marks one failed credit; it is re-paid; the month closes (PR-14 summary).
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto(runUrl);
  const run = (await (await page.request.get(`/api/v1/payroll/runs/${runId}`)).json()).data as { people: { code: string; net: number; status: string }[] };
  const shalini = run.people.find((p) => p.code === "DCB10020")!;
  const paid = run.people.filter((p) => p.status === "INCLUDED").length;
  await page.locator("#return-file").setInputFiles({ name: "return.csv", mimeType: "text/csv", buffer: Buffer.from(`Employee ID,Amount,Status,Reason\r\nDCB10020,${shalini.net.toFixed(2)},FAILED,Account dormant\r\n`) });
  await expect(page.getByText(`1 failed, ${paid - 1} credited.`)).toBeVisible();
  await page.getByRole("button", { name: "Make re-pay file" }).click();
  await expect(page.getByText("Re-pay file made. An Admin must release it.")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Close the month" }).click();
  await expect(page.getByText(/Closed on/)).toBeVisible();
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();
});

test("Module 6 — a DA change waits for an Admin, then the rate is in force (PR-02, S-81)", async ({ page }) => {
  const from = `${thisMonth()}-01`;
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/admin/rates");
  await page.getByRole("row", { name: /Dearness allowance/ }).getByRole("button", { name: "Propose a change" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/New value/).fill("62");
  await dialog.getByLabel("Starts on").fill(from);
  await dialog.getByLabel("Order or reason").fill("DA order no. 3/2026 (demo)");
  await dialog.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Sent to an Admin for approval.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Dearness allowance/ })).toContainText("A change is waiting for an Admin.");
  await signOut(page);

  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /Dearness allowance: 62%/);
  await page.goto("/admin/rates");
  await expect(page.getByRole("row", { name: /Dearness allowance/ })).toContainText("62%");
  await expect(page.getByRole("row", { name: /Dearness allowance/ })).toContainText("60%");
});

test("Module 6 — a standing deduction is checked by a Checker before it counts (PR-04)", async ({ page }) => {
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/items");
  await page.getByRole("combobox", { name: "Employee" }).selectOption({ label: "DCB10024 · Ashok Saini" });
  await expect(page.getByText("No pay items for this person.")).toBeVisible();
  await page.getByRole("button", { name: "Add pay item" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Pay head" }).selectOption({ label: "Co-operative society dues (Deduction)" });
  await dialog.getByLabel("Amount a month (₹)").fill("750");
  await dialog.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Sent to a Checker.")).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Add Co-operative society dues: Ashok Saini/);
  await signOut(page);
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/payroll/items");
  await page.getByRole("combobox", { name: "Employee" }).selectOption({ label: "DCB10024 · Ashok Saini" });
  await expect(page.getByRole("row", { name: /Co-operative society dues/ })).toContainText("₹750");
  await expect(page.getByRole("row", { name: /Co-operative society dues/ })).toContainText("Running");
});
