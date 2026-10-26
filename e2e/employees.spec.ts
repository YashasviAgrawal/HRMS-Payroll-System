import { expect, test } from "@playwright/test";
import { verhoeffCheckDigit } from "../src/lib/validators";
import { signIn, signOut } from "./helpers";

test.describe("Module 2 — employee master", () => {
  test("HR adds an employee in four steps; a Checker approves and the Employee ID is issued", async ({ page }) => {
    const stamp = Date.now().toString().slice(-6);
    const base = `7${stamp}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    const aadhaar = base + verhoeffCheckDigit(base);
    const pan = `ZXCP${"ABCDEFGHIJ"[Number(stamp[0])]}${stamp.slice(-4)}Q`;

    await signIn(page, { as: "HR & Accounts", id: "DCB10003" });
    await page.goto("/employees/new");
    // Step 1 — personal
    await page.getByRole("textbox", { name: "First name" }).fill("Kamla");
    await page.getByRole("textbox", { name: "Last name" }).fill(`Test${stamp}`);
    await page.getByLabel("Gender").selectOption("F");
    await page.getByLabel("Date of birth").fill("1994-03-12");
    await page.getByRole("button", { name: "Next" }).click();
    // Step 2 — job & pay
    await page.getByLabel("Employee type").selectOption("PERMANENT_NPS");
    await page.getByLabel("Date of joining").fill("2026-10-01");
    await page.getByLabel("Section").selectOption({ label: "Accounts" });
    await page.getByLabel("Post").selectOption({ index: 1 });
    await page.getByLabel("Pay level").selectOption("2");
    await page.getByLabel("Cell").selectOption("1");
    await expect(page.getByText("₹19,900", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    // Step 3 — IDs
    await page.getByRole("textbox", { name: "PAN" }).fill(pan);
    await page.getByRole("textbox", { name: "Aadhaar" }).fill(aadhaar);
    await page.getByRole("textbox", { name: "Bank account number" }).fill(`5${stamp}12345`);
    await page.getByRole("textbox", { name: "IFSC" }).fill("SBIN0001234");
    await page.getByRole("button", { name: "Next" }).click();
    // Step 4 — review and send
    await expect(page.getByText(`XXXX XXXX ${aadhaar.slice(-4)}`)).toBeVisible();
    await page.getByRole("button", { name: "Send for check" }).click();
    await expect(page.getByText("This record is waiting for check")).toBeVisible();
    const url = page.url();
    await signOut(page);

    await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
    await page.goto("/approvals");
    await page.getByRole("cell", { name: new RegExp(`New employee: Kamla Test${stamp}`) }).click();
    await expect(page.getByText(`XXXX XXXX ${aadhaar.slice(-4)}`)).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForURL("**/approvals");
    await page.goto(url);
    await expect(page.getByText(/^DCB\d{5}$/).first()).toBeVisible();
    await expect(page.getByText("Working")).toBeVisible();
  });

  test("an employee asks HR to change their address", async ({ page }) => {
    await signIn(page, { as: "Employee / Pensioner", id: "DCB10014" });
    // Withdraw anything left pending by an earlier run, using the same button an employee would.
    await page.goto("/my/requests");
    while (await page.getByRole("button", { name: "Withdraw" }).count()) {
      await page.getByRole("button", { name: "Withdraw" }).first().click();
      await expect(page.getByText("Withdrawn.").first()).toBeVisible();
      await page.reload();
    }
    await page.goto("/my/record");
    await expect(page.getByRole("heading", { name: "My record" })).toBeVisible();
    await page.getByRole("link", { name: "Request a change" }).click();
    await page.getByRole("button", { name: "Change of address" }).click();
    const present = page.getByRole("group", { name: "Present address" });
    await present.getByRole("textbox", { name: "House / building" }).fill("B-12, Sector 4");
    await present.getByRole("textbox", { name: "City / town" }).fill("New Delhi");
    await present.getByRole("textbox", { name: "PIN code" }).fill("110010");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Request sent to HR.")).toBeVisible();
    await expect(page.getByText("Change of address").last()).toBeVisible();
  });
});
