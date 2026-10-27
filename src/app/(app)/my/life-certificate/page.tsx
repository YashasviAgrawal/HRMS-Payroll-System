import type { Metadata } from "next";
import { BadgeCheck, CalendarClock, Fingerprint, Landmark } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { myLifeCertificate } from "@/modules/pension/life-certificates";
import { LC_TONE } from "../../pension/_components/pension-tabs";
import { UploadCertificate } from "./upload-certificate";

export const metadata: Metadata = { title: "My life certificate" };

/** PN-06, PN-12: the pensioner's life certificate — when it is due, how to give it, and a Jeevan Pramaan upload. */
export default async function MyLifeCertificatePage() {
  const actor = await requireActor();
  if (!actor.pensionerId) return <NoAccess />;
  const { t, locale } = await getT();
  const d = await myLifeCertificate(actor);
  const waiting = d.certificates.some((c) => c.status === "SUBMITTED");
  const tone = LC_TONE[d.lc.state];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("pension.my.lcTitle")} description={t("pension.my.lcSubtitle", { ppo: d.ppoNumber })} />
      <Card className={cn("mb-5 border-2", tone === "green" ? "border-brand-200" : tone === "amber" ? "border-amber-200" : "border-red-200")} data-testid="lc-status">
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-ink-600">{t("pension.my.lcGoodUntil")}</p>
            <p className="text-2xl font-semibold tracking-tight text-ink-950">{formatDate(d.lc.validTill, locale)}</p>
            <p className="mt-1 text-sm text-ink-600">{tDynamic(t, `pension.my.lcState.${d.lc.state}`, { hold: formatDate(d.lc.holdFrom, locale) })}</p>
          </div>
          <Badge tone={tone} dot>
            {tDynamic(t, `pension.lc.state.${d.lc.state}`)}
          </Badge>
        </CardBody>
      </Card>

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title={t("pension.my.howJp")} icon={<Fingerprint className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
              <li>{t("pension.my.jp1")}</li>
              <li>{t("pension.my.jp2")}</li>
              <li>{t("pension.my.jp3")}</li>
            </ol>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("pension.my.howOffice")} icon={<Landmark className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <p className="text-sm text-ink-700">{t("pension.my.office")}</p>
          </CardBody>
        </Card>
      </div>

      {d.status === "ACTIVE" && (
        <Card className="mb-5">
          <CardHeader title={t("pension.my.upload")} description={t("pension.my.uploadHelp")} icon={<BadgeCheck className="size-4.5" aria-hidden="true" />} />
          <CardBody>{waiting ? <p className="text-sm font-medium text-amber-800">{t("pension.my.waiting")}</p> : <UploadCertificate />}</CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t("pension.my.history")} icon={<CalendarClock className="size-4.5" aria-hidden="true" />} />
        {d.certificates.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("pension.lc.none")}</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-ink-100">
            {d.certificates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm sm:px-6">
                <span>
                  <span className="font-medium text-ink-900">{formatDate(c.certifiedOn, locale)}</span>
                  <span className="ml-2 text-ink-500">{tDynamic(t, `pension.lc.sources.${c.source}`)}</span>
                  {c.note && <span className="block text-xs text-red-700">{c.note}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={c.status === "VERIFIED" ? "green" : c.status === "SUBMITTED" ? "amber" : "red"}>{tDynamic(t, `pension.lc.status.${c.status}`)}</Badge>
                  {c.hasFile && (
                    <a href={`/api/v1/pension/life-certificates/${c.id}/file`} target="_blank" rel="noopener" className="font-medium text-brand-700 hover:underline">
                      {t("pension.lc.open")}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
