"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, CheckCircle2, Circle, Paperclip, Send, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { CHECKLIST_ITEMS, type Checklist, type ChecklistItem } from "@/modules/recruitment/schema";
import { uploadDoc } from "../../../employees/_components/widgets";
import { useAction } from "../../widgets";

export function JoiningActions({ joiningId, ready }: { joiningId: string; ready: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const { busy, run } = useAction();
  return (
    <>
      <Button
        size="sm"
        variant="danger"
        icon={<XCircle className="size-4" />}
        loading={busy === "cancel"}
        onClick={() => window.confirm(t("recruitment.joining.cancelConfirm")) && run("cancel", `/api/v1/recruitment/joinings/${joiningId}/cancel`, {}, t("recruitment.joining.cancelled"), () => router.push("/recruitment?tab=joining"))}
      >
        {t("recruitment.joining.cancel")}
      </Button>
      <Button size="sm" variant="primary" icon={<Send className="size-4" />} disabled={!ready} loading={busy === "done"} onClick={() => run("done", `/api/v1/recruitment/joinings/${joiningId}/complete`, {}, t("recruitment.joining.sent"))}>
        {t("recruitment.joining.complete")}
      </Button>
    </>
  );
}

function Item({ item, state, joiningId, employeeId, editable, docTitle }: { item: ChecklistItem; state: Checklist[ChecklistItem]; joiningId: string; employeeId: string; editable: boolean; docTitle?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function update(done: boolean, documentId?: string) {
    setBusy(true);
    try {
      await api(`/api/v1/recruitment/joinings/${joiningId}/checklist`, { body: { item, done, documentId } });
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={cn("flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6", state.done && "bg-brand-50/40")}>
      {state.done ? <CheckCircle2 className="size-5 shrink-0 text-brand-600" aria-hidden="true" /> : <Circle className="size-5 shrink-0 text-ink-300" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium", state.done ? "text-ink-900" : "text-ink-700")}>{tDynamic(t, `recruitment.joining.items.${item}`)}</p>
        {(state.done || docTitle) && (
          <p className="text-xs text-ink-500">
            {state.by && `${state.by}`}
            {docTitle && (
              <a href={`/api/v1/documents/${state.documentId}?view=1`} target="_blank" rel="noopener" className="ml-2 inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                <Paperclip className="size-3" aria-hidden="true" /> {docTitle}
              </a>
            )}
          </p>
        )}
      </div>
      {editable && (
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="sr-only"
            aria-label={t("recruitment.joining.attach")}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              try {
                const id = await uploadDoc(employeeId, f, item === "medical" ? "MEDICAL" : item === "pan" || item === "aadhaarConsent" ? "ID_PROOF" : "CERTIFICATE", tDynamic(t, `recruitment.joining.items.${item}`));
                await update(true, id);
              } catch (err) {
                toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
                setBusy(false);
              }
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="ghost" icon={<Paperclip className="size-4" />} disabled={busy} onClick={() => fileRef.current?.click()}>
            {state.documentId ? t("recruitment.joining.attached") : t("recruitment.joining.attach")}
          </Button>
          {state.done ? (
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} loading={busy} onClick={() => update(false)}>
              {t("recruitment.joining.undo")}
            </Button>
          ) : (
            <Button size="sm" variant="subtle" icon={<Check className="size-4" />} loading={busy} onClick={() => update(true)}>
              {t("recruitment.joining.markDone")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function ChecklistPanel({ joiningId, employeeId, editable, checklist, documents }: { joiningId: string; employeeId: string; editable: boolean; checklist: Checklist; documents: { id: string; title: string }[] }) {
  return (
    <ul className="divide-y divide-ink-100">
      {CHECKLIST_ITEMS.map((item) => (
        <Item
          key={item}
          item={item}
          state={checklist[item]}
          joiningId={joiningId}
          employeeId={employeeId}
          editable={editable}
          docTitle={documents.find((d) => d.id === checklist[item].documentId)?.title}
        />
      ))}
    </ul>
  );
}
