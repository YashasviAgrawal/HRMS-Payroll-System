"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CheckCircle2, Download, FileSearch, Save, TriangleAlert } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { FORMAT_DEFS, PUNCH_FORMATS, type PunchFormat } from "@/modules/attendance/format-defs";

interface Check {
  rows: number;
  ready: number;
  alreadySaved: number;
  duplicatesInFile: number;
  unknownIds: { id: string; count: number }[];
  notOnRolls: number;
  locked: number;
  future: number;
  errors: { line: number; key: string; text: string }[];
  errorCount: number;
  from: string | null;
  to: string | null;
  people: number;
}

async function upload<T>(url: string, file: File, format: PunchFormat): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const data = new FormData();
  data.set("file", file);
  data.set("format", format);
  const res = await fetch(url, { method: "POST", body: data });
  const payload = (await res.json()) as { ok: boolean; data?: T; error?: { message: string; fields?: Record<string, string> } };
  if (!payload.ok) return { ok: false, message: payload.error?.fields?.file ?? payload.error?.message ?? "Error" };
  return { ok: true, data: payload.data! };
}

export function ImportPanel() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<PunchFormat>("ESSL");
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);

  async function runCheck() {
    if (!file) return;
    setBusy("check");
    const res = await upload<Check>("/api/v1/attendance/import/check", file, format);
    setBusy(null);
    if (!res.ok) {
      setCheck(null);
      return toast(res.message, "error");
    }
    setCheck(res.data);
  }

  async function save() {
    if (!file) return;
    setBusy("save");
    const res = await upload<Check>("/api/v1/attendance/import", file, format);
    setBusy(null);
    if (!res.ok) return toast(res.message, "error");
    toast(t("attendance.import.saved", { count: res.data.ready }));
    setCheck(null);
    setFile(null);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  const headings = FORMAT_DEFS[format].sample;

  const problems: { label: string; value: number; tone: "amber" | "red" | "gray" }[] = check
    ? [
        { label: t("attendance.import.alreadySaved"), value: check.alreadySaved, tone: "gray" as const },
        { label: t("attendance.import.duplicates"), value: check.duplicatesInFile, tone: "gray" as const },
        { label: t("attendance.import.unknown"), value: check.unknownIds.reduce((n, u) => n + u.count, 0), tone: "amber" as const },
        { label: t("attendance.import.notOnRolls"), value: check.notOnRolls, tone: "amber" as const },
        { label: t("attendance.import.locked"), value: check.locked, tone: "amber" as const },
        { label: t("attendance.import.future"), value: check.future, tone: "red" as const },
        { label: t("attendance.import.errors"), value: check.errorCount, tone: "red" as const },
      ].filter((p) => p.value > 0)
    : [];

  return (
    <Card>
      <CardHeader
        title={t("attendance.tabs.import")}
        description={t("attendance.import.hint")}
        icon={<FileSearch className="size-4.5" aria-hidden="true" />}
        actions={
          <a href="/api/v1/attendance/import/template" download className={buttonClass("ghost", "sm")}>
            <Download className="size-4" aria-hidden="true" /> {t("attendance.import.template")}
          </a>
        }
      />
      <CardBody className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Select
          label={t("attendance.import.format")}
          value={format}
          onChange={(e) => {
            setFormat(e.target.value as PunchFormat);
            setCheck(null);
          }}
          hint={`${t("attendance.import.headings")}: ${headings.join(", ")}`}
        >
          {PUNCH_FORMATS.map((f) => (
            <option key={f} value={f}>
              {tDynamic(t, `attendance.import.formats.${f}`)}
            </option>
          ))}
        </Select>
        <div className="space-y-1.5">
          <label htmlFor="punch-file" className="text-sm font-medium text-ink-800">
            {t("attendance.import.file")}
          </label>
          <input
            ref={input}
            id="punch-file"
            type="file"
            accept=".xlsx,.csv,.txt,.dat"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setCheck(null);
            }}
            className="block w-full rounded-lg border border-ink-200 bg-white text-sm text-ink-700 file:mr-3 file:h-10 file:border-0 file:bg-brand-50 file:px-4 file:font-medium file:text-brand-800 hover:file:bg-brand-100"
          />
          <p className="text-xs text-ink-500">{t("attendance.import.fileHint")}</p>
        </div>
      </CardBody>

      {check && (
        <CardBody className="border-t border-ink-100">
          <h3 className="text-sm font-semibold text-ink-900">{t("attendance.import.checkTitle")}</h3>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-brand-50 p-4 ring-1 ring-brand-600/10">
              <p className="text-xs font-medium text-brand-800">{t("attendance.import.ready")}</p>
              <p className="tabular mt-1 text-2xl font-semibold text-brand-900" data-testid="ready-count">
                {check.ready}
              </p>
            </div>
            <div className="rounded-xl bg-ink-50 p-4">
              <p className="text-xs font-medium text-ink-600">{t("attendance.import.rows")}</p>
              <p className="tabular mt-1 text-2xl font-semibold text-ink-900">{check.rows + check.errorCount}</p>
            </div>
            <div className="rounded-xl bg-ink-50 p-4">
              <p className="text-xs font-medium text-ink-600">{t("attendance.import.people")}</p>
              <p className="tabular mt-1 text-2xl font-semibold text-ink-900">{check.people}</p>
            </div>
            <div className="rounded-xl bg-ink-50 p-4">
              <p className="text-xs font-medium text-ink-600">{t("attendance.import.period")}</p>
              <p className="mt-1 text-sm font-semibold text-ink-900">{check.from ? `${formatDate(check.from, locale)} – ${formatDate(check.to, locale)}` : "—"}</p>
            </div>
          </div>
          {problems.length > 0 ? (
            <div className="mt-4 space-y-3">
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {problems.map((p) => (
                  <li key={p.label} className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-sm", p.tone === "red" ? "bg-red-50 text-red-800" : p.tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-ink-50 text-ink-700")}>
                    <span className="flex items-center gap-2">
                      {p.tone !== "gray" && <TriangleAlert className="size-4" aria-hidden="true" />}
                      {p.label}
                    </span>
                    <span className="tabular font-semibold">{p.value}</span>
                  </li>
                ))}
              </ul>
              {check.unknownIds.length > 0 && (
                <p className="text-sm text-ink-600">
                  {t("attendance.import.unknown")}: <span className="tabular font-medium text-ink-900">{check.unknownIds.slice(0, 12).map((u) => `${u.id} (${u.count})`).join(", ")}</span>. {t("attendance.import.unknownHint")}
                </p>
              )}
              {check.errors.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-ink-100 p-3 text-xs text-ink-600">
                  {check.errors.map((e) => (
                    <li key={e.line}>
                      <span className="font-medium text-ink-800">{t("attendance.import.line", { line: e.line })}</span> · {tDynamic(t, e.key)} · <span className="text-ink-400">{e.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-ink-500">{t("attendance.import.skippedNote")}</p>
            </div>
          ) : (
            <p className="mt-4 flex items-center gap-2 text-sm text-brand-800">
              <CheckCircle2 className="size-4" aria-hidden="true" /> {t("attendance.import.allGood")}
            </p>
          )}
        </CardBody>
      )}

      <CardFooter>
        <Button icon={<FileSearch className="size-4" />} onClick={runCheck} loading={busy === "check"} disabled={!file}>
          {t("attendance.import.check")}
        </Button>
        {check && check.ready > 0 && (
          <Button variant="primary" icon={<Save className="size-4" />} onClick={save} loading={busy === "save"}>
            {t("attendance.import.save", { count: check.ready })}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
