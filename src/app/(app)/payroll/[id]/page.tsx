import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { RunScreen } from "./run-screen";

export const metadata: Metadata = { title: "Payroll month" };

export default async function PayrollRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "payroll", "view") && !canAll(actor, "pension", "view")) return <NoAccess />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <RunScreen actor={actor} id={id} tab={sp.tab} base="/payroll" />;
}
