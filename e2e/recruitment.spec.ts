import { expect, test, type Page } from "@playwright/test";
import { verhoeffCheckDigit } from "../src/lib/validators";
import { signIn, signOut } from "./helpers";

async function approveTask(page: Page, title: RegExp) {
  await page.goto("/approvals");
  await page.getByRole("cell", { name: title }).first().click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL("**/approvals");
}

test("Module 3 — vacancy to employee: selection, letter, joining checklist, Checker, Employee ID", async ({ page }) => {
  test.setTimeout(120_000);
  // HR records the selection on the demo vacancy (seeded: LDC, 2 seats, GEN 1 + OBC 1).
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/recruitment");
  await page.getByRole("cell", { name: "DCB/REC/2026/001" }).click();
  const row = (name: string) => page.getByRole("row", { name: new RegExp(name) });
  for (const [name, status, rank] of [["Kiran Bala", "Selected", "1"], ["Rohit Saxena", "Selected", "2"], ["Anjali Meena", "Wait list", "3"]] as const) {
    await row(name).getByRole("combobox", { name: "Status" }).selectOption({ label: status });
    await row(name).getByRole("textbox", { name: "Merit rank" }).fill(rank);
    await row(name).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Send selection list to Admin" }).click();
  await expect(page.getByText("Selection list sent to an Admin.")).toBeVisible();
  await signOut(page);

  // An Admin approves the selection list (RO-04).
  await signIn(page, { as: "Admin", id: "DCB10001" });
  await approveTask(page, /Selection list DCB\/REC\/2026\/001/);
  await signOut(page);

  // HR issues the appointment letter and starts the joining.
  await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
  await page.goto("/recruitment");
  await page.getByRole("cell", { name: "DCB/REC/2026/001" }).click();
  await row("Kiran Bala").getByRole("button", { name: "Issue appointment letter" }).click();
  await expect(page.getByText("Appointment letter issued.")).toBeVisible();
  const letterHref = await row("Kiran Bala").getByRole("link", { name: "Letter (Hindi + English)" }).getAttribute("href");
  const pdf = await page.request.get(letterHref!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await row("Kiran Bala").getByRole("button", { name: "Start joining" }).click();
  await page.waitForURL("**/recruitment/joining/**");
  const joiningUrl = page.url();

  // RO-05 checklist.
  for (let i = 0; i < 7; i++) {
    await page.getByRole("button", { name: "Mark done" }).first().click();
    await expect(page.getByRole("button", { name: "Mark done" })).toHaveCount(6 - i);
  }
  // Identity and bank on the draft record.
  await page.getByRole("link", { name: "Bank & IDs" }).click();
  const base = `8${Date.now().toString().slice(-10)}`;
  await page.getByRole("textbox", { name: "PAN" }).fill("ABKPB4321C");
  await page.getByRole("textbox", { name: "Aadhaar" }).fill(base + verhoeffCheckDigit(base));
  await page.getByRole("textbox", { name: "Bank account number" }).fill("40112233445");
  await page.getByRole("textbox", { name: "IFSC" }).fill("SBIN0001234");
  await page.getByRole("button", { name: "Save corrections" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.goto(joiningUrl);
  await page.getByRole("button", { name: "Complete joining" }).click();
  await expect(page.getByText("Sent to the Checker.")).toBeVisible();
  await signOut(page);

  // The Checker verifies; approval issues the Employee ID (RO-06, flow step 4).
  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Joining: Kiran Bala/);
  await page.goto(joiningUrl);
  await expect(page.getByText("Joined", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open record" }).click();
  await expect(page.getByText(/^DCB\d{5}$/).first()).toBeVisible();
  await expect(page.getByText("Working")).toBeVisible();
});
