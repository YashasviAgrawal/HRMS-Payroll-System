"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/i18n/client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <main className="flex min-h-[70dvh] items-center justify-center px-4">
      <EmptyState
        icon={<AlertTriangle className="size-6" aria-hidden="true" />}
        title={t("common.somethingWrong")}
        action={
          <Button variant="primary" onClick={reset}>
            {t("common.tryAgain")}
          </Button>
        }
      />
    </main>
  );
}
