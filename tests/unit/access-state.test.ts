import { describe, expect, it } from "vitest";
import { accessState } from "@/lib/auth/access-state";

const base = { userStatus: "ACTIVE" as const, pensionFrom: null };
const emp = (over: Partial<{ status: "ACTIVE" | "RETIRED" | "RESIGNED" | "SUSPENDED"; exitDate: string | null; dateOfRetirement: string | null }> = {}) => ({
  status: "ACTIVE" as const,
  exitDate: null,
  dateOfRetirement: "2030-06-30",
  ...over,
});

describe("access ends automatically (PRD §2 rule 6)", () => {
  it("keeps access on the last working day and ends it the day after", () => {
    const input = { ...base, loginType: "EMPLOYEE" as const, employee: emp({ dateOfRetirement: "2026-11-30" }) };
    expect(accessState(input, "2026-11-30").allowed).toBe(true);
    expect(accessState(input, "2026-12-01").allowed).toBe(false);
  });

  it("starts the pensioner view the day after retirement", () => {
    const input = { ...base, loginType: "EMPLOYEE" as const, employee: emp({ status: "RETIRED", dateOfRetirement: "2026-11-30" }), pensionFrom: "2026-12-01" };
    expect(accessState(input, "2026-11-30")).toMatchObject({ allowed: false });
    expect(accessState(input, "2026-12-01")).toMatchObject({ allowed: true, isEmployee: false, isPensioner: true });
  });

  it("ends HR & Accounts access on resignation or transfer", () => {
    const input = { ...base, loginType: "HR_ACCOUNTS" as const, employee: emp({ status: "RESIGNED", exitDate: "2026-10-15" }) };
    expect(accessState(input, "2026-10-26")).toMatchObject({ allowed: false, reason: "ended" });
  });

  it("keeps people not on the rolls (IT cell) active and blocks disabled logins", () => {
    expect(accessState({ ...base, loginType: "ADMIN", employee: null }, "2026-10-26").allowed).toBe(true);
    expect(accessState({ ...base, userStatus: "DISABLED", loginType: "ADMIN", employee: null }, "2026-10-26")).toMatchObject({ allowed: false, reason: "disabled" });
  });

  it("keeps suspended employees as employees (subsistence allowance is still paid)", () => {
    expect(accessState({ ...base, loginType: "EMPLOYEE", employee: emp({ status: "SUSPENDED" }) }, "2026-10-26").isEmployee).toBe(true);
  });
});
