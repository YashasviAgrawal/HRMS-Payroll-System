import "server-only";
import { db } from "./db";
import { env } from "./env";

let cachedBoard: { id: string; code: string; name: string; nameHi: string } | undefined;

/** The Board this installation serves. Release 1 runs one Board; the data model already supports more. */
export async function currentBoard() {
  if (cachedBoard) return cachedBoard;
  const board = await db.board.findUnique({ where: { code: env().BOARD_CODE } });
  if (!board) throw new Error(`Board ${env().BOARD_CODE} is not set up. Run "npm run db:seed".`);
  cachedBoard = { id: board.id, code: board.code, name: board.name, nameHi: board.nameHi };
  return cachedBoard;
}
