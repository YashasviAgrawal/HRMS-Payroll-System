import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { SlipScreen } from "./slip-screen";

export const metadata: Metadata = { title: "Pay sheet" };

export default async function PaySheetPage({ params }: { params: Promise<{ id: string; slipId: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "payroll", "view") && !canAll(actor, "pension", "view")) return <NoAccess />;
  const { id, slipId } = await params;
  return <SlipScreen actor={actor} runId={id} slipId={slipId} base="/payroll" />;
}
