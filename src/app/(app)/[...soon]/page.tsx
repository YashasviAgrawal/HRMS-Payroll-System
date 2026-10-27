import { notFound } from "next/navigation";
import { Hammer } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";

/**
 * Screens of modules that are still being built. Real routes always take precedence over this catch-all,
 * so each placeholder disappears the moment its module lands. Unknown paths still get a 404.
 */
const UPCOMING: Record<string, number> = {
  employees: 2,
  "my/record": 2,
  "my/requests": 2,
  "my/attendance": 4,
  "my/team": 4,
  recruitment: 3,
  attendance: 4,
  leave: 5,
  migration: 10,
};

export default async function UpcomingPage({ params }: { params: Promise<{ soon: string[] }> }) {
  await requireActor();
  const { soon } = await params;
  const moduleNo = UPCOMING[soon.slice(0, 2).join("/")] ?? UPCOMING[soon[0]];
  if (!moduleNo) notFound();
  const { t } = await getT();
  return (
    <Card className="mx-auto mt-8 max-w-xl">
      <EmptyState
        icon={<Hammer className="size-6" aria-hidden="true" />}
        title={t("soon.title")}
        description={t("soon.body", { module: t("soon.module", { n: moduleNo }) })}
        action={<LinkButton href="/home">{t("common.goHome")}</LinkButton>}
      />
    </Card>
  );
}
