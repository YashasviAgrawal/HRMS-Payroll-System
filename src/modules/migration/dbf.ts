/**
 * §15 steps 1–3: reads FoxPro / dBase tables (.DBF) and their memo files (.FPT, or dBase .DBT) without any outside
 * library, so the migration console can stage the old system's files exactly as they are — deleted rows included,
 * kept apart. Pure functions; the writer exists for tests and the demo files.
 *
 * Format: a 32-byte header (version, record count, header and record length, code page), 32-byte field descriptors up
 * to 0x0D, then fixed-length records that start with a deletion flag (" " live, "*" deleted).
 */
export type DbfValue = string | number | boolean | null;

export interface DbfColumn {
  name: string;
  type: string;
  length: number;
  decimals: number;
}

export interface DbfRow {
  rowNo: number;
  deleted: boolean;
  values: Record<string, DbfValue>;
}

export interface DbfTable {
  version: number;
  /** "YYYY-MM-DD" of the last update written in the header. */
  updated: string | null;
  /** Records the header says the table holds (live and deleted). */
  count: number;
  columns: DbfColumn[];
  rows: DbfRow[];
  /** Memo fields that point outside the memo file (or no memo file was given). */
  missingMemos: number;
}

const decoder = new TextDecoder("windows-1252");
const text = (b: Buffer) => decoder.decode(b).replace(/\0+$/, "");

