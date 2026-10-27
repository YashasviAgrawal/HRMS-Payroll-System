"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, FileUp, Lock, PenLine, Play, Send, ShieldCheck, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { controlClass, Input, Select, Textarea } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import { tDynamic } from "@/lib/i18n";

function useAction() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      router.refresh();
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run, t, toast };
}

/** A button that posts to one endpoint and refreshes the screen. */
export function ActionButton({ url, method = "POST", body, label, done, variant = "secondary", size = "md", icon }: { url: string; method?: "POST" | "PUT"; body?: unknown; label: string; done: string; variant?: "primary" | "secondary" | "subtle"; size?: "sm" | "md"; icon?: "sign" | "send" | "lock" | "play" }) {
  const { busy, run } = useAction();
  const Icon = icon === "send" ? Send : icon === "lock" ? Lock : icon === "play" ? Play : ShieldCheck;
  return (
    <Button variant={variant} size={size} loading={busy} icon={<Icon className="size-4" />} onClick={() => run(() => api(url, { method, body: body ?? {} }), done)}>
      {label}
    </Button>
  );
}

// ─── Files ─────────────────────────────────────────────────────────────────────

interface UploadResult {
  fileName: string;
  kind: string;
  tableName: string | null;
  sourceCount: number | null;
  liveCount: number;
  deletedCount: number;
  missingMemos: number;
  error?: string;
  already?: boolean;
}

