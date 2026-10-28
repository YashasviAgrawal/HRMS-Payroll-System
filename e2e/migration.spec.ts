import { expect, test } from "@playwright/test";
import { writeDbf } from "../src/modules/migration/dbf";
import { approveTask, signIn, signOut } from "./helpers";

/** A FoxPro employee table: two people already here, two new joiners (one with a date typed wrong), one deleted row. */
function foxproTable() {
  const columns = [
    { name: "EMPNO", type: "C", length: 10, decimals: 0 },
    { name: "NAME", type: "C", length: 40, decimals: 0 },
    { name: "HNAME", type: "C", length: 40, decimals: 0 },
    { name: "SEX", type: "C", length: 1, decimals: 0 },
    { name: "DOB", type: "D", length: 8, decimals: 0 },
    { name: "DOJ", type: "C", length: 10, decimals: 0 },
    { name: "CATG", type: "C", length: 2, decimals: 0 },
    { name: "SECT", type: "C", length: 8, decimals: 0 },
    { name: "DESIG", type: "C", length: 8, decimals: 0 },
    { name: "LEVEL", type: "C", length: 2, decimals: 0 },
    { name: "CELL", type: "N", length: 2, decimals: 0 },
    { name: "ACNO", type: "C", length: 18, decimals: 0 },
    { name: "IFSC", type: "C", length: 11, decimals: 0 },
  ];
  const base = { SEX: "M", CATG: "PN", SECT: "ACC", DESIG: "ACCT", LEVEL: "6", CELL: 4, IFSC: "SBIN0001234" };
  return writeDbf(columns, [
    { values: { ...base, EMPNO: "DCB10004", NAME: "Mohit Gupta", HNAME: "eksfgr xqIrk", DOB: "1987-04-12", DOJ: "01/04/2012" } },
    { values: { ...base, EMPNO: "DCB10006", NAME: "Deepak Yadav", HNAME: null, DOB: "1979-09-01", DOJ: "15/06/2008" } },
    { values: { ...base, EMPNO: "DCB10095", NAME: "Ramesh Chandra Joshi", HNAME: "jes'k pUnz tks'kh", DOB: "1990-11-02", DOJ: "01/08/2019", ACNO: "60101234500951" } },
    { values: { ...base, EMPNO: "DCB10096", NAME: "Kamla Rawat", HNAME: "deyk jkor", SEX: "F", DOB: "1992-06-30", DOJ: "31/02/2020", CATG: "PO", ACNO: "60101234500952" } },
    { deleted: true, values: { ...base, EMPNO: "DCB09999", NAME: "Left in 2009", DOB: "1949-01-01", DOJ: "01/01/1972" } },
  ]);
}

