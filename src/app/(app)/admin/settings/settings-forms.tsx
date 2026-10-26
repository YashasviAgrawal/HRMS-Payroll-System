"use client";

import { useState } from "react";
import { Building2, DatabaseBackup, Mail, MessageSquareText, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import { BANK_FORMATS, type SettingKey, type SettingValue } from "@/modules/settings/schema";

type All = { [K in SettingKey]: SettingValue<K> };

function useSection<K extends SettingKey>(key: K, initial: SettingValue<K>) {
  const t = useT();
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      setValue(await api<SettingValue<K>>(`/api/v1/settings/${key}`, { method: "PUT", body: value }));
      toast(t("settings.saved"));
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }
  return { value, setValue, busy, errors, save };
}

export function SettingsForms({ initial, readOnly, smsForcedConsole }: { initial: All; readOnly: boolean; smsForcedConsole: boolean }) {
  const t = useT();
  const sms = useSection("sms", initial.sms);
  const email = useSection("email", initial.email);
  const bank = useSection("bank", initial.bank);
  const general = useSection("general", initial.general);

  const footer = (save: () => void, busy: boolean) =>
    !readOnly && (
      <CardFooter>
        <Button variant="secondary" onClick={save} loading={busy}>
          {t("common.saveChanges")}
        </Button>
      </CardFooter>
    );

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t("settings.sms")} description={t("settings.smsHint")} icon={<MessageSquareText className="size-4.5" aria-hidden="true" />} />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Select
            label={t("settings.provider")}
            value={sms.value.provider}
            disabled={readOnly}
            onChange={(e) => sms.setValue({ ...sms.value, provider: e.target.value as "console" | "http" })}
            hint={smsForcedConsole ? t("settings.consoleForced") : undefined}
            containerClassName="sm:col-span-2"
          >
            <option value="console">{t("settings.providerConsole")}</option>
            <option value="http">{t("settings.providerHttp")}</option>
          </Select>
          <Input
            label={t("settings.gatewayUrl")}
            value={sms.value.url}
            disabled={readOnly}
            onChange={(e) => sms.setValue({ ...sms.value, url: e.target.value })}
            hint={t("settings.placeholders")}
            error={sms.errors.url}
            containerClassName="sm:col-span-2"
          />
          <Input label={t("settings.senderId")} value={sms.value.senderId} disabled={readOnly} maxLength={6} onChange={(e) => sms.setValue({ ...sms.value, senderId: e.target.value.toUpperCase() })} />
          <Input label={t("settings.dltEntityId")} value={sms.value.dltEntityId} disabled={readOnly} onChange={(e) => sms.setValue({ ...sms.value, dltEntityId: e.target.value })} />
          <Input
            label={t("settings.apiKeyEnv")}
            value={sms.value.apiKeyEnv}
            disabled={readOnly}
            onChange={(e) => sms.setValue({ ...sms.value, apiKeyEnv: e.target.value.toUpperCase() })}
            hint={t("settings.secretsNote")}
            error={sms.errors.apiKeyEnv}
          />
          <Input
            label={`${t("settings.templates")} — OTP`}
            value={sms.value.templates.otp}
            disabled={readOnly}
            onChange={(e) => sms.setValue({ ...sms.value, templates: { ...sms.value.templates, otp: e.target.value } })}
          />
        </CardBody>
        {footer(sms.save, sms.busy)}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("settings.email")} description={t("settings.emailHint")} icon={<Mail className="size-4.5" aria-hidden="true" />} />
          <CardBody className="grid gap-5">
            <Input label={t("settings.fromAddress")} type="email" value={email.value.fromAddress} disabled={readOnly} onChange={(e) => email.setValue({ ...email.value, fromAddress: e.target.value })} error={email.errors.fromAddress} />
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Input label={t("settings.smtpHost")} value={email.value.smtpHost} disabled={readOnly} onChange={(e) => email.setValue({ ...email.value, smtpHost: e.target.value })} />
              <Input label={t("settings.smtpPort")} type="number" value={email.value.smtpPort} disabled={readOnly} onChange={(e) => email.setValue({ ...email.value, smtpPort: Number(e.target.value) })} />
            </div>
          </CardBody>
          {footer(email.save, email.busy)}
        </Card>

        <Card>
          <CardHeader title={t("settings.bank")} description={t("settings.bankHint")} icon={<Building2 className="size-4.5" aria-hidden="true" />} />
          <CardBody className="grid gap-5">
            <Input label={t("settings.bankName")} value={bank.value.name} disabled={readOnly} onChange={(e) => bank.setValue({ ...bank.value, name: e.target.value })} />
            <Select label={t("settings.bankFormat")} value={bank.value.format} disabled={readOnly} onChange={(e) => bank.setValue({ ...bank.value, format: e.target.value as (typeof BANK_FORMATS)[number] })}>
              {BANK_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input label="IFSC" value={bank.value.ifsc} disabled={readOnly} onChange={(e) => bank.setValue({ ...bank.value, ifsc: e.target.value.toUpperCase() })} error={bank.errors.ifsc} />
              <Input label={t("settings.debitAccount")} value={bank.value.debitAccountLast4} maxLength={4} inputMode="numeric" disabled={readOnly} onChange={(e) => bank.setValue({ ...bank.value, debitAccountLast4: e.target.value.replace(/\D/g, "") })} />
            </div>
          </CardBody>
          {footer(bank.save, bank.busy)}
        </Card>

        <Card>
          <CardHeader title={t("settings.general")} icon={<SlidersHorizontal className="size-4.5" aria-hidden="true" />} />
          <CardBody className="grid gap-5">
            <Input
              label={t("settings.attendanceLockDay")}
              type="number"
              min={1}
              max={28}
              value={general.value.attendanceLockDay}
              disabled={readOnly}
              onChange={(e) => general.setValue({ ...general.value, attendanceLockDay: Number(e.target.value) })}
              error={general.errors.attendanceLockDay}
            />
            <Input label={t("settings.idleMinutes")} value="15" disabled hint={t("settings.idleFixed")} />
          </CardBody>
          {footer(general.save, general.busy)}
        </Card>

        <Card>
          <CardHeader title={t("settings.backups")} description={t("settings.backupsHint")} icon={<DatabaseBackup className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <p className="text-sm text-ink-600">
              <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs">scripts/backup.sh</code> · <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs">scripts/restore.sh</code>
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
