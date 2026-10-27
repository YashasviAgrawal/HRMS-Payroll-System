"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CardBody, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { OtpInput } from "@/components/ui/otp-input";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import { checkPassword } from "@/lib/password-policy";

export function ChangePasswordForm({ needsCurrent }: { needsCurrent: boolean }) {
  const t = useT();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (checkPassword(next).length) local.newPassword = t("errors.passwordWeak");
    if (next !== again) local.again = t("profile.passwordMismatch");
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await api("/api/v1/auth/password", { body: { currentPassword: needsCurrent ? current : undefined, newPassword: next } });
      toast(t("profile.passwordChanged"));
      // Full page load so the "set your password first" gate re-evaluates.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/home");
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        if (!Object.keys(err.fields).length) toast(err.message, "error");
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {needsCurrent && (
          <Input
            containerClassName="sm:col-span-2 sm:max-w-sm"
            label={t("profile.currentPassword")}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={errors.currentPassword}
            required
          />
        )}
        <Input
          label={t("profile.newPassword")}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={errors.newPassword}
          hint={t("profile.passwordRules")}
          required
        />
        <Input
          label={t("profile.confirmPassword")}
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          error={errors.again}
          required
        />
      </CardBody>
      <CardFooter>
        <Button type="submit" variant="primary" loading={busy} disabled={!next || !again}>
          {t("profile.changePassword")}
        </Button>
      </CardFooter>
    </form>
  );
}

export function ChangeMobileForm() {
  const t = useT();
  const toast = useToast();
  const [mobile, setMobile] = useState("");
  const [challenge, setChallenge] = useState<{ challengeId: string; sentTo: string; devOtp?: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setChallenge(await api("/api/v1/auth/mobile/start", { body: { mobile } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.fields.mobile ?? err.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/v1/auth/mobile/confirm", { body: { challengeId: challenge.challengeId, otp } });
      toast(t("profile.mobileChanged"));
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("errors.generic"));
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <form onSubmit={confirm}>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-600">{t("login.otpSentTo", { mobile: challenge.sentTo })}</p>
          {challenge.devOtp && <p className="text-xs text-gold-600">{t("login.devOtp", { otp: challenge.devOtp })}</p>}
          <OtpInput value={otp} onChange={setOtp} label={t("login.otpLabel")} invalid={Boolean(error)} autoFocus />
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </CardBody>
        <CardFooter>
          <Button variant="ghost" onClick={() => setChallenge(null)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="secondary" loading={busy} disabled={otp.length !== 6}>
            {t("common.confirm")}
          </Button>
        </CardFooter>
      </form>
    );
  }

  return (
    <form onSubmit={start} noValidate>
      <CardBody>
        <Input label={t("profile.newMobile")} inputMode="numeric" value={mobile} onChange={(e) => setMobile(e.target.value)} error={error} required />
      </CardBody>
      <CardFooter>
        <Button type="submit" variant="secondary" loading={busy} disabled={mobile.length < 10}>
          {t("login.sendOtp")}
        </Button>
      </CardFooter>
    </form>
  );
}
