import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { RunScreen } from "../../../payroll/[id]/run-screen";

export const metadata: Metadata = { title: "Pension bill" };

/** S-61: a pension bill through the same five stages as salaries. */
export default async function PensionBillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "view")) return <NoAccess />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <RunScreen actor={actor} id={id} tab={sp.tab} base="/pension/bills" />;
}
