"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/field";
import { useT } from "@/lib/i18n/client";

export function PersonPicker({ people, value }: { people: { id: string; label: string }[]; value: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <Select label={t("payroll.items.employee")} value={value} onChange={(e) => router.push(e.target.value ? `/payroll/items?employee=${e.target.value}` : "/payroll/items")} containerClassName="max-w-md">
      <option value="">{t("payroll.items.pick")}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}
