import "server-only";
import type { z } from "zod";
import { chainTask } from "@/lib/approvals/engine";
import { defineApprovalKind } from "@/lib/approvals/registry";
import { onPublishApproved } from "./form16";
import { onGpfAdvanceApproved, onGpfAdvanceRejected, onGpfInterestApproved } from "./gpf";
import { applyDueRule, applyTaxRule, type dueRuleSchema, type taxRuleSchema } from "./rules";
import { applyCarryIn, onDeclarationReturned, onDeclarationVerified, onDeclarationWithdrawn, type carryInSchema } from "./tax";

/** ST-03: the employee sends the declaration; HR & Accounts (a Checker) verify it against the proofs, or send it back. */
defineApprovalKind<{ declarationId: string }>({
  kind: "tax.declaration",
  requiredPermission: "CHECKER",
  allowSelfSubject: true,
  sensitive: true,
  async onApprove({ tx, task, actor, payload }) {
    await onDeclarationVerified(tx, task, actor, payload.declarationId);
  },
  async onReject({ tx, payload, note }) {
    await onDeclarationReturned(tx, payload.declarationId, note);
  },
  async onCancel({ tx, payload }) {
    await onDeclarationWithdrawn(tx, payload.declarationId);
  },
});

/** ST-04: salary of the year paid outside the system changes the TDS, so a Checker checks it. */
defineApprovalKind<z.infer<typeof carryInSchema>>({
  kind: "tax.carryin",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, payload }) {
    await applyCarryIn(tx, task, payload);
  },
});

/** §9 GPF: Payroll sanctions an advance or withdrawal, a Checker checks, an Admin approves. */
defineApprovalKind<{ advanceId: string; step?: "approver" }>({
  kind: "gpf.advance",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, payload }) {
    if (payload.step !== "approver") {
      await chainTask(tx, task, { requiredPermission: "APPROVER", payload: { ...payload, step: "approver" } });
      return;
    }
    await onGpfAdvanceApproved(tx, task, payload.advanceId);
  },
  async onReject({ tx, payload }) {
    await onGpfAdvanceRejected(tx, payload.advanceId);
  },
  async onCancel({ tx, payload }) {
    await onGpfAdvanceRejected(tx, payload.advanceId);
  },
});

/** §9 GPF: the year's interest is credited once an Admin approves it. */
defineApprovalKind<{ fy: string }>({
  kind: "gpf.interest",
  requiredPermission: "APPROVER",
  async onApprove({ tx, task, payload }) {
    await onGpfInterestApproved(tx, task, payload.fy);
  },
});

/** ST-07, ST-09: Form 16 reaches employees only once an Admin approves publishing it. */
defineApprovalKind<{ fy: string }>({
  kind: "form16.publish",
  requiredPermission: "APPROVER",
  async onApprove({ tx, task, payload, afterCommit }) {
    await onPublishApproved(tx, task, payload.fy, afterCommit);
  },
});

/** ST-01: tax slabs and due dates change only when an Admin approves. */
defineApprovalKind<z.infer<typeof taxRuleSchema>>({
  kind: "tax.rule",
  requiredPermission: "APPROVER",
  async onApprove({ tx, actor, payload }) {
    await applyTaxRule(tx, actor.boardId, payload);
  },
});

defineApprovalKind<z.infer<typeof dueRuleSchema> & { kind: string }>({
  kind: "due.rule",
  requiredPermission: "APPROVER",
  async onApprove({ tx, actor, payload }) {
    await applyDueRule(tx, actor.boardId, payload);
  },
});
