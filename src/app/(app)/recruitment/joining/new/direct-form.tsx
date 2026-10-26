"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { todayIST } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { msg, type Option, type PostOption } from "../../../employees/_components/fields";

export function DirectJoiningForm({ sections, posts }: { sections: Option[]; posts: PostOption[] }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [v, setV] = useState({
    firstName: "", lastName: "", nameHi: "", gender: "M", dateOfBirth: "", mobile: "", type: "CONTRACT", sectionId: "", postId: "",
    dateOfJoining: todayIST(), agencyName: "", wageRate: "", wageBasis: "MONTHLY", contractStart: todayIST(), contractEnd: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  const name = (o: Option) => (locale === "hi" ? o.nameHi : o.name);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const res = await api<{ id: string }>("/api/v1/recruitment/joinings", { body: v });
      toast(t("recruitment.joining.started"));
      router.push(`/recruitment/joining/${res.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label={t("employees.fields.firstName")} value={v.firstName} onChange={(e) => set("firstName", e.target.value)} error={msg(t, errors.firstName)} required />
          <Input label={t("employees.fields.lastName")} value={v.lastName} onChange={(e) => set("lastName", e.target.value)} optionalLabel={t("common.optional")} />
          <Input label={t("employees.fields.nameHi")} value={v.nameHi} lang="hi" onChange={(e) => set("nameHi", e.target.value)} optionalLabel={t("common.optional")} />
          <Select label={t("employees.fields.gender")} value={v.gender} onChange={(e) => set("gender", e.target.value)}>
            {["M", "F", "T"].map((g) => (
              <option key={g} value={g}>
                {tDynamic(t, `employees.gender.${g}`)}
              </option>
            ))}
          </Select>
          <Input label={t("employees.fields.dateOfBirth")} type="date" value={v.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} error={msg(t, errors.dateOfBirth)} required />
          <Input label={t("common.mobile")} value={v.mobile} inputMode="numeric" onChange={(e) => set("mobile", e.target.value)} error={msg(t, errors.mobile)} optionalLabel={t("common.optional")} />
        </div>
        <div className="grid gap-5 rounded-xl bg-sky-50/50 p-4 ring-1 ring-sky-600/10 sm:grid-cols-2">
          <Select label={t("employees.fields.type")} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value, wageBasis: e.target.value === "DAILY_WAGE" ? "DAILY" : "MONTHLY" })}>
            <option value="CONTRACT">{t("employees.type.CONTRACT")}</option>
            <option value="DAILY_WAGE">{t("employees.type.DAILY_WAGE")}</option>
          </Select>
          <Input label={t("employees.fields.dateOfJoining")} type="date" value={v.dateOfJoining} onChange={(e) => set("dateOfJoining", e.target.value)} error={msg(t, errors.dateOfJoining)} required />
          <Select label={t("common.section")} value={v.sectionId} onChange={(e) => set("sectionId", e.target.value)} error={msg(t, errors.sectionId)} required>
            <option value="">—</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {name(s)}
              </option>
            ))}
          </Select>
          <Select label={t("common.post")} value={v.postId} onChange={(e) => set("postId", e.target.value)} error={msg(t, errors.postId)} required>
            <option value="">—</option>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>
                {name(p)}
              </option>
            ))}
          </Select>
          <Input label={t("employees.fields.agencyName")} value={v.agencyName} onChange={(e) => set("agencyName", e.target.value)} optionalLabel={t("common.optional")} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t("employees.fields.wageRate")} type="number" min={0} value={v.wageRate} onChange={(e) => set("wageRate", e.target.value)} error={msg(t, errors.wageRate)} required />
            <Select label={t("employees.fields.wageBasis")} value={v.wageBasis} onChange={(e) => set("wageBasis", e.target.value)}>
              <option value="MONTHLY">{t("employees.wageBasis.MONTHLY")}</option>
              <option value="DAILY">{t("employees.wageBasis.DAILY")}</option>
            </Select>
          </div>
          {v.type === "CONTRACT" && (
            <>
              <Input label={t("employees.fields.contractStart")} type="date" value={v.contractStart} onChange={(e) => set("contractStart", e.target.value)} error={msg(t, errors.contractStart)} required />
              <Input label={t("employees.fields.contractEnd")} type="date" value={v.contractEnd} onChange={(e) => set("contractEnd", e.target.value)} error={msg(t, errors.contractEnd)} required />
            </>
          )}
        </div>
      </CardBody>
      <CardFooter>
        <Button variant="primary" loading={busy} onClick={submit} icon={<Send className="size-4" />}>
          {t("recruitment.startJoining")}
        </Button>
      </CardFooter>
    </Card>
  );
}
