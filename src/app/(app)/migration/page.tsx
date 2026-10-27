import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleDashed, Database, Download, Lock, ShieldCheck } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge, type Tone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Actor } from "@/lib/auth/session";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMonth, todayIST } from "@/lib/dates";
import { tDynamic, type TFunction } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { leaveRules } from "@/modules/leave/balance";
import { buildTarget } from "@/modules/migration/build";
import { checksScreen } from "@/modules/migration/checks";
import { issuesScreen, overviewScreen } from "@/modules/migration/console";
import { cutOverScreen } from "@/modules/migration/cutover";
import { mappingScreen, parseTarget } from "@/modules/migration/mapping";
import { parallelScreen } from "@/modules/migration/parallel";
import { canCutOver, canSeeMigration, canUploadMigration, cutOverOf, listFiles, stagedTables, tableRows } from "@/modules/migration/staging";
import { TARGETS, TARGET_DEFS, type TargetKey } from "@/modules/migration/targets";
import { verificationList } from "@/modules/migration/verify";
import { ActionButton, CutOverForm, DiffExplain, IssueActions, MappingEditor, ParallelRunForm, RecordsTable, UploadFiles } from "./_components/actions";

export const metadata: Metadata = { title: "Migration" };

const TABS = ["overview", "files", "map", "issues", "records", "checks", "parallel", "cutover", "export"] as const;
type Tab = (typeof TABS)[number];
type SP = { tab?: string; file?: string; target?: string; filter?: string; kind?: string; state?: string; q?: string; month?: string; page?: string; deleted?: string };

/** S-90 migration console (set-up only): the ten steps of PRD §15, from the FoxPro files to the Admin's cut-over. */
export default async function MigrationPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const see = canSeeMigration(actor);
  if (!see && !canUploadMigration(actor)) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const allowed = TABS.filter((k) => (see ? k !== "export" || canCutOver(actor) : k === "files"));
  const tab: Tab = (allowed as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : allowed[0];
  const cutOver = await cutOverOf(actor.boardId);

  return (
    <div>
      <PageHeader title={t("migration.title")} description={t("migration.subtitle")} />
      {cutOver && (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800" data-testid="cut-over-banner">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {t("migration.cutover.doneBanner", { date: formatDate(cutOver.date, locale), name: cutOver.byName })}
        </p>
      )}
      <LinkTabs className="mb-6" active={tab} tabs={allowed.map((k) => ({ key: k, label: tDynamic(t, `migration.tabs.${k}`), href: `/migration?tab=${k}` }))} />
      {tab === "overview" && <Overview actor={actor} t={t} />}
      {tab === "files" && <Files actor={actor} t={t} locale={locale} sp={sp} />}
      {tab === "map" && <MapTab actor={actor} t={t} sp={sp} />}
      {tab === "issues" && <Issues actor={actor} t={t} sp={sp} />}
      {tab === "records" && <Records actor={actor} t={t} sp={sp} />}
      {tab === "checks" && <Checks actor={actor} t={t} locale={locale} />}
      {tab === "parallel" && <Parallel actor={actor} t={t} locale={locale} sp={sp} />}
      {tab === "cutover" && <CutOver actor={actor} t={t} locale={locale} />}
      {tab === "export" && <ExportTab t={t} />}
    </div>
  );
}

type Props = { actor: Actor; t: TFunction };
/** Field names; a leave balance column is named by its leave code. */
const fieldLabel = (t: TFunction, key: string) => {
  const label = tDynamic(t, `migration.fields.${key}`);
  return label === `migration.fields.${key}` ? key : label;
};
const tone = (s: "done" | "doing" | "todo" | "attention"): Tone => (s === "done" ? "green" : s === "doing" ? "amber" : s === "attention" ? "red" : "gray");

