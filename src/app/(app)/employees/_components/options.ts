import "server-only";
import { db } from "@/lib/db";

/** Sections and posts for the employee forms. */
export async function formOptions(boardId: string) {
  const [sections, posts] = await Promise.all([
    db.section.findMany({ where: { boardId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, nameHi: true } }),
    db.post.findMany({ where: { boardId, isActive: true }, orderBy: [{ group: "asc" }, { name: "asc" }], select: { id: true, name: true, nameHi: true, payLevel: true } }),
  ]);
  return { sections, posts };
}