test("Module 10 — S-90: a FoxPro table is staged, mapped, cleaned, signed off by Accounts and loaded through the Checker (§15)", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, { as: "HR & Accounts", id: "DCB10007" });
  // HR & Accounts menus are full (§13): the console opens from Home while the migration is on.
  await page.goto("/home");
  await page.getByRole("link", { name: /Migration from FoxPro/ }).click();
  await expect(page.getByRole("heading", { name: "Migration from FoxPro" })).toBeVisible();

  // Steps 1–3: upload, with the deleted row kept apart and the count matching FoxPro's.
  await page.getByRole("link", { name: "Files", exact: true }).click();
  const { dbf } = foxproTable();
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/v1/migration/files") && r.request().method() === "POST"),
    page.getByTestId("migration-upload").setInputFiles([{ name: "EMPMAST.DBF", mimeType: "application/octet-stream", buffer: dbf }, { name: "SALARY.PRG", mimeType: "text/plain", buffer: Buffer.from("* DA rule") }]),
  ]);
  await expect(page.getByText(/4 rows staged · deleted rows kept apart: 1 · the file says 5/)).toBeVisible();
  await page.reload();
  const row = page.getByRole("row", { name: /EMPMAST\.DBF/ }).first();
  await expect(row).toContainText("5 ✓");

  // Step 4: the sheet is suggested from the column names; Kruti Dev is spotted; type codes are matched.
  await page.getByRole("link", { name: "Map and load" }).click();
  await page.getByRole("combobox", { name: "FoxPro table" }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Open" }).click();
  await page.waitForURL(/file=/);
  await expect(page.getByText("Columns were suggested from their names.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Employee ID — FoxPro column" })).toHaveValue("EMPNO");
  await expect(page.getByRole("combobox", { name: "Name in Hindi — FoxPro column" })).toHaveValue("HNAME");
  await page.getByRole("row", { name: /Employee type/ }).getByRole("button", { name: "Match the codes" }).click();
  const codes = page.getByTestId("codes-type");
  await codes.locator("label", { hasText: /^PN/ }).locator("select").selectOption("PERMANENT_NPS");
  await codes.locator("label", { hasText: /^PO/ }).locator("select").selectOption("PERMANENT_OPS");
  await page.getByRole("button", { name: "Save the mapping sheet" }).click();
  await expect(page.getByText("Mapping sheet saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Not yet signed off by Accounts")).toBeVisible();

  // Step 5: the 31 February typed in FoxPro is flagged and cleaned; the original stays in the staged row.
  await page.getByRole("link", { name: "See the problems" }).click();
  const flag = page.getByRole("row", { name: /DCB10096/ });
  await expect(flag).toContainText("Not a date");
  await expect(flag).toContainText("31/02/2020");
  await flag.getByRole("button", { name: "Fix value" }).click();
  await page.getByRole("textbox", { name: "New value for DOJ" }).fill("01/02/2020");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Value cleaned.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nothing here.")).toBeVisible();
  await signOut(page);

  // Accounts signs the sheet off.
  await signIn(page, { as: "HR & Accounts", id: "DCB10004" });
  await page.goto("/migration?tab=map&target=employees");
  await page.getByRole("button", { name: "Sign off (Accounts)" }).click();
  await expect(page.getByText("Signed off.")).toBeVisible();
  await signOut(page);

  // Step 8: two new people go to the Checker as one batch; the two already here are not loaded again.
  await signIn(page, { as: "HR & Accounts", id: "DCB10007" });
  await page.goto("/migration?tab=map&target=employees");
  await page.getByRole("button", { name: "Send 2 records to the Checker" }).click();
  await expect(page.getByText("Sent to the Checker.")).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "HR & Accounts", id: "DCB10006" });
  await approveTask(page, /Bulk upload: 2 employees \(FoxPro EMPMAST\)/);
  // Searching an exact Employee ID opens the person's profile.
  await page.goto("/employees?q=DCB10095");
  await expect(page.getByRole("heading", { level: 1, name: /Ramesh Chandra Joshi/ })).toBeVisible();

  // The checks table: record counts pass.
  await page.goto("/migration?tab=checks");
  await expect(page.getByTestId("check-RECORD_COUNTS")).toContainText("Passes");
  await page.getByTestId("check-RECORD_COUNTS").getByRole("button", { name: "Sign as Checker" }).click();
  await expect(page.getByText("Signed.")).toBeVisible();
});

test("Module 10 — S-90: an employee confirms their own record; the cut-over waits; the Admin takes the full data export (§15 step 7, §16)", async ({ page }) => {
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10014" });
  await page.goto("/my/record");
  await expect(page.getByText("Is your record correct?")).toBeVisible();
  await page.getByRole("button", { name: "Yes, my record is correct" }).click();
  await expect(page.getByTestId("record-confirmed")).toBeVisible();
  await signOut(page);

  await signIn(page, { as: "Admin", id: "DCB10002" });
  await page.getByRole("navigation", { name: "Menu" }).first().getByRole("link", { name: "Migration (set-up)" }).click();
  await page.getByRole("link", { name: "Record check" }).click();
  await page.getByRole("textbox", { name: "Search" }).fill("DCB10014");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("row", { name: /DCB10014/ })).toContainText("Online");
  await page.getByRole("link", { name: "Cut-over" }).click();
  await expect(page.getByText("Not everything is ready yet.")).toBeVisible();
  await page.getByRole("link", { name: "Data export" }).click();
  const res = await page.request.get("/api/v1/migration/export");
  expect(res.headers()["content-type"]).toBe("application/zip");
  expect((await res.body()).subarray(0, 2).toString()).toBe("PK");
});
