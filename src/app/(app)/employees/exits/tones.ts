import type { Tone } from "@/components/ui/badge";

export const SEPARATION_TONE: Record<"PENDING" | "APPROVED" | "REJECTED" | "ENDED", Tone> = { PENDING: "amber", APPROVED: "red", REJECTED: "gray", ENDED: "gray" };
export const SETTLEMENT_TONE: Record<"NONE" | "CHECKING" | "APPROVED" | "SETTLED", Tone> = { NONE: "amber", CHECKING: "blue", APPROVED: "violet", SETTLED: "green" };
