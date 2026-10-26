"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";

/** A button that POSTs to the API, shows the result as a toast and refreshes the screen. */
export function ActionButton({ url, body, done, confirm, method = "POST", children, ...rest }: { url: string; body?: unknown; done: string; confirm?: string; method?: "POST" | "DELETE" } & Omit<ButtonProps, "onClick">) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      {...rest}
      loading={busy}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        try {
          await api(url, { method, body: body ?? (method === "POST" ? {} : undefined) });
          toast(done);
          router.refresh();
        } catch (err) {
          if (err instanceof ApiError) toast(err.message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
