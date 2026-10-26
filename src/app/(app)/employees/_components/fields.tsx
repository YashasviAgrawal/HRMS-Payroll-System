"use client";

import { Checkbox, Input, Select } from "@/components/ui/field";
import { tDynamic, type TFunction } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { lookup } from "@/lib/i18n/types";
import { en } from "@/lib/i18n/en";
import { formatINR } from "@/lib/money";
import { basicPay, cellCount, PAY_LEVELS } from "@/modules/payroll/matrix-7cpc";
import {
  BLOOD_GROUPS,
  CATEGORIES,
  EMPLOYEE_TYPES,
  GENDERS,
  isMatrixType,
  isWageType,
  MARITAL,
  STATES,
} from "@/modules/employees/schema";

export type Values = Record<string, unknown>;
export type Errors = Record<string, string>;

export interface Option {
  id: string;
  name: string;
  nameHi: string;
}
export interface PostOption extends Option {
  payLevel: string;
}

/** A message from client-side validation is an i18n key; a message from the server is already translated. */
export function msg(t: TFunction, keyOrText: string | undefined) {
  if (!keyOrText) return undefined;
  return lookup(en, keyOrText) ? tDynamic(t, keyOrText) : keyOrText;
}

/** zod issues → { "path.to.field": messageKey } */
export function issuesToErrors(issues: { path: PropertyKey[]; message: string }[], prefix = "") {
  const out: Errors = {};
  for (const i of issues) {
    const key = prefix + i.path.map(String).join(".");
    if (!out[key]) out[key] = lookup(en, i.message) ? i.message : "validation.invalid";
  }
  return out;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function useField(values: Values, onChange: (v: Values) => void, errors: Errors, prefix: string) {
  const { t } = useI18n();
  return {
    t,
    val: (k: string) => str(values[k]),
    set: (k: string, v: unknown) => onChange({ ...values, [k]: v }),
    err: (k: string) => msg(t, errors[prefix + k]),
  };
}

export function AddressFields({
  label,
  value,
  onChange,
  errors,
  errorPrefix,
}: {
  label: string;
  value: Record<string, string> | null;
  onChange: (v: Record<string, string>) => void;
  errors: Errors;
  errorPrefix: string;
}) {
  const { t } = useI18n();
  const v = value ?? { line1: "", line2: "", city: "", district: "", state: "", pincode: "" };
  const set = (k: string, x: string) => onChange({ ...v, [k]: x });
  return (
    <fieldset className="space-y-4 rounded-xl border border-ink-200 p-4">
      <legend className="px-1 text-sm font-semibold text-ink-800">{label}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t("employees.address.line1")} value={v.line1 ?? ""} onChange={(e) => set("line1", e.target.value)} />
        <Input label={t("employees.address.line2")} value={v.line2 ?? ""} onChange={(e) => set("line2", e.target.value)} />
        <Input label={t("employees.address.city")} value={v.city ?? ""} onChange={(e) => set("city", e.target.value)} />
        <Input label={t("employees.address.district")} value={v.district ?? ""} onChange={(e) => set("district", e.target.value)} />
        <Select label={t("employees.address.state")} value={v.state ?? ""} onChange={(e) => set("state", e.target.value)}>
          <option value="">—</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Input
          label={t("employees.address.pincode")}
          value={v.pincode ?? ""}
          inputMode="numeric"
          maxLength={6}
          onChange={(e) => set("pincode", e.target.value.replace(/\D/g, ""))}
          error={msg(t, errors[`${errorPrefix}.pincode`])}
        />
      </div>
    </fieldset>
  );
}

