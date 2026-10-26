"use client";

import { useRef, useState } from "react";
import { Download, FileSearch, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { tDynamic } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

interface Row {
  row: number;
  employeeId: string | null;
  code: string;
  name: string;
  values: Record<string, number>;
  errors: string[];
}

async function post<T>(url: string, form: FormData): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const res = await fetch(url, { method: "POST", body: form });
  const p = (await res.json()) as { ok: boolean; data?: T; error?: { message: string; fields?: Record<string, string> } };
  return p.ok ? { ok: true, data: p.data! } : { ok: false, message: p.error?.fields?.file ?? p.error?.fields?.asOn ?? p.error?.message ?? "Error" };
}

/** LV-06: download the sheet, fill it from FoxPro / the paper account, check it, send it to a Checker. */
export function OpeningPanel({ defaultAsOn }: { defaultAsOn: string }) {
  const t = useT();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [asOn, setAsOn] = useState(defaultAsOn);
  const [result, setResult] = useState<{ rows: Row[]; codes: string[] } | null>(null);
  const [busy, setBusy] = useState<"check" | "send" | null>(null);
  const bad = result?.rows.filter((r) => r.errors.length) ?? [];

  const msg = (e: string) => {
    const [key, code] = e.split("|");
    return tDynamic(t, key, code ? { code } : undefined);
  };

  async function check() {
    if (!file) return;
    setBusy("check");
    const form = new FormData();
    form.set("file", file);
    const r = await post<{ rows: Row[]; codes: string[] }>("/api/v1/leave/opening/check", form);
    setBusy(null);
    if (!r.ok) return toast(r.message, "error");
    setResult(r.data);
  }

  async function send() {
    if (!file) return;
    setBusy("send");
    const form = new FormData();
    form.set("file", file);
    form.set("asOn", asOn);
    const r = await post<{ taskId: string }>("/api/v1/leave/opening/file", form);
    setBusy(null);
    if (!r.ok) return toast(r.message, "error");
    toast(t("leave.opening.sent"));
    setResult(null);
    setFile(null);
    if (input.current) input.current.value = "";
  }

  return (
    <Card>
      <CardHeader
        title={t("leave.opening.title")}
        description={t("leave.opening.hint")}
        actions={
          <a href="/api/v1/leave/opening/template" download className={buttonClass("ghost", "sm")}>
            <Download className="size-4" aria-hidden="true" /> {t("leave.opening.template")}
          </a>
        }
      />
      <CardBody className="grid gap-5 sm:grid-cols-2">
        <Input label={t("leave.opening.asOn")} type="date" value={asOn} onChange={(e) => setAsOn(e.target.value)} required />
        <div className="space-y-1.5">
          <label htmlFor="opening-file" className="text-sm font-medium text-ink-800">
            {t("leave.opening.file")}
          </label>
          <input
            ref={input}
            id="opening-file"
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
            }}
            className="block w-full rounded-lg border border-ink-200 bg-white text-sm text-ink-700 file:mr-3 file:h-10 file:border-0 file:bg-brand-50 file:px-4 file:font-medium file:text-brand-800"
          />
        </div>
      </CardBody>
      {result && (
        <CardBody className="space-y-3 border-t border-ink-100">
          {bad.length === 0 ? <Badge tone="green">{t("leave.opening.ready", { count: result.rows.length })}</Badge> : <p className="text-sm font-medium text-red-700">{t("leave.opening.fixFirst")}</p>}
          {bad.length > 0 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-red-100 bg-red-50/40 p-3 text-sm">
              {bad.map((r) => (
                <li key={r.row}>
                  <span className="font-medium text-ink-900">
                    {t("leave.opening.row", { row: r.row })} · {r.code} {r.name}
                  </span>
                  : <span className="text-red-700">{r.errors.map(msg).join("; ")}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      )}
      <CardFooter>
        <Button icon={<FileSearch className="size-4" />} onClick={check} loading={busy === "check"} disabled={!file}>
          {t("leave.opening.check")}
        </Button>
        {result && bad.length === 0 && (
          <Button variant="primary" icon={<Send className="size-4" />} onClick={send} loading={busy === "send"}>
            {t("leave.opening.send", { count: result.rows.length })}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
