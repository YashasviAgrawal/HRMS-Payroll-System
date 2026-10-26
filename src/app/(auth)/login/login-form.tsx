"use client";

import { ArrowLeft, Eye, EyeOff, KeyRound, Smartphone, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { OtpInput } from "@/components/ui/otp-input";
import { Segmented } from "@/components/ui/segmented";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

type LoginType = "EMPLOYEE" | "HR_ACCOUNTS" | "ADMIN";
type Method = "password" | "otp";

interface Challenge {
  challengeId: string;
  sentTo: string;
  resendAfter: number;
  devOtp?: string;
}

export function LoginForm({ reason, devMode }: { reason: string | null; devMode: boolean }) {
  const t = useT();
  const [loginType, setLoginType] = useState<LoginType>("EMPLOYEE");
  const [method, setMethod] = useState<Method>("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [cooldown, setCooldown] = useState(0);

  // Mobile + OTP only is for employees and pensioners (PRD §2 rule 4).
  const effectiveMethod: Method = loginType === "EMPLOYEE" ? method : "password";

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function fail(e: unknown) {
    if (e instanceof ApiError) {
      setError(e.message);
      setFieldErrors(e.fields);
    } else setError(t("errors.generic"));
  }

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await api<Challenge>("/api/v1/auth/login/start", {
        body: { loginType, method: effectiveMethod, identifier, password: effectiveMethod === "password" ? password : undefined },
      });
      setChallenge(result);
      setOtp("");
      setCooldown(result.resendAfter);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: React.FormEvent, code = otp) {
    e?.preventDefault();
    if (!challenge || code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ redirect: string }>("/api/v1/auth/login/verify", { body: { challengeId: challenge.challengeId, otp: code } });
      // Full page load so the new session cookie and language apply everywhere.
       
      window.location.assign(result.redirect);
    } catch (err) {
      fail(err);
      setOtp("");
      setBusy(false);
    }
  }

  async function resend() {
    if (!challenge) return;
    setError(null);
    try {
      const result = await api<Challenge>("/api/v1/auth/otp/resend", { body: { challengeId: challenge.challengeId } });
      setChallenge(result);
      setCooldown(result.resendAfter);
    } catch (err) {
      fail(err);
    }
  }

  const banner =
    reason === "timeout" ? t("login.timedOut") : reason === "signedout" ? t("login.signedOut") : null;

  if (challenge) {
    return (
      <form onSubmit={verify} className="animate-fade-in" noValidate>
        <button
          type="button"
          onClick={() => {
            setChallenge(null);
            setError(null);
          }}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-700"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> {t("login.changeNumber")}
        </button>
        <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-600/10">
          <ShieldCheck className="size-6" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-ink-950">{t("login.otpTitle")}</h2>
        <p className="mt-2 text-[0.95rem] text-ink-500">{t("login.otpSentTo", { mobile: challenge.sentTo })}</p>

        {devMode && challenge.devOtp && (
          <p className="mt-4 rounded-lg border border-dashed border-gold-500/50 bg-gold-50 px-3 py-2 text-sm text-gold-600" data-testid="dev-otp">
            {t("login.devOtp", { otp: challenge.devOtp })}
          </p>
        )}

        <div className="mt-6">
          <OtpInput
            value={otp}
            onChange={(v) => {
              setOtp(v);
              // Submit as soon as the sixth digit arrives — one less tap on a phone.
              if (v.length === 6) void verify(undefined, v);
            }}
            label={t("login.otpLabel")}
            invalid={Boolean(error)}
            autoFocus
          />
        </div>
        {error && (
          <p className="mt-3 text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" className="mt-6 w-full" loading={busy} disabled={otp.length !== 6}>
          {t("login.verify")}
        </Button>
        <div className="mt-4 text-center text-sm">
          {cooldown > 0 ? (
            <span className="text-ink-400">{t("login.resendIn", { seconds: cooldown })}</span>
          ) : (
            <button type="button" onClick={resend} className="font-medium text-brand-700 hover:underline">
              {t("login.resend")}
            </button>
          )}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={sendOtp} className="animate-fade-in" noValidate>
      <h2 className="text-2xl font-semibold tracking-tight text-ink-950">{t("login.title")}</h2>
      <p className="mt-2 text-[0.95rem] text-ink-500">{t("login.subtitle")}</p>

      {banner && (
        <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800" role="status">
          {banner}
        </p>
      )}

      <div className="mt-6 space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium text-ink-800">{t("login.as")}</p>
          <Segmented
            label={t("login.as")}
            value={loginType}
            onChange={(v) => {
              setLoginType(v);
              setError(null);
              setFieldErrors({});
            }}
            options={[
              { value: "EMPLOYEE", label: t("login.employee") },
              { value: "HR_ACCOUNTS", label: t("login.hr") },
              { value: "ADMIN", label: t("login.admin") },
            ]}
          />
        </div>

        {loginType === "EMPLOYEE" && (
          <Segmented
            size="sm"
            label={t("login.title")}
            value={method}
            onChange={setMethod}
            options={[
              { value: "password", label: t("login.withPassword"), icon: <KeyRound className="size-3.5" aria-hidden="true" /> },
              { value: "otp", label: t("login.withOtp"), icon: <Smartphone className="size-3.5" aria-hidden="true" /> },
            ]}
          />
        )}

        <Input
          label={effectiveMethod === "otp" ? t("login.mobileOnly") : t("login.idOrMobile")}
          hint={effectiveMethod === "otp" ? undefined : t("login.idOrMobileHint")}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          inputMode={effectiveMethod === "otp" ? "numeric" : "text"}
          autoCapitalize="characters"
          spellCheck={false}
          required
          error={fieldErrors.identifier}
          name="identifier"
        />

        {effectiveMethod === "password" && (
          <Input
            label={t("login.password")}
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            error={fieldErrors.password}
            name="password"
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="rounded-md p-1.5 text-ink-400 hover:text-ink-700"
                aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            }
          />
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" className="mt-6 w-full" loading={busy} disabled={!identifier || (effectiveMethod === "password" && !password)}>
        {t("login.sendOtp")}
      </Button>

      <p className="mt-5 text-center text-xs leading-relaxed text-ink-500">{t("login.forgot")}</p>
      <p className="mt-6 flex items-center justify-center gap-1.5 border-t border-ink-100 pt-5 text-xs text-ink-400">
        <ShieldCheck className="size-3.5" aria-hidden="true" /> {t("login.secureNote")}
      </p>
    </form>
  );
}
