"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Send, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

interface Row {
  row: number;
  name: string;
  employeeCode: string | null;
  errors: string[];
}

async function postFile<T>(url: string, file: File): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
  const payload = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!payload.ok) throw new ApiError(payload.error?.message ?? "Error", res.status, "upload");
  return payload.data!;
}

export function BulkUpload() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<"check" | "submit" | null>(null);
  const bad = rows?.filter((r) => r.errors.length) ?? [];
  const good = rows ? rows.length - bad.length : 0;

  async function check(f: File) {
    setFile(f);
    setRows(null);
    setBusy("check");
    try {
      setRows((await postFile<{ rows: Row[] }>("/api/v1/employees/bulk/check", f)).rows);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!file) return;
    setBusy("submit");
    try {
      const res = await postFile<{ count: number }>("/api/v1/employees/bulk/submit", file);
      toast(t("employees.bulk.sent", { count: res.count }));
      router.push("/employees?status=DRAFT");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardBody className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-semibold text-brand-700">1</span>
            <div className="space-y-3">
              <div>
                <p className="font-medium text-ink-900">{t("employees.bulk.step1")}</p>
                <p className="text-sm text-ink-500">{t("employees.bulk.step1Hint")}</p>
              </div>
              <a href="/api/v1/employees/bulk/template" download className={buttonClass("secondary", "sm")}>
                <Download className="size-4" aria-hidden="true" /> {t("employees.bulk.template")}
              </a>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-semibold text-brand-700">2</span>
            <div className="space-y-3">
              <div>
                <p className="font-medium text-ink-900">{t("employees.bulk.step2")}</p>
                <p className="text-sm text-ink-500">{t("employees.bulk.step2Hint")}</p>
              </div>
              <label className={buttonClass("secondary", "sm", "cursor-pointer")}>
                <Upload className="size-4" aria-hidden="true" /> {busy === "check" ? t("employees.bulk.checking") : t("employees.bulk.choose")}
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void check(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {file && (
                <p className="flex items-center gap-1.5 text-xs text-ink-500">
                  <FileSpreadsheet className="size-3.5" aria-hidden="true" /> {file.name}
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {rows && (
        <Card>
          <CardHeader
            title={t("employees.bulk.rows", { count: rows.length })}
            description={bad.length ? t("employees.bulk.fixAndRetry") : t("employees.bulk.allGood")}
            icon={bad.length ? <AlertTriangle className="size-4.5" aria-hidden="true" /> : <CheckCircle2 className="size-4.5" aria-hidden="true" />}
            actions={
              <div className="flex gap-2">
                <Badge tone="green">{t("employees.bulk.valid", { count: good })}</Badge>
                {bad.length > 0 && <Badge tone="red">{t("employees.bulk.problems", { count: bad.length })}</Badge>}
              </div>
            }
          />
          <Table>
            <THead>
              <tr>
                <Th>{t("employees.bulk.row")}</Th>
                <Th>{t("common.name")}</Th>
                <Th>{t("employees.bulk.problem")}</Th>
              </tr>
            </THead>
            <tbody>
              {(bad.length ? bad : rows).slice(0, 300).map((r) => (
                <Tr key={r.row}>
                  <Td className="tabular w-20 text-ink-500">{r.row}</Td>
                  <Td className="font-medium">
                    {r.name}
                    {r.employeeCode && <span className="ml-2 text-xs text-ink-400">{r.employeeCode}</span>}
                  </Td>
                  <Td>
                    {r.errors.length ? (
                      <ul className="list-disc space-y-0.5 pl-4 text-sm text-red-700">
                        {r.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    ) : (
                      <CheckCircle2 className="size-4 text-brand-600" aria-label="OK" />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {bad.length === 0 && rows.length > 0 && (
            <CardFooter>
              <Button variant="primary" loading={busy === "submit"} onClick={submit} icon={<Send className="size-4" />}>
                {t("employees.bulk.submit", { count: rows.length })}
              </Button>
            </CardFooter>
          )}
        </Card>
      )}
    </div>
  );
}
