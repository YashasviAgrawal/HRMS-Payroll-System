"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import { upload } from "../_components/upload";

type Result = { matched: { file: string; code: string; name: string }[]; unmatched: { file: string; reason: "noPan" | "notPdf" | "noEmployee" | "tooBig" }[] };

/** ST-07: Part A PDFs from TRACES, matched by the PAN in each file name. */
export function PartAImport({ fy }: { fy: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  async function send(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("fy", fy);
      for (const f of Array.from(files)) form.append("files", f);
      const r = await upload<Result>("/api/v1/statutory/form16/part-a", form);
      setResult(r);
      toast(t("statutory.form16.imported", { matched: r.matched.length, unmatched: r.unmatched.length }), r.unmatched.length ? "warning" : "success");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast(err.message, "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div>
      <input ref={input} id="part-a-files" type="file" accept="application/pdf,.pdf" multiple className="sr-only" onChange={(e) => send(e.target.files)} aria-label={t("statutory.form16.importA")} />
      <Button variant="secondary" icon={<FileUp className="size-4" />} loading={busy} onClick={() => input.current?.click()}>
        {t("statutory.form16.importA")}
      </Button>
      {result && result.unmatched.length > 0 && (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">{t("statutory.form16.unmatched")}</p>
          <ul className="mt-1 list-disc pl-5">
            {result.unmatched.map((u) => (
              <li key={u.file}>
                {u.file} — {t(`statutory.form16.reasons.${u.reason}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
