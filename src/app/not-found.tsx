import { Compass } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="flex min-h-[70dvh] items-center justify-center px-4">
      <EmptyState
        icon={<Compass className="size-6" aria-hidden="true" />}
        title={t("errors.pageNotFound")}
        action={<LinkButton href="/home" variant="primary">{t("common.goHome")}</LinkButton>}
      />
    </main>
  );
}
