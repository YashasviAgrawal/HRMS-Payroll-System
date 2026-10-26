/** Display helpers for payroll screens — pure, usable in client components. */
import type { Tone } from "@/components/ui/badge";

export type RunStatus = "DRAFT" | "CHECKING" | "APPROVING" | "APPROVED" | "PAID" | "CLOSED";

export const STAGE_KEYS = ["run", "fix", "check", "approve", "pay"] as const;

/** Index of the stage in progress (S-40): 0 before the run, 5 when the month is closed. */
export function stageIndex(status: RunStatus | null): number {
  switch (status) {
    case null:
      return 0;
    case "DRAFT":
      return 1;
    case "CHECKING":
      return 2;
    case "APPROVING":
      return 3;
    case "APPROVED":
    case "PAID":
      return 4;
    case "CLOSED":
      return 5;
  }
}

export const STATUS_TONE: Record<RunStatus, Tone> = {
  DRAFT: "gray",
  CHECKING: "blue",
  APPROVING: "violet",
  APPROVED: "gold",
  PAID: "green",
  CLOSED: "green",
};

/** "+12.5" / "−8" — a signed percentage for the change against last month. */
export function signedPct(pct: number): string {
  const v = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}`;
}
