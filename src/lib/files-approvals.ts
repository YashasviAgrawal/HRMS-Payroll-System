import "server-only";
import { defineApprovalKind } from "@/lib/approvals/registry";
import { audit } from "@/lib/audit";
import { releaseHookFor } from "@/lib/files-hooks";

/** ST-09 / §12 rule 2: an Admin approves a generated file before anyone can download it. */
defineApprovalKind<{ fileId: string }>({
  kind: "file.release",
  requiredPermission: "APPROVER",
  async onApprove({ tx, payload, actor }) {
    const file = await tx.fileRecord.update({ where: { id: payload.fileId }, data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() } });
    await audit(tx, actor, { action: "APPROVE_FILE", entityType: "FileRecord", entityId: file.id, summary: `Approved ${file.fileName} for download`, newValue: { sha256: file.sha256 } });
    await releaseHookFor(file.kind)?.(tx, file, actor);
  },
  async onReject({ tx, payload }) {
    await tx.fileRecord.update({ where: { id: payload.fileId }, data: { status: "REJECTED" } });
  },
  async onCancel({ tx, payload }) {
    await tx.fileRecord.update({ where: { id: payload.fileId }, data: { status: "REJECTED" } });
  },
});
