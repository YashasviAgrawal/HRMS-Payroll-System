import "server-only";
import type { ApprovalTask } from "@/generated/prisma/client";
import type { Permission } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/auth/session";
import type { Tx } from "@/lib/db";

export interface DecisionContext<P> {
  tx: Tx;
  task: ApprovalTask;
  payload: P;
  actor: Actor;
  note: string | null;
}

/** One kind of item that goes through maker-checker (an employee change, a leave application, a payroll…). */
export interface ApprovalKind<P = unknown> {
  kind: string;
  requiredPermission: Permission;
  /**
   * Self-service items (an employee applying for their own leave or asking to change their own mobile)
   * are allowed to be about the maker. Everything else about the maker's own record is blocked (PRD §2 rule 2).
   */
  allowSelfSubject?: boolean;
  /** Old/new values carry pay, bank or Aadhaar. */
  sensitive?: boolean;
  onApprove(ctx: DecisionContext<P>): Promise<void>;
  onReject?(ctx: DecisionContext<P>): Promise<void>;
  onReturn?(ctx: DecisionContext<P>): Promise<void>;
}

const kinds = new Map<string, ApprovalKind<never>>();

export function defineApprovalKind<P>(def: ApprovalKind<P>): ApprovalKind<P> {
  kinds.set(def.kind, def as unknown as ApprovalKind<never>);
  return def;
}

export function getApprovalKind(kind: string): ApprovalKind<unknown> | undefined {
  return kinds.get(kind) as ApprovalKind<unknown> | undefined;
}
