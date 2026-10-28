"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpenCheck, FileUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiForm } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import type { ServiceBookUpload } from "@/modules/employees/records";

const BATCH = 20;

export function ServiceBookUploader({ maxMb }: { maxMb: number }) {
  const t = useT();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ServiceBookUpload[]>([]);

  async function upload() {
    setBusy(true);
    setDone(0);
    const all: ServiceBookUpload[] = [];
    try {
      // The server takes 20 files a request; larger choices go in turns.
      for (let i = 0; i < files.length; i += BATCH) {
        const form = new FormData();
        for (const f of files.slice(i, i + BATCH)) form.append("files", f);
        all.push(...(await apiForm<ServiceBookUpload[]>("/api/v1/employees/service-books", form)));
        setDone(Math.min(files.length, i + BATCH));
        setResults([...all]);
      }
      toast(t("employees.serviceBookScans.done", { saved: all.filter((r) => r.status === "saved").length, total: all.length }));
      setFiles([]);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Input
            label={t("employees.serviceBookScans.choose", { mb: maxMb })}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
            containerClassName="min-w-0 flex-1"
            className="py-1.5"
            data-testid="service-book-files"
          />
          <Button variant="primary" icon={<FileUp className="size-4" aria-hidden="true" />} loading={busy} disabled={!files.length} onClick={upload}>
            {busy ? t("employees.serviceBookScans.sending", { done, total: files.length }) : t("employees.serviceBookScans.send", { count: files.length })}
          </Button>
        </CardBody>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader title={t("employees.serviceBookScans.done", { saved: results.filter((r) => r.status === "saved").length, total: results.length })} icon={<BookOpenCheck className="size-4.5" aria-hidden="true" />} />
          <Table stack>
            <THead>
              <tr>
                <Th>{t("employees.serviceBookScans.file")}</Th>
                <Th>{t("employees.serviceBookScans.employee")}</Th>
                <Th>{t("employees.serviceBookScans.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {results.map((r, i) => (
                <Tr key={`${r.fileName}-${i}`}>
                  <Td className="font-medium text-ink-900">{r.fileName}</Td>
                  <Td label={t("employees.serviceBookScans.employee")}>
                    {r.employeeId ? (
                      <Link href={`/employees/${r.employeeId}?tab=serviceBook`} className="text-brand-700 hover:underline">
                        {r.employeeCode} · {r.name}
                      </Link>
                    ) : (
                      (r.employeeCode ?? "—")
                    )}
                  </Td>
                  <Td label={t("employees.serviceBookScans.status")}>
                    <Badge tone={r.status === "saved" ? "green" : "red"} dot>
                      {r.status === "noEmployee" ? t("employees.serviceBookScans.result.noEmployee", { code: r.employeeCode ?? "" }) : t(`employees.serviceBookScans.result.${r.status}`)}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
