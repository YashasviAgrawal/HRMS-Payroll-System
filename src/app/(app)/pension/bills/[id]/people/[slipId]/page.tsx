import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { SlipScreen } from "../../../../../payroll/[id]/people/[slipId]/slip-screen";

export const metadata: Metadata = { title: "Pension sheet" };

export default async function PensionSheetPage({ params }: { params: Promise<{ id: string; slipId: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "view")) return <NoAccess />;
  const { id, slipId } = await params;
  return <SlipScreen actor={actor} runId={id} slipId={slipId} base="/pension/bills" />;
}