export function UploadFiles() {
  const { busy, run, t } = useAction();
  const [results, setResults] = useState<UploadResult[] | null>(null);
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const form = new FormData();
    for (const f of Array.from(list)) form.append("files", f);
    await run(async () => {
      const res = await fetch("/api/v1/migration/files", { method: "POST", body: form, credentials: "same-origin" });
      const payload = (await res.json()) as { ok: boolean; data?: { results: UploadResult[] }; error?: { message: string; code: string } };
      if (!payload.ok) throw new ApiError(payload.error?.message ?? "Error", res.status, payload.error?.code ?? "upload");
      setResults(payload.data!.results);
    }, t("migration.files.savedRead"));
  }
  return (
    <Card>
      <CardHeader title={t("migration.files.uploadTitle")} description={t("migration.files.uploadHelp")} icon={<FileUp className="size-4.5" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-200 bg-ink-50/40 px-6 py-8 text-center hover:border-brand-300 hover:bg-brand-50/30">
          <Upload className="size-6 text-brand-700" aria-hidden="true" />
          <span className="font-medium text-ink-900">{busy ? t("migration.files.uploading") : t("migration.files.choose")}</span>
          <span className="text-sm text-ink-500">{t("migration.files.kinds")}</span>
          <input type="file" multiple className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files)} data-testid="migration-upload" />
        </label>
        {results && (
          <ul className="space-y-1.5 text-sm" aria-live="polite">
            {results.map((r) => (
              <li key={r.fileName} className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className={r.error ? "size-4 text-amber-600" : "size-4 text-brand-600"} aria-hidden="true" />
                <span className="font-medium text-ink-900">{r.fileName}</span>
                <span className="text-ink-500">
                  {r.already
                    ? t("migration.files.already")
                    : r.tableName && r.kind !== "OTHER" && r.kind !== "MEMO"
                    ? t("migration.files.stagedLine", { live: r.liveCount, deleted: r.deletedCount, source: r.sourceCount ?? 0 })
                    : r.error
                      ? t("migration.files.notATable")
                      : t("migration.files.keptFrozen")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Mapping sheet ───────────────────────────────────────────────────────────

type FieldMap = { column: string | null; transform?: "none" | "kruti" | "upper"; constant?: string | null };
type Options = { asOn?: string; fy?: string; filterColumn?: string; filterValues?: string; sectionCode?: string; postCode?: string; layout?: "long" | "wide"; control?: Record<string, { gross: number; deductions: number; net: number }> };
interface FieldDef {
  key: string;
  kind: string;
  required?: boolean;
  list?: string;
  hindi?: boolean;
}

export function MappingEditor(props: {
  target: string;
  fields: FieldDef[];
  labels: Record<string, string>;
  optionKeys: string[];
  file: { id: string; columns: string[] } | null;
  map: Record<string, FieldMap>;
  codes: Record<string, Record<string, string>>;
  options: Options;
  lists: Record<string, string[]>;
  months: string[];
  canEdit: boolean;
}) {
  const { busy, run, t, toast } = useAction();
  const [map, setMap] = useState<Record<string, FieldMap>>(props.map);
  const [codes, setCodes] = useState(props.codes);
  const [options, setOptions] = useState<Options>(props.options);
  const [values, setValues] = useState<Record<string, { value: string; rows: number }[]>>({});
  const columns = props.file?.columns ?? [];
  const ro = !props.canEdit;
  const setField = (key: string, patch: Partial<FieldMap>) => setMap((m) => ({ ...m, [key]: { ...(m[key] ?? { column: null }), ...patch } }));
  const wide = props.target === "parallel" && options.layout === "wide";

  async function loadValues(f: FieldDef) {
    const column = map[f.key]?.column;
    if (!column || !props.file) return;
    try {
      const res = await api<{ values: { value: string; rows: number }[] }>(`/api/v1/migration/mappings/${props.target}/codes?field=${f.key}&column=${encodeURIComponent(column)}&fileId=${props.file.id}`);
      setValues((v) => ({ ...v, [f.key]: res.values }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    }
  }

  function save() {
    if (!props.file) return;
    const cleanMap = Object.fromEntries(Object.entries(map).filter(([, m]) => m.column || m.constant));
    run(() => api(`/api/v1/migration/mappings/${props.target}`, { method: "PUT", body: { fileId: props.file!.id, fields: cleanMap, codes, options } }), t("migration.map.saved"));
  }

  if (!props.file) return <p className="px-5 py-5 text-sm text-ink-500 sm:px-6">{t("migration.map.pickTable")}</p>;
  const shownFields = wide ? props.fields.filter((f) => f.key === "employeeCode") : props.fields;
  return (
    <div className="space-y-6 px-5 py-5 sm:px-6">
      <Table stack>
        <THead>
          <tr>
            <Th>{t("migration.map.field")}</Th>
            <Th>{t("migration.map.column")}</Th>
            <Th>{t("migration.map.howToRead")}</Th>
          </tr>
        </THead>
        <tbody>
          {shownFields.map((f) => {
            const m = map[f.key] ?? { column: null };
            return (
              <Tr key={f.key}>
                <Td label={t("migration.map.field")} className="whitespace-nowrap font-medium text-ink-900">
                  {props.labels[f.key] ?? f.key}
                  {f.required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
                </Td>
                <Td label={t("migration.map.column")}>
                  <select aria-label={`${props.labels[f.key] ?? f.key} — ${t("migration.map.column")}`} disabled={ro} value={m.column ?? ""} onChange={(e) => setField(f.key, { column: e.target.value || null })} className={controlClass(false, "h-9 min-w-[10rem]")}>
                    <option value="">{t("migration.map.none")}</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td label={t("migration.map.howToRead")}>
                  {m.column ? (
                    f.hindi ? (
                      <select aria-label={t("migration.map.howToRead")} disabled={ro} value={m.transform ?? "none"} onChange={(e) => setField(f.key, { transform: e.target.value as FieldMap["transform"] })} className={controlClass(false, "h-9 w-auto")}>
                        <option value="none">{t("migration.map.asIs")}</option>
                        <option value="kruti">{t("migration.map.kruti")}</option>
                      </select>
                    ) : f.list ? (
                      <Button size="sm" variant="subtle" onClick={() => loadValues(f)}>
                        {t("migration.map.matchCodes")}
                      </Button>
                    ) : (
                      <span className="text-sm text-ink-500">{tDynamic(t, `migration.kinds.${f.kind}`)}</span>
                    )
                  ) : f.list ? (
                    <select aria-label={t("migration.map.sameForAll")} disabled={ro} value={m.constant ?? ""} onChange={(e) => setField(f.key, { constant: e.target.value || null })} className={controlClass(false, "h-9 w-auto")}>
                      <option value="">{t("migration.map.sameForAll")}…</option>
                      {(props.lists[f.list] ?? []).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input aria-label={t("migration.map.sameForAll")} disabled={ro} value={m.constant ?? ""} onChange={(e) => setField(f.key, { constant: e.target.value || null })} placeholder={t("migration.map.sameForAll")} className={controlClass(false, "h-9 w-full min-w-[8rem]")} />
                  )}
                  {f.list && values[f.key] && (
                    <div className="mt-3 space-y-2 rounded-lg bg-ink-50 p-3" data-testid={`codes-${f.key}`}>
                      <p className="text-xs text-ink-500">{t("migration.map.codesHelp")}</p>
                      {values[f.key].map((v) => (
                        <label key={v.value} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="min-w-[6rem] font-mono text-ink-800">{v.value}</span>
                          <span className="text-xs text-ink-400">({v.rows})</span>
                          <span aria-hidden="true">→</span>
                          <select disabled={ro} value={codes[f.list!]?.[v.value] ?? ""} onChange={(e) => setCodes((c) => ({ ...c, [f.list!]: { ...(c[f.list!] ?? {}), [v.value]: e.target.value } }))} className={controlClass(false, "h-8 w-auto")}>
                            <option value="">—</option>
                            {(props.lists[f.list!] ?? []).map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>

      {wide && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-800">{t("migration.map.wideColumns")}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {columns
              .filter((c) => c !== map.employeeCode?.column)
              .map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <span className="min-w-[6rem] font-mono">{c}</span>
                  <span aria-hidden="true">→</span>
                  <select disabled={ro} value={codes.head?.[c] ?? ""} onChange={(e) => setCodes((x) => ({ ...x, head: { ...(x.head ?? {}), [c]: e.target.value } }))} className={controlClass(false, "h-8 w-auto")}>
                    <option value="">{t("migration.map.notAHead")}</option>
                    {(props.lists.head ?? []).map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {props.optionKeys.includes("asOn") && <Input type="date" label={t("migration.map.asOn")} hint={t("migration.map.asOnHint")} value={options.asOn ?? ""} disabled={ro} onChange={(e) => setOptions({ ...options, asOn: e.target.value })} required />}
        {props.optionKeys.includes("fy") && <Input label={t("migration.map.fy")} placeholder="2026-27" value={options.fy ?? ""} disabled={ro} onChange={(e) => setOptions({ ...options, fy: e.target.value })} />}
        {props.optionKeys.includes("layout") && (
          <Select label={t("migration.map.layout")} value={options.layout ?? "long"} disabled={ro} onChange={(e) => setOptions({ ...options, layout: e.target.value as Options["layout"] })}>
            <option value="long">{t("migration.map.layoutLong")}</option>
            <option value="wide">{t("migration.map.layoutWide")}</option>
          </Select>
        )}
        {props.optionKeys.includes("sectionCode") && (
          <Select label={t("migration.map.sectionCode")} hint={t("migration.map.formerHint")} value={options.sectionCode ?? ""} disabled={ro} onChange={(e) => setOptions({ ...options, sectionCode: e.target.value || undefined })}>
            <option value="">—</option>
            {(props.lists.section ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
        {props.optionKeys.includes("postCode") && (
          <Select label={t("migration.map.postCode")} value={options.postCode ?? ""} disabled={ro} onChange={(e) => setOptions({ ...options, postCode: e.target.value || undefined })}>
            <option value="">—</option>
            {(props.lists.post ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
        {props.optionKeys.includes("filterColumn") && (
          <Select label={t("migration.map.filterColumn")} hint={t("migration.map.filterHint")} value={options.filterColumn ?? ""} disabled={ro} onChange={(e) => setOptions({ ...options, filterColumn: e.target.value || undefined })}>
            <option value="">{t("migration.map.allRows")}</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
        {options.filterColumn && <Input label={t("migration.map.filterValues")} placeholder="Y, A" value={options.filterValues ?? ""} disabled={ro} onChange={(e) => setOptions({ ...options, filterValues: e.target.value })} />}
      </div>

      {props.optionKeys.includes("control") && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-800">{t("migration.map.control")}</p>
          <p className="text-xs text-ink-500">{t("migration.map.controlHelp")}</p>
          <Table stack>
            <THead>
              <tr>
                <Th>{t("migration.map.month")}</Th>
                <Th align="right">{t("migration.map.gross")}</Th>
                <Th align="right">{t("migration.map.deductions")}</Th>
                <Th align="right">{t("migration.map.net")}</Th>
              </tr>
            </THead>
            <tbody>
              {props.months.map((month) => {
                const c = options.control?.[month] ?? { gross: 0, deductions: 0, net: 0 };
                const set = (k: "gross" | "deductions" | "net", v: string) => setOptions({ ...options, control: { ...(options.control ?? {}), [month]: { ...c, [k]: Number(v) } } });
                return (
                  <Tr key={month}>
                    <Td label={t("migration.map.month")} className="font-medium">
                      {month}
                    </Td>
                    {(["gross", "deductions", "net"] as const).map((k) => (
                      <Td key={k} label={t(`migration.map.${k}`)} align="right">
                        <input type="number" step="0.01" aria-label={`${month} ${t(`migration.map.${k}`)}`} disabled={ro} value={options.control?.[month]?.[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={controlClass(false, "h-9 w-36 text-right")} />
                      </Td>
                    ))}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {props.canEdit && (
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} icon={<CheckCircle2 className="size-4" />} onClick={save}>
            {t("migration.map.save")}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Exceptions ──────────────────────────────────────────────────────────────

export function IssueActions({ issueKey, rowId, column, value, note }: { issueKey: string; rowId: string; column: string | null; value: string | null; note: string | null }) {
  const { busy, run, t } = useAction();
  const [mode, setMode] = useState<"fix" | "explain" | null>(null);
  const [text, setText] = useState(mode === "fix" ? (value ?? "") : (note ?? ""));
  if (!mode)
    return (
      <div className="flex flex-wrap gap-2">
        {column && (
          <Button size="sm" variant="secondary" icon={<PenLine className="size-3.5" />} onClick={() => (setText(value ?? ""), setMode("fix"))}>
            {t("migration.issues.fix")}
          </Button>
        )}
        <Button size="sm" variant="subtle" onClick={() => (setText(note ?? ""), setMode("explain"))}>
          {note ? t("migration.issues.editNote") : t("migration.issues.explain")}
        </Button>
      </div>
    );
  return (
    <div className="min-w-[16rem] space-y-2">
      {mode === "fix" ? (
        <Input label={t("migration.issues.newValue", { column: column ?? "" })} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      ) : (
        <Textarea label={t("migration.issues.why")} value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus />
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          onClick={async () => {
            const ok = await run(
              () => (mode === "fix" ? api(`/api/v1/migration/rows/${rowId}`, { method: "PUT", body: { column, value: text } }) : api("/api/v1/migration/notes", { body: { key: issueKey, note: text || null } })),
              mode === "fix" ? t("migration.issues.fixed") : t("migration.issues.explained"),
            );
            if (ok) setMode(null);
          }}
        >
          {t("common.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

// ─── Records ─────────────────────────────────────────────────────────────────

interface RecordRow {
  id: string;
  code: string;
  name: string;
  section: string;
  serviceBook: { by: string | null; at: string } | null;
  confirmed: { via: string | null; by: string | null; at: string } | null;
  locked: { by: string | null; at: string } | null;
  own: boolean;
}

export function RecordsTable({ kind, rows, canCompare, canLock, labels }: { kind: "staff" | "pensioners"; rows: RecordRow[]; canCompare: boolean; canLock: boolean; labels: { yes: string; no: string } }) {
  const { busy, run, t } = useAction();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const ids = [...picked];
  const act = (action: string, done: string) => run(() => api(`/api/v1/migration/records/${action}`, { body: { kind, ids } }), done).then((ok) => ok && setPicked(new Set()));
  const mark = (v: unknown) => (v ? <CheckCircle2 className="size-4 text-brand-600" aria-label={labels.yes} /> : <span className="text-ink-300">{labels.no}</span>);
  return (
    <>
      {(canCompare || canLock) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 sm:px-6">
          <span className="text-sm text-ink-500">{t("migration.records.picked", { n: ids.length })}</span>
          {canCompare && (
            <>
              <Button size="sm" disabled={!ids.length} loading={busy} onClick={() => act("service-book", t("migration.records.comparedDone"))}>
                {t("migration.records.compared")}
              </Button>
              <Button size="sm" disabled={!ids.length} loading={busy} onClick={() => act("sheet", t("migration.records.sheetDone"))}>
                {t("migration.records.sheet")}
              </Button>
            </>
          )}
          {canLock && (
            <Button size="sm" variant="primary" disabled={!ids.length} loading={busy} icon={<Lock className="size-3.5" />} onClick={() => act("lock", t("migration.records.lockedDone"))}>
              {t("migration.records.lock")}
            </Button>
          )}
        </div>
      )}
      <Table stack>
        <THead>
          <tr>
            {(canCompare || canLock) && (
              <Th className="w-10">
                <input type="checkbox" aria-label={t("migration.records.pickAll")} checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))} />
              </Th>
            )}
            <Th>{kind === "staff" ? t("reports.cols.code") : t("reports.cols.ppo")}</Th>
            <Th>{t("reports.cols.name")}</Th>
            <Th>{t("reports.cols.section")}</Th>
            <Th align="center">{t("migration.records.serviceBook")}</Th>
            <Th align="center">{t("migration.records.confirmed")}</Th>
            <Th align="center">{t("migration.records.locked")}</Th>
            {kind === "staff" && canCompare && <Th>{t("migration.records.sheetPdf")}</Th>}
          </tr>
        </THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              {(canCompare || canLock) && (
                <Td>
                  <input type="checkbox" aria-label={`${r.code} ${r.name}`} checked={picked.has(r.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                </Td>
              )}
              <Td label={kind === "staff" ? t("reports.cols.code") : t("reports.cols.ppo")} className="whitespace-nowrap font-medium">
                {r.code}
              </Td>
              <Td label={t("reports.cols.name")}>{r.name}</Td>
              <Td label={t("reports.cols.section")}>{r.section}</Td>
              <Td label={t("migration.records.serviceBook")} align="center">
                {mark(r.serviceBook)}
              </Td>
              <Td label={t("migration.records.confirmed")} align="center">
                {r.confirmed ? <Badge tone="green">{r.confirmed.via === "SELF" ? t("migration.records.viaSelf") : t("migration.records.viaSheet")}</Badge> : mark(null)}
              </Td>
              <Td label={t("migration.records.locked")} align="center">
                {mark(r.locked)}
              </Td>
              {kind === "staff" && canCompare && (
                <Td label={t("migration.records.sheetPdf")}>
                  <a href={`/api/v1/migration/records/printed/${r.id}`} target="_blank" rel="noopener" className="text-sm font-medium text-brand-700 hover:underline">
                    {t("migration.records.print")}
                  </a>
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

// ─── Parallel run ────────────────────────────────────────────────────────────

export function ParallelRunForm({ tables, defaultMonth }: { tables: { id: string; tableName: string | null; liveCount: number }[]; defaultMonth: string }) {
  const { busy, run, t } = useAction();
  const [month, setMonth] = useState(defaultMonth);
  const [fileId, setFileId] = useState(tables[0]?.id ?? "");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Input type="month" label={t("migration.parallel.month")} value={month} onChange={(e) => setMonth(e.target.value)} containerClassName="w-44" />
      <Select label={t("migration.parallel.file")} value={fileId} onChange={(e) => setFileId(e.target.value)} containerClassName="min-w-[14rem]">
        {tables.map((f) => (
          <option key={f.id} value={f.id}>
            {f.tableName} ({f.liveCount})
          </option>
        ))}
      </Select>
      <Button variant="primary" loading={busy} disabled={!fileId} icon={<Play className="size-4" />} onClick={() => run(() => api("/api/v1/migration/parallel", { body: { month, fileId } }), t("migration.parallel.done"))}>
        {t("migration.parallel.compare")}
      </Button>
    </div>
  );
}

export function DiffExplain({ id, note }: { id: string; note: string | null }) {
  const { busy, run, t } = useAction();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");
  if (!open) return note ? <p className="text-sm text-ink-700">{note}</p> : <Button size="sm" variant="subtle" onClick={() => setOpen(true)}>{t("migration.issues.explain")}</Button>;
  return (
    <div className="min-w-[16rem] space-y-2">
      <Textarea label={t("migration.issues.why")} value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={async () => (await run(() => api(`/api/v1/migration/parallel/diffs/${id}`, { method: "PUT", body: { note: text } }), t("migration.issues.explained"))) && setOpen(false)}>
          {t("common.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

// ─── Cut-over ────────────────────────────────────────────────────────────────

export function CutOverForm({ defaultDate }: { defaultDate: string }) {
  const { busy, run, t } = useAction();
  const [date, setDate] = useState(defaultDate);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Input type="date" label={t("migration.cutover.date")} value={date} onChange={(e) => setDate(e.target.value)} containerClassName="w-48" />
      <Button variant="primary" loading={busy} icon={<Send className="size-4" />} onClick={() => run(() => api("/api/v1/migration/cutover", { body: { date } }), t("migration.cutover.sent"))}>
        {t("migration.cutover.ask")}
      </Button>
    </div>
  );
}

// ─── My record ───────────────────────────────────────────────────────────────

/** §15 step 7 for the person: "my record is correct", or ask for a change. */
export function ConfirmMyRecord({ confirmedAt, changeHref }: { confirmedAt: string | null; changeHref: string | null }) {
  const { busy, run, t } = useAction();
  if (confirmedAt)
    return (
      <p className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800" data-testid="record-confirmed">
        <CheckCircle2 className="size-4" aria-hidden="true" /> {t("migration.mine.thanks")}
      </p>
    );
  return (
    <Card className="border-amber-200 bg-amber-50/40" data-testid="confirm-record">
      <CardBody className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-ink-900">{t("migration.mine.title")}</p>
          <p className="mt-0.5 text-sm text-ink-600">{t("migration.mine.body")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {changeHref && (
            <a href={changeHref} className="inline-flex h-10 items-center rounded-lg border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50">
              {t("migration.mine.wrong")}
            </a>
          )}
          <Button variant="primary" loading={busy} icon={<CheckCircle2 className="size-4" />} onClick={() => run(() => api("/api/v1/me/record/confirm", { body: {} }), t("migration.mine.done"))}>
            {t("migration.mine.correct")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
