import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { DbLike } from "./db";

/**
 * Every approved change writes an event to the outbox table so later systems (e-Chhawani, DigiLocker,
 * CRA…) can subscribe without touching payroll code (PRD §12 rule 5). Write it in the same transaction.
 */
export async function emit(
  tx: DbLike,
  boardId: string,
  eventType: string,
  aggregate: { type: string; id: string },
  payload: Record<string, unknown> = {},
) {
  await tx.outboxEvent.create({
    data: {
      boardId,
      eventType,
      aggregateType: aggregate.type,
      aggregateId: aggregate.id,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
    },
  });
}
