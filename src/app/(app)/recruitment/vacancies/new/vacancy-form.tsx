"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Info, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { basicIn, type MatrixLevels } from "@/modules/payroll/matrix-7cpc";
import { RESERVATION_CATEGORIES } from "@/modules/recruitment/schema";
import { msg, type Option, type PostOption } from "../../../employees/_components/fields";

export function VacancyForm({ sections, posts, payMatrix }: { sections: Option[]; posts: PostOption[]; payMatrix: MatrixLevels }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [v, setV] = useState({ sectionId: "", postId: "", seats: 1, advertNumber: "", advertDate: "", lastDate: "", notes: "" });
  const [reservation, setReservation] = useState<Record<string, number>>({ GEN: 1, OBC: 0, SC: 0, ST: 0, EWS: 0 });
  const [available, setAvailable] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const post = posts.find((p) => p.id === v.postId);
  const total = Object.values(reservation).reduce((a, b) => a + (Number(b) || 0), 0);

  useEffect(() => {
    if (!v.sectionId || !v.postId) return;
    let alive = true;
    api<{ available: number }>(`/api/v1/recruitment/available-seats?sectionId=${v.sectionId}&postId=${v.postId}`)
      .then((r) => alive && setAvailable(r.available))
      .catch(() => alive && setAvailable(null));
    return () => {
      alive = false;
    };
  }, [v.sectionId, v.postId]);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const res = await api<{ id: string }>("/api/v1/recruitment/vacancies", { body: { ...v, reservation } });
      toast(t("recruitment.created"));
      router.push(`/recruitment/vacancies/${res.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
      setBusy(false);
    }
  }

  const name = (o: Option) => (locale === "hi" ? o.nameHi : o.name);
  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Select label={t("common.section")} value={v.sectionId} onChange={(e) => { setAvailable(null); setV({ ...v, sectionId: e.target.value }); }} error={msg(t, errors.sectionId)} required>
            <option value="">—</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {name(s)}
              </option>
            ))}
          </Select>
          <Select label={t("common.post")} value={v.postId} onChange={(e) => { setAvailable(null); setV({ ...v, postId: e.target.value }); }} error={msg(t, errors.postId)} required>
            <option value="">—</option>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>
                {name(p)} · {t("employees.level", { level: p.payLevel })}
              </option>
            ))}
          </Select>
        </div>
        {v.sectionId && v.postId && available !== null && (
          <p className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", available > 0 ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700")}>
            <Info className="size-4" aria-hidden="true" /> {t("recruitment.available", { count: available })}
            {post && ` · ${t("employees.level", { level: post.payLevel })} · ${formatINR(basicIn(payMatrix, post.payLevel, 1))}`}
          </p>
        )}
        <Input label={t("recruitment.seats")} type="number" min={1} value={v.seats} onChange={(e) => setV({ ...v, seats: Number(e.target.value) })} error={msg(t, errors.seats)} containerClassName="sm:max-w-[10rem]" required />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-800">{t("recruitment.reservation")}</legend>
          <div className="grid grid-cols-5 gap-3">
            {RESERVATION_CATEGORIES.map((c) => (
              <Input key={c} label={c} type="number" min={0} value={reservation[c]} onChange={(e) => setReservation({ ...reservation, [c]: Number(e.target.value) })} />
            ))}
          </div>
          <p className={cn("text-xs", total === v.seats ? "text-ink-500" : "font-medium text-red-600")}>
            {msg(t, errors.reservation) ?? t("recruitment.reservationHint")} ({total}/{v.seats})
          </p>
        </fieldset>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Input label={t("recruitment.advertNumber")} value={v.advertNumber} onChange={(e) => setV({ ...v, advertNumber: e.target.value })} optionalLabel={t("common.optional")} />
          <Input label={t("recruitment.advertDate")} type="date" value={v.advertDate} onChange={(e) => setV({ ...v, advertDate: e.target.value })} optionalLabel={t("common.optional")} />
          <Input label={t("recruitment.lastDate")} type="date" value={v.lastDate} onChange={(e) => setV({ ...v, lastDate: e.target.value })} error={msg(t, errors.lastDate)} optionalLabel={t("common.optional")} />
        </div>
        <Textarea label={t("recruitment.notes")} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} optionalLabel={t("common.optional")} />
      </CardBody>
      <CardFooter>
        <Button variant="primary" loading={busy} onClick={submit} icon={<Send className="size-4" />} disabled={available === 0}>
          {t("recruitment.sendToAdmin")}
        </Button>
      </CardFooter>
    </Card>
  );
}
