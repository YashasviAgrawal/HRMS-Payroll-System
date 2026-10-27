import "server-only";
import type { z } from "zod";
import { defineApprovalKind } from "@/lib/approvals/registry";
import { onCaseApproved, onCaseChecked, onCaseSentBack, storePpo } from "./cases";
import { applyDeath } from "./events";
import { onLifeCertificateDecided } from "./life-certificates";
import { applyNewPensioner, applyPensionerEdit, type newPensionerSchema } from "./pensioners";
import { applyCommutationTable, type commutationTableSchema } from "./tables";

/** PN-01: a pensioner's record — added from the old records or changed — is approved by a Checker. */
defineApprovalKind<{ create?: true; pensionerId?: string; data: Record<string, unknown>; reason?: string }>({
  kind: "pension.record",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, actor, payload }) {
    if (payload.create) await applyNewPensioner(tx, task, actor, payload.data as unknown as z.infer<typeof newPensionerSchema> & { bankAccountEnc: string; bankAccountHash: string; bankAccountLast4: string });
    else await applyPensionerEdit(tx, task, actor, payload as never);
  },
});

/** PN-06: a Jeevan Pramaan certificate uploaded by the pensioner is checked by the Pension clerk. */
defineApprovalKind<{ certificateId: string }>({
  kind: "pension.lifecert",
  requiredPermission: "PENSION",
  allowSelfSubject: true,
  async onApprove({ tx, task, actor, payload }) {
    await onLifeCertificateDecided(tx, task, actor, payload.certificateId, true, null);
  },
  async onReject({ tx, task, actor, payload, note }) {
    await onLifeCertificateDecided(tx, task, actor, payload.certificateId, false, note);
  },
  async onCancel({ tx, task, actor, payload }) {
    await onLifeCertificateDecided(tx, task, actor, payload.certificateId, false, "Withdrawn");
  },
});

/** PN-09: a pension case — prepared by Pension, checked by a Checker, approved by an Admin; the PPO follows. */
defineApprovalKind<{ caseId: string; step?: "approver" }>({
  kind: "pension.case",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, actor, payload, afterCommit }) {
    if (payload.step !== "approver") {
      await onCaseChecked(tx, task, payload);
      return;
    }
    await onCaseApproved(tx, task, actor, payload.caseId);
    afterCommit(() => storePpo(payload.caseId));
  },
  async onReject({ tx, payload }) {
    await onCaseSentBack(tx, payload.caseId, true);
  },
  async onReturn({ tx, payload }) {
    await onCaseSentBack(tx, payload.caseId, false);
  },
  async onCancel({ tx, payload }) {
    await onCaseSentBack(tx, payload.caseId, false);
  },
});

/** PN-11: a death — the pension or pay stops and family pension starts — once a Checker approves. */
defineApprovalKind<Parameters<typeof applyDeath>[3]>({
  kind: "pension.death",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, actor, payload }) {
    await applyDeath(tx, task, actor, payload);
  },
});

/** PRD §10: the commutation table changes only when an Admin approves. */
defineApprovalKind<z.infer<typeof commutationTableSchema>>({
  kind: "pension.table",
  requiredPermission: "APPROVER",
  async onApprove({ tx, task, actor, payload }) {
    await applyCommutationTable(tx, task, actor, payload);
  },
});
