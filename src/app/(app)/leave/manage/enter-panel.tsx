"use client";

import { useState } from "react";
import { Select } from "@/components/ui/field";
import { useT } from "@/lib/i18n/client";
import { ApplyForm } from "../apply/apply-form";

/** LV-05: pick the person, then the same form an employee uses, plus the paper sanction. */
export function EnterPanel({
  staff,
  types,
  rules,
  restrictedHolidays,
  today,
}: {
  staff: { id: string; label: string }[];
  types: { code: string; name: string; available: number | null; creditMode: string }[];
  rules: Record<string, { halfDayAllowed: boolean; needsCertificate: boolean; restrictedOnly: boolean }>;
  restrictedHolidays: { date: string; name: string }[];
  today: string;
}) {
  const t = useT();
  const [employeeId, setEmployeeId] = useState("");
  return (
    <div className="space-y-4">
      <Select label={t("leave.enter.employee")} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} containerClassName="max-w-md" required>
        <option value="">{t("leave.enter.chooseEmployee")}</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </Select>
      {employeeId && <ApplyForm key={employeeId} onBehalf employeeId={employeeId} types={types} rules={rules} restrictedHolidays={restrictedHolidays} initial={{ leaveCode: "CL", fromDate: today, toDate: today }} />}
    </div>
  );
}
