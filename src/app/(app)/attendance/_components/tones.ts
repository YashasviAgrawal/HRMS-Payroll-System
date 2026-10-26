import type { DayStatus } from "@/generated/prisma/enums";
import type { Tone } from "@/components/ui/badge";

/** Cell colours for the register and calendar: green worked, amber partly, red not, blue away on duty or leave. */
export const CELL: Record<DayStatus, string> = {
  PRESENT: "bg-brand-50 text-brand-800",
  LATE: "bg-amber-50 text-amber-800",
  HALF_DAY: "bg-orange-50 text-orange-700",
  ABSENT: "bg-red-50 text-red-700 font-semibold",
  MISSED_PUNCH: "bg-violet-50 text-violet-700 font-semibold",
  ON_DUTY: "bg-sky-50 text-sky-800",
  LEAVE: "bg-indigo-50 text-indigo-700",
  HOLIDAY: "bg-gold-50 text-gold-600",
  WEEKLY_OFF: "bg-ink-100 text-ink-500",
  DIES_NON: "bg-red-100 text-red-800 font-semibold",
};

export const BADGE: Record<DayStatus, Tone> = {
  PRESENT: "green",
  LATE: "amber",
  HALF_DAY: "amber",
  ABSENT: "red",
  MISSED_PUNCH: "violet",
  ON_DUTY: "blue",
  LEAVE: "blue",
  HOLIDAY: "gold",
  WEEKLY_OFF: "gray",
  DIES_NON: "red",
};

export const REQUEST_TONE: Record<string, Tone> = { PENDING: "amber", APPROVED: "green", REJECTED: "red", RETURNED: "gray", CANCELLED: "gray" };
