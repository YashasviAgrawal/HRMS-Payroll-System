"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
import { Input, Select, controlClass } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

interface Row {
  sectionId: string;
  postId: string;
  section: string;
  post: string;
  level: string;
  sanctioned: number;
  filled: number;
  vacant: number;
  excess: number;
}

export function PostsTable({ rows, sections, posts, canEdit }: { rows: Row[]; sections: { id: string; name: string }[]; posts: { id: string; name: string; level: string }[]; canEdit: boolean }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState<{ sectionId: string; postId: string; sanctioned: number }[]>([]);
  const [orderRef, setOrderRef] = useState("");
  const [busy, setBusy] = useState(false);
  const key = (r: { sectionId: string; postId: string }) => `${r.sectionId}:${r.postId}`;

  async function submit() {
    setBusy(true);
    try {
      const changed = rows.filter((r) => values[key(r)] !== undefined && values[key(r)] !== r.sanctioned).map((r) => ({ sectionId: r.sectionId, postId: r.postId, sanctioned: values[key(r)] }));
      await api("/api/v1/sanctioned-posts", { body: { rows: [...changed, ...extra.filter((x) => x.sectionId && x.postId)], orderRef } });
      toast(t("employees.postsPage.sent"));
      setEditing(false);
      setValues({});
      setExtra([]);
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {canEdit && !editing && (
        <div className="flex justify-end border-b border-ink-100 px-5 py-3 sm:px-6">
          <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
            {t("employees.postsPage.edit")}
          </Button>
        </div>
      )}
      <Table>
        <THead>
          <tr>
            <Th>{t("common.section")}</Th>
            <Th>{t("common.post")}</Th>
            <Th align="right">{t("employees.postsPage.sanctioned")}</Th>
            <Th align="right">{t("employees.postsPage.filled")}</Th>
            <Th align="right">{t("employees.postsPage.vacant")}</Th>
          </tr>
        </THead>
        <tbody>
          {rows.map((r, i) => {
            const showSection = i === 0 || rows[i - 1].section !== r.section;
            return (
              <Tr key={key(r)}>
                <Td className={showSection ? "font-medium text-ink-900" : "text-transparent"}>{r.section}</Td>
                <Td>
                  {r.post} <span className="text-xs text-ink-400">· L{r.level}</span>
                </Td>
                <Td align="right">
                  {editing ? (
                    <input
                      type="number"
                      min={0}
                      aria-label={`${r.section} ${r.post}`}
                      className={controlClass(false, "ml-auto h-8 w-20 text-right")}
                      value={values[key(r)] ?? r.sanctioned}
                      onChange={(e) => setValues({ ...values, [key(r)]: Number(e.target.value) })}
                    />
                  ) : (
                    r.sanctioned
                  )}
                </Td>
                <Td align="right">{r.filled}</Td>
                <Td align="right">
                  {r.excess > 0 ? <Badge tone="red">+{r.excess}</Badge> : r.vacant > 0 ? <Badge tone="amber">{r.vacant}</Badge> : <span className="text-ink-400">0</span>}
                </Td>
              </Tr>
            );
          })}
          {editing &&
            extra.map((x, i) => (
              <Tr key={`extra-${i}`}>
                <Td>
                  <Select aria-label={t("common.section")} value={x.sectionId} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, sectionId: e.target.value } : y)))}>
                    <option value="">—</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <Select aria-label={t("common.post")} value={x.postId} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, postId: e.target.value } : y)))}>
                    <option value="">—</option>
                    {posts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · L{p.level}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td align="right">
                  <input type="number" min={0} aria-label={t("employees.postsPage.sanctioned")} className={controlClass(false, "ml-auto h-8 w-20 text-right")} value={x.sanctioned} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, sanctioned: Number(e.target.value) } : y)))} />
                </Td>
                <Td />
                <Td />
              </Tr>
            ))}
        </tbody>
      </Table>
      {editing && (
        <CardFooter className="justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <Button size="sm" variant="subtle" icon={<Plus className="size-4" />} onClick={() => setExtra([...extra, { sectionId: "", postId: "", sanctioned: 1 }])}>
              {t("employees.postsPage.addRow")}
            </Button>
            <Input label={t("employees.postsPage.orderRef")} value={orderRef} onChange={(e) => setOrderRef(e.target.value)} containerClassName="w-72" />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={submit} icon={<Send className="size-4" />}>
              {t("employees.edit.submit")}
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
