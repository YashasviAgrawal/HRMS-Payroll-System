"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, Send } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

/** SL-05: a whole bill, or one section, as one PDF — in English or Hindi. */
export function BulkDownload({ runId, sections }: { runId: string; sections: { id: string; label: string }[] }) {
  const t = useT();
  const [section, setSection] = useState("");
  const href = (lang: "en" | "hi") => `/api/v1/payroll/runs/${runId}/payslips?lang=${lang}${section ? `&section=${section}` : ""}`;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select label={t("payroll.columns.section")} value={section} onChange={(e) => setSection(e.target.value)} containerClassName="min-w-52">
        <option value="">{t("payroll.payslips.allSections")}</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </Select>
      <a href={href("en")} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
        <Download className="size-4" aria-hidden="true" /> {t("payroll.payslips.downloadEn")}
      </a>
      <a href={href("hi")} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
        <Download className="size-4" aria-hidden="true" /> {t("payroll.payslips.downloadHi")}
      </a>
    </div>
  );
}

/** SL-04: send the SMS link and email to everyone in the bill not yet sent. */
export function SendNotices({ runId }: { runId: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      icon={<Send className="size-4" />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ sent: number }>(`/api/v1/payroll/runs/${runId}/notices`, { body: {} });
          toast(t("payroll.payslips.noticesSent", { count: r.sent }));
          router.refresh();
        } catch (err) {
          toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("payroll.payslips.send")}
    </Button>
  );
}
