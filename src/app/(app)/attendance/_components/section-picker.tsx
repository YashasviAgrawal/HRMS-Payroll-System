"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/field";

/** Changes the ?section= of the current screen. */
export function SectionPicker({ sections, value, hrefBase, label }: { sections: { id: string; name: string }[]; value: string; hrefBase: string; label: string }) {
  const router = useRouter();
  return (
    <Select label={label} value={value} onChange={(e) => router.push(`${hrefBase}${hrefBase.includes("?") ? "&" : "?"}section=${e.target.value}`)} containerClassName="w-full sm:w-72">
      {sections.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
}
