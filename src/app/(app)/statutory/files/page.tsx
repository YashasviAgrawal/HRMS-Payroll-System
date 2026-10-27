import type { Metadata } from "next";
import Link from "next/link";
import { FileOutput, FolderOpen, TriangleAlert } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, formatMonth } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { monthFiles } from "@/modules/statutory/stat-files";
import { ActionButton } from "../_components/action-button";
import { FILE_TONE, kindKey, StatutoryTabs } from "../_components/statutory-tabs";
import { PeriodPicker } from "../_components/year-picker";

export const metadata: Metadata = { title: "Statutory files" };

/** ST-06, ST-09, S-52: the month's files for the CRA, EPFO, ESIC and the Board pension fund. */
export default async function StatutoryFilesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "statutory", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const data = await monthFiles(actor, (await searchParams).month);

  return (
    <div>
      <PageHeader title={t("statutory.title")} description={t("statutory.files.subtitle")} />
      <StatutoryTabs active="files" t={t} />
      {data.months.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-600">{t("statutory.files.noPayroll")}</p>
          </CardBody>
        </Card>
      ) : (
        <>
          <PeriodPicker options={data.months.slice(0, 12)} active={data.month} href={(m) => `/statutory/files?month=${m}`} label={t("statutory.files.pickMonth")} format={(m) => formatMonth(m, locale)} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {data.cards.map((c) => (
              <Card key={c.kind} className="flex flex-col" data-testid={`card-${c.kind}`}>
                <CardHeader
                  title={t(`statutory.files.kinds.${kindKey(c.kind)}`)}
                  description={tDynamic(t, `statutory.files.help.${kindKey(c.kind)}`)}
                  icon={<FileOutput className="size-4.5" aria-hidden="true" />}
                  actions={c.latest && <Badge tone={FILE_TONE[c.latest.status] ?? "gray"}>{tDynamic(t, `files.status.${c.latest.status}`)}</Badge>}
                />
                <CardBody className="flex-1 space-y-3">
                  {!c.ready ? (
                    <p className="text-sm text-ink-600">{t("statutory.files.notReady")}</p>
                  ) : c.people === 0 ? (
                    <p className="text-sm text-ink-600">{t("statutory.files.nobody")}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-ink-900">{t("statutory.people", { count: c.people })}</p>
                      <dl className="grid gap-1 text-sm">
                        {c.sums.map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-3">
                            <dt className="text-ink-600">{t(`statutory.files.sums.${k}`)}</dt>
                            <dd className="tabular font-medium text-ink-900">{formatINR(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  )}
                  {c.missing.length > 0 && (
                    <p className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      {t("statutory.files.leftOut", { list: c.missing.map((m) => `${m.code} ${m.name}`).join(", ") })}
                    </p>
                  )}
                  {c.latest && (
                    <p className="text-xs text-ink-500">
                      {t("statutory.files.latest")}:{" "}
                      <Link href={`/files/${c.latest.id}`} className="font-medium text-brand-700 hover:underline">
                        {c.latest.fileName}
                      </Link>{" "}
                      · {formatDateTime(c.latest.createdAt, locale)}
                    </p>
                  )}
                </CardBody>
                {data.canManage && c.ready && c.people > 0 && c.latest?.status !== "PREVIEW" && (
                  <CardFooter>
                    <ActionButton url="/api/v1/statutory/files" body={{ kind: c.kind, month: data.month }} done={t("statutory.files.made")} variant={c.latest ? "secondary" : "primary"} icon={<FileOutput className="size-4" />}>
                      {c.latest ? t("statutory.files.makeAgain") : t("statutory.files.make")}
                    </ActionButton>
                  </CardFooter>
                )}
              </Card>
            ))}
          </div>
          <Card className="mt-5">
            <CardHeader title={t("statutory.files.all", { month: formatMonth(data.month, locale) })} icon={<FolderOpen className="size-4.5" aria-hidden="true" />} />
            {data.files.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-600">{t("statutory.files.none")}</p>
              </CardBody>
            ) : (
              <Table stack>
                <THead>
                  <tr>
                    <Th>{t("statutory.files.file")}</Th>
                    <Th>{t("statutory.status")}</Th>
                    <Th>{t("statutory.files.madeBy")}</Th>
                    <Th>{t("statutory.files.checksum")}</Th>
                  </tr>
                </THead>
                <tbody>
                  {data.files.map((f) => (
                    <Tr key={f.id}>
                      <Td>
                        <Link href={`/files/${f.id}`} className="font-medium text-ink-900 hover:text-brand-700">
                          {f.fileName}
                        </Link>
                        <span className="block text-xs text-ink-500">{t(`statutory.files.kinds.${kindKey(f.kind)}`)}</span>
                      </Td>
                      <Td label={t("statutory.status")}>
                        <Badge tone={FILE_TONE[f.status] ?? "gray"}>{tDynamic(t, `files.status.${f.status}`)}</Badge>
                      </Td>
                      <Td label={t("statutory.files.madeBy")}>
                        {f.createdByName}
                        <span className="block text-xs text-ink-500">{formatDateTime(f.createdAt, locale)}</span>
                      </Td>
                      <Td label={t("statutory.files.checksum")} className="font-mono text-xs text-ink-500">
                        {f.sha256.slice(0, 16)}…
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
