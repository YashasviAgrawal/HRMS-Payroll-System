import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { countInbox } from "@/lib/approvals";
import { hasApprovalsInbox, menuFor } from "@/lib/auth/menu";
import { IDLE_TIMEOUT_MS, requireActor } from "@/lib/auth/session";
import { MARK } from "@/lib/brand";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const path = (await headers()).get("x-pathname") ?? "";
  // First sign-in with a temporary password: set your own before doing anything else.
  if (actor.mustChangePassword && !path.startsWith("/profile")) redirect("/profile?setup=1");

  const inbox = hasApprovalsInbox(actor) ? await countInbox(actor) : null;
  return (
    <AppShell
      menu={menuFor(actor)}
      user={{
        name: actor.name,
        nameHi: actor.nameHi,
        loginId: actor.loginId,
        loginType: actor.isPensioner && !actor.isEmployee ? "PENSIONER" : actor.loginType,
        permissions: actor.permissions,
      }}
      inboxCount={inbox}
      logo={MARK}
      idleTimeoutMs={IDLE_TIMEOUT_MS}
      mobileBottomNav={actor.loginType === "EMPLOYEE"}
    >
      {children}
    </AppShell>
  );
}
