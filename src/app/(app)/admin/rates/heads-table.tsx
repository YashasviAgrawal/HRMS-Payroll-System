"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilLine, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

export interface HeadRow {
  code: string;
  name: string;
  nameHi: string;
  kind: "EARNING" | "DEDUCTION" | "EMPLOYER";
  calc: "SYSTEM" | "FIXED" | "PERCENT_BASIC" | "ITEM";
  value: number;
  postCodes: string[];
  prorate: boolean;
  taxable: boolean;
  accountHead: string;
  isActive: boolean;
  version: number;
}

const blank: HeadRow = { code: "", name: "", nameHi: "", kind: "EARNING", calc: "FIXED", value: 0, postCodes: [], prorate: true, taxable: true, accountHead: "", isActive: true, version: 0 };

/** PR-03 / PR-04: pay heads with their formula and account head; HR & Accounts propose, an Admin approves. */
export function HeadsTable({ heads, pending, canPropose }: { heads: HeadRow[]; pending: string[]; canPropose: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [edit, setEdit] = useState<{ row: HeadRow; posts: string; isNew: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<HeadRow>) => setEdit((e) => (e ? { ...e, row: { ...e.row, ...patch } } : e));

  const formula = (h: HeadRow) => {
    if (h.calc === "SYSTEM") return t("rates.heads.systemNote", { what: tDynamic(t, `rates.heads.what.${h.code}`) });
    if (h.calc === "FIXED") return t("rates.heads.fixedAmount", { value: h.value.toLocaleString("en-IN") });
    if (h.calc === "PERCENT_BASIC") return t("rates.heads.percentOfBasic", { value: h.value });
    return tDynamic(t, "rates.heads.calcs.ITEM");
  };

  async function send() {
    if (!edit) return;
    setBusy(true);
    setErrors({});
    const r = edit.row;
    try {
      await api("/api/v1/rates/heads", {
        body: { code: r.code, name: r.name, nameHi: r.nameHi, kind: r.kind, calc: r.calc, value: r.value, postCodes: edit.posts.split(",").map((s) => s.trim()).filter(Boolean), prorate: r.prorate, taxable: r.taxable, accountHead: r.accountHead, isActive: r.isActive },
      });
      toast(t("rates.sent"));
      setEdit(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Table stack>
        <THead>
          <tr>
            <Th className="w-[22%]">{t("rates.heads.name")}</Th>
            <Th>{t("rates.heads.kind")}</Th>
            <Th className="w-[28%]">{t("rates.heads.calc")}</Th>
            <Th>{t("rates.heads.posts")}</Th>
            <Th className="w-[20%]">{t("rates.heads.accountHead")}</Th>
            <Th />
          </tr>
        </THead>
        <tbody>
          {heads.map((h) => (
            <Tr key={h.code} className={h.isActive ? undefined : "bg-ink-50/70"}>
              <Td>
                <span className="font-medium text-ink-900">{locale === "hi" ? h.nameHi : h.name}</span> <span className="text-xs font-semibold text-ink-400">{h.code}</span>
                <span className="block text-xs text-ink-500">
                  {t("rates.heads.version", { n: h.version })}
                  {!h.isActive && ` · ${t("rates.heads.inactive")}`}
                </span>
              </Td>
              <Td label={t("rates.heads.kind")}>
                <Badge tone={h.kind === "EARNING" ? "green" : h.kind === "DEDUCTION" ? "red" : "blue"}>{tDynamic(t, `rates.heads.kinds.${h.kind}`)}</Badge>
              </Td>
              <Td label={t("rates.heads.calc")} className="text-sm">
                {formula(h)}
              </Td>
              <Td label={t("rates.heads.posts")} className="text-sm">
                {h.postCodes.length ? h.postCodes.join(", ") : <span className="whitespace-nowrap text-ink-400">{t("rates.heads.allPosts")}</span>}
              </Td>
              <Td label={t("rates.heads.accountHead")} className="text-xs text-ink-600">
                {h.accountHead}
              </Td>
              <Td align="right" actions>
                {pending.includes(h.code) ? (
                  <Badge tone="amber">{t("rates.pending")}</Badge>
                ) : (
                  canPropose && (
                    <Button size="sm" variant="ghost" icon={<PencilLine className="size-4" />} onClick={() => { setEdit({ row: h, posts: h.postCodes.join(", "), isNew: false }); setErrors({}); }}>
                      {t("rates.heads.edit")}
                    </Button>
                  )
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {canPropose && (
        <div className="border-t border-ink-100 px-5 py-3 sm:px-6">
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setEdit({ row: blank, posts: "", isNew: true }); setErrors({}); }}>
            {t("rates.heads.add")}
          </Button>
        </div>
      )}
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        closeLabel={t("common.close")}
        title={edit ? (edit.isNew ? t("rates.heads.add") : `${edit.row.code} · ${locale === "hi" ? edit.row.nameHi : edit.row.name}`) : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={send}>
              {t("common.submit")}
            </Button>
          </>
        }
      >
        {edit && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t("rates.heads.code")} value={edit.row.code} disabled={!edit.isNew} onChange={(e) => set({ code: e.target.value.toUpperCase() })} error={errors.code} required />
            <Select label={t("rates.heads.kind")} value={edit.row.kind} disabled={!edit.isNew} onChange={(e) => set({ kind: e.target.value as HeadRow["kind"] })}>
              {(["EARNING", "DEDUCTION", "EMPLOYER"] as const).map((k) => (
                <option key={k} value={k}>
                  {tDynamic(t, `rates.heads.kinds.${k}`)}
                </option>
              ))}
            </Select>
            <Input label={t("rates.heads.name")} value={edit.row.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} required />
            <Input label={t("rates.heads.nameHi")} lang="hi" value={edit.row.nameHi} onChange={(e) => set({ nameHi: e.target.value })} error={errors.nameHi} required />
            {edit.row.calc === "SYSTEM" ? (
              <p className="text-sm text-ink-600 sm:col-span-2">{t("rates.heads.systemNote", { what: tDynamic(t, `rates.heads.what.${edit.row.code}`) })}</p>
            ) : (
              <>
                <Select label={t("rates.heads.calc")} value={edit.row.calc} onChange={(e) => set({ calc: e.target.value as HeadRow["calc"] })}>
                  {(["FIXED", "PERCENT_BASIC", "ITEM"] as const).map((c) => (
                    <option key={c} value={c}>
                      {tDynamic(t, `rates.heads.calcs.${c}`)}
                    </option>
                  ))}
                </Select>
                {edit.row.calc !== "ITEM" && <Input label={t("rates.heads.value")} inputMode="decimal" value={String(edit.row.value)} onChange={(e) => set({ value: Number(e.target.value) || 0 })} error={errors.value} />}
                <Input label={t("rates.heads.posts")} hint={t("rates.heads.postsHelp")} value={edit.posts} onChange={(e) => setEdit({ ...edit, posts: e.target.value.toUpperCase() })} error={errors.postCodes} containerClassName="sm:col-span-2" />
              </>
            )}
            <Input label={t("rates.heads.accountHead")} value={edit.row.accountHead} onChange={(e) => set({ accountHead: e.target.value })} error={errors.accountHead} containerClassName="sm:col-span-2" required />
            <Checkbox label={t("rates.heads.prorate")} checked={edit.row.prorate} onChange={(e) => set({ prorate: e.target.checked })} />
            <Checkbox label={t("rates.heads.taxable")} checked={edit.row.taxable} onChange={(e) => set({ taxable: e.target.checked })} />
            <Checkbox label={t("rates.heads.active")} checked={edit.row.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          </div>
        )}
      </Dialog>
    </>
  );
}
