import "server-only";
import { defineApprovalKind } from "@/lib/approvals/registry";
import { applyCutOver } from "./cutover";
import { applyLoad, type LoadPayload } from "./loads";

/** §15 step 8: GPF balances, loans, tax carried in and pensioners from FoxPro — one batch each, checked by a Checker. */
defineApprovalKind<LoadPayload>({
  kind: "migration.load",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, actor, payload }) {
    await applyLoad(tx, task, actor, payload);
  },
});

/** §15 step 10: the Admin signs the cut-over; the console becomes read-only. */
defineApprovalKind<{ date: string }>({
  kind: "migration.cutover",
  requiredPermission: "APPROVER",
  async onApprove({ tx, task, actor, payload }) {
    await applyCutOver(tx, task, actor, payload.date);
  },
});
