import "server-only";
import type { FileRecord } from "@/generated/prisma/client";
import type { Actor } from "@/lib/auth/session";
import type { Tx } from "@/lib/db";

/**
 * What happens when an Admin releases a file of a given kind — e.g. the salary bank file being released marks the
 * payroll as paid (PR-13 boundary). Modules register here; the file approval runs the hook in its transaction.
 */
type ReleaseHook = (tx: Tx, file: FileRecord, actor: Actor) => Promise<void>;

const hooks = new Map<string, ReleaseHook>();

export function onFileReleased(kind: string, hook: ReleaseHook) {
  hooks.set(kind, hook);
}

export function releaseHookFor(kind: string): ReleaseHook | undefined {
  return hooks.get(kind);
}
