import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "9876543210" → "******3210" */
export function maskMobile(mobile: string | null | undefined): string {
  if (!mobile) return "";
  return `******${mobile.slice(-4)}`;
}

/** Shows only the last four characters, e.g. Aadhaar "XXXX XXXX 1234", PAN "XXXXXX234F". */
export function maskTail(value: string | null | undefined, visible = 4, mask = "X"): string {
  if (!value) return "";
  const clean = value.replace(/\s/g, "");
  return mask.repeat(Math.max(0, clean.length - visible)) + clean.slice(-visible);
}

export function maskAadhaar(last4: string | null | undefined): string {
  return last4 ? `XXXX XXXX ${last4}` : "";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
