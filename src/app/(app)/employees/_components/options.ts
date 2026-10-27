import "server-only";
import { db } from "@/lib/db";
import { matrixToday } from "@/modules/payroll/compute";

/** Sections, posts and the pay matrix in force for the employee and recruitment forms. */
export async function formOptions(boardId: string) {
  const [sections, posts, payMatrix] = await Promise.all([
    db.section.findMany({ where: { boardId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, nameHi: true } }),
    db.post.findMany({ where: { boardId, isActive: true }, orderBy: [{ group: "asc" }, { name: "asc" }], select: { id: true, name: true, nameHi: true, payLevel: true } }),
    matrixToday(boardId, db),
  ]);
  return { sections, posts, payMatrix };
}
