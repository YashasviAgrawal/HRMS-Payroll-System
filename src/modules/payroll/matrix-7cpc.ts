/**
 * 7th Central Pay Commission pay matrix (PR-01), effective 1 January 2016.
 *
 * Each level starts at its entry pay; every next cell is the previous cell + 3%, rounded to the nearest
 * ₹100 — exactly how the official matrix was built. The number of cells per level is fixed by the matrix.
 * Module 6 stores these numbers as a dated table so a new commission's matrix can be added with a new date.
 */
export interface LevelDef {
  level: string;
  entry: number;
  cells: number;
}

export const SEVENTH_CPC_LEVELS: LevelDef[] = [
  { level: "1", entry: 18000, cells: 40 },
  { level: "2", entry: 19900, cells: 40 },
  { level: "3", entry: 21700, cells: 40 },
  { level: "4", entry: 25500, cells: 40 },
  { level: "5", entry: 29200, cells: 40 },
  { level: "6", entry: 35400, cells: 40 },
  { level: "7", entry: 44900, cells: 40 },
  { level: "8", entry: 47600, cells: 40 },
  { level: "9", entry: 53100, cells: 40 },
  { level: "10", entry: 56100, cells: 40 },
  { level: "11", entry: 67700, cells: 39 },
  { level: "12", entry: 78800, cells: 34 },
  { level: "13", entry: 123100, cells: 20 },
  { level: "13A", entry: 131100, cells: 18 },
  { level: "14", entry: 144200, cells: 15 },
  { level: "15", entry: 182200, cells: 8 },
  { level: "16", entry: 205400, cells: 4 },
  { level: "17", entry: 225000, cells: 1 },
  { level: "18", entry: 250000, cells: 1 },
];

export const PAY_LEVELS = SEVENTH_CPC_LEVELS.map((l) => l.level);

/** All cells of one level, cell 1 first. */
export function levelCells(def: LevelDef): number[] {
  const cells = [def.entry];
  for (let i = 1; i < def.cells; i++) {
    cells.push(Math.round((cells[i - 1] * 1.03) / 100) * 100);
  }
  return cells;
}

/** The full matrix as { level → [cell1, cell2, …] }. */
export function seventhCpcMatrix(): Record<string, number[]> {
  return Object.fromEntries(SEVENTH_CPC_LEVELS.map((l) => [l.level, levelCells(l)]));
}

let cache: Record<string, number[]> | undefined;

/** Basic pay for a level and cell, or null when the cell does not exist. */
export function basicPay(level: string | null | undefined, cell: number | null | undefined): number | null {
  if (!level || !cell) return null;
  cache ??= seventhCpcMatrix();
  return cache[level]?.[cell - 1] ?? null;
}

export function cellCount(level: string): number {
  return SEVENTH_CPC_LEVELS.find((l) => l.level === level)?.cells ?? 0;
}
