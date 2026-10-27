"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, IdCard, Landmark, ListChecks, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, DescriptionList } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { basicIn, type MatrixLevels } from "@/modules/payroll/matrix-7cpc";
import { crossCheck, idsSchema, isMatrixType, jobSchema, personalSchema } from "@/modules/employees/schema";
import { IdsFields, issuesToErrors, JobFields, PersonalFields, type Errors, type Option, type PostOption, type Values } from "../_components/fields";

const STEPS = ["personal", "job", "ids", "review"] as const;
type Step = (typeof STEPS)[number];

export function CreateEmployeeForm({ sections, posts, payMatrix }: { sections: Option[]; posts: PostOption[]; payMatrix: MatrixLevels }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [step, setStep] = useState<Step>("personal");
  const [personal, setPersonal] = useState<Values>({ isDisabled: false });
  const [job, setJob] = useState<Values>({});
  const [ids, setIds] = useState<Values>({});
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const index = STEPS.indexOf(step);

  function validate(s: Step): boolean {
    let errs: Errors = {};
    if (s === "personal") {
      const r = personalSchema.safeParse(personal);
      if (!r.success) errs = issuesToErrors(r.error.issues, "personal.");
    } else if (s === "job") {
      const r = jobSchema.safeParse(job);
      if (!r.success) errs = issuesToErrors(r.error.issues, "job.");
      else {
        const p = personalSchema.safeParse(personal);
        if (p.success) errs = crossCheck(p.data, r.data, undefined, payMatrix);
      }
    } else if (s === "ids") {
      const r = idsSchema.safeParse(ids);
      if (!r.success) errs = issuesToErrors(r.error.issues, "ids.");
      else if (r.data.bankAccount && !r.data.ifsc) errs = { "ids.ifsc": "validation.required" };
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function next() {
    if (!validate(step)) return;
    setStep(STEPS[index + 1]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ id: string }>("/api/v1/employees", { body: { personal, job, ids, note } });
      toast(t("employees.create.sent"));
      router.push(`/employees/${res.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        const first = Object.keys(err.fields)[0];
        const target = first?.split(".")[0] as Step | undefined;
        if (target && STEPS.includes(target)) setStep(target);
        toast(err.message, "error");
      }
      setBusy(false);
    }
  }

  const stepMeta = {
    personal: { icon: UserRound, label: t("employees.tabs.personal") },
    job: { icon: IdCard, label: t("employees.tabs.job") },
    ids: { icon: Landmark, label: t("employees.tabs.ids") },
    review: { icon: ListChecks, label: t("employees.create.review") },
  };
  const section = sections.find((s) => s.id === job.sectionId);
  const post = posts.find((p) => p.id === job.postId);
  const name = (o?: Option) => (o ? (locale === "hi" ? o.nameHi : o.name) : "—");

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-4 gap-2" aria-label={t("employees.create.step", { n: index + 1, total: STEPS.length })}>
        {STEPS.map((s, i) => {
          const Icon = stepMeta[s].icon;
          const state = i < index ? "done" : i === index ? "current" : "todo";
          return (
            <li key={s} aria-current={state === "current" ? "step" : undefined}>
              <button
                type="button"
                disabled={i > index}
                onClick={() => i < index && setStep(s)}
                className={cn(
                  "flex w-full flex-col items-center gap-2 rounded-xl border px-2 py-3 text-center text-xs font-medium transition-colors sm:flex-row sm:text-sm",
                  state === "current" && "border-brand-500 bg-brand-50 text-brand-800",
                  state === "done" && "border-brand-200 bg-white text-brand-700 hover:bg-brand-50",
                  state === "todo" && "border-ink-200 bg-white text-ink-400",
                )}
              >
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", state === "todo" ? "bg-ink-100" : "bg-brand-600 text-white")}>
                  {state === "done" ? <Check className="size-4" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
                </span>
                <span className="leading-tight">{stepMeta[s].label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <Card>
        <CardHeader title={stepMeta[step].label} description={step === "review" ? t("employees.create.reviewHint") : t("employees.create.step", { n: index + 1, total: STEPS.length })} />
        <CardBody>
          {step === "personal" && <PersonalFields values={personal} onChange={setPersonal} errors={errors} prefix="personal." />}
          {step === "job" && <JobFields values={job} onChange={setJob} errors={errors} prefix="job." sections={sections} posts={posts} payMatrix={payMatrix} />}
          {step === "ids" && <IdsFields values={ids} onChange={setIds} errors={errors} prefix="ids." />}
          {step === "review" && (
            <div className="space-y-6">
              <DescriptionList
                columns={3}
                items={[
                  { label: t("employees.fields.name"), value: [personal.firstName, personal.middleName, personal.lastName].filter(Boolean).join(" ") },
                  { label: t("employees.fields.nameHi"), value: (personal.nameHi as string) || "—" },
                  { label: t("employees.fields.dateOfBirth"), value: formatDate(personal.dateOfBirth as string, locale) },
                  { label: t("employees.fields.type"), value: job.type ? tDynamic(t, `employees.type.${job.type}`) : "—" },
                  { label: t("employees.fields.postId"), value: name(post) },
                  { label: t("employees.fields.sectionId"), value: name(section) },
                  { label: t("employees.fields.dateOfJoining"), value: formatDate(job.dateOfJoining as string, locale) },
                  {
                    label: t("employees.fields.basicPay"),
                    value: isMatrixType(String(job.type)) ? `${t("employees.level", { level: String(job.payLevel) })} · ${job.payCell} · ${formatINR(basicIn(payMatrix, String(job.payLevel), Number(job.payCell)))}` : job.wageRate ? `${formatINR(Number(job.wageRate))} ${job.wageBasis === "DAILY" ? t("employees.wageBasis.DAILY") : t("employees.wageBasis.MONTHLY")}` : "—",
                  },
                  { label: t("employees.fields.mobile"), value: (personal.mobile as string) || "—" },
                  { label: t("employees.fields.pan"), value: ids.pan ? `XXXXXX${String(ids.pan).slice(-4)}` : "—" },
                  { label: t("employees.fields.aadhaar"), value: ids.aadhaar ? `XXXX XXXX ${String(ids.aadhaar).replace(/\D/g, "").slice(-4)}` : "—" },
                  { label: t("employees.fields.bankAccount"), value: ids.bankAccount ? `XXXX${String(ids.bankAccount).slice(-4)} · ${ids.ifsc ?? ""}` : "—" },
                ]}
              />
              <Textarea label={t("employees.edit.noteLabel")} placeholder={t("employees.edit.notePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} optionalLabel={t("common.optional")} />
            </div>
          )}
        </CardBody>
        <CardFooter className="justify-between">
          <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStep(STEPS[Math.max(0, index - 1)])} disabled={index === 0}>
            {t("common.back")}
          </Button>
          {step === "review" ? (
            <Button variant="primary" onClick={submit} loading={busy} icon={<Check className="size-4" />}>
              {t("employees.create.submit")}
            </Button>
          ) : (
            <Button variant="primary" onClick={next}>
              {t("common.next")} <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
