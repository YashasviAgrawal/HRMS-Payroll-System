import { Lock } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getT } from "@/lib/i18n/server";

export async function NoAccess() {
  const { t } = await getT();
  return (
    <Card className="mx-auto max-w-xl">
      <EmptyState
        icon={<Lock className="size-6" aria-hidden="true" />}
        title={t("errors.noAccessTitle")}
        description={t("errors.noAccessBody")}
        action={<LinkButton href="/home">{t("common.goHome")}</LinkButton>}
      />
    </Card>
  );
}