function TargetPills({ active, base, t, counts }: { active: TargetKey; base: string; t: TFunction; counts?: Partial<Record<TargetKey, number>> }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2" role="navigation" aria-label={t("migration.targets.label")}>
      {TARGETS.map((k) => (
        <Link key={k} href={`${base}&target=${k}`} aria-current={k === active ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5 text-sm font-medium transition-colors", k === active ? "border-brand-600 bg-brand-50 text-brand-800" : "border-ink-200 bg-white text-ink-600 hover:border-ink-300")}>
          {tDynamic(t, `migration.targets.${k}`)}
          {counts?.[k] ? <span className="ml-1.5 rounded-full bg-red-100 px-1.5 text-xs text-red-700">{counts[k]}</span> : null}
        </Link>
      ))}
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────

async function Overview({ actor, t }: Props) {
  const o = await overviewScreen(actor);
  const s = o.steps;
  const stepState: Record<string, { state: "done" | "doing" | "todo" | "attention"; line: string; tab: Tab }> = {
    freeze: { state: s.freeze.files ? "done" : "todo", line: t("migration.steps.freezeLine", { n: s.freeze.files }), tab: "files" },
    decode: { state: s.decode.tables ? "done" : "todo", line: t("migration.steps.decodeLine", { n: s.decode.tables }), tab: "files" },
    stage: { state: !s.decode.tables ? "todo" : s.stage.countsMatch ? "done" : "attention", line: t("migration.steps.stageLine", { n: s.stage.rows }), tab: "files" },
    map: { state: !s.map.mapped ? "todo" : s.map.signed === s.map.mapped ? "done" : "doing", line: t("migration.steps.mapLine", { mapped: s.map.mapped, signed: s.map.signed, total: s.map.total }), tab: "map" },
    clean: { state: !s.map.mapped ? "todo" : s.clean.open ? "doing" : "done", line: t("migration.steps.cleanLine", { cleaned: s.clean.cleaned, open: s.clean.open, explained: s.clean.explained }), tab: "issues" },
    identity: { state: s.checks.signed.includes("DUPLICATES") ? "done" : s.map.mapped ? "doing" : "todo", line: t("migration.steps.identityLine"), tab: "checks" },
    verify: { state: s.verify.staff && s.verify.locked === s.verify.staff ? "done" : s.verify.serviceBook || s.verify.confirmed ? "doing" : "todo", line: t("migration.steps.verifyLine", { book: s.verify.serviceBook, confirmed: s.verify.confirmed, locked: s.verify.locked, total: s.verify.staff }), tab: "records" },
    balances: { state: s.load.done ? "done" : s.load.mapped || s.load.waiting ? "doing" : "todo", line: t("migration.steps.balancesLine", { loaded: s.load.loaded, waiting: s.load.waiting }), tab: "map" },
    parallel: { state: s.parallel.streak >= 3 ? "done" : s.parallel.months ? "doing" : "todo", line: t("migration.steps.parallelLine", { months: s.parallel.months, streak: s.parallel.streak }), tab: "parallel" },
    cutover: { state: o.cutOver ? "done" : "todo", line: o.cutOver ? t("migration.steps.cutoverDone", { date: formatDate(o.cutOver.date) }) : t("migration.steps.cutoverLine", { signed: s.checks.signed.length }), tab: "cutover" },
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
      <Card>
        <CardHeader title={t("migration.steps.title")} description={t("migration.steps.subtitle")} icon={<Database className="size-4.5" aria-hidden="true" />} />
        <ol className="divide-y divide-ink-100">
          {Object.entries(stepState).map(([key, st], i) => (
            <li key={key}>
              <Link href={`/migration?tab=${st.tab}`} className="group flex items-start gap-4 px-5 py-3.5 hover:bg-brand-50/40 sm:px-6">
                <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold", st.state === "done" ? "bg-brand-600 text-white" : st.state === "attention" ? "bg-red-100 text-red-700" : st.state === "doing" ? "bg-amber-100 text-amber-800" : "bg-ink-100 text-ink-600")}>
                  {st.state === "done" ? <CheckCircle2 className="size-4" aria-hidden="true" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-900">{tDynamic(t, `migration.steps.${key}`)}</span>
                    <Badge tone={tone(st.state)}>{tDynamic(t, `migration.state.${st.state}`)}</Badge>
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-500">{st.line}</span>
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 text-ink-300 group-hover:text-brand-600" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      </Card>
      {o.can.see && (
        <Card>
          <CardHeader title={t("migration.targets.title")} description={t("migration.targets.subtitle")} />
          <Table stack>
            <THead>
              <tr>
                <Th>{t("migration.targets.what")}</Th>
                <Th>{t("migration.targets.sheet")}</Th>
                <Th align="right">{t("migration.targets.records")}</Th>
                <Th align="right">{t("migration.targets.open")}</Th>
                <Th align="right">{t("migration.targets.loaded")}</Th>
              </tr>
            </THead>
            <tbody>
              {o.targets.map((x) => (
                <Tr key={x.key}>
                  <Td label={t("migration.targets.what")} className="min-w-[11rem]">
                    <Link href={`/migration?tab=map&target=${x.key}`} className="font-medium text-brand-700 hover:underline">
                      {tDynamic(t, `migration.targets.${x.key}`)}
                    </Link>
                    <span className="block text-xs text-ink-500">{tDynamic(t, `migration.owner.${x.owner}`)}</span>
                  </Td>
                  <Td label={t("migration.targets.sheet")}>
                    <Badge tone={!x.mapped ? "gray" : x.signed ? "green" : "amber"}>{!x.mapped ? t("migration.targets.notMapped") : x.signed ? t("migration.targets.signed") : t("migration.targets.mapped")}</Badge>
                    {x.pending && <span className="mt-1 block text-xs text-amber-700">{t("migration.targets.withChecker")}</span>}
                  </Td>
                  <Td label={t("migration.targets.records")} align="right">
                    {x.records}
                  </Td>
                  <Td label={t("migration.targets.open")} align="right" className={x.open ? "font-semibold text-red-700" : ""}>
                    {x.open}
                  </Td>
                  <Td label={t("migration.targets.loaded")} align="right">
                    {TARGET_DEFS[x.key].loads ? x.loaded : "—"}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ─── Files ──────────────────────────────────────────────────────────────────

async function Files({ actor, t, locale, sp }: Props & { locale: Locale; sp: SP }) {
  const [files, cutOver] = await Promise.all([listFiles(actor), cutOverOf(actor.boardId)]);
  const preview = sp.file && canSeeMigration(actor) ? await tableRows(actor, sp.file, { page: Number(sp.page) || 1, deleted: sp.deleted === "1" }).catch(() => null) : null;
  return (
    <div className="space-y-6">
      {!cutOver && canUploadMigration(actor) && <UploadFiles />}
      <Card>
        <CardHeader title={t("migration.files.title")} description={t("migration.files.subtitle")} />
        {files.length === 0 ? (
          <EmptyState icon={<Database className="size-6" aria-hidden="true" />} title={t("migration.files.none")} />
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("migration.files.file")}</Th>
                <Th>{t("migration.files.kind")}</Th>
                <Th align="right">{t("migration.files.foxpro")}</Th>
                <Th align="right">{t("migration.files.staged")}</Th>
                <Th align="right">{t("migration.files.deleted")}</Th>
                <Th>{t("migration.files.checksum")}</Th>
                <Th>{t("migration.files.uploaded")}</Th>
                <Th>{t("migration.files.actions")}</Th>
              </tr>
            </THead>
            <tbody>
              {files.map((f) => {
                const table = ["DBF", "CSV", "XLSX"].includes(f.kind);
                const ok = (f.sourceCount ?? 0) === f.liveCount + f.deletedCount;
                return (
                  <Tr key={f.id} className={f.replaced ? "opacity-60" : ""}>
                    <Td label={t("migration.files.file")} className="font-medium text-ink-900">
                      {f.fileName}
                      {f.replaced && <span className="block text-xs font-normal text-ink-500">{t("migration.files.replaced")}</span>}
                      {f.missingMemos > 0 && <span className="block text-xs font-normal text-amber-700">{t("migration.files.missingMemos", { n: f.missingMemos })}</span>}
                    </Td>
                    <Td label={t("migration.files.kind")}>
                      <Badge tone={table ? "blue" : "gray"}>{table ? f.kind : t("migration.files.frozenOnly")}</Badge>
                    </Td>
                    <Td label={t("migration.files.foxpro")} align="right">
                      {table ? f.sourceCount : "—"}
                    </Td>
                    <Td label={t("migration.files.staged")} align="right">
                      {table ? (
                        <span className={ok ? "text-brand-700" : "font-semibold text-red-700"}>
                          {f.liveCount + f.deletedCount} {ok ? "✓" : "✗"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td label={t("migration.files.deleted")} align="right">
                      {table ? f.deletedCount : "—"}
                    </Td>
                    <Td label={t("migration.files.checksum")}>
                      <code className="text-xs text-ink-600" title={f.sha256}>
                        {f.sha256.slice(0, 12)}…
                      </code>
                    </Td>
                    <Td label={t("migration.files.uploaded")} className="whitespace-nowrap text-sm text-ink-600">
                      {f.uploadedByName}
                      <span className="block text-xs text-ink-400">{formatDateTime(f.createdAt, locale)}</span>
                    </Td>
                    <Td label={t("migration.files.actions")} actions>
                      <div className="flex flex-wrap gap-2">
                        {table && canSeeMigration(actor) && (
                          <Link href={`/migration?tab=files&file=${f.id}`} className={buttonClass("subtle", "sm")}>
                            {t("migration.files.view")}
                          </Link>
                        )}
                        {canSeeMigration(actor) && (
                          <a href={`/api/v1/migration/files/${f.id}/download`} className={buttonClass("ghost", "sm")} aria-label={`${t("migration.files.download")} ${f.fileName}`}>
                            <Download className="size-4" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {preview && (
        <Card>
          <CardHeader
            title={`${preview.file.tableName} · ${preview.file.fileName}`}
            description={t("migration.files.previewHelp", { total: preview.total })}
            actions={
              <Link href={`/migration?tab=files&file=${preview.file.id}${sp.deleted === "1" ? "" : "&deleted=1"}`} className={buttonClass("secondary", "sm")}>
                {sp.deleted === "1" ? t("migration.files.showLive") : t("migration.files.showDeleted")}
              </Link>
            }
          />
          <Table>
            <THead>
              <tr>
                <Th>#</Th>
                {preview.file.columns.map((c) => (
                  <Th key={c.name}>{c.name}</Th>
                ))}
              </tr>
            </THead>
            <tbody>
              {preview.rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="text-ink-400">{r.rowNo}</Td>
                  {preview.file.columns.map((c) => {
                    const fixed = Object.prototype.hasOwnProperty.call(r.fixed, c.name);
                    const v = fixed ? r.fixed[c.name] : r.data[c.name];
                    return (
                      <Td key={c.name} className={cn("whitespace-nowrap text-sm", fixed && "bg-amber-50 text-amber-900")} title={fixed ? `${t("migration.files.was")}: ${String(r.data[c.name] ?? "")}` : undefined}>
                        {v === null || v === undefined ? <span className="text-ink-300">·</span> : String(v)}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </tbody>
          </Table>
          {preview.pages > 1 && (
            <div className="flex items-center justify-between border-t border-ink-100 px-5 py-3 text-sm text-ink-500 sm:px-6">
              <span>{t("migration.files.page", { page: preview.page, pages: preview.pages })}</span>
              <span className="flex gap-2">
                {preview.page > 1 && (
                  <Link className={buttonClass("secondary", "sm")} href={`/migration?tab=files&file=${preview.file.id}&page=${preview.page - 1}${sp.deleted === "1" ? "&deleted=1" : ""}`}>
                    ←
                  </Link>
                )}
                {preview.page < preview.pages && (
                  <Link className={buttonClass("secondary", "sm")} href={`/migration?tab=files&file=${preview.file.id}&page=${preview.page + 1}${sp.deleted === "1" ? "&deleted=1" : ""}`}>
                    →
                  </Link>
                )}
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Mapping ────────────────────────────────────────────────────────────────

async function MapTab({ actor, t, sp }: Props & { sp: SP }) {
  const target = (TARGETS as readonly string[]).includes(sp.target ?? "") ? parseTarget(sp.target!) : "employees";
  const [screen, built, cutOver] = await Promise.all([mappingScreen(actor, target, sp.file), buildTarget(actor, target), cutOverOf(actor.boardId)]);
  const labels: Record<string, string> = Object.fromEntries(screen.fields.map((f) => [f.key, fieldLabel(t, f.key)]));
  if (target === "leave") for (const r of await leaveRules(actor.boardId)) if (labels[r.code] !== undefined) labels[r.code] = `${r.code} · ${r.name}`;
  // Money totals: the months found in the staged pay data (the last 12), to enter FoxPro's own printed figures.
  const months = target === "payTotals" ? [...new Set(built.all.map((r) => r.values.month).filter((m): m is string => Boolean(m)))].sort().slice(-12) : [];
  const def = TARGET_DEFS[target];
  return (
    <div>
      <TargetPills active={target} base="/migration?tab=map" t={t} />
      <Card className="mb-5">
        <CardHeader
          title={tDynamic(t, `migration.targets.${target}`)}
          description={tDynamic(t, `migration.targetHelp.${target}`)}
          actions={
            <>
              {screen.signed ? <Badge tone="green">{t("migration.map.signedBy", { name: screen.signed.byName ?? "" })}</Badge> : screen.saved ? <Badge tone="amber">{t("migration.map.notSigned")}</Badge> : null}
              {!cutOver && screen.canSign && <ActionButton url={`/api/v1/migration/mappings/${target}/sign`} label={t("migration.map.sign")} done={t("migration.map.signedDone")} icon="sign" size="sm" />}
            </>
          }
        />
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-ink-100 px-5 py-4 sm:px-6">
          <input type="hidden" name="tab" value="map" />
          <input type="hidden" name="target" value={target} />
          <label className="grid min-w-[16rem] gap-1.5 text-sm font-medium text-ink-800">
            {t("migration.map.table")}
            <select name="file" defaultValue={screen.file?.id ?? ""} className={controlClass(false, "h-10")}>
              <option value="">{t("migration.map.pickTableShort")}</option>
              {screen.tables.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.tableName} ({f.liveCount}) — {f.fileName}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            {t("migration.map.open")}
          </button>
          {screen.file && !screen.saved && <p className="basis-full text-xs text-amber-700">{t("migration.map.suggested")}</p>}
        </form>
        <MappingEditor
          key={`${target}-${screen.file?.id ?? "none"}`}
          target={target}
          fields={screen.fields}
          labels={labels}
          optionKeys={def.options}
          file={screen.file ? { id: screen.file.id, columns: screen.file.columns } : null}
          map={screen.map}
          codes={screen.codes as Record<string, Record<string, string>>}
          options={screen.options}
          lists={screen.lists}
          months={months}
          canEdit={screen.canEdit && !cutOver}
        />
      </Card>
      {screen.saved && def.loads && <LoadPanel actor={actor} t={t} target={target} built={built} signed={Boolean(screen.signed)} canLoad={screen.canEdit && !cutOver} />}
      {screen.saved && !def.loads && (
        <p className="text-sm text-ink-600">
          {t("migration.map.compareOnly", { n: built.all.length })}{" "}
          <Link href={target === "payTotals" ? "/migration?tab=checks" : "/migration?tab=parallel"} className="font-medium text-brand-700 hover:underline">
            {target === "payTotals" ? t("migration.tabs.checks") : t("migration.tabs.parallel")} →
          </Link>
        </p>
      )}
    </div>
  );
}

async function LoadPanel({ t, target, built, signed, canLoad }: Props & { target: TargetKey; built: Awaited<ReturnType<typeof buildTarget>>; signed: boolean; canLoad: boolean }) {
  const explained = built.issues.filter((i) => i.note).length;
  const leftOutErrors = built.records.length - built.ready.length;
  const tiles = [
    { label: t("migration.load.read"), value: built.all.length },
    { label: t("migration.load.open"), value: built.open, bad: built.open > 0 },
    { label: t("migration.load.explained"), value: explained },
    { label: t("migration.load.loaded"), value: built.loaded },
    { label: t("migration.load.ready"), value: built.ready.length },
  ];
  const blockers = [!signed && t("migration.load.needSign"), built.open > 0 && t("migration.load.needClean", { n: built.open })].filter(Boolean) as string[];
  return (
    <Card>
      <CardHeader title={t("migration.load.title")} description={t("migration.load.subtitle")} icon={<ShieldCheck className="size-4.5" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map((x) => (
            <div key={x.label} className="rounded-xl border border-ink-100 bg-ink-50/50 px-3 py-2.5">
              <dt className="text-xs text-ink-500">{x.label}</dt>
              <dd className={cn("tabular mt-0.5 text-xl font-semibold", x.bad ? "text-red-700" : "text-ink-900")}>{x.value}</dd>
            </div>
          ))}
        </dl>
        {leftOutErrors > 0 && <p className="text-sm text-ink-600">{t("migration.load.leftOut", { n: leftOutErrors })}</p>}
        {built.leftOut > 0 && <p className="text-sm text-ink-500">{t("migration.load.filtered", { n: built.leftOut })}</p>}
        {blockers.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-800">
            {blockers.map((b) => (
              <li key={b} className="flex items-center gap-2">
                <CircleDashed className="size-4" aria-hidden="true" /> {b}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {built.open > 0 && (
            <Link href={`/migration?tab=issues&target=${target}`} className={buttonClass("secondary")}>
              {t("migration.load.seeIssues")}
            </Link>
          )}
          {canLoad && signed && built.open === 0 && built.ready.length > 0 && <ActionButton url={`/api/v1/migration/mappings/${target}/load`} label={t("migration.load.send", { n: built.ready.length })} done={t("migration.load.sent")} variant="primary" icon="send" />}
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Exceptions ─────────────────────────────────────────────────────────────

async function Issues({ actor, t, sp }: Props & { sp: SP }) {
  const target = (TARGETS as readonly string[]).includes(sp.target ?? "") ? parseTarget(sp.target!) : "employees";
  const filter = sp.filter === "explained" || sp.filter === "all" ? sp.filter : "open";
  const data = await issuesScreen(actor, target, filter);
  return (
    <div>
      <TargetPills active={target} base={`/migration?tab=issues&filter=${filter}`} t={t} />
      <Card>
        <CardHeader
          title={t("migration.issues.title", { open: data.open, total: data.total })}
          description={t("migration.issues.subtitle")}
          actions={
            <div className="flex gap-1">
              {(["open", "explained", "all"] as const).map((f) => (
                <Link key={f} href={`/migration?tab=issues&target=${target}&filter=${f}`} aria-current={f === filter ? "page" : undefined} className={cn(buttonClass(f === filter ? "subtle" : "ghost", "sm"))}>
                  {tDynamic(t, `migration.issues.filter.${f}`)}
                </Link>
              ))}
            </div>
          }
        />
        {data.shown.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="size-6" aria-hidden="true" />} title={data.file ? t("migration.issues.none") : t("migration.issues.notMapped")} />
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("migration.issues.row")}</Th>
                <Th>{t("migration.issues.problem")}</Th>
                <Th>{t("migration.issues.value")}</Th>
                <Th>{t("migration.issues.action")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.shown.map((i) => (
                <Tr key={i.key} className={i.note ? "bg-ink-50/50" : ""}>
                  <Td label={t("migration.issues.row")} className="min-w-[10rem]">
                    <span className="font-medium text-ink-900">{i.who}</span>
                    <span className="block text-xs text-ink-500">#{i.rowNo}</span>
                  </Td>
                  <Td label={t("migration.issues.problem")} className="min-w-[14rem]">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={i.level === "ERROR" ? "red" : "amber"}>{tDynamic(t, `migration.level.${i.level}`)}</Badge>
                      <span className="text-ink-900">{tDynamic(t, `migration.issueCodes.${i.code}`)}</span>
                    </span>
                    {i.field && <span className="mt-0.5 block text-xs text-ink-500">{fieldLabel(t, i.field)}</span>}
                    {i.detail && i.code === "EMPLOYEE_CHECK" && <span className="mt-0.5 block text-xs text-ink-600">{i.detail}</span>}
                    {i.note && (
                      <span className="mt-1 block text-sm text-ink-700">
                        <b>{t("migration.issues.explainedBy", { name: i.note.byName })}:</b> {i.note.text}
                      </span>
                    )}
                  </Td>
                  <Td label={t("migration.issues.value")} className="min-w-[8rem]">
                    {i.value !== null ? <code className={cn("text-sm", i.cleaned && "rounded bg-amber-50 px-1 text-amber-900")}>{i.value}</code> : i.detail && i.code !== "EMPLOYEE_CHECK" ? <code className="text-sm">{i.detail}</code> : <span className="text-ink-300">—</span>}
                  </Td>
                  <Td label={t("migration.issues.action")} actions>
                    {data.canWork && <IssueActions issueKey={i.key} rowId={i.rowId} column={i.column} value={i.value} note={i.note?.text ?? null} />}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {data.more > 0 && <p className="border-t border-ink-100 px-5 py-3 text-sm text-ink-500 sm:px-6">{t("migration.issues.more", { n: data.more })}</p>}
      </Card>
    </div>
  );
}

// ─── Records ────────────────────────────────────────────────────────────────

async function Records({ actor, t, sp }: Props & { sp: SP }) {
  const kind = sp.kind === "pensioners" ? "pensioners" : "staff";
  const state = ["TODO", "READY", "LOCKED"].includes(sp.state ?? "") ? sp.state : "ALL";
  const data = await verificationList(actor, kind, { q: sp.q, state });
  const c = data.counts;
  return (
    <Card>
      <CardHeader title={t("migration.records.title")} description={t("migration.records.subtitle")} />
      <div className="grid grid-cols-2 gap-3 border-b border-ink-100 px-5 py-4 sm:grid-cols-4 sm:px-6">
        {[
          [t("migration.records.total"), c.total],
          [t("migration.records.serviceBook"), c.serviceBook],
          [t("migration.records.confirmed"), c.confirmed],
          [t("migration.records.locked"), c.locked],
        ].map(([label, v]) => (
          <div key={String(label)}>
            <p className="text-xs text-ink-500">{label}</p>
            <p className="tabular text-xl font-semibold text-ink-900">{v}</p>
          </div>
        ))}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 border-b border-ink-100 px-5 py-4 sm:px-6">
        <input type="hidden" name="tab" value="records" />
        <select name="kind" defaultValue={kind} aria-label={t("migration.records.kind")} className={controlClass(false, "h-10 w-auto")}>
          <option value="staff">{t("migration.records.staff")}</option>
          <option value="pensioners">{t("migration.records.pensioners")}</option>
        </select>
        <select name="state" defaultValue={state} aria-label={t("migration.records.state")} className={controlClass(false, "h-10 w-auto")}>
          {["ALL", "TODO", "READY", "LOCKED"].map((s) => (
            <option key={s} value={s}>
              {tDynamic(t, `migration.records.states.${s}`)}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={sp.q} placeholder={t("migration.records.search")} aria-label={t("common.search")} className={controlClass(false, "h-10 min-w-[12rem] flex-1")} />
        <button type="submit" className={buttonClass("secondary")}>
          {t("common.search")}
        </button>
      </form>
      {data.rows.length === 0 ? (
        <EmptyState title={t("migration.records.none")} />
      ) : (
        <RecordsTable kind={kind} rows={data.rows} canCompare={data.canCompare} canLock={data.canLock} labels={{ yes: t("migration.records.yes"), no: t("migration.records.no") }} />
      )}
    </Card>
  );
}

// ─── Checks ─────────────────────────────────────────────────────────────────

async function Checks({ actor, t, locale }: Props & { locale: Locale }) {
  const [{ checks }, cutOver] = await Promise.all([checksScreen(actor), cutOverOf(actor.boardId)]);
  const money = (code: string) => code !== "RECORD_COUNTS" && code !== "DUPLICATES" && code !== "EXCEPTIONS";
  return (
    <div className="grid gap-5">
      {checks.map((c) => (
        <Card key={c.code} data-testid={`check-${c.code}`}>
          <CardHeader
            title={tDynamic(t, `migration.checks.names.${c.code}`)}
            description={tDynamic(t, `migration.checks.rules.${c.code}`)}
            icon={c.pass ? <CheckCircle2 className="size-4.5" aria-hidden="true" /> : <CircleDashed className="size-4.5" aria-hidden="true" />}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={c.pass ? "green" : "amber"}>{c.pass ? t("migration.checks.passes") : t("migration.checks.notYet")}</Badge>
                {!cutOver && c.canSign && <ActionButton url={`/api/v1/migration/checks/${c.code}/sign`} label={t("migration.checks.sign", { as: tDynamic(t, `permission.${c.canSign}`) })} done={t("migration.checks.signed")} size="sm" icon="sign" />}
              </div>
            }
          />
          <CardBody className="space-y-3">
            {c.reason && <p className="text-sm text-amber-800">{tDynamic(t, c.reason.key, c.reason.vars)}</p>}
            <p className="text-sm text-ink-600">
              {t("migration.checks.signedBy")}{" "}
              {c.signers.map((p, i) => {
                const s = c.signed.find((x) => x.permission === p);
                return (
                  <span key={p}>
                    {i > 0 && " · "}
                    <b>{tDynamic(t, `permission.${p}`)}</b>: {s ? `${s.name} (${formatDateTime(s.at, locale)})` : t("migration.checks.waiting")}
                  </span>
                );
              })}
            </p>
            {c.rows.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">{t("migration.checks.figures", { n: c.rows.length, bad: c.rows.filter((r) => !r.ok).length })}</summary>
                <div className="mt-3">
                  <Table stack>
                    <THead>
                      <tr>
                        <Th>{t("migration.checks.item")}</Th>
                        {c.columns.map((col) => (
                          <Th key={col} align="right">
                            {tDynamic(t, `migration.checks.cols.${col}`)}
                          </Th>
                        ))}
                        <Th align="center">{t("migration.checks.ok")}</Th>
                      </tr>
                    </THead>
                    <tbody>
                      {c.rows.slice(0, 300).map((r) => (
                        <Tr key={r.label} className={r.ok ? "" : "bg-red-50/60"}>
                          <Td label={t("migration.checks.item")} className="font-medium">
                            {c.code === "EXCEPTIONS" ? tDynamic(t, `migration.targets.${r.label}`) : c.code === "DUPLICATES" ? tDynamic(t, `migration.checks.ids.${r.label}`) : c.code === "MONEY_TOTALS" ? formatMonth(r.label, locale) : r.label}
                          </Td>
                          {r.cells.map((v, i) => (
                            <Td key={i} label={tDynamic(t, `migration.checks.cols.${c.columns[i]}`)} align="right">
                              {v === null ? "—" : money(c.code) && typeof v === "number" ? formatINR(v) : v}
                            </Td>
                          ))}
                          <Td label={t("migration.checks.ok")} align="center">
                            {r.ok ? "✓" : "✗"}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </details>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

// ─── Parallel run ───────────────────────────────────────────────────────────

async function Parallel({ actor, t, locale, sp }: Props & { locale: Locale; sp: SP }) {
  const [data, tables, cutOver] = await Promise.all([parallelScreen(actor, sp.month), stagedTables(actor.boardId), cutOverOf(actor.boardId)]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t("migration.parallel.title")} description={t("migration.parallel.subtitle")} actions={<Badge tone={data.streak >= 3 ? "green" : "amber"}>{t("migration.parallel.streak", { n: data.streak })}</Badge>} />
        {!cutOver && data.canRun && (
          <CardBody className="border-b border-ink-100">
            {tables.length ? <ParallelRunForm tables={tables.map((f) => ({ id: f.id, tableName: f.tableName, liveCount: f.liveCount }))} defaultMonth={todayIST().slice(0, 7)} /> : <p className="text-sm text-ink-500">{t("migration.parallel.uploadFirst")}</p>}
            <p className="mt-2 text-xs text-ink-500">{t("migration.parallel.mapFirst")}</p>
          </CardBody>
        )}
        {data.months.length === 0 ? (
          <EmptyState title={t("migration.parallel.none")} />
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("migration.parallel.month")}</Th>
                <Th align="right">{t("migration.parallel.people")}</Th>
                <Th align="right">{t("migration.parallel.matched")}</Th>
                <Th align="right">{t("migration.parallel.diffs")}</Th>
                <Th>{t("migration.parallel.state")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.months.map((m) => (
                <Tr key={m.id}>
                  <Td label={t("migration.parallel.month")}>
                    <Link href={`/migration?tab=parallel&month=${m.month}`} className="font-medium text-brand-700 hover:underline">
                      {formatMonth(m.month, locale)}
                    </Link>
                  </Td>
                  <Td label={t("migration.parallel.people")} align="right">
                    {m.people}
                  </Td>
                  <Td label={t("migration.parallel.matched")} align="right">
                    {m.matched}
                  </Td>
                  <Td label={t("migration.parallel.diffs")} align="right">
                    {m.explained} / {m.diffs}
                  </Td>
                  <Td label={t("migration.parallel.state")}>
                    <Badge tone={m.ok ? "green" : "amber"}>{m.ok ? t("migration.parallel.ok") : t("migration.parallel.toExplain")}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {data.open && (
        <Card>
          <CardHeader title={t("migration.parallel.diffsOf", { month: formatMonth(data.open.month, locale) })} description={t("migration.parallel.diffsHelp")} />
          {data.open.diffs.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="size-6" aria-hidden="true" />} title={t("migration.parallel.allMatch")} />
          ) : (
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("reports.cols.code")}</Th>
                  <Th>{t("migration.parallel.head")}</Th>
                  <Th align="right">{t("migration.parallel.foxpro")}</Th>
                  <Th align="right">{t("migration.parallel.ours")}</Th>
                  <Th align="right">{t("migration.parallel.diff")}</Th>
                  <Th>{t("migration.parallel.why")}</Th>
                </tr>
              </THead>
              <tbody>
                {data.open.diffs.map((d) => (
                  <Tr key={d.id} className={d.note ? "" : "bg-amber-50/50"}>
                    <Td label={t("reports.cols.code")} className="min-w-[9rem]">
                      <span className="font-medium">{d.employeeCode}</span>
                      {d.name && <span className="block text-xs text-ink-500">{d.name}</span>}
                    </Td>
                    <Td label={t("migration.parallel.head")}>{d.head === "NOT_PAID_HERE" || d.head === "NOT_IN_FOXPRO" ? tDynamic(t, `migration.parallel.${d.head}`) : d.head}</Td>
                    <Td label={t("migration.parallel.foxpro")} align="right">
                      {formatINR(d.fox)}
                    </Td>
                    <Td label={t("migration.parallel.ours")} align="right">
                      {formatINR(d.ours)}
                    </Td>
                    <Td label={t("migration.parallel.diff")} align="right" className="font-semibold">
                      {formatINR(d.fox - d.ours)}
                    </Td>
                    <Td label={t("migration.parallel.why")} className="min-w-[14rem]">
                      {!cutOver && data.canRun ? <DiffExplain id={d.id} note={d.note} /> : (d.note ?? "—")}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Cut-over and export ────────────────────────────────────────────────────

async function CutOver({ actor, t, locale }: Props & { locale: Locale }) {
  const data = await cutOverScreen(actor);
  return (
    <Card>
      <CardHeader title={t("migration.cutover.title")} description={t("migration.cutover.subtitle")} icon={<Lock className="size-4.5" aria-hidden="true" />} />
      <CardBody className="space-y-5">
        <ul className="space-y-2">
          {data.ready.map((r) => (
            <li key={r.key} className="flex items-start gap-3 text-sm">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 text-brand-600" aria-hidden="true" /> : <CircleDashed className="mt-0.5 size-4 text-amber-600" aria-hidden="true" />}
              <span className={r.ok ? "text-ink-800" : "text-ink-900"}>{tDynamic(t, `migration.cutover.ready.${r.key}`, r.vars)}</span>
            </li>
          ))}
        </ul>
        {data.cutOver ? (
          <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">{t("migration.cutover.doneBanner", { date: formatDate(data.cutOver.date, locale), name: data.cutOver.byName })}</p>
        ) : data.pending ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{t("migration.cutover.pending", { date: formatDate(data.pending.date, locale), name: data.pending.byName })}</p>
        ) : data.canPropose ? (
          <CutOverForm defaultDate={todayIST()} />
        ) : (
          <p className="text-sm text-ink-500">{t("migration.cutover.notYet")}</p>
        )}
        <p className="text-xs text-ink-500">{t("migration.cutover.foxpro")}</p>
      </CardBody>
    </Card>
  );
}

function ExportTab({ t }: { t: TFunction }) {
  return (
    <Card>
      <CardHeader title={t("migration.export.title")} description={t("migration.export.subtitle")} icon={<Download className="size-4.5" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
          <li>{t("migration.export.point1")}</li>
          <li>{t("migration.export.point2")}</li>
          <li>{t("migration.export.point3")}</li>
        </ul>
        <a href="/api/v1/migration/export" download className={buttonClass("primary")}>
          <Download className="size-4" aria-hidden="true" /> {t("migration.export.download")}
        </a>
      </CardBody>
    </Card>
  );
}
