import type { RegisterRow } from "@/modules/attendance/service";
import type { GridRow } from "./register-grid";

/** Server register rows → plain props for the client grid. */
export function toGrid(rows: RegisterRow[]): GridRow[] {
  return rows.map((r) => ({
    employee: r.employee,
    totals: r.totals,
    days: r.days.map((d) => ({
      date: d.date,
      status: d.status,
      onRoll: d.onRoll,
      unmarked: d.unmarked,
      pending: d.pending,
      firstIn: d.firstIn ? d.firstIn.toISOString() : null,
      lastOut: d.lastOut ? d.lastOut.toISOString() : null,
      half: d.half,
    })),
  }));
}
