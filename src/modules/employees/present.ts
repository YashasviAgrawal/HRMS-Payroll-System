import "server-only";
import type { Employee } from "@/generated/prisma/client";
import { formatDate, toISODate } from "@/lib/dates";
import { makeT, tDynamic } from "@/lib/i18n";
import { maskAadhaar, maskTail } from "@/lib/utils";
import type { Address } from "./schema";

/** How employee values are written in approval rows and the change history (English, plus Hindi labels). */
const tEn = makeT("en");
const tHi = makeT("hi");

export function fieldLabel(field: string) {
  return { label: tDynamic(tEn, `employees.fields.${field}`), labelHi: tDynamic(tHi, `employees.fields.${field}`) };
}

export function fullName(e: Pick<Employee, "firstName" | "middleName" | "lastName">) {
  return [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ");
}

export function addressLine(a: unknown): string | null {
  if (!a || typeof a !== "object") return null;
  const x = a as Address;
  const parts = [x.line1, x.line2, x.city, x.district, x.state, x.pincode].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export const DATE_FIELDS = new Set([
  "dateOfBirth", "dateOfJoining", "dateOfRetirement", "probationEndDate", "confirmationDate", "contractStart", "contractEnd", "exitDate",
]);

const ENUM_PREFIX: Record<string, string> = {
  gender: "employees.gender",
  category: "employees.category",
  maritalStatus: "employees.marital",
  type: "employees.type",
  wageBasis: "employees.wageBasis",
  status: "employees.status",
};

/** A value as a short readable string (dates formatted, enums labelled, booleans Yes/No). */
export function displayValue(field: string, value: unknown, names?: { sections?: Map<string, string>; posts?: Map<string, string> }): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return formatDate(toISODate(value));
  if (DATE_FIELDS.has(field) && typeof value === "string") return formatDate(value);
  if (field === "sectionId") return names?.sections?.get(String(value)) ?? String(value);
  if (field === "postId") return names?.posts?.get(String(value)) ?? String(value);
  if (field === "presentAddress" || field === "permanentAddress") return addressLine(value);
  if (typeof value === "boolean") return value ? tEn("common.yes") : tEn("common.no");
  if (ENUM_PREFIX[field]) return tDynamic(tEn, `${ENUM_PREFIX[field]}.${String(value)}`);
  if (typeof value === "object" && "toString" in value) return value.toString();
  return String(value);
}

/** Masked display of the sensitive identifiers. */
export function maskedIds(e: Pick<Employee, "panLast4" | "aadhaarLast4" | "bankAccountLast4">) {
  return {
    pan: e.panLast4 ? `XXXXXX${e.panLast4}` : null,
    aadhaar: e.aadhaarLast4 ? maskAadhaar(e.aadhaarLast4) : null,
    bankAccount: e.bankAccountLast4 ? maskTail(`00000000${e.bankAccountLast4}`, 4) : null,
  };
}
