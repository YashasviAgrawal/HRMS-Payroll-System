"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

/** Calls an endpoint, shows the result, refreshes the screen. */
export function useAction() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function run<T>(key: string, url: string, body: unknown = {}, ok?: string, after?: (r: T) => void) {
    setBusy(key);
    try {
      const res = await api<T>(url, { body });
      if (ok) toast(ok);
      after?.(res);
      router.refresh();
      return res;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}

export function BuildFileButton({ url }: { url: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, run } = useAction();
  return (
    <Button size="sm" icon={<FilePlus2 className="size-4" />} loading={busy === "build"} onClick={() => run<{ id: string }>("build", url, {}, t("recruitment.files.built"), (r) => router.push(`/files/${r.id}`))}>
      {t("recruitment.files.build")}
    </Button>
  );
}

export function ConfirmProbationButton({ employeeId, defaultDate }: { employeeId: string; defaultDate: string }) {
  const t = useT();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [order, setOrder] = useState("");
  return (
    <>
      <Button size="sm" variant="subtle" icon={<BadgeCheck className="size-4" />} onClick={() => setOpen(true)}>
        {t("recruitment.probation.confirm")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("recruitment.probation.confirmTitle")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy === "confirm"}
              onClick={async () => {
                const r = await run("confirm", `/api/v1/recruitment/probation/${employeeId}/confirm`, { eventDate: date, orderNumber: order || undefined }, t("recruitment.probation.sent"));
                if (r) setOpen(false);
              }}
            >
              {t("employees.edit.submit")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label={t("recruitment.probation.confirmDate")} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label={t("employees.serviceBook.orderNo")} value={order} onChange={(e) => setOrder(e.target.value)} optionalLabel={t("common.optional")} />
        </div>
      </Dialog>
    </>
  );
}