export function PersonalFields({ values, onChange, errors, prefix = "" }: { values: Values; onChange: (v: Values) => void; errors: Errors; prefix?: string }) {
  const { t, val, set, err } = useField(values, onChange, errors, prefix);
  const sameAddress = Boolean(values.__sameAddress);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-3">
        <Input label={t("employees.fields.firstName")} value={val("firstName")} onChange={(e) => set("firstName", e.target.value)} error={err("firstName")} required />
        <Input label={t("employees.fields.middleName")} value={val("middleName")} onChange={(e) => set("middleName", e.target.value)} optionalLabel={t("common.optional")} />
        <Input label={t("employees.fields.lastName")} value={val("lastName")} onChange={(e) => set("lastName", e.target.value)} optionalLabel={t("common.optional")} />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Input label={t("employees.fields.nameHi")} value={val("nameHi")} lang="hi" onChange={(e) => set("nameHi", e.target.value)} optionalLabel={t("common.optional")} containerClassName="sm:col-span-2" />
        <Select label={t("employees.fields.gender")} value={val("gender")} onChange={(e) => set("gender", e.target.value)} error={err("gender")} required>
          <option value="">—</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {tDynamic(t, `employees.gender.${g}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Input label={t("employees.fields.dateOfBirth")} type="date" value={val("dateOfBirth")} onChange={(e) => set("dateOfBirth", e.target.value)} error={err("dateOfBirth")} required />
        <Input label={t("employees.fields.fatherOrSpouseName")} value={val("fatherOrSpouseName")} onChange={(e) => set("fatherOrSpouseName", e.target.value)} containerClassName="sm:col-span-2" optionalLabel={t("common.optional")} />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Select label={t("employees.fields.category")} value={val("category")} onChange={(e) => set("category", e.target.value)} optionalLabel={t("common.optional")}>
          <option value="">—</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tDynamic(t, `employees.category.${c}`)}
            </option>
          ))}
        </Select>
        <Select label={t("employees.fields.maritalStatus")} value={val("maritalStatus")} onChange={(e) => set("maritalStatus", e.target.value)} optionalLabel={t("common.optional")}>
          <option value="">—</option>
          {MARITAL.map((m) => (
            <option key={m} value={m}>
              {tDynamic(t, `employees.marital.${m}`)}
            </option>
          ))}
        </Select>
        <Select label={t("employees.fields.bloodGroup")} value={val("bloodGroup")} onChange={(e) => set("bloodGroup", e.target.value)} optionalLabel={t("common.optional")}>
          <option value="">—</option>
          {BLOOD_GROUPS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Input label={t("employees.fields.mobile")} value={val("mobile")} inputMode="numeric" onChange={(e) => set("mobile", e.target.value)} error={err("mobile")} optionalLabel={t("common.optional")} />
        <Input label={t("employees.fields.email")} type="email" value={val("email")} onChange={(e) => set("email", e.target.value)} error={err("email")} optionalLabel={t("common.optional")} containerClassName="sm:col-span-2" />
      </div>
      <Checkbox label={t("employees.fields.isDisabled")} checked={Boolean(values.isDisabled)} onChange={(e) => set("isDisabled", e.target.checked)} className="sm:max-w-sm" />
      <AddressFields
        label={t("employees.fields.presentAddress")}
        value={(values.presentAddress as Record<string, string>) ?? null}
        onChange={(a) => onChange({ ...values, presentAddress: a, ...(sameAddress ? { permanentAddress: a } : {}) })}
        errors={errors}
        errorPrefix={`${prefix}presentAddress`}
      />
      <Checkbox
        label={t("employees.address.sameAsPresent")}
        checked={sameAddress}
        onChange={(e) => onChange({ ...values, __sameAddress: e.target.checked, ...(e.target.checked ? { permanentAddress: values.presentAddress } : {}) })}
        className="sm:max-w-sm"
      />
      {!sameAddress && (
        <AddressFields
          label={t("employees.fields.permanentAddress")}
          value={(values.permanentAddress as Record<string, string>) ?? null}
          onChange={(a) => set("permanentAddress", a)}
          errors={errors}
          errorPrefix={`${prefix}permanentAddress`}
        />
      )}
    </div>
  );
}

export function JobFields({
  values,
  onChange,
  errors,
  prefix = "",
  sections,
  posts,
}: {
  values: Values;
  onChange: (v: Values) => void;
  errors: Errors;
  prefix?: string;
  sections: Option[];
  posts: PostOption[];
}) {
  const { t, val, set, err } = useField(values, onChange, errors, prefix);
  const { locale } = useI18n();
  const type = val("type");
  const level = val("payLevel");
  const matrix = isMatrixType(type);
  const wage = isWageType(type);
  const cells = level ? cellCount(level) : 0;
  const name = (o: Option) => (locale === "hi" ? o.nameHi : o.name);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Select label={t("employees.fields.type")} value={type} onChange={(e) => set("type", e.target.value)} error={err("type")} required>
          <option value="">—</option>
          {EMPLOYEE_TYPES.map((x) => (
            <option key={x} value={x}>
              {tDynamic(t, `employees.type.${x}`)}
            </option>
          ))}
        </Select>
        <Input label={t("employees.fields.dateOfJoining")} type="date" value={val("dateOfJoining")} onChange={(e) => set("dateOfJoining", e.target.value)} error={err("dateOfJoining")} required />
        <Select label={t("employees.fields.sectionId")} value={val("sectionId")} onChange={(e) => set("sectionId", e.target.value)} error={err("sectionId")} required>
          <option value="">—</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {name(s)}
            </option>
          ))}
        </Select>
        <Select
          label={t("employees.fields.postId")}
          value={val("postId")}
          onChange={(e) => {
            const post = posts.find((p) => p.id === e.target.value);
            // Picking a post fills in its pay level — the usual case — but it can still be changed.
            onChange({ ...values, postId: e.target.value, ...(post && matrix && !values.payLevel ? { payLevel: post.payLevel } : {}) });
          }}
          error={err("postId")}
          required
        >
          <option value="">—</option>
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              {name(p)} · {t("employees.level", { level: p.payLevel })}
            </option>
          ))}
        </Select>
      </div>

      {matrix && (
        <div className="grid gap-5 rounded-xl bg-brand-50/50 p-4 ring-1 ring-brand-600/10 sm:grid-cols-3">
          <Select label={t("employees.fields.payLevel")} value={level} onChange={(e) => onChange({ ...values, payLevel: e.target.value, payCell: "" })} error={err("payLevel")} required>
            <option value="">—</option>
            {PAY_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t("employees.level", { level: l })}
              </option>
            ))}
          </Select>
          <Select label={t("employees.fields.payCell")} value={val("payCell")} onChange={(e) => set("payCell", e.target.value)} error={err("payCell")} required disabled={!level}>
            <option value="">—</option>
            {Array.from({ length: cells }, (_, i) => i + 1).map((c) => (
              <option key={c} value={c}>
                {c} · {formatINR(basicPay(level, c))}
              </option>
            ))}
          </Select>
          <div className="flex flex-col justify-end">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{t("employees.fields.basicPay")}</p>
            <p className="tabular mt-1 text-xl font-semibold text-brand-800">{formatINR(basicPay(level, Number(values.payCell) || null))}</p>
            <p className="text-xs text-ink-500">{t("employees.profile.basicPayHint")}</p>
          </div>
        </div>
      )}

      {wage && (
        <div className="grid gap-5 rounded-xl bg-sky-50/50 p-4 ring-1 ring-sky-600/10 sm:grid-cols-2">
          <Input label={t("employees.fields.agencyName")} value={val("agencyName")} onChange={(e) => set("agencyName", e.target.value)} optionalLabel={t("common.optional")} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t("employees.fields.wageRate")} type="number" min={0} step="0.01" value={val("wageRate")} onChange={(e) => set("wageRate", e.target.value)} error={err("wageRate")} required />
            <Select label={t("employees.fields.wageBasis")} value={val("wageBasis")} onChange={(e) => set("wageBasis", e.target.value)} error={err("wageBasis")} required>
              <option value="">—</option>
              <option value="MONTHLY">{t("employees.wageBasis.MONTHLY")}</option>
              <option value="DAILY">{t("employees.wageBasis.DAILY")}</option>
            </Select>
          </div>
          <Input label={t("employees.fields.contractStart")} type="date" value={val("contractStart")} onChange={(e) => set("contractStart", e.target.value)} error={err("contractStart")} required={type !== "DAILY_WAGE"} />
          <Input label={t("employees.fields.contractEnd")} type="date" value={val("contractEnd")} onChange={(e) => set("contractEnd", e.target.value)} error={err("contractEnd")} required={type !== "DAILY_WAGE"} />
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Input label={t("employees.fields.probationEndDate")} type="date" value={val("probationEndDate")} onChange={(e) => set("probationEndDate", e.target.value)} error={err("probationEndDate")} optionalLabel={t("common.optional")} />
        <Input label={t("employees.fields.confirmationDate")} type="date" value={val("confirmationDate")} onChange={(e) => set("confirmationDate", e.target.value)} error={err("confirmationDate")} optionalLabel={t("common.optional")} />
      </div>
    </div>
  );
}

export function IdsFields({
  values,
  onChange,
  errors,
  prefix = "",
  current,
}: {
  values: Values;
  onChange: (v: Values) => void;
  errors: Errors;
  prefix?: string;
  /** Masked current values; when given, sensitive boxes may be left empty to keep them. */
  current?: { pan: string | null; aadhaar: string | null; bankAccount: string | null };
}) {
  const { t, val, set, err } = useField(values, onChange, errors, prefix);
  const keep = (masked: string | null | undefined) => (current && masked ? t("employees.edit.keepBlank", { value: masked }) : undefined);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Input label={t("employees.fields.pan")} value={val("pan")} maxLength={10} autoCapitalize="characters" spellCheck={false} onChange={(e) => set("pan", e.target.value.toUpperCase())} error={err("pan")} placeholder={current?.pan ?? "ABCPE1234F"} hint={keep(current?.pan)} autoComplete="off" />
        <Input label={t("employees.fields.aadhaar")} value={val("aadhaar")} inputMode="numeric" maxLength={14} onChange={(e) => set("aadhaar", e.target.value)} error={err("aadhaar")} placeholder={current?.aadhaar ?? "XXXX XXXX XXXX"} hint={keep(current?.aadhaar) ?? t("employees.profile.aadhaarNote")} autoComplete="off" />
        <Input label={t("employees.fields.pran")} value={val("pran")} inputMode="numeric" maxLength={12} onChange={(e) => set("pran", e.target.value)} error={err("pran")} optionalLabel={t("common.optional")} />
        <Input label={t("employees.fields.uan")} value={val("uan")} inputMode="numeric" maxLength={12} onChange={(e) => set("uan", e.target.value)} error={err("uan")} optionalLabel={t("common.optional")} />
        <Input label={t("employees.fields.esicNumber")} value={val("esicNumber")} inputMode="numeric" maxLength={10} onChange={(e) => set("esicNumber", e.target.value)} error={err("esicNumber")} optionalLabel={t("common.optional")} />
        <Input label={t("employees.fields.gpfNumber")} value={val("gpfNumber")} onChange={(e) => set("gpfNumber", e.target.value)} error={err("gpfNumber")} optionalLabel={t("common.optional")} />
      </div>
      <div className="grid gap-5 rounded-xl bg-ink-50 p-4 ring-1 ring-ink-200/70 sm:grid-cols-2">
        <Input label={t("employees.fields.bankAccount")} value={val("bankAccount")} inputMode="numeric" maxLength={18} onChange={(e) => set("bankAccount", e.target.value.replace(/\s/g, ""))} error={err("bankAccount")} placeholder={current?.bankAccount ?? ""} hint={keep(current?.bankAccount)} autoComplete="off" />
        <Input label={t("employees.fields.ifsc")} value={val("ifsc")} maxLength={11} autoCapitalize="characters" onChange={(e) => set("ifsc", e.target.value.toUpperCase())} error={err("ifsc")} placeholder="SBIN0001234" />
        <Input label={t("employees.fields.bankName")} value={val("bankName")} onChange={(e) => set("bankName", e.target.value)} optionalLabel={t("common.optional")} />
        <Input label={t("employees.fields.bankBranch")} value={val("bankBranch")} onChange={(e) => set("bankBranch", e.target.value)} optionalLabel={t("common.optional")} />
      </div>
    </div>
  );
}
