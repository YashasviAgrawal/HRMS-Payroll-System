import type { Tone } from "@/components/ui/badge";

export function statusTone(status: string): Tone {
  if (status === "ACTIVE") return "green";
  if (status === "DRAFT") return "amber";
  if (status === "SUSPENDED") return "red";
  return "gray";
}

export function typeTone(type: string): Tone {
  if (type === "PERMANENT_OPS") return "gold";
  if (type === "PERMANENT_NPS") return "green";
  if (type === "DEPUTATION") return "violet";
  return "blue";
}
