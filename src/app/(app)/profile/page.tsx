import type { Metadata } from "next";
import { KeyRound, Languages, ShieldAlert, Smartphone, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { maskMobile } from "@/lib/utils";
import { ChangeMobileForm, ChangePasswordForm } from "./forms";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const actor = await requireActor();
  const { t, locale } = await getT();
  const { setup } = await searchParams;
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const setupMode = actor.mustChangePassword || setup === "1";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("profile.title")} description={t("profile.subtitle")} />

      {setupMode && actor.mustChangePassword && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-50 px-5 py-4 text-gold-600" role="status">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-sm font-medium">{t("home.passwordReminder")}</p>
        </div>
      )}

      <div className="grid gap-6">
        <Card>
          <CardHeader title={t("profile.details")} icon={<UserRound className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              items={[
                { label: t("common.name"), value: locale === "hi" && user.displayNameHi ? user.displayNameHi : user.displayName },
                { label: t("profile.loginId"), value: <span className="tabular font-medium">{user.loginId}</span> },
                { label: t("profile.loginType"), value: tDynamic(t, `loginType.${actor.isPensioner && !actor.isEmployee ? "PENSIONER" : user.loginType}`) },
                { label: t("common.mobile"), value: <span className="tabular">{maskMobile(user.mobile)}</span> },
                {
                  label: t("profile.permissions"),
                  value: user.permissions.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {user.permissions.map((p) => (
                        <Badge key={p} tone="green">
                          {tDynamic(t, `permission.${p}`)}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-ink-500">{t("profile.noPermissions")}</span>
                  ),
                },
                { label: t("profile.lastLogin"), value: formatDateTime(user.lastLoginAt, locale) },
              ]}
            />
          </CardBody>
        </Card>

        <Card id="password">
          <CardHeader title={t("profile.changePassword")} description={t("profile.passwordRules")} icon={<KeyRound className="size-4.5" aria-hidden="true" />} />
          <ChangePasswordForm needsCurrent={Boolean(user.passwordHash) && !user.mustChangePassword} />
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader title={t("profile.changeMobile")} description={t("profile.mobileOtpHint")} icon={<Smartphone className="size-4.5" aria-hidden="true" />} />
            <ChangeMobileForm />
          </Card>
          <Card>
            <CardHeader title={t("profile.languageTitle")} description={t("profile.languageHint")} icon={<Languages className="size-4.5" aria-hidden="true" />} />
            <CardBody>
              <LanguageSwitch />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
