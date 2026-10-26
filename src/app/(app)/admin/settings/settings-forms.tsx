"use client";

import { useState } from "react";
import { Building2, DatabaseBackup, Fingerprint, Mail, MessageSquareText, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
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
  const attendance = useSection("attendance", initial.attendance);

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

        <Card className="lg:col-span-2">
          <CardHeader title={t("settings.attendance")} description={t("settings.attendanceHint")} icon={<Fingerprint className="size-4.5" aria-hidden="true" />} />
          <CardBody className="grid gap-5 sm:grid-cols-3">
            <Input
              label={t("settings.officeStart")}
              type="time"
              value={attendance.value.officeStart}
              disabled={readOnly}
              onChange={(e) => attendance.setValue({ ...attendance.value, officeStart: e.target.value })}
              error={attendance.errors.officeStart}
              hint={t("settings.toConfirm")}
            />
            <Input
              label={t("settings.graceMinutes")}
              type="number"
              min={0}
              max={120}
              value={attendance.value.graceMinutes}
              disabled={readOnly}
              onChange={(e) => attendance.setValue({ ...attendance.value, graceMinutes: Number(e.target.value) })}
              error={attendance.errors.graceMinutes}
            />
            <Input
              label={t("settings.halfDayMinutes")}
              type="number"
              min={60}
              max={600}
              value={attendance.value.halfDayMinutes}
              disabled={readOnly}
              onChange={(e) => attendance.setValue({ ...attendance.value, halfDayMinutes: Number(e.target.value) })}
              error={attendance.errors.halfDayMinutes}
            />
            <div className="space-y-1.5 sm:col-span-3">
              <p className="text-sm font-medium text-ink-800">{t("settings.weeklyOff")}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("settings.weeklyOff")}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const on = attendance.value.weeklyOff.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={readOnly}
                      aria-pressed={on}
                      onClick={() =>
                        attendance.setValue({
                          ...attendance.value,
                          weeklyOff: on ? attendance.value.weeklyOff.filter((x) => x !== d) : attendance.value.weeklyOff.length >= 3 ? attendance.value.weeklyOff : [...attendance.value.weeklyOff, d],
                        })
                      }
                      className={cn("h-9 min-w-12 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-60", on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-600 hover:border-ink-300")}
                    >
                      {tDynamic(t, `attendance.weekday.${d}`)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2 sm:col-span-3">
              <p className="text-sm font-medium text-ink-800">{t("settings.devices")}</p>
              <p className="text-xs text-ink-500">{t("settings.devicesHint")}</p>
              {attendance.value.devices.map((d, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
                  <Input
                    aria-label={t("settings.deviceSerial")}
                    placeholder={t("settings.deviceSerial")}
                    value={d.serial}
                    disabled={readOnly}
                    onChange={(e) => attendance.setValue({ ...attendance.value, devices: attendance.value.devices.map((x, k) => (k === i ? { ...x, serial: e.target.value.trim() } : x)) })}
                    error={attendance.errors[`devices.${i}.serial`]}
                  />
                  <Input
                    aria-label={t("settings.deviceName")}
                    placeholder={t("settings.deviceName")}
                    value={d.name}
                    disabled={readOnly}
                    onChange={(e) => attendance.setValue({ ...attendance.value, devices: attendance.value.devices.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })}
                  />
                  {!readOnly && (
                    <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => attendance.setValue({ ...attendance.value, devices: attendance.value.devices.filter((_, k) => k !== i) })} aria-label={t("settings.removeDevice")} />
                  )}
                </div>
              ))}
              {!readOnly && (
                <Button size="sm" icon={<Plus className="size-4" />} onClick={() => attendance.setValue({ ...attendance.value, devices: [...attendance.value.devices, { serial: "", name: "" }] })}>
                  {t("settings.addDevice")}
                </Button>
              )}
            </div>
          </CardBody>
          {footer(attendance.save, attendance.busy)}
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
