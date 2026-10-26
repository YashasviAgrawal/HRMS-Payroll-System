"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Banknote, Check, CheckCircle2, Clock, CornerUpLeft, Download, FileUp, KeyRound, Lock, RefreshCw, RotateCcw, Send, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { OtpInput } from "@/components/ui/otp-input";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import type { RunStatus } from "@/modules/payroll/present";

interface FileInfo {
  id: string;
  status: string;
  fileName: string;
}

interface Props {
  runId: string;
  status: RunStatus;
  can: { run: boolean; resolve: boolean; submit: boolean; withdraw: boolean; check: boolean; approve: boolean; reopen: boolean; bankFile: boolean; returnFile: boolean; repay: boolean; close: boolean };
  open: number;
  failed: number;
  bankFile: (FileInfo & { sha256: string; downloadCount: number }) | null;
  files: (FileInfo & { kind: string })[];
  approvedBy: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  returnAt: string | null;
  payGroup: string;
  month: string;
}

/** What the person looking at the payroll can do at its current stage (S-40). */
export function StagePanel(p: Props) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [challenge, setChallenge] = useState<{ challengeId: string; sentTo: string; devOtp?: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | undefined>();
  const [reopen, setReopen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function call(key: string, url: string, body: unknown, ok: string) {
    setBusy(key);
    try {
      await api(url, { body });
      toast(ok);
      setNote("");
      router.refresh();
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields.note) setNoteError(err.fields.note);
        if (err.fields.otp || err.code.startsWith("otp")) setOtpError(err.fields.otp ?? err.message);
        toast(err.message, "error");
      } else toast(t("errors.generic"), "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const needNote = () => {
    if (note.trim()) return true;
    setNoteError(t("payroll.actions.remarksNeeded"));
    return false;
  };

  async function sendOtp() {
    setBusy("otp");
    setOtpError(undefined);
    try {
      const c = await api<{ challengeId: string; sentTo: string; devOtp?: string }>(`/api/v1/payroll/runs/${p.runId}/sign-otp`, { body: {} });
      setChallenge(c);
      setOtp("");
      toast(t("payroll.actions.otpSent", { mobile: c.sentTo }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    } finally {
      setBusy(null);
    }
  }

  async function uploadReturn(file: File) {
    setBusy("return");
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/v1/payroll/runs/${p.runId}/return-file`, { method: "POST", body: form });
    const payload = (await res.json().catch(() => null)) as { ok: boolean; data?: { failed: number; credited: number }; error?: { message: string; fields?: Record<string, string> } } | null;
    setBusy(null);
    if (fileInput.current) fileInput.current.value = "";
    if (!payload?.ok) return toast(payload?.error?.fields?.file ?? payload?.error?.message ?? t("errors.generic"), "error");
    toast(t("payroll.actions.returnRead", { failed: payload.data!.failed, credited: payload.data!.credited }));
    router.refresh();
  }

  const fileLink = (f: FileInfo, label?: string) => (
    <Link href={`/files/${f.id}`} className={buttonClass("secondary", "sm")}>
      <Download className="size-4" aria-hidden="true" /> {label ?? t("payroll.actions.openFile")}
    </Link>
  );

  const remarks = (
    <Textarea
      label={t("payroll.actions.remarks")}
      value={note}
      onChange={(e) => {
        setNote(e.target.value);
        setNoteError(undefined);
      }}
      error={noteError}
      maxLength={1000}
      rows={2}
    />
  );

  // ── Stage 1–2: draft ──
  if (p.status === "DRAFT") {
    if (!p.can.run) return <Waiting text={t("payroll.actions.notYours")} />;
    return (
      <Card>
        <CardHeader title={t("payroll.actions.sendToChecker")} description={t("payroll.actions.sendHelp")} icon={<Send className="size-4.5" aria-hidden="true" />} />
        <CardBody className="space-y-3">
          <Textarea label={t("payroll.actions.noteForChecker")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
          <p className="text-xs text-ink-500">{t("payroll.runAgainHelp")}</p>
        </CardBody>
        <CardFooter className="justify-between">
          <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={busy === "rerun"} onClick={() => call("rerun", `/api/v1/payroll/runs/${p.runId}/rerun`, {}, t("payroll.runDone"))}>
            {t("payroll.runAgain")}
          </Button>
          <Button variant="primary" icon={<Send className="size-4" />} loading={busy === "submit"} disabled={!p.can.submit} onClick={() => call("submit", `/api/v1/payroll/runs/${p.runId}/submit`, { note: note.trim() || undefined }, t("payroll.actions.sent"))}>
            {p.open ? t("payroll.toFix", { count: p.open }) : t("payroll.actions.sendToChecker")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // ── Stage 3: check ──
  if (p.status === "CHECKING") {
    if (p.can.check) {
      return (
        <Card>
          <CardHeader title={t("payroll.actions.checkTitle")} description={t("payroll.actions.checkHelp")} icon={<CheckCircle2 className="size-4.5" aria-hidden="true" />} />
          <CardBody>{remarks}</CardBody>
          <CardFooter className="justify-between">
            <Button variant="secondary" icon={<CornerUpLeft className="size-4" />} loading={busy === "return"} onClick={() => needNote() && call("return", `/api/v1/payroll/runs/${p.runId}/check`, { decision: "RETURN", note }, t("payroll.actions.returnedToast"))}>
              {t("payroll.actions.returnIt")}
            </Button>
            <Button variant="primary" icon={<Check className="size-4" />} loading={busy === "forward"} onClick={() => call("forward", `/api/v1/payroll/runs/${p.runId}/check`, { decision: "APPROVE", note: note.trim() || undefined }, t("payroll.actions.forwarded"))}>
              {t("payroll.actions.forward")}
            </Button>
          </CardFooter>
        </Card>
      );
    }
    return (
      <Waiting text={t("payroll.actions.waitingChecker")}>
        {p.can.withdraw && (
          <Button size="sm" variant="secondary" icon={<Undo2 className="size-4" />} loading={busy === "withdraw"} onClick={() => call("withdraw", `/api/v1/payroll/runs/${p.runId}/withdraw`, {}, t("payroll.actions.withdrawn"))}>
            {t("payroll.actions.withdraw")}
          </Button>
        )}
      </Waiting>
    );
  }

  // ── Stage 4: approve and sign ──
  if (p.status === "APPROVING") {
    if (!p.can.approve) return <Waiting text={t("payroll.actions.waitingAdmin")} />;
    return (
      <Card>
        <CardHeader title={t("payroll.actions.approveTitle")} description={t("payroll.actions.approveHelp")} icon={<KeyRound className="size-4.5" aria-hidden="true" />} />
        <CardBody className="space-y-4">
          {remarks}
          {challenge && (
            <div className="max-w-sm space-y-2">
              <p className="text-sm text-ink-600">{t("payroll.actions.otpSent", { mobile: challenge.sentTo })}</p>
              {challenge.devOtp && <p className="text-xs text-gold-600" data-testid="dev-otp">{t("login.devOtp", { otp: challenge.devOtp })}</p>}
              <OtpInput value={otp} onChange={(v) => { setOtp(v); setOtpError(undefined); }} label={t("payroll.actions.otp")} invalid={Boolean(otpError)} autoFocus />
              {otpError && <p className="text-sm text-red-600" role="alert">{otpError}</p>}
            </div>
          )}
        </CardBody>
        <CardFooter className="justify-between">
          <Button variant="secondary" icon={<CornerUpLeft className="size-4" />} loading={busy === "return"} onClick={() => needNote() && call("return", `/api/v1/payroll/runs/${p.runId}/approve`, { decision: "RETURN", note }, t("payroll.actions.returnedToast"))}>
            {t("payroll.actions.returnIt")}
          </Button>
          {challenge ? (
            <Button variant="primary" icon={<Check className="size-4" />} disabled={otp.length !== 6} loading={busy === "approve"} onClick={() => call("approve", `/api/v1/payroll/runs/${p.runId}/approve`, { decision: "APPROVE", challengeId: challenge.challengeId, otp, note: note.trim() || undefined }, t("payroll.actions.approved"))}>
              {t("payroll.actions.approve")}
            </Button>
          ) : (
            <Button variant="primary" icon={<KeyRound className="size-4" />} loading={busy === "otp"} onClick={sendOtp}>
              {t("payroll.actions.sendOtp")}
            </Button>
          )}
        </CardFooter>
      </Card>
    );
  }

  // ── Stage 5: pay ──
  const bank = p.bankFile;
  const repayFiles = p.files.filter((f) => f.kind === "bank.repay");
  const summary = p.files.find((f) => f.kind === "accounts.summary");
  return (
    <Card>
      <CardHeader
        title={t("payroll.stages.pay")}
        description={p.approvedBy && p.approvedAt ? t("payroll.actions.approvedBy", { name: p.approvedBy, date: p.approvedAt }) : undefined}
        icon={<Banknote className="size-4.5" aria-hidden="true" />}
        actions={
          p.can.reopen && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setReopen(true)}>
              {t("payroll.actions.reopen")}
            </Button>
          )
        }
      />
      <CardBody className="space-y-5">
        {/* Bank file */}
        <Step done={Boolean(bank && (bank.status === "APPROVED" || bank.status === "DOWNLOADED"))} title={t("payroll.actions.bankFile")}>
          {!bank || bank.status === "REJECTED" ? (
            <>
              <p className="text-sm text-ink-600">{bank?.status === "REJECTED" ? t("payroll.actions.bankRejected") : t("payroll.actions.bankFileHelp")}</p>
              {p.can.bankFile && (
                <Button className="mt-2" size="sm" variant="primary" icon={<Banknote className="size-4" />} loading={busy === "bank"} onClick={() => call("bank", `/api/v1/payroll/runs/${p.runId}/bank-file`, {}, t("payroll.actions.bankFileMade"))}>
                  {t("payroll.actions.bankFile")}
                </Button>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className={bank.status === "PREVIEW" ? "text-sm font-medium text-amber-700" : "text-sm font-medium text-brand-800"}>{bank.status === "PREVIEW" ? t("payroll.actions.bankWaiting") : t("payroll.actions.bankReleased")}</span>
              <span className="text-sm text-ink-500">{bank.fileName}</span>
              {fileLink(bank)}
            </div>
          )}
        </Step>

        {/* Return file */}
        {(p.status === "PAID" || p.status === "CLOSED") && (
          <Step done={Boolean(p.returnAt)} title={t("payroll.actions.returnTitle")}>
            {p.returnAt ? (
              <p className="text-sm text-ink-600">{t("payroll.actions.returnReadOn", { date: p.returnAt })}</p>
            ) : (
              <>
                <p className="text-sm text-ink-600">{t("payroll.actions.returnHelp")}</p>
                {p.can.returnFile && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input ref={fileInput} type="file" accept=".csv,.xlsx" className="sr-only" id="return-file" onChange={(e) => e.target.files?.[0] && uploadReturn(e.target.files[0])} />
                    <label htmlFor="return-file" className={buttonClass("secondary", "sm", busy === "return" ? "pointer-events-none opacity-60" : "cursor-pointer")}>
                      <FileUp className="size-4" aria-hidden="true" /> {t("payroll.actions.returnUpload")}
                    </label>
                    <a href="/api/v1/payroll/return-template" download className={buttonClass("ghost", "sm")}>
                      <Download className="size-4" aria-hidden="true" /> {t("payroll.actions.returnTemplate")}
                    </a>
                    <Button size="sm" variant="primary" icon={<Check className="size-4" />} loading={busy === "all"} onClick={() => window.confirm(t("payroll.actions.allCreditedConfirm")) && call("all", `/api/v1/payroll/runs/${p.runId}/return-file`, { allCredited: true }, t("payroll.actions.allCreditedDone"))}>
                      {t("payroll.actions.allCredited")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Step>
        )}

        {/* Failed credits and re-pay */}
        {(p.failed > 0 || repayFiles.length > 0) && (
          <Step done={p.failed === 0} title={t("payroll.actions.failedTitle")}>
            {p.failed > 0 && <p className="text-sm text-red-700">{t("payroll.actions.failedHelp")}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {p.can.repay && (
                <Button size="sm" variant="primary" icon={<Banknote className="size-4" />} loading={busy === "repay"} onClick={() => call("repay", `/api/v1/payroll/runs/${p.runId}/repay-file`, {}, t("payroll.actions.repayMade"))}>
                  {t("payroll.actions.repay")}
                </Button>
              )}
              {repayFiles.map((f) => (
                <span key={f.id} className="flex items-center gap-2">
                  <Badge tone={f.status === "PREVIEW" ? "amber" : f.status === "REJECTED" ? "red" : "green"}>{f.fileName}</Badge>
                  {fileLink(f)}
                </span>
              ))}
            </div>
          </Step>
        )}

        {/* Close */}
        {(p.status === "PAID" || p.status === "CLOSED") && (
          <Step done={p.status === "CLOSED"} title={t("payroll.actions.close")}>
            {p.status === "CLOSED" ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-ink-600">{p.closedAt && t("payroll.actions.closedOn", { date: p.closedAt })}</p>
                {summary && fileLink(summary, t("payroll.actions.summary"))}
              </div>
            ) : (
              <>
                <p className="text-sm text-ink-600">{t("payroll.actions.closeHelp")}</p>
                {p.can.close && (
                  <Button className="mt-2" size="sm" variant="primary" icon={<Lock className="size-4" />} loading={busy === "close"} onClick={() => window.confirm(t("payroll.actions.closeConfirm")) && call("close", `/api/v1/payroll/runs/${p.runId}/close`, {}, t("payroll.actions.closed"))}>
                    {t("payroll.actions.close")}
                  </Button>
                )}
              </>
            )}
          </Step>
        )}
      </CardBody>

      <Dialog
        open={reopen}
        onClose={() => setReopen(false)}
        closeLabel={t("common.close")}
        title={t("payroll.actions.reopenTitle")}
        description={t("payroll.actions.reopenHelp")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReopen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={<RotateCcw className="size-4" />}
              loading={busy === "reopen"}
              onClick={async () => {
                if (!needNote()) return;
                if (await call("reopen", `/api/v1/payroll/runs/${p.runId}/reopen`, { note }, t("payroll.actions.reopenedToast"))) setReopen(false);
              }}
            >
              {t("payroll.actions.reopen")}
            </Button>
          </>
        }
      >
        <Textarea label={t("payroll.actions.reopenReason")} value={note} onChange={(e) => { setNote(e.target.value); setNoteError(undefined); }} error={noteError} maxLength={500} rows={3} required />
      </Dialog>
    </Card>
  );
}

function Waiting({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-ink-700">
          <Clock className="size-4 text-ink-400" aria-hidden="true" /> {text}
        </p>
        {children}
      </CardBody>
    </Card>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <span className={done ? "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white" : "mt-0.5 size-6 shrink-0 rounded-full border-2 border-ink-200"} aria-hidden="true">
        {done && <Check className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-ink-900">
          {title}
          {done && <span className="sr-only"> ✓</span>}
        </h3>
        <div className="mt-1">{children}</div>
      </div>
    </section>
  );
}