function isoFromYmd(s: string): string | null {
  const t = s.trim();
  if (!/^\d{8}$/.test(t)) return null;
  const iso = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Julian day number → "YYYY-MM-DD" (Visual FoxPro DateTime). */
function isoFromJulian(day: number): string | null {
  if (day <= 0) return null;
  return new Date((day - 2440588) * 86_400_000).toISOString().slice(0, 10);
}

function memoReader(memo: Buffer | undefined) {
  if (!memo || memo.length < 512) return null;
  // FPT: block size in bytes 6–7 (big-endian); dBase .DBT uses 512-byte blocks and ends text with 0x1A 0x1A.
  const fptSize = memo.readUInt16BE(6);
  const isFpt = fptSize > 0;
  const blockSize = isFpt ? fptSize : 512;
  return (block: number): string | null => {
    const at = block * blockSize;
    if (block <= 0 || at >= memo.length) return null;
    if (isFpt) {
      if (at + 8 > memo.length) return null;
      const len = memo.readUInt32BE(at + 4);
      return text(memo.subarray(at + 8, Math.min(memo.length, at + 8 + len)));
    }
    let end = memo.indexOf(0x1a, at);
    if (end < 0) end = memo.length;
    return text(memo.subarray(at, end));
  };
}

export function readDbf(dbf: Buffer, memo?: Buffer): DbfTable {
  if (dbf.length < 33) throw new Error("Not a DBF file: too short");
  const version = dbf[0];
  const count = dbf.readUInt32LE(4);
  const headerLength = dbf.readUInt16LE(8);
  const recordLength = dbf.readUInt16LE(10);
  if (headerLength < 33 || recordLength < 1 || headerLength > dbf.length) throw new Error("Not a DBF file: bad header");
  const yy = dbf[1];
  const updated = dbf[2] >= 1 && dbf[2] <= 12 && dbf[3] >= 1 && dbf[3] <= 31 ? `${yy < 80 ? 2000 + yy : 1900 + yy}-${String(dbf[2]).padStart(2, "0")}-${String(dbf[3]).padStart(2, "0")}` : null;
  const visual = version === 0x30 || version === 0x31 || version === 0x32;

  const columns: (DbfColumn & { offset: number; hidden: boolean })[] = [];
  let offset = 1;
  for (let p = 32; p + 32 <= headerLength && dbf[p] !== 0x0d; p += 32) {
    const name = text(dbf.subarray(p, p + 11)).trim();
    const type = String.fromCharCode(dbf[p + 11]).toUpperCase();
    const length = dbf[p + 16];
    const decimals = dbf[p + 17];
    const flags = dbf[p + 18];
    columns.push({ name, type, length, decimals, offset, hidden: type === "0" || (visual && (flags & 0x01) === 1) });
    offset += length;
  }
  if (!columns.length) throw new Error("Not a DBF file: no fields");

  const readMemo = memoReader(memo);
  let missingMemos = 0;
  const rows: DbfRow[] = [];
  for (let i = 0; i < count; i++) {
    const at = headerLength + i * recordLength;
    if (at + recordLength > dbf.length) break;
    const flag = dbf[at];
    if (flag === 0x1a) break;
    const values: Record<string, DbfValue> = {};
    for (const c of columns) {
      if (c.hidden) continue;
      const raw = dbf.subarray(at + c.offset, at + c.offset + c.length);
      let v: DbfValue = null;
      switch (c.type) {
        case "C":
        case "V":
        case "Q":
          v = text(raw).trimEnd() || null;
          break;
        case "N":
        case "F": {
          const s = text(raw).trim();
          v = s === "" || /^\*+$/.test(s) ? null : Number.isFinite(Number(s)) ? Number(s) : null;
          break;
        }
        case "D":
          v = isoFromYmd(text(raw));
          break;
        case "L": {
          const s = text(raw).trim().toUpperCase();
          v = s === "T" || s === "Y" ? true : s === "F" || s === "N" ? false : null;
          break;
        }
        case "I":
          v = raw.readInt32LE(0);
          break;
        case "Y":
          v = Number(raw.readBigInt64LE(0)) / 10000;
          break;
        case "B":
          v = visual ? raw.readDoubleLE(0) : null;
          if (!visual) {
            const block = Number(text(raw).trim());
            v = readMemo && block ? readMemo(block) : null;
          }
          break;
        case "T":
          v = isoFromJulian(raw.readInt32LE(0));
          break;
        case "M":
        case "G":
        case "P": {
          const block = c.length === 4 ? raw.readInt32LE(0) : Number(text(raw).trim() || 0);
          if (block > 0) {
            v = readMemo ? readMemo(block) : null;
            if (v === null) missingMemos++;
          }
          break;
        }
        default:
          v = text(raw).trim() || null;
      }
      values[c.name] = v;
    }
    rows.push({ rowNo: i + 1, deleted: flag === 0x2a, values });
  }
  return { version, updated, count, columns: columns.filter((c) => !c.hidden).map(({ name, type, length, decimals }) => ({ name, type, length, decimals })), rows, missingMemos };
}

/** Writes a FoxPro 2.x table (C, N, D, L and M fields) and its .FPT — for tests and the demo files. */
export function writeDbf(columns: DbfColumn[], rows: { deleted?: boolean; values: Record<string, DbfValue> }[]): { dbf: Buffer; fpt: Buffer | null } {
  const hasMemo = columns.some((c) => c.type === "M");
  const fields = columns.map((c) => ({ ...c, length: c.type === "D" ? 8 : c.type === "L" ? 1 : c.type === "M" ? 10 : c.length }));
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((a, c) => a + c.length, 0);
  const out = Buffer.alloc(headerLength + rows.length * recordLength + 1, 0x20);
  out.fill(0, 0, headerLength);
  out[0] = hasMemo ? 0xf5 : 0x03;
  out[1] = 126;
  out[2] = 10;
  out[3] = 27;
  out.writeUInt32LE(rows.length, 4);
  out.writeUInt16LE(headerLength, 8);
  out.writeUInt16LE(recordLength, 10);
  out[29] = 0x03;
  fields.forEach((c, i) => {
    const p = 32 + i * 32;
    out.write(c.name.slice(0, 10), p, "latin1");
    out[p + 11] = c.type.charCodeAt(0);
    out[p + 16] = c.length;
    out[p + 17] = c.decimals;
  });
  out[headerLength - 1] = 0x0d;
  const blockSize = 64;
  const memoBlocks: Buffer[] = [];
  let nextBlock = 512 / blockSize;
  const encode = (s: string) => Buffer.from(Array.from(s, (ch) => { const code = ch.charCodeAt(0); return code < 256 ? code : 0x3f; }));
  rows.forEach((r, i) => {
    const at = headerLength + i * recordLength;
    out[at] = r.deleted ? 0x2a : 0x20;
    let off = at + 1;
    for (const c of fields) {
      const v = r.values[c.name];
      let s = "";
      if (v !== null && v !== undefined) {
        if (c.type === "N" || c.type === "F") s = (typeof v === "number" ? v.toFixed(c.decimals) : String(v)).padStart(c.length).slice(-c.length);
        else if (c.type === "D") s = String(v).replace(/-/g, "");
        else if (c.type === "L") s = v ? "T" : "F";
        else if (c.type === "M") {
          const body = encode(String(v));
          const block = Buffer.alloc(Math.ceil((8 + body.length) / blockSize) * blockSize);
          block.writeUInt32BE(1, 0);
          block.writeUInt32BE(body.length, 4);
          body.copy(block, 8);
          s = String(nextBlock).padStart(10);
          nextBlock += block.length / blockSize;
          memoBlocks.push(block);
        } else s = String(v);
      }
      encode(s.slice(0, c.length).padEnd(c.length)).copy(out, off);
      off += c.length;
    }
  });
  out[out.length - 1] = 0x1a;
  let fpt: Buffer | null = null;
  if (hasMemo) {
    const head = Buffer.alloc(512);
    head.writeUInt32BE(nextBlock, 0);
    head.writeUInt16BE(blockSize, 6);
    fpt = Buffer.concat([head, ...memoBlocks]);
  }
  return { dbf: out, fpt };
}
