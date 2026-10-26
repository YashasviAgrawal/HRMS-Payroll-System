"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { KeyRound, Link2, Power, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input, controlClass } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { PERMISSIONS_BY_LOGIN, permissionConflicts } from "@/lib/auth/access";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { LoginType, Permission } from "@/generated/prisma/enums";

interface LinkedEmployee {
  id: string;
  employeeCode: string;
  name: string;
  section: string;
  sectionHi?: string | null;
}

interface Initial {
  id: string;
  loginType: LoginType;
  loginId: string;
  displayName: string;
  displayNameHi: string;
  mobile: string;
  email: string;
  permissions: Permission[];
  status: "ACTIVE" | "DISABLED";
  employee: LinkedEmployee | null;
}

interface LookupRow {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  mobile: string | null;
  section: { name: string; nameHi: string };
  post: { name: string; nameHi: string };
}

function EmployeePicker({ value, onChange, disabled }: { value: LinkedEmployee | null; onChange: (e: LinkedEmployee | null, mobile?: string | null) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<LookupRow[]>([]);
  const searching = q.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    const handle = setTimeout(async () => {
      try {
        setRows(await api<LookupRow[]>(`/api/v1/users/employee-lookup?q=${encodeURIComponent(q)}`));
      } catch {
        setRows([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [q, searching]);
  const visibleRows = searching ? rows : [];

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{value.name}</p>
          <p className="tabular text-xs text-ink-500">
            {value.employeeCode} · {locale === "hi" && value.sectionHi ? value.sectionHi : value.section}
          </p>
        </div>
        {!disabled && (
          <button type="button" onClick={() => onChange(null)} className="rounded-lg p-1.5 text-ink-400 hover:bg-white hover:text-ink-700" aria-label={t("common.remove")}>
            <X className="size-4" />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-ink-400" aria-hidden="true" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={disabled}
        placeholder={t("users.searchPlaceholder")}
        aria-label={t("users.linkEmployee")}
        className={controlClass(false, "h-10 pl-9")}
      />
      {visibleRows.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-ink-200 bg-white p-1 shadow-raised">
          {visibleRows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-brand-50"
                onClick={() => {
                  onChange(
                    { id: r.id, employeeCode: r.employeeCode, name: [r.firstName, r.lastName].filter(Boolean).join(" "), section: r.section.name, sectionHi: r.section.nameHi },
                    r.mobile,
                  );
                  setQ("");
                  setRows([]);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900">{[r.firstName, r.lastName].filter(Boolean).join(" ")}</span>
                  <span className="block truncate text-xs text-ink-500">{locale === "hi" ? r.post.nameHi : r.post.name} · {locale === "hi" ? r.section.nameHi : r.section.name}</span>
                </span>
                <span className="tabular text-xs font-medium text-ink-600">{r.employeeCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UserForm({ mode, initial, readOnly, isSelf }: { mode: "create" | "edit"; initial?: Initial; readOnly?: boolean; isSelf?: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [loginType, setLoginType] = useState<LoginType>(initial?.loginType ?? "HR_ACCOUNTS");
  const [employee, setEmployee] = useState<LinkedEmployee | null>(initial?.employee ?? null);
  const [loginId, setLoginId] = useState(initial?.loginId ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [displayNameHi, setDisplayNameHi] = useState(initial?.displayNameHi ?? "");
  const [mobile, setMobile] = useState(initial?.mobile ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [permissions, setPermissions] = useState<Permission[]>(initial?.permissions ?? []);
  const [tempPassword, setTempPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetValue, setResetValue] = useState("");

  const allowed = PERMISSIONS_BY_LOGIN[loginType];
  const conflict = useMemo(() => permissionConflicts(permissions), [permissions]);

  function togglePermission(p: Permission, on: boolean) {
    setPermissions((all) => (on ? [...new Set([...all, p])] : all.filter((x) => x !== p)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const body = {
      displayName,
      displayNameHi,
      mobile,
      email,
      employeeId: employee?.id ?? null,
      permissions: permissions.filter((p) => allowed.includes(p)),
    };
    try {
      if (mode === "create") {
        const created = await api<{ id: string }>("/api/v1/users", { body: { ...body, loginType, loginId, temporaryPassword: tempPassword } });
        toast(t("users.created"));
        router.push(`/admin/users/${created.id}`);
      } else {
        await api(`/api/v1/users/${initial!.id}`, { method: "PATCH", body });
        toast(t("users.updated"));
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    if (!initial) return;
    const next = initial.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try {
      await api(`/api/v1/users/${initial.id}/status`, { body: { status: next } });
      toast(t("users.updated"));
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    }
  }

  async function resetPassword() {
    if (!initial) return;
    try {
      await api(`/api/v1/users/${initial.id}/reset-password`, { body: { temporaryPassword: resetValue } });
      toast(t("users.updated"));
      setResetOpen(false);
      setResetValue("");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader title={t("users.loginType")} icon={<UserRound className="size-4.5" aria-hidden="true" />} />
        <CardBody className="space-y-5">
          {mode === "create" ? (
            <Segmented
              label={t("users.loginType")}
              value={loginType}
              onChange={(v) => {
                setLoginType(v);
                setPermissions([]);
              }}
              options={(["ADMIN", "HR_ACCOUNTS", "EMPLOYEE"] as const).map((l) => ({ value: l, label: tDynamic(t, `loginType.${l}`) }))}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">{tDynamic(t, `loginType.${loginType}`)}</Badge>
              <Badge tone={initial?.status === "ACTIVE" ? "green" : "gray"} dot>
                {initial?.status === "ACTIVE" ? t("common.active") : t("common.disabled")}
              </Badge>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink-800">
              <Link2 className="size-4 text-ink-400" aria-hidden="true" /> {t("users.linkEmployee")}
              {loginType === "EMPLOYEE" && <span className="text-red-600">*</span>}
            </p>
            <EmployeePicker
              value={employee}
              disabled={readOnly}
              onChange={(e, empMobile) => {
                setEmployee(e);
                if (e && mode === "create") {
                  setLoginId(e.employeeCode);
                  if (!displayName) setDisplayName(e.name);
                  if (!mobile && empMobile) setMobile(empMobile);
                }
              }}
            />
            <p className="text-xs text-ink-500">{loginType === "EMPLOYEE" ? t("users.linkEmployeeHint") : `${t("users.linkEmployeeHint")} ${t("users.noEmployee")}.`}</p>
            {errors.employeeId && <p className="text-xs font-medium text-red-600">{errors.employeeId}</p>}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Input label={t("users.loginId")} value={loginId} onChange={(e) => setLoginId(e.target.value.toUpperCase())} hint={t("users.loginIdHint")} error={errors.loginId} disabled={mode === "edit" || readOnly} required />
            <Input label={t("common.mobile")} value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" error={errors.mobile} disabled={readOnly} required />
            <Input label={t("common.name")} value={displayName} onChange={(e) => setDisplayName(e.target.value)} error={errors.displayName} disabled={readOnly} required />
            <Input label={`${t("common.name")} (हिन्दी)`} value={displayNameHi} onChange={(e) => setDisplayNameHi(e.target.value)} lang="hi" optionalLabel={t("common.optional")} disabled={readOnly} />
            <Input label={t("common.email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} optionalLabel={t("common.optional")} disabled={readOnly} containerClassName="sm:col-span-2" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("users.permissionsFor", { login: tDynamic(t, `loginType.${loginType}`) })} icon={<ShieldCheck className="size-4.5" aria-hidden="true" />} />
        <CardBody className="space-y-3">
          {allowed.length === 0 ? (
            <p className="text-sm text-ink-500">{t("users.noPermissionsForLogin")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {allowed.map((p) => (
                <Checkbox
                  key={p}
                  label={tDynamic(t, `permission.${p}`)}
                  description={tDynamic(t, `permissionHelp.${p}`)}
                  checked={permissions.includes(p)}
                  disabled={readOnly || isSelf}
                  onChange={(e) => togglePermission(p, e.target.checked)}
                />
              ))}
            </div>
          )}
          {conflict && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t("users.conflict")}</p>}
          {errors.permissions && !conflict && <p className="text-sm text-red-600">{errors.permissions}</p>}
          {permissions.includes("REPORTING_OFFICER") && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
              {employee ? t("users.sectionScopeHint", { section: locale === "hi" && employee.sectionHi ? employee.sectionHi : employee.section }) : t("users.sectionScopeNone")}
            </p>
          )}
        </CardBody>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader title={t("users.temporaryPassword")} icon={<KeyRound className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <Input
              label={t("users.temporaryPassword")}
              type="text"
              autoComplete="off"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              hint={t("users.temporaryPasswordHint")}
              error={errors.temporaryPassword}
              required={loginType !== "EMPLOYEE"}
              containerClassName="sm:max-w-sm"
            />
          </CardBody>
        </Card>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {mode === "edit" && !isSelf && (
              <>
                <Button variant={initial?.status === "ACTIVE" ? "danger" : "secondary"} icon={<Power className="size-4" />} onClick={toggleStatus}>
                  {initial?.status === "ACTIVE" ? t("users.disable") : t("users.enable")}
                </Button>
                <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setResetOpen(true)}>
                  {t("users.resetPassword")}
                </Button>
              </>
            )}
          </div>
          <Button type="submit" variant="primary" loading={busy} disabled={Boolean(conflict)}>
            {mode === "create" ? t("users.add") : t("common.saveChanges")}
          </Button>
        </div>
      )}

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={t("users.resetPassword")}
        description={t("users.temporaryPasswordHint")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={resetPassword} disabled={resetValue.length < 8}>
              {t("users.resetPassword")}
            </Button>
          </>
        }
      >
        <Input label={t("users.temporaryPassword")} value={resetValue} onChange={(e) => setResetValue(e.target.value)} autoComplete="off" hint={t("profile.passwordRules")} />
      </Dialog>
    </form>
  );
}
