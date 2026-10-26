import type { Metadata } from "next";
import { Download, FileSpreadsheet, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { getFile } from "@/lib/files";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { FILE_TONE } from "../tones";

export const metadata: Metadata = { title: "Generated file" };

interface Preview {
  columns: string[];
  rows: (string | number)[][];
  totalRows: number;
  totals?: Record<string, string | number>;
}

/** Preview → Admin approval → download (PRD §12 rule 2, ST-09). */
export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { t, locale } = await getT();
  const { id } = await params;
  const file = await getFile(actor, id);
  const meta = (file.meta ?? {}) as { preview?: Preview; link?: string };
  const preview = meta.preview;
  const ready = file.status === "APPROVED" || file.status === "DOWNLOADED";
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: t("files.title") }]}
        title={file.fileName}
        description={t("files.builtBy", { name: file.createdByName })}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={FILE_TONE[file.status]} dot>
              {tDynamic(t, `files.status.${file.status}`)}
            </Badge>
            {ready ? (
              <a href={`/api/v1/files/${file.id}/download`} download className={buttonClass("primary")}>
                <Download className="size-4" aria-hidden="true" /> {t("files.download")}
              </a>
            ) : null}
          </div>
        }
      />
      {!ready && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Lock className="size-4" aria-hidden="true" /> {t("files.notApproved")}
        </p>
      )}
      <Card>
        <CardBody>
          <DescriptionList
            columns={3}
            items={[
              { label: t("files.checksum"), value: <code className="break-all text-xs">{file.sha256}</code> },
              { label: t("common.createdOn"), value: formatDateTime(file.createdAt, locale) },
              { label: t("files.approved"), value: file.approvedAt ? formatDateTime(file.approvedAt, locale) : "—" },
              { label: t("files.rowCount"), value: preview?.totalRows ?? "—" },
              { label: t("files.download"), value: t("files.downloads", { count: file.downloadCount }) },
              { label: t("files.size"), value: `${(file.size / 1024).toFixed(1)} KB` },
            ]}
          />
        </CardBody>
      </Card>
      {preview && (
        <Card>
          <CardHeader title={t("files.preview")} description={t("files.showingFirst", { count: preview.rows.length })} icon={<FileSpreadsheet className="size-4.5" aria-hidden="true" />} />
          <Table>
            <THead>
              <tr>
                {preview.columns.map((c) => (
                  <Th key={c}>{c}</Th>
                ))}
              </tr>
            </THead>
            <tbody>
              {preview.rows.map((r, i) => (
                <Tr key={i}>
                  {r.map((cell, j) => (
                    <Td key={j} className="tabular whitespace-nowrap">
                      {cell}
                    </Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
