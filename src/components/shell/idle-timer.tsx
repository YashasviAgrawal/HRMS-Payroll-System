"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/client";

const WARNING_MS = 2 * 60 * 1000;
const PING_EVERY_MS = 4 * 60 * 1000;

/**
 * PRD §2 rule 7: sessions time out after 15 minutes idle.
 * While the person is active (typing a long form) the server session is kept alive with a light ping;
 * after 13 idle minutes a warning shows, and at 15 the person is signed out.
 */
export function IdleTimer({ timeoutMs, onTimeout }: { timeoutMs: number; onTimeout: () => void }) {
  const t = useT();
  const lastActivity = useRef(0);
  const lastPing = useRef(0);
  const [warningLeft, setWarningLeft] = useState<number | null>(null);

  useEffect(() => {
    lastActivity.current = Date.now();
    lastPing.current = Date.now();
    const mark = () => {
      lastActivity.current = Date.now();
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    const tick = setInterval(() => {
      const now = Date.now();
      const idle = now - lastActivity.current;
      if (idle >= timeoutMs) {
        clearInterval(tick);
        onTimeout();
        return;
      }
      if (idle >= timeoutMs - WARNING_MS) {
        setWarningLeft(Math.ceil((timeoutMs - idle) / 1000));
      } else {
        setWarningLeft(null);
        if (now - lastPing.current >= PING_EVERY_MS && idle < PING_EVERY_MS) {
          lastPing.current = now;
          void fetch("/api/v1/auth/session", { credentials: "same-origin" }).then((r) => {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            if (r.status === 401) window.location.assign("/login?reason=timeout");
          });
        }
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [timeoutMs, onTimeout]);

  async function stay() {
    lastActivity.current = Date.now();
    lastPing.current = Date.now();
    setWarningLeft(null);
    const r = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (r.status === 401) window.location.assign("/login?reason=timeout");
  }

  return (
    <Dialog
      open={warningLeft !== null}
      onClose={stay}
      title={t("session.timeoutTitle")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onTimeout}>
            {t("common.signOut")}
          </Button>
          <Button variant="primary" onClick={stay}>
            {t("session.staySignedIn")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-600">{t("session.timeoutBody", { seconds: warningLeft ?? 0 })}</p>
    </Dialog>
  );
}
