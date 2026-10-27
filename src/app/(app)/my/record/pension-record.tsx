import { Banknote, Briefcase, Info, Landmark, Users } from "lucide-react";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { Actor } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { pensionerProfile } from "@/modules/pension/pensioners";

/** PN-12: a pensioner's own record — the pension, how it is paid, the service it comes from, and the family. */
export async function PensionRecord({ actor }: { actor: Actor }) {
  const { t, locale } = await getT();
  const d = await pensionerProfile(actor, actor.pensionerId!);
  const p = d.pensioner;
  const hi = locale === "hi";
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("pension.my.recordTitle")} description={`${p.ppoNumber} · ${p.typeLabel[hi ? 1 : 0]}`} />
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-brand-900">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{t("pension.my.changeHow")}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("pension.profile.pensionNow")} icon={<Landmark className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: t("pension.fields.basic"), value: <span className="tabular font-semibold text-ink-950">{formatINR(p.basic)}</span> },
                ...(p.reduced ? [{ label: t("pension.fields.reduced"), value: t("pension.profile.reducedFrom", { amount: formatINR(p.reduced.amount), date: formatDate(p.reduced.from, locale) }) }] : []),
                { label: t("pension.profile.addl"), value: p.addlPct ? t("pension.profile.addlNow", { pct: p.addlPct, age: p.age }) : t("pension.profile.addlFrom80") },
                { label: t("pension.profile.dr"), value: `${p.drRate}%` },
                { label: t("pension.fields.fma"), value: p.fma ? t("common.yes") : t("pension.profile.noFma") },
                ...(p.commuted ? [{ label: t("pension.fields.commuted"), value: p.restored ? t("pension.profile.restored", { amount: formatINR(p.commuted), date: formatDate(p.restoredOn, locale) }) : t("pension.profile.commutedTill", { amount: formatINR(p.commuted), date: formatDate(p.restoredOn, locale) }) }] : []),
                { label: t("pension.profile.since"), value: formatDate(p.startDate, locale) },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("pension.profile.payee")} icon={<Banknote className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: t("pension.fields.payee"), value: hi && p.payeeHi ? p.payeeHi : p.payee },
                { label: t("pension.fields.dob"), value: formatDate(p.payeeDob, locale) },
                { label: t("pension.fields.mobile"), value: p.mobile ?? "—" },
                { label: t("pension.fields.account"), value: p.bank.last4 ? `••••${p.bank.last4} · ${p.bank.ifsc ?? ""}` : "—" },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("pension.profile.service")} icon={<Briefcase className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: t("pension.profile.of"), value: hi && d.employee.nameHi ? d.employee.nameHi : d.employee.name },
                { label: t("pension.profile.post"), value: `${hi ? d.employee.post.nameHi : d.employee.post.name} — ${hi ? d.employee.section.nameHi : d.employee.section.name}` },
                { label: t("pension.profile.joined"), value: formatDate(d.employee.dateOfJoining, locale) },
                { label: t("pension.profile.lastDay"), value: formatDate(d.employee.lastDay, locale) },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("pension.profile.family")} description={t("pension.profile.familyHelp")} icon={<Users className="size-4.5" aria-hidden="true" />} />
          {d.family.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("pension.profile.noFamily")}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-ink-100">
              {d.family.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm sm:px-6">
                  <span className="font-medium text-ink-900">{m.name}</span>
                  <span className="text-ink-500">{tDynamic(t, `pension.relation.${m.relation}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
