import type { EmployeeStatus, UserStatus } from "@/generated/prisma/enums";
import type { ISODate } from "@/lib/dates";

export interface AccessInput {
  userStatus: UserStatus;
  loginType: "ADMIN" | "HR_ACCOUNTS" | "EMPLOYEE";
  employee: {
    status: EmployeeStatus;
    exitDate: ISODate | null;
    dateOfRetirement: ISODate | null;
  } | null;
  /** Date from which the person is a pensioner (the day after retirement), when a pension record exists. */
  pensionFrom: ISODate | null;
}

export interface AccessState {
  allowed: boolean;
  isEmployee: boolean;
  isPensioner: boolean;
  reason?: "disabled" | "ended";
}

/**
 * PRD §2 rule 6: access ends automatically on retirement, resignation or transfer; the pensioner view
 * starts the day after retirement. The last working day itself still has full access.
 */
export function accessState(input: AccessInput, today: ISODate): AccessState {
  if (input.userStatus !== "ACTIVE") return { allowed: false, isEmployee: false, isPensioner: false, reason: "disabled" };

  const e = input.employee;
  let isEmployee = false;
  if (e) {
    const lastDay = e.exitDate ?? e.dateOfRetirement;
    const onRolls = e.status === "ACTIVE" || e.status === "SUSPENDED";
    isEmployee = onRolls && (!lastDay || today <= lastDay);
  }
  const isPensioner = input.pensionFrom !== null && today >= input.pensionFrom;

  if (input.loginType === "EMPLOYEE") {
    const allowed = isEmployee || isPensioner;
    return { allowed, isEmployee, isPensioner, reason: allowed ? undefined : "ended" };
  }
  // Admin and HR & Accounts logins: people not on the rolls (IT cell) have no employee link and keep access.
  const allowed = e === null || isEmployee;
  return { allowed, isEmployee, isPensioner: false, reason: allowed ? undefined : "ended" };
}
